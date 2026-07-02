const express = require('express');
const compression = require('compression');
const path    = require('path');
const fs      = require('fs').promises;
const crypto  = require('crypto');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');
const {
  RU_MONTHS_NOM, slugify, readPrompt, writePrompt,
  buildCityMd, parseCityMd, cityScaffold,
  mdExtractLinks, mdStripLinks, mdStripInline, classifyChronicleLink,
  categorizeRel, parseCharacter, parseLocation, parseChronicleLocation,
  parseParticipant, parseTable, parseWorldState,
} = require('./lib/parsers');
const { parseDisciplineMd } = require('./lib/disciplines');
const { parsePsychicMd } = require('./lib/psychics');
const { runMigrations } = require('./lib/migrations');
const { loadDiaryStyleRules, compressEventsToState, compressChronicleEvents, parseEventsText, buildNarrativeContext, findCharacterCard } = require('./lib/context_builder');
const {
  CITIES_DIR, DEFAULT_CITY, cityDir, charsDir, locsDir, chroniclesDir, archiveDir,
  reqCity, listCities, writeFileAtomic, invalidateChars, invalidateLocs,
  getAllCharacters, findLocMdPath, listModules,
  countMdFiles, readOpenThreadsRaw,
  EDITABLE_FIELD_MAP,
  RU_MONTH_STEMS, aggregateEvents, renderChronicleEventsSkeleton, renderOpenThreadsSkeleton,
} = require('./lib/db');

const { C, serverError, aiRateLimit } = require('./lib/http');
const { router: libraryRouter, loadDisciplines, loadPsychics } = require('./routes/library');
const { router: citiesRouter } = require('./routes/cities');
const { router: archiveRouter } = require('./routes/archive');
const { router: threadsRouter } = require('./routes/threads');
const locationsRouterFactory = require('./routes/locations');
const charactersRouterFactory = require('./routes/characters');
const chroniclesRouterFactory = require('./routes/chronicles');
const modulesRouterFactory = require('./routes/modules');
const generationRouterFactory = require('./routes/generation');
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
  'PUT /api/chronicles/:chr/modules/:mod/fields': req => `✏  Редактирование полей модуля: ${req.params.mod} (${req.params.chr})`,
  'PUT /api/chronicles/:chr/modules/:mod/scenario': req => `📝 Сценарий модуля: ${req.params.mod} (${req.params.chr})`,
  'POST /api/chronicles/:chr/modules/:mod/npc': req => `👤 Добавление НПС в модуль: ${req.params.mod} (${req.params.chr})`,
  'GET /api/chronicles/:chr/modules/:mod/delete-preview': req => `🗑 Превью удаления модуля: ${req.params.mod} (${req.params.chr})`,
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


// ── Доменные роутеры (routes/*.js) ────────────────────────────────────────────
app.use(libraryRouter);
app.use(citiesRouter);
app.use(archiveRouter);
app.use(threadsRouter);
app.use(locationsRouterFactory({
  makeGenerationClient: (...a) => makeGenerationClient(...a),
  isOA:   g => _isOA(g),
  oaCall: g => _oaCall(g),
}));
app.use(charactersRouterFactory({
  runValidationBackground: () => runValidationBackground(),
  makeGenerationClient: (...a) => makeGenerationClient(...a),
  isOA:      g => _isOA(g),
  oaCall:    g => _oaCall(g),
  oaModels:  g => _oaModels(g),
  genTextWithRetry: (...a) => genTextWithRetry(...a),
  generateV20Sheet: (...a) => _generateV20Sheet(...a),
  ensureSheetLink:  (...a) => _ensureSheetLink(...a),
}));
app.use(chroniclesRouterFactory({
  makeGenerationClient: (...a) => makeGenerationClient(...a),
  isOA:      g => _isOA(g),
  oaCall:    g => _oaCall(g),
  oaModels:  g => _oaModels(g),
  validModels: () => VALID_MODELS,
  runValidationBackground: () => runValidationBackground(),
}));
app.use(modulesRouterFactory({
  makeGenerationClient: (...a) => makeGenerationClient(...a),
  isOA:   g => _isOA(g),
  oaCall: g => _oaCall(g),
  generateV20Sheet: (...a) => _generateV20Sheet(...a),
  ensureSheetLink:  (...a) => _ensureSheetLink(...a),
}));
app.use(generationRouterFactory({
  makeGenerationClient: (...a) => makeGenerationClient(...a),
  isOA:      g => _isOA(g),
  oaCall:    g => _oaCall(g),
  oaModels:  g => _oaModels(g),
  validModels: () => VALID_MODELS,
  callOpenAI:     (...a) => callOpenAI(...a),
  callOpenRouter: (...a) => callOpenRouter(...a),
  runClaude:      (...a) => runClaude(...a),
  defaultClaudeModel: () => DEFAULT_CLAUDE_MODEL,
}));

// ── Markdown / card / chronicle parsers ───────────────────────────────────────
// categorizeRel, parseCharacter, parseLocation, parseChronicle* and the md* helpers
// now live in lib/parsers.js (single source of truth — see import at top).



// parseDiary lives in lib/parsers.js (single source of truth — see import above)

// parseLocation lives in lib/parsers.js (single source of truth — see import at top).


// ── Chronicle parser (Stories_of_*.md) ────────────────────────────────────────




// readOpenThreadsRaw теперь в lib/db.js; readThreadsStructured/resolveThreadFile — в routes/threads.js.

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
  } catch (e) { serverError(res, e); }
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
















// /api/threads (GET/POST/PATCH) — в routes/threads.js.



// /api/characters/:slug/diary (GET/DELETE/PUT), /diary/generate, /:id/dialogue,
// /sheet (GET/PUT), /sheet/generate, /sheet-data (GET/PUT) — все в routes/characters.js.
// Хелперы дневника (ensureDiaryLink/upsertDiaryLink/removeDiaryLink) переехали туда же.

// ── V20 sheet generation / save (canonical chars + episodic module NPCs) ──────
// _generateV20Sheet/_ensureSheetLink остаются здесь (не в routes/characters.js) —
// используются также modules.js (НПС модулей) через DI при монтировании.

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

// /api/characters/:slug/sheet/generate (POST), /sheet (PUT), /sheet-data (GET/PUT)
// — все в routes/characters.js (используют _generateV20Sheet/_ensureSheetLink выше через DI).


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

// canon-check (AI) moved to routes/generation.js (E1.2)

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
    if (code === 0) { invalidateChars(); runValidationBackground(); }
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
      invalidateChars();
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

// charInfoLines/charRelationshipLines/INFO_KEYS_FOR_PROMPT moved to routes/generation.js (E1.2)

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

// AI-генерация внешности/промта/характера/биографии персонажа (generate-appearance/-prompt/-personality/-biography) moved to routes/generation.js (E1.2)
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


// slug generation lives in lib/parsers.js (single source of truth — see import above)

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
    invalidateChars(plan.summary.city);

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

// buildProseContext, /api/director/propose, /api/openrouter/generate-prose,
// /api/claude/generate-prose, /api/openrouter/models moved to routes/generation.js (E1.2)

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
