# Foundry Sync — Mortal Support + Bulk Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing vampire-only Sanguine ⇄ Foundry VTT export/import to the Mortal
lineage, and add a selection-based bulk export (ZIP of per-character Foundry Actor JSON) on the
characters list page.

**Architecture:** Reuse the existing mapper files (`web/lib/foundry-export.js`,
`web/lib/foundry-import.js`) by branching on `char.lineage` instead of hardcoding `'Vampire'`.
Add one new lineage-agnostic Item type (`wod.types.othertraits`) to both mappers. Add a
dependency-free ZIP writer/reader (`web/lib/zip.js`) and a new bulk-export route that reuses the
per-character mapper. UI adds a two-click selection-mode flow on the characters list page,
mirroring the existing button-and-file-input pattern already used for the single-character
Foundry export/import.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`), Express, vanilla client-side JS
(`web/public/scripts.js`), no new npm dependencies.

---

## Scope check

Spec `docs/superpowers/specs/2026-07-08-foundry-mortal-support-design.md` covers one subsystem
(Mortal support in the existing Foundry-sync feature) plus one tightly-coupled UI addition (bulk
export, which only makes sense once more than one lineage is exportable). Not decomposing further.

## File Structure

- `web/lib/foundry-export.js` — modify: branch `type`/`system.settings`/vampire-only `system` keys
  on `char.lineage`; add `_otherTraitItems()`.
- `web/lib/foundry-import.js` — modify: add `wod.types.othertraits` reverse mapping.
- `web/lib/zip.js` — create: `createZip(files) → Buffer`, `readZip(buf) → files[]` (test-only
  round-trip helper), zero dependencies.
- `web/routes/characters.js` — modify: relax `export-foundry` lineage gate; add
  `POST /api/characters/export-foundry-bulk`.
- `web/public/scripts.js` — modify: Foundry button visibility gate (`isVamp || isMortal`); new
  bulk-export selection-mode state + handlers.
- `web/public/index.html` — modify: two new buttons on the characters-page toolbar.
- `web/public/styles.css` — modify: selection/disabled states for `.char-card` in bulk mode.
- `web/tests/all.test.js` — modify: new `describe` blocks for Mortal mapper round-trip,
  `web/lib/zip.js`, and the bulk-export route.

---

## Task 1: `foundry-export.js` — Mortal support + `othertraits`

**Files:**
- Modify: `web/lib/foundry-export.js`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing tests**

Add this fixture and `describe` block right after the existing `describe('foundry-export', ...)`
block closes (after line 677, before `describe('foundry-import', ...)`) in
`web/tests/all.test.js`:

```javascript
  describe('foundry-export — Mortal', () => {
    const { mapCharacterToFoundryActor } = require('../lib/foundry-export');

    const CHAR_MORTAL = { name: 'Тестовый Смертный', lineage: 'mortal' };
    const SHEET_MORTAL = {
      lineage: 'mortals',
      header: {
        name: 'Тестовый Смертный', player: '', chronicle: '', nature: 'Бунтарь (Rebel)',
        demeanor: 'Конформист (Conformist)', concept: 'Охранник', clan: '', generation: '', sire: '',
      },
      attributes: {
        physical: { strength: 3, dexterity: 4, stamina: 3, composure: 1, resolve: 1 },
        social:   { charisma: 2, manipulation: 3, appearance: 3 },
        mental:   { perception: 4, intelligence: 2, wits: 3 },
      },
      abilities: {
        talents: [
          { name: 'Бдительность', val: 3, fixed: true }, { name: 'Интрига', val: 2, fixed: false },
        ],
        skills: [{ name: 'Стрельба', val: 3, fixed: true }],
        knowledges: [{ name: 'Гуманитарные науки', val: 2, fixed: true }],
      },
      disciplines: [],
      backgrounds: [{ name: 'Контакты', val: 2 }],
      virtues: { conscience: 1, selfcontrol: 1, courage: 1 },
      meritsFlaws: '',
      humanity: 4, path: 'Человечность',
      willpower: { permanent: 4, temp: Array(10).fill(false).map((_, i) => i < 2) },
      otherTraits: [{ name: 'Dead-Eyes', val: 0 }],
      health: { bruised: false, hurt: false, injured: false, wounded: false, mauled: false, crippled: false, incapacitated: false },
      flaw: '',
    };

    it('type Mortal, без clan/sect/generation/generationmod/sire/bloodline/weakness/custom в system', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      assert.equal(a.type, 'Mortal');
      assert.equal(a.name, 'Тестовый Смертный');
      for (const key of ['clan', 'sect', 'generation', 'generationmod', 'sire', 'bloodline', 'weakness', 'custom']) {
        assert.ok(!(key in a.system), `system.${key} не должен существовать для Mortal`);
      }
    });
    it('advantages.bloodpool всё равно пишется (общий блок для всех линеек)', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      assert.ok('bloodpool' in a.system.advantages);
      assert.equal(a.system.advantages.bloodpool.temporary, 0);
    });
    it('settings.has* — mortal-пресет: haswillpower/haspath/hasvirtue true, hasbloodpool false', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      assert.equal(a.system.settings.haswillpower, true);
      assert.equal(a.system.settings.haspath, true);
      assert.equal(a.system.settings.hasvirtue, true);
      assert.equal(a.system.settings.hasbloodpool, false);
      assert.equal(a.system.settings.hasrage, false);
    });
    it('Человечность/Путь/Воля/Добродетели читаются как у вампира', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      assert.equal(a.system.advantages.path.permanent, 4);
      assert.equal(a.system.advantages.path.label, 'wod.advantages.path.humanity');
      assert.equal(a.system.advantages.willpower.permanent, 4);
      assert.equal(a.system.advantages.willpower.temporary, 2);
      assert.equal(a.system.advantages.virtues.conscience.permanent, 1);
    });
    it('Фон и кастомная способность экспортируются как у вампира', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      const bg = a.items.find(i => i.type === 'Feature' && i.system.type === 'wod.types.background');
      assert.ok(bg); assert.equal(bg.name, 'Контакты'); assert.equal(bg.system.level, 2);
      const trait = a.items.find(i => i.type === 'Trait' && i.system.type === 'wod.types.talentsecondability');
      assert.ok(trait); assert.equal(trait.name, 'Интрига');
    });
    it('otherTraits → embedded Item типа Trait/othertraits', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      const ot = a.items.find(i => i.type === 'Trait' && i.system.type === 'wod.types.othertraits');
      assert.ok(ot, 'ожидался Item «Dead-Eyes»');
      assert.equal(ot.name, 'Dead-Eyes');
      assert.equal(ot.system.value, 0);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm run test:unit`
Expected: FAIL — `assert.equal(a.type, 'Mortal')` fails (currently always `'Vampire'`), and the
`otherTraits` test fails (`_otherTraitItems` doesn't exist yet).

- [ ] **Step 3: Implement Mortal branching + `_otherTraitItems` in `foundry-export.js`**

Replace the whole `_traitItem`/`_disciplineItems` block area is untouched; add this new function
right after `_meritFlawItems` (after line 106, before the `HEALTH_LEVELS` comment):

```javascript
// «Прочие черты» — текстовые особенности без канонической категории (Item.type: "Trait",
// system.type: "wod.types.othertraits" — подтверждено на реальном Mortal Export Data,
// см. docs/superpowers/specs/2026-07-08-foundry-mortal-support-design.md, раздел 1).
// Лайнэдж-агностично: то же поле otherTraits существует в модели листа для вампиров тоже
// (страница 2 листа), просто раньше в мапперах этого типа Item не было вовсе.
function _otherTraitItems(otherTraits) {
  return (otherTraits || [])
    .filter(t => String(t?.name || '').trim())
    .map(t => ({
      name: t.name, type: 'Trait',
      system: { type: 'wod.types.othertraits', level: '0', value: Number(t.val) || 0, max: 0, isrollable: false },
    }));
}
```

Now replace the entire `mapCharacterToFoundryActor` function (lines 117–190) with:

```javascript
function mapCharacterToFoundryActor(char, sheetData) {
  const s = sheetData || {};
  const isVamp = char.lineage === 'vampire';

  const genNumber = isVamp ? (parseGenerationNumber(char.generation || s.header?.generation) || 13) : null;
  const bloodMax = isVamp ? bloodMaxForGeneration(genNumber) : null;

  const clanKey = isVamp ? clanRuToFoundryKey(char.clan || s.header?.clan) : null;
  const sectKey = isVamp ? sectRuToFoundryKey(char.sect) : null;

  const { abilities, customTraits } = _mapAbilities(s.abilities);
  const attrs = {
    strength: s.attributes?.physical?.strength, dexterity: s.attributes?.physical?.dexterity,
    stamina: s.attributes?.physical?.stamina, charisma: s.attributes?.social?.charisma,
    manipulation: s.attributes?.social?.manipulation, appearance: s.attributes?.social?.appearance,
    composure: s.attributes?.social?.composure, perception: s.attributes?.mental?.perception,
    intelligence: s.attributes?.mental?.intelligence, wits: s.attributes?.mental?.wits,
    resolve: s.attributes?.mental?.resolve,
  };
  const attributesOut = {};
  for (const [k, v] of Object.entries(attrs)) attributesOut[k] = { value: Number(v) || 0, max: 5 };

  const willpowerTemp = (s.willpower?.temp || []).filter(Boolean).length;
  const bloodTemp = bloodMax == null
    ? Number(s.bloodPoolCount) || 0
    : (s.bloodPool || []).filter(Boolean).length;

  const { matched: matchedMeritsFlaws, unmatched: unmatchedMeritsFlaws } = matchMeritsFlaws(s.meritsFlaws);

  const items = [
    ...customTraits.map(t => _traitItem(t.name, t.value, t.group)),
    ..._disciplineItems(s.disciplines),
    ..._backgroundItems(s.backgrounds),
    ..._meritFlawItems(matchedMeritsFlaws),
    ..._otherTraitItems(s.otherTraits),
  ];

  const settingsBase = {
    haswillpower: true,
    hasrage: false, hasgnosis: false, hasglamour: false, hasbanality: false,
    hasnightmare: false, hasconviction: false, hasfaith: false, hastorment: false,
    hasessence: false, hascorpus: false, haspathos: false, hasangst: false,
    hasvitality: false, hasspite: false, hasbalance: false, hassekhem: false,
    hasquintessence: false,
  };
  const settings = isVamp
    ? { ...settingsBase, haspath: true, hasbloodpool: true, hasvirtue: true }
    : { ...settingsBase, haspath: true, hasbloodpool: false, hasvirtue: true };

  // Клан/секта/поколение/сир/кровная линия/слабость/custom — только у вампира; для Mortal этих
  // ключей в system не должно быть вовсе (подтверждено на реальном Export Data, см. спеку).
  const vampireOnlySystem = isVamp ? {
    custom: { clan: clanKey ? '' : (char.clan || ''), sect: sectKey ? '' : (char.sect || '') },
    clan: clanKey ? `wod.bio.vampire.${clanKey}` : '',
    sect: sectKey ? `wod.bio.vampire.${sectKey}` : '',
    bloodline: '', weakness: s.flaw || '',
    generation: genNumber, generationmod: 0,
    sire: char.sire || s.header?.sire || '',
  } : {};

  return {
    name: char.name || s.header?.name || '',
    type: isVamp ? 'Vampire' : 'Mortal',
    system: {
      nature: s.header?.nature || '', demeanor: s.header?.demeanor || '',
      concept: s.header?.concept || '', background: '', notes: unmatchedMeritsFlaws.join('\n'),
      settings,
      attributes: attributesOut,
      abilities,
      advantages: {
        virtues: {
          conscience: { permanent: Number(s.virtues?.conscience) || 0, temporary: Number(s.virtues?.conscience) || 0, max: 5 },
          selfcontrol: { permanent: Number(s.virtues?.selfcontrol) || 0, temporary: Number(s.virtues?.selfcontrol) || 0, max: 5 },
          courage: { permanent: Number(s.virtues?.courage) || 0, temporary: Number(s.virtues?.courage) || 0, max: 5 },
        },
        willpower: { permanent: Number(s.willpower?.permanent) || 0, temporary: willpowerTemp, max: 10 },
        bloodpool: { temporary: bloodTemp, max: bloodMax ?? 30, perturn: Number(s.bloodPerTurn) || 1 },
        path: {
          permanent: Number(s.humanity) || 0, value: 0, max: 10, custom: '',
          label: s.path && _norm(s.path) !== 'человечность' ? '' : 'wod.advantages.path.humanity',
        },
      },
      health: { damage: _healthDamage(s.health) },
      ...vampireOnlySystem,
    },
    items,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: All tests in `foundry-export` and `foundry-export — Mortal` PASS (also re-check the
existing vampire tests still pass unchanged — `isVamp` branching must be a no-op for vampire).

- [ ] **Step 5: Commit**

```bash
git add web/lib/foundry-export.js web/tests/all.test.js
git commit -m "feat: Mortal support + othertraits Item type in foundry-export.js"
```

---

## Task 2: `foundry-import.js` — Mortal + `othertraits` reverse mapping

**Files:**
- Modify: `web/lib/foundry-import.js`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing test**

Add this fixture and test inside the existing `describe('foundry-import', ...)` block (after the
`ACTOR`/`EXISTING_SHEET` fixtures, e.g. right after line 716's `EXISTING_SHEET` declaration, and
the `it(...)` block itself anywhere among the other `it(...)` calls in that `describe`):

```javascript
    const ACTOR_MORTAL = {
      name: 'Тестовый Смертный', type: 'Mortal',
      system: {
        nature: 'Бунтарь', demeanor: 'Конформист', concept: 'Охранник', notes: '',
        attributes: {
          strength: { value: 3 }, dexterity: { value: 4 }, stamina: { value: 3 },
          charisma: { value: 2 }, manipulation: { value: 3 }, appearance: { value: 3 },
          composure: { value: 1 }, perception: { value: 4 }, intelligence: { value: 2 },
          wits: { value: 3 }, resolve: { value: 1 },
        },
        abilities: { alertness: { value: 3, type: 'talent' } },
        advantages: {
          virtues: { conscience: { permanent: 1 }, selfcontrol: { permanent: 1 }, courage: { permanent: 1 } },
          willpower: { permanent: 4, temporary: 2, max: 10 },
          bloodpool: { temporary: 0, max: 10, perturn: 1 },
          path: { permanent: 4, label: 'wod.advantages.path.humanity' },
        },
        health: { damage: { bashing: 0, lethal: 0, aggravated: 0 } },
      },
      items: [
        { name: 'Интрига', type: 'Trait', system: { type: 'wod.types.talentsecondability', value: 2 } },
        { name: 'Контакты', type: 'Feature', system: { type: 'wod.types.background', level: 2, value: 0 } },
        { name: 'Dead-Eyes', type: 'Trait', system: { type: 'wod.types.othertraits', value: 0 } },
      ],
    };
    const EXISTING_SHEET_MORTAL = { lineage: 'mortals', disciplines: [], otherTraits: [], abilities: { talents: [], skills: [], knowledges: [] } };

    it('Mortal: othertraits Item → sheetData.otherTraits', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR_MORTAL, EXISTING_SHEET_MORTAL);
      const ot = sheetData.otherTraits.find(t => t.name === 'Dead-Eyes');
      assert.ok(ot, 'ожидался otherTraits «Dead-Eyes»');
      assert.equal(ot.val, 0);
    });
    it('Mortal: clan/sect/generation остаются пустыми в cardFields (ключей нет в system)', () => {
      const { cardFields } = mapFoundryActorToSheetData(ACTOR_MORTAL, EXISTING_SHEET_MORTAL);
      assert.equal(cardFields.clan, '');
      assert.equal(cardFields.sect, '');
      assert.equal(cardFields.generation, '');
    });
    it('Mortal: Человечность/Путь/Воля/Фон/кастомная способность читаются как у вампира', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR_MORTAL, EXISTING_SHEET_MORTAL);
      assert.equal(sheetData.humanity, 4);
      assert.equal(sheetData.path, 'Человечность');
      assert.equal(sheetData.willpower.permanent, 4);
      const bg = sheetData.backgrounds.find(b => b.name === 'Контакты');
      assert.ok(bg); assert.equal(bg.val, 2);
      const trait = sheetData.abilities.talents.find(a => a.name === 'Интрига');
      assert.ok(trait); assert.equal(trait.val, 2);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test:unit`
Expected: FAIL — `sheetData.otherTraits` is `undefined` (field doesn't exist yet in the mapper
output).

- [ ] **Step 3: Implement `othertraits` reverse mapping in `foundry-import.js`**

Add this line right after the `backgrounds` declaration (after line 56):

```javascript
  const otherTraits = items
    .filter(i => i.type === 'Trait' && i.system?.type === 'wod.types.othertraits')
    .map(i => ({ name: i.name, val: Number(i.system?.value) || 0 }));
```

Add `otherTraits,` to the `sheetData` object literal, right after `backgrounds,` (line 107):

```javascript
    abilities,
    disciplines,
    backgrounds,
    otherTraits,
    virtues: {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: All `foundry-import` tests PASS, including the new Mortal ones.

- [ ] **Step 5: Commit**

```bash
git add web/lib/foundry-import.js web/tests/all.test.js
git commit -m "feat: othertraits reverse mapping in foundry-import.js (Mortal support)"
```

---

## Task 3: Single-character route gate + sheet UI button visibility

**Files:**
- Modify: `web/routes/characters.js:977`
- Modify: `web/public/scripts.js:7235, 7437-7439`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing route-tests `describe` block, right after the
`'GET unknown/export-foundry → 404'` test (after line 1289 in `web/tests/all.test.js`):

```javascript
    it('GET /:slug/export-foundry для смертного → 200, type Mortal', async () => {
      const mortal = chars.find(c => c.lineage === 'mortal');
      assert.ok(mortal, 'нужен хотя бы один смертный в фикстуре paris');
      const { status, body } = await apiJson(`/api/characters/${mortal.slug}/export-foundry${CITY}`);
      assert.equal(status, 200);
      assert.equal(body.type, 'Mortal');
    });
    it('GET /:slug/export-foundry для феи → 400 (пока не поддержано)', async () => {
      const fairy = chars.find(c => c.lineage === 'fairy');
      assert.ok(fairy, 'нужна хотя бы одна фея в фикстуре paris');
      const { status } = await apiJson(`/api/characters/${fairy.slug}/export-foundry${CITY}`);
      assert.equal(status, 400);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm run test:unit`
Expected: FAIL on the Mortal case — current gate returns 400 for `char.lineage !== 'vampire'`,
so a Mortal request gets rejected too.

- [ ] **Step 3: Relax the route gate**

In `web/routes/characters.js`, replace line 977:

```javascript
      if (char.lineage !== 'vampire') return res.status(400).json({ error: 'Экспорт в Foundry пока поддержан только для вампиров' });
```

with:

```javascript
      if (!['vampire', 'mortal'].includes(char.lineage)) return res.status(400).json({ error: 'Экспорт в Foundry пока поддержан только для вампиров и смертных' });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: Both new tests PASS.

- [ ] **Step 5: Update sheet-toolbar button visibility in `scripts.js`**

In `web/public/scripts.js`, inside `_v20RenderSheet` (starts at line 7233), change line 7235 from:

```javascript
  const isVamp = (m.lineage || '') === 'vampires';
```

to:

```javascript
  const isVamp = (m.lineage || '') === 'vampires';
  const isMortal = (m.lineage || '') === 'mortals';
```

Then change the button block (lines 7437-7439) from:

```javascript
      ${isVamp ? `
      <button class="cdet-sheet-btn" id="v20-foundry-export" title="Скачать JSON для импорта в Foundry VTT (Import Data)">🜏 Экспорт в Foundry</button>
      <button class="cdet-sheet-btn" id="v20-foundry-import" title="Загрузить JSON, полученный через Export Data в Foundry VTT">📥 Импорт из Foundry</button>` : ''}
```

to:

```javascript
      ${(isVamp || isMortal) ? `
      <button class="cdet-sheet-btn" id="v20-foundry-export" title="Скачать JSON для импорта в Foundry VTT (Import Data)">🜏 Экспорт в Foundry</button>
      <button class="cdet-sheet-btn" id="v20-foundry-import" title="Загрузить JSON, полученный через Export Data в Foundry VTT">📥 Импорт из Foundry</button>` : ''}
```

- [ ] **Step 6: Manual verification in browser**

Follow the `run-sanguine-web` skill recipe: restart the dev server
(`curl -s -X POST http://localhost:4295/api/restart`), launch headless Chrome, open a Mortal
character's sheet tab, and confirm via `Runtime.evaluate` that
`document.getElementById('v20-foundry-export')` is non-null. Then confirm the same for a Fairy
character that it IS null (button correctly absent).

- [ ] **Step 7: Commit**

```bash
git add web/routes/characters.js web/public/scripts.js web/tests/all.test.js
git commit -m "feat: allow Mortal export-foundry (route gate + sheet toolbar button)"
```

---

## Task 4: `web/lib/zip.js` — dependency-free ZIP writer/reader

**Files:**
- Create: `web/lib/zip.js`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block in `web/tests/all.test.js`, right after the `describe('foundry-merits', ...)`
block (find it via `grep -n "describe('foundry-merits'" web/tests/all.test.js` and insert after
its closing `});`):

```javascript
  describe('zip (createZip/readZip)', () => {
    const { createZip, readZip } = require('../lib/zip');

    it('round-trip: 3 файла, имена и содержимое совпадают байт-в-байт', () => {
      const files = [
        { name: 'foundry_alen.json', data: JSON.stringify({ name: 'Ален', n: 1 }) },
        { name: 'foundry_gerson.json', data: JSON.stringify({ name: 'Герсон', n: 2 }) },
        { name: 'foundry_verene.json', data: Buffer.from(JSON.stringify({ name: 'Верене', n: 3 }), 'utf-8') },
      ];
      const zipBuf = createZip(files);
      assert.ok(Buffer.isBuffer(zipBuf));
      const out = readZip(zipBuf);
      assert.equal(out.length, 3);
      for (const f of files) {
        const match = out.find(o => o.name === f.name);
        assert.ok(match, `ожидался файл ${f.name} в архиве`);
        const expected = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf-8');
        assert.equal(match.data.toString('utf-8'), expected.toString('utf-8'));
      }
    });
    it('пустой список файлов → валидный (пустой) ZIP', () => {
      const zipBuf = createZip([]);
      const out = readZip(zipBuf);
      assert.equal(out.length, 0);
    });
    it('кириллица и юникод в содержимом переживают round-trip', () => {
      const content = 'Тестовый Смертный — Охранник 🧑';
      const zipBuf = createZip([{ name: 'test.json', data: content }]);
      const out = readZip(zipBuf);
      assert.equal(out[0].data.toString('utf-8'), content);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test:unit`
Expected: FAIL with `Cannot find module '../lib/zip'`.

- [ ] **Step 3: Implement `web/lib/zip.js`**

```javascript
'use strict';
// Zero-dependency ZIP writer/reader — store method only (no compression). Enough to
// bundle several foundry_<slug>.json files into one downloadable archive for the bulk
// Foundry export; readZip exists so tests (and only tests) can round-trip without a
// system unzip tool or an external npm package.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _dosDateTime(date) {
  const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
  const day  = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
  return { time, day };
}

function createZip(files) {
  const { time: dosTime, day: dosDate } = _dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
    const crc = crc32(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const centralDirOffset = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

// Test-only helper — parses a ZIP produced by createZip() (comment field always empty,
// so the End Of Central Directory record is exactly the last 22 bytes).
function readZip(buf) {
  const eocdOffset = buf.length - 22;
  if (buf.readUInt32LE(eocdOffset) !== 0x06054b50) throw new Error('EOCD not found — не ZIP или повреждён');
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const files = [];
  let ptr = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('central directory record повреждён');
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf-8', ptr + 46, ptr + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    files.push({ name, data: Buffer.from(buf.subarray(dataStart, dataStart + compSize)) });

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

module.exports = { createZip, readZip };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: All 3 `zip (createZip/readZip)` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/zip.js web/tests/all.test.js
git commit -m "feat: dependency-free ZIP writer/reader (web/lib/zip.js)"
```

---

## Task 5: Bulk export route

**Files:**
- Modify: `web/routes/characters.js`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Write the failing tests**

Add this test block right after the `'POST /:slug/import-foundry без actor → 400'` test (after
line 1325 in `web/tests/all.test.js`, still inside the same route-tests `describe`). It needs
`const { readZip } = require('../lib/zip');` — add that require near the top of the file, next to
the other `require('../lib/...)` calls used only inside tests (or inline at the top of this test
block, following the existing pattern of scoping mapper requires to their `describe`).

```javascript
    describe('POST /api/characters/export-foundry-bulk', () => {
      const { readZip } = require('../lib/zip');

      it('happy path: вампир + смертный → ZIP с двумя foundry_<slug>.json', async () => {
        const vampire = chars.find(c => c.lineage === 'vampire' && c.hasSheet);
        const mortal = chars.find(c => c.lineage === 'mortal');
        assert.ok(vampire && mortal, 'нужны вампир (с листом) и смертный в фикстуре paris');

        const mortalSheetPath = path.join(CITY_ROOT, 'characters', mortal.lineageFolder, mortal.slug, `${mortal.slug}-sheet.json`);
        const hadMortalSheet = await fs.access(mortalSheetPath).then(() => true).catch(() => false);
        const originalMortalSheet = hadMortalSheet ? await fs.readFile(mortalSheetPath, 'utf-8') : null;
        if (!hadMortalSheet) {
          await fs.writeFile(mortalSheetPath, JSON.stringify({ lineage: 'mortals', header: { name: mortal.name } }, null, 2), 'utf-8');
        }

        try {
          const res = await fetch(BASE + `/api/characters/export-foundry-bulk${CITY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slugs: [vampire.slug, mortal.slug] }),
          });
          assert.equal(res.status, 200);
          assert.equal(res.headers.get('content-type'), 'application/zip');
          assert.match(res.headers.get('content-disposition') || '', /attachment;.*foundry_export_.*\.zip/);
          const buf = Buffer.from(await res.arrayBuffer());
          const files = readZip(buf);
          assert.equal(files.length, 2);
          const vampireEntry = files.find(f => f.name === `foundry_${vampire.slug}.json`);
          const mortalEntry = files.find(f => f.name === `foundry_${mortal.slug}.json`);
          assert.ok(vampireEntry); assert.ok(mortalEntry);
          assert.equal(JSON.parse(vampireEntry.data.toString('utf-8')).type, 'Vampire');
          assert.equal(JSON.parse(mortalEntry.data.toString('utf-8')).type, 'Mortal');
        } finally {
          if (hadMortalSheet) await fs.writeFile(mortalSheetPath, originalMortalSheet, 'utf-8');
          else await fs.unlink(mortalSheetPath).catch(() => {});
        }
      });

      it('пустой список slugs → 400', async () => {
        const { status } = await apiJson(`/api/characters/export-foundry-bulk${CITY}`, {
          method: 'POST', body: JSON.stringify({ slugs: [] }),
        });
        assert.equal(status, 400);
      });

      it('только неподдерживаемые линейки → 400', async () => {
        const fairy = chars.find(c => c.lineage === 'fairy');
        assert.ok(fairy, 'нужна хотя бы одна фея в фикстуре paris');
        const { status } = await apiJson(`/api/characters/export-foundry-bulk${CITY}`, {
          method: 'POST', body: JSON.stringify({ slugs: [fairy.slug] }),
        });
        assert.equal(status, 400);
      });

      it('смешанный список: неподдерживаемые тихо пропускаются, ZIP содержит только поддержанные', async () => {
        const vampire = chars.find(c => c.lineage === 'vampire' && c.hasSheet);
        const fairy = chars.find(c => c.lineage === 'fairy');
        const res = await fetch(BASE + `/api/characters/export-foundry-bulk${CITY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs: [vampire.slug, fairy.slug] }),
        });
        assert.equal(res.status, 200);
        const buf = Buffer.from(await res.arrayBuffer());
        const files = readZip(buf);
        assert.equal(files.length, 1);
        assert.equal(files[0].name, `foundry_${vampire.slug}.json`);
      });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm run test:unit`
Expected: FAIL with 404 (route doesn't exist yet).

- [ ] **Step 3: Implement the route**

In `web/routes/characters.js`, add `const { createZip } = require('../lib/zip');` next to the
other requires near the top (after line 23, `const { mapFoundryActorToSheetData } = ...`):

```javascript
const { createZip } = require('../lib/zip');
```

Add the new route right after the existing `GET /api/characters/:slug/export-foundry` route
(after its closing `});`, before the `POST /api/characters/:slug/import-foundry` route):

```javascript
  router.post('/api/characters/export-foundry-bulk', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const city = reqCity(req);
      const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs : [];
      if (!slugs.length) return res.status(400).json({ error: 'Не выбрано ни одного персонажа' });

      const chars = await getAllCharacters(city);
      const files = [];
      for (const slug of slugs) {
        const char = chars.find(c => c.slug === slug);
        if (!char || !['vampire', 'mortal'].includes(char.lineage)) continue;
        const dir = path.join(charsDir(city), char.lineageFolder, char.slug);
        const raw = await fs.readFile(path.join(dir, `${char.slug}-sheet.json`), 'utf-8').catch(() => null);
        const sheetData = raw ? JSON.parse(raw) : {};
        const actor = mapCharacterToFoundryActor(char, sheetData);
        files.push({ name: `foundry_${char.slug}.json`, data: JSON.stringify(actor, null, 2) });
      }
      if (!files.length) return res.status(400).json({ error: 'Ни один из выбранных персонажей не поддержан (только вампиры и смертные)' });

      const zipBuf = createZip(files);
      const dateStamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="foundry_export_${city}_${dateStamp}.zip"`);
      res.send(zipBuf);
    } catch (e) { serverError(res, e); }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm run test:unit`
Expected: All 4 new tests PASS. Also re-run the full suite to confirm nothing else broke:
`cd web && npm run test:unit` (full output, expect the previously-passing count plus these new
ones, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add web/routes/characters.js web/tests/all.test.js
git commit -m "feat: POST /api/characters/export-foundry-bulk (ZIP of per-character Foundry Actor JSON)"
```

---

## Task 6: Bulk export UI (selection mode)

**Files:**
- Modify: `web/public/index.html`
- Modify: `web/public/scripts.js`
- Modify: `web/public/styles.css`

> Per `CLAUDE.md` ("Веб-интерфейс"): run `/code-review` before touching these three files, and
> re-run the impeccable design-system check after, to confirm no CSS-token/contrast/accessibility
> regressions.

- [ ] **Step 1: Run `/code-review` before making changes**

Invoke the `/code-review` skill/command now, before editing `index.html`/`scripts.js`/`styles.css`,
per the project rule.

- [ ] **Step 2: Add the two new toolbar buttons in `index.html`**

In `web/public/index.html`, replace lines 149-152:

```html
        <a class="chr-modal-btn" id="btn-export-chars" href="#" style="padding:5px 12px;font-size:var(--fs-sm)">⇩ Экспорт</a>
        <a class="chr-modal-btn" id="btn-import-chars" href="#" style="padding:5px 12px;font-size:var(--fs-sm)">⇧ Импорт</a>
        <input type="file" id="import-chars-file" accept="application/json,.json" style="display:none">
        <input type="file" id="import-foundry-file" accept="application/json,.json" style="display:none">
```

with:

```html
        <a class="chr-modal-btn" id="btn-export-chars" href="#" style="padding:5px 12px;font-size:var(--fs-sm)">⇩ Экспорт</a>
        <a class="chr-modal-btn" id="btn-import-chars" href="#" style="padding:5px 12px;font-size:var(--fs-sm)">⇧ Импорт</a>
        <button class="chr-modal-btn" id="btn-export-foundry-bulk" style="padding:5px 12px;font-size:var(--fs-sm)">🜏 Экспорт в Foundry</button>
        <button class="chr-modal-btn cancel" id="btn-export-foundry-cancel" style="padding:5px 12px;font-size:var(--fs-sm);display:none">✕ Отмена</button>
        <input type="file" id="import-chars-file" accept="application/json,.json" style="display:none">
        <input type="file" id="import-foundry-file" accept="application/json,.json" style="display:none">
```

- [ ] **Step 3: Add selection-mode CSS in `styles.css`**

Add this block right after the existing `.char-card-dim.dark { ... }` rule (find it via
`grep -n "char-card-dim.dark" web/public/styles.css`, insert immediately after its closing `}`):

```css
/* ── Bulk Foundry export: selection mode ── */
.char-card.fdry-selectable {
  cursor: pointer;
  outline: 2px dashed var(--border);
  outline-offset: -2px;
}
.char-card.fdry-selected {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--bg4);
}
.char-card.fdry-disabled {
  opacity: .35;
  pointer-events: none;
  filter: grayscale(60%);
}
```

- [ ] **Step 4: Implement selection-mode state and handlers in `scripts.js`**

Add this block right after the `renderChars()` function definition (after its closing `}` on
line 410, before the `search-input` event listener):

```javascript
// ── Bulk Foundry export: selection mode ─────────────────────────────────────
let _foundryBulkMode = false;
const _foundryBulkSelected = new Set();  // slugs

function _foundryBulkSupportedLineages() { return ['vampire', 'mortal']; }

function _foundryBulkApplyCardClasses() {
  for (const card of document.querySelectorAll('.char-card[data-name]')) {
    const name = card.dataset.name;
    const c = STATE.characters.find(x => x.name === name);
    card.classList.remove('fdry-selectable', 'fdry-selected', 'fdry-disabled');
    if (!_foundryBulkMode || !c) continue;
    if (_foundryBulkSupportedLineages().includes(c.lineage)) {
      card.classList.add('fdry-selectable');
      if (_foundryBulkSelected.has(c.slug)) card.classList.add('fdry-selected');
    } else {
      card.classList.add('fdry-disabled');
    }
  }
}

function _foundryBulkUpdateButton() {
  const btn = document.getElementById('btn-export-foundry-bulk');
  const cancelBtn = document.getElementById('btn-export-foundry-cancel');
  if (!btn) return;
  if (!_foundryBulkMode) {
    btn.textContent = '🜏 Экспорт в Foundry';
    if (cancelBtn) cancelBtn.style.display = 'none';
    return;
  }
  const n = _foundryBulkSelected.size;
  btn.textContent = n ? `🜏 Экспортировать (${n})` : '🜏 Выберите персонажей…';
  if (cancelBtn) cancelBtn.style.display = '';
}

function _foundryBulkToggleCard(name) {
  const c = STATE.characters.find(x => x.name === name);
  if (!c || !_foundryBulkSupportedLineages().includes(c.lineage)) return;
  if (_foundryBulkSelected.has(c.slug)) _foundryBulkSelected.delete(c.slug);
  else _foundryBulkSelected.add(c.slug);
  _foundryBulkApplyCardClasses();
  _foundryBulkUpdateButton();
}

async function _foundryBulkDownload() {
  const slugs = Array.from(_foundryBulkSelected);
  try {
    const res = await fetch(`/api/characters/export-foundry-bulk${location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers.get('content-disposition') || '';
    a.download = /filename="([^"]+)"/.exec(cd)?.[1] || 'foundry_export.zip';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast('Ошибка массового экспорта: ' + e.message, 'error');
  }
}

function _foundryBulkExit() {
  _foundryBulkMode = false;
  _foundryBulkSelected.clear();
  _foundryBulkApplyCardClasses();
  _foundryBulkUpdateButton();
}

document.getElementById('btn-export-foundry-bulk')?.addEventListener('click', async e => {
  e.preventDefault();
  if (!_foundryBulkMode) {
    _foundryBulkMode = true;
    _foundryBulkApplyCardClasses();
    _foundryBulkUpdateButton();
    return;
  }
  if (!_foundryBulkSelected.size) return;
  await _foundryBulkDownload();
  _foundryBulkExit();
});
document.getElementById('btn-export-foundry-cancel')?.addEventListener('click', e => {
  e.preventDefault();
  _foundryBulkExit();
});
```

- [ ] **Step 5: Intercept card clicks while in selection mode**

In `web/public/scripts.js`, the existing click handler that opens the character modal
(lines 8455-8458) reads:

```javascript
document.getElementById('chars-grid').addEventListener('click', e => {
  const card = e.target.closest('.char-card[data-name]');
  if (card) openCharDetail(card.dataset.name);
});
```

Replace it with:

```javascript
document.getElementById('chars-grid').addEventListener('click', e => {
  const card = e.target.closest('.char-card[data-name]');
  if (!card) return;
  if (_foundryBulkMode) { _foundryBulkToggleCard(card.dataset.name); return; }
  openCharDetail(card.dataset.name);
});
```

- [ ] **Step 6: Re-apply selection classes whenever the grid re-renders**

In `renderChars()` (line 369-410), add a call to `_foundryBulkApplyCardClasses()` at the very end
of the function, right before its closing `}` (after the `grid.innerHTML = ...` assignment):

```javascript
  grid.innerHTML = list.map((c, i) => {
    // ... unchanged ...
  }).join('');
  _foundryBulkApplyCardClasses();
}
```

- [ ] **Step 7: Manual verification in browser**

Follow the `run-sanguine-web` skill recipe:
1. Restart the dev server, launch headless Chrome, navigate to the characters page.
2. Click `#btn-export-foundry-bulk` — confirm via `Runtime.evaluate` that
   `document.querySelectorAll('.char-card.fdry-selectable').length > 0` and at least one
   `.fdry-disabled` card exists (assuming the fixture city has a non-vampire/mortal character).
3. Click two supported cards, confirm `document.getElementById('btn-export-foundry-bulk').textContent`
   shows `(2)`.
4. Click `#btn-export-foundry-cancel`, confirm selection classes are cleared and normal card-click
   (opening the character modal) works again.
5. Re-enter selection mode, select 1-2 characters, click the export button again — confirm a
   download is triggered (check via `Page.setDownloadBehavior` + inspecting the downloaded file,
   or simply confirm the fetch succeeded with `Runtime.evaluate` around a manually-invoked
   `_foundryBulkDownload()` and checking no error toast appeared).

- [ ] **Step 8: Re-run `/code-review` (impeccable check) after the changes**

Per `CLAUDE.md`, re-run the impeccable design-system check on the three touched files to confirm
no CSS-token/contrast/accessibility regressions were introduced.

- [ ] **Step 9: Commit**

```bash
git add web/public/index.html web/public/scripts.js web/public/styles.css
git commit -m "feat: bulk Foundry export UI (character-list selection mode)"
```

---

## Task 7: Final verification and cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd web && npm run test:unit`
Expected: All tests pass (previous count + all new tests from Tasks 1-5), 0 failures.

- [ ] **Step 2: Check for incidental fixture changes**

Run: `git status --short` from the repo root. Per the established session pattern, test runs may
incidentally touch `cities/paris/archive/characters_index.md`,
`cities/paris/chronicles/*/events.md`, `cities/paris/chronicles/*/chronicle.md`, and
`web/tests/report.html` — these are regenerated timestamps/derived data, not real changes. Revert
them:

```bash
git checkout -- cities/paris/archive/characters_index.md web/tests/report.html
# (add any other incidentally-touched chronicle files git status shows, following the same pattern)
```

- [ ] **Step 3: Re-run the test suite once more to confirm a clean baseline**

Run: `cd web && npm run test:unit`
Expected: Same pass count as Step 1.

- [ ] **Step 4: Hand off to `superpowers:finishing-a-development-branch`**

The branch `feature/foundry-mortal-support` is ready for the finishing-a-development-branch skill
(verify tests, present merge/PR/keep/discard options).

---

## Self-Review Notes

- **Spec coverage:** all 5 decisions from the spec's section 2 table are covered (Task split ✓,
  psychicPowers skip — not implemented anywhere, confirmed by omission ✓, bulk export target ✓,
  ZIP-per-file format ✓, dependency-free ZIP ✓). Section 3 (mapper changes) → Tasks 1-2. Section 4
  (route/UI gate) → Task 3. Section 5 (bulk export) → Tasks 4-6. Section 6 (testing) → folded into
  each task's TDD steps. Section 7 (out of scope) — nothing in this plan touches Changeling,
  weapons/armor, era/variant/dicesetting, or the raw-md export route.
- **Placeholder scan:** no TBD/TODO markers; every step has concrete code or an exact command.
- **Type consistency:** `mapCharacterToFoundryActor(char, sheetData)` signature unchanged across
  Tasks 1 and 5 (bulk route calls it exactly as the existing single-export route does).
  `createZip(files)`/`readZip(buf)` signatures match between Task 4's implementation and Task 5's
  usage and test imports.
