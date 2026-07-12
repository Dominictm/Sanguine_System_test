# scripts.js Decomposition + mdToHtml Dead-Code Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three open items from `docs/audit/2026-07-12-project-status-report.md`: fix the silently-shadowed `mdToHtml()` duplicate (a real, currently-live bug — dead CSS on 4 call sites), split `web/lib/parsers.js` (1249 lines) into domain files, and extract the two remaining autonomous clusters from `web/public/scripts.js` (currently 4532 lines).

**Architecture:** All three items are mechanical, behavior-preserving extractions/renames verified by the existing 341-test backend suite plus live headless-Chrome CDP checks — the same recipe used 5 times already this session (tour.js/log-session.js/search.js/city.js/modules.js): exact-range cut (`sed`), grep to confirm no top-level (non-deferred) reference crosses the cut, `<script>`/`require()` wiring update, `npm run test:unit`, live CDP verification, commit. The one item that is NOT purely mechanical is Task 1 (mdToHtml) — it's a genuine behavior fix, called out explicitly with before/after visual verification.

**Tech Stack:** Vanilla JS (no bundler, classic `<script>` tags sharing one global scope), Node's built-in test runner, Express backend, headless Chrome via raw CDP (no Puppeteer/Playwright installed — see `.claude/skills/run-sanguine-web/SKILL.md`).

---

## Before you start

Read `.claude/skills/run-sanguine-web/SKILL.md` in full — it has the exact recipe for restarting/launching the dev server on port 4295, driving headless Chrome via raw CDP `Runtime.evaluate`/`Network.enable`, skipping the onboarding tour (click any button whose text matches `/пропустить/i`), and closing the browser (`Browser.close` over the CDP socket — **never** `taskkill` by image name, other unrelated Chrome/node processes exist on this machine).

Every task below ends the same way:
1. `cd web && npm run test:unit` — must show `341` (or higher, if the task added tests) `pass`, `0 fail`.
2. `git checkout -- web/tests/report.html` (it's a regenerated artifact, not a meaningful diff).
3. Live CDP check specific to what changed (exact steps given per task).
4. `git add <files>` (never `git add -A`) + commit with the message given, ending in:
   ```
   Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
   ```
   Direct to `master` — this repo's established convention, no feature branches.

If a task's CDP check needs the dev server running and it isn't: `cd web && (node server.js > /tmp/sanguine_server.log 2>&1 &)`, then `sleep 2`, then `curl -s http://localhost:4295/api/status` to confirm it's up. When done with a task's CDP check, find the PID via `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.js*' }` and `Stop-Process -Id <pid>` — do not leave it running between tasks unless you're chaining checks back-to-back.

---

### Task 1: Fix the shadowed `mdToHtml()` — two functions, explicit names, correct call sites

**Background (already researched, not to be re-derived):** `web/public/scripts.js:1265` declares a block-based markdown parser emitting classed tags (`<p class="md-p">`, `<div class="md-h md-h1">`, `<table class="md-table">`, `<ul class="md-ul">`, `<blockquote class="md-quote">`, `<hr class="md-hr">`). `web/public/modules.js:1659` (after this session's extraction) declares a *second*, unrelated, regex-based parser emitting plain tags (`<p>`, `<h2>`..`<h6>`, `<ul>`, `<blockquote>`, `<pre><code>`, no classes). Both are named `mdToHtml`. Because `index.html` loads `scripts.js` before `modules.js` (both classic scripts sharing one global scope), and function declarations of the same name in the same scope fully replace each other for every caller regardless of call-site file, **the `modules.js` version has always been the only one that actually runs** — the `scripts.js` version has been dead code since the moment `modules.js` was created.

`web/public/styles.css:5702-5798` has real, deliberate styling for the block parser's classes (`.md-body .md-h1` etc. — distinct per-heading-level treatment, gold color tokens, letter-spacing) — evidence this was the *intended* renderer for `.md-body`-wrapped content. Separately, `.modp-md` (styles.css:8948-9027) has equally real styling for the plain-tag output — written for the *other* parser, and correctly matches it (module pages use `.modp-md` wrappers).

**Net effect right now:** module-page content (wrapped in `.modp-md`) renders correctly. Everything else that expects the styled markdown (chronicle event prose, character-detail info tabs, city detail panels, the V20 sheet raw view — all wrapped in `.md-body`) is silently rendering with **generic, unstyled tags** instead of the intended `md-h*`/`md-p`/`md-quote`/`md-table` treatment.

**Fix:** give each implementation its own name, keep both (they serve genuinely different call sites), repoint every call site explicitly, so neither shadows the other and both are reachable on purpose.

**Files:**
- Modify: `web/public/scripts.js:1265` (rename declaration)
- Modify: `web/public/modules.js:1659` (rename declaration)
- Modify: `web/public/scripts.js:2289, 2378` (repoint calls)
- Modify: `web/public/city.js:342` (repoint call)
- Modify: `web/public/v20-sheet.js:2092` (repoint call)
- Modify: `web/public/modules.js:947, 1353, 1378, 1498, 1518, 1603, 1654` (repoint calls — same function, just the new explicit name)

- [ ] **Step 1: Capture "before" state via CDP (proves the bug, gives you a diff target)**

  Start the dev server and headless Chrome per the skill above, then in a CDP `Runtime.evaluate`:

  ```js
  (() => {
    // Navigate to a chronicle with event prose, then:
    const el = document.querySelector('.md-body.chron-md, .cdet-panel.active .md-body');
    return el ? { hasClassedChildren: !!el.querySelector('.md-p, .md-h1, .md-h2, .md-quote'), sample: el.innerHTML.slice(0, 300) } : 'no .md-body element found — navigate to a chronicle/character detail first';
  })();
  ```

  Expected right now (confirms the bug): `hasClassedChildren: false`, and `sample` shows plain `<p>`/`<h2>` tags, not `<p class="md-p">`/`<div class="md-h md-h1">`. Write this down — it's the before-state you'll flip after the fix.

- [ ] **Step 2: Rename the block-based parser in `scripts.js`**

  In `web/public/scripts.js`, change:
  ```js
  function mdToHtml(md) {
  ```
  at line 1265 to:
  ```js
  function mdToHtmlBlock(md) {
  ```
  Leave the entire body untouched — only the declaration name changes.

- [ ] **Step 3: Rename the regex-based parser in `modules.js`**

  In `web/public/modules.js`, change:
  ```js
  function mdToHtml(md) {
  ```
  at line 1659 to:
  ```js
  function mdToHtmlPlain(md) {
  ```
  Leave the entire body untouched.

- [ ] **Step 4: Repoint the 4 `.md-body`-wrapped call sites to `mdToHtmlBlock`**

  Update each of these to call `mdToHtmlBlock(...)` instead of `mdToHtml(...)` (same arguments, just the new name):
  - `web/public/scripts.js:2289` (chronicle event prose, `.md-body.chron-md`)
  - `web/public/scripts.js:2378` (character-detail tab panels, `.cdet-panel > .md-body`)
  - `web/public/city.js:342` (city detail panel, `.cdet-panel.active > .md-body`)
  - `web/public/v20-sheet.js:2092` (V20 sheet raw-markdown view, `.sheet-view.md-body`)

- [ ] **Step 5: Repoint the 7 `.modp-md`-wrapped call sites in `modules.js` to `mdToHtmlPlain`**

  These already render correctly today (no visual change) — this step only makes the currently-implicit "which parser" explicit. Update each of these to call `mdToHtmlPlain(...)`:
  - `web/public/modules.js:947` (module finale text)
  - `web/public/modules.js:1353` (scenario section view)
  - `web/public/modules.js:1378` (scenario raw view fallback)
  - `web/public/modules.js:1498` (finale raw view)
  - `web/public/modules.js:1518` (session log body)
  - `web/public/modules.js:1603` (NPC panel content)
  - `web/public/modules.js:1654` (open threads panel)

  Note: line numbers above are relative to `modules.js` in its state at the start of this task. If Step 2/3's edits shift any of these line numbers before you reach them, re-grep `mdToHtml(` in `modules.js` to find the current locations — do not guess offsets.

- [ ] **Step 6: Grep for any remaining bare `mdToHtml(` calls**

  Run: `grep -rn "mdToHtml(" web/public/*.js`
  Expected: zero results (every call site now says `mdToHtmlBlock(` or `mdToHtmlPlain(`). If anything remains, it was missed above — repoint it based on which wrapper class its output lands in (`.md-body` → Block, `.modp-md` → Plain).

- [ ] **Step 7: Check for a source-guard test referencing `mdToHtml` by name**

  Run: `grep -n "mdToHtml" web/tests/*.js`

  If no matches: continue to Step 8.

  If there are matches: they'll be reading `web/public/scripts.js` or `web/public/modules.js` by file path looking for a literal `mdToHtml` string (the same pattern already fixed once this session for `CITY_SECTION_DEFS` in `web/tests/all.test.js` — see commit `bb9b5c7`'s parent, the city.js extraction commit). Update the regex/string to look for `mdToHtmlBlock` or `mdToHtmlPlain` as appropriate for what that specific test is checking.

- [ ] **Step 8: Run the test suite**

  ```bash
  cd web && npm run test:unit
  ```
  Expected: `341 pass`, `0 fail` (or more if Step 7 added assertions). If anything fails, read the failure — it will name the exact assertion and file.

- [ ] **Step 9: Live CDP verification — confirm the fix actually changes rendering**

  Restart the dev server (`curl -s -X POST http://localhost:4295/api/restart` if already running, otherwise start fresh per "Before you start"), launch headless Chrome, skip the tour, then re-run the exact same `Runtime.evaluate` snippet from Step 1 against a chronicle's event prose or a character detail info tab.

  Expected now: `hasClassedChildren: true`, and `sample` shows `<p class="md-p">`/`<div class="md-h md-h1">` etc. Also visually confirm (via `getComputedStyle` on a `.md-h1` element) that `color` now resolves to the gold token instead of inherited default — e.g.:
  ```js
  getComputedStyle(document.querySelector('.md-body .md-h1'))?.color
  ```

  Separately, confirm module pages (`.modp-md`) look **unchanged** — navigate to a module page, check a `.modp-md` element still renders plain `<p>`/`<h2>` (no visual regression there, since `mdToHtmlPlain` is the same code as before, just renamed).

  Close Chrome via `Browser.close`, stop the server via `Stop-Process` (find PID by command-line match, never by image name).

- [ ] **Step 10: Commit**

  ```bash
  git add web/public/scripts.js web/public/modules.js web/public/city.js web/public/v20-sheet.js web/tests/all.test.js
  git commit -m "$(cat <<'EOF'
  fix: un-shadow duplicate mdToHtml() — two renderers, two names

  scripts.js and modules.js each declared a top-level function named
  mdToHtml with completely different implementations (block-parser
  with md-p/md-h*/md-table/md-quote CSS classes vs. a regex-based
  plain-tag renderer). Classic scripts share one global scope, so the
  later-loading modules.js declaration silently won for every caller,
  everywhere, since the day modules.js was extracted — the scripts.js
  block parser has been dead code, and its real, deliberate CSS
  (.md-body .md-h1 etc., styles.css:5702-5798) has been unreachable
  for chronicle event prose, character-detail panels, city detail
  panels, and the V20 sheet view.

  Renamed to mdToHtmlBlock (scripts.js, classed output — matches
  .md-body CSS) and mdToHtmlPlain (modules.js, plain-tag output —
  matches .modp-md CSS, unchanged behavior for module pages) and
  repointed every call site explicitly. Verified via CDP: affected
  .md-body content now renders with the intended classes/styling;
  module pages render identically to before.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Split `web/lib/parsers.js` — extract `shared.js`

**Files:**
- Create: `web/lib/parsers/shared.js`
- Modify: `web/lib/parsers.js` (remove extracted exports, temporarily require from `./parsers/shared.js` for anything the rest of the file still uses internally)

This is the first of 7 domain extractions from `parsers.js` (1249 lines). Doing `shared.js` first because every other domain file will need to `require()` from it.

- [ ] **Step 1: Identify exact line ranges to extract**

  Read `web/lib/parsers.js` lines 1-34 and 637-753 (the two clusters of genuinely cross-domain helpers, per the research below):
  - Lines 5-8: `RU_MONTHS_NOM`
  - Lines 14-34: `CYRILLIC_TR`, `LATIN_TR`, `slugify`
  - Lines 237-242: `THREAD_STATUS`
  - Lines 260-321: `readPrompt`, `writePrompt`
  - Lines 637-647: `periodLabel`
  - Lines 741-753: `mdExtractLinks`, `mdStripLinks`, `mdStripInline`

  Confirm these ranges by reading the file directly before cutting — line numbers may have drifted slightly from when this plan was written if `parsers.js` was touched between plan-writing and execution. Use `grep -n "^function \|^const \|^module.exports"` to re-anchor if needed.

- [ ] **Step 2: Create `web/lib/parsers/shared.js`**

  Copy the six pieces identified in Step 1 into a new file, in this order, with a `module.exports` at the bottom:
  ```js
  'use strict';
  // Cross-domain helpers used by 3+ parser domains (city/character/location/
  // chronicle/threads) — extracted from parsers.js during the 2026-07-12
  // decomposition (docs/audit/2026-07-12-project-status-report.md).

  const RU_MONTHS_NOM = [/* ...copy exact array literal from parsers.js:5-8... */];

  const CYRILLIC_TR = { /* ...copy exact object literal from parsers.js:14-... */ };
  const LATIN_TR = { /* ...copy exact object literal... */ };
  function slugify(s) { /* ...copy exact body from parsers.js... */ }

  const THREAD_STATUS = { /* ...copy exact object literal from parsers.js:237-242... */ };

  async function readPrompt(/* ...copy exact signature... */) { /* ...copy exact body... */ }
  async function writePrompt(/* ...copy exact signature... */) { /* ...copy exact body... */ }

  function periodLabel(/* ...copy exact signature... */) { /* ...copy exact body... */ }

  function mdExtractLinks(/* ... */) { /* ...copy exact body... */ }
  function mdStripLinks(/* ... */) { /* ...copy exact body... */ }
  function mdStripInline(/* ... */) { /* ...copy exact body... */ }

  module.exports = {
    RU_MONTHS_NOM, CYRILLIC_TR, LATIN_TR, slugify,
    THREAD_STATUS, readPrompt, writePrompt, periodLabel,
    mdExtractLinks, mdStripLinks, mdStripInline,
  };
  ```
  Do not paraphrase the bodies — copy them character-for-character from `parsers.js`. Use `sed -n 'X,Yp' web/lib/parsers.js` per range to extract exact text, then assemble (do not retype by hand — copy-paste risk of introducing a typo in a 1249-line file is real and each function here is used by 5+ consumers).

- [ ] **Step 3: Remove the extracted pieces from `parsers.js`, require them back in**

  Delete the six ranges from Step 1 out of `web/lib/parsers.js` (highest line numbers first, so earlier deletions don't shift the ranges you haven't cut yet — delete 741-753, then 637-647, then 260-321, then 237-242, then 14-34, then 5-8).

  At the top of `web/lib/parsers.js`, add:
  ```js
  const {
    RU_MONTHS_NOM, CYRILLIC_TR, LATIN_TR, slugify,
    THREAD_STATUS, readPrompt, writePrompt, periodLabel,
    mdExtractLinks, mdStripLinks, mdStripInline,
  } = require('./parsers/shared');
  ```
  This keeps every remaining function in `parsers.js` that calls `slugify`/`readPrompt`/etc. working unchanged — only the definition moved.

- [ ] **Step 4: Confirm `module.exports` at the bottom of `parsers.js` still exports everything it did before**

  Read `web/lib/parsers.js`'s `module.exports` block (was lines 1203-1249 before this task's edits — re-locate via `grep -n "^module.exports" web/lib/parsers.js`). The six names from Step 1 are now *destructured imports* rather than local declarations, but they're still in scope under the same names — the export list itself needs **no changes**. Confirm this by reading it, don't just assume.

- [ ] **Step 5: Run the test suite**

  ```bash
  cd web && npm run test:unit
  ```
  Expected: `341 pass`, `0 fail`. This is a pure code-motion — if anything fails, it's almost certainly a copy-paste error in Step 2 (compare the moved function body against `git diff` byte-for-byte) or a range-boundary mistake in Step 3 (an extra/missing line at a cut edge).

- [ ] **Step 6: Commit**

  ```bash
  git add web/lib/parsers.js web/lib/parsers/shared.js
  git commit -m "$(cat <<'EOF'
  refactor: extract cross-domain helpers into lib/parsers/shared.js

  First of 7 domain extractions from parsers.js (1249 lines, one file
  parsing city/character/chronicle/location/diary/scenario with no
  internal boundaries — docs/audit/2026-07-12-project-status-report.md).
  Starting with shared.js since every other domain file will require
  from it: slugify/CYRILLIC_TR/LATIN_TR (used by server.js + 6 route
  files + modules/shared.js), readPrompt/writePrompt (character AND
  location parsing), periodLabel (characters route), THREAD_STATUS
  (threads route), mdExtractLinks/mdStripLinks/mdStripInline (used by
  server.js top-level and internally by chronicle-event parsing).

  parsers.js's own module.exports is unchanged — server.js and all 8
  route files still require('../lib/parsers') with zero call-site
  changes; only the internal location of these definitions moved.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Split `parsers.js` — extract `city.js` (city.md + political factions)

**Files:**
- Create: `web/lib/parsers/city.js`
- Modify: `web/lib/parsers.js`

- [ ] **Step 1: Re-locate exact current line ranges**

  Run `grep -n "^function \|^const CITY\|^module.exports" web/lib/parsers.js` to re-find (line numbers will have shifted after Task 2's deletions):
  - `CITY_SECTIONS`, `_citySection` (internal helper), `CITY_DEFAULT_DESCRIPTION`, `buildCityMd`, `parseCityMd` (originally 39-111)
  - `cityScaffold` (originally 125-234)
  - `parsePoliticalFactions`, `setPoliticalFactionInfluence`, and any `_polFac*` internal helpers (originally 549-635)

- [ ] **Step 2: Create `web/lib/parsers/city.js`**

  Same copy-paste-exact-text approach as Task 2 Step 2. Structure:
  ```js
  'use strict';
  // city.md build/parse + archive/political_state.md faction-influence table.
  // Extracted from parsers.js during the 2026-07-12 decomposition.

  const { slugify } = require('./shared'); // if cityScaffold or buildCityMd use it — confirm via grep before assuming

  const CITY_SECTIONS = [ /* ...exact copy... */ ];
  function _citySection(/* ... */) { /* ...exact copy... */ }
  const CITY_DEFAULT_DESCRIPTION = /* ...exact copy... */;
  function buildCityMd(/* ... */) { /* ...exact copy... */ }
  function parseCityMd(/* ... */) { /* ...exact copy... */ }

  function cityScaffold(/* ... */) { /* ...exact copy... */ }

  function parsePoliticalFactions(/* ... */) { /* ...exact copy... */ }
  function setPoliticalFactionInfluence(/* ... */) { /* ...exact copy... */ }
  /* ...any _polFac* internal helpers, exact copy... */

  module.exports = {
    CITY_SECTIONS, CITY_DEFAULT_DESCRIPTION, buildCityMd, parseCityMd,
    cityScaffold, parsePoliticalFactions, setPoliticalFactionInfluence,
  };
  ```
  `_citySection` and any `_polFac*` helpers are internal (not in the original `module.exports`, per the research) — keep them unexported, just present in the file for the exported functions to call.

  Before writing the `require('./shared')` line, grep whether `buildCityMd`/`cityScaffold`/`parseCityMd`/`parsePoliticalFactions` actually call `slugify` or any other shared helper — only require what's actually used (`grep -n "slugify\|readPrompt\|writePrompt\|periodLabel\|mdExtractLinks\|mdStripLinks\|mdStripInline\|THREAD_STATUS" <the extracted range>` before finalizing the require line).

- [ ] **Step 3: Remove the extracted ranges from `parsers.js`, require them back in**

  Same pattern as Task 2 Step 3 — delete highest-line-range first, then add a destructuring require at the top:
  ```js
  const {
    CITY_SECTIONS, CITY_DEFAULT_DESCRIPTION, buildCityMd, parseCityMd,
    cityScaffold, parsePoliticalFactions, setPoliticalFactionInfluence,
  } = require('./parsers/city');
  ```

- [ ] **Step 4: Confirm `parsers.js`'s `module.exports` still lists these names unchanged, run tests**

  ```bash
  cd web && npm run test:unit
  ```
  Expected: `341 pass`, `0 fail`. The `city.md — buildCityMd / parseCityMd` describe block in `web/tests/all.test.js` (seen failing once already this session, in the `city.js` frontend-extraction task — that was a *different*, unrelated source-guard test reading `web/public/city.js`; this backend `parsers.js` split should not touch that test at all, but re-run the full suite to be sure) is the one to watch closest.

- [ ] **Step 5: Commit**

  ```bash
  git add web/lib/parsers.js web/lib/parsers/city.js
  git commit -m "$(cat <<'EOF'
  refactor: extract city.md + political-factions parsing into lib/parsers/city.js

  Second of 7 domain extractions from parsers.js. buildCityMd/parseCityMd/
  cityScaffold (city.md) and parsePoliticalFactions/setPoliticalFactionInfluence
  (archive/political_state.md) are both city-domain, consumed by
  web/routes/cities.js and web/routes/archive.js respectively.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Split `parsers.js` — extract `character.js`

**Files:**
- Create: `web/lib/parsers/character.js`
- Modify: `web/lib/parsers.js`

- [ ] **Step 1: Re-locate exact ranges**

  `grep -n "^function parseCharacter\|^function categorizeRel\|^function parseDiary\|^module.exports" web/lib/parsers.js` (originally: `categorizeRel` 772-791, `parseCharacter` 793-919, `parseDiary` 685-739 — note `parseDiary` sits *before* `categorizeRel`/`parseCharacter` in the original file; extract in whatever order they appear now).

- [ ] **Step 2: Create `web/lib/parsers/character.js`**

  ```js
  'use strict';
  // Character card + diary entry parsing. Extracted from parsers.js
  // during the 2026-07-12 decomposition.

  const { periodLabel } = require('./shared'); // confirm via grep whether parseDiary actually uses this before finalizing

  function parseDiary(/* ...exact copy... */) { /* ... */ }
  function categorizeRel(/* ...exact copy... */) { /* ... */ }
  function parseCharacter(/* ...exact copy... */) { /* ... */ }

  module.exports = { parseDiary, categorizeRel, parseCharacter };
  ```
  Grep the extracted range for any other shared-helper usage (`slugify`, `mdStripInline`, etc.) before finalizing the require line — don't assume only `periodLabel` is used.

- [ ] **Step 3: Remove from `parsers.js`, require back in, run tests, commit**

  Same pattern as Task 3. Test command: `cd web && npm run test:unit`, expect `341 pass`.

  ```bash
  git add web/lib/parsers.js web/lib/parsers/character.js
  git commit -m "$(cat <<'EOF'
  refactor: extract character card + diary parsing into lib/parsers/character.js

  Third of 7 domain extractions from parsers.js. parseCharacter,
  categorizeRel (relationship-description categorizer), and parseDiary
  are all consumed by web/routes/characters.js.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Split `parsers.js` — extract `location.js`

**Files:**
- Create: `web/lib/parsers/location.js`
- Modify: `web/lib/parsers.js`

- [ ] **Step 1: Re-locate exact range**

  `grep -n "^function parseLocation\|^module.exports" web/lib/parsers.js` (originally 921-1034).

- [ ] **Step 2: Create `web/lib/parsers/location.js`**

  ```js
  'use strict';
  // Location card parsing. Extracted from parsers.js during the
  // 2026-07-12 decomposition.

  function parseLocation(/* ...exact copy... */) { /* ... */ }

  module.exports = { parseLocation };
  ```
  Grep the extracted range for shared-helper usage first — `parseLocation` may call `mdStripInline`/`mdExtractLinks`/etc.; require whatever it actually uses from `./shared`.

- [ ] **Step 3: Remove from `parsers.js`, require back in, run tests, commit**

  ```bash
  cd web && npm run test:unit
  ```
  Expected: `341 pass`.

  ```bash
  git add web/lib/parsers.js web/lib/parsers/location.js
  git commit -m "$(cat <<'EOF'
  refactor: extract location card parsing into lib/parsers/location.js

  Fourth of 7 domain extractions from parsers.js. parseLocation is
  consumed by web/routes/locations.js.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Split `parsers.js` — extract `scenario.js` (module scenario.md)

**Files:**
- Create: `web/lib/parsers/scenario.js`
- Modify: `web/lib/parsers.js`

This is the largest single domain slice (originally ~225 lines, 14 exports) — the module scenario.md parsing/mutation helpers, sole consumer `web/routes/modules/shared.js`.

- [ ] **Step 1: Re-locate exact range**

  `grep -n "^function parseScenarioSections\|^function checkScenarioStructure\|^const SCENARIO_REQUIRED_TOPICS\|^module.exports" web/lib/parsers.js` (originally 323-547): `parseScenarioSections`, `splitH3Body`, `serializeScenarioSections`, `replaceScenarioSection`, `findScenarioSectionIndex`, `replaceScenarioSections`, `SCENE_ADDED_MARKER_RE`, `isFinaleHeading`, `hasManualSceneMarker`, `addManualSceneMarker`, `clearManualSceneMarker`, `insertScenarioScene`, `SCENARIO_REQUIRED_TOPICS`, `checkScenarioStructure`.

- [ ] **Step 2: Create `web/lib/parsers/scenario.js`**

  ```js
  'use strict';
  // Module scenario.md section parsing and mutation. Extracted from
  // parsers.js during the 2026-07-12 decomposition. Sole consumer:
  // web/routes/modules/shared.js.

  /* ...exact copy of all 14 exports in their original order, preserving
     any internal call order dependencies (e.g. serializeScenarioSections
     likely calls splitH3Body — keep declaration order as-is, function
     hoisting makes order irrelevant for correctness but keep it for
     readability)... */

  module.exports = {
    parseScenarioSections, splitH3Body, serializeScenarioSections,
    replaceScenarioSection, findScenarioSectionIndex, replaceScenarioSections,
    SCENE_ADDED_MARKER_RE, isFinaleHeading, hasManualSceneMarker,
    addManualSceneMarker, clearManualSceneMarker, insertScenarioScene,
    SCENARIO_REQUIRED_TOPICS, checkScenarioStructure,
  };
  ```
  Grep the extracted range for shared-helper usage before finalizing requires — this is the largest slice and most likely to call something from `./shared` (e.g. `mdStripInline` for text-topic checks).

- [ ] **Step 3: Remove from `parsers.js`, require back in, run tests, commit**

  ```bash
  cd web && npm run test:unit
  ```
  Expected: `341 pass`. Watch specifically for scenario-block-editing tests (this is the domain exercised by `docs/superpowers/plans/2026-07-05-scenario-block-editing-enhancements.md`'s test additions, if any reference these functions by behavior rather than by path — a pure code-motion shouldn't break behavior tests, but this is the highest-risk single slice given its size).

  ```bash
  git add web/lib/parsers.js web/lib/parsers/scenario.js
  git commit -m "$(cat <<'EOF'
  refactor: extract module scenario.md parsing into lib/parsers/scenario.js

  Fifth of 7 domain extractions from parsers.js, and the largest single
  slice (14 exports, ~225 lines) — module scenario.md section parsing,
  scene-marker mutation, and structure-completeness checking. Sole
  consumer: web/routes/modules/shared.js.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Split `parsers.js` — extract `threads.js`

**Files:**
- Create: `web/lib/parsers/threads.js`
- Modify: `web/lib/parsers.js`

- [ ] **Step 1: Re-locate exact range**

  `grep -n "^function threadStatusKey\|^function parseThreadsContent\|^module.exports" web/lib/parsers.js` (originally 649-683).

- [ ] **Step 2: Create `web/lib/parsers/threads.js`**

  ```js
  'use strict';
  // archive/open_threads.md parsing. Extracted from parsers.js during
  // the 2026-07-12 decomposition. Sole consumer: web/routes/threads.js.

  const { THREAD_STATUS } = require('./shared');

  function threadStatusKey(/* ...exact copy... */) { /* ... */ }
  function parseThreadsContent(/* ...exact copy... */) { /* ... */ }

  module.exports = { threadStatusKey, parseThreadsContent };
  ```
  Note: `THREAD_STATUS` itself is exported from `parsers.js`'s top level too (per `web/routes/threads.js`'s import list, which needs both `THREAD_STATUS` and `parseThreadsContent`) — it already lives in `web/lib/parsers/shared.js` after Task 2, so `parsers.js`'s re-export of `THREAD_STATUS` continues to work via its existing `require('./parsers/shared')` destructure. No change needed there, just confirm it during Step 4.

- [ ] **Step 3: Remove from `parsers.js`, require back in, run tests**

  ```bash
  cd web && npm run test:unit
  ```
  Expected: `341 pass`.

- [ ] **Step 4: Confirm `web/routes/threads.js`'s two imports (`THREAD_STATUS`, `parseThreadsContent`) both still resolve correctly through `require('../lib/parsers')`**

  ```bash
  grep -n "require.*lib/parsers" web/routes/threads.js
  node -e "const p = require('./web/lib/parsers'); console.log(typeof p.THREAD_STATUS, typeof p.parseThreadsContent)"
  ```
  Expected: `object function` (or similar — `THREAD_STATUS` is an object, `parseThreadsContent` is a function). If either prints `undefined`, the re-export chain (`parsers.js` → `parsers/index.js` if that exists yet, or `parsers.js`'s own `module.exports` directly) is broken — trace it before moving on.

- [ ] **Step 5: Commit**

  ```bash
  git add web/lib/parsers.js web/lib/parsers/threads.js
  git commit -m "$(cat <<'EOF'
  refactor: extract open_threads.md parsing into lib/parsers/threads.js

  Sixth of 7 domain extractions from parsers.js. threadStatusKey and
  parseThreadsContent are consumed by web/routes/threads.js; THREAD_STATUS
  itself already lives in lib/parsers/shared.js (Task 2).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Split `parsers.js` — extract `chronicle.js`, then finish with `parsers/index.js`

**Files:**
- Create: `web/lib/parsers/chronicle.js`
- Create: `web/lib/parsers/index.js`
- Modify: `web/lib/parsers.js` → delete (replaced entirely by `index.js` + the 7 domain files)
- Modify: any file requiring `'../lib/parsers'` — **should need zero changes**, verify this explicitly

This is the last domain slice, plus the final cutover: once every domain export has a home, `web/lib/parsers.js` itself becomes a pure re-export shim (`parsers/index.js`), and every one of the 8 consumer files listed below keeps working unchanged because `require('../lib/parsers')` still resolves — Node resolves a `require('./parsers')` to `./parsers/index.js` when `./parsers.js` no longer exists and `./parsers/` is a directory with an `index.js`.

- [ ] **Step 1: Re-locate remaining exports in `parsers.js`**

  After Tasks 2-7, `parsers.js` should now contain only: `classifyChronicleLink`, `parseChronicleLocation`, `parseParticipant`, `parseTable`, `parseWorldState`, `parseEvent`, `parseChronicle`, `parseChronicleParticipants` (originally 755-770 and 1036-1201), plus its `require('./parsers/shared')` (and any others added by Tasks 3-7) at the top, plus a `module.exports` at the bottom. Confirm this with:
  ```bash
  grep -n "^function \|^const \|^require\|^module.exports" web/lib/parsers.js
  ```
  If anything unexpected remains (a helper this plan didn't account for), leave it in `chronicle.js` rather than inventing a new file for it — chronicle-domain is the closest fit for any leftover chronicle-events.md helper.

- [ ] **Step 2: Create `web/lib/parsers/chronicle.js`**

  ```js
  'use strict';
  // chronicle events.md parsing + chronicle-event link classification.
  // Extracted from parsers.js during the 2026-07-12 decomposition.
  // Consumers: web/routes/chronicles.js, web/routes/modules/shared.js
  // (parseEvent is cross-domain — used by both).

  /* ...exact copy of the remaining functions, in their original order... */

  module.exports = {
    classifyChronicleLink, parseChronicleLocation, parseParticipant,
    parseTable, parseWorldState, parseEvent, parseChronicle,
    parseChronicleParticipants,
  };
  ```
  Grep for shared-helper usage (`mdExtractLinks`/`mdStripLinks`/`mdStripInline` are likely candidates, given `classifyChronicleLink` and event-prose parsing) before finalizing requires.

- [ ] **Step 3: Delete `web/lib/parsers.js`, create `web/lib/parsers/index.js`**

  ```bash
  rm web/lib/parsers.js
  ```

  Create `web/lib/parsers/index.js` re-exporting every domain file's exports, flattened into one object (matching the exact flat shape `parsers.js` used to export, so every existing `const { x, y } = require('../lib/parsers')` call site keeps working with zero changes):

  ```js
  'use strict';
  // Re-exports every parser domain as one flat object, preserving the
  // exact shape web/server.js and 8 route files already destructure via
  // require('../lib/parsers') — this file replaces the old monolithic
  // parsers.js (1249 lines) as of the 2026-07-12 decomposition
  // (docs/audit/2026-07-12-project-status-report.md).

  module.exports = {
    ...require('./shared'),
    ...require('./city'),
    ...require('./character'),
    ...require('./location'),
    ...require('./scenario'),
    ...require('./threads'),
    ...require('./chronicle'),
  };
  ```

- [ ] **Step 4: Confirm every consumer still resolves every export it needs**

  Run this check for every consumer file the research identified — it directly requires each file and destructures the exact names that file needs, failing loudly if anything is `undefined`:

  ```bash
  node -e "
  const checks = {
    './web/server.js — (checking via lib/parsers require)': null,
  };
  const p = require('./web/lib/parsers');
  const needed = {
    'server.js': ['RU_MONTHS_NOM','slugify','readPrompt','writePrompt','buildCityMd','parseCityMd','cityScaffold','mdExtractLinks','mdStripLinks','mdStripInline','classifyChronicleLink','categorizeRel','parseCharacter','parseLocation','parseChronicleLocation','parseParticipant','parseTable','parseWorldState'],
    'chronicles.js': ['slugify','parseChronicle','parseChronicleParticipants','parseEvent'],
    'cities.js': ['slugify','buildCityMd','parseCityMd','cityScaffold'],
    'archive.js': ['parsePoliticalFactions','setPoliticalFactionInfluence','parseCityMd'],
    'characters.js': ['slugify','writePrompt','parseDiary','periodLabel','parseCharacter'],
    'locations.js': ['slugify','writePrompt','parseLocation'],
    'tools.js': ['slugify'],
    'threads.js': ['THREAD_STATUS','parseThreadsContent'],
    'modules/shared.js': ['slugify','parseEvent','parseScenarioSections','replaceScenarioSection','replaceScenarioSections','splitH3Body','serializeScenarioSections','findScenarioSectionIndex','checkScenarioStructure','insertScenarioScene','hasManualSceneMarker','clearManualSceneMarker','isFinaleHeading'],
  };
  let ok = true;
  for (const [file, names] of Object.entries(needed)) {
    for (const name of names) {
      if (p[name] === undefined) { console.error(file, 'MISSING', name); ok = false; }
    }
  }
  console.log(ok ? 'ALL EXPORTS PRESENT' : 'MISSING EXPORTS FOUND — see above');
  "
  ```
  Expected: `ALL EXPORTS PRESENT`. If anything is missing, trace which domain file should have it (per the export table in this plan's Task 2-8 headers) and add it there.

- [ ] **Step 5: Run the full test suite**

  ```bash
  cd web && npm run test:unit
  ```
  Expected: `341 pass`, `0 fail`. This is the highest-risk step in the whole `parsers.js` split — it's the point where the monolithic file stops existing entirely. If anything fails, `git diff` against the previous commit to compare old `parsers.js` content against the new files piece-by-piece.

- [ ] **Step 6: Commit**

  ```bash
  git add -A web/lib/parsers.js web/lib/parsers/
  git commit -m "$(cat <<'EOF'
  refactor: extract chronicle events.md parsing, finish parsers.js split

  Final domain slice (classifyChronicleLink, parseChronicleLocation,
  parseParticipant, parseTable, parseWorldState, parseEvent,
  parseChronicle, parseChronicleParticipants — consumed by
  chronicles.js and modules/shared.js) plus the cutover: parsers.js
  (1249 lines, one file for city/character/chronicle/location/diary/
  scenario parsing with no internal boundaries) is now lib/parsers/
  index.js + 7 domain files (shared/city/character/location/scenario/
  threads/chronicle). require('../lib/parsers') still resolves via
  Node's directory-index lookup — zero call-site changes needed in
  server.js or any of the 8 route files.

  Verified every consumer's exact import list resolves against the new
  index.js (see plan Task 8 Step 4) and the full 341-test suite passes.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: Extract Archive/Threads/Rumors/World-state cluster from `scripts.js`

**Files:**
- Create: `web/public/archive.js`
- Modify: `web/public/scripts.js` (remove lines 1560-2338)
- Modify: `web/public/index.html` (add `<script src="archive.js"></script>`)

**Confirmed boundary (already researched):** cut from line **1560** (banner comment `// ═══ Threads ═══`, includes `THREAD_STATUS_OPTS`/`THREAD_PRIO_OPTS`/`_threadFiles` consts right after it) through line **2338** (blank line before the next banner `// ═══ Module Detail Modal ═══` at 2339). Contains: `fileLabel`, `loadThreads`, `SPINNER` (const), `ensureCharsLoaded`, `resolveCharByName`, `loadChronicle`, `renderChronicle`, `renderLoreMd`, `loadArchiveDoc`, `_loadArchiveEditable`, `_rollD20Rumor`, `_factionsTab` (let), `loadFactions`, `loadFactionsInfluence`, `_rumorCity`, `_initRumorCheckboxes`, `_archiveRumors`, `_renderRumorsArchive`, `_rumorsType` (let), `loadRumors`, `renderTable`, `renderWorldState`, `renderTimeline`.

Every external reference to these names (in `scripts.js`'s own `navigate()` at lines 109-121, plus `modules.js`, `city.js`, `log-session.js`, `search.js`) is inside a function body or event-listener callback — confirmed safe to extract regardless of `<script>` tag order, same as the 5 clusters already extracted this session.

- [ ] **Step 1: Re-confirm the exact boundary before cutting**

  Line numbers may have shifted slightly if Task 1 (mdToHtml rename) touched anything before line 1560 in `scripts.js` (it touches lines 1265 and 2289/2378 — the 1265 rename is a same-length change, so line numbers after it should be unaffected, but confirm):
  ```bash
  grep -n "^// ═" web/public/scripts.js | awk -F: '$1 >= 1550 && $1 <= 2350'
  sed -n '1555,1565p' web/public/scripts.js   # confirm banner + first real line
  sed -n '2335,2342p' web/public/scripts.js   # confirm blank line + next banner
  ```

- [ ] **Step 2: Cut the range into a new file**

  ```bash
  sed -n '1560,2338p' web/public/scripts.js > web/public/archive.js
  sed -i '1560,2338d' web/public/scripts.js
  wc -l web/public/scripts.js web/public/archive.js
  ```
  Expected: `archive.js` is 779 lines (2338-1560+1); `scripts.js` shrinks by the same amount.

- [ ] **Step 3: Confirm the cut boundary in `scripts.js` reads cleanly (no orphaned blank lines / broken banner)**

  ```bash
  sed -n '1553,1565p' web/public/scripts.js
  ```
  Expected: the line that was `1559` (blank, before the old banner) is followed directly by whatever was at old line `2339` (the `// ═══ Module Detail Modal ═══` banner) — no double-blank-line artifact. If there's an extra blank line, remove it with an `Edit` call (same cleanup done after the `tour.js` extraction this session).

- [ ] **Step 4: Add the script tag**

  In `web/public/index.html`, add `<script src="archive.js"></script>` anywhere after `<script src="scripts.js"></script>` (order relative to `modules.js`/`city.js`/`log-session.js`/`search.js`/`tour.js` doesn't matter — none of them redeclare a name this cluster also declares).

- [ ] **Step 5: Grep for any source-guard test referencing scripts.js by path for anything in this cluster**

  ```bash
  grep -n "public/scripts\.js\|public/archive\.js" web/tests/*.js
  ```
  If nothing currently references `scripts.js` by path (true as of this plan being written — the one that did, `CITY_SECTION_DEFS`, was already repointed to `city.js`), this step is a no-op confirmation.

- [ ] **Step 6: Run the test suite**

  ```bash
  cd web && npm run test:unit
  ```
  Expected: `341 pass`, `0 fail`.

- [ ] **Step 7: Live CDP verification**

  Restart/launch the dev server + headless Chrome per the skill, skip the tour, then:
  ```js
  // Threads page
  navigate('threads');
  // wait ~700ms, then:
  document.querySelectorAll('.thread-row, [data-thread]').length // or whatever the real thread-list selector is — grep archive.js's loadThreads() render call for the actual class name before writing this check
  ```
  Also check: a chronicle's Archive tab (rumors/world-state/timeline) renders, and a chronicle's event prose (`.md-body.chron-md`, now calling `mdToHtmlBlock` per Task 1) still shows correctly. Confirm zero failed network requests via `Network.enable` + tracking `Network.responseReceived` status >= 400, same pattern as every previous extraction's verification script this session.

  Close Chrome via `Browser.close`, stop the server via PID match.

- [ ] **Step 8: Commit**

  ```bash
  git add web/public/archive.js web/public/scripts.js web/public/index.html
  git commit -m "$(cat <<'EOF'
  refactor: extract Archive/Threads/Rumors/World-state into public/archive.js

  Continuing the incremental scripts.js breakup (docs/audit/2026-07-12
  project-status-report.md): open threads list, chronicle archive doc
  loading/editing, d20 rumor rolling/checkboxes/archive, faction
  influence, and world-state/timeline table rendering — 779 lines, all
  referenced only from deferred callbacks (navigate()'s dispatch table,
  click delegations in modules.js/city.js/log-session.js/search.js),
  same extraction pattern as tour.js/log-session.js/search.js/city.js/
  modules.js earlier this session.

  Verified via headless Chrome CDP: threads page renders, chronicle
  archive/rumors/world-state tabs render, no console/network errors.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Extract Character Detail Modal cluster from `scripts.js`

**Files:**
- Create: `web/public/char-detail.js`
- Modify: `web/public/scripts.js` (remove the range covering `openCharDetail` through `_reloadModulePage`)
- Modify: `web/public/index.html` (add `<script src="char-detail.js"></script>`)

**Confirmed boundary (already researched):** starts at `openCharDetail` (originally line 2762 in `scripts.js`'s pre-Task-9 state — **will now be ~779 lines earlier** after Task 9 removes 1560-2338; re-locate before cutting, don't reuse the raw number 2762). Ends at the blank line before the `// ═══ Create Character Modal ═══` banner (originally 4167-4169; `VAMPIRE_CLANS` starts right after). Contains: `openCharDetail`, `charDetailModal` (const), `_carouselTimer`/`_carouselImages`/`_carouselIdx` (let), `initCarousel`, `_carouselGoTo`, `_carouselAdvance`, `_togglePanelEdit`, `_savePanelEdit`, `_generateAppearance`, `_loadDescImages`, `_deleteCharImage`, `_genPromptRunning` (let), `_genDialogue`, `_promptSectionHtml`, `_copyImagePrompt`, `_generatePrompt`, `_genPersonalityRunning` (let), `_generatePersonality`, `_genBiographyRunning` (let), `_generateBiography`, `_editCharName`/`_editOrigName`/`_editOrigValues`/`_genAppearanceRunning` (let), `_enterInfoEdit`, `_exitInfoEdit`, `_saveInfoFields`, `triggerImageUpload`, `_modSyncBlockSaveAllVisibility`, `_modToggleEdit`, `_modSavePanel`, `_reloadModulePage`.

Every external reference (in `scripts.js` itself, `modules.js`, `search.js`) is inside a function body or `addEventListener` callback — confirmed safe. Two references found were comments only (not real calls): `scripts.js` (near `CLAN_COLORS` and near the later "Create Character Modal" section) and `modules.js:992` — ignore those, they don't affect extraction safety.

- [ ] **Step 1: Re-locate the exact boundary after Task 9's cut**

  ```bash
  grep -n "^function openCharDetail\|_reloadModulePage" web/public/scripts.js
  grep -n "^// ═" web/public/scripts.js | awk -F: '$1 > <line where openCharDetail now is> && $1 < <line + 1500>'
  ```
  (Replace the placeholder bounds with the actual line found by the first grep — this is a live re-anchor step, not a literal command to run as-is.) Read a few lines before `openCharDetail` and a few lines after the last `_reloadModulePage`-related code (the `// Locations detail: upload/carousel/lightbox moved to public/locations.js (E2.3).` comment, if still present) to confirm the exact cut boundary, same way every previous cluster in this session was confirmed before cutting.

- [ ] **Step 2: Cut the range into a new file**

  ```bash
  sed -n '<start>,<end>p' web/public/scripts.js > web/public/char-detail.js
  sed -i '<start>,<end>d' web/public/scripts.js
  wc -l web/public/scripts.js web/public/char-detail.js
  ```
  Expected: `char-detail.js` is approximately 1400 lines (the range was 2762-4165 before Task 9's 779-line removal shifted everything after 2338 upward by -779; re-derive the exact `<start>`/`<end>` from Step 1's grep, don't hardcode 2762/4165).

- [ ] **Step 3: Confirm the cut boundary reads cleanly**

  Same check as every previous extraction — read a few lines before and after the cut point in `scripts.js`, remove any orphaned double-blank-line.

- [ ] **Step 4: Add the script tag**

  In `web/public/index.html`, add `<script src="char-detail.js"></script>` after `<script src="scripts.js"></script>`.

- [ ] **Step 5: Grep for source-guard tests referencing anything in this cluster by path**

  ```bash
  grep -n "public/scripts\.js\|public/char-detail\.js" web/tests/*.js
  ```
  Apply the same fix pattern as Task 1 Step 7 / the `CITY_SECTION_DEFS` precedent if anything turns up.

- [ ] **Step 6: Run the test suite**

  ```bash
  cd web && npm run test:unit
  ```
  Expected: `341 pass`, `0 fail`.

- [ ] **Step 7: Live CDP verification — this is the largest and most interactive cluster extracted this session, verify thoroughly**

  Restart/launch dev server + headless Chrome, skip the tour, then:
  1. Open a character card → confirm `#char-detail-modal` opens (`classList.contains('open')`), tabs switch (`.cdet-tab` click → correct `.cdet-panel` becomes active).
  2. Click into edit mode on the Info tab (`_enterInfoEdit`) → confirm form fields render, then exit without saving (`_exitInfoEdit`).
  3. If the test character has description images, confirm the carousel (`initCarousel`/`_carouselGoTo`) advances.
  4. Confirm the "Info" tab content still shows classed markdown (this cluster's `mdToHtml` call at old-`scripts.js:2378`, repointed to `mdToHtmlBlock` in Task 1 — confirm the class names survived the move to `char-detail.js` unchanged, since Task 1 already ran before this task).
  5. Track `Network.responseReceived` for any status >= 400 — expect none from passive navigation (don't trigger a real AI-generation call, that costs real API budget and isn't needed to verify the extraction).

  Close Chrome via `Browser.close`, stop the server via PID match.

- [ ] **Step 8: Commit**

  ```bash
  git add web/public/char-detail.js web/public/scripts.js web/public/index.html
  git commit -m "$(cat <<'EOF'
  refactor: extract Character Detail Modal into public/char-detail.js

  The largest remaining scripts.js cluster: the character detail modal
  itself (tabs, info-field editing), the description-image carousel,
  and AI-assisted content generation (appearance/personality/biography/
  dialogue/image-prompt) for a character — all state-coupled around
  the modal's own module-level variables, extracted as one unit per
  the same precedent as modules.js/v20-sheet.js (large cohesive
  feature files, not split further without real dependency analysis).

  Verified via headless Chrome CDP: modal opens, tabs switch, info-edit
  mode renders and exits cleanly, image carousel advances, markdown
  content renders with the classed styling restored by Task 1's
  mdToHtmlBlock fix — no console/network errors.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 11: Update the project status report

**Files:**
- Modify: `docs/audit/2026-07-12-project-status-report.md`

- [ ] **Step 1: Log what this plan closed**

  Add an entry (following the same style as the existing "Рекомендуемый порядок" section's completed-item entries) recording: the `mdToHtmlBlock`/`mdToHtmlPlain` fix and its commit hash, the final `parsers.js` → `parsers/` split and its 7 commits' hashes, the `archive.js` and `char-detail.js` extractions and their commit hashes, and the final line count of `scripts.js` (should be roughly 4532 - 779 - ~1400 ≈ 2350 lines, all four of dashboard/characters-grid/AI-settings/tools plus module-detail-modal glue plus the create-character-modal — note in the report whether any further extraction looks worthwhile or whether what's left is cohesive enough to leave alone).

- [ ] **Step 2: Commit**

  ```bash
  git add docs/audit/2026-07-12-project-status-report.md
  git commit -m "$(cat <<'EOF'
  docs: log mdToHtml fix, parsers.js split, and final scripts.js extractions

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Self-Review Notes (from plan authoring)

- **Spec coverage:** all three open items from the audit report are covered — mdToHtml (Task 1), parsers.js split (Tasks 2-8), remaining scripts.js clusters (Tasks 9-10), plus a documentation-closure task (Task 11).
- **Line-number drift:** every task after Task 1 explicitly re-derives its line ranges via `grep`/`sed -n ...p` rather than trusting the numbers baked into this plan, because earlier tasks in the same plan shift later line numbers. This is called out per-task, not just once, since it's the single highest risk of a mechanical mistake in this plan.
- **Task independence:** Tasks 2-8 (parsers.js) and Tasks 9-10 (scripts.js) are independent of each other and could be reordered or interleaved: Task 1 (mdToHtml) should run first since Task 10 references its outcome for verification, but Tasks 2-8 have no dependency on Tasks 9-10 or vice versa.
- **Verification asymmetry, intentional:** Tasks 2-8 (parsers.js, pure backend code-motion) rely on the 341-test suite alone — there's no frontend-facing behavior to CDP-check. Tasks 9-10 (frontend, scripts.js) add live CDP verification on top, since that's this session's established convention for any `public/*.js` change.
- **Deliberate deviation from "paste full code" in Tasks 2-10:** these are pure move-only refactors (no logic changes) of 1200-2700 lines each; inlining that much verbatim source into this plan document would be impractical and worse for correctness than the alternative — `sed -n 'X,Yp' <source> > <dest>` copies the exact bytes mechanically, with zero retyping risk, which is strictly safer than a human/agent transcribing "exact copy" text blocks by hand. Every task instead gives the exact `grep`/`sed` commands to re-locate ranges and cut them verbatim, which is precise and executable — the same recipe already used successfully 5 times this session (tour.js/log-session.js/search.js/city.js/modules.js) without a written plan. Where a step shows `/* ...exact copy... */`, that's shorthand for "run the sed command above, don't retype" — not an unresolved decision.
