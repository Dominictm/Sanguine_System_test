'use strict';
// Роутер городов (доменов): список, сводка, деталь, создание, правка, удаление.
// Включает синк «Политического ландшафта» city.md с archive/political_state.md.
// Вынесено из server.js (E1.2).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError } = require('../lib/http');
const {
  ROOT, CITIES_DIR, DEFAULT_CITY, cityDir, locsDir,
  listCities, writeFileAtomic, invalidateChars,
  getAllCharacters, listModules, countMdFiles,
} = require('../lib/db');
const { slugify, buildCityMd, parseCityMd, cityScaffold } = require('../lib/parsers');

const router = express.Router();

router.get('/api/cities', async (req, res) => {
  try { res.json({ cities: await listCities(), default: DEFAULT_CITY }); }
  catch (e) { serverError(res, e); }
});

// Card-friendly summary of every city in cities/ — used by the «Домены» tab.
router.get('/api/cities/summary', async (req, res) => {
  try {
    const slugs = await listCities();
    const out = await Promise.all(slugs.map(async slug => {
      let display = slug, year = '';
      try {
        const cm = await fs.readFile(path.join(cityDir(slug), 'city.md'), 'utf-8');
        const p  = parseCityMd(cm);
        if (p.display) display = p.display;
        year = p.year || '';
      } catch {}
      let characters = 0;
      try { characters = (await getAllCharacters(slug)).length; } catch {}
      let modules = 0;
      try { modules = (await listModules(slug)).length; } catch {}
      let locations = 0;
      try { locations = await countMdFiles(locsDir(slug)); } catch {}
      return { slug, display, year, characters, modules, locations };
    }));
    out.sort((a, b) => a.display.localeCompare(b.display, 'ru'));
    res.json(out);
  } catch (e) { serverError(res, e); }
});

// Full city.md + stats for one city — used by the city detail modal.
router.get('/api/cities/:slug/detail', async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!(await listCities()).includes(slug)) return res.status(404).json({ error: 'Город не найден' });

    const cityMd = (await fs.readFile(path.join(cityDir(slug), 'city.md'), 'utf-8').catch(() => '')).replace(/^﻿/, '');
    const parsed = parseCityMd(cityMd);   // { display, year, sections } — для предзаполнения формы

    let characters = 0;
    try { characters = (await getAllCharacters(slug)).length; } catch {}
    let modules = 0;
    try { modules = (await listModules(slug)).length; } catch {}
    let locations = 0;
    try { locations = await countMdFiles(locsDir(slug)); } catch {}

    res.json({ slug, cityMd, parsed, characters, modules, locations });
  } catch (e) { serverError(res, e); }
});

// ── City create / edit / delete ────────────────────────────────────────────────

// POST /api/cities — create a city directly (no CLI spawn). Body: { name, year, political,
// locations, leitmotif, specifics, avoid, sources, districts }. Builds the same scaffold
// as tools/new_city.js using the shared buildCityMd template.
router.post('/api/cities', express.json(), async (req, res) => {
  try {
    const b = req.body || {};
    const display = String(b.name || '').trim();
    if (!display) return res.status(400).json({ error: 'Укажи название города' });
    const slug = slugify(display);
    if (!slug) return res.status(400).json({ error: 'Не удалось сформировать слаг из названия' });
    // Год обязателен (как и на фронте) и должен быть 3–4 цифрами.
    const year = String(b.year || '').trim();
    if (!year) return res.status(400).json({ error: 'Укажи год' });
    if (!/^\d{3,4}$/.test(year)) return res.status(400).json({ error: 'Год — это 3–4 цифры (например 2010)' });
    if ((await listCities()).includes(slug))
      return res.status(409).json({ error: `Город «${slug}» уже существует` });

    const base = cityDir(slug);

    const W    = (rel, txt) => fs.mkdir(path.dirname(path.join(base, rel)), { recursive: true })
      .then(() => writeFileAtomic(path.join(base, rel), txt, 'utf-8'));
    const KEEP = rel => fs.mkdir(path.join(base, rel), { recursive: true })
      .then(() => writeFileAtomic(path.join(base, rel, '.gitkeep'), ''));

    // Единый каркас (тот же, что у tools/new_city.js) — см. cityScaffold в web/lib/parsers.js.
    const { files, keepDirs } = cityScaffold({
      display, year,
      description: b.description, factions: b.factions,
      political: b.political, locations: b.locations, leitmotif: b.leitmotif,
      specifics: b.specifics, avoid: b.avoid, sources: b.sources,
      districts: b.districts,
    });
    try {
      for (const [rel, txt] of Object.entries(files)) await W(rel, txt);
      for (const rel of keepDirs) await KEEP(rel);
      // Отразить указанный политический состав в archive/political_state.md «Карте фракций»
      // сразу при создании — как это делает PUT при редактировании.
      if (typeof b.political === 'string' && b.political.trim()) {
        await syncPoliticalStateTable(slug, parsePoliticalRecords(b.political.split('\n')), []).catch(() => {});
      }
    } catch (writeErr) {
      // Откат: слага не было до запроса (проверка выше), папка свежая — сносим целиком,
      // чтобы не оставить полу-созданный «битый» город в списке.
      await fs.rm(base, { recursive: true, force: true }).catch(() => {});
      throw writeErr;
    }

    invalidateChars(slug);
    console.log(`[create-city] ${slug} («${display}», ${year})`);
    res.json({ ok: true, slug, display, year });
  } catch (e) {
    console.error('[create-city]', e.message);
    serverError(res, e);
  }
});

// Разбор строк секции «Политический ландшафт» ("Роль: Имя / Имя2") в структурные записи.
// Зеркалит эвристику _isStructuredCityLine из scripts.js: запись — короткая метка (≤24,
// ≤2 слов, без запятой) + значение, похожее на имя (≤48, без прозаической пунктуации).
// Иначе строка — нарратив и в «Карту фракций» не идёт (проза с двоеточием тоже).
function parsePoliticalRecords(lines) {
  return (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
    .map(l => String(l).replace(/^\s*-\s?/, '').trim()).filter(Boolean)
    .map(line => {
      const ci = line.indexOf(':');
      let role = '', rest = line;
      if (ci > 0 && ci <= 40) {
        const label = line.slice(0, ci).trim();
        const value = line.slice(ci + 1).trim();
        const labelOk = label && label.length <= 24 && label.split(/\s+/).length <= 2 && !label.includes(',');
        const valueOk = value.length > 0 && value.length <= 48 && !/[.!?,;]/.test(value);
        if (labelOk && valueOk) { role = label; rest = value; }
      }
      const [name = '', name2 = ''] = rest.split('/').map(s => s.trim());
      return { role, name, name2 };
    }).filter(r => r.role);
}
function _parseMdTableRow(r) { return r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()); }

// Зеркалирование политического ландшафта в archive/political_state.md «Карта фракций»,
// чтобы страница «Фракции» отражала тот же состав. Строки управляемых здесь должностей
// перестраиваются; рукописные строки прочих должностей сохраняются. previousRoles —
// должности, что были в city.md до сохранения (чтобы убрать удалённые в редакторе).
async function syncPoliticalStateTable(slug, records, previousRoles = []) {
  const file = path.join(cityDir(slug), 'archive', 'political_state.md');
  const md = await fs.readFile(file, 'utf-8').catch(() => null);
  if (md === null) return;
  let chars = [];
  try { chars = await getAllCharacters(slug); } catch {}
  const clanByName = new Map(chars.map(c => [c.name, c.clan || '']));
  const lines = md.split('\n');
  const headerIdx = lines.findIndex(l => /^\s*\|.*Должность.*\|.*Персонаж.*\|/i.test(l));
  if (headerIdx === -1) return;
  const sepIdx = headerIdx + 1;
  let end = sepIdx + 1;
  while (end < lines.length && /^\s*\|/.test(lines[end])) end++;
  const existingRows = lines.slice(sepIdx + 1, end).map(_parseMdTableRow);
  const noteByRole = new Map(existingRows.map(r => [r[0], r[3] || '']));
  const savedRoles = new Set(records.map(r => r.role).filter(Boolean));
  const removedRoles = new Set(previousRoles.filter(role => role && !savedRoles.has(role)));
  const kept = existingRows.filter(r => !savedRoles.has(r[0]) && !removedRoles.has(r[0]));
  const newRows = records.filter(r => r.role || r.name || r.name2).map(r => {
    const persons = [r.name, r.name2].filter(Boolean).join(' / ') || '—';
    const clan = clanByName.get(r.name) || clanByName.get(r.name2) || '';
    return [r.role || '—', persons, clan, noteByRole.get(r.role) || ''];
  });
  const allRows = [...newRows, ...kept];
  const rowsText = allRows.length ? allRows.map(r => `| ${r.join(' | ')} |`).join('\n') : '|  |  |  |  |';
  lines.splice(sepIdx + 1, end - (sepIdx + 1), rowsText);
  await writeFileAtomic(file, lines.join('\n'), 'utf-8');
}

// PUT /api/cities/:slug — edit city.md. Body: { cityMd } (raw, full replace — preserves
// custom/hand-written sections) OR { fields:{display,year,...} } (rebuild from template).
router.put('/api/cities/:slug', express.json(), async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!/^[a-z0-9_]+$/.test(slug)) return res.status(400).json({ error: 'Недопустимый слаг города' });
    if (!(await listCities()).includes(slug)) return res.status(404).json({ error: 'Город не найден' });

    const b = req.body || {};
    // Должности, что город перечислял ДО сохранения — для синка с «Картой фракций».
    let prevRoles = [];
    if (b.fields && typeof b.fields.political === 'string') {
      try {
        const oldMd = await fs.readFile(path.join(cityDir(slug), 'city.md'), 'utf-8');
        prevRoles = parsePoliticalRecords((parseCityMd(oldMd).sections.political || '').split('\n')).map(r => r.role).filter(Boolean);
      } catch {}
    }
    let cityMd;
    if (typeof b.cityMd === 'string' && b.cityMd.trim()) {
      cityMd = b.cityMd.replace(/^﻿/, '');
    } else if (b.fields && typeof b.fields === 'object') {
      cityMd = buildCityMd(b.fields);
    } else {
      return res.status(400).json({ error: 'Нужно передать cityMd (markdown) или fields' });
    }
    if (!/^#\s+\S/m.test(cityMd)) return res.status(400).json({ error: 'city.md должен начинаться с заголовка # …' });

    await writeFileAtomic(path.join(cityDir(slug), 'city.md'), cityMd, 'utf-8');
    // Отразить политический состав в archive/political_state.md «Фракции».
    if (b.fields && typeof b.fields.political === 'string') {
      await syncPoliticalStateTable(slug, parsePoliticalRecords(b.fields.political.split('\n')), prevRoles).catch(() => {});
    }
    invalidateChars(slug);
    console.log(`[edit-city] ${slug}`);
    res.json({ ok: true, slug, parsed: parseCityMd(cityMd) });
  } catch (e) {
    console.error('[edit-city]', e.message);
    serverError(res, e);
  }
});

// DELETE /api/cities/:slug — soft-delete (move to cities/_deleted/<slug>), reversible and
// image-safe (gitignored art is moved, not erased). Refuses to delete the last city.
router.delete('/api/cities/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!/^[a-z0-9_]+$/.test(slug)) return res.status(400).json({ error: 'Недопустимый слаг города' });
    const cities = await listCities();
    if (!cities.includes(slug)) return res.status(404).json({ error: 'Город не найден' });
    if (cities.length <= 1) return res.status(409).json({ error: 'Нельзя удалить единственный город' });

    const deletedDir = path.join(CITIES_DIR, '_deleted');
    await fs.mkdir(deletedDir, { recursive: true });
    const dest = path.join(deletedDir, `${slug}_${Date.now()}`);
    await fs.rename(cityDir(slug), dest);

    invalidateChars(slug);
    console.log(`[delete-city] ${slug} → ${path.relative(ROOT, dest)}`);
    res.json({ ok: true, slug, movedTo: path.relative(ROOT, dest).replace(/\\/g, '/') });
  } catch (e) {
    console.error('[delete-city]', e.message);
    serverError(res, e);
  }
});

module.exports = { router };
