// Вынесено из scripts.js (E2.3): страница локаций, детальная модалка, редактор/генератор, панель локаций модуля.
// Зависит от глобалей: STATE, CITY, escHtml, escAttr, showToast, showConfirm (см. utils.js), fetch/document.

// ═══════════════════════════════════════════════════════════════
// Locations
// ═══════════════════════════════════════════════════════════════

const ZONE_CLASS_LABELS = {
  elysium:    '🏛️ Элизиум',
  nosferatu:  '🟣 Носферату',
  neutral:    '🟡 Нейтральная',
  danger:     '🔴 Опасная',
  other:      '📍 Локация',
};

const MASQ_BADGE_LABELS = {
  low:     '🟢 Низкий',
  medium:  '🟡 Средний',
  high:    '🔴 Высокий',
};

function zoneClass(zone) {
  if (!zone) return 'other';
  const z = zone.toLowerCase();
  if (z.includes('элизиум'))                return 'elysium';
  if (z.includes('носферату'))              return 'nosferatu';
  if (z.includes('нейтральн'))              return 'neutral';
  if (z.includes('опасн') || (z.includes('шабаш') && !z.includes('нейтральн'))) return 'danger';
  return 'other';
}

async function loadLocations() {
  if (STATE.locations.length) { renderLocations(); return; }
  document.getElementById('locs-grid').innerHTML =
    '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    const data = await fetch('/api/locations').then(r => r.json());
    STATE.locations = Array.isArray(data) ? data : [];
    populateDistrictFilter();
    renderLocations();
  } catch {
    document.getElementById('locs-grid').innerHTML =
      '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить локации</div>';
  }
}

function populateDistrictFilter() {
  const sel = document.getElementById('loc-filter-district');
  const current = sel.value;
  const districts = [...new Set(
    STATE.locations.map(l => l.district).filter(Boolean)
  )].sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, 'ru');
  });
  sel.innerHTML = '<option value="all">Все округа</option>' +
    districts.map(d => `<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('');
  if (districts.includes(current)) sel.value = current;
}

function renderLocations() {
  const { zone, masq, district, search } = STATE.locFilter;
  let list = STATE.locations;
  if (zone     !== 'all') list = list.filter(l => zoneClass(l.zone) === zone);
  if (masq     !== 'all') list = list.filter(l => l.masqueradeLevel === masq);
  if (district !== 'all') list = list.filter(l => l.district === district);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(l =>
      (l.title || l.slug).toLowerCase().includes(q) ||
      (l.subtype      || '').toLowerCase().includes(q) ||
      (l.district     || '').toLowerCase().includes(q) ||
      (l.neighborhood || '').toLowerCase().includes(q) ||
      (l.address      || '').toLowerCase().includes(q)
    );
  }

  document.getElementById('locations-sub').textContent = `${list.length} локаций`;

  const grid = document.getElementById('locs-grid');
  if (!list.length) {
    grid.innerHTML = '<div class="loading-state" style="height:100px">Локации не найдены</div>';
    return;
  }
  grid.innerHTML = list.map((loc, i) =>
    _locCardHtml(loc, { delay: `style="animation-delay:${Math.min(i, 12) * 30}ms"` })
  ).join('');
  fitLocTitles();
}

// Карточка локации (`.loc-card`) — общий источник разметки для главной сетки
// локаций И для «Связанных локаций» на странице модуля (см. _renderModuleLocPanel),
// чтобы вторая не превращалась в отдельный обеднённый список-строку.
function _locCardHtml(loc, { delay = '', overlayExtra = '' } = {}) {
  const zc    = zoneClass(loc.zone);
  const mLvl  = loc.masqueradeLevel || 'unknown';
  const masqBadge = MASQ_BADGE_LABELS[mLvl]
    ? `<span class="badge badge-masq-${mLvl}">${MASQ_BADGE_LABELS[mLvl]}</span>`
    : '';
  const zoneBadge = `<span class="badge badge-loc-${zc}">${ZONE_CLASS_LABELS[zc]}</span>`;

  const distLine = [loc.district, loc.neighborhood].filter(Boolean).map(escHtml).join(' · ');
  const cardTitle = loc.subtype || loc.title || loc.slug;
  const textBlock = `
    <div class="loc-title">${escHtml(cardTitle)}</div>
    ${distLine    ? `<div class="loc-district">${distLine}</div>` : ''}
    ${loc.address ? `<div class="loc-address">${escHtml(loc.address)}</div>` : ''}
    <div class="loc-badges">${zoneBadge}${masqBadge}</div>`;

  if (loc.imageUrl) {
    return `<div class="loc-card has-art" data-slug="${escHtml(loc.slug)}" ${delay}>
      <img class="loc-card-img" src="${loc.imageUrl}" alt="${escHtml(loc.title || loc.slug)}" loading="lazy" decoding="async">
      <div class="loc-card-overlay">${textBlock}</div>
      ${overlayExtra}
    </div>`;
  }
  return `<div class="loc-card" data-slug="${escHtml(loc.slug)}" ${delay}>
    <span class="loc-zone-icon">${ZONE_CLASS_LABELS[zc][0]}</span>
    ${textBlock}
    ${overlayExtra}
  </div>`;
}

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

let _currentLocSlug = null;

function openLocDetail(slug, keepTab) {
  const loc = STATE.locations.find(l => l.slug === slug);
  if (!loc) return;
  _currentLocSlug = slug;

  const zc   = zoneClass(loc.zone);
  const mLvl = loc.masqueradeLevel || 'unknown';

  const imgCol = loc.imageUrl
    ? `<div class="locdet-carousel" id="locdet-carousel">
        <img class="locdet-carousel-img" id="locdet-carousel-img" src="${loc.imageUrl}" alt="${escHtml(loc.title || loc.slug)}">
        <div class="locdet-carousel-overlay" id="locdet-carousel-overlay"></div>
        <button class="locdet-carousel-btn prev" id="locdet-carousel-prev" title="Предыдущее">&#8249;</button>
        <button class="locdet-carousel-btn next" id="locdet-carousel-next" title="Следующее">&#8250;</button>
        <div class="locdet-carousel-dots" id="locdet-carousel-dots"></div>
       </div>`
    : `<div class="locdet-no-img">${ZONE_CLASS_LABELS[zc][0]}</div>`;

  // ── Panels content ────────────────────────────────────────────

  const metaFields = [
    ['subtype',      'Название',   loc.subtype],
    ['district',     'Округ',      loc.district],
    ['neighborhood', 'Район',      loc.neighborhood],
    ['address',      'Адрес',      loc.address],
    ['control',      'Контроль',   loc.control],
  ];
  const metaViewHtml = `<div class="locdet-table">${[
    ...metaFields.filter(([, , v]) => v).map(([, k, v]) =>
      `<div class="locdet-row"><div class="locdet-key">${escHtml(k)}</div><div class="locdet-val">${escHtml(v)}</div></div>`),
    loc.zone ? `<div class="locdet-row"><div class="locdet-key">Зона</div><div class="locdet-val">${escHtml(loc.zone)}</div></div>` : '',
  ].filter(Boolean).join('')}</div>`;
  const metaEditHtml = `<div class="locdet-edit-fields">${metaFields.map(([key, label, val]) =>
    `<div class="locdet-field-row">
       <label class="locdet-field-lbl">${escHtml(label)}</label>
       <input class="form-control locdet-field-inp" id="locdet-meta-${key}" value="${escHtml(val || '')}" placeholder="${escHtml(label)}">
     </div>`).join('')}</div>`;

  const atmViewHtml = loc.atmosphere
    ? `<div class="locdet-atm">${escHtml(loc.atmosphere)}</div>`
    : '<div class="cdet-empty">Описание не заполнено</div>';
  const atmEditHtml = `<textarea class="cdet-edit-textarea" id="locdet-atm-ta" rows="12">${escHtml(loc.atmosphere || '')}</textarea>`;

  const vtmSections = [
    ['Статус',            loc.locStatus],
    ['Фракция',           loc.faction],
    ['Постоянные фигуры', loc.figures],
    ['Угрозы',            loc.threats],
    ['Маскарад',          loc.masquerade],
  ].filter(([, v]) => v);
  const vtmParts = [];
  if (loc.vtmText) vtmParts.push(`<div class="locdet-atm">${escHtml(loc.vtmText)}</div>`);
  vtmSections.forEach(([k, v]) => vtmParts.push(
    `<div class="vtm-section"><div class="vtm-lbl">${escHtml(k)}</div><div class="vtm-body">${escHtml(v)}</div></div>`
  ));
  const vtmViewHtml = vtmParts.length
    ? vtmParts.join('<div class="diary-divider"></div>')
    : '<div class="cdet-empty">Контекст не заполнен</div>';
  const vtmEditHtml = `<div class="cdet-section-title" style="margin-bottom:6px">Описание (проза)</div>
    <textarea class="cdet-edit-textarea" id="locdet-vtm-ta" rows="10">${escHtml(loc.vtmText || '')}</textarea>`;

  const keyPointsHtml = loc.keyPoints?.length
    ? `<div class="locdet-table">${loc.keyPoints.map(kp =>
        `<div class="locdet-row">
          <div class="locdet-key">${escHtml(kp.place)}</div>
          <div class="locdet-val">${escHtml(kp.desc)}</div>
        </div>`).join('')}</div>`
    : '<div class="cdet-empty">Ключевые точки не заполнены</div>';
  const keyRawTable = (loc.keyPoints || []).map(kp => `| ${kp.place} | ${kp.desc} |`).join('\n')
    || '| Место | Описание |\n|---|---|\n| | |';
  const keyEditHtml = `<textarea class="cdet-edit-textarea" id="locdet-keys-ta" rows="10">${escHtml(keyRawTable)}</textarea>`;

  const sensViewHtml = loc.sensoryPalette?.length
    ? `<div class="locdet-table">${loc.sensoryPalette.map(s =>
        `<div class="locdet-row">
          <div class="locdet-key">${escHtml(s.channel)}</div>
          <div class="locdet-val">${escHtml(s.value)}</div>
        </div>`).join('')}</div>`
    : '<div class="cdet-empty">Сенсорная палитра не заполнена</div>';
  const sensRawTable = (loc.sensoryPalette || []).map(s => `| **${s.channel}** | ${s.value} |`).join('\n')
    || '| Канал | |\n|---|---|\n| **Свет** | |\n| **Звук** | |\n| **Запах** | |\n| **Тактильное** | |';
  const sensEditHtml = `<textarea class="cdet-edit-textarea" id="locdet-sens-ta" rows="8">${escHtml(sensRawTable)}</textarea>`;

  const hooksViewHtml = loc.hooks?.length
    ? `<div class="locdet-hooks">${loc.hooks.map((h, i) =>
        `<div class="locdet-hook">
          <span class="locdet-hook-num">${i + 1}</span>
          <span class="locdet-hook-text">${escHtml(h)}</span>
        </div>`).join('')}</div>`
    : '<div class="cdet-empty">Крючки не заполнены</div>';
  const hooksEditHtml = `
    <div id="locdet-hooks-edit-list">
      ${(loc.hooks || []).map((h, i) => `
        <div class="hooks-item">
          <span class="hooks-num">${i + 1}</span>
          <input class="hooks-input" value="${escHtml(h)}" placeholder="Текст крючка…">
          <button class="hooks-del-btn" title="Удалить">✕</button>
        </div>`).join('')}
    </div>
    <button class="hooks-add-btn" id="locdet-hooks-add">+ Добавить крючок</button>`;

  // ── Images tab ────────────────────────────────────────────────
  const images = loc.imageUrls || (loc.imageUrl ? [loc.imageUrl] : []);
  const galleryHtml = images.length
    ? `<div class="locdet-img-gallery">${images.map(u =>
        `<img class="locdet-thumb" src="${escHtml(u)}" alt="" loading="lazy" decoding="async">`).join('')}</div>`
    : '<div class="cdet-empty" style="margin-bottom:12px">Изображения не загружены</div>';

  // ── Helper: panel with edit button ────────────────────────────
  function editPanel(id, viewHtml, editHtml, opts = {}) {
    const { noEdit } = opts;
    return `
      <div class="cdet-info-header">
        ${!noEdit ? `<button class="cdet-edit-btn" data-editloc="${id}">✏ Редактировать</button>` : ''}
      </div>
      <div id="locdet-${id}-view">${viewHtml}</div>
      <div id="locdet-${id}-edit" style="display:none">${editHtml}</div>
      <div class="cdet-edit-bar" id="locdet-${id}-bar" style="display:none">
        <button class="cdet-save-btn" data-saveloc="${id}">Сохранить</button>
        <button class="cdet-cancel-btn" data-cancelloc="${id}">Отмена</button>
        <span class="cdet-save-msg" id="locdet-${id}-msg" style="display:none">✓ Сохранено</span>
      </div>`;
  }

  document.getElementById('loc-detail-content').innerHTML = `
    <div class="locdet-img-col">${imgCol}</div>
    <div class="cdet-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">${escHtml(loc.title || loc.slug)}</div>
        ${loc.subtype ? `<div class="locdet-subtype">${escHtml(loc.subtype)}</div>` : ''}
        <button class="cdet-edit-btn" id="locdet-open-edit-modal" data-slug="${escHtml(slug)}" style="margin-bottom:6px">✏ Редактировать / Генерация</button>
        <div class="locdet-legend-row">
          <div class="locdet-legend-item">
            <span class="locdet-legend-lbl">Зона контроля</span>
            <span class="badge badge-loc-${zc}">${ZONE_CLASS_LABELS[zc]}</span>
          </div>
          ${mLvl !== 'unknown' ? `<div class="locdet-legend-item">
            <span class="locdet-legend-lbl">Маскарад</span>
            <span class="badge badge-masq-${mLvl}">${MASQ_BADGE_LABELS[mLvl]}</span>
          </div>` : ''}
        </div>
      </div>
      <div class="cdet-tab-bar">
        <button class="cdet-tab active" data-tab="meta">Метаданные</button>
        <button class="cdet-tab" data-tab="atm">Атмосфера</button>
        <button class="cdet-tab" data-tab="vtm">VtM</button>
        <button class="cdet-tab" data-tab="sens">Сенсорика</button>
        <button class="cdet-tab" data-tab="keys">Ключевые точки</button>
        <button class="cdet-tab" data-tab="hooks">Крючки</button>
        <button class="cdet-tab" data-tab="images">🖼 Изображения</button>
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="meta">${editPanel('meta', metaViewHtml, metaEditHtml)}</div>
        <div class="cdet-panel" data-panel="atm">${editPanel('atm', atmViewHtml, atmEditHtml)}</div>
        <div class="cdet-panel" data-panel="vtm">${editPanel('vtm', vtmViewHtml, vtmEditHtml)}</div>
        <div class="cdet-panel" data-panel="sens">${editPanel('sens', sensViewHtml, sensEditHtml)}</div>
        <div class="cdet-panel" data-panel="keys">${editPanel('keys', keyPointsHtml, keyEditHtml)}</div>
        <div class="cdet-panel" data-panel="hooks">${editPanel('hooks', hooksViewHtml, hooksEditHtml)}</div>
        <div class="cdet-panel" data-panel="images">
          ${galleryHtml}
          <div class="cdet-upload-row">
            <button class="cdet-upload-btn" id="locdet-upload-btn" data-slug="${escHtml(slug)}">📷 Загрузить изображение</button>
            <span id="locdet-upload-msg" class="cdet-save-msg" style="display:none">✓ Загружено</span>
          </div>
          <div class="cdet-section-title" style="margin-top:16px">Промт для генерации (GPT / DALL-E 3)</div>
          <textarea class="cdet-prompt-box" id="locdet-img-prompt-ta">${escHtml(loc.imagePrompt || '')}</textarea>
          <div class="cdet-section-title" style="margin-top:12px">Негативный промт (SD / Flux)</div>
          <textarea class="cdet-prompt-box cdet-prompt-neg" id="locdet-img-neg-ta">${escHtml(loc.negativePrompt || '')}</textarea>
          <div class="cdet-edit-bar" style="margin-top:8px;display:flex">
            <button class="cdet-save-btn" data-saveloc="images">Сохранить промты</button>
            <span class="cdet-save-msg" id="locdet-images-msg" style="display:none">✓ Сохранено</span>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('loc-detail-modal').classList.add('open');
  if (loc.imageUrl) initLocCarousel(slug);

  if (keepTab) {
    const tab = document.querySelector(`#loc-detail-content .cdet-tab[data-tab="${keepTab}"]`);
    if (tab) tab.click();
  }
}

// Location card clicks
document.getElementById('locs-grid').addEventListener('click', e => {
  const card = e.target.closest('.loc-card[data-slug]');
  if (card) openLocDetail(card.dataset.slug);
});

document.getElementById('btn-export-locs')?.addEventListener('click', e => {
  e.preventDefault();
  window.location.href = `/api/export/locations${window.location.search}`;
});
document.getElementById('btn-import-locs')?.addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('import-locs-file')?.click();
});
document.getElementById('import-locs-file')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  await importCardsFromFile('locations', file, loadLocations);
  e.target.value = '';
});

// Location filter events
document.getElementById('loc-search').addEventListener('input', e => {
  STATE.locFilter.search = e.target.value;
  if (STATE.locations.length) renderLocations();
});
document.getElementById('loc-filter-zone').addEventListener('change', e => {
  STATE.locFilter.zone = e.target.value;
  if (STATE.locations.length) renderLocations();
});
document.getElementById('loc-filter-district').addEventListener('change', e => {
  STATE.locFilter.district = e.target.value;
  if (STATE.locations.length) renderLocations();
});
document.getElementById('loc-filter-masq').addEventListener('change', e => {
  STATE.locFilter.masq = e.target.value;
  if (STATE.locations.length) renderLocations();
});

// Location modal close
const locDetailModal = document.getElementById('loc-detail-modal');
document.getElementById('loc-detail-close').addEventListener('click', () => {
  locDetailModal.classList.remove('open');
  if (_locCarouselTimer) { clearInterval(_locCarouselTimer); _locCarouselTimer = null; }
});
locDetailModal.addEventListener('click', e => { if (e.target === locDetailModal) locDetailModal.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') locDetailModal.classList.remove('open'); });

// Tab switching + carousel + edit/save/cancel + upload in location modal
document.getElementById('loc-detail-content').addEventListener('click', e => {
  if (e.target.closest('#locdet-carousel-prev')) { _locCarouselGoTo(_locCarouselIdx - 1, true); return; }
  if (e.target.closest('#locdet-carousel-next')) { _locCarouselGoTo(_locCarouselIdx + 1, true); return; }

  if (e.target.closest('.hooks-del-btn')) {
    const item = e.target.closest('.hooks-item');
    if (item) { item.remove(); _renumberHooks(); }
    return;
  }
  if (e.target.closest('#locdet-hooks-add')) {
    const list = document.getElementById('locdet-hooks-edit-list');
    if (list) {
      const n = list.querySelectorAll('.hooks-item').length + 1;
      const div = document.createElement('div');
      div.className = 'hooks-item';
      div.innerHTML = `<span class="hooks-num">${n}</span><input class="hooks-input" placeholder="Текст крючка…"><button class="hooks-del-btn" title="Удалить">✕</button>`;
      list.appendChild(div);
      div.querySelector('.hooks-input').focus();
    }
    return;
  }

  const editBtn   = e.target.closest('[data-editloc]');
  const saveBtn   = e.target.closest('[data-saveloc]');
  const cancelBtn = e.target.closest('[data-cancelloc]');
  const uploadBtn = e.target.closest('#locdet-upload-btn');

  if (editBtn)   { _locToggleEdit(editBtn.dataset.editloc, true);    return; }
  if (cancelBtn) { _locToggleEdit(cancelBtn.dataset.cancelloc, false); return; }
  if (saveBtn)   { _locSavePanel(saveBtn.dataset.saveloc);           return; }
  if (uploadBtn) { _locTriggerUpload(uploadBtn.dataset.slug);        return; }

  const tab = e.target.closest('.cdet-tab');
  if (!tab) return;
  const col = tab.closest('.cdet-info-col');
  col.querySelectorAll('.cdet-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  col.querySelectorAll('.cdet-panel').forEach(p => p.classList.remove('active'));
  col.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
  const panels = col.querySelector('.cdet-panels');
  if (panels) panels.scrollTop = 0;
});

function _renumberHooks() {
  document.querySelectorAll('#locdet-hooks-edit-list .hooks-item').forEach((item, i) => {
    const num = item.querySelector('.hooks-num');
    if (num) num.textContent = i + 1;
  });
}

function _locToggleEdit(panel, enter) {
  const viewEl = document.getElementById(`locdet-${panel}-view`);
  const editEl = document.getElementById(`locdet-${panel}-edit`);
  const barEl  = document.getElementById(`locdet-${panel}-bar`);
  const msgEl  = document.getElementById(`locdet-${panel}-msg`);
  if (!viewEl || !editEl) return;
  viewEl.style.display = enter ? 'none' : '';
  editEl.style.display = enter ? '' : 'none';
  if (barEl) barEl.style.display = enter ? 'flex' : 'none';
  if (msgEl) msgEl.style.display = 'none';
}

async function _locSavePanel(panel) {
  const slug = _currentLocSlug;
  if (!slug) return;
  const msgEl = document.getElementById(`locdet-${panel}-msg`);
  const fields = {};

  if (panel === 'atm') {
    fields.atmosphere = document.getElementById('locdet-atm-ta')?.value || '';
  } else if (panel === 'vtm') {
    fields.vtmText = document.getElementById('locdet-vtm-ta')?.value || '';
  } else if (panel === 'sens') {
    fields.sensoryPalette = document.getElementById('locdet-sens-ta')?.value || '';
  } else if (panel === 'keys') {
    fields.keyPoints = document.getElementById('locdet-keys-ta')?.value || '';
  } else if (panel === 'hooks') {
    const hookInputs = document.querySelectorAll('#locdet-hooks-edit-list .hooks-input');
    fields.hooks = Array.from(hookInputs).map(i => i.value.trim()).filter(Boolean).join('\n');
  } else if (panel === 'meta') {
    for (const key of ['subtype', 'district', 'neighborhood', 'address', 'control']) {
      const el = document.getElementById(`locdet-meta-${key}`);
      if (el) fields[key] = el.value;
    }
  } else if (panel === 'images') {
    fields.imagePrompt    = document.getElementById('locdet-img-prompt-ta')?.value || '';
    fields.negativePrompt = document.getElementById('locdet-img-neg-ta')?.value || '';
  }

  try {
    const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/fields${window.location.search}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    if (!resp.ok) throw new Error(await resp.text());

    if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
    if (panel !== 'images') _locToggleEdit(panel, false);

    // Reload and re-render keeping current tab
    const activeTab = document.querySelector('#loc-detail-content .cdet-tab.active')?.dataset.tab;
    const data = await fetch(`/api/locations${window.location.search}`).then(r => r.json()).catch(() => null);
    if (data) {
      STATE.locations = data;
      openLocDetail(slug, activeTab);
    }
  } catch {
    if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; }
  }
}


function _locTriggerUpload(slug) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const msgEl = document.getElementById('locdet-upload-msg');
    const btn   = document.getElementById('locdet-upload-btn');
    if (btn) btn.disabled = true;
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const ext  = file.name.split('.').pop() || 'jpg';
      const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/upload-image${window.location.search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, ext })
      });
      if (!resp.ok) throw new Error(await resp.text());
      const { url } = await resp.json();

      if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }

      // Reload and re-render
      const data = await fetch(`/api/locations${window.location.search}`).then(r => r.json()).catch(() => null);
      if (data) {
        STATE.locations = data;
        openLocDetail(slug, 'images');
      }
    } catch {
      if (msgEl) { msgEl.textContent = '✗ Ошибка загрузки'; msgEl.style.display = ''; }
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  input.click();
}

let _locCarouselImages = [];
let _locCarouselIdx    = 0;
let _locCarouselTimer  = null;

async function initLocCarousel(slug) {
  if (_locCarouselTimer) { clearInterval(_locCarouselTimer); _locCarouselTimer = null; }
  _locCarouselImages = [];
  _locCarouselIdx = 0;

  const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/images${window.location.search}`)
    .catch(() => null);
  if (!resp?.ok) return;
  const { images } = await resp.json().catch(() => ({}));
  if (!images || images.length <= 1) {
    document.getElementById('locdet-carousel-prev')?.style.setProperty('display', 'none');
    document.getElementById('locdet-carousel-next')?.style.setProperty('display', 'none');
    return;
  }

  _locCarouselImages = images;
  _locCarouselIdx    = 0;

  const dotsEl = document.getElementById('locdet-carousel-dots');
  if (dotsEl) {
    dotsEl.innerHTML = images.map((_, i) =>
      `<div class="locdet-carousel-dot${i === 0 ? ' active' : ''}"></div>`
    ).join('');
  }

  _locCarouselTimer = setInterval(() => _locCarouselGoTo(_locCarouselIdx + 1), 60 * 1000);
}

function _locCarouselGoTo(targetIdx, resetTimer = false) {
  const img     = document.getElementById('locdet-carousel-img');
  const overlay = document.getElementById('locdet-carousel-overlay');
  const dotsEl  = document.getElementById('locdet-carousel-dots');
  if (!img || !overlay || !_locCarouselImages.length) {
    clearInterval(_locCarouselTimer); _locCarouselTimer = null; return;
  }

  const next = ((targetIdx % _locCarouselImages.length) + _locCarouselImages.length) % _locCarouselImages.length;

  overlay.classList.add('dimmed');
  setTimeout(() => {
    _locCarouselIdx = next;
    img.src = _locCarouselImages[_locCarouselIdx];
    if (dotsEl) {
      dotsEl.querySelectorAll('.locdet-carousel-dot').forEach((d, i) =>
        d.classList.toggle('active', i === _locCarouselIdx));
    }
    setTimeout(() => overlay.classList.remove('dimmed'), 300);
  }, 2100);

  if (resetTimer && _locCarouselTimer) {
    clearInterval(_locCarouselTimer);
    _locCarouselTimer = setInterval(() => _locCarouselGoTo(_locCarouselIdx + 1), 60 * 1000);
  }
}

// ── Image Lightbox ───────────────────────────────────────────────────────────

let _lbImages = [];
let _lbIdx    = 0;

function openLightbox(images, startIdx = 0) {
  _lbImages = images;
  _lbIdx    = startIdx;
  _lbRender();
  document.getElementById('img-lightbox').classList.add('open');
}

function _lbRender() {
  const img     = document.getElementById('lightbox-img');
  const counter = document.getElementById('lightbox-counter');
  const prev    = document.getElementById('lightbox-prev');
  const next    = document.getElementById('lightbox-next');
  img.src       = _lbImages[_lbIdx];
  counter.textContent = _lbImages.length > 1 ? `${_lbIdx + 1} / ${_lbImages.length}` : '';
  prev.style.display  = _lbImages.length > 1 ? '' : 'none';
  next.style.display  = _lbImages.length > 1 ? '' : 'none';
}

function _lbGo(delta) {
  _lbIdx = ((_lbIdx + delta) % _lbImages.length + _lbImages.length) % _lbImages.length;
  _lbRender();
}

(function _initLightbox() {
  const lb   = document.getElementById('img-lightbox');
  document.getElementById('lightbox-close').addEventListener('click', () => lb.classList.remove('open'));
  document.getElementById('lightbox-prev').addEventListener('click',  () => _lbGo(-1));
  document.getElementById('lightbox-next').addEventListener('click',  () => _lbGo(1));
  lb.addEventListener('click', e => { if (e.target === lb) lb.classList.remove('open'); });
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); _lbGo(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); _lbGo(1); }
    if (e.key === 'Escape')     lb.classList.remove('open');
  });
})();

// Open lightbox: carousel image or gallery thumbnail
document.getElementById('loc-detail-content').addEventListener('click', e => {
  const carousel = e.target.closest('#locdet-carousel-img');
  if (carousel) {
    const images = _locCarouselImages.length ? _locCarouselImages : [carousel.src];
    openLightbox(images, _locCarouselIdx);
    return;
  }
  const thumb = e.target.closest('.locdet-thumb');
  if (thumb) {
    const loc = STATE.locations.find(l => l.slug === _currentLocSlug);
    const imgs = (loc?.imageUrls) || (loc?.imageUrl ? [loc.imageUrl] : [thumb.src]);
    const idx  = imgs.indexOf(thumb.src);
    openLightbox(imgs, idx >= 0 ? idx : 0);
  }
}, true);

// ═══════════════════════════════════════════════════════════════════════════
// Location Edit / Create Modal
// ═══════════════════════════════════════════════════════════════════════════

let _locEditSlug = null; // null = create, string = edit

function openLocEditModal(slug) {
  _locEditSlug = slug || null;
  const modal = document.getElementById('loc-edit-modal');
  const title = document.getElementById('loc-edit-title');
  const delBtn = document.getElementById('loc-edit-delete-btn');
  const errDiv = document.getElementById('loc-edit-error');

  title.textContent = slug ? 'Редактировать локацию' : 'Создать локацию';
  delBtn.style.display = slug ? '' : 'none';
  errDiv.style.display = 'none';
  errDiv.textContent = '';
  document.getElementById('loc-edit-gen-hint').textContent = '';

  // Clear fields
  ['name','district','neighborhood','address','control','atmosphere','sensory','vtm-context','hooks','image-prompt','context'].forEach(id => {
    const el = document.getElementById(`loc-edit-${id}`);
    if (el) el.value = '';
  });
  document.getElementById('loc-edit-zone').value = '';

  if (slug) {
    const loc = STATE.locations.find(l => l.slug === slug);
    if (loc) {
      document.getElementById('loc-edit-name').value        = loc.title || loc.subtype || loc.slug || '';
      document.getElementById('loc-edit-district').value    = loc.district || '';
      document.getElementById('loc-edit-neighborhood').value = loc.neighborhood || '';
      document.getElementById('loc-edit-address').value     = loc.address || '';
      document.getElementById('loc-edit-control').value     = loc.control || '';
      document.getElementById('loc-edit-atmosphere').value  = loc.atmosphere || '';
      document.getElementById('loc-edit-hooks').value       = (loc.hooks || []).join('\n');
      document.getElementById('loc-edit-image-prompt').value = loc.imagePrompt || '';
      document.getElementById('loc-edit-sensory').value =
        (loc.sensoryPalette || []).map(s => `| **${s.channel}** | ${s.value} |`).join('\n');
      document.getElementById('loc-edit-vtm-context').value = loc.vtmText || '';
      // Zone: try to match emoji
      const zv = loc.zone || '';
      const zoneEl = document.getElementById('loc-edit-zone');
      for (const opt of zoneEl.options) {
        if (opt.value && zv.includes(opt.value)) { zoneEl.value = opt.value; break; }
      }
    }
  }

  // Populate factions datalist for the Control field
  _loadFactionsList();

  modal.classList.add('open');
  document.getElementById('loc-edit-name').focus();
}

async function _loadFactionsList() {
  const dl = document.getElementById('loc-control-list');
  if (!dl) return;
  try {
    const md = await fetch(`/api/factions?city=${encodeURIComponent(CITY)}`).then(r => r.ok ? r.text() : '');
    const factions = new Set();
    for (const line of md.split('\n')) {
      if (!line.startsWith('|') || /^[|\s-]+$/.test(line)) continue;
      for (const cell of line.split('|').map(c => c.trim()).filter(Boolean)) {
        if (cell.length > 1 && !/^(Должность|Персонаж|Клан|Примечание|Статус|Примечан)/.test(cell))
          factions.add(cell);
      }
    }
    dl.innerHTML = [...factions].map(f => `<option value="${f.replace(/"/g, '&quot;')}">`).join('');
  } catch { /* молча */ }
}

function closeLocEditModal() {
  document.getElementById('loc-edit-modal').classList.remove('open');
  _locEditSlug = null;
}

async function saveLocEdit() {
  const saveBtn = document.getElementById('loc-edit-save-btn');
  const errDiv  = document.getElementById('loc-edit-error');
  const name    = document.getElementById('loc-edit-name').value.trim();

  errDiv.style.display = 'none';
  if (!name) { errDiv.textContent = 'Укажите название'; errDiv.style.display = ''; return; }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохраняем...';

  try {
    if (_locEditSlug) {
      // Edit: update individual fields via PUT /fields
      // Always include every field so empty string clears the existing value
      const fields = {
        atmosphere:  document.getElementById('loc-edit-atmosphere').value.trim(),
        hooks:       document.getElementById('loc-edit-hooks').value.trim(),
        imagePrompt: document.getElementById('loc-edit-image-prompt').value.trim(),
        district:    document.getElementById('loc-edit-district').value.trim(),
        neighborhood:document.getElementById('loc-edit-neighborhood').value.trim(),
        address:     document.getElementById('loc-edit-address').value.trim(),
        control:     document.getElementById('loc-edit-control').value.trim(),
        zone:        document.getElementById('loc-edit-zone').value,
        sensoryPalette: document.getElementById('loc-edit-sensory').value.trim(),
        vtmText:        document.getElementById('loc-edit-vtm-context').value.trim(),
      };

      const r = await fetch(`/api/locations/${encodeURIComponent(_locEditSlug)}/fields?city=${encodeURIComponent(CITY)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    } else {
      // Create
      const r = await fetch(`/api/locations?city=${encodeURIComponent(CITY)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          district: document.getElementById('loc-edit-district').value.trim() || undefined,
          context: document.getElementById('loc-edit-context').value.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      const { slug: newSlug } = await r.json();

      // Write remaining fields that POST /api/locations doesn't accept
      const extraFields = {
        neighborhood: document.getElementById('loc-edit-neighborhood').value.trim(),
        address:      document.getElementById('loc-edit-address').value.trim(),
        control:      document.getElementById('loc-edit-control').value.trim(),
        atmosphere:   document.getElementById('loc-edit-atmosphere').value.trim(),
        hooks:        document.getElementById('loc-edit-hooks').value.trim(),
        imagePrompt:  document.getElementById('loc-edit-image-prompt').value.trim(),
        zone:         document.getElementById('loc-edit-zone').value,
        sensoryPalette: document.getElementById('loc-edit-sensory').value.trim(),
        vtmText:        document.getElementById('loc-edit-vtm-context').value.trim(),
      };
      const hasExtra = Object.values(extraFields).some(v => v);
      if (hasExtra) {
        const rf = await fetch(`/api/locations/${encodeURIComponent(newSlug)}/fields?city=${encodeURIComponent(CITY)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: extraFields }),
        });
        if (!rf.ok) console.warn('[loc-create] extra fields save failed:', (await rf.json()).error);
      }
    }

    // Refresh locations cache
    STATE.locations = [];
    closeLocEditModal();
    await loadLocations();
  } catch (e) {
    errDiv.textContent = e.message;
    errDiv.style.display = '';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить';
  }
}

async function deleteLocCurrent() {
  if (!_locEditSlug) return;
  if (!await showConfirm(`Удалить локацию «${_locEditSlug}»? Это действие необратимо.`, { danger: true, confirmText: 'Удалить' })) return;
  const btn = document.getElementById('loc-edit-delete-btn');
  btn.disabled = true;
  try {
    const r = await fetch(`/api/locations/${encodeURIComponent(_locEditSlug)}?city=${encodeURIComponent(CITY)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    closeLocEditModal();
    // Close detail modal if open for this slug
    document.getElementById('loc-detail-modal').classList.remove('open');
    STATE.locations = [];
    await loadLocations();
  } catch (e) {
    document.getElementById('loc-edit-error').textContent = e.message;
    document.getElementById('loc-edit-error').style.display = '';
    btn.disabled = false;
  }
}

async function runLocFieldRegen(field) {
  const slug = _locEditSlug;
  const name = document.getElementById('loc-edit-name').value.trim();
  const context = document.getElementById('loc-edit-context').value.trim();
  const hint    = document.getElementById('loc-edit-gen-hint');
  const spinner = document.getElementById('loc-gen-spinner');
  hint.textContent = '';
  spinner.style.display = '';

  try {
    const r = await fetch(`/api/locations/generate?city=${encodeURIComponent(CITY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name, field, context }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const { value } = await r.json();
    if (!value) throw new Error('Пустой ответ');

    const fieldMap = { atmosphere: 'atmosphere', imagePrompt: 'image-prompt', hooks: 'hooks', vtmText: 'vtm-context' };
    const elId = fieldMap[field];
    if (elId) document.getElementById(`loc-edit-${elId}`).value = value;
    hint.textContent = '✓ Готово';
  } catch (e) {
    hint.textContent = `⚠ ${e.message}`;
  } finally {
    spinner.style.display = 'none';
  }
}

async function runLocFullGen() {
  const slug = _locEditSlug;
  const name = document.getElementById('loc-edit-name').value.trim();
  const context = document.getElementById('loc-edit-context').value.trim();
  if (!name) { document.getElementById('loc-edit-error').textContent = 'Укажите название для генерации'; document.getElementById('loc-edit-error').style.display = ''; return; }

  const hint    = document.getElementById('loc-edit-gen-hint');
  const btn     = document.getElementById('loc-edit-gen-full-btn');
  const spinner = document.getElementById('loc-gen-spinner');
  hint.textContent = '';
  btn.disabled = true;
  spinner.style.display = '';

  try {
    const r = await fetch(`/api/locations/generate?city=${encodeURIComponent(CITY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name, context }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const { content } = await r.json();
    if (!content) throw new Error('Пустой ответ от AI');

    // Парсинг делегирован /api/locations/parse-generated — тот же parseLocation
    // (lib/parsers.js), которым парсятся сохранённые карточки локаций.
    const parseR = await fetch(`/api/locations/parse-generated${window.location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content }),
    });
    if (!parseR.ok) throw new Error((await parseR.json()).error || parseR.statusText);
    const parsed = await parseR.json();

    if (parsed.atmosphere) document.getElementById('loc-edit-atmosphere').value = parsed.atmosphere;
    if (parsed.hooks?.length) document.getElementById('loc-edit-hooks').value = parsed.hooks.map(h => `${h}`).join('\n');

    const promptM = content.match(/```\s*\n([\s\S]+?)```/);
    if (promptM) document.getElementById('loc-edit-image-prompt').value = promptM[1].trim();

    if (parsed.sensoryPalette?.length) {
      document.getElementById('loc-edit-sensory').value =
        parsed.sensoryPalette.map(s => `| **${s.channel}** | ${s.value} |`).join('\n');
    }

    // Только проза — табличные строки идут отдельным структурным путём;
    // отправка их же как vtmText задвоила бы таблицу поверх существующей.
    if (parsed.vtmText) {
      const prose = parsed.vtmText.split('\n').filter(l => !l.startsWith('|') && l.trim()).join('\n').trim();
      if (prose) document.getElementById('loc-edit-vtm-context').value = prose;
    }

    hint.textContent = '✓ Карточка сгенерирована — проверьте и сохраните';
  } catch (e) {
    hint.textContent = `⚠ ${e.message}`;
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
  }
}

// Wire up modal events
(function _initLocEditModal() {
  document.getElementById('loc-edit-cancel').addEventListener('click', closeLocEditModal);
  document.getElementById('loc-edit-save-btn').addEventListener('click', saveLocEdit);
  document.getElementById('loc-edit-delete-btn').addEventListener('click', deleteLocCurrent);
  document.getElementById('loc-edit-gen-full-btn').addEventListener('click', runLocFullGen);
  document.getElementById('loc-edit-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeLocEditModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('loc-edit-modal').classList.contains('open')) closeLocEditModal();
  });
  document.getElementById('loc-edit-modal').addEventListener('click', e => {
    const regenBtn = e.target.closest('.loc-edit-regen-btn');
    if (regenBtn) runLocFieldRegen(regenBtn.dataset.field);
  });

  // "Create location" button on locations page
  document.getElementById('loc-page-create-btn')?.addEventListener('click', () => openLocEditModal(null));

  document.getElementById('btn-export-locs')?.addEventListener('click', e => {
    e.preventDefault();
    window.location.href = `/api/export/locations${window.location.search}`;
  });

  // "Edit" button in loc-detail-modal (delegated)
  document.getElementById('loc-detail-content').addEventListener('click', e => {
    const editBtn = e.target.closest('#locdet-open-edit-modal');
    if (editBtn) openLocEditModal(editBtn.dataset.slug);
  });

  // Old sidebar new-location button → open new modal
  document.getElementById('btn-new-loc')?.removeEventListener('click', null);
})();

// ═══════════════════════════════════════════════════════════════════════════
// Module Locations Panel
// ═══════════════════════════════════════════════════════════════════════════

async function _renderModuleLocPanel(data) {
  await ensureLocsLoaded();
  const panel = document.getElementById('modp-panel-locations');
  const { chronicle, name: modName } = STATE.currentModule || {};

  const linked   = data.linkedLocations || [];
  const extracted = data.locations || [];

  const linkedHtml = linked.length
    ? `<div class="modp-loc-cards">${linked.map(loc => _locCardHtml(loc, {
        overlayExtra: `<button class="modp-loc-card-unlink" data-unlink="${escHtml(loc.slug)}" title="Открепить" onclick="event.stopPropagation()">✕</button>`,
      })).join('')}</div>`
    : '<div class="modp-empty" style="padding:8px 0">Связанных локаций нет</div>';

  // «Mentioned in scenario» — with quick-attach buttons
  const mentionedHtml = extracted.length
    ? `<ul class="modp-locs-mentioned-list">
        ${extracted.map(loc => {
          const locName = loc.name || '';
          const isLinked = linked.some(
            l => (l.title || '').toLowerCase() === locName.toLowerCase());
          const existsInCity = (STATE.locations || []).find(
            l => (l.name || l.title || '').toLowerCase() === locName.toLowerCase());
          const attachSlug = existsInCity?.slug;
          return `<li class="modp-locs-mentioned-item">
            <span>${escHtml(locName)}</span>
            ${isLinked
              ? `<span class="modp-locs-linked-badge">✓ Прикреплена</span>`
              : attachSlug
                ? `<button class="modp-locs-attach-btn"
                     data-attach-slug="${escHtml(attachSlug)}"
                     data-attach-name="${escHtml(locName)}">📎 Прикрепить</button>`
                : `<button class="modp-locs-create-btn"
                     data-create-name="${escHtml(locName)}">✨ Создать карточку</button>`
            }
          </li>`;
        }).join('')}
      </ul>`
    : '';

  panel.innerHTML = `
    <div class="modp-locs-toolbar">
      <button class="modp-locs-add-btn" id="modp-locs-attach-toggle">📎 Прикрепить локацию</button>
      <button class="modp-locs-new-btn" id="modp-locs-gen-toggle">✨ Новая локация для сцены</button>
    </div>

    <div class="modp-loc-attach-panel" id="modp-loc-attach-panel">
      <input class="chr-form-input modp-loc-attach-search" id="modp-loc-attach-search" placeholder="Поиск по названию..." autocomplete="off">
      <div class="modp-loc-attach-list" id="modp-loc-attach-list"></div>
    </div>

    <div class="modp-loc-gen-form" id="modp-loc-gen-form">
      <div class="chr-form-group">
        <label class="chr-form-label" for="modp-loc-gen-name">Название</label>
        <input class="chr-form-input" id="modp-loc-gen-name" placeholder="Бар «Бретонский якорь»" autocomplete="off">
      </div>
      <div class="chr-form-group">
        <label class="chr-form-label" for="modp-loc-gen-context">Контекст сцены</label>
        <input class="chr-form-input" id="modp-loc-gen-context" placeholder="Что здесь происходит" autocomplete="off">
      </div>
      <div class="modp-loc-gen-actions">
        <button class="chr-modal-btn cancel" id="modp-loc-gen-cancel">Отмена</button>
        <button class="chr-modal-btn create" id="modp-loc-gen-save">Создать и прикрепить</button>
      </div>
    </div>

    <div class="modp-locs-section-title">Связанные локации</div>
    <div id="modp-loc-chip-list">${linkedHtml}</div>

    ${mentionedHtml ? `<div class="modp-locs-section-title">Упомянуты в сценарии</div>${mentionedHtml}` : ''}
  `;

  // ── Event wiring for this panel ──────────────────────────────────
  const linkedSlugs = linked.map(l => l.slug);

  // Attach panel toggle
  document.getElementById('modp-locs-attach-toggle').addEventListener('click', () => {
    const p = document.getElementById('modp-loc-attach-panel');
    const isOpen = p.classList.toggle('open');
    if (isOpen) _fillAttachList(linkedSlugs);
  });

  // Gen form toggle
  document.getElementById('modp-locs-gen-toggle').addEventListener('click', () => {
    document.getElementById('modp-loc-gen-form').classList.toggle('open');
  });
  document.getElementById('modp-loc-gen-cancel').addEventListener('click', () => {
    document.getElementById('modp-loc-gen-form').classList.remove('open');
  });

  // Search filter for attach list
  document.getElementById('modp-loc-attach-search').addEventListener('input', e => {
    _fillAttachList(linkedSlugs, e.target.value);
  });

  // Chip clicks → open loc detail; unlink buttons
  document.getElementById('modp-loc-chip-list').addEventListener('click', e => {
    const unlinkBtn = e.target.closest('[data-unlink]');
    if (unlinkBtn) {
      _modLocUnlink(chronicle, modName, unlinkBtn.dataset.unlink);
      return;
    }
    const card = e.target.closest('.loc-card');
    if (card) {
      const slug = card.dataset.slug;
      if (slug) { ensureLocsLoaded().then(() => openLocDetail(slug)); }
    }
  });

  // Quick-attach existing location from mentioned list
  const mentionedList = panel.querySelector('.modp-locs-mentioned-list');
  if (mentionedList) {
    mentionedList.addEventListener('click', e => {
      const attachBtn = e.target.closest('[data-attach-slug]');
      if (attachBtn) {
        const slug = attachBtn.dataset.attachSlug;
        if (!slug) return;
        attachBtn.disabled = true;
        _modLocLink(chronicle, modName, slug).catch(() => { attachBtn.disabled = false; });
        return;
      }

      // Create new location card with pre-filled name
      const createLocBtn = e.target.closest('[data-create-name]');
      if (createLocBtn) {
        const locName = createLocBtn.dataset.createName;
        if (typeof openLocEditModal === 'function') {
          openLocEditModal(null);
          // Pre-fill name after modal opens (next tick)
          setTimeout(() => {
            const nameInput = document.getElementById('loc-edit-name');
            if (nameInput) nameInput.value = locName;
          }, 0);
        } else {
          const modal = document.getElementById('loc-edit-modal');
          if (modal) {
            modal.style.display = 'flex';
            const nameInput = document.getElementById('loc-edit-name');
            if (nameInput) nameInput.value = locName;
          }
        }
      }
    });
  }

  // Create + link
  document.getElementById('modp-loc-gen-save').addEventListener('click', async () => {
    const locName = document.getElementById('modp-loc-gen-name').value.trim();
    const ctx     = document.getElementById('modp-loc-gen-context').value.trim();
    if (!locName) return;
    const btn = document.getElementById('modp-loc-gen-save');
    btn.disabled = true;
    btn.textContent = 'Создаём...';
    try {
      const r = await fetch(`/api/locations?city=${encodeURIComponent(CITY)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: locName, context: ctx, generate: !!ctx }),
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      const { slug } = await r.json();
      STATE.locations = [];
      await _modLocLink(chronicle, modName, slug);
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Создать и прикрепить';
    }
  });
}

function _fillAttachList(linkedSlugs, query = '') {
  const listEl = document.getElementById('modp-loc-attach-list');
  if (!listEl) return;
  const q = query.toLowerCase();
  const items = STATE.locations
    .filter(l => !q || (l.title || l.slug).toLowerCase().includes(q) || (l.district || '').toLowerCase().includes(q))
    .slice(0, 40);

  listEl.innerHTML = items.length
    ? items.map(loc => {
        const isLinked = linkedSlugs.includes(loc.slug);
        const title = loc.title || loc.subtype || loc.slug;
        const meta  = [loc.district, loc.neighborhood].filter(Boolean).join(' · ');
        return `<div class="modp-loc-attach-item${isLinked ? ' already-linked' : ''}" data-attach="${escHtml(loc.slug)}" title="${escHtml(meta)}">
          ${escHtml(title)}${meta ? ` <span style="color:var(--muted);font-size:var(--fs-xs)">(${escHtml(meta)})</span>` : ''}
        </div>`;
      }).join('')
    : '<div style="padding:6px;color:var(--muted);font-size:var(--fs-sm)">Локации не найдены</div>';

  listEl.querySelectorAll('.modp-loc-attach-item:not(.already-linked)').forEach(el => {
    el.addEventListener('click', () => {
      const { chronicle, name: modName } = STATE.currentModule || {};
      _modLocLink(chronicle, modName, el.dataset.attach);
    });
  });
}

async function _modLocLink(chronicle, modName, slug) {
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(modName)}/locations?city=${encodeURIComponent(CITY)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) }
    );
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    // Re-fetch module detail only — _renderModuleLocPanel uses data.linkedLocations, not STATE.locations
    const dataR = await fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(modName)}/detail?city=${encodeURIComponent(CITY)}`);
    const data  = await dataR.json();
    await _renderModuleLocPanel(data);
  } catch (e) { showToast(e.message, 'error'); }
}

async function _modLocUnlink(chronicle, modName, slug) {
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(modName)}/locations/${encodeURIComponent(slug)}?city=${encodeURIComponent(CITY)}`,
      { method: 'DELETE' }
    );
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const dataR = await fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(modName)}/detail?city=${encodeURIComponent(CITY)}`);
    const data  = await dataR.json();
    await _renderModuleLocPanel(data);
  } catch (e) { showToast(e.message, 'error'); }
}

async function ensureLocsLoaded() {
  if (STATE.locations.length) return;
  try {
    const data = await fetch(`/api/locations?city=${encodeURIComponent(CITY)}`).then(r => r.json());
    STATE.locations = Array.isArray(data) ? data : [];
    // Only refresh the location filter when on the locations page (element may be absent)
    const distSel = document.getElementById('loc-filter-district');
    if (distSel) populateDistrictFilter();
  } catch {}
}
