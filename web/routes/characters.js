'use strict';
// Роутер персонажей: список, арты (все изображения / по персонажу), правка полей
// и отношений, создание карточки, soft-delete с де-линковкой ссылок,
// загрузка/удаление изображений, дневники, диалоги (AI) и V20-лист.
// Фабрика с DI: runValidationBackground + AI/лист-хелперы приходят из server.js
// при монтировании (makeGenerationClient/isOA/oaCall/oaModels — общий генератор,
// generateV20Sheet/ensureSheetLink — используются также modules.js для НПС модулей,
// поэтому сама реализация остаётся в server.js, а сюда приходит только вызов).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError, aiRateLimit } = require('../lib/http');
const {
  ROOT, cityDir, charsDir, chroniclesDir, archiveDir, reqCity, writeFileAtomic, invalidateChars,
  getAllCharacters, mapLimit, LINEAGE_MAP,
  EDITABLE_FIELD_MAP, SHEET_HEADER_FROM_CARD, _setSheetHeaderCell,
  _nameMatch, _findModularNpcCard,
} = require('../lib/db');
const { slugify, writePrompt, parseDiary, periodLabel, parseCharacter } = require('../lib/parsers');
const { loadLiteraryStyle } = require('../lib/context_builder');
const { mapCharacterToFoundryActor, FOUNDRY_SUPPORTED_LINEAGES } = require('../lib/foundry-export');
const { mapFoundryActorToSheetData } = require('../lib/foundry-import');
const { createZip } = require('../lib/zip');

// Переопределение ярлыка карточки по линейке (там, где он отличается от базового).
// Феи хранят локацию как «Фригольд / Локация» — пишем обратно тем же ярлыком, чтобы
// не плодить дублирующую строку «Домен / Локация».
const FIELD_LABEL_BY_LINEAGE = {
  fairies: { location: 'Фригольд / Локация' },
};
function fieldMdLabel(key, lineageFolder) {
  return (FIELD_LABEL_BY_LINEAGE[lineageFolder] || {})[key] || EDITABLE_FIELD_MAP[key];
}

// Push known-good card values (name/clan/generation/sire) into an existing sheet —
// both the AI markdown (-sheet.md) and the interactive JSON sidecar (-sheet.json),
// so editing the card's info tab doesn't leave a stale, drifted sheet behind.
async function _syncSheetHeaderFromCard(city, char, updates) {
  const linked = Object.keys(updates).filter(k => SHEET_HEADER_FROM_CARD[k]);
  if (!linked.length) return;
  const dir = path.join(charsDir(city), char.lineageFolder, char.slug);

  const mdPath = path.join(dir, `${char.slug}-sheet.md`);
  const md = await fs.readFile(mdPath, 'utf-8').catch(() => null);
  if (md !== null) {
    let out = md;
    for (const k of linked) {
      const v = String(updates[k] || '').trim();
      if (!v || v.includes('⚠️')) continue;
      out = _setSheetHeaderCell(out, SHEET_HEADER_FROM_CARD[k], v);
    }
    if (out !== md) await writeFileAtomic(mdPath, out, 'utf-8');
  }

  const jsonPath = path.join(dir, `${char.slug}-sheet.json`);
  const rawJson = await fs.readFile(jsonPath, 'utf-8').catch(() => null);
  if (rawJson !== null) {
    try {
      const data = JSON.parse(rawJson);
      data.header = data.header || {};
      let changed = false;
      for (const k of linked) {
        const v = String(updates[k] || '').trim();
        if (!v || v.includes('⚠️') || data.header[k] === v) continue;
        data.header[k] = v; changed = true;
      }
      if (changed) await writeFileAtomic(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* corrupt sidecar — leave untouched, not this endpoint's job to repair */ }
  }
}

// ── Create a new character card (web form; vampire-aware, fills fields per rules) ─

const GENDER = ['Мужской', 'Женский'];
const _LIN_FOLDER = { vampire:'vampires', fairy:'fairies', mortal:'mortals', werewolf:'werewolves', mage:'mages', hunter:'hunters' };
const _LIN_WOD    = { vampires:'Вампир', fairies:'Фея / Ченджлинг', mortals:'Смертный', werewolves:'Оборотень', mages:'Маг', hunters:'Охотник' };
const _LIN_EMOJI  = { vampires:'🧛', fairies:'🧚', mortals:'🧑', werewolves:'🐺', mages:'🔮', hunters:'🏹' };

// ── Character delete (soft: archive folder + de-link broken refs) ─────────────
// Soft-delete moves the folder to characters/_deleted/<slug>/ (reversible, keeps
// gitignored art). The _deleted folder is invisible to every subsystem because
// lists/counts/linter all use a lineage allow-list. Structural path-links in
// other files are de-linked (hyperlink dropped, name text kept) so nothing
// breaks; narrative prose (diaries, event text) is left intact as chronicle history.

async function _resolveChar(city, slug) {
  const chars = await getAllCharacters(city);
  return chars.find(c => c.slug === slug) || null;
}

// Every .md under root, skipping dotfolders and any excluded absolute dir.
async function _walkMd(root, excludeDirs = []) {
  const ex = new Set(excludeDirs.map(d => path.resolve(d)));
  const out = [];
  async function rec(dir) {
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!ex.has(path.resolve(full))) await rec(full); }
      else if (e.name.endsWith('.md')) out.push(full);
    }
  }
  await rec(root);
  return out;
}

// Turn "[text](…/<slug>/<slug>.md…)" into plain "text" (drop the dangling link).
function _delinkSlug(content, slug) {
  const s = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(new RegExp(`\\[([^\\]]+)\\]\\(([^)]*${s}/${s}\\.md[^)]*)\\)`, 'g'), '$1');
}

// Фабрика: server.js передаёт runValidationBackground + AI-хелперы при монтировании.
module.exports = function charactersRouter({
  runValidationBackground,
  makeGenerationClient, genTextWithRetry,
  generateV20Sheet, ensureSheetLink,
}) {
  const router = express.Router();

  router.get('/api/characters', async (req, res) => {
    try { res.json(await getAllCharacters(reqCity(req))); }
    catch (e) { serverError(res, e); }
  });

  // ── Export: все персонажи города одним файлом для скачивания ──────────────────
  router.get('/api/export/characters', async (req, res) => {
    try {
      const city = reqCity(req);
      const chars = await getAllCharacters(city);
      res.setHeader('Content-Disposition', `attachment; filename="characters_${city}.json"`);
      res.json(chars);
    } catch (e) { serverError(res, e); }
  });

  // ── Import: обратная операция для /api/export/characters — принимает тот же
  // формат (массив объектов с `raw` — полным содержимием карточки, `slug`,
  // `lineageFolder`) и записывает карточки в текущий город. По умолчанию не
  // трогает уже существующие слаги (overwrite:true — перезаписать).
  router.post('/api/import/characters', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const city      = reqCity(req);
      const items     = Array.isArray(req.body?.characters) ? req.body.characters : [];
      const overwrite = !!req.body?.overwrite;
      if (!items.length) return res.status(400).json({ error: 'Пустой список персонажей для импорта' });

      const created = [], skipped = [], errors = [];
      for (const item of items) {
        const slug   = String(item?.slug || '').trim();
        const folder = String(item?.lineageFolder || '').trim();
        const raw    = String(item?.raw || '');
        if (!slug || !/^[a-z0-9_]+$/.test(slug)) { errors.push({ slug, error: 'Недопустимый слаг' }); continue; }
        if (!LINEAGE_MAP[folder]) { errors.push({ slug, error: `Неизвестная линейка «${folder}»` }); continue; }
        if (!raw.trim()) { errors.push({ slug, error: 'Пустое содержимое карточки' }); continue; }

        try {
          const dir     = path.join(charsDir(city), folder, slug);
          const mdPath  = path.join(dir, `${slug}.md`);
          const exists  = await fs.stat(mdPath).catch(() => null);
          if (exists && !overwrite) { skipped.push(slug); continue; }

          await fs.mkdir(path.join(dir, 'art'), { recursive: true });
          await fs.mkdir(path.join(dir, 'journal'), { recursive: true });
          await writeFileAtomic(mdPath, raw, 'utf-8');

          // Зарегистрировать в сводном индексе, если там ещё нет этой ссылки
          // (повторный импорт/перезапись не должны плодить дубли строк).
          const idxPath = path.join(archiveDir(city), 'characters_index.md');
          const idxRaw  = await fs.readFile(idxPath, 'utf-8').catch(() => null);
          const relLink = `../characters/${folder}/${slug}/${slug}.md`;
          if (idxRaw !== null && !idxRaw.includes(relLink)) {
            const parsed = parseCharacter(raw, slug, LINEAGE_MAP[folder]);
            const bom = idxRaw.charCodeAt(0) === 0xFEFF;
            const body = (bom ? idxRaw.slice(1) : idxRaw).replace(/\s*$/, '') +
              `\n- [${parsed.name}](${relLink}) — ${parsed.lineageLabel || folder}${parsed.clan ? `, ${parsed.clan}` : ''}\n`;
            await writeFileAtomic(idxPath, (bom ? '﻿' : '') + body, 'utf-8');
          }

          created.push(slug);
        } catch (e) { errors.push({ slug, error: e.message }); }
      }

      invalidateChars(city);
      console.log(`[import-characters] ${city}: created=${created.length} skipped=${skipped.length} errors=${errors.length}`);
      res.json({ ok: true, created, skipped, errors });
    } catch (e) { serverError(res, e); }
  });

  // ── All images for all characters (for grid carousels) ────────────────────────

  router.get('/api/characters/all-images', async (req, res) => {
    try {
      const city  = reqCity(req);
      const chars = await getAllCharacters(city);
      const result = {};
      await Promise.all(chars.map(async char => {
        const artDir = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
        const files  = await fs.readdir(artDir).catch(() => []);
        const images = files
          .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
          .sort()
          .map(f => `/city-img/${city}/characters/${char.lineageFolder}/${encodeURIComponent(char.slug)}/art/${encodeURIComponent(f)}`);
        if (images.length > 1) result[char.name] = images;
      }));
      res.json(result);
    } catch (e) { serverError(res, e); }
  });

  // ── Update editable fields in a character card ────────────────────────────────

  router.put('/api/characters/:slug/fields', express.json(), async (req, res) => {
    try {
      const slug   = decodeURIComponent(req.params.slug);
      const city   = reqCity(req);
      const fields = req.body.fields || {};

      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
      // Strip a leading UTF-8 BOM — otherwise the H1 line starts with ﻿ and the
      // name-replacement regex (^#) never matches, so renames silently no-op.
      let card = (await fs.readFile(cardPath, 'utf-8')).replace(/^﻿/, '');

      for (const [key, rawValue] of Object.entries(fields)) {
        // H1 display name — preserves emoji prefix
        if (key === 'name') {
          const newName = String(rawValue).replace(/\n+/g, ' ').trim();
          if (!newName) continue;
          const before = card;
          card = card.replace(
            /^(#\s+[^\wЀ-ӿ]*)([\wЀ-ӿ].+)$/m,
            (_, prefix) => `${prefix}${newName}`
          );
          if (card === before)  // H1 not found — fail loudly instead of silent no-op
            return res.status(422).json({ error: 'Не найден заголовок (H1) карточки для переименования' });
          continue;
        }
        // imagePrompt / negativePrompt — multi-line indented block (character format)
        if (key === 'imagePrompt') {
          card = writePrompt(card, 'image', rawValue, 'indented');
          continue;
        }
        if (key === 'negativePrompt') {
          card = writePrompt(card, 'negative', rawValue, 'indented');
          continue;
        }

        const mdKey = fieldMdLabel(key, char.lineageFolder);
        if (!mdKey) continue;
        const value   = String(rawValue).replace(/\n+/g, ' ').trim(); // single-line fields
        const escaped = mdKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const lineRe  = new RegExp(`^(- \\*\\*${escaped}[^*]*:\\*\\*).*$`, 'm');
        const newLine = `- **${mdKey}:** ${value}`;
        if (lineRe.test(card)) {
          card = card.replace(lineRe, newLine);
        } else {
          const lastM = [...card.matchAll(/^- \*\*[^*:\n]+[^*]*:\*\*\s*.+$/gm)].at(-1);
          if (lastM) {
            const pos = lastM.index + lastM[0].length;
            card = card.slice(0, pos) + '\n' + newLine + card.slice(pos);
          }
        }
      }

      await writeFileAtomic(cardPath, card, 'utf-8');
      invalidateChars(city);
      await _syncSheetHeaderFromCard(city, char, fields);
      res.json({ ok: true });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── Update relations block ─────────────────────────────────────────────────────

  router.put('/api/characters/:slug/relations', express.json(), async (req, res) => {
    try {
      const slug   = decodeURIComponent(req.params.slug);
      const city   = reqCity(req);
      const lines  = req.body.lines || []; // array of strings "Имя — описание"

      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
      let card = await fs.readFile(cardPath, 'utf-8');

      const bullets = lines.filter(l => l.trim()).map(l => `  - ${l.trim()}`).join('\n');
      const newBlock = `- **Отношения:**\n${bullets || '  - —'}`;

      const relRe = /- \*\*Отношения:\*\*\n((?:[ \t]+- .+\n?)+)/;
      if (relRe.test(card)) {
        card = card.replace(relRe, newBlock + '\n');
      } else {
        // Append before the prompt section or at end of fields
        const insertBefore = card.indexOf('- **🎨');
        if (insertBefore !== -1) {
          card = card.slice(0, insertBefore) + newBlock + '\n' + card.slice(insertBefore);
        }
      }

      await writeFileAtomic(cardPath, card, 'utf-8');
      invalidateChars(city);
      res.json({ ok: true });
    } catch (e) {
      serverError(res, e);
    }
  });

  router.post('/api/characters', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const b    = req.body || {};
      const name = String(b.name || '').trim();
      const folder = _LIN_FOLDER[b.lineage] || 'mortals';
      const isVamp = folder === 'vampires';
      const clan = String(b.clan || '').trim();
      const sect = String(b.sect || '').trim();
      const gender = String(b.gender || '').trim();

      if (!name) return res.status(400).json({ error: 'Укажи имя персонажа' });
      if (!GENDER.includes(gender)) return res.status(400).json({ error: 'Укажи пол персонажа (Мужской/Женский)' });
      if (isVamp && !clan) return res.status(400).json({ error: 'Клан обязателен для вампира' });
      if (isVamp && !sect) return res.status(400).json({ error: 'Секта обязательна для вампира' });
      if (folder === 'fairies' && !String(b.seeming || '').trim())
        return res.status(400).json({ error: 'Обличье (Seeming) обязательно для феи' });

      const slug = slugify(name);
      if (!slug) return res.status(400).json({ error: 'Не удалось сформировать slug из имени' });
      const dir = path.join(charsDir(city), folder, slug);
      if (await fs.stat(dir).catch(() => null))
        return res.status(409).json({ error: `Персонаж «${slug}» уже существует в ${folder}` });

      // City display name from city.md H1
      let cityName = city;
      try {
        const cm = (await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8')).replace(/^﻿/, '');
        const m = cm.match(/^#\s+(.+)$/m);
        if (m) cityName = m[1].replace(/^[^\p{L}\p{N}]+/u, '').split(/[,—–-]/)[0].trim();
      } catch {}

      const one = v => String(v || '').replace(/\n+/g, ' ').trim();
      const gen = one(b.generation), by = one(b.birthYear), ey = one(b.embraceYear), sire = one(b.sire);
      const nature = one(b.nature), demeanor = one(b.demeanor), concept = one(b.concept);
      const seeming = one(b.seeming), court = one(b.court), house = one(b.house), role = one(b.role);
      const bio = one(b.biography), app_ = one(b.appearance);
      const belonging = one(b.belonging) || 'Персонаж мастера';
      const isFairy = folder === 'fairies';
      const hasNatureDemeanor = isVamp || folder === 'mortals' || isFairy;

      const fields = [
        `- **Слаг:** ${slug}`,
        `- **Родной город:** ${cityName}`,
        `- **Линейка WoD:** ${_LIN_WOD[folder]}`,
        `- **Пол:** ${gender}`,
        `- **${isVamp ? 'Клан' : 'Клан / Раса'}:** ${clan || '⚠️ Требуется уточнение'}`,
        `- **${isVamp ? 'Секта' : 'Секта / Двор'}:** ${sect || '⚠️ Требуется уточнение'}`,
      ];
      if (isVamp) {
        fields.push(`- **Поколение:** ${gen || '⚠️ Не указано'}`);
        fields.push(`- **Год рождения:** ${by || '⚠️ Не указан'}`);
        fields.push(`- **Год обращения:** ${ey || '⚠️ Не указан'}`);
        fields.push(`- **Сир:** ${sire || '⚠️ Не указан'}`);
      }
      if (isFairy) {
        fields.push(`- **Обличье:** ${seeming || '⚠️ Не указано'}`);
        if (court) fields.push(`- **Двор:** ${court}`);
        if (house) fields.push(`- **Дом:** ${house}`);
      }
      if (hasNatureDemeanor) {
        fields.push(`- **Натура:** ${nature || '⚠️ Не указана'}`);
        fields.push(`- **Маска:** ${demeanor || '⚠️ Не указана'}`);
      }
      if (isVamp) fields.push(`- **Амплуа:** ${concept || '⚠️ Не указано'}`);
      if (!isVamp && role) fields.push(`- **Роль:** ${role}`);
      fields.push(`- **Статус:** ${gender === 'Женский' ? 'Жива' : 'Жив'}`);
      fields.push(`- **Принадлежность:** ${belonging}`);
      fields.push(`- **Биография:** ${bio || '⚠️ Требуется уточнение'}`);
      fields.push(`- **Внешность:** ${app_ || '⚠️ Требуется уточнение (3–5 визуальных маркеров)'}`);
      fields.push(`- **Голос:** ⚠️ Требуется уточнение`);
      fields.push(`- **Отношения:**\n  - —`);
      fields.push(`- **🎨 Промт для генерации изображения:**\n  ⏳ Заполнить по system/rules/portret.md (3 блока)`);
      fields.push(`- **🚫 Негативный промт:**\n  photorealistic photography, anime, cartoon, watermark, text, blurry, deformed anatomy, extra limbs, bright white background, 3D render, CGI.`);

      const card = `# ${_LIN_EMOJI[folder]} ${name}\n\n> 🔗 [Все персонажи](../../../archive/characters_index.md)\n\n---\n\n${fields.join('\n')}\n\n---\n\n## 🖼️ Изображения\n- ⏳ Изображение не предоставлено\n`;

      await fs.mkdir(path.join(dir, 'art'), { recursive: true });
      await writeFileAtomic(path.join(dir, 'art', '.gitkeep'), '');
      await fs.mkdir(path.join(dir, 'journal'), { recursive: true });
      await writeFileAtomic(path.join(dir, 'journal', '.gitkeep'), '');
      await writeFileAtomic(path.join(dir, `${slug}.md`), card, 'utf-8');   // no BOM — clean cards

      // Standard sheet-data sidecar, seeded from the card fields just written — so
      // the «Лист V20» tab has something real to render immediately (not just the
      // in-memory empty default), and _syncSheetHeaderFromCard has a file to patch
      // the moment Поколение/Клан/Натура/etc. are next edited on «Информация».
      // Everything not seeded here (attributes, abilities, …) is filled client-side
      // by _v20Normalize() the same way it already handles any partial/legacy sheet.
      const sheetHeader = {
        name, player: '', chronicle: '',
        nature: hasNatureDemeanor ? nature : '',
        demeanor: hasNatureDemeanor ? demeanor : '',
        concept: isVamp ? concept : '',
        clan: isVamp ? clan : '',
        generation: isVamp ? gen : '',
        sire: isVamp ? sire : '',
      };
      await writeFileAtomic(path.join(dir, `${slug}-sheet.json`), JSON.stringify({ lineage: folder, header: sheetHeader }, null, 2), 'utf-8');

      // Append to characters_index.md (preserve its BOM if present)
      const idxPath = path.join(archiveDir(city), 'characters_index.md');
      const idxRaw  = await fs.readFile(idxPath, 'utf-8').catch(() => null);
      if (idxRaw !== null) {
        const bom = idxRaw.charCodeAt(0) === 0xFEFF;
        const body = (bom ? idxRaw.slice(1) : idxRaw).replace(/\s*$/, '') +
          `\n- [${name}](../characters/${folder}/${slug}/${slug}.md) — ${_LIN_WOD[folder]}${clan ? `, ${clan}` : ''}\n`;
        await writeFileAtomic(idxPath, (bom ? '﻿' : '') + body, 'utf-8');
      }

      invalidateChars(city);
      console.log(`[create-character] ${city}/${folder}/${slug}`);
      res.json({ ok: true, slug, name, lineage: folder });
    } catch (e) {
      console.error('[create-character]', e.message);
      serverError(res, e);
    }
  });

  router.get('/api/characters/:slug/delete-preview', async (req, res) => {
    try {
      const city = reqCity(req);
      const char = await _resolveChar(city, decodeURIComponent(req.params.slug));
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
      const { slug, lineageFolder } = char;
      const charDir = path.join(charsDir(city), lineageFolder, slug);
      const needle  = `${slug}/${slug}.md`;
      const nameRe  = char.name ? new RegExp(char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : null;

      const structural = [];   // broken hyperlinks → will be de-linked
      const prose = [];        // narrative name mentions → left intact
      const walkFiles = await _walkMd(cityDir(city), [charDir]);
      const scanned = await mapLimit(walkFiles, 24, async f => ({
        rel: path.relative(cityDir(city), f).replace(/\\/g, '/'),
        txt: await fs.readFile(f, 'utf-8').catch(() => ''),
      }));
      for (const { rel, txt } of scanned) {
        if (txt.includes(needle)) {
          if (!rel.endsWith('archive/characters_index.md')) structural.push(rel);
        } else if (nameRe && nameRe.test(txt) && /(journal\/|events\.md|chronicle\.md|\/modules\/)/.test(rel)) {
          prose.push(rel);
        }
      }
      const art = await fs.readdir(path.join(charDir, 'art'))
        .then(a => a.filter(x => /\.(png|jpe?g|webp|gif)$/i.test(x)).length).catch(() => 0);
      const hasSheet = await fs.access(path.join(charDir, `${slug}-sheet.md`)).then(() => true).catch(() => false);
      res.json({ name: char.name, slug, lineageFolder, art, hasSheet, structural, prose });
    } catch (e) { serverError(res, e); }
  });

  router.delete('/api/characters/:slug', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const char = await _resolveChar(city, decodeURIComponent(req.params.slug));
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
      const { slug, lineageFolder } = char;
      const srcDir = path.join(charsDir(city), lineageFolder, slug);
      if (!await fs.stat(srcDir).catch(() => null))
        return res.status(404).json({ error: 'Папка персонажа не найдена' });

      // 1. Archive the folder (rename keeps gitignored art; reversible).
      const trashRoot = path.join(charsDir(city), '_deleted');
      await fs.mkdir(trashRoot, { recursive: true });
      let dst = path.join(trashRoot, slug);
      if (await fs.stat(dst).catch(() => null)) dst = path.join(trashRoot, `${slug}_${Date.now().toString().slice(-6)}`);
      await fs.rename(srcDir, dst);

      // 2. Remove the index line(s).
      const idxPath = path.join(archiveDir(city), 'characters_index.md');
      try {
        const raw = await fs.readFile(idxPath, 'utf-8');
        const bom = raw.charCodeAt(0) === 0xFEFF;
        const kept = (bom ? raw.slice(1) : raw).split('\n')
          .filter(l => !l.includes(`/${lineageFolder}/${slug}/`)).join('\n');
        await writeFileAtomic(idxPath, (bom ? '﻿' : '') + kept, 'utf-8');
      } catch {}

      // 3. De-link broken structural references (keep name text; leave prose).
      const dlFiles = await _walkMd(cityDir(city), [trashRoot]);
      const dlScan  = await mapLimit(dlFiles, 24, async f => {
        if (path.basename(f) === 'characters_index.md') return null;
        const txt = await fs.readFile(f, 'utf-8').catch(() => null);
        if (txt == null || !txt.includes(`${slug}/${slug}.md`)) return null;
        const out = _delinkSlug(txt, slug);
        return out !== txt ? { f, out } : null;
      });
      const toDelink = dlScan.filter(Boolean);            // preserved walk order
      await mapLimit(toDelink, 24, ({ f, out }) => writeFileAtomic(f, out, 'utf-8'));
      const delinked = toDelink.map(({ f }) => path.relative(cityDir(city), f).replace(/\\/g, '/'));

      invalidateChars(city);
      runValidationBackground();
      console.log(`[delete-character] ${city}/${lineageFolder}/${slug} → _deleted (${delinked.length} files de-linked)`);
      res.json({ ok: true, slug, movedTo: `characters/_deleted/${path.basename(dst)}`, delinked });
    } catch (e) {
      console.error('[delete-character]', e.message);
      serverError(res, e);
    }
  });

  // ── List all art images for a character ───────────────────────────────────────

  router.get('/api/characters/:slug/images', async (req, res) => {
    try {
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'not found' });

      const artDir = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
      const files  = await fs.readdir(artDir).catch(() => []);
      const images = files
        .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
        .sort()
        .map(f => `/city-img/${city}/characters/${char.lineageFolder}/${encodeURIComponent(char.slug)}/art/${encodeURIComponent(f)}`);

      res.json({ images });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── Upload portrait image ─────────────────────────────────────────────────────

  router.post('/api/characters/:slug/upload-image', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const { base64, ext = 'jpg' } = req.body;
      const slug = decodeURIComponent(req.params.slug);

      const city  = reqCity(req);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const artDir  = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
      await fs.mkdir(artDir, { recursive: true });
      const safeExt = (ext || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';

      // Find next sequential number: slug_01, slug_02, …
      const existing = await fs.readdir(artDir).catch(() => []);
      const slugRe   = new RegExp(`^${char.slug}_(\\d+)\\.[a-z]+$`, 'i');
      const nums     = existing.map(f => { const m = slugRe.exec(f); return m ? parseInt(m[1], 10) : 0; });
      const nextNum  = (nums.length ? Math.max(...nums) : 0) + 1;
      const filename = `${char.slug}_${String(nextNum).padStart(2, '0')}.${safeExt}`;

      await writeFileAtomic(path.join(artDir, filename), Buffer.from(base64, 'base64'));

      // Update ## 🖼️ Изображения section in the card
      const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
      let card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
      if (card) {
        // Normalise CRLF first so the \n-based lookahead below always matches —
        // cards checked out on Windows (core.autocrlf) are CRLF on disk.
        card = card.replace(/\r\n/g, '\n');
        const newLine = `- [Образ ${nextNum}](art/${filename})`;
        if (card.includes('⏳ Изображение не предоставлено')) {
          card = card.replace('- ⏳ Изображение не предоставлено', newLine);
        } else {
          // Append inside ## 🖼️ Изображения section (before next ## or end of file)
          card = card.replace(/(## 🖼️ Изображения\n)([\s\S]*?)(\n##|\s*$)/, (_, hdr, body, tail) => {
            const trimmed = body.replace(/\n+$/, '');
            return `${hdr}${trimmed}\n${newLine}\n${tail}`;
          });
        }
        await writeFileAtomic(cardPath, card, 'utf-8');
      }

      invalidateChars(city);
      res.json({
        success: true,
        filename,
        url: `/city-img/${city}/characters/${char.lineageFolder}/${encodeURIComponent(char.slug)}/art/${encodeURIComponent(filename)}`
      });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── Delete character image ────────────────────────────────────────────────────

  router.delete('/api/characters/:slug/images/:filename', async (req, res) => {
    try {
      const slug     = decodeURIComponent(req.params.slug);
      const filename = decodeURIComponent(req.params.filename);
      const city     = reqCity(req);

      if (/[/\\]|^\./.test(filename)) {
        return res.status(400).json({ error: 'Недопустимое имя файла' });
      }

      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const artDir  = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
      const filePath = path.resolve(artDir, filename);
      if (!filePath.startsWith(path.resolve(artDir))) {
        return res.status(400).json({ error: 'Недопустимый путь' });
      }

      // Idempotent: a missing file on disk is not an error if we can still clean its
      // dangling reference from the card. Other unlink errors propagate to catch.
      const fileWasMissing = await fs.unlink(filePath)
        .then(() => false)
        .catch(e => { if (e.code === 'ENOENT') return true; throw e; });

      // Remove line referencing this file from ## 🖼️ Изображения
      const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
      let card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
      let refRemoved = false;
      if (card) {
        const before = card;
        card = card.split('\n').filter(l => !l.includes(`art/${filename}`)).join('\n');
        // If section empty — add placeholder
        card = card.replace(
          /(## 🖼️ Изображения\n)(\s*\n)((?!- ))/,
          '$1\n- ⏳ Изображение не предоставлено\n$3'
        );
        if (card !== before) { await writeFileAtomic(cardPath, card, 'utf-8'); refRemoved = true; }
      }

      // Genuine 404 only when the file was absent AND nothing referenced it.
      if (fileWasMissing && !refRemoved) {
        return res.status(404).json({ error: 'Файл не найден' });
      }

      invalidateChars(city);
      res.json({ ok: true, filename, fileWasMissing });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── Diary (journal/<period>.md) ────────────────────────────────────────────────

  router.get('/api/characters/:slug/diary', async (req, res) => {
    try {
      const slug = decodeURIComponent(req.params.slug);
      const file = req.query.file;
      if (!file) return res.status(400).json({ error: 'file param required' });

      const city  = reqCity(req);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const charDir  = path.resolve(charsDir(city), char.lineageFolder, char.slug);
      const filePath = path.resolve(charDir, file);
      if (!filePath.startsWith(charDir + path.sep) && filePath !== charDir)
        return res.status(403).json({ error: 'Forbidden' });

      const content = await fs.readFile(filePath, 'utf-8');
      res.json(parseDiary(content));
    } catch (e) { serverError(res, e); }
  });

  // Delete a diary entry file (journal/<period>.md) and drop its link from the card.
  router.delete('/api/characters/:slug/diary', async (req, res) => {
    try {
      const slug = decodeURIComponent(req.params.slug);
      const file = req.query.file;
      if (!file) return res.status(400).json({ error: 'file param required' });

      const city  = reqCity(req);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const charDir  = path.resolve(charsDir(city), char.lineageFolder, char.slug);
      const filePath = path.resolve(charDir, file);
      if (!filePath.startsWith(charDir + path.sep) && filePath !== charDir)
        return res.status(403).json({ error: 'Forbidden' });

      await fs.unlink(filePath).catch(() => {});
      await removeDiaryLink(city, char, file.replace(/^\/+/, ''));

      invalidateChars(city);
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  // Create or append a diary entry (journal/<period>.md), then link it from the card.
  router.put('/api/characters/:slug/diary', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const slug = decodeURIComponent(req.params.slug);
      const { period, session = '', text = '', mode = 'append' } = req.body || {};
      const per = String(period || '').trim();
      if (!/^(\d{4}-\d{2}|retrospective)$/.test(per)) return res.status(400).json({ error: 'Период: ГГГГ-ММ или retrospective' });
      if (!String(text).trim()) return res.status(400).json({ error: 'Пустой текст записи' });

      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const jdir = path.join(charsDir(city), char.lineageFolder, char.slug, 'journal');
      await fs.mkdir(jdir, { recursive: true });
      const file = path.join(jdir, `${per}.md`);

      const title   = String(session).trim() || periodLabel(per);
      const indented = String(text).trim().split('\n').map(l => l.trim() ? '  ' + l : '').join('\n');
      const section  = `### 📅 ${title}\n\n- **👤 Автор:** ${char.name}\n\n- **📖 Текст записи:**\n\n${indented}\n`;

      const existing = await fs.readFile(file, 'utf-8').catch(() => null);
      // 'replace' always overwrites — used when editing/regenerating an existing single-entry
      // record; 'create'/'append' (default) preserve the original add-entry-form behaviour.
      const out = (existing === null || mode === 'create' || mode === 'replace')
        ? `# 📖 Дневник ${char.name} — ${periodLabel(per)}\n\n---\n\n${section}`
        : existing.replace(/\s*$/, '') + `\n\n---\n\n${section}`;
      await writeFileAtomic(file, out, 'utf-8');

      const linkLabel = title !== periodLabel(per) ? `${periodLabel(per)} — ${title}` : periodLabel(per);
      if (mode === 'replace') await upsertDiaryLink(city, char, per, linkLabel);
      else await ensureDiaryLink(city, char, per, linkLabel);
      invalidateChars(city);
      res.json({ ok: true, file: `journal/${per}.md` });
    } catch (e) { serverError(res, e); }
  });

  // AI-generate diary prose for a character + period (not saved — returned for review).
  router.post('/api/characters/:slug/diary/generate', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const slug = decodeURIComponent(req.params.slug);
      const { period = '', session = '', hint = '', draft = '', orModel = null, preferSource = null } = req.body || {};

      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const gen = await makeGenerationClient(preferSource, orModel);

      const diaryRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'diary_rules.md'), 'utf-8').catch(() => '');
      const litStyle   = await loadLiteraryStyle();
      const card = await fs.readFile(path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`), 'utf-8').catch(() => '');
      let eventsText = '';
      try {
        const chrs = (await fs.readdir(chroniclesDir(city), { withFileTypes: true })).filter(e => e.isDirectory());
        // Sort newest-first by mtime — most relevant for recent diary entries
        const withMtime = await Promise.all(chrs.map(async e => {
          const st = await fs.stat(path.join(chroniclesDir(city), e.name)).catch(() => ({ mtimeMs: 0 }));
          return { name: e.name, mtime: st.mtimeMs };
        }));
        withMtime.sort((a, b) => b.mtime - a.mtime);
        const EVENTS_BUDGET = 8000;
        for (const { name } of withMtime) {
          if (eventsText.length >= EVENTS_BUDGET) break;
          const ev = await fs.readFile(path.join(chroniclesDir(city), name, 'events.md'), 'utf-8').catch(() => null);
          if (ev) eventsText += `\n### ${name}\n${ev.slice(0, Math.max(1500, EVENTS_BUDGET - eventsText.length))}`;
        }
      } catch {}

      const periodTxt = periodLabel(period) || period;
      const systemPrompt = `Ты — Рассказчик Vampire: The Masquerade V20. Пишешь литературную дневниковую запись от первого лица строго по правилам.
${litStyle ? `\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}\n` : ''}
# ПРАВИЛА ДНЕВНИКОВ
${diaryRules.slice(0, 4000)}

# КАРТОЧКА ПЕРСОНАЖА (голос, характер, факты)
${card.slice(0, 3000)}

# СОБЫТИЯ ХРОНИКИ (ИСТОЧНИК ФАКТОВ — не выдумывай вне этого)
${eventsText.slice(0, 8000) || '(не найдены)'}`;

      const draftTxt = String(draft || '').trim();
      const userPrompt = `Напиши дневниковую запись персонажа «${char.name}» за период ${periodTxt}${session ? ` (${session})` : ''}.
${hint ? `Акцент/пожелание: ${hint}\n` : ''}${draftTxt ? `\nЧерновик записи (уже существует, написан ранее — используй как базу, дополни и доработай стиль, сохраняя заданную канву и факты, не противоречь им):\n${draftTxt}\n` : ''}Требования:
- От первого лица, голосом персонажа (см. карточку).
- Только факты из событий хроники; канон не выдумывай.
${draftTxt ? '- Сохрани канву и факты черновика выше, углуби и доработай стиль/детали — не противоречь содержанию.\n' : ''}- Лаконично и литературно, по правилам diary_rules.md.
- Верни ТОЛЬКО текст записи (без заголовков и markdown-полей).`;

      const out = await genTextWithRetry(gen, { system: systemPrompt, user: userPrompt, maxTokens: 1200 });
      res.json({ ok: true, text: out.text, source: out.source });
    } catch (e) {
      const status = e.status ?? 500;
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: e.message ?? String(e) });
    }
  });

  // ── NPC in-character dialogue (AI) — Voice field + clan style from diary_rules ──

  // :id accepts either a real character's slug or a module-only NPC's display name
  // (module-listed NPCs have no slug — see _findModularNpcCard fallback below).
  router.post('/api/characters/:id/dialogue', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const id   = decodeURIComponent(req.params.id);
      const name = id;
      const situation = String(req.body?.situation || '').trim();
      const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 4, 1), 8);
      if (!situation) return res.status(400).json({ ok: false, error: 'Опиши ситуацию для реплик' });

      const chars = await getAllCharacters(city);
      let   char  = chars.find(c => c.slug === id) || chars.find(c => c.name === id) || chars.find(c => _nameMatch(c.name, id));
      let   card  = '';
      let   clan  = '';
      if (char) {
        card = await fs.readFile(path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`), 'utf-8').catch(() => '');
        clan = char.clan || '';
      } else if (req.body?.chr && req.body?.mod) {
        // Модульный (неканоничный) НПС — карточка лежит в папке npc/ модуля
        const npcRoot = path.join(chroniclesDir(city), String(req.body.chr), 'modules', String(req.body.mod), 'npc');
        const found = await _findModularNpcCard(npcRoot, name);
        if (found) { card = found.card; clan = found.clan; }
      }
      if (!card) return res.status(404).json({ ok: false, error: 'Персонаж не найден' });

      const diaryRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'diary_rules.md'), 'utf-8').catch(() => '');
      const stylesM    = diaryRules.match(/##\s*🎭\s*Правила литературной стилизации[\s\S]*?(?=\n##\s|\s*$)/);
      const styles     = stylesM ? stylesM[0] : diaryRules.slice(0, 2500);
      const litStyle   = await loadLiteraryStyle();

      const gen = await makeGenerationClient(req.body?.source || null, req.body?.model || null);
      const systemPrompt = `Ты пишешь РЕПЛИКИ НПС в характере для Vampire: The Masquerade V20.
Говори ГОЛОСОМ персонажа (поле «Голос» в карточке) и в КЛАНОВОМ СТИЛЕ — строка его клана «${clan || '—'}» в таблице ниже.
Маскарад: вампирскую природу/дисциплины — только намёками и метафорами. Не выдумывай факты вне карточки. Русский язык.
${litStyle ? `\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}\n` : ''}
# КАРТОЧКА ПЕРСОНАЖА (голос, клан, характер, факты)
${card.slice(0, 3000)}

# КЛАНОВЫЕ / ТИПОВЫЕ СТИЛИ (diary_rules.md)
${styles.slice(0, 2000)}`;

      const userPrompt = `Ситуация: ${situation}

Сгенерируй ${count} реплик(и) НПС «${name}» в этой ситуации — в его характере, голосе и клановом стиле.
Каждая реплика с новой строки, в кавычках «…». Допустима краткая ремарка действия в скобках. Без нумерации, без пояснений вне реплик.`;

      const out = await genTextWithRetry(gen, { system: systemPrompt, user: userPrompt, maxTokens: 900 });
      res.json({ ok: true, text: out.text, source: out.source });
    } catch (e) {
      const status = e.status ?? 500;
      const msg = status === 429
        ? 'Лимит запросов исчерпан (Claude и резервный OpenRouter). Подожди минуту или выбери OpenRouter в «⚡ Назначение провайдеров → Генерация фраз».'
        : (e.message ?? String(e));
      res.status(status >= 400 && status < 600 ? status : 500).json({ ok: false, error: msg });
    }
  });

  // ── C4 — V20 character sheet (<slug>-sheet.md next to the card) ───────────────

  router.get('/api/characters/:slug/sheet', async (req, res) => {
    try {
      const city  = reqCity(req);
      const slug  = decodeURIComponent(req.params.slug);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
      const file = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}-sheet.md`);
      const content = await fs.readFile(file, 'utf-8').catch(() => null);
      res.json({ exists: content !== null, content: content || '' });
    } catch (e) { serverError(res, e); }
  });

  // Generate (or regenerate) a canonical character's sheet
  router.post('/api/characters/:slug/sheet/generate', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city  = reqCity(req);
      const slug  = decodeURIComponent(req.params.slug);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ ok: false, error: 'Персонаж не найден' });
      const dir  = path.join(charsDir(city), char.lineageFolder, char.slug);
      const card = await fs.readFile(path.join(dir, `${char.slug}.md`), 'utf-8').catch(() => '');
      if (!card) return res.status(404).json({ ok: false, error: 'Карточка персонажа не найдена' });
      const gen  = await makeGenerationClient(req.body?.source || null, req.body?.model || null);
      let text = await generateV20Sheet({ card, displayName: char.name, gen, lineage: char.lineageFolder });
      if (!text) return res.status(500).json({ ok: false, error: 'ИИ вернул пустой лист' });
      // Re-stamp header fields already known from the card — the AI is given the card
      // text but can still paraphrase/invent name·clan·generation·sire; force them back
      // to the card's own values so the sheet never disagrees with «Информация».
      for (const [key, label] of Object.entries(SHEET_HEADER_FROM_CARD)) {
        const v = String(char[key] || '').trim();
        if (v && !v.includes('⚠️')) text = _setSheetHeaderCell(text, label, v);
      }
      await writeFileAtomic(path.join(dir, `${char.slug}-sheet.md`), text + '\n', 'utf-8');
      await ensureSheetLink(path.join(dir, `${char.slug}.md`), `${char.slug}-sheet.md`);
      res.json({ ok: true, content: text });
    } catch (e) { res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ ok: false, error: e.message }); }
  });

  // Save an edited canonical sheet (raw markdown from the editor)
  router.put('/api/characters/:slug/sheet', express.json(), async (req, res) => {
    try {
      const city  = reqCity(req);
      const slug  = decodeURIComponent(req.params.slug);
      const content = String(req.body?.content || '');
      if (!content.trim()) return res.status(400).json({ ok: false, error: 'Пустой лист' });
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ ok: false, error: 'Персонаж не найден' });
      const dir = path.join(charsDir(city), char.lineageFolder, char.slug);
      await writeFileAtomic(path.join(dir, `${char.slug}-sheet.md`), content.replace(/\s*$/, '') + '\n', 'utf-8');
      await ensureSheetLink(path.join(dir, `${char.slug}.md`), `${char.slug}-sheet.md`);
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  // ── Structured V20 sheet data (JSON sidecar) ──────────────────────────────────
  // Source of truth for the interactive blank on the «Лист V20» tab. Falls back to
  // parsing the AI markdown sheet (client-side) when no JSON exists yet, or when
  // ?fromMd=1 forces a reseed after an AI (re)generation.
  router.get('/api/characters/:slug/sheet-data', async (req, res) => {
    try {
      const city  = reqCity(req);
      const slug  = decodeURIComponent(req.params.slug);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
      const dir   = path.join(charsDir(city), char.lineageFolder, char.slug);
      const fromMd = req.query.fromMd === '1';
      if (!fromMd) {
        const raw = await fs.readFile(path.join(dir, `${char.slug}-sheet.json`), 'utf-8').catch(() => null);
        if (raw) { try { return res.json({ exists: true, source: 'json', lineage: char.lineageFolder, data: JSON.parse(raw) }); } catch { /* corrupt → fall through to md */ } }
      }
      const md = await fs.readFile(path.join(dir, `${char.slug}-sheet.md`), 'utf-8').catch(() => null);
      res.json({ exists: md !== null, source: md ? 'md' : 'empty', lineage: char.lineageFolder, md: md || '' });
    } catch (e) { serverError(res, e); }
  });

  router.put('/api/characters/:slug/sheet-data', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const city  = reqCity(req);
      const slug  = decodeURIComponent(req.params.slug);
      const data  = req.body?.data;
      if (!data || typeof data !== 'object') return res.status(400).json({ ok: false, error: 'Нет данных листа' });
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ ok: false, error: 'Персонаж не найден' });
      const dir   = path.join(charsDir(city), char.lineageFolder, char.slug);
      await writeFileAtomic(path.join(dir, `${char.slug}-sheet.json`), JSON.stringify(data, null, 2), 'utf-8');
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  // ── Foundry sync (Фаза 1, вариант c — см. docs/superpowers/specs/
  // 2026-07-08-foundry-integration-design.md): экспорт/импорт JSON через штатный
  // Foundry Export/Import Data, без прямого доступа к LevelDB. Только вампиры.
  router.get('/api/characters/:slug/export-foundry', async (req, res) => {
    try {
      const city  = reqCity(req);
      const slug  = decodeURIComponent(req.params.slug);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
      if (!FOUNDRY_SUPPORTED_LINEAGES.includes(char.lineage)) return res.status(400).json({ error: 'Экспорт в Foundry пока поддержан только для вампиров и смертных' });
      const dir = path.join(charsDir(city), char.lineageFolder, char.slug);
      const raw = await fs.readFile(path.join(dir, `${char.slug}-sheet.json`), 'utf-8').catch(() => null);
      const sheetData = raw ? JSON.parse(raw) : {};
      const actor = mapCharacterToFoundryActor(char, sheetData);
      res.setHeader('Content-Disposition', `attachment; filename="foundry_${char.slug}.json"`);
      res.json(actor);
    } catch (e) { serverError(res, e); }
  });

  // Массовый экспорт — по выбору карточек на странице персонажей (см. спеку раздел 5).
  // Один Actor JSON на персонажа внутри ZIP (Foundry Import Data принимает по одному
  // Actor'у за раз на листе конкретного персонажа, так что бандл остаётся набором
  // отдельных файлов, не единым массивом).
  router.post('/api/characters/export-foundry-bulk', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const city = reqCity(req);
      const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs : [];
      if (!slugs.length) return res.status(400).json({ error: 'Не выбрано ни одного персонажа' });

      const chars = await getAllCharacters(city);
      const files = [];
      for (const slug of slugs) {
        const char = chars.find(c => c.slug === slug);
        if (!char || !FOUNDRY_SUPPORTED_LINEAGES.includes(char.lineage)) continue;
        try {
          const dir = path.join(charsDir(city), char.lineageFolder, char.slug);
          const raw = await fs.readFile(path.join(dir, `${char.slug}-sheet.json`), 'utf-8').catch(() => null);
          const sheetData = raw ? JSON.parse(raw) : {};
          const actor = mapCharacterToFoundryActor(char, sheetData);
          files.push({ name: `foundry_${char.slug}.json`, data: JSON.stringify(actor, null, 2) });
        } catch {
          // Один повреждённый -sheet.json не должен ронять весь массовый экспорт —
          // пропускаем этого персонажа, остальные всё равно попадут в ZIP.
          continue;
        }
      }
      if (!files.length) return res.status(400).json({ error: 'Ни один из выбранных персонажей не поддержан (только вампиры и смертные)' });

      const zipBuf = createZip(files);
      const dateStamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="foundry_export_${city}_${dateStamp}.zip"`);
      res.send(zipBuf);
    } catch (e) { serverError(res, e); }
  });

  router.post('/api/characters/:slug/import-foundry', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const city  = reqCity(req);
      const slug  = decodeURIComponent(req.params.slug);
      const actor = req.body?.actor;
      if (!actor || typeof actor !== 'object') return res.status(400).json({ error: 'Нет данных Foundry Actor (ожидалось поле actor)' });
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
      // Vampire/Mortal — единственные типы, которые вообще может создать наш собственный
      // экспортёр; при несовпадении с линейкой персонажа отказываем, а не тихо затираем
      // лист чужими полями (напр. Mortal-экспорт поверх вампира обнулил бы запас крови).
      const EXPECTED_ACTOR_TYPE = { vampire: 'Vampire', mortal: 'Mortal' };
      const expectedType = EXPECTED_ACTOR_TYPE[char.lineage];
      if (expectedType && actor.type && actor.type !== expectedType) {
        return res.status(400).json({ error: `Тип Foundry Actor «${actor.type}» не соответствует линейке персонажа (ожидался «${expectedType}»)` });
      }
      const dir = path.join(charsDir(city), char.lineageFolder, char.slug);
      const raw = await fs.readFile(path.join(dir, `${char.slug}-sheet.json`), 'utf-8').catch(() => null);
      const existing = raw ? JSON.parse(raw) : {};
      const { sheetData, cardFields } = mapFoundryActorToSheetData(actor, existing);
      await writeFileAtomic(path.join(dir, `${char.slug}-sheet.json`), JSON.stringify(sheetData, null, 2), 'utf-8');
      res.json({ ok: true, cardFields });
    } catch (e) { serverError(res, e); }
  });

  return router;
};

// Add a [label](journal/<period>.md) link to the card's "📖 Дневники" field if absent.
async function ensureDiaryLink(city, char, period, label) {
  const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
  let card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
  if (card === null) return;
  const href = `journal/${period}.md`;
  if (card.includes(href)) return;                       // already linked
  const link = `[${label}](${href})`;
  const fieldRe = /^- \*\*📖 Дневники:\*\*\s*(.*)$/m;
  if (fieldRe.test(card)) {
    card = card.replace(fieldRe, (_, cur) => `- **📖 Дневники:** ${cur.trim() ? cur.trim() + ' · ' + link : link}`);
  } else {
    // Insert after the last "- **Field:**" metadata bullet
    const lastM = [...card.matchAll(/^- \*\*[^*:\n]+[^*]*:\*\*\s*.+$/gm)].at(-1);
    const line = `- **📖 Дневники:** ${link}`;
    if (lastM) { const pos = lastM.index + lastM[0].length; card = card.slice(0, pos) + '\n' + line + card.slice(pos); }
    else return;
  }
  await writeFileAtomic(cardPath, card, 'utf-8');
}

// Like ensureDiaryLink, but replaces an existing link's label instead of leaving it
// untouched — used when an entry is edited/regenerated and its title may have changed.
async function upsertDiaryLink(city, char, period, label) {
  const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
  let card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
  if (card === null) return;
  const href = `journal/${period}.md`;
  const link = `[${label}](${href})`;
  const fieldRe = /^- \*\*📖 Дневники:\*\*\s*(.*)$/m;
  const fm = card.match(fieldRe);
  if (fm) {
    const hrefEsc = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkRe = new RegExp(`\\[[^\\]]*\\]\\(${hrefEsc}\\)`);
    card = linkRe.test(fm[1])
      ? card.replace(fieldRe, `- **📖 Дневники:** ${fm[1].replace(linkRe, link)}`)
      : card.replace(fieldRe, `- **📖 Дневники:** ${fm[1].trim() ? fm[1].trim() + ' · ' + link : link}`);
  } else {
    const lastM = [...card.matchAll(/^- \*\*[^*:\n]+[^*]*:\*\*\s*.+$/gm)].at(-1);
    const line = `- **📖 Дневники:** ${link}`;
    if (lastM) { const pos = lastM.index + lastM[0].length; card = card.slice(0, pos) + '\n' + line + card.slice(pos); }
    else return;
  }
  await writeFileAtomic(cardPath, card, 'utf-8');
}

// Remove a [label](journal/<period>.md) link from the card's "📖 Дневники" field —
// drops the whole field line if it was the last link.
async function removeDiaryLink(city, char, href) {
  const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
  let card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
  if (card === null) return;
  const fieldRe = /^- \*\*📖 Дневники:\*\*\s*(.*)$/m;
  const fm = card.match(fieldRe);
  if (!fm) return;
  const hrefEsc = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRe = new RegExp(`\\s*·?\\s*\\[[^\\]]*\\]\\(${hrefEsc}\\)`);
  const rest = fm[1].replace(linkRe, '').replace(/^\s*·\s*/, '').trim();
  card = rest
    ? card.replace(fieldRe, `- **📖 Дневники:** ${rest}`)
    : card.replace(/^- \*\*📖 Дневники:\*\*\s*.*\n?/m, '');
  await writeFileAtomic(cardPath, card, 'utf-8');
}
