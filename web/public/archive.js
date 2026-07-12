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
      ev.eventsText ? `<div class="chron-block-label">📋 События</div><div class="md-body chron-md">${mdToHtmlBlock(ev.eventsText)}</div>` : '',
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

