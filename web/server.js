const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const crypto  = require('crypto');
const { spawn } = require('child_process');

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
    if (k === 'Иерархия в городе' || k === 'Иерархия города' || k === 'Парижская иерархия') c.hierarchy = v;
    if (k === 'Деранжементы / Особенности')     c.derangements  = v;
    if (k === 'Дисциплины')                     c.disciplines   = v;
    if (k === 'Профессия')                      c.profession    = v;
    if (k === 'Клан / Раса' && !c.clan)         c.clan          = v;
    if (k === 'Род' && !c.clan)                 c.clan          = v;
    if (k === 'Секта / Двор' && !c.sect)        c.sect          = v;
    if (k === 'Фригольд / Локация' && !c.location) c.location  = v;
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

  // Multi-line image prompt block
  const promptM = content.match(/- \*\*[^*]*Промт для генерации[^*]*\*\*[^\n]*\n((?:[ \t]+[^\n]+\n?)+)/);
  if (promptM) c.imagePrompt = promptM[1].replace(/^[ \t]+/gm, '').trim();

  const negM = content.match(/- \*\*[^*]*Негативный промт[^*]*\*\*[^\n]*\n((?:[ \t]+[^\n]+\n?)+)/);
  if (negM) c.negativePrompt = negM[1].replace(/^[ \t]+/gm, '').trim();

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

        // Images live in <slug>/art/. Prefer portrait.* (web upload), else first image.
        const artFiles = await fs.readdir(path.join(charDir, 'art')).catch(() => []);
        const PORTRAIT = ['portrait.jpg','portrait.jpeg','portrait.png','portrait.webp','portrait.gif'];
        const imgFile  = PORTRAIT.find(p => artFiles.includes(p))
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

  const imgPM = content.match(/\*\*GPT[^*]*\*\*:\n```[^\n]*\n([\s\S]+?)\n```/);
  if (imgPM) loc.imagePrompt = imgPM[1].trim();

  const negPM = content.match(/\*\*Негативный промт[^*]*\*\*:\n```[^\n]*\n([\s\S]+?)\n```/);
  if (negPM) loc.negativePrompt = negPM[1].trim();

  return loc;
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
          const files     = await fs.readdir(locFolder).catch(() => []);
          const imgFile   = files.find(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
          if (imgFile) {
            const relParts = path.relative(locRoot, locFolder).split(path.sep);
            loc.imageUrl = `/city-img/${city}/locations/` + relParts.map(p => encodeURIComponent(p)).join('/') + '/' + encodeURIComponent(imgFile);
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
  let chrs; try { chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true }); } catch { return ''; }
  let all = '';
  for (const ch of chrs) {
    if (!ch.isDirectory()) continue;
    const raw = await fs.readFile(path.join(chroniclesDir(city), ch.name, 'open_threads.md'), 'utf-8').catch(() => null);
    if (raw) all += '\n' + raw;
  }
  return all;
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
    const out = [];
    let chrs; try { chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true }); } catch { chrs = []; }
    for (const ch of chrs) {
      if (!ch.isDirectory()) continue;
      let display = ch.name;
      const raw = await fs.readFile(path.join(chroniclesDir(city), ch.name, 'events.md'), 'utf-8').catch(() => null);
      if (raw) { const m = raw.replace(/^﻿/, '').match(/^#\s+(.+?)\s+—\s+События/m); if (m) display = m[1].replace(/^[^\p{L}\p{N}]+/u, '').trim(); }
      out.push({ slug: ch.name, display });
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const content = await readOpenThreadsRaw(reqCity(req));
    const threads = [];
    for (const line of content.split('\n')) {
      const m = line.match(/^\|\s*(\d+)\s*\|\s*\*\*([^*]+)\*\*(.*?)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
      if (!m) continue;
      const sc = m[5].trim();
      threads.push({
        id:          parseInt(m[1]),
        title:       m[2].trim(),
        description: m[3].replace(/^[\s—\-]+/, '').trim(),
        source:      m[4].trim(),
        status:      sc.includes('🔴') ? 'active' : sc.includes('🟡') ? 'background' : sc.includes('🟢') ? 'closed' : 'unknown',
        priority:    m[6].replace(/\|?\s*$/, '').trim()
      });
    }
    res.json(threads);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

app.get('/api/locations', async (req, res) => {
  try { res.json(await getAllLocations(reqCity(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
      // Only real markdown hrefs with an actual folder segment: ](lineage/Folder/…)
      const re = /\]\((?:characters\/)?(vampires|fairies|mortals|werewolves|mages|hunters)\/([^/)]+)\/[^)]*\)/g;
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
const FILE_MUTATING_TOOLS = new Set(['new_npc', 'new_module', 'new_city']);

// ── Run a Node CLI tool (cities/-aware) ────────────────────────────────────────
// Args are passed as an array to spawn() WITHOUT a shell → no injection risk.
const NODE_TOOLS = new Set(['new_city', 'new_npc', 'migrate_char', 'close_chronicle', 'build_city_events']);
app.post('/api/tool/:name', async (req, res) => {
  const name = req.params.name;
  if (!NODE_TOOLS.has(name)) return res.status(400).json({ ok: false, output: 'Unknown tool' });
  const args = (Array.isArray(req.body.args) ? req.body.args : []).map(a => String(a)).filter(a => a.length);
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
  const allowed = ['new_city','new_npc','new_module','validate_links','status','search'];
  if (!allowed.includes(tool)) return res.status(400).json({ error: 'Unknown tool' });

  const script = path.join(ROOT, 'tools', `${tool}.ps1`);

  // -Force skips interactive Read-Host / ReadKey for all interactive tools
  const forceFlag = ['new_city', 'new_npc', 'new_module', 'validate_links'].includes(tool)
    ? '-Force' : '';

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

// ── Upload portrait image ─────────────────────────────────────────────────────

app.post('/api/characters/:name/upload-image', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const { base64, ext = 'jpg' } = req.body;
    const name = decodeURIComponent(req.params.name);

    const city  = reqCity(req);
    const chars = await getAllCharacters(city);
    const char  = chars.find(c => c.name === name);
    if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

    const artDir   = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
    await fs.mkdir(artDir, { recursive: true });
    const safeExt  = (ext || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
    const filename = `portrait.${safeExt}`;

    // Remove previous portrait.* files to avoid stale copies
    const existing = await fs.readdir(artDir).catch(() => []);
    for (const f of existing) {
      if (/^portrait\.(jpg|jpeg|png|webp|gif)$/i.test(f)) {
        await fs.unlink(path.join(artDir, f)).catch(() => {});
      }
    }

    await fs.writeFile(path.join(artDir, filename), Buffer.from(base64, 'base64'));
    delete _cache[city];

    res.json({
      success: true,
      url: `/city-img/${city}/characters/${char.lineageFolder}/${encodeURIComponent(char.slug)}/art/${filename}`
    });
  } catch (e) {
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

  // resolve participants
  const chars = await getAllCharacters(city);
  const resolve = makeNameResolver(chars.map(c => c.name));
  const byName = Object.fromEntries(chars.map(c => [c.name, c]));
  const parts = [];
  for (const inp of (p.participants || [])) {
    const rid = resolve(inp.name);
    if (!rid) { errors.push(`Участник «${inp.name}» не сопоставлен с карточкой — создайте НПС сначала.`); continue; }
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
  let sent = false;
  const done = body => { if (!sent) { sent = true; res.json(body); } };
  const ps = spawn('claude --version', { shell: true });
  let out = '';
  const timer = setTimeout(() => { ps.kill(); done({ available: false }); }, 8000);
  ps.stdout.on('data', d => out += d.toString('utf8'));
  ps.on('error', () => { clearTimeout(timer); done({ available: false }); });
  ps.on('close', code => { clearTimeout(timer); done({ available: code === 0, version: out.trim(), defaultModel: DEFAULT_CLAUDE_MODEL || null }); });
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

app.listen(PORT, () => {
  console.log(`\n  \u{1F9DB} VTM Chronicle Manager`);
  console.log(`  ───────────────────────`);
  console.log(`  http://localhost:${PORT}\n`);
  // Run initial validation on startup
  runValidationBackground();
});
