// ═══════════════════════════════════════════════════════════════
// Cities grid (Tools → «Домены»)
// ═══════════════════════════════════════════════════════════════

function renderCityCard(c) {
  const active = c.slug === CITY;
  const meta = [
    c.year       ? `<span class="chp-meta-item">📅 ${escHtml(c.year)}</span>` : '',
    c.characters ? `<span class="chp-meta-item">🎭 ${c.characters} персонажей</span>` : '',
    c.modules    ? `<span class="chp-meta-item">📖 ${c.modules} модулей</span>` : '',
    c.locations  ? `<span class="chp-meta-item">📍 ${c.locations} локаций</span>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="city-card" data-slug="${escHtml(c.slug)}" title="Подробнее о городе">
      <div class="chp-card-header">
        <div class="chp-card-name">${escHtml(c.display)}</div>
        ${active ? '<span class="chp-status chp-status-active">Активен</span>' : ''}
      </div>
      ${meta ? `<div class="chp-card-meta">${meta}</div>` : ''}
    </div>`;
}

async function loadCitiesGrid() {
  // Ленивый инжект редактора «Фракции» в форму создания (один раз).
  if (_cityFactionsCreateHost && !_cityFactionsCreateHost.dataset.ready) {
    _cityFactionsCreateHost.innerHTML = _cityFactionsEditorHtml({ factions: '' });
    _cityFactionsCreateHost.dataset.ready = '1';
  }
  const el = document.getElementById('cities-grid');
  if (!el) return;
  el.innerHTML = SPINNER;
  try {
    const cities = await fetch('/api/cities/summary').then(r => r.json());
    if (!Array.isArray(cities) || !cities.length) {
      el.innerHTML = '<div class="loading-state" style="height:120px">Городов пока нет — создайте первый ниже</div>';
      return;
    }
    el.innerHTML = `<div class="chp-grid">${cities.map(renderCityCard).join('')}</div>`;
  } catch {
    el.innerHTML = '<div class="loading-state" style="color:var(--accent3)">⚠ Не удалось загрузить</div>';
  }
}

document.getElementById('cities-grid')?.addEventListener('click', e => {
  const card = e.target.closest('.city-card');
  if (!card) return;
  openCityDetail(card.dataset.slug);
});

// ═══════════════════════════════════════════════════════════════
// City Detail Modal
// ═══════════════════════════════════════════════════════════════

// Канонические секции city.md — зеркало CITY_SECTIONS в web/lib/parsers.js.
const CITY_SECTION_DEFS = [
  ['political',  'Политический ландшафт'],
  ['factions',   'Фракции'],
  ['districts',  'Районы'],
  ['landmarks',  'Значимые места'],
  ['locations',  'Ключевые локации'],
  ['hunting',    'Охотничьи угодья'],
  ['edicts',     'Законы домена'],
  ['mortals',    'Смертные институции'],
  ['calendar',   'Календарь города'],
  ['tech',       'Технологии и Маскарад'],
  ['limits',     'Ограничения генерации'],
  ['naming',     'Именник и фактура'],
  ['leitmotif',  'Лейтмотивы и атмосфера'],
  ['specifics',  'Специфика ответа'],
  ['avoid',      'Чего избегать'],
  ['sources',    'Источники'],
];
// Секты и независимые кланы V20 (system/rules/reference_wod.md) — варианты для
// мультиселекта секции «Фракции». Независимые — канонические 4 клана V20
// (Каппадокийцы — вымерший/Dark Ages клан, в набор не входят).
const CITY_SECTS = ['Камарилья', 'Анархи', 'Шабаш'];
const CITY_INDEPENDENT_CLANS = ['Ассамиты', 'Следующие Луны', 'Джованни', 'Равнос'];
let _cityDetail = null;  // { slug, cityMd, parsed, characters, modules, locations, active }

// У города есть секции вне стандартного набора (рукописный city.md, как у Парижа)?
function _cityHasCustomSections(cityMd) {
  const known = new Set(CITY_SECTION_DEFS.map(([, h]) => h.toLowerCase()));
  const headings = [...String(cityMd).matchAll(/^##\s+(.+?)\s*$/gm)].map(m => m[1].trim().toLowerCase());
  return headings.some(h => !known.has(h));
}

// ── Структурные редакторы секций «Политический ландшафт» / «Ключевые локации» ──
// Строки-записи (роль/имя/имя2 и тип/имя) поверх готовой row-инфраструктуры .cdet-rel-*.
const CITY_POLITICAL_ROLES = ['Князь', 'Шериф', 'Сенешаль', 'Примаген'];
const CITY_LOCATION_TYPES  = ['Элизиум'];
let _cityEditChars = [];  // имена персонажей города — для datalist
let _cityEditLocs  = [];  // названия локаций города — для datalist
let _polRowSeq = 0;

// Секция «Политический ландшафт»/«Ключевые локации» может содержать вольный нарратив
// (как сейчас у всех городов — цельный абзац-описание) и структурные записи вида
// "Должность: Имя" / "Тип: Название". Раньше всё это разбиралось в одни и те же строки
// формы, и нарратив без двоеточия попадал в поле «Имя» структурного редактора — отсюда
// и путаница. Делим по строке: запись — короткая метка + двоеточие, где метка либо из
// известного словаря (Князь/Шериф/…, Элизиум), либо значение похоже на имя (короткое,
// без «прозаической» пунктуации). Иначе строка — нарратив. Так проза с двоеточием
// («Камарилья: оплот старейшин, но раздроблена») остаётся в нарративе, а не уезжает
// фальшивой записью в структурный редактор и «Карту фракций».
function _isStructuredCityLine(line, knownLabels) {
  const ci = line.indexOf(':');
  if (ci <= 0 || ci > 40) return false;
  const label = line.slice(0, ci).trim();
  if (!label || label.length > 24 || label.split(/\s+/).length > 2 || label.includes(',')) return false;
  if (knownLabels && knownLabels.has(label.toLowerCase())) return true;
  const value = line.slice(ci + 1).trim();
  return value.length > 0 && value.length <= 48 && !/[.!?,;]/.test(value);
}
function _splitCitySectionRecords(text, knownLabels) {
  const lines = String(text || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
  const narrative = [], recordLines = [];
  for (const line of lines) (_isStructuredCityLine(line, knownLabels) ? recordLines : narrative).push(line);
  return { narrative: narrative.join('\n'), recordLines };
}
const _POL_LABELS = new Set(CITY_POLITICAL_ROLES.map(r => r.toLowerCase()));
const _LOC_LABELS = new Set(CITY_LOCATION_TYPES.map(t => t.toLowerCase()));

// city.md-строки записей ↔ структурные записи (round-trip с buildCityMd/parseCityMd).
function _parsePoliticalLines(lines) {
  return lines.map(line => {
    const ci = line.indexOf(':');
    let role = '', rest = line;
    if (ci !== -1) { role = line.slice(0, ci).trim(); rest = line.slice(ci + 1).trim(); }
    const [name = '', name2 = ''] = rest.split('/').map(s => s.trim());
    return { role, name, name2 };
  });
}
function _politicalRowToLine(r) {
  const np = r.name2 ? (r.name ? `${r.name} / ${r.name2}` : r.name2) : r.name;
  return r.role ? `${r.role}: ${np}` : np;
}
function _parseLocationLines(lines) {
  return lines.map(line => {
    const ci = line.indexOf(':');
    if (ci === -1) return { type: '', name: line };
    return { type: line.slice(0, ci).trim(), name: line.slice(ci + 1).trim() };
  });
}
function _locationRowToLine(r) { return r.type ? `${r.type}: ${r.name}` : r.name; }

// Персонажи, уже занятые в других строках, не предлагаются повторно (кроме self).
function _polAvailableNames(allNames, records, self) {
  const occ = new Set();
  records.forEach(r => { if (r === self) return; if (r.name) occ.add(r.name); if (r.name2) occ.add(r.name2); });
  return allNames.filter(n => !occ.has(n));
}

function _polRowHtml(role = '', name = '', name2 = '', availableNames = _cityEditChars) {
  const known   = CITY_POLITICAL_ROLES.includes(role);
  const selVal  = !role ? '' : (known ? role : 'other');
  const custVal = (!known && role) ? role : '';
  const opts = [
    `<option value=""${selVal === '' ? ' selected' : ''}>Должность…</option>`,
    ...CITY_POLITICAL_ROLES.map(o => `<option value="${escAttr(o)}"${o === selVal ? ' selected' : ''}>${escHtml(o)}</option>`),
    `<option value="other"${selVal === 'other' ? ' selected' : ''}>Другое…</option>`,
  ].join('');
  const dlId   = `cdet-pol-dl-${++_polRowSeq}`;
  const dlOpts = availableNames.map(n => `<option value="${escAttr(n)}">`).join('');
  return `<div class="cdet-rel-row cdet-pol-row">
    <select class="form-control cdet-pol-role-sel">${opts}</select>
    <input class="cdet-rel-type-inp cdet-pol-role-custom" placeholder="Своя должность" value="${escAttr(custVal)}" style="${selVal === 'other' ? '' : 'display:none'}">
    <input class="cdet-rel-name-inp cdet-pol-name-inp" list="${dlId}" placeholder="Имя персонажа" value="${escAttr(name)}">
    <input class="cdet-rel-name-inp cdet-pol-name-inp cdet-pol-name2-inp" list="${dlId}" placeholder="Второе имя (необязательно)" value="${escAttr(name2)}">
    <button class="cdet-rel-del-btn" type="button" title="Удалить запись">✕</button>
    <datalist id="${dlId}">${dlOpts}</datalist>
  </div>`;
}
function _locRowHtml(type = '', name = '', locationNames = _cityEditLocs) {
  const known   = CITY_LOCATION_TYPES.includes(type);
  const selVal  = !type ? '' : (known ? type : 'other');
  const custVal = (!known && type) ? type : '';
  const opts = [
    `<option value=""${selVal === '' ? ' selected' : ''}>Тип…</option>`,
    ...CITY_LOCATION_TYPES.map(o => `<option value="${escAttr(o)}"${o === selVal ? ' selected' : ''}>${escHtml(o)}</option>`),
    `<option value="other"${selVal === 'other' ? ' selected' : ''}>Другое…</option>`,
  ].join('');
  return `<div class="cdet-rel-row cdet-loc-row">
    <select class="form-control cdet-pol-role-sel cdet-loc-type-sel">${opts}</select>
    <input class="cdet-rel-type-inp cdet-loc-type-custom" placeholder="Свой тип" value="${escAttr(custVal)}" style="${selVal === 'other' ? '' : 'display:none'}">
    <input class="cdet-rel-name-inp cdet-loc-name-inp" list="cdet-city-loc-names" placeholder="Название локации" value="${escAttr(name)}">
    <button class="cdet-rel-del-btn" type="button" title="Удалить запись">✕</button>
  </div>`;
}
// Строка уезжает (fade+collapse), затем удаляется из DOM — без этого клик по «✕» среди
// нескольких похожих строк не давал понять, какая именно пропала.
function _removeRelRow(row) {
  if (!row) return;
  row.classList.add('row-exit');
  row.addEventListener('animationend', () => row.remove(), { once: true });
  setTimeout(() => row.remove(), 250); // страховка, если animationend не сработает
}

// HTML-блоки структурных секций для формы _renderCityEdit. Нарратив и структурные
// записи — два отдельных поля, чтобы не путались при заполнении.
function _cityPolEditorHtml(sec) {
  const { narrative, recordLines } = _splitCitySectionRecords(sec.political || '', _POL_LABELS);
  const records = _parsePoliticalLines(recordLines);
  const rows = records.length
    ? records.map(r => _polRowHtml(r.role, r.name, r.name2, _polAvailableNames(_cityEditChars, records, r))).join('')
    : _polRowHtml('', '', '', _cityEditChars);
  return `
    <div class="form-group">
      <label class="form-label">Политический ландшафт</label>
      <div class="cdet-rels-hint">Общее описание расклада сил — атмосфера, фракции, конфликты.</div>
      <textarea class="form-control" data-city-field="political-narrative" rows="3"
        placeholder="По строке на пункт…">${escHtml(narrative)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Держатели ключевых должностей</label>
      <div class="cdet-rels-hint">Должность — из списка или своя. Имя (и второе, если нужно) — выбери из персонажей или впиши своё. Занятые в других строках персонажи не предлагаются.</div>
      <div id="cdet-political-rows">${rows}</div>
      <button class="cdet-rel-add-btn" id="cdet-political-add-btn" type="button">+ Добавить запись</button>
    </div>`;
}
function _cityLocEditorHtml(sec) {
  const { narrative, recordLines } = _splitCitySectionRecords(sec.locations || '', _LOC_LABELS);
  const records = _parseLocationLines(recordLines);
  const rows = records.length ? records.map(r => _locRowHtml(r.type, r.name)).join('') : _locRowHtml();
  return `
    <div class="form-group">
      <label class="form-label">Ключевые локации</label>
      <div class="cdet-rels-hint">Общее описание ключевых локаций города.</div>
      <textarea class="form-control" data-city-field="locations-narrative" rows="3"
        placeholder="По строке на пункт…">${escHtml(narrative)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Отмеченные локации</label>
      <div class="cdet-rels-hint">Тип — из списка или свой. Название — из созданных локаций или своё.</div>
      <div id="cdet-location-rows">${rows}</div>
      <button class="cdet-rel-add-btn" id="cdet-location-add-btn" type="button">+ Добавить запись</button>
      <datalist id="cdet-city-loc-names">${_cityEditLocs.map(n => `<option value="${escAttr(n)}">`).join('')}</datalist>
    </div>`;
}
// Мультиселект-чипы: секты Камарилья/Анархи/Шабаш + независимые кланы. Храним как
// буллет-список (по строке на выбор) — та же конвенция, что у простых секций.
// Строки, не совпавшие ни с одним чипом (рукописные/нестандартные фракции — Инконню
// и т.п.), не теряются: их показываем в поле «Другие фракции» и сохраняем как есть.
function _cityFactionsEditorHtml(sec) {
  const all = String(sec.factions || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
  const known = new Set([...CITY_SECTS, ...CITY_INDEPENDENT_CLANS]);
  const selected = new Set(all.filter(l => known.has(l)));
  const other = all.filter(l => !known.has(l));
  const chip = name => {
    const on = selected.has(name);
    return `<button type="button" class="cdet-faction-chip" aria-pressed="${on}" data-faction="${escAttr(name)}">${escHtml(name)}</button>`;
  };
  return `
    <div class="form-group">
      <label class="form-label">Фракции</label>
      <div class="cdet-rels-hint">Секты и независимые кланы, присутствующие в городе. Можно выбрать несколько.</div>
      <div class="cdet-faction-group-label">Секты</div>
      <div class="cdet-faction-chips" data-faction-group="sects">${CITY_SECTS.map(chip).join('')}</div>
      <div class="cdet-faction-group-label">Независимые кланы</div>
      <div class="cdet-faction-chips" data-faction-group="clans">${CITY_INDEPENDENT_CLANS.map(chip).join('')}</div>
      <div class="cdet-faction-group-label">Другие фракции</div>
      <textarea class="form-control" data-city-field="factions-other" rows="2"
        placeholder="По строке на фракцию вне списка (напр. Инконню)…">${escHtml(other.join('\n'))}</textarea>
    </div>`;
}
// root ограничивает сбор одной формой — модалка редактирования и форма создания
// держат свои наборы чипов одновременно, без пересечения селекторов.
function _collectFactions(root = document) {
  const chips = Array.from(root.querySelectorAll('.cdet-faction-chip[aria-pressed="true"]')).map(b => b.dataset.faction);
  const other = (root.querySelector('[data-city-field="factions-other"]')?.value || '')
    .split('\n').map(l => l.trim()).filter(Boolean);
  return [...chips, ...other].join('\n');
}

// Сбор нарратива + структурных строк обратно в текст секции city.md (буллет на пункт/запись).
function _collectPoliticalRows() {
  const narrative = document.querySelector('[data-city-field="political-narrative"]')?.value.trim() || '';
  const narrativeLines = narrative ? narrative.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const recordLines = Array.from(document.querySelectorAll('#cdet-political-rows .cdet-pol-row')).map(row => {
    const sel    = row.querySelector('.cdet-pol-role-sel');
    const custom = row.querySelector('.cdet-pol-role-custom');
    const role   = sel?.value === 'other' ? (custom?.value.trim() || '') : (sel?.value || '');
    const name   = row.querySelector('.cdet-pol-name-inp')?.value.trim() || '';
    const name2  = row.querySelector('.cdet-pol-name2-inp')?.value.trim() || '';
    return { role, name, name2 };
  }).filter(r => r.role || r.name || r.name2).map(_politicalRowToLine);
  return [...narrativeLines, ...recordLines].join('\n');
}
function _collectLocationRows() {
  const narrative = document.querySelector('[data-city-field="locations-narrative"]')?.value.trim() || '';
  const narrativeLines = narrative ? narrative.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const recordLines = Array.from(document.querySelectorAll('#cdet-location-rows .cdet-loc-row')).map(row => {
    const sel    = row.querySelector('.cdet-loc-type-sel');
    const custom = row.querySelector('.cdet-loc-type-custom');
    const type   = sel?.value === 'other' ? (custom?.value.trim() || '') : (sel?.value || '');
    const name   = row.querySelector('.cdet-loc-name-inp')?.value.trim() || '';
    return { type, name };
  }).filter(r => r.type || r.name).map(_locationRowToLine);
  return [...narrativeLines, ...recordLines].join('\n');
}

async function openCityDetail(slug) {
  const modal   = document.getElementById('city-detail-modal');
  const content = document.getElementById('city-detail-content');
  content.innerHTML = `<div class="mod-loading">${SPINNER}</div>`;
  openModal('city-detail-modal');

  let d, chars = [], locs = [];
  try {
    [d, chars, locs] = await Promise.all([
      fetch(`/api/cities/${encodeURIComponent(slug)}/detail`).then(r => r.json()),
      fetch(`/api/characters?city=${encodeURIComponent(slug)}`).then(r => r.json()).catch(() => []),
      fetch(`/api/locations?city=${encodeURIComponent(slug)}`).then(r => r.json()).catch(() => []),
    ]);
  } catch { content.innerHTML = '<div class="cdet-empty" style="padding:40px">⚠ Не удалось загрузить город</div>'; return; }
  if (d.error) { content.innerHTML = `<div class="cdet-empty" style="padding:40px">${escHtml(d.error)}</div>`; return; }

  _cityEditChars = Array.isArray(chars) ? chars.map(c => c.name).filter(Boolean) : [];
  _cityEditLocs  = Array.isArray(locs) ? locs.map(l => l.title).filter(Boolean) : [];
  _cityDetail = { ...d, slug, active: slug === CITY };
  _renderCityView();
}

function _renderCityView() {
  const d = _cityDetail;
  const content = document.getElementById('city-detail-content');
  const display = (d.parsed && d.parsed.display) || d.slug;
  const body    = d.cityMd.replace(/^#\s+.+\n+/, ''); // заголовок уже в шапке модалки

  const meta = [
    d.parsed && d.parsed.year ? `<span class="chp-meta-item">📅 ${escHtml(d.parsed.year)}</span>` : '',
    d.characters ? `<span class="chp-meta-item">🎭 ${d.characters} персонажей</span>` : '',
    d.modules    ? `<span class="chp-meta-item">📖 ${d.modules} модулей</span>` : '',
    d.locations  ? `<span class="chp-meta-item">📍 ${d.locations} локаций</span>` : '',
  ].filter(Boolean).join('');

  content.innerHTML = `
    <div class="cdet-info-col mod-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">${escHtml(display)}</div>
        <div class="mod-modal-slug-row">
          ${meta ? `<div class="chp-card-meta">${meta}</div>` : ''}
          ${d.active
            ? '<span class="chp-status chp-status-active">Активен</span>'
            : `<button class="mod-gen-scenario-btn" data-switch-city="${escHtml(d.slug)}">Переключиться на этот город</button>`}
        </div>
        <div class="city-detail-actions">
          <button class="city-edit-btn" data-city-edit>✏ Редактировать</button>
          <button class="city-del-btn" data-city-delete title="Удалить домен">🗑 Удалить</button>
        </div>
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active"><div class="md-body">${mdToHtmlBlock(body)}</div></div>
      </div>
    </div>`;
}

// Пояснения к полям редактирования города — те же формулировки, что у формы
// создания (см. .field-tip в index.html «Создать домен»), чтобы не расходились.
const CITY_FIELD_TIPS = {
  'Название': 'Название города на русском — заголовок city.md.',
  'Год': 'Год, в котором разворачивается хроника. Используется в заголовках city.md и карточек — на механику не влияет.',
  'Сеттинг': 'Общее описание города — эпоха, тон, в рамках какого канона разворачиваются сцены.',
  'Лейтмотивы и атмосфера': '2–3 детали, которые делают сцену именно этим городом, а не «городом в Европе»: архитектура, погода, общее настроение хроники.',
  'Специфика ответа': 'Язык общения НПС, имена Князей и других ключевых фигур, местные обычаи и сленг.',
  'Чего избегать': 'Табу и нежелательные клише именно для этого домена.',
  'Источники': 'На какие книги или материалы опираться при сверке канона для этого домена.',
};

function _renderCityEdit() {
  const d = _cityDetail;
  const content = document.getElementById('city-detail-content');
  const sec = (d.parsed && d.parsed.sections) || {};
  const custom = _cityHasCustomSections(d.cityMd);

  const fieldRows = CITY_SECTION_DEFS.map(([key, heading]) => {
    if (key === 'political') return _cityPolEditorHtml(sec);
    if (key === 'factions')  return _cityFactionsEditorHtml(sec);
    if (key === 'locations') return _cityLocEditorHtml(sec);
    return `
    <div class="form-group">
      <label class="form-label">${escHtml(heading)}${fieldTip(CITY_FIELD_TIPS[heading])}</label>
      <textarea class="form-control" data-city-field="${key}" rows="3"
        placeholder="По строке на пункт…">${escHtml(sec[key] || '')}</textarea>
    </div>`;
  }).join('');

  content.innerHTML = `
    <div class="cdet-info-col mod-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">Редактирование: ${escHtml((d.parsed && d.parsed.display) || d.slug)}</div>
        <div class="cdet-tab-bar city-edit-tabs">
          <button class="cdet-tab ${custom ? '' : 'active'}" data-city-tab="fields" ${custom ? 'disabled title="У города есть кастомные секции — правьте через Markdown, иначе они потеряются"' : ''}>Поля</button>
          <button class="cdet-tab ${custom ? 'active' : ''}" data-city-tab="markdown">Markdown</button>
        </div>
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel city-edit-panel ${custom ? '' : 'active'}" data-city-pane="fields">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Название *${fieldTip(CITY_FIELD_TIPS['Название'])}</label>
              <input class="form-control" data-city-field="display" type="text" value="${escAttr((d.parsed && d.parsed.display) || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Год${fieldTip(CITY_FIELD_TIPS['Год'])}</label>
              <input class="form-control" data-city-field="year" type="text" maxlength="9" value="${escAttr((d.parsed && d.parsed.year) || '')}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Сеттинг${fieldTip(CITY_FIELD_TIPS['Сеттинг'])}</label>
            <textarea class="form-control" data-city-field="description" rows="3"
              placeholder="Общее описание города — эпоха, тон, в рамках какого канона разворачиваются сцены…">${escHtml((d.parsed && d.parsed.description) || '')}</textarea>
          </div>
          ${fieldRows}
        </div>
        <div class="cdet-panel city-edit-panel ${custom ? 'active' : ''}" data-city-pane="markdown">
          ${custom ? '<div class="canon-warn" style="margin-bottom:10px">У этого города есть нестандартные секции — редактируйте полный markdown, чтобы ничего не потерять.</div>' : ''}
          <textarea class="form-control city-md-editor" data-city-field="cityMd" rows="20" spellcheck="false">${escHtml(d.cityMd)}</textarea>
        </div>
      </div>
      <div class="city-edit-footer">
        <button class="btn-submit" data-city-save>✓ Сохранить</button>
        <button class="mod-gen-scenario-btn" data-city-cancel>Отмена</button>
        <span class="city-edit-status" data-city-status></span>
      </div>
    </div>`;
}

// Мультиселект-чип фракции (aria-pressed = состояние) — делегировано на document,
// чтобы работало и в модалке редактирования, и в форме создания города.
document.addEventListener('click', e => {
  const factionChip = e.target.closest('.cdet-faction-chip');
  if (factionChip) {
    factionChip.setAttribute('aria-pressed', factionChip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  }
});

document.getElementById('city-detail-content').addEventListener('click', async e => {
  const sw = e.target.closest('[data-switch-city]');
  if (sw) { location.search = 'city=' + encodeURIComponent(sw.dataset.switchCity); return; }

  // Структурные строки политики/локаций: добавить/удалить
  if (e.target.closest('#cdet-political-add-btn')) {
    const rows = document.getElementById('cdet-political-rows');
    if (rows) {
      const occ = new Set();
      rows.querySelectorAll('.cdet-pol-row').forEach(row => {
        const n1 = row.querySelector('.cdet-pol-name-inp')?.value.trim();
        const n2 = row.querySelector('.cdet-pol-name2-inp')?.value.trim();
        if (n1) occ.add(n1); if (n2) occ.add(n2);
      });
      rows.insertAdjacentHTML('beforeend', _polRowHtml('', '', '', _cityEditChars.filter(n => !occ.has(n))));
      rows.lastElementChild?.classList.add('row-enter');
      rows.lastElementChild?.querySelector('.cdet-pol-name-inp')?.focus();
    }
    return;
  }
  if (e.target.closest('#cdet-political-rows .cdet-rel-del-btn')) { _removeRelRow(e.target.closest('.cdet-pol-row')); return; }
  if (e.target.closest('#cdet-location-add-btn')) {
    const rows = document.getElementById('cdet-location-rows');
    if (rows) {
      rows.insertAdjacentHTML('beforeend', _locRowHtml());
      rows.lastElementChild?.classList.add('row-enter');
      rows.lastElementChild?.querySelector('.cdet-loc-name-inp')?.focus();
    }
    return;
  }
  if (e.target.closest('#cdet-location-rows .cdet-rel-del-btn')) { _removeRelRow(e.target.closest('.cdet-loc-row')); return; }

  if (e.target.closest('[data-city-edit]'))   { _renderCityEdit(); return; }
  if (e.target.closest('[data-city-cancel]')) { _renderCityView(); return; }

  const tab = e.target.closest('[data-city-tab]');
  if (tab && !tab.disabled) {
    const which = tab.dataset.cityTab;
    document.querySelectorAll('[data-city-tab]').forEach(b => b.classList.toggle('active', b === tab));
    document.querySelectorAll('[data-city-pane]').forEach(p => p.classList.toggle('active', p.dataset.cityPane === which));
    return;
  }

  if (e.target.closest('[data-city-save]'))   { await _saveCityEdit(); return; }
  if (e.target.closest('[data-city-delete]')) { await _deleteCity(); return; }
});

// Показ/скрытие поля «своя должность/тип» при выборе «Другое…».
document.getElementById('city-detail-content').addEventListener('change', e => {
  const locSel = e.target.closest('.cdet-loc-type-sel');
  if (locSel) { const c = locSel.closest('.cdet-loc-row')?.querySelector('.cdet-loc-type-custom'); if (c) c.style.display = locSel.value === 'other' ? '' : 'none'; return; }
  const polSel = e.target.closest('.cdet-pol-role-sel');
  if (polSel) { const c = polSel.closest('.cdet-pol-row')?.querySelector('.cdet-pol-role-custom'); if (c) c.style.display = polSel.value === 'other' ? '' : 'none'; }
});

async function _saveCityEdit() {
  const d = _cityDetail;
  const statusEl = document.querySelector('[data-city-status]');
  const activePane = document.querySelector('[data-city-pane].active')?.dataset.cityPane || 'fields';
  const q = v => document.querySelector(`[data-city-field="${v}"]`);

  let payload;
  if (activePane === 'markdown') {
    const cityMd = q('cityMd').value;
    if (!/^#\s+\S/m.test(cityMd)) { if (statusEl) statusEl.textContent = '⚠ city.md должен начинаться с # …'; return; }
    payload = { cityMd };
  } else {
    const display = q('display').value.trim();
    if (!display) { if (statusEl) statusEl.textContent = '⚠ Укажите название'; return; }
    const fields = { display, year: q('year').value.trim(), description: q('description').value.trim() };
    for (const [key] of CITY_SECTION_DEFS) {
      if (key === 'political')      fields[key] = _collectPoliticalRows();
      else if (key === 'factions')  fields[key] = _collectFactions(document.getElementById('city-detail-content'));
      else if (key === 'locations') fields[key] = _collectLocationRows();
      else                          fields[key] = q(key).value.trim();
    }
    payload = { fields };
  }

  const btn = document.querySelector('[data-city-save]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Сохранение...'; }
  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(d.slug)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());
    if (!r.ok) { if (statusEl) statusEl.textContent = '⚠ ' + (r.error || 'Ошибка'); return; }
    // Перечитываем детально и возвращаемся в просмотр; обновляем грид доменов.
    const fresh = await fetch(`/api/cities/${encodeURIComponent(d.slug)}/detail`).then(r => r.json());
    _cityDetail = { ...fresh, slug: d.slug, active: d.slug === CITY };
    _renderCityView();
    if (document.getElementById('cities-grid')) loadCitiesGrid();
  } catch (err) {
    if (statusEl) statusEl.textContent = '⚠ ' + err.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Сохранить'; }
  }
}

async function _deleteCity() {
  const d = _cityDetail;
  const what = [d.characters && `${d.characters} персонажей`, d.modules && `${d.modules} модулей`,
    d.locations && `${d.locations} локаций`].filter(Boolean).join(', ');
  const msg = `Удалить домен «${(d.parsed && d.parsed.display) || d.slug}»?` +
    (what ? `\n\nВнутри: ${what}.` : '') +
    `\n\nГород переедет в cities/_deleted/ (обратимо, картинки не стираются).`;
  if (!await showConfirm(msg, { danger: true, confirmText: 'Удалить' })) return;

  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(d.slug)}`, { method: 'DELETE' }).then(r => r.json());
    if (!r.ok) { showToast('Ошибка удаления: ' + (r.error || 'неизвестная'), 'error'); return; }
    closeModal('city-detail-modal');
    if (d.active) {
      // Удалили активный город — переключаемся на любой оставшийся.
      const { cities = [] } = await fetch('/api/cities').then(r => r.json());
      if (cities.length) { location.search = 'city=' + encodeURIComponent(cities[0]); return; }
    }
    if (document.getElementById('cities-grid')) loadCitiesGrid();
  } catch (err) { showToast('Ошибка удаления: ' + err.message, 'error'); }
}

const cityDetailModal = document.getElementById('city-detail-modal');
document.getElementById('city-detail-close').addEventListener('click', () => closeModal('city-detail-modal'));
cityDetailModal.addEventListener('click', e => { if (e.target === cityDetailModal) closeModal('city-detail-modal'); });

