// ═══════════════════════════════════════════════════════════════
// Управление связями — «Постоянные» (библиотека) / «Авторские» (агрегация по картам
// персонажей) (2026-08-08, Фаза 1 «Связи и отношения»). Открывается с графа (#btn-reset
// сосед). Не меняет формат хранения связей персонажей — только читает description для
// агрегации «Авторских» и создаёт новые записи библиотеки при «Сделать постоянной».
// ═══════════════════════════════════════════════════════════════

let _relTypesCache = null;   // сброс на invalidateRelTypesCache() после любой записи
let _relTypesFull  = [];     // последний загруженный список — источник для фильтра поиска
let _authoredFull  = [];     // то же для «Авторских связей»

async function ensureRelTypes(force) {
  if (_relTypesCache && !force) return _relTypesCache;
  _relTypesCache = await fetch('/api/library/relation-types').then(r => r.json()).catch(() => []);
  return _relTypesCache;
}
// Граф кеширует данные между заходами (STATE.graph.inited, graph.js) — тот же класс
// устаревания, что уже находили для STATE.characters (Фаза 3). Создание/переименование/
// удаление постоянной связи меняет то, чем красится граф — сбрасываем флаг тем же паттерном,
// что уже используется в проекте после других действий, влияющих на граф (2026-08-08, хвост
// Фазы 1, дизайн-ревью п.2). invalidateRelTypesCache() вызывается на каждую из этих операций
// уже сегодня — второй сброс сюда же, без отдельных точек вызова.
function invalidateRelTypesCache() { _relTypesCache = null; STATE.graph.inited = false; }

function _relItemHtml(t) {
  const actions = t.custom
    ? `<button type="button" class="relmgr-item-edit" data-relmgr-edit="${escAttr(t.slug)}" title="Переименовать" aria-label="Переименовать «${escAttr(t.name)}»">✏</button>
       <button type="button" class="relmgr-item-del" data-relmgr-del="${escAttr(t.slug)}" title="Удалить" aria-label="Удалить «${escAttr(t.name)}»">🗑</button>`
    : '';
  return `
    <div class="relmgr-item" data-relmgr-slug="${escAttr(t.slug)}">
      <div class="rel-type-dot" style="background:${escAttr(t.color)}"></div>
      <span class="relmgr-item-name">${escHtml(t.name)}</span>
      <span class="relmgr-item-actions">${actions}</span>
    </div>`;
}

function _renderPermanentFiltered(query) {
  const q = (query || '').toLowerCase();
  const list = _relTypesFull.filter(t => !q || t.name.toLowerCase().includes(q));
  const box = document.getElementById('relmgr-permanent-list');
  box.innerHTML = list.length ? list.map(_relItemHtml).join('')
    : `<div class="cdet-empty">${_relTypesFull.length ? 'Ничего не найдено.' : 'Список пуст.'}</div>`;
}

async function _renderPermanentList() {
  _relTypesFull = await ensureRelTypes();
  _renderPermanentFiltered(document.getElementById('relmgr-permanent-search')?.value || '');
}

// «Авторские связи» — уникальные КАНДИДАТЫ В ТИП из relationships ВСЕХ персонажей текущего
// города, не совпадающие (точное сравнение, без учёта регистра/пробелов по краям) ни с
// одним именем из «Постоянных» — сознательно точное совпадение, а не подстрока (на графе,
// dashboard.js /api/graph, используется ДРУГОЕ, подстрочное сравнение — там цель «упоминается
// ли слово», здесь — «это ТА ЖЕ формулировка»).
// Кандидат — relType, если он заполнен (Фаза 2: свой, не выбранный из библиотеки тип
// вводится именно в это поле), иначе — description (легаси-связи до field-split, когда поля
// было одно). Description при УЖЕ заполненном relType в кандидаты не идёт — это необязательное
// развёрнутое ПОЯСНЕНИЕ («доверенное лицо, помогает в делах» при типе «Союзник»), не
// альтернативный несформированный тип; без этого любая типизированная связь с непустым
// описанием ложно предлагалась «Сделать постоянной» (QA-отчёт 2026-08-08,
// docs/design/2026-08-08-qa-report-relations-full-series.md, Дефект №1). Но пропускать всю
// связь при непустом relType (как было раньше) — другая крайность: свой relType, набранный
// вручную и не совпадающий ни с одной постоянной связью, вообще переставал попадать в
// «Авторские» (баг, найден пользователем на живых данных 2026-08-08, связь «авпвапав» у
// Игер Пипон).
async function _authoredDescriptions() {
  const types = await ensureRelTypes();
  const permanentNames = new Set(types.map(t => t.name.trim().toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const c of (STATE.characters || [])) {
    for (const r of (c.relationships || [])) {
      const candidate = (r.relType || r.description || '').trim();
      if (!candidate) continue;
      const key = candidate.toLowerCase();
      if (permanentNames.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'ru'));
}

function _renderAuthoredFiltered(query) {
  const q = (query || '').toLowerCase();
  const list = _authoredFull.filter(desc => !q || desc.toLowerCase().includes(q));
  const box = document.getElementById('relmgr-authored-list');
  box.innerHTML = list.length ? list.map(desc => `
    <div class="relmgr-item">
      <span class="relmgr-item-name">${escHtml(desc)}</span>
      <button type="button" class="relmgr-item-promote" data-relmgr-promote="${escAttr(desc)}" aria-label="Сделать «${escAttr(desc)}» постоянной связью">Сделать постоянной</button>
    </div>`).join('')
    : `<div class="cdet-empty">${_authoredFull.length ? 'Ничего не найдено.' : 'Авторских связей не найдено.'}</div>`;
}

async function _renderAuthoredList() {
  _authoredFull = await _authoredDescriptions();
  _renderAuthoredFiltered(document.getElementById('relmgr-authored-search')?.value || '');
}

async function _refreshRelMgr() {
  await Promise.all([_renderPermanentList(), _renderAuthoredList()]);
}

document.getElementById('btn-manage-relations')?.addEventListener('click', async () => {
  invalidateRelTypesCache();
  const permSearch = document.getElementById('relmgr-permanent-search');
  const authSearch = document.getElementById('relmgr-authored-search');
  if (permSearch) permSearch.value = '';
  if (authSearch) authSearch.value = '';
  openModal('relations-manage-modal');
  await _refreshRelMgr();
});
document.getElementById('relmgr-close')?.addEventListener('click', () => closeModal('relations-manage-modal'));

document.getElementById('relmgr-permanent-search')?.addEventListener('input', e => _renderPermanentFiltered(e.target.value));
document.getElementById('relmgr-authored-search')?.addEventListener('input', e => _renderAuthoredFiltered(e.target.value));

document.getElementById('relmgr-add-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('relmgr-new-name');
  const errBox = document.getElementById('relmgr-add-error');
  errBox.style.display = 'none';
  const name = input.value.trim();
  if (!name) return;
  const r = await fetch('/api/library/relation-types', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const d = await r.json();
  if (!r.ok) { errBox.textContent = d.error || 'Не удалось добавить связь'; errBox.style.display = ''; return; }
  input.value = '';
  invalidateRelTypesCache();
  await _refreshRelMgr();
});

// Инлайн-редактирование имени по клику ✏ (не prompt() — третий слой диалога поверх уже
// открытой модалки поверх графа, лишний скачок контекста для правки одного слова; тот же
// паттерн, что вкладка «Информация» карточки персонажа, .cdet-field-input).
function _startInlineEdit(row, slug) {
  const nameEl = row.querySelector('.relmgr-item-name');
  const current = nameEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'relmgr-item-name-input';
  input.value = current;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const next = input.value.trim();
    if (!next || next === current) { await _renderPermanentList(); return; }
    const r = await fetch(`/api/library/relation-types/${encodeURIComponent(slug)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: next }),
    });
    if (!r.ok) { const d = await r.json(); showToast(d.error || 'Не удалось переименовать связь', 'error'); }
    invalidateRelTypesCache();
    await _renderPermanentList();
  };
  const cancel = async () => { if (done) return; done = true; await _renderPermanentList(); };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

document.addEventListener('click', async e => {
  const delBtn = e.target.closest('[data-relmgr-del]');
  if (delBtn) {
    const name = delBtn.closest('.relmgr-item')?.querySelector('.relmgr-item-name')?.textContent || '';
    const ok = await showConfirm(`Удалить связь «${name}» из постоянных?`, { danger: true, confirmText: 'Удалить' });
    if (!ok) return;
    await fetch(`/api/library/relation-types/${encodeURIComponent(delBtn.dataset.relmgrDel)}`, { method: 'DELETE' });
    invalidateRelTypesCache();
    await _refreshRelMgr();
    return;
  }
  const editBtn = e.target.closest('[data-relmgr-edit]');
  if (editBtn) {
    _startInlineEdit(editBtn.closest('.relmgr-item'), editBtn.dataset.relmgrEdit);
    return;
  }
  const promoteBtn = e.target.closest('[data-relmgr-promote]');
  if (promoteBtn) {
    const name = promoteBtn.dataset.relmgrPromote;
    const r = await fetch('/api/library/relation-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const d = await r.json();
    if (!r.ok) { showToast(d.error || 'Не удалось сделать связь постоянной', 'error'); return; }
    invalidateRelTypesCache();
    await _refreshRelMgr();
    return;
  }
});
