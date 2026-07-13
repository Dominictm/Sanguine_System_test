# «Добавить в хронологию мира» из финала — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task (inline, без субагентов — по решению
> пользователя). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** итог модуля/хроники заносится в `archive/timeline.md` из предзаполненной
модалки в один клик (спека `docs/superpowers/specs/2026-07-13-finale-to-timeline-design.md`).

**Architecture:** общая модалка `#timeline-add-modal` (логика в
`web/public/scripts/archive.js`, переиспользует классы/пикер форм хронологии);
три кнопки-входа; запись через существующий `POST /api/timeline/epoch/:heading/row`.

**Tech Stack:** Express, vanilla JS (classic scripts, общий глобальный скоуп),
Node test runner (`npm run test:unit` из `web/`).

**Отклонение от спеки (найден баг):** сервер `_resolveTimelineLink`
(`web/routes/archive.js:25`) отбрасывает связи без `kind: character|location`,
а парсер отдаёт связи как `{text, href}` без kind — поэтому **правка любой
существующей строки хронологии через форму молча теряет её связи**. Задача 1
чинит это pass-through'ом готовых `{text, href}` (то же нужно для предзаполненной
ссылки на модуль). Спека дополняется примечанием.

---

### Task 1: Server — pass-through сырых ссылок + фикс потери связей при правке

**Files:**
- Modify: `web/routes/archive.js:25` (`_resolveTimelineLink`)
- Modify: `web/public/scripts/archive.js:807` (`_timelineRowFormHtml` — сохранить `href`)
- Modify: `docs/superpowers/specs/2026-07-13-finale-to-timeline-design.md` (примечание)
- Test: `web/tests/all.test.js` — в `describe('Timeline structured — CRUD', ...)`

- [ ] **Step 1: Написать падающий тест** (в существующий describe, стиль соседних):

```js
it('POST/PUT row: сырые ссылки {text, href} проходят без kind (и не теряются при правке)', async () => {
  const heading = /* заголовок первой эпохи из structured GET, как в соседних тестах */;
  const add = await fetch(`${BASE}/api/timeline/epoch/${encodeURIComponent(heading)}/row?city=paris`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: '2010', type: '🏛️', event: '__RAW_LINK_TEST__',
      links: [{ text: 'Модуль-тест', href: '../chronicles/x/modules/y/y.md' }] }),
  });
  assert.equal(add.status, 200);
  let data = await (await fetch(`${BASE}/api/timeline/structured?city=paris`)).json();
  let ep = data.epochs.find(e => e.heading === heading);
  let idx = ep.rows.findIndex(r => r.event.includes('__RAW_LINK_TEST__'));
  assert.deepEqual(ep.rows[idx].links, [{ text: 'Модуль-тест', href: '../chronicles/x/modules/y/y.md' }]);
  // PUT той же строки с теми же links (как их отдаёт парсер) — связи не должны пропасть
  const upd = await fetch(`${BASE}/api/timeline/epoch/${encodeURIComponent(heading)}/row/${idx}?city=paris`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...ep.rows[idx], event: '__RAW_LINK_TEST__ upd', links: ep.rows[idx].links }),
  });
  assert.equal(upd.status, 200);
  data = await (await fetch(`${BASE}/api/timeline/structured?city=paris`)).json();
  ep = data.epochs.find(e => e.heading === heading);
  assert.equal(ep.rows[idx].links.length, 1);
  // cleanup: DELETE строки (before/after describe уже восстанавливает файл — по образцу соседей)
});
```

(Точная форма — по соседним тестам блока: там уже есть хелперы/backup файла.)

- [ ] **Step 2: Прогнать — тест падает** (`links` пустой после POST).
- [ ] **Step 3: Минимальная реализация** — `web/routes/archive.js`:

```js
async function _resolveTimelineLink(city, l) {
  const { kind, slug } = l || {};
  if (kind === 'character') { /* как было */ }
  if (kind === 'location')  { /* как было */ }
  // Готовая ссылка (модуль/хроника/журнал/правка существующей строки) — как есть.
  if (l && l.text && l.href) return { text: String(l.text), href: String(l.href) };
  return null;
}
```

- [ ] **Step 4: Клиент** — `archive.js:807`, `_timelineRowFormHtml`:

```js
_pendingLinks = (row?.links || []).map(l => ({ kind: l.kind || null, slug: l.slug || null, text: l.text, href: l.href || null }));
```

(Пикер добавляет `{kind, slug, text}` без href — сервер резолвит по kind, как раньше.)

- [ ] **Step 5: Тесты зелёные**, `git checkout -- web/tests/report.html`, `git diff cities/` пуст.
- [ ] **Step 6: Дописать в спеку** раздел «Что НЕ делается» → примечание об этой правке. Commit:
      `fix: timeline row edit dropped raw {text,href} links; pass them through`

---

### Task 2: Модалка `#timeline-add-modal` + `openTimelineAddModal(prefill)`

**Files:**
- Modify: `web/public/index.html` (после `#finale-preview-modal`, ~строка 550)
- Modify: `web/public/scripts/archive.js` (после блока пикера связей, ~строка 866)
- Modify: `web/public/styles.css` — только если существующих классов не хватит (ожидаемо хватит)

- [ ] **Step 1: HTML модалки** (по образцу `#finale-preview-modal`; классы кнопок —
      сверить с реально существующими `chr-modal-btn` вариантами):

```html
    <!-- Быстрое добавление итога модуля/хроники в хронологию мира -->
    <div id="timeline-add-modal" class="chr-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="timeline-add-title">
      <div class="chr-modal" style="max-width:640px">
        <div class="chr-modal-title" id="timeline-add-title">🕰️ В хронологию мира</div>
        <div id="timeline-add-body" class="chr-modal-body"></div>
        <div class="chr-modal-actions">
          <button id="timeline-add-save" class="chr-modal-btn">Сохранить</button>
          <button id="timeline-add-close" class="chr-modal-btn cancel">Закрыть</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Логика в `archive.js`** (новая секция после пикера связей):

```js
// ═══ Быстрое добавление в хронологию мира из финала модуля/хроники ═══

let _tlAddData = null;      // {epochs, legend} на время открытой модалки
let _cityYearCache;         // год активного города из /api/cities/summary

async function _cityYear() {
  if (_cityYearCache !== undefined) return _cityYearCache;
  try {
    const list = await fetch('/api/cities/summary').then(r => r.json());
    const city = new URLSearchParams(window.location.search).get('city') || 'paris';
    _cityYearCache = (list.find(c => c.slug === city) || {}).year || '';
  } catch { _cityYearCache = ''; }
  return _cityYearCache;
}

// prefill = { title, linkText, linkHref } (см. спеку)
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
    _tlAddData = data;
    if (!data.epochs.length) {
      body.innerHTML = '<div class="cdet-empty">Сначала создайте эпоху на вкладке «Хронология мира».</div>';
      return;
    }
    _pendingLinks = prefill.linkHref
      ? [{ kind: null, slug: null, text: prefill.linkText || prefill.title, href: prefill.linkHref }]
      : [];
    const defType = data.legend.some(l => l.symbol === '🏛️') ? '🏛️' : (data.legend[0]?.symbol || '');
    body.innerHTML = `
      <div class="tl-form-fields">
        <select class="form-control" id="tl-add-epoch-sel">
          ${data.epochs.map((ep, i) => `<option value="${escHtml(ep.heading)}" ${i === data.epochs.length - 1 ? 'selected' : ''}>${escHtml(ep.heading)}</option>`).join('')}
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
```

- [ ] **Step 3: Пикер связей в модалке** — извлечь тела двух существующих
      анонимных слушателей `#chronicle-content` (`input` ~837 и `click` ~848,
      только пикерная часть) в именованные `_tlLinkPickerInput(e)` /
      `_tlLinkPickerClick(e)` и привязать к **обоим** контейнерам
      (`#chronicle-content` и `#timeline-add-modal`). Поведение на вкладке
      хронологии не меняется (те же тела функций).
- [ ] **Step 4: `node --check web/public/scripts/archive.js`**; тесты зелёные
      (source-guard'ы не сломаны). Commit:
      `feat: timeline quick-add modal (openTimelineAddModal)`

---

### Task 3: Три кнопки-входа

**Files:**
- Modify: `web/public/index.html:546-548` (`#finale-preview-modal` actions), `:323-327` (`.chr-detail-header-btns`)
- Modify: `web/public/scripts/modules.js:933-959` (`openFinalePreview`), обработчик у `openChrDetail`
- Modify: `web/public/scripts/archive.js:1125-1140` (`_loadEventFinale`)

- [ ] **Step 1: Модалка «📜 Финал»** — в actions перед «Закрыть»:

```html
<button id="finale-preview-to-timeline" class="chr-modal-btn" style="display:none">🕰️ В хронологию</button>
```

В `openFinalePreview` после успешной загрузки (`data.finale` есть):

```js
const tlBtn = document.getElementById('finale-preview-to-timeline');
tlBtn.style.display = data.finale ? '' : 'none';
tlBtn.dataset.chr = chr; tlBtn.dataset.mod = mod; tlBtn.dataset.title = data.title || mod;
```

(и `style.display='none'` в начале функции и в catch). Обработчик рядом с
`finale-preview-close`:

```js
document.getElementById('finale-preview-to-timeline').addEventListener('click', e => {
  const { chr, mod, title } = e.currentTarget.dataset;
  closeModal('finale-preview-modal');
  openTimelineAddModal({ title, linkText: title, linkHref: `../chronicles/${chr}/modules/${mod}/${mod}.md` });
});
```

- [ ] **Step 2: Блок финала в раскрытом событии** — `_loadEventFinale`
      (archive.js): при `d.finale` дописать после текста кнопку

```js
`<button class="chron-toggle tl-finale-to-timeline" data-chr="${escHtml(d.chronicle || '')}" data-mod="${escHtml(finEl.dataset.finaleMod)}" data-title="${escHtml(d.title || '')}">🕰️ В хронологию мира</button>`
```

Клик — **делегат на `document`** (блок рендерится и в `#chronicle-content`,
и в `#chr-detail-body` модалки хроники; класс уникальный):

```js
document.addEventListener('click', e => {
  const btn = e.target.closest('.tl-finale-to-timeline');
  if (!btn) return;
  const { chr, mod, title } = btn.dataset;
  openTimelineAddModal({ title: title || mod, linkText: title || mod,
    linkHref: chr ? `../chronicles/${chr}/modules/${mod}/${mod}.md` : null });
});
```

- [ ] **Step 3: Шапка модалки хроники** — в `.chr-detail-header-btns` перед «Директором»:

```html
<button class="chd-dir-btn" id="chd-to-timeline" title="Добавить итог хроники в хронологию мира">🕰️ В хронологию</button>
```

Обработчик в modules.js (рядом с другими chr-detail-обработчиками):

```js
document.getElementById('chd-to-timeline').addEventListener('click', () => {
  if (!_chrDetailSlug) return;
  openTimelineAddModal({
    title: _chrDetailDisplay || _chrDetailSlug,
    linkText: _chrDetailDisplay || _chrDetailSlug,
    linkHref: `../chronicles/${_chrDetailSlug}/chronicle.md`,
  });
});
```

- [ ] **Step 4:** `node --check` обоих файлов; тесты зелёные. Commit:
      `feat: «В хронологию мира» из финала модуля/хроники (3 точки входа)`

---

### Task 4: Живая проверка (CDP) и финал

- [ ] **Step 1:** по `.claude/skills/run-sanguine-web`: рестарт сервера, headless
      Chrome, скип тура. Сценарий: открыть хронику → бейдж «📜 Финал» модуля →
      кнопка видна → модалка предзаполнена (эпоха последняя, год города, тип,
      `**<title>.** `, чип-ссылка на модуль) → сохранить `__CDP_TEST__`-строку →
      `GET /api/timeline/structured` содержит строку со ссылкой на модуль.
- [ ] **Step 2:** те же проверки открытия модалки из раскрытого события и из
      шапки хроники (без повторного сохранения).
- [ ] **Step 3:** проверить правку существующей строки с сырой ссылкой на
      вкладке «Хронология мира» — связи не пропадают (регресс-проверка Task 1).
- [ ] **Step 4:** `Browser.close`; откат тестовых данных (`git checkout` по
      `cities/paris/archive/timeline.md`), `git diff cities/` пуст (кроме двух
      известных файлов персонажей); полный `npm run test:unit` зелёный;
      `git checkout -- web/tests/report.html`.
- [ ] **Step 5:** статус-отчёт не обязателен (малая фаза); при находках — зафиксировать.
