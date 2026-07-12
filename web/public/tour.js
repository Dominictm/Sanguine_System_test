// ═══════════════════════════════════════════════════════════════
// Onboarding tour — ceremonial spotlight walkthrough (zero-dep)
// ═══════════════════════════════════════════════════════════════
// Steps target the sidebar (always visible, data-independent) so the tour works
// on a brand-new install with no city/characters yet. Workflow, not features.
const TOUR_SEEN_KEY = 'sanguine-tour-seen';
const TOUR_STEPS = [
  {
    sel: '.city-switch',
    label: 'Шаг 1 · 5',
    title: 'Начни с домена',
    body: 'Каждый город — отдельный сеттинг: своя политика, фракции, локации и персонажи. Активный домен переключается здесь, а кнопка «+» создаёт новый.',
  },
  {
    sel: '.nav-item[data-page="characters"]',
    label: 'Шаг 2 · 5',
    title: 'Реестр персонажей',
    body: 'Вампиры, смертные и феи домена. Клик по карточке открывает досье: внешность, дисциплины, связи, дневники. Фильтры сверху сужают список по линейке и статусу.',
  },
  {
    sel: '.nav-item[data-page="chronicles-page"]',
    label: 'Шаг 3 · 5',
    title: 'Хроники и модули',
    body: 'Хроника — это кампания. Внутри неё живут модули — отдельные игровые сессии со сценарием, событиями и НПС.',
  },
  {
    sel: '.nav-item[data-page="threads"]',
    label: 'Шаг 4 · 5',
    title: 'Открытые нити',
    body: 'Незавершённые сюжетные нити, ждущие развязки. Здесь видно, что осталось разрешить, и можно менять их статус и приоритет.',
  },
  {
    sel: '.nav-item[data-page="tools"]',
    label: 'Шаг 5 · 5',
    title: 'Инструменты Рассказчика',
    body: 'Создание доменов, НПС и локаций, генерация контента и проверка целостности данных. Этот тур всегда можно перезапустить кнопкой «?» у логотипа.',
  },
];

let _tourIdx = 0;
let _tourEls = null;

function _tourTeardown() {
  if (_tourEls) {
    _tourEls.backdrop.remove();
    _tourEls.spotlight.remove();
    _tourEls.card.remove();
    _tourEls = null;
  }
  window.removeEventListener('resize', _tourReposition);
  window.removeEventListener('keydown', _tourKey);
}

function _tourFinish() {
  _tourTeardown();
  try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch {}
}

function _tourNext() {
  if (_tourIdx < TOUR_STEPS.length - 1) { _tourIdx++; _tourRender(); }
  else _tourFinish();
}

function _tourPrev() {
  if (_tourIdx > 0) { _tourIdx--; _tourRender(); }
}

function _tourKey(e) {
  if (e.key === 'Escape')                            _tourFinish();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') _tourNext();
  else if (e.key === 'ArrowLeft')                    _tourPrev();
}

function _tourReposition() {
  if (!_tourEls) return;
  const target = document.querySelector(TOUR_STEPS[_tourIdx].sel);
  if (!target) { _tourFinish(); return; }
  const r = target.getBoundingClientRect();
  const pad = 6;
  const sp = _tourEls.spotlight;
  sp.style.top    = `${r.top - pad}px`;
  sp.style.left   = `${r.left - pad}px`;
  sp.style.width  = `${r.width + pad * 2}px`;
  sp.style.height = `${r.height + pad * 2}px`;
  // Card sits to the right of the sidebar target, vertically aligned, clamped to viewport.
  const card  = _tourEls.card;
  const gap   = 16;
  const cardW = card.offsetWidth  || 340;
  const cardH = card.offsetHeight || 180;
  let left = r.right + gap;
  if (left + cardW > window.innerWidth - 12) left = Math.max(12, r.left - cardW - gap);
  let top = r.top;
  if (top + cardH > window.innerHeight - 12) top = Math.max(12, window.innerHeight - cardH - 12);
  card.style.left = `${left}px`;
  card.style.top  = `${top}px`;
}

function _tourRender() {
  const step = TOUR_STEPS[_tourIdx];
  if (!document.querySelector(step.sel)) { _tourNext(); return; }
  const last = _tourIdx === TOUR_STEPS.length - 1;
  _tourEls.card.innerHTML = `
    <div class="tour-step-label">${escHtml(step.label)}</div>
    <div class="tour-card-title">${escHtml(step.title)}</div>
    <div class="tour-card-body">${escHtml(step.body)}</div>
    <div class="tour-actions">
      <button type="button" class="tour-btn tour-btn-ghost" data-act="skip">Пропустить</button>
      <div class="tour-actions-right">
        <button type="button" class="tour-btn tour-btn-ghost" data-act="prev"${_tourIdx === 0 ? ' disabled' : ''}>Назад</button>
        <button type="button" class="tour-btn tour-btn-primary" data-act="next">${last ? 'Готово' : 'Далее'}</button>
      </div>
    </div>`;
  _tourReposition();
}

function startTour() {
  if (_tourEls) return;
  _tourIdx = 0;
  const backdrop  = document.createElement('div'); backdrop.id  = 'tour-backdrop';
  const spotlight = document.createElement('div'); spotlight.id = 'tour-spotlight';
  const card      = document.createElement('div'); card.id      = 'tour-card';
  document.body.append(backdrop, spotlight, card);
  _tourEls = { backdrop, spotlight, card };
  backdrop.addEventListener('click', _tourNext);
  card.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next')      _tourNext();
    else if (act === 'prev') _tourPrev();
    else if (act === 'skip') _tourFinish();
  });
  window.addEventListener('resize', _tourReposition);
  window.addEventListener('keydown', _tourKey);
  _tourRender();
}

document.getElementById('btn-tour')?.addEventListener('click', startTour);

// First-run auto-launch (once). Wait for the sidebar and initial load to settle.
window.addEventListener('load', () => {
  let seen = false;
  try { seen = localStorage.getItem(TOUR_SEEN_KEY) === '1'; } catch {}
  if (!seen && document.querySelector('.city-switch')) setTimeout(startTour, 900);
});
