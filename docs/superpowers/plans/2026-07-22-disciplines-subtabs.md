# Вкладки внутри «Дисциплины» библиотеки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разбить вкладку «Дисциплины» на странице «Библиотека» на 8 подвкладок (по образцу «Достоинств»): Дисциплины (все), Комбо Дисциплины, Колдовство, Некромантия, Тауматургия, Тёмная Тауматургия, Чародейство Ассамитов, Чародейство Сеттитов — где вкладка «Дисциплины» показывает все дисциплины единой карточкой (в т.ч. 6 колдовских — «с общим описанием», чтобы их можно было добавить в чарник), а каждая колдовская вкладка раскрывает свои Пути.

**Architecture:** Источник истины остаётся файловым — `system/library/disciplines/*.md`, парсятся сервером в `GET /api/library/disciplines`. Каждая из 6 «колдовских» дисциплин — это один path-based файл (2 уже есть — `necromancy.md`, `thaumaturgy.md`; 4 создаются). В шапку каждого такого файла добавляется поле `- **Группа:**` с машинным слагом семьи (`koldun`/`necromancy`/…). Вкладка «Дисциплины» рендерит все дисциплины (по одной карточке), 6 колдовских вкладок фильтруют по `group` и раскрывают `paths[]` карточками-Путями, а «Комбо Дисциплины» — отдельный небольшой датасет (`system/library/combo_disciplines.json`) с новым эндпоинтом, т.к. у комбо-дисциплин нет шкалы 1–5, а есть предпосылки (prereq) + описание. Добавление в чарник уже работает через общий кэш `_disciplinesCache` — создание 4 новых файлов автоматически делает их доступными в пикере листа персонажа, отдельного UI для этого не нужно.

**Tech Stack:** Node/Express (backend, `web/routes/library.js`, `web/lib/disciplines.js`), vanilla JS фронт (`web/public/scripts/v20-sheet.js`, `web/public/index.html`, `web/public/styles.css`), `node:test` (`web/tests/all.test.js`). Контент дисциплин — Markdown по формату `system/library/disciplines/README.md`, источник — https://wod.su/vampire/disciplines.

---

## File Structure

**Изменяемые файлы:**
- `web/lib/disciplines.js` — парсер: извлечь новое поле `group` (default `'base'`).
- `web/routes/library.js` — новый лоадер+эндпоинт `GET /api/library/combo-disciplines`.
- `web/public/index.html` — панель `#tab-lib-disciplines`: добавить `.disciplines-subtab-bar` (8 кнопок) + контейнеры тел.
- `web/public/styles.css` — стили `.disciplines-subtab-bar` / `.disciplines-subtab-btn` (по образцу `.merits-subtab-bar`, но с переносом/скроллом под 8 кнопок).
- `web/public/scripts/v20-sheet.js` — рендер-функции подвкладок (`_libSorceryPathsHtml`, `_libComboCardsHtml`), path-detail и combo-detail в общей модалке, кэш `ensureCombos()`.
- `web/public/scripts/scripts.js` — делегат кликов подвкладок + первичная загрузка при открытии панели.
- `web/tests/all.test.js` — source-guard + парсер + эндпоинт тесты.

**Создаваемые файлы (контент):**
- `system/library/disciplines/koldun.md` — Колдовство (6 Путей).
- `system/library/disciplines/dark-thaumaturgy.md` — Тёмная Тауматургия (12 Путей).
- `system/library/disciplines/assamite-sorcery.md` — Чародейство Ассамитов (3 Пути).
- `system/library/disciplines/setite-sorcery.md` — Чародейство Сеттитов (6 Путей).
- `system/library/combo_disciplines.json` — комбинированные дисциплины.

**Порядок фаз:** A (данные/парсер) → B (контент) → C (фронт/UI). Фаза C зависит от A (поле `group`) и от наличия хотя бы каркасов файлов из B (иначе колдовские вкладки пусты — это допустимо, но source-guard тесты C проверяют присутствие групп). Рекомендуется A → B → C.

---

## Phase A — Данные и парсер

### Task A1: Поле `group` в парсере дисциплин

**Files:**
- Modify: `web/lib/disciplines.js:41-91` (функция `parseDisciplineMd`)
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Написать падающий тест**

Добавить в `web/tests/all.test.js` (рядом с другими юнит-тестами, вне `describe('API — integration')`, в начало файла в новый или существующий `describe`-блок для `parseDisciplineMd`):

```js
const { parseDisciplineMd } = require('../lib/disciplines');
const { test } = require('node:test');
const assert = require('node:assert');

test('parseDisciplineMd: поле Группа читается из шапки', () => {
  const md = [
    '# 🔥 Тест (Test)',
    '- **Клан / принадлежность:** Тремер',
    '- **Группа:** thaumaturgy',
    '- **Источник:** https://wod.su/x',
    '',
    '## Уровень 1 — Икс (X)',
    '**Литературное описание.** Флавор.',
    '**Система.** Механика.',
  ].join('\n');
  const d = parseDisciplineMd(md, 'test');
  assert.strictEqual(d.group, 'thaumaturgy');
});

test('parseDisciplineMd: без поля Группа — default base', () => {
  const md = '# 🔮 Прорицание (Auspex)\n- **Клан:** общая\n\n## Уровень 1 — Y (Y)\n**Система.** Z.';
  const d = parseDisciplineMd(md, 'auspex');
  assert.strictEqual(d.group, 'base');
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `node --test web/tests/all.test.js`
Expected: FAIL — `d.group` === `undefined`, не `'thaumaturgy'`/`'base'`.

- [ ] **Step 3: Реализовать**

В `web/lib/disciplines.js`, в объекте инициализации `d` (строка ~43) добавить `group: 'base'`:

```js
const d = { slug, name: slug, clans: '', source: '', note: '', group: 'base', levels: [], paths: [], custom: false };
```

И после строки `d.clans = field(...)` (строка ~47) добавить:

```js
  d.group = (field(content, 'Группа') || 'base').trim().toLowerCase();
```

- [ ] **Step 4: Прогнать — убедиться, что проходит**

Run: `node --test web/tests/all.test.js`
Expected: PASS (оба новых теста зелёные, старые не сломаны).

- [ ] **Step 5: Коммит**

```bash
git add web/lib/disciplines.js web/tests/all.test.js
git commit -m "feat(library): парсер дисциплин извлекает поле Группа (default base)"
```

---

### Task A2: Тег `Группа` в существующих path-based файлах

**Files:**
- Modify: `system/library/disciplines/necromancy.md:1-6` (шапка)
- Modify: `system/library/disciplines/thaumaturgy.md:1-6` (шапка)

- [ ] **Step 1: Добавить поле в necromancy.md**

После строки `- **Клан / принадлежность:** Джованни, Каппадокийцы` вставить:

```markdown
- **Группа:** necromancy
```

- [ ] **Step 2: Добавить поле в thaumaturgy.md**

После строки `- **Клан / принадлежность:** Тремер` вставить:

```markdown
- **Группа:** thaumaturgy
```

- [ ] **Step 3: Проверить парс round-trip**

Run:
```bash
node -e "const {parseDisciplineMd}=require('./web/lib/disciplines');const fs=require('fs');for(const s of ['necromancy','thaumaturgy']){const d=parseDisciplineMd(fs.readFileSync('system/library/disciplines/'+s+'.md','utf8'),s);console.log(s,d.group,'paths:',d.paths.length)}"
```
Expected: `necromancy necromancy paths:6` и `thaumaturgy thaumaturgy paths:23` (число Путей — сколько по факту в файле; главное — `group` совпал и Пути не потерялись).

- [ ] **Step 4: Коммит**

```bash
git add system/library/disciplines/necromancy.md system/library/disciplines/thaumaturgy.md
git commit -m "content(library): тег Группа у Некромантии и Тауматургии"
```

---

### Task A3: Датасет и эндпоинт комбо-дисциплин

**Files:**
- Create: `system/library/combo_disciplines.json`
- Modify: `web/routes/library.js` (после блока psychics, ~строка 95)
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Создать файл-заглушку датасета**

Создать `system/library/combo_disciplines.json` с одной реальной записью (полный контент — Task B5; здесь нужен валидный непустой массив, чтобы тест эндпоинта был осмысленным):

```json
[
  {
    "slug": "flesh-of-marble-touch",
    "name": "Пример комбо (Example Combo)",
    "prereq": "Стойкость 3, Могущество 2",
    "clans": "—",
    "literary": "Заглушка — заменяется полным контентом в Task B5.",
    "system": "Заглушка — механика."
  }
]
```

- [ ] **Step 2: Написать падающий тест эндпоинта**

В `web/tests/all.test.js`, внутри `describe('API — integration')` (рядом с другими GET-тестами библиотеки), добавить:

```js
test('GET /api/library/combo-disciplines отдаёт массив с полями slug/name/prereq', async () => {
  const res = await fetch(base + '/api/library/combo-disciplines');
  assert.strictEqual(res.status, 200);
  const list = await res.json();
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 1);
  assert.ok('slug' in list[0] && 'name' in list[0] && 'prereq' in list[0]);
});
```

(`base` — уже определённая в этом describe переменная адреса тестового сервера; свериться с существующими тестами в файле.)

- [ ] **Step 3: Прогнать — убедиться, что падает**

Run: `node --test web/tests/all.test.js`
Expected: FAIL — 404 (эндпоинта нет).

- [ ] **Step 4: Реализовать лоадер+эндпоинт**

В `web/routes/library.js` после эндпоинта psychics (после строки ~95 `});`) добавить:

```js
// ── Библиотека: комбинированные дисциплины (system/library/combo_disciplines.json) ──
// Город-нейтральные данные. У комбо нет шкалы 1–5 — только предпосылки (prereq)
// и описание, поэтому это отдельный JSON, а не .md-дисциплина (иначе комбо
// засоряли бы список «все дисциплины» и требовали фиктивных уровней-точек).
const COMBO_FILE = path.join(ROOT, 'system', 'library', 'combo_disciplines.json');
let _comboCache = null; // { mtimeMs, list }
async function loadCombos() {
  const st = await fs.stat(COMBO_FILE).catch(() => null);
  if (!st) return [];
  if (_comboCache && _comboCache.mtimeMs === st.mtimeMs) return _comboCache.list;
  const raw = await fs.readFile(COMBO_FILE, 'utf-8').catch(() => '[]');
  let list;
  try { list = JSON.parse(raw); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  _comboCache = { mtimeMs: st.mtimeMs, list };
  return list;
}
router.get('/api/library/combo-disciplines', async (_req, res) => {
  try { res.json(await loadCombos()); }
  catch (e) { serverError(res, e); }
});
```

(Свериться, что `ROOT`, `path`, `fs`, `serverError` уже импортированы в этом файле — да, используются в лоадере дисциплин выше.)

- [ ] **Step 5: Прогнать — убедиться, что проходит**

Run: `node --test web/tests/all.test.js`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add system/library/combo_disciplines.json web/routes/library.js web/tests/all.test.js
git commit -m "feat(library): эндпоинт GET /api/library/combo-disciplines"
```

---

## Phase B — Контент дисциплин

> Каждый файл создаётся строго по формату `system/library/disciplines/README.md` (эталон качества — `animalism.md`, `auspex.md`: `**Литературное описание.**` = 3–5 живых предложений, `**Система.**` = точный пул «Атрибут + Способность», сложность, эффект по успехам). Источник — соответствующая страница https://wod.su/vampire/disciplines/<slug>. Терминология Атрибутов/Способностей — как в уже выверенных файлах (Wits = Сообразительность, Occult = Эзотерика, Leadership = Лидерство и т.д.). Path-based формат: `## <Имя Пути>` → вложенные `### Уровень N — <Сила> (English)`.

### Task B1: `koldun.md` — Колдовство (Koldunic Sorcery)

**Files:**
- Create: `system/library/disciplines/koldun.md`

- [ ] **Step 1: Создать шапку файла**

```markdown
# 🌪️ Колдовство (Koldunic Sorcery)

- **Клан / принадлежность:** Тзимиски (Кольдуны)
- **Группа:** koldun
- **Источник:** https://wod.su/vampire/disciplines/koldunicsorcery

> Кровавое чародейство старейшин-Тзимиски, черпающее силу из земли и стихий Восточной Европы. Без общей шкалы 1–5 — реализуется через Пути (Стихии), каждый со своей иерархией 1–5; кольдун изучает их по отдельности.

---
```

- [ ] **Step 2: Наполнить 6 Путей**

Через WebFetch со страницы источника извлечь силы уровней 1–5 для каждого Пути и оформить как `## <Путь>` + вложенные `### Уровень N — <Сила> (English)` с `**Литературное описание.**` и `**Система.**`. Пути (ровно эти 6, в этом порядке):

```
## Путь Ветра (Way of the Wind)
## Путь Воды (Way of Water)
## Путь Духа (Way of the Spirit)
## Путь Земли (Way of the Earth)
## Путь Огня (Way of Fire)
## Путь Скорби (Way of Sorrow)
```

- [ ] **Step 3: Проверить парс**

Run:
```bash
node -e "const {parseDisciplineMd}=require('./web/lib/disciplines');const fs=require('fs');const d=parseDisciplineMd(fs.readFileSync('system/library/disciplines/koldun.md','utf8'),'koldun');console.log('group',d.group,'noLevels',d.noLevels,'paths',d.paths.map(p=>p.name+':'+p.levels.length))"
```
Expected: `group koldun`, `noLevels true`, и 6 Путей, у каждого `levels` ≥ 1.

- [ ] **Step 4: Коммит**

```bash
git add system/library/disciplines/koldun.md
git commit -m "content(library): дисциплина Колдовство (6 Путей)"
```

---

### Task B2: `dark-thaumaturgy.md` — Тёмная Тауматургия

**Files:**
- Create: `system/library/disciplines/dark-thaumaturgy.md`

- [ ] **Step 1: Создать шапку**

```markdown
# 😈 Тёмная Тауматургия (Dark Thaumaturgy)

- **Клан / принадлежность:** инфернальные заклинатели (демонопоклонники)
- **Группа:** dark-thaumaturgy
- **Источник:** https://wod.su/vampire/disciplines/darkthaumaturgy

> Инфернальная изнанка Тауматургии: силы, дарованные демонами в обмен на душу. Без общей шкалы 1–5 — через Пути, каждый со своей иерархией 1–5.

---
```

- [ ] **Step 2: Наполнить 12 Путей** (по источнику, формат как в Task B1):

```
## Длани Разрушения (Hands of Destruction)
## Лишение Духа (The Taking of the Spirit)
## Огни Преисподней (The Fires of the Inferno)
## Оковы Наслаждения (Chains of Pleasure)
## Путь Боли (Path of Pain)
## Путь Наслаждений (Path of Pleasure)
## Путь Несказанного (Path of the Unspoken)
## Путь Мучений (Path of Torture)
## Путь Осквернителя (Path of the Defiler)
## Путь Тайного Знания (Path of Secret Knowledge)
## Путь Фобоса (The Path of Phobos)
## Путь Эпидемий (Path of Pestilence)
```

- [ ] **Step 3: Проверить парс** (аналог B1 Step 3, slug `dark-thaumaturgy`) — Expected: `group dark-thaumaturgy`, `noLevels true`, 12 Путей.

- [ ] **Step 4: Коммит**

```bash
git add system/library/disciplines/dark-thaumaturgy.md
git commit -m "content(library): дисциплина Тёмная Тауматургия (12 Путей)"
```

---

### Task B3: `assamite-sorcery.md` — Чародейство Ассамитов

**Files:**
- Create: `system/library/disciplines/assamite-sorcery.md`

- [ ] **Step 1: Шапка**

```markdown
# 🗡️ Чародейство Ассамитов (Assamite Sorcery)

- **Клан / принадлежность:** Ассамиты (визири)
- **Группа:** assamite
- **Источник:** https://wod.su/vampire/disciplines/assamitesorcery

> Кровавая магия визирей клана Ассамитов, сплав ближневосточной алхимии и звёздной ворожбы. Без общей шкалы 1–5 — через Пути.

---
```

- [ ] **Step 2: Наполнить 3 Пути:**

```
## Охотничьи Ветра (The Hunter's Winds)
## Пробуждение Стали (Awakening of the Steel)
## Шепоты Небес (Whispers of the Heavens)
```

- [ ] **Step 3: Проверить парс** (slug `assamite-sorcery`) — Expected: `group assamite`, `noLevels true`, 3 Пути.

- [ ] **Step 4: Коммит**

```bash
git add system/library/disciplines/assamite-sorcery.md
git commit -m "content(library): дисциплина Чародейство Ассамитов (3 Пути)"
```

---

### Task B4: `setite-sorcery.md` — Чародейство Сеттитов

**Files:**
- Create: `system/library/disciplines/setite-sorcery.md`

- [ ] **Step 1: Шапка**

```markdown
# 🐍 Чародейство Сеттитов (Setite Sorcery)

- **Клан / принадлежность:** Последователи Сета
- **Группа:** setite
- **Источник:** https://wod.su/vampire/disciplines/setitesorcery

> Тёмное жречество Последователей Сета: магия змея, ночи и загробного Дуата. Без общей шкалы 1–5 — через Пути.

---
```

- [ ] **Step 2: Наполнить 6 Путей** (русские имена по списку заказчика; английские — сверить/подставить по источнику):

```
## Длань Божья (Hand of Set)
## Единство с Сетом (Unity with Set)
## Змей-искуситель (The Tempting Serpent)
## Путь Высохшего Нила (Way of the Dry Nile)
## Путь Дуата (Way of the Duat)
## Ушебти (Ushabti)
```

- [ ] **Step 3: Проверить парс** (slug `setite-sorcery`) — Expected: `group setite`, `noLevels true`, 6 Путей.

- [ ] **Step 4: Коммит**

```bash
git add system/library/disciplines/setite-sorcery.md
git commit -m "content(library): дисциплина Чародейство Сеттитов (6 Путей)"
```

---

### Task B5: Контент комбо-дисциплин

**Files:**
- Modify: `system/library/combo_disciplines.json` (заменить заглушку из A3)

- [ ] **Step 1: Извлечь канон**

Через WebFetch раздела «Комбинированные дисциплины» на https://wod.su/vampire/disciplines извлечь список комбинированных дисциплин: имя (рус + англ), предпосылки (какие дисциплины и на каком уровне требуются), описание и механику.

- [ ] **Step 2: Заполнить JSON**

Заменить содержимое `system/library/combo_disciplines.json` массивом объектов вида:

```json
[
  {
    "slug": "eyes-of-the-serpent",
    "name": "Глаза Змея (Eyes of the Serpent)",
    "prereq": "Змеиность 1, Присутствие 1",
    "clans": "Последователи Сета",
    "literary": "…3–5 предложений живого описания…",
    "system": "…точная механика: пул, сложность, эффект…"
  }
]
```

Каждая запись: `slug` (ASCII-кебаб, уникальный), `name` (рус + англ в скобках), `prereq` (человекочитаемо, через запятую), `clans`, `literary`, `system`. Стиль текста — как у `**Литературное описание.**`/`**Система.**` в дисциплинах.

- [ ] **Step 3: Проверить валидность и эндпоинт**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('system/library/combo_disciplines.json','utf8')).forEach(c=>{if(!c.slug||!c.name||!c.prereq)throw new Error('bad '+JSON.stringify(c))});console.log('OK')"
```
Expected: `OK`.

Затем `node --test web/tests/all.test.js` — Expected: PASS (тест из A3 всё ещё зелёный).

- [ ] **Step 4: Коммит**

```bash
git add system/library/combo_disciplines.json
git commit -m "content(library): наполнение комбо-дисциплин каноном"
```

---

## Phase C — Фронтенд / UI

> **Обязательный процесс фронта (CLAUDE.md):** ПЕРЕД правками `styles.css`/`scripts.js`/`index.html` — прогнать `/code-review`; ПОСЛЕ — impeccable-проверку дизайн-системы (токены, контраст, доступность). Новые `font-size` — только через `var(--fs-*)`; новые цвета — только через переменные `:root`; touch-цели ≥44px на `pointer: coarse`. Визуальная проверка — скилл `run-sanguine-web`.

### Task C1: Разметка подвкладок в панели «Дисциплины»

**Files:**
- Modify: `web/public/index.html:731-736` (панель `#tab-lib-disciplines`)

- [ ] **Step 1: Заменить содержимое панели**

Заменить блок:

```html
      <div class="tab-panel active" id="tab-lib-disciplines">
        <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="disciplines">+ Добавить дисциплину</button></div>
        <div class="lib-panel" id="lib-disciplines-body">
          <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
        </div>
      </div>
```

на:

```html
      <div class="tab-panel active" id="tab-lib-disciplines">
        <div class="disciplines-subtab-bar" role="tablist">
          <button class="disciplines-subtab-btn active" data-disc-group="all" role="tab" aria-selected="true">Дисциплины</button>
          <button class="disciplines-subtab-btn" data-disc-group="combo" role="tab" aria-selected="false">Комбо Дисциплины</button>
          <button class="disciplines-subtab-btn" data-disc-group="koldun" role="tab" aria-selected="false">Колдовство</button>
          <button class="disciplines-subtab-btn" data-disc-group="necromancy" role="tab" aria-selected="false">Некромантия</button>
          <button class="disciplines-subtab-btn" data-disc-group="thaumaturgy" role="tab" aria-selected="false">Тауматургия</button>
          <button class="disciplines-subtab-btn" data-disc-group="dark-thaumaturgy" role="tab" aria-selected="false">Тёмная Тауматургия</button>
          <button class="disciplines-subtab-btn" data-disc-group="assamite" role="tab" aria-selected="false">Чародейство Ассамитов</button>
          <button class="disciplines-subtab-btn" data-disc-group="setite" role="tab" aria-selected="false">Чародейство Сеттитов</button>
        </div>
        <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="disciplines">+ Добавить дисциплину</button></div>
        <div class="lib-panel" id="lib-disciplines-body">
          <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
        </div>
      </div>
```

- [ ] **Step 2: Визуально проверить** — открыть страницу «Библиотека» (скилл `run-sanguine-web`), убедиться, что панель бар из 8 кнопок отрисован. Полноценная фильтрация — после C3.

- [ ] **Step 3: Коммит**

```bash
git add web/public/index.html
git commit -m "feat(ui): 8 подвкладок в панели Дисциплины библиотеки"
```

---

### Task C2: Стили подвкладок

**Files:**
- Modify: `web/public/styles.css` (рядом с `.merits-subtab-bar`, ~строка 12030)

- [ ] **Step 1: Добавить правила**

После блока `.merits-subtab-btn.active { … }` (строка ~12072) добавить:

```css
/* Подвкладки библиотеки «Дисциплины» — 8 кнопок: горизонтальный скролл на
   узких экранах, перенос на широких. В отличие от merits-бара (flex:1 на 4
   колонки) — здесь кнопки по контенту, чтобы 8 длинных подписей не сжимались. */
.disciplines-subtab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  background: color-mix(in srgb, var(--accent) 10%, var(--bg3));
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
  overflow-x: auto;
}
.disciplines-subtab-btn {
  flex: 0 1 auto;
  min-height: 44px;
  padding: 12px 14px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-family: var(--f-heading);
  font-size: var(--fs-2xs);
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--text3);
  cursor: pointer;
  transition: color .15s, background .15s;
  margin-bottom: -1px;
  white-space: nowrap;
}
.disciplines-subtab-btn:hover {
  color: var(--text2);
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}
.disciplines-subtab-btn.active {
  color: var(--crimson);
  border-bottom-color: var(--accent);
  background: linear-gradient(180deg,
      color-mix(in srgb, var(--accent) 2%, transparent) 0%,
      color-mix(in srgb, var(--accent) 35%, transparent) 100%);
}
```

- [ ] **Step 2: Проверить визуально** (`run-sanguine-web`) — активная подвкладка подсвечена малиновым с нижней границей-акцентом; на узком окне бар скроллится/переносится; высота кнопок ≥44px.

- [ ] **Step 3: Коммит**

```bash
git add web/public/styles.css
git commit -m "style(ui): стили подвкладок Дисциплины (перенос/скролл под 8 кнопок)"
```

---

### Task C3: Рендер по группам + делегат кликов

**Files:**
- Modify: `web/public/scripts/v20-sheet.js` (рядом с `_libDisciplineCardsHtml`/`_libRenderDisciplineList`, ~строки 759-858)
- Modify: `web/public/scripts/scripts.js` (делегаты подвкладок, ~строки 751-788; и первичная загрузка, ~строка 744)

- [ ] **Step 1: Добавить кэш комбо и рендер-билдеры в v20-sheet.js**

После `ensureDisciplines()`/`_discBySlug` (строка ~709) добавить кэш комбо:

```js
let _combosCache = null;
async function ensureCombos() {
  if (_combosCache) return _combosCache;
  try {
    const data = await fetch('/api/library/combo-disciplines').then(r => r.json());
    _combosCache = Array.isArray(data) ? data : [];
  } catch { _combosCache = []; }
  return _combosCache;
}
function _comboBySlug(slug) { return (_combosCache || []).find(c => c.slug === slug) || null; }
```

После `_libDisciplineCardsHtml()` (строка ~774) добавить билдеры для колдовских Путей и комбо:

```js
// Колдовская вкладка (group != all/combo): карточки-Пути всех дисциплин этой
// группы. Клик по Пути открывает path-detail в общей модалке.
function _libSorceryPathsHtml(group) {
  const discs = (_disciplinesCache || []).filter(d => d.group === group);
  const cards = discs.flatMap(d => (d.paths || []).map(p =>
    `<div class="lib-card-wrap">
      <button type="button" class="lib-card" data-disc-path="${escAttr(d.slug)}" data-path-name="${escAttr(p.name)}">
        <div class="lib-card-name">${escHtml(p.name)}</div>
        <div class="lib-card-meta">${escHtml(d.name)}${(p.levels||[]).length ? ' · ' + p.levels.length + ' ур.' : ''}</div>
      </button>
    </div>`).join(''));
  if (!cards.length) return '<div class="v20-disc-empty">Пути этой дисциплины пока не заполнены.</div>';
  return `<div class="lib-cards">${cards}</div>`;
}

// Вкладка «Комбо Дисциплины»: карточки комбо (имя + предпосылки). Клик → detail.
function _libComboCardsHtml() {
  const list = _combosCache || [];
  if (!list.length) return '<div class="v20-disc-empty">Комбо-дисциплины пока не заполнены.</div>';
  return `<div class="lib-cards">${list.map(c =>
    `<div class="lib-card-wrap">
      <button type="button" class="lib-card" data-combo-slug="${escAttr(c.slug)}">
        <div class="lib-card-name">${escHtml(c.name)}</div>
        <div class="lib-card-meta">${escHtml(c.prereq || '')}</div>
      </button>
    </div>`).join('')}</div>`;
}
```

- [ ] **Step 2: Заменить `loadLibrary` на группо-осведомлённую загрузку**

Заменить существующие `_libRenderDisciplineList` / `loadLibrary` (строки ~845-854) на:

```js
let _libDiscGroup = 'all';
function _libRenderDisciplineGroup() {
  const body = document.getElementById('lib-disciplines-body');
  if (!body) return;
  const g = _libDiscGroup;
  if (g === 'all')        body.innerHTML = _libDisciplineCardsHtml();
  else if (g === 'combo') body.innerHTML = _libComboCardsHtml();
  else                    body.innerHTML = _libSorceryPathsHtml(g);
}
async function loadLibrary(group) {
  if (group) _libDiscGroup = group;
  const body = document.getElementById('lib-disciplines-body');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  await ensureDisciplines();
  if (_libDiscGroup === 'combo') await ensureCombos();
  _libRenderDisciplineGroup();
}
```

- [ ] **Step 3: Расширить делегат клика тела дисциплин**

Заменить обработчик `#lib-disciplines-body` click (строки ~855-858) на распознавание path/combo/disc:

```js
document.getElementById('lib-disciplines-body')?.addEventListener('click', e => {
  const path = e.target.closest('[data-disc-path]');
  if (path) { _v20OpenDisciplinePathModal(path.dataset.discPath, path.dataset.pathName); return; }
  const combo = e.target.closest('[data-combo-slug]');
  if (combo) { _v20OpenComboModal(combo.dataset.comboSlug); return; }
  const card = e.target.closest('[data-disc-slug]');
  if (card) _v20OpenDisciplineModal(null, card.dataset.discSlug);
});
```

- [ ] **Step 4: Добавить делегат подвкладок в scripts.js**

В `scripts.js` рядом с делегатами merits/flaws/backgrounds (после блока backgrounds, строка ~788) добавить:

```js
  // Disciplines subtabs (all/combo/koldun/necromancy/thaumaturgy/dark-thaumaturgy/assamite/setite)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.disciplines-subtab-btn');
    if (!btn) return;
    const group = btn.dataset.discGroup;
    if (!group) return;
    const bar = btn.closest('.disciplines-subtab-bar');
    bar.querySelectorAll('.disciplines-subtab-btn').forEach(b => {
      b.classList.remove('active'); b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
    loadLibrary(group);
  });
```

- [ ] **Step 5: Сбрасывать группу на «all» при открытии панели**

Найти в `scripts.js` строку `if (tab === 'lib-disciplines') loadLibrary();` (строка ~744) и заменить на:

```js
    if (tab === 'lib-disciplines') loadLibrary('all');
```

(На иных вкладках список остаётся синхронным с активной подвкладкой; сброс на «all» при повторном входе — предсказуемое поведение, как у merits, что всегда открывает `physical`.)

- [ ] **Step 6: Проверить (без модалок)** — `run-sanguine-web`: переключение подвкладок меняет тело; «Дисциплины» показывает все карточки, «Тауматургия» — карточки-Пути, «Комбо» — комбо-карточки. Клики по Путям/комбо пока без модалки (Task C4).

- [ ] **Step 7: Коммит**

```bash
git add web/public/scripts/v20-sheet.js web/public/scripts/scripts.js
git commit -m "feat(ui): фильтрация Дисциплин по подвкладкам (все/комбо/колдовские Пути)"
```

---

### Task C4: Модалки Пути и комбо-дисциплины

**Files:**
- Modify: `web/public/scripts/v20-sheet.js` (рендереры модалки, рядом с `_v20RenderDisciplineDetail` ~строка 793 и делегатом `_v20EnsureLibModal` ~строка 819)

- [ ] **Step 1: Добавить рендереры и опенеры**

После `_v20RenderDisciplineDetail` (строка ~797) добавить:

```js
// Path-detail: одна колонка Пути (Некромантия/Тауматургия/колдовские) в общей модалке.
function _v20RenderDisciplinePathDetail(discSlug, pathName) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  const d = _discBySlug(discSlug);
  const p = d && (d.paths || []).find(x => x.name === pathName);
  if (!p) { body.innerHTML = '<div class="v20-disc-empty">Путь не найден.</div>'; return; }
  body.innerHTML = `<div class="v20-disc-detail-head"><h3>${escHtml(p.name)}</h3>` +
    `<span class="v20-disc-clans">${escHtml(d.name)}</span></div>` +
    `${p.note ? `<div class="v20-disc-note">${escHtml(p.note)}</div>` : ''}` +
    `${(p.levels || []).map(_libPowerHtml).join('')}`;
}
async function _v20OpenDisciplinePathModal(discSlug, pathName) {
  _v20EnsureLibModal().classList.add('open');
  await ensureDisciplines();
  _v20RenderDisciplinePathDetail(discSlug, pathName);
}

// Combo-detail: имя, предпосылки, описание, механика.
function _v20RenderComboDetail(slug) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  const c = _comboBySlug(slug);
  if (!c) { body.innerHTML = '<div class="v20-disc-empty">Комбо не найдено.</div>'; return; }
  body.innerHTML = `<div class="v20-disc-detail-head"><h3>${escHtml(c.name)}</h3>` +
    `<span class="v20-disc-clans">${escHtml(c.clans || '')}</span></div>` +
    `<div class="v20-disc-note">Требует: ${escHtml(c.prereq || '—')}</div>` +
    `${c.literary ? `<div class="lib-power-sec"><div class="lib-power-label">Литературное описание</div><p class="lib-power-text">${escHtml(c.literary)}</p></div>` : ''}` +
    `${c.system ? `<div class="lib-power-sec"><div class="lib-power-label">Система</div><p class="lib-power-text lib-power-sys">${escHtml(c.system)}</p></div>` : ''}`;
}
async function _v20OpenComboModal(slug) {
  _v20EnsureLibModal().classList.add('open');
  await ensureCombos();
  _v20RenderComboDetail(slug);
}
```

- [ ] **Step 2: Проверить в браузере** (`run-sanguine-web`): клик по карточке-Пути открывает модалку с уровнями этого Пути; клик по комбо — модалку с предпосылками+описанием; кнопка ✕ и клик по фону закрывают (уже работает в общей оболочке).

- [ ] **Step 3: Коммит**

```bash
git add web/public/scripts/v20-sheet.js
git commit -m "feat(ui): модалки детали Пути и комбо-дисциплины"
```

---

### Task C5: Source-guard тесты UI

**Files:**
- Modify: `web/tests/all.test.js`

- [ ] **Step 1: Написать тесты присутствия разметки/групп**

Добавить (в юнит-секцию, читающую файлы напрямую — как существующие source-guard тесты вкладок Принадлежности):

```js
const fsSrc = require('node:fs');
const htmlSrc = fsSrc.readFileSync(__dirname + '/../public/index.html', 'utf8');
const jsSrc = fsSrc.readFileSync(__dirname + '/../public/scripts/v20-sheet.js', 'utf8');

test('source-guard: 8 подвкладок Дисциплин присутствуют в HTML', () => {
  for (const g of ['all','combo','koldun','necromancy','thaumaturgy','dark-thaumaturgy','assamite','setite']) {
    assert.ok(htmlSrc.includes(`data-disc-group="${g}"`), 'нет подвкладки ' + g);
  }
});

test('source-guard: рендер группы Дисциплин ветвится на all/combo/иначе', () => {
  assert.ok(jsSrc.includes('_libSorceryPathsHtml'));
  assert.ok(jsSrc.includes('_libComboCardsHtml'));
  assert.ok(jsSrc.includes("_libDiscGroup === 'combo'"));
});
```

- [ ] **Step 2: Прогнать весь набор**

Run: `node --test web/tests/all.test.js`
Expected: PASS (все тесты, включая новые).

- [ ] **Step 3: Финальная проверка фронта**

Прогнать impeccable-проверку дизайн-системы по `styles.css`/`index.html`/`scripts.js` (CLAUDE.md, шаг «после правок»); при желании — скилл `web-design-guidelines`. Устранить замечания по токенам/контрасту/доступности, если появятся.

- [ ] **Step 4: Коммит**

```bash
git add web/tests/all.test.js
git commit -m "test(ui): source-guard на 8 подвкладок Дисциплин и ветвление рендера"
```

---

## Self-Review (проверка плана против спеки)

- **8 вкладок** (Дисциплины, Комбо, Колдовство, Некромантия, Тауматургия, Тёмная Тауматургия, Ассамиты, Сеттиты) → C1 (разметка), C3 (рендер/фильтр). ✓
- **«Дисциплины» = все, единой карточкой, incl. 6 колдовских «с общим описанием» для чарника** → `_libDisciplineCardsHtml` (все файлы, по карточке); доступность в чарнике — через общий `_disciplinesCache` (файлы B1–B4). ✓
- **Комбо = комбинированные дисциплины** → A3 (эндпоинт) + B5 (контент) + C3/C4 (рендер/модалка). ✓
- **Колдовство — 6 названных Путей; аналогично Некромантия(6)/Тауматургия(22+)/Тёмная(12)/Ассамиты(3)/Сеттиты(6)** → B1–B4 (контент новых), A2 (тег существующих), C3 `_libSorceryPathsHtml` (Пути карточками). ✓
- **Тауматургия/Некромантия уже существуют** → тег группы A2, контент не переписывается. ✓
- **Формат файлов совместим с парсером** → A1 (`group`), проверки round-trip в B1–B4.
- **Контракт фронта CLAUDE.md** (code-review до, impeccable после, токены/цвета/44px) → шапка Phase C + C5 Step 3.
- **Плейсхолдеры:** контентные Task B — процессные (fetch+формат+список Путей+проверка парса), а не «TODO»; прозу заполняет исполнитель по источнику, как это уже делалось для 16 существующих файлов.

**Открытый риск (не блокирует план):** объём контента B1–B5 — это авторская адаптация ~40–60 сил с wod.su; это самая тяжёлая часть и может выполняться поштучно (каждый Путь — отдельный заход WebFetch), UI (Phase C) от полноты контента не зависит (пустая группа показывает «Пути пока не заполнены»).

---

## Execution Handoff

План сохранён в `docs/superpowers/plans/2026-07-22-disciplines-subtabs.md`.
