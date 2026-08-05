# Техспека: «Значимые места» — блок спойлеров вместо строк-инпутов

**Дата:** 2026-08-05 · **Роль:** Системный аналитик

Замена текущего вида (пара текстовых полей + ✕ в ряд на каждую запись,
общая кнопка «✓ Сохранить» на весь список) на блок спойлеров: свёрнут —
видно только название; развёрнут — видно и можно править описание, в конце
спойлера — «✓ Сохранить»/«🗑 Удалить» для этой записи. Новая запись — через
отдельную кнопку «+ Добавить», открывающую строку-форму (название,
описание, «✓ Сохранить», «Отмена» — всё в один ряд).

Уточнено с постановщиком (роль Системный аналитик — сначала контекст, не
молчаливые допущения):

1. Существующая запись — просмотр **+ инлайн-правка** (не «удалить и
   добавить заново»): развёрнутый спойлер содержит редактируемые
   поля, как и сейчас.
2. «🗑 Удалить» у существующей записи — отдельный сетевой запрос сразу же
   (с подтверждением), не откладывается до общей кнопки.
3. «✓ Сохранить» в форме создания — тоже отдельный сетевой запрос сразу же,
   форма закрывается по успеху.

Из (2)+(3) следует: у блока **больше нет общей кнопки «Сохранить» на весь
список** — каждое действие (создать / отредактировать / удалить) бьёт в
сеть самостоятельно. Это и определяет технический контракт ниже.

---

## Т1 · Источник правды на время открытой вкладки — JS-массив, не DOM

**Было:** `_collectCityLandmarksTable()` на каждое сохранение перечитывает
**все** `.hooks-item` в `#city-landmarks-list` через `querySelectorAll`.
Это работало, пока сохранение было одно на весь список. При поштучных
действиях так же читать «все инпуты сразу» на каждый чих избыточно и
хрупко (значения других, ещё не сохранённых правок в других спойлерах
неожиданно улетели бы в сеть вместе с текущим действием).

**Стало:** при рендере вкладки «География» распарсенные строки
(`parseLandmarkRows(sec.landmarks)`, без изменений) кладутся в module-level
переменную:

```js
let _cityLandmarksRows = [];   // [{name, desc}, …] — источник правды на сессию просмотра вкладки
```

Каждое действие мутирует **только эту переменную** (не читает чужие
инпуты), затем сериализует её целиком в markdown-таблицу тем же приёмом,
что и сегодня (`| Название | Описание |` + esc `|`→`∣` — код
`_collectCityLandmarksTable` переиспользуется как чистая функция
`_serializeLandmarksTable(rows)`, принимающая массив вместо чтения DOM):

```js
function _serializeLandmarksTable(rows) {
  const esc = s => String(s).replace(/\|/g, '∣');
  const clean = rows.filter(r => r.name || r.desc);
  return clean.length
    ? `| Название | Описание |\n|---|---|\n${clean.map(r => `| ${esc(r.name)} | ${esc(r.desc)} |`).join('\n')}`
    : '| Название | Описание |\n|---|---|\n| | |';
}
```

## Т2 · Разметка — спойлер на запись вместо `.hooks-item`

`_cityLandmarkRowHtml(r, i)` переписывается (был `_cityLandmarkRowHtml(r)`,
без индекса — индекс нужен для адресации действий):

```js
function _cityLandmarkItemHtml(r, i) {
  return `<details class="city-landmark-item" data-landmark-idx="${i}">
    <summary class="city-landmark-summary">${escHtml(r.name)}</summary>
    <div class="city-landmark-body">
      <input class="form-control city-landmark-name-inp" value="${escAttr(r.name)}" placeholder="Название…">
      <textarea class="form-control city-landmark-desc-inp" rows="2" placeholder="Описание…">${escHtml(r.desc)}</textarea>
      <div class="city-landmark-item-actions">
        <button type="button" class="btn-submit city-landmark-save-btn">✓ Сохранить</button>
        <button type="button" class="btn-submit btn-danger city-landmark-del-btn">🗑 Удалить</button>
      </div>
    </div>
  </details>`;
}
```

`_cityViewLandmarksHtml(sec)` — инициализирует `_cityLandmarksRows`, рендерит
список без общей кнопки «Сохранить» (её больше нет) и без старой
add-row-разметки — только точка входа «+ Добавить» и скрытая форма
создания (Т3):

```js
function _cityViewLandmarksHtml(sec) {
  _cityLandmarksRows = parseLandmarkRows(sec.landmarks || '');
  return `
    <div class="form-group">
      <label class="form-label">Значимые места</label>
      <div id="city-landmarks-list">${_renderCityLandmarksList()}</div>
      ${_cityLandmarkCreateRowHtml()}
    </div>`;
}

// Полный ре-рендер списка после любого мутирующего действия — проще и
// надёжнее точечного патча одного <details> по индексу: индексы у всех
// записей после add/delete всё равно сдвигаются, а список короткий
// (обычно единицы записей), так что цена перерисовки не ощущается.
// Плата за простоту — эффект схлопывания уже открытых чужих спойлеров
// после действия в одном из них; при таком размере списка это приемлемо.
function _renderCityLandmarksList() {
  if (!_cityLandmarksRows.length) return '<div class="cdet-empty">Значимых мест пока нет</div>';
  return _cityLandmarksRows.map(_cityLandmarkItemHtml).join('');
}
```

**Про `<details>`-в-`<details>` конфликтов нет** — `.city-landmark-item` не
переиспользует класс `.city-create-spoiler` (см. Т5 про визуал), так что
никаких коллизий с обработчиками формы создания/редактирования города.

## Т3 · «+ Добавить» — скрытая строка-форма, не всегда видимый ряд инпутов

**Было:** пустая строка `.hooks-item` добавлялась в DOM по клику
«+ Добавить запись» и оставалась черновиком до общего «Сохранить».

**Стало:** одна статичная (изначально скрытая) форма-строка под списком;
кнопка «+ Добавить» её показывает, «Отмена» — прячет и очищает, «✓
Сохранить» — мутирует `_cityLandmarksRows`, шлёт сеть, по успеху прячет
форму и добавляет новую запись в отрендеренный список.

```js
function _cityLandmarkCreateRowHtml() {
  return `
    <div id="city-landmark-create-row" class="hooks-item" style="display:none">
      <input class="hooks-input" id="city-landmark-create-name" placeholder="Название…">
      <input class="hooks-input" id="city-landmark-create-desc" placeholder="Описание…">
      <button type="button" class="btn-submit" id="city-landmark-create-save">✓ Сохранить</button>
      <button type="button" class="chr-modal-btn cancel" id="city-landmark-create-cancel">Отмена</button>
    </div>
    <button class="hooks-add-btn" type="button" id="city-landmarks-add-btn">+ Добавить запись</button>`;
}
```

Разметка сохраняет `.hooks-item`/`.hooks-input` — тот же ряд-компонент, что
уже используют «Ключевые точки» локации, только теперь это форма создания,
а не постоянно видимый черновик списка. `«+ Добавить»` физически стоит
**после** формы в разметке, но в разметке блока в целом — под списком, как
просил постановщик («в конце блока кнопка добавить»); видимость формы и
кнопки согласованно переключается одним обработчиком (форма показана ⇄
кнопка скрыта, и наоборот), чтобы не было двух одновременно видимых
точек входа в один и тот же процесс.

## Т4 · Сетевой контракт — один и тот же PUT, вызывается поштучно

Новых бэкенд-эндпоинтов не требуется — переиспользуется существующий
`PUT /api/cities/:slug` с `{ fields: { landmarks: <table> } }`
(как сегодня в `_saveCityLandmarks`), просто вызывается на каждое действие
отдельно, с массивом-состоянием после применения ровно одной мутации:

```js
// mutate: (rows) => rows — чистая функция, применяющая одно изменение
// (push / splice / замена по индексу) к КОПИИ текущего состояния.
// onOk(newRows) вызывается только при успехе — при ошибке исходный
// _cityLandmarksRows не трогается, поля на экране остаются как были
// (тот же принцип, что уже действует для остальных форм города).
async function _saveLandmarksMutation(mutate, btn, onOk) {
  const next = mutate(_cityLandmarksRows.slice());
  const table = _serializeLandmarksTable(next);
  if (btn) { btn.disabled = true; }
  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(_cityDetail.slug)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { landmarks: table } }),
    }).then(x => x.json());
    if (!r.ok) { showToast(r.error || 'Не удалось сохранить', 'error'); if (btn) btn.disabled = false; return; }
    _cityLandmarksRows = next;
    onOk();
  } catch (e) {
    showToast('Не удалось сохранить: ' + e.message, 'error');
    if (btn) btn.disabled = false;
  }
}
```

Три вызова этой функции — весь новый обработчик клика:

```js
// Правка существующей записи — «✓ Сохранить» внутри развёрнутого спойлера.
if (e.target.closest('.city-landmark-save-btn')) {
  const item = e.target.closest('.city-landmark-item');
  const i = Number(item.dataset.landmarkIdx);
  const name = item.querySelector('.city-landmark-name-inp').value.trim();
  const desc = item.querySelector('.city-landmark-desc-inp').value.trim();
  await _saveLandmarksMutation(
    rows => { rows[i] = { name, desc }; return rows; },
    e.target,
    () => { showToast('Сохранено', 'success'); document.getElementById('city-landmarks-list').innerHTML = _renderCityLandmarksList(); },
  );
  return;
}

// Удаление — подтверждение, затем тот же PUT с записью, вырезанной из массива.
if (e.target.closest('.city-landmark-del-btn')) {
  const item = e.target.closest('.city-landmark-item');
  const i = Number(item.dataset.landmarkIdx);
  if (!(await showConfirm(`Удалить «${_cityLandmarksRows[i].name}»?`, { danger: true, confirmText: 'Удалить' }))) return;
  await _saveLandmarksMutation(
    rows => { rows.splice(i, 1); return rows; },
    e.target,
    () => { showToast('Удалено', 'success'); document.getElementById('city-landmarks-list').innerHTML = _renderCityLandmarksList(); },
  );
  return;
}

// Создание — «+ Добавить» открывает форму; «✓ Сохранить» в форме — PUT, закрытие формы.
if (e.target.closest('#city-landmarks-add-btn')) {
  document.getElementById('city-landmark-create-row').style.display = 'flex';
  e.target.style.display = 'none';
  document.getElementById('city-landmark-create-name')?.focus();
  return;
}
if (e.target.closest('#city-landmark-create-cancel')) {
  _closeLandmarkCreateRow();
  return;
}
if (e.target.closest('#city-landmark-create-save')) {
  const name = document.getElementById('city-landmark-create-name').value.trim();
  const desc = document.getElementById('city-landmark-create-desc').value.trim();
  if (!name) { showToast('Укажите название', 'error'); return; }
  await _saveLandmarksMutation(
    rows => { rows.push({ name, desc }); return rows; },
    e.target,
    () => {
      showToast('Добавлено', 'success');
      document.getElementById('city-landmarks-list').innerHTML = _renderCityLandmarksList();
      _closeLandmarkCreateRow();
    },
  );
  return;
}

function _closeLandmarkCreateRow() {
  const row = document.getElementById('city-landmark-create-row');
  row.style.display = 'none';
  document.getElementById('city-landmark-create-name').value = '';
  document.getElementById('city-landmark-create-desc').value = '';
  document.getElementById('city-landmarks-add-btn').style.display = '';
}
```

**Убрать целиком:** `_collectCityLandmarksTable` (заменена на
`_serializeLandmarksTable`, принимающую массив), `_saveCityLandmarks` (была
единственной точкой сети — теперь их три, см. выше), обработчики
`#city-landmarks-add`/`#city-landmarks-save`/`.hooks-del-btn` внутри
`#city-landmarks-list` (строки ~1381–1394 текущего `city.js`) — заменяются
на новые ветки выше в том же централизованном click-делегате.

**Важное отличие от текущего поведения — в лучшую сторону:** сейчас
`_saveCityLandmarks` после сохранения дёргает `loadCityPage()` (полная
перезагрузка вкладки города) и затем эмулирует клик по вкладке
«География», чтобы вернуть туда пользователя, — уже само по себе следствие
того, что общая кнопка сохраняла резко и не считала нужным сохранить
контекст. Поштучные действия делают это ненужным: страница не
перезагружается, дальше просто точечно перерисовывается список.

## Т5 · Визуал спойлера — вопрос к Дизайнеру, с предварительной рекомендацией

`.city-landmark-item` **не** наследует `.city-create-spoiler` 1:1: тот
класс — про заголовок-СЕКЦИЮ (`▸ ПРАВИЛА И ОГРАНИЧЕНИЯ ГОРОДА`, gold,
uppercase, letter-spacing `.1em`) и таким шрифтовым режимом плохо подходит
для названия конкретного места («Опера Гарнье» капсом с трекингом — не то
же самое, что заголовок-рубрика). Предварительная рекомендация: новый
модификатор `.city-landmark-item`, использующий тот же `▸`/`▾`-паттерн
маркера и ту же рамку/фон (`border`, `--bg2`, `--r-sm`), но **без**
`text-transform: uppercase` на `summary` — обычный регистр названия места,
чуть меньший `font-size` (`--fs-base`, не крупнее). Финальное решение по
конкретным отступам/цвету — за ролью Дизайнер перед реализацией, этот пункт
здесь только чтобы у Разработчика не было пробела в контракте, если
Дизайнер решит просто подтвердить рекомендацию без отдельной designspec.

---

## Открытые вопросы / не в этом контракте

- Порядок записей после `+ Добавить` — новая всегда попадает **в конец**
  массива (`rows.push`), под все существующие. Не уточнялось отдельно —
  естественное поведение append, менять нет оснований.
- Пустое состояние (0 записей) — `<div class="cdet-empty">Значимых мест
  пока нет</div>` перед кнопкой «+ Добавить», без изменений от текущего
  поведения (`_cityViewLandmarksHtml`, техспека V5 прошлого цикла).
- Дёрганье фокуса/скролла при полной перерисовке `#city-landmarks-list`
  после каждого действия — минорная деталь (список уже открытых спойлеров
  схлопнется), сознательно не оптимизируется в рамках этого контракта (см.
  комментарий в Т2 про перерисовку списком, а не патчем по индексу).

Готово к передаче в реализацию (или на предварительное подтверждение
визуала Дизайнером — на усмотрение постановщика).
