'use strict';
// Слой данных: раскладка cities/<city>/…, атомарная запись, кэши персонажей и
// локаций с TTL, загрузчики getAllCharacters/getAllLocations. Единственный
// владелец кэшей — инвалидация только через invalidateChars/invalidateLocs.
// Вынесено из server.js (E1.1) как база для доменных роутеров (routes/*.js).

const path = require('path');
const fs   = require('fs').promises;
const { parseCharacter, parseLocation, parseEvent } = require('./parsers');

const ROOT = path.join(__dirname, '..', '..');

// ── City layer (cities/<city>/…) ───────────────────────────────────────────────
const CITIES_DIR = path.join(ROOT, 'cities');
function _firstCity() { try { return (require('fs').readdirSync(CITIES_DIR, { withFileTypes: true }).find(e => e.isDirectory() && !/^[._]/.test(e.name)) || {}).name || ''; } catch { return ''; } }
const DEFAULT_CITY = process.env.CITY || _firstCity() || '';   // нейтрально: первый существующий город
const cityDir       = c => path.join(CITIES_DIR, c || DEFAULT_CITY);
const charsDir      = c => path.join(cityDir(c), 'characters');
const locsDir       = c => path.join(cityDir(c), 'locations');
const chroniclesDir = c => path.join(cityDir(c), 'chronicles');
const archiveDir    = c => path.join(cityDir(c), 'archive');
const reqCity = req => {
  const c = (req.query && req.query.city) || DEFAULT_CITY;
  return /^[a-z0-9_]+$/.test(c) ? c : DEFAULT_CITY;
};
async function listCities() {
  try {
    const es = await fs.readdir(CITIES_DIR, { withFileTypes: true });
    // Skip dot-dirs and the _deleted soft-delete bin (and any _-prefixed internal dir).
    return es.filter(e => e.isDirectory() && !/^[._]/.test(e.name)).map(e => e.name);
  } catch { return []; }
}

// ── Atomic file write ──────────────────────────────────────────────────────────
// Write to a temp file in the SAME directory, then rename() over the target.
// rename() is atomic on one filesystem, so a crash/kill mid-write can never leave a
// half-written (truncated) card — readers see either the old file or the new one,
// never a partial one. (A truncated <slug>-sheet.md is exactly how a card got
// corrupted before this guard existed.) The dot-prefixed temp name is ignored by
// every directory scanner in this server (all skip names starting with '.').
const _rawWriteFile = require('fs').promises.writeFile;
async function writeFileAtomic(filePath, data, enc) {
  const tmp = path.join(path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await _rawWriteFile(tmp, data, enc);
    await fs.rename(tmp, filePath);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

// ── Character / location caches ────────────────────────────────────────────────
let _cache    = {};          // city → { chars, ts }
let _locCache = {};          // city → { locs, ts }
const CHARS_TTL = 15_000;
const LOCS_TTL  = 15_000;

function invalidateChars(city) { if (city) delete _cache[city]; else _cache = {}; }
function invalidateLocs(city)  { if (city) delete _locCache[city]; else _locCache = {}; }

// Broken-link count from the last validate_links run — null = never validated.
// Written by runValidationBackground (server.js) and the /api/tool, /api/run-tool
// routes (routes/tools.js); read by /api/status, /api/integrity (routes/dashboard.js).
// Shared module-level state so both routers agree without DI plumbing.
let _brokenLinks = null;
function getBrokenLinks()      { return _brokenLinks; }
function setBrokenLinks(v)     { _brokenLinks = v; }

const LINEAGE_MAP = {
  vampires: 'vampire', fairies: 'fairy', mortals: 'mortal',
  werewolves: 'werewolf', mages: 'mage', hunters: 'hunter'
};

async function getAllCharacters(city = DEFAULT_CITY) {
  const cc = _cache[city];
  if (cc && Date.now() - cc.ts < CHARS_TTL) return cc.chars;

  // Load and enrich one character folder → char object (or null to skip).
  const loadOne = async (folder, lineage, entry) => {
    const charDir = path.join(charsDir(city), folder, entry);
    const mdPath  = path.join(charDir, `${entry}.md`);
    try {
      const [content, hasSheet, artFiles] = await Promise.all([
        fs.readFile(mdPath, 'utf-8'),
        fs.access(path.join(charDir, `${entry}-sheet.md`)).then(() => true).catch(() => false),
        fs.readdir(path.join(charDir, 'art')).catch(() => []),
      ]);
      const char = parseCharacter(content, entry, lineage);
      char.lineageFolder = folder;
      char.slug = entry;
      char.city = city;
      char.hasSheet = hasSheet;

      // Images live in <slug>/art/. Prefer slug_NN.* (web upload), else first image.
      const slugRe  = new RegExp(`^${entry}_\\d+\\.[a-z]+$`, 'i');
      const imgFile = artFiles.filter(f => slugRe.test(f)).sort().at(-1)
        || artFiles.find(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
      if (imgFile) {
        char.imageUrl = `/city-img/${city}/characters/${folder}/${encodeURIComponent(entry)}/art/${encodeURIComponent(imgFile)}`;
      }
      return char;
    } catch { return null; /* missing/invalid card → skip */ }
  };

  // Per lineage: list the folder, then load all its characters in parallel.
  // Order is preserved (lineage order, then readdir order) via map + flat.
  const perLineage = await Promise.all(
    Object.entries(LINEAGE_MAP).map(async ([folder, lineage]) => {
      let entries;
      try { entries = await fs.readdir(path.join(charsDir(city), folder)); } catch { return []; }
      const loaded = await Promise.all(
        entries.filter(e => e !== '.gitkeep').map(e => loadOne(folder, lineage, e))
      );
      return loaded.filter(Boolean);
    })
  );

  const result = perLineage.flat();
  _cache[city] = { chars: result, ts: Date.now() };
  return result;
}

async function findLocMdPath(slug, city = DEFAULT_CITY) {
  const locRoot = locsDir(city);
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { const r = await walk(full); if (r) return r; }
      else if (e.name.endsWith('.md')) {
        const parsed = parseLocation(await fs.readFile(full, 'utf-8').catch(() => ''), path.basename(path.dirname(full)));
        if (parsed.slug === slug) return full;
      }
    }
    return null;
  }
  return walk(locRoot);
}

async function getAllLocations(city = DEFAULT_CITY) {
  const lc = _locCache[city];
  if (lc && Date.now() - lc.ts < LOCS_TTL) return lc.locs;

  const locRoot = locsDir(city);
  const result  = [];

  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_') || entry.name === '.gitkeep') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        try {
          const content   = await fs.readFile(fullPath, 'utf-8');
          const locFolder = path.dirname(fullPath);
          const loc       = parseLocation(content, path.basename(locFolder));
          const artDir    = path.join(locFolder, 'art');
          const artFiles  = await fs.readdir(artDir).catch(() => []);
          const imgFiles  = artFiles.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f)).sort();
          if (imgFiles.length) {
            const relParts = path.relative(locRoot, locFolder).split(path.sep);
            const base = `/city-img/${city}/locations/` + relParts.map(p => encodeURIComponent(p)).join('/') + '/art/';
            loc.imageUrl  = base + encodeURIComponent(imgFiles[0]);
            loc.imageUrls = imgFiles.map(f => base + encodeURIComponent(f));
          }
          result.push(loc);
        } catch {}
      }
    }
  }

  await walk(locRoot);
  _locCache[city] = { locs: result, ts: Date.now() };
  return result;
}

// Все модули города: chronicles/<хроника>/modules/<модуль>/ → { name, chronicle, dir }.
async function listModules(city = DEFAULT_CITY) {
  const out = [];
  let chrs;
  try { chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true }); } catch { return out; }
  for (const ch of chrs) {
    if (!ch.isDirectory()) continue;
    const mdir = path.join(chroniclesDir(city), ch.name, 'modules');
    let mods; try { mods = await fs.readdir(mdir, { withFileTypes: true }); } catch { continue; }
    for (const m of mods)
      if (m.isDirectory() && !m.name.startsWith('.'))
        out.push({ name: m.name, chronicle: ch.name, dir: path.join(mdir, m.name) });
  }
  return out;
}

// Open threads are now per-chronicle (chronicles/<chr>/open_threads.md); aggregate them.
async function readOpenThreadsRaw(city = DEFAULT_CITY) {
  let all = '';
  // 1. Archive-level file (primary in older layout)
  const archiveFile = path.join(archiveDir(city), 'open_threads.md');
  const archiveRaw  = await fs.readFile(archiveFile, 'utf-8').catch(() => null);
  if (archiveRaw) all += '\n' + archiveRaw;
  // 2. Per-chronicle files (newer layout)
  let chrs; try { chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true }); } catch { chrs = []; }
  for (const ch of chrs) {
    if (!ch.isDirectory()) continue;
    const raw = await fs.readFile(path.join(chroniclesDir(city), ch.name, 'open_threads.md'), 'utf-8').catch(() => null);
    if (raw) all += '\n' + raw;
  }
  return all;
}

// ── Chronicle event aggregation ────────────────────────────────────────────────
// Shared by routes/chronicles.js (chronicle-level views) and server.js
// (/api/status, /api/integrity, /api/run-tool) — moved here (E1.2) so both sides
// use one implementation instead of drifting.
const RU_MONTH_STEMS = [
  ['январ', 1], ['феврал', 2], ['март', 3], ['апрел', 4], ['мая', 5], ['май', 5],
  ['июн', 6], ['июл', 7], ['август', 8], ['сентябр', 9], ['октябр', 10], ['ноябр', 11], ['декабр', 12]
];

// Numeric sort score for event dates: larger = more recent.
// Handles "Декабрь 2010, начало месяца", "Ноябрь 2010, суббота ~22:00",
// ISO "2010-11-15", plain "март 2010", etc.
function eventDateScore(dateStr) {
  const s = (dateStr || '').toLowerCase();

  // Year
  const yearM = s.match(/(\d{4})/);
  const year  = yearM ? parseInt(yearM[1]) : 0;

  // Month
  let month = 0;
  for (const [stem, n] of RU_MONTH_STEMS) { if (s.includes(stem)) { month = n; break; } }
  // ISO fallback: YYYY-MM or YYYY-MM-DD
  if (!month) { const mm = s.match(/\d{4}-(\d{2})/); if (mm) month = parseInt(mm[1]); }

  // Day within month (1-31 → position 1–31; qualifiers below)
  let day = 15; // default: middle of month
  const isoDay = s.match(/\d{4}-\d{2}-(\d{2})/);
  if (isoDay) {
    day = parseInt(isoDay[1]);
  } else {
    const dayM = s.match(/\b(\d{1,2})\s*(?:числ|д\.)/);
    if (dayM) day = parseInt(dayM[1]);
    else if (/начал|начало/.test(s)) day = 3;
    else if (/середин/.test(s))     day = 15;
    else if (/конец|конца|конц/.test(s)) day = 27;
    else if (/конец\s*мес|late/i.test(s)) day = 27;
  }

  // Hour (for intra-day ordering): "~22:00", "04:00" etc.
  let hour = 12;
  const hrM = s.match(/(\d{1,2}):(\d{2})/);
  if (hrM) hour = parseInt(hrM[1]);

  return year * 100000000 + month * 1000000 + day * 10000 + hour * 100;
}

// Fuzzy name resolver (mirrors the /api/graph relationship matcher). Shared by
// routes/dashboard.js (/api/integrity) and routes/tools.js (buildSessionPlan) — moved
// here (E1.2d) so both use one implementation instead of drifting.
function makeNameResolver(names) {
  const idSet = new Set(names);
  return function resolve(tgt) {
    if (!tgt) return null;
    if (idSet.has(tgt)) return tgt;
    const tl = tgt.toLowerCase();
    for (const id of idSet) if (id.toLowerCase() === tl) return id;
    for (const id of idSet) {
      const il = id.toLowerCase();
      if (il.startsWith(tl) || tl.startsWith(il.split(' ')[0])) return id;
    }
    return null;
  };
}

// charName → { has: bool, files: Set } describing the character's Journal_ folder
async function getDiaryIndex(city, chars) {
  const idx = {};
  for (const c of chars) {
    const jdir  = path.join(charsDir(city), c.lineageFolder, c.slug, 'journal');
    const files = await fs.readdir(jdir).catch(() => null);
    idx[c.name] = files ? { has: true, files: new Set(files) } : { has: false, files: new Set() };
  }
  return idx;
}

function eventMonthKey(dateStr) {
  const s = (dateStr || '').toLowerCase();
  const ym = s.match(/(\d{4})/);
  if (!ym) return null;
  const year = parseInt(ym[1]);
  let month = null;
  for (const [stem, n] of RU_MONTH_STEMS) { if (s.includes(stem)) { month = n; break; } }
  if (!month) return null;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

// Aggregate all ### 📅 events from chronicles/<chr>/events.md (the real per-event detail).
async function aggregateEvents(city = DEFAULT_CITY) {
  const out = [];
  let chrs;
  try { chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true }); } catch { return out; }
  for (const ch of chrs) {
    if (!ch.isDirectory()) continue;
    const raw = await fs.readFile(path.join(chroniclesDir(city), ch.name, 'events.md'), 'utf-8').catch(() => null);
    if (!raw) continue;
    const content = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    content.split(/\n(?=###\s*📅)/).filter(c => /^###\s*📅/.test(c.trim()))
      .forEach(c => { const ev = parseEvent(c.trim(), out.length); ev.chronicle = ch.name; out.push(ev); });
  }
  // Sort newest → oldest by event date
  out.sort((a, b) => eventDateScore(b.date) - eventDateScore(a.date));
  // Re-assign sequential IDs after sort
  out.forEach((ev, i) => { ev.id = i; });
  return out;
}

// Skeleton content for a brand-new chronicle's events.md / open_threads.md.
// Shared by routes/chronicles.js (chronicle create) and server.js (/api/run-tool
// session-plan builder, which can recreate these files for an existing chronicle).
function renderChronicleEventsSkeleton(displayName) {
  return `# 📖 ${displayName} — События\n\n> Хроника города · сводка города — [events.md](../../archive/events.md)\n> Протокол записей — [chronicle.md](../../../../system/rules/chronicle.md)\n\n---\n\n`;
}
function renderOpenThreadsSkeleton(displayName) {
  return `# 🧵 Открытые нити — ${displayName}\n\n| # | Нить | Источник | Статус | Приоритет |\n|---|---|---|---|---|\n\n## 🗂️ Архив закрытых\n\n*(пусто)*\n`;
}

// Recursively find/delete — shared by routes/chronicles.js (chronicle delete
// preview + delete) and routes/modules.js (module delete).
async function findMdFiles(dir) {
  const result = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) result.push(...await findMdFiles(full));
    else if (e.name.endsWith('.md')) result.push(full);
  }
  return result;
}
async function rmdir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await rmdir(p);
    else await fs.unlink(p);
  }
  await fs.rmdir(dir);
}

// ── Fuzzy name matching ────────────────────────────────────────────────────────
// Shared by server.js (/api/characters/:id/dialogue, module-only NPC fallback)
// and routes/modules.js (NPC/location reuse during module fill, npc.md lookups).
// Normalize a name for fuzzy matching (lowercase, ё→е, drop punctuation/emoji)
function _normName(s) {
  return String(s).toLowerCase().replace(/ё/g, 'е')
    .replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
// True if two names plausibly refer to the same entity (token-subset on tokens ≥3 chars)
function _nameMatch(a, b) {
  const na = _normName(a), nb = _normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ').filter(t => t.length >= 3);
  const tb = nb.split(' ').filter(t => t.length >= 3);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every(t => long.includes(t));
}
// Find a modular (non-canon) NPC card inside a module's npc/ folder by character name.
async function _findModularNpcCard(npcRoot, name) {
  const dirs = await fs.readdir(npcRoot, { withFileTypes: true }).catch(() => []);
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const card = await fs.readFile(path.join(npcRoot, d.name, `${d.name}.md`), 'utf-8').catch(() => '');
    if (!card) continue;
    // First heading of any level → strip emoji and «Карточка НПС:»-style prefixes, take part before « — »
    const head = (card.match(/^#{1,6}\s+(.+)$/m)?.[1] || '')
      .replace(/^[^\p{L}]+/u, '')
      .replace(/^карточка\s+нпс\s*:?\s*/i, '')
      .replace(/^нпс\s*:?\s*/i, '');
    const cardName = head.split(/\s*[—–]\s*/)[0];      // «Гиль — модульный НПС» → «Гиль»
    if (_nameMatch(cardName, name) || _nameMatch(head, name) || _normName(head).includes(_normName(name))) {
      const clan = (card.match(/\*\*Клан(?:\s*\/\s*Раса)?:\*\*\s*([^\n|]+)/)?.[1]
                 || card.match(/\|\s*\*\*Клан\*\*\s*\|\s*([^\n|]+)/)?.[1] || '').trim();
      return { card, clan };
    }
  }
  return null;
}

// ── Misc shared helpers ────────────────────────────────────────────────────────
async function countMdFiles(dir) {
  let n = 0;
  try {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isDirectory()) n += await countMdFiles(path.join(dir, item.name));
      else if (item.name.endsWith('.md') && item.name !== 'characters_index.md') n++;
    }
  } catch {}
  return n;
}

// Run `fn` over `items` with bounded concurrency; preserves input order.
// Keeps bulk file reads parallel without exhausting file descriptors.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Extract a markdown table cell "| **Label** | value |" by label → trimmed value or null.
// Memoizes the compiled regex per label (these run in tight label loops over many cards).
const _tableCellRe = new Map();
function tableCell(content, label) {
  let re = _tableCellRe.get(label);
  if (!re) { re = new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|\\n]+)\\|`); _tableCellRe.set(label, re); }
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

// ── Character card: editable field labels ────────────────────────────────────
// Разделяется routes/characters.js (PUT /fields) и server.js (charInfoLines —
// подмешивание карточных фактов в AI-промты генерации).
const EDITABLE_FIELD_MAP = {
  clan:         'Клан',
  sect:         'Секта',
  generation:   'Поколение',
  birthYear:    'Год рождения',
  embraceYear:  'Год обращения',
  sire:         'Сир',
  childe:       'Дитя',
  location:     'Домен / Локация',
  hierarchy:    'Иерархия в городе',
  derangements: 'Деранжементы / Особенности',
  disciplines:  'Дисциплины',
  profession:   'Профессия',
  role:         'Роль',
  belonging:    'Принадлежность',
  biography:    'Биография',
  appearance:   'Внешность',
  voice:        'Голос',
  personality:  'Характер',
  nature:       'Натура',
  demeanor:     'Маска',
  concept:      'Амплуа',
  // ── Линейко-специфичные поля (феи/смертные/иное) ──
  race:         'Раса',
  kith:         'Род',
  court:        'Двор',
  title:        'Титул',
  features:     'Особенности / Способности',
  relatives:    'Родственники',
  attitude:     'Отношение к сверхъестественному',
};

// Card fields that are mirrored in the V20 sheet's «🧩 Шапка» header table — kept in
// sync both ways: edits to the card push into an existing sheet (see _syncSheetHeader),
// and a freshly (re)generated sheet has these re-stamped from the card so the AI can't
// drift them from what's already known (see _generateV20Sheet's post-process below).
const SHEET_HEADER_FROM_CARD = {
  name: 'Имя', clan: 'Клан', generation: 'Поколение', sire: 'Сир',
  nature: 'Натура', demeanor: 'Маска', concept: 'Амплуа',
};

// Replace the value cell of a «| **Label...** | value |» row in the sheet's header
// table. Matches the label by prefix (handles suffixes like «Клан (Clan)»). No-op if
// the row isn't found — never fabricates table structure that isn't already there.
function _setSheetHeaderCell(md, labelPrefix, value) {
  const escaped = String(labelPrefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(\\|\\s*\\*\\*${escaped}[^*]*\\*\\*\\s*\\|\\s*)[^|]*(\\|)`, 'm');
  return re.test(md) ? md.replace(re, (_, pre, post) => `${pre}${value} ${post}`) : md;
}

module.exports = {
  ROOT, CITIES_DIR, DEFAULT_CITY,
  cityDir, charsDir, locsDir, chroniclesDir, archiveDir,
  reqCity, listCities,
  writeFileAtomic,
  CHARS_TTL, LOCS_TTL,
  invalidateChars, invalidateLocs,
  getBrokenLinks, setBrokenLinks,
  LINEAGE_MAP,
  getAllCharacters, getAllLocations, findLocMdPath, listModules,
  readOpenThreadsRaw,
  countMdFiles, mapLimit, tableCell,
  EDITABLE_FIELD_MAP, SHEET_HEADER_FROM_CARD, _setSheetHeaderCell,
  RU_MONTH_STEMS, eventDateScore, aggregateEvents,
  makeNameResolver, getDiaryIndex, eventMonthKey,
  renderChronicleEventsSkeleton, renderOpenThreadsSkeleton,
  findMdFiles, rmdir,
  _normName, _nameMatch, _findModularNpcCard,
};
