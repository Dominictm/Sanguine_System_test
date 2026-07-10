# Звуковая библиотека: категории и аудио-пресеты Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mutually-exclusive categories (music/effect) to audio-library tracks and a new "audio presets" concept — saved sets of tracks with per-preset volume, optionally linked to a location, playable together with one button — splitting the page into 3 columns.

**Architecture:** Extend the existing `web/routes/audio.js` router (already handles tracks) with a `category` field on track entries and a second manifest `cities/audio/presets.json` with its own CRUD routes (`GET/POST/PUT/DELETE /api/audio/presets(/:id)`), enriched at read time with live track titles/urls (from `index.json`) and live location title/image (from `GET /api/locations`) rather than duplicating that data into the preset record. Frontend restructures `#page-audio-library` into 3 columns and extends `web/public/audio-library.js` with category-toggle, a preset-picker modal, and preset playback (stop-everything-then-play-this-preset).

**Tech Stack:** Node.js + Express (existing `web/routes/audio.js`, `web/server.js`), vanilla browser JS (`web/public/audio-library.js`), Node's built-in test runner (`web/tests/all.test.js`).

**Spec:** `docs/superpowers/specs/2026-07-10-audio-library-categories-presets-design.md` — read it first.

**Also read before starting:** `docs/superpowers/specs/2026-07-10-audio-library-design.md` (the base feature this extends) and the current state of `web/routes/audio.js` (109 lines) and `web/public/audio-library.js` (229 lines) — both quoted in full below where relevant, but skim the live files too.

---

## File Structure

- **Modify: `web/routes/audio.js`** — add `category` field/validation to `POST`/`PUT /api/audio`; add `readPresets`/`writePresets` helpers and 4 new routes for `cities/audio/presets.json`.
- **Modify: `web/public/index.html`** — replace the single `#audio-lib-grid` with a 3-column layout; add 2 radio buttons to the upload modal; add a new `#audio-preset-modal`.
- **Modify: `web/public/styles.css`** — 3-column grid rules, preset-card rules, radio-group rules.
- **Modify: `web/public/audio-library.js`** — category toggle + column-aware rendering, preset rendering/playback/CRUD wiring, extract `_audioLibStopAll()` as a named reusable function.
- **Modify: `web/tests/all.test.js`** — update existing track tests to send `category` (now required), add category + presets test coverage inside the existing `describe('API — audio library', …)` block.

---

### Task 1: Backend — track `category` field

**Files:**
- Modify: `web/routes/audio.js`
- Test: `web/tests/all.test.js` (inside `describe('API — audio library', …)`, lines 2365–2491)

- [ ] **Step 1: Update existing tests to send `category` (now required) and assert it round-trips**

The existing success-path tests in `web/tests/all.test.js` create tracks via `POST /api/audio` without a `category` field. Once `category` becomes required, those `POST` calls would start failing with 400 unless updated. Update them now, before the required-field validation exists, so the "make it pass" step below is meaningful.

Find this block (lines 2415–2444) and change it:
```js
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
```
to:
```js
    it('POST /api/audio — сохраняет файл и запись в index.json; GET возвращает его', async () => {
      let created = null;
      try {
        const { status, body } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Гроза за окном', filename: 'storm.wav', mimetype: 'audio/wav', data: 'UklGRiQAAABXQVZFZm10', category: 'music' }),
        });
        assert.equal(status, 200);
        assert.equal(body.title, 'Гроза за окном');
        assert.equal(body.ext, 'wav');
        assert.equal(body.volume, 1);
        assert.equal(body.category, 'music');
        assert.ok(body.id);
        assert.equal(body.url, `/audio-lib/${body.id}.wav`);
        created = body.id;
```

Find this block (lines 2453–2461) and change it:
```js
    it('PUT /api/audio/:id — переименование и громкость; DELETE удаляет файл и запись', async () => {
      const { body: created } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Черновое имя', filename: 'x.ogg', mimetype: 'audio/ogg', data: 'T2dnUw==' }),
      });
      const id = created.id;

      assert.equal(created.loop, true, 'по умолчанию зацикливание включено');

      const { status: putStatus, body: updated } = await apiJson(`/api/audio/${id}`, {
        method: 'PUT', body: JSON.stringify({ title: 'Финальное имя', volume: 0.4, loop: false }),
      });
      assert.equal(putStatus, 200);
      assert.equal(updated.title, 'Финальное имя');
      assert.equal(updated.volume, 0.4);
      assert.equal(updated.loop, false);
```
to:
```js
    it('PUT /api/audio/:id — переименование, громкость, зацикливание, категория; DELETE удаляет файл и запись', async () => {
      const { body: created } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Черновое имя', filename: 'x.ogg', mimetype: 'audio/ogg', data: 'T2dnUw==', category: 'effect' }),
      });
      const id = created.id;

      assert.equal(created.loop, true, 'по умолчанию зацикливание включено');
      assert.equal(created.category, 'effect');

      const { status: putStatus, body: updated } = await apiJson(`/api/audio/${id}`, {
        method: 'PUT', body: JSON.stringify({ title: 'Финальное имя', volume: 0.4, loop: false, category: 'music' }),
      });
      assert.equal(putStatus, 200);
      assert.equal(updated.title, 'Финальное имя');
      assert.equal(updated.volume, 0.4);
      assert.equal(updated.loop, false);
      assert.equal(updated.category, 'music');
```

- [ ] **Step 2: Add the new failing category-validation tests**

Add these tests right after the `'POST /api/audio — отклоняет файл больше 20МБ'` test (after line 2413, before the success-path test), inside the same `describe('API — audio library', …)` block:

```js
    it('POST /api/audio — отклоняет отсутствующую категорию', async () => {
      const { status, body } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Тест', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA' }),
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('POST /api/audio — отклоняет недопустимое значение категории', async () => {
      const { status } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Тест', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'ambient' }),
      });
      assert.equal(status, 400);
    });
```

Also add this test right after the `'PUT /api/audio/:id — 404 для несуществующего id'` test (after line 2451):

```js
    it('PUT /api/audio/:id — отклоняет недопустимое значение категории', async () => {
      const { body: created } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Для проверки категории', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'music' }),
      });
      try {
        const { status } = await apiJson(`/api/audio/${created.id}`, {
          method: 'PUT', body: JSON.stringify({ category: 'ambient' }),
        });
        assert.equal(status, 400);
      } finally {
        await apiJson(`/api/audio/${created.id}`, { method: 'DELETE' });
      }
    });
```

- [ ] **Step 3: Run the tests to verify the new ones fail and the updated ones still pass their old assertions but now need `category`**

Run: `cd web && npm run test:unit`
Expected: The two new "отклоняет ... категор" tests FAIL (no validation yet — `POST`/`PUT` currently accept anything). The updated success-path tests still PASS for now (extra `category` field in the request body is simply ignored by the current implementation, and the new `assert.equal(created.category, ...)` / `assert.equal(updated.category, ...)` assertions FAIL since the field doesn't exist yet on the response).

- [ ] **Step 4: Implement `category` validation and storage in `web/routes/audio.js`**

`web/routes/audio.js:18–24` currently reads:
```js
const MIME_EXT = {
  'audio/mpeg':  'mp3',
  'audio/ogg':   'ogg',
  'audio/wav':   'wav',
  'audio/x-wav': 'wav',
};
const MAX_BYTES = 20 * 1024 * 1024; // 20MB, см. спеку
```
Add right after it:
```js
const CATEGORIES = ['music', 'effect'];
```

`web/routes/audio.js:44–69` (the `POST /api/audio` handler) currently reads:
```js
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
      title: title.trim(), volume: 1, loop: true, createdAt: new Date().toISOString(),
    };
    list.push(entry);
    await writeIndex(list);

    res.json({ ...entry, url: `/audio-lib/${id}.${ext}` });
  } catch (e) { serverError(res, e); }
});
```
Change to:
```js
router.post('/api/audio', async (req, res) => {
  try {
    const { title, filename, mimetype, data, category } = req.body || {};
    const ext = MIME_EXT[mimetype];
    if (!ext) return res.status(400).json({ error: 'Неподдерживаемый формат аудио (нужен mp3/ogg/wav)' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Название не может быть пустым' });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Укажите категорию: фоновая музыка или аудио эффект' });
    if (!data) return res.status(400).json({ error: 'Файл не передан' });

    const buf = Buffer.from(data, 'base64');
    if (buf.length > MAX_BYTES) return res.status(400).json({ error: 'Файл больше 20МБ' });

    const id = crypto.randomUUID();
    await fs.mkdir(AUDIO_DIR, { recursive: true });
    await writeFileAtomic(path.join(AUDIO_DIR, `${id}.${ext}`), buf);

    const list = await readIndex();
    const entry = {
      id, ext, filename: filename || `${id}.${ext}`,
      title: title.trim(), volume: 1, loop: true, category, createdAt: new Date().toISOString(),
    };
    list.push(entry);
    await writeIndex(list);

    res.json({ ...entry, url: `/audio-lib/${id}.${ext}` });
  } catch (e) { serverError(res, e); }
});
```

`web/routes/audio.js:71–92` (the `PUT /api/audio/:id` handler) currently reads:
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
    if (typeof req.body.loop === 'boolean') {
      entry.loop = req.body.loop;
    }
    await writeIndex(list);
    res.json(entry);
  } catch (e) { serverError(res, e); }
});
```
Change to:
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
    if (typeof req.body.loop === 'boolean') {
      entry.loop = req.body.loop;
    }
    if (typeof req.body.category === 'string') {
      if (!CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: 'Недопустимая категория' });
      entry.category = req.body.category;
    }
    await writeIndex(list);
    res.json(entry);
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: PASS — all tests in `describe('API — audio library', …)` succeed, including the new category tests and the updated assertions.

- [ ] **Step 6: Commit**

```bash
git add web/routes/audio.js web/tests/all.test.js
git commit -m "feat: required category (music/effect) field on audio tracks"
```

---

### Task 2: Backend — audio presets CRUD

**Files:**
- Modify: `web/routes/audio.js`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing tests**

Add a nested `describe('Presets', …)` block right before the closing `});` of the outer `describe('API — audio library', …)` block (i.e., right after the `'PUT /api/audio/:id — отклоняет недопустимое значение категории'` test added in Task 1, and after the existing `'DELETE /api/audio/:id — 404 для несуществующего id'` test):

```js
    describe('Presets', () => {
      const PRESETS_PATH = path.join(AUDIO_ROOT, 'presets.json');
      let presetsExisted, originalPresets;
      before(async () => {
        originalPresets = await fs.readFile(PRESETS_PATH, 'utf-8').catch(() => null);
        presetsExisted = originalPresets !== null;
      });
      after(async () => {
        if (presetsExisted) await fs.writeFile(PRESETS_PATH, originalPresets, 'utf-8');
        else await fs.rm(PRESETS_PATH, { force: true });
      });

      it('POST /api/audio/presets — без названия → 400', async () => {
        const { status } = await apiJson('/api/audio/presets', {
          method: 'POST', body: JSON.stringify({ name: '  ', tracks: [{ trackId: 'x', volume: 1 }] }),
        });
        assert.equal(status, 400);
      });

      it('POST /api/audio/presets — без звуков → 400', async () => {
        const { status } = await apiJson('/api/audio/presets', {
          method: 'POST', body: JSON.stringify({ name: 'Пустой пресет', tracks: [] }),
        });
        assert.equal(status, 400);
      });

      it('POST/GET/PUT/DELETE /api/audio/presets — полный цикл, резолвит title/url трека и null-локацию', async () => {
        const { body: track } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Трек для пресета', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'effect' }),
        });
        let presetId = null;
        try {
          const { status: postStatus, body: created } = await apiJson('/api/audio/presets', {
            method: 'POST',
            body: JSON.stringify({
              name: 'Тестовый пресет', locationSlug: '__no_such_location__',
              tracks: [{ trackId: track.id, volume: 0.5 }],
            }),
          });
          assert.equal(postStatus, 200);
          assert.equal(created.name, 'Тестовый пресет');
          assert.ok(created.id);
          presetId = created.id;

          const { status: getStatus, body: list } = await apiJson('/api/audio/presets');
          assert.equal(getStatus, 200);
          const mine = list.find(p => p.id === presetId);
          assert.ok(mine);
          assert.equal(mine.locationTitle, null, 'несуществующая локация резолвится в null, а не в ошибку');
          assert.equal(mine.locationImageUrl, null);
          assert.equal(mine.tracks.length, 1);
          assert.equal(mine.tracks[0].title, 'Трек для пресета');
          assert.equal(mine.tracks[0].volume, 0.5);
          assert.equal(mine.tracks[0].url, track.url);

          const { status: putStatus, body: updated } = await apiJson(`/api/audio/presets/${presetId}`, {
            method: 'PUT', body: JSON.stringify({ name: 'Переименованный пресет', tracks: [{ trackId: track.id, volume: 0.9 }] }),
          });
          assert.equal(putStatus, 200);
          assert.equal(updated.name, 'Переименованный пресет');
          assert.equal(updated.tracks[0].volume, 0.9);

          const { status: putMissingStatus } = await apiJson('/api/audio/presets/__no_such_id__', {
            method: 'PUT', body: JSON.stringify({ name: 'x' }),
          });
          assert.equal(putMissingStatus, 404);

          const { status: delStatus, body: delBody } = await apiJson(`/api/audio/presets/${presetId}`, { method: 'DELETE' });
          assert.equal(delStatus, 200);
          assert.equal(delBody.ok, true);
          presetId = null;

          const { status: delMissingStatus } = await apiJson('/api/audio/presets/__no_such_id__', { method: 'DELETE' });
          assert.equal(delMissingStatus, 404);
        } finally {
          if (presetId) await apiJson(`/api/audio/presets/${presetId}`, { method: 'DELETE' });
          await apiJson(`/api/audio/${track.id}`, { method: 'DELETE' });
        }
      });

      it('GET /api/audio/presets — ссылка на удалённый трек тихо пропускается, остальные треки остаются', async () => {
        const { body: keepTrack } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Останется', filename: 'a.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'music' }),
        });
        const { body: doomedTrack } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Будет удалён', filename: 'b.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'effect' }),
        });
        let presetId = null;
        try {
          const { body: preset } = await apiJson('/api/audio/presets', {
            method: 'POST',
            body: JSON.stringify({
              name: 'Переживёт удаление трека',
              tracks: [{ trackId: keepTrack.id, volume: 1 }, { trackId: doomedTrack.id, volume: 1 }],
            }),
          });
          presetId = preset.id;

          await apiJson(`/api/audio/${doomedTrack.id}`, { method: 'DELETE' });

          const { body: list } = await apiJson('/api/audio/presets');
          const mine = list.find(p => p.id === presetId);
          assert.ok(mine, 'пресет остаётся, даже если один из его треков удалён');
          assert.equal(mine.tracks.length, 1, 'удалённый трек тихо выпадает из tracks[]');
          assert.equal(mine.tracks[0].trackId, keepTrack.id);
        } finally {
          if (presetId) await apiJson(`/api/audio/presets/${presetId}`, { method: 'DELETE' });
          await apiJson(`/api/audio/${keepTrack.id}`, { method: 'DELETE' });
        }
      });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm run test:unit`
Expected: FAIL — every `/api/audio/presets` request returns 404 (no route registered yet).

- [ ] **Step 3: Implement the presets manifest helpers and routes**

`web/routes/audio.js:11–12` currently reads:
```js
const { serverError } = require('../lib/http');
const { AUDIO_DIR, writeFileAtomic } = require('../lib/db');
```
Change to:
```js
const { serverError } = require('../lib/http');
const { AUDIO_DIR, writeFileAtomic, reqCity, getAllLocations } = require('../lib/db');
```

`web/routes/audio.js:16` currently reads:
```js
const INDEX_PATH = path.join(AUDIO_DIR, 'index.json');
```
Add right after it:
```js
const PRESETS_PATH = path.join(AUDIO_DIR, 'presets.json');
```

Add these helpers right after the existing `writeIndex` function (after line 35, before `router.get('/api/audio', …)` at line 37):
```js
async function readPresets() {
  const raw = await fs.readFile(PRESETS_PATH, 'utf-8').catch(() => null);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function writePresets(list) {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await writeFileAtomic(PRESETS_PATH, JSON.stringify(list, null, 2), 'utf-8');
}
```

Add the 4 preset routes at the end of the file, right after the existing `router.delete('/api/audio/:id', …)` handler and before `module.exports`:
```js
router.get('/api/audio/presets', async (req, res) => {
  try {
    const presets = await readPresets();
    const tracks  = await readIndex();
    const locs    = await getAllLocations(reqCity(req));
    const enriched = presets.map(p => {
      const loc = p.locationSlug ? locs.find(l => l.slug === p.locationSlug) : null;
      const resolvedTracks = p.tracks
        .map(pt => {
          const track = tracks.find(t => t.id === pt.trackId);
          if (!track) return null; // трек удалён из библиотеки — тихо пропускаем
          return { trackId: pt.trackId, volume: pt.volume, title: track.title, url: `/audio-lib/${track.id}.${track.ext}` };
        })
        .filter(Boolean);
      return {
        id: p.id, name: p.name, locationSlug: p.locationSlug || null,
        locationTitle: loc ? (loc.title || null) : null,
        locationImageUrl: loc ? (loc.imageUrl || null) : null,
        tracks: resolvedTracks, createdAt: p.createdAt,
      };
    });
    res.json(enriched);
  } catch (e) { serverError(res, e); }
});

function _cleanPresetTracks(rawTracks) {
  return (Array.isArray(rawTracks) ? rawTracks : [])
    .map(t => ({
      trackId: String(t?.trackId || ''),
      volume: Math.max(0, Math.min(1, typeof t?.volume === 'number' ? t.volume : 1)),
    }))
    .filter(t => t.trackId);
}

router.post('/api/audio/presets', async (req, res) => {
  try {
    const { name, locationSlug, tracks } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название пресета не может быть пустым' });
    const cleanTracks = _cleanPresetTracks(tracks);
    if (!cleanTracks.length) return res.status(400).json({ error: 'Пресет должен содержать хотя бы один звук' });

    const presets = await readPresets();
    const entry = {
      id: crypto.randomUUID(), name: name.trim(),
      locationSlug: locationSlug || null, tracks: cleanTracks,
      createdAt: new Date().toISOString(),
    };
    presets.push(entry);
    await writePresets(presets);
    res.json(entry);
  } catch (e) { serverError(res, e); }
});

router.put('/api/audio/presets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const presets = await readPresets();
    const entry = presets.find(p => p.id === id);
    if (!entry) return res.status(404).json({ error: 'Пресет не найден' });

    if (typeof req.body.name === 'string') {
      const trimmed = req.body.name.trim();
      if (!trimmed) return res.status(400).json({ error: 'Название пресета не может быть пустым' });
      entry.name = trimmed;
    }
    if ('locationSlug' in (req.body || {})) {
      entry.locationSlug = req.body.locationSlug || null;
    }
    if (req.body && req.body.tracks !== undefined) {
      const cleanTracks = _cleanPresetTracks(req.body.tracks);
      if (!cleanTracks.length) return res.status(400).json({ error: 'Пресет должен содержать хотя бы один звук' });
      entry.tracks = cleanTracks;
    }
    await writePresets(presets);
    res.json(entry);
  } catch (e) { serverError(res, e); }
});

router.delete('/api/audio/presets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const presets = await readPresets();
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Пресет не найден' });
    presets.splice(idx, 1);
    await writePresets(presets);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: PASS — all tests including the new `Presets` nested describe block.

- [ ] **Step 5: Commit**

```bash
git add web/routes/audio.js web/tests/all.test.js
git commit -m "feat: audio presets CRUD (cities/audio/presets.json)"
```

---

### Task 3: Frontend — 3-column page layout + JS refactor for column-aware selectors

**Files:**
- Modify: `web/public/index.html`
- Modify: `web/public/styles.css`
- Modify: `web/public/audio-library.js`

This task only restructures the page shell and updates existing JS to work with the new containers — it does NOT yet add category-toggle or preset UI (that's Tasks 4–6). After this task, tracks still render exactly as before (same card markup), just split by category into two containers instead of one.

- [ ] **Step 1: Run impeccable's design-detector context before touching markup**

```
node .claude/skills/impeccable/scripts/detect.mjs --json web/public/index.html web/public/styles.css web/public/audio-library.js
```
Note the baseline (expected: empty array, matching the last time this was checked) so later steps in this task and Tasks 4–6 can tell what's new versus pre-existing.

- [ ] **Step 2: Replace the single grid with 3 columns in `index.html`**

`web/public/index.html:725–735` currently reads:
```html
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
```
Change to:
```html
    <section id="page-audio-library" class="page">
      <div class="page-header">
        <h1 class="page-title">Звуковая библиотека</h1>
        <span class="page-sub">саундборд сессии</span>
        <button class="btn-submit" id="audio-lib-upload-btn" style="margin-left:auto">+ Загрузить звук</button>
        <button class="btn-submit btn-secondary" id="audio-lib-stop-all-btn">⏹ Остановить всё</button>
      </div>
      <div class="audio-lib-columns">
        <div class="audio-lib-column">
          <h2 class="audio-lib-column-title">Фоновая музыка</h2>
          <div class="audio-lib-col-cards" id="audio-lib-music-cards">
            <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
          </div>
        </div>
        <div class="audio-lib-column">
          <h2 class="audio-lib-column-title">Эффекты</h2>
          <div class="audio-lib-col-cards" id="audio-lib-effects-cards">
            <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
          </div>
        </div>
        <div class="audio-lib-column">
          <h2 class="audio-lib-column-title">Аудио пресеты</h2>
          <button type="button" class="btn-submit" id="audio-preset-create-btn" style="margin-bottom:12px">+ Создать пресет</button>
          <div class="audio-lib-col-cards" id="audio-lib-presets-cards">
            <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
          </div>
        </div>
      </div>
    </section>
```

- [ ] **Step 3: Add the 3-column CSS**

`web/public/styles.css:8147` — find `.audio-card {` (the first rule of the family) and add the following new rules **directly before it** (so the column/grid shell rules sit right above the card rules they contain):
```css
.audio-lib-columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  align-items: start;
}

.audio-lib-column-title {
  font-family: var(--f-heading);
  font-size: var(--fs-md);
  color: var(--gold);
  margin-bottom: 14px;
}

.audio-lib-col-cards {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

```

Then change the existing `.audio-card` rule (`web/public/styles.css:8147–8158`), which currently reads:
```css
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
```
to (drop the fixed `width: 200px` — cards now fill their column instead of sitting at a fixed width inside a 3-wide grid):
```css
.audio-card {
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
```

- [ ] **Step 4: Refactor `audio-library.js` to render into the two track containers and extract a reusable stop-all function**

`web/public/audio-library.js:27–47` currently reads:
```js
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
```
Change to:
```js
function _audioLibRender() {
  const musicEl = document.getElementById('audio-lib-music-cards');
  const fxEl    = document.getElementById('audio-lib-effects-cards');
  if (!musicEl || !fxEl) return;
  // Записи, загруженные до появления поля category, трактуются как эффект
  // (см. спеку) — t.category !== 'music' покрывает и это, и явное 'effect'.
  const music = _audioLibCache.filter(t => t.category === 'music');
  const fx    = _audioLibCache.filter(t => t.category !== 'music');
  musicEl.innerHTML = music.length ? music.map(_audioLibCardHtml).join('') : '<div class="loading-state">Пока нет фоновой музыки.</div>';
  fxEl.innerHTML    = fx.length    ? fx.map(_audioLibCardHtml).join('')    : '<div class="loading-state">Пока нет эффектов.</div>';
}

async function loadAudioLibrary() {
  const musicEl = document.getElementById('audio-lib-music-cards');
  const fxEl    = document.getElementById('audio-lib-effects-cards');
  const loading = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  if (musicEl) musicEl.innerHTML = loading;
  if (fxEl)    fxEl.innerHTML    = loading;
  try {
    _audioLibCache = await apiFetch('/api/audio');
  } catch (e) {
    showToast('Не удалось загрузить звуковую библиотеку: ' + e.message, 'error');
    _audioLibCache = [];
  }
  _audioLibRender();
  await loadAudioPresets();
}
```
(`loadAudioPresets()` is defined in Task 6 — referencing it here now is fine since function declarations are hoisted and it's only ever called at runtime, well after every script has loaded.)

`web/public/audio-library.js:49–82` (the click delegate, currently attached only to `#audio-lib-grid`) currently reads:
```js
// ── Play/pause + громкость (делегирование на контейнере, привязано один раз) ──
document.getElementById('audio-lib-grid')?.addEventListener('click', async e => {
  const playBtn = e.target.closest('[data-audio-play]');
```
Change the selector line to a single shared ancestor covering both track columns (and, from Task 6 onward, the presets column too — one delegate for the whole page is simpler than three separate registrations doing the same dispatch):
```js
// ── Play/pause + громкость (делегирование на общем контейнере страницы,
// накрывает обе колонки треков и колонку пресетов одним обработчиком —
// проще, чем регистрировать один и тот же диспетчер трижды). ──
document.querySelector('.audio-lib-columns')?.addEventListener('click', async e => {
  const playBtn = e.target.closest('[data-audio-play]');
```

`web/public/audio-library.js:102–109` (the volume-slider input delegate) currently reads:
```js
document.getElementById('audio-lib-grid')?.addEventListener('input', e => {
  const slider = e.target.closest('[data-audio-volume]');
  if (!slider) return;
  const card = slider.closest('.audio-card');
  const audioEl = card.querySelector('[data-audio-el]');
  audioEl.volume = parseFloat(slider.value);
  _audioLibDebouncedSaveVolume(card.dataset.audioId, parseFloat(slider.value));
});
```
Change the selector line the same way:
```js
document.querySelector('.audio-lib-columns')?.addEventListener('input', e => {
  const slider = e.target.closest('[data-audio-volume]');
  if (!slider) return;
  const card = slider.closest('.audio-card');
  const audioEl = card.querySelector('[data-audio-el]');
  audioEl.volume = parseFloat(slider.value);
  _audioLibDebouncedSaveVolume(card.dataset.audioId, parseFloat(slider.value));
});
```

`web/public/audio-library.js:166–176` (the stop-all handler, currently an inline anonymous callback scoped to `#audio-lib-grid`) currently reads:
```js
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
```
Change to (extracted into a named function so preset playback in Task 6 can call the exact same stop-everything logic, per the spec's "сначала остановить всё" requirement — and query the whole page rather than a container id that no longer exists):
```js
// ── Остановить всё: пауза + сброс позиции для каждого играющего трека.
// Именованная функция (не только обработчик клика) — запуск пресета тоже
// сначала останавливает всё, см. Task 6. ──
function _audioLibStopAll() {
  document.querySelectorAll('[data-audio-el]').forEach(audioEl => {
    audioEl.pause();
    audioEl.currentTime = 0;
  });
  document.querySelectorAll('.audio-card [data-audio-play]').forEach(btn => {
    btn.textContent = '▶';
    btn.classList.remove('playing');
  });
}
document.getElementById('audio-lib-stop-all-btn')?.addEventListener('click', _audioLibStopAll);
```

- [ ] **Step 5: Hook `navigate('audio-library')` to also load presets (placeholder call already added in Step 4 — define a temporary no-op so nothing throws until Task 6)**

Add this temporary stub at the very end of `web/public/audio-library.js` (Task 6 will replace it with the real implementation — without this stub, `loadAudioPresets()` called from Step 4 would throw `ReferenceError` since function expressions like the rest of this file are declared with `function` keyword and ARE hoisted, but only if defined somewhere in the file; adding a stub now keeps the file runnable at every intermediate commit):
```js
// TODO(Task 6): replaced with the real preset loader/renderer.
async function loadAudioPresets() {}
```

- [ ] **Step 6: Manual smoke check — reload the page, confirm existing track features still work across the new 2-container layout**

Run: `cd web && npm run test:unit` (expected: PASS, unaffected — this task is pure frontend, no backend changes)

Then verify in a browser (or headless Chrome via the `run-sanguine-web` skill) that: the audio library page shows two columns (music/effects) instead of one grid, existing tracks still appear (in the effects column if they predate the `category` field — matches the spec's fallback), play/pause/volume/rename/delete/loop still work, and "Остановить всё" still stops everything.

- [ ] **Step 7: Commit**

```bash
git add web/public/index.html web/public/styles.css web/public/audio-library.js
git commit -m "refactor: split audio library page into music/effects/presets columns"
```

---

### Task 4: Frontend — category radio buttons (upload) + category toggle (card)

**Files:**
- Modify: `web/public/index.html`
- Modify: `web/public/audio-library.js`
- Modify: `web/public/styles.css`

- [ ] **Step 1: Add the 2 mutually-exclusive radio buttons to the upload form**

`web/public/index.html:1293–1301` currently reads:
```html
    <form id="audio-upload-form">
      <div class="form-group">
        <label class="form-label" for="audio-upload-title">Название *</label>
        <input class="form-control" id="audio-upload-title" type="text" required placeholder="Например, «Гроза за окном»">
      </div>
      <div class="form-group">
        <label class="form-label" for="audio-upload-file">Аудиофайл (mp3/ogg/wav, до 20МБ) *</label>
        <input class="form-control" id="audio-upload-file" type="file" accept="audio/mpeg,audio/ogg,audio/wav" required>
      </div>
```
Change to:
```html
    <form id="audio-upload-form">
      <div class="form-group">
        <label class="form-label" for="audio-upload-title">Название *</label>
        <input class="form-control" id="audio-upload-title" type="text" required placeholder="Например, «Гроза за окном»">
      </div>
      <div class="form-group">
        <label class="form-label">Категория *</label>
        <div class="audio-category-radios">
          <label class="audio-category-radio">
            <input type="radio" name="audio-upload-category" value="music" required> Фоновая музыка
          </label>
          <label class="audio-category-radio">
            <input type="radio" name="audio-upload-category" value="effect" required> Аудио эффекты
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="audio-upload-file">Аудиофайл (mp3/ogg/wav, до 20МБ) *</label>
        <input class="form-control" id="audio-upload-file" type="file" accept="audio/mpeg,audio/ogg,audio/wav" required>
      </div>
```
(Native `required` on a `radio` group means the browser blocks form submission until one of the two same-named radios is checked — no default is pre-selected, matching "обязательный выбор, без значения по умолчанию".)

- [ ] **Step 2: Style the radio group**

Add to `web/public/styles.css`, right after the `.audio-lib-col-cards` rule added in Task 3 (before `.audio-card {`):
```css
.audio-category-radios {
  display: flex;
  gap: 20px;
}

.audio-category-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--text);
  cursor: pointer;
}

.audio-category-radio input[type="radio"] {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
  cursor: pointer;
}
```

- [ ] **Step 3: Read the selected radio value on submit and send it as `category`**

`web/public/audio-library.js` — find the upload form submit handler (currently ends near the file's last lines, ~192–228). The line:
```js
  const title = document.getElementById('audio-upload-title').value.trim();
  const file  = document.getElementById('audio-upload-file').files[0];
  if (!title) { errEl.textContent = 'Укажите название'; errEl.style.display = ''; return; }
  if (!file)  { errEl.textContent = 'Выберите файл'; errEl.style.display = ''; return; }
```
Change to add a category read + guard right after it:
```js
  const title = document.getElementById('audio-upload-title').value.trim();
  const file  = document.getElementById('audio-upload-file').files[0];
  const categoryInput = document.querySelector('input[name="audio-upload-category"]:checked');
  if (!title) { errEl.textContent = 'Укажите название'; errEl.style.display = ''; return; }
  if (!categoryInput) { errEl.textContent = 'Выберите категорию'; errEl.style.display = ''; return; }
  if (!file)  { errEl.textContent = 'Выберите файл'; errEl.style.display = ''; return; }
```
And the fetch body further down:
```js
    const created = await apiFetch('/api/audio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, filename: file.name, mimetype: file.type, data: base64 }),
    });
```
Change to:
```js
    const created = await apiFetch('/api/audio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, filename: file.name, mimetype: file.type, data: base64, category: categoryInput.value }),
    });
```
And after a successful upload, `_audioLibCache.push(created); _audioLibRender();` already re-renders both columns from the fresh cache (including the new entry, now with its `category`), so no further change is needed there.

- [ ] **Step 4: Add the category-toggle button to the track card template**

`web/public/audio-library.js:8–25` (`_audioLibCardHtml`) currently reads:
```js
function _audioLibCardHtml(t) {
  // Записи, загруженные до появления поля loop, ещё не имеют его в index.json —
  // трактуем как включённое (прежнее жёстко зашитое поведение), а не как выключенное.
  const loopOn = t.loop !== false;
  return `<div class="audio-card" data-audio-id="${escAttr(t.id)}">
    <div class="audio-card-title" data-audio-title-view>${escHtml(t.title)}</div>
    <audio data-audio-el src="${escAttr(t.url)}" ${loopOn ? 'loop' : ''} preload="none"></audio>
    <div class="audio-card-row">
      <button type="button" class="audio-card-play-btn" data-audio-play aria-label="Играть/пауза">▶</button>
      <input type="range" class="audio-card-volume" data-audio-volume min="0" max="1" step="0.01" value="${t.volume}">
    </div>
    <div class="audio-card-actions">
      <button type="button" class="audio-card-icon-btn${loopOn ? ' active' : ''}" data-audio-loop aria-pressed="${loopOn}" aria-label="Зацикливание">🔁</button>
      <button type="button" class="audio-card-icon-btn" data-audio-rename aria-label="Переименовать">✎</button>
      <button type="button" class="audio-card-icon-btn" data-audio-delete aria-label="Удалить">🗑</button>
    </div>
  </div>`;
}
```
Change to:
```js
function _audioLibCardHtml(t) {
  // Записи, загруженные до появления поля loop, ещё не имеют его в index.json —
  // трактуем как включённое (прежнее жёстко зашитое поведение), а не как выключенное.
  const loopOn   = t.loop !== false;
  const isMusic  = t.category === 'music';
  return `<div class="audio-card" data-audio-id="${escAttr(t.id)}">
    <div class="audio-card-title" data-audio-title-view>${escHtml(t.title)}</div>
    <audio data-audio-el src="${escAttr(t.url)}" ${loopOn ? 'loop' : ''} preload="none"></audio>
    <div class="audio-card-row">
      <button type="button" class="audio-card-play-btn" data-audio-play aria-label="Играть/пауза">▶</button>
      <input type="range" class="audio-card-volume" data-audio-volume min="0" max="1" step="0.01" value="${t.volume}">
    </div>
    <div class="audio-card-actions">
      <button type="button" class="audio-card-icon-btn" data-audio-category aria-label="Сменить категорию (сейчас: ${isMusic ? 'фоновая музыка' : 'аудио эффект'})">${isMusic ? '🎵' : '🔊'}</button>
      <button type="button" class="audio-card-icon-btn${loopOn ? ' active' : ''}" data-audio-loop aria-pressed="${loopOn}" aria-label="Зацикливание">🔁</button>
      <button type="button" class="audio-card-icon-btn" data-audio-rename aria-label="Переименовать">✎</button>
      <button type="button" class="audio-card-icon-btn" data-audio-delete aria-label="Удалить">🗑</button>
    </div>
  </div>`;
}
```

- [ ] **Step 5: Wire the category-toggle click — move the live DOM node instead of a full re-render**

A full `_audioLibRender()` call after toggling would replace the entire innerHTML of both columns via `grid.innerHTML = ...map(...)`, destroying and recreating every `<audio>` element on the page — including ones that are mid-playback elsewhere. Move just the toggled card's existing DOM node into the other column's container instead, so any other track currently playing is undisturbed (this mirrors the `await audioEl.play()` fix from the base feature — don't regress playback correctness for a UI convenience).

`web/public/audio-library.js` — find the click delegate block that currently reads:
```js
  const loopBtn = e.target.closest('[data-audio-loop]');
  if (loopBtn) { await _audioLibToggleLoop(loopBtn.closest('.audio-card'), loopBtn); return; }

  const renameBtn = e.target.closest('[data-audio-rename]');
```
Change to add a category branch right before the loop branch:
```js
  const categoryBtn = e.target.closest('[data-audio-category]');
  if (categoryBtn) { await _audioLibToggleCategory(categoryBtn.closest('.audio-card'), categoryBtn); return; }

  const loopBtn = e.target.closest('[data-audio-loop]');
  if (loopBtn) { await _audioLibToggleLoop(loopBtn.closest('.audio-card'), loopBtn); return; }

  const renameBtn = e.target.closest('[data-audio-rename]');
```

Add the `_audioLibToggleCategory` function right after `_audioLibToggleLoop` (which currently ends around line 100):
```js
async function _audioLibToggleCategory(card, btn) {
  const id = card.dataset.audioId;
  const entry = _audioLibCache.find(t => t.id === id);
  if (!entry) return;
  const next = entry.category === 'music' ? 'effect' : 'music';
  try {
    const updated = await apiFetch(`/api/audio/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: next }),
    });
    entry.category = updated.category;
    btn.textContent = entry.category === 'music' ? '🎵' : '🔊';
    btn.setAttribute('aria-label', `Сменить категорию (сейчас: ${entry.category === 'music' ? 'фоновая музыка' : 'аудио эффект'})`);
    const targetContainer = document.getElementById(entry.category === 'music' ? 'audio-lib-music-cards' : 'audio-lib-effects-cards');
    targetContainer.appendChild(card); // переносит живой DOM-узел (аудио продолжает играть, если играло) в другую колонку
    _audioLibRefreshColumnEmptyStates();
  } catch (e) {
    showToast('Не удалось сменить категорию: ' + e.message, 'error');
  }
}

function _audioLibRefreshColumnEmptyStates() {
  [
    ['audio-lib-music-cards', 'Пока нет фоновой музыки.'],
    ['audio-lib-effects-cards', 'Пока нет эффектов.'],
  ].forEach(([containerId, emptyText]) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    const hasCards = el.querySelector('.audio-card') !== null;
    let placeholder = el.querySelector('.audio-lib-col-empty');
    if (!hasCards && !placeholder) {
      el.insertAdjacentHTML('beforeend', `<div class="loading-state audio-lib-col-empty">${emptyText}</div>`);
    } else if (hasCards && placeholder) {
      placeholder.remove();
    }
  });
}
```

- [ ] **Step 6: Run the full test suite (pure frontend change, confirms nothing else broke)**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/public/index.html web/public/audio-library.js web/public/styles.css
git commit -m "feat: required music/effect category on upload + card category toggle"
```

---

### Task 5: Frontend — preset creation/edit modal

**Files:**
- Modify: `web/public/index.html`
- Modify: `web/public/styles.css`
- Modify: `web/public/audio-library.js`

- [ ] **Step 1: Add the preset modal markup**

`web/public/index.html:1288–1309` currently ends the upload modal at line 1309 (`</div>`, closing `#audio-upload-modal`), immediately followed by whatever comes next (the Image Lightbox block, per the base feature). Add the new modal right after that closing `</div>` of `#audio-upload-modal`:
```html
<!-- ── Audio Preset Modal ── -->
<div id="audio-preset-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="Аудио пресет">
  <div class="modal-box">
    <button type="button" class="modal-close" id="audio-preset-close" aria-label="Закрыть">✕</button>
    <h1 class="page-title" style="margin-bottom:20px" id="audio-preset-modal-title">Создать пресет</h1>
    <form id="audio-preset-form">
      <div class="form-group">
        <label class="form-label" for="audio-preset-name">Название *</label>
        <input class="form-control" id="audio-preset-name" type="text" required placeholder="Например, «Погоня в переулке»">
      </div>
      <div class="form-group">
        <label class="form-label" for="audio-preset-location">Локация</label>
        <select class="form-control" id="audio-preset-location"><option value="">— Без локации —</option></select>
      </div>
      <div class="form-group">
        <label class="form-label">Звуки *</label>
        <div id="audio-preset-track-list" class="audio-preset-track-picker"></div>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn-submit" id="audio-preset-submit">Сохранить</button>
        <button type="button" class="btn-submit btn-secondary" id="audio-preset-cancel">Отмена</button>
        <span id="audio-preset-err" class="err" style="display:none"></span>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 2: Style the track picker**

Add to `web/public/styles.css`, right after the `.audio-category-radio input[type="radio"]` rule added in Task 4:
```css
.audio-preset-track-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border2);
  border-radius: 2px;
  padding: 8px;
}

.audio-preset-picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  cursor: pointer;
}

.audio-preset-picker-title {
  flex: 1;
  font-size: var(--fs-sm);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-preset-picker-row input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
  cursor: pointer;
}

.audio-preset-picker-row input[type="range"] {
  width: 100px;
  accent-color: var(--accent);
}

.audio-preset-picker-row input[type="range"]:disabled {
  opacity: .35;
}
```

- [ ] **Step 3: Populate the track picker and location dropdown when the modal opens**

Add this to `web/public/audio-library.js`, right after the `loadAudioPresets` stub added in Task 3 Step 5 — replace that stub entirely:
```js
// TODO(Task 6): replaced with the real preset loader/renderer.
async function loadAudioPresets() {}
```
with:
```js
let _audioPresetCache = null; // [{ id, name, locationSlug, locationTitle, locationImageUrl, tracks:[{trackId,volume,title,url}], createdAt }]
let _audioPresetLocations = null; // [{ slug, title }] — cached, loaded once per page visit
let _audioPresetEditingId = null; // null = creating a new preset; otherwise editing this preset's id

function _audioPresetTrackPickerRowHtml(t) {
  return `<label class="audio-preset-picker-row">
    <input type="checkbox" data-preset-pick-track value="${escAttr(t.id)}">
    <span class="audio-preset-picker-title">${escHtml(t.title)}</span>
    <input type="range" data-preset-pick-volume min="0" max="1" step="0.01" value="${t.volume}" disabled>
  </label>`;
}

function _audioPresetRenderTrackPicker(checkedTracks = []) {
  const list = document.getElementById('audio-preset-track-list');
  list.innerHTML = (_audioLibCache || []).map(_audioPresetTrackPickerRowHtml).join('');
  checkedTracks.forEach(ct => {
    const row = list.querySelector(`input[data-preset-pick-track][value="${CSS.escape(ct.trackId)}"]`)?.closest('.audio-preset-picker-row');
    if (!row) return; // трек мог быть удалён из библиотеки — пропускаем в форме редактирования
    const checkbox = row.querySelector('[data-preset-pick-track]');
    const volume   = row.querySelector('[data-preset-pick-volume]');
    checkbox.checked = true;
    volume.disabled  = false;
    volume.value     = ct.volume;
  });
}

document.getElementById('audio-preset-track-list')?.addEventListener('change', e => {
  const checkbox = e.target.closest('[data-preset-pick-track]');
  if (!checkbox) return;
  const volume = checkbox.closest('.audio-preset-picker-row').querySelector('[data-preset-pick-volume]');
  volume.disabled = !checkbox.checked;
});

async function _audioPresetLoadLocationsOnce() {
  if (_audioPresetLocations) return _audioPresetLocations;
  try {
    _audioPresetLocations = await fetch('/api/locations' + window.location.search).then(r => r.json());
  } catch { _audioPresetLocations = []; }
  return _audioPresetLocations;
}

async function _audioPresetPopulateLocationSelect(selectedSlug = '') {
  const sel = document.getElementById('audio-preset-location');
  const locs = await _audioPresetLoadLocationsOnce();
  sel.innerHTML = '<option value="">— Без локации —</option>' +
    locs.map(loc => `<option value="${escAttr(loc.slug)}"${loc.slug === selectedSlug ? ' selected' : ''}>${escHtml(loc.title || loc.slug)}</option>`).join('');
}

const _audioPresetModal = document.getElementById('audio-preset-modal');

async function _audioPresetOpenModal(preset = null) {
  _audioPresetEditingId = preset ? preset.id : null;
  document.getElementById('audio-preset-modal-title').textContent = preset ? 'Редактировать пресет' : 'Создать пресет';
  document.getElementById('audio-preset-name').value = preset ? preset.name : '';
  document.getElementById('audio-preset-err').style.display = 'none';
  await _audioPresetPopulateLocationSelect(preset ? (preset.locationSlug || '') : '');
  _audioPresetRenderTrackPicker(preset ? preset.tracks : []);
  _audioPresetModal.classList.add('open');
}

document.getElementById('audio-preset-create-btn')?.addEventListener('click', () => _audioPresetOpenModal(null));
document.getElementById('audio-preset-close')?.addEventListener('click', () => _audioPresetModal.classList.remove('open'));
document.getElementById('audio-preset-cancel')?.addEventListener('click', () => _audioPresetModal.classList.remove('open'));
_audioPresetModal?.addEventListener('click', e => { if (e.target === _audioPresetModal) _audioPresetModal.classList.remove('open'); });

document.getElementById('audio-preset-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('audio-preset-err');
  errEl.style.display = 'none';

  const name = document.getElementById('audio-preset-name').value.trim();
  const locationSlug = document.getElementById('audio-preset-location').value || null;
  const tracks = Array.from(document.querySelectorAll('#audio-preset-track-list [data-preset-pick-track]:checked'))
    .map(cb => ({
      trackId: cb.value,
      volume: parseFloat(cb.closest('.audio-preset-picker-row').querySelector('[data-preset-pick-volume]').value),
    }));

  if (!name) { errEl.textContent = 'Укажите название'; errEl.style.display = ''; return; }
  if (!tracks.length) { errEl.textContent = 'Отметьте хотя бы один звук'; errEl.style.display = ''; return; }

  try {
    if (_audioPresetEditingId) {
      const updated = await apiFetch(`/api/audio/presets/${encodeURIComponent(_audioPresetEditingId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, locationSlug, tracks }),
      });
      const idx = _audioPresetCache.findIndex(p => p.id === updated.id);
      if (idx !== -1) _audioPresetCache[idx] = { ..._audioPresetCache[idx], ...updated };
    } else {
      await apiFetch('/api/audio/presets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, locationSlug, tracks }),
      });
    }
    await loadAudioPresets();
    _audioPresetModal.classList.remove('open');
    showToast(_audioPresetEditingId ? 'Пресет обновлён' : 'Пресет создан', 'success');
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = '';
  }
});
```

- [ ] **Step 4: Run the full test suite (pure frontend, confirms nothing else broke)**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/public/index.html web/public/styles.css web/public/audio-library.js
git commit -m "feat: audio preset creation/edit modal (track picker + location select)"
```

---

### Task 6: Frontend — preset card rendering + playback

**Files:**
- Modify: `web/public/audio-library.js`
- Modify: `web/public/styles.css`

- [ ] **Step 1: Style the preset card**

Add to `web/public/styles.css`, right after the `.audio-preset-picker-row input[type="range"]:disabled` rule added in Task 5:
```css
.audio-preset-card {
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

.audio-preset-card:hover {
  border-color: rgb(139 0 0 / 40%);
  background: var(--bg4);
}

.audio-preset-location {
  display: flex;
  align-items: center;
  gap: 8px;
}

.audio-preset-loc-img {
  width: 32px;
  height: 32px;
  border-radius: 2px;
  object-fit: cover;
  flex-shrink: 0;
}

.audio-preset-loc-name {
  font-size: var(--fs-xs);
  color: var(--text3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-preset-tracks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.audio-preset-track-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.audio-preset-track-title {
  flex: 1;
  font-size: var(--fs-xs);
  color: var(--text2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: Implement preset card rendering and CRUD (rename/delete) wiring**

Replace the `loadAudioPresets` stub (currently just `async function loadAudioPresets() {}`, added in Task 3 and left untouched by Task 5) with the real implementation. Add this to `web/public/audio-library.js`, right after the form-submit handler added in Task 5:
```js
let _audioActivePresetId = null;

function _audioPresetCardHtml(p) {
  const isActive = _audioActivePresetId === p.id;
  const locationHtml = p.locationTitle
    ? `<div class="audio-preset-location">
        ${p.locationImageUrl ? `<img class="audio-preset-loc-img" src="${escAttr(p.locationImageUrl)}" alt="">` : ''}
        <span class="audio-preset-loc-name">${escHtml(p.locationTitle)}</span>
      </div>`
    : '';
  const tracksHtml = p.tracks.map(t => `
    <div class="audio-preset-track-row" data-preset-track-id="${escAttr(t.trackId)}">
      <span class="audio-preset-track-title">${escHtml(t.title)}</span>
      <input type="range" data-preset-track-volume min="0" max="1" step="0.01" value="${t.volume}">
    </div>`).join('');
  return `<div class="audio-preset-card" data-preset-id="${escAttr(p.id)}">
    <div class="audio-card-title">${escHtml(p.name)}</div>
    ${locationHtml}
    <div class="audio-preset-tracks">${tracksHtml}</div>
    <div class="audio-card-row">
      <button type="button" class="audio-card-play-btn${isActive ? ' playing' : ''}" data-preset-play aria-label="Запустить/остановить пресет">${isActive ? '⏸' : '▶'}</button>
    </div>
    <div class="audio-card-actions">
      <button type="button" class="audio-card-icon-btn" data-preset-edit aria-label="Редактировать пресет">✎</button>
      <button type="button" class="audio-card-icon-btn" data-preset-delete aria-label="Удалить пресет">🗑</button>
    </div>
  </div>`;
}

function _audioPresetRender() {
  const el = document.getElementById('audio-lib-presets-cards');
  if (!el) return;
  el.innerHTML = (_audioPresetCache && _audioPresetCache.length)
    ? _audioPresetCache.map(_audioPresetCardHtml).join('')
    : '<div class="loading-state">Пока нет пресетов.</div>';
}

async function loadAudioPresets() {
  try {
    _audioPresetCache = await apiFetch('/api/audio/presets');
  } catch (e) {
    showToast('Не удалось загрузить пресеты: ' + e.message, 'error');
    _audioPresetCache = [];
  }
  _audioPresetRender();
}

async function _audioPresetPlay(presetId) {
  const preset = (_audioPresetCache || []).find(p => p.id === presetId);
  if (!preset) return;
  _audioLibStopAll(); // сначала остановить всё — см. спеку
  for (const t of preset.tracks) {
    const card = document.querySelector(`.audio-card[data-audio-id="${CSS.escape(t.trackId)}"]`);
    if (!card) continue; // трек удалён из библиотеки — тихо пропускаем
    const audioEl = card.querySelector('[data-audio-el]');
    audioEl.volume = t.volume;
    try {
      await audioEl.play();
      const playBtn = card.querySelector('[data-audio-play]');
      playBtn.textContent = '⏸';
      playBtn.classList.add('playing');
    } catch (e) {
      showToast(`Не удалось запустить «${t.title}»: ` + e.message, 'error');
    }
  }
  _audioActivePresetId = presetId;
  _audioPresetRender();
}

function _audioPresetStop() {
  _audioLibStopAll();
  _audioActivePresetId = null;
  _audioPresetRender();
}

async function _audioPresetDelete(presetId) {
  const preset = (_audioPresetCache || []).find(p => p.id === presetId);
  if (!await showConfirm(`Удалить пресет «${preset?.name || ''}»?\nДействие необратимо.`, { danger: true, confirmText: 'Удалить' })) return;
  try {
    await apiFetch(`/api/audio/presets/${encodeURIComponent(presetId)}`, { method: 'DELETE' });
    if (_audioActivePresetId === presetId) _audioActivePresetId = null;
    _audioPresetCache = _audioPresetCache.filter(p => p.id !== presetId);
    _audioPresetRender();
  } catch (e) {
    showToast('Не удалось удалить пресет: ' + e.message, 'error');
  }
}

let _audioPresetVolumeTimers = {};
function _audioPresetDebouncedSaveTrackVolume(presetId, trackId, volume) {
  const key = presetId + ':' + trackId;
  clearTimeout(_audioPresetVolumeTimers[key]);
  _audioPresetVolumeTimers[key] = setTimeout(async () => {
    const preset = (_audioPresetCache || []).find(p => p.id === presetId);
    if (!preset) return;
    const tracks = preset.tracks.map(t => t.trackId === trackId ? { trackId: t.trackId, volume } : { trackId: t.trackId, volume: t.volume });
    try {
      await apiFetch(`/api/audio/presets/${encodeURIComponent(presetId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracks }),
      });
      const entry = preset.tracks.find(t => t.trackId === trackId);
      if (entry) entry.volume = volume;
    } catch (e) {
      showToast('Не удалось сохранить громкость пресета: ' + e.message, 'error');
    }
  }, 400);
}

// ── Делегирование кликов/ввода для карточек пресетов — тот же общий
// контейнер .audio-lib-columns, что и у карточек треков (см. Task 3). ──
document.querySelector('.audio-lib-columns')?.addEventListener('click', async e => {
  const playBtn = e.target.closest('[data-preset-play]');
  if (playBtn) {
    const presetId = playBtn.closest('.audio-preset-card').dataset.presetId;
    if (_audioActivePresetId === presetId) await _audioPresetStop();
    else await _audioPresetPlay(presetId);
    return;
  }
  const editBtn = e.target.closest('[data-preset-edit]');
  if (editBtn) {
    const presetId = editBtn.closest('.audio-preset-card').dataset.presetId;
    const preset = (_audioPresetCache || []).find(p => p.id === presetId);
    if (preset) await _audioPresetOpenModal(preset);
    return;
  }
  const deleteBtn = e.target.closest('[data-preset-delete]');
  if (deleteBtn) { await _audioPresetDelete(deleteBtn.closest('.audio-preset-card').dataset.presetId); return; }
});

document.querySelector('.audio-lib-columns')?.addEventListener('input', e => {
  const slider = e.target.closest('[data-preset-track-volume]');
  if (!slider) return;
  const presetCard = slider.closest('.audio-preset-card');
  const presetId   = presetCard.dataset.presetId;
  const trackId    = slider.closest('[data-preset-track-id]').dataset.presetTrackId;
  const volume     = parseFloat(slider.value);

  // Если этот пресет сейчас играет — громкость меняется вживую у уже играющего трека.
  if (_audioActivePresetId === presetId) {
    const trackCard = document.querySelector(`.audio-card[data-audio-id="${CSS.escape(trackId)}"]`);
    const audioEl = trackCard?.querySelector('[data-audio-el]');
    if (audioEl) audioEl.volume = volume;
  }
  _audioPresetDebouncedSaveTrackVolume(presetId, trackId, volume);
});
```

- [ ] **Step 3: Make "Остановить всё" also clear the active-preset indicator**

`web/public/audio-library.js` — the `_audioLibStopAll` function was extracted in Task 3 and is wired to the button via:
```js
document.getElementById('audio-lib-stop-all-btn')?.addEventListener('click', _audioLibStopAll);
```
Change to reset the active-preset state too (a global stop should visually un-mark whichever preset button was showing "⏸"):
```js
document.getElementById('audio-lib-stop-all-btn')?.addEventListener('click', () => {
  _audioLibStopAll();
  _audioActivePresetId = null;
  _audioPresetRender();
});
```

- [ ] **Step 4: Run the full test suite**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/public/audio-library.js web/public/styles.css
git commit -m "feat: preset card rendering, playback (stop-all-then-play), per-track volume, edit/delete"
```

---

### Task 7: Manual verification + impeccable + cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `cd web && npm test`
Expected: PASS. (The one pre-existing unrelated e2e failure documented in the base feature's implementation — `validate_cards --strict` flagging a missing "Родной город" field on `cities/paris/characters/fairies/kventin/kventin.md` — is not caused by this work; confirm it's still the *only* failure, if any, by comparing the failure output to that known issue rather than assuming.)

- [ ] **Step 2: Re-run impeccable's detector on the changed frontend files**

```
node .claude/skills/impeccable/scripts/detect.mjs --json web/public/index.html web/public/styles.css web/public/audio-library.js
```
Compare against the Task 3 Step 1 baseline — confirm no new findings introduced by this feature (contrast, touch targets ≥44px, token usage were all designed in with existing tokens/patterns throughout Tasks 3–6, but this is the verification gate).

- [ ] **Step 3: Manual browser check via the `run-sanguine-web` skill**

Follow that skill's recipe (restart dev server via `POST /api/restart`, headless Chrome via raw CDP, skip onboarding tour) and exercise, in order:
1. Navigate to `audio-library` — 3 columns visible (Фоновая музыка / Эффекты / Аудио пресеты), each with its own empty-state text if empty.
2. Upload a track, selecting "Фоновая музыка" — appears in the music column, not effects. Upload a second, selecting "Аудио эффекты" — appears in the effects column.
3. Try submitting the upload form with neither radio checked — browser's native validation blocks it (no network request fires).
4. Click the category-toggle (🎵/🔊) on the music track while it's playing — confirm (via `Runtime.evaluate` reading `audioEl.paused`) that it keeps playing and moves to the effects column without interruption.
5. Click "+ Создать пресет" — modal opens, track picker lists both tracks, location dropdown is populated from `GET /api/locations`.
6. Check both tracks, set distinct volumes on each, optionally pick a location, save — new preset card appears in the presets column showing name, location thumbnail (if picked), and both tracks with their saved volumes.
7. Click the preset's play button — confirm (via `Runtime.evaluate`) that both referenced `<audio>` elements report `paused === false` at their preset-specific volumes, and the button shows "⏸".
8. Drag one of the preset card's per-track volume sliders while it's playing — confirm the corresponding `<audio>` element's `.volume` changes live.
9. Click the preset's stop button — confirm both tracks are paused and reset, button shows "▶" again.
10. Click "⏹ Остановить всё" while a preset is active — confirm the preset card's button also reverts to "▶".
11. Edit the preset (✎) — modal opens pre-filled with its name, location, and checked tracks at their saved volumes; change something, save, confirm it persists via a fresh `GET /api/audio/presets`.
12. Delete one of the underlying tracks referenced by the preset (🗑 on the track card) — confirm the preset card still renders (with only the remaining track) rather than disappearing or erroring.
13. Close the headless Chrome instance via `Browser.close` over the CDP socket (never `taskkill`).

- [ ] **Step 4: Clean up any test artifacts left on disk**

Any track/preset created purely to exercise Step 3 must not survive. `cities/audio/` is gitignored, so nothing here is tracked — but check for real user data before touching anything on disk (the base feature's implementation found genuine user-uploaded tracks already present in this exact directory once):
```bash
curl -s http://localhost:4295/api/audio
curl -s http://localhost:4295/api/audio/presets
```
Delete only the specific test track/preset ids created in Step 3, via `DELETE /api/audio/<id>` and `DELETE /api/audio/presets/<id>` — never `rm -rf cities/audio` blindly.

- [ ] **Step 5: Final status check**

```bash
git status
```
Expected: working tree clean except for the commits already made in Tasks 1–6; no stray test artifacts.

---

## Out of scope (per spec)

- Drag-and-drop reordering of columns or cards.
- A cap on how many tracks a preset may contain.
- Presets shared across cities — `locationSlug` resolves against whichever city is active in the request at render time.
