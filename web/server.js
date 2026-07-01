const express = require('express');
const compression = require('compression');
const path    = require('path');
const fs      = require('fs').promises;
const crypto  = require('crypto');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');
const {
  RU_MONTHS_NOM, THREAD_STATUS, slugify, parseDiary, readPrompt, writePrompt,
  buildCityMd, parseCityMd, cityScaffold,
  periodLabel, threadStatusKey, parseThreadsContent,
  mdExtractLinks, mdStripLinks, mdStripInline, classifyChronicleLink,
  categorizeRel, parseCharacter, parseLocation, parseChronicleLocation,
  parseParticipant, parseTable, parseWorldState, parseEvent, parseChronicle,
  parseChronicleParticipants,
} = require('./lib/parsers');
const { parseDisciplineMd } = require('./lib/disciplines');
const { parsePsychicMd } = require('./lib/psychics');
const { runMigrations } = require('./lib/migrations');
const { loadLiteraryStyle, loadDiaryStyleRules, compressEventsToState, compressChronicleEvents, parseEventsText, buildNarrativeContext, findCharacterCard } = require('./lib/context_builder');

// Load .env file (secrets not committed to git)
try {
  const envRaw = require('fs').readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of envRaw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

// Route fetch through system proxy if HTTPS_PROXY is set (needed for Gemini SDK etc.)
{
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  if (proxyUrl) {
    try {
      const { setGlobalDispatcher, ProxyAgent } = require('undici');
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
      console.log('[proxy] fetch routed via', proxyUrl);
    } catch (e) {
      console.warn('[proxy] undici ProxyAgent недоступен:', e.message);
    }
  }
}

const app  = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const ROOT = path.join(__dirname, '..');

// ── City layer (cities/<city>/…) ───────────────────────────────────────────────
const CITIES_DIR   = path.join(ROOT, 'cities');
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

let _cache    = {};          // city → { chars, ts }
let _locCache = {};          // city → { locs, ts }
const CHARS_TTL = 15_000;
const LOCS_TTL  = 15_000;

// Last known broken-link count from validate_links.ps1.
// null = never validated; 0 = clean; N = N broken links remaining.
let _brokenLinks = null;

app.use(compression());
app.use(express.json({ limit: '20mb' }));
// maxAge lets the browser reuse the heavy app shell between loads; ETag/Last-Modified
// still revalidate after it expires, so edits during development surface within minutes.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
// Serve images straight out of cities/<city>/… (characters/<lin>/<slug>/art/, locations/…)
app.use('/city-img', express.static(CITIES_DIR, { maxAge: '1h' }));

// ── Request logger ────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  magenta:'\x1b[35m',
  gray:   '\x1b[90m',
};

// Unified 500 response. Always logs the full error (many per-route catches previously
// returned e.message to the client WITHOUT logging it), and returns a stable envelope
// instead of leaking internal messages/paths/stacks. Intentional user-facing errors
// stay as their own explicit res.status(...).json({error: '…'}) calls.
function serverError(res, e) {
  console.error(`${C.red}[error]${C.reset}`, e?.stack || e?.message || e);
  if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка сервера — подробности в логе сервера.' });
}

// Human-readable action descriptions for API routes
const ACTION_MAP = {
  'GET /api/status':                          () => 'Дашборд — загрузка статистики',
  'GET /api/characters':                      req => `Персонажи — загрузка (город: ${reqCity(req)})`,
  'GET /api/characters/all-images':           req => `Карусель — загрузка всех артов (${reqCity(req)})`,
  'GET /api/characters/:slug/images':         req => `Арты персонажа: ${decodeURIComponent(req.params.slug)}`,
  'GET /api/characters/:slug/diary':          req => `Дневник: ${decodeURIComponent(req.params.slug)} → ${req.query.file || '?'}`,
  'DELETE /api/characters/:slug/diary':       req => `🗑 Удаление записи дневника: ${decodeURIComponent(req.params.slug)} → ${req.query.file || '?'}`,
  'PUT /api/characters/:slug/fields':         req => `✏  Редактирование полей: ${decodeURIComponent(req.params.slug)}`,
  'PUT /api/characters/:slug/relations':      req => `✏  Редактирование отношений: ${decodeURIComponent(req.params.slug)}`,
  'POST /api/characters/:slug/upload-image':  req => `📷 Загрузка изображения → ${decodeURIComponent(req.params.slug)}`,
  'POST /api/characters/:slug/generate-appearance': req => `🤖 Генерация внешности: ${decodeURIComponent(req.params.slug)}`,
  'POST /api/characters/:slug/generate-prompt':    req => `🎨 Генерация промта: ${decodeURIComponent(req.params.slug)}`,
  'POST /api/characters/:slug/generate-personality': req => `🎭 Генерация характера и голоса: ${decodeURIComponent(req.params.slug)}`,
  'POST /api/characters/:slug/generate-biography':   req => `📖 Генерация биографии: ${decodeURIComponent(req.params.slug)}`,
  'DELETE /api/characters/:slug/images/:filename':  req => `🗑 Удаление изображения: ${decodeURIComponent(req.params.filename)} ← ${decodeURIComponent(req.params.slug)}`,
  'GET /api/locations':                       req => `Локации — загрузка (${reqCity(req)})`,
  'GET /api/locations/:slug/images':          req => `Арты локации: ${decodeURIComponent(req.params.slug)}`,
  'PUT /api/locations/:slug/fields':          req => `✏  Редактирование локации: ${decodeURIComponent(req.params.slug)}`,
  'POST /api/locations/:slug/upload-image':   req => `📷 Загрузка изображения локации → ${decodeURIComponent(req.params.slug)}`,
  'GET /api/graph':                           req => `Граф связей (${reqCity(req)})`,
  'POST /api/chronicles/:slug/recap':         req => `📺 Рекап «Ранее в хронике…»: ${req.params.slug}`,
  'GET /api/modules':                         req => `Модули — загрузка (${reqCity(req)})`,
  'GET /api/modules/:name':                   req => `Модуль: ${decodeURIComponent(req.params.name)}`,
  'GET /api/chronicle':                       req => `Хроника (${reqCity(req)})`,
  'GET /api/threads':                         req => `Открытые нити (${reqCity(req)})`,
  'GET /api/integrity':                       req => `Проверка целостности (${reqCity(req)})`,
  'GET /api/auth-status':                     () => 'Статус авторизации Claude',
  'PUT /api/factions':  req => `✏  Фракции — сохранение (${reqCity(req)})`,
  'PUT /api/timeline':  req => `✏  Хронология — сохранение (${reqCity(req)})`,
  'PUT /api/visitors':  req => `✏  Визитёры — сохранение (${reqCity(req)})`,
  'PUT /api/rumors':    req => `✏  Слухи — сохранение (${reqCity(req)})`,
  'GET /api/search':    req => `🔍 Поиск: «${req.query.q || ''}» (${reqCity(req)})`,
  'POST /api/tool/:name':                     req => `🔧 Инструмент: ${req.params.name} [args: ${(req.body?.args||[]).join(', ')}]`,
  'POST /api/run-tool':                       req => `🔧 PS-инструмент: ${req.body?.tool}`,
  'POST /api/log-session':                    () => 'Запись сессии',
  'POST /api/claude/generate-prose':          req => `🤖 Генерация текста (${req.body?.type || '?'})`,
  'GET /api/claude/health':                   () => 'Claude API — проверка',
};

function matchRoute(method, url) {
  const pathname = url.split('?')[0];
  const parts = pathname.split('/');
  for (const [key, fn] of Object.entries(ACTION_MAP)) {
    const [km, kp] = key.split(' ');
    if (km !== method) continue;
    const kparts = kp.split('/');
    if (kparts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < kparts.length; i++) {
      if (kparts[i].startsWith(':')) { params[kparts[i].slice(1)] = parts[i]; }
      else if (kparts[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { fn, params };
  }
  return null;
}

app.use((req, res, next) => {
  // Skip static files and image serving
  if (!req.path.startsWith('/api/')) return next();

  const start = Date.now();
  const match = matchRoute(req.method, req.path);

  res.on('finish', () => {
    const ms   = Date.now() - start;
    const code = res.statusCode;
    const codeColor = code < 300 ? C.green : code < 400 ? C.cyan : code < 500 ? C.yellow : C.red;
    const codeStr = `${codeColor}${code}${C.reset}`;
    const timeStr = ms > 500 ? `${C.yellow}${ms}ms${C.reset}` : `${C.gray}${ms}ms${C.reset}`;

    let action = '';
    if (match) {
      // inject params into req for the action function
      const fakeReq = Object.assign(Object.create(req), { params: match.params });
      try { action = match.fn(fakeReq); } catch { action = req.path; }
    }

    const methodColor = { GET: C.cyan, POST: C.green, PUT: C.yellow, DELETE: C.red }[req.method] || C.reset;
    const methodStr = `${methodColor}${req.method.padEnd(4)}${C.reset}`;

    if (action) {
      console.log(`${C.dim}[web]${C.reset} ${methodStr} ${codeStr} ${timeStr}  ${action}`);
    } else if (code >= 400) {
      console.log(`${C.dim}[web]${C.reset} ${methodStr} ${codeStr} ${timeStr}  ${C.dim}${req.path}${C.reset}`);
    }
    // 2xx for unknown routes — skip (noise)
  });

  next();
});

// ── Markdown / card / chronicle parsers ───────────────────────────────────────
// categorizeRel, parseCharacter, parseLocation, parseChronicle* and the md* helpers
// now live in lib/parsers.js (single source of truth — see import at top).

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

// parseDiary lives in lib/parsers.js (single source of truth — see import above)

// parseLocation lives in lib/parsers.js (single source of truth — see import at top).

async function findLocMdPath(slug, city = DEFAULT_CITY) {
  const locRoot = locsDir(city);
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
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
      if (entry.name.startsWith('.') || entry.name === '.gitkeep') continue;
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

// ── Chronicle parser (Stories_of_*.md) ────────────────────────────────────────

// City chronicle file = cities/<city>/archive/events.md (World State + aggregate index).
// Full per-event entries live in cities/<city>/chronicles/<chr>/events.md.
async function findChronicleFile(city = DEFAULT_CITY) {
  const f = path.join(archiveDir(city), 'events.md');
  return fs.access(f).then(() => f).catch(() => null);
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

// Modules now live under chronicles/<chr>/modules/<mod>/ — flatten them with their chronicle.
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
const MOD_AUX = n => ['npc.md', 'scenario.md', 'finale.md'].includes(n) || n.endsWith('-sheet.md');

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

// All threads across archive + per-chronicle files, each tagged with its file.
async function readThreadsStructured(city = DEFAULT_CITY) {
  const threads = [];
  const archRel = 'archive/open_threads.md';
  const archRaw = await fs.readFile(path.join(cityDir(city), archRel), 'utf-8').catch(() => null);
  if (archRaw) threads.push(...parseThreadsContent(archRaw, archRel));
  let chrs; try { chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true }); } catch { chrs = []; }
  for (const ch of chrs) {
    if (!ch.isDirectory()) continue;
    const rel = `chronicles/${ch.name}/open_threads.md`;
    const raw = await fs.readFile(path.join(cityDir(city), rel), 'utf-8').catch(() => null);
    if (raw) threads.push(...parseThreadsContent(raw, rel));
  }
  return threads;
}

// Whitelist + resolve a city-relative thread file to an absolute path (no traversal).
function resolveThreadFile(city, rel) {
  if (!/^(archive\/open_threads\.md|chronicles\/[^/]+\/open_threads\.md)$/.test(rel || '')) return null;
  return path.join(cityDir(city), rel);
}

// md* helpers + parseChronicle* live in lib/parsers.js (single source of truth — see import at top).

// ── Integrity checks ───────────────────────────────────────────────────────────

// Fuzzy name resolver (mirrors the /api/graph relationship matcher)
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

const RU_MONTH_STEMS = [
  ['январ', 1], ['феврал', 2], ['март', 3], ['апрел', 4], ['мая', 5], ['май', 5],
  ['июн', 6], ['июл', 7], ['август', 8], ['сентябр', 9], ['октябр', 10], ['ноябр', 11], ['декабр', 12]
];
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

// ── Background validation ─────────────────────────────────────────────────────

// Run validate_links.ps1 silently; store exit code as brokenLinks count.
// Called automatically after tools that modify project files.
function runValidationBackground() {
  const script = path.join(ROOT, 'tools', 'validate_links.ps1');
  const cmd = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    `& '${script.replace(/\\/g, '\\\\').replace(/'/g, "''")}' -Force`
  ].join('; ');
  const ps = spawn('powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', cmd],
    { cwd: ROOT, env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' } });
  ps.stdout.resume();
  ps.stderr.resume();
  ps.on('close', code => { _brokenLinks = code; });
}

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/status', async (req, res) => {
  try {
    const city  = reqCity(req);
    const chars = await getAllCharacters(city);

    let modules = 0;
    try { modules = (await listModules(city)).length; } catch {}

    let locations = 0;
    try { locations = await countMdFiles(locsDir(city)); } catch {}

    let openThreads = 0;   // только активные/фоновые (исключая 🟢 закрытые)
    try {
      openThreads = (await readOpenThreadsRaw(city)).split('\n')
        .filter(l => /^\| \d+\s*\|/.test(l) && !/🟢/.test(l)).length;
    } catch {}

    let events = 0;
    try { events = (await aggregateEvents(city)).length; } catch {}

    let domain = 'Домен не настроен';
    try {
      const cm = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8');
      const dm = cm.match(/^#\s+(.+?)\s*$/m);
      if (dm) domain = dm[1].replace(/\s*—\s*сеттинг города/i, '').trim();
    } catch {}

    res.json({
      domain,
      city,
      cities: await listCities(),
      characters: chars.length,
      vampires:   chars.filter(c => c.lineage === 'vampire').length,
      fairies:    chars.filter(c => c.lineage === 'fairy').length,
      mortals:    chars.filter(c => c.lineage === 'mortal').length,
      werewolves: chars.filter(c => c.lineage === 'werewolf').length,
      mages:      chars.filter(c => c.lineage === 'mage').length,
      hunters:    chars.filter(c => c.lineage === 'hunter').length,
      active:     chars.filter(c => c.statusType === 'active').length,
      torpor:     chars.filter(c => c.statusType === 'torpor').length,
      modules,
      locations,
      openThreads,
      events,
      brokenLinks: _brokenLinks   // null = never validated, 0 = clean, N = broken
    });
  } catch (e) { serverError(res, e); }
});

app.get('/api/characters', async (req, res) => {
  try { res.json(await getAllCharacters(reqCity(req))); }
  catch (e) { serverError(res, e); }
});

app.get('/api/cities', async (req, res) => {
  try { res.json({ cities: await listCities(), default: DEFAULT_CITY }); }
  catch (e) { serverError(res, e); }
});

// Card-friendly summary of every city in cities/ — used by the «Домены» tab.
app.get('/api/cities/summary', async (req, res) => {
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
app.get('/api/cities/:slug/detail', async (req, res) => {
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
app.post('/api/cities', express.json(), async (req, res) => {
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

    delete _cache[slug];
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
app.put('/api/cities/:slug', express.json(), async (req, res) => {
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
    delete _cache[slug];
    console.log(`[edit-city] ${slug}`);
    res.json({ ok: true, slug, parsed: parseCityMd(cityMd) });
  } catch (e) {
    console.error('[edit-city]', e.message);
    serverError(res, e);
  }
});

// DELETE /api/cities/:slug — soft-delete (move to cities/_deleted/<slug>), reversible and
// image-safe (gitignored art is moved, not erased). Refuses to delete the last city.
app.delete('/api/cities/:slug', async (req, res) => {
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

    delete _cache[slug];
    console.log(`[delete-city] ${slug} → ${path.relative(ROOT, dest)}`);
    res.json({ ok: true, slug, movedTo: path.relative(ROOT, dest).replace(/\\/g, '/') });
  } catch (e) {
    console.error('[delete-city]', e.message);
    serverError(res, e);
  }
});

app.get('/api/chronicles', async (req, res) => {
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

// Rebuild modules section in chronicle.md from current modules/ dir
async function syncChronicleModuleLinks(city, chr) {
  const chrDir = path.join(chroniclesDir(city), chr);
  const chrMdPath = path.join(chrDir, 'chronicle.md');
  const raw = await fs.readFile(chrMdPath, 'utf-8').catch(() => null);
  if (!raw) return; // no chronicle.md (older chronicle)

  // Read current modules
  let mEntries; try { mEntries = await fs.readdir(path.join(chrDir, 'modules'), { withFileTypes: true }); } catch { mEntries = []; }
  const mods = mEntries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => {
      // Try to read title from main md file
      let title = e.name;
      try {
        const mainTxt = require('fs').readFileSync(path.join(chrDir, 'modules', e.name, `${e.name}.md`), 'utf-8');
        const hm = mainTxt.match(/^#\s+(.+)$/m);
        if (hm) title = hm[1].replace(/[*[\]]/g, '').trim();
      } catch {}
      return { slug: e.name, title };
    });

  // Replace or add ## 🔗 Модули section
  const modsSection = mods.length
    ? `\n## 🔗 Модули\n\n${mods.map(m => `- [${m.title}](modules/${m.slug}/${m.slug}.md)`).join('\n')}\n`
    : '';

  let updated;
  if (/^## 🔗 Модули/m.test(raw)) {
    // Replace existing section
    updated = raw.replace(/\n## 🔗 Модули[\s\S]*?(?=\n## |\n---|\s*$)/, modsSection);
  } else {
    updated = raw.trimEnd() + '\n' + modsSection;
  }

  if (updated !== raw) await writeFileAtomic(chrMdPath, updated, 'utf-8');
}

app.post('/api/chronicles', express.json(), async (req, res) => {
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
    delete _cache[city];
    res.json({ ok: true, slug, display });
  } catch (e) {
    console.error('[create-chronicle]', e.message);
    serverError(res, e);
  }
});

// ── Chronicle delete helpers ──────────────────────────────────────────────────

// Parse participant names from events.md (lines under 👥 Участники:)
// parseChronicleParticipants lives in lib/parsers.js (single source of truth — see import at top).

// Find all .md files recursively
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

// Recursively delete directory
async function rmdir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await rmdir(p);
    else await fs.unlink(p);
  }
  await fs.rmdir(dir);
}

// Build preview of what delete would do
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

// ── Chronicle delete preview ──────────────────────────────────────────────────

app.get('/api/chronicles/:slug/delete-preview', async (req, res) => {
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

app.delete('/api/chronicles/:slug', express.json(), async (req, res) => {
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
    delete _cache[city];
    runValidationBackground();

    res.json({ ok: true, slug, moved });
  } catch (e) {
    console.error('[delete-chronicle]', e.message);
    serverError(res, e);
  }
});

app.get('/api/graph', async (req, res) => {
  try {
    const chars = await getAllCharacters(reqCity(req));
    const nodes = chars.map(c => ({
      id: c.name, lineage: c.lineage,
      clan: c.clan || '', status: c.statusType, generation: c.generation || null
    }));

    const idSet = new Set(nodes.map(n => n.id));

    function resolveTarget(tgt) {
      if (idSet.has(tgt)) return tgt;
      for (const id of idSet) {
        const tl = tgt.toLowerCase(), il = id.toLowerCase();
        if (il.startsWith(tl) || tl.startsWith(il.split(' ')[0])) return id;
      }
      return null;
    }

    const links = [];
    const seen  = new Set();
    for (const c of chars) {
      for (const r of c.relationships) {
        const tgt = resolveTarget(r.target);
        if (!tgt || tgt === c.name) continue;
        const key = [c.name, tgt].sort().join('\x00');
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: c.name, target: tgt, type: r.type,
                     label: r.description.split(';')[0].slice(0, 55),
                     fromChar: c.name, description: r.description });
      }
    }

    res.json({ nodes, links });
  } catch (e) { serverError(res, e); }
});

app.get('/api/modules', async (req, res) => {
  try {
    const city = reqCity(req);
    const mods = [];
    for (const it of await listModules(city)) {
      const mod = { name: it.name, title: it.name, chronicle: it.chronicle };
      try {
        const names = (await fs.readdir(it.dir, { withFileTypes: true })).filter(f => f.isFile()).map(f => f.name);
        mod.hasScenario = names.includes('scenario.md');
        mod.hasFinale   = names.includes('finale.md');
        mod.hasNpc      = names.includes('npc.md');
        // Main file is named after the folder (<slug>.md); fall back to first non-aux .md
        const mainFile = names.includes(`${it.name}.md`) ? `${it.name}.md`
          : names.find(n => n.endsWith('.md') && !MOD_AUX(n));
        if (mainFile) {
          const content = (await fs.readFile(path.join(it.dir, mainFile), 'utf-8')).replace(/^﻿/, '');
          const hm = content.match(/^#\s+(.+)$/m);
          if (hm) mod.title = hm[1].replace(/[*[\]]/g, '').trim();
          for (const [label, key] of [['Тип','type'],['Формат','format'],['Время','time'],['Тон','tone']]) {
            const v = tableCell(content, label);
            if (v != null) mod[key] = v;
          }
        }
      } catch {}
      mods.push(mod);
    }
    res.json(mods);
  } catch (e) { serverError(res, e); }
});

// ── Events for one chronicle ──────────────────────────────────────────────────

app.get('/api/chronicles/:slug/events', async (req, res) => {
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

app.post('/api/chronicles/:slug/recap', express.json(), async (req, res) => {
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

    let recap = '';
    if (_isOA(gen)) {
      const modelsToTry = _oaModels(gen);
      let lastErr, allRateLimited = true;
      for (const m of modelsToTry) {
        try {
          recap = await _oaCall(gen)(m, systemPrompt, userPrompt, [], 75000, 600);
          allRateLimited = false;
          break;
        } catch (e) {
          lastErr = e;
          const is429 = e.status === 429;
          const retryable = e.status === 404 || e.status === 502 || is429 || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message))
            || (e.status === 403 && /moderation|flagged/i.test(e.message));
          if (!retryable) { allRateLimited = false; throw e; }
          if (!is429) allRateLimited = false;
          if (is429) await new Promise(r => setTimeout(r, 800));
        }
      }
      if (!recap) {
        if (allRateLimited) return res.status(429).json({ rateLimited: true, error: 'Превышен лимит запросов ко всем моделям. Подождите минуту и попробуйте снова.' });
        throw lastErr;
      }
    } else {
      const model = VALID_MODELS.includes(req.body?.model) ? req.body.model : 'claude-haiku-4-5-20251001';
      const message = await gen.client.messages.create({
        model, max_tokens: 600, system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      recap = message.content[0]?.text?.trim() || '';
    }

    if (!recap) return res.status(500).json({ error: 'Модель вернула пустой ответ. Попробуйте ещё раз.' });
    res.json({ ok: true, recap, eventsUsed: recent.length, source: gen.source });
  } catch (e) {
    const status = e.status ?? 500;
    const msg    = e.error?.error?.message ?? e.message ?? String(e);
    console.error(`[chronicle-recap] ${status}`, msg);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
});

// ── Modules by chronicle ──────────────────────────────────────────────────────

app.get('/api/chronicles/:slug/modules', async (req, res) => {
  try {
    const city = reqCity(req);
    const slug = req.params.slug;
    const chrDir = path.join(chroniclesDir(city), slug);
    if (!await fs.stat(chrDir).catch(() => null)) return res.status(404).json({ error: 'Хроника не найдена' });

    const mods = [];
    let mEntries; try { mEntries = await fs.readdir(path.join(chrDir, 'modules'), { withFileTypes: true }); } catch { mEntries = []; }

    for (const e of mEntries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir   = path.join(chrDir, 'modules', e.name);
      const mod   = { name: e.name, title: e.name, chronicle: slug };
      try {
        const names = (await fs.readdir(dir, { withFileTypes: true })).filter(f => f.isFile()).map(f => f.name);
        mod.hasScenario = names.includes('scenario.md');
        mod.hasFinale   = names.includes('finale.md');
        mod.hasNpc      = names.includes('npc.md');
        const mainFile  = names.includes(`${e.name}.md`) ? `${e.name}.md` : names.find(n => n.endsWith('.md') && !MOD_AUX(n));
        if (mainFile) {
          const content = (await fs.readFile(path.join(dir, mainFile), 'utf-8')).replace(/^﻿/, '');
          const hm = content.match(/^#\s+(.+)$/m);
          if (hm) mod.title = hm[1].replace(/[*[\]]/g, '').trim();
          for (const [label, key] of [['Тип','type'],['Формат','format'],['Время','time'],['Тон','tone']]) {
            const v = tableCell(content, label);
            if (v != null) mod[key] = v;
          }
        }
      } catch {}
      mods.push(mod);
    }
    res.json(mods);
  } catch (e) { serverError(res, e); }
});

// ── Create module in chronicle ────────────────────────────────────────────────

app.post('/api/chronicles/:slug/modules', express.json(), async (req, res) => {
  try {
    const city   = reqCity(req);
    const chr    = req.params.slug;
    const { name, time } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Укажи название модуля' });
    if (!time?.trim()) return res.status(400).json({ error: 'Укажи время/дату модуля — это нужно для проверки таймлайна (желательно с годом)' });

    const modSlug = req.body.slug?.trim() || slugify(name.trim());
    if (!modSlug) return res.status(400).json({ error: 'Не удалось сформировать slug' });

    const modDir = path.join(chroniclesDir(city), chr, 'modules', modSlug);
    if (await fs.stat(modDir).catch(() => null))
      return res.status(409).json({ error: `Модуль «${modSlug}» уже существует` });

    await fs.mkdir(modDir, { recursive: true });
    const timeStr   = (time || '').trim();
    const pcs       = Array.isArray(req.body.pcs)  ? req.body.pcs  : [];
    const npcs      = Array.isArray(req.body.npcs) ? req.body.npcs : [];
    const concept   = (req.body.content || '').trim();
    const track     = req.body.trackInChronology !== false; // default true

    const pcBlock  = pcs.length  ? pcs.map(n  => `  - ${n} — Персонаж игрока`).join('\n') : '  - ⚠️ Уточнить';
    const npcBlock = npcs.length ? npcs.map(n => `  - ${n} — НПС`).join('\n')             : '  - ⚠️ Уточнить';

    const mainContent = [
      `# ${name.trim()}`,
      '> Хроника | Vampire: The Masquerade V20 / Changeling: The Dreaming',
      '',
      '> 🔗 [Хроника](../../events.md)',
      '',
      '---',
      '',
      '| Параметр | Значение |',
      '|---|---|',
      `| **Тип** | Игровая сессия |`,
      `| **Время** | ${timeStr || '⚠️ Уточнить'} |`,
      '| **Локация** |  |',
      `| **Учитывать в хронологии** | ${track ? 'да' : 'нет'} |`,
      '',
      '---',
      '',
      '## 👥 Участники',
      '',
      '**Персонажи игроков:**',
      pcBlock,
      '',
      '**НПС:**',
      npcBlock,
      '',
      ...(concept ? [
        '---',
        '',
        '## 💡 Концепция',
        '',
        concept,
        '',
      ] : [
        '---',
        '',
        '*Краткое содержание — см. запись хроники.*',
        '',
      ]),
    ].join('\n');

    await writeFileAtomic(path.join(modDir, `${modSlug}.md`), mainContent, 'utf-8');
    await syncChronicleModuleLinks(city, chr);
    console.log(`[create-module] ${city}/${chr}/modules/${modSlug}`);
    res.json({ ok: true, slug: modSlug, title: name.trim() });
  } catch (e) {
    console.error('[create-module]', e.message);
    serverError(res, e);
  }
});

// ── Fill module: generate scenario.md ────────────────────────────────────────

app.post('/api/chronicles/:chr/modules/:mod/fill', express.json(), async (req, res) => {
  try {
    const city    = reqCity(req);
    const { chr, mod } = req.params;
    const { pcs = [], npcs = [] } = req.body || {};
    let content = (req.body.content || '').trim();

    // If content not provided, try to read it from the module's 💡 Концепция section
    if (!content) {
      const mainTxtForConcept = await fs.readFile(
        path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`), 'utf-8').catch(() => '');
      const conceptMatch = mainTxtForConcept.match(/## 💡 Концепция\s*\n+([\s\S]*?)(?=\n##|\n---|\s*$)/);
      if (conceptMatch) content = conceptMatch[1].trim();
    }

    if (!content) return res.status(400).json({ ok: false, error: 'Не заполнено поле «Содержание модуля» и концепция не найдена в файле модуля.' });

    // Read module rules
    const moduleRules = await fs.readFile(
      path.join(ROOT, 'system', 'rules', 'module_rules.md'), 'utf-8').catch(() => '');
    const cityMd = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8').catch(() => '');

    // Read character cards for participants + build a timeline/relations digest
    const chars = await getAllCharacters(city);
    const charCards   = [];
    const charDigests = [];
    for (const name of [...pcs, ...npcs]) {
      const ch = chars.find(c => c.name === name || c.name.toLowerCase() === name.toLowerCase());
      if (!ch) continue;
      const cardPath = path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}.md`);
      const card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
      if (!card) continue;
      const kind = pcs.includes(name) ? 'ПК' : 'НПС';
      charCards.push(`### ${ch.name} (${kind})\n${card.slice(0, 2000)}`);
      charDigests.push(_charTimelineDigest(ch.name, kind, card));
    }

    // Read module title from main file
    const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
    const mainTxt = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
    const titleM  = mainTxt.match(/^#\s+(.+)$/m);
    const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;

    // Module date — for the timeline check (year falls back to the chronicle slug/spine)
    const chronicleMd = await fs.readFile(path.join(chroniclesDir(city), chr, 'chronicle.md'), 'utf-8').catch(() => '');
    const modTime   = (mainTxt.match(/\|\s*\*\*Время\*\*\s*\|\s*([^|\n]+)\|/)?.[1] || '').replace(/⚠️.*/, '').trim();
    const yearGuess = mainTxt.match(/\b(?:19|20)\d{2}\b/)?.[0]
                   || chr.match(/(?:19|20)\d{2}/)?.[0]
                   || chronicleMd.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
    const moduleWhen = [modTime || '', (yearGuess && !modTime.includes(yearGuess)) ? `(${yearGuess})` : '']
      .filter(Boolean).join(' ') || '(не указано)';

    // Catalogs of existing entities — so the AI REUSES them (by exact name) instead of inventing duplicates
    const allLocs    = await getAllLocations(city).catch(() => []);
    const npcCatalog = chars.map(c => `- ${c.name}${c.clan ? ` (${c.clan})` : ''}`).slice(0, 60).join('\n') || '(нет)';
    const locCatalog = allLocs.map(l => `- ${l.name}${l.district ? ` — ${l.district}` : ''}`).slice(0, 60).join('\n') || '(нет)';

    const systemPrompt = `Ты — Мастер (Рассказчик) в Vampire: The Masquerade V20. Создаёшь сценарий модуля по правилам игры.

# ПРАВИЛА МОДУЛЕЙ
${moduleRules.slice(0, 3000)}

# СЕТТИНГ ГОРОДА
${cityMd.slice(0, 2000)}

# УЧАСТНИКИ МОДУЛЯ
${charCards.join('\n\n') || '(не указаны)'}

# ТАЙМЛАЙН И СВЯЗИ УЧАСТНИКОВ (статус, роль, даты и связи — для проверки совместимости с датой модуля)
${charDigests.join('\n\n') || '(нет данных)'}

# СУЩЕСТВУЮЩИЕ НПС (переиспользуй их ИМЕНА БЕЗ ИЗМЕНЕНИЙ, если подходят по смыслу; новых вводи только при необходимости)
${npcCatalog}

# СУЩЕСТВУЮЩИЕ ЛОКАЦИИ — формат «Название — Округ» (переиспользуй НАЗВАНИЯ БЕЗ ИЗМЕНЕНИЙ, если подходят)
${locCatalog}
# ПРАВИЛО ТИПОВЫХ ЛОКАЦИЙ: не выдумывай новых названий для типовых мест (станция метро, кафе, переулок, катакомбы), если в каталоге уже есть место ТОГО ЖЕ ТИПА — используй существующее (по названию). Новое типовое место вводи ТОЛЬКО если действие переносится в округ, где такого места ещё нет; тогда привяжи его к конкретному округу.`;

    const userPrompt = `Создай полный сценарий (scenario.md) для модуля «${modTitle}» по следующей идее:

${content}

Время действия модуля: ${moduleWhen}
Персонажи игроков: ${pcs.length ? pcs.join(', ') : '(не указаны)'}
НПС: ${npcs.length ? npcs.join(', ') : '(не указаны)'}

ВАЖНО — переиспользование: сначала проверь списки «СУЩЕСТВУЮЩИЕ НПС» и «СУЩЕСТВУЮЩИЕ ЛОКАЦИИ» — если кто-то/что-то подходит, используй ИХ ИМЕНА ДОСЛОВНО. Новых вводи только если среди существующих нет подходящих.

ВАЖНО — проверка таймлайна: сверь дату «${moduleWhen}» с разделом «ТАЙМЛАЙН И СВЯЗИ УЧАСТНИКОВ». Если на эту дату персонаж НЕ МОГ участвовать или его статус/роль был ИНЫМ (ещё не на должности, в торпоре, ещё не обращён/не прибыл, уже уничтожен) — обязательно это отметь. В САМОМ НАЧАЛЕ сценария добавь раздел «## ⚠️ Проверка таймлайна» с предупреждениями Мастеру по каждому такому персонажу: что именно не сходится и как это обыграть (заменить, понизить статус, объяснить присутствие). Если конфликтов нет — напиши «Конфликтов таймлайна не выявлено».

ВАЖНО — связи: учитывай СВЯЗИ между персонажами (раздел «Связи» в таймлайне) — вплетай их в мотивации, конфликты и сцены, а не игнорируй.

ВАЖНО — НПС: КАЖДЫЙ НПС, включая эпизодических антагонистов и второстепенных (охотник, информатор, гуль, торговец и т.п.), должен иметь КОНКРЕТНОЕ ИМЯ и быть перечислен в разделе «НПС» отдельным пунктом «- Имя — роль». Безымянных функциональных персонажей в разделе НПС быть не должно — иначе для них не создастся карточка.

Структура сценария (строго по правилам module_rules.md):
0. ## ⚠️ Проверка таймлайна — в самом начале (см. выше)
1. Предпосылки — что привело к этой ситуации
2. Локации — 2-3 ключевых места с атмосферой (раздел с заголовком «Локации», каждая — отдельным пунктом)
3. НПС — мотивации, секреты, роли (раздел «НПС»; каждый с ИМЕНЕМ, отдельным пунктом «- Имя — роль»)
4. Завязка — как ПК втягиваются в события
5. Сцены (3–5) — каждая с конфликтом и вариантами развития
6. Кульминация — пиковый момент напряжения
7. Варианты финала — 2-3 возможных исхода
8. Открытые нити — что останется неразрешённым
9. Колорит города — 2-3 детали, делающие сцену именно этим городом и временем

Язык: русский. Стиль: готический нуар, VtM атмосфера.`;

    // Use makeGenerationClient (respects OpenRouter/Claude preference)
    const gen = await makeGenerationClient().catch(() => null);
    let scenarioText = '';

    if (gen && _isOA(gen)) {
      scenarioText = await _oaCall(gen)(gen.model, systemPrompt, userPrompt, [], 90000, 4000);
    } else if (gen?.client) {
      const msg = await gen.client.messages.create({
        model: 'claude-opus-4-8', max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      scenarioText = msg.content[0]?.text?.trim() || '';
    } else {
      return res.status(503).json({ ok: false, error: 'Нет доступного AI-провайдера. Настрой в Инструменты → Модели AI.' });
    }

    if (!scenarioText) return res.status(500).json({ ok: false, error: 'AI вернул пустой ответ.' });

    // Save as scenario.md
    const scenarioPath = path.join(modDir, 'scenario.md');
    const header = `# Сценарий: ${modTitle}\n\n> 🔗 [Модуль](${mod}.md) | [Хроника](../../events.md)\n\n---\n\n`;
    await writeFileAtomic(scenarioPath, header + scenarioText + '\n', 'utf-8');
    console.log(`[fill-module] ${city}/${chr}/${mod}/scenario.md written`);

    // (allLocs + char catalog already loaded above for the generation prompt)

    // First location mentioned in scenario (for the main file's «Локация» cell)
    const locLineMatch = scenarioText.match(/(?:локация|место действия)[^\n:]*[:]\s*([^\n]+)/i);
    const firstLoc = locLineMatch ? locLineMatch[1].replace(/\*\*/g, '').trim() : '';

    // Patch <mod>.md WITHOUT destroying the concept/participants (so re-gen works)
    await _patchModuleMain(modDir, mod, firstLoc)
      .catch(e => console.warn('[fill-module] main patch:', e.message));

    // ── Classify NPCs: existing canonical (reuse) vs new modular ──────────
    const npcCandidates = [...new Set(
      [...npcs, ..._extractNpcNamesFromScenario(scenarioText)]
        .map(s => String(s).trim()).filter(Boolean)
    )];
    const canonNpcs = [];   // { name, char }  — matched an existing card → reuse
    const newNpcs   = [];   // { name }         — no match → generate modular card
    for (const nm of npcCandidates) {
      const hit = chars.find(c => _nameMatch(nm, c.name));
      if (hit) { if (!canonNpcs.some(x => x.char.slug === hit.slug)) canonNpcs.push({ name: hit.name, char: hit }); }
      else if (!newNpcs.some(x => _nameMatch(x.name, nm))) newNpcs.push({ name: nm });
    }

    // ── Classify locations: existing (reuse) vs new (generate card) ───────
    // Reuse priority: (1) same name, (2) same TYPE already exists (don't multiply
    // generic places — e.g. a metro station — when one is already in the city).
    const reusedLocations = [];
    const newLocNames     = [];
    for (const ln of _extractLocNamesFromScenario(scenarioText)) {
      const nameHit = allLocs.find(l => _nameMatch(ln, l.name));
      if (nameHit) {
        if (!reusedLocations.includes(nameHit.name)) reusedLocations.push(nameHit.name);
        continue;
      }
      const type = _locType(ln);
      if (type) {
        const typeHit = allLocs.find(l => _locType(l.name) === type)
                     || allLocs.find(l => _locType(l.slug) === type);
        if (typeHit) {
          if (!reusedLocations.includes(typeHit.name)) reusedLocations.push(typeHit.name);
          console.log(`[fill-module] reuse by type «${type}»: "${ln}" → ${typeHit.name}`);
          continue;
        }
      }
      if (!newLocNames.some(x => _nameMatch(x, ln))) newLocNames.push(ln);
    }

    // ── Generate cards for NEW locations only (single AI call) ────────────
    const locSource = req.body?.locSource || null;
    const locModel  = req.body?.locModel  || null;
    const createdLocations = [];
    try {
      if (newLocNames.length > 0) {
        const locGen = await makeGenerationClient(locSource, locModel).catch(() => null);
        const portretRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'portret.md'), 'utf-8').catch(() => '');

        const cardTemplate = (name) =>
`# ${name}
> **Название:** ${name} | **Округ:** [округ] | **Район:** [район] | **Адрес:** [адрес] | **Зона:** [🟢/🟡/🔴] | **Контроль:** [фракция]
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
## 🔗 Связанные модули
- [${modTitle}](../../../../chronicles/${chr}/modules/${mod}/${mod}.md)
## 🖼️ Изображения
- ⏳ Изображение не предоставлено`;

        const allCardsPrompt = `Создай карточки локаций для Vampire: The Masquerade V20, ${city || 'Париж'} 2010.

Правила оформления (кратко):
${portretRules.slice(0, 900)}

Контекст модуля: ${modTitle}
Сценарий (выдержка): ${scenarioText.slice(0, 350)}

Создай карточки для КАЖДОЙ из ${newLocNames.length} локаций ниже.
Верни СТРОГО JSON-массив без лишнего текста вне JSON:
[{"name":"<название>","content":"<полная карточка markdown>"},...]

Шаблон каждой карточки:
${cardTemplate('«название»')}

Локации:
${newLocNames.map((n, i) => `${i + 1}. «${n}»`).join('\n')}

Язык: русский. Стиль: готический нуар VtM.`;

        let allLocsRaw = '';
        if (locGen && _isOA(locGen)) {
          allLocsRaw = await _oaCall(locGen)(locGen.model, '', allCardsPrompt, [], 90000, newLocNames.length * 800 + 200);
        } else if (locGen?.client) {
          const m = await locGen.client.messages.create({
            model: 'claude-haiku-4-5-20251001', max_tokens: newLocNames.length * 800 + 200,
            messages: [{ role: 'user', content: allCardsPrompt }],
          });
          allLocsRaw = m.content[0]?.text || '';
        }

        if (allLocsRaw) {
          const locCards = JSON.parse(allLocsRaw.match(/\[[\s\S]*\]/)?.[0] || '[]');
          // Write all location cards in parallel
          await Promise.all(locCards.map(async ({ name, content }) => {
            if (!name || !content) return;
            const locSlug = slugify(name);
            if (!locSlug) return;
            const locDir  = path.join(locsDir(city), 'Другие', slugify(modTitle), locSlug);
            const locFile = path.join(locDir, `${locSlug}.md`);
            if (await fs.stat(locFile).catch(() => null)) return; // already exists
            await fs.mkdir(locDir, { recursive: true });
            await writeFileAtomic(locFile, content.trim() + '\n', 'utf-8');
            createdLocations.push(name);
            console.log(`[fill-module] location created: ${name}`);
          }));
        }
      }
    } catch (locErr) {
      console.warn('[fill-module] location generation failed:', locErr.message);
    }

    // ── Generate cards for NEW (modular) NPCs only (single AI call) ───────
    const createdNpcs = [];
    if (newNpcs.length > 0) {
      try {
        const npcRules  = await fs.readFile(path.join(ROOT, 'system', 'rules', 'npcs_city.md'), 'utf-8').catch(() => '');
        const tmplM     = npcRules.match(/Шаблон Г[\s\S]*?```markdown\n([\s\S]*?)```/);
        const gTemplate = tmplM ? tmplM[1].trim() : '';
        const npcPrompt = `Создай карточки эпизодических (модульных, неканоничных) НПС для модуля «${modTitle}» — Vampire: The Masquerade V20, ${city || 'Париж'} 2010.

Идея модуля:
${content.slice(0, 800)}

Сценарий (выдержка):
${scenarioText.slice(0, 1200)}

Для КАЖДОГО из ${newNpcs.length} НПС ниже создай карточку строго по шаблону.
Заполни характеристики разумными значениями уровня НПС, роль в модуле, внешность (2–3 маркера) и промт для генерации изображения (на английском, 3 блока: Персонаж → Свет/Атмосфера → Стиль).

Шаблон карточки (заменяй [...] значениями):
${gTemplate || '(см. system/rules/npcs_city.md, Шаблон Г)'}

НПС:
${newNpcs.map((n, i) => `${i + 1}. ${n.name}`).join('\n')}

Верни СТРОГО JSON-массив без лишнего текста вне JSON:
[{"name":"<имя>","content":"<полная карточка markdown>"},...]

Язык: русский. Стиль: готический нуар VtM.`;

        let npcRaw = '';
        if (gen && _isOA(gen)) {
          npcRaw = await _oaCall(gen)(gen.model, '', npcPrompt, [], 90000, newNpcs.length * 900 + 300);
        } else if (gen?.client) {
          const m = await gen.client.messages.create({
            model: 'claude-haiku-4-5-20251001', max_tokens: newNpcs.length * 900 + 300,
            messages: [{ role: 'user', content: npcPrompt }],
          });
          npcRaw = m.content[0]?.text || '';
        }

        if (npcRaw) {
          const npcCards = JSON.parse(npcRaw.match(/\[[\s\S]*\]/)?.[0] || '[]');
          await Promise.all(npcCards.map(async ({ name, content: cardMd }) => {
            if (!name || !cardMd) return;
            const npcSlug = slugify(name);
            if (!npcSlug) return;
            const npcDir  = path.join(modDir, 'npc', npcSlug);
            const npcFile = path.join(npcDir, `${npcSlug}.md`);
            if (await fs.stat(npcFile).catch(() => null)) return; // already exists
            await fs.mkdir(npcDir, { recursive: true });
            await writeFileAtomic(npcFile, cardMd.trim() + '\n', 'utf-8');
            createdNpcs.push(name);
            console.log(`[fill-module] modular NPC created: ${name}`);
          }));
        }
      } catch (npcErr) {
        console.warn('[fill-module] NPC generation failed:', npcErr.message);
      }
    }

    // ── Write npc.md (ПК / Каноничные / Модульные) ────────────────────────
    try {
      await writeFileAtomic(path.join(modDir, 'npc.md'),
        _renderModuleNpcMd(modTitle, mod, pcs, canonNpcs, newNpcs, chars), 'utf-8');
      console.log('[fill-module] npc.md written');
    } catch (npcMdErr) {
      console.warn('[fill-module] npc.md:', npcMdErr.message);
    }

    // ── Timeline / canon quick-check (non-AI, non-blocking) ──────────────
    // Scan generated scenario text for obvious contradictions: dead/missing
    // chars appearing as active participants, and chars mentioned before their
    // embrace year. Warns the Storyteller without blocking generation.
    const timelineWarnings = [];
    try {
      const textLower = scenarioText.toLowerCase();
      for (const c of chars) {
        const nameLower = c.name.toLowerCase();
        if (!textLower.includes(nameLower)) continue;

        // Dead / missing character acting in scenario
        if (c.statusType === 'dead' || c.statusType === 'missing') {
          const label = c.statusType === 'dead' ? 'уничтожен/мёртв' : 'пропал';
          timelineWarnings.push({
            severity: 'high',
            character: c.name,
            issue: `Персонаж со статусом «${label}» упомянут как активный участник`,
          });
        }

        // Mentioned before embrace year
        if (c.embraceYear && !/⚠️/.test(c.embraceYear) && yearGuess) {
          const ey = parseInt(c.embraceYear, 10);
          const my = parseInt(yearGuess, 10);
          if (!isNaN(ey) && !isNaN(my) && my < ey) {
            timelineWarnings.push({
              severity: 'medium',
              character: c.name,
              issue: `Год модуля (${my}) предшествует дате обращения персонажа (${ey})`,
            });
          }
        }
      }
    } catch (warnErr) {
      console.warn('[fill-module] timeline check failed:', warnErr.message);
    }

    res.json({
      ok: true,
      file: `chronicles/${chr}/modules/${mod}/scenario.md`,
      locations: createdLocations,
      reusedLocations,
      npcs: createdNpcs,
      canonNpcs: canonNpcs.map(x => x.char.name),
      timelineWarnings,
    });
  } catch (e) {
    console.error('[fill-module]', e.message, e.cause || e.stack || '');
    const detail = e.cause ? `${e.message}: ${e.cause?.message || e.cause}` : e.message;
    res.status(500).json({ ok: false, error: detail });
  }
});

// ── Append in-play session entry (Phase B) ─────────────────────────────────────

app.post('/api/chronicles/:chr/modules/:mod/session', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod } = req.params;
    const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
    if (!await fs.stat(modDir).catch(() => null))
      return res.status(404).json({ ok: false, error: 'Модуль не найден' });

    const date   = (req.body?.date   || '').trim();
    const status = (req.body?.status || '').trim();
    const scenes = (req.body?.scenes || '').trim();
    const notes  = (req.body?.notes  || '').trim();
    if (!notes && !scenes)
      return res.status(400).json({ ok: false, error: 'Заполни «Что произошло» или «Сыграно сцен»' });

    const raw = await fs.readFile(path.join(modDir, 'sessions.md'), 'utf-8').catch(() => '');
    const sessions = _parseSessions(raw);
    sessions.push({ date, scenes, status, body: notes });
    await _writeSessionsFile(modDir, mod, sessions);
    console.log(`[module-session] ${city}/${chr}/${mod} → session ${sessions.length}`);
    res.json({ ok: true, n: sessions.length });
  } catch (e) {
    console.error('[module-session]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Edit an existing session entry (Phase B) ───────────────────────────────────

app.put('/api/chronicles/:chr/modules/:mod/session/:idx', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod, idx } = req.params;
    const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
    const raw = await fs.readFile(path.join(modDir, 'sessions.md'), 'utf-8').catch(() => '');
    const sessions = _parseSessions(raw);
    const i = parseInt(idx, 10);
    if (!Number.isInteger(i) || i < 0 || i >= sessions.length)
      return res.status(404).json({ ok: false, error: 'Запись сессии не найдена' });

    const date   = (req.body?.date   || '').trim();
    const status = (req.body?.status || '').trim();
    const scenes = (req.body?.scenes || '').trim();
    const notes  = (req.body?.notes  || '').trim();
    if (!notes && !scenes)
      return res.status(400).json({ ok: false, error: 'Заполни «Что произошло» или «Сыграно сцен»' });

    sessions[i] = { date, scenes, status, body: notes };
    await _writeSessionsFile(modDir, mod, sessions);
    console.log(`[module-session] ${city}/${chr}/${mod} → edit session ${i + 1}`);
    res.json({ ok: true, n: i + 1 });
  } catch (e) {
    console.error('[module-session-edit]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Delete module ─────────────────────────────────────────────────────────────

app.delete('/api/chronicles/:chr/modules/:mod', express.json(), async (req, res) => {
  try {
    const city   = reqCity(req);
    const { chr, mod } = req.params;
    const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);

    if (!await fs.stat(modDir).catch(() => null))
      return res.status(404).json({ error: 'Модуль не найден' });

    // 1. Find episodic NPCs from npc.md in module
    const npcMd = await fs.readFile(path.join(modDir, 'npc.md'), 'utf-8').catch(() => '');
    // Names referenced in npc/ subfolder (module-local cards)
    let npcSubEntries = [];
    try { npcSubEntries = await fs.readdir(path.join(modDir, 'npc'), { withFileTypes: true }); } catch {}
    const episodicSlugs = npcSubEntries.filter(e => e.isDirectory()).map(e => e.name);

    // 2. Find canonical chars referenced in module (for cleanup of module mentions)
    const chars = await getAllCharacters(city);
    const modLinkPat = new RegExp(`modules/${mod}/`, 'i');

    // 3. Clean up diary/journal entries that mention this module in canonical chars
    const cleanedChars = [];
    for (const ch of chars) {
      const journalDir = path.join(charsDir(city), ch.lineageFolder, ch.slug, 'journal');
      let files; try { files = await fs.readdir(journalDir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        const fp  = path.join(journalDir, f);
        const txt = await fs.readFile(fp, 'utf-8').catch(() => null);
        if (!txt || !modLinkPat.test(txt)) continue;
        // Remove lines that link to this module
        const cleaned = txt.split('\n').filter(l => !modLinkPat.test(l)).join('\n');
        if (cleaned !== txt) {
          await writeFileAtomic(fp, cleaned, 'utf-8');
          cleanedChars.push(`${ch.name}/${f}`);
        }
      }
    }

    // 4. Remove WHOLE event blocks referencing this module from chronicle events.md
    let removedEvents = 0;
    const evPath = path.join(chroniclesDir(city), chr, 'events.md');
    const evTxt  = await fs.readFile(evPath, 'utf-8').catch(() => null);
    if (evTxt) {
      const nl    = evTxt.replace(/\r\n/g, '\n');
      const parts = nl.split(/\n(?=###\s*📅)/);          // header + per-event blocks
      const modRe = new RegExp(`modules/${mod}/`);
      const kept  = parts.filter((seg, i) => {
        if (i === 0 && !/^###\s*📅/.test(seg.trim())) return true;   // file header
        if (modRe.test(seg)) { removedEvents++; return false; }      // this module's event
        return true;
      });
      const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n');
      if (cleaned !== nl) await writeFileAtomic(evPath, cleaned, 'utf-8');
    }

    // 5. Delete module directory (its npc/ — modular NPCs — go with it)
    await rmdir(modDir);
    await syncChronicleModuleLinks(city, chr);

    // 6. Rebuild the city's aggregate event index (archive/events.md)
    if (removedEvents) {
      await new Promise(resolve => {
        const ps = spawn('node', [path.join(ROOT, 'tools', 'build_city_events.js'), city], { cwd: ROOT });
        ps.on('close', () => resolve()); ps.on('error', () => resolve());
      });
    }
    console.log(`[delete-module] ${city}/${chr}/modules/${mod} | events: ${removedEvents} | diaries: ${cleanedChars.join(', ') || '—'} | npcs: ${episodicSlugs.join(', ') || '—'}`);

    delete _cache[city];
    res.json({ ok: true, mod, removedEvents, cleanedChars, episodicSlugs });
  } catch (e) {
    console.error('[delete-module]', e.message);
    serverError(res, e);
  }
});

// ── Close module (Phase C — MODULE-close rules, not chronicle-close) ────────────

app.post('/api/chronicles/:chr/modules/:mod/close', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod } = req.params;
    const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
    if (!await fs.stat(modDir).catch(() => null))
      return res.status(404).json({ ok: false, error: 'Модуль не найден' });

    const mainTxt     = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
    const scenario    = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8').catch(() => '');
    const sessionsRaw = await fs.readFile(path.join(modDir, 'sessions.md'), 'utf-8').catch(() => '');
    const npcMd       = await fs.readFile(path.join(modDir, 'npc.md'), 'utf-8').catch(() => '');
    const moduleRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'module_rules.md'), 'utf-8').catch(() => '');
    const cityMd      = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8').catch(() => '');

    const titleM   = mainTxt.match(/^#\s+(.+)$/m);
    const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;
    const sessions = _parseSessions(sessionsRaw);
    const playLog  = sessions.map(s => `• ${s.title}${s.scenes ? ` [сцены: ${s.scenes}]` : ''}: ${s.body || ''}`).join('\n')
                  || '(сессии не зафиксированы — опирайся на сценарий)';

    const gen = await makeGenerationClient(req.body?.source || null, req.body?.model || null).catch(() => null);
    if (!gen?.client && !(gen && _isOA(gen)))
      return res.status(503).json({ ok: false, error: 'Нет доступного AI-провайдера. Настрой в Инструменты → Модели AI.' });

    // Phase-C rules slice as context (MODULE-close, NOT chronicle-close)
    const phaseC = (moduleRules.match(/Фаза C[\s\S]{0,700}/)?.[0]) || '';
    const baseCtx = `Ты — Рассказчик Vampire: The Masquerade V20. Закрываешь МОДУЛЬ по правилам Фазы C из system/rules/module_rules.md — это НЕ закрытие хроники.

# СЕТТИНГ ГОРОДА
${cityMd.slice(0, 1500)}

# ПРАВИЛА ЗАКРЫТИЯ МОДУЛЯ (Фаза C)
${phaseC}`;

    const runGen = async (system, user, maxTokens) => {
      if (_isOA(gen)) {
        return _oaCall(gen)(gen.model, system, user, [], 90000, maxTokens);
      }
      const m = await gen.client.messages.create({ model: 'claude-opus-4-8', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
      return m.content[0]?.text?.trim() || '';
    };

    // 1. finale.md — literary finale by what actually happened in play
    let finale = false;
    const finaleText = await runGen(baseCtx,
`Напиши литературный финал (finale.md) модуля «${modTitle}».

Сценарий (план):
${scenario.slice(0, 2500)}

Что реально произошло в игре (журнал сессий):
${playLog}

Напиши цельный литературный финал ПО ФАКТАМ ИГРЫ (если игра отступила от сценария — следуй игре). Русский, готический нуар. Верни только текст финала, без метаданных.`, 2500).catch(() => '');
    if (finaleText) {
      const header = `# ${modTitle} — Литературный финал\n\n> 🔗 [Модуль](${mod}.md) | [Хроника](../../events.md)\n\n---\n\n`;
      await writeFileAtomic(path.join(modDir, 'finale.md'), header + finaleText + '\n', 'utf-8');
      finale = true;
    }

    // 2. Canonical event entry → chronicles/<chr>/events.md (transfer from sessions)
    let event = false;
    const eventBlock = await runGen(baseCtx,
`Собери КАНОНИЧНУЮ запись события для хроники по итогам сыгранного модуля «${modTitle}».

НПС/участники модуля:
${npcMd.slice(0, 1200)}

Журнал сессий (источник истины):
${playLog}

Формат записи СТРОГО:
### 📅 <дата/время> — <краткое название>.

- **📍 Локация:** <…>
- **👥 Участники:**
  - <Имя> — <роль>
- **📋 События:**
  <связный пересказ по фактам игры>
- **⚖️ Последствия:**
  - <…>

Верни ТОЛЬКО блок записи, без пояснений. Русский.`, 2000).catch(() => '');
    const trackInChronology = !/\|\s*\*\*Учитывать в хронологии\*\*\s*\|\s*нет\s*\|/i.test(mainTxt);
    if (eventBlock && /###\s*📅/.test(eventBlock) && trackInChronology) {
      const evPath     = path.join(chroniclesDir(city), chr, 'events.md');
      const finaleLink = finale ? ` | [Литературный финал](modules/${mod}/finale.md)` : '';
      const block      = eventBlock.trim() + `\n\n> 🔗 [Модуль](modules/${mod}/${mod}.md)${finaleLink}\n`;
      const evTxt      = (await fs.readFile(evPath, 'utf-8').catch(() => '')).replace(/\s*$/, '');
      await writeFileAtomic(evPath, evTxt + '\n\n' + block, 'utf-8');
      event = true;
    }

    // 3. Mark the module status as closed in the main file
    const today = new Date().toISOString().slice(0, 10);
    let main = mainTxt.replace(/^﻿/, '');
    if (/^-\s*\*\*Статус(?: модуля)?:\*\*/m.test(main))
      main = main.replace(/^(-\s*\*\*Статус(?: модуля)?:\*\*\s*).*$/m, `$1🟢 Закрыт (${today})`);
    else
      main = main.replace(/^(>\s*🔗\s*\[Хроника\][^\n]*)$/m, `$1\n\n- **Статус модуля:** 🟢 Закрыт (${today})`);
    await writeFileAtomic(path.join(modDir, `${mod}.md`), main, 'utf-8');

    // 4. Rebuild the aggregate event index
    if (event) {
      await new Promise(resolve => {
        const ps = spawn('node', [path.join(ROOT, 'tools', 'build_city_events.js'), city], { cwd: ROOT });
        ps.on('close', () => resolve()); ps.on('error', () => resolve());
      });
    }
    delete _cache[city];

    // 5. Remaining Phase-C steps needing per-character / manual attention
    const reminders = [
      'Дневники участников (journal/) — сгенерировать на вкладке персонажа',
      'Открытые нити (open_threads.md) — внести новые',
      'Модульные НПС — проверить условия продвижения в каноничные (module_rules.md)',
      'tools/validate_links.ps1',
    ];
    console.log(`[close-module] ${city}/${chr}/${mod} | finale=${finale} event=${event}`);
    res.json({ ok: true, finale, event, reminders });
  } catch (e) {
    console.error('[close-module]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/modules/:name', async (req, res) => {
  try {
    const city = reqCity(req);
    const name = decodeURIComponent(req.params.name);
    if (!/^[^/\\]+$/.test(name)) return res.status(400).json({ error: 'bad name' });
    const it = (await listModules(city)).find(m => m.name === name);
    if (!it) return res.status(404).json({ error: 'Модуль не найден' });

    const names = (await fs.readdir(it.dir, { withFileTypes: true })).filter(f => f.isFile() && f.name.endsWith('.md')).map(f => f.name);
    const read  = async fn => (fn && names.includes(fn) ? fs.readFile(path.join(it.dir, fn), 'utf-8').catch(() => null) : null);
    const mainName = names.includes(`${name}.md`) ? `${name}.md` : (names.find(n => !MOD_AUX(n)) || null);

    const out = { name, title: name, chronicle: it.chronicle };
    out.main     = await read(mainName);
    out.scenario = await read('scenario.md');
    out.finale   = await read('finale.md');
    out.npc      = await read('npc.md');

    if (out.main) {
      const hm = out.main.match(/^#\s+(.+)$/m);
      if (hm) out.title = hm[1].replace(/[*[\]]/g, '').trim();
    }
    res.json(out);
  } catch (e) { serverError(res, e); }
});

app.get('/api/threads', async (req, res) => {
  try {
    res.json(await readThreadsStructured(reqCity(req)));
  } catch (e) { serverError(res, e); }
});

// Create a new thread (appends a table row). Default target: archive/open_threads.md.
app.post('/api/threads', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const { title, description = '', source = '', status = 'active', priority = 'Средний' } = req.body || {};
    const rel = req.body?.file || 'archive/open_threads.md';
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Укажите заголовок нити' });
    const abs = resolveThreadFile(city, rel);
    if (!abs) return res.status(400).json({ error: 'Некорректный файл нити' });
    const content = await fs.readFile(abs, 'utf-8').catch(() => null);
    if (content === null) return res.status(404).json({ error: 'Файл нитей не найден' });

    const lines     = content.split('\n');
    const headerIdx = lines.findIndex(l => /^\|\s*(№|#)\s*\|\s*Нить/.test(l));
    if (headerIdx === -1) return res.status(400).json({ error: 'В файле нет таблицы нитей' });

    const ids    = parseThreadsContent(content, rel).map(t => t.id);
    const nextId = ids.length ? Math.max(...ids) + 1 : 1;
    const desc   = String(description).trim();
    const statusText = THREAD_STATUS[status] || THREAD_STATUS.active;
    const row = `| ${nextId} | **${String(title).trim()}**${desc ? ' — ' + desc : ''} | ${String(source).trim() || '—'} | ${statusText} | ${priority} |`;

    let insertAt = headerIdx + 2; // skip header + separator
    while (insertAt < lines.length && lines[insertAt].trimStart().startsWith('|')) insertAt++;
    lines.splice(insertAt, 0, row);
    await writeFileAtomic(abs, lines.join('\n'), 'utf-8');
    res.json({ ok: true, id: nextId });
  } catch (e) { serverError(res, e); }
});

// Update a thread's status and/or priority in its source file.
app.patch('/api/threads/:id', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const id   = parseInt(req.params.id);
    const { file, status, priority } = req.body || {};
    if (status && !THREAD_STATUS[status]) return res.status(400).json({ error: 'Неизвестный статус' });
    const abs = resolveThreadFile(city, file);
    if (!abs) return res.status(400).json({ error: 'Некорректный файл нити' });

    const content = await fs.readFile(abs, 'utf-8').catch(() => null);
    if (content === null) return res.status(404).json({ error: 'Файл нитей не найден' });
    const lines = content.split('\n');

    let done = false;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\|\s*(\d+)\s*\|/);
      if (!m || parseInt(m[1]) !== id) continue;
      const cells = lines[i].split('|'); // ['', ' id ', ' **t** desc ', ' src ', ' status ', ' prio ', '']
      if (cells.length < 6) break;
      if (status)   cells[4] = ` ${THREAD_STATUS[status]} `;
      if (priority) cells[5] = ` ${String(priority).trim()} `;
      lines[i] = cells.join('|');
      done = true;
      break;
    }
    if (!done) return res.status(404).json({ error: 'Нить не найдена' });
    await writeFileAtomic(abs, lines.join('\n'), 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Module detail ─────────────────────────────────────────────────────────────

app.get('/api/chronicles/:chr/modules/:mod/detail', async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod } = req.params;
    const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);

    if (!await fs.stat(modDir).catch(() => null))
      return res.status(404).json({ error: 'Модуль не найден' });

    const result = { name: mod, chronicle: chr, title: mod, pcs: [], npcs: [], locations: [], events: [] };

    // 1. Main module file — title, metadata, participants, description
    const mainRaw = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
    if (mainRaw) {
      const mc = mainRaw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const hm = mc.match(/^#\s+(.+)$/m);
      if (hm) result.title = hm[1].replace(/[*[\]]/g, '').trim();

      for (const [label, key] of [['Тип','type'],['Формат','format'],['Время','time'],['Тон','tone'],['Локация','location']]) {
        const v = tableCell(mc, label);
        if (v != null) result[key] = v;
      }

      // Module status (bullet line written on close: «- **Статус модуля:** 🟢 Закрыт …»)
      const stM = mc.match(/^-\s*\*\*Статус(?: модуля)?:\*\*\s*(.+)$/m);
      if (stM) result.status = stM[1].trim();

      // Description: prefer the «💡 Концепция» section (the module idea).
      // Fall back to free text between a --- divider and the first ## section,
      // but never surface the metadata table itself.
      const conceptM = mc.match(/##\s*💡\s*Концепция\s*\n+([\s\S]*?)(?=\n##|\n---|\s*$)/);
      if (conceptM && conceptM[1].trim()) {
        result.description = conceptM[1].trim();
      } else {
        for (const m of mc.matchAll(/\n---\s*\n+([\s\S]+?)(?=\n##|\n---|\s*$)/g)) {
          const block = m[1].trim();
          if (block && !block.startsWith('|')) { result.description = block; break; }
        }
      }

      // Participants: ## 👥 Участники или Действующие лица section
      // Find the section header and extract content until next ##
      const sectMatch = mc.match(/^##\s*[^\s]*?\s*(?:Участники|Действующие\s+лица)\s*\n/m);
      if (sectMatch) {
        const startIdx = mc.indexOf(sectMatch[0]) + sectMatch[0].length;
        const restContent = mc.substring(startIdx);
        const nextSectionIdx = restContent.search(/\n##[^#]/);
        const section = nextSectionIdx === -1 ? restContent : restContent.substring(0, nextSectionIdx);

        // Parse both formats:
        // 1. Bullet format: `- [Name](path) — Role`
        // 2. Subsection format: `### Emoji Name — Role`
        for (const line of section.split('\n')) {
          const t = line.trim();
          if (!t) continue;

          // Format 1: bullet list items `- [Name](path) — Role` or `- Name — Role`
          // Only process if it looks like a participant (has valid name and role)
          if (t.startsWith('-') && /[—–]/.test(t)) {
            const m = t.match(/^-\s+\[?([^\]()—–\n]+?)\]?(?:\([^)]*\))?\s*(?:[—–]\s*(.*))?$/);
            if (!m) continue;
            let name = m[1].trim();
            // Strip leading emoji/symbol if present (anything that's not a Cyrillic/Latin letter or common punctuation)
            name = name.replace(/^[^\p{L}]+/u, '').trim();
            // Skip if it starts with a quote or looks like descriptive text (not a name)
            if (/^[«"'«»]|^\d+\.|\s{2,}/.test(name) || name.length > 100) continue;
            const role = (m[2] || '').trim();
            // Validate role looks reasonable (not too long, not just a quote continuation)
            if (!role || role.length > 200 || /^[«"']$/.test(role)) continue;
            if (/персонаж игрока|ПК\b/i.test(role)) result.pcs.push({ name, role });
            else result.npcs.push({ name, role: role || 'НПС' });
          }
          // Format 2: subsection headers (### Emoji Name — Role)
          else if (t.startsWith('###')) {
            // Extract everything after ### (skip emoji), then split on em/en-dash
            const afterHash = t.replace(/^###\s+/, '').trim();
            if (!afterHash) continue;
            const parts = afterHash.split(/\s*[—–]\s*/);
            if (parts.length === 0) continue;
            // First part is name (may include role in parentheses)
            let name = parts[0].trim();
            let role = parts[1] ? parts[1].trim() : '';
            // Strip leading emoji/symbol from name (anything that's not a Cyrillic/Latin letter)
            name = name.replace(/^[^\p{L}]+/u, '').trim();
            // Extract name from "Name (role)" format if needed
            const nameMatch = name.match(/^([^()]+?)(?:\s*\(([^)]+)\))?$/);
            if (nameMatch) {
              name = nameMatch[1].trim();
              if (!role && nameMatch[2]) role = nameMatch[2].trim();
            }
            if (!name) continue;
            if (/персонаж игрока|ПК\b/i.test(role)) result.pcs.push({ name, role });
            else result.npcs.push({ name, role: role || 'НПС' });
          }
        }
      }
    }

    // 2. Scenario content
    result.scenario = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8').catch(() => '');

    // 3. NPC details from npc.md
    result.npcContent = await fs.readFile(path.join(modDir, 'npc.md'), 'utf-8').catch(() => '');
    result.npcGroups  = _parseNpcMdGroups(result.npcContent);

    // Enrich each NPC with sheet status: episodic → npc/<slug>/<slug>-sheet.md, canonical → char's sheet
    {
      const allChars = await getAllCharacters(city).catch(() => []);
      for (const g of result.npcGroups) {
        for (const e of g.entries) {
          if (g.kind === 'modular') {
            const m = (e.cardHref || '').match(/npc\/([^/]+)\//);
            e.slug = m ? m[1] : slugify(e.name);
            e.sheetScope = 'module';
            e.hasSheet = !!(await fs.stat(path.join(modDir, 'npc', e.slug, `${e.slug}-sheet.md`)).catch(() => null));
            e.promoteCheck = await _checkNpcPromotion(city, chr, mod, e.slug).catch(() => null);
          } else {
            const ch = allChars.find(c => c.name === e.name) || allChars.find(c => _nameMatch(c.name, e.name));
            e.slug = ch?.slug || null;
            e.sheetScope = 'character';
            e.hasSheet = ch
              ? !!(await fs.stat(path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}-sheet.md`)).catch(() => null))
              : false;
          }
        }
      }
    }

    // 3b. In-play session log (Phase B)
    result.sessions = _parseSessions(
      await fs.readFile(path.join(modDir, 'sessions.md'), 'utf-8').catch(() => ''));

    // 4. Events — prefer the module's own scenes («Сцены») from scenario.md;
    //    fall back to the chronicle's events.md.
    const scenes = _parseScenarioScenes(result.scenario);
    result.scenes = scenes; // raw scenario scenes (for the session scene-picker)
    if (scenes.length) {
      result.events = scenes;
    } else {
      const evRaw = await fs.readFile(path.join(chroniclesDir(city), chr, 'events.md'), 'utf-8').catch(() => '');
      if (evRaw) {
        const ec = evRaw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        ec.split(/\n(?=###\s*📅)/).filter(c => /^###\s*📅/.test(c.trim())).forEach(c => {
          const ev = parseEvent(c.trim(), result.events.length);
          ev.chronicle = chr;
          result.events.push(ev);
        });
      }
    }

    // 5. Open threads — prefer the module's own «Открытые нити / Крючки» from
    //    scenario.md; fall back to chronicle-level, then city archive.
    const scenarioThreads = _extractScenarioSection(result.scenario, /Открыт|Крючк|Зацепк/i);
    result.openThreads = scenarioThreads
      || await fs.readFile(path.join(chroniclesDir(city), chr, 'open_threads.md'), 'utf-8').catch(() => null)
      || await fs.readFile(path.join(cityDir(city), 'archive', 'open_threads.md'), 'utf-8').catch(() => '');

    // 6. Locations — parse the «Локации» section of scenario.md (robust to
    //    `- **Name** — desc`, `- Name → 🔗 …` and `### Name` subsection formats).
    result.locations = _parseScenarioLocations(result.scenario);

    // 7. Linked locations — explicit slugs from «## 📍 Связанные локации» in module .md
    const linkedSlugs = _parseModuleLocSlugs(mainRaw);
    if (linkedSlugs.length) {
      const allLocs = await getAllLocations(city);
      result.linkedLocations = linkedSlugs.map(s => allLocs.find(l => l.slug === s) || { slug: s });
    } else {
      result.linkedLocations = [];
    }

    res.json(result);
  } catch (e) {
    console.error('[module-detail]', e.message);
    serverError(res, e);
  }
});

// ── Module location sub-resource endpoints ────────────────────────────────────

app.get('/api/chronicles/:chr/modules/:mod/locations', async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod } = req.params;
    const modFile = path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`);
    if (!await fs.stat(modFile).catch(() => null))
      return res.status(404).json({ error: 'Модуль не найден' });

    const mainRaw    = await fs.readFile(modFile, 'utf-8').catch(() => '');
    const linkedSlugs = _parseModuleLocSlugs(mainRaw);
    const allLocs    = await getAllLocations(city);
    const linked     = linkedSlugs.map(s => allLocs.find(l => l.slug === s) || { slug: s });
    res.json({ linked, extracted: _parseScenarioLocations(mainRaw) });
  } catch (e) { serverError(res, e); }
});

app.post('/api/chronicles/:chr/modules/:mod/locations', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod } = req.params;
    const { slug: locSlug } = req.body || {};
    if (!locSlug) return res.status(400).json({ error: 'slug обязателен' });

    const modFile = path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`);
    if (!await fs.stat(modFile).catch(() => null))
      return res.status(404).json({ error: 'Модуль не найден' });

    let raw      = await fs.readFile(modFile, 'utf-8');
    const existing = _parseModuleLocSlugs(raw);
    if (!existing.includes(locSlug)) {
      existing.push(locSlug);
      raw = _writeModuleLocSlugs(raw, existing);
      await writeFileAtomic(modFile, raw, 'utf-8');
    }
    res.json({ ok: true, slugs: existing });
  } catch (e) { serverError(res, e); }
});

app.delete('/api/chronicles/:chr/modules/:mod/locations/:locSlug', async (req, res) => {
  try {
    const city       = reqCity(req);
    const { chr, mod, locSlug } = req.params;
    const decodedSlug = decodeURIComponent(locSlug);

    const modFile = path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`);
    if (!await fs.stat(modFile).catch(() => null))
      return res.status(404).json({ error: 'Модуль не найден' });

    let raw = await fs.readFile(modFile, 'utf-8');
    const existing = _parseModuleLocSlugs(raw);
    const filtered = existing.filter(s => s !== decodedSlug);
    if (filtered.length !== existing.length) {
      raw = _writeModuleLocSlugs(raw, filtered);
      await writeFileAtomic(modFile, raw, 'utf-8');
    }
    res.json({ ok: true, slugs: filtered });
  } catch (e) { serverError(res, e); }
});

app.get('/api/characters/:slug/diary', async (req, res) => {
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
app.delete('/api/characters/:slug/diary', async (req, res) => {
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

    delete _cache[city];
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

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

// Create or append a diary entry (journal/<period>.md), then link it from the card.
app.put('/api/characters/:slug/diary', express.json(), async (req, res) => {
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
    delete _cache[city];
    res.json({ ok: true, file: `journal/${per}.md` });
  } catch (e) { serverError(res, e); }
});

// AI-generate diary prose for a character + period (not saved — returned for review).
app.post('/api/characters/:slug/diary/generate', express.json(), async (req, res) => {
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

    let text = '';
    if (_isOA(gen)) {
      const models = _oaModels(gen);
      let lastErr;
      for (const m of models) {
        try { text = await _oaCall(gen)(m, systemPrompt, userPrompt, []); if (m !== gen.model) console.log(`[diary-gen] fallback model: ${m}`); break; }
        catch (e) {
          lastErr = e;
          const retry = e.status === 404 || e.status === 429 || e.status === 502 || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message));
          if (!retry) throw e;
        }
      }
      if (!text) throw lastErr;
    } else {
      const msg = await gen.client.messages.create({
        model: gen.model, max_tokens: 1200, system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      text = msg.content[0]?.text?.trim() || '';
    }
    res.json({ ok: true, text, source: gen.source });
  } catch (e) {
    const status = e.status ?? 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: e.message ?? String(e) });
  }
});

// ── NPC in-character dialogue (AI) — Voice field + clan style from diary_rules ──

// :id accepts either a real character's slug or a module-only NPC's display name
// (module-listed NPCs have no slug — see _findModularNpcCard fallback below).
app.post('/api/characters/:id/dialogue', express.json(), async (req, res) => {
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

// ── Библиотека: справочник дисциплин (system/library/disciplines/*.md) ──────────
// Город-нейтральные данные → кэшируются по mtime каталога.
let _discCache = null; // { sig, list }
const DISC_DIR = path.join(ROOT, 'system', 'library', 'disciplines');

async function loadDisciplines() {
  const files = (await fs.readdir(DISC_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();

  // Сигнатура по mtime каждого файла: правка содержимого существующего .md
  // не меняет mtime каталога, поэтому ключевать по нему нельзя (иначе кэш не сбросится).
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(DISC_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_discCache && _discCache.sig === sig) return _discCache.list;

  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(DISC_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parseDisciplineMd(md, slug));
  }
  _discCache = { sig, list };
  return list;
}

app.get('/api/library/disciplines', async (_req, res) => {
  try { res.json(await loadDisciplines()); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник психических способностей (system/library/psychics/*.md) ──
// Город-нейтральные данные → тот же mtime-кэш, что и у дисциплин (см. выше).
let _psyCache = null; // { sig, list }
const PSY_DIR = path.join(ROOT, 'system', 'library', 'psychics');

async function loadPsychics() {
  const files = (await fs.readdir(PSY_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();

  const stats = await Promise.all(mds.map(f => fs.stat(path.join(PSY_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_psyCache && _psyCache.sig === sig) return _psyCache.list;

  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(PSY_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parsePsychicMd(md, slug));
  }
  _psyCache = { sig, list };
  return list;
}

app.get('/api/library/psychics', async (_req, res) => {
  try { res.json(await loadPsychics()); }
  catch (e) { serverError(res, e); }
});

app.get('/api/locations', async (req, res) => {
  try { res.json(await getAllLocations(reqCity(req))); }
  catch (e) { serverError(res, e); }
});

app.get('/api/locations/:slug/images', async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug);
    const city = reqCity(req);
    const locs = await getAllLocations(city);
    const loc  = locs.find(l => l.slug === slug);
    if (!loc) return res.status(404).json({ error: 'not found' });
    res.json({ images: loc.imageUrls || (loc.imageUrl ? [loc.imageUrl] : []) });
  } catch (e) { serverError(res, e); }
});

app.put('/api/locations/:slug/fields', express.json(), async (req, res) => {
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
      // Inline metadata fields
      const fieldMap = { subtype: 'Название', district: 'Округ', neighborhood: 'Район', address: 'Адрес', control: 'Контроль' };
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
    delete _locCache[city];
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

app.post('/api/locations/:slug/upload-image', express.json({ limit: '20mb' }), async (req, res) => {
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

// ── POST /api/locations — create new location ─────────────────────────────────
app.post('/api/locations', express.json(), async (req, res) => {
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
        if (gen && _isOA(gen)) {
          raw = await _oaCall(gen)(gen.model, '', prompt, [], 60000, 1300);
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
    delete _locCache[city];
    res.json({ ok: true, slug: locSlug, district: distFolder });
  } catch (e) { serverError(res, e); }
});

// ── DELETE /api/locations/:slug — remove location folder ──────────────────────
app.delete('/api/locations/:slug', async (req, res) => {
  try {
    const slug   = decodeURIComponent(req.params.slug);
    const city   = reqCity(req);
    const mdPath = await findLocMdPath(slug, city);
    if (!mdPath) return res.status(404).json({ error: 'Локация не найдена' });
    await fs.rm(path.dirname(mdPath), { recursive: true, force: true });
    delete _locCache[city];
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── POST /api/locations/generate — AI full-card or single-field generation ────
app.post('/api/locations/generate', express.json(), async (req, res) => {
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
    if (_isOA(gen)) {
      result = await _oaCall(gen)(gen.model, '', prompt, [], 60000, maxTok);
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

app.get('/api/chronicle', async (req, res) => {
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

// Raw markdown archive docs — rendered client-side with the lore renderer.
const archiveDoc = file => async (req, res) => {
  try {
    const content = await fs.readFile(path.join(archiveDir(reqCity(req)), file), 'utf-8').catch(() => null);
    res.json({ exists: content !== null, content: content || '' });
  } catch (e) { serverError(res, e); }
};
app.get('/api/timeline', archiveDoc('timeline.md'));          // historical lore (B3)
app.get('/api/factions', archiveDoc('political_state.md'));   // C1 — faction map
app.get('/api/visitors', archiveDoc('visitors.md'));          // C3 — cross-city guests

// C2 — rumor tables (Elysium d20 / Dreaming d20)
app.get('/api/rumors', async (req, res) => {
  try {
    const which = req.query.type === 'dreaming' ? 'rumors_dreaming.md' : 'rumors_elysium.md';
    const content = await fs.readFile(path.join(archiveDir(reqCity(req)), which), 'utf-8').catch(() => null);
    res.json({ exists: content !== null, content: content || '', type: req.query.type === 'dreaming' ? 'dreaming' : 'elysium' });
  } catch (e) { serverError(res, e); }
});

// PUT — write archive docs back to disk
const _writeArchiveDoc = (file) => async (req, res) => {
  try {
    const city    = reqCity(req);
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const dir = archiveDir(city);
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, file), content, 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
};
app.put('/api/timeline', express.json(), _writeArchiveDoc('timeline.md'));
app.put('/api/factions', express.json(), _writeArchiveDoc('political_state.md'));
app.put('/api/visitors', express.json(), _writeArchiveDoc('visitors.md'));
app.put('/api/rumors', express.json(), async (req, res) => {
  try {
    const city    = reqCity(req);
    const type    = req.body?.type === 'dreaming' ? 'dreaming' : 'elysium';
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const file = type === 'dreaming' ? 'rumors_dreaming.md' : 'rumors_elysium.md';
    const dir  = archiveDir(city);
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, file), content, 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// C4 — V20 character sheet (<slug>-sheet.md next to the card)
app.get('/api/characters/:slug/sheet', async (req, res) => {
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

// ── V20 sheet generation / save (canonical chars + episodic module NPCs) ──────

// Per-lineage sheet config: which rules doc, master role label, title suffix.
// Keeps the prompt focused (only the relevant lineage's rules are sent).
const _SHEET_LINEAGES = {
  vampire:    { file: 'character_sheet_v20.md',        master: 'Vampire: The Masquerade V20', title: 'V20',        extras: 'клан, поколение, клановые дисциплины и слабость — по справочным таблицам' },
  mortal:     { file: 'character_sheet_mortal.md',      master: 'Classic World of Darkness (смертные)', title: 'Смертный', extras: 'у смертного НЕТ дисциплин, запаса крови, поколения и Пути — только Человечность' },
  changeling: { file: 'character_sheet_changeling.md',  master: 'Changeling: The Dreaming', title: 'Подменыш', extras: 'вместо дисциплин — Искусства и Сферы; вместо крови — Glamour/Banality; стартовые числа помечены как ориентир' },
  werewolf:   { file: 'character_sheet_werewolf.md',    master: 'Werewolf: The Apocalypse', title: 'Оборотень', extras: 'нет дисциплин и крови; вместо Пути — Репутация (Слава/Честь/Мудрость); Ярость, Гнозис, Дары по племени/касте' },
  mage:       { file: 'character_sheet_mage.md',        master: 'Mage: The Ascension', title: 'Маг', extras: 'нет дисциплин и крови; магические способности — Сферы; Арете, Квинтэссенция, Парадокс по Традиции' },
};

// Map a lineage hint (folder name and/or card «Линейка WoD») to a config key.
function _resolveSheetLineage(hint) {
  const h = (hint || '').toLowerCase();
  if (/mortal|смертн|гуль|ревенант/.test(h))                                  return 'mortal';
  if (/hunter|охотник/.test(h))                                                return 'mortal';
  if (/fair|fae|fey|ченджлинг|changeling|подменыш|фея|фейри|пак/.test(h))    return 'changeling';
  if (/werewolf|оборотн|garou|гару/.test(h))                                  return 'werewolf';
  if (/mage|маг(?:и|а|е|у|ов)?(?:\s|$)|ascension/.test(h))                   return 'mage';
  return 'vampire';
}

// Creation point pools per lineage (mirrors RULES_V20.creation in web/public/rules-v20.js
// and the «Шаг 2–6» tables in system/rules/character_sheet_v20.md / _mortal.md). Used to
// spell the pools out explicitly in the prompt and to sanity-check the AI's totals after
// generation — vampires default to the Камарилья row (project default, see Шаг 6 note).
const _SHEET_POOLS = {
  vampire:    { attrs: [7, 5, 3], abilities: [13, 9, 5], disciplines: 3, backgrounds: 5, virtues: 7 },
  mortal:     { attrs: [6, 4, 3], abilities: [11, 7, 4], backgrounds: 5, virtues: 7 },
  changeling: { attrs: [7, 5, 3], abilities: [13, 9, 5], backgrounds: 5, virtues: 7 },
  werewolf:   { attrs: [7, 5, 3], abilities: [13, 9, 5], gifts: 3, backgrounds: 5, virtues: 7 },
  mage:       { attrs: [7, 5, 3], abilities: [13, 9, 5], spheres: 6, backgrounds: 7, virtues: 7 },
};

// Project's canon clan → in-clan-discipline-names table (mirrors «Дисциплины кланов
// проекта» in system/rules/character_sheet_v20.md and RULES_V20.clans in rules-v20.js).
// Library discipline files' own «Клан / принадлежность» field lists the *broader* cWoD
// canon (e.g. fortitude.md says «Бруха, Вентру, Гангрел», but this project's table keeps
// Бруха to Стремительность/Могущество/Присутствие only) — so this table, not the library
// field, decides WHICH disciplines count as in-clan; the library is only used for their text.
const _CLAN_DISCIPLINE_NAMES = {
  'тореадор':      ['Прорицание', 'Стремительность', 'Присутствие'],
  'малкавиан':     ['Прорицание', 'Помешательство', 'Затемнение'],
  'вентру':        ['Доминирование', 'Стойкость', 'Присутствие'],
  'бруха':         ['Стремительность', 'Могущество', 'Присутствие'],
  'гангрел':       ['Анимализм', 'Стойкость', 'Превращение'],
  'носферату':     ['Анимализм', 'Затемнение', 'Могущество'],
  'тремер':        ['Прорицание', 'Доминирование', 'Тауматургия'],
  'цимисхи':       ['Анимализм', 'Прорицание', 'Изменчивость'],
  'каппадокийцы':  ['Прорицание', 'Стойкость', 'Смерть'],
  'ассамиты':      ['Стремительность', 'Затемнение', 'Чародейство ассамитов'],
  'истинный бруха': ['Могущество', 'Присутствие', 'Темпорис'],
};

// Clan name (case-insensitive, parenthetical aside ignored) → matching library discipline
// objects. Looks up the project's canon discipline NAMES for the clan first (table above),
// then finds each by name in the library; if the clan isn't in the table at all (unusual/
// variant clan), falls back to a substring match against each discipline's own «Клан /
// принадлежность» field — broader cWoD canon, better than nothing.
function disciplinesForClan(allDisciplines, clanName) {
  const key = String(clanName || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
  if (!key) return [];
  const list = allDisciplines || [];
  const canonNames = _CLAN_DISCIPLINE_NAMES[key];
  if (canonNames) {
    return canonNames
      .map(n => list.find(d => d.name.toLowerCase().includes(n.toLowerCase())))
      .filter(Boolean);
  }
  return list.filter(d => String(d.clans || '').toLowerCase().includes(key));
}

// Render up to 3 lowest levels of a discipline (name + literary/system text) for prompt injection.
function _disciplineLevelsText(d, maxLevels = 3, maxCharsPerLevel = 280) {
  const levels = [...(d.levels || [])].sort((a, b) => a.level - b.level).slice(0, maxLevels);
  if (!levels.length) return '';
  const lines = levels.map(l => {
    const lit = (l.literary || '').slice(0, maxCharsPerLevel);
    const sys = (l.system || '').slice(0, maxCharsPerLevel);
    return `  · Уровень ${l.level} — ${l.name}: ${lit}${sys ? ` (Система: ${sys})` : ''}`;
  });
  return `**${d.name}**\n${lines.join('\n')}`;
}

// Generate a full sheet (markdown) from a character/NPC card, per the lineage rules.
async function _generateV20Sheet({ card, displayName, gen, lineage }) {
  const cardLine = (card || '').match(/Линейк[аи][^:\n]*WoD[^:\n]*:\s*([^\n]+)/i)?.[1] || '';
  const sheetLineage = _resolveSheetLineage(`${lineage || ''} ${cardLine}`);
  const cfg = _SHEET_LINEAGES[sheetLineage];
  const sheetRules = await fs.readFile(path.join(ROOT, 'system', 'rules', cfg.file), 'utf-8').catch(() => '');
  const systemPrompt = `Ты — Мастер ${cfg.master}. Составляешь игромеханический лист персонажа СТРОГО по правилам и шаблону ниже.

# ПРАВИЛА ЛИСТА (${cfg.file})
${sheetRules.slice(0, 16000)}`;

  // Clan-specific discipline grounding (vampires only) — pulls the real library text for the
  // character's in-clan disciplines so the AI picks from real powers instead of inventing names.
  let clanDiscBlock = '';
  if (sheetLineage === 'vampire') {
    const clanName = (card || '').match(/-\s*\*\*Клан(?:\s*\/[^*]*)?:\*\*\s*([^\n]+)/i)?.[1] || '';
    if (clanName.trim() && !clanName.includes('⚠️')) {
      try {
        const allDisc = await loadDisciplines();
        const matched = disciplinesForClan(allDisc, clanName);
        if (matched.length) {
          const names = matched.map(d => d.name).join(', ');
          const texts = matched.map(d => _disciplineLevelsText(d)).filter(Boolean).join('\n\n');
          clanDiscBlock = `\n\n# КЛАНОВЫЕ ДИСЦИПЛИНЫ (${clanName.trim()})\nИспользуй ТОЛЬКО эти клановые дисциплины при распределении точек дисциплин: ${names}. Вот их описание для использования при подборе конкретных сил:\n\n${texts}`;
        } else {
          console.warn(`[sheet] клан «${clanName.trim()}» не найден в system/library/disciplines/*.md — использую только таблицу из правил`);
        }
      } catch (e) {
        console.warn('[sheet] не удалось загрузить библиотеку дисциплин:', e.message);
      }
    }
  }

  // Psychic-power grounding (mortals only) — mirrors clanDiscBlock above, but triggered by a
  // free-text heuristic instead of a structured card field: the card schema has no dedicated
  // «экстрасенс»/«психик» flag (checked system/schema/card_schema.md and real mortal cards —
  // e.g. cities/balmont/characters/mortals/dzhudi/dzhudi.md just says «Проявила парапсихические
  // способности» in «Биография»), so we scan the card text for that vocabulary. If nothing
  // matches, the prompt says nothing about the section and the AI leaves «Нумина / Грани» empty/
  // 0, same as a vampire card with no clan info gets Дисциплины:0.
  let psyBlock = '';
  if (sheetLineage === 'mortal') {
    const isPsychicHint = /экстрасенс|психик|парапсих|телепат|ясновиден|медиум(?!а)|предвидени|прорицател/i.test(card || '');
    if (isPsychicHint) {
      try {
        const allPsy = await loadPsychics();
        if (allPsy.length) {
          const names = allPsy.map(p => p.name).join(', ');
          const texts = allPsy.map(p => _disciplineLevelsText(p)).filter(Boolean).join('\n\n');
          psyBlock = `\n\n# ПСИХИЧЕСКИЕ СПОСОБНОСТИ (карточка указывает на экстрасенсорный дар)\nПерсонаж — экстрасенс. Заполни раздел «Нумина / Грани» 1–3 способностями ТОЛЬКО из этого списка (не выдумывай новые): ${names}. Описание для подбора конкретных сил по уровням:\n\n${texts}\n\nТочки на способности — по правилу проекта (Шаг 8, character_sheet_mortal.md): 3 точки суммарно, свободно по способностям, максимум 3 в одной при создании; эти точки списываются из обычного бюджета смертного (Достоинства/Свободные очки), а не выдаются дополнительно.`;
        }
      } catch (e) {
        console.warn('[sheet] не удалось загрузить библиотеку психических способностей:', e.message);
      }
    }
  }

  const pools = _SHEET_POOLS[sheetLineage];
  const poolsLine = pools
    ? `Атрибуты: ${pools.attrs.join('/')} (по приоритету) · Способности: ${pools.abilities.join('/')} (по приоритету)`
      + (pools.disciplines ? ` · Дисциплины: ${pools.disciplines}` : '')
      + (pools.gifts       ? ` · Дары: ${pools.gifts}`              : '')
      + (pools.spheres     ? ` · Сферы: ${pools.spheres}`           : '')
      + ` · Факты биографии: ${pools.backgrounds} · Добродетели: ${pools.virtues}`
    : '';

  const userPrompt = `Составь ПОЛНЫЙ лист персонажа «${displayName}» по карточке ниже.

# КАРТОЧКА ПЕРСОНАЖА
${(card || '').slice(0, 3500)}
${clanDiscBlock}${psyBlock}

Требования:
- Точно следуй СТРУКТУРЕ, ПОРЯДКУ и ФОРМАТУ ШАБЛОНА из правил (заголовки «##», таблицы, точки «●○»).
- Используй ТОЛЬКО названия характеристик и разделов из ШАБЛОНА выше. Названия атрибутов/способностей — по бланку STV2098: Обаяние, Привлекательность; Бдительность, Драка, Красноречие, Уличное чутьё, Хитрость, Шестое чувство; Исполнение, Стрельба, Фехтование; Гуманитарные/Естественные науки, Информатика, Законы, Электроника; Факты биографии; Совесть/Решимость, Самоконтроль/Инстинкты, Смелость; Маска, Амплуа. НЕ используй старые синонимы (Харизма, Внешность, Рукопашный бой, Огнестрельное оружие и т.п.).
- ОБЯЗАТЕЛЬНО учитывай специфику и роль персонажа (Шаг 7): профильные способности — высокие, непрофильные — низкие.
- Характеристики 1–5, способности 0–5; ${cfg.extras}.
${poolsLine ? `- ⚠️ ОБЯЗАТЕЛЬНО ПОЛНОСТЬЮ РАСПРЕДЕЛИ ВСЕ ОЧКИ ВО ВСЕХ ПУЛАХ СОЗДАНИЯ, без остатка: ${poolsLine}. Не оставляй неизрасходованные точки — если по концепции трудно найти применение, добавь точку в наименее заметную профильную черту, но пул должен быть исчерпан полностью.\n` : ''}- Заполни ВСЕ разделы шаблона. Поля без данных в карточке заполняй разумно по концепции или ставь «—». Разделы, помеченные «опционально/если есть», включай только при наличии данных.
- Для КАЖДОЙ точечной черты (характеристики, способности, дисциплины/искусства/сферы, факты биографии, добродетели) указывай И точки, И число в формате «| Название | ●●●○○ | N |» — чтобы лист можно было редактировать.
- Верни ТОЛЬКО markdown листа, начиная с «# 🎲 ${displayName} — Лист персонажа (${cfg.title})». Без пояснений и без \`\`\`.`;
  const out = await genTextWithRetry(gen, { system: systemPrompt, user: userPrompt, maxTokens: 5000 });
  const text = (out.text || '').replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  if (pools) _warnIfPoolsUnderspent(text, pools, displayName);
  return text;
}

// Lightweight post-generation sanity check (warn-only, no auto-repair): sum the dot-ratings
// in each pool's table rows and compare to the expected pool size. Intentionally simple — it
// doesn't attempt to re-derive priority groups (1st/2nd/3rd) precisely, just totals per
// section, since a perfect solver is out of scope for a first pass (see task notes).
// Matches against the CURRENT heading text — «##» (e.g. «🎯 Способности») OR the most recent
// «###» subheading (e.g. «### Дисциплины», «### Добродетели (Virtues)» — these three pools
// live as «###» subsections under one shared «## ✨ Преимущества» heading in the template).
function _sheetSectionDotTotal(md, sectionRe) {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  let h2 = '', h3 = '', total = 0, sawAny = false;
  for (const ln of lines) {
    const m2 = ln.match(/^##\s+(.+)$/);
    if (m2) { h2 = m2[1]; h3 = ''; continue; }
    const m3 = ln.match(/^###\s+(.+)$/);
    if (m3) { h3 = m3[1]; continue; }
    if (!sectionRe.test(h2) && !sectionRe.test(h3)) continue;
    if (!/^\s*\|/.test(ln) || /\|\s*:?-{3,}/.test(ln)) continue;
    const cells = ln.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const name = cells[0].replace(/\*\*/g, '').trim();
    if (!name || /^(способност|характеристик|атрибут|дисциплин|факт биографии|backgrounds|предыстор|добродетел|название|поле)/i.test(name)) continue;
    const dotsCell = cells.find(c => /^[●○]+$/.test(c));
    if (dotsCell) { total += (dotsCell.match(/●/g) || []).length; sawAny = true; }
  }
  return sawAny ? total : null;
}
function _warnIfPoolsUnderspent(md, pools, displayName) {
  const checks = [
    ['Способности',         /способност/i,  pools.abilities ? pools.abilities.reduce((a, b) => a + b, 0) : null],
    ['Дисциплины',          /дисциплин/i,    pools.disciplines ?? null],
    ['Дары',                /дар[ыа]\b/i,    pools.gifts       ?? null],
    ['Сферы',               /сфер[ыа]\b/i,   pools.spheres     ?? null],
    ['Факты биографии',     /факт.*биограф|backgrounds|предыстор/i, pools.backgrounds ?? null],
    ['Добродетели',         /добродетел/i,   pools.virtues ?? null],
  ];
  for (const [label, re, expected] of checks) {
    if (expected == null) continue;
    const got = _sheetSectionDotTotal(md, re);
    if (got != null && got < expected) {
      console.warn(`[sheet] «${displayName}»: пул «${label}» недораспределён — ${got}/${expected} точек`);
    }
  }
}

// Insert «> 🎲 [Лист персонажа](rel)» under the card H1 if not present.
async function _ensureSheetLink(cardPath, sheetRel) {
  let txt = await fs.readFile(cardPath, 'utf-8').catch(() => '');
  if (!txt || txt.includes(`(${sheetRel})`)) return;
  txt = txt.replace(/^(﻿?#\s+.+\n)/, `$1\n> 🎲 [Лист персонажа](${sheetRel})\n`);
  await writeFileAtomic(cardPath, txt, 'utf-8');
}

// Generate (or regenerate) a canonical character's sheet
app.post('/api/characters/:slug/sheet/generate', express.json(), async (req, res) => {
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
    let text = await _generateV20Sheet({ card, displayName: char.name, gen, lineage: char.lineageFolder });
    if (!text) return res.status(500).json({ ok: false, error: 'ИИ вернул пустой лист' });
    // Re-stamp header fields already known from the card — the AI is given the card
    // text but can still paraphrase/invent name·clan·generation·sire; force them back
    // to the card's own values so the sheet never disagrees with «Информация».
    for (const [key, label] of Object.entries(SHEET_HEADER_FROM_CARD)) {
      const v = String(char[key] || '').trim();
      if (v && !v.includes('⚠️')) text = _setSheetHeaderCell(text, label, v);
    }
    await writeFileAtomic(path.join(dir, `${char.slug}-sheet.md`), text + '\n', 'utf-8');
    await _ensureSheetLink(path.join(dir, `${char.slug}.md`), `${char.slug}-sheet.md`);
    res.json({ ok: true, content: text });
  } catch (e) { res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ ok: false, error: e.message }); }
});

// Save an edited canonical sheet (raw markdown from the editor)
app.put('/api/characters/:slug/sheet', express.json(), async (req, res) => {
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
    await _ensureSheetLink(path.join(dir, `${char.slug}.md`), `${char.slug}-sheet.md`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Structured V20 sheet data (JSON sidecar) ──────────────────────────────────
// Source of truth for the interactive blank on the «Лист V20» tab. Falls back to
// parsing the AI markdown sheet (client-side) when no JSON exists yet, or when
// ?fromMd=1 forces a reseed after an AI (re)generation.
app.get('/api/characters/:slug/sheet-data', async (req, res) => {
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

app.put('/api/characters/:slug/sheet-data', express.json({ limit: '1mb' }), async (req, res) => {
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
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Module NPC sheets (episodic NPCs: chronicles/<chr>/modules/<mod>/npc/<slug>/) ──
function _npcSheetPaths(city, chr, mod, slug) {
  const dir = path.join(chroniclesDir(city), chr, 'modules', mod, 'npc', slug);
  return { dir, card: path.join(dir, `${slug}.md`), sheet: path.join(dir, `${slug}-sheet.md`) };
}

app.get('/api/chronicles/:chr/modules/:mod/npc/:slug/sheet', async (req, res) => {
  try {
    const { chr, mod, slug } = req.params;
    const { sheet } = _npcSheetPaths(reqCity(req), chr, mod, decodeURIComponent(slug));
    const content = await fs.readFile(sheet, 'utf-8').catch(() => null);
    res.json({ exists: content !== null, content: content || '' });
  } catch (e) { serverError(res, e); }
});

app.post('/api/chronicles/:chr/modules/:mod/npc/:slug/sheet/generate', express.json(), async (req, res) => {
  try {
    const { chr, mod, slug } = req.params;
    const p = _npcSheetPaths(reqCity(req), chr, mod, decodeURIComponent(slug));
    const card = await fs.readFile(p.card, 'utf-8').catch(() => '');
    if (!card) return res.status(404).json({ ok: false, error: 'Карточка НПС не найдена' });
    const displayName = (card.match(/^#{1,6}\s+(.+)$/m)?.[1] || slug)
      .replace(/^[^\p{L}]+/u, '').replace(/^карточка\s+нпс\s*:?\s*/i, '').split(/\s*[—–]\s*/)[0].trim();
    const gen  = await makeGenerationClient(req.body?.source || null, req.body?.model || null);
    const text = await _generateV20Sheet({ card, displayName, gen });
    if (!text) return res.status(500).json({ ok: false, error: 'ИИ вернул пустой лист' });
    await writeFileAtomic(p.sheet, text + '\n', 'utf-8');
    await _ensureSheetLink(p.card, `${decodeURIComponent(slug)}-sheet.md`);
    res.json({ ok: true, content: text });
  } catch (e) { res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ ok: false, error: e.message }); }
});

app.put('/api/chronicles/:chr/modules/:mod/npc/:slug/sheet', express.json(), async (req, res) => {
  try {
    const { chr, mod, slug } = req.params;
    const content = String(req.body?.content || '');
    if (!content.trim()) return res.status(400).json({ ok: false, error: 'Пустой лист' });
    const p = _npcSheetPaths(reqCity(req), chr, mod, decodeURIComponent(slug));
    if (!await fs.stat(p.dir).catch(() => null)) return res.status(404).json({ ok: false, error: 'Папка НПС не найдена' });
    await writeFileAtomic(p.sheet, content.replace(/\s*$/, '') + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── NPC promotion: episodic → canonical character ─────────────────────────────

// Check the three promotion conditions for a modular NPC.
// Returns { survived, inFinale, inMultipleModules }.
async function _checkNpcPromotion(city, chr, mod, npcSlug) {
  const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
  const npcCard = path.join(modDir, 'npc', npcSlug, `${npcSlug}.md`);

  // 1. Survived — status in the modular NPC card is not dead/destroyed
  let survived = false;
  try {
    const card = await fs.readFile(npcCard, 'utf-8');
    const sl   = (card.match(/\*\*Статус\*\*[^|\n]*\|\s*([^|\n]+)\|/)?.[1] || '').toLowerCase();
    survived   = !/(мёртв|мертв|уничтожен|погиб|убит|final death)/i.test(sl);
  } catch { survived = false; }

  // 2. Mentioned in finale.md of this module
  let inFinale = false;
  try {
    const finale = await fs.readFile(path.join(modDir, 'finale.md'), 'utf-8');
    inFinale = finale.toLowerCase().includes(npcSlug.replace(/-/g, ' '));
    if (!inFinale) {
      // Also match slug directly (dashes kept)
      inFinale = finale.toLowerCase().includes(npcSlug);
    }
    if (!inFinale) {
      // Try matching the name from the card
      const nameM = (await fs.readFile(npcCard, 'utf-8').catch(() => ''))
        .match(/^#{1,3}\s+[^\p{L}]*(.+?)(?:\s*[—–].*)?$/mu);
      if (nameM) inFinale = finale.toLowerCase().includes(nameM[1].trim().toLowerCase());
    }
  } catch { inFinale = false; }

  // 3. Appears in 2+ modules (count all modules across all chronicles that have this slug in npc/)
  let moduleCount = 0;
  try {
    const chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true });
    for (const cEntry of chrs) {
      if (!cEntry.isDirectory()) continue;
      const mods = await fs.readdir(path.join(chroniclesDir(city), cEntry.name, 'modules'), { withFileTypes: true }).catch(() => []);
      for (const mEntry of mods) {
        if (!mEntry.isDirectory()) continue;
        const exists = await fs.stat(
          path.join(chroniclesDir(city), cEntry.name, 'modules', mEntry.name, 'npc', npcSlug)
        ).catch(() => null);
        if (exists) moduleCount++;
      }
    }
  } catch { moduleCount = 1; }
  const inMultipleModules = moduleCount >= 2;

  return { survived, inFinale, inMultipleModules };
}

// GET /api/chronicles/:chr/modules/:mod/npc/:slug/promote-check
app.get('/api/chronicles/:chr/modules/:mod/npc/:slug/promote-check', async (req, res) => {
  try {
    const city    = reqCity(req);
    const { chr, mod, slug } = req.params;
    const npcSlug = decodeURIComponent(slug);
    const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
    if (!await fs.stat(path.join(modDir, 'npc', npcSlug)).catch(() => null))
      return res.status(404).json({ ok: false, error: 'Модульный НПС не найден' });
    const conditions = await _checkNpcPromotion(city, chr, mod, npcSlug);
    const canPromote = conditions.survived && conditions.inFinale && conditions.inMultipleModules;
    res.json({ ok: true, canPromote, conditions });
  } catch (e) { serverError(res, e); }
});

// POST /api/chronicles/:chr/modules/:mod/npc/:slug/promote
// Moves modular NPC into the city's canonical characters folder.
app.post('/api/chronicles/:chr/modules/:mod/npc/:slug/promote', express.json(), async (req, res) => {
  try {
    const city    = reqCity(req);
    const { chr, mod, slug } = req.params;
    const npcSlug = decodeURIComponent(slug);
    const { lineage = 'vampires', force = false } = req.body || {};

    const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
    const npcDir  = path.join(modDir, 'npc', npcSlug);
    const npcCard = path.join(npcDir, `${npcSlug}.md`);

    if (!await fs.stat(npcCard).catch(() => null))
      return res.status(404).json({ ok: false, error: 'Карточка модульного НПС не найдена' });

    // Check promotion conditions unless force=true
    if (!force) {
      const cond = await _checkNpcPromotion(city, chr, mod, npcSlug);
      if (!cond.survived || !cond.inFinale || !cond.inMultipleModules)
        return res.status(422).json({ ok: false, error: 'Условия продвижения не выполнены', conditions: cond });
    }

    const validLineages = Object.keys(LINEAGE_MAP);
    if (!validLineages.includes(lineage))
      return res.status(400).json({ ok: false, error: `Неверная линейка: ${lineage}` });

    const targetDir = path.join(charsDir(city), lineage, npcSlug);
    if (await fs.stat(targetDir).catch(() => null))
      return res.status(409).json({ ok: false, error: 'Персонаж с таким слагом уже существует в каноне' });

    // Copy NPC folder (card + any art/sheets) to canonical characters directory
    await fs.mkdir(targetDir, { recursive: true });
    const npcFiles = await fs.readdir(npcDir, { withFileTypes: true });
    for (const f of npcFiles) {
      const src = path.join(npcDir, f.name);
      const dst = path.join(targetDir, f.name);
      if (f.isDirectory()) {
        await fs.mkdir(dst, { recursive: true });
        for (const sf of await fs.readdir(src)) {
          await fs.copyFile(path.join(src, sf), path.join(dst, sf));
        }
      } else {
        await fs.copyFile(src, dst);
      }
    }

    // Patch the card: update city field if it has a placeholder
    const cardContent = await fs.readFile(path.join(targetDir, `${npcSlug}.md`), 'utf-8');
    const patched = cardContent.replace(
      /(\*\*Родной\s+город\*\*[^|\n]*\|\s*)(⚠️[^|\n]*|—)(\s*\|)/i,
      (_, pre, _old, post) => `${pre}${city.charAt(0).toUpperCase() + city.slice(1)}${post}`
    );
    if (patched !== cardContent) await writeFileAtomic(path.join(targetDir, `${npcSlug}.md`), patched, 'utf-8');

    // Update characters_index.md
    const idxPath = path.join(archiveDir(city), 'characters_index.md');
    const idxRaw  = await fs.readFile(idxPath, 'utf-8').catch(() => '');
    const name    = (cardContent.match(/^#{1,3}\s+[^\p{L}]*(.+?)(?:\s*[—–].*)?$/mu)?.[1] || npcSlug).trim();
    const idxLine = `- [${name}](../characters/${lineage}/${npcSlug}/${npcSlug}.md) — продвинут из модуля ${mod}\n`;
    if (idxRaw && !idxRaw.includes(npcSlug)) {
      await writeFileAtomic(idxPath, idxRaw.trimEnd() + '\n' + idxLine, 'utf-8');
    }

    // Invalidate character cache so the new canonical char is visible immediately
    delete _cache[city];

    res.json({ ok: true, slug: npcSlug, lineage, name });
  } catch (e) { serverError(res, e); }
});

// ── Global search ──────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  try {
    const city = reqCity(req);
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q || q.length < 3) return res.json({ query: q, results: {}, total: 0 });

    const cityBase = cityDir(city);

    const mkExcerpt = (content, len = 160) => {
      const idx = content.toLowerCase().indexOf(q);
      if (idx < 0) return content.slice(0, len).replace(/\n/g, ' ');
      const start = Math.max(0, idx - 60);
      const end   = Math.min(content.length, idx + q.length + 100);
      return (start > 0 ? '…' : '') + content.slice(start, end).replace(/\n/g, ' ') + (end < content.length ? '…' : '');
    };

    const walkMd = async (dir, filterFn) => {
      const hits = [];
      const walk = async d => {
        let entries;
        try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { await walk(p); }
          else if (e.name.endsWith('.md')) {
            if (filterFn && !filterFn(p, e.name)) continue;
            let content;
            try { content = await fs.readFile(p, 'utf-8'); } catch { continue; }
            if (content.toLowerCase().includes(q)) hits.push({ path: p, content });
          }
        }
      };
      await walk(dir);
      return hits;
    };

    const h1 = s => { const m = s.match(/^#\s+(.+)$/m); return m ? m[1].replace(/[🧛🧚🧑🐺🔮🏹⚔️🩸*_]/g, '').trim() : ''; };

    // Characters — main card only (slug/slug.md, not -sheet.md, not journals)
    const charHits = await walkMd(path.join(cityBase, 'characters'), (p, name) => {
      if (name.endsWith('-sheet.md')) return false;
      const parts = p.split(path.sep);
      const slug = parts[parts.length - 2];
      return name === `${slug}.md`;
    });
    const characters = charHits.map(m => {
      const parts  = m.path.split(path.sep);
      const slug   = parts[parts.length - 2];
      const lineage = parts[parts.length - 3];
      const linMatch = m.content.match(/Линейка WoD[:\s*]+(.+)/);
      return { slug, name: h1(m.content) || slug, lineage: linMatch ? linMatch[1].replace(/[*_]/g, '').trim() : lineage, excerpt: mkExcerpt(m.content) };
    });

    // Locations — main card only (loc-name/loc-name.md)
    const locHits = await walkMd(path.join(cityBase, 'locations'), (p, name) => {
      if (name.endsWith('-sheet.md')) return false;
      const parts = p.split(path.sep);
      const slug = parts[parts.length - 2];
      return name === `${slug}.md`;
    });
    const locations = locHits.map(m => {
      const parts = m.path.split(path.sep);
      const slug  = parts[parts.length - 2];
      return { slug, name: h1(m.content) || slug, excerpt: mkExcerpt(m.content) };
    });

    // Chronicle modules (chronicles/*/modules/**/*.md)
    const modHits = await walkMd(path.join(cityBase, 'chronicles'), p => {
      const rel = path.relative(path.join(cityBase, 'chronicles'), p);
      return rel.includes(`${path.sep}modules${path.sep}`);
    });
    const modules = modHits.map(m => {
      const parts  = m.path.split(path.sep);
      const chrIdx = parts.findIndex(x => x === 'chronicles');
      const chronicle = parts[chrIdx + 1] || '';
      const modSlug   = parts[parts.length - 2];
      return { chronicle, module: modSlug, title: h1(m.content) || modSlug, excerpt: mkExcerpt(m.content) };
    });

    // Chronicle events.md files — extract matching lines only
    const evHits = await walkMd(path.join(cityBase, 'chronicles'), (p, n) => n === 'events.md');
    const events = [];
    for (const m of evHits) {
      const parts  = m.path.split(path.sep);
      const chrIdx = parts.findIndex(x => x === 'chronicles');
      const chronicle = parts[chrIdx + 1] || '';
      for (const line of m.content.split('\n')) {
        if (line.toLowerCase().includes(q)) {
          events.push({ chronicle, excerpt: line.trim().slice(0, 220) });
          if (events.length >= 20) break;
        }
      }
    }

    // Archive docs
    const archHits = await walkMd(path.join(cityBase, 'archive'));
    const ARCHIVE_LABELS = { 'political_state.md': 'Фракции', 'timeline.md': 'Хронология', 'visitors.md': 'Визитёры', 'rumors_elysium.md': 'Слухи (Элизиум)', 'rumors_dreaming.md': 'Слухи (Грёзы)' };
    const archive = archHits.map(m => {
      const file = path.basename(m.path);
      return { file, label: ARCHIVE_LABELS[file] || file, excerpt: mkExcerpt(m.content) };
    });

    const total = characters.length + locations.length + modules.length + events.length + archive.length;
    res.json({ query: q, results: { characters, locations, modules, events, archive }, total });
  } catch (e) { serverError(res, e); }
});

app.get('/api/integrity', async (req, res) => {
  try {
    const city    = reqCity(req);
    const chars   = await getAllCharacters(city);
    const names   = chars.map(c => c.name);
    const byName  = Object.fromEntries(chars.map(c => [c.name, c]));
    const resolve = makeNameResolver(names);

    // 1–2. Relationship symmetry + phantom targets
    const asymmetry = [];
    const phantom   = [];
    const phantomSeen = new Set();
    for (const c of chars) {
      for (const r of (c.relationships || [])) {
        const tgt = resolve(r.target);
        if (!tgt) {
          const key = c.name + '\x00' + r.target;
          if (!phantomSeen.has(key)) { phantomSeen.add(key); phantom.push(`${c.name} → «${r.target}» (карточки нет)`); }
          continue;
        }
        if (tgt === c.name) continue;
        const hasReverse = (byName[tgt].relationships || []).some(rr => resolve(rr.target) === c.name);
        if (!hasReverse) {
          const d = (r.description || '').split(';')[0].slice(0, 50);
          asymmetry.push(`${c.name} → ${tgt}${d ? ': «' + d + '»' : ''}`);
        }
      }
    }

    // 3. Chronicle participant lacking a diary entry for the event's month
    //    (only flagged for characters who already keep a journal → low noise)
    const diaryGap = [];
    const gapSeen  = new Set();
    {
      const events   = await aggregateEvents(city);
      const diaryIdx = await getDiaryIndex(city, chars);
      for (const ev of (events || [])) {
        const mk = eventMonthKey(ev.date);
        for (const p of (ev.participants || [])) {
          const name = resolve(p.name);
          if (!name) continue;
          const di = diaryIdx[name];
          if (!di || !di.has) continue;
          const preNov2010 = mk && (mk.year < 2010 || (mk.year === 2010 && mk.month < 11));
          const expected = preNov2010 ? 'retrospective.md' : (mk ? `${mk.key}.md` : null);
          if (!expected) continue;
          const dedup = name + '\x00' + expected;
          if (di.files.has(expected) || gapSeen.has(dedup)) continue;
          gapSeen.add(dedup);
          const label = preNov2010 ? 'retrospective' : mk.key;
          diaryGap.push(`${name}: нет записи «${label}» (${(ev.title || ev.date).slice(0, 40)})`);
        }
      }
    }

    // 4. Registry drift between disk folders and cities/<город>/archive/characters_index.md
    const actual     = new Set(chars.map(c => `${c.lineageFolder}/${c.slug}`));
    const referenced = new Set();
    try {
      const all = await fs.readFile(path.join(archiveDir(city), 'characters_index.md'), 'utf-8');
      // Match paths like ../characters/vampires/slug/ or characters/vampires/slug/ or vampires/slug/
      const re = /\([^)]*?\/(vampires|fairies|mortals|werewolves|mages|hunters)\/([^/)]+)\//g;
      let m;
      while ((m = re.exec(all)) !== null) referenced.add(`${m[1]}/${decodeURIComponent(m[2])}`);
    } catch {}
    const registryOrphan   = [...actual].filter(a => !referenced.has(a)).map(a => a.split('/')[1]);
    const registryDangling = [...referenced].filter(r => !actual.has(r)).map(r => r.split('/')[1]);

    const checks = [
      { id: 'asymmetry',         label: 'Односторонние связи',              severity: 'warn', hint: 'A ссылается на B, но B не ссылается на A',                items: asymmetry },
      { id: 'phantom',           label: 'Связи на несуществующие карточки', severity: 'info', hint: 'цель связи не сопоставлена с карточкой (возможен алиас/прозвище)', items: phantom },
      { id: 'diary_gap',         label: 'Участник без дневника за месяц',   severity: 'info', hint: 'у персонажа есть журнал, но нет записи за месяц события', items: diaryGap },
      { id: 'registry_orphan',   label: 'Папка не внесена в characters_ALL',severity: 'warn', hint: 'персонаж есть на диске, но не в реестре',                 items: registryOrphan },
      { id: 'registry_dangling', label: 'Запись реестра без папки',         severity: 'err',  hint: 'реестр ссылается на несуществующую папку',               items: registryDangling },
    ];

    const totalIssues = checks.reduce((n, c) => n + c.items.length, 0);
    res.json({ brokenLinks: _brokenLinks, totalIssues, checks });
  } catch (e) { serverError(res, e); }
});

// ── Canon consistency check (AI) — flags contradictions in a logged event ──────

app.post('/api/canon-check', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'Пустой текст для проверки' });
    if (text.length > 8000) return res.status(400).json({ ok: false, error: 'Слишком длинный текст (макс ~8000 символов)' });

    const chars = await getAllCharacters(city);
    const facts = chars.map(c => {
      const st = (c.status && !/⚠️/.test(c.status)) ? c.status
               : (c.statusDetails && !/⚠️/.test(c.statusDetails) ? c.statusDetails : (c.statusType || '—'));
      const bits = [
        c.clan && !/⚠️/.test(c.clan) ? c.clan : null,
        c.embraceYear && !/⚠️|не указан/i.test(c.embraceYear) ? `обращён ${c.embraceYear}` : null,
        (c.hierarchy && !/⚠️/.test(c.hierarchy)) ? c.hierarchy : ((c.role && !/⚠️/.test(c.role)) ? c.role : null),
      ].filter(Boolean).join('; ');
      return `- ${c.name} [${c.lineage}] — статус: ${st}${bits ? ` — ${bits}` : ''}`;
    }).join('\n');

    const gen = await makeGenerationClient(req.body?.source || null, req.body?.model || null);
    const systemPrompt = `Ты — проверяющий непротиворечивость канона в Vampire: The Masquerade V20.
Тебе дают ТЕКСТ логируемого события (сцена/сессия) и УСТАНОВЛЕННЫЕ ФАКТЫ о персонажах города.
Найди ПРОТИВОРЕЧИЯ между фактами и текстом. Типы:
- уничтоженный / в финальной смерти / в торпоре персонаж действует как живой активный участник;
- участие до обращения или до прибытия в город (несовместимость дат);
- статус/должность не соответствует (назван должностью, которой ещё или уже не имеет);
- персонаж одновременно в двух местах / там, где быть не мог по фактам.

ОСОБО проверяй ДАТЫ. Найди в тексте дату/год и сравни с датами в фактах:
- участие РАНЬШЕ года обращения персонажа — противоречие;
- должность с пометкой «с <месяц год>»: если дата текста РАНЬШЕ этой даты — персонаж ещё НЕ занимал должность, называть его так нельзя (противоречие);
- статус «Уничтожен (<дата>)»: действие ПОСЛЕ даты уничтожения — противоречие.
Пример: факт «Шериф (с ноября 2010)»; текст «декабрь 2009 … Шериф такой-то» → противоречие: в 2009 он ещё не Шериф.

Сообщай ТОЛЬКО реальные противоречия с фактами. Догадки и стилистику не трогай. Если противоречий нет — пустой массив.

# УСТАНОВЛЕННЫЕ ФАКТЫ (источник истины)
${facts.slice(0, 7000)}`;

    const userPrompt = `ТЕКСТ СОБЫТИЯ:
${text}

Верни СТРОГО JSON-массив без текста вне JSON:
[{"severity":"high|medium|low","character":"<имя>","issue":"<что не сходится с фактом>","quote":"<короткая цитата из текста>"}]
Если противоречий нет — верни [].`;

    let raw = '';
    if (_isOA(gen)) {
      raw = await _oaCall(gen)(gen.model, systemPrompt, userPrompt, [], 75000, 1500);
    } else {
      const m = await gen.client.messages.create({
        model: gen.model, max_tokens: 1500, system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      raw = m.content[0]?.text?.trim() || '';
    }
    let issues = [];
    try { issues = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || '[]'); } catch {}
    if (!Array.isArray(issues)) issues = [];
    res.json({ ok: true, issues, checked: chars.length });
  } catch (e) {
    const status = e.status ?? 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({ ok: false, error: e.message ?? String(e) });
  }
});

// ── Run a PowerShell tool ─────────────────────────────────────────────────────

// Switch params: passed as bare flags (-Name) without a value string.
// List them here so they aren't quoted as strings in the PS command.
const SWITCH_PARAMS = ['Fix'];

// Tools that write project files → trigger background revalidation on success.
const FILE_MUTATING_TOOLS = new Set(['new_npc', 'new_city']);

// ── Run a Node CLI tool (cities/-aware) ────────────────────────────────────────
// Args are passed as an array to spawn() WITHOUT a shell → no injection risk.
const NODE_TOOLS = new Set(['new_city', 'new_npc', 'new_location', 'migrate_char', 'close_chronicle', 'build_city_events', 'sync_index']);
app.post('/api/tool/:name', async (req, res) => {
  const name = req.params.name;
  if (!NODE_TOOLS.has(name)) return res.status(400).json({ ok: false, output: 'Unknown tool' });
  const args = (Array.isArray(req.body.args) ? req.body.args : []).map(a => String(a));  // keep empties (positional)
  const ps = spawn('node', [path.join(ROOT, 'tools', `${name}.js`), ...args], { cwd: ROOT });
  let out = '', err = '';
  const timer = setTimeout(() => ps.kill(), 30000);
  ps.stdout.on('data', d => out += d.toString('utf8'));
  ps.stderr.on('data', d => err += d.toString('utf8'));
  ps.on('error', e => { clearTimeout(timer); res.json({ ok: false, output: e.message }); });
  ps.on('close', code => {
    clearTimeout(timer);
    if (code === 0) { _cache = {}; runValidationBackground(); }
    res.json({ ok: code === 0, output: (out + err).trim(), exitCode: code });
  });
});

app.post('/api/run-tool', async (req, res) => {
  const { tool, params = {} } = req.body;
  // PowerShell tools only. new_city/new_npc are Node tools (use /api/tool/:name);
  // module creation lives in the chronicle flow (POST /api/chronicles/:slug/modules).
  const allowed = ['validate_links', 'search'];
  if (!allowed.includes(tool)) return res.status(400).json({ error: 'Unknown tool' });

  const script = path.join(ROOT, 'tools', `${tool}.ps1`);

  // -Force skips interactive Read-Host / ReadKey for all interactive tools
  const forceFlag = ['validate_links'].includes(tool) ? '-Force' : '';

  // Regular params (-Key 'Value')
  const regularParamStr = Object.entries(params)
    .filter(([k, v]) => !SWITCH_PARAMS.includes(k) && v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `-${k} '${String(v).replace(/'/g, "''")}'`)
    .join(' ');

  // Switch params (-Key with no value)
  const switchParamStr = SWITCH_PARAMS
    .filter(k => params[k] === true || params[k] === 'true')
    .map(k => `-${k}`)
    .join(' ');

  const allArgs = [regularParamStr, forceFlag, switchParamStr].filter(Boolean).join(' ');

  const cmd = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    `& '${script.replace(/\\/g, '\\\\').replace(/'/g, "''")}' ${allArgs}`
  ].join('; ');

  const ps = spawn('powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', cmd],
    { cwd: ROOT, env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' } });

  ps.stdin.end();
  let out = '', err = '';
  ps.stdout.on('data', d => { out += d.toString('utf8'); });
  ps.stderr.on('data', d => { err += d.toString('utf8'); });

  const timer = setTimeout(() => { ps.kill(); }, 30000);

  ps.on('close', code => {
    clearTimeout(timer);
    if (code === 0) {
      _cache = {};
      if (FILE_MUTATING_TOOLS.has(tool)) runValidationBackground();
    }
    // For validate_links the exit code IS the broken link count
    if (tool === 'validate_links') _brokenLinks = code;
    res.json({ success: code === 0, output: out || err, exitCode: code });
  });
  ps.on('error', e => {
    clearTimeout(timer);
    res.json({ success: false, output: e.message, exitCode: -1 });
  });
});

// ── All images for all characters (for grid carousels) ────────────────────────

app.get('/api/characters/all-images', async (req, res) => {
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
// Переопределение ярлыка карточки по линейке (там, где он отличается от базового).
// Феи хранят локацию как «Фригольд / Локация» — пишем обратно тем же ярлыком, чтобы
// не плодить дублирующую строку «Домен / Локация».
const FIELD_LABEL_BY_LINEAGE = {
  fairies: { location: 'Фригольд / Локация' },
};
function fieldMdLabel(key, lineageFolder) {
  return (FIELD_LABEL_BY_LINEAGE[lineageFolder] || {})[key] || EDITABLE_FIELD_MAP[key];
}

// «Информация» — карточные факты (без биографии/внешности/голоса/характера, которые
// генераторы передают отдельно) для подмешивания в AI-промты, чтобы сгенерированный
// текст не противоречил клану/секте/роли и т.д. персонажа.
const INFO_KEYS_FOR_PROMPT = [
  'clan', 'sect', 'generation', 'birthYear', 'embraceYear', 'sire', 'childe',
  'location', 'hierarchy', 'disciplines', 'derangements', 'profession', 'role', 'belonging',
  'race', 'kith', 'court', 'title', 'features', 'relatives', 'attitude',
];
function charInfoLines(char) {
  const lines = [];
  if (char.gender && !char.gender.includes('⚠️')) lines.push(`Пол: ${char.gender}`);
  if (char.status && char.status !== '—') lines.push(`Статус: ${char.status}`);
  for (const key of INFO_KEYS_FOR_PROMPT) {
    const v = char[key];
    if (v && !String(v).includes('⚠️') && v !== '—') lines.push(`${EDITABLE_FIELD_MAP[key]}: ${v}`);
  }
  return lines.join('\n');
}
function charRelationshipLines(char) {
  return (char.relationships || [])
    .filter(r => r.target)
    .map(r => r.description ? `${r.target} — ${r.description}` : r.target)
    .join('\n');
}

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

app.put('/api/characters/:slug/fields', express.json(), async (req, res) => {
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
    delete _cache[city];
    await _syncSheetHeaderFromCard(city, char, fields);
    res.json({ ok: true });
  } catch (e) {
    serverError(res, e);
  }
});

// ── Update relations block ─────────────────────────────────────────────────────

app.put('/api/characters/:slug/relations', express.json(), async (req, res) => {
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
    delete _cache[city];
    res.json({ ok: true });
  } catch (e) {
    serverError(res, e);
  }
});

// ── Create a new character card (web form; vampire-aware, fills fields per rules) ─

const GENDER = ['Мужской', 'Женский'];
const _LIN_FOLDER = { vampire:'vampires', fairy:'fairies', mortal:'mortals', werewolf:'werewolves', mage:'mages', hunter:'hunters' };
const _LIN_WOD    = { vampires:'Вампир', fairies:'Фея / Ченджлинг', mortals:'Смертный', werewolves:'Оборотень', mages:'Маг', hunters:'Охотник' };
const _LIN_EMOJI  = { vampires:'🧛', fairies:'🧚', mortals:'🧑', werewolves:'🐺', mages:'🔮', hunters:'🏹' };

app.post('/api/characters', express.json(), async (req, res) => {
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

    delete _cache[city];
    console.log(`[create-character] ${city}/${folder}/${slug}`);
    res.json({ ok: true, slug, name, lineage: folder });
  } catch (e) {
    console.error('[create-character]', e.message);
    serverError(res, e);
  }
});

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

app.get('/api/characters/:slug/delete-preview', async (req, res) => {
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

app.delete('/api/characters/:slug', express.json(), async (req, res) => {
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

    delete _cache[city];
    runValidationBackground();
    console.log(`[delete-character] ${city}/${lineageFolder}/${slug} → _deleted (${delinked.length} files de-linked)`);
    res.json({ ok: true, slug, movedTo: `characters/_deleted/${path.basename(dst)}`, delinked });
  } catch (e) {
    console.error('[delete-character]', e.message);
    serverError(res, e);
  }
});

// ── Generation client factory ─────────────────────────────────────────────────
// ── Google Gemini ─────────────────────────────────────────────────────────────
// Lazy-initialised client; invalidated on /api/settings key change.
let _geminiClient = null;
function _getGeminiClient() {
  if (!process.env.GEMINI_API_KEY)
    throw Object.assign(new Error('GEMINI_API_KEY не задан. Настрой в Инструменты → Модели AI.'), { status: 503 });
  if (!_geminiClient) _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _geminiClient;
}

// Disable all harm-category blocks — VtM content (кровь, насилие, интриги, ужасы)
// без этого Gemini ложно блокирует даже банальные Gothic-описания.
const GEMINI_SAFETY = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// generateGeminiText — изолированный хелпер для текстовой прозы.
// config: { model, maxTokens, timeoutMs }
// Модель по умолчанию: GEMINI_MODEL из .env → 'gemini-2.5-flash'.
async function generateGeminiText(systemInstruction, userPrompt, config = {}) {
  const ai       = _getGeminiClient();
  const model    = config.model    || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const maxToks  = config.maxTokens  || 1500;
  const timeoutMs = config.timeoutMs || 90000;

  const genPromise = ai.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction,
      maxOutputTokens: maxToks,
      safetySettings: GEMINI_SAFETY,
    },
  });
  const timeoutPromise = new Promise((_, rej) =>
    setTimeout(() => rej(Object.assign(new Error(`Gemini не ответил за ${Math.round(timeoutMs / 1000)}с`), { status: 504 })), timeoutMs)
  );
  let response;
  try {
    response = await Promise.race([genPromise, timeoutPromise]);
  } catch (e) {
    // Wrap low-level network errors with a human-readable message
    const cause = e?.cause?.code || e?.cause?.message || '';
    if (e.message === 'fetch failed' || cause.includes('ECONNRESET') || cause.includes('ENOTFOUND')) {
      throw Object.assign(
        new Error(`Нет доступа к Google Gemini API. Проверь интернет-соединение и что брандмауэр не блокирует generativelanguage.googleapis.com (причина: ${cause || e.message})`),
        { status: 503 }
      );
    }
    throw e;
  }
  const text = response.text?.trim() || '';
  if (!text) throw Object.assign(new Error(`Gemini вернул пустой ответ от модели «${model}»`), { status: 502 });
  return text;
}

// Priority: Gemini (explicit) → OpenRouter (.env) → ANTHROPIC_API_KEY → Claude.ai OAuth

const CLAUDE_CREDS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude', '.credentials.json'
);
const VALID_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];

// preferSource: 'openrouter' | 'openai' | 'claude' | null (auto)
// ── Test mock provider ────────────────────────────────────────────────────────
// When AI_MOCK is set (automated tests only), generation returns deterministic
// canned text instead of contacting any provider — no API keys, no cost, no
// network. The mock is shaped like the Anthropic SDK response (`content[0].text`)
// and uses source 'mock' so `_isOA` is false and every call site takes the
// `gen.client.messages.create` branch we stub here.
function _mockGenText(system = '', user = '') {
  const s = `${system}\n${user}`;
  if (/РЕПЛИКИ\s+НПС|реплик/i.test(s))
    return '«Тише — у стен Элизиума длинные уши.» (поправляет манжету)\n«Приходи в полночь. Одна.»';
  if (/непротиворечивост|канон/i.test(s))
    return 'Противоречий не выявлено. []';
  if (/лист|V20|атрибут|способност/i.test(s))
    return '## Атрибуты\n\n- Сила ●●○○○\n- Ловкость ●●●○○\n- Выносливость ●●○○○\n\n## Способности\n\n- Бдительность ●●●○○\n- Драка ●●○○○\n';
  if (/пересказ|ранее в хронике|рекап/i.test(s))
    return 'Ранее в хронике: интрига вокруг убийства набрала ход, а Маскарад дал трещину.';
  return 'MOCK_AI: текст-заглушка для автотестов.';
}
const _mockGenClient = {
  messages: {
    create: async ({ system = '', messages = [] } = {}) => {
      const first = Array.isArray(messages) ? messages[0] : null;
      const user  = first
        ? (typeof first.content === 'string' ? first.content : JSON.stringify(first.content))
        : '';
      return { content: [{ type: 'text', text: _mockGenText(system, user) }] };
    },
  },
};

async function makeGenerationClient(preferSource = null, modelOverride = null) {
  if (process.env.AI_MOCK) return { source: 'mock', model: 'mock-model', client: _mockGenClient };
  const wantGemini = preferSource === 'gemini';
  const wantOR     = preferSource === 'openrouter';
  const wantOpenAI = preferSource === 'openai' || preferSource === 'gpt';
  const wantClaude = preferSource === 'claude';
  const wantNonClaude = wantGemini || wantOR || wantOpenAI;

  const geModel = () => modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const orModel = () => modelOverride || process.env.OPENROUTER_MODEL || 'openrouter/free';
  const oaModel = () => modelOverride || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const clModel = () => modelOverride || 'claude-opus-4-8';

  // ── Google Gemini (explicit only) ─────────────────────────────
  if (wantGemini && process.env.GEMINI_API_KEY) {
    return { source: 'gemini', model: geModel() };
  }

  // ── OpenAI (explicit) ─────────────────────────────────────────
  if (wantOpenAI && process.env.OPENAI_API_KEY) {
    return { source: 'openai', model: oaModel() };
  }

  // ── OpenRouter ────────────────────────────────────────────────
  if ((wantOR || (!wantClaude && !wantOpenAI && !wantGemini && !preferSource)) && process.env.OPENROUTER_API_KEY) {
    return { source: 'openrouter', model: orModel() };
  }

  // ── Anthropic API key ─────────────────────────────────────────
  if (!wantNonClaude && process.env.ANTHROPIC_API_KEY) {
    return { source: 'api-key', client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), model: clModel() };
  }

  // ── Claude.ai OAuth (Claude Code login) ──────────────────────
  if (!wantNonClaude) {
    try {
      const oauth = await _readOauthCached();
      if (oauth?.accessToken) {
        if (oauth.expiresAt && Date.now() >= oauth.expiresAt) {
          // Try to refresh silently before giving up
          if (oauth.refreshToken) {
            try {
              const refreshed = await _refreshClaudeOauth();
              return { source: 'claude-login', client: new Anthropic({ authToken: refreshed.accessToken }), model: clModel() };
            } catch { /* fall through to error */ }
          }
          _oauthCredsCacheAt = 0; // invalidate so next call re-reads
          throw new Error('Claude.ai OAuth токен истёк. Войди заново (Инструменты → Модели AI) или выполни команду в Claude Code.');
        }
        return { source: 'claude-login', client: new Anthropic({ authToken: oauth.accessToken }), model: clModel() };
      }
    } catch (e) {
      if (e.message.includes('истёк')) throw e;
    }
  }

  // ── Fallbacks: requested provider has no key — use whatever is configured ──
  if (process.env.OPENAI_API_KEY     && !wantOR && !wantClaude) return { source: 'openai',     model: oaModel() };
  if (process.env.OPENROUTER_API_KEY && !wantClaude)            return { source: 'openrouter', model: orModel() };
  if (process.env.GEMINI_API_KEY     && !wantClaude)            return { source: 'gemini',     model: geModel() };

  throw new Error(
    'Нет источника для генерации. Варианты:\n' +
    '• web/.env: GEMINI_API_KEY=...\n' +
    '• web/.env: OPENROUTER_API_KEY=sk-or-...\n' +
    '• web/.env: OPENAI_API_KEY=sk-...\n' +
    '• ANTHROPIC_API_KEY в переменных окружения\n' +
    '• Запусти Claude Code для OAuth-авторизации'
  );
}

// ── OpenRouter vision call (OpenAI-compatible) ────────────────────────────────

// Free vision models — verified live 2026-06
const OR_FALLBACK_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

// Provider routing for OpenAI-compatible APIs (OpenRouter & OpenAI share the schema).
function _oaEndpoint(provider) {
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    };
  }
  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'http://localhost:3000',
      'X-Title':       'Sanguine System',
    },
  };
}

// Shared chat completion for OpenAI-compatible providers ('openrouter' | 'openai').
async function _chatCompletion({ provider, model, systemPrompt, userPrompt, imageBuffers = [], timeoutMs = 75000, maxTokens = 1500 }) {
  const content = [
    ...imageBuffers.map(({ buf, mime }) => ({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${buf.toString('base64')}` },
    })),
    { type: 'text', text: userPrompt },
  ];

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content },
    ],
  });

  const { url, headers } = _oaEndpoint(provider);
  const label = provider === 'openai' ? 'OpenAI' : 'OpenRouter';

  // Abort the request if the model never responds, so callers don't hang forever.
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error(`Модель «${model}» не ответила за ${Math.round(timeoutMs / 1000)}с`), { status: 504 });
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    let msg = errText || resp.statusText;
    try { msg = JSON.parse(errText)?.error?.message || msg; } catch { /* not JSON — keep raw text */ }
    throw Object.assign(new Error(msg), { status: resp.status });
  }

  const data  = await resp.json();
  const msg   = data.choices?.[0]?.message;
  // Some reasoning models return content: null — fall back to reasoning text
  const text  = (msg?.content || msg?.reasoning || '').trim();
  if (!text) {
    // Image-generation models return images[], not text
    if (msg?.images?.length) {
      throw Object.assign(new Error(`Модель «${data.model}» — генератор изображений, а не текста. Выберите другую модель в настройках ИИ.`), { status: 502 });
    }
    throw Object.assign(new Error(`${label} вернул пустой ответ от модели «${data.model || model}»`), { status: 502 });
  }
  return text;
}

async function callOpenRouter(model, systemPrompt, userPrompt, imageBuffers, timeoutMs = 75000, maxTokens = 1500) {
  return _chatCompletion({ provider: 'openrouter', model, systemPrompt, userPrompt, imageBuffers: imageBuffers || [], timeoutMs, maxTokens });
}
async function callOpenAI(model, systemPrompt, userPrompt, imageBuffers, timeoutMs = 75000, maxTokens = 1500) {
  return _chatCompletion({ provider: 'openai', model, systemPrompt, userPrompt, imageBuffers: imageBuffers || [], timeoutMs, maxTokens });
}

// OpenAI-compatible providers (single call shape) vs Anthropic SDK.
const _isOA     = gen => gen.source === 'openrouter' || gen.source === 'openai';
const _oaCall   = gen => (gen.source === 'openai' ? callOpenAI : callOpenRouter);
// OpenRouter gets curated free-model fallbacks; OpenAI uses just the chosen model.
const _oaModels = gen => (gen.source === 'openai' ? [gen.model] : [gen.model, ...OR_FALLBACK_MODELS.filter(m => m !== gen.model)]);

// Plain-text generation with 429/529 retry (Claude) + automatic OpenRouter fallback.
// Anthropic subscription/API keys rate-limit aggressively; this keeps short generations
// (NPC replies, etc.) from hard-failing — it backs off, then falls back to a free model.
async function genTextWithRetry(gen, { system, user, maxTokens = 900, fallbackOR = true }) {
  if (gen.source === 'gemini') {
    const text = await generateGeminiText(system, user, { model: gen.model, maxTokens });
    return { text, source: 'gemini', model: gen.model };
  }
  if (_isOA(gen)) {
    return { text: await _oaCall(gen)(gen.model, system, user, [], 75000, maxTokens), source: gen.source, model: gen.model };
  }
  const delays = [1000, 3000, 6000];
  for (let attempt = 0; ; attempt++) {
    try {
      const m = await gen.client.messages.create({
        model: gen.model, max_tokens: maxTokens, system,
        messages: [{ role: 'user', content: user }],
      });
      return { text: m.content[0]?.text?.trim() || '', source: gen.source, model: gen.model };
    } catch (e) {
      const code = e.status ?? e.statusCode;
      const overloaded = code === 429 || code === 529;
      if (overloaded && attempt < delays.length) {
        const ra = Number(e.headers?.['retry-after']) * 1000;
        await new Promise(r => setTimeout(r, ra > 0 ? ra : delays[attempt]));
        continue;
      }
      // Out of retries — fall back so the user still gets output (OpenAI first, then a free OpenRouter model)
      if (overloaded && fallbackOR && process.env.OPENAI_API_KEY) {
        const m = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        return { text: await callOpenAI(m, system, user, [], 75000, maxTokens), source: 'openai-fallback', model: m };
      }
      if (overloaded && fallbackOR && process.env.OPENROUTER_API_KEY) {
        const orModel = process.env.OPENROUTER_MODEL || 'openrouter/free';
        return { text: await callOpenRouter(orModel, system, user, []), source: 'openrouter-fallback', model: orModel };
      }
      throw e;
    }
  }
}

// ── Auth status endpoint ──────────────────────────────────────────────────────

app.get('/api/auth-status', async (req, res) => {
  try {
    // Google Gemini (shown only when explicitly queried; doesn't override OpenRouter default)
    if (process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
      return res.json({ source: 'gemini', ok: true, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
    }

    // OpenRouter
    if (process.env.OPENROUTER_API_KEY) {
      return res.json({
        source: 'openrouter',
        ok:     true,
        model:  process.env.OPENROUTER_MODEL || 'openrouter/free',
      });
    }

    // OpenAI / GPT
    if (process.env.OPENAI_API_KEY) {
      return res.json({ source: 'openai', ok: true, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' });
    }

    // Anthropic API key
    if (process.env.ANTHROPIC_API_KEY) {
      return res.json({ source: 'api-key', ok: true });
    }

    // Claude.ai OAuth
    const raw   = await fs.readFile(CLAUDE_CREDS_PATH, 'utf-8').catch(() => null);
    const creds = raw ? JSON.parse(raw) : null;
    const oauth = creds?.claudeAiOauth;
    if (oauth?.accessToken) {
      const expired   = Date.now() >= (oauth.expiresAt || 0);
      const expiresIn = Math.round((oauth.expiresAt - Date.now()) / 60000);
      return res.json({
        source: 'claude-login', ok: !expired,
        subscription: oauth.subscriptionType || 'unknown',
        expiresIn: expired ? 0 : expiresIn, expired,
      });
    }

    res.json({ source: 'none', ok: false });
  } catch (e) {
    serverError(res, e);
  }
});

// ── Claude Code OAuth login (subscription token, no API key) ───────────────────
// Same PKCE flow Claude Code CLI uses: build an authorize URL, user logs in and
// pastes the returned code, we exchange it for a token and write .credentials.json.
const CLAUDE_OAUTH = {
  clientId:     '9d1c250a-e61b-44d9-88ed-5944d1962f5e', // Claude Code public client
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl:     'https://console.anthropic.com/v1/oauth/token',
  redirectUri:  'https://console.anthropic.com/oauth/code/callback',
  scope:        'org:create_api_key user:profile user:inference',
};
const _oauthPending = new Map(); // state -> { verifier, createdAt }

function _pkcePair() {
  const verifier  = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// Merge an OAuth token response into ~/.claude/.credentials.json (touch only claudeAiOauth).
async function _writeClaudeOauth(tokenData, prevRefresh = null) {
  const oauth = {
    accessToken:      tokenData.access_token,
    refreshToken:     tokenData.refresh_token || prevRefresh || null,
    expiresAt:        tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null,
    scopes:           (tokenData.scope || CLAUDE_OAUTH.scope).split(' '),
    subscriptionType: tokenData.subscription_type || tokenData.account?.subscription_type || 'unknown',
  };
  let creds = {};
  try { creds = JSON.parse(await fs.readFile(CLAUDE_CREDS_PATH, 'utf-8')); } catch {}
  if (!creds || typeof creds !== 'object') creds = {};
  creds.claudeAiOauth = oauth;
  await fs.mkdir(path.dirname(CLAUDE_CREDS_PATH), { recursive: true }).catch(() => {});
  await writeFileAtomic(CLAUDE_CREDS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
  _oauthCredsCache = oauth; _oauthCredsCacheAt = Date.now();
  return oauth;
}

// Refresh an expired access token using the stored refresh_token.
async function _refreshClaudeOauth() {
  const oauth = await _readOauthCached();
  if (!oauth?.refreshToken) throw Object.assign(new Error('Нет refresh_token — войди через Claude Code заново.'), { status: 400 });
  const r = await fetch(CLAUDE_OAUTH.tokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken, client_id: CLAUDE_OAUTH.clientId }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error_description || data.error || `Обновление токена не удалось (${r.status})`), { status: r.status });
  return _writeClaudeOauth(data, oauth.refreshToken);
}

const _oauthInfo = o => o && ({
  expired:      !!(o.expiresAt && Date.now() >= o.expiresAt),
  subscription: o.subscriptionType || 'unknown',
  expiresIn:    o.expiresAt ? Math.max(0, Math.round((o.expiresAt - Date.now()) / 60000)) : null,
  hasRefresh:   !!o.refreshToken,
});

// Step 1 — build the authorize URL (PKCE) and remember the verifier by state.
app.post('/api/claude/oauth/start', express.json(), async (req, res) => {
  try {
    const { verifier, challenge } = _pkcePair();
    const state = crypto.randomBytes(16).toString('hex');
    _oauthPending.set(state, { verifier, createdAt: Date.now() });
    for (const [k, v] of _oauthPending) if (Date.now() - v.createdAt > 15 * 60_000) _oauthPending.delete(k);

    const u = new URL(CLAUDE_OAUTH.authorizeUrl);
    u.searchParams.set('code', 'true');
    u.searchParams.set('client_id', CLAUDE_OAUTH.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', CLAUDE_OAUTH.redirectUri);
    u.searchParams.set('scope', CLAUDE_OAUTH.scope);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('state', state);
    res.json({ ok: true, url: u.toString(), state });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Step 2 — exchange the pasted code («CODE#STATE») for a token; write credentials.
app.post('/api/claude/oauth/exchange', express.json(), async (req, res) => {
  try {
    const pasted = String(req.body?.code || '').trim();
    if (!pasted) return res.status(400).json({ ok: false, error: 'Вставь код авторизации.' });
    const [rawCode, hashState] = pasted.split('#');
    const state   = (hashState || req.body?.state || '').trim();
    const pending = _oauthPending.get(state);
    if (!pending) return res.status(400).json({ ok: false, error: 'Сессия входа не найдена или истекла. Нажми «Войти через Claude Code» заново.' });

    const r = await fetch(CLAUDE_OAUTH.tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type:    'authorization_code',
        code:          rawCode.trim(),
        state,
        client_id:     CLAUDE_OAUTH.clientId,
        redirect_uri:  CLAUDE_OAUTH.redirectUri,
        code_verifier: pending.verifier,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status >= 400 && r.status < 600 ? r.status : 500)
      .json({ ok: false, error: data.error_description || data.error || `Обмен кода не удался (${r.status})` });

    _oauthPending.delete(state);
    const oauth = await _writeClaudeOauth(data);
    res.json({ ok: true, claudeOauth: _oauthInfo(oauth) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Refresh the access token (used when expired but a refresh_token exists).
app.post('/api/claude/oauth/refresh', express.json(), async (req, res) => {
  try { res.json({ ok: true, claudeOauth: _oauthInfo(await _refreshClaudeOauth()) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

// Fresh Claude auth status (bypasses the 60s cache) — for the «Обновить статус» button.
app.get('/api/claude/status', async (req, res) => {
  try {
    _oauthCredsCacheAt = 0;
    const oauth = await _readOauthCached();
    res.json({ ok: true, claudeOauth: _oauthInfo(oauth) || null, hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Generate appearance from art images via Vision API ────────────────────────

app.post('/api/characters/:slug/generate-appearance', express.json(), async (req, res) => {
  try {
    // Validate cheap inputs BEFORE constructing a generation client (no API call needed to 404/400).
    const slug = decodeURIComponent(req.params.slug);
    const city = reqCity(req);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.slug === slug);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const artDir = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
    const files  = await fs.readdir(artDir).catch(() => []);
    const imgs   = files.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f)).sort();
    if (!imgs.length) return res.status(400).json({ error: 'Нет изображений в папке art/ персонажа' });

    const preferSource = req.body?.preferSource || null;
    const orModel      = req.body?.orModel      || null;
    const gen = await makeGenerationClient(preferSource, orModel);

    // OAuth tier has tighter limits — cap at 1 image; OpenRouter/API-key can use more
    const MAX_IMGS = gen.source === 'claude-login' ? 1 : 4;

    const imageBuffers = [];
    for (const f of imgs.slice(0, MAX_IMGS)) {
      const buf  = await fs.readFile(path.join(artDir, f));
      const ext  = f.split('.').pop().toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                 : ext === 'png'  ? 'image/png'
                 : ext === 'webp' ? 'image/webp' : 'image/gif';
      imageBuffers.push({ buf, mime });
    }

    const lineageName = { vampires: 'вампира', fairies: 'феи / ченджлинга', mortals: 'смертного',
      werewolves: 'оборотня', mages: 'мага', hunters: 'охотника' }[char.lineageFolder] || 'персонажа';

    const gender = char.gender && !char.gender.includes('⚠️') ? char.gender : '';
    const genderNote = gender.startsWith('Неизвестно')
      ? '\n- Пол персонажа намеренно неопределим (часть лора) — пиши нейтрально, не используй гендерные местоимения/окончания там, где это можно обойти.'
      : gender
        ? `\n- Пол персонажа: ${gender}. Используй грамматически верный род (окончания глаголов/прилагательных) — не угадывай по картинке, если она неочевидна.`
        : '';
    const litStyle = await loadLiteraryStyle();
    const systemPrompt = `Ты — редактор персонажных карточек для настольной RPG Vampire: The Masquerade. Пиши прозу строго по литературному стилю проекта.${litStyle ? `\n\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}` : ''}`;
    const userPrompt   = `Перед тобой ${imageBuffers.length > 1 ? `${imageBuffers.length} изображения` : 'изображение'} ${lineageName} по имени ${char.name}.\n\nОпиши внешность для карточки. Требования:\n- 3–5 конкретных визуальных маркеров (лицо, волосы, кожа, глаза, одежда, характерные детали)\n- Стиль: лаконичный, образный, готический. Без «воды».\n- Язык: русский.\n- Формат: один абзац, без списков и заголовков.\n- Упомяни всё необычное, характерное, запоминающееся.\n- Запрет: не упоминать кровь, раны, увечья, явные признаки насилия — даже если они видны на изображении.${genderNote}`;

    let appearance = '';

    if (_isOA(gen)) {
      // Try primary model, then fallbacks if endpoint not found
      const modelsToTry = _oaModels(gen);
      let lastErr;
      let allRateLimited = true;
      for (const m of modelsToTry) {
        try {
          appearance = await _oaCall(gen)(m, systemPrompt, userPrompt, imageBuffers);
          if (m !== gen.model) console.log(`[generate-appearance] fallback model used: ${m}`);
          allRateLimited = false;
          break;
        } catch (e) {
          lastErr = e;
          const is429 = e.status === 429;
          const retryable = e.status === 404 || e.status === 502 || is429
            || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message))
            || (e.status === 403 && /moderation|flagged/i.test(e.message));
          if (!retryable) { allRateLimited = false; throw e; }
          if (!is429) allRateLimited = false;
          console.warn(`[generate-appearance] model ${m} unavailable (${e.status}), trying next...`);
          if (is429) await new Promise(r => setTimeout(r, 800));
        }
      }
      if (!appearance) {
        if (allRateLimited) {
          return res.status(429).json({ rateLimited: true, error: 'Превышен лимит запросов ко всем моделям. Подождите минуту и попробуйте снова.' });
        }
        throw lastErr;
      }
    } else {
      // Anthropic SDK format
      const imgContents = imageBuffers.map(({ buf, mime }) => ({
        type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') },
      }));
      const model = VALID_MODELS.includes(req.body?.model) ? req.body.model : 'claude-opus-4-8';
      const message = await gen.client.messages.create({
        model, max_tokens: 300, system: systemPrompt,
        messages: [{ role: 'user', content: [...imgContents, { type: 'text', text: userPrompt }] }],
      });
      appearance = message.content[0]?.text?.trim() || '';
    }

    res.json({ ok: true, appearance, imagesUsed: imageBuffers.length, source: gen.source });
  } catch (e) {
    const status = e.status ?? 500;
    const msg    = e.error?.error?.message ?? e.message ?? String(e);
    console.error(`[generate-appearance] ${status}`, msg);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
});

// ── Generate image prompt for a character ─────────────────────────────────────

// English color-family phrases for the AI prompt's lighting/background accent (Block 2),
// keyed by clan. Mirrors the hex identity of CLAN_COLORS in web/public/scripts.js (the
// decorative modal-tint palette) so a clan reads as the same color in the UI and in the
// generated portrait — not canonical, purely a visual-consistency device across all images.
const CLAN_PROMPT_ACCENT = {
  'Асамиты':              'deep blood-red',
  'Бруха':                'burnt rust-orange',
  'Вентру':                'deep steel-blue',
  'Гэнгрел':               'earthy ochre-brown',
  'Джованни':              'dark muted plum-grey',
  'Ласомбра':              'deep indigo-black',
  'Малкавиан':             'vivid violet-purple',
  'Носферату':             'murky olive-green',
  'Равнос':                'warm amber-orange',
  'Последователи Сета':    'golden mustard-amber',
  'Тореадор':              'rose-crimson pink',
  'Тремер':                'deep violet-magenta',
  'Тзимище':               'dark oxblood-red',
  'Баали':                 'near-black blood-red',
  'Дочери Какофонии':      'slate blue-grey',
  'Каппадокийцы':          'ashen grey',
  'Нагараджа':             'burnt sienna-brown',
  'Салубри':               'deep teal-blue',
  'Самеди':                'dark plum-purple',
  'Серпанты Света':        'dull olive-yellow',
};

app.post('/api/characters/:slug/generate-prompt', express.json(), async (req, res) => {
  try {
    // Validate cheap inputs BEFORE constructing a generation client (no API call needed to 404/400).
    const slug = decodeURIComponent(req.params.slug);
    const city = reqCity(req);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.slug === slug);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const appearance = char.appearance && !char.appearance.includes('⚠️') ? char.appearance.trim() : '';
    if (!appearance) return res.status(400).json({ error: 'Заполните поле «Внешность» перед генерацией промта' });

    const preferSource = req.body?.preferSource || null;
    const orModel      = req.body?.orModel      || null;
    const gen = await makeGenerationClient(preferSource, orModel);

    const portretRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'portret.md'), 'utf-8').catch(() => '');

    const lineageName = { vampires: 'vampire', fairies: 'changeling / fairy', mortals: 'mortal',
      werewolves: 'werewolf', mages: 'mage', hunters: 'hunter' }[char.lineageFolder] || 'character';
    const clan = char.clan && !char.clan.includes('⚠️') ? char.clan : '';
    const clanAccent = clan ? CLAN_PROMPT_ACCENT[clan] : null;
    const gender = char.gender && !char.gender.includes('⚠️') ? char.gender : '';
    const genderEn = gender.startsWith('Мужской') ? 'male' : gender.startsWith('Женский') ? 'female' : '';

    const systemPrompt = 'You are an expert prompt writer for AI image generation (DALL-E 3, Midjourney, Stable Diffusion). You write precise, vivid, technically correct English prompts for dark fantasy gothic RPG art.';
    const userPrompt = `Write an image generation prompt for a Vampire: The Masquerade character card.

Character:
- Name: ${char.name}
- Type: ${lineageName}${clan ? ` (${clan})` : ''}
- Gender: ${genderEn || (gender.startsWith('Неизвестно') ? 'intentionally indeterminate/ambiguous — keep it that way, do not assign male or female markers' : 'not specified — infer only from Appearance below, do not guess beyond it')}
- Appearance (Russian): ${appearance}
${clanAccent ? `- Clan accent color: ${clanAccent} — use ONLY as the rim-light / background tint in Block 2, never for skin, eyes or hair (those come strictly from Appearance above)` : ''}

Rules excerpt:
${portretRules}

Output ONLY valid JSON, no extra text:
{
  "positive": "[Блок 1] <character appearance, pose, clothing — full English translation and expansion>\\n[Блок 2] <lighting, atmosphere, background>\\n[Блок 3] <style, medium, quality keywords>",
  "negative": "<comma-separated negative terms>"
}

Requirements:
- ALL text must be in English
- Positive prompt: exactly 3 blocks labeled [Блок 1], [Блок 2], [Блок 3]
- Block 1: translate character appearance from Russian, expand with specific visual details; reflect the Gender given above (a clear "man"/"woman" marker, or deliberate ambiguity if Gender is indeterminate) — never contradict it
- Block 2: cinematic lighting, mood, background — the background MUST be a flat abstract color-wash (soft smoke-like gradient, single dominant hue, no shapes or forms within it), NEVER a literal location/architecture/landscape/fantasy environment, and NEVER cosmic/nebula/galaxy/energy-swirl/portal imagery (those read as a place or phenomenon, not a flat color); make ${clanAccent || 'deep crimson-red and black'} the dominant rim-light/background color${clanAccent ? ', to keep this clan\'s visual identity consistent across all character portraits' : ', the default mood color for non-vampire characters, to keep visual identity consistent across all character portraits'}
- Block 3: end with exactly this style/quality phrasing, then the resolution — hyperrealistic cinematic portrait photography, fashion-editorial color grading, sharp fine detail on skin texture and fabric, natural human skin, subtle gothic noir atmosphere, Vampire the Masquerade aesthetic, high-end editorial photography quality, masterpiece, 1023x1537. Do NOT use "digital painting", "oil-paint effect", "visible brushstrokes", "concept art" or "artstation" — the target look is a graded photograph, not an illustration or painting.
- Negative prompt: digital painting, illustration, oil painting, visible brushstrokes, concept art, 3D render, CGI, anime, cartoon, blurry, low quality, deformed, cracked skin, marble skin, stone texture skin, nebula background, galaxy background, cosmic energy background, swirling portal background, blood, gore, wounds, injuries, violence
- NO blood, wounds, gore, violence in positive prompt under any circumstances`;

    let positive = '', negative = '';

    const parseResult = (text) => {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Модель не вернула JSON с промтом.');
      const parsed = JSON.parse(match[0]);
      positive = (parsed.positive || '').trim();
      negative = (parsed.negative || '').trim();
    };

    if (_isOA(gen)) {
      const modelsToTry = _oaModels(gen);
      let lastErr, allRateLimited = true;
      for (const m of modelsToTry) {
        try {
          // Free OpenRouter routing often lands on reasoning models that burn most of the
          // budget on chain-of-thought before any content — give it enough headroom to finish.
          parseResult(await _oaCall(gen)(m, systemPrompt, userPrompt, [], 75000, 2500));
          allRateLimited = false;
          break;
        } catch (e) {
          lastErr = e;
          const is429 = e.status === 429;
          const retryable = e.status === 404 || e.status === 502 || is429 || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message))
            || (e.status === 403 && /moderation|flagged/i.test(e.message));
          if (!retryable) { allRateLimited = false; throw e; }
          if (!is429) allRateLimited = false;
          console.warn(`[generate-prompt] model ${m} unavailable (${e.status}), trying next...`);
          if (is429) await new Promise(r => setTimeout(r, 800));
        }
      }
      if (!positive) {
        if (allRateLimited) return res.status(429).json({ rateLimited: true, error: 'Превышен лимит запросов ко всем моделям. Подождите минуту и попробуйте снова.' });
        throw lastErr;
      }
    } else {
      const model = VALID_MODELS.includes(req.body?.model) ? req.body.model : 'claude-haiku-4-5-20251001';
      const message = await gen.client.messages.create({
        model, max_tokens: 600, system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      parseResult(message.content[0]?.text?.trim() || '');
    }

    if (!positive) return res.status(500).json({ error: 'Модель не вернула промт. Попробуйте ещё раз.' });

    res.json({ ok: true, positive, negative, source: gen.source });
  } catch (e) {
    const status = e?.status ?? 500;
    const msg    = e?.error?.error?.message ?? e?.message ?? String(e);
    console.error(`[generate-prompt] ${status}`, msg);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
});

// ── Generate personality + voice from appearance & biography ──────────────────

app.post('/api/characters/:slug/generate-personality', express.json(), async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug);
    const city = reqCity(req);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.slug === slug);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const appearance = char.appearance && !char.appearance.includes('⚠️') ? char.appearance.trim() : '';
    const biography   = char.biography  && !char.biography.includes('⚠️')  ? char.biography.trim()  : '';
    if (!appearance && !biography)
      return res.status(400).json({ error: 'Заполните «Внешность» или «Биография» перед генерацией' });

    const infoLines          = charInfoLines(char);
    const existingPersonality = char.personality && !char.personality.includes('⚠️') ? char.personality.trim() : '';
    const existingVoice       = char.voice       && !char.voice.includes('⚠️')       ? char.voice.trim()       : '';

    const preferSource = req.body?.preferSource || null;
    const orModel      = req.body?.orModel      || null;
    const gen = await makeGenerationClient(preferSource, orModel);

    const [litStyle, diaryStyle] = await Promise.all([loadLiteraryStyle(), loadDiaryStyleRules()]);
    const systemPrompt = `Ты — редактор персонажных карточек для настольной RPG Vampire: The Masquerade. Пиши строго по литературному стилю проекта.${litStyle ? `\n\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}` : ''}${diaryStyle ? `\n\n# КЛАНОВЫЕ СТИЛИ И ТРЕБОВАНИЯ К ПРОЗЕ (diary_rules.md)\n${diaryStyle}` : ''}`;
    const userPrompt = `Персонаж: ${char.name}${infoLines ? `\n\nИнформация:\n${infoLines}` : ''}${appearance ? `\n\nВнешность:\n${appearance}` : ''}${biography ? `\n\nБиография:\n${biography}` : ''}${existingPersonality ? `\n\nЧерновик «Характер» (написан пользователем — возможно общими фразами; используй как базу, но уточни и конкретизируй на основе данных выше, не противоречь им):\n${existingPersonality}` : ''}${existingVoice ? `\n\nЧерновик «Голос» (аналогично — база для уточнения, не финальный текст):\n${existingVoice}` : ''}

На основе этих данных опиши характер и голос персонажа.

Требования:
- «Характер»: 2–4 предложения — ключевые черты, мотивации, манера держаться с другими, внутренние противоречия. Без «воды», без пересказа биографии.
- «Голос»: 1–2 предложения — манера речи, тембр, характерные обороты/интонации, темп.
- Если выше есть черновики «Характер»/«Голос» — не отбрасывай их и не противоречь им, но обязательно конкретизируй и привяжи к фактам персонажа (информация/биография/внешность), чтобы итоговый текст не расходился с карточкой и персонаж читался однозначно.
- Если черновика нет — выводи строго из информации/биографии/внешности, не придумывай факты, которых там нет.
- Язык: русский. Стиль: лаконичный, образный, готический.

Выведи СТРОГО JSON, без лишнего текста:
{"personality": "...", "voice": "..."}`;

    let personality = '', voice = '';
    const parseResult = (text) => {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Модель не вернула JSON с характером.');
      const parsed = JSON.parse(match[0]);
      personality = (parsed.personality || '').trim();
      voice       = (parsed.voice || '').trim();
    };

    if (_isOA(gen)) {
      const modelsToTry = _oaModels(gen);
      let lastErr, allRateLimited = true;
      for (const m of modelsToTry) {
        try {
          parseResult(await _oaCall(gen)(m, systemPrompt, userPrompt, [], 75000, 1200));
          allRateLimited = false;
          break;
        } catch (e) {
          lastErr = e;
          const is429 = e.status === 429;
          const retryable = e.status === 404 || e.status === 502 || is429 || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message))
            || (e.status === 403 && /moderation|flagged/i.test(e.message));
          if (!retryable) { allRateLimited = false; throw e; }
          if (!is429) allRateLimited = false;
          console.warn(`[generate-personality] model ${m} unavailable (${e.status}), trying next...`);
          if (is429) await new Promise(r => setTimeout(r, 800));
        }
      }
      if (!personality) {
        if (allRateLimited) return res.status(429).json({ rateLimited: true, error: 'Превышен лимит запросов ко всем моделям. Подождите минуту и попробуйте снова.' });
        throw lastErr;
      }
    } else {
      const model = VALID_MODELS.includes(req.body?.model) ? req.body.model : 'claude-haiku-4-5-20251001';
      const message = await gen.client.messages.create({
        model, max_tokens: 500, system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      parseResult(message.content[0]?.text?.trim() || '');
    }

    if (!personality) return res.status(500).json({ error: 'Модель не вернула характер. Попробуйте ещё раз.' });

    res.json({ ok: true, personality, voice, source: gen.source });
  } catch (e) {
    const status = e?.status ?? 500;
    const msg    = e?.error?.error?.message ?? e?.message ?? String(e);
    console.error(`[generate-personality] ${status}`, msg);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
});

// ── Generate biography from info fields, appearance & relationships ────────────

app.post('/api/characters/:slug/generate-biography', express.json(), async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug);
    const city = reqCity(req);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.slug === slug);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const infoLines    = charInfoLines(char);
    const relLines      = charRelationshipLines(char);
    const appearance    = char.appearance && !char.appearance.includes('⚠️') ? char.appearance.trim() : '';
    const existingBio   = char.biography  && !char.biography.includes('⚠️')  ? char.biography.trim()  : '';
    if (!infoLines && !appearance && !existingBio)
      return res.status(400).json({ error: 'Заполните вкладку «Информация» (или «Внешность»/«Биография») перед генерацией' });

    const preferSource = req.body?.preferSource || null;
    const orModel      = req.body?.orModel      || null;
    const gen = await makeGenerationClient(preferSource, orModel);

    const [litStyle, diaryStyle] = await Promise.all([loadLiteraryStyle(), loadDiaryStyleRules()]);
    const systemPrompt = `Ты — редактор персонажных карточек для настольной RPG Vampire: The Masquerade. Пиши строго по литературному стилю проекта.${litStyle ? `\n\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}` : ''}${diaryStyle ? `\n\n# КЛАНОВЫЕ СТИЛИ И ТРЕБОВАНИЯ К ПРОЗЕ (diary_rules.md)\n${diaryStyle}` : ''}`;
    const userPrompt = `Персонаж: ${char.name}${infoLines ? `\n\nИнформация:\n${infoLines}` : ''}${appearance ? `\n\nВнешность:\n${appearance}` : ''}${relLines ? `\n\nОтношения (обязательно явно отразить смысл КАЖДОЙ связи в тексте биографии — например, родственные/опекунские связи, союзы, конфликты):\n${relLines}` : ''}${existingBio ? `\n\nЧерновик биографии (написан пользователем — используй как базу, дополни и углуби, не противоречь заданной канве):\n${existingBio}` : ''}

Напиши биографию персонажа для карточки.

Требования:
- 4–8 предложений, лаконично, без «воды»
- Обязательно согласуй с данными выше (клан/секта/поколение/роль/локация и т.п.) — никаких противоречий с карточкой
- Если указаны отношения — явно отрази смысл каждого из них в тексте (не просто упомяни имя, а скажи, кем этот персонаж приходится — родственником, союзником, противником и т.д.)
- Если есть черновик биографии — сохрани заданную пользователем канву, дополни и углуби её, не противоречь
- Если черновика нет — выводи строго из информации/внешности/отношений, не придумывай факты, которых там нет
- Язык: русский. Стиль: лаконичный, образный, готический.
- Запрет: не упоминать кровь, раны, увечья, явные сцены насилия

Выведи ТОЛЬКО текст биографии — без заголовков, без кавычек, без JSON.`;

    let biography = '';
    if (_isOA(gen)) {
      const modelsToTry = _oaModels(gen);
      let lastErr, allRateLimited = true;
      for (const m of modelsToTry) {
        try {
          biography = (await _oaCall(gen)(m, systemPrompt, userPrompt, [], 75000, 700)).trim();
          allRateLimited = false;
          break;
        } catch (e) {
          lastErr = e;
          const is429 = e.status === 429;
          const retryable = e.status === 404 || e.status === 502 || is429 || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message))
            || (e.status === 403 && /moderation|flagged/i.test(e.message));
          if (!retryable) { allRateLimited = false; throw e; }
          if (!is429) allRateLimited = false;
          console.warn(`[generate-biography] model ${m} unavailable (${e.status}), trying next...`);
          if (is429) await new Promise(r => setTimeout(r, 800));
        }
      }
      if (!biography) {
        if (allRateLimited) return res.status(429).json({ rateLimited: true, error: 'Превышен лимит запросов ко всем моделям. Подождите минуту и попробуйте снова.' });
        throw lastErr;
      }
    } else {
      const model = VALID_MODELS.includes(req.body?.model) ? req.body.model : 'claude-haiku-4-5-20251001';
      const message = await gen.client.messages.create({
        model, max_tokens: 600, system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      biography = message.content[0]?.text?.trim() || '';
    }

    if (!biography) return res.status(500).json({ error: 'Модель не вернула биографию. Попробуйте ещё раз.' });

    res.json({ ok: true, biography, source: gen.source });
  } catch (e) {
    const status = e?.status ?? 500;
    const msg    = e?.error?.error?.message ?? e?.message ?? String(e);
    console.error(`[generate-biography] ${status}`, msg);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
});

// ── List all art images for a character ───────────────────────────────────────

app.get('/api/characters/:slug/images', async (req, res) => {
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

app.post('/api/characters/:slug/upload-image', express.json({ limit: '20mb' }), async (req, res) => {
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

    delete _cache[city];
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

app.delete('/api/characters/:slug/images/:filename', async (req, res) => {
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

    delete _cache[city];
    res.json({ ok: true, filename, fileWasMissing });
  } catch (e) {
    serverError(res, e);
  }
});

// ── Log session: orchestrated post-session write ───────────────────────────────
//
// Produces ALL factual artifacts of a played session in one action, following
// CHECKLIST §2 / chronicle / module_rules / diary_rules / open_threads.
// Prose (diary bodies, финал) is NOT fabricated — seeded stubs carry the facts +
// the Master's comments, and Claude authors the prose as a follow-up step.
//
// Two-phase by contract: dryRun=true returns a preview + previewHash; the write
// call must echo that hash, and the server rebuilds the plan and refuses to write
// if the plan changed since preview (no drift).

const CLAN_DIARY_STYLE = {
  'тореадор':       'Эстетический, чувственный, драматичный',
  'вентру':         'Контролируемый, аналитический, статус-ориентированный',
  'малкавиан':      'Фрагментированный, символичный, скачущий',
  'носферату':      'Циничный, наблюдательный, теневой',
  'гэнгрел':        'Дикий, инстинктивный, немногословный',
  'бруха':          'Страстный, бунтарский, прямой',
  'тремер':         'Методичный, оккультный, осторожный',
  'цимисхи':        'Отстранённый, висцеральный, философский',
  'каппадокий':     'Отстранённый, висцеральный, философский',
  'ассамит':        'Дисциплинированный, ритуальный, сдержанный',
  'тзими':          'Отстранённый, висцеральный, философский',
  'красная шапка':  'Архаичный, хищный, прямой',
  'слуаг':          'Лаконичный, теневой, точный',
  'пак':            'Игровой, импульсивный, момент настоящего',
  'сидхи':          'Возвышенный, церемониальный',
};
function diaryToneFor(c) {
  const clan = (c.clan || '').toLowerCase();
  for (const k in CLAN_DIARY_STYLE) if (clan.includes(k)) return CLAN_DIARY_STYLE[k];
  if (c.lineage === 'mortal') return 'Наблюдательный, человеческий';
  if (c.lineage === 'fairy')  return 'Грёзовый, образный';
  return 'Меланхоличный';
}

// Extract location names from generated scenario text (no AI call needed).
// Looks for "### Name" headers inside the "Локации" section, falling back to
// bold list items. Returns up to `max` names.
// Clean a raw scenario location heading into a bare place name
// e.g. "1. Станция Марселье (Line 13) — 23:47" → "Станция Марселье"
function _cleanLocName(raw) {
  return String(raw)
    .replace(/[*_`[\]]/g, '')
    .split(/\s+[—–]\s+/)[0]        // "Name — time/desc" → "Name"
    .replace(/\([^)]*\)/g, ' ')    // drop "(Line 13)"
    .replace(/^[\s\d.)]+/, '')     // drop leading "1. " numbering
    .replace(/^[^\p{L}«»"]+/u, '') // drop leading emoji/symbols
    .replace(/\s{2,}/g, ' ')
    .trim();
}
// Coarse location "type" — used to avoid multiplying same-type places
// (e.g. inventing a new metro station when one already exists).
function _locType(name) {
  const n = String(name).toLowerCase();
  if (/метро|métro|\bmetro\b|перрон|перон|станци/.test(n)) return 'metro';
  if (/катакомб|подземель/.test(n))                        return 'catacombs';
  if (/кладбищ|cimeti|погост|пер-лашез/.test(n))           return 'cemetery';
  return null;
}
// Location names mentioned in the scenario's «Локации» section (robust, bounded)
function _extractLocNamesFromScenario(text, max = 5) {
  return _parseScenarioLocations(text).map(l => l.name).filter(Boolean).slice(0, max);
}

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
// Pull NPC names from the scenario's «НПС» section
function _extractNpcNamesFromScenario(text, max = 12) {
  const secM = text.match(/(?:^|\n)#{1,4}[^\n]*НПС[^\n]*\n([\s\S]*?)(?=\n#{1,2}\s|\n---|\s*$)/i);
  const block = secM ? secM[1] : '';
  if (!block) return [];
  const names = [];
  const push = raw => {
    let n = String(raw).replace(/[*_`[\]()«»"]/g, '').replace(/^[^\p{L}]+/u, '').trim();
    n = n.split(/[—–:(]/)[0].trim();
    if (n.length >= 2 && n.length <= 60 && !/^(нпс|роль|имя)$/i.test(n)
        && !names.some(x => _nameMatch(x, n))) names.push(n);
  };
  for (const m of block.matchAll(/^\s*[-*•]\s*\*\*([^*\n]+?)\*\*/gm)) push(m[1]);
  for (const m of block.matchAll(/^\s*[-*•]\s*([^—–\n*[]{2,60}?)\s*[—–]/gm)) push(m[1]);
  for (const m of block.matchAll(/^#{2,4}\s+([^—–\n]{2,60}?)(?:\s*[—–]|$)/gm)) push(m[1]);
  return names.slice(0, max);
}
// Render npc.md — ПК / Каноничные (reused) / Модульные (new)
function _renderModuleNpcMd(modTitle, mod, pcs, canonNpcs, newNpcs, allChars) {
  const charLink = ch => `../../../../characters/${ch.lineageFolder}/${ch.slug}/${ch.slug}.md`;
  const pcLines = (pcs && pcs.length) ? pcs.map(nm => {
    const ch = allChars.find(c => _nameMatch(nm, c.name));
    return ch ? `- ${ch.name} — Персонаж игрока → 🔗 [Карточка](${charLink(ch)})`
              : `- ${nm} — Персонаж игрока`;
  }).join('\n') : '- —';
  const canonLines = canonNpcs.length
    ? canonNpcs.map(x => `- ${x.char.name} — ${x.role || 'роль в модуле'} → 🔗 [Карточка](${charLink(x.char)})`).join('\n')
    : '- —';
  const newLines = newNpcs.length
    ? newNpcs.map(x => { const s = slugify(x.name); return `- ${x.name} — ${x.role || 'роль'} → 🔗 [Карточка](npc/${s}/${s}.md)`; }).join('\n')
    : '- —';
  return [
    `# НПС модуля: ${modTitle}`, '',
    `> 🔗 [Модуль](${mod}.md)`,
    '> ℹ️ Каноничные НПС → ссылка на карточку в `characters/`. Модульные (неканоничные) → карточки в `npc/`.', '',
    '---', '', '## 🎭 Игровые персонажи (ПК)', '', pcLines, '',
    '---', '', '## 📚 Каноничные НПС', '', canonLines, '',
    '---', '', '## 🆕 Модульные НПС (неканоничные)', '',
    '> Карточки в `npc/`. Условия продвижения — `system/rules/module_rules.md`.', '', newLines, '',
  ].join('\n');
}
// Compact per-character digest (status, role, date markers, relationships) for the
// generation prompt — lets the AI reason about timeline compatibility & relations.
function _charTimelineDigest(name, kind, card) {
  const field = re => (card.match(re)?.[1] || '').replace(/\r/g, '').trim();
  const status  = field(/\*\*Статус:\*\*\s*([^\n]+)/);
  const det     = field(/\*\*Детали статуса:\*\*\s*([^\n]+)/);
  const hier    = field(/\*\*Парижская иерархия:\*\*\s*([^\n]+)/) || field(/\*\*Иерархия в городе:\*\*\s*([^\n]+)/);
  const role    = field(/\*\*Роль:\*\*\s*([^\n]+)/);
  const embrace = field(/\*\*Год обращения:\*\*\s*([^\n]+)/);
  const relM    = card.match(/\*\*Отношения:\*\*\s*\n([\s\S]*?)(?=\n-\s*\*\*|\n##\s|\n---)/);
  const rels    = relM ? relM[1].replace(/\r/g, '').replace(/\s+$/g, '') : '';
  const dates   = [...card.matchAll(/(?:[А-Яа-яЁё]+\s+)?\b(?:19|20)\d{2}\b/g)]
    .map(m => m[0].trim()).filter((v, i, a) => a.indexOf(v) === i).slice(0, 10);
  const L = [`### ${name} (${kind})`];
  if (status)        L.push(`- Статус: ${status}${det ? ` — ${det}` : ''}`);
  if (hier || role)  L.push(`- Роль/иерархия: ${[hier, role].filter(Boolean).join(' / ')}`);
  if (embrace && !/не указан/i.test(embrace)) L.push(`- Год обращения: ${embrace}`);
  if (dates.length)  L.push(`- Даты в карточке: ${dates.join(', ')}`);
  if (rels.trim())   L.push(`- Связи:\n${rels.split('\n').filter(Boolean).map(l => '  ' + l.trim()).join('\n')}`);
  return L.join('\n');
}
// Return the markdown body of a scenario section whose header matches headerRe,
// up to the next header of the same or higher level. '' if not found.
function _extractScenarioSection(text, headerRe) {
  if (!text) return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,4})\s+(.+)$/);
    if (h && headerRe.test(h[2])) { start = i + 1; level = h[1].length; break; }
  }
  if (start === -1) return '';
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,4})\s+/);
    if (h && h[1].length <= level) break;
    if (/^-{3,}\s*$/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}
// Parse the scenario's «Сцены» section into [{date, title, description}]
function _parseScenarioScenes(text) {
  const block = _extractScenarioSection(text, /Сцены/i);
  if (!block) return [];
  const out = [];
  for (const part of block.split(/\n(?=#{2,4}\s)/)) {
    const h = part.match(/^#{2,4}\s+(.+)$/m);
    if (!h) continue;
    let head = h[1].replace(/[*_`]/g, '').replace(/^[^\p{L}\d]+/u, '').trim();
    let date = '', title = head;
    const sm = head.match(/^((?:Сцена|Эпизод)\s*\d+)\s*[—–:.-]\s*(.+)$/i);
    if (sm) { date = sm[1].trim(); title = sm[2].trim(); }
    else { date = head.match(/^(?:Сцена|Эпизод)\s*\d+/i)?.[0] || ''; }
    const body = part.slice(h[0].length).replace(/^\s+/, '').trim();
    const desc = body.replace(/^\s*[-*•]\s*/gm, '').replace(/\*\*/g, '').trim();
    if (title || desc) out.push({ date, title: title || date, description: desc });
  }
  return out;
}
// Parse the scenario's «Локации» section into [{name, description}]
function _parseScenarioLocations(text) {
  const block = _extractScenarioSection(text, /Локаци/i);
  if (!block) return [];
  const out = [], seen = new Set();
  const add = (rawName, rawDesc) => {
    const name = _cleanLocName(rawName);
    if (!name || name.length < 2 || name.length > 100) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, description: String(rawDesc || '').replace(/[*_`]/g, '').trim() });
  };
  for (const line of block.split('\n')) {
    const bm = line.trim().match(/^[-*•]\s+(.+)$/);
    if (!bm) continue;
    const parts = bm[1].split(/\s*(?:[—–]|→|🔗|\|)\s*/);
    const desc = parts.slice(1).filter(p => p && !/^\[?Карточк/i.test(p)).join(' — ');
    add(parts[0], desc);
  }
  for (const part of block.split(/\n(?=#{2,4}\s)/)) {
    const h = part.match(/^#{2,4}\s+(.+)$/m);
    if (!h) continue;
    const body = part.slice(h[0].length).replace(/^\s+/, '')
      .split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 2).join(' ');
    add(h[1], body);
  }
  return out;
}
// Parse/write the «## 📍 Связанные локации» section of a module .md
function _parseModuleLocSlugs(raw) {
  const m = raw.replace(/\r\n/g, '\n').match(/##\s*📍\s*Связанные локации\s*\n([\s\S]*?)(?=\n##|\s*$)/i);
  if (!m) return [];
  return m[1].split('\n').map(l => l.match(/^\s*-\s+(\S+)/)?.[1]).filter(Boolean);
}
function _writeModuleLocSlugs(raw, slugs) {
  const n = raw.replace(/\r\n/g, '\n'); // normalise CRLF so \n## lookahead always works
  if (!slugs.length) {
    return n.replace(/\n*##\s*📍\s*Связанные локации[ \t]*\n[\s\S]*?(?=\n##|\s*$)/i, '').trimEnd() + '\n';
  }
  const section = `## 📍 Связанные локации\n${slugs.map(s => `- ${s}`).join('\n')}\n`;
  if (/##\s*📍\s*Связанные локации/i.test(n)) {
    return n.replace(/##\s*📍\s*Связанные локации[ \t]*\n[\s\S]*?(?=\n##|\s*$)/i, section);
  }
  return n.trimEnd() + '\n\n' + section;
}

// Parse sessions.md (Phase B log) into [{title, date, scenes, status, body}]
function _parseSessions(raw) {
  if (!raw) return [];
  const text = raw.replace(/\r\n/g, '\n');
  const out = [];
  for (const part of text.split(/\n(?=##\s+Сесси)/)) {
    const h = part.match(/^##\s+(.+)$/m);
    if (!h || !/Сесси/.test(h[1])) continue;
    const head   = h[1].trim();
    const scenes = (part.match(/\*\*Сыграно сцен:\*\*\s*([^\n]*)/)?.[1] || '').trim().replace(/^—$/, '');
    const status = (part.match(/\*\*Статус модуля:\*\*\s*([^\n]*)/)?.[1] || '').trim();
    let body = part.slice(part.indexOf(h[0]) + h[0].length)
      .replace(/^\s*-\s*\*\*Сыграно сцен:\*\*[^\n]*\n?/m, '')
      .replace(/^\s*-\s*\*\*Статус модуля:\*\*[^\n]*\n?/m, '')
      .replace(/\n-{3,}\s*$/, '')
      .trim();
    if (/^\*\(без заметок\)\*$/.test(body)) body = '';
    const date = (head.match(/[—–-]\s*(.+)$/)?.[1] || '').trim();
    out.push({ title: head, date, scenes, status, body });
  }
  return out;
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

// Parse npc.md into structured groups for the module page «НПС» tab.
// Groups: ПК / Каноничные / Модульные. Tolerates bullet, bold and «#### » subsection layouts.
function _cleanNpcName(s) {
  return String(s || '').replace(/^[\s>*]+/, '').replace(/^[^\p{L}]+/u, '').replace(/[\s*]+$/, '').trim();
}
function _npcCardHref(chunk) {
  return (chunk.match(/\[Карточка\]\(([^)]+)\)/) || [])[1] || '';
}
function _parseNpcEntries(body) {
  const entries = [];
  // Format C — «#### Имя — роль» subsections (модульные НПС со встроенным мини-листом)
  if (/^####\s+/m.test(body)) {
    for (const part of body.split(/\n(?=####\s+)/)) {
      const h = part.match(/^####\s+(.+)$/m);
      if (!h) continue;
      const [namePart, ...rest] = h[1].split(/\s*[—–]\s*/);
      const name = _cleanNpcName(namePart);
      if (!name) continue;
      const after = part.slice(part.indexOf(h[0]) + h[0].length);
      const descBits = [rest.join(' — ').trim()];
      for (const ln of after.split('\n')) {
        const t = ln.trim();
        if (!t || /\[Карточка\]/.test(t)) continue;
        descBits.push(t.replace(/^[-*]\s*/, ''));
      }
      entries.push({ name, desc: descBits.filter(Boolean).join(' — ').replace(/\*\*/g, '').trim(), cardHref: _npcCardHref(part) });
    }
    return entries;
  }
  // Formats A/B — one entry per line («- Имя — роль …» или «**Имя** — описание …»)
  for (const ln of body.split('\n')) {
    const t = ln.trim();
    if (!t || /^>/.test(t)) continue;
    if (!/\[Карточка\]/.test(t) && !/^\s*[-*]/.test(t) && !/^\*\*/.test(t)) continue;
    let prefix = t
      .replace(/[→➔➜]?\s*🔗?\s*\[Карточка\]\([^)]*\).*$/, '')   // drop «→ 🔗 [Карточка](…)» trailer
      .replace(/^\s*-\s+/, '')                                   // strip leading «- » bullet
      .replace(/\*\*/g, '')                                      // drop bold markers
      .trim();
    if (!prefix) continue;
    const [namePart, ...rest] = prefix.split(/\s*[—–]\s*/);
    const name = _cleanNpcName(namePart);
    if (!name) continue;
    entries.push({ name, desc: rest.join(' — ').trim(), cardHref: _npcCardHref(t) });
  }
  return entries;
}
function _parseNpcMdGroups(raw) {
  if (!raw) return [];
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const heads = [];
  const re = /^##\s+(.+)$/gm;
  let m;
  while ((m = re.exec(text))) heads.push({ title: m[1].trim(), bodyStart: m.index + m[0].length, at: m.index });
  const groups = [];
  for (let i = 0; i < heads.length; i++) {
    const body  = text.slice(heads[i].bodyStart, i + 1 < heads.length ? heads[i + 1].at : text.length);
    const title = heads[i].title;
    const kind  = /игров|\bпк\b|персонаж\w*\s+игрок/i.test(title) ? 'pc'
                : /модульн|неканон/i.test(title) ? 'modular'
                : 'canon';
    const entries = _parseNpcEntries(body);
    if (entries.length) groups.push({ title, kind, entries });
  }
  return groups;
}
// Render one session block for sessions.md
function _renderSessionBlock(n, date, scenes, status, body) {
  return [
    '', '---', '',
    `## Сессия ${n} — ${(date || '').trim() || new Date().toISOString().slice(0, 10)}`, '',
    `- **Сыграно сцен:** ${(scenes || '').trim() || '—'}`,
    `- **Статус модуля:** ${(status || '').trim() || '🟡 В процессе'}`, '',
    (body || '').trim() || '*(без заметок)*', '',
  ].join('\n');
}
// Rewrite the whole sessions.md from the session array (append & edit share this)
async function _writeSessionsFile(modDir, mod, sessions) {
  const titleM = (await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '')).replace(/^﻿/, '').match(/^#\s+(.+)$/m);
  const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;
  const header = `# Журнал сессий: ${modTitle}\n\n> 🔗 [Модуль](${mod}.md) | [Сценарий](scenario.md)\n> Фаза B — ведение во время игры. Правила: system/rules/module_rules.md`;
  const blocks = sessions.map((s, i) => _renderSessionBlock(i + 1, s.date, s.scenes, s.status, s.body)).join('');
  await writeFileAtomic(path.join(modDir, 'sessions.md'), header + blocks + '\n', 'utf-8');
}
// Patch <mod>.md after generation WITHOUT destroying its concept/participants
async function _patchModuleMain(modDir, mod, firstLoc) {
  const p = path.join(modDir, `${mod}.md`);
  let txt = await fs.readFile(p, 'utf-8').catch(() => '');
  if (!txt) return;
  if (!/\[Сценарий\]\(scenario\.md\)/.test(txt)) {
    txt = txt.replace(/^(>\s*🔗\s*\[Хроника\]\([^)]*\))(.*)$/m,
      `$1 | [Сценарий](scenario.md) | [НПС](npc.md)$2`);
  }
  if (firstLoc) {
    txt = txt.replace(/(\|\s*\*\*Локация\*\*\s*\|)([^|\n]*)\|/,
      (m, pre, val) => val.trim() ? m : `${pre} ${firstLoc} |`);
  }
  await writeFileAtomic(p, txt, 'utf-8');
}

// slug generation lives in lib/parsers.js (single source of truth — see import above)
function renderChronicleEventsSkeleton(displayName) {
  return `# 📖 ${displayName} — События\n\n> Хроника города · сводка города — [events.md](../../archive/events.md)\n> Протокол записей — [chronicle.md](../../../../system/rules/chronicle.md)\n\n---\n\n`;
}
function renderOpenThreadsSkeleton(displayName) {
  return `# 🧵 Открытые нити — ${displayName}\n\n| # | Нить | Источник | Статус | Приоритет |\n|---|---|---|---|---|\n\n## 🗂️ Архив закрытых\n\n*(пусто)*\n`;
}

// Project URL convention: encode spaces/parens only, keep Cyrillic as-is
function encUrl(s) { return String(s).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29'); }

// Drop placeholder field values (⚠️, «неизвестно», «—») from display
function cleanMeta(v) { return (v && !/⚠️|неизвест|уточнен|^\s*—\s*$/i.test(v)) ? v : ''; }

function renderChronicleEntry(p, parts, modslug, hasFinale) {
  const L = [];
  L.push(`### 📅 ${p.event.dateLabel} — ${p.event.title}.`);
  if (p.event.parallel) L.push(`> ⚡ *${p.event.parallel}*`);
  L.push('');
  L.push(`- **📍 Локация:** ${p.event.locationLine}`);
  L.push('- **👥 Участники:**');
  for (const pt of parts) {
    const meta = [cleanMeta(pt.clan), cleanMeta(pt.gen)].filter(Boolean).join(', ');
    L.push(`  - ${pt.name}${meta ? ` (${meta})` : ''} — ${pt.role || 'участник'}`);
  }
  L.push('- **📋 События:**');
  const scenes = p.event.scenes || [];
  if (scenes.length) {
    if (p.event.summary && p.event.summary.trim()) { L.push(`  ${p.event.summary.trim()}`); L.push(''); }
    scenes.forEach((s, i) => {
      L.push(`  *Сцена ${i + 1} — ${s.title}:* ${(s.text || '').trim()}`);
      if (i < scenes.length - 1) L.push('');
    });
  } else {
    L.push(`  ${(p.event.summary || '').trim()}`);
  }
  if ((p.event.consequences || []).length) {
    L.push('- **⚖️ Последствия:**');
    p.event.consequences.forEach(c => L.push(`  - ${c}`));
  }
  if ((p.event.worldChanges || []).length) {
    L.push('- **🌍 Изменения состояния мира:**');
    p.event.worldChanges.forEach(c => L.push(`  - ${c}`));
  }
  L.push('');
  const finaleLink = hasFinale ? ` | [Литературный финал](modules/${modslug}/finale.md)` : '';
  L.push(`> 🔗 [Модуль](modules/${modslug}/${modslug}.md)${finaleLink}`);
  return L.join('\n');
}

function renderModuleMain(p, modslug, parts) {
  const diaryLinks = parts.filter(pt => pt.diary).map(pt =>
    `[${pt.name}](../../../../characters/${pt.lineageFolder}/${pt.slug}/journal/${p.diaryPeriod}.md)`
  ).join(' | ');
  return [
    `# ${p.event.dateLabel} — ${p.event.title}`,
    '> Хроника | Vampire: The Masquerade V20 / Changeling: The Dreaming',
    '',
    '> 🔗 [Хроника](../../events.md)',
    '',
    '---',
    '',
    '| Параметр | Значение |',
    '|---|---|',
    `| **Тип** | ${p.module.type || 'Игровая сессия'} |`,
    `| **Время** | ${p.event.dateLabel} |`,
    `| **Локация** | ${p.event.locationLine} |`,
    '',
    '---',
    '',
    (p.event.summary && p.event.summary.trim())
      ? p.event.summary.trim()
      : '*Краткое содержание — см. запись хроники.*',
    '',
    diaryLinks ? `> 🔗 Дневники: ${diaryLinks}` : '',
    ''
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

function renderNpcMd(p, modslug, parts) {
  const pcs = parts.filter(pt => /игрок|пк|персонаж игрока/i.test(pt.role || '') || pt.isPC);
  const canon = parts.filter(pt => !pcs.includes(pt));
  const line = pt => `- ${pt.name} — ${pt.role || 'роль'} → 🔗 [Карточка](../../../../characters/${pt.lineageFolder}/${pt.slug}/${pt.slug}.md)`;
  return [
    `# НПС модуля: ${p.event.dateLabel} — ${p.event.title}`,
    '',
    `> 🔗 [Модуль](${modslug}.md)`,
    '> ℹ️ Каноничные НПС → ссылка на карточку в `characters/`. Модульные → карточки в `npc/`.',
    '',
    '---',
    '',
    '## 🎭 Игровые персонажи (ПК)',
    '',
    pcs.length ? pcs.map(line).join('\n') : '- —',
    '',
    '---',
    '',
    '## 📚 Каноничные НПС',
    '',
    canon.length ? canon.map(line).join('\n') : '- —',
    '',
    '---',
    '',
    '## 🆕 Модульные НПС (неканоничные)',
    '',
    '> Карточки в `npc/`. Условия продвижения — `system/rules/module_rules.md`.',
    '',
    '- —',
    ''
  ].join('\n');
}

function renderDiaryStub(p, author, parts) {
  const others = parts.filter(x => x.name !== author.name).map(x => x.name);
  const tone = diaryToneFor(author);
  const note = (author.diaryComment || '').trim();
  return [
    `### 📅 ${p.event.dateLabel} — ⏳ ОЖИДАЕТ ГЕНЕРАЦИИ`,
    `- **👤 Автор:** ${author.name}`,
    `- **📍 Локация:** ${p.event.locationLine}`,
    `- **🎭 Тон/Стиль:** ${tone}`,
    '- **📖 Текст записи:**',
    '  ⏳ ОЖИДАЕТ ГЕНЕРАЦИИ — Claude напишет прозу по фактам события и стилю клана.',
    note ? `  <!-- 📝 КОММЕНТАРИЙ МАСТЕРА (учесть при генерации, затем удалить): ${note} -->` : '',
    `  <!-- ФАКТЫ (источник истины): хроника ${p.chronicle} → «${p.event.title}» -->`,
    '- **🔗 Зеркальная ссылка:**',
    others.length ? others.map(o => `  ${o} → ⏳`).join('\n') : '  —',
    ''
  ].filter(Boolean).join('\n');
}

function renderFinaleStub(p, modslug, parts) {
  const note = (p.finale && p.finale.comment || '').trim();
  return [
    `# ${p.event.dateLabel} — Литературный финал`,
    '',
    `> 🔗 [Модуль](${modslug}.md) | [Хроника](../../events.md)`,
    '',
    '---',
    '',
    '⏳ ОЖИДАЕТ ГЕНЕРАЦИИ — Claude напишет литературный финал.',
    '',
    note ? `<!-- 📝 КОММЕНТАРИЙ МАСТЕРА (учесть при генерации, затем удалить): ${note} -->` : '',
    `<!-- Опорные факты: «${p.event.title}»; участники: ${parts.map(x => x.name).join(', ')} -->`,
    ''
  ].filter(Boolean).join('\n');
}

function patchCardStatus(raw, status, details) {
  let out = raw;
  if (status) out = out.replace(/^(\s*-\s*\*\*Статус:\*\*).*$/m, `$1 ${status}`);
  if (details) {
    if (/^\s*-\s*\*\*Детали статуса:\*\*/m.test(out))
      out = out.replace(/^(\s*-\s*\*\*Детали статуса:\*\*).*$/m, `$1 ${details}`);
    else
      out = out.replace(/^(\s*-\s*\*\*Статус:\*\*.*)$/m, `$1\n- **Детали статуса:** ${details}`);
  }
  return out;
}

function addThreadRows(raw, newThreads, source) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  // find last numbered data row of the main table
  let lastIdx = -1, maxNum = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\|\s*(\d+)\s*\|/);
    if (m) { lastIdx = i; maxNum = Math.max(maxNum, parseInt(m[1])); }
  }
  if (lastIdx === -1) {                       // empty table → insert after header separator
    lastIdx = lines.findIndex(l => /^\|\s*-{2,}/.test(l));
    if (lastIdx === -1) return raw;
  }
  const rows = newThreads.map((t, i) => {
    const n = maxNum + i + 1;
    const status = /высок/i.test(t.priority) ? '🔴 Активна' : '🟡 Фоновая';
    return `| ${n} | **${t.title}** — ${t.desc || ''} | ${source} | ${status} | ${t.priority || 'Средний'} |`;
  });
  lines.splice(lastIdx + 1, 0, ...rows);
  return lines.join('\n');
}

function closeThreadRows(raw, ids) {
  const idset = new Set((ids || []).map(Number));
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const moved = [];
  const kept = [];
  for (const l of lines) {
    const m = l.match(/^\|\s*(\d+)\s*\|/);
    if (m && idset.has(parseInt(m[1]))) {
      moved.push(l.replace(/🔴 Активна|🟡 Фоновая/, '🟢 Закрыта'));
    } else kept.push(l);
  }
  let out = kept.join('\n');
  if (moved.length) {
    // Replace the archive placeholder, or append under the archive header
    if (/\*\(пусто[^\n]*\)\*/.test(out))
      out = out.replace(/\*\(пусто[^\n]*\)\*/, moved.join('\n'));
    else
      out = out.replace(/(##\s*🗂️[^\n]*\n)/, `$1\n${moved.join('\n')}\n`);
  }
  return out;
}

function appendChronicleEntry(raw, entryBlock) {
  const body = raw.replace(/\s+$/, '');         // keep the file's trailing ---
  return body + '\n\n' + entryBlock + '\n\n---\n';
}

function bumpWorldStateStamp(raw, monthLabel) {
  return raw.replace(/(Последнее обновление:\s*\*\*)[^*]+(\*\*)/, `$1${monthLabel}$2`);
}

// Минимальная карточка НПС (для инлайн-создания из формы сессии)
function renderMinimalNpcCard(name, slug, lineageFolder, lineageRu, cityDisplay) {
  const emoji = { vampires: '🧛', fairies: '🧚', mortals: '🧑', werewolves: '🐺', mages: '🔮', hunters: '🏹' }[lineageFolder] || '👤';
  return `# ${emoji} ${name}\n\n> 🔗 [Все персонажи](../../../archive/characters_index.md)\n\n---\n\n` +
    `- **Слаг:** ${slug}\n- **Родной город:** ${cityDisplay}\n- **Линейка WoD:** ${lineageRu}\n- **Статус:** Жив\n` +
    `- **Роль:** ⚠️ Требуется уточнение\n- **Принадлежность:** Персонаж мастера\n- **Биография:** ⚠️ Требуется уточнение\n- **Внешность:** ⚠️ Требуется уточнение\n\n---\n\n` +
    `## 🖼️ Изображения\n- ⏳ Изображение не предоставлено\n`;
}

// Build the full change plan (used identically for preview and write)
async function buildSessionPlan(payload) {
  const errors = [], warnings = [], notes = [];
  const p = JSON.parse(JSON.stringify(payload || {}));
  p.event   = p.event   || {};
  p.module  = p.module  || {};
  p.threads = p.threads || {};
  p.finale  = p.finale  || {};

  const city = p.city = (/^[a-z0-9_]+$/.test(p.city || '') ? p.city : DEFAULT_CITY);

  // basic validation
  if (!p.event.dateLabel) errors.push('Не указана дата (dateLabel).');
  if (!p.event.title)     errors.push('Не указан заголовок события (title).');
  if (!p.event.month || !/^\d{4}-\d{2}$/.test(p.event.month)) errors.push('Месяц должен быть в формате YYYY-MM.');

  // resolve chronicle + module
  let chr, modslug, moduleNew = false, chronicleNew = false, chrDisplay = '';
  const allMods = await listModules(city);
  if (p.module.mode === 'existing') {
    const it = allMods.find(m => m.name === p.module.folder);
    if (!it) errors.push(`Модуль «${p.module.folder}» не найден.`);
    else { chr = it.chronicle; modslug = it.name; }
  } else {
    modslug = slugify(p.module.newName || '');
    moduleNew = true;
    if (!modslug) errors.push('Укажите название нового модуля.');
    const cspec = p.chronicle || {};
    if (cspec.mode === 'new') {
      chr = slugify(cspec.newName || '');
      chrDisplay = (cspec.newName || chr).trim();
      chronicleNew = true;
      if (!chr) errors.push('Укажите название новой хроники.');
    } else {
      chr = cspec.slug;
      if (!chr) errors.push('Выберите хронику для нового модуля.');
      else if (!(await fs.access(path.join(chroniclesDir(city), chr)).then(() => true).catch(() => false)))
        errors.push(`Хроника «${chr}» не найдена.`);
    }
  }
  if (errors.length) return { errors, warnings, notes, changes: [] };
  p.chronicle = chr;

  // chronicle events file (existing or fresh skeleton)
  const chrEventsRel = `cities/${city}/chronicles/${chr}/events.md`;
  let chronicleRaw = await fs.readFile(path.join(ROOT, chrEventsRel), 'utf-8').catch(() => null);
  const chrEventsExisted = chronicleRaw != null;
  chronicleRaw = chrEventsExisted ? chronicleRaw.replace(/^﻿/, '') : renderChronicleEventsSkeleton(chrDisplay || chr);

  // chronological conflict (across the whole city)
  const evs = await aggregateEvents(city);
  if (p.event.title && evs.some(e => (e.title || '').trim() === p.event.title.trim()
        && (eventMonthKey(e.date) || {}).key === p.event.month))
    errors.push(`Запись «${p.event.title}» за ${p.event.month} уже существует (хронологический конфликт).`);

  // resolve participants (+ инлайн-создание НПС, если имя неизвестно, но указана линейка)
  const chars = await getAllCharacters(city);
  const resolve = makeNameResolver(chars.map(c => c.name));
  const byName = Object.fromEntries(chars.map(c => [c.name, c]));
  let cityDisplay = city;
  try {
    const m = (await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8')).replace(/^﻿/, '').match(/^#\s+(.+)$/m);
    if (m) cityDisplay = m[1].replace(/^[^\p{L}\p{N}]+/u, '').split(/[,—–-]/)[0].trim();
  } catch {}
  const LINEAGE_RU = { vampires: 'Вампир', fairies: 'Фея / Ченджлинг', mortals: 'Смертный', werewolves: 'Оборотень', mages: 'Маг', hunters: 'Охотник' };
  const LINEAGE_CODE = { vampires: 'vampire', fairies: 'fairy', mortals: 'mortal', werewolves: 'werewolf', mages: 'mage', hunters: 'hunter' };
  const newNpcCards = [];
  const parts = [];
  for (const inp of (p.participants || [])) {
    const rid = resolve(inp.name);
    if (!rid) {
      const lf = inp.lineage;
      if (lf && LINEAGE_RU[lf]) {
        const slug = slugify(inp.name);
        if (!slug) { errors.push(`Участник «${inp.name}»: не удалось собрать slug.`); continue; }
        newNpcCards.push({ rel: `cities/${city}/characters/${lf}/${slug}/${slug}.md`, content: renderMinimalNpcCard(inp.name, slug, lf, LINEAGE_RU[lf], cityDisplay) });
        parts.push({ name: inp.name, slug, clan: inp.clan || '', gen: '', lineage: LINEAGE_CODE[lf], lineageFolder: lf,
          role: inp.role || '', diary: !!inp.diary, isPC: !!inp.isPC, diaryComment: inp.diaryComment || '',
          statusChange: inp.statusChange || null, statusDetails: inp.statusDetails || '' });
        continue;
      }
      errors.push(`Участник «${inp.name}» не сопоставлен — выберите линейку, чтобы создать НПС инлайн, или создайте его заранее.`);
      continue;
    }
    const c = byName[rid];
    parts.push({
      name: c.name, slug: c.slug, clan: c.clan || '', gen: c.generation || '',
      lineage: c.lineage, lineageFolder: c.lineageFolder,
      role: inp.role || '', diary: !!inp.diary, isPC: !!inp.isPC,
      diaryComment: inp.diaryComment || '',
      statusChange: inp.statusChange || null, statusDetails: inp.statusDetails || ''
    });
  }
  if (errors.length) return { errors, warnings, notes, changes: [] };

  const preNov2010 = p.event.month < '2010-11';
  p.diaryPeriod = preNov2010 ? 'retrospective' : p.event.month;

  const hasFinale = !!(p.finale && p.finale.create);
  const changes = [];
  const add = (rel, action, after, preview) => changes.push({ rel, action, after, preview });

  // 0. Inline-created NPC stub cards (для неизвестных участников с указанной линейкой)
  for (const nc of newNpcCards) add(nc.rel, 'create', nc.content, `новый НПС (stub): ${nc.rel.split('/').pop()}`);
  if (newNpcCards.length) notes.push(`Создано НПС-заготовок: ${newNpcCards.length} — заполни поля ⚠️ по system/rules/npcs_city.md.`);

  // 1. Chronicle entry → append to chronicles/<chr>/events.md
  const entry = renderChronicleEntry(p, parts, modslug, hasFinale);
  add(chrEventsRel, chrEventsExisted ? 'modify' : 'create', appendChronicleEntry(chronicleRaw, entry),
    `${chrEventsExisted ? 'append' : 'new'} запись: ### 📅 ${p.event.dateLabel} — ${p.event.title}`);

  // 1a. New chronicle → seed chronicle.md (спина + статус «Активна»)
  if (chronicleNew) {
    add(`cities/${city}/chronicles/${chr}/chronicle.md`, 'create',
      `# 📕 ${chrDisplay || chr}\n\n- **Статус:** 🟡 Активна\n\n> Спина хроники. События — [events.md](events.md). Нити — [open_threads.md](open_threads.md).\n> Закрыть хронику: \`node tools/close_chronicle.js ${city} ${chr} "финал"\`\n`,
      'новая хроника: chronicle.md (статус Активна)');
  }

  // 1b. World-state stamp in archive/events.md
  const monthLabel = p.event.dateLabel.split(',')[0];
  const archiveRel = `cities/${city}/archive/events.md`;
  const archiveRaw = await fs.readFile(path.join(ROOT, archiveRel), 'utf-8')
    .then(s => s.replace(/^﻿/, '')).catch(() => null);
  if (archiveRaw && /Последнее обновление:/.test(archiveRaw))
    add(archiveRel, 'modify', bumpWorldStateStamp(archiveRaw, monthLabel), `штамп «Состояние мира» → ${monthLabel}`);
  if ((p.event.worldChanges || []).length)
    notes.push('Отрази вручную в сводных таблицах «🌍 Состояние мира» (правятся не автоматически):\n' +
      p.event.worldChanges.map(c => `   • ${c}`).join('\n'));
  notes.push('Индекс «Сводная хроника» (archive/events.md) перегенерируется после записи.');

  // 2. Module files
  const modRel = `cities/${city}/chronicles/${chr}/modules/${modslug}`;
  if (moduleNew) {
    add(`${modRel}/${modslug}.md`, 'create', renderModuleMain(p, modslug, parts), 'новый главный файл модуля');
    add(`${modRel}/npc.md`,        'create', renderNpcMd(p, modslug, parts),       'npc.md (ПК / каноничные / модульные)');
  } else {
    notes.push('Существующий модуль — главный файл и npc.md не перезаписываются.');
  }
  if (hasFinale) {
    const finaleRel = `${modRel}/finale.md`;
    const exists = await fs.readFile(path.join(ROOT, finaleRel), 'utf-8').then(() => true).catch(() => false);
    if (!exists) add(finaleRel, 'create', renderFinaleStub(p, modslug, parts), 'stub финала (ОЖИДАЕТ ГЕНЕРАЦИИ)');
    else warnings.push('finale.md уже существует — не трогаем.');
  }

  // 3. Diary seed-stubs → characters/<lin>/<slug>/journal/<period>.md
  const stubs = [];
  for (const pt of parts.filter(x => x.diary)) {
    const rel = `cities/${city}/characters/${pt.lineageFolder}/${pt.slug}/journal/${p.diaryPeriod}.md`;
    const existing = await fs.readFile(path.join(ROOT, rel), 'utf-8').catch(() => null);
    const stub = renderDiaryStub(p, pt, parts);
    if (existing == null) {
      const header = `# 📖 Дневник — ${pt.name}\n\n> 🔗 [Карточка](../${pt.slug}.md)\n\n---\n\n`;
      add(rel, 'create', header + stub + '\n', `дневник-stub ${pt.name} (${p.diaryPeriod})`);
    } else {
      add(rel, 'modify', existing.replace(/^﻿/, '').replace(/\s+$/, '') + '\n\n---\n\n' + stub + '\n', `+сцена в дневник ${pt.name} (${p.diaryPeriod})`);
    }
    stubs.push(rel);
  }
  if (hasFinale) stubs.push(`${modRel}/finale.md`);

  // 4. Threads → chronicles/<chr>/open_threads.md
  const otRel = `cities/${city}/chronicles/${chr}/open_threads.md`;
  let otRaw = await fs.readFile(path.join(ROOT, otRel), 'utf-8').then(s => s.replace(/^﻿/, '')).catch(() => null);
  const otExisted = otRaw != null;
  if (!otExisted) otRaw = renderOpenThreadsSkeleton(chrDisplay || chr);
  if ((p.threads.new || []).length) otRaw = addThreadRows(otRaw, p.threads.new, `«${p.event.title}», ${monthLabel}`);
  if ((p.threads.close || []).length) otRaw = closeThreadRows(otRaw, p.threads.close);
  if ((p.threads.new || []).length || (p.threads.close || []).length)
    add(otRel, otExisted ? 'modify' : 'create', otRaw, `нити: +${(p.threads.new || []).length} / закрыто ${(p.threads.close || []).length}`);

  // 5. Character status patches
  for (const pt of parts.filter(x => x.statusChange)) {
    const rel = `cities/${city}/characters/${pt.lineageFolder}/${pt.slug}/${pt.slug}.md`;
    const cardRaw = await fs.readFile(path.join(ROOT, rel), 'utf-8').catch(() => null);
    if (cardRaw == null) { warnings.push(`Карточка ${pt.name} не найдена для смены статуса.`); continue; }
    add(rel, 'modify', patchCardStatus(cardRaw.replace(/^﻿/, ''), pt.statusChange, pt.statusDetails),
      `Статус → ${pt.statusChange}${pt.statusDetails ? ' (' + pt.statusDetails + ')' : ''}`);
  }

  return { errors, warnings, notes, changes, stubs, summary: {
    city, chronicle: chr, chronicleNew, module: modslug, moduleNew, diaryPeriod: p.diaryPeriod,
    participants: parts.length, diaries: parts.filter(x => x.diary).length, finale: hasFinale
  } };
}

function planHash(changes) {
  const canon = changes.map(c => `${c.rel}\x00${c.action}\x00${c.after}`).join('\x01');
  return crypto.createHash('sha256').update(canon, 'utf8').digest('hex');
}

app.post('/api/log-session', async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.city) payload.city = reqCity(req);   // from ?city= (fetch wrapper)
    const plan = await buildSessionPlan(payload);
    if (plan.errors.length)
      return res.status(400).json({ ok: false, errors: plan.errors, warnings: plan.warnings });

    const hash = planHash(plan.changes);
    const preview = plan.changes.map(c => ({ rel: c.rel, action: c.action, preview: c.preview }));

    // PREVIEW
    if (payload.dryRun !== false) {
      return res.json({ ok: true, dryRun: true, previewHash: hash,
        changes: preview, stubs: plan.stubs, warnings: plan.warnings, notes: plan.notes, summary: plan.summary });
    }

    // WRITE — must match the previewed plan exactly
    if (payload.previewHash !== hash)
      return res.status(409).json({ ok: false, errors: ['План изменился с момента предпросмотра — повторите предпросмотр.'] });

    const written = [];
    for (const c of plan.changes) {
      const abs = path.join(ROOT, c.rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      // npc/ dir for new modules (modular NPC cards)
      if (c.rel.endsWith('/npc.md')) await fs.mkdir(path.join(path.dirname(abs), 'npc'), { recursive: true }).catch(() => {});
      const text = c.after.replace(/\r\n/g, '\n');     // LF, matches migrated files
      await writeFileAtomic(abs, text, 'utf-8');
      written.push({ rel: c.rel, action: c.action });
    }
    delete _cache[plan.summary.city];

    // Regenerate the city's aggregate event index, then revalidate links.
    await new Promise(resolve => {
      const ps = spawn('node', [path.join(ROOT, 'tools', 'build_city_events.js'), plan.summary.city], { cwd: ROOT });
      ps.on('close', () => resolve()); ps.on('error', () => resolve());
    });
    runValidationBackground();

    res.json({ ok: true, dryRun: false, written, stubs: plan.stubs, warnings: plan.warnings,
      notes: plan.notes, summary: plan.summary });
  } catch (e) {
    res.status(500).json({ ok: false, errors: [e.message] });
  }
});

// ── Claude integration (headless `claude -p`) ──────────────────────────────────
//
// Runs Claude Code as a subprocess (same pattern as the PowerShell tools). Uses the
// user's existing Claude Code login — no API key needed. The prompt is piped via
// stdin so no dynamic text ever touches the command line (shell:true stays safe).

// Default model for web Claude calls; empty = session default. Override in start.bat.
const DEFAULT_CLAUDE_MODEL = process.env.CLAUDE_MODEL || '';

function runClaude(prompt, { budget = 2, timeoutMs = 240000, allow = 'Read,Edit,Write,Grep,Glob', model = '' } = {}) {
  return new Promise((resolve, reject) => {
    // The prompt goes via stdin, so it never touches the command line. The model is the
    // only dynamic token on the line → sanitize it hard (alias "opus"/"sonnet" or an id
    // like "claude-sonnet-4-6"; strip everything else to prevent shell injection).
    const safeModel = String(model).replace(/[^a-zA-Z0-9.\-]/g, '').slice(0, 60);
    const modelFlag = safeModel ? ` --model ${safeModel}` : '';
    const cmd = `claude -p --output-format json --permission-mode acceptEdits ` +
                `--allowed-tools ${allow} --no-session-persistence --max-budget-usd ${budget}${modelFlag}`;
    const ps = spawn(cmd, { cwd: ROOT, shell: true });
    let out = '', err = '';
    const timer = setTimeout(() => { ps.kill(); reject(new Error('Claude: превышен таймаут')); }, timeoutMs);
    ps.stdout.on('data', d => out += d.toString('utf8'));
    ps.stderr.on('data', d => err += d.toString('utf8'));
    ps.on('error', e => { clearTimeout(timer); reject(e); });
    ps.on('close', code => {
      clearTimeout(timer);
      if (!out) return reject(new Error(err || `claude exit ${code}`));
      try { resolve(JSON.parse(out)); }
      catch { resolve({ subtype: 'raw', result: out, is_error: code !== 0 }); }
    });
    ps.stdin.write(prompt, 'utf8');
    ps.stdin.end();
  });
}

app.get('/api/claude/health', (req, res) => {
  if (_claudeHealthCache && (Date.now() - _claudeHealthCacheAt) < CLAUDE_HEALTH_TTL) {
    return res.json(_claudeHealthCache);
  }
  let sent = false;
  const done = body => {
    if (!sent) {
      sent = true;
      _claudeHealthCache = body;
      _claudeHealthCacheAt = Date.now();
      res.json(body);
    }
  };
  const ps = spawn('claude --version', { shell: true });
  let out = '';
  const timer = setTimeout(() => { ps.kill(); done({ available: false }); }, 8000);
  ps.stdout.on('data', d => out += d.toString('utf8'));
  ps.on('error', () => { clearTimeout(timer); done({ available: false }); });
  ps.on('close', code => { clearTimeout(timer); done({ available: code === 0, version: out.trim(), defaultModel: DEFAULT_CLAUDE_MODEL || null }); });
});

// ── OpenRouter prose generation ───────────────────────────────────────────────

async function buildProseContext(city, valid) {
  // 1. diary_rules.md + literary_style.md
  const diaryRules = await fs.readFile(
    path.join(ROOT, 'system', 'rules', 'diary_rules.md'), 'utf-8').catch(() => '');
  const litStyle = await loadLiteraryStyle();

  // 2. Read each stub file + extract referenced characters and chronicle facts
  const stubContents = [];
  const charSlugsNeeded = new Set();
  const eventsFilesNeeded = new Set();

  for (const rel of valid) {
    const txt  = await fs.readFile(path.resolve(ROOT, rel), 'utf-8').catch(() => '');
    stubContents.push({ rel, txt });

    // Extract character slug from path: characters/<lineage>/<slug>/journal/...
    const slugMatch = rel.match(/characters\/[^/]+\/([^/]+)\//);
    if (slugMatch) charSlugsNeeded.add(slugMatch[1]);

    // Extract FACTS references (chronicle events.md links in comments)
    const factsMatch = txt.match(/ФАКТЫ[:\s]+([^\n>]+events\.md[^\n]*)/gi);
    if (factsMatch) {
      for (const fm of factsMatch) {
        const pathMatch = fm.match(/(cities\/[^)\s]+events\.md)/);
        if (pathMatch) eventsFilesNeeded.add(pathMatch[1]);
      }
    }
    // Also try to find chronicle from path
    const chrMatch = rel.match(/chronicles\/([^/]+)\//);
    if (chrMatch) {
      eventsFilesNeeded.add(`cities/${city}/chronicles/${chrMatch[1]}/events.md`);
    }
  }

  // 3. Read character cards
  const chars = await getAllCharacters(city);
  const charCards = [];
  for (const slug of charSlugsNeeded) {
    const ch = chars.find(c => c.slug === slug);
    if (!ch) continue;
    const cardPath = path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}.md`);
    const card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
    if (card) charCards.push(`### Карточка: ${ch.name}\n${card}`);
  }

  // 4. Read chronicle events
  const eventsChunks = [];
  for (const evRel of eventsFilesNeeded) {
    const evTxt = await fs.readFile(path.join(ROOT, evRel), 'utf-8').catch(() => null);
    if (evTxt) eventsChunks.push(`### ${evRel}\n${evTxt.slice(0, 6000)}`);
  }

  return { diaryRules, litStyle, stubContents, charCards, eventsChunks };
}

// ── Chronicle Scene State ─────────────────────────────────────────────────────
// GET /api/chronicles/:chr/state?city=paris
// Reads chronicle events.md → compresses to compact Scene State JSON.
// Clients can pass this back as `state` in prose generation requests.
app.get('/api/chronicles/:chr/state', async (req, res) => {
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

// ── AI Director: propose next scene ──────────────────────────────────────────
// POST /api/director/propose
// Body: { city, chronicle } OR { state: <Scene State JSON> }
// Returns scene proposals, NPC suggestions, tension forecast.
// Human-in-the-loop: the Director PROPOSES, the Storyteller DECIDES.
app.post('/api/director/propose', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    let state  = req.body?.state || null;

    // If no state provided, build from chronicle events.md
    if (!state && req.body?.chronicle) {
      const evPath = path.join(chroniclesDir(city), req.body.chronicle, 'events.md');
      const raw    = await fs.readFile(evPath, 'utf-8').catch(() => null);
      if (raw) {
        state = compressChronicleEvents(parseEventsText(raw));
        state.city      = city;
        state.chronicle = req.body.chronicle;
      }
    }
    if (!state) return res.status(400).json({ error: 'Нет данных: передай state или chronicle.' });

    const tension  = state.tension || 0;
    const chars    = Object.keys(state.characters || {});
    const flags    = Object.keys(state.world_flags || {});

    const PHASES = [
      { max: 3,  type: 'setup',    goal: 'ввести трение' },
      { max: 6,  type: 'conflict', goal: 'эскалировать конфликт' },
      { max: 10, type: 'climax',   goal: 'вынудить необратимое решение' },
    ];
    const phase = PHASES.find(p => tension <= p.max) || PHASES.at(-1);

    const warnings = [];
    if (tension >= 9) warnings.push('перегрузка напряжения — следующая сцена должна дать разрядку или кризис');
    if (chars.length < 2) warnings.push('меньше 2 активных персонажей — добавь антагониста или свидетеля');
    const deadNames = chars.filter(n => state.characters[n]?.status === 'dead');
    if (deadNames.length) warnings.push(`мёртвые персонажи упомянуты как активные: ${deadNames.join(', ')}`);

    const suggestedScenes = [
      {
        title: phase.type === 'climax' ? 'Кульминация' : 'Следующая сцена',
        goal: phase.goal,
        recommended_characters: chars.slice(0, 3),
        tension_after: Math.min(10, tension + (phase.type === 'climax' ? 2 : 1)),
      }
    ];
    if (flags.length) {
      suggestedScenes.push({
        title: 'Развитие открытой нити',
        hook: flags[0],
        goal: 'развить последствия предыдущего события',
        recommended_characters: chars.slice(0, 2),
        tension_after: tension,
      });
    }

    res.json({
      ok: true,
      meta: {
        ai_suggestion: true,
        user_can_modify: true,
        user_can_reject: true,
        note: 'Рассказчик принимает решение; Director только предлагает.'
      },
      phase:            phase.type,
      phase_goal:       phase.goal,
      tension_now:      tension,
      tension_forecast: Math.min(10, tension + 1),
      active_characters: chars,
      world_flags:      flags,
      suggested_scenes: suggestedScenes,
      warnings,
    });
  } catch (e) {
    serverError(res, e);
  }
});

app.post('/api/openrouter/generate-prose', express.json(), async (req, res) => {
  try {
    const stubs      = Array.isArray(req.body.stubs) ? req.body.stubs : [];
    const proseModel = req.body?.model || null;
    if (!stubs.length) return res.status(400).json({ ok: false, error: 'Не переданы stub-файлы.' });

    const city  = reqCity(req);
    const valid = [];
    for (const rel of stubs) {
      const abs = path.resolve(ROOT, rel);
      if (!abs.startsWith(ROOT + path.sep)) continue;
      const txt = await fs.readFile(abs, 'utf-8').catch(() => null);
      if (txt && /ОЖИДАЕТ ГЕНЕРАЦИИ/.test(txt)) valid.push(rel);
    }
    if (!valid.length) return res.status(400).json({ ok: false, error: 'Нет stub-файлов с меткой «ОЖИДАЕТ ГЕНЕРАЦИИ».' });

    const { diaryRules, litStyle, stubContents, charCards, eventsChunks } = await buildProseContext(city, valid);

    const systemPrompt = `Ты — Рассказчик Vampire: The Masquerade V20. Пишешь литературные дневниковые записи персонажей строго по правилам ниже.
${litStyle ? `\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}\n` : ''}
# ПРАВИЛА ДНЕВНИКОВ
${diaryRules.slice(0, 4000)}

# КАРТОЧКИ ПЕРСОНАЖЕЙ
${charCards.join('\n\n') || '(не найдены)'}

# СОБЫТИЯ ХРОНИКИ (ИСТОЧНИК ФАКТОВ)
${eventsChunks.join('\n\n') || '(не найдены)'}`;

    const userPrompt = `Заполни следующие stub-файлы дневниковой прозой. Строго следуй правилам diary_rules.md.

Для КАЖДОГО файла выведи ТОЧНО в таком формате (без отклонений):
===FILE: <путь к файлу>===
<полное содержимое файла — убери маркер «ОЖИДАЕТ ГЕНЕРАЦИИ» и служебные комментарии>
===ENDFILE===

STUB-ФАЙЛЫ:
${stubContents.map(s => `\n---\n## ${s.rel}\n${s.txt}`).join('\n')}`;

    // Provider: OpenRouter (default) or OpenAI/GPT — both OpenAI-compatible
    const useOpenAI = req.body?.source === 'openai' || req.body?.source === 'gpt';
    if (useOpenAI && !process.env.OPENAI_API_KEY)
      return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY не задан. Настрой в Инструменты → Модели AI.' });
    if (!useOpenAI && !process.env.OPENROUTER_API_KEY)
      return res.status(503).json({ ok: false, error: 'OPENROUTER_API_KEY не задан. Настрой в Инструменты → Модели AI.' });

    const model = proseModel || (useOpenAI
      ? (process.env.OPENAI_MODEL || 'gpt-4o-mini')
      : (process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free'));

    let text = '';
    try {
      text = useOpenAI
        ? await callOpenAI(model, systemPrompt, userPrompt, [], 240000, 4000)
        : await callOpenRouter(model, systemPrompt, userPrompt, [], 240000, 4000);
    } catch (e) {
      return res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ ok: false, error: e.message });
    }
    if (!text) return res.status(500).json({ ok: false, error: `${useOpenAI ? 'OpenAI' : 'OpenRouter'} вернул пустой ответ.` });

    // Parse ===FILE: ...=== blocks
    const fileBlockRe = /===FILE:\s*(.+?)===\n([\s\S]*?)===ENDFILE===/g;
    let match;
    const written = [], failed = [];

    while ((match = fileBlockRe.exec(text)) !== null) {
      const relPath = match[1].trim();
      const content = match[2].trim();
      const abs     = path.resolve(ROOT, relPath);
      if (!abs.startsWith(ROOT + path.sep)) { failed.push(relPath); continue; }
      try {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await writeFileAtomic(abs, content + '\n', 'utf-8');
        written.push(relPath);
      } catch (e) {
        failed.push(relPath);
      }
    }

    // Check stubs still have marker (= not written)
    const pending = [];
    for (const rel of valid) {
      if (!written.includes(rel)) {
        const txt = await fs.readFile(path.resolve(ROOT, rel), 'utf-8').catch(() => '');
        if (/ОЖИДАЕТ ГЕНЕРАЦИИ/.test(txt)) pending.push(rel);
      }
    }

    if (!written.length) {
      console.error('[openrouter-prose] Parse failed. Raw response:\n', text.slice(0, 500));
      return res.status(500).json({ ok: false, error: 'Не удалось разобрать ответ. Проверь формат.', raw: text.slice(0, 800) });
    }

    _cache = {};
    console.log(`[openrouter-prose] written: ${written.join(', ')}`);
    res.json({ ok: true, written, pending, failed, model });
  } catch (e) {
    console.error('[openrouter-prose]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/claude/generate-prose', async (req, res) => {
  try {
    const stubs = Array.isArray(req.body.stubs) ? req.body.stubs : [];
    if (!stubs.length) return res.status(400).json({ ok: false, error: 'Не переданы stub-файлы.' });

    // Validate: inside project, exist, and actually carry the pending marker
    const valid = [];
    for (const rel of stubs) {
      const abs = path.resolve(ROOT, rel);
      if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) continue;
      const txt = await fs.readFile(abs, 'utf-8').catch(() => null);
      if (txt && /ОЖИДАЕТ ГЕНЕРАЦИИ/.test(txt)) valid.push(rel);
    }
    if (!valid.length)
      return res.status(400).json({ ok: false, error: 'Нет валидных stub-файлов (метка «ОЖИДАЕТ ГЕНЕРАЦИИ» не найдена).' });

    const prompt = [
      'Ты — Рассказчик Vampire: The Masquerade V20, проект «твой домен».',
      'Сгенерируй литературную прозу для следующих stub-файлов (помечены «⏳ ОЖИДАЕТ ГЕНЕРАЦИИ»):',
      ...valid.map(s => '- ' + s),
      '',
      'Правила:',
      '0. Литературный стиль — строго по system/rules/literary_style.md (тон, ритм, диалоги, антишаблоны, голоса персонажей). Применяется ко всей прозе.',
      '1. Дневники — строго по system/rules/diary_rules.md: глубокий POV, клановый стиль автора (сверяйся с карточкой в cities/<город>/characters/), Маскарад через метафоры, 150–400 слов. Заполни поля «📖 Текст записи» и «🔗 Зеркальная ссылка».',
      '2. Файл finale.md — литературный текст финальной сцены сессии.',
      '3. Факты бери ТОЛЬКО из записи хроники, указанной в комментарии «ФАКТЫ» внутри файла (chronicles/<хроника>/events.md). Не выдумывай события и участников.',
      '4. Учти «КОММЕНТАРИЙ МАСТЕРА» (HTML-комментарий) при генерации, затем УДАЛИ все служебные комментарии <!-- ... --> и метки «⏳ ОЖИДАЕТ ГЕНЕРАЦИИ».',
      '5. Меняй ТОЛЬКО перечисленные выше файлы. Больше ничего не трогай.',
      '',
      'В конце кратко перечисли, что записал в каждый файл.'
    ].join('\n');

    const model = req.body.model || DEFAULT_CLAUDE_MODEL;
    const result = await runClaude(prompt, { budget: 2, timeoutMs: 240000, model });

    // Verify the marker is gone in each file
    const written = [], pending = [];
    for (const rel of valid) {
      const txt = await fs.readFile(path.resolve(ROOT, rel), 'utf-8').catch(() => '');
      (/ОЖИДАЕТ ГЕНЕРАЦИИ/.test(txt) ? pending : written).push(rel);
    }
    _cache = {};

    res.json({
      ok: !result.is_error && written.length > 0,
      written, pending,
      cost: result.total_cost_usd ?? null,
      durationMs: result.duration_ms ?? null,
      summary: result.result || ''
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── OpenRouter: list free models ──────────────────────────────────────────────

let _orModelsCache = null;
let _orModelsCacheAt = 0;
const OR_MODELS_TTL = 30 * 60 * 1000; // 30 min

// Cache Claude CLI health check (5 min) — avoids spawning a shell on every diary load
let _claudeHealthCache = null;
let _claudeHealthCacheAt = 0;
const CLAUDE_HEALTH_TTL = 5 * 60_000;

// Cache Claude OAuth credentials read (60 s) — avoids disk I/O on every AI call
let _oauthCredsCache = null;
let _oauthCredsCacheAt = 0;
const OAUTH_CREDS_TTL = 60_000;
async function _readOauthCached() {
  if (_oauthCredsCacheAt && (Date.now() - _oauthCredsCacheAt) < OAUTH_CREDS_TTL) return _oauthCredsCache;
  try {
    const raw = await fs.readFile(CLAUDE_CREDS_PATH, 'utf-8');
    _oauthCredsCache = JSON.parse(raw)?.claudeAiOauth || null;
  } catch { _oauthCredsCache = null; }
  _oauthCredsCacheAt = Date.now();
  return _oauthCredsCache;
}

app.get('/api/openrouter/models', async (req, res) => {
  if (_orModelsCache && (Date.now() - _orModelsCacheAt) < OR_MODELS_TTL) {
    return res.json({ ok: true, models: _orModelsCache });
  }
  try {
    const apiKey  = process.env.OPENROUTER_API_KEY;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const resp = await fetch('https://openrouter.ai/api/v1/models', { headers });
    if (!resp.ok) throw new Error(`OpenRouter API: ${resp.status}`);
    const data = await resp.json();
    const free = (data.data || [])
      .filter(m => {
        const p = m.pricing || {};
        if ((String(p.prompt) !== '0') || (String(p.completion) !== '0')) return false;
        // Exclude image-generation models — they return content:null + images:[],
        // not text, so they break every text-generation endpoint.
        const outModes = m.architecture?.output_modalities;
        if (outModes?.length && !outModes.includes('text')) return false;
        return true;
      })
      .map(m => ({ id: m.id, label: m.name || m.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    free.push({ id: 'openrouter/free', label: 'Free Models Router' });
    _orModelsCache = free;
    _orModelsCacheAt = Date.now();
    res.json({ ok: true, models: free });
  } catch (e) {
    console.error('[or-models]', e.message);
    const fallback = [
      { id: 'google/gemma-4-26b-a4b-it:free',         label: 'Google Gemma 4 26B (Vision)' },
      { id: 'nvidia/nemotron-nano-12b-v2-vl:free',     label: 'Nvidia Nemotron Nano 12B VL' },
      { id: 'moonshotai/kimi-k2.6:free',               label: 'Moonshot Kimi K2.6' },
      { id: 'meta-llama/llama-4-scout:free',           label: 'Meta Llama 4 Scout' },
      { id: 'microsoft/mai-ds-r1:free',                label: 'Microsoft MAI DS R1' },
      { id: 'openrouter/free',                         label: 'Free Models Router' },
    ];
    res.json({ ok: true, models: fallback, fromFallback: true });
  }
});

// ── Settings (save .env + optional restart) ───────────────────────────────────

const ENV_PATH = path.join(__dirname, '.env');

app.get('/api/settings', async (req, res) => {
  try {
    const raw = await fs.readFile(ENV_PATH, 'utf-8').catch(() => '');
    const env = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    // Claude Code OAuth status (independent of OpenRouter priority in /api/auth-status)
    const oauth = await _readOauthCached().catch(() => null);
    const claudeOauth = oauth?.accessToken ? {
      expired:      !!(oauth.expiresAt && Date.now() >= oauth.expiresAt),
      subscription: oauth.subscriptionType || 'unknown',
      expiresIn:    oauth.expiresAt ? Math.max(0, Math.round((oauth.expiresAt - Date.now()) / 60000)) : null,
      hasRefresh:   !!oauth.refreshToken,
    } : null;

    res.json({
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ? '***' : '',
      OPENROUTER_MODEL:   env.OPENROUTER_MODEL   || '',
      hasKey:             !!env.OPENROUTER_API_KEY,
      OPENAI_MODEL:       env.OPENAI_MODEL       || '',
      hasOpenAIKey:       !!env.OPENAI_API_KEY,
      hasAnthropicKey:    !!env.ANTHROPIC_API_KEY,
      hasGeminiKey:       !!env.GEMINI_API_KEY,
      GEMINI_MODEL:       env.GEMINI_MODEL       || '',
      claudeOauth,
    });
  } catch (e) { serverError(res, e); }
});

app.post('/api/settings', express.json(), async (req, res) => {
  try {
    const { OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENAI_API_KEY, OPENAI_MODEL, ANTHROPIC_API_KEY, GEMINI_API_KEY, GEMINI_MODEL } = req.body || {};

    // Read current .env
    const raw = await fs.readFile(ENV_PATH, 'utf-8').catch(() => '');
    const lines = raw.split('\n').filter(l => l.trim() !== '');
    const env = {};
    for (const l of lines) { const m = l.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim(); }

    // Update only provided fields (empty string = remove; '***' = unchanged sentinel)
    const setKey = (name, val) => {
      if (val === undefined || val === '***') return;
      if (String(val).trim()) env[name] = String(val).trim(); else delete env[name];
    };
    setKey('OPENROUTER_API_KEY', OPENROUTER_API_KEY);
    setKey('OPENAI_API_KEY',     OPENAI_API_KEY);
    setKey('ANTHROPIC_API_KEY',  ANTHROPIC_API_KEY);
    setKey('GEMINI_API_KEY',     GEMINI_API_KEY);
    if (OPENROUTER_MODEL !== undefined) {
      if (OPENROUTER_MODEL.trim()) env.OPENROUTER_MODEL = OPENROUTER_MODEL.trim();
      else delete env.OPENROUTER_MODEL;
    }
    if (OPENAI_MODEL !== undefined) {
      if (OPENAI_MODEL.trim()) env.OPENAI_MODEL = OPENAI_MODEL.trim();
      else delete env.OPENAI_MODEL;
    }
    if (GEMINI_MODEL !== undefined) {
      if (GEMINI_MODEL.trim()) env.GEMINI_MODEL = GEMINI_MODEL.trim();
      else delete env.GEMINI_MODEL;
    }
    _geminiClient = null; // invalidate cached client on key/model change

    const newContent = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    await writeFileAtomic(ENV_PATH, newContent, 'utf-8');

    const needsRestart = req.body?.restart !== false;
    res.json({ ok: true, needsRestart, supervised: SUPERVISED });
    if (needsRestart) scheduleRestart('[settings]');
  } catch (e) {
    console.error('[settings]', e.message);
    serverError(res, e);
  }
});

const RESTART_CODE = 75; // wrapper.js watches for this exit code to restart
// Only self-exit to restart when a guardian (wrapper.js) is watching — otherwise
// `process.exit(75)` would kill the server permanently with nothing to relaunch it.
const SUPERVISED = process.env.VTM_SUPERVISED === '1';

function scheduleRestart(tag = '[restart]', delayMs = 300) {
  if (!SUPERVISED) {
    console.warn(`${tag} Авто-рестарт пропущен: сервер запущен без wrapper.js. ` +
      `Изменения вступят в силу после ручного перезапуска (start.bat из корня или npm start).`);
    return false;
  }
  console.log(`${tag} Перезапуск (exit ${RESTART_CODE})...`);
  setTimeout(() => process.exit(RESTART_CODE), delayMs);
  return true;
}

app.post('/api/restart', (req, res) => {
  res.json({
    ok: true,
    supervised: SUPERVISED,
    message: SUPERVISED ? 'Перезапуск...' : 'Сервер запущен без wrapper.js — перезапустите вручную.',
  });
  scheduleRestart('[restart]');
});

// ── Global error net ───────────────────────────────────────────────────────────
// Express 4-arg error middleware: catches synchronous throws inside route handlers
// and anything passed to next(err), so a handler bug becomes a clean 500 instead of
// a hung request. Must be registered AFTER all routes. The client gets a safe
// message; the full stack stays in the server log.
app.use((err, req, res, next) => {
  console.error(`${C.red}[unhandled]${C.reset} ${req.method} ${req.url}:`, err?.stack || err);
  if (res.headersSent) return next(err);
  res.status(err?.status && err.status >= 400 && err.status < 600 ? err.status : 500)
     .json({ error: 'Внутренняя ошибка сервера. Подробности — в логе сервера.' });
});

// Last-resort process guards. A throw in an async callback that escapes every
// try/catch used to take the whole server down (e.g. the generate-prompt crash).
// Now: log it; under wrapper.js (SUPERVISED) restart cleanly since state may be
// corrupt, otherwise stay up so the GM doesn't lose their only running instance.
process.on('unhandledRejection', reason => {
  console.error(`${C.red}[unhandledRejection]${C.reset}`, reason?.stack || reason);
});
process.on('uncaughtException', err => {
  console.error(`${C.red}[uncaughtException]${C.reset}`, err?.stack || err);
  if (SUPERVISED) scheduleRestart('[uncaughtException]', 100);
});

function runMigrationsOnStartup() {
  try {
    const { filesChanged, migrationsApplied } = runMigrations({
      root: ROOT,
      log: msg => console.log(`  ${C.dim}[migrate]${C.reset} ${msg}`),
    });
    if (filesChanged) {
      console.log(`  \u{1F527} Миграции формата: обновлено файлов — ${filesChanged} (применений: ${migrationsApplied})\n`);
    }
  } catch (e) {
    console.error(`${C.red}[migrations]${C.reset}`, e?.stack || e);
  }
}

app.listen(PORT, () => {
  console.log(`\n  \u{1FA78} Sanguine System`);
  console.log(`  ─────────────────`);
  console.log(`  http://localhost:${PORT}\n`);
  // Подхватить изменения формата карточек после обновления (см. web/lib/migrations.js)
  runMigrationsOnStartup();
  // Run initial validation on startup
  runValidationBackground();
});
