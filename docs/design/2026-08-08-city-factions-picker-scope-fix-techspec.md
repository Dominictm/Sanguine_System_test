# Техспека: скоуп-фикс дублирующихся id пикеров фракций города

**Роль:** Системный аналитик · **Дата:** 2026-08-08
**Источник:** [2026-08-08-city-factions-picker-scope-fix-analysis.md](2026-08-08-city-factions-picker-scope-fix-analysis.md)
(Аналитик) — по мотивам Дефекта №1 из
[QA-отчёта](2026-08-08-qa-report-faction-dedup-multi-title.md) (Тестировщик).

Файл правок — один: `web/public/scripts/city.js`. Все изменения — протягивание параметра `root`
через уже существующие функции пикера фракций (без изменения markup, без новых id/классов —
обе точки скоупинга, `#city-factions-editor` и `#city-factions-edit`, уже существуют в разметке,
см. анализ §«Ключевой инсайт»).

---

## §1. Новый хелпер — `_factionPickerRoot(el)`

Добавить непосредственно перед `_factionAlreadyAdded` (текущая строка 749):

```js
// Скоуп-фикс (2026-08-08, дефект №1 QA-отчёта 2026-08-08-qa-report-faction-dedup-multi-title.md):
// _cityFactionsEditorHtml рендерится в ДВУХ независимых, одновременно живущих в DOM местах —
// #city-factions-editor (форма создания города, index.html:971) и #city-factions-edit (вкладка
// «Фракции» текущего города, _cityTabPanelHtml → id="city-${tab}-edit") — с одинаковыми id
// панелей-пикеров внутри. Без скоупинга document.getElementById/querySelector всегда попадали
// бы в первый по DOM-порядку экземпляр, не в тот, что реально видит пользователь — тот же класс
// проблемы, что уже решён для _collectFactions(root)/_currentFactionNames(root) в этом файле,
// просто пикер при добавлении не унаследовал эту конвенцию. Фолбэк на document — для
// единообразия с этими двумя функциями и на случай, если el вообще не внутри одного из двух
// хостов (в норме не должно происходить, но не должно и падать).
function _factionPickerRoot(el) {
  return el.closest('#city-factions-edit, #city-factions-editor') || document;
}
```

## §2. `_factionAlreadyAdded` — добавить параметр `root`

Было (строки 753-762):
```js
function _factionAlreadyAdded(which) {
  if (which === 'sects' || which === 'clans') {
    return new Set(Array.from(
      document.querySelectorAll(`.cdet-faction-chips[data-faction-group="${which}"] .cdet-faction-chip`)
    ).map(b => b.dataset.faction));
  }
  const field = which === 'mortal' ? 'factions-mortal-list' : 'factions-state-list';
  const ta = document.querySelector(`[data-city-field="${field}"]`);
  return new Set((ta?.value || '').split('\n').map(l => l.trim()).filter(Boolean));
}
```

Стало:
```js
function _factionAlreadyAdded(which, root) {
  const scope = root || document;
  if (which === 'sects' || which === 'clans') {
    return new Set(Array.from(
      scope.querySelectorAll(`.cdet-faction-chips[data-faction-group="${which}"] .cdet-faction-chip`)
    ).map(b => b.dataset.faction));
  }
  const field = which === 'mortal' ? 'factions-mortal-list' : 'factions-state-list';
  const ta = scope.querySelector(`[data-city-field="${field}"]`);
  return new Set((ta?.value || '').split('\n').map(l => l.trim()).filter(Boolean));
}
```

## §3. `_renderFactionPickerList` — добавить параметр `root`, все `document.*` → `scope.*`

Было (строки 776-808):
```js
async function _renderFactionPickerList(which, query) {
  const q = (query || '').toLowerCase();
  const added = _factionAlreadyAdded(which);
  const itemHtml = r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`;
  if (which === 'sects') {
    await ensureSects();
    const pool = (_sectsCache || []).filter(s => !added.has(s.name));
    const list = pool.filter(s => !q || s.name.toLowerCase().includes(q));
    document.getElementById('cdet-faction-sects-list').innerHTML = list.map(itemHtml).join('') || _factionEmptyHtml(pool);
  } else if (which === 'clans') {
    await ensureClans();
    const pool = (_clansCache || []).filter(c => c.sect === 'Независимые' && !added.has(c.name));
    const list = pool.filter(c => !q || c.name.toLowerCase().includes(q));
    document.getElementById('cdet-faction-clans-list').innerHTML = list.map(itemHtml).join('') || _factionEmptyHtml(pool);
  } else if (which === 'mortal') {
    const groups = ['religious', 'crime', 'civic'];
    await Promise.all(groups.map(ensureMortLib));
    for (const g of groups) {
      const full = _mortLibCache.get(g) || [];
      const pool = full.filter(r => !added.has(r.name));
      const list = pool.filter(r => !q || r.name.toLowerCase().includes(q));
      const groupEl = document.querySelector(`#cdet-faction-mortal-picker .cdet-lib-picker-group[data-group="${g}"]`);
      if (groupEl) groupEl.style.display = full.length ? '' : 'none';
      const listEl = document.getElementById(`cdet-faction-mortal-list-${g}`);
      if (listEl) listEl.innerHTML = list.map(itemHtml).join('') || _factionEmptyHtml(pool);
    }
  } else if (which === 'state') {
    await ensureMortLib('government');
    const pool = (_mortLibCache.get('government') || []).filter(r => !added.has(r.name));
    const list = pool.filter(r => !q || r.name.toLowerCase().includes(q));
    document.getElementById('cdet-faction-state-list').innerHTML = list.map(itemHtml).join('') || _factionEmptyHtml(pool);
  }
}
```

Стало:
```js
async function _renderFactionPickerList(which, query, root) {
  const scope = root || document;
  const q = (query || '').toLowerCase();
  const added = _factionAlreadyAdded(which, scope);
  const itemHtml = r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`;
  if (which === 'sects') {
    await ensureSects();
    const pool = (_sectsCache || []).filter(s => !added.has(s.name));
    const list = pool.filter(s => !q || s.name.toLowerCase().includes(q));
    scope.querySelector('#cdet-faction-sects-list').innerHTML = list.map(itemHtml).join('') || _factionEmptyHtml(pool);
  } else if (which === 'clans') {
    await ensureClans();
    const pool = (_clansCache || []).filter(c => c.sect === 'Независимые' && !added.has(c.name));
    const list = pool.filter(c => !q || c.name.toLowerCase().includes(q));
    scope.querySelector('#cdet-faction-clans-list').innerHTML = list.map(itemHtml).join('') || _factionEmptyHtml(pool);
  } else if (which === 'mortal') {
    const groups = ['religious', 'crime', 'civic'];
    await Promise.all(groups.map(ensureMortLib));
    for (const g of groups) {
      const full = _mortLibCache.get(g) || [];
      const pool = full.filter(r => !added.has(r.name));
      const list = pool.filter(r => !q || r.name.toLowerCase().includes(q));
      const groupEl = scope.querySelector(`#cdet-faction-mortal-picker .cdet-lib-picker-group[data-group="${g}"]`);
      if (groupEl) groupEl.style.display = full.length ? '' : 'none';
      const listEl = scope.querySelector(`#cdet-faction-mortal-list-${g}`);
      if (listEl) listEl.innerHTML = list.map(itemHtml).join('') || _factionEmptyHtml(pool);
    }
  } else if (which === 'state') {
    await ensureMortLib('government');
    const pool = (_mortLibCache.get('government') || []).filter(r => !added.has(r.name));
    const list = pool.filter(r => !q || r.name.toLowerCase().includes(q));
    scope.querySelector('#cdet-faction-state-list').innerHTML = list.map(itemHtml).join('') || _factionEmptyHtml(pool);
  }
}
```

`_factionEmptyHtml` — без изменений (не обращается к DOM, только строит строку из `pool`).

## §4. Клик-делегат — вычислять `root` от кликнутого элемента

Было (строки 809-864):
```js
document.addEventListener('click', async e => {
  const pickBtn = e.target.closest('[data-pick-faction]');
  if (pickBtn) {
    const which = pickBtn.dataset.pickFaction; // 'sects' | 'clans' | 'mortal' | 'state'
    const picker = document.getElementById(`cdet-faction-${which}-picker`);
    if (!picker) return;
    if (picker.hidden) { picker.hidden = false; await _renderFactionPickerList(which, ''); }
    else picker.hidden = true;
    return;
  }
  const item = e.target.closest('.v20-lib-picker[id^="cdet-faction-"] .v20-lib-item');
  if (item) {
    const picker = item.closest('.v20-lib-picker');
    const which = picker.id.replace('cdet-faction-', '').replace('-picker', '');
    const name = item.dataset.name;
    if (which === 'sects' || which === 'clans') {
      const group = document.querySelector(`.cdet-faction-chips[data-faction-group="${which}"]`);
      const existing = group?.querySelector(`.cdet-faction-chip[data-faction="${CSS.escape(name)}"]`);
      if (existing) existing.remove();
      else group?.insertAdjacentHTML('beforeend', `<button type="button" class="cdet-faction-chip" aria-label="Убрать «${escAttr(name)}» из фракций" data-faction="${escAttr(name)}">${escHtml(name)} <span class="cdet-faction-chip-remove" aria-hidden="true">✕</span></button>`);
    } else {
      const field = which === 'mortal' ? 'factions-mortal-list' : 'factions-state-list';
      const ta = document.querySelector(`[data-city-field="${field}"]`);
      if (ta) {
        const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
        const idx = lines.indexOf(name);
        if (idx !== -1) lines.splice(idx, 1); else lines.push(name);
        ta.value = lines.join('\n');
      }
    }
    const searchInput = document.getElementById(`cdet-faction-${which}-search`);
    await _renderFactionPickerList(which, searchInput?.value || '');
    return;
  }
  const chip = e.target.closest('.cdet-faction-chip');
  if (chip) {
    const which = chip.closest('.cdet-faction-chips')?.dataset.factionGroup;
    chip.remove();
    if (which) {
      const picker = document.getElementById(`cdet-faction-${which}-picker`);
      if (picker && !picker.hidden) {
        const searchInput = document.getElementById(`cdet-faction-${which}-search`);
        await _renderFactionPickerList(which, searchInput?.value || '');
      }
    }
    return;
  }
});
```

Стало (изменения — `root`/`scope` в каждой ветке; порядок и остальная логика не меняются; в
ветке чипа `root` считается **до** `chip.remove()`, так как после удаления `chip.closest(...)`
уже ничего не найдёт):
```js
document.addEventListener('click', async e => {
  const pickBtn = e.target.closest('[data-pick-faction]');
  if (pickBtn) {
    const which = pickBtn.dataset.pickFaction; // 'sects' | 'clans' | 'mortal' | 'state'
    const root = _factionPickerRoot(pickBtn);
    const picker = root.querySelector(`#cdet-faction-${which}-picker`);
    if (!picker) return;
    if (picker.hidden) { picker.hidden = false; await _renderFactionPickerList(which, '', root); }
    else picker.hidden = true;
    return;
  }
  const item = e.target.closest('.v20-lib-picker[id^="cdet-faction-"] .v20-lib-item');
  if (item) {
    const picker = item.closest('.v20-lib-picker');
    const which = picker.id.replace('cdet-faction-', '').replace('-picker', '');
    const name = item.dataset.name;
    const root = _factionPickerRoot(item);
    if (which === 'sects' || which === 'clans') {
      const group = root.querySelector(`.cdet-faction-chips[data-faction-group="${which}"]`);
      const existing = group?.querySelector(`.cdet-faction-chip[data-faction="${CSS.escape(name)}"]`);
      if (existing) existing.remove();
      else group?.insertAdjacentHTML('beforeend', `<button type="button" class="cdet-faction-chip" aria-label="Убрать «${escAttr(name)}» из фракций" data-faction="${escAttr(name)}">${escHtml(name)} <span class="cdet-faction-chip-remove" aria-hidden="true">✕</span></button>`);
    } else {
      const field = which === 'mortal' ? 'factions-mortal-list' : 'factions-state-list';
      const ta = root.querySelector(`[data-city-field="${field}"]`);
      if (ta) {
        const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
        const idx = lines.indexOf(name);
        if (idx !== -1) lines.splice(idx, 1); else lines.push(name);
        ta.value = lines.join('\n');
      }
    }
    const searchInput = root.querySelector(`#cdet-faction-${which}-search`);
    await _renderFactionPickerList(which, searchInput?.value || '', root);
    return;
  }
  const chip = e.target.closest('.cdet-faction-chip');
  if (chip) {
    const which = chip.closest('.cdet-faction-chips')?.dataset.factionGroup;
    const root = _factionPickerRoot(chip); // ДО chip.remove() — после удаления closest() из chip не найдёт root
    chip.remove();
    if (which) {
      const picker = root.querySelector(`#cdet-faction-${which}-picker`);
      if (picker && !picker.hidden) {
        const searchInput = root.querySelector(`#cdet-faction-${which}-search`);
        await _renderFactionPickerList(which, searchInput?.value || '', root);
      }
    }
    return;
  }
});
```

## §5. Input-делегат — вычислять `root` от `e.target`

Было (строки 865-880):
```js
document.addEventListener('input', e => {
  const m = /^cdet-faction-(sects|clans|mortal|state)-search$/.exec(e.target.id || '');
  if (m) _renderFactionPickerList(m[1], e.target.value);

  if (e.target.matches('[data-city-field="factions-mortal-list"]')) {
    const picker = document.getElementById('cdet-faction-mortal-picker');
    if (picker && !picker.hidden) _renderFactionPickerList('mortal', document.getElementById('cdet-faction-mortal-search')?.value || '');
  }
  if (e.target.matches('[data-city-field="factions-state-list"]')) {
    const picker = document.getElementById('cdet-faction-state-picker');
    if (picker && !picker.hidden) _renderFactionPickerList('state', document.getElementById('cdet-faction-state-search')?.value || '');
  }
});
```

Стало:
```js
document.addEventListener('input', e => {
  const m = /^cdet-faction-(sects|clans|mortal|state)-search$/.exec(e.target.id || '');
  if (m) _renderFactionPickerList(m[1], e.target.value, _factionPickerRoot(e.target));

  if (e.target.matches('[data-city-field="factions-mortal-list"]')) {
    const root = _factionPickerRoot(e.target);
    const picker = root.querySelector('#cdet-faction-mortal-picker');
    if (picker && !picker.hidden) _renderFactionPickerList('mortal', root.querySelector('#cdet-faction-mortal-search')?.value || '', root);
  }
  if (e.target.matches('[data-city-field="factions-state-list"]')) {
    const root = _factionPickerRoot(e.target);
    const picker = root.querySelector('#cdet-faction-state-picker');
    if (picker && !picker.hidden) _renderFactionPickerList('state', root.querySelector('#cdet-faction-state-search')?.value || '', root);
  }
});
```

---

## Краевые случаи

- **`root` не найден** (`el.closest(...)` не находит ни `#city-factions-edit`, ни
  `#city-factions-editor`) — фолбэк на `document` (старое, «баговое», но не падающее поведение).
  В норме недостижимо: оба места, откуда вообще может произойти клик/ввод по этим селекторам
  (`[data-pick-faction]`, `.v20-lib-item` внутри `.v20-lib-picker[id^="cdet-faction-"]`,
  `.cdet-faction-chip`, `[data-city-field="factions-mortal-list"/"factions-state-list"]`),
  существуют только внутри разметки, сгенерированной `_cityFactionsEditorHtml`, которая **всегда**
  вставляется в один из этих двух контейнеров (§1 анализа) — третьего места использования нет.
- **Форма создания города ещё не была лениво инициализирована** (`loadCitiesGrid()` ни разу не
  вызывалась в текущей сессии) — тогда `#city-factions-editor` пуст (нет вложенных
  `cdet-faction-*`), но и клика по нему в этом случае произойти не может (кнопок ещё нет в DOM) —
  не новый краевой случай, поведение не меняется.
- **Обе панели открыты одновременно** (пикер на странице города остался открытым, пользователь
  переключился на форму создания и там тоже открыл пикер) — с этой правкой каждая панель работает
  строго со своим `root`, взаимно не мешают. До правки это тоже технически «работало» лишь
  случайно (только для странице текущего города, как показал QA) — теперь работает предсказуемо
  для обеих.

## Тест-план

- **`npm test` не покрывает** — вся правка на уровне клиентского DOM/JS, серверные тесты
  (`web/tests/all.test.js`) её не касаются; достаточно прогнать полный набор ради регресса
  (ожидается 713/713 без изменений).
- **Обязательная живая проверка** (скилл `run-sanguine-web`, CDP) — ровно репродукция из
  QA-отчёта (Дефект №1): открыть страницу текущего города → перейти в «Города» → «+ Новый
  город» → раскрыть доп. поля → нажать 📚 у любого из четырёх разделов «Фракции» → убедиться,
  что панель реально открывается (видима, `offsetParent !== null`) и что добавленная запись
  попадает в чипы/textarea **формы создания**, а не в скрытую копию страницы города. Повторить
  для всех четырёх разделов (sects/clans/mortal/state), так как дефект был одинаков для всех.
- **Регресс уже пройденных QA сценариев** (не должны сломаться этой правкой): дедупликация
  секты/пустое состояние «Все доступные записи уже добавлены»/ручная правка textarea
  государственных фракций — прогнать те же шаги, что в QA-отчёте, на странице текущего города
  (без визита в «Города» до этого) — поведение должно остаться идентичным (root резолвится в
  `#city-factions-edit`, функционально то же самое, что раньше резолвилось в `document`
  случайно совпадавшим первым элементом).
- Тестовые город/библиотечные записи, созданные для проверки — удалить после, `git status`
  чист (та же дисциплина очистки, что и в предыдущих частях).

## Порядок реализации

Одна правка, один файл, без зависимостей от прочего — можно реализовывать и сдавать отдельным
шагом, не привязываясь к дальнейшим частям мастер-техспеки.
