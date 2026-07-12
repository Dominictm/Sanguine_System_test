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
  CITIES_DIR, AUDIO_DIR, reqCity, writeFileAtomic, setBrokenLinks,
} = require('./lib/db');

const { C, serverError, aiRateLimit } = require('./lib/http');
const { router: libraryRouter, loadDisciplines, loadPsychics } = require('./routes/library');
const { router: audioRouter } = require('./routes/audio');
const { router: citiesRouter } = require('./routes/cities');
const { router: archiveRouter } = require('./routes/archive');
const { router: threadsRouter } = require('./routes/threads');
const locationsRouterFactory = require('./routes/locations');
const charactersRouterFactory = require('./routes/characters');
const chroniclesRouterFactory = require('./routes/chronicles');
const modulesRouterFactory = require('./routes/modules');
const generationRouterFactory = require('./routes/generation');
const { router: dashboardRouter } = require('./routes/dashboard');
const toolsRouterFactory = require('./routes/tools');
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
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4295;
const ROOT = path.join(__dirname, '..');




// Broken-link count (null = never validated; 0 = clean; N = N broken links
// remaining) теперь живёт в lib/db.js (getBrokenLinks/setBrokenLinks) — общее
// состояние с routes/dashboard.js и routes/tools.js (E1.2d).

app.use(compression());
// /api/audio needs a higher body-size limit than the rest of the app (base64
// inflates a 20MB audio file to ~27MB) — this MUST be registered before the
// general express.json below. body-parser sets req._body once it parses a
// request, and every later json() middleware silently no-ops on re-entry —
// so if the general 20mb parser ran first for this path, it would already
// reject any oversized /api/audio upload before this route-specific limit is
// ever consulted.
app.use('/api/audio', express.json({ limit: '30mb' }));
app.use(express.json({ limit: '20mb' }));
// maxAge lets the browser reuse the heavy app shell between loads; ETag/Last-Modified
// still revalidate after it expires, so edits during development surface within minutes.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
// Serve images straight out of cities/<city>/… (characters/<lin>/<slug>/art/, locations/…)
app.use('/city-img', express.static(CITIES_DIR, { maxAge: '1h' }));
// Serve uploaded soundboard audio files straight out of cities/audio/ (routes/audio.js).
app.use('/audio-lib', express.static(AUDIO_DIR, { maxAge: '1h' }));


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

    // Раньше 2xx-запросы без записи в ACTION_MAP молчали вообще — не было
    // видно, какой эндпойнт реально вызывался, если для него не завели
    // человекочитаемое описание. Теперь логируется КАЖДЫЙ /api/*-вызов:
    // с описанием, если оно есть в ACTION_MAP, иначе — метод + путь как есть.
    const label = action || `${C.dim}${req.path}${C.reset}`;
    console.log(`${C.dim}[web]${C.reset} ${methodStr} ${codeStr} ${timeStr}  ${label}`);
  });

  next();
});


// ── Доменные роутеры (routes/*.js) ────────────────────────────────────────────
app.use(libraryRouter);
app.use(audioRouter);
app.use(citiesRouter);
app.use(archiveRouter);
app.use(threadsRouter);
app.use(locationsRouterFactory({
  makeGenerationClient: (...a) => makeGenerationClient(...a),
  genTextWithRetry: (...a) => genTextWithRetry(...a),
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
  runValidationBackground: () => runValidationBackground(),
  genTextWithRetry: (...a) => genTextWithRetry(...a),
}));
app.use(modulesRouterFactory({
  makeGenerationClient: (...a) => makeGenerationClient(...a),
  isOA:   g => _isOA(g),
  oaCall: g => _oaCall(g),
  generateV20Sheet: (...a) => _generateV20Sheet(...a),
  ensureSheetLink:  (...a) => _ensureSheetLink(...a),
  genTextWithRetry: (...a) => genTextWithRetry(...a),
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
  genTextWithRetry: (...a) => genTextWithRetry(...a),
}));
app.use(dashboardRouter);
app.use(toolsRouterFactory({
  runValidationBackground: () => runValidationBackground(),
  readOauthCached:    (...a) => _readOauthCached(...a),
  refreshClaudeOauth: (...a) => _refreshClaudeOauth(...a),
  writeClaudeOauth:   (...a) => _writeClaudeOauth(...a),
  claudeOauthConfig:  () => CLAUDE_OAUTH,
  claudeCredsPath:    () => CLAUDE_CREDS_PATH,
  invalidateGeminiClient: () => { _geminiClient = null; },
  scheduleRestart: (...a) => scheduleRestart(...a),
  isSupervised:    () => SUPERVISED,
  envPath:         () => ENV_PATH,
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

// makeNameResolver/getDiaryIndex/eventMonthKey теперь в lib/db.js (используются
// routes/dashboard.js и routes/tools.js — E1.2d).

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
  ps.on('close', code => { setBrokenLinks(code); });
}

// canon-check (AI) moved to routes/generation.js (E1.2)

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
          throw Object.assign(new Error('Claude.ai OAuth токен истёк. Войди заново (Инструменты → Модели AI) или выполни команду в Claude Code.'), { status: 401 });
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

  throw Object.assign(new Error(
    'Нет источника для генерации. Варианты:\n' +
    '• web/.env: GEMINI_API_KEY=...\n' +
    '• web/.env: OPENROUTER_API_KEY=sk-or-...\n' +
    '• web/.env: OPENAI_API_KEY=sk-...\n' +
    '• ANTHROPIC_API_KEY в переменных окружения\n' +
    '• Запусти Claude Code для OAuth-авторизации'
  ), { status: 503 });
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
      'HTTP-Referer':  'http://localhost:4295',
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
async function genTextWithRetry(gen, { system, user, maxTokens = 900, fallbackOR = true, model = null }) {
  const useModel = model || gen.model;
  if (gen.source === 'gemini') {
    const text = await generateGeminiText(system, user, { model: useModel, maxTokens });
    return { text, source: 'gemini', model: useModel };
  }
  if (_isOA(gen)) {
    return { text: await _oaCall(gen)(useModel, system, user, [], 75000, maxTokens), source: gen.source, model: useModel };
  }
  const delays = [1000, 3000, 6000];
  for (let attempt = 0; ; attempt++) {
    try {
      const m = await gen.client.messages.create({
        model: useModel, max_tokens: maxTokens, system,
        messages: [{ role: 'user', content: user }],
      });
      return { text: m.content[0]?.text?.trim() || '', source: gen.source, model: useModel };
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

// /api/auth-status moved to routes/tools.js (E1.2d).

// ── Claude Code OAuth login (subscription token, no API key) ───────────────────
// Same PKCE flow Claude Code CLI uses: build an authorize URL, user logs in and
// pastes the returned code, we exchange it for a token and write .credentials.json.
// CLAUDE_OAUTH/_writeClaudeOauth/_refreshClaudeOauth stay here (used by
// makeGenerationClient below); the OAuth routes themselves (start/exchange/refresh/
// status) + _pkcePair/_oauthPending/_oauthInfo live in routes/tools.js (DI'd back
// via claudeOauthConfig/writeClaudeOauth/refreshClaudeOauth/readOauthCached).
const CLAUDE_OAUTH = {
  clientId:     '9d1c250a-e61b-44d9-88ed-5944d1962f5e', // Claude Code public client
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl:     'https://console.anthropic.com/v1/oauth/token',
  redirectUri:  'https://console.anthropic.com/oauth/code/callback',
  scope:        'org:create_api_key user:profile user:inference',
};

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

// _oauthInfo + /api/claude/oauth/start,exchange,refresh,status moved to routes/tools.js (E1.2d).
// AI-генерация внешности/промта/характера/биографии персонажа (generate-appearance/-prompt/-personality/-biography) moved to routes/generation.js (E1.2)
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

// /api/claude/health moved to routes/tools.js (E1.2d) — own local health cache there.

// buildProseContext, /api/director/propose, /api/openrouter/generate-prose,
// /api/claude/generate-prose, /api/openrouter/models moved to routes/generation.js (E1.2)

// Cache Claude OAuth credentials read (60 s) — avoids disk I/O on every AI call
let _oauthCredsCache = null;
let _oauthCredsCacheAt = 0;
const OAUTH_CREDS_TTL = 60_000;
// force=true bypasses the cache (used by /api/claude/status's «Обновить статус»
// button, DI'd from routes/tools.js — was inline `_oauthCredsCacheAt = 0` there).
async function _readOauthCached(force = false) {
  if (force) _oauthCredsCacheAt = 0;
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

// GET/POST /api/settings moved to routes/tools.js (E1.2d) — envPath/readOauthCached/
// invalidateGeminiClient/scheduleRestart/isSupervised come back via DI.

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
