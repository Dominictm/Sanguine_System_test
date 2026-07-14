'use strict';
// Экран сессии (режим живой игры): сценарий активного модуля по сценам,
// быстрые НПС, аудио-пресеты, заметки с передачей в запись сессии.
// Только композиция существующих API/глобалей (openCharDetail,
// loadAudioLibrary, _audioPresetPlay/_audioPresetStop, navigate).

let _sessDetail  = null;   // ответ /detail выбранного модуля
let _sessBlocks  = [];     // [{heading, body}] — сценарий по ##-блокам
let _sessScene   = 0;      // индекс развёрнутого блока
let _sessPresets = null;   // кэш GET /api/audio/presets

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
  if (saved.chr && chrs.some(c => c.slug === saved.chr)) {
    chrSel.value = saved.chr;
    await _sessLoadModules(saved.chr, saved.mod);
  }
  _sessRenderNotes();
}

async function _sessLoadModules(chr, preselect) {
  const modSel = document.getElementById('sess-mod-sel');
  modSel.disabled = true;
  modSel.innerHTML = '<option value="">— модуль —</option>';
  if (!chr) { _sessClearModule(); return; }
  let mods;
  try { mods = await fetch(`/api/chronicles/${encodeURIComponent(chr)}/modules` + (window.location.search || '')).then(r => r.json()); }
  catch { mods = []; }
  modSel.innerHTML = '<option value="">— модуль —</option>' +
    (mods || []).map(m => `<option value="${escHtml(m.name)}">${escHtml(m.title || m.name)}</option>`).join('');
  modSel.disabled = false;
  if (preselect && mods.some(m => m.name === preselect)) {
    modSel.value = preselect;
    await _sessLoadModule(chr, preselect);
  }
}

function _sessClearModule() {
  _sessDetail = null; _sessBlocks = []; _sessScene = 0;
  document.getElementById('sess-scene-nav').hidden = true;
  document.getElementById('sess-scenario').innerHTML = '<div class="cdet-empty">Выбери хронику и модуль</div>';
  document.getElementById('sess-npcs').innerHTML = '';
  document.getElementById('sess-audio').innerHTML = '';
}

async function _sessLoadModule(chr, mod) {
  const scEl = document.getElementById('sess-scenario');
  scEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    if (typeof ensureCharsLoaded === 'function') await ensureCharsLoaded(); // для resolveCharByName в чипах НПС
    _sessDetail = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail` + (window.location.search || '')
    ).then(r => r.json());
  } catch {
    scEl.innerHTML = '<div class="cdet-empty">⚠ Не удалось загрузить модуль</div>';
    return;
  }
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
}

// ── Сценарий ──────────────────────────────────────────────────────────────────

function _sessRenderScenario() {
  const scEl  = document.getElementById('sess-scenario');
  const nav   = document.getElementById('sess-scene-nav');
  if (!_sessBlocks.length) {
    nav.hidden = true;
    scEl.innerHTML = '<div class="cdet-empty">Сценарий не сгенерирован — открой модуль и заполни его на странице «Модули».</div>';
    return;
  }
  nav.hidden = false;
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

// ── Заметки ───────────────────────────────────────────────────────────────────

let _sessNotesTimer = null;

function _sessRenderNotes() {
  const wrap = document.getElementById('sess-notes-wrap');
  if (wrap.querySelector('#sess-notes')) return; // уже отрисовано
  wrap.innerHTML = `
    <div class="sess-side-title">📝 Заметки сессии</div>
    <textarea class="form-control" id="sess-notes" rows="8" placeholder="Что произошло, имена, зацепки..."></textarea>
    <button class="chr-modal-btn" id="sess-to-log">→ Записать сессию</button>`;
  const ta = wrap.querySelector('#sess-notes');
  ta.value = _sessStore().notes || '';
  ta.addEventListener('input', () => {
    clearTimeout(_sessNotesTimer);
    _sessNotesTimer = setTimeout(() => _sessSave({ notes: ta.value }), 500);
  });
  wrap.querySelector('#sess-to-log').addEventListener('click', () => {
    const notes = ta.value.trim();
    const { chr, mod } = _sessStore();
    navigate('tools');
    const tabBtn = document.querySelector('.tab-btn[data-tab="log-session"]');
    if (tabBtn) tabBtn.click();
    // Предзаполняем только пустые поля — ручной ввод не затираем.
    const summary = document.getElementById('ls-summary');
    if (summary && !summary.value.trim() && notes) summary.value = notes;
    const chrSel = document.getElementById('ls-chron-slug');
    if (chrSel && !chrSel.value && chr) chrSel.value = chr;
    const modName = document.getElementById('ls-mod-name');
    if (modName && !modName.value.trim() && mod && _sessDetail) modName.value = _sessDetail.title || mod;
  });
}

// ── Обработчики ───────────────────────────────────────────────────────────────

document.getElementById('sess-chr-sel').addEventListener('change', async e => {
  _sessSave({ chr: e.target.value, mod: null, scene: 0 });
  _sessClearModule();
  await _sessLoadModules(e.target.value, null);
});
document.getElementById('sess-mod-sel').addEventListener('change', async e => {
  const chr = document.getElementById('sess-chr-sel').value;
  if (!e.target.value) { _sessClearModule(); return; }
  await _sessLoadModule(chr, e.target.value);
});
document.getElementById('sess-prev').addEventListener('click', () => _sessGoScene(_sessScene - 1));
document.getElementById('sess-next').addEventListener('click', () => _sessGoScene(_sessScene + 1));

document.getElementById('page-session').addEventListener('click', async e => {
  const head = e.target.closest('[data-scene-head]');
  if (head) { _sessGoScene(Number(head.dataset.sceneHead)); return; }

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
