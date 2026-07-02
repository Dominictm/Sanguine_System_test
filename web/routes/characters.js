'use strict';
// Роутер персонажей: список, арты (все изображения / по персонажу), правка полей
// и отношений, создание карточки, soft-delete с де-линковкой ссылок,
// загрузка/удаление изображений.
// Фабрика с DI: runValidationBackground приходит из server.js при монтировании —
// фоновая валидация ссылок пока живёт там (E1.2). AI-генерация (generate-*),
// дневники, диалоги и листы остаются в server.js.

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError } = require('../lib/http');
const {
  cityDir, charsDir, archiveDir, reqCity, writeFileAtomic, invalidateChars,
  getAllCharacters, mapLimit,
  EDITABLE_FIELD_MAP, SHEET_HEADER_FROM_CARD, _setSheetHeaderCell,
} = require('../lib/db');
const { slugify, writePrompt } = require('../lib/parsers');

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

// Фабрика: server.js передаёт runValidationBackground при монтировании.
module.exports = function charactersRouter({ runValidationBackground }) {
  const router = express.Router();

  router.get('/api/characters', async (req, res) => {
    try { res.json(await getAllCharacters(reqCity(req))); }
    catch (e) { serverError(res, e); }
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

  return router;
};
