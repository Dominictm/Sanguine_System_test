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

// Слаг вкладки (data-belonging-tab) → точное значение поля «Принадлежность»
// в карточке персонажа. 'all' — особый случай, под фильтр не попадает.
// Единый источник для renderChars() и дефолта в модалке «Новый НПС».
const BELONGING_TAB_VALUES = {
  master:   'Персонаж мастера',
  player:   'Персонаж игрока',
  episodic: 'Эпизодический персонаж',
  familiar: 'Фамильяр',
};

// Пустое состояние списка персонажей. Задача — объяснить, как завести запись
// этого типа, а не сообщить «ничего нет».
function emptyCharsState(belonging, lineage, status, search) {
  const narrowed = lineage !== 'all' || status !== 'all' || !!search;
  if (belonging === 'familiar' && !narrowed) {
    return `<div class="chars-empty">
      <div class="chars-empty-title">Реестр фамильяров пуст</div>
      <p class="chars-empty-body">Фамильяр заводится обычной карточкой персонажа. Линейку выбирают по природе существа: <b>Смертный</b> — животное-гуль или дух в зверином теле, <b>Фея / Ченджлинг</b> — химерический спутник. Дальше — «Принадлежность: Фамильяр».</p>
      <p class="chars-empty-hint">Хозяина впишите первым пунктом секции «Отношения» со словом «домитор» или «хозяин» — связь проступит в графе. Кнопка «+ Создать» подставит принадлежность сама.</p>
    </div>`;
  }
  if (narrowed) {
    return `<div class="chars-empty">
      <div class="chars-empty-title">Под этот отбор записей нет</div>
      <p class="chars-empty-body">Архив хранит персонажей, но ни один не отвечает всем условиям сразу.</p>
      <p class="chars-empty-hint">Ослабьте фильтр линейки, статуса или поиск по имени.</p>
    </div>`;
  }
  return `<div class="chars-empty">
    <div class="chars-empty-title">Раздел пока не заполнен</div>
    <p class="chars-empty-body">Ни одна карточка не отмечена этой принадлежностью.</p>
    <p class="chars-empty-hint">Принадлежность правится в карточке персонажа: вкладка «Инфо» → режим редактирования.</p>
  </div>`;
}

const STATE = {
  page: 'dashboard',
  characters: [],
  filter: { lineage: 'all', status: 'all', search: '', belonging: 'all' },
  graph: { data: null, svg: null, zoom: null, sim: null, nodes: null, links: null, inited: false },
  selectedNode: null,
  locations: [],
  locFilter: { zone: 'all', masq: 'all', district: 'all', search: '' },
};

// Переход между разделами — короткий кроссфейд: уходящий раздел доигрывает
// fade-out и только по его animationend раздел переключается на новый
// (который получает свой fade-in). Без этого второй раздел появлялся
// плавно, а первый пропадал мгновенно — переход выглядел рваным.
//
// Направление анимации зависит от типа перехода (см. styles.css — три пары
// keyframes):
// - Между пунктами верхнего меню (.nav-item[data-page]) — горизонтальный
//   слайд, направление берётся из порядка пунктов в меню: переход к пункту
//   правее по списку выглядит как движение «вперёд» (уходит влево, новый
//   въезжает справа), к пункту левее — «назад» (зеркально). Так соседние
//   разделы ощущаются разным движением, а не одним и тем же затемнением.
// - Переходы на служебные детальные страницы вне меню (module/city — открываются
//   кликом по карточке, а не пунктом меню) остаются на исходном вертикальном
//   fade+rise — они не часть горизонтального «ряда» разделов.
// При prefers-reduced-motion или повторном клике по уже открытому разделу —
// переключение мгновенное, без анимации.
const _NAV_ORDER = () => Array.from(document.querySelectorAll('.nav-item[data-page]')).map(el => el.dataset.page);

function navigate(page) {
  const prev = document.querySelector('.page.active');
  const next = document.getElementById(`page-${page}`);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let dir = null; // 'fwd' | 'back' | null (null = стандартный вертикальный fade)
  if (prev) {
    const order = _NAV_ORDER();
    const prevIdx = order.indexOf(prev.id.replace(/^page-/, ''));
    const nextIdx = order.indexOf(page);
    if (prevIdx !== -1 && nextIdx !== -1 && prevIdx !== nextIdx) dir = nextIdx > prevIdx ? 'fwd' : 'back';
  }

  const applyPage = () => {
    STATE.page = page;
    document.querySelectorAll('.nav-item').forEach(el => {
      const on = el.dataset.page === page;
      el.classList.toggle('active', on);
      if (on) el.setAttribute('aria-current', 'page');
      else    el.removeAttribute('aria-current');
    });
    // page-in-fwd/page-in-back снимаются здесь с ВСЕХ разделов (не только с
    // next) перед добавлением нужного варианта — а не по animationend после
    // проигрывания. Снятие класса по animationend роняло специфичность
    // обратно на голое «.page.active» (у него своя, отдельно объявленная
    // анимация page-in) — смена значения animation-name заставляла браузер
    // проиграть её заново, и раздел ещё раз мигал фейдом сразу после слайда.
    document.querySelectorAll('.page.page-in-fwd, .page.page-in-back')
      .forEach(el => el.classList.remove('page-in-fwd', 'page-in-back'));
    document.querySelectorAll('.page').forEach(el =>
      el.classList.toggle('active', el.id === `page-${page}`));
    if (next && dir && !reduced) next.classList.add(dir === 'fwd' ? 'page-in-fwd' : 'page-in-back');

    if (page === 'dashboard')  loadDashboard();
    if (page === 'chronicle')  loadChronicle();
    if (page === 'characters') loadCharacters();
    if (page === 'graph')      loadGraph();
    if (page === 'chronicles-page') loadChroniclesPage();
    if (page === 'modules')         loadModules();
    if (page === 'module')          loadModulePage();
    if (page === 'session')    loadSessionScreen();
    if (page === 'city')       loadCityPage();
    if (page === 'threads')    loadThreads();
    if (page === 'locations')  loadLocations();
    if (page === 'library')    loadLibrary();
    if (page === 'audio-library') loadAudioLibrary();
    if (page === 'factions')   loadFactions();
    if (page === 'rumors')     loadRumors();
    if (page === 'search')     loadSearch();
    if (page === 'city-new')   loadCitiesGrid();
  };

  const outClass = dir === 'fwd' ? 'page-out-fwd' : dir === 'back' ? 'page-out-back' : 'page-out';
  if (prev && next && prev !== next && !reduced) {
    // prev может ещё нести page-in-fwd/page-in-back со своего собственного
    // въезда (снимается только в начале applyPage() СЛЕДУЮЩЕГО перехода,
    // то есть позже, чем нужно здесь). .page.active.page-in-* специфичнее
    // .page.page-out-* (3 класса против 2) — если не снять его сейчас,
    // добавление outClass ничего не меняет в animation-name, animationend
    // не срабатывает, и navigate() дальше не отрабатывает вообще (зависшая
    // навигация после первого клика).
    prev.classList.remove('page-in-fwd', 'page-in-back');
    prev.classList.add(outClass);
    prev.addEventListener('animationend', () => {
      prev.classList.remove(outClass);
      applyPage();
    }, { once: true });
  } else {
    if (prev) prev.classList.remove('page-out', 'page-out-fwd', 'page-out-back');
    applyPage();
  }
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
    const [stats, threads] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/threads' + (window.location.search || '')).then(r => r.json()).catch(() => null),
    ]);
    document.getElementById('domain-label').innerHTML = `<span>${stats.domain || 'Домен'}</span>`;
    renderDashboard(stats, el, threads);
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

function renderDashboard(s, container, threads) {
  // «Висящие нити» — незакрытые нити, дольше всех не двигавшиеся в игровом
  // времени (staleMonths считает сервер от самой свежей нити города).
  const staleThreads = (Array.isArray(threads) ? threads : [])
    .filter(t => (t.status === 'active' || t.status === 'background') && t.staleMonths >= 1)
    .sort((a, b) => b.staleMonths - a.staleMonths)
    .slice(0, 5);
  const ruMonths = n => n % 10 === 1 && n % 100 !== 11 ? 'месяц'
    : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'месяца' : 'месяцев');
  const staleBlock = staleThreads.length ? `
    <div class="dash-stale-threads">
      <div class="dash-stale-title">🧵 Висящие нити</div>
      ${staleThreads.map(t => `
        <button class="dash-stale-row stat-clickable" data-nav="threads" title="${escHtml(t.description || t.title)}">
          <span class="dash-stale-dot ${t.status}"></span>
          <span class="dash-stale-name">${escHtml(t.title)}</span>
          <span class="dash-stale-age">${t.staleMonths} ${ruMonths(t.staleMonths)} без движения</span>
        </button>`).join('')}
    </div>` : '';

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

  // Цифры — читаемым пергаментом (кровь #8B0000 на тёмном давала 1.9:1);
  // цвет линейки сохранён как тонкий маркер у ярлыка (решение пользователя).
  const lineageCards = activeLineages.map(l => `
      <div class="stat-card">
        <div class="stat-label"><span class="stat-lin-dot" style="background:${l.color}"></span>${l.label}</div>
        <div class="stat-value" id="sv-${l.key}">0</div>
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
    ${staleBlock}
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
  const { lineage, status, search, belonging } = STATE.filter;
  let list = STATE.characters;
  if (lineage !== 'all')      list = list.filter(c => c.lineage === lineage);
  if (status  !== 'all')      list = list.filter(c => c.statusType === status);
  if (belonging !== 'all') list = list.filter(c => c.belonging === BELONGING_TAB_VALUES[belonging]);
  if (search)                 list = list.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  document.getElementById('chars-count-label').textContent = `${list.length} персонажей`;

  const grid = document.getElementById('chars-grid');
  if (!list.length) {
    grid.innerHTML = emptyCharsState(belonging, lineage, status, search);
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
  _foundryBulkApplyCardClasses();
}

// ── Bulk Foundry export: selection mode ─────────────────────────────────────
let _foundryBulkMode = false;
const _foundryBulkSelected = new Set();  // slugs

function _foundryBulkSupportedLineages() { return ['vampire', 'mortal']; }

function _foundryBulkApplyCardClasses() {
  for (const card of document.querySelectorAll('.char-card[data-name]')) {
    const name = card.dataset.name;
    const c = STATE.characters.find(x => x.name === name);
    card.classList.remove('fdry-selectable', 'fdry-selected', 'fdry-disabled');
    if (!_foundryBulkMode || !c) continue;
    if (_foundryBulkSupportedLineages().includes(c.lineage)) {
      card.classList.add('fdry-selectable');
      if (_foundryBulkSelected.has(c.slug)) card.classList.add('fdry-selected');
    } else {
      card.classList.add('fdry-disabled');
    }
  }
}

function _foundryBulkUpdateButton() {
  const btn = document.getElementById('btn-export-foundry-bulk');
  const cancelBtn = document.getElementById('btn-export-foundry-cancel');
  if (!btn) return;
  if (!_foundryBulkMode) {
    btn.textContent = '🜏 Экспорт в Foundry';
    if (cancelBtn) cancelBtn.style.display = 'none';
    return;
  }
  const n = _foundryBulkSelected.size;
  btn.textContent = n ? `🜏 Экспортировать (${n})` : '🜏 Выберите персонажей…';
  if (cancelBtn) cancelBtn.style.display = '';
}

function _foundryBulkToggleCard(name) {
  const c = STATE.characters.find(x => x.name === name);
  if (!c || !_foundryBulkSupportedLineages().includes(c.lineage)) return;
  if (_foundryBulkSelected.has(c.slug)) _foundryBulkSelected.delete(c.slug);
  else _foundryBulkSelected.add(c.slug);
  _foundryBulkApplyCardClasses();
  _foundryBulkUpdateButton();
}

async function _foundryBulkDownload() {
  const slugs = Array.from(_foundryBulkSelected);
  try {
    const res = await fetch(`/api/characters/export-foundry-bulk${location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers.get('content-disposition') || '';
    a.download = /filename="([^"]+)"/.exec(cd)?.[1] || 'foundry_export.zip';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast('Ошибка массового экспорта: ' + e.message, 'error');
  }
}

function _foundryBulkExit() {
  _foundryBulkMode = false;
  _foundryBulkSelected.clear();
  _foundryBulkApplyCardClasses();
  _foundryBulkUpdateButton();
}

document.getElementById('btn-export-foundry-bulk')?.addEventListener('click', async e => {
  e.preventDefault();
  if (!_foundryBulkMode) {
    _foundryBulkMode = true;
    _foundryBulkApplyCardClasses();
    _foundryBulkUpdateButton();
    return;
  }
  if (!_foundryBulkSelected.size) return;
  await _foundryBulkDownload();
  _foundryBulkExit();
});
document.getElementById('btn-export-foundry-cancel')?.addEventListener('click', e => {
  e.preventDefault();
  _foundryBulkExit();
});

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

// Все / Эпизодические — переключатель по «Принадлежности» (фаза H).
document.querySelectorAll('[data-belonging-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-belonging-tab]').forEach(b => {
      const isActive = b === btn;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', String(isActive));
    });
    STATE.filter.belonging = btn.dataset.belongingTab;
    if (STATE.characters.length) { renderChars(); _injectGridDims(); }
  });
});

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
    if (tab === 'lib-disciplines') loadLibrary();
    if (tab === 'lib-psychics')    loadPsychicsLibrary();
    if (tab === 'lib-merits')      loadMeritsLibrary('physical');
    if (tab === 'lib-flaws')       loadFlawsLibrary('физические');
    if (tab === 'lib-backgrounds') loadBackgroundsLibrary('general');
  });

  // Merits subtabs (physical/mental/social/supernatural)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.merits-subtab-btn');
    if (!btn) return;
    const cat = btn.dataset.meritCat;
    if (!cat) return;

    const bar = btn.closest('.merits-subtab-bar');
    bar.querySelectorAll('.merits-subtab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadMeritsLibrary(cat);
  });

  // Flaws subtabs (физические/умственные/социальные/сверхъестественные)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.flaws-subtab-btn');
    if (!btn) return;
    const cat = btn.dataset.flawCat;
    if (!cat) return;

    const bar = btn.closest('.flaws-subtab-bar');
    bar.querySelectorAll('.flaws-subtab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadFlawsLibrary(cat);
  });

  // Backgrounds subtabs (general/vampire/ghoul/mage/changeling)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.backgrounds-subtab-btn');
    if (!btn) return;
    const cat = btn.dataset.bgCat;
    if (!cat) return;

    const bar = btn.closest('.backgrounds-subtab-bar');
    bar.querySelectorAll('.backgrounds-subtab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadBackgroundsLibrary(cat);
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
// Сверено с живым списком моделей Google (GET /v1beta/models, 2026-07-16) —
// только текстовые модели генерации прозы, без TTS/image/robotics/preview-шлака.
const GEMINI_MODELS = [
  { id: 'gemini-3.1-pro-preview',   label: 'Gemini 3.1 Pro — новейшее, лучшее качество' },
  { id: 'gemini-3.1-flash-lite',    label: 'Gemini 3.1 Flash Lite — новейшее, быстро и дёшево' },
  { id: 'gemini-2.5-pro',           label: 'Gemini 2.5 Pro — стабильно, сложная проза' },
  { id: 'gemini-2.5-flash',         label: 'Gemini 2.5 Flash — стабильно, быстро и дёшево (по умолчанию)' },
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
        <div class="ais-section-hint">Два вида доступа: обычный API-ключ (Google AI Studio) или Vertex AI (Google Cloud, для организаций/биллинга через GCP). Назначается на функции в «⚡ Назначение провайдеров».</div>

        <div class="ais-field">
          <label class="ais-label">Вид доступа</label>
          <div class="ais-claude-btnrow">
            <label class="ais-feat-prov-btn">
              <input type="radio" name="gemini-auth-type" id="ais-gemini-auth-apikey" value="api-key" ${(orSettings.GEMINI_AUTH_TYPE || 'api-key') === 'api-key' ? 'checked' : ''}>
              <span>API-ключ (AI Studio)</span>
            </label>
            <label class="ais-feat-prov-btn">
              <input type="radio" name="gemini-auth-type" id="ais-gemini-auth-vertex" value="vertex" ${orSettings.GEMINI_AUTH_TYPE === 'vertex' ? 'checked' : ''}>
              <span>Vertex AI (Google Cloud)</span>
            </label>
          </div>
        </div>

        <div id="ais-gemini-apikey-fields">
          <div class="ais-field">
            <label class="ais-label">API Key
              <span class="ais-key-state ${orSettings.hasGeminiKey ? 'ok' : ''}">${orSettings.hasGeminiKey ? '● задан' : '○ не задан'}</span>
            </label>
            <input class="ais-input" id="ais-gemini-key" type="password"
              placeholder="${orSettings.hasGeminiKey ? '•••••• (задан)' : 'AIza...'}"
              autocomplete="new-password">
            <div class="ais-field-hint">Получить: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Оставь пустым — ключ не изменится. Очисти и подтверди — удалить ключ.</div>
          </div>
        </div>

        <div id="ais-gemini-vertex-fields" style="display:none">
          <div class="ais-field">
            <label class="ais-label">Google Cloud Project ID</label>
            <input class="ais-input" id="ais-gemini-project" type="text"
              placeholder="my-project-123456" value="${escAttr(orSettings.GOOGLE_CLOUD_PROJECT || '')}">
          </div>
          <div class="ais-field">
            <label class="ais-label">Регион (location)</label>
            <input class="ais-input" id="ais-gemini-location" type="text"
              placeholder="us-central1" value="${escAttr(orSettings.GOOGLE_CLOUD_LOCATION || '')}">
          </div>
          <div class="ais-field">
            <label class="ais-label">Service Account JSON
              <span class="ais-key-state ${orSettings.hasVertexKeyFile ? 'ok' : ''}">${orSettings.hasVertexKeyFile ? '● задан' : '○ не задан'}</span>
            </label>
            <textarea class="ais-input" id="ais-gemini-vertex-json" rows="4"
              placeholder='${orSettings.hasVertexKeyFile ? '(задан — вставь новый, чтобы заменить)' : '{ "type": "service_account", ... }'}'></textarea>
            <div class="ais-field-hint">Ключ сервисного аккаунта: Google Cloud Console → IAM → Service Accounts → Keys → Add key (JSON). Вставь содержимое файла целиком. Оставь пустым — не изменится.</div>
          </div>
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
  // Переключатель вида доступа — показывает поля своего варианта.
  const _geminiToggleAuthFields = () => {
    const vertex = document.getElementById('ais-gemini-auth-vertex').checked;
    document.getElementById('ais-gemini-apikey-fields').style.display = vertex ? 'none' : '';
    document.getElementById('ais-gemini-vertex-fields').style.display = vertex ? '' : 'none';
  };
  document.getElementById('ais-gemini-auth-apikey').addEventListener('change', _geminiToggleAuthFields);
  document.getElementById('ais-gemini-auth-vertex').addEventListener('change', _geminiToggleAuthFields);
  _geminiToggleAuthFields();

  document.getElementById('ais-gemini-save').addEventListener('click', async () => {
    const btn    = document.getElementById('ais-gemini-save');
    const status = document.getElementById('ais-gemini-status');
    const key    = document.getElementById('ais-gemini-key').value;
    const model  = document.getElementById('ais-gemini-model').value;
    const authType = document.getElementById('ais-gemini-auth-vertex').checked ? 'vertex' : 'api-key';
    const project  = document.getElementById('ais-gemini-project').value.trim();
    const location = document.getElementById('ais-gemini-location').value.trim();
    const vertexJson = document.getElementById('ais-gemini-vertex-json').value;
    btn.disabled = true; btn.textContent = '⏳…';
    status.className = 'ais-status'; status.textContent = '';
    try {
      const body = { restart: true, GEMINI_AUTH_TYPE: authType };
      if (authType === 'vertex') {
        body.GOOGLE_CLOUD_PROJECT = project;
        body.GOOGLE_CLOUD_LOCATION = location;
        if (vertexJson.trim()) body.GEMINI_VERTEX_KEY_JSON = vertexJson;
      } else {
        if (key !== '') body.GEMINI_API_KEY = key;
      }
      if (model) body.GEMINI_MODEL = model;
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
function mdToHtmlBlock(md) {
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
    belonging:   document.getElementById('npc-belonging').value,
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
// Module Detail Modal
// ═══════════════════════════════════════════════════════════════

async function openModuleDetail(name, preferTab) {
  const modal   = document.getElementById('module-detail-modal');
  const content = document.getElementById('module-detail-content');
  content.innerHTML = `<div class="mod-loading">${SPINNER}</div>`;
  openModal('module-detail-modal');

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
        ${tabs.map(t => `<div class="cdet-panel ${t[0] === active ? 'active' : ''}" data-panel="${t[0]}"><div class="md-body">${mdToHtmlBlock(t[2])}</div></div>`).join('')}
      </div>
    </div>`;
}

// Click: "🪄 Сгенерировать сценарий" button in module detail modal
document.getElementById('module-detail-content').addEventListener('click', e => {
  const genBtn = e.target.closest('.mod-gen-scenario-btn');
  if (!genBtn) return;
  const mod = genBtn.dataset.mod;
  const chr = genBtn.dataset.chr || _chrDetailSlug || '';
  closeModal('module-detail-modal');
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
document.getElementById('module-detail-close').addEventListener('click', () => closeModal('module-detail-modal'));
moduleDetailModal.addEventListener('click', e => { if (e.target === moduleDetailModal) closeModal('module-detail-modal'); });

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
    ['want',       'Хочет'],
    ['fear',       'Боится'],
    ['leverage',   'Рычаг'],
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
    ['want',       'Хочет'],
    ['fear',       'Боится'],
    ['leverage',   'Рычаг'],
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
    ['want',       'Хочет'],
    ['fear',       'Боится'],
    ['leverage',   'Рычаг'],
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
    ['want',       'Хочет'],
    ['fear',       'Боится'],
    ['leverage',   'Рычаг'],
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
      closeModal('char-detail-modal');
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
  'Принадлежность': 'К какой хронике, городу или сюжетной линии относится персонаж — постоянный (мастера/игрока), эпизодический или фамильяр.',
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
  openModal('char-modal');
  showModalStep(1);
}
function closeCharModal() {
  closeModal('char-modal');
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
    // «Принадлежность» — общее поле для всех линеек (не входит в per-lineage
    // fields[], иначе пришлось бы дублировать в 6 массивах). Если открыто со
    // вкладки «🎭 Эпизодические» — по умолчанию подставляется «Эпизодический
    // персонаж» (фаза H, план 2026-07-16).
    const belongingDefault = BELONGING_TAB_VALUES[STATE.filter.belonging] || 'Персонаж мастера';
    modalFields.insertAdjacentHTML('beforeend', `
      <div class="form-group">
        <label class="form-label">Принадлежность${fieldTip(CHAR_FIELD_TIPS['Принадлежность'])}</label>
        <select class="form-control" data-param="belonging">
          <option value="Персонаж мастера" ${belongingDefault === 'Персонаж мастера' ? 'selected' : ''}>Персонаж мастера</option>
          <option value="Персонаж игрока" ${belongingDefault === 'Персонаж игрока' ? 'selected' : ''}>Персонаж игрока</option>
          <option value="Эпизодический персонаж" ${belongingDefault === 'Эпизодический персонаж' ? 'selected' : ''}>Эпизодический персонаж</option>
          <option value="Фамильяр" ${belongingDefault === 'Фамильяр' ? 'selected' : ''}>Фамильяр</option>
        </select>
      </div>`);
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
        belonging: params.belonging || '',
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
      const npcArgs = [CITY, folder, params.Name, params.Gender, params.Clan || '', params.Sect || '', params.Role || '', params.belonging || ''];
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

// Location Edit/Create Modal + Module Locations Panel moved to public/locations.js (E2.3).
// Onboarding tour moved to public/tour.js (E2.4).
