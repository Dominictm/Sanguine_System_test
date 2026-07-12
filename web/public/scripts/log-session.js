// ═══════════════════════════════════════════════════════════════
// Log Session (Tools → Сессия)
// ═══════════════════════════════════════════════════════════════

let lsInited = false;
let lsPreviewState = null;   // { hash, payload } after a successful preview

function lsSceneRow() {
  const d = document.createElement('div');
  d.className = 'ls-row ls-scene-row';
  d.innerHTML = `
    <input class="form-control ls-scene-title" placeholder="Название сцены">
    <textarea class="form-control ls-scene-text" rows="1" placeholder="Что произошло"></textarea>
    <button class="ls-del" type="button" title="Убрать">✕</button>`;
  return d;
}
function lsPartRow() {
  const d = document.createElement('div');
  d.className = 'ls-part-row';
  d.innerHTML = `
    <div class="ls-row">
      <input class="form-control ls-part-name" list="ls-charnames" placeholder="Имя (из карточек)">
      <input class="form-control ls-part-role" placeholder="роль в сцене">
      <label class="ls-check"><input type="checkbox" class="ls-part-diary"> дневник</label>
      <label class="ls-check"><input type="checkbox" class="ls-part-pc"> ПК</label>
      <button class="ls-del" type="button" title="Убрать">✕</button>
    </div>
    <div class="ls-row ls-row-sub">
      <select class="form-control ls-part-lineage" title="линейка — если это новый НПС (создастся карточка)">
        <option value="">— существующий —</option>
        <option value="vampires">🧛 новый: Вампир</option>
        <option value="fairies">🧚 новый: Фея</option>
        <option value="mortals">🧑 новый: Смертный</option>
        <option value="werewolves">🐺 новый: Оборотень</option>
        <option value="mages">🔮 новый: Маг</option>
        <option value="hunters">🏹 новый: Охотник</option>
      </select>
      <input class="form-control ls-part-status" placeholder="смена статуса (опц.)">
      <input class="form-control ls-part-statusd" placeholder="детали статуса">
      <input class="form-control ls-part-comment" placeholder="коммент к дневнику (для генерации прозы)">
    </div>`;
  return d;
}
function lsThreadRow() {
  const d = document.createElement('div');
  d.className = 'ls-row ls-thread-row';
  d.innerHTML = `
    <input class="form-control ls-thread-title" placeholder="Заголовок нити">
    <input class="form-control ls-thread-desc" placeholder="Описание">
    <select class="form-control ls-thread-prio"><option>Высокий</option><option>Средний</option><option>Низкий</option></select>
    <button class="ls-del" type="button" title="Убрать">✕</button>`;
  return d;
}

async function lsInit() {
  if (lsInited) return;
  lsInited = true;

  await ensureCharsLoaded();
  document.getElementById('ls-charnames').innerHTML =
    (STATE.characters || []).map(c => `<option value="${escHtml(c.name)}">`).join('');
  try {
    const mods = await fetch('/api/modules').then(r => r.json());
    document.getElementById('ls-modules').innerHTML =
      (mods || []).map(m => `<option value="${escHtml(m.name)}">`).join('');
  } catch {}
  try {
    const chrs = await fetch('/api/chronicles').then(r => r.json());
    document.getElementById('ls-chron-slug').innerHTML =
      (chrs || []).map(c => `<option value="${escHtml(c.slug)}">${escHtml(c.display)}</option>`).join('');
  } catch {}

  // Chronicle picker is only relevant for a NEW module; toggle new-name vs existing-slug.
  const syncChron = () => {
    const modeNew  = document.getElementById('ls-mod-mode').value === 'new';
    const chronNew = document.getElementById('ls-chron-mode').value === 'new';
    document.getElementById('ls-chron-row').style.display = modeNew ? '' : 'none';
    document.getElementById('ls-chron-slug').parentElement.style.display = chronNew ? 'none' : '';
    document.getElementById('ls-chron-new').parentElement.style.display  = chronNew ? '' : 'none';
  };
  document.getElementById('ls-mod-mode').addEventListener('change', () => { syncChron(); lsInvalidate(); });
  document.getElementById('ls-chron-mode').addEventListener('change', () => { syncChron(); lsInvalidate(); });
  syncChron();

  document.getElementById('ls-scenes').appendChild(lsSceneRow());
  document.getElementById('ls-parts').appendChild(lsPartRow());

  document.getElementById('ls-add-scene').addEventListener('click', () => { document.getElementById('ls-scenes').appendChild(lsSceneRow()); lsInvalidate(); });
  document.getElementById('ls-add-part').addEventListener('click', () => { document.getElementById('ls-parts').appendChild(lsPartRow()); lsInvalidate(); });
  document.getElementById('ls-add-thread').addEventListener('click', () => { document.getElementById('ls-threads').appendChild(lsThreadRow()); lsInvalidate(); });

  const panel = document.getElementById('tab-log-session');
  panel.addEventListener('click', e => {
    const del = e.target.closest('.ls-del');
    if (del) { del.closest('.ls-scene-row, .ls-part-row, .ls-thread-row').remove(); lsInvalidate(); }
  });
  panel.addEventListener('input', lsInvalidate);

  document.getElementById('ls-finale').addEventListener('change', e => {
    document.getElementById('ls-finale-comment-wrap').style.display = e.target.checked ? '' : 'none';
  });

  document.getElementById('ls-preview').addEventListener('click', lsRunPreview);
  document.getElementById('ls-write').addEventListener('click', lsRunWrite);
}

function lsInvalidate() {
  lsPreviewState = null;
  const w = document.getElementById('ls-write');
  if (w) w.disabled = true;
}

function collectLsPayload() {
  const linesOf = s => (s || '').split('\n').map(x => x.trim()).filter(Boolean);
  const $ = id => document.getElementById(id);

  const scenes = [...document.querySelectorAll('.ls-scene-row')].map(r => ({
    title: r.querySelector('.ls-scene-title').value.trim(),
    text:  r.querySelector('.ls-scene-text').value.trim()
  })).filter(s => s.title || s.text);

  const participants = [...document.querySelectorAll('.ls-part-row')].map(r => ({
    name:          r.querySelector('.ls-part-name').value.trim(),
    role:          r.querySelector('.ls-part-role').value.trim(),
    diary:         r.querySelector('.ls-part-diary').checked,
    isPC:          r.querySelector('.ls-part-pc').checked,
    lineage:       r.querySelector('.ls-part-lineage').value || undefined,
    statusChange:  r.querySelector('.ls-part-status').value.trim() || null,
    statusDetails: r.querySelector('.ls-part-statusd').value.trim(),
    diaryComment:  r.querySelector('.ls-part-comment').value.trim()
  })).filter(p => p.name);

  const threadsNew = [...document.querySelectorAll('.ls-thread-row')].map(r => ({
    title:    r.querySelector('.ls-thread-title').value.trim(),
    desc:     r.querySelector('.ls-thread-desc').value.trim(),
    priority: r.querySelector('.ls-thread-prio').value
  })).filter(t => t.title);

  const close = ($('ls-close').value || '').split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
  const folder = $('ls-mod-name').value.trim();

  return {
    module: { mode: $('ls-mod-mode').value, newName: folder, folder, type: $('ls-mod-type').value },
    chronicle: { mode: $('ls-chron-mode').value, slug: $('ls-chron-slug').value, newName: $('ls-chron-new').value.trim() },
    event: {
      month: $('ls-month').value.trim(),
      dateLabel: $('ls-date').value.trim(),
      title: $('ls-title').value.trim(),
      locationLine: $('ls-location').value.trim(),
      parallel: $('ls-parallel').value.trim() || null,
      summary: $('ls-summary').value.trim(),
      scenes,
      consequences: linesOf($('ls-consequences').value),
      worldChanges: linesOf($('ls-world').value)
    },
    participants,
    threads: { new: threadsNew, close },
    finale: { create: $('ls-finale').checked, comment: $('ls-finale-comment').value.trim() }
  };
}

const LS_ACTION_LABEL = { create: '＋ создать', modify: '✎ изменить' };

function renderLsChanges(changes, withPreview) {
  return `<div class="ls-changes">${changes.map(c => `
    <div class="ls-change">
      <span class="ls-change-act act-${c.action}">${LS_ACTION_LABEL[c.action] || c.action}</span>
      <span class="ls-change-rel">${escHtml(c.rel)}</span>
      ${withPreview && c.preview ? `<span class="ls-change-prev">${escHtml(c.preview)}</span>` : ''}
    </div>`).join('')}</div>`;
}

async function lsRunPreview() {
  const payload = collectLsPayload();
  payload.dryRun = true;
  const res = document.getElementById('ls-result');
  res.innerHTML = SPINNER;
  let j;
  try {
    j = await fetch('/api/log-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json());
  } catch { res.innerHTML = '<div class="ls-err">⚠ Сервер недоступен</div>'; return; }

  if (!j.ok) {
    lsInvalidate();
    res.innerHTML = `<div class="ls-err"><b>Нельзя записать:</b><ul>${(j.errors || []).map(e => `<li>${escHtml(e)}</li>`).join('')}</ul></div>`;
    return;
  }

  lsPreviewState = { hash: j.previewHash, payload };
  document.getElementById('ls-write').disabled = false;

  const s = j.summary || {};
  res.innerHTML = `
    <div class="ls-preview-head">
      <span class="ls-badge">ПРЕДПРОСМОТР</span>
      Модуль <b>${escHtml(s.module || '')}</b>${s.moduleNew ? ' (новый)' : ''} ·
      участников: ${s.participants} · дневников: ${s.diaries} · финал: ${s.finale ? 'да' : 'нет'}
    </div>
    ${renderLsChanges(j.changes || [], true)}
    ${(j.warnings || []).length ? `<div class="ls-warn">⚠ ${j.warnings.map(escHtml).join('<br>⚠ ')}</div>` : ''}
    ${(j.notes || []).length ? `<div class="ls-note">ℹ ${j.notes.map(escHtml).join('<br>ℹ ')}</div>` : ''}
    ${(j.stubs || []).length ? `<div class="ls-stubs"><b>Stub'ы для прозы Claude:</b><ul>${j.stubs.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="ls-hint-confirm">Проверьте план и нажмите «Записать».</div>`;
}

async function lsRunWrite() {
  if (!lsPreviewState) return;
  const res  = document.getElementById('ls-result');
  const wbtn = document.getElementById('ls-write');
  wbtn.disabled = true; wbtn.textContent = '⏳ Запись...';
  let j;
  try {
    j = await fetch('/api/log-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lsPreviewState.payload, dryRun: false, previewHash: lsPreviewState.hash })
    }).then(r => r.json());
  } catch { res.innerHTML = '<div class="ls-err">⚠ Сервер недоступен</div>'; wbtn.textContent = 'Записать'; return; }
  wbtn.textContent = 'Записать';

  if (!j.ok) {
    lsInvalidate();
    res.innerHTML = `<div class="ls-err"><b>Не записано:</b><ul>${(j.errors || []).map(e => `<li>${escHtml(e)}</li>`).join('')}</ul>Повторите предпросмотр.</div>`;
    return;
  }

  // refresh caches so other pages reflect new data
  STATE.characters = [];
  STATE.chronicle = null;
  STATE.locations = [];
  STATE.graph.inited = false;
  lsPreviewState = null;

  res.innerHTML = `
    <div class="ls-ok-head">✓ Записано — ${(j.written || []).length} файлов</div>
    ${renderLsChanges(j.written || [], false)}
    ${(j.stubs || []).length ? `
      <div class="ls-stubs">
        <b>Проза дневников и финала — stub'ы:</b>
        <ul>${j.stubs.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>
        <div id="ls-prose-zone"></div>
      </div>` : ''}
    ${(j.notes || []).length ? `<div class="ls-note">ℹ ${j.notes.map(escHtml).join('<br>ℹ ')}</div>` : ''}`;

  lsSetupProseZone(j.stubs || []);
}

// Render the prose-generation control (gated on Claude CLI availability)
async function lsSetupProseZone(stubs) {
  const zone = document.getElementById('ls-prose-zone');
  if (!zone || !stubs.length) return;

  const featPrefs   = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const _prosePref  = _getPref(featPrefs, 'prose', 'claude');
  const proseSrc    = _prosePref.provider;
  const isOpenAI    = proseSrc === 'openai';
  const useApi      = proseSrc === 'openrouter' || isOpenAI;   // API-style (single call) vs Claude CLI

  let claudeAvail = false;
  if (!useApi) { try { claudeAvail = (await fetch('/api/claude/health').then(r => r.json())).available; } catch {} }

  const claudeNote = claudeAvail
    ? `Дешевле — Sonnet/Haiku, качественнее — Opus.`
    : `<span style="color:var(--accent2)">Claude CLI не найден.</span>`;
  const apiBtnLabel = isOpenAI ? '🤖 Сгенерировать прозу (GPT)' : '🌐 Сгенерировать прозу (OpenRouter)';

  zone.innerHTML = `
    <div class="ls-prose-controls">
      ${useApi ? '' : `<select class="form-control ls-prose-model" id="ls-prose-model">
        <option value="">Модель: по умолчанию</option>
        <option value="opus">Opus — лучшее качество</option>
        <option value="sonnet">Sonnet — баланс</option>
        <option value="haiku">Haiku — быстро</option>
      </select>`}
      ${useApi
        ? `<button class="btn-submit btn-genprose btn-genprose-or" id="ls-genprose" type="button">${apiBtnLabel}</button>`
        : `<button class="btn-submit btn-genprose" id="ls-genprose" type="button" ${claudeAvail ? '' : 'disabled'}>🪄 Сгенерировать прозу (Claude)</button>`
      }
    </div>
    <div class="ls-prose-note">${useApi
      ? `${isOpenAI ? 'GPT' : 'OpenRouter'} читает правила дневников, карточки персонажей и события хроники автоматически. Модель — из «Назначение провайдеров».`
      : claudeNote
    } Настроить: <a class="dash-ai-link" data-nav="tools" data-tab="ai-settings">Модели AI ↗</a></div>
    <div class="ls-prose-result" id="ls-prose-result"></div>`;
  document.getElementById('ls-genprose').addEventListener('click', () => lsGenProse(stubs, proseSrc));
}

async function lsGenProse(stubs, source = 'claude') {
  const btn      = document.getElementById('ls-genprose');
  const out      = document.getElementById('ls-prose-result');
  const isOpenAI = source === 'openai';
  const useApi   = source === 'openrouter' || isOpenAI;   // API-style (single call) vs Claude CLI
  const qs       = window.location.search;
  const apiBtnLabel = isOpenAI ? '🤖 Сгенерировать прозу (GPT)' : '🌐 Сгенерировать прозу (OpenRouter)';

  // Claude model from prose-model select (if visible)
  const claudeModelEl = document.getElementById('ls-prose-model');
  const claudeModel   = claudeModelEl?.value || '';

  // API model from saved prefs (OpenRouter or OpenAI list)
  const _fp     = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const apiModel = _getPref(_fp, 'prose', 'openrouter').model || null;

  btn.disabled = true;
  btn.textContent = useApi ? `⏳ ${isOpenAI ? 'GPT' : 'OpenRouter'} пишет прозу…` : '⏳ Claude пишет прозу…';
  out.innerHTML = `<div class="ls-note">Идёт генерация — не закрывайте вкладку…</div>`;

  let j;
  try {
    const endpoint = useApi ? '/api/openrouter/generate-prose' : '/api/claude/generate-prose';
    j = await fetch(endpoint + qs, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stubs, model: useApi ? apiModel : claudeModel, source: isOpenAI ? 'openai' : 'openrouter' })
    }).then(r => r.json());
  } catch (e) {
    out.innerHTML = `<div class="ls-err">⚠ ${escHtml(e.message)}</div>`;
    btn.disabled = false; btn.textContent = useApi ? apiBtnLabel : '🪄 Сгенерировать прозу (Claude)';
    return;
  }

  if (!j.ok && !(j.written || []).length) {
    out.innerHTML = `<div class="ls-err">⚠ ${escHtml(j.error || 'Не удалось сгенерировать прозу')}</div>`;
    btn.disabled = false; btn.textContent = useApi ? apiBtnLabel : '🪄 Сгенерировать прозу (Claude)';
    return;
  }

  STATE.characters = []; STATE.chronicle = null; STATE.graph.inited = false;
  btn.textContent = '✓ Готово';
  out.innerHTML = `
    <div class="ls-ok-head">✓ Проза записана${j.cost != null ? ` · $${Number(j.cost).toFixed(3)}` : ''}</div>
    <div class="ls-changes">${(j.written || []).map(s =>
      `<div class="ls-change"><span class="ls-change-act act-modify">✎ проза</span><span class="ls-change-rel">${escHtml(s)}</span></div>`).join('')}</div>
    ${(j.pending || []).length ? `<div class="ls-warn">⚠ Без прозы остались: ${j.pending.map(escHtml).join(', ')}</div>` : ''}
    <div class="ls-note">Проверьте <b>git diff</b> перед коммитом.</div>`;
}

// Lazy-init the Log Session form when its tab is first opened
document.querySelector('.tab-btn[data-tab="log-session"]').addEventListener('click', lsInit);

