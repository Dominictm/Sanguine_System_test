# Формы хронологии/состояния мира + перенос web/public/*.js в scripts/ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Дать Рассказчику структурированные формы (add/edit/delete строк и
разделов через поля, без ручного markdown) для вкладок «Хронология мира»
(`timeline.md`) и «Состояние мира» (блок в `events.md`) — по спеке
`docs/superpowers/specs/2026-07-13-world-timeline-state-manual-forms-design.md`.
(2) Перенести все `.js`-файлы из `web/public/` в `web/public/scripts/` и
обновить все ссылки на них.

**Architecture:** Точечные regex-patch функции в новых модулях
`web/lib/parsers/timeline.js` и `web/lib/parsers/worldState.js` (по образцу
уже существующего `setPoliticalFactionInfluence` — патчим ровно один
блок/строку, не переписывая весь файл целиком с нуля из абстрактной модели).
Новые REST-эндпойнты в `web/routes/archive.js`. Новый UI в
`web/public/scripts/archive.js` заменяет `_loadArchiveEditable`-рендер для
таба `lore` и голый `renderWorldState` для таба `world` на структурированные
формы; старое raw-markdown редактирование остаётся вторичной кнопкой
(escape hatch).

**Tech Stack:** Node.js/Express (без TS), vanilla JS фронтенд (classic
`<script>`, общий global scope), `node:test` для тестов.

---

## Task 1: Перенос `web/public/*.js` → `web/public/scripts/`

Механическая, низкорисковая задача — делаем первой, чтобы все дальнейшие
правки (Task 4-7) сразу шли по новым путям.

**Files:**
- Move: 14 файлов `web/public/*.js` → `web/public/scripts/*.js`
- Modify: `web/public/index.html:1375-1388`
- Modify: `web/tests/all.test.js:172, 183, 240`
- Modify: `.claude/settings.json:5, 47`

- [ ] **Step 1: Создать папку и перенести файлы через `git mv` (сохраняет историю)**

```bash
mkdir -p web/public/scripts
for f in archive audio-library char-detail city graph locations log-session modules rules-v20 scripts search tour utils v20-sheet; do
  git mv "web/public/$f.js" "web/public/scripts/$f.js"
done
git status --short web/public
```

Ожидается: 14 строк `R  web/public/<f>.js -> web/public/scripts/<f>.js`.

- [ ] **Step 2: Обновить `<script src>` в `web/public/index.html`**

Строки 1375-1388, каждый `src="<имя>.js"` → `src="scripts/<имя>.js"`:

```html
<script src="scripts/rules-v20.js"></script>
<script src="scripts/utils.js"></script>
<script src="scripts/graph.js"></script>
<script src="scripts/locations.js"></script>
<script src="scripts/v20-sheet.js"></script>
<script src="scripts/audio-library.js"></script>
<script src="scripts/scripts.js"></script>
<script src="scripts/char-detail.js"></script>
<script src="scripts/archive.js"></script>
<script src="scripts/modules.js"></script>
<script src="scripts/city.js"></script>
<script src="scripts/log-session.js"></script>
<script src="scripts/search.js"></script>
<script src="scripts/tour.js"></script>
```

Порядок загрузки не менять — файлы делят один global scope, некоторые
зависят от объявлений в ранее загруженных.

- [ ] **Step 3: Обновить source-guard тесты в `web/tests/all.test.js`**

Три места читают фронтенд-файлы по пути (строки актуальны на момент
написания плана — при расхождении искать по строке теста, указанной рядом):

```js
// строка 172 (тест "browser parity — public/utils.js _NTR mirrors CYRILLIC_TR")
// строка 183 (тест "browser parity — public/utils.js _LATIN_TR mirrors LATIN_TR")
path.join(__dirname, '../public/utils.js'), 'utf-8')
// →
path.join(__dirname, '../public/scripts/utils.js'), 'utf-8')
```

```js
// строка 240 (тест "browser parity — public/city.js CITY_SECTION_DEFS зеркалит CITY_SECTIONS")
path.join(__dirname, '../public/city.js'), 'utf-8')
// →
path.join(__dirname, '../public/scripts/city.js'), 'utf-8')
```

- [ ] **Step 4: Обновить `.claude/settings.json`**

Строки 5 и 47 — bash-паттерны в allowlist:

```json
"Bash(node --check web/public/scripts.js)",
```
→
```json
"Bash(node --check web/public/scripts/scripts.js)",
```
и аналогично для строки 47 (`node -c web/public/scripts.js` →
`node -c web/public/scripts/scripts.js`).

- [ ] **Step 5: Прогнать тесты**

```bash
cd web && npm run test:unit
```
Ожидается 341/341 (те же 341, что и до переноса — задача не добавляет новых
тестов). Откатить `web/tests/report.html` (`git checkout -- web/tests/report.html`).

- [ ] **Step 6: Живая проверка в браузере**

По рецепту `.claude/skills/run-sanguine-web/SKILL.md` — перезапустить сервер
(`POST /api/restart`), открыть headless Chrome, убедиться что страница вообще
рендерится (значит все 14 `<script>` тегов зарезолвились — иначе была бы
пустая страница/консольная 404), проверить `Network.responseReceived` без
404 на `/scripts/*.js`.

- [ ] **Step 7: Commit**

```bash
git add web/public/scripts web/public/index.html web/tests/all.test.js .claude/settings.json
git commit -m "refactor: move web/public/*.js into web/public/scripts/"
```
(Файлы, удалённые из `web/public/` напрямую через `git mv`, уже застейджены
как rename — `git add` подтягивает и оставшиеся правки.)

---

## Task 2: `web/lib/parsers/timeline.js` — парсер + точечные patch-функции

**Files:**
- Create: `web/lib/parsers/timeline.js`
- Modify: `web/lib/parsers/index.js`
- Test: `web/tests/all.test.js` (новый `describe`)

Формат `timeline.md` (см. `cities/paris/archive/timeline.md`): H1+вступление,
`## Условные обозначения` (легенда — таблица `Символ | Значение`), затем N
блоков `## <произвольный заголовок эпохи>`, каждый — таблица
`Год | Тип | Событие | Источник | Связи` («Связи» — markdown-ссылки).

- [ ] **Step 1: Написать модуль**

```js
'use strict';
const { mdExtractLinks } = require('./shared');

const TIMELINE_HEADERS = ['Год', 'Тип', 'Событие', 'Источник', 'Связи'];

// Верхнеуровневые "## "-блоки: blocks[0].heading === null — это H1+вступление
// (не редактируется формой), остальные — либо легенда, либо эпоха. Разбор по
// позиции в СЫРОМ тексте (start/end — индексы в исходной строке), чтобы
// точечные patch-функции ниже могли заменить ровно один блок.
function _splitTopBlocks(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const starts = [0];
  const re = /\n(?=##\s)/g;
  let m;
  while ((m = re.exec(text))) starts.push(m.index + 1);
  starts.push(text.length);
  const blocks = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const block = text.slice(starts[i], starts[i + 1]);
    const hm = block.match(/^##\s+(.+?)\s*\n/);
    blocks.push({ start: starts[i], end: starts[i + 1], heading: hm ? hm[1].trim() : null, raw: block });
  }
  return blocks;
}

function _parsePipeTable(text) {
  const rows = String(text || '').split('\n').filter(l => /^\s*\|/.test(l));
  if (rows.length < 2) return { headers: [], body: [] };
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  return { headers: cells(rows[0]), body: rows.slice(2).map(cells) };
}

function _serializeTable(headers, bodyRows) {
  const sep = headers.map(() => '---').join(' | ');
  const line = cells => `| ${cells.join(' | ')} |`;
  return [line(headers), `| ${sep} |`, ...bodyRows.map(line)].join('\n');
}

function _rowFromCells(cells) {
  return {
    year: cells[0] || '', type: cells[1] || '', event: cells[2] || '',
    source: cells[3] || '', links: mdExtractLinks(cells[4] || ''),
  };
}
function _cellsFromRow(row) {
  const links = (row.links || []).map(l => `[${l.text}](${l.href})`).join(', ');
  return [row.year || '', row.type || '', row.event || '', row.source || '', links];
}

/**
 * @param {string} raw — содержимое timeline.md
 * @returns {{intro:string, legend:{symbol:string,meaning:string}[], epochs:{heading:string, rows:object[]}[]}}
 */
function parseTimelineMd(raw) {
  const blocks = _splitTopBlocks(raw);
  const intro = blocks[0] ? blocks[0].raw : '';
  const legendBlock = blocks.find(b => b.heading && /^условные обозначения/i.test(b.heading));
  const legend = [];
  if (legendBlock) {
    const t = _parsePipeTable(legendBlock.raw);
    for (const cells of t.body) if (cells[0]) legend.push({ symbol: cells[0], meaning: cells[1] || '' });
  }
  const epochs = blocks
    .filter(b => b.heading && b !== legendBlock)
    .map(b => ({ heading: b.heading, rows: _parsePipeTable(b.raw).body.map(_rowFromCells) }));
  return { intro, legend, epochs };
}

function addTimelineEpoch(raw, heading) {
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const table = _serializeTable(TIMELINE_HEADERS, []);
  return `${text}\n\n---\n\n## ${heading}\n\n${table}\n`;
}

function removeTimelineEpoch(raw, heading) {
  const blocks = _splitTopBlocks(raw);
  const idx = blocks.findIndex(b => b.heading === heading);
  if (idx === -1) return { raw, found: false };
  const text = String(raw || '').replace(/\r\n/g, '\n');
  let before = text.slice(0, blocks[idx].start);
  const after = text.slice(blocks[idx].end);
  before = before.replace(/\n+---\n+$/, '\n\n');
  return { raw: before + after, found: true };
}

function _patchEpochTable(raw, heading, mutate) {
  const blocks = _splitTopBlocks(raw);
  const idx = blocks.findIndex(b => b.heading === heading);
  if (idx === -1) return { raw, found: false, indexValid: true };
  const b = blocks[idx];
  const t = _parsePipeTable(b.raw);
  const headers = t.headers.length ? t.headers : TIMELINE_HEADERS;
  const result = mutate(t.body);
  if (result === null) return { raw, found: true, indexValid: false };
  const headingLine = b.raw.match(/^##\s+.+?\s*\n/)[0];
  const newBlock = `${headingLine}\n${_serializeTable(headers, result)}\n`;
  const text = String(raw || '').replace(/\r\n/g, '\n');
  return { raw: text.slice(0, b.start) + newBlock + text.slice(b.end), found: true, indexValid: true };
}

function addTimelineRow(raw, heading, row) {
  return _patchEpochTable(raw, heading, body => [...body, _cellsFromRow(row)]);
}
function updateTimelineRow(raw, heading, index, row) {
  return _patchEpochTable(raw, heading, body => {
    if (index < 0 || index >= body.length) return null;
    return body.map((cells, i) => (i === index ? _cellsFromRow(row) : cells));
  });
}
function removeTimelineRow(raw, heading, index) {
  return _patchEpochTable(raw, heading, body => {
    if (index < 0 || index >= body.length) return null;
    return body.filter((_, i) => i !== index);
  });
}

module.exports = {
  parseTimelineMd, addTimelineEpoch, removeTimelineEpoch,
  addTimelineRow, updateTimelineRow, removeTimelineRow,
};
```

- [ ] **Step 2: Зарегистрировать в `web/lib/parsers/index.js`**

```js
module.exports = {
  ...require('./shared'),
  ...require('./city'),
  ...require('./character'),
  ...require('./location'),
  ...require('./scenario'),
  ...require('./threads'),
  ...require('./chronicle'),
  ...require('./timeline'),
};
```

- [ ] **Step 3: Написать unit-тесты (перед реализацией эндпойнтов — TDD)**

Добавить в `web/tests/all.test.js` (рядом с уже существующими тестами
парсеров, использовать реальный `cities/paris/archive/timeline.md` как
фикстуру через `fs.readFile`):

```js
describe('parsers/timeline.js', () => {
  const { parseTimelineMd, addTimelineEpoch, removeTimelineEpoch,
          addTimelineRow, updateTimelineRow, removeTimelineRow } = require('../lib/parsers');
  const fixture = [
    '# 🕰️ Тест', '', '> intro', '', '---', '',
    '## Условные обозначения', '',
    '| Символ | Значение |', '|:------:|----------|', '| 🏰 | Средневековье |', '',
    '---', '',
    '## I. Эпоха первая', '',
    '| Год | Тип | Событие | Источник | Связи |',
    '|-----|:---:|---------|:--------:|-------|',
    '| 1300 | 🏰 | Событие один | 📚 | [Перс](../characters/vampires/x/x.md) |',
  ].join('\n') + '\n';

  it('parseTimelineMd — легенда, эпоха, ссылки', () => {
    const t = parseTimelineMd(fixture);
    assert.equal(t.legend.length, 1);
    assert.equal(t.legend[0].symbol, '🏰');
    assert.equal(t.epochs.length, 1);
    assert.equal(t.epochs[0].heading, 'I. Эпоха первая');
    assert.equal(t.epochs[0].rows.length, 1);
    assert.equal(t.epochs[0].rows[0].year, '1300');
    assert.equal(t.epochs[0].rows[0].links[0].text, 'Перс');
  });

  it('addTimelineRow → parseTimelineMd видит новую строку, старая не тронута', () => {
    const { raw, found } = addTimelineRow(fixture, 'I. Эпоха первая',
      { year: '1350', type: '🎭', event: 'Новое', source: '🏙️', links: [] });
    assert.ok(found);
    const t = parseTimelineMd(raw);
    assert.equal(t.epochs[0].rows.length, 2);
    assert.equal(t.epochs[0].rows[0].event, 'Событие один');
    assert.equal(t.epochs[0].rows[1].event, 'Новое');
  });

  it('updateTimelineRow — неверный индекс → indexValid:false', () => {
    const r = updateTimelineRow(fixture, 'I. Эпоха первая', 5, { year: 'x', type: '', event: '', source: '', links: [] });
    assert.equal(r.indexValid, false);
  });

  it('removeTimelineRow — удаляет ровно одну строку', () => {
    const withTwo = addTimelineRow(fixture, 'I. Эпоха первая',
      { year: '1350', type: '🎭', event: 'Новое', source: '🏙️', links: [] }).raw;
    const { raw } = removeTimelineRow(withTwo, 'I. Эпоха первая', 0);
    const t = parseTimelineMd(raw);
    assert.equal(t.epochs[0].rows.length, 1);
    assert.equal(t.epochs[0].rows[0].event, 'Новое');
  });

  it('addTimelineEpoch / removeTimelineEpoch — round-trip', () => {
    const added = addTimelineEpoch(fixture, 'II. Эпоха вторая');
    let t = parseTimelineMd(added);
    assert.equal(t.epochs.length, 2);
    assert.equal(t.epochs[1].heading, 'II. Эпоха вторая');
    assert.equal(t.epochs[1].rows.length, 0);

    const removed = removeTimelineEpoch(added, 'II. Эпоха вторая').raw;
    t = parseTimelineMd(removed);
    assert.equal(t.epochs.length, 1);
    assert.equal(t.epochs[0].heading, 'I. Эпоха первая'); // первая эпоха не задета
  });
});
```

Запустить `npm run test:unit` из `web/`, убедиться что новые тесты падают
(модуля ещё нет) — затем добавить Step 1-2 выше и прогнать снова до зелёного.

- [ ] **Step 4: Commit**

```bash
git add web/lib/parsers/timeline.js web/lib/parsers/index.js web/tests/all.test.js
git commit -m "feat: point-patch parser for timeline.md epochs/rows"
```

---

## Task 3: `web/lib/parsers/worldState.js` — парсер + point-patch для блока в events.md

**Files:**
- Create: `web/lib/parsers/worldState.js`
- Modify: `web/lib/parsers/index.js`
- Test: `web/tests/all.test.js`

Блок `## 🌍 Состояние мира` живёт ВНУТРИ `archive/events.md`, ниже — реальные
данные (индекс `<!-- AUTO:events-index -->`, генерируется
`tools/build_city_events.js` — этот блок мы не трогаем никогда, патчим
только «Состояние мира», применяя ту же границу `\n(?=##\s)`, что уже
использует `parseChronicle` в `chronicle.js`). Секции — `### heading` с
таблицей своих колонок + опциональный абзац-«note» после таблицы.

- [ ] **Step 1: Написать модуль**

```js
'use strict';

// Извлекает блок "## 🌍 Состояние мира" из events.md — от заголовка до
// следующего "## " (там начинается индекс событий) либо до конца файла.
// Та же граница, что уже использует parseChronicle (chronicle.js) для чтения.
function _extractBlock(eventsRaw) {
  const text = String(eventsRaw || '').replace(/\r\n/g, '\n');
  const m = text.match(/##\s*🌍[^\n]*\n/);
  if (!m) return null;
  const start = m.index;
  const bodyStart = start + m[0].length;
  const rest = text.slice(bodyStart);
  const relEnd = rest.search(/\n(?=##\s)/);
  const end = relEnd === -1 ? text.length : bodyStart + relEnd + 1;
  return { start, end, headingLine: m[0], body: text.slice(bodyStart, end) };
}

/** Патчит блок «Состояние мира» внутри events.md, остальной файл не трогает. */
function replaceWorldStateBlock(eventsRaw, newBodyMd) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const text = String(eventsRaw || '').replace(/\r\n/g, '\n');
  return { raw: text.slice(0, block.start) + block.headingLine + newBodyMd + text.slice(block.end), found: true };
}

// Тело блока → {preamble, sections}: preamble — всё до первого "### " (обычно
// цитата "Обновляется после каждой сессии... Последнее обновление: **...**");
// sections[i].raw включает заголовок, таблицу, note и хвостовой "---" —
// склейка preamble + sections.map(s=>s.raw).join('') даёт исходное тело 1:1.
function _splitSections(body) {
  // Находим границы ВСЕХ "### "-секций (позиция самого "#", не предшествующего
  // \n) — тот же приём, что _splitTopBlocks в timeline.js, только для "### "
  // вместо "## " и с поддержкой секции, начинающейся с позиции 0 (без preamble).
  const starts = [];
  const re = /(?:^|\n)(?=###\s)/g;
  let m;
  while ((m = re.exec(body))) {
    starts.push(body[m.index] === '\n' ? m.index + 1 : m.index);
    if (m[0].length === 0) re.lastIndex += 1; // не зациклиться на нулевом совпадении по ^
  }
  if (!starts.length) return { preamble: body, sections: [] };
  const preamble = body.slice(0, starts[0]);
  const bounds = [...starts, body.length];
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const raw = body.slice(bounds[i], bounds[i + 1]);
    const hm = raw.match(/^###\s+(.+?)\s*\n/);
    sections.push({ heading: hm ? hm[1].trim() : '', raw });
  }
  return { preamble, sections };
}

function _parsePipeTable(text) {
  const rows = String(text || '').split('\n').filter(l => /^\s*\|/.test(l));
  if (rows.length < 2) return { headers: [], body: [] };
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  return { headers: cells(rows[0]), body: rows.slice(2).map(cells) };
}
function _serializeTable(headers, bodyRows) {
  const sep = headers.map(() => '---').join(' | ');
  const line = cells => `| ${cells.join(' | ')} |`;
  return [line(headers), `| ${sep} |`, ...bodyRows.map(line)].join('\n');
}
// Свободный абзац после таблицы секции (например «**Главный Элизиум:** …»).
function _extractNote(sectionRaw) {
  const lines = sectionRaw.split('\n').slice(1);
  return lines.map(l => l.trim()).filter(l => l && !/^\|/.test(l) && !/^---+$/.test(l)).join(' ').trim();
}
function _sectionRaw(heading, columns, rows, note) {
  const table = columns.length ? _serializeTable(columns, rows) : '';
  const noteBlock = note ? `\n\n${note}` : '';
  return `### ${heading}\n\n${table}${noteBlock}\n\n---\n\n`;
}

/**
 * @returns {{lastUpdate:string|null, sections:{heading:string, columns:string[], rows:string[][], note:string}[]}}
 */
function parseWorldStateBlock(eventsRaw) {
  const block = _extractBlock(eventsRaw);
  if (!block) return null;
  const lu = block.body.match(/Последнее обновление:\s*\*\*([^*]+)\*\*/);
  const { sections } = _splitSections(block.body);
  return {
    lastUpdate: lu ? lu[1].trim() : null,
    sections: sections.map(s => {
      const t = _parsePipeTable(s.raw);
      return { heading: s.heading, columns: t.headers, rows: t.body, note: _extractNote(s.raw) };
    }),
  };
}

function setWorldStateLastUpdate(eventsRaw, text) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const has = /Последнее обновление:\s*\*\*[^*]+\*\*/.test(block.body);
  const newBody = has
    ? block.body.replace(/Последнее обновление:\s*\*\*[^*]+\*\*/, `Последнее обновление: **${text}**`)
    : block.body; // формат без строки обновления — не создаём новую структуру самовольно
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: has };
}

function addWorldStateSection(eventsRaw, heading, columns) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const { preamble, sections } = _splitSections(block.body);
  sections.push({ heading, raw: _sectionRaw(heading, columns, [], '') });
  const newBody = preamble + sections.map(s => s.raw).join('');
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: true };
}

function removeWorldStateSection(eventsRaw, heading) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const { preamble, sections } = _splitSections(block.body);
  const idx = sections.findIndex(s => s.heading === heading);
  if (idx === -1) return { raw: eventsRaw, found: false };
  sections.splice(idx, 1);
  const newBody = preamble + sections.map(s => s.raw).join('');
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: true };
}

function setWorldStateSectionNote(eventsRaw, heading, note) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const { preamble, sections } = _splitSections(block.body);
  const idx = sections.findIndex(s => s.heading === heading);
  if (idx === -1) return { raw: eventsRaw, found: false };
  const t = _parsePipeTable(sections[idx].raw);
  sections[idx] = { heading, raw: _sectionRaw(heading, t.headers, t.body, note) };
  const newBody = preamble + sections.map(s => s.raw).join('');
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: true };
}

function _patchSectionRows(eventsRaw, heading, mutate) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false, indexValid: true };
  const { preamble, sections } = _splitSections(block.body);
  const idx = sections.findIndex(s => s.heading === heading);
  if (idx === -1) return { raw: eventsRaw, found: false, indexValid: true };
  const t = _parsePipeTable(sections[idx].raw);
  const note = _extractNote(sections[idx].raw);
  const result = mutate(t.body);
  if (result === null) return { raw: eventsRaw, found: true, indexValid: false };
  sections[idx] = { heading, raw: _sectionRaw(heading, t.headers, result, note) };
  const newBody = preamble + sections.map(s => s.raw).join('');
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: true, indexValid: true };
}

function addWorldStateRow(eventsRaw, heading, cells) {
  return _patchSectionRows(eventsRaw, heading, body => [...body, cells]);
}
function updateWorldStateRow(eventsRaw, heading, index, cells) {
  return _patchSectionRows(eventsRaw, heading, body => {
    if (index < 0 || index >= body.length) return null;
    return body.map((r, i) => (i === index ? cells : r));
  });
}
function removeWorldStateRow(eventsRaw, heading, index) {
  return _patchSectionRows(eventsRaw, heading, body => {
    if (index < 0 || index >= body.length) return null;
    return body.filter((_, i) => i !== index);
  });
}

module.exports = {
  parseWorldStateBlock, replaceWorldStateBlock, setWorldStateLastUpdate,
  addWorldStateSection, removeWorldStateSection, setWorldStateSectionNote,
  addWorldStateRow, updateWorldStateRow, removeWorldStateRow,
};
```

- [ ] **Step 2: Зарегистрировать в `web/lib/parsers/index.js`** (добавить
  `...require('./worldState'),` в конец объекта, после `timeline`).

- [ ] **Step 3: Unit-тесты** (используя реальный
  `cities/paris/archive/events.md` как фикстуру для happy-path, плюс
  синтетическую строку для граничных случаев — по аналогии с Task 2 Step 3):

```js
describe('parsers/worldState.js', () => {
  const {
    parseWorldStateBlock, setWorldStateLastUpdate, addWorldStateSection,
    removeWorldStateSection, addWorldStateRow, updateWorldStateRow,
    removeWorldStateRow, setWorldStateSectionNote,
  } = require('../lib/parsers');

  const fixture = [
    '# Тест', '', '## 🌍 Состояние мира', '',
    '> Последнее обновление: **тест**.', '', '---', '',
    '### 🏛️ Секция А', '',
    '| Кол1 | Кол2 |', '|---|---|', '| a | b |', '',
    '**Примечание:** заметка.', '', '---', '',
    '## 📋 Хроника событий', '', 'не трогать',
  ].join('\n') + '\n';

  it('parseWorldStateBlock — секция, колонки, note, lastUpdate', () => {
    const ws = parseWorldStateBlock(fixture);
    assert.equal(ws.lastUpdate, 'тест');
    assert.equal(ws.sections.length, 1);
    assert.deepEqual(ws.sections[0].columns, ['Кол1', 'Кол2']);
    assert.equal(ws.sections[0].rows.length, 1);
    assert.match(ws.sections[0].note, /Примечание/);
  });

  it('addWorldStateRow / updateWorldStateRow / removeWorldStateRow — не трогают "## 📋 Хроника событий"', () => {
    const added = addWorldStateRow(fixture, '🏛️ Секция А', ['c', 'd']).raw;
    assert.match(added, /не трогать/);
    let ws = parseWorldStateBlock(added);
    assert.equal(ws.sections[0].rows.length, 2);

    const updated = updateWorldStateRow(added, '🏛️ Секция А', 1, ['x', 'y']).raw;
    ws = parseWorldStateBlock(updated);
    assert.deepEqual(ws.sections[0].rows[1], ['x', 'y']);

    const removed = removeWorldStateRow(updated, '🏛️ Секция А', 0).raw;
    ws = parseWorldStateBlock(removed);
    assert.equal(ws.sections[0].rows.length, 1);
    assert.deepEqual(ws.sections[0].rows[0], ['x', 'y']);
  });

  it('addWorldStateSection / removeWorldStateSection', () => {
    const added = addWorldStateSection(fixture, '🔥 Новая секция', ['Кол1', 'Кол2']).raw;
    let ws = parseWorldStateBlock(added);
    assert.equal(ws.sections.length, 2);
    const removed = removeWorldStateSection(added, '🔥 Новая секция').raw;
    ws = parseWorldStateBlock(removed);
    assert.equal(ws.sections.length, 1);
  });

  it('setWorldStateLastUpdate / setWorldStateSectionNote', () => {
    const r1 = setWorldStateLastUpdate(fixture, 'новое значение');
    assert.ok(r1.found);
    assert.equal(parseWorldStateBlock(r1.raw).lastUpdate, 'новое значение');

    const r2 = setWorldStateSectionNote(fixture, '🏛️ Секция А', 'Новая заметка.');
    assert.match(parseWorldStateBlock(r2.raw).sections[0].note, /Новая заметка/);
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add web/lib/parsers/worldState.js web/lib/parsers/index.js web/tests/all.test.js
git commit -m "feat: point-patch parser for world-state block inside events.md"
```

---

## Task 4: `web/routes/archive.js` — эндпойнты хронологии

**Files:**
- Modify: `web/routes/archive.js`
- Modify: `web/routes/archive.js` (import block at top)
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Добавить импорты и helper резолва ссылок**

В начало файла (рядом с уже существующими импортами `../lib/db` и
`../lib/parsers`):

```js
const { getAllCharacters, getAllLocations } = require('../lib/db');
const {
  parseTimelineMd, addTimelineEpoch, removeTimelineEpoch,
  addTimelineRow, updateTimelineRow, removeTimelineRow,
} = require('../lib/parsers');
```

Хелпер резолва `{kind, slug}` → относительная markdown-ссылка от
`archive/timeline.md` (персонажи: `../characters/<lineageFolder>/<slug>/<slug>.md`,
локации: `../locations/<dirRelPath>/<slug>.md`, где `dirRelPath` уже
содержит цепочку `district_NN/<район>` — см. `getAllLocations` в `lib/db.js`):

```js
async function _resolveTimelineLink(city, { kind, slug }) {
  if (kind === 'character') {
    const chars = await getAllCharacters(city);
    const c = chars.find(x => x.slug === slug);
    if (!c) return null;
    return { text: c.name, href: `../characters/${c.lineageFolder}/${c.slug}/${c.slug}.md` };
  }
  if (kind === 'location') {
    const locs = await getAllLocations(city);
    const l = locs.find(x => x.slug === slug);
    if (!l) return null;
    return { text: l.name, href: `../locations/${l.dirRelPath}/${l.slug}.md` };
  }
  return null;
}
async function _resolveTimelineLinks(city, links) {
  const out = [];
  for (const l of (links || [])) {
    const r = await _resolveTimelineLink(city, l);
    if (r) out.push(r);
  }
  return out;
}
```

- [ ] **Step 2: `GET /api/timeline/structured`**

```js
router.get('/api/timeline/structured', async (req, res) => {
  try {
    const city = reqCity(req);
    const raw = await fs.readFile(path.join(archiveDir(city), 'timeline.md'), 'utf-8').catch(() => '');
    res.json(parseTimelineMd(raw));
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 3: Эндпойнты эпох**

```js
router.post('/api/timeline/epoch', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = String(req.body?.heading || '').trim();
    if (!heading) return res.status(400).json({ error: 'Укажи название эпохи' });
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const updated = addTimelineEpoch(raw, heading);
    await fs.mkdir(archiveDir(city), { recursive: true });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/timeline/epoch/:heading', async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const { raw: updated, found } = removeTimelineEpoch(raw, heading);
    if (!found) return res.status(404).json({ error: `Эпоха «${heading}» не найдена` });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Эндпойнты строк**

```js
router.post('/api/timeline/epoch/:heading/row', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const { year, type, event, source, links } = req.body || {};
    if (!String(event || '').trim()) return res.status(400).json({ error: 'Укажи текст события' });
    const resolvedLinks = await _resolveTimelineLinks(city, links);
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const { raw: updated, found } = addTimelineRow(raw, heading,
      { year: year || '', type: type || '', event: event.trim(), source: source || '', links: resolvedLinks });
    if (!found) return res.status(404).json({ error: `Эпоха «${heading}» не найдена` });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});

router.put('/api/timeline/epoch/:heading/row/:index', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const index = Number(req.params.index);
    const { year, type, event, source, links } = req.body || {};
    if (!String(event || '').trim()) return res.status(400).json({ error: 'Укажи текст события' });
    const resolvedLinks = await _resolveTimelineLinks(city, links);
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const { raw: updated, found, indexValid } = updateTimelineRow(raw, heading, index,
      { year: year || '', type: type || '', event: event.trim(), source: source || '', links: resolvedLinks });
    if (!found) return res.status(404).json({ error: `Эпоха «${heading}» не найдена` });
    if (!indexValid) return res.status(409).json({ error: 'Данные изменились, обновите страницу' });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/timeline/epoch/:heading/row/:index', async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const index = Number(req.params.index);
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const { raw: updated, found, indexValid } = removeTimelineRow(raw, heading, index);
    if (!found) return res.status(404).json({ error: `Эпоха «${heading}» не найдена` });
    if (!indexValid) return res.status(409).json({ error: 'Данные изменились, обновите страницу' });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 5: Integration-тесты** (по образцу «Faction influence — GET/PUT»
  в `all.test.js:2666+` — `before`/`after` бэкапят и восстанавливают
  `cities/paris/archive/timeline.md`, чтобы не оставить мусор в реальных
  данных):

```js
describe('Timeline structured — CRUD', () => {
  const tlFile = path.join(CITY_ROOT, 'archive', 'timeline.md');
  let original = null;
  before(async () => { original = await fs.readFile(tlFile, 'utf-8').catch(() => null); });
  after(async () => { if (original !== null) await fs.writeFile(tlFile, original, 'utf-8'); });

  it('GET /api/timeline/structured — реальный файл парсится, есть легенда и хотя бы одна эпоха', async () => {
    const { status, body } = await apiJson(`/api/timeline/structured${CITY}`);
    assert.equal(status, 200);
    assert.ok(body.legend.length > 0);
    assert.ok(body.epochs.length > 0);
  });

  it('POST /api/timeline/epoch — без heading → 400; с heading → 200 и новая пустая эпоха', async () => {
    const bad = await apiJson(`/api/timeline/epoch${CITY}`, { method: 'POST', body: JSON.stringify({}) });
    assert.equal(bad.status, 400);
    const ok = await apiJson(`/api/timeline/epoch${CITY}`,
      { method: 'POST', body: JSON.stringify({ heading: '__TEST_EPOCH__' }) });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.epochs.some(e => e.heading === '__TEST_EPOCH__'));
  });

  it('POST row → PUT row → DELETE row — round-trip внутри тестовой эпохи', async () => {
    await apiJson(`/api/timeline/epoch${CITY}`, { method: 'POST', body: JSON.stringify({ heading: '__TEST_EPOCH_2__' }) });
    const added = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH_2__')}/row${CITY}`,
      { method: 'POST', body: JSON.stringify({ year: '2000', type: '🧛', event: 'Тест', source: '🏙️', links: [] }) });
    assert.equal(added.status, 200);
    let epoch = added.body.epochs.find(e => e.heading === '__TEST_EPOCH_2__');
    assert.equal(epoch.rows.length, 1);

    const updated = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH_2__')}/row/0${CITY}`,
      { method: 'PUT', body: JSON.stringify({ year: '2001', type: '🧛', event: 'Тест-правка', source: '🏙️', links: [] }) });
    assert.equal(updated.status, 200);
    epoch = updated.body.epochs.find(e => e.heading === '__TEST_EPOCH_2__');
    assert.equal(epoch.rows[0].event, 'Тест-правка');

    const removed = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH_2__')}/row/0${CITY}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    epoch = removed.body.epochs.find(e => e.heading === '__TEST_EPOCH_2__');
    assert.equal(epoch.rows.length, 0);
  });

  it('PUT row с несуществующим индексом → 409', async () => {
    const { status } = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH__')}/row/99${CITY}`,
      { method: 'PUT', body: JSON.stringify({ year: '', type: '', event: 'x', source: '', links: [] }) });
    assert.equal(status, 409);
  });

  it('DELETE /api/timeline/epoch/:heading — неизвестная эпоха → 404', async () => {
    const { status } = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__NOPE__')}${CITY}`, { method: 'DELETE' });
    assert.equal(status, 404);
  });
});
```

- [ ] **Step 6: Прогнать тесты, откатить report.html, commit**

```bash
cd web && npm run test:unit && git checkout -- tests/report.html
git add routes/archive.js tests/all.test.js
git commit -m "feat: structured CRUD endpoints for timeline.md epochs/rows"
```

---

## Task 5: `web/routes/archive.js` — эндпойнты состояния мира

**Files:**
- Modify: `web/routes/archive.js`
- Test: `web/tests/all.test.js`

`events.md` живёт не в `archiveDir`, а как отдельный файл там же — путь
`path.join(archiveDir(city), 'events.md')` (тот же, что `findChronicleFile`
в `routes/chronicles.js:26`).

- [ ] **Step 1: Импорты**

```js
const {
  parseWorldStateBlock, replaceWorldStateBlock, setWorldStateLastUpdate,
  addWorldStateSection, removeWorldStateSection, setWorldStateSectionNote,
  addWorldStateRow, updateWorldStateRow, removeWorldStateRow,
} = require('../lib/parsers');
```

- [ ] **Step 2: `GET /api/world-state/structured` + `PUT .../last-update`**

```js
const _eventsFile = city => path.join(archiveDir(city), 'events.md');

router.get('/api/world-state/structured', async (req, res) => {
  try {
    const city = reqCity(req);
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.json({ lastUpdate: null, sections: [] });
    res.json(parseWorldStateBlock(raw) || { lastUpdate: null, sections: [] });
  } catch (e) { serverError(res, e); }
});

router.put('/api/world-state/last-update', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Укажи текст' });
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = setWorldStateLastUpdate(raw, text);
    if (!found) return res.status(404).json({ error: 'Блок «Состояние мира» не найден' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 3: Секции**

```js
router.post('/api/world-state/section', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = String(req.body?.heading || '').trim();
    const columns = Array.isArray(req.body?.columns) ? req.body.columns.map(c => String(c).trim()).filter(Boolean) : [];
    if (!heading) return res.status(400).json({ error: 'Укажи заголовок секции' });
    if (!columns.length) return res.status(400).json({ error: 'Укажи хотя бы одну колонку' });
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = addWorldStateSection(raw, heading, columns);
    if (!found) return res.status(404).json({ error: 'Блок «Состояние мира» не найден' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/world-state/section/:heading', async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = removeWorldStateSection(raw, heading);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.put('/api/world-state/section/:heading/note', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const text = String(req.body?.text || '').trim();
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = setWorldStateSectionNote(raw, heading, text);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Строки**

```js
router.post('/api/world-state/section/:heading/row', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const cells = Array.isArray(req.body?.cells) ? req.body.cells.map(c => String(c || '')) : [];
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = addWorldStateRow(raw, heading, cells);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.put('/api/world-state/section/:heading/row/:index', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const index = Number(req.params.index);
    const cells = Array.isArray(req.body?.cells) ? req.body.cells.map(c => String(c || '')) : [];
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found, indexValid } = updateWorldStateRow(raw, heading, index, cells);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    if (!indexValid) return res.status(409).json({ error: 'Данные изменились, обновите страницу' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/world-state/section/:heading/row/:index', async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const index = Number(req.params.index);
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found, indexValid } = removeWorldStateRow(raw, heading, index);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    if (!indexValid) return res.status(409).json({ error: 'Данные изменились, обновите страницу' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 5: Raw escape-hatch для блока «Состояние мира» целиком**

```js
router.get('/api/world-state/raw', async (req, res) => {
  try {
    const city = reqCity(req);
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.json({ exists: false, content: '' });
    const m = raw.match(/##\s*🌍[^\n]*\n([\s\S]*?)(?=\n##\s)/);
    res.json({ exists: !!m, content: m ? m[1] : '' });
  } catch (e) { serverError(res, e); }
});

router.put('/api/world-state/raw', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = replaceWorldStateBlock(raw, content);
    if (!found) return res.status(404).json({ error: 'Блок «Состояние мира» не найден' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 6: Integration-тесты** (тот же `before`/`after`-бэкап паттерн,
  файл — `cities/paris/archive/events.md`):

```js
describe('World-state structured — CRUD', () => {
  const evFile = path.join(CITY_ROOT, 'archive', 'events.md');
  let original = null;
  before(async () => { original = await fs.readFile(evFile, 'utf-8').catch(() => null); });
  after(async () => { if (original !== null) await fs.writeFile(evFile, original, 'utf-8'); });

  it('GET /api/world-state/structured — реальный events.md парсится, есть секции', async () => {
    const { status, body } = await apiJson(`/api/world-state/structured${CITY}`);
    assert.equal(status, 200);
    assert.ok(body.sections.length > 0);
  });

  it('POST /api/world-state/section — без columns → 400; с columns → создаёт пустую секцию', async () => {
    const bad = await apiJson(`/api/world-state/section${CITY}`,
      { method: 'POST', body: JSON.stringify({ heading: '__TEST_SECTION__' }) });
    assert.equal(bad.status, 400);
    const ok = await apiJson(`/api/world-state/section${CITY}`,
      { method: 'POST', body: JSON.stringify({ heading: '__TEST_SECTION__', columns: ['A', 'B'] }) });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.sections.some(s => s.heading === '__TEST_SECTION__'));
  });

  it('строки: POST → PUT → DELETE round-trip в тестовой секции', async () => {
    const added = await apiJson(`/api/world-state/section/${encodeURIComponent('__TEST_SECTION__')}/row${CITY}`,
      { method: 'POST', body: JSON.stringify({ cells: ['x', 'y'] }) });
    assert.equal(added.status, 200);
    let sec = added.body.sections.find(s => s.heading === '__TEST_SECTION__');
    assert.equal(sec.rows.length, 1);

    const updated = await apiJson(`/api/world-state/section/${encodeURIComponent('__TEST_SECTION__')}/row/0${CITY}`,
      { method: 'PUT', body: JSON.stringify({ cells: ['x2', 'y2'] }) });
    sec = updated.body.sections.find(s => s.heading === '__TEST_SECTION__');
    assert.deepEqual(sec.rows[0], ['x2', 'y2']);

    const removed = await apiJson(`/api/world-state/section/${encodeURIComponent('__TEST_SECTION__')}/row/0${CITY}`, { method: 'DELETE' });
    sec = removed.body.sections.find(s => s.heading === '__TEST_SECTION__');
    assert.equal(sec.rows.length, 0);
  });

  it('DELETE /api/world-state/section/:heading — очищает тестовую секцию (teardown внутри теста)', async () => {
    const { status } = await apiJson(`/api/world-state/section/${encodeURIComponent('__TEST_SECTION__')}${CITY}`, { method: 'DELETE' });
    assert.equal(status, 200);
  });

  it('PUT /api/world-state/last-update — round-trip', async () => {
    const before = await apiJson(`/api/world-state/structured${CITY}`);
    const put = await apiJson(`/api/world-state/last-update${CITY}`,
      { method: 'PUT', body: JSON.stringify({ text: '__TEST_UPDATE__' }) });
    assert.equal(put.status, 200);
    assert.equal(put.body.lastUpdate, '__TEST_UPDATE__');
    // восстановить, чтобы не оставить тестовый текст в реальном файле до after()
    await apiJson(`/api/world-state/last-update${CITY}`,
      { method: 'PUT', body: JSON.stringify({ text: before.body.lastUpdate }) });
  });
});
```

- [ ] **Step 7: Прогнать тесты, откатить report.html, commit**

```bash
cd web && npm run test:unit && git checkout -- tests/report.html
git add routes/archive.js tests/all.test.js
git commit -m "feat: structured CRUD + raw escape-hatch endpoints for world-state block"
```

---

## Task 6: Фронтенд — структурированная форма «Хронология мира»

**Files:**
- Modify: `web/public/scripts/archive.js`

- [ ] **Step 1: Заменить диспетчер таба `lore` в `renderChronicle()`**

Было (после Task 1 — файл уже `web/public/scripts/archive.js`):
```js
  if (st.tab === 'lore') {
    sub.textContent = 'Хронология мира · timeline.md';
    _loadArchiveEditable('/api/timeline', '/api/timeline', 'chronicle-content',
      'timeline.md не найден для этого города');
    return;
  }
```
Стало:
```js
  if (st.tab === 'lore') {
    sub.textContent = 'Хронология мира · timeline.md';
    loadTimelineForm();
    return;
  }
```

- [ ] **Step 2: Реализовать `loadTimelineForm()` + рендер эпох**

Добавить рядом с `renderTimeline` (переиспользует `escHtml`, `mdInline`,
`ensureCharsLoaded`/`ensureLocsLoaded`, уже загруженные `STATE.characters`/
`STATE.locations`):

```js
let _timelineData = null; // {intro, legend, epochs} — кэш последнего /structured

async function loadTimelineForm() {
  const el = document.getElementById('chronicle-content');
  el.innerHTML = SPINNER;
  await Promise.all([ensureCharsLoaded(), ensureLocsLoaded()]);
  try {
    _timelineData = await fetch('/api/timeline/structured' + _cityQS()).then(r => r.json());
    el.innerHTML = renderTimelineForm(_timelineData);
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить хронологию</div>';
  }
}

function _cityQS() {
  return window.location.search || '';
}

function renderTimelineForm(data) {
  const legendOptions = data.legend.map(l => `<option value="${escHtml(l.symbol)}">${escHtml(l.symbol)} — ${escHtml(l.meaning)}</option>`).join('');
  const epochsHtml = data.epochs.map((ep, epIdx) => `
    <section class="chron-event" data-epoch="${escHtml(ep.heading)}">
      <div class="chron-event-head">
        <div class="chron-event-title">${escHtml(ep.heading)}</div>
        <button class="chron-toggle" data-epoch-del="${escHtml(ep.heading)}" title="Удалить эпоху">🗑</button>
      </div>
      <table class="ws-table"><thead><tr><th>Год</th><th>Тип</th><th>Событие</th><th>Источник</th><th>Связи</th><th></th></tr></thead>
      <tbody>${ep.rows.map((r, i) => `
        <tr data-epoch="${escHtml(ep.heading)}" data-row="${i}">
          <td>${escHtml(r.year)}</td><td>${escHtml(r.type)}</td><td>${mdInline(r.event)}</td>
          <td>${escHtml(r.source)}</td>
          <td>${r.links.map(l => escHtml(l.text)).join(', ')}</td>
          <td><button class="chron-toggle tl-row-edit" data-epoch="${escHtml(ep.heading)}" data-row="${i}">✏</button>
              <button class="chron-toggle tl-row-del" data-epoch="${escHtml(ep.heading)}" data-row="${i}">🗑</button></td>
        </tr>`).join('')}</tbody></table>
      <button class="chron-toggle tl-row-add" data-epoch="${escHtml(ep.heading)}">+ Добавить запись</button>
      <div class="tl-row-form" data-epoch-form="${escHtml(ep.heading)}" hidden></div>
    </section>`).join('');

  return `
    <div class="tl-legend-hint">${legendOptions ? '' : ''}</div>
    ${epochsHtml}
    <button class="chron-toggle" id="tl-add-epoch">+ Новая эпоха</button>
    <div class="tl-epoch-form" id="tl-new-epoch-form" hidden>
      <input type="text" id="tl-new-epoch-heading" placeholder="Название эпохи">
      <button class="chron-toggle" id="tl-new-epoch-save">Сохранить</button>
    </div>
    <button class="chron-toggle" id="tl-raw-edit-toggle" style="margin-top:20px">✏ Редактировать весь файл</button>
    <div id="tl-raw-edit-container"></div>
    <datalist id="tl-legend-datalist">${legendOptions}</datalist>`;
}
```

- [ ] **Step 3: Форма add/edit строки + пикер связей**

Форма строки — переиспользуемая функция, рендерится в `.tl-row-form`
контейнер конкретной эпохи (для add — пустые поля, для edit — заполненные
текущими значениями строки):

```js
function _timelineRowFormHtml(epochHeading, rowIndex, row) {
  const links = row?.links || [];
  const linkChips = links.map((l, i) => `<span class="chron-chip" data-link-idx="${i}">${escHtml(l.text)} <a href="#" class="tl-link-remove" data-idx="${i}">✕</a></span>`).join('');
  return `
    <div class="tl-form-fields">
      <input type="text" class="tl-f-year" placeholder="Год" value="${escHtml(row?.year || '')}">
      <input type="text" class="tl-f-type" list="tl-legend-datalist" placeholder="Тип (эмодзи)" value="${escHtml(row?.type || '')}">
      <textarea class="tl-f-event" placeholder="Событие">${escHtml(row?.event || '')}</textarea>
      <select class="tl-f-source">
        <option value="📚" ${row?.source === '📚' ? 'selected' : ''}>📚 Канон WoD</option>
        <option value="🏙️" ${row?.source === '🏙️' ? 'selected' : ''}>🏙️ Установлено в проекте</option>
        <option value="❓" ${row?.source === '❓' ? 'selected' : ''}>❓ Канон неоднозначен</option>
      </select>
      <div class="tl-f-links">
        <input type="text" class="tl-link-search" placeholder="Персонаж/локация...">
        <div class="tl-link-suggest" hidden></div>
        <div class="tl-link-chips">${linkChips}</div>
      </div>
      <button class="chron-toggle tl-row-save" data-epoch="${escHtml(epochHeading)}" data-row="${rowIndex ?? ''}">Сохранить</button>
      <button class="chron-toggle tl-row-cancel">Отмена</button>
    </div>`;
}
```

Пикер связей (`.tl-link-search`) — на `input`, фильтрует
`[...STATE.characters, ...STATE.locations]` по имени (первые ~8 совпадений),
показывает `.tl-link-suggest` со списком; клик по варианту добавляет чип
`{kind, slug, text}` во внутренний массив `_pendingLinks` (хранится на DOM-
элементе формы через `dataset` JSON или в замыкании — реализовать как
модуль-уровневый `let _pendingLinks = []`, сбрасываемый при открытии формы).

- [ ] **Step 4: Делегированный обработчик кликов/сабмитов**

Тот же контейнер, что уже обрабатывает `renderTimeline` (`#chronicle-content`)
— дописать новые `if`-ветки в СУЩЕСТВУЮЩИЙ делегат (не заводить второй
листенер на тот же элемент). Новые классы `tl-*` не пересекаются с уже
обрабатываемыми `chron-*`/`chip-*`.

```js
document.getElementById('chronicle-content').addEventListener('click', e => {
  // ... существующие ветки chron-toggle / chip-char / chip-loc — без изменений ...

  if (e.target.id === 'tl-add-epoch') {
    document.getElementById('tl-new-epoch-form').hidden = false;
    return;
  }
  if (e.target.id === 'tl-new-epoch-save') {
    const heading = document.getElementById('tl-new-epoch-heading').value.trim();
    if (!heading) return;
    fetch('/api/timeline/epoch' + _cityQS(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heading }),
    }).then(r => r.json()).then(d => { if (d.ok !== false) loadTimelineForm(); });
    return;
  }
  const epochDel = e.target.closest('[data-epoch-del]');
  if (epochDel) {
    if (!confirm(`Удалить эпоху «${epochDel.dataset.epochDel}»?`)) return;
    fetch(`/api/timeline/epoch/${encodeURIComponent(epochDel.dataset.epochDel)}${_cityQS()}`, { method: 'DELETE' })
      .then(() => loadTimelineForm());
    return;
  }
  const rowAdd = e.target.closest('.tl-row-add');
  if (rowAdd) {
    const container = document.querySelector(`[data-epoch-form="${CSS.escape(rowAdd.dataset.epoch)}"]`);
    container.innerHTML = _timelineRowFormHtml(rowAdd.dataset.epoch, null, null);
    container.hidden = false;
    return;
  }
  const rowEdit = e.target.closest('.tl-row-edit');
  if (rowEdit) {
    const epoch = _timelineData.epochs.find(x => x.heading === rowEdit.dataset.epoch);
    const row = epoch.rows[Number(rowEdit.dataset.row)];
    const container = document.querySelector(`[data-epoch-form="${CSS.escape(rowEdit.dataset.epoch)}"]`);
    container.innerHTML = _timelineRowFormHtml(rowEdit.dataset.epoch, Number(rowEdit.dataset.row), row);
    container.hidden = false;
    return;
  }
  if (e.target.classList.contains('tl-row-cancel')) {
    e.target.closest('.tl-row-form').hidden = true;
    return;
  }
  const rowSave = e.target.closest('.tl-row-save');
  if (rowSave) {
    const form = rowSave.closest('.tl-form-fields');
    const body = JSON.stringify({
      year: form.querySelector('.tl-f-year').value,
      type: form.querySelector('.tl-f-type').value,
      event: form.querySelector('.tl-f-event').value,
      source: form.querySelector('.tl-f-source').value,
      links: _pendingLinks, // собран пикером связей (Step 3) — {kind, slug}[]
    });
    const epoch = encodeURIComponent(rowSave.dataset.epoch);
    const idx = rowSave.dataset.row;
    const url = idx === '' ? `/api/timeline/epoch/${epoch}/row${_cityQS()}` : `/api/timeline/epoch/${epoch}/row/${idx}${_cityQS()}`;
    fetch(url, { method: idx === '' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      .then(r => r.json()).then(d => {
        if (d.error && !d.ok) { alert(d.error); }
        loadTimelineForm();
      });
    return;
  }
  const rowDel = e.target.closest('.tl-row-del');
  if (rowDel) {
    const epoch = encodeURIComponent(rowDel.dataset.epoch);
    fetch(`/api/timeline/epoch/${epoch}/row/${rowDel.dataset.row}${_cityQS()}`, { method: 'DELETE' })
      .then(r => r.json()).then(d => { if (d.error) alert(d.error); loadTimelineForm(); });
    return;
  }
  if (e.target.id === 'tl-raw-edit-toggle') {
    _loadArchiveEditable('/api/timeline', '/api/timeline', 'tl-raw-edit-container', 'timeline.md не найден');
    return;
  }
});
```

Пикер связей (`.tl-link-search`/`.tl-link-suggest`/`.tl-link-chips`) —
отдельный `input`-листенер (не в click-делегате выше, а рядом,
`addEventListener('input', ...)` на контейнер), пишет в модуль-уровневый
`let _pendingLinks = []`, сбрасываемый в `_timelineRowFormHtml`-вызовах
(Step 3) при открытии формы.

- [ ] **Step 5: Live CDP-проверка**

По рецепту `run-sanguine-web`: открыть вкладку «Хронология мира»,
добавить тестовую эпоху + строку со связью на реального персонажа, править
её, удалить, проверить что реальные эпохи не задеты (`git diff` на
`timeline.md` после отката тестовых действий должен быть пустым). Обязательно
удалить любые тестовые эпохи/строки, созданные при проверке (эта фича прямо
пишет в `cities/paris/archive/timeline.md` — не оставлять тестовый мусор).

- [ ] **Step 6: Commit**

```bash
git add web/public/scripts/archive.js
git commit -m "feat: structured add/edit/delete form for timeline.md (Хронология мира)"
```

---

## Task 7: Фронтенд — структурированная форма «Состояние мира»

**Files:**
- Modify: `web/public/scripts/archive.js`

Симметрично Task 6, с поправкой на динамические колонки per-секция.

- [ ] **Step 1: Заменить диспетчер таба `world`**

Было:
```js
  if (st.tab === 'world') {
    sub.textContent = 'Состояние мира';
    el.innerHTML = renderWorldState(data.worldState);
    return;
  }
```
Стало:
```js
  if (st.tab === 'world') {
    sub.textContent = 'Состояние мира';
    loadWorldStateForm();
    return;
  }
```
(`renderWorldState`/`renderTable` — оставить как есть, они больше нигде не
используются напрямую в этом пути, но не удалять: `renderTable` всё ещё
нужен `renderLoreMd`/`_loadArchiveEditable`-рендеру.)

- [ ] **Step 2: `loadWorldStateForm()` + рендер секций**

```js
async function loadWorldStateForm() {
  const el = document.getElementById('chronicle-content');
  el.innerHTML = SPINNER;
  try {
    const ws = await fetch('/api/world-state/structured' + _cityQS()).then(r => r.json());
    _worldStateData = ws;
    el.innerHTML = renderWorldStateForm(ws);
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить состояние мира</div>';
  }
}
let _worldStateData = null;

function renderWorldStateForm(ws) {
  const sectionsHtml = (ws.sections || []).map(s => `
    <section class="ws-section" data-ws-section="${escHtml(s.heading)}">
      <div class="ws-heading">${escHtml(s.heading)}
        <button class="chron-toggle" data-ws-section-del="${escHtml(s.heading)}" title="Удалить секцию">🗑</button>
      </div>
      <table class="ws-table"><thead><tr>${s.columns.map(c => `<th>${escHtml(c)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${s.rows.map((row, i) => `
        <tr data-ws-section="${escHtml(s.heading)}" data-row="${i}">
          ${row.map(c => `<td>${mdInline(c)}</td>`).join('')}
          <td><button class="chron-toggle ws-row-edit" data-ws-section="${escHtml(s.heading)}" data-row="${i}">✏</button>
              <button class="chron-toggle ws-row-del" data-ws-section="${escHtml(s.heading)}" data-row="${i}">🗑</button></td>
        </tr>`).join('')}</tbody></table>
      <button class="chron-toggle ws-row-add" data-ws-section="${escHtml(s.heading)}">+ Строка</button>
      <div class="ws-row-form" data-ws-section-form="${escHtml(s.heading)}" hidden></div>
      <div class="ws-prose ws-note-view">${s.note ? mdInline(s.note) : ''}</div>
      <button class="chron-toggle ws-note-edit" data-ws-section="${escHtml(s.heading)}">✏ Примечание</button>
    </section>`).join('');

  return `
    <div class="ws-updated">Последнее обновление:
      <input type="text" id="ws-last-update-input" value="${escHtml(ws.lastUpdate || '')}">
      <button class="chron-toggle" id="ws-last-update-save">Сохранить</button>
    </div>
    ${sectionsHtml}
    <button class="chron-toggle" id="ws-add-section">+ Новая секция</button>
    <div class="ws-section-form" id="ws-new-section-form" hidden>
      <input type="text" id="ws-new-section-heading" placeholder="Заголовок секции">
      <input type="text" id="ws-new-section-columns" placeholder="Колонки через запятую">
      <button class="chron-toggle" id="ws-new-section-save">Сохранить</button>
    </div>
    <button class="chron-toggle" id="ws-raw-edit-toggle" style="margin-top:20px">✏ Редактировать блок целиком</button>
    <div id="ws-raw-edit-container"></div>`;
}
```

- [ ] **Step 3: Форма строки (динамические поля по `columns` секции)**

```js
function _worldStateRowFormHtml(heading, rowIndex, columns, cells) {
  const fields = columns.map((col, i) => `
    <label>${escHtml(col)}<input type="text" class="ws-f-cell" data-col="${i}" value="${escHtml(cells?.[i] || '')}"></label>`).join('');
  return `
    <div class="tl-form-fields">
      ${fields}
      <button class="chron-toggle ws-row-save" data-ws-section="${escHtml(heading)}" data-row="${rowIndex ?? ''}">Сохранить</button>
      <button class="chron-toggle ws-row-cancel">Отмена</button>
    </div>`;
}
```

- [ ] **Step 4: Делегированный обработчик** (те же новые `if`-ветки в
  СУЩЕСТВУЮЩЕМ `#chronicle-content` click-делегате, добавленном/дополненном
  в Task 6 Step 4 — один общий листенер на все табы):

```js
  if (e.target.id === 'ws-last-update-save') {
    const text = document.getElementById('ws-last-update-input').value.trim();
    fetch('/api/world-state/last-update' + _cityQS(), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    }).then(() => loadWorldStateForm());
    return;
  }
  if (e.target.id === 'ws-add-section') {
    document.getElementById('ws-new-section-form').hidden = false;
    return;
  }
  if (e.target.id === 'ws-new-section-save') {
    const heading = document.getElementById('ws-new-section-heading').value.trim();
    const columns = document.getElementById('ws-new-section-columns').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!heading || !columns.length) return;
    fetch('/api/world-state/section' + _cityQS(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heading, columns }),
    }).then(r => r.json()).then(d => { if (d.error) alert(d.error); loadWorldStateForm(); });
    return;
  }
  const wsSectionDel = e.target.closest('[data-ws-section-del]');
  if (wsSectionDel) {
    if (!confirm(`Удалить секцию «${wsSectionDel.dataset.wsSectionDel}»?`)) return;
    fetch(`/api/world-state/section/${encodeURIComponent(wsSectionDel.dataset.wsSectionDel)}${_cityQS()}`, { method: 'DELETE' })
      .then(() => loadWorldStateForm());
    return;
  }
  const wsRowAdd = e.target.closest('.ws-row-add');
  if (wsRowAdd) {
    const section = _worldStateData.sections.find(s => s.heading === wsRowAdd.dataset.wsSection);
    const container = document.querySelector(`[data-ws-section-form="${CSS.escape(wsRowAdd.dataset.wsSection)}"]`);
    container.innerHTML = _worldStateRowFormHtml(wsRowAdd.dataset.wsSection, null, section.columns, null);
    container.hidden = false;
    return;
  }
  const wsRowEdit = e.target.closest('.ws-row-edit');
  if (wsRowEdit) {
    const section = _worldStateData.sections.find(s => s.heading === wsRowEdit.dataset.wsSection);
    const cells = section.rows[Number(wsRowEdit.dataset.row)];
    const container = document.querySelector(`[data-ws-section-form="${CSS.escape(wsRowEdit.dataset.wsSection)}"]`);
    container.innerHTML = _worldStateRowFormHtml(wsRowEdit.dataset.wsSection, Number(wsRowEdit.dataset.row), section.columns, cells);
    container.hidden = false;
    return;
  }
  if (e.target.classList.contains('ws-row-cancel')) {
    e.target.closest('.ws-row-form').hidden = true;
    return;
  }
  const wsRowSave = e.target.closest('.ws-row-save');
  if (wsRowSave) {
    const form = wsRowSave.closest('.tl-form-fields');
    const cells = Array.from(form.querySelectorAll('.ws-f-cell'))
      .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col))
      .map(inp => inp.value);
    const section = encodeURIComponent(wsRowSave.dataset.wsSection);
    const idx = wsRowSave.dataset.row;
    const url = idx === '' ? `/api/world-state/section/${section}/row${_cityQS()}` : `/api/world-state/section/${section}/row/${idx}${_cityQS()}`;
    fetch(url, { method: idx === '' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells }) })
      .then(r => r.json()).then(d => { if (d.error) alert(d.error); loadWorldStateForm(); });
    return;
  }
  const wsRowDel = e.target.closest('.ws-row-del');
  if (wsRowDel) {
    const section = encodeURIComponent(wsRowDel.dataset.wsSection);
    fetch(`/api/world-state/section/${section}/row/${wsRowDel.dataset.row}${_cityQS()}`, { method: 'DELETE' })
      .then(r => r.json()).then(d => { if (d.error) alert(d.error); loadWorldStateForm(); });
    return;
  }
  const wsNoteEdit = e.target.closest('.ws-note-edit');
  if (wsNoteEdit) {
    const section = _worldStateData.sections.find(s => s.heading === wsNoteEdit.dataset.wsSection);
    const view = document.querySelector(`[data-ws-section="${CSS.escape(wsNoteEdit.dataset.wsSection)}"] .ws-note-view`);
    view.innerHTML = `<textarea class="ws-f-note">${escHtml(section.note)}</textarea>
      <button class="chron-toggle ws-note-save" data-ws-section="${escHtml(wsNoteEdit.dataset.wsSection)}">Сохранить</button>`;
    return;
  }
  const wsNoteSave = e.target.closest('.ws-note-save');
  if (wsNoteSave) {
    const text = wsNoteSave.parentElement.querySelector('.ws-f-note').value.trim();
    fetch(`/api/world-state/section/${encodeURIComponent(wsNoteSave.dataset.wsSection)}/note${_cityQS()}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    }).then(() => loadWorldStateForm());
    return;
  }
  if (e.target.id === 'ws-raw-edit-toggle') {
    _loadArchiveEditable('/api/world-state/raw', '/api/world-state/raw', 'ws-raw-edit-container', 'Блок «Состояние мира» не найден');
    return;
  }
```

  `GET/PUT /api/world-state/raw` возвращают/принимают `{content}` в том же
  формате, что и остальные `archiveDoc`/`_writeArchiveDoc` — `_loadArchiveEditable`
  переиспользуется без изменений сигнатуры. После любой успешной мутации —
  `loadWorldStateForm()` (полная перезагрузка структуры, как и в Task 6,
  чтобы индексы строк снова совпадали с файлом).

- [ ] **Step 5: Live CDP-проверка + очистка тестовых данных**

Как в Task 6 Step 5, но для `cities/paris/archive/events.md` — добавить
тестовую секцию/строку, поправить, удалить, `git diff` на `events.md` после
проверки должен быть пустым.

- [ ] **Step 6: Commit**

```bash
git add web/public/scripts/archive.js
git commit -m "feat: structured add/edit/delete form for world-state block (Состояние мира)"
```

---

## Task 8: Минимальные CSS-добавления

**Files:**
- Modify: `web/public/styles.css`

Существующие классы (`.chron-event`, `.chron-toggle`, `.ws-section`,
`.ws-heading`, `.ws-table`, `.ws-prose`, `.chron-chip`, `.cdet-empty`)
переиспользуются как есть (см. исследование — уже полностью стилизованы).
Нужны только новые правила для элементов формы, которых раньше не было:
`.tl-form-fields`, `.tl-f-event` (textarea), `.tl-link-suggest`,
`.tl-link-chips`, `.ws-f-cell`/`label` в `.tl-form-fields`. Использовать уже
существующие CSS-переменные (`--bg4`, `--border`, `--text2`, `--r-sm`,
`--fs-base` и т.п.) — не вводить новые токены/литералы. Перед правками
CSS/JS — по правилу `CLAUDE.md` прогнать `/code-review`, после — impeccable
повторно (design-hooks и так сработают автоматически на edit).

- [ ] **Step 1: Написать минимальный набор правил**, ориентируясь на уже
  существующие соседние (`.chron-toggle`, `.ws-table th/td`) как образец
  отступов/шрифтов/цветов — не изобретать новую визуальную систему.
- [ ] **Step 2: Живая CDP-проверка обеих форм** (контраст, touch-таргеты
  ≥44px на `pointer:coarse`, нет горизонтального переполнения на узких
  ширинах — см. общие правила фронтенда в `CLAUDE.md`).
- [ ] **Step 3: Commit**

```bash
git add web/public/styles.css
git commit -m "style: form controls for timeline/world-state structured editing"
```

---

## Task 9: Финальная проверка и обновление статус-отчёта

- [ ] **Step 1: Полный прогон тестов**

```bash
cd web && npm run test:unit
```
Ожидается: все прежние 341 + новые (парсеры Task 2/3 — по ~5 тестов каждый,
интеграционные Task 4/5 — по ~5-6 тестов каждый) зелёные. Откатить
`tests/report.html`.

- [ ] **Step 2: Финальный `git status` / `git diff`**

Убедиться, что `cities/paris/archive/timeline.md` и `.../events.md` вернулись
к исходному состоянию (никаких тестовых эпох/секций не осталось после Task
6/7 Step 5) — `git diff --stat cities/` должен быть пустым.

- [ ] **Step 3: Обновить `docs/audit/2026-07-12-project-status-report.md`
  (или создать свежую запись/новый файл под сегодняшней датой, если правило
  проекта — не дописывать в чужой прошлый отчёт)** кратким пунктом о
  выполненной фиче — по аналогии с уже принятым в проекте форматом записи
  прогресса.

- [ ] **Step 4: Финальный commit** (если Step 3 породил незакоммиченные
  правки документации).

---

## Самопроверка плана (заполнено при написании)

- **Покрытие спеки:** все пункты `2026-07-13-world-timeline-state-manual-
  forms-design.md` покрыты — парсеры/API (Task 2-5), UI обеих вкладок
  (Task 6-7), raw-escape-hatch для обеих (сохранён для хронологии, добавлен
  для состояния мира), CSS (Task 8), тесты на каждом бэкенд-шаге.
- **Плейсхолдеры:** не найдено — каждый шаг либо содержит полный код, либо
  явно описывает конкретное действие (клик → эндпойнт → перерисовка) без
  «TBD»/«добавить обработку ошибок» общими словами.
- **Согласованность типов:** имена функций между Task 2/4 (`parseTimelineMd`,
  `addTimelineRow`, `updateTimelineRow`, `removeTimelineRow`,
  `addTimelineEpoch`, `removeTimelineEpoch`) и Task 3/5
  (`parseWorldStateBlock`, `addWorldStateRow`, ...) — сверены, совпадают в
  местах экспорта/импорта/вызова.
- **Осознанное отклонение:** в отличие от заявленного в спеке «batch не
  делаем, отдельные add/edit/delete» (подтверждено пользователем) — план
  строго следует этому; при этом сериализация секции/эпохи после каждой
  мутации ПЕРЕСОБИРАЕТСЯ из распарсенных частей (`_serializeTable`/
  `_sectionRaw`), а не патчится байт-в-байт — это осознанный компромисс
  (см. заметки в Task 2/3): гарантирует корректность структуры ценой
  минорного нормализования пробельного форматирования при каждой правке;
  избежать это можно было бы более сложной byte-offset-патч-логикой, но
  риск багов в такой логике выше пользы для этого случая.
