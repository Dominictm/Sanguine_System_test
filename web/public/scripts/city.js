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
  // Ленивый инжект структурных редакторов в форму создания (один раз) — тот же приём,
  // что уже применялся к «Фракциям»: единый компонент между созданием и редактированием.
  if (_cityFactionsCreateHost && !_cityFactionsCreateHost.dataset.ready) {
    _cityFactionsCreateHost.innerHTML = _cityFactionsEditorHtml({ factions: '' });
    _cityFactionsCreateHost.dataset.ready = '1';
  }
  if (_cityDistrictsCreateHost && !_cityDistrictsCreateHost.dataset.ready) {
    _cityDistrictsCreateHost.innerHTML = _cityDistrictsEditorHtml();
    _cityDistrictsCreateHost.dataset.ready = '1';
  }
  if (_cityPoliticalCreateHost && !_cityPoliticalCreateHost.dataset.ready) {
    _cityPoliticalCreateHost.innerHTML = _cityPolEditorHtml({});
    _cityPoliticalCreateHost.dataset.ready = '1';
  }
  if (_cityLocationsCreateHost && !_cityLocationsCreateHost.dataset.ready) {
    _cityLocationsCreateHost.innerHTML = _cityLocEditorHtml({}, 'cdet-create');
    _cityLocationsCreateHost.dataset.ready = '1';
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
// «Примаген» (опечатка) убран — Примоген переехал в отдельный блок «Примогенат» со своим
// дропдауном кланов (designspec §1, вариант B), не спрятанная опция в общем списке ролей.
const CITY_POLITICAL_ROLES = ['Князь', 'Шериф', 'Сенешаль', 'Хранитель Элизиума'];
const CITY_LOCATION_TYPES  = ['Элизиум', 'Приёмная князя', 'Убежище', 'Шериф', 'Сенешаль'];
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
// «Примогенат» — designspec §1, вариант B: отдельная под-секция под «Властителями», со
// СВОИМ дропдауном (кланы VAMPIRE_CLANS из scripts.js — тот же список, что в форме
// создания персонажа, не заводим второй), не спрятанная опция в общем списке должностей.
// На city.md-уровне остаётся та же запись «Держателей должностей» ("Роль: Имя") — роль
// здесь просто «Примоген (<Клан>)» — переиспользует _politicalRowToLine/_parsePoliticalLines
// как есть (round-trip не меняется, см. PRIMOGEN_ROLE_RE ниже).
const PRIMOGEN_ROLE_RE = /^Примоген\s*\(([^)]+)\)$/i;
function _splitPoliticalRecordsByKind(records) {
  const political = [], primogen = [];
  records.forEach(r => {
    const m = PRIMOGEN_ROLE_RE.exec(r.role || '');
    if (m) primogen.push({ clan: m[1].trim(), name: r.name, name2: r.name2 });
    else political.push(r);
  });
  return { political, primogen };
}
function _primogenRowHtml(clan = '', name = '', name2 = '', availableNames = _cityEditChars) {
  const known   = VAMPIRE_CLANS.includes(clan);
  const selVal  = !clan ? '' : (known ? clan : 'other');
  const custVal = (!known && clan) ? clan : '';
  const opts = [
    `<option value=""${selVal === '' ? ' selected' : ''}>Клан…</option>`,
    ...VAMPIRE_CLANS.map(o => `<option value="${escAttr(o)}"${o === selVal ? ' selected' : ''}>${escHtml(o)}</option>`),
    `<option value="other"${selVal === 'other' ? ' selected' : ''}>Другое…</option>`,
  ].join('');
  const dlId   = `cdet-prim-dl-${++_polRowSeq}`;
  const dlOpts = availableNames.map(n => `<option value="${escAttr(n)}">`).join('');
  return `<div class="cdet-rel-row cdet-prim-row">
    <select class="form-control cdet-prim-clan-sel">${opts}</select>
    <input class="cdet-rel-type-inp cdet-prim-clan-custom" placeholder="Свой клан" value="${escAttr(custVal)}" style="${selVal === 'other' ? '' : 'display:none'}">
    <input class="cdet-rel-name-inp cdet-prim-name-inp" list="${dlId}" placeholder="Имя Примогена" value="${escAttr(name)}">
    <input class="cdet-rel-name-inp cdet-prim-name-inp cdet-prim-name2-inp" list="${dlId}" placeholder="Второе имя (необязательно)" value="${escAttr(name2)}">
    <button class="cdet-rel-del-btn" type="button" title="Удалить запись">✕</button>
    <datalist id="${dlId}">${dlOpts}</datalist>
  </div>`;
}
// Строка «Ключевых локаций» ссылается на НАСТОЯЩУЮ карточку локации (по имени
// из locationNames — уже существующих в городе). Если имя не совпало ни с одной
// существующей — считаем запись новой локацией: показываем район+заметку и при
// сохранении создаём реальную карточку через POST /api/locations (фаза K,
// план 2026-07-16), а не просто текстовый тег без содержимого за ним.
// idPrefix — datalist id-ы (list="…") резолвятся ГЛОБАЛЬНО по document, не по ближайшему
// предку: если этот редактор одновременно смонтирован и в форме создания города, и в
// модалке редактирования (обе секции живут в DOM одновременно, скрытые/показанные через
// CSS страниц — SPA не размонтирует .page при навигации), два набора datalist с
// одинаковым id перепутали бы автодополнение между создаваемым и редактируемым городом.
function _locRowHtml(type = '', name = '', locationNames = _cityEditLocs, idPrefix = 'cdet-edit') {
  const known   = CITY_LOCATION_TYPES.includes(type);
  const selVal  = !type ? '' : (known ? type : 'other');
  const custVal = (!known && type) ? type : '';
  const opts = [
    `<option value=""${selVal === '' ? ' selected' : ''}>Статус локации…</option>`,
    ...CITY_LOCATION_TYPES.map(o => `<option value="${escAttr(o)}"${o === selVal ? ' selected' : ''}>${escHtml(o)}</option>`),
    `<option value="other"${selVal === 'other' ? ' selected' : ''}>Другое…</option>`,
  ].join('');
  const isNew = !!(name && !locationNames.includes(name));
  return `<div class="cdet-loc-row-wrap">
    <div class="cdet-rel-row cdet-loc-row">
      <select class="form-control cdet-pol-role-sel cdet-loc-type-sel">${opts}</select>
      <input class="cdet-rel-type-inp cdet-loc-type-custom" placeholder="Свой статус" value="${escAttr(custVal)}" style="${selVal === 'other' ? '' : 'display:none'}">
      <input class="cdet-rel-name-inp cdet-loc-name-inp" list="${idPrefix}-city-loc-names" placeholder="Название локации" value="${escAttr(name)}">
      <button class="cdet-rel-del-btn" type="button" title="Удалить запись">✕</button>
    </div>
    <div class="cdet-loc-new-fields"${isNew ? '' : ' hidden'}>
      <input class="form-control cdet-loc-new-district" list="${idPrefix}-city-district-names" placeholder="Район (для новой локации)">
      <input class="form-control cdet-loc-new-note" placeholder="Заметка/статус — попадёт в «Атмосферу» карточки, необязательно">
    </div>
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
  const allRecords = _parsePoliticalLines(recordLines);
  const { political: records, primogen: primRecords } = _splitPoliticalRecordsByKind(allRecords);
  const rows = records.length
    ? records.map(r => _polRowHtml(r.role, r.name, r.name2, _polAvailableNames(_cityEditChars, records, r))).join('')
    : _polRowHtml('', '', '', _cityEditChars);
  const primRows = primRecords.length
    ? primRecords.map(r => _primogenRowHtml(r.clan, r.name, r.name2, _polAvailableNames(_cityEditChars, primRecords, r))).join('')
    : _primogenRowHtml('', '', '', _cityEditChars);
  return `
    <div class="form-group">
      <label class="form-label">Политический ландшафт</label>
      <div class="cdet-rels-hint">Общее описание расклада сил — атмосфера, фракции, конфликты.</div>
      <textarea class="form-control" data-city-field="political-narrative" rows="3"
        placeholder="По строке на пункт…">${escHtml(narrative)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Властители города</label>
      <div class="cdet-rels-hint">Должность — из списка или своя. Имя (и второе, если нужно) — выбери из персонажей или впиши своё. Занятые в других строках персонажи не предлагаются. При выборе существующего персонажа его карточка получит запись в поле «Иерархия» автоматически.</div>
      <div class="cdet-political-rows">${rows}</div>
      <button class="cdet-rel-add-btn cdet-political-add-btn" type="button">+ Добавить запись</button>
    </div>
    <div class="form-group">
      <label class="form-label">Примогенат</label>
      <div class="cdet-rels-hint">Один Примоген на клан. Клан — из списка или свой. Имя — выбери из персонажей или впиши своё. При выборе существующего персонажа его карточка получит запись в поле «Иерархия» автоматически.</div>
      <div class="cdet-primogen-rows">${primRows}</div>
      <button class="cdet-rel-add-btn cdet-primogen-add-btn" type="button">+ Добавить запись</button>
    </div>`;
}
// Кандидаты названий районов — первая часть каждой строки секции «Районы»
// (конвенция «Название — кто держит/суть», см. CITY_FIELD_TIPS.Районы) до
// первого тире/двоеточия. Best-effort: секция свободнотекстовая, без строгого
// формата — подсказка для datalist, не проверка.
function _parseDistrictNames(text) {
  return String(text || '').split('\n')
    .map(l => l.replace(/^\s*-\s?/, '').trim())
    .filter(Boolean)
    .map(l => l.split(/[—–:]/)[0].trim())
    .filter(Boolean);
}

function _cityLocEditorHtml(sec, idPrefix = 'cdet-edit') {
  const { narrative, recordLines } = _splitCitySectionRecords(sec.locations || '', _LOC_LABELS);
  const records = _parseLocationLines(recordLines);
  const rows = records.length
    ? records.map(r => _locRowHtml(r.type, r.name, _cityEditLocs, idPrefix)).join('')
    : _locRowHtml('', '', _cityEditLocs, idPrefix);
  const districts = _parseDistrictNames(sec.districts);
  return `
    <div class="form-group">
      <label class="form-label">Ключевые локации</label>
      <div class="cdet-rels-hint">Общее описание ключевых локаций города.</div>
      <textarea class="form-control" data-city-field="locations-narrative" rows="3"
        placeholder="По строке на пункт…">${escHtml(narrative)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Отмеченные локации</label>
      <div class="cdet-rels-hint">Статус локации — из списка или свой. Название — из созданных локаций или своё: новое имя создаст настоящую карточку локации (район + заметка ниже), а не просто текст. При выборе существующей локации со статусом «Элизиум»/«Приёмная князя»/«Убежище»/«Шериф»/«Сенешаль» её карточка получит запись в поле «Зона»/«Контроль» автоматически.</div>
      <div class="cdet-location-rows" data-loc-id-prefix="${escAttr(idPrefix)}">${rows}</div>
      <button class="cdet-rel-add-btn cdet-location-add-btn" type="button">+ Добавить запись</button>
      <datalist id="${idPrefix}-city-loc-names">${_cityEditLocs.map(n => `<option value="${escAttr(n)}">`).join('')}</datalist>
      <datalist id="${idPrefix}-city-district-names">${districts.map(n => `<option value="${escAttr(n)}">`).join('')}</datalist>
    </div>`;
}
// ── Блок «Район» (форма создания города, designspec §2.1) ─────────────────────
// Повторяемая карточка, не строка (у района больше полей, чем у одной строки
// «должность+имя»). Живёт ТОЛЬКО в форме создания — районы добавляются в уже
// существующий город отдельным путём (техспека §5.1, кнопка «+ Район» на странице
// города — вне рамок этой задачи, делает параллельный агент вместе с District-сущностью).
const DISTRICT_TYPES = [
  'Спальный', 'Деловой', 'Пром-зона', 'Туристический', 'Гетто',
  'Элизиум/культурный', 'Портовый', 'Университетский', 'Заброшенный',
];
let _districtCardSeq = 0;

function _districtCardHtml(d = {}) {
  const { name = '', type = '', sect = '', clan = '', description = '' } = d;
  const known   = DISTRICT_TYPES.includes(type);
  const selVal  = !type ? '' : (known ? type : 'other');
  const custVal = (!known && type) ? type : '';
  const opts = [
    `<option value=""${selVal === '' ? ' selected' : ''}>Тип района…</option>`,
    ...DISTRICT_TYPES.map(o => `<option value="${escAttr(o)}"${o === selVal ? ' selected' : ''}>${escHtml(o)}</option>`),
    `<option value="other"${selVal === 'other' ? ' selected' : ''}>Другое…</option>`,
  ].join('');
  return `<div class="city-district-card" id="city-district-card-${++_districtCardSeq}">
    <div class="city-district-card-head">
      <span class="city-district-card-title">📍 Район</span>
      <button class="cdet-rel-del-btn city-district-del-btn" type="button" title="Удалить район">✕ Удалить</button>
    </div>
    <div class="form-group">
      <label class="form-label">Наименование района *</label>
      <input class="form-control city-district-name" type="text" placeholder="Монмартр" value="${escAttr(name)}">
    </div>
    <div class="form-group">
      <label class="form-label">Тип района</label>
      <select class="form-control city-district-type-sel">${opts}</select>
      <input class="form-control city-district-type-custom" placeholder="Свой тип" value="${escAttr(custVal)}" style="${selVal === 'other' ? '' : 'display:none'}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Влияние — Секта</label>
        <input class="form-control city-district-sect" type="text" placeholder="Камарилья" value="${escAttr(sect)}">
      </div>
      <div class="form-group">
        <label class="form-label">Влияние — Клан</label>
        <input class="form-control city-district-clan" type="text" placeholder="Тремер" value="${escAttr(clan)}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Описание района</label>
      <textarea class="form-control city-district-desc" rows="2" placeholder="Чем живёт район, кто держит…">${escHtml(description)}</textarea>
    </div>
    <div class="city-district-locs">
      <button class="city-district-add-loc-btn" type="button">+ Добавить локацию</button>
      <div class="form-hint">Локация привязывается к уже СОЗДАННОМУ городу — доступно после сохранения формы.</div>
    </div>
  </div>`;
}
function _cityDistrictsEditorHtml() {
  return `<div class="city-districts-editor">
    <div class="city-district-cards">${_districtCardHtml()}</div>
    <button class="cdet-rel-add-btn city-districts-add-btn" type="button">+ Добавить район</button>
  </div>`;
}
function _collectDistrictCards(root = document) {
  return Array.from(root.querySelectorAll('.city-district-card')).map(card => {
    const name   = card.querySelector('.city-district-name')?.value.trim() || '';
    const sel    = card.querySelector('.city-district-type-sel');
    const custom = card.querySelector('.city-district-type-custom');
    const type   = sel?.value === 'other' ? (custom?.value.trim() || '') : (sel?.value || '');
    const sect   = card.querySelector('.city-district-sect')?.value.trim() || '';
    const clan   = card.querySelector('.city-district-clan')?.value.trim() || '';
    const description = card.querySelector('.city-district-desc')?.value.trim() || '';
    return { name, type, sect, clan, description };
  }).filter(d => d.name);
}
// «+ Добавить локацию» внутри карточки района — контракт техспеки §3.3: отдельная
// модалка локации, которую делает ПАРАЛЛЕЛЬНЫЙ агент (см. docs/design/2026-08-02-
// city-creation-restructure-techspec.md §3.3). На момент этой правки модалки физически
// нет в рабочей копии — вызываем по контракту (window.openLocationModal), с деградацией
// без падения формы, если её ещё не подключили.
// TODO(district-location-modal): убрать ветку деградации, когда модалка появится.
function _openDistrictLocationModal(districtName) {
  if (typeof window.openLocationModal === 'function') {
    window.openLocationModal({ district: districtName, districtLocked: true });
    return;
  }
  showToast('Модалка создания локации ещё не подключена в этой копии — добавьте локацию через «Инструменты → Ещё» после создания района', 'warning');
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

// root — тот же принцип, что уже установлен _collectFactions(root): форма создания
// города и модалка редактирования могут держать СВОИ копии этого редактора в DOM
// одновременно (SPA не размонтирует страницы при навигации) — без явного root сбор
// строк подобрал бы первую попавшуюся копию в document, не обязательно ту, что реально
// сохраняется.
function _collectPrimogenRows(root = document) {
  return Array.from(root.querySelectorAll('.cdet-primogen-rows .cdet-prim-row')).map(row => {
    const sel    = row.querySelector('.cdet-prim-clan-sel');
    const custom = row.querySelector('.cdet-prim-clan-custom');
    const clan   = sel?.value === 'other' ? (custom?.value.trim() || '') : (sel?.value || '');
    const name   = row.querySelector('.cdet-prim-name-inp')?.value.trim() || '';
    const name2  = row.querySelector('.cdet-prim-name2-inp')?.value.trim() || '';
    return { clan, name, name2 };
  }).filter(r => r.clan);
}
// Сбор нарратива + структурных строк обратно в текст секции city.md (буллет на пункт/запись).
function _collectPoliticalRows(root = document) {
  const narrative = root.querySelector('[data-city-field="political-narrative"]')?.value.trim() || '';
  const narrativeLines = narrative ? narrative.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const recordLines = Array.from(root.querySelectorAll('.cdet-political-rows .cdet-pol-row')).map(row => {
    const sel    = row.querySelector('.cdet-pol-role-sel');
    const custom = row.querySelector('.cdet-pol-role-custom');
    const role   = sel?.value === 'other' ? (custom?.value.trim() || '') : (sel?.value || '');
    const name   = row.querySelector('.cdet-pol-name-inp')?.value.trim() || '';
    const name2  = row.querySelector('.cdet-pol-name2-inp')?.value.trim() || '';
    return { role, name, name2 };
  }).filter(r => r.role || r.name || r.name2).map(_politicalRowToLine);
  const primogenLines = _collectPrimogenRows(root)
    .map(r => _politicalRowToLine({ role: `Примоген (${r.clan})`, name: r.name, name2: r.name2 }));
  return [...narrativeLines, ...recordLines, ...primogenLines].join('\n');
}
// Строки, чьё имя не совпадает ни с одной уже существующей локацией города, —
// заявки на создание настоящих карточек; собираются сюда и обрабатываются
// в _saveCityEdit() ПОСЛЕ успешного сохранения city.md (фаза K).
let _pendingNewLocations = [];

function _collectLocationRows(root = document) {
  const narrative = root.querySelector('[data-city-field="locations-narrative"]')?.value.trim() || '';
  const narrativeLines = narrative ? narrative.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const newLocationRequests = [];
  const recordLines = Array.from(root.querySelectorAll('.cdet-location-rows .cdet-loc-row-wrap')).map(wrap => {
    const row    = wrap.querySelector('.cdet-loc-row');
    const sel    = row.querySelector('.cdet-loc-type-sel');
    const custom = row.querySelector('.cdet-loc-type-custom');
    const type   = sel?.value === 'other' ? (custom?.value.trim() || '') : (sel?.value || '');
    const name   = row.querySelector('.cdet-loc-name-inp')?.value.trim() || '';
    if (name && !_cityEditLocs.includes(name)) {
      newLocationRequests.push({
        name,
        district: wrap.querySelector('.cdet-loc-new-district')?.value.trim() || '',
        note:     wrap.querySelector('.cdet-loc-new-note')?.value.trim() || '',
      });
    }
    return { type, name };
  }).filter(r => r.type || r.name).map(_locationRowToLine);
  _pendingNewLocations = newLocationRequests;
  return [...narrativeLines, ...recordLines].join('\n');
}

// Страничный вид города (фаза C, план 2026-07-15): открытие = навигация на
// #page-city, загрузка — loadCityPage() из navigate() (паттерн openModulePage).
function openCityDetail(slug) {
  STATE.currentCitySlug = slug;
  navigate('city');
}

async function loadCityPage() {
  const slug = STATE.currentCitySlug || CITY;
  const content = document.getElementById('city-detail-content');
  content.innerHTML = `<div class="mod-loading">${SPINNER}</div>`;

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
    <div class="city-page-header">
      <button class="modp-back-btn" data-city-back>← К городам</button>
      <div class="city-page-title-wrap">
        <div class="city-page-title">${escHtml(display)}</div>
        ${meta ? `<div class="chp-card-meta">${meta}</div>` : ''}
      </div>
      ${d.active
        ? '<span class="chp-status chp-status-active">Активен</span>'
        : `<button class="mod-gen-scenario-btn" data-switch-city="${escHtml(d.slug)}">Переключиться на этот город</button>`}
      <div class="city-detail-actions">
        <button class="city-edit-btn" data-city-edit>✏ Редактировать</button>
        <button class="city-del-btn" data-city-delete title="Удалить домен">🗑 Удалить</button>
      </div>
    </div>
    <div class="city-page-body city-page-prose">
      <div class="md-body">${mdToHtmlBlock(body)}</div>
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
  // Секции «живого города» (D1, план 2026-07-15)
  'Районы': 'Округа/районы города: сколько их, чем живут, кто держит какой. Один район на строку.',
  'Значимые места': 'Знаковые точки города — то, что нельзя перепутать с другим городом. По строке на место.',
  'Охотничьи угодья': 'Где кормиться разрешено, где чьё, где запрещено эдиктом. Главный источник конфликтов неонатов.',
  'Законы домена': 'Местные эдикты поверх шести Традиций: правила Становления, нейтральные зоны, запретные территории.',
  'Смертные институции': 'Полиция, морг, пресса, криминал, мэрия — и кем они куплены. Готовые ответы на «что будет, если труп найдут».',
  'Календарь города': 'Фестивали, матчи, годовщины — готовые крючки сцен и причина, почему улицы выглядят по-разному.',
  'Технологии и Маскарад': 'Камеры, соцсети, риски эпохи: где вампира снимут на телефон. Учитывается генерацией сценариев.',
  'Ограничения генерации': 'Жёсткие лимиты для AI: «Элизиумов не больше 2», «в районе не более 4 станций метро». Генерация не создаёт локации сверх этих правил.',
  'Именник и фактура': 'Банк имён по слоям общества, клановые конвенции, фактура эпохи (цены, транспорт, сленг). AI берёт имена новых НПС отсюда.',
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
    <div class="city-page-header">
      <button class="modp-back-btn" data-city-back>← К городам</button>
      <div class="city-page-title-wrap">
        <div class="city-page-title">Редактирование: ${escHtml((d.parsed && d.parsed.display) || d.slug)}</div>
      </div>
      <div class="cdet-tab-bar city-edit-tabs">
        <button class="cdet-tab ${custom ? '' : 'active'}" data-city-tab="fields" ${custom ? 'disabled title="У города есть кастомные секции — правьте через Markdown, иначе они потеряются"' : ''}>Поля</button>
        <button class="cdet-tab ${custom ? 'active' : ''}" data-city-tab="markdown">Markdown</button>
      </div>
    </div>
    <div class="city-page-body">
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

// Строки политики/примогената/локаций (add/del) — ГЛОБАЛЬНАЯ делегация на document,
// не только внутри #city-detail-content: тот же редактор с 2026-08 смонтирован ещё и в
// форме СОЗДАНИЯ города (#page-city-new), которая — отдельная секция вне #city-detail-content.
// Вставка новой строки ищется через closest('.form-group') от нажатой кнопки — так
// работает независимо от того, сколько копий редактора одновременно в DOM (SPA держит
// все .page смонтированными, просто скрывает неактивные через CSS).
document.addEventListener('click', async e => {
  if (e.target.closest('.cdet-faction-chip')) return; // обработано отдельным листенером выше

  const polAdd = e.target.closest('.cdet-political-add-btn');
  if (polAdd) {
    const rows = polAdd.closest('.form-group')?.querySelector('.cdet-political-rows');
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
  const primAdd = e.target.closest('.cdet-primogen-add-btn');
  if (primAdd) {
    const rows = primAdd.closest('.form-group')?.querySelector('.cdet-primogen-rows');
    if (rows) {
      const occ = new Set();
      rows.querySelectorAll('.cdet-prim-row').forEach(row => {
        const n1 = row.querySelector('.cdet-prim-name-inp')?.value.trim();
        const n2 = row.querySelector('.cdet-prim-name2-inp')?.value.trim();
        if (n1) occ.add(n1); if (n2) occ.add(n2);
      });
      rows.insertAdjacentHTML('beforeend', _primogenRowHtml('', '', '', _cityEditChars.filter(n => !occ.has(n))));
      rows.lastElementChild?.classList.add('row-enter');
      rows.lastElementChild?.querySelector('.cdet-prim-name-inp')?.focus();
    }
    return;
  }
  const locAdd = e.target.closest('.cdet-location-add-btn');
  if (locAdd) {
    const rows = locAdd.closest('.form-group')?.querySelector('.cdet-location-rows');
    if (rows) {
      const idPrefix = rows.dataset.locIdPrefix || 'cdet-edit';
      rows.insertAdjacentHTML('beforeend', _locRowHtml('', '', _cityEditLocs, idPrefix));
      rows.lastElementChild?.classList.add('row-enter');
      rows.lastElementChild?.querySelector('.cdet-loc-name-inp')?.focus();
    }
    return;
  }
  const delBtn = e.target.closest('.cdet-rel-del-btn');
  if (delBtn) {
    const row = delBtn.closest('.cdet-pol-row, .cdet-prim-row, .cdet-loc-row-wrap');
    if (row) _removeRelRow(row);
    return;
  }

  // Блок «Район» (форма создания города) — добавить/удалить карточку, заглушка «+ Локация».
  const distAdd = e.target.closest('.city-districts-add-btn');
  if (distAdd) {
    const list = distAdd.closest('.city-districts-editor')?.querySelector('.city-district-cards');
    if (list) {
      list.insertAdjacentHTML('beforeend', _districtCardHtml());
      list.lastElementChild?.classList.add('row-enter');
      list.lastElementChild?.querySelector('.city-district-name')?.focus();
    }
    return;
  }
  const distDel = e.target.closest('.city-district-del-btn');
  if (distDel) { _removeRelRow(distDel.closest('.city-district-card')); return; }
  const distLocBtn = e.target.closest('.city-district-add-loc-btn');
  if (distLocBtn) {
    const name = distLocBtn.closest('.city-district-card')?.querySelector('.city-district-name')?.value.trim() || '';
    _openDistrictLocationModal(name);
    return;
  }

  if (e.target.closest('[data-city-back]')) { navigate('city-new'); return; }

  const sw = e.target.closest('[data-switch-city]');
  if (sw) { location.search = 'city=' + encodeURIComponent(sw.dataset.switchCity); return; }

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

// Показ/скрытие поля «своя должность/тип/клан» при выборе «Другое…» — глобально,
// та же причина, что у click-делегации выше (редактор смонтирован в двух местах).
document.addEventListener('change', e => {
  const locSel = e.target.closest('.cdet-loc-type-sel');
  if (locSel) { const c = locSel.closest('.cdet-loc-row')?.querySelector('.cdet-loc-type-custom'); if (c) c.style.display = locSel.value === 'other' ? '' : 'none'; return; }
  const polSel = e.target.closest('.cdet-pol-role-sel');
  if (polSel) { const c = polSel.closest('.cdet-pol-row')?.querySelector('.cdet-pol-role-custom'); if (c) c.style.display = polSel.value === 'other' ? '' : 'none'; return; }
  const primSel = e.target.closest('.cdet-prim-clan-sel');
  if (primSel) { const c = primSel.closest('.cdet-prim-row')?.querySelector('.cdet-prim-clan-custom'); if (c) c.style.display = primSel.value === 'other' ? '' : 'none'; return; }
  const distSel = e.target.closest('.city-district-type-sel');
  if (distSel) { const c = distSel.closest('.city-district-card')?.querySelector('.city-district-type-custom'); if (c) c.style.display = distSel.value === 'other' ? '' : 'none'; }
});

// Район/заметка для новой локации показываются, только пока введённое имя не
// совпадает ни с одной уже существующей локацией города (фаза K) — глобально, та же
// причина.
document.addEventListener('input', e => {
  const nameInp = e.target.closest('.cdet-loc-name-inp');
  if (!nameInp) return;
  const wrap = nameInp.closest('.cdet-loc-row-wrap');
  const fields = wrap?.querySelector('.cdet-loc-new-fields');
  if (fields) fields.hidden = !nameInp.value.trim() || _cityEditLocs.includes(nameInp.value.trim());
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
    const editRoot = document.getElementById('city-detail-content');
    const fields = { display, year: q('year').value.trim(), description: q('description').value.trim() };
    for (const [key] of CITY_SECTION_DEFS) {
      if (key === 'political')      fields[key] = _collectPoliticalRows(editRoot);
      else if (key === 'factions')  fields[key] = _collectFactions(editRoot);
      else if (key === 'locations') fields[key] = _collectLocationRows(editRoot);
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
    // Синк «Иерархии»/zone-control в карточки персонажей/локаций (§4.2/§5.2 техспеки) —
    // не блокирующие ошибки: город уже сохранён, это просто оповещение, не диалог.
    if (Array.isArray(r.warnings)) r.warnings.forEach(w => showToast(w, 'warning'));

    // Новые локации из «Ключевых локаций» — создаём настоящие карточки
    // (POST /api/locations), а не просто текстовый тег в city.md (фаза K).
    if (activePane !== 'markdown' && _pendingNewLocations.length) {
      if (statusEl) statusEl.textContent = `⏳ Создаю локации (${_pendingNewLocations.length})...`;
      for (const req of _pendingNewLocations) {
        try {
          const lr = await fetch(`/api/locations?city=${encodeURIComponent(d.slug)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: req.name, district: req.district }),
          }).then(x => x.json());
          // 409 «уже существует» — гонка с параллельным созданием той же локации,
          // не ошибка сохранения города; для остального пропускаем эту заявку.
          if (lr.slug && req.note) {
            await fetch(`/api/locations/${encodeURIComponent(lr.slug)}/fields?city=${encodeURIComponent(d.slug)}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { atmosphere: req.note } }),
            });
          }
        } catch { /* одна неудавшаяся локация не должна срывать сохранение города */ }
      }
      _pendingNewLocations = [];
    }

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
    navigate('city-new');
    if (d.active) {
      // Удалили активный город — переключаемся на любой оставшийся.
      const { cities = [] } = await fetch('/api/cities').then(r => r.json());
      if (cities.length) { location.search = 'city=' + encodeURIComponent(cities[0]); return; }
    }
    if (document.getElementById('cities-grid')) loadCitiesGrid();
  } catch (err) { showToast('Ошибка удаления: ' + err.message, 'error'); }
}

