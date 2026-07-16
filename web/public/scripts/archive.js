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
  } catch (e) {
    // Swallowed on purpose (callers show whatever list they already have),
    // but log it — a network failure here looks identical to "no characters
    // exist" otherwise (docs/audit/2026-07-09-project-improvement-plan.md P1.7).
    console.error('ensureCharsLoaded:', e);
  }
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
    loadWorldStateForm();
    return;
  }
  if (st.tab === 'lore') {
    sub.textContent = 'Хронология мира · timeline.md';
    loadTimelineForm();
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
      <button class="chron-toggle faction-inf-del" title="Удалить фракцию «${escAttr(f.name)}»" aria-label="Удалить фракцию ${escAttr(f.name)}">🗑</button>
    </div>`).join('');

  panel.innerHTML = `
    <div class="faction-inf-panel">
      <div class="faction-inf-header">
        <span class="faction-inf-title">📊 Влияние фракций</span>
        <div class="faction-inf-add">
          <input type="text" id="faction-inf-add-name" placeholder="Новая фракция" class="chr-form-input">
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

  panel.querySelectorAll('.faction-inf-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.closest('.faction-inf-row').dataset.faction;
      const ok = typeof showConfirm === 'function'
        ? await showConfirm(`Удалить фракцию «${name}» из карты влияний?`, { confirmText: 'Удалить' })
        : window.confirm(`Удалить фракцию «${name}»?`);
      if (!ok) return;
      try {
        const r = await fetch(`/api/factions/influence/${encodeURIComponent(name)}${window.location.search}`,
          { method: 'DELETE' }).then(r => r.json());
        if (!r.ok) throw new Error(r.error || 'Ошибка');
        await loadFactionsInfluence();
      } catch (e) { showToast('Не удалось удалить фракцию: ' + e.message, 'error'); }
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

    // Модуль события — не показываем кнопки «Модуль»/«Финал» и т.п. (ev.links),
    // но используем первую ссылку с известным слагом модуля, чтобы лениво
    // подгрузить финал модуля отдельным блоком при раскрытии подробностей.
    const modLink = (ev.links || []).find(l => l.module);
    const finaleBlock = modLink
      ? `<div class="chron-block-label">📜 Финал модуля</div><div class="chron-finale" data-finale-mod="${escHtml(modLink.module)}">${SPINNER}</div>`
      : '';

    const body = [
      ev.eventsText ? `<div class="chron-block-label">📋 События</div><div class="md-body chron-md">${mdToHtmlBlock(ev.eventsText)}</div>` : '',
      ev.consequences.length ? `<div class="chron-block-label">⚖️ Последствия</div><ul class="chron-list">${ev.consequences.map(c => `<li>${mdInline(c)}</li>`).join('')}</ul>` : '',
      ev.worldChanges.length ? `<div class="chron-block-label">🌍 Изменения мира</div><ul class="chron-list">${ev.worldChanges.map(c => `<li>${mdInline(c)}</li>`).join('')}</ul>` : '',
      finaleBlock,
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

function _cityQS() {
  return window.location.search || '';
}

// ═══════════════════════════════════════════════════════════════
// Хронология мира — структурированная форма (замена raw-textarea для timeline.md)
// ═══════════════════════════════════════════════════════════════

let _timelineData = null; // {intro, legend, epochs} — кэш последнего /structured
let _pendingLinks = [];   // {kind, slug, text}[] — собирается пикером связей в открытой форме строки

async function loadTimelineForm() {
  const el = document.getElementById('chronicle-content');
  el.innerHTML = SPINNER;
  await Promise.all([ensureCharsLoaded(), ensureLocsLoaded()]);
  try {
    _timelineData = await fetch('/api/timeline/structured' + _cityQS()).then(r => r.json());
    el.innerHTML = renderTimelineForm(_timelineData);
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить хронологию</div>';
  }
}

function renderTimelineForm(data) {
  const legendOptions = data.legend.map(l => `<option value="${escHtml(l.symbol)}">${escHtml(l.symbol)} — ${escHtml(l.meaning)}</option>`).join('');
  const epochsHtml = data.epochs.map(ep => `
    <section class="chron-event" data-epoch="${escHtml(ep.heading)}">
      <div class="chron-event-head">
        <div class="chron-event-title">${escHtml(ep.heading)}</div>
        <button class="chron-toggle" data-epoch-del="${escHtml(ep.heading)}" title="Удалить эпоху">🗑</button>
      </div>
      <table class="ws-table"><thead><tr><th>Год</th><th>Тип</th><th>Событие</th><th>Источник</th><th>Связи</th><th></th></tr></thead>
      <tbody>${ep.rows.map((r, i) => `
        <tr data-epoch="${escHtml(ep.heading)}" data-row="${i}">
          <td>${escHtml(r.year)}</td><td>${escHtml(r.type)}</td><td>${mdInline(r.event)}</td>
          <td>${escHtml(r.source)}</td>
          <td>${r.links.map(l => escHtml(l.text)).join(', ')}</td>
          <td><button class="chron-toggle tl-row-edit" data-epoch="${escHtml(ep.heading)}" data-row="${i}">✏</button>
              <button class="chron-toggle tl-row-del" data-epoch="${escHtml(ep.heading)}" data-row="${i}">🗑</button></td>
        </tr>`).join('')}</tbody></table>
      <button class="chron-toggle tl-row-add" data-epoch="${escHtml(ep.heading)}">+ Добавить запись</button>
      <div class="tl-row-form" data-epoch-form="${escHtml(ep.heading)}" hidden></div>
    </section>`).join('');

  return `
    ${epochsHtml}
    <button class="chron-toggle" id="tl-add-epoch">+ Новая эпоха</button>
    <div class="tl-epoch-form" id="tl-new-epoch-form" hidden>
      <input type="text" class="form-control" id="tl-new-epoch-heading" placeholder="Название эпохи">
      <button class="chron-toggle" id="tl-new-epoch-save">Сохранить</button>
    </div>
    <button class="chron-toggle" id="tl-raw-edit-toggle" style="margin-top:20px">✏ Редактировать весь файл</button>
    <div id="tl-raw-edit-container"></div>
    <datalist id="tl-legend-datalist">${legendOptions}</datalist>`;
}

// Форма add/edit одной записи хронологии — переиспользуется и для новой
// строки (row=null), и для правки существующей.
function _timelineRowFormHtml(epochHeading, rowIndex, row) {
  _pendingLinks = (row?.links || []).map(l => ({ kind: l.kind || null, slug: l.slug || null, text: l.text, href: l.href || null }));
  const linkChips = () => _pendingLinks.map((l, i) => `<span class="chron-chip" data-link-idx="${i}">${escHtml(l.text)} <a href="#" class="tl-link-remove" data-idx="${i}">✕</a></span>`).join('');
  return `
    <div class="tl-form-fields">
      <input type="text" class="form-control tl-f-year" placeholder="Год" value="${escHtml(row?.year || '')}">
      <input type="text" class="form-control tl-f-type" list="tl-legend-datalist" placeholder="Тип (эмодзи)" value="${escHtml(row?.type || '')}">
      <textarea class="form-control tl-f-event" placeholder="Событие">${escHtml(row?.event || '')}</textarea>
      <select class="form-control tl-f-source">
        <option value="📚" ${row?.source === '📚' ? 'selected' : ''}>📚 Канон WoD</option>
        <option value="🏙️" ${row?.source === '🏙️' ? 'selected' : ''}>🏙️ Установлено в проекте</option>
        <option value="❓" ${row?.source === '❓' ? 'selected' : ''}>❓ Канон неоднозначен</option>
      </select>
      <div class="tl-f-links">
        <input type="text" class="form-control tl-link-search" placeholder="Персонаж/локация...">
        <div class="tl-link-suggest" hidden></div>
        <div class="tl-link-chips">${linkChips()}</div>
      </div>
      <button class="chron-toggle tl-row-save" data-epoch="${escHtml(epochHeading)}" data-row="${rowIndex ?? ''}">Сохранить</button>
      <button class="chron-toggle tl-row-cancel">Отмена</button>
    </div>`;
}

// Правка существующей строки — форма вставляется прямо ПОД редактируемой
// строкой таблицы (не внизу блока эпохи/секции). Добавление новой строки
// по-прежнему использует контейнер под таблицей.
function _openInlineRowForm(tr, formHtml) {
  const table = tr.closest('table');
  table.querySelectorAll('.tl-inline-form-tr').forEach(x => x.remove());
  const formTr = document.createElement('tr');
  formTr.className = 'tl-inline-form-tr';
  const td = document.createElement('td');
  td.colSpan = tr.children.length;
  td.innerHTML = `<div class="tl-row-form">${formHtml}</div>`;
  formTr.appendChild(td);
  tr.after(formTr);
}

function _renderLinkChipsInto(container) {
  const chipsEl = container.querySelector('.tl-link-chips');
  if (!chipsEl) return;
  chipsEl.innerHTML = _pendingLinks.map((l, i) => `<span class="chron-chip" data-link-idx="${i}">${escHtml(l.text)} <a href="#" class="tl-link-remove" data-idx="${i}">✕</a></span>`).join('');
}

// Пикер связей: ищет по уже загруженным STATE.characters/STATE.locations,
// первые 8 совпадений по имени; выбор добавляет {kind, slug, text} в _pendingLinks.
// Привязан к обоим контейнерам с формами связей: вкладке хронологии
// (#chronicle-content) и модалке быстрого добавления (#timeline-add-modal).
function _tlLinkPickerInput(e) {
  if (!e.target.classList.contains('tl-link-search')) return;
  const q = e.target.value.trim().toLowerCase();
  const suggestEl = e.target.parentElement.querySelector('.tl-link-suggest');
  if (!q) { suggestEl.hidden = true; suggestEl.innerHTML = ''; return; }
  const chars = (STATE.characters || []).filter(c => c.name).map(c => ({ kind: 'character', slug: c.slug, text: c.name }));
  const locs = (STATE.locations || []).filter(l => l.name).map(l => ({ kind: 'location', slug: l.slug, text: l.name }));
  const matches = [...chars, ...locs].filter(x => x.text.toLowerCase().includes(q)).slice(0, 8);
  suggestEl.innerHTML = matches.map((m, i) => `<div class="tl-link-suggest-item" data-kind="${m.kind}" data-slug="${escHtml(m.slug)}" data-text="${escHtml(m.text)}">${m.kind === 'character' ? '👤' : '📍'} ${escHtml(m.text)}</div>`).join('');
  suggestEl.hidden = matches.length === 0;
}
function _tlLinkPickerClick(e) {
  const item = e.target.closest('.tl-link-suggest-item');
  if (item) {
    _pendingLinks.push({ kind: item.dataset.kind, slug: item.dataset.slug, text: item.dataset.text });
    const form = item.closest('.tl-f-links');
    form.querySelector('.tl-link-search').value = '';
    form.querySelector('.tl-link-suggest').hidden = true;
    _renderLinkChipsInto(form);
    return;
  }
  const linkRemove = e.target.closest('.tl-link-remove');
  if (linkRemove) {
    e.preventDefault();
    _pendingLinks.splice(Number(linkRemove.dataset.idx), 1);
    _renderLinkChipsInto(linkRemove.closest('.tl-f-links'));
    return;
  }
}
document.getElementById('chronicle-content').addEventListener('input', _tlLinkPickerInput);
document.getElementById('chronicle-content').addEventListener('click', _tlLinkPickerClick);
document.getElementById('timeline-add-modal').addEventListener('input', _tlLinkPickerInput);
document.getElementById('timeline-add-modal').addEventListener('click', _tlLinkPickerClick);

// ═══════════════════════════════════════════════════════════════
// Быстрое добавление в хронологию мира из финала модуля/хроники
// ═══════════════════════════════════════════════════════════════

let _cityYearCache; // год активного города из /api/cities/summary (undefined = ещё не загружен)

async function _cityYear() {
  if (_cityYearCache !== undefined) return _cityYearCache;
  try {
    const list = await fetch('/api/cities/summary').then(r => r.json());
    const city = new URLSearchParams(window.location.search).get('city') || 'paris';
    _cityYearCache = (list.find(c => c.slug === city) || {}).year || '';
  } catch { _cityYearCache = ''; }
  return _cityYearCache;
}

// Открывает модалку с предзаполненной строкой эпохи.
// prefill = { title, linkText, linkHref } — заголовок модуля/хроники и
// относительная (от archive/timeline.md) ссылка на его файл.
async function openTimelineAddModal(prefill) {
  const body = document.getElementById('timeline-add-body');
  const save = document.getElementById('timeline-add-save');
  body.innerHTML = SPINNER;
  save.style.display = 'none';
  openModal('timeline-add-modal');
  try {
    const [data, year] = await Promise.all([
      fetch('/api/timeline/structured' + _cityQS()).then(r => r.json()),
      _cityYear(), ensureCharsLoaded(), ensureLocsLoaded(),
    ]);
    if (!data.epochs || !data.epochs.length) {
      body.innerHTML = '<div class="cdet-empty">Сначала создайте эпоху на вкладке «Хронология мира».</div>';
      return;
    }
    _pendingLinks = prefill.linkHref
      ? [{ kind: null, slug: null, text: prefill.linkText || prefill.title, href: prefill.linkHref }]
      : [];
    const defType = data.legend.some(l => l.symbol === '🏛️') ? '🏛️' : ((data.legend[0] || {}).symbol || '');
    // Эпоха по умолчанию — последняя «настоящая» (в строках которой Год содержит
    // цифру): в конце файла бывают служебные секции («📎 Связи», шпаргалки),
    // которые парсер тоже отдаёт как эпохи.
    let defEpoch = data.epochs.length - 1;
    for (let i = data.epochs.length - 1; i >= 0; i--) {
      if (data.epochs[i].rows.some(r => /\d/.test(r.year))) { defEpoch = i; break; }
    }
    body.innerHTML = `
      <div class="tl-form-fields">
        <select class="form-control" id="tl-add-epoch-sel">
          ${data.epochs.map((ep, i) => `<option value="${escHtml(ep.heading)}" ${i === defEpoch ? 'selected' : ''}>${escHtml(ep.heading)}</option>`).join('')}
        </select>
        <input type="text" class="form-control tl-f-year" placeholder="Год" value="${escHtml(year)}">
        <select class="form-control tl-f-type">
          ${data.legend.map(l => `<option value="${escHtml(l.symbol)}" ${l.symbol === defType ? 'selected' : ''}>${escHtml(l.symbol)} — ${escHtml(l.meaning)}</option>`).join('')}
        </select>
        <textarea class="form-control tl-f-event" placeholder="Событие">**${escHtml(prefill.title || '')}.** </textarea>
        <select class="form-control tl-f-source">
          <option value="📚">📚 Канон WoD</option>
          <option value="🏙️" selected>🏙️ Установлено в проекте</option>
          <option value="❓">❓ Канон неоднозначен</option>
        </select>
        <div class="tl-f-links">
          <input type="text" class="form-control tl-link-search" placeholder="Персонаж/локация...">
          <div class="tl-link-suggest" hidden></div>
          <div class="tl-link-chips"></div>
        </div>
        <div id="tl-add-error" style="color:var(--accent3)"></div>
      </div>`;
    _renderLinkChipsInto(body.querySelector('.tl-f-links'));
    save.style.display = '';
    const ta = body.querySelector('.tl-f-event');
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  } catch {
    body.innerHTML = '<div class="cdet-empty">⚠ Не удалось загрузить хронологию.</div>';
  }
}

document.getElementById('timeline-add-save').addEventListener('click', async () => {
  const body  = document.getElementById('timeline-add-body');
  const errEl = document.getElementById('tl-add-error');
  const year  = body.querySelector('.tl-f-year').value.trim();
  const event = body.querySelector('.tl-f-event').value.trim();
  if (!year || !event) { errEl.textContent = 'Заполните год и событие.'; return; }
  const heading = document.getElementById('tl-add-epoch-sel').value;
  const btn = document.getElementById('timeline-add-save');
  btn.disabled = true; errEl.textContent = '';
  try {
    const r = await fetch(`/api/timeline/epoch/${encodeURIComponent(heading)}/row${_cityQS()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year, event,
        type: body.querySelector('.tl-f-type').value,
        source: body.querySelector('.tl-f-source').value,
        links: _pendingLinks,
      }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    showToast('Строка добавлена в хронологию мира', 'success');
    closeModal('timeline-add-modal');
  } catch (e) {
    errEl.textContent = 'Ошибка: ' + e.message;
  } finally { btn.disabled = false; }
});
document.getElementById('timeline-add-close').addEventListener('click', () => closeModal('timeline-add-modal'));
document.getElementById('timeline-add-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('timeline-add-modal')) closeModal('timeline-add-modal');
});

// ═══════════════════════════════════════════════════════════════
// Состояние мира — структурированная форма (замена read-only рендера)
// ═══════════════════════════════════════════════════════════════

let _worldStateData = null;

async function loadWorldStateForm() {
  const el = document.getElementById('chronicle-content');
  el.innerHTML = SPINNER;
  try {
    const ws = await fetch('/api/world-state/structured' + _cityQS()).then(r => r.json());
    _worldStateData = ws;
    el.innerHTML = renderWorldStateForm(ws);
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить состояние мира</div>';
  }
}

// Часы угроз (E1): ячейка прогресса «N/M» в секции «⏱️ Часы угроз».
const _WS_CLOCK_RE = /^(\d+)\s*\/\s*(\d+)$/;
function _wsClockCell(row) {
  for (let i = 0; i < row.length; i++) {
    const m = String(row[i]).trim().match(_WS_CLOCK_RE);
    if (m) return { idx: i, n: +m[1], max: +m[2] };
  }
  return null;
}

function renderWorldStateForm(ws) {
  const sectionsHtml = (ws.sections || []).map(s => {
    const isClocks = /часы угроз/i.test(s.heading);
    return `
    <section class="ws-section" data-ws-section="${escHtml(s.heading)}">
      <div class="ws-heading">${escHtml(s.heading)}
        <button class="chron-toggle" data-ws-section-del="${escHtml(s.heading)}" title="Удалить секцию">🗑</button>
      </div>
      <table class="ws-table"><thead><tr>${s.columns.map(c => `<th>${escHtml(c)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${s.rows.map((row, i) => {
        const clock = isClocks ? _wsClockCell(row) : null;
        const full  = clock && clock.n >= clock.max;
        return `
        <tr data-ws-section="${escHtml(s.heading)}" data-row="${i}"${full ? ' class="ws-clock-full"' : ''}>
          ${row.map(c => `<td>${mdInline(c)}</td>`).join('')}
          <td>${clock && !full ? `<button class="chron-toggle ws-clock-tick" data-ws-section="${escHtml(s.heading)}" data-row="${i}" title="Продвинуть часы на один тик">⏱ +1</button>` : ''}${full ? '<span class="ws-clock-hit" title="Часы пробило — угроза разразилась">🔥</span>' : ''}
              <button class="chron-toggle ws-row-edit" data-ws-section="${escHtml(s.heading)}" data-row="${i}">✏</button>
              <button class="chron-toggle ws-row-del" data-ws-section="${escHtml(s.heading)}" data-row="${i}">🗑</button></td>
        </tr>`;
      }).join('')}</tbody></table>
      <button class="chron-toggle ws-row-add" data-ws-section="${escHtml(s.heading)}">+ Строка</button>
      <div class="ws-row-form" data-ws-section-form="${escHtml(s.heading)}" hidden></div>
      <div class="ws-prose ws-note-view">${s.note ? mdInline(s.note) : ''}</div>
      <button class="chron-toggle ws-note-edit" data-ws-section="${escHtml(s.heading)}">✏ Примечание</button>
    </section>`;
  }).join('');

  return `
    <div class="ws-updated">Последнее обновление:
      <input type="text" class="form-control" id="ws-last-update-input" value="${escHtml(ws.lastUpdate || '')}">
      <button class="chron-toggle" id="ws-last-update-save">Сохранить</button>
    </div>
    ${sectionsHtml}
    <button class="chron-toggle" id="ws-add-section">+ Новая секция</button>
    <div class="ws-section-form" id="ws-new-section-form" hidden>
      <input type="text" class="form-control" id="ws-new-section-heading" placeholder="Заголовок секции">
      <input type="text" class="form-control" id="ws-new-section-columns" placeholder="Колонки через запятую">
      <button class="chron-toggle" id="ws-new-section-save">Сохранить</button>
    </div>
    <button class="chron-toggle" id="ws-raw-edit-toggle" style="margin-top:20px">✏ Редактировать блок целиком</button>
    <div id="ws-raw-edit-container"></div>`;
}

function _worldStateRowFormHtml(heading, rowIndex, columns, cells) {
  const fields = columns.map((col, i) => `
    <label class="tl-form-label">${escHtml(col)}<input type="text" class="form-control ws-f-cell" data-col="${i}" value="${escHtml(cells?.[i] || '')}"></label>`).join('');
  return `
    <div class="tl-form-fields">
      ${fields}
      <button class="chron-toggle ws-row-save" data-ws-section="${escHtml(heading)}" data-row="${rowIndex ?? ''}">Сохранить</button>
      <button class="chron-toggle ws-row-cancel">Отмена</button>
    </div>`;
}

// Chronicle tab switching
document.querySelectorAll('.chron-tab').forEach(b => b.addEventListener('click', () => {
  if (!STATE.chronicle) { STATE.chronicle = { data: null, tab: b.dataset.chronTab }; }
  STATE.chronicle.tab = b.dataset.chronTab;
  document.querySelectorAll('.chron-tab').forEach(x => x.classList.toggle('active', x === b));
  if (STATE.chronicle.data) renderChronicle();
}));

// Chronicle delegated clicks: toggle bodies, open char/loc/module,
// Хронология/Состояние мира формы. Ветки tl-*/ws-* стоят ПЕРЕД общей
// `.chron-toggle`-веткой ниже — их кнопки тоже носят класс chron-toggle
// (ради единого стиля), поэтому должны быть проверены первыми.
document.getElementById('chronicle-content').addEventListener('click', e => {
  if (e.target.id === 'tl-add-epoch') {
    document.getElementById('tl-new-epoch-form').hidden = false;
    return;
  }
  if (e.target.id === 'tl-new-epoch-save') {
    const heading = document.getElementById('tl-new-epoch-heading').value.trim();
    if (!heading) { alert('Укажи название эпохи'); return; }
    fetch('/api/timeline/epoch' + _cityQS(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heading }),
    }).then(r => r.json()).then(d => { if (d.error) alert(d.error); loadTimelineForm(); });
    return;
  }
  const epochDel = e.target.closest('[data-epoch-del]');
  if (epochDel) {
    if (!confirm(`Удалить эпоху «${epochDel.dataset.epochDel}»?`)) return;
    fetch(`/api/timeline/epoch/${encodeURIComponent(epochDel.dataset.epochDel)}${_cityQS()}`, { method: 'DELETE' })
      .then(() => loadTimelineForm());
    return;
  }
  const rowAdd = e.target.closest('.tl-row-add');
  if (rowAdd) {
    const container = document.querySelector(`[data-epoch-form="${CSS.escape(rowAdd.dataset.epoch)}"]`);
    container.innerHTML = _timelineRowFormHtml(rowAdd.dataset.epoch, null, null);
    container.hidden = false;
    return;
  }
  const rowEdit = e.target.closest('.tl-row-edit');
  if (rowEdit) {
    const epoch = _timelineData.epochs.find(x => x.heading === rowEdit.dataset.epoch);
    const row = epoch.rows[Number(rowEdit.dataset.row)];
    _openInlineRowForm(rowEdit.closest('tr'),
      _timelineRowFormHtml(rowEdit.dataset.epoch, Number(rowEdit.dataset.row), row));
    return;
  }
  if (e.target.classList.contains('tl-row-cancel')) {
    const inlineTr = e.target.closest('.tl-inline-form-tr');
    if (inlineTr) inlineTr.remove();
    else e.target.closest('.tl-row-form').hidden = true;
    return;
  }
  const rowSave = e.target.closest('.tl-row-save');
  if (rowSave) {
    const form = rowSave.closest('.tl-form-fields');
    const body = JSON.stringify({
      year: form.querySelector('.tl-f-year').value,
      type: form.querySelector('.tl-f-type').value,
      event: form.querySelector('.tl-f-event').value,
      source: form.querySelector('.tl-f-source').value,
      links: _pendingLinks,
    });
    const epoch = encodeURIComponent(rowSave.dataset.epoch);
    const idx = rowSave.dataset.row;
    const url = idx === '' ? `/api/timeline/epoch/${epoch}/row${_cityQS()}` : `/api/timeline/epoch/${epoch}/row/${idx}${_cityQS()}`;
    fetch(url, { method: idx === '' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      .then(r => r.json()).then(d => {
        if (d.error) alert(d.error);
        loadTimelineForm();
      });
    return;
  }
  const rowDel = e.target.closest('.tl-row-del');
  if (rowDel) {
    const epoch = encodeURIComponent(rowDel.dataset.epoch);
    fetch(`/api/timeline/epoch/${epoch}/row/${rowDel.dataset.row}${_cityQS()}`, { method: 'DELETE' })
      .then(r => r.json()).then(d => { if (d.error) alert(d.error); loadTimelineForm(); });
    return;
  }
  if (e.target.id === 'tl-raw-edit-toggle') {
    _loadArchiveEditable('/api/timeline', '/api/timeline', 'tl-raw-edit-container', 'timeline.md не найден');
    return;
  }

  if (e.target.id === 'ws-last-update-save') {
    const text = document.getElementById('ws-last-update-input').value.trim();
    fetch('/api/world-state/last-update' + _cityQS(), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    }).then(() => loadWorldStateForm());
    return;
  }
  if (e.target.id === 'ws-add-section') {
    document.getElementById('ws-new-section-form').hidden = false;
    return;
  }
  if (e.target.id === 'ws-new-section-save') {
    const heading = document.getElementById('ws-new-section-heading').value.trim();
    const columns = document.getElementById('ws-new-section-columns').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!heading || !columns.length) return;
    fetch('/api/world-state/section' + _cityQS(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heading, columns }),
    }).then(r => r.json()).then(d => { if (d.error) alert(d.error); loadWorldStateForm(); });
    return;
  }
  const wsSectionDel = e.target.closest('[data-ws-section-del]');
  if (wsSectionDel) {
    if (!confirm(`Удалить секцию «${wsSectionDel.dataset.wsSectionDel}»?`)) return;
    fetch(`/api/world-state/section/${encodeURIComponent(wsSectionDel.dataset.wsSectionDel)}${_cityQS()}`, { method: 'DELETE' })
      .then(() => loadWorldStateForm());
    return;
  }
  const wsRowAdd = e.target.closest('.ws-row-add');
  if (wsRowAdd) {
    const section = _worldStateData.sections.find(s => s.heading === wsRowAdd.dataset.wsSection);
    const container = document.querySelector(`[data-ws-section-form="${CSS.escape(wsRowAdd.dataset.wsSection)}"]`);
    container.innerHTML = _worldStateRowFormHtml(wsRowAdd.dataset.wsSection, null, section.columns, null);
    container.hidden = false;
    return;
  }
  const wsTick = e.target.closest('.ws-clock-tick');
  if (wsTick) {
    const section = _worldStateData.sections.find(s => s.heading === wsTick.dataset.wsSection);
    const idx = Number(wsTick.dataset.row);
    const cells = section.rows[idx].slice();
    const clock = _wsClockCell(cells);
    if (!clock || clock.n >= clock.max) return;
    cells[clock.idx] = `${clock.n + 1}/${clock.max}`;
    wsTick.disabled = true;
    fetch(`/api/world-state/section/${encodeURIComponent(section.heading)}/row/${idx}${_cityQS()}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cells }),
    }).then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); loadWorldStateForm(); })
      .catch(err => { showToast('Не удалось тикнуть часы: ' + err.message, 'error'); wsTick.disabled = false; });
    return;
  }
  const wsRowEdit = e.target.closest('.ws-row-edit');
  if (wsRowEdit) {
    const section = _worldStateData.sections.find(s => s.heading === wsRowEdit.dataset.wsSection);
    const cells = section.rows[Number(wsRowEdit.dataset.row)];
    _openInlineRowForm(wsRowEdit.closest('tr'),
      _worldStateRowFormHtml(wsRowEdit.dataset.wsSection, Number(wsRowEdit.dataset.row), section.columns, cells));
    return;
  }
  if (e.target.classList.contains('ws-row-cancel')) {
    const inlineTr = e.target.closest('.tl-inline-form-tr');
    if (inlineTr) inlineTr.remove();
    else e.target.closest('.ws-row-form').hidden = true;
    return;
  }
  const wsRowSave = e.target.closest('.ws-row-save');
  if (wsRowSave) {
    const form = wsRowSave.closest('.tl-form-fields');
    const cells = Array.from(form.querySelectorAll('.ws-f-cell'))
      .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col))
      .map(inp => inp.value);
    const section = encodeURIComponent(wsRowSave.dataset.wsSection);
    const idx = wsRowSave.dataset.row;
    const url = idx === '' ? `/api/world-state/section/${section}/row${_cityQS()}` : `/api/world-state/section/${section}/row/${idx}${_cityQS()}`;
    fetch(url, { method: idx === '' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells }) })
      .then(r => r.json()).then(d => { if (d.error) alert(d.error); loadWorldStateForm(); });
    return;
  }
  const wsRowDel = e.target.closest('.ws-row-del');
  if (wsRowDel) {
    const section = encodeURIComponent(wsRowDel.dataset.wsSection);
    fetch(`/api/world-state/section/${section}/row/${wsRowDel.dataset.row}${_cityQS()}`, { method: 'DELETE' })
      .then(r => r.json()).then(d => { if (d.error) alert(d.error); loadWorldStateForm(); });
    return;
  }
  const wsNoteEdit = e.target.closest('.ws-note-edit');
  if (wsNoteEdit) {
    const section = _worldStateData.sections.find(s => s.heading === wsNoteEdit.dataset.wsSection);
    const view = document.querySelector(`[data-ws-section="${CSS.escape(wsNoteEdit.dataset.wsSection)}"] .ws-note-view`);
    view.innerHTML = `<textarea class="form-control ws-f-note">${escHtml(section.note)}</textarea>
      <button class="chron-toggle ws-note-save" data-ws-section="${escHtml(wsNoteEdit.dataset.wsSection)}">Сохранить</button>`;
    return;
  }
  const wsNoteSave = e.target.closest('.ws-note-save');
  if (wsNoteSave) {
    const text = wsNoteSave.parentElement.querySelector('.ws-f-note').value.trim();
    fetch(`/api/world-state/section/${encodeURIComponent(wsNoteSave.dataset.wsSection)}/note${_cityQS()}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    }).then(() => loadWorldStateForm());
    return;
  }
  if (e.target.id === 'ws-raw-edit-toggle') {
    _loadArchiveEditable('/api/world-state/raw', '/api/world-state/raw', 'ws-raw-edit-container', 'Блок «Состояние мира» не найден');
    return;
  }

  const tog = e.target.closest('.chron-toggle');
  if (tog) {
    const body = document.querySelector(`.chron-event-body[data-body="${tog.dataset.id}"]`);
    if (body) {
      const open = body.hasAttribute('hidden');
      if (open) {
        body.removeAttribute('hidden'); tog.textContent = 'Свернуть ▴';
        _loadEventFinale(body);
      } else { body.setAttribute('hidden', ''); tog.textContent = 'Подробнее ▾'; }
    }
    return;
  }
  const cc = e.target.closest('.chip-char');
  if (cc) { openCharDetail(cc.dataset.char); return; }
  const lc = e.target.closest('.chip-loc');
  if (lc) { openLocDetail(lc.dataset.loc); return; }
});

// Финал модуля подгружается один раз, при первом раскрытии подробностей
// события (а не сразу для всех событий хроники — их может быть десятки).
function _loadEventFinale(bodyEl) {
  const finEl = bodyEl.querySelector('.chron-finale[data-finale-mod]');
  if (!finEl || finEl.dataset.loaded) return;
  finEl.dataset.loaded = '1';
  fetch(`/api/modules/${encodeURIComponent(finEl.dataset.finaleMod)}${_cityQS()}`)
    .then(r => r.json())
    .then(d => {
      finEl.innerHTML = d.finale
        ? `<div class="md-body chron-md">${mdToHtmlPlain(d.finale)}</div>
           <button class="chron-toggle tl-finale-to-timeline" data-chr="${escHtml(d.chronicle || '')}" data-mod="${escHtml(finEl.dataset.finaleMod)}" data-title="${escHtml(d.title || '')}">🕰️ В хронологию мира</button>`
        : '<div class="cdet-empty">Финал модуля ещё не написан</div>';
    })
    .catch(() => { finEl.innerHTML = '<div class="cdet-empty">Не удалось загрузить финал модуля</div>'; });
}

// Кнопка «В хронологию мира» из блока финала — делегат на document: блок
// рендерится и в #chronicle-content (события хроники), и в #chr-detail-body
// (модалка хроники), класс уникальный.
document.addEventListener('click', e => {
  const btn = e.target.closest('.tl-finale-to-timeline');
  if (!btn) return;
  const { chr, mod, title } = btn.dataset;
  openTimelineAddModal({
    title: title || mod, linkText: title || mod,
    linkHref: chr ? `../chronicles/${chr}/modules/${mod}/${mod}.md` : null,
  });
});

