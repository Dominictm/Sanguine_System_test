# Формы ручного ведения «Хронологии мира» и «Состояния мира» — дизайн

Дата: 2026-07-13

## Контекст и текущее состояние

Вкладка «Хроника» в архиве города (`web/public/archive.js`) имеет три таба:
`data-chron-tab="timeline"` (События сессий), `"lore"` (Хронология мира),
`"world"` (Состояние мира).

- **Хронология мира** (`cities/<город>/archive/timeline.md`) уже читается/пишется
  через общий механизм `_loadArchiveEditable` (`web/public/archive.js:235+`,
  роут `web/routes/archive.js:16-24, 78-89`) — но редактирование целиком raw-
  markdown в одной `<textarea>`. Формат файла: H1 + вступление + таблица
  «Условные обозначения» (легенда символов) + несколько разделов `## I./II./…
  <Название эпохи>`, в каждом — pipe-таблица `Год | Тип | Событие | Источник |
  Связи` (эмодзи-тип из легенды, «Связи» — markdown-ссылки на карточки
  персонажей/локаций).
- **Состояние мира** — блок `## 🌍 Состояние мира` внутри
  `cities/<город>/archive/events.md` (тот же файл, где ниже идут реальные
  события сессий — трогать остальной файл нельзя). Парсится `parseWorldState`
  (`web/lib/parsers/chronicle.js:70-88`) в `{lastUpdate, sections:[{heading,
  table, prose}]}`. Сейчас **чисто read-only**, PUT-эндпоинта нет вообще.
  Секции (`### heading`) — с разными колонками таблицы каждая (например
  «🏛️ Иерархия Камарильи»: Должность/Персонаж/Клан/Примечание; «☠️ Активные
  угрозы»: Угроза/Источник/Статус/Приоритет), некоторые секции — с
  дополнительной строкой-абзацем свободного текста после таблицы (например
  «**Главный Элизиум:** Опера Гарнье…»).
- Единственный существующий в проекте пример «точечного» (не raw-markdown)
  патча — `PUT /api/factions/influence` (`web/routes/archive.js:32-66`),
  правит одну строку таблицы влияния фракций через
  `setPoliticalFactionInfluence` не переписывая файл целиком.

## Цель

Дать Рассказчику структурированные формы для ручного ведения обоих разделов
(добавление/правка/удаление отдельных строк и целых разделов через поля,
без ручного письма markdown-таблиц), не ломая совместимость с уже
существующим форматом файлов (оба файла продолжают читаться существующими
парсерами и вручную в текстовом редакторе).

## Архитектура — парсеры и точечные патчи

Оба раздела используют одну и ту же идею: **распарсить → построить точечный
regex-patch одной строки/секции → записать файл целиком, не трогая остальное
содержимое** — тот же принцип, что уже применяется в
`setPoliticalFactionInfluence` (фракции) и `replaceScenarioSection` (сценарий
модуля).

### Хронология (новый модуль `web/lib/parsers/timeline.js`)

```
parseTimelineMd(raw) → {
  intro: string,                 // H1 + вступление — не редактируется формой
  legend: [{symbol, meaning}],    // из таблицы "Условные обозначения" → питает <select> "Тип"
  epochs: [{
    heading: string,              // "I. Средневековье и Тёмные Века (до XVII в.)"
    rows: [{ year, type, event, source, links: [{text, href}] }]
  }]
}
buildTimelineMd({intro, legend, epochs}) → raw markdown (обратная сериализация)
```

Точечные операции (без полной сериализации всего файла на каждый чих —
находим epoch по заголовку, патчим/добавляем/удаляем одну строку или сам
заголовок, дальше сериализуем только этот блок обратно в файл):

- `addTimelineEpoch(raw, heading)`
- `removeTimelineEpoch(raw, heading)`
- `addTimelineRow(raw, epochHeading, row)`
- `updateTimelineRow(raw, epochHeading, rowIndex, row)` — 404/409, если
  `rowIndex` вне диапазона на момент патча (гонка правок)
- `removeTimelineRow(raw, epochHeading, rowIndex)`

«Источник» — фиксированный `<select>` с 3 значениями (📚/🏙️/❓), захардкожен
(этот список не меняется без правки самого протокола ведения хроники).
«Тип» — `<select>`, опции берутся из распарсенной легенды файла (не
хардкодятся, т.к. города могут расширять список символов).

### Состояние мира (новый модуль `web/lib/parsers/worldState.js` + патч в events.md)

```
parseWorldStateBlock(eventsRaw) → {
  lastUpdate: string,
  sections: [{ heading, columns: [string], rows: [[cell,...]], note: string }]
}
replaceWorldStateBlock(eventsRaw, newBlockMd) → eventsRaw с заменённым
  блоком `## 🌍 Состояние мира … ` (до следующего `## `), остальной файл
  (события сессий) не трогается — тот же приём, что `replaceScenarioSection`
  в `web/routes/modules/scenario.js`.
```

Точечные операции аналогично: `setWorldStateLastUpdate`, `addWorldStateSection`
(heading + список названий колонок), `removeWorldStateSection`,
`addWorldStateRow`/`updateWorldStateRow`/`removeWorldStateRow` (ячейки —
массив в порядке `columns` секции), `setWorldStateSectionNote`.

## API

Все — в `web/routes/archive.js` (рядом с уже существующими
`/api/timeline`, `/api/factions/influence`).

**Хронология:**
- `GET /api/timeline/structured` → `{intro, legend, epochs}`
- `POST /api/timeline/epoch` `{heading}`
- `DELETE /api/timeline/epoch/:heading`
- `POST /api/timeline/epoch/:heading/row` `{year, type, event, source, links:[{kind:'character'|'location', slug}]}`
- `PUT /api/timeline/epoch/:heading/row/:index` — то же тело
- `DELETE /api/timeline/epoch/:heading/row/:index`

`links` в запросе — не готовая markdown-ссылка, а `{kind, slug}`: сервер сам
резолвит slug персонажа/локации через уже существующие `charsDir`/`locsDir` +
`getAllCharacters`/`getAllLocations`, строит корректный относительный `href`
от `archive/timeline.md`. Клиент не занимается путевой математикой.

Старый `GET/PUT /api/timeline` (raw-markdown целиком) остаётся без изменений —
вторичная «Редактировать весь файл».

**Состояние мира:**
- `GET /api/world-state/structured` → `{lastUpdate, sections}`
- `PUT /api/world-state/last-update` `{text}`
- `POST /api/world-state/section` `{heading, columns:[string]}`
- `DELETE /api/world-state/section/:heading`
- `POST /api/world-state/section/:heading/row` `{cells:[string]}`
- `PUT /api/world-state/section/:heading/row/:index` `{cells:[string]}`
- `DELETE /api/world-state/section/:heading/row/:index`
- `PUT /api/world-state/section/:heading/note` `{text}`
- `GET /api/world-state/raw` / `PUT /api/world-state/raw` `{content}` — raw-
  правка ТОЛЬКО блока «Состояние мира» внутри events.md (аналог
  `PUT /scenario/section`), escape-hatch для случаев, которые форма не
  покрывает.

Все мутирующие эндпойнты — 400 при пустом обязательном поле (heading,
event), 404 если heading/index не найден, 409 при рассинхроне индекса строки
(строка была удалена/сдвинута параллельной правкой — сообщение «Данные
изменились, обновите страницу»). Индекс строки валиден только в рамках уже
загруженного в форму состояния: после КАЖДОЙ успешной мутации (add/edit/
delete строки, секции, эпохи) фронтенд заново запрашивает `…/structured` и
перерисовывает список — тем самым индексы у всех строк снова совпадают с
файлом перед следующей правкой. `links` в запросе строки хронологии — массив
`{kind:'character'|'location', slug}`, порядок элементов = порядок вывода
ссылок в ячейке «Связи» (через запятую), как в исходном формате файла.

## UI (`web/public/archive.js` + `styles.css`)

**Вкладка «Хронология мира»** — вместо чистого `_loadArchiveEditable`:
- Список эпох аккордеоном (как уже свёрнутые события сессий) — заголовок +
  таблица записей на чтение, у каждой строки иконки ✏/🗑.
- «+ Добавить запись» — инлайн-форма: Год (текст), Тип (`<select>` из
  легенды), Событие (textarea), Источник (`<select>` 📚/🏙️/❓), Связи —
  тег-пикер поверх уже загруженных в `STATE` персонажей/локаций города
  (переиспользует существующие `ensureCharsLoaded`/`ensureLocsLoaded`), можно
  выбрать несколько.
- «+ Новая эпоха» — только заголовок.
- Кнопка «✏ Редактировать весь файл» (существующий raw-textarea) остаётся
  вторичной — для правок легенды/переименования эпохи, которые форма не
  покрывает.

**Вкладка «Состояние мира»** — раньше чистый рендер, теперь:
- «Последнее обновление» — текстовое поле сверху + «Сохранить».
- Секции карточками: заголовок, таблица (иконки ✏/🗑 на строку), под ней —
  необязательное поле «Примечание» (textarea + «Сохранить»).
- «+ Строка» — поля формы генерируются динамически по текущим заголовкам
  колонок ИМЕННО этой секции (разные секции — разные поля).
- «+ Новая секция» — заголовок + список названий колонок через запятую.
- 🗑 у секции — с подтверждением (деструктивно).
- «✏ Редактировать блок целиком» — новая вторичная кнопка, raw-правка блока
  «Состояние мира» внутри events.md (по образцу `PUT /scenario/section`).

## Тестирование

`web/tests/all.test.js` — новые unit-тесты для `parseTimelineMd`/
`buildTimelineMd` и `parseWorldStateBlock`/`replaceWorldStateBlock`
(round-trip: parse→build→parse даёт тот же результат), плюс integration-тесты
на каждый новый эндпойнт (happy path, 400/404/409). Ручная CDP-проверка обеих
вкладок в браузере (добавить эпоху/секцию, добавить/поправить/удалить
строку, проверить, что raw-fallback всё ещё открывает корректный markdown).

## Вне рамок (явно не делаем)

- Не трогаем формат/парсинг остальных секций `events.md` (сами события
  сессий) — только блок «Состояние мира».
- Не добавляем drag-n-drop переупорядочивание строк/эпох/секций — только
  добавление в конец и точечная правка/удаление.
- Не переносим `_enterInfoEdit`-парадигму (карточка персонажа) — используем
  уже устоявшийся для архива паттерн (таблица + точечный regex-patch).
