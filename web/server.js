const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const crypto  = require('crypto');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { RU_MONTHS_NOM, THREAD_STATUS, readPrompt, writePrompt, periodLabel, threadStatusKey, parseThreadsContent } = require('./lib/parsers');

// Load .env file (secrets not committed to git)
try {
  const envRaw = require('fs').readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of envRaw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

const app  = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const ROOT = path.join(__dirname, '..');

// ── City layer (cities/<city>/…) ───────────────────────────────────────────────
const CITIES_DIR   = path.join(ROOT, 'cities');
function _firstCity() { try { return (require('fs').readdirSync(CITIES_DIR, { withFileTypes: true }).find(e => e.isDirectory() && !e.name.startsWith('.')) || {}).name || ''; } catch { return ''; } }
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
    return es.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
  } catch { return []; }
}

let _cache = {};            // city → { chars, ts }
const CHARS_TTL = 15_000;

// Last known broken-link count from validate_links.ps1.
// null = never validated; 0 = clean; N = N broken links remaining.
let _brokenLinks = null;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Serve images straight out of cities/<city>/… (characters/<lin>/<slug>/art/, locations/…)
app.use('/city-img', express.static(CITIES_DIR));

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

// Human-readable action descriptions for API routes
const ACTION_MAP = {
  'GET /api/status':                          () => 'Дашборд — загрузка статистики',
  'GET /api/characters':                      req => `Персонажи — загрузка (город: ${reqCity(req)})`,
  'GET /api/characters/all-images':           req => `Карусель — загрузка всех артов (${reqCity(req)})`,
  'GET /api/characters/:name/images':         req => `Арты персонажа: ${decodeURIComponent(req.params.name)}`,
  'GET /api/characters/:name/diary':          req => `Дневник: ${decodeURIComponent(req.params.name)} → ${req.query.file || '?'}`,
  'PUT /api/characters/:name/fields':         req => `✏  Редактирование полей: ${decodeURIComponent(req.params.name)}`,
  'PUT /api/characters/:name/relations':      req => `✏  Редактирование отношений: ${decodeURIComponent(req.params.name)}`,
  'POST /api/characters/:name/upload-image':  req => `📷 Загрузка изображения → ${decodeURIComponent(req.params.name)}`,
  'POST /api/characters/:name/generate-appearance': req => `🤖 Генерация внешности: ${decodeURIComponent(req.params.name)}`,
  'DELETE /api/characters/:name/images/:filename':  req => `🗑 Удаление изображения: ${decodeURIComponent(req.params.filename)} ← ${decodeURIComponent(req.params.name)}`,
  'GET /api/locations':                       req => `Локации — загрузка (${reqCity(req)})`,
  'GET /api/locations/:slug/images':          req => `Арты локации: ${decodeURIComponent(req.params.slug)}`,
  'PUT /api/locations/:slug/fields':          req => `✏  Редактирование локации: ${decodeURIComponent(req.params.slug)}`,
  'POST /api/locations/:slug/upload-image':   req => `📷 Загрузка изображения локации → ${decodeURIComponent(req.params.slug)}`,
  'GET /api/graph':                           req => `Граф связей (${reqCity(req)})`,
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

// ── Markdown parser ───────────────────────────────────────────────────────────

function categorizeRel(desc) {
  const d = desc.toLowerCase();
  if (/сестр|брат|мать|отец|семь|родств|племян/.test(d)) return 'family';
  if (/сир|создал|обратил|обратила/.test(d))              return 'sire';
  if (/чайлд|потомок/.test(d))                            return 'childe';
  if (/враг|ненавид|угроз|конфликт|противн/.test(d))      return 'enemy';
  if (/союзник|друг|доверя|помощ|поддерж/.test(d))        return 'ally';
  if (/любов|романт|привязан|влюбл/.test(d))              return 'romantic';
  if (/подозр|осторожн|насторож/.test(d))                 return 'suspicious';
  if (/лояльн|предан|служ|свита/.test(d))                 return 'loyalty';
  return 'neutral';
}

function parseCharacter(rawContent, folderName, lineage) {
  const content = rawContent.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const c = { name: folderName, lineage, relationships: [] };

  // Name from # header (strip leading emoji / whitespace)
  const hm = content.match(/^#\s+[^\wЀ-ӿ]*([\wЀ-ӿ].+)$/m);
  if (hm) c.name = hm[1].trim();

  // Key-value fields:  - **Поле:** Значение
  const fRe = /^- \*\*([^*:\n]+):\*\*\s*(.+)$/gm;
  let m;
  while ((m = fRe.exec(content)) !== null) {
    const k = m[1].trim();
    const v = m[2].trim();
    if (k === 'Клан')         c.clan         = v;
    if (k === 'Секта')        c.sect         = v;
    if (k === 'Поколение')    c.generation   = v;
    if (k === 'Статус')                         c.status        = v;
    if (k === 'Детали статуса')                 c.statusDetails = v;
    if (k === 'Линейка WoD')                    c.lineageLabel  = v;
    if (k === 'Роль')                           c.role          = v;
    if (k === 'Год обращения')                  c.embraceYear   = v;
    if (k === 'Сир')                            c.sire          = v;
    if (k === 'Год рождения')                   c.birthYear     = v;
    if (k === 'Биография')                      c.biography     = v;
    if (k === 'Голос')                          c.voice         = v;
    if (k === 'Внешность')                      c.appearance    = v;
    if (k === 'Дитя')                           c.childe        = v;
    if (k === 'Домен / Локация')                c.location      = v;
    if (/иерархи/i.test(k))                     c.hierarchy     = v;   // «Иерархия в городе» / устар. варианты
    if (k === 'Деранжементы / Особенности')     c.derangements  = v;
    if (k === 'Дисциплины')                     c.disciplines   = v;
    if (k === 'Профессия')                      c.profession    = v;
    if (k === 'Клан / Раса' && !c.clan)         c.clan          = v;
    if (k === 'Род' && !c.clan)                 c.clan          = v;
    if (k === 'Секта / Двор' && !c.sect)        c.sect          = v;
    if (k === 'Фригольд / Локация' && !c.location) c.location  = v;
    if (k === 'Принадлежность')                 c.belonging     = v;
    if (k === 'Присутствие')                    c.presence      = v;   // появления в других городах
    if (k === 'Алиасы')                         c.aliases       = v;
  }

  // Diary links: - **📖 Дневники:** [Title](path.md)
  const diaryField = content.match(/- \*\*📖 Дневники:\*\*\s*(.+)$/m);
  if (diaryField) {
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    c.diaries = [];
    let lm;
    while ((lm = linkRe.exec(diaryField[1])) !== null) {
      c.diaries.push({ title: lm[1], file: lm[2] });
    }
  } else {
    c.diaries = [];
  }

  // Image prompts (handles both card formats — see readPrompt)
  const imgP = readPrompt(content, 'image');
  if (imgP !== undefined) c.imagePrompt = imgP;
  const negP = readPrompt(content, 'negative');
  if (negP !== undefined) c.negativePrompt = negP;

  // Relationships section (indented sub-bullets after **Отношения:**)
  const relBlock = content.match(/- \*\*Отношения:\*\*\n((?:[ \t]+- .+\n?)+)/);
  if (relBlock) {
    const lines = relBlock[1].split('\n').filter(l => /^\s+-/.test(l));
    for (const line of lines) {
      const clean = line.trim().replace(/^-\s*/, '');
      const dash  = clean.indexOf(' — ');
      if (dash === -1) continue;
      const targets = clean.slice(0, dash).split(',')
        .map(t => t.trim().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim())
        .filter(Boolean);
      const desc = clean.slice(dash + 3).trim();
      for (const tgt of targets) {
        c.relationships.push({ target: tgt, description: desc, type: categorizeRel(desc) });
      }
    }
  }

  // Lineage normalisation
  if (!c.lineage) {
    const ll = (c.lineageLabel || '').toLowerCase();
    if      (ll.includes('вампир'))                     c.lineage = 'vampire';
    else if (ll.includes('фея') || ll.includes('ченджлинг')) c.lineage = 'fairy';
    else if (ll.includes('смертн') || ll.includes('человек')) c.lineage = 'mortal';
    else if (ll.includes('оборот'))                     c.lineage = 'werewolf';
    else if (ll.includes('маг'))                        c.lineage = 'mage';
    else if (ll.includes('охотник'))                    c.lineage = 'hunter';
    else                                                c.lineage = 'unknown';
  }

  // Status type
  const sl = (c.status || '').toLowerCase();
  c.statusType = (sl.includes('жив') || sl.includes('жива') || sl.includes('активен') || sl.includes('активна')) ? 'active'
    : sl.includes('торпор') ? 'torpor'
    : (sl.includes('мёртв') || sl.includes('мертва') || sl.includes('погиб') || sl.includes('уничтожен') || sl.includes('убит')) ? 'dead'
    : sl.includes('неизвестно') ? 'unknown'
    : 'unknown';

  return c;
}

const LINEAGE_MAP = {
  vampires: 'vampire', fairies: 'fairy', mortals: 'mortal',
  werewolves: 'werewolf', mages: 'mage', hunters: 'hunter'
};

async function getAllCharacters(city = DEFAULT_CITY) {
  const cc = _cache[city];
  if (cc && Date.now() - cc.ts < CHARS_TTL) return cc.chars;
  const result = [];
  for (const [folder, lineage] of Object.entries(LINEAGE_MAP)) {
    const dir = path.join(charsDir(city), folder);
    let entries;
    try { entries = await fs.readdir(dir); } catch { continue; }

    for (const entry of entries) {
      if (entry === '.gitkeep') continue;
      const charDir = path.join(dir, entry);
      const mdPath  = path.join(charDir, `${entry}.md`);
      try {
        const content = await fs.readFile(mdPath, 'utf-8');
        const char = parseCharacter(content, entry, lineage);
        char.lineageFolder = folder;
        char.slug = entry;
        char.city = city;
        char.hasSheet = await fs.access(path.join(charDir, `${entry}-sheet.md`)).then(() => true).catch(() => false);

        // Images live in <slug>/art/. Prefer slug_NN.* (web upload), else first image.
        const artFiles = await fs.readdir(path.join(charDir, 'art')).catch(() => []);
        const slugRe   = new RegExp(`^${entry}_\\d+\\.[a-z]+$`, 'i');
        const imgFile  = artFiles.filter(f => slugRe.test(f)).sort().at(-1)
          || artFiles.find(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
        if (imgFile) {
          char.imageUrl = `/city-img/${city}/characters/${folder}/${encodeURIComponent(entry)}/art/${encodeURIComponent(imgFile)}`;
        }

        result.push(char);
      } catch { /* skip */ }
    }
  }
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

// ── Diary parser ──────────────────────────────────────────────────────────────

function parseDiary(rawContent) {
  const content = rawContent.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const d = {};

  const hm = content.match(/^#\s+(.+)$/m);
  if (hm) d.title = hm[1].trim();

  // Detect format: multiple dated sections = retrospective
  const sectionMatches = [...content.matchAll(/^###\s+📅\s+(.+)$/gm)];

  if (sectionMatches.length > 1) {
    d.format = 'retrospective';
    d.sections = sectionMatches.map((m, i) => {
      const title = m[1].trim();
      const bodyStart = m.index + m[0].length;
      const bodyEnd = i + 1 < sectionMatches.length ? sectionMatches[i + 1].index : content.length;
      const body = content.slice(bodyStart, bodyEnd)
        .replace(/(\n---+)+\s*$/, '')
        .trim();
      return { title, body };
    });
  } else {
    d.format = 'entry';
    if (sectionMatches.length === 1) d.session = sectionMatches[0][1].trim();

    for (const [label, key] of [
      ['👤 Автор',     'author'],
      ['📍 Локация',   'location'],
      ['🎭 Тон\\/Стиль', 'tone'],
    ]) {
      const m = content.match(new RegExp(`- \\*\\*${label}:\\*\\*\\s*(.+)$`, 'm'));
      if (m) d[key] = m[1].trim();
    }

    const textM = content.match(/- \*\*📖 Текст записи:\*\*\n([\s\S]+?)(?=\n- \*\*[🔗📝👁]|$)/);
    if (textM) d.text = textM[1].replace(/^[ \t]{1,2}/gm, '').trim();

    const crossM = content.match(/- \*\*🔗 Зеркальная ссылка:\*\*\n([\s\S]+?)(?=\n- \*\*[📝👁]|\n---|$)/);
    if (crossM) {
      d.crossRefs = crossM[1].split('\n')
        .filter(l => /^\s+-/.test(l))
        .map(l => l.replace(/^\s+-\s*/, '').trim())
        .filter(Boolean);
    }
  }

  return d;
}

// ── Location parser ───────────────────────────────────────────────────────────

function parseLocation(rawContent, folderName) {
  const content = rawContent.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const loc = { slug: folderName };

  const hm = content.match(/^#\s+(.+)$/m);
  if (hm) loc.title = hm[1].trim();

  // Parse any **Label:** value | or end-of-line pattern
  function metaField(label) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = content.match(new RegExp(`\\*\\*${esc}:\\*\\*\\s*([^|\\n]+?)(?=\\s*\\||\\s*\\n|$)`, 'm'));
    return m ? m[1].trim() : null;
  }

  loc.subtype      = metaField('Название');
  loc.district     = metaField('Округ');
  loc.neighborhood = metaField('Район');
  loc.address      = metaField('Адрес');
  loc.zone         = metaField('Зона');
  loc.control      = metaField('Контроль');

  // Atmosphere — emoji and exact wording optional
  const atmM = content.match(/## (?:🎭\s+)?Атмосфера[^\n]*\n+([\s\S]+?)(?=\n## |\n---)/);
  if (atmM) loc.atmosphere = atmM[1].trim();

  // VtM table fields
  for (const [label, key] of [
    ['Статус',            'locStatus'],
    ['Фракция',           'faction'],
    ['Постоянные фигуры', 'figures'],
    ['Угрозы',            'threats'],
    ['Маскарад',          'masquerade'],
  ]) {
    const m = content.match(new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|\\n]+)\\|`));
    if (m) loc[key] = m[1].trim();
  }

  // VtM section — prose only (strip table rows, separator lines, Маскарад inline)
  const vtmFreeM = content.match(/## (?:🩸\s+)?(?:VtM[^\n]*|Контекст[^\n]*)\n+([\s\S]+?)(?=\n## |\n---)/i);
  if (vtmFreeM) {
    const prose = vtmFreeM[1]
      .split('\n')
      .filter(l => !l.startsWith('|'))
      .join('\n')
      .replace(/\*\*Маскарад:\*\*[^\n]*/g, '')
      .trim();
    if (prose) loc.vtmText = prose;
  }

  // Masquerade from inline bold if not found in table
  if (!loc.masquerade) {
    const maqInline = content.match(/\*\*Маскарад:\*\*\s*([^\n]+)/);
    if (maqInline) loc.masquerade = maqInline[1].trim();
  }

  const maq = loc.masquerade || '';
  loc.masqueradeLevel = maq.includes('🟢') ? 'low' : maq.includes('🟡') ? 'medium' : maq.includes('🔴') ? 'high' : 'unknown';

  // Hooks — emoji, numbering and heading text optional
  const hooksM = content.match(/## (?:🪝\s+)?(?:Сценарные крючки|\d+\s+крючка?|Крючки)[^\n]*\n+([\s\S]+?)(?=\n## |\n---|$)/i);
  loc.hooks = hooksM
    ? (hooksM[1].match(/^\d+\..+$/gm) || []).map(h => h.replace(/^\d+\.\s*/, '').trim())
    : [];

  // Key points table (## Ключевые точки...)
  const keyM = content.match(/## (?:Ключевые точки[^\n]*)\n+([\s\S]+?)(?=\n## |\n---|$)/i);
  if (keyM) {
    loc.keyPoints = (keyM[1].match(/^\|[^|\n]+\|[^|\n]+\|/gm) || [])
      .filter(r => !r.match(/[-]{3}/) && !r.match(/^\|\s*\*?\*?(?:Место|Place|Параметр)\*?\*?\s*\|/i))
      .map(r => {
        const cells = r.split('|').slice(1, -1).map(c => c.replace(/\*\*/g, '').trim());
        return { place: cells[0], desc: cells[1] };
      })
      .filter(r => r.place);
  } else {
    loc.keyPoints = [];
  }

  // Image prompts (handles both card formats — see readPrompt)
  const imgPM = readPrompt(content, 'image');
  if (imgPM !== undefined) loc.imagePrompt = imgPM;
  const negPM = readPrompt(content, 'negative');
  if (negPM !== undefined) loc.negativePrompt = negPM;

  return loc;
}

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

function mdExtractLinks(s) {
  const out = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ text: m[1].trim(), href: m[2].trim() });
  return out;
}
function mdStripLinks(s) { return s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); }
function mdStripInline(s) { return mdStripLinks(s).replace(/\*\*/g, '').replace(/^\s*[-•]\s*/, '').trim(); }

function classifyChronicleLink({ text, href }) {
  const t = text.toLowerCase();
  let kind = 'other';
  if (t.includes('инал'))                       kind = 'finale';
  else if (t.includes('одул'))                  kind = 'module';
  else if (t.includes('нпс') || t.includes('npc')) kind = 'npc';
  // Module folder name = first path segment after modules/
  let module = null;
  const mm = href.match(/modules\/([^/]+)\//);
  if (mm) module = decodeURIComponent(mm[1]);
  return { text, href, kind, module };
}

// Extract clickable location links (those pointing into locations/) + plain text
function parseChronicleLocation(rest) {
  const links = mdExtractLinks(rest)
    .filter(l => /locations\//.test(l.href))
    .map(l => {
      const base = l.href.split('/').pop().replace(/\.md$/i, '');
      return { text: l.text, slug: decodeURIComponent(base) };
    });
  return { text: mdStripLinks(rest).trim(), links };
}

// Participant sub-bullet → { text, name } where name is leading identity for matching
function parseParticipant(line) {
  const clean = mdStripLinks(line.replace(/^\s*-\s*/, '')).replace(/\*\*/g, '').trim();
  // Name = leading text before first " (", " — " or " →"
  const name = clean.split(/\s+\(|\s+—\s+|\s+→\s+/)[0].trim();
  return { text: clean, name };
}

function parseTable(lines) {
  const rowLines = lines.filter(l => /^\s*\|/.test(l));
  if (rowLines.length < 2) return null;
  const parseRow = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => mdStripLinks(c).replace(/\*\*/g, '').trim());
  const headers = parseRow(rowLines[0]);
  const body = rowLines.slice(2).map(parseRow);   // skip separator row
  return { headers, rows: body };
}

function parseWorldState(block) {
  const ws = { lastUpdate: null, sections: [] };
  const lu = block.match(/Последнее обновление:\s*\*\*([^*]+)\*\*/);
  if (lu) ws.lastUpdate = lu[1].trim();

  for (const part of block.split(/\n(?=###\s)/)) {
    const lines = part.split('\n');
    if (!/^###\s/.test(lines[0])) continue;
    const heading = lines[0].replace(/^###\s*/, '').trim();
    const body = lines.slice(1);
    const table = parseTable(body);
    const prose = body
      .map(l => l.trim())
      .filter(l => l && !/^\|/.test(l) && !/^---+$/.test(l) && !/^>/.test(l))
      .map(mdStripLinks);
    ws.sections.push({ heading, table, prose });
  }
  return ws;
}

function parseEvent(chunk, id) {
  const lines = chunk.split('\n');
  const ev = {
    id, parallel: null, location: { text: '', links: [] },
    participants: [], eventsText: '', consequences: [], worldChanges: [], links: []
  };
  ev.heading = lines[0].replace(/^###\s*📅\s*/, '').trim();
  const dash = ev.heading.indexOf(' — ');
  ev.date  = dash !== -1 ? ev.heading.slice(0, dash).trim() : ev.heading;
  // После даты заголовок имеет вид "[краткая локация]. [Название]." Первое предложение —
  // локация (дублирует поле 📍 ниже), остальное — название. Если предложение одно
  // (напр. у записей, созданных логгером) — это и есть название.
  const afterDash = dash !== -1 ? ev.heading.slice(dash + 3).trim() : '';
  const sentences = afterDash.split('. ');
  ev.title = (sentences.length > 1 ? sentences.slice(1).join('. ') : afterDash).replace(/\.\s*$/, '').trim();

  let field = null;
  const proseBuf = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (/^>\s*🔗/.test(t)) { mdExtractLinks(t).forEach(l => ev.links.push(classifyChronicleLink(l))); continue; }
    if (/^>\s*⚡/.test(t)) { const m = t.match(/\*(.+?)\*/); ev.parallel = m ? m[1].trim() : t.replace(/^>\s*⚡\s*/, '').trim(); continue; }

    const fm = t.match(/^-\s*\*\*([^:]+):\*\*\s*(.*)$/);
    if (fm && /📍|👥|📋|⚖️|🌍/.test(fm[1])) {
      const lbl = fm[1], rest = fm[2];
      if      (lbl.includes('📍')) { field = 'location';     const pl = parseChronicleLocation(rest); ev.location = pl; }
      else if (lbl.includes('👥')) { field = 'participants'; }
      else if (lbl.includes('📋')) { field = 'events';       if (rest) proseBuf.push(rest); }
      else if (lbl.includes('⚖️')) { field = 'consequences'; }
      else if (lbl.includes('🌍')) { field = 'worldChanges'; }
      continue;
    }

    if      (field === 'participants' && /^-\s+/.test(t)) ev.participants.push(parseParticipant(t));
    else if (field === 'consequences' && /^-\s+/.test(t)) ev.consequences.push(mdStripInline(t));
    else if (field === 'worldChanges' && /^-\s+/.test(t)) ev.worldChanges.push(mdStripInline(t));
    else if (field === 'events')                          proseBuf.push(raw);
    else if (field === 'location' && t && !/^-/.test(t))  ev.location.text += ' ' + mdStripLinks(t).trim();
  }
  ev.eventsText = proseBuf.join('\n').trim();
  return ev;
}

function parseChronicle(raw) {
  const content = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const hm = content.match(/^#\s+(.+)$/m);
  const title = hm ? hm[1].replace(/[*#]/g, '').trim() : 'Хроника';

  // World state block: between "## 🌍 Состояние мира" and "## 📋 Хроника событий"
  let worldState = null;
  const wsM = content.match(/##\s*🌍[^\n]*\n([\s\S]*?)(?=\n##\s)/);
  if (wsM) worldState = parseWorldState(wsM[1]);

  // Events block: after "## 📋 Хроника событий"
  const events = [];
  const evBlockM = content.match(/##\s*📋[^\n]*\n([\s\S]*)$/);
  if (evBlockM) {
    const chunks = evBlockM[1].split(/\n(?=###\s*📅)/).filter(c => /^###\s*📅/.test(c.trim()));
    chunks.forEach((c, i) => events.push(parseEvent(c.trim(), i)));
  }

  return { title, worldState, events };
}

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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/characters', async (req, res) => {
  try { res.json(await getAllCharacters(reqCity(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/cities', async (req, res) => {
  try { res.json({ cities: await listCities(), default: DEFAULT_CITY }); }
  catch (e) { res.status(500).json({ error: e.message }); }
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

      // Status from chronicle.md
      let status = 'active';
      const chrMd = await fs.readFile(path.join(chrDir, 'chronicle.md'), 'utf-8').catch(() => null);
      if (chrMd) {
        if (/Закрыта|Завершена|closed/i.test(chrMd)) status = 'closed';
        else if (/Приостановлена|paused/i.test(chrMd)) status = 'paused';
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

      out.push({ slug: ch.name, display, events, modules, status, startDate });
    }

    // Sort: active first, then by name
    out.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return a.display.localeCompare(b.display, 'ru');
    });

    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

  if (updated !== raw) await fs.writeFile(chrMdPath, updated, 'utf-8');
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

    let cityDisplay = city;
    try {
      const cm = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8');
      const dm = cm.match(/^#\s+(.+?)(?:\s*—|\s*$)/m);
      if (dm) cityDisplay = dm[1].replace(/^[^\p{L}\p{N}]+/u, '').trim();
    } catch {}

    const fullDisplay = `${cityDisplay} — ${display}`;

    await fs.mkdir(path.join(chrDir, 'modules'), { recursive: true });

    await fs.writeFile(path.join(chrDir, 'chronicle.md'),
      renderChronicleMd(display, slug, city, mood?.trim() || '', []), 'utf-8');

    await fs.writeFile(path.join(chrDir, 'events.md'),
      renderChronicleEventsSkeleton(fullDisplay), 'utf-8');

    await fs.writeFile(path.join(chrDir, 'open_threads.md'),
      renderOpenThreadsSkeleton(fullDisplay), 'utf-8');

    console.log(`[create-chronicle] ${city}/${slug}: «${display}»`);
    delete _cache[city];
    res.json({ ok: true, slug, display });
  } catch (e) {
    console.error('[create-chronicle]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Chronicle delete helpers ──────────────────────────────────────────────────

// Parse participant names from events.md (lines under 👥 Участники:)
function parseChronicleParticipants(eventsText) {
  const names = new Set();
  let inPart = false;
  for (const line of eventsText.split('\n')) {
    if (/👥\s*Участники/i.test(line)) { inPart = true; continue; }
    if (inPart) {
      if (/^\s*-\s+/.test(line)) {
        // "  - Имя Фамилия (Клан, ...) — роль" — extract before first ( or —
        const raw = line.replace(/^\s*-\s+/, '').split(/[\(—\/]/)[0].trim();
        if (raw && !/без имён|безымянн/i.test(raw)) names.add(raw);
      } else if (!/^\s*$/.test(line) && !/^\s{2,}/.test(line)) {
        inPart = false;
      }
    }
  }
  return [...names];
}

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
  let otherText = '';
  for (const c of allChrs) {
    if (!c.isDirectory() || c.name === slug) continue;
    const files = await findMdFiles(path.join(chroniclesDir(city), c.name));
    for (const f of files) otherText += (await fs.readFile(f, 'utf-8').catch(() => '')) + '\n';
  }

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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      await fs.writeFile(idxPath, idx, 'utf-8');
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
    res.status(500).json({ error: e.message });
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
          const content = await fs.readFile(path.join(it.dir, mainFile), 'utf-8');
          const hm = content.match(/^#\s+(.+)$/m);
          if (hm) mod.title = hm[1].replace(/[*[\]]/g, '').trim();
          for (const [label, key] of [['Тип','type'],['Формат','format'],['Время','time'],['Тон','tone']]) {
            const fm = content.match(new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|\\n]+)\\|`));
            if (fm) mod[key] = fm[1].trim();
          }
        }
      } catch {}
      mods.push(mod);
    }
    res.json(mods);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
          const content = await fs.readFile(path.join(dir, mainFile), 'utf-8');
          const hm = content.match(/^#\s+(.+)$/m);
          if (hm) mod.title = hm[1].replace(/[*[\]]/g, '').trim();
          for (const [label, key] of [['Тип','type'],['Формат','format'],['Время','time'],['Тон','tone']]) {
            const fm = content.match(new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|\\n]+)\\|`));
            if (fm) mod[key] = fm[1].trim();
          }
        }
      } catch {}
      mods.push(mod);
    }
    res.json(mods);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Create module in chronicle ────────────────────────────────────────────────

app.post('/api/chronicles/:slug/modules', express.json(), async (req, res) => {
  try {
    const city   = reqCity(req);
    const chr    = req.params.slug;
    const { name, time } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Укажи название модуля' });

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

    await fs.writeFile(path.join(modDir, `${modSlug}.md`), mainContent, 'utf-8');
    await syncChronicleModuleLinks(city, chr);
    console.log(`[create-module] ${city}/${chr}/modules/${modSlug}`);
    res.json({ ok: true, slug: modSlug, title: name.trim() });
  } catch (e) {
    console.error('[create-module]', e.message);
    res.status(500).json({ error: e.message });
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

    // Read character cards for participants
    const chars = await getAllCharacters(city);
    const charCards = [];
    for (const name of [...pcs, ...npcs]) {
      const ch = chars.find(c => c.name === name || c.name.toLowerCase() === name.toLowerCase());
      if (!ch) continue;
      const cardPath = path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}.md`);
      const card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
      if (card) charCards.push(`### ${ch.name} (${pcs.includes(name) ? 'ПК' : 'НПС'})\n${card.slice(0, 2000)}`);
    }

    // Read module title from main file
    const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
    const mainTxt = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
    const titleM  = mainTxt.match(/^#\s+(.+)$/m);
    const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;

    const systemPrompt = `Ты — Мастер (Рассказчик) в Vampire: The Masquerade V20. Создаёшь сценарий модуля по правилам игры.

# ПРАВИЛА МОДУЛЕЙ
${moduleRules.slice(0, 3000)}

# СЕТТИНГ ГОРОДА
${cityMd.slice(0, 2000)}

# УЧАСТНИКИ МОДУЛЯ
${charCards.join('\n\n') || '(не указаны)'}`;

    const userPrompt = `Создай полный сценарий (scenario.md) для модуля «${modTitle}» по следующей идее:

${content}

Персонажи игроков: ${pcs.length ? pcs.join(', ') : '(не указаны)'}
НПС: ${npcs.length ? npcs.join(', ') : '(не указаны)'}

Структура сценария (строго по правилам module_rules.md):
1. Предпосылки — что привело к этой ситуации
2. Локации — 2-3 ключевых места с атмосферой
3. НПС — мотивации, секреты, роли
4. Завязка — как ПК втягиваются в события
5. Сцены (3–5) — каждая с конфликтом и вариантами развития
6. Кульминация — пиковый момент напряжения
7. Варианты финала — 2-3 возможных исхода
8. Открытые нити — что останется неразрешённым
9. Парижский колорит — 2-3 детали, делающие сцену именно Парижем 2010

Язык: русский. Стиль: готический нуар, VtM атмосфера.`;

    // Use makeGenerationClient (respects OpenRouter/Claude preference)
    const gen = await makeGenerationClient().catch(() => null);
    let scenarioText = '';

    if (gen?.source === 'openrouter') {
      const orResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'VTM Chronicle Manager',
        },
        body: JSON.stringify({
          model: gen.model,
          max_tokens: 4000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
          ],
        }),
      });
      if (!orResp.ok) {
        const err = await orResp.text();
        return res.status(orResp.status).json({ ok: false, error: err });
      }
      const data = await orResp.json();
      scenarioText = data.choices?.[0]?.message?.content?.trim() || '';
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
    await fs.writeFile(scenarioPath, header + scenarioText + '\n', 'utf-8');
    console.log(`[fill-module] ${city}/${chr}/${mod}/scenario.md written`);

    // ── Update main module file (.md) ─────────────────────────────────────
    // Extract first location from scenario (line containing "📍 Локация:")
    const locLineMatch = scenarioText.match(/(?:локация|место действия)[^\n:]*[:]\s*([^\n]+)/i);
    const firstLoc = locLineMatch ? locLineMatch[1].replace(/\*\*/g, '').trim() : '';

    // Short summary from the user's idea (first 200 chars)
    const shortSummary = content.trim().split('\n')[0].slice(0, 200);

    // Participants block
    const pcLines  = pcs.map(n  => `- [${n}](../../../../characters/${(chars.find(c => c.name === n)?.lineageFolder || 'characters')}/${(chars.find(c => c.name === n)?.slug || slugify(n))}/${(chars.find(c => c.name === n)?.slug || slugify(n))}.md) — Персонаж игрока`).join('\n');
    const npcLines = npcs.map(n => `- ${n} — НПС`).join('\n');
    const partBlock = [pcLines, npcLines].filter(Boolean).join('\n');

    const mainContent = [
      `# ${mainTxt.match(/^#\s+(.+)$/m)?.[1] || modTitle}`,
      '> Хроника | Vampire: The Masquerade V20 / Changeling: The Dreaming',
      '',
      '> 🔗 [Хроника](../../events.md) | [Сценарий](scenario.md)',
      '',
      '---',
      '',
      '| Параметр | Значение |',
      '|---|---|',
      `| **Тип** | Игровая сессия |`,
      `| **Время** | ${mainTxt.match(/\|\s*\*\*Время\*\*\s*\|\s*([^|]+)\|/)?.[1]?.trim() || ''} |`,
      `| **Локация** | ${firstLoc} |`,
      '',
      '---',
      '',
      shortSummary ? shortSummary : '*Краткое содержание — см. запись хроники.*',
      '',
      ...(partBlock ? ['---', '', '## 👥 Участники', '', partBlock, ''] : []),
    ].join('\n');

    await fs.writeFile(path.join(modDir, `${mod}.md`), mainContent, 'utf-8');
    console.log(`[fill-module] ${mod}.md updated`);

    // ── Generate location cards (single AI call for all cards at once) ──────────
    // Step 1: extract location names from scenario text via regex — no AI call.
    // Step 2: if names found, one AI call returns all cards as JSON.
    const locSource = req.body?.locSource || null;
    const locModel  = req.body?.locModel  || null;
    const createdLocations = [];
    try {
      const locNames = _extractLocNamesFromScenario(scenarioText);

      if (locNames.length > 0) {
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

        const allCardsPrompt = `Создай карточки локаций для Vampire: The Masquerade V20, Париж 2010.

Правила оформления (кратко):
${portretRules.slice(0, 900)}

Контекст модуля: ${modTitle}
Сценарий (выдержка): ${scenarioText.slice(0, 350)}

Создай карточки для КАЖДОЙ из ${locNames.length} локаций ниже.
Верни СТРОГО JSON-массив без лишнего текста вне JSON:
[{"name":"<название>","content":"<полная карточка markdown>"},...]

Шаблон каждой карточки:
${cardTemplate('«название»')}

Локации:
${locNames.map((n, i) => `${i + 1}. «${n}»`).join('\n')}

Язык: русский. Стиль: готический нуар VtM.`;

        let allLocsRaw = '';
        if (locGen?.source === 'openrouter') {
          const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3000' },
            body: JSON.stringify({ model: locGen.model, max_tokens: locNames.length * 800 + 200, messages: [{ role: 'user', content: allCardsPrompt }] }),
          });
          const d = await r.json();
          allLocsRaw = d.choices?.[0]?.message?.content || '';
        } else if (locGen?.client) {
          const m = await locGen.client.messages.create({
            model: 'claude-haiku-4-5-20251001', max_tokens: locNames.length * 800 + 200,
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
            await fs.writeFile(locFile, content.trim() + '\n', 'utf-8');
            createdLocations.push(name);
            console.log(`[fill-module] location created: ${name}`);
          }));
        }
      }
    } catch (locErr) {
      console.warn('[fill-module] location generation failed:', locErr.message);
    }

    res.json({ ok: true, file: `chronicles/${chr}/modules/${mod}/scenario.md`, locations: createdLocations });
  } catch (e) {
    console.error('[fill-module]', e.message);
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
          await fs.writeFile(fp, cleaned, 'utf-8');
          cleanedChars.push(`${ch.name}/${f}`);
        }
      }
    }

    // 4. Remove event block referencing this module from chronicle events.md
    const evPath = path.join(chroniclesDir(city), chr, 'events.md');
    const evTxt  = await fs.readFile(evPath, 'utf-8').catch(() => null);
    if (evTxt) {
      // Remove the `> 🔗 [Модуль](...mod...)` line from events
      const cleaned = evTxt.split('\n').filter(l => !(l.includes('🔗') && l.includes(`modules/${mod}/`))).join('\n');
      if (cleaned !== evTxt) await fs.writeFile(evPath, cleaned, 'utf-8');
    }

    // 5. Delete module directory
    await rmdir(modDir);
    await syncChronicleModuleLinks(city, chr);
    console.log(`[delete-module] ${city}/${chr}/modules/${mod} | cleaned: ${cleanedChars.join(', ') || '—'}`);

    delete _cache[city];
    res.json({ ok: true, mod, cleanedChars, episodicSlugs });
  } catch (e) {
    console.error('[delete-module]', e.message);
    res.status(500).json({ error: e.message });
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/threads', async (req, res) => {
  try {
    res.json(await readThreadsStructured(reqCity(req)));
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    await fs.writeFile(abs, lines.join('\n'), 'utf-8');
    res.json({ ok: true, id: nextId });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    await fs.writeFile(abs, lines.join('\n'), 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
        const fm = mc.match(new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|\\n]+)\\|`));
        if (fm) result[key] = fm[1].trim();
      }

      // Description: text between last --- and first ## section (or end)
      const descM = mc.match(/---\s*\n([\s\S]+?)(?=\n##|\s*$)/);
      if (descM) result.description = descM[1].trim();

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

    // 4. Chronicle events (all events for the chronicle)
    const evRaw = await fs.readFile(path.join(chroniclesDir(city), chr, 'events.md'), 'utf-8').catch(() => '');
    if (evRaw) {
      const ec = evRaw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      ec.split(/\n(?=###\s*📅)/).filter(c => /^###\s*📅/.test(c.trim())).forEach(c => {
        const ev = parseEvent(c.trim(), result.events.length);
        ev.chronicle = chr;
        result.events.push(ev);
      });
    }

    // 5. Open threads (chronicle-level first, then city archive)
    result.openThreads = await fs.readFile(path.join(chroniclesDir(city), chr, 'open_threads.md'), 'utf-8').catch(() => null)
      ?? await fs.readFile(path.join(cityDir(city), 'archive', 'open_threads.md'), 'utf-8').catch(() => '');

    // 6. Extract locations from scenario content (- **Name** — description pattern)
    if (result.scenario) {
      const locSec = result.scenario.match(/###?[^#\n]*[Лл]окаци[яи][^\n]*\n([\s\S]+?)(?=\n###|\n---|\s*$)/);
      if (locSec) {
        for (const m of locSec[1].matchAll(/[-*]\s+\*\*([^*]+)\*\*\s*[—–]\s*([^\n]+)/g))
          result.locations.push({ name: m[1].trim(), description: m[2].trim() });
      }
    }

    res.json(result);
  } catch (e) {
    console.error('[module-detail]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/characters/:name/diary', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const file = req.query.file;
    if (!file) return res.status(400).json({ error: 'file param required' });

    const city  = reqCity(req);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const charDir  = path.resolve(charsDir(city), char.lineageFolder, char.slug);
    const filePath = path.resolve(charDir, file);
    if (!filePath.startsWith(charDir + path.sep) && filePath !== charDir)
      return res.status(403).json({ error: 'Forbidden' });

    const content = await fs.readFile(filePath, 'utf-8');
    res.json(parseDiary(content));
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  await fs.writeFile(cardPath, card, 'utf-8');
}

// Create or append a diary entry (journal/<period>.md), then link it from the card.
app.put('/api/characters/:name/diary', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const name = decodeURIComponent(req.params.name);
    const { period, session = '', text = '', mode = 'append' } = req.body || {};
    const per = String(period || '').trim();
    if (!/^(\d{4}-\d{2}|retrospective)$/.test(per)) return res.status(400).json({ error: 'Период: ГГГГ-ММ или retrospective' });
    if (!String(text).trim()) return res.status(400).json({ error: 'Пустой текст записи' });

    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const jdir = path.join(charsDir(city), char.lineageFolder, char.slug, 'journal');
    await fs.mkdir(jdir, { recursive: true });
    const file = path.join(jdir, `${per}.md`);

    const title   = String(session).trim() || periodLabel(per);
    const indented = String(text).trim().split('\n').map(l => l.trim() ? '  ' + l : '').join('\n');
    const section  = `### 📅 ${title}\n\n- **👤 Автор:** ${char.name}\n\n- **📖 Текст записи:**\n\n${indented}\n`;

    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    const out = (existing === null || mode === 'create')
      ? `# 📖 Дневник ${char.name} — ${periodLabel(per)}\n\n---\n\n${section}`
      : existing.replace(/\s*$/, '') + `\n\n---\n\n${section}`;
    await fs.writeFile(file, out, 'utf-8');

    await ensureDiaryLink(city, char, per, periodLabel(per));
    delete _cache[city];
    res.json({ ok: true, file: `journal/${per}.md` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AI-generate diary prose for a character + period (not saved — returned for review).
app.post('/api/characters/:name/diary/generate', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const name = decodeURIComponent(req.params.name);
    const { period = '', session = '', hint = '', orModel = null, preferSource = null } = req.body || {};

    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const gen = await makeGenerationClient(preferSource, orModel);

    const diaryRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'diary_rules.md'), 'utf-8').catch(() => '');
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

# ПРАВИЛА ДНЕВНИКОВ
${diaryRules.slice(0, 4000)}

# КАРТОЧКА ПЕРСОНАЖА (голос, характер, факты)
${card.slice(0, 3000)}

# СОБЫТИЯ ХРОНИКИ (ИСТОЧНИК ФАКТОВ — не выдумывай вне этого)
${eventsText.slice(0, 8000) || '(не найдены)'}`;

    const userPrompt = `Напиши дневниковую запись персонажа «${char.name}» за период ${periodTxt}${session ? ` (${session})` : ''}.
${hint ? `Акцент/пожелание: ${hint}\n` : ''}Требования:
- От первого лица, голосом персонажа (см. карточку).
- Только факты из событий хроники; канон не выдумывай.
- Лаконично и литературно, по правилам diary_rules.md.
- Верни ТОЛЬКО текст записи (без заголовков и markdown-полей).`;

    let text = '';
    if (gen.source === 'openrouter') {
      const models = [gen.model, ...OR_FALLBACK_MODELS.filter(m => m !== gen.model)];
      let lastErr;
      for (const m of models) {
        try { text = await callOpenRouter(m, systemPrompt, userPrompt, []); if (m !== gen.model) console.log(`[diary-gen] fallback model: ${m}`); break; }
        catch (e) {
          lastErr = e;
          const retry = e.status === 404 || e.status === 429 || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message));
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

app.get('/api/locations', async (req, res) => {
  try { res.json(await getAllLocations(reqCity(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/locations/:slug/images', async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug);
    const city = reqCity(req);
    const locs = await getAllLocations(city);
    const loc  = locs.find(l => l.slug === slug);
    if (!loc) return res.status(404).json({ error: 'not found' });
    res.json({ images: loc.imageUrls || (loc.imageUrl ? [loc.imageUrl] : []) });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

    await fs.writeFile(mdPath, card, 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

    await fs.writeFile(path.join(artDir, filename), Buffer.from(base64, 'base64'));

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
      await fs.writeFile(mdPath, card, 'utf-8');
    }

    const locRoot  = locsDir(city);
    const relParts = path.relative(locRoot, locFolder).split(path.sep);
    const url = `/city-img/${city}/locations/` + relParts.map(p => encodeURIComponent(p)).join('/') + '/art/' + encodeURIComponent(filename);
    res.json({ success: true, filename, url });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Raw markdown archive docs — rendered client-side with the lore renderer.
const archiveDoc = file => async (req, res) => {
  try {
    const content = await fs.readFile(path.join(archiveDir(reqCity(req)), file), 'utf-8').catch(() => null);
    res.json({ exists: content !== null, content: content || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT — write archive docs back to disk
const _writeArchiveDoc = (file) => async (req, res) => {
  try {
    const city    = reqCity(req);
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const dir = archiveDir(city);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, file), content, 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    await fs.writeFile(path.join(dir, file), content, 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// C4 — V20 character sheet (<slug>-sheet.md next to the card)
app.get('/api/characters/:name/sheet', async (req, res) => {
  try {
    const city  = reqCity(req);
    const name  = decodeURIComponent(req.params.name);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
    const file = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}-sheet.md`);
    const content = await fs.readFile(file, 'utf-8').catch(() => null);
    res.json({ exists: content !== null, content: content || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
};

app.put('/api/characters/:name/fields', express.json(), async (req, res) => {
  try {
    const name   = decodeURIComponent(req.params.name);
    const city   = reqCity(req);
    const fields = req.body.fields || {};

    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
    let card = await fs.readFile(cardPath, 'utf-8');

    for (const [key, rawValue] of Object.entries(fields)) {
      // H1 display name — preserves emoji prefix
      if (key === 'name') {
        const newName = String(rawValue).replace(/\n+/g, ' ').trim();
        if (!newName) continue;
        card = card.replace(
          /^(#\s+[^\wЀ-ӿ]*)([\wЀ-ӿ].+)$/m,
          (_, prefix) => `${prefix}${newName}`
        );
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

      const mdKey = EDITABLE_FIELD_MAP[key];
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

    await fs.writeFile(cardPath, card, 'utf-8');
    delete _cache[city];
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Update relations block ─────────────────────────────────────────────────────

app.put('/api/characters/:name/relations', express.json(), async (req, res) => {
  try {
    const name   = decodeURIComponent(req.params.name);
    const city   = reqCity(req);
    const lines  = req.body.lines || []; // array of strings "Имя — описание"

    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
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

    await fs.writeFile(cardPath, card, 'utf-8');
    delete _cache[city];
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Generation client factory ─────────────────────────────────────────────────
// Priority: OpenRouter (.env) → ANTHROPIC_API_KEY → Claude.ai OAuth

const CLAUDE_CREDS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude', '.credentials.json'
);
const VALID_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];

// preferSource: 'openrouter' | 'claude' | null (auto)
async function makeGenerationClient(preferSource = null, modelOverride = null) {
  const wantOR     = preferSource === 'openrouter';
  const wantClaude = preferSource === 'claude';

  const orModel = () => modelOverride || process.env.OPENROUTER_MODEL || 'openrouter/free';
  const clModel = () => modelOverride || 'claude-opus-4-8';

  // ── OpenRouter ────────────────────────────────────────────────
  if ((wantOR || (!wantClaude && !preferSource)) && process.env.OPENROUTER_API_KEY) {
    return { source: 'openrouter', model: orModel() };
  }

  // ── Anthropic API key ─────────────────────────────────────────
  if (!wantOR && process.env.ANTHROPIC_API_KEY) {
    return { source: 'api-key', client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), model: clModel() };
  }

  // ── Claude.ai OAuth (Claude Code login) ──────────────────────
  if (!wantOR) {
    try {
      const oauth = await _readOauthCached();
      if (oauth?.accessToken) {
        if (oauth.expiresAt && Date.now() >= oauth.expiresAt) {
          _oauthCredsCacheAt = 0; // invalidate so next call re-reads
          throw new Error('Claude.ai OAuth токен истёк. Выполни любую команду в Claude Code.');
        }
        return { source: 'claude-login', client: new Anthropic({ authToken: oauth.accessToken }), model: clModel() };
      }
    } catch (e) {
      if (e.message.includes('истёк')) throw e;
    }
  }

  // ── Fallback: try OpenRouter even if prefer=claude but nothing else works ──
  if (!wantClaude && process.env.OPENROUTER_API_KEY) {
    return { source: 'openrouter', model: orModel() };
  }

  throw new Error(
    'Нет источника для генерации. Варианты:\n' +
    '• web/.env: OPENROUTER_API_KEY=sk-or-...\n' +
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

async function callOpenRouter(model, systemPrompt, userPrompt, imageBuffers, timeoutMs = 75000) {
  const content = [
    ...imageBuffers.map(({ buf, mime }) => ({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${buf.toString('base64')}` },
    })),
    { type: 'text', text: userPrompt },
  ];

  const body = JSON.stringify({
    model,
    max_tokens: 1500,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content },
    ],
  });

  // Abort the request if the model never responds, so callers don't hang forever.
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'http://localhost:3000',
        'X-Title':       'VTM Chronicle Manager',
      },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error(`Модель «${model}» не ответила за ${Math.round(timeoutMs / 1000)}с`), { status: 504 });
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw Object.assign(new Error(errText || resp.statusText), { status: resp.status });
  }

  const data  = await resp.json();
  const msg   = data.choices?.[0]?.message;
  // Some reasoning models return content: null — fall back to reasoning text
  const text  = (msg?.content || msg?.reasoning || '').trim();
  if (!text) {
    // Image-generation models return images[], not text
    if (msg?.images?.length) {
      throw new Error(`Модель «${data.model}» — генератор изображений, а не текста. Выберите другую модель в настройках ИИ.`);
    }
    throw new Error('OpenRouter вернул пустой ответ от модели «' + data.model + '»');
  }
  return text;
}

// ── Auth status endpoint ──────────────────────────────────────────────────────

app.get('/api/auth-status', async (req, res) => {
  try {
    // OpenRouter
    if (process.env.OPENROUTER_API_KEY) {
      return res.json({
        source: 'openrouter',
        ok:     true,
        model:  process.env.OPENROUTER_MODEL || 'openrouter/free',
      });
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
    res.status(500).json({ error: e.message });
  }
});

// ── Generate appearance from art images via Vision API ────────────────────────

app.post('/api/characters/:name/generate-appearance', express.json(), async (req, res) => {
  try {
    const preferSource = req.body?.preferSource || null;
    const orModel      = req.body?.orModel      || null;
    const gen = await makeGenerationClient(preferSource, orModel);

    const name = decodeURIComponent(req.params.name);
    const city = reqCity(req);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const artDir = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
    const files  = await fs.readdir(artDir).catch(() => []);
    const imgs   = files.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f)).sort();
    if (!imgs.length) return res.status(400).json({ error: 'Нет изображений в папке art/ персонажа' });

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

    const systemPrompt = 'Ты — редактор персонажных карточек для настольной RPG Vampire: The Masquerade.';
    const userPrompt   = `Перед тобой ${imageBuffers.length > 1 ? `${imageBuffers.length} изображения` : 'изображение'} ${lineageName} по имени ${char.name}.\n\nОпиши внешность для карточки. Требования:\n- 3–5 конкретных визуальных маркеров (лицо, волосы, кожа, глаза, одежда, характерные детали)\n- Стиль: лаконичный, образный, готический. Без «воды».\n- Язык: русский.\n- Формат: один абзац, без списков и заголовков.\n- Упомяни всё необычное, характерное, запоминающееся.\n- Запрет: не упоминать кровь, раны, увечья, явные признаки насилия — даже если они видны на изображении.`;

    let appearance = '';

    if (gen.source === 'openrouter') {
      // Try primary model, then fallbacks if endpoint not found
      const modelsToTry = [gen.model, ...OR_FALLBACK_MODELS.filter(m => m !== gen.model)];
      let lastErr;
      let allRateLimited = true;
      for (const m of modelsToTry) {
        try {
          appearance = await callOpenRouter(m, systemPrompt, userPrompt, imageBuffers);
          if (m !== gen.model) console.log(`[generate-appearance] fallback model used: ${m}`);
          allRateLimited = false;
          break;
        } catch (e) {
          lastErr = e;
          const is429 = e.status === 429;
          const retryable = e.status === 404 || is429
            || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message));
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

// ── List all art images for a character ───────────────────────────────────────

app.get('/api/characters/:name/images', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const city = reqCity(req);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
    if (!char) return res.status(404).json({ error: 'not found' });

    const artDir = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
    const files  = await fs.readdir(artDir).catch(() => []);
    const images = files
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .sort()
      .map(f => `/city-img/${city}/characters/${char.lineageFolder}/${encodeURIComponent(char.slug)}/art/${encodeURIComponent(f)}`);

    res.json({ images });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Upload portrait image ─────────────────────────────────────────────────────

app.post('/api/characters/:name/upload-image', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const { base64, ext = 'jpg' } = req.body;
    const name = decodeURIComponent(req.params.name);

    const city  = reqCity(req);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
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

    await fs.writeFile(path.join(artDir, filename), Buffer.from(base64, 'base64'));

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
      await fs.writeFile(cardPath, card, 'utf-8');
    }

    delete _cache[city];
    res.json({
      success: true,
      filename,
      url: `/city-img/${city}/characters/${char.lineageFolder}/${encodeURIComponent(char.slug)}/art/${encodeURIComponent(filename)}`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete character image ────────────────────────────────────────────────────

app.delete('/api/characters/:name/images/:filename', async (req, res) => {
  try {
    const name     = decodeURIComponent(req.params.name);
    const filename = decodeURIComponent(req.params.filename);
    const city     = reqCity(req);

    if (/[/\\]|^\./.test(filename)) {
      return res.status(400).json({ error: 'Недопустимое имя файла' });
    }

    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const artDir  = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
    const filePath = path.resolve(artDir, filename);
    if (!filePath.startsWith(path.resolve(artDir))) {
      return res.status(400).json({ error: 'Недопустимый путь' });
    }

    await fs.unlink(filePath);

    // Remove line referencing this file from ## 🖼️ Изображения
    const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
    let card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
    if (card) {
      const lines = card.split('\n').filter(l => !l.includes(`art/${filename}`));
      card = lines.join('\n');
      // If section empty — add placeholder
      card = card.replace(
        /(## 🖼️ Изображения\n)(\s*\n)((?!- ))/,
        '$1\n- ⏳ Изображение не предоставлено\n$3'
      );
      await fs.writeFile(cardPath, card, 'utf-8');
    }

    delete _cache[city];
    res.json({ ok: true, filename });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Файл не найден' });
    res.status(500).json({ error: e.message });
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
function _extractLocNamesFromScenario(text, max = 5) {
  // Primary: find a "Локации" section, collect its ### sub-headers
  const secM = text.match(/(?:^|\n)#{1,3}[^#\n]*Локации[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s+(?:\d+\.\s+)?(?:НПС|Завязка|Кульминация|Финал|Варианты|Открытые)|$)/i);
  if (secM) {
    const names = [...secM[1].matchAll(/^#{2,4}\s+(.+)$/gm)]
      .map(m => m[1].replace(/[*_[\]🏛📍⚠💀🔴🟡🟢✦—]/g, '').trim())
      .filter(n => n.length >= 4 && n.length <= 100 && !/^(нпс|завязка|кульм|финал|open|нить)/i.test(n));
    if (names.length > 0) return names.slice(0, max);
  }
  // Fallback: bold bullet items under any mention of "Локации"
  const boldM = text.match(/Локации[^\n]*\n([\s\S]{0,1500}?)(?=\n##|$)/i);
  if (boldM) {
    const names = [...boldM[1].matchAll(/^\s*[-*•]?\s*\*\*([^*]{4,80})\*\*/gm)]
      .map(m => m[1].trim());
    if (names.length > 0) return names.slice(0, max);
  }
  return [];
}

// RU→ASCII slug for new module/chronicle folder names
const _SLUG_TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function slugify(s) {
  return String(s).toLowerCase().split('').map(c => _SLUG_TR[c] !== undefined ? _SLUG_TR[c] : c).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
}
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
    `- **Роль:** ⚠️ Требуется уточнение\n- **Принадлежность:** Создатель НПС\n- **Биография:** ⚠️ Требуется уточнение\n- **Внешность:** ⚠️ Требуется уточнение\n\n---\n\n` +
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
      await fs.writeFile(abs, text, 'utf-8');
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
  // 1. diary_rules.md
  const diaryRules = await fs.readFile(
    path.join(ROOT, 'system', 'rules', 'diary_rules.md'), 'utf-8').catch(() => '');

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
    if (card) charCards.push(`### Карточка: ${ch.name}\n${card.slice(0, 3000)}`);
  }

  // 4. Read chronicle events
  const eventsChunks = [];
  for (const evRel of eventsFilesNeeded) {
    const evTxt = await fs.readFile(path.join(ROOT, evRel), 'utf-8').catch(() => null);
    if (evTxt) eventsChunks.push(`### ${evRel}\n${evTxt.slice(0, 6000)}`);
  }

  return { diaryRules, stubContents, charCards, eventsChunks };
}

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

    const { diaryRules, stubContents, charCards, eventsChunks } = await buildProseContext(city, valid);

    const systemPrompt = `Ты — Рассказчик Vampire: The Masquerade V20. Пишешь литературные дневниковые записи персонажей строго по правилам ниже.

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

    // Use makeGenerationClient for OpenRouter
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({ ok: false, error: 'OPENROUTER_API_KEY не задан. Настрой в Инструменты → Модели AI.' });
    }

    const model = proseModel || process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';

    const orResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'http://localhost:3000',
        'X-Title':       'VTM Chronicle Manager',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
      }),
    });

    if (!orResp.ok) {
      const err = await orResp.text().catch(() => '');
      return res.status(orResp.status).json({ ok: false, error: err || orResp.statusText });
    }

    const orData = await orResp.json();
    const text   = orData.choices?.[0]?.message?.content?.trim() || '';
    if (!text) return res.status(500).json({ ok: false, error: 'OpenRouter вернул пустой ответ.' });

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
        await fs.writeFile(abs, content + '\n', 'utf-8');
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
    res.json({
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ? '***' : '',
      OPENROUTER_MODEL:   env.OPENROUTER_MODEL   || '',
      hasKey:             !!env.OPENROUTER_API_KEY,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings', express.json(), async (req, res) => {
  try {
    const { OPENROUTER_API_KEY, OPENROUTER_MODEL } = req.body || {};

    // Read current .env
    const raw = await fs.readFile(ENV_PATH, 'utf-8').catch(() => '');
    const lines = raw.split('\n').filter(l => l.trim() !== '');
    const env = {};
    for (const l of lines) { const m = l.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim(); }

    // Update only provided fields (empty string = remove)
    if (OPENROUTER_API_KEY !== undefined && OPENROUTER_API_KEY !== '***') {
      if (OPENROUTER_API_KEY.trim()) env.OPENROUTER_API_KEY = OPENROUTER_API_KEY.trim();
      else delete env.OPENROUTER_API_KEY;
    }
    if (OPENROUTER_MODEL !== undefined) {
      if (OPENROUTER_MODEL.trim()) env.OPENROUTER_MODEL = OPENROUTER_MODEL.trim();
      else delete env.OPENROUTER_MODEL;
    }

    const newContent = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    await fs.writeFile(ENV_PATH, newContent, 'utf-8');

    const needsRestart = req.body?.restart !== false;
    res.json({ ok: true, needsRestart });
    if (needsRestart) scheduleRestart('[settings]');
  } catch (e) {
    console.error('[settings]', e.message);
    res.status(500).json({ error: e.message });
  }
});

const RESTART_CODE = 75; // wrapper.js watches for this exit code to restart

function scheduleRestart(tag = '[restart]', delayMs = 300) {
  console.log(`${tag} Перезапуск (exit ${RESTART_CODE})...`);
  setTimeout(() => process.exit(RESTART_CODE), delayMs);
}

app.post('/api/restart', (req, res) => {
  res.json({ ok: true, message: 'Перезапуск...' });
  scheduleRestart('[restart]');
});

app.listen(PORT, () => {
  console.log(`\n  \u{1F9DB} VTM Chronicle Manager`);
  console.log(`  ───────────────────────`);
  console.log(`  http://localhost:${PORT}\n`);
  // Run initial validation on startup
  runValidationBackground();
});
