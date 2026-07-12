// ═══════════════════════════════════════════════════════════════
// Global Search
// ═══════════════════════════════════════════════════════════════

function loadSearch() {
  const inp = document.getElementById('srch-input');
  if (inp && !inp.dataset.inited) {
    inp.dataset.inited = '1';
    let _debTimer = null;
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { clearTimeout(_debTimer); _runSearch(); }
    });
    inp.addEventListener('input', () => {
      clearTimeout(_debTimer);
      _debTimer = setTimeout(_runSearch, 420);
    });
    document.getElementById('srch-btn').addEventListener('click', _runSearch);
  }
  if (inp) inp.focus();
}

async function _runSearch() {
  const inp = document.getElementById('srch-input');
  const resultsEl = document.getElementById('srch-results');
  const subEl = document.getElementById('search-global-sub');
  const q = (inp?.value || '').trim();
  if (q.length < 3) {
    resultsEl.innerHTML = '<div class="srch-hint">Введи запрос — минимум 3 символа</div>';
    if (subEl) subEl.textContent = '';
    return;
  }
  resultsEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Поиск…</div>';
  try {
    const data = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json());
    _renderSearchResults(data, resultsEl, subEl);
  } catch (e) {
    resultsEl.innerHTML = `<div class="srch-hint">⚠ Ошибка: ${escHtml(e.message)}</div>`;
  }
}

function _renderSearchResults(data, el, subEl) {
  if (!data.results || data.total === 0) {
    el.innerHTML = `<div class="srch-hint">Ничего не найдено по запросу «${escHtml(data.query)}»</div>`;
    if (subEl) subEl.textContent = '';
    return;
  }
  if (subEl) subEl.textContent = `${data.total} результ.`;
  const hl = (txt) => {
    if (!txt) return '';
    const q = escHtml(data.query);
    return escHtml(txt).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      m => `<mark class="srch-hl">${m}</mark>`);
  };

  const sections = [];

  if ((data.results.characters || []).length) {
    const rows = data.results.characters.map(c => `
      <div class="srch-row srch-char" data-name="${escHtml(c.name)}">
        <div class="srch-row-icon">🎭</div>
        <div class="srch-row-body">
          <div class="srch-row-title">${hl(c.name)} <span class="srch-row-tag">${escHtml(c.lineage)}</span></div>
          <div class="srch-row-excerpt">${hl(c.excerpt)}</div>
        </div>
        <button class="srch-open-btn">Открыть →</button>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">🎭 Персонажи <span class="srch-sec-count">${data.results.characters.length}</span></div>${rows}</div>`);
  }

  if ((data.results.locations || []).length) {
    const rows = data.results.locations.map(l => `
      <div class="srch-row srch-loc" data-slug="${escHtml(l.slug)}">
        <div class="srch-row-icon">📍</div>
        <div class="srch-row-body">
          <div class="srch-row-title">${hl(l.name)}</div>
          <div class="srch-row-excerpt">${hl(l.excerpt)}</div>
        </div>
        <button class="srch-open-btn">Открыть →</button>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">📍 Локации <span class="srch-sec-count">${data.results.locations.length}</span></div>${rows}</div>`);
  }

  if ((data.results.modules || []).length) {
    const rows = data.results.modules.map(m => `
      <div class="srch-row srch-mod" data-chr="${escHtml(m.chronicle)}" data-mod="${escHtml(m.module)}">
        <div class="srch-row-icon">📖</div>
        <div class="srch-row-body">
          <div class="srch-row-title">${hl(m.title)} <span class="srch-row-tag">${escHtml(m.chronicleDisplay || m.chronicle)}</span></div>
          <div class="srch-row-excerpt">${hl(m.excerpt)}</div>
        </div>
        <button class="srch-open-btn">Открыть →</button>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">📖 Модули <span class="srch-sec-count">${data.results.modules.length}</span></div>${rows}</div>`);
  }

  if ((data.results.events || []).length) {
    const rows = data.results.events.map(e => `
      <div class="srch-row">
        <div class="srch-row-icon">📅</div>
        <div class="srch-row-body">
          <div class="srch-row-title"><span class="srch-row-tag">${escHtml(e.chronicleDisplay || e.chronicle)}</span></div>
          <div class="srch-row-excerpt">${hl(e.excerpt)}</div>
        </div>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">📅 События <span class="srch-sec-count">${data.results.events.length}</span></div>${rows}</div>`);
  }

  if ((data.results.archive || []).length) {
    const rows = data.results.archive.map(a => `
      <div class="srch-row">
        <div class="srch-row-icon">📜</div>
        <div class="srch-row-body">
          <div class="srch-row-title">${escHtml(a.label)}</div>
          <div class="srch-row-excerpt">${hl(a.excerpt)}</div>
        </div>
      </div>`).join('');
    sections.push(`<div class="srch-section"><div class="srch-sec-title">📜 Архив <span class="srch-sec-count">${data.results.archive.length}</span></div>${rows}</div>`);
  }

  el.innerHTML = sections.join('');

  // Click handlers
  el.querySelectorAll('.srch-char').forEach(row => {
    row.querySelector('.srch-open-btn')?.addEventListener('click', () => {
      ensureCharsLoaded().then(() => openCharDetail(row.dataset.name));
    });
  });
  el.querySelectorAll('.srch-loc').forEach(row => {
    row.querySelector('.srch-open-btn')?.addEventListener('click', () => {
      ensureLocsLoaded().then(() => openLocDetail(row.dataset.slug));
    });
  });
  el.querySelectorAll('.srch-mod').forEach(row => {
    row.querySelector('.srch-open-btn')?.addEventListener('click', () => {
      openModulePage(row.dataset.chr, row.dataset.mod);
    });
  });
}

