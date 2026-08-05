# Техспека: «Сородичи» как вкладка «Библиотеки» (K7–K10)

**Дата:** 2026-08-05 · **Роль:** Системный аналитик · **База:** [аналитика](2026-08-05-kindred-into-library-analysis.md)

Технический контракт переноса. Все идентификаторы/данные/API — без изменений;
меняется только DOM-расположение уже существующих блоков и добавляется один
новый уровень вложенных вкладок.

---

## Сквозной технический контекст — почему нельзя просто «переставить `<div>`»

Аналитика предполагала буквально вложить существующий `.tab-bar`
(`kin-clans`/`kin-sects`) внутрь новой `.tab-panel` библиотеки. При
инспекции обработчиков выяснилось, что это **сломает верхний уровень
вкладок**:

```js
// scripts.js:884-888 — делегат ГЛОБАЛЬНЫЙ, без скоупинга по странице/панели
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    ...
```

Если кнопки «Кланы»/«Секты» останутся с классом `.tab-btn`/`data-tab`, клик по
ним всё так же поймает этот делегат: `document.querySelectorAll('.tab-btn')`
пройдётся **по всем кнопкам документа**, включая верхнюю `lib-kindred`, и
снимет с неё `.active` (её `dataset.tab !== 'kin-clans'`) — верхняя вкладка
«Сородичи» визуально погаснет при клике на «Кланы» внутри неё же. Аналогично
`.tab-panel` — глобальный список, а не потомки текущей `.tab-panel`.

**Решение:** второй уровень («Кланы»/«Секты») не является кнопками `.tab-btn`
над `.tab-panel` — это отдельный delegated-обработчик по образцу уже
существующих под-вкладок (`.disciplines-subtab-btn`, `.merits-subtab-btn` и
т.д., `scripts.js:907-958`), у каждого из которых **своя** пара
класс-кнопки/класс-контейнера и **свой** `document.addEventListener`,
не пересекающийся с верхним `.tab-btn`-делегатом. Визуально переиспользуется
готовый CSS-компонент `.disciplines-subtab-bar`/`.disciplines-subtab-btn`
(тот же «ряд кнопок под вкладкой», что уже есть у «Дисциплин») — нулевой
новый CSS; поведенчески — новый `data`-атрибут (`data-kin-group`, не
`data-disc-group`), чтобы не путать обработчики между собой (обработчик
дисциплин уже безопасно игнорирует чужие клики: `if (!group) return;` при
отсутствии `dataset.discGroup`, `scripts.js:951`).

Итог структуры: **Библиотека → вкладка «Сородичи» (первая, по умолчанию) →
под-вкладки «Кланы»/«Секты»**, оба уровня визуально такие же вкладки, как у
«Дисциплин», технически — два независимых, не пересекающихся механизма.

---

## K7 · `web/public/index.html` — разметка

**Удалить** пункт бокового меню (строки 81–83):
```html
<a class="nav-item" data-page="kindred" title="Сородичи" aria-label="Сородичи">
  <span class="nav-icon">🩸</span><span>Сородичи</span>
</a>
```

**Удалить** блок `<section id="page-kindred">` целиком (строки 726–753,
включая поясняющий HTML-комментарий над ним — он описывал прежнее
архитектурное решение, которое этим циклом отменяется).

**В `<section id="page-library">`** (было строки 756–833):

1. Верхний `.tab-bar` — добавить кнопку «Сородичи» **первой**, с `active`;
   снять `active` с «Дисциплины»:
   ```html
   <div class="tab-bar">
     <button class="tab-btn active" data-tab="lib-kindred">Сородичи</button>
     <button class="tab-btn" data-tab="lib-disciplines">Дисциплины</button>
     <button class="tab-btn" data-tab="lib-psychics">Психические способности</button>
     <button class="tab-btn" data-tab="lib-merits">✦ Достоинства</button>
     <button class="tab-btn" data-tab="lib-flaws">✦ Недостатки</button>
     <button class="tab-btn" data-tab="lib-backgrounds">Факты биографии</button>
   </div>
   ```
2. Новая `.tab-panel` — **первая** в списке панелей, с `active`; у
   `tab-lib-disciplines` `active` убрать:
   ```html
   <div class="tab-panel active" id="tab-lib-kindred">
     <div class="disciplines-subtab-bar">
       <button class="disciplines-subtab-btn active" data-kin-group="clans" aria-pressed="true">Кланы</button>
       <button class="disciplines-subtab-btn" data-kin-group="sects" aria-pressed="false">Секты</button>
     </div>

     <div class="kindred-subpanel active" id="kin-sub-clans">
       <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="clans">+ Добавить клан</button></div>
       <div class="lib-panel" id="lib-clans-body">
         <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
       </div>
     </div>

     <div class="kindred-subpanel" id="kin-sub-sects">
       <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="sects">+ Добавить секту</button></div>
       <div class="lib-panel" id="lib-sects-body">
         <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
       </div>
     </div>
   </div>

   <div class="tab-panel" id="tab-lib-disciplines">
     ... (без изменений)
   ```
   Все остальные панели (`tab-lib-psychics` … `tab-lib-backgrounds`) — без
   изменений, только `tab-lib-disciplines` теряет `active` в пользу новой
   первой панели.

**Именование:** `id="tab-kin-clans"`/`id="tab-kin-sects"` **не переносятся**
как есть — заменяются на `kin-sub-clans`/`kin-sub-sects` с классом
`.kindred-subpanel` (не `.tab-panel`), см. обоснование выше. Внутренние
`id="lib-clans-body"`/`id="lib-sects-body"` и кнопки `data-lib-add="clans"`/
`"sects"` — **без изменений**, вся адресация в JS идёт по этим `id`, не по
родительской обёртке.

---

## K8 · `web/public/scripts/scripts.js` — диспетчеризация

**Строка 319–320** (`navigate()`, дефолтная загрузка при заходе на страницу):
```js
// было:
if (page === 'library')    loadLibrary();
if (page === 'kindred')    loadKindred();
// стало:
if (page === 'library')    loadKindred();
```
`loadKindred()` без аргумента грузит и рендерит оба контейнера
(`_libClansCache`/`_sectsCache`), что соответствует новой активной-по-умолчанию
вкладке «Сородичи». `loadLibrary()` (дисциплины) больше не грузится сразу при
заходе — грузится по клику на вкладку «Дисциплины», как остальные вкладки
библиотеки уже грузятся по клику сегодня (симметрично, не новый паттерн).

**Строки 890–903** (верхний `.tab-btn`-делегат) — добавить ветку `lib-kindred`
**перед** `lib-disciplines`, остальные условия — без изменений:
```js
if (tab === 'lib-kindred') loadKindred();
if (tab === 'lib-disciplines') { ... }
if (tab === 'lib-psychics')    loadPsychicsLibrary();
if (tab === 'lib-merits')      loadMeritsLibrary('physical');
if (tab === 'lib-flaws')       loadFlawsLibrary('физические');
if (tab === 'lib-backgrounds') loadBackgroundsLibrary('general');
```
Строки `if (tab === 'kin-clans') loadKindred('clans');` / `if (tab ===
'kin-sects') loadKindred('sects');` (текущие 902–903) — **удалить**: это были
ветки верхнего `.tab-btn`-делегата для прежних вкладок первого уровня; в
новой структуре «Кланы»/«Секты» — второй уровень со своим обработчиком (см.
ниже), верхний делегат их больше не касается.

**Новый блок** — добавить рядом с существующими под-вкладками (после блока
«Disciplines subtabs», т.е. после строки 958 в текущей нумерации, тем же
паттерном):
```js
// Kindred subtabs (clans/sects), вложены в единственную панель верхней
// вкладки «Сородичи» (lib-kindred). Не переиспользуют .tab-btn/.tab-panel —
// эти классы имеют глобальный делегат (см. выше по файлу), который погасил
// бы активность верхней вкладки при клике сюда. Визуал переиспользует
// .disciplines-subtab-bar/-btn (тот же компонент, что и у «Дисциплин»),
// поведение — отдельный data-атрибут и отдельный обработчик.
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-kin-group]');
  if (!btn) return;
  const group = btn.dataset.kinGroup;
  const bar = btn.closest('.disciplines-subtab-bar');
  bar.querySelectorAll('[data-kin-group]').forEach(b => {
    b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
  document.querySelectorAll('.kindred-subpanel').forEach(p =>
    p.classList.toggle('active', p.id === `kin-sub-${group}`));
  loadKindred(group);
});
```
`loadKindred(group)` вызывается и здесь (как и остальные под-вкладки вызывают
свой `load*` при каждом клике) — внутренняя проверка кэша (`if (body &&
!_clansCache)`, `v20-sheet.js:1500-1510`) делает повторный вызов дешёвым,
менять саму функцию не требуется.

---

## K9 · `web/public/scripts/library-authoring.js`

**Строка 290** — удалить:
```js
_libWireAddButtons('page-kindred');
```
Кнопки `[data-lib-add="clans"]`/`[data-lib-add="sects"]` физически переехали
внутрь `#page-library` (K7) — их продолжает ловить уже существующий вызов
`_libWireAddButtons('page-library')` (строка 289), это делегированный
обработчик на контейнер, а не на конкретные кнопки — новых узлов внутри
контейнера ему достаточно.

Комментарий над функцией (строки 274–276, «kind может открываться и со
страницы «Библиотека», и со страницы «Сородичи»») — обновить, страницы
«Сородичи» больше нет:
```js
// «+ Добавить» — категория (для merits/flaws/backgrounds) берётся с активной
// подвкладки; один обработчик на контейнер #page-library хватает и на
// clans/sects внутри вкладки «Сородичи».
```

---

## K10 · CSS (`web/public/styles.css`)

Новый класс `.kindred-subpanel` — по образцу уже существующего скрытия
неактивных `.tab-panel` (`display:none` не заявлено там явно — проверить
текущее правило `.tab-panel`/`.tab-panel.active` и зеркально завести
`.kindred-subpanel`/`.kindred-subpanel.active` с той же парой правил, не
изобретая новый способ показывать/прятать блок). Это единственный новый CSS
элемент во всём цикле — `.disciplines-subtab-bar`/`-btn` переиспользуются
без изменений (K7 использует их как есть).

---

## `web/public/scripts/v20-sheet.js` — без изменений

Весь код кланов/сект (`_clansCache`/`_sectsCache`, `ensureClans`/`ensureSects`,
`_libClanCardsHtml`/`_libSectCardsHtml`, `_v20RenderClanDetail`/
`_v20RenderSectDetail`, `loadKindred`, обработчики кликов на
`#lib-clans-body`/`#lib-sects-body`) адресуется по `id` контейнеров, которые
не меняются (K7) — правок не требует. `_LIB_KIND_CONFIG.clans`/`.sects` в
`library-authoring.js` (реализация K1 edit/delete) — аналогично, без правок.

---

## Проверка перед сдачей (для Разработчика)

- Тур по интерфейсу (`web/public/scripts/tour.js`) не ссылается на
  `[data-page="kindred"]` (проверено на этапе аналитики — шагов с этим
  селектором нет; перепроверить после правки, что тур всё ещё проходит без
  ошибок в консоли).
- `npm run test:all` — регресс не ожидается (тесты бьют по API, не по DOM),
  прогнать для контроля.
- Живая проверка в браузере (скилл `run-sanguine-web`): вкладка «Сородичи» —
  первая и активная при заходе в «Библиотеку»; под-вкладки «Кланы»/«Секты»
  переключаются, не гася активность верхней вкладки; создание/правка/удаление
  авторского клана/секты (K1) работает из нового расположения; клик по
  «Дисциплины» и обратно на «Сородичи» не ломает состояние ни одной из вкладок.
- Документация (`docs/guide.md`, `README.md`) — откатить вчерашние правки под
  отдельную страницу «Сородичи» на новую структуру «вкладка внутри
  Библиотеки» (см. аналитику, п.3, последний риск).

Готово к передаче в реализацию.
