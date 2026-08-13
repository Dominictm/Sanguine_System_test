# Техспека — touch-таргет `.btn-submit` на `pointer: coarse`

> Роль-автор: **Системный аналитик**. Адресат: **Разработчик**.
> Вход: [`2026-08-13-btn-submit-touch-target-workplan.md`](2026-08-13-btn-submit-touch-target-workplan.md)
> (роль «Аналитик»). Дата: 2026-08-13. Статус: **контракт готов, разработка не начата.**

Развилка плана (вариант A/B) решена в пользу **A** — расширить существующий общий
список, не заводить отдельный блок. `.chr-modal-btn` (сосед `.btn-submit` по общему
box-model блоку, [`styles.css:2616-2617`](../../web/public/styles.css#L2616-L2617)) уже
в этом списке — держать пару вместе логичнее, чем разносить по двум разным механизмам.

---

## CSS-правка

**Файл:** `web/public/styles.css`, блок [`2911-2927`](../../web/public/styles.css#L2911-L2927).

Добавить `.btn-submit` первым пунктом списка (после `.btn-icon`, перед `.tab-btn`) —
порядок внутри списка не имеет функционального значения, но `.btn-submit` — самый
частотный класс главной кнопки действия в приложении, логично держать его на виду
у начала списка, а не в середине длинного перечисления):

```diff
   .btn-icon, .tab-btn, .chron-tab, .modp-tab, .cdet-tab, .chr-detail-tab,
   .mod-fill-add-btn, .chd-recap-btn, .chr-modal-btn, .modp-back-btn,
   .modp-gen-btn, .modp-close-btn, .modp-del-btn, .chr-delete-btn,
   .chp-create-btn, .btn-create-char, .filter-select, .filter-input,
   .form-control, .ais-input, .ais-select, .chr-form-input,
   .city-edit-btn, .city-del-btn, .mod-gen-scenario-btn, .nav-item,
   .cdet-faction-chip, .modp-edit-btn,
   .tour-replay-btn, .city-switch-add, .chd-dir-btn, button.chron-chip,
   .chron-toggle, .sess-scene-btn, .modp-session-edit, .modp-session-delete,
   .cdet-rel-add-btn, .cdet-rel-del-btn, .city-districts-add-btn, .city-district-del-btn,
-  .city-district-add-loc-btn {
+  .city-district-add-loc-btn, .btn-submit {
     min-height: 44px;
   }
```

(Технически неважно, в какое место строки добавлен селектор — здесь в конец последней
строки списка, чтобы diff был однострочным и не переносил остальные селекторы.)

Ничего в самом `.btn-submit` ([`styles.css:2628-2653`](../../web/public/styles.css#L2628-L2653))
менять не нужно — `min-height` в media-блоке применяется поверх существующего
`padding: 4px 10px` из общего блока box-model, ровно как уже работает для `.chr-modal-btn`
и всех 24 соседей по списку.

---

## Верификация

Обычный **скриншот недостаточен** — нужны замеры (см. `run-sanguine-web` skill,
п.5: «Verify by measurement, not just a screenshot»), и правильная активация
`pointer: coarse` в headless Chrome требует ОБОИХ вызовов, не одного:

```js
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
```

Один `setDeviceMetricsOverride({mobile:true})` без `setTouchEmulationEnabled`
**не активирует** `pointer: coarse` (проверено эмпирически в ходе этой самой задачи —
исходный QA-замер Д-2 ошибочно снял цифры в режиме `pointer: fine`, что дало ложное
срабатывание на `.chr-modal-btn`). Перед измерением высоты кнопок — подтвердить
`matchMedia('(pointer: coarse)').matches === true` в самом Runtime.evaluate, иначе
результат недостоверен.

### Проверить (план явно требует не ограничиваться источником находки — вкладкой «Бэкап»):

1. Вкладка «Инструменты → Бэкап» — «Создать бэкап», «Загрузить бэкап…»: высота ≥ 44px
   под `pointer: coarse`, без изменений под `pointer: fine` (обычный десктоп).
2. Хотя бы одно место с **несколькими `.btn-submit` в одном `.btn-row`** (например,
   `.btn-row` с «Проверить»/«Исправить автоматически» на вкладке «Учёт данных» —
   `web/public/index.html`, кнопки `#btn-validate`/`#btn-validate-fix`) — на узком
   экране (390px) кнопки не должны наезжать друг на друга/обрезаться; при переполнении
   ряда — это существующее поведение `.btn-row { flex-wrap: wrap }`
   ([`styles.css:2553-2557`](../../web/public/styles.css#L2553-L2557)), а не новый баг,
   но нужно визуально подтвердить, что рост высоты кнопки не ломает перенос.
3. Полный прогон `npm run test:unit` — правка чисто CSS-шная, не ожидается влияния на
   существующие 738 тестов, но source-guard тесты на структуру `styles.css`
   (например, тест на z-index из `docs/design/2026-08-13-backup-tab-techspec.md`-цикла)
   могут матчить содержимое этого же media-блока по regex — прогнать перед тем, как
   считать готовым.

## Открытых вопросов нет
