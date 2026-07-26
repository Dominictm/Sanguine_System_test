'use strict';
// Экран сессии (режим живой игры): сценарий активного модуля по сценам,
// быстрые НПС, аудио-пресеты, заметки с передачей в запись сессии.
// Только композиция существующих API/глобалей (openCharDetail,
// loadAudioLibrary, _audioPresetPlay/_audioPresetStop, navigate).

let _sessDetail    = null;   // ответ /detail выбранного модуля
let _sessBlocks    = [];     // [{heading, body}] — сценарий по ##-блокам
let _sessScene     = 0;      // индекс развёрнутого блока
let _sessPresets   = null;   // кэш GET /api/audio/presets
let _sessCurrentMod = null;  // slug выбранного модуля (карточки #sess-mod-cards
                              // заменили <select id="sess-mod-sel"> — источник
                              // «модуль выбран» для _sessSyncSceneNavVisibility)

// Заметка сцены (3.5-FE): кэш всех заметок сцен ТЕКУЩЕГО модуля,
// { [heading]: text } — грузится один раз в _sessLoadModule (GET scene-notes)
// и обновляется локально при успешном PUT scene-note (не перезапрашивается
// целиком после каждого сохранения). Ключ — heading КАК ЕСТЬ (с эмодзи, если
// он есть в заголовке сцены) — без нормализации, так же, как хранит его бэкенд.
let _sessSceneNotesCache   = {};
let _sessSceneNoteLoaded   = ''; // «загруженное» значение для активной сцены (dirty-сравнение)
// Заметки сессии (3.6-FE): файл модуля вместо localStorage — «загруженное»
// значение для dirty-сравнения кнопки «Сохранить» (не сам текст — тот живёт
// только в DOM/на сервере).
let _sessSessionNotesLoaded = '';

function _sessCity() {
  return new URLSearchParams(window.location.search).get('city') || 'paris';
}
function _sessStoreKey() { return 'sanguine.session.' + _sessCity(); }
function _sessStore() {
  try { return JSON.parse(localStorage.getItem(_sessStoreKey())) || {}; } catch { return {}; }
}
function _sessSave(patch) {
  try { localStorage.setItem(_sessStoreKey(), JSON.stringify({ ..._sessStore(), ...patch })); } catch {}
}

async function loadSessionScreen() {
  const chrSel = document.getElementById('sess-chr-sel');
  const saved  = _sessStore();
  // include_hidden=1: скрытые хроники тоже играются — как в селектах создания
  // модуля (modules.js), помечаем их 📂.
  const qs = window.location.search;
  let chrs;
  try { chrs = await fetch('/api/chronicles' + (qs ? qs + '&include_hidden=1' : '?include_hidden=1')).then(r => r.json()); }
  catch { chrs = []; }
  chrSel.innerHTML = '<option value="">— хроника —</option>' +
    (chrs || []).map(c => `<option value="${escHtml(c.slug)}">${escHtml((c.hidden ? '📂 ' : '') + (c.display || c.slug))}${c.status === 'closed' ? ' (закрыта)' : ''}</option>`).join('');
  // Скелет заметок сессии (#sess-notes) нужен ДО _sessLoadModules — тот может
  // синхронно каскадом дойти до _sessLoadModule → _sessHydrateSessionNotes,
  // которой нужен уже существующий #sess-notes (иначе загруженный текст молча
  // потеряется: он придёт раньше, чем появится textarea).
  _sessRenderNotes();
  if (saved.chr && chrs.some(c => c.slug === saved.chr)) {
    chrSel.value = saved.chr;
    await _sessLoadModules(saved.chr, saved.mod);
  }
}

async function _sessLoadModules(chr, preselect) {
  const cardsEl = document.getElementById('sess-mod-cards');
  if (!chr) { cardsEl.innerHTML = ''; _sessClearModule(); return; }
  cardsEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка модулей...</div>';
  let mods;
  try { mods = await fetch(`/api/chronicles/${encodeURIComponent(chr)}/modules` + (window.location.search || '')).then(r => r.json()); }
  catch { mods = []; }
  if (!Array.isArray(mods) || !mods.length) {
    // Обучающий empty-state (принцип .chars-empty) — не голое «пусто».
    cardsEl.innerHTML = `
      <div class="chars-empty">
        <div class="chars-empty-title">В этой хронике пока нет модулей</div>
        <p class="chars-empty-body">Создайте первый модуль на странице «Модули», чтобы начать сессию.</p>
      </div>`;
    return;
  }
  cardsEl.innerHTML = mods.map(m => {
    let html = renderModuleCardInChr(m, chr);
    if (preselect && m.name === preselect) html = html.replace('class="chd-mod-card"', 'class="chd-mod-card chd-mod-card--active"');
    return html;
  }).join('');
  if (preselect && mods.some(m => m.name === preselect)) {
    await _sessLoadModule(chr, preselect);
  }
}

// Явное условие видимости навигации «Сцена назад/вперёд»: нужны и хроника, и
// модуль, и непустой сценарий. Не полагаемся только на побочный эффект веток
// _sessClearModule()/_sessRenderScenario() — вызывается в нескольких точках
// жизненного цикла, чтобы кнопки не мелькали видимыми в промежуточных
// состояниях асинхронной загрузки (смена хроники/модуля).
// Модуль выбран — читаем модульную переменную _sessCurrentMod, а не
// .value несуществующего <select id="sess-mod-sel"> (заменён карточками
// #sess-mod-cards в тикете 3.2).
function _sessSyncSceneNavVisibility() {
  const chrSel = document.getElementById('sess-chr-sel');
  const nav    = document.getElementById('sess-scene-nav');
  nav.hidden = !(chrSel.value && _sessCurrentMod && _sessBlocks.length);
}

function _sessClearModule() {
  _sessDetail = null; _sessBlocks = []; _sessScene = 0; _sessCurrentMod = null;
  _sessSceneNotesCache = {};
  document.getElementById('sess-scenario').innerHTML = '<div class="cdet-empty">Выбери хронику и модуль</div>';
  document.getElementById('sess-npcs').innerHTML = '';
  document.getElementById('sess-audio').innerHTML = '';
  _sessRenderSceneNote();       // сбрасывает блок заметки сцены (нет сцены — нет блока)
  _sessHydrateSessionNotes(''); // сбрасывает textarea заметок сессии (нет модуля — нет заметки)
  _sessSyncSceneNavVisibility();
}

async function _sessLoadModule(chr, mod) {
  _sessCurrentMod = mod;
  const scEl = document.getElementById('sess-scenario');
  scEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  _sessBlocks = [];
  _sessSyncSceneNavVisibility(); // _sessBlocks уже сброшен — скрыть, пока не подтвердится новый сценарий
  // Guard от гонки: пока этот await летит, GM может успеть кликнуть по другой
  // карточке модуля — та вызовет _sessLoadModule заново и синхронно перезапишет
  // _sessCurrentMod. Если к моменту разрешения await «наш» mod уже не совпадает
  // с актуальным _sessCurrentMod — этот ответ устарел, тихо выходим, не трогая
  // _sessBlocks/_sessDetail/localStorage/рендер (иначе более медленный поздний
  // ответ мог бы затереть уже показанный результат более быстрого).
  const qs   = window.location.search || '';
  const base = `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}`;
  let detail, sceneNotes, sessionNotesResp;
  try {
    if (typeof ensureCharsLoaded === 'function') await ensureCharsLoaded(); // для resolveCharByName в чипах НПС
    if (_sessCurrentMod !== mod) return;
    // scene-notes/session-notes грузятся параллельно с detail — тот же guard от
    // гонки устаревших асинхронных ответов ниже покрывает и их. Сбой ИМЕННО
    // этих двух не должен ронять загрузку сценария/НПС/аудио — свой .catch()
    // с безопасным дефолтом на каждый (detail — по-прежнему фатален).
    [detail, sceneNotes, sessionNotesResp] = await Promise.all([
      fetch(`${base}/detail${qs}`).then(r => r.json()),
      fetch(`${base}/scene-notes${qs}`).then(r => r.json()).catch(() => ({})),
      fetch(`${base}/session-notes${qs}`).then(r => r.json()).catch(() => ({ text: '' })),
    ]);
  } catch {
    if (_sessCurrentMod !== mod) return; // устаревший запрос — не заслоняем ошибкой уже выбранный другой модуль
    scEl.innerHTML = '<div class="cdet-empty">⚠ Не удалось загрузить модуль</div>';
    _sessBlocks = [];
    _sessSyncSceneNavVisibility();
    return;
  }
  if (_sessCurrentMod !== mod) return; // устаревший ответ пришёл позже более нового запроса
  _sessDetail = detail;
  _sessSceneNotesCache = (sceneNotes && typeof sceneNotes === 'object') ? sceneNotes : {};
  const raw = (_sessDetail.scenario || '').replace(/\r\n/g, '\n');
  _sessBlocks = raw.trim()
    ? raw.split(/\n(?=##\s+)/).map(part => {
        const m = part.match(/^##\s+(.+)\n?([\s\S]*)$/);
        // Преамбула до первого ##-заголовка (шапка/breadcrumb сценария) —
        // не «Без заголовка», а вступление.
        return m ? { heading: m[1].trim(), body: m[2] } : { heading: 'Вступление', body: part };
      }).filter(b => b.heading || b.body.trim())
    : [];
  const saved = _sessStore();
  _sessScene = (saved.chr === chr && saved.mod === mod && Number.isInteger(saved.scene))
    ? Math.min(Math.max(0, saved.scene), Math.max(0, _sessBlocks.length - 1)) : 0;
  _sessSave({ chr, mod, scene: _sessScene });
  _sessRenderScenario();
  _sessRenderNpcs();
  _sessRenderAudio();
  _sessRenderSceneNote();
  _sessHydrateSessionNotes(sessionNotesResp?.text || '');
  _sessSyncSceneNavVisibility();
}

// ── Сценарий ──────────────────────────────────────────────────────────────────

function _sessRenderScenario() {
  const scEl  = document.getElementById('sess-scenario');
  _sessSyncSceneNavVisibility();
  if (!_sessBlocks.length) {
    scEl.innerHTML = '<div class="cdet-empty">Сценарий не сгенерирован — открой модуль и заполни его на странице «Модули».</div>';
    return;
  }
  document.getElementById('sess-scene-label').textContent =
    `${_sessScene + 1} / ${_sessBlocks.length}`;
  scEl.innerHTML = _sessBlocks.map((b, i) => `
    <section class="sess-block${i === _sessScene ? ' open' : ''}" data-scene="${i}">
      <button class="sess-block-head" data-scene-head="${i}">${escHtml(b.heading || 'Без заголовка')}</button>
      ${i === _sessScene ? `<div class="sess-block-body md-body">${mdToHtmlBlock(b.body)}</div>` : ''}
    </section>`).join('');
  const open = scEl.querySelector('.sess-block.open');
  if (open) open.scrollIntoView({ block: 'nearest' });
}

function _sessGoScene(idx) {
  if (!_sessBlocks.length) return;
  _sessScene = Math.min(Math.max(0, idx), _sessBlocks.length - 1);
  _sessSave({ scene: _sessScene });
  _sessRenderScenario();
  _sessRenderSceneNote(); // новая сцена — свой заголовок/текст/dirty-состояние кнопки
}

// ── НПС ───────────────────────────────────────────────────────────────────────

function _sessRenderNpcs() {
  const el = document.getElementById('sess-npcs');
  const people = [...(_sessDetail?.pcs || []), ...(_sessDetail?.npcs || [])];
  if (!people.length) {
    el.innerHTML = `
      <div class="sess-side-title">👥 Персонажи модуля</div>
      <div class="cdet-empty">В карточке модуля не указаны участники</div>`;
    return;
  }
  el.innerHTML = `
    <div class="sess-side-title">👥 Персонажи модуля</div>
    <div class="sess-npc-list">
      ${people.map(p => {
        const known = typeof resolveCharByName === 'function' ? resolveCharByName(p.name) : null;
        return known
          ? `<button class="chron-chip sess-npc-chip" data-sess-char="${escHtml(known.name)}" title="${escHtml(p.role || '')}">${escHtml(p.name)}</button>`
          : `<span class="chron-chip" title="${escHtml(p.role || '')}">${escHtml(p.name)}</span>`;
      }).join('')}
    </div>`;
}

// ── Аудио ─────────────────────────────────────────────────────────────────────

async function _sessRenderAudio() {
  const el = document.getElementById('sess-audio');
  el.innerHTML = '';
  try {
    if (!_sessPresets) _sessPresets = await fetch('/api/audio/presets' + (window.location.search || '')).then(r => r.json());
  } catch { _sessPresets = []; }
  if (!Array.isArray(_sessPresets) || !_sessPresets.length) return;
  // Пресеты локаций модуля — сверху (матч по названию локации: у локаций
  // сценария нет слагов, у пресета есть locationTitle).
  const locNames = (_sessDetail?.locations || []).map(l => (l.name || '').toLowerCase()).filter(Boolean);
  const scored = _sessPresets.map(p => ({
    p,
    local: !!(p.locationTitle && locNames.some(n => n.includes(p.locationTitle.toLowerCase()) || p.locationTitle.toLowerCase().includes(n))),
  }));
  scored.sort((a, b) => (b.local ? 1 : 0) - (a.local ? 1 : 0));
  const activeId = typeof _audioActivePresetId !== 'undefined' ? _audioActivePresetId : null;
  el.innerHTML = `
    <div class="sess-side-title">🎵 Аудио-пресеты</div>
    ${scored.map(({ p, local }) => `
      <div class="sess-preset${p.id === activeId ? ' playing' : ''}" data-preset-id="${escHtml(p.id)}">
        <span class="sess-preset-name">${local ? '📍 ' : ''}${escHtml(p.name)}</span>
        <button class="chron-toggle sess-preset-btn" data-sess-preset="${escHtml(p.id)}">${p.id === activeId ? '⏹' : '▶'}</button>
      </div>`).join('')}`;
}

// ── Сохранение заметок: общий хелпер кнопки «Сохранить» ────────────────────────
// Переиспользуется и «Заметкой сцены», и «Заметками сессии» — обе требуют
// одинаковый набор состояний:
//  - disabled, пока значение textarea совпадает с последним загруженным
//    (getLoaded() — вызывается каждый раз заново, а не один раз при биндинге,
//    т.к. «загруженное» значение меняется при смене сцены/модуля);
//  - на время onSave(text) — disabled + текст «⏳ Сохраняю…» (иначе двойной
//    клик до ответа сервера уйдёт вторым параллельным запросом);
//  - при ошибке onSave() (throw) — showToast(..., 'error') и кнопка
//    возвращается в активное состояние, чтобы можно было повторить попытку
//    без повторного набора текста;
//  - onSave может вернуть `false`, если к моменту ответа сервера результат уже
//    устарел (пользователь успел переключить сцену/модуль, пока запрос летел) —
//    тогда кнопку/подпись НЕ трогаем: их уже мог переопределить свежий рендер
//    для нового контекста, и не должны затирать его состояние гонки.
function _sessBindSaveButton(btn, ta, getLoaded, onSave) {
  const syncDirty = () => { btn.disabled = (ta.value === getLoaded()); };
  ta.addEventListener('input', syncDirty);
  btn.addEventListener('click', async () => {
    const text  = ta.value;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Сохраняю…';
    try {
      const stale = (await onSave(text)) === false;
      if (stale) return;
      btn.textContent = label;
      btn.disabled = true; // сохранено — снова в синхронном состоянии
    } catch (err) {
      btn.textContent = label;
      btn.disabled = false;
      showToast('Не удалось сохранить: ' + err.message, 'error');
    }
  });
  return syncDirty;
}

// ── Заметка сцены (3.5-FE) ──────────────────────────────────────────────────────

function _sessRenderSceneNote() {
  const wrap = document.getElementById('sess-scene-notes-wrap');
  if (!_sessBlocks.length) { wrap.innerHTML = ''; _sessSceneNoteLoaded = ''; return; }
  const heading = _sessBlocks[_sessScene]?.heading || '';
  if (!wrap.querySelector('#sess-scene-note')) {
    wrap.innerHTML = `
      <div class="sess-side-title" id="sess-scene-note-title"></div>
      <textarea class="form-control" id="sess-scene-note" rows="6" placeholder="Заметка к этой сцене..."></textarea>
      <button class="chr-modal-btn" id="sess-scene-note-save" disabled>Сохранить</button>`;
    const ta  = wrap.querySelector('#sess-scene-note');
    const btn = wrap.querySelector('#sess-scene-note-save');
    _sessBindSaveButton(btn, ta, () => _sessSceneNoteLoaded, async text => {
      const h = _sessBlocks[_sessScene]?.heading || ''; // heading НА МОМЕНТ клика, как есть — без нормализации/strip эмодзи
      const capturedMod   = _sessCurrentMod;
      const capturedScene = h; // heading как ключ идентичности сцены — тот же ключ, что и в _sessSceneNotesCache
      const chr = document.getElementById('sess-chr-sel').value;
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(capturedMod)}/scene-note${window.location.search || ''}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heading: h, text }) }
      );
      const result = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(result.error || 'Ошибка сохранения');
      if (_sessCurrentMod !== capturedMod) return false; // модуль сменился, пока PUT летел — не трогаем чужой кэш/кнопку
      _sessSceneNotesCache[h] = text; // сцена сохранилась на сервере — кэш обновляем независимо от того, что сейчас отображается
      if ((_sessBlocks[_sessScene]?.heading || '') !== capturedScene) return false; // сцена сменилась (тот же модуль), пока PUT летел — не трогаем кнопку/loaded уже другой сцены
      _sessSceneNoteLoaded = text;
      // GM мог уйти со сцены и вернуться на ТУ ЖЕ, пока PUT летел — тогда
      // _sessRenderSceneNote() уже перерисовал(а) textarea со старым (дозапросным)
      // значением кэша. Раз сцена совпала — досинхронизируем ВИДИМОЕ значение с
      // тем, что реально сохранилось, беря ссылку на textarea заново из DOM (а
      // не захваченную замыканием `ta`, которая могла устареть после рендера).
      const curTa = document.getElementById('sess-scene-note');
      if (curTa) curTa.value = text;
    });
  }
  document.getElementById('sess-scene-note-title').textContent = `Заметка «${heading}»`;
  const ta  = document.getElementById('sess-scene-note');
  const btn = document.getElementById('sess-scene-note-save');
  _sessSceneNoteLoaded = _sessSceneNotesCache[heading] || '';
  ta.value = _sessSceneNoteLoaded;
  btn.disabled = true;
  btn.textContent = 'Сохранить';
}

// ── Заметки сессии (3.6-FE) — файл модуля, не localStorage ─────────────────────

function _sessRenderNotes() {
  const wrap = document.getElementById('sess-notes-wrap');
  if (wrap.querySelector('#sess-notes')) return; // скелет уже отрисован — значение обновляет _sessHydrateSessionNotes
  wrap.innerHTML = `
    <div class="sess-side-title">📝 Заметки сессии</div>
    <textarea class="form-control" id="sess-notes" rows="8" placeholder="Что произошло, имена, зацепки..."></textarea>
    <button class="chr-modal-btn" id="sess-notes-save" disabled>Сохранить</button>
    <button class="chr-modal-btn" id="sess-to-log">→ Записать сессию</button>`;
  const ta  = wrap.querySelector('#sess-notes');
  const btn = wrap.querySelector('#sess-notes-save');
  _sessBindSaveButton(btn, ta, () => _sessSessionNotesLoaded, async text => {
    const capturedMod = _sessCurrentMod;
    const chr = document.getElementById('sess-chr-sel').value;
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(capturedMod)}/session-notes${window.location.search || ''}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }
    );
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.error || 'Ошибка сохранения');
    if (_sessCurrentMod !== capturedMod) return false; // модуль сменился, пока PUT летел
    _sessSessionNotesLoaded = text;
    // Тот же принцип, что и у заметки сцены: GM мог уйти с модуля и вернуться
    // на ТОТ ЖЕ, пока PUT летел — _sessHydrateSessionNotes уже показал(а)
    // старое (дозапросное) значение. Модуль совпал — досинхронизируем видимое
    // значение, беря ссылку на textarea заново из скоупленного #sess-notes-wrap
    // (не замыканную `ta`, которая могла устареть после повторного рендера).
    const curTa = document.getElementById('sess-notes-wrap')?.querySelector('#sess-notes');
    if (curTa) curTa.value = text;
  });
  // 3.7: «→ Записать сессию» больше не ведёт на устаревшую вкладку записи
  // сессии на странице «Инструменты» — вместо этого открывает страницу
  // ТЕКУЩЕГО модуля сразу на вкладке «Сессии» с уже открытой формой,
  // префилленной агрегатом заметок
  // сыгранных (ещё не записанных в прошлые сессии) сцен. chr/mod берём из
  // актуального состояния экрана Сессии (#sess-chr-sel, _sessCurrentMod), а не
  // из _sessStore() — та может отставать от live-состояния.
  wrap.querySelector('#sess-to-log').addEventListener('click', () => {
    const chr = document.getElementById('sess-chr-sel').value;
    const mod = _sessCurrentMod;
    if (!chr || !mod) {
      showToast('Выбери хронику и модуль перед записью сессии', 'error');
      return;
    }
    // «Сыгранные» сцены — тем же принципом, что фильтр sceneOpts в modules.js
    // (вынесен в общий хелпер _filterUnrecordedScenes, modules.js): сцены
    // сценария, чьи заголовки ещё не встречаются ни в одной уже записанной
    // сессии этого модуля.
    const scenes    = _sessDetail?.scenes   || [];
    const sessions  = _sessDetail?.sessions || [];
    const unrecorded = typeof _filterUnrecordedScenes === 'function'
      ? _filterUnrecordedScenes(scenes, sessions) : [];
    // Для каждой несыгранной-ранее сцены ищем заметку в _sessSceneNotesCache —
    // ключ кэша это СЫРОЙ heading из _sessBlocks[i].heading, а `unrecorded`
    // содержит реконструированные бэкендом лейблы `${sc.date} — ${sc.title}`
    // (см. modules.js sceneSelect). На реальных данных сценария оба совпадают
    // байт-в-байт, когда заголовок без эмодзи-префикса и с разделителем «—»
    // (проверено на progulki_po_metro/scenario.md) — но это не гарантировано
    // для всех данных, поэтому просто пропускаем сцену без совпадения, не
    // вставляя пустой/мусорный блок.
    const noteParts = [];
    for (const label of unrecorded) {
      const block = _sessBlocks.find(b => b.heading === label);
      if (!block) continue;
      const note = (_sessSceneNotesCache[block.heading] || '').trim();
      if (!note) continue;
      noteParts.push(`## ${block.heading}\n${note}`);
    }
    _pendingModulePrefill = {
      tab: 'sessions',
      notes: noteParts.join('\n\n'),
      scenes: unrecorded.join(', '),
    };
    openModulePage(chr, mod);
  });
}

// Обновляет содержимое textarea заметок сессии ТЕКУЩЕГО модуля (вызывается из
// _sessLoadModule после загрузки session-notes и из _sessClearModule для
// сброса) — сам скелет (textarea/кнопка) создаётся один раз в _sessRenderNotes().
function _sessHydrateSessionNotes(text) {
  // Скоуплено через #sess-notes-wrap, а НЕ через голый document.getElementById
  // по id «sess-notes» — тот же id рендерит modules.js (#modp-panel-sessions,
  // форма записи сессии на странице модуля); navigate() не удаляет страницы из
  // DOM, а лишь переключает .active, так что после ЛЮБОГО открытия модуля
  // через openModulePage несскоупленный лукап по этому id навсегда резолвился
  // бы в чужой (скрытый) textarea модуля вместо виджета на экране Сессии.
  const wrap = document.getElementById('sess-notes-wrap');
  const ta   = wrap.querySelector('#sess-notes');
  const btn  = wrap.querySelector('#sess-notes-save');
  if (!ta || !btn) return; // _sessRenderNotes ещё не отрисовала скелет
  _sessSessionNotesLoaded = text || '';
  ta.value = _sessSessionNotesLoaded;
  btn.disabled = true;
  btn.textContent = 'Сохранить';
}

// ── Обработчики ───────────────────────────────────────────────────────────────

document.getElementById('sess-chr-sel').addEventListener('change', async e => {
  _sessSave({ chr: e.target.value, mod: null, scene: 0 });
  _sessClearModule();
  await _sessLoadModules(e.target.value, null);
});
document.getElementById('sess-prev').addEventListener('click', () => _sessGoScene(_sessScene - 1));
document.getElementById('sess-next').addEventListener('click', () => _sessGoScene(_sessScene + 1));

document.getElementById('page-session').addEventListener('click', async e => {
  const head = e.target.closest('[data-scene-head]');
  if (head) { _sessGoScene(Number(head.dataset.sceneHead)); return; }

  // Карточки модулей (#sess-mod-cards, renderModuleCardInChr — тикет 3.2).
  // Кнопка удаления модуля скрыта здесь через CSS (Сессия — режим игры, не
  // управления модулями), но на всякий случай не открываем сессию, если клик
  // всё же пришёлся на неё (то же условие, что modules.js:224 для модалки хроники).
  if (e.target.closest('.chd-mod-del-btn')) return;
  // Бейдж «📜 Финал» на карточке — как в модалке хроники (modules.js): открыть
  // лёгкое превью финала, перехватывая клик РАНЬШЕ общего клика по карточке
  // модуля (иначе клик по бейджу просто грузил бы сценарий, будто кликнули
  // мимо, — бейдж выглядит кликабельным, но ничего не делает).
  const finaleBadge = e.target.closest('[data-open-finale]');
  if (finaleBadge) { openFinalePreview(finaleBadge.dataset.chr, finaleBadge.dataset.mod); return; }
  const modCard = e.target.closest('.chd-mod-card');
  if (modCard) {
    const chr = document.getElementById('sess-chr-sel').value;
    const mod = modCard.dataset.mod;
    if (mod) {
      document.querySelectorAll('#sess-mod-cards .chd-mod-card--active')
        .forEach(c => c.classList.remove('chd-mod-card--active'));
      modCard.classList.add('chd-mod-card--active');
      await _sessLoadModule(chr, mod);
    }
    return;
  }

  const npc = e.target.closest('[data-sess-char]');
  if (npc) { openCharDetail(npc.dataset.sessChar); return; }

  const presetBtn = e.target.closest('[data-sess-preset]');
  if (presetBtn) {
    const pid = presetBtn.dataset.sessPreset;
    const activeId = typeof _audioActivePresetId !== 'undefined' ? _audioActivePresetId : null;
    if (typeof _audioLibCache === 'undefined' || !_audioLibCache) await loadAudioLibrary();
    if (pid === activeId) _audioPresetStop();
    else { _audioPresetCache = _sessPresets; await _audioPresetPlay(pid); }
    _sessRenderAudio();
    return;
  }
});
