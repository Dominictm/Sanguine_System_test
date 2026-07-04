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
    ov.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg">${escHtml(message)}</div>
        <div class="confirm-acts">
          <button class="chr-modal-btn cancel" id="_conf-cancel">${escHtml(cancelText)}</button>
          <button class="chr-modal-btn ${danger ? 'danger' : 'create'}" id="_conf-ok">${escHtml(confirmText)}</button>
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
