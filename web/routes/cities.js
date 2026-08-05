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
  getAllCharacters, getAllLocations, listModules, countMdFiles,
  EDITABLE_FIELD_MAP, writeCharacterCardField, writeLocationCardField,
} = require('../lib/db');
const {
  slugify, buildCityMd, parseCityMd, cityScaffold, sanitizeInlineText, escapeTableCell, unescapeTableCell,
  buildDistrictMd, parseDistrictMd, DISTRICT_FILENAME, CITY_SECTIONS,
} = require('../lib/parsers');
const {
  setCityTitle, setCityDescription, upsertCitySectionFromForm, upsertCitySection, replaceCitySectionBullets,
} = require('../lib/city_md_writer');

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
    // Все 16 канонических секций, а не 8: раньше whitelist молча терял «живые» секции
    // города, из которых пять — рабочий вход генерации (limits/edicts/hunting/tech →
    // buildCityConstraints, naming → buildCityNaming). Свежесозданный город уходил в
    // генерацию без ограничений домена и без именника (§A2).
    const { files, keepDirs } = cityScaffold({
      display, year,
      description: b.description, factions: b.factions,
      political: b.political, locations: b.locations, leitmotif: b.leitmotif,
      specifics: b.specifics, avoid: b.avoid, sources: b.sources,
      districts: b.districts,
      landmarks: b.landmarks, hunting: b.hunting, edicts: b.edicts,
      mortals: b.mortals, calendar: b.calendar, tech: b.tech,
      limits: b.limits, naming: b.naming,
    });
    const warnings = [];
    try {
      for (const [rel, txt] of Object.entries(files)) await W(rel, txt);
      for (const rel of keepDirs) await KEEP(rel);
      // Отразить указанный политический состав в archive/political_state.md «Карте фракций»
      // сразу при создании — как это делает PUT при редактировании.
      if (typeof b.political === 'string' && b.political.trim()) {
        await syncPoliticalStateTable(slug, parsePoliticalRecords(b.political.split('\n')), []).catch(() => {});
      }
      // «Иерархия»/zone-control на карточках персонажей и локаций (§4.2/§5.2 техспеки) —
      // на только что созданный город это на практике no-op (у свежего города ещё нет
      // персонажей/локаций, чтобы имя из формы могло на них сослаться), но тот же путь,
      // что и PUT, держим для симметрии «применяется и при создании, и при редактировании».
      if (typeof b.political === 'string' && b.political.trim()) {
        warnings.push(...await syncPoliticalCharacterHierarchy(slug, display, parsePoliticalRecords(b.political.split('\n')), []));
      }
      if (typeof b.locations === 'string' && b.locations.trim()) {
        warnings.push(...await syncSignificantPlaceStatus(slug, parseLocationRecords(b.locations.split('\n')), []));
      }
    } catch (writeErr) {
      // Откат: слага не было до запроса (проверка выше), папка свежая — сносим целиком,
      // чтобы не оставить полу-созданный «битый» город в списке.
      await fs.rm(base, { recursive: true, force: true }).catch(() => {});
      throw writeErr;
    }

    invalidateChars(slug);
    console.log(`[create-city] ${slug} («${display}», ${year})`);
    res.json({ ok: true, slug, display, year, ...(warnings.length ? { warnings } : {}) });
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
  // unescapeTableCell/escapeTableCell: FIX-16 (docs/audit/2026-07-28-fix-plan.md,
  // continuation of FIX-2) — role/name come from the free-text «Политический
  // ландшафт» textarea; an embedded '|' otherwise shifted every column after it
  // on the next parse (confirmed live during QA with a "Князь: Тест|ВЗЛОМ" line).
  const noteByRole = new Map(existingRows.map(r => [unescapeTableCell(r[0]), r[3] || '']));
  const savedRoles = new Set(records.map(r => r.role).filter(Boolean));
  const removedRoles = new Set(previousRoles.filter(role => role && !savedRoles.has(role)));
  const kept = existingRows.filter(r => !savedRoles.has(unescapeTableCell(r[0])) && !removedRoles.has(unescapeTableCell(r[0])));
  const newRows = records.filter(r => r.role || r.name || r.name2).map(r => {
    const persons = escapeTableCell(sanitizeInlineText([r.name, r.name2].filter(Boolean).join(' / '))) || '—';
    const clan = escapeTableCell(sanitizeInlineText(clanByName.get(r.name) || clanByName.get(r.name2) || ''));
    return [escapeTableCell(sanitizeInlineText(r.role)) || '—', persons, clan, noteByRole.get(r.role) || ''];
  });
  const allRows = [...newRows, ...kept];
  const rowsText = allRows.length ? allRows.map(r => `| ${r.join(' | ')} |`).join('\n') : '|  |  |  |  |';
  lines.splice(sepIdx + 1, end - (sepIdx + 1), rowsText);
  await writeFileAtomic(file, lines.join('\n'), 'utf-8');
}

// Разбор строк секции «Ключевые локации» ("Тип: Название") в структурные записи —
// та же эвристика, что parsePoliticalRecords выше (зеркалит _isStructuredCityLine из
// city.js), применённая к «Значимым местам» (docs/design/2026-08-02-city-creation-
// restructure-techspec.md §5). Нужна на сервере для diff'а «кто выбыл из списка» перед
// синком zone/control карточек локаций (§5.1-5.2) — без похода в клиентский код.
function parseLocationRecords(lines) {
  return (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
    .map(l => String(l).replace(/^\s*-\s?/, '').trim()).filter(Boolean)
    .map(line => {
      const ci = line.indexOf(':');
      let type = '', rest = line, note = '';
      if (ci > 0 && ci <= 40) {
        const label = line.slice(0, ci).trim();
        let value = line.slice(ci + 1).trim();
        // Заметка — третье поле (техспека §8.1), отделено « — »; отрезается ДО проверки
        // valueOk ниже, иначе пунктуация в свободном тексте заметки ложно бракует строку
        // как неструктурированную.
        const dashIdx = value.search(/\s+—\s+/);
        if (dashIdx !== -1) {
          note = value.slice(dashIdx).replace(/^\s+—\s+/, '').trim();
          value = value.slice(0, dashIdx).trim();
        }
        const labelOk = label && label.length <= 24 && label.split(/\s+/).length <= 2 && !label.includes(',');
        const valueOk = value.length > 0 && value.length <= 48 && !/[.!?,;]/.test(value);
        if (labelOk && valueOk) { type = label; rest = value; } else { note = ''; }
      }
      return { type, name: rest, note };
    }).filter(r => r.type);
}

// Первое имя/имя2 → роль (для diff'а). Персонаж, занятый в двух ролях одновременно
// (техспека §4.3 — открытый вопрос), сохраняет первую встреченную — не было буквально
// в плане Аналитика, простейшее из технически корректных поведений.
function _rolesByName(records) {
  const map = new Map();
  records.forEach(r => {
    if (r.name && !map.has(r.name))   map.set(r.name, r.role);
    if (r.name2 && !map.has(r.name2)) map.set(r.name2, r.role);
  });
  return map;
}
function _placesByName(records) {
  const map = new Map();
  records.forEach(r => { if (r.name && !map.has(r.name)) map.set(r.name, r); });
  return map;
}

// Записывает/снимает роль (Властители города + Примогенат, «Карта фракций») в поле
// «Иерархия в городе» карточки персонажа при сохранении города — город → персонаж
// (docs/design/2026-08-02-city-creation-restructure-techspec.md §4.2-4.4). Пишет ТОЛЬКО
// когда имя в строке совпало с существующим персонажем города — вручную вписанное имя
// не создаёт запись (нет карточки, которую можно было бы найти). Ни разу не бросает —
// одна неудавшаяся запись собирается в warnings и не должна срывать сохранение города.
async function syncPoliticalCharacterHierarchy(city, cityDisplay, records, prevRecords) {
  const warnings = [];
  const currByName = _rolesByName(records);
  const prevByName  = _rolesByName(prevRecords);
  if (!currByName.size && !prevByName.size) return warnings;

  let chars = [];
  try { chars = await getAllCharacters(city); }
  catch (e) { warnings.push(`Не удалось прочитать персонажей города для синка «Иерархии»: ${e.message}`); return warnings; }
  const charByName = new Map(chars.map(c => [c.name, c]));
  const hierarchyMdKey = EDITABLE_FIELD_MAP.hierarchy;

  // Выбывшие: держали роль ДО сохранения, сейчас ни на одной роли не числятся по имени.
  for (const [name, role] of prevByName) {
    if (currByName.has(name)) continue;
    const char = charByName.get(name);
    if (!char) continue; // персонаж переименован/удалён между сохранениями — нечего чистить
    const expected = `${role} города ${cityDisplay}`;
    if ((char.hierarchy || '').trim() !== expected) continue; // §4.4 — ручная правка, не трогаем
    try { await writeCharacterCardField(city, char, hierarchyMdKey, ''); }
    catch (e) { warnings.push(`Не удалось очистить «Иерархию» у «${name}»: ${e.message}`); }
  }
  // Новые/сохранившие роль: проставляем текущую должность.
  for (const [name, role] of currByName) {
    const char = charByName.get(name);
    if (!char) continue; // ручной ввод текста, не выбор существующего персонажа — не пишем
    const value = `${role} города ${cityDisplay}`;
    if ((char.hierarchy || '').trim() === value) continue; // уже актуально
    try { await writeCharacterCardField(city, char, hierarchyMdKey, value); }
    catch (e) { warnings.push(`Не удалось записать «Иерархию» «${name}» (${role}): ${e.message}`); }
  }
  return warnings;
}

// Маркер-префикс в поле «Контроль» локации — отличает значения, которые записала форма
// города (см. ниже), от текста, вписанного пользователем вручную (техспека §5.3): сброс
// при снятии статуса срабатывает только по точному совпадению с этим значением.
const CITY_CONTROL_MARKER = '[Город]';
// «Тип» из «Значимых мест» → куда его писать на карточке САМОЙ локации (план Аналитика
// §4.1 п.7 — переиспользуем «Зона»/«Контроль», без нового поля). «Элизиум» пишет
// в «Зона» тем же значением, что и ZONE_CLASS_LABELS.elysium на клиенте (web/public/
// scripts/locations.js) — иначе zoneClass() на карточке не опознает его как Элизиум.
const SIGNIFICANT_PLACE_TYPES = {
  'Элизиум':        { field: 'zone',    mdKey: 'Зона',     value: '🏛️ Элизиум' },
  'Приёмная князя':  { field: 'control', mdKey: 'Контроль', value: `${CITY_CONTROL_MARKER} Приёмная князя` },
  'Убежище':         { field: 'control', mdKey: 'Контроль', value: `${CITY_CONTROL_MARKER} Убежище` },
  'Шериф':           { field: 'control', mdKey: 'Контроль', value: `${CITY_CONTROL_MARKER} Шериф` },
  'Сенешаль':        { field: 'control', mdKey: 'Контроль', value: `${CITY_CONTROL_MARKER} Сенешаль` },
};

// Заметка (техспека §8.2) допишется к тому же маркированному тексту, что уже пишется в
// «Контроль» — только туда, «Зона» (Элизиум) заметку не получает (§8.2, буквально: «тому
// же маркированному тексту, что уже пишется в control»). Формат: «[Город] Статус — Заметка».
function _significantPlaceValue(conf, note) {
  const clean = note ? String(note).trim().replace(/—/g, '–') : '';
  if (conf.field !== 'control' || !clean) return conf.value;
  return `${conf.value} — ${clean}`;
}

// Симметрично syncPoliticalCharacterHierarchy, но для «Значимых мест» → zone/control
// карточки локации (техспека §5.1-5.2). Diff читается из city.md-строк «Тип: Название»
// (records/prevRecords уже распарсены через parseLocationRecords), не из текущего
// содержимого zone/control — это делает сам diff надёжным (§5.1); свободные/«Другое»
// типы без маппинга в SIGNIFICANT_PLACE_TYPES не синкаются никуда, кроме city.md.
async function syncSignificantPlaceStatus(city, records, prevRecords) {
  const warnings = [];
  const currByName = _placesByName(records);
  const prevByName  = _placesByName(prevRecords);
  if (!currByName.size && !prevByName.size) return warnings;

  let locs = [];
  try { locs = await getAllLocations(city); }
  catch (e) { warnings.push(`Не удалось прочитать локации города для синка «Значимых мест»: ${e.message}`); return warnings; }
  const locByName = new Map(locs.map(l => [l.title, l]));

  for (const [name, rec] of prevByName) {
    if (currByName.has(name)) continue;
    const loc = locByName.get(name);
    const conf = SIGNIFICANT_PLACE_TYPES[rec.type];
    if (!loc || !conf) continue;
    const current = (conf.field === 'zone' ? loc.zone : loc.control) || '';
    // §5.3 — маркер-префикс: заметка дописана ПОСЛЕ conf.value, поэтому «наш» текст
    // проверяем по startsWith, не точным совпадением (иначе строка с заметкой никогда
    // не считалась бы «нашей» и не сбрасывалась бы при снятии статуса).
    if (!current.trim().startsWith(conf.value)) continue;
    try { await writeLocationCardField(city, loc.slug, conf.mdKey, ''); }
    catch (e) { warnings.push(`Не удалось сбросить «${conf.mdKey}» у локации «${name}»: ${e.message}`); }
  }
  for (const [name, rec] of currByName) {
    const loc = locByName.get(name);
    const conf = SIGNIFICANT_PLACE_TYPES[rec.type];
    if (!loc || !conf) continue;
    const current = (conf.field === 'zone' ? loc.zone : loc.control) || '';
    const value = _significantPlaceValue(conf, rec.note);
    if (current.trim() === value) continue; // уже актуально
    try { await writeLocationCardField(city, loc.slug, conf.mdKey, value); }
    catch (e) { warnings.push(`Не удалось записать «${conf.mdKey}» локации «${name}»: ${e.message}`); }
  }
  return warnings;
}

// PUT /api/cities/:slug — edit city.md. Body: { cityMd } (raw, full replace — preserves
// custom/hand-written sections) OR { fields:{display,year,...} } (rebuild from template).
router.put('/api/cities/:slug', express.json(), async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!/^[a-z0-9_]+$/.test(slug)) return res.status(400).json({ error: 'Недопустимый слаг города' });
    if (!(await listCities()).includes(slug)) return res.status(404).json({ error: 'Город не найден' });

    const b = req.body || {};
    // Состояние ДО сохранения — для диффа с «Картой фракций» (существующий путь) и,
    // новое здесь, с карточками персонажей/локаций (§4.2/§5.1-5.2 техспеки). Читаем
    // обе секции сразу за один проход по старому city.md, а не по одной на секцию.
    let prevRoles = [], prevPoliticalRecords = [], prevLocationRecords = [];
    if (b.fields && (typeof b.fields.political === 'string' || typeof b.fields.locations === 'string')) {
      try {
        const oldMd = await fs.readFile(path.join(cityDir(slug), 'city.md'), 'utf-8');
        const oldSections = parseCityMd(oldMd).sections || {};
        if (typeof b.fields.political === 'string') {
          prevPoliticalRecords = parsePoliticalRecords((oldSections.political || '').split('\n'));
          prevRoles = prevPoliticalRecords.map(r => r.role).filter(Boolean);
        }
        if (typeof b.fields.locations === 'string') {
          prevLocationRecords = parseLocationRecords((oldSections.locations || '').split('\n'));
        }
      } catch {}
    }
    let cityMd;
    const sectionsWritten = [];
    if (typeof b.cityMd === 'string' && b.cityMd.trim()) {
      cityMd = b.cityMd.replace(/^﻿/, '');
    } else if (b.fields && typeof b.fields === 'object') {
      // Год валидируем так же, как в POST: иначе через форму редактирования в H1
      // попадал произвольный текст и расходился по шапкам карточек (§A6.1).
      if (typeof b.fields.year === 'string' && b.fields.year.trim()
          && !/^\d{3,4}$/.test(b.fields.year.trim()))
        return res.status(400).json({ error: 'Год — это 3–4 цифры (например 2010)' });

      // Точечная правка вместо buildCityMd-ребилда (§A1): пересборка из 16 канонических
      // секций уничтожала рукописные секции и форматирование (таблицы/блок-цитаты/###),
      // из-за чего вкладка «Поля» была запрещена таким городам.
      const current = await fs.readFile(path.join(cityDir(slug), 'city.md'), 'utf-8').catch(() => null);
      if (current === null) return res.status(404).json({ error: 'city.md не найден' });

      const currentParsed = parseCityMd(current);
      cityMd = setCityTitle(current, b.fields.display, b.fields.year);
      if (typeof b.fields.description === 'string' && b.fields.description.trim() !== (currentParsed.description || '').trim())
        cityMd = setCityDescription(cityMd, b.fields.description);

      for (const [key, heading] of CITY_SECTIONS) {
        if (typeof b.fields[key] !== 'string') continue;  // ключ не пришёл — секцию не трогаем
        // Пропускаем секции, которых пользователь не менял. Это не оптимизация, а
        // сохранность данных: форма показывает УПЛОЩЁННЫЙ parseCityMd-текст (буллеты
        // сняты, пустые строки и «---» отброшены), и запись его обратно превратила бы
        // блок-цитаты и ###-подзаголовки рукописного города в буллеты. Пока значение
        // не тронуто — не трогаем и секцию, её исходный markdown остаётся как есть.
        if (b.fields[key].trim() === (currentParsed.sections[key] || '').trim()) continue;
        if (key === 'landmarks') {
          // «Значимые места» (view-tabs §V5, 2026-08-04) приходят с клиента уже
          // готовой markdown-таблицей `| Название | Описание |` — upsertCitySectionFromForm
          // прогнал бы её через citySectionBody (бул­летизация каждой строки без «-»)
          // и сломал бы таблицу с первого же сохранения. Пишем как есть, тем же
          // приёмом, что уже применяют keyPoints/vtmText в routes/locations.js.
          const { text, created } = upsertCitySection(cityMd, heading, b.fields[key]);
          cityMd = text;
          sectionsWritten.push(created ? `${key} (создана)` : key);
          continue;
        }
        const { text, created } = upsertCitySectionFromForm(cityMd, heading, b.fields[key]);
        cityMd = text;
        sectionsWritten.push(created ? `${key} (создана)` : key);
      }
    } else {
      return res.status(400).json({ error: 'Нужно передать cityMd (markdown) или fields' });
    }
    if (!/^#\s+\S/m.test(cityMd)) return res.status(400).json({ error: 'city.md должен начинаться с заголовка # …' });

    await writeFileAtomic(path.join(cityDir(slug), 'city.md'), cityMd, 'utf-8');
    const parsed = parseCityMd(cityMd);
    const warnings = [];
    // Отразить политический состав в archive/political_state.md «Фракции».
    if (b.fields && typeof b.fields.political === 'string') {
      const newPoliticalRecords = parsePoliticalRecords(b.fields.political.split('\n'));
      await syncPoliticalStateTable(slug, newPoliticalRecords, prevRoles).catch(() => {});
      // «Иерархия» на карточках персонажей — город → персонаж (§4.2/§4.4 техспеки).
      const cityDisplay = (b.fields.display || parsed.display || slug).trim();
      warnings.push(...await syncPoliticalCharacterHierarchy(slug, cityDisplay, newPoliticalRecords, prevPoliticalRecords));
    }
    // zone/control на карточках локаций — город → локация (§5.1-5.2 техспеки).
    if (b.fields && typeof b.fields.locations === 'string') {
      const newLocationRecords = parseLocationRecords(b.fields.locations.split('\n'));
      warnings.push(...await syncSignificantPlaceStatus(slug, newLocationRecords, prevLocationRecords));
    }
    invalidateChars(slug);
    console.log(`[edit-city] ${slug}`);
    res.json({
      ok: true, slug, parsed,
      ...(sectionsWritten.length ? { sectionsWritten } : {}),
      ...(warnings.length ? { warnings } : {}),
    });
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

// ── District (Район) — новая сущность, план 2026-08-02-city-creation-restructure ─────
// Файл-карточка района — cities/<city>/locations/<rayon-slug>/district.md, единый
// источник шаблона с tools/new_district.js (buildDistrictMd/parseDistrictMd,
// web/lib/parsers/district.js). Только create/read/update — DELETE вне скоупа (§2.4
// техспеки: удаление района с локациями внутри — отдельная, более рискованная задача).

// Служебные папки locations/, которые физически могут содержать district.md
// (или сами по себе — директории), но районами не являются: `_deleted` —
// корзина мягкого удаления (db.js/cities.js/locations.js уже пропускают её
// везде при обходе), `drugie` (slugify('Другие')) — служебный отстойник для
// локаций без явной привязки (см. routes/locations.js: `distFolder =
// slugify(district) || 'Другие'`), у него тоже может завестись district.md
// (например, если через него когда-то физически перемещали локацию), но в
// списке «Районы» ему делать нечего — это не редактируемая сущность.
const DEFAULT_DISTRICT_SLUG = slugify('Другие');

// Читает список районов города напрямую с диска — та же логика, что у GET ниже,
// но переиспользуется и синком секции «## Районы» (не завязана на req/res).
async function _listDistricts(slug) {
  const root = locsDir(slug);
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { entries = []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('_') || e.name === DEFAULT_DISTRICT_SLUG) continue;
    const districtFile = path.join(root, e.name, DISTRICT_FILENAME);
    const raw = await fs.readFile(districtFile, 'utf-8').catch(() => null);
    if (raw === null) continue;
    const { name, type, sect, clan, description } = parseDistrictMd(raw);
    out.push({ slug: e.name, name: name || e.name, type, sect, clan, description });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return out;
}

// Секция «## Районы» в city.md — ОДНОСТОРОННЕЕ зеркало district.md-сущностей (§A3.2,
// решение ОВ-2: district.md остаётся единственным источником истины, дублировать
// тип/секту/клан в текст секции не нужно — они уже там). Перестраивается целиком при
// любой мутации района: по буллету на имя, в том же порядке, что отдаёт GET /districts.
// replaceCitySectionBullets (не upsert!) — та же семантика, что у уже принятого
// _syncCityFactionsList (routes/archive.js, §11): если секции «## Районы» в файле нет
// вообще (рукописный city.md без нужной секции), синк молча пропускается с warning,
// новую секцию сюрпризом не создаём. Non-blocking — район уже сохранён к моменту
// вызова, сбой записи city.md его не откатывает.
async function _syncCityDistrictsList(slug) {
  try {
    const file = path.join(cityDir(slug), 'city.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => null);
    if (raw === null) return null;
    const names = (await _listDistricts(slug)).map(d => d.name);
    const updated = replaceCitySectionBullets(raw, 'Районы', names);
    if (updated === null) return 'Район сохранён, но в city.md не найдена секция «Районы» — синк пропущен';
    if (updated === raw) return null; // уже актуально
    await writeFileAtomic(file, updated, 'utf-8');
    return null;
  } catch (e) {
    return `Район сохранён, но не удалось синхронизировать список «Районы» в описании города: ${e.message}`;
  }
}

// GET /api/cities/:slug/districts — список районов города: [{slug, name, type, sect, clan, description}].
router.get('/api/cities/:slug/districts', async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!(await listCities()).includes(slug)) return res.status(404).json({ error: 'Город не найден' });
    res.json(await _listDistricts(slug));
  } catch (e) { serverError(res, e); }
});

// POST /api/cities/:slug/districts — создать район. Body: { name, type?, sect?, clan?, description? }.
router.post('/api/cities/:slug/districts', express.json(), async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!(await listCities()).includes(slug)) return res.status(404).json({ error: 'Город не найден' });

    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Укажи название района' });
    const districtSlug = slugify(name);
    if (!districtSlug) return res.status(400).json({ error: 'Не удалось сформировать слаг из названия' });

    const districtDir = path.join(locsDir(slug), districtSlug);
    if (await fs.access(districtDir).then(() => true, () => false)) {
      return res.status(409).json({ error: `Район «${districtSlug}» уже существует` });
    }

    const md = buildDistrictMd({ name, type: b.type, sect: b.sect, clan: b.clan, description: b.description });
    await fs.mkdir(districtDir, { recursive: true });
    await writeFileAtomic(path.join(districtDir, DISTRICT_FILENAME), md, 'utf-8');
    const warning = await _syncCityDistrictsList(slug);

    console.log(`[create-district] ${slug}/${districtSlug} («${name}»)`);
    res.json({ ok: true, slug: districtSlug, ...parseDistrictMd(md), ...(warning ? { warning } : {}) });
  } catch (e) {
    console.error('[create-district]', e.message);
    serverError(res, e);
  }
});

// PUT /api/cities/:slug/districts/:districtSlug — частичная правка полей district.md.
// НЕ переименовывает/не переносит папку — «name» меняет только текст «Название» внутри
// карточки, слаг папки/URL остаётся прежним (см. техспека §2.4).
router.put('/api/cities/:slug/districts/:districtSlug', express.json(), async (req, res) => {
  try {
    const { slug, districtSlug } = req.params;
    if (!(await listCities()).includes(slug)) return res.status(404).json({ error: 'Город не найден' });
    if (!/^[a-z0-9_]+$/.test(districtSlug)) return res.status(400).json({ error: 'Недопустимый слаг района' });

    const districtFile = path.join(locsDir(slug), districtSlug, DISTRICT_FILENAME);
    const raw = await fs.readFile(districtFile, 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'Район не найден' });

    const b = req.body || {};
    const current = parseDistrictMd(raw);
    const merged = {
      name:        b.name        !== undefined ? String(b.name).trim()        : current.name,
      type:        b.type        !== undefined ? String(b.type).trim()        : current.type,
      sect:        b.sect        !== undefined ? String(b.sect).trim()        : current.sect,
      clan:        b.clan        !== undefined ? String(b.clan).trim()        : current.clan,
      description: b.description !== undefined ? String(b.description).trim() : current.description,
    };
    if (!merged.name) return res.status(400).json({ error: 'Название района не может быть пустым' });

    const md = buildDistrictMd(merged);
    await writeFileAtomic(districtFile, md, 'utf-8');
    const warning = await _syncCityDistrictsList(slug);

    console.log(`[edit-district] ${slug}/${districtSlug}`);
    res.json({ ok: true, slug: districtSlug, ...parseDistrictMd(md), ...(warning ? { warning } : {}) });
  } catch (e) {
    console.error('[edit-district]', e.message);
    serverError(res, e);
  }
});

// DELETE /api/cities/:slug/districts/:districtSlug — soft-delete района (§A5).
// Запрещено для НЕПУСТОГО района (§16.3-style явная 409, а не тихий авто-перенос
// локаций куда-то): перенос был бы fs.rename каждой локации + правка ссылок (§B1) +
// правка «**Район:**» на карточке — молча выполнять цепочку побочных эффектов по
// одному клику «Удалить» опаснее, чем показать явную ошибку и попросить пользователя
// сначала разобраться с локациями. Мягко — в locations/_deleted/, симметрично
// DELETE /api/locations/:slug; обходы районов/локаций уже пропускают «_»-папки.
router.delete('/api/cities/:slug/districts/:districtSlug', async (req, res) => {
  try {
    const { slug, districtSlug } = req.params;
    if (!(await listCities()).includes(slug)) return res.status(404).json({ error: 'Город не найден' });
    if (!/^[a-z0-9_]+$/.test(districtSlug)) return res.status(400).json({ error: 'Недопустимый слаг района' });

    const districtDir = path.join(locsDir(slug), districtSlug);
    const districtFile = path.join(districtDir, DISTRICT_FILENAME);
    if (!(await fs.readFile(districtFile, 'utf-8').catch(() => null)))
      return res.status(404).json({ error: 'Район не найден' });

    const entries = await fs.readdir(districtDir, { withFileTypes: true });
    const locationDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    if (locationDirs.length) {
      return res.status(409).json({
        error: `В районе «${districtSlug}» есть локации (${locationDirs.length}) — перенесите или удалите их сначала`,
        locations: locationDirs,
      });
    }

    const trashRoot = path.join(locsDir(slug), '_deleted');
    await fs.mkdir(trashRoot, { recursive: true });
    await fs.rename(districtDir, path.join(trashRoot, `district_${districtSlug}_${Date.now()}`));
    const warning = await _syncCityDistrictsList(slug);

    console.log(`[delete-district] ${slug}/${districtSlug}`);
    res.json({ ok: true, ...(warning ? { warning } : {}) });
  } catch (e) {
    console.error('[delete-district]', e.message);
    serverError(res, e);
  }
});

module.exports = { router };
