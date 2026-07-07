// ═══════════════════════════════════════════════════════════════
// City (multi-city) — transparent ?city= on every /api/ call
// ═══════════════════════════════════════════════════════════════
let CITY = new URLSearchParams(location.search).get('city') || '';
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.startsWith('/api/') && !/[?&]city=/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'city=' + encodeURIComponent(CITY);
    }
    return _fetch(url, opts);
  };
})();
async function initCitySwitch() {
  const sel = document.getElementById('city-select');
  if (!sel) return;
  try {
    const { cities = [], default: def } = await fetch('/api/cities').then(r => r.json());
    const list = cities.length ? cities : (def ? [def] : []);
    // If the active city isn't set/available, go to the server default (or first city).
    const urlCity = new URLSearchParams(location.search).get('city');
    if (!urlCity && list.length && !list.includes(CITY)) {
      location.search = 'city=' + encodeURIComponent(list.includes(def) ? def : list[0]); return;
    }
    sel.innerHTML = list.map(c => `<option value="${c}"${c === CITY ? ' selected' : ''}>${c}</option>`).join('');
    sel.onchange = () => { location.search = 'city=' + encodeURIComponent(sel.value); };
  } catch {}
}
document.addEventListener('DOMContentLoaded', initCitySwitch);

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const LINEAGE_ICONS = {
  vampire: '🧛', fairy: '🧚', mortal: '🧑',
  werewolf: '🐺', mage: '🔮', hunter: '🏹', unknown: '👤'
};

const STATUS_LABELS = {
  active: 'Жив / Жива', torpor: 'Торпор', dead: 'Мёртв / Мертва', missing: 'Пропал', unknown: 'Неизвестно'
};
const LINEAGE_LABELS = {
  vampire: '🧛 Вампир', fairy: '🧚 Фея', mortal: '🧑 Смертный',
  werewolf: '🐺 Оборотень', mage: '🔮 Маг', hunter: '🏹 Охотник'
};

// Акцентный цвет клана для тонировки фона модалки персонажа (openCharDetail).
// Подбор по мотивам цветокодировки клановых глав V20-корбука — не каноничен,
// чисто оформительское решение.
const CLAN_COLORS = {
  'Асамиты':              '#b3001b',
  'Бруха':                '#c2410c',
  'Вентру':                '#2c5aa0',
  'Гэнгрел':               '#8a6d3b',
  'Джованни':              '#3d2b4f',
  'Ласомбра':              '#2b1f4a',
  'Малкавиан':             '#6a3d9a',
  'Носферату':             '#4a5d3a',
  'Равнос':                '#d2691e',
  'Последователи Сета':    '#a67c00',
  'Тореадор':              '#b5476b',
  'Тремер':                '#5b2a6e',
  'Тзимище':               '#7a1f2b',
  // Кровные линии
  'Баали':                 '#4a0e0e',
  'Дочери Какофонии':      '#4a6a7a',
  'Каппадокийцы':          '#5a5a52',
  'Нагараджа':             '#8a4a1e',
  'Салубри':               '#3a6a8a',
  'Самеди':                '#3a1f3a',
  'Серпанты Света':        '#6a7a1e',
};

// REL_COLORS/REL_LABELS/NODE_COLORS/MOCK_GRAPH moved to public/graph.js (E2.2).

// Standard relation types offered in the «Отношения» editor (datalist)
const REL_TYPE_OPTIONS = ['Семья', 'Сир/Чайлд', 'Союзник', 'Враг', 'Преданность', 'Нейтральный', 'Знакомый', 'Тайная связь'];

// V20 generation range (3rd = eldest/Methuselah-tier down to 14th = thin-blooded), offered
// as a dropdown wherever generation is entered/edited — keeps the value numeric and in-canon.
const VAMPIRE_GENERATIONS = ['14-е', '13-е', '12-е', '11-е', '10-е', '9-е', '8-е', '7-е', '6-е', '5-е', '4-е', '3-е'];

// ═══════════════════════════════════════════════════════════════
// State & routing
// ═══════════════════════════════════════════════════════════════

const STATE = {
  page: 'dashboard',
  characters: [],
  filter: { lineage: 'all', status: 'all', search: '' },
  graph: { data: null, svg: null, zoom: null, sim: null, nodes: null, links: null, inited: false },
  selectedNode: null,
  locations: [],
  locFilter: { zone: 'all', masq: 'all', district: 'all', search: '' },
};

function navigate(page) {
  STATE.page = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    const on = el.dataset.page === page;
    el.classList.toggle('active', on);
    if (on) el.setAttribute('aria-current', 'page');
    else    el.removeAttribute('aria-current');
  });
  document.querySelectorAll('.page').forEach(el =>
    el.classList.toggle('active', el.id === `page-${page}`));

  if (page === 'dashboard')  loadDashboard();
  if (page === 'chronicle')  loadChronicle();
  if (page === 'characters') loadCharacters();
  if (page === 'graph')      loadGraph();
  if (page === 'chronicles-page') loadChroniclesPage();
  if (page === 'modules')         loadModules();
  if (page === 'module')          loadModulePage();
  if (page === 'threads')    loadThreads();
  if (page === 'locations')  loadLocations();
  if (page === 'library')    loadLibrary();
  if (page === 'factions')   loadFactions();
  if (page === 'rumors')     loadRumors();
  if (page === 'search')     loadSearch();
  if (page === 'tools')      loadCitiesGrid();
}

document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', () => navigate(el.dataset.page));
  // These are <a> without href / clickable elements — make them keyboard-operable.
  if (!el.hasAttribute('href')) {
    if (!el.hasAttribute('role'))     el.setAttribute('role', 'link');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        navigate(el.dataset.page);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

async function loadDashboard() {
  const el = document.getElementById('dash-content');
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    const stats = await fetch('/api/status').then(r => r.json());
    document.getElementById('domain-label').innerHTML = `<span>${stats.domain || 'Домен'}</span>`;
    renderDashboard(stats, el);
    loadIntegrity();
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Сервер недоступен</div>';
  }
}

function animateValue(el, target, dur = 900) {
  let start = null;
  const step = ts => {
    if (!start) start = ts;
    const p = Math.min((ts - start) / dur, 1);
    el.textContent = Math.round(p * p * target);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderDashboard(s, container) {
  // Broken links badge
  const blCount = s.brokenLinks;
  const blBadge = blCount === null || blCount === undefined
    ? `<span class="badge-integrity neutral">⚠ Не проверено</span>`
    : blCount === 0
      ? `<span class="badge-integrity ok">✓ Ссылки OK</span>`
      : `<span class="badge-integrity err">${blCount} битых ссылок</span>`;

  const LINEAGES = [
    { key: 'vampires',   label: 'Вампиры',   sub: 'вампиров',   color: 'var(--accent)'     },
    { key: 'fairies',    label: 'Феи',        sub: 'фей',        color: 'var(--c-fairy)'    },
    { key: 'mortals',    label: 'Смертные',   sub: 'смертных',   color: 'var(--text3)'      },
    { key: 'werewolves', label: 'Оборотни',   sub: 'оборотней',  color: 'var(--c-werewolf)' },
    { key: 'mages',      label: 'Маги',       sub: 'магов',      color: 'var(--c-mage)'     },
    { key: 'hunters',    label: 'Охотники',   sub: 'охотников',  color: 'var(--c-hunter)'   },
  ];

  const activeLineages = LINEAGES.filter(l => (s[l.key] || 0) > 0);

  const lineageCards = activeLineages.map(l => `
      <div class="stat-card">
        <div class="stat-label">${l.label}</div>
        <div class="stat-value" id="sv-${l.key}" style="color:${l.color}">0</div>
      </div>`).join('');

  container.innerHTML = `
    <div class="stats-grid">
      ${lineageCards}
      <div class="stat-card">
        <div class="stat-label">Модули</div>
        <div class="stat-value gold" id="sv-modules">0</div>
        <div class="stat-detail">сессии хроники</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Локации</div>
        <div class="stat-value" id="sv-locations">0</div>
        <div class="stat-detail">карточек мест</div>
      </div>
      <div class="stat-card stat-clickable" data-nav="chronicle">
        <div class="stat-label">События</div>
        <div class="stat-value gold" id="sv-events">0</div>
        <div class="stat-detail">записей хроники →</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Открытые нити</div>
        <div class="stat-value accent" id="sv-threads">0</div>
        <div class="stat-detail">требуют разрешения</div>
      </div>
    </div>
    <div class="substats">
      <div class="substat">
        <div class="substat-dot" style="background:var(--c-success)"></div>
        <span>${s.active || 0} активных</span>
      </div>
      <div class="substat">
        <div class="substat-dot" style="background:var(--c-lore)"></div>
        <span>${s.torpor || 0} в торпоре</span>
      </div>
    </div>
    <div class="integrity-row">${blBadge}</div>
    <div id="integrity-panel" class="integrity-panel"></div>`;

  activeLineages.forEach((l, i) => {
    const el = document.getElementById(`sv-${l.key}`);
    if (el) animateValue(el, s[l.key], 900 + i * 80);
  });
  animateValue(document.getElementById('sv-modules'), s.modules || 0);
  animateValue(document.getElementById('sv-locations'), s.locations || 0);
  animateValue(document.getElementById('sv-events'), s.events || 0, 1100);
  animateValue(document.getElementById('sv-threads'), s.openThreads || 0, 1200);
}

// Click on "Настройки моделей" link in dashboard → go to AI tab
document.addEventListener('click', e => {
  const link = e.target.closest('[data-nav][data-tab]');
  if (!link) return;
  const page = link.dataset.nav;
  const tab  = link.dataset.tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  // Activate the sub-tab
  if (tab) {
    document.querySelectorAll(`#page-${page} .tab-btn`).forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll(`#page-${page} .tab-panel`).forEach(p =>
      p.classList.toggle('active', p.id === `tab-${tab}`));
    if (tab === 'ai-settings') loadAiSettings();
    if (tab === 'new-city')    loadCitiesGrid();
  }
});

// ── Integrity panel ────────────────────────────────────────────
async function loadIntegrity() {
  const el = document.getElementById('integrity-panel');
  if (!el) return;
  el.innerHTML = '<div class="ip-loading">🛡 Проверка целостности…</div>';
  let data;
  try { data = await fetch('/api/integrity').then(r => r.json()); }
  catch { el.innerHTML = ''; return; }
  if (!data || data.error) { el.innerHTML = ''; return; }
  renderIntegrity(data, el);
}

function renderIntegrity(data, el) {
  const dot = sev => `<span class="ip-dot ip-${sev}"></span>`;
  const blState = data.brokenLinks == null ? 'neutral' : data.brokenLinks === 0 ? 'ok' : 'err';
  const blCount = data.brokenLinks == null ? '—' : data.brokenLinks;

  const total = (data.totalIssues || 0) + (data.brokenLinks > 0 ? data.brokenLinks : 0);

  // Broken-links pseudo-check (no expandable list — details live in Tools→Проверка)
  let rows = `
    <div class="ip-check">
      <div class="ip-check-head">
        ${dot(blState)}<span class="ip-label">Битые ссылки</span>
        <span class="ip-count ${data.brokenLinks > 0 ? 'has' : ''}">${blCount}</span>
      </div>
    </div>`;

  for (const c of (data.checks || [])) {
    const n = c.items.length;
    const sev = n === 0 ? 'ok' : c.severity;
    const shown = c.items.slice(0, 40);
    const more = n - shown.length;
    rows += `
      <div class="ip-check">
        <div class="ip-check-head ${n > 0 ? 'ip-expandable' : ''}" data-check="${c.id}">
          ${dot(sev)}<span class="ip-label">${escHtml(c.label)}</span>
          <span class="ip-count ${n > 0 ? 'has' : ''}">${n}</span>
          ${n > 0 ? '<span class="ip-chevron">▾</span>' : ''}
        </div>
        ${n > 0 ? `<div class="ip-items" data-items="${c.id}" hidden>
          <div class="ip-hint">${escHtml(c.hint)}</div>
          ${shown.map(i => `<div class="ip-item">${escHtml(i)}</div>`).join('')}
          ${more > 0 ? `<div class="ip-more">…и ещё ${more}</div>` : ''}
        </div>` : ''}
      </div>`;
  }

  el.innerHTML = `
    <div class="ip-header">
      <span class="ip-title">🛡 Целостность данных</span>
      <span class="ip-summary ${total === 0 ? 'ip-clean' : ''}">${total === 0 ? '✓ Чисто' : total + ' замечаний'}</span>
    </div>
    ${rows}
    <div class="ip-canon">
      <div class="ip-canon-title">🔍 Проверка непротиворечий канону</div>
      <textarea id="ip-canon-text" class="ip-canon-text" rows="3" placeholder="Вставь текст сцены или события — ИИ сверит со статусами НПС, датами и «мёртвыми» в сцене"></textarea>
      <button id="ip-canon-btn" class="ip-canon-btn">🔍 Проверить</button>
      <div id="ip-canon-result" class="canon-result" style="display:none"></div>
    </div>`;
}

// Clickable dashboard stat cards → navigate; integrity rows → expand
document.getElementById('dash-content').addEventListener('click', e => {
  const card = e.target.closest('.stat-clickable[data-nav]');
  if (card) { navigate(card.dataset.nav); return; }

  if (e.target.closest('#ip-canon-btn')) {
    _runCanonCheck(document.getElementById('ip-canon-text')?.value || '',
      document.getElementById('ip-canon-result'),
      document.getElementById('ip-canon-btn'), '🔍 Проверить');
    return;
  }

  const head = e.target.closest('.ip-check-head.ip-expandable');
  if (head) {
    const items = document.querySelector(`.ip-items[data-items="${head.dataset.check}"]`);
    const chev = head.querySelector('.ip-chevron');
    if (items) {
      const opening = items.hasAttribute('hidden');
      items.toggleAttribute('hidden', !opening);
      if (chev) chev.textContent = opening ? '▴' : '▾';
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// Characters
// ═══════════════════════════════════════════════════════════════

async function loadCharacters() {
  if (STATE.characters.length) { renderChars(); _injectGridDims(); return; }
  document.getElementById('chars-grid').innerHTML =
    '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    const data = await fetch('/api/characters').then(r => r.json());
    STATE.characters = Array.isArray(data) ? data : [];
    renderChars();
    initGridCarousels();
  } catch {
    document.getElementById('chars-grid').innerHTML =
      '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить персонажей</div>';
  }
}

function renderChars() {
  const { lineage, status, search } = STATE.filter;
  let list = STATE.characters;
  if (lineage !== 'all') list = list.filter(c => c.lineage === lineage);
  if (status  !== 'all') list = list.filter(c => c.statusType === status);
  if (search)            list = list.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  document.getElementById('chars-count-label').textContent = `${list.length} персонажей`;

  const grid = document.getElementById('chars-grid');
  if (!list.length) {
    grid.innerHTML = '<div class="loading-state" style="height:100px">Персонажи не найдены</div>';
    return;
  }

  grid.innerHTML = list.map((c, i) => {
    const icon   = LINEAGE_ICONS[c.lineage] || '👤';
    const stType = c.statusType || 'unknown';
    const stLbl  = statusLabel(c);
    const linBadge = `<span class="badge badge-${c.lineage}">${LINEAGE_LABELS[c.lineage] || c.lineage}</span>`;
    const stBadge  = stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : '';
    const stRow    = stBadge ? `<div class="char-status-row">${stBadge}</div>` : '';
    const textBlock = `
      <div class="char-name">${escHtml(c.name)}</div>
      <div class="char-clan">${c.lineage === 'mortal' ? '' : escHtml(c.clan || c.lineageLabel || '—')}</div>
      <div class="char-badges">${linBadge}</div>`;
    const delay = `style="animation-delay:${Math.min(i, 12) * 30}ms"`;

    if (c.imageUrl) {
      return `<div class="char-card has-art" data-name="${escHtml(c.name)}" ${delay}>
        <img class="char-card-art" src="${c.imageUrl}" alt="${escHtml(c.name)}" loading="lazy" decoding="async">
        <div class="char-card-overlay">${textBlock}</div>
        ${stRow}
      </div>`;
    }
    return `<div class="char-card" data-name="${escHtml(c.name)}" ${delay}>
      <span class="char-lineage-icon">${icon}</span>
      ${stRow}
      ${textBlock}
    </div>`;
  }).join('');
}

document.getElementById('search-input').addEventListener('input', e => {
  STATE.filter.search = e.target.value;
  if (STATE.characters.length) { renderChars(); _injectGridDims(); }
});

// ── Grid carousel ─────────────────────────────────────────────────────────────
const GRID_MIN = 12_000;   // мин. интервал между сменами (12 с)
const GRID_MAX = 50_000;   // макс. интервал (50 с)

let _gridImages  = {};   // name → [url, ...]
let _gridIdxs    = {};   // name → current index
let _gridTimers  = {};   // name → pending timeoutID

function _clearGridTimers() {
  for (const id of Object.values(_gridTimers)) clearTimeout(id);
  _gridTimers = {};
}

function _scheduleCard(name) {
  const delay = GRID_MIN + Math.floor(Math.random() * (GRID_MAX - GRID_MIN));
  _gridTimers[name] = setTimeout(() => _advanceCard(name), delay);
}

async function initGridCarousels() {
  _clearGridTimers();
  _gridImages = {};
  _gridIdxs   = {};

  const qs   = window.location.search;
  const resp = await fetch('/api/characters/all-images' + qs).catch(() => null);
  if (!resp?.ok) return;
  _gridImages = await resp.json().catch(() => ({}));

  for (const name of Object.keys(_gridImages)) _gridIdxs[name] = 0;

  _injectGridDims();

  // Каждая карточка стартует в свой случайный момент, независимо
  for (const name of Object.keys(_gridImages)) {
    if ((_gridImages[name]?.length || 0) < 2) continue;
    const initDelay = Math.floor(Math.random() * GRID_MAX);
    _gridTimers[name] = setTimeout(() => _advanceCard(name), initDelay);
  }
}

function _injectGridDims() {
  for (const name of Object.keys(_gridImages)) {
    const card = document.querySelector(`.char-card[data-name="${CSS.escape(name)}"]`);
    if (!card || card.querySelector('.char-card-dim')) continue;
    const dim = document.createElement('div');
    dim.className = 'char-card-dim';
    card.insertBefore(dim, card.firstChild);
  }
}

function _advanceCard(name) {
  const images = _gridImages[name];
  if (!images || images.length < 2) return;
  const card = document.querySelector(`.char-card[data-name="${CSS.escape(name)}"]`);
  if (!card) return;
  const img = card.querySelector('.char-card-art');
  const dim = card.querySelector('.char-card-dim');
  if (!img || !dim) return;

  dim.classList.add('dark');
  setTimeout(() => {
    let next;
    do { next = Math.floor(Math.random() * images.length); } while (next === _gridIdxs[name]);
    _gridIdxs[name] = next;
    img.src = images[next];
    setTimeout(() => {
      dim.classList.remove('dark');
      _scheduleCard(name); // следующий интервал — снова случайный
    }, 300);
  }, 2100);
}

document.getElementById('filter-lineage').addEventListener('change', e => {
  STATE.filter.lineage = e.target.value;
  if (STATE.characters.length) { renderChars(); _injectGridDims(); }
});

document.getElementById('filter-status').addEventListener('change', e => {
  STATE.filter.status = e.target.value;
  if (STATE.characters.length) { renderChars(); _injectGridDims(); }
});

// Relationship Graph (loadGraph, renderGraph, showInfoPanel, etc.) moved to
// public/graph.js (E2.2).

// ═══════════════════════════════════════════════════════════════
// Tools
// ═══════════════════════════════════════════════════════════════

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    if (tab === 'ai-settings')     loadAiSettings();
    if (tab === 'new-city')        loadCitiesGrid();
    if (tab === 'lib-disciplines') loadLibrary();
    if (tab === 'lib-psychics')    loadPsychicsLibrary();
  });
});

// ═══════════════════════════════════════════════════════════════
// AI Models Settings tab
// ═══════════════════════════════════════════════════════════════

// Fallback if /api/openrouter/models is unavailable
const OR_FREE_MODELS_FALLBACK = [
  { id: 'google/gemma-4-26b-a4b-it:free',   label: 'Google Gemma 4 26B (Vision)' },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free', label: 'Nvidia Nemotron Nano 12B VL' },
  { id: 'moonshotai/kimi-k2.6:free',         label: 'Moonshot Kimi K2.6' },
  { id: 'openrouter/free',                   label: 'Free Models Router' },
];
// Keep OR_FREE_MODELS alias for other usages
const OR_FREE_MODELS = OR_FREE_MODELS_FALLBACK;

// Per-feature curated model lists (fallback when live fetch fails)
const OR_FEAT_MODELS_FALLBACK = {
  // Vision-capable models — для анализа изображений персонажей
  appearance: [
    { id: 'meta-llama/llama-3.2-11b-vision-instruct:free', label: 'Llama 3.2 11B Vision' },
    { id: 'qwen/qwen2.5-vl-7b-instruct:free',             label: 'Qwen 2.5 VL 7B (Vision)' },
    { id: 'google/gemma-3-27b-it:free',                   label: 'Google Gemma 3 27B' },
    { id: 'microsoft/phi-4-multimodal-instruct:free',     label: 'Microsoft Phi-4 Multimodal' },
    { id: 'openrouter/free',                              label: 'Free Models Router' },
  ],
  // Strong instruction-following models — для структурированных карточек локаций
  locations: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-chat:free',            label: 'DeepSeek Chat' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'mistralai/mistral-7b-instruct:free',     label: 'Mistral 7B Instruct' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Creative/narrative models — для дневников и финалов сессии
  prose: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1 (Reasoning)' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Conversational/character models — для реплик НПС в характере
  dialogue: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'mistralai/mistral-7b-instruct:free',     label: 'Mistral 7B Instruct' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Strong instruction-following models — для англоязычного промта по описанию внешности
  prompt: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-chat:free',            label: 'DeepSeek Chat' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Conversational/character models — для характера и голоса по внешности и биографии
  personality: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'deepseek/deepseek-chat:free',            label: 'DeepSeek Chat' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Creative/narrative models — для биографии по информации/отношениям персонажа
  biography: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1 (Reasoning)' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Strong instruction-following models — для числового V20-листа по карточке персонажа
  sheet: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1 (Reasoning)' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
};

// Build per-feature model lists. Every feature gets ALL free models reported live by
// the API, with «openrouter/free» pinned to the top so it's always available. The
// curated OR_FEAT_MODELS_FALLBACK is used only when the live fetch failed (offline).
function _buildFeatOrModels(liveModels) {
  if (!liveModels?.length) return { ...OR_FEAT_MODELS_FALLBACK };
  const rest = liveModels.filter(m => m.id !== 'openrouter/free');
  const free = liveModels.find(m => m.id === 'openrouter/free') || { id: 'openrouter/free', label: 'Free Models Router' };
  const all  = [free, ...rest];                       // openrouter/free first, then every free model
  const result = {};
  for (const feat of Object.keys(OR_FEAT_MODELS_FALLBACK)) result[feat] = all;
  return result;
}
const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8',           label: 'Claude Opus 4.8 — лучшее качество' },
  { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 — сбалансированно' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — быстро' },
];
const OPENAI_MODELS = [
  { id: 'gpt-4o-mini',  label: 'GPT-4o mini — быстро и дёшево' },
  { id: 'gpt-4o',       label: 'GPT-4o — сбалансированно (vision)' },
  { id: 'gpt-4.1',      label: 'GPT-4.1 — высокое качество' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
];
const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — быстро и дёшево' },
  { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro — сложная проза' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];
// Resolve a feature's model list by provider.
function _modelsForProvider(provider, orModels) {
  if (provider === 'claude')  return CLAUDE_MODELS;
  if (provider === 'openai')  return OPENAI_MODELS;
  if (provider === 'gemini')  return GEMINI_MODELS;
  return orModels;
}

let _aiSettingsLoaded = false;
let _orModelsRuntime  = null; // cached after first fetch

function _renderFeatCard(feat, icon, label, desc, pref, orModels) {
  const provider = pref.provider || 'openrouter';
  const model    = pref.model;
  const models   = _modelsForProvider(provider, orModels);
  const opts = models.map(m =>
    `<option value="${escHtml(m.id)}" ${model === m.id ? 'selected' : ''}>${escHtml(m.label)}</option>`
  ).join('');
  const radio = (val, lbl) =>
    `<label class="ais-feat-prov-btn">
       <input type="radio" name="feat-${feat}" value="${val}" ${provider === val ? 'checked' : ''}>
       <span>${lbl}</span>
     </label>`;
  return `
    <div class="ais-feat-card" data-feat="${feat}">
      <div class="ais-feat-card-header">
        <span class="ais-feat-icon">${icon}</span>
        <div class="ais-feat-meta">
          <div class="ais-feat-label">${label}</div>
          <div class="ais-feat-desc">${desc}</div>
        </div>
        <div class="ais-feat-card-radios">
          ${radio('openrouter', 'OpenRouter')}
          ${radio('openai', 'GPT')}
          ${radio('claude', 'Claude')}
          ${radio('gemini', 'Gemini')}
        </div>
      </div>
      <select class="ais-feat-model-select" id="feat-${feat}-model">${opts}</select>
    </div>`;
}

// Human-readable Claude auth state for the credentials section.
function _claudeAuthHint(s) {
  const o = s.claudeOauth;
  if (o && !o.expired) {
    const left = o.expiresIn != null ? ` · токен ~${o.expiresIn} мин` : '';
    return `✅ Вход через Claude Code активен (подписка: ${escHtml(o.subscription)}${left}). API-ключ можно не задавать.`;
  }
  if (o && o.expired) return '⚠️ Токен Claude Code истёк — выполни любую команду в Claude Code, либо задай API-ключ ниже.';
  if (s.hasAnthropicKey) return '🔑 Используется ANTHROPIC_API_KEY. Вход через аккаунт — отдельно, в приложении Claude Code (CLI).';
  return 'Claude не авторизован. Войди через Claude Code (CLI) — приложение подхватит вход автоматически — или задай API-ключ ниже.';
}

// Backward-compat helper: prefs[key] may be string (old) or {provider, model} (new)
function _getPref(prefs, key, defProv = 'openrouter') {
  const v = prefs[key];
  if (!v)                     return { provider: defProv, model: null };
  if (typeof v === 'string')  return { provider: v, model: null };
  return { provider: v.provider || defProv, model: v.model || null };
}

async function loadAiSettings() {
  if (_aiSettingsLoaded) return;
  _aiSettingsLoaded = true;
  const el = document.getElementById('ai-settings-content');

  let orSettings = { OPENROUTER_MODEL: '', hasKey: false, hasOpenAIKey: false, hasAnthropicKey: false, claudeOauth: null };
  try { orSettings = await fetch('/api/settings').then(r => r.json()); } catch {}

  // Fetch live OR models list (fallback to hardcoded on failure)
  let orModels = OR_FREE_MODELS_FALLBACK;
  try {
    const md = await fetch('/api/openrouter/models').then(r => r.json());
    if (md.ok && md.models?.length) orModels = md.models;
  } catch {}

  // Per-feature curated lists (reconciled against live data)
  const featOrModels = _buildFeatOrModels(orModels);

  const featPrefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const appearPref   = _getPref(featPrefs, 'appearance', 'openrouter');
  const locPref      = _getPref(featPrefs, 'locations',  'openrouter');
  const prosePref    = _getPref(featPrefs, 'prose',      'claude');
  const dialoguePref = _getPref(featPrefs, 'dialogue',   'openrouter');
  const promptPref   = _getPref(featPrefs, 'prompt',     'openrouter');
  const personalityPref = _getPref(featPrefs, 'personality', 'openrouter');
  const biographyPref   = _getPref(featPrefs, 'biography',   'openrouter');
  const sheetPref    = _getPref(featPrefs, 'sheet',      'claude');

  el.innerHTML = `
    <div class="ais-layout">

    <!-- LEFT COLUMN -->
    <div class="ais-left">

      <!-- Restart section -->
      <div class="ais-section ais-restart-section">
        <div class="ais-section-title">🔄 Управление сервером</div>
        <div class="ais-section-hint">Перезапускает сервер без открытия нового окна браузера. Страница восстановит соединение автоматически.</div>
        <button class="ais-restart-btn" id="ais-restart-btn">⟳ Перезапустить сервер</button>
        <div class="ais-status" id="ais-restart-status"></div>
      </div>

      <!-- OpenRouter section -->
      <div class="ais-section">
        <div class="ais-section-title">🌐 OpenRouter — внешние модели</div>
        <div class="ais-section-hint">Используется для генерации внешности по арту (Vision API). Бесплатные модели — без расходов.</div>

        <div class="ais-field">
          <label class="ais-label">API Key</label>
          <input class="ais-input" id="ais-or-key" type="password"
            placeholder="${orSettings.hasKey ? '•••••• (задан)' : 'sk-or-v1-...'}"
            autocomplete="new-password">
          <div class="ais-field-hint">Оставь пустым — ключ не изменится. Очисти и подтверди — удалить ключ. Модель выбирается в «⚡ Назначение провайдеров».</div>
        </div>

        <button class="ais-confirm-btn" id="ais-or-save">✓ Подтвердить OpenRouter</button>
        <div class="ais-status" id="ais-or-status"></div>
      </div>

      <!-- OpenAI / GPT section -->
      <div class="ais-section">
        <div class="ais-section-title">🤖 OpenAI (GPT) — внешние модели</div>
        <div class="ais-section-hint">Доступ к API только по ключу (вход через аккаунт ChatGPT для API не работает). Модель — в «⚡ Назначение провайдеров».</div>

        <div class="ais-field">
          <label class="ais-label">API Key
            <span class="ais-key-state ${orSettings.hasOpenAIKey ? 'ok' : ''}">${orSettings.hasOpenAIKey ? '● задан' : '○ не задан'}</span>
          </label>
          <input class="ais-input" id="ais-openai-key" type="password"
            placeholder="${orSettings.hasOpenAIKey ? '•••••• (задан)' : 'sk-...'}"
            autocomplete="new-password">
          <div class="ais-field-hint">Оставь пустым — ключ не изменится. Очисти и подтверди — удалить ключ.</div>
        </div>

        <button class="ais-confirm-btn" id="ais-openai-save">✓ Подтвердить OpenAI</button>
        <div class="ais-status" id="ais-openai-status"></div>
      </div>

      <!-- Google Gemini section -->
      <div class="ais-section">
        <div class="ais-section-title">♊ Google Gemini — AI-проза</div>
        <div class="ais-section-hint">Доступ через Google AI Studio API Key. Поддерживает Gemini 2.5 Pro/Flash для генерации прозы и сценариев. Назначается на функции в «⚡ Назначение провайдеров».</div>

        <div class="ais-field">
          <label class="ais-label">API Key
            <span class="ais-key-state ${orSettings.hasGeminiKey ? 'ok' : ''}">${orSettings.hasGeminiKey ? '● задан' : '○ не задан'}</span>
          </label>
          <input class="ais-input" id="ais-gemini-key" type="password"
            placeholder="${orSettings.hasGeminiKey ? '•••••• (задан)' : 'AIza...'}"
            autocomplete="new-password">
          <div class="ais-field-hint">Оставь пустым — ключ не изменится. Очисти и подтверди — удалить ключ.</div>
        </div>

        <div class="ais-field">
          <label class="ais-label">Модель по умолчанию</label>
          <select class="ais-input" id="ais-gemini-model">
            ${GEMINI_MODELS.map(m => `<option value="${escHtml(m.id)}" ${(orSettings.GEMINI_MODEL || 'gemini-2.5-flash') === m.id ? 'selected' : ''}>${escHtml(m.label)}</option>`).join('')}
          </select>
        </div>

        <button class="ais-confirm-btn" id="ais-gemini-save">✓ Подтвердить Gemini</button>
        <div class="ais-status" id="ais-gemini-status"></div>
      </div>

      <!-- Claude / Anthropic section -->
      <div class="ais-section">
        <div class="ais-section-title">🧠 Claude (Anthropic) — авторизация</div>
        <div class="ais-section-hint" id="ais-claude-hint">${_claudeAuthHint(orSettings)}</div>

        <!-- Вариант 1: вход через Claude Code (OAuth, без API-ключа) -->
        <div class="ais-field">
          <label class="ais-label">Вход через Claude Code <span class="ais-key-state">без API-ключа</span></label>
          <div class="ais-claude-btnrow">
            <button class="ais-confirm-btn ais-claude-oauth-btn" id="ais-claude-login">🔓 Войти через Claude Code</button>
            <button class="ais-confirm-btn ais-ghost-btn" id="ais-claude-status">🔄 Обновить статус</button>
            ${orSettings.claudeOauth?.expired && orSettings.claudeOauth?.hasRefresh
              ? '<button class="ais-confirm-btn ais-ghost-btn" id="ais-claude-refresh">♻️ Обновить токен</button>' : ''}
          </div>
          <div class="ais-claude-code-form" id="ais-claude-code-form" style="display:none">
            <input class="ais-input ais-mono" id="ais-claude-code" placeholder="Вставь код авторизации (вида CODE#STATE)">
            <button class="ais-confirm-btn" id="ais-claude-code-submit">✓ Подтвердить код</button>
          </div>
          <div class="ais-field-hint">Кнопка откроет страницу Claude. Авторизуйся под своим аккаунтом, скопируй показанный код и вставь его выше — токен подписки сохранится локально.</div>
          <div class="ais-status" id="ais-claude-oauth-status"></div>
        </div>

        <!-- Вариант 2: API-ключ -->
        <div class="ais-field">
          <label class="ais-label">…или API Key
            <span class="ais-key-state ${orSettings.hasAnthropicKey ? 'ok' : ''}">${orSettings.hasAnthropicKey ? '● задан' : '○ не задан'}</span>
          </label>
          <input class="ais-input" id="ais-anthropic-key" type="password"
            placeholder="${orSettings.hasAnthropicKey ? '•••••• (задан)' : 'sk-ant-...'}"
            autocomplete="new-password">
          <div class="ais-field-hint">Оставь пустым — не изменится; очисти и подтверди — удалить.</div>
        </div>

        <button class="ais-confirm-btn" id="ais-anthropic-save">✓ Подтвердить Claude</button>
        <div class="ais-status" id="ais-anthropic-status"></div>
      </div>

    </div><!-- /ais-left -->

    <!-- RIGHT COLUMN: Features cards -->
    <div class="ais-right">
      <div class="ais-section ais-features-section">
        <div class="ais-section-title">⚡ Назначение провайдеров</div>
        <div class="ais-section-hint">Выбери провайдера и модель для каждой функции.</div>

        <div class="ais-feat-cards" id="ais-feat-cards">
          ${_renderFeatCard('appearance', '👁', 'Внешность по арту',    'Vision-анализ изображений персонажа', appearPref,   featOrModels.appearance)}
          ${_renderFeatCard('locations',  '📍', 'Генерация локаций',    'Карточки мест при наполнении модуля', locPref,      featOrModels.locations)}
          ${_renderFeatCard('prose',      '🪄', 'Генерация прозы',      'Дневники и финалы сессии',            prosePref,    featOrModels.prose)}
          ${_renderFeatCard('dialogue',   '💬', 'Генерация фраз',       'Реплики НПС в характере',             dialoguePref, featOrModels.dialogue)}
          ${_renderFeatCard('prompt',     '🎨', 'Генерация промта',     'Промт для изображения по внешности',  promptPref,   featOrModels.prompt)}
          ${_renderFeatCard('personality', '🎭', 'Характер и голос',    'По внешности и биографии персонажа',  personalityPref, featOrModels.personality)}
          ${_renderFeatCard('biography',  '📖', 'Генерация биографии',  'По информации и отношениям персонажа', biographyPref, featOrModels.biography)}
          ${_renderFeatCard('sheet',      '📋', 'Генерация листа персонажа', 'Числовые данные V20-листа по карточке', sheetPref, featOrModels.sheet)}
        </div>

        <button class="ais-confirm-btn" id="ais-feat-save" style="margin-top:16px">✓ Применить</button>
        <div class="ais-status" id="ais-feat-status"></div>
      </div>
    </div><!-- /ais-right -->

    </div><!-- /ais-layout -->`;

  // Restart server
  document.getElementById('ais-restart-btn').addEventListener('click', async () => {
    const btn    = document.getElementById('ais-restart-btn');
    const status = document.getElementById('ais-restart-status');
    btn.disabled = true;
    status.className = 'ais-status';
    status.textContent = '⏳ Останавливаем сервер...';

    try {
      await fetch('/api/restart', { method: 'POST' }).catch(() => {}); // may fail if server dies mid-request

      status.textContent = '⟳ Ждём перезапуска...';

      // Poll until server responds again (max 20s)
      const start = Date.now();
      let up = false;
      while (Date.now() - start < 20000) {
        await new Promise(r => setTimeout(r, 800));
        try {
          const r = await fetch('/api/auth-status', { cache: 'no-store' });
          if (r.ok) { up = true; break; }
        } catch {}
      }

      if (up) {
        status.textContent = '✓ Сервер запущен';
        status.classList.add('ok');
        _aiSettingsLoaded = false;
        // Reload settings to reflect fresh .env
        setTimeout(loadAiSettings, 300);
      } else {
        status.textContent = '✗ Сервер не отвечает — проверь консоль';
        status.classList.add('err');
      }
    } catch (e) {
      status.textContent = '✗ ' + e.message; status.classList.add('err');
    } finally {
      btn.disabled = false;
    }
  });

  // Save an API key to .env (shared by OpenRouter / OpenAI / Claude sections)
  const _saveKey = async (btnId, statusId, inputId, field, btnLabel) => {
    const btn    = document.getElementById(btnId);
    const status = document.getElementById(statusId);
    const key    = document.getElementById(inputId).value;
    btn.disabled = true; btn.textContent = '⏳ Сохранение...';
    status.className = 'ais-status';
    try {
      const d = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: key })
      }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      status.textContent = d.needsRestart ? '✓ Сохранено — сервер перезапускается...' : '✓ Сохранено';
      status.classList.add('ok');
      _aiSettingsLoaded = false;
      if (d.needsRestart) setTimeout(() => { _aiSettingsLoaded = false; loadAiSettings(); }, 2500);
    } catch (e) {
      status.textContent = '✗ Ошибка: ' + e.message; status.classList.add('err');
    } finally { btn.disabled = false; btn.textContent = btnLabel; }
  };

  document.getElementById('ais-or-save').addEventListener('click',
    () => _saveKey('ais-or-save', 'ais-or-status', 'ais-or-key', 'OPENROUTER_API_KEY', '✓ Подтвердить OpenRouter'));
  document.getElementById('ais-openai-save').addEventListener('click',
    () => _saveKey('ais-openai-save', 'ais-openai-status', 'ais-openai-key', 'OPENAI_API_KEY', '✓ Подтвердить OpenAI'));
  document.getElementById('ais-gemini-save').addEventListener('click', async () => {
    const btn    = document.getElementById('ais-gemini-save');
    const status = document.getElementById('ais-gemini-status');
    const key    = document.getElementById('ais-gemini-key').value;
    const model  = document.getElementById('ais-gemini-model').value;
    btn.disabled = true; btn.textContent = '⏳…';
    status.className = 'ais-status'; status.textContent = '';
    try {
      const body = { restart: true };
      if (key !== '') body.GEMINI_API_KEY = key;
      if (model)       body.GEMINI_MODEL  = model;
      const d = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      status.textContent = d.needsRestart ? '✓ Сохранено — сервер перезапускается...' : '✓ Сохранено';
      status.classList.add('ok');
      _aiSettingsLoaded = false;
      if (d.needsRestart) setTimeout(() => { _aiSettingsLoaded = false; loadAiSettings(); }, 2500);
    } catch (e) {
      status.textContent = '✗ Ошибка: ' + e.message; status.classList.add('err');
    } finally { btn.disabled = false; btn.textContent = '✓ Подтвердить Gemini'; }
  });
  document.getElementById('ais-anthropic-save').addEventListener('click',
    () => _saveKey('ais-anthropic-save', 'ais-anthropic-status', 'ais-anthropic-key', 'ANTHROPIC_API_KEY', '✓ Подтвердить Claude'));

  // Claude Code OAuth login (no API key): open authorize URL, then paste the code
  let _claudeOauthState = null;
  const claudeOauthStatus = document.getElementById('ais-claude-oauth-status');
  document.getElementById('ais-claude-login')?.addEventListener('click', async () => {
    claudeOauthStatus.className = 'ais-status';
    claudeOauthStatus.textContent = '⏳ Готовлю ссылку…';
    try {
      const d = await fetch('/api/claude/oauth/start', { method: 'POST' }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      _claudeOauthState = d.state;
      window.open(d.url, '_blank', 'noopener');
      document.getElementById('ais-claude-code-form').style.display = '';
      document.getElementById('ais-claude-code').focus();
      claudeOauthStatus.textContent = 'Открыл страницу Claude. Авторизуйся → скопируй код → вставь выше и подтверди.';
    } catch (e) { claudeOauthStatus.textContent = '✗ ' + e.message; claudeOauthStatus.classList.add('err'); }
  });
  document.getElementById('ais-claude-code-submit')?.addEventListener('click', async () => {
    const btn  = document.getElementById('ais-claude-code-submit');
    const code = document.getElementById('ais-claude-code').value.trim();
    if (!code) { claudeOauthStatus.className = 'ais-status err'; claudeOauthStatus.textContent = 'Вставь код авторизации.'; return; }
    btn.disabled = true; btn.textContent = '⏳…';
    claudeOauthStatus.className = 'ais-status'; claudeOauthStatus.textContent = '⏳ Обмениваю код на токен…';
    try {
      const d = await fetch('/api/claude/oauth/exchange', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state: _claudeOauthState })
      }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      claudeOauthStatus.textContent = `✓ Вход выполнен (подписка: ${d.claudeOauth?.subscription || '—'}). Обновляю…`;
      claudeOauthStatus.classList.add('ok');
      _aiSettingsLoaded = false; setTimeout(loadAiSettings, 900);
    } catch (e) { claudeOauthStatus.textContent = '✗ ' + e.message; claudeOauthStatus.classList.add('err'); }
    finally { btn.disabled = false; btn.textContent = '✓ Подтвердить код'; }
  });
  document.getElementById('ais-claude-status')?.addEventListener('click', async () => {
    claudeOauthStatus.className = 'ais-status'; claudeOauthStatus.textContent = '⏳ Обновляю статус…';
    try { await fetch('/api/claude/status').then(r => r.json()); _aiSettingsLoaded = false; loadAiSettings(); }
    catch (e) { claudeOauthStatus.textContent = '✗ ' + e.message; claudeOauthStatus.classList.add('err'); }
  });
  document.getElementById('ais-claude-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('ais-claude-refresh');
    btn.disabled = true; btn.textContent = '⏳…';
    claudeOauthStatus.className = 'ais-status'; claudeOauthStatus.textContent = '⏳ Обновляю токен…';
    try {
      const d = await fetch('/api/claude/oauth/refresh', { method: 'POST' }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      claudeOauthStatus.textContent = '✓ Токен обновлён. Обновляю…'; claudeOauthStatus.classList.add('ok');
      _aiSettingsLoaded = false; setTimeout(loadAiSettings, 700);
    } catch (e) { claudeOauthStatus.textContent = '✗ ' + e.message; claudeOauthStatus.classList.add('err'); btn.disabled = false; btn.textContent = '♻️ Обновить токен'; }
  });

  // Features table: save provider preferences
  // Wire radio changes to swap model dropdown options
  el.querySelectorAll('.ais-feat-card').forEach(card => {
    const feat = card.dataset.feat;
    card.querySelectorAll(`input[name="feat-${feat}"]`).forEach(radio => {
      radio.addEventListener('change', () => {
        const sel = document.getElementById(`feat-${feat}-model`);
        if (!sel) return;
        const orList = featOrModels[feat] || OR_FEAT_MODELS_FALLBACK[feat] || OR_FREE_MODELS_FALLBACK;
        const models = _modelsForProvider(radio.value, orList);
        sel.innerHTML = models.map(m =>
          `<option value="${escHtml(m.id)}">${escHtml(m.label)}</option>`
        ).join('');
      });
    });
  });

  document.getElementById('ais-feat-save').addEventListener('click', () => {
    const status = document.getElementById('ais-feat-status');
    const prefs  = {};
    for (const feat of ['appearance', 'locations', 'prose', 'dialogue', 'prompt', 'personality', 'biography', 'sheet']) {
      const provSel = document.querySelector(`input[name="feat-${feat}"]:checked`);
      const modSel  = document.getElementById(`feat-${feat}-model`);
      if (provSel) prefs[feat] = { provider: provSel.value, model: modSel?.value || null };
    }
    localStorage.setItem('ai-feature-prefs', JSON.stringify(prefs));
    status.textContent = '✓ Сохранено';
    status.className = 'ais-status ok';
    setTimeout(() => { status.textContent = ''; status.className = 'ais-status'; }, 2000);
  });

}

async function runTool(tool, params, outId, btn) {
  const out = document.getElementById(outId);
  btn.disabled = true;
  btn.textContent = '⏳ Выполняется...';
  out.className = 'output-area show';
  out.textContent = '$ powershell ' + tool + '.ps1\n\n';

  try {
    const res = await fetch('/api/run-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, params })
    });
    const data = await res.json();
    const cls = data.success ? 'ok' : 'err';
    out.innerHTML = `$ powershell ${tool}.ps1\n\n<span class="${cls}">${escHtml(data.output || '(нет вывода)')}</span>`;
    if (data.success) {
      STATE.characters = [];
      STATE.graph.inited = false;
      if (STATE.page === 'dashboard') loadDashboard();
    }
  } catch (e) {
    out.innerHTML = `<span class="err">⚠ Ошибка соединения с сервером\n${e.message}</span>`;
  }

  btn.disabled = false;
  btn.textContent = getOrigLabel(btn.id);
}

// Run a Node CLI tool (cities/-aware) via /api/tool/:name with an args array.
// _NTR/_LATIN_TR/slugifyJS/escHtml/escAttr/showToast/showConfirm/getOrigLabel
// now live in public/utils.js (loaded before this file — see index.html).
async function runNodeTool(name, args, outId, btn) {
  const out = document.getElementById(outId);
  btn.disabled = true; btn.textContent = '⏳ Выполняется...';
  out.className = 'output-area show'; out.textContent = `$ node tools/${name}.js\n\n`;
  let ok = false;
  try {
    const data = await fetch('/api/tool/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args }) }).then(r => r.json());
    ok = !!data.ok;
    const cls = ok ? 'ok' : 'err';
    out.innerHTML = `$ node tools/${name}.js\n\n<span class="${cls}">${escHtml(data.output || '(нет вывода)')}</span>`;
    if (ok) { STATE.characters = []; STATE.graph.inited = false; if (STATE.page === 'dashboard') loadDashboard(); }
  } catch (e) {
    out.innerHTML = `<span class="err">⚠ Ошибка соединения\n${e.message}</span>`;
  }
  btn.disabled = false; btn.textContent = getOrigLabel(btn.id) || 'Готово';
  return ok;
}

// Character API routes are keyed by ASCII slug, not the Cyrillic display name
// (avoids percent-encoded Cyrillic in the URL bar). Modular module-only NPCs have
// no slug — those fall back to the raw name, which the dialogue route also accepts.
function _charSlug(name) {
  return STATE.characters.find(c => c.name === name)?.slug || name;
}

// One editable relationship row (name + type/description + delete) for the «Отношения» tab
function _relRowHtml(target = '', description = '') {
  return `<div class="cdet-rel-row">
    <input class="cdet-rel-name-inp" list="cdet-rel-names" placeholder="Имя персонажа" value="${escAttr(target)}">
    <input class="cdet-rel-type-inp" list="cdet-rel-types" placeholder="Вид отношений / описание" value="${escAttr(description)}">
    <button class="cdet-rel-del-btn" type="button" title="Удалить связь">✕</button>
  </div>`;
}

// Compact, safe Markdown → HTML renderer for module files & chronicle prose.
// Escapes first, then applies a limited block/inline grammar. Links render as
// Resolve a markdown link [text](href) to an HTML element.
// Characters and locations become clickable links that open their detail modals.
function resolveMdLink(text, href) {
  if (/\/characters\//.test(href)) {
    const slug = href.replace(/\.md$/, '').split('/').pop();
    return `<a class="md-link md-link-char" data-char-slug="${slug}" href="#">${text}</a>`;
  }
  if (/\/locations\//.test(href)) {
    const slug = href.replace(/\.md$/, '').split('/').pop();
    return `<a class="md-link md-link-loc" data-loc-slug="${slug}" href="#">${text}</a>`;
  }
  if (/\.md$/.test(href) || href.startsWith('#')) {
    return `<span class="md-link">${text}</span>`;
  }
  return `<a class="md-link" href="${href}" target="_blank" rel="noopener">${text}</a>`;
}

// styled text (relative .md paths don't resolve in the browser).
function mdInline(s) {
  return escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => resolveMdLink(t, h));
}
function mdToHtml(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let html = '', i = 0;
  const isBlockStart = t => /^(#{1,6}\s|>|[-*]\s|\d+\.\s|\|)/.test(t) || /^---+$/.test(t);
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }

    if (/^---+$/.test(t)) { html += '<hr class="md-hr">'; i++; continue; }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lvl = Math.min(h[1].length, 6); html += `<div class="md-h md-h${lvl}">${mdInline(h[2])}</div>`; i++; continue; }

    if (/^>\s?/.test(t)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      html += `<blockquote class="md-quote">${mdInline(buf.join(' '))}</blockquote>`; continue;
    }

    if (/^\|/.test(t) && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) { rows.push(lines[i].trim()); i++; }
      const cells = r => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      html += '<table class="md-table"><thead><tr>' + head.map(c => `<th>${mdInline(c)}</th>`).join('') +
        '</tr></thead><tbody>' + body.map(r => '<tr>' + r.map(c => `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>';
      continue;
    }

    if (/^[-*]\s+/.test(t)) {
      const buf = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++; }
      html += '<ul class="md-ul">' + buf.map(b => `<li>${mdInline(b)}</li>`).join('') + '</ul>'; continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const buf = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^\d+\.\s+/, '')); i++; }
      html += '<ol class="md-ol">' + buf.map(b => `<li>${mdInline(b)}</li>`).join('') + '</ol>'; continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i].trim())) { buf.push(lines[i].trim()); i++; }
    html += `<p class="md-p">${mdInline(buf.join(' '))}</p>`;
  }
  return html;
}

// Bare canonical status words written without checking «Пол» (common at creation,
// where the card text is just «Жив» regardless of gender) — grammatically correct
// for display by gender. Anything with extra narrative (e.g. «Жив, но в бегах»)
// is left as-is below; this only intervenes on an exact bare-word match.
const GENDERED_STATUS_WORD = {
  'жив':    { 'Мужской': 'Жив',   'Женский': 'Жива' },
  'жива':   { 'Мужской': 'Жив',   'Женский': 'Жива' },
  'мёртв':  { 'Мужской': 'Мёртв', 'Женский': 'Мертва' },
  'мертва': { 'Мужской': 'Мёртв', 'Женский': 'Мертва' },
};
function statusLabel(c) {
  const raw = (c.status || '').trim();
  const gendered = GENDERED_STATUS_WORD[raw.toLowerCase()]?.[c.gender];
  if (gendered) return gendered;
  if (raw && !raw.includes('⚠️')) return raw;
  return STATUS_LABELS[c.statusType || 'unknown'] || '—';
}
// getOrigLabel moved to public/utils.js (E2.1).

const cityNameInput = document.getElementById('city-name');
const citySlugPreview = document.getElementById('city-slug-preview');
cityNameInput.addEventListener('input', () => {
  citySlugPreview.textContent = slugifyJS(cityNameInput.value.trim()) || '—';
});

// Редактор «Фракции» в форме создания — тот же компонент, что в модалке редактирования
// (единый источник чипов/полей). Инжектится лениво в loadCitiesGrid() — там все
// const-наборы (CITY_SECTS и т.п.) уже инициализированы.
const _cityFactionsCreateHost = document.getElementById('city-factions-editor');

document.getElementById('btn-new-city').addEventListener('click', async () => {
  const city = cityNameInput.value.trim();
  const year = document.getElementById('city-year').value.trim();
  if (!city) { showToast('Укажите название города', 'warning'); return; }
  if (!year) { showToast('Укажите год', 'warning'); return; }
  if (!/^\d{3,4}$/.test(year)) { showToast('Год — это 3–4 цифры (например 2010)', 'warning'); return; }
  // Районы, дающие одинаковую папку (один слаг), будут схлопнуты в один — предупреждаем.
  const districtNames = document.getElementById('city-districts').value.split(',').map(s => s.trim()).filter(Boolean);
  const dSlugs = districtNames.map(d => slugifyJS(d) || d.toLowerCase());
  const dupSlugs = [...new Set(dSlugs.filter((s, i) => dSlugs.indexOf(s) !== i))];
  if (dupSlugs.length &&
      !await showConfirm(`Районы дают одинаковую папку (${dupSlugs.join(', ')}) — дубликаты будут пропущены. Продолжить?`, { confirmText: 'Продолжить' })) return;
  const btn = document.getElementById('btn-new-city');
  const out = document.getElementById('out-new-city');
  const payload = {
    name: city, year,
    description: document.getElementById('city-description').value.trim(),
    political:  document.getElementById('city-political').value.trim(),
    factions:   _cityFactionsCreateHost ? _collectFactions(_cityFactionsCreateHost) : '',
    locations:  document.getElementById('city-locations').value.trim(),
    leitmotif:  document.getElementById('city-leitmotif').value.trim(),
    specifics:  document.getElementById('city-specifics').value.trim(),
    avoid:      document.getElementById('city-avoid').value.trim(),
    sources:    document.getElementById('city-sources').value.trim(),
    districts:  document.getElementById('city-districts').value.trim(),
  };
  btn.disabled = true; btn.textContent = '⏳ Создание...';
  if (out) { out.className = 'output-area show'; out.textContent = ''; }
  try {
    const d = await fetch('/api/cities', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());
    if (!d.ok) { if (out) out.innerHTML = `<span class="err">⚠ ${escHtml(d.error || 'Ошибка')}</span>`; return; }
    if (out) out.innerHTML = `<span class="ok">✓ Создан: cities/${escHtml(d.slug)}/ — переключаюсь…</span>`;
    setTimeout(() => { location.search = 'city=' + encodeURIComponent(d.slug); }, 900);
  } catch (e) {
    if (out) out.innerHTML = `<span class="err">⚠ ${escHtml(e.message)}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Создать домен';
  }
});

// Vampire-only fields visible / clan+sect required only for vampires
function _updateNpcForm() {
  const isVamp = document.getElementById('npc-type').value === 'vampire';
  document.getElementById('npc-vamp-fields').style.display = isVamp ? '' : 'none';
  document.getElementById('npc-clan-req').style.display = isVamp ? '' : 'none';
  document.getElementById('npc-sect-req').style.display = isVamp ? '' : 'none';
}
document.getElementById('npc-type').addEventListener('change', _updateNpcForm);
_updateNpcForm();

document.getElementById('btn-new-npc').addEventListener('click', async () => {
  const btn = document.getElementById('btn-new-npc');
  const out = document.getElementById('out-new-npc');
  const lineage = document.getElementById('npc-type').value;
  const isVamp  = lineage === 'vampire';
  const name = document.getElementById('npc-name').value.trim();
  const gender = document.getElementById('npc-gender').value.trim();
  const clan = document.getElementById('npc-clan').value.trim();
  const sect = document.getElementById('npc-sect').value.trim();
  if (!name) { showToast('Укажи имя', 'warning'); return; }
  if (!gender) { showToast('Укажи пол', 'warning'); return; }
  if (!CITY) { showToast('Сначала выбери город в шапке', 'warning'); return; }
  if (isVamp && !clan) { showToast('Клан обязателен для вампира', 'warning'); return; }
  if (isVamp && !sect) { showToast('Секта обязательна для вампира', 'warning'); return; }

  const payload = {
    name, lineage, gender, clan, sect,
    generation:  document.getElementById('npc-generation').value.trim(),
    birthYear:   document.getElementById('npc-birth').value.trim(),
    embraceYear: document.getElementById('npc-embrace').value.trim(),
    sire:        document.getElementById('npc-sire').value.trim(),
    biography:   document.getElementById('npc-bio').value.trim(),
    appearance:  document.getElementById('npc-appearance').value.trim(),
  };

  btn.disabled = true; btn.textContent = '⏳ Создание...';
  out.className = 'output-area show'; out.textContent = '';
  try {
    const qs = window.location.search;
    const d  = await fetch('/api/characters' + qs,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    ).then(r => r.json());
    if (!d.ok) { out.innerHTML = `<span class="err">⚠ ${escHtml(d.error || 'Ошибка')}</span>`; return; }
    let msg = `✓ Создан: cities/${CITY}/characters/${d.lineage}/${d.slug}/${d.slug}.md`;

    // Optional art upload (reuses the existing per-character upload endpoint)
    const file = document.getElementById('npc-art')?.files?.[0];
    if (file) {
      const base64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const u = await fetch(`/api/characters/${encodeURIComponent(d.slug)}/upload-image${qs}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64, ext }) }
      ).then(r => r.json());
      msg += u.ok ? '\n📷 Арт загружен' : `\n⚠ Арт не загружен: ${u.error || ''}`;
    }
    out.innerHTML = `<span class="ok">${escHtml(msg)}</span>`;

    ['npc-name','npc-clan','npc-sect','npc-generation','npc-birth','npc-embrace','npc-sire','npc-bio','npc-appearance']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('npc-gender').value = '';
    const art = document.getElementById('npc-art'); if (art) art.value = '';
    STATE.characters = []; STATE.graph.inited = false;
    if (STATE.page === 'dashboard') loadDashboard();
  } catch (e) {
    out.innerHTML = `<span class="err">⚠ ${escHtml(e.message)}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Создать карточку';
  }
});

document.getElementById('btn-create-module-tools').addEventListener('click', () => {
  openModCreateModal(true);
});

document.getElementById('btn-validate').addEventListener('click', () => {
  runTool('validate_links', {}, 'out-validate', document.getElementById('btn-validate'));
});

document.getElementById('btn-validate-fix').addEventListener('click', () => {
  runTool('validate_links', { Fix: 'true' }, 'out-validate', document.getElementById('btn-validate-fix'));
});

// ── Tab «🛠 Ещё»: Node-инструменты над текущим городом ──────────────────────────
function _moreBtn(id, name, argsFn) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('click', () => {
    if (!CITY) { showToast('Сначала выбери город в шапке', 'warning'); return; }
    const args = argsFn(); if (!args) return;
    runNodeTool(name, args, 'out-more', el);
  });
}
_moreBtn('btn-new-loc', 'new_location', () => {
  const d = document.getElementById('loc-district').value.trim();
  const n = document.getElementById('loc-name').value.trim();
  if (!d || !n) { showToast('Укажите округ/код и название', 'warning'); return null; }
  return [CITY, d, n, document.getElementById('loc-rayon').value.trim(), document.getElementById('loc-zone').value];
});
_moreBtn('btn-migrate', 'migrate_char', () => {
  const slug = document.getElementById('mig-slug').value.trim();
  const to   = document.getElementById('mig-to').value.trim();
  if (!slug || !to) { showToast('Укажите слаг персонажа и город назначения', 'warning'); return null; }
  return ['visit', CITY, document.getElementById('mig-lineage').value, slug, to, document.getElementById('mig-when').value.trim()];
});
_moreBtn('btn-close-chr', 'close_chronicle', () => {
  const chr = document.getElementById('close-chr').value.trim();
  if (!chr) { showToast('Укажите слаг хроники', 'warning'); return null; }
  return [CITY, chr, document.getElementById('close-note').value.trim()];
});
_moreBtn('btn-rebuild-idx', 'build_city_events', () => [CITY]);
_moreBtn('btn-sync-index', 'sync_index', () => [CITY]);

// ═══════════════════════════════════════════════════════════════
// Modules
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Chronicles list (with delete)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Chronicles page
// ═══════════════════════════════════════════════════════════════

const STATUS_LABEL = { active: '🟢 Активна', closed: '🔴 Закрыта', paused: '🟡 Приостановлена' };
const STATUS_CLS   = { active: 'chr-status-active', closed: 'chr-status-closed', paused: 'chr-status-paused' };

function renderChronicleCard(c) {
  const statusLbl = STATUS_LABEL[c.status] || c.status;
  const statusCls = STATUS_CLS[c.status]   || '';
  const meta = [
    c.startDate ? `<span class="chp-meta-item">🗓 ${escHtml(c.startDate)}</span>` : '',
    c.events    ? `<span class="chp-meta-item">📅 ${c.events} событий</span>` : '',
    c.modules   ? `<span class="chp-meta-item">📖 ${c.modules} модулей</span>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="chp-card" data-slug="${escHtml(c.slug)}">
      <div class="chp-card-header">
        <div class="chp-card-name">${escHtml(c.display)}</div>
        <span class="chp-status ${statusCls}">${statusLbl}</span>
      </div>
      ${meta ? `<div class="chp-card-meta">${meta}</div>` : ''}
      <div class="chp-card-actions">
        <button class="chr-delete-btn" data-slug="${escHtml(c.slug)}">🗑 Удалить</button>
      </div>
    </div>`;
}

async function loadChroniclesPage() {
  const el  = document.getElementById('chronicles-cards-list');
  const sub = document.getElementById('chronicles-page-sub');
  if (!el) return;
  el.innerHTML = SPINNER;
  try {
    const qs   = window.location.search;
    const chrs = await fetch(`/api/chronicles${qs}`).then(r => r.json());
    STATE.chronicles = chrs; // cache for detail modal
    if (sub) sub.textContent = chrs.length ? `${chrs.length} хроник` : 'Нет хроник';
    if (!chrs.length) {
      el.innerHTML = '<div class="loading-state" style="height:120px">Хроники не найдены</div>';
      return;
    }
    el.innerHTML = `<div class="chp-grid">${chrs.map(renderChronicleCard).join('')}</div>`;
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
  }
}

// ═══════════════════════════════════════════════════════════════
// Cities grid (Tools → «Домены»)
// ═══════════════════════════════════════════════════════════════

function renderCityCard(c) {
  const active = c.slug === CITY;
  const meta = [
    c.year       ? `<span class="chp-meta-item">📅 ${escHtml(c.year)}</span>` : '',
    c.characters ? `<span class="chp-meta-item">🎭 ${c.characters} персонажей</span>` : '',
    c.modules    ? `<span class="chp-meta-item">📖 ${c.modules} модулей</span>` : '',
    c.locations  ? `<span class="chp-meta-item">📍 ${c.locations} локаций</span>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="city-card" data-slug="${escHtml(c.slug)}" title="Подробнее о городе">
      <div class="chp-card-header">
        <div class="chp-card-name">${escHtml(c.display)}</div>
        ${active ? '<span class="chp-status chp-status-active">Активен</span>' : ''}
      </div>
      ${meta ? `<div class="chp-card-meta">${meta}</div>` : ''}
    </div>`;
}

async function loadCitiesGrid() {
  // Ленивый инжект редактора «Фракции» в форму создания (один раз).
  if (_cityFactionsCreateHost && !_cityFactionsCreateHost.dataset.ready) {
    _cityFactionsCreateHost.innerHTML = _cityFactionsEditorHtml({ factions: '' });
    _cityFactionsCreateHost.dataset.ready = '1';
  }
  const el = document.getElementById('cities-grid');
  if (!el) return;
  el.innerHTML = SPINNER;
  try {
    const cities = await fetch('/api/cities/summary').then(r => r.json());
    if (!Array.isArray(cities) || !cities.length) {
      el.innerHTML = '<div class="loading-state" style="height:120px">Городов пока нет — создайте первый ниже</div>';
      return;
    }
    el.innerHTML = `<div class="chp-grid">${cities.map(renderCityCard).join('')}</div>`;
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
  }
}

document.getElementById('cities-grid')?.addEventListener('click', e => {
  const card = e.target.closest('.city-card');
  if (!card) return;
  openCityDetail(card.dataset.slug);
});

// ═══════════════════════════════════════════════════════════════
// City Detail Modal
// ═══════════════════════════════════════════════════════════════

// Канонические секции city.md — зеркало CITY_SECTIONS в web/lib/parsers.js.
const CITY_SECTION_DEFS = [
  ['political',  'Политический ландшафт'],
  ['factions',   'Фракции'],
  ['locations',  'Ключевые локации'],
  ['leitmotif',  'Лейтмотивы и атмосфера'],
  ['specifics',  'Специфика ответа'],
  ['avoid',      'Чего избегать'],
  ['sources',    'Источники'],
];
// Секты и независимые кланы V20 (system/rules/reference_wod.md) — варианты для
// мультиселекта секции «Фракции». Независимые — канонические 4 клана V20
// (Каппадокийцы — вымерший/Dark Ages клан, в набор не входят).
const CITY_SECTS = ['Камарилья', 'Анархи', 'Шабаш'];
const CITY_INDEPENDENT_CLANS = ['Ассамиты', 'Следующие Луны', 'Джованни', 'Равнос'];
let _cityDetail = null;  // { slug, cityMd, parsed, characters, modules, locations, active }

// У города есть секции вне стандартного набора (рукописный city.md, как у Парижа)?
function _cityHasCustomSections(cityMd) {
  const known = new Set(CITY_SECTION_DEFS.map(([, h]) => h.toLowerCase()));
  const headings = [...String(cityMd).matchAll(/^##\s+(.+?)\s*$/gm)].map(m => m[1].trim().toLowerCase());
  return headings.some(h => !known.has(h));
}

// ── Структурные редакторы секций «Политический ландшафт» / «Ключевые локации» ──
// Строки-записи (роль/имя/имя2 и тип/имя) поверх готовой row-инфраструктуры .cdet-rel-*.
const CITY_POLITICAL_ROLES = ['Князь', 'Шериф', 'Сенешаль', 'Примаген'];
const CITY_LOCATION_TYPES  = ['Элизиум'];
let _cityEditChars = [];  // имена персонажей города — для datalist
let _cityEditLocs  = [];  // названия локаций города — для datalist
let _polRowSeq = 0;

// Секция «Политический ландшафт»/«Ключевые локации» может содержать вольный нарратив
// (как сейчас у всех городов — цельный абзац-описание) и структурные записи вида
// "Должность: Имя" / "Тип: Название". Раньше всё это разбиралось в одни и те же строки
// формы, и нарратив без двоеточия попадал в поле «Имя» структурного редактора — отсюда
// и путаница. Делим по строке: запись — короткая метка + двоеточие, где метка либо из
// известного словаря (Князь/Шериф/…, Элизиум), либо значение похоже на имя (короткое,
// без «прозаической» пунктуации). Иначе строка — нарратив. Так проза с двоеточием
// («Камарилья: оплот старейшин, но раздроблена») остаётся в нарративе, а не уезжает
// фальшивой записью в структурный редактор и «Карту фракций».
function _isStructuredCityLine(line, knownLabels) {
  const ci = line.indexOf(':');
  if (ci <= 0 || ci > 40) return false;
  const label = line.slice(0, ci).trim();
  if (!label || label.length > 24 || label.split(/\s+/).length > 2 || label.includes(',')) return false;
  if (knownLabels && knownLabels.has(label.toLowerCase())) return true;
  const value = line.slice(ci + 1).trim();
  return value.length > 0 && value.length <= 48 && !/[.!?,;]/.test(value);
}
function _splitCitySectionRecords(text, knownLabels) {
  const lines = String(text || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
  const narrative = [], recordLines = [];
  for (const line of lines) (_isStructuredCityLine(line, knownLabels) ? recordLines : narrative).push(line);
  return { narrative: narrative.join('\n'), recordLines };
}
const _POL_LABELS = new Set(CITY_POLITICAL_ROLES.map(r => r.toLowerCase()));
const _LOC_LABELS = new Set(CITY_LOCATION_TYPES.map(t => t.toLowerCase()));

// city.md-строки записей ↔ структурные записи (round-trip с buildCityMd/parseCityMd).
function _parsePoliticalLines(lines) {
  return lines.map(line => {
    const ci = line.indexOf(':');
    let role = '', rest = line;
    if (ci !== -1) { role = line.slice(0, ci).trim(); rest = line.slice(ci + 1).trim(); }
    const [name = '', name2 = ''] = rest.split('/').map(s => s.trim());
    return { role, name, name2 };
  });
}
function _politicalRowToLine(r) {
  const np = r.name2 ? (r.name ? `${r.name} / ${r.name2}` : r.name2) : r.name;
  return r.role ? `${r.role}: ${np}` : np;
}
function _parseLocationLines(lines) {
  return lines.map(line => {
    const ci = line.indexOf(':');
    if (ci === -1) return { type: '', name: line };
    return { type: line.slice(0, ci).trim(), name: line.slice(ci + 1).trim() };
  });
}
function _locationRowToLine(r) { return r.type ? `${r.type}: ${r.name}` : r.name; }

// Персонажи, уже занятые в других строках, не предлагаются повторно (кроме self).
function _polAvailableNames(allNames, records, self) {
  const occ = new Set();
  records.forEach(r => { if (r === self) return; if (r.name) occ.add(r.name); if (r.name2) occ.add(r.name2); });
  return allNames.filter(n => !occ.has(n));
}

function _polRowHtml(role = '', name = '', name2 = '', availableNames = _cityEditChars) {
  const known   = CITY_POLITICAL_ROLES.includes(role);
  const selVal  = !role ? '' : (known ? role : 'other');
  const custVal = (!known && role) ? role : '';
  const opts = [
    `<option value=""${selVal === '' ? ' selected' : ''}>Должность…</option>`,
    ...CITY_POLITICAL_ROLES.map(o => `<option value="${escAttr(o)}"${o === selVal ? ' selected' : ''}>${escHtml(o)}</option>`),
    `<option value="other"${selVal === 'other' ? ' selected' : ''}>Другое…</option>`,
  ].join('');
  const dlId   = `cdet-pol-dl-${++_polRowSeq}`;
  const dlOpts = availableNames.map(n => `<option value="${escAttr(n)}">`).join('');
  return `<div class="cdet-rel-row cdet-pol-row">
    <select class="form-control cdet-pol-role-sel">${opts}</select>
    <input class="cdet-rel-type-inp cdet-pol-role-custom" placeholder="Своя должность" value="${escAttr(custVal)}" style="${selVal === 'other' ? '' : 'display:none'}">
    <input class="cdet-rel-name-inp cdet-pol-name-inp" list="${dlId}" placeholder="Имя персонажа" value="${escAttr(name)}">
    <input class="cdet-rel-name-inp cdet-pol-name-inp cdet-pol-name2-inp" list="${dlId}" placeholder="Второе имя (необязательно)" value="${escAttr(name2)}">
    <button class="cdet-rel-del-btn" type="button" title="Удалить запись">✕</button>
    <datalist id="${dlId}">${dlOpts}</datalist>
  </div>`;
}
function _locRowHtml(type = '', name = '', locationNames = _cityEditLocs) {
  const known   = CITY_LOCATION_TYPES.includes(type);
  const selVal  = !type ? '' : (known ? type : 'other');
  const custVal = (!known && type) ? type : '';
  const opts = [
    `<option value=""${selVal === '' ? ' selected' : ''}>Тип…</option>`,
    ...CITY_LOCATION_TYPES.map(o => `<option value="${escAttr(o)}"${o === selVal ? ' selected' : ''}>${escHtml(o)}</option>`),
    `<option value="other"${selVal === 'other' ? ' selected' : ''}>Другое…</option>`,
  ].join('');
  return `<div class="cdet-rel-row cdet-loc-row">
    <select class="form-control cdet-pol-role-sel cdet-loc-type-sel">${opts}</select>
    <input class="cdet-rel-type-inp cdet-loc-type-custom" placeholder="Свой тип" value="${escAttr(custVal)}" style="${selVal === 'other' ? '' : 'display:none'}">
    <input class="cdet-rel-name-inp cdet-loc-name-inp" list="cdet-city-loc-names" placeholder="Название локации" value="${escAttr(name)}">
    <button class="cdet-rel-del-btn" type="button" title="Удалить запись">✕</button>
  </div>`;
}
// Строка уезжает (fade+collapse), затем удаляется из DOM — без этого клик по «✕» среди
// нескольких похожих строк не давал понять, какая именно пропала.
function _removeRelRow(row) {
  if (!row) return;
  row.classList.add('row-exit');
  row.addEventListener('animationend', () => row.remove(), { once: true });
  setTimeout(() => row.remove(), 250); // страховка, если animationend не сработает
}

// HTML-блоки структурных секций для формы _renderCityEdit. Нарратив и структурные
// записи — два отдельных поля, чтобы не путались при заполнении.
function _cityPolEditorHtml(sec) {
  const { narrative, recordLines } = _splitCitySectionRecords(sec.political || '', _POL_LABELS);
  const records = _parsePoliticalLines(recordLines);
  const rows = records.length
    ? records.map(r => _polRowHtml(r.role, r.name, r.name2, _polAvailableNames(_cityEditChars, records, r))).join('')
    : _polRowHtml('', '', '', _cityEditChars);
  return `
    <div class="form-group">
      <label class="form-label">Политический ландшафт</label>
      <div class="cdet-rels-hint">Общее описание расклада сил — атмосфера, фракции, конфликты.</div>
      <textarea class="form-control" data-city-field="political-narrative" rows="3"
        placeholder="По строке на пункт…">${escHtml(narrative)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Держатели ключевых должностей</label>
      <div class="cdet-rels-hint">Должность — из списка или своя. Имя (и второе, если нужно) — выбери из персонажей или впиши своё. Занятые в других строках персонажи не предлагаются.</div>
      <div id="cdet-political-rows">${rows}</div>
      <button class="cdet-rel-add-btn" id="cdet-political-add-btn" type="button">+ Добавить запись</button>
    </div>`;
}
function _cityLocEditorHtml(sec) {
  const { narrative, recordLines } = _splitCitySectionRecords(sec.locations || '', _LOC_LABELS);
  const records = _parseLocationLines(recordLines);
  const rows = records.length ? records.map(r => _locRowHtml(r.type, r.name)).join('') : _locRowHtml();
  return `
    <div class="form-group">
      <label class="form-label">Ключевые локации</label>
      <div class="cdet-rels-hint">Общее описание ключевых локаций города.</div>
      <textarea class="form-control" data-city-field="locations-narrative" rows="3"
        placeholder="По строке на пункт…">${escHtml(narrative)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Отмеченные локации</label>
      <div class="cdet-rels-hint">Тип — из списка или свой. Название — из созданных локаций или своё.</div>
      <div id="cdet-location-rows">${rows}</div>
      <button class="cdet-rel-add-btn" id="cdet-location-add-btn" type="button">+ Добавить запись</button>
      <datalist id="cdet-city-loc-names">${_cityEditLocs.map(n => `<option value="${escAttr(n)}">`).join('')}</datalist>
    </div>`;
}
// Мультиселект-чипы: секты Камарилья/Анархи/Шабаш + независимые кланы. Храним как
// буллет-список (по строке на выбор) — та же конвенция, что у простых секций.
// Строки, не совпавшие ни с одним чипом (рукописные/нестандартные фракции — Инконню
// и т.п.), не теряются: их показываем в поле «Другие фракции» и сохраняем как есть.
function _cityFactionsEditorHtml(sec) {
  const all = String(sec.factions || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
  const known = new Set([...CITY_SECTS, ...CITY_INDEPENDENT_CLANS]);
  const selected = new Set(all.filter(l => known.has(l)));
  const other = all.filter(l => !known.has(l));
  const chip = name => {
    const on = selected.has(name);
    return `<button type="button" class="cdet-faction-chip" aria-pressed="${on}" data-faction="${escAttr(name)}">${escHtml(name)}</button>`;
  };
  return `
    <div class="form-group">
      <label class="form-label">Фракции</label>
      <div class="cdet-rels-hint">Секты и независимые кланы, присутствующие в городе. Можно выбрать несколько.</div>
      <div class="cdet-faction-group-label">Секты</div>
      <div class="cdet-faction-chips" data-faction-group="sects">${CITY_SECTS.map(chip).join('')}</div>
      <div class="cdet-faction-group-label">Независимые кланы</div>
      <div class="cdet-faction-chips" data-faction-group="clans">${CITY_INDEPENDENT_CLANS.map(chip).join('')}</div>
      <div class="cdet-faction-group-label">Другие фракции</div>
      <textarea class="form-control" data-city-field="factions-other" rows="2"
        placeholder="По строке на фракцию вне списка (напр. Инконню)…">${escHtml(other.join('\n'))}</textarea>
    </div>`;
}
// root ограничивает сбор одной формой — модалка редактирования и форма создания
// держат свои наборы чипов одновременно, без пересечения селекторов.
function _collectFactions(root = document) {
  const chips = Array.from(root.querySelectorAll('.cdet-faction-chip[aria-pressed="true"]')).map(b => b.dataset.faction);
  const other = (root.querySelector('[data-city-field="factions-other"]')?.value || '')
    .split('\n').map(l => l.trim()).filter(Boolean);
  return [...chips, ...other].join('\n');
}

// Сбор нарратива + структурных строк обратно в текст секции city.md (буллет на пункт/запись).
function _collectPoliticalRows() {
  const narrative = document.querySelector('[data-city-field="political-narrative"]')?.value.trim() || '';
  const narrativeLines = narrative ? narrative.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const recordLines = Array.from(document.querySelectorAll('#cdet-political-rows .cdet-pol-row')).map(row => {
    const sel    = row.querySelector('.cdet-pol-role-sel');
    const custom = row.querySelector('.cdet-pol-role-custom');
    const role   = sel?.value === 'other' ? (custom?.value.trim() || '') : (sel?.value || '');
    const name   = row.querySelector('.cdet-pol-name-inp')?.value.trim() || '';
    const name2  = row.querySelector('.cdet-pol-name2-inp')?.value.trim() || '';
    return { role, name, name2 };
  }).filter(r => r.role || r.name || r.name2).map(_politicalRowToLine);
  return [...narrativeLines, ...recordLines].join('\n');
}
function _collectLocationRows() {
  const narrative = document.querySelector('[data-city-field="locations-narrative"]')?.value.trim() || '';
  const narrativeLines = narrative ? narrative.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const recordLines = Array.from(document.querySelectorAll('#cdet-location-rows .cdet-loc-row')).map(row => {
    const sel    = row.querySelector('.cdet-loc-type-sel');
    const custom = row.querySelector('.cdet-loc-type-custom');
    const type   = sel?.value === 'other' ? (custom?.value.trim() || '') : (sel?.value || '');
    const name   = row.querySelector('.cdet-loc-name-inp')?.value.trim() || '';
    return { type, name };
  }).filter(r => r.type || r.name).map(_locationRowToLine);
  return [...narrativeLines, ...recordLines].join('\n');
}

async function openCityDetail(slug) {
  const modal   = document.getElementById('city-detail-modal');
  const content = document.getElementById('city-detail-content');
  content.innerHTML = `<div class="mod-loading">${SPINNER}</div>`;
  modal.classList.add('open');

  let d, chars = [], locs = [];
  try {
    [d, chars, locs] = await Promise.all([
      fetch(`/api/cities/${encodeURIComponent(slug)}/detail`).then(r => r.json()),
      fetch(`/api/characters?city=${encodeURIComponent(slug)}`).then(r => r.json()).catch(() => []),
      fetch(`/api/locations?city=${encodeURIComponent(slug)}`).then(r => r.json()).catch(() => []),
    ]);
  } catch { content.innerHTML = '<div class="cdet-empty" style="padding:40px">⚠ Не удалось загрузить город</div>'; return; }
  if (d.error) { content.innerHTML = `<div class="cdet-empty" style="padding:40px">${escHtml(d.error)}</div>`; return; }

  _cityEditChars = Array.isArray(chars) ? chars.map(c => c.name).filter(Boolean) : [];
  _cityEditLocs  = Array.isArray(locs) ? locs.map(l => l.title).filter(Boolean) : [];
  _cityDetail = { ...d, slug, active: slug === CITY };
  _renderCityView();
}

function _renderCityView() {
  const d = _cityDetail;
  const content = document.getElementById('city-detail-content');
  const display = (d.parsed && d.parsed.display) || d.slug;
  const body    = d.cityMd.replace(/^#\s+.+\n+/, ''); // заголовок уже в шапке модалки

  const meta = [
    d.parsed && d.parsed.year ? `<span class="chp-meta-item">📅 ${escHtml(d.parsed.year)}</span>` : '',
    d.characters ? `<span class="chp-meta-item">🎭 ${d.characters} персонажей</span>` : '',
    d.modules    ? `<span class="chp-meta-item">📖 ${d.modules} модулей</span>` : '',
    d.locations  ? `<span class="chp-meta-item">📍 ${d.locations} локаций</span>` : '',
  ].filter(Boolean).join('');

  content.innerHTML = `
    <div class="cdet-info-col mod-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">${escHtml(display)}</div>
        <div class="mod-modal-slug-row">
          ${meta ? `<div class="chp-card-meta">${meta}</div>` : ''}
          ${d.active
            ? '<span class="chp-status chp-status-active">Активен</span>'
            : `<button class="mod-gen-scenario-btn" data-switch-city="${escHtml(d.slug)}">Переключиться на этот город</button>`}
        </div>
        <div class="city-detail-actions">
          <button class="city-edit-btn" data-city-edit>✏ Редактировать</button>
          <button class="city-del-btn" data-city-delete title="Удалить домен">🗑 Удалить</button>
        </div>
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active"><div class="md-body">${mdToHtml(body)}</div></div>
      </div>
    </div>`;
}

// Пояснения к полям редактирования города — те же формулировки, что у формы
// создания (см. .field-tip в index.html «Создать домен»), чтобы не расходились.
const CITY_FIELD_TIPS = {
  'Название': 'Название города на русском — заголовок city.md.',
  'Год': 'Год, в котором разворачивается хроника. Используется в заголовках city.md и карточек — на механику не влияет.',
  'Сеттинг': 'Общее описание города — эпоха, тон, в рамках какого канона разворачиваются сцены.',
  'Лейтмотивы и атмосфера': '2–3 детали, которые делают сцену именно этим городом, а не «городом в Европе»: архитектура, погода, общее настроение хроники.',
  'Специфика ответа': 'Язык общения НПС, имена Князей и других ключевых фигур, местные обычаи и сленг.',
  'Чего избегать': 'Табу и нежелательные клише именно для этого домена.',
  'Источники': 'На какие книги или материалы опираться при сверке канона для этого домена.',
};

function _renderCityEdit() {
  const d = _cityDetail;
  const content = document.getElementById('city-detail-content');
  const sec = (d.parsed && d.parsed.sections) || {};
  const custom = _cityHasCustomSections(d.cityMd);

  const fieldRows = CITY_SECTION_DEFS.map(([key, heading]) => {
    if (key === 'political') return _cityPolEditorHtml(sec);
    if (key === 'factions')  return _cityFactionsEditorHtml(sec);
    if (key === 'locations') return _cityLocEditorHtml(sec);
    return `
    <div class="form-group">
      <label class="form-label">${escHtml(heading)}${fieldTip(CITY_FIELD_TIPS[heading])}</label>
      <textarea class="form-control" data-city-field="${key}" rows="3"
        placeholder="По строке на пункт…">${escHtml(sec[key] || '')}</textarea>
    </div>`;
  }).join('');

  content.innerHTML = `
    <div class="cdet-info-col mod-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">Редактирование: ${escHtml((d.parsed && d.parsed.display) || d.slug)}</div>
        <div class="cdet-tab-bar city-edit-tabs">
          <button class="cdet-tab ${custom ? '' : 'active'}" data-city-tab="fields" ${custom ? 'disabled title="У города есть кастомные секции — правьте через Markdown, иначе они потеряются"' : ''}>Поля</button>
          <button class="cdet-tab ${custom ? 'active' : ''}" data-city-tab="markdown">Markdown</button>
        </div>
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel city-edit-panel ${custom ? '' : 'active'}" data-city-pane="fields">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Название *${fieldTip(CITY_FIELD_TIPS['Название'])}</label>
              <input class="form-control" data-city-field="display" type="text" value="${escAttr((d.parsed && d.parsed.display) || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Год${fieldTip(CITY_FIELD_TIPS['Год'])}</label>
              <input class="form-control" data-city-field="year" type="text" maxlength="9" value="${escAttr((d.parsed && d.parsed.year) || '')}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Сеттинг${fieldTip(CITY_FIELD_TIPS['Сеттинг'])}</label>
            <textarea class="form-control" data-city-field="description" rows="3"
              placeholder="Общее описание города — эпоха, тон, в рамках какого канона разворачиваются сцены…">${escHtml((d.parsed && d.parsed.description) || '')}</textarea>
          </div>
          ${fieldRows}
        </div>
        <div class="cdet-panel city-edit-panel ${custom ? 'active' : ''}" data-city-pane="markdown">
          ${custom ? '<div class="canon-warn" style="margin-bottom:10px">У этого города есть нестандартные секции — редактируйте полный markdown, чтобы ничего не потерять.</div>' : ''}
          <textarea class="form-control city-md-editor" data-city-field="cityMd" rows="20" spellcheck="false">${escHtml(d.cityMd)}</textarea>
        </div>
      </div>
      <div class="city-edit-footer">
        <button class="btn-submit" data-city-save>✓ Сохранить</button>
        <button class="mod-gen-scenario-btn" data-city-cancel>Отмена</button>
        <span class="city-edit-status" data-city-status></span>
      </div>
    </div>`;
}

// Мультиселект-чип фракции (aria-pressed = состояние) — делегировано на document,
// чтобы работало и в модалке редактирования, и в форме создания города.
document.addEventListener('click', e => {
  const factionChip = e.target.closest('.cdet-faction-chip');
  if (factionChip) {
    factionChip.setAttribute('aria-pressed', factionChip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  }
});

document.getElementById('city-detail-content').addEventListener('click', async e => {
  const sw = e.target.closest('[data-switch-city]');
  if (sw) { location.search = 'city=' + encodeURIComponent(sw.dataset.switchCity); return; }

  // Структурные строки политики/локаций: добавить/удалить
  if (e.target.closest('#cdet-political-add-btn')) {
    const rows = document.getElementById('cdet-political-rows');
    if (rows) {
      const occ = new Set();
      rows.querySelectorAll('.cdet-pol-row').forEach(row => {
        const n1 = row.querySelector('.cdet-pol-name-inp')?.value.trim();
        const n2 = row.querySelector('.cdet-pol-name2-inp')?.value.trim();
        if (n1) occ.add(n1); if (n2) occ.add(n2);
      });
      rows.insertAdjacentHTML('beforeend', _polRowHtml('', '', '', _cityEditChars.filter(n => !occ.has(n))));
      rows.lastElementChild?.classList.add('row-enter');
      rows.lastElementChild?.querySelector('.cdet-pol-name-inp')?.focus();
    }
    return;
  }
  if (e.target.closest('#cdet-political-rows .cdet-rel-del-btn')) { _removeRelRow(e.target.closest('.cdet-pol-row')); return; }
  if (e.target.closest('#cdet-location-add-btn')) {
    const rows = document.getElementById('cdet-location-rows');
    if (rows) {
      rows.insertAdjacentHTML('beforeend', _locRowHtml());
      rows.lastElementChild?.classList.add('row-enter');
      rows.lastElementChild?.querySelector('.cdet-loc-name-inp')?.focus();
    }
    return;
  }
  if (e.target.closest('#cdet-location-rows .cdet-rel-del-btn')) { _removeRelRow(e.target.closest('.cdet-loc-row')); return; }

  if (e.target.closest('[data-city-edit]'))   { _renderCityEdit(); return; }
  if (e.target.closest('[data-city-cancel]')) { _renderCityView(); return; }

  const tab = e.target.closest('[data-city-tab]');
  if (tab && !tab.disabled) {
    const which = tab.dataset.cityTab;
    document.querySelectorAll('[data-city-tab]').forEach(b => b.classList.toggle('active', b === tab));
    document.querySelectorAll('[data-city-pane]').forEach(p => p.classList.toggle('active', p.dataset.cityPane === which));
    return;
  }

  if (e.target.closest('[data-city-save]'))   { await _saveCityEdit(); return; }
  if (e.target.closest('[data-city-delete]')) { await _deleteCity(); return; }
});

// Показ/скрытие поля «своя должность/тип» при выборе «Другое…».
document.getElementById('city-detail-content').addEventListener('change', e => {
  const locSel = e.target.closest('.cdet-loc-type-sel');
  if (locSel) { const c = locSel.closest('.cdet-loc-row')?.querySelector('.cdet-loc-type-custom'); if (c) c.style.display = locSel.value === 'other' ? '' : 'none'; return; }
  const polSel = e.target.closest('.cdet-pol-role-sel');
  if (polSel) { const c = polSel.closest('.cdet-pol-row')?.querySelector('.cdet-pol-role-custom'); if (c) c.style.display = polSel.value === 'other' ? '' : 'none'; }
});

async function _saveCityEdit() {
  const d = _cityDetail;
  const statusEl = document.querySelector('[data-city-status]');
  const activePane = document.querySelector('[data-city-pane].active')?.dataset.cityPane || 'fields';
  const q = v => document.querySelector(`[data-city-field="${v}"]`);

  let payload;
  if (activePane === 'markdown') {
    const cityMd = q('cityMd').value;
    if (!/^#\s+\S/m.test(cityMd)) { if (statusEl) statusEl.textContent = '⚠ city.md должен начинаться с # …'; return; }
    payload = { cityMd };
  } else {
    const display = q('display').value.trim();
    if (!display) { if (statusEl) statusEl.textContent = '⚠ Укажите название'; return; }
    const fields = { display, year: q('year').value.trim(), description: q('description').value.trim() };
    for (const [key] of CITY_SECTION_DEFS) {
      if (key === 'political')      fields[key] = _collectPoliticalRows();
      else if (key === 'factions')  fields[key] = _collectFactions(document.getElementById('city-detail-content'));
      else if (key === 'locations') fields[key] = _collectLocationRows();
      else                          fields[key] = q(key).value.trim();
    }
    payload = { fields };
  }

  const btn = document.querySelector('[data-city-save]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Сохранение...'; }
  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(d.slug)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());
    if (!r.ok) { if (statusEl) statusEl.textContent = '⚠ ' + (r.error || 'Ошибка'); return; }
    // Перечитываем детально и возвращаемся в просмотр; обновляем грид доменов.
    const fresh = await fetch(`/api/cities/${encodeURIComponent(d.slug)}/detail`).then(r => r.json());
    _cityDetail = { ...fresh, slug: d.slug, active: d.slug === CITY };
    _renderCityView();
    if (document.getElementById('cities-grid')) loadCitiesGrid();
  } catch (err) {
    if (statusEl) statusEl.textContent = '⚠ ' + err.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Сохранить'; }
  }
}

async function _deleteCity() {
  const d = _cityDetail;
  const what = [d.characters && `${d.characters} персонажей`, d.modules && `${d.modules} модулей`,
    d.locations && `${d.locations} локаций`].filter(Boolean).join(', ');
  const msg = `Удалить домен «${(d.parsed && d.parsed.display) || d.slug}»?` +
    (what ? `\n\nВнутри: ${what}.` : '') +
    `\n\nГород переедет в cities/_deleted/ (обратимо, картинки не стираются).`;
  if (!await showConfirm(msg, { danger: true, confirmText: 'Удалить' })) return;

  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(d.slug)}`, { method: 'DELETE' }).then(r => r.json());
    if (!r.ok) { showToast('Ошибка удаления: ' + (r.error || 'неизвестная'), 'error'); return; }
    document.getElementById('city-detail-modal').classList.remove('open');
    if (d.active) {
      // Удалили активный город — переключаемся на любой оставшийся.
      const { cities = [] } = await fetch('/api/cities').then(r => r.json());
      if (cities.length) { location.search = 'city=' + encodeURIComponent(cities[0]); return; }
    }
    if (document.getElementById('cities-grid')) loadCitiesGrid();
  } catch (err) { showToast('Ошибка удаления: ' + err.message, 'error'); }
}

const cityDetailModal = document.getElementById('city-detail-modal');
document.getElementById('city-detail-close').addEventListener('click', () => cityDetailModal.classList.remove('open'));
cityDetailModal.addEventListener('click', e => { if (e.target === cityDetailModal) cityDetailModal.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cityDetailModal.classList.remove('open'); });

// ═══════════════════════════════════════════════════════════════
// Chronicle detail modal (modules list + create/delete module)
// ═══════════════════════════════════════════════════════════════

let _chrDetailSlug    = null;
let _chrDetailDisplay = null;
let _modDeleteTarget  = null; // { chr, mod }
let _modDeleteSource  = 'chr-detail'; // 'chr-detail' | 'modules-page'
let _modSlugEdited    = false;
let _modCreateStandalone = false; // true — открыт не из хроники, нужен select
let _modCreateOpening = false;

function _getModCreateChr() {
  if (!_modCreateStandalone) return _chrDetailSlug;
  const el = document.getElementById('mod-create-chr');
  return el ? el.value.trim() : '';
}

let _chrSelectData = []; // cached chronicle list with hidden flag

async function _loadChrSelect() {
  const sel = document.getElementById('mod-create-chr');
  sel.innerHTML = '<option value="">— выбери хронику —</option>';
  try {
    const qs     = window.location.search;
    const baseQs = qs ? qs + '&include_hidden=1' : '?include_hidden=1';
    _chrSelectData = await fetch(`/api/chronicles${baseQs}`).then(r => r.json());
    _chrSelectData.forEach(c => {
      const opt = document.createElement('option');
      opt.value       = c.slug;
      opt.textContent = (c.hidden ? '📂 ' : '') + (c.display || c.slug);
      sel.appendChild(opt);
    });
  } catch { _chrSelectData = []; }
}

function _updateTrackCheckbox(chrSlug) {
  const cb = document.getElementById('mod-create-track');
  if (!cb) return;
  const chr = _chrSelectData.find(c => c.slug === chrSlug);
  cb.checked = chr ? !chr.hidden : true;
}

function renderModuleCardInChr(m, chrSlug) {
  const files = [
    m.hasScenario ? '<span class="chd-mod-file">📝 Сценарий</span>' : '',
    m.hasFinale   ? `<span class="chd-mod-file chd-file-finale" data-open-finale data-chr="${escHtml(chrSlug)}" data-mod="${escHtml(m.name)}">📜 Финал</span>` : '',
    m.hasNpc      ? '<span class="chd-mod-file">👥 НПС</span>' : '',
  ].filter(Boolean).join('');
  return `
    <div class="chd-mod-card" data-chr="${escHtml(chrSlug)}" data-mod="${escHtml(m.name)}">
      <div class="chd-mod-main">
        <div class="chd-mod-title">${escHtml(m.title)}</div>
        ${m.time ? `<div class="chd-mod-time">${escHtml(m.time)}</div>` : ''}
        <div class="chd-mod-meta">
          ${m.type ? `<span class="chd-mod-tag">${escHtml(m.type)}</span>` : ''}
          ${m.format ? `<span class="chd-mod-tag">${escHtml(m.format)}</span>` : ''}
        </div>
        ${files ? `<div class="chd-mod-files">${files}</div>` : ''}
        <div class="chd-mod-slug">${escHtml(m.name)}</div>
      </div>
      <button class="chd-mod-del-btn" data-chr="${escHtml(chrSlug)}" data-mod="${escHtml(m.name)}" title="Удалить модуль">🗑</button>
    </div>`;
}

let _chrDetailTab = 'modules';

async function openChrDetail(slug, display, tab) {
  _chrDetailSlug    = slug;
  _chrDetailDisplay = display;
  _chrDetailTab     = tab || 'modules';

  const modal   = document.getElementById('chr-detail-modal');
  const title   = document.getElementById('chr-detail-title');
  const metaEl  = document.getElementById('chr-detail-meta');
  const body    = document.getElementById('chr-detail-body');
  const createBtn = document.getElementById('btn-create-module-in-chr');

  title.textContent   = display;
  metaEl.textContent  = '';
  body.innerHTML      = SPINNER;
  modal.classList.add('open');

  // Sync tab buttons
  document.querySelectorAll('.chr-detail-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.chdTab === _chrDetailTab));
  createBtn.style.display = _chrDetailTab === 'modules' ? '' : 'none';

  // startDate from cache
  const cachedChr = (STATE.chronicles || []).find(c => c.slug === slug);
  if (cachedChr?.startDate) metaEl.textContent = `Начало: ${cachedChr.startDate}`;

  const qs          = window.location.search;
  const periodWrap  = document.getElementById('chd-period-wrap');
  const periodInput = document.getElementById('chd-period-input');
  const periodList  = document.getElementById('chd-period-list');

  periodWrap.style.display = _chrDetailTab === 'events' ? '' : 'none';

  // Reset the recap + director panels on every (re)open / tab switch
  const recapPanel = document.getElementById('chd-recap-panel');
  if (recapPanel) { recapPanel.style.display = 'none'; recapPanel.innerHTML = ''; }
  const dirPanel = document.getElementById('chd-director-panel');
  if (dirPanel) { dirPanel.style.display = 'none'; dirPanel.innerHTML = ''; }

  if (_chrDetailTab === 'modules') {
    periodInput.value = '';
    try {
      const mods = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/modules${qs}`).then(r => r.json());
      if (!mods.length) {
        body.innerHTML = '<div class="loading-state" style="height:100px">Модули не найдены — создай первый</div>';
        return;
      }
      body.innerHTML = `<div class="chd-mod-grid">${mods.map(m => renderModuleCardInChr(m, slug)).join('')}</div>`;
    } catch {
      body.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
    }
  } else {
    // Events tab — load once, cache on STATE
    try {
      await Promise.all([ensureCharsLoaded(), ensureLocsLoaded()]);
      const events = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/events${qs}`).then(r => r.json());
      STATE._chrEvents = STATE._chrEvents || {};
      STATE._chrEvents[slug] = events;

      // Build datalist from event dates (unique year+month combos)
      _buildPeriodDatalist(events, periodList);

      _renderChrEvents(events, periodInput.value.trim());
    } catch {
      body.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить события</div>';
    }
  }
}

// ── Period datalist & filter ──────────────────────────────────────────────────

const RU_MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const RU_MONTHS_NOM = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const RU_MONTH_MAP  = {
  'янв':1,'фев':2,'мар':3,'апр':4,'май':5,'мая':5,'июн':6,'июл':7,'авг':8,'сен':9,'окт':10,'ноя':11,'дек':12
};

function _buildPeriodDatalist(events, datalist) {
  const seen = new Set();
  const opts = [];

  for (const ev of events) {
    const s = (ev.date || '').toLowerCase();
    const ym = s.match(/(\d{4})/);
    if (!ym) continue;
    const year = ym[1];
    let month = 0;
    for (const [stem, n] of Object.entries(RU_MONTH_MAP)) { if (s.includes(stem)) { month = n; break; } }
    if (!month) continue;
    const key = `${year}-${String(month).padStart(2,'0')}`;
    if (!seen.has(key)) {
      seen.add(key);
      opts.push({ key, label: `${RU_MONTHS_NOM[month-1].charAt(0).toUpperCase()}${RU_MONTHS_NOM[month-1].slice(1)} ${year}` });
    }
  }

  // Sort newest first
  opts.sort((a, b) => b.key.localeCompare(a.key));
  datalist.innerHTML = opts.map(o => `<option value="${o.label}">`).join('');
}

function _periodMatchesEvent(ev, period) {
  if (!period) return true;
  const p = period.toLowerCase().trim();
  const s = (ev.date || '').toLowerCase();
  // Match year
  const yearM = p.match(/\d{4}/);
  if (yearM && !s.includes(yearM[0])) return false;
  // Match month (first 3 chars)
  const monthStem = p.replace(/\d{4}/g, '').trim().slice(0, 3);
  if (monthStem.length >= 3) {
    const monthNum = RU_MONTH_MAP[monthStem] || 0;
    if (monthNum) {
      let found = false;
      for (const [stem, n] of Object.entries(RU_MONTH_MAP)) { if (n === monthNum && s.includes(stem)) { found = true; break; } }
      if (!found) return false;
    }
  }
  return true;
}

function _renderChrEvents(events, period) {
  const body = document.getElementById('chr-detail-body');
  const filtered = events.filter(ev => _periodMatchesEvent(ev, period));
  body.innerHTML = filtered.length
    ? `<div class="chd-events-wrap">${renderTimeline(filtered)}</div>`
    : '<div class="loading-state" style="height:80px">Нет событий за выбранный период</div>';
}

// Period input — filter on change (with 3-char autocomplete threshold)
document.getElementById('chd-period-input').addEventListener('input', e => {
  const val = e.target.value.trim();
  if (!_chrDetailSlug) return;
  const events = STATE._chrEvents?.[_chrDetailSlug] || [];
  // Apply filter immediately if value matches a full suggestion or ≥3 chars
  if (val.length === 0 || val.length >= 3) _renderChrEvents(events, val);
});

// Tab switching inside chronicle modal
document.querySelectorAll('.chr-detail-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (_chrDetailSlug) openChrDetail(_chrDetailSlug, _chrDetailDisplay, btn.dataset.chdTab);
  });
});

// Open detail on chronicle card click (but not on delete button)
document.addEventListener('click', e => {
  if (e.target.closest('.chr-delete-btn')) return;
  const card = e.target.closest('.chp-card');
  if (!card) return;
  const slug    = card.dataset.slug;
  const display = card.querySelector('.chp-card-name')?.textContent || slug;
  openChrDetail(slug, display, 'modules');
});

// Click on module card inside chronicle modal → open module detail
document.getElementById('chr-detail-body').addEventListener('click', e => {
  if (e.target.closest('.chd-mod-del-btn'))  return;
  if (e.target.closest('.chd-mod-fill-btn')) return;
  const finaleBadge = e.target.closest('[data-open-finale]');
  if (finaleBadge) { openFinalePreview(finaleBadge.dataset.chr, finaleBadge.dataset.mod); return; }
  // chip links (events tab)
  const chipMod = e.target.closest('.chip-mod');
  if (chipMod) {
    const chr = chipMod.dataset.chr || _chrDetailSlug || '';
    openModulePage(chr, chipMod.dataset.mod);
    return;
  }
  const chipChar = e.target.closest('.chip-char');
  if (chipChar) { /* open char detail if needed */ return; }
  const toggle = e.target.closest('.chron-toggle');
  if (toggle) {
    const id = toggle.dataset.id;
    const bodyEl = document.querySelector(`[data-body="${id}"]`);
    if (bodyEl) { bodyEl.hidden = !bodyEl.hidden; toggle.textContent = bodyEl.hidden ? 'Подробнее ▾' : 'Свернуть ▴'; }
    return;
  }
  const modCard = e.target.closest('.chd-mod-card');
  if (modCard) {
    const mod = modCard.dataset.mod;
    const chr = modCard.dataset.chr || _chrDetailSlug || '';
    if (mod) openModulePage(chr, mod);
  }
});

// Close detail modal
document.getElementById('chr-detail-close').addEventListener('click', () => {
  document.getElementById('chr-detail-modal').classList.remove('open');
});
document.getElementById('chr-detail-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('chr-detail-modal'))
    document.getElementById('chr-detail-modal').classList.remove('open');
});

// ── "Ранее в хронике…" — AI recap of recent events ────────────────────────────
let _recapRunning = false;
document.getElementById('chd-recap-btn').addEventListener('click', () => {
  if (_chrDetailSlug) _generateChrRecap(_chrDetailSlug);
});

async function _generateChrRecap(slug) {
  if (_recapRunning) return;
  _recapRunning = true;
  const btn       = document.getElementById('chd-recap-btn');
  const panel     = document.getElementById('chd-recap-panel');
  const origLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация…'; }
  if (panel) {
    panel.style.display = '';
    panel.innerHTML = '<div class="chd-recap-loading"><div class="spinner"></div>Собираю пересказ последних событий…</div>';
  }
  try {
    const qs        = window.location.search;
    const featPrefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref      = _getPref(featPrefs, 'prose', 'openrouter');
    const preferSource = pref.provider;
    const orModel   = preferSource === 'openrouter' ? (pref.model || null) : null;

    const resp = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/recap${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 3, preferSource, orModel }),
    });
    const d = await resp.json().catch(() => ({}));

    if (resp.status === 429 || d.rateLimited) {
      panel.innerHTML = '<div class="chd-recap-err">Превышен лимит запросов к API. Подождите минуту и попробуйте снова, или смените модель в Настройках AI.</div>';
      return;
    }
    if (!d.ok) {
      panel.innerHTML = `<div class="chd-recap-err">⚠ ${escHtml(d.error || 'Не удалось сгенерировать рекап')}</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="chd-recap-head">
        <span class="chd-recap-title">📺 Ранее в хронике…</span>
        <span class="chd-recap-meta">по ${d.eventsUsed} событиям · ${escHtml(d.source || '')}</span>
        <button class="chd-recap-copy" id="chd-recap-copy">⧉ Копировать</button>
        <button class="chd-recap-close" id="chd-recap-close" title="Закрыть">✕</button>
      </div>
      <div class="chd-recap-text">${escHtml(d.recap).replace(/\n/g, '<br>')}</div>`;
    document.getElementById('chd-recap-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(d.recap).then(() => {
        const b = document.getElementById('chd-recap-copy');
        if (b) { b.textContent = '✓ Скопировано'; setTimeout(() => { b.textContent = '⧉ Копировать'; }, 1500); }
      }).catch(() => {});
    });
    document.getElementById('chd-recap-close').addEventListener('click', () => {
      panel.style.display = 'none'; panel.innerHTML = '';
    });
  } catch (e) {
    if (panel) panel.innerHTML = `<div class="chd-recap-err">⚠ ${escHtml(e.message)}</div>`;
  } finally {
    _recapRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = origLabel || '📺 Ранее в хронике…'; }
  }
}

// ── AI Director — propose next scene ─────────────────────────────────────────
let _directorRunning = false;
document.getElementById('chd-director-btn').addEventListener('click', () => {
  if (_chrDetailSlug) _runDirector(_chrDetailSlug);
});

async function _runDirector(slug) {
  if (_directorRunning) return;
  _directorRunning = true;
  const btn   = document.getElementById('chd-director-btn');
  const panel = document.getElementById('chd-director-panel');
  const orig  = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  if (panel) {
    panel.style.display = '';
    panel.innerHTML = '<div class="chd-recap-loading"><div class="spinner"></div>Анализирую хронику…</div>';
  }
  try {
    const qs   = window.location.search;
    const resp = await fetch(`/api/director/propose${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chronicle: slug }),
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok || !d.ok) {
      panel.innerHTML = `<div class="chd-recap-err">⚠ ${escHtml(d.error || 'Не удалось получить предложения')}</div>`;
      return;
    }
    panel.innerHTML = _renderDirectorPanel(d);
    panel.querySelector('.chd-dir-close')?.addEventListener('click', () => {
      panel.style.display = 'none'; panel.innerHTML = '';
    });
  } catch (e) {
    if (panel) panel.innerHTML = `<div class="chd-recap-err">⚠ ${escHtml(e.message)}</div>`;
  } finally {
    _directorRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = orig || '🎭 Директор'; }
  }
}

function _renderDirectorPanel(d) {
  const tension = d.tension_now ?? 0;
  const forecast = d.tension_forecast ?? tension;
  const phase = d.phase || 'setup';
  const phaseLabel = { setup: 'Завязка', conflict: 'Конфликт', climax: 'Кульминация' }[phase] || phase;

  // Tension bar color
  const barColor = tension <= 3 ? 'var(--c-info)' : tension <= 6 ? 'var(--gold)' : 'var(--crimson)';
  const barPct   = Math.round((tension / 10) * 100);

  // Scenes
  const scenesHtml = (d.suggested_scenes || []).map(s => `
    <div class="chd-dir-scene">
      <div class="chd-dir-scene-title">${escHtml(s.title || '')}</div>
      ${s.hook ? `<div class="chd-dir-scene-goal chd-dir-scene-hook">🔗 ${escHtml(s.hook)}</div>` : ''}
      ${s.goal ? `<div class="chd-dir-scene-goal">↳ ${escHtml(s.goal)}</div>` : ''}
      ${s.recommended_characters?.length ? `<div class="chd-dir-scene-chars">Персонажи: ${s.recommended_characters.map(escHtml).join(', ')}</div>` : ''}
      ${s.tension_after != null ? `<div class="chd-dir-scene-chars">Напряжение после: ${s.tension_after}/10</div>` : ''}
    </div>`).join('');

  // Warnings
  const warnsHtml = (d.warnings || []).length ? `
    <div class="chd-dir-section-label">Предупреждения</div>
    <div class="chd-dir-warnings">
      ${d.warnings.map(w => `<div class="chd-dir-warning">⚠ ${escHtml(w)}</div>`).join('')}
    </div>` : '';

  // World flags
  const flagsHtml = (d.world_flags || []).length ? `
    <div class="chd-dir-section-label">Активные нити мира</div>
    <div class="chd-dir-flags">${d.world_flags.slice(0, 5).map(f =>
      `<span class="chd-dir-flag">${escHtml(f)}</span>`
    ).join('')}</div>` : '';

  return `
    <div class="chd-dir-head">
      <span class="chd-dir-title">🎭 AI Director</span>
      <span class="chd-dir-meta">${escHtml(d.phase_goal || '')}</span>
      <button class="chd-dir-close" title="Закрыть">✕</button>
    </div>

    <div class="chd-dir-phase-row">
      <span class="chd-dir-phase chd-dir-phase--${escHtml(phase)}">${escHtml(phaseLabel)}</span>
      <span class="chd-dir-phase-goal">${escHtml(d.phase_goal || '')}</span>
    </div>

    <div class="chd-dir-tension-wrap">
      <span class="chd-dir-tension-label">Напряжение</span>
      <div class="chd-dir-tension-bar">
        <div class="chd-dir-tension-fill" style="transform:scaleX(${barPct / 100});background:${barColor}"></div>
      </div>
      <span class="chd-dir-tension-val">${tension}→${forecast}</span>
    </div>

    <div class="chd-dir-section-label">Предложения сцен</div>
    <div class="chd-dir-scenes">${scenesHtml || '<div class="chd-recap-err">Нет данных о событиях хроники</div>'}</div>

    ${flagsHtml}
    ${warnsHtml}

    <div class="chd-dir-disclaimer">AI предлагает · Рассказчик решает</div>`;
}

// ── Create module ─────────────────────────────────────────────────────────────

// ── Shared chip helper for both create and fill modals ───────────────────────

let _createPCs  = [];
let _createNPCs = [];

function _addChip(name, arr, containerId) {
  if (!name || arr.includes(name)) return;
  arr.push(name);
  const wrap = document.getElementById(containerId);
  const chip = document.createElement('span');
  chip.className = 'mod-fill-chip';
  chip.textContent = name;
  const rm = document.createElement('button');
  rm.textContent = '×'; rm.className = 'mod-fill-chip-rm';
  rm.addEventListener('click', () => { arr.splice(arr.indexOf(name), 1); chip.remove(); });
  chip.appendChild(rm);
  wrap.appendChild(chip);
}

// «Принадлежность: Персонаж игрока» (см. system/schema/card_schema.md) — либо
// устар. поле «Роль» с тем же смыслом.
function _isPcCharacter(c) {
  return /персонаж игрока/i.test(c.belonging || '') || /персонаж игрока|пк/i.test(c.role || '');
}

async function _populateCharDatalist(pcListId, npcListId) {
  await ensureCharsLoaded();
  const chars = STATE.characters || [];
  const pcs   = chars.filter(_isPcCharacter);
  document.getElementById(pcListId).innerHTML  = pcs.map(c   => `<option value="${escHtml(c.name)}">`).join('');
  document.getElementById(npcListId).innerHTML = chars.map(c => `<option value="${escHtml(c.name)}">`).join('');
}

// ── New module modal ──────────────────────────────────────────────────────────

document.getElementById('btn-create-module-in-chr').addEventListener('click', () => {
  openModCreateModal(false);
});

document.getElementById('btn-create-module-standalone').addEventListener('click', () => {
  openModCreateModal(true);
});

async function openModCreateModal(standalone) {
  if (_modCreateOpening) return;
  _modCreateOpening = true;
  try {
    _modCreateStandalone = standalone;
    _createPCs  = []; _createNPCs = [];
    ['mod-create-name','mod-create-time','mod-create-slug','mod-create-content','mod-create-tone','mod-create-format'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('mod-create-type').value = 'Игровая сессия';
    document.getElementById('mod-create-pcs').innerHTML  = '';
    document.getElementById('mod-create-npcs').innerHTML = '';
    document.getElementById('mod-create-error').style.display = 'none';
    _modSlugEdited = false;

    const trackCb = document.getElementById('mod-create-track');
    if (trackCb) trackCb.checked = true; // default — сбрасывается при выборе хроники

    const chrRow = document.getElementById('mod-create-chr-row');
    if (standalone) {
      chrRow.style.display = '';
      await _loadChrSelect();
    } else {
      chrRow.style.display = 'none';
    }

    document.getElementById('mod-create-modal').classList.add('open');
    setTimeout(() => document.getElementById('mod-create-name').focus(), 50);
    _populateCharDatalist('mod-create-pc-list', 'mod-create-npc-list');
  } finally {
    _modCreateOpening = false;
  }
}

document.getElementById('mod-create-name').addEventListener('input', e => {
  if (!_modSlugEdited) document.getElementById('mod-create-slug').value = slugifyChr(e.target.value);
});
document.getElementById('mod-create-slug').addEventListener('input', () => { _modSlugEdited = true; });
document.getElementById('mod-create-chr').addEventListener('change', e => { _updateTrackCheckbox(e.target.value); });

document.getElementById('mod-create-add-pc').addEventListener('click', () => {
  const v = document.getElementById('mod-create-pc-input').value.trim();
  _addChip(v, _createPCs, 'mod-create-pcs');
  document.getElementById('mod-create-pc-input').value = '';
});
document.getElementById('mod-create-add-npc').addEventListener('click', () => {
  const v = document.getElementById('mod-create-npc-input').value.trim();
  _addChip(v, _createNPCs, 'mod-create-npcs');
  document.getElementById('mod-create-npc-input').value = '';
});
document.getElementById('mod-create-pc-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('mod-create-add-pc').click(); }
});
document.getElementById('mod-create-npc-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('mod-create-add-npc').click(); }
});

document.getElementById('mod-create-cancel').addEventListener('click', () => {
  document.getElementById('mod-create-modal').classList.remove('open');
});
document.getElementById('mod-create-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mod-create-modal'))
    document.getElementById('mod-create-modal').classList.remove('open');
});

document.getElementById('mod-create-submit').addEventListener('click', async () => {
  const name    = document.getElementById('mod-create-name').value.trim();
  const time    = document.getElementById('mod-create-time').value.trim();
  const slug    = document.getElementById('mod-create-slug').value.trim() || slugifyChr(name);
  const type    = document.getElementById('mod-create-type').value.trim();
  const tone    = document.getElementById('mod-create-tone').value.trim();
  const format  = document.getElementById('mod-create-format').value.trim();
  const content = document.getElementById('mod-create-content').value.trim();
  const errEl   = document.getElementById('mod-create-error');
  const btn     = document.getElementById('mod-create-submit');

  if (!name) { errEl.textContent = 'Введи название модуля'; errEl.style.display = ''; return; }
  if (!time) { errEl.textContent = 'Укажи время/дату модуля — нужно для проверки таймлайна (желательно с годом)'; errEl.style.display = ''; return; }
  if (!/\b(?:19|20)\d{2}\b/.test(time) &&
      !await showConfirm('В поле «Время» нет года. Без года проверка таймлайна менее точна. Всё равно создать?', { confirmText: 'Создать' })) return;
  errEl.style.display = 'none';

  const chr = _getModCreateChr();
  if (!chr) { errEl.textContent = 'Выбери хронику'; errEl.style.display = ''; return; }

  btn.disabled = true;
  btn.textContent = '⏳ Создание...';

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles/${encodeURIComponent(chr)}/modules${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, time, slug, type, tone, format, pcs: _createPCs, npcs: _createNPCs, content,
          trackInChronology: document.getElementById('mod-create-track')?.checked !== false }) }
    ).then(r => r.json());

    if (!d.ok) { errEl.textContent = d.error || 'Ошибка'; errEl.style.display = ''; return; }

    document.getElementById('mod-create-modal').classList.remove('open');
    if (_modCreateStandalone) {
      loadModules();
    } else {
      openChrDetail(_chrDetailSlug, _chrDetailDisplay, 'modules');
    }
  } catch (e) {
    errEl.textContent = 'Ошибка: ' + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Создать';
  }
});

document.getElementById('mod-create-modal').addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('mod-create-modal').classList.remove('open');
});

// ── Generate scenario modal (for existing modules) ────────────────────────────

let _fillModTarget   = null; // { chr, mod }
let _fillPCs         = [];
let _fillNPCs        = [];
let _fillFromModPage = false;

async function openFillModal(chr, mod, title, fromModPage = false) {
  _fillFromModPage = fromModPage;
  _fillModTarget = { chr, mod };
  _fillPCs  = []; _fillNPCs = [];
  document.getElementById('mod-fill-pcs').innerHTML   = '';
  document.getElementById('mod-fill-npcs').innerHTML  = '';
  document.getElementById('mod-fill-pc-input').value  = '';
  document.getElementById('mod-fill-npc-input').value = '';
  document.getElementById('mod-fill-content').value   = '';
  document.getElementById('mod-fill-error').style.display = 'none';
  document.getElementById('mod-fill-title').textContent = `🪄 Сгенерировать сценарий: ${title}`;
  document.getElementById('mod-fill-modal').classList.add('open');
  _populateCharDatalist('mod-fill-pc-list', 'mod-fill-npc-list');
}

document.getElementById('mod-fill-add-pc').addEventListener('click', () => {
  const v = document.getElementById('mod-fill-pc-input').value.trim();
  _addChip(v, _fillPCs, 'mod-fill-pcs');
  document.getElementById('mod-fill-pc-input').value = '';
});
document.getElementById('mod-fill-add-npc').addEventListener('click', () => {
  const v = document.getElementById('mod-fill-npc-input').value.trim();
  _addChip(v, _fillNPCs, 'mod-fill-npcs');
  document.getElementById('mod-fill-npc-input').value = '';
});
document.getElementById('mod-fill-pc-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('mod-fill-add-pc').click(); }
});
document.getElementById('mod-fill-npc-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('mod-fill-add-npc').click(); }
});

document.getElementById('mod-fill-cancel').addEventListener('click', () => {
  document.getElementById('mod-fill-modal').classList.remove('open');
  _fillModTarget = null;
});
document.getElementById('mod-fill-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mod-fill-modal')) {
    document.getElementById('mod-fill-modal').classList.remove('open');
    _fillModTarget = null;
  }
});

document.getElementById('mod-fill-generate').addEventListener('click', async () => {
  if (!_fillModTarget) return;
  const content = document.getElementById('mod-fill-content').value.trim();
  const errEl   = document.getElementById('mod-fill-error');
  const btn     = document.getElementById('mod-fill-generate');
  if (!content) { errEl.textContent = 'Заполни поле «Содержание модуля»'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = '⏳ Генерация сценария...';

  try {
    const qs      = window.location.search;
    const prefs   = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const locPref = _getPref(prefs, 'locations', 'openrouter');
    const d  = await fetch(
      `/api/chronicles/${encodeURIComponent(_fillModTarget.chr)}/modules/${encodeURIComponent(_fillModTarget.mod)}/fill${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcs: _fillPCs, npcs: _fillNPCs, content, locSource: locPref.provider, locModel: locPref.model }) }
    ).then(r => r.json());

    if (!d.ok) { errEl.textContent = d.error || 'Ошибка генерации'; errEl.style.display = ''; return; }

    document.getElementById('mod-fill-modal').classList.remove('open');
    const fromMod = _fillFromModPage;
    _fillModTarget   = null;
    _fillFromModPage = false;
    if (fromMod) { loadModulePage(); }
    else if (_chrDetailSlug) { openChrDetail(_chrDetailSlug, _chrDetailDisplay, 'modules'); }

    const locMsg = d.locations?.length
      ? `\n📍 Создано локаций: ${d.locations.length} (${d.locations.join(', ')})`
      : '';
    showToast(`✓ Сценарий сгенерирован: ${d.file}${locMsg}`, 'success');
  } catch (e) {
    errEl.textContent = 'Ошибка: ' + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = '⚡ Сгенерировать сценарий';
  }
});

// ── Delete module ─────────────────────────────────────────────────────────────

document.addEventListener('click', e => {
  const delBtn = e.target.closest('.chd-mod-del-btn') || e.target.closest('.module-del-btn');
  if (!delBtn) return;
  _modDeleteSource  = e.target.closest('.module-del-btn') ? 'modules-page' : 'chr-detail';
  _modDeleteTarget  = { chr: delBtn.dataset.chr, mod: delBtn.dataset.mod };
  const body    = document.getElementById('mod-delete-body');
  const confirm = document.getElementById('mod-delete-confirm');
  confirm.disabled = false;
  body.innerHTML = `
    <div class="chr-modal-warn">Необратимое действие — модуль <b>${escHtml(_modDeleteTarget.mod)}</b> будет удалён.</div>
    <div class="chr-modal-section"><b>Будут удалены:</b>
      <ul>
        <li>Файлы модуля (сценарий, НПС, финал)</li>
        <li>Эпизодические персонажи модуля</li>
        <li>Связанные события из хроники</li>
        <li>Ссылки на модуль в дневниках персонажей</li>
      </ul>
      Канонические персонажи <b>не затрагиваются</b>.
    </div>`;
  document.getElementById('mod-delete-modal').classList.add('open');
});

document.getElementById('mod-delete-cancel').addEventListener('click', () => {
  document.getElementById('mod-delete-modal').classList.remove('open');
  _modDeleteTarget = null;
});
document.getElementById('mod-delete-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mod-delete-modal')) {
    document.getElementById('mod-delete-modal').classList.remove('open');
    _modDeleteTarget = null;
  }
});

document.getElementById('mod-delete-confirm').addEventListener('click', async () => {
  if (!_modDeleteTarget) return;
  const { chr, mod } = _modDeleteTarget;
  const confirm = document.getElementById('mod-delete-confirm');
  const body    = document.getElementById('mod-delete-body');
  confirm.disabled = true; confirm.textContent = '⏳ Удаление...';

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}${qs}`,
      { method: 'DELETE' }).then(r => r.json());

    if (!d.ok) throw new Error(d.error || 'Ошибка');
    const cleaned = d.cleanedChars?.length ? `<br>Очищено дневников: ${d.cleanedChars.length}` : '';
    body.innerHTML = `<div style="color:var(--accent1)">✓ Модуль <b>${escHtml(mod)}</b> удалён.${cleaned}</div>`;
    setTimeout(() => {
      document.getElementById('mod-delete-modal').classList.remove('open');
      _modDeleteTarget = null;
      confirm.textContent = 'Удалить';
      if (_modDeleteSource === 'modules-page') {
        loadModules();
      } else {
        openChrDetail(chr, _chrDetailDisplay, 'modules');
      }
    }, 1500);
  } catch (err) {
    body.innerHTML = `<div style="color:var(--accent2)">Ошибка: ${escHtml(err.message)}</div>`;
    confirm.disabled = false; confirm.textContent = 'Удалить';
  }
});

// ── Create chronicle modal ────────────────────────────────────────────────────

const slugifyChr = slugifyJS;  // alias — one browser slug impl (see slugifyJS / _NTR)

let _slugEdited = false;

document.getElementById('btn-create-chronicle').addEventListener('click', () => {
  document.getElementById('chr-create-name').value  = '';
  document.getElementById('chr-create-slug').value  = '';
  document.getElementById('chr-create-mood').value  = '';
  document.getElementById('chr-create-error').style.display = 'none';
  _slugEdited = false;
  document.getElementById('chr-create-modal').classList.add('open');
  setTimeout(() => document.getElementById('chr-create-name').focus(), 50);
});

document.getElementById('chr-create-name').addEventListener('input', e => {
  if (!_slugEdited) document.getElementById('chr-create-slug').value = slugifyChr(e.target.value);
});
document.getElementById('chr-create-slug').addEventListener('input', () => { _slugEdited = true; });

document.getElementById('chr-create-cancel').addEventListener('click', () => {
  document.getElementById('chr-create-modal').classList.remove('open');
});
document.getElementById('chr-create-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('chr-create-modal'))
    document.getElementById('chr-create-modal').classList.remove('open');
});

document.getElementById('chr-create-submit').addEventListener('click', async () => {
  const name  = document.getElementById('chr-create-name').value.trim();
  const slug  = document.getElementById('chr-create-slug').value.trim() || slugifyChr(name);
  const mood  = document.getElementById('chr-create-mood').value.trim();
  const errEl = document.getElementById('chr-create-error');
  const btn   = document.getElementById('chr-create-submit');

  if (!name) { errEl.textContent = 'Введи название хроники'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = '⏳ Создание...';

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, mood }) }).then(r => r.json());

    if (!d.ok) { errEl.textContent = d.error || 'Ошибка'; errEl.style.display = ''; return; }

    document.getElementById('chr-create-modal').classList.remove('open');
    loadChroniclesPage();
  } catch (e) {
    errEl.textContent = 'Ошибка соединения: ' + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Создать';
  }
});

// Enter submits form
document.getElementById('chr-create-modal').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('chr-create-submit').click();
  if (e.key === 'Escape') document.getElementById('chr-create-modal').classList.remove('open');
});

// ── Delete modal logic ────────────────────────────────────────────────────────

let _chrDeleteSlug = null;

document.addEventListener('click', async e => {
  const delBtn = e.target.closest('.chr-delete-btn');
  if (!delBtn) return;

  const slug    = delBtn.dataset.slug;
  const modal   = document.getElementById('chr-delete-modal');
  const body    = document.getElementById('chr-delete-body');
  const confirm = document.getElementById('chr-delete-confirm');
  _chrDeleteSlug = slug;
  confirm.disabled = true;
  modal.classList.add('open');
  body.innerHTML = '<div class="loading-state" style="height:80px"><div class="spinner"></div>Анализ...</div>';

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/delete-preview${qs}`).then(r => r.json());
    if (d.error) throw new Error(d.error);

    const tempHtml = d.tempChars.length
      ? `<div class="chr-modal-section">
          <b>Временные НПС → <code>nps_time/</code>:</b>
          <ul>${d.tempChars.map(c => `<li>${escHtml(c.name)} <span class="chr-modal-dim">(${escHtml(c.lineageFolder)}/${escHtml(c.slug)})</span></li>`).join('')}</ul>
         </div>`
      : '<div class="chr-modal-section chr-modal-dim">Временных НПС не обнаружено.</div>';

    body.innerHTML = `
      <div class="chr-modal-warn">Это действие необратимо. Будет удалена хроника <b>${escHtml(slug)}</b>.</div>
      <div class="chr-modal-section"><b>Файлов к удалению:</b> ${d.filesToDelete.length}</div>
      ${tempHtml}
      <div class="chr-modal-section">Персонажи из основной базы <b>не затрагиваются</b>.</div>`;
    confirm.disabled = false;
  } catch (err) {
    body.innerHTML = `<div style="color:var(--accent2)">Ошибка: ${escHtml(err.message)}</div>`;
  }
});

document.getElementById('chr-delete-cancel').addEventListener('click', () => {
  document.getElementById('chr-delete-modal').classList.remove('open');
  _chrDeleteSlug = null;
});
document.getElementById('chr-delete-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('chr-delete-modal')) {
    document.getElementById('chr-delete-modal').classList.remove('open');
    _chrDeleteSlug = null;
  }
});

document.getElementById('chr-delete-confirm').addEventListener('click', async () => {
  if (!_chrDeleteSlug) return;
  const slug    = _chrDeleteSlug;
  const confirm = document.getElementById('chr-delete-confirm');
  const body    = document.getElementById('chr-delete-body');
  confirm.disabled = true;
  confirm.textContent = '⏳ Удаление...';
  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles/${encodeURIComponent(slug)}${qs}`,
      { method: 'DELETE' }).then(r => r.json());
    if (!d.ok) throw new Error(d.error || 'Ошибка удаления');

    const movedMsg = d.moved?.length
      ? `<br>НПС перенесены в nps_time: ${d.moved.map(m => escHtml(m.name)).join(', ')}`
      : '';
    body.innerHTML = `<div style="color:var(--accent1)">✓ Хроника <b>${escHtml(slug)}</b> удалена.${movedMsg}</div>`;
    setTimeout(() => {
      document.getElementById('chr-delete-modal').classList.remove('open');
      _chrDeleteSlug = null;
      confirm.textContent = 'Удалить';
      loadChroniclesPage();
    }, 1800);
  } catch (err) {
    body.innerHTML = `<div style="color:var(--accent2)">Ошибка: ${escHtml(err.message)}</div>`;
    confirm.disabled = false;
    confirm.textContent = 'Удалить';
  }
});

async function loadModules() {
  const el = document.getElementById('modules-list');
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    const mods = await fetch('/api/modules').then(r => r.json());
    document.getElementById('modules-sub').textContent =
      mods.length ? `${mods.length} модулей` : 'Хроника';
    if (!mods.length) {
      el.innerHTML = '<div class="loading-state" style="height:120px">Модули не найдены</div>';
      return;
    }
    el.innerHTML = mods.map(m => {
      const files = [
        m.hasScenario ? '<span class="module-file">📝 Сценарий</span>' : '',
        m.hasFinale   ? `<span class="module-file file-finale" data-open-finale data-chr="${escHtml(m.chronicle || '')}" data-mod="${escHtml(m.name)}">📜 Финал</span>` : '',
        m.hasNpc      ? '<span class="module-file">👥 НПС</span>' : '',
      ].filter(Boolean).join('');
      return `
      <div class="module-card" data-name="${escHtml(m.name)}" data-chronicle="${escHtml(m.chronicle || '')}">
        <div class="module-title">${escHtml(m.title)}</div>
        ${m.time ? `<div class="module-time">${escHtml(m.time)}</div>` : ''}
        <div class="module-meta">
          ${m.tone   ? `<span class="module-tag">${escHtml(m.tone)}</span>`   : ''}
          ${m.format ? `<span class="module-tag">${escHtml(m.format)}</span>` : ''}
          ${m.type   ? `<span class="module-tag mod-type">${escHtml(m.type)}</span>` : ''}
        </div>
        ${files ? `<div class="module-files">${files}</div>` : ''}
        <div class="module-slug">${escHtml(m.name)}</div>
        <button class="module-del-btn" data-chr="${escHtml(m.chronicle || '')}" data-mod="${escHtml(m.name)}" title="Удалить модуль">🗑</button>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
  }
}

// ── Module card click → open detail page ────────────────────────────────────

document.getElementById('modules-list').addEventListener('click', e => {
  if (e.target.closest('.module-del-btn')) return;
  const finaleBadge = e.target.closest('[data-open-finale]');
  if (finaleBadge) { openFinalePreview(finaleBadge.dataset.chr, finaleBadge.dataset.mod); return; }
  const card = e.target.closest('.module-card');
  if (!card) return;
  const name      = card.dataset.name;
  const chronicle = card.dataset.chronicle;
  if (!name || !chronicle) return;
  openModulePage(chronicle, name);
});

// «📜 Финал» в связанных файлах модуля → лёгкая модалка с текстом finale.md,
// без перехода на страницу модуля (тот же /detail, что и вкладка «Финал» там).
async function openFinalePreview(chr, mod) {
  if (!chr || !mod) return;
  const modal = document.getElementById('finale-preview-modal');
  const body  = document.getElementById('finale-preview-body');
  const title = document.getElementById('finale-preview-title');
  title.textContent = '📜 Финал';
  body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  modal.classList.add('open');
  try {
    const data = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${window.location.search}`
    ).then(r => r.json());
    title.textContent = `📜 Финал — ${data.title || mod}`;
    body.innerHTML = data.finale
      ? mdToHtml(data.finale)
      : '<div class="cdet-empty">Финал не найден.</div>';
  } catch {
    body.innerHTML = '<div class="cdet-empty">Не удалось загрузить финал.</div>';
  }
}
document.getElementById('finale-preview-close').addEventListener('click', () => {
  document.getElementById('finale-preview-modal').classList.remove('open');
});
document.getElementById('finale-preview-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('finale-preview-modal'))
    document.getElementById('finale-preview-modal').classList.remove('open');
});

// ── Module Detail Page ───────────────────────────────────────────────────────

STATE.currentModule = null;

function openModulePage(chronicle, name) {
  STATE.currentModule = { chronicle, name };
  document.getElementById('chr-detail-modal').classList.remove('open');
  navigate('module');
}

async function loadModulePage() {
  if (!STATE.currentModule) { navigate('modules'); return; }
  const { chronicle, name } = STATE.currentModule;
  const qs = window.location.search;

  // Reset tab to info
  document.querySelectorAll('.modp-tab').forEach(b => b.classList.toggle('active', b.dataset.modtab === 'info'));
  document.querySelectorAll('.modp-panel').forEach(p => p.classList.toggle('active', p.id === 'modp-panel-info'));

  // Show loading state (also closes header quick-edit left open from a previous module)
  document.getElementById('modp-header-edit').style.display = 'none';
  document.getElementById('modp-title').style.display  = '';
  document.getElementById('modp-badges').style.display  = '';
  document.getElementById('modp-title').textContent = '⏳ Загрузка...';
  document.getElementById('modp-badges').innerHTML = '';
  ['info','scenario','events','npcs','locations','threads'].forEach(t =>
    document.getElementById(`modp-panel-${t}`).innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>');

  try {
    const [data] = await Promise.all([
      fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/detail${qs}`).then(r => r.json()),
      // Reuse the roster so НПС-names can link to their cards (and openCharDetail works)
      STATE.characters.length ? Promise.resolve()
        : fetch(`/api/characters${qs}`).then(r => r.json()).then(d => { STATE.characters = Array.isArray(d) ? d : []; }).catch(() => {}),
    ]);
    if (data.error) throw new Error(data.error);
    renderModulePage(data);
  } catch (e) {
    document.getElementById('modp-title').textContent = 'Ошибка загрузки';
    document.getElementById('modp-panel-info').innerHTML = `<div class="modp-empty"><div class="modp-empty-icon">⚠</div>${escHtml(e.message)}</div>`;
  }
}

// Permanent scene-picker option — игроки могут отступать от сценария (VtM)
const SCENE_OFF_SCRIPT = 'События вне сценария';

// Resolve a character by name (exact, ё-insensitive) against the loaded roster.
function _findCharByName(name) {
  const n = (name || '').toLowerCase().replace(/ё/g, 'е').trim();
  return (STATE.characters || []).find(c => (c.name || '').toLowerCase().replace(/ё/g, 'е').trim() === n);
}

// Generic placeholders in npc.md desc that just repeat the section — hidden in the UI.
const NPC_DESC_NOISE = /^(персонаж игрока|пк|роль(\s+в\s+модуле)?|нпс)$/i;

// Render the «НПС» tab from structured groups: clickable name (→ card), trimmed desc,
// and a per-NPC «Реплика НПС» box (situation textarea + generate button).
// Карточки НПС модуля (`.char-card`, переиспользуется с главной сетки персонажей —
// см. renderChars) — по аналогии с «Связанными локациями» (_locCardHtml/.modp-loc-cards
// в locations.js). Канон-НПС кликабельны (открывают карточку через уже существующий
// делегированный обработчик [data-open-char] ниже), модульные (неканоничные) — превью
// без клика: у них нет отдельной карточки в общем реестре персонажей.
function _renderModuleNpcCards(groups) {
  const entries = groups.filter(g => g.kind !== 'pc').flatMap(g => g.entries);
  if (!entries.length) return '';
  const cards = entries.map(e => {
    // e.name — сырой текст из npc.md (может отличаться от канонич. имени карточки,
    // напр. «Кален Урес / Госпожа Бубенчик» вместо «Госпожа Бубенчик») — как и
    // в _renderModuleNpcGroups, резолвим через ростер и кликаем по known.name.
    const known = e.sheetScope === 'character' ? _findCharByName(e.name) : null;
    const clickable = !!known;
    const icon = LINEAGE_ICONS[e.lineage] || '👤';
    const subtitle = e.clan || (e.sheetScope === 'module' ? 'Модульный НПС' : 'НПС');
    const textBlock = `
      <div class="char-name">${escHtml(e.name)}</div>
      <div class="char-clan">${escHtml(subtitle)}</div>`;
    const attrs = clickable ? `data-open-char="${escAttr(known.name)}"` : '';
    const staticCls = clickable ? '' : ' modp-npc-card-static';
    const delGroup = e.sheetScope === 'module' ? 'modular' : 'canon';
    // Без event.stopPropagation() — обработчик клика на #modp-panel-npcs уже
    // проверяет [data-npc-del-name] раньше [data-open-char] и делает return,
    // так что открытие карточки персонажа не срабатывает при клике по ✕
    // (см. делегированный обработчик ниже); stopPropagation тут не нужен и
    // раньше приводил к тому, что событие вообще не доходило до панели.
    const delBtn = `<button class="modp-npc-card-del" data-npc-del-name="${escAttr(e.name)}"
      data-npc-del-group="${delGroup}" title="Удалить из модуля">✕</button>`;
    if (e.imageUrl) {
      return `<div class="char-card has-art modp-npc-card${staticCls}" ${attrs}>
        <img class="char-card-art" src="${escHtml(e.imageUrl)}" alt="${escHtml(e.name)}" loading="lazy" decoding="async">
        <div class="char-card-overlay">${textBlock}</div>
        ${delBtn}
      </div>`;
    }
    return `<div class="char-card modp-npc-card${staticCls}" ${attrs}>
      <span class="char-lineage-icon">${icon}</span>
      ${textBlock}
      ${delBtn}
    </div>`;
  }).join('');
  return `<div class="modp-char-cards">${cards}</div>`;
}

function _renderModuleNpcGroups(groups) {
  return groups.map(g => {
    const entries = g.entries.map(e => {
      const known    = _findCharByName(e.name);
      const nameHtml = known
        ? `<a class="modp-npc-name modp-npc-link" data-open-char="${escAttr(known.name)}" title="Открыть карточку">${escHtml(e.name)}</a>`
        : `<span class="modp-npc-name">${escHtml(e.name)}</span>`;
      const desc     = (e.desc || '').trim();
      const descHtml = (desc && !NPC_DESC_NOISE.test(desc))
        ? `<span class="modp-npc-desc">${escHtml(desc)}</span>` : '';
      // Лист персонажа — кнопки напротив имени (если контекст листа разрешим)
      const sheetCtl = e.slug ? `
        <div class="modp-npc-sheet" data-sheet-scope="${e.sheetScope}" data-sheet-name="${escAttr(e.name)}" data-sheet-slug="${escAttr(e.slug)}">
          ${ e.hasSheet
            ? `<button class="modp-sheet-btn" data-sheet-act="view">📋 Лист персонажа</button>
               <button class="modp-sheet-btn ghost" data-sheet-act="regen" title="Перегенерировать лист">♻</button>
               <button class="modp-sheet-btn ghost" data-sheet-act="edit" title="Редактировать лист">✏</button>`
            : `<button class="modp-sheet-btn" data-sheet-act="gen">📋 Сгенерировать лист</button>` }
        </div>` : '';
      // Promote button — only for modular NPCs
      let promoteCtl = '';
      if (g.kind === 'modular' && e.slug) {
        const pc = e.promoteCheck;
        const allMet = pc && pc.survived && pc.inFinale && pc.inMultipleModules;
        const tip = pc
          ? `${pc.survived ? '✓' : '✗'} выжил · ${pc.inFinale ? '✓' : '✗'} в финале · ${pc.inMultipleModules ? '✓' : '✗'} 2+ модулей`
          : 'Условия не проверены';
        promoteCtl = `<button class="modp-promote-btn${allMet ? ' ready' : ''}"
          data-promote-slug="${escAttr(e.slug)}" data-promote-name="${escAttr(e.name)}"
          title="${escAttr(tip)}">⬆ В канон</button>`;
      }
      // Удалить из модуля — и НПС, и ПК (только запись в npc.md; для модульных
      // НПС дополнительно удаляется их собственная карточка npc/<slug>/, т.к.
      // она существует только в рамках этого модуля — см. showConfirm ниже).
      const delCtl = `<button class="modp-npc-del-btn" data-npc-del-name="${escAttr(e.name)}"
        data-npc-del-group="${g.kind}" title="Удалить из модуля">🗑</button>`;
      // Реплики — только для НПС (ПК озвучивают игроки, не Мастер)
      const dlg = g.kind !== 'pc' ? `
        <div class="modp-npc-dlg">
          <textarea class="modp-npc-sit" rows="2" placeholder="Ситуация в сцене / на что отвечает НПС"></textarea>
          <button class="modp-npc-dlg-btn" data-npc-name="${escAttr(e.name)}" data-npc-modular="${g.kind === 'modular' ? 1 : 0}">💬 Реплика НПС</button>
          <div class="modp-npc-dlg-result" style="display:none"></div>
        </div>` : '';
      return `<div class="modp-npc-entry">
        <div class="modp-npc-head">
          <div class="modp-npc-head-main">${nameHtml}${descHtml}</div>
          <div class="modp-npc-actions">${sheetCtl}${promoteCtl}${delCtl}</div>
        </div>
        ${dlg}
      </div>`;
    }).join('');
    return `<div class="modp-npc-group">
      <div class="modp-npc-group-title">${escHtml(g.title)}</div>
      ${entries}
    </div>`;
  }).join('');
}

// Generate in-character replies for one NPC on the module page (Voice + clan style).
async function _genModuleNpcDialogue(btn) {
  const entry = btn.closest('.modp-npc-entry');
  const sit   = entry.querySelector('.modp-npc-sit');
  const box   = entry.querySelector('.modp-npc-dlg-result');
  const name  = btn.dataset.npcName;
  const modular = btn.dataset.npcModular === '1';
  const situation = sit?.value.trim() || '';
  box.style.display = '';
  if (!situation) { box.innerHTML = '<div class="canon-warn">Опиши ситуацию / на что отвечает НПС.</div>'; return; }
  const lbl = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Генерация…';
  box.innerHTML = '<div class="canon-loading">💬 Подбираю реплики в характере…</div>';
  try {
    const qs    = window.location.search;
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref  = _getPref(prefs, 'dialogue', 'openrouter');
    const body  = { situation, source: pref.provider, model: pref.model };
    // Модульные НПС не в общем реестре — подскажем серверу, где искать карточку
    if (modular && STATE.currentModule) { body.chr = STATE.currentModule.chronicle; body.mod = STATE.currentModule.name; }
    const d = await fetch(`/api/characters/${encodeURIComponent(modular ? name : _charSlug(name))}/dialogue${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    ).then(r => r.json());
    if (!d.ok) { box.innerHTML = `<div class="canon-warn">Ошибка: ${escHtml(d.error || 'не удалось')}</div>`; return; }
    const lines = (d.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    box.innerHTML = (lines.length ? _dlgFallbackNote(d.source) : '') + (lines.length
      ? `<div class="cdet-dlg-lines">${lines.map(l => `<div class="cdet-dlg-line">${escHtml(l)}</div>`).join('')}</div>`
      : '<div class="canon-warn">Пустой ответ.</div>');
  } catch (e) {
    box.innerHTML = `<div class="canon-warn">Ошибка: ${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = lbl;
  }
}

// Muted note when Claude was rate-limited and the server fell back to another provider.
function _dlgFallbackNote(source) {
  if (source === 'openrouter-fallback')
    return '<div class="canon-warn" style="margin-bottom:6px">⚠️ Claude был перегружен (429) — реплики сгенерированы резервным OpenRouter.</div>';
  if (source === 'openai-fallback')
    return '<div class="canon-warn" style="margin-bottom:6px">⚠️ Claude был перегружен (429) — реплики сгенерированы резервным GPT.</div>';
  return '';
}

function _renderParticipantChips(group, items) {
  const chips = items.map(p => {
    const nm = typeof p === 'string' ? p : (p.name || '');
    return `<div class="moddet-chip" data-name="${escHtml(nm)}">
      ${escHtml(nm)}
      <button class="moddet-chip-rm" data-rmname="${escHtml(nm)}" data-rmgroup="${group}" title="Удалить">×</button>
    </div>`;
  }).join('');
  const datalistChars = group === 'pcs' ? (STATE.characters || []).filter(_isPcCharacter) : (STATE.characters || []);
  return `
    <div class="moddet-chips-wrap" id="moddet-${group}-chips">${chips}</div>
    <div class="moddet-add-row">
      <input class="moddet-add-input" id="moddet-${group}-add-input"
        placeholder="${group === 'pcs' ? 'Имя персонажа игрока…' : 'Имя НПС…'}"
        list="moddet-${group}-datalist" autocomplete="off">
      <datalist id="moddet-${group}-datalist">
        ${datalistChars.map(c => `<option value="${escHtml(c.name)}">`).join('')}
      </datalist>
      <button class="modp-save-btn" data-addchip="${group}" style="white-space:nowrap">+ Добавить</button>
    </div>`;
}

// Браузерное зеркало lib/parsers.js: parseScenarioSections/replaceScenarioSection
// (см. комментарий там же — реальные сценарии не следуют фиксированному списку
// заголовков, поэтому парсим по ЛЮБЫМ `## `, а не по жёстко заданным именам).
function _parseScenarioSections(raw) {
  const text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n');
  const firstIdx = text.search(/^##\s+/m);
  if (firstIdx === -1) return { preamble: text, sections: [] };
  const preamble = text.slice(0, firstIdx);
  const rest = text.slice(firstIdx);
  const parts = rest.split(/\n(?=##\s+)/);
  const sections = [];
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).replace(/^##\s+/, '').trim();
    let body = nl === -1 ? '' : part.slice(nl + 1);
    body = body.replace(/\n+---+\s*$/, '').replace(/^\n+/, '').replace(/\s+$/, '');

    // Сцены, вложенные как `### ` под общим `## Сцены` — разворачиваем в
    // отдельные разделы (level 3), чтобы каждая сцена редактировалась/
    // перегенерировалась независимо. Зеркалит lib/parsers.js.
    const h3Idx = body.search(/^###\s+/m);
    if (h3Idx !== -1) {
      const intro = body.slice(0, h3Idx).replace(/\s+$/, '');
      sections.push({ heading, body: intro, level: 2, parent: null });
      const h3parts = body.slice(h3Idx).split(/\n(?=###\s+)/);
      for (const h3part of h3parts) {
        const h3nl = h3part.indexOf('\n');
        const h3heading = (h3nl === -1 ? h3part : h3part.slice(0, h3nl)).replace(/^###\s+/, '').trim();
        let h3body = h3nl === -1 ? '' : h3part.slice(h3nl + 1);
        h3body = h3body.replace(/^\n+/, '').replace(/\s+$/, '');
        sections.push({ heading: h3heading, body: h3body, level: 3, parent: heading });
      }
    } else {
      sections.push({ heading, body, level: 2, parent: null });
    }
  }
  return { preamble, sections };
}

// Рендерит вкладку «Сценарий» разбитой по разделам (## в scenario.md), каждый
// со своими кнопками «Редактировать»/«Перегенерировать». Вызывается и из
// renderModulePage, и повторно — после сохранения/регена одного раздела
// (без полной перезагрузки страницы модуля).
// Раздел «🔒 GM-справка — закрытая информация» (и синонимы) — секреты Мастера,
// вписанные AI прямо в сценарий. Здесь нет ролевой системы/отдельного вида для
// игроков — это чисто визуальная страховка при демонстрации экрана: пометить
// такие разделы и дать кнопку временно скрыть их из вида.
const MODP_GM_SECTION_RE = /🔒|GM[\s-]?справк|только\s+для\s+(мастера|рассказчика)/i;
const MODP_SCENE_ADDED_RE = /<!--\s*meta:sceneAdded:\s*1\s*-->/i;

// Пояснения к типовым блокам/полям сценария — показываются в тултипе справа
// от названия. Заголовки генерируются ИИ и не фиксированы дословно (напр.
// «Тактика Графа Жубака», «Бросок — Распознать намерения»), поэтому
// сопоставление идёт по паттернам начала строки, а не точным совпадением.
const MODP_SCENARIO_TOOLTIPS = [
  [/^🔒?\s*GM-справк/i, 'Закрытая информация только для Мастера — секреты, тайные мотивы и тактика НПС. Не показывается игрокам напрямую.'],
  [/^Что произошло до начала сессии/i, 'Контекст событий, случившихся до сессии, — чтобы Мастер понимал предысторию модуля.'],
  [/^Тайная мотивация/i, 'Скрытая цель персонажа — то, что игроки не должны узнать напрямую, но что движет его действиями.'],
  [/^Проверка таймлайна/i, 'Сверка даты модуля со статусами и связями персонажей — нет ли противоречий уже известным фактам хроники.'],
  [/— детали$/i, 'Тактика, ресурсы и манера поведения этого персонажа в модуле — подсказка Мастеру, как его отыгрывать.'],
  [/^Пролог/i, 'Как персонажи игроков вовлекаются в события модуля — завязка истории.'],
  [/^Сцена\s*\d+/i, 'Одна сцена сессии: место действия, событие, конфликт или встреча.'],
  [/^Финал/i, 'Развязка модуля — чем заканчивается история и какие последствия наступают.'],
  [/^Открытые вопросы/i, 'Нерешённые нити и последствия, которые можно продолжить в будущих сессиях хроники.'],
  [/^Колорит/i, '2-3 детали места и времени, которые нельзя перепутать с другим городом или эпохой.'],
  [/^Описание для игрока/i, 'Текст, который зачитывается или пересказывается игрокам, — то, что они видят и слышат.'],
  [/^GM[\s-]?подсказки/i, 'Советы Мастеру по ведению сцены: возможные броски, реакции НПС, развилки сюжета.'],
  [/^Бросок/i, 'Механика проверки: характеристика + способность, сложность броска, результаты успеха и провала.'],
  [/^Тактика/i, 'Как этот персонаж или НПС ведёт себя и реагирует в данной сцене.'],
  [/^Вводный текст$/i, 'Общий текст блока — вступление или связующий абзац перед перечисленными ниже полями.'],
];

function _scenarioTooltipFor(heading) {
  const h = heading || '';
  for (const [re, text] of MODP_SCENARIO_TOOLTIPS) if (re.test(h)) return text;
  return '';
}

function _scenarioTooltipHtml(heading) {
  return fieldTip(_scenarioTooltipFor(heading));
}

// Минимальный редактируемый каркас сценария (GM-справка / Пролог / Сцена 1 /
// Финал) — для ручного заполнения без ИИ-генерации. Формат/breadcrumb —
// как у AI-генерации (routes/modules.js POST .../fill), чтобы каркас потом
// парсился теми же блоками, что и сгенерированный сценарий.
function _buildScenarioSkeleton(title, modSlug) {
  return [
    `# Сценарий — ${title}`,
    '',
    `> 🔗 [Модуль](${modSlug}.md) | [Хроника](../../events.md) | [НПС](npc.md)`,
    '',
    '---',
    '',
    '## 🔒 GM-справка — закрытая информация',
    '> Читать перед игрой. Не раскрывать игроку напрямую.',
    '',
    '### Что произошло до начала сессии',
    '⚠️ Заполни.',
    '',
    '---',
    '',
    '## Пролог — Название',
    '### Описание для игрока',
    '⚠️ Заполни.',
    '',
    '### GM-подсказки',
    '⚠️ Заполни.',
    '',
    '---',
    '',
    '## Сцена 1 — Название',
    '### Описание для игрока',
    '⚠️ Заполни.',
    '',
    '### Колорит',
    '⚠️ 2-3 детали места/времени, которые нельзя перепутать с другим городом.',
    '',
    '---',
    '',
    '## Финал — Название',
    '### Описание для игрока',
    '⚠️ Заполни.',
    '',
  ].join('\n');
}

function _renderScenarioPanel(data) {
  const raw = data.scenario || '';
  const { sections } = _parseScenarioSections(raw);
  // {heading, parent} по индексу секции в плоском списке — используется при
  // сохранении/перегенерации отдельного поля (parent нужен, чтобы отличить
  // одноимённые поля разных сцен — «GM-подсказки», «Описание для игрока» и т.п.).
  STATE.scenarioSectionHeadings = sections.map(s => ({ heading: s.heading, parent: s.parent }));
  const hasGmSections = sections.some(s => MODP_GM_SECTION_RE.test(s.heading));

  // Визуально объединяем плоский список секций в блоки по родительскому
  // `##`-заголовку (GM-справка / Пролог / Сцена N / Финал) — каждый блок одна
  // карточка с общими кнопками «Редактировать»/«Перегенерировать» на весь блок,
  // а его `### `-поля внутри — со своей иконкой перегенерации.
  const blocks = [];
  sections.forEach((s, i) => {
    if (s.level === 2) blocks.push({ heading: s.heading, idx: i, introBody: s.body, fields: [] });
    else if (blocks.length) blocks[blocks.length - 1].fields.push({ heading: s.heading, body: s.body, idx: i });
  });

  const blocksHtml = blocks.length
    ? blocks.map(b => {
        const isGM = MODP_GM_SECTION_RE.test(b.heading);
        const gmAttr  = isGM ? ' data-gm="1"' : '';
        const gmBadge = isGM ? ' <span class="modp-gm-badge">🔒 Только для Мастера</span>' : '';
        const needsFinaleRegen = /^Финал(?:\s*[—–:.-].*)?$/i.test(b.heading) && MODP_SCENE_ADDED_RE.test(raw);
        const finaleWarn = needsFinaleRegen
          ? ' <span class="modp-block-warn">⚠️ Сценарий был изменён. Сгенерировать новый финал?</span>' : '';

        const items = [];
        if (b.introBody || !b.fields.length) items.push({ heading: b.fields.length ? 'Вводный текст' : '', body: b.introBody, idx: b.idx });
        items.push(...b.fields);
        const fieldIdxs = items.map(it => it.idx).join(',');

        const itemsHtml = items.map(it => `
        <div class="modp-scenario-field">
          <div class="modp-field-header-row">
            ${it.heading ? `<div class="modp-field-label">${escHtml(it.heading)}${_scenarioTooltipHtml(it.heading)}</div>` : '<div></div>'}
            <button class="modp-field-regen-btn" data-scensec-regen="${it.idx}" title="Перегенерировать только это поле">🔄</button>
          </div>
          <div id="moddet-scensec${it.idx}-view" class="modp-md">${mdToHtml(it.body)}</div>
          <div id="moddet-scensec${it.idx}-edit" style="display:none">
            <textarea class="cdet-edit-textarea" id="moddet-scensec${it.idx}-ta" rows="10"
              style="width:100%;font-family:monospace;font-size:var(--fs-sm,12px)">${escHtml(it.body)}</textarea>
          </div>
          <div class="modp-edit-bar" id="moddet-scensec${it.idx}-bar" style="display:none">
            <button class="modp-save-btn" data-savemod="scensec${it.idx}">Сохранить</button>
            <button class="modp-cancel-btn" data-cancelmod="scensec${it.idx}">Отмена</button>
            <span class="modp-save-msg" id="moddet-scensec${it.idx}-msg" style="display:none">✓ Сохранено</span>
          </div>
        </div>`).join('');

        return `
      <div class="modp-scenario-block"${gmAttr} data-field-idxs="${fieldIdxs}">
        <div class="modp-block-header-row">
          <div class="modp-block-label">${escHtml(b.heading)}${_scenarioTooltipHtml(b.heading)}${gmBadge}${finaleWarn}</div>
          <div class="modp-scenario-sec-btns">
            <button class="modp-edit-btn" data-editblock="${b.idx}">✏ Редактировать</button>
            <button class="modp-edit-btn modp-block-saveall-btn" data-blocksaveall="${b.idx}" style="display:none">💾 Сохранить всё</button>
            <button class="modp-edit-btn" data-blockregen="${b.idx}">🔄 Перегенерировать</button>
          </div>
        </div>
        <div class="modp-block-body">${itemsHtml}</div>
      </div>`;
      }).join('')
    : (raw ? `<div class="modp-md">${mdToHtml(raw)}</div>` : `
      <div class="cdet-empty">Сценарий не сгенерирован.</div>
      <div class="modp-scenario-empty-actions">
        <span class="cdet-empty">Нажми «🪄 Сгенерировать» вверху страницы для ИИ-генерации, или заполни каркас вручную:</span>
        <button class="modp-edit-btn" id="modp-scenario-manual-btn">📝 Создать вручную (пустой каркас)</button>
      </div>`);

  const panel = document.getElementById('modp-panel-scenario');
  panel.classList.toggle('modp-hide-gm', !!STATE.hideGmSections);
  panel.innerHTML = `
  <div class="modp-scenario-toolbar">
    <button class="modp-edit-btn" data-editmod="scenario">✏ Редактировать весь текст</button>
    ${raw ? `<button class="modp-edit-btn" id="modp-regen-scenario-btn" style="margin-left:8px">♻ Перегенерировать всё</button>` : ''}
    ${raw ? `<button class="modp-edit-btn" id="modp-add-scene-btn" style="margin-left:8px">➕ Добавить сцену</button>` : ''}
    ${hasGmSections ? `<button class="modp-edit-btn" id="modp-toggle-gm-btn" style="margin-left:8px">${STATE.hideGmSections ? '👁 Показать разделы Мастера' : '🙈 Скрыть разделы Мастера'}</button>` : ''}
  </div>
  <div id="moddet-scenario-view">${blocksHtml}</div>
  <div id="moddet-scenario-edit" style="display:none">
    <textarea class="cdet-edit-textarea" id="moddet-scenario-ta" rows="40"
      style="width:100%;font-family:monospace;font-size:var(--fs-sm,12px)">${escHtml(raw)}</textarea>
  </div>
  <div class="modp-edit-bar" id="moddet-scenario-bar" style="display:none">
    <button class="modp-save-btn" data-savemod="scenario">Сохранить</button>
    <button class="modp-cancel-btn" data-cancelmod="scenario">Отмена</button>
    <span class="modp-save-msg" id="moddet-scenario-msg" style="display:none">✓ Сохранено</span>
  </div>`;
}

function renderModulePage(data) {
  function modPanel(id, viewHtml, editHtml) {
    return `
    <div class="cdet-info-header">
      <button class="modp-edit-btn" data-editmod="${id}">✏ Редактировать</button>
    </div>
    <div id="moddet-${id}-view">${viewHtml}</div>
    <div id="moddet-${id}-edit" style="display:none">${editHtml}</div>
    <div class="modp-edit-bar" id="moddet-${id}-bar" style="display:none">
      <button class="modp-save-btn" data-savemod="${id}">Сохранить</button>
      <button class="modp-cancel-btn" data-cancelmod="${id}">Отмена</button>
      <span class="modp-save-msg" id="moddet-${id}-msg" style="display:none">✓ Сохранено</span>
    </div>`;
  }
  // Как modPanel, но заголовок секции и кнопка «Редактировать» — в одну строку
  // (см. «Участники»/«НПС»), а не заголовок отдельно + кнопка ниже.
  function sectionPanel(id, label, viewHtml, editHtml) {
    return `
    <div class="modp-section-header-row">
      <div class="modp-section-label">${label}</div>
      <button class="modp-edit-btn" data-editmod="${id}">✏ Редактировать</button>
    </div>
    <div id="moddet-${id}-view">${viewHtml}</div>
    <div id="moddet-${id}-edit" style="display:none">${editHtml}</div>
    <div class="modp-edit-bar" id="moddet-${id}-bar" style="display:none">
      <button class="modp-save-btn" data-savemod="${id}">Сохранить</button>
      <button class="modp-cancel-btn" data-cancelmod="${id}">Отмена</button>
      <span class="modp-save-msg" id="moddet-${id}-msg" style="display:none">✓ Сохранено</span>
    </div>`;
  }

  STATE.currentModuleData = data;
  // Header
  document.getElementById('modp-title').textContent = data.title || data.name;

  const isClosed = /закрыт/i.test(data.status || '');
  const badges = [
    data.status && `<span class="modp-badge${isClosed ? ' modp-badge-closed' : ''}">${escHtml(data.status)}</span>`,
    data.type   && `<span class="modp-badge">🎭 ${escHtml(data.type)}</span>`,
    data.time   && `<span class="modp-badge">📅 ${escHtml(data.time)}</span>`,
    data.tone   && `<span class="modp-badge">🌙 ${escHtml(data.tone)}</span>`,
    data.format && `<span class="modp-badge">📖 ${escHtml(data.format)}</span>`,
    data.chronicle && `<span class="modp-badge" style="border-color:rgba(184,134,11,0.4);color:var(--text);opacity:0.7">📕 ${escHtml(data.chronicleDisplay || data.chronicle)}</span>`,
  ].filter(Boolean).join('');
  document.getElementById('modp-badges').innerHTML = badges;

  // Disable «Закрыть модуль» if already closed
  const closeBtn = document.getElementById('modp-close-btn');
  if (closeBtn) {
    closeBtn.disabled = isClosed;
    closeBtn.textContent = isClosed ? '🔒 Закрыт' : '🔒 Закрыть модуль';
  }

  // ── Info tab ──────────────────────────────────────────────────────────────────
  // Название/Тип/Время/Тон/Формат/Хроника редактируются в шапке (modp-header-edit) —
  // здесь дублировать их не нужно.

  // Description panel
  const descViewHtml = data.description
    ? `<div class="modp-concept-text">${escHtml(data.description)}</div>`
    : '<div class="cdet-empty">Концепция не заполнена</div>';
  const descEditHtml = `<textarea class="cdet-edit-textarea" id="moddet-desc-ta" rows="8" style="width:100%">${escHtml(data.description || '')}</textarea>`;

  // Персонажи игроков / НПС — два независимых раздела, каждый со своей
  // кнопкой «Редактировать» (не общая на двоих, не таблица).
  const pcNames  = (data.pcs  || []).map(p => typeof p === 'string' ? p : (p.name || ''));
  const npcNames = (data.npcs || []).map(p => typeof p === 'string' ? p : (p.name || ''));
  const pcViewHtml  = pcNames.length
    ? `<ul class="modp-part-list">${pcNames.map(n => `<li>${escHtml(n)}</li>`).join('')}</ul>`
    : '<div class="cdet-empty">Не указаны</div>';
  const npcViewHtml = npcNames.length
    ? `<ul class="modp-part-list">${npcNames.map(n => `<li>${escHtml(n)}</li>`).join('')}</ul>`
    : '<div class="cdet-empty">Не указаны</div>';
  const pcEditHtml  = _renderParticipantChips('pcs', data.pcs || []);
  const npcEditHtml = _renderParticipantChips('npcs', data.npcs || []);

  const infoHtml = `
  <div class="modp-section-label">💡 Концепция</div>
  ${modPanel('desc', descViewHtml, descEditHtml)}
  <div class="modp-section-divider"></div>
  ${sectionPanel('pcs', '🎭 Персонажи игроков', pcViewHtml, pcEditHtml)}
  <div class="modp-section-divider"></div>
  ${sectionPanel('npcs', '👤 НПС', npcViewHtml, npcEditHtml)}`;

  document.getElementById('modp-panel-info').innerHTML = infoHtml;

  // ── СЦЕНАРИЙ (разбит по разделам — см. _renderScenarioPanel) ──
  _renderScenarioPanel(data);

  // ── ФИНАЛ (finale.md — пишется при закрытии модуля, Фаза C) ──
  const finaleRaw = data.finale || '';
  const finaleViewHtml = finaleRaw
    ? `<div class="modp-md">${mdToHtml(finaleRaw)}</div>`
    : '<div class="modp-empty"><div class="modp-empty-icon">📜</div>Финал ещё не сгенерирован — появится при закрытии модуля («🔒 Закрыть модуль»).</div>';
  document.getElementById('modp-panel-finale').innerHTML = finaleRaw
    ? modPanel('finale', finaleViewHtml,
        `<textarea class="cdet-edit-textarea" id="moddet-finale-ta" rows="20"
          style="width:100%;font-family:monospace;font-size:var(--fs-sm,12px)">${escHtml(finaleRaw)}</textarea>`)
    : finaleViewHtml;

  // ── СЕССИИ (Фаза B — ведение во время игры) ──
  const sessions = data.sessions || [];
  const today    = new Date().toISOString().slice(0, 10);
  const sessHtml = sessions.length
    ? sessions.map((s, i) => `
        <div class="modp-session" data-sess-idx="${i}">
          <div class="modp-session-head">
            <span class="modp-session-title">${escHtml(s.title)}</span>
            ${s.status ? `<span class="modp-session-status">${escHtml(s.status)}</span>` : ''}
            <button class="modp-session-edit" data-sess-idx="${i}" title="Редактировать">✏️</button>
          </div>
          ${s.scenes ? `<div class="modp-session-scenes">🎬 Сыграно сцен: ${escHtml(s.scenes)}</div>` : ''}
          ${s.body ? `<div class="modp-session-body">${mdToHtml(s.body)}</div>` : ''}
        </div>`).join('')
    : '<div class="modp-empty"><div class="modp-empty-icon">🎲</div>Сессий пока нет — добавь первую запись выше</div>';

  // Scenes from the scenario, excluding those already recorded in earlier sessions.
  // «События вне сценария» is a permanent option — игроки могут отступать от сценария.
  const playedText = sessions.map(s => s.scenes || '').join(' | ').toLowerCase();
  const sceneOpts = (data.scenes || [])
    .map(sc => (sc.date ? `${sc.date} — ${sc.title}` : sc.title))
    .filter(Boolean)
    .filter(label => {
      const datePart = (label.match(/^(?:сцена|эпизод)\s*\d+/i) || [''])[0].toLowerCase();
      if (playedText.includes(label.toLowerCase())) return false;
      if (datePart && playedText.includes(datePart)) return false;
      return true;
    });
  const attr = s => escHtml(s).replace(/"/g, '&quot;');
  const sceneSelect = `<select id="sess-scene-pick" class="modp-sf-input" title="Добавить сцену или внесценарное событие">
         <option value="">${sceneOpts.length ? '+ Сцена / событие…' : ((data.scenes && data.scenes.length) ? '✓ Все сцены сыграны — выбери:' : '+ Событие…')}</option>
         ${sceneOpts.map(l => `<option value="${attr(l)}">${escHtml(l)}</option>`).join('')}
         <option value="${attr(SCENE_OFF_SCRIPT)}">⚡ ${escHtml(SCENE_OFF_SCRIPT)}</option>
       </select>`;

  document.getElementById('modp-panel-sessions').innerHTML = `
    <div class="modp-session-form">
      <div class="modp-session-form-title">+ Запись сессии</div>
      <div class="modp-sf-row">
        <input id="sess-date" class="modp-sf-input" placeholder="Дата (напр. 2010-12-21)" value="${today}">
        <select id="sess-status" class="modp-sf-input">
          <option>🟡 В процессе</option>
          <option>🟢 Завершён</option>
        </select>
        ${sceneSelect}
      </div>
      <input id="sess-scenes" class="modp-sf-input" placeholder="Сыграно сцен (выбери из меню или впиши вручную)">
      <textarea id="sess-notes" class="modp-sf-input modp-sf-area" rows="4" placeholder="Что произошло за сессию: события, решения котери, последствия"></textarea>
      <div class="modp-sf-btns">
        <button id="sess-add-btn" class="modp-gen-btn">Добавить запись</button>
        <button id="sess-canon-btn" class="modp-canon-btn" title="Сверить текст с каноном (статусы НПС, даты, «мёртвые» в сцене)">🔍 Проверить канон</button>
      </div>
      <div id="sess-error" class="modp-sf-error" style="display:none"></div>
      <div id="sess-canon-result" class="canon-result" style="display:none"></div>
    </div>
    <div class="modp-session-list">${sessHtml}</div>`;
  document.getElementById('sess-add-btn').addEventListener('click', _addSessionEntry);
  document.getElementById('sess-canon-btn').addEventListener('click', () => {
    const scenes = document.getElementById('sess-scenes')?.value.trim() || '';
    const notes  = document.getElementById('sess-notes')?.value.trim() || '';
    const text   = [scenes && `Сыграно: ${scenes}`, notes].filter(Boolean).join('\n');
    _runCanonCheck(text, document.getElementById('sess-canon-result'), document.getElementById('sess-canon-btn'), '🔍 Проверить канон');
  });

  const scenePick = document.getElementById('sess-scene-pick');
  if (scenePick) scenePick.addEventListener('change', () => {
    const opt = scenePick.selectedOptions[0];
    const val = scenePick.value;
    if (!val) return;
    const inp   = document.getElementById('sess-scenes');
    const parts = inp.value.trim() ? inp.value.split(/\s*,\s*/).filter(Boolean) : [];
    if (!parts.includes(val)) parts.push(val);
    inp.value = parts.join(', ');
    // scenario scenes can be picked once (removed); «События вне сценария» stays
    if (opt && val !== SCENE_OFF_SCRIPT) opt.remove();
    scenePick.value = '';
  });

  // ── СОБЫТИЯ ──
  if (data.events?.length) {
    document.getElementById('modp-panel-events').innerHTML =
      data.events.map(ev => `
        <div class="modp-event">
          <div class="modp-event-date">${escHtml(ev.date || '')}</div>
          <div class="modp-event-title">${escHtml(ev.title || '')}</div>
          ${ev.description ? `<div class="modp-event-desc">${escHtml(ev.description)}</div>` : ''}
        </div>`).join('');
  } else {
    document.getElementById('modp-panel-events').innerHTML =
      '<div class="modp-empty"><div class="modp-empty-icon">📅</div>События не найдены</div>';
  }

  // ── НПС ──
  const npcPanel = document.getElementById('modp-panel-npcs');
  if (data.npcGroups?.length) {
    npcPanel.innerHTML = _renderModuleNpcCards(data.npcGroups) + _renderModuleNpcGroups(data.npcGroups);
  } else if (data.npcContent) {
    npcPanel.innerHTML = `<div class="modp-md">${mdToHtml(data.npcContent)}</div>`;
  } else if (data.npcs?.length) {
    npcPanel.innerHTML =
      `<div class="modp-char-list">${data.npcs.map(p => `
        <div class="modp-char-item" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span class="modp-char-name">${escHtml(p.name)}</span>
          <span class="modp-char-role">${escHtml(p.role)}</span>
        </div>`).join('')}</div>`;
  } else {
    npcPanel.innerHTML =
      '<div class="modp-empty"><div class="modp-empty-icon">👥</div>Файл npc.md отсутствует</div>';
  }
  // ── NPC toolbar & add-form ──
  npcPanel.insertAdjacentHTML('beforeend', `
  <div class="modp-npc-add-toolbar" style="margin-top:16px">
    ${!data.npcContent
      ? `<button class="modp-edit-btn" id="modp-init-npcmd-btn">📄 Создать npc.md</button>`
      : ''
    }
    <button class="modp-edit-btn" id="modp-add-npc-btn">+ Добавить НПС</button>
  </div>

  <div id="modp-npc-add-form" style="display:none;margin-top:12px;padding:12px;border:1px solid var(--border,#444);border-radius:4px">
    <div style="margin-bottom:8px">
      <label style="display:block;font-size:var(--fs-sm,12px);color:var(--text2,#999);margin-bottom:2px">Имя</label>
      <input class="moddet-add-input" id="modp-npc-add-name"
        list="modp-npc-add-datalist" placeholder="Имя персонажа…" autocomplete="off" style="width:100%">
      <datalist id="modp-npc-add-datalist">
        ${(STATE.characters || []).map(c => `<option value="${escAttr(c.name)}">`).join('')}
      </datalist>
    </div>
    <div style="margin-bottom:8px">
      <label style="display:block;font-size:var(--fs-sm,12px);color:var(--text2,#999);margin-bottom:2px">Группа</label>
      <select class="moddet-add-input" id="modp-npc-add-group" style="width:100%">
        <option value="modular">🆕 Модульный НПС (создать карточку)</option>
        <option value="canon">📚 Каноничный НПС (из персонажей города)</option>
        <option value="pc">🎭 Персонаж игрока</option>
      </select>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="modp-save-btn" id="modp-npc-add-submit">Добавить</button>
      <button class="modp-cancel-btn" id="modp-npc-add-cancel">Отмена</button>
      <span class="modp-save-msg" id="modp-npc-add-msg" style="display:none"></span>
    </div>
  </div>`);

  // ── ЛОКАЦИИ ──
  _renderModuleLocPanel(data);

  // ── НИТИ ──
  document.getElementById('modp-panel-threads').innerHTML = data.openThreads
    ? `<div class="modp-md">${mdToHtml(data.openThreads)}</div>`
    : '<div class="modp-empty"><div class="modp-empty-icon">🧵</div>Открытые нити отсутствуют</div>';
}

// Minimal markdown → HTML converter
function mdToHtml(md) {
  if (!md) return '';
  // Extract code blocks before escaping
  const codeBlocks = [];
  let src = md.replace(/```([\s\S]*?)```/g, (_, inner) => {
    codeBlocks.push(inner);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });
  // Escape HTML in the rest
  src = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Inline code
  src = src.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // Headers
  src = src.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  src = src.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  src = src.replace(/^####\s+(.+)$/gm,  '<h4>$1</h4>');
  src = src.replace(/^###\s+(.+)$/gm,   '<h3>$1</h3>');
  src = src.replace(/^##\s+(.+)$/gm,    '<h2>$1</h2>');
  src = src.replace(/^#\s+(.+)$/gm,     '<h2>$1</h2>');
  // Bold + italic
  src = src.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  src = src.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  src = src.replace(/\*(.+?)\*/g,         '<em>$1</em>');
  // Links: [text](href)
  src = src.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => resolveMdLink(t, h));
  // Blockquote
  src = src.replace(/^&gt;\s*(.+)$/gm, '<blockquote>$1</blockquote>');
  // Horizontal rule
  src = src.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">');
  // Lists (group consecutive li into ul)
  src = src.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  src = src.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
  src = src.replace(/(<li>[^]*?<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`);
  // Paragraphs
  src = src.replace(/\n\n+/g, '\x01');
  const paras = src.split('\x01').map(chunk => {
    const t = chunk.trim();
    if (!t) return '';
    if (/^<(h[1-6]|ul|blockquote|hr|pre)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  });
  src = paras.join('\n');
  // Restore code blocks
  codeBlocks.forEach((cb, i) => {
    const escaped = cb.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    src = src.replace(`\x00CODE${i}\x00`, `<pre><code>${escaped}</code></pre>`);
  });
  return src;
}

// Module page tab switching
document.getElementById('modp-tabbar').addEventListener('click', e => {
  const btn = e.target.closest('.modp-tab');
  if (!btn) return;
  const tab = btn.dataset.modtab;
  document.querySelectorAll('.modp-tab').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.modp-panel').forEach(p => p.classList.toggle('active', p.id === `modp-panel-${tab}`));
});

// Info panel: edit / save / cancel panel handlers
document.getElementById('modp-panel-info').addEventListener('click', e => {
  const editModBtn   = e.target.closest('[data-editmod]');
  const saveModBtn   = e.target.closest('[data-savemod]');
  const cancelModBtn = e.target.closest('[data-cancelmod]');

  if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }
  if (cancelModBtn) { _modToggleEdit(cancelModBtn.dataset.cancelmod, false);  return; }
  if (saveModBtn)   { _modSavePanel(saveModBtn.dataset.savemod);              return; }

  // Remove chip
  const rmBtn = e.target.closest('[data-rmname]');
  if (rmBtn) {
    const chip = rmBtn.closest('.moddet-chip');
    if (chip) chip.remove();
    return;
  }

  // Add chip
  const addChipBtn = e.target.closest('[data-addchip]');
  if (addChipBtn) {
    const group  = addChipBtn.dataset.addchip;
    const input  = document.getElementById(`moddet-${group}-add-input`);
    const nm     = input?.value?.trim();
    if (!nm) return;
    const chips  = document.getElementById(`moddet-${group}-chips`);
    if (chips) {
      if (Array.from(chips.querySelectorAll('.moddet-chip')).some(c => c.dataset.name === nm)) {
        if (input) input.value = '';
        return;
      }
      const div = document.createElement('div');
      div.className = 'moddet-chip';
      div.dataset.name = nm;
      div.innerHTML = `${escHtml(nm)}<button class="moddet-chip-rm" data-rmname="${escHtml(nm)}" data-rmgroup="${group}" title="Удалить">×</button>`;
      chips.appendChild(div);
    }
    if (input) input.value = '';
    return;
  }
});

// Finale panel: edit / save / cancel handlers
document.getElementById('modp-panel-finale').addEventListener('click', e => {
  const editModBtn   = e.target.closest('[data-editmod]');
  const saveModBtn   = e.target.closest('[data-savemod]');
  const cancelModBtn = e.target.closest('[data-cancelmod]');

  if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }
  if (cancelModBtn) { _modToggleEdit(cancelModBtn.dataset.cancelmod, false);  return; }
  if (saveModBtn)   { _modSavePanel(saveModBtn.dataset.savemod);              return; }
});

// Scenario panel: edit / save / cancel / regen handlers
document.getElementById('modp-panel-scenario').addEventListener('click', e => {
  const editModBtn   = e.target.closest('[data-editmod]');
  const saveModBtn   = e.target.closest('[data-savemod]');
  const cancelModBtn = e.target.closest('[data-cancelmod]');

  if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }
  if (cancelModBtn) {
    _modToggleEdit(cancelModBtn.dataset.cancelmod, false);
    _modSyncBlockSaveAllVisibility(cancelModBtn.dataset.cancelmod);
    return;
  }
  if (saveModBtn)   { _modSavePanel(saveModBtn.dataset.savemod);              return; }

  const manualBtn = e.target.closest('#modp-scenario-manual-btn');
  if (manualBtn) {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;
    (async () => {
      const ok = await showConfirm('Создать пустой каркас сценария (GM-справка / Пролог / Сцена 1 / Финал) для ручного заполнения?', { confirmText: 'Создать' });
      if (!ok) return;
      manualBtn.disabled = true;
      const origLabel = manualBtn.textContent;
      manualBtn.textContent = '⏳ Создаю…';
      const skeleton = _buildScenarioSkeleton(d.title || d.name || mod, mod);
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${window.location.search}`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: skeleton }) }
        );
        if (!r.ok) {
          const result = await r.json().catch(() => ({}));
          throw new Error(result.error || 'Ошибка');
        }
        await _reloadModulePage();
      } catch (err) {
        showToast('Не удалось создать каркас: ' + err.message, 'error');
        manualBtn.disabled = false;
        manualBtn.textContent = origLabel;
      }
    })();
    return;
  }

  if (e.target.id === 'modp-toggle-gm-btn') {
    STATE.hideGmSections = !STATE.hideGmSections;
    _renderScenarioPanel(STATE.currentModuleData);
    return;
  }

  if (e.target.id === 'modp-add-scene-btn') {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;
    const addSceneBtn = e.target;
    (async () => {
      addSceneBtn.disabled = true;
      const origLabel = addSceneBtn.textContent;
      addSceneBtn.textContent = '⏳ Добавляю…';
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/scene${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || 'Ошибка');
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
        showToast(`Добавлена «${result.heading}» — заполни поля и переименуй сцену через «Редактировать весь текст», если нужно`, 'success');
      } catch (err) {
        showToast('Не удалось добавить сцену: ' + err.message, 'error');
        addSceneBtn.disabled = false;
        addSceneBtn.textContent = origLabel;
      }
    })();
    return;
  }

  if (e.target.id === 'modp-regen-scenario-btn') {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;

    const btn = e.target;
    (async () => {
      const ok = await showConfirm('Сгенерировать сценарий заново? Текущий scenario.md будет перезаписан.', { danger: true, confirmText: 'Перегенерировать' });
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = '⏳ Генерирую…';
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fill${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pcs:     (d.pcs  || []).map(p => typeof p === 'string' ? p : p.name),
              npcs:    (d.npcs || []).map(p => typeof p === 'string' ? p : p.name),
              content: d.description || ''
            })
          }
        );
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || 'Ошибка');
        await _reloadModulePage();
      } catch (err) {
        showToast('Ошибка генерации: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '♻ Перегенерировать всё';
      }
    })();
    return;
  }

  const regenSecBtn = e.target.closest('[data-scensec-regen]');
  if (regenSecBtn) {
    const idx    = parseInt(regenSecBtn.dataset.scensecRegen, 10);
    const info   = (STATE.scenarioSectionHeadings || [])[idx];
    const d      = STATE.currentModuleData;
    const chr    = d?.chronicle || STATE.currentModule?.chronicle;
    const mod    = d?.name      || STATE.currentModule?.name;
    if (!info || !chr || !mod) return;
    const { heading, parent } = info;

    (async () => {
      const ok = await showConfirm(`Перегенерировать раздел «${heading}»? Остальной сценарий учитывается как контекст и не меняется.`, { confirmText: 'Перегенерировать' });
      if (!ok) return;
      regenSecBtn.disabled = true;
      const origLabel = regenSecBtn.textContent;
      regenSecBtn.textContent = '⏳';
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section/regenerate${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              heading, parent,
              pcs:  (d.pcs  || []).map(p => typeof p === 'string' ? p : p.name),
              npcs: (d.npcs || []).map(p => typeof p === 'string' ? p : p.name),
            })
          }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || 'Ошибка генерации');
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
      } catch (err) {
        showToast('Не удалось перегенерировать раздел: ' + err.message, 'error');
        regenSecBtn.disabled = false;
        regenSecBtn.textContent = origLabel;
      }
    })();
    return;
  }

  const editBlockBtn = e.target.closest('[data-editblock]');
  if (editBlockBtn) {
    const block = editBlockBtn.closest('.modp-scenario-block');
    const idxs  = (block?.dataset.fieldIdxs || '').split(',').filter(Boolean);
    idxs.forEach(idx => _modToggleEdit(`scensec${idx}`, true));
    const saveAllBtn = block?.querySelector('[data-blocksaveall]');
    if (saveAllBtn) saveAllBtn.style.display = '';
    return;
  }

  const blockRegenBtn = e.target.closest('[data-blockregen]');
  if (blockRegenBtn) {
    const idx    = parseInt(blockRegenBtn.dataset.blockregen, 10);
    const info   = (STATE.scenarioSectionHeadings || [])[idx];
    const d      = STATE.currentModuleData;
    const chr    = d?.chronicle || STATE.currentModule?.chronicle;
    const mod    = d?.name      || STATE.currentModule?.name;
    if (!info || !chr || !mod) return;
    const heading = info.heading;

    (async () => {
      const ok = await showConfirm(`Перегенерировать блок «${heading}» целиком? Остальной сценарий учитывается как контекст и не меняется.`, { confirmText: 'Перегенерировать' });
      if (!ok) return;
      blockRegenBtn.disabled = true;
      const origLabel = blockRegenBtn.textContent;
      blockRegenBtn.textContent = '⏳ Генерирую…';
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/regenerate${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              heading,
              pcs:  (d.pcs  || []).map(p => typeof p === 'string' ? p : p.name),
              npcs: (d.npcs || []).map(p => typeof p === 'string' ? p : p.name),
            })
          }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || 'Ошибка генерации');
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
      } catch (err) {
        showToast('Не удалось перегенерировать блок: ' + err.message, 'error');
        blockRegenBtn.disabled = false;
        blockRegenBtn.textContent = origLabel;
      }
    })();
    return;
  }

  const saveAllBtn = e.target.closest('[data-blocksaveall]');
  if (saveAllBtn) {
    const block = saveAllBtn.closest('.modp-scenario-block');
    const idxs  = (block?.dataset.fieldIdxs || '').split(',').filter(Boolean);
    const d     = STATE.currentModuleData;
    const chr   = d?.chronicle || STATE.currentModule?.chronicle;
    const mod   = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod || !idxs.length) return;

    const fields = idxs.map(idx => {
      const info = (STATE.scenarioSectionHeadings || [])[parseInt(idx, 10)];
      const ta   = document.getElementById(`moddet-scensec${idx}-ta`);
      return info ? { heading: info.heading, parent: info.parent, content: ta ? ta.value : '' } : null;
    }).filter(Boolean);
    if (!fields.length) return;

    (async () => {
      saveAllBtn.disabled = true;
      const origLabel = saveAllBtn.textContent;
      saveAllBtn.textContent = '⏳ Сохраняю…';
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${window.location.search}`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || 'Ошибка сохранения');
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
        if (Array.isArray(result.skipped) && result.skipped.length) {
          showToast(`Не удалось сохранить: ${result.skipped.join(', ')} (раздел мог измениться)`, 'error');
        }
      } catch (err) {
        showToast('Не удалось сохранить блок: ' + err.message, 'error');
        saveAllBtn.disabled = false;
        saveAllBtn.textContent = origLabel;
      }
    })();
    return;
  }
});

// Add an in-play session entry (Phase B)
// Canon consistency check (shared by session form & integrity panel)
function _renderCanonIssues(issues) {
  if (!Array.isArray(issues) || !issues.length)
    return '<div class="canon-ok">✓ Противоречий канону не найдено</div>';
  return `<div class="canon-issues">${issues.map(i => `
    <div class="canon-issue canon-${(i.severity || 'medium')}">
      <span class="canon-issue-char">${escHtml(i.character || '?')}</span>
      <div class="canon-issue-body">
        <div class="canon-issue-text">${escHtml(i.issue || '')}</div>
        ${i.quote ? `<div class="canon-issue-quote">«${escHtml(i.quote)}»</div>` : ''}
      </div>
    </div>`).join('')}</div>`;
}
async function _runCanonCheck(text, box, btn, btnLabel) {
  if (!box) return;
  box.style.display = '';
  if (!text || !text.trim()) {
    box.innerHTML = '<div class="canon-warn">Нечего проверять — заполни текст события.</div>';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Сверяю…'; }
  box.innerHTML = '<div class="canon-loading">🔍 Сверяю с каноном…</div>';
  try {
    const qs    = window.location.search;
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref  = _getPref(prefs, 'prose', 'claude');
    const d = await fetch('/api/canon-check' + qs,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source: pref.provider, model: pref.model }) }
    ).then(r => r.json());
    box.innerHTML = d.ok ? _renderCanonIssues(d.issues)
                         : `<div class="canon-warn">Ошибка: ${escHtml(d.error || 'не удалось проверить')}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="canon-warn">Ошибка: ${escHtml(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btnLabel || '🔍 Проверить канон'; }
  }
}

async function _addSessionEntry() {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const btn   = document.getElementById('sess-add-btn');
  const errEl = document.getElementById('sess-error');
  const date   = document.getElementById('sess-date').value.trim();
  const status = document.getElementById('sess-status').value.trim();
  const scenes = document.getElementById('sess-scenes').value.trim();
  const notes  = document.getElementById('sess-notes').value.trim();
  if (!notes && !scenes) {
    errEl.textContent = 'Заполни «Что произошло» или «Сыграно сцен»';
    errEl.style.display = ''; return;
  }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = '⏳ Сохранение...';
  try {
    const qs = window.location.search;
    const d  = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/session${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, status, scenes, notes }) }
    ).then(r => r.json());
    if (!d.ok) { errEl.textContent = d.error || 'Ошибка'; errEl.style.display = ''; return; }
    await _reloadModulePage();
  } catch (e) {
    errEl.textContent = 'Ошибка: ' + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Добавить запись';
  }
}

// Turn a session card into an inline edit form (pre-filled)
function _editSessionEntry(idx) {
  const s = (STATE.currentModuleData?.sessions || [])[idx];
  const card = document.querySelector(`.modp-session[data-sess-idx="${idx}"]`);
  if (!s || !card) return;
  const statusOpts = ['🟡 В процессе', '🟢 Завершён'];
  card.innerHTML = `
    <div class="modp-session-form" style="margin:0">
      <div class="modp-session-form-title">✏️ Изменить — ${escHtml(s.title)}</div>
      <div class="modp-sf-row">
        <input id="sess-edit-date" class="modp-sf-input" value="${escHtml(s.date || '')}" placeholder="Дата">
        <select id="sess-edit-status" class="modp-sf-input">
          ${statusOpts.map(o => `<option ${o === s.status ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>
      <input id="sess-edit-scenes" class="modp-sf-input" value="${escHtml(s.scenes || '')}" placeholder="Сыграно сцен (через запятую)">
      <textarea id="sess-edit-notes" class="modp-sf-input modp-sf-area" rows="4" placeholder="Что произошло">${escHtml(s.body || '')}</textarea>
      <div style="display:flex;gap:8px;align-items:center">
        <button id="sess-edit-save" class="modp-gen-btn">Сохранить</button>
        <button id="sess-edit-cancel" class="modp-back-btn">Отмена</button>
        <div id="sess-edit-error" class="modp-sf-error" style="display:none"></div>
      </div>
    </div>`;
  document.getElementById('sess-edit-save').addEventListener('click', () => _saveSessionEdit(idx));
  document.getElementById('sess-edit-cancel').addEventListener('click', _reloadModulePage);
}

async function _saveSessionEdit(idx) {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const btn   = document.getElementById('sess-edit-save');
  const errEl = document.getElementById('sess-edit-error');
  const date   = document.getElementById('sess-edit-date').value.trim();
  const status = document.getElementById('sess-edit-status').value.trim();
  const scenes = document.getElementById('sess-edit-scenes').value.trim();
  const notes  = document.getElementById('sess-edit-notes').value.trim();
  if (!notes && !scenes) {
    errEl.textContent = 'Заполни «Что произошло» или «Сыграно сцен»';
    errEl.style.display = ''; return;
  }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = '⏳...';
  try {
    const qs = window.location.search;
    const d  = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/session/${idx}${qs}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, status, scenes, notes }) }
    ).then(r => r.json());
    if (!d.ok) { errEl.textContent = d.error || 'Ошибка'; errEl.style.display = ''; return; }
    await _reloadModulePage();
  } catch (e) {
    errEl.textContent = 'Ошибка: ' + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Сохранить';
  }
}

// Edit-button delegation on the (static) sessions panel — survives innerHTML rebuilds
document.getElementById('modp-panel-sessions').addEventListener('click', e => {
  const editBtn = e.target.closest('.modp-session-edit');
  if (editBtn) _editSessionEntry(+editBtn.dataset.sessIdx);
});

// НПС-panel delegation — open card on name click, generate replies, manage sheets
document.getElementById('modp-panel-npcs').addEventListener('click', e => {
  const dlgBtn = e.target.closest('.modp-npc-dlg-btn');
  if (dlgBtn) { _genModuleNpcDialogue(dlgBtn); return; }
  const sheetBtn = e.target.closest('.modp-sheet-btn');
  if (sheetBtn) { _onModuleSheetBtn(sheetBtn); return; }
  const promoteBtn = e.target.closest('.modp-promote-btn');
  if (promoteBtn) { _onPromoteNpc(promoteBtn); return; }
  const delBtn = e.target.closest('[data-npc-del-name]');
  if (delBtn) { _onDeleteModuleNpc(delBtn.dataset.npcDelName, delBtn.dataset.npcDelGroup); return; }
  const link = e.target.closest('[data-open-char]');
  if (link) { e.preventDefault(); openCharDetail(link.dataset.openChar); }

  // Show/hide NPC add form
  if (e.target.id === 'modp-add-npc-btn') {
    const form = document.getElementById('modp-npc-add-form');
    if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
    return;
  }

  // Hide NPC add form
  if (e.target.id === 'modp-npc-add-cancel') {
    const form = document.getElementById('modp-npc-add-form');
    if (form) form.style.display = 'none';
    return;
  }

  // Init npc.md
  if (e.target.id === 'modp-init-npcmd-btn') {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;
    const btn = e.target;
    btn.disabled = true;
    (async () => {
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initOnly: true }) }
        );
        if (!r.ok) throw new Error(await r.text());
        await _reloadModulePage();
      } catch (err) {
        showToast('Ошибка: ' + err.message, 'error');
        btn.disabled = false;
      }
    })();
    return;
  }

  // Submit NPC add form
  if (e.target.id === 'modp-npc-add-submit') {
    const d     = STATE.currentModuleData;
    const chr   = d?.chronicle || STATE.currentModule?.chronicle;
    const mod   = d?.name      || STATE.currentModule?.name;
    const name  = document.getElementById('modp-npc-add-name')?.value?.trim();
    const group = document.getElementById('modp-npc-add-group')?.value || 'modular';
    const msg   = document.getElementById('modp-npc-add-msg');
    if (!name) {
      if (msg) { msg.textContent = '⚠ Укажи имя'; msg.style.display = ''; }
      return;
    }
    const btn = e.target;
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
    btn.disabled = true;
    (async () => {
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, group }) }
        );
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || 'Ошибка');
        await _reloadModulePage();
      } catch (err) {
        if (msg) { msg.textContent = '✗ ' + err.message; msg.style.display = ''; }
        btn.disabled = false;
      }
    })();
    return;
  }
});

// Promote episodic NPC to canonical character
async function _onPromoteNpc(btn) {
  if (!STATE.currentModule) return;
  const { chronicle, name: mod } = STATE.currentModule;
  const slug    = btn.dataset.promoteSlug;
  const npcName = btn.dataset.promoteName;
  const isReady = btn.classList.contains('ready');

  const LINEAGES = [
    { value: 'vampires', label: '🧛 Вампир' },
    { value: 'mortals',  label: '🧑 Смертный' },
    { value: 'fairies',  label: '🧚 Фея' },
    { value: 'werewolves', label: '🐺 Оборотень' },
    { value: 'mages',    label: '🔮 Маг' },
    { value: 'hunters',  label: '🏹 Охотник' },
  ];

  const condMsg = btn.title ? `\nУсловия: ${btn.title}` : '';
  const forceMsg = isReady ? '' : '\n⚠️ Не все условия выполнены. Продолжить принудительно?';
  const lineage  = prompt(
    `Канонизировать «${npcName}»?${condMsg}${forceMsg}\n\nВыберите линейку:\n` +
    LINEAGES.map((l, i) => `${i + 1}. ${l.label}`).join('\n') +
    '\n\nВведите номер (по умолчанию 1):',
    '1'
  );
  if (lineage === null) return;
  const idx = (parseInt(lineage, 10) || 1) - 1;
  const chosen = LINEAGES[Math.max(0, Math.min(idx, LINEAGES.length - 1))];

  btn.disabled = true;
  btn.textContent = '…';
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(mod)}/npc/${encodeURIComponent(slug)}/promote`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineage: chosen.value, force: !isReady }) }
    );
    const d = await r.json();
    if (!r.ok) {
      showToast(`Ошибка: ${d.error || r.status}\n${d.conditions ? JSON.stringify(d.conditions, null, 2) : ''}`, 'error');
      btn.disabled = false;
      btn.textContent = '⬆ В канон';
      return;
    }
    btn.textContent = '✓ Канонизирован';
    btn.style.color = 'var(--gold)';
    // Refresh module page so the NPC now shows as canonical
    setTimeout(loadModulePage, 800);
  } catch (err) {
    showToast(`Ошибка: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = '⬆ В канон';
  }
}

// Delete an entry (НПС or ПК) from the module's npc.md — from either the card
// grid (✕) or the detailed list (🗑). Modular НПС also lose their own card
// folder (npc/<slug>/ — it only ever existed for this module), so warn louder
// for that case; canon/ПК entries just drop the reference line, the roster
// character itself is never touched.
async function _onDeleteModuleNpc(name, group) {
  if (!STATE.currentModule) return;
  const { chronicle, name: mod } = STATE.currentModule;
  const msg = group === 'modular'
    ? `Удалить «${name}» из модуля? Карточка этого модульного НПС (npc/…) будет удалена безвозвратно.`
    : `Убрать «${name}» из списка на вкладке «НПС»? Карточка персонажа в общем реестре не пострадает.`;
  if (!await showConfirm(msg, { danger: true, confirmText: 'Удалить' })) return;
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(mod)}/npc${window.location.search}`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, group }) }
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || r.statusText);
    await _reloadModulePage();
  } catch (e) {
    showToast(`Ошибка: ${e.message}`, 'error');
  }
}

// Handle a sheet button on the module NPC tab (generate / view / regenerate / edit)
async function _onModuleSheetBtn(btn) {
  const wrap  = btn.closest('.modp-npc-sheet');
  const scope = wrap.dataset.sheetScope;
  const ctx = scope === 'module'
    ? { scope: 'module', label: wrap.dataset.sheetName, chr: STATE.currentModule.chronicle, mod: STATE.currentModule.name, slug: wrap.dataset.sheetSlug, onSaved: loadModulePage }
    : { scope: 'character', name: wrap.dataset.sheetName, label: wrap.dataset.sheetName, onSaved: loadModulePage };
  const act = btn.dataset.sheetAct;
  if (act === 'view') { openSheetOverlay(ctx, 'view'); return; }
  if (act === 'edit') { openSheetOverlay(ctx, 'edit'); return; }
  if (act === 'regen' && !await showConfirm('Перегенерировать лист? Текущий будет перезаписан.', { danger: true, confirmText: 'Перегенерировать' })) return;
  _generateSheet(ctx, btn);
}

// Back button
document.getElementById('modp-back-btn').addEventListener('click', () => navigate('modules'));

// ── Header quick-edit: название/тип/дата/тон/хроника ──────────────────────────
document.getElementById('modp-header-edit-btn').addEventListener('click', async () => {
  const data = STATE.currentModuleData || {};
  document.getElementById('modp-hedit-title').value = data.title || data.name || '';
  document.getElementById('modp-hedit-type').value  = data.type  || '';
  document.getElementById('modp-hedit-time').value  = data.time  || '';
  document.getElementById('modp-hedit-tone').value  = data.tone  || '';
  document.getElementById('modp-hedit-format').value = data.format || '';
  document.getElementById('modp-hedit-track').checked = data.trackInChronology !== false;

  document.getElementById('modp-title').style.display  = 'none';
  document.getElementById('modp-badges').style.display  = 'none';
  document.getElementById('modp-header-edit').style.display = '';

  const chrSel = document.getElementById('modp-hedit-chronicle');
  chrSel.innerHTML = '<option value="">⏳ Загрузка...</option>';
  try {
    const qs = window.location.search;
    const baseQs = qs ? qs + '&include_hidden=1' : '?include_hidden=1';
    const chrs = await fetch(`/api/chronicles${baseQs}`).then(r => r.json());
    chrSel.innerHTML = (Array.isArray(chrs) ? chrs : []).map(c =>
      `<option value="${escAttr(c.slug)}"${c.slug === data.chronicle ? ' selected' : ''}>${escHtml((c.hidden ? '📂 ' : '') + (c.display || c.slug))}</option>`
    ).join('');
  } catch {
    chrSel.innerHTML = `<option value="${escAttr(data.chronicle || '')}">${escHtml(data.chronicle || '')}</option>`;
  }
});

document.getElementById('modp-hedit-cancel').addEventListener('click', () => {
  document.getElementById('modp-header-edit').style.display = 'none';
  document.getElementById('modp-title').style.display  = '';
  document.getElementById('modp-badges').style.display  = '';
});

document.getElementById('modp-hedit-save').addEventListener('click', async () => {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const qs    = window.location.search;
  const msgEl = document.getElementById('modp-hedit-msg');
  const btn   = document.getElementById('modp-hedit-save');

  const title = document.getElementById('modp-hedit-title').value.trim();
  const type  = document.getElementById('modp-hedit-type').value.trim();
  const time  = document.getElementById('modp-hedit-time').value.trim();
  const tone   = document.getElementById('modp-hedit-tone').value.trim();
  const format = document.getElementById('modp-hedit-format').value.trim();
  const track  = document.getElementById('modp-hedit-track').checked;
  const toChr  = document.getElementById('modp-hedit-chronicle').value;

  if (!title) { showToast('Название не может быть пустым', 'warning'); return; }
  if (!time)  { showToast('Укажи дату/время', 'warning'); return; }

  btn.disabled = true;
  try {
    const r = await fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/fields${qs}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { title, type, time, tone, format, trackInChronology: track } }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);

    if (toChr && toChr !== chronicle) {
      const mv = await fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/move${qs}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toChronicle: toChr }),
      }).then(r => r.json());
      if (!mv.ok) throw new Error(mv.error || 'Не удалось перенести модуль');
      STATE.currentModule.chronicle = toChr;
    }

    document.getElementById('modp-header-edit').style.display = 'none';
    document.getElementById('modp-title').style.display  = '';
    document.getElementById('modp-badges').style.display  = '';
    if (msgEl) { msgEl.style.display = ''; setTimeout(() => { msgEl.style.display = 'none'; }, 2000); }
    await loadModulePage();
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// Generate module button — direct generation from existing module data
document.getElementById('modp-gen-btn').addEventListener('click', async () => {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const data = STATE.currentModuleData || {};
  const btn  = document.getElementById('modp-gen-btn');

  if (data.scenario && !await showConfirm('Сценарий уже существует. Перегенерировать?', { danger: true, confirmText: 'Перегенерировать' })) return;

  btn.disabled = true; btn.textContent = '⏳ Генерация...';
  try {
    const qs      = window.location.search;
    const prefs   = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const locPref = _getPref(prefs, 'locations', 'openrouter');
    const pcs     = (data.pcs  || []).map(p => p.name || p);
    const npcs    = (data.npcs || []).map(p => p.name || p);

    const d = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/fill${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcs, npcs, content: '', locSource: locPref.provider, locModel: locPref.model }) }
    ).then(r => r.json());

    if (!d.ok) { showToast('Ошибка генерации: ' + (d.error || 'Неизвестная ошибка'), 'error'); return; }

    const lines = [`✓ Модуль сгенерирован: ${d.file}`];
    if (d.locations?.length)       lines.push(`📍 Новых локаций: ${d.locations.length} (${d.locations.join(', ')})`);
    if (d.reusedLocations?.length) lines.push(`♻️ Переиспользовано локаций: ${d.reusedLocations.join(', ')}`);
    if (d.npcs?.length)            lines.push(`🧛 Новых НПС: ${d.npcs.length} (${d.npcs.join(', ')})`);
    if (d.canonNpcs?.length)       lines.push(`♻️ Каноничных НПС: ${d.canonNpcs.join(', ')}`);
    if (d.timelineWarnings?.length) {
      lines.push('');
      lines.push('⚠️ Предупреждения таймлайна:');
      for (const w of d.timelineWarnings) {
        const sev = w.severity === 'high' ? '🔴' : '🟡';
        lines.push(`${sev} ${w.character}: ${w.issue}`);
      }
    }
    if (d.missingTopics?.length) {
      lines.push('');
      lines.push('⚠️ AI не создал отдельный раздел для: ' + d.missingTopics.map(t => t.label).join(', '));
    }
    const resultEl = document.getElementById('modp-gen-result');
    if (resultEl) {
      resultEl.innerHTML = `<div class="modp-gen-result-inner">
        <div class="modp-gen-result-title">✅ Сгенерировано</div>
        ${lines.slice(1).map(l => l ? `<div>${escHtml(l)}</div>` : '').join('')}
      </div>`;
      resultEl.style.display = '';
      setTimeout(() => { resultEl.style.display = 'none'; }, 8000);
    }
    _reloadModulePage();
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🪄 Сгенерировать';
  }
});

// Close module (Phase C — module-close rules)
document.getElementById('modp-close-btn').addEventListener('click', () => {
  if (!STATE.currentModule) return;
  const data = STATE.currentModuleData || {};
  document.getElementById('modp-close-nosessions').style.display = (data.sessions || []).length ? 'none' : '';
  document.getElementById('modp-close-diaries-check').checked = false;
  document.getElementById('modp-close-modal').classList.add('open');
});
document.getElementById('modp-close-cancel-btn').addEventListener('click', () => {
  document.getElementById('modp-close-modal').classList.remove('open');
});
document.getElementById('modp-close-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modp-close-modal'))
    document.getElementById('modp-close-modal').classList.remove('open');
});

// Месяц-название (РУ) → номер месяца — грубый эвристический разбор свободного
// текста поля «Время» модуля («Декабрь 2001, пятница») в период ГГГГ-ММ для
// дневников. Возвращает null, если год/месяц уверенно не определяются —
// тогда дневники остаются полностью ручным шагом, как и раньше.
const _RU_MONTH_STEMS = ['янв', 'февр', 'март', 'апрел', 'май', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'нояб', 'дек'];
function _parsePeriodFromModuleTime(text) {
  const t = String(text || '').toLowerCase();
  const yearM = t.match(/\b(19|20)\d{2}\b/);
  if (!yearM) return null;
  const monthIdx = _RU_MONTH_STEMS.findIndex(stem => t.includes(stem));
  if (monthIdx === -1) return null;
  return `${yearM[0]}-${String(monthIdx + 1).padStart(2, '0')}`;
}

// Дневники по завершении модуля — опционально (чекбокс), по умолчанию выключено:
// по правилам Фазы C (module_rules.md) это ручной шаг, здесь просто убирает его
// для тех, кто хочет батч-генерацию по всем участникам-персонажам сразу.
async function _generateDiariesForModule(data, period) {
  const qs = window.location.search;
  const allChars = await fetch(`/api/characters${qs}`).then(r => r.json()).catch(() => []);
  const wantedNames = new Set();
  (data.pcs || []).forEach(p => wantedNames.add(typeof p === 'string' ? p : p.name));
  (data.npcGroups || []).forEach(g => { if (g.kind === 'canon') g.entries.forEach(e => wantedNames.add(e.name)); });

  const targets = [...wantedNames]
    .map(name => allChars.find(c => c.name === name))
    .filter(Boolean);

  const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const prose = _getPref(prefs, 'prose', 'openrouter');
  const session = data.title || data.name || '';

  let created = 0; const errors = [];
  for (const ch of targets) {
    try {
      const gen = await fetch(`/api/characters/${encodeURIComponent(ch.slug)}/diary/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session, preferSource: prose.provider, orModel: prose.provider === 'openrouter' ? prose.model : null }),
      }).then(r => r.json());
      if (gen.error || !gen.text) { errors.push(ch.name); continue; }
      const save = await fetch(`/api/characters/${encodeURIComponent(ch.slug)}/diary`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session, text: gen.text }),
      }).then(r => r.json());
      if (save.error) { errors.push(ch.name); continue; }
      created++;
    } catch { errors.push(ch.name); }
  }
  return { created, errors, total: targets.length };
}

document.getElementById('modp-close-confirm-btn').addEventListener('click', async () => {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const data = STATE.currentModuleData || {};
  const wantDiaries = document.getElementById('modp-close-diaries-check').checked;
  document.getElementById('modp-close-modal').classList.remove('open');

  const btn = document.getElementById('modp-close-btn');
  btn.disabled = true; btn.textContent = '⏳ Закрытие...';
  try {
    const qs    = window.location.search;
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const prose = _getPref(prefs, 'prose', 'claude');
    const d = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/close${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: prose.provider, model: prose.model }) }
    ).then(r => r.json());
    if (!d.ok) { showToast('Ошибка закрытия: ' + (d.error || 'Неизвестная ошибка'), 'error'); return; }
    const lines = ['✓ Модуль закрыт (Фаза C)'];
    if (d.finale)  lines.push('📕 Создан finale.md');
    if (d.event)   lines.push('📖 Событие добавлено в хронику');

    if (wantDiaries) {
      const period = _parsePeriodFromModuleTime(data.time);
      if (!period) {
        lines.push('⚠️ Не удалось определить период (ГГГГ-ММ) по дате модуля — дневники нужно сгенерировать вручную.');
      } else {
        const diaryResult = await _generateDiariesForModule(data, period);
        if (diaryResult.total === 0) lines.push('ℹ️ Участники не найдены среди персонажей — дневники не создавались.');
        else {
          lines.push(`📖 Дневники (${period}): ${diaryResult.created}/${diaryResult.total} сгенерировано`);
          if (diaryResult.errors.length) lines.push(`⚠️ Не удалось: ${diaryResult.errors.join(', ')}`);
        }
      }
    }

    if (d.reminders?.length) lines.push('', 'Осталось вручную:', ...d.reminders.map(r => '• ' + r));
    showToast(lines.join('\n'), 'success');
    loadModulePage();
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🔒 Закрыть модуль';
  }
});

// Delete module (+ cleanup of chronicle events, diary links, modular NPCs)
document.getElementById('modp-del-btn').addEventListener('click', async () => {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const qs = window.location.search;

  // Load preview data before showing modal
  const preview = await fetch(
    `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/delete-preview${qs}`
  ).then(r => r.json()).catch(() => null);

  const previewEl = document.getElementById('modp-del-preview');
  if (previewEl) {
    const parts = [];
    if (preview?.fileCount)           parts.push(`Файлов MD: <b>${preview.fileCount}</b>`);
    if (preview?.modularNpcs?.length) parts.push(`Модульных НПС: <b>${escHtml(preview.modularNpcs.join(', '))}</b>`);
    if (preview?.eventCount)          parts.push(`Событий в хронике: <b>${preview.eventCount}</b>`);
    if (preview?.affectedChars?.length) parts.push(`Дневники: <b>${escHtml(preview.affectedChars.join(', '))}</b>`);
    previewEl.innerHTML = parts.length
      ? `<ul style="margin:0;padding-left:18px">${parts.map(p => `<li>${p}</li>`).join('')}</ul>`
      : '<div style="color:var(--text2)">Данные недоступны</div>';
  }

  const unlockCheck = document.getElementById('modp-del-unlock-check');
  const confirmBtn  = document.getElementById('modp-del-confirm-btn');
  if (unlockCheck) unlockCheck.checked = false;
  if (confirmBtn)  confirmBtn.disabled = true;
  if (unlockCheck) unlockCheck.onchange = () => {
    if (confirmBtn) confirmBtn.disabled = !unlockCheck.checked;
  };

  document.getElementById('modp-del-cancel-btn').onclick = () => {
    document.getElementById('modp-delete-modal').classList.remove('open');
  };

  document.getElementById('modp-del-confirm-btn').onclick = async () => {
    document.getElementById('modp-delete-modal').classList.remove('open');
    const delBtn = document.getElementById('modp-del-btn');
    if (delBtn) { delBtn.disabled = true; delBtn.textContent = '⏳ Удаление...'; }
    try {
      const d = await fetch(
        `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}${qs}`,
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }
      ).then(r => r.json());
      if (!d.ok) { showToast('Ошибка удаления: ' + (d.error || 'Неизвестная ошибка'), 'error'); return; }
      navigate('modules');
    } catch (e) {
      showToast('Ошибка: ' + e.message, 'error');
    } finally {
      if (delBtn) { delBtn.disabled = false; delBtn.textContent = '🗑 Удалить модуль'; }
    }
  };

  document.getElementById('modp-delete-modal').classList.add('open');
});

document.getElementById('modp-delete-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modp-delete-modal'))
    document.getElementById('modp-delete-modal').classList.remove('open');
});

// Global click delegation for md-link-char / md-link-loc produced by resolveMdLink()
document.addEventListener('click', e => {
  const charLink = e.target.closest('.md-link-char');
  if (charLink) {
    e.preventDefault();
    const slug = charLink.dataset.charSlug;
    ensureCharsLoaded().then(() => {
      const char = (STATE.characters || []).find(c => c.slug === slug);
      if (char) openCharDetail(char.name);
    });
    return;
  }
  const locLink = e.target.closest('.md-link-loc');
  if (locLink) {
    e.preventDefault();
    const slug = locLink.dataset.locSlug;
    if (slug) openLocDetail(slug);
  }
});

// ═══════════════════════════════════════════════════════════════
// Threads
// ═══════════════════════════════════════════════════════════════

const THREAD_STATUS_OPTS = [
  ['active', '🔴 Активна'], ['background', '🟡 Фоновая'],
  ['closed', '🟢 Закрыта'], ['abandoned', '⚫ Заброшена'],
];
const THREAD_PRIO_OPTS = ['Высокий', 'Средний', 'Низкий'];
let _threadFiles = ['archive/open_threads.md'];

function fileLabel(f) {
  if (f === 'archive/open_threads.md') return 'Архив города';
  const m = f.match(/^chronicles\/([^/]+)\//);
  return m ? m[1] : f;
}

async function loadThreads() {
  const el = document.getElementById('threads-list');
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    const threads = await fetch('/api/threads').then(r => r.json());
    const active = threads.filter(t => t.status === 'active');
    const bg     = threads.filter(t => t.status === 'background');
    const done   = threads.filter(t => t.status === 'closed' || t.status === 'abandoned');
    document.getElementById('threads-sub').textContent =
      `${active.length} активных · ${bg.length} фоновых · ${done.length} закрытых`;

    // Distinct target files for the "new thread" file picker
    _threadFiles = [...new Set(['archive/open_threads.md', ...threads.map(t => t.file).filter(Boolean)])];
    const sel = document.getElementById('th-file');
    if (sel) sel.innerHTML = _threadFiles.map(f => `<option value="${escHtml(f)}">${escHtml(fileLabel(f))}</option>`).join('');

    const statusSelect = t => `<select class="thread-status">${
      THREAD_STATUS_OPTS.map(([v, l]) => `<option value="${v}"${v === t.status ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const prioSelect = t => `<select class="thread-prio">${
      THREAD_PRIO_OPTS.map(p => `<option${p === t.priority ? ' selected' : ''}>${p}</option>`).join('')}</select>`;

    const renderThread = t => `
      <div class="thread-card thread-${escHtml(t.status)}" data-id="${t.id}" data-file="${escHtml(t.file || '')}">
        <div class="thread-num">${t.id}</div>
        <div class="thread-body">
          <div class="thread-title">${escHtml(t.title)}</div>
          ${t.description ? `<div class="thread-desc">${escHtml(t.description)}</div>` : ''}
          <div class="thread-source">${escHtml(t.source)} · <span class="thread-file">${escHtml(fileLabel(t.file || ''))}</span></div>
          <div class="thread-actions">${statusSelect(t)}${prioSelect(t)}</div>
        </div>
      </div>`;

    let html = '';
    const section = (icon, label, list) => list.length
      ? `<div class="threads-section-header" style="margin-top:24px">${icon} ${label} (${list.length})</div>` + list.map(renderThread).join('')
      : '';
    html += section('🔴', 'Активные', active);
    html += section('🟡', 'Фоновые', bg);
    html += section('🟢', 'Закрытые', done);
    el.innerHTML = html || '<div class="loading-state" style="height:120px">Нитей нет</div>';
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
  }
}

// Per-card status/priority controls (delegated, attached once)
document.getElementById('threads-list')?.addEventListener('change', async e => {
  const card = e.target.closest('.thread-card');
  if (!card) return;
  const body = { file: card.dataset.file };
  if (e.target.classList.contains('thread-status'))      body.status   = e.target.value;
  else if (e.target.classList.contains('thread-prio'))   body.priority = e.target.value;
  else return;
  try {
    const r = await fetch('/api/threads/' + encodeURIComponent(card.dataset.id),
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    if (r.ok) loadThreads(); else showToast(r.error || 'Ошибка обновления', 'error');
  } catch (err) { showToast('Ошибка: ' + err.message, 'error'); }
});

// New-thread form toggle + submit
(function wireThreadForm() {
  const form = document.getElementById('thread-form');
  const btn  = document.getElementById('btn-new-thread');
  if (!form || !btn) return;
  const toggle = show => { form.style.display = show ? '' : 'none'; if (show) document.getElementById('th-title').focus(); };
  btn.addEventListener('click', () => toggle(form.style.display === 'none'));
  document.getElementById('btn-cancel-thread').addEventListener('click', () => toggle(false));
  document.getElementById('btn-save-thread').addEventListener('click', async () => {
    const err = document.getElementById('th-err');
    err.style.display = 'none';
    const payload = {
      title:       document.getElementById('th-title').value.trim(),
      description: document.getElementById('th-desc').value.trim(),
      source:      document.getElementById('th-source').value.trim(),
      priority:    document.getElementById('th-prio').value,
      status:      document.getElementById('th-status').value,
      file:        document.getElementById('th-file').value,
    };
    if (!payload.title) { err.textContent = 'Укажите заголовок'; err.style.display = ''; return; }
    try {
      const r = await fetch('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
      if (!r.ok) { err.textContent = r.error || 'Ошибка'; err.style.display = ''; return; }
      ['th-title', 'th-desc', 'th-source'].forEach(id => document.getElementById(id).value = '');
      toggle(false);
      loadThreads();
    } catch (e) { err.textContent = 'Ошибка: ' + e.message; err.style.display = ''; }
  });
})();

// ═══════════════════════════════════════════════════════════════
// Chronicle (Stories_of_*.md)
// ═══════════════════════════════════════════════════════════════

const SPINNER = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';

async function ensureCharsLoaded() {
  if (STATE.characters.length) return;
  try {
    const data = await fetch('/api/characters').then(r => r.json());
    STATE.characters = Array.isArray(data) ? data : [];
  } catch {}
}
// ensureLocsLoaded is defined at the bottom of the file (city-aware version)

// Resolve a chronicle participant name to a real character card (fuzzy, like the graph)
function resolveCharByName(raw) {
  if (!raw) return null;
  const chars = STATE.characters || [];
  let c = chars.find(x => x.name === raw);
  if (c) return c;
  const rl = raw.toLowerCase();
  c = chars.find(x => x.name.toLowerCase() === rl);
  if (c) return c;
  c = chars.find(x => {
    const il = x.name.toLowerCase();
    return il.startsWith(rl) || rl.startsWith(il.split(' ')[0]);
  });
  return c || null;
}

async function loadChronicle() {
  const el = document.getElementById('chronicle-content');
  if (STATE.chronicle && STATE.chronicle.data) { renderChronicle(); return; }
  el.innerHTML = SPINNER;
  await Promise.all([ensureCharsLoaded(), ensureLocsLoaded()]);
  try {
    const data = await fetch('/api/chronicle').then(r => r.json());
    STATE.chronicle = { data, tab: (STATE.chronicle && STATE.chronicle.tab) || 'timeline' };
    renderChronicle();
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить хронику</div>';
  }
}

function renderChronicle() {
  const st = STATE.chronicle;
  const el = document.getElementById('chronicle-content');
  if (!st || !st.data) return;
  const data = st.data;
  document.querySelectorAll('.chron-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.chronTab === st.tab));

  if (!data.exists) {
    document.getElementById('chronicle-sub').textContent = 'Хроника не настроена';
    el.innerHTML = '<div class="loading-state" style="height:140px">Файл хроники не найден (Stories_of_*.md)</div>';
    return;
  }
  const evCount = (data.events || []).length;
  const sub = document.getElementById('chronicle-sub');

  if (st.tab === 'world') {
    sub.textContent = 'Состояние мира';
    el.innerHTML = renderWorldState(data.worldState);
    return;
  }
  if (st.tab === 'lore') {
    sub.textContent = 'Хронология мира · timeline.md';
    _loadArchiveEditable('/api/timeline', '/api/timeline', 'chronicle-content',
      'timeline.md не найден для этого города');
    return;
  }
  sub.textContent = `${evCount} событий`;
  el.innerHTML = renderTimeline(data.events || []);
}

// Render a lore markdown doc (sections + pipe tables + blockquotes + links) → HTML.
// Used by timeline, factions (political_state), rumors and V20 sheets.
function renderLoreMd(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {                       // table block
      const tbl = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { tbl.push(lines[i]); i++; }
      if (tbl.length >= 2) {
        const headers = cells(tbl[0]);
        const rows = tbl.slice(2).map(cells);        // skip the |---| separator
        out.push(renderTable({ headers, rows }));
      }
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { const lvl = Math.min(h[1].length, 4); out.push(`<h${lvl} class="lore-h">${mdInline(h[2])}</h${lvl}>`); i++; continue; }
    if (/^\s*>\s?/.test(line)) { out.push(`<blockquote class="lore-quote">${mdInline(line.replace(/^\s*>\s?/, ''))}</blockquote>`); i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { out.push('<hr class="lore-hr">'); i++; continue; }
    if (line.trim()) { out.push(`<p class="lore-p">${mdInline(line.trim())}</p>`); i++; continue; }
    i++;
  }
  return `<div class="lore-timeline">${out.join('\n')}</div>`;
}

// Generic loader for a raw-markdown archive doc → render into a page container.
async function loadArchiveDoc(url, containerId, emptyMsg) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка…</div>';
  try {
    const d = await fetch(url).then(r => r.json());
    el.innerHTML = d.exists && d.content
      ? renderLoreMd(d.content)
      : `<div class="cdet-empty" style="padding:30px">${escHtml(emptyMsg)}</div>`;
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
  }
}

// Editable archive doc — adds ✏ Edit toolbar (and optional 🎲 d20 roll for rumors).
// opts: { d20: bool, putExtra: object }
async function _loadArchiveEditable(getUrl, putUrl, containerId, emptyMsg, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка…</div>';

  let rawContent = '';
  let exists = false;
  try {
    const d = await fetch(getUrl).then(r => r.json());
    exists = !!d.exists;
    rawContent = d.content || '';
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
    return;
  }

  const uid = containerId; // use containerId as unique prefix for sub-element IDs
  const d20Part = opts.d20
    ? `<button class="archive-d20-btn" id="${uid}-d20-btn">🎲 Бросить d20</button><span class="archive-d20-badge" id="${uid}-d20-badge"></span>`
    : '';

  el.innerHTML = `
    <div class="archive-toolbar">
      ${d20Part}
      <button class="archive-edit-btn" id="${uid}-edit-btn">✏ Редактировать</button>
    </div>
    <div class="archive-doc-view" id="${uid}-view">${
      exists && rawContent
        ? renderLoreMd(rawContent)
        : `<div class="cdet-empty" style="padding:30px">${escHtml(emptyMsg)}</div>`
    }</div>
    <div class="archive-doc-edit" id="${uid}-edit" style="display:none">
      <textarea class="archive-textarea" id="${uid}-ta" spellcheck="false"></textarea>
      <div class="archive-edit-bar">
        <button class="btn-submit" id="${uid}-save-btn">💾 Сохранить</button>
        <button class="btn-submit btn-secondary" id="${uid}-cancel-btn">Отмена</button>
        <span class="archive-edit-msg" id="${uid}-msg"></span>
      </div>
    </div>`;

  const viewEl   = document.getElementById(`${uid}-view`);
  const editEl   = document.getElementById(`${uid}-edit`);
  const taEl     = document.getElementById(`${uid}-ta`);
  const msgEl    = document.getElementById(`${uid}-msg`);
  const saveBtn  = document.getElementById(`${uid}-save-btn`);
  const cancelBtn = document.getElementById(`${uid}-cancel-btn`);
  const editBtn  = document.getElementById(`${uid}-edit-btn`);

  editBtn.addEventListener('click', () => {
    taEl.value = rawContent;
    viewEl.style.display = 'none';
    editEl.style.display = '';
    editBtn.style.display = 'none';
    taEl.focus();
  });

  cancelBtn.addEventListener('click', () => {
    editEl.style.display = 'none';
    viewEl.style.display = '';
    editBtn.style.display = '';
    msgEl.textContent = '';
  });

  saveBtn.addEventListener('click', async () => {
    const newContent = taEl.value;
    saveBtn.disabled = true; saveBtn.textContent = '⏳';
    msgEl.textContent = '';
    try {
      const body = { content: newContent, ...(opts.putExtra || {}) };
      const r = await fetch(putUrl, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Ошибка');
      rawContent = newContent;
      viewEl.innerHTML = rawContent
        ? renderLoreMd(rawContent)
        : `<div class="cdet-empty" style="padding:30px">${escHtml(emptyMsg)}</div>`;
      editEl.style.display = 'none';
      viewEl.style.display = '';
      editBtn.style.display = '';
      msgEl.textContent = '';
    } catch (e) {
      msgEl.textContent = '✗ ' + e.message;
      msgEl.style.color = 'var(--accent3)';
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = '💾 Сохранить';
    }
  });

  if (opts.d20) {
    const d20Btn   = document.getElementById(`${uid}-d20-btn`);
    const d20Badge = document.getElementById(`${uid}-d20-badge`);
    if (d20Btn) d20Btn.addEventListener('click', () => _rollD20Rumor(`${uid}-view`, d20Badge, opts.rumorsType || null));
  }

  if (opts.onRendered) opts.onRendered(viewEl);

  // Re-init after in-place save
  const _origSaveClick = saveBtn.onclick;
  saveBtn.addEventListener('click', () => {
    // Wait for the save handler to update viewEl.innerHTML, then re-init
    const obs = new MutationObserver(() => {
      obs.disconnect();
      if (opts.onRendered) opts.onRendered(viewEl);
    });
    obs.observe(viewEl, { childList: true, subtree: false });
  });
}

function _rollD20Rumor(viewId, badgeEl, type) {
  const city    = new URLSearchParams(window.location.search).get('city') || 'paris';
  const toldSet = type
    ? new Set(JSON.parse(localStorage.getItem(`rumors-told-${city}-${type}`) || '[]'))
    : new Set();

  // Roll, re-rolling if the result is already told (max 40 attempts = 2 full cycles)
  let roll, attempts = 0;
  do {
    roll = Math.floor(Math.random() * 20) + 1;
    attempts++;
  } while (toldSet.has(roll) && attempts < 40);

  const table = document.querySelector(`#${viewId} table`);
  if (!table) {
    if (badgeEl) { badgeEl.textContent = `🎲 ${roll}`; badgeEl.classList.add('rolled'); setTimeout(() => badgeEl.classList.remove('rolled'), 3000); }
    return;
  }

  let hitRow = null;
  table.querySelectorAll('tbody tr').forEach(row => {
    const cell = row.querySelector('td:first-child');
    if (!cell) return;
    // .rumor-num span is inserted by _initRumorCheckboxes; fall back to raw text
    const txt    = (cell.querySelector('.rumor-num')?.textContent ?? cell.textContent).trim();
    const single = txt.match(/^(\d+)$/);
    const range  = txt.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    const hit    = (single && +single[1] === roll) ||
                   (range && roll >= +range[1] && roll <= +range[2]);
    row.classList.toggle('rumor-hit', hit);
    if (hit) hitRow = row;
  });

  if (badgeEl) { badgeEl.textContent = `🎲 ${roll}`; badgeEl.classList.add('rolled'); setTimeout(() => badgeEl.classList.remove('rolled'), 3500); }
  if (hitRow) hitRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// C1 — Фракции (political_state.md) + вкладка «Визитёры» (visitors.md)
let _factionsTab = 'map';
function loadFactions() {
  document.querySelectorAll('#factions-tabbar .chron-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.facTab === _factionsTab));
  const diagramPanel = document.getElementById('factions-influence-panel');
  if (_factionsTab === 'visitors') {
    diagramPanel.innerHTML = '';
    _loadArchiveEditable('/api/visitors', '/api/visitors', 'factions-content',
      'Визитёров пока нет. Гости из других городов оформляются в archive/visitors.md.');
  } else {
    loadFactionsInfluence();
    _loadArchiveEditable('/api/factions', '/api/factions', 'factions-content',
      'political_state.md не найден для этого города.');
  }
}
document.querySelectorAll('#factions-tabbar .chron-tab').forEach(b => b.addEventListener('click', () => {
  _factionsTab = b.dataset.facTab;
  loadFactions();
}));

// ── Диаграмма влияния фракций — bar-list поверх сырого political_state.md.
// Список фракций подтягивается с сервера из city.md → «Фракции» (см. GET
// /api/factions/influence); влияние — ручное редактирование 0-100 (шаг 5);
// без истории/авто-триггеров от событий — решение пользователя для первой версии.
async function loadFactionsInfluence() {
  const panel = document.getElementById('factions-influence-panel');
  panel.innerHTML = '<div class="loading-state" style="height:60px"><div class="spinner"></div></div>';
  let factions = [];
  try {
    factions = (await fetch(`/api/factions/influence${window.location.search}`).then(r => r.json())).factions || [];
  } catch { panel.innerHTML = ''; return; }

  const rows = factions.map(f => `
    <div class="faction-inf-row" data-faction="${escAttr(f.name)}">
      <div class="faction-inf-name">${escHtml(f.name)}</div>
      <div class="faction-inf-bar-track">
        <div class="faction-inf-bar-fill" style="width:${f.influence}%"></div>
      </div>
      <input type="number" class="faction-inf-input" min="0" max="100" step="5" value="${f.influence}">
    </div>`).join('');

  panel.innerHTML = `
    <div class="faction-inf-panel">
      <div class="faction-inf-header">
        <span class="faction-inf-title">📊 Влияние фракций</span>
        <div class="faction-inf-add">
          <input type="text" id="faction-inf-add-name" placeholder="Новая фракция..." class="chr-form-input">
          <button class="modp-edit-btn" id="faction-inf-add-btn">+ Добавить</button>
        </div>
      </div>
      ${rows || '<div class="cdet-empty">В city.md нет раздела «Фракции» — впиши список туда (страница города → редактировать) или добавь фракцию вручную ниже</div>'}
    </div>`;

  panel.querySelectorAll('.faction-inf-input').forEach(input => {
    input.addEventListener('change', async () => {
      const row  = input.closest('.faction-inf-row');
      const name = row.dataset.faction;
      const val  = Math.max(0, Math.min(100, Math.round((+input.value || 0) / 5) * 5));
      input.value = val;
      try {
        const r = await fetch(`/api/factions/influence${window.location.search}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, influence: val }),
        }).then(r => r.json());
        if (!r.ok) throw new Error(r.error || 'Ошибка');
        row.querySelector('.faction-inf-bar-fill').style.width = val + '%';
      } catch (e) { showToast('Не удалось сохранить влияние: ' + e.message, 'error'); }
    });
  });

  panel.querySelector('#faction-inf-add-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('faction-inf-add-name');
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      const r = await fetch(`/api/factions/influence${window.location.search}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, influence: 0 }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Ошибка');
      await loadFactionsInfluence();
    } catch (e) { showToast('Не удалось добавить фракцию: ' + e.message, 'error'); }
  });
}

// ── Rumors: checkboxes, archive ───────────────────────────────────────────────

function _rumorCity() {
  return new URLSearchParams(window.location.search).get('city') || 'paris';
}

function _initRumorCheckboxes(viewEl, type) {
  const city = _rumorCity();
  const key  = `rumors-told-${city}-${type}`;
  const told = new Set(JSON.parse(localStorage.getItem(key) || '[]'));

  const table = viewEl.querySelector('table');
  if (!table) return;

  // Add dedicated header for checkbox column (after D20)
  const headerRow = table.querySelector('thead tr');
  if (headerRow && !headerRow.querySelector('.rumor-cb-th')) {
    const th = document.createElement('th');
    th.className = 'rumor-cb-th';
    th.title = 'Рассказан';
    const firstTh = headerRow.querySelector('th:first-child');
    if (firstTh) firstTh.after(th);
  }

  table.querySelectorAll('tbody tr').forEach(row => {
    if (row.querySelector('.rumor-told-cb')) return; // already inited
    const firstTd = row.querySelector('td:first-child');
    if (!firstTd) return;
    const rawTxt = firstTd.textContent.trim();
    const num = parseInt(rawTxt);
    if (isNaN(num)) return;

    // Clean D20 cell: only the number
    firstTd.innerHTML = `<span class="rumor-num">${num}</span>`;

    // Dedicated checkbox cell inserted after D20
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'rumor-told-cb';
    cb.dataset.num = num;
    cb.title = 'Рассказан';
    cb.checked = told.has(num);

    const cbTd = document.createElement('td');
    cbTd.className = 'rumor-cb-cell';
    cbTd.appendChild(cb);
    firstTd.after(cbTd);

    row.classList.toggle('rumor-told', told.has(num));

    cb.addEventListener('change', () => {
      if (cb.checked) told.add(num); else told.delete(num);
      localStorage.setItem(key, JSON.stringify([...told]));
      row.classList.toggle('rumor-told', cb.checked);
    });
  });
}

function _archiveRumors(viewEl, type) {
  const city    = _rumorCity();
  const toldKey = `rumors-told-${city}-${type}`;
  const archKey = `rumors-archive-${city}-${type}`;
  const told    = new Set(JSON.parse(localStorage.getItem(toldKey) || '[]'));

  if (!told.size) {
    showToast('Нет рассказанных слухов.\nОтметь чекбоксы «Рассказан» перед архивированием.', 'warning');
    return;
  }

  // Collect data from current table
  const table = viewEl.querySelector('table');
  const rumorData = [];
  if (table) {
    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (!cells.length) return;
      const num = parseInt(cells[0].querySelector('.rumor-num')?.textContent ?? cells[0].textContent);
      if (isNaN(num) || !told.has(num)) return;
      rumorData.push({
        num,
        text:     cells[1]?.textContent.trim() || '',
        source:   cells[2]?.textContent.trim() || '',
        veracity: cells[3]?.textContent.trim() || '',
        hook:     cells[4]?.textContent.trim() || '',
      });
    });
  }

  if (!rumorData.length) { showToast('Не удалось найти данные рассказанных слухов.', 'error'); return; }
  rumorData.sort((a, b) => a.num - b.num);

  // Save to archive
  const archive = JSON.parse(localStorage.getItem(archKey) || '[]');
  archive.unshift({
    date: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    rumors: rumorData,
  });
  localStorage.setItem(archKey, JSON.stringify(archive));

  // Clear told
  localStorage.removeItem(toldKey);
  viewEl.querySelectorAll('.rumor-told-cb').forEach(cb => { cb.checked = false; });
  viewEl.querySelectorAll('tr.rumor-told').forEach(r => r.classList.remove('rumor-told'));

  _renderRumorsArchive(city, type);
}

function _renderRumorsArchive(city, type) {
  const archKey   = `rumors-archive-${city}-${type}`;
  const archive   = JSON.parse(localStorage.getItem(archKey) || '[]');
  const container = document.getElementById('rumors-archive');
  if (!container) return;

  if (!archive.length) { container.innerHTML = ''; return; }

  const typeLabel  = type === 'dreaming' ? 'Грёз' : 'Элизиума';
  const accentVar  = type === 'dreaming' ? '#a78bca' : 'var(--gold)';

  container.dataset.rumType = type;
  container.innerHTML = `
    <div class="rumors-arch-header" style="--arch-accent:${accentVar}">
      📚 Архив слухов ${typeLabel}
    </div>
    ${archive.map((sess, i) => {
      const pl = sess.rumors.length === 1 ? 'слух' : sess.rumors.length < 5 ? 'слуха' : 'слухов';
      return `
        <div class="rumors-arch-session">
          <button class="rumors-arch-toggle" data-idx="${i}">
            <span class="rumors-arch-date">${escHtml(sess.date)}</span>
            <span class="rumors-arch-count">${sess.rumors.length} ${pl}</span>
            <span class="rumors-arch-chev">▼</span>
          </button>
          <div class="rumors-arch-body" id="rarch-body-${i}" style="display:none">
            <table class="rumors-arch-table">
              <thead><tr><th>#</th><th>Слух</th><th>Источник</th><th>✓</th></tr></thead>
              <tbody>
                ${sess.rumors.map(r => `<tr>
                  <td class="rumors-arch-num">${r.num}</td>
                  <td>${escHtml(r.text)}</td>
                  <td>${escHtml(r.source)}</td>
                  <td class="rumors-arch-ver">${escHtml(r.veracity)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }).join('')}`;

  // Accordion toggle via delegation
  container.querySelectorAll('.rumors-arch-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body  = document.getElementById(`rarch-body-${btn.dataset.idx}`);
      const chev  = btn.querySelector('.rumors-arch-chev');
      const open  = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      if (chev) chev.textContent = open ? '▼' : '▲';
      btn.classList.toggle('open', !open);
    });
  });
}

// C2 — Слухи (rumors_elysium.md / rumors_dreaming.md)
let _rumorsType = 'elysium';
function loadRumors() {
  document.querySelectorAll('#rumors-tabbar .chron-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.rumType === _rumorsType));
  const content = document.getElementById('rumors-content');
  if (content) content.dataset.rumType = _rumorsType;
  const tabbar = document.getElementById('rumors-tabbar');
  if (tabbar) tabbar.dataset.rumType = _rumorsType;

  const type = _rumorsType;
  _loadArchiveEditable(
    `/api/rumors?type=${type}`,
    '/api/rumors',
    'rumors-content',
    `${type === 'dreaming' ? 'rumors_dreaming.md' : 'rumors_elysium.md'} не найден для этого города.`,
    {
      d20: true,
      rumorsType: type,
      putExtra: { type },
      onRendered: (viewEl) => {
        _initRumorCheckboxes(viewEl, type);
        // Add "Сгенерировать" button to toolbar (once)
        const toolbar = document.querySelector('#rumors-content .archive-toolbar');
        if (toolbar && !toolbar.querySelector('.rumors-gen-btn')) {
          const genBtn = document.createElement('button');
          genBtn.className = 'archive-d20-btn rumors-gen-btn';
          genBtn.textContent = '📚 Сгенерировать';
          genBtn.title = 'Архивировать рассказанные слухи и начать новый прогон';
          genBtn.addEventListener('click', () => _archiveRumors(viewEl, type));
          toolbar.appendChild(genBtn);
        }
        _renderRumorsArchive(_rumorCity(), type);
      },
    }
  );
}
document.querySelectorAll('#rumors-tabbar .chron-tab').forEach(b => b.addEventListener('click', () => {
  _rumorsType = b.dataset.rumType;
  loadRumors();
}));

function renderTable(t) {
  if (!t || !t.headers) return '';
  return '<table class="ws-table"><thead><tr>' +
    t.headers.map(h => `<th>${mdInline(h)}</th>`).join('') +
    '</tr></thead><tbody>' +
    t.rows.map(r => '<tr>' + r.map(c => `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>';
}

function renderWorldState(ws) {
  if (!ws || !ws.sections || !ws.sections.length)
    return '<div class="cdet-empty" style="padding:30px">Состояние мира не заполнено</div>';
  let html = '';
  if (ws.lastUpdate)
    html += `<div class="ws-updated">Последнее обновление: <b>${escHtml(ws.lastUpdate)}</b></div>`;
  for (const s of ws.sections) {
    html += `<section class="ws-section"><div class="ws-heading">${escHtml(s.heading)}</div>`;
    if (s.table) html += renderTable(s.table);
    if (s.prose && s.prose.length)
      html += s.prose.map(p => `<div class="ws-prose">${mdInline(p)}</div>`).join('');
    html += '</section>';
  }
  return html;
}

function renderTimeline(events) {
  if (!events.length)
    return '<div class="cdet-empty" style="padding:30px">Событий пока нет</div>';

  return events.map(ev => {
    // Participant chips
    const chips = (ev.participants || []).map(p => {
      const char = resolveCharByName(p.name);
      if (char) {
        const icon = LINEAGE_ICONS[char.lineage] || '👤';
        return `<button class="chron-chip chip-char" data-char="${escHtml(char.name)}" title="${escHtml(p.text)}">${icon} ${escHtml(p.name)}</button>`;
      }
      return `<span class="chron-chip" title="${escHtml(p.text)}">${escHtml(p.name)}</span>`;
    }).join('');

    // Known-location chips (subset of the location line that has cards)
    const locChips = (ev.location.links || [])
      .filter(l => (STATE.locations || []).some(x => x.slug === l.slug))
      .map(l => `<button class="chron-chip chip-loc" data-loc="${escHtml(l.slug)}">📍 ${escHtml(l.text)}</button>`)
      .join('');

    // Footer links → module modal
    const linkChips = (ev.links || []).map(l => {
      const label = l.kind === 'finale' ? '📜 Финал'
        : l.kind === 'module' ? '📖 Модуль'
        : l.kind === 'npc' ? '👥 НПС' : escHtml(l.text);
      const tab = l.kind === 'finale' ? 'finale' : l.kind === 'npc' ? 'npc' : 'overview';
      return l.module
        ? `<button class="chron-chip chip-mod" data-mod="${escHtml(l.module)}" data-chr="${escHtml(ev.chronicle || '')}" data-tab="${tab}">${label}</button>`
        : `<span class="chron-chip">${label}</span>`;
    }).join('');

    const body = [
      ev.eventsText ? `<div class="chron-block-label">📋 События</div><div class="md-body chron-md">${mdToHtml(ev.eventsText)}</div>` : '',
      ev.consequences.length ? `<div class="chron-block-label">⚖️ Последствия</div><ul class="chron-list">${ev.consequences.map(c => `<li>${mdInline(c)}</li>`).join('')}</ul>` : '',
      ev.worldChanges.length ? `<div class="chron-block-label">🌍 Изменения мира</div><ul class="chron-list">${ev.worldChanges.map(c => `<li>${mdInline(c)}</li>`).join('')}</ul>` : '',
      linkChips ? `<div class="chron-block-label">🔗 Связанные файлы</div><div class="chron-chips">${linkChips}</div>` : '',
    ].filter(Boolean).join('');

    return `
      <article class="chron-event" data-id="${ev.id}">
        <div class="chron-event-head">
          <div class="chron-event-date">📅 ${escHtml(ev.date)}</div>
          ${ev.parallel ? `<span class="chron-parallel" title="${escHtml(ev.parallel)}">⚡ параллельная</span>` : ''}
        </div>
        ${ev.title ? `<div class="chron-event-title">${escHtml(ev.title)}</div>` : ''}
        ${ev.location.text ? `<div class="chron-event-loc">📍 ${escHtml(ev.location.text)}</div>` : ''}
        ${locChips ? `<div class="chron-chips chron-locchips">${locChips}</div>` : ''}
        ${chips ? `<div class="chron-chips">${chips}</div>` : ''}
        ${body ? `<button class="chron-toggle" data-id="${ev.id}">Подробнее ▾</button>
        <div class="chron-event-body" data-body="${ev.id}" hidden>${body}</div>` : ''}
      </article>`;
  }).join('');
}

// Chronicle tab switching
document.querySelectorAll('.chron-tab').forEach(b => b.addEventListener('click', () => {
  if (!STATE.chronicle) { STATE.chronicle = { data: null, tab: b.dataset.chronTab }; }
  STATE.chronicle.tab = b.dataset.chronTab;
  document.querySelectorAll('.chron-tab').forEach(x => x.classList.toggle('active', x === b));
  if (STATE.chronicle.data) renderChronicle();
}));

// Chronicle delegated clicks: toggle bodies, open char/loc/module
document.getElementById('chronicle-content').addEventListener('click', e => {
  const tog = e.target.closest('.chron-toggle');
  if (tog) {
    const body = document.querySelector(`.chron-event-body[data-body="${tog.dataset.id}"]`);
    if (body) {
      const open = body.hasAttribute('hidden');
      if (open) { body.removeAttribute('hidden'); tog.textContent = 'Свернуть ▴'; }
      else      { body.setAttribute('hidden', ''); tog.textContent = 'Подробнее ▾'; }
    }
    return;
  }
  const cc = e.target.closest('.chip-char');
  if (cc) { openCharDetail(cc.dataset.char); return; }
  const lc = e.target.closest('.chip-loc');
  if (lc) { openLocDetail(lc.dataset.loc); return; }
  const mc = e.target.closest('.chip-mod');
  if (mc) { openModulePage(mc.dataset.chr || '', mc.dataset.mod); return; }
});

// ═══════════════════════════════════════════════════════════════
// Module Detail Modal
// ═══════════════════════════════════════════════════════════════

async function openModuleDetail(name, preferTab) {
  const modal   = document.getElementById('module-detail-modal');
  const content = document.getElementById('module-detail-content');
  content.innerHTML = `<div class="mod-loading">${SPINNER}</div>`;
  modal.classList.add('open');

  let d;
  try { d = await fetch(`/api/modules/${encodeURIComponent(name)}`).then(r => r.json()); }
  catch { content.innerHTML = '<div class="cdet-empty" style="padding:40px">⚠ Не удалось загрузить модуль</div>'; return; }
  if (d.error) { content.innerHTML = `<div class="cdet-empty" style="padding:40px">${escHtml(d.error)}</div>`; return; }

  const tabs = [];
  if (d.main)     tabs.push(['overview', 'Обзор',    d.main]);
  if (d.scenario) tabs.push(['scenario', 'Сценарий', d.scenario]);
  if (d.finale)   tabs.push(['finale',   'Финал',    d.finale]);
  if (d.npc)      tabs.push(['npc',      'НПС',      d.npc]);
  if (!tabs.length) tabs.push(['overview', 'Обзор', '*Файлы модуля не найдены.*']);

  const active = preferTab && tabs.some(t => t[0] === preferTab) ? preferTab : tabs[0][0];

  content.innerHTML = `
    <div class="cdet-info-col mod-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">${escHtml(d.title || name)}</div>
        <div class="mod-modal-slug-row">
          <span class="mod-modal-slug">📁 ${escHtml(d.name)}</span>
          <button class="mod-gen-scenario-btn"
            data-mod="${escHtml(d.name)}"
            data-chr="${escHtml(d.chronicle || '')}">🪄 Сгенерировать сценарий</button>
        </div>
      </div>
      <div class="cdet-tab-bar">
        ${tabs.map(t => `<button class="cdet-tab ${t[0] === active ? 'active' : ''} ${t[0] === 'finale' ? 'tab-finale' : ''}" data-tab="${t[0]}">${escHtml(t[1])}</button>`).join('')}
      </div>
      <div class="cdet-panels">
        ${tabs.map(t => `<div class="cdet-panel ${t[0] === active ? 'active' : ''}" data-panel="${t[0]}"><div class="md-body">${mdToHtml(t[2])}</div></div>`).join('')}
      </div>
    </div>`;
}

// Click: "🪄 Сгенерировать сценарий" button in module detail modal
document.getElementById('module-detail-content').addEventListener('click', e => {
  const genBtn = e.target.closest('.mod-gen-scenario-btn');
  if (!genBtn) return;
  const mod = genBtn.dataset.mod;
  const chr = genBtn.dataset.chr || _chrDetailSlug || '';
  document.getElementById('module-detail-modal').classList.remove('open');
  openFillModal(chr, mod, mod);
});

// Module modal: tab switching (same pattern as char/loc modals)
document.getElementById('module-detail-content').addEventListener('click', e => {
  const tab = e.target.closest('.cdet-tab');
  if (!tab) return;
  const col = tab.closest('.cdet-info-col');
  col.querySelectorAll('.cdet-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  col.querySelectorAll('.cdet-panel').forEach(p => p.classList.remove('active'));
  col.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
  const panels = col.querySelector('.cdet-panels');
  if (panels) panels.scrollTop = 0;
});

// Module modal close
const moduleDetailModal = document.getElementById('module-detail-modal');
document.getElementById('module-detail-close').addEventListener('click', () => moduleDetailModal.classList.remove('open'));
moduleDetailModal.addEventListener('click', e => { if (e.target === moduleDetailModal) moduleDetailModal.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') moduleDetailModal.classList.remove('open'); });

// ═══════════════════════════════════════════════════════════════
// Log Session (Tools → Сессия)
// ═══════════════════════════════════════════════════════════════

let lsInited = false;
let lsPreviewState = null;   // { hash, payload } after a successful preview

function lsSceneRow() {
  const d = document.createElement('div');
  d.className = 'ls-row ls-scene-row';
  d.innerHTML = `
    <input class="form-control ls-scene-title" placeholder="Название сцены">
    <textarea class="form-control ls-scene-text" rows="1" placeholder="Что произошло"></textarea>
    <button class="ls-del" type="button" title="Убрать">✕</button>`;
  return d;
}
function lsPartRow() {
  const d = document.createElement('div');
  d.className = 'ls-part-row';
  d.innerHTML = `
    <div class="ls-row">
      <input class="form-control ls-part-name" list="ls-charnames" placeholder="Имя (из карточек)">
      <input class="form-control ls-part-role" placeholder="роль в сцене">
      <label class="ls-check"><input type="checkbox" class="ls-part-diary"> дневник</label>
      <label class="ls-check"><input type="checkbox" class="ls-part-pc"> ПК</label>
      <button class="ls-del" type="button" title="Убрать">✕</button>
    </div>
    <div class="ls-row ls-row-sub">
      <select class="form-control ls-part-lineage" title="линейка — если это новый НПС (создастся карточка)">
        <option value="">— существующий —</option>
        <option value="vampires">🧛 новый: Вампир</option>
        <option value="fairies">🧚 новый: Фея</option>
        <option value="mortals">🧑 новый: Смертный</option>
        <option value="werewolves">🐺 новый: Оборотень</option>
        <option value="mages">🔮 новый: Маг</option>
        <option value="hunters">🏹 новый: Охотник</option>
      </select>
      <input class="form-control ls-part-status" placeholder="смена статуса (опц.)">
      <input class="form-control ls-part-statusd" placeholder="детали статуса">
      <input class="form-control ls-part-comment" placeholder="коммент к дневнику (для генерации прозы)">
    </div>`;
  return d;
}
function lsThreadRow() {
  const d = document.createElement('div');
  d.className = 'ls-row ls-thread-row';
  d.innerHTML = `
    <input class="form-control ls-thread-title" placeholder="Заголовок нити">
    <input class="form-control ls-thread-desc" placeholder="Описание">
    <select class="form-control ls-thread-prio"><option>Высокий</option><option>Средний</option><option>Низкий</option></select>
    <button class="ls-del" type="button" title="Убрать">✕</button>`;
  return d;
}

async function lsInit() {
  if (lsInited) return;
  lsInited = true;

  await ensureCharsLoaded();
  document.getElementById('ls-charnames').innerHTML =
    (STATE.characters || []).map(c => `<option value="${escHtml(c.name)}">`).join('');
  try {
    const mods = await fetch('/api/modules').then(r => r.json());
    document.getElementById('ls-modules').innerHTML =
      (mods || []).map(m => `<option value="${escHtml(m.name)}">`).join('');
  } catch {}
  try {
    const chrs = await fetch('/api/chronicles').then(r => r.json());
    document.getElementById('ls-chron-slug').innerHTML =
      (chrs || []).map(c => `<option value="${escHtml(c.slug)}">${escHtml(c.display)}</option>`).join('');
  } catch {}

  // Chronicle picker is only relevant for a NEW module; toggle new-name vs existing-slug.
  const syncChron = () => {
    const modeNew  = document.getElementById('ls-mod-mode').value === 'new';
    const chronNew = document.getElementById('ls-chron-mode').value === 'new';
    document.getElementById('ls-chron-row').style.display = modeNew ? '' : 'none';
    document.getElementById('ls-chron-slug').parentElement.style.display = chronNew ? 'none' : '';
    document.getElementById('ls-chron-new').parentElement.style.display  = chronNew ? '' : 'none';
  };
  document.getElementById('ls-mod-mode').addEventListener('change', () => { syncChron(); lsInvalidate(); });
  document.getElementById('ls-chron-mode').addEventListener('change', () => { syncChron(); lsInvalidate(); });
  syncChron();

  document.getElementById('ls-scenes').appendChild(lsSceneRow());
  document.getElementById('ls-parts').appendChild(lsPartRow());

  document.getElementById('ls-add-scene').addEventListener('click', () => { document.getElementById('ls-scenes').appendChild(lsSceneRow()); lsInvalidate(); });
  document.getElementById('ls-add-part').addEventListener('click', () => { document.getElementById('ls-parts').appendChild(lsPartRow()); lsInvalidate(); });
  document.getElementById('ls-add-thread').addEventListener('click', () => { document.getElementById('ls-threads').appendChild(lsThreadRow()); lsInvalidate(); });

  const panel = document.getElementById('tab-log-session');
  panel.addEventListener('click', e => {
    const del = e.target.closest('.ls-del');
    if (del) { del.closest('.ls-scene-row, .ls-part-row, .ls-thread-row').remove(); lsInvalidate(); }
  });
  panel.addEventListener('input', lsInvalidate);

  document.getElementById('ls-finale').addEventListener('change', e => {
    document.getElementById('ls-finale-comment-wrap').style.display = e.target.checked ? '' : 'none';
  });

  document.getElementById('ls-preview').addEventListener('click', lsRunPreview);
  document.getElementById('ls-write').addEventListener('click', lsRunWrite);
}

function lsInvalidate() {
  lsPreviewState = null;
  const w = document.getElementById('ls-write');
  if (w) w.disabled = true;
}

function collectLsPayload() {
  const linesOf = s => (s || '').split('\n').map(x => x.trim()).filter(Boolean);
  const $ = id => document.getElementById(id);

  const scenes = [...document.querySelectorAll('.ls-scene-row')].map(r => ({
    title: r.querySelector('.ls-scene-title').value.trim(),
    text:  r.querySelector('.ls-scene-text').value.trim()
  })).filter(s => s.title || s.text);

  const participants = [...document.querySelectorAll('.ls-part-row')].map(r => ({
    name:          r.querySelector('.ls-part-name').value.trim(),
    role:          r.querySelector('.ls-part-role').value.trim(),
    diary:         r.querySelector('.ls-part-diary').checked,
    isPC:          r.querySelector('.ls-part-pc').checked,
    lineage:       r.querySelector('.ls-part-lineage').value || undefined,
    statusChange:  r.querySelector('.ls-part-status').value.trim() || null,
    statusDetails: r.querySelector('.ls-part-statusd').value.trim(),
    diaryComment:  r.querySelector('.ls-part-comment').value.trim()
  })).filter(p => p.name);

  const threadsNew = [...document.querySelectorAll('.ls-thread-row')].map(r => ({
    title:    r.querySelector('.ls-thread-title').value.trim(),
    desc:     r.querySelector('.ls-thread-desc').value.trim(),
    priority: r.querySelector('.ls-thread-prio').value
  })).filter(t => t.title);

  const close = ($('ls-close').value || '').split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
  const folder = $('ls-mod-name').value.trim();

  return {
    module: { mode: $('ls-mod-mode').value, newName: folder, folder, type: $('ls-mod-type').value },
    chronicle: { mode: $('ls-chron-mode').value, slug: $('ls-chron-slug').value, newName: $('ls-chron-new').value.trim() },
    event: {
      month: $('ls-month').value.trim(),
      dateLabel: $('ls-date').value.trim(),
      title: $('ls-title').value.trim(),
      locationLine: $('ls-location').value.trim(),
      parallel: $('ls-parallel').value.trim() || null,
      summary: $('ls-summary').value.trim(),
      scenes,
      consequences: linesOf($('ls-consequences').value),
      worldChanges: linesOf($('ls-world').value)
    },
    participants,
    threads: { new: threadsNew, close },
    finale: { create: $('ls-finale').checked, comment: $('ls-finale-comment').value.trim() }
  };
}

const LS_ACTION_LABEL = { create: '＋ создать', modify: '✎ изменить' };

function renderLsChanges(changes, withPreview) {
  return `<div class="ls-changes">${changes.map(c => `
    <div class="ls-change">
      <span class="ls-change-act act-${c.action}">${LS_ACTION_LABEL[c.action] || c.action}</span>
      <span class="ls-change-rel">${escHtml(c.rel)}</span>
      ${withPreview && c.preview ? `<span class="ls-change-prev">${escHtml(c.preview)}</span>` : ''}
    </div>`).join('')}</div>`;
}

async function lsRunPreview() {
  const payload = collectLsPayload();
  payload.dryRun = true;
  const res = document.getElementById('ls-result');
  res.innerHTML = SPINNER;
  let j;
  try {
    j = await fetch('/api/log-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json());
  } catch { res.innerHTML = '<div class="ls-err">⚠ Сервер недоступен</div>'; return; }

  if (!j.ok) {
    lsInvalidate();
    res.innerHTML = `<div class="ls-err"><b>Нельзя записать:</b><ul>${(j.errors || []).map(e => `<li>${escHtml(e)}</li>`).join('')}</ul></div>`;
    return;
  }

  lsPreviewState = { hash: j.previewHash, payload };
  document.getElementById('ls-write').disabled = false;

  const s = j.summary || {};
  res.innerHTML = `
    <div class="ls-preview-head">
      <span class="ls-badge">ПРЕДПРОСМОТР</span>
      Модуль <b>${escHtml(s.module || '')}</b>${s.moduleNew ? ' (новый)' : ''} ·
      участников: ${s.participants} · дневников: ${s.diaries} · финал: ${s.finale ? 'да' : 'нет'}
    </div>
    ${renderLsChanges(j.changes || [], true)}
    ${(j.warnings || []).length ? `<div class="ls-warn">⚠ ${j.warnings.map(escHtml).join('<br>⚠ ')}</div>` : ''}
    ${(j.notes || []).length ? `<div class="ls-note">ℹ ${j.notes.map(escHtml).join('<br>ℹ ')}</div>` : ''}
    ${(j.stubs || []).length ? `<div class="ls-stubs"><b>Stub'ы для прозы Claude:</b><ul>${j.stubs.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="ls-hint-confirm">Проверьте план и нажмите «Записать».</div>`;
}

async function lsRunWrite() {
  if (!lsPreviewState) return;
  const res  = document.getElementById('ls-result');
  const wbtn = document.getElementById('ls-write');
  wbtn.disabled = true; wbtn.textContent = '⏳ Запись...';
  let j;
  try {
    j = await fetch('/api/log-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lsPreviewState.payload, dryRun: false, previewHash: lsPreviewState.hash })
    }).then(r => r.json());
  } catch { res.innerHTML = '<div class="ls-err">⚠ Сервер недоступен</div>'; wbtn.textContent = 'Записать'; return; }
  wbtn.textContent = 'Записать';

  if (!j.ok) {
    lsInvalidate();
    res.innerHTML = `<div class="ls-err"><b>Не записано:</b><ul>${(j.errors || []).map(e => `<li>${escHtml(e)}</li>`).join('')}</ul>Повторите предпросмотр.</div>`;
    return;
  }

  // refresh caches so other pages reflect new data
  STATE.characters = [];
  STATE.chronicle = null;
  STATE.locations = [];
  STATE.graph.inited = false;
  lsPreviewState = null;

  res.innerHTML = `
    <div class="ls-ok-head">✓ Записано — ${(j.written || []).length} файлов</div>
    ${renderLsChanges(j.written || [], false)}
    ${(j.stubs || []).length ? `
      <div class="ls-stubs">
        <b>Проза дневников и финала — stub'ы:</b>
        <ul>${j.stubs.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>
        <div id="ls-prose-zone"></div>
      </div>` : ''}
    ${(j.notes || []).length ? `<div class="ls-note">ℹ ${j.notes.map(escHtml).join('<br>ℹ ')}</div>` : ''}`;

  lsSetupProseZone(j.stubs || []);
}

// Render the prose-generation control (gated on Claude CLI availability)
async function lsSetupProseZone(stubs) {
  const zone = document.getElementById('ls-prose-zone');
  if (!zone || !stubs.length) return;

  const featPrefs   = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const _prosePref  = _getPref(featPrefs, 'prose', 'claude');
  const proseSrc    = _prosePref.provider;
  const isOpenAI    = proseSrc === 'openai';
  const useApi      = proseSrc === 'openrouter' || isOpenAI;   // API-style (single call) vs Claude CLI

  let claudeAvail = false;
  if (!useApi) { try { claudeAvail = (await fetch('/api/claude/health').then(r => r.json())).available; } catch {} }

  const claudeNote = claudeAvail
    ? `Дешевле — Sonnet/Haiku, качественнее — Opus.`
    : `<span style="color:var(--accent2)">Claude CLI не найден.</span>`;
  const apiBtnLabel = isOpenAI ? '🤖 Сгенерировать прозу (GPT)' : '🌐 Сгенерировать прозу (OpenRouter)';

  zone.innerHTML = `
    <div class="ls-prose-controls">
      ${useApi ? '' : `<select class="form-control ls-prose-model" id="ls-prose-model">
        <option value="">Модель: по умолчанию</option>
        <option value="opus">Opus — лучшее качество</option>
        <option value="sonnet">Sonnet — баланс</option>
        <option value="haiku">Haiku — быстро</option>
      </select>`}
      ${useApi
        ? `<button class="btn-submit btn-genprose btn-genprose-or" id="ls-genprose" type="button">${apiBtnLabel}</button>`
        : `<button class="btn-submit btn-genprose" id="ls-genprose" type="button" ${claudeAvail ? '' : 'disabled'}>🪄 Сгенерировать прозу (Claude)</button>`
      }
    </div>
    <div class="ls-prose-note">${useApi
      ? `${isOpenAI ? 'GPT' : 'OpenRouter'} читает правила дневников, карточки персонажей и события хроники автоматически. Модель — из «Назначение провайдеров».`
      : claudeNote
    } Настроить: <a class="dash-ai-link" data-nav="tools" data-tab="ai-settings">Модели AI ↗</a></div>
    <div class="ls-prose-result" id="ls-prose-result"></div>`;
  document.getElementById('ls-genprose').addEventListener('click', () => lsGenProse(stubs, proseSrc));
}

async function lsGenProse(stubs, source = 'claude') {
  const btn      = document.getElementById('ls-genprose');
  const out      = document.getElementById('ls-prose-result');
  const isOpenAI = source === 'openai';
  const useApi   = source === 'openrouter' || isOpenAI;   // API-style (single call) vs Claude CLI
  const qs       = window.location.search;
  const apiBtnLabel = isOpenAI ? '🤖 Сгенерировать прозу (GPT)' : '🌐 Сгенерировать прозу (OpenRouter)';

  // Claude model from prose-model select (if visible)
  const claudeModelEl = document.getElementById('ls-prose-model');
  const claudeModel   = claudeModelEl?.value || '';

  // API model from saved prefs (OpenRouter or OpenAI list)
  const _fp     = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const apiModel = _getPref(_fp, 'prose', 'openrouter').model || null;

  btn.disabled = true;
  btn.textContent = useApi ? `⏳ ${isOpenAI ? 'GPT' : 'OpenRouter'} пишет прозу…` : '⏳ Claude пишет прозу…';
  out.innerHTML = `<div class="ls-note">Идёт генерация — не закрывайте вкладку…</div>`;

  let j;
  try {
    const endpoint = useApi ? '/api/openrouter/generate-prose' : '/api/claude/generate-prose';
    j = await fetch(endpoint + qs, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stubs, model: useApi ? apiModel : claudeModel, source: isOpenAI ? 'openai' : 'openrouter' })
    }).then(r => r.json());
  } catch (e) {
    out.innerHTML = `<div class="ls-err">⚠ ${escHtml(e.message)}</div>`;
    btn.disabled = false; btn.textContent = useApi ? apiBtnLabel : '🪄 Сгенерировать прозу (Claude)';
    return;
  }

  if (!j.ok && !(j.written || []).length) {
    out.innerHTML = `<div class="ls-err">⚠ ${escHtml(j.error || 'Не удалось сгенерировать прозу')}</div>`;
    btn.disabled = false; btn.textContent = useApi ? apiBtnLabel : '🪄 Сгенерировать прозу (Claude)';
    return;
  }

  STATE.characters = []; STATE.chronicle = null; STATE.graph.inited = false;
  btn.textContent = '✓ Готово';
  out.innerHTML = `
    <div class="ls-ok-head">✓ Проза записана${j.cost != null ? ` · $${Number(j.cost).toFixed(3)}` : ''}</div>
    <div class="ls-changes">${(j.written || []).map(s =>
      `<div class="ls-change"><span class="ls-change-act act-modify">✎ проза</span><span class="ls-change-rel">${escHtml(s)}</span></div>`).join('')}</div>
    ${(j.pending || []).length ? `<div class="ls-warn">⚠ Без прозы остались: ${j.pending.map(escHtml).join(', ')}</div>` : ''}
    <div class="ls-note">Проверьте <b>git diff</b> перед коммитом.</div>`;
}

// Lazy-init the Log Session form when its tab is first opened
document.querySelector('.tab-btn[data-tab="log-session"]').addEventListener('click', lsInit);

// ═══════════════════════════════════════════════════════════════
// Global Search
// ═══════════════════════════════════════════════════════════════

function loadSearch() {
  const inp = document.getElementById('srch-input');
  if (inp && !inp.dataset.inited) {
    inp.dataset.inited = '1';
    let _debTimer = null;
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { clearTimeout(_debTimer); _runSearch(); }
    });
    inp.addEventListener('input', () => {
      clearTimeout(_debTimer);
      _debTimer = setTimeout(_runSearch, 420);
    });
    document.getElementById('srch-btn').addEventListener('click', _runSearch);
  }
  if (inp) inp.focus();
}

async function _runSearch() {
  const inp = document.getElementById('srch-input');
  const resultsEl = document.getElementById('srch-results');
  const subEl = document.getElementById('search-global-sub');
  const q = (inp?.value || '').trim();
  if (q.length < 3) {
    resultsEl.innerHTML = '<div class="srch-hint">Введи запрос — минимум 3 символа</div>';
    if (subEl) subEl.textContent = '';
    return;
  }
  resultsEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Поиск…</div>';
  try {
    const data = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json());
    _renderSearchResults(data, resultsEl, subEl);
  } catch (e) {
    resultsEl.innerHTML = `<div class="srch-hint">⚠ Ошибка: ${escHtml(e.message)}</div>`;
  }
}

function _renderSearchResults(data, el, subEl) {
  if (!data.results || data.total === 0) {
    el.innerHTML = `<div class="srch-hint">Ничего не найдено по запросу «${escHtml(data.query)}»</div>`;
    if (subEl) subEl.textContent = '';
    return;
  }
  if (subEl) subEl.textContent = `${data.total} результ.`;
  const hl = (txt) => {
    if (!txt) return '';
    const q = escHtml(data.query);
    return escHtml(txt).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      m => `<mark class="srch-hl">${m}</mark>`);
  };

  const sections = [];

  if ((data.results.characters || []).length) {
    const rows = data.results.characters.map(c => `
      <div class="srch-row srch-char" data-name="${escHtml(c.name)}">
        <div class="srch-row-icon">🎭</div>
        <div class="srch-row-body">
          <div class="srch-row-title">${hl(c.name)} <span class="srch-row-tag">${escHtml(c.lineage)}</span></div>
          <div class="srch-row-excerpt">${hl(c.excerpt)}</div>
        </div>
        <button class="srch-open-btn">Открыть →</button>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">🎭 Персонажи <span class="srch-sec-count">${data.results.characters.length}</span></div>${rows}</div>`);
  }

  if ((data.results.locations || []).length) {
    const rows = data.results.locations.map(l => `
      <div class="srch-row srch-loc" data-slug="${escHtml(l.slug)}">
        <div class="srch-row-icon">📍</div>
        <div class="srch-row-body">
          <div class="srch-row-title">${hl(l.name)}</div>
          <div class="srch-row-excerpt">${hl(l.excerpt)}</div>
        </div>
        <button class="srch-open-btn">Открыть →</button>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">📍 Локации <span class="srch-sec-count">${data.results.locations.length}</span></div>${rows}</div>`);
  }

  if ((data.results.modules || []).length) {
    const rows = data.results.modules.map(m => `
      <div class="srch-row srch-mod" data-chr="${escHtml(m.chronicle)}" data-mod="${escHtml(m.module)}">
        <div class="srch-row-icon">📖</div>
        <div class="srch-row-body">
          <div class="srch-row-title">${hl(m.title)} <span class="srch-row-tag">${escHtml(m.chronicleDisplay || m.chronicle)}</span></div>
          <div class="srch-row-excerpt">${hl(m.excerpt)}</div>
        </div>
        <button class="srch-open-btn">Открыть →</button>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">📖 Модули <span class="srch-sec-count">${data.results.modules.length}</span></div>${rows}</div>`);
  }

  if ((data.results.events || []).length) {
    const rows = data.results.events.map(e => `
      <div class="srch-row">
        <div class="srch-row-icon">📅</div>
        <div class="srch-row-body">
          <div class="srch-row-title"><span class="srch-row-tag">${escHtml(e.chronicleDisplay || e.chronicle)}</span></div>
          <div class="srch-row-excerpt">${hl(e.excerpt)}</div>
        </div>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">📅 События <span class="srch-sec-count">${data.results.events.length}</span></div>${rows}</div>`);
  }

  if ((data.results.archive || []).length) {
    const rows = data.results.archive.map(a => `
      <div class="srch-row">
        <div class="srch-row-icon">📜</div>
        <div class="srch-row-body">
          <div class="srch-row-title">${escHtml(a.label)}</div>
          <div class="srch-row-excerpt">${hl(a.excerpt)}</div>
        </div>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">📜 Архив <span class="srch-sec-count">${data.results.archive.length}</span></div>${rows}</div>`);
  }

  el.innerHTML = sections.join('');

  // Click handlers
  el.querySelectorAll('.srch-char').forEach(row => {
    row.querySelector('.srch-open-btn')?.addEventListener('click', () => {
      ensureCharsLoaded().then(() => openCharDetail(row.dataset.name));
    });
  });
  el.querySelectorAll('.srch-loc').forEach(row => {
    row.querySelector('.srch-open-btn')?.addEventListener('click', () => {
      ensureLocsLoaded().then(() => openLocDetail(row.dataset.slug));
    });
  });
  el.querySelectorAll('.srch-mod').forEach(row => {
    row.querySelector('.srch-open-btn')?.addEventListener('click', () => {
      openModulePage(row.dataset.chr, row.dataset.mod);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════

loadDashboard();

// ═══════════════════════════════════════════════════════════════
// Char Detail Modal
// ═══════════════════════════════════════════════════════════════

// Наборы полей вкладки «Информация» — свои для каждой линейки WoD.
// Карточка хранит линейко-специфичные поля (Раса/Двор/Титул у фей, Профессия у смертных);
// здесь выбирается, какие из них показывать и в каком порядке.
const INFO_FIELDS_BY_LINEAGE = {
  vampire: [
    ['status',       'Статус'],
    ['statusDetails','Детали статуса'],
    ['clan',         'Клан'],
    ['sect',         'Секта'],
    ['generation',   'Поколение'],
    ['birthYear',    'Год рождения'],
    ['embraceYear',  'Год обращения'],
    ['sire',         'Сир'],
    ['childe',       'Дитя'],
    ['location',     'Домен / Локация'],
    ['hierarchy',    'Иерархия'],
    ['disciplines',  'Дисциплины'],
    ['derangements', 'Деранжементы'],
    ['profession',   'Профессия'],
    ['role',         'Роль'],
    ['nature',       'Натура'],
    ['demeanor',     'Маска'],
    ['concept',      'Амплуа'],
    ['belonging',    'Принадлежность'],
  ],
  fairy: [
    ['status',     'Статус'],
    ['statusDetails','Детали статуса'],
    ['race',       'Раса'],
    ['kith',       'Род'],
    ['court',      'Двор'],
    ['title',      'Титул'],
    ['birthYear',  'Год рождения'],
    ['location',   'Фригольд / Локация'],
    ['features',   'Особенности / Способности'],
    ['hierarchy',  'Иерархия'],
    ['role',       'Роль'],
    ['nature',     'Натура'],
    ['demeanor',   'Маска'],
    ['belonging',  'Принадлежность'],
  ],
  mortal: [
    ['status',     'Статус'],
    ['statusDetails','Детали статуса'],
    ['profession', 'Профессия'],
    ['birthYear',  'Год рождения'],
    ['location',   'Домен / Локация'],
    ['relatives',  'Родственники'],
    ['attitude',   'Отношение к сверхъестественному'],
    ['hierarchy',  'Иерархия'],
    ['role',       'Роль'],
    ['nature',     'Натура'],
    ['demeanor',   'Маска'],
    ['belonging',  'Принадлежность'],
  ],
};
// Оборотни / маги / охотники: пока нет выделенного набора — общий минимум.
const INFO_FIELDS_GENERIC = [
  ['status',    'Статус'],
  ['statusDetails', 'Детали статуса'],
  ['race',      'Раса / Тип'],
  ['sect',      'Фракция'],
  ['birthYear', 'Год рождения'],
  ['location',  'Домен / Локация'],
  ['hierarchy', 'Иерархия'],
  ['role',      'Роль'],
  ['belonging', 'Принадлежность'],
];
function infoFieldsFor(lineage) {
  return INFO_FIELDS_BY_LINEAGE[lineage] || INFO_FIELDS_GENERIC;
}

// Обязательное (всегда видимое) поле — своё для линейки. Показывается даже пустым с флагом «!».
const REQUIRED_INFO_KEY = { vampire: 'clan', fairy: 'race', mortal: 'profession' };
function requiredInfoFor(lineage) {
  const k = REQUIRED_INFO_KEY[lineage];
  return new Set(k ? [k] : []);
}
// Линейка персонажа по имени (для режима редактирования, где под рукой только имя).
function _lineageOf(name) {
  return (STATE.characters.find(c => c.name === name) || {}).lineage || 'vampire';
}

function renderDiaryList(c) {
  const ch = escHtml(c.name);
  const items = c.diaries?.length
    ? `<div class="diaries-list">${c.diaries.map(d => `
        <div class="diary-item" data-char="${ch}" data-file="${escHtml(d.file)}" data-title="${escHtml(d.title)}">
          <span class="diary-item-icon">📜</span>
          <span class="diary-item-title">${escHtml(d.title)}</span>
          <button class="diary-item-del-btn" data-char="${ch}" data-file="${escHtml(d.file)}" data-title="${escHtml(d.title)}" title="Удалить запись">✕</button>
          <span class="diary-item-arrow">→</span>
        </div>`).join('')}</div>`
    : '<div class="cdet-empty">Дневников нет</div>';

  return `
    ${items}
    <div class="diary-tools">
      <button class="cdet-edit-btn" id="diary-add-toggle" data-char="${ch}">+ Новая запись</button>
    </div>
    <div class="diary-form" id="diary-form" style="display:none">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Период *</label><input class="form-control" id="diary-period" placeholder="2010-11 / retrospective"></div>
        <div class="form-group" style="flex:2"><label class="form-label">Заголовок записи</label><input class="form-control" id="diary-session" placeholder="Ноябрь 2010, ночь на манеже"></div>
      </div>
      <div class="form-group"><label class="form-label">Акцент для ИИ (необязательно)</label><input class="form-control" id="diary-hint" placeholder="о чём запись, настроение…"></div>
      <textarea class="cdet-edit-textarea" id="diary-text" rows="10" placeholder="Текст записи (введи вручную или сгенерируй ИИ и отредактируй)…"></textarea>
      <div class="btn-row" style="margin-top:10px;align-items:center">
        <button class="btn-submit" id="diary-gen" data-char="${ch}">✍️ Сгенерировать ИИ</button>
        <button class="btn-submit" id="diary-save" data-char="${ch}">💾 Сохранить</button>
        <button class="btn-submit btn-secondary" id="diary-cancel">Отмена</button>
        <span id="diary-form-msg"></span>
      </div>
    </div>`;
}

function _diaryMsg(text, ok = true) {
  const m = document.getElementById('diary-form-msg');
  if (m) { m.textContent = text; m.style.color = ok ? 'var(--gold)' : 'var(--accent3)'; }
}

// C4 — V20 sheet panel for canonical characters: toolbar (generate/regenerate/edit) + rendered sheet.
// The sheet .md opens with a redundant title + nav blockquote
// ("# … — Лист персонажа V20"  /  "> 🔗 Карточка персонажа | Все персонажи").
// The modal already shows the name, links and tabs, so strip that leading block
// for DISPLAY only — the file (and edit/save) keeps the header for standalone use.
function _stripSheetHeader(md) {
  const lines = String(md).split(/\r?\n/);
  let first = 0;
  while (first < lines.length && /^\s*$/.test(lines[first])) first++;
  if (!/^#{1,3}\s+.*Лист персонажа/i.test(lines[first] || '')) return md;
  let i = first + 1;
  const skip = s => /^\s*$/.test(s)
    || /^>\s*🔗?.*(Карточк|Все персонаж)/i.test(s)
    || /^\s*-{3,}\s*$/.test(s);
  while (i < lines.length && skip(lines[i])) i++;
  return lines.slice(i).join('\n');
}

// ═══════════════════ Structured V20 sheet (STV2099 blank reproduction) ═══════════════════
// Source of truth = <slug>-sheet.json (sidecar). Falls back to parsing the AI
// markdown sheet. Dots = radio-style (fill 1..k); boxes = solid checkboxes.

const V20_ATTRS = {
  physical: [['strength', 'Сила'], ['dexterity', 'Ловкость'], ['stamina', 'Выносливость']],
  social:   [['charisma', 'Обаяние'], ['manipulation', 'Манипуляция'], ['appearance', 'Привлекательность']],
  mental:   [['perception', 'Восприятие'], ['intelligence', 'Интеллект'], ['wits', 'Смекалка']],
};
const V20_ATTR_GROUP_LABELS = { physical: 'Физические', social: 'Социальные', mental: 'Ментальные' };
const V20_ABILITIES = {
  talents:    ['Атлетика', 'Бдительность', 'Драка', 'Запугивание', 'Красноречие', 'Лидерство', 'Уличное чутьё', 'Хитрость', 'Шестое чувство', 'Эмпатия'],
  skills:     ['Вождение', 'Воровство', 'Выживание', 'Исполнение', 'Обращение с животными', 'Ремесло', 'Скрытность', 'Стрельба', 'Фехтование', 'Этикет'],
  knowledges: ['Гуманитарные науки', 'Естественные науки', 'Законы', 'Информатика', 'Медицина', 'Оккультизм', 'Политика', 'Расследование', 'Финансы', 'Электроника'],
};
const V20_ABILITY_GROUP_LABELS = { talents: 'Таланты', skills: 'Навыки', knowledges: 'Знания' };
const V20_HEALTH = [
  ['bruised', 'Помят', ''], ['hurt', 'Легко ранен', '−1'], ['injured', 'Ранен', '−1'],
  ['wounded', 'Серьёзно ранен', '−2'], ['mauled', 'Тяжело ранен', '−2'],
  ['crippled', 'Едва жив', '−5'], ['incapacitated', 'При смерти', ''],
];

const _clamp = (v, a, b) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, Math.round(n))) : a; };
const _clamp05 = v => _clamp(v, 0, 5);
const _num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const _boolArr = (a, n) => Array.from({ length: n }, (_, i) => !!(a && a[i]));
const _fillBoxes = (n, k) => Array.from({ length: n }, (_, i) => i < k);
const _v20Norm = s => String(s || '').replace(/\*\*/g, '').toLowerCase().split('(')[0].trim();

function _v20Empty(lineage = 'vampires') {
  const ab = g => V20_ABILITIES[g].map(n => ({ name: n, val: 0, fixed: true })).concat([{ name: '', val: 0 }, { name: '', val: 0 }]);
  return {
    lineage,
    header: { name: '', player: '', chronicle: '', nature: '', demeanor: '', concept: '', clan: '', generation: '', sire: '' },
    attributes: {
      physical: { strength: 1, dexterity: 1, stamina: 1 },
      social:   { charisma: 1, manipulation: 1, appearance: 1 },
      mental:   { perception: 1, intelligence: 1, wits: 1 },
    },
    abilities: { talents: ab('talents'), skills: ab('skills'), knowledges: ab('knowledges') },
    disciplines: Array.from({ length: 6 }, () => ({ name: '', val: 0 })),
    // psychicPowers — мортал-аналог disciplines (см. _v20RenderSheet/discCol): «Нумина / Грани»
    // листа смертного (character_sheet_mortal.md, Шаг 8) — только для экстрасенсов/практиков,
    // у обычного смертного остаётся пустым/нулевым. Источник справочника — system/library/psychics/
    // (web/lib/psychics.js → GET /api/library/psychics, кэш ensurePsychics()/_psychicsCache).
    psychicPowers: Array.from({ length: 6 }, () => ({ name: '', val: 0 })),
    backgrounds: Array.from({ length: 6 }, () => ({ name: '', val: 0 })),
    virtues: { conscience: 1, selfcontrol: 1, courage: 1 },
    meritsFlaws: '',
    humanity: 7, path: 'Человечность',
    willpower: { permanent: 1, temp: Array(10).fill(false) },
    // bloodPool — boolean grid (sized per generation's bloodMax at render time); bloodPoolCount —
    // plain number used instead of the grid for generation 3 (no fixed cap, free-form «счётчик»).
    // Mode is derived from m.header.generation at render/normalize time, not stored on the model.
    bloodPool: Array(20).fill(false), bloodPoolCount: 0, bloodPerTurn: 1,
    health: { bruised: false, hurt: false, injured: false, wounded: false, mauled: false, crippled: false, incapacitated: false },
    flaw: '', experience: { total: 0, spent: 0, log: [] },
    // ── Page 2 ──
    specializations: Array.from({ length: 6 }, () => ({ ability: '', spec: '' })),
    otherTraits: Array.from({ length: 6 }, () => ({ name: '', val: 0 })),
    rituals: Array.from({ length: 6 }, () => ({ name: '', level: '' })),
    history: '', goals: '',
    description: { birthDate: '', apparentAge: '', deathDate: '', gender: '', race: '', hair: '', eyes: '', heightWeight: '', build: '', nationality: '' },
    allies: '', possessions: '',
    combat: Array.from({ length: 4 }, () => ({ weapon: '', diff: '', damage: '', range: '', rate: '', clip: '', size: '' })),
  };
}

// Pad to a baseline of n rows, but never truncate a saved array that's longer than n —
// rows added via the «+ Добавить» UI (see _v20AddRow) must survive normalize/reload, not
// just the in-memory session. Length only ever grows here; trimming is the user's «×».
const _v20PadPairs = (arr, n, keys) => {
  const blank = () => Object.fromEntries(keys.map(k => [k, '']));
  const len = Math.max(n, Array.isArray(arr) ? arr.length : 0);
  const out = Array.from({ length: len }, blank);
  if (Array.isArray(arr)) arr.forEach((x, i) => { const o = blank(); for (const k of keys) o[k] = String(x?.[k] || ''); out[i] = o; });
  return out;
};

function _v20PickClamped(o, max = 5) {
  const r = {};
  if (o && typeof o === 'object') for (const k in o) r[k] = _clamp(o[k], 0, max);
  return r;
}
function _v20PadSlots(arr, n, max = 5) {
  const len = Math.max(n, Array.isArray(arr) ? arr.length : 0);
  const out = Array.from({ length: len }, () => ({ name: '', val: 0 }));
  if (Array.isArray(arr)) arr.forEach((x, i) => { out[i] = { name: String(x?.name || ''), val: _clamp(x?.val, 0, max) }; });
  return out;
}

// Baseline row counts for the fixed-length sections that now support «+ Добавить» (see
// _v20AddRow/_v20RemoveRow below). Mirrors the literal counts already baked into _v20Empty()/
// _v20Normalize() — kept here as named constants so add/remove logic and the «cannot delete a
// baseline row» guard read from one place instead of repeating magic numbers.
const _V20_BASELINE_LEN = { disciplines: 6, psychicPowers: 6, backgrounds: 6, otherTraits: 6, rituals: 6 };
function _v20AbilityBaselineLen(g) { return V20_ABILITIES[g].length + 2; }

// Append one blank row to a fixed-length array section and re-render. `group` is set only for
// abilities (talents/skills/knowledges); other sections pass it as null. New rows are plain
// {name,val} (or {name,level} for rituals) — identical shape to the existing blank slots, so they
// flow through _v20Set/_v20DotCapFor/_v20ClampToGen without any special-casing.
function _v20AddRow(section, group) {
  const m = _v20Model;
  if (section === 'abilities') {
    m.abilities[group].push({ name: '', val: 0 });
  } else if (section === 'rituals') {
    m.rituals.push({ name: '', level: '' });
  } else {
    m[section].push({ name: '', val: 0 });
  }
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}

// Remove one row added beyond the baseline count. Baseline/canonical rows (the first
// _V20_BASELINE_LEN[section] slots, or the fixed canonical abilities + first 2 blank custom
// slots) can never be removed this way — only rows the «+ Добавить» button itself created.
function _v20RemoveRow(section, group, idx) {
  const m = _v20Model;
  const arr = group ? m.abilities[group] : m[section];
  const baseline = group ? _v20AbilityBaselineLen(group) : _V20_BASELINE_LEN[section];
  if (idx < baseline || idx >= arr.length) return;
  arr.splice(idx, 1);
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}

// Generation → max dot value for Attributes/Abilities/Disciplines/Backgrounds/«other traits»
// (RULES_V20.generations[gen].maxDots — «Единая таблица максимума точек», см. character_sheet_v20.md).
// Falls back to 5 (classic cap) when the generation is unset/unrecognised.
function _v20MaxDotsForGen(gen) {
  const info = v20GenerationInfo(gen);
  return info?.maxDots || 5;
}

// Dotted model paths whose ceiling is the generation-aware «Единая таблица максимума точек»
// (Attributes/Abilities/Disciplines/Backgrounds + «other traits» = факты биографии под другим
// именем). Virtues/Willpower/Humanity keep their own fixed caps (5/10/10) — checked separately,
// not through this table — so a future «add row» feature can reuse this single check point
// without re-deriving which categories are generation-capped.
const _V20_GEN_CAPPED_PREFIXES = ['attributes.', 'abilities.', 'disciplines.', 'backgrounds.', 'otherTraits.'];

// Cap for a given dotted path on the current model: generation-aware max for the four capped
// categories (vampires only), else the classic fixed cap (10 for humanity/willpower, 5 otherwise).
function _v20DotCapFor(dpath, m) {
  const isVamp = (m.lineage || '') === 'vampires';
  if (isVamp && _V20_GEN_CAPPED_PREFIXES.some(p => dpath.startsWith(p))) return _v20MaxDotsForGen(m.header.generation);
  if (dpath === 'humanity' || dpath === 'willpower.permanent') return 10;
  return 5;
}

// Re-cap Attributes/Abilities/Disciplines/Backgrounds/«other traits» in-place after the user
// changes the generation field by hand (e.g. 5e → 13e), so a trait raised under a looser cap
// doesn't render with more filled dots than the new, smaller dot grid has slots for. Also
// resizes the blood pool grid (or switches to/from the 3e counter) to match the new generation.
function _v20ClampToGen(m) {
  if ((m.lineage || '') !== 'vampires') return;
  const cap = _v20MaxDotsForGen(m.header.generation);
  for (const g of ['physical', 'social', 'mental']) for (const k in m.attributes[g]) m.attributes[g][k] = _clamp(m.attributes[g][k], 0, cap);
  for (const g of ['talents', 'skills', 'knowledges']) for (const s of m.abilities[g]) s.val = _clamp(s.val, 0, cap);
  for (const d of m.disciplines) d.val = _clamp(d.val, 0, cap);
  for (const b of m.backgrounds) b.val = _clamp(b.val, 0, cap);
  for (const t of m.otherTraits) t.val = _clamp(t.val, 0, cap);
  const genInfo = v20GenerationInfo(m.header.generation);
  const bloodMax = genInfo?.bloodMax;
  if (bloodMax != null) {
    const filled = m.bloodPool.filter(Boolean).length;
    m.bloodPool = _fillBoxes(bloodMax, Math.min(bloodMax, filled));
  }
}

// Fill a fresh default with whatever a (possibly partial / legacy) model provides.
function _v20Normalize(m) {
  const e = _v20Empty(m?.lineage || 'vampires');
  if (!m || typeof m !== 'object') return e;
  if (m.lineage) e.lineage = m.lineage;
  Object.assign(e.header, m.header || {});
  const isVamp = e.lineage === 'vampires';
  const maxDots = isVamp ? _v20MaxDotsForGen(e.header.generation) : 5;
  for (const g of ['physical', 'social', 'mental']) Object.assign(e.attributes[g], _v20PickClamped(m.attributes?.[g], maxDots));
  for (const g of ['talents', 'skills', 'knowledges']) {
    const src = Array.isArray(m.abilities?.[g]) ? m.abilities[g] : [];
    // Baseline template (canonical fixed rows + 2 blank custom slots) never shrinks below its own
    // length, but grows past it when a saved sheet has more custom slots (rows added via «+ Добавить» —
    // see _v20AddRow) — same «pad to at least N, never truncate user growth» rule as _v20PadSlots.
    const base = e.abilities[g];
    const len = Math.max(base.length, src.length);
    e.abilities[g] = Array.from({ length: len }, (_, i) => {
      const slot = base[i] || { name: '', val: 0, fixed: false };
      const s = src[i];
      return { name: slot.fixed ? slot.name : String(s?.name || ''), val: _clamp(s?.val ?? slot.val, 0, maxDots), fixed: !!slot.fixed };
    });
  }
  e.disciplines = _v20PadSlots(m.disciplines, 6, maxDots);
  // Психические способности не зависят от поколения (мортал его не имеет) — фиксированный max 5,
  // как и остальные мортал-черты; maxDots здесь уже =5 для немортал-веток не используется.
  e.psychicPowers = _v20PadSlots(m.psychicPowers, 6, 5);
  e.backgrounds = _v20PadSlots(m.backgrounds, 6, maxDots);
  Object.assign(e.virtues, _v20PickClamped(m.virtues, 5));
  if (typeof m.meritsFlaws === 'string') e.meritsFlaws = m.meritsFlaws;
  if (m.humanity != null) e.humanity = _clamp(m.humanity, 0, 10);
  if (m.path) e.path = m.path;
  if (m.willpower) { e.willpower.permanent = _clamp(m.willpower.permanent, 0, 10); e.willpower.temp = _boolArr(m.willpower.temp, 10); }
  const genInfo = isVamp ? v20GenerationInfo(e.header.generation) : null;
  const bloodMax = genInfo?.bloodMax || 20;
  if (m.bloodPool) e.bloodPool = _boolArr(m.bloodPool, bloodMax);
  e.bloodPoolCount = _num(m.bloodPoolCount, 0);
  if (m.bloodPerTurn != null) e.bloodPerTurn = _num(m.bloodPerTurn, 1);
  Object.assign(e.health, m.health || {});
  if (typeof m.flaw === 'string') e.flaw = m.flaw;
  if (m.experience) {
    e.experience.total = _num(m.experience.total, 0); e.experience.spent = _num(m.experience.spent, 0);
    e.experience.log = Array.isArray(m.experience.log)
      ? m.experience.log.slice(0, 50).map(x => ({ date: String(x?.date || ''), text: String(x?.text || ''), cost: _num(x?.cost, 0) }))
      : [];
  }
  // ── Page 2 ──
  e.specializations = _v20PadPairs(m.specializations, 6, ['ability', 'spec']);
  e.otherTraits = _v20PadSlots(m.otherTraits, 6, maxDots);
  e.rituals = _v20PadPairs(m.rituals, 6, ['name', 'level']);
  if (typeof m.history === 'string') e.history = m.history;
  if (typeof m.goals === 'string') e.goals = m.goals;
  Object.assign(e.description, m.description || {});
  if (typeof m.allies === 'string') e.allies = m.allies;
  if (typeof m.possessions === 'string') e.possessions = m.possessions;
  e.combat = _v20PadPairs(m.combat, 4, ['weapon', 'diff', 'damage', 'range', 'rate', 'clip', 'size']);
  return e;
}

// Best-effort parse of the AI markdown sheet into the structured model.
function _v20ParseMd(md, lineage) {
  const m = _v20Empty(lineage || 'vampires');
  if (!md) return m;
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let sec = '', sub = '', mm;
  const rows = [];
  const secText = {};   // section title → raw prose lines (non-table, non-heading)
  for (const ln of lines) {
    if ((mm = ln.match(/^##\s+(.+)$/)))  { sec = mm[1].replace(/[#*]/g, '').trim().toLowerCase(); sub = ''; continue; }
    if ((mm = ln.match(/^###\s+(.+)$/))) { sub = mm[1].replace(/[#*]/g, '').trim().toLowerCase(); continue; }
    const isTable = /^\s*\|/.test(ln);
    if (!isTable) {
      const t = ln.trim();
      if (t && !/^-{3,}$/.test(t) && !/^>/.test(t)) (secText[sec] ??= []).push(t);
      continue;
    }
    if (/\|\s*:?-{3,}/.test(ln)) continue;
    const cells = ln.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const name = cells[0].replace(/\*\*/g, '').trim();
    if (!name) continue;
    // Skip table header rows — their «●» header cell would parse as a rating of 1.
    if (/^(способност|характеристик|атрибут|дисциплин|факт биографии|backgrounds|предыстор|добродетел|параметр|ритуал|оружие|уровень|значение|название|поле)/i.test(name)) continue;
    const rating = _parseRatingCells(cells);
    rows.push({ sec, sub, name, nameNorm: _v20Norm(name), nameLow: name.toLowerCase(), val: rating ? rating.value : null, cells });
  }
  const findRow = ru => { const t = ru.toLowerCase(); return rows.find(r => r.nameNorm === t || r.nameNorm.startsWith(t)); };

  // Header
  const hmap = { 'имя': 'name', 'игрок': 'player', 'хроника': 'chronicle', 'натура': 'nature', 'маска': 'demeanor', 'амплуа': 'concept', 'клан': 'clan', 'поколение': 'generation', 'сир': 'sire' };
  for (const r of rows) {
    const key = hmap[r.nameNorm];
    if (key) { const v = (r.cells[1] || '').replace(/\*\*/g, '').trim(); if (v && v !== '—') m.header[key] = v; }
  }
  // Attributes
  for (const g of ['physical', 'social', 'mental']) for (const [k, ru] of V20_ATTRS[g]) { const r = findRow(ru); if (r && r.val != null) m.attributes[g][k] = r.val; }
  // Abilities (fixed + up to 2 custom extras per group)
  const groupRe = { talents: /талант/, skills: /навык/, knowledges: /знани/ };
  for (const g of ['talents', 'skills', 'knowledges']) {
    const used = new Set();
    V20_ABILITIES[g].forEach((ru, i) => { const r = findRow(ru); if (r) { used.add(r); if (r.val != null) m.abilities[g][i].val = r.val; } });
    const extras = rows.filter(r => groupRe[g].test(r.sub) && r.val != null && !used.has(r)
      && !V20_ABILITIES[g].some(ru => _v20Norm(ru) === r.nameNorm));
    let ei = 10;
    for (const r of extras) { if (ei > 11) break; m.abilities[g][ei] = { name: r.name.replace(/\*\*/g, '').trim(), val: r.val }; ei++; }
  }
  // Disciplines / Backgrounds (ordered, name + dots)
  const disc = rows.filter(r => /дисциплин/.test(r.sub) && r.val != null).slice(0, 6);
  disc.forEach((r, i) => { m.disciplines[i] = { name: r.name.replace(/\*\*/g, '').trim(), val: r.val }; });
  const bg = rows.filter(r => /(факт биографии|backgrounds|предыстор)/.test(r.sub) && r.val != null).slice(0, 6);
  bg.forEach((r, i) => { m.backgrounds[i] = { name: r.name.replace(/\*\*/g, '').trim(), val: r.val }; });
  // Психические способности — мортал-секция «## 🔆 Нумина / Грани» (своя «##», не подсекция
  // «Преимуществ», в отличие от дисциплин/фактов биографии выше — см. character_sheet_mortal.md).
  const psy = rows.filter(r => /нумина|грани/.test(r.sec) && r.val != null).slice(0, 6);
  psy.forEach((r, i) => { m.psychicPowers[i] = { name: r.name.replace(/\*\*/g, '').trim(), val: r.val }; });
  // Virtues
  for (const r of rows) {
    if (!/добродетел/.test(r.sub) || r.val == null) continue;
    if (/совесть|решимост/.test(r.nameNorm)) m.virtues.conscience = r.val;
    else if (/самоконтрол|инстинкт/.test(r.nameNorm)) m.virtues.selfcontrol = r.val;
    else if (/смелост|courage/.test(r.nameNorm)) m.virtues.courage = r.val;
  }
  // Derived (numbers may exceed 5 → read the numeric cell directly)
  const genInfoForParse = (m.lineage === 'vampires') ? v20GenerationInfo(m.header.generation) : null;
  const bloodMaxForParse = genInfoForParse?.bloodMax || 20;
  for (const r of rows) {
    if (!/производные/.test(r.sec)) continue;
    const numC = r.cells.find((c, idx) => idx > 0 && /^\d+$/.test(c));
    const n = numC != null ? parseInt(numC, 10) : null;
    if (/столп/.test(r.nameLow)) { const v = (r.cells[1] || '').trim(); if (v && v !== '—') m.path = v; }
    else if (/человечност|путь/.test(r.nameLow) && n != null) m.humanity = Math.min(10, n);
    else if (/постоянн/.test(r.nameLow) && n != null) m.willpower.permanent = Math.min(10, n);
    else if (/временн/.test(r.nameLow) && n != null) m.willpower.temp = _fillBoxes(10, Math.min(10, n));
    else if (/(запас крови|blood pool)/.test(r.nameLow) && n != null) {
      if (genInfoForParse && genInfoForParse.bloodMax == null) m.bloodPoolCount = n;       // 3-е поколение — счётчик без потолка
      else m.bloodPool = _fillBoxes(bloodMaxForParse, Math.min(bloodMaxForParse, n));
    }
    else if (/(предел траты|blood\/turn)/.test(r.nameLow) && n != null) m.bloodPerTurn = n;
  }

  // ── Page 2 ──
  const clean = s => String(s || '').replace(/\*\*/g, '').trim();
  const notDash = s => { const v = clean(s); return v && v !== '—' && !/^⚠️?/.test(v) ? v : ''; };
  const secProse = re => { const k = Object.keys(secText).find(key => re.test(key)); return k ? secText[k].join('\n') : ''; };
  const afterLabel = (text, re) => { const ln = text.split('\n').find(l => re.test(l)); return ln ? notDash(ln.replace(/^[^:]*:\s*/, '')) : ''; };

  // Specializations (Способность | Специализация)
  const specs = rows.filter(r => /специализаци/.test(r.sec) && notDash(r.cells[0]) && notDash(r.cells[1]));
  specs.slice(0, 6).forEach((r, i) => { m.specializations[i] = { ability: clean(r.cells[0]), spec: clean(r.cells[1]) }; });

  // Other traits (Параметр | ● | Значение, 3 cols) and Rituals (Ритуал | Уровень, 2 cols)
  // share one «Другие параметры и ритуалы» section → tell them apart by column count.
  const ot = rows.filter(r => /(другие параметры|ритуал)/.test(r.sec) && r.cells.length >= 3 && r.val != null && notDash(r.name));
  ot.slice(0, 6).forEach((r, i) => { m.otherTraits[i] = { name: clean(r.name), val: r.val }; });
  const rit = rows.filter(r => /(другие параметры|ритуал)/.test(r.sec) && r.cells.length === 2 && notDash(r.name) && notDash(r.cells[1]));
  rit.slice(0, 6).forEach((r, i) => { m.rituals[i] = { name: clean(r.name), level: clean(r.cells[1]) }; });

  // Description (Поле | Значение)
  const dmap = { 'дата рождения': 'birthDate', 'видимый возраст': 'apparentAge', 'дата смерти': 'deathDate', 'пол': 'gender', 'раса': 'race', 'волосы': 'hair', 'глаза': 'eyes', 'рост/вес': 'heightWeight', 'телосложение': 'build', 'национальность': 'nationality' };
  for (const r of rows) { if (!/описание/.test(r.sec)) continue; const key = dmap[r.nameNorm]; if (key) m.description[key] = notDash(r.cells[1]); }

  // Combat (weapon | diff | damage | range | rate | clip | size)
  const ckeys = ['weapon', 'diff', 'damage', 'range', 'rate', 'clip', 'size'];
  const cmb = rows.filter(r => /боевые столкновения/.test(r.sec) && r.cells.some(c => notDash(c)));
  cmb.slice(0, 4).forEach((r, i) => { const o = {}; ckeys.forEach((k, j) => o[k] = clean(r.cells[j] || '')); m.combat[i] = o; });

  // Prose sections
  const histText = secProse(/история/);
  m.history = afterLabel(histText, /истори/i) || (notDash(histText) && !/цел/i.test(histText) ? histText : '');
  m.goals = afterLabel(histText, /цел/i);
  m.allies = secProse(/союзники/).split('\n').map(l => l.replace(/^[-*]\s*/, '')).filter(s => notDash(s)).join('\n');
  m.possessions = secProse(/имущество/).split('\n').map(l => l.replace(/^[-*]\s*/, '')).filter(s => notDash(s)).join('\n');

  return m;
}

function _v20ModelFrom(d) {
  if (d && d.source === 'json' && d.data) { const m = _v20Normalize(d.data); m.lineage = d.lineage || m.lineage; return m; }
  if (d && d.source === 'md') return _v20ParseMd(d.md, d.lineage);
  return _v20Empty(d?.lineage || 'vampires');
}

// ── Path get/set helpers (dotted, array-index aware) ──────────────────────────
function _v20Get(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function _v20Set(obj, path, val) {
  const keys = path.split('.'); const last = keys.pop();
  const tgt = keys.reduce((o, k) => (o[k] ??= {}), obj);
  tgt[last] = val;
}

// ── Render fragments ──────────────────────────────────────────────────────────
function _v20DotsHtml(dpath, val, max = 5) {
  let s = `<span class="v20-dots" data-dpath="${dpath}" data-max="${max}">`;
  for (let dd = 1; dd <= max; dd++) s += `<span class="v20-dot${dd <= val ? ' on' : ''}" data-d="${dd}" role="radio" aria-checked="${dd === val}" tabindex="0"></span>`;
  return s + `<span class="v20-dot-num">${val}</span></span>`;
}
function _v20DotRow(label, dpath, val, max = 5) {
  return `<div class="v20-row"><span class="v20-row-name">${escHtml(label)}</span>${_v20DotsHtml(dpath, val, max)}</div>`;
}
// `removeKey` ('section' or 'section:group', e.g. 'disciplines' / 'abilities:talents') renders a
// «×» button wired to data-v20-remove/data-v20-remove-idx when present — only passed for rows past
// the section's baseline count (see _v20AddRow/_v20RemoveRow), so canonical rows never get a «×».
function _v20NamedDotRow(namePath, nameVal, dpath, val, max = 5, removeKey = '') {
  const rm = removeKey ? `<button type="button" class="v20-row-remove-btn" data-v20-remove="${escAttr(removeKey)}" data-v20-remove-idx="${dpath.match(/(\d+)/)?.[1] ?? ''}" title="Удалить строку">×</button>` : '';
  return `<div class="v20-row v20-named">${rm}<input class="v20-line-input" data-tpath="${namePath}" value="${escAttr(nameVal)}" placeholder="…">${_v20DotsHtml(dpath, val, max)}</div>`;
}
function _v20BoxesHtml(bpath, arr) {
  return `<span class="v20-boxes">${arr.map((on, i) => `<input type="checkbox" class="v20-box" data-bpath="${bpath}" data-i="${i}"${on ? ' checked' : ''}>`).join('')}</span>`;
}
function _v20Field(label, tpath, val, extra = '') {
  return `<label class="v20-field"><span class="v20-field-lbl">${escHtml(label)}</span><input class="v20-field-input" data-tpath="${tpath}" value="${escAttr(val || '')}"${extra}></label>`;
}
// «+ Добавить» affordance appended at the end of a fixed-length section's row list. removeKey
// matches the one passed to _v20NamedDotRow/used by discRow/ritRow — 'section' or 'section:group'.
function _v20AddRowBtn(removeKey) {
  return `<button type="button" class="v20-mini-action v20-add-row-btn" data-v20-add="${escAttr(removeKey)}">+ Добавить</button>`;
}

// Видимый возраст = Год обращения − Год рождения (карточка персонажа). Возвращает целое число
// при двух валидных числовых годах, иначе null (поле остаётся обычным редактируемым текстом —
// «⚠️ Не указан» и пр. card placeholders деградируют без NaN/краша, см. web/lib/parsers.js).
function _v20ComputeApparentAge(card) {
  if (!card) return null;
  const by = parseInt(String(card.birthYear ?? '').replace(/[^\d-]/g, ''), 10);
  const ey = parseInt(String(card.embraceYear ?? '').replace(/[^\d-]/g, ''), 10);
  if (!Number.isFinite(by) || !Number.isFinite(ey)) return null;
  const age = ey - by;
  return age >= 0 ? age : null;
}

// ── Rules engine: derived stats, auto badges, clan/generation actions, validation ──
function _v20Derive(m) {
  const isVamp = (m.lineage || '') === 'vampires';
  const out = { willpower: m.virtues.courage, humanity: null, gen: null };
  if (!m.path || /^человечност/i.test(m.path)) out.humanity = _clamp(m.virtues.conscience + m.virtues.selfcontrol, 0, 10);
  if (isVamp) out.gen = v20GenerationInfo(m.header.generation);
  return out;
}

function _v20AutoBadge(actual, computed, path, kind) {
  if (computed == null || !Number.isFinite(Number(computed))) return '';
  const match = Number(actual) === Number(computed);
  const title = match ? 'Совпадает с расчётным значением' : `Расчётное по правилам: ${computed}. Нажмите, чтобы применить.`;
  return `<button type="button" class="v20-auto-badge${match ? ' is-match' : ''}" data-auto-path="${path}" data-auto-kind="${kind}" data-auto-val="${computed}" title="${escAttr(title)}">${match ? '✓ авто' : `↺ ${computed}`}</button>`;
}

function _v20ApplyAutoBadge(badge) {
  const path = badge.dataset.autoPath, kind = badge.dataset.autoKind, val = badge.dataset.autoVal;
  _v20Set(_v20Model, path, kind === 'dot' ? _clamp(val, 0, 10) : val);
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}

// ── Dice roller V20 (Фаза 4, GM-ориентированный) ────────────────────────────
let _v20RollLog = [];

function _v20RollPool(poolSize, difficulty, specialized) {
  const n = Math.max(0, poolSize);
  const dice = [];
  let successes = 0, ones = 0;
  for (let i = 0; i < n; i++) {
    const d = 1 + Math.floor(Math.random() * 10);
    dice.push(d);
    if (d === 1) ones++;
    else if (d >= difficulty) successes += (d === 10 && specialized) ? 2 : 1;
  }
  return { dice, successes, botch: n > 0 && successes === 0 && ones > 0 };
}

// Most severe checked wound level → numeric dice penalty (V20_HEALTH penalty text, e.g. '−2').
function _v20HealthPenalty(m) {
  let pen = 0;
  for (const [k, , penText] of V20_HEALTH) {
    if (!m.health[k]) continue;
    const n = parseInt(String(penText).replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n > pen) pen = n;
  }
  return pen;
}

function _v20RollOptionsHtml() {
  const m = _v20Model;
  const attrOpts = ['<option value="">—</option>'];
  for (const g of ['physical', 'social', 'mental']) for (const [k, ru] of V20_ATTRS[g]) attrOpts.push(`<option value="attributes.${g}.${k}">${escHtml(ru)} (${m.attributes[g][k]})</option>`);
  const abilOpts = ['<option value="">—</option>'];
  for (const g of ['talents', 'skills', 'knowledges']) m.abilities[g].forEach((s, i) => { if (s.name) abilOpts.push(`<option value="abilities.${g}.${i}">${escHtml(s.name)} (${s.val})</option>`); });
  return { attrOpts: attrOpts.join(''), abilOpts: abilOpts.join('') };
}

function _v20UpdateRollPoolInfo() {
  const attrSel = document.getElementById('v20-roll-attr'), abilSel = document.getElementById('v20-roll-abil');
  const bonus = _num(document.getElementById('v20-roll-bonus')?.value, 0);
  const attrVal = attrSel.value ? _num(_v20Get(_v20Model, attrSel.value), 0) : 0;
  const abilVal = abilSel.value ? _num(_v20Get(_v20Model, abilSel.value + '.val'), 0) : 0;
  const penalty = _v20HealthPenalty(_v20Model);
  const pool = Math.max(0, attrVal + abilVal + bonus - penalty);
  const info = document.getElementById('v20-roll-pool-info');
  if (info) info.textContent = `Пул: ${attrVal} + ${abilVal} + ${bonus}${penalty ? ` − ${penalty} (раны)` : ''} = ${pool}`;
  return pool;
}

function _v20RenderRollLog() {
  const box = document.getElementById('v20-roll-log');
  if (!box) return;
  box.innerHTML = _v20RollLog.map(r =>
    `<div class="v20-roll-log-row"><span>${escHtml(r.label)}</span><span class="v20-roll-log-result ${r.botch ? 'is-botch' : r.successes > 0 ? 'is-success' : 'is-fail'}">${escHtml(r.text)}</span></div>`).join('');
}

function _v20DoRoll() {
  const attrSel = document.getElementById('v20-roll-attr'), abilSel = document.getElementById('v20-roll-abil');
  const diff = _num(document.getElementById('v20-roll-diff')?.value, 6);
  const spec = !!document.getElementById('v20-roll-spec')?.checked;
  const pool = _v20UpdateRollPoolInfo();
  const r = _v20RollPool(pool, diff, spec);
  const optLabel = sel => sel.value ? sel.options[sel.selectedIndex].textContent.replace(/\s*\(\d+\)$/, '') : '';
  const label = [optLabel(attrSel), optLabel(abilSel)].filter(Boolean).join(' + ') || `Пул ${pool}`;
  const resultText = r.botch ? 'Ботч!' : r.successes > 0 ? `${r.successes} усп.` : 'Провал';
  const verdictClass = r.botch ? 'is-botch' : r.successes > 0 ? 'is-success' : 'is-fail';
  const diceHtml = r.dice.length
    ? r.dice.map(d => `<span class="v20-roll-die${d === 1 ? ' is-one' : d >= diff ? ' is-success' : ''}${d === 10 ? ' is-ten' : ''}">${d}</span>`).join('')
    : '<span class="v20-roll-die-empty">пул 0</span>';
  document.getElementById('v20-roll-result').innerHTML = `<div class="v20-roll-dice">${diceHtml}</div><div class="v20-roll-verdict ${verdictClass}">${escHtml(resultText)}</div>`;
  _v20RollLog.unshift({ label, text: `${resultText} (сл. ${diff}, пул ${pool})`, successes: r.successes, botch: r.botch });
  _v20RollLog = _v20RollLog.slice(0, 6);
  _v20RenderRollLog();
}

function _v20CloseRollModal() { document.getElementById('v20-roll-modal-backdrop')?.classList.remove('open'); }

function _v20OpenRollModal(seed) {
  let modal = document.getElementById('v20-roll-modal-backdrop');
  const { attrOpts, abilOpts } = _v20RollOptionsHtml();
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'v20-roll-modal-backdrop';
    modal.className = 'v20-disc-modal-backdrop';
    modal.innerHTML = `<div class="v20-disc-modal v20-roll-modal">
      <button type="button" class="v20-disc-modal-close" id="v20-roll-modal-close" aria-label="Закрыть бросок">✕</button>
      <h3>🎲 Бросок</h3>
      <div class="v20-roll-row">
        <label class="v20-roll-field">Характеристика<select id="v20-roll-attr">${attrOpts}</select></label>
        <label class="v20-roll-field">Способность<select id="v20-roll-abil">${abilOpts}</select></label>
      </div>
      <div class="v20-roll-row">
        <label class="v20-roll-field v20-roll-field-sm">Доп. кубики<input type="number" id="v20-roll-bonus" value="0" class="v20-mini-input"></label>
        <label class="v20-roll-field v20-roll-field-sm">Сложность<input type="number" id="v20-roll-diff" value="6" class="v20-mini-input"></label>
        <label class="v20-roll-spec"><input type="checkbox" id="v20-roll-spec"> Специализация (10 = 2 усп.)</label>
      </div>
      <div class="v20-roll-pool-info" id="v20-roll-pool-info"></div>
      <button type="button" class="cdet-sheet-btn primary v20-roll-go" id="v20-roll-go">🎲 Бросить</button>
      <div class="v20-roll-result" id="v20-roll-result"></div>
      <div class="v20-roll-log" id="v20-roll-log"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) _v20CloseRollModal(); });
    modal.querySelector('#v20-roll-modal-close').addEventListener('click', _v20CloseRollModal);
    modal.querySelector('#v20-roll-go').addEventListener('click', _v20DoRoll);
    modal.querySelectorAll('#v20-roll-attr, #v20-roll-abil, #v20-roll-bonus').forEach(el => el.addEventListener('input', _v20UpdateRollPoolInfo));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _v20CloseRollModal(); });
  } else {
    modal.querySelector('#v20-roll-attr').innerHTML = attrOpts;
    modal.querySelector('#v20-roll-abil').innerHTML = abilOpts;
  }
  modal.querySelector('#v20-roll-attr').value = seed?.attr || '';
  modal.querySelector('#v20-roll-abil').value = seed?.abil || '';
  document.getElementById('v20-roll-result').innerHTML = '';
  modal.classList.add('open');
  _v20UpdateRollPoolInfo();
  _v20RenderRollLog();
}

// ── Discipline reference library (Фаза 3) ──────────────────────────────────
// Источник истины — system/library/disciplines/*.md (сервер парсит → /api/library/disciplines).
let _disciplinesCache = null;
async function ensureDisciplines() {
  if (_disciplinesCache) return _disciplinesCache;
  try {
    const data = await fetch('/api/library/disciplines').then(r => r.json());
    _disciplinesCache = Array.isArray(data) ? data : [];
  } catch { _disciplinesCache = []; }
  return _disciplinesCache;
}
function _discBySlug(slug) { return (_disciplinesCache || []).find(d => d.slug === slug) || null; }

// Уровень способности → N красно-золотых точек (1…10).
function _libLevelDots(n) {
  const v = Math.max(1, Math.min(10, parseInt(n, 10) || 1));
  return `<span class="lib-dots" title="Уровень ${v}" aria-label="Уровень ${v}">${'<span class="lib-dot"></span>'.repeat(v)}</span>`;
}

function _libPowerHtml(p) {
  return `<div class="lib-power">
    <div class="lib-power-head">${_libLevelDots(p.level)}<span class="lib-power-name">${escHtml(p.name)}</span></div>
    ${p.literary ? `<div class="lib-power-sec"><div class="lib-power-label">Литературное описание</div><p class="lib-power-text">${escHtml(p.literary)}</p></div>` : ''}
    ${p.system ? `<div class="lib-power-sec"><div class="lib-power-label">Система</div><p class="lib-power-text lib-power-sys">${escHtml(p.system)}</p></div>` : ''}
  </div>`;
}

function _libDisciplineDetailHtml(d) {
  if (!d) return '<div class="v20-disc-empty">Дисциплина не найдена в справочнике.</div>';
  let body;
  if (d.noLevels && d.paths?.length) {
    body = d.paths.map(p => `
      <div class="lib-path">
        <div class="lib-path-title">${escHtml(p.name)}</div>
        ${p.note ? `<div class="v20-disc-note">${escHtml(p.note)}</div>` : ''}
        ${(p.levels || []).map(_libPowerHtml).join('')}
      </div>`).join('');
  } else {
    body = `${d.note ? `<div class="v20-disc-note">${escHtml(d.note)}</div>` : ''}${(d.levels || []).map(_libPowerHtml).join('')}`;
  }
  return `<div class="v20-disc-detail-head"><h3>${escHtml(d.name)}</h3><span class="v20-disc-clans">${escHtml(d.clans || '')}</span></div>${body}`;
}
function _libDisciplineListHtml() {
  return `<div class="v20-disc-list">${(_disciplinesCache || []).map(d =>
    `<button type="button" class="v20-disc-list-item" data-disc-slug="${escAttr(d.slug)}"><span>${escHtml(d.name)}</span><span class="v20-disc-list-clans">${escHtml(d.clans || '')}</span></button>`).join('')}</div>`;
}

// Имя дисциплины из листа («Прорицание», «Auspex», «Прорицание (Auspex)») → slug.
function v20DisciplineKey(name) {
  const norm = String(name || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
  if (!norm) return null;
  for (const d of (_disciplinesCache || [])) {
    const ru = d.name.toLowerCase().replace(/\(.*?\)/g, '').trim();
    if (ru === norm || norm.startsWith(ru) || ru.startsWith(norm)) return d.slug;
  }
  return null;
}
function v20DisciplineInfo(name) { const slug = v20DisciplineKey(name); return slug ? _discBySlug(slug) : null; }

function _v20RenderDisciplineLibrary() {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = `<h3>📚 Справочник дисциплин</h3>${_libDisciplineListHtml()}`;
}
function _v20RenderDisciplineDetail(slug) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = `<button type="button" class="v20-disc-back" data-disc-back>← к списку</button>${_libDisciplineDetailHtml(_discBySlug(slug))}`;
}
function _v20CloseDisciplineModal() { document.getElementById('v20-disc-modal-backdrop')?.classList.remove('open'); }
async function _v20OpenDisciplineModal(name) {
  let modal = document.getElementById('v20-disc-modal-backdrop');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'v20-disc-modal-backdrop';
    modal.className = 'v20-disc-modal-backdrop';
    modal.innerHTML = `<div class="v20-disc-modal">
      <button type="button" class="v20-disc-modal-close" id="v20-disc-modal-close" aria-label="Закрыть справочник">✕</button>
      <div id="v20-disc-modal-body"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) _v20CloseDisciplineModal(); });
    modal.querySelector('#v20-disc-modal-close').addEventListener('click', _v20CloseDisciplineModal);
    modal.addEventListener('click', e => {
      const back = e.target.closest('[data-disc-back]'); if (back) { _v20RenderDisciplineLibrary(); return; }
      const item = e.target.closest('[data-disc-slug]'); if (item) { _v20RenderDisciplineDetail(item.dataset.discSlug); return; }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _v20CloseDisciplineModal(); });
  }
  modal.classList.add('open');
  const body = document.getElementById('v20-disc-modal-body');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка справочника…</div>';
  await ensureDisciplines();
  const slug = name ? v20DisciplineKey(name) : null;
  if (slug) _v20RenderDisciplineDetail(slug);
  else _v20RenderDisciplineLibrary();
}

// ── Library page → «Дисциплины» tab (same reference, full-page instead of modal) ──
function _libRenderDisciplineList() {
  const body = document.getElementById('lib-disciplines-body');
  if (body) body.innerHTML = _libDisciplineListHtml();
}
function _libRenderDisciplineDetail(slug) {
  const body = document.getElementById('lib-disciplines-body');
  if (body) body.innerHTML = `<button type="button" class="v20-disc-back" data-disc-back>← к списку</button>${_libDisciplineDetailHtml(_discBySlug(slug))}`;
}
async function loadLibrary() {
  const body = document.getElementById('lib-disciplines-body');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  await ensureDisciplines();
  _libRenderDisciplineList();
}
document.getElementById('lib-disciplines-body')?.addEventListener('click', e => {
  const back = e.target.closest('[data-disc-back]'); if (back) { _libRenderDisciplineList(); return; }
  const item = e.target.closest('[data-disc-slug]'); if (item) { _libRenderDisciplineDetail(item.dataset.discSlug); return; }
});

// ── Psychic powers reference library (зеркало справочника дисциплин выше) ──────
// Источник истины — system/library/psychics/*.md (сервер парсит → /api/library/psychics).
let _psychicsCache = null;
async function ensurePsychics() {
  if (_psychicsCache) return _psychicsCache;
  try {
    const data = await fetch('/api/library/psychics').then(r => r.json());
    _psychicsCache = Array.isArray(data) ? data : [];
  } catch { _psychicsCache = []; }
  return _psychicsCache;
}
function _psyBySlug(slug) { return (_psychicsCache || []).find(p => p.slug === slug) || null; }

function _libPsyDetailHtml(p) {
  if (!p) return '<div class="v20-disc-empty">Способность не найдена в справочнике.</div>';
  const body = `${p.note ? `<div class="v20-disc-note">${escHtml(p.note)}</div>` : ''}${(p.levels || []).map(_libPowerHtml).join('')}`;
  const meta = [p.category, p.roll ? `Бросок: ${p.roll}` : ''].filter(Boolean).join(' · ');
  return `<div class="v20-disc-detail-head"><h3>${escHtml(p.name)}</h3><span class="v20-disc-clans">${escHtml(meta)}</span></div>${body}`;
}
function _libPsyListHtml() {
  return `<div class="v20-disc-list">${(_psychicsCache || []).map(p =>
    `<button type="button" class="v20-disc-list-item" data-psy-slug="${escAttr(p.slug)}"><span>${escHtml(p.name)}</span><span class="v20-disc-list-clans">${escHtml(p.category || '')}</span></button>`).join('')}</div>`;
}
function _libRenderPsyList() {
  const body = document.getElementById('lib-psychics-body');
  if (body) body.innerHTML = _libPsyListHtml();
}
function _libRenderPsyDetail(slug) {
  const body = document.getElementById('lib-psychics-body');
  if (body) body.innerHTML = `<button type="button" class="v20-disc-back" data-psy-back>← к списку</button>${_libPsyDetailHtml(_psyBySlug(slug))}`;
}
async function loadPsychicsLibrary() {
  const body = document.getElementById('lib-psychics-body');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  await ensurePsychics();
  _libRenderPsyList();
}
document.getElementById('lib-psychics-body')?.addEventListener('click', e => {
  const back = e.target.closest('[data-psy-back]'); if (back) { _libRenderPsyList(); return; }
  const item = e.target.closest('[data-psy-slug]'); if (item) { _libRenderPsyDetail(item.dataset.psySlug); return; }
});

// ── Mortal sheet: «Психические способности» row reference (зеркало v20DisciplineKey/
// _v20OpenDisciplineModal выше, но источник — _psychicsCache/ensurePsychics(), не дисциплины).
// Имя силы из листа («Психометрия», «Биоконтроль») → slug в справочнике психических способностей.
function v20PsychicKey(name) {
  const norm = String(name || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
  if (!norm) return null;
  for (const p of (_psychicsCache || [])) {
    const ru = p.name.toLowerCase().replace(/\(.*?\)/g, '').trim();
    if (ru === norm || norm.startsWith(ru) || ru.startsWith(norm)) return p.slug;
  }
  return null;
}
function v20PsychicInfo(name) { const slug = v20PsychicKey(name); return slug ? _psyBySlug(slug) : null; }

function _v20RenderPsychicLibrary() {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = `<h3>📚 Справочник психических способностей</h3>${_libPsyListHtml()}`;
}
function _v20RenderPsychicDetail(slug) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = `<button type="button" class="v20-disc-back" data-psy-back>← к списку</button>${_libPsyDetailHtml(_psyBySlug(slug))}`;
}
// Reuses the same modal shell/backdrop as _v20OpenDisciplineModal (#v20-disc-modal-backdrop) —
// only one of the two modals is ever open at a time (vampire sheet has no psychic rows and vice
// versa), so sharing the DOM node is safe and avoids a near-duplicate modal markup block.
async function _v20OpenPsychicModal(name) {
  let modal = document.getElementById('v20-disc-modal-backdrop');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'v20-disc-modal-backdrop';
    modal.className = 'v20-disc-modal-backdrop';
    modal.innerHTML = `<div class="v20-disc-modal">
      <button type="button" class="v20-disc-modal-close" id="v20-disc-modal-close" aria-label="Закрыть справочник">✕</button>
      <div id="v20-disc-modal-body"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) _v20CloseDisciplineModal(); });
    modal.querySelector('#v20-disc-modal-close').addEventListener('click', _v20CloseDisciplineModal);
    modal.addEventListener('click', e => {
      const back = e.target.closest('[data-disc-back]'); if (back) { _v20RenderDisciplineLibrary(); return; }
      const item = e.target.closest('[data-disc-slug]'); if (item) { _v20RenderDisciplineDetail(item.dataset.discSlug); return; }
      const pback = e.target.closest('[data-psy-back]'); if (pback) { _v20RenderPsychicLibrary(); return; }
      const pitem = e.target.closest('[data-psy-slug]'); if (pitem) { _v20RenderPsychicDetail(pitem.dataset.psySlug); return; }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _v20CloseDisciplineModal(); });
  }
  modal.classList.add('open');
  const body = document.getElementById('v20-disc-modal-body');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка справочника…</div>';
  await ensurePsychics();
  const slug = name ? v20PsychicKey(name) : null;
  if (slug) _v20RenderPsychicDetail(slug);
  else _v20RenderPsychicLibrary();
}

// ── XP mode: clicking a dot up spends experience instead of a free edit ──
let _v20XpMode = false;

function _v20LabelFromPath(path, m) {
  const parts = path.split('.');
  if (parts[0] === 'attributes') { const found = V20_ATTRS[parts[1]]?.find(([k]) => k === parts[2]); return found ? found[1] : parts[2]; }
  if (parts[0] === 'abilities') return m.abilities[parts[1]][+parts[2]]?.name || 'Способность';
  return path;
}

function _v20XpKindFromPath(path, m) {
  if (path.startsWith('attributes.')) return { kind: 'attribute', label: _v20LabelFromPath(path, m) };
  if (path.startsWith('abilities.')) return { kind: 'ability', label: _v20LabelFromPath(path, m) };
  if (path.startsWith('disciplines.')) {
    const name = m.disciplines[+path.split('.')[1]]?.name || 'Дисциплина';
    const info = v20ClanInfo(m.header.clan);
    const isClanDisc = !!(info && info.disciplines.some(d => _v20Norm(d) === _v20Norm(name)));
    return { kind: 'discipline', label: name, isClanDisc };
  }
  if (path === 'virtues.conscience')  return { kind: 'virtue', label: 'Совесть/Решимость' };
  if (path === 'virtues.selfcontrol') return { kind: 'virtue', label: 'Самоконтроль/Инстинкты' };
  if (path === 'virtues.courage')     return { kind: 'virtue', label: 'Смелость' };
  if (path === 'humanity')            return { kind: 'humanity', label: m.path || 'Человечность' };
  if (path === 'willpower.permanent') return { kind: 'willpower', label: 'Воля' };
  return null; // факты биографии и пр. — без таблицы стоимости, повышаются свободно даже в режиме опыта
}

// Unchecks the highest filled box in a boolean-array pool (spend 1 point of blood/willpower).
function _v20SpendPool(path) {
  const arr = _v20Get(_v20Model, path) || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i]) { arr[i] = false; _v20Set(_v20Model, path, arr); return true; }
  }
  return false;
}

async function _v20RunAction(action) {
  const m = _v20Model;
  if (action === 'fill-clan-disc') {
    const info = v20ClanInfo(m.header.clan);
    if (!info) return;
    info.disciplines.slice(0, 3).forEach((name, i) => { m.disciplines[i].name = name; });
  } else if (action === 'insert-clan-weakness') {
    const info = v20ClanInfo(m.header.clan);
    if (!info || !info.weakness) return;
    if (m.flaw.trim() && !await showConfirm('Поле «Изъян» не пустое. Заменить текущий текст слабостью клана?', { confirmText: 'Заменить' })) return;
    m.flaw = info.weakness;
  } else if (action === 'open-disc-library') {
    _v20OpenDisciplineModal();
    return;
  } else if (action === 'open-psy-library') {
    _v20OpenPsychicModal();
    return;
  } else if (action === 'spend-blood') {
    const genInfo = (m.lineage || '') === 'vampires' ? v20GenerationInfo(m.header.generation) : null;
    if (genInfo && genInfo.bloodMax == null) {   // 3-е поколение — счётчик без потолка
      if (_num(m.bloodPoolCount, 0) <= 0) return;
      m.bloodPoolCount = _num(m.bloodPoolCount, 0) - 1;
    } else if (!_v20SpendPool('bloodPool')) return;
  } else if (action === 'spend-willpower') {
    if (!_v20SpendPool('willpower.temp')) return;
  } else return;
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}

// Advisory budget/limit check (not blocking — Рассказчик может переопределить вручную).
function _v20Validate(m) {
  const lineage = m.lineage || 'vampires';
  const budget = lineage === 'vampires' ? RULES_V20.creation.vampires.kamarilla
    : lineage === 'mortals' ? RULES_V20.creation.mortals
    : lineage === 'fairies' ? RULES_V20.creation.fairies
    : null;
  if (!budget) return { items: [], warnings: [{ text: 'Для этой линейки бюджеты создания не определены.', level: 'info' }] };

  const attrTotal = ['physical', 'social', 'mental'].reduce((a, g) => a + Object.values(m.attributes[g]).reduce((x, y) => x + y, 0), 0);
  const abilTotal = ['talents', 'skills', 'knowledges'].reduce((a, g) => a + m.abilities[g].reduce((x, s) => x + _num(s.val, 0), 0), 0);
  const virtTotal = m.virtues.conscience + m.virtues.selfcontrol + m.virtues.courage;
  const bgTotal = m.backgrounds.reduce((a, b) => a + _num(b.val, 0), 0);
  const discTotal = m.disciplines.reduce((a, d) => a + _num(d.val, 0), 0);

  const items = [
    { label: 'Характеристики', used: attrTotal - 9, max: budget.attrs.reduce((a, b) => a + b, 0) },
    { label: 'Способности', used: abilTotal, max: budget.abilities.reduce((a, b) => a + b, 0) },
    { label: 'Добродетели', used: virtTotal - 3, max: budget.virtues },
    { label: 'Факты биографии', used: bgTotal, max: budget.backgrounds },
  ];
  if (lineage === 'vampires') items.push({ label: 'Дисциплины (старт.)', used: discTotal, max: budget.disciplines });

  const warnings = [];
  const stillChargen = _num(m.experience.spent, 0) === 0;
  if (stillChargen) {
    for (const g of ['talents', 'skills', 'knowledges']) for (const s of m.abilities[g]) {
      if (_num(s.val, 0) > 3 && s.name) warnings.push({ text: `«${s.name}» выше 3 при создании (только свободные очки/одобрение Рассказчика)`, level: 'warn' });
    }
  }
  if (lineage === 'vampires') {
    // Единая таблица максимума точек (см. RULES_V20.generations[gen].maxDots, character_sheet_v20.md)
    // — потолок для характеристик/способностей/дисциплин/фактов биографии, не только дисциплин.
    const maxDots = _v20MaxDotsForGen(m.header.generation);
    for (const g of ['physical', 'social', 'mental']) for (const [k, ru] of V20_ATTRS[g]) {
      if (m.attributes[g][k] > maxDots) warnings.push({ text: `«${ru}» (${m.attributes[g][k]}) выше максимума для поколения (${maxDots}, сейчас: ${m.header.generation || '—'})`, level: 'error' });
    }
    for (const g of ['talents', 'skills', 'knowledges']) for (const s of m.abilities[g]) {
      if (s.name && _num(s.val, 0) > maxDots) warnings.push({ text: `«${s.name}» (${s.val}) выше максимума для поколения (${maxDots})`, level: 'error' });
    }
    for (const d of m.disciplines) {
      if (d.name && d.val > maxDots) warnings.push({ text: `«${d.name}» (${d.val}) выше максимума для поколения (${maxDots})`, level: 'error' });
    }
    for (const b of m.backgrounds) {
      if (b.name && b.val > maxDots) warnings.push({ text: `«${b.name}» (${b.val}) выше максимума для поколения (${maxDots})`, level: 'error' });
    }
  } else {
    for (const g of ['physical', 'social', 'mental']) for (const [k, ru] of V20_ATTRS[g]) {
      if (m.attributes[g][k] > 5) warnings.push({ text: `«${ru}» выше 5`, level: 'error' });
    }
  }
  return { items, warnings };
}

function _v20RenderValidationReport(m) {
  const r = _v20Validate(m);
  const rows = r.items.map(it => `<div class="v20-val-row${it.used > it.max ? ' over' : ''}"><span>${escHtml(it.label)}</span><span>${it.used} / ${it.max}</span></div>`).join('');
  const warn = r.warnings.length
    ? `<ul class="v20-val-warnings">${r.warnings.map(w => `<li class="v20-val-${w.level}">${escHtml(w.text)}</li>`).join('')}</ul>`
    : `<div class="v20-val-ok">Нарушений не найдено.</div>`;
  return `<div class="v20-val-budgets">${rows}</div>${warn}<div class="v20-val-note">Свободные очки и опыт не учитываются — лимиты ориентировочные.</div>`;
}

function _v20ToggleValidation() {
  const box = document.getElementById('v20-validate-report');
  if (!box) return;
  if (box.classList.contains('open')) { box.classList.remove('open'); box.innerHTML = ''; return; }
  box.innerHTML = _v20RenderValidationReport(_v20Model);
  box.classList.add('open');
}

function _v20RenderSheet(panel, charName) {
  const m = _v20Model;
  const isVamp = (m.lineage || '') === 'vampires';
  const derived = _v20Derive(m);
  const clanInfo = isVamp ? v20ClanInfo(m.header.clan) : null;

  const genMaxDots = isVamp ? _v20MaxDotsForGen(m.header.generation) : 5;   // Единая таблица максимума точек (атрибуты/способности/дисциплины/факты биографии)
  const rollIcon = (kind, path) => `<button type="button" class="v20-roll-icon-btn" data-roll-seed="${kind}:${path}" title="Бросок">🎲</button>`;
  const attrCol = g => `<div class="v20-col"><div class="v20-col-title">${V20_ATTR_GROUP_LABELS[g]}</div>${V20_ATTRS[g].map(([k, ru]) =>
    `<div class="v20-row-roll-wrap">${_v20DotRow(ru, `attributes.${g}.${k}`, m.attributes[g][k], genMaxDots)}${rollIcon('attr', `attributes.${g}.${k}`)}</div>`).join('')}</div>`;
  const abilCol = g => {
    const baseline = _v20AbilityBaselineLen(g);
    const rows = m.abilities[g].map((slot, i) => {
      const rowHtml = slot.fixed
        ? _v20DotRow(slot.name, `abilities.${g}.${i}.val`, slot.val, genMaxDots)
        : _v20NamedDotRow(`abilities.${g}.${i}.name`, slot.name, `abilities.${g}.${i}.val`, slot.val, genMaxDots, i >= baseline ? `abilities:${g}` : '');
      return `<div class="v20-row-roll-wrap">${rowHtml}${slot.name ? rollIcon('abil', `abilities.${g}.${i}`) : ''}</div>`;
    }).join('');
    return `<div class="v20-col"><div class="v20-col-title">${V20_ABILITY_GROUP_LABELS[g]}${_v20AddRowBtn(`abilities:${g}`)}</div>${rows}</div>`;
  };

  const header = `
    <div class="v20-header">
      ${_v20Field('Имя', 'header.name', m.header.name)}
      ${_v20Field('Натура', 'header.nature', m.header.nature)}
      ${isVamp ? _v20Field('Клан', 'header.clan', m.header.clan) : _v20Field('Концепция', 'header.concept', m.header.concept)}
      ${_v20Field('Игрок', 'header.player', m.header.player)}
      ${_v20Field('Маска', 'header.demeanor', m.header.demeanor)}
      ${isVamp ? _v20Field('Поколение', 'header.generation', m.header.generation) : _v20Field('—', 'header._x1', '')}
      ${_v20Field('Хроника', 'header.chronicle', m.header.chronicle)}
      ${_v20Field('Амплуа', 'header.concept', m.header.concept)}
      ${isVamp ? _v20Field('Сир', 'header.sire', m.header.sire) : _v20Field('—', 'header._x2', '')}
    </div>`;

  const attributes = `
    <div class="v20-band">Характеристики</div>
    <div class="v20-grid3">${attrCol('physical')}${attrCol('social')}${attrCol('mental')}</div>`;

  const abilities = `
    <div class="v20-band">Способности</div>
    <div class="v20-grid3">${abilCol('talents')}${abilCol('skills')}${abilCol('knowledges')}</div>`;

  const discFillBtn = clanInfo && m.disciplines.slice(0, 3).every(d => !d.name)
    ? `<button type="button" class="v20-mini-action" data-v20-action="fill-clan-disc">+ клановые</button>` : '';
  const discLibBtn = `<button type="button" class="v20-mini-action" data-v20-action="open-disc-library" title="Открыть справочник дисциплин">📚</button>`;
  const discRow = (d, i) => {
    const known = !!v20DisciplineKey(d.name);
    const infoBtn = known ? `<button type="button" class="v20-disc-info-btn" data-disc-view="${escAttr(d.name)}" title="Силы по уровням: ${escAttr(d.name)}">ℹ</button>` : '';
    const rm = i >= _V20_BASELINE_LEN.disciplines ? `<button type="button" class="v20-row-remove-btn" data-v20-remove="disciplines" data-v20-remove-idx="${i}" title="Удалить строку">×</button>` : '';
    return `<div class="v20-row v20-named v20-disc-row">${rm}${infoBtn}<input class="v20-line-input" data-tpath="disciplines.${i}.name" value="${escAttr(d.name)}" placeholder="…">${_v20DotsHtml(`disciplines.${i}.val`, d.val, genMaxDots)}</div>`;
  };
  const discCol = `<div class="v20-col"><div class="v20-col-title">Дисциплины${discFillBtn}${discLibBtn}${_v20AddRowBtn('disciplines')}</div>${m.disciplines.map(discRow).join('')}</div>`;
  const bgCol = `<div class="v20-col"><div class="v20-col-title">Факты биографии${_v20AddRowBtn('backgrounds')}</div>${m.backgrounds.map((b, i) => _v20NamedDotRow(`backgrounds.${i}.name`, b.name, `backgrounds.${i}.val`, b.val, genMaxDots, i >= _V20_BASELINE_LEN.backgrounds ? 'backgrounds' : '')).join('')}</div>`;
  const virtCol = `<div class="v20-col"><div class="v20-col-title">Добродетели</div>
      ${_v20DotRow('Совесть/Решимость', 'virtues.conscience', m.virtues.conscience)}
      ${_v20DotRow('Самоконтроль/Инстинкты', 'virtues.selfcontrol', m.virtues.selfcontrol)}
      ${_v20DotRow('Смелость', 'virtues.courage', m.virtues.courage)}</div>`;
  const advantages = `
    <div class="v20-band">Преимущества</div>
    <div class="v20-grid3">${isVamp ? discCol : ''}${bgCol}${virtCol}</div>`;

  // Психические способности — мортал-зеркало дисциплин (см. discCol выше): «Нумина / Грани»
  // листа смертного (Шаг 8, character_sheet_mortal.md) для экстрасенсов/практиков худо-магии;
  // у обычного смертного секция рендерится с пустыми/нулевыми строками, как и Дисциплины:0
  // у вампира без выбранного клана. Только для мортал-линейки — вампиры/ченджлинги её не видят.
  const isMortal = (m.lineage || '') === 'mortals';
  const psyLibBtn = `<button type="button" class="v20-mini-action" data-v20-action="open-psy-library" title="Открыть справочник психических способностей">📚</button>`;
  const psyRow = (p, i) => {
    const known = !!v20PsychicKey(p.name);
    const infoBtn = known ? `<button type="button" class="v20-disc-info-btn" data-psy-view="${escAttr(p.name)}" title="Силы по уровням: ${escAttr(p.name)}">ℹ</button>` : '';
    const rm = i >= _V20_BASELINE_LEN.psychicPowers ? `<button type="button" class="v20-row-remove-btn" data-v20-remove="psychicPowers" data-v20-remove-idx="${i}" title="Удалить строку">×</button>` : '';
    return `<div class="v20-row v20-named v20-disc-row">${rm}${infoBtn}<input class="v20-line-input" data-tpath="psychicPowers.${i}.name" value="${escAttr(p.name)}" placeholder="…">${_v20DotsHtml(`psychicPowers.${i}.val`, p.val, 5)}</div>`;
  };
  const psychics = isMortal ? `
    <div class="v20-band">Психические способности</div>
    <div class="v20-grid3">
      <div class="v20-col"><div class="v20-col-title">Нумина / Грани${psyLibBtn}${_v20AddRowBtn('psychicPowers')}</div>${m.psychicPowers.map(psyRow).join('')}</div>
      <div class="v20-col"></div>
      <div class="v20-col"></div>
    </div>` : '';

  const healthRows = V20_HEALTH.map(([k, ru, pen]) =>
    `<label class="v20-health-row"><input type="checkbox" class="v20-box" data-bpath="health.${k}"${m.health[k] ? ' checked' : ''}><span class="v20-health-name">${escHtml(ru)}</span><span class="v20-health-pen">${escHtml(pen)}</span></label>`).join('');

  const bottom = `
    <div class="v20-band">Преимущества и состояние</div>
    <div class="v20-grid3 v20-bottom">
      <div class="v20-col">
        <div class="v20-col-title">Достоинства и недостатки</div>
        <textarea class="v20-textarea" data-tpath="meritsFlaws" rows="6" placeholder="По строке на пункт…">${escHtml(m.meritsFlaws)}</textarea>
        <div class="v20-col-title" style="margin-top:12px">Изъян${clanInfo && clanInfo.weakness ? `<button type="button" class="v20-mini-action" data-v20-action="insert-clan-weakness">+ слабость клана</button>` : ''}</div>
        <input class="v20-field-input" data-tpath="flaw" value="${escAttr(m.flaw)}">
      </div>
      <div class="v20-col">
        <div class="v20-stat-block">
          <div class="v20-stat-title">Человечность / Путь ${_v20AutoBadge(m.humanity, derived.humanity, 'humanity', 'dot')}</div>
          ${_v20DotsHtml('humanity', m.humanity, 10)}
          <input class="v20-line-input v20-path" data-tpath="path" value="${escAttr(m.path)}" placeholder="Столп (Путь)">
        </div>
        <div class="v20-stat-block">
          <div class="v20-stat-title">Воля ${_v20AutoBadge(m.willpower.permanent, derived.willpower, 'willpower.permanent', 'dot')}<button type="button" class="v20-mini-action" data-v20-action="spend-willpower" title="Потратить 1 пункт временной Воли">−1</button></div>
          ${_v20DotsHtml('willpower.permanent', m.willpower.permanent, 10)}
          ${_v20BoxesHtml('willpower.temp', m.willpower.temp)}
        </div>
        ${isVamp ? `<div class="v20-stat-block">
          <div class="v20-stat-title">Запас крови${derived.gen ? `<span class="v20-gen-info" title="Поколение ${escAttr(m.header.generation)}: max ${derived.gen.bloodMax ?? '— (счётчик)'}, предел/ход ${derived.gen.bloodPerTurn ?? '—'}, max точек (атрибуты/способности/дисциплины/факты биографии) ${derived.gen.maxDots}">ⓘ</span>` : ''}<button type="button" class="v20-mini-action" data-v20-action="spend-blood" title="Потратить 1 пункт крови">−1</button></div>
          ${derived.gen && derived.gen.bloodMax == null
            ? `<input type="number" min="0" class="v20-mini-input v20-blood-counter" data-tpath="bloodPoolCount" value="${escAttr(m.bloodPoolCount)}" title="3-е поколение — запас крови без фиксированного потолка">`
            : _v20BoxesHtml('bloodPool', m.bloodPool)}
          <label class="v20-inline-field">Предел траты в ход ${derived.gen && derived.gen.bloodPerTurn != null ? _v20AutoBadge(m.bloodPerTurn, derived.gen.bloodPerTurn, 'bloodPerTurn', 'text') : ''}<input class="v20-mini-input" data-tpath="bloodPerTurn" value="${escAttr(m.bloodPerTurn)}"></label>
        </div>` : ''}
      </div>
      <div class="v20-col">
        <div class="v20-col-title">Здоровье</div>
        <div class="v20-health">${healthRows}</div>
        <div class="v20-stat-block" style="margin-top:12px">
          <div class="v20-stat-title">Опыт</div>
          <label class="v20-inline-field">Всего <input class="v20-mini-input" data-tpath="experience.total" data-exp value="${escAttr(m.experience.total)}"></label>
          <label class="v20-inline-field">Потрачено <input class="v20-mini-input" data-tpath="experience.spent" data-exp value="${escAttr(m.experience.spent)}"></label>
          <label class="v20-inline-field">Остаток <span class="v20-exp-remain" id="v20-exp-remain">${_num(m.experience.total, 0) - _num(m.experience.spent, 0)}</span></label>
        </div>
        ${m.experience.log?.length ? `<div class="v20-xp-log">
          <div class="v20-xp-log-title">История трат</div>
          ${m.experience.log.slice(0, 8).map(le => `<div class="v20-xp-log-row"><span>${escHtml(le.date)} · ${escHtml(le.text)}</span><span>−${le.cost}</span></div>`).join('')}
        </div>` : ''}
      </div>
    </div>`;

  const specRows = m.specializations.map((s, i) =>
    `<div class="v20-pair-row"><input class="v20-line-input" data-tpath="specializations.${i}.ability" value="${escAttr(s.ability)}" placeholder="способность"><input class="v20-line-input" data-tpath="specializations.${i}.spec" value="${escAttr(s.spec)}" placeholder="специализация"></div>`).join('');
  const otRows = m.otherTraits.map((t, i) => _v20NamedDotRow(`otherTraits.${i}.name`, t.name, `otherTraits.${i}.val`, t.val, genMaxDots, i >= _V20_BASELINE_LEN.otherTraits ? 'otherTraits' : '')).join('');
  const ritRows = m.rituals.map((r, i) => {
    const rm = i >= _V20_BASELINE_LEN.rituals ? `<button type="button" class="v20-row-remove-btn" data-v20-remove="rituals" data-v20-remove-idx="${i}" title="Удалить строку">×</button>` : '';
    return `<div class="v20-pair-row">${rm}<input class="v20-line-input" data-tpath="rituals.${i}.name" value="${escAttr(r.name)}" placeholder="ритуал"><input class="v20-line-input v20-ritual-lvl" data-tpath="rituals.${i}.level" value="${escAttr(r.level)}" placeholder="ур."></div>`;
  }).join('');
  const V20_DESC = [['birthDate', 'Дата рождения'], ['apparentAge', 'Видимый возраст'], ['deathDate', 'Дата смерти'], ['gender', 'Пол'], ['race', 'Раса'], ['hair', 'Волосы'], ['eyes', 'Глаза'], ['heightWeight', 'Рост/Вес'], ['build', 'Телосложение'], ['nationality', 'Национальность']];
  // Видимый возраст = Год обращения − Год рождения (карточка, web/lib/parsers.js: c.birthYear/
  // c.embraceYear) — «замер на моменте Объятия» (character_sheet_v20.md, «Ограничения»). Если
  // поле листа пустое/0 (т.е. ИИ/пользователь его не задавал), предзаполняем расчётом, но
  // оставляем редактируемым — Рассказчик может переопределить по нестандартным лоровым причинам.
  // Деградация: при отсутствии/нечисловых годах (напр. «⚠️ Не указан») — обычный текстовый ввод.
  const apparentAgeComputed = _v20ComputeApparentAge(_v20Ctx?.card);
  if (apparentAgeComputed != null && !String(m.description.apparentAge || '').trim()) m.description.apparentAge = String(apparentAgeComputed);
  const descFields = V20_DESC.map(([k, l]) => {
    if (k !== 'apparentAge' || apparentAgeComputed == null) return _v20Field(l, `description.${k}`, m.description[k]);
    const isComputed = String(m.description[k] || '').trim() === String(apparentAgeComputed);
    const badge = _v20AutoBadge(m.description[k], apparentAgeComputed, 'description.apparentAge', 'text');
    return `<label class="v20-field"><span class="v20-field-lbl">${escHtml(l)}${badge}</span><input class="v20-field-input" data-tpath="description.${k}" value="${escAttr(m.description[k] || '')}" title="${isComputed ? 'Рассчитано: Год обращения − Год рождения' : ''}"></label>`;
  }).join('');
  const V20_COMBAT_COLS = ['weapon', 'diff', 'damage', 'range', 'rate', 'clip', 'size'];
  const combatHead = `<div class="v20-combat-row v20-combat-head"><span>Оружие/атака</span><span>Сложн.</span><span>Урон</span><span>Дальн.</span><span>Скор.</span><span>Магазин</span><span>Размер</span></div>`;
  const combatRows = m.combat.map((c, i) =>
    `<div class="v20-combat-row">${V20_COMBAT_COLS.map(k => `<input class="v20-line-input" data-tpath="combat.${i}.${k}" value="${escAttr(c[k])}">`).join('')}</div>`).join('');

  const page2 = `
    <div class="v20-band">Специализации · параметры${isVamp ? ' · ритуалы' : ''}</div>
    <div class="v20-grid3">
      <div class="v20-col"><div class="v20-col-title">Специализации</div>${specRows}</div>
      <div class="v20-col"><div class="v20-col-title">Другие параметры${_v20AddRowBtn('otherTraits')}</div>${otRows}</div>
      ${isVamp ? `<div class="v20-col"><div class="v20-col-title">Ритуалы${_v20AddRowBtn('rituals')}</div>${ritRows}</div>` : '<div class="v20-col"></div>'}
    </div>
    <div class="v20-band">История и описание</div>
    <div class="v20-grid3">
      <div class="v20-col">
        <div class="v20-col-title">История</div>
        <textarea class="v20-textarea" data-tpath="history" rows="5" placeholder="История персонажа…">${escHtml(m.history)}</textarea>
        <div class="v20-col-title" style="margin-top:12px">Цели</div>
        <textarea class="v20-textarea" data-tpath="goals" rows="3" placeholder="Цели…">${escHtml(m.goals)}</textarea>
      </div>
      <div class="v20-col">
        <div class="v20-col-title">Описание</div>
        <div class="v20-desc-fields">${descFields}</div>
      </div>
      <div class="v20-col">
        <div class="v20-col-title">Союзники и контакты</div>
        <textarea class="v20-textarea" data-tpath="allies" rows="4" placeholder="По строке на пункт…">${escHtml(m.allies)}</textarea>
        <div class="v20-col-title" style="margin-top:12px">Имущество и снаряжение</div>
        <textarea class="v20-textarea" data-tpath="possessions" rows="4" placeholder="По строке на пункт…">${escHtml(m.possessions)}</textarea>
      </div>
    </div>
    <div class="v20-band">Боевые столкновения</div>
    <div class="v20-combat">${combatHead}${combatRows}</div>`;

  panel.innerHTML = `
    <div class="cdet-sheet-toolbar">
      <button class="cdet-sheet-btn primary" id="v20-save" disabled>💾 Сохранено</button>
      <button class="cdet-sheet-btn" id="v20-regen">♻ Перегенерировать ИИ</button>
      <button class="cdet-sheet-btn" id="v20-validate">📋 Проверить лист</button>
      <button class="cdet-sheet-btn${_v20XpMode ? ' active' : ''}" id="v20-xpmode" title="В этом режиме поднятие точки списывает опыт по таблице обучения">🎓 Режим опыта${_v20XpMode ? ': вкл' : ''}</button>
      <button class="cdet-sheet-btn" id="v20-roll-btn" title="Открыть конструктор броска d10">🎲 Бросок</button>
      <span class="v20-status" id="v20-status"></span>
    </div>
    <div class="v20-val-report" id="v20-validate-report"></div>
    <div class="v20-sheet">${header}${attributes}${abilities}${advantages}${psychics}${bottom}${page2}</div>
    <div class="v20-foot">Создание: Характеристики 7/5/3 · Способности 13/9/5 · Дисциплины 3 · Факты биографии 5 · Добродетели 7 · Свободные пункты 15</div>`;

  document.getElementById('v20-save').addEventListener('click', _v20Save);
  document.getElementById('v20-roll-btn').addEventListener('click', () => _v20OpenRollModal());
  document.getElementById('v20-regen').addEventListener('click', e => _v20Regen(e.currentTarget));
  document.getElementById('v20-validate').addEventListener('click', _v20ToggleValidation);
  document.getElementById('v20-xpmode').addEventListener('click', () => { _v20XpMode = !_v20XpMode; _v20RenderSheet(panel, charName); });
  _v20BindPanel(panel);
}

function _v20RebuildDots(span, val) {
  const max = +span.dataset.max || 5;
  span.querySelectorAll('.v20-dot').forEach(dot => {
    const d = +dot.dataset.d;
    dot.classList.toggle('on', d <= val);
    dot.setAttribute('aria-checked', d === val);
  });
  const num = span.querySelector('.v20-dot-num');
  if (num) num.textContent = val;
}

function _v20BindPanel(panel) {
  if (panel._v20Bound) return;
  panel._v20Bound = true;
  const onDot = async dot => {
    const span = dot.closest('.v20-dots'); if (!span) return;
    const dpath = span.dataset.dpath, d = +dot.dataset.d;
    const cur = _v20Get(_v20Model, dpath) || 0;
    const cap = _v20DotCapFor(dpath, _v20Model);
    const nv = Math.min(cap, (cur === d) ? d - 1 : d);     // click filled max → step down; else set to d (clamped to generation/trait cap)
    if (_v20XpMode && nv > cur) {
      const info = _v20XpKindFromPath(dpath, _v20Model);
      if (info) {
        const cost = v20XpCost(info.kind, cur, nv, info.isClanDisc);
        const avail = _num(_v20Model.experience.total, 0) - _num(_v20Model.experience.spent, 0);
        if (cost > avail && !await showConfirm(`«${info.label}»: ${cur}→${nv} стоит ${cost} XP, доступно ${avail}. Всё равно повысить?`, { confirmText: 'Повысить' })) return;
        _v20Model.experience.spent = _num(_v20Model.experience.spent, 0) + cost;
        _v20Model.experience.log.unshift({ date: new Date().toISOString().slice(0, 10), text: `${info.label}: ${cur}→${nv}`, cost });
        _v20Set(_v20Model, dpath, nv);
        _v20MarkDirty();
        _v20RenderSheet(panel, _v20Ctx.name);
        return;
      }
    }
    _v20Set(_v20Model, dpath, nv);
    _v20RebuildDots(span, nv);
    _v20MarkDirty();
  };
  panel.addEventListener('click', e => {
    const dot = e.target.closest('.v20-dot'); if (dot) { onDot(dot); return; }
    const badge = e.target.closest('.v20-auto-badge'); if (badge) { _v20ApplyAutoBadge(badge); return; }
    const action = e.target.closest('[data-v20-action]'); if (action) { _v20RunAction(action.dataset.v20Action); return; }
    const discView = e.target.closest('[data-disc-view]'); if (discView) { _v20OpenDisciplineModal(discView.dataset.discView); return; }
    const psyView = e.target.closest('[data-psy-view]'); if (psyView) { _v20OpenPsychicModal(psyView.dataset.psyView); return; }
    const rollBtn = e.target.closest('.v20-roll-icon-btn'); if (rollBtn) {
      const [kind, path] = rollBtn.dataset.rollSeed.split(':');
      _v20OpenRollModal(kind === 'attr' ? { attr: path } : { abil: path });
      return;
    }
    const addBtn = e.target.closest('[data-v20-add]'); if (addBtn) {
      const [section, group] = addBtn.dataset.v20Add.split(':');
      _v20AddRow(section, group || null);
      return;
    }
    const rmBtn = e.target.closest('[data-v20-remove]'); if (rmBtn) {
      const [section, group] = rmBtn.dataset.v20Remove.split(':');
      _v20RemoveRow(section, group || null, +rmBtn.dataset.v20RemoveIdx);
      return;
    }
  });
  panel.addEventListener('keydown', e => {
    const dot = e.target.closest('.v20-dot');
    if (dot && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onDot(dot); }
  });
  panel.addEventListener('change', e => {
    const box = e.target.closest('.v20-box');
    if (box) {
      const bp = box.dataset.bpath;
      if (box.dataset.i !== undefined) { const arr = _v20Get(_v20Model, bp) || []; arr[+box.dataset.i] = box.checked; _v20Set(_v20Model, bp, arr); }
      else _v20Set(_v20Model, bp, box.checked);
      _v20MarkDirty();
      return;
    }
    const t = e.target.closest('[data-tpath="header.clan"], [data-tpath="header.generation"]');
    if (t) {
      if (t.dataset.tpath === 'header.generation') _v20ClampToGen(_v20Model);   // generation dropped → re-cap traits already above the new ceiling
      _v20RenderSheet(panel, _v20Ctx.name);  // refresh clan/gen-derived badges & actions
    }
  });
  panel.addEventListener('input', e => {
    const t = e.target.closest('[data-tpath]'); if (!t) return;
    _v20Set(_v20Model, t.dataset.tpath, t.value);
    if (t.dataset.exp !== undefined) {
      const el = document.getElementById('v20-exp-remain');
      if (el) el.textContent = _num(_v20Model.experience.total, 0) - _num(_v20Model.experience.spent, 0);
    }
    _v20MarkDirty();
  });
}

function _v20MarkDirty() {
  _v20DirtyFlag = true;
  const btn = document.getElementById('v20-save');
  const st = document.getElementById('v20-status');
  if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
  if (st) { st.textContent = '● Не сохранено'; st.className = 'v20-status dirty'; }
}

async function _v20Save() {
  const btn = document.getElementById('v20-save'), st = document.getElementById('v20-status');
  btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Сохранение…';
  // Coerce numeric text fields before persisting
  _v20Model.experience.total = _num(_v20Model.experience.total, 0);
  _v20Model.experience.spent = _num(_v20Model.experience.spent, 0);
  _v20Model.bloodPerTurn = _num(_v20Model.bloodPerTurn, 0);
  _v20Model.bloodPoolCount = _num(_v20Model.bloodPoolCount, 0);
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(_v20Ctx.name))}/sheet-data${location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: _v20Model }) }
    ).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'не удалось');
    _v20DirtyFlag = false;
    btn.textContent = '💾 Сохранено'; btn.disabled = true;
    if (st) { st.textContent = '✓ Сохранено'; st.className = 'v20-status ok'; }
  } catch (e) {
    btn.disabled = false; btn.textContent = old;
    if (st) { st.textContent = '✗ ' + e.message; st.className = 'v20-status err'; }
  }
}

async function _v20Regen(btn) {
  if (_v20DirtyFlag && !await showConfirm('Есть несохранённые правки. Перегенерировать числа из ИИ-листа и потерять их?', { danger: true, confirmText: 'Перегенерировать' })) return;
  else if (!_v20DirtyFlag && !await showConfirm('Перегенерировать числа из ИИ-листа? Текущие значения формы будут заменены.', { confirmText: 'Перегенерировать' })) return;
  const old = btn.textContent; btn.disabled = true; btn.textContent = '⏳ ИИ…';
  try {
    const ok = await _generateSheet({ scope: 'character', name: _v20Ctx.name }, null);
    if (!ok) throw new Error('генерация не удалась');
    const q = location.search ? location.search + '&fromMd=1' : '?fromMd=1';
    const d = await fetch(`/api/characters/${encodeURIComponent(_charSlug(_v20Ctx.name))}/sheet-data${q}`).then(r => r.json());
    _v20Model = _v20ModelFrom(d);
    _v20DirtyFlag = false;
    _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = old;
  }
}

let _v20Model = null, _v20Ctx = null, _v20DirtyFlag = false;
async function _loadCharSheet(charName) {
  const panel = document.getElementById('cdet-sheet-panel');
  if (!panel) return;
  panel.dataset.loaded = '1';
  panel.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка листа…</div>';
  // Card-level birthYear/embraceYear (already parsed by parseCharacter, см. web/lib/parsers.js)
  // — used to auto-fill description.apparentAge = embraceYear − birthYear (Шаг: апп. возраст).
  const card = (STATE.characters || []).find(ch => ch.name === charName) || null;
  _v20Ctx = { name: charName, card }; _v20DirtyFlag = false; _v20XpMode = false;
  let d;
  try {
    // Prefetch in parallel (cached after first call) so the ℹ-lookup buttons in psyRow/discRow
    // already know which rows match the library on the very first render, not only after the
    // user opens the 📚 reference modal once.
    [d] = await Promise.all([
      fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/sheet-data${location.search}`).then(r => r.json()),
      ensurePsychics(),
    ]);
  }
  catch (e) { panel.innerHTML = `<div class="cdet-empty">Ошибка загрузки: ${escHtml(e.message)}</div>`; return; }
  _v20Model = _v20ModelFrom(d);
  _v20RenderSheet(panel, charName);
}

// ═══════════════════ V20 sheet: generate · view · edit (dot-radio) ═══════════════════

function _sheetApi(ctx) {
  const qs = location.search;
  if (ctx.scope === 'module') {
    const base = `/api/chronicles/${encodeURIComponent(ctx.chr)}/modules/${encodeURIComponent(ctx.mod)}/npc/${encodeURIComponent(ctx.slug)}/sheet`;
    return { get: base + qs, gen: base + '/generate' + qs, put: base + qs };
  }
  const base = `/api/characters/${encodeURIComponent(_charSlug(ctx.name))}/sheet`;
  return { get: base + qs, gen: base + '/generate' + qs, put: base + qs };
}

const _SHEET_EDIT_SECTIONS = /атрибут|способност|преимуществ|дисциплин|предыстор|добродетел|нумина|(?<!производные )характеристик/i;
function _sheetDots(v) { v = Math.max(0, Math.min(5, v | 0)); return '●'.repeat(v) + '○'.repeat(5 - v); }

// Find which cells of a table row carry a 0–5 rating (dots / number / combined).
function _parseRatingCells(cells) {
  let dotsIdx = -1, numIdx = -1, combinedIdx = -1, value = null, m;
  for (let j = 1; j < cells.length; j++) {
    const c = cells[j];
    if (/^[●○]+$/.test(c)) { dotsIdx = j; value = (c.match(/●/g) || []).length; }
    else if ((m = c.match(/^([●○]+)\s*(\d+)$/))) { combinedIdx = j; value = parseInt(m[2], 10); }
    else if (/^\d+$/.test(c)) { const n = parseInt(c, 10); if (n >= 0 && n <= 5) { numIdx = j; value = n; } }
  }
  if (value == null || value < 0 || value > 5) return null;
  return { value, dotsIdx, numIdx, combinedIdx };
}

// Parse a sheet markdown into editable rated rows (preserving line indices for rebuild).
function _parseSheetForEdit(md) {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const groups = [], editable = [];
  let curSection = '', curSub = '', curGroup = null, m;
  const flush = () => {
    if (curGroup && curGroup.rows.length) {
      curGroup.firstLineIdx = curGroup.rows[0].lineIdx;
      curGroup.lastLineIdx = curGroup.rows[curGroup.rows.length - 1].lineIdx;
      groups.push(curGroup);
    }
    curGroup = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if ((m = ln.match(/^##\s+(.+)$/)))  { flush(); curSection = m[1].replace(/[#*]/g, '').trim(); curSub = ''; continue; }
    if ((m = ln.match(/^###\s+(.+)$/))) { flush(); curSub     = m[1].replace(/[#*]/g, '').trim(); continue; }
    if (!(_SHEET_EDIT_SECTIONS.test(curSection) || _SHEET_EDIT_SECTIONS.test(curSub))) continue;
    if (!/^\s*\|/.test(ln) || /\|\s*:?-{3,}/.test(ln)) continue;     // not a data row / separator
    const cells = ln.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const name = cells[0].replace(/\*\*/g, '').trim();
    // Skip table header rows (\b is unreliable for Cyrillic, so match stems anchored at start)
    if (!name || /^(название|поле|характеристик|атрибут|способност|дисциплин|предыстор|добродетел|уровень|значение)/i.test(name)) continue;
    const rating = _parseRatingCells(cells);
    if (!rating) continue;
    if (!curGroup) curGroup = { section: curSection, subsection: curSub, rows: [] };
    const row = { name, value: rating.value, lineIdx: i, cells, rating };
    curGroup.rows.push(row); editable.push(row);
  }
  flush();
  return { lines, groups, editable };
}

function _rebuildSheetRow(cells, rating, v) {
  const out = cells.slice();
  if (rating.combinedIdx >= 0) out[rating.combinedIdx] = _sheetDots(v) + ' ' + v;
  if (rating.dotsIdx >= 0)     out[rating.dotsIdx]     = _sheetDots(v);
  if (rating.numIdx >= 0)      out[rating.numIdx]      = String(v);
  return '| ' + out.join(' | ') + ' |';
}
// New row added from a library picker — same 3-column shape (name / dots / value)
// as every existing Дисциплины/Нумина table row, so _rebuildSheetRow renders it
// identically to a parsed one. lineIdx stays null: it doesn't exist in the
// original file yet, _buildEditedSheet below splices it in by group range.
function _makeNewSheetRow(name) {
  return { name, value: 1, lineIdx: null, cells: [name, '', ''], rating: { value: 1, dotsIdx: 1, numIdx: 2, combinedIdx: -1 } };
}
function _buildEditedSheet(parsed) {
  const lines = parsed.lines.slice();
  // Rebuild each group's row range from its current (possibly add/removed-from)
  // rows list. Processing bottom-of-file-first keeps not-yet-processed groups'
  // firstLineIdx/lastLineIdx (captured at parse time, before any edits) valid —
  // a splice only ever shifts line numbers *below* itself.
  const ordered = parsed.groups.slice().sort((a, b) => b.firstLineIdx - a.firstLineIdx);
  for (const g of ordered) {
    const rowLines = g.rows.map(r => _rebuildSheetRow(r.cells, r.rating, r.value));
    lines.splice(g.firstLineIdx, g.lastLineIdx - g.firstLineIdx + 1, ...rowLines);
  }
  return lines.join('\n');
}

// Which library (if any) backs this group's "+ Добавить" picker.
function _sheetLibraryKind(g) {
  const t = `${g.section} ${g.subsection}`;
  if (/дисциплин/i.test(t)) return 'discipline';
  if (/нумина/i.test(t)) return 'numina';
  return null;
}
function _libraryEntryDesc(kind, entry) {
  return kind === 'discipline' ? (entry.note || entry.clans || '') : (entry.category || '');
}
// Loads (once per modal open) only the library kinds actually present among
// the sheet's editable groups — a mortal sheet never fetches disciplines,
// a vampire sheet never fetches psychics.
async function _prefetchSheetLibraries(state) {
  const kinds = new Set();
  for (const g of state.parsed.groups) { const k = _sheetLibraryKind(g); if (k) kinds.add(k); }
  await Promise.all([...kinds].map(async k => {
    const url = k === 'discipline' ? '/api/library/disciplines' : '/api/library/psychics';
    try { state.library[k] = await fetch(url).then(r => r.json()); }
    catch { state.library[k] = []; }
  }));
}
function _renderLibList(state, groupIdx, filter) {
  const g = state.parsed.groups[groupIdx];
  const kind = _sheetLibraryKind(g);
  const list = state.library[kind] || [];
  const q = (filter || '').trim().toLowerCase();
  const filtered = q ? list.filter(e => e.name.toLowerCase().includes(q)) : list;
  if (!filtered.length) return '<div class="sheet-lib-empty">Ничего не найдено</div>';
  return filtered.map(e => `<button type="button" class="sheet-lib-item" data-group-idx="${groupIdx}" data-name="${escHtml(e.name)}">
    <span class="sheet-lib-item-name">${escHtml(e.name)}</span>
    <span class="sheet-lib-item-desc">${escHtml(_libraryEntryDesc(kind, e))}</span>
  </button>`).join('');
}

function _dotControl(idx, v) {
  let s = `<span class="sheet-dots" data-row="${idx}">`;
  for (let d = 1; d <= 5; d++) s += `<span class="sheet-dot${d <= v ? ' on' : ''}" data-row="${idx}" data-val="${d}"></span>`;
  return s + `<span class="sheet-dot-val">${v}</span></span>`;
}
function _renderSheetEditor(state) {
  const parsed = state.parsed;
  if (!parsed.editable.length) return '<div class="cdet-empty">В листе не найдено редактируемых характеристик.</div>';
  return parsed.groups.map((g, gi) => {
    const title = [g.section, g.subsection].filter(Boolean).join(' · ');
    const rows = g.rows.map(r => {
      const idx = parsed.editable.indexOf(r);
      return `<div class="sheet-edit-row">
        <span class="sheet-edit-name">${escHtml(r.name)}</span>
        ${_dotControl(idx, r.value)}
        <button type="button" class="sheet-row-remove" data-row="${idx}" title="Удалить строку">✕</button>
      </div>`;
    }).join('');
    const kind = _sheetLibraryKind(g);
    const addUi = (kind && state.library[kind]) ? `
      <button type="button" class="sheet-add-btn" data-group-idx="${gi}">+ Добавить из справочника</button>
      <div class="sheet-lib-picker" data-group-idx="${gi}" hidden>
        <input type="text" class="sheet-lib-search" data-group-idx="${gi}" placeholder="Поиск…">
        <div class="sheet-lib-list" data-group-idx="${gi}"></div>
      </div>` : '';
    return `<div class="sheet-edit-group"><div class="sheet-edit-gtitle">${escHtml(title)}</div>${rows}${addUi}</div>`;
  }).join('');
}
function _rerenderSheetEditor() {
  const body = document.getElementById('sheet-modal-body');
  if (body && _sheetEditState) body.innerHTML = `<div class="sheet-edit">${_renderSheetEditor(_sheetEditState)}</div>`;
}

let _sheetEditState = null;
function _ensureSheetOverlay() {
  let ov = document.getElementById('sheet-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'sheet-overlay'; ov.className = 'sheet-overlay';
  ov.innerHTML = `<div class="sheet-modal">
    <div class="sheet-modal-head">
      <span class="sheet-modal-title" id="sheet-modal-title">Лист персонажа</span>
      <div class="sheet-modal-actions" id="sheet-modal-actions"></div>
      <button class="sheet-modal-close" id="sheet-modal-close" title="Закрыть">✕</button>
    </div>
    <div class="sheet-modal-body" id="sheet-modal-body"></div>
    <div class="sheet-modal-status" id="sheet-modal-status"></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) _closeSheetOverlay(); });
  ov.querySelector('#sheet-modal-close').addEventListener('click', _closeSheetOverlay);
  ov.querySelector('#sheet-modal-body').addEventListener('click', e => {
    const dot = e.target.closest('.sheet-dot');
    if (dot) { _onSheetDotClick(dot); return; }
    const addBtn = e.target.closest('.sheet-add-btn');
    if (addBtn) { _onSheetAddBtnClick(addBtn); return; }
    const item = e.target.closest('.sheet-lib-item');
    if (item) { _onSheetLibItemClick(item); return; }
    const rm = e.target.closest('.sheet-row-remove');
    if (rm) { _onSheetRowRemoveClick(rm); return; }
  });
  ov.querySelector('#sheet-modal-body').addEventListener('input', e => {
    const search = e.target.closest('.sheet-lib-search');
    if (search) _onSheetLibSearchInput(search);
  });
  return ov;
}
function _closeSheetOverlay() { const ov = document.getElementById('sheet-overlay'); if (ov) ov.classList.remove('open'); _sheetEditState = null; }
function _onSheetDotClick(dotEl) {
  if (!_sheetEditState) return;
  const idx = +dotEl.dataset.row, dv = +dotEl.dataset.val;
  const r = _sheetEditState.parsed.editable[idx]; if (!r) return;
  r.value = (r.value === dv) ? dv - 1 : dv;                 // click active dot → step down (allows 0)
  const cont = dotEl.closest('.sheet-dots');
  cont.querySelectorAll('.sheet-dot').forEach(el => el.classList.toggle('on', +el.dataset.val <= r.value));
  cont.querySelector('.sheet-dot-val').textContent = r.value;
}
function _onSheetAddBtnClick(btn) {
  const picker = btn.parentElement.querySelector('.sheet-lib-picker');
  if (!picker) return;
  const opening = picker.hidden;
  picker.hidden = !opening;
  if (opening) {
    const gi = +btn.dataset.groupIdx;
    picker.querySelector('.sheet-lib-list').innerHTML = _renderLibList(_sheetEditState, gi, '');
    const search = picker.querySelector('.sheet-lib-search');
    search.value = '';
    search.focus();
  }
}
function _onSheetLibSearchInput(input) {
  const gi = +input.dataset.groupIdx;
  const list = input.closest('.sheet-lib-picker').querySelector('.sheet-lib-list');
  list.innerHTML = _renderLibList(_sheetEditState, gi, input.value);
}
function _onSheetLibItemClick(item) {
  const gi = +item.dataset.groupIdx;
  const g = _sheetEditState.parsed.groups[gi];
  const row = _makeNewSheetRow(item.dataset.name);
  g.rows.push(row);
  _sheetEditState.parsed.editable.push(row);
  _rerenderSheetEditor();
}
function _onSheetRowRemoveClick(btn) {
  const idx = +btn.dataset.row;
  const row = _sheetEditState.parsed.editable[idx];
  if (!row) return;
  for (const g of _sheetEditState.parsed.groups) {
    const ri = g.rows.indexOf(row);
    if (ri >= 0) { g.rows.splice(ri, 1); break; }
  }
  _sheetEditState.parsed.editable.splice(idx, 1);
  _rerenderSheetEditor();
}

async function openSheetOverlay(ctx, mode) {
  _ensureSheetOverlay();
  const ov = document.getElementById('sheet-overlay'); ov.classList.add('open');
  const title = ov.querySelector('#sheet-modal-title');
  const actions = ov.querySelector('#sheet-modal-actions');
  const body = ov.querySelector('#sheet-modal-body');
  const status = ov.querySelector('#sheet-modal-status');
  status.textContent = ''; status.className = 'sheet-modal-status'; actions.innerHTML = '';
  title.textContent = `${ctx.name || ctx.label || 'Персонаж'} — Лист V20`;
  body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка…</div>';

  let d;
  try { d = await fetch(_sheetApi(ctx).get).then(r => r.json()); }
  catch (e) { body.innerHTML = `<div class="cdet-empty">Ошибка: ${escHtml(e.message)}</div>`; return; }
  if (!d.exists || !d.content) { body.innerHTML = '<div class="cdet-empty">Лист ещё не сгенерирован.</div>'; return; }

  if (mode === 'edit') {
    _sheetEditState = { ctx, parsed: _parseSheetForEdit(d.content), library: {} };
    await _prefetchSheetLibraries(_sheetEditState);
    body.innerHTML = `<div class="sheet-edit">${_renderSheetEditor(_sheetEditState)}</div>`;
    actions.innerHTML = `<button class="sheet-btn sheet-btn-save" id="sheet-save">💾 Сохранить</button>`;
    ov.querySelector('#sheet-save').addEventListener('click', _saveSheetEdit);
  } else {
    _sheetEditState = null;
    body.innerHTML = `<div class="sheet-view md-body">${mdToHtml(_stripSheetHeader(d.content))}</div>`;
    actions.innerHTML = `<button class="sheet-btn" id="sheet-to-edit">✏ Редактировать</button>`;
    ov.querySelector('#sheet-to-edit').addEventListener('click', () => openSheetOverlay(ctx, 'edit'));
  }
}

async function _saveSheetEdit() {
  if (!_sheetEditState) return;
  const status = document.getElementById('sheet-modal-status');
  const btn = document.getElementById('sheet-save');
  btn.disabled = true; btn.textContent = '⏳ Сохранение…'; status.textContent = ''; status.className = 'sheet-modal-status';
  try {
    const md = _buildEditedSheet(_sheetEditState.parsed);
    const d = await fetch(_sheetApi(_sheetEditState.ctx).put,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: md }) }
    ).then(r => r.json());
    if (!d.ok) throw new Error(d.error || 'не удалось');
    status.textContent = '✓ Сохранено'; status.classList.add('ok');
    _sheetEditState.ctx.onSaved?.();
  } catch (e) { status.textContent = '✗ ' + e.message; status.classList.add('err'); }
  finally { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
}

// Generate (or regenerate) a sheet for any context (character / module NPC).
async function _generateSheet(ctx, btn) {
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация…'; }
  try {
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref  = _getPref(prefs, 'sheet', 'claude');
    const d = await fetch(_sheetApi(ctx).gen,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: pref.provider, model: pref.model }) }
    ).then(r => r.json());
    if (!d.ok) throw new Error(d.error || 'не удалось');
    ctx.onSaved?.();
    return true;
  } catch (e) { showToast('Ошибка генерации листа: ' + e.message, 'error'); return false; }
  finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

async function _diaryGenerate(charName) {
  const period = document.getElementById('diary-period').value.trim();
  if (!period) { _diaryMsg('Укажи период (ГГГГ-ММ)', false); return; }
  const btn = document.getElementById('diary-gen'); const old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Генерация…'; _diaryMsg('');
  try {
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref         = _getPref(featPrefs, 'prose', 'openrouter');
    const preferSource = pref.provider;
    const orModel      = preferSource === 'openrouter' ? (pref.model || null) : null;
    const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/diary/generate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session: document.getElementById('diary-session').value.trim(), hint: document.getElementById('diary-hint').value.trim(), preferSource, orModel }) }).then(r => r.json());
    if (r.error) { _diaryMsg(r.error, false); return; }
    document.getElementById('diary-text').value = r.text || '';
    _diaryMsg(`Сгенерировано (${r.source}). Проверь и сохрани.`);
  } catch (e) { _diaryMsg('Ошибка: ' + e.message, false); }
  finally { btn.disabled = false; btn.textContent = old; }
}

async function _diarySave(charName) {
  const period = document.getElementById('diary-period').value.trim();
  const text   = document.getElementById('diary-text').value.trim();
  if (!period) { _diaryMsg('Укажи период (ГГГГ-ММ)', false); return; }
  if (!text)   { _diaryMsg('Пустой текст записи', false); return; }
  const btn = document.getElementById('diary-save'); const old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳…';
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/diary`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session: document.getElementById('diary-session').value.trim(), text }) }).then(r => r.json());
    if (r.error) { _diaryMsg(r.error, false); return; }
    _diaryMsg('✓ Сохранено');
    STATE.characters = []; await ensureCharsLoaded();
    const c = STATE.characters.find(ch => ch.name === charName);
    const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
    if (panel && c) panel.innerHTML = renderDiaryList(c);
  } catch (e) { _diaryMsg('Ошибка: ' + e.message, false); }
  finally { btn.disabled = false; btn.textContent = old; }
}

function formatDiaryText(text) {
  if (!text) return '';
  return text.split(/\n\n+/)
    .filter(Boolean)
    .map(para => `<p>${escHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Holds the currently-viewed diary entry's data so the edit/regenerate/save
// handlers (triggered by delegated clicks, with no room to carry full text via
// dataset) have something to read from and write back into.
let _diaryEntryState = null;

function _diaryEntryToolbar(charName, file, data) {
  const title = data.session || data.title || '';
  const period = file.replace(/^journal\//, '').replace(/\.md$/, '');
  const canEdit = data.format !== 'retrospective';
  return `
    <div class="diary-entry-toolbar">
      <button class="diary-back" data-char="${escHtml(charName)}">← Все дневники</button>
      <div class="diary-entry-toolbar-actions">
        ${canEdit ? `<button class="cdet-edit-btn diary-entry-edit-btn" data-char="${escHtml(charName)}" data-file="${escHtml(file)}" data-period="${escHtml(period)}">✏ Редактировать</button>` : ''}
        <button class="diary-entry-del-btn" data-char="${escHtml(charName)}" data-file="${escHtml(file)}" data-title="${escHtml(title)}" title="Удалить запись">🗑 Удалить</button>
      </div>
    </div>`;
}

async function loadDiaryEntry(charName, file) {
  const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
  if (!panel) return;
  panel.innerHTML = '<div class="diary-loading"><div class="spinner"></div>Загрузка...</div>';
  try {
    const data = await fetch(
      `/api/characters/${encodeURIComponent(_charSlug(charName))}/diary?file=${encodeURIComponent(file)}`
    ).then(r => r.json());
    if (data.error) throw new Error(data.error);
    const panels = panel.closest('.cdet-panels');
    if (panels) panels.scrollTop = 0;

    _diaryEntryState = { charName, file, data };

    if (data.format === 'retrospective') {
      panel.innerHTML = `
        ${_diaryEntryToolbar(charName, file, data)}
        ${data.title ? `<div class="diary-retro-title">${escHtml(data.title)}</div>` : ''}
        ${(data.sections || []).map(s => `
          <div class="diary-retro-section">
            <div class="diary-retro-date">📅 ${escHtml(s.title)}</div>
            <div class="diary-retro-body">${formatDiaryText(s.body)}</div>
          </div>
          <div class="diary-divider"></div>
        `).join('')}`;
    } else {
      panel.innerHTML = `
        ${_diaryEntryToolbar(charName, file, data)}
        ${data.session   ? `<div class="diary-session">📅 ${escHtml(data.session)}</div>`   : ''}
        ${data.location  ? `<div class="diary-meta">📍 ${escHtml(data.location)}</div>`      : ''}
        ${data.tone      ? `<div class="diary-meta">🎭 ${escHtml(data.tone)}</div>`          : ''}
        ${data.text      ? `<div class="diary-divider"></div><div class="diary-text">${escHtml(data.text)}</div>` : ''}
        ${data.crossRefs?.length ? `
          <div class="diary-divider"></div>
          <div class="cdet-section-title">🔗 Зеркальная ссылка</div>
          <div class="diary-crossrefs">${data.crossRefs.map(r =>
            `<div class="diary-crossref">${escHtml(r)}</div>`).join('')}
          </div>` : ''}`;
    }
  } catch (err) {
    const panels = panel.closest('.cdet-panels');
    if (panels) panels.scrollTop = 0;
    panel.innerHTML = `
      <button class="diary-back" data-char="${escHtml(charName)}">← Все дневники</button>
      <div class="cdet-empty">Ошибка загрузки: ${escHtml(err.message)}</div>`;
  }
}

function _enterDiaryEntryEdit() {
  const st = _diaryEntryState;
  if (!st) return;
  const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
  if (!panel) return;
  const { charName, file, data } = st;
  const period = file.replace(/^journal\//, '').replace(/\.md$/, '');

  panel.innerHTML = `
    <div class="diary-entry-toolbar">
      <button class="diary-back" data-char="${escHtml(charName)}">← Все дневники</button>
    </div>
    <div class="cdet-section-title">Заголовок записи</div>
    <input class="form-control" id="diary-entry-session-ta" value="${escAttr(data.session || '')}" placeholder="Ноябрь 2010, ночь на манеже">
    <div class="cdet-section-title" style="margin-top:12px">Текст записи</div>
    <textarea class="cdet-edit-textarea" id="diary-entry-text-ta" rows="14">${escHtml(data.text || '')}</textarea>
    <div class="cdet-edit-bar show" id="diary-entry-edit-bar">
      <button class="cdet-gen-prompt-btn diary-entry-regen-btn" data-char="${escHtml(charName)}" data-period="${escHtml(period)}">🔄 Перегенерировать</button>
      <button class="cdet-save-btn diary-entry-save-btn" data-char="${escHtml(charName)}" data-period="${escHtml(period)}" data-file="${escHtml(file)}">Сохранить</button>
      <button class="cdet-cancel-btn diary-entry-cancel-btn" data-char="${escHtml(charName)}" data-file="${escHtml(file)}">Отмена</button>
      <span class="cdet-save-msg" id="diary-entry-save-msg">✓ Сохранено</span>
    </div>`;
}

async function _regenerateDiaryEntry(charName, period) {
  const btn = document.querySelector('.diary-entry-regen-btn');
  const textTa = document.getElementById('diary-entry-text-ta');
  const sessionTa = document.getElementById('diary-entry-session-ta');
  if (!textTa) return;

  const draft = textTa.value.trim();
  if (draft && !await showConfirm('Текущий текст будет передан модели как черновик и переписан. Продолжить?', { confirmText: 'Продолжить' })) return;

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация...'; }
  try {
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref         = _getPref(featPrefs, 'prose', 'openrouter');
    const preferSource = pref.provider;
    const orModel      = preferSource === 'openrouter' ? (pref.model || null) : null;
    const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/diary/generate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session: sessionTa?.value.trim() || '', draft, preferSource, orModel }) }).then(r => r.json());
    if (r.error) { showToast('Ошибка генерации: ' + r.error, 'error'); return; }
    textTa.value = r.text || '';
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Перегенерировать'; }
  }
}

async function _saveDiaryEntryEdit(charName, period, file) {
  const textTa = document.getElementById('diary-entry-text-ta');
  const sessionTa = document.getElementById('diary-entry-session-ta');
  const text = textTa?.value.trim() || '';
  if (!text) { showToast('Пустой текст записи', 'warning'); return; }

  const btn = document.querySelector('.diary-entry-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/diary`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session: sessionTa?.value.trim() || '', text, mode: 'replace' }) }).then(r => r.json());
    if (r.error) { showToast('Ошибка сохранения: ' + r.error, 'error'); return; }
    STATE.characters = []; await ensureCharsLoaded();
    await loadDiaryEntry(charName, file);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
  }
}

async function _deleteDiaryEntry(charName, file, title) {
  if (!await showConfirm(`Удалить запись дневника «${title || file}»?\nДействие необратимо.`, { danger: true, confirmText: 'Удалить' })) return;
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/diary?file=${encodeURIComponent(file)}`,
      { method: 'DELETE' }).then(r => r.json());
    if (!r.ok) { showToast('Ошибка удаления: ' + (r.error || ''), 'error'); return; }
    STATE.characters = []; await ensureCharsLoaded();
    const c = STATE.characters.find(ch => ch.name === charName);
    const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
    if (panel && c) panel.innerHTML = renderDiaryList(c);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

// Soft-delete a character: preview affected refs, confirm, then DELETE.
async function _confirmDeleteChar(name) {
  let pv;
  try { pv = await fetch(`/api/characters/${encodeURIComponent(_charSlug(name))}/delete-preview${location.search}`).then(r => r.json()); }
  catch (e) { showToast('Не удалось получить предпросмотр: ' + e.message, 'error'); return; }
  if (pv.error) { showToast(pv.error, 'error'); return; }

  const list = arr => arr.length
    ? `<ul>${arr.slice(0, 12).map(f => `<li>${escHtml(f)}</li>`).join('')}${arr.length > 12 ? `<li>…ещё ${arr.length - 12}</li>` : ''}</ul>`
    : ' <i>—</i>';
  const artNote = pv.art ? ` (арт: ${pv.art} — сохранится в архиве)` : '';

  const ov = document.createElement('div');
  ov.className = 'chr-modal-backdrop open';
  ov.innerHTML = `
    <div class="chr-modal">
      <div class="chr-modal-title">🗑 Удалить персонажа</div>
      <div class="chr-modal-body">
        <div class="chr-modal-warn">Папка <b>${escHtml(name)}</b> переедет в
          <code>characters/_deleted/</code> — обратимо${escHtml(artNote)}. Из списков,
          графа и реестра персонаж исчезнет.</div>
        <div class="chr-modal-section"><b>Будут сняты битые ссылки</b> (${pv.structural.length}) —
          имя-текст в этих файлах останется:${list(pv.structural)}</div>
        <div class="chr-modal-section"><b>Проза дневников и событий не трогается</b> (${pv.prose.length}) —
          история сохраняется:${list(pv.prose)}</div>
      </div>
      <div class="chr-modal-actions">
        <button class="chr-modal-btn cancel" data-act="cancel">Отмена</button>
        <button class="chr-modal-btn danger"  data-act="ok">Удалить</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('[data-act="cancel"]').addEventListener('click', close);
  ov.querySelector('[data-act="ok"]').addEventListener('click', async () => {
    const btn = ov.querySelector('[data-act="ok"]');
    btn.disabled = true; btn.textContent = '⏳ Удаление…';
    try {
      const d = await fetch(`/api/characters/${encodeURIComponent(_charSlug(name))}${location.search}`, { method: 'DELETE' })
        .then(r => r.json());
      if (!d.ok) throw new Error(d.error || 'Ошибка');
      close();
      charDetailModal.classList.remove('open');
      STATE.graph.inited = false;
      fetch('/api/characters').then(r => r.json()).then(data => {
        STATE.characters = Array.isArray(data) ? data : [];
        if (STATE.page === 'characters') renderChars();
        if (STATE.page === 'dashboard')  loadDashboard();
      }).catch(() => { STATE.characters = []; });
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Удалить';
      showToast('Ошибка удаления: ' + e.message, 'error');
    }
  });
}

function openCharDetail(name) {
  const c = STATE.characters.find(ch => ch.name === name);
  if (!c) return;

  const icon   = LINEAGE_ICONS[c.lineage] || '👤';
  const stType = c.statusType || 'unknown';
  const stLbl  = statusLabel(c);

  const clanTint = c.lineage === 'vampire' ? CLAN_COLORS[c.clan] : null;
  const detailModalEl = document.getElementById('char-detail-modal');
  if (clanTint) detailModalEl.style.setProperty('--clan-tint', clanTint);
  else detailModalEl.style.removeProperty('--clan-tint');

  const _reqFields = requiredInfoFor(c.lineage);
  const infoFields = infoFieldsFor(c.lineage)
    .map(([k, lbl]) => {
      const raw = c[k];
      const empty = !raw || raw === '—' || String(raw).includes('⚠️');
      const required = _reqFields.has(k);
      const opt = (empty && !required) ? ' cdet-opt-empty' : '';   // hidden in view mode
      const tip = fieldTip(CHAR_FIELD_TIPS[lbl]);
      const keyHtml = (empty && required)
        ? `${lbl} <span class="cdet-req-flag" title="Обязательное поле">!</span>${tip}` : `${lbl}${tip}`;
      const display = empty ? 'Неизвестно' : escHtml(raw);
      const cls = empty ? 'cdet-val unknown' : 'cdet-val';
      return `<div class="cdet-key${opt}">${keyHtml}</div><div class="${cls}${opt}" data-field="${k}">${display}</div>`;
    })
    .join('');

  const relsHtml = (c.relationships || []).map(r => `
    <div class="cdet-rel">
      <div class="cdet-rel-name">${escHtml(r.target)}</div>
      <div class="cdet-rel-desc">${escHtml(r.description)}</div>
    </div>`).join('');

  const portraitCol = c.imageUrl
    ? `<div class="cdet-carousel" id="cdet-carousel">
        <img class="cdet-carousel-img" id="cdet-carousel-img" src="${c.imageUrl}" alt="${escHtml(c.name)}">
        <div class="cdet-carousel-overlay" id="cdet-carousel-overlay"></div>
        <button class="cdet-carousel-btn prev" id="cdet-carousel-prev" title="Предыдущее">&#8249;</button>
        <button class="cdet-carousel-btn next" id="cdet-carousel-next" title="Следующее">&#8250;</button>
        <div class="cdet-carousel-dots" id="cdet-carousel-dots"></div>
       </div>`
    : `<div class="cdet-no-portrait">${icon}</div>`;

  const descHtml = [
    c.appearance && !c.appearance.includes('⚠️') ? `
      <div class="cdet-section-title">Внешность</div>
      <div class="cdet-bio">${escHtml(c.appearance)}</div>
      <div class="cdet-divider"></div>` : '',
    c.voice && !c.voice.includes('⚠️') ? `
      <div class="cdet-section-title">Голос</div>
      <div class="cdet-voice">${escHtml(c.voice)}</div>
      <div class="cdet-divider"></div>` : '',
    c.personality && !c.personality.includes('⚠️') ? `
      <div class="cdet-section-title">Характер</div>
      <div class="cdet-bio">${escHtml(c.personality)}</div>
      <div class="cdet-divider"></div>` : '',
    _promptSectionHtml(c.imagePrompt, c.negativePrompt),
  ].filter(Boolean).join('');

  const stampParts = c.lineage === 'vampire'
    ? [c.clan, c.generation ? `${c.generation} поколение` : ''].filter(Boolean)
    : [LINEAGE_LABELS[c.lineage] || c.lineage];
  const stampText = stampParts.filter(p => p && p !== '—' && !String(p).includes('⚠️')).join(' · ');

  document.getElementById('char-detail-content').innerHTML = `
    <div class="cdet-portrait-col" id="cdet-portrait-col">${portraitCol}</div>
    <div class="cdet-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-header-grain" aria-hidden="true"></div>
        ${stampText ? `<div class="cdet-stamp">${escHtml(stampText)}</div>` : ''}
        <div class="cdet-name">${escHtml(c.name)}</div>
        <div class="cdet-badges">
          <span class="badge badge-${c.lineage}">${LINEAGE_LABELS[c.lineage] || c.lineage}</span>
          ${stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : ''}
        </div>
        ${c.statusDetails ? `<div class="cdet-status-details">${escHtml(c.statusDetails)}</div>` : ''}
        <button class="cdet-delete-btn" id="cdet-delete-btn" data-char="${escHtml(c.name)}" title="Удалить персонажа">🗑</button>
      </div>
      <div class="cdet-tab-bar">
        <button class="cdet-tab active" data-tab="info">Информация</button>
        <button class="cdet-tab" data-tab="bio">Биография</button>
        <button class="cdet-tab" data-tab="rels">Отношения</button>
        <button class="cdet-tab" data-tab="diaries">Дневники${c.diaries?.length ? ` (${c.diaries.length})` : ''}</button>
        <button class="cdet-tab" data-tab="sheet" data-char="${escHtml(c.name)}">Лист V20</button>
        <button class="cdet-tab" data-tab="desc">Описание</button>
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="info">
          ${c.presence ? `<div class="cdet-presence">🌍 <b>Присутствие:</b> ${escHtml(c.presence)}</div>` : ''}
          ${c.aliases ? `<div class="cdet-presence cdet-aliases">🎭 <b>Алиасы:</b> ${escHtml(c.aliases)}</div>` : ''}
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" id="cdet-edit-btn" data-char="${escHtml(c.name)}">✏ Редактировать</button>
          </div>
          <div class="cdet-fields" id="cdet-info-fields">${infoFields}</div>
          <div class="cdet-edit-bar" id="cdet-edit-bar">
            <button class="cdet-save-btn" id="cdet-save-btn">Сохранить</button>
            <button class="cdet-cancel-btn" id="cdet-cancel-btn">Отмена</button>
            <span class="cdet-save-msg" id="cdet-save-msg">✓ Сохранено</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="bio">
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" data-editpanel="bio" data-char="${escHtml(c.name)}">✏ Редактировать</button>
          </div>
          <div id="cdet-bio-view">
            ${c.biography && !c.biography.includes('⚠️')
              ? `<div class="cdet-bio">${escHtml(c.biography)}</div>`
              : '<div class="cdet-empty">Биография не заполнена</div>'}
          </div>
          <div id="cdet-bio-edit" style="display:none">
            <div class="cdet-info-header" style="margin-bottom:8px">
              <button class="cdet-gen-prompt-btn" id="cdet-gen-biography" data-char="${escHtml(c.name)}" title="Сгенерировать биографию по вкладкам «Информация» и «Отношения»">📖 Сгенерировать биографию</button>
            </div>
            <textarea class="cdet-edit-textarea" id="cdet-bio-ta" rows="10" placeholder="Биография персонажа...">${c.biography && !c.biography.includes('⚠️') ? escHtml(c.biography) : ''}</textarea>
          </div>
          <div class="cdet-edit-bar" id="cdet-bio-bar">
            <button class="cdet-save-btn" data-savepanel="bio" data-char="${escHtml(c.name)}">Сохранить</button>
            <button class="cdet-cancel-btn" data-cancelpanel="bio">Отмена</button>
            <span class="cdet-save-msg" id="cdet-bio-msg">✓ Сохранено</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="rels">
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" data-editpanel="rels" data-char="${escHtml(c.name)}">✏ Редактировать</button>
          </div>
          <div id="cdet-rels-view">
            ${relsHtml ? `<div class="cdet-rels-list">${relsHtml}</div>` : '<div class="cdet-empty">Нет известных связей</div>'}
          </div>
          <div id="cdet-rels-edit" style="display:none">
            <div class="cdet-rels-hint">Имя — выбери из списка или впиши своё. Вид отношений — из списка или свой.</div>
            <div id="cdet-rels-rows">${(c.relationships||[]).map(r => _relRowHtml(r.target, r.description)).join('')}</div>
            <button class="cdet-rel-add-btn" id="cdet-rel-add-btn" type="button">+ Добавить связь</button>
            <datalist id="cdet-rel-names">${(STATE.characters||[]).filter(x => x.name !== c.name).map(x => `<option value="${escAttr(x.name)}">`).join('')}</datalist>
            <datalist id="cdet-rel-types">${REL_TYPE_OPTIONS.map(t => `<option value="${escAttr(t)}">`).join('')}</datalist>
          </div>
          <div class="cdet-edit-bar" id="cdet-rels-bar">
            <button class="cdet-save-btn" data-savepanel="rels" data-char="${escHtml(c.name)}">Сохранить</button>
            <button class="cdet-cancel-btn" data-cancelpanel="rels">Отмена</button>
            <span class="cdet-save-msg" id="cdet-rels-msg">✓ Сохранено</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="diaries">
          ${renderDiaryList(c)}
        </div>
        <div class="cdet-panel" data-panel="sheet" id="cdet-sheet-panel">
          <div class="loading-state"><div class="spinner"></div>Загрузка листа…</div>
        </div>
        <div class="cdet-panel" data-panel="desc">
          <div class="cdet-info-header" style="gap:8px">
            <button class="cdet-gen-appearance-btn" id="cdet-gen-appearance" data-char="${escHtml(c.name)}" title="Сгенерировать описание внешности по артам персонажа (Claude Vision)">👁 Внешность по арту</button>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-personality" data-char="${escHtml(c.name)}" title="Сгенерировать характер и голос по внешности и биографии">🎭 Характер и голос</button>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-prompt" data-char="${escHtml(c.name)}" title="Сгенерировать промт на основе внешности персонажа">🎨 Промт</button>
            <button class="cdet-edit-btn" data-editpanel="desc" data-char="${escHtml(c.name)}">✏ Редактировать</button>
          </div>
          <div id="cdet-desc-view">
            ${descHtml || '<div class="cdet-empty">Описание не заполнено</div>'}
          </div>
          <div id="cdet-desc-edit" style="display:none">
            <div id="cdet-img-gallery"></div>
            <div class="cdet-section-title">Внешность</div>
            <textarea class="cdet-edit-textarea" id="cdet-appearance-ta" rows="5" placeholder="Внешность персонажа...">${c.appearance && !c.appearance.includes('⚠️') ? escHtml(c.appearance) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">Голос</div>
            <textarea class="cdet-edit-textarea" id="cdet-voice-ta" rows="3" placeholder="Голос, манера речи...">${c.voice && !c.voice.includes('⚠️') ? escHtml(c.voice) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">Характер</div>
            <textarea class="cdet-edit-textarea" id="cdet-personality-ta" rows="4" placeholder="Ключевые черты, мотивации, манера держаться с другими...">${c.personality && !c.personality.includes('⚠️') ? escHtml(c.personality) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">Промт для генерации изображения</div>
            <textarea class="cdet-edit-textarea" id="cdet-prompt-ta" rows="6" placeholder="[Блок 1] ...\n[Блок 2] ...\n[Блок 3] ...">${c.imagePrompt ? escHtml(c.imagePrompt) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">Негативный промт</div>
            <textarea class="cdet-edit-textarea" id="cdet-negprompt-ta" rows="3" placeholder="photorealistic, ...">${c.negativePrompt ? escHtml(c.negativePrompt) : ''}</textarea>
          </div>
          <div class="cdet-edit-bar" id="cdet-desc-bar">
            <button class="cdet-save-btn" data-savepanel="desc" data-char="${escHtml(c.name)}">Сохранить</button>
            <button class="cdet-cancel-btn" data-cancelpanel="desc">Отмена</button>
            <span class="cdet-save-msg" id="cdet-desc-msg">✓ Сохранено</span>
          </div>
          <div class="cdet-upload-row">
            <button class="cdet-upload-btn" data-char="${escHtml(c.name)}">📷 Загрузить изображение</button>
          </div>
          <div class="cdet-divider"></div>
          <div class="cdet-dialogue">
            <div class="cdet-section-title">💬 Реплики НПС в сцене</div>
            <div class="cdet-dialogue-hint">Голос персонажа + клановый стиль (diary_rules.md). Опиши ситуацию — ИИ выдаст реплики в характере.</div>
            <textarea class="cdet-edit-textarea" id="cdet-dlg-situation" rows="2" placeholder="Ситуация: напр. «Князь требует объяснений на Элизиуме»"></textarea>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-dialogue" data-char="${escHtml(c.name)}">💬 Сгенерировать реплики</button>
            <div id="cdet-dlg-result" class="cdet-dialogue-result" style="display:none"></div>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('char-detail-modal').classList.add('open');
  if (c.imageUrl) initCarousel(c.name);
}

document.getElementById('chars-grid').addEventListener('click', e => {
  const card = e.target.closest('.char-card[data-name]');
  if (card) openCharDetail(card.dataset.name);
});

const charDetailModal = document.getElementById('char-detail-modal');
document.getElementById('char-detail-close').addEventListener('click', () => charDetailModal.classList.remove('open'));
charDetailModal.addEventListener('click', e => { if (e.target === charDetailModal) charDetailModal.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') charDetailModal.classList.remove('open'); });

// Tab switching & image upload — delegated on the persistent content container
document.getElementById('char-detail-content').addEventListener('click', e => {
  const tab = e.target.closest('.cdet-tab');
  if (tab) {
    const col = tab.closest('.cdet-info-col');
    col.querySelectorAll('.cdet-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    col.querySelectorAll('.cdet-panel').forEach(p => p.classList.remove('active'));
    col.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    const panels = col.querySelector('.cdet-panels');
    if (panels) panels.scrollTop = 0;
    if (tab.dataset.tab === 'sheet') _loadCharSheet(tab.dataset.char);
    return;
  }
  if (e.target.closest('#cdet-carousel-prev')) { _carouselGoTo(_carouselIdx - 1, true); return; }
  if (e.target.closest('#cdet-carousel-next')) { _carouselGoTo(_carouselIdx + 1, true); return; }
  if (e.target.closest('#cdet-delete-btn'))  { _confirmDeleteChar(e.target.closest('#cdet-delete-btn').dataset.char); return; }
  if (e.target.closest('#cdet-edit-btn'))    { _enterInfoEdit(e.target.closest('#cdet-edit-btn').dataset.char); return; }
  if (e.target.closest('#cdet-cancel-btn'))  { _exitInfoEdit(false); return; }
  if (e.target.closest('#cdet-save-btn'))    { _saveInfoFields(); return; }

  // Panel edit buttons (bio / rels / desc)
  const editPanelBtn = e.target.closest('[data-editpanel]');
  if (editPanelBtn) { _togglePanelEdit(editPanelBtn.dataset.editpanel, true); return; }
  const cancelPanelBtn = e.target.closest('[data-cancelpanel]');
  if (cancelPanelBtn) { _togglePanelEdit(cancelPanelBtn.dataset.cancelpanel, false); return; }
  const savePanelBtn = e.target.closest('[data-savepanel]');
  if (savePanelBtn) { _savePanelEdit(savePanelBtn.dataset.savepanel, savePanelBtn.dataset.char); return; }

  // Relations editor: add / delete a single row
  if (e.target.closest('#cdet-rel-add-btn')) {
    const rows = document.getElementById('cdet-rels-rows');
    if (rows) {
      rows.insertAdjacentHTML('beforeend', _relRowHtml());
      rows.lastElementChild?.querySelector('.cdet-rel-name-inp')?.focus();
    }
    return;
  }
  const relDelBtn = e.target.closest('.cdet-rel-del-btn');
  if (relDelBtn) { relDelBtn.closest('.cdet-rel-row')?.remove(); return; }
  const promptCopyBtn = e.target.closest('#cdet-prompt-copy');
  if (promptCopyBtn) { _copyImagePrompt(promptCopyBtn); return; }
  if (e.target.closest('#cdet-gen-appearance')) { _generateAppearance(e.target.closest('#cdet-gen-appearance').dataset.char); return; }
  if (e.target.closest('#cdet-gen-personality')) { _generatePersonality(e.target.closest('#cdet-gen-personality').dataset.char); return; }
  if (e.target.closest('#cdet-gen-biography')) { _generateBiography(e.target.closest('#cdet-gen-biography').dataset.char); return; }
  if (e.target.closest('#cdet-gen-prompt')) { _generatePrompt(e.target.closest('#cdet-gen-prompt').dataset.char); return; }
  if (e.target.closest('#cdet-gen-dialogue')) { _genDialogue(e.target.closest('#cdet-gen-dialogue').dataset.char); return; }
  if (e.target.closest('.cdet-img-del-btn')) {
    const btn = e.target.closest('.cdet-img-del-btn');
    _deleteCharImage(btn.dataset.char, btn.dataset.file);
    return;
  }

  const uploadBtn = e.target.closest('.cdet-upload-btn');
  if (uploadBtn) { triggerImageUpload(uploadBtn.dataset.char); return; }

  // Diary entry form: toggle / generate / save / cancel
  if (e.target.closest('#diary-add-toggle')) {
    const f = document.getElementById('diary-form');
    if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
    return;
  }
  if (e.target.closest('#diary-cancel')) {
    const f = document.getElementById('diary-form'); if (f) f.style.display = 'none';
    return;
  }
  if (e.target.closest('#diary-gen'))  { _diaryGenerate(e.target.closest('#diary-gen').dataset.char); return; }
  if (e.target.closest('#diary-save')) { _diarySave(e.target.closest('#diary-save').dataset.char); return; }

  const diaryDelBtn = e.target.closest('.diary-item-del-btn');
  if (diaryDelBtn) {
    _deleteDiaryEntry(diaryDelBtn.dataset.char, diaryDelBtn.dataset.file, diaryDelBtn.dataset.title);
    return;
  }

  const diaryItem = e.target.closest('.diary-item');
  if (diaryItem) { loadDiaryEntry(diaryItem.dataset.char, diaryItem.dataset.file); return; }

  const diaryBack = e.target.closest('.diary-back');
  if (diaryBack) {
    const c = STATE.characters.find(ch => ch.name === diaryBack.dataset.char);
    const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
    if (panel && c) {
      panel.innerHTML = renderDiaryList(c);
      const panels = panel.closest('.cdet-panels');
      if (panels) panels.scrollTop = 0;
    }
    return;
  }

  const diaryEntryEditBtn = e.target.closest('.diary-entry-edit-btn');
  if (diaryEntryEditBtn) { _enterDiaryEntryEdit(); return; }

  const diaryEntryDelBtn = e.target.closest('.diary-entry-del-btn');
  if (diaryEntryDelBtn) {
    _deleteDiaryEntry(diaryEntryDelBtn.dataset.char, diaryEntryDelBtn.dataset.file, diaryEntryDelBtn.dataset.title);
    return;
  }

  const diaryRegenBtn = e.target.closest('.diary-entry-regen-btn');
  if (diaryRegenBtn) { _regenerateDiaryEntry(diaryRegenBtn.dataset.char, diaryRegenBtn.dataset.period); return; }

  const diaryEntrySaveBtn = e.target.closest('.diary-entry-save-btn');
  if (diaryEntrySaveBtn) { _saveDiaryEntryEdit(diaryEntrySaveBtn.dataset.char, diaryEntrySaveBtn.dataset.period, diaryEntrySaveBtn.dataset.file); return; }

  const diaryEntryCancelBtn = e.target.closest('.diary-entry-cancel-btn');
  if (diaryEntryCancelBtn) { loadDiaryEntry(diaryEntryCancelBtn.dataset.char, diaryEntryCancelBtn.dataset.file); return; }
});

// ── Carousel logic ────────────────────────────────────────────────────────────
let _carouselTimer  = null;
let _carouselImages = [];
let _carouselIdx    = 0;

async function initCarousel(charName) {
  // Stop previous carousel
  if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
  _carouselImages = [];
  _carouselIdx = 0;

  const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/images${window.location.search}`)
    .catch(() => null);
  if (!resp?.ok) return;
  const { images } = await resp.json().catch(() => ({}));
  if (!images || images.length <= 1) {
    // Hide nav buttons for single image
    document.getElementById('cdet-carousel-prev')?.style.setProperty('display','none');
    document.getElementById('cdet-carousel-next')?.style.setProperty('display','none');
    return;
  }

  _carouselImages = images;
  _carouselIdx    = 0;

  // Build dots
  const dotsEl = document.getElementById('cdet-carousel-dots');
  if (dotsEl) {
    dotsEl.innerHTML = images.map((_, i) =>
      `<div class="cdet-carousel-dot${i === 0 ? ' active' : ''}"></div>`
    ).join('');
  }

  _carouselTimer = setInterval(() => _carouselGoTo(_carouselIdx + 1), 60 * 1000);
}

function _carouselGoTo(targetIdx, resetTimer = false) {
  const img     = document.getElementById('cdet-carousel-img');
  const overlay = document.getElementById('cdet-carousel-overlay');
  const dotsEl  = document.getElementById('cdet-carousel-dots');
  if (!img || !overlay || !_carouselImages.length) {
    clearInterval(_carouselTimer); _carouselTimer = null; return;
  }

  const next = ((targetIdx % _carouselImages.length) + _carouselImages.length) % _carouselImages.length;

  // Phase 1: darken
  overlay.classList.add('dimmed');

  setTimeout(() => {
    // Phase 2: swap image
    _carouselIdx = next;
    img.src = _carouselImages[_carouselIdx];

    // Update dots
    if (dotsEl) {
      dotsEl.querySelectorAll('.cdet-carousel-dot').forEach((d, i) =>
        d.classList.toggle('active', i === _carouselIdx));
    }

    // Phase 3: un-darken
    setTimeout(() => overlay.classList.remove('dimmed'), 300);
  }, 2100);

  // Reset auto-timer on manual nav
  if (resetTimer && _carouselTimer) {
    clearInterval(_carouselTimer);
    _carouselTimer = setInterval(() => _carouselGoTo(_carouselIdx + 1), 60 * 1000);
  }
}

function _carouselAdvance() { _carouselGoTo(_carouselIdx + 1); }

// Stop carousel when modal closes
document.getElementById('char-detail-close')?.addEventListener('click', () => {
  if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
}, { capture: true });

// ── Panel editing (bio / rels / desc) ────────────────────────────────────────

function _togglePanelEdit(panel, on) {
  const view = document.getElementById(`cdet-${panel}-view`);
  const edit = document.getElementById(`cdet-${panel}-edit`);
  const bar  = document.getElementById(`cdet-${panel}-bar`);
  const btn  = document.querySelector(`[data-editpanel="${panel}"]`);
  if (!view || !edit || !bar) return;
  view.style.display = on ? 'none' : '';
  edit.style.display = on ? '' : 'none';
  bar.classList.toggle('show', on);
  if (btn) { btn.classList.toggle('active', on); btn.textContent = on ? '✏ Режим редактирования' : '✏ Редактировать'; }
  if (on) {
    if (panel === 'desc') {
      const charName = document.querySelector('[data-editpanel="desc"][data-char]')?.dataset.char;
      if (charName) _loadDescImages(charName);
    } else if (panel === 'rels') {
      // Rebuild rows from the latest saved relationships (discard prior unsaved edits)
      const charName = document.querySelector('[data-editpanel="rels"][data-char]')?.dataset.char;
      const ch  = STATE.characters.find(c => c.name === charName);
      const rows = document.getElementById('cdet-rels-rows');
      if (ch && rows) rows.innerHTML = (ch.relationships || []).map(r => _relRowHtml(r.target, r.description)).join('');
      rows?.querySelector('.cdet-rel-name-inp')?.focus();
    } else {
      edit.querySelector('textarea')?.focus();
    }
  }
}

async function _savePanelEdit(panel, charName) {
  const bar  = document.getElementById(`cdet-${panel}-bar`);
  const msg  = document.getElementById(`cdet-${panel}-msg`);
  const save = bar?.querySelector('.cdet-save-btn');
  if (!save) return;

  save.disabled = true;
  save.textContent = '⏳ Сохранение...';

  const qs = window.location.search;
  let ok = false;

  try {
    if (panel === 'bio') {
      const bio = document.getElementById('cdet-bio-ta')?.value.trim() || '';
      const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { biography: bio } }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        const ch = STATE.characters.find(c => c.name === charName);
        if (ch) ch.biography = bio;
        document.getElementById('cdet-bio-view').innerHTML =
          bio ? `<div class="cdet-bio">${escHtml(bio)}</div>` : '<div class="cdet-empty">Биография не заполнена</div>';
      }
    } else if (panel === 'rels') {
      const lines = Array.from(document.querySelectorAll('#cdet-rels-rows .cdet-rel-row')).map(row => {
        const target = row.querySelector('.cdet-rel-name-inp')?.value.trim() || '';
        const desc   = row.querySelector('.cdet-rel-type-inp')?.value.trim() || '';
        if (!target) return null;
        return desc ? `${target} — ${desc}` : target;
      }).filter(Boolean);
      const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/relations${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        // Refresh relations view (handles "Имя — описание" and name-only)
        const rels = lines.map(l => {
          const idx = l.indexOf(' — ');
          return idx >= 0
            ? { target: l.slice(0, idx).trim(), description: l.slice(idx + 3).trim() }
            : { target: l.trim(), description: '' };
        });
        const ch = STATE.characters.find(c => c.name === charName);
        if (ch) ch.relationships = rels;
        const relsHtml = rels.map(r => `
          <div class="cdet-rel">
            <div class="cdet-rel-name">${escHtml(r.target)}</div>
            <div class="cdet-rel-desc">${escHtml(r.description)}</div>
          </div>`).join('');
        document.getElementById('cdet-rels-view').innerHTML =
          relsHtml ? `<div class="cdet-rels-list">${relsHtml}</div>` : '<div class="cdet-empty">Нет известных связей</div>';
      }
    } else if (panel === 'desc') {
      const appearance   = document.getElementById('cdet-appearance-ta')?.value.trim() || '';
      const voice        = document.getElementById('cdet-voice-ta')?.value.trim() || '';
      const personality  = document.getElementById('cdet-personality-ta')?.value.trim() || '';
      const imagePrompt  = document.getElementById('cdet-prompt-ta')?.value.trim() || '';
      const negativePrompt = document.getElementById('cdet-negprompt-ta')?.value.trim() || '';
      const fields = {};
      if (appearance)   fields.appearance    = appearance;
      if (voice)        fields.voice         = voice;
      if (personality)  fields.personality   = personality;
      if (imagePrompt)  fields.imagePrompt   = imagePrompt;
      if (negativePrompt) fields.negativePrompt = negativePrompt;
      const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        const ch = STATE.characters.find(c => c.name === charName);
        if (ch) Object.assign(ch, { appearance, voice, personality, imagePrompt, negativePrompt });
        // Refresh desc view
        const descHtml = [
          appearance ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
          voice ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
          personality ? `<div class="cdet-section-title">Характер</div><div class="cdet-bio">${escHtml(personality)}</div><div class="cdet-divider"></div>` : '',
          _promptSectionHtml(imagePrompt, negativePrompt),
        ].filter(Boolean).join('');
        document.getElementById('cdet-desc-view').innerHTML = descHtml || '<div class="cdet-empty">Описание не заполнено</div>';
      }
    }
  } catch(e) { showToast('Ошибка: ' + e.message, 'error'); }

  save.disabled = false;
  save.textContent = 'Сохранить';
  if (ok) {
    _togglePanelEdit(panel, false);
    if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }
  }
}

async function _generateAppearance(charName) {
  if (_genAppearanceRunning) return;
  _genAppearanceRunning = true;
  const btn = document.getElementById('cdet-gen-appearance');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализ арта...'; }

  try {
    const claudeModel  = localStorage.getItem('ai-model') || 'claude-opus-4-8';
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _appPref     = _getPref(featPrefs, 'appearance', 'openrouter');
    const preferSource = _appPref.provider;
    const orModel      = preferSource === 'openrouter' ? (_appPref.model || null) : null;
    const qs           = window.location.search;

    // 1. Генерируем внешность через Vision API
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(_charSlug(charName))}/generate-appearance${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: claudeModel, preferSource, orModel }) }
    );
    const d = await resp.json();
    if (resp.status === 429 || d.rateLimited) {
      showToast('Превышен лимит запросов к API.\n\nПодождите минуту и попробуйте снова, или смените модель в Настройках AI.', 'warning');
      return;
    }
    if (!d.ok) { showToast('Ошибка генерации: ' + (d.error || 'неизвестная ошибка'), 'error'); return; }

    // 2. Автосохраняем в карточку персонажа
    if (btn) btn.textContent = '💾 Сохранение...';
    const saveResp = await fetch(
      `/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { appearance: d.appearance } }) }
    );
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast('Ошибка сохранения: ' + (saveData.error || ''), 'error'); return; }

    // 3. Обновляем STATE
    const ch = STATE.characters.find(c => c.name === charName);
    if (ch) ch.appearance = d.appearance;

    // 4. Обновляем вкладку Описание (view-режим)
    const view = document.getElementById('cdet-desc-view');
    if (view) {
      const cur = ch || {};
      const voice       = cur.voice       || '';
      const personality = cur.personality || '';
      const imagePrompt = cur.imagePrompt || '';
      const negPrompt   = cur.negativePrompt || '';
      view.innerHTML = [
        d.appearance  ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(d.appearance)}</div><div class="cdet-divider"></div>` : '',
        voice         ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        personality   ? `<div class="cdet-section-title">Характер</div><div class="cdet-bio">${escHtml(personality)}</div><div class="cdet-divider"></div>` : '',
        _promptSectionHtml(imagePrompt, negPrompt),
      ].filter(Boolean).join('') || '<div class="cdet-empty">Описание не заполнено</div>';
    }

    // 5. Также обновляем textarea если вкладка открыта в режиме редактирования
    const ta = document.getElementById('cdet-appearance-ta');
    if (ta) ta.value = d.appearance;

    // 6. Мигаем сообщением об успехе
    const msg = document.getElementById('cdet-desc-save-msg');
    if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }

    if (btn) btn.title = `Изображений проанализировано: ${d.imagesUsed} | ${d.source}`;
  } catch(e) {
    showToast('Ошибка соединения: ' + e.message, 'error');
  } finally {
    _genAppearanceRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '👁 Внешность по арту'; }
  }
}

async function _loadDescImages(charName) {
  const gallery = document.getElementById('cdet-img-gallery');
  if (!gallery) return;
  gallery.innerHTML = '<div class="cdet-img-gallery-loading">Загрузка…</div>';

  const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/images${window.location.search}`).catch(() => null);
  if (!resp?.ok) { gallery.innerHTML = ''; return; }
  const { images } = await resp.json().catch(() => ({}));

  if (!images?.length) {
    gallery.innerHTML = '<div class="cdet-empty" style="margin-bottom:12px">Нет загруженных изображений</div>';
    return;
  }

  gallery.innerHTML = `
    <div class="cdet-section-title">Изображения</div>
    <div class="cdet-img-gallery-grid">
      ${images.map(url => {
        const filename = decodeURIComponent(url.split('/').pop());
        return `<div class="cdet-img-thumb-wrap">
          <img class="cdet-img-thumb" src="${url}" alt="${escHtml(filename)}" loading="lazy" decoding="async">
          <span class="cdet-img-thumb-name">${escHtml(filename)}</span>
          <button class="cdet-img-del-btn" data-char="${escHtml(charName)}" data-file="${escHtml(filename)}" title="Удалить">✕</button>
        </div>`;
      }).join('')}
    </div>
    <div class="cdet-divider"></div>`;
}

async function _deleteCharImage(charName, filename) {
  if (!await showConfirm(`Удалить «${filename}»?\nДействие необратимо.`, { danger: true, confirmText: 'Удалить' })) return;

  const qs = window.location.search;
  try {
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(_charSlug(charName))}/images/${encodeURIComponent(filename)}${qs}`,
      { method: 'DELETE' }
    );
    const d = await resp.json();
    if (!d.ok) { showToast('Ошибка удаления: ' + (d.error || ''), 'error'); return; }

    // Remove thumbnail from gallery
    const wrap = document.querySelector(`.cdet-img-del-btn[data-file="${CSS.escape(filename)}"]`)?.closest('.cdet-img-thumb-wrap');
    if (wrap) wrap.remove();

    const grid = document.querySelector('.cdet-img-gallery-grid');
    if (grid && !grid.querySelectorAll('.cdet-img-thumb-wrap').length) {
      document.getElementById('cdet-img-gallery').innerHTML =
        '<div class="cdet-empty" style="margin-bottom:12px">Нет загруженных изображений</div>';
    }

    // Refresh carousel (remove deleted image from list)
    const encodedFile = encodeURIComponent(filename);
    _carouselImages = _carouselImages.filter(u => !u.includes(encodedFile) && !u.includes(filename));
    if (_carouselImages.length) {
      _carouselIdx = Math.min(_carouselIdx, _carouselImages.length - 1);
      _carouselGoTo(_carouselIdx);
      // Rebuild dots
      const dotsEl = document.getElementById('cdet-carousel-dots');
      if (dotsEl) {
        dotsEl.innerHTML = _carouselImages.map((_, i) =>
          `<div class="cdet-carousel-dot${i === _carouselIdx ? ' active' : ''}"></div>`
        ).join('');
      }
    } else {
      if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
      const carouselEl = document.getElementById('cdet-carousel');
      const col = document.getElementById('cdet-portrait-col');
      if (col) col.innerHTML = '<div class="cdet-no-portrait">🩸</div>';
    }

    // Invalidate grid cache
    if (_gridImages[charName]) {
      _gridImages[charName] = _gridImages[charName].filter(u => !u.includes(encodedFile) && !u.includes(filename));
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

let _genPromptRunning = false;

// Generate in-character NPC dialogue lines (Voice + clan style)
async function _genDialogue(charName) {
  const sitEl = document.getElementById('cdet-dlg-situation');
  const box   = document.getElementById('cdet-dlg-result');
  const btn   = document.getElementById('cdet-gen-dialogue');
  const situation = sitEl?.value.trim() || '';
  if (!box) return;
  box.style.display = '';
  if (!situation) { box.innerHTML = '<div class="canon-warn">Опиши ситуацию для реплик.</div>'; return; }
  btn.disabled = true; btn.textContent = '⏳ Генерация…';
  box.innerHTML = '<div class="canon-loading">💬 Подбираю реплики в характере…</div>';
  try {
    const qs    = window.location.search;
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref  = _getPref(prefs, 'dialogue', 'openrouter');
    const d = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/dialogue${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ situation, source: pref.provider, model: pref.model }) }
    ).then(r => r.json());
    if (!d.ok) { box.innerHTML = `<div class="canon-warn">Ошибка: ${escHtml(d.error || 'не удалось')}</div>`; return; }
    const lines = (d.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    box.innerHTML = (lines.length ? _dlgFallbackNote(d.source) : '') + (lines.length
      ? `<div class="cdet-dlg-lines">${lines.map(l => `<div class="cdet-dlg-line">${escHtml(l)}</div>`).join('')}</div>`
      : '<div class="canon-warn">Пустой ответ.</div>');
  } catch (e) {
    box.innerHTML = `<div class="canon-warn">Ошибка: ${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '💬 Сгенерировать реплики';
  }
}

// Single source of truth for the "Промт для генерации" block in #cdet-desc-view,
// so the copy button (#cdet-prompt-copy) can't silently drop out of one of the
// several re-render call sites (initial render, manual save, AI generation) again.
function _promptSectionHtml(imagePrompt, negativePrompt) {
  if (!imagePrompt) return '';
  return `
    <div class="cdet-section-title cdet-prompt-head">
      <span>Промт для генерации</span>
      <button type="button" class="cdet-prompt-copy" id="cdet-prompt-copy"
        title="Скопировать промт${negativePrompt ? ' и негатив' : ''} в буфер обмена" aria-label="Скопировать промт в буфер обмена">⧉</button>
    </div>
    <textarea class="cdet-prompt-box" readonly>${escHtml(imagePrompt)}</textarea>
    ${negativePrompt ? `
      <div class="cdet-section-title" style="margin-top:14px">Негативный промт</div>
      <textarea class="cdet-prompt-box cdet-prompt-neg" readonly>${escHtml(negativePrompt)}</textarea>` : ''}`;
}

// Copy positive + negative image prompt as one clipboard payload (A1111-style,
// so it can be pasted whole and most generators parse the "Negative prompt:" tail).
function _copyImagePrompt(btn) {
  const view = btn.closest('#cdet-desc-view') || document;
  const pos = view.querySelector('.cdet-prompt-box:not(.cdet-prompt-neg)')?.value.trim() || '';
  const neg = view.querySelector('.cdet-prompt-neg')?.value.trim() || '';
  if (!pos && !neg) return;
  const payload = neg ? `${pos}\n\nNegative prompt: ${neg}` : pos;
  const flash = ok => {
    btn.textContent = ok ? '✓' : '✕';
    btn.classList.toggle('copied', ok);
    setTimeout(() => { btn.textContent = '⧉'; btn.classList.remove('copied'); }, 1400);
  };
  navigator.clipboard.writeText(payload).then(() => flash(true)).catch(() => flash(false));
}

async function _generatePrompt(charName) {
  if (_genPromptRunning) return;

  const c = STATE.characters.find(ch => ch.name === charName);
  if (!c) return;

  // Treat placeholder markers (⏳ Заполнить… / ⚠️ Требуется уточнение) as "no prompt yet".
  const existingPrompt = (c.imagePrompt || '').trim();
  const isPlaceholder  = !existingPrompt || /⏳|⚠️/.test(existingPrompt);
  if (!isPlaceholder) {
    if (!await showConfirm('Промт уже существует. Заменить его на сгенерированный?', { confirmText: 'Заменить' })) return;
  }

  _genPromptRunning = true;
  const btn = document.getElementById('cdet-gen-prompt');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация...'; }

  try {
    const qs = window.location.search;
    const featPrefs  = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _promptPref = _getPref(featPrefs, 'prompt', 'openrouter');
    const preferSource = _promptPref.provider;
    const orModel    = preferSource === 'openrouter' ? (_promptPref.model || null) : null;

    const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/generate-prompt${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json();

    if (resp.status === 429 || d.rateLimited) {
      showToast('Превышен лимит запросов к API.\n\nПодождите минуту и попробуйте снова, или смените модель в Настройках AI.', 'warning');
      return;
    }
    if (!d.ok) {
      showToast('Ошибка генерации промта: ' + (d.error || 'неизвестная ошибка'), 'error');
      return;
    }

    const saveResp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { imagePrompt: d.positive, negativePrompt: d.negative } }),
    });
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast('Ошибка сохранения промта: ' + (saveData.error || ''), 'error'); return; }

    Object.assign(c, { imagePrompt: d.positive, negativePrompt: d.negative });

    const descView = document.getElementById('cdet-desc-view');
    if (descView) {
      const appearance  = c.appearance && !c.appearance.includes('⚠️') ? c.appearance : '';
      const voice       = c.voice && !c.voice.includes('⚠️') ? c.voice : '';
      const personality = c.personality && !c.personality.includes('⚠️') ? c.personality : '';
      const html = [
        appearance ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
        voice ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        personality ? `<div class="cdet-section-title">Характер</div><div class="cdet-bio">${escHtml(personality)}</div><div class="cdet-divider"></div>` : '',
        _promptSectionHtml(d.positive, d.negative),
      ].filter(Boolean).join('');
      descView.innerHTML = html;
    }
    const promptTa = document.getElementById('cdet-prompt-ta');
    if (promptTa) promptTa.value = d.positive;
    const negTa = document.getElementById('cdet-negprompt-ta');
    if (negTa) negTa.value = d.negative || '';

  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    _genPromptRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '🎨 Промт'; }
  }
}

let _genPersonalityRunning = false;

async function _generatePersonality(charName) {
  if (_genPersonalityRunning) return;

  const c = STATE.characters.find(ch => ch.name === charName);
  if (!c) return;

  const hasAppearance = c.appearance && !c.appearance.includes('⚠️');
  const hasBio        = c.biography && !c.biography.includes('⚠️');
  if (!hasAppearance && !hasBio) {
    showToast('Заполните «Внешность» или «Биография» перед генерацией характера и голоса.', 'warning');
    return;
  }

  const existingPersonality = (c.personality || '').trim();
  if (existingPersonality && !/⚠️/.test(existingPersonality)) {
    if (!await showConfirm('Характер уже заполнен. Сгенерировать уточнённую версию на основе информации/биографии/внешности (текущий текст будет использован как черновик)?', { confirmText: 'Сгенерировать' })) return;
  }

  _genPersonalityRunning = true;
  const btn = document.getElementById('cdet-gen-personality');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация...'; }

  try {
    const qs = window.location.search;
    const featPrefs     = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _persPref     = _getPref(featPrefs, 'personality', 'openrouter');
    const preferSource  = _persPref.provider;
    const orModel       = preferSource === 'openrouter' ? (_persPref.model || null) : null;

    const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/generate-personality${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json();

    if (resp.status === 429 || d.rateLimited) {
      showToast('Превышен лимит запросов к API.\n\nПодождите минуту и попробуйте снова, или смените модель в Настройках AI.', 'warning');
      return;
    }
    if (!d.ok) {
      showToast('Ошибка генерации характера: ' + (d.error || 'неизвестная ошибка'), 'error');
      return;
    }

    const fields = { personality: d.personality };
    if (d.voice) fields.voice = d.voice;
    const saveResp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast('Ошибка сохранения: ' + (saveData.error || ''), 'error'); return; }

    Object.assign(c, fields);

    const descView = document.getElementById('cdet-desc-view');
    if (descView) {
      const appearance = c.appearance && !c.appearance.includes('⚠️') ? c.appearance : '';
      const voice       = c.voice && !c.voice.includes('⚠️') ? c.voice : '';
      descView.innerHTML = [
        appearance ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
        voice ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        d.personality ? `<div class="cdet-section-title">Характер</div><div class="cdet-bio">${escHtml(d.personality)}</div><div class="cdet-divider"></div>` : '',
        _promptSectionHtml(c.imagePrompt, c.negativePrompt),
      ].filter(Boolean).join('') || '<div class="cdet-empty">Описание не заполнено</div>';
    }

    const persTa = document.getElementById('cdet-personality-ta');
    if (persTa) persTa.value = d.personality || '';
    if (d.voice) {
      const voiceTa = document.getElementById('cdet-voice-ta');
      if (voiceTa) voiceTa.value = d.voice;
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    _genPersonalityRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '🎭 Характер и голос'; }
  }
}

let _genBiographyRunning = false;

async function _generateBiography(charName) {
  if (_genBiographyRunning) return;

  const c = STATE.characters.find(ch => ch.name === charName);
  if (!c) return;

  const existingBio = (c.biography || '').trim();
  if (existingBio && !/⚠️/.test(existingBio)) {
    if (!await showConfirm('Биография уже заполнена. Сгенерировать уточнённую версию на основе информации/отношений (текущий текст будет использован как черновик)?', { confirmText: 'Сгенерировать' })) return;
  }

  _genBiographyRunning = true;
  const btn = document.getElementById('cdet-gen-biography');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация...'; }

  try {
    const qs = window.location.search;
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _bioPref     = _getPref(featPrefs, 'biography', 'openrouter');
    const preferSource = _bioPref.provider;
    const orModel       = preferSource === 'openrouter' ? (_bioPref.model || null) : null;

    const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/generate-biography${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json();

    if (resp.status === 429 || d.rateLimited) {
      showToast('Превышен лимит запросов к API.\n\nПодождите минуту и попробуйте снова, или смените модель в Настройках AI.', 'warning');
      return;
    }
    if (!d.ok) {
      showToast('Ошибка генерации биографии: ' + (d.error || 'неизвестная ошибка'), 'error');
      return;
    }

    const saveResp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { biography: d.biography } }),
    });
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast('Ошибка сохранения биографии: ' + (saveData.error || ''), 'error'); return; }

    c.biography = d.biography;

    document.getElementById('cdet-bio-view').innerHTML =
      d.biography ? `<div class="cdet-bio">${escHtml(d.biography)}</div>` : '<div class="cdet-empty">Биография не заполнена</div>';
    const bioTa = document.getElementById('cdet-bio-ta');
    if (bioTa) bioTa.value = d.biography || '';
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    _genBiographyRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '📖 Сгенерировать биографию'; }
  }
}

// ── Info field editing ────────────────────────────────────────────────────────
let _editCharName   = null;
let _editOrigName   = null;
let _editOrigValues = {};
let _genAppearanceRunning = false;

function _enterInfoEdit(charName) {
  _editCharName = charName;
  _editOrigName = charName;
  _editOrigValues = {};

  const grid = document.getElementById('cdet-info-fields');
  const btn  = document.getElementById('cdet-edit-btn');
  const bar  = document.getElementById('cdet-edit-bar');
  if (!grid || !btn || !bar) return;

  grid.classList.add('editing');   // reveal empty optional fields while editing

  // Make name in sticky header editable
  const nameEl = document.querySelector('#char-detail-content .cdet-name');
  if (nameEl && !document.getElementById('cdet-name-input')) {
    const nameInput = document.createElement('input');
    nameInput.className = 'cdet-name-input';
    nameInput.id = 'cdet-name-input';
    nameInput.value = charName;
    nameInput.placeholder = 'Имя персонажа';
    nameEl.replaceWith(nameInput);
  }

  // Replace each .cdet-val with an input
  grid.querySelectorAll('.cdet-val').forEach(cell => {
    const key = cell.dataset.field;
    const isUnknown = cell.classList.contains('unknown');
    const current = isUnknown ? '' : cell.textContent;
    _editOrigValues[key] = current;

    let input;
    if (key === 'status') {
      input = document.createElement('select');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      const options = ['Жив', 'Жива', 'Торпор', 'Мёртв', 'Мертва', 'Пропал', 'Неизвестно'];
      // Старые/нестандартные значения («Активен», «Уничтожен (декабрь 2010)» и т.п.)
      // не входят в список — не подменяем их молча, а добавляем как есть первым
      // пунктом, чтобы сохранение без изменений не потеряло исходный текст.
      if (current && !options.includes(current)) options.unshift(current);
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (current === opt) o.selected = true;
        input.appendChild(o);
      });
    } else if (key === 'belonging') {
      input = document.createElement('select');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      ['Персонаж мастера', 'Персонаж игрока', 'Эпизодический персонаж'].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (current === opt) o.selected = true;
        input.appendChild(o);
      });
    } else if (key === 'generation') {
      input = document.createElement('select');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      // Legacy cards stored generation as a bare number ("8") or with qualifiers
      // ("12-е (предположительно)") — match by leading digits so a clean numeric
      // value still pre-selects correctly; anything else falls back to blank.
      const curNum = (current.match(/\d+/) || [])[0];
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '— выбрать —';
      input.appendChild(blank);
      VAMPIRE_GENERATIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (curNum && opt.startsWith(curNum + '-')) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = 'Неизвестно';
    }
    cell.replaceWith(input);
  });

  btn.classList.add('active');
  btn.textContent = '✏ Режим редактирования';
  bar.classList.add('show');

  // Focus name input
  document.getElementById('cdet-name-input')?.focus();
}

function _exitInfoEdit(saved) {
  const grid = document.getElementById('cdet-info-fields');
  const btn  = document.getElementById('cdet-edit-btn');
  const bar  = document.getElementById('cdet-edit-bar');
  if (!grid || !btn || !bar) return;

  // Restore name in sticky header
  const nameInput = document.getElementById('cdet-name-input');
  if (nameInput) {
    const displayName = saved ? (nameInput.value.trim() || _editOrigName) : _editOrigName;
    const nameEl = document.createElement('div');
    nameEl.className = 'cdet-name';
    nameEl.textContent = displayName;
    nameInput.replaceWith(nameEl);
  }

  // Restore value cells (+ re-apply view-mode hiding of empty optional fields)
  const _lineage   = _lineageOf(_editCharName || _editOrigName);
  const _reqFields = requiredInfoFor(_lineage);
  const _fieldSet  = infoFieldsFor(_lineage);
  grid.querySelectorAll('.cdet-field-input').forEach(input => {
    const key      = input.dataset.field;
    const value    = saved ? input.value.trim() : (_editOrigValues[key] || '');
    const empty    = !value;
    const required = _reqFields.has(key);
    const hide     = empty && !required;
    const div = document.createElement('div');
    div.className = 'cdet-val' + (empty ? ' unknown' : '') + (hide ? ' cdet-opt-empty' : '');
    div.dataset.field = key;
    div.textContent   = empty ? 'Неизвестно' : value;
    // sync the preceding label cell (hide class + required «!» flag)
    const keyCell = input.previousElementSibling;
    if (keyCell && keyCell.classList.contains('cdet-key')) {
      const lbl = (_fieldSet.find(([fk]) => fk === key) || [null, key])[1];
      keyCell.innerHTML = (empty && required)
        ? `${lbl} <span class="cdet-req-flag" title="Обязательное поле">!</span>` : lbl;
      keyCell.classList.toggle('cdet-opt-empty', hide);
    }
    input.replaceWith(div);
  });
  grid.classList.remove('editing');

  btn.classList.remove('active');
  btn.textContent = '✏ Редактировать';
  bar.classList.remove('show');
  _editCharName = null;
  _editOrigName = null;
}

async function _saveInfoFields() {
  const grid    = document.getElementById('cdet-info-fields');
  const saveBtn = document.getElementById('cdet-save-btn');
  const msg     = document.getElementById('cdet-save-msg');
  if (!grid || !_editCharName) return;

  const prevName = _editCharName;
  const fields = {};

  // Collect name from header input if changed
  const nameInput = document.getElementById('cdet-name-input');
  const newName = nameInput?.value.trim();
  if (newName && newName !== prevName) fields.name = newName;

  grid.querySelectorAll('.cdet-field-input').forEach(inp => {
    const v = inp.value.trim();
    if (v) fields[inp.dataset.field] = v;
  });

  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ Сохранение...';

  try {
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(_charSlug(prevName))}/fields${window.location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }) }
    );
    const d = await resp.json();
    if (d.ok) {
      const finalName = fields.name || prevName;

      // Update STATE cache
      const ch = STATE.characters.find(c => c.name === prevName);
      if (ch) {
        if (fields.name) ch.name = fields.name;
        Object.assign(ch, Object.fromEntries(
          Object.entries(fields).filter(([k]) => k !== 'name').map(([k, v]) => [k, v])
        ));
      }

      // Sync grid card when name changed
      if (fields.name) {
        const gridCard = document.querySelector(`.char-card[data-name="${CSS.escape(prevName)}"]`);
        if (gridCard) {
          gridCard.dataset.name = finalName;
          const gridNameEl = gridCard.querySelector('.char-name');
          if (gridNameEl) gridNameEl.textContent = finalName;
        }
        // Update data-char on modal buttons so subsequent saves work
        document.querySelectorAll('#char-detail-content [data-char]').forEach(el => {
          if (el.dataset.char === prevName) el.dataset.char = finalName;
        });
        _editCharName = finalName;
      }

      _exitInfoEdit(true);
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2500);
    } else {
      showToast('Ошибка: ' + (d.error || 'не удалось сохранить'), 'error');
    }
  } catch(e) {
    showToast('Ошибка соединения: ' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить';
  }
}

async function triggerImageUpload(charName) {
  const input = document.createElement('input');
  input.type  = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const btn = document.querySelector('.cdet-upload-btn');
    if (btn) { btn.textContent = '⏳ Загрузка...'; btn.disabled = true; }
    try {
      const ext    = file.name.split('.').pop().toLowerCase();
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp   = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, ext })
      });
      const result = await resp.json();
      if (result.success) {
        const newUrl = result.url + '?t=' + Date.now();
        // Update portrait in modal immediately
        const col = document.getElementById('cdet-portrait-col');
        if (col) col.innerHTML = `<div class="cdet-carousel" id="cdet-carousel">
          <img class="cdet-carousel-img" id="cdet-carousel-img" src="${newUrl}" alt="${escHtml(charName)}">
          <div class="cdet-carousel-overlay" id="cdet-carousel-overlay"></div>
          <button class="cdet-carousel-btn prev" id="cdet-carousel-prev" title="Предыдущее">&#8249;</button>
          <button class="cdet-carousel-btn next" id="cdet-carousel-next" title="Следующее">&#8250;</button>
          <div class="cdet-carousel-dots" id="cdet-carousel-dots"></div>
         </div>`;
        initCarousel(charName);
        // Patch the character in STATE so the card and modal re-open correctly
        const charInState = STATE.characters.find(ch => ch.name === charName);
        if (charInState) charInState.imageUrl = newUrl;
        // Re-render cards if user is on the characters page
        if (STATE.page === 'characters') renderChars();
        const b = document.querySelector('.cdet-upload-btn');
        if (b) {
          b.textContent = `✓ Сохранено как ${result.filename} — загрузить ещё`;
          b.style.background = 'rgba(0,80,0,.25)';
          b.disabled = false;
        }
      } else {
        throw new Error(result.error || 'Неизвестная ошибка');
      }
    } catch (err) {
      const isOffline = err.message.includes('Failed to fetch') || err.name === 'TypeError';
      const b = document.querySelector('.cdet-upload-btn');
      if (b) { b.textContent = '📷 Загрузить изображение'; b.disabled = false; }
      if (isOffline) {
        showToast('Сервер недоступен. Перезапустите start.bat и попробуйте снова.', 'error');
      } else {
        showToast('Ошибка загрузки: ' + err.message, 'error');
      }
    }
  };
  input.click();
}

// Locations page (list/detail) moved to public/locations.js (E2.3).
// ── Module page: editPanel helpers ────────────────────────────────────────────

// После отмены редактирования одного поля внутри блока проверяет, остались ли
// ещё открытые поля — если нет, прячет кнопку «Сохранить всё» этого блока
// (она включается только при входе в блок целиком, см. data-editblock).
function _modSyncBlockSaveAllVisibility(panel) {
  if (!panel || !panel.startsWith('scensec')) return;
  const viewEl = document.getElementById(`moddet-${panel}-view`);
  const block  = viewEl?.closest('.modp-scenario-block');
  if (!block) return;
  const saveAllBtn = block.querySelector('[data-blocksaveall]');
  if (!saveAllBtn) return;
  const anyEditing = Array.from(block.querySelectorAll('.modp-scenario-field [id$="-edit"]'))
    .some(ed => ed.style.display !== 'none');
  if (!anyEditing) saveAllBtn.style.display = 'none';
}

function _modToggleEdit(panel, enter) {
  const viewEl = document.getElementById(`moddet-${panel}-view`);
  const editEl = document.getElementById(`moddet-${panel}-edit`);
  const barEl  = document.getElementById(`moddet-${panel}-bar`);
  const msgEl  = document.getElementById(`moddet-${panel}-msg`);
  if (!viewEl || !editEl) return;
  viewEl.style.display = enter ? 'none' : '';
  editEl.style.display = enter ? '' : 'none';
  if (barEl) barEl.style.display = enter ? 'flex' : 'none';
  if (msgEl) msgEl.style.display = 'none';
}

async function _modSavePanel(panel) {
  const d   = STATE.currentModuleData;
  const chr = d?.chronicle || STATE.currentModule?.chronicle;
  const mod = d?.name      || STATE.currentModule?.name;
  if (!chr || !mod) return;

  const msgEl  = document.getElementById(`moddet-${panel}-msg`);
  const fields = {};

  if (panel === 'desc') {
    fields.description = document.getElementById('moddet-desc-ta')?.value || '';

  } else if (panel === 'pcs' || panel === 'npcs') {
    const chips = document.querySelectorAll(`#moddet-${panel}-chips .moddet-chip`);
    fields[panel] = Array.from(chips).map(c => c.dataset.name).filter(Boolean);

  } else if (panel === 'scenario') {
    const content = document.getElementById('moddet-scenario-ta')?.value || '';
    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
      );
      if (!r.ok) throw new Error(await r.text());
      if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
      _modToggleEdit(panel, false);
      await _reloadModulePage();
    } catch { if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; } }
    return;

  } else if (panel === 'finale') {
    const content = document.getElementById('moddet-finale-ta')?.value || '';
    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/finale${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
      );
      if (!r.ok) throw new Error(await r.text());
      if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
      _modToggleEdit(panel, false);
      await _reloadModulePage();
    } catch { if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; } }
    return;

  } else if (panel.startsWith('scensec')) {
    const idx     = parseInt(panel.slice('scensec'.length), 10);
    const info    = (STATE.scenarioSectionHeadings || [])[idx];
    const content = document.getElementById(`moddet-${panel}-ta`)?.value || '';
    if (!info) return;
    const { heading, parent } = info;

    // Сохранение ОДНОГО поля блока полностью перерисовывает панель (свежие
    // данные с сервера) — это сбрасывает все поля блока в режим просмотра.
    // Если рядом в том же блоке ещё открыты другие поля с несохранёнными
    // правками (кнопка «Редактировать» на блоке открывает их все разом),
    // черновики нужно снять перед перерисовкой и восстановить после — иначе
    // сохранение одного поля молча стирает правки в соседних.
    const block = document.getElementById(`moddet-${panel}-view`)?.closest('.modp-scenario-block');
    const siblingDrafts = [];
    if (block) {
      const idxs = (block.dataset.fieldIdxs || '').split(',').filter(Boolean);
      for (const siblingIdx of idxs) {
        if (siblingIdx === String(idx)) continue;
        const editEl = document.getElementById(`moddet-scensec${siblingIdx}-edit`);
        if (editEl && editEl.style.display !== 'none') {
          const ta = document.getElementById(`moddet-scensec${siblingIdx}-ta`);
          if (ta) siblingDrafts.push({ idx: siblingIdx, value: ta.value });
        }
      }
    }

    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heading, content, parent }) }
      );
      const result = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(result.error || 'Ошибка сохранения');
      STATE.currentModuleData.scenario = result.scenario;
      _renderScenarioPanel(STATE.currentModuleData);
      for (const draft of siblingDrafts) {
        _modToggleEdit(`scensec${draft.idx}`, true);
        const ta = document.getElementById(`moddet-scensec${draft.idx}-ta`);
        if (ta) ta.value = draft.value;
      }
      if (siblingDrafts.length) {
        // Соседние поля снова в режиме редактирования — блок опять содержит
        // несколько открытых полей, поэтому кнопка «Сохранить всё» должна
        // быть видна, как и при обычном входе в блок целиком (data-editblock).
        const restoredBlock = document.getElementById(`moddet-scensec${siblingDrafts[0].idx}-view`)?.closest('.modp-scenario-block');
        const saveAllBtn = restoredBlock?.querySelector('[data-blocksaveall]');
        if (saveAllBtn) saveAllBtn.style.display = '';
      }
    } catch (e) {
      if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; }
      showToast('Не удалось сохранить раздел: ' + e.message, 'error');
    }
    return;
  }

  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fields${window.location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
    );
    if (!r.ok) throw new Error(await r.text());
    if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
    _modToggleEdit(panel, false);
    await _reloadModulePage();
  } catch { if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; } }
}

async function _reloadModulePage() {
  const chr = STATE.currentModule?.chronicle;
  const mod = STATE.currentModule?.name;
  if (!chr || !mod) return;
  const activeTab = document.querySelector('.modp-tab.active')?.dataset?.modtab || 'info';
  const data = await fetch(
    `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${window.location.search}`
  ).then(r => r.json()).catch(() => null);
  if (data) {
    STATE.currentModuleData = data;
    renderModulePage(data);
    if (activeTab && activeTab !== 'info') {
      document.querySelectorAll('.modp-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.modtab === activeTab));
      document.querySelectorAll('.modp-panel').forEach(p =>
        p.classList.toggle('active', p.id === `modp-panel-${activeTab}`));
    }
  }
}

// Locations detail: upload/carousel/lightbox moved to public/locations.js (E2.3).

// ═══════════════════════════════════════════════════════════════
// Create Character Modal
// ═══════════════════════════════════════════════════════════════

const VAMPIRE_CLANS = [
  // 13 канонических кланов V20
  'Асамиты', 'Бруха', 'Вентру', 'Гэнгрел', 'Джованни',
  'Ласомбра', 'Малкавиан', 'Носферату', 'Равнос',
  'Последователи Сета', 'Тореадор', 'Тремер', 'Тзимище',
  // Кровные линии
  'Баали', 'Дочери Какофонии', 'Каппадокийцы', 'Нагараджа',
  'Салубри', 'Самеди', 'Серпанты Света',
];

const VAMPIRE_SECTS = [
  'Камарилья', 'Анархи', 'Шабаш', 'Независимый',
];

// V20 архетипы Натуры/Маски — нет канонического списка в проекте, список авторский (рус. термин + англ. оригинал).
const NATURE_DEMEANOR_ARCHETYPES = [
  'Архитектор (Architect)', 'Автократ (Autocrat)', 'Бонвиван (Bon Vivant)', 'Хвастун (Bravo)',
  'Опекун (Caregiver)', 'Кавалер (Cavalier)', 'Гуляка (Celebrant)', 'Конформист (Conformist)',
  'Хитрец (Conniver)', 'Брюзга (Curmudgeon)', 'Удалец (Daredevil)', 'Девиант (Deviant)',
  'Директор (Director)', 'Фанатик (Fanatic)', 'Галант (Gallant)', 'Судья (Judge)',
  'Одиночка (Loner)', 'Мученик (Martyr)', 'Монстр (Monster)', 'Педагог (Pedagogue)',
  'Перфекционист (Perfectionist)', 'Бунтарь (Rebel)', 'Выживальщик (Survivor)',
  'Традиционалист (Traditionalist)', 'Визионер (Visionary)',
];

const CHANGELING_SEEMINGS = ['Дитя (Childling)', 'Вильдер (Wilder)', 'Гранд (Grump)'];
const CHANGELING_COURTS   = ['Благой (Seelie)', 'Неблагой (Unseelie)'];
const CHANGELING_KITHS = [
  'Богган (Boggan)', 'Гилли Ду (Ghille Dhu)', 'Красная Шапка (Redcap)', 'Нокер (Nocker)',
  'Пак (Pooka)', 'Сатир (Satyr)', 'Слуа (Sluagh)', 'Тролль (Troll)',
  'Ши / Сидхе (Sidhe)', 'Эшу (Eshu)',
];

const GENDER_OPTIONS = ['Мужской', 'Женский'];

const LINEAGE_DEFS = {
  vampire:  { label:'🧛 Вампир',          type:'vampire', endpoint:'characters',
    fields:[
      { param:'name',        label:'Имя',           required:true, placeholder:'Граф Лейрок' },
      { param:'gender',      label:'Пол',           required:true, options:GENDER_OPTIONS, placeholder:'Выберите...' },
      { param:'clan',        label:'Клан',          required:true, options:VAMPIRE_CLANS, placeholder:'Выберите или введите...' },
      { param:'sect',        label:'Секта',         required:true, options:VAMPIRE_SECTS, placeholder:'Выберите или введите...' },
      { param:'generation',  label:'Поколение',                    placeholder:'10-е' },
      { param:'birthYear',   label:'Год рождения',                 placeholder:'1612' },
      { param:'embraceYear', label:'Год обращения',                placeholder:'1640' },
      { param:'sire',        label:'Сир',                          placeholder:'Имя сира' },
      { param:'nature',      label:'Натура (архетип)',              options:NATURE_DEMEANOR_ARCHETYPES, placeholder:'Выберите или введите...' },
      { param:'demeanor',    label:'Маска (архетип)',               options:NATURE_DEMEANOR_ARCHETYPES, placeholder:'Выберите или введите...' },
      { param:'concept',     label:'Амплуа / Концепция',           placeholder:'Кто персонаж по роли' },
      { param:'biography',   label:'Биография',     textarea:true, placeholder:'Краткая биография…' },
      { param:'appearance',  label:'Внешность',     textarea:true, placeholder:'3–5 визуальных маркеров…' },
    ]},
  mortal:   { label:'🧑 Смертный',         type:'mortal', endpoint:'characters',
    fields:[
      { param:'name',     label:'Имя',                  required:true,  placeholder:'Жан Дюбуа' },
      { param:'gender',   label:'Пол',                  required:true,  options:GENDER_OPTIONS, placeholder:'Выберите...' },
      { param:'nature',   label:'Натура (архетип)',                     options:NATURE_DEMEANOR_ARCHETYPES, placeholder:'Выберите или введите...' },
      { param:'demeanor', label:'Маска (архетип)',                      options:NATURE_DEMEANOR_ARCHETYPES, placeholder:'Выберите или введите...' },
      { param:'role',     label:'Профессия / Амплуа',                   placeholder:'Полицейский, Журналист...' },
      { param:'biography', label:'Биография',           textarea:true, placeholder:'Краткая биография…' },
      { param:'appearance', label:'Внешность',          textarea:true, placeholder:'3–5 визуальных маркеров…' },
    ]},
  fairy:    { label:'🧚 Фея / Ченджлинг',  type:'fairy', endpoint:'characters',
    fields:[
      { param:'name',   label:'Имя',                  required:true,  placeholder:'Сильвана' },
      { param:'gender', label:'Пол',                  required:true,  options:GENDER_OPTIONS, placeholder:'Выберите...' },
      { param:'clan',   label:'Раса / Кит',                           options:CHANGELING_KITHS, placeholder:'Выберите или введите...' },
      { param:'seeming', label:'Обличье (Seeming)',   required:true,  options:CHANGELING_SEEMINGS, placeholder:'Выберите...' },
      { param:'court',  label:'Двор',                                 options:CHANGELING_COURTS, placeholder:'Выберите...' },
      { param:'house',  label:'Дом (если Сидхе)',                     placeholder:'Дом, если применимо' },
      { param:'nature',   label:'Натура (архетип)',                   options:NATURE_DEMEANOR_ARCHETYPES, placeholder:'Выберите или введите...' },
      { param:'demeanor', label:'Маска (архетип)',                    options:NATURE_DEMEANOR_ARCHETYPES, placeholder:'Выберите или введите...' },
      { param:'role',   label:'Роль',                                 placeholder:'Рыцарь, Лорд, Странник...' },
      { param:'biography', label:'Биография',         textarea:true, placeholder:'Краткая биография…' },
      { param:'appearance', label:'Внешность',         textarea:true, placeholder:'3–5 визуальных маркеров…' },
    ]},
  werewolf: { label:'🐺 Оборотень',        type:'werewolf',
    fields:[
      { param:'Name',   label:'Имя',                  required:true,  placeholder:'Буря-в-Ночи' },
      { param:'Gender', label:'Пол',                  required:true,  options:GENDER_OPTIONS, placeholder:'Выберите...' },
      { param:'Clan', label:'Племя',                               placeholder:'Bone Gnawers, Glass Walkers...' },
      { param:'Sect', label:'Аусписий',                           placeholder:'Рагабаш, Тали, Арун...' },
      { param:'Role', label:'Роль',                               placeholder:'Альфа, Разведчик...' },
    ]},
  mage:     { label:'🔮 Маг',             type:'mage',
    fields:[
      { param:'Name',   label:'Имя',                  required:true,  placeholder:'Мастер Элиас' },
      { param:'Gender', label:'Пол',                  required:true,  options:GENDER_OPTIONS, placeholder:'Выберите...' },
      { param:'Clan', label:'Традиция / Конвенция',                placeholder:'Verbena, Technocracy...' },
      { param:'Sect', label:'Орден',                              placeholder:'Просветлённые, Объединение...' },
      { param:'Role', label:'Роль',                               placeholder:'Наставник, Агент...' },
    ]},
  hunter:   { label:'🏹 Охотник',         type:'hunter',
    fields:[
      { param:'Name',   label:'Имя',                  required:true,  placeholder:'Конрад Вейс' },
      { param:'Gender', label:'Пол',                  required:true,  options:GENDER_OPTIONS, placeholder:'Выберите...' },
      { param:'Clan', label:'Организация',                        placeholder:'Инквизиция, ЦСА...' },
      { param:'Role', label:'Роль',                               placeholder:'Инквизитор, Агент...' },
    ]},
};

// Пояснения к полям создания/редактирования персонажа — по тексту лейбла
// (одни и те же лейблы повторяются у разных линеек с одним смыслом, поэтому
// сопоставление не завязано на param/лineage).
const CHAR_FIELD_TIPS = {
  'Имя': 'Полное имя персонажа — как оно будет отображаться в карточке и во всех ссылках на него.',
  'Пол': 'Пол персонажа — используется в текстах карточки и при обращении к нему в сценах.',
  'Клан': 'Клан вампира — определяет дисциплины по умолчанию, слабость и место в иерархии Камарильи/Шабаша.',
  'Секта': 'Секта — Камарилья, Шабаш, Анархи и т.д. Определяет политический контекст, союзников и врагов.',
  'Поколение': 'Поколение вампира — насколько персонаж удалён от Прародителя Каина. Влияет на потенциал Дисциплин.',
  'Год рождения': 'Год рождения персонажа смертным человеком — для сверки возраста и таймлайна модулей.',
  'Год обращения': 'Год Объятия — когда персонаж стал вампиром. Используется при проверке таймлайна модулей.',
  'Сир': 'Персонаж-вампир, который обратил (Объял) этого героя, — родитель по крови.',
  'Натура (архетип)': 'Истинная сущность персонажа — как он ведёт себя наедине с собой, без масок.',
  'Маска (архетип)': 'Публичный образ персонажа — то лицо, которое он показывает окружающим.',
  'Амплуа / Концепция': 'Краткая формулировка роли персонажа в истории — кто он по сути, одной фразой.',
  'Биография': 'История персонажа до начала текущих событий — прошлое, важные события, мотивация.',
  'Внешность': 'Внешний облик — 3-5 ярких визуальных деталей для описания при встрече.',
  'Раса / Кит': 'Разновидность феи (Кит) — накладывает свои особенности и склонности.',
  'Обличье (Seeming)': 'Возрастная стадия феи — Паж, Оруженосец или Дворянин — влияет на её силы и статус.',
  'Двор': 'Сезонный Двор феи — Летний или Зимний — определяет мировоззрение и союзников.',
  'Дом (если Сидхе)': 'Благородный Дом, к которому принадлежит Сидхе, — влияет на политику Двора.',
  'Роль': 'Функция персонажа в сюжете или организации — например, Разведчик, Наставник, Агент.',
  'Профессия / Амплуа': 'Род занятий персонажа среди смертных — определяет его связи, ресурсы и образ жизни.',
  'Племя': 'Племя оборотня — определяет тотема, традиции и отношение к другим фракциям.',
  'Аусписий': 'Ауспиций — лунная фаза рождения оборотня, определяющая его роль в стае.',
  'Традиция / Конвенция': 'Магическая парадигма мага — как он объясняет и творит чудеса.',
  'Орден': 'Организационная принадлежность мага внутри своей Традиции/Конвенции.',
  'Организация': 'Организация охотника — источник ресурсов, приказов и идеологии в борьбе со сверхъестественным.',
  // Доп. лейблы карточки/детального просмотра (отличаются формулировкой от
  // формы создания того же поля, напр. «Натура» vs «Натура (архетип)»).
  'Статус': 'Текущее состояние персонажа — жив, в торпоре, погиб и т.п. Определяет доступность персонажа для сцен.',
  'Детали статуса': 'Уточнение статуса — обстоятельства, причина или срок (например, «в торпоре с 1990-х»).',
  'Дитя': 'Персонаж-вампир, которого этот герой обратил (Объял), — его потомок по крови.',
  'Домен / Локация': 'Территория или место, закреплённое за персонажем, — где он обитает или властвует.',
  'Иерархия': 'Место персонажа во внутренней иерархии его фракции или организации.',
  'Дисциплины': 'Вампирские Дисциплины персонажа и их уровни — определяют его сверхъестественные способности.',
  'Деранжементы': 'Психические расстройства персонажа (Безумия) — накопленные травмы от Зверя и веков существования.',
  'Профессия': 'Род занятий персонажа — определяет его связи, ресурсы и образ жизни среди смертных.',
  'Натура': 'Истинная сущность персонажа — как он ведёт себя наедине с собой, без масок.',
  'Маска': 'Публичный образ персонажа — то лицо, которое он показывает окружающим.',
  'Амплуа': 'Краткая формулировка роли персонажа в истории — кто он по сути, одной фразой.',
  'Принадлежность': 'К какой хронике, городу или сюжетной линии относится персонаж — эпизодический или постоянный.',
  'Раса': 'Природа персонажа внутри линейки, если требуется уточнение (например, вид феи).',
  'Род': 'Разновидность феи (Кит) — накладывает свои особенности и склонности.',
  'Титул': 'Формальный титул феи при Дворе — определяет её ранг и привилегии.',
  'Фригольд / Локация': 'Территория или Фригольд, закреплённые за феей.',
  'Особенности / Способности': 'Уникальные черты или врождённые способности персонажа помимо стандартных механик.',
  'Родственники': 'Живые родственники персонажа среди смертных — потенциальные связи или уязвимости.',
  'Отношение к сверхъестественному': 'Насколько персонаж осведомлён о существовании сверхъестественного и как к нему относится.',
  'Раса / Тип': 'Природа персонажа — к какому виду сверхъестественных существ он относится.',
  'Фракция': 'Организация или группа, к которой принадлежит персонаж.',
};

const charModal   = document.getElementById('char-modal');
const modalS1     = document.getElementById('modal-s1');
const modalS2     = document.getElementById('modal-s2');
const modalS2Title= document.getElementById('modal-s2-title');
const modalFields = document.getElementById('modal-fields');
const modalOut    = document.getElementById('modal-output');
const modalSubmit = document.getElementById('modal-submit');
let   modalLineage= null;

const modalImgBtn     = document.getElementById('modal-img-btn');
const modalImgInput   = document.getElementById('modal-img-input');
const modalImgPreview = document.getElementById('modal-img-preview');
const modalImgThumb   = document.getElementById('modal-img-thumb');
const modalImgClear   = document.getElementById('modal-img-clear');
let   modalImgB64 = null;
let   modalImgExt = null;

function resetModalImg() {
  modalImgB64 = null;
  modalImgExt = null;
  modalImgInput.value = '';
  modalImgThumb.src = '';
  modalImgPreview.style.display = 'none';
  modalImgBtn.textContent = '🖼 Добавить изображение';
  modalImgBtn.style.borderColor = '';
}

modalImgBtn.addEventListener('click', () => modalImgInput.click());

modalImgInput.addEventListener('change', () => {
  const file = modalImgInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    modalImgB64 = e.target.result.split(',')[1];
    modalImgExt = file.name.split('.').pop().toLowerCase();
    modalImgThumb.src = e.target.result;
    modalImgPreview.style.display = '';
    modalImgBtn.textContent = '🖼 Изменить изображение';
    modalImgBtn.style.borderColor = 'var(--gold)';
  };
  reader.readAsDataURL(file);
});

modalImgClear.addEventListener('click', () => resetModalImg());

function openCharModal() {
  charModal.classList.add('open');
  showModalStep(1);
}
function closeCharModal() {
  charModal.classList.remove('open');
  modalOut.style.display = 'none';
  modalOut.textContent = '';
}
function showModalStep(n) {
  modalS1.style.display = n === 1 ? '' : 'none';
  modalS2.style.display = n === 2 ? '' : 'none';
  modalOut.style.display = 'none';
  modalSubmit.disabled = false;
  modalSubmit.textContent = 'Создать персонажа';
  if (n === 1) resetModalImg();
}

document.getElementById('btn-open-create-char').addEventListener('click', openCharModal);
document.getElementById('btn-export-chars')?.addEventListener('click', e => {
  e.preventDefault();
  window.location.href = `/api/export/characters${window.location.search}`;
});
document.getElementById('btn-import-chars')?.addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('import-chars-file')?.click();
});
document.getElementById('import-chars-file')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  await importCardsFromFile('characters', file, loadCharacters);
  e.target.value = '';
});
document.getElementById('modal-close').addEventListener('click', closeCharModal);
document.getElementById('modal-back').addEventListener('click', () => showModalStep(1));
charModal.addEventListener('click', e => { if (e.target === charModal) closeCharModal(); });

document.querySelectorAll('.lineage-pick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    modalLineage = btn.dataset.type;
    const def = LINEAGE_DEFS[modalLineage];
    modalS2Title.textContent = def.label;
    modalFields.innerHTML = def.fields.map(f => {
      const listId = f.options ? `dl-${f.param}-${modalLineage}` : '';
      const datalist = f.options
        ? `<datalist id="${listId}">${f.options.map(o => `<option value="${escHtml(o)}">`).join('')}</datalist>`
        : '';
      // Generation is a closed enum (unlike clan/sect/nature/demeanor, which allow
      // free text via datalist) — render a real <select> so it can't be typo'd or
      // left in a non-canonical format; mirrors the <select> in _enterInfoEdit.
      const control = f.param === 'generation'
        ? `<select class="form-control" data-param="${f.param}">
            <option value="">— выбрать —</option>
            ${VAMPIRE_GENERATIONS.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('')}
          </select>`
        : f.textarea
        ? `<textarea class="form-control" data-param="${f.param}" rows="3"
            placeholder="${escHtml(f.placeholder || '')}"></textarea>`
        : `<input class="form-control" data-param="${f.param}"
            placeholder="${escHtml(f.placeholder || '')}"
            type="text" ${f.required ? 'required' : ''}
            ${listId ? `list="${listId}"` : ''}>`;
      return `
      <div class="form-group">
        <label class="form-label">${escHtml(f.label)}${f.required ? ' *' : ''}${fieldTip(CHAR_FIELD_TIPS[f.label])}</label>
        ${control}
        ${datalist}
      </div>`;
    }).join('');
    showModalStep(2);
    const firstField = modalFields.querySelector('input, textarea');
    if (firstField) firstField.focus();
  });
});

modalSubmit.addEventListener('click', async () => {
  const def = LINEAGE_DEFS[modalLineage];
  const params = {};
  let valid = true;

  modalFields.querySelectorAll('[data-param]').forEach(el => {
    const v = el.value.trim();
    if (el.required && !v) { el.style.borderColor = 'var(--crimson)'; valid = false; }
    else { el.style.borderColor = ''; if (v) params[el.dataset.param] = v; }
  });
  if (!valid) return;

  const charName = params.name || params.Name || '';
  const qs = location.search;

  modalSubmit.disabled = true;
  modalSubmit.textContent = '⏳ Создаётся...';
  modalOut.style.display = 'block';
  modalOut.className = 'output-area show';
  modalOut.textContent = '';

  const reset = () => { modalSubmit.disabled = false; modalSubmit.textContent = 'Создать персонажа'; };
  const fail  = msg => { modalOut.className = 'output-area show'; modalOut.textContent = '⚠ ' + msg; reset(); };

  // Shared success: optional art upload → refresh list → close.
  const onCreated = async (okMsg, slug) => {
    modalOut.className = 'output-area show ok';
    modalOut.textContent = okMsg;
    STATE.graph.inited = false;
    if (modalImgB64 && charName) {
      try {
        const u = await fetch(`/api/characters/${encodeURIComponent(slug || _charSlug(charName))}/upload-image${qs}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: modalImgB64, ext: modalImgExt })
        }).then(r => r.json());
        modalOut.textContent += (u && u.ok) ? '\n📷 Арт загружен' : '\n⚠ Арт не загружен';
      } catch { /* не критично */ }
    }
    fetch('/api/characters').then(r => r.json()).then(data => {
      STATE.characters = Array.isArray(data) ? data : [];
      if (STATE.page === 'characters') renderChars();
    }).catch(() => { STATE.characters = []; });
    setTimeout(closeCharModal, 900);
  };

  try {
    if (def.endpoint === 'characters') {
      // Rules-compliant card endpoint — fills clan/sect/generation/birth/embrace/sire/nature/demeanor/concept/seeming/court/house/role/bio/appearance.
      const payload = {
        name: charName, lineage: def.type, gender: params.gender || '',
        clan: params.clan || '', sect: params.sect || '',
        generation: params.generation || '', birthYear: params.birthYear || '',
        embraceYear: params.embraceYear || '', sire: params.sire || '',
        nature: params.nature || '', demeanor: params.demeanor || '', concept: params.concept || '',
        seeming: params.seeming || '', court: params.court || '', house: params.house || '',
        role: params.role || '',
        biography: params.biography || '', appearance: params.appearance || '',
      };
      const d = await fetch('/api/characters' + qs, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json());
      if (!d.ok) return fail(d.error || 'Ошибка');
      await onCreated(`✓ Создан: cities/${CITY}/characters/${d.lineage}/${d.slug}/${d.slug}.md`, d.slug);
    } else {
      // Other lineages → new_npc CLI tool (Name / Clan / Sect / Role positional args).
      const TYPE_TO_LINEAGE = {
        vampire: 'vampires', mortal: 'mortals', fairy: 'fairies',
        werewolf: 'werewolves', mage: 'mages', hunter: 'hunters'
      };
      const folder = TYPE_TO_LINEAGE[def.type] || 'mortals';
      const npcArgs = [CITY, folder, params.Name, params.Gender, params.Clan || '', params.Sect || '', params.Role || ''];
      const d = await fetch('/api/tool/new_npc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: npcArgs })
      }).then(r => r.json());
      if (!d.ok) { modalOut.textContent = d.output || '(нет вывода)'; reset(); return; }
      // CLI tool doesn't return JSON — pull the slug out of its stdout path (cities/.../<slug>/<slug>.md).
      const slugMatch = (d.output || '').match(/\/([a-z0-9_]+)\/\1\.md/);
      await onCreated(d.output || '✓ Создан', slugMatch?.[1]);
    }
  } catch (e) {
    fail(e.message);
  }
});

// ═══════════════════════════════════════════════════════════════
// Onboarding tour — ceremonial spotlight walkthrough (zero-dep)
// ═══════════════════════════════════════════════════════════════
// Steps target the sidebar (always visible, data-independent) so the tour works
// on a brand-new install with no city/characters yet. Workflow, not features.
const TOUR_SEEN_KEY = 'sanguine-tour-seen';
const TOUR_STEPS = [
  {
    sel: '.city-switch',
    label: 'Шаг 1 · 5',
    title: 'Начни с домена',
    body: 'Каждый город — отдельный сеттинг: своя политика, фракции, локации и персонажи. Активный домен переключается здесь, а кнопка «+» создаёт новый.',
  },
  {
    sel: '.nav-item[data-page="characters"]',
    label: 'Шаг 2 · 5',
    title: 'Реестр персонажей',
    body: 'Вампиры, смертные и феи домена. Клик по карточке открывает досье: внешность, дисциплины, связи, дневники. Фильтры сверху сужают список по линейке и статусу.',
  },
  {
    sel: '.nav-item[data-page="chronicles-page"]',
    label: 'Шаг 3 · 5',
    title: 'Хроники и модули',
    body: 'Хроника — это кампания. Внутри неё живут модули — отдельные игровые сессии со сценарием, событиями и НПС.',
  },
  {
    sel: '.nav-item[data-page="threads"]',
    label: 'Шаг 4 · 5',
    title: 'Открытые нити',
    body: 'Незавершённые сюжетные нити, ждущие развязки. Здесь видно, что осталось разрешить, и можно менять их статус и приоритет.',
  },
  {
    sel: '.nav-item[data-page="tools"]',
    label: 'Шаг 5 · 5',
    title: 'Инструменты Рассказчика',
    body: 'Создание доменов, НПС и локаций, генерация контента и проверка целостности данных. Этот тур всегда можно перезапустить кнопкой «?» у логотипа.',
  },
];

let _tourIdx = 0;
let _tourEls = null;

function _tourTeardown() {
  if (_tourEls) {
    _tourEls.backdrop.remove();
    _tourEls.spotlight.remove();
    _tourEls.card.remove();
    _tourEls = null;
  }
  window.removeEventListener('resize', _tourReposition);
  window.removeEventListener('keydown', _tourKey);
}

function _tourFinish() {
  _tourTeardown();
  try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch {}
}

function _tourNext() {
  if (_tourIdx < TOUR_STEPS.length - 1) { _tourIdx++; _tourRender(); }
  else _tourFinish();
}

function _tourPrev() {
  if (_tourIdx > 0) { _tourIdx--; _tourRender(); }
}

function _tourKey(e) {
  if (e.key === 'Escape')                            _tourFinish();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') _tourNext();
  else if (e.key === 'ArrowLeft')                    _tourPrev();
}

function _tourReposition() {
  if (!_tourEls) return;
  const target = document.querySelector(TOUR_STEPS[_tourIdx].sel);
  if (!target) { _tourFinish(); return; }
  const r = target.getBoundingClientRect();
  const pad = 6;
  const sp = _tourEls.spotlight;
  sp.style.top    = `${r.top - pad}px`;
  sp.style.left   = `${r.left - pad}px`;
  sp.style.width  = `${r.width + pad * 2}px`;
  sp.style.height = `${r.height + pad * 2}px`;
  // Card sits to the right of the sidebar target, vertically aligned, clamped to viewport.
  const card  = _tourEls.card;
  const gap   = 16;
  const cardW = card.offsetWidth  || 340;
  const cardH = card.offsetHeight || 180;
  let left = r.right + gap;
  if (left + cardW > window.innerWidth - 12) left = Math.max(12, r.left - cardW - gap);
  let top = r.top;
  if (top + cardH > window.innerHeight - 12) top = Math.max(12, window.innerHeight - cardH - 12);
  card.style.left = `${left}px`;
  card.style.top  = `${top}px`;
}

function _tourRender() {
  const step = TOUR_STEPS[_tourIdx];
  if (!document.querySelector(step.sel)) { _tourNext(); return; }
  const last = _tourIdx === TOUR_STEPS.length - 1;
  _tourEls.card.innerHTML = `
    <div class="tour-step-label">${escHtml(step.label)}</div>
    <div class="tour-card-title">${escHtml(step.title)}</div>
    <div class="tour-card-body">${escHtml(step.body)}</div>
    <div class="tour-actions">
      <button type="button" class="tour-btn tour-btn-ghost" data-act="skip">Пропустить</button>
      <div class="tour-actions-right">
        <button type="button" class="tour-btn tour-btn-ghost" data-act="prev"${_tourIdx === 0 ? ' disabled' : ''}>Назад</button>
        <button type="button" class="tour-btn tour-btn-primary" data-act="next">${last ? 'Готово' : 'Далее'}</button>
      </div>
    </div>`;
  _tourReposition();
}

function startTour() {
  if (_tourEls) return;
  _tourIdx = 0;
  const backdrop  = document.createElement('div'); backdrop.id  = 'tour-backdrop';
  const spotlight = document.createElement('div'); spotlight.id = 'tour-spotlight';
  const card      = document.createElement('div'); card.id      = 'tour-card';
  document.body.append(backdrop, spotlight, card);
  _tourEls = { backdrop, spotlight, card };
  backdrop.addEventListener('click', _tourNext);
  card.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next')      _tourNext();
    else if (act === 'prev') _tourPrev();
    else if (act === 'skip') _tourFinish();
  });
  window.addEventListener('resize', _tourReposition);
  window.addEventListener('keydown', _tourKey);
  _tourRender();
}

document.getElementById('btn-tour')?.addEventListener('click', startTour);

// First-run auto-launch (once). Wait for the sidebar and initial load to settle.
window.addEventListener('load', () => {
  let seen = false;
  try { seen = localStorage.getItem(TOUR_SEEN_KEY) === '1'; } catch {}
  if (!seen && document.querySelector('.city-switch')) setTimeout(startTour, 900);
});

// Location Edit/Create Modal + Module Locations Panel moved to public/locations.js (E2.3).
