'use strict';
// Слой данных: раскладка cities/<city>/…, атомарная запись, кэши персонажей и
// локаций с TTL, загрузчики getAllCharacters/getAllLocations. Единственный
// владелец кэшей — инвалидация только через invalidateChars/invalidateLocs.
// Вынесено из server.js (E1.1) как база для доменных роутеров (routes/*.js).

const path = require('path');
const fs   = require('fs').promises;
const { parseCharacter, parseLocation } = require('./parsers');

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

module.exports = {
  ROOT, CITIES_DIR, DEFAULT_CITY,
  cityDir, charsDir, locsDir, chroniclesDir, archiveDir,
  reqCity, listCities,
  writeFileAtomic,
  CHARS_TTL, LOCS_TTL,
  invalidateChars, invalidateLocs,
  LINEAGE_MAP,
  getAllCharacters, getAllLocations, findLocMdPath, listModules,
  countMdFiles, mapLimit, tableCell,
};
