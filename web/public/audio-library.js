'use strict';
// Звуковая библиотека (саундборд) — карточки-плееры, играющие одновременно.
// Загружается один раз (см. index.html), рендерится при заходе на страницу
// (navigate() в scripts.js), см. docs/superpowers/specs/2026-07-10-audio-library-design.md.

let _audioLibCache = null; // [{ id, ext, filename, title, volume, loop, createdAt, url }]

function _audioLibCardHtml(t) {
  // Записи, загруженные до появления поля loop, ещё не имеют его в index.json —
  // трактуем как включённое (прежнее жёстко зашитое поведение), а не как выключенное.
  const loopOn   = t.loop !== false;
  const isMusic  = t.category === 'music';
  return `<div class="audio-card" data-audio-id="${escAttr(t.id)}">
    <div class="audio-card-title" data-audio-title-view>${escHtml(t.title)}</div>
    <audio data-audio-el src="${escAttr(t.url)}" ${loopOn ? 'loop' : ''} preload="none"></audio>
    <div class="audio-card-row">
      <button type="button" class="audio-card-play-btn" data-audio-play aria-label="Играть/пауза">▶</button>
      <button type="button" class="audio-card-icon-btn" data-audio-stop aria-label="Остановить полностью">⏹</button>
      <input type="range" class="audio-card-volume" data-audio-volume min="0" max="1" step="0.01" value="${t.volume}">
    </div>
    <div class="audio-card-actions">
      <button type="button" class="audio-card-icon-btn" data-audio-category aria-label="Сменить категорию (сейчас: ${isMusic ? 'фоновая музыка' : 'аудио эффект'})">${isMusic ? '🎵' : '🔊'}</button>
      <button type="button" class="audio-card-icon-btn${loopOn ? ' active' : ''}" data-audio-loop aria-pressed="${loopOn}" aria-label="Зацикливание">🔁</button>
      <button type="button" class="audio-card-icon-btn" data-audio-rename aria-label="Переименовать">✎</button>
      <button type="button" class="audio-card-icon-btn" data-audio-delete aria-label="Удалить">🗑</button>
    </div>
  </div>`;
}

function _audioLibRender() {
  const musicEl = document.getElementById('audio-lib-music-cards');
  const fxEl    = document.getElementById('audio-lib-effects-cards');
  if (!musicEl || !fxEl) return;
  // Записи, загруженные до появления поля category, трактуются как эффект
  // (см. спеку) — t.category !== 'music' покрывает и это, и явное 'effect'.
  const music = _audioLibCache.filter(t => t.category === 'music');
  const fx    = _audioLibCache.filter(t => t.category !== 'music');
  musicEl.innerHTML = music.length ? music.map(_audioLibCardHtml).join('') : '<div class="loading-state audio-lib-col-empty">Пока нет фоновой музыки.</div>';
  fxEl.innerHTML    = fx.length    ? fx.map(_audioLibCardHtml).join('')    : '<div class="loading-state audio-lib-col-empty">Пока нет эффектов.</div>';
}

async function loadAudioLibrary() {
  const musicEl = document.getElementById('audio-lib-music-cards');
  const fxEl    = document.getElementById('audio-lib-effects-cards');
  const loading = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  if (musicEl) musicEl.innerHTML = loading;
  if (fxEl)    fxEl.innerHTML    = loading;
  try {
    _audioLibCache = await apiFetch('/api/audio');
  } catch (e) {
    showToast('Не удалось загрузить звуковую библиотеку: ' + e.message, 'error');
    _audioLibCache = [];
  }
  _audioLibRender();
  await loadAudioPresets();
}

// ── Play/pause + громкость (делегирование на общем контейнере страницы,
// накрывает обе колонки треков и колонку пресетов одним обработчиком —
// проще, чем регистрировать один и тот же диспетчер трижды). ──
document.querySelector('.audio-lib-columns')?.addEventListener('click', async e => {
  const playBtn = e.target.closest('[data-audio-play]');
  if (playBtn) {
    const card = playBtn.closest('.audio-card');
    const audioEl = card.querySelector('[data-audio-el]');
    if (audioEl.paused) {
      // play() returns a promise that can reject (autoplay policy, decode error,
      // missing file) — flipping the button to "playing" before it resolves would
      // show a misleading state if playback never actually starts.
      try {
        await audioEl.play();
        playBtn.textContent = '⏸';
        playBtn.classList.add('playing');
      } catch (err) {
        showToast('Не удалось начать воспроизведение: ' + err.message, 'error');
      }
    } else {
      audioEl.pause();
      playBtn.textContent = '▶';
      playBtn.classList.remove('playing');
    }
    return;
  }

  const stopBtn = e.target.closest('[data-audio-stop]');
  if (stopBtn) {
    const card = stopBtn.closest('.audio-card');
    const audioEl = card.querySelector('[data-audio-el]');
    audioEl.pause();
    audioEl.currentTime = 0;
    const playBtn = card.querySelector('[data-audio-play]');
    playBtn.textContent = '▶';
    playBtn.classList.remove('playing');
    return;
  }

  const categoryBtn = e.target.closest('[data-audio-category]');
  if (categoryBtn) { await _audioLibToggleCategory(categoryBtn.closest('.audio-card'), categoryBtn); return; }

  const loopBtn = e.target.closest('[data-audio-loop]');
  if (loopBtn) { await _audioLibToggleLoop(loopBtn.closest('.audio-card'), loopBtn); return; }

  const renameBtn = e.target.closest('[data-audio-rename]');
  if (renameBtn) { _audioLibStartRename(renameBtn.closest('.audio-card')); return; }

  const deleteBtn = e.target.closest('[data-audio-delete]');
  if (deleteBtn) { _audioLibDelete(deleteBtn.closest('.audio-card')); return; }
});

async function _audioLibToggleLoop(card, loopBtn) {
  const audioEl = card.querySelector('[data-audio-el]');
  const next = !audioEl.loop;
  audioEl.loop = next;
  loopBtn.classList.toggle('active', next);
  loopBtn.setAttribute('aria-pressed', String(next));
  try {
    const id = card.dataset.audioId;
    await apiFetch(`/api/audio/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loop: next }),
    });
    const entry = _audioLibCache.find(t => t.id === id);
    if (entry) entry.loop = next;
  } catch (e) {
    showToast('Не удалось сохранить зацикливание: ' + e.message, 'error');
  }
}

async function _audioLibToggleCategory(card, btn) {
  const id = card.dataset.audioId;
  const entry = _audioLibCache.find(t => t.id === id);
  if (!entry) return;
  const next = entry.category === 'music' ? 'effect' : 'music';
  try {
    const updated = await apiFetch(`/api/audio/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: next }),
    });
    entry.category = updated.category;
    btn.textContent = entry.category === 'music' ? '🎵' : '🔊';
    btn.setAttribute('aria-label', `Сменить категорию (сейчас: ${entry.category === 'music' ? 'фоновая музыка' : 'аудио эффект'})`);
    const targetContainer = document.getElementById(entry.category === 'music' ? 'audio-lib-music-cards' : 'audio-lib-effects-cards');
    targetContainer.appendChild(card); // переносит живой DOM-узел (аудио продолжает играть, если играло) в другую колонку
    _audioLibRefreshColumnEmptyStates();
  } catch (e) {
    showToast('Не удалось сменить категорию: ' + e.message, 'error');
  }
}

function _audioLibRefreshColumnEmptyStates() {
  [
    ['audio-lib-music-cards', 'Пока нет фоновой музыки.'],
    ['audio-lib-effects-cards', 'Пока нет эффектов.'],
  ].forEach(([containerId, emptyText]) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    const hasCards = el.querySelector('.audio-card') !== null;
    let placeholder = el.querySelector('.audio-lib-col-empty');
    if (!hasCards && !placeholder) {
      el.insertAdjacentHTML('beforeend', `<div class="loading-state audio-lib-col-empty">${emptyText}</div>`);
    } else if (hasCards && placeholder) {
      placeholder.remove();
    }
  });
}

document.querySelector('.audio-lib-columns')?.addEventListener('input', e => {
  const slider = e.target.closest('[data-audio-volume]');
  if (!slider) return;
  const card = slider.closest('.audio-card');
  const audioEl = card.querySelector('[data-audio-el]');
  audioEl.volume = parseFloat(slider.value);
  _audioLibDebouncedSaveVolume(card.dataset.audioId, parseFloat(slider.value));
});

let _audioLibVolumeTimers = {};
function _audioLibDebouncedSaveVolume(id, volume) {
  clearTimeout(_audioLibVolumeTimers[id]);
  _audioLibVolumeTimers[id] = setTimeout(async () => {
    try { await apiFetch(`/api/audio/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ volume }),
    }); } catch (e) { showToast('Не удалось сохранить громкость: ' + e.message, 'error'); }
  }, 400);
}

function _audioLibStartRename(card) {
  const titleEl = card.querySelector('[data-audio-title-view]');
  const current = titleEl.textContent;
  const input = document.createElement('input');
  input.className = 'audio-card-title-input';
  input.value = current;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const next = input.value.trim();
    if (!next || next === current) { _audioLibRender(); return; }
    try {
      const id = card.dataset.audioId;
      const updated = await apiFetch(`/api/audio/${encodeURIComponent(id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: next }),
      });
      const entry = _audioLibCache.find(t => t.id === id);
      if (entry) entry.title = updated.title;
    } catch (e) {
      showToast('Не удалось переименовать: ' + e.message, 'error');
    }
    _audioLibRender();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

async function _audioLibDelete(card) {
  const id = card.dataset.audioId;
  const entry = _audioLibCache.find(t => t.id === id);
  if (!await showConfirm(`Удалить «${entry?.title || ''}»?\nДействие необратимо.`, { danger: true, confirmText: 'Удалить' })) return;
  try {
    await apiFetch(`/api/audio/${encodeURIComponent(id)}`, { method: 'DELETE' });
    _audioLibCache = _audioLibCache.filter(t => t.id !== id);
    _audioLibRender();
  } catch (e) {
    showToast('Не удалось удалить: ' + e.message, 'error');
  }
}

// ── Остановить всё: пауза + сброс позиции для каждого играющего трека.
// Именованная функция (не только обработчик клика) — запуск пресета тоже
// сначала останавливает всё, см. Task 6. ──
function _audioLibStopAll() {
  document.querySelectorAll('[data-audio-el]').forEach(audioEl => {
    audioEl.pause();
    audioEl.currentTime = 0;
  });
  document.querySelectorAll('.audio-card [data-audio-play]').forEach(btn => {
    btn.textContent = '▶';
    btn.classList.remove('playing');
  });
}
document.getElementById('audio-lib-stop-all-btn')?.addEventListener('click', () => {
  _audioLibStopAll();
  _audioActivePresetId = null;
  _audioPresetRender();
});

let _audioPresetCache = null; // [{ id, name, locationSlug, locationTitle, locationImageUrl, tracks:[{trackId,volume,title,url}], createdAt }]
let _audioPresetLocations = null; // [{ slug, title }] — cached, loaded once per page visit
let _audioPresetEditingId = null; // null = creating a new preset; otherwise editing this preset's id

function _audioPresetTrackPickerRowHtml(t) {
  return `<label class="audio-preset-picker-row">
    <input type="checkbox" data-preset-pick-track value="${escAttr(t.id)}">
    <span class="audio-preset-picker-title">${escHtml(t.title)}</span>
    <input type="range" data-preset-pick-volume min="0" max="1" step="0.01" value="${t.volume}" disabled>
    <span class="audio-preset-picker-loop">
      <input type="checkbox" data-preset-pick-loop checked disabled>🔁
    </span>
  </label>`;
}

function _audioPresetRenderTrackPicker(checkedTracks = []) {
  const list = document.getElementById('audio-preset-track-list');
  list.innerHTML = (_audioLibCache || []).map(_audioPresetTrackPickerRowHtml).join('');
  checkedTracks.forEach(ct => {
    const row = list.querySelector(`input[data-preset-pick-track][value="${CSS.escape(ct.trackId)}"]`)?.closest('.audio-preset-picker-row');
    if (!row) return; // трек мог быть удалён из библиотеки — пропускаем в форме редактирования
    const checkbox = row.querySelector('[data-preset-pick-track]');
    const volume   = row.querySelector('[data-preset-pick-volume]');
    const loop     = row.querySelector('[data-preset-pick-loop]');
    checkbox.checked = true;
    volume.disabled  = false;
    volume.value     = ct.volume;
    loop.disabled    = false;
    loop.checked     = ct.loop !== false;
  });
}

document.getElementById('audio-preset-track-list')?.addEventListener('change', e => {
  const checkbox = e.target.closest('[data-preset-pick-track]');
  if (!checkbox) return;
  const row = checkbox.closest('.audio-preset-picker-row');
  row.querySelector('[data-preset-pick-volume]').disabled = !checkbox.checked;
  row.querySelector('[data-preset-pick-loop]').disabled = !checkbox.checked;
});

async function _audioPresetLoadLocationsOnce() {
  if (_audioPresetLocations) return _audioPresetLocations;
  try {
    _audioPresetLocations = await fetch('/api/locations' + window.location.search).then(r => r.json());
  } catch { _audioPresetLocations = []; }
  return _audioPresetLocations;
}

async function _audioPresetPopulateLocationSelect(selectedSlug = '') {
  const sel = document.getElementById('audio-preset-location');
  const locs = await _audioPresetLoadLocationsOnce();
  sel.innerHTML = '<option value="">— Без локации —</option>' +
    locs.map(loc => `<option value="${escAttr(loc.slug)}"${loc.slug === selectedSlug ? ' selected' : ''}>${escHtml(loc.title || loc.slug)}</option>`).join('');
}

const _audioPresetModal = document.getElementById('audio-preset-modal');

async function _audioPresetOpenModal(preset = null) {
  _audioPresetEditingId = preset ? preset.id : null;
  document.getElementById('audio-preset-modal-title').textContent = preset ? 'Редактировать пресет' : 'Создать пресет';
  document.getElementById('audio-preset-name').value = preset ? preset.name : '';
  document.getElementById('audio-preset-err').style.display = 'none';
  await _audioPresetPopulateLocationSelect(preset ? (preset.locationSlug || '') : '');
  _audioPresetRenderTrackPicker(preset ? preset.tracks : []);
  openModal('audio-preset-modal', '#audio-preset-name');
}

document.getElementById('audio-preset-create-btn')?.addEventListener('click', () => _audioPresetOpenModal(null));
document.getElementById('audio-preset-close')?.addEventListener('click', () => closeModal('audio-preset-modal'));
document.getElementById('audio-preset-cancel')?.addEventListener('click', () => closeModal('audio-preset-modal'));
_audioPresetModal?.addEventListener('click', e => { if (e.target === _audioPresetModal) closeModal('audio-preset-modal'); });

document.getElementById('audio-preset-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('audio-preset-err');
  errEl.style.display = 'none';

  const name = document.getElementById('audio-preset-name').value.trim();
  const locationSlug = document.getElementById('audio-preset-location').value || null;
  const tracks = Array.from(document.querySelectorAll('#audio-preset-track-list [data-preset-pick-track]:checked'))
    .map(cb => {
      const row = cb.closest('.audio-preset-picker-row');
      return {
        trackId: cb.value,
        volume: parseFloat(row.querySelector('[data-preset-pick-volume]').value),
        loop: row.querySelector('[data-preset-pick-loop]').checked,
      };
    });

  if (!name) { errEl.textContent = 'Укажите название'; errEl.style.display = ''; return; }
  if (!tracks.length) { errEl.textContent = 'Отметьте хотя бы один звук'; errEl.style.display = ''; return; }

  try {
    if (_audioPresetEditingId) {
      const updated = await apiFetch(`/api/audio/presets/${encodeURIComponent(_audioPresetEditingId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, locationSlug, tracks }),
      });
      const idx = _audioPresetCache.findIndex(p => p.id === updated.id);
      if (idx !== -1) _audioPresetCache[idx] = { ..._audioPresetCache[idx], ...updated };
    } else {
      await apiFetch('/api/audio/presets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, locationSlug, tracks }),
      });
    }
    await loadAudioPresets();
    closeModal('audio-preset-modal');
    showToast(_audioPresetEditingId ? 'Пресет обновлён' : 'Пресет создан', 'success');
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = '';
  }
});

let _audioActivePresetId = null;

function _audioPresetCardHtml(p) {
  const isActive = _audioActivePresetId === p.id;
  const hasBg = !!p.locationImageUrl;
  const bgHtml = hasBg
    ? `<img class="audio-preset-loc-bg" src="${escAttr(p.locationImageUrl)}" alt=""><div class="audio-preset-loc-scrim"></div>`
    : '';
  const locationHtml = p.locationTitle ? `<span class="audio-preset-loc-name">${escHtml(p.locationTitle)}</span>` : '';
  const tracksHtml = p.tracks.map(t => {
    const loopOn = t.loop !== false;
    return `
    <div class="audio-preset-track-row" data-preset-track-id="${escAttr(t.trackId)}">
      <span class="audio-preset-track-title">${escHtml(t.title)}</span>
      <input type="range" data-preset-track-volume min="0" max="1" step="0.01" value="${t.volume}">
      <button type="button" class="audio-preset-track-loop${loopOn ? ' active' : ''}" data-preset-track-loop aria-pressed="${loopOn}" aria-label="Зацикливание">🔁</button>
    </div>`;
  }).join('');
  return `<div class="audio-preset-card${hasBg ? ' has-bg' : ''}" data-preset-id="${escAttr(p.id)}">
    ${bgHtml}
    <div class="audio-preset-content">
      <div class="audio-card-title">${escHtml(p.name)}</div>
      ${locationHtml}
      <div class="audio-preset-tracks">${tracksHtml}</div>
      <div class="audio-card-row">
        <button type="button" class="audio-card-play-btn${isActive ? ' playing' : ''}" data-preset-play aria-label="Запустить/остановить пресет">${isActive ? '⏸' : '▶'}</button>
      </div>
      <div class="audio-card-actions">
        <button type="button" class="audio-card-icon-btn" data-preset-edit aria-label="Редактировать пресет">✎</button>
        <button type="button" class="audio-card-icon-btn" data-preset-delete aria-label="Удалить пресет">🗑</button>
      </div>
    </div>
  </div>`;
}

function _audioPresetRender() {
  const el = document.getElementById('audio-lib-presets-cards');
  if (!el) return;
  el.innerHTML = (_audioPresetCache && _audioPresetCache.length)
    ? _audioPresetCache.map(_audioPresetCardHtml).join('')
    : '<div class="loading-state">Пока нет пресетов.</div>';
}

async function loadAudioPresets() {
  try {
    _audioPresetCache = await apiFetch('/api/audio/presets');
  } catch (e) {
    showToast('Не удалось загрузить пресеты: ' + e.message, 'error');
    _audioPresetCache = [];
  }
  _audioPresetRender();
}

async function _audioPresetPlay(presetId) {
  const preset = (_audioPresetCache || []).find(p => p.id === presetId);
  if (!preset) return;
  _audioLibStopAll(); // сначала остановить всё — см. спеку
  for (const t of preset.tracks) {
    const card = document.querySelector(`.audio-card[data-audio-id="${CSS.escape(t.trackId)}"]`);
    if (!card) continue; // трек удалён из библиотеки — тихо пропускаем
    const audioEl = card.querySelector('[data-audio-el]');
    audioEl.volume = t.volume;
    audioEl.loop = t.loop !== false;
    try {
      await audioEl.play();
      const playBtn = card.querySelector('[data-audio-play]');
      playBtn.textContent = '⏸';
      playBtn.classList.add('playing');
    } catch (e) {
      showToast(`Не удалось запустить «${t.title}»: ` + e.message, 'error');
    }
  }
  _audioActivePresetId = presetId;
  _audioPresetRender();
}

function _audioPresetStop() {
  _audioLibStopAll();
  _audioActivePresetId = null;
  _audioPresetRender();
}

async function _audioPresetDelete(presetId) {
  const preset = (_audioPresetCache || []).find(p => p.id === presetId);
  if (!await showConfirm(`Удалить пресет «${preset?.name || ''}»?\nДействие необратимо.`, { danger: true, confirmText: 'Удалить' })) return;
  try {
    await apiFetch(`/api/audio/presets/${encodeURIComponent(presetId)}`, { method: 'DELETE' });
    if (_audioActivePresetId === presetId) _audioActivePresetId = null;
    _audioPresetCache = _audioPresetCache.filter(p => p.id !== presetId);
    _audioPresetRender();
  } catch (e) {
    showToast('Не удалось удалить пресет: ' + e.message, 'error');
  }
}

let _audioPresetVolumeTimers = {};
function _audioPresetDebouncedSaveTrackVolume(presetId, trackId, volume) {
  const key = presetId + ':' + trackId;
  clearTimeout(_audioPresetVolumeTimers[key]);
  _audioPresetVolumeTimers[key] = setTimeout(async () => {
    const preset = (_audioPresetCache || []).find(p => p.id === presetId);
    if (!preset) return;
    const tracks = preset.tracks.map(t => t.trackId === trackId
      ? { trackId: t.trackId, volume, loop: t.loop }
      : { trackId: t.trackId, volume: t.volume, loop: t.loop });
    try {
      await apiFetch(`/api/audio/presets/${encodeURIComponent(presetId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracks }),
      });
      const entry = preset.tracks.find(t => t.trackId === trackId);
      if (entry) entry.volume = volume;
    } catch (e) {
      showToast('Не удалось сохранить громкость пресета: ' + e.message, 'error');
    }
  }, 400);
}

// ── Делегирование кликов/ввода для карточек пресетов — тот же общий
// контейнер .audio-lib-columns, что и у карточек треков (см. Task 3). ──
document.querySelector('.audio-lib-columns')?.addEventListener('click', async e => {
  const playBtn = e.target.closest('[data-preset-play]');
  if (playBtn) {
    const presetId = playBtn.closest('.audio-preset-card').dataset.presetId;
    if (_audioActivePresetId === presetId) await _audioPresetStop();
    else await _audioPresetPlay(presetId);
    return;
  }
  const editBtn = e.target.closest('[data-preset-edit]');
  if (editBtn) {
    const presetId = editBtn.closest('.audio-preset-card').dataset.presetId;
    const preset = (_audioPresetCache || []).find(p => p.id === presetId);
    if (preset) await _audioPresetOpenModal(preset);
    return;
  }
  const deleteBtn = e.target.closest('[data-preset-delete]');
  if (deleteBtn) { await _audioPresetDelete(deleteBtn.closest('.audio-preset-card').dataset.presetId); return; }

  const trackLoopBtn = e.target.closest('[data-preset-track-loop]');
  if (trackLoopBtn) { await _audioPresetToggleTrackLoop(trackLoopBtn); return; }
});

async function _audioPresetToggleTrackLoop(btn) {
  const presetCard = btn.closest('.audio-preset-card');
  const presetId = presetCard.dataset.presetId;
  const trackId = btn.closest('[data-preset-track-id]').dataset.presetTrackId;
  const preset = (_audioPresetCache || []).find(p => p.id === presetId);
  if (!preset) return;
  const entry = preset.tracks.find(t => t.trackId === trackId);
  if (!entry) return;
  const next = !(entry.loop !== false);
  btn.classList.toggle('active', next);
  btn.setAttribute('aria-pressed', String(next));
  // Если пресет сейчас играет — применяем сразу к уже играющему треку.
  if (_audioActivePresetId === presetId) {
    const trackCard = document.querySelector(`.audio-card[data-audio-id="${CSS.escape(trackId)}"]`);
    const audioEl = trackCard?.querySelector('[data-audio-el]');
    if (audioEl) audioEl.loop = next;
  }
  const tracks = preset.tracks.map(t => t.trackId === trackId
    ? { trackId: t.trackId, volume: t.volume, loop: next }
    : { trackId: t.trackId, volume: t.volume, loop: t.loop });
  try {
    await apiFetch(`/api/audio/presets/${encodeURIComponent(presetId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracks }),
    });
    entry.loop = next;
  } catch (e) {
    showToast('Не удалось сохранить зацикливание: ' + e.message, 'error');
  }
}

document.querySelector('.audio-lib-columns')?.addEventListener('input', e => {
  const slider = e.target.closest('[data-preset-track-volume]');
  if (!slider) return;
  const presetCard = slider.closest('.audio-preset-card');
  const presetId   = presetCard.dataset.presetId;
  const trackId    = slider.closest('[data-preset-track-id]').dataset.presetTrackId;
  const volume     = parseFloat(slider.value);

  // Если этот пресет сейчас играет — громкость меняется вживую у уже играющего трека.
  if (_audioActivePresetId === presetId) {
    const trackCard = document.querySelector(`.audio-card[data-audio-id="${CSS.escape(trackId)}"]`);
    const audioEl = trackCard?.querySelector('[data-audio-el]');
    if (audioEl) audioEl.volume = volume;
  }
  _audioPresetDebouncedSaveTrackVolume(presetId, trackId, volume);
});

// ── Модалка загрузки ──
const _audioUploadModal = document.getElementById('audio-upload-modal');
document.getElementById('audio-lib-upload-btn')?.addEventListener('click', () => {
  document.getElementById('audio-upload-form').reset();
  document.getElementById('audio-upload-err').style.display = 'none';
  openModal('audio-upload-modal', '#audio-upload-title');
});
document.getElementById('audio-upload-close')?.addEventListener('click', () => closeModal('audio-upload-modal'));
document.getElementById('audio-upload-cancel')?.addEventListener('click', () => closeModal('audio-upload-modal'));
_audioUploadModal?.addEventListener('click', e => { if (e.target === _audioUploadModal) closeModal('audio-upload-modal'); });

const ALLOWED_AUDIO_MIME = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav'];
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

document.getElementById('audio-upload-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('audio-upload-err');
  errEl.style.display = 'none';

  const title = document.getElementById('audio-upload-title').value.trim();
  const file  = document.getElementById('audio-upload-file').files[0];
  const categoryInput = document.querySelector('input[name="audio-upload-category"]:checked');
  if (!title) { errEl.textContent = 'Укажите название'; errEl.style.display = ''; return; }
  if (!categoryInput) { errEl.textContent = 'Выберите категорию'; errEl.style.display = ''; return; }
  if (!file)  { errEl.textContent = 'Выберите файл'; errEl.style.display = ''; return; }
  if (!ALLOWED_AUDIO_MIME.includes(file.type)) {
    errEl.textContent = 'Неподдерживаемый формат (нужен mp3/ogg/wav)'; errEl.style.display = ''; return;
  }
  if (file.size > MAX_AUDIO_BYTES) {
    errEl.textContent = 'Файл больше 20МБ'; errEl.style.display = ''; return;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

  try {
    const created = await apiFetch('/api/audio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, filename: file.name, mimetype: file.type, data: base64, category: categoryInput.value }),
    });
    _audioLibCache.push(created);
    _audioLibRender();
    closeModal('audio-upload-modal');
    showToast('Звук загружен', 'success');
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = '';
  }
});
