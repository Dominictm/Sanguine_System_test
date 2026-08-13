# Техспека — вкладка «Бэкап» в разделе «Инструменты»

> Роль-автор: **Системный аналитик**. Адресат: **Разработчик**.
> Вход: [`2026-08-13-backup-tab-workplan.md`](2026-08-13-backup-tab-workplan.md)
> (роль «Аналитик»). Дата: 2026-08-13. Статус: **контракты готовы, разработка не начата.**

Нумерация (B1…B5) — сквозная с планом Аналитика. Три решения пользователя из плана
(§«Закрытые вопросы») уже приняты и здесь не пересматриваются: архив города = только
`cities/<slug>/`; восстановление заменяет город с откатом в `_deleted`; `cities/audio/`
не входит ни в один из архивов.

---

## Обзор новых серверных сущностей

Новый файл-роутер `web/routes/backup.js`, фабрика с DI (по образцу `tools.js`), монтируется
в `web/server.js` рядом с `toolsRouterFactory`. Пять эндпоинтов:

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/backup/cities-info` | список городов с размером на диске (B1.3, B2) |
| POST | `/api/backup/city` | поставить фоновую задачу архивации (B2) |
| GET | `/api/backup/job/:id` | статус задачи + путь к готовому файлу (B2) |
| GET | `/api/backup/job/:id/download` | отдать готовый zip, удалить временный файл после (B2) |
| GET | `/api/backup/settings` | синхронный экспорт настроек, отдельный маленький архив (B3) |
| POST | `/api/backup/restore/inspect` | принять zip, распаковать во временную папку, вернуть сводку без изменения живых данных (B4) |
| POST | `/api/backup/restore/commit` | применить ранее проверенное восстановление по `inspectId` (B4) |

Общий модуль состояния задач — `Map` в памяти процесса (по аналогии с `_cache`/`_locCache`
в `db.js`), не файл на диске: перезапуск сервера прерывает незавершённый бэкап, что
приемлемо для ручной redко используемой операции и не требует персистентности.

---

## B1. Вкладка «💾 Бэкап» — разметка и переключение

### B1.1 HTML — `web/public/index.html:1055-1060`

Пятая кнопка вкладки, после `guide`:

```html
<div class="tab-bar">
  <button class="tab-btn active" data-tab="validate">Учёт данных</button>
  <button class="tab-btn" data-tab="ai-connect">🔌 Подключение AI</button>
  <button class="tab-btn" data-tab="ai-features">⚡ Назначение генераций</button>
  <button class="tab-btn" data-tab="guide">📖 Инструкции</button>
  <button class="tab-btn" data-tab="backup">💾 Бэкап</button>
</div>
```

Панель — рядом с остальными `.tab-panel`, перед закрывающим `</section>` секции
`#page-tools` (после блока `#tab-guide`):

```html
<div class="tab-panel" id="tab-backup">
  <div id="backup-content">
    <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
  </div>
</div>
```

Содержимое рендерится в JS (B1.3), не статичной разметкой — список городов и их размеры
известны только серверу.

### B1.2 JS — переключение вкладки, `web/public/scripts/scripts.js:932-941`

Добавить ветку в существующий обработчик:

```js
if (tab === 'backup') loadBackupTab();
```

Рядом со строкой 936, там же, где `if (tab === 'guide') loadGuideTab();` (проверить точное
имя соседнего загрузчика по факту — обработчик единый на все вкладки, шаблон уже задан
`loadAiFeaturesTab()`/`loadAiConnectTab()`).

### B1.3 `loadBackupTab()` — новый файл `web/public/scripts/backup.js`

Подключить `<script src="scripts/backup.js" defer></script>` в `index.html` рядом с
соседними `scripts/*.js` (после `scripts/modules.js`, порядок не важен — модуль
самодостаточный, ничего не экспортирует наружу, кроме глобальной `loadBackupTab`,
по образцу остальных файлов в `web/public/scripts/`).

Разметка внутри `#backup-content`, три блока:

```
1. Города — чекбоксы + размер + «Выбрать все» + кнопка «Создать бэкап»
2. Настройки — кнопка «Сохранить настройки» + предупреждение про ключи (B3.2)
3. Восстановление — кнопка «Загрузить бэкап» (<input type="file"> скрытый триггер),
   визуально отделено (например, класс `.backup-danger-zone`), с текстом
   «Заменит текущие данные города — подтверждение будет запрошено перед стартом»
```

`loadBackupTab()` при первом вызове:

```js
let _backupLoaded = false;
async function loadBackupTab() {
  if (_backupLoaded) return;
  _backupLoaded = true;
  const el = document.getElementById('backup-content');
  const { cities } = await fetch('/api/backup/cities-info').then(r => r.json());
  el.innerHTML = renderBackupPanel(cities);
  wireBackupHandlers();
}
```

`renderBackupPanel(cities)` — `cities` это `[{slug, display, sizeMb}]` от
`GET /api/backup/cities-info`. Размер форматировать как `${sizeMb} МБ` (без дробей ниже
1 МБ — `Math.round`).

---

## B2. Создание бэкапа города (один или несколько)

### B2.1 `GET /api/backup/cities-info`

```js
router.get('/api/backup/cities-info', async (req, res) => {
  try {
    const cities = await listCities();
    const info = await Promise.all(cities.map(async slug => {
      const sizeBytes = await dirSize(cityDir(slug));
      const display = await cityDisplayName(slug).catch(() => slug); // см. ниже
      return { slug, display, sizeMb: Math.round(sizeBytes / 1024 / 1024) };
    }));
    res.json({ cities: info });
  } catch (e) { serverError(res, e); }
});
```

`cityDisplayName` — если в проекте уже есть готовый способ достать человекочитаемое имя
города из `city.md` (аналогично тому, как `GET /api/chronicles` берёт `display` из H1),
переиспользовать его; иначе допустимо показывать голый слаг — не критично для этой задачи,
на усмотрение разработчика при реализации.

`dirSize(dir)` — новый маленький хелпер в `web/lib/db.js` (рядом с `countMdFiles`, если
такая функция там уже есть и делает похожий рекурсивный обход — сверить по факту при
реализации; при отсутствии — обычный рекурсивный `fs.readdir(..., {withFileTypes:true})` +
суммирование `stat().size`). Кэшировать не нужно: вкладка открывается редко, а вычисление
198 МБ дерева — операция на десятки, не сотни, миллисекунд (обход метаданных, не чтение
содержимого файлов).

### B2.2 `POST /api/backup/city` — постановка фоновой задачи

**Почему не переиспользовать `/api/tool/:name` или `/api/run-tool`:** оба убивают процесс
через 30 секунд (`setTimeout(() => ps.kill(), 30000)`,
[`tools.js:490`](../../web/routes/tools.js#L490) и
[`tools.js:546`](../../web/routes/tools.js#L546)). Архивация 198 МБ через
`Compress-Archive` в этот бюджет не укладывается на всех дисках. Нужен процесс без
таймаута, статус которого опрашивается отдельно.

```js
const _backupJobs = new Map(); // id → { status, filePath, error, startedAt }

router.post('/api/backup/city', express.json(), async (req, res) => {
  const slugs = Array.isArray(req.body.slugs) ? req.body.slugs : [];
  const cities = await listCities();
  const bad = slugs.find(s => !/^[a-z0-9_]+$/.test(s) || !cities.includes(s));
  if (bad !== undefined) return res.status(400).json({ error: `Недопустимый город: ${bad}` });
  if (!slugs.length) return res.status(400).json({ error: 'Не выбран ни один город' });

  const id = crypto.randomBytes(8).toString('hex');
  _backupJobs.set(id, { status: 'running', filePath: null, error: null, startedAt: Date.now() });
  res.json({ id });

  runCityBackupJob(id, slugs).catch(e => {
    _backupJobs.set(id, { status: 'error', error: e.message });
  });
});
```

`runCityBackupJob(id, slugs)` — асинхронная функция вне обработчика (ответ уже ушёл,
работа продолжается в фоне):

```js
async function runCityBackupJob(id, slugs) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const zipName = slugs.length === 1
    ? `VTM-backup-${slugs[0]}-${timestamp}.zip`
    : `VTM-backup-${slugs.length}cities-${timestamp}.zip`;
  const zipPath = path.join(os.tmpdir(), `vtm_web_backup_${id}`, zipName);
  await fs.mkdir(path.dirname(zipPath), { recursive: true });

  // Compress-Archive принимает несколько -Path напрямую — временная копия/сборка
  // не нужна ни для одного, ни для нескольких городов (B2.2 плана: архивируем
  // cities/<slug> напрямую, в отличие от backup.ps1, который копирует всё во
  // временную папку ради фильтрации — здесь фильтровать нечего).
  const pathsArg = slugs.map(s => `'${cityDir(s).replace(/'/g, "''")}'`).join(',');
  const cmd = `Compress-Archive -Path ${pathsArg} -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal`;

  await runPowerShell(cmd); // без таймаута — фоновая задача, killable только явным DELETE (не в объёме этой версии)

  _backupJobs.set(id, { status: 'done', filePath: zipPath, error: null });
}
```

`Compress-Archive -Path a,b,c` при нескольких путях кладёт содержимое каждой папки в
архив **под именем самой папки** (т.е. `cities/paris` → `paris/...` внутри zip) — это
даёт ровно нужную структуру «папка на город» из плана (B2.2), без дополнительной сборки.

`GET /api/backup/job/:id`:

```js
router.get('/api/backup/job/:id', (req, res) => {
  const job = _backupJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json({ status: job.status, error: job.error });
});
```

`GET /api/backup/job/:id/download`:

```js
router.get('/api/backup/job/:id/download', async (req, res) => {
  const job = _backupJobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'Файл не готов' });
  res.download(job.filePath, path.basename(job.filePath), async err => {
    await fs.rm(path.dirname(job.filePath), { recursive: true, force: true }).catch(() => {});
    _backupJobs.delete(req.params.id);
  });
});
```

Фронт опрашивает `GET /api/backup/job/:id` раз в ~1.5с (аналогично паттерну генераций,
если такой polling-хелпер уже есть в `scripts.js` — использовать его; иначе простой
`setInterval` с очисткой по `done`/`error`), затем переходит на скачивание.

### B2.3 Диалог «куда сохранить»

Сервер слушает `127.0.0.1` (правка A1, [`web/server.js`](../../web/server.js)) —
`localhost` является secure context, `showSaveFilePicker()` доступен без HTTPS.

```js
async function downloadBackupFile(jobId, suggestedName) {
  const resp = await fetch(`/api/backup/job/${jobId}/download`);
  if (!resp.ok) { /* показать ошибку */ return; }
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }],
      });
      const writable = await handle.createWritable();
      await resp.body.pipeTo(writable);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // пользователь отменил диалог — не откатываться на обычное скачивание
    }
  }
  // Откат: браузер без File System Access API — обычная ссылка на скачивание
  const blob = await resp.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(a.href);
}
```

`suggestedName` — то же имя, что в `runCityBackupJob` (`VTM-backup-<slug>-<timestamp>.zip`),
дублировать в JSON-ответе `GET /api/backup/job/:id` (`{status, error, fileName}`), чтобы
фронт не собирал имя заново по другой формуле.

### B2.4 Валидация

Слаг проверяется дважды: `/^[a-z0-9_]+$/` (как `reqCity`, [`db.js:29`](../../web/lib/db.js#L29))
и принадлежность текущему `listCities()` — сделано в B2.2 выше. Отсутствие любой из двух
проверок — path traversal через `Compress-Archive -Path`.

---

## B3. Бэкап настроек (отдельная кнопка)

По решению пользователя не смешивается с городом. Небольшой архив, синхронно (секунды,
не минуты — можно обойтись без job-очереди B2.2).

### B3.1 Состав архива

- `web/.env` — целиком (ключи AI). **Не** проходит через фильтрацию `GET /api/settings`
  (та маскирует ключи звёздочками для отображения в UI) — сюда должен попасть файл
  как есть, иначе бэкап настроек не восстанавливает рабочее состояние.
- `web/.gemini-vertex-key.json` — если существует.
- `ai-feature-prefs` из `localStorage` — **сервер этого не видит**, поэтому клиент
  прикладывает его в запросе:

  ```js
  const prefs = localStorage.getItem('ai-feature-prefs') || '{}';
  const resp = await fetch('/api/backup/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiFeaturePrefs: prefs }),
  });
  ```

  Сервер кладёт этот JSON третьим файлом в архив (`ai-feature-prefs.json`), рядом с `.env`.
  Восстановление `ai-feature-prefs` из архива обратно в `localStorage` — в объём B4 не
  входит (решения пользователя касались только городов); при реализации B4 достаточно не
  потерять этот файл молча — можно предложить пользователю его содержимое для ручного
  копирования в консоль браузера, либо явно зафиксировать как «не восстанавливается
  автоматически» в тексте кнопки. Финальное поведение — на усмотрение разработчика,
  не блокирует остальной объём.

### B3.2 Эндпоинт

```js
router.post('/api/backup/settings', express.json(), async (req, res) => {
  try {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vtm_settings_backup_'));
    const zipPath = path.join(tmpDir, `VTM-settings-${Date.now()}.zip`);
    const stageDir = path.join(tmpDir, 'stage');
    await fs.mkdir(stageDir, { recursive: true });

    await fs.copyFile(envPath(), path.join(stageDir, '.env')).catch(() => {});
    await fs.copyFile(vertexKeyPath(), path.join(stageDir, '.gemini-vertex-key.json')).catch(() => {});
    if (req.body?.aiFeaturePrefs)
      await fs.writeFile(path.join(stageDir, 'ai-feature-prefs.json'), req.body.aiFeaturePrefs, 'utf-8');

    await runPowerShell(`Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal`);
    res.download(zipPath, path.basename(zipPath), () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}));
  } catch (e) { serverError(res, e); }
});
```

`envPath()`/`vertexKeyPath()` — уже переданы в DI `toolsRouterFactory`
([`tools.js:471-478`](../../web/routes/tools.js#L471-L478)); тот же паттерн DI
переиспользуется в `backupRouterFactory` (см. «Обзор» выше — единый роутер, значит
единая фабрика, без дублирования DI-параметров).

### B3.3 Предупреждение в UI

Рядом с кнопкой «Сохранить настройки» — текст: «Архив содержит ключи AI в открытом виде.
Не пересылайте его.» Имя файла (`VTM-settings-*.zip`) уже отличается от городского формата
(`VTM-backup-*.zip`) — визуально спутать сложно, но текстовое предупреждение обязательно
(Р3 плана, высокий риск).

---

## B4. Загрузка бэкапа (восстановление) — двухфазно: inspect → commit

Единственная разрушающая операция — реализована в два шага намеренно: `inspect` ничего
не трогает и может быть вызван сколько угодно раз, `commit` необратимо (в рамках сессии)
подтверждён пользователем после того, как он увидел точную сводку.

### B4.1 Приём файла — мимо `express.json`

Общий лимит тела запроса — `express.json({ limit: '20mb' })`
([`server.js:86`](../../web/server.js#L86)), архив Парижа на порядок больше. Точная та же
ловушка, что уже описана комментарием для `/api/audio`
([`server.js:78-85`](../../web/server.js#L78-L85)): `body-parser` ставит `req._body`
при первом успешном парсинге, и любой последующий `express.json()` на этом же запросе
молча становится no-op — значит маршрут восстановления обязан быть **сырым потоком**,
зарегистрированным раньше общего `app.use(express.json(...))`, либо явно исключён из-под
него через путь (по аналогии с тем, как `/api/audio` получил свой отдельный
`express.json({limit:'30mb'})` до общего).

Проще и надёжнее для бинарных 200 МБ — не JSON вообще, а `multipart/form-data` одним полем
файла, либо прямой `application/octet-stream` с `req.pipe()`:

```js
router.post('/api/backup/restore/inspect', (req, res) => {
  (async () => {
    const inspectId = crypto.randomBytes(8).toString('hex');
    const tmpDir = path.join(os.tmpdir(), `vtm_restore_${inspectId}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const uploadPath = path.join(tmpDir, 'upload.zip');

    const writeStream = require('fs').createWriteStream(uploadPath);
    req.pipe(writeStream);
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      req.on('error', reject);
    });

    const extractDir = path.join(tmpDir, 'extracted');
    await runPowerShell(`Expand-Archive -Path '${uploadPath}' -DestinationPath '${extractDir}' -Force`);

    const summary = await inspectRestoreArchive(extractDir); // B4.2
    _restoreJobs.set(inspectId, { extractDir, summary, tmpDir });
    res.json({ inspectId, summary });
  })().catch(e => { console.error(e); res.status(400).json({ error: 'Не удалось разобрать архив: ' + e.message }); });
});
```

Роут регистрируется **без** `express.json()`/`express.urlencoded()` в цепочке — тело
читается напрямую из `req` как поток. Если middleware `express.json()` уже смонтирован
глобально до этого роутера (что верно сегодня, [`server.js:86`](../../web/server.js#L86)
идёт раньше монтирования доменных роутеров), `req.pipe()` всё равно будет пуст для
`Content-Type: application/json`, поэтому фронт обязан слать
`Content-Type: application/octet-stream` (не `application/json`) — тогда общий
`express.json()` пропускает тело нетронутым (не совпадает `Content-Type`, парсер
не срабатывает, `req` остаётся читаемым потоком для ручного `pipe`). Разработчику
на этапе реализации — подтвердить это поведение тестом с реальным 20+ МБ телом, а не
только по описанию.

Фронт:

```js
async function uploadBackupFile(file) {
  const resp = await fetch('/api/backup/restore/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file, // File — потоковое тело, не base64
  });
  return resp.json();
}
```

### B4.2 `inspectRestoreArchive(extractDir)` — проверка до касания живых данных

```js
async function inspectRestoreArchive(extractDir) {
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const cityDirs = entries.filter(e => e.isDirectory());
  if (!cityDirs.length) throw new Error('В архиве не найдено ни одной папки города');

  const cities = await listCities();
  const items = [];
  for (const dirent of cityDirs) {
    const slug = dirent.name;
    if (!/^[a-z0-9_]+$/.test(slug)) throw new Error(`Недопустимое имя папки в архиве: ${slug}`);
    const candidatePath = path.join(extractDir, slug);
    const hasCityMd = await fs.stat(path.join(candidatePath, 'city.md')).then(() => true).catch(() => false);
    if (!hasCityMd) throw new Error(`Папка "${slug}" в архиве не похожа на город (нет city.md)`);
    const fileCount = await countFilesRecursive(candidatePath);
    const sizeBytes = await dirSize(candidatePath);
    items.push({
      slug, fileCount, sizeMb: Math.round(sizeBytes / 1024 / 1024),
      exists: cities.includes(slug), // true → это замена, ветка "заменить с откатом"
    });
  }
  return items;
}
```

Ничего из `cities/` ещё не тронуто — только чтение временной распакованной папки.
Любая ошибка здесь → `400` с понятным текстом, `commit` невозможен.

### B4.3 Сводка и подтверждение (фронт)

`GET`-ответ `inspect` рендерится как список: для каждого города —
«Париж (198 МБ, 342 файла) — **заменит** существующий город» либо
«Балмонт (3 МБ, 40 файлов) — **новый** город, будет создан». Кнопка подтверждения
активна только после явного чтения этого списка (не автосабмит).

### B4.4 `POST /api/backup/restore/commit` — применение

```js
router.post('/api/backup/restore/commit', express.json(), async (req, res) => {
  const { inspectId } = req.body;
  const job = _restoreJobs.get(inspectId);
  if (!job) return res.status(404).json({ error: 'Проверка архива истекла, загрузите файл заново' });

  const results = [];
  try {
    for (const item of job.summary) {
      const src = path.join(job.extractDir, item.slug);
      if (item.exists) {
        // Решение пользователя: заменить с откатом в _deleted — тот же механизм,
        // что уже реализован в DELETE /api/cities/:slug (cities.js:493-503).
        const deletedDir = path.join(CITIES_DIR, '_deleted');
        await fs.mkdir(deletedDir, { recursive: true });
        const rollbackDest = path.join(deletedDir, `${item.slug}__before_restore_${Date.now()}`);
        await fs.rename(cityDir(item.slug), rollbackDest);
        results.push({ slug: item.slug, rolledBackTo: path.relative(ROOT, rollbackDest).replace(/\\/g, '/') });
      }
      await fs.rename(src, cityDir(item.slug));
      invalidateChars(item.slug);
      invalidateLocs(item.slug);
    }
    res.json({ ok: true, results });
  } catch (e) {
    console.error('[restore-commit]', e);
    res.status(500).json({ error: 'Восстановление прервано на середине — см. лог сервера. Откаченные копии (если есть) остались в cities/_deleted/.', results });
  } finally {
    await fs.rm(job.tmpDir, { recursive: true, force: true }).catch(() => {});
    _restoreJobs.delete(inspectId);
  }
});
```

Порядок «сначала откатить старое, потом переместить новое» гарантирует, что при падении
между городами (несколько городов в одном архиве) уже обработанные города остаются в
консистентном новом состоянии, а необработанные — в исходном; частично откаченный, но не
замещённый город — единственный переходный случай, и путь отката явно возвращается в
`results` для этого города, так что пользователь не теряет его из виду.

`invalidateChars`/`invalidateLocs` — существующие функции `db.js`
(TTL-кэши персонажей/локаций, [`db.js:60-61`](../../web/lib/db.js#L60-L61)), без сброса
интерфейс до 15 секунд показывал бы данные удалённого города.

### B4.5 Место на диске — проверка перед стартом

Восстановление одного крупного города пиково держит: старую копию (до переноса в
`_deleted`), распакованную новую, и сам zip — то есть кратно исходному размеру. Явная
проверка свободного места (`os.freemem()`-подобных средств для диска в Node нет
без внешних пакетов — `check-disk-space` не в зависимостях) в объём **не входит**:
разработчик может либо оценить по `statvfs`-эквиваленту через `powershell Get-PSDrive`,
либо явно задокументировать как известное ограничение версии 1 (риск Р4 плана, средний,
не критический — решение по объёму работ на усмотрение разработчика при реализации).

---

## B5. `tools/backup.ps1` — исключить ключи из ручного бэкапа

Независимая однострочная правка, не связана с вебом.

`$exclude` сегодня — [`tools/backup.ps1:27`](../../tools/backup.ps1#L27):

```powershell
$exclude = @(".claude", ".git", "tools")
```

`.env` лежит внутри `web/`, которая **не** попадает под верхнеуровневый `$exclude`
(тот фильтрует только прямых потомков `$Root`) — нужно точечное исключение файла, не
папки:

```powershell
$exclude = @(".claude", ".git", "tools")
# ...
Get-ChildItem -Path $Root -Force | Where-Object { $_.Name -notin $exclude } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $tempDir -Recurse -Force
}
# Ключи AI не должны попадать в ручной бэкап — .env и service-account JSON
# исключаются точечно уже после копирования web/ (папка не в $exclude, файлы внутри — да).
Remove-Item -Path (Join-Path $tempDir "web\.env") -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $tempDir "web\.gemini-vertex-key.json") -Force -ErrorAction SilentlyContinue
```

Вставить после существующего блока копирования ([`backup.ps1:30-32`](../../tools/backup.ps1#L30-L32)),
до блока очистки `node_modules` ([`backup.ps1:42-44`](../../tools/backup.ps1#L42-L44)) —
порядок между этими двумя блоками не важен, но логичнее держать «что не должно попасть
в архив» рядом единым куском.

---

## Тестовый минимум (для Тестировщика/CI, не блокирует разработку)

- `dirSize`/`countFilesRecursive` — на синтетической фикстуре с известным числом файлов
  и байтов (не на реальных `cities/paris`, по установленной в проекте практике
  самодостаточных фикстур, см. `docs/superpowers/plans/2026-07-10-library-card-art.md`).
- `POST /api/backup/city` со слагом с `..`/`/` → 400, без побочных эффектов.
- `restore/inspect` на архиве без `city.md` внутри → 400, временная папка убрана.
- `restore/commit` без предшествующего `inspect` (несуществующий `inspectId`) → 404.
- Полный цикл на маленьком синтетическом городе (не Париже): создать бэкап → удалить
  город вручную → restore/inspect → restore/commit → город на месте, содержимое совпадает.
- `backup.ps1` после правки B5: `.env` отсутствует в получившемся zip (та же техника
  проверки, что уже использована при верификации A2 — распаковать в scratch и сверить
  список файлов).

---

## Риски, перенесённые из плана без изменений

Р1 (критический), Р2/Р3 (высокие), Р4/Р5 (средние), Р6 (низкий, обязательный) — см.
таблицу в [workplan §«Риски и ограничения»](2026-08-13-backup-tab-workplan.md#риски-и-ограничения-передать-в-техспеку-как-есть).
Контракты этой техспеки закрывают Р1 (двухфазный inspect/commit + откат в `_deleted`),
Р2 (фоновая задача B2.2 + потоковый приём B4.1), Р3 (раздельные архивы + правка B5),
Р6 (двойная валидация слага B2.4/B4.2). Р4 частично оставлен на усмотрение разработчика
(B4.5), Р5 не технический — только текстовое предупреждение в UI (уже отражено в B1.3).

## Открытых вопросов нет

Все решения пользователя от 2026-08-13 учтены выше. Единственные пункты, оставленные
«на усмотрение разработчика» — это детали реализации (B2.1 `cityDisplayName`, B4.5
проверка места на диске), не влияющие на контракт API или поведение, видимое
пользователю.
