# Merits/Flaws Library Picker + Mortal Rituals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the V20 sheet's «Достоинства и недостатки» section from free text to a
structured, library-backed picker (matching the existing Disciplines/Backgrounds pattern), and
show the «Ритуалы» column on Mortal sheets too (currently vampire-only).

**Architecture:** `sheetData.meritsFlaws` changes from a string to an array of `{name, points,
kind}`. Old string-format sheets self-heal on next load via a client-side auto-migration in
`_v20Normalize()` (same pattern already used for disciplines/backgrounds/otherTraits — no
`tools/migrations/` entry, since that system is for markdown city files, not JSON sheet-data).
Two new combined library endpoints reuse existing per-category loaders. The Foundry mapper
branches on `Array.isArray(sheetData.meritsFlaws)` to support both old and new sheet-data shapes
side by side.

**Tech Stack:** Vanilla client-side JS (`web/public/scripts.js`), Express, `node:test`.

---

## Scope check

Spec `docs/superpowers/specs/2026-07-09-merits-library-picker-mortal-rituals-design.md` covers one
cohesive feature (rework one sheet section using an established pattern) plus one small,
independent UI-gate change (Rituals for Mortal). Not decomposing further — both are small and the
plan produces working, testable software at every task boundary.

## File Structure

- `web/routes/library.js` — modify: add `GET /api/library/merits` and `GET /api/library/flaws`
  (combined across categories), reusing `getAllMerits()`/`getAllFlaws()`.
- `web/lib/foundry-export.js` — modify: `mapCharacterToFoundryActor` branches on
  `Array.isArray(s.meritsFlaws)` for the merit/flaw Item export path.
- `web/lib/foundry-import.js` — modify: `mapFoundryActorToSheetData` returns
  `sheetData.meritsFlaws` as an array unconditionally.
- `web/public/scripts.js` — modify: `_v20Normalize()` (client-side migration), `_v20ParseMd()`
  (parse the AI markdown table), `_v20AddRow()`/`_V20_BASELINE_LEN` (new section), the library
  picker helpers (`_v20LoadLibrary`, `_v20LibPickerKindToSection`, `_v20RenderV20LibList`,
  `_v20AddLibraryItem`), the sheet render (`_v20RenderSheet`: new row renderer + Rituals gate).
- `web/public/styles.css` — modify: two small classes for the new kind `<select>` and its row.
- `system/rules/character_sheet_mortal.md` — modify: short note that Rituals is an optional
  houserule for Mortals in this project.
- `web/tests/all.test.js` — modify: update 2 existing `foundry-import` assertions (string →
  array), add new tests for the array-format export path, new Feature/flaw import test, new
  `Library` route describe block.

---

## Task 1: Combined library endpoints

**Files:**
- Modify: `web/routes/library.js`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block in `web/tests/all.test.js` right after the `describe('Characters', ...)`
block closes (find it via `grep -n "describe('Characters'" web/tests/all.test.js` — insert right
after its closing `});`, before the `// ── Locations ──` comment):

```javascript
  describe('Library', () => {
    it('GET /api/library/merits → массив всех категорий, каждая запись {name,points,category}', async () => {
      const { status, body } = await apiJson('/api/library/merits');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);
      const sample = body.find(m => m.name === 'Внушительный тип');
      assert.ok(sample, 'ожидалось известное достоинство «Внушительный тип»');
      assert.equal(typeof sample.points, 'number');
      assert.ok(sample.category, 'ожидалась категория (physical/social/mental/supernatural)');
    });
    it('GET /api/library/flaws → массив всех категорий', async () => {
      const { status, body } = await apiJson('/api/library/flaws');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);
      const sample = body.find(f => f.name === 'Запах могилы');
      assert.ok(sample, 'ожидался известный недостаток «Запах могилы»');
      assert.equal(typeof sample.points, 'number');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm run test:unit`
Expected: FAIL with 404 (routes don't exist yet).

- [ ] **Step 3: Implement the routes**

In `web/routes/library.js`, add these two routes right after the existing
`GET /api/library/flaws/:category` route (after its closing `});`, before `module.exports`):

```javascript
// ── Библиотека: объединённые списки достоинств/недостатков (все категории слиты) ──
// Для пикера в листе персонажа (см. web/public/scripts.js: _v20LoadLibrary) — не нужно
// отдельно грузить 4+4 эндпоинта по категориям на клиенте.
router.get('/api/library/merits', (_req, res) => {
  try { res.json(Object.values(getAllMerits()).flat()); }
  catch (e) { serverError(res, e); }
});

router.get('/api/library/flaws', (_req, res) => {
  try { res.json(Object.values(getAllFlaws()).flat()); }
  catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: Both new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/routes/library.js web/tests/all.test.js
git commit -m "feat: combined GET /api/library/merits and /flaws endpoints"
```

---

## Task 2: Foundry export — array-format meritsFlaws

**Files:**
- Modify: `web/lib/foundry-export.js:194,200,235`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing test**

Add this test right after the existing `'meritsFlaws, не найденный в библиотеке → остаётся текстом
в system.notes'` test (find via `grep -n "не найденный в библиотеке" web/tests/all.test.js`,
insert after its closing `});`, before the `'фон (backgrounds)'` test):

```javascript
    it('meritsFlaws как массив (новый формат) — экспорт напрямую, без сверки с библиотекой', () => {
      const sheet = {
        ...SHEET,
        meritsFlaws: [
          { name: 'Кастомное достоинство', points: 3, kind: 'merit' },
          { name: 'Кастомный недостаток', points: 2, kind: 'flaw' },
        ],
      };
      const a = mapCharacterToFoundryActor(CHAR, sheet);
      const merit = a.items.find(i => i.type === 'Feature' && i.system.type === 'wod.types.merit');
      assert.ok(merit, 'ожидалось «Кастомное достоинство»');
      assert.equal(merit.name, 'Кастомное достоинство');
      assert.equal(merit.system.level, 3);
      assert.equal(merit.system.isvisible, true);
      const flaw = a.items.find(i => i.type === 'Feature' && i.system.type === 'wod.types.flaw');
      assert.ok(flaw, 'ожидался «Кастомный недостаток»');
      assert.equal(flaw.name, 'Кастомный недостаток');
      assert.equal(flaw.system.level, 2);
      assert.equal(a.system.notes, '', 'массив не проходит через system.notes вообще');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test:unit`
Expected: FAIL — current code always calls `matchMeritsFlaws(s.meritsFlaws)` which does
`String(text||'').split('\n')`; passed an array, `String([...])` stringifies it wrong and no
`Feature`/`flaw` Item with the right name/level is produced.

- [ ] **Step 3: Implement the branch in `mapCharacterToFoundryActor`**

In `web/lib/foundry-export.js`, replace line 194:

```javascript
  const { matched: matchedMeritsFlaws, unmatched: unmatchedMeritsFlaws } = matchMeritsFlaws(s.meritsFlaws);
```

with:

```javascript
  // Достоинства/недостатки: новый формат — массив [{name,points,kind}], каждая запись
  // экспортируется как Item напрямую (kind/points уже известны из модели листа, сверка с
  // библиотекой не нужна). Старый формат — свободный текст (листы, ещё не открытые в браузере
  // после этого обновления) — матчится через matchMeritsFlaws(), несовпавшее остаётся в
  // system.notes, как и раньше.
  let meritFlawItemsOut, meritsFlawsNotes;
  if (Array.isArray(s.meritsFlaws)) {
    meritFlawItemsOut = s.meritsFlaws
      .filter(mf => String(mf?.name || '').trim())
      .map(mf => ({
        name: mf.name, type: 'Feature',
        system: { type: `wod.types.${mf.kind === 'flaw' ? 'flaw' : 'merit'}`, level: Number(mf.points) || 0, value: 0, max: 5, isrollable: false, isvisible: true },
      }));
    meritsFlawsNotes = '';
  } else {
    const { matched, unmatched } = matchMeritsFlaws(s.meritsFlaws);
    meritFlawItemsOut = _meritFlawItems(matched);
    meritsFlawsNotes = unmatched.join('\n');
  }
```

Then replace line 200 (the `_meritFlawItems(matchedMeritsFlaws)` entry in the `items` array):

```javascript
    ..._meritFlawItems(matchedMeritsFlaws),
```

with:

```javascript
    ...meritFlawItemsOut,
```

Then replace line 235 (`notes: unmatchedMeritsFlaws.join('\n'),`):

```javascript
      notes: unmatchedMeritsFlaws.join('\n'),
```

with:

```javascript
      notes: meritsFlawsNotes,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: New test PASSES, and both existing string-format tests (`meritsFlaws, совпавший с
библиотекой`, `meritsFlaws, не найденный в библиотеке`) still PASS unchanged (old-format branch
behaves exactly as before).

- [ ] **Step 5: Commit**

```bash
git add web/lib/foundry-export.js web/tests/all.test.js
git commit -m "feat: export array-format meritsFlaws directly to Foundry (skip library matching)"
```

---

## Task 3: Foundry import — array-format meritsFlaws

**Files:**
- Modify: `web/lib/foundry-import.js:62-70,118`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the two existing tests (find via `grep -n "достоинство из Feature/merit Item\|несовпавший текст из system.notes добавляется к строкам" web/tests/all.test.js`):

```javascript
    it('достоинство из Feature/merit Item возвращается строкой в meritsFlaws', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      assert.match(sheetData.meritsFlaws, /Внушительный тип \(1\)/);
    });
    it('несовпавший текст из system.notes добавляется к строкам meritsFlaws', () => {
      const actor2 = { ...ACTOR, system: { ...ACTOR.system, notes: 'Придуманная особенность (2)' } };
      const { sheetData } = mapFoundryActorToSheetData(actor2, EXISTING_SHEET);
      assert.match(sheetData.meritsFlaws, /Внушительный тип \(1\)/);
      assert.match(sheetData.meritsFlaws, /Придуманная особенность \(2\)/);
    });
```

with:

```javascript
    it('достоинство из Feature/merit Item возвращается записью массива meritsFlaws', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      assert.ok(Array.isArray(sheetData.meritsFlaws));
      const mf = sheetData.meritsFlaws.find(x => x.name === 'Внушительный тип');
      assert.ok(mf, 'ожидалась запись «Внушительный тип»');
      assert.equal(mf.points, 1);
      assert.equal(mf.kind, 'merit');
    });
    it('недостаток из Feature/flaw Item возвращается с kind: flaw', () => {
      const actor2 = { ...ACTOR, items: [...ACTOR.items, { name: 'Запах могилы', type: 'Feature', system: { type: 'wod.types.flaw', level: 1, value: 0 } }] };
      const { sheetData } = mapFoundryActorToSheetData(actor2, EXISTING_SHEET);
      const flaw = sheetData.meritsFlaws.find(x => x.name === 'Запах могилы');
      assert.ok(flaw, 'ожидался «Запах могилы»');
      assert.equal(flaw.kind, 'flaw');
      assert.equal(flaw.points, 1);
    });
    it('несовпавший текст из system.notes добавляется отдельными записями массива', () => {
      const actor2 = { ...ACTOR, system: { ...ACTOR.system, notes: 'Придуманная особенность (2)' } };
      const { sheetData } = mapFoundryActorToSheetData(actor2, EXISTING_SHEET);
      const known = sheetData.meritsFlaws.find(x => x.name === 'Внушительный тип');
      assert.ok(known);
      const custom = sheetData.meritsFlaws.find(x => x.name === 'Придуманная особенность');
      assert.ok(custom, 'ожидалась запись из notes');
      assert.equal(custom.points, 2);
      assert.equal(custom.kind, 'merit');
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm run test:unit`
Expected: FAIL — `mapFoundryActorToSheetData` still returns `meritsFlaws` as a string
(`assert.ok(Array.isArray(...))` fails).

- [ ] **Step 3: Implement the array output in `mapFoundryActorToSheetData`**

In `web/lib/foundry-import.js`, replace lines 62-70:

```javascript
  // Достоинства/недостатки (Feature-Item с system.type merit/flaw, экспортированные
  // через foundry-merits.js) возвращаются строками «Имя (очки)»; остаток свободного
  // текста из system.notes (несовпавшие с библиотекой строки) добавляется следом —
  // см. web/lib/foundry-export.js.
  const meritFlawLines = items
    .filter(i => i.type === 'Feature' && (i.system?.type === 'wod.types.merit' || i.system?.type === 'wod.types.flaw'))
    .map(i => `${i.name} (${Number(i.system?.level) || 0})`);
  const noteLines = String(sys.notes || '').split('\n').map(s => s.trim()).filter(Boolean);
  const meritsFlawsText = [...meritFlawLines, ...noteLines].join('\n');
```

with:

```javascript
  // Достоинства/недостатки (Feature-Item с system.type merit/flaw) → массив [{name,points,kind}].
  // Несовпавший свободный текст из system.notes добавляется отдельными записями: очки — из
  // суффикса «(N)», если есть, иначе 0; kind — 'merit' по умолчанию (notes не хранит тип).
  const meritFlawEntries = items
    .filter(i => i.type === 'Feature' && (i.system?.type === 'wod.types.merit' || i.system?.type === 'wod.types.flaw'))
    .map(i => ({ name: i.name, points: Number(i.system?.level) || 0, kind: i.system.type === 'wod.types.flaw' ? 'flaw' : 'merit' }));
  const noteEntries = String(sys.notes || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const pm = line.match(/\((\d+)\)\s*$/);
    const points = pm ? parseInt(pm[1], 10) : 0;
    const name = line.replace(/\s*\(\d+\)\s*$/, '').trim();
    return { name, points, kind: 'merit' };
  });
  const meritsFlawsOut = [...meritFlawEntries, ...noteEntries];
```

Then replace line 118:

```javascript
    meritsFlaws: meritsFlawsText || base.meritsFlaws || '',
```

with:

```javascript
    meritsFlaws: meritsFlawsOut.length ? meritsFlawsOut : (Array.isArray(base.meritsFlaws) ? base.meritsFlaws : []),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: All 3 tests (2 replaced + 1 new flaw test) PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/foundry-import.js web/tests/all.test.js
git commit -m "feat: import meritsFlaws as structured array (name/points/kind)"
```

---

## Task 4: Client-side model — default, migration, AI-markdown parsing

**Files:**
- Modify: `web/public/scripts.js:6307` (`_v20Empty`), `~6472` (`_v20Normalize`), `~6560-6565`
  (`_v20ParseMd`, insert after the Virtues block)

No test file — this is DOM-dependent client code with no `node:test` coverage (matches the
existing pattern for all other `_v20*` sheet functions). Verified manually in Task 7.

- [ ] **Step 1: Change the default in `_v20Empty()`**

In `web/public/scripts.js`, replace line 6307:

```javascript
    meritsFlaws: '',
```

with:

```javascript
    // meritsFlaws — массив [{name,points,kind:'merit'|'flaw'}], без строк по умолчанию (тот же
    // паттерн, что у disciplines/backgrounds/otherTraits/rituals — см. комментарий выше).
    meritsFlaws: [],
```

- [ ] **Step 2: Add the pad/trim helper for the new shape**

Right after the existing `_v20PadSlots` function (find via
`grep -n "^function _v20PadSlots" web/public/scripts.js`, insert right after its closing `}`,
before the `_v20TrimTrailingEmpty` comment):

```javascript
// Та же логика, что у _v20PadSlots, но с полями {name,points,kind} вместо {name,val} — Очки
// достоинств/недостатков не ограничены 0–5 (в библиотеке встречаются costs до 7), kind по
// умолчанию 'merit'.
function _v20PadMeritsFlaws(arr, n) {
  const len = Math.max(n, Array.isArray(arr) ? arr.length : 0);
  const out = Array.from({ length: len }, () => ({ name: '', points: 0, kind: 'merit' }));
  if (Array.isArray(arr)) arr.forEach((x, i) => {
    out[i] = { name: String(x?.name || ''), points: Math.max(0, _num(x?.points, 0)), kind: x?.kind === 'flaw' ? 'flaw' : 'merit' };
  });
  return out;
}
```

- [ ] **Step 3: Add `meritsFlaws: 0` to `_V20_BASELINE_LEN`**

Replace:

```javascript
const _V20_BASELINE_LEN = { disciplines: 0, psychicPowers: 0, backgrounds: 0, otherTraits: 0, rituals: 0 };
```

with:

```javascript
const _V20_BASELINE_LEN = { disciplines: 0, psychicPowers: 0, backgrounds: 0, otherTraits: 0, rituals: 0, meritsFlaws: 0 };
```

- [ ] **Step 4: Add a `meritsFlaws` branch in `_v20AddRow()`**

Replace:

```javascript
function _v20AddRow(section, group) {
  const m = _v20Model;
  if (section === 'abilities') {
    m.abilities[group].push({ name: '', val: 0 });
  } else if (section === 'rituals') {
    m.rituals.push({ name: '', level: '' });
  } else {
    m[section].push({ name: '', val: 0 });
  }
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}
```

with:

```javascript
function _v20AddRow(section, group) {
  const m = _v20Model;
  if (section === 'abilities') {
    m.abilities[group].push({ name: '', val: 0 });
  } else if (section === 'rituals') {
    m.rituals.push({ name: '', level: '' });
  } else if (section === 'meritsFlaws') {
    m.meritsFlaws.push({ name: '', points: 0, kind: 'merit' });
  } else {
    m[section].push({ name: '', val: 0 });
  }
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}
```

- [ ] **Step 5: Add the client-side auto-migration helper**

Right after `_v20PadMeritsFlaws` (added in Step 2), add:

```javascript
// «Внушительный тип (1 очко)» / «- Внушительный тип» / «Внушительный тип — 1» → имя для поиска
// в библиотеке (портировано из web/lib/foundry-merits.js: _extractName — та же логика на клиенте,
// т.к. сервер и браузер не делят JS-модули в этом проекте).
function _v20ExtractMeritFlawName(line) {
  return String(line || '')
    .replace(/^[-•*]\s*/, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[—-]\s*\d+\s*(очк\w*)?\s*$/i, '')
    .trim();
}

// Старый формат meritsFlaws — строка (по строке на пункт). Разбирает её в массив
// [{name,points,kind}]: имя ищет в объединённом справочнике (см. _v20LoadLibrary('meritflaw')) —
// если нашли, points/kind берутся оттуда; если нет (кастомная строка) — points из «(N)» в конце
// строки (0, если нет числа), kind по умолчанию 'merit' (старый формат тип вообще не хранил —
// это не регресс, а более полная информация, чем было; GM видит переключатель на каждой строке
// и может поправить руками).
async function _v20MigrateMeritsFlawsString(text) {
  const lib = await _v20LoadLibrary('meritflaw');
  const index = new Map();
  for (const item of lib) index.set(String(item.name || '').toLowerCase().trim(), item);

  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const name = _v20ExtractMeritFlawName(line);
    const hit = index.get(name.toLowerCase().trim());
    if (hit) {
      out.push({ name: hit.name, points: Number(hit.points) || 0, kind: hit._kind === 'flaw' ? 'flaw' : 'merit' });
    } else {
      const pm = line.match(/\((\d+)/);
      out.push({ name, points: pm ? parseInt(pm[1], 10) : 0, kind: 'merit' });
    }
  }
  return out;
}
```

- [ ] **Step 6: Wire the migration + trim/pad into `_v20Normalize()`**

Replace line 6472:

```javascript
  if (typeof m.meritsFlaws === 'string') e.meritsFlaws = m.meritsFlaws;
```

with:

```javascript
  // meritsFlaws: string → array (старый формат листа, ещё не открытый в браузере после этого
  // обновления). _v20Normalize не может быть async (вызывается синхронно из рендера), поэтому
  // миграция запускается в фоне: временно оставляем массив пустым, а как только промис
  // разрешится — заново нормализуем и перерисовываем лист (тот же приём, что уже применяется
  // для библиотек дисциплин/нумина — см. _v20LoadLibrary).
  if (typeof m.meritsFlaws === 'string') {
    const rawString = m.meritsFlaws;
    e.meritsFlaws = [];
    _v20MigrateMeritsFlawsString(rawString).then(arr => {
      if (_v20Model === e) { _v20Model.meritsFlaws = _v20TrimTrailingEmpty(_v20PadMeritsFlaws(arr, 0)); _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx?.name); }
    });
  } else {
    e.meritsFlaws = _v20TrimTrailingEmpty(_v20PadMeritsFlaws(m.meritsFlaws, 0));
  }
```

- [ ] **Step 7: Add AI-markdown table parsing to `_v20ParseMd()`**

Right after the Virtues block (find via `grep -n "// Virtues" web/public/scripts.js`, insert the
new block right after that `for` loop's closing `}`, before the `// Derived` comment):

```javascript
  // Достоинства и недостатки (Название | Тип | Очки, 3 колонки) — единственная markdown-таблица
  // в секции «⚠️ Слабости, изъяны, деранжементы» (остальное там — проза: «Клановая слабость:»,
  // «Изъян (Flaw):», список деранжементов — не таблицы, в rows не попадают). kind — по слову
  // «недостат» в колонке «Тип» (регистронезависимо), иначе 'merit'.
  const mf = rows.filter(r => /слабост/.test(r.sec) && r.cells.length === 3 && r.cells[0].trim() && r.cells[2].trim());
  mf.forEach(r => {
    const kind = /недостат/i.test(r.cells[1] || '') ? 'flaw' : 'merit';
    const points = parseInt((r.cells[2] || '').replace(/\D/g, ''), 10);
    m.meritsFlaws.push({ name: r.name.replace(/\*\*/g, '').trim(), points: Number.isFinite(points) ? points : 0, kind });
  });
```

- [ ] **Step 8: Commit**

```bash
git add web/public/scripts.js
git commit -m "feat: meritsFlaws model — array shape, client-side migration, AI-markdown parsing"
```

---

## Task 5: Client-side UI — library picker + row rendering

**Files:**
- Modify: `web/public/scripts.js` (library picker helpers, sheet render)
- Modify: `web/public/styles.css` (two small classes)

> Per `CLAUDE.md` ("Веб-интерфейс"): run `/code-review` before touching `scripts.js`/`styles.css`,
> re-run the impeccable design-system check after.

- [ ] **Step 1: Run `/code-review` before making changes**

Invoke the `/code-review` skill/command now, before editing `scripts.js`/`styles.css`, per the
project rule.

- [ ] **Step 2: Extend `_v20LibraryCache` and `_v20LoadLibrary()`**

Replace:

```javascript
let _v20LibraryCache = { discipline: null, numina: null };
```

with:

```javascript
let _v20LibraryCache = { discipline: null, numina: null, meritflaw: null };
```

Replace the body of `_v20LoadLibrary`:

```javascript
async function _v20LoadLibrary(kind) {
  if (_v20LibraryCache[kind]) return _v20LibraryCache[kind];
  try {
    const endpoint = kind === 'discipline' ? '/api/library/disciplines' : '/api/library/psychics';
    const data = await fetch(endpoint).then(r => r.json());
    _v20LibraryCache[kind] = Array.isArray(data) ? data : [];
  } catch { _v20LibraryCache[kind] = []; }
  return _v20LibraryCache[kind];
}
```

with:

```javascript
async function _v20LoadLibrary(kind) {
  if (_v20LibraryCache[kind]) return _v20LibraryCache[kind];
  try {
    if (kind === 'meritflaw') {
      const [merits, flaws] = await Promise.all([
        fetch('/api/library/merits').then(r => r.json()),
        fetch('/api/library/flaws').then(r => r.json()),
      ]);
      const tag = (list, k) => (Array.isArray(list) ? list : []).map(x => ({ ...x, _kind: k }));
      _v20LibraryCache[kind] = [...tag(merits, 'merit'), ...tag(flaws, 'flaw')];
    } else {
      const endpoint = kind === 'discipline' ? '/api/library/disciplines' : '/api/library/psychics';
      const data = await fetch(endpoint).then(r => r.json());
      _v20LibraryCache[kind] = Array.isArray(data) ? data : [];
    }
  } catch { _v20LibraryCache[kind] = []; }
  return _v20LibraryCache[kind];
}
```

- [ ] **Step 3: Extend `_v20LibPickerKindToSection()`**

Replace:

```javascript
function _v20LibPickerKindToSection(kind) {
  return kind === 'discipline' ? 'disciplines' : 'psychicPowers';
}
```

with:

```javascript
function _v20LibPickerKindToSection(kind) {
  if (kind === 'discipline') return 'disciplines';
  if (kind === 'meritflaw') return 'meritsFlaws';
  return 'psychicPowers';
}
```

- [ ] **Step 4: Extend `_v20RenderV20LibList()` with a merit/flaw-specific hint**

Replace:

```javascript
function _v20RenderV20LibList(kind, lib, pickerEl) {
  const listEl = pickerEl.querySelector('.v20-lib-list');
  if (!listEl) return;
  listEl.innerHTML = (lib || []).map(item => {
    const name = item.name || item.ru || '';
    const hint = (item.levels || []).length ? `${(item.levels || []).length} уровней` : '';
    return `<button type="button" class="v20-lib-item" data-v20-lib-item="${escAttr(name)}" data-v20-lib-kind="${kind}"><span>${escHtml(name)}</span><span class="v20-lib-hint">${escHtml(hint)}</span></button>`;
  }).join('');
}
```

with:

```javascript
function _v20RenderV20LibList(kind, lib, pickerEl) {
  const listEl = pickerEl.querySelector('.v20-lib-list');
  if (!listEl) return;
  listEl.innerHTML = (lib || []).map(item => {
    const name = item.name || item.ru || '';
    const hint = kind === 'meritflaw'
      ? `${item._kind === 'flaw' ? 'Недостаток' : 'Достоинство'} · ${item.category || ''} · ${item.points ?? 0} очк.`
      : ((item.levels || []).length ? `${(item.levels || []).length} уровней` : '');
    return `<button type="button" class="v20-lib-item" data-v20-lib-item="${escAttr(name)}" data-v20-lib-kind="${kind}"><span>${escHtml(name)}</span><span class="v20-lib-hint">${escHtml(hint)}</span></button>`;
  }).join('');
}
```

- [ ] **Step 5: Extend `_v20AddLibraryItem()` with the meritflaw path**

Replace:

```javascript
function _v20AddLibraryItem(kind, name) {
  const section = _v20LibPickerKindToSection(kind);
  const m = _v20Model;
  if (!m[section]) return;

  // Заполнить первую уже существующую пустую строку (оставшуюся от ИИ-листа или от «+
  // Добавить»), а не всегда плодить новую — иначе клик по «+ Из справочника» добавлял 7-ю
  // строку, даже если впереди были пустые.
  const emptySlot = m[section].find(x => !String(x?.name || '').trim());
  if (emptySlot) { emptySlot.name = name; emptySlot.val = 1; }
  else m[section].push({ name, val: 1 });

  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}
```

with:

```javascript
function _v20AddLibraryItem(kind, name) {
  const section = _v20LibPickerKindToSection(kind);
  const m = _v20Model;
  if (!m[section]) return;

  if (kind === 'meritflaw') {
    // Достоинства/недостатки хранят points+kind из библиотеки, не дот-значение «1», в отличие
    // от дисциплин/нумина ниже — берём их из закешированного списка пикера по имени.
    const lib = _v20LibraryCache.meritflaw || [];
    const found = lib.find(x => (x.name || '') === name);
    const points = found ? Number(found.points) || 0 : 0;
    const mfKind = found?._kind === 'flaw' ? 'flaw' : 'merit';
    const emptySlot = m.meritsFlaws.find(x => !String(x?.name || '').trim());
    if (emptySlot) { emptySlot.name = name; emptySlot.points = points; emptySlot.kind = mfKind; }
    else m.meritsFlaws.push({ name, points, kind: mfKind });
    _v20MarkDirty();
    _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
    return;
  }

  // Заполнить первую уже существующую пустую строку (оставшуюся от ИИ-листа или от «+
  // Добавить»), а не всегда плодить новую — иначе клик по «+ Из справочника» добавлял 7-ю
  // строку, даже если впереди были пустые.
  const emptySlot = m[section].find(x => !String(x?.name || '').trim());
  if (emptySlot) { emptySlot.name = name; emptySlot.val = 1; }
  else m[section].push({ name, val: 1 });

  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}
```

- [ ] **Step 6: Replace the meritsFlaws textarea with structured rows**

In `_v20RenderSheet`, replace:

```javascript
        <div class="v20-col-title">Достоинства и недостатки</div>
        <textarea class="v20-textarea" data-tpath="meritsFlaws" rows="6" placeholder="По строке на пункт…">${escHtml(m.meritsFlaws)}</textarea>
```

with:

```javascript
        <div class="v20-col-title">Достоинства и недостатки${mfLibBtn}${_v20AddRowBtn('meritsFlaws')}</div>
        <div class="v20-lib-picker" data-v20-lib-kind="meritflaw" hidden>
          <input type="text" class="v20-lib-search" placeholder="Поиск…" data-v20-lib-kind="meritflaw">
          <div class="v20-lib-list" data-v20-lib-kind="meritflaw"></div>
        </div>
        ${mfRows}
```

Add the two new local variables (`mfLibBtn`, `mfRows`) right before the `bottom` template literal
that contains the block just edited (find via `grep -n "const bottom = " web/public/scripts.js`,
insert right before that line):

```javascript
  const mfLibBtn = `<button type="button" class="v20-mini-action v20-lib-add-btn" data-v20-lib-kind="meritflaw" title="Добавить из справочника достоинств/недостатков">+ Из справочника</button>`;
  const mfRows = m.meritsFlaws.map((mf, i) => {
    const rm = `<button type="button" class="v20-row-remove-btn" data-v20-remove="meritsFlaws" data-v20-remove-idx="${i}" title="Удалить строку">×</button>`;
    return `<div class="v20-row v20-named v20-mf-row">${rm}
      <input class="v20-line-input" data-tpath="meritsFlaws.${i}.name" value="${escAttr(mf.name)}" placeholder="Название">
      <select class="v20-mf-kind" data-tpath="meritsFlaws.${i}.kind">
        <option value="merit"${mf.kind !== 'flaw' ? ' selected' : ''}>Достоинство</option>
        <option value="flaw"${mf.kind === 'flaw' ? ' selected' : ''}>Недостаток</option>
      </select>
      <input type="number" min="0" class="v20-mini-input" data-tpath="meritsFlaws.${i}.points" value="${escAttr(mf.points)}">
    </div>`;
  }).join('');
```

- [ ] **Step 7: Add the two new CSS classes**

In `web/public/styles.css`, right after the existing `.v20-row-remove-btn:hover { ... }` rule
(find via `grep -n "v20-row-remove-btn:hover" web/public/styles.css`, insert right after it):

```css
.v20-mf-kind {
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--f-body);
  font-size: var(--fs-sm);
  padding: 2px 4px;
  flex-shrink: 0;
}
```

- [ ] **Step 8: Run the full test suite (confirm nothing broke)**

Run: `cd web && npm run test:unit`
Expected: All tests still pass (this task touches no server-side code, purely client-side —
existing 315 tests should be unaffected).

- [ ] **Step 9: Manual verification in browser**

Follow the `run-sanguine-web` skill recipe:
1. Restart the dev server, launch headless Chrome, open a vampire character's sheet whose
   `meritsFlaws` is still the old string format (e.g. any character exported earlier in this
   project) — confirm via `Runtime.evaluate` that after a short delay `_v20Model.meritsFlaws` is
   an array with `{name, points, kind}` entries matching the original text.
2. Click «+ Из справочника» under «Достоинства и недостатки» — confirm the picker shows a merged
   list with hints like `Достоинство · mental · 1 очк.`.
3. Click a library entry — confirm it fills the first empty row with correct `name`/`points`/`kind`
   (verify `_v20Model.meritsFlaws` via `Runtime.evaluate`).
4. Click «+ Добавить» — confirm a blank editable row appears; click «✕» — confirm it's removed.

- [ ] **Step 10: Re-run `/code-review` (impeccable check) after the changes**

Per `CLAUDE.md`, re-run the impeccable design-system check on `scripts.js`/`styles.css` to confirm
no CSS-token/contrast/accessibility regressions.

- [ ] **Step 11: Commit**

```bash
git add web/public/scripts.js web/public/styles.css
git commit -m "feat: Достоинства/Недостатки — library picker UI (like Disciplines/Backgrounds)"
```

---

## Task 6: Rituals on the Mortal sheet

**Files:**
- Modify: `web/public/scripts.js` (two `isVamp` gates)
- Modify: `system/rules/character_sheet_mortal.md` (short note)

- [ ] **Step 1: Remove the vampire-only gate on the Rituals column**

In `_v20RenderSheet`, replace:

```javascript
    <div class="v20-band">Специализации · параметры${isVamp ? ' · ритуалы' : ''}</div>
    <div class="v20-grid3">
      <div class="v20-col"><div class="v20-col-title">Специализации</div>${specRows}</div>
      <div class="v20-col"><div class="v20-col-title">Другие параметры${_v20AddRowBtn('otherTraits')}</div>${otRows}</div>
      ${isVamp ? `<div class="v20-col"><div class="v20-col-title">Ритуалы${_v20AddRowBtn('rituals')}</div>${ritRows}</div>` : '<div class="v20-col"></div>'}
    </div>
```

with:

```javascript
    <div class="v20-band">Специализации · параметры${(isVamp || isMortal) ? ' · ритуалы' : ''}</div>
    <div class="v20-grid3">
      <div class="v20-col"><div class="v20-col-title">Специализации</div>${specRows}</div>
      <div class="v20-col"><div class="v20-col-title">Другие параметры${_v20AddRowBtn('otherTraits')}</div>${otRows}</div>
      ${(isVamp || isMortal) ? `<div class="v20-col"><div class="v20-col-title">Ритуалы${_v20AddRowBtn('rituals')}</div>${ritRows}</div>` : '<div class="v20-col"></div>'}
    </div>
```

(`isMortal` is already declared earlier in `_v20RenderSheet` — see the Психические способности
block — no new variable needed.)

- [ ] **Step 2: Add the houserule note to `character_sheet_mortal.md`**

In `system/rules/character_sheet_mortal.md`, right after the line ending «...можно поднять одну
способность до уровня, который покрывает ранг Достоинства.» (end of Шаг 8, before the `---` that
precedes «## 📋 Шаблон листа персонажа»), add:

```markdown

#### Ритуалы (опциональный хоумрул)

Раздел «Ритуалы» листа (Таумturgy/Некромантия в каноне V20 — механика сородичей) доступен и на
листе смертного в веб-интерфейсе Sanguine как **опциональная хоумрул-гибкость для конкретной
хроники** (например, смертный оккультист, изучивший ритуалы каким-то нестандартным путём) — не
канон базового V20 для смертных, добавляй только если это действительно нужно персонажу.
```

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npm run test:unit`
Expected: All tests pass (no server-side code touched).

- [ ] **Step 4: Manual verification in browser**

Follow the `run-sanguine-web` skill recipe: open a Mortal character's sheet, confirm the
«Ритуалы» column now appears (band label shows «· ритуалы», column has «+ Добавить» button).

- [ ] **Step 5: Commit**

```bash
git add web/public/scripts.js system/rules/character_sheet_mortal.md
git commit -m "feat: show Ритуалы column on Mortal sheets (optional houserule)"
```

---

## Task 7: Final verification and cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd web && npm run test:unit`
Expected: All tests pass (previous count + all new tests from Tasks 1-3), 0 failures.

- [ ] **Step 2: Check for incidental fixture changes**

Run: `git status --short` from the repo root. Per the established session pattern, test runs may
incidentally touch `cities/paris/archive/characters_index.md`,
`cities/paris/chronicles/*/events.md`, `cities/paris/chronicles/*/chronicle.md`, and
`web/tests/report.html` — regenerated timestamps/derived data, not real changes. Revert them:

```bash
git checkout -- cities/paris/archive/characters_index.md web/tests/report.html
# (add any other incidentally-touched chronicle files git status shows, following the same pattern)
```

- [ ] **Step 3: End-to-end manual verification**

Follow the `run-sanguine-web` skill recipe once more, covering the full flow on one character:
1. Open a character with an old string-format `meritsFlaws` sheet — confirm auto-migration
   produces correct array entries (matched library names get right points/kind, unmatched get
   `kind: 'merit'`).
2. Add one entry via the library picker, one via «+ Добавить» (edit its name/kind/points
   manually), remove one via «✕».
3. Save the sheet (`💾 Сохранено` button), reload the page, reopen the sheet — confirm the
   structured entries persisted correctly (this proves the array round-trips through
   `PUT /api/characters/:slug/sheet-data`, which was already lineage/shape-agnostic before this
   change — no route code touched).
4. Confirm Rituals column shows on a Mortal sheet.

- [ ] **Step 4: Re-run the test suite once more to confirm a clean baseline**

Run: `cd web && npm run test:unit`
Expected: Same pass count as Step 1.

---

## Self-Review Notes

- **Spec coverage:** Part 1 (data model + client migration) → Task 4. Part 2 (UI) → Task 5.
  Part 3 (AI-markdown parsing) → Task 4 Step 7. Part 4 (Foundry sync) → Tasks 2-3. Part 5
  (Rituals for Mortal) → Task 6. Testing section → folded into each task's TDD steps + Task 7's
  manual end-to-end pass. "Вне рамок" section — nothing in this plan adds lineage/clan validation,
  changes the markdown table format itself, or batch-migrates `-sheet.json` files on disk.
- **Placeholder scan:** no TBD/TODO; every step has concrete code or an exact command.
- **Type consistency:** `{name, points, kind}` shape is identical across
  `_v20PadMeritsFlaws`/`_v20MigrateMeritsFlawsString`/`_v20AddLibraryItem`/`_v20ParseMd` on the
  client and `mapCharacterToFoundryActor`/`mapFoundryActorToSheetData` on the server — `points` is
  always a number, `kind` is always `'merit'|'flaw'`, never any other string.
