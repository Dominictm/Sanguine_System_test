'use strict';
// Роутер хроник (chronicle-level): список, создание, delete-preview/delete,
// события хроники, AI-рекап «Ранее в хронике…», агрегат /api/chronicle,
// Scene State (/api/chronicles/:chr/state).
// Модульный (module-level) слой — routes/modules.js.
// Фабрика с DI: AI-хелперы (makeGenerationClient, isOA, oaCall, oaModels,
// validModels) и runValidationBackground приходят из server.js при
// монтировании — сам AI-слой и фоновая валидация пока живут там (E1.2).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError, aiRateLimit } = require('../lib/http');
const {
  ROOT, DEFAULT_CITY, charsDir, chroniclesDir, archiveDir,
  reqCity, writeFileAtomic, invalidateChars, getAllCharacters, mapLimit,
  aggregateEvents, eventDateScore, findMdFiles, rmdir,
  renderChronicleEventsSkeleton, renderOpenThreadsSkeleton,
} = require('../lib/db');
const { slugify, parseChronicle, parseChronicleParticipants, parseEvent } = require('../lib/parsers');
const { parseEventsText, compressChronicleEvents } = require('../lib/context_builder');

// City chronicle file = cities/<city>/archive/events.md (World State + aggregate index).
// Full per-event entries live in cities/<city>/chronicles/<chr>/events.md.
async function findChronicleFile(city = DEFAULT_CITY) {
  const f = path.join(archiveDir(city), 'events.md');
  return fs.access(f).then(() => f).catch(() => null);
}

// ── Chronicle create ──────────────────────────────────────────────────────────

function renderChronicleMd(display, slug, city, mood, moduleLinks) {
  const moodLine   = mood ? `- **Настроение:** ${mood}\n` : '';
  const modsSection = moduleLinks?.length
    ? `\n## 🔗 Модули\n\n${moduleLinks.map(m => `- [${m.title}](modules/${m.slug}/${m.slug}.md)`).join('\n')}\n`
    : '';
  return [
    `# 📕 ${display}`,
    '',
    `- **Статус:** 🟡 Активна`,
    moodLine ? moodLine.trimEnd() : null,
    '',
    `> Спина хроники. События — [events.md](events.md). Нити — [open_threads.md](open_threads.md).`,
    `> Закрыть хронику: \`node tools/close_chronicle.js ${city} ${slug} "финал"\``,
    modsSection,
  ].filter(l => l !== null).join('\n');
}

// ── Chronicle delete helpers ──────────────────────────────────────────────────

async function buildChronicleDeletePreview(city, slug) {
  const chrDir  = path.join(chroniclesDir(city), slug);
  const entries = await fs.readdir(chrDir, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;

  // 1. Files to delete
  const toDelete = await findMdFiles(chrDir);

  // 2. Participants named in this chronicle
  const evText = await fs.readFile(path.join(chrDir, 'events.md'), 'utf-8').catch(() => '');
  const rawNames = parseChronicleParticipants(evText);

  // 3. All text in OTHER chronicles (to check exclusivity)
  const allChrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true }).catch(() => []);
  const otherDirs  = allChrs.filter(c => c.isDirectory() && c.name !== slug);
  const otherLists = await Promise.all(otherDirs.map(c => findMdFiles(path.join(chroniclesDir(city), c.name))));
  const otherFiles = otherLists.flat();
  const otherTexts = await mapLimit(otherFiles, 24, f => fs.readFile(f, 'utf-8').catch(() => ''));
  const otherText  = otherTexts.map(t => t + '\n').join('');

  // 4. Resolve names to character folders
  const chars = await getAllCharacters(city);
  const tempChars = [];

  for (const name of rawNames) {
    // fuzzy match against known characters
    const nameL = name.toLowerCase();
    const ch = chars.find(c =>
      c.name === name || c.name.toLowerCase() === nameL ||
      c.name.toLowerCase().startsWith(nameL.split(' ')[0]) ||
      nameL.startsWith(c.name.toLowerCase().split(' ')[0])
    );
    if (!ch) continue;
    // Check if mentioned in other chronicles
    const inOther = otherText.toLowerCase().includes(ch.name.toLowerCase()) ||
                    (ch.aliases || []).some(a => otherText.toLowerCase().includes(a.toLowerCase()));
    if (!inOther) {
      tempChars.push({ name: ch.name, slug: ch.slug, lineageFolder: ch.lineageFolder });
    }
  }

  return { toDelete, tempChars };
}

// Фабрика: server.js передаёт AI-хелперы и runValidationBackground при монтировании.
module.exports = function chroniclesRouter({
  makeGenerationClient, runValidationBackground, genTextWithRetry,
}) {
  const router = express.Router();

  router.get('/api/chronicles', async (req, res) => {
    try {
      const city = reqCity(req);
      const out  = [];
      let chrs;   try { chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true }); } catch { chrs = []; }

      for (const ch of chrs) {
        if (!ch.isDirectory()) continue;
        const chrDir = path.join(chroniclesDir(city), ch.name);

        // Display name from events.md H1
        let display = ch.name;
        const evRaw = await fs.readFile(path.join(chrDir, 'events.md'), 'utf-8').catch(() => null);
        if (evRaw) {
          const m = evRaw.replace(/^﻿/, '').match(/^#\s+(.+?)\s+—\s+События/m);
          if (m) display = m[1].replace(/^[^\p{L}\p{N}]+/u, '').trim();
        }

        // Event count
        const events = evRaw
          ? (evRaw.match(/^###\s*📅/gm) || []).length
          : 0;

        // Module count
        let modules = 0;
        try {
          const mods = await fs.readdir(path.join(chrDir, 'modules'), { withFileTypes: true });
          modules = mods.filter(e => e.isDirectory() && !e.name.startsWith('.')).length;
        } catch {}

        // Status + hidden flag from chronicle.md
        let status = 'active';
        let hidden = false;
        const chrMd = await fs.readFile(path.join(chrDir, 'chronicle.md'), 'utf-8').catch(() => null);
        if (chrMd) {
          if (/Закрыта|Завершена|closed/i.test(chrMd)) status = 'closed';
          else if (/Приостановлена|paused/i.test(chrMd)) status = 'paused';
          if (/\*\*Скрыта\*\*\s*\|\s*да/i.test(chrMd)) hidden = true;
        }

        // First event date (oldest = last after desc sort, so min score)
        let startDate = '';
        if (evRaw) {
          const dateMatches = [...evRaw.matchAll(/^###\s*📅\s+(.+?)(?:\s+—|\n)/gm)].map(m => m[1].trim());
          if (dateMatches.length) {
            // Take the date with lowest score = oldest
            startDate = dateMatches.reduce((a, b) => eventDateScore(a) < eventDateScore(b) ? a : b);
          }
        }

        out.push({ slug: ch.name, display, events, modules, status, startDate, hidden });
      }

      // Sort: active first, then by name
      out.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        return a.display.localeCompare(b.display, 'ru');
      });

      // By default hide chronicles marked as hidden; pass ?include_hidden=1 to include them (e.g. module creation dropdown)
      const includeHidden = req.query.include_hidden === '1';
      res.json(includeHidden ? out : out.filter(c => !c.hidden));
    } catch (e) { serverError(res, e); }
  });

  router.post('/api/chronicles', express.json(), async (req, res) => {
    try {
      const city    = reqCity(req);
      const { name, mood } = req.body || {};
      if (!name || !name.trim()) return res.status(400).json({ error: 'Укажи название хроники' });

      const display  = name.trim();
      const slug     = req.body.slug?.trim() || slugify(display);
      if (!slug) return res.status(400).json({ error: 'Не удалось сформировать slug' });

      const chrDir = path.join(chroniclesDir(city), slug);
      if (await fs.stat(chrDir).catch(() => null)) {
        return res.status(409).json({ error: `Хроника «${slug}» уже существует` });
      }

      await fs.mkdir(path.join(chrDir, 'modules'), { recursive: true });

      await writeFileAtomic(path.join(chrDir, 'chronicle.md'),
        renderChronicleMd(display, slug, city, mood?.trim() || '', []), 'utf-8');

      await writeFileAtomic(path.join(chrDir, 'events.md'),
        renderChronicleEventsSkeleton(display), 'utf-8');

      await writeFileAtomic(path.join(chrDir, 'open_threads.md'),
        renderOpenThreadsSkeleton(display), 'utf-8');

      console.log(`[create-chronicle] ${city}/${slug}: «${display}»`);
      invalidateChars(city);
      res.json({ ok: true, slug, display });
    } catch (e) {
      console.error('[create-chronicle]', e.message);
      serverError(res, e);
    }
  });

  // ── Chronicle delete preview ──────────────────────────────────────────────────

  router.get('/api/chronicles/:slug/delete-preview', async (req, res) => {
    try {
      const city = reqCity(req);
      const slug = req.params.slug;
      const preview = await buildChronicleDeletePreview(city, slug);
      if (!preview) return res.status(404).json({ error: 'Хроника не найдена' });
      res.json({
        slug,
        filesToDelete: preview.toDelete.map(f => path.relative(ROOT, f)),
        tempChars: preview.tempChars,
      });
    } catch (e) { serverError(res, e); }
  });

  // ── Chronicle delete ──────────────────────────────────────────────────────────

  router.delete('/api/chronicles/:slug', express.json(), async (req, res) => {
    try {
      const city    = reqCity(req);
      const slug    = req.params.slug;
      const chrDir  = path.join(chroniclesDir(city), slug);

      const exists = await fs.stat(chrDir).catch(() => null);
      if (!exists) return res.status(404).json({ error: 'Хроника не найдена' });

      // Build what to move
      const preview = await buildChronicleDeletePreview(city, slug);

      // 1. Move temporary NPCs to nps_time
      const npsTimeDir = path.join(charsDir(city), 'nps_time');
      await fs.mkdir(npsTimeDir, { recursive: true });

      const moved = [];
      for (const ch of (preview?.tempChars || [])) {
        const src = path.join(charsDir(city), ch.lineageFolder, ch.slug);
        const dst = path.join(npsTimeDir, ch.slug);
        try {
          await fs.rename(src, dst);
          moved.push({ name: ch.name, slug: ch.slug, from: ch.lineageFolder, to: 'nps_time' });
          console.log(`[delete-chronicle] moved temp NPC → nps_time: ${ch.slug}`);
        } catch (e) {
          console.warn(`[delete-chronicle] could not move ${ch.slug}:`, e.message);
        }
      }

      // 2. Remove from characters_index.md
      const idxPath = path.join(archiveDir(city), 'characters_index.md');
      try {
        let idx = await fs.readFile(idxPath, 'utf-8');
        for (const ch of moved) {
          idx = idx.split('\n').filter(l => !l.includes(`/${ch.lineageFolder}/${ch.slug}/`)).join('\n');
          // Add note at bottom
          idx = idx.replace(/\s*$/, '') +
            `\n- [${ch.name}](../characters/nps_time/${ch.slug}/${ch.slug}.md) — Временный НПС (из хроники ${slug})\n`;
        }
        await writeFileAtomic(idxPath, idx, 'utf-8');
      } catch {}

      // 3. Delete chronicle directory
      await rmdir(chrDir);
      console.log(`[delete-chronicle] deleted: ${slug}`);

      // 4. Clear cache
      invalidateChars(city);
      runValidationBackground();

      res.json({ ok: true, slug, moved });
    } catch (e) {
      console.error('[delete-chronicle]', e.message);
      serverError(res, e);
    }
  });

  // ── Events for one chronicle ──────────────────────────────────────────────────

  router.get('/api/chronicles/:slug/events', async (req, res) => {
    try {
      const city   = reqCity(req);
      const slug   = req.params.slug;
      const chrDir = path.join(chroniclesDir(city), slug);
      const raw    = await fs.readFile(path.join(chrDir, 'events.md'), 'utf-8').catch(() => null);
      if (!raw) return res.json([]);

      const content = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const events  = [];
      content.split(/\n(?=###\s*📅)/).filter(c => /^###\s*📅/.test(c.trim()))
        .forEach(c => { const ev = parseEvent(c.trim(), events.length); ev.chronicle = slug; events.push(ev); });

      events.sort((a, b) => eventDateScore(b.date) - eventDateScore(a.date));
      events.forEach((ev, i) => { ev.id = i; });
      res.json(events);
    } catch (e) { serverError(res, e); }
  });

  // ── "Ранее в хронике…" — AI recap of the most recent events ────────────────────

  router.post('/api/chronicles/:slug/recap', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city   = reqCity(req);
      const slug   = req.params.slug;
      const count  = Math.min(Math.max(parseInt(req.body?.count) || 3, 1), 8);

      const chrDir = path.join(chroniclesDir(city), slug);
      const raw    = await fs.readFile(path.join(chrDir, 'events.md'), 'utf-8').catch(() => null);
      if (!raw) return res.status(404).json({ error: 'У хроники нет events.md' });

      const content = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const events  = [];
      content.split(/\n(?=###\s*📅)/).filter(c => /^###\s*📅/.test(c.trim()))
        .forEach(c => { const ev = parseEvent(c.trim(), events.length); events.push(ev); });
      if (!events.length) return res.status(400).json({ error: 'В хронике пока нет событий для пересказа' });

      events.sort((a, b) => eventDateScore(b.date) - eventDateScore(a.date));
      const recent = events.slice(0, count).reverse(); // oldest → newest of the recent window

      // Validate inputs BEFORE constructing the generation client.
      const preferSource = req.body?.preferSource || null;
      const orModel      = req.body?.orModel      || null;
      const gen = await makeGenerationClient(preferSource, orModel);

      const digest = recent.map(ev => {
        const parts = (ev.participants || []).map(p => p.name).filter(Boolean).join(', ');
        const cons  = (ev.consequences || []).join('; ');
        return [
          `Дата: ${ev.date}`,
          ev.title ? `Событие: ${ev.title}` : '',
          ev.location?.text ? `Место: ${ev.location.text.trim()}` : '',
          parts ? `Участники: ${parts}` : '',
          ev.eventsText ? `Что произошло: ${ev.eventsText.replace(/\s+/g, ' ').slice(0, 600)}` : '',
          cons ? `Последствия: ${cons}` : '',
        ].filter(Boolean).join('\n');
      }).join('\n\n---\n\n');

      const systemPrompt = 'Ты — Рассказчик Vampire: The Masquerade V20. Пишешь кинематографичный закадровый пересказ «Ранее в хронике…» для игроков перед началом новой сессии.';
      const userPrompt = `На основе последних событий хроники напиши пересказ в стиле «Ранее в…» (как заставка перед серией).

Требования:
- Язык: русский. Тон: мрачный готический нуар, драматичный закадровый голос.
- 120–220 слов, 1–3 абзаца. Без заголовков, списков и игромеханики.
- Перечисли ключевые повороты последней сессии, нагнетай интригу к открытым вопросам.
- Не выдумывай фактов сверх данных. Не раскрывай тайны, которых нет в событиях.
- Начни со слов «Ранее в хронике…».

СОБЫТИЯ (от старых к новым):
${digest}`;

      const out = await genTextWithRetry(gen, { system: systemPrompt, user: userPrompt, maxTokens: 600 });
      const recap = out.text.trim();

      if (!recap) return res.status(500).json({ error: 'Модель вернула пустой ответ. Попробуйте ещё раз.' });
      res.json({ ok: true, recap, eventsUsed: recent.length, source: out.source });
    } catch (e) {
      const status = e.status ?? 500;
      const msg    = e.error?.error?.message ?? e.message ?? String(e);
      console.error(`[chronicle-recap] ${status}`, msg);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg, ...(e.rateLimited ? { rateLimited: true } : {}) });
    }
  });

  router.get('/api/chronicle', async (req, res) => {
    try {
      const city = reqCity(req);
      const file = await findChronicleFile(city);
      if (!file) return res.json({ exists: false, title: null, worldState: null, events: [] });
      const raw    = await fs.readFile(file, 'utf-8');
      const parsed = parseChronicle(raw);          // title + World State from archive/events.md
      parsed.events = await aggregateEvents(city); // full events from chronicles/<chr>/events.md
      res.json({ exists: true, ...parsed });
    } catch (e) { serverError(res, e); }
  });

  // ── Chronicle Scene State ─────────────────────────────────────────────────────
  // GET /api/chronicles/:chr/state?city=paris
  // Reads chronicle events.md → compresses to compact Scene State JSON.
  // Clients can pass this back as `state` in prose generation requests.
  router.get('/api/chronicles/:chr/state', async (req, res) => {
    try {
      const city = reqCity(req);
      const chr  = req.params.chr;
      if (!chr || !/^[a-z0-9_-]+$/i.test(chr))
        return res.status(400).json({ error: 'Некорректный slug хроники.' });

      const evPath = path.join(chroniclesDir(city), chr, 'events.md');
      const raw    = await fs.readFile(evPath, 'utf-8').catch(() => null);
      if (!raw) return res.status(404).json({ error: 'events.md не найден для этой хроники.' });

      const events = parseEventsText(raw);
      const state  = compressChronicleEvents(events);
      state.city      = city;
      state.chronicle = chr;
      state.eventsCount = events.length;

      res.json({ ok: true, state });
    } catch (e) {
      serverError(res, e);
    }
  });

  return router;
};
