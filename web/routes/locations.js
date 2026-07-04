'use strict';
// Роутер локаций: список, арты, правка полей, загрузка изображений, создание
// (с опциональной AI-генерацией карточки), soft-delete, AI-генерация полей.
// Фабрика с DI: AI-хелперы (makeGenerationClient, isOA, oaCall) приходят из
// server.js при монтировании — сам AI-слой пока живёт там (E1.2).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError, aiRateLimit } = require('../lib/http');
const {
  ROOT, reqCity, locsDir, writeFileAtomic, invalidateLocs,
  getAllLocations, findLocMdPath,
} = require('../lib/db');
const { slugify, writePrompt, parseLocation } = require('../lib/parsers');

// ── Location card template (standalone) ──────────────────────────────────────
function _locCardTemplate(name, district) {
  return `# ${name}
> **Название:** ${name} | **Округ:** ${district || '[округ]'} | **Район:** [район] | **Адрес:** [адрес] | **Зона:** [🟢/🟡/🔴] | **Контроль:** [фракция]
---
## 🎭 Атмосфера
[2–3 предложения]
## 👁️ Сенсорная палитра
| Канал | |
|---|---|
| **Свет** | |
| **Звук** | |
| **Запах** | |
| **Тактильное** | |
---
## 🩸 Контекст Камарильи / Масок
| | |
|---|---|
| **Статус** | |
| **Фракция** | |
| **Постоянные фигуры** | |
| **Угрозы** | |
| **Маскарад** | 🔴/🟡/🟢 |
---
## 🗺️ Ключевые точки
| Место | Описание |
|---|---|
| | |
---
## 🪝 Сценарные крючки
1. [крючок]
## 🖼️ Изображения
- ⏳ Изображение не предоставлено
## 🎨 Промт для генерации изображения
\`\`\`
[промт]
\`\`\`
`;
}

// Фабрика: server.js передаёт AI-хелперы при монтировании.
module.exports = function locationsRouter({ makeGenerationClient, isOA, oaCall }) {
  const router = express.Router();

  router.get('/api/locations', async (req, res) => {
    try { res.json(await getAllLocations(reqCity(req))); }
    catch (e) { serverError(res, e); }
  });

  // ── Export: все локации города одним файлом для скачивания ────────────────────
  router.get('/api/export/locations', async (req, res) => {
    try {
      const city = reqCity(req);
      const locs = await getAllLocations(city);
      res.setHeader('Content-Disposition', `attachment; filename="locations_${city}.json"`);
      res.json(locs);
    } catch (e) { serverError(res, e); }
  });

  // ── Import: обратная операция для /api/export/locations — принимает тот же
  // формат (массив объектов с `raw` — полным содержимием карточки, `dirRelPath` —
  // путём папки локации относительно locations/) и восстанавливает структуру
  // district_NN/<район>/<локация>/ в текущем городе. Изображения (art/) не
  // переносятся — так же, как экспорт их не включает.
  router.post('/api/import/locations', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const city      = reqCity(req);
      const items     = Array.isArray(req.body?.locations) ? req.body.locations : [];
      const overwrite = !!req.body?.overwrite;
      if (!items.length) return res.status(400).json({ error: 'Пустой список локаций для импорта' });

      const locRoot = locsDir(city);
      const created = [], skipped = [], errors = [];
      for (const item of items) {
        const dirRel = String(item?.dirRelPath || '').trim().replace(/\\/g, '/');
        const raw    = String(item?.raw || '');
        const slug   = dirRel.split('/').filter(Boolean).pop() || '';
        if (!dirRel || dirRel.includes('..') || path.isAbsolute(dirRel)) {
          errors.push({ dirRelPath: dirRel, error: 'Недопустимый путь' }); continue;
        }
        if (!slug) { errors.push({ dirRelPath: dirRel, error: 'Не удалось определить слаг из пути' }); continue; }
        if (!raw.trim()) { errors.push({ dirRelPath: dirRel, error: 'Пустое содержимое карточки' }); continue; }

        const dir = path.join(locRoot, ...dirRel.split('/'));
        if (path.relative(locRoot, dir).startsWith('..')) {
          errors.push({ dirRelPath: dirRel, error: 'Путь выходит за пределы locations/' }); continue;
        }

        try {
          const mdPath = path.join(dir, `${slug}.md`);
          const exists = await fs.stat(mdPath).catch(() => null);
          if (exists && !overwrite) { skipped.push(dirRel); continue; }

          await fs.mkdir(dir, { recursive: true });
          await writeFileAtomic(mdPath, raw, 'utf-8');
          created.push(dirRel);
        } catch (e) { errors.push({ dirRelPath: dirRel, error: e.message }); }
      }

      invalidateLocs(city);
      console.log(`[import-locations] ${city}: created=${created.length} skipped=${skipped.length} errors=${errors.length}`);
      res.json({ ok: true, created, skipped, errors });
    } catch (e) { serverError(res, e); }
  });

  router.get('/api/locations/:slug/images', async (req, res) => {
    try {
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);
      const locs = await getAllLocations(city);
      const loc  = locs.find(l => l.slug === slug);
      if (!loc) return res.status(404).json({ error: 'not found' });
      res.json({ images: loc.imageUrls || (loc.imageUrl ? [loc.imageUrl] : []) });
    } catch (e) { serverError(res, e); }
  });

  router.put('/api/locations/:slug/fields', express.json(), async (req, res) => {
    try {
      const slug   = decodeURIComponent(req.params.slug);
      const city   = reqCity(req);
      const fields = req.body.fields || {};

      const mdPath = await findLocMdPath(slug, city);
      if (!mdPath) return res.status(404).json({ error: 'Локация не найдена' });

      let card = await fs.readFile(mdPath, 'utf-8');

      for (const [key, rawValue] of Object.entries(fields)) {
        const value = String(rawValue).trim();

        if (key === 'atmosphere') {
          card = card.replace(
            /(## (?:🎭\s+)?Атмосфера[^\n]*\n+)([\s\S]+?)(\n## |\n---|$)/,
            (_, hdr, _old, tail) => `${hdr}${value}\n${tail}`
          );
          continue;
        }
        if (key === 'vtmText') {
          card = card.replace(
            /(## (?:🩸\s+)?(?:VtM[^\n]*|Контекст[^\n]*)\n+)([\s\S]+?)(\n## |\n---|$)/i,
            (_, hdr, body, tail) => {
              const tableLines = body.split('\n').filter(l => l.startsWith('|') || /^\s*$/.test(l)).join('\n').trim();
              return `${hdr}${value ? value + '\n\n' : ''}${tableLines}\n${tail}`;
            }
          );
          continue;
        }
        if (key === 'imagePrompt') {
          card = writePrompt(card, 'image', value, 'fenced');
          continue;
        }
        if (key === 'negativePrompt') {
          card = writePrompt(card, 'negative', value, 'fenced');
          continue;
        }
        if (key === 'hooks') {
          const lines = value.split('\n').filter(l => l.trim());
          const numbered = lines.map((l, i) => `${i + 1}. ${l.replace(/^\d+\.\s*/, '')}`).join('\n');
          card = card.replace(
            /(## (?:🪝\s+)?(?:Сценарные крючки|Крючки)[^\n]*\n+)([\s\S]+?)(\n## |\n---|$)/i,
            (_, hdr, _old, tail) => `${hdr}${numbered}\n${tail}`
          );
          continue;
        }
        if (key === 'subtype') {
          // Update H1 (preserve emoji, handle BOM)
          card = card.replace(/^(﻿?#\s+(?:[\p{Emoji}\p{Mark}]+\s+)?).*$/mu, `$1${value}`);
          // Update inline metadata field **Название:**
          card = card.replace(
            /(\*\*Название:\*\*)\s*([^|\n]+?)(?=\s*\||\s*\n|$)/m,
            `$1 ${value}`
          );
          continue;
        }
        if (key === 'keyPoints') {
          card = card.replace(
            /(## (?:🗺️\s+)?Ключевые точки[^\n]*\n+)([\s\S]+?)(\n## |\n---|$)/i,
            (_, hdr, _old, tail) => `${hdr}${value}\n${tail}`
          );
          continue;
        }
        if (key === 'sensoryPalette') {
          card = card.replace(
            /(## (?:👁️\s+)?Сенсорная палитра[^\n]*\n+)([\s\S]+?)(\n## |\n---|$)/i,
            (_, hdr, _old, tail) => `${hdr}${value}\n${tail}`
          );
          continue;
        }
        // Inline metadata fields
        const fieldMap = { district: 'Округ', neighborhood: 'Район', address: 'Адрес', control: 'Контроль', zone: 'Зона' };
        const mdKey = fieldMap[key];
        if (mdKey) {
          const esc = mdKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          card = card.replace(
            new RegExp(`(\\*\\*${esc}:\\*\\*)\\s*([^|\\n]+?)(?=\\s*\\||\\s*\\n|$)`, 'm'),
            `$1 ${value}`
          );
        }
      }

      await writeFileAtomic(mdPath, card, 'utf-8');
      invalidateLocs(city);
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  router.post('/api/locations/:slug/upload-image', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const { base64, ext = 'jpg' } = req.body;
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);

      const mdPath = await findLocMdPath(slug, city);
      if (!mdPath) return res.status(404).json({ error: 'Локация не найдена' });

      const locFolder = path.dirname(mdPath);
      const artDir    = path.join(locFolder, 'art');
      await fs.mkdir(artDir, { recursive: true });

      const safeExt = (ext || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
      const existing = await fs.readdir(artDir).catch(() => []);
      const slugRe   = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)\\.[a-z]+$`, 'i');
      const nums     = existing.map(f => { const m = slugRe.exec(f); return m ? parseInt(m[1], 10) : 0; }).filter(n => n > 0);
      const nextNum  = (nums.length ? Math.max(...nums) : 0) + 1;
      const filename = `${slug}_${String(nextNum).padStart(2, '0')}.${safeExt}`;

      await writeFileAtomic(path.join(artDir, filename), Buffer.from(base64, 'base64'));

      let card = await fs.readFile(mdPath, 'utf-8').catch(() => null);
      if (card) {
        const newLine = `- [Образ ${nextNum}](art/${filename})`;
        if (/⏳[^\n]*изображение не предоставлено/i.test(card)) {
          card = card.replace(/- ⏳[^\n]*изображение не предоставлено[^\n]*/i, newLine);
        } else {
          card = card.replace(/(## 🖼️ Изображения\n)([\s\S]*?)(\n##|\s*$)/, (_, hdr, body, tail) => {
            return `${hdr}${body.replace(/\n+$/, '')}\n${newLine}\n${tail}`;
          });
        }
        await writeFileAtomic(mdPath, card, 'utf-8');
      }

      const locRoot  = locsDir(city);
      const relParts = path.relative(locRoot, locFolder).split(path.sep);
      const url = `/city-img/${city}/locations/` + relParts.map(p => encodeURIComponent(p)).join('/') + '/art/' + encodeURIComponent(filename);
      res.json({ success: true, filename, url });
    } catch (e) { serverError(res, e); }
  });

  // ── POST /api/locations — create new location ─────────────────────────────────
  router.post('/api/locations', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { name, district, generate, context, source, model: modelOvr } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'name обязателен' });

      const locName  = name.trim();
      const locSlug  = slugify(locName);
      if (!locSlug) return res.status(400).json({ error: 'Не удалось построить slug из имени' });

      const distFolder = district?.trim() || 'Другие';
      const locDir  = path.join(locsDir(city), distFolder, locSlug);
      const locFile = path.join(locDir, `${locSlug}.md`);

      if (await fs.stat(locFile).catch(() => null))
        return res.status(409).json({ error: 'Локация уже существует', slug: locSlug });

      await fs.mkdir(locDir, { recursive: true });

      let content = _locCardTemplate(locName, district?.trim() || '');

      if (generate) {
        try {
          const gen = await makeGenerationClient(source, modelOvr).catch(() => null);
          const portretRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'portret.md'), 'utf-8').catch(() => '');
          const prompt = `Создай карточку локации «${locName}» для Vampire: The Masquerade V20, ${city || 'Париж'} 2010.

Контекст сцены: ${context || '(без контекста)'}
Район: ${district?.trim() || '(не указан)'}

Правила оформления:
${portretRules.slice(0, 900)}

Шаблон:
${_locCardTemplate(locName, district?.trim() || '')}

Заполни шаблон полностью. Верни только Markdown-карточку без лишнего текста.
Язык: русский. Стиль: готический нуар VtM.`;

          let raw = '';
          if (gen && isOA(gen)) {
            raw = await oaCall(gen)(gen.model, '', prompt, [], 60000, 1300);
          } else if (gen?.client) {
            const m = await gen.client.messages.create({
              model: 'claude-haiku-4-5-20251001', max_tokens: 1300,
              messages: [{ role: 'user', content: prompt }],
            });
            raw = m.content[0]?.text || '';
          }
          if (raw.trim()) content = raw.trim() + '\n';
        } catch (genErr) {
          console.warn('[loc-create] generation failed:', genErr.message);
        }
      }

      await writeFileAtomic(locFile, content, 'utf-8');
      invalidateLocs(city);
      res.json({ ok: true, slug: locSlug, district: distFolder });
    } catch (e) { serverError(res, e); }
  });

  // ── DELETE /api/locations/:slug — soft-delete (move to locations/_deleted/) ───
  // Обратимо, по аналогии с персонажами и городами: папка локации переезжает в
  // locations/_deleted/<slug>_<timestamp>/, обходы локаций пропускают _-папки.
  router.delete('/api/locations/:slug', async (req, res) => {
    try {
      const slug   = decodeURIComponent(req.params.slug);
      const city   = reqCity(req);
      const mdPath = await findLocMdPath(slug, city);
      if (!mdPath) return res.status(404).json({ error: 'Локация не найдена' });
      const trashRoot = path.join(locsDir(city), '_deleted');
      await fs.mkdir(trashRoot, { recursive: true });
      const dst = path.join(trashRoot, `${slug}_${Date.now()}`);
      await fs.rename(path.dirname(mdPath), dst);
      invalidateLocs(city);
      console.log(`[delete-location] ${city}/${slug} → locations/_deleted/${path.basename(dst)}`);
      res.json({ ok: true, movedTo: `locations/_deleted/${path.basename(dst)}` });
    } catch (e) { serverError(res, e); }
  });

  // ── POST /api/locations/generate — AI full-card or single-field generation ────
  router.post('/api/locations/generate', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { slug, name, field, card, context, source, model: modelOvr } = req.body || {};

      const locName = name?.trim() || slug || '';
      if (!locName) return res.status(400).json({ error: 'name или slug обязателен' });

      const gen = await makeGenerationClient(source, modelOvr);
      const portretRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'portret.md'), 'utf-8').catch(() => '');

      let prompt, maxTok;

      if (field) {
        const fieldPrompts = {
          atmosphere: `Напиши раздел "Атмосфера" (2–3 предложения, готический нуар VtM) для локации «${locName}»${context ? `. Контекст: ${context}` : ''}. Верни только текст раздела без заголовка.`,
          imagePrompt: `Напиши промт для генерации изображения локации «${locName}» (GPT/DALL-E, английский язык, три блока: Локация → Свет/Атмосфера → Стиль).\nПравила:\n${portretRules.slice(0, 600)}\n\nВерни только текст промта.`,
          hooks: `Напиши 3 сценарных крючка для локации «${locName}» в VtM V20${context ? `. Контекст: ${context}` : ''}. Формат: нумерованный список. Верни только список.`,
        };
        prompt  = fieldPrompts[field] || `Напиши поле «${field}» для локации «${locName}» (VtM V20, готический нуар, русский язык)${context ? `. Контекст: ${context}` : ''}.`;
        maxTok  = 400;
      } else {
        const currentCard = card || (slug ? await (async () => {
          const mdPath = await findLocMdPath(slug, city);
          return mdPath ? fs.readFile(mdPath, 'utf-8').catch(() => '') : '';
        })() : '');
        prompt = `Создай${currentCard ? ' улучшенную версию' : ''} карточку локации «${locName}» для Vampire: The Masquerade V20, ${city || 'Париж'} 2010.

Контекст: ${context || '(нет)'}

Правила:
${portretRules.slice(0, 900)}

${currentCard ? `Текущий вариант:\n${String(currentCard).slice(0, 600)}\n\n` : ''}Шаблон:
${_locCardTemplate(locName)}

Заполни полностью. Верни только Markdown без лишнего текста. Язык: русский, стиль: готический нуар VtM.`;
        maxTok = 1400;
      }

      let result = '';
      if (isOA(gen)) {
        result = await oaCall(gen)(gen.model, '', prompt, [], 60000, maxTok);
      } else if (gen?.client) {
        const m = await gen.client.messages.create({
          model: 'claude-haiku-4-5-20251001', max_tokens: maxTok,
          messages: [{ role: 'user', content: prompt }],
        });
        result = m.content[0]?.text || '';
      }

      if (field) res.json({ value: result.trim() });
      else       res.json({ content: result.trim() });
    } catch (e) { serverError(res, e); }
  });

  // ── POST /api/locations/parse-generated — общий парсер сырого AI-текста ───────
  // Единый источник истины с parseLocation (lib/parsers.js), которым парсятся
  // сохранённые карточки — раньше scripts.js дублировал эти regex своей копией.
  router.post('/api/locations/parse-generated', express.json(), (req, res) => {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: 'text required' });
    try {
      const parsed = parseLocation(text, 'parsed');
      res.json({ ok: true, ...parsed });
    } catch (e) { serverError(res, e); }
  });

  return router;
};
