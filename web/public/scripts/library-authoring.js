'use strict';
// Фаза I — создание авторских элементов библиотеки (дисциплины, психические
// способности, достоинства, недостатки, факты биографии, кланы, секты).
// Правка/удаление СУЩЕСТВУЮЩИХ элементов переехала в единую детейл-модалку
// (v20-sheet.js, K1, 2026-08-04) — этот файл отвечает только за форму
// создания (#lib-edit-modal) и общий источник конфигурации полей
// (_LIB_FIELD_DEFS/_LIB_KIND_CONFIG), который переиспользует и K1.
// Канон защищён на сервере (см. web/routes/library.js) — эта форма лишь
// собирает поля и вызывает POST/PUT; список полей меняется в зависимости
// от «kind» (см. _LIB_KIND_CONFIG).

const _LIB_MERIT_CATS = [
  ['physical', 'Физические'], ['mental', 'Умственные'],
  ['social', 'Социальные'], ['supernatural', 'Сверхъестественные'],
];
const _LIB_FLAW_CATS = [
  ['физические', 'Физические'], ['умственные', 'Умственные'],
  ['социальные', 'Социальные'], ['сверхъестественные', 'Сверхъестественные'],
];
const _LIB_BG_CATS = [
  ['general', 'Общие'], ['vampire', 'Вампиры'], ['ghoul', 'Гули и ревенанты'],
  ['mage', 'Маги'], ['changeling', 'Подменыши'],
];

// Единый источник разметки поля по ключу — переиспользуется формой создания
// (#lib-edit-modal) И режимом правки внутри детейл-модалки (K1,
// _v20RenderLibEditForm) — один рендерер, не два расходящихся куска HTML.
// «name» не входит в fields конкретного kind — рендерится отдельно, всегда первым.
const _LIB_FIELD_DEFS = {
  name:             { label: 'Название', type: 'text' },
  clans:            { label: 'Клан / принадлежность', type: 'text' },
  'category-text':  { label: 'Категория', type: 'text' },
  'category-select':{ label: 'Категория', type: 'select' },
  source:           { label: 'Источник', type: 'text' },
  note:             { label: 'Примечание', type: 'textarea', rows: 2 },
  points:           { label: 'Стоимость (очки)', type: 'number', min: 1, max: 7 },
  description:      { label: 'Описание', type: 'textarea', rows: 4 },
  'system-text':    { label: 'Уровни (по строке: «1: текст»)', type: 'textarea', rows: 4 },
  levels:           { label: 'Уровни силы', type: 'levels' },
  'discipline-list':{ label: 'Дисциплины клана', type: 'text' },
  weakness:         { label: 'Слабость', type: 'textarea', rows: 2 },
};

// Ключ поля → свойство записи, если они называются по-разному (историческое
// расхождение, было и в прежней версии формы: category-text читает rec.category,
// system-text — rec.system).
const _LIB_FIELD_RECORD_KEY = {
  'category-text': 'category',
  'system-text': 'system',
  'discipline-list': 'disciplines',
};

// Конфиг per-kind: какие поля показывать (порядок = порядок в форме), как
// собрать тело запроса, как перезагрузить список после сохранения/удаления.
// clans/sects — K3/K4 (2026-08-04): «Секта» клана переиспользует уже
// существующий тип поля category-select (список опций — секты из K4, не
// второй хардкод того же списка) с подписью, переопределённой на «Секта».
const _LIB_KIND_CONFIG = {
  disciplines: {
    title: 'дисциплину', fields: ['clans', 'source', 'note', 'levels'],
    reload: () => { _disciplinesCache = null; return loadLibrary(); },
  },
  psychics: {
    title: 'психическую способность', fields: ['category-text', 'source', 'note', 'levels'],
    reload: () => { _psychicsCache = null; return loadPsychicsLibrary(); },
  },
  merits: {
    title: 'достоинство', fields: ['category-select', 'points', 'description'], categories: _LIB_MERIT_CATS,
    reload: category => loadMeritsLibrary(category),
  },
  flaws: {
    title: 'недостаток', fields: ['category-select', 'points', 'description'], categories: _LIB_FLAW_CATS,
    reload: category => loadFlawsLibrary(category),
  },
  backgrounds: {
    title: 'факт биографии', fields: ['category-select', 'description', 'system-text'], categories: _LIB_BG_CATS,
    reload: category => loadBackgroundsLibrary(category),
  },
  clans: {
    title: 'клан', fields: ['category-select', 'discipline-list', 'weakness', 'source', 'note', 'description'],
    fieldLabels: { 'category-select': 'Секта' }, categoryRecordKey: 'sect',
    categoriesAsync: async () => (await ensureSects()).map(s => [s.name, s.name]),
    reload: () => { _clansCache = null; return loadKindred('clans'); },
  },
  sects: {
    title: 'секту', fields: ['source', 'note', 'description'],
    reload: () => { _sectsCache = null; return loadKindred('sects'); },
  },
};

function _libLevelRowHtml(lvl = {}) {
  return `<div class="mod-fill-chips lib-level-row" style="align-items:flex-start;gap:6px;margin-bottom:6px">
    <input class="chr-form-input" style="width:60px" type="number" min="1" max="10" placeholder="№" data-lib-level-n value="${escAttr(lvl.level ?? '')}">
    <input class="chr-form-input" style="flex:1" placeholder="Название силы" data-lib-level-name value="${escAttr(lvl.name || '')}">
    <button type="button" class="lib-card-action-btn" data-lib-level-remove title="Убрать уровень">✕</button>
    <textarea class="chr-form-input" style="flex-basis:100%" rows="2" placeholder="Литературное описание" data-lib-level-literary>${escHtml(lvl.literary || '')}</textarea>
    <textarea class="chr-form-input" style="flex-basis:100%" rows="2" placeholder="Система" data-lib-level-system>${escHtml(lvl.system || '')}</textarea>
  </div>`;
}

// root — контейнер, внутри которого искать/собирать поля: либо #lib-edit-modal
// (форма создания), либо #v20-disc-modal-body (режим правки внутри K1). Оба
// используют одну и ту же разметку (_libFieldRowHtml), поэтому один и тот же
// набор функций работает для обоих без дублирования.
function _libFieldRowHtml(key, value, labelOverride) {
  const def = _LIB_FIELD_DEFS[key];
  if (!def) return '';
  const label = labelOverride || def.label;
  if (key === 'levels') {
    return `<div class="chr-form-group" data-lib-field="levels">
      <label class="chr-form-label">${escHtml(label)}</label>
      <div class="lib-levels-list" data-lib-levels-list></div>
      <button type="button" class="mod-fill-add-btn" data-lib-add-level>+ Уровень</button>
    </div>`;
  }
  if (def.type === 'select') {
    return `<div class="chr-form-group" data-lib-field="${key}">
      <label class="chr-form-label">${escHtml(label)}</label>
      <select class="chr-form-input" data-lib-input></select>
    </div>`;
  }
  if (def.type === 'textarea') {
    return `<div class="chr-form-group" data-lib-field="${key}">
      <label class="chr-form-label">${escHtml(label)}</label>
      <textarea class="chr-form-input chr-form-textarea" rows="${def.rows || 3}" data-lib-input>${escHtml(value || '')}</textarea>
    </div>`;
  }
  const numAttrs = def.type === 'number' ? ` type="number" min="${def.min ?? ''}" max="${def.max ?? ''}"` : ' type="text" autocomplete="off"';
  return `<div class="chr-form-group" data-lib-field="${key}">
    <label class="chr-form-label">${key === 'name' ? label + ' *' : label}</label>
    <input class="chr-form-input"${numAttrs} value="${escAttr(value ?? '')}" data-lib-input>
  </div>`;
}

// Полная разметка формы (имя всегда первым + поля kind.fields) — общий вызов
// для формы создания и для режима правки K1.
function _libFormFieldsHtml(kind, rec = {}) {
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return '';
  const labels = cfg.fieldLabels || {};
  let html = _libFieldRowHtml('name', rec.name || '');
  for (const key of cfg.fields) {
    if (key === 'levels') { html += _libFieldRowHtml('levels'); continue; }
    if (key === 'category-select') { html += _libFieldRowHtml(key, '', labels[key]); continue; }
    const recKey = _LIB_FIELD_RECORD_KEY[key] || key;
    html += _libFieldRowHtml(key, rec[recKey], labels[key]);
  }
  return html;
}

function _libRenderLevels(root, levels) {
  const box = root.querySelector('[data-lib-levels-list]');
  if (box) box.innerHTML = (levels && levels.length ? levels : [{}]).map(_libLevelRowHtml).join('');
}

function _libCollectLevels(root) {
  return Array.from(root.querySelectorAll('[data-lib-levels-list] .lib-level-row')).map(row => ({
    level: parseInt(row.querySelector('[data-lib-level-n]').value, 10) || 1,
    name: row.querySelector('[data-lib-level-name]').value.trim(),
    literary: row.querySelector('[data-lib-level-literary]').value.trim(),
    system: row.querySelector('[data-lib-level-system]').value.trim(),
  })).filter(l => l.name);
}

function _libFieldInput(root, key) {
  return root.querySelector(`[data-lib-field="${key}"] [data-lib-input]`);
}

async function _libFillCategorySelect(root, kind, selected) {
  const cfg = _LIB_KIND_CONFIG[kind];
  const sel = _libFieldInput(root, 'category-select');
  if (!sel) return;
  const options = cfg.categoriesAsync ? await cfg.categoriesAsync() : (cfg.categories || []);
  sel.innerHTML = options.map(([v, label]) => `<option value="${escAttr(v)}">${escHtml(label)}</option>`).join('');
  if (selected) sel.value = selected;
}

// Заполняет root (сам контейнер полей — не модалка целиком) разметкой формы
// (создание ИЛИ правка — одна функция на оба случая) и текущими значениями
// rec (пустой объект для создания).
async function _libRenderForm(root, kind, rec = {}) {
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  root.innerHTML = _libFormFieldsHtml(kind, rec);
  if (cfg.fields.includes('category-select')) {
    const selected = rec[cfg.categoryRecordKey || 'category'] || '';
    await _libFillCategorySelect(root, kind, selected);
  }
  if (cfg.fields.includes('levels')) _libRenderLevels(root, rec.levels || []);
}

function _libCollectForm(root, kind) {
  const cfg = _LIB_KIND_CONFIG[kind];
  const body = { name: (_libFieldInput(root, 'name')?.value || '').trim() };
  for (const key of cfg.fields) {
    if (key === 'levels') { body.levels = _libCollectLevels(root); continue; }
    if (key === 'category-select') continue; // собирается отдельно ниже (ключ различается: category/sect)
    const recKey = _LIB_FIELD_RECORD_KEY[key] || key;
    body[recKey] = (_libFieldInput(root, key)?.value || '').trim();
  }
  if (cfg.fields.includes('category-select')) {
    const val = _libFieldInput(root, 'category-select')?.value || '';
    body[cfg.categoryRecordKey || 'category'] = val;
  }
  return body;
}

// Единая точка поиска записи по kind/slug/category — используется и формой
// создания (для reload после сохранения — не нужен), и K1 (v20-sheet.js) для
// заполнения режима правки и текста подтверждения удаления.
function _libFindRecord(kind, slug, category) {
  if (kind === 'disciplines') return _discBySlug(slug);
  if (kind === 'psychics') return _psyBySlug(slug);
  if (kind === 'merits') return (_meritsCache[category] || []).find(x => x.slug === slug);
  if (kind === 'flaws') return (_flawsCache[category] || []).find(x => x.slug === slug);
  if (kind === 'backgrounds') return _backgroundBySlug(category, slug);
  if (kind === 'clans') return _clanBySlug(slug);
  if (kind === 'sects') return _sectBySlug(slug);
  return null;
}

// ── Форма создания (#lib-edit-modal) — без правки, только POST ──────────────
let _libCreateKind = null;

async function _libOpenCreateModal(kind, category) {
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  _libCreateKind = kind;
  document.getElementById('lib-edit-title').textContent = `Новое: ${cfg.title}`;
  const fieldsBox = document.getElementById('lib-edit-fields');
  document.getElementById('lib-edit-error').style.display = 'none';
  const rec = cfg.categoryRecordKey ? {} : { category };
  await _libRenderForm(fieldsBox, kind, rec);
  openModal('lib-edit-modal', '[data-lib-field="name"] input');
}

async function _libSaveCreate() {
  const kind = _libCreateKind;
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  const errEl = document.getElementById('lib-edit-error');
  errEl.style.display = 'none';
  const fieldsBox = document.getElementById('lib-edit-fields');
  const body = _libCollectForm(fieldsBox, kind);
  if (!body.name) { errEl.textContent = 'Название обязательно'; errEl.style.display = ''; return; }

  const submitBtn = document.getElementById('lib-edit-submit');
  submitBtn.disabled = true;
  try {
    const r = await fetch(`/api/library/${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(x => x.json());
    if (!r.ok) { errEl.textContent = r.error || 'Ошибка сохранения'; errEl.style.display = ''; return; }
    closeModal('lib-edit-modal');
    await cfg.reload(body.category);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = '';
  } finally {
    submitBtn.disabled = false;
  }
}

document.getElementById('lib-edit-cancel')?.addEventListener('click', () => closeModal('lib-edit-modal'));
document.getElementById('lib-edit-submit')?.addEventListener('click', _libSaveCreate);
document.getElementById('lib-edit-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('lib-edit-modal')) closeModal('lib-edit-modal');
  if (e.target.closest('[data-lib-add-level]')) {
    document.querySelector('#lib-edit-modal [data-lib-levels-list]')?.insertAdjacentHTML('beforeend', _libLevelRowHtml());
  }
  if (e.target.closest('[data-lib-level-remove]')) e.target.closest('.lib-level-row').remove();
});

// «+ Добавить» — категория (для merits/flaws/backgrounds) берётся с активной
// подвкладки; один обработчик на контейнер #page-library хватает и на
// clans/sects внутри вкладки «Сородичи».
function _libWireAddButtons(containerId) {
  document.getElementById(containerId)?.addEventListener('click', e => {
    const addBtn = e.target.closest('[data-lib-add]');
    if (!addBtn) return;
    const kind = addBtn.dataset.libAdd;
    let category = null;
    if (kind === 'merits') category = document.querySelector('.merits-subtab-btn.active')?.dataset.meritCat;
    if (kind === 'flaws') category = document.querySelector('.flaws-subtab-btn.active')?.dataset.flawCat;
    if (kind === 'backgrounds') category = document.querySelector('.backgrounds-subtab-btn.active')?.dataset.bgCat;
    _libOpenCreateModal(kind, category);
  });
}
_libWireAddButtons('page-library');
