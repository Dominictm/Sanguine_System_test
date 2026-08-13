'use strict';
// Инструменты → Бэкап: список городов с размером на диске, создание архива города(ов)
// (фоновая задача с опросом статуса — Compress-Archive на Париже занимает больше 30с),
// отдельный архив настроек (.env/ключи), восстановление в два шага (inspect → commit).
// docs/design/2026-08-13-backup-tab-design.md.

let _backupLoaded = false;
async function loadBackupTab() {
  if (_backupLoaded) return;
  _backupLoaded = true;
  const el = document.getElementById('backup-content');
  try {
    const data = await fetch('/api/backup/cities-info').then(r => r.json());
    el.innerHTML = renderBackupPanel(data.cities || []);
    wireBackupHandlers();
  } catch {
    _backupLoaded = false;
    el.innerHTML = `<div class="cdet-empty">Не удалось загрузить список городов.</div>`;
  }
}

function renderBackupPanel(cities) {
  const rows = cities.map(c => `
    <label class="bkp-city-row">
      <input type="checkbox" class="bkp-city-cb" value="${escAttr(c.slug)}">
      <span class="bkp-city-name">${escHtml(c.display)}</span>
      <span class="bkp-city-size">${c.sizeMb} МБ</span>
    </label>`).join('');

  return `
    <div class="ls-section">
      <div class="ls-sec-title">💾 Города</div>
      <label class="bkp-city-row bkp-city-row--all">
        <input type="checkbox" id="bkp-select-all">
        <span class="bkp-city-name">Выбрать все</span>
      </label>
      <div class="bkp-city-list">${rows || '<div class="form-hint">Городов не найдено.</div>'}</div>
      <button class="btn-submit" id="bkp-create-btn" disabled>Создать бэкап</button>
      <div class="bkp-progress" id="bkp-progress" hidden></div>
    </div>

    <div class="ls-section">
      <div class="ls-sec-title">⚙ Настройки</div>
      <p class="form-hint" style="font-style:normal;margin-bottom:14px">
        Ключи AI-провайдеров и назначения генераций — отдельным архивом, без данных городов.
      </p>
      <div class="bkp-settings-warn">⚠ Архив содержит ключи AI в открытом виде — не пересылайте его.</div>
      <button class="btn-submit btn-secondary" id="bkp-settings-btn">Сохранить настройки</button>
    </div>

    <div class="ls-section bkp-danger-zone">
      <div class="ls-sec-title bkp-danger-title">⚠ Восстановление из бэкапа</div>
      <p class="form-hint" style="font-style:normal">
        Заменит данные выбранного города текущей версией из архива. Перед заменой старая
        версия переносится в «Удалённые» — её можно вернуть вручную, но не автоматически.
      </p>
      <input type="file" id="bkp-restore-input" accept=".zip" hidden>
      <button class="btn-submit bkp-restore-btn" id="bkp-restore-trigger">Загрузить бэкап…</button>
    </div>
  `;
}

function wireBackupHandlers() {
  const selectAll = document.getElementById('bkp-select-all');
  const cbs = () => Array.from(document.querySelectorAll('.bkp-city-cb'));
  const createBtn = document.getElementById('bkp-create-btn');

  const syncFromItems = () => {
    const all = cbs();
    const checkedCount = all.filter(cb => cb.checked).length;
    selectAll.checked = all.length > 0 && checkedCount === all.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < all.length;
    createBtn.disabled = checkedCount === 0;
  };

  selectAll.addEventListener('change', () => {
    cbs().forEach(cb => { cb.checked = selectAll.checked; });
    syncFromItems();
  });
  cbs().forEach(cb => cb.addEventListener('change', syncFromItems));

  createBtn.addEventListener('click', () => {
    const slugs = cbs().filter(cb => cb.checked).map(cb => cb.value);
    if (slugs.length) runBackupJob(slugs);
  });

  document.getElementById('bkp-settings-btn').addEventListener('click', runSettingsBackup);

  const restoreInput = document.getElementById('bkp-restore-input');
  document.getElementById('bkp-restore-trigger').addEventListener('click', () => restoreInput.click());
  restoreInput.addEventListener('change', () => {
    const file = restoreInput.files[0];
    restoreInput.value = ''; // тот же файл можно будет выбрать повторно после отмены
    if (file) runRestoreInspect(file);
  });
}

// ── Скачивание: системный диалог «Сохранить как», если доступен ────────────────
// Отмена диалога НЕ должна тихо откатываться на обычное автоскачивание — пользователь
// явно передумал, а не столкнулся с ошибкой. Вызывающий код в этом случае просто
// оставляет кнопку «Сохранить файл» на месте для повторной попытки.
async function saveResponseAsFile(resp, suggestedName) {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }],
      });
      const writable = await handle.createWritable();
      await resp.body.pipeTo(writable);
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      // Любая другая ошибка File System Access — падаем на обычное скачивание ниже.
    }
  }
  const blob = await resp.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  return true;
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Создание бэкапа города(ов) — фоновая задача с опросом статуса ──────────────
async function runBackupJob(slugs) {
  const createBtn = document.getElementById('bkp-create-btn');
  const progress  = document.getElementById('bkp-progress');
  createBtn.disabled = true;
  createBtn.textContent = 'Архивирую…';
  progress.hidden = false;

  let jobId;
  try {
    const start = await fetch('/api/backup/city', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    }).then(r => r.json());
    if (!start.id) throw new Error(start.error || 'Не удалось запустить архивацию');
    jobId = start.id;
  } catch (e) {
    createBtn.disabled = false;
    createBtn.textContent = 'Создать бэкап';
    progress.hidden = true;
    showToast('Ошибка: ' + e.message, 'error');
    return;
  }

  const startedAt = Date.now();
  progress.innerHTML = `<div class="spinner"></div><span>Архивирую… <span id="bkp-elapsed">0:00</span></span>`;
  const tick = setInterval(() => {
    const el = document.getElementById('bkp-elapsed');
    if (el) el.textContent = formatElapsed(Date.now() - startedAt);
  }, 1000);

  const poll = async () => {
    let job;
    try {
      job = await fetch(`/api/backup/job/${jobId}`).then(r => r.json());
    } catch {
      setTimeout(poll, 2000);
      return;
    }
    if (job.status === 'running') { setTimeout(poll, 1500); return; }
    clearInterval(tick);
    createBtn.disabled = false;
    createBtn.textContent = 'Создать бэкап';

    if (job.status === 'error') {
      progress.hidden = true;
      showToast('Ошибка архивации: ' + (job.error || 'неизвестная ошибка'), 'error');
      return;
    }

    // Готово: не скачиваем автоматически — showSaveFilePicker() требует явного
    // клика пользователя (жест), плюс отдельная кнопка позволяет повторить
    // сохранение, если пользователь отменит системный диалог.
    progress.innerHTML = `<span style="color:var(--c-success)">✓ Готово (${job.fileName})</span> `;
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-submit btn-secondary';
    saveBtn.style.marginLeft = '10px';
    saveBtn.textContent = 'Сохранить файл';
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const resp = await fetch(`/api/backup/job/${jobId}/download`);
        if (!resp.ok) throw new Error('файл недоступен');
        await saveResponseAsFile(resp, job.fileName);
      } catch (e) {
        showToast('Ошибка скачивания: ' + e.message, 'error');
      } finally {
        saveBtn.disabled = false;
      }
    };
    progress.appendChild(saveBtn);
  };
  poll();
}

// ── Бэкап настроек — синхронный, без опроса задачи ──────────────────────────────
async function runSettingsBackup() {
  const btn = document.getElementById('bkp-settings-btn');
  btn.disabled = true;
  const prevText = btn.textContent;
  btn.textContent = 'Сохраняю…';
  try {
    const aiFeaturePrefs = localStorage.getItem('ai-feature-prefs') || '{}';
    const resp = await fetch('/api/backup/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiFeaturePrefs }),
    });
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      throw new Error(d.error || 'не удалось собрать архив настроек');
    }
    const disp = resp.headers.get('Content-Disposition') || '';
    const nameMatch = disp.match(/filename="([^"]+)"/);
    const fileName = nameMatch ? nameMatch[1] : `VTM-settings-${Date.now()}.zip`;
    await saveResponseAsFile(resp, fileName);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

// ── Восстановление, шаг 1: отправить файл, показать сводку ─────────────────────
async function runRestoreInspect(file) {
  const trigger = document.getElementById('bkp-restore-trigger');
  trigger.disabled = true;
  const prevText = trigger.textContent;
  trigger.textContent = 'Проверяю архив…';
  try {
    const resp = await fetch('/api/backup/restore/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'не удалось разобрать архив');
    openRestoreConfirm(data.inspectId, data.summary);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    trigger.disabled = false;
    trigger.textContent = prevText;
  }
}

// ── Восстановление, шаг 2: модалка сводки + подтверждение ──────────────────────
function openRestoreConfirm(inspectId, summary) {
  const itemsEl = document.getElementById('bkp-restore-items');
  itemsEl.innerHTML = summary.map(it => `
    <div class="bkp-restore-item">
      <span class="bkp-restore-item-name">${escHtml(it.display)}</span>
      <span class="bkp-restore-item-meta">${it.sizeMb} МБ · ${it.fileCount} файлов</span>
      <span class="bkp-restore-badge ${it.exists ? 'bkp-restore-badge--replace' : 'bkp-restore-badge--new'}">${it.exists ? 'заменит текущий' : 'новый город'}</span>
    </div>`).join('');

  const unlockCheck = document.getElementById('bkp-restore-unlock-check');
  const confirmBtn  = document.getElementById('bkp-restore-confirm-btn');
  unlockCheck.checked = false;
  confirmBtn.disabled = true;
  unlockCheck.onchange = () => { confirmBtn.disabled = !unlockCheck.checked; };

  document.getElementById('bkp-restore-cancel-btn').onclick = () => closeModal('bkp-restore-modal');

  confirmBtn.onclick = async () => {
    closeModal('bkp-restore-modal');
    try {
      const resp = await fetch('/api/backup/restore/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectId }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'восстановление не удалось');
      showToast('Восстановление завершено', 'success');
      _backupLoaded = false;
      loadBackupTab();
    } catch (e) {
      showToast('Ошибка восстановления: ' + e.message, 'error');
    }
  };

  openModal('bkp-restore-modal');
}

document.getElementById('bkp-restore-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('bkp-restore-modal')) closeModal('bkp-restore-modal');
});
