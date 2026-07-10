# Звуковая библиотека (саундборд) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Звуковая библиотека" navigation section — a global, city-independent soundboard where the Storyteller uploads audio tracks (mp3/ogg/wav) and plays several simultaneously during a session, each with its own play/pause, volume, rename, and delete controls, plus a page-level "stop all" button.

**Architecture:** A new plain Express router (`web/routes/audio.js`, no injected dependencies — mirrors `web/routes/library.js`'s export shape) stores tracks in `cities/audio/` (an `index.json` manifest + the audio files themselves, named by a generated id, not the original filename). This directory is entirely `.gitignore`d — each installation builds its own library locally, nothing is committed. Upload uses the same base64-in-JSON pattern the app already uses for character art (`web/routes/characters.js`'s `upload-image` route), because introducing a multipart library (multer) isn't justified when a working pattern already exists. The frontend adds one nav item, one page section, one upload modal, and one new script file (`web/public/audio-library.js`) following the existing library-tab render pattern in `web/public/v20-sheet.js`.

**Tech Stack:** Node.js + Express (existing `web/server.js`), vanilla browser JS (no framework, no bundler — plain `<script>` globals), Node's built-in test runner (`node --test`, existing `web/tests/all.test.js`).

**Spec:** `docs/superpowers/specs/2026-07-10-audio-library-design.md` — read it first; this plan implements it section by section.

---

## File Structure

- **Modify: `web/lib/db.js`** — add `AUDIO_DIR` constant next to `CITIES_DIR`; fix a real bug in `_firstCity()` this feature would otherwise trigger (see Task 1).
- **Create: `web/routes/audio.js`** — GET/POST/PUT/DELETE `/api/audio[/:id]`.
- **Modify: `web/server.js`** — require + mount the new router, mount `express.static` for serving audio files, add a path-scoped higher body-size limit for `/api/audio`.
- **Modify: `.gitignore`** — ignore `cities/audio/` entirely.
- **Modify: `web/public/index.html`** — new nav item, new `#page-audio-library` section, new upload modal.
- **Modify: `web/public/styles.css`** — new `.audio-card` family of rules.
- **Create: `web/public/audio-library.js`** — fetch/render/upload/play/volume/rename/delete/stop-all logic; new file (not folded into `v20-sheet.js` or `scripts.js`) because it's an independent page with no relationship to the V20 sheet or dashboard code those files already own.
- **Modify: `web/tests/all.test.js`** — new `describe('API — audio library', …)` block.

---

### Task 1: `AUDIO_DIR` constant + fix `_firstCity()` collision bug

**Files:**
- Modify: `web/lib/db.js:14-16`, `web/lib/db.js:501-502` (exports)

**Files:**
- [ ] **Step 1: Add the constant and fix the bug**

`web/lib/db.js:14-16` currently reads:
```js
const CITIES_DIR = path.join(ROOT, 'cities');
function _firstCity() { try { return (require('fs').readdirSync(CITIES_DIR, { withFileTypes: true }).find(e => e.isDirectory() && !/^[._]/.test(e.name)) || {}).name || ''; } catch { return ''; } }
const DEFAULT_CITY = process.env.CITY || _firstCity() || '';   // нейтрально: первый существующий город
```
`_firstCity()` picks the first directory under `cities/` whose name doesn't start with `.` or `_` as the fallback city when `CITY` isn't set. `cities/audio/` (introduced by this feature) doesn't start with either character, so once it exists on disk, a server started without `CITY` set could silently pick `audio` as the "active city" instead of a real one. Fix by excluding it explicitly, and add the new constant right after `CITIES_DIR`:

```js
const CITIES_DIR = path.join(ROOT, 'cities');
// AUDIO_DIR — общая для всех городов звуковая библиотека (саундборд), см.
// docs/superpowers/specs/2026-07-10-audio-library-design.md. Не город: должна
// быть исключена из _firstCity() ниже, иначе при отсутствии CITY в окружении
// сервер может подобрать "audio" как активный город (та же директория, без
// ведущей точки/подчёркивания, иначе неотличима от настоящих городов).
const AUDIO_DIR = path.join(CITIES_DIR, 'audio');
function _firstCity() { try { return (require('fs').readdirSync(CITIES_DIR, { withFileTypes: true }).find(e => e.isDirectory() && !/^[._]/.test(e.name) && e.name !== 'audio') || {}).name || ''; } catch { return ''; } }
const DEFAULT_CITY = process.env.CITY || _firstCity() || '';   // нейтрально: первый существующий город
```

- [ ] **Step 2: Export `AUDIO_DIR`**

`web/lib/db.js:501-502` currently reads:
```js
module.exports = {
  ROOT, CITIES_DIR, DEFAULT_CITY,
```
Change to:
```js
module.exports = {
  ROOT, CITIES_DIR, AUDIO_DIR, DEFAULT_CITY,
```

- [ ] **Step 3: Verify by running the existing test suite (nothing should break)**

Run: `cd web && npm run test:unit`
Expected: all existing tests still pass (this step only added a constant and narrowed a filter; no existing behavior should change unless a `cities/audio` directory already existed on disk, which it doesn't yet).

- [ ] **Step 4: Commit**

```bash
git add web/lib/db.js
git commit -m "fix: exclude cities/audio from _firstCity() default-city detection"
```

---

### Task 2: `web/routes/audio.js` — GET list + POST upload

**Files:**
- Create: `web/routes/audio.js`
- Modify: `web/server.js:20-22` (import), `web/server.js` (add router require near line 25-35), `web/server.js:70-84` (body-limit + static mount), `web/server.js:181-185` (mount router)
- Modify: `.gitignore`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to `web/tests/all.test.js`, right after the existing `describe('Image upload', …)` block (search for `describe('Image upload'` to find it — it ends with `});` followed by the closing of its parent `describe`). Add at the same nesting level as `Image upload` (i.e., as a sibling top-level `describe`, not nested inside it) — put it directly after that whole block's closing `});`:

```js
describe('API — audio library', () => {
  const AUDIO_ROOT = path.join(__dirname, '../../cities/audio');
  const INDEX_PATH = path.join(AUDIO_ROOT, 'index.json');

  // cities/audio/ doesn't exist until first use — snapshot whatever's there
  // (nothing, on a clean checkout) so every test can restore it exactly.
  let indexExisted, originalIndex;
  before(async () => {
    originalIndex = await fs.readFile(INDEX_PATH, 'utf-8').catch(() => null);
    indexExisted = originalIndex !== null;
  });
  after(async () => {
    if (indexExisted) await fs.writeFile(INDEX_PATH, originalIndex, 'utf-8');
    else await fs.rm(INDEX_PATH, { force: true });
  });

  it('GET /api/audio — пустой список на чистой установке', async () => {
    if (indexExisted) return; // только на чистом манифесте показателен
    const { status, body } = await apiJson('/api/audio');
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it('POST /api/audio — отклоняет неподдерживаемый формат', async () => {
    const { status, body } = await apiJson('/api/audio', {
      method: 'POST',
      body: JSON.stringify({ title: 'Тест', filename: 'x.flac', mimetype: 'audio/flac', data: 'AAAA' }),
    });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it('POST /api/audio — отклоняет пустое название', async () => {
    const { status } = await apiJson('/api/audio', {
      method: 'POST',
      body: JSON.stringify({ title: '   ', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA' }),
    });
    assert.equal(status, 400);
  });

  it('POST /api/audio — отклоняет файл больше 20МБ', async () => {
    const bigBuf = Buffer.alloc(20 * 1024 * 1024 + 10);
    const { status, body } = await apiJson('/api/audio', {
      method: 'POST',
      body: JSON.stringify({ title: 'Слишком большой', filename: 'big.mp3', mimetype: 'audio/mpeg', data: bigBuf.toString('base64') }),
    });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it('POST /api/audio — сохраняет файл и запись в index.json; GET возвращает его', async () => {
    let created = null;
    try {
      const { status, body } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Гроза за окном', filename: 'storm.wav', mimetype: 'audio/wav', data: 'UklGRiQAAABXQVZFZm10' }),
      });
      assert.equal(status, 200);
      assert.equal(body.title, 'Гроза за окном');
      assert.equal(body.ext, 'wav');
      assert.equal(body.volume, 1);
      assert.ok(body.id);
      assert.equal(body.url, `/audio-lib/${body.id}.wav`);
      created = body.id;

      const writtenPath = path.join(AUDIO_ROOT, `${body.id}.wav`);
      const written = await fs.readFile(writtenPath);
      assert.ok(written.length > 0, 'аудиофайл должен быть записан на диск');

      const { status: listStatus, body: list } = await apiJson('/api/audio');
      assert.equal(listStatus, 200);
      assert.ok(list.some(t => t.id === created && t.title === 'Гроза за окном'));
    } finally {
      if (created) {
        await fs.rm(path.join(AUDIO_ROOT, `${created}.wav`), { force: true });
        const list = JSON.parse(await fs.readFile(INDEX_PATH, 'utf-8').catch(() => '[]'));
        await fs.writeFile(INDEX_PATH, JSON.stringify(list.filter(t => t.id !== created), null, 2), 'utf-8');
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm run test:unit`
Expected: FAIL — `GET /api/audio` and `POST /api/audio` both return 404 (no route registered yet), so every assertion in the new block fails.

- [ ] **Step 3: Implement `web/routes/audio.js`**

Create `web/routes/audio.js`:
```js
'use strict';
// Роутер звуковой библиотеки (саундборд) — общая для всех городов коллекция
// аудиодорожек. Хранится в cities/audio/ (index.json + файлы по id), см.
// docs/superpowers/specs/2026-07-10-audio-library-design.md. Ничего здесь не
// коммитится в git (.gitignore) — каждая установка собирает свою библиотеку.

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const crypto  = require('crypto');
const { serverError } = require('../lib/http');
const { AUDIO_DIR, writeFileAtomic } = require('../lib/db');

const router = express.Router();

const INDEX_PATH = path.join(AUDIO_DIR, 'index.json');

const MIME_EXT = {
  'audio/mpeg':  'mp3',
  'audio/ogg':   'ogg',
  'audio/wav':   'wav',
  'audio/x-wav': 'wav',
};
const MAX_BYTES = 20 * 1024 * 1024; // 20MB, см. спеку

async function readIndex() {
  const raw = await fs.readFile(INDEX_PATH, 'utf-8').catch(() => null);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function writeIndex(list) {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await writeFileAtomic(INDEX_PATH, JSON.stringify(list, null, 2), 'utf-8');
}

router.get('/api/audio', async (_req, res) => {
  try {
    const list = await readIndex();
    res.json(list.map(t => ({ ...t, url: `/audio-lib/${t.id}.${t.ext}` })));
  } catch (e) { serverError(res, e); }
});

router.post('/api/audio', async (req, res) => {
  try {
    const { title, filename, mimetype, data } = req.body || {};
    const ext = MIME_EXT[mimetype];
    if (!ext) return res.status(400).json({ error: 'Неподдерживаемый формат аудио (нужен mp3/ogg/wav)' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Название не может быть пустым' });
    if (!data) return res.status(400).json({ error: 'Файл не передан' });

    const buf = Buffer.from(data, 'base64');
    if (buf.length > MAX_BYTES) return res.status(400).json({ error: 'Файл больше 20МБ' });

    const id = crypto.randomUUID();
    await fs.mkdir(AUDIO_DIR, { recursive: true });
    await writeFileAtomic(path.join(AUDIO_DIR, `${id}.${ext}`), buf);

    const list = await readIndex();
    const entry = {
      id, ext, filename: filename || `${id}.${ext}`,
      title: title.trim(), volume: 1, createdAt: new Date().toISOString(),
    };
    list.push(entry);
    await writeIndex(list);

    res.json({ ...entry, url: `/audio-lib/${id}.${ext}` });
  } catch (e) { serverError(res, e); }
});

module.exports = { router, readIndex, writeIndex };
```

- [ ] **Step 4: Mount the router and static file serving in `web/server.js`**

`web/server.js:20-22` currently reads:
```js
const {
  CITIES_DIR, reqCity, writeFileAtomic, setBrokenLinks,
} = require('./lib/db');
```
Change to:
```js
const {
  CITIES_DIR, AUDIO_DIR, reqCity, writeFileAtomic, setBrokenLinks,
} = require('./lib/db');
```

Right after `web/server.js:25` (`const { router: libraryRouter, loadDisciplines, loadPsychics } = require('./routes/library');`), add:
```js
const { router: audioRouter } = require('./routes/audio');
```

`web/server.js:70-76` currently reads:
```js
app.use(compression());
app.use(express.json({ limit: '20mb' }));
// maxAge lets the browser reuse the heavy app shell between loads; ETag/Last-Modified
// still revalidate after it expires, so edits during development surface within minutes.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
// Serve images straight out of cities/<city>/… (characters/<lin>/<slug>/art/, locations/…)
app.use('/city-img', express.static(CITIES_DIR, { maxAge: '1h' }));
```
Change to:
```js
app.use(compression());
// /api/audio needs a higher body-size limit than the rest of the app (base64
// inflates a 20MB audio file to ~27MB) — this MUST be registered before the
// general express.json below. body-parser sets req._body once it parses a
// request, and every later json() middleware silently no-ops on re-entry —
// so if the general 20mb parser ran first for this path, it would already
// reject any oversized /api/audio upload before this route-specific limit is
// ever consulted.
app.use('/api/audio', express.json({ limit: '30mb' }));
app.use(express.json({ limit: '20mb' }));
// maxAge lets the browser reuse the heavy app shell between loads; ETag/Last-Modified
// still revalidate after it expires, so edits during development surface within minutes.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
// Serve images straight out of cities/<city>/… (characters/<lin>/<slug>/art/, locations/…)
app.use('/city-img', express.static(CITIES_DIR, { maxAge: '1h' }));
// Serve uploaded soundboard audio files straight out of cities/audio/ (routes/audio.js).
app.use('/audio-lib', express.static(AUDIO_DIR, { maxAge: '1h' }));
```

`web/server.js:181-185` currently reads (the "Доменные роутеры" block):
```js
// ── Доменные роутеры (routes/*.js) ────────────────────────────────────────────
app.use(libraryRouter);
app.use(citiesRouter);
app.use(archiveRouter);
app.use(threadsRouter);
```
Change to:
```js
// ── Доменные роутеры (routes/*.js) ────────────────────────────────────────────
app.use(libraryRouter);
app.use(audioRouter);
app.use(citiesRouter);
app.use(archiveRouter);
app.use(threadsRouter);
```

- [ ] **Step 5: Add `.gitignore` entry**

Repo-root `.gitignore` currently starts with:
```gitignore
web/node_modules/
node_modules/
```
Add a new block right after the existing image-extension block (after the line `!web/public/img/**`, before `.claude/settings.local.json`):
```gitignore
!web/public/img/**

# Звуковая библиотека (саундборд) — общая для всех городов, но каждый
# пользователь собирает свою локально: не коммитим ни файлы, ни манифест
# (см. docs/superpowers/specs/2026-07-10-audio-library-design.md).
cities/audio/

.claude/settings.local.json
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: PASS — all 5 new tests in `describe('API — audio library', …)` succeed.

- [ ] **Step 7: Commit**

```bash
git add web/routes/audio.js web/server.js .gitignore web/tests/all.test.js
git commit -m "feat: audio library GET list + POST upload endpoints"
```

---

### Task 3: `web/routes/audio.js` — PUT rename/volume + DELETE

**Files:**
- Modify: `web/routes/audio.js`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the same `describe('API — audio library', …)` block from Task 2, right after the last existing `it(...)` (the "сохраняет файл и запись в index.json" one), before the block's closing `});`:

```js
  it('PUT /api/audio/:id — 404 для несуществующего id', async () => {
    const { status } = await apiJson('/api/audio/__no_such_id__', {
      method: 'PUT', body: JSON.stringify({ title: 'Новое имя' }),
    });
    assert.equal(status, 404);
  });

  it('PUT /api/audio/:id — переименование и громкость; DELETE удаляет файл и запись', async () => {
    const { body: created } = await apiJson('/api/audio', {
      method: 'POST',
      body: JSON.stringify({ title: 'Черновое имя', filename: 'x.ogg', mimetype: 'audio/ogg', data: 'T2dnUw==' }),
    });
    const id = created.id;

    const { status: putStatus, body: updated } = await apiJson(`/api/audio/${id}`, {
      method: 'PUT', body: JSON.stringify({ title: 'Финальное имя', volume: 0.4 }),
    });
    assert.equal(putStatus, 200);
    assert.equal(updated.title, 'Финальное имя');
    assert.equal(updated.volume, 0.4);

    const { status: putEmptyStatus } = await apiJson(`/api/audio/${id}`, {
      method: 'PUT', body: JSON.stringify({ title: '   ' }),
    });
    assert.equal(putEmptyStatus, 400);

    const filePath = path.join(AUDIO_ROOT, `${id}.ogg`);
    assert.ok(await fs.readFile(filePath).then(() => true).catch(() => false));

    const { status: delStatus, body: delBody } = await apiJson(`/api/audio/${id}`, { method: 'DELETE' });
    assert.equal(delStatus, 200);
    assert.equal(delBody.ok, true);
    assert.ok(await fs.readFile(filePath).then(() => false).catch(() => true), 'файл должен быть удалён');

    const { body: listAfter } = await apiJson('/api/audio');
    assert.ok(!listAfter.some(t => t.id === id));
  });

  it('DELETE /api/audio/:id — 404 для несуществующего id', async () => {
    const { status } = await apiJson('/api/audio/__no_such_id__', { method: 'DELETE' });
    assert.equal(status, 404);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm run test:unit`
Expected: FAIL — `PUT`/`DELETE /api/audio/:id` return 404 from Express's default "no route matched" handler for the new tests expecting 200, and the two explicit 404 tests may pass by accident (no route = 404 either way) but the rename/volume/delete-success test fails since nothing is actually renamed/deleted.

- [ ] **Step 3: Implement PUT and DELETE in `web/routes/audio.js`**

Add these two routes to `web/routes/audio.js`, right after the existing `router.post('/api/audio', …)` handler and before `module.exports`:

```js
router.put('/api/audio/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const list = await readIndex();
    const entry = list.find(t => t.id === id);
    if (!entry) return res.status(404).json({ error: 'Звук не найден' });

    if (typeof req.body.title === 'string') {
      const trimmed = req.body.title.trim();
      if (!trimmed) return res.status(400).json({ error: 'Название не может быть пустым' });
      entry.title = trimmed;
    }
    if (typeof req.body.volume === 'number') {
      entry.volume = Math.max(0, Math.min(1, req.body.volume));
    }
    await writeIndex(list);
    res.json(entry);
  } catch (e) { serverError(res, e); }
});

router.delete('/api/audio/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const list = await readIndex();
    const idx = list.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Звук не найден' });

    const [entry] = list.splice(idx, 1);
    await fs.unlink(path.join(AUDIO_DIR, `${entry.id}.${entry.ext}`)).catch(() => {});
    await writeIndex(list);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: PASS — all tests in `describe('API — audio library', …)` succeed (9 tests total across Tasks 2 and 3).

- [ ] **Step 5: Commit**

```bash
git add web/routes/audio.js web/tests/all.test.js
git commit -m "feat: audio library PUT rename/volume + DELETE endpoints"
```

---

### Task 4: Frontend HTML — nav item, page section, upload modal

**Files:**
- Modify: `web/public/index.html`

- [ ] **Step 1: Run impeccable's design-detector context before touching markup**

Per this project's CLAUDE.md rule for frontend work, run:
```
/impeccable audit web/public/index.html
```
Note any pre-existing findings so Task 6's post-change pass can tell what's new versus pre-existing.

- [ ] **Step 2: Add the nav item**

`web/public/index.html:69-71` currently reads:
```html
      <a class="nav-item" data-page="library" title="Библиотека" aria-label="Библиотека">
        <span class="nav-icon">📚</span><span>Библиотека</span>
      </a>
```
Add a new nav item directly after it (before the `tools` nav item at line 72):
```html
      <a class="nav-item" data-page="library" title="Библиотека" aria-label="Библиотека">
        <span class="nav-icon">📚</span><span>Библиотека</span>
      </a>
      <a class="nav-item" data-page="audio-library" title="Звуковая библиотека" aria-label="Звуковая библиотека">
        <span class="nav-icon">🎵</span><span>Звуки</span>
      </a>
```

- [ ] **Step 3: Add the page section**

`web/public/index.html:719-721` currently reads (end of `#page-library`, start of Tools section):
```html
    </section>

    <!-- Tools -->
    <section id="page-tools" class="page">
```
Change to:
```html
    </section>

    <!-- Audio library (soundboard) -->
    <section id="page-audio-library" class="page">
      <div class="page-header">
        <h1 class="page-title">Звуковая библиотека</h1>
        <span class="page-sub">саундборд сессии</span>
        <button class="btn-submit" id="audio-lib-upload-btn" style="margin-left:auto">+ Загрузить звук</button>
        <button class="btn-submit btn-secondary" id="audio-lib-stop-all-btn">⏹ Остановить всё</button>
      </div>
      <div class="lib-cards" id="audio-lib-grid">
        <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
      </div>
    </section>

    <!-- Tools -->
    <section id="page-tools" class="page">
```

- [ ] **Step 4: Add the upload modal**

`web/public/index.html:1264-1271` currently reads:
```html
<!-- ── City Detail Modal ── -->
<div id="city-detail-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="Карточка города">
  <div class="modal-box modal-module-detail">
    <button class="modal-close" id="city-detail-close" aria-label="Закрыть">✕</button>
    <div id="city-detail-content"></div>
  </div>
</div>

<!-- ── Image Lightbox ── -->
```
Change to:
```html
<!-- ── City Detail Modal ── -->
<div id="city-detail-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="Карточка города">
  <div class="modal-box modal-module-detail">
    <button class="modal-close" id="city-detail-close" aria-label="Закрыть">✕</button>
    <div id="city-detail-content"></div>
  </div>
</div>

<!-- ── Audio Upload Modal ── -->
<div id="audio-upload-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="Загрузить звук">
  <div class="modal-box">
    <button type="button" class="modal-close" id="audio-upload-close" aria-label="Закрыть">✕</button>
    <h1 class="page-title" style="margin-bottom:20px">Загрузить звук</h1>
    <form id="audio-upload-form">
      <div class="form-group">
        <label class="form-label" for="audio-upload-title">Название *</label>
        <input class="form-control" id="audio-upload-title" type="text" required placeholder="Например, «Гроза за окном»">
      </div>
      <div class="form-group">
        <label class="form-label" for="audio-upload-file">Аудиофайл (mp3/ogg/wav, до 20МБ) *</label>
        <input class="form-control" id="audio-upload-file" type="file" accept="audio/mpeg,audio/ogg,audio/wav" required>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn-submit" id="audio-upload-submit">Загрузить</button>
        <button type="button" class="btn-submit btn-secondary" id="audio-upload-cancel">Отмена</button>
        <span id="audio-upload-err" class="err" style="display:none"></span>
      </div>
    </form>
  </div>
</div>

<!-- ── Image Lightbox ── -->
```

- [ ] **Step 5: Add the new script tag**

`web/public/index.html:1287-1288` currently reads:
```html
<script src="v20-sheet.js"></script>
<script src="scripts.js"></script>
```
Change to:
```html
<script src="v20-sheet.js"></script>
<script src="audio-library.js"></script>
<script src="scripts.js"></script>
```
(`audio-library.js` doesn't exist on disk yet — created in Task 6. The browser will 404 on it harmlessly until then; this ordering matches `locations.js`/`v20-sheet.js` being loaded before `scripts.js`, whose `navigate()` function will call into it.)

- [ ] **Step 6: Commit**

```bash
git add web/public/index.html
git commit -m "feat: audio library nav item, page section, upload modal markup"
```

---

### Task 5: Frontend CSS — `.audio-card` family

**Files:**
- Modify: `web/public/styles.css`

- [ ] **Step 1: Add the styles**

Find the end of the `.lib-card-sect` rule block (`web/public/styles.css:8124-8139`, the last rule in the "Библиотека — карточки" section — search for `.lib-card-sect {`). Add the new rules directly after that block's closing `}`:

```css
/* ── Звуковая библиотека — карточка звука. Не переиспользует .lib-card
   (которая является целиком кликабельным <button>, открывающим модалку
   деталей) — здесь карточка содержит несколько независимых интерактивных
   элементов разом (play/pause, громкость, переименование, удаление), а
   вложенные интерактивные элементы внутри <button> недопустимы в HTML.
   Сетка (.lib-cards) и цветовая база — общие с остальной библиотекой. ── */
.audio-card {
  width: 200px;
  min-height: 160px;
  background: var(--bg3);
  border: 2px solid var(--border);
  border-radius: 2px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color .2s var(--ease), background .2s var(--ease);
}

.audio-card:hover {
  border-color: rgb(139 0 0 / 40%);
  background: var(--bg4);
}

.audio-card-title {
  font-family: var(--f-heading);
  font-size: var(--fs-sm);
  color: var(--text);
  word-break: break-word;
}

.audio-card-title-input {
  font-family: var(--f-heading);
  font-size: var(--fs-sm);
  color: var(--text);
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: 2px;
  padding: 3px 6px;
  width: 100%;
}

.audio-card-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.audio-card-play-btn {
  width: 44px;
  height: 44px;
  min-width: 44px;
  border-radius: 50%;
  border: 1px solid var(--border2);
  background: var(--bg2);
  color: var(--gold);
  font-size: var(--fs-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color .2s, color .2s;
}

.audio-card-play-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.audio-card-play-btn.playing {
  color: var(--accent);
  border-color: var(--accent);
}

.audio-card-volume {
  flex: 1;
  accent-color: var(--accent);
  height: 44px;
}

.audio-card-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.audio-card-icon-btn {
  width: 44px;
  height: 44px;
  border: none;
  background: none;
  color: var(--text3);
  cursor: pointer;
  font-size: var(--fs-sm);
  transition: color .2s;
}

.audio-card-icon-btn:hover {
  color: var(--accent);
}
```

- [ ] **Step 2: Commit**

```bash
git add web/public/styles.css
git commit -m "feat: audio library card styles"
```

---

### Task 6: Frontend JS — `web/public/audio-library.js`

**Files:**
- Create: `web/public/audio-library.js`
- Modify: `web/public/scripts.js:118` (navigate dispatch)

- [ ] **Step 1: Hook the new page into `navigate()`**

`web/public/scripts.js:118` currently reads:
```js
  if (page === 'library')    loadLibrary();
```
Change to:
```js
  if (page === 'library')    loadLibrary();
  if (page === 'audio-library') loadAudioLibrary();
```

- [ ] **Step 2: Create `web/public/audio-library.js`**

```js
'use strict';
// Звуковая библиотека (саундборд) — карточки-плееры, играющие одновременно.
// Загружается один раз (см. index.html), рендерится при заходе на страницу
// (navigate() в scripts.js), см. docs/superpowers/specs/2026-07-10-audio-library-design.md.

let _audioLibCache = null; // [{ id, ext, filename, title, volume, createdAt, url }]

function _audioLibCardHtml(t) {
  return `<div class="audio-card" data-audio-id="${escAttr(t.id)}">
    <div class="audio-card-title" data-audio-title-view>${escHtml(t.title)}</div>
    <audio data-audio-el src="${escAttr(t.url)}" loop preload="none"></audio>
    <div class="audio-card-row">
      <button type="button" class="audio-card-play-btn" data-audio-play aria-label="Играть/пауза">▶</button>
      <input type="range" class="audio-card-volume" data-audio-volume min="0" max="1" step="0.01" value="${t.volume}">
    </div>
    <div class="audio-card-actions">
      <button type="button" class="audio-card-icon-btn" data-audio-rename aria-label="Переименовать">✎</button>
      <button type="button" class="audio-card-icon-btn" data-audio-delete aria-label="Удалить">🗑</button>
    </div>
  </div>`;
}

function _audioLibRender() {
  const grid = document.getElementById('audio-lib-grid');
  if (!grid) return;
  if (!_audioLibCache.length) {
    grid.innerHTML = '<div class="loading-state">Библиотека пуста — загрузите первый звук.</div>';
    return;
  }
  grid.innerHTML = _audioLibCache.map(_audioLibCardHtml).join('');
}

async function loadAudioLibrary() {
  const grid = document.getElementById('audio-lib-grid');
  if (grid) grid.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    _audioLibCache = await apiFetch('/api/audio');
  } catch (e) {
    showToast('Не удалось загрузить звуковую библиотеку: ' + e.message, 'error');
    _audioLibCache = [];
  }
  _audioLibRender();
}

// ── Play/pause + громкость (делегирование на контейнере, привязано один раз) ──
document.getElementById('audio-lib-grid')?.addEventListener('click', e => {
  const playBtn = e.target.closest('[data-audio-play]');
  if (playBtn) {
    const card = playBtn.closest('.audio-card');
    const audioEl = card.querySelector('[data-audio-el]');
    if (audioEl.paused) { audioEl.play(); playBtn.textContent = '⏸'; playBtn.classList.add('playing'); }
    else { audioEl.pause(); playBtn.textContent = '▶'; playBtn.classList.remove('playing'); }
    return;
  }

  const renameBtn = e.target.closest('[data-audio-rename]');
  if (renameBtn) { _audioLibStartRename(renameBtn.closest('.audio-card')); return; }

  const deleteBtn = e.target.closest('[data-audio-delete]');
  if (deleteBtn) { _audioLibDelete(deleteBtn.closest('.audio-card')); return; }
});

document.getElementById('audio-lib-grid')?.addEventListener('input', e => {
  const slider = e.target.closest('[data-audio-volume]');
  if (!slider) return;
  const card = slider.closest('.audio-card');
  const audioEl = card.querySelector('[data-audio-el]');
  audioEl.volume = parseFloat(slider.value);
  _audioLibDebouncedSaveVolume(card.dataset.audioId, parseFloat(slider.value));
});

let _audioLibVolumeTimers = {};
function _audioLibDebouncedSaveVolume(id, volume) {
  clearTimeout(_audioLibVolumeTimers[id]);
  _audioLibVolumeTimers[id] = setTimeout(async () => {
    try { await apiFetch(`/api/audio/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ volume }),
    }); } catch (e) { showToast('Не удалось сохранить громкость: ' + e.message, 'error'); }
  }, 400);
}

function _audioLibStartRename(card) {
  const titleEl = card.querySelector('[data-audio-title-view]');
  const current = titleEl.textContent;
  const input = document.createElement('input');
  input.className = 'audio-card-title-input';
  input.value = current;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const next = input.value.trim();
    if (!next || next === current) { _audioLibRender(); return; }
    try {
      const id = card.dataset.audioId;
      const updated = await apiFetch(`/api/audio/${encodeURIComponent(id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: next }),
      });
      const entry = _audioLibCache.find(t => t.id === id);
      if (entry) entry.title = updated.title;
    } catch (e) {
      showToast('Не удалось переименовать: ' + e.message, 'error');
    }
    _audioLibRender();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

async function _audioLibDelete(card) {
  const id = card.dataset.audioId;
  const entry = _audioLibCache.find(t => t.id === id);
  if (!await showConfirm(`Удалить «${entry?.title || ''}»?\nДействие необратимо.`, { danger: true, confirmText: 'Удалить' })) return;
  try {
    await apiFetch(`/api/audio/${encodeURIComponent(id)}`, { method: 'DELETE' });
    _audioLibCache = _audioLibCache.filter(t => t.id !== id);
    _audioLibRender();
  } catch (e) {
    showToast('Не удалось удалить: ' + e.message, 'error');
  }
}

// ── Остановить всё: пауза + сброс позиции для каждого играющего трека ──
document.getElementById('audio-lib-stop-all-btn')?.addEventListener('click', () => {
  document.querySelectorAll('#audio-lib-grid [data-audio-el]').forEach(audioEl => {
    audioEl.pause();
    audioEl.currentTime = 0;
  });
  document.querySelectorAll('#audio-lib-grid [data-audio-play]').forEach(btn => {
    btn.textContent = '▶';
    btn.classList.remove('playing');
  });
});

// ── Модалка загрузки ──
const _audioUploadModal = document.getElementById('audio-upload-modal');
document.getElementById('audio-lib-upload-btn')?.addEventListener('click', () => {
  document.getElementById('audio-upload-form').reset();
  document.getElementById('audio-upload-err').style.display = 'none';
  _audioUploadModal.classList.add('open');
});
document.getElementById('audio-upload-close')?.addEventListener('click', () => _audioUploadModal.classList.remove('open'));
document.getElementById('audio-upload-cancel')?.addEventListener('click', () => _audioUploadModal.classList.remove('open'));
_audioUploadModal?.addEventListener('click', e => { if (e.target === _audioUploadModal) _audioUploadModal.classList.remove('open'); });

const ALLOWED_AUDIO_MIME = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav'];
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

document.getElementById('audio-upload-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('audio-upload-err');
  errEl.style.display = 'none';

  const title = document.getElementById('audio-upload-title').value.trim();
  const file  = document.getElementById('audio-upload-file').files[0];
  if (!title) { errEl.textContent = 'Укажите название'; errEl.style.display = ''; return; }
  if (!file)  { errEl.textContent = 'Выберите файл'; errEl.style.display = ''; return; }
  if (!ALLOWED_AUDIO_MIME.includes(file.type)) {
    errEl.textContent = 'Неподдерживаемый формат (нужен mp3/ogg/wav)'; errEl.style.display = ''; return;
  }
  if (file.size > MAX_AUDIO_BYTES) {
    errEl.textContent = 'Файл больше 20МБ'; errEl.style.display = ''; return;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

  try {
    const created = await apiFetch('/api/audio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, filename: file.name, mimetype: file.type, data: base64 }),
    });
    _audioLibCache.push(created);
    _audioLibRender();
    _audioUploadModal.classList.remove('open');
    showToast('Звук загружен', 'success');
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = '';
  }
});
```

- [ ] **Step 3: Run the full test suite (this is pure frontend JS, no automated test covers it directly — the check here is that nothing else broke)**

Run: `cd web && npm test`
Expected: PASS — all existing tests plus the audio API tests from Tasks 2–3 pass; `ui.test.js`/`e2e.test.js` (Selenium) are unaffected since they don't touch this page.

- [ ] **Step 4: Commit**

```bash
git add web/public/audio-library.js web/public/scripts.js
git commit -m "feat: audio library frontend — render, play/pause, volume, rename, delete, upload"
```

---

### Task 7: Manual verification + impeccable pass + cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `cd web && npm test`
Expected: PASS, zero failures.

- [ ] **Step 2: Re-run impeccable's audit on the changed frontend files**

Per this project's CLAUDE.md rule for frontend work:
```
/impeccable audit web/public/index.html web/public/styles.css web/public/audio-library.js
```
Confirm no new findings versus the baseline captured in Task 4 Step 1 (contrast, touch targets ≥44px, token usage — all already addressed by design in Tasks 4–6, but this is the verification gate the project requires before calling frontend work done).

- [ ] **Step 3: Manual browser check via the `run-sanguine-web` skill**

Follow that skill's recipe (restart dev server via `POST /api/restart`, headless Chrome via raw CDP, skip onboarding tour) and exercise, in order:
1. Navigate to `audio-library` — empty-state message shows ("Библиотека пуста…").
2. Click "+ Загрузить звук" → modal opens → fill title + pick a small local audio file → submit → modal closes, new card appears.
3. Click play on the new card → icon switches to ⏸, audio plays.
4. Drag the volume slider → `audioEl.volume` changes live (verify via `Runtime.evaluate` reading the element's `.volume`, not just a screenshot).
5. Upload a second track, play both simultaneously → both `<audio>` elements report `paused === false` at the same time (confirms the soundboard requirement — multiple tracks playing at once).
6. Click "⏹ Остановить всё" → both `<audio>` elements report `paused === true` and `currentTime === 0`.
7. Click ✎ on a card → inline input appears, type a new title, press Enter → title updates, confirmed via a fresh `GET /api/audio`.
8. Click 🗑 on a card → confirm dialog appears → confirm → card disappears, confirmed via a fresh `GET /api/audio` no longer listing it.
9. Close the headless Chrome instance via `Browser.close` over the CDP socket (never `taskkill`).

- [ ] **Step 4: Clean up any test artifacts left on disk**

Any audio file uploaded purely to exercise the manual check in Step 3 must not survive:
```bash
git status --short cities/audio 2>/dev/null || true
```
`cities/audio/` is gitignored, so this will show nothing tracked — but still physically remove any leftover test uploads from disk so the installation's real library (once the user starts using the feature) isn't cluttered with test tracks:
```bash
rm -rf cities/audio
```
(Safe: this directory is gitignored and was either absent before this session or is fully reconstructed from `index.json` + files the user themselves uploads afterward — nothing here is tracked in git or otherwise unrecoverable.)

- [ ] **Step 5: Final status check**

```bash
git status
```
Expected: working tree clean except for the commits already made in Tasks 1–6; no stray test artifacts.

---

## Out of scope (per spec)

- Sound categories/tags/folders/sort order.
- Fade in/out, crossfade, equalizer.
- Cross-installation sync or cloud storage — the library is 100% local per install.
