# Добавление дисциплин/нумина из справочника в лист персонажа — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В модалке редактирования листа персонажа дать возможность добавлять (и удалять) строки дисциплин/психических способностей прямо из существующих справочников (`system/library/disciplines/`, `system/library/psychics/`), а не только руками править markdown листа.

**Architecture:** Чисто фронтенд-доработка `web/public/scripts.js` + `web/public/styles.css`. Бэкенд не меняется — переиспользуются уже существующие `GET /api/library/disciplines` / `GET /api/library/psychics`. Парсер листа (`_parseSheetForEdit`) дополнительно фиксирует границы строк каждой таблицы; сборщик (`_buildEditedSheet`) пересобирает диапазон строк группы из её текущего (возможно изменённого) списка строк вместо точечной правки построчно — один и тот же путь обслуживает правку очков, добавление и удаление.

**Tech Stack:** Vanilla JS (без сборки/фреймворка, как и весь `web/public/`), обычный CSS с токенами проекта.

**Отклонение от спеки** ([`docs/superpowers/specs/2026-07-08-sheet-library-picker-design.md`](../specs/2026-07-08-sheet-library-picker-design.md)): нет отклонений — план реализует дизайн как есть.

---

## Файловая структура

- **Modify:** `web/public/scripts.js` — `_SHEET_EDIT_SECTIONS`, `_parseSheetForEdit`, `_buildEditedSheet`, `_renderSheetEditor`, `openSheetOverlay`, `_ensureSheetOverlay`; новые функции `_makeNewSheetRow`, `_sheetLibraryKind`, `_libraryEntryDesc`, `_prefetchSheetLibraries`, `_renderLibList`, `_rerenderSheetEditor`, `_onSheetAddBtnClick`, `_onSheetLibSearchInput`, `_onSheetLibItemClick`, `_onSheetRowRemoveClick`.
- **Modify:** `web/public/styles.css` — новые классы `.sheet-add-btn`, `.sheet-lib-picker`, `.sheet-lib-search`, `.sheet-lib-list`, `.sheet-lib-item`, `.sheet-lib-item-name`, `.sheet-lib-item-desc`, `.sheet-lib-empty`, `.sheet-row-remove`.

Тестов на уровне модулей для `web/public/scripts.js` в проекте нет (это plain browser script без экспортов; `web/tests/` покрывает бэкенд и e2e через Selenium/CDP) — верификация каждого шага идёт через ручную проверку в браузере скиллом `run-sanguine-web`, как принято для фронтенд-правок в этом проекте (CLAUDE.md, раздел «Веб-интерфейс»).

---

### Task 1: Парсер — границы таблицы группы + раздел «Нумина»

**Files:**
- Modify: `web/public/scripts.js` (строки `_SHEET_EDIT_SECTIONS` и `_parseSheetForEdit`, сейчас ~7407 и ~7423-7448)

- [ ] **Step 1: Расширить регэксп редактируемых секций**

  Заменить:
  ```js
  const _SHEET_EDIT_SECTIONS = /атрибут|способност|преимуществ|дисциплин|предыстор|добродетел|(?<!производные )характеристик/i;
  ```
  на:
  ```js
  const _SHEET_EDIT_SECTIONS = /атрибут|способност|преимуществ|дисциплин|предыстор|добродетел|нумина|(?<!производные )характеристик/i;
  ```

- [ ] **Step 2: Зафиксировать `firstLineIdx`/`lastLineIdx` при разборе группы**

  Заменить:
  ```js
  function _parseSheetForEdit(md) {
    const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
    const groups = [], editable = [];
    let curSection = '', curSub = '', curGroup = null, m;
    const flush = () => { if (curGroup && curGroup.rows.length) groups.push(curGroup); curGroup = null; };
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
  ```
  на:
  ```js
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
  ```

- [ ] **Step 3: Проверить синтаксис**

  Run: `node --check web/public/scripts.js`
  Expected: no output (exit code 0) — файл лишь параллельно проверяется на синтаксис, DOM/browser-only части (`document`, `fetch`) не выполняются, но обязаны валидно парситься.

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/scripts.js
  git commit -m "feat: track table row ranges when parsing sheet for edit, extend editable sections to numina"
  ```

---

### Task 2: Сборщик — добавление/удаление строк через пересборку диапазона

**Files:**
- Modify: `web/public/scripts.js` (блок `_rebuildSheetRow`/`_buildEditedSheet`, сейчас ~7450-7461)

- [ ] **Step 1: Добавить `_makeNewSheetRow` и переписать `_buildEditedSheet`**

  Заменить:
  ```js
  function _rebuildSheetRow(cells, rating, v) {
    const out = cells.slice();
    if (rating.combinedIdx >= 0) out[rating.combinedIdx] = _sheetDots(v) + ' ' + v;
    if (rating.dotsIdx >= 0)     out[rating.dotsIdx]     = _sheetDots(v);
    if (rating.numIdx >= 0)      out[rating.numIdx]      = String(v);
    return '| ' + out.join(' | ') + ' |';
  }
  function _buildEditedSheet(parsed) {
    const lines = parsed.lines.slice();
    for (const r of parsed.editable) lines[r.lineIdx] = _rebuildSheetRow(r.cells, r.rating, r.value);
    return lines.join('\n');
  }
  ```
  на:
  ```js
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
  ```

- [ ] **Step 2: Проверить синтаксис**

  Run: `node --check web/public/scripts.js`
  Expected: no output (exit code 0)

- [ ] **Step 3: Commit**

  ```bash
  git add web/public/scripts.js
  git commit -m "feat: rebuild sheet table ranges wholesale to support add/remove rows"
  ```

---

### Task 3: Хелперы справочника (дисциплины/нумина)

**Files:**
- Modify: `web/public/scripts.js` (вставить новый блок сразу после `_buildEditedSheet`, перед `_dotControl`, сейчас ~7462)

- [ ] **Step 1: Добавить `_sheetLibraryKind`, `_libraryEntryDesc`, `_prefetchSheetLibraries`, `_renderLibList`**

  Найти:
  ```js
  function _dotControl(idx, v) {
  ```
  и вставить непосредственно перед этой функцией:
  ```js
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
  ```

- [ ] **Step 2: Проверить синтаксис**

  Run: `node --check web/public/scripts.js`
  Expected: no output (exit code 0)

- [ ] **Step 3: Commit**

  ```bash
  git add web/public/scripts.js
  git commit -m "feat: add library lookup helpers for sheet discipline/numina picker"
  ```

---

### Task 4: Рендер редактора — кнопка удаления строки + блок «+ Добавить»

**Files:**
- Modify: `web/public/scripts.js` (`_renderSheetEditor`, сейчас ~7468-7478; добавить `_rerenderSheetEditor` сразу за ней)

- [ ] **Step 1: Переписать `_renderSheetEditor`, добавить `_rerenderSheetEditor`**

  Заменить:
  ```js
  function _renderSheetEditor(parsed) {
    if (!parsed.editable.length) return '<div class="cdet-empty">В листе не найдено редактируемых характеристик.</div>';
    return parsed.groups.map(g => {
      const title = [g.section, g.subsection].filter(Boolean).join(' · ');
      const rows = g.rows.map(r => {
        const idx = parsed.editable.indexOf(r);
        return `<div class="sheet-edit-row"><span class="sheet-edit-name">${escHtml(r.name)}</span>${_dotControl(idx, r.value)}</div>`;
      }).join('');
      return `<div class="sheet-edit-group"><div class="sheet-edit-gtitle">${escHtml(title)}</div>${rows}</div>`;
    }).join('');
  }
  ```
  на:
  ```js
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
  ```

- [ ] **Step 2: Проверить синтаксис**

  Run: `node --check web/public/scripts.js`
  Expected: no output (exit code 0)

- [ ] **Step 3: Commit**

  ```bash
  git add web/public/scripts.js
  git commit -m "feat: render remove button and library-add UI in sheet editor groups"
  ```

---

### Task 5: Обработчики событий и подключение в модалке

**Files:**
- Modify: `web/public/scripts.js` (`_ensureSheetOverlay`, сейчас ~7481-7503; `openSheetOverlay`, сейчас ~7515-7542)

- [ ] **Step 1: Расширить делегированные обработчики в `_ensureSheetOverlay`, добавить хендлеры**

  Заменить:
  ```js
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
      if (dot) _onSheetDotClick(dot);
    });
    return ov;
  }
  ```
  на:
  ```js
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
  ```

- [ ] **Step 2: Обновить ветку `edit` в `openSheetOverlay`**

  Заменить:
  ```js
    if (mode === 'edit') {
      _sheetEditState = { ctx, parsed: _parseSheetForEdit(d.content) };
      body.innerHTML = `<div class="sheet-edit">${_renderSheetEditor(_sheetEditState.parsed)}</div>`;
      actions.innerHTML = `<button class="sheet-btn sheet-btn-save" id="sheet-save">💾 Сохранить</button>`;
      ov.querySelector('#sheet-save').addEventListener('click', _saveSheetEdit);
    } else {
  ```
  на:
  ```js
    if (mode === 'edit') {
      _sheetEditState = { ctx, parsed: _parseSheetForEdit(d.content), library: {} };
      await _prefetchSheetLibraries(_sheetEditState);
      body.innerHTML = `<div class="sheet-edit">${_renderSheetEditor(_sheetEditState)}</div>`;
      actions.innerHTML = `<button class="sheet-btn sheet-btn-save" id="sheet-save">💾 Сохранить</button>`;
      ov.querySelector('#sheet-save').addEventListener('click', _saveSheetEdit);
    } else {
  ```

- [ ] **Step 3: Проверить синтаксис**

  Run: `node --check web/public/scripts.js`
  Expected: no output (exit code 0)

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/scripts.js
  git commit -m "feat: wire up add-from-library and remove-row handlers in sheet editor"
  ```

---

### Task 6: Стили

**Files:**
- Modify: `web/public/styles.css` (вставить новый блок сразу после `.sheet-dot-val`, перед комментарием `/* ── Structured V20 sheet (STV2099 blank) ─────────────────────────────────── */`, сейчас ~7372-7380)

- [ ] **Step 1: Добавить CSS**

  Найти:
  ```css
  .sheet-dot-val {
    width: 16px;
    text-align: center;
    font-size: var(--fs-sm);
    color: var(--text2);
    margin-left: 4px;
  }
  ```
  и сразу после закрывающей `}` этого блока вставить:
  ```css

  .sheet-row-remove {
    background: none;
    border: none;
    color: var(--text2);
    cursor: pointer;
    font-size: var(--fs-sm);
    line-height: 1;
    padding: 4px 6px;
    flex-shrink: 0;
  }

  .sheet-row-remove:hover {
    color: var(--c-error);
  }

  .sheet-add-btn {
    display: block;
    width: 100%;
    margin-top: 8px;
    background: rgba(184, 134, 11, 0.08);
    border: 1px dashed rgba(184, 134, 11, 0.4);
    color: var(--gold);
    padding: 7px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--f-heading);
    font-size: var(--fs-2xs);
    letter-spacing: .08em;
    text-transform: uppercase;
    text-align: center;
  }

  .sheet-add-btn:hover {
    border-color: var(--gold);
    background: rgba(184, 134, 11, 0.16);
  }

  .sheet-lib-picker {
    margin-top: 8px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.25);
  }

  .sheet-lib-search {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text);
    font-size: var(--fs-sm);
    padding: 6px 8px;
    margin-bottom: 8px;
  }

  .sheet-lib-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 220px;
    overflow-y: auto;
  }

  .sheet-lib-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 6px 8px;
    cursor: pointer;
    text-align: left;
  }

  .sheet-lib-item:hover {
    background: rgba(184, 134, 11, 0.1);
    border-color: rgba(184, 134, 11, 0.3);
  }

  .sheet-lib-item-name {
    font-size: var(--fs-sm);
    color: var(--text);
  }

  .sheet-lib-item-desc {
    font-size: var(--fs-2xs);
    color: var(--text2);
  }

  .sheet-lib-empty {
    font-size: var(--fs-sm);
    color: var(--text2);
    padding: 6px 0;
  }

  @media (pointer: coarse) {
    .sheet-add-btn { min-height: 44px; }
    .sheet-row-remove { min-height: 44px; min-width: 44px; }
    .sheet-lib-item { min-height: 44px; }
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add web/public/styles.css
  git commit -m "style: add sheet editor library-picker and row-remove styles"
  ```

---

### Task 7: Проверка в браузере (add → save → persisted; remove → save → persisted; откат)

**Files:** нет изменений кода — только верификация и (при необходимости) восстановление тестовых данных.

- [ ] **Step 1: Перезапустить dev-сервер и найти персонажа-вампира с существующим листом**

  ```bash
  curl -s -X POST http://localhost:4295/api/restart
  sleep 2
  curl -s "http://localhost:4295/api/characters?city=balmont" | head -c 2000
  ```
  Выбрать slug любого вампира с существующим листом (`sheet-data` должен вернуть `exists: true`):
  ```bash
  curl -s "http://localhost:4295/api/characters/<slug>/sheet-data?city=balmont"
  ```
  Сохранить исходное содержимое поля `content` в файл в scratchpad — понадобится для отката в конце.

- [ ] **Step 2: Через headless Chrome (skill `run-sanguine-web`) открыть карточку персонажа, вкладку «Лист», режим редактирования**

  Скрипт по рецепту скилла: пропустить онбординг, `navigate('characters')`, кликнуть по `.char-card[data-name="<Имя>"]`, открыть таб `sheet`, нажать «✏ Редактировать» (или сразу вызвать `openSheetOverlay(ctx, 'edit')` из консоли страницы, если так проще дотянуться до контекста).

- [ ] **Step 3: Проверить появление кнопки «+ Добавить из справочника» у группы «Дисциплины», добавить одну запись**

  Через `Runtime.evaluate`: найти `.sheet-add-btn` рядом с группой, чей заголовок содержит «Дисциплины», кликнуть, дождаться появления `.sheet-lib-item`, кликнуть по первому пункту. Проверить: в DOM появилась новая `.sheet-edit-row` с этим названием и одной закрашенной точкой (`.sheet-dot.on` — ровно одна).

- [ ] **Step 4: Сохранить, проверить персистентность**

  Кликнуть `#sheet-save`, дождаться `#sheet-modal-status` со статусом «✓ Сохранено». Затем:
  ```bash
  curl -s "http://localhost:4295/api/characters/<slug>/sheet-data?city=balmont"
  ```
  Убедиться, что добавленное название присутствует в поле `content` в таблице «Дисциплины».

- [ ] **Step 5: Удалить строку через ✕, сохранить, проверить, что её больше нет**

  Открыть лист заново в режиме редактирования (или использовать текущее открытое состояние), кликнуть `.sheet-row-remove` у только что добавленной строки, сохранить, повторно запросить `sheet-data` и убедиться, что добавленное название отсутствует.

- [ ] **Step 6: Восстановить исходное содержимое листа**

  ```bash
  curl -s -X PUT "http://localhost:4295/api/characters/<slug>/sheet?city=balmont" \
    -H "Content-Type: application/json" \
    --data-binary @<путь к сохранённому в Step 1 файлу с обёрткой {"content": ...}>
  ```
  Затем сверить:
  ```bash
  curl -s "http://localhost:4295/api/characters/<slug>/sheet-data?city=balmont"
  ```
  content должен побайтово совпасть с исходным (сохранённым в Step 1). Закрыть headless Chrome через `Browser.close` (см. `run-sanguine-web`, §4 — не `taskkill`).

- [ ] **Step 7: `git status --short` — подтвердить отсутствие незапланированных изменений в `cities/`**

  Только код (`web/public/scripts.js`, `web/public/styles.css`) должен быть в diff предыдущих задач; никаких изменений в `cities/<город>/` быть не должно (лист восстановлен на Step 6).
