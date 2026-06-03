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
  selectedNode: null
};

function navigate(page) {
  STATE.page = page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.page').forEach(el =>
    el.classList.toggle('active', el.id === `page-${page}`));

  if (page === 'dashboard')  loadDashboard();
  if (page === 'characters') loadCharacters();
  if (page === 'graph')      loadGraph();
  if (page === 'modules')    loadModules();
  if (page === 'threads')    loadThreads();
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
    const stats = await fetch('/api/status').then(r => r.json());
    document.getElementById('domain-label').innerHTML =
      `<span>${stats.domain || 'Домен'}</span>`;
    renderDashboard(stats, el);
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

  container.innerHTML = `
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
    <div class="integrity-row">${blBadge}</div>`;

  animateValue(document.getElementById('sv-chars'), s.characters || 0);
  animateValue(document.getElementById('sv-active'), s.active || 0);
  animateValue(document.getElementById('sv-modules'), s.modules || 0);
  animateValue(document.getElementById('sv-locations'), s.locations || 0);
  animateValue(document.getElementById('sv-threads'), s.openThreads || 0, 1200);
}

// ═══════════════════════════════════════════════════════════════
// Characters
// ═══════════════════════════════════════════════════════════════

async function loadCharacters() {
  if (STATE.characters.length) { renderChars(); return; }
  document.getElementById('chars-grid').innerHTML =
    '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    const data = await fetch('/api/characters').then(r => r.json());
    STATE.characters = Array.isArray(data) ? data : [];
    renderChars();
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
    const relCount = (c.relationships || []).length;
    const relBadge = relCount ? `<span class="badge" style="color:var(--text3);border-color:rgba(90,80,80,.4)">${relCount} связей</span>` : '';
    const textBlock = `
      <div class="char-name">${escHtml(c.name)}</div>
      <div class="char-clan">${escHtml(c.clan || c.lineageLabel || '—')}</div>
      <div class="char-status-row">${stBadge}</div>
      <div class="char-badges">${linBadge}${relBadge}</div>`;

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
  if (STATE.characters.length) renderChars();
});

document.getElementById('filter-lineage').addEventListener('change', e => {
  STATE.filter.lineage = e.target.value;
  if (STATE.characters.length) renderChars();
});

document.getElementById('filter-status').addEventListener('change', e => {
  STATE.filter.status = e.target.value;
  if (STATE.characters.length) renderChars();
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

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  if (!city || !year) { alert('Укажите город и год'); return; }
  runTool('new_city', { City: city, Year: year, Districts: document.getElementById('city-districts').value },
    'out-new-city', document.getElementById('btn-new-city'));
});

document.getElementById('btn-new-npc').addEventListener('click', () => {
  const name = document.getElementById('npc-name').value.trim();
  if (!name) { alert('Укажите имя НПС'); return; }
  runTool('new_npc', { Name: name, Type: document.getElementById('npc-type').value },
    'out-new-npc', document.getElementById('btn-new-npc'));
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

// ═══════════════════════════════════════════════════════════════
// Modules
// ═══════════════════════════════════════════════════════════════

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
    el.innerHTML = mods.map(m => `
      <div class="module-card">
        <div class="module-title">${escHtml(m.title)}</div>
        ${m.time ? `<div class="module-time">${escHtml(m.time)}</div>` : ''}
        <div class="module-meta">
          ${m.tone   ? `<span class="module-tag">${escHtml(m.tone)}</span>`   : ''}
          ${m.format ? `<span class="module-tag">${escHtml(m.format)}</span>` : ''}
          ${m.type   ? `<span class="module-tag mod-type">${escHtml(m.type)}</span>` : ''}
        </div>
        <div class="module-slug">${escHtml(m.name)}</div>
      </div>`).join('');
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
// Init
// ═══════════════════════════════════════════════════════════════

loadDashboard();

// ═══════════════════════════════════════════════════════════════
// Char Detail Modal
// ═══════════════════════════════════════════════════════════════

const CHAR_FIELD_LABELS = [
  ['clan',        'Клан'],
  ['sect',        'Секта'],
  ['generation',  'Поколение'],
  ['birthYear',   'Год рождения'],
  ['embraceYear', 'Год обращения'],
  ['sire',        'Сир'],
  ['role',        'Роль'],
];

function openCharDetail(name) {
  const c = STATE.characters.find(ch => ch.name === name);
  if (!c) return;

  const icon    = LINEAGE_ICONS[c.lineage] || '👤';
  const stType  = c.statusType || 'unknown';
  const stLbl   = statusLabel(c);

  const fields = CHAR_FIELD_LABELS
    .filter(([k]) => c[k] && c[k] !== '—' && !String(c[k]).includes('⚠️'))
    .map(([k, lbl]) => `<div class="cdet-key">${lbl}</div><div class="cdet-val">${escHtml(c[k])}</div>`)
    .join('');

  const rels = (c.relationships || []).map(r => `
    <div class="cdet-rel">
      <div class="cdet-rel-name">${escHtml(r.target)}</div>
      <div class="cdet-rel-desc">${escHtml(r.description)}</div>
    </div>`).join('');

  const portraitCol = c.imageUrl
    ? `<img class="cdet-portrait-full" src="${c.imageUrl}" alt="${escHtml(c.name)}">`
    : `<div class="cdet-no-portrait">${icon}</div>`;

  document.getElementById('char-detail-content').innerHTML = `
    <div class="cdet-portrait-col">${portraitCol}</div>
    <div class="cdet-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">${escHtml(c.name)}</div>
        <div class="cdet-badges">
          <span class="badge badge-${c.lineage}">${LINEAGE_LABELS[c.lineage] || c.lineage}</span>
          ${stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : ''}
        </div>
        ${c.statusDetails ? `<div class="cdet-status-details">${escHtml(c.statusDetails)}</div>` : ''}
      </div>
      <div class="cdet-scroll-body">
        ${fields ? `<div class="cdet-fields">${fields}</div><div class="cdet-divider"></div>` : ''}
        ${c.biography && !c.biography.includes('⚠️') ? `
          <div class="cdet-section-title">Биография</div>
          <div class="cdet-bio">${escHtml(c.biography)}</div>
          <div class="cdet-divider"></div>` : ''}
        ${c.voice && !c.voice.includes('⚠️') ? `
          <div class="cdet-section-title">Голос</div>
          <div class="cdet-voice">${escHtml(c.voice)}</div>
          <div class="cdet-divider"></div>` : ''}
        ${rels ? `<div class="cdet-section-title">Отношения (${c.relationships.length})</div>${rels}` : ''}
      </div>
    </div>`;

  document.getElementById('char-detail-modal').classList.add('open');
}

document.getElementById('chars-grid').addEventListener('click', e => {
  const card = e.target.closest('.char-card[data-name]');
  if (card) openCharDetail(card.dataset.name);
});

const charDetailModal = document.getElementById('char-detail-modal');
document.getElementById('char-detail-close').addEventListener('click', () => charDetailModal.classList.remove('open'));
charDetailModal.addEventListener('click', e => { if (e.target === charDetailModal) charDetailModal.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') charDetailModal.classList.remove('open'); });

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

  try {
    const r = await fetch('/api/run-tool', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ tool:'new_npc', params })
    });
    const d = await r.json();
    modalOut.textContent = d.output || '(нет вывода)';
    if (d.success) {
      modalOut.classList.add('ok');
      STATE.graph.inited = false;
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
