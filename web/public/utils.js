// ── Shared browser-side utilities ──────────────────────────────────────────
// Pure/self-contained helpers used across the SPA. No module system in this
// static frontend — loaded via <script> before scripts.js (see index.html),
// declares plain globals. Вынесено из scripts.js (E2.1).

// NOTE: _NTR MUST mirror CYRILLIC_TR in web/lib/parsers.js (this is the browser copy —
// no module system in the static SPA). A unit test (slugify — browser parity) enforces it.
const _NTR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
// _LATIN_TR mirrors LATIN_TR in web/lib/parsers.js — non-decomposing Latin letters.
const _LATIN_TR = { ø:'o', ł:'l', đ:'d', ı:'i', ß:'ss', æ:'ae', œ:'oe', þ:'th', ð:'d' };
function slugifyJS(s) { return (s || '').toLowerCase().split('').map(c => _NTR[c] !== undefined ? _NTR[c] : c).join('').normalize('NFKD').replace(/[̀-ͯ]/g, '').split('').map(c => _LATIN_TR[c] !== undefined ? _LATIN_TR[c] : c).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_'); }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

// Иконка-тултип с пояснением поля — ставится сразу после текста лейбла/названия.
// Всплывающий текст появляется справа от иконки при наведении/фокусе (см. .field-tip
// в styles.css). Используется во всех формах создания/редактирования (сценарий,
// персонаж, локация, город) — единый механизм, не дублировать под другим именем.
function fieldTip(text) {
  if (!text) return '';
  return ` <span class="field-tip" tabindex="0" data-tip="${escAttr(text)}">ⓘ</span>`;
}

// ── Toast / Confirm utilities ──────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) { console.error(message); return; }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

function showConfirm(message, { danger = false, confirmText = 'Подтвердить', cancelText = 'Отмена' } = {}) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.id = 'confirm-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', '_conf-msg');
    ov.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg" id="_conf-msg">${escHtml(message)}</div>
        <div class="confirm-acts">
          <button class="chr-modal-btn ${danger ? 'danger' : 'create'}" id="_conf-ok">${escHtml(confirmText)}</button>
          <button class="chr-modal-btn cancel" id="_conf-cancel">${escHtml(cancelText)}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const cleanup = (result) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(result); };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(false); };
    document.addEventListener('keydown', onKey);
    ov.querySelector('#_conf-ok').onclick     = () => cleanup(true);
    ov.querySelector('#_conf-cancel').onclick = () => cleanup(false);
    ov.addEventListener('click', e => { if (e.target === ov) cleanup(false); });
    ov.querySelector('#_conf-ok').focus();
  });
}

// ── Import from JSON (обратная операция для «⇩ Экспорт» на персонажах/локациях) ──
// `kind` — 'characters' | 'locations', должен совпадать с ключом тела запроса
// и последним сегментом /api/import/<kind>. Файл должен быть тем же JSON-массивом,
// что отдаёт /api/export/<kind> (обязательно поле `raw` — полное содержимое карточки).
async function importCardsFromFile(kind, file, onDone) {
  if (!file) return;
  let items;
  try {
    items = JSON.parse(await file.text());
  } catch (e) {
    showToast('Не удалось прочитать JSON-файл: ' + e.message, 'error');
    return;
  }
  if (!Array.isArray(items) || !items.length) {
    showToast('Файл не содержит массива для импорта', 'warning');
    return;
  }
  try {
    const r = await fetch(`/api/import/${kind}${window.location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [kind]: items }),
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.error || 'Ошибка импорта');
    const parts = [`Импортировано: ${result.created.length}`];
    if (result.skipped?.length) parts.push(`уже есть (пропущено): ${result.skipped.length}`);
    if (result.errors?.length)  parts.push(`ошибок: ${result.errors.length}`);
    showToast(parts.join(', '), result.errors?.length ? 'warning' : 'success');
    onDone?.();
  } catch (e) {
    showToast('Импорт не удался: ' + e.message, 'error');
  }
}

function getOrigLabel(id) {
  return {
    'btn-new-city':    'Создать домен',
    'btn-new-npc':     'Создать карточку',
    'btn-validate':    'Проверить',
    'btn-validate-fix':'Исправить автоматически',
  }[id] || 'Выполнить';
}

// ── Generic modal focus-trap ─────────────────────────────────────────────────
// Every modal in this app toggles visibility the same way: a `.chr-modal-backdrop`
// or `.modal-overlay` element gains/loses an `.open` class (see scripts.js/locations.js
// open/close functions), or — for the dynamically-created `#confirm-overlay`
// (showConfirm above) — is appended/removed from <body> outright. Rather than
// hooking every individual open/close call site (dozens, spread across two files),
// a single MutationObserver watches for either signal and traps Tab/Shift+Tab
// inside whichever modal is currently open, restoring focus to the element that
// triggered it on close.
(function () {
  let active = null; // { el, prevFocus, handler }

  function focusableEls(container) {
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
  }

  function trap(container) {
    if (active) release();
    const prevFocus = document.activeElement;
    const handler = e => {
      if (e.key !== 'Tab') return;
      const els = focusableEls(container);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    container.addEventListener('keydown', handler);
    active = { el: container, prevFocus, handler };
    (focusableEls(container)[0] || container).focus();
  }

  function release() {
    if (!active) return;
    active.el.removeEventListener('keydown', active.handler);
    if (active.prevFocus && document.body.contains(active.prevFocus)) active.prevFocus.focus();
    active = null;
  }

  function watch(el) {
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.attributeName !== 'class') continue;
        if (el.classList.contains('open')) { if (!active || active.el !== el) trap(el); }
        else if (active && active.el === el) release();
      }
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  document.querySelectorAll('.chr-modal-backdrop, .modal-overlay').forEach(watch);

  // #confirm-overlay (and any future modal appended straight onto <body>, already
  // visible/open at insertion — no separate `.open` toggle to observe).
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement && node.id === 'confirm-overlay') trap(node);
      }
      for (const node of m.removedNodes) {
        if (node instanceof HTMLElement && active && active.el === node) release();
      }
    }
  }).observe(document.body, { childList: true });
})();

// ── apiFetch: opt-in helper for consistent fetch error handling ────────────
// docs/audit/2026-07-09-project-improvement-plan.md P1.7 found ~140 raw
// fetch() calls across the frontend with inconsistent .catch()/.ok handling
// (some silently swallow errors, some don't check status at all). Rewriting
// all 140 at once was explicitly out of scope (too much surface for one
// pass) — this helper exists so NEW code, and code touched incidentally
// while fixing something else, has a one-line consistent option instead of
// hand-rolling try/catch + .ok checks again. Throws on network failure or a
// non-2xx response (with the parsed JSON body's `.error` if present).
async function apiFetch(url, opts) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error(`Сеть недоступна: ${e.message}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Запрос не удался (${res.status})`);
  return body;
}
