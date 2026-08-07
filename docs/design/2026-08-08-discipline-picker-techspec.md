# Техспека: пикер дисциплин из библиотеки (по образцу пикера титулов)

**Роль:** Системный аналитик. **Входные данные:**
[2026-08-08-discipline-picker-analysis.md](2026-08-08-discipline-picker-analysis.md) (Аналитик) —
все решения §3 того документа приняты как есть, не пересматриваются. Ссылки file:line ниже
сверены 2026-08-08, тем же заходом, что и анализ — ничего не сдвинулось.

---

## 0. Найдено при проектировании — существующий баг клановой сортировки datalist (A3)

**Не входило в объём задачи, но блокирует её:** новый пикер должен группировать «Клановые»/
«Все» дисциплины через `v20ClanInfo(clan).disciplines` — тот же источник, что уже сортирует
существующий datalist (`_cdetDisciplinesDatalistOptions`, `char-detail.js:1219-1228`,
A3 2026-08-07). Проверил эмпирически перед проектированием:

```js
v20ClanInfo('Вентру').disciplines // → ["Доминирование", "Стойкость", "Присутствие"] — голое русское имя
d.name (из /api/library/disciplines) // → "Доминирование (Dominate)" — русское + английское в скобках
new Set(['доминирование']).has('доминирование (dominate)') // → false
```

`_cdetDisciplinesDatalistOptions` сравнивает `clanDiscs.has(b.toLowerCase())`, где `b = d.name`
целиком (со скобкой) — сравнение с `clanDiscs` (голые русские имена) **никогда не совпадает**.
Клановые дисциплины сегодня не поднимаются в начало datalist-подсказок ни для одного клана —
сортировка по факту всегда чисто алфавитная. Не поймано ни при реализации A3, ни при QA A3
(тест проверял количество опций и сохранение префикса, не порядок).

**Фикс — новая функция-хелпер, используется и старым datalist, и новым пикером** (§1 ниже),
единая точка правды вместо дублирования регэкспа в двух местах.

---

## 1. Общий хелпер — `_disciplineBareName`

`char-detail.js`, рядом с `_cdetDisciplinesDatalistOptions` (перед `:1219`):

```js
// Библиотека хранит «Русское (English)» (d.name), v20ClanInfo(clan).disciplines — голое
// русское имя без скобки — сравнение напрямую никогда не совпадает (см. §0). Один хелпер,
// используется и старым datalist (фикс регресса), и новым пикером дисциплин.
function _disciplineBareName(fullName) {
  return String(fullName || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}
```

### 1.1 Фикс существующего datalist (`_cdetDisciplinesDatalistOptions`, `:1219-1228`)

Было:
```js
const clanDiscs = new Set((info?.disciplines || []).map(d => d.toLowerCase()));
const names = (_disciplinesCache || []).map(d => d.name)
  .filter(n => !already.has(n.toLowerCase()))
  .sort((a, b) => (clanDiscs.has(b.toLowerCase()) ? 1 : 0) - (clanDiscs.has(a.toLowerCase()) ? 1 : 0) || a.localeCompare(b, 'ru'));
```
Стало (единственная правка — сравнение через `_disciplineBareName`, остальное не меняется):
```js
const clanDiscs = new Set((info?.disciplines || []).map(d => d.toLowerCase()));
const names = (_disciplinesCache || []).map(d => d.name)
  .filter(n => !already.has(n.toLowerCase()))
  .sort((a, b) => (clanDiscs.has(_disciplineBareName(b).toLowerCase()) ? 1 : 0) - (clanDiscs.has(_disciplineBareName(a).toLowerCase()) ? 1 : 0) || a.localeCompare(b, 'ru'));
```

### Тест-план (регресс A3, до реализации новой фичи)
- `_disciplineBareName('Доминирование (Dominate)')` → `'Доминирование'`.
- `_disciplineBareName('Анимализм')` (запись без скобки, гипотетически) → `'Анимализм'` (без изменений).
- Datalist для персонажа-Вентру с пустым полем «Дисциплины» — первые 3 опции (`clanDiscs.has`
  теперь `true`) — «Доминирование (Dominate)», «Стойкость (Fortitude)», «Присутствие
  (Presence)» в любом порядке между собой, но раньше всех прочих 18 (сортировка стабильна
  только по группе `has ? 1 : 0`, порядок внутри группы — вторичный ключ `localeCompare`).

---

## 2. Разметка — ветка `disciplines` в `_enterInfoEdit`

`char-detail.js:1123-1130`, было:
```js
} else if (key === 'disciplines') {
  input = document.createElement('input');
  input.className = 'cdet-field-input';
  input.dataset.field = key;
  input.value = current;
  input.placeholder = 'Неизвестно';
  input.setAttribute('list', 'cdet-disciplines-list');
  input.setAttribute('autocomplete', 'off');
}
```
Стало (datalist остаётся — решение Аналитика §3.2, добавляется кнопка-пикер и панель, тот же
паттерн, что уже даёт `hierarchy`-ветка `:1131-1166`):
```js
} else if (key === 'disciplines') {
  // Пикер (2026-08-08) добавляется РЯДОМ с datalist, не вместо — решение §3.2 анализа.
  const wrap = document.createElement('div');
  wrap.className = 'cdet-field-with-pick';
  const inp = document.createElement('input');
  inp.className = 'cdet-field-input';
  inp.dataset.field = key;
  inp.value = current;
  inp.placeholder = 'Неизвестно';
  inp.setAttribute('list', 'cdet-disciplines-list');
  inp.setAttribute('autocomplete', 'off');
  wrap.appendChild(inp);
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'cdet-lib-pick-btn';
  pickBtn.dataset.pickDiscipline = '1';
  pickBtn.title = 'Выбрать дисциплины из библиотеки';
  pickBtn.setAttribute('aria-label', 'Выбрать дисциплины из библиотеки');
  pickBtn.textContent = '📚';
  wrap.appendChild(pickBtn);

  const outer = document.createElement('div');
  outer.appendChild(wrap);
  outer.insertAdjacentHTML('beforeend', `
    <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-discipline-picker" hidden>
      <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-discipline-search">
      <div class="cdet-lib-picker-group" data-group="priority">
        <div class="cdet-lib-picker-group-label">Клановые</div>
        <div class="v20-lib-list" id="cdet-discipline-list-priority"></div>
      </div>
      <div class="cdet-lib-picker-group" data-group="all">
        <div class="cdet-lib-picker-group-label">Все дисциплины</div>
        <div class="v20-lib-list" id="cdet-discipline-list-all"></div>
      </div>
    </div>`);
  input = outer;
}
```

**Переименование CSS-классов** (`.cdet-title-picker*` → `.cdet-lib-picker*`) — теперь два
потребителя (титул + дисциплины), «title» в имени вводит в заблуждение. Все вхождения (сверено
грепом 2026-08-08, ровно эти шесть мест в `char-detail.js` + три правила в `styles.css`, не
больше — если при реализации грep находит что-то ещё, список ниже устарел, доверять грепу, не
этому списку):
- `char-detail.js:1155` — класс контейнера панели, разметка `hierarchy`-ветки: `cdet-title-picker`
  → `cdet-lib-picker-panel` (ID `cdet-title-picker` на том же теге — **не трогать**, см. ниже).
- `char-detail.js:1157, 1161` — `cdet-title-picker-group` → `cdet-lib-picker-group` (класс, два
  вхождения — `data-group="priority"` и `data-group="all"`).
- `char-detail.js:1158, 1162` — `cdet-title-picker-group-label` → `cdet-lib-picker-group-label`
  (класс, два вхождения).
- `char-detail.js:1271` (`_renderTitlePickerLists`) —
  `document.querySelector('.cdet-title-picker-group[data-group="priority"]')` →
  `document.querySelector('.cdet-lib-picker-group[data-group="priority"]')` — легко пропустить,
  это JS-селектор, не разметка; если не поправить — `priorityGroup` для титула перестанет
  находиться, скрытие пустой группы (§3.4 анализа) сломается молча, без ошибки в консоли.
- `styles.css:3631-3633` (§4 ниже) — те же три класса.

ID (`cdet-title-picker`, `cdet-title-search`, `cdet-title-list-priority`,
`cdet-title-list-all`) — **не трогать**, они специфичны для титула, используются в
JS-селекторах (`:1286, 1296, 1303` и далее) — переименование ID увеличивает дифф без
функциональной пользы, в отличие от классов (которые правда общие/переиспользуемые).

---

## 3. Рендер списка — функции по образцу `_titleItemHtml`/`_renderTitlePickerLists`

`char-detail.js`, рядом с `_ensureCdetLibDatalists` (после `:1244`, перед блоком титула
`:1250`):

```js
// Дисциплины (2026-08-08) — токенизация текущего значения поля, эвристика сопоставления
// токена с записью библиотеки (§3.3 анализа: легаси-карточки хранят голое английское имя,
// библиотека — «Русское (English)» — сравнение по подстроке в обе стороны + по обеим частям).
function _cdetDisciplineTokens(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}
function _disciplineTokenMatches(token, d) {
  const t = token.toLowerCase();
  if (!t) return false;
  const full = d.name.toLowerCase();
  const en = (d.name.match(/\(([^)]+)\)/)?.[1] || '').toLowerCase();
  const ru = _disciplineBareName(d.name).toLowerCase();
  return t.includes(full) || (en && t.includes(en)) || (ru && t.includes(ru));
}
function _disciplineAlreadyIn(value, d) {
  return _cdetDisciplineTokens(value).some(tok => _disciplineTokenMatches(tok, d));
}
function _disciplineItemHtml(d, selected) {
  const hint = escHtml(_libCleanClans(d.clans));
  return `<button type="button" class="v20-lib-item${selected ? ' cdet-lib-item-selected' : ''}" data-cdet-discipline="${escAttr(d.name)}"><span>${selected ? '✓ ' : ''}${escHtml(d.name)}</span><span class="v20-lib-hint">${hint}</span></button>`;
}
async function _renderDisciplinePickerLists(query) {
  await ensureDisciplines();
  const all = _disciplinesCache || [];
  const clanInput = document.querySelector('.cdet-field-input[data-field="clan"]');
  const discInput = document.querySelector('.cdet-field-input[data-field="disciplines"]');
  const clan = clanInput?.value.trim() || '';
  const currentValue = discInput?.value || '';
  const info = clan ? v20ClanInfo(clan) : null;
  const clanDiscs = new Set((info?.disciplines || []).map(n => n.toLowerCase()));
  const q = (query || '').toLowerCase();
  const matchesQuery = d => !q || d.name.toLowerCase().includes(q);
  const isClanDisc = d => clanDiscs.has(_disciplineBareName(d.name).toLowerCase());

  const priority = all.filter(d => matchesQuery(d) && isClanDisc(d));
  const prioritySlugs = new Set(priority.map(d => d.slug));
  const rest = all.filter(d => matchesQuery(d) && !prioritySlugs.has(d.slug));

  const priorityGroup = document.querySelector('#cdet-discipline-picker .cdet-lib-picker-group[data-group="priority"]');
  const priorityList  = document.getElementById('cdet-discipline-list-priority');
  const allList       = document.getElementById('cdet-discipline-list-all');
  if (priorityGroup) priorityGroup.style.display = priority.length ? '' : 'none';
  if (priorityList) priorityList.innerHTML = priority.map(d => _disciplineItemHtml(d, _disciplineAlreadyIn(currentValue, d))).join('');
  if (allList) {
    allList.innerHTML = rest.length ? rest.map(d => _disciplineItemHtml(d, _disciplineAlreadyIn(currentValue, d))).join('')
      : (all.length
          ? '<div class="cdet-empty">Ничего не найдено — можно ввести название вручную.</div>'
          : '<div class="cdet-empty">Библиотека дисциплин пуста — можно ввести название вручную.</div>');
  }
}
```

**Пометка «уже выбрано» — не скрытие из списка** (решение §3.4 анализа): элемент остаётся в
DOM с классом `cdet-lib-item-selected` + префиксом «✓ » в тексте (двойное кодирование —
цвет+иконка, не только цвет, ради доступности). Toggle (§5) требует, чтобы по уже выбранному
элементу было чем кликнуть.

---

## 4. CSS

`styles.css`, три переименования (`.cdet-title-picker` → `.cdet-lib-picker-panel`,
`.cdet-title-picker-group` → `.cdet-lib-picker-group`, `.cdet-title-picker-group-label` →
`.cdet-lib-picker-group-label`) — правка имени класса на месте, содержимое правил не меняется.
Плюс один новый класс:

```css
/* Пикер дисциплин (2026-08-08) — элемент уже добавлен в поле. Двойное кодирование состояния
   (не только цвет) — префикс «✓ » в _disciplineItemHtml дублирует эту рамку/фон текстом. */
.cdet-lib-item-selected {
  background: rgba(125, 206, 130, .1);
  border-color: rgba(125, 206, 130, .35);
}
```

---

## 5. Toggle-логика — делегаты клика/ввода

`char-detail.js`, расширение существующего делегата `document.addEventListener('click', ...)`
(`:1283-1307`) — новые ветки **перед** финальным `});`, после уже существующей ветки `item`
(титул):

```js
  const discPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-discipline]');
  if (discPickBtn) {
    const picker = document.getElementById('cdet-discipline-picker');
    if (!picker) return;
    if (picker.hidden) {
      picker.hidden = false;
      await _renderDisciplinePickerLists('');
    } else {
      picker.hidden = true;
    }
    return;
  }
  const discItem = e.target.closest('#cdet-discipline-picker .v20-lib-item');
  if (discItem) {
    const discInput = document.querySelector('.cdet-field-input[data-field="disciplines"]');
    const name = discItem.dataset.cdetDiscipline || '';
    const d = (_disciplinesCache || []).find(x => x.name === name);
    if (discInput && d) {
      const tokens = _cdetDisciplineTokens(discInput.value);
      const stillMatching = tok => _disciplineTokenMatches(tok, d);
      if (tokens.some(stillMatching)) {
        // toggle-удаление (§3.1 анализа) — убираем ВСЕ совпавшие токены целиком, вместе с
        // любым хвостовым комментарием в той же запятой-ячейке (§3.1: не хирургическая
        // правка текста, весь токен — одна единица; см. риск в анализе §4).
        discInput.value = tokens.filter(tok => !stillMatching(tok)).join(', ');
      } else {
        tokens.push(d.name);
        discInput.value = tokens.join(', ');
      }
      // Держит datalist (A3, делегат :1237-1244) в синхроне с новым значением — тот же
      // input-делегат сработает от этого события сам, отдельно вызывать не нужно.
      discInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Панель НЕ закрывается (решение задачи — добавить несколько подряд) — перерисовываем
    // с текущим поисковым запросом, чтобы ✓-пометки обновились.
    await _renderDisciplinePickerLists(document.getElementById('cdet-discipline-search')?.value || '');
    return;
  }
```

Существующий `document.addEventListener('input', ...)` (`:1308-1310`, поиск по титулам) —
новая ветка:
```js
document.addEventListener('input', e => {
  if (e.target.id === 'cdet-title-search') _renderTitlePickerLists(e.target.value);
  if (e.target.id === 'cdet-discipline-search') _renderDisciplinePickerLists(e.target.value);
});
```

### 5.1 Пересборка панели при смене «Клан» (решение §3.6 анализа)

Существующий делегат `:1237-1244` (пересобирает datalist на `input` по «Дисциплины»/«Клан») —
добавить пересборку панели, если она открыта:
```js
document.addEventListener('input', e => {
  const discInput = e.target.matches('.cdet-field-input[data-field="disciplines"]')
    ? e.target : (e.target.matches('.cdet-field-input[data-field="clan"]')
      ? document.querySelector('.cdet-field-input[data-field="disciplines"]') : null);
  if (!discInput) return;
  const clanVal = document.querySelector('.cdet-field-input[data-field="clan"]')?.value.trim() || '';
  _refreshCdetDisciplinesDatalist(discInput.value, clanVal);
  // Пикер дисциплин (2026-08-08) — если панель открыта, держим её в синхроне с тем же
  // событием (смена «Клан» → перегруппировка «Клановые», правка «Дисциплины» руками → ✓-метки).
  const picker = document.getElementById('cdet-discipline-picker');
  if (picker && !picker.hidden) _renderDisciplinePickerLists(document.getElementById('cdet-discipline-search')?.value || '');
});
```
(Один делегат вместо двух — расширение уже существующего, не дублирование условия
`discInput`/`clanInput`-look-up.)

---

## 6. `_exitInfoEdit` — совместимость без правок

Восстановление ячеек уже обобщено под вложенные обёртки (`grid.querySelectorAll('.cdet-key +
*')`, фикс A2.8 2026-08-07, `char-detail.js:1332`, сверено 2026-08-08) — для
поля «Дисциплины» топ-уровневый элемент теперь тоже `outer`-обёртка (как у «Титул»), тот же
код корректно найдёт `.cdet-field-input` внутри и заменит весь `outer` целиком, включая панель
пикера — без дополнительных правок. Дублировать проверку не нужно, только держать в уме при
тестировании (§7).

---

## 7. Тест-план

**§0/§1 (фикс клановой сортировки, регресс A3):** см. тест-план §1 выше.

**§2-§5 (новая функциональность):**
- Открыть карточку вампира-Вентру, вкладка «Информация», режим редактирования → кнопка `📚`
  рядом с «Дисциплины».
- Открыть панель на пустом поле «Дисциплины» → группа «Клановые» показывает Доминирование/
  Стойкость/Присутствие (не пуста — регресс-тест на §0/§1), ни один элемент не помечен ✓.
- Кликнуть «Доминирование (Dominate)» → поле принимает `Доминирование (Dominate)`, панель
  остаётся открытой, элемент в списке помечается ✓.
- Кликнуть «Стойкость (Fortitude)» → поле `Доминирование (Dominate), Стойкость (Fortitude)`
  (добавление, не замена).
- Кликнуть повторно «Доминирование (Dominate)» (уже ✓) → убирается из поля, остаётся только
  «Стойкость (Fortitude)», ✓-метка снимается.
- Легаси-значение: открыть персонажа с полем `Dominate, Fortitude, Presence (клановые Вентру;
  предположительно)` (реальная карточка Ален Дюбуа) → открыть панель → «Доминирование
  (Dominate)», «Стойкость (Fortitude)», «Присутствие (Presence)» все три помечены ✓ (эвристика
  §3.3/§3 находит их в голом английском тексте).
- От той же карточки кликнуть «Присутствие (Presence)» (снять) → токен `Presence (клановые
  Вентру; предположительно)` убирается целиком, комментарий не сохраняется отдельно (ожидаемое
  поведение, задокументировано в §5 выше как не хирургическая правка).
- Поиск: ввести «Стойк» в `#cdet-discipline-search` → список сужается, `✓`-пометка на уже
  выбранной «Стойкости» сохраняется при фильтрации.
- Поиск без совпадений → «Ничего не найдено — можно ввести название вручную.» (тот же паттерн,
  что фикс QA 2026-08-08 у пикера титулов).
- Сменить «Клан» на «Гангрел» при открытой панели → группа «Клановые» перестраивается
  (Анимализм/Стойкость/Превращение вместо Вентру-набора), без перезакрытия панели.
- Datalist (`list="cdet-disciplines-list"`) по-прежнему работает при ручном наборе — регресс
  на A3, не сломан сосуществованием с пикером.
- Сохранить карточку (`_saveInfoFields`) → значение поля «Дисциплины» уходит в PUT как обычная
  строка, точка сохранения не знает о пикере (никаких правок в `_saveInfoFields` не требуется —
  подтверждено, пикер работает только с `.cdet-field-input[data-field="disciplines"].value`,
  тем же полем, что уже собирает `grid.querySelectorAll('.cdet-field-input')` при сохранении).
- Отмена редактирования (`cdet-cancel-btn`) при открытой панели пикера → `_exitInfoEdit`
  корректно восстанавливает `.cdet-val` без осиротевшей панели в DOM (см. §6 — уже общий код,
  но требует живой проверки на этом конкретном поле).
- Другая линейка (смертный/фея) — поля «Дисциплины» нет вовсе, ветка `key === 'disciplines'`
  не срабатывает, кнопка `📚` не появляется (без дополнительного guard'а — ветка физически
  недостижима вне вампира, см. анализ §1.1).

---

## 8. Порядок реализации

1. §0/§1 — фикс `_disciplineBareName` + правка сортировки существующего datalist (независим
   от остального, можно смержить и проверить отдельно).
2. §2 — разметка + переименование CSS-классов (`.cdet-title-picker*` → `.cdet-lib-picker*`,
   везде синхронно — JS-разметка титула, JS-разметка дисциплин, CSS).
3. §3 — функции рендера списка.
4. §4 — новый CSS-класс `.cdet-lib-item-selected`.
5. §5 — делегаты клика/ввода (toggle + пересборка при смене клана).
6. `npm test` (регресс, дисциплины тестами не покрыты — только ручная/браузерная проверка по
   §7) + живой прогон в браузере по полному тест-плану §7, включая легаси-карточку Ален Дюбуа
   (реальные данные, не синтетический тест-кейс).

---

# Часть II — Форк канонической записи библиотеки («Создать свою копию»)

**Роль:** Системный аналитик. **Входные данные:**
[2026-08-08-library-canonical-edit-analysis.md](2026-08-08-library-canonical-edit-analysis.md)
(Аналитик) — реализуется **Вариант C** того документа (единственный принятый; Варианты A/B не
в объёме этой техспеки — A отклонён явно, B отложен до проверки, что C недостаточно). Ссылки
file:line ниже сверены 2026-08-08.

Суть: у канонической (не `custom`) записи в детейл-модалке библиотеки — кнопка «📋 Создать свою
копию» вместо «✏ Редактировать»/«🗑 Удалить». Клик предзаполняет уже существующую форму
создания (`#lib-edit-modal`) значениями канона; сохранение идёт по уже существующему
`POST /api/library/<kind>` — новая, независимая, авторская запись (`custom: true`), канон не
трогается. Ноль нового бэкенда — вся работа фронтенд-обвязка поверх уже существующей
инфраструктуры (`_LIB_KIND_CONFIG`, `_libRenderForm`, `_libSaveCreate`).

---

## 9. Найдено при проектировании — стек модалок при открытии формы поверх детейла

**Не входило в объём задачи, но блокирует её без исправления:** кнопка форка находится внутри
уже открытой `#v20-disc-modal-backdrop` (детейл-модалка библиотеки); клик должен открыть
`#lib-edit-modal` **поверх** неё — до сих пор эти две модалки никогда не были открыты
одновременно (`#lib-edit-modal` открывался только с кнопок «+ Добавить» на странице `#page-library`,
вне детейл-модалки, `library-authoring.js:300-312`). Проверил обе точки, конфликт реальный, не
гипотетический:

**9.1 Z-index — детейл-модалка перекрыла бы форму создания.** Обе модалки используют
одинаковый `z-index: var(--z-confirm)` (1100) — `.v20-disc-modal-backdrop`
(`styles.css:10083`) и `.chr-modal-backdrop` (родительский класс `#lib-edit-modal`,
`styles.css:5378`). При равном z-index порядок рисования решает позиция в DOM: `#lib-edit-modal`
статично объявлен в разметке (`index.html:845`), а `v20-disc-modal-backdrop` создаётся JS-ом и
**всегда добавляется в конец `<body>`** (`document.body.appendChild(modal)`,
`v20-sheet.js:1059`, внутри `_v20EnsureLibModal`) при первом открытии библиотеки за сессию —
то есть неизбежно позже, чем статичный `#lib-edit-modal` из исходной разметки страницы. Значит
детейл-модалка гарантированно окажется выше в DOM и перекроет форму создания под собой:
форма технически открыта (`.open` класс есть), но невидима и некликабельна — клики попадают в
фон детейл-модалки позади.

**9.2 Escape — закрыл бы обе модалки разом.** `_v20EnsureLibModal` вешает свой Escape-обработчик
безусловно на `document` при создании модалки (`v20-sheet.js:1077`:
`document.addEventListener('keydown', e => { if (e.key === 'Escape') _v20CloseDisciplineModal(); });`).
Отдельно `openModal('lib-edit-modal', …)` (`utils.js:193-229`) вешает СВОЙ Escape-обработчик,
тоже на `document`, специфичный для `#lib-edit-modal` (`utils.js:217-227`, `trapHandler`).
Оба обработчика активны одновременно, пока обе модалки открыты — один Escape закрывает и
форму, и детейл-модалку разом, хотя пользователь ожидал закрыть только верхнюю (форму).

**Фикс — по одному точечному изменению на каждую находку**, оба минимальны, ничего не
переписывают из существующей архитектуры модалок:

### 9.1 fix — z-index override только для `#lib-edit-modal`

`styles.css`, новое правило рядом с `.chr-modal-backdrop` (после `:5386`):
```css
/* Форк канона (2026-08-08) — #lib-edit-modal может открыться поверх уже открытой
   .v20-disc-modal-backdrop (кнопка «Создать свою копию» в шапке детейла канона, §10 ниже).
   У обеих одинаковый z-index (var(--z-confirm)), а .v20-disc-modal-backdrop добавляется в
   body позже (JS, при первом открытии библиотеки за сессию) — при равном z-index именно она
   перекрыла бы форму. Точечный override только для этого id: .chr-modal-backdrop как общий
   класс не трогаем — у его остальных потребителей такого стека нет и не будет. */
#lib-edit-modal.open { z-index: calc(var(--z-confirm) + 50); }
```

### 9.2 fix — Escape закрывает верхнюю модалку, не обе

`v20-sheet.js:1077`, было:
```js
document.addEventListener('keydown', e => { if (e.key === 'Escape') _v20CloseDisciplineModal(); });
```
Стало:
```js
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // Форк (2026-08-08): пока форма создания открыта поверх, Escape закрывает её —
  // не пропускаем событие в закрытие детейл-модалки библиотеки под ней.
  if (document.getElementById('lib-edit-modal')?.classList.contains('open')) return;
  _v20CloseDisciplineModal();
});
```
(`openModal`'s собственный trap-обработчик для `#lib-edit-modal` по-прежнему сработает на тот
же keydown и закроет форму — этот код только НЕ даёт закрыть заодно и модалку под ней.)

Backdrop-клик отдельного фикса не требует: после 9.1 форма гарантированно выше в стеке и
перекрывает детейл-модалку целиком (`position:fixed; inset:0`) — клик мимо формы попадёт в её
собственный backdrop (`library-authoring.js:289-290`, уже закрывает `#lib-edit-modal`), а не
прокликивает сквозь на модалку библиотеки. Это ожидаемое поведение модального стека, не баг.

---

## 10. Кнопка «Форк» в шапке детейла — `_v20DetailActionsHtml`/`_v20SetLibDetailBody`

`v20-sheet.js:901-906`, было (одна и та же разметка для всех авторских записей, у канона шапка
вообще без кнопок):
```js
function _v20DetailActionsHtml() {
  return `<div class="v20-disc-detail-actions">
    <button type="button" class="cdet-edit-btn" id="v20-disc-edit-btn">✏ Редактировать</button>
    <button type="button" class="cdet-delete-btn" id="v20-disc-delete-btn" title="Удалить">🗑</button>
  </div>`;
}
```
Стало (параметр `custom` — какой набор кнопок рисовать):
```js
function _v20DetailActionsHtml(custom) {
  if (!custom) {
    return `<div class="v20-disc-detail-actions">
      <button type="button" class="cdet-edit-btn" id="v20-disc-fork-btn">📋 Создать свою копию</button>
    </div>`;
  }
  return `<div class="v20-disc-detail-actions">
    <button type="button" class="cdet-edit-btn" id="v20-disc-edit-btn">✏ Редактировать</button>
    <button type="button" class="cdet-delete-btn" id="v20-disc-delete-btn" title="Удалить">🗑</button>
  </div>`;
}
```

`v20-sheet.js:913-924` (`_v20SetLibDetailBody`), было (кнопки дорисовываются только у
авторских записей — у канона шапка пустая):
```js
function _v20SetLibDetailBody(html, view) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = html;
  _v20CurrentLibView = view;
  _v20LibEditMode = false;
  _v20LibEditDirty = false;
  if (view && view.custom) {
    const head = body.querySelector('.v20-disc-detail-head');
    if (head) head.insertAdjacentHTML('beforeend', _v20DetailActionsHtml());
  }
}
```
Стало (единственная правка — условие и аргумент; `view === null` у Path/Combo-детейлов
по-прежнему не рисует ничего, без изменений):
```js
function _v20SetLibDetailBody(html, view) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = html;
  _v20CurrentLibView = view;
  _v20LibEditMode = false;
  _v20LibEditDirty = false;
  if (view) {
    const head = body.querySelector('.v20-disc-detail-head');
    if (head) head.insertAdjacentHTML('beforeend', _v20DetailActionsHtml(!!view.custom));
  }
}
```

---

## 11. Обработчик клика — `_v20ForkCurrentLibRecord`

`v20-sheet.js:1071-1076` (клик-делегат внутри `_v20EnsureLibModal`), новая ветка рядом с
`editBtn`/`delBtn`:
```js
    const forkBtn = e.target.closest('#v20-disc-fork-btn');
    if (forkBtn) { _v20ForkCurrentLibRecord(); return; }
```

Новая функция, рядом с `_v20DeleteCurrentLibRecord` (после `:1011`):
```js
// Форк канона (2026-08-08) — открывает уже существующую форму создания
// (library-authoring.js), предзаполненную текущей канонической записью. Сохранение идёт по
// уже существующему POST — независимая новая авторская запись, канон не трогается (Вариант C,
// 2026-08-08-library-canonical-edit-analysis.md §3).
function _v20ForkCurrentLibRecord() {
  const v = _v20CurrentLibView;
  if (!v || v.custom) return; // форк — только у канона; у авторских уже есть «Редактировать»
  const rec = _libFindRecord(v.kind, v.slug, v.category);
  if (!rec) return;
  _libOpenCreateModal(v.kind, v.category, rec);
}
```

---

## 12. Предзаполнение формы создания — `_libOpenCreateModal`/`_libSaveCreate`

Поля формы (`_libFieldRowHtml`/`_LIB_FIELD_RECORD_KEY`, `library-authoring.js:29-54`) уже
называются один в один с полями, которые парсеры (`parseClanMd`/`parseDisciplineMd`/…)
возвращают в записи — форма правки (K1, §2 выше) уже полагается на это совпадение для
предзаполнения авторских записей. Для форка канона работает та же логика без адаптеров —
записи канона и авторских записей отдаёт один и тот же парсер, различается только `custom`.

`library-authoring.js:246-258`, было:
```js
let _libCreateKind = null;

async function _libOpenCreateModal(kind, category) {
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  _libCreateKind = kind;
  document.getElementById('lib-edit-title').textContent = `Новое: ${cfg.title}`;
  const fieldsBox = document.getElementById('lib-edit-fields');
  document.getElementById('lib-edit-error').style.display = 'none';
  const rec = cfg.categoryRecordKey ? {} : { category };
  await _libRenderForm(fieldsBox, kind, rec);
  openModal('lib-edit-modal', '[data-lib-field="name"] input');
}
```
Стало (третий параметр `sourceRec` — опциональный; вызовы без него, с кнопок «+ Добавить»,
ведут себя как прежде, byte-for-byte):
```js
let _libCreateKind = null;
let _libCreateIsFork = false; // для toast-подтверждения в _libSaveCreate ниже

// Форк канона (2026-08-08) — «(копия)» — не защита от коллизии имени (её обеспечивает
// существующая проверка slug на сервере, POST /api/library/<kind> вернёт 409), а подсказка,
// чтобы форма не открывалась с именем, дословно совпадающим с каноном.
function _libForkedName(name) {
  return `${name} (копия)`;
}

async function _libOpenCreateModal(kind, category, sourceRec) {
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  _libCreateKind = kind;
  _libCreateIsFork = !!sourceRec;
  document.getElementById('lib-edit-title').textContent = sourceRec ? `Копия: ${cfg.title}` : `Новое: ${cfg.title}`;
  const fieldsBox = document.getElementById('lib-edit-fields');
  document.getElementById('lib-edit-error').style.display = 'none';
  const rec = sourceRec ? { ...sourceRec, name: _libForkedName(sourceRec.name) }
                         : (cfg.categoryRecordKey ? {} : { category });
  await _libRenderForm(fieldsBox, kind, rec);
  openModal('lib-edit-modal', '[data-lib-field="name"] input');
}
```

`library-authoring.js:260-285` (`_libSaveCreate`), было (фрагмент):
```js
    if (!r.ok) { errEl.textContent = r.error || 'Ошибка сохранения'; errEl.style.display = ''; return; }
    closeModal('lib-edit-modal');
    await cfg.reload(body.category);
```
Стало (добавлен toast — единственный видимый пользователю сигнал «форк сохранён», раз модалка
закрывается без перехода к новой записи, см. §14 про сознательное решение не переоткрывать
детейл на forked-записи):
```js
    if (!r.ok) { errEl.textContent = r.error || 'Ошибка сохранения'; errEl.style.display = ''; return; }
    closeModal('lib-edit-modal');
    if (_libCreateIsFork) showToast(`Копия «${body.name}» создана`, 'success');
    await cfg.reload(body.category);
```

---

## 13. Разметка не меняется

`.v20-disc-detail-head` (класс, вокруг которого рисуется `_v20DetailActionsHtml`) уже есть во
всех 8 detail-рендерерах (дисциплины/психика/merits/flaws/backgrounds/кланы/секты/титулы) —
подтверждено тем, что кнопки правки/удаления у авторских записей уже сегодня там появляются
(K1). Новых точек вставки не требуется — тот же `insertAdjacentHTML('beforeend', …)`, что и для
Правки/Удаления, просто с другим содержимым при `!custom`.

---

## 14. Осознанно не в объёме (соответствует Варианту C анализа)

- **Удаление канона** — не реализуется. Вариант C явно не решает эту часть запроса (см. анализ
  §5) — только Вариант B (оверлей, отложен). Кнопки «🗑 Удалить» у канона как не было, так и нет.
- **Автопереход к forked-записи после сохранения** — не реализуется. После сохранения детейл-
  модалка остаётся на канонической записи (не переключается на свежесозданную копию) — список
  под ней (`cfg.reload`) обновлён, toast подтверждает факт создания; пользователь при желании
  сам находит копию в списке (она теперь `custom: true`, с бейджем «✏️ Авторское», как любая
  другая авторская запись). Не усложняем `_v20ReopenLibDetail`/маршрутизацию ради экономии одного
  клика — минимальный по объёму вариант, как и рекомендовал Аналитик.
- **Индикация связи «форкнуто от канона X»** — не реализуется. Forked-запись после сохранения
  неотличима от любой другой авторской записи, созданной с нуля (нет `forkedFrom`/аналогичного
  поля). Если впоследствии понадобится — отдельная, более тяжёлая доработка (новое поле в
  шаблонах `_discTemplate`/`_clanTemplate`/… + бэкенд), не часть Варианта C.

---

## 15. Тест-план

- Открыть библиотеку → каноническую дисциплину (например «Доминирование (Dominate)») → в
  шапке детейла — кнопка «📋 Создать свою копию», НЕТ «✏ Редактировать»/«🗑 Удалить».
- Клик по «📋 Создать свою копию» → поверх детейла открывается форма создания (видна целиком,
  не перекрыта детейл-модалкой — регресс на фикс §9.1), заголовок «Копия: дисциплину», поле
  «Название» = «Доминирование (Dominate) (копия)», поле «Клан/принадлежность», «Источник» и
  все уровни силы (названия + оба текста на каждом) уже заполнены значениями канона.
- Escape при открытой форме форка → закрывается ТОЛЬКО форма, детейл канона позади остаётся
  открытым (регресс на фикс §9.2) — не обе модалки разом.
- Сохранить без правок (или чуть изменив текст уровня) → toast «Копия «Доминирование (Dominate)
  (копия)» создана», форма закрывается, детейл канона остаётся на экране как был; список
  дисциплин (под модалкой) содержит новую запись с бейджем «✏️ Авторское».
- Открыть свежесозданную forked-запись → теперь доступны и «✏ Редактировать», и «🗑 Удалить» —
  работает по уже существующему K1-пути без каких-либо изменений (тот же код, `custom: true`).
- Повторить для клана — поле «Секта» (`category-select`) предзаполнено значением канона, не
  пустое и не первым пунктом списка по умолчанию.
- Повторить для достоинства/недостатка/факта биографии (JSON-track) — поле «Категория»
  предзаполнено категорией исходной канонической записи; сохранённая копия появляется в ТОЙ ЖЕ
  категории, а не в текущей активной подвкладке (важно, если они разошлись — на практике
  детейл всегда открывается из активной подвкладки, но проверить явно).
- Отмена (✕ или клик по фону формы) без сохранения → форма закрывается, канон не создаёт копию,
  список не меняется, `_libCreateIsFork` не устаревает во вред следующему обычному «+ Добавить»
  (проверить: после отменённого форка нажать «+ Добавить дисциплину» — заголовок «Новое:
  дисциплину», форма ПУСТАЯ, не донесла значения отменённого форка).
- Форкнуть дважды подряд без изменения предложенного имени → второй раз сервер вернёт 409
  («Запись с таким названием уже существует») — существующая защита (не новая), форма остаётся
  открытой с текстом ошибки, ввод не теряется.
- Path/Combo-детейлы (`view === null`) — как и раньше, шапка без каких-либо кнопок (регресс,
  §13 подтверждает точку вставки не менялась).
- Обычное «+ Добавить …» (все 8 кнопок на странице `#page-library`, вне детейл-модалки) —
  поведение byte-for-byte не изменилось (вызов без `sourceRec` — пустая форма, как раньше).

---

## 16. Порядок реализации

1. §9 — z-index override (`styles.css`) + Escape-guard (`v20-sheet.js:1077`) — независимы от
   остального, но бессмысленно тестировать в изоляции (сценарий стека появляется только вместе
   с §10-11), поэтому мержить одним шагом с §10-11.
2. §10 — `_v20DetailActionsHtml(custom)` + `_v20SetLibDetailBody` условие.
3. §11 — `_v20ForkCurrentLibRecord` + ветка в клик-делегате.
4. §12 — `_libOpenCreateModal(kind, category, sourceRec)` + `_libForkedName` + toast в
   `_libSaveCreate`.
5. Живой прогон в браузере по полному тест-плану §15 — для всех 8 kind'ов хотя бы по одному
   разу (дисциплина/психика/клан/секта/титул/merit/flaw/background), не только для дисциплины.
