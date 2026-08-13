# Техспека — фиксы по QA вкладки «Бэкап»

> Роль-автор: **Системный аналитик**. Адресат: **Разработчик**.
> Вход: QA-отчёт роли «Тестировщик» из этого же диалога (2026-08-13, дефекты Д-1/Д-2),
> по итогам реализации [`2026-08-13-backup-tab-techspec.md`](2026-08-13-backup-tab-techspec.md).
> Дата: 2026-08-13. Статус: **контракт готов, разработка не начата.**

Отдельного плана Аналитика не заводится — QA-отчёт уже содержит воспроизведение, корень
причины и точные строки; техспека переводит его в контракт на правку.

---

## Д-1 (средний, в объёме этой техспеки) — сводка восстановления читает не тот `city.md`

### Текущее поведение

`cityDisplayName(slug)` ([`web/routes/backup.js:72-76`](../../web/routes/backup.js#L72-L76))
всегда резолвит путь как `cityDir(slug)` — то есть **живую** папку `cities/<slug>/`:

```js
async function cityDisplayName(slug) {
  const raw = await fs.readFile(path.join(cityDir(slug), 'city.md'), 'utf-8').catch(() => '');
  const parsed = raw ? parseCityMd(raw) : null;
  return (parsed && parsed.display) || slug;
}
```

У неё два вызывающих места, и им нужно **разное** поведение:

- [`web/routes/backup.js:114`](../../web/routes/backup.js#L114) (`GET /api/backup/cities-info`) —
  здесь `cityDir(slug)` правильно: эндпоинт как раз про живые, существующие города.
- [`web/routes/backup.js:277`](../../web/routes/backup.js#L277) (`restore/inspect`,
  формирование `summary`) — здесь `cityDir(slug)` **неправильно**: цель — показать, что
  реально лежит в только что распакованном архиве (`candidatePath` уже доступен на той же
  строке и используется для `fileCount`/`sizeMb`), а не в городе, который вот-вот заменят.
  Собственный комментарий кода на этой строке («из архива, не из живого города») прямо
  противоречит тому, что делает код — явный сигнал, что это баг, а не рассинхрон
  комментария постфактум.

### Воспроизведение (из QA-отчёта)

1. Город «QA Restore Live» → бэкап → удалить папку с диска → восстановить тем же
   архивом → сводка показывает слаг `qa_restore_live`, а не «QA Restore Live»
   (город не существует → `cityDir(slug)` читать нечего → фолбэк на голый слаг).
2. Город «QA Restore Live» → бэкап → **переименовать живой город** в «RENAMED CITY LIVE»
   → `restore/inspect` тем же (старым) архивом → сводка показывает «RENAMED CITY LIVE» —
   имя города, который вот-вот заменят, а не то, что реально в архиве.

`fileCount`/`sizeMb` в обоих случаях корректны — баг только в поле `display`.

### Контракт исправления

Разделить функцию на построение имени по **произвольному пути к папке** (без привязки
к «живой» семантике) и её использование с нужным путём на каждом вызове:

```js
async function displayNameFromDir(dir, fallback) {
  const raw = await fs.readFile(path.join(dir, 'city.md'), 'utf-8').catch(() => '');
  const parsed = raw ? parseCityMd(raw) : null;
  return (parsed && parsed.display) || fallback;
}
```

Внутренний `.catch(() => '')` уже перехватывает отсутствие/ошибку чтения файла — внешний
`.catch(() => slug)` на вызывающей стороне был декоративным (функция и так не бросает),
убрать вместе с переходом на новую сигнатуру.

**`GET /api/backup/cities-info`** ([`backup.js:108-120`](../../web/routes/backup.js#L108-L120)):

```js
const [sizeMb, display] = await Promise.all([
  cachedDirSizeMb(slug),
  displayNameFromDir(cityDir(slug), slug),
]);
```

**`restore/inspect`** ([`backup.js:263-280`](../../web/routes/backup.js#L263-L280)), внутри
цикла по `entries`, где уже есть `candidatePath`:

```js
const [fileCount, sizeBytes, display] = await Promise.all([
  countFilesRecursive(candidatePath),
  dirSize(candidatePath),
  displayNameFromDir(candidatePath, slug),
]);
```

Убрать старый комментарий `// из архива, не из живого города` на этой строке — с
исправлением он станет действительно верным по коду, а не только по намерению, но сам
факт, что раньше он был неверным, отдельно фиксировать не нужно (git-история и так
показывает).

### Тест (регрессия на баг из QA-сценария №2 — самый показательный)

Добавить в `describe('Инструменты → Бэкап: /api/backup/*', ...)`
([`web/tests/all.test.js`](../../web/tests/all.test.js), рядом с существующим блоком
«полный цикл»), по образцу уже имеющихся тестов на синтетическом городе:

```js
it('restore/inspect: сводка показывает имя ИЗ АРХИВА, а не текущее имя живого города', async () => {
  const create = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({
    name: 'QA Display Name Testcity', year: '2020',
  }) });
  assert.equal(create.status, 200, create.body.error);
  const slug = create.body.slug;
  try {
    const zipBuf = await createAndDownloadBackup(slug); // хелпер уже есть в файле рядом

    // Переименовываем ЖИВОЙ город после бэкапа — старый архив по-прежнему несёт старое имя.
    const cardPath = path.join(__dirname, '../../cities', slug, 'city.md');
    const renamed = (await fs.readFile(cardPath, 'utf-8')).replace(
      'QA Display Name Testcity', 'RENAMED AFTER BACKUP');
    await fs.writeFile(cardPath, renamed, 'utf-8');

    const inspResp = await fetch(BASE + '/api/backup/restore/inspect', {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: zipBuf,
    });
    const insp = await inspResp.json();
    assert.equal(inspResp.status, 200, insp.error);
    assert.equal(insp.summary[0].display, 'QA Display Name Testcity',
      'сводка должна показывать имя ИЗ АРХИВА, не текущее имя живого города');
  } finally {
    await fs.rm(path.join(__dirname, '../../cities', slug), { recursive: true, force: true });
  }
});
```

`createAndDownloadBackup` — уже существующий локальный хелпер внутри describe-блока
«полный цикл» ([`all.test.js`](../../web/tests/all.test.js), см. реализацию рядом);
если он объявлен в замыкании вложенного `describe` и недоступен на этом уровне — вынести
его на уровень родительского `describe('Инструменты → Бэкап: ...')`, чтобы не дублировать.

---

## Д-2 (низкий) — touch-таргеты `.btn-submit`/`.chr-modal-btn` < 44px

### Решение по объёму: вне этой техспеки

QA-отчёт зафиксировал: `.btn-submit` и `.chr-modal-btn` нигде в проекте не имеют
`@media (pointer: coarse) { min-height: 44px }` — это не регрессия вкладки «Бэкап», а
существующий пробел базовых классов дизайн-системы, который наследует **любая** кнопка
на этих классах по всему приложению (счёт на десятки мест, не единицы).

Точечный патч только для `#bkp-restore-trigger`/`#bkp-restore-confirm-btn`/
`#bkp-restore-cancel-btn` дал бы непоследовательный результат: часть кнопок в
приложении соответствует правилу CLAUDE.md (44px на `pointer: coarse`), остальные —
нет, без видимой логики почему одни поправлены, а другие нет.

**Рекомендация**: отдельная задача с ролью «Дизайнер»/«Разработчик» — добавить
`@media (pointer: coarse) { min-height: 44px }` к самим базовым классам
`.btn-submit`/`.chr-modal-btn` ([`styles.css:2628`](../../web/public/styles.css#L2628),
[`styles.css:5678`](../../web/public/styles.css#L5678)) одним патчем на весь проект, а
не россыпью по фичам. Кнопки вкладки «Бэкап» унаследуют исправление автоматически,
без отдельной правки.

Не входит в объём этой техспеки. Затрагивать по явному запросу отдельной задачей.

---

## Итог

| # | Объём | Действие |
|---|---|---|
| Д-1 | В этой техспеке | `displayNameFromDir(dir, fallback)` вместо `cityDisplayName(slug)`, два вызывающих места на правильный путь, 1 регрессионный тест |
| Д-2 | Вне объёма | Отдельная задача на `.btn-submit`/`.chr-modal-btn` целиком, не точечно для «Бэкапа» |

Открытых вопросов нет.
