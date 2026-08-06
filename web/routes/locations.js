'use strict';
// Роутер локаций: список, арты, правка полей, загрузка изображений, создание
// (с опциональной AI-генерацией карточки), soft-delete, AI-генерация полей.
// Фабрика с DI: AI-хелперы (makeGenerationClient, isOA, oaCall) приходят из
// server.js при монтировании — сам AI-слой пока живёт там (E1.2).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError, aiRateLimit, _logAiCall, _logAiFail, validateImageUpload } = require('../lib/http');
const {
  ROOT, reqCity, locsDir, cityDir, writeFileAtomic, invalidateLocs,
  getAllLocations, findLocMdPath,
} = require('../lib/db');
const { updateMdLinks, findMdLinks } = require('../lib/md_links');
const { slugify, writePrompt, parseLocation, sanitizeInlineText, parseDistrictMd, DISTRICT_FILENAME } = require('../lib/parsers');
const { buildCityConstraints } = require('../lib/context_builder');
const { unlinkLocationFromAllModules } = require('./modules/shared');

// ── Location card template (standalone) ──────────────────────────────────────
function _locCardTemplate(name, district) {
  return `# ${name}
> **Название:** ${name} | **Район:** ${district || '[район]'} | **Дополнение к адресу:** [доп. к адресу] | **Адрес:** [адрес] | **Зона:** [📍 Локация] | **Опасность:** [🟢/🟡/🔴] | **Контроль:** [фракция]
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
## 🩸 VtM-контекст / Маскарад
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
module.exports = function locationsRouter({ makeGenerationClient, genTextWithRetry }) {
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
          // Update inline metadata field **Название:** — this line is a single
          // pipe-separated row (all fields on one line, not a real table), so a
          // literal '|' here isn't escapable/reversible the way a table cell is —
          // fold it to a lookalike instead (FIX-2, docs/audit/2026-07-28-fix-plan.md).
          card = card.replace(
            /(\*\*Название:\*\*)\s*([^|\n]+?)(?=\s*\||\s*\n|$)/m,
            `$1 ${sanitizeInlineText(value).replace(/\|/g, '∣')}`
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
          // Обязательные каналы (§C3, техспека 2026-08-04) — Свет/Звук/Запах нельзя
          // УДАЛИТЬ, если они УЖЕ есть в карточке (пустое значение — можно, отсутствие
          // строки — нет). UI больше не даёт кнопку удаления для этих трёх, но это лишь
          // клиентская защита — тот же PUT доступен и напрямую, проверяем ещё раз здесь.
          // Требование — только для каналов, что уже были: 3 реальные локации в данных
          // используют алиасы («Зрение»/«Прикосновение» вместо «Свет»/«Тактильное»,
          // location-card-modal-plan.md §2.1, нормализация вне скоупа) — им ничего не
          // навязываем, иначе редактирование ЛЮБОГО их канала стало бы невозможным.
          const sectionM = card.match(/## (?:👁️\s+)?Сенсорная палитра[^\n]*\n+([\s\S]+?)(?:\n## |\n---|$)/i);
          const before = sectionM ? sectionM[1] : '';
          const missing = ['Свет', 'Звук', 'Запах']
            .filter(ch => new RegExp(`\\*\\*${ch}\\*\\*`).test(before))
            .filter(ch => !new RegExp(`\\*\\*${ch}\\*\\*`).test(value));
          if (missing.length) {
            return res.status(400).json({ error: `Обязательные каналы сенсорики нельзя удалить: ${missing.join(', ')}` });
          }
          card = card.replace(
            /(## (?:👁️\s+)?Сенсорная палитра[^\n]*\n+)([\s\S]+?)(\n## |\n---|$)/i,
            (_, hdr, _old, tail) => `${hdr}${value}\n${tail}`
          );
          continue;
        }
        if (key === 'vtmTable') {
          // Табличные VtM-поля (Статус/Фракция/Постоянные фигуры/Угрозы/Маскарад) — строки
          // markdown-таблицы внутри секции VtM-контекста, не инлайн-метаданные вида
          // **Ключ:**, поэтому fieldMap ниже сюда не подходит (техспека §13.3). Построчная
          // сборка (не regex-подстановка целиком) — чтобы точно не задвоить/не потерять
          // переносы строк на границе последней строки таблицы и следующего «## »/«---».
          // rawValue — объект { locStatus?, faction?, figures?, threats?, masquerade? };
          // пустое значение стирает строку таблицы целиком (симметрично vtmText выше).
          const tableFields = (rawValue && typeof rawValue === 'object') ? rawValue : {};
          card = card.replace(
            /(## (?:🩸\s+)?(?:VtM[^\n]*|Контекст[^\n]*)\n+)([\s\S]+?)(\n## |\n---|$)/i,
            (_, hdr, body, tail) => {
              const LABELS = { locStatus: 'Статус', faction: 'Фракция', figures: 'Постоянные фигуры', threats: 'Угрозы', masquerade: 'Маскарад' };
              const lines = body.split('\n');
              for (const [k, label] of Object.entries(LABELS)) {
                if (!(k in tableFields)) continue;
                const cellVal = sanitizeInlineText(String(tableFields[k] ?? '').trim()).replace(/\|/g, '∣');
                const rowRe = new RegExp(`^\\|\\s*\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*\\s*\\|`);
                const idx = lines.findIndex(l => rowRe.test(l));
                if (!cellVal) { if (idx !== -1) lines.splice(idx, 1); continue; }
                const row = `| **${label}** | ${cellVal} |`;
                if (idx !== -1) lines[idx] = row; else lines.push(row);
              }
              return `${hdr}${lines.join('\n')}${tail}`;
            }
          );
          continue;
        }
        if (key === 'privateDomain') {
          // «Частный домен» (2026-08-06, план «карточка локации» §3.4) — новый бюллет,
          // не входит в _locCardTemplate() ниже, значит у СУЩЕСТВУЮЩИХ карточек его
          // ещё нет нигде в файле. Generic fieldMap-путь ниже только ЗАМЕНЯЕТ уже
          // существующее вхождение **Label:** — если строки вообще нет, regex не
          // совпадёт и значение молча не запишется (та же ловушка, что была с VtM-
          // таблицей, см. techspec §7.1/§3.1). Insert-if-missing: дописываем в конец
          // первой строки-цитаты с метаданными (там же Зона/Опасность/Контроль),
          // не отдельным бюллетом — единообразно с форматом шаблона.
          const label = 'Частный домен';
          const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`(\\*\\*${esc}:\\*\\*)\\s*([^|\\n]+?)(?=\\s*\\||\\s*\\n|$)`, 'm');
          if (re.test(card)) {
            card = card.replace(re, `$1 ${sanitizeInlineText(value).replace(/\|/g, '∣')}`);
          } else if (value) {
            card = card.replace(/^(>.*)$/m, `$1 | **${label}:** ${sanitizeInlineText(value).replace(/\|/g, '∣')}`);
          }
          continue;
        }
        // Inline metadata fields — same one-line-pipe-row shape as «Название» above.
        const fieldMap = { district: 'Район', neighborhood: 'Дополнение к адресу', address: 'Адрес', control: 'Контроль', zone: 'Зона', dangerLevel: 'Опасность' };
        const mdKey = fieldMap[key];
        if (mdKey) {
          const esc = mdKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          card = card.replace(
            new RegExp(`(\\*\\*${esc}:\\*\\*)\\s*([^|\\n]+?)(?=\\s*\\||\\s*\\n|$)`, 'm'),
            `$1 ${sanitizeInlineText(value).replace(/\|/g, '∣')}`
          );
        }
      }

      await writeFileAtomic(mdPath, card, 'utf-8');
      invalidateLocs(city);
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  // ── PUT /api/locations/:slug/district — привязать локацию к району ────────────
  // Отдельно от PUT /fields намеренно (техспека §9.2) — это не инлайн-метаданные, это
  // операция с физическим побочным эффектом (fs.rename папки локации целиком, включая
  // gitignored art/ — тот же вывод, что уже подтверждён на миграции округ→район).
  router.put('/api/locations/:slug/district', express.json(), async (req, res) => {
    try {
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);
      const districtSlug = slugify(String(req.body?.district || '').trim());
      if (!districtSlug) return res.status(400).json({ error: 'Укажи район' });

      const mdPath = await findLocMdPath(slug, city);
      if (!mdPath) return res.status(404).json({ error: 'Локация не найдена' });

      const locRoot   = locsDir(city);
      const oldLocDir = path.dirname(mdPath);
      const oldDistrictSlug = path.basename(path.dirname(oldLocDir));
      if (oldDistrictSlug === districtSlug) {
        return res.json({ ok: true, movedFrom: null, movedTo: null }); // §9.3 — перенос в тот же район, no-op
      }

      const newLocDir = path.join(locRoot, districtSlug, path.basename(oldLocDir));
      if (await fs.stat(newLocDir).catch(() => null))
        return res.status(409).json({ error: `В районе «${districtSlug}» уже есть локация с таким именем папки` });

      await fs.mkdir(path.dirname(newLocDir), { recursive: true });
      await fs.rename(oldLocDir, newLocDir);

      // Район — читаем «Название» из district.md, если район уже заведён как сущность;
      // иначе (район ещё не формальная сущность — POST /api/locations терпим к этому же
      // случаю) записываем сам slug как текст, лучше, чем оставить старое значение.
      const districtMdRaw = await fs.readFile(path.join(newLocDir, '..', DISTRICT_FILENAME), 'utf-8').catch(() => null);
      const districtDisplay = districtMdRaw ? (parseDistrictMd(districtMdRaw).name || districtSlug) : districtSlug;

      const newMdPath = path.join(newLocDir, path.basename(mdPath));
      let card = await fs.readFile(newMdPath, 'utf-8');
      card = card.replace(
        /(\*\*Район:\*\*)\s*([^|\n]+?)(?=\s*\||\s*\n|$)/m,
        `$1 ${sanitizeInlineText(districtDisplay).replace(/\|/g, '∣')}`
      );
      await writeFileAtomic(newMdPath, card, 'utf-8');

      const movedFrom = path.relative(locRoot, oldLocDir).split(path.sep).join('/');
      const movedTo   = path.relative(locRoot, newLocDir).split(path.sep).join('/');

      // Ссылки на переехавшую карточку (из модулей/хроник/архива) — иначе они молча
      // становятся битыми: папка уехала, а «[Склад](../../locations/villet/…)» остался
      // (§B1). Глубина вложенности при переносе не меняется, поэтому ИСХОДЯЩИЕ ссылки
      // внутри самой карточки трогать не нужно — только входящие.
      // Non-blocking: перенос уже произошёл и не откатывается из-за сбоя правки чужого
      // файла — тот же паттерн, что у _syncCityFactionsList (§11).
      let linksUpdated = 0, linkWarning = null;
      try {
        linksUpdated = updateMdLinks(cityDir(city), [{ oldRel: movedFrom, newRel: movedTo }]).filesChanged;
      } catch (e) {
        linkWarning = `Локация перенесена, но ссылки на неё обновить не удалось: ${e.message}`;
        console.error('[move-location] fix-links', e.message);
      }

      invalidateLocs(city);
      res.json({
        ok: true, movedFrom, movedTo, linksUpdated,
        ...(linkWarning ? { warning: linkWarning } : {}),
      });
    } catch (e) { serverError(res, e); }
  });

  router.post('/api/locations/:slug/upload-image', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const { base64, ext = 'jpg' } = req.body;
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);

      const mdPath = await findLocMdPath(slug, city);
      if (!mdPath) return res.status(404).json({ error: 'Локация не найдена' });

      const validated = validateImageUpload(base64, ext);
      if (!validated.ok) return res.status(400).json({ error: validated.error });
      const safeExt = validated.ext;

      const locFolder = path.dirname(mdPath);
      const artDir    = path.join(locFolder, 'art');
      await fs.mkdir(artDir, { recursive: true });

      const existing = await fs.readdir(artDir).catch(() => []);
      const slugRe   = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)\\.[a-z]+$`, 'i');
      const nums     = existing.map(f => { const m = slugRe.exec(f); return m ? parseInt(m[1], 10) : 0; }).filter(n => n > 0);
      const nextNum  = (nums.length ? Math.max(...nums) : 0) + 1;
      const filename = `${slug}_${String(nextNum).padStart(2, '0')}.${safeExt}`;

      await writeFileAtomic(path.join(artDir, filename), validated.buffer);

      let card = await fs.readFile(mdPath, 'utf-8').catch(() => null);
      if (card) {
        // Normalise CRLF first so the \n-based lookahead below always matches —
        // cards checked out on Windows (core.autocrlf) are CRLF on disk.
        card = card.replace(/\r\n/g, '\n');
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

      const distFolder = slugify(district) || 'Другие';
      const locDir  = path.join(locsDir(city), distFolder, locSlug);
      const locFile = path.join(locDir, `${locSlug}.md`);

      if (await fs.stat(locFile).catch(() => null))
        return res.status(409).json({ error: 'Локация уже существует', slug: locSlug });

      // Техспека §16.3 — slug локации обязан быть уникален по ВСЕМУ городу, не только
      // внутри целевого района: findLocMdPath() (PUT /fields, DELETE, upload-image,
      // PUT /district) резолвит по голому slug и при дубликате в другом районе
      // возвращает первое совпадение по обходу файловой системы — недетерминированно
      // относительно того, какую карточку на самом деле имел в виду вызывающий.
      // Явная ошибка здесь дешевле, чем резолвинг по полному пути везде (техспека §16.3
      // — вариант (b) отклонён), и не меняет поведение уже созданных карточек:
      // проверка стоит только на создании, задним числом ничего не ломает.
      const otherDistrictConflict = (await getAllLocations(city)).find(l => l.slug === locSlug);
      if (otherDistrictConflict) {
        const conflictDistrict = otherDistrictConflict.district
          || (otherDistrictConflict.dirRelPath || '').split('/')[0]
          || 'другом районе';
        return res.status(409).json({
          error: `Локация «${locName}» уже существует в районе «${conflictDistrict}» — выбери другое название`,
          slug: locSlug,
        });
      }

      await fs.mkdir(locDir, { recursive: true });

      let content = _locCardTemplate(locName, district?.trim() || '');

      if (generate) {
        let genForLog = null;
        try {
          const gen = await makeGenerationClient(source, modelOvr).catch(() => null);
          genForLog = gen;
          if (gen) _logAiCall(`locations/create: ${locName}`, gen);
          const portretRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'portret.md'), 'utf-8').catch(() => '');
          const prompt = `Создай карточку локации «${locName}» для Vampire: The Masquerade V20, ${city || 'Париж'} 2010.

${buildCityConstraints(city)}

Контекст сцены: ${context || '(без контекста)'}
Район: ${district?.trim() || '(не указан)'}

Правила оформления:
${portretRules.slice(0, 900)}

Шаблон:
${_locCardTemplate(locName, district?.trim() || '')}

Заполни шаблон полностью. Верни только Markdown-карточку без лишнего текста.
Язык: русский. Стиль: готический нуар VtM.`;

          const raw = gen ? (await genTextWithRetry(gen, { system: '', user: prompt, maxTokens: 1300 })).text : '';
          if (raw.trim()) content = raw.trim() + '\n';
        } catch (genErr) {
          _logAiFail(`locations/create: ${locName}`, genErr, genForLog);
        }
      }

      await writeFileAtomic(locFile, content, 'utf-8');
      invalidateLocs(city);
      res.json({ ok: true, slug: locSlug, district: distFolder });
    } catch (e) { serverError(res, e); }
  });

  // ── GET /api/locations/:slug/backlinks — кто ссылается на эту локацию (§B2) ────
  // Цель удаления не восстановить обратно (в отличие от переноса, §B1) — при DELETE
  // автоподстановка нового пути невозможна, снимать ссылку молча означало бы стирать
  // информацию без ведома Рассказчика. Read-only, для предупреждения ПЕРЕД удалением.
  router.get('/api/locations/:slug/backlinks', async (req, res) => {
    try {
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);
      const mdPath = await findLocMdPath(slug, city);
      if (!mdPath) return res.status(404).json({ error: 'Локация не найдена' });
      const rel = path.relative(locsDir(city), path.dirname(mdPath)).split(path.sep).join('/');
      res.json(findMdLinks(cityDir(city), rel));
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

      const unlinkedFrom = await unlinkLocationFromAllModules(city, slug);

      console.log(`[delete-location] ${city}/${slug} → locations/_deleted/${path.basename(dst)}`);
      res.json({ ok: true, movedTo: `locations/_deleted/${path.basename(dst)}`, unlinkedFrom });
    } catch (e) { serverError(res, e); }
  });

  // ── POST /api/locations/generate — AI full-card or single-field generation ────
  router.post('/api/locations/generate', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { slug, name, field, channel, card, context, source, model: modelOvr } = req.body || {};

      const locName = name?.trim() || slug || '';
      if (!locName) return res.status(400).json({ error: 'name или slug обязателен' });

      const gen = await makeGenerationClient(source, modelOvr);
      _logAiCall(`locations/generate: ${locName}${field ? ` (${field})` : ''}`, gen);
      const portretRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'portret.md'), 'utf-8').catch(() => '');

      let prompt, maxTok;

      if (field === 'sensory') {
        const ch = String(channel || '').trim() || 'Свет';
        prompt = `Напиши сенсорную деталь для канала «${ch}» локации «${locName}» в Vampire: The Masquerade V20 (готический нуар, атмосферно, 1-2 коротких предложения)${context ? `. Контекст локации: ${context}` : ''}. Верни только текст значения — без названия канала, без кавычек, без markdown-разметки.`;
        maxTok = 150;
      } else if (field) {
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

${buildCityConstraints(city)}

Контекст: ${context || '(нет)'}

Правила:
${portretRules.slice(0, 900)}

${currentCard ? `Текущий вариант:\n${String(currentCard).slice(0, 600)}\n\n` : ''}Шаблон:
${_locCardTemplate(locName)}

Заполни полностью. Верни только Markdown без лишнего текста. Язык: русский, стиль: готический нуар VtM.`;
        maxTok = 1400;
      }

      const result = (await genTextWithRetry(gen, { system: '', user: prompt, maxTokens: maxTok })).text;

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
