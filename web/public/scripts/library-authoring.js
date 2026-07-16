'use strict';
// Фаза I — создание/правка/удаление авторских элементов библиотеки (дисциплины,
// психические способности, достоинства, недостатки, факты биографии). Канон
// защищён на сервере (см. web/routes/library.js) — эта форма лишь собирает
// поля и вызывает POST/PUT/DELETE; список полей меняется в зависимости от
// «kind» (см. _LIB_KIND_CONFIG).

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

// Конфиг per-kind: какие поля показывать, как собрать тело запроса, как
// перезагрузить список после сохранения/удаления.
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
};

// Состояние текущей открытой модалки: kind + (для правки) slug/категория исходной записи.
let _libEditState = { kind: null, slug: null, category: null };

function _libLevelRowHtml(lvl = {}) {
  return `<div class="mod-fill-chips lib-level-row" style="align-items:flex-start;gap:6px;margin-bottom:6px">
    <input class="chr-form-input" style="width:60px" type="number" min="1" max="10" placeholder="№" data-lib-level-n value="${escAttr(lvl.level ?? '')}">
    <input class="chr-form-input" style="flex:1" placeholder="Название силы" data-lib-level-name value="${escAttr(lvl.name || '')}">
    <button type="button" class="lib-card-action-btn" data-lib-level-remove title="Убрать уровень">✕</button>
    <textarea class="chr-form-input" style="flex-basis:100%" rows="2" placeholder="Литературное описание" data-lib-level-literary>${escHtml(lvl.literary || '')}</textarea>
    <textarea class="chr-form-input" style="flex-basis:100%" rows="2" placeholder="Система" data-lib-level-system>${escHtml(lvl.system || '')}</textarea>
  </div>`;
}

function _libRenderLevels(levels) {
  const box = document.getElementById('lib-edit-levels');
  if (box) box.innerHTML = (levels && levels.length ? levels : [{}]).map(_libLevelRowHtml).join('');
}

function _libCollectLevels() {
  return Array.from(document.querySelectorAll('#lib-edit-levels .lib-level-row')).map(row => ({
    level: parseInt(row.querySelector('[data-lib-level-n]').value, 10) || 1,
    name: row.querySelector('[data-lib-level-name]').value.trim(),
    literary: row.querySelector('[data-lib-level-literary]').value.trim(),
    system: row.querySelector('[data-lib-level-system]').value.trim(),
  })).filter(l => l.name);
}

function _libSetFieldVisibility(fields) {
  document.querySelectorAll('#lib-edit-modal [data-lib-field]').forEach(el => {
    el.style.display = fields.includes(el.dataset.libField) ? '' : 'none';
  });
}

function _libFillCategorySelect(categories, selected) {
  const sel = document.getElementById('lib-edit-category-select');
  if (!sel) return;
  sel.innerHTML = categories.map(([v, label]) => `<option value="${escAttr(v)}">${escHtml(label)}</option>`).join('');
  if (selected) sel.value = selected;
}

function _libOpenCreateModal(kind, category) {
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  _libEditState = { kind, slug: null, category: category || null };
  document.getElementById('lib-edit-title').textContent = `Новое: ${cfg.title}`;
  document.getElementById('lib-edit-name').value = '';
  document.getElementById('lib-edit-clans').value = '';
  document.getElementById('lib-edit-category-text').value = '';
  document.getElementById('lib-edit-source').value = '';
  document.getElementById('lib-edit-note').value = '';
  document.getElementById('lib-edit-points').value = '';
  document.getElementById('lib-edit-description').value = '';
  document.getElementById('lib-edit-system').value = '';
  document.getElementById('lib-edit-error').style.display = 'none';
  if (cfg.categories) _libFillCategorySelect(cfg.categories, category);
  if (cfg.fields.includes('levels')) _libRenderLevels([]);
  _libSetFieldVisibility(cfg.fields);
  openModal('lib-edit-modal', '#lib-edit-name');
}

function _libFindRecord(kind, slug, category) {
  if (kind === 'disciplines') return _discBySlug(slug);
  if (kind === 'psychics') return _psyBySlug(slug);
  if (kind === 'merits') return (_meritsCache[category] || []).find(x => x.slug === slug);
  if (kind === 'flaws') return (_flawsCache[category] || []).find(x => x.slug === slug);
  if (kind === 'backgrounds') return _backgroundBySlug(category, slug);
  return null;
}

function _libOpenEditModal(kind, slug, category) {
  const cfg = _LIB_KIND_CONFIG[kind];
  const rec = _libFindRecord(kind, slug, category);
  if (!cfg || !rec) return;
  _libEditState = { kind, slug, category: category || null };
  document.getElementById('lib-edit-title').textContent = `Правка: ${cfg.title}`;
  document.getElementById('lib-edit-name').value = rec.name || '';
  document.getElementById('lib-edit-clans').value = rec.clans || '';
  document.getElementById('lib-edit-category-text').value = rec.category || '';
  document.getElementById('lib-edit-source').value = rec.source || '';
  document.getElementById('lib-edit-note').value = rec.note || '';
  document.getElementById('lib-edit-points').value = rec.points ?? '';
  document.getElementById('lib-edit-description').value = rec.description || '';
  document.getElementById('lib-edit-system').value = rec.system || '';
  document.getElementById('lib-edit-error').style.display = 'none';
  if (cfg.categories) _libFillCategorySelect(cfg.categories, category);
  if (cfg.fields.includes('levels')) _libRenderLevels(rec.levels || []);
  _libSetFieldVisibility(cfg.fields);
  openModal('lib-edit-modal', '#lib-edit-name');
}

async function _libSaveEdit() {
  const { kind, slug, category: origCategory } = _libEditState;
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  const errEl = document.getElementById('lib-edit-error');
  errEl.style.display = 'none';
  const name = document.getElementById('lib-edit-name').value.trim();
  if (!name) { errEl.textContent = 'Название обязательно'; errEl.style.display = ''; return; }

  const body = { name };
  if (cfg.fields.includes('clans')) body.clans = document.getElementById('lib-edit-clans').value.trim();
  if (cfg.fields.includes('category-text')) body.category = document.getElementById('lib-edit-category-text').value.trim();
  if (cfg.fields.includes('source')) body.source = document.getElementById('lib-edit-source').value.trim();
  if (cfg.fields.includes('note')) body.note = document.getElementById('lib-edit-note').value.trim();
  if (cfg.fields.includes('levels')) body.levels = _libCollectLevels();
  if (cfg.fields.includes('points')) body.points = parseInt(document.getElementById('lib-edit-points').value, 10) || 0;
  if (cfg.fields.includes('description')) body.description = document.getElementById('lib-edit-description').value.trim();
  if (cfg.fields.includes('system-text')) body.system = document.getElementById('lib-edit-system').value.trim();

  const category = cfg.categories ? document.getElementById('lib-edit-category-select').value : null;
  if (cfg.categories) body.category = category;

  const isEdit = !!slug;
  const url = isEdit
    ? (cfg.categories ? `/api/library/${kind}/${encodeURIComponent(category)}/${encodeURIComponent(slug)}` : `/api/library/${kind}/${encodeURIComponent(slug)}`)
    : `/api/library/${kind}`;

  const submitBtn = document.getElementById('lib-edit-submit');
  submitBtn.disabled = true;
  try {
    const r = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(x => x.json());
    if (!r.ok) { errEl.textContent = r.error || 'Ошибка сохранения'; errEl.style.display = ''; return; }
    closeModal('lib-edit-modal');
    await cfg.reload(category || origCategory);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = '';
  } finally {
    submitBtn.disabled = false;
  }
}

let _libDeleteState = { kind: null, slug: null, category: null };

function _libOpenDeleteModal(kind, slug, category) {
  const rec = _libFindRecord(kind, slug, category);
  _libDeleteState = { kind, slug, category: category || null };
  document.getElementById('lib-delete-body').textContent = `Удалить «${rec ? rec.name : slug}»? Это действие необратимо.`;
  openModal('lib-delete-modal');
}

async function _libConfirmDelete() {
  const { kind, slug, category } = _libDeleteState;
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  const url = cfg.categories
    ? `/api/library/${kind}/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`
    : `/api/library/${kind}/${encodeURIComponent(slug)}`;
  const r = await fetch(url, { method: 'DELETE' }).then(x => x.json()).catch(e => ({ error: e.message }));
  closeModal('lib-delete-modal');
  if (r.ok) await cfg.reload(category);
}

document.getElementById('lib-edit-cancel')?.addEventListener('click', () => closeModal('lib-edit-modal'));
document.getElementById('lib-edit-submit')?.addEventListener('click', _libSaveEdit);
document.getElementById('lib-edit-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('lib-edit-modal')) closeModal('lib-edit-modal');
});
document.getElementById('lib-edit-add-level')?.addEventListener('click', () => {
  document.getElementById('lib-edit-levels').insertAdjacentHTML('beforeend', _libLevelRowHtml());
});
document.getElementById('lib-edit-levels')?.addEventListener('click', e => {
  if (e.target.closest('[data-lib-level-remove]')) e.target.closest('.lib-level-row').remove();
});

document.getElementById('lib-delete-cancel')?.addEventListener('click', () => closeModal('lib-delete-modal'));
document.getElementById('lib-delete-confirm')?.addEventListener('click', _libConfirmDelete);
document.getElementById('lib-delete-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('lib-delete-modal')) closeModal('lib-delete-modal');
});

// «+ Добавить» — категория (для merits/flaws/backgrounds) берётся с активной подвкладки.
document.getElementById('page-library')?.addEventListener('click', e => {
  const addBtn = e.target.closest('[data-lib-add]');
  if (addBtn) {
    const kind = addBtn.dataset.libAdd;
    let category = null;
    if (kind === 'merits') category = document.querySelector('.merits-subtab-btn.active')?.dataset.meritCat;
    if (kind === 'flaws') category = document.querySelector('.flaws-subtab-btn.active')?.dataset.flawCat;
    if (kind === 'backgrounds') category = document.querySelector('.backgrounds-subtab-btn.active')?.dataset.bgCat;
    _libOpenCreateModal(kind, category);
    return;
  }
  const editBtn = e.target.closest('[data-lib-edit]');
  if (editBtn) {
    _libOpenEditModal(editBtn.dataset.libEdit, editBtn.dataset.libSlug, editBtn.dataset.libCategory);
    return;
  }
  const delBtn = e.target.closest('[data-lib-delete]');
  if (delBtn) {
    _libOpenDeleteModal(delBtn.dataset.libDelete, delBtn.dataset.libSlug, delBtn.dataset.libCategory);
  }
});
