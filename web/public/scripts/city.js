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
  if (_cityRulesCreateHost && !_cityRulesCreateHost.dataset.ready) {
    _cityRulesCreateHost.innerHTML = _cityRulesEditorHtml('create');
    _cityRulesCreateHost.dataset.ready = '1';
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
  ['factions',   'Фракции'],
  ['political',  'Политический ландшафт'],
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

// Секции вне канонического набора (рукописный city.md, как у Парижа) — СПИСОК, не флаг.
// Раньше возвращался boolean и по нему вкладка «Поля» ЗАПРЕЩАЛАСЬ: PUT с fields делал
// полный buildCityMd-ребилд и такие секции терялись. С точечной записью (§A1) они
// переживают сохранение, поэтому теперь это информирование — перечисляем, что уцелеет.
// Зеркало customCitySections() из web/lib/city_md_writer.js.
function _cityCustomSections(cityMd) {
  const known = new Set(CITY_SECTION_DEFS.map(([, h]) => h.toLowerCase()));
  return [...String(cityMd).matchAll(/^##\s+(.+?)\s*$/gm)]
    .map(m => m[1].trim())
    .filter(h => !known.has(h.toLowerCase()));
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
// Заметка — третье поле строки (техспека §8.1), отделено « — »: «Статус: Название —
// Заметка». Двоеточие уже занято под «Тип: Название», второе использование сломало бы
// разбор — поэтому заметка отделяется тире, не ещё одним двоеточием.
function _parseLocationLines(lines) {
  return lines.map(line => {
    const ci = line.indexOf(':');
    let type = '', rest = line;
    if (ci !== -1) { type = line.slice(0, ci).trim(); rest = line.slice(ci + 1).trim(); }
    let name = rest, note = '';
    const dashIdx = rest.search(/\s+—\s+/);
    if (dashIdx !== -1) {
      name = rest.slice(0, dashIdx).trim();
      note = rest.slice(dashIdx).replace(/^\s+—\s+/, '').trim();
    }
    return { type, name, note };
  });
}
function _locationRowToLine(r) {
  const base = r.type ? `${r.type}: ${r.name}` : r.name;
  // Заметка не должна содержать «—» — иначе разъедет разбор обратно (§8.3); замена на
  // похожий символ, тот же приём, что sanitizeInlineText делает для «|» в других местах.
  const note = r.note ? String(r.note).trim().replace(/—/g, '–') : '';
  return note ? `${base} — ${note}` : base;
}

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
function _locRowHtml(type = '', name = '', note = '', locationNames = _cityEditLocs, idPrefix = 'cdet-edit') {
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
      <input class="cdet-rel-name-inp cdet-loc-status-note-inp" placeholder="Заметка (опц.)" value="${escAttr(note)}">
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
      <label class="form-label">Политический ландшафт<span class="field-tip" tabindex="0" data-tip="Свободное описание расклада сил — тон и нюансы, которые не влезают в структурные поля ниже. Пример: «Камарилья формально у власти, но реальный баланс держится на негласном перемирии с Анархи».">ⓘ</span></label>
      <div class="cdet-rels-hint">Общее описание расклада сил — атмосфера, фракции, конфликты.</div>
      <textarea class="form-control" data-city-field="political-narrative" rows="3"
        placeholder="По строке на пункт…">${escHtml(narrative)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Властители города<span class="field-tip" tabindex="0" data-tip="Именные должности уровня города — Князь, Сенешаль, Шериф, Хранитель Элизиума. Выбери персонажа из уже существующих в городе или впиши имя вручную, если карточки ещё нет. Пример: Должность «Шериф» → Персонаж «Ричард Гарро».">ⓘ</span></label>
      <div class="cdet-rels-hint">Должность — из списка или своя. Имя (и второе, если нужно) — выбери из персонажей или впиши своё. Занятые в других строках персонажи не предлагаются. При выборе существующего персонажа его карточка получит запись в поле «Иерархия» автоматически.</div>
      <div class="cdet-political-rows">${rows}</div>
      <button class="cdet-rel-add-btn cdet-political-add-btn" type="button">+ Добавить запись</button>
    </div>
    <div class="form-group">
      <label class="form-label">Примогенат<span class="field-tip" tabindex="0" data-tip="Один Примоген на клан — представитель клана в Совете Примогенов Камарильи. Клан и персонаж выбираются так же, как для Властителей. Пример: Клан «Тремер» → Примоген «Верене де Кюстин».">ⓘ</span></label>
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
    ? records.map(r => _locRowHtml(r.type, r.name, r.note, _cityEditLocs, idPrefix)).join('')
    : _locRowHtml('', '', '', _cityEditLocs, idPrefix);
  const districts = _parseDistrictNames(sec.districts);
  return `
    <div class="form-group">
      <label class="form-label">Ключевые локации<span class="field-tip" tabindex="0" data-tip="Свободное описание значимых мест города — общий обзор, без привязки к конкретным статусам. Пример: «Опера как элизиум, катакомбы под Монпарнасом как убежище шабашитов».">ⓘ</span></label>
      <div class="cdet-rels-hint">Общее описание ключевых локаций города.</div>
      <textarea class="form-control" data-city-field="locations-narrative" rows="3"
        placeholder="По строке на пункт…">${escHtml(narrative)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Отмеченные локации<span class="field-tip" tabindex="0" data-tip="Привязка конкретной локации к городскому статусу — Элизиум, резиденция Князя и т.д. Выбери уже существующую локацию или впиши новое название — тогда при сохранении создастся настоящая карточка. Пример: Статус «Элизиум» → Локация «Опера Гарнье».">ⓘ</span></label>
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

// Опции дропдауна «Влияние — Секта» — зеркалят ТЕКУЩИЙ выбор в разделе «Фракции»
// (чипы + «Другие фракции»), не отдельный статичный список: район не может держать
// влияние фракции, которой в городе не заявлено. current сохраняется отдельной опцией,
// если её убрали из «Фракции» уже ПОСЛЕ того, как её выбрали здесь — не роняем тихо
// уже сохранённые данные карточки.
function _districtSectOptionsHtml(factionNames, current) {
  const names = [...factionNames];
  if (current && !names.includes(current)) names.push(current);
  if (!names.length) {
    return `<option value="">Сначала выберите фракции ниже…</option>`;
  }
  return [
    `<option value=""${!current ? ' selected' : ''}>Секта/фракция…</option>`,
    ...names.map(n => `<option value="${escAttr(n)}"${n === current ? ' selected' : ''}>${escHtml(n)}</option>`),
  ].join('');
}
// opts.mode: 'create' (форма создания города, пачка карточек сохраняется одним
// POST /api/cities — как сегодня) | 'edit' (город уже существует, §A3: карточка —
// уже существующая District-сущность или ещё не сохранённая, сохраняется/создаётся
// СВОЕЙ кнопкой через PUT/POST .../districts, не общей кнопкой формы города).
// opts.distSlug — слаг существующего района (только 'edit' + persisted). Персистентная
// edit-карточка не показывает кнопку «Убрать» — удаление района вне скоупа §A3 (см. A5,
// backend-эндпоинта ещё нет), молчаливое скрытие из DOM без вызова API было бы обманом.
function _districtCardHtml(d = {}, factionNames = [], opts = {}) {
  const { name = '', type = '', sect = '', clan = '', description = '' } = d;
  const mode      = opts.mode === 'edit' ? 'edit' : 'create';
  const persisted = mode === 'edit' && !!opts.distSlug;
  const known   = DISTRICT_TYPES.includes(type);
  const selVal  = !type ? '' : (known ? type : 'other');
  const custVal = (!known && type) ? type : '';
  const typeOpts = [
    `<option value=""${selVal === '' ? ' selected' : ''}>Тип района…</option>`,
    ...DISTRICT_TYPES.map(o => `<option value="${escAttr(o)}"${o === selVal ? ' selected' : ''}>${escHtml(o)}</option>`),
    `<option value="other"${selVal === 'other' ? ' selected' : ''}>Другое…</option>`,
  ].join('');

  // Персистентная карточка (edit + уже существующий район) — своя кнопка удаления,
  // .city-district-delete-btn (не .city-district-del-btn: та убирает несохранённую
  // строку из DOM без похода на сервер, эта реально вызывает DELETE .../districts —
  // разные последствия, разные классы, чтобы делегированный обработчик не спутал).
  const head = mode === 'edit'
    ? `<span class="city-district-card-title">📍 ${escHtml(name) || 'Новый район'}</span>
       ${persisted
         ? '<button class="cdet-rel-del-btn city-district-delete-btn" type="button" title="Удалить район">✕ Удалить</button>'
         : '<button class="cdet-rel-del-btn city-district-del-btn" type="button" title="Убрать несохранённую карточку">✕ Убрать</button>'}`
    : `<span class="city-district-card-title">📍 Район</span>
       <button class="cdet-rel-del-btn city-district-del-btn" type="button" title="Удалить район">✕ Удалить</button>`;

  const footer = mode === 'edit'
    ? `<div class="city-district-edit-actions">
         <button class="cdet-save-btn city-district-save-btn" type="button">${persisted ? '💾 Сохранить' : '+ Создать район'}</button>
         <span class="cdet-save-msg city-district-save-msg" style="display:none">✓ Сохранено</span>
       </div>`
    // §A3.3: привязка локаций НЕ дублируется в форме редактирования — та же операция
    // уже работает на странице просмотра, куда пользователь и так попадает после
    // сохранения формы (_saveCityEdit → _renderCityView).
    : `<div class="city-district-locs">
         <button class="city-district-add-loc-btn" type="button">+ Добавить локацию</button>
         <div class="form-hint">Локация привязывается к уже СОЗДАННОМУ городу — доступно после сохранения формы.</div>
       </div>`;

  return `<div class="city-district-card" id="city-district-card-${++_districtCardSeq}"
      data-mode="${mode}"${persisted ? ` data-district-slug="${escAttr(opts.distSlug)}"` : ''}>
    <div class="city-district-card-head">${head}</div>
    <div class="form-group">
      <label class="form-label">Наименование района *<span class="field-tip" tabindex="0" data-tip="Название района, каким его знают в городе — станет именем папки в locations/. Пример: «Монмартр», «Ле-Аль».">ⓘ</span></label>
      <input class="form-control city-district-name" type="text" placeholder="Монмартр" value="${escAttr(name)}">
    </div>
    <div class="form-group">
      <label class="form-label">Тип района<span class="field-tip" tabindex="0" data-tip="Общий характер территории — влияет на то, какие сцены и персонажи там уместны по умолчанию. Пример: «Гетто» для промзоны с нищетой и бандами, «Туристический» для района с толпами смертных и низким Маскарадом.">ⓘ</span></label>
      <select class="form-control city-district-type-sel">${typeOpts}</select>
      <input class="form-control city-district-type-custom" placeholder="Свой тип" value="${escAttr(custVal)}" style="${selVal === 'other' ? '' : 'display:none'}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Влияние — Секта<span class="field-tip" tabindex="0" data-tip="Список берётся из раздела «Фракции» выше — сначала выбери фракции там, потом привязывай их к району.">ⓘ</span></label>
        <select class="form-control city-district-sect">${_districtSectOptionsHtml(factionNames, sect)}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Влияние — Клан<span class="field-tip" tabindex="0" data-tip="Какой клан вампиров реально контролирует район — если контроля нет или он оспаривается, оставь пустым. Пример: «Гангрел» держат промзону, хотя формально город — Камарилья.">ⓘ</span></label>
        <input class="form-control city-district-clan" type="text" placeholder="Тремер" value="${escAttr(clan)}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Описание района<span class="field-tip" tabindex="0" data-tip="2–3 предложения о том, чем живёт район и кто там держит власть — то, с чем Рассказчик сверяется, выбирая район для сцены. Пример: «Богемный квартал художников и клубов, ночью — территория Анархи; днём кажется обычным туристическим районом».">ⓘ</span></label>
      <textarea class="form-control city-district-desc" rows="2" placeholder="Чем живёт район, кто держит…">${escHtml(description)}</textarea>
    </div>
    ${footer}
  </div>`;
}
// Текущий выбор в разделе «Фракции» (chips + «Другие фракции») — источник опций
// дропдауна «Влияние — Секта» карточки района. _cityFactionsCreateHost — тот же
// глобал из scripts.js, что уже читает loadCitiesGrid() выше для ленивого инжекта.
// root — как у _collectFactions: без него подобрал бы первую попавшуюся копию чипов
// в document (форма создания и модалка редактирования держат каждая свою). Без root
// (вызовы из формы создания, где живой DOM ещё не тот, что строим) — старое поведение
// через _cityFactionsCreateHost.
function _currentFactionNames(root) {
  if (root) return _collectFactions(root).split('\n').map(s => s.trim()).filter(Boolean);
  return _cityFactionsCreateHost
    ? _collectFactions(_cityFactionsCreateHost).split('\n').map(s => s.trim()).filter(Boolean)
    : [];
}
// Faction names для СБОРКИ HTML района ДО вставки в DOM (initial render формы
// редактирования) — читать чипы неоткуда, они ещё не существуют как элементы;
// парсим тот же текст секции, что и _cityFactionsEditorHtml.
function _factionNamesFromSection(sec) {
  return String((sec && sec.factions) || '').split('\n')
    .map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
}
// Перечитывает опции «Влияние — Секта» во ВСЕХ отрисованных карточках района —
// и в форме создания, и в форме редактирования (SPA держит обе в DOM одновременно,
// не размонтирует страницы при навигации) — вызывается при любом изменении состава
// «Фракции» (клик по чипу / правка «Другие фракции»), чтобы дропдаун не отставал.
function _refreshDistrictSectOptions() {
  document.querySelectorAll('.city-districts-editor').forEach(editor => {
    const formRoot = editor.closest('.city-create-spoiler, .city-edit-panel') || document;
    const names = _currentFactionNames(formRoot);
    editor.querySelectorAll('.city-district-sect').forEach(sel => {
      sel.innerHTML = _districtSectOptionsHtml(names, sel.value);
    });
  });
}
function _cityDistrictsEditorHtml() {
  return `<div class="city-districts-editor" data-mode="create">
    <div class="city-district-cards">${_districtCardHtml({}, _currentFactionNames())}</div>
    <button class="cdet-rel-add-btn city-districts-add-btn" type="button">+ Добавить район</button>
  </div>`;
}
// §A3.1 — та же карточка в режиме 'edit': значения из GET /districts (уже сущности,
// каждая сохраняется своей кнопкой), плюс возможность завести новый район у уже
// существующего города (сегодня это умела только форма создания).
function _cityDistrictsEditEditorHtml(districts, factionNames) {
  const cards = (districts || [])
    .map(d => _districtCardHtml(d, factionNames, { mode: 'edit', distSlug: d.slug }))
    .join('');
  return `<div class="form-group">
    <label class="form-label">Районы${fieldTip(CITY_FIELD_TIPS['Районы'])}</label>
    <div class="city-districts-editor" data-mode="edit">
      <div class="city-district-cards">${cards}</div>
      <button class="cdet-rel-add-btn city-districts-add-btn" type="button">+ Добавить район</button>
    </div>
  </div>`;
}
function _collectDistrictCards(root = document) {
  return Array.from(root.querySelectorAll('.city-district-card')).map(_collectDistrictCard);
}
// Поля ОДНОЙ карточки района — общая часть для пачечного сбора (создание города,
// _collectDistrictCards) и одиночного сохранения (§A3, _saveDistrictCard).
function _collectDistrictCard(card) {
  const name   = card.querySelector('.city-district-name')?.value.trim() || '';
  const sel    = card.querySelector('.city-district-type-sel');
  const custom = card.querySelector('.city-district-type-custom');
  const type   = sel?.value === 'other' ? (custom?.value.trim() || '') : (sel?.value || '');
  const sect   = card.querySelector('.city-district-sect')?.value.trim() || '';
  const clan   = card.querySelector('.city-district-clan')?.value.trim() || '';
  const description = card.querySelector('.city-district-desc')?.value.trim() || '';
  return { name, type, sect, clan, description };
}
// §A3 — сохранение ОДНОЙ карточки района у уже существующего города: PUT для уже
// сохранённого района (по data-district-slug), POST для новой карточки. При успешном
// POST карточка помечается сохранённой на месте (без перерисовки формы — не терять
// фокус/несохранённые правки соседних карточек).
async function _saveDistrictCard(card) {
  const citySlug = _cityDetail?.slug;
  if (!citySlug || !card) return;
  const fields = _collectDistrictCard(card);
  const btn = card.querySelector('.city-district-save-btn');
  const msg = card.querySelector('.city-district-save-msg');
  if (!fields.name) {
    if (msg) { msg.textContent = '⚠ Укажите название'; msg.style.display = ''; msg.style.color = 'var(--c-error)'; }
    return;
  }
  const existingSlug = card.dataset.districtSlug || '';
  const url = existingSlug
    ? `/api/cities/${encodeURIComponent(citySlug)}/districts/${encodeURIComponent(existingSlug)}`
    : `/api/cities/${encodeURIComponent(citySlug)}/districts`;

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Сохранение...'; }
  try {
    const r = await fetch(url, {
      method: existingSlug ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    if (j.warning) showToast(j.warning, 'warning');

    if (!existingSlug && j.slug) {
      // Новая карточка стала персистентной — помечаем на месте, без перерисовки формы.
      card.dataset.districtSlug = j.slug;
      card.querySelector('.city-district-card-title').textContent = `📍 ${fields.name}`;
      // Карточка стала персистентной — «Убрать» (DOM-only) заменяем на «Удалить»
      // (реальный DELETE .../districts), тем же способом, каким карточка рендерилась
      // бы, будь она сразу persisted (_districtCardHtml, opts.persisted).
      const oldDel = card.querySelector('.city-district-del-btn');
      if (oldDel) oldDel.outerHTML = '<button class="cdet-rel-del-btn city-district-delete-btn" type="button" title="Удалить район">✕ Удалить</button>';
    }
    if (msg) { msg.textContent = '✓ Сохранено'; msg.style.color = ''; msg.style.display = ''; setTimeout(() => { if (msg) msg.style.display = 'none'; }, 2500); }
  } catch (e) {
    if (msg) { msg.textContent = `✗ ${e.message}`; msg.style.color = 'var(--c-error)'; msg.style.display = ''; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = existingSlug || card.dataset.districtSlug ? '💾 Сохранить' : '+ Создать район'; }
  }
}
// §A5 — удаление персистентного района. DELETE отвечает 409 со списком локаций
// внутри, если район не пуст (перенос — это перенос папки КАЖДОЙ локации + правка
// ссылок, молча делать это по одному клику опаснее, чем показать явную ошибку) —
// в этом случае показываем список и НЕ удаляем; пользователь сам решает, что делать
// с локациями (страница просмотра уже даёт «Привязать» к другому району).
async function _deleteDistrictCard(card) {
  const citySlug = _cityDetail?.slug;
  const distSlug = card?.dataset.districtSlug;
  if (!citySlug || !distSlug) return;
  const title = card.querySelector('.city-district-card-title')?.textContent.replace(/^📍\s*/, '').trim() || distSlug;

  const ok = await showConfirm(`Удалить район «${title}»? Действие необратимо из этой формы.`, { confirmText: 'Удалить' });
  if (!ok) return;

  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(citySlug)}/districts/${encodeURIComponent(distSlug)}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 409 && Array.isArray(j.locations) && j.locations.length) {
        showToast(`${j.error} (${j.locations.join(', ')})`, 'error');
      } else {
        showToast(j.error || 'Не удалось удалить район', 'error');
      }
      return;
    }
    if (j.warning) showToast(j.warning, 'warning');
    card.classList.add('row-exit');
    card.addEventListener('animationend', () => card.remove(), { once: true });
    setTimeout(() => card.remove(), 250);
    showToast(`Район «${title}» удалён`, 'success');
  } catch (e) {
    showToast(`Не удалось удалить район: ${e.message}`, 'error');
  }
}
// «+ Добавить локацию» внутри карточки района — открывает общую модалку
// создания/редактирования локации (locations.js: openLocEditModal), с
// предзаполненным и задизейбленным полем «Район» (см. её JSDoc-комментарий
// про prefilledDistrict — только для создания, slug=null).
function _openDistrictLocationModal(districtName) {
  if (typeof openLocEditModal === 'function') {
    openLocEditModal(null, districtName);
    return;
  }
  showToast('Модалка создания локации ещё не подключена в этой копии — добавьте локацию через страницу «Локации» после создания района', 'warning');
}

// Мультиселект-чипы: секты Камарилья/Анархи/Шабаш + независимые кланы. Храним как
// буллет-список (по строке на выбор) — та же конвенция, что у простых секций.
// Строки, не совпавшие ни с одним чипом (рукописные/нестандартные фракции — Инконню
// и т.п.), не теряются: их показываем в поле «Другие фракции» и сохраняем как есть.
// Секции «живого города» в форме СОЗДАНИЯ (§A2). Пять из них — рабочий вход генерации
// (buildCityConstraints/buildCityNaming), а завести их при создании было негде: POST
// /api/cities молча терял эти ключи, и свежий город уходил в генерацию без ограничений.
// «Районы» здесь нет намеренно — они заводятся карточками в блоке «География» выше.
// Подсказки берутся из CITY_FIELD_TIPS (общий источник с формой редактирования).
const CITY_RULE_SECTIONS = [
  ['landmarks', 'Значимые места'],
  ['hunting',   'Охотничьи угодья'],
  ['edicts',    'Законы домена'],
  ['mortals',   'Смертные институции'],
  ['calendar',  'Календарь города'],
  ['tech',      'Технологии и Маскарад'],
  ['limits',    'Ограничения генерации'],
  ['naming',    'Именник и фактура'],
];
// Значимые места заводятся только после создания города — через просмотр/
// редактирование (T4, 2026-08-04); форма создания их не показывает.
const CITY_RULE_SECTIONS_CREATE = CITY_RULE_SECTIONS.filter(([key]) => key !== 'landmarks');

// mode: 'create' — id="city-<key>" (адресация формы создания, scripts.js
//   getElementById), пустые поля. 'edit' — data-city-field="<key>" (адресация
//   _saveCityEdit, querySelector), предзаполнено из sec[key]. Разные атрибуты —
//   не косметика: #page-city и #page-city-new сосуществуют в DOM одновременно
//   (видимость через CSS), совпадающие id дали бы коллизию.
function _cityRulesEditorHtml(mode = 'create', sec = {}) {
  const sections = mode === 'edit' ? CITY_RULE_SECTIONS : CITY_RULE_SECTIONS_CREATE;
  return sections.map(([key, heading]) => {
    const attr = mode === 'edit' ? `data-city-field="${key}"` : `id="city-${key}"`;
    const value = mode === 'edit' ? escHtml(sec[key] || '') : '';
    const forAttr = mode === 'edit' ? '' : ` for="city-${key}"`;
    return `
    <div class="form-group">
      <label class="form-label"${forAttr}>${escHtml(heading)}${fieldTip(CITY_FIELD_TIPS[heading])}</label>
      <textarea class="form-control" ${attr} rows="2" placeholder="По строке на пункт…">${value}</textarea>
    </div>`;
  }).join('');
}

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
      <label class="form-label">Фракции<span class="field-tip" tabindex="0" data-tip="Секты и независимые кланы, реально присутствующие в городе — источник списка для дропдауна «Влияние — Секта» в блоке «Район» ниже. Пример: отметь «Камарилья» и «Анархи», если обе секты представлены.">ⓘ</span></label>
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
    const note   = row.querySelector('.cdet-loc-status-note-inp')?.value.trim() || '';
    if (name && !_cityEditLocs.includes(name)) {
      newLocationRequests.push({
        name,
        district: wrap.querySelector('.cdet-loc-new-district')?.value.trim() || '',
        note:     wrap.querySelector('.cdet-loc-new-note')?.value.trim() || '',
      });
    }
    return { type, name, note };
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

  let d, chars = [], locs = [], districts = [];
  try {
    [d, chars, locs, districts] = await Promise.all([
      fetch(`/api/cities/${encodeURIComponent(slug)}/detail`).then(r => r.json()),
      fetch(`/api/characters?city=${encodeURIComponent(slug)}`).then(r => r.json()).catch(() => []),
      fetch(`/api/locations?city=${encodeURIComponent(slug)}`).then(r => r.json()).catch(() => []),
      fetch(`/api/cities/${encodeURIComponent(slug)}/districts`).then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
  } catch { content.innerHTML = '<div class="cdet-empty" style="padding:40px">⚠ Не удалось загрузить город</div>'; return; }
  if (d.error) { content.innerHTML = `<div class="cdet-empty" style="padding:40px">${escHtml(d.error)}</div>`; return; }

  _cityEditChars = Array.isArray(chars) ? chars.map(c => c.name).filter(Boolean) : [];
  _cityEditLocs  = Array.isArray(locs) ? locs.map(l => l.title).filter(Boolean) : [];
  _cityDetail = {
    ...d, slug, active: slug === CITY,
    locations: Array.isArray(locs) ? locs : [],
    districts: Array.isArray(districts) ? districts : [],
  };
  _renderCityView();
}

// Паритет с формой создания (техспека §9.1) — read-only карточки района на странице
// просмотра. Переиспользует .locdet-table/-row/-key/-val — тот же паттерн «список пар
// ключ-значение», что уже показывает вкладка «Метаданные» детальной модалки локации
// (designspec §7.1), не третий способ показывать пары «подпись: значение» в проекте.
function _cityViewDistrictsHtml() {
  const d = _cityDetail;
  const districts = d.districts || [];
  const locations = d.locations || [];
  // Раздел раньше пропадал целиком при 0 районов — блок с заголовком остаётся,
  // с пустым состоянием, вместо того чтобы «Районы» незаметно исчезали со страницы.
  if (!districts.length) {
    return `<div class="city-view-districts">
      <div class="city-create-section-label">Районы</div>
      <div class="cdet-empty">Районов пока нет</div>
    </div>`;
  }

  const cards = districts.map(dist => {
    const inDistrict = locations.filter(l => (l.dirRelPath || '').split('/')[0] === dist.slug);
    const elsewhere   = locations.filter(l => (l.dirRelPath || '').split('/')[0] !== dist.slug);

    const locsHtml = inDistrict.length
      ? inDistrict.map(l => `<div class="city-view-district-loc-row">
          <span>${escHtml(l.title || l.slug)}</span>
          <button class="chr-modal-btn" type="button" data-open-loc="${escAttr(l.slug)}">Открыть</button>
        </div>`).join('')
      : '<div class="cdet-empty">Пока пусто</div>';

    const attachRow = elsewhere.length
      ? `<div class="city-view-district-attach-row">
          <select class="form-control city-view-district-attach-sel">
            ${elsewhere.map(l => `<option value="${escAttr(l.slug)}">${escHtml(l.title || l.slug)}</option>`).join('')}
          </select>
          <button class="chr-modal-btn" type="button" data-attach-loc-btn data-district-slug="${escAttr(dist.slug)}">Привязать</button>
        </div>`
      : `<div class="city-view-district-attach-row">
          <select class="form-control city-view-district-attach-sel" disabled><option>Нет свободных локаций</option></select>
          <button class="chr-modal-btn" type="button" disabled>Привязать</button>
        </div>`;

    return `<div class="city-district-card city-district-card-view">
      <div class="city-district-card-head">
        <span class="city-district-card-title">📍 ${escHtml(dist.name || dist.slug)}</span>
      </div>
      <div class="locdet-table">
        <div class="locdet-row"><div class="locdet-key">Тип</div><div class="locdet-val">${escHtml(dist.type || '—')}</div></div>
        <div class="locdet-row"><div class="locdet-key">Влияние</div><div class="locdet-val">${escHtml([dist.sect, dist.clan].filter(Boolean).join(' / ') || '—')}</div></div>
        <div class="locdet-row"><div class="locdet-key">Описание</div><div class="locdet-val">${escHtml(dist.description || '—')}</div></div>
      </div>
      <div class="city-district-locs">
        <div class="cdet-rels-hint">Локации в районе:</div>
        ${locsHtml}
        ${attachRow}
        <button class="city-view-district-add-loc-btn" type="button" data-district-name="${escAttr(dist.name || dist.slug)}">+ Создать новую</button>
      </div>
    </div>`;
  }).join('');

  return `<div class="city-view-districts">
    <div class="city-create-section-label">Районы</div>
    <div class="city-district-cards">${cards}</div>
  </div>`;
}

// ── Вкладки просмотра города (V1-V5, 2026-08-04) ────────────────────────────────
// Read-only рендер: заголовок + текст секции, без формы. Общий блок для всех
// текстовых полей вкладок «Общая»/«Политика»/«География» — не форма, но и не
// голая пустота под заголовком, если секция не заполнена (иначе неотличимо от
// «вкладка не догрузилась», designspec §2).
function _cityViewFieldHtml(heading, text) {
  const val = String(text || '').trim();
  return `<div class="form-group">
    <label class="form-label">${escHtml(heading)}</label>
    ${val ? `<div class="md-body">${mdToHtmlBlock(val)}</div>` : '<div class="cdet-empty">— не заполнено —</div>'}
  </div>`;
}

// «Правила и ограничения города» (V2) — контейнер только для полей, оставшихся
// без отдельной строки на вкладке «Общая»: Смертные институции/Ограничения
// генерации/Именник и фактура (workplan «уточнение №1»). Не переиспользует
// CITY_RULE_SECTIONS (создание/редактирование, 8 ключей) — здесь другой,
// меньший состав по итогам ответов на уточняющие вопросы этого цикла.
const CITY_VIEW_RULES_FIELDS = [
  ['mortals', 'Смертные институции'],
  ['limits',  'Ограничения генерации'],
  ['naming',  'Именник и фактура'],
];

function _cityViewGeneralHtml(sec, d) {
  const display     = (d.parsed && d.parsed.display) || d.slug;
  const year        = (d.parsed && d.parsed.year) || '';
  const description = (d.parsed && d.parsed.description) || '';
  return `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Название</label>
        <div class="md-body">${escHtml(display)}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Год</label>
        <div class="md-body">${escHtml(year || '—')}</div>
      </div>
    </div>
    ${_cityViewFieldHtml('Сеттинг', description)}
    ${_cityViewFieldHtml('Законы домена', sec.edicts)}
    ${_cityViewFieldHtml('Календарь города', sec.calendar)}
    ${_cityViewFieldHtml('Технологии и Маскарад', sec.tech)}
    ${_cityViewFieldHtml('Лейтмотивы и атмосфера', sec.leitmotif)}
    ${_cityViewFieldHtml('Специфика ответа', sec.specifics)}
    ${_cityViewFieldHtml('Чего избегать', sec.avoid)}
    ${_cityViewFieldHtml('Источники', sec.sources)}
    <details class="city-create-spoiler city-create-subspoiler">
      <summary>Правила и ограничения города</summary>
      ${CITY_VIEW_RULES_FIELDS.map(([key, heading]) => _cityViewFieldHtml(heading, sec[key])).join('')}
    </details>`;
}

function _cityViewRecordRow(key, val) {
  return `<div class="locdet-row"><div class="locdet-key">${escHtml(key || '—')}</div><div class="locdet-val">${escHtml(val || '—')}</div></div>`;
}

// Переиспользует те же функции разбора, что и структурный редактор формы
// редактирования (_cityPolEditorHtml выше) — не парсит секцию заново, только
// рендерит результат read-only парами «должность/клан → имя» (.locdet-table,
// тот же компонент, что уже показывает read-only данные района).
function _cityViewPoliticalHtml(sec) {
  const { narrative, recordLines } = _splitCitySectionRecords(sec.political || '', _POL_LABELS);
  const allRecords = _parsePoliticalLines(recordLines);
  const { political: records, primogen: primRecords } = _splitPoliticalRecordsByKind(allRecords);
  const rowsHtml = list => list.length
    ? `<div class="locdet-table">${list.map(r => _cityViewRecordRow(r.role || r.clan, [r.name, r.name2].filter(Boolean).join(' / '))).join('')}</div>`
    : '<div class="cdet-empty">Не назначено</div>';
  return `
    <div class="form-group">
      <label class="form-label">Властители города</label>
      ${rowsHtml(records)}
    </div>
    <div class="form-group">
      <label class="form-label">Примогенат</label>
      ${rowsHtml(primRecords)}
    </div>
    ${_cityViewFieldHtml('Политический ландшафт', narrative)}`;
}

// Статичные чипы (<span>, не <button>) — переиспользуют разбор из
// _cityFactionsEditorHtml, но не переключаются: .chip-view (styles.css) гасит
// cursor/hover/active того же класса, чтобы не выглядеть кликабельным там, где
// клик ничего не делает (designspec §3).
function _cityViewFactionsHtml(sec) {
  const all = String(sec.factions || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
  const known = new Set([...CITY_SECTS, ...CITY_INDEPENDENT_CLANS]);
  const sects = CITY_SECTS.filter(s => all.includes(s));
  const clans = CITY_INDEPENDENT_CLANS.filter(c => all.includes(c));
  const other = all.filter(l => !known.has(l));
  const chips = names => `<div class="cdet-faction-chips">${names.map(n => `<span class="cdet-faction-chip chip-view">${escHtml(n)}</span>`).join('')}</div>`;
  const group = (heading, names, emptyText) => `
    <div class="form-group">
      <div class="cdet-faction-group-label">${escHtml(heading)}</div>
      ${names.length ? chips(names) : `<div class="cdet-empty">${escHtml(emptyText)}</div>`}
    </div>`;
  // Пустая группа секты/кланов скрывается целиком (не показывать заголовок над
  // пустым местом — это не форма, где пустое поле нормально, designspec §3).
  return `
    ${sects.length ? group('Секты', sects) : ''}
    ${clans.length ? group('Независимые кланы', clans) : ''}
    ${group('Другие фракции', other, 'Нет')}`;
}

// «Значимые места» — таблица `| Название | Описание |` вместо буллет-листа
// (V5, техспека 2026-08-04). Разбор — по образцу parseLocation()'s keyPoints
// (web/lib/parsers/location.js): строки-таблицы, разделитель/шапка отфильтрованы.
// isTable различает «таблица с 0 строк данных» (после сохранения без записей)
// от «формат ещё не табличный» (буллет-лист старого города, буллеты сняты
// parseCityMd) — без этого пустая сохранённая таблица считывалась бы обратно
// как 3 фантомные записи из собственных строк шапки/разделителя.
function parseLandmarkRows(text) {
  const raw = String(text || '');
  const isTable = /^\s*\|/m.test(raw);
  const rows = (raw.match(/^\|[^|\n]+\|[^|\n]*\|/gm) || [])
    .filter(r => !/-{3}/.test(r) && !/^\|\s*\*?\*?(?:Название|Name)\*?\*?\s*\|/i.test(r))
    .map(r => {
      const cells = r.split('|').slice(1, -1).map(c => c.replace(/\*\*/g, '').trim());
      return { name: cells[0] || '', desc: cells[1] || '' };
    })
    .filter(r => r.name);
  if (isTable) return rows;
  // Устаревший формат (буллет-лист без таблицы, из старого city.md) — вся строка
  // становится названием без описания, чтобы не терять данные при первом
  // открытии старого города.
  return raw.split('\n').map(l => l.trim()).filter(Boolean).map(name => ({ name, desc: '' }));
}

// Спойлер-блок (техспека 2026-08-05, Т1-Т4): каждое действие (правка/
// удаление/создание записи) — отдельный PUT сразу же, общей кнопки
// «Сохранить» на весь список больше нет. _cityLandmarksRows — источник
// правды на время просмотра вкладки: мутируется КОПИЯ на каждое действие,
// применяется в _cityLandmarksRows только по успеху сети (см.
// _saveLandmarksMutation) — при ошибке экран остаётся как был.
let _cityLandmarksRows = [];

function _cityLandmarkItemHtml(r, i) {
  return `<details class="city-landmark-item" data-landmark-idx="${i}">
    <summary class="city-landmark-summary">${escHtml(r.name)}</summary>
    <div class="city-landmark-body">
      <input class="form-control city-landmark-name-inp" value="${escAttr(r.name)}" placeholder="Название…">
      <textarea class="form-control city-landmark-desc-inp" rows="2" placeholder="Описание…">${escHtml(r.desc)}</textarea>
      <div class="city-landmark-item-actions">
        <button type="button" class="chr-modal-btn create city-landmark-save-btn">✓ Сохранить</button>
        <button type="button" class="chr-modal-btn danger city-landmark-del-btn">🗑 Удалить</button>
      </div>
    </div>
  </details>`;
}

// Полный ре-рендер списка после любого мутирующего действия — проще и
// надёжнее точечного патча одного <details> по индексу (индексы сдвигаются
// после add/delete); список короткий, цена перерисовки не ощущается.
function _renderCityLandmarksList() {
  if (!_cityLandmarksRows.length) return '<div class="cdet-empty">Значимых мест пока нет</div>';
  return _cityLandmarksRows.map(_cityLandmarkItemHtml).join('');
}

function _cityLandmarkCreateRowHtml() {
  return `
    <div id="city-landmark-create-row" class="hooks-item" style="display:none">
      <input class="hooks-input city-landmark-title-inp" id="city-landmark-create-name" placeholder="Название…">
      <input class="hooks-input city-landmark-desc-inp" id="city-landmark-create-desc" placeholder="Описание…">
      <button type="button" class="chr-modal-btn create" id="city-landmark-create-save">✓ Сохранить</button>
      <button type="button" class="chr-modal-btn cancel" id="city-landmark-create-cancel">Отмена</button>
    </div>
    <button class="hooks-add-btn" type="button" id="city-landmarks-add-btn">+ Добавить запись</button>`;
}

function _cityViewLandmarksHtml(sec) {
  _cityLandmarksRows = parseLandmarkRows(sec.landmarks || '');
  return `
    <div class="form-group">
      <label class="form-label">Значимые места</label>
      <div id="city-landmarks-list">${_renderCityLandmarksList()}</div>
      ${_cityLandmarkCreateRowHtml()}
    </div>`;
}

// Сериализация в markdown-таблицу — тот же приём (fold «|» в «∣»), что уже
// применяет _collectLocDetKeyPoints для «Ключевых точек» локации
// (web/public/scripts/locations.js), только принимает готовый массив, а не
// читает DOM (каждое действие мутирует только свою запись, не весь экран).
// 0 записей → таблица с одной пустой строкой данных — секция уже в
// табличном формате, откат на буллет-лист был бы лишним особым случаем.
function _serializeLandmarksTable(rows) {
  const esc = s => String(s).replace(/\|/g, '∣');
  const clean = rows.filter(r => r.name || r.desc);
  return clean.length
    ? `| Название | Описание |\n|---|---|\n${clean.map(r => `| ${esc(r.name)} | ${esc(r.desc)} |`).join('\n')}`
    : '| Название | Описание |\n|---|---|\n| | |';
}

// mutate: (rows) => rows — чистая функция над КОПИЕЙ текущего состояния.
// onOk() вызывается только по успеху — при ошибке _cityLandmarksRows не
// трогается, поля на экране остаются как были.
async function _saveLandmarksMutation(mutate, btn, onOk) {
  const next = mutate(_cityLandmarksRows.slice());
  const table = _serializeLandmarksTable(next);
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(_cityDetail.slug)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { landmarks: table } }),
    }).then(x => x.json());
    if (!r.ok) {
      showToast(r.error || 'Не удалось сохранить', 'error');
      if (btn) btn.disabled = false;
      return;
    }
    _cityLandmarksRows = next;
    onOk();
  } catch (e) {
    showToast('Не удалось сохранить: ' + e.message, 'error');
    if (btn) btn.disabled = false;
  }
}

function _closeLandmarkCreateRow() {
  const row = document.getElementById('city-landmark-create-row');
  if (row) row.style.display = 'none';
  const nameInp = document.getElementById('city-landmark-create-name');
  const descInp = document.getElementById('city-landmark-create-desc');
  if (nameInp) nameInp.value = '';
  if (descInp) descInp.value = '';
  const addBtn = document.getElementById('city-landmarks-add-btn');
  if (addBtn) addBtn.style.display = '';
}

function _cityViewGeographyHtml(sec) {
  return `
    ${_cityViewDistrictsHtml()}
    ${_cityViewLandmarksHtml(sec)}
    ${_cityViewFieldHtml('Ключевые локации', sec.locations)}
    ${_cityViewFieldHtml('Охотничьи угодья', sec.hunting)}`;
}

function _renderCityView() {
  const d = _cityDetail;
  const content = document.getElementById('city-detail-content');
  const display = (d.parsed && d.parsed.display) || d.slug;
  const sec = (d.parsed && d.parsed.sections) || {};

  const meta = [
    d.parsed && d.parsed.year ? `<span class="chp-meta-item">📅 ${escHtml(d.parsed.year)}</span>` : '',
    d.characters ? `<span class="chp-meta-item">🎭 ${d.characters} персонажей</span>` : '',
    d.modules    ? `<span class="chp-meta-item">📖 ${d.modules} модулей</span>` : '',
    // d.locations здесь — массив карточек локаций (см. loadCityPage(), нужен
    // _cityViewDistrictsHtml() для карточек районов), не число, в отличие от
    // d.characters/d.modules — считаем длину, иначе в шаблон утекает toString() массива.
    d.locations?.length ? `<span class="chp-meta-item">📍 ${d.locations.length} локаций</span>` : '',
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
    <div class="cdet-tab-bar city-view-tabs">
      <button class="cdet-tab active" data-city-view-tab="general">Общая</button>
      <button class="cdet-tab" data-city-view-tab="political">Политика</button>
      <button class="cdet-tab" data-city-view-tab="factions">Фракции</button>
      <button class="cdet-tab" data-city-view-tab="geography">География</button>
    </div>
    <div class="city-page-body">
      <div class="city-view-panel active" data-city-view-pane="general">${_cityViewGeneralHtml(sec, d)}</div>
      <div class="city-view-panel" data-city-view-pane="political">${_cityViewPoliticalHtml(sec)}</div>
      <div class="city-view-panel" data-city-view-pane="factions">${_cityViewFactionsHtml(sec)}</div>
      <div class="city-view-panel" data-city-view-pane="geography">${_cityViewGeographyHtml(sec)}</div>
    </div>`;
}

// Привязка уже существующей локации к району со страницы просмотра (техспека §9.2) —
// физический перенос папки, заметное последствие, поэтому подтверждающий диалог перед
// вызовом (designspec §7.2), не тихое срабатывание по одному клику на дропдауне.
async function _attachLocationToDistrict(districtSlug, locSlug, locLabel, districtLabel) {
  const ok = await showConfirm(
    `Привязать «${locLabel}» к району «${districtLabel}»? Папка локации физически переедет на диске.`,
    { confirmText: 'Привязать' }
  );
  if (!ok) return;
  try {
    const r = await fetch(`/api/locations/${encodeURIComponent(locSlug)}/district?city=${encodeURIComponent(_cityDetail.slug)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ district: districtSlug }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const res = await r.json().catch(() => ({}));
    // linksUpdated — сколько файлов со ссылками на локацию поправлено вместе с
    // переносом (§B1). Показываем: перенос затрагивает не только папку, и молчать
    // об этом — та же непрозрачность, из-за которой ссылки раньше просто ломались.
    if (res.warning) showToast(res.warning, 'warning');
    const linksNote = res.linksUpdated ? `, ссылок обновлено: ${res.linksUpdated}` : '';
    showToast(`«${locLabel}» привязана к району «${districtLabel}»${linksNote}`, 'success');
    await loadCityPage();
  } catch (e) {
    showToast(`Не удалось привязать локацию: ${e.message}`, 'error');
  }
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
  'Районы': 'Формальные районы города — каждый со своей карточкой (тип/влияние/описание). Правится и создаётся своей кнопкой на карточке, не общей кнопкой формы.',
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
  const custom = _cityCustomSections(d.cityMd);

  // Ключи «живого города» (landmarks/hunting/edicts/…) выносятся из общего плоского
  // цикла в отдельный свёрнутый блок «Правила и ограничения города» ниже (T5,
  // 2026-08-04) — тот же компонент и заголовок, что в форме создания.
  const ruleKeys = new Set(CITY_RULE_SECTIONS.map(([key]) => key));
  const fieldRows = CITY_SECTION_DEFS.map(([key, heading]) => {
    if (key === 'political') return _cityPolEditorHtml(sec);
    if (key === 'factions')  return _cityFactionsEditorHtml(sec);
    if (key === 'locations') return _cityLocEditorHtml(sec);
    // §A3 — карточки District-сущностей вместо textarea; секция «## Районы» в city.md
    // теперь одностороннее зеркало (синкается сервером при POST/PUT района), форма её
    // не редактирует напрямую — см. пропуск ключа 'districts' в _saveCityEdit ниже.
    if (key === 'districts') return _cityDistrictsEditEditorHtml(d.districts, _factionNamesFromSection(sec));
    if (ruleKeys.has(key)) return '';
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
        <button class="cdet-tab active" data-city-tab="fields">Поля</button>
        <button class="cdet-tab" data-city-tab="markdown">Markdown</button>
      </div>
    </div>
    <div class="city-page-body">
      <div class="cdet-panel city-edit-panel active" data-city-pane="fields">
        ${custom.length ? `<div class="canon-warn" style="margin-bottom:10px">У этого города есть свои секции (${custom.map(escHtml).join(', ')}) — они сохранятся без изменений.</div>` : ''}
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
        <details class="city-create-spoiler city-create-subspoiler">
          <summary>Правила и ограничения города</summary>
          ${_cityRulesEditorHtml('edit', sec)}
        </details>
      </div>
      <div class="cdet-panel city-edit-panel" data-city-pane="markdown">
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
    _refreshDistrictSectOptions();
  }
});
// «Другие фракции» — свободный текст, тоже часть состава «Фракции» (см. _collectFactions),
// дропдаун «Влияние — Секта» должен подхватывать и его правки, не только чипы.
document.addEventListener('input', e => {
  if (e.target.closest('[data-city-field="factions-other"]')) _refreshDistrictSectOptions();
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
      rows.insertAdjacentHTML('beforeend', _locRowHtml('', '', '', _cityEditLocs, idPrefix));
      rows.lastElementChild?.classList.add('row-enter');
      rows.lastElementChild?.querySelector('.cdet-loc-name-inp')?.focus();
    }
    return;
  }
  const delBtn = e.target.closest('.cdet-rel-del-btn');
  if (delBtn) {
    // Кнопка удаления карточки района тоже несёт класс .cdet-rel-del-btn (общая
    // стилизация «✕»), но её родитель — .city-district-card, не один из трёх типов
    // строк ниже. Раньше здесь был безусловный return: клик по ней находил row===null
    // и просто гас, не доходя до обработчика .city-district-del-btn ниже — район было
    // невозможно удалить. Return только когда действительно обработали клик.
    const row = delBtn.closest('.cdet-pol-row, .cdet-prim-row, .cdet-loc-row-wrap');
    if (row) { _removeRelRow(row); return; }
  }

  // Блок «Район» — добавить/удалить/сохранить карточку. Работает и в форме создания
  // (mode='create', пачечное сохранение), и в форме редактирования (mode='edit', §A3,
  // своя кнопка на карточку) — режим и корень для списка фракций берутся из ближайшего
  // .city-districts-editor, не жёстко прибиты к форме создания.
  const distAdd = e.target.closest('.city-districts-add-btn');
  if (distAdd) {
    const editor = distAdd.closest('.city-districts-editor');
    const list = editor?.querySelector('.city-district-cards');
    if (list) {
      const mode = editor.dataset.mode === 'edit' ? 'edit' : 'create';
      const formRoot = editor.closest('.city-create-spoiler, .city-edit-panel');
      const names = mode === 'edit' ? _currentFactionNames(formRoot) : _currentFactionNames();
      list.insertAdjacentHTML('beforeend', _districtCardHtml({}, names, { mode }));
      list.lastElementChild?.classList.add('row-enter');
      list.lastElementChild?.querySelector('.city-district-name')?.focus();
    }
    return;
  }
  const distDel = e.target.closest('.city-district-del-btn');
  if (distDel) { _removeRelRow(distDel.closest('.city-district-card')); return; }
  const distDeleteBtn = e.target.closest('.city-district-delete-btn');
  if (distDeleteBtn) { await _deleteDistrictCard(distDeleteBtn.closest('.city-district-card')); return; }
  const distSave = e.target.closest('.city-district-save-btn');
  if (distSave) { await _saveDistrictCard(distSave.closest('.city-district-card')); return; }
  const distLocBtn = e.target.closest('.city-district-add-loc-btn');
  if (distLocBtn) {
    const name = distLocBtn.closest('.city-district-card')?.querySelector('.city-district-name')?.value.trim() || '';
    _openDistrictLocationModal(name);
    return;
  }

  if (e.target.closest('[data-city-back]')) { navigate('city-new'); return; }

  const openLocBtn = e.target.closest('[data-open-loc]');
  if (openLocBtn) {
    ensureLocsLoaded().then(() => openLocDetail(openLocBtn.dataset.openLoc));
    return;
  }
  const viewDistLocBtn = e.target.closest('.city-view-district-add-loc-btn');
  if (viewDistLocBtn) { _openDistrictLocationModal(viewDistLocBtn.dataset.districtName || ''); return; }
  const attachBtn = e.target.closest('[data-attach-loc-btn]');
  if (attachBtn) {
    const sel = attachBtn.closest('.city-view-district-attach-row')?.querySelector('.city-view-district-attach-sel');
    const locSlug = sel?.value;
    if (!locSlug) return;
    const districtSlug  = attachBtn.dataset.districtSlug;
    const districtLabel = attachBtn.closest('.city-district-card')?.querySelector('.city-district-card-title')?.textContent.replace(/^📍\s*/, '') || districtSlug;
    const locLabel = sel.options[sel.selectedIndex]?.textContent || locSlug;
    _attachLocationToDistrict(districtSlug, locSlug, locLabel, districtLabel);
    return;
  }

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
  // Вкладки формы ПРОСМОТРА (V1, 2026-08-04) — отдельный атрибут/классы от
  // [data-city-tab]/[data-city-pane] выше (форма редактирования): оба рендера
  // пишут в один #city-detail-content, но не одновременно — коллизий по DOM
  // нет, раздельные атрибуты просто чище читаются.
  const viewTab = e.target.closest('[data-city-view-tab]');
  if (viewTab) {
    const which = viewTab.dataset.cityViewTab;
    document.querySelectorAll('[data-city-view-tab]').forEach(b => b.classList.toggle('active', b === viewTab));
    document.querySelectorAll('[data-city-view-pane]').forEach(p => p.classList.toggle('active', p.dataset.cityViewPane === which));
    return;
  }

  // «Значимые места» — блок спойлеров (техспека 2026-08-05, Т1-Т4): каждое
  // действие — свой PUT сразу же, см. _saveLandmarksMutation выше.
  if (e.target.closest('.city-landmark-save-btn')) {
    const item = e.target.closest('.city-landmark-item');
    const i = Number(item.dataset.landmarkIdx);
    const name = item.querySelector('.city-landmark-name-inp').value.trim();
    const desc = item.querySelector('.city-landmark-desc-inp').value.trim();
    if (!name) { showToast('Укажите название', 'error'); return; }
    await _saveLandmarksMutation(
      rows => { rows[i] = { name, desc }; return rows; },
      e.target,
      () => {
        showToast('Сохранено', 'success');
        const list = document.getElementById('city-landmarks-list');
        if (list) list.innerHTML = _renderCityLandmarksList();
      },
    );
    return;
  }
  if (e.target.closest('.city-landmark-del-btn')) {
    const item = e.target.closest('.city-landmark-item');
    const i = Number(item.dataset.landmarkIdx);
    if (!(await showConfirm(`Удалить «${_cityLandmarksRows[i].name}»?`, { danger: true, confirmText: 'Удалить' }))) return;
    await _saveLandmarksMutation(
      rows => { rows.splice(i, 1); return rows; },
      e.target,
      () => {
        showToast('Удалено', 'success');
        const list = document.getElementById('city-landmarks-list');
        if (list) list.innerHTML = _renderCityLandmarksList();
      },
    );
    return;
  }
  if (e.target.closest('#city-landmarks-add-btn')) {
    const row = document.getElementById('city-landmark-create-row');
    if (row) row.style.display = 'flex';
    e.target.style.display = 'none';
    document.getElementById('city-landmark-create-name')?.focus();
    return;
  }
  if (e.target.closest('#city-landmark-create-cancel')) { _closeLandmarkCreateRow(); return; }
  if (e.target.closest('#city-landmark-create-save')) {
    const name = document.getElementById('city-landmark-create-name').value.trim();
    const desc = document.getElementById('city-landmark-create-desc').value.trim();
    if (!name) { showToast('Укажите название', 'error'); return; }
    await _saveLandmarksMutation(
      rows => { rows.push({ name, desc }); return rows; },
      e.target,
      () => {
        showToast('Добавлено', 'success');
        const list = document.getElementById('city-landmarks-list');
        if (list) list.innerHTML = _renderCityLandmarksList();
        _closeLandmarkCreateRow();
      },
    );
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
      // 'districts' сюда не попадает вовсе: секция «## Районы» — зеркало, которое
      // синкает сервер при POST/PUT района (§A3.2), а не поле общей формы города.
      // Ключ, не пришедший в fields, PUT /api/cities не трогает (§A1.6).
      else if (key === 'districts') continue;
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
    const [fresh, freshLocs, freshDistricts] = await Promise.all([
      fetch(`/api/cities/${encodeURIComponent(d.slug)}/detail`).then(r => r.json()),
      fetch(`/api/locations?city=${encodeURIComponent(d.slug)}`).then(r => r.json()).catch(() => []),
      fetch(`/api/cities/${encodeURIComponent(d.slug)}/districts`).then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
    _cityDetail = {
      ...fresh, slug: d.slug, active: d.slug === CITY,
      locations: Array.isArray(freshLocs) ? freshLocs : [],
      districts: Array.isArray(freshDistricts) ? freshDistricts : [],
    };
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

