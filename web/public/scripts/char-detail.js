function openCharDetail(name) {
  const c = STATE.characters.find(ch => ch.name === name);
  if (!c) return;

  const icon   = LINEAGE_ICONS[c.lineage] || '👤';
  const stType = c.statusType || 'unknown';
  const stLbl  = statusLabel(c);

  const clanTint = c.lineage === 'vampire' ? CLAN_COLORS[c.clan] : null;
  const detailModalEl = document.getElementById('char-detail-modal');
  if (clanTint) detailModalEl.style.setProperty('--clan-tint', clanTint);
  else detailModalEl.style.removeProperty('--clan-tint');

  const _reqFields = requiredInfoFor(c.lineage);
  const infoFields = infoFieldsFor(c.lineage)
    .map(([k, lbl]) => {
      const raw = c[k];
      const empty = !raw || raw === '—' || String(raw).includes('⚠️');
      const required = _reqFields.has(k);
      const opt = (empty && !required) ? ' cdet-opt-empty' : '';   // hidden in view mode
      const tip = fieldTip(CHAR_FIELD_TIPS[lbl]);
      const keyHtml = (empty && required)
        ? `${lbl} <span class="cdet-req-flag" title="Обязательное поле">!</span>${tip}` : `${lbl}${tip}`;
      const display = empty ? 'Неизвестно' : escHtml(raw);
      const cls = empty ? 'cdet-val unknown' : 'cdet-val';
      return `<div class="cdet-key${opt}">${keyHtml}</div><div class="${cls}${opt}" data-field="${k}">${display}</div>`;
    })
    .join('');

  const relsHtml = (c.relationships || []).map(r => `
    <div class="cdet-rel">
      <div class="cdet-rel-name">${escHtml(r.target)}</div>
      <div class="cdet-rel-desc">${escHtml(r.description)}</div>
    </div>`).join('');

  const portraitCol = c.imageUrl
    ? `<div class="cdet-carousel" id="cdet-carousel">
        <img class="cdet-carousel-img" id="cdet-carousel-img" src="${c.imageUrl}" alt="${escHtml(c.name)}">
        <div class="cdet-carousel-overlay" id="cdet-carousel-overlay"></div>
        <button class="cdet-carousel-btn prev" id="cdet-carousel-prev" title="Предыдущее">&#8249;</button>
        <button class="cdet-carousel-btn next" id="cdet-carousel-next" title="Следующее">&#8250;</button>
        <div class="cdet-carousel-dots" id="cdet-carousel-dots"></div>
       </div>`
    : `<div class="cdet-no-portrait">${icon}</div>`;

  const descHtml = [
    c.appearance && !c.appearance.includes('⚠️') ? `
      <div class="cdet-section-title">Внешность</div>
      <div class="cdet-bio">${escHtml(c.appearance)}</div>
      <div class="cdet-divider"></div>` : '',
    c.voice && !c.voice.includes('⚠️') ? `
      <div class="cdet-section-title">Голос</div>
      <div class="cdet-voice">${escHtml(c.voice)}</div>
      <div class="cdet-divider"></div>` : '',
    c.personality && !c.personality.includes('⚠️') ? `
      <div class="cdet-section-title">Характер</div>
      <div class="cdet-bio">${escHtml(c.personality)}</div>
      <div class="cdet-divider"></div>` : '',
    _promptSectionHtml(c.imagePrompt, c.negativePrompt),
  ].filter(Boolean).join('');

  const stampParts = c.lineage === 'vampire'
    ? [c.clan, c.generation ? `${c.generation} поколение` : ''].filter(Boolean)
    : [LINEAGE_LABELS[c.lineage] || c.lineage];
  const stampText = stampParts.filter(p => p && p !== '—' && !String(p).includes('⚠️')).join(' · ');

  document.getElementById('char-detail-content').innerHTML = `
    <div class="cdet-portrait-col" id="cdet-portrait-col">${portraitCol}</div>
    <div class="cdet-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-header-grain" aria-hidden="true"></div>
        ${stampText ? `<div class="cdet-stamp">${escHtml(stampText)}</div>` : ''}
        <div class="cdet-name">${escHtml(c.name)}</div>
        <div class="cdet-badges">
          <span class="badge badge-${c.lineage}">${LINEAGE_LABELS[c.lineage] || c.lineage}</span>
          ${stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : ''}
        </div>
        ${c.statusDetails ? `<div class="cdet-status-details">${escHtml(c.statusDetails)}</div>` : ''}
        <button class="cdet-delete-btn" id="cdet-delete-btn" data-char="${escHtml(c.name)}" title="Удалить персонажа">🗑</button>
      </div>
      <div class="cdet-tab-bar">
        <button class="cdet-tab active" data-tab="info">Информация</button>
        <button class="cdet-tab" data-tab="bio">Биография</button>
        <button class="cdet-tab" data-tab="rels">Отношения</button>
        <button class="cdet-tab" data-tab="diaries">Дневники${c.diaries?.length ? ` (${c.diaries.length})` : ''}</button>
        <button class="cdet-tab" data-tab="sheet" data-char="${escHtml(c.name)}">Лист V20</button>
        <button class="cdet-tab" data-tab="desc">Описание</button>
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="info">
          ${c.presence ? `<div class="cdet-presence">🌍 <b>Присутствие:</b> ${escHtml(c.presence)}</div>` : ''}
          ${c.aliases ? `<div class="cdet-presence cdet-aliases">🎭 <b>Алиасы:</b> ${escHtml(c.aliases)}</div>` : ''}
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" id="cdet-edit-btn" data-char="${escHtml(c.name)}">✏ Редактировать</button>
          </div>
          <div class="cdet-fields" id="cdet-info-fields">${infoFields}</div>
          <div class="cdet-edit-bar" id="cdet-edit-bar">
            <button class="cdet-save-btn" id="cdet-save-btn">Сохранить</button>
            <button class="cdet-cancel-btn" id="cdet-cancel-btn">Отмена</button>
            <span class="cdet-save-msg" id="cdet-save-msg">✓ Сохранено</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="bio">
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" data-editpanel="bio" data-char="${escHtml(c.name)}">✏ Редактировать</button>
          </div>
          <div id="cdet-bio-view">
            ${c.biography && !c.biography.includes('⚠️')
              ? `<div class="cdet-bio">${escHtml(c.biography)}</div>`
              : '<div class="cdet-empty">Биография не заполнена</div>'}
          </div>
          <div id="cdet-bio-edit" style="display:none">
            <div class="cdet-info-header" style="margin-bottom:8px">
              <button class="cdet-gen-prompt-btn" id="cdet-gen-biography" data-char="${escHtml(c.name)}" title="Сгенерировать биографию по вкладкам «Информация» и «Отношения»">📖 Сгенерировать биографию</button>
            </div>
            <textarea class="cdet-edit-textarea" id="cdet-bio-ta" rows="10" placeholder="Биография персонажа...">${c.biography && !c.biography.includes('⚠️') ? escHtml(c.biography) : ''}</textarea>
          </div>
          <div class="cdet-edit-bar" id="cdet-bio-bar">
            <button class="cdet-save-btn" data-savepanel="bio" data-char="${escHtml(c.name)}">Сохранить</button>
            <button class="cdet-cancel-btn" data-cancelpanel="bio">Отмена</button>
            <span class="cdet-save-msg" id="cdet-bio-msg">✓ Сохранено</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="rels">
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" data-editpanel="rels" data-char="${escHtml(c.name)}">✏ Редактировать</button>
          </div>
          <div id="cdet-rels-view">
            ${relsHtml ? `<div class="cdet-rels-list">${relsHtml}</div>` : '<div class="cdet-empty">Нет известных связей</div>'}
          </div>
          <div id="cdet-rels-edit" style="display:none">
            <div class="cdet-rels-hint">Имя — выбери из списка или впиши своё. Вид отношений — из списка или свой.</div>
            <div id="cdet-rels-rows">${(c.relationships||[]).map(r => _relRowHtml(r.target, r.description)).join('')}</div>
            <button class="cdet-rel-add-btn" id="cdet-rel-add-btn" type="button">+ Добавить связь</button>
            <datalist id="cdet-rel-names">${(STATE.characters||[]).filter(x => x.name !== c.name).map(x => `<option value="${escAttr(x.name)}">`).join('')}</datalist>
            <datalist id="cdet-rel-types">${REL_TYPE_OPTIONS.map(t => `<option value="${escAttr(t)}">`).join('')}</datalist>
          </div>
          <div class="cdet-edit-bar" id="cdet-rels-bar">
            <button class="cdet-save-btn" data-savepanel="rels" data-char="${escHtml(c.name)}">Сохранить</button>
            <button class="cdet-cancel-btn" data-cancelpanel="rels">Отмена</button>
            <span class="cdet-save-msg" id="cdet-rels-msg">✓ Сохранено</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="diaries">
          ${renderDiaryList(c)}
        </div>
        <div class="cdet-panel" data-panel="sheet" id="cdet-sheet-panel">
          <div class="loading-state"><div class="spinner"></div>Загрузка листа…</div>
        </div>
        <div class="cdet-panel" data-panel="desc">
          <div class="cdet-info-header" style="gap:8px">
            <button class="cdet-gen-appearance-btn" id="cdet-gen-appearance" data-char="${escHtml(c.name)}" title="Сгенерировать описание внешности по артам персонажа (Claude Vision)">👁 Внешность по арту</button>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-personality" data-char="${escHtml(c.name)}" title="Сгенерировать характер и голос по внешности и биографии">🎭 Характер и голос</button>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-prompt" data-char="${escHtml(c.name)}" title="Сгенерировать промт на основе внешности персонажа">🎨 Промт</button>
            <button class="cdet-edit-btn" data-editpanel="desc" data-char="${escHtml(c.name)}">✏ Редактировать</button>
          </div>
          <div id="cdet-desc-view">
            ${descHtml || '<div class="cdet-empty">Описание не заполнено</div>'}
          </div>
          <div id="cdet-desc-edit" style="display:none">
            <div id="cdet-img-gallery"></div>
            <div class="cdet-section-title">Внешность</div>
            <textarea class="cdet-edit-textarea" id="cdet-appearance-ta" rows="5" placeholder="Внешность персонажа...">${c.appearance && !c.appearance.includes('⚠️') ? escHtml(c.appearance) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">Голос</div>
            <textarea class="cdet-edit-textarea" id="cdet-voice-ta" rows="3" placeholder="Голос, манера речи...">${c.voice && !c.voice.includes('⚠️') ? escHtml(c.voice) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">Характер</div>
            <textarea class="cdet-edit-textarea" id="cdet-personality-ta" rows="4" placeholder="Ключевые черты, мотивации, манера держаться с другими...">${c.personality && !c.personality.includes('⚠️') ? escHtml(c.personality) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">Промт для генерации изображения</div>
            <textarea class="cdet-edit-textarea" id="cdet-prompt-ta" rows="6" placeholder="[Блок 1] ...\n[Блок 2] ...\n[Блок 3] ...">${c.imagePrompt ? escHtml(c.imagePrompt) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">Негативный промт</div>
            <textarea class="cdet-edit-textarea" id="cdet-negprompt-ta" rows="3" placeholder="photorealistic, ...">${c.negativePrompt ? escHtml(c.negativePrompt) : ''}</textarea>
          </div>
          <div class="cdet-edit-bar" id="cdet-desc-bar">
            <button class="cdet-save-btn" data-savepanel="desc" data-char="${escHtml(c.name)}">Сохранить</button>
            <button class="cdet-cancel-btn" data-cancelpanel="desc">Отмена</button>
            <span class="cdet-save-msg" id="cdet-desc-msg">✓ Сохранено</span>
          </div>
          <div class="cdet-upload-row">
            <button class="cdet-upload-btn" data-char="${escHtml(c.name)}">📷 Загрузить изображение</button>
          </div>
          <div class="cdet-divider"></div>
          <div class="cdet-dialogue">
            <div class="cdet-section-title">💬 Реплики НПС в сцене</div>
            <div class="cdet-dialogue-hint">Голос персонажа + клановый стиль (diary_rules.md). Опиши ситуацию — ИИ выдаст реплики в характере.</div>
            <textarea class="cdet-edit-textarea" id="cdet-dlg-situation" rows="2" placeholder="Ситуация: напр. «Князь требует объяснений на Элизиуме»"></textarea>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-dialogue" data-char="${escHtml(c.name)}">💬 Сгенерировать реплики</button>
            <div id="cdet-dlg-result" class="cdet-dialogue-result" style="display:none"></div>
          </div>
        </div>
      </div>
    </div>`;

  openModal('char-detail-modal');
  if (c.imageUrl) initCarousel(c.name);
}

document.getElementById('chars-grid').addEventListener('click', e => {
  const card = e.target.closest('.char-card[data-name]');
  if (!card) return;
  if (_foundryBulkMode) { _foundryBulkToggleCard(card.dataset.name); return; }
  openCharDetail(card.dataset.name);
});

const charDetailModal = document.getElementById('char-detail-modal');
document.getElementById('char-detail-close').addEventListener('click', () => closeModal('char-detail-modal'));
charDetailModal.addEventListener('click', e => { if (e.target === charDetailModal) closeModal('char-detail-modal'); });

// Tab switching & image upload — delegated on the persistent content container
document.getElementById('char-detail-content').addEventListener('click', e => {
  const tab = e.target.closest('.cdet-tab');
  if (tab) {
    const col = tab.closest('.cdet-info-col');
    col.querySelectorAll('.cdet-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    col.querySelectorAll('.cdet-panel').forEach(p => p.classList.remove('active'));
    col.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    const panels = col.querySelector('.cdet-panels');
    if (panels) panels.scrollTop = 0;
    if (tab.dataset.tab === 'sheet') _loadCharSheet(tab.dataset.char);
    return;
  }
  if (e.target.closest('#cdet-carousel-prev')) { _carouselGoTo(_carouselIdx - 1, true); return; }
  if (e.target.closest('#cdet-carousel-next')) { _carouselGoTo(_carouselIdx + 1, true); return; }
  if (e.target.closest('#cdet-delete-btn'))  { _confirmDeleteChar(e.target.closest('#cdet-delete-btn').dataset.char); return; }
  if (e.target.closest('#cdet-edit-btn'))    { _enterInfoEdit(e.target.closest('#cdet-edit-btn').dataset.char); return; }
  if (e.target.closest('#cdet-cancel-btn'))  { _exitInfoEdit(false); return; }
  if (e.target.closest('#cdet-save-btn'))    { _saveInfoFields(); return; }

  // Panel edit buttons (bio / rels / desc)
  const editPanelBtn = e.target.closest('[data-editpanel]');
  if (editPanelBtn) { _togglePanelEdit(editPanelBtn.dataset.editpanel, true); return; }
  const cancelPanelBtn = e.target.closest('[data-cancelpanel]');
  if (cancelPanelBtn) { _togglePanelEdit(cancelPanelBtn.dataset.cancelpanel, false); return; }
  const savePanelBtn = e.target.closest('[data-savepanel]');
  if (savePanelBtn) { _savePanelEdit(savePanelBtn.dataset.savepanel, savePanelBtn.dataset.char); return; }

  // Relations editor: add / delete a single row
  if (e.target.closest('#cdet-rel-add-btn')) {
    const rows = document.getElementById('cdet-rels-rows');
    if (rows) {
      rows.insertAdjacentHTML('beforeend', _relRowHtml());
      rows.lastElementChild?.querySelector('.cdet-rel-name-inp')?.focus();
    }
    return;
  }
  const relDelBtn = e.target.closest('.cdet-rel-del-btn');
  if (relDelBtn) { relDelBtn.closest('.cdet-rel-row')?.remove(); return; }
  const promptCopyBtn = e.target.closest('#cdet-prompt-copy');
  if (promptCopyBtn) { _copyImagePrompt(promptCopyBtn); return; }
  if (e.target.closest('#cdet-gen-appearance')) { _generateAppearance(e.target.closest('#cdet-gen-appearance').dataset.char); return; }
  if (e.target.closest('#cdet-gen-personality')) { _generatePersonality(e.target.closest('#cdet-gen-personality').dataset.char); return; }
  if (e.target.closest('#cdet-gen-biography')) { _generateBiography(e.target.closest('#cdet-gen-biography').dataset.char); return; }
  if (e.target.closest('#cdet-gen-prompt')) { _generatePrompt(e.target.closest('#cdet-gen-prompt').dataset.char); return; }
  if (e.target.closest('#cdet-gen-dialogue')) { _genDialogue(e.target.closest('#cdet-gen-dialogue').dataset.char); return; }
  if (e.target.closest('.cdet-img-del-btn')) {
    const btn = e.target.closest('.cdet-img-del-btn');
    _deleteCharImage(btn.dataset.char, btn.dataset.file);
    return;
  }

  const uploadBtn = e.target.closest('.cdet-upload-btn');
  if (uploadBtn) { triggerImageUpload(uploadBtn.dataset.char); return; }

  // Diary entry form: toggle / generate / save / cancel
  if (e.target.closest('#diary-add-toggle')) {
    const f = document.getElementById('diary-form');
    if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
    return;
  }
  if (e.target.closest('#diary-cancel')) {
    const f = document.getElementById('diary-form'); if (f) f.style.display = 'none';
    return;
  }
  if (e.target.closest('#diary-gen'))  { _diaryGenerate(e.target.closest('#diary-gen').dataset.char); return; }
  if (e.target.closest('#diary-save')) { _diarySave(e.target.closest('#diary-save').dataset.char); return; }

  const diaryDelBtn = e.target.closest('.diary-item-del-btn');
  if (diaryDelBtn) {
    _deleteDiaryEntry(diaryDelBtn.dataset.char, diaryDelBtn.dataset.file, diaryDelBtn.dataset.title);
    return;
  }

  const diaryItem = e.target.closest('.diary-item');
  if (diaryItem) { loadDiaryEntry(diaryItem.dataset.char, diaryItem.dataset.file); return; }

  const diaryBack = e.target.closest('.diary-back');
  if (diaryBack) {
    const c = STATE.characters.find(ch => ch.name === diaryBack.dataset.char);
    const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
    if (panel && c) {
      panel.innerHTML = renderDiaryList(c);
      const panels = panel.closest('.cdet-panels');
      if (panels) panels.scrollTop = 0;
    }
    return;
  }

  const diaryEntryEditBtn = e.target.closest('.diary-entry-edit-btn');
  if (diaryEntryEditBtn) { _enterDiaryEntryEdit(); return; }

  const diaryEntryDelBtn = e.target.closest('.diary-entry-del-btn');
  if (diaryEntryDelBtn) {
    _deleteDiaryEntry(diaryEntryDelBtn.dataset.char, diaryEntryDelBtn.dataset.file, diaryEntryDelBtn.dataset.title);
    return;
  }

  const diaryRegenBtn = e.target.closest('.diary-entry-regen-btn');
  if (diaryRegenBtn) { _regenerateDiaryEntry(diaryRegenBtn.dataset.char, diaryRegenBtn.dataset.period); return; }

  const diaryEntrySaveBtn = e.target.closest('.diary-entry-save-btn');
  if (diaryEntrySaveBtn) { _saveDiaryEntryEdit(diaryEntrySaveBtn.dataset.char, diaryEntrySaveBtn.dataset.period, diaryEntrySaveBtn.dataset.file); return; }

  const diaryEntryCancelBtn = e.target.closest('.diary-entry-cancel-btn');
  if (diaryEntryCancelBtn) { loadDiaryEntry(diaryEntryCancelBtn.dataset.char, diaryEntryCancelBtn.dataset.file); return; }
});

// ── Carousel logic ────────────────────────────────────────────────────────────
let _carouselTimer  = null;
let _carouselImages = [];
let _carouselIdx    = 0;

async function initCarousel(charName) {
  // Stop previous carousel
  if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
  _carouselImages = [];
  _carouselIdx = 0;

  const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/images${window.location.search}`)
    .catch(() => null);
  if (!resp?.ok) return;
  const { images } = await resp.json().catch(() => ({}));
  if (!images || images.length <= 1) {
    // Hide nav buttons for single image
    document.getElementById('cdet-carousel-prev')?.style.setProperty('display','none');
    document.getElementById('cdet-carousel-next')?.style.setProperty('display','none');
    return;
  }

  _carouselImages = images;
  _carouselIdx    = 0;

  // Build dots
  const dotsEl = document.getElementById('cdet-carousel-dots');
  if (dotsEl) {
    dotsEl.innerHTML = images.map((_, i) =>
      `<div class="cdet-carousel-dot${i === 0 ? ' active' : ''}"></div>`
    ).join('');
  }

  _carouselTimer = setInterval(() => _carouselGoTo(_carouselIdx + 1), 60 * 1000);
}

function _carouselGoTo(targetIdx, resetTimer = false) {
  const img     = document.getElementById('cdet-carousel-img');
  const overlay = document.getElementById('cdet-carousel-overlay');
  const dotsEl  = document.getElementById('cdet-carousel-dots');
  if (!img || !overlay || !_carouselImages.length) {
    clearInterval(_carouselTimer); _carouselTimer = null; return;
  }

  const next = ((targetIdx % _carouselImages.length) + _carouselImages.length) % _carouselImages.length;

  // Phase 1: darken
  overlay.classList.add('dimmed');

  setTimeout(() => {
    // Phase 2: swap image
    _carouselIdx = next;
    img.src = _carouselImages[_carouselIdx];

    // Update dots
    if (dotsEl) {
      dotsEl.querySelectorAll('.cdet-carousel-dot').forEach((d, i) =>
        d.classList.toggle('active', i === _carouselIdx));
    }

    // Phase 3: un-darken
    setTimeout(() => overlay.classList.remove('dimmed'), 300);
  }, 2100);

  // Reset auto-timer on manual nav
  if (resetTimer && _carouselTimer) {
    clearInterval(_carouselTimer);
    _carouselTimer = setInterval(() => _carouselGoTo(_carouselIdx + 1), 60 * 1000);
  }
}

function _carouselAdvance() { _carouselGoTo(_carouselIdx + 1); }

// Stop carousel when modal closes
document.getElementById('char-detail-close')?.addEventListener('click', () => {
  if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
}, { capture: true });

// ── Panel editing (bio / rels / desc) ────────────────────────────────────────

function _togglePanelEdit(panel, on) {
  const view = document.getElementById(`cdet-${panel}-view`);
  const edit = document.getElementById(`cdet-${panel}-edit`);
  const bar  = document.getElementById(`cdet-${panel}-bar`);
  const btn  = document.querySelector(`[data-editpanel="${panel}"]`);
  if (!view || !edit || !bar) return;
  view.style.display = on ? 'none' : '';
  edit.style.display = on ? '' : 'none';
  bar.classList.toggle('show', on);
  if (btn) { btn.classList.toggle('active', on); btn.textContent = on ? '✏ Режим редактирования' : '✏ Редактировать'; }
  if (on) {
    if (panel === 'desc') {
      const charName = document.querySelector('[data-editpanel="desc"][data-char]')?.dataset.char;
      if (charName) _loadDescImages(charName);
    } else if (panel === 'rels') {
      // Rebuild rows from the latest saved relationships (discard prior unsaved edits)
      const charName = document.querySelector('[data-editpanel="rels"][data-char]')?.dataset.char;
      const ch  = STATE.characters.find(c => c.name === charName);
      const rows = document.getElementById('cdet-rels-rows');
      if (ch && rows) rows.innerHTML = (ch.relationships || []).map(r => _relRowHtml(r.target, r.description)).join('');
      rows?.querySelector('.cdet-rel-name-inp')?.focus();
    } else {
      edit.querySelector('textarea')?.focus();
    }
  }
}

async function _savePanelEdit(panel, charName) {
  const bar  = document.getElementById(`cdet-${panel}-bar`);
  const msg  = document.getElementById(`cdet-${panel}-msg`);
  const save = bar?.querySelector('.cdet-save-btn');
  if (!save) return;

  save.disabled = true;
  save.textContent = '⏳ Сохранение...';

  const qs = window.location.search;
  let ok = false;

  try {
    if (panel === 'bio') {
      const bio = document.getElementById('cdet-bio-ta')?.value.trim() || '';
      const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { biography: bio } }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        const ch = STATE.characters.find(c => c.name === charName);
        if (ch) ch.biography = bio;
        document.getElementById('cdet-bio-view').innerHTML =
          bio ? `<div class="cdet-bio">${escHtml(bio)}</div>` : '<div class="cdet-empty">Биография не заполнена</div>';
      }
    } else if (panel === 'rels') {
      const lines = Array.from(document.querySelectorAll('#cdet-rels-rows .cdet-rel-row')).map(row => {
        const target = row.querySelector('.cdet-rel-name-inp')?.value.trim() || '';
        const desc   = row.querySelector('.cdet-rel-type-inp')?.value.trim() || '';
        if (!target) return null;
        return desc ? `${target} — ${desc}` : target;
      }).filter(Boolean);
      const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/relations${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        // Refresh relations view (handles "Имя — описание" and name-only)
        const rels = lines.map(l => {
          const idx = l.indexOf(' — ');
          return idx >= 0
            ? { target: l.slice(0, idx).trim(), description: l.slice(idx + 3).trim() }
            : { target: l.trim(), description: '' };
        });
        const ch = STATE.characters.find(c => c.name === charName);
        if (ch) ch.relationships = rels;
        const relsHtml = rels.map(r => `
          <div class="cdet-rel">
            <div class="cdet-rel-name">${escHtml(r.target)}</div>
            <div class="cdet-rel-desc">${escHtml(r.description)}</div>
          </div>`).join('');
        document.getElementById('cdet-rels-view').innerHTML =
          relsHtml ? `<div class="cdet-rels-list">${relsHtml}</div>` : '<div class="cdet-empty">Нет известных связей</div>';
      }
    } else if (panel === 'desc') {
      const appearance   = document.getElementById('cdet-appearance-ta')?.value.trim() || '';
      const voice        = document.getElementById('cdet-voice-ta')?.value.trim() || '';
      const personality  = document.getElementById('cdet-personality-ta')?.value.trim() || '';
      const imagePrompt  = document.getElementById('cdet-prompt-ta')?.value.trim() || '';
      const negativePrompt = document.getElementById('cdet-negprompt-ta')?.value.trim() || '';
      const fields = {};
      if (appearance)   fields.appearance    = appearance;
      if (voice)        fields.voice         = voice;
      if (personality)  fields.personality   = personality;
      if (imagePrompt)  fields.imagePrompt   = imagePrompt;
      if (negativePrompt) fields.negativePrompt = negativePrompt;
      const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        const ch = STATE.characters.find(c => c.name === charName);
        if (ch) Object.assign(ch, { appearance, voice, personality, imagePrompt, negativePrompt });
        // Refresh desc view
        const descHtml = [
          appearance ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
          voice ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
          personality ? `<div class="cdet-section-title">Характер</div><div class="cdet-bio">${escHtml(personality)}</div><div class="cdet-divider"></div>` : '',
          _promptSectionHtml(imagePrompt, negativePrompt),
        ].filter(Boolean).join('');
        document.getElementById('cdet-desc-view').innerHTML = descHtml || '<div class="cdet-empty">Описание не заполнено</div>';
      }
    }
  } catch(e) { showToast('Ошибка: ' + e.message, 'error'); }

  save.disabled = false;
  save.textContent = 'Сохранить';
  if (ok) {
    _togglePanelEdit(panel, false);
    if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }
  }
}

async function _generateAppearance(charName) {
  if (_genAppearanceRunning) return;
  _genAppearanceRunning = true;
  const btn = document.getElementById('cdet-gen-appearance');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализ арта...'; }

  try {
    const claudeModel  = localStorage.getItem('ai-model') || 'claude-opus-4-8';
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _appPref     = _getPref(featPrefs, 'appearance', 'openrouter');
    const preferSource = _appPref.provider;
    const orModel      = preferSource === 'openrouter' ? (_appPref.model || null) : null;
    const qs           = window.location.search;

    // 1. Генерируем внешность через Vision API
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(_charSlug(charName))}/generate-appearance${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: claudeModel, preferSource, orModel }) }
    );
    const d = await resp.json();
    if (resp.status === 429 || d.rateLimited) {
      showToast('Превышен лимит запросов к API.\n\nПодождите минуту и попробуйте снова, или смените модель в Настройках AI.', 'warning');
      return;
    }
    if (!d.ok) { showToast('Ошибка генерации: ' + (d.error || 'неизвестная ошибка'), 'error'); return; }

    // 2. Автосохраняем в карточку персонажа
    if (btn) btn.textContent = '💾 Сохранение...';
    const saveResp = await fetch(
      `/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { appearance: d.appearance } }) }
    );
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast('Ошибка сохранения: ' + (saveData.error || ''), 'error'); return; }

    // 3. Обновляем STATE
    const ch = STATE.characters.find(c => c.name === charName);
    if (ch) ch.appearance = d.appearance;

    // 4. Обновляем вкладку Описание (view-режим)
    const view = document.getElementById('cdet-desc-view');
    if (view) {
      const cur = ch || {};
      const voice       = cur.voice       || '';
      const personality = cur.personality || '';
      const imagePrompt = cur.imagePrompt || '';
      const negPrompt   = cur.negativePrompt || '';
      view.innerHTML = [
        d.appearance  ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(d.appearance)}</div><div class="cdet-divider"></div>` : '',
        voice         ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        personality   ? `<div class="cdet-section-title">Характер</div><div class="cdet-bio">${escHtml(personality)}</div><div class="cdet-divider"></div>` : '',
        _promptSectionHtml(imagePrompt, negPrompt),
      ].filter(Boolean).join('') || '<div class="cdet-empty">Описание не заполнено</div>';
    }

    // 5. Также обновляем textarea если вкладка открыта в режиме редактирования
    const ta = document.getElementById('cdet-appearance-ta');
    if (ta) ta.value = d.appearance;

    // 6. Мигаем сообщением об успехе
    const msg = document.getElementById('cdet-desc-save-msg');
    if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }

    if (btn) btn.title = `Изображений проанализировано: ${d.imagesUsed} | ${d.source}`;
  } catch(e) {
    showToast('Ошибка соединения: ' + e.message, 'error');
  } finally {
    _genAppearanceRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '👁 Внешность по арту'; }
  }
}

async function _loadDescImages(charName) {
  const gallery = document.getElementById('cdet-img-gallery');
  if (!gallery) return;
  gallery.innerHTML = '<div class="cdet-img-gallery-loading">Загрузка…</div>';

  const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/images${window.location.search}`).catch(() => null);
  if (!resp?.ok) { gallery.innerHTML = ''; return; }
  const { images } = await resp.json().catch(() => ({}));

  if (!images?.length) {
    gallery.innerHTML = '<div class="cdet-empty" style="margin-bottom:12px">Нет загруженных изображений</div>';
    return;
  }

  gallery.innerHTML = `
    <div class="cdet-section-title">Изображения</div>
    <div class="cdet-img-gallery-grid">
      ${images.map(url => {
        const filename = decodeURIComponent(url.split('/').pop());
        return `<div class="cdet-img-thumb-wrap">
          <img class="cdet-img-thumb" src="${url}" alt="${escHtml(filename)}" loading="lazy" decoding="async">
          <span class="cdet-img-thumb-name">${escHtml(filename)}</span>
          <button class="cdet-img-del-btn" data-char="${escHtml(charName)}" data-file="${escHtml(filename)}" title="Удалить">✕</button>
        </div>`;
      }).join('')}
    </div>
    <div class="cdet-divider"></div>`;
}

async function _deleteCharImage(charName, filename) {
  if (!await showConfirm(`Удалить «${filename}»?\nДействие необратимо.`, { danger: true, confirmText: 'Удалить' })) return;

  const qs = window.location.search;
  try {
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(_charSlug(charName))}/images/${encodeURIComponent(filename)}${qs}`,
      { method: 'DELETE' }
    );
    const d = await resp.json();
    if (!d.ok) { showToast('Ошибка удаления: ' + (d.error || ''), 'error'); return; }

    // Remove thumbnail from gallery
    const wrap = document.querySelector(`.cdet-img-del-btn[data-file="${CSS.escape(filename)}"]`)?.closest('.cdet-img-thumb-wrap');
    if (wrap) wrap.remove();

    const grid = document.querySelector('.cdet-img-gallery-grid');
    if (grid && !grid.querySelectorAll('.cdet-img-thumb-wrap').length) {
      document.getElementById('cdet-img-gallery').innerHTML =
        '<div class="cdet-empty" style="margin-bottom:12px">Нет загруженных изображений</div>';
    }

    // Refresh carousel (remove deleted image from list)
    const encodedFile = encodeURIComponent(filename);
    _carouselImages = _carouselImages.filter(u => !u.includes(encodedFile) && !u.includes(filename));
    if (_carouselImages.length) {
      _carouselIdx = Math.min(_carouselIdx, _carouselImages.length - 1);
      _carouselGoTo(_carouselIdx);
      // Rebuild dots
      const dotsEl = document.getElementById('cdet-carousel-dots');
      if (dotsEl) {
        dotsEl.innerHTML = _carouselImages.map((_, i) =>
          `<div class="cdet-carousel-dot${i === _carouselIdx ? ' active' : ''}"></div>`
        ).join('');
      }
    } else {
      if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
      const carouselEl = document.getElementById('cdet-carousel');
      const col = document.getElementById('cdet-portrait-col');
      if (col) col.innerHTML = '<div class="cdet-no-portrait">🩸</div>';
    }

    // Invalidate grid cache
    if (_gridImages[charName]) {
      _gridImages[charName] = _gridImages[charName].filter(u => !u.includes(encodedFile) && !u.includes(filename));
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

let _genPromptRunning = false;

// Generate in-character NPC dialogue lines (Voice + clan style)
async function _genDialogue(charName) {
  const sitEl = document.getElementById('cdet-dlg-situation');
  const box   = document.getElementById('cdet-dlg-result');
  const btn   = document.getElementById('cdet-gen-dialogue');
  const situation = sitEl?.value.trim() || '';
  if (!box) return;
  box.style.display = '';
  if (!situation) { box.innerHTML = '<div class="canon-warn">Опиши ситуацию для реплик.</div>'; return; }
  btn.disabled = true; btn.textContent = '⏳ Генерация…';
  box.innerHTML = '<div class="canon-loading">💬 Подбираю реплики в характере…</div>';
  try {
    const qs    = window.location.search;
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref  = _getPref(prefs, 'dialogue', 'openrouter');
    const d = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/dialogue${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ situation, source: pref.provider, model: pref.model }) }
    ).then(r => r.json());
    if (!d.ok) { box.innerHTML = `<div class="canon-warn">Ошибка: ${escHtml(d.error || 'не удалось')}</div>`; return; }
    const lines = (d.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    box.innerHTML = (lines.length ? _dlgFallbackNote(d.source) : '') + (lines.length
      ? `<div class="cdet-dlg-lines">${lines.map(l => `<div class="cdet-dlg-line">${escHtml(l)}</div>`).join('')}</div>`
      : '<div class="canon-warn">Пустой ответ.</div>');
  } catch (e) {
    box.innerHTML = `<div class="canon-warn">Ошибка: ${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '💬 Сгенерировать реплики';
  }
}

// Single source of truth for the "Промт для генерации" block in #cdet-desc-view,
// so the copy button (#cdet-prompt-copy) can't silently drop out of one of the
// several re-render call sites (initial render, manual save, AI generation) again.
function _promptSectionHtml(imagePrompt, negativePrompt) {
  if (!imagePrompt) return '';
  return `
    <div class="cdet-section-title cdet-prompt-head">
      <span>Промт для генерации</span>
      <button type="button" class="cdet-prompt-copy" id="cdet-prompt-copy"
        title="Скопировать промт${negativePrompt ? ' и негатив' : ''} в буфер обмена" aria-label="Скопировать промт в буфер обмена">⧉</button>
    </div>
    <textarea class="cdet-prompt-box" readonly>${escHtml(imagePrompt)}</textarea>
    ${negativePrompt ? `
      <div class="cdet-section-title" style="margin-top:14px">Негативный промт</div>
      <textarea class="cdet-prompt-box cdet-prompt-neg" readonly>${escHtml(negativePrompt)}</textarea>` : ''}`;
}

// Copy positive + negative image prompt as one clipboard payload (A1111-style,
// so it can be pasted whole and most generators parse the "Negative prompt:" tail).
function _copyImagePrompt(btn) {
  const view = btn.closest('#cdet-desc-view') || document;
  const pos = view.querySelector('.cdet-prompt-box:not(.cdet-prompt-neg)')?.value.trim() || '';
  const neg = view.querySelector('.cdet-prompt-neg')?.value.trim() || '';
  if (!pos && !neg) return;
  const payload = neg ? `${pos}\n\nNegative prompt: ${neg}` : pos;
  const flash = ok => {
    btn.textContent = ok ? '✓' : '✕';
    btn.classList.toggle('copied', ok);
    setTimeout(() => { btn.textContent = '⧉'; btn.classList.remove('copied'); }, 1400);
  };
  navigator.clipboard.writeText(payload).then(() => flash(true)).catch(() => flash(false));
}

async function _generatePrompt(charName) {
  if (_genPromptRunning) return;

  const c = STATE.characters.find(ch => ch.name === charName);
  if (!c) return;

  // Treat placeholder markers (⏳ Заполнить… / ⚠️ Требуется уточнение) as "no prompt yet".
  const existingPrompt = (c.imagePrompt || '').trim();
  const isPlaceholder  = !existingPrompt || /⏳|⚠️/.test(existingPrompt);
  if (!isPlaceholder) {
    if (!await showConfirm('Промт уже существует. Заменить его на сгенерированный?', { confirmText: 'Заменить' })) return;
  }

  _genPromptRunning = true;
  const btn = document.getElementById('cdet-gen-prompt');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация...'; }

  try {
    const qs = window.location.search;
    const featPrefs  = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _promptPref = _getPref(featPrefs, 'prompt', 'openrouter');
    const preferSource = _promptPref.provider;
    const orModel    = preferSource === 'openrouter' ? (_promptPref.model || null) : null;

    const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/generate-prompt${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json();

    if (resp.status === 429 || d.rateLimited) {
      showToast('Превышен лимит запросов к API.\n\nПодождите минуту и попробуйте снова, или смените модель в Настройках AI.', 'warning');
      return;
    }
    if (!d.ok) {
      showToast('Ошибка генерации промта: ' + (d.error || 'неизвестная ошибка'), 'error');
      return;
    }

    const saveResp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { imagePrompt: d.positive, negativePrompt: d.negative } }),
    });
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast('Ошибка сохранения промта: ' + (saveData.error || ''), 'error'); return; }

    Object.assign(c, { imagePrompt: d.positive, negativePrompt: d.negative });

    const descView = document.getElementById('cdet-desc-view');
    if (descView) {
      const appearance  = c.appearance && !c.appearance.includes('⚠️') ? c.appearance : '';
      const voice       = c.voice && !c.voice.includes('⚠️') ? c.voice : '';
      const personality = c.personality && !c.personality.includes('⚠️') ? c.personality : '';
      const html = [
        appearance ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
        voice ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        personality ? `<div class="cdet-section-title">Характер</div><div class="cdet-bio">${escHtml(personality)}</div><div class="cdet-divider"></div>` : '',
        _promptSectionHtml(d.positive, d.negative),
      ].filter(Boolean).join('');
      descView.innerHTML = html;
    }
    const promptTa = document.getElementById('cdet-prompt-ta');
    if (promptTa) promptTa.value = d.positive;
    const negTa = document.getElementById('cdet-negprompt-ta');
    if (negTa) negTa.value = d.negative || '';

  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    _genPromptRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '🎨 Промт'; }
  }
}

let _genPersonalityRunning = false;

async function _generatePersonality(charName) {
  if (_genPersonalityRunning) return;

  const c = STATE.characters.find(ch => ch.name === charName);
  if (!c) return;

  const hasAppearance = c.appearance && !c.appearance.includes('⚠️');
  const hasBio        = c.biography && !c.biography.includes('⚠️');
  if (!hasAppearance && !hasBio) {
    showToast('Заполните «Внешность» или «Биография» перед генерацией характера и голоса.', 'warning');
    return;
  }

  const existingPersonality = (c.personality || '').trim();
  if (existingPersonality && !/⚠️/.test(existingPersonality)) {
    if (!await showConfirm('Характер уже заполнен. Сгенерировать уточнённую версию на основе информации/биографии/внешности (текущий текст будет использован как черновик)?', { confirmText: 'Сгенерировать' })) return;
  }

  _genPersonalityRunning = true;
  const btn = document.getElementById('cdet-gen-personality');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация...'; }

  try {
    const qs = window.location.search;
    const featPrefs     = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _persPref     = _getPref(featPrefs, 'personality', 'openrouter');
    const preferSource  = _persPref.provider;
    const orModel       = preferSource === 'openrouter' ? (_persPref.model || null) : null;

    const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/generate-personality${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json();

    if (resp.status === 429 || d.rateLimited) {
      showToast('Превышен лимит запросов к API.\n\nПодождите минуту и попробуйте снова, или смените модель в Настройках AI.', 'warning');
      return;
    }
    if (!d.ok) {
      showToast('Ошибка генерации характера: ' + (d.error || 'неизвестная ошибка'), 'error');
      return;
    }

    const fields = { personality: d.personality };
    if (d.voice) fields.voice = d.voice;
    const saveResp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast('Ошибка сохранения: ' + (saveData.error || ''), 'error'); return; }

    Object.assign(c, fields);

    const descView = document.getElementById('cdet-desc-view');
    if (descView) {
      const appearance = c.appearance && !c.appearance.includes('⚠️') ? c.appearance : '';
      const voice       = c.voice && !c.voice.includes('⚠️') ? c.voice : '';
      descView.innerHTML = [
        appearance ? `<div class="cdet-section-title">Внешность</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
        voice ? `<div class="cdet-section-title">Голос</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        d.personality ? `<div class="cdet-section-title">Характер</div><div class="cdet-bio">${escHtml(d.personality)}</div><div class="cdet-divider"></div>` : '',
        _promptSectionHtml(c.imagePrompt, c.negativePrompt),
      ].filter(Boolean).join('') || '<div class="cdet-empty">Описание не заполнено</div>';
    }

    const persTa = document.getElementById('cdet-personality-ta');
    if (persTa) persTa.value = d.personality || '';
    if (d.voice) {
      const voiceTa = document.getElementById('cdet-voice-ta');
      if (voiceTa) voiceTa.value = d.voice;
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    _genPersonalityRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '🎭 Характер и голос'; }
  }
}

let _genBiographyRunning = false;

async function _generateBiography(charName) {
  if (_genBiographyRunning) return;

  const c = STATE.characters.find(ch => ch.name === charName);
  if (!c) return;

  const existingBio = (c.biography || '').trim();
  if (existingBio && !/⚠️/.test(existingBio)) {
    if (!await showConfirm('Биография уже заполнена. Сгенерировать уточнённую версию на основе информации/отношений (текущий текст будет использован как черновик)?', { confirmText: 'Сгенерировать' })) return;
  }

  _genBiographyRunning = true;
  const btn = document.getElementById('cdet-gen-biography');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация...'; }

  try {
    const qs = window.location.search;
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _bioPref     = _getPref(featPrefs, 'biography', 'openrouter');
    const preferSource = _bioPref.provider;
    const orModel       = preferSource === 'openrouter' ? (_bioPref.model || null) : null;

    const resp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/generate-biography${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json();

    if (resp.status === 429 || d.rateLimited) {
      showToast('Превышен лимит запросов к API.\n\nПодождите минуту и попробуйте снова, или смените модель в Настройках AI.', 'warning');
      return;
    }
    if (!d.ok) {
      showToast('Ошибка генерации биографии: ' + (d.error || 'неизвестная ошибка'), 'error');
      return;
    }

    const saveResp = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/fields${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { biography: d.biography } }),
    });
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast('Ошибка сохранения биографии: ' + (saveData.error || ''), 'error'); return; }

    c.biography = d.biography;

    document.getElementById('cdet-bio-view').innerHTML =
      d.biography ? `<div class="cdet-bio">${escHtml(d.biography)}</div>` : '<div class="cdet-empty">Биография не заполнена</div>';
    const bioTa = document.getElementById('cdet-bio-ta');
    if (bioTa) bioTa.value = d.biography || '';
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    _genBiographyRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '📖 Сгенерировать биографию'; }
  }
}

// ── Info field editing ────────────────────────────────────────────────────────
let _editCharName   = null;
let _editOrigName   = null;
let _editOrigValues = {};
let _genAppearanceRunning = false;

function _enterInfoEdit(charName) {
  _editCharName = charName;
  _editOrigName = charName;
  _editOrigValues = {};

  const grid = document.getElementById('cdet-info-fields');
  const btn  = document.getElementById('cdet-edit-btn');
  const bar  = document.getElementById('cdet-edit-bar');
  if (!grid || !btn || !bar) return;

  grid.classList.add('editing');   // reveal empty optional fields while editing

  // Make name in sticky header editable
  const nameEl = document.querySelector('#char-detail-content .cdet-name');
  if (nameEl && !document.getElementById('cdet-name-input')) {
    const nameInput = document.createElement('input');
    nameInput.className = 'cdet-name-input';
    nameInput.id = 'cdet-name-input';
    nameInput.value = charName;
    nameInput.placeholder = 'Имя персонажа';
    nameEl.replaceWith(nameInput);
  }

  // Replace each .cdet-val with an input
  grid.querySelectorAll('.cdet-val').forEach(cell => {
    const key = cell.dataset.field;
    const isUnknown = cell.classList.contains('unknown');
    const current = isUnknown ? '' : cell.textContent;
    _editOrigValues[key] = current;

    let input;
    if (key === 'status') {
      input = document.createElement('select');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      const options = ['Жив', 'Жива', 'Торпор', 'Мёртв', 'Мертва', 'Пропал', 'Неизвестно'];
      // Старые/нестандартные значения («Активен», «Уничтожен (декабрь 2010)» и т.п.)
      // не входят в список — не подменяем их молча, а добавляем как есть первым
      // пунктом, чтобы сохранение без изменений не потеряло исходный текст.
      if (current && !options.includes(current)) options.unshift(current);
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (current === opt) o.selected = true;
        input.appendChild(o);
      });
    } else if (key === 'belonging') {
      input = document.createElement('select');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      ['Персонаж мастера', 'Персонаж игрока', 'Эпизодический персонаж', 'Фамильяр'].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (current === opt) o.selected = true;
        input.appendChild(o);
      });
    } else if (key === 'generation') {
      input = document.createElement('select');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      // Legacy cards stored generation as a bare number ("8") or with qualifiers
      // ("12-е (предположительно)") — match by leading digits so a clean numeric
      // value still pre-selects correctly; anything else falls back to blank.
      const curNum = (current.match(/\d+/) || [])[0];
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '— выбрать —';
      input.appendChild(blank);
      VAMPIRE_GENERATIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (curNum && opt.startsWith(curNum + '-')) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = 'Неизвестно';
    }
    cell.replaceWith(input);
  });

  btn.classList.add('active');
  btn.textContent = '✏ Режим редактирования';
  bar.classList.add('show');

  // Focus name input
  document.getElementById('cdet-name-input')?.focus();
}

function _exitInfoEdit(saved) {
  const grid = document.getElementById('cdet-info-fields');
  const btn  = document.getElementById('cdet-edit-btn');
  const bar  = document.getElementById('cdet-edit-bar');
  if (!grid || !btn || !bar) return;

  // Restore name in sticky header
  const nameInput = document.getElementById('cdet-name-input');
  if (nameInput) {
    const displayName = saved ? (nameInput.value.trim() || _editOrigName) : _editOrigName;
    const nameEl = document.createElement('div');
    nameEl.className = 'cdet-name';
    nameEl.textContent = displayName;
    nameInput.replaceWith(nameEl);
  }

  // Restore value cells (+ re-apply view-mode hiding of empty optional fields)
  const _lineage   = _lineageOf(_editCharName || _editOrigName);
  const _reqFields = requiredInfoFor(_lineage);
  const _fieldSet  = infoFieldsFor(_lineage);
  grid.querySelectorAll('.cdet-field-input').forEach(input => {
    const key      = input.dataset.field;
    const value    = saved ? input.value.trim() : (_editOrigValues[key] || '');
    const empty    = !value;
    const required = _reqFields.has(key);
    const hide     = empty && !required;
    const div = document.createElement('div');
    div.className = 'cdet-val' + (empty ? ' unknown' : '') + (hide ? ' cdet-opt-empty' : '');
    div.dataset.field = key;
    div.textContent   = empty ? 'Неизвестно' : value;
    // sync the preceding label cell (hide class + required «!» flag)
    const keyCell = input.previousElementSibling;
    if (keyCell && keyCell.classList.contains('cdet-key')) {
      const lbl = (_fieldSet.find(([fk]) => fk === key) || [null, key])[1];
      keyCell.innerHTML = (empty && required)
        ? `${lbl} <span class="cdet-req-flag" title="Обязательное поле">!</span>` : lbl;
      keyCell.classList.toggle('cdet-opt-empty', hide);
    }
    input.replaceWith(div);
  });
  grid.classList.remove('editing');

  btn.classList.remove('active');
  btn.textContent = '✏ Редактировать';
  bar.classList.remove('show');
  _editCharName = null;
  _editOrigName = null;
}

async function _saveInfoFields() {
  const grid    = document.getElementById('cdet-info-fields');
  const saveBtn = document.getElementById('cdet-save-btn');
  const msg     = document.getElementById('cdet-save-msg');
  if (!grid || !_editCharName) return;

  const prevName = _editCharName;
  const fields = {};

  // Collect name from header input if changed
  const nameInput = document.getElementById('cdet-name-input');
  const newName = nameInput?.value.trim();
  if (newName && newName !== prevName) fields.name = newName;

  grid.querySelectorAll('.cdet-field-input').forEach(inp => {
    const v = inp.value.trim();
    if (v) fields[inp.dataset.field] = v;
  });

  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ Сохранение...';

  try {
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(_charSlug(prevName))}/fields${window.location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }) }
    );
    const d = await resp.json();
    if (d.ok) {
      const finalName = fields.name || prevName;

      // Update STATE cache
      const ch = STATE.characters.find(c => c.name === prevName);
      if (ch) {
        if (fields.name) ch.name = fields.name;
        Object.assign(ch, Object.fromEntries(
          Object.entries(fields).filter(([k]) => k !== 'name').map(([k, v]) => [k, v])
        ));
      }

      // Sync grid card when name changed
      if (fields.name) {
        const gridCard = document.querySelector(`.char-card[data-name="${CSS.escape(prevName)}"]`);
        if (gridCard) {
          gridCard.dataset.name = finalName;
          const gridNameEl = gridCard.querySelector('.char-name');
          if (gridNameEl) gridNameEl.textContent = finalName;
        }
        // Update data-char on modal buttons so subsequent saves work
        document.querySelectorAll('#char-detail-content [data-char]').forEach(el => {
          if (el.dataset.char === prevName) el.dataset.char = finalName;
        });
        _editCharName = finalName;
      }

      _exitInfoEdit(true);
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2500);
    } else {
      showToast('Ошибка: ' + (d.error || 'не удалось сохранить'), 'error');
    }
  } catch(e) {
    showToast('Ошибка соединения: ' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить';
  }
}

async function triggerImageUpload(charName) {
  const input = document.createElement('input');
  input.type  = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const btn = document.querySelector('.cdet-upload-btn');
    if (btn) { btn.textContent = '⏳ Загрузка...'; btn.disabled = true; }
    try {
      const ext    = file.name.split('.').pop().toLowerCase();
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp   = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, ext })
      });
      const result = await resp.json();
      if (result.success) {
        const newUrl = result.url + '?t=' + Date.now();
        // Update portrait in modal immediately
        const col = document.getElementById('cdet-portrait-col');
        if (col) col.innerHTML = `<div class="cdet-carousel" id="cdet-carousel">
          <img class="cdet-carousel-img" id="cdet-carousel-img" src="${newUrl}" alt="${escHtml(charName)}">
          <div class="cdet-carousel-overlay" id="cdet-carousel-overlay"></div>
          <button class="cdet-carousel-btn prev" id="cdet-carousel-prev" title="Предыдущее">&#8249;</button>
          <button class="cdet-carousel-btn next" id="cdet-carousel-next" title="Следующее">&#8250;</button>
          <div class="cdet-carousel-dots" id="cdet-carousel-dots"></div>
         </div>`;
        initCarousel(charName);
        // Patch the character in STATE so the card and modal re-open correctly
        const charInState = STATE.characters.find(ch => ch.name === charName);
        if (charInState) charInState.imageUrl = newUrl;
        // Re-render cards if user is on the characters page
        if (STATE.page === 'characters') renderChars();
        const b = document.querySelector('.cdet-upload-btn');
        if (b) {
          b.textContent = `✓ Сохранено как ${result.filename} — загрузить ещё`;
          b.style.background = 'rgba(0,80,0,.25)';
          b.disabled = false;
        }
      } else {
        throw new Error(result.error || 'Неизвестная ошибка');
      }
    } catch (err) {
      const isOffline = err.message.includes('Failed to fetch') || err.name === 'TypeError';
      const b = document.querySelector('.cdet-upload-btn');
      if (b) { b.textContent = '📷 Загрузить изображение'; b.disabled = false; }
      if (isOffline) {
        showToast('Сервер недоступен. Перезапустите start.bat и попробуйте снова.', 'error');
      } else {
        showToast('Ошибка загрузки: ' + err.message, 'error');
      }
    }
  };
  input.click();
}

// Locations page (list/detail) moved to public/locations.js (E2.3).
// ── Module page: editPanel helpers ────────────────────────────────────────────

// После отмены редактирования одного поля внутри блока проверяет, остались ли
// ещё открытые поля — если нет, прячет кнопку «Сохранить всё» этого блока
// (она включается только при входе в блок целиком, см. data-editblock).
function _modSyncBlockSaveAllVisibility(panel) {
  if (!panel || !panel.startsWith('scensec')) return;
  const viewEl = document.getElementById(`moddet-${panel}-view`);
  const block  = viewEl?.closest('.modp-scenario-block');
  if (!block) return;
  const saveAllBtn = block.querySelector('[data-blocksaveall]');
  if (!saveAllBtn) return;
  const anyEditing = Array.from(block.querySelectorAll('.modp-scenario-field [id$="-edit"]'))
    .some(ed => ed.style.display !== 'none');
  if (!anyEditing) saveAllBtn.style.display = 'none';
}

function _modToggleEdit(panel, enter) {
  const viewEl = document.getElementById(`moddet-${panel}-view`);
  const editEl = document.getElementById(`moddet-${panel}-edit`);
  const barEl  = document.getElementById(`moddet-${panel}-bar`);
  const msgEl  = document.getElementById(`moddet-${panel}-msg`);
  if (!viewEl || !editEl) return;
  viewEl.style.display = enter ? 'none' : '';
  editEl.style.display = enter ? '' : 'none';
  if (barEl) barEl.style.display = enter ? 'flex' : 'none';
  if (msgEl) msgEl.style.display = 'none';
}

async function _modSavePanel(panel) {
  const d   = STATE.currentModuleData;
  const chr = d?.chronicle || STATE.currentModule?.chronicle;
  const mod = d?.name      || STATE.currentModule?.name;
  if (!chr || !mod) return;

  const msgEl  = document.getElementById(`moddet-${panel}-msg`);
  const fields = {};

  if (panel === 'desc') {
    fields.description = document.getElementById('moddet-desc-ta')?.value || '';

  } else if (panel === 'pcs' || panel === 'npcs') {
    const chips = document.querySelectorAll(`#moddet-${panel}-chips .moddet-chip`);
    fields[panel] = Array.from(chips).map(c => c.dataset.name).filter(Boolean);

  } else if (panel === 'scenario') {
    const content = document.getElementById('moddet-scenario-ta')?.value || '';
    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
      );
      if (!r.ok) throw new Error(await r.text());
      if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
      _modToggleEdit(panel, false);
      await _reloadModulePage();
    } catch { if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; } }
    return;

  } else if (panel === 'finale') {
    const content = document.getElementById('moddet-finale-ta')?.value || '';
    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/finale${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
      );
      if (!r.ok) throw new Error(await r.text());
      if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
      _modToggleEdit(panel, false);
      await _reloadModulePage();
    } catch { if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; } }
    return;

  } else if (panel.startsWith('scensec')) {
    const idx     = parseInt(panel.slice('scensec'.length), 10);
    const info    = (STATE.scenarioSectionHeadings || [])[idx];
    const content = document.getElementById(`moddet-${panel}-ta`)?.value || '';
    if (!info) return;
    const { heading, parent } = info;

    // Сохранение ОДНОГО поля блока полностью перерисовывает панель (свежие
    // данные с сервера) — это сбрасывает все поля блока в режим просмотра.
    // Если рядом в том же блоке ещё открыты другие поля с несохранёнными
    // правками (кнопка «Редактировать» на блоке открывает их все разом),
    // черновики нужно снять перед перерисовкой и восстановить после — иначе
    // сохранение одного поля молча стирает правки в соседних.
    const block = document.getElementById(`moddet-${panel}-view`)?.closest('.modp-scenario-block');
    const siblingDrafts = [];
    if (block) {
      const idxs = (block.dataset.fieldIdxs || '').split(',').filter(Boolean);
      for (const siblingIdx of idxs) {
        if (siblingIdx === String(idx)) continue;
        const editEl = document.getElementById(`moddet-scensec${siblingIdx}-edit`);
        if (editEl && editEl.style.display !== 'none') {
          const ta = document.getElementById(`moddet-scensec${siblingIdx}-ta`);
          if (ta) siblingDrafts.push({ idx: siblingIdx, value: ta.value });
        }
      }
    }

    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heading, content, parent }) }
      );
      const result = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(result.error || 'Ошибка сохранения');
      STATE.currentModuleData.scenario = result.scenario;
      _renderScenarioPanel(STATE.currentModuleData);
      for (const draft of siblingDrafts) {
        _modToggleEdit(`scensec${draft.idx}`, true);
        const ta = document.getElementById(`moddet-scensec${draft.idx}-ta`);
        if (ta) ta.value = draft.value;
      }
      if (siblingDrafts.length) {
        // Соседние поля снова в режиме редактирования — блок опять содержит
        // несколько открытых полей, поэтому кнопка «Сохранить всё» должна
        // быть видна, как и при обычном входе в блок целиком (data-editblock).
        const restoredBlock = document.getElementById(`moddet-scensec${siblingDrafts[0].idx}-view`)?.closest('.modp-scenario-block');
        const saveAllBtn = restoredBlock?.querySelector('[data-blocksaveall]');
        if (saveAllBtn) saveAllBtn.style.display = '';
      }
    } catch (e) {
      if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; }
      showToast('Не удалось сохранить раздел: ' + e.message, 'error');
    }
    return;
  }

  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fields${window.location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
    );
    if (!r.ok) throw new Error(await r.text());
    if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
    _modToggleEdit(panel, false);
    await _reloadModulePage();
  } catch { if (msgEl) { msgEl.textContent = '✗ Ошибка'; msgEl.style.display = ''; } }
}

async function _reloadModulePage() {
  const chr = STATE.currentModule?.chronicle;
  const mod = STATE.currentModule?.name;
  if (!chr || !mod) return;
  const activeTab = document.querySelector('.modp-tab.active')?.dataset?.modtab || 'info';
  const data = await fetch(
    `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${window.location.search}`
  ).then(r => r.json()).catch(() => null);
  if (data) {
    STATE.currentModuleData = data;
    renderModulePage(data);
    if (activeTab && activeTab !== 'info') {
      document.querySelectorAll('.modp-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.modtab === activeTab));
      document.querySelectorAll('.modp-panel').forEach(p =>
        p.classList.toggle('active', p.id === `modp-panel-${activeTab}`));
    }
  }
}
