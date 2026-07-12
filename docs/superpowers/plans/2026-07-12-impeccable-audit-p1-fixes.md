# Impeccable Audit P1 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the P1 (and select P2) findings from `/impeccable audit web/public` — modal accessibility (focus trap/restore/Escape), WCAG contrast on error/status text, a CSS reflow hotspot, missing radius/spacing design tokens, a fixed-width responsive overflow, an over-loud resting-state card, and undersized touch targets.

**Architecture:** This is a vanilla-JS SPA (no build step, no framework, no automated frontend test harness — `web/tests/all.test.js` covers only the Express backend). Frontend changes here are verified by **manual headless-Chrome CDP scripts** (per the project's own `run-sanguine-web` skill convention), not unit tests — every task below substitutes that for the usual "write failing test" step. Frontend files: `web/public/utils.js`, `scripts.js`, `locations.js`, `audio-library.js`, `styles.css`, `index.html`. No backend/Express changes at all.

The 17 existing modals (13 in `scripts.js`, 2 in `locations.js`, 2 in `audio-library.js`) each currently wire their own `classList.add('open')` / `classList.remove('open')`, with **no shared utility**, inconsistent Escape handling (6/17 have it), and **zero** focus-trap or focus-restore anywhere. Task 1 introduces one shared `openModal()`/`closeModal()` pair in `utils.js`; Tasks 2-4 migrate every modal to use it, which fixes focus-trap + focus-restore + Escape consistency in one mechanical pass per file.

**Tech Stack:** Vanilla JS (ES2020+, no transpilation), CSS custom properties, Node's built-in `http`/CDP for headless-Chrome verification (see `.claude/skills/run-sanguine-web/`).

---

## Before you start

Read `.claude/skills/run-sanguine-web/SKILL.md` if you haven't already this session — every verification step below assumes its recipe (restart via `POST /api/restart`, headless Chrome via raw CDP on a fresh `--user-data-dir`, skip the onboarding tour, close via `Browser.close` only — never `taskkill` by image name).

All verification scripts go in the scratchpad directory, not the repo.

---

### Task 1: Shared modal focus-management utility

**Files:**
- Modify: `web/public/utils.js` (currently 195 lines, no modal-related code — confirmed by grep)
- Verify: scratchpad CDP script

- [ ] **Step 1: Add `openModal`/`closeModal` to `utils.js`**

Append to the end of `web/public/utils.js`:

```js
// ── Modal focus management ──────────────────────────────────────────────
// Every modal in this app independently wired classList.add/remove('open')
// with no focus trap, no focus restore, and inconsistent Escape handling
// (impeccable audit 2026-07-12). This is the one shared implementation —
// migrate every modal open/close call site to these two functions instead
// of touching classList directly.
const _modalState = new Map(); // id -> { prevFocus, trapHandler }

const _FOCUSABLE_SEL = 'button:not([disabled]), [href], input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function _modalFocusables(modal) {
  return Array.from(modal.querySelectorAll(_FOCUSABLE_SEL))
    .filter(el => el.offsetParent !== null);
}

// focusSelector: optional CSS selector (scoped to the modal) for the element
// to focus on open — e.g. a name input. Falls back to the first focusable
// element. Pass null to just focus the modal's first focusable child.
function openModal(id, focusSelector = null) {
  const modal = document.getElementById(id);
  if (!modal) return;
  const prevFocus = document.activeElement;
  modal.classList.add('open');

  const toFocus = (focusSelector && modal.querySelector(focusSelector)) || _modalFocusables(modal)[0];
  toFocus?.focus();

  const trapHandler = e => {
    if (e.key === 'Escape') { closeModal(id); return; }
    if (e.key !== 'Tab') return;
    const els = _modalFocusables(modal);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  modal.addEventListener('keydown', trapHandler);
  _modalState.set(id, { prevFocus, trapHandler });
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('open');
  const state = _modalState.get(id);
  if (state) {
    modal.removeEventListener('keydown', state.trapHandler);
    if (state.prevFocus && typeof state.prevFocus.focus === 'function') state.prevFocus.focus();
    _modalState.delete(id);
  }
}
```

`utils.js` is loaded via a plain `<script>` tag before `scripts.js`/`locations.js`/`audio-library.js` in `index.html` (same pattern as every other shared helper in that file), so `openModal`/`closeModal` are globals available to all three.

- [ ] **Step 2: Syntax-check**

Run: `node -c web/public/utils.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Restart the dev server**

Run: `curl -s -X POST http://localhost:4295/api/restart` then wait ~2s, then `curl -s http://localhost:4295/api/status`
Expected: valid JSON status response.

- [ ] **Step 4: Verify the utility works in isolation before migrating any real modal**

Write `scratchpad/verify_modal_util.js`:

```js
async function main() {
  const listRes = await fetch('http://localhost:9501/json');
  const targets = await listRes.json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  function send(method, params = {}) {
    return new Promise(resolve => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 1500));

  async function evalJs(expr, awaitPromise = false) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }

  await evalJs(`
    Array.from(document.querySelectorAll('button')).filter(b => /пропустить/i.test(b.textContent)).forEach(b => b.click());
    'ok';
  `);
  await new Promise(r => setTimeout(r, 500));

  // Build a throwaway test modal in the live DOM (not part of the app) to
  // exercise openModal/closeModal without touching any real feature yet.
  const result = await evalJs(`
    (() => {
      const div = document.createElement('div');
      div.id = 'test-modal-util';
      div.innerHTML = '<button id="tm-a">A</button><button id="tm-b">B</button><button id="tm-close">Close</button>';
      document.body.appendChild(div);
      const trigger = document.createElement('button');
      trigger.id = 'tm-trigger';
      trigger.textContent = 'trigger';
      document.body.appendChild(trigger);
      trigger.focus();
      const triggerWasFocused = document.activeElement === trigger;

      openModal('test-modal-util', '#tm-a');
      const focusedAAfterOpen = document.activeElement === document.getElementById('tm-a');

      // Simulate Shift+Tab from the first element — should wrap to the last.
      document.getElementById('tm-a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      const wrappedToLast = document.activeElement === document.getElementById('tm-close');

      // Simulate Tab from the last element — should wrap to the first.
      document.getElementById('tm-close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      const wrappedToFirst = document.activeElement === document.getElementById('tm-a');

      closeModal('test-modal-util');
      const focusRestoredToTrigger = document.activeElement === trigger;
      const modalClosed = !document.getElementById('test-modal-util').classList.contains('open');

      div.remove();
      trigger.remove();

      return { triggerWasFocused, focusedAAfterOpen, wrappedToLast, wrappedToFirst, focusRestoredToTrigger, modalClosed };
    })()
  `);
  console.log(JSON.stringify(result, null, 2));

  await send('Browser.close');
  ws.close();
}
main().catch(e => { console.error('FAILED:', e); process.exit(1); });
```

Launch headless Chrome per `run-sanguine-web` skill on port 9501, then:

Run: `node scratchpad/verify_modal_util.js`
Expected: `{"triggerWasFocused":true,"focusedAAfterOpen":true,"wrappedToLast":true,"wrappedToFirst":true,"focusRestoredToTrigger":true,"modalClosed":true}` — every field `true`.

If `focusedAAfterOpen` is `false`, `openModal`'s focus call ran before the element was in the DOM tree the browser considers focusable — re-check step 1's implementation before proceeding. Do not move to Task 2 until all six fields are `true`.

- [ ] **Step 5: Commit**

```bash
git add web/public/utils.js
git commit -m "feat: shared openModal/closeModal utility with focus trap and restore"
```

---

### Task 2: Migrate `scripts.js` modals — group A (already have Escape handling)

**Files:**
- Modify: `web/public/scripts.js` — `chr-create-modal` (open ~2867, Escape ~2913-2916), `mod-create-modal` (open ~2611, Escape ~2696-2698), `char-detail-modal` (open ~6667, Escape ~6681), `module-detail-modal` (open ~5579, Escape ~5642), `city-detail-modal` (open ~1854, Escape ~2110)

These 5 modals already have a *bespoke* Escape listener — replace each with `openModal`/`closeModal` and delete the now-redundant bespoke listener (the shared utility's internal `trapHandler` already handles Escape).

- [ ] **Step 1: `chr-create-modal`**

Find and replace (verbatim from research):
```js
  document.getElementById('chr-create-modal').classList.add('open');
  setTimeout(() => document.getElementById('chr-create-name').focus(), 50);
```
with:
```js
  openModal('chr-create-modal', '#chr-create-name');
```

Find every `document.getElementById('chr-create-modal').classList.remove('open')` (3 occurrences per research: ~2877, ~2881, ~2903) and replace each with `closeModal('chr-create-modal')`.

Find and replace the now-redundant scoped listener:
```js
document.getElementById('chr-create-modal').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('chr-create-submit').click();
  if (e.key === 'Escape') document.getElementById('chr-create-modal').classList.remove('open');
});
```
with (keep the Enter-submits behavior, drop the now-redundant Escape line):
```js
document.getElementById('chr-create-modal').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('chr-create-submit').click();
});
```

- [ ] **Step 2: `mod-create-modal`**

Replace:
```js
  document.getElementById('mod-create-modal').classList.add('open');
  setTimeout(() => document.getElementById('mod-create-name').focus(), 50);
```
with:
```js
  openModal('mod-create-modal', '#mod-create-name');
```

Replace every `document.getElementById('mod-create-modal').classList.remove('open')` (3 occurrences: ~2643, ~2647, ~2683) with `closeModal('mod-create-modal')`.

Delete the now-redundant standalone listener entirely:
```js
document.getElementById('mod-create-modal').addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('mod-create-modal').classList.remove('open');
});
```

- [ ] **Step 3: `char-detail-modal`**

Replace `document.getElementById('char-detail-modal').classList.add('open');` (line ~6667) with `openModal('char-detail-modal');` (no specific focus target documented — falls back to first focusable child, which is the `✕` close button, matching prior behavior of "focus goes nowhere specific").

Replace every `charDetailModal.classList.remove('open')` (3 occurrences: ~2365, ~3085, ~6680 — note `charDetailModal` is a cached `const` referencing `document.getElementById('char-detail-modal')`, verify each occurrence and change to `closeModal('char-detail-modal')`) — keep the `const charDetailModal = document.getElementById('char-detail-modal');` line itself if it's still referenced elsewhere (e.g. by the click-outside-to-close handler), only change the `.classList.remove('open')` calls.

Delete the now-redundant document-level listener:
```js
document.addEventListener('keydown', e => { if (e.key === 'Escape') charDetailModal.classList.remove('open'); });
```

- [ ] **Step 4: `module-detail-modal`**

Replace `modal.classList.add('open');` inside `openModuleDetail` (line ~5579, where `modal` is set to `document.getElementById('module-detail-modal')` at line ~5576) with `openModal('module-detail-modal');`.

Replace every `moduleDetailModal.classList.remove('open')` (3 occurrences: ~5621, ~5640, ~5641) with `closeModal('module-detail-modal')`.

Delete the now-redundant listener:
```js
document.addEventListener('keydown', e => { if (e.key === 'Escape') moduleDetailModal.classList.remove('open'); });
```

- [ ] **Step 5: `city-detail-modal`**

Replace `modal.classList.add('open');` inside `openCityDetail` (line ~1854, `modal` set to `document.getElementById('city-detail-modal')` at ~1851) with `openModal('city-detail-modal');`.

Replace every `cityDetailModal.classList.remove('open')` (3 occurrences: ~2097, ~2108, ~2109) with `closeModal('city-detail-modal')`.

Delete the now-redundant listener:
```js
document.addEventListener('keydown', e => { if (e.key === 'Escape') cityDetailModal.classList.remove('open'); });
```

- [ ] **Step 6: Syntax-check and restart**

Run: `node -c web/public/scripts.js` — expect no output.
Run: `curl -s -X POST http://localhost:4295/api/restart` then wait ~2s.

- [ ] **Step 7: Verify all 5 migrated modals via CDP**

Write `scratchpad/verify_group_a_modals.js` — for each of the 5 modal ids, open it through its normal app trigger (real click via `Input.dispatchMouseEvent`, not `.click()`, per project convention), then assert: (a) `document.getElementById(<id>).classList.contains('open')` is true, (b) pressing `Escape` (via `Input.dispatchKeyEvent`) closes it, (c) focus returned to whatever element had focus before opening. Use this template per modal (adjust the trigger click target and id):

```js
async function verifyModal(evalJs, dispatchKey, triggerSelector, modalId) {
  await evalJs(`document.querySelector(${JSON.stringify(triggerSelector)}).focus();`);
  const before = await evalJs(`document.activeElement.id || document.activeElement.tagName`);
  // realClick(triggerSelector) — see run-sanguine-web skill for the helper
  await new Promise(r => setTimeout(r, 400));
  const isOpen = await evalJs(`document.getElementById(${JSON.stringify(modalId)}).classList.contains('open')`);
  await dispatchKey('Escape');
  await new Promise(r => setTimeout(r, 300));
  const isClosedAfterEscape = await evalJs(`!document.getElementById(${JSON.stringify(modalId)}).classList.contains('open')`);
  const after = await evalJs(`document.activeElement.id || document.activeElement.tagName`);
  return { modalId, isOpen, isClosedAfterEscape, focusRestored: before === after };
}
```

Expected for all 5: `isOpen: true`, `isClosedAfterEscape: true`, `focusRestored: true`.

- [ ] **Step 8: Commit**

```bash
git add web/public/scripts.js
git commit -m "refactor: migrate 5 modals with existing Escape handling to openModal/closeModal"
```

---

### Task 3: Migrate `scripts.js` modals — group B (no prior Escape handling)

**Files:**
- Modify: `web/public/scripts.js` — `chr-detail-modal` (chronicle, open ~2193, close ~2365/~3085), `mod-fill-modal` (open ~2718, close ~2740/~2745/~2771), `mod-delete-modal` (open ~2810, close ~2814/~2819/~2840), `chr-delete-modal` (open ~2932, close ~2959/~2964/~2987), `modp-delete-modal` (open ~4764, close ~4743/~4747/~4769), `modp-close-modal` (open ~4603, close ~4606/~4610/~4669), `finale-preview-modal` (open ~3058, close ~3072/~3076), `char-modal` (open in `openCharModal()` ~8085-8088, close in `closeCharModal()` ~8089-8093)

These 8 modals currently have **no** Escape handling at all and no focus management — this task adds it for free by switching to `openModal`/`closeModal`.

- [ ] **Step 1: `chr-detail-modal` (chronicle)**

Replace `modal.classList.add('open');` (where `modal` is `document.getElementById('chr-detail-modal')`, line ~2184-2193) with `openModal('chr-detail-modal');`.

Replace both `classList.remove('open')` occurrences (~2365, ~3085) with `closeModal('chr-detail-modal')`.

- [ ] **Step 2: `mod-fill-modal`**

Inside `openFillModal` (line ~2707), replace `document.getElementById('mod-fill-modal').classList.add('open');` (~2718) with `openModal('mod-fill-modal');`.

Replace all 3 `classList.remove('open')` occurrences (~2740, ~2745, ~2771) with `closeModal('mod-fill-modal')`.

- [ ] **Step 3: `mod-delete-modal`**

Replace `document.getElementById('mod-delete-modal').classList.add('open');` (~2810) with `openModal('mod-delete-modal');`.

Replace all 3 `classList.remove('open')` occurrences (~2814, ~2819, ~2840) with `closeModal('mod-delete-modal')`.

- [ ] **Step 4: `chr-delete-modal`**

Replace `modal.classList.add('open');` (`modal` = `document.getElementById('chr-delete-modal')`, ~2927-2932) with `openModal('chr-delete-modal');`.

Replace all 3 `classList.remove('open')` occurrences (~2959, ~2964, ~2987) with `closeModal('chr-delete-modal')`.

- [ ] **Step 5: `modp-delete-modal`**

Replace `document.getElementById('modp-delete-modal').classList.add('open');` (~4764) with `openModal('modp-delete-modal');`.

Replace all 3 `classList.remove('open')` occurrences (~4743, ~4747, ~4769) with `closeModal('modp-delete-modal')`.

- [ ] **Step 6: `modp-close-modal`**

Replace `document.getElementById('modp-close-modal').classList.add('open');` (~4603) with `openModal('modp-close-modal');`.

Replace all 3 `classList.remove('open')` occurrences (~4606, ~4610, ~4669) with `closeModal('modp-close-modal')`.

- [ ] **Step 7: `finale-preview-modal`**

Inside `openFinalePreview` (`modal` = `document.getElementById('finale-preview-modal')`, ~3053-3058), replace `modal.classList.add('open');` with `openModal('finale-preview-modal');`.

Replace both `classList.remove('open')` occurrences (~3072, ~3076) with `closeModal('finale-preview-modal')`.

- [ ] **Step 8: `char-modal`**

Replace:
```js
function openCharModal() {
  charModal.classList.add('open');
  showModalStep(1);
}
function closeCharModal() {
  charModal.classList.remove('open');
  modalOut.style.display = 'none';
  modalOut.textContent = '';
}
```
with:
```js
function openCharModal() {
  openModal('char-modal');
  showModalStep(1);
}
function closeCharModal() {
  closeModal('char-modal');
  modalOut.style.display = 'none';
  modalOut.textContent = '';
}
```

Note: `showModalStep(1)` (line ~8094+) contains its own `.focus()` call on a `firstField` — leave that as-is, it runs after `openModal` and will simply move focus again to the first form field of step 1, which is the desired behavior (more specific than the generic first-focusable fallback).

- [ ] **Step 9: Syntax-check, restart, verify**

Run: `node -c web/public/scripts.js`
Run: `curl -s -X POST http://localhost:4295/api/restart` then wait ~2s.

Extend `scratchpad/verify_group_a_modals.js` (or copy to `verify_group_b_modals.js`) to cover these 8 modal ids the same way as Task 2 Step 7 — for each: real-click its trigger, assert `.open` is present, press Escape, assert `.open` is gone and focus returned to the pre-open element. All 8 should now pass where they previously had no Escape behavior at all (verify this is a real before/after by confirming — if you have the pre-migration code stashed — that Escape did nothing on these 8 before this task).

Run: `node scratchpad/verify_group_b_modals.js`
Expected: all 8 modals report `isClosedAfterEscape: true, focusRestored: true`.

- [ ] **Step 10: Commit**

```bash
git add web/public/scripts.js
git commit -m "feat: add focus trap, focus restore, and Escape to 8 modals that had neither"
```

---

### Task 4: Migrate `locations.js` and `audio-library.js` modals

**Files:**
- Modify: `web/public/locations.js` — `loc-detail-modal` (open ~481, close ~531/~1008, Escape ~535), `loc-edit-modal` (open in `openLocEditModal` ~891-892, close in `closeLocEditModal` ~913, Escape ~1114-1116 guarded)
- Modify: `web/public/audio-library.js` — `audio-upload-modal` (open ~555, close ~557/~558/~559, no Escape), `audio-preset-modal` (open in `_audioPresetOpenModal` ~312, close ~316/~317/~318, no Escape)

- [ ] **Step 1: `loc-detail-modal`**

Replace `document.getElementById('loc-detail-modal').classList.add('open');` (~481) with `openModal('loc-detail-modal');`.

Replace both `classList.remove('open')` occurrences (~531, ~1008) with `closeModal('loc-detail-modal')`.

Delete the now-redundant listener:
```js
document.addEventListener('keydown', e => { if (e.key === 'Escape') locDetailModal.classList.remove('open'); });
```

- [ ] **Step 2: `loc-edit-modal`**

Inside `openLocEditModal` (line ~845), replace:
```js
  modal.classList.add('open');
  document.getElementById('loc-edit-name').focus();
```
with:
```js
  openModal('loc-edit-modal', '#loc-edit-name');
```
(where `modal` was already `document.getElementById('loc-edit-modal')` set at line ~847 — that `const modal = ...` line can stay since it's used elsewhere in the same function for `title`/other lookups relative to it, only these two lines change).

Inside `closeLocEditModal`, replace `document.getElementById('loc-edit-modal').classList.remove('open');` (~913) with `closeModal('loc-edit-modal');`.

Delete the now-redundant guarded listener:
```js
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('loc-edit-modal').classList.contains('open')) closeLocEditModal();
  });
```
(the click-outside-to-close listener right above it, lines ~1111-1113, stays untouched — it still needs to call `closeLocEditModal()` on backdrop click, which internally now calls `closeModal`.)

- [ ] **Step 3: `audio-upload-modal`**

Replace `_audioUploadModal.classList.add('open');` (~555) with `openModal('audio-upload-modal', '#audio-upload-title');` (focuses the title input, the first field a user fills in).

Replace all 3 `classList.remove('open')` occurrences (~557, ~558, ~559) with `closeModal('audio-upload-modal')`.

- [ ] **Step 4: `audio-preset-modal`**

Inside `_audioPresetOpenModal`, replace `_audioPresetModal.classList.add('open');` (~312) with `openModal('audio-preset-modal', '#audio-preset-name');`.

Replace all 3 `classList.remove('open')` occurrences (~316, ~317, ~318) with `closeModal('audio-preset-modal')`.

- [ ] **Step 5: Syntax-check, restart, verify**

Run: `node -c web/public/locations.js && node -c web/public/audio-library.js`
Run: `curl -s -X POST http://localhost:4295/api/restart` then wait ~2s.

Write `scratchpad/verify_locs_audio_modals.js` covering all 4 modal ids the same way as prior tasks (real-click trigger → assert open → Escape → assert closed + focus restored). For `loc-edit-modal` and `audio-upload-modal`/`audio-preset-modal` additionally assert the documented focus target actually received focus on open (`document.activeElement.id === 'loc-edit-name'` / `'audio-upload-title'` / `'audio-preset-name'` immediately after open).

Run: `node scratchpad/verify_locs_audio_modals.js`
Expected: all 4 pass with correct initial focus target and clean Escape/restore behavior.

- [ ] **Step 6: Commit**

```bash
git add web/public/locations.js web/public/audio-library.js
git commit -m "refactor: migrate remaining 4 modals (locations, audio-library) to openModal/closeModal"
```

---

### Task 5: Fix WCAG contrast — `--accent`/`--accent2` used as error/status text color

**Files:**
- Modify: `web/public/styles.css`

`--accent` (#8B0000) on `--bg` (#07050a) ≈ 2.0:1 contrast; `--accent2` (#B80000) ≈ 2.9:1 — both fail the 4.5:1 WCAG AA minimum for body text. `--c-danger-text` (#ff7070, already in `:root` at line 46) is the correct token for text and is already used correctly in several places (e.g. `.v20-row-remove-btn:hover` at line 7800). This task fixes the confirmed error/status/danger selectors and gives a decision rule + exact remaining line list for the rest — **not every `--accent`/`--accent2` usage is wrong**: decorative/brand uses (logo text, active-tab indicators, hover-only accents) are intentional per DESIGN.md and must be left alone.

- [ ] **Step 1: Fix the 9 confirmed error/status/danger selectors**

Each of these is plain text color used for actual error/warning/status feedback (not decoration) — change `var(--accent)`/`var(--accent2)` to `var(--c-danger-text)` in the `color:` declaration only (leave any `border-color:`/`background:` on the same rule untouched):

```css
/* line ~592 */
.ais-status.err {
  color: var(--c-danger-text);  /* was var(--accent2) */
}

/* line ~1128 */
.badge-vampire {
  color: var(--c-danger-text);  /* was var(--accent) */
  border-color: rgba(180, 0, 0, .35);
}

/* line ~1663 */
.badge-integrity.err {
  color: var(--c-danger-text);  /* was var(--accent) */
  border-color: rgba(200, 40, 0, .4);
}

/* line ~1749 */
.output-area .err {
  color: var(--c-danger-text);  /* was var(--accent) */
}

/* line ~3077 */
.city-edit-status { font-size: var(--fs-sm); color: var(--c-danger-text); }  /* was var(--accent2) */

/* line ~4117 */
.priority-высокий {
  color: var(--c-danger-text);  /* was var(--accent) */
  border-color: rgba(204, 34, 0, .35);
}

/* line ~4322 */
.badge-loc-danger {
  color: var(--c-danger-text);  /* was var(--accent) */
  border-color: rgba(204, 34, 0, .35);
}

/* line ~4347 */
.badge-masq-high {
  color: var(--c-danger-text);  /* was var(--accent) */
  border-color: rgba(204, 34, 0, .35);
}

/* line ~2099, .btn-create-char — ghost button with background:none, so its
   accent2 text sits directly on the page background */
.btn-create-char {
  background: none;
  border: 1px solid var(--accent);
  color: var(--c-danger-text);  /* was var(--accent2) */
  white-space: nowrap;
}
```

Also fix `.chr-form-error` — grep `web/public/styles.css` for `chr-form-error` to find its exact current line (it was referenced in the audit but not captured verbatim in this plan's research pass); if it sets `color: var(--accent)` or `var(--accent2)`, change to `var(--c-danger-text)` the same way.

- [ ] **Step 2: Sweep the remaining `--accent`/`--accent2` text-color usages with a decision rule**

Run: `grep -n "color: var(--accent" web/public/styles.css` and for each hit not already fixed in Step 1, read 3 lines above it to get the selector name, then apply:

- **Fix (→ `var(--c-danger-text)`)** if the selector name contains `err`, `error`, `danger`, `warn`, `-del-` (delete-hover states), or is another status/priority/badge class in the same family as Step 1's fixes.
- **Leave alone** if it's: an active/selected-state indicator (e.g. `.cdet-tab.active`, `#page-library .tab-btn.active`), a decorative/logo/heading element (e.g. `.logo-text .t1`), a hover-only accent on a non-error control, or any `border-color`/`background`/`accent-color` (form-control tint) property — those are intentional per DESIGN.md's "blood as point of attention" rule and are not plain-text-on-dark-background contrast failures in the same way (borders/backgrounds have their own separate contrast rules, and hover-only accent needs no fix since it's transient, not resting-state read text).

Confirmed remaining lines to triage this way (from the audit's research pass): 204 (leave — `.logo-text .t1`, decorative), 1464 & 2350 (leave — active-tab indicators), 2686, 3031, 3055, 3088, 3181, 3500, 3515, 3686, 3887, 3949, 5721, 6089, 6210, 6365, 6477, 6574, 6760, 6964, 7014, 7098, 7216, 7725, 8406, 8410, 8438, 8447, 8804, 8957, 8977, 9108, 9831, 10066, 10142, 10461 — triage each with the rule above.

- [ ] **Step 3: Syntax/visual sanity check**

Run: `node -c` doesn't apply to CSS — instead restart the server and load the app in headless Chrome, navigate to a page showing at least one fixed badge (e.g. the characters list, for `.badge-vampire`), and screenshot it to confirm the badge text is now legibly pink/red rather than near-invisible dark red.

Run:
```bash
curl -s -X POST http://localhost:4295/api/restart
```
Then via CDP: navigate to `?city=paris`, go to the characters page, `Page.captureScreenshot`, visually confirm badge text is readable (or read `getComputedStyle` on a `.badge-vampire` element and confirm `color` resolves to `rgb(255, 112, 112)` — `--c-danger-text`'s value).

- [ ] **Step 4: Commit**

```bash
git add web/public/styles.css
git commit -m "fix: WCAG AA contrast for error/status text (--accent/--accent2 -> --c-danger-text)"
```

---

### Task 6: Fix reflow loop in `fitLocTitles()`

**Files:**
- Modify: `web/public/locations.js:146-159`

Current code (verbatim):
```js
function fitLocTitles() {
  document.querySelectorAll('.loc-card .loc-title').forEach(el => {
    el.style.fontSize = '';
    const fs  = parseFloat(getComputedStyle(el).fontSize);
    const lh  = parseFloat(getComputedStyle(el).lineHeight) || fs * 1.2;
    const max = lh * 2 + 2; // 2 строки + 2px буфер
    if (el.scrollHeight <= max) return;
    let size = fs;
    while (el.scrollHeight > max && size > 13) {
      size -= 0.5;
      el.style.fontSize = size + 'px';
    }
  });
}
```

The `while` loop forces a synchronous layout recalculation on every 0.5px step (read `scrollHeight` after every write to `style.fontSize`) — for N cards each needing M steps to shrink, that's N×M forced reflows in a single call.

- [ ] **Step 1: Replace the per-step reflow loop with a binary search (same visual result, O(log n) reflows instead of O(n) per card)**

```js
function fitLocTitles() {
  document.querySelectorAll('.loc-card .loc-title').forEach(el => {
    el.style.fontSize = '';
    const fs  = parseFloat(getComputedStyle(el).fontSize);
    const lh  = parseFloat(getComputedStyle(el).lineHeight) || fs * 1.2;
    const max = lh * 2 + 2; // 2 строки + 2px буфер
    if (el.scrollHeight <= max) return;

    // Binary search the largest 0.5px-stepped size in [13, fs] that fits —
    // same result as the old linear shrink loop, far fewer forced reflows.
    let lo = 13, hi = fs, best = 13;
    while (hi - lo > 0.5) {
      const mid = Math.round((lo + hi) / 2 * 2) / 2; // snap to .5px steps
      el.style.fontSize = mid + 'px';
      if (el.scrollHeight <= max) { best = mid; lo = mid; }
      else { hi = mid; }
    }
    el.style.fontSize = best + 'px';
  });
}
```

- [ ] **Step 2: Syntax-check**

Run: `node -c web/public/locations.js`
Expected: no output.

- [ ] **Step 3: Restart and verify visually + measure reflow count**

Run: `curl -s -X POST http://localhost:4295/api/restart` then wait ~2s.

Write `scratchpad/verify_loc_titles.js` — via CDP, navigate to the locations page (`?city=paris`), call `fitLocTitles()` manually if it isn't already triggered by page load, then for every `.loc-card .loc-title` read `getBoundingClientRect().height` and confirm no title's rendered height exceeds roughly 2 lines (compare against `lineHeight * 2 + 2` computed the same way the function does). Also confirm the resulting `font-size` values match what the OLD linear version would have produced for at least 2-3 known-long location titles (compare against the pre-change screenshot/values if you captured them, or accept any size in `[best, best+0.5)` since binary search may land within half a step of the old greedy result — that's expected and visually identical).

Run: `node scratchpad/verify_loc_titles.js`
Expected: every checked title's height is within the 2-line budget; no console errors.

- [ ] **Step 4: Commit**

```bash
git add web/public/locations.js
git commit -m "perf: binary-search font shrink in fitLocTitles instead of linear reflow loop"
```

---

### Task 7: Materialize radius/spacing tokens documented in DESIGN.md

**Files:**
- Modify: `web/public/styles.css:8-107` (`:root` block) and the highest-frequency literal clusters

`grep -c "border-radius"` currently returns 188 hits, all literals, with roughly: 2px×100, 3px×27, 6px×12, 1px×4, 10px×4 clustering near the documented scale, plus a long tail (4px×14, 5px×7, 8px, 12px, 20px) that drifted off it. This task adds the tokens and replaces the *dominant* clusters only — a full sweep of all 188 is out of scope for one task (flagged as a `/impeccable extract` follow-up for the long tail).

- [ ] **Step 1: Add radius/spacing tokens to `:root`**

Insert after the `--dur-base: .28s;` line (end of the `:root` block, before its closing `}` at line 107):

```css
  /* ── Radius scale (documented in DESIGN.md, materialized here 2026-07-12) ── */
  --r-hairline: 1px;
  --r-sm: 2px;
  --r-md: 3px;
  --r-lg: 6px;
  --r-xl: 10px;
  /* ── Spacing scale (documented in DESIGN.md, materialized here 2026-07-12) ── */
  --sp-xs: 4px;
  --sp-sm: 10px;
  --sp-md: 16px;
  --sp-lg: 20px;
  --sp-xl: 28px;
  --sp-xxl: 44px;
```

- [ ] **Step 2: Replace the dominant radius clusters**

Run: `grep -n "border-radius: 2px;" web/public/styles.css | wc -l` (expect ~100), then use a scoped find-and-replace **only** for the exact literal `border-radius: 2px;` (not `2px 0 0 2px` or other multi-value radii — those need individual attention and are out of scope here):

```bash
sed -i 's/border-radius: 2px;/border-radius: var(--r-sm);/g' web/public/styles.css
sed -i 's/border-radius: 3px;/border-radius: var(--r-md);/g' web/public/styles.css
sed -i 's/border-radius: 6px;/border-radius: var(--r-lg);/g' web/public/styles.css
sed -i 's/border-radius: 10px;/border-radius: var(--r-xl);/g' web/public/styles.css
sed -i 's/border-radius: 1px;/border-radius: var(--r-hairline);/g' web/public/styles.css
```

(Run each `sed` one at a time and re-check the diff — do not chain them blindly, since `border-radius: 10px;` must be replaced *before* `border-radius: 1px;` would otherwise never wrongly match a substring of it; the patterns above are anchored with the trailing `;` so this isn't actually at risk, but verify the diff regardless.)

- [ ] **Step 3: Verify no unintended matches**

Run: `git diff web/public/styles.css | grep "^-" | grep -v "border-radius"` — expected: empty (confirms the `sed` only touched `border-radius` lines, nothing else).

Run: `node .claude/skills/impeccable/scripts/detect.mjs --json web/public/styles.css` — expected: no new `design-system-radius` findings introduced (there may still be pre-existing ones from the long tail this task didn't touch — that's fine, not a regression).

- [ ] **Step 4: Restart and visual smoke-check**

Run: `curl -s -X POST http://localhost:4295/api/restart` then wait ~2s.
Via CDP, screenshot the characters list and a modal — confirm no visible layout change (this is a pure token-substitution, computed values are unchanged, so nothing should look different).

- [ ] **Step 5: Commit**

```bash
git add web/public/styles.css
git commit -m "refactor: materialize DESIGN.md radius/spacing tokens, apply to dominant border-radius clusters"
```

---

### Task 8: Fix `#info-panel` fixed-width overflow on narrow viewports

**Files:**
- Modify: `web/public/styles.css:1287-1304`

Current code (verbatim):
```css
#info-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 550px;
  background: var(--bg2);
  border-left: 1px solid var(--border);
  transform: translateX(100%);
  transition: transform .3s var(--ease);
  overflow-y: auto;
  z-index: var(--z-sticky);
  padding: 24px 20px;
}

#info-panel.open {
  transform: translateX(0);
}
```

- [ ] **Step 1: Cap the width against the viewport**

```css
#info-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: min(550px, 100vw);
  background: var(--bg2);
  border-left: 1px solid var(--border);
  transform: translateX(100%);
  transition: transform .3s var(--ease);
  overflow-y: auto;
  z-index: var(--z-sticky);
  padding: 24px 20px;
}

#info-panel.open {
  transform: translateX(0);
}
```

`min(550px, 100vw)` keeps the existing 550px on any viewport wide enough for it, and shrinks to fill the viewport exactly (no overflow, no horizontal scrollbar) below that — no new breakpoint needed, no JS changes.

- [ ] **Step 2: Restart and verify at a narrow viewport**

Run: `curl -s -X POST http://localhost:4295/api/restart` then wait ~2s.

Via CDP: `Emulation.setDeviceMetricsOverride({width: 400, height: 800, deviceScaleFactor: 1, mobile: false})`, open the info panel (whatever real trigger opens it — grep `openModal|classList.add.*info-panel|#info-panel` in `scripts.js` to find the trigger if not `openModal`-based, since `#info-panel` was not one of the 17 `role="dialog"` modals and is a separate slide-in panel), then read `document.getElementById('info-panel').getBoundingClientRect().width` and confirm it's `≤ 400` (the emulated viewport width), and confirm `document.documentElement.scrollWidth <= document.documentElement.clientWidth` (no horizontal overflow introduced).

Run the verification script.
Expected: panel width ≤ viewport width, no horizontal scroll.

- [ ] **Step 3: Commit**

```bash
git add web/public/styles.css
git commit -m "fix: #info-panel width capped to viewport, prevents overflow under 550px"
```

---

### Task 9: Quiet `.stat-card`'s resting-state color (Whisper-Until-Touched)

**Files:**
- Modify: `web/public/styles.css:766-806`

Current code (verbatim):
```css
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
  margin-bottom: 36px;
}

.stat-card {
  background: rgb(139 0 0 / 7%);
  border: 5px solid var(--border);
  border-radius: 10px;
  padding: 44px 25px;
  position: relative;
  overflow: hidden;
  transition: border-color .25s;
  text-align: center;
}

.stat-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--accent), transparent);
  opacity: 0;
  transition: opacity .25s;
}

.stat-card:hover {
  background: rgb(139 0 0 / 15%);
  border-color: var(--border2);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(139, 0, 0, .18);
}

.stat-card:hover::after {
  opacity: 1;
}
```

Note: after Task 7, `border-radius: 10px;` here already became `border-radius: var(--r-xl);` — the snippets below assume Task 7 ran first.

- [ ] **Step 1: Reduce resting-state color intensity, keep the hover escalation**

```css
.stat-card {
  background: var(--bg3);
  border: 2px solid var(--border);
  border-radius: var(--r-xl);
  padding: 44px 25px;
  position: relative;
  overflow: hidden;
  transition: background .25s, border-color .25s;
  text-align: center;
}

.stat-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--accent), transparent);
  opacity: 0;
  transition: opacity .25s;
}

.stat-card:hover {
  background: rgb(139 0 0 / 12%);
  border-color: var(--border2);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(139, 0, 0, .18);
}

.stat-card:hover::after {
  opacity: 1;
}
```

Change rationale: border drops from an always-on 5px solid tinted border to the same 2px hairline+border-color-token treatment every other card in the app uses at rest (matching `.char-card`'s pattern), background drops from a 7%-tinted red wash to the neutral `--bg3` surface token — both now escalate to red only on `:hover`, matching the project's own Whisper-Until-Touched rule and the resting-state treatment already used elsewhere (e.g. `.char-card`).

- [ ] **Step 2: Restart and visual check**

Run: `curl -s -X POST http://localhost:4295/api/restart` then wait ~2s.
Via CDP, navigate to the dashboard (wherever `.stats-grid` renders — grep `stats-grid` in `index.html`/`scripts.js` to confirm the page), screenshot before/after comparison isn't needed since there's no "before" screenshot saved — just confirm the cards render with a neutral background at rest and escalate to red-tinted on a simulated `:hover` (CDP `Input.dispatchMouseEvent` moved over the card, or toggle the class via `evalJs` for a quick check: `document.querySelector('.stat-card').matches(':hover')` isn't settable directly — instead read `getComputedStyle` background before/after a real mouse-move event over the element).

- [ ] **Step 3: Commit**

```bash
git add web/public/styles.css
git commit -m "fix: quiet .stat-card resting state per Whisper-Until-Touched rule"
```

---

### Task 10: Touch targets — small icon/delete/carousel buttons (P2)

**Files:**
- Modify: `web/public/styles.css` — `.hooks-del-btn` (:4852), `.cdet-img-del-btn` (:4928), `.diary-item-del-btn` (:5044), `.v20-row-remove-btn` (:7787), `.v20-disc-info-btn` (:7893), `.cdet-carousel-btn` (:2234), `.locdet-carousel-btn` (:4501)

Follows the existing project pattern (confirmed at `styles.css:3664-3666` and `:6939`, `:10025-10028`): a `@media (pointer: coarse)` override bumping `min-height`/`min-width` to 44px, without touching the mouse-driven default sizing.

- [ ] **Step 1: Add coarse-pointer overrides**

Insert a new block near the other `@media (pointer: coarse)` blocks (e.g. right after the one at `styles.css:10025-10028`, or at the end of the file before the final `@media (max-width: 820px)` block at line 10355 — either location is consistent with the existing scattered-by-component pattern):

```css
@media (pointer: coarse) {
  .hooks-del-btn, .cdet-img-del-btn, .diary-item-del-btn,
  .v20-row-remove-btn, .v20-disc-info-btn {
    min-width: 44px;
    min-height: 44px;
  }
  .cdet-carousel-btn { min-width: 44px; }
  .locdet-carousel-btn { min-width: 44px; }
}
```

(`.cdet-carousel-btn`/`.locdet-carousel-btn` already have `height: 40px`/`44px` respectively, only width is under 44px — so only `min-width` is needed for those two; the other five need both dimensions bumped since they're 18-28px square.)

- [ ] **Step 2: Restart and verify**

Run: `curl -s -X POST http://localhost:4295/api/restart` then wait ~2s.

Via CDP, `Emulation.setDeviceMetricsOverride` isn't sufficient to simulate `pointer: coarse` (that's a separate media feature from viewport size) — CDP's `Emulation.setEmitTouchEventsForMouse` or launching Chrome with `--touch-events=enabled` doesn't reliably flip the CSS media query either. Instead, verify via `matchMedia`: run `evalJs("matchMedia('(pointer: coarse)').matches")` — if `false` (desktop Chrome, expected), directly assert the CSS rule *exists and is well-formed* by reading `document.styleSheets` for the new rule text, OR simpler: temporarily override via `evalJs` by injecting a `<style>` tag that forces the media query condition for the test, OR just read the raw CSS text via `fetch('/styles.css').then(r => r.text())` and regex-confirm the new block is present with the correct selectors and `44px` values (this is the most reliable option in a real Chromium instance without a physical touch device).

Run a verification script doing the `fetch('/styles.css')` + regex check.
Expected: the new `@media (pointer: coarse)` block is present in the served CSS with all 7 selectors and `44px` values.

- [ ] **Step 3: Commit**

```bash
git add web/public/styles.css
git commit -m "fix: 44px touch targets for delete/carousel icon buttons on coarse pointers"
```

---

### Task 11: Finish

- [ ] **Step 1: Full regression pass**

Run: `cd web && npm test` — expected: all existing backend tests still pass (this plan touches zero backend files, so this is a pure regression check, not expected to catch anything new).

Run: `node -c web/public/utils.js && node -c web/public/scripts.js && node -c web/public/locations.js && node -c web/public/audio-library.js` — expected: no output from any.

- [ ] **Step 2: Re-run the impeccable audit**

Run `/impeccable audit web/public` again. Expected improvements: Accessibility dimension score should rise (focus trap + restore now present everywhere, Escape consistent across all 17 modals, contrast fixed on the 9+ confirmed selectors); Theming dimension should rise slightly (radius tokens now real); Responsive should rise slightly (`#info-panel` fixed); Anti-Patterns should rise slightly (`.stat-card` resting state quieted).

- [ ] **Step 3: Clean up scratchpad verification scripts**

These were written to the scratchpad directory (not the repo) per the `run-sanguine-web` skill convention — confirm `git status` shows no stray scratchpad files inside the repo itself.

- [ ] **Step 4: Use superpowers:finishing-a-development-branch**

This repo has no separate feature branches (confirmed project convention from prior sessions) — everything commits directly to `master`. Follow the finishing skill's option menu; the established preference in this project has been "Оставить как есть" (leave as-is, no push) — but ask the user this time rather than assuming, since one turn's preference isn't standing authorization for all future turns.
