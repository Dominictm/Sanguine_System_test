# Техспека: загрузка арта библиотеки, вкладка «Смертные», поля смертного/охотника, фракции города

**Роль:** Системный аналитик. **Входные данные:**
[2026-08-08-mortal-library-and-fields-analysis.md](2026-08-08-mortal-library-and-fields-analysis.md)
(Аналитик, включая добавленную позже «Часть IV») — все решения §3 каждой части того документа
приняты как есть. Ссылки file:line ниже сверены 2026-08-08. Где новый код этой техспеки
переиспользует паттерн, уже полностью расписанный в
[2026-08-08-discipline-picker-techspec.md](2026-08-08-discipline-picker-techspec.md) («сиблинг-
техспека» далее) — даю точную ссылку на раздел вместо повторного вывода того же кода.

Порядок разделов ниже — **§A/§B/§C/§D**, соответствуют Частям I-IV документа-анализа.
Рекомендованный порядок РЕАЛИЗАЦИИ (не совпадает с порядком изложения) — см. §E в конце.

---

# §A — Загрузка изображений для записей библиотеки

## A.1 Находка при проектировании — отдельная таблица `kind → каталог` не нужна

Анализ (Часть I §3.3) предполагал «свести кind→каталог в один объект». Проверил на месте: это
уже не нужно — **имя `kind` совпадает с именем каталога везде**, без исключений:
- MD-track: `DISC_DIR`/`PSY_DIR`/`CLANS_DIR`/`SECTS_DIR`/`TITLES_DIR` (`library.js:27,76,113,
  139,167`) — каждый `path.join(ROOT, 'system', 'library', '<kind>')`, где `<kind>` буквально
  `disciplines`/`psychics`/`clans`/`sects`/`titles`.
- JSON-track: `_jsonLibRoutes({ apiName: 'merits', dir: 'merits', ... })` и аналогично
  `flaws`/`backgrounds` (`library.js:665-676`) — `apiName === dir` в обоих случаях.
- Каталог арта — всегда `web/public/img/system/library/<kind>/<slug>.png`
  (`_artFileSet(section)`, `library.js:221-226`, вызывается с тем же именем секции/kind).

Значит серверный путь к каталогу арта строится напрямую от `:kind` из URL, без справочника:
`path.join(__dirname, '..', 'public', 'img', 'system', 'library', kind)`. Единственное, что
нужно — белый список допустимых `kind` (чтобы `:kind` из URL не улетел за пределы `library/`
через `..`) — тот же список, что уже неявно задаёт `_LIB_KIND_CONFIG` (фронтенд,
`library-authoring.js:61-102`) плюс пять новых из §B ниже.

## A.2 Эндпоинт

`web/routes/library.js`, рядом с секцией CRUD (после `:596`, перед JSON-track):

```js
// ── Библиотека: загрузка/замена изображения записи (2026-08-08) ─────────────
// Один слот на запись (не как у персонажа — там несколько портретов). Заменяет
// существующий файл тем же путём — writeFileAtomic делает саму перезапись идемпотентной,
// отдельной ветки «файла ещё нет» не требуется. Доступно для ЛЮБОЙ записи, включая
// каноническую (2026-08-08-library-canonical-edit-analysis.md решение не распространяется
// на арт — см. Часть I §3.4 анализа: тот же риск отката на update.bat, но мягче по цене).
const LIB_IMAGE_KINDS = new Set([
  'disciplines', 'psychics', 'clans', 'sects', 'titles', 'merits', 'flaws', 'backgrounds',
  // + 5 категорий «Смертные», см. §B.3 — регистрируются в этом же Set при реализации §B.
]);

router.post('/api/library/:kind/:slug/image', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const kind = req.params.kind;
    if (!LIB_IMAGE_KINDS.has(kind)) return res.status(400).json({ error: 'Неизвестная категория библиотеки' });
    const slug = slugify(req.params.slug);   // FIX-17 pattern — see disciplines PUT (:319 и далее)
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });

    // Только PNG — вся читающая сторона библиотеки жёстко предполагает .png (см. A.1,
    // Часть I §3.1 анализа). Фронтенд обязан прислать уже сконвертированный PNG (§A.3).
    const validated = validateImageUpload(req.body.base64, 'png');
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', kind);
    await fs.mkdir(imgDir, { recursive: true });
    await writeFileAtomic(path.join(imgDir, `${slug}.png`), validated.buffer);
    // Ни один *Cache-объект не хранит сам факт hasArt отдельно от чтения каталога на
    // каждый запрос (_artFileSet, см. A.1) — инвалидировать нечего, следующий GET увидит
    // новый файл сразу.
    res.json({ ok: true, url: `/img/system/library/${kind}/${slug}.png` });
  } catch (e) { serverError(res, e); }
});
```

Существование самой записи (`slug`) намеренно **не проверяется** — зеркалит поведение
`upload-image` персонажа (`characters.js:581-647`, которое проверяет персонажа, но только
потому что нужен `char.lineageFolder` для пути; здесь путь строится из одного `kind`, без
дополнительных данных о записи) и не является риском: неверный slug просто создаст файл,
который никто не увидит (ни одна запись библиотеки не сошлётся на несуществующий свой slug).

## A.3 Кнопка загрузки в детейл-модалке + конвертация в PNG на клиенте

`v20-sheet.js`, `_v20DetailActionsHtml(custom)` — **эта функция уже расширяется** сиблинг-
техспекой (Часть II §10, кнопка «📋 Создать свою копию» для канона). Кнопка загрузки арта
добавляется в **обе** ветки (canonical и custom) той же функции — доступна независимо от
`custom` (A.2):

```js
function _v20DetailActionsHtml(custom) {
  const artBtn = `<button type="button" class="cdet-edit-btn" id="v20-disc-art-btn">🖼 Изображение</button>`;
  if (!custom) {
    return `<div class="v20-disc-detail-actions">
      <button type="button" class="cdet-edit-btn" id="v20-disc-fork-btn">📋 Создать свою копию</button>
      ${artBtn}
    </div>`;
  }
  return `<div class="v20-disc-detail-actions">
    <button type="button" class="cdet-edit-btn" id="v20-disc-edit-btn">✏ Редактировать</button>
    <button type="button" class="cdet-delete-btn" id="v20-disc-delete-btn" title="Удалить">🗑</button>
    ${artBtn}
  </div>`;
}
```

Клик — скрытый `<input type="file" accept="image/*">`, программно кликается, `change` →
конвертация в PNG через `<canvas>` → `POST` на эндпоинт §A.2 → `cfg.reload(v.category)` (тот же
`_LIB_KIND_CONFIG`-реестр, уже используется правкой/удалением/форком) → `_v20ReopenLibDetail`
(сиблинг-техспека §12, уже существует) для обновления превью в открытой детейл-модалке.

```js
// v20-sheet.js, рядом с _v20ForkCurrentLibRecord (сиблинг-техспека §11)
function _v20UploadCurrentLibArt() {
  const v = _v20CurrentLibView;
  if (!v) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const png64 = await _libImageToPngBase64(file);
      const r = await fetch(`/api/library/${v.kind}/${encodeURIComponent(v.slug)}/image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: png64 }),
      }).then(x => x.json());
      if (!r.ok) { showToast(r.error || 'Не удалось загрузить изображение', 'error'); return; }
      const cfg = _LIB_KIND_CONFIG[v.kind];
      await cfg.reload(v.category);
      _v20ReopenLibDetail(v.kind, v.slug, v.category);
      showToast('Изображение обновлено', 'success');
    } catch (e) { showToast(e.message, 'error'); }
  });
  input.click();
}

// Конвертация в PNG через <canvas> — стандартный API, без новых зависимостей (Часть I §3.1
// анализа). Возвращает чистый base64 (без "data:image/png;base64," префикса — сервер ждёт
// голый base64, тот же контракт, что upload-image персонажа).
function _libImageToPngBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/png');
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать файл как изображение')); };
    img.src = url;
  });
}
```

Клик-делегат (`_v20EnsureLibModal`, тот же блок, что уже получает `forkBtn`/`editBtn`/`delBtn`
в сиблинг-техспеке §11 и K1):
```js
    const artBtn = e.target.closest('#v20-disc-art-btn');
    if (artBtn) { _v20UploadCurrentLibArt(); return; }
```

## A.4 Тест-план

- Открыть каноническую запись (любая дисциплина) → кнопка «🖼 Изображение» видна наравне с
  «📋 Создать свою копию» (обе — не взаимоисключающие, в отличие от Правки/Удаления).
- Загрузить JPEG-скриншот → на сервер уходит PNG (проверить через devtools Network — тело
  запроса начинается с PNG-сигнатуры после base64-декода) → карточка в списке сразу показывает
  новый арт (без релоада страницы).
- Загрузить существующее изображение повторно (замена) → старое перезаписано, не задвоено
  (в каталоге ровно один файл `<slug>.png`).
- Повторить на авторской записи — кнопка тоже видна, работает так же.
- Заведомо не-изображение (текстовый файл, переименованный в `.png`) — `<canvas>`-конвертация
  либо провалится (`img.onerror`), либо (если браузер её пропустил) серверная magic-byte
  проверка (`validateImageUpload`, уже есть) отклонит с понятной ошибкой — в обоих случаях
  пользователь видит toast с текстом ошибки, не тихий сбой.

---

# §B — Вкладка библиотеки «Смертные»

## B.1 Бэкенд — фабрика `_mdLibRoutes` (обобщение MD-track CRUD)

`web/routes/library.js`, новый хелпер рядом с `_jsonLibRoutes` (после `:663`, до регистрации
JSON-категорий) — зеркалит её сигнатуру и структуру для MD-track:

```js
// ── Обобщённый MD-track CRUD (2026-08-08) — то же обобщение, что _jsonLibRoutes уже сделала
// для JSON-track при добавлении третьей JSON-категории (:608). Кланы/Секты/Титулы НЕ
// переводятся на этот хелпер здесь (за рамками этой техспеки — своя разметка, есть причина
// для отдельного кода, см. Часть II §1 анализа) — только 5 новых категорий «Смертные»,
// у которых схема идентична друг другу и «Секте» (имя/источник/примечание/описание,
// без специфичных полей).
function _mdLibRoutes({ apiName, dir, noun }) {
  const DIR = path.join(ROOT, 'system', 'library', dir);
  let cache = null; // { sig, list }

  async function load() {
    const files = (await fs.readdir(DIR).catch(() => null));
    if (!files) return [];
    const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
    const stats = await Promise.all(mds.map(f => fs.stat(path.join(DIR, f)).catch(() => null)));
    const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
    if (cache && cache.sig === sig) return cache.list;
    const list = [];
    for (const f of mds) {
      const slug = f.replace(/\.md$/, '');
      const md = await fs.readFile(path.join(DIR, f), 'utf-8').catch(() => '');
      if (md) list.push(parseSectMd(md, slug)); // формат идентичен «Секте» — тот же парсер
    }
    cache = { sig, list };
    return list;
  }

  router.get(`/api/library/${apiName}`, async (_req, res) => {
    try { res.json(_withArt(await load(), await _artFileSet(apiName))); }
    catch (e) { serverError(res, e); }
  });

  function template({ name, source, note, description }) {
    const lines = [`# ${name}`];
    if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
    lines.push('- **Авторское:** да');
    if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
    lines.push('', '## Описание', '', sanitizeInlineText(description || ''), '');
    return lines.join('\n');
  }

  router.post(`/api/library/${apiName}`, express.json(), async (req, res) => {
    try {
      const { name, source, note, description } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      const slug = slugify(name);
      if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
      const file = path.join(DIR, `${slug}.md`);
      if (await fs.stat(file).catch(() => null))
        return res.status(409).json({ error: `${noun} с таким названием уже существует`, slug });
      await writeFileAtomic(file, template({ name: name.trim(), source, note, description }), 'utf-8');
      cache = null;
      res.json({ ok: true, slug });
    } catch (e) { serverError(res, e); }
  });

  router.put(`/api/library/${apiName}/:slug`, express.json(), async (req, res) => {
    try {
      const slug = slugify(req.params.slug);
      if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
      const file = path.join(DIR, `${slug}.md`);
      const existing = await fs.readFile(file, 'utf-8').catch(() => null);
      if (existing == null) return res.status(404).json({ error: `${noun} не найден(а)` });
      if (!parseSectMd(existing, slug).custom)
        return res.status(403).json({ error: `Редактирование доступно только для авторских записей` });
      const { name, source, note, description } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      await writeFileAtomic(file, template({ name: name.trim(), source, note, description }), 'utf-8');
      cache = null;
      res.json({ ok: true, slug });
    } catch (e) { serverError(res, e); }
  });

  router.delete(`/api/library/${apiName}/:slug`, async (req, res) => {
    try {
      const slug = slugify(req.params.slug);
      if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
      const file = path.join(DIR, `${slug}.md`);
      const existing = await fs.readFile(file, 'utf-8').catch(() => null);
      if (existing == null) return res.status(404).json({ error: `${noun} не найден(а)` });
      if (!parseSectMd(existing, slug).custom)
        return res.status(403).json({ error: `Удаление доступно только для авторских записей` });
      const trashDir = path.join(DIR, '_deleted');
      await fs.mkdir(trashDir, { recursive: true });
      await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
      cache = null;
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  return { load }; // load — для внутреннего переиспользования (§C — «Организация»/«Должность» не нуждаются, читают через тот же GET с фронта)
}
```

Регистрация пяти категорий (после определения хелпера):
```js
_mdLibRoutes({ apiName: 'mortal-government', dir: 'mortal-government', noun: 'Служба' });
_mdLibRoutes({ apiName: 'mortal-religious',  dir: 'mortal-religious',  noun: 'Организация' });
_mdLibRoutes({ apiName: 'mortal-crime',      dir: 'mortal-crime',      noun: 'Группировка' });
_mdLibRoutes({ apiName: 'mortal-civic',      dir: 'mortal-civic',      noun: 'Организация' });
_mdLibRoutes({ apiName: 'mortal-positions',  dir: 'mortal-positions',  noun: 'Должность' });
```
И добавить те же 5 строк в `LIB_IMAGE_KINDS` (§A.2).

**`parseSectMd` переиспользуется буквально** (не копия) — схема идентична (Часть II §3.1
анализа), значит и парсер один. Единственное отличие пяти новых категорий от «Секты» —
`noun` в тексте ошибок (косметика).

## B.2 Разметка — вкладка «Смертные» после «Сородичи»

`index.html`, кнопка верхнего уровня — между `:731` и `:732`:
```html
<button class="tab-btn" data-tab="lib-mortal">Смертные</button>
```
Панель — сразу после закрывающего `</div>` вкладки `#tab-lib-kindred` (`:772`), перед
`#tab-lib-disciplines` (`:774`); структура зеркалит `#tab-lib-kindred` (`:745-772`) один в один,
только 5 под-вкладок вместо 3 и общий контейнер `.mortal-subpanel` вместо `.kindred-subpanel`
(разные классы — не потому что стилистически должны отличаться, а чтобы делегат клика на
`data-mort-group` не путался с уже существующим `data-kin-group`, см. B.3):

```html
<div class="tab-panel" id="tab-lib-mortal">
  <div class="disciplines-subtab-bar">
    <button class="disciplines-subtab-btn active" data-mort-group="government" aria-pressed="true">Правительственные службы</button>
    <button class="disciplines-subtab-btn" data-mort-group="religious" aria-pressed="false">Религиозные организации</button>
    <button class="disciplines-subtab-btn" data-mort-group="crime" aria-pressed="false">Криминал</button>
    <button class="disciplines-subtab-btn" data-mort-group="civic" aria-pressed="false">Гражданские организации</button>
    <button class="disciplines-subtab-btn" data-mort-group="positions" aria-pressed="false">Должности</button>
  </div>

  <div class="mortal-subpanel active" id="mort-sub-government">
    <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="mortal-government">+ Добавить службу</button></div>
    <div class="lib-panel" id="lib-mortal-government-body"><div class="loading-state"><div class="spinner"></div>Загрузка...</div></div>
  </div>
  <div class="mortal-subpanel" id="mort-sub-religious">
    <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="mortal-religious">+ Добавить организацию</button></div>
    <div class="lib-panel" id="lib-mortal-religious-body"><div class="loading-state"><div class="spinner"></div>Загрузка...</div></div>
  </div>
  <div class="mortal-subpanel" id="mort-sub-crime">
    <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="mortal-crime">+ Добавить группировку</button></div>
    <div class="lib-panel" id="lib-mortal-crime-body"><div class="loading-state"><div class="spinner"></div>Загрузка...</div></div>
  </div>
  <div class="mortal-subpanel" id="mort-sub-civic">
    <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="mortal-civic">+ Добавить организацию</button></div>
    <div class="lib-panel" id="lib-mortal-civic-body"><div class="loading-state"><div class="spinner"></div>Загрузка...</div></div>
  </div>
  <div class="mortal-subpanel" id="mort-sub-positions">
    <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="mortal-positions">+ Добавить должность</button></div>
    <div class="lib-panel" id="lib-mortal-positions-body"><div class="loading-state"><div class="spinner"></div>Загрузка...</div></div>
  </div>
</div>
```
`.mortal-subpanel`/`.mortal-subpanel.active` — CSS зеркалит `.kindred-subpanel`/`.active`
(`styles.css`, найти по классу `.kindred-subpanel` — тот же `display:none`/`display:block`
переключатель, только новый селектор).

## B.3 Фронтенд — один параметризуемый набор функций на все 5 под-вкладок

`v20-sheet.js`, рядом с `loadKindred` (после `:1592`) — **не 5 копий** `_libClanCardsHtml`-стиля
(Часть II §3.4 анализа: у всех пяти одна схема, копирование не оправдано так, как оправдано у
Кланов/Титулов):

```js
// ── «Смертные» — 5 категорий с идентичной схемой (имя/источник/примечание/описание),
// один параметризуемый набор функций вместо пяти копий (Часть II §3.4 анализа). group —
// один из 'government'/'religious'/'crime'/'civic'/'positions'.
const _mortLibCache = new Map(); // group -> list

async function ensureMortLib(group) {
  if (_mortLibCache.has(group)) return _mortLibCache.get(group);
  let list = [];
  try { list = await fetch(`/api/library/mortal-${group}`).then(r => r.json()); } catch { /* пусто */ }
  if (!Array.isArray(list)) list = [];
  _mortLibCache.set(group, list);
  return list;
}
function _mortBySlug(group, slug) { return (_mortLibCache.get(group) || []).find(x => x.slug === slug) || null; }

function _libMortCardsHtml(group) {
  const list = _mortLibCache.get(group) || [];
  return `<div class="lib-cards">${list.map(r => {
    const art = r.hasArt
      ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/mortal-${group}/${escAttr(r.slug)}.png" alt="">`
      : '';
    const badge = r.custom ? '<span class="lib-card-custom-badge">✏️ Авторское</span>' : '';
    const inner = `<div class="lib-card-name">${escHtml(r.name)}</div>${badge}`;
    return `<button type="button" class="lib-card${r.hasArt ? ' has-art' : ''}" data-mort-slug="${escAttr(r.slug)}" data-mort-group="${group}">
      ${art}${r.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
    </button>`;
  }).join('')}</div>`;
}

function _libMortDetailHtml(r) {
  if (!r) return '<div class="v20-disc-empty">Запись не найдена.</div>';
  const badge = r.custom ? '<span class="lib-card-custom-badge">✏️ Авторское</span>' : '';
  return `<div class="v20-disc-detail-head"><h3>${escHtml(r.name)}</h3>${badge}</div>
    ${r.source ? `<div class="v20-disc-note">Источник: ${escHtml(r.source)}</div>` : ''}
    ${r.note ? `<div class="v20-disc-note">${escHtml(r.note)}</div>` : ''}
    <p class="lib-power-text">${escHtml(r.description || '')}</p>`;
}

async function _libRenderMortList(group) {
  const body = document.getElementById(`lib-mortal-${group}-body`);
  if (body) body.innerHTML = _libMortCardsHtml(group);
}

function _v20RenderMortDetail(group, slug) {
  const r = _mortBySlug(group, slug);
  const html = `<button type="button" class="v20-disc-back" data-mort-back data-mort-group="${group}">← к списку</button>${_libMortDetailHtml(r)}`;
  _v20SetLibDetailBody(html, r ? { kind: `mortal-${group}`, slug, category: null, custom: !!r.custom } : null);
}
async function _v20OpenMortModal(group, slug) {
  _v20OpenLibModalShell();
  await ensureMortLib(group);
  _v20RenderMortDetail(group, slug);
}

// Точка входа вкладки «Смертные» — зеркалит loadKindred (:1573), но циклом по группам вместо
// трёх ручных if — здесь оправдано и не противоречит решению «не обобщать Кланы/Секты/Титулы»
// (Часть II §3.4 анализа): там разные схемы карточек, здесь одна на все пять.
const MORT_GROUPS = ['government', 'religious', 'crime', 'civic', 'positions'];
async function loadMortalLib(which) {
  for (const group of MORT_GROUPS) {
    if (which && which !== group) continue;
    const body = document.getElementById(`lib-mortal-${group}-body`);
    if (body && !_mortLibCache.has(group)) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
    await ensureMortLib(group);
    await _libRenderMortList(group);
  }
}
```

Делегаты (второй уровень вкладок `data-mort-group` — по образцу `data-kin-group`, найти его
обработчик в `scripts.js` через grep `data-kin-group` и завести рядом симметричный на
`data-mort-group`/`.mortal-subpanel`; карточка/детейл-клик — рядом с уже существующими
`lib-titles-body`-обработчиком, `v20-sheet.js:1565-1568`):
```js
document.addEventListener('click', e => {
  const card = e.target.closest('[data-mort-slug]');
  if (card) { _v20OpenMortModal(card.dataset.mortGroup, card.dataset.mortSlug); return; }
  const back = e.target.closest('[data-mort-back]');
  if (back) { _libRenderMortList(back.dataset.mortGroup); /* остаёмся в модалке-списке, не детейле — нужен свой рендер-список-в-модалке, см. примечание ниже */ }
});
```
**Примечание:** в отличие от Кланов/Секты/Титулов (у которых нет отдельного «списка внутри
детейл-модалки» — они живут только на странице `#page-library`, детейл открывается прямо с
карточки страницы), «Смертные»-записи по этому контракту тоже открываются только со страницы
(не из ссылки внутри листа персонажа, как Дисциплины/Психика) — значит `data-mort-back` не
нужен вовсе, кнопка «← к списку» и модалка-список для «Смертные» **не требуются**, закрытие детейла
идёт обычным ✕/Escape/фон (как у Клана/Секты/Титула, `:1560-1568`, а не как у Дисциплины/Психики
с их «список ↔ детейл» внутри одной модалки). Упрощает `_v20RenderMortDetail` — убрать
`data-mort-back`-кнопку из разметки перед реализацией.

## B.4 Форма создания/правки — 5 записей в `_LIB_KIND_CONFIG`

`library-authoring.js:61-102`, добавить (по образцу `sects`, `:88-91`):
```js
'mortal-government': { title: 'службу', fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('government'); return loadMortalLib('government'); } },
'mortal-religious':  { title: 'организацию', fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('religious'); return loadMortalLib('religious'); } },
'mortal-crime':      { title: 'группировку', fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('crime'); return loadMortalLib('crime'); } },
'mortal-civic':      { title: 'организацию', fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('civic'); return loadMortalLib('civic'); } },
'mortal-positions':  { title: 'должность', fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('positions'); return loadMortalLib('positions'); } },
```
`_libFindRecord` (`library-authoring.js:233-243`) — добавить пять веток:
```js
if (kind.startsWith('mortal-')) return _mortBySlug(kind.slice('mortal-'.length), slug);
```
(одна строка вместо пяти — `kind` уже кодирует группу через префикс, симметрично тому, как
`_mortLibCache` индексируется тем же именем группы).

## B.5 Тест-план

- Вкладка «Смертные» — кнопка сразу после «Сородичи», до «Дисциплины» (порядок кнопок).
- Каждая из 5 под-вкладок грузит независимо (переключение не бьёт по сети повторно для уже
  посещённой группы — `_mortLibCache.has(group)` гейт).
- «+ Добавить …» на каждой под-вкладке открывает форму создания с верным заголовком/полями.
- Детейл авторской записи — «✏ Редактировать»/«🗑 Удалить» работают (K1, без изменений).
- Детейл канонической (после того, как появятся канонические записи) — «📋 Создать свою копию»/
  «🖼 Изображение» работают (сиблинг-техспека §10-11, §A.3 выше) без каких-либо специальных
  правок под «Смертные» — общий код уже параметризован по `kind`.
- `LIB_IMAGE_KINDS` (§A.2) включает все 5 новых `kind` — загрузка арта работает и здесь.

---

# §C — Поля смертного/охотника: Секта / Роль в секте / Организация / Должность

**Зависит от §B** — «Организация»/«Должность» физически не работают без библиотеки «Смертные».

## C.1 `INFO_FIELDS_BY_LINEAGE.hunter` — новый литерал (не алиас)

`scripts.js`, после массива `mortal` (после `:2076`, перед `INFO_FIELDS_GENERIC`):
```js
mortal: [
  ['status',       'Статус'],
  ['statusDetails','Детали статуса'],
  ['gender',       'Пол'],
  ['sect',         'Секта'],
  ['sectRole',     'Роль в секте'],
  ['organization', 'Организация'],
  ['position',     'Должность'],
  ['profession',   'Профессия'],
  ['birthYear',    'Год рождения'],
  ['location',     'Домен / Локация'],
  ['relatives',    'Родственники'],
  ['attitude',     'Отношение к сверхъестественному'],
  ['hierarchy',    'Титул'],
  ['role',         'Роль'],
  ['nature',       'Натура'],
  ['demeanor',     'Маска'],
  ['belonging',    'Принадлежность'],
  ['want',       'Хочет'],
  ['fear',       'Боится'],
  ['leverage',   'Рычаг'],
],
hunter: [
  ['status',       'Статус'],
  ['statusDetails','Детали статуса'],
  ['gender',       'Пол'],
  ['sect',         'Секта'],
  ['sectRole',     'Роль в секте'],
  ['organization', 'Организация'],
  ['position',     'Должность'],
  ['profession',   'Профессия'],
  ['birthYear',    'Год рождения'],
  ['location',     'Домен / Локация'],
  ['relatives',    'Родственники'],
  ['attitude',     'Отношение к сверхъестественному'],
  ['hierarchy',    'Титул'],
  ['role',         'Роль'],
  ['nature',       'Натура'],
  ['demeanor',     'Маска'],
  ['belonging',    'Принадлежность'],
  ['want',       'Хочет'],
  ['fear',       'Боится'],
  ['leverage',   'Рычаг'],
],
```
(Дублирование литералов — намеренное решение Часть III §1 анализа, не забыть при код-ревью:
это НЕ «забыли вынести общую переменную», это осознанный выбор.)

`REQUIRED_INFO_KEY` (`:2098`) — добавить `hunter: 'profession'`:
```js
const REQUIRED_INFO_KEY = { vampire: 'clan', fairy: 'race', mortal: 'profession', hunter: 'profession' };
```

## C.2 Бэкенд — новые ключи полей

`web/lib/db.js:516-552` (`EDITABLE_FIELD_MAP`), добавить перед закрывающей `}` (`:552`):
```js
  sectRole:     'Роль в секте',
  organization: 'Организация',
  position:     'Должность',
```
(`sect`/`profession` уже есть, `:521,531` — переиспользуются без изменений.)

`web/lib/parsers/character.js`, после `:161` (`if (k === 'Отношение к сверхъестественному')`),
перед закрывающей `}` цикла (`:162`):
```js
    if (k === 'Роль в секте')                   c.sectRole      = v;   // смертные/охотники
    if (k === 'Организация')                    c.organization  = v;   // смертные/охотники
    if (k === 'Должность')                      c.position      = v;   // смертные/охотники
```

## C.3 Разметка полей в `_enterInfoEdit`

`char-detail.js` — ветка `key === 'hierarchy'` (`:1131`) уже гейтит по линейке
(`_lineageOf(_editCharSlug) !== 'fairy'`) — новые ветки следуют тому же приёму, гейт на
`mortal`/`hunter`, до default-ветки (не после — иначе default перехватит раньше). Порядок веток
в файле не важен для рантайма (это `if/else if` цепочка по `key`, не по позиции), но по стилю
кладу их рядом с `hierarchy`/`disciplines`.

### C.3.1 «Секта» — пикер, только для mortal/hunter (вампир не трогается)

```js
} else if (key === 'sect' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
  // Одиночный выбор (Часть III §3.1 анализа) — тот же паттерн, что «Титул»
  // (не «Дисциплины» — секта у персонажа одна). sect для ВАМПИРА этой веткой НЕ
  // перехватывается (гейт по линейке выше) — остаётся обычным текстовым полем, ниже по
  // цепочке default-веткой.
  const wrap = document.createElement('div');
  wrap.className = 'cdet-field-with-pick';
  const inp = document.createElement('input');
  inp.className = 'cdet-field-input';
  inp.dataset.field = key;
  inp.value = current;
  inp.placeholder = 'Неизвестно';
  inp.setAttribute('autocomplete', 'off');
  wrap.appendChild(inp);
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'cdet-lib-pick-btn';
  pickBtn.dataset.pickSect = '1';
  pickBtn.title = 'Выбрать секту из библиотеки';
  pickBtn.setAttribute('aria-label', 'Выбрать секту из библиотеки');
  pickBtn.textContent = '📚';
  wrap.appendChild(pickBtn);

  const outer = document.createElement('div');
  outer.appendChild(wrap);
  outer.insertAdjacentHTML('beforeend', `
    <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-sect-picker" hidden>
      <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-sect-search">
      <div class="v20-lib-list" id="cdet-sect-list"></div>
    </div>`);
  input = outer;
}
```
Одна плоская группа (без «Клановые»/«Все» — секта не зависит от другого поля персонажа) — проще
пикера Титула/Дисциплин: одна `.v20-lib-list`, без `.cdet-lib-picker-group`-обёрток.

### C.3.2 «Роль в секте» — обычное поле + класс условной видимости

```js
} else if (key === 'sectRole' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
  input = document.createElement('input');
  input.className = 'cdet-field-input';
  input.dataset.field = key;
  input.value = current;
  input.placeholder = 'Неизвестно';
  input.setAttribute('autocomplete', 'off');
}
```
Ничего специального в разметке — условная видимость (C.4) работает через класс на ОБЁРТКЕ строки
(`.cdet-key`+соседний элемент), не на самом инпуте — см. C.4.

### C.3.3 «Организация» — пикер с группировкой по 3 категориям (без «Правительственных служб»)

```js
} else if (key === 'organization' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
  const wrap = document.createElement('div');
  wrap.className = 'cdet-field-with-pick';
  const inp = document.createElement('input');
  inp.className = 'cdet-field-input';
  inp.dataset.field = key;
  inp.value = current;
  inp.placeholder = 'Неизвестно';
  inp.setAttribute('autocomplete', 'off');
  wrap.appendChild(inp);
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'cdet-lib-pick-btn';
  pickBtn.dataset.pickOrganization = '1';
  pickBtn.title = 'Выбрать организацию из библиотеки';
  pickBtn.setAttribute('aria-label', 'Выбрать организацию из библиотеки');
  pickBtn.textContent = '📚';
  wrap.appendChild(pickBtn);

  const outer = document.createElement('div');
  outer.appendChild(wrap);
  const groups = [['religious', 'Религиозные организации'], ['crime', 'Криминал'], ['civic', 'Гражданские организации']];
  outer.insertAdjacentHTML('beforeend', `
    <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-organization-picker" hidden>
      <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-organization-search">
      ${groups.map(([g, label]) => `
        <div class="cdet-lib-picker-group" data-group="${g}">
          <div class="cdet-lib-picker-group-label">${label}</div>
          <div class="v20-lib-list" id="cdet-organization-list-${g}"></div>
        </div>`).join('')}
    </div>`);
  input = outer;
}
```
**Не включает «Правительственные службы»** — Часть III §3.3 анализа явно оставляет её только
для «Государственные фракции» на странице города (§D.3 ниже), не для поля персонажа
«Организация». Три группы — все ВСЕГДА видимые (не скрываются при пустоте, как «Клановые» у
Дисциплин) — здесь нет «приоритетной» группы, все три равноправны.

### C.3.4 «Должность» — пикер по образцу «Титула», условная видимость от «Организации»

```js
} else if (key === 'position' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
  const wrap = document.createElement('div');
  wrap.className = 'cdet-field-with-pick';
  const inp = document.createElement('input');
  inp.className = 'cdet-field-input';
  inp.dataset.field = key;
  inp.value = current;
  inp.placeholder = 'Неизвестно';
  inp.setAttribute('autocomplete', 'off');
  wrap.appendChild(inp);
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'cdet-lib-pick-btn';
  pickBtn.dataset.pickPosition = '1';
  pickBtn.title = 'Выбрать должность из библиотеки';
  pickBtn.setAttribute('aria-label', 'Выбрать должность из библиотеки');
  pickBtn.textContent = '📚';
  wrap.appendChild(pickBtn);

  const outer = document.createElement('div');
  outer.appendChild(wrap);
  outer.insertAdjacentHTML('beforeend', `
    <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-position-picker" hidden>
      <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-position-search">
      <div class="v20-lib-list" id="cdet-position-list"></div>
    </div>`);
  input = outer;
}
```

## C.4 Условная видимость — CSS-класс, не вставка/удаление DOM

**Решение Часть III §3.5 анализа** — строки «Роль в секте»/«Должность» ВСЕГДА в DOM (как любое
другое поле, C.3.2/C.3.4 выше их не отличают структурно), скрываются классом. Точка входа —
после того, как `_enterInfoEdit` отрисовала все поля (весь `grid.innerHTML` собран), один проход
устанавливает начальное состояние, дальше — input-делегат живо переключает при вводе.

```js
// char-detail.js, рядом с существующим input-делегатом Клан→Дисциплины (сиблинг-техспека §5.1)
function _cdetSyncConditionalRow(triggerKey, targetKey) {
  const trigger = document.querySelector(`.cdet-field-input[data-field="${triggerKey}"]`);
  const targetInput = document.querySelector(`.cdet-field-input[data-field="${targetKey}"]`);
  if (!trigger || !targetInput) return;
  // Строка — .cdet-key + соседний элемент (тот же generic-паттерн, что уже использует
  // _exitInfoEdit, сиблинг-техспека §6) — targetInput может быть внутри top-level wrapper'а
  // (organization/position — .cdet-field-with-pick+панель), значит скрываем сам wrapper
  // (closest('.cdet-key + *')-эквивалент — здесь проще: targetInput.closest берёт ближайшего
  // предка, который является прямым сиблингом .cdet-key, т.е. корневой элемент строки).
  let row = targetInput;
  while (row.parentElement && !row.parentElement.classList.contains('cdet-grid')) row = row.parentElement;
  const key = document.querySelector(`.cdet-key[data-cond-for="${targetKey}"]`) // см. ниже — метка ставится при рендере
    || row.previousElementSibling;
  const hasValue = !!trigger.value.trim();
  row.classList.toggle('cdet-cond-hidden', !hasValue);
  if (key) key.classList.toggle('cdet-cond-hidden', !hasValue);
}

function _cdetInitConditionalRows() {
  _cdetSyncConditionalRow('sect', 'sectRole');
  _cdetSyncConditionalRow('organization', 'position');
}
// Вызывается один раз сразу после отрисовки полей режима правки (конец _enterInfoEdit).

document.addEventListener('input', e => {
  if (e.target.matches('.cdet-field-input[data-field="sect"]')) _cdetSyncConditionalRow('sect', 'sectRole');
  if (e.target.matches('.cdet-field-input[data-field="organization"]')) _cdetSyncConditionalRow('organization', 'position');
});
```
```css
.cdet-cond-hidden { display: none; }
```
`_cdetInitConditionalRows()` вызывается в конце `_enterInfoEdit` (после того, как весь `grid`
собран) — при заходе в правку с уже заполненной «Секта»/«Организация» строки-потомки сразу
видны, не требуют лишнего ввода для проявления (Часть III §3.5 анализа, последний абзац).

**Просмотр (не-edit режим)** — ничего не меняется: `cdet-opt-empty` (`char-detail.js:52-54`)
уже прячет пустые необязательные поля независимо от `cdet-cond-hidden` — оба класса решают
одну и ту же визуальную задачу в разных режимах, не конфликтуют (edit-режим строит разметку
заново через `_enterInfoEdit`, не переиспользует view-режимные классы на тех же узлах).

## C.5 Toggle-делегаты для трёх новых пикеров — одиночный выбор

Расширение существующего клик-делегата (`char-detail.js:1283-1307` + ветки Часть I техспеки
§5 для Дисциплин) — три новые ветки, все **одиночный выбор** (клик = записать значение +
закрыть панель + фокус в поле, тот же код, что уже даёт `titleItem`-ветка для Титула, только
другой источник данных и другое целевое поле):

```js
  const sectPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-sect]');
  if (sectPickBtn) {
    const picker = document.getElementById('cdet-sect-picker');
    if (picker.hidden) { picker.hidden = false; await _renderSectPickerList(''); } else { picker.hidden = true; }
    return;
  }
  const sectItem = e.target.closest('#cdet-sect-picker .v20-lib-item');
  if (sectItem) {
    const sectInput = document.querySelector('.cdet-field-input[data-field="sect"]');
    if (sectInput) {
      sectInput.value = sectItem.dataset.name || '';
      sectInput.dispatchEvent(new Event('input', { bubbles: true })); // держит «Роль в секте» в синхроне (C.4)
    }
    document.getElementById('cdet-sect-picker').hidden = true;
    sectInput?.focus();
    return;
  }

  const orgPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-organization]');
  if (orgPickBtn) {
    const picker = document.getElementById('cdet-organization-picker');
    if (picker.hidden) { picker.hidden = false; await _renderOrganizationPickerList(''); } else { picker.hidden = true; }
    return;
  }
  const orgItem = e.target.closest('#cdet-organization-picker .v20-lib-item');
  if (orgItem) {
    const orgInput = document.querySelector('.cdet-field-input[data-field="organization"]');
    if (orgInput) {
      orgInput.value = orgItem.dataset.name || '';
      orgInput.dispatchEvent(new Event('input', { bubbles: true })); // держит «Должность» в синхроне (C.4)
    }
    document.getElementById('cdet-organization-picker').hidden = true;
    orgInput?.focus();
    return;
  }

  const posPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-position]');
  if (posPickBtn) {
    const picker = document.getElementById('cdet-position-picker');
    if (picker.hidden) { picker.hidden = false; await _renderPositionPickerList(''); } else { picker.hidden = true; }
    return;
  }
  const posItem = e.target.closest('#cdet-position-picker .v20-lib-item');
  if (posItem) {
    const posInput = document.querySelector('.cdet-field-input[data-field="position"]');
    if (posInput) posInput.value = posItem.dataset.name || '';
    document.getElementById('cdet-position-picker').hidden = true;
    posInput?.focus();
    return;
  }
```

Рендер-функции (поиск по каждой панели, `.v20-lib-item` без ✓-пометки — одиночный выбор,
пометка «уже выбрано» не нужна, элемент не может быть «частично выбран», в отличие от списка
Дисциплин):
```js
function _sectItemHtml(s) {
  return `<button type="button" class="v20-lib-item" data-name="${escAttr(s.name)}"><span>${escHtml(s.name)}</span></button>`;
}
async function _renderSectPickerList(query) {
  await ensureSects();
  const q = (query || '').toLowerCase();
  const list = (_sectsCache || []).filter(s => !q || s.name.toLowerCase().includes(q));
  const box = document.getElementById('cdet-sect-list');
  if (box) box.innerHTML = list.length ? list.map(_sectItemHtml).join('')
    : '<div class="cdet-empty">Ничего не найдено — можно ввести название вручную.</div>';
}

async function _renderOrganizationPickerList(query) {
  const groups = ['religious', 'crime', 'civic'];
  await Promise.all(groups.map(ensureMortLib));
  const q = (query || '').toLowerCase();
  for (const g of groups) {
    const list = (_mortLibCache.get(g) || []).filter(r => !q || r.name.toLowerCase().includes(q));
    const box = document.getElementById(`cdet-organization-list-${g}`);
    if (box) box.innerHTML = list.length ? list.map(r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`).join('')
      : '<div class="cdet-empty">Ничего не найдено.</div>';
  }
}

async function _renderPositionPickerList(query) {
  await ensureMortLib('positions');
  const q = (query || '').toLowerCase();
  const list = (_mortLibCache.get('positions') || []).filter(r => !q || r.name.toLowerCase().includes(q));
  const box = document.getElementById('cdet-position-list');
  if (box) box.innerHTML = list.length ? list.map(r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`).join('')
    : '<div class="cdet-empty">Ничего не найдено — можно ввести название вручную.</div>';
}
```
Поиск-делегат (расширение `char-detail.js:1308-1310`/сиблинг-техспеки §5):
```js
document.addEventListener('input', e => {
  if (e.target.id === 'cdet-title-search') _renderTitlePickerLists(e.target.value);
  if (e.target.id === 'cdet-discipline-search') _renderDisciplinePickerLists(e.target.value);
  if (e.target.id === 'cdet-sect-search') _renderSectPickerList(e.target.value);
  if (e.target.id === 'cdet-organization-search') _renderOrganizationPickerList(e.target.value);
  if (e.target.id === 'cdet-position-search') _renderPositionPickerList(e.target.value);
});
```

## C.6 `_exitInfoEdit` — без изменений

Тот же `.cdet-key + *`-generic-restore (сиблинг-техспека §6) корректно сворачивает любую из
новых wrapper-структур (Секта/Организация/Должность) обратно в `.cdet-val` — подтверждено тем же
рассуждением, что уже применялось к Титулу/Дисциплинам: структура top-level элемента одинакова
(`outer` div с `wrap`+панелью внутри), паттерн restore не смотрит на содержимое, только на
позицию относительно `.cdet-key`.

## C.7 Тест-план

- Открыть смертного → вкладка «Информация» → режим правки: порядок полей — …, Секта, Роль в
  секте (скрыто, Секта пуста), Организация, Должность (скрыто), Профессия, … (C.1 порядок).
- Заполнить «Секта» через пикер → «Роль в секте» немедленно становится видимой и редактируемой
  (без перезахода в режим правки).
- Заполнить «Организация» через пикер (панель с 3 группами, без «Правительственных служб» —
  сверить, что группы `government` физически нет в панели) → «Должность» становится видимой.
- Очистить «Организация» вручную (стереть текст) → «Должность» скрывается обратно (но
  ВВЕДЁННОЕ туда значение не стирается — просто прячется; повторный ввод в «Организация»
  показывает «Должность» снова с прежним значением, не пустую — поведение «спрятать», не
  «забыть»).
- Открыть охотника → те же поля, тот же порядок (`INFO_FIELDS_BY_LINEAGE.hunter`) — включая
  «Профессия», которой раньше у охотника не было вовсе (регресс-тест на C.1, `REQUIRED_INFO_KEY`
  тоже — «!»-флаг у пустой «Профессии»).
- Оборотень/маг (`INFO_FIELDS_GENERIC`) — без изменений, поля Секта/Организация/Должность НЕ
  появляются (не входят в объём этой техспеки).
- Вампир — поле «Секта» остаётся простым текстом БЕЗ кнопки 📚 (регресс на гейт `['mortal',
  'hunter'].includes(...)` в C.3.1).
- Сохранение (`_saveInfoFields`) — новые поля уходят в PUT как обычные строки, точка сохранения
  не в курсе пикеров (то же рассуждение, что уже подтверждено для Дисциплин, сиблинг-техспека
  §7) — но **дополнительно проверить**, что `EDITABLE_FIELD_MAP`/парсер (C.2) реально
  прочитывают/записывают `sectRole`/`organization`/`position` round-trip (сохранить → перезайти
  в карточку → значения на месте) — это НЕ то же самое переиспользование, что у Дисциплин
  (там ключ `disciplines` уже существовал), здесь три ключа целиком новые.

---

# §D — Фракции города: добавление из библиотеки

**§D.1/D.2 не зависят от §B.** **§D.3 зависит от §B** (читает те же 4 эндпоинта «Смертные»).

## D.1 Упразднение хардкод-констант

`city.js:74-75` — удалить:
```js
const CITY_SECTS = ['Камарилья', 'Анархи', 'Шабаш'];
const CITY_INDEPENDENT_CLANS = ['Ассамиты', 'Следующие Луны', 'Джованни', 'Равнос'];
```

## D.2 «Секты»/«Независимые кланы» — добавление из библиотеки, асинхронная классификация

`_cityFactionsEditorHtml` (`:664-691`) вызывается синхронно из нескольких мест (форма создания
и форма редактирования) — переводится в `async`, вызывающий код (`openCityDetail`-эквивалент
для формы правки, форма создания) обязан дождаться промиса перед вставкой в DOM. Требует
`await ensureSects(); await ensureClans();` (уже существующие кэширующие функции, `v20-sheet.js
:1391,1453`) ДО построения списка чипов — иначе первая отрисовка увидит пустые кэши (Часть IV
§3.2 анализа).

```js
async function _cityFactionsEditorHtml(sec) {
  await ensureSects();
  await ensureClans();
  const sectNames = new Set((_sectsCache || []).map(s => s.name));
  const indepClans = (_clansCache || []).filter(c => c.sect === 'Независимые');
  const indepClanNames = new Set(indepClans.map(c => c.name));

  const all = String(sec.factions || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
  const sectsSelected = all.filter(l => sectNames.has(l));
  const clansSelected = all.filter(l => indepClanNames.has(l));
  const other = all.filter(l => !sectNames.has(l) && !indepClanNames.has(l));

  const chip = name => `<button type="button" class="cdet-faction-chip" aria-pressed="true" data-faction="${escAttr(name)}">${escHtml(name)} <span class="cdet-faction-chip-remove">✕</span></button>`;

  return `
    <div class="form-group">
      <label class="form-label">Фракции<span class="field-tip" tabindex="0" data-tip="Секты и независимые кланы, реально присутствующие в городе.">ⓘ</span></label>
      <div class="cdet-rels-hint">Секты и независимые кланы, присутствующие в городе.</div>

      <div class="cdet-faction-group-label">Секты
        <button type="button" class="cdet-lib-pick-btn" data-pick-faction="sects" title="Добавить секту из библиотеки">📚</button>
      </div>
      <div class="cdet-faction-chips" data-faction-group="sects">${sectsSelected.map(chip).join('')}</div>
      <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-faction-sects-picker" hidden>
        <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-faction-sects-search">
        <div class="v20-lib-list" id="cdet-faction-sects-list"></div>
      </div>

      <div class="cdet-faction-group-label" style="margin-top:14px">Независимые кланы
        <button type="button" class="cdet-lib-pick-btn" data-pick-faction="clans" title="Добавить клан из библиотеки">📚</button>
      </div>
      <div class="cdet-faction-chips" data-faction-group="clans">${clansSelected.map(chip).join('')}</div>
      <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-faction-clans-picker" hidden>
        <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-faction-clans-search">
        <div class="v20-lib-list" id="cdet-faction-clans-list"></div>
      </div>

      <div class="cdet-faction-group-label" style="margin-top:14px">Другие фракции${fieldTip(CITY_FIELD_TIPS['Другие фракции'])}</div>
      <textarea class="form-control" data-city-field="factions-other" rows="2"
        placeholder="По строке на фракцию вне списка (напр. Инконню)…">${escHtml(other.join('\n'))}</textarea>

      <div class="cdet-faction-group-label" style="margin-top:14px">Фракции смертных${fieldTip(CITY_FIELD_TIPS['Фракции смертных'])}
        <button type="button" class="cdet-lib-pick-btn" data-pick-faction="mortal" title="Добавить из библиотеки «Смертные»">📚</button>
      </div>
      <textarea class="form-control" data-city-field="factions-mortal-list" rows="2"
        placeholder="По строке на фракцию (напр. Полиция, Городской совет)…">${escHtml(String(sec.factionsMortal || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean).join('\n'))}</textarea>
      <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-faction-mortal-picker" hidden>
        <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-faction-mortal-search">
        <div class="cdet-lib-picker-group" data-group="religious"><div class="cdet-lib-picker-group-label">Религиозные организации</div><div class="v20-lib-list" id="cdet-faction-mortal-list-religious"></div></div>
        <div class="cdet-lib-picker-group" data-group="crime"><div class="cdet-lib-picker-group-label">Криминал</div><div class="v20-lib-list" id="cdet-faction-mortal-list-crime"></div></div>
        <div class="cdet-lib-picker-group" data-group="civic"><div class="cdet-lib-picker-group-label">Гражданские организации</div><div class="v20-lib-list" id="cdet-faction-mortal-list-civic"></div></div>
      </div>

      <div class="cdet-faction-group-label" style="margin-top:14px">Государственные фракции${fieldTip(CITY_FIELD_TIPS['Государственные фракции'])}
        <button type="button" class="cdet-lib-pick-btn" data-pick-faction="state" title="Добавить из библиотеки «Правительственные службы»">📚</button>
      </div>
      <textarea class="form-control" data-city-field="factions-state-list" rows="2"
        placeholder="По строке на фракцию (напр. DGSI, Интерпол)…">${escHtml(String(sec.factionsState || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean).join('\n'))}</textarea>
      <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-faction-state-picker" hidden>
        <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-faction-state-search">
        <div class="v20-lib-list" id="cdet-faction-state-list"></div>
      </div>
    </div>`;
}
```

**Чипы теперь генерируются только для УЖЕ выбранных** (не для всего каталога, как раньше) —
`selected`-массив рендерится напрямую, без прохода по фиксированному списку опций. Добавленный
через пикер элемент — новый чип с `aria-pressed="true"` сразу; крестик `.cdet-faction-chip-
remove` внутри чипа — явная подсказка «клик = убрать» (раньше это было неочевидно у тумблера,
здесь чип — уже добавленный элемент, не переключатель состояния).

`_collectFactions`/`_collectFactionsMortal`/`_collectFactionsState` (`:694-710`) — **без
изменений**, они уже читают `.cdet-faction-chip[aria-pressed="true"]`/textarea напрямую, не
знают о происхождении чипа (Часть IV §3.4 анализа).

Клик-делегат — расширение (рядом с существующим `.cdet-faction-chip` toggle-обработчиком,
`:1367` область):
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
      // Чип: toggle add/remove по имени (как «Дисциплины», не как «Секта»-поле персонажа —
      // здесь МОЖЕТ быть несколько фракций одновременно).
      const group = document.querySelector(`.cdet-faction-chips[data-faction-group="${which}"]`);
      const existing = group?.querySelector(`.cdet-faction-chip[data-faction="${CSS.escape(name)}"]`);
      if (existing) existing.remove();
      else group?.insertAdjacentHTML('beforeend', `<button type="button" class="cdet-faction-chip" aria-pressed="true" data-faction="${escAttr(name)}">${escHtml(name)} <span class="cdet-faction-chip-remove">✕</span></button>`);
    } else {
      // Фракции смертных/Государственные — построчный toggle в textarea (§D.3).
      const field = which === 'mortal' ? 'factions-mortal-list' : 'factions-state-list';
      const ta = document.querySelector(`[data-city-field="${field}"]`);
      if (ta) {
        const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
        const idx = lines.indexOf(name);
        if (idx !== -1) lines.splice(idx, 1); else lines.push(name);
        ta.value = lines.join('\n');
      }
    }
    return;
  }
  // Существующий toggle клика по самому чипу (aria-pressed) — остаётся, но теперь клик
  // всегда УБИРАЕТ чип целиком (removeChild), а не переключает aria-pressed на статичной
  // кнопке — заменить существующий обработчик соответствующим образом.
  const chip = e.target.closest('.cdet-faction-chip');
  if (chip) { chip.remove(); return; }
});
```

## D.3 Рендер-функция пикера фракций — один переиспользуемый список

```js
async function _renderFactionPickerList(which, query) {
  const q = (query || '').toLowerCase();
  const itemHtml = r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`;
  if (which === 'sects') {
    await ensureSects();
    const list = (_sectsCache || []).filter(s => !q || s.name.toLowerCase().includes(q));
    document.getElementById('cdet-faction-sects-list').innerHTML = list.map(itemHtml).join('') || '<div class="cdet-empty">Ничего не найдено.</div>';
  } else if (which === 'clans') {
    await ensureClans();
    const list = (_clansCache || []).filter(c => c.sect === 'Независимые' && (!q || c.name.toLowerCase().includes(q)));
    document.getElementById('cdet-faction-clans-list').innerHTML = list.map(itemHtml).join('') || '<div class="cdet-empty">Ничего не найдено.</div>';
  } else if (which === 'mortal') {
    const groups = ['religious', 'crime', 'civic'];
    await Promise.all(groups.map(ensureMortLib));
    for (const g of groups) {
      const list = (_mortLibCache.get(g) || []).filter(r => !q || r.name.toLowerCase().includes(q));
      document.getElementById(`cdet-faction-mortal-list-${g}`).innerHTML = list.map(itemHtml).join('') || '<div class="cdet-empty">Ничего не найдено.</div>';
    }
  } else if (which === 'state') {
    await ensureMortLib('government');
    const list = (_mortLibCache.get('government') || []).filter(r => !q || r.name.toLowerCase().includes(q));
    document.getElementById('cdet-faction-state-list').innerHTML = list.map(itemHtml).join('') || '<div class="cdet-empty">Ничего не найдено.</div>';
  }
}
document.addEventListener('input', e => {
  const m = /^cdet-faction-(sects|clans|mortal|state)-search$/.exec(e.target.id || '');
  if (m) _renderFactionPickerList(m[1], e.target.value);
});
```

## D.4 Тест-план

- Открыть форму редактирования города → раздел «Секты» — чипов нет, пока ничего не добавлено
  через 📚 (даже если у города уже исторически стоит «Камарилья»/«Анархи» — те рендерятся как
  ПРЕДзаполненные чипы из `sec.factions`, но сам список ОПЦИЙ в панели пикера не преднаселён).
- Открыть панель «Секты» → видно 7 записей библиотеки (Камарилья/Анархи/Шабаш/Независимые/
  Инконню/Инферналисты/Истинная Чёрная Рука), не 3.
- Клик по «Шабаш» → чип появляется под «Секты», панель остаётся открытой (можно добавить ещё).
- Клик по чипу «Шабаш» (крестик) → чип исчезает.
- Открыть панель «Независимые кланы» → видно 14 записей (все `sect === 'Независимые'`), не 4;
  «Следующие Луны» нигде не фигурирует (мёртвый пункт, Часть IV §1 анализа — естественно исчез).
- Открыть уже существующий город (`cities/paris`) → «Камарилья»/«Анархи»/«Ассамиты»/«Джованни»
  сразу распознаются как чипы (совпадают с библиотекой) — «Сеттиты»/«Феи» остаются в «Другие
  фракции» (как и сегодня — они никогда не входили в старый хардкод-список тоже, значит это не
  регресс).
- «Фракции смертных» — 📚 открывает панель с 3 группами (без «Правительственных служб») →
  клик добавляет строку в textarea, повторный клик по тому же элементу — убирает её обратно.
- «Государственные фракции» — 📚 открывает панель с ОДНОЙ группой (Правительственные службы) →
  тот же add/remove.
- Сохранить город → `factions`/`factionsMortal`/`factionsState` в `city.md` — тот же плоский
  формат, что и раньше (проверить `git diff` на существующем городе после правки — только
  реально изменённые строки, не переформатирование всей секции).

---

# §E — Рекомендованный порядок реализации

1. **§B** (вкладка «Смертные») — фундамент для §C и §D.3.
2. **§D.1-D.2** (Секты/Независимые кланы на странице города) — независимо от §B, можно раньше.
3. **§A** (загрузка изображений) — независимо от остального; включить 5 категорий §B в
   `LIB_IMAGE_KINDS`, если делается после §B.
4. **§C** (поля смертного/охотника) — после §B.
5. **§D.3** (Фракции смертных/Государственные — пикеры) — после §B.

(Совпадает с порядком, который уже дал документ-анализ — техспека его не пересматривает.)
