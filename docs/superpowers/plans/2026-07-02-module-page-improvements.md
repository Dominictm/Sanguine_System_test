# Module Page Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полная реализация страницы модуля — редактирование всех полей, управление участниками/НПС/локациями, ведение сессий, редактирование сценария, соответствие карточек локаций схеме, замена `alert/confirm` на стилизованные UI-компоненты.

**Architecture:** Три слоя: (1) новые серверные эндпоинты (`PUT /fields`, `PUT /scenario`, `POST /npc`, `GET /delete-preview`) в `web/server.js`; (2) хелперы `_modToggleEdit` / `_modSavePanel` в `web/public/scripts.js` по образцу `_locToggleEdit` / `_locSavePanel` (строки 8710–8769); (3) UI-изменения внутри `renderModulePage` и `renderModuleNpcTab` — `editPanel`-паттерн для каждой вкладки.

**Tech Stack:** Node.js/Express, Vanilla JS (SPA без фреймворков), Markdown-файлы как хранилище, CSS-переменные дизайн-системы.

---

## Карта файлов

| Файл | Что меняется |
|---|---|
| `web/server.js` | +4 эндпоинта (PUT fields, PUT scenario, POST npc, GET delete-preview); исправление шаблона карточки локации в `/fill` |
| `web/public/scripts.js` | `_modToggleEdit`, `_modSavePanel`, `_modSaveParticipants`; изменения в `renderModulePage`, `renderModuleNpcTab`, обработчик кликов модуля; замена `alert` → inline-панель; замена `confirm` → styled modal |
| `web/public/index.html` | +`#modp-delete-modal` (styled confirm); +`#modp-gen-result` div внутри `.modp-gen-panel` |
| `web/public/styles.css` | +стили `.modp-edit-bar`, `.modp-edit-btn`, `.modp-del-modal-*`, `.modp-gen-result` (переиспользуют существующие CSS-переменные) |

---

## Task 1: Server — PUT /api/chronicles/:chr/modules/:mod/fields

Эндпоинт патчит `<mod>.md`, поддерживая ключи: `title`, `type`, `time`, `location`, `tone`, `format`, `description`, `pcs` (массив имён), `npcs` (массив имён). По образцу `PUT /api/locations/:slug/fields` (server.js ~строка 3185).

**Files:**
- Modify: `web/server.js` (после строки `app.delete('/api/chronicles/:chr/modules/:mod'` ~1907, вставить перед ней)

- [ ] **Step 1: Найди место вставки в server.js**

```bash
grep -n "DELETE.*chronicles.*modules.*mod'" web/server.js | head -3
```
Ожидаемый вывод: `1909:app.delete('/api/chronicles/:chr/modules/:mod',` (может незначительно отличаться после правок).

- [ ] **Step 2: Добавь эндпоинт PUT /fields перед DELETE-эндпоинтом модуля**

Вставь следующий код в `web/server.js` непосредственно перед строкой `// ── Delete module`:

```js
// ── Edit module fields ─────────────────────────────────────────────────────────

app.put('/api/chronicles/:chr/modules/:mod/fields', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod } = req.params;
    const fields = req.body?.fields || {};

    const modPath = path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`);
    let raw = await fs.readFile(modPath, 'utf-8').catch(() => null);
    if (!raw) return res.status(404).json({ error: 'Файл модуля не найден' });

    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined || val === null) continue;

      if (key === 'title') {
        const v = String(val).trim();
        if (v) raw = raw.replace(/^#\s+.+$/m, `# ${v}`);

      } else if (['type', 'time', 'location', 'tone', 'format'].includes(key)) {
        const labels = { type: 'Тип', time: 'Время', location: 'Локация', tone: 'Тон', format: 'Формат' };
        const label  = labels[key];
        const v = String(val).trim();
        const cellRe = new RegExp(`(\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*)([^|\\n]*)(\\|)`);
        if (cellRe.test(raw)) {
          raw = raw.replace(cellRe, `$1${v} $3`);
        }

      } else if (key === 'description') {
        const v = String(val).trim();
        // Replace section between «## 💡 Концепция» header and next ## or ---
        if (/## 💡 Концепция/.test(raw)) {
          raw = raw.replace(
            /(## 💡 Концепция\s*\n)([\s\S]*?)(?=\n## |\n---|$)/,
            `$1\n${v}\n\n`
          );
        }

      } else if (key === 'pcs') {
        const arr = Array.isArray(val) ? val : JSON.parse(String(val) || '[]');
        const block = arr.length
          ? arr.map(n => `  - ${n} — Персонаж игрока`).join('\n')
          : '  - ⚠️ Уточнить';
        raw = raw.replace(
          /(\*\*Персонажи игроков:\*\*\s*\n)((?:[ \t]*- [^\n]+\n?)*)/,
          `$1${block}\n`
        );

      } else if (key === 'npcs') {
        const arr = Array.isArray(val) ? val : JSON.parse(String(val) || '[]');
        const block = arr.length
          ? arr.map(n => `  - ${n} — НПС`).join('\n')
          : '  - ⚠️ Уточнить';
        raw = raw.replace(
          /(\*\*НПС:\*\*\s*\n)((?:[ \t]*- [^\n]+\n?)*)/,
          `$1${block}\n`
        );
      }
    }

    await writeFileAtomic(modPath, raw, 'utf-8');
    delete _cache[city];
    console.log(`[mod-fields] ${city}/${chr}/${mod} →`, Object.keys(fields).join(', '));
    res.json({ ok: true });
  } catch (e) {
    console.error('[mod-fields]', e.message);
    serverError(res, e);
  }
});
```

- [ ] **Step 3: Проверь эндпоинт через curl**

```bash
curl -s -X PUT "http://localhost:3000/api/chronicles/leto_2001/modules/novye_sobytiya/fields?city=balmont" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"time":"Лето 2001, июль"}}'
```
Ожидаемый вывод: `{"ok":true}`. Затем проверь, что в файле `cities/balmont/chronicles/leto_2001/modules/novye_sobytiya/novye_sobytiya.md` строка `| **Время** |` изменилась.

- [ ] **Step 4: Commit**

```bash
git add web/server.js
git commit -m "feat: PUT /api/chronicles/:chr/modules/:mod/fields — редактирование полей модуля"
```

---

## Task 2: Server — PUT /api/chronicles/:chr/modules/:mod/scenario

Заменяет содержимое `scenario.md` целиком (не патчит, а перезаписывает — аналог `PUT /api/threads`).

**Files:**
- Modify: `web/server.js` (после `PUT /fields` из Task 1)

- [ ] **Step 1: Добавь эндпоинт сразу после PUT /fields**

```js
// ── Replace scenario.md ────────────────────────────────────────────────────────

app.put('/api/chronicles/:chr/modules/:mod/scenario', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod } = req.params;
    const content = (req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Пустой сценарий' });

    const modDir      = path.join(chroniclesDir(city), chr, 'modules', mod);
    const scenarioPath = path.join(modDir, 'scenario.md');

    if (!await fs.stat(modDir).catch(() => null))
      return res.status(404).json({ error: 'Модуль не найден' });

    await writeFileAtomic(scenarioPath, content.endsWith('\n') ? content : content + '\n', 'utf-8');
    delete _cache[city];
    console.log(`[mod-scenario] ${city}/${chr}/${mod} scenario.md rewritten`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[mod-scenario]', e.message);
    serverError(res, e);
  }
});
```

- [ ] **Step 2: Проверь через curl**

```bash
curl -s -X PUT "http://localhost:3000/api/chronicles/leto_2001/modules/novye_sobytiya/scenario?city=balmont" \
  -H "Content-Type: application/json" \
  -d '{"content":"# Сценарий: тест\n\nТестовое содержимое."}'
```
Ожидаемый вывод: `{"ok":true}`.

- [ ] **Step 3: Commit**

```bash
git add web/server.js
git commit -m "feat: PUT /api/chronicles/:chr/modules/:mod/scenario — сохранение сценария"
```

---

## Task 3: Server — POST /api/chronicles/:chr/modules/:mod/npc

Добавляет одного НПС в `npc.md`. Для модульных НПС создаёт минимальную карточку в `npc/<slug>/<slug>.md`. Группы: `pc`, `canon`, `modular`.

**Files:**
- Modify: `web/server.js` (после PUT /scenario из Task 2)

- [ ] **Step 1: Добавь эндпоинт POST /npc**

```js
// ── Add single NPC to module ───────────────────────────────────────────────────

app.post('/api/chronicles/:chr/modules/:mod/npc', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod } = req.params;
    const { name, group = 'modular' } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Укажи имя' });

    const nm     = name.trim();
    const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
    if (!await fs.stat(modDir).catch(() => null))
      return res.status(404).json({ error: 'Модуль не найден' });

    // Read module title for context
    const mainTxt  = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
    const titleM   = mainTxt.match(/^#\s+(.+)$/m);
    const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;

    const allChars = await getAllCharacters(city);

    let cardHref = '';
    let createdCard = false;

    if (group === 'modular') {
      const npcSlug = slugify(nm);
      if (!npcSlug) return res.status(400).json({ error: 'Не удалось сформировать slug из имени' });
      const npcDir  = path.join(modDir, 'npc', npcSlug);
      const npcFile = path.join(npcDir, `${npcSlug}.md`);
      if (!await fs.stat(npcFile).catch(() => null)) {
        await fs.mkdir(npcDir, { recursive: true });
        const stub = [
          `# 🎭 ${nm}`,
          ``,
          `> 🔗 [Модуль](../../${mod}.md)`,
          ``,
          `- **Слаг:** ${npcSlug}`,
          `- **Родной город:** ${city}`,
          `- **Линейка WoD:** mortals`,
          `- **Статус:** 🔵 Активен`,
          `- **Принадлежность:** Эпизодический персонаж`,
          ``,
          `## 🖼️ Изображения`,
          `- ⏳ Изображение не предоставлено`,
        ].join('\n');
        await writeFileAtomic(npcFile, stub + '\n', 'utf-8');
        createdCard = true;
      }
      cardHref = `npc/${npcSlug}/${npcSlug}.md`;

    } else if (group === 'canon') {
      const ch = allChars.find(c => _nameMatch(nm, c.name));
      if (ch) cardHref = `../../../../characters/${ch.lineageFolder}/${ch.slug}/${ch.slug}.md`;

    } else if (group === 'pc') {
      const ch = allChars.find(c => _nameMatch(nm, c.name));
      if (ch) cardHref = `../../../../characters/${ch.lineageFolder}/${ch.slug}/${ch.slug}.md`;
    }

    // Read current npc.md
    const npcMdPath = path.join(modDir, 'npc.md');
    let npcRaw = await fs.readFile(npcMdPath, 'utf-8').catch(() => '');

    // If npc.md doesn't exist, create a skeleton
    if (!npcRaw) {
      npcRaw = [
        `# НПС модуля: ${modTitle}`,
        ``,
        `## 🎭 Игровые персонажи (ПК)`,
        ``,
        `## 📚 Каноничные НПС`,
        ``,
        `## 🆕 Модульные НПС`,
        ``,
      ].join('\n');
    }

    // Build new line
    const line = cardHref
      ? `- ${nm} — ${group === 'pc' ? 'Персонаж игрока' : 'НПС'} → 🔗 [Карточка](${cardHref})`
      : `- ${nm} — ${group === 'pc' ? 'Персонаж игрока' : 'НПС'}`;

    // Insert line under the appropriate section heading
    const headings = {
      pc:      /^## 🎭 Игровые персонажи/m,
      canon:   /^## 📚 Каноничные НПС/m,
      modular: /^## 🆕 Модульные НПС/m,
    };
    const re = headings[group];
    if (re && re.test(npcRaw)) {
      // Find position after heading line
      npcRaw = npcRaw.replace(re, (heading) => `${heading}\n${line}`);
    } else {
      npcRaw += `\n${line}\n`;
    }

    await writeFileAtomic(npcMdPath, npcRaw, 'utf-8');
    delete _cache[city];
    console.log(`[mod-npc-add] ${city}/${chr}/${mod} → ${nm} (${group})`);
    res.json({ ok: true, name: nm, group, createdCard, cardHref });
  } catch (e) {
    console.error('[mod-npc-add]', e.message);
    serverError(res, e);
  }
});
```

- [ ] **Step 2: Проверь через curl (добавить модульного НПС)**

```bash
curl -s -X POST "http://localhost:3000/api/chronicles/leto_2001/modules/novye_sobytiya/npc?city=balmont" \
  -H "Content-Type: application/json" \
  -d '{"name":"Тест Персонаж","group":"modular"}'
```
Ожидаемый вывод: `{"ok":true,"createdCard":true,...}`. Проверь, что появилась папка `npc/test-personazh/` и строка в `npc.md`.

- [ ] **Step 3: Commit**

```bash
git add web/server.js
git commit -m "feat: POST /api/chronicles/:chr/modules/:mod/npc — добавление НПС в модуль"
```

---

## Task 4: Server — GET /delete-preview + исправление шаблона карточки локации

Две независимые серверные правки: (А) превью перед удалением модуля, (Б) приведение шаблона карточки локации в `/fill` к схеме карточки (`card_schema.md` — обязательные поля `Слаг`, `Родной город`, `Принадлежность`, H1 с эмодзи).

**Files:**
- Modify: `web/server.js`

- [ ] **Step 1: Добавь GET /delete-preview перед DELETE-эндпоинтом модуля**

```js
// ── Delete-preview for module ─────────────────────────────────────────────────

app.get('/api/chronicles/:chr/modules/:mod/delete-preview', async (req, res) => {
  try {
    const city = reqCity(req);
    const { chr, mod } = req.params;
    const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);

    if (!await fs.stat(modDir).catch(() => null))
      return res.status(404).json({ error: 'Модуль не найден' });

    // Count files
    const allEntries = await fs.readdir(modDir, { recursive: true }).catch(() => []);
    const fileCount  = allEntries.filter(e => e.endsWith('.md')).length;

    // Count modular NPCs
    let modularNpcs = [];
    try {
      const npcEntries = await fs.readdir(path.join(modDir, 'npc'), { withFileTypes: true });
      modularNpcs = npcEntries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {}

    // Count events in chronicle events.md referencing this module
    let eventCount = 0;
    const evTxt = await fs.readFile(
      path.join(chroniclesDir(city), chr, 'events.md'), 'utf-8').catch(() => '');
    if (evTxt) {
      const modRe = new RegExp(`modules/${mod}/`, 'g');
      eventCount = (evTxt.match(modRe) || []).length;
    }

    // Canonical chars with journal entries mentioning this module
    const chars = await getAllCharacters(city).catch(() => []);
    const affectedChars = [];
    const modLinkPat = new RegExp(`modules/${mod}/`);
    for (const ch of chars) {
      const jDir = path.join(charsDir(city), ch.lineageFolder, ch.slug, 'journal');
      const jFiles = await fs.readdir(jDir).catch(() => []);
      for (const f of jFiles) {
        if (!f.endsWith('.md')) continue;
        const txt = await fs.readFile(path.join(jDir, f), 'utf-8').catch(() => '');
        if (modLinkPat.test(txt)) { affectedChars.push(ch.name); break; }
      }
    }

    res.json({ ok: true, fileCount, modularNpcs, eventCount, affectedChars });
  } catch (e) {
    console.error('[mod-delete-preview]', e.message);
    serverError(res, e);
  }
});
```

- [ ] **Step 2: Исправь шаблон карточки локации в fill-endpoint**

Найди в `server.js` функцию `cardTemplate` (~строки 1645–1671) внутри `/fill` эндпоинта. Замени её определение:

```js
const cardTemplate = (name) => {
  const locSlug = slugify(name);
  return `# 📍 ${name}
- **Слаг:** ${locSlug}
- **Родной город:** ${city || 'Неизвестен'}
- **Принадлежность:** Локация модуля

> **Название:** ${name} | **Округ:** [округ] | **Район:** [район] | **Адрес:** [адрес] | **Зона:** [🟢/🟡/🔴] | **Контроль:** [фракция]
---
## 🎭 Атмосфера
[2–3 предложения атмосферного описания]
## 👁️ Сенсорная палитра
| Канал | |
|---|---|
| **Свет** | |
| **Звук** | |
| **Запах** | |
| **Тактильное** | |
---
## 🩸 Контекст Камарильи / Масок
| | |
|---|---|
| **Статус** | |
| **Фракция** | |
| **Постоянные фигуры** | |
| **Угрозы** | |
| **Маскарад** | 🔴/🟡/🟢 |
---
## 🔗 Связанные модули
- [${modTitle}](../../../../chronicles/${chr}/modules/${mod}/${mod}.md)
## 🖼️ Изображения
- ⏳ Изображение не предоставлено`;
};
```

- [ ] **Step 3: Проверь delete-preview через curl**

```bash
curl -s "http://localhost:3000/api/chronicles/leto_2001/modules/novye_sobytiya/delete-preview?city=balmont"
```
Ожидаемый вывод: JSON с `fileCount`, `modularNpcs`, `eventCount`, `affectedChars`.

- [ ] **Step 4: Commit**

```bash
git add web/server.js
git commit -m "feat: GET /delete-preview для модуля + исправление шаблона карточки локации по card_schema"
```

---

## Task 5: UI — Хелперы _modToggleEdit / _modSavePanel + CSS

Глобальные JS-функции (по образцу `_locToggleEdit` / `_locSavePanel` в строках 8710–8769) и минимальные CSS-классы для editPanel на странице модуля.

**Files:**
- Modify: `web/public/scripts.js` (добавить после `_locSavePanel`)
- Modify: `web/public/styles.css` (добавить в секцию `.modp-*`)

- [ ] **Step 1: Найди место вставки в scripts.js**

```bash
grep -n "_locSavePanel\|function _locToggle" web/public/scripts.js | tail -5
```
Запомни строку, следующую после конца `_locSavePanel` (~8770).

- [ ] **Step 2: Вставь хелперы _modToggleEdit и _modSavePanel после _locSavePanel**

```js
// ── Module page: editPanel helpers ────────────────────────────────────────────

function _modToggleEdit(panel, enter) {
  const viewEl = document.getElementById(`moddet-${panel}-view`);
  const editEl = document.getElementById(`moddet-${panel}-edit`);
  const barEl  = document.getElementById(`moddet-${panel}-bar`);
  const msgEl  = document.getElementById(`moddet-${panel}-msg`);
  if (!viewEl || !editEl) return;
  viewEl.style.display = enter ? 'none' : '';
  editEl.style.display = enter ? '' : 'none';
  if (barEl) barEl.style.display = enter ? 'flex' : 'none';
  if (msgEl) msgEl.style.display = 'none';
}

async function _modSavePanel(panel) {
  const d   = STATE.currentModuleData;
  const chr = d?.chronicle || STATE.currentModule?.chronicle;
  const mod = d?.name      || STATE.currentModule?.name;
  if (!chr || !mod) return;

  const msgEl  = document.getElementById(`moddet-${panel}-msg`);
  const fields = {};

  if (panel === 'title') {
    fields.title = document.getElementById('moddet-title-input')?.value || '';

  } else if (panel === 'meta') {
    for (const key of ['type', 'time', 'location', 'tone', 'format']) {
      const el = document.getElementById(`moddet-meta-${key}`);
      if (el) fields[key] = el.value;
    }

  } else if (panel === 'desc') {
    fields.description = document.getElementById('moddet-desc-ta')?.value || '';

  } else if (panel === 'participants') {
    const pcChips  = document.querySelectorAll('#moddet-pcs-chips .moddet-chip');
    const npcChips = document.querySelectorAll('#moddet-npcs-chips .moddet-chip');
    fields.pcs  = Array.from(pcChips).map(c => c.dataset.name).filter(Boolean);
    fields.npcs = Array.from(npcChips).map(c => c.dataset.name).filter(Boolean);

  } else if (panel === 'scenario') {
    const content = document.getElementById('moddet-scenario-ta')?.value || '';
    // Scenario uses its own endpoint
    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
      );
      if (!r.ok) throw new Error(await r.text());
      if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
      _modToggleEdit(panel, false);
      await _reloadModulePage();
    } catch { if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; } }
    return;
  }

  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fields${window.location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
    );
    if (!r.ok) throw new Error(await r.text());
    if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
    _modToggleEdit(panel, false);
    await _reloadModulePage();
  } catch { if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; } }
}

async function _reloadModulePage() {
  const chr = STATE.currentModule?.chronicle;
  const mod = STATE.currentModule?.name;
  if (!chr || !mod) return;
  const activeTab = document.querySelector('.modp-tab.active')?.dataset?.tab || 'info';
  const data = await fetch(
    `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${window.location.search}`
  ).then(r => r.json()).catch(() => null);
  if (data) {
    STATE.currentModuleData = data;
    renderModulePage(data, activeTab);
  }
}
```

- [ ] **Step 3: Добавь CSS в styles.css в секцию .modp-***

Найди в `styles.css` блок `.modp-*` (около строк 6413–8502). Добавь в конец секции:

```css
/* Module page — editPanel */
.modp-edit-btn {
  background: none;
  border: 1px solid var(--clr-border);
  color: var(--clr-accent);
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  cursor: pointer;
  margin-bottom: 6px;
}
.modp-edit-btn:hover { background: var(--clr-hover); }

.modp-edit-bar {
  display: none;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.modp-save-btn {
  background: var(--clr-accent);
  color: #fff;
  border: none;
  padding: 4px 14px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.modp-save-btn:hover { opacity: .85; }
.modp-cancel-btn {
  background: none;
  border: 1px solid var(--clr-border);
  color: var(--clr-muted);
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.modp-save-msg { font-size: var(--fs-sm); color: var(--clr-success); }

/* Participants chips */
.moddet-chips-wrap { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
.moddet-chip {
  display: flex; align-items: center; gap: 4px;
  background: var(--clr-tag-bg);
  color: var(--clr-tag-text);
  border-radius: 20px;
  padding: 2px 10px 2px 12px;
  font-size: var(--fs-sm);
}
.moddet-chip-rm {
  background: none; border: none; cursor: pointer;
  color: var(--clr-muted); font-size: 13px; line-height: 1;
  padding: 0 2px;
}
.moddet-chip-rm:hover { color: var(--clr-danger); }
.moddet-add-row { display: flex; gap: 6px; margin-top: 4px; }
.moddet-add-input {
  flex: 1; padding: 4px 10px; border: 1px solid var(--clr-border);
  border-radius: var(--radius-sm); background: var(--clr-input-bg);
  color: var(--clr-text); font-size: var(--fs-sm);
}
```

- [ ] **Step 4: Verify CSS variables exist**

```bash
grep -c "var(--clr-accent)\|var(--clr-border)\|var(--clr-hover)\|var(--clr-success)\|var(--clr-danger)\|var(--clr-tag-bg)\|var(--clr-input-bg)" web/public/styles.css
```
Ожидаемый вывод: число > 10. Если какая-то переменная не найдена — замени на существующую ближайшую по смыслу из `:root`.

- [ ] **Step 5: Commit**

```bash
git add web/public/scripts.js web/public/styles.css
git commit -m "feat: _modToggleEdit/_modSavePanel/_reloadModulePage хелперы + CSS для editPanel модуля"
```

---

## Task 6: UI — Info tab: editPanel для метаданных и описания

Добавляет кнопки «✏ Редактировать» и inline-редактирование для полей модуля на вкладке `info`: заголовок, таблица параметров (Тип/Время/Локация/Тон/Формат), секция Концепции.

**Files:**
- Modify: `web/public/scripts.js` (внутри `renderModulePage`, вкладка `info`)

Паттерн editPanel для модуля (вспомогательная функция для использования внутри `renderModulePage`):

```js
function modPanel(id, viewHtml, editHtml) {
  return `
    <div class="cdet-info-header">
      <button class="modp-edit-btn" data-editmod="${id}">✏ Редактировать</button>
    </div>
    <div id="moddet-${id}-view">${viewHtml}</div>
    <div id="moddet-${id}-edit" style="display:none">${editHtml}</div>
    <div class="modp-edit-bar" id="moddet-${id}-bar">
      <button class="modp-save-btn" data-savemod="${id}">Сохранить</button>
      <button class="modp-cancel-btn" data-cancelmod="${id}">Отмена</button>
      <span class="modp-save-msg" id="moddet-${id}-msg" style="display:none">✓ Сохранено</span>
    </div>`;
}
```

- [ ] **Step 1: Найди функцию renderModulePage в scripts.js**

```bash
grep -n "function renderModulePage\|renderModulePage =" web/public/scripts.js | head -5
```
Запомни строку (примерно 3395).

- [ ] **Step 2: Добавь функцию modPanel в начало renderModulePage**

Сразу после открывающей строки `function renderModulePage(data, activeTab = 'info') {` (или аналогичной) добавь объявление `function modPanel` (код выше). Это локальная функция, как `editPanel` в `openLocDetail`.

- [ ] **Step 3: Найди блок генерации HTML для вкладки info**

```bash
grep -n "'info'\|\"info\"\|panel.*info\|info.*panel" web/public/scripts.js | grep -i "modp\|module\|3[3-9][0-9][0-9]:" | head -20
```

- [ ] **Step 4: Замени содержимое HTML-блока вкладки info**

Найди в `renderModulePage` раздел где формируется HTML панели `info` (примерно строки 3405–3480). Замени его на следующий код:

```js
// ── вкладка info ──────────────────────────────────────────────────────────────
// Заголовок (редактируемый)
const titleViewHtml = `<div class="modp-info-title">${escHtml(data.title || mod)}</div>`;
const titleEditHtml = `<input class="moddet-add-input" id="moddet-title-input" 
  value="${escHtml(data.title || mod)}" style="font-size:var(--fs-md);width:100%">`;

// Таблица метаданных (редактируемая)
const metaFields = [
  ['type',     'Тип',     data.type     || ''],
  ['time',     'Время',   data.time     || ''],
  ['location', 'Локация', data.location || ''],
  ['tone',     'Тон',     data.tone     || ''],
  ['format',   'Формат',  data.format   || ''],
];
const metaViewHtml = `<table class="modp-info-table">
  ${metaFields.filter(([,, v]) => v).map(([, label, v]) =>
    `<tr><td class="modp-info-lbl">${escHtml(label)}</td><td>${escHtml(v)}</td></tr>`
  ).join('')}
</table>`;
const metaEditHtml = metaFields.map(([key, label, v]) =>
  `<div class="chr-form-group" style="margin-bottom:8px">
    <label class="chr-form-label">${escHtml(label)}</label>
    <input class="moddet-add-input" id="moddet-meta-${key}" value="${escHtml(v)}">
  </div>`
).join('');

// Концепция (редактируемая)
const descViewHtml = data.description
  ? `<div class="modp-concept-text">${escHtml(data.description)}</div>`
  : '<div class="cdet-empty">Концепция не заполнена</div>';
const descEditHtml = `<textarea class="cdet-edit-textarea" id="moddet-desc-ta" 
  rows="8" style="width:100%">${escHtml(data.description || '')}</textarea>`;

// ПК и НПС — краткий список только для просмотра (редактирование — Task 7)
const pcList  = (data.pcs  || []).map(p => `<li>${escHtml(p.name)} <span class="modp-role">${escHtml(p.role||'')}</span></li>`).join('');
const npcList = (data.npcs || []).map(p => `<li>${escHtml(p.name)} <span class="modp-role">${escHtml(p.role||'')}</span></li>`).join('');
const participantsHtml = `
  <div class="modp-participants-section">
    <div class="modp-part-col">
      <div class="modp-part-title">🎭 Персонажи игроков</div>
      ${pcList ? `<ul class="modp-part-list">${pcList}</ul>` : '<div class="cdet-empty">Не указаны</div>'}
    </div>
    <div class="modp-part-col">
      <div class="modp-part-title">👤 НПС</div>
      ${npcList ? `<ul class="modp-part-list">${npcList}</ul>` : '<div class="cdet-empty">Не указаны</div>'}
    </div>
  </div>`;

const infoHtml = `
  ${modPanel('title', titleViewHtml, titleEditHtml)}
  <div class="modp-section-divider"></div>
  ${modPanel('meta', metaViewHtml, metaEditHtml)}
  <div class="modp-section-divider"></div>
  <div class="modp-section-label">💡 Концепция</div>
  ${modPanel('desc', descViewHtml, descEditHtml)}
  <div class="modp-section-divider"></div>
  <div class="modp-section-label">👥 Участники</div>
  ${participantsHtml}
  <button class="modp-edit-btn" id="modp-edit-participants-btn" style="margin-top:8px">✏ Редактировать участников</button>`;
```

- [ ] **Step 5: Добавь обработчик кликов data-editmod / data-savemod / data-cancelmod**

Найди в `scripts.js` обработчик кликов для модульной страницы (примерно в блоке `#page-module` или в `loadModulePage`). Добавь обработку:

```js
const editModBtn   = e.target.closest('[data-editmod]');
const saveModBtn   = e.target.closest('[data-savemod]');
const cancelModBtn = e.target.closest('[data-cancelmod]');

if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }
if (cancelModBtn) { _modToggleEdit(cancelModBtn.dataset.cancelmod, false);  return; }
if (saveModBtn)   { _modSavePanel(saveModBtn.dataset.savemod);             return; }
```

- [ ] **Step 6: Проверь в браузере**

Открой модуль → вкладка «ℹ Краткое» → нажми «✏ Редактировать» у поля «Тип» → измени значение → «Сохранить». Убедись что значение обновилось в `<mod>.md` и отобразилось после reload.

- [ ] **Step 7: Commit**

```bash
git add web/public/scripts.js
git commit -m "feat: info tab editPanel — редактирование заголовка, метаданных, концепции"
```

---

## Task 7: UI — Info tab: управление участниками (pcs/npcs chips)

Редактируемый список ПК и НПС с автодополнением из `STATE.characters`. Клик «✏ Редактировать участников» раскрывает chip-редактор.

**Files:**
- Modify: `web/public/scripts.js`

- [ ] **Step 1: Добавь функцию _renderParticipantChips**

Добавь функцию перед `renderModulePage`:

```js
function _renderParticipantChips(group, items) {
  // group: 'pcs' | 'npcs', items: [{name, role}]
  const chips = items.map(p =>
    `<div class="moddet-chip" data-name="${escHtml(p.name)}">
       ${escHtml(p.name)}
       <button class="moddet-chip-rm" data-rmname="${escHtml(p.name)}" data-rmgroup="${group}" 
         title="Удалить">×</button>
     </div>`
  ).join('');
  return `
    <div class="moddet-chips-wrap" id="moddet-${group}-chips">${chips}</div>
    <div class="moddet-add-row">
      <input class="moddet-add-input" id="moddet-${group}-add-input" 
        placeholder="${group === 'pcs' ? 'Имя персонажа игрока…' : 'Имя НПС…'}" 
        list="moddet-${group}-datalist" autocomplete="off">
      <datalist id="moddet-${group}-datalist">
        ${(STATE.characters || []).map(c => `<option value="${escHtml(c.name)}">`).join('')}
      </datalist>
      <button class="modp-save-btn" data-addchip="${group}" style="white-space:nowrap">+ Добавить</button>
    </div>`;
}
```

- [ ] **Step 2: Добавь панель участников в renderModulePage**

В блоке формирования `infoHtml` (из Task 6) найди кнопку `#modp-edit-participants-btn`. После неё добавь скрытую панель участников:

```js
// После кнопки «Редактировать участников»:
const participantsEditHtml = `
  <div id="moddet-participants-panel" style="display:none;margin-top:12px">
    <div class="modp-section-label">🎭 Персонажи игроков</div>
    ${_renderParticipantChips('pcs', data.pcs || [])}
    <div class="modp-section-label" style="margin-top:12px">👤 НПС</div>
    ${_renderParticipantChips('npcs', data.npcs || [])}
    <div class="modp-edit-bar" id="moddet-participants-bar" style="display:flex;margin-top:12px">
      <button class="modp-save-btn" data-savemod="participants">Сохранить</button>
      <button class="modp-cancel-btn" id="moddet-participants-cancel">Отмена</button>
      <span class="modp-save-msg" id="moddet-participants-msg" style="display:none">✓ Сохранено</span>
    </div>
  </div>`;
```

- [ ] **Step 3: Добавь обработку событий участников в click-handler страницы модуля**

```js
// Кнопка «Редактировать участников»
if (e.target.id === 'modp-edit-participants-btn') {
  const panel = document.getElementById('moddet-participants-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
  return;
}

// Отмена редактирования участников
if (e.target.id === 'moddet-participants-cancel') {
  const panel = document.getElementById('moddet-participants-panel');
  if (panel) panel.style.display = 'none';
  return;
}

// Удаление чипа
const rmBtn = e.target.closest('[data-rmname]');
if (rmBtn) {
  const name  = rmBtn.dataset.rmname;
  const group = rmBtn.dataset.rmgroup;
  const chip  = rmBtn.closest('.moddet-chip');
  if (chip) chip.remove();
  return;
}

// Добавление чипа
const addChipBtn = e.target.closest('[data-addchip]');
if (addChipBtn) {
  const group  = addChipBtn.dataset.addchip;
  const input  = document.getElementById(`moddet-${group}-add-input`);
  const nm     = input?.value?.trim();
  if (!nm) return;
  const chips  = document.getElementById(`moddet-${group}-chips`);
  if (chips) {
    const div = document.createElement('div');
    div.className = 'moddet-chip';
    div.dataset.name = nm;
    div.innerHTML = `${escHtml(nm)}<button class="moddet-chip-rm" data-rmname="${escHtml(nm)}" data-rmgroup="${group}" title="Удалить">×</button>`;
    chips.appendChild(div);
  }
  if (input) input.value = '';
  return;
}
```

- [ ] **Step 4: Проверь в браузере**

Открой модуль → вкладка «ℹ Краткое» → «✏ Редактировать участников» → добавь НПС через input → «Сохранить». Убедись что секция `## 👥 Участники` в файле обновилась.

- [ ] **Step 5: Commit**

```bash
git add web/public/scripts.js
git commit -m "feat: управление участниками модуля (pcs/npcs) через chip-редактор"
```

---

## Task 8: UI — Scenario tab: view/edit toggle

Кнопка «✏ Редактировать» на вкладке «📝 Сценарий» открывает textarea с полным markdown. Кнопка «Сохранить» → `PUT /scenario`. Кнопка «♻ Перегенерировать» предупреждает и запускает fill endpoint.

**Files:**
- Modify: `web/public/scripts.js` (вкладка scenario в renderModulePage)

- [ ] **Step 1: Найди блок генерации HTML для вкладки scenario**

```bash
grep -n "scenario\|mdToHtml.*data\.scenario" web/public/scripts.js | grep "3[4-9][0-9][0-9]:\|[45][0-9][0-9][0-9]:" | head -20
```

- [ ] **Step 2: Замени содержимое HTML-блока вкладки scenario**

Найди в `renderModulePage` место где собирается HTML для панели `scenario` и замени его:

```js
// ── вкладка scenario ─────────────────────────────────────────────────────────
const scenarioHtml = data.scenario
  ? mdToHtml(data.scenario)
  : '<div class="cdet-empty">Сценарий не сгенерирован. Нажми «🪄 Сгенерировать».</div>';

const scenarioPanelHtml = `
  <div class="modp-scenario-toolbar">
    ${data.scenario
      ? `<button class="modp-edit-btn" data-editmod="scenario">✏ Редактировать</button>
         <button class="modp-edit-btn" id="modp-regen-scenario-btn" style="margin-left:8px">♻ Перегенерировать</button>`
      : ''
    }
  </div>
  <div id="moddet-scenario-view">${scenarioHtml}</div>
  <div id="moddet-scenario-edit" style="display:none">
    <textarea class="cdet-edit-textarea" id="moddet-scenario-ta" rows="40" 
      style="width:100%;font-family:monospace;font-size:var(--fs-sm)">${escHtml(data.scenario || '')}</textarea>
  </div>
  <div class="modp-edit-bar" id="moddet-scenario-bar">
    <button class="modp-save-btn" data-savemod="scenario">Сохранить</button>
    <button class="modp-cancel-btn" data-cancelmod="scenario">Отмена</button>
    <span class="modp-save-msg" id="moddet-scenario-msg" style="display:none">✓ Сохранено</span>
  </div>`;
```

- [ ] **Step 3: Добавь обработку кнопки «♻ Перегенерировать» в click-handler**

```js
if (e.target.id === 'modp-regen-scenario-btn') {
  const d   = STATE.currentModuleData;
  const chr = d?.chronicle || STATE.currentModule?.chronicle;
  const mod = d?.name      || STATE.currentModule?.name;
  if (!chr || !mod) return;
  
  // Показать confirm-панель вместо нативного confirm()
  const ok = confirm('Сгенерировать сценарий заново? Текущий scenario.md будет перезаписан.');
  if (!ok) return;
  
  // Используем существующий fill endpoint
  const pcs  = (d.pcs  || []).map(p => p.name);
  const npcs = (d.npcs || []).map(p => p.name);
  const content = d.description || '';
  
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = '⏳ Генерирую…';
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fill${window.location.search}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pcs, npcs, content }) }
    );
    const result = await r.json();
    if (!r.ok) throw new Error(result.error || 'Ошибка');
    await _reloadModulePage();
  } catch (err) {
    alert('Ошибка генерации: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '♻ Перегенерировать';
  }
  return;
}
```

- [ ] **Step 4: Добавь CSS для toolbar**

```css
.modp-scenario-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
```

- [ ] **Step 5: Проверь в браузере**

Открой модуль → вкладка «📝 Сценарий» → «✏ Редактировать» → измени одну строку → «Сохранить». Убедись что `scenario.md` обновился. Затем проверь «♻ Перегенерировать» (отмени при подтверждении — не должно ничего происходить).

- [ ] **Step 6: Commit**

```bash
git add web/public/scripts.js web/public/styles.css
git commit -m "feat: scenario tab — редактирование сценария + кнопка перегенерации"
```

---

## Task 9: UI — NPC tab: добавление НПС вручную + инициализация npc.md

Кнопка «+ Добавить НПС» с выбором группы (ПК/Канонический/Модульный) и автодополнением из `STATE.characters`. При отсутствии `npc.md` — кнопка «Создать npc.md».

**Files:**
- Modify: `web/public/scripts.js` (функция `_renderModuleNpcGroups` или панель npcs в `renderModulePage`)

- [ ] **Step 1: Найди где формируется HTML вкладки npcs**

```bash
grep -n "_renderModuleNpcGroups\|npcGroups\|npc-add\|modp.*npc" web/public/scripts.js | head -20
```

- [ ] **Step 2: Добавь кнопки в конец HTML вкладки npcs**

В функции (или блоке), где формируется HTML панели `npcs`, после основного списка добавь:

```js
// Toolbar для вкладки НПС
const npcToolbarHtml = `
  <div class="modp-npc-add-toolbar" style="margin-top:16px">
    ${!data.npcContent
      ? `<button class="modp-edit-btn" id="modp-init-npcmd-btn">📄 Создать npc.md</button>`
      : ''
    }
    <button class="modp-edit-btn" id="modp-add-npc-btn">+ Добавить НПС</button>
  </div>
  
  <div id="modp-npc-add-form" style="display:none;margin-top:12px;padding:12px;border:1px solid var(--clr-border);border-radius:var(--radius)">
    <div class="chr-form-group">
      <label class="chr-form-label">Имя</label>
      <input class="moddet-add-input" id="modp-npc-add-name" 
        list="modp-npc-add-datalist" placeholder="Имя персонажа…" autocomplete="off">
      <datalist id="modp-npc-add-datalist">
        ${(STATE.characters || []).map(c => `<option value="${escHtml(c.name)}">`).join('')}
      </datalist>
    </div>
    <div class="chr-form-group">
      <label class="chr-form-label">Группа</label>
      <select class="chr-form-select" id="modp-npc-add-group">
        <option value="modular">🆕 Модульный НПС (создать карточку)</option>
        <option value="canon">📚 Каноничный НПС (из персонажей города)</option>
        <option value="pc">🎭 Персонаж игрока</option>
      </select>
    </div>
    <div class="modp-edit-bar" style="display:flex">
      <button class="modp-save-btn" id="modp-npc-add-submit">Добавить</button>
      <button class="modp-cancel-btn" id="modp-npc-add-cancel">Отмена</button>
      <span class="modp-save-msg" id="modp-npc-add-msg" style="display:none"></span>
    </div>
  </div>`;
```

- [ ] **Step 3: Добавь обработчики в click-handler страницы модуля**

```js
// Показать форму добавления НПС
if (e.target.id === 'modp-add-npc-btn') {
  const form = document.getElementById('modp-npc-add-form');
  if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
  return;
}

// Скрыть форму
if (e.target.id === 'modp-npc-add-cancel') {
  const form = document.getElementById('modp-npc-add-form');
  if (form) form.style.display = 'none';
  return;
}

// Создать npc.md (инициализация)
if (e.target.id === 'modp-init-npcmd-btn') {
  const d   = STATE.currentModuleData;
  const chr = d?.chronicle || STATE.currentModule?.chronicle;
  const mod = d?.name      || STATE.currentModule?.name;
  if (!chr || !mod) return;
  // POST с dummy-именем не нужен — достаточно POST без имени для инициализации.
  // Используем PUT /fields — он не создаёт npc.md, поэтому нужен отдельный запрос.
  // Создаём skeleton через POST /npc с флагом init (добавь серверный guard: если name пустой и init=true → только создать npc.md).
  // Упрощённый вариант: отправить POST /npc с именем-заглушкой и сразу удалить строку.
  // Вместо этого добавь кнопку только как "создать пустой файл":
  const btn = e.target;
  btn.disabled = true;
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${window.location.search}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '_init_', group: 'modular', initOnly: true }) }
    );
    if (!r.ok) throw new Error(await r.text());
    await _reloadModulePage();
  } catch (err) {
    alert('Ошибка: ' + err.message);
    btn.disabled = false;
  }
  return;
}

// Сабмит формы добавления НПС
if (e.target.id === 'modp-npc-add-submit') {
  const d     = STATE.currentModuleData;
  const chr   = d?.chronicle || STATE.currentModule?.chronicle;
  const mod   = d?.name      || STATE.currentModule?.name;
  const name  = document.getElementById('modp-npc-add-name')?.value?.trim();
  const group = document.getElementById('modp-npc-add-group')?.value || 'modular';
  const msg   = document.getElementById('modp-npc-add-msg');
  if (!name) { if (msg) { msg.textContent = '⚠ Укажи имя'; msg.style.display = ''; } return; }
  const btn = e.target;
  btn.disabled = true;
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${window.location.search}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, group }) }
    );
    const result = await r.json();
    if (!r.ok) throw new Error(result.error || 'Ошибка');
    if (msg) { msg.textContent = `✓ Добавлен: ${name}`; msg.style.display = ''; }
    await _reloadModulePage();
  } catch (err) {
    if (msg) { msg.textContent = '✗ ' + err.message; msg.style.display = ''; }
    btn.disabled = false;
  }
  return;
}
```

- [ ] **Step 4: Добавь поддержку initOnly в POST /npc на сервере**

В `server.js` в `POST /api/chronicles/:chr/modules/:mod/npc` добавь guard в начало обработчика:

```js
const { name, group = 'modular', initOnly = false } = req.body || {};

// initOnly: просто создать skeleton npc.md без добавления строк
if (initOnly) {
  const npcMdPath = path.join(modDir, 'npc.md');
  if (!await fs.stat(npcMdPath).catch(() => null)) {
    const mainTxt2  = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
    const titleM2   = mainTxt2.match(/^#\s+(.+)$/m);
    const modTitle2 = titleM2 ? titleM2[1].replace(/[*[\]]/g, '').trim() : mod;
    const skeleton = [
      `# НПС модуля: ${modTitle2}`, ``,
      `## 🎭 Игровые персонажи (ПК)`, ``,
      `## 📚 Каноничные НПС`, ``,
      `## 🆕 Модульные НПС`, ``,
    ].join('\n');
    await writeFileAtomic(npcMdPath, skeleton, 'utf-8');
  }
  delete _cache[city];
  return res.json({ ok: true, initOnly: true });
}
```

- [ ] **Step 5: Проверь в браузере**

Открой модуль без `npc.md` → вкладка «👥 НПС» → «📄 Создать npc.md» → файл создался → «+ Добавить НПС» → добавь модульного НПС → проверь что появилась карточка в `npc/<slug>/` и строка в `npc.md`.

- [ ] **Step 6: Commit**

```bash
git add web/server.js web/public/scripts.js
git commit -m "feat: NPC tab — добавление НПС вручную, инициализация npc.md"
```

---

## Task 10: UI — Locations tab: quick-attach + соответствие правилам при создании

Кнопки «📎 Прикрепить» рядом с каждой локацией из «Упомянуты в сценарии». Новые карточки создаются через форму `#loc-edit-modal` по тем же правилам что и обычные локации (а не через inline-генерацию внутри fill).

**Files:**
- Modify: `web/public/scripts.js` (функция `_renderModuleLocPanel`)

- [ ] **Step 1: Найди функцию _renderModuleLocPanel**

```bash
grep -n "_renderModuleLocPanel\|modp-locs" web/public/scripts.js | head -10
```
Запомни строку начала функции (~9672).

- [ ] **Step 2: Обнови список «Упомянуты в сценарии»**

Найди в `_renderModuleLocPanel` блок где рендерится список `data.locations` (упомянутые в сценарии). Замени его:

```js
// «Упомянуты в сценарии» — с кнопками быстрого прикрепления
const mentionedHtml = (data.locations || []).length
  ? `<ul class="modp-locs-mentioned-list">
      ${data.locations.map(locName => {
        const isLinked = (data.linkedLocations || []).some(
          l => _nameMatch(l.name || l.slug, locName));
        const existsInCity = (STATE.locations || []).find(l => _nameMatch(l.name, locName));
        const attachSlug = existsInCity?.slug;
        return `<li class="modp-locs-mentioned-item">
          <span>${escHtml(locName)}</span>
          ${isLinked
            ? `<span class="modp-locs-linked-badge">✓ Прикреплена</span>`
            : attachSlug
              ? `<button class="modp-locs-attach-btn" 
                   data-attach-slug="${escHtml(attachSlug)}" 
                   data-attach-name="${escHtml(locName)}">📎 Прикрепить</button>`
              : `<button class="modp-locs-create-btn" 
                   data-create-name="${escHtml(locName)}">✨ Создать карточку</button>`
          }
        </li>`;
      }).join('')}
    </ul>`
  : '<div class="cdet-empty">В сценарии нет упоминаний локаций</div>';
```

- [ ] **Step 3: Добавь обработчики в click-handler**

```js
// Быстрое прикрепление существующей локации
const attachBtn = e.target.closest('[data-attach-slug]');
if (attachBtn) {
  const d   = STATE.currentModuleData;
  const chr = d?.chronicle || STATE.currentModule?.chronicle;
  const mod = d?.name      || STATE.currentModule?.name;
  const slug = attachBtn.dataset.attachSlug;
  if (!chr || !mod || !slug) return;
  attachBtn.disabled = true;
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/locations${window.location.search}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) }
    );
    if (!r.ok) throw new Error(await r.text());
    await _reloadModulePage();
  } catch (err) {
    alert('Ошибка: ' + err.message);
    attachBtn.disabled = false;
  }
  return;
}

// Создать карточку для новой локации (открыть стандартный loc-edit-modal с заполненным именем)
const createLocBtn = e.target.closest('[data-create-name]');
if (createLocBtn) {
  const locName = createLocBtn.dataset.createName;
  // Открываем стандартную форму создания локации с предзаполненным именем
  const nameInput = document.getElementById('loc-edit-name');
  if (nameInput) nameInput.value = locName;
  // Запомним текущий модуль для auto-attach после создания (реализуется через STATE)
  STATE._pendingLocAttach = {
    chr: STATE.currentModule?.chronicle,
    mod: STATE.currentModule?.name,
  };
  openLocEditModal(null); // открыть форму создания новой локации
  return;
}
```

- [ ] **Step 4: Добавь CSS для новых элементов**

```css
.modp-locs-mentioned-list { list-style: none; padding: 0; margin: 0; }
.modp-locs-mentioned-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 0; border-bottom: 1px solid var(--clr-border);
  gap: 8px;
}
.modp-locs-linked-badge { font-size: var(--fs-sm); color: var(--clr-success); }
.modp-locs-attach-btn, .modp-locs-create-btn {
  background: none; border: 1px solid var(--clr-border);
  color: var(--clr-accent); padding: 2px 10px;
  border-radius: var(--radius-sm); font-size: var(--fs-sm); cursor: pointer;
  white-space: nowrap;
}
.modp-locs-attach-btn:hover, .modp-locs-create-btn:hover { background: var(--clr-hover); }
```

- [ ] **Step 5: Проверь в браузере**

Открой модуль со сгенерированным сценарием → вкладка «📍 Локации» → проверь список «Упомянуты в сценарии». Рядом с локацией, уже имеющейся в городе, должна быть кнопка «📎 Прикрепить». Рядом с новой — «✨ Создать карточку».

- [ ] **Step 6: Commit**

```bash
git add web/public/scripts.js web/public/styles.css
git commit -m "feat: locations tab — quick-attach и создание карточки локации из сценария"
```

---

## Task 11: UI — Inline-панель результата генерации + стилизованный диалог удаления

Убирает `alert()` из обработчика кнопки «🪄 Сгенерировать» и `confirm()` из обработчика «🗑 Удалить модуль». Заменяет их на встроенные UI-компоненты.

**Files:**
- Modify: `web/public/scripts.js`
- Modify: `web/public/index.html`
- Modify: `web/public/styles.css`

- [ ] **Step 1: Добавь #modp-gen-result div в index.html**

Найди в `index.html` `.modp-gen-panel` (секцию кнопки генерации, примерно строки 226–258). Добавь после кнопки «🪄 Сгенерировать»:

```html
<div id="modp-gen-result" class="modp-gen-result" style="display:none"></div>
```

- [ ] **Step 2: Добавь #modp-delete-modal в index.html**

После существующих модалей (около строки 403) добавь:

```html
<!-- Module delete confirmation modal -->
<div id="modp-delete-modal" class="modal" style="display:none">
  <div class="modal-box" style="max-width:440px">
    <div class="modal-title">🗑 Удалить модуль?</div>
    <div id="modp-del-preview" class="modp-del-preview"></div>
    <div class="modal-actions">
      <button class="btn-danger" id="modp-del-confirm-btn" disabled>Удалить</button>
      <button class="btn-secondary" id="modp-del-cancel-btn">Отмена</button>
    </div>
    <div class="modp-del-unlock" style="margin-top:12px">
      <label style="font-size:var(--fs-sm);color:var(--clr-muted)">
        <input type="checkbox" id="modp-del-unlock-check"> Я понимаю последствия
      </label>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Замени alert() в обработчике генерации**

Найди в `scripts.js` строку с `alert(lines.join` (~строки 3873–3895). Замени блок вывода результата:

```js
// Было:
// alert(lines.join('\n'));

// Стало:
const resultEl = document.getElementById('modp-gen-result');
if (resultEl) {
  const warnings = (result.timelineWarnings || []).filter(w => w.severity === 'high');
  resultEl.innerHTML = `
    <div class="modp-gen-result-inner">
      <div class="modp-gen-result-title">✅ Сценарий сгенерирован</div>
      ${result.npcs?.length ? `<div>🆕 НПС: ${result.npcs.join(', ')}</div>` : ''}
      ${result.canonNpcs?.length ? `<div>📚 Канонические: ${result.canonNpcs.join(', ')}</div>` : ''}
      ${result.locations?.length ? `<div>📍 Локации: ${result.locations.join(', ')}</div>` : ''}
      ${result.reusedLocations?.length ? `<div>🔁 Переиспользованы: ${result.reusedLocations.join(', ')}</div>` : ''}
      ${warnings.length ? `<div class="modp-gen-warn">⚠️ Конфликты таймлайна: ${warnings.map(w => `${w.character} — ${w.issue}`).join('; ')}</div>` : ''}
    </div>`;
  resultEl.style.display = '';
  setTimeout(() => { resultEl.style.display = 'none'; }, 8000);
}
await _reloadModulePage();
```

- [ ] **Step 4: Замени confirm() в обработчике удаления модуля**

Найди в `scripts.js` блок с двойным `confirm` (~строки 3935–3940). Замени на:

```js
// Было: if (!confirm(...)) return; if (!confirm(...)) return;

// Стало:
const d   = STATE.currentModuleData;
const chr = d?.chronicle || STATE.currentModule?.chronicle;
const mod = d?.name      || STATE.currentModule?.name;
if (!chr || !mod) return;

// Загрузить превью
const preview = await fetch(
  `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/delete-preview${window.location.search}`
).then(r => r.json()).catch(() => null);

const previewEl = document.getElementById('modp-del-preview');
if (previewEl && preview) {
  previewEl.innerHTML = `
    <ul style="margin:8px 0;padding-left:18px;font-size:var(--fs-sm)">
      <li>Файлов MD: <b>${preview.fileCount}</b></li>
      ${preview.modularNpcs?.length ? `<li>Модульных НПС: <b>${preview.modularNpcs.join(', ')}</b></li>` : ''}
      ${preview.eventCount ? `<li>Событий в хронике: <b>${preview.eventCount}</b></li>` : ''}
      ${preview.affectedChars?.length ? `<li>Дневники персонажей: <b>${preview.affectedChars.join(', ')}</b></li>` : ''}
    </ul>`;
}

const unlockCheck = document.getElementById('modp-del-unlock-check');
const confirmBtn  = document.getElementById('modp-del-confirm-btn');
if (unlockCheck) unlockCheck.checked = false;
if (confirmBtn)  confirmBtn.disabled = true;
if (unlockCheck) unlockCheck.onchange = () => {
  if (confirmBtn) confirmBtn.disabled = !unlockCheck.checked;
};

document.getElementById('modp-del-cancel-btn')?.addEventListener('click', () => {
  document.getElementById('modp-delete-modal').style.display = 'none';
}, { once: true });

document.getElementById('modp-del-confirm-btn')?.addEventListener('click', async () => {
  document.getElementById('modp-delete-modal').style.display = 'none';
  const r = await fetch(
    `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}${window.location.search}`,
    { method: 'DELETE' }
  ).then(r => r.json()).catch(() => null);
  if (r?.ok) navigate('chronicle');
  else alert('Ошибка удаления: ' + (r?.error || 'неизвестная'));
}, { once: true });

document.getElementById('modp-delete-modal').style.display = 'flex';
```

- [ ] **Step 5: Добавь CSS**

```css
/* Generation result panel */
.modp-gen-result { margin-top: 10px; }
.modp-gen-result-inner {
  background: var(--clr-success-bg, #1a2e1a);
  border: 1px solid var(--clr-success);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: var(--fs-sm);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.modp-gen-result-title { font-weight: 600; color: var(--clr-success); }
.modp-gen-warn { color: var(--clr-warning, #e8a020); }

/* Delete modal preview */
.modp-del-preview { color: var(--clr-text); font-size: var(--fs-sm); margin: 8px 0; }
.btn-danger {
  background: var(--clr-danger);
  color: #fff; border: none;
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
}
.btn-danger:disabled { opacity: .4; cursor: default; }
.btn-secondary {
  background: none;
  border: 1px solid var(--clr-border);
  color: var(--clr-muted);
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
}
```

Если `--clr-danger`, `--clr-success-bg`, `--clr-warning` отсутствуют в `:root` — добавь туда или замени на ближайший существующий цвет.

- [ ] **Step 6: Проверь в браузере**

Нажми «🪄 Сгенерировать» → должна появиться inline-панель результата (не `alert`). Нажми «🗑 Удалить модуль» → должен появиться стилизованный диалог с превью, чекбоксом и задизейбленной кнопкой удаления.

- [ ] **Step 7: Commit**

```bash
git add web/public/scripts.js web/public/index.html web/public/styles.css
git commit -m "feat: inline-панель результата генерации + стилизованный диалог удаления модуля"
```

---

## Проверка плана

**Покрытие требований:**
- ✅ Приведение к единообразию с локациями/персонажами — `editPanel`-паттерн с `data-editmod/savemod/cancelmod`, те же CSS-классы
- ✅ Добавление персонажей и НПС — Task 7 (participants chips) + Task 9 (npc add form)
- ✅ Локации: переиспользование существующих, создание новых — Task 10
- ✅ Ведение сессий — сессии уже работают; Task 9 не ломает их
- ✅ Редактирование всех полей — Tasks 1, 6, 7 (title/meta/description/participants)
- ✅ Хранение готового сценария — Task 2 (PUT /scenario) + Task 8 (UI)
- ✅ Требования по оформлению сценариев — `module_rules.md` уже передаётся в AI-промт; кнопка «♻» в Task 8 позволяет перегенерировать следуя правилам
- ✅ Создание локаций согласно правил — Task 4 (шаблон с `Слаг`, `Родной город`, эмодзи в H1)

**Нет заглушек:** все шаги содержат код или конкретные команды.

**Зависимости между задачами:**
- Tasks 1–4: независимы, выполняются первыми
- Task 5: зависит от Tasks 1–4 (хелперы используют их эндпоинты)
- Tasks 6–11: зависят от Task 5 (хелперы должны быть объявлены)
- Task 9: зависит от Task 3 (POST /npc)
- Task 11: зависит от Task 4 (GET /delete-preview)
