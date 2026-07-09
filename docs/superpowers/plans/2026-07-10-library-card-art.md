# Иллюстрации карточек библиотеки (Дисциплины + Психика) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Квадратные карточки 200×200 с гербовой AI-иллюстрацией (медальон/волк-эмблема в палитре сайта) для всех 17 дисциплин и 11 психических способностей библиотеки, генерируемые локальным ComfyUI пользователя через готовый HTTP-workflow.

**Architecture:** `.lib-card`/`.lib-cards` (общий класс на все 5 разделов библиотеки) становится квадратным по образцу `.char-card`/`.char-card.has-art`. Готовые PNG кладутся прямо в `web/public/img/system/library/<раздел>/<slug>.png` — эта папка уже раздаётся статикой существующим `express.static(path.join(__dirname, 'public'))` (`web/server.js:74`), поэтому **новый статический роут не нужен**, картинка доступна как `/img/system/library/<раздел>/<slug>.png` из коробки. Бэкенд (`web/routes/library.js`) при парсинге дисциплин/психики проверяет наличие файла в этой папке и добавляет флаг `hasArt` в ответ API; фронтенд (`web/public/v20-sheet.js`) рендерит `.lib-card.has-art` с картинкой, если флаг есть, иначе — прежний текстовый вариант без изменений. Сами PNG генерируются отдельным Node-скриптом (`tools/generate_library_art.js`), который поднимает/проверяет локальный ComfyUI (`127.0.0.1:8188`), гоняет уже проверенный вручную в этом разговоре API-graph (`CheckpointLoaderSimple(sd_xl_base_1.0.safetensors)` → `CLIPTextEncode`×2 → `EmptyLatentImage(1024×1024)` → `KSampler` → `VAEDecode` → `SaveImage`), забирает готовый файл прямо из `ComfyUI/output/` (сервер и репозиторий — одна машина) и уменьшает до 400×400 через `System.Drawing`/PowerShell (без новых npm-зависимостей).

**Tech Stack:** Node.js (Express, уже в проекте), ComfyUI HTTP API (`fetch`, встроен в Node 22+), PowerShell + `System.Drawing` для ресайза, headless Chrome (raw CDP, см. `run-sanguine-web`) для визуальной проверки.

**Объём (посчитано по факту, не на глаз):** 17 файлов в `system/library/disciplines/*.md` (без `README.md`), 11 файлов в `system/library/psychics/*.md` (без `README.md`) — итого **28** карточек с реальным артом в этом плане. Достоинства (62 записи в 4 файлах), недостатки (100 записей в 4 файлах) и факты биографии (51 запись в 5 файлах) — это ещё 213 отдельных карточек; они **вне объёма этого плана** (см. «Out of scope» в конце).

---

### Task 1: Флаг `hasArt` в загрузчиках дисциплин/психики

**Files:**
- Modify: `web/routes/library.js:20-78`
- Test: `web/tests/all.test.js` (блок `describe('Library', ...)`, после строки 1710)

- [x] **Step 1: Написать падающий тест**

Добавить в `web/tests/all.test.js` внутри `describe('Library', () => { ... })`, перед закрывающей `});` на строке 1710:

```js
    it('GET /api/library/disciplines → hasArt отражает наличие web/public/img/system/library/disciplines/<slug>.png', async () => {
      // Полностью самодостаточная фикстура (синтетические .md + .png), а не
      // проверка на реальной дисциплине — иначе тест сломается сам собой
      // после Task 5/6 этого плана, когда у всех 17 реальных дисциплин
      // появится настоящий арт и любое захардкоженное "у X ещё нет арта"
      // станет ложным.
      const discDir = path.join(__dirname, '../../system/library/disciplines');
      const imgDir = path.join(__dirname, '../public/img/system/library/disciplines');
      await fs.mkdir(imgDir, { recursive: true });
      const mdWithArt = path.join(discDir, '__test_with_art__.md');
      const mdNoArt = path.join(discDir, '__test_no_art__.md');
      const pngWithArt = path.join(imgDir, '__test_with_art__.png');
      await fs.writeFile(mdWithArt, '# 🐺 Тест с артом (Test)\n');
      await fs.writeFile(mdNoArt, '# 🐺 Тест без арта (Test)\n');
      await fs.writeFile(pngWithArt, Buffer.from([0]));
      try {
        const { status, body } = await apiJson('/api/library/disciplines');
        assert.equal(status, 200);
        const withArt = body.find(d => d.slug === '__test_with_art__');
        const noArt = body.find(d => d.slug === '__test_no_art__');
        assert.ok(withArt, 'фикстура __test_with_art__ должна попасть в список');
        assert.ok(noArt, 'фикстура __test_no_art__ должна попасть в список');
        assert.equal(withArt.hasArt, true);
        assert.equal(noArt.hasArt, false);
      } finally {
        await fs.rm(mdWithArt, { force: true });
        await fs.rm(mdNoArt, { force: true });
        await fs.rm(pngWithArt, { force: true });
      }
    });
    it('GET /api/library/psychics → у всех записей есть поле hasArt (boolean)', async () => {
      const { status, body } = await apiJson('/api/library/psychics');
      assert.equal(status, 200);
      assert.ok(body.length > 0);
      for (const p of body) assert.equal(typeof p.hasArt, 'boolean');
    });
```

`fs` (промисовый) и `path` уже импортированы в начале файла (строки 7-8), `apiJson` — из `./helpers` (строка 9). Ничего дополнительно импортировать не нужно.

- [x] **Step 2: Запустить тест, убедиться что падает**

```bash
cd web && npm run test:unit 2>&1 | grep -A3 "hasArt"
```

Ожидается: `assert.ok(withArt, ...)` провалится или `assert.equal(withArt.hasArt, true)` упадёт как `undefined !== true` (поля `hasArt` ещё нет).

- [x] **Step 3: Реализовать `hasArt` в `loadDisciplines`/`loadPsychics`**

В `web/routes/library.js` заменить блок `loadDisciplines` (строки 25-44) на:

```js
async function loadDisciplines() {
  const files = (await fs.readdir(DISC_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();

  const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', 'disciplines');
  const artFiles = await fs.readdir(imgDir).catch(() => []);

  // Сигнатура включает и mtime .md-файлов, и список картинок — чтобы появление
  // нового PNG сбрасывало кэш так же надёжно, как правка текста дисциплины.
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(DISC_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|') + '||art:' + artFiles.sort().join(',');
  if (_discCache && _discCache.sig === sig) return _discCache.list;

  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(DISC_DIR, f), 'utf-8').catch(() => '');
    if (md) {
      const parsed = parseDisciplineMd(md, slug);
      parsed.hasArt = artFiles.includes(slug + '.png');
      list.push(parsed);
    }
  }
  _discCache = { sig, list };
  return list;
}
```

И аналогично `loadPsychics` (строки 56-73) на:

```js
async function loadPsychics() {
  const files = (await fs.readdir(PSY_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();

  const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', 'psychics');
  const artFiles = await fs.readdir(imgDir).catch(() => []);

  const stats = await Promise.all(mds.map(f => fs.stat(path.join(PSY_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|') + '||art:' + artFiles.sort().join(',');
  if (_psyCache && _psyCache.sig === sig) return _psyCache.list;

  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(PSY_DIR, f), 'utf-8').catch(() => '');
    if (md) {
      const parsed = parsePsychicMd(md, slug);
      parsed.hasArt = artFiles.includes(slug + '.png');
      list.push(parsed);
    }
  }
  _psyCache = { sig, list };
  return list;
}
```

- [x] **Step 4: Запустить тесты, убедиться что проходят**

```bash
cd web && npm run test:unit
```

Ожидается: все тесты зелёные, включая два новых из Step 1.

- [x] **Step 5: Revert сгенерированный тестовый отчёт**

```bash
git checkout -- web/tests/report.html
```

(regenerируется при каждом прогоне тестов — не коммитить, см. `run-sanguine-web` skill.)

- [x] **Step 6: Commit**

```bash
git add web/routes/library.js web/tests/all.test.js
git commit -m "feat: hasArt flag for disciplines/psychics library entries"
```

---

### Task 2: CSS — квадратные карточки 200×200 + вариант с артом

**Files:**
- Modify: `web/public/styles.css:7989-8049`

- [x] **Step 1: Сделать `.lib-cards`/`.lib-card` квадратными**

Текущий блок (строки 7989-8005):

```css
.lib-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
  gap: 14px;
}

.lib-card {
  background: var(--bg3);
  border: 2px solid var(--border);
  border-radius: 2px;
  padding: 18px;
  text-align: left;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color .2s var(--ease), background .2s var(--ease), transform .2s var(--ease);
}
```

Заменить на:

```css
.lib-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr));
  gap: 14px;
}

.lib-card {
  width: 200px;
  height: 200px;
  background: var(--bg3);
  border: 2px solid var(--border);
  border-radius: 2px;
  padding: 18px;
  text-align: left;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  transition: border-color .2s var(--ease), background .2s var(--ease), transform .2s var(--ease);
}
```

- [x] **Step 2: Добавить вариант с артом (по образцу `.char-card.has-art`, строки 987-1047)**

Сразу после блока `.lib-card-points` (строка 8049, конец существующего CSS-раздела библиотеки), добавить:

```css
/* Карточка с иллюстрацией (генерируется ComfyUI, см. tools/generate_library_art.js) —
   картинка на всю карточку, название/мета — оверлеем снизу поверх градиента,
   тот же приём, что и у .char-card.has-art. */
.lib-card.has-art {
  padding: 0;
}

.lib-card-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  z-index: 0;
}

.lib-card-overlay {
  z-index: 1;
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 30px 10px 8px;
  background: linear-gradient(to bottom,
      transparent 0%,
      rgba(7, 5, 10, .75) 40%,
      rgba(7, 5, 10, .97) 75%,
      rgba(7, 5, 10, 1) 100%);
}

.lib-card.has-art .lib-card-name,
.lib-card.has-art .lib-card-meta {
  margin-bottom: 0;
}
```

- [x] **Step 3: Прогнать impeccable detect по изменённому файлу**

```bash
node .claude/skills/impeccable/scripts/detect.mjs --json web/public/styles.css
```

Ожидается: 0 находок (либо только уже известные из предыдущих коммитов, не относящиеся к этой правке).

- [x] **Step 4: Commit**

```bash
git add web/public/styles.css
git commit -m "feat: square 200x200 library cards + has-art overlay variant"
```

---

### Task 3: Фронтенд — рендер арта в карточках дисциплин/психики

**Files:**
- Modify: `web/public/v20-sheet.js:748-754` (`_libDisciplineCardsHtml`)
- Modify: `web/public/v20-sheet.js:865-871` (`_libPsychicCardsHtml`)

- [x] **Step 1: Обновить `_libDisciplineCardsHtml`**

Текущий код (строки 748-754):

```js
function _libDisciplineCardsHtml() {
  return `<div class="lib-cards">${(_disciplinesCache || []).map(d =>
    `<button type="button" class="lib-card" data-disc-slug="${escAttr(d.slug)}">
      <div class="lib-card-name">${escHtml(d.name)}</div>
      <div class="lib-card-meta">${escHtml(d.clans || '')}</div>
    </button>`).join('')}</div>`;
}
```

Заменить на:

```js
function _libDisciplineCardsHtml() {
  return `<div class="lib-cards">${(_disciplinesCache || []).map(d => {
    const art = d.hasArt
      ? `<img class="lib-card-art" src="/img/system/library/disciplines/${escAttr(d.slug)}.png" alt="">`
      : '';
    const inner = `<div class="lib-card-name">${escHtml(d.name)}</div><div class="lib-card-meta">${escHtml(d.clans || '')}</div>`;
    return `<button type="button" class="lib-card${d.hasArt ? ' has-art' : ''}" data-disc-slug="${escAttr(d.slug)}">
      ${art}${d.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
    </button>`;
  }).join('')}</div>`;
}
```

- [x] **Step 2: Обновить `_libPsychicCardsHtml`**

Текущий код (строки 865-871):

```js
function _libPsychicCardsHtml() {
  return `<div class="lib-cards">${(_psychicsCache || []).map(p =>
    `<button type="button" class="lib-card" data-psy-slug="${escAttr(p.slug)}">
      <div class="lib-card-name">${escHtml(p.name)}</div>
      <div class="lib-card-meta">${escHtml(p.category || '')}</div>
    </button>`).join('')}</div>`;
}
```

Заменить на:

```js
function _libPsychicCardsHtml() {
  return `<div class="lib-cards">${(_psychicsCache || []).map(p => {
    const art = p.hasArt
      ? `<img class="lib-card-art" src="/img/system/library/psychics/${escAttr(p.slug)}.png" alt="">`
      : '';
    const inner = `<div class="lib-card-name">${escHtml(p.name)}</div><div class="lib-card-meta">${escHtml(p.category || '')}</div>`;
    return `<button type="button" class="lib-card${p.hasArt ? ' has-art' : ''}" data-psy-slug="${escAttr(p.slug)}">
      ${art}${p.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
    </button>`;
  }).join('')}</div>`;
}
```

- [x] **Step 3: impeccable detect по изменённому файлу**

```bash
node .claude/skills/impeccable/scripts/detect.mjs --json web/public/v20-sheet.js
```

- [x] **Step 4: Commit**

```bash
git add web/public/v20-sheet.js
git commit -m "feat: render card art in disciplines/psychics library cards when present"
```

---

### Task 4: Первый реальный контент — перенос одобренного арта Анимализма

**Files:**
- Create: `web/public/img/system/library/disciplines/animalism.png` (перенос из scratchpad этого разговора)

- [x] **Step 1: Скопировать одобренный файл**

Файл уже сгенерирован и одобрен пользователем в этом разговоре
(`comfy_animalism_sq_v2.png` → уменьшен до `animalism_final_400.png`,
400×400, чёрный фон). Перенести финальную 400×400 версию в репозиторий:

```bash
mkdir -p web/public/img/system/library/disciplines
cp "<путь_к_scratchpad>/animalism_final_400.png" web/public/img/system/library/disciplines/animalism.png
```

- [x] **Step 2: Проверить через API**

```bash
cd web && node server.js &
sleep 1
curl -s http://localhost:4295/api/library/disciplines | node -e "
  let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
    const a = JSON.parse(d).find(x=>x.slug==='animalism');
    console.log('hasArt:', a.hasArt);
  });"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4295/img/system/library/disciplines/animalism.png
kill %1
```

Ожидается: `hasArt: true`, второй curl — `200`.

- [x] **Step 3: Проверить в браузере**

Использовать `run-sanguine-web` skill: перезапустить dev-сервер (`POST /api/restart`),
открыть библиотеку → вкладка «Дисциплины», убедиться, что карточка «Анимализм»
показывает картинку с оверлеем названия, а остальные 16 дисциплин — прежний
текстовый вид (без регрессии).

- [x] **Step 4: Commit**

```bash
git add web/public/img/system/library/disciplines/animalism.png
git commit -m "feat: add first library card art (Animalism)"
```

---

### Task 5: Тулинг для батч-генерации остальных 27 карточек

**Files:**
- Create: `tools/generate_library_art.js`
- Create: `tools/library-art-manifest.json`

- [x] **Step 1: Создать манифест сюжетов**

`tools/library-art-manifest.json` — таблица `{section, slug, scene}` на все 17
дисциплин и 11 психических способностей (Animalism включён для идемпотентности —
скрипт пропускает уже существующие файлы, см. Step 3):

```json
[
  { "section": "disciplines", "slug": "animalism",    "scene": "howling wolf head in profile" },
  { "section": "disciplines", "slug": "auspex",        "scene": "all-seeing eye wreathed in mist, a third eye opening on a bowed forehead" },
  { "section": "disciplines", "slug": "celerity",      "scene": "a running wolf blurred into streaking motion lines, afterimages trailing behind" },
  { "section": "disciplines", "slug": "chimerstry",    "scene": "a trickster fox face dissolving into shifting illusory smoke and mirror shards" },
  { "section": "disciplines", "slug": "dementation",   "scene": "a cracked porcelain jester mask with a wide unsettling grin" },
  { "section": "disciplines", "slug": "dominate",      "scene": "a single hypnotic eye radiating concentric compelling rings" },
  { "section": "disciplines", "slug": "fortitude",     "scene": "an ornate cracked stone shield standing unbroken" },
  { "section": "disciplines", "slug": "necromancy",    "scene": "a raven perched on a skull, wisps of pale spirit smoke rising" },
  { "section": "disciplines", "slug": "obfuscate",     "scene": "a hooded featureless silhouette dissolving into shadow" },
  { "section": "disciplines", "slug": "obtenebration", "scene": "coiling tendrils of living darkness reaching from a black void" },
  { "section": "disciplines", "slug": "potence",       "scene": "a clenched armored fist cracking stone beneath it" },
  { "section": "disciplines", "slug": "presence",      "scene": "a regal figure's silhouette radiating a commanding golden-red aura" },
  { "section": "disciplines", "slug": "protean",       "scene": "a wolf mid-transformation, half man half beast, mist swirling around clawed hands" },
  { "section": "disciplines", "slug": "quietus",       "scene": "a curved silent dagger dripping a single drop of blood" },
  { "section": "disciplines", "slug": "serpentis",     "scene": "a coiled serpent with hypnotic eyes wrapped around a dagger" },
  { "section": "disciplines", "slug": "thaumaturgy",   "scene": "an alchemical sigil drawn in blood encircled by arcane symbols" },
  { "section": "disciplines", "slug": "vicissitude",   "scene": "a hand of flowing molten flesh reshaping itself into claws" },
  { "section": "psychics", "slug": "biocontrol",           "scene": "a hand glowing faintly as veins pulse with controlled vital force" },
  { "section": "psychics", "slug": "psychometry",          "scene": "a hand touching an object, faint ghostly visions rippling outward from the fingertips" },
  { "section": "psychics", "slug": "telepathy",            "scene": "two silhouetted heads facing each other connected by a glowing thread of thought" },
  { "section": "psychics", "slug": "psychokinesis",        "scene": "a levitating object hovering above an open outstretched palm, faint force ripples around it" },
  { "section": "psychics", "slug": "psychoportation",      "scene": "a silhouette dissolving into a trail of shimmering afterimages, stepping between two points" },
  { "section": "psychics", "slug": "precognition",         "scene": "a single eye reflecting a fractured vision of possible futures" },
  { "section": "psychics", "slug": "psychic_invisibility", "scene": "a faint silhouette fading into transparency against the darkness" },
  { "section": "psychics", "slug": "psychic_healing",      "scene": "two hands cupped around a soft glowing light mending a wound" },
  { "section": "psychics", "slug": "empathic_healing",     "scene": "two linked hands, one glowing with healing light, the other marked with shared pain" },
  { "section": "psychics", "slug": "synergy",              "scene": "two clasped hands merging together in a shared radiant aura" },
  { "section": "psychics", "slug": "psychic_vampirism",    "scene": "a spectral hand draining a wisp of glowing life-force from a shadowy figure" }
]
```

- [x] **Step 2: Написать скрипт генерации**

`tools/generate_library_art.js`:

```js
'use strict';
// Батч-генерация иллюстраций карточек библиотеки через локальный ComfyUI.
// Использование: node tools/generate_library_art.js [--only=slug1,slug2] [--force]

const fs   = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const COMFY_HOST = 'http://127.0.0.1:8188';
const COMFY_DIR  = process.env.COMFY_DIR || 'D:\\AIImage\\ComfyUI\\ComfyUI_windows_portable';
const ROOT       = path.join(__dirname, '..');
const MANIFEST   = require('./library-art-manifest.json');

const POSITIVE_TMPL = scene => "dark gothic emblem, circular ornate medallion badge, " + scene + ", "
  + "engraved etching illustration style, blood red crescent moon glowing behind the medallion, "
  + "solid black background filling the entire square canvas outside the medallion ring, "
  + "deep crimson and black color palette, ornamental gold border with fine filigree linework, "
  + "symmetrical heraldic composition, high contrast chiaroscuro lighting, Vampire the Masquerade aesthetic, "
  + "dark fantasy tarot card icon, intricate line detail, painterly digital illustration, centered composition, "
  + "single subject, masterpiece, highly detailed, sharp focus";

const NEGATIVE = "photo, photorealistic, human face, person, portrait of a person, low quality, blurry, "
  + "watermark, text, signature, cropped, extra limbs, deformed, asymmetrical, modern cartoon, anime chibi, "
  + "3d render, plastic, multiple subjects, collage, border cropped, jpeg artifacts, "
  + "beige background, tan background, cream background, white background, light background, parchment, paper texture";

function buildWorkflow(scene, filenamePrefix) {
  return {
    "3": { "class_type": "KSampler", "inputs": {
      "seed": Math.floor(Math.random() * 1e9), "steps": 32, "cfg": 6.5,
      "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0,
      "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]
    }},
    "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" } },
    "5": { "class_type": "EmptyLatentImage", "inputs": { "width": 1024, "height": 1024, "batch_size": 1 } },
    "6": { "class_type": "CLIPTextEncode", "inputs": { "text": POSITIVE_TMPL(scene), "clip": ["4", 1] } },
    "7": { "class_type": "CLIPTextEncode", "inputs": { "text": NEGATIVE, "clip": ["4", 1] } },
    "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
    "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": filenamePrefix, "images": ["8", 0] } }
  };
}

async function isComfyUp() {
  try {
    const r = await fetch(COMFY_HOST + '/system_stats', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function ensureComfyRunning() {
  if (await isComfyUp()) return;
  console.log('ComfyUI not running — starting it...');
  const proc = spawn(
    path.join(COMFY_DIR, 'python_embeded', 'python.exe'),
    ['-s', 'ComfyUI/main.py', '--windows-standalone-build'],
    { cwd: COMFY_DIR, detached: true, stdio: 'ignore' }
  );
  proc.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (await isComfyUp()) { console.log('ComfyUI ready.'); return; }
  }
  throw new Error('ComfyUI did not become ready within 60s');
}

async function generateOne(entry) {
  const clientId = 'sanguine-libart-' + Date.now();
  const workflow = buildWorkflow(entry.scene, 'sanguine_' + entry.slug);
  const res = await fetch(COMFY_HOST + '/prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  });
  const data = await res.json();
  if (data.error) throw new Error('ComfyUI queue error: ' + JSON.stringify(data.error));
  const promptId = data.prompt_id;

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const hRes = await fetch(COMFY_HOST + '/history/' + promptId);
    const hData = await hRes.json();
    const entryHist = hData[promptId];
    if (entryHist && entryHist.status && entryHist.status.completed) {
      const img = entryHist.outputs['9'].images[0];
      return path.join(COMFY_DIR, 'ComfyUI', 'output', img.filename);
    }
    if (entryHist && entryHist.status && entryHist.status.status_str === 'error') {
      throw new Error('Generation error: ' + JSON.stringify(entryHist.status));
    }
  }
  throw new Error('Timeout waiting for ComfyUI generation: ' + entry.slug);
}

function resizeTo400(srcPath, dstPath) {
  const script = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("${srcPath.replace(/\\/g, '\\\\')}")
$dst = New-Object System.Drawing.Bitmap 400,400
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.DrawImage($src, 0, 0, 400, 400)
$dst.Save("${dstPath.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $dst.Dispose(); $src.Dispose()
`.trim();
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script]);
  if (r.status !== 0) throw new Error('PowerShell resize failed: ' + r.stderr.toString());
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyArg = args.find(a => a.startsWith('--only'));
  const only = onlyArg ? onlyArg.split('=')[1].split(',') : null;

  await ensureComfyRunning();

  for (const entry of MANIFEST) {
    if (only && !only.includes(entry.slug)) continue;
    // Готовые PNG кладём прямо в web/public/img/system/library/<раздел>/ —
    // эта папка уже раздаётся статикой (express.static на web/public), новый
    // роут не нужен (см. Architecture в шапке плана).
    const destDir = path.join(ROOT, 'web', 'public', 'img', 'system', 'library', entry.section);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, entry.slug + '.png');
    if (fs.existsSync(destPath) && !force) {
      console.log('skip (exists):', entry.slug);
      continue;
    }
    console.log('generating:', entry.slug, '...');
    const outputPath = await generateOne(entry);
    resizeTo400(outputPath, destPath);
    console.log('saved:', destPath);
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [x] **Step 3: Прогнать на одном новом slug, проверить идемпотентность**

```bash
node tools/generate_library_art.js --only=auspex
ls -la web/public/img/system/library/disciplines/auspex.png   # должен появиться
node tools/generate_library_art.js --only=auspex
# Ожидается вывод "skip (exists): auspex" — повторный прогон не тратит GPU-время впустую
```

- [x] **Step 4: Просмотреть `auspex.png`, подтвердить качество**

Открыть файл (Read/просмотрщик), убедиться что: чёрный фон на весь квадрат,
медальон не обрезан, сюжет ("all-seeing eye...") узнаваем, палитра
красный/чёрный/серебро как у Анимализма. Если что-то не так — поправить
`scene` в `library-art-manifest.json` для этой записи и повторить с `--force`,
**прежде чем** запускать батч на оставшихся 26 записях (дешевле поймать
проблему с промтом на одной генерации, чем на всех).

- [x] **Step 5: Commit**

```bash
git add tools/generate_library_art.js tools/library-art-manifest.json web/public/img/system/library/disciplines/auspex.png
git commit -m "feat: batch generation tool for library card art + auspex sample"
```

---

### Task 6: Батч-генерация оставшихся 26 карточек

**Files:**
- Create: `web/public/img/system/library/disciplines/{celerity,chimerstry,dementation,dominate,fortitude,necromancy,obfuscate,obtenebration,potence,presence,protean,quietus,serpentis,thaumaturgy,vicissitude}.png` (15 файлов)
- Create: `web/public/img/system/library/psychics/{biocontrol,psychometry,telepathy,psychokinesis,psychoportation,precognition,psychic_invisibility,psychic_healing,empathic_healing,synergy,psychic_vampirism}.png` (11 файлов)

- [x] **Step 1: Запустить полный батч (пропускает animalism/auspex — уже есть)**

```bash
node tools/generate_library_art.js
```

Ожидается: в логе `skip (exists): animalism`, `skip (exists): auspex`, затем
`generating: celerity ...` и далее по списку, итог `Done.`. На RTX 3050 8GB
каждая генерация (32 шага, 1024×1024) занимает по опыту этого разговора
десятки секунд — весь батч из 26 изображений может занять 20-40 минут,
это ожидаемо, не таймаут/зависание.

- [x] **Step 2: Выборочно просмотреть результаты**

Открыть 4-5 файлов из разных разделов (например `necromancy.png`,
`telepathy.png`, `vicissitude.png`, `psychic_vampirism.png`) — убедиться,
что фон везде чёрный (не бежевый — регрессия, с которой уже боролись при
подготовке Animalism), медальон не обрезан, нет искажённой анатомии/лишних
объектов. Если конкретная карточка не удалась — поправить её `scene` в
манифесте и перегенерировать точечно: `node tools/generate_library_art.js --only=<slug> --force`.

- [x] **Step 3: Commit**

```bash
git add web/public/img/system/library/disciplines/*.png web/public/img/system/library/psychics/*.png
git commit -m "feat: generate remaining 26 library card illustrations (disciplines + psychics)"
```

---

### Task 7: Финальная проверка

**Files:** нет изменений, только верификация.

- [x] **Step 1: Полный прогон тестов**

```bash
cd web && npm run test:unit
git checkout -- web/tests/report.html
```

Ожидается: все тесты зелёные (включая новые из Task 1).

- [x] **Step 2: impeccable по всем изменённым файлам разом**

```bash
node .claude/skills/impeccable/scripts/detect.mjs --json web/public/styles.css web/public/v20-sheet.js web/routes/library.js
```

- [x] **Step 3: Визуальная проверка в браузере (`run-sanguine-web` skill)**

Перезапустить dev-сервер, открыть Библиотеку → вкладку «Дисциплины» — все 17
карточек должны показывать иллюстрации; вкладку «Психика» — все 11; вкладки
«Достоинства»/«Недостатки»/«Факты биографии» — прежний текстовый вид без
регрессии (эти разделы вне объёма этого плана, см. ниже). Кликнуть 2-3
карточки с артом — модалка с описанием должна открываться и работать
как раньше (арт добавлен только в рендер карточки, инфраструктура клика/
модалки — `_v20EnsureLibModal`/`_bindLibraryClicks` — не менялась).

- [x] **Step 4: Закрыть ComfyUI, проверить отсутствие орфанов**

ComfyUI не предоставляет HTTP-эндпоинт graceful shutdown; закрыть процесс
вручную (окно консоли/Task Manager по PID, который вывел `ensureComfyRunning`
при старте), не трогая другие процессы `python.exe` пользователя.

---

## Out of scope (следующий план, не эта сессия)

Достоинства (62), недостатки (100) и факты биографии (51) — итого 213
отдельных карточек — технически подключаются тем же способом (CSS/JS-
инфраструктура из Task 2-3 уже подходит любому разделу библиотеки), но:

- у merits/flaws/backgrounds сейчас нет понятия `hasArt` в JSON-схеме —
  нужно либо добавить поле в сами записи, либо считать его так же, как для
  дисциплин — сверкой `slug` со списком файлов в
  `web/public/img/system/library/<раздел>/` (второе проще и не требует
  трогать данные);
- нужен манифест сюжетов на 213 записей, а не 28 — это отдельная по объёму
  задача написания контента, не генерации/кода;
- по объёму GPU-времени (десятки секунд на карточку × 213) это в 8 раз
  больше вычислений, чем в этом плане — есть смысл разбить на несколько
  сессий по категориям (сначала достоинства, потом недостатки, потом факты
  биографии), а не в одном плане.
