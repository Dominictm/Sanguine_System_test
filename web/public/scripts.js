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
  active: 'Жив / Жива', torpor: 'Торпор', dead: 'Мёртв / Мертва', unknown: 'Неизвестно'
};
const LINEAGE_LABELS = {
  vampire: '🧛 Вампир', fairy: '🧚 Фея', mortal: '🧑 Смертный',
  werewolf: '🐺 Оборотень', mage: '🔮 Маг', hunter: '🏹 Охотник'
};

const REL_COLORS = {
  family:     '#C94040',
  sire:       '#DC143C',
  childe:     '#DC143C',
  ally:       '#4A8FD9',
  enemy:      '#E06000',
  loyalty:    '#B8860B',
  romantic:   '#D06890',
  suspicious: '#9B6BAE',
  neutral:    '#555555'
};

const REL_LABELS = {
  family:     'Семья',
  sire:       'Сир/Чайлд',
  childe:     'Чайлд',
  ally:       'Союзник',
  enemy:      'Враг',
  loyalty:    'Преданность',
  romantic:   'Романтика',
  suspicious: 'Подозрение',
  neutral:    'Нейтральный'
};

const NODE_COLORS = {
  vampire:  '#7A0000',
  fairy:    '#2A5020',
  mortal:   '#4A4A4A',
  werewolf: '#5A3A1A',
  mage:     '#1A2A5A',
  hunter:   '#4A3A1A',
  unknown:  '#333333'
};

// Mock data — placeholder until server returns real characters
const MOCK_GRAPH = {
  nodes: [
    { id: 'Вампир А',  lineage: 'vampire', clan: 'Малкавиан', status: 'active' },
    { id: 'Вампир Б',  lineage: 'vampire', clan: 'Тореадор',  status: 'active' },
    { id: 'Вампир В',  lineage: 'vampire', clan: 'Вентру',    status: 'torpor' },
    { id: 'НПС Г',     lineage: 'vampire', clan: 'Носферату', status: 'active' },
    { id: 'Смертный Д',lineage: 'mortal',  clan: '—',         status: 'active' },
    { id: 'Фея Е',     lineage: 'fairy',   clan: 'Sidhe',     status: 'active' },
  ],
  links: [
    { source: 'Вампир А',   target: 'Вампир Б',   type: 'sire',       label: 'Сир',         description: 'создатель' },
    { source: 'Вампир А',   target: 'Вампир В',   type: 'family',     label: 'семья',        description: 'кровная связь' },
    { source: 'Вампир Б',   target: 'НПС Г',      type: 'ally',       label: 'союзник',      description: 'союз по расчёту' },
    { source: 'Вампир В',   target: 'НПС Г',      type: 'neutral',    label: 'знаком',       description: 'нейтральный контакт' },
    { source: 'НПС Г',      target: 'Смертный Д', type: 'loyalty',    label: 'преданность',  description: 'связь лояльности' },
    { source: 'Фея Е',      target: 'Вампир Б',   type: 'ally',       label: 'союзница',     description: 'долгосрочный союз' },
    { source: 'Смертный Д', target: 'Вампир А',   type: 'enemy',      label: 'враг',         description: 'конфликт интересов' },
    { source: 'Фея Е',      target: 'Вампир В',   type: 'suspicious', label: 'подозрение',   description: 'взаимное недоверие' },
  ]
};

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
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.page').forEach(el =>
    el.classList.toggle('active', el.id === `page-${page}`));

  if (page === 'dashboard')  loadDashboard();
  if (page === 'chronicle')  loadChronicle();
  if (page === 'characters') loadCharacters();
  if (page === 'graph')      loadGraph();
  if (page === 'chronicles-page') loadChroniclesPage();
  if (page === 'modules')         loadModules();
  if (page === 'threads')    loadThreads();
  if (page === 'locations')  loadLocations();
}

document.querySelectorAll('[data-page]').forEach(el =>
  el.addEventListener('click', () => navigate(el.dataset.page)));

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

async function loadDashboard() {
  const el = document.getElementById('dash-content');
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    const [stats, auth] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/auth-status').then(r => r.json()).catch(() => ({ source: 'none', ok: false })),
    ]);
    document.getElementById('domain-label').innerHTML = `<span>${stats.domain || 'Домен'}</span>`;
    renderDashboard(stats, el, auth);
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

function renderDashboard(s, container, auth = {}) {
  // Broken links badge
  const blCount = s.brokenLinks;
  const blBadge = blCount === null || blCount === undefined
    ? `<span class="badge-integrity neutral">⚠ Не проверено</span>`
    : blCount === 0
      ? `<span class="badge-integrity ok">✓ Ссылки OK</span>`
      : `<span class="badge-integrity err">${blCount} битых ссылок</span>`;

  const LINEAGES = [
    { key: 'vampires',   label: 'вампиров',   color: '#8B0000' },
    { key: 'fairies',    label: 'фей',         color: '#5a9e40' },
    { key: 'mortals',    label: 'смертных',    color: '#888888' },
    { key: 'werewolves', label: 'оборотней',   color: '#8B6530' },
    { key: 'mages',      label: 'магов',       color: '#3A5A9B' },
    { key: 'hunters',    label: 'охотников',   color: '#7A6020' },
  ];

  const lineageDetail = LINEAGES
    .filter(l => (s[l.key] || 0) > 0)
    .map(l => `${s[l.key]} ${l.label}`)
    .join(' · ') || '—';

  const lineageSubstats = LINEAGES
    .filter(l => (s[l.key] || 0) > 0)
    .map(l => `<div class="substat">
        <div class="substat-dot" style="background:${l.color}"></div>
        <span>${s[l.key]} ${l.label}</span>
      </div>`)
    .join('');

  const savedModel = localStorage.getItem('ai-model') || 'claude-opus-4-8';

  // Auth status badge
  const authBadge = (() => {
    if (auth.source === 'openrouter') {
      return `<span class="ai-auth-badge ok">✓ OpenRouter · ${auth.model || 'free'}</span>`;
    }
    if (auth.source === 'api-key') {
      return `<span class="ai-auth-badge ok">✓ ANTHROPIC_API_KEY</span>`;
    }
    if (auth.source === 'claude-login' && auth.ok) {
      return `<span class="ai-auth-badge ok">✓ Claude.ai (${auth.subscription || 'pro'}) · истекает через ${auth.expiresIn} мин</span>`;
    }
    if (auth.source === 'claude-login' && auth.expired) {
      return `<span class="ai-auth-badge warn">⚠ Токен истёк — выполни команду в Claude Code</span>`;
    }
    return `<span class="ai-auth-badge err">✗ Нет авторизации — запусти Claude Code</span>`;
  })();

  container.innerHTML = `
    <div class="ai-model-selector">
      <label>🤖 Модель для генерации:</label>
      <select id="ai-model-select" class="ai-model-select">
        <option value="claude-opus-4-8" ${savedModel === 'claude-opus-4-8' ? 'selected' : ''}>Claude Opus 4.8 (лучше всего)</option>
        <option value="claude-sonnet-4-6" ${savedModel === 'claude-sonnet-4-6' ? 'selected' : ''}>Claude Sonnet 4.6 (сбалансированно)</option>
        <option value="claude-haiku-4-5-20251001" ${savedModel === 'claude-haiku-4-5-20251001' ? 'selected' : ''}>Claude Haiku 4.5 (быстро)</option>
      </select>
      ${authBadge}
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Персонажи</div>
        <div class="stat-value accent" id="sv-chars">0</div>
        <div class="stat-detail">${lineageDetail}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Активны</div>
        <div class="stat-value" id="sv-active">0</div>
        <div class="stat-detail">${s.torpor || 0} в торпоре</div>
      </div>
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
        <div class="substat-dot" style="background:#7dce82"></div>
        <span>${s.active || 0} активных персонажей</span>
      </div>
      <div class="substat">
        <div class="substat-dot" style="background:#8888cc"></div>
        <span>${s.torpor || 0} в торпоре</span>
      </div>
      ${lineageSubstats}
    </div>
    <div class="integrity-row">${blBadge}</div>
    <div id="integrity-panel" class="integrity-panel"></div>`;

  animateValue(document.getElementById('sv-chars'), s.characters || 0);
  animateValue(document.getElementById('sv-active'), s.active || 0);
  animateValue(document.getElementById('sv-modules'), s.modules || 0);
  animateValue(document.getElementById('sv-locations'), s.locations || 0);
  animateValue(document.getElementById('sv-events'), s.events || 0, 1100);
  animateValue(document.getElementById('sv-threads'), s.openThreads || 0, 1200);

  // Model selector handler
  const modelSelect = document.getElementById('ai-model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', (e) => {
      localStorage.setItem('ai-model', e.target.value);
    });
  }
}

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
    ${rows}`;
}

// Clickable dashboard stat cards → navigate; integrity rows → expand
document.getElementById('dash-content').addEventListener('click', e => {
  const card = e.target.closest('.stat-clickable[data-nav]');
  if (card) { navigate(card.dataset.nav); return; }

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

  grid.innerHTML = list.map(c => {
    const icon   = LINEAGE_ICONS[c.lineage] || '👤';
    const stType = c.statusType || 'unknown';
    const stLbl  = statusLabel(c);
    const linBadge = `<span class="badge badge-${c.lineage}">${LINEAGE_LABELS[c.lineage] || c.lineage}</span>`;
    const stBadge  = stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : '';
    const textBlock = `
      <div class="char-name">${escHtml(c.name)}</div>
      <div class="char-clan">${c.lineage === 'mortal' ? '' : escHtml(c.clan || c.lineageLabel || '—')}</div>
      <div class="char-status-row">${stBadge}</div>
      <div class="char-badges">${linBadge}</div>`;

    if (c.imageUrl) {
      return `<div class="char-card has-art" data-name="${escHtml(c.name)}">
        <img class="char-card-art" src="${c.imageUrl}" alt="${escHtml(c.name)}">
        <div class="char-card-overlay">${textBlock}</div>
      </div>`;
    }
    return `<div class="char-card" data-name="${escHtml(c.name)}">
      <span class="char-lineage-icon">${icon}</span>
      ${textBlock}
    </div>`;
  }).join('');
}

document.getElementById('search-input').addEventListener('input', e => {
  STATE.filter.search = e.target.value;
  if (STATE.characters.length) { renderChars(); _injectGridDims(); }
});

// ── Grid carousel ─────────────────────────────────────────────────────────────
const GRID_INTERVAL = 60 * 1000;   // 1 минута

let _gridImages  = {};   // name → [url, ...]
let _gridIdxs    = {};   // name → current index
let _gridTimers  = {};   // name → intervalID
let _gridInitTO  = {};   // name → initial-delay timeoutID

function _clearGridTimers() {
  for (const id of Object.values(_gridTimers)) clearInterval(id);
  for (const id of Object.values(_gridInitTO)) clearTimeout(id);
  _gridTimers = {};
  _gridInitTO = {};
}

async function initGridCarousels() {
  _clearGridTimers();

  const qs   = window.location.search;
  const resp = await fetch('/api/characters/all-images' + qs).catch(() => null);
  if (!resp?.ok) return;
  _gridImages = await resp.json().catch(() => ({}));

  for (const name of Object.keys(_gridImages)) _gridIdxs[name] = 0;

  _injectGridDims();

  // Каждая карточка стартует со случайным сдвигом 0..59 с
  for (const name of Object.keys(_gridImages)) {
    const delay = Math.floor(Math.random() * GRID_INTERVAL);
    _gridInitTO[name] = setTimeout(() => {
      _advanceCard(name);
      _gridTimers[name] = setInterval(() => _advanceCard(name), GRID_INTERVAL);
    }, delay);
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
  if (!images) return;
  const card = document.querySelector(`.char-card[data-name="${CSS.escape(name)}"]`);
  if (!card) return;
  const img = card.querySelector('.char-card-art');
  const dim = card.querySelector('.char-card-dim');
  if (!img || !dim) return;

  dim.classList.add('dark');
  setTimeout(() => {
    _gridIdxs[name] = (_gridIdxs[name] + 1) % images.length;
    img.src = images[_gridIdxs[name]];
    setTimeout(() => dim.classList.remove('dark'), 300);
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

// ═══════════════════════════════════════════════════════════════
// Relationship Graph (D3 v7)
// ═══════════════════════════════════════════════════════════════

async function loadGraph() {
  if (STATE.graph.inited) return;
  STATE.graph.inited = true;

  // Stop previous simulation to prevent CPU leak on re-init
  if (STATE.graph.sim) { STATE.graph.sim.stop(); STATE.graph.sim = null; }

  // Pre-load characters so portraits show in info panel without visiting Characters page
  if (!STATE.characters.length) {
    try {
      const chars = await fetch('/api/characters').then(r => r.json());
      STATE.characters = Array.isArray(chars) ? chars : [];
    } catch {}
  }

  let data = null;
  try {
    const fetched = await fetch('/api/graph').then(r => r.json());
    if (fetched.nodes) data = fetched;
  } catch {}
  if (!data) data = MOCK_GRAPH;

  if (!data.nodes.length) {
    d3.select('#graph-svg').selectAll('*').remove();
    if (!document.getElementById('graph-empty-state')) {
      const overlay = document.createElement('div');
      overlay.id = 'graph-empty-state';
      overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-family:var(--f-heading);letter-spacing:.2em;text-transform:uppercase;font-size:22px;pointer-events:none';
      overlay.textContent = 'Нет персонажей — создайте первого';
      document.getElementById('graph-wrap').appendChild(overlay);
    }
    return;
  }
  const _es = document.getElementById('graph-empty-state');
  if (_es) _es.remove();

  STATE.graph.data = data;
  buildLegend();
  renderGraph(data);
}

function buildLegend() {
  const types = ['family','sire','ally','enemy','loyalty','neutral'];
  document.getElementById('graph-legend').innerHTML = types.map(t =>
    `<div class="legend-item">
      <div class="legend-line" style="background:${REL_COLORS[t]}"></div>
      ${REL_LABELS[t]}
    </div>`
  ).join('');
}

function renderGraph(data) {
  const wrap  = document.getElementById('graph-wrap');
  const svgEl = document.getElementById('graph-svg');
  const W = wrap.clientWidth, H = wrap.clientHeight;

  const svg = d3.select(svgEl)
    .attr('width', W).attr('height', H);

  svg.selectAll('*').remove();

  // ── Defs ──
  const defs = svg.append('defs');

  // Glow filter
  const gf = defs.append('filter').attr('id', 'node-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  gf.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '4').attr('result', 'blur');
  const fm = gf.append('feMerge');
  fm.append('feMergeNode').attr('in', 'blur');
  fm.append('feMergeNode').attr('in', 'SourceGraphic');

  // Arrow markers
  Object.entries(REL_COLORS).forEach(([type, color]) => {
    defs.append('marker')
      .attr('id', `arr-${type}`)
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 22).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', color).attr('opacity', .7);
  });

  // Node radial gradients
  Object.entries(NODE_COLORS).forEach(([lin, col]) => {
    const grad = defs.append('radialGradient').attr('id', `grad-${lin}`);
    grad.append('stop').attr('offset', '0%').attr('stop-color', col).attr('stop-opacity', .95);
    grad.append('stop').attr('offset', '100%').attr('stop-color', col).attr('stop-opacity', .6);
  });

  // ── Simulation ──
  const nodes = data.nodes.map(d => ({ ...d }));
  const links = data.links.map(d => ({ ...d }));

  const sim = d3.forceSimulation(nodes)
    .force('link',      d3.forceLink(links).id(d => d.id).distance(180).strength(.6))
    .force('charge',    d3.forceManyBody().strength(-320))
    .force('center',    d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(36));

  STATE.graph.sim = sim;

  // ── Zoom ──
  const g = svg.append('g');
  const zoom = d3.zoom().scaleExtent([.2, 4]).on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom);
  STATE.graph.zoom = zoom;
  STATE.graph.svg  = svg;

  // ── Links ──
  const link = g.append('g').attr('class', 'links')
    .selectAll('line').data(links).join('line')
    .attr('class', 'graph-link')
    .attr('stroke', d => REL_COLORS[d.type] || REL_COLORS.neutral)
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', .55)
    .attr('marker-end', d => `url(#arr-${d.type})`);

  // ── Nodes ──
  const nodeG = g.append('g').attr('class', 'nodes')
    .selectAll('g').data(nodes).join('g')
    .attr('class', 'node-group')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  const r = d => d.lineage === 'vampire' ? 18 : d.lineage === 'fairy' ? 16 : 14;

  nodeG.append('circle')
    .attr('class', 'node-circle')
    .attr('r', r)
    .attr('fill', d => `url(#grad-${d.lineage || 'unknown'})`)
    .attr('stroke', d => d.status === 'active' ? '#CC2200' : d.status === 'torpor' ? '#5555aa' : '#444')
    .attr('stroke-width', 2)
    .attr('filter', 'url(#node-glow)');

  nodeG.append('text')
    .attr('class', 'node-label')
    .attr('text-anchor', 'middle')
    .attr('dy', d => r(d) + 14)
    .attr('font-family', 'Cinzel, serif')
    .attr('font-size', 19)
    .attr('fill', '#c0b4a8')
    .attr('letter-spacing', '.06em')
    .text(d => d.id.split(' ').slice(0, 2).join(' '));

  nodeG.append('text')
    .attr('text-anchor', 'middle').attr('dy', '0.4em')
    .attr('font-size', 22).attr('pointer-events', 'none')
    .text(d => LINEAGE_ICONS[d.lineage] || '👤');

  // ── Hover ──
  nodeG.on('mouseenter', (e, d) => {
    if (STATE.selectedNode) return;
    highlightNode(d, link, nodeG, links);
  }).on('mouseleave', () => {
    if (STATE.selectedNode) return;
    resetHighlight(link, nodeG);
  });

  // ── Click ──
  nodeG.on('click', (e, d) => {
    e.stopPropagation();
    STATE.selectedNode = d;
    highlightNode(d, link, nodeG, links);
    showInfoPanel(d, links, data.nodes);
  });

  svg.on('click', () => {
    STATE.selectedNode = null;
    resetHighlight(link, nodeG);
    closeInfoPanel();
  });

  STATE.graph.nodes = nodeG;
  STATE.graph.links = link;

  // ── Tick ──
  sim.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

function highlightNode(d, link, nodeG, links) {
  const connIds = new Set(
    links.filter(l => l.source.id === d.id || l.target.id === d.id)
         .flatMap(l => [l.source.id, l.target.id])
  );

  link.attr('stroke-opacity', l =>
      l.source.id === d.id || l.target.id === d.id ? .95 : .08)
    .attr('stroke-width', l =>
      l.source.id === d.id || l.target.id === d.id ? 2.5 : 1);

  nodeG.attr('opacity', n => connIds.has(n.id) ? 1 : .25);
}

function resetHighlight(link, nodeG) {
  link.attr('stroke-opacity', .55).attr('stroke-width', 1.5);
  nodeG.attr('opacity', 1);
}

function showInfoPanel(d, links, nodes) {
  const outLinks = links.filter(l => l.source.id === d.id || l.target.id === d.id);

  const relsByType = {};
  for (const l of outLinks) {
    const isSource = l.source.id === d.id;
    const other    = isSource ? l.target.id : l.source.id;
    const desc     = isSource ? l.description : `← ${l.description}`;
    const type     = l.type;
    if (!relsByType[type]) relsByType[type] = [];
    relsByType[type].push({ other, desc });
  }

  const relsHtml = Object.entries(relsByType).map(([type, items]) =>
    items.map(({ other, desc }) => `
      <div class="rel-item">
        <div class="rel-target">
          <div class="rel-type-dot" style="background:${REL_COLORS[type] || '#555'}"></div>
          ${escHtml(other)}
        </div>
        <div class="rel-desc">${escHtml(desc)}</div>
      </div>`).join('')
  ).join('');

  const charData = (STATE.characters || []).find(c => c.name === d.id);
  const portraitHtml = charData?.imageUrl
    ? `<img class="info-portrait" src="${charData.imageUrl}" alt="${d.id}">`
    : `<span class="info-lineage-icon">${LINEAGE_ICONS[d.lineage] || '👤'}</span>`;

  const graphStatusLbl = charData?.status || STATUS_LABELS[d.status] || d.status;
  const graphStatusDetails = charData?.statusDetails || '';

  document.getElementById('info-content').innerHTML = `
    ${portraitHtml}
    <div class="info-name">${escHtml(d.id)}</div>
    <div class="info-meta">${escHtml(d.clan || d.lineage || '')}</div>
    <div class="char-badges" style="margin-bottom:4px">
      <span class="badge badge-${d.lineage}">${LINEAGE_LABELS[d.lineage] || d.lineage}</span>
      ${d.status !== 'unknown' ? `<span class="badge badge-${d.status}">${escHtml(graphStatusLbl)}</span>` : ''}
    </div>
    ${graphStatusDetails ? `<div class="cdet-status-details" style="margin-bottom:6px">${escHtml(graphStatusDetails)}</div>` : ''}
    <div class="info-divider"></div>
    <div class="info-section-label">Связи (${outLinks.length})</div>
    ${relsHtml || '<div style="color:var(--text3);font-size:26px;font-style:italic">Нет известных связей</div>'}
  `;

  document.getElementById('info-panel').classList.add('open');
}

function closeInfoPanel() {
  document.getElementById('info-panel').classList.remove('open');
  STATE.selectedNode = null;
  if (STATE.graph.links && STATE.graph.nodes)
    resetHighlight(STATE.graph.links, STATE.graph.nodes);
}

document.getElementById('info-close').addEventListener('click', e => {
  e.stopPropagation();
  closeInfoPanel();
});

// Zoom controls
document.getElementById('btn-zoom-in').addEventListener('click', () => {
  if (!STATE.graph.svg) return;
  STATE.graph.svg.transition().call(STATE.graph.zoom.scaleBy, 1.4);
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  if (!STATE.graph.svg) return;
  STATE.graph.svg.transition().call(STATE.graph.zoom.scaleBy, .7);
});
document.getElementById('btn-reset').addEventListener('click', () => {
  if (!STATE.graph.svg) return;
  STATE.graph.svg.transition().duration(500).call(
    STATE.graph.zoom.transform, d3.zoomIdentity);
});

// ═══════════════════════════════════════════════════════════════
// Tools
// ═══════════════════════════════════════════════════════════════

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  });
});

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
const _NTR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function slugifyJS(s) { return (s || '').toLowerCase().split('').map(c => _NTR[c] !== undefined ? _NTR[c] : c).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_'); }
async function runNodeTool(name, args, outId, btn) {
  const out = document.getElementById(outId);
  btn.disabled = true; btn.textContent = '⏳ Выполняется...';
  out.className = 'output-area show'; out.textContent = `$ node tools/${name}.js\n\n`;
  try {
    const data = await fetch('/api/tool/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args }) }).then(r => r.json());
    const cls = data.ok ? 'ok' : 'err';
    out.innerHTML = `$ node tools/${name}.js\n\n<span class="${cls}">${escHtml(data.output || '(нет вывода)')}</span>`;
    if (data.ok) { STATE.characters = []; STATE.graph.inited = false; if (STATE.page === 'dashboard') loadDashboard(); }
  } catch (e) {
    out.innerHTML = `<span class="err">⚠ Ошибка соединения\n${e.message}</span>`;
  }
  btn.disabled = false; btn.textContent = getOrigLabel(btn.id) || 'Готово';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Compact, safe Markdown → HTML renderer for module files & chronicle prose.
// Escapes first, then applies a limited block/inline grammar. Links render as
// styled text (relative .md paths don't resolve in the browser).
function mdInline(s) {
  return escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="md-link">$1</span>');
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

function statusLabel(c) {
  const raw = c.status || '';
  if (raw && !raw.includes('⚠️')) return raw;
  return STATUS_LABELS[c.statusType || 'unknown'] || '—';
}
function getOrigLabel(id) {
  return {
    'btn-new-city':    'Создать домен',
    'btn-new-npc':     'Создать карточку',
    'btn-new-module':  'Создать модуль',
    'btn-validate':    'Проверить',
    'btn-validate-fix':'Исправить автоматически',
  }[id] || 'Выполнить';
}

document.getElementById('btn-new-city').addEventListener('click', () => {
  const city = document.getElementById('city-name').value.trim();
  const year = document.getElementById('city-year').value.trim();
  if (!city) { alert('Укажите название города'); return; }
  runNodeTool('new_city', [slugifyJS(city), city, year || ''], 'out-new-city', document.getElementById('btn-new-city'));
});

const NPC_LINEAGE = { vampire: 'vampires', fairy: 'fairies', mortal: 'mortals', werewolf: 'werewolves', mage: 'mages', hunter: 'hunters' };
document.getElementById('btn-new-npc').addEventListener('click', () => {
  const name = document.getElementById('npc-name').value.trim();
  if (!name) { alert('Укажите имя НПС'); return; }
  if (!CITY) { alert('Сначала выбери город в шапке'); return; }
  const lineage = NPC_LINEAGE[document.getElementById('npc-type').value] || 'mortals';
  runNodeTool('new_npc', [CITY, lineage, name], 'out-new-npc', document.getElementById('btn-new-npc'));
});

document.getElementById('btn-new-module').addEventListener('click', () => {
  const name = document.getElementById('module-name').value.trim();
  if (!name) { alert('Укажите название модуля'); return; }
  runTool('new_module', { Name: name }, 'out-new-module', document.getElementById('btn-new-module'));
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
    if (!CITY) { alert('Сначала выбери город в шапке'); return; }
    const args = argsFn(); if (!args) return;
    runNodeTool(name, args, 'out-more', el);
  });
}
_moreBtn('btn-new-loc', 'new_location', () => {
  const d = document.getElementById('loc-district').value.trim();
  const n = document.getElementById('loc-name').value.trim();
  if (!d || !n) { alert('Укажите округ/код и название'); return null; }
  return [CITY, d, n, document.getElementById('loc-rayon').value.trim(), document.getElementById('loc-zone').value];
});
_moreBtn('btn-migrate', 'migrate_char', () => {
  const slug = document.getElementById('mig-slug').value.trim();
  const to   = document.getElementById('mig-to').value.trim();
  if (!slug || !to) { alert('Укажите слаг персонажа и город назначения'); return null; }
  return ['visit', CITY, document.getElementById('mig-lineage').value, slug, to, document.getElementById('mig-when').value.trim()];
});
_moreBtn('btn-close-chr', 'close_chronicle', () => {
  const chr = document.getElementById('close-chr').value.trim();
  if (!chr) { alert('Укажите слаг хроники'); return null; }
  return [CITY, chr, document.getElementById('close-note').value.trim()];
});
_moreBtn('btn-rebuild-idx', 'build_city_events', () => [CITY]);

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
// Chronicle detail modal (modules list + create/delete module)
// ═══════════════════════════════════════════════════════════════

let _chrDetailSlug    = null;
let _chrDetailDisplay = null;
let _modDeleteTarget  = null; // { chr, mod }
let _modSlugEdited    = false;

function renderModuleCardInChr(m, chrSlug) {
  const files = [
    m.hasScenario ? '<span class="chd-mod-file">📝 Сценарий</span>' : '',
    m.hasFinale   ? '<span class="chd-mod-file chd-file-finale">📜 Финал</span>' : '',
    m.hasNpc      ? '<span class="chd-mod-file">👥 НПС</span>' : '',
  ].filter(Boolean).join('');
  return `
    <div class="chd-mod-card">
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
  modal.style.display = 'flex';

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
  if (e.target.closest('.chd-mod-del-btn')) return;
  // chip links (events tab)
  const chipMod = e.target.closest('.chip-mod');
  if (chipMod) { openModuleDetail(chipMod.dataset.mod, chipMod.dataset.tab); return; }
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
    const mod = modCard.querySelector('.chd-mod-del-btn')?.dataset.mod;
    if (mod) openModuleDetail(mod);
  }
});

// Close detail modal
document.getElementById('chr-detail-close').addEventListener('click', () => {
  document.getElementById('chr-detail-modal').style.display = 'none';
});
document.getElementById('chr-detail-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('chr-detail-modal'))
    document.getElementById('chr-detail-modal').style.display = 'none';
});

// ── Create module ─────────────────────────────────────────────────────────────

document.getElementById('btn-create-module-in-chr').addEventListener('click', () => {
  document.getElementById('mod-create-name').value  = '';
  document.getElementById('mod-create-time').value  = '';
  document.getElementById('mod-create-slug').value  = '';
  document.getElementById('mod-create-error').style.display = 'none';
  _modSlugEdited = false;
  document.getElementById('mod-create-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('mod-create-name').focus(), 50);
});

document.getElementById('mod-create-name').addEventListener('input', e => {
  if (!_modSlugEdited) document.getElementById('mod-create-slug').value = slugifyChr(e.target.value);
});
document.getElementById('mod-create-slug').addEventListener('input', () => { _modSlugEdited = true; });

document.getElementById('mod-create-cancel').addEventListener('click', () => {
  document.getElementById('mod-create-modal').style.display = 'none';
});
document.getElementById('mod-create-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mod-create-modal'))
    document.getElementById('mod-create-modal').style.display = 'none';
});

document.getElementById('mod-create-submit').addEventListener('click', async () => {
  const name  = document.getElementById('mod-create-name').value.trim();
  const time  = document.getElementById('mod-create-time').value.trim();
  const slug  = document.getElementById('mod-create-slug').value.trim() || slugifyChr(name);
  const errEl = document.getElementById('mod-create-error');
  const btn   = document.getElementById('mod-create-submit');

  if (!name) { errEl.textContent = 'Введи название модуля'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = '⏳ Создание...';

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles/${encodeURIComponent(_chrDetailSlug)}/modules${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, time, slug }) }).then(r => r.json());

    if (!d.ok) { errEl.textContent = d.error || 'Ошибка'; errEl.style.display = ''; return; }

    document.getElementById('mod-create-modal').style.display = 'none';
    openChrDetail(_chrDetailSlug, _chrDetailDisplay);
  } catch (e) {
    errEl.textContent = 'Ошибка: ' + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Создать';
  }
});

document.getElementById('mod-create-modal').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('mod-create-submit').click();
  if (e.key === 'Escape') document.getElementById('mod-create-modal').style.display = 'none';
});

// ── Delete module ─────────────────────────────────────────────────────────────

document.addEventListener('click', e => {
  const delBtn = e.target.closest('.chd-mod-del-btn');
  if (!delBtn) return;
  _modDeleteTarget = { chr: delBtn.dataset.chr, mod: delBtn.dataset.mod };
  const body    = document.getElementById('mod-delete-body');
  const confirm = document.getElementById('mod-delete-confirm');
  confirm.disabled = false;
  body.innerHTML = `
    <div class="chr-modal-warn">Необратимое действие. Будет удалён модуль <b>${escHtml(_modDeleteTarget.mod)}</b>.</div>
    <div class="chr-modal-section">Эпизодические НПС модуля будут удалены.<br>У каноничных персонажей — удалены ссылки на этот модуль в дневниках.</div>`;
  document.getElementById('mod-delete-modal').style.display = 'flex';
});

document.getElementById('mod-delete-cancel').addEventListener('click', () => {
  document.getElementById('mod-delete-modal').style.display = 'none';
  _modDeleteTarget = null;
});
document.getElementById('mod-delete-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mod-delete-modal')) {
    document.getElementById('mod-delete-modal').style.display = 'none';
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
      document.getElementById('mod-delete-modal').style.display = 'none';
      _modDeleteTarget = null;
      confirm.textContent = 'Удалить';
      openChrDetail(chr, _chrDetailDisplay, 'modules');
    }, 1500);
  } catch (err) {
    body.innerHTML = `<div style="color:var(--accent2)">Ошибка: ${escHtml(err.message)}</div>`;
    confirm.disabled = false; confirm.textContent = 'Удалить';
  }
});

// ── Create chronicle modal ────────────────────────────────────────────────────

const _TR_SLUG = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
function slugifyChr(s) {
  return s.toLowerCase().split('').map(c => _TR_SLUG[c] !== undefined ? _TR_SLUG[c] : c).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
}

let _slugEdited = false;

document.getElementById('btn-create-chronicle').addEventListener('click', () => {
  document.getElementById('chr-create-name').value  = '';
  document.getElementById('chr-create-slug').value  = '';
  document.getElementById('chr-create-error').style.display = 'none';
  _slugEdited = false;
  document.getElementById('chr-create-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('chr-create-name').focus(), 50);
});

document.getElementById('chr-create-name').addEventListener('input', e => {
  if (!_slugEdited) document.getElementById('chr-create-slug').value = slugifyChr(e.target.value);
});
document.getElementById('chr-create-slug').addEventListener('input', () => { _slugEdited = true; });

document.getElementById('chr-create-cancel').addEventListener('click', () => {
  document.getElementById('chr-create-modal').style.display = 'none';
});
document.getElementById('chr-create-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('chr-create-modal'))
    document.getElementById('chr-create-modal').style.display = 'none';
});

document.getElementById('chr-create-submit').addEventListener('click', async () => {
  const name  = document.getElementById('chr-create-name').value.trim();
  const slug  = document.getElementById('chr-create-slug').value.trim() || slugifyChr(name);
  const errEl = document.getElementById('chr-create-error');
  const btn   = document.getElementById('chr-create-submit');

  if (!name) { errEl.textContent = 'Введи название хроники'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = '⏳ Создание...';

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }) }).then(r => r.json());

    if (!d.ok) { errEl.textContent = d.error || 'Ошибка'; errEl.style.display = ''; return; }

    document.getElementById('chr-create-modal').style.display = 'none';
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
  if (e.key === 'Escape') document.getElementById('chr-create-modal').style.display = 'none';
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
  modal.style.display = 'flex';
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
  document.getElementById('chr-delete-modal').style.display = 'none';
  _chrDeleteSlug = null;
});
document.getElementById('chr-delete-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('chr-delete-modal')) {
    document.getElementById('chr-delete-modal').style.display = 'none';
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
      document.getElementById('chr-delete-modal').style.display = 'none';
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
        m.hasFinale   ? '<span class="module-file file-finale">📜 Финал</span>' : '',
        m.hasNpc      ? '<span class="module-file">👥 НПС</span>' : '',
      ].filter(Boolean).join('');
      return `
      <div class="module-card" data-name="${escHtml(m.name)}">
        <div class="module-title">${escHtml(m.title)}</div>
        ${m.time ? `<div class="module-time">${escHtml(m.time)}</div>` : ''}
        <div class="module-meta">
          ${m.tone   ? `<span class="module-tag">${escHtml(m.tone)}</span>`   : ''}
          ${m.format ? `<span class="module-tag">${escHtml(m.format)}</span>` : ''}
          ${m.type   ? `<span class="module-tag mod-type">${escHtml(m.type)}</span>` : ''}
        </div>
        ${files ? `<div class="module-files">${files}</div>` : ''}
        <div class="module-slug">${escHtml(m.name)}</div>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
  }
}

// ═══════════════════════════════════════════════════════════════
// Threads
// ═══════════════════════════════════════════════════════════════

async function loadThreads() {
  const el = document.getElementById('threads-list');
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    const threads = await fetch('/api/threads').then(r => r.json());
    const active = threads.filter(t => t.status === 'active');
    const bg     = threads.filter(t => t.status === 'background');
    document.getElementById('threads-sub').textContent =
      `${active.length} активных · ${bg.length} фоновых`;

    const renderThread = t => `
      <div class="thread-card thread-${escHtml(t.status)}">
        <div class="thread-num">${t.id}</div>
        <div class="thread-body">
          <div class="thread-title">${escHtml(t.title)}</div>
          ${t.description ? `<div class="thread-desc">${escHtml(t.description)}</div>` : ''}
          <div class="thread-source">${escHtml(t.source)}</div>
        </div>
        <div class="thread-priority priority-${escHtml(t.priority.toLowerCase())}">${escHtml(t.priority)}</div>
      </div>`;

    let html = '';
    if (active.length) {
      html += `<div class="threads-section-header">🔴 Активные (${active.length})</div>`;
      html += active.map(renderThread).join('');
    }
    if (bg.length) {
      html += `<div class="threads-section-header" style="margin-top:32px">🟡 Фоновые (${bg.length})</div>`;
      html += bg.map(renderThread).join('');
    }
    el.innerHTML = html || '<div class="loading-state" style="height:120px">Нитей нет</div>';
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
  }
}

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
async function ensureLocsLoaded() {
  if (STATE.locations.length) return;
  try {
    const data = await fetch('/api/locations').then(r => r.json());
    STATE.locations = Array.isArray(data) ? data : [];
  } catch {}
}

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
  document.getElementById('chronicle-sub').textContent =
    st.tab === 'world' ? 'Состояние мира' : `${evCount} событий`;
  el.innerHTML = st.tab === 'world'
    ? renderWorldState(data.worldState)
    : renderTimeline(data.events || []);
}

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
        ? `<button class="chron-chip chip-mod" data-mod="${escHtml(l.module)}" data-tab="${tab}">${label}</button>`
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
  if (mc) { openModuleDetail(mc.dataset.mod, mc.dataset.tab); return; }
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
        <div class="mod-modal-slug">📁 ${escHtml(d.name)}</div>
      </div>
      <div class="cdet-tab-bar">
        ${tabs.map(t => `<button class="cdet-tab ${t[0] === active ? 'active' : ''} ${t[0] === 'finale' ? 'tab-finale' : ''}" data-tab="${t[0]}">${escHtml(t[1])}</button>`).join('')}
      </div>
      <div class="cdet-panels">
        ${tabs.map(t => `<div class="cdet-panel ${t[0] === active ? 'active' : ''}" data-panel="${t[0]}"><div class="md-body">${mdToHtml(t[2])}</div></div>`).join('')}
      </div>
    </div>`;
}

// Module card clicks
document.getElementById('modules-list').addEventListener('click', e => {
  const card = e.target.closest('.module-card[data-name]');
  if (card) openModuleDetail(card.dataset.name);
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
  let avail = false;
  try { avail = (await fetch('/api/claude/health').then(r => r.json())).available; } catch {}
  if (!avail) {
    zone.innerHTML = `<div class="ls-claude-msg">CLI «claude» не найден на сервере. Попросите Claude в терминале: «сгенерируй прозу для stub'ов этой сессии».</div>`;
    return;
  }
  zone.innerHTML = `
    <div class="ls-prose-controls">
      <select class="form-control ls-prose-model" id="ls-prose-model">
        <option value="">Модель: по умолчанию</option>
        <option value="opus">Opus — лучшее качество, дороже</option>
        <option value="sonnet">Sonnet — баланс, дешевле</option>
        <option value="haiku">Haiku — быстро и дёшево</option>
      </select>
      <button class="btn-submit btn-genprose" id="ls-genprose" type="button">🪄 Сгенерировать прозу (Claude)</button>
    </div>
    <div class="ls-prose-note">Claude напишет дневники и финал по фактам события и комментариям Мастера. Дешевле — Sonnet/Haiku, качественнее — Opus. Тратит токены.</div>
    <div class="ls-prose-result" id="ls-prose-result"></div>`;
  document.getElementById('ls-genprose').addEventListener('click', () => lsGenProse(stubs));
}

async function lsGenProse(stubs) {
  const btn = document.getElementById('ls-genprose');
  const out = document.getElementById('ls-prose-result');
  const model = (document.getElementById('ls-prose-model') || {}).value || '';
  btn.disabled = true; btn.textContent = '⏳ Claude пишет прозу…';
  out.innerHTML = `<div class="ls-note">Идёт генерация${model ? ` (${model})` : ''} — не закрывайте вкладку…</div>`;

  let j;
  try {
    j = await fetch('/api/claude/generate-prose', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stubs, model })
    }).then(r => r.json());
  } catch (e) {
    out.innerHTML = `<div class="ls-err">⚠ ${escHtml(e.message)}</div>`;
    btn.disabled = false; btn.textContent = '🪄 Сгенерировать прозу (Claude)';
    return;
  }

  if (!j.ok && !(j.written || []).length) {
    out.innerHTML = `<div class="ls-err">⚠ ${escHtml(j.error || 'Не удалось сгенерировать прозу')}</div>`;
    btn.disabled = false; btn.textContent = '🪄 Сгенерировать прозу (Claude)';
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
// Init
// ═══════════════════════════════════════════════════════════════

loadDashboard();

// ═══════════════════════════════════════════════════════════════
// Char Detail Modal
// ═══════════════════════════════════════════════════════════════

const INFO_FIELDS = [
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
];

function renderDiaryList(c) {
  if (!c.diaries?.length) return '<div class="cdet-empty">Дневников нет</div>';
  return `<div class="diaries-list">${c.diaries.map(d => `
    <div class="diary-item" data-char="${escHtml(c.name)}" data-file="${escHtml(d.file)}" data-title="${escHtml(d.title)}">
      <span class="diary-item-icon">📜</span>
      <span class="diary-item-title">${escHtml(d.title)}</span>
      <span class="diary-item-arrow">→</span>
    </div>`).join('')}</div>`;
}

function formatDiaryText(text) {
  if (!text) return '';
  return text.split(/\n\n+/)
    .filter(Boolean)
    .map(para => `<p>${escHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function loadDiaryEntry(charName, file) {
  const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
  if (!panel) return;
  panel.innerHTML = '<div class="diary-loading"><div class="spinner"></div>Загрузка...</div>';
  try {
    const data = await fetch(
      `/api/characters/${encodeURIComponent(charName)}/diary?file=${encodeURIComponent(file)}`
    ).then(r => r.json());
    if (data.error) throw new Error(data.error);
    const panels = panel.closest('.cdet-panels');
    if (panels) panels.scrollTop = 0;

    if (data.format === 'retrospective') {
      panel.innerHTML = `
        <button class="diary-back" data-char="${escHtml(charName)}">← Все дневники</button>
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
        <button class="diary-back" data-char="${escHtml(charName)}">← Все дневники</button>
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

function openCharDetail(name) {
  const c = STATE.characters.find(ch => ch.name === name);
  if (!c) return;

  const icon   = LINEAGE_ICONS[c.lineage] || '👤';
  const stType = c.statusType || 'unknown';
  const stLbl  = statusLabel(c);

  const infoFields = INFO_FIELDS
    .map(([k, lbl]) => {
      const raw = c[k];
      const empty = !raw || raw === '—' || String(raw).includes('⚠️');
      const display = empty ? 'Неизвестно' : escHtml(raw);
      const cls = empty ? 'cdet-val unknown' : 'cdet-val';
      return `<div class="cdet-key">${lbl}</div><div class="${cls}" data-field="${k}">${display}</div>`;
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
    c.imagePrompt ? `
      <div class="cdet-section-title">Промт для генерации</div>
      <textarea class="cdet-prompt-box" readonly>${escHtml(c.imagePrompt)}</textarea>
      ${c.negativePrompt ? `
        <div class="cdet-section-title" style="margin-top:14px">Негативный промт</div>
        <textarea class="cdet-prompt-box cdet-prompt-neg" readonly>${escHtml(c.negativePrompt)}</textarea>` : ''}` : '',
  ].filter(Boolean).join('');

  document.getElementById('char-detail-content').innerHTML = `
    <div class="cdet-portrait-col" id="cdet-portrait-col">${portraitCol}</div>
    <div class="cdet-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">${escHtml(c.name)}</div>
        <div class="cdet-badges">
          <span class="badge badge-${c.lineage}">${LINEAGE_LABELS[c.lineage] || c.lineage}</span>
          ${stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : ''}
        </div>
        ${c.statusDetails ? `<div class="cdet-status-details">${escHtml(c.statusDetails)}</div>` : ''}
      </div>
      <div class="cdet-tab-bar">
        <button class="cdet-tab active" data-tab="info">Информация</button>
        <button class="cdet-tab" data-tab="bio">Биография</button>
        <button class="cdet-tab" data-tab="rels">Отношения</button>
        <button class="cdet-tab" data-tab="diaries">Дневники${c.diaries?.length ? ` (${c.diaries.length})` : ''}</button>
        <button class="cdet-tab" data-tab="desc">Описание</button>
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="info">
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
            <div class="cdet-rels-hint">Каждая строка: <em>Имя — описание связи</em></div>
            <textarea class="cdet-edit-textarea" id="cdet-rels-ta" rows="10" placeholder="Имя — описание связи">${(c.relationships||[]).map(r => `${r.target} — ${r.description}`).join('\n')}</textarea>
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
        <div class="cdet-panel" data-panel="desc">
          <div class="cdet-info-header" style="gap:8px">
            <button class="cdet-gen-appearance-btn" id="cdet-gen-appearance" data-char="${escHtml(c.name)}" title="Сгенерировать описание внешности по артам персонажа (Claude Vision)">👁 Внешность по арту</button>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-prompt" data-char="${escHtml(c.name)}" title="Сгенерировать промт на основе внешности персонажа">🎨 Промт</button>
            <button class="cdet-edit-btn" data-editpanel="desc" data-char="${escHtml(c.name)}">✏ Редактировать</button>
          </div>
          <div id="cdet-desc-view">
            ${descHtml || '<div class="cdet-empty">Описание не заполнено</div>'}
          </div>
          <div id="cdet-desc-edit" style="display:none">
            <div class="cdet-section-title">Внешность</div>
            <textarea class="cdet-edit-textarea" id="cdet-appearance-ta" rows="5" placeholder="Внешность персонажа...">${c.appearance && !c.appearance.includes('⚠️') ? escHtml(c.appearance) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">Голос</div>
            <textarea class="cdet-edit-textarea" id="cdet-voice-ta" rows="3" placeholder="Голос, манера речи...">${c.voice && !c.voice.includes('⚠️') ? escHtml(c.voice) : ''}</textarea>
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
    return;
  }
  if (e.target.closest('#cdet-carousel-prev')) { _carouselGoTo(_carouselIdx - 1, true); return; }
  if (e.target.closest('#cdet-carousel-next')) { _carouselGoTo(_carouselIdx + 1, true); return; }
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
  if (e.target.closest('#cdet-gen-appearance')) { _generateAppearance(e.target.closest('#cdet-gen-appearance').dataset.char); return; }
  if (e.target.closest('#cdet-gen-prompt')) { _generatePrompt(e.target.closest('#cdet-gen-prompt').dataset.char); return; }

  const uploadBtn = e.target.closest('.cdet-upload-btn');
  if (uploadBtn) { triggerImageUpload(uploadBtn.dataset.char); return; }

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

  const resp = await fetch(`/api/characters/${encodeURIComponent(charName)}/images${window.location.search}`)
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
  if (on) edit.querySelector('textarea')?.focus();
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
      const r = await fetch(`/api/characters/${encodeURIComponent(charName)}/fields${qs}`,
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
      const lines = (document.getElementById('cdet-rels-ta')?.value || '').split('\n');
      const r = await fetch(`/api/characters/${encodeURIComponent(charName)}/relations${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        // Refresh relations view
        const rels = lines.filter(l => l.includes(' — ')).map(l => {
          const idx = l.indexOf(' — ');
          return { target: l.slice(0, idx).trim(), description: l.slice(idx + 3).trim() };
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
      const imagePrompt  = document.getElementById('cdet-prompt-ta')?.value.trim() || '';
      const negativePrompt = document.getElementById('cdet-negprompt-ta')?.value.trim() || '';
      const fields = {};
      if (appearance)   fields.appearance    = appearance;
      if (voice)        fields.voice         = voice;
      if (imagePrompt)  fields.imagePrompt   = imagePrompt;
      if (negativePrompt) fields.negativePrompt = negativePrompt;
      const r = await fetch(`/api/characters/${encodeURIComponent(charName)}/fields${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        const ch = STATE.characters.find(c => c.name === charName);
        if (ch) Object.assign(ch, { appearance, voice, imagePrompt, negativePrompt });
        // Refresh desc view
        const descHtml = [
          appearance ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
          voice ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
          imagePrompt ? `<div class="cdet-section-title">Промт для генерации</div><textarea class="cdet-prompt-box" readonly>${escHtml(imagePrompt)}</textarea>${negativePrompt ? `<div class="cdet-section-title" style="margin-top:14px">Негативный промт</div><textarea class="cdet-prompt-box cdet-prompt-neg" readonly>${escHtml(negativePrompt)}</textarea>` : ''}` : '',
        ].filter(Boolean).join('');
        document.getElementById('cdet-desc-view').innerHTML = descHtml || '<div class="cdet-empty">Описание не заполнено</div>';
      }
    }
  } catch(e) { alert('Ошибка: ' + e.message); }

  save.disabled = false;
  save.textContent = 'Сохранить';
  if (ok) {
    _togglePanelEdit(panel, false);
    if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }
  }
}

async function _generateAppearance(charName) {
  const btn = document.getElementById('cdet-gen-appearance');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализ арта...'; }

  try {
    const model = localStorage.getItem('ai-model') || 'claude-opus-4-8';
    const qs    = window.location.search;

    // 1. Генерируем внешность через Vision API
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(charName)}/generate-appearance${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }) }
    );
    const d = await resp.json();
    if (!d.ok) { alert('Ошибка генерации: ' + (d.error || 'неизвестная ошибка')); return; }

    // 2. Автосохраняем в карточку персонажа
    if (btn) btn.textContent = '💾 Сохранение...';
    const saveResp = await fetch(
      `/api/characters/${encodeURIComponent(charName)}/fields${qs}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { appearance: d.appearance } }) }
    );
    const saveData = await saveResp.json();
    if (!saveData.ok) { alert('Ошибка сохранения: ' + (saveData.error || '')); return; }

    // 3. Обновляем STATE
    const ch = STATE.characters.find(c => c.name === charName);
    if (ch) ch.appearance = d.appearance;

    // 4. Обновляем вкладку Описание (view-режим)
    const view = document.getElementById('cdet-desc-view');
    if (view) {
      const cur = ch || {};
      const voice       = cur.voice       || '';
      const imagePrompt = cur.imagePrompt || '';
      const negPrompt   = cur.negativePrompt || '';
      view.innerHTML = [
        d.appearance  ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(d.appearance)}</div><div class="cdet-divider"></div>` : '',
        voice         ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        imagePrompt   ? `<div class="cdet-section-title">Промт для генерации</div><textarea class="cdet-prompt-box" readonly>${escHtml(imagePrompt)}</textarea>${negPrompt ? `<div class="cdet-section-title" style="margin-top:14px">Негативный промт</div><textarea class="cdet-prompt-box cdet-prompt-neg" readonly>${escHtml(negPrompt)}</textarea>` : ''}` : '',
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
    alert('Ошибка соединения: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '👁 Внешность по арту'; }
  }
}

function _generatePrompt(charName) {
  const c = STATE.characters.find(ch => ch.name === charName);
  if (!c) return;

  const lineageLbl = LINEAGE_LABELS[c.lineage] || c.lineage || 'персонаж';
  const clan  = c.clan && !c.clan.includes('⚠️') ? `${c.clan}, ` : '';
  const app   = c.appearance && !c.appearance.includes('⚠️') ? c.appearance : '';

  const prompt = [
    `[Блок 1] Cinematic dark fantasy portrait, ${clan}${lineageLbl}, three-quarter view, ${app || 'описание внешности не заполнено'}`,
    `[Блок 2] Dim cold atmospheric light from above, deep crimson rim-light from behind, heavy shadows, pure black painterly background with abstract swirling brushstroke textures`,
    `[Блок 3] Dark fantasy digital painting, visible painterly brushstrokes, textured oil-paint effect, cinematic composition, moody gothic atmosphere, Vampire the Masquerade aesthetic, concept art quality, painterly realism, artstation quality, masterpiece`,
  ].join('\n');

  const ta = document.getElementById('cdet-prompt-ta');
  if (ta) {
    ta.value = prompt;
    // Открываем редактирование если ещё не открыто
    if (document.getElementById('cdet-desc-edit')?.style.display === 'none') {
      _togglePanelEdit('desc', true);
    }
    ta.focus();
    ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── Info field editing ────────────────────────────────────────────────────────
let _editCharName   = null;
let _editOrigValues = {};

function _enterInfoEdit(charName) {
  _editCharName = charName;
  _editOrigValues = {};

  const grid = document.getElementById('cdet-info-fields');
  const btn  = document.getElementById('cdet-edit-btn');
  const bar  = document.getElementById('cdet-edit-bar');
  if (!grid || !btn || !bar) return;

  // Replace each .cdet-val with an input
  grid.querySelectorAll('.cdet-val').forEach(cell => {
    const key = cell.dataset.field;
    const isUnknown = cell.classList.contains('unknown');
    const current = isUnknown ? '' : cell.textContent;
    _editOrigValues[key] = current;

    const input = document.createElement('input');
    input.className = 'cdet-field-input';
    input.dataset.field = key;
    input.value = current;
    input.placeholder = 'Неизвестно';
    cell.replaceWith(input);
  });

  btn.classList.add('active');
  btn.textContent = '✏ Режим редактирования';
  bar.classList.add('show');

  // Focus first input
  grid.querySelector('.cdet-field-input')?.focus();
}

function _exitInfoEdit(saved) {
  const grid = document.getElementById('cdet-info-fields');
  const btn  = document.getElementById('cdet-edit-btn');
  const bar  = document.getElementById('cdet-edit-bar');
  if (!grid || !btn || !bar) return;

  // Restore value cells
  grid.querySelectorAll('.cdet-field-input').forEach(input => {
    const key   = input.dataset.field;
    const value = saved ? input.value.trim() : (_editOrigValues[key] || '');
    const empty = !value;
    const div = document.createElement('div');
    div.className = empty ? 'cdet-val unknown' : 'cdet-val';
    div.dataset.field = key;
    div.textContent   = empty ? 'Неизвестно' : value;
    input.replaceWith(div);
  });

  btn.classList.remove('active');
  btn.textContent = '✏ Редактировать';
  bar.classList.remove('show');
  _editCharName = null;
}

async function _saveInfoFields() {
  const grid    = document.getElementById('cdet-info-fields');
  const saveBtn = document.getElementById('cdet-save-btn');
  const msg     = document.getElementById('cdet-save-msg');
  if (!grid || !_editCharName) return;

  const fields = {};
  grid.querySelectorAll('.cdet-field-input').forEach(inp => {
    const v = inp.value.trim();
    if (v) fields[inp.dataset.field] = v;
  });

  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ Сохранение...';

  try {
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(_editCharName)}/fields${window.location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }) }
    );
    const d = await resp.json();
    if (d.ok) {
      // Update STATE cache
      const ch = STATE.characters.find(c => c.name === _editCharName);
      if (ch) Object.assign(ch, Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, v])
      ));
      _exitInfoEdit(true);
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2500);
    } else {
      alert('Ошибка: ' + (d.error || 'не удалось сохранить'));
    }
  } catch(e) {
    alert('Ошибка соединения: ' + e.message);
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
      const resp   = await fetch(`/api/characters/${encodeURIComponent(charName)}/upload-image`, {
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
        alert('Сервер недоступен. Перезапустите start.bat и попробуйте снова.');
      } else {
        alert('Ошибка загрузки: ' + err.message);
      }
    }
  };
  input.click();
}

// ═══════════════════════════════════════════════════════════════
// Locations
// ═══════════════════════════════════════════════════════════════

const ZONE_CLASS_LABELS = {
  elysium:    '🏛️ Элизиум',
  nosferatu:  '🟣 Носферату',
  neutral:    '🟡 Нейтральная',
  danger:     '🔴 Опасная',
  other:      '📍 Локация',
};

const MASQ_BADGE_LABELS = {
  low:     '🟢 Низкий',
  medium:  '🟡 Средний',
  high:    '🔴 Высокий',
};

function zoneClass(zone) {
  if (!zone) return 'other';
  const z = zone.toLowerCase();
  if (z.includes('элизиум'))                return 'elysium';
  if (z.includes('носферату'))              return 'nosferatu';
  if (z.includes('нейтральн'))              return 'neutral';
  if (z.includes('опасн') || (z.includes('шабаш') && !z.includes('нейтральн'))) return 'danger';
  return 'other';
}

async function loadLocations() {
  if (STATE.locations.length) { renderLocations(); return; }
  document.getElementById('locs-grid').innerHTML =
    '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    const data = await fetch('/api/locations').then(r => r.json());
    STATE.locations = Array.isArray(data) ? data : [];
    populateDistrictFilter();
    renderLocations();
  } catch {
    document.getElementById('locs-grid').innerHTML =
      '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить локации</div>';
  }
}

function populateDistrictFilter() {
  const sel = document.getElementById('loc-filter-district');
  const current = sel.value;
  const districts = [...new Set(
    STATE.locations.map(l => l.district).filter(Boolean)
  )].sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, 'ru');
  });
  sel.innerHTML = '<option value="all">Все округа</option>' +
    districts.map(d => `<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('');
  if (districts.includes(current)) sel.value = current;
}

function renderLocations() {
  const { zone, masq, district, search } = STATE.locFilter;
  let list = STATE.locations;
  if (zone     !== 'all') list = list.filter(l => zoneClass(l.zone) === zone);
  if (masq     !== 'all') list = list.filter(l => l.masqueradeLevel === masq);
  if (district !== 'all') list = list.filter(l => l.district === district);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(l =>
      (l.title || l.slug).toLowerCase().includes(q) ||
      (l.subtype      || '').toLowerCase().includes(q) ||
      (l.district     || '').toLowerCase().includes(q) ||
      (l.neighborhood || '').toLowerCase().includes(q) ||
      (l.address      || '').toLowerCase().includes(q)
    );
  }

  document.getElementById('locations-sub').textContent = `${list.length} локаций`;

  const grid = document.getElementById('locs-grid');
  if (!list.length) {
    grid.innerHTML = '<div class="loading-state" style="height:100px">Локации не найдены</div>';
    return;
  }
  grid.innerHTML = list.map(loc => {
    const zc    = zoneClass(loc.zone);
    const mLvl  = loc.masqueradeLevel || 'unknown';
    const masqBadge = MASQ_BADGE_LABELS[mLvl]
      ? `<span class="badge badge-masq-${mLvl}">${MASQ_BADGE_LABELS[mLvl]}</span>`
      : '';
    const zoneBadge = `<span class="badge badge-loc-${zc}">${ZONE_CLASS_LABELS[zc]}</span>`;

    const distLine = [loc.district, loc.neighborhood].filter(Boolean).map(escHtml).join(' · ');
    const cardTitle = loc.subtype || loc.title || loc.slug;
    const textBlock = `
      <div class="loc-title">${escHtml(cardTitle)}</div>
      ${distLine    ? `<div class="loc-district">${distLine}</div>` : ''}
      ${loc.address ? `<div class="loc-address">${escHtml(loc.address)}</div>` : ''}
      <div class="loc-badges">${zoneBadge}${masqBadge}</div>`;

    if (loc.imageUrl) {
      return `<div class="loc-card has-art" data-slug="${escHtml(loc.slug)}">
        <img class="loc-card-img" src="${loc.imageUrl}" alt="${escHtml(loc.title || loc.slug)}">
        <div class="loc-card-overlay">${textBlock}</div>
      </div>`;
    }
    return `<div class="loc-card" data-slug="${escHtml(loc.slug)}">
      <span class="loc-zone-icon">${ZONE_CLASS_LABELS[zc][0]}</span>
      ${textBlock}
    </div>`;
  }).join('');
}

function openLocDetail(slug) {
  const loc = STATE.locations.find(l => l.slug === slug);
  if (!loc) return;

  const zc   = zoneClass(loc.zone);
  const mLvl = loc.masqueradeLevel || 'unknown';

  const imgCol = loc.imageUrl
    ? `<img class="locdet-img" src="${loc.imageUrl}" alt="${escHtml(loc.title || loc.slug)}">`
    : `<div class="locdet-no-img">${ZONE_CLASS_LABELS[zc][0]}</div>`;

  const atmHtml = loc.atmosphere
    ? `<div class="locdet-atm">${escHtml(loc.atmosphere)}</div>`
    : '<div class="cdet-empty">Описание не заполнено</div>';

  const vtmSections = [
    ['Статус',            loc.locStatus],
    ['Фракция',           loc.faction],
    ['Постоянные фигуры', loc.figures],
    ['Угрозы',            loc.threats],
    ['Маскарад',          loc.masquerade],
  ].filter(([, v]) => v);

  const vtmParts = [];
  if (loc.vtmText) vtmParts.push(`<div class="locdet-atm">${escHtml(loc.vtmText)}</div>`);
  vtmSections.forEach(([k, v]) => vtmParts.push(
    `<div class="vtm-section">
      <div class="vtm-lbl">${escHtml(k)}</div>
      <div class="vtm-body">${escHtml(v)}</div>
    </div>`
  ));
  const vtmHtml = vtmParts.length
    ? vtmParts.join('<div class="diary-divider"></div>')
    : '<div class="cdet-empty">Контекст не заполнен</div>';

  const keyPointsHtml = loc.keyPoints?.length
    ? `<div class="locdet-table">${loc.keyPoints.map(kp =>
        `<div class="locdet-row">
          <div class="locdet-key">${escHtml(kp.place)}</div>
          <div class="locdet-val">${escHtml(kp.desc)}</div>
        </div>`).join('')}</div>`
    : '<div class="cdet-empty">Ключевые точки не заполнены</div>';

  const hooksHtml = loc.hooks?.length
    ? `<div class="locdet-hooks">${loc.hooks.map((h, i) =>
        `<div class="locdet-hook">
          <span class="locdet-hook-num">${i + 1}</span>
          <span class="locdet-hook-text">${escHtml(h)}</span>
        </div>`).join('')}</div>`
    : '<div class="cdet-empty">Крючки не заполнены</div>';

  const promptTab  = loc.imagePrompt ? '<button class="cdet-tab" data-tab="prompt">Промт</button>' : '';
  const promptPanel = loc.imagePrompt ? `<div class="cdet-panel" data-panel="prompt">
    <div class="cdet-section-title">Промт для генерации</div>
    <textarea class="cdet-prompt-box" readonly>${escHtml(loc.imagePrompt)}</textarea>
    ${loc.negativePrompt ? `<div class="cdet-section-title" style="margin-top:14px">Негативный промт</div>
    <textarea class="cdet-prompt-box cdet-prompt-neg" readonly>${escHtml(loc.negativePrompt)}</textarea>` : ''}
  </div>` : '';

  const masqBadge = MASQ_BADGE_LABELS[mLvl]
    ? `<span class="badge badge-masq-${mLvl}">${MASQ_BADGE_LABELS[mLvl]}</span>`
    : '';

  const metaRows = [
    ['Название',   loc.subtype],
    ['Округ',      loc.district],
    ['Район',      loc.neighborhood],
    ['Адрес',      loc.address],
    ['Зона',       loc.zone],
    ['Контроль',   loc.control],
  ].filter(([, v]) => v);
  const metaHtml = `<div class="locdet-table">${metaRows.map(([k, v]) =>
    `<div class="locdet-row"><div class="locdet-key">${escHtml(k)}</div><div class="locdet-val">${escHtml(v)}</div></div>`
  ).join('')}</div>`;

  document.getElementById('loc-detail-content').innerHTML = `
    <div class="locdet-img-col">${imgCol}</div>
    <div class="cdet-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">${escHtml(loc.title || loc.slug)}</div>
        ${loc.subtype ? `<div class="locdet-subtype">${escHtml(loc.subtype)}</div>` : ''}
        <div class="locdet-legend-row">
          <div class="locdet-legend-item">
            <span class="locdet-legend-lbl">Зона контроля</span>
            <span class="badge badge-loc-${zc}">${ZONE_CLASS_LABELS[zc]}</span>
          </div>
          ${mLvl !== 'unknown' ? `<div class="locdet-legend-item">
            <span class="locdet-legend-lbl">Маскарад</span>
            <span class="badge badge-masq-${mLvl}">${MASQ_BADGE_LABELS[mLvl]}</span>
          </div>` : ''}
        </div>
      </div>
      <div class="cdet-tab-bar">
        <button class="cdet-tab active" data-tab="meta">Метаданные</button>
        <button class="cdet-tab" data-tab="atm">Атмосфера</button>
        <button class="cdet-tab" data-tab="vtm">VtM</button>
        <button class="cdet-tab" data-tab="keys">Ключевые точки</button>
        <button class="cdet-tab" data-tab="hooks">Крючки</button>
        ${promptTab}
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="meta">${metaHtml}</div>
        <div class="cdet-panel" data-panel="atm">${atmHtml}</div>
        <div class="cdet-panel" data-panel="vtm">${vtmHtml}</div>
        <div class="cdet-panel" data-panel="keys">${keyPointsHtml}</div>
        <div class="cdet-panel" data-panel="hooks">${hooksHtml}</div>
        ${promptPanel}
      </div>
    </div>`;

  document.getElementById('loc-detail-modal').classList.add('open');
}

// Location card clicks
document.getElementById('locs-grid').addEventListener('click', e => {
  const card = e.target.closest('.loc-card[data-slug]');
  if (card) openLocDetail(card.dataset.slug);
});

// Location filter events
document.getElementById('loc-search').addEventListener('input', e => {
  STATE.locFilter.search = e.target.value;
  if (STATE.locations.length) renderLocations();
});
document.getElementById('loc-filter-zone').addEventListener('change', e => {
  STATE.locFilter.zone = e.target.value;
  if (STATE.locations.length) renderLocations();
});
document.getElementById('loc-filter-district').addEventListener('change', e => {
  STATE.locFilter.district = e.target.value;
  if (STATE.locations.length) renderLocations();
});
document.getElementById('loc-filter-masq').addEventListener('change', e => {
  STATE.locFilter.masq = e.target.value;
  if (STATE.locations.length) renderLocations();
});

// Location modal close
const locDetailModal = document.getElementById('loc-detail-modal');
document.getElementById('loc-detail-close').addEventListener('click', () => locDetailModal.classList.remove('open'));
locDetailModal.addEventListener('click', e => { if (e.target === locDetailModal) locDetailModal.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') locDetailModal.classList.remove('open'); });

// Tab switching in location modal (same logic as char modal)
document.getElementById('loc-detail-content').addEventListener('click', e => {
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

// ═══════════════════════════════════════════════════════════════
// Create Character Modal
// ═══════════════════════════════════════════════════════════════

const VAMPIRE_CLANS = [
  // 13 канонических кланов V20
  'Асамиты', 'Бруха', 'Вентру', 'Гэнгрел', 'Джованни',
  'Ласомбра', 'Малкавиан', 'Носферату', 'Равнос',
  'Последователи Сета', 'Тореадор', 'Тремер', 'Тзимище',
  // Кровные линии
  'Баали', 'Дочери Какофонии', 'Кападокийцы', 'Нагараджа',
  'Салубри', 'Самеди', 'Серпанты Света',
];

const VAMPIRE_SECTS = [
  'Камарилья', 'Анархи', 'Шабаш', 'Независимый',
];

const LINEAGE_DEFS = {
  vampire:  { label:'🧛 Вампир',          type:'vampire',
    fields:[
      { param:'Name', label:'Имя',    required:true, placeholder:'Граф Лейрок' },
      { param:'Clan', label:'Клан',   options:VAMPIRE_CLANS, placeholder:'Выберите или введите...' },
      { param:'Sect', label:'Секта',  options:VAMPIRE_SECTS, placeholder:'Выберите или введите...' },
      { param:'Role', label:'Роль',   placeholder:'Примоген, Шериф, Анцилла...' },
    ]},
  mortal:   { label:'🧑 Смертный',         type:'mortal',
    fields:[
      { param:'Name', label:'Имя',                  required:true,  placeholder:'Жан Дюбуа' },
      { param:'Role', label:'Профессия / Роль',                    placeholder:'Полицейский, Журналист...' },
    ]},
  fairy:    { label:'🧚 Фея / Ченджлинг',  type:'fairy',
    fields:[
      { param:'Name', label:'Имя',                  required:true,  placeholder:'Сильвана' },
      { param:'Clan', label:'Раса / Кит',                          placeholder:'Sidhe, Pooka, Sluagh...' },
      { param:'Role', label:'Роль',                               placeholder:'Рыцарь, Лорд, Странник...' },
    ]},
  werewolf: { label:'🐺 Оборотень',        type:'werewolf',
    fields:[
      { param:'Name', label:'Имя',                  required:true,  placeholder:'Буря-в-Ночи' },
      { param:'Clan', label:'Племя',                               placeholder:'Bone Gnawers, Glass Walkers...' },
      { param:'Sect', label:'Аусписий',                           placeholder:'Рагабаш, Тали, Арун...' },
      { param:'Role', label:'Роль',                               placeholder:'Альфа, Разведчик...' },
    ]},
  mage:     { label:'🔮 Маг',             type:'mage',
    fields:[
      { param:'Name', label:'Имя',                  required:true,  placeholder:'Мастер Элиас' },
      { param:'Clan', label:'Традиция / Конвенция',                placeholder:'Verbena, Technocracy...' },
      { param:'Sect', label:'Орден',                              placeholder:'Просветлённые, Объединение...' },
      { param:'Role', label:'Роль',                               placeholder:'Наставник, Агент...' },
    ]},
  hunter:   { label:'🏹 Охотник',         type:'hunter',
    fields:[
      { param:'Name', label:'Имя',                  required:true,  placeholder:'Конрад Вейс' },
      { param:'Clan', label:'Организация',                        placeholder:'Инквизиция, ЦСА...' },
      { param:'Role', label:'Роль',                               placeholder:'Инквизитор, Агент...' },
    ]},
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
      return `
      <div class="form-group">
        <label class="form-label">${escHtml(f.label)}${f.required ? ' *' : ''}</label>
        <input class="form-control" data-param="${f.param}"
          placeholder="${escHtml(f.placeholder || '')}"
          type="text" ${f.required ? 'required' : ''}
          ${listId ? `list="${listId}"` : ''}>
        ${datalist}
      </div>`;
    }).join('');
    showModalStep(2);
    modalFields.querySelector('input').focus();
  });
});

modalSubmit.addEventListener('click', async () => {
  const def = LINEAGE_DEFS[modalLineage];
  const params = { Type: def.type };
  let valid = true;

  modalFields.querySelectorAll('input[data-param]').forEach(inp => {
    const v = inp.value.trim();
    if (inp.required && !v) { inp.style.borderColor = 'var(--crimson)'; valid = false; }
    else { inp.style.borderColor = ''; if (v) params[inp.dataset.param] = v; }
  });
  if (!valid) return;

  modalSubmit.disabled = true;
  modalSubmit.textContent = '⏳ Создаётся...';
  modalOut.style.display = 'block';
  modalOut.className = 'output-area show';
  modalOut.textContent = '';

  const TYPE_TO_LINEAGE = {
    vampire: 'vampires', mortal: 'mortals', fairy: 'fairies',
    werewolf: 'werewolves', mage: 'mages', hunter: 'hunters'
  };
  const lineageFolder = TYPE_TO_LINEAGE[def.type] || 'mortals';
  const npcArgs = [CITY, lineageFolder, params.Name, params.Clan || '', params.Sect || '', params.Role || ''];

  try {
    const r = await fetch('/api/tool/new_npc', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ args: npcArgs })
    });
    const d = await r.json();
    modalOut.textContent = d.output || '(нет вывода)';
    if (d.ok) {
      modalOut.classList.add('ok');
      STATE.graph.inited = false;

      if (modalImgB64) {
        const nameInp = modalFields.querySelector('input[data-param="Name"]');
        const charName = nameInp ? nameInp.value.trim() : null;
        if (charName) {
          try {
            await fetch(`/api/characters/${encodeURIComponent(charName)}/upload-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base64: modalImgB64, ext: modalImgExt })
            });
          } catch { /* не критично */ }
        }
      }

      fetch('/api/characters').then(r => r.json()).then(data => {
        STATE.characters = Array.isArray(data) ? data : [];
        if (STATE.page === 'characters') renderChars();
      }).catch(() => { STATE.characters = []; });
      setTimeout(closeCharModal, 900);
    } else {
      modalSubmit.disabled = false;
      modalSubmit.textContent = 'Создать персонажа';
    }
  } catch(e) {
    modalOut.textContent = 'Ошибка: ' + e.message;
    modalSubmit.disabled = false;
    modalSubmit.textContent = 'Создать персонажа';
  }
});
