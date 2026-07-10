'use strict';
// Звуковая библиотека (саундборд) — карточки-плееры, играющие одновременно.
// Загружается один раз (см. index.html), рендерится при заходе на страницу
// (navigate() в scripts.js), см. docs/superpowers/specs/2026-07-10-audio-library-design.md.

let _audioLibCache = null; // [{ id, ext, filename, title, volume, loop, createdAt, url }]

function _audioLibCardHtml(t) {
  // Записи, загруженные до появления поля loop, ещё не имеют его в index.json —
  // трактуем как включённое (прежнее жёстко зашитое поведение), а не как выключенное.
  const loopOn = t.loop !== false;
  return `<div class="audio-card" data-audio-id="${escAttr(t.id)}">
    <div class="audio-card-title" data-audio-title-view>${escHtml(t.title)}</div>
    <audio data-audio-el src="${escAttr(t.url)}" ${loopOn ? 'loop' : ''} preload="none"></audio>
    <div class="audio-card-row">
      <button type="button" class="audio-card-play-btn" data-audio-play aria-label="Играть/пауза">▶</button>
      <input type="range" class="audio-card-volume" data-audio-volume min="0" max="1" step="0.01" value="${t.volume}">
    </div>
    <div class="audio-card-actions">
      <button type="button" class="audio-card-icon-btn${loopOn ? ' active' : ''}" data-audio-loop aria-pressed="${loopOn}" aria-label="Зацикливание">🔁</button>
      <button type="button" class="audio-card-icon-btn" data-audio-rename aria-label="Переименовать">✎</button>
      <button type="button" class="audio-card-icon-btn" data-audio-delete aria-label="Удалить">🗑</button>
    </div>
  </div>`;
}

function _audioLibRender() {
  const grid = document.getElementById('audio-lib-grid');
  if (!grid) return;
  if (!_audioLibCache.length) {
    grid.innerHTML = '<div class="loading-state">Библиотека пуста — загрузите первый звук.</div>';
    return;
  }
  grid.innerHTML = _audioLibCache.map(_audioLibCardHtml).join('');
}

async function loadAudioLibrary() {
  const grid = document.getElementById('audio-lib-grid');
  if (grid) grid.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  try {
    _audioLibCache = await apiFetch('/api/audio');
  } catch (e) {
    showToast('Не удалось загрузить звуковую библиотеку: ' + e.message, 'error');
    _audioLibCache = [];
  }
  _audioLibRender();
}

// ── Play/pause + громкость (делегирование на контейнере, привязано один раз) ──
document.getElementById('audio-lib-grid')?.addEventListener('click', async e => {
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

document.getElementById('audio-lib-grid')?.addEventListener('input', e => {
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

// ── Остановить всё: пауза + сброс позиции для каждого играющего трека ──
document.getElementById('audio-lib-stop-all-btn')?.addEventListener('click', () => {
  document.querySelectorAll('#audio-lib-grid [data-audio-el]').forEach(audioEl => {
    audioEl.pause();
    audioEl.currentTime = 0;
  });
  document.querySelectorAll('#audio-lib-grid [data-audio-play]').forEach(btn => {
    btn.textContent = '▶';
    btn.classList.remove('playing');
  });
});

// ── Модалка загрузки ──
const _audioUploadModal = document.getElementById('audio-upload-modal');
document.getElementById('audio-lib-upload-btn')?.addEventListener('click', () => {
  document.getElementById('audio-upload-form').reset();
  document.getElementById('audio-upload-err').style.display = 'none';
  _audioUploadModal.classList.add('open');
});
document.getElementById('audio-upload-close')?.addEventListener('click', () => _audioUploadModal.classList.remove('open'));
document.getElementById('audio-upload-cancel')?.addEventListener('click', () => _audioUploadModal.classList.remove('open'));
_audioUploadModal?.addEventListener('click', e => { if (e.target === _audioUploadModal) _audioUploadModal.classList.remove('open'); });

const ALLOWED_AUDIO_MIME = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav'];
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

document.getElementById('audio-upload-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('audio-upload-err');
  errEl.style.display = 'none';

  const title = document.getElementById('audio-upload-title').value.trim();
  const file  = document.getElementById('audio-upload-file').files[0];
  if (!title) { errEl.textContent = 'Укажите название'; errEl.style.display = ''; return; }
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
      body: JSON.stringify({ title, filename: file.name, mimetype: file.type, data: base64 }),
    });
    _audioLibCache.push(created);
    _audioLibRender();
    _audioUploadModal.classList.remove('open');
    showToast('Звук загружен', 'success');
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = '';
  }
});
