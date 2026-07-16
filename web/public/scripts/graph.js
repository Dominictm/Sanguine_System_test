// ═══════════════════════════════════════════════════════════════
// Relationship Graph (D3 v7)
// ═══════════════════════════════════════════════════════════════
// Вынесено из scripts.js (E2.2). Загружается после d3 (index.html) и до
// scripts.js. Ссылается на глобалы, объявленные в scripts.js (STATE,
// LINEAGE_ICONS, LINEAGE_LABELS, STATUS_LABELS, statusLabel) — безопасно,
// т.к. все обращения внутри тел функций (вызываются лениво из navigate()
// после полной загрузки страницы), а не на верхнем уровне модуля.

const REL_COLORS = {
  family:     '#C94040',
  sire:       '#DC143C',
  childe:     '#DC143C',
  ally:       '#4A8FD9',
  enemy:      '#E06000',
  loyalty:    '#B8860B',
  romantic:   '#D06890',
  suspicious: '#9B6BAE',
  acquaintance: '#6FA8A8',
  secret:     '#8A4FB0',
  neutral:    '#555555',
  aggregate:  '#7A6A5A', // ?compact=true — агрегированное ребро между линейками
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
  acquaintance: 'Знакомый',
  secret:     'Тайная связь',
  neutral:    'Нейтральный',
  aggregate:  'Агрегировано',
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
  buildLineageFilter();
}

// ── Фильтр по линейке WoD (фаза G, план 2026-07-16) ────────────────────────────
// Чекбоксы строятся только для линеек, реально присутствующих среди узлов —
// без «Оборотней»/«Магов»/«Охотников» в городе, где таких персонажей нет.
// Все включены по умолчанию; STATE.graph.lineageFilter переживает toggle
// без повторного запроса /api/graph (данные уже загружены, скрываем/показываем
// существующие узлы/связи).
function buildLineageFilter() {
  const present = new Set((STATE.graph.data?.nodes || []).map(n => n.lineage).filter(Boolean));
  const keys = Object.keys(LINEAGE_LABELS).filter(k => present.has(k));
  STATE.graph.lineageFilter = new Set(keys);
  document.getElementById('graph-lineage-filter').innerHTML = keys.map(k => `
    <label class="graph-lineage-chip">
      <input type="checkbox" data-lineage-filter="${k}" checked>
      ${LINEAGE_LABELS[k]}
    </label>`).join('');
}

// Ребро видимо только если видимы ОБА конца — иначе связь «в никуда» повисает на экране.
function applyLineageFilter() {
  const nodeG = STATE.graph.nodes, link = STATE.graph.links;
  if (!nodeG || !link) return;
  const active = STATE.graph.lineageFilter;
  nodeG.style('display', d => active.has(d.lineage) ? null : 'none');
  link.style('display', l => (active.has(l.source.lineage) && active.has(l.target.lineage)) ? null : 'none');
}

document.getElementById('graph-lineage-filter').addEventListener('change', e => {
  const cb = e.target.closest('[data-lineage-filter]');
  if (!cb) return;
  const key = cb.dataset.lineageFilter;
  if (cb.checked) STATE.graph.lineageFilter.add(key);
  else STATE.graph.lineageFilter.delete(key);
  applyLineageFilter();
});

function buildLegend() {
  const types = ['family','sire','ally','enemy','loyalty','acquaintance','secret','neutral'];
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

  // Общий круглый clip для портретов узлов — objectBoundingBox делает его
  // независимым от радиуса конкретного узла (0.5,0.5,0.5 = вписанный круг
  // в любой прямоугольник, к которому применён), один <clipPath> на все узлы.
  defs.append('clipPath').attr('id', 'node-portrait-clip').attr('clipPathUnits', 'objectBoundingBox')
    .append('circle').attr('cx', .5).attr('cy', .5).attr('r', .5);

  // ── Simulation ──
  // Портрет персонажа на узле графа берётся из STATE.characters (загружается
  // в loadGraph перед вызовом renderGraph) — /api/graph отдаёт только связи,
  // без арта, поэтому сопоставляем по имени так же, как showInfoPanel ниже.
  const charByName = new Map((STATE.characters || []).map(c => [c.name, c]));
  const nodes = data.nodes.map(d => ({ ...d, imageUrl: charByName.get(d.id)?.imageUrl || null }));
  const links = data.links.map(d => ({ ...d }));

  const sim = d3.forceSimulation(nodes)
    .force('link',      d3.forceLink(links).id(d => d.id).distance(180).strength(.6))
    .force('charge',    d3.forceManyBody().strength(-320))
    .force('center',    d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(36))
    // Быстрее стабилизация на больших графах (дефолт D3 ≈ 300 тиков до alphaMin);
    // 0.05 укладывается в ~90 тиков вместо ~300.
    .alphaDecay(0.05);

  STATE.graph.sim = sim;

  // Жёсткий предохранитель поверх alphaDecay: alphaTarget при драге узла может
  // держать симуляцию активной дольше расчётного — не даём ей крутиться вечно
  // и жрать CPU, если что-то помешает естественному затуханию.
  const MAX_SIM_TICKS = 400;
  let tickCount = 0;

  // ── Zoom ──
  const g = svg.append('g');
  // Минимальный радиус хит-зоны узла в экранных пикселях — узел должен
  // оставаться удобно кликабельным даже на maximum zoom-out (scaleExtent
  // ниже 1), где видимый node-circle (r=14-18 в SVG-единицах) сжимается
  // до нескольких экранных пикселей и курсор промахивается мимо, попадая
  // на фон/линии вместо узла (это и выглядит как «пропала возможность
  // двигать миниатюры» при отдалении).
  const HIT_MIN_PX = 24;
  const hitRadius = (d, k) => Math.max(r(d), HIT_MIN_PX / k);
  const zoom = d3.zoom().scaleExtent([.2, 4]).on('zoom', e => {
    g.attr('transform', e.transform);
    nodeG.selectAll('circle.node-hit').attr('r', d => hitRadius(d, e.transform.k));
  });
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
      // tickCount сбрасывается на каждый новый драг — иначе счётчик копится
      // между отдельными перетаскиваниями (каждое даёт симуляции пару сотен
      // тиков через alphaTarget) и после 2-3 драгов MAX_SIM_TICKS срабатывает
      // навсегда: sim.stop() останавливает tick-обработчик, который единственный
      // обновляет transform узлов — d.fx/d.fy продолжают меняться при следующем
      // драге, но экран больше не перерисовывается, будто узел «перестал двигаться».
      .on('start', (e, d) => { tickCount = 0; if (!e.active) sim.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  const r = d => d.lineage === 'vampire' ? 18 : d.lineage === 'fairy' ? 16 : 14;

  // Невидимый увеличенный круг под видимым узлом — держит хит-зону перетаскивания
  // на комфортных ~HIT_MIN_PX экранных пикселей на любом уровне зума (см. hitRadius выше).
  nodeG.append('circle')
    .attr('class', 'node-hit')
    .attr('r', d => hitRadius(d, d3.zoomTransform(svgEl).k))
    .attr('fill', 'transparent');

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

  // Портрет персонажа поверх node-circle (обрезан в круг общим clipPath);
  // без арта — прежний эмодзи-фолбэк по линейке.
  nodeG.filter(d => !!d.imageUrl).append('image')
    .attr('class', 'node-portrait')
    .attr('href', d => d.imageUrl)
    .attr('x', d => -r(d)).attr('y', d => -r(d))
    .attr('width', d => r(d) * 2).attr('height', d => r(d) * 2)
    .attr('preserveAspectRatio', 'xMidYMid slice')
    .attr('clip-path', 'url(#node-portrait-clip)')
    .attr('pointer-events', 'none');

  nodeG.filter(d => !d.imageUrl).append('text')
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

    if (++tickCount > MAX_SIM_TICKS) sim.stop();
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
          <div class="rel-type-dot" style="background:${REL_COLORS[type] || 'var(--text3)'}"></div>
          ${escHtml(other)}
        </div>
        <div class="rel-desc">${escHtml(desc)}</div>
      </div>`).join('')
  ).join('');

  const charData = (STATE.characters || []).find(c => c.name === d.id);
  const portraitHtml = charData?.imageUrl
    ? `<img class="info-portrait" src="${charData.imageUrl}" alt="${d.id}">`
    : `<span class="info-lineage-icon">${LINEAGE_ICONS[d.lineage] || '👤'}</span>`;

  const graphStatusLbl = charData ? statusLabel(charData) : (STATUS_LABELS[d.status] || d.status);
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
  // Сброс снимает и фильтр линеек (план 2026-07-16, фаза G).
  document.querySelectorAll('#graph-lineage-filter [data-lineage-filter]').forEach(cb => { cb.checked = true; });
  if (STATE.graph.lineageFilter) {
    Object.keys(LINEAGE_LABELS).forEach(k => STATE.graph.lineageFilter.add(k));
    applyLineageFilter();
  }
});
