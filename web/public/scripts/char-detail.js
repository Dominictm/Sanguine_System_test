// Компактная карточка фамильяра для вкладки «Фамильяр» (5.8) — усечённая версия портрета/полей
// из openCharDetail (portraitCol/infoFields), не полный рекурсивный рендер всей модалки.
function _familiarCardHtml(fc) {
  const icon = LINEAGE_ICONS[fc.lineage] || '👤';
  const stType = fc.statusType || 'unknown';
  const stLbl = statusLabel(fc);
  const portrait = fc.imageUrl
    ? `<img class="cdet-familiar-portrait" src="${escAttr(fc.imageUrl)}" alt="${escHtml(fc.name)}">`
    : `<div class="cdet-familiar-portrait cdet-familiar-noart">${icon}</div>`;
  const fields = infoFieldsFor(fc.lineage)
    .filter(([k]) => fc[k] && fc[k] !== '—' && !String(fc[k]).includes('⚠️'))
    .slice(0, 4)
    .map(([k, lbl]) => `<div class="cdet-key">${escHtml(lbl)}</div><div class="cdet-val">${escHtml(fc[k])}</div>`)
    .join('');
  return `
    <div class="cdet-familiar-card">
      ${portrait}
      <div class="cdet-familiar-info">
        <div class="cdet-familiar-name">${escHtml(fc.name)}</div>
        <div class="cdet-badges">
          <span class="badge badge-${fc.lineage}">${LINEAGE_LABELS[fc.lineage] || fc.lineage}</span>
          ${stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : ''}
        </div>
        <div class="cdet-fields cdet-familiar-fields">${fields}</div>
        <button type="button" class="cdet-familiar-open-btn" data-open-familiar="${escHtml(fc.slug)}">Открыть карточку целиком</button>
      </div>
    </div>`;
}

// FIX-4b (docs/audit/2026-07-28-fix-plan.md): резолвим по slug, не по name —
// два персонажа с одинаковым именем (переименование сейчас блокируется FIX-4a,
// но в старых данных коллизия могла остаться) раньше всегда открывали ПЕРВОГО
// по порядку из STATE.characters, независимо от того, по какой карточке
// кликнули; второй персонаж был недостижим через интерфейс вообще.
function openCharDetail(slug) {
  const c = STATE.characters.find(ch => ch.slug === slug);
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

  // Вкладка «Фамильяр» (5.8) — признак и линк берутся из «Отношения» (тот же массив, что рендерит
  // вкладку «Отношения»), НЕ из sheet-модели: связь с description, матчащим /фамильяр/i, — источник
  // истины. resolveCharByName — общий фаззи-резолвер имени в реестре персонажей (archive.js).
  const familiarRel = (c.relationships || []).find(r => /фамильяр/i.test(r.description || ''));
  const familiarChar = familiarRel ? resolveCharByName(familiarRel.target) : null;
  // Если target связи-«фамильяра» по ошибке резолвится в самого владельца карточки
  // (опечатка/неверные данные) — это не осмысленная фича, а аномалия данных: без
  // этой проверки рисовалась бы мини-карточка «фамильяра», указывающая сама на
  // себя, с кнопкой «Открыть карточку целиком», просто перерисовывающей ту же модалку.
  const familiarPanelHtml = !familiarRel ? '' : !familiarChar
    ? `<div class="cdet-empty">Фамильяр «${escHtml(familiarRel.target)}» не найден в реестре персонажей. Заведите карточку с Принадлежностью «Фамильяр», чтобы она отобразилась здесь.</div>`
    : familiarChar.slug === c.slug
    ? `<div class="cdet-empty">Связь-фамильяр указывает на самого персонажа — проверьте описание связи в разделе «Отношения».</div>`
    : _familiarCardHtml(familiarChar);

  const portraitCol = c.imageUrl
    ? `<div class="cdet-carousel" id="cdet-carousel">
        <img class="cdet-carousel-img" id="cdet-carousel-img" src="${escAttr(c.imageUrl)}" alt="${escHtml(c.name)}">
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
        <button class="cdet-delete-btn" id="cdet-delete-btn" data-char="${escHtml(c.slug)}" title="Удалить персонажа">🗑</button>
      </div>
      <div class="cdet-tab-bar">
        <button class="cdet-tab active" data-tab="info">Информация</button>
        <button class="cdet-tab" data-tab="bio">Биография</button>
        <button class="cdet-tab" data-tab="rels">Отношения</button>
        <button class="cdet-tab" data-tab="diaries">Дневники${c.diaries?.length ? ` (${c.diaries.length})` : ''}</button>
        <button class="cdet-tab" data-tab="sheet" data-char="${escHtml(c.slug)}">Лист V20</button>
        <button class="cdet-tab" data-tab="desc">Описание</button>
        ${familiarRel ? `<button class="cdet-tab" data-tab="familiar">Фамильяр</button>` : ''}
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="info">
          ${c.presence ? `<div class="cdet-presence">🌍 <b>Присутствие:</b> ${escHtml(c.presence)}</div>` : ''}
          ${c.aliases ? `<div class="cdet-presence cdet-aliases">🎭 <b>Алиасы:</b> ${escHtml(c.aliases)}</div>` : ''}
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" id="cdet-edit-btn" data-char="${escHtml(c.slug)}">✏ Редактировать</button>
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
            <button class="cdet-edit-btn" data-editpanel="bio" data-char="${escHtml(c.slug)}">✏ Редактировать</button>
          </div>
          <div id="cdet-bio-view">
            ${c.biography && !c.biography.includes('⚠️')
              ? `<div class="cdet-bio">${escHtml(c.biography)}</div>`
              : '<div class="cdet-empty">Биография не заполнена</div>'}
          </div>
          <div id="cdet-bio-edit" style="display:none">
            <div class="cdet-info-header" style="margin-bottom:8px">
              <button class="cdet-gen-prompt-btn" id="cdet-gen-biography" data-char="${escHtml(c.slug)}" title="Сгенерировать биографию по вкладкам «Информация» и «Отношения»">📖 Сгенерировать биографию</button>
            </div>
            <textarea class="cdet-edit-textarea" id="cdet-bio-ta" rows="10" placeholder="Биография персонажа...">${c.biography && !c.biography.includes('⚠️') ? escHtml(c.biography) : ''}</textarea>
          </div>
          <div class="cdet-edit-bar" id="cdet-bio-bar">
            <button class="cdet-save-btn" data-savepanel="bio" data-char="${escHtml(c.slug)}">Сохранить</button>
            <button class="cdet-cancel-btn" data-cancelpanel="bio">Отмена</button>
            <span class="cdet-save-msg" id="cdet-bio-msg">✓ Сохранено</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="rels">
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" data-editpanel="rels" data-char="${escHtml(c.slug)}">✏ Редактировать</button>
          </div>
          <div id="cdet-rels-view">
            ${relsHtml ? `<div class="cdet-rels-list">${relsHtml}</div>` : '<div class="cdet-empty">Нет известных связей</div>'}
          </div>
          <div id="cdet-rels-edit" style="display:none">
            <div class="cdet-rels-hint">Имя — выбери из списка или впиши своё. Вид отношений — из списка или свой.</div>
            <div id="cdet-rels-rows">${(c.relationships||[]).map(r => _relRowHtml(r.target, r.description)).join('')}</div>
            <button class="cdet-rel-add-btn" id="cdet-rel-add-btn" type="button">+ Добавить связь</button>
            <datalist id="cdet-rel-names">${(STATE.characters||[]).filter(x => x.slug !== c.slug).map(x => `<option value="${escAttr(x.name)}">`).join('')}</datalist>
            <datalist id="cdet-rel-types">${REL_TYPE_OPTIONS.map(t => `<option value="${escAttr(t)}">`).join('')}</datalist>
          </div>
          <div class="cdet-edit-bar" id="cdet-rels-bar">
            <button class="cdet-save-btn" data-savepanel="rels" data-char="${escHtml(c.slug)}">Сохранить</button>
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
            <button class="cdet-gen-appearance-btn" id="cdet-gen-appearance" data-char="${escHtml(c.slug)}" title="Сгенерировать описание внешности по артам персонажа (Claude Vision)">👁 Внешность по арту</button>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-personality" data-char="${escHtml(c.slug)}" title="Сгенерировать характер и голос по внешности и биографии">🎭 Характер и голос</button>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-prompt" data-char="${escHtml(c.slug)}" title="Сгенерировать промт на основе внешности персонажа">🎨 Промт</button>
            <button class="cdet-edit-btn" data-editpanel="desc" data-char="${escHtml(c.slug)}">✏ Редактировать</button>
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
            <button class="cdet-save-btn" data-savepanel="desc" data-char="${escHtml(c.slug)}">Сохранить</button>
            <button class="cdet-cancel-btn" data-cancelpanel="desc">Отмена</button>
            <span class="cdet-save-msg" id="cdet-desc-msg">✓ Сохранено</span>
          </div>
          <div class="cdet-upload-row">
            <button class="cdet-upload-btn" data-char="${escHtml(c.slug)}">📷 Загрузить изображение</button>
          </div>
          <div class="cdet-divider"></div>
          <div class="cdet-dialogue">
            <div class="cdet-section-title">💬 Реплики НПС в сцене</div>
            <div class="cdet-dialogue-hint">Голос персонажа + клановый стиль (diary_rules.md). Опиши ситуацию — ИИ выдаст реплики в характере.</div>
            <textarea class="cdet-edit-textarea" id="cdet-dlg-situation" rows="2" placeholder="Ситуация: напр. «Князь требует объяснений на Элизиуме»"></textarea>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-dialogue" data-char="${escHtml(c.slug)}">💬 Сгенерировать реплики</button>
            <div id="cdet-dlg-result" class="cdet-dialogue-result" style="display:none"></div>
          </div>
        </div>
        ${familiarRel ? `<div class="cdet-panel" data-panel="familiar">${familiarPanelHtml}</div>` : ''}
      </div>
    </div>`;

  openModal('char-detail-modal');
  if (c.imageUrl) initCarousel(c.slug);
}

document.getElementById('chars-grid').addEventListener('click', e => {
  const card = e.target.closest('.char-card[data-slug]');
  if (!card) return;
  if (_foundryBulkMode) { _foundryBulkToggleCard(card.dataset.slug); return; }
  openCharDetail(card.dataset.slug);
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
  const openFamiliarBtn = e.target.closest('[data-open-familiar]');
  if (openFamiliarBtn) { openCharDetail(openFamiliarBtn.dataset.openFamiliar); return; }
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
    const c = STATE.characters.find(ch => ch.slug === diaryBack.dataset.char);
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

async function initCarousel(charSlug) {
  // Stop previous carousel
  if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
  _carouselImages = [];
  _carouselIdx = 0;

  const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/images${window.location.search}`)
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

// Stop carousel when the modal closes — FIX-8 (docs/audit/2026-07-28-fix-plan.md):
// this used to only fire on the explicit ✕ button, so closing via Escape or a
// backdrop click left the 60s auto-advance timer running against a hidden modal
// until the next character happened to be opened (initCarousel's own clearInterval
// guard). Watching the modal's own `open` class (closeModal()'s only visible
// signal, shared by every close path — ✕, backdrop click, Escape) covers all of
// them from one place instead of duplicating the stop call at each trigger site.
{
  const modalEl = document.getElementById('char-detail-modal');
  if (modalEl) {
    new MutationObserver(() => {
      if (!modalEl.classList.contains('open') && _carouselTimer) {
        clearInterval(_carouselTimer);
        _carouselTimer = null;
      }
    }).observe(modalEl, { attributes: true, attributeFilter: ['class'] });
  }
}

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
      const charSlug = document.querySelector('[data-editpanel="desc"][data-char]')?.dataset.char;
      if (charSlug) _loadDescImages(charSlug);
    } else if (panel === 'rels') {
      // Rebuild rows from the latest saved relationships (discard prior unsaved edits)
      const charSlug = document.querySelector('[data-editpanel="rels"][data-char]')?.dataset.char;
      const ch  = STATE.characters.find(c => c.slug === charSlug);
      const rows = document.getElementById('cdet-rels-rows');
      if (ch && rows) rows.innerHTML = (ch.relationships || []).map(r => _relRowHtml(r.target, r.description)).join('');
      rows?.querySelector('.cdet-rel-name-inp')?.focus();
    } else {
      edit.querySelector('textarea')?.focus();
    }
  }
}

async function _savePanelEdit(panel, charSlug) {
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
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { biography: bio } }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        const ch = STATE.characters.find(c => c.slug === charSlug);
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
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/relations${qs}`,
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
        const ch = STATE.characters.find(c => c.slug === charSlug);
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
      // FIX-3 (docs/audit/2026-07-28-fix-plan.md): send all five fields unconditionally,
      // even empty ones — omitting a falsy field here used to mean the server (which
      // treats "absent" as "leave untouched") never persisted the clear, so the panel
      // showed empty while the old value silently survived on disk until reload.
      const fields = { appearance, voice, personality, imagePrompt, negativePrompt };
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        const ch = STATE.characters.find(c => c.slug === charSlug);
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

async function _generateAppearance(charSlug) {
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
      `/api/characters/${encodeURIComponent(charSlug)}/generate-appearance${qs}`,
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
      `/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { appearance: d.appearance } }) }
    );
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast('Ошибка сохранения: ' + (saveData.error || ''), 'error'); return; }

    // 3. Обновляем STATE
    const ch = STATE.characters.find(c => c.slug === charSlug);
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

async function _loadDescImages(charSlug) {
  const gallery = document.getElementById('cdet-img-gallery');
  if (!gallery) return;
  gallery.innerHTML = '<div class="cdet-img-gallery-loading">Загрузка…</div>';

  const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/images${window.location.search}`).catch(() => null);
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
          <button class="cdet-img-del-btn" data-char="${escHtml(charSlug)}" data-file="${escHtml(filename)}" title="Удалить">✕</button>
        </div>`;
      }).join('')}
    </div>
    <div class="cdet-divider"></div>`;
}

async function _deleteCharImage(charSlug, filename) {
  if (!await showConfirm(`Удалить «${filename}»?\nДействие необратимо.`, { danger: true, confirmText: 'Удалить' })) return;

  const qs = window.location.search;
  try {
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(charSlug)}/images/${encodeURIComponent(filename)}${qs}`,
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
    if (_gridImages[charSlug]) {
      _gridImages[charSlug] = _gridImages[charSlug].filter(u => !u.includes(encodedFile) && !u.includes(filename));
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

let _genPromptRunning = false;

// Generate in-character NPC dialogue lines (Voice + clan style)
async function _genDialogue(charSlug) {
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
    const d = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/dialogue${qs}`,
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

async function _generatePrompt(charSlug) {
  if (_genPromptRunning) return;

  const c = STATE.characters.find(ch => ch.slug === charSlug);
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

    const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/generate-prompt${qs}`, {
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

    const saveResp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`, {
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

async function _generatePersonality(charSlug) {
  if (_genPersonalityRunning) return;

  const c = STATE.characters.find(ch => ch.slug === charSlug);
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

    const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/generate-personality${qs}`, {
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
    const saveResp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`, {
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

async function _generateBiography(charSlug) {
  if (_genBiographyRunning) return;

  const c = STATE.characters.find(ch => ch.slug === charSlug);
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

    const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/generate-biography${qs}`, {
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

    const saveResp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`, {
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
// _editCharSlug — стабильная идентичность редактируемого персонажа (slug не
// меняется при переименовании, в отличие от имени — FIX-4b,
// docs/audit/2026-07-28-fix-plan.md). _editOrigName нужен только чтобы
// восстановить отображаемое имя в шапке при отмене, к идентичности отношения
// не имеет.
let _editCharSlug   = null;
let _editOrigName   = null;
let _editOrigValues = {};
let _genAppearanceRunning = false;

function _enterInfoEdit(charSlug) {
  _editCharSlug = charSlug;
  _editOrigName = STATE.characters.find(c => c.slug === charSlug)?.name || '';
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
    nameInput.value = _editOrigName;
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
    } else if (key === 'clan') {
      // A3 (2026-08-07): автодополнение из библиотеки — только <datalist>, без чип-пикера
      // (решение пользователя §0.2 техспеки char-loc-city-fields). Ручной ввод не блокируется.
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = 'Неизвестно';
      input.setAttribute('list', 'cdet-clans-list');
      input.setAttribute('autocomplete', 'off');
    } else if (key === 'sect' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
      // Секта — пикер (2026-08-08), только для mortal/hunter. Одиночный выбор (Часть III
      // §3.1 анализа) — тот же паттерн, что «Титул» (не «Дисциплины» — секта одна). Для
      // ВАМПИРА эта ветка не срабатывает (гейт по линейке) — sect остаётся обычным текстом,
      // веткой ниже.
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = 'Неизвестно';
      inp.setAttribute('autocomplete', 'off');
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickSect = '1';
      pickBtn.title = 'Выбрать секту из библиотеки';
      pickBtn.setAttribute('aria-label', 'Выбрать секту из библиотеки');
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-sect-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-sect-search">
          <div class="v20-lib-list" id="cdet-sect-list"></div>
        </div>`);
      input = outer;
    } else if (key === 'sect') {
      // A3 (2026-08-07): автодополнение из библиотеки — только <datalist>, без чип-пикера
      // (решение пользователя §0.2 техспеки char-loc-city-fields). Ручной ввод не блокируется.
      // Вампир (и остальные линейки generic-набора, «Фракция») — без изменений.
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = 'Неизвестно';
      input.setAttribute('list', 'cdet-sects-list');
      input.setAttribute('autocomplete', 'off');
    } else if (key === 'sectRole' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
      // Роль в секте — обычное поле, без пикера (свободный текст, источник не указан
      // пользователем). Условная видимость — см. _cdetInitConditionalRows/делегат ниже.
      // Плейсхолдер с примером (дизайн-ревью 2026-08-08 п.2) — единственное из четырёх новых
      // полей без библиотечного пикера, пользователю не за что зацепиться без подсказки.
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = 'Осведомитель, союзник, наёмный сторож…';
      input.setAttribute('autocomplete', 'off');
    } else if (key === 'organization' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
      // Организация — пикер с группировкой по 3 категориям библиотеки «Смертные» (БЕЗ
      // «Правительственных служб» — та зарезервирована для «Государственные фракции» города,
      // Часть III §3.3 анализа). Все три группы всегда видимы — нет «приоритетной».
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = 'Неизвестно';
      inp.setAttribute('autocomplete', 'off');
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickOrganization = '1';
      pickBtn.title = 'Выбрать организацию из библиотеки';
      pickBtn.setAttribute('aria-label', 'Выбрать организацию из библиотеки');
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      const groups = [['religious', 'Религиозные организации'], ['crime', 'Криминал'], ['civic', 'Гражданские организации']];
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-organization-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-organization-search">
          ${groups.map(([g, label]) => `
            <div class="cdet-lib-picker-group" data-group="${g}">
              <div class="cdet-lib-picker-group-label">${label}</div>
              <div class="v20-lib-list" id="cdet-organization-list-${g}"></div>
            </div>`).join('')}
        </div>`);
      input = outer;
    } else if (key === 'position' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
      // Должность — пикер по образцу «Титула», условная видимость от «Организации».
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = 'Неизвестно';
      inp.setAttribute('autocomplete', 'off');
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickPosition = '1';
      pickBtn.title = 'Выбрать должность из библиотеки';
      pickBtn.setAttribute('aria-label', 'Выбрать должность из библиотеки');
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-position-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-position-search">
          <div class="v20-lib-list" id="cdet-position-list"></div>
        </div>`);
      input = outer;
    } else if (key === 'disciplines') {
      // Пикер (2026-08-08) добавляется РЯДОМ с datalist, не вместо.
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = 'Неизвестно';
      inp.setAttribute('list', 'cdet-disciplines-list');
      inp.setAttribute('autocomplete', 'off');
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickDiscipline = '1';
      pickBtn.title = 'Выбрать дисциплины из библиотеки';
      pickBtn.setAttribute('aria-label', 'Выбрать дисциплины из библиотеки');
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-discipline-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-discipline-search">
          <div class="cdet-lib-picker-group" data-group="priority">
            <div class="cdet-lib-picker-group-label">Клановые</div>
            <div class="v20-lib-list" id="cdet-discipline-list-priority"></div>
          </div>
          <div class="cdet-lib-picker-group" data-group="all">
            <div class="cdet-lib-picker-group-label">Все дисциплины</div>
            <div class="v20-lib-list" id="cdet-discipline-list-all"></div>
          </div>
        </div>`);
      input = outer;
    } else if (key === 'hierarchy' && _lineageOf(_editCharSlug) !== 'fairy') {
      // A2.8 (2026-08-07): пикер «из библиотеки Титулов» — только не-феи (у фей «Иерархия»
      // осталась отдельным полем, не «Титул», решение пользователя §0.1 техспеки). Ручной
      // ввод не блокируется — кнопка лишь подставляет значение в то же поле.
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = 'Неизвестно';
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickTitle = '1';
      pickBtn.title = 'Выбрать титул из библиотеки';
      pickBtn.setAttribute('aria-label', 'Выбрать титул из библиотеки');
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-title-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-title-search">
          <div class="cdet-lib-picker-group" data-group="priority">
            <div class="cdet-lib-picker-group-label">По вашей секте/клану</div>
            <div class="v20-lib-list" id="cdet-title-list-priority"></div>
          </div>
          <div class="cdet-lib-picker-group" data-group="all">
            <div class="cdet-lib-picker-group-label">Все титулы</div>
            <div class="v20-lib-list" id="cdet-title-list-all"></div>
          </div>
        </div>`);
      input = outer;
    } else {
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = 'Неизвестно';
    }
    cell.replaceWith(input);
  });

  _ensureCdetLibDatalists();
  _cdetInitConditionalRows();

  btn.classList.add('active');
  btn.textContent = '✏ Режим редактирования';
  bar.classList.add('show');

  // Focus name input
  document.getElementById('cdet-name-input')?.focus();
}

// A3 (2026-08-07): три <datalist> для автодополнения Клан/Секта/Дисциплины во вкладке
// «Информация» — заполняются один раз при входе в режим редактирования (не на каждое
// открытие карточки), библиотеки кешируются самими ensureClans/ensureSects/ensureDisciplines
// (v20-sheet.js) — общий кеш с V20-листом, повторный вызов не бьёт по сети.
async function _ensureCdetLibDatalists() {
  if (!document.getElementById('cdet-clans-list')) {
    const dl = document.createElement('datalist'); dl.id = 'cdet-clans-list';
    document.body.appendChild(dl);
  }
  if (!document.getElementById('cdet-sects-list')) {
    const dl = document.createElement('datalist'); dl.id = 'cdet-sects-list';
    document.body.appendChild(dl);
  }
  if (!document.getElementById('cdet-disciplines-list')) {
    const dl = document.createElement('datalist'); dl.id = 'cdet-disciplines-list';
    document.body.appendChild(dl);
  }
  await Promise.all([ensureClans(), ensureSects(), ensureDisciplines()]);
  const clansEl = document.getElementById('cdet-clans-list');
  const sectsEl = document.getElementById('cdet-sects-list');
  if (clansEl) clansEl.innerHTML = (_clansCache || []).map(c => `<option value="${escAttr(c.name)}">`).join('');
  if (sectsEl) sectsEl.innerHTML = (_sectsCache || []).map(s => `<option value="${escAttr(s.name)}">`).join('');
  const discInput = document.querySelector('.cdet-field-input[data-field="disciplines"]');
  const clanInput = document.querySelector('.cdet-field-input[data-field="clan"]');
  _refreshCdetDisciplinesDatalist(discInput?.value || '', clanInput?.value.trim() || '');
}

// Нативный <datalist> фильтрует по совпадению ВСЕГО значения инпута, не последнего токена
// после запятой — без этой пересборки подсказки для второй дисциплины переставали бы
// появляться, как только в поле уже есть текст. Подставляем в <option value> уже набранный
// текст (до последней запятой) + предлагаемое имя, чтобы браузер продолжал матчить полное
// значение, а подстановка добавляла дисциплину к списку, а не заменяла его.
// Библиотека хранит «Русское (English)» (d.name), v20ClanInfo(clan).disciplines — голое
// русское имя без скобки — сравнение напрямую никогда не совпадает. Один хелпер,
// используется и старым datalist (фикс регресса клановой сортировки), и пикером дисциплин.
function _disciplineBareName(fullName) {
  return String(fullName || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}
function _cdetDisciplinesDatalistOptions(currentValue, clanName) {
  const prefix = currentValue.replace(/[^,]*$/, '').replace(/,\s*$/, '');
  const already = new Set(currentValue.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  const info = clanName ? v20ClanInfo(clanName) : null;
  const clanDiscs = new Set((info?.disciplines || []).map(d => d.toLowerCase()));
  const names = (_disciplinesCache || []).map(d => d.name)
    .filter(n => !already.has(n.toLowerCase()))
    .sort((a, b) => (clanDiscs.has(_disciplineBareName(b).toLowerCase()) ? 1 : 0) - (clanDiscs.has(_disciplineBareName(a).toLowerCase()) ? 1 : 0) || a.localeCompare(b, 'ru'));
  return names.map(n => `<option value="${escAttr((prefix ? prefix + ', ' : '') + n)}">`).join('');
}
function _refreshCdetDisciplinesDatalist(currentValue, clanName) {
  const dl = document.getElementById('cdet-disciplines-list');
  if (dl) dl.innerHTML = _cdetDisciplinesDatalistOptions(currentValue, clanName);
}
// Пересборка при вводе в «Дисциплины» (следующий токен) И при смене «Клан» (клановые —
// первыми, п.3 анализа) — оба поля видны одновременно только на вкладке «Информация»
// персонажа-вампира в режиме редактирования, делегат безопасен и для остальных линеек
// (просто не находит .cdet-field-input[data-field="disciplines"] и выходит).
document.addEventListener('input', e => {
  const discInput = e.target.matches('.cdet-field-input[data-field="disciplines"]')
    ? e.target : (e.target.matches('.cdet-field-input[data-field="clan"]')
      ? document.querySelector('.cdet-field-input[data-field="disciplines"]') : null);
  if (!discInput) return;
  const clanVal = document.querySelector('.cdet-field-input[data-field="clan"]')?.value.trim() || '';
  _refreshCdetDisciplinesDatalist(discInput.value, clanVal);
  // Пикер дисциплин (2026-08-08) — если панель открыта, держим её в синхроне с тем же
  // событием (смена «Клан» → перегруппировка «Клановые», правка «Дисциплины» руками → ✓-метки).
  const discPicker = document.getElementById('cdet-discipline-picker');
  if (discPicker && !discPicker.hidden) _renderDisciplinePickerLists(document.getElementById('cdet-discipline-search')?.value || '');
});

// Дисциплины (2026-08-08) — токенизация текущего значения поля, эвристика сопоставления
// токена с записью библиотеки (легаси-карточки хранят голое английское имя, библиотека —
// «Русское (English)» — сравнение по подстроке в обе стороны + по обеим частям).
function _cdetDisciplineTokens(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}
function _disciplineTokenMatches(token, d) {
  const t = token.toLowerCase();
  if (!t) return false;
  const full = d.name.toLowerCase();
  const en = (d.name.match(/\(([^)]+)\)/)?.[1] || '').toLowerCase();
  const ru = _disciplineBareName(d.name).toLowerCase();
  return t.includes(full) || (en && t.includes(en)) || (ru && t.includes(ru));
}
function _disciplineAlreadyIn(value, d) {
  return _cdetDisciplineTokens(value).some(tok => _disciplineTokenMatches(tok, d));
}
function _disciplineItemHtml(d, selected) {
  const hint = escHtml(_libCleanClans(d.clans));
  return `<button type="button" class="v20-lib-item${selected ? ' cdet-lib-item-selected' : ''}" data-cdet-discipline="${escAttr(d.name)}"><span>${selected ? '✓ ' : ''}${escHtml(d.name)}</span><span class="v20-lib-hint">${hint}</span></button>`;
}
async function _renderDisciplinePickerLists(query) {
  await ensureDisciplines();
  const all = _disciplinesCache || [];
  const clanInput = document.querySelector('.cdet-field-input[data-field="clan"]');
  const discInput = document.querySelector('.cdet-field-input[data-field="disciplines"]');
  const clan = clanInput?.value.trim() || '';
  const currentValue = discInput?.value || '';
  const info = clan ? v20ClanInfo(clan) : null;
  const clanDiscs = new Set((info?.disciplines || []).map(n => n.toLowerCase()));
  const q = (query || '').toLowerCase();
  const matchesQuery = d => !q || d.name.toLowerCase().includes(q);
  const isClanDisc = d => clanDiscs.has(_disciplineBareName(d.name).toLowerCase());

  const priority = all.filter(d => matchesQuery(d) && isClanDisc(d));
  const prioritySlugs = new Set(priority.map(d => d.slug));
  const rest = all.filter(d => matchesQuery(d) && !prioritySlugs.has(d.slug));

  const priorityGroup = document.querySelector('#cdet-discipline-picker .cdet-lib-picker-group[data-group="priority"]');
  const priorityList  = document.getElementById('cdet-discipline-list-priority');
  const allList       = document.getElementById('cdet-discipline-list-all');
  if (priorityGroup) priorityGroup.style.display = priority.length ? '' : 'none';
  if (priorityList) priorityList.innerHTML = priority.map(d => _disciplineItemHtml(d, _disciplineAlreadyIn(currentValue, d))).join('');
  if (allList) {
    allList.innerHTML = rest.length ? rest.map(d => _disciplineItemHtml(d, _disciplineAlreadyIn(currentValue, d))).join('')
      : (all.length
          ? '<div class="cdet-empty">Ничего не найдено — можно ввести название вручную.</div>'
          : '<div class="cdet-empty">Библиотека дисциплин пуста — можно ввести название вручную.</div>');
  }
}

// ── Секта / Роль в секте / Организация / Должность (2026-08-08, mortal/hunter) ──────────────

// Условная видимость — CSS-класс на строке .cdet-key+сосед, не вставка/удаление DOM (строка
// всегда в DOM, как любое другое поле; тот же generic-паттерн, что уже прячет пустые поля в
// просмотре, cdet-opt-empty). Точка входа — конец _enterInfoEdit (см. _cdetInitConditionalRows).
function _cdetSyncConditionalRow(triggerKey, targetKey) {
  const trigger = document.querySelector(`.cdet-field-input[data-field="${triggerKey}"]`);
  const targetInput = document.querySelector(`.cdet-field-input[data-field="${targetKey}"]`);
  if (!trigger || !targetInput) return;
  // targetInput может быть внутри top-level wrapper'а (organization/position —
  // .cdet-field-with-pick+панель) — скрываем сам wrapper (ближайший предок-прямой сиблинг
  // .cdet-key), не сам инпут. Контейнер полей — #cdet-info-fields (см. _enterInfoEdit).
  let row = targetInput;
  while (row.parentElement && row.parentElement.id !== 'cdet-info-fields') row = row.parentElement;
  const key = row.previousElementSibling;
  const hasValue = !!trigger.value.trim();
  row.classList.toggle('cdet-cond-hidden', !hasValue);
  if (key) key.classList.toggle('cdet-cond-hidden', !hasValue);
}
function _cdetInitConditionalRows() {
  _cdetSyncConditionalRow('sect', 'sectRole');
  _cdetSyncConditionalRow('organization', 'position');
}
document.addEventListener('input', e => {
  if (e.target.matches('.cdet-field-input[data-field="sect"]')) _cdetSyncConditionalRow('sect', 'sectRole');
  if (e.target.matches('.cdet-field-input[data-field="organization"]')) _cdetSyncConditionalRow('organization', 'position');
});

// Одиночный выбор (не toggle-мультивыбор, как у Дисциплин) — клик записывает значение,
// закрывает панель, фокус в поле. Без ✓-пометки «уже выбрано» — элемент не может быть
// «частично выбран», в отличие от списка Дисциплин.
function _sectItemHtml(s) {
  return `<button type="button" class="v20-lib-item" data-name="${escAttr(s.name)}"><span>${escHtml(s.name)}</span></button>`;
}
async function _renderSectPickerList(query) {
  await ensureSects();
  const q = (query || '').toLowerCase();
  const list = (_sectsCache || []).filter(s => !q || s.name.toLowerCase().includes(q));
  const box = document.getElementById('cdet-sect-list');
  if (box) box.innerHTML = list.length ? list.map(_sectItemHtml).join('')
    : '<div class="cdet-empty">Ничего не найдено — можно ввести название вручную.</div>';
}

async function _renderOrganizationPickerList(query) {
  const groups = ['religious', 'crime', 'civic'];
  await Promise.all(groups.map(ensureMortLib));
  const q = (query || '').toLowerCase();
  for (const g of groups) {
    const full = _mortLibCache.get(g) || [];
    const list = full.filter(r => !q || r.name.toLowerCase().includes(q));
    // Пустая группа (не по фильтру поиска, а вообще — категория без записей) скрывается
    // целиком (дизайн-ревью п.4) — иначе «Ничего не найдено» висело бы постоянно.
    const groupEl = document.querySelector(`#cdet-organization-picker .cdet-lib-picker-group[data-group="${g}"]`);
    if (groupEl) groupEl.style.display = full.length ? '' : 'none';
    const listEl = document.getElementById(`cdet-organization-list-${g}`);
    if (listEl) listEl.innerHTML = list.length ? list.map(r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`).join('')
      : '<div class="cdet-empty">Ничего не найдено.</div>';
  }
}

async function _renderPositionPickerList(query) {
  await ensureMortLib('positions');
  const q = (query || '').toLowerCase();
  const list = (_mortLibCache.get('positions') || []).filter(r => !q || r.name.toLowerCase().includes(q));
  const box = document.getElementById('cdet-position-list');
  if (box) box.innerHTML = list.length ? list.map(r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`).join('')
    : '<div class="cdet-empty">Ничего не найдено — можно ввести название вручную.</div>';
}

// A2.8 (2026-08-07): пикер «из библиотеки Титулов» для вкладки «Информация» — раскрывающаяся
// встроенная панель (не модалка поверх модалки, design.md §1.2), переиспользует классы
// .v20-lib-picker/.v20-lib-list/.v20-lib-item/.v20-lib-hint из V20-листа, но со своей
// логикой открытия/поиска/выбора (тот файл завязан на #cdet-sheet-panel, другой контекст).
function _titleAffMatches(aff, needle) {
  return !!needle && String(aff || '').toLowerCase().includes(String(needle).toLowerCase());
}
// Мульти-выбор (2026-08-08, Часть 8) — по образцу «Дисциплин»: значение поля «Титул» —
// CSV-список, токенизация переиспользует _cdetDisciplineTokens (функция обобщённая, несмотря
// на название — тот же паттерн переиспользования, что уже применён к _disciplineBareName).
// У титулов имя в библиотеке уже голое русское (без «(English)»), сопоставление — точное
// совпадение без эвристик, в отличие от дисциплин.
function _titleAlreadyIn(value, t) {
  const needle = t.name.trim().toLowerCase();
  return _cdetDisciplineTokens(value).some(tok => tok.trim().toLowerCase() === needle);
}
function _titleItemHtml(t, selected) {
  const hint = escHtml(t.affiliation || '');
  const label = (t.negative ? '⚠️ ' : '') + t.name;
  return `<button type="button" class="v20-lib-item${selected ? ' cdet-lib-item-selected' : ''}" aria-pressed="${selected ? 'true' : 'false'}" data-cdet-title="${escAttr(t.name)}"><span>${selected ? '✓ ' : ''}${escHtml(label)}</span><span class="v20-lib-hint">${hint}</span></button>`;
}
async function _renderTitlePickerLists(query) {
  await ensureTitles();
  const all = _titlesCache || [];
  const sectInput = document.querySelector('.cdet-field-input[data-field="sect"]');
  const clanInput = document.querySelector('.cdet-field-input[data-field="clan"]');
  const titleInput = document.querySelector('.cdet-field-input[data-field="hierarchy"]');
  const sect = sectInput?.value.trim() || '';
  const clan = clanInput?.value.trim() || '';
  const currentValue = titleInput?.value || '';
  const q = (query || '').toLowerCase();
  const matchesQuery = t => !q || t.name.toLowerCase().includes(q);
  const priority = all.filter(t => matchesQuery(t) && (_titleAffMatches(t.affiliation, sect) || _titleAffMatches(t.affiliation, clan)));
  const prioritySlugs = new Set(priority.map(t => t.slug));
  const rest = all.filter(t => matchesQuery(t) && !prioritySlugs.has(t.slug));

  const priorityGroup = document.querySelector('#cdet-title-picker .cdet-lib-picker-group[data-group="priority"]');
  const priorityList  = document.getElementById('cdet-title-list-priority');
  const allList       = document.getElementById('cdet-title-list-all');
  if (priorityGroup) priorityGroup.style.display = priority.length ? '' : 'none';
  if (priorityList) priorityList.innerHTML = priority.map(t => _titleItemHtml(t, _titleAlreadyIn(currentValue, t))).join('');
  if (allList) {
    allList.innerHTML = rest.length ? rest.map(t => _titleItemHtml(t, _titleAlreadyIn(currentValue, t))).join('')
      : (all.length
          ? '<div class="cdet-empty">Ничего не найдено — можно ввести название вручную.</div>'
          : '<div class="cdet-empty">Библиотека титулов пуста — можно ввести название вручную.</div>');
  }
}
// Ручная правка поля «Титул» держит ✓-пометки в синхроне (зеркало делегата «Дисциплин»,
// строки выше) — проще: без производного datalist, только перерисовка панели, если открыта.
document.addEventListener('input', e => {
  if (!e.target.matches('.cdet-field-input[data-field="hierarchy"]')) return;
  const titlePicker = document.getElementById('cdet-title-picker');
  if (titlePicker && !titlePicker.hidden) _renderTitlePickerLists(document.getElementById('cdet-title-search')?.value || '');
});
document.addEventListener('click', async e => {
  const pickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-title]');
  if (pickBtn) {
    const picker = document.getElementById('cdet-title-picker');
    if (!picker) return;
    if (picker.hidden) {
      picker.hidden = false;
      await _renderTitlePickerLists('');
    } else {
      picker.hidden = true;
    }
    return;
  }
  const item = e.target.closest('#cdet-title-picker .v20-lib-item');
  if (item) {
    // Toggle add/remove (2026-08-08, Часть 8) — зеркало блока discItem ниже: панель НЕ
    // закрывается (можно добавить несколько подряд), значение — CSV-список.
    const titleInput = document.querySelector('.cdet-field-input[data-field="hierarchy"]');
    const name = item.dataset.cdetTitle || '';
    if (titleInput && name) {
      const tokens = _cdetDisciplineTokens(titleInput.value);
      const idx = tokens.findIndex(tok => tok.trim().toLowerCase() === name.trim().toLowerCase());
      if (idx !== -1) tokens.splice(idx, 1); else tokens.push(name);
      titleInput.value = tokens.join(', ');
    }
    await _renderTitlePickerLists(document.getElementById('cdet-title-search')?.value || '');
    return;
  }
  const discPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-discipline]');
  if (discPickBtn) {
    const picker = document.getElementById('cdet-discipline-picker');
    if (!picker) return;
    if (picker.hidden) {
      picker.hidden = false;
      await _renderDisciplinePickerLists('');
    } else {
      picker.hidden = true;
    }
    return;
  }
  const discItem = e.target.closest('#cdet-discipline-picker .v20-lib-item');
  if (discItem) {
    const discInput = document.querySelector('.cdet-field-input[data-field="disciplines"]');
    const name = discItem.dataset.cdetDiscipline || '';
    const d = (_disciplinesCache || []).find(x => x.name === name);
    if (discInput && d) {
      const tokens = _cdetDisciplineTokens(discInput.value);
      const stillMatching = tok => _disciplineTokenMatches(tok, d);
      if (tokens.some(stillMatching)) {
        // toggle-удаление — убираем ВСЕ совпавшие токены целиком, вместе с любым хвостовым
        // комментарием в той же запятой-ячейке (не хирургическая правка текста).
        discInput.value = tokens.filter(tok => !stillMatching(tok)).join(', ');
      } else {
        tokens.push(d.name);
        discInput.value = tokens.join(', ');
      }
      // Держит datalist в синхроне с новым значением — тот же input-делегат сработает сам.
      discInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Панель НЕ закрывается (можно добавить несколько подряд) — перерисовываем с текущим
    // поисковым запросом, чтобы ✓-пометки обновились.
    await _renderDisciplinePickerLists(document.getElementById('cdet-discipline-search')?.value || '');
    return;
  }

  const sectPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-sect]');
  if (sectPickBtn) {
    const picker = document.getElementById('cdet-sect-picker');
    if (picker.hidden) { picker.hidden = false; await _renderSectPickerList(''); } else { picker.hidden = true; }
    return;
  }
  const sectItem = e.target.closest('#cdet-sect-picker .v20-lib-item');
  if (sectItem) {
    const sectInput = document.querySelector('.cdet-field-input[data-field="sect"]');
    if (sectInput) {
      sectInput.value = sectItem.dataset.name || '';
      sectInput.dispatchEvent(new Event('input', { bubbles: true })); // держит «Роль в секте» в синхроне
    }
    document.getElementById('cdet-sect-picker').hidden = true;
    sectInput?.focus();
    return;
  }

  const orgPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-organization]');
  if (orgPickBtn) {
    const picker = document.getElementById('cdet-organization-picker');
    if (picker.hidden) { picker.hidden = false; await _renderOrganizationPickerList(''); } else { picker.hidden = true; }
    return;
  }
  const orgItem = e.target.closest('#cdet-organization-picker .v20-lib-item');
  if (orgItem) {
    const orgInput = document.querySelector('.cdet-field-input[data-field="organization"]');
    if (orgInput) {
      orgInput.value = orgItem.dataset.name || '';
      orgInput.dispatchEvent(new Event('input', { bubbles: true })); // держит «Должность» в синхроне
    }
    document.getElementById('cdet-organization-picker').hidden = true;
    orgInput?.focus();
    return;
  }

  const posPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-position]');
  if (posPickBtn) {
    const picker = document.getElementById('cdet-position-picker');
    if (picker.hidden) { picker.hidden = false; await _renderPositionPickerList(''); } else { picker.hidden = true; }
    return;
  }
  const posItem = e.target.closest('#cdet-position-picker .v20-lib-item');
  if (posItem) {
    const posInput = document.querySelector('.cdet-field-input[data-field="position"]');
    if (posInput) posInput.value = posItem.dataset.name || '';
    document.getElementById('cdet-position-picker').hidden = true;
    posInput?.focus();
    return;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'cdet-title-search') _renderTitlePickerLists(e.target.value);
  if (e.target.id === 'cdet-discipline-search') _renderDisciplinePickerLists(e.target.value);
  if (e.target.id === 'cdet-sect-search') _renderSectPickerList(e.target.value);
  if (e.target.id === 'cdet-organization-search') _renderOrganizationPickerList(e.target.value);
  if (e.target.id === 'cdet-position-search') _renderPositionPickerList(e.target.value);
});

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
  const _lineage   = _lineageOf(_editCharSlug);
  const _reqFields = requiredInfoFor(_lineage);
  const _fieldSet  = infoFieldsFor(_lineage);
  // «.cdet-key + *» — не «.cdet-field-input» напрямую: поле «Титул» (A2.8) заменяет
  // .cdet-val не голым <input>, а обёрткой (input + кнопка пикера + сама панель пикера) —
  // топ-уровневый элемент, реально стоящий рядом с .cdet-key, нужно заменить целиком,
  // иначе панель пикера осиротеет в DOM вместо чистого восстановления .cdet-val.
  grid.querySelectorAll('.cdet-key + *').forEach(topEl => {
    const input = topEl.matches('.cdet-field-input') ? topEl : topEl.querySelector('.cdet-field-input');
    if (!input) return;
    const key      = input.dataset.field;
    const value    = saved ? input.value.trim() : (_editOrigValues[key] || '');
    const empty    = !value;
    const required = _reqFields.has(key);
    const hide     = empty && !required;
    const div = document.createElement('div');
    div.className = 'cdet-val' + (empty ? ' unknown' : '') + (hide ? ' cdet-opt-empty' : '');
    div.dataset.field = key;
    div.textContent   = empty ? 'Неизвестно' : value;
    // sync the preceding label cell (hide class + required «!» флаг)
    const keyCell = topEl.previousElementSibling;
    if (keyCell && keyCell.classList.contains('cdet-key')) {
      const lbl = (_fieldSet.find(([fk]) => fk === key) || [null, key])[1];
      keyCell.innerHTML = (empty && required)
        ? `${lbl} <span class="cdet-req-flag" title="Обязательное поле">!</span>` : lbl;
      keyCell.classList.toggle('cdet-opt-empty', hide);
    }
    topEl.replaceWith(div);
  });
  grid.classList.remove('editing');

  btn.classList.remove('active');
  btn.textContent = '✏ Редактировать';
  bar.classList.remove('show');
  _editCharSlug = null;
  _editOrigName = null;
}

async function _saveInfoFields() {
  const grid    = document.getElementById('cdet-info-fields');
  const saveBtn = document.getElementById('cdet-save-btn');
  const msg     = document.getElementById('cdet-save-msg');
  if (!grid || !_editCharSlug) return;

  const slug = _editCharSlug;
  const fields = {};

  // Collect name from header input if changed
  const nameInput = document.getElementById('cdet-name-input');
  const newName = nameInput?.value.trim();
  if (newName && newName !== _editOrigName) fields.name = newName;

  grid.querySelectorAll('.cdet-field-input').forEach(inp => {
    const key = inp.dataset.field;
    const v = inp.value.trim();
    // Пустое значение раньше просто не попадало в payload — если поле УЖЕ было
    // непустым и пользователь его очистил, очистка тихо не сохранялась (найдено
    // тестировщиком 2026-08-08: стёртая «Роль в секте» не пропадала из файла, а
    // пряталась из виду условной видимостью Части 5 и всплывала обратно при
    // повторном заполнении «Секта»). Шлём пустое значение, только если поле
    // РЕАЛЬНО было непустым при входе в правку (значит очистка осознанная) —
    // не шлём пустые значения полей, которые и так всегда были пустыми, иначе
    // каждое сохранение захламляло бы карточку пустыми строками для всех
    // никогда не заполнявшихся полей.
    if (v) fields[key] = v;
    else if (_editOrigValues[key]) fields[key] = '';
  });

  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ Сохранение...';

  try {
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(slug)}/fields${window.location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }) }
    );
    const d = await resp.json();
    if (d.ok) {
      // Update STATE cache
      const ch = STATE.characters.find(c => c.slug === slug);
      if (ch) Object.assign(ch, fields);

      // Sync grid card display text when name changed — slug (the identity
      // key on the card and every data-char in this modal) never changes on
      // rename, so unlike before nothing else needs re-keying here.
      if (fields.name) {
        const gridCard = document.querySelector(`.char-card[data-slug="${CSS.escape(slug)}"]`);
        const gridNameEl = gridCard?.querySelector('.char-name');
        if (gridNameEl) gridNameEl.textContent = fields.name;
        _editOrigName = fields.name;
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

async function triggerImageUpload(charSlug) {
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
      const resp   = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, ext })
      });
      const result = await resp.json();
      if (result.success) {
        const newUrl = result.url + '?t=' + Date.now();
        // Patch the character in STATE so the card and modal re-open correctly
        const charInState = STATE.characters.find(ch => ch.slug === charSlug);
        if (charInState) charInState.imageUrl = newUrl;
        // Update portrait in modal immediately
        const col = document.getElementById('cdet-portrait-col');
        if (col) col.innerHTML = `<div class="cdet-carousel" id="cdet-carousel">
          <img class="cdet-carousel-img" id="cdet-carousel-img" src="${escAttr(newUrl)}" alt="${escHtml(charInState?.name || '')}">
          <div class="cdet-carousel-overlay" id="cdet-carousel-overlay"></div>
          <button class="cdet-carousel-btn prev" id="cdet-carousel-prev" title="Предыдущее">&#8249;</button>
          <button class="cdet-carousel-btn next" id="cdet-carousel-next" title="Следующее">&#8250;</button>
          <div class="cdet-carousel-dots" id="cdet-carousel-dots"></div>
         </div>`;
        initCarousel(charSlug);
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
