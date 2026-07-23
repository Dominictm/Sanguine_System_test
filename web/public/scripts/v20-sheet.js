'use strict';
// V20 character sheet: structured editor, library picker (disciplines/psychics/
// merits/flaws), AI-markdown parsing, sheet overlay, Foundry export/import.
// Split out of scripts.js (10408 lines) 2026-07-09 — see
// docs/audit/2026-07-09-project-improvement-plan.md, P0.3. Shares scripts.js's
// global scope (no bundler here — same pattern as graph.js/locations.js), so
// this only needs to load before scripts.js itself, same as those two.

// C4 — V20 sheet panel for canonical characters: toolbar (generate/regenerate/edit) + rendered sheet.
// The sheet .md opens with a redundant title + nav blockquote
// ("# … — Лист персонажа V20"  /  "> 🔗 Карточка персонажа | Все персонажи").
// The modal already shows the name, links and tabs, so strip that leading block
// for DISPLAY only — the file (and edit/save) keeps the header for standalone use.
function _stripSheetHeader(md) {
  const lines = String(md).split(/\r?\n/);
  let first = 0;
  while (first < lines.length && /^\s*$/.test(lines[first])) first++;
  if (!/^#{1,3}\s+.*Лист персонажа/i.test(lines[first] || '')) return md;
  let i = first + 1;
  const skip = s => /^\s*$/.test(s)
    || /^>\s*🔗?.*(Карточк|Все персонаж)/i.test(s)
    || /^\s*-{3,}\s*$/.test(s);
  while (i < lines.length && skip(lines[i])) i++;
  return lines.slice(i).join('\n');
}

// ═══════════════════ Structured V20 sheet (STV2099 blank reproduction) ═══════════════════
// Source of truth = <slug>-sheet.json (sidecar). Falls back to parsing the AI
// markdown sheet. Dots = radio-style (fill 1..k); boxes = solid checkboxes.

const V20_ATTRS = {
  physical: [['strength', 'Сила'], ['dexterity', 'Ловкость'], ['stamina', 'Выносливость']],
  social:   [['charisma', 'Обаяние'], ['manipulation', 'Манипуляция'], ['appearance', 'Привлекательность'], ['composure', 'Самообладание']],
  mental:   [['perception', 'Восприятие'], ['intelligence', 'Интеллект'], ['wits', 'Смекалка'], ['resolve', 'Решительность']],
};
const V20_ATTR_GROUP_LABELS = { physical: 'Физические', social: 'Социальные', mental: 'Ментальные' };
const V20_ABILITIES = {
  talents:    ['Атлетика', 'Бдительность', 'Драка', 'Запугивание', 'Красноречие', 'Лидерство', 'Уличное чутьё', 'Хитрость', 'Шестое чувство', 'Эмпатия'],
  skills:     ['Вождение', 'Воровство', 'Выживание', 'Исполнение', 'Обращение с животными', 'Ремесло', 'Скрытность', 'Стрельба', 'Фехтование', 'Этикет'],
  knowledges: ['Гуманитарные науки', 'Естественные науки', 'Законы', 'Информатика', 'Медицина', 'Оккультизм', 'Политика', 'Расследование', 'Финансы', 'Электроника'],
};
const V20_ABILITY_GROUP_LABELS = { talents: 'Таланты', skills: 'Навыки', knowledges: 'Знания' };
const V20_HEALTH = [
  ['bruised', 'Помят', ''], ['hurt', 'Легко ранен', '−1'], ['injured', 'Ранен', '−1'],
  ['wounded', 'Серьёзно ранен', '−2'], ['mauled', 'Тяжело ранен', '−2'],
  ['crippled', 'Едва жив', '−5'], ['incapacitated', 'При смерти', ''],
];

const _clamp = (v, a, b) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, Math.round(n))) : a; };
const _clamp05 = v => _clamp(v, 0, 5);
const _num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const _boolArr = (a, n) => Array.from({ length: n }, (_, i) => !!(a && a[i]));
const _fillBoxes = (n, k) => Array.from({ length: n }, (_, i) => i < k);
const _v20Norm = s => String(s || '').replace(/\*\*/g, '').toLowerCase().split('(')[0].trim();

function _v20Empty(lineage = 'vampires') {
  const ab = g => V20_ABILITIES[g].map(n => ({ name: n, val: 0, fixed: true })).concat([{ name: '', val: 0 }, { name: '', val: 0 }]);
  return {
    lineage,
    header: { name: '', player: '', chronicle: '', nature: '', demeanor: '', concept: '', clan: '', generation: '', sire: '' },
    attributes: {
      physical: { strength: 1, dexterity: 1, stamina: 1 },
      social:   { charisma: 1, manipulation: 1, appearance: 1, composure: 1 },
      mental:   { perception: 1, intelligence: 1, wits: 1, resolve: 1 },
    },
    abilities: { talents: ab('talents'), skills: ab('skills'), knowledges: ab('knowledges') },
    // disciplines/psychicPowers/backgrounds/otherTraits/rituals — без строк по умолчанию (не
    // фиксированные 6 заготовок): у дисциплин/фона нет «канонического» списка, в отличие от
    // способностей (30 фиксированных талантов/навыков/знаний одни и те же у всех) — строки
    // появляются только вручную («+ Добавить»/«+ Из справочника») или из данных ИИ-листа
    // (см. _v20ParseMd). См. также _v20AddLibraryItem (заполняет первую пустую строку вместо
    // добавления новой) и обрезку хвостовых пустых строк в _v20Normalize.
    disciplines: [],
    // psychicPowers — мортал-аналог disciplines (см. _v20RenderSheet/discCol): «Нумина / Грани»
    // листа смертного (character_sheet_mortal.md, Шаг 8) — только для экстрасенсов/практиков,
    // у обычного смертного остаётся пустым/нулевым. Источник справочника — system/library/psychics/
    // (web/lib/psychics.js → GET /api/library/psychics, кэш ensurePsychics()/_psychicsCache).
    psychicPowers: [],
    backgrounds: [],
    virtues: { conscience: 1, selfcontrol: 1, courage: 1 },
    // meritsFlaws — массив [{name,points,kind:'merit'|'flaw'}], без строк по умолчанию (тот же
    // паттерн, что у disciplines/backgrounds/otherTraits/rituals — см. комментарий выше).
    meritsFlaws: [],
    humanity: 7, path: 'Человечность',
    willpower: { permanent: 1, temp: Array(10).fill(false) },
    // bloodPool — boolean grid (sized per generation's bloodMax at render time); bloodPoolCount —
    // plain number used instead of the grid for generation 3 (no fixed cap, free-form «счётчик»).
    // Mode is derived from m.header.generation at render/normalize time, not stored on the model.
    bloodPool: Array(20).fill(false), bloodPoolCount: 0, bloodPerTurn: 1,
    health: { bruised: false, hurt: false, injured: false, wounded: false, mauled: false, crippled: false, incapacitated: false },
    flaw: '', experience: { total: 0, spent: 0, log: [] },
    // ── Page 2 ──
    specializations: Array.from({ length: 6 }, () => ({ ability: '', spec: '' })),
    otherTraits: [],
    rituals: [],
    history: '', goals: '',
    description: { birthDate: '', apparentAge: '', deathDate: '', gender: '', race: '', hair: '', eyes: '', heightWeight: '', build: '', nationality: '' },
    allies: '', possessions: '',
    combat: Array.from({ length: 4 }, () => ({ weapon: '', diff: '', damage: '', range: '', rate: '', clip: '', size: '' })),
  };
}

// Pad to a baseline of n rows, but never truncate a saved array that's longer than n —
// rows added via the «+ Добавить» UI (see _v20AddRow) must survive normalize/reload, not
// just the in-memory session. Length only ever grows here; trimming is the user's «×».
const _v20PadPairs = (arr, n, keys) => {
  const blank = () => Object.fromEntries(keys.map(k => [k, '']));
  const len = Math.max(n, Array.isArray(arr) ? arr.length : 0);
  const out = Array.from({ length: len }, blank);
  if (Array.isArray(arr)) arr.forEach((x, i) => { const o = blank(); for (const k of keys) o[k] = String(x?.[k] || ''); out[i] = o; });
  return out;
};

function _v20PickClamped(o, max = 5) {
  const r = {};
  if (o && typeof o === 'object') for (const k in o) r[k] = _clamp(o[k], 0, max);
  return r;
}
function _v20PadSlots(arr, n, max = 5) {
  const len = Math.max(n, Array.isArray(arr) ? arr.length : 0);
  const out = Array.from({ length: len }, () => ({ name: '', val: 0 }));
  if (Array.isArray(arr)) arr.forEach((x, i) => { out[i] = { name: String(x?.name || ''), val: _clamp(x?.val, 0, max) }; });
  return out;
}

// Та же логика, что у _v20PadSlots, но с полями {name,points,kind} вместо {name,val} — Очки
// достоинств/недостатков не ограничены 0–5 (в библиотеке встречаются costs до 7), kind по
// умолчанию 'merit'.
function _v20PadMeritsFlaws(arr, n) {
  const len = Math.max(n, Array.isArray(arr) ? arr.length : 0);
  const out = Array.from({ length: len }, () => ({ name: '', points: 0, kind: 'merit' }));
  if (Array.isArray(arr)) arr.forEach((x, i) => {
    out[i] = { name: String(x?.name || ''), points: Math.max(0, _num(x?.points, 0)), kind: x?.kind === 'flaw' ? 'flaw' : 'merit' };
  });
  return out;
}

// «Внушительный тип (1 очко)» / «- Внушительный тип» / «Внушительный тип — 1» → имя для поиска
// в библиотеке (портировано из web/lib/foundry-merits.js: _extractName — та же логика на клиенте,
// т.к. сервер и браузер не делят JS-модули в этом проекте).
function _v20ExtractMeritFlawName(line) {
  return String(line || '')
    .replace(/^[-•*]\s*/, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[—-]\s*\d+\s*(очк\w*)?\s*$/i, '')
    .trim();
}

// Старый формат meritsFlaws — строка (по строке на пункт). Разбирает её в массив
// [{name,points,kind}]: имя ищет в объединённом справочнике (см. _v20LoadLibrary('meritflaw')) —
// если нашли, points/kind берутся оттуда; если нет (кастомная строка) — points из «(N)» в конце
// строки (0, если нет числа), kind по умолчанию 'merit' (старый формат тип вообще не хранил —
// это не регресс, а более полная информация, чем было; GM видит переключатель на каждой строке
// и может поправить руками).
async function _v20MigrateMeritsFlawsString(text) {
  const lib = await _v20LoadLibrary('meritflaw');
  const index = new Map();
  for (const item of lib) index.set(String(item.name || '').toLowerCase().trim(), item);

  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const name = _v20ExtractMeritFlawName(line);
    const hit = index.get(name.toLowerCase().trim());
    if (hit) {
      out.push({ name: hit.name, points: Number(hit.points) || 0, kind: hit._kind === 'flaw' ? 'flaw' : 'merit' });
    } else {
      const pm = line.match(/\((\d+)/);
      out.push({ name, points: pm ? parseInt(pm[1], 10) : 0, kind: 'merit' });
    }
  }
  return out;
}

// Убирает хвостовые пустые строки (без name) из секций без фиксированной базовой длины
// (disciplines/psychicPowers/backgrounds/otherTraits/rituals — см. _V20_BASELINE_LEN). Пустая
// строка не хранит информации, так что обрезка безопасна — старые сохранённые листы (записанные
// ещё при жёстком минимуме в 6 строк) «самоисправляются» до актуального формата при следующем
// открытии, без миграции.
function _v20TrimTrailingEmpty(arr) {
  const out = arr.slice();
  while (out.length && !String(out[out.length - 1]?.name || '').trim()) out.pop();
  return out;
}

// Baseline row counts for the fixed-length sections that now support «+ Добавить» (see
// _v20AddRow/_v20RemoveRow below). Mirrors the literal counts already baked into _v20Empty()/
// _v20Normalize() — kept here as named constants so add/remove logic and the «cannot delete a
// baseline row» guard read from one place instead of repeating magic numbers.
// Нет защищённой базовой длины — все строки этих секций удаляемы (нет «канонических» дисциплин/
// фона/etc., в отличие от способностей, у которых есть фиксированный список).
const _V20_BASELINE_LEN = { disciplines: 0, psychicPowers: 0, backgrounds: 0, otherTraits: 0, rituals: 0, meritsFlaws: 0 };
function _v20AbilityBaselineLen(g) { return V20_ABILITIES[g].length + 2; }

// Append one blank row to a fixed-length array section and re-render. `group` is set only for
// abilities (talents/skills/knowledges); other sections pass it as null. New rows are plain
// {name,val} (or {name,level} for rituals) — identical shape to the existing blank slots, so they
// flow through _v20Set/_v20DotCapFor/_v20ClampToGen without any special-casing.
function _v20AddRow(section, group) {
  const m = _v20Model;
  if (section === 'abilities') {
    m.abilities[group].push({ name: '', val: 0 });
  } else if (section === 'rituals') {
    m.rituals.push({ name: '', level: '' });
  } else if (section === 'meritsFlaws') {
    m.meritsFlaws.push({ name: '', points: 0, kind: 'merit' });
  } else {
    m[section].push({ name: '', val: 0 });
  }
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}

// Remove one row added beyond the baseline count. Baseline/canonical rows (the first
// _V20_BASELINE_LEN[section] slots, or the fixed canonical abilities + first 2 blank custom
// slots) can never be removed this way — only rows the «+ Добавить» button itself created.
function _v20RemoveRow(section, group, idx) {
  const m = _v20Model;
  const arr = group ? m.abilities[group] : m[section];
  const baseline = group ? _v20AbilityBaselineLen(group) : _V20_BASELINE_LEN[section];
  if (idx < baseline || idx >= arr.length) return;
  arr.splice(idx, 1);
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}

// Generation → max dot value for Attributes/Abilities/Disciplines/Backgrounds/«other traits»
// (RULES_V20.generations[gen].maxDots — «Единая таблица максимума точек», см. character_sheet_v20.md).
// Falls back to 5 (classic cap) when the generation is unset/unrecognised.
function _v20MaxDotsForGen(gen) {
  const info = v20GenerationInfo(gen);
  return info?.maxDots || 5;
}

// Dotted model paths whose ceiling is the generation-aware «Единая таблица максимума точек»
// (Attributes/Abilities/Disciplines/Backgrounds + «other traits» = факты биографии под другим
// именем). Virtues/Willpower/Humanity keep their own fixed caps (5/10/10) — checked separately,
// not through this table — so a future «add row» feature can reuse this single check point
// without re-deriving which categories are generation-capped.
const _V20_GEN_CAPPED_PREFIXES = ['attributes.', 'abilities.', 'disciplines.', 'backgrounds.', 'otherTraits.'];

// Cap for a given dotted path on the current model: generation-aware max for the four capped
// categories (vampires only), else the classic fixed cap (10 for humanity/willpower, 5 otherwise).
function _v20DotCapFor(dpath, m) {
  const isVamp = (m.lineage || '') === 'vampires';
  if (isVamp && _V20_GEN_CAPPED_PREFIXES.some(p => dpath.startsWith(p))) return _v20MaxDotsForGen(m.header.generation);
  if (dpath === 'humanity' || dpath === 'willpower.permanent') return 10;
  return 5;
}

// Re-cap Attributes/Abilities/Disciplines/Backgrounds/«other traits» in-place after the user
// changes the generation field by hand (e.g. 5e → 13e), so a trait raised under a looser cap
// doesn't render with more filled dots than the new, smaller dot grid has slots for. Also
// resizes the blood pool grid (or switches to/from the 3e counter) to match the new generation.
function _v20ClampToGen(m) {
  if ((m.lineage || '') !== 'vampires') return;
  const cap = _v20MaxDotsForGen(m.header.generation);
  for (const g of ['physical', 'social', 'mental']) for (const k in m.attributes[g]) m.attributes[g][k] = _clamp(m.attributes[g][k], 0, cap);
  for (const g of ['talents', 'skills', 'knowledges']) for (const s of m.abilities[g]) s.val = _clamp(s.val, 0, cap);
  for (const d of m.disciplines) d.val = _clamp(d.val, 0, cap);
  for (const b of m.backgrounds) b.val = _clamp(b.val, 0, cap);
  for (const t of m.otherTraits) t.val = _clamp(t.val, 0, cap);
  const genInfo = v20GenerationInfo(m.header.generation);
  const bloodMax = genInfo?.bloodMax;
  if (bloodMax != null) {
    const filled = m.bloodPool.filter(Boolean).length;
    m.bloodPool = _fillBoxes(bloodMax, Math.min(bloodMax, filled));
  }
}

// Fill a fresh default with whatever a (possibly partial / legacy) model provides.
function _v20Normalize(m) {
  const e = _v20Empty(m?.lineage || 'vampires');
  if (!m || typeof m !== 'object') return e;
  if (m.lineage) e.lineage = m.lineage;
  Object.assign(e.header, m.header || {});
  const isVamp = e.lineage === 'vampires';
  const maxDots = isVamp ? _v20MaxDotsForGen(e.header.generation) : 5;
  for (const g of ['physical', 'social', 'mental']) Object.assign(e.attributes[g], _v20PickClamped(m.attributes?.[g], maxDots));
  for (const g of ['talents', 'skills', 'knowledges']) {
    const src = Array.isArray(m.abilities?.[g]) ? m.abilities[g] : [];
    // Baseline template (canonical fixed rows + 2 blank custom slots) never shrinks below its own
    // length, but grows past it when a saved sheet has more custom slots (rows added via «+ Добавить» —
    // see _v20AddRow) — same «pad to at least N, never truncate user growth» rule as _v20PadSlots.
    const base = e.abilities[g];
    const len = Math.max(base.length, src.length);
    e.abilities[g] = Array.from({ length: len }, (_, i) => {
      const slot = base[i] || { name: '', val: 0, fixed: false };
      const s = src[i];
      return { name: slot.fixed ? slot.name : String(s?.name || ''), val: _clamp(s?.val ?? slot.val, 0, maxDots), fixed: !!slot.fixed };
    });
  }
  e.disciplines = _v20TrimTrailingEmpty(_v20PadSlots(m.disciplines, 0, maxDots));
  // Психические способности не зависят от поколения (мортал его не имеет) — фиксированный max 5,
  // как и остальные мортал-черты; maxDots здесь уже =5 для немортал-веток не используется.
  e.psychicPowers = _v20TrimTrailingEmpty(_v20PadSlots(m.psychicPowers, 0, 5));
  e.backgrounds = _v20TrimTrailingEmpty(_v20PadSlots(m.backgrounds, 0, maxDots));
  Object.assign(e.virtues, _v20PickClamped(m.virtues, 5));
  // meritsFlaws: string → array (старый формат листа, ещё не открытый в браузере после этого
  // обновления). _v20Normalize не может быть async (вызывается синхронно из рендера) — сначала
  // синхронный разбор БЕЗ сверки с библиотекой (имя + очки из «(N)» суффикса, kind:'merit' по
  // умолчанию), чтобы модель никогда не была видимо пустой: случайное сохранение до того, как
  // придёт ответ библиотеки, не потеряет данные (просто останется неточным до обогащения).
  // Обогащение points/kind из справочника — в фоне, и трогает только строки, которые всё ещё
  // совпадают с исходным синхронным разбором (пользователь их не редактировал/не удалял), чтобы
  // не затереть правки, сделанные, пока промис ещё не разрешился.
  if (typeof m.meritsFlaws === 'string') {
    const rawString = m.meritsFlaws;
    const basic = String(rawString || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const nm = _v20ExtractMeritFlawName(line);
      const pm = line.match(/\((\d+)/);
      return { name: nm, points: pm ? parseInt(pm[1], 10) : 0, kind: 'merit' };
    });
    e.meritsFlaws = _v20TrimTrailingEmpty(_v20PadMeritsFlaws(basic, 0));
    _v20MigrateMeritsFlawsString(rawString).then(enriched => {
      if (_v20Model !== e) return;
      const current = _v20Model.meritsFlaws;
      enriched.forEach((en, i) => {
        const cur = current[i];
        const orig = basic[i];
        if (cur && orig && cur.name === orig.name && cur.points === orig.points && cur.kind === orig.kind) {
          cur.name = en.name; cur.points = en.points; cur.kind = en.kind;
        }
      });
      _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx?.name);
    });
  } else {
    e.meritsFlaws = _v20TrimTrailingEmpty(_v20PadMeritsFlaws(m.meritsFlaws, 0));
  }
  if (m.humanity != null) e.humanity = _clamp(m.humanity, 0, 10);
  if (m.path) e.path = m.path;
  if (m.willpower) { e.willpower.permanent = _clamp(m.willpower.permanent, 0, 10); e.willpower.temp = _boolArr(m.willpower.temp, 10); }
  const genInfo = isVamp ? v20GenerationInfo(e.header.generation) : null;
  const bloodMax = genInfo?.bloodMax || 20;
  if (m.bloodPool) e.bloodPool = _boolArr(m.bloodPool, bloodMax);
  e.bloodPoolCount = _num(m.bloodPoolCount, 0);
  if (m.bloodPerTurn != null) e.bloodPerTurn = _num(m.bloodPerTurn, 1);
  Object.assign(e.health, m.health || {});
  if (typeof m.flaw === 'string') e.flaw = m.flaw;
  if (m.experience) {
    e.experience.total = _num(m.experience.total, 0); e.experience.spent = _num(m.experience.spent, 0);
    e.experience.log = Array.isArray(m.experience.log)
      ? m.experience.log.slice(0, 50).map(x => ({ date: String(x?.date || ''), text: String(x?.text || ''), cost: _num(x?.cost, 0) }))
      : [];
  }
  // ── Page 2 ──
  e.specializations = _v20PadPairs(m.specializations, 6, ['ability', 'spec']);
  e.otherTraits = _v20TrimTrailingEmpty(_v20PadSlots(m.otherTraits, 0, maxDots));
  e.rituals = _v20TrimTrailingEmpty(_v20PadPairs(m.rituals, 0, ['name', 'level']));
  if (typeof m.history === 'string') e.history = m.history;
  if (typeof m.goals === 'string') e.goals = m.goals;
  Object.assign(e.description, m.description || {});
  if (typeof m.allies === 'string') e.allies = m.allies;
  if (typeof m.possessions === 'string') e.possessions = m.possessions;
  e.combat = _v20PadPairs(m.combat, 4, ['weapon', 'diff', 'damage', 'range', 'rate', 'clip', 'size']);
  return e;
}

// Best-effort parse of the AI markdown sheet into the structured model.
function _v20ParseMd(md, lineage) {
  const m = _v20Empty(lineage || 'vampires');
  if (!md) return m;
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let sec = '', sub = '', mm;
  const rows = [];
  const secText = {};   // section title → raw prose lines (non-table, non-heading)
  for (const ln of lines) {
    if ((mm = ln.match(/^##\s+(.+)$/)))  { sec = mm[1].replace(/[#*]/g, '').trim().toLowerCase(); sub = ''; continue; }
    if ((mm = ln.match(/^###\s+(.+)$/))) { sub = mm[1].replace(/[#*]/g, '').trim().toLowerCase(); continue; }
    const isTable = /^\s*\|/.test(ln);
    if (!isTable) {
      const t = ln.trim();
      if (t && !/^-{3,}$/.test(t) && !/^>/.test(t)) (secText[sec] ??= []).push(t);
      continue;
    }
    if (/\|\s*:?-{3,}/.test(ln)) continue;
    const cells = ln.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const name = cells[0].replace(/\*\*/g, '').trim();
    if (!name) continue;
    // Skip table header rows — their «●» header cell would parse as a rating of 1.
    if (/^(способност|характеристик|атрибут|дисциплин|факт биографии|backgrounds|предыстор|добродетел|параметр|ритуал|оружие|уровень|значение|название|поле)/i.test(name)) continue;
    const rating = _parseRatingCells(cells);
    rows.push({ sec, sub, name, nameNorm: _v20Norm(name), nameLow: name.toLowerCase(), val: rating ? rating.value : null, cells });
  }
  const findRow = ru => { const t = ru.toLowerCase(); return rows.find(r => r.nameNorm === t || r.nameNorm.startsWith(t)); };

  // Header
  const hmap = { 'имя': 'name', 'игрок': 'player', 'хроника': 'chronicle', 'натура': 'nature', 'маска': 'demeanor', 'амплуа': 'concept', 'клан': 'clan', 'поколение': 'generation', 'сир': 'sire' };
  for (const r of rows) {
    const key = hmap[r.nameNorm];
    if (key) { const v = (r.cells[1] || '').replace(/\*\*/g, '').trim(); if (v && v !== '—') m.header[key] = v; }
  }
  // Attributes
  for (const g of ['physical', 'social', 'mental']) for (const [k, ru] of V20_ATTRS[g]) { const r = findRow(ru); if (r && r.val != null) m.attributes[g][k] = r.val; }
  // Abilities (fixed + up to 2 custom extras per group)
  const groupRe = { talents: /талант/, skills: /навык/, knowledges: /знани/ };
  for (const g of ['talents', 'skills', 'knowledges']) {
    const used = new Set();
    V20_ABILITIES[g].forEach((ru, i) => { const r = findRow(ru); if (r) { used.add(r); if (r.val != null) m.abilities[g][i].val = r.val; } });
    const extras = rows.filter(r => groupRe[g].test(r.sub) && r.val != null && !used.has(r)
      && !V20_ABILITIES[g].some(ru => _v20Norm(ru) === r.nameNorm));
    let ei = 10;
    for (const r of extras) { if (ei > 11) break; m.abilities[g][ei] = { name: r.name.replace(/\*\*/g, '').trim(), val: r.val }; ei++; }
  }
  // Disciplines / Backgrounds (ordered, name + dots) — только строки, реально найденные в
  // ИИ-листе (push в изначально пустой массив, см. _v20Empty), без заготовок под пустые слоты.
  const disc = rows.filter(r => /дисциплин/.test(r.sub) && r.val != null).slice(0, 6);
  disc.forEach(r => { m.disciplines.push({ name: r.name.replace(/\*\*/g, '').trim(), val: r.val }); });
  const bg = rows.filter(r => /(факт биографии|backgrounds|предыстор)/.test(r.sub) && r.val != null).slice(0, 6);
  bg.forEach(r => { m.backgrounds.push({ name: r.name.replace(/\*\*/g, '').trim(), val: r.val }); });
  // Психические способности — мортал-секция «## 🔆 Нумина / Грани» (своя «##», не подсекция
  // «Преимуществ», в отличие от дисциплин/фактов биографии выше — см. character_sheet_mortal.md).
  const psy = rows.filter(r => /нумина|грани/.test(r.sec) && r.val != null).slice(0, 6);
  psy.forEach(r => { m.psychicPowers.push({ name: r.name.replace(/\*\*/g, '').trim(), val: r.val }); });
  // Virtues
  for (const r of rows) {
    if (!/добродетел/.test(r.sub) || r.val == null) continue;
    if (/совесть|решимост/.test(r.nameNorm)) m.virtues.conscience = r.val;
    else if (/самоконтрол|инстинкт/.test(r.nameNorm)) m.virtues.selfcontrol = r.val;
    else if (/смелост|courage/.test(r.nameNorm)) m.virtues.courage = r.val;
  }
  // Достоинства и недостатки (Название | Тип | Очки, 3 колонки) — единственная markdown-таблица
  // в секции «⚠️ Слабости, изъяны, деранжементы» (остальное там — проза: «Клановая слабость:»,
  // «Изъян (Flaw):», список деранжементов — не таблицы, в rows не попадают). kind — по слову
  // «недостат» в колонке «Тип» (регистронезависимо), иначе 'merit'.
  const mf = rows.filter(r => /слабост/.test(r.sec) && r.cells.length === 3 && r.cells[0].trim() && r.cells[2].trim());
  mf.forEach(r => {
    const kind = /недостат/i.test(r.cells[1] || '') ? 'flaw' : 'merit';
    const points = parseInt((r.cells[2] || '').replace(/\D/g, ''), 10);
    m.meritsFlaws.push({ name: r.name.replace(/\*\*/g, '').trim(), points: Number.isFinite(points) ? points : 0, kind });
  });
  // Derived (numbers may exceed 5 → read the numeric cell directly)
  const genInfoForParse = (m.lineage === 'vampires') ? v20GenerationInfo(m.header.generation) : null;
  const bloodMaxForParse = genInfoForParse?.bloodMax || 20;
  for (const r of rows) {
    if (!/производные/.test(r.sec)) continue;
    const numC = r.cells.find((c, idx) => idx > 0 && /^\d+$/.test(c));
    const n = numC != null ? parseInt(numC, 10) : null;
    if (/столп/.test(r.nameLow)) { const v = (r.cells[1] || '').trim(); if (v && v !== '—') m.path = v; }
    else if (/человечност|путь/.test(r.nameLow) && n != null) m.humanity = Math.min(10, n);
    else if (/постоянн/.test(r.nameLow) && n != null) m.willpower.permanent = Math.min(10, n);
    else if (/временн/.test(r.nameLow) && n != null) m.willpower.temp = _fillBoxes(10, Math.min(10, n));
    else if (/(запас крови|blood pool)/.test(r.nameLow) && n != null) {
      if (genInfoForParse && genInfoForParse.bloodMax == null) m.bloodPoolCount = n;       // 3-е поколение — счётчик без потолка
      else m.bloodPool = _fillBoxes(bloodMaxForParse, Math.min(bloodMaxForParse, n));
    }
    else if (/(предел траты|blood\/turn)/.test(r.nameLow) && n != null) m.bloodPerTurn = n;
  }

  // ── Page 2 ──
  const clean = s => String(s || '').replace(/\*\*/g, '').trim();
  const notDash = s => { const v = clean(s); return v && v !== '—' && !/^⚠️?/.test(v) ? v : ''; };
  const secProse = re => { const k = Object.keys(secText).find(key => re.test(key)); return k ? secText[k].join('\n') : ''; };
  const afterLabel = (text, re) => { const ln = text.split('\n').find(l => re.test(l)); return ln ? notDash(ln.replace(/^[^:]*:\s*/, '')) : ''; };

  // Specializations (Способность | Специализация)
  const specs = rows.filter(r => /специализаци/.test(r.sec) && notDash(r.cells[0]) && notDash(r.cells[1]));
  specs.slice(0, 6).forEach((r, i) => { m.specializations[i] = { ability: clean(r.cells[0]), spec: clean(r.cells[1]) }; });

  // Other traits (Параметр | ● | Значение, 3 cols) and Rituals (Ритуал | Уровень, 2 cols)
  // share one «Другие параметры и ритуалы» section → tell them apart by column count.
  const ot = rows.filter(r => /(другие параметры|ритуал)/.test(r.sec) && r.cells.length >= 3 && r.val != null && notDash(r.name));
  ot.slice(0, 6).forEach(r => { m.otherTraits.push({ name: clean(r.name), val: r.val }); });
  const rit = rows.filter(r => /(другие параметры|ритуал)/.test(r.sec) && r.cells.length === 2 && notDash(r.name) && notDash(r.cells[1]));
  rit.slice(0, 6).forEach(r => { m.rituals.push({ name: clean(r.name), level: clean(r.cells[1]) }); });

  // Description (Поле | Значение)
  const dmap = { 'дата рождения': 'birthDate', 'видимый возраст': 'apparentAge', 'дата смерти': 'deathDate', 'пол': 'gender', 'раса': 'race', 'волосы': 'hair', 'глаза': 'eyes', 'рост/вес': 'heightWeight', 'телосложение': 'build', 'национальность': 'nationality' };
  for (const r of rows) { if (!/описание/.test(r.sec)) continue; const key = dmap[r.nameNorm]; if (key) m.description[key] = notDash(r.cells[1]); }

  // Combat (weapon | diff | damage | range | rate | clip | size)
  const ckeys = ['weapon', 'diff', 'damage', 'range', 'rate', 'clip', 'size'];
  const cmb = rows.filter(r => /боевые столкновения/.test(r.sec) && r.cells.some(c => notDash(c)));
  cmb.slice(0, 4).forEach((r, i) => { const o = {}; ckeys.forEach((k, j) => o[k] = clean(r.cells[j] || '')); m.combat[i] = o; });

  // Prose sections
  const histText = secProse(/история/);
  m.history = afterLabel(histText, /истори/i) || (notDash(histText) && !/цел/i.test(histText) ? histText : '');
  m.goals = afterLabel(histText, /цел/i);
  m.allies = secProse(/союзники/).split('\n').map(l => l.replace(/^[-*]\s*/, '')).filter(s => notDash(s)).join('\n');
  m.possessions = secProse(/имущество/).split('\n').map(l => l.replace(/^[-*]\s*/, '')).filter(s => notDash(s)).join('\n');

  return m;
}

function _v20ModelFrom(d) {
  if (d && d.source === 'json' && d.data) { const m = _v20Normalize(d.data); m.lineage = d.lineage || m.lineage; return m; }
  if (d && d.source === 'md') return _v20ParseMd(d.md, d.lineage);
  return _v20Empty(d?.lineage || 'vampires');
}

// ── Path get/set helpers (dotted, array-index aware) ──────────────────────────
function _v20Get(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function _v20Set(obj, path, val) {
  const keys = path.split('.'); const last = keys.pop();
  const tgt = keys.reduce((o, k) => (o[k] ??= {}), obj);
  tgt[last] = val;
}

// ── Render fragments ──────────────────────────────────────────────────────────
function _v20DotsHtml(dpath, val, max = 5) {
  let s = `<span class="v20-dots" data-dpath="${dpath}" data-max="${max}">`;
  for (let dd = 1; dd <= max; dd++) s += `<span class="v20-dot${dd <= val ? ' on' : ''}" data-d="${dd}" role="radio" aria-checked="${dd === val}" tabindex="0"></span>`;
  return s + `<span class="v20-dot-num">${val}</span></span>`;
}
function _v20DotRow(label, dpath, val, max = 5) {
  return `<div class="v20-row"><span class="v20-row-name">${escHtml(label)}</span>${_v20DotsHtml(dpath, val, max)}</div>`;
}
// `removeKey` ('section' or 'section:group', e.g. 'disciplines' / 'abilities:talents') renders a
// «×» button wired to data-v20-remove/data-v20-remove-idx when present — only passed for rows past
// the section's baseline count (see _v20AddRow/_v20RemoveRow), so canonical rows never get a «×».
function _v20NamedDotRow(namePath, nameVal, dpath, val, max = 5, removeKey = '') {
  const rm = removeKey ? `<button type="button" class="v20-row-remove-btn" data-v20-remove="${escAttr(removeKey)}" data-v20-remove-idx="${dpath.match(/(\d+)/)?.[1] ?? ''}" title="Удалить строку">×</button>` : '';
  return `<div class="v20-row v20-named">${rm}<input class="v20-line-input" data-tpath="${namePath}" value="${escAttr(nameVal)}" placeholder="…">${_v20DotsHtml(dpath, val, max)}</div>`;
}
function _v20BoxesHtml(bpath, arr) {
  return `<span class="v20-boxes">${arr.map((on, i) => `<input type="checkbox" class="v20-box" data-bpath="${bpath}" data-i="${i}"${on ? ' checked' : ''}>`).join('')}</span>`;
}
function _v20Field(label, tpath, val, extra = '') {
  return `<label class="v20-field"><span class="v20-field-lbl">${escHtml(label)}</span><input class="v20-field-input" data-tpath="${tpath}" value="${escAttr(val || '')}"${extra}></label>`;
}
// «+ Добавить» affordance appended at the end of a fixed-length section's row list. removeKey
// matches the one passed to _v20NamedDotRow/used by discRow/ritRow — 'section' or 'section:group'.
function _v20AddRowBtn(removeKey) {
  return `<button type="button" class="v20-mini-action v20-add-row-btn" data-v20-add="${escAttr(removeKey)}">+ Добавить</button>`;
}

// Видимый возраст = Год обращения − Год рождения (карточка персонажа). Возвращает целое число
// при двух валидных числовых годах, иначе null (поле остаётся обычным редактируемым текстом —
// «⚠️ Не указан» и пр. card placeholders деградируют без NaN/краша, см. web/lib/parsers.js).
function _v20ComputeApparentAge(card) {
  if (!card) return null;
  const by = parseInt(String(card.birthYear ?? '').replace(/[^\d-]/g, ''), 10);
  const ey = parseInt(String(card.embraceYear ?? '').replace(/[^\d-]/g, ''), 10);
  if (!Number.isFinite(by) || !Number.isFinite(ey)) return null;
  const age = ey - by;
  return age >= 0 ? age : null;
}

// ── Rules engine: derived stats, auto badges, clan/generation actions, validation ──
function _v20Derive(m) {
  const isVamp = (m.lineage || '') === 'vampires';
  const out = { willpower: m.virtues.courage, humanity: null, gen: null };
  if (!m.path || /^человечност/i.test(m.path)) out.humanity = _clamp(m.virtues.conscience + m.virtues.selfcontrol, 0, 10);
  if (isVamp) out.gen = v20GenerationInfo(m.header.generation);
  return out;
}

function _v20AutoBadge(actual, computed, path, kind) {
  if (computed == null || !Number.isFinite(Number(computed))) return '';
  const match = Number(actual) === Number(computed);
  const title = match ? 'Совпадает с расчётным значением' : `Расчётное по правилам: ${computed}. Нажмите, чтобы применить.`;
  return `<button type="button" class="v20-auto-badge${match ? ' is-match' : ''}" data-auto-path="${path}" data-auto-kind="${kind}" data-auto-val="${computed}" title="${escAttr(title)}">${match ? '✓ авто' : `↺ ${computed}`}</button>`;
}

function _v20ApplyAutoBadge(badge) {
  const path = badge.dataset.autoPath, kind = badge.dataset.autoKind, val = badge.dataset.autoVal;
  _v20Set(_v20Model, path, kind === 'dot' ? _clamp(val, 0, 10) : val);
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}

// ── Dice roller V20 (Фаза 4, GM-ориентированный) ────────────────────────────
let _v20RollLog = [];

function _v20RollPool(poolSize, difficulty, specialized) {
  const n = Math.max(0, poolSize);
  const dice = [];
  let successes = 0, ones = 0;
  for (let i = 0; i < n; i++) {
    const d = 1 + Math.floor(Math.random() * 10);
    dice.push(d);
    if (d === 1) ones++;
    else if (d >= difficulty) successes += (d === 10 && specialized) ? 2 : 1;
  }
  return { dice, successes, botch: n > 0 && successes === 0 && ones > 0 };
}

// Most severe checked wound level → numeric dice penalty (V20_HEALTH penalty text, e.g. '−2').
function _v20HealthPenalty(m) {
  let pen = 0;
  for (const [k, , penText] of V20_HEALTH) {
    if (!m.health[k]) continue;
    const n = parseInt(String(penText).replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n > pen) pen = n;
  }
  return pen;
}

function _v20RollOptionsHtml() {
  const m = _v20Model;
  const attrOpts = ['<option value="">—</option>'];
  for (const g of ['physical', 'social', 'mental']) for (const [k, ru] of V20_ATTRS[g]) attrOpts.push(`<option value="attributes.${g}.${k}">${escHtml(ru)} (${m.attributes[g][k]})</option>`);
  const abilOpts = ['<option value="">—</option>'];
  for (const g of ['talents', 'skills', 'knowledges']) m.abilities[g].forEach((s, i) => { if (s.name) abilOpts.push(`<option value="abilities.${g}.${i}">${escHtml(s.name)} (${s.val})</option>`); });
  return { attrOpts: attrOpts.join(''), abilOpts: abilOpts.join('') };
}

function _v20UpdateRollPoolInfo() {
  const attrSel = document.getElementById('v20-roll-attr'), abilSel = document.getElementById('v20-roll-abil');
  const bonus = _num(document.getElementById('v20-roll-bonus')?.value, 0);
  const attrVal = attrSel.value ? _num(_v20Get(_v20Model, attrSel.value), 0) : 0;
  const abilVal = abilSel.value ? _num(_v20Get(_v20Model, abilSel.value + '.val'), 0) : 0;
  const penalty = _v20HealthPenalty(_v20Model);
  const pool = Math.max(0, attrVal + abilVal + bonus - penalty);
  const info = document.getElementById('v20-roll-pool-info');
  if (info) info.textContent = `Пул: ${attrVal} + ${abilVal} + ${bonus}${penalty ? ` − ${penalty} (раны)` : ''} = ${pool}`;
  return pool;
}

function _v20RenderRollLog() {
  const box = document.getElementById('v20-roll-log');
  if (!box) return;
  box.innerHTML = _v20RollLog.map(r =>
    `<div class="v20-roll-log-row"><span>${escHtml(r.label)}</span><span class="v20-roll-log-result ${r.botch ? 'is-botch' : r.successes > 0 ? 'is-success' : 'is-fail'}">${escHtml(r.text)}</span></div>`).join('');
}

function _v20DoRoll() {
  const attrSel = document.getElementById('v20-roll-attr'), abilSel = document.getElementById('v20-roll-abil');
  const diff = _num(document.getElementById('v20-roll-diff')?.value, 6);
  const spec = !!document.getElementById('v20-roll-spec')?.checked;
  const pool = _v20UpdateRollPoolInfo();
  const r = _v20RollPool(pool, diff, spec);
  const optLabel = sel => sel.value ? sel.options[sel.selectedIndex].textContent.replace(/\s*\(\d+\)$/, '') : '';
  const label = [optLabel(attrSel), optLabel(abilSel)].filter(Boolean).join(' + ') || `Пул ${pool}`;
  const resultText = r.botch ? 'Ботч!' : r.successes > 0 ? `${r.successes} усп.` : 'Провал';
  const verdictClass = r.botch ? 'is-botch' : r.successes > 0 ? 'is-success' : 'is-fail';
  const diceHtml = r.dice.length
    ? r.dice.map(d => `<span class="v20-roll-die${d === 1 ? ' is-one' : d >= diff ? ' is-success' : ''}${d === 10 ? ' is-ten' : ''}">${d}</span>`).join('')
    : '<span class="v20-roll-die-empty">пул 0</span>';
  document.getElementById('v20-roll-result').innerHTML = `<div class="v20-roll-dice">${diceHtml}</div><div class="v20-roll-verdict ${verdictClass}">${escHtml(resultText)}</div>`;
  _v20RollLog.unshift({ label, text: `${resultText} (сл. ${diff}, пул ${pool})`, successes: r.successes, botch: r.botch });
  _v20RollLog = _v20RollLog.slice(0, 6);
  _v20RenderRollLog();
}

function _v20CloseRollModal() { document.getElementById('v20-roll-modal-backdrop')?.classList.remove('open'); }

function _v20OpenRollModal(seed) {
  let modal = document.getElementById('v20-roll-modal-backdrop');
  const { attrOpts, abilOpts } = _v20RollOptionsHtml();
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'v20-roll-modal-backdrop';
    modal.className = 'v20-disc-modal-backdrop';
    modal.innerHTML = `<div class="v20-disc-modal v20-roll-modal">
      <button type="button" class="v20-disc-modal-close" id="v20-roll-modal-close" aria-label="Закрыть бросок">✕</button>
      <h3>🎲 Бросок</h3>
      <div class="v20-roll-row">
        <label class="v20-roll-field">Характеристика<select id="v20-roll-attr">${attrOpts}</select></label>
        <label class="v20-roll-field">Способность<select id="v20-roll-abil">${abilOpts}</select></label>
      </div>
      <div class="v20-roll-row">
        <label class="v20-roll-field v20-roll-field-sm">Доп. кубики<input type="number" id="v20-roll-bonus" value="0" class="v20-mini-input"></label>
        <label class="v20-roll-field v20-roll-field-sm">Сложность<input type="number" id="v20-roll-diff" value="6" class="v20-mini-input"></label>
        <label class="v20-roll-spec"><input type="checkbox" id="v20-roll-spec"> Специализация (10 = 2 усп.)</label>
      </div>
      <div class="v20-roll-pool-info" id="v20-roll-pool-info"></div>
      <button type="button" class="cdet-sheet-btn primary v20-roll-go" id="v20-roll-go">🎲 Бросить</button>
      <div class="v20-roll-result" id="v20-roll-result"></div>
      <div class="v20-roll-log" id="v20-roll-log"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) _v20CloseRollModal(); });
    modal.querySelector('#v20-roll-modal-close').addEventListener('click', _v20CloseRollModal);
    modal.querySelector('#v20-roll-go').addEventListener('click', _v20DoRoll);
    modal.querySelectorAll('#v20-roll-attr, #v20-roll-abil, #v20-roll-bonus').forEach(el => el.addEventListener('input', _v20UpdateRollPoolInfo));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _v20CloseRollModal(); });
  } else {
    modal.querySelector('#v20-roll-attr').innerHTML = attrOpts;
    modal.querySelector('#v20-roll-abil').innerHTML = abilOpts;
  }
  modal.querySelector('#v20-roll-attr').value = seed?.attr || '';
  modal.querySelector('#v20-roll-abil').value = seed?.abil || '';
  document.getElementById('v20-roll-result').innerHTML = '';
  modal.classList.add('open');
  _v20UpdateRollPoolInfo();
  _v20RenderRollLog();
}

// Shared "list ⇄ detail" click delegation for the 4 near-identical library
// pickers below (disciplines modal + lib tab, psychics modal + lib tab,
// merits/flaws lib tabs) — see docs/audit/2026-07-09-project-improvement-plan.md,
// P1.6. Only the event-wiring is unified here; each library keeps its own
// cache shape and HTML builders (disciplines/psychics = flat array keyed by
// slug, merits/flaws = keyed by category) since those are genuinely
// different data models, not copy-paste duplication worth forcing together.
function _bindLibraryClicks(container, { itemAttr, backAttr, onItem, onBack }) {
  if (!container) return;
  container.addEventListener('click', e => {
    const back = e.target.closest(`[${backAttr}]`); if (back) { onBack(); return; }
    const item = e.target.closest(`[${itemAttr}]`); if (item) { onItem(item.dataset); return; }
  });
}

// ── Discipline reference library (Фаза 3) ──────────────────────────────────
// Источник истины — system/library/disciplines/*.md (сервер парсит → /api/library/disciplines).
let _disciplinesCache = null;
async function ensureDisciplines() {
  if (_disciplinesCache) return _disciplinesCache;
  try {
    const data = await fetch('/api/library/disciplines').then(r => r.json());
    _disciplinesCache = Array.isArray(data) ? data : [];
  } catch { _disciplinesCache = []; }
  return _disciplinesCache;
}
function _discBySlug(slug) { return (_disciplinesCache || []).find(d => d.slug === slug) || null; }

let _combosCache = null;
async function ensureCombos() {
  if (_combosCache) return _combosCache;
  try {
    const data = await fetch('/api/library/combo-disciplines').then(r => r.json());
    _combosCache = Array.isArray(data) ? data : [];
  } catch { _combosCache = []; }
  return _combosCache;
}
function _comboBySlug(slug) { return (_combosCache || []).find(c => c.slug === slug) || null; }

// Уровень способности → N красно-золотых точек (1…10).
function _libLevelDots(n) {
  const v = Math.max(1, Math.min(10, parseInt(n, 10) || 1));
  return `<span class="lib-dots" title="Уровень ${v}" aria-label="Уровень ${v}">${'<span class="lib-dot"></span>'.repeat(v)}</span>`;
}

function _libPowerHtml(p) {
  return `<div class="lib-power">
    <div class="lib-power-head">${_libLevelDots(p.level)}<span class="lib-power-name">${escHtml(p.name)}</span></div>
    ${p.literary ? `<div class="lib-power-sec"><div class="lib-power-label">Литературное описание</div><p class="lib-power-text">${escHtml(p.literary)}</p></div>` : ''}
    ${p.system ? `<div class="lib-power-sec"><div class="lib-power-label">Система</div><p class="lib-power-text lib-power-sys">${escHtml(p.system)}</p></div>` : ''}
  </div>`;
}

// «Алхимия (Alchemy)» → «Алхимия»: на карточках английское имя в скобках не
// показываем (в заголовках модалок-деталей остаётся полное имя из данных).
function _libStripEn(name) {
  const s = String(name || '');
  const stripped = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return stripped || s;
}

// «общая (Малкавиан, Тореадор, Тремер)» → «Малкавиан, Тореадор, Тремер»:
// служебную пометку «общая» со скобками в подписи не показываем. Осмысленные
// скобки без этого префикса («Ассамиты (визири)») остаются как есть.
function _libCleanClans(clans) {
  const s = String(clans || '').trim();
  const m = s.match(/^общая\s*\(([^)]*)\)\s*$/i);
  return m ? m[1].trim() : s;
}

function _libDisciplineDetailHtml(d) {
  if (!d) return '<div class="v20-disc-empty">Дисциплина не найдена в справочнике.</div>';
  let body;
  if (d.noLevels && d.paths?.length) {
    // Path-based школы (Тауматургия/Некромантия/колдовские): в общем справочнике
    // Пути не перечисляем — только общее описание; полный разбор Путей живёт
    // на отдельной подвкладке библиотеки.
    body = `${d.note ? `<div class="v20-disc-note">${escHtml(d.note)}</div>` : ''}` +
      `<p class="lib-power-text">Путей: ${d.paths.length} — полный разбор на отдельной вкладке библиотеки «Дисциплины».</p>`;
  } else {
    body = `${d.note ? `<div class="v20-disc-note">${escHtml(d.note)}</div>` : ''}${(d.levels || []).map(_libPowerHtml).join('')}`;
  }
  return `<div class="v20-disc-detail-head"><h3>${escHtml(d.name)}</h3><span class="v20-disc-clans">${escHtml(_libCleanClans(d.clans))}</span></div>${body}`;
}
function _libDisciplineListHtml() {
  return `<div class="v20-disc-list">${(_disciplinesCache || []).map(d =>
    `<button type="button" class="v20-disc-list-item" data-disc-slug="${escAttr(d.slug)}"><span>${escHtml(d.name)}</span><span class="v20-disc-list-clans">${escHtml(_libCleanClans(d.clans))}</span></button>`).join('')}</div>`;
}

// Библиотека → вкладка «Дисциплины»: карточки (как у персонажей), а не список —
// клик открывает ту же модалку, что и ссылка на дисциплину в листе персонажа
// (см. _v20OpenDisciplineModal), а не подменяет содержимое страницы.
// Кнопки правки/удаления на карточке библиотеки — только для «custom» записей
// (Фаза I). category опционален (нужен только для merits/flaws/backgrounds,
// где PUT/DELETE адресуются по /:category/:slug, а не просто /:slug).
function _libCardActionsHtml(kind, slug, category) {
  const catAttr = category ? ` data-lib-category="${escAttr(category)}"` : '';
  return `<div class="lib-card-actions">
    <button type="button" class="lib-card-action-btn" data-lib-edit="${kind}" data-lib-slug="${escAttr(slug)}"${catAttr} title="Редактировать">✏️</button>
    <button type="button" class="lib-card-action-btn" data-lib-delete="${kind}" data-lib-slug="${escAttr(slug)}"${catAttr} title="Удалить">🗑</button>
  </div>`;
}

function _libDisciplineCardsHtml() {
  return `<div class="lib-cards">${(_disciplinesCache || []).map(d => {
    const art = d.hasArt
      ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/disciplines/${escAttr(d.slug)}.png" alt="">`
      : '';
    const badge = d.custom ? '<span class="lib-card-custom-badge">✏️ Авторское</span>' : '';
    const inner = `<div class="lib-card-name">${escHtml(_libStripEn(d.name))}</div><div class="lib-card-meta">${escHtml(_libCleanClans(d.clans))}</div>${badge}`;
    const actions = d.custom ? _libCardActionsHtml('disciplines', d.slug) : '';
    return `<div class="lib-card-wrap">
      <button type="button" class="lib-card${d.hasArt ? ' has-art' : ''}" data-disc-slug="${escAttr(d.slug)}">
        ${art}${d.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
      </button>
      ${actions}
    </div>`;
  }).join('')}</div>`;
}

// Колдовская вкладка (group != all/combo): карточки-Пути всех дисциплин этой
// группы. Клик по Пути открывает path-detail в общей модалке.
function _libSorceryPathsHtml(group) {
  const discs = (_disciplinesCache || []).filter(d => d.group === group);
  const cards = discs.flatMap(d => (d.paths || []).map(p => {
    const art = p.hasArt
      ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/paths/${escAttr(p.artSlug)}.png" alt="">`
      : '';
    const inner = `<div class="lib-card-name">${escHtml(_libStripEn(p.name))}</div>`;
    return `<div class="lib-card-wrap">
      <button type="button" class="lib-card${p.hasArt ? ' has-art' : ''}" data-disc-path="${escAttr(d.slug)}" data-path-name="${escAttr(p.name)}">
        ${art}${p.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
      </button>
    </div>`;
  }));
  if (!cards.length) return '<div class="v20-disc-empty">Пути этой дисциплины пока не заполнены.</div>';
  return `<div class="lib-cards">${cards.join('')}</div>`;
}

// Вкладка «Комбо Дисциплины»: карточки комбо (имя + предпосылки). Клик → detail.
function _libComboCardsHtml() {
  const list = _combosCache || [];
  if (!list.length) return '<div class="v20-disc-empty">Комбо-дисциплины пока не заполнены.</div>';
  return `<div class="lib-cards">${list.map(c => {
    const art = c.hasArt
      ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/combo/${escAttr(c.slug)}.png" alt="">`
      : '';
    const inner = `<div class="lib-card-name">${escHtml(_libStripEn(c.name))}</div><div class="lib-card-meta">${escHtml(c.prereq || '')}</div>`;
    return `<div class="lib-card-wrap">
      <button type="button" class="lib-card${c.hasArt ? ' has-art' : ''}" data-combo-slug="${escAttr(c.slug)}">
        ${art}${c.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
      </button>
    </div>`;
  }).join('')}</div>`;
}

// Имя дисциплины из листа («Прорицание», «Auspex», «Прорицание (Auspex)») → slug.
function v20DisciplineKey(name) {
  const norm = String(name || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
  if (!norm) return null;
  for (const d of (_disciplinesCache || [])) {
    const ru = d.name.toLowerCase().replace(/\(.*?\)/g, '').trim();
    if (ru === norm || norm.startsWith(ru) || ru.startsWith(norm)) return d.slug;
  }
  return null;
}
function v20DisciplineInfo(name) { const slug = v20DisciplineKey(name); return slug ? _discBySlug(slug) : null; }

function _v20RenderDisciplineLibrary() {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = `<h3>📚 Справочник дисциплин</h3>${_libDisciplineListHtml()}`;
}
function _v20RenderDisciplineDetail(slug) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = `<button type="button" class="v20-disc-back" data-disc-back>← к списку</button>${_libDisciplineDetailHtml(_discBySlug(slug))}`;
}

// Path-detail: одна колонка Пути (Некромантия/Тауматургия/колдовские) в общей модалке.
function _v20RenderDisciplinePathDetail(discSlug, pathName) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  const d = _discBySlug(discSlug);
  const p = d && (d.paths || []).find(x => x.name === pathName);
  if (!p) { body.innerHTML = '<div class="v20-disc-empty">Путь не найден.</div>'; return; }
  body.innerHTML = `<div class="v20-disc-detail-head"><h3>${escHtml(p.name)}</h3>` +
    `<span class="v20-disc-clans">${escHtml(d.name)}</span></div>` +
    `${p.note ? `<div class="v20-disc-note">${escHtml(p.note)}</div>` : ''}` +
    `${(p.levels || []).map(_libPowerHtml).join('')}`;
}
async function _v20OpenDisciplinePathModal(discSlug, pathName) {
  _v20OpenLibModalShell();
  await ensureDisciplines();
  _v20RenderDisciplinePathDetail(discSlug, pathName);
}

// Combo-detail: имя, предпосылки, описание, механика.
function _v20RenderComboDetail(slug) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  const c = _comboBySlug(slug);
  if (!c) { body.innerHTML = '<div class="v20-disc-empty">Комбо не найдено.</div>'; return; }
  body.innerHTML = `<div class="v20-disc-detail-head"><h3>${escHtml(c.name)}</h3>` +
    `<span class="v20-disc-clans">${escHtml(c.clans || '')}</span></div>` +
    `<div class="v20-disc-note">Требует: ${escHtml(c.prereq || '—')}</div>` +
    `${c.literary ? `<div class="lib-power-sec"><div class="lib-power-label">Литературное описание</div><p class="lib-power-text">${escHtml(c.literary)}</p></div>` : ''}` +
    `${c.system ? `<div class="lib-power-sec"><div class="lib-power-label">Система</div><p class="lib-power-text lib-power-sys">${escHtml(c.system)}</p></div>` : ''}`;
}
async function _v20OpenComboModal(slug) {
  _v20OpenLibModalShell();
  await ensureCombos();
  _v20RenderComboDetail(slug);
}
function _v20CloseDisciplineModal() {
  const m = document.getElementById('v20-disc-modal-backdrop');
  if (!m || !m.classList.contains('open')) return;
  m.classList.remove('open');
  // Возврат фокуса инициатору открытия (см. _v20OpenLibModalShell).
  if (_v20LibModalOpener && document.contains(_v20LibModalOpener)) _v20LibModalOpener.focus();
  _v20LibModalOpener = null;
}

// Открытие оболочки модалки: запоминаем инициатора и переносим фокус на ✕,
// чтобы клавиатура/скринридер сразу оказались внутри диалога; при закрытии
// фокус возвращается туда, откуда модалку открыли.
let _v20LibModalOpener = null;
function _v20OpenLibModalShell() {
  const modal = _v20EnsureLibModal();
  if (!modal.classList.contains('open')) _v20LibModalOpener = document.activeElement;
  modal.classList.add('open');
  requestAnimationFrame(() => modal.querySelector('#v20-disc-modal-close')?.focus());
  return modal;
}

// Single shared modal shell for all 4 library sections (disciplines/psychics/
// merits/flaws) — created once, on whichever section is opened first. All
// four click-delegate types are wired here (not per-section) so opening one
// section before another never leaves a type's clicks unhandled inside the
// modal (a real bug this fixed: the discipline-only and psychic-only openers
// used to each attach their own partial delegate on first creation only).
function _v20EnsureLibModal() {
  let modal = document.getElementById('v20-disc-modal-backdrop');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'v20-disc-modal-backdrop';
  modal.className = 'v20-disc-modal-backdrop';
  modal.innerHTML = `<div class="v20-disc-modal" role="dialog" aria-modal="true" aria-label="Справочник библиотеки">
    <button type="button" class="v20-disc-modal-close" id="v20-disc-modal-close" aria-label="Закрыть справочник">✕</button>
    <div id="v20-disc-modal-body"></div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) _v20CloseDisciplineModal(); });
  modal.querySelector('#v20-disc-modal-close').addEventListener('click', _v20CloseDisciplineModal);
  modal.addEventListener('click', e => {
    // data-modal-close: merits/flaws detail has no in-modal list to return to
    // (only disciplines/psychics do, since those are also opened by name from
    // a character sheet reference) — its "back" just closes the modal.
    const close = e.target.closest('[data-modal-close]'); if (close) { _v20CloseDisciplineModal(); return; }
    const back = e.target.closest('[data-disc-back]'); if (back) { _v20RenderDisciplineLibrary(); return; }
    const item = e.target.closest('[data-disc-slug]'); if (item) { _v20RenderDisciplineDetail(item.dataset.discSlug); return; }
    const pback = e.target.closest('[data-psy-back]'); if (pback) { _v20RenderPsychicLibrary(); return; }
    const pitem = e.target.closest('[data-psy-slug]'); if (pitem) { _v20RenderPsychicDetail(pitem.dataset.psySlug); return; }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _v20CloseDisciplineModal(); });
  // Лёгкая ловушка фокуса: Tab циклится внутри открытой модалки.
  modal.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !modal.classList.contains('open')) return;
    const foci = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!foci.length) return;
    const first = foci[0], last = foci[foci.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  return modal;
}

async function _v20OpenDisciplineModal(name, preresolvedSlug) {
  _v20OpenLibModalShell();
  const body = document.getElementById('v20-disc-modal-body');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка справочника…</div>';
  await ensureDisciplines();
  const slug = preresolvedSlug || (name ? v20DisciplineKey(name) : null);
  if (slug) _v20RenderDisciplineDetail(slug);
  else _v20RenderDisciplineLibrary();
}

// ── Library page → «Дисциплины» tab: cards (as characters), detail opens in
// the shared modal (_v20OpenDisciplineModal) instead of replacing the page ──
let _libDiscGroup = 'all';
function _libRenderDisciplineGroup() {
  const body = document.getElementById('lib-disciplines-body');
  if (!body) return;
  const g = _libDiscGroup;
  if (g === 'all')        body.innerHTML = _libDisciplineCardsHtml();
  else if (g === 'combo') body.innerHTML = _libComboCardsHtml();
  else                    body.innerHTML = _libSorceryPathsHtml(g);
}
async function loadLibrary(group) {
  if (group) _libDiscGroup = group;
  const body = document.getElementById('lib-disciplines-body');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  await ensureDisciplines();
  if (_libDiscGroup === 'combo') await ensureCombos();
  _libRenderDisciplineGroup();
}
document.getElementById('lib-disciplines-body')?.addEventListener('click', e => {
  const path = e.target.closest('[data-disc-path]');
  if (path) { _v20OpenDisciplinePathModal(path.dataset.discPath, path.dataset.pathName); return; }
  const combo = e.target.closest('[data-combo-slug]');
  if (combo) { _v20OpenComboModal(combo.dataset.comboSlug); return; }
  const card = e.target.closest('[data-disc-slug]');
  if (card) _v20OpenDisciplineModal(null, card.dataset.discSlug);
});

// ── Psychic powers reference library (зеркало справочника дисциплин выше) ──────
// Источник истины — system/library/psychics/*.md (сервер парсит → /api/library/psychics).
let _psychicsCache = null;
async function ensurePsychics() {
  if (_psychicsCache) return _psychicsCache;
  try {
    const data = await fetch('/api/library/psychics').then(r => r.json());
    _psychicsCache = Array.isArray(data) ? data : [];
  } catch { _psychicsCache = []; }
  return _psychicsCache;
}
function _psyBySlug(slug) { return (_psychicsCache || []).find(p => p.slug === slug) || null; }

function _libPsyDetailHtml(p) {
  if (!p) return '<div class="v20-disc-empty">Способность не найдена в справочнике.</div>';
  const body = `${p.note ? `<div class="v20-disc-note">${escHtml(p.note)}</div>` : ''}${(p.levels || []).map(_libPowerHtml).join('')}`;
  const meta = [p.category, p.roll ? `Бросок: ${p.roll}` : ''].filter(Boolean).join(' · ');
  return `<div class="v20-disc-detail-head"><h3>${escHtml(p.name)}</h3><span class="v20-disc-clans">${escHtml(meta)}</span></div>${body}`;
}
function _libPsyListHtml() {
  return `<div class="v20-disc-list">${(_psychicsCache || []).map(p =>
    `<button type="button" class="v20-disc-list-item" data-psy-slug="${escAttr(p.slug)}"><span>${escHtml(p.name)}</span><span class="v20-disc-list-clans">${escHtml(p.category || '')}</span></button>`).join('')}</div>`;
}
// Библиотека → вкладка «Психика»: карточки (как у персонажей), детали — в той же
// общей модалке, что и дисциплины (см. _v20OpenPsychicModal ниже).
function _libPsychicCardsHtml() {
  return `<div class="lib-cards">${(_psychicsCache || []).map(p => {
    const art = p.hasArt
      ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/psychics/${escAttr(p.slug)}.png" alt="">`
      : '';
    const badge = p.custom ? '<span class="lib-card-custom-badge">✏️ Авторское</span>' : '';
    const inner = `<div class="lib-card-name">${escHtml(_libStripEn(p.name))}</div><div class="lib-card-meta">${escHtml(p.category || '')}</div>${badge}`;
    const actions = p.custom ? _libCardActionsHtml('psychics', p.slug) : '';
    return `<div class="lib-card-wrap">
      <button type="button" class="lib-card${p.hasArt ? ' has-art' : ''}" data-psy-slug="${escAttr(p.slug)}">
        ${art}${p.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
      </button>
      ${actions}
    </div>`;
  }).join('')}</div>`;
}
function _libRenderPsyList() {
  const body = document.getElementById('lib-psychics-body');
  if (body) body.innerHTML = _libPsychicCardsHtml();
}
async function loadPsychicsLibrary() {
  const body = document.getElementById('lib-psychics-body');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  await ensurePsychics();
  _libRenderPsyList();
}
document.getElementById('lib-psychics-body')?.addEventListener('click', e => {
  const card = e.target.closest('[data-psy-slug]');
  if (card) _v20OpenPsychicModal(null, card.dataset.psySlug);
});

// ── Библиотека: справочник достоинств (физические/умственные/социальные/сверхъестественные) ──
let _meritsCache = { physical: null, mental: null, social: null, supernatural: null };

function _libMeritDetailHtml(m) {
  if (!m) return '<div class="cdet-empty">Достоинство не найдено в справочнике.</div>';
  return `<div class="v20-disc-detail-head"><h3>${escHtml(m.name)}</h3></div><div class="merit-lib-detail"><div class="merit-lib-cost">${'●'.repeat(m.points)} очков</div><div class="merit-lib-desc">${escHtml(m.description)}</div></div>`;
}

// Библиотека → вкладка «Достоинства»: карточки (как у персонажей), детали — в
// общей модалке (см. _v20EnsureLibModal). Категория идёт с карточки, т.к. кэш
// достоинств ключуется по категории, а не общим списком, как у дисциплин.
function _libMeritCardsHtml(category) {
  const merits = _meritsCache[category] || [];
  return `<div class="lib-cards">${merits.map(m => {
    const art = m.hasArt
      ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/merits/${escAttr(m.slug)}.png" alt="">`
      : '';
    const inner = `<div class="lib-card-name">${escHtml(m.name)}</div>
      <div class="lib-card-points">${'<span class="lib-dot"></span>'.repeat(m.points)}</div>
      ${m.custom ? '<span class="lib-card-custom-badge">✏️ Авторское</span>' : ''}`;
    return `<div class="lib-card-wrap">
      <button type="button" class="lib-card${m.hasArt ? ' has-art' : ''}" data-merit-slug="${escAttr(m.slug)}" data-merit-category="${category}">
        ${art}${m.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
      </button>
      ${m.custom ? _libCardActionsHtml('merits', m.slug, category) : ''}
    </div>`;
  }).join('')}</div>`;
}

function _libRenderMeritList(category) {
  const body = document.getElementById('lib-merits-body');
  if (body) body.innerHTML = _libMeritCardsHtml(category);
}

function _v20RenderMeritDetail(slug, category) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  const merit = (_meritsCache[category] || []).find(m => m.slug === slug);
  body.innerHTML = `<button type="button" class="v20-disc-back" data-modal-close>← закрыть</button>${_libMeritDetailHtml(merit)}`;
}

async function _v20OpenMeritModal(slug, category) {
  _v20OpenLibModalShell();
  _v20RenderMeritDetail(slug, category);
}

async function loadMeritsLibrary(category) {
  const body = document.getElementById('lib-merits-body');
  if (!body) return;

  body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';

  try {
    const merits = await fetch(`/api/library/merits/${category}`).then(r => r.json());
    _meritsCache[category] = Array.isArray(merits) ? merits : [];
    _libRenderMeritList(category);
  } catch (e) {
    body.innerHTML = `<div class="cdet-empty">Ошибка загрузки: ${escHtml(e.message)}</div>`;
  }
}

document.getElementById('lib-merits-body')?.addEventListener('click', e => {
  const card = e.target.closest('[data-merit-slug]');
  if (card) _v20OpenMeritModal(card.dataset.meritSlug, card.dataset.meritCategory);
});

// ── Библиотека: справочник недостатков (физические/умственные/социальные/сверхъестественные) ──
let _flawsCache = { 'физические': null, 'умственные': null, 'социальные': null, 'сверхъестественные': null };

function _libFlawDetailHtml(m) {
  if (!m) return '<div class="cdet-empty">Недостаток не найден в справочнике.</div>';
  return `<div class="v20-disc-detail-head"><h3>${escHtml(m.name)}</h3></div><div class="merit-lib-detail"><div class="merit-lib-cost">${'●'.repeat(m.points)} очков</div><div class="merit-lib-desc">${escHtml(m.description)}</div></div>`;
}

// Библиотека → вкладка «Недостатки»: карточки (как у персонажей), детали — в
// общей модалке (см. _v20EnsureLibModal). Зеркалит достоинства выше.
function _libFlawCardsHtml(category) {
  const flaws = _flawsCache[category] || [];
  return `<div class="lib-cards">${flaws.map(m => {
    const art = m.hasArt
      ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/flaws/${escAttr(m.slug)}.png" alt="">`
      : '';
    const inner = `<div class="lib-card-name">${escHtml(m.name)}</div>
      <div class="lib-card-points">${'<span class="lib-dot"></span>'.repeat(m.points)}</div>
      ${m.custom ? '<span class="lib-card-custom-badge">✏️ Авторское</span>' : ''}`;
    return `<div class="lib-card-wrap">
      <button type="button" class="lib-card${m.hasArt ? ' has-art' : ''}" data-flaw-slug="${escAttr(m.slug)}" data-flaw-category="${category}">
        ${art}${m.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
      </button>
      ${m.custom ? _libCardActionsHtml('flaws', m.slug, category) : ''}
    </div>`;
  }).join('')}</div>`;
}

function _libRenderFlawList(category) {
  const body = document.getElementById('lib-flaws-body');
  if (body) body.innerHTML = _libFlawCardsHtml(category);
}

function _v20RenderFlawDetail(slug, category) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  const flaw = (_flawsCache[category] || []).find(m => m.slug === slug);
  body.innerHTML = `<button type="button" class="v20-disc-back" data-modal-close>← закрыть</button>${_libFlawDetailHtml(flaw)}`;
}

async function _v20OpenFlawModal(slug, category) {
  _v20OpenLibModalShell();
  _v20RenderFlawDetail(slug, category);
}

async function loadFlawsLibrary(category) {
  const body = document.getElementById('lib-flaws-body');
  if (!body) return;

  body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';

  try {
    const flaws = await fetch(`/api/library/flaws/${encodeURIComponent(category)}`).then(r => r.json());
    _flawsCache[category] = Array.isArray(flaws) ? flaws : [];
    _libRenderFlawList(category);
  } catch (e) {
    body.innerHTML = `<div class="cdet-empty">Ошибка загрузки: ${escHtml(e.message)}</div>`;
  }
}

document.getElementById('lib-flaws-body')?.addEventListener('click', e => {
  const card = e.target.closest('[data-flaw-slug]');
  if (card) _v20OpenFlawModal(card.dataset.flawSlug, card.dataset.flawCategory);
});

// ── Библиотека: справочник фактов биографии (общие/вампиры/гули/маги/подменыши) ──
// В отличие от достоинств/недостатков, у Дополнений нет фиксированной
// стоимости — это шкала 1–5, где важно, что даёт каждый уровень. Поэтому
// карточка/детали рендерятся по образцу дисциплин (_libPowerHtml/_libLevelDots),
// а не достоинств (_libMeritDetailHtml).
let _backgroundsCache = { general: null, vampire: null, ghoul: null, mage: null, changeling: null };

function _backgroundBySlug(category, slug) {
  return (_backgroundsCache[category] || []).find(b => b.slug === slug) || null;
}

// Разбирает multiline "system" ("1: текст\n2: текст\n…") в HTML-блоки уровней,
// тем же визуальным языком, что и уровни дисциплин/психики.
function _libBackgroundLevelsHtml(system) {
  const levels = String(system || '').split('\n').map(line => {
    const m = line.match(/^(\d+):\s*(.*)$/);
    return m ? { n: parseInt(m[1], 10), text: m[2] } : null;
  }).filter(Boolean);
  return levels.map(l => `<div class="lib-power">
    <div class="lib-power-head">${_libLevelDots(l.n)}</div>
    <p class="lib-power-text">${escHtml(l.text)}</p>
  </div>`).join('');
}

function _libBackgroundDetailHtml(b) {
  if (!b) return '<div class="cdet-empty">Факт биографии не найден в справочнике.</div>';
  const sect = b.sectOnly ? `<span class="lib-card-sect">Только ${escHtml(b.sectOnly)}</span>` : '';
  const note = b.description ? `<div class="v20-disc-note">${escHtml(b.description)}</div>` : '';
  return `<div class="v20-disc-detail-head"><h3>${escHtml(b.name)}</h3>${sect}</div>${note}${_libBackgroundLevelsHtml(b.system)}`;
}

function _libBackgroundCardsHtml(category) {
  const items = _backgroundsCache[category] || [];
  return `<div class="lib-cards">${items.map(b => {
    const art = b.hasArt
      ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/backgrounds/${escAttr(b.slug)}.png" alt="">`
      : '';
    const inner = `<div class="lib-card-name">${escHtml(b.name)}</div>
      ${b.sectOnly ? `<div class="lib-card-sect">Только ${escHtml(b.sectOnly)}</div>` : ''}
      ${b.custom ? '<span class="lib-card-custom-badge">✏️ Авторское</span>' : ''}`;
    return `<div class="lib-card-wrap">
      <button type="button" class="lib-card${b.hasArt ? ' has-art' : ''}" data-bg-slug="${escAttr(b.slug)}" data-bg-category="${category}">
        ${art}${b.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
      </button>
      ${b.custom ? _libCardActionsHtml('backgrounds', b.slug, category) : ''}
    </div>`;
  }).join('')}</div>`;
}

function _libRenderBackgroundList(category) {
  const body = document.getElementById('lib-backgrounds-body');
  if (body) body.innerHTML = _libBackgroundCardsHtml(category);
}

function _v20RenderBackgroundDetail(slug, category) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = `<button type="button" class="v20-disc-back" data-modal-close>← закрыть</button>${_libBackgroundDetailHtml(_backgroundBySlug(category, slug))}`;
}

async function _v20OpenBackgroundModal(slug, category) {
  _v20OpenLibModalShell();
  _v20RenderBackgroundDetail(slug, category);
}

async function loadBackgroundsLibrary(category) {
  const body = document.getElementById('lib-backgrounds-body');
  if (!body) return;

  body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';

  try {
    const items = await fetch(`/api/library/backgrounds/${category}`).then(r => r.json());
    _backgroundsCache[category] = Array.isArray(items) ? items : [];
    _libRenderBackgroundList(category);
  } catch (e) {
    body.innerHTML = `<div class="cdet-empty">Ошибка загрузки: ${escHtml(e.message)}</div>`;
  }
}

document.getElementById('lib-backgrounds-body')?.addEventListener('click', e => {
  const card = e.target.closest('[data-bg-slug]');
  if (card) _v20OpenBackgroundModal(card.dataset.bgSlug, card.dataset.bgCategory);
});

// ── Mortal sheet: «Психические способности» row reference (зеркало v20DisciplineKey/
// _v20OpenDisciplineModal выше, но источник — _psychicsCache/ensurePsychics(), не дисциплины).
// Имя силы из листа («Психометрия», «Биоконтроль») → slug в справочнике психических способностей.
function v20PsychicKey(name) {
  const norm = String(name || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
  if (!norm) return null;
  for (const p of (_psychicsCache || [])) {
    const ru = p.name.toLowerCase().replace(/\(.*?\)/g, '').trim();
    if (ru === norm || norm.startsWith(ru) || ru.startsWith(norm)) return p.slug;
  }
  return null;
}
function v20PsychicInfo(name) { const slug = v20PsychicKey(name); return slug ? _psyBySlug(slug) : null; }

function _v20RenderPsychicLibrary() {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = `<h3>📚 Справочник психических способностей</h3>${_libPsyListHtml()}`;
}
function _v20RenderPsychicDetail(slug) {
  const body = document.getElementById('v20-disc-modal-body');
  if (!body) return;
  body.innerHTML = `<button type="button" class="v20-disc-back" data-psy-back>← к списку</button>${_libPsyDetailHtml(_psyBySlug(slug))}`;
}
// Reuses the same modal shell/backdrop as _v20OpenDisciplineModal (#v20-disc-modal-backdrop) —
// only one of the two modals is ever open at a time (vampire sheet has no psychic rows and vice
// versa), so sharing the DOM node is safe and avoids a near-duplicate modal markup block.
async function _v20OpenPsychicModal(name, preresolvedSlug) {
  _v20OpenLibModalShell();
  const body = document.getElementById('v20-disc-modal-body');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка справочника…</div>';
  await ensurePsychics();
  const slug = preresolvedSlug || (name ? v20PsychicKey(name) : null);
  if (slug) _v20RenderPsychicDetail(slug);
  else _v20RenderPsychicLibrary();
}

// ── XP mode: clicking a dot up spends experience instead of a free edit ──
let _v20XpMode = false;

function _v20LabelFromPath(path, m) {
  const parts = path.split('.');
  if (parts[0] === 'attributes') { const found = V20_ATTRS[parts[1]]?.find(([k]) => k === parts[2]); return found ? found[1] : parts[2]; }
  if (parts[0] === 'abilities') return m.abilities[parts[1]][+parts[2]]?.name || 'Способность';
  return path;
}

function _v20XpKindFromPath(path, m) {
  if (path.startsWith('attributes.')) return { kind: 'attribute', label: _v20LabelFromPath(path, m) };
  if (path.startsWith('abilities.')) return { kind: 'ability', label: _v20LabelFromPath(path, m) };
  if (path.startsWith('disciplines.')) {
    const name = m.disciplines[+path.split('.')[1]]?.name || 'Дисциплина';
    const info = v20ClanInfo(m.header.clan);
    const isClanDisc = !!(info && info.disciplines.some(d => _v20Norm(d) === _v20Norm(name)));
    return { kind: 'discipline', label: name, isClanDisc };
  }
  if (path === 'virtues.conscience')  return { kind: 'virtue', label: 'Совесть/Решимость' };
  if (path === 'virtues.selfcontrol') return { kind: 'virtue', label: 'Самоконтроль/Инстинкты' };
  if (path === 'virtues.courage')     return { kind: 'virtue', label: 'Смелость' };
  if (path === 'humanity')            return { kind: 'humanity', label: m.path || 'Человечность' };
  if (path === 'willpower.permanent') return { kind: 'willpower', label: 'Воля' };
  return null; // факты биографии и пр. — без таблицы стоимости, повышаются свободно даже в режиме опыта
}

// Unchecks the highest filled box in a boolean-array pool (spend 1 point of blood/willpower).
function _v20SpendPool(path) {
  const arr = _v20Get(_v20Model, path) || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i]) { arr[i] = false; _v20Set(_v20Model, path, arr); return true; }
  }
  return false;
}

async function _v20RunAction(action) {
  const m = _v20Model;
  if (action === 'fill-clan-disc') {
    const info = v20ClanInfo(m.header.clan);
    if (!info) return;
    // disciplines больше не гарантированно предзаполнен 6 слотами (см. _v20Empty) — создать
    // строку, если её ещё нет, вместо записи в несуществующий объект по индексу.
    info.disciplines.slice(0, 3).forEach((name, i) => {
      if (!m.disciplines[i]) m.disciplines[i] = { name: '', val: 0 };
      m.disciplines[i].name = name;
    });
  } else if (action === 'insert-clan-weakness') {
    const info = v20ClanInfo(m.header.clan);
    if (!info || !info.weakness) return;
    if (m.flaw.trim() && !await showConfirm('Поле «Изъян» не пустое. Заменить текущий текст слабостью клана?', { confirmText: 'Заменить' })) return;
    m.flaw = info.weakness;
  } else if (action === 'open-disc-library') {
    _v20ToggleLibPicker('discipline');
    return;
  } else if (action === 'open-psy-library') {
    _v20ToggleLibPicker('numina');
    return;
  } else if (action === 'spend-blood') {
    const genInfo = (m.lineage || '') === 'vampires' ? v20GenerationInfo(m.header.generation) : null;
    if (genInfo && genInfo.bloodMax == null) {   // 3-е поколение — счётчик без потолка
      if (_num(m.bloodPoolCount, 0) <= 0) return;
      m.bloodPoolCount = _num(m.bloodPoolCount, 0) - 1;
    } else if (!_v20SpendPool('bloodPool')) return;
  } else if (action === 'spend-willpower') {
    if (!_v20SpendPool('willpower.temp')) return;
  } else return;
  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}

// V20 inline library picker (disciplines/numina in character sheet)
async function _v20LoadLibrary(kind) {
  if (_v20LibraryCache[kind]) return _v20LibraryCache[kind];
  try {
    if (kind === 'meritflaw') {
      // Достоинства/недостатки живут в двух раздельных эндпоинтах — сливаем в один список,
      // помечая каждую запись _kind (сырые JSON-записи library/{merits,flaws} не несут этот
      // дискриминатор сами по себе, в отличие от серверного индекса foundry-merits.js).
      const [merits, flaws] = await Promise.all([
        fetch('/api/library/merits').then(r => r.json()),
        fetch('/api/library/flaws').then(r => r.json()),
      ]);
      const tag = (list, k) => (Array.isArray(list) ? list : []).map(x => ({ ...x, _kind: k }));
      _v20LibraryCache[kind] = [...tag(merits, 'merit'), ...tag(flaws, 'flaw')];
    } else {
      const endpoint = kind === 'discipline' ? '/api/library/disciplines'
        : kind === 'background' ? '/api/library/backgrounds'
        : '/api/library/psychics';
      const data = await fetch(endpoint).then(r => r.json());
      _v20LibraryCache[kind] = Array.isArray(data) ? data : [];
    }
  } catch { _v20LibraryCache[kind] = []; }
  return _v20LibraryCache[kind];
}

function _v20LibPickerKindToSection(kind) {
  if (kind === 'discipline') return 'disciplines';
  if (kind === 'meritflaw') return 'meritsFlaws';
  if (kind === 'background') return 'backgrounds';
  return 'psychicPowers';
}

async function _v20ToggleLibPicker(kind) {
  const panel = document.getElementById('cdet-sheet-panel');
  if (!panel) return;
  const picker = panel.querySelector(`.v20-lib-picker[data-v20-lib-kind="${kind}"]`);
  if (!picker) return;

  if (picker.hidden) {
    picker.hidden = false;
    const lib = await _v20LoadLibrary(kind);
    _v20RenderV20LibList(kind, lib, picker);
  } else {
    picker.hidden = true;
  }
}

function _v20RenderV20LibList(kind, lib, pickerEl) {
  const listEl = pickerEl.querySelector('.v20-lib-list');
  if (!listEl) return;
  listEl.innerHTML = (lib || []).map(item => {
    const name = item.name || item.ru || '';
    const hint = kind === 'meritflaw'
      ? `${item._kind === 'flaw' ? 'Недостаток' : 'Достоинство'} · ${item.category || ''} · ${item.points ?? 0} очк.`
      : kind === 'background'
      ? [item.category, item.sectOnly ? `только ${item.sectOnly}` : ''].filter(Boolean).join(' · ')
      : ((item.levels || []).length ? `${(item.levels || []).length} уровней` : '');
    return `<button type="button" class="v20-lib-item" data-v20-lib-item="${escAttr(name)}" data-v20-lib-kind="${kind}"><span>${escHtml(name)}</span><span class="v20-lib-hint">${escHtml(hint)}</span></button>`;
  }).join('');
}

function _v20AddLibraryItem(kind, name) {
  const section = _v20LibPickerKindToSection(kind);
  const m = _v20Model;
  if (!m[section]) return;

  if (kind === 'meritflaw') {
    // Достоинства/недостатки хранят points+kind из библиотеки, не дот-значение «1», в отличие
    // от дисциплин/нумина ниже — берём их из закешированного списка пикера по имени.
    const lib = _v20LibraryCache.meritflaw || [];
    const found = lib.find(x => (x.name || '') === name);
    const points = found ? Number(found.points) || 0 : 0;
    const mfKind = found?._kind === 'flaw' ? 'flaw' : 'merit';
    const emptySlot = m.meritsFlaws.find(x => !String(x?.name || '').trim());
    if (emptySlot) { emptySlot.name = name; emptySlot.points = points; emptySlot.kind = mfKind; }
    else m.meritsFlaws.push({ name, points, kind: mfKind });
    _v20MarkDirty();
    _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
    return;
  }

  // Заполнить первую уже существующую пустую строку (оставшуюся от ИИ-листа или от «+
  // Добавить»), а не всегда плодить новую — иначе клик по «+ Из справочника» добавлял 7-ю
  // строку, даже если впереди были пустые.
  const emptySlot = m[section].find(x => !String(x?.name || '').trim());
  if (emptySlot) { emptySlot.name = name; emptySlot.val = 1; }
  else m[section].push({ name, val: 1 });

  _v20MarkDirty();
  _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}

// Advisory budget/limit check (not blocking — Рассказчик может переопределить вручную).
function _v20Validate(m) {
  const lineage = m.lineage || 'vampires';
  const budget = lineage === 'vampires' ? RULES_V20.creation.vampires.kamarilla
    : lineage === 'mortals' ? RULES_V20.creation.mortals
    : lineage === 'fairies' ? RULES_V20.creation.fairies
    : null;
  if (!budget) return { items: [], warnings: [{ text: 'Для этой линейки бюджеты создания не определены.', level: 'info' }] };

  const attrTotal = ['physical', 'social', 'mental'].reduce((a, g) => a + Object.values(m.attributes[g]).reduce((x, y) => x + y, 0), 0);
  const abilTotal = ['talents', 'skills', 'knowledges'].reduce((a, g) => a + m.abilities[g].reduce((x, s) => x + _num(s.val, 0), 0), 0);
  const virtTotal = m.virtues.conscience + m.virtues.selfcontrol + m.virtues.courage;
  const bgTotal = m.backgrounds.reduce((a, b) => a + _num(b.val, 0), 0);
  const discTotal = m.disciplines.reduce((a, d) => a + _num(d.val, 0), 0);

  const items = [
    { label: 'Характеристики', used: attrTotal - 9, max: budget.attrs.reduce((a, b) => a + b, 0) },
    { label: 'Способности', used: abilTotal, max: budget.abilities.reduce((a, b) => a + b, 0) },
    { label: 'Добродетели', used: virtTotal - 3, max: budget.virtues },
    { label: 'Факты биографии', used: bgTotal, max: budget.backgrounds },
  ];
  if (lineage === 'vampires') items.push({ label: 'Дисциплины (старт.)', used: discTotal, max: budget.disciplines });

  const warnings = [];
  const stillChargen = _num(m.experience.spent, 0) === 0;
  if (stillChargen) {
    for (const g of ['talents', 'skills', 'knowledges']) for (const s of m.abilities[g]) {
      if (_num(s.val, 0) > 3 && s.name) warnings.push({ text: `«${s.name}» выше 3 при создании (только свободные очки/одобрение Рассказчика)`, level: 'warn' });
    }
  }
  if (lineage === 'vampires') {
    // Единая таблица максимума точек (см. RULES_V20.generations[gen].maxDots, character_sheet_v20.md)
    // — потолок для характеристик/способностей/дисциплин/фактов биографии, не только дисциплин.
    const maxDots = _v20MaxDotsForGen(m.header.generation);
    for (const g of ['physical', 'social', 'mental']) for (const [k, ru] of V20_ATTRS[g]) {
      if (m.attributes[g][k] > maxDots) warnings.push({ text: `«${ru}» (${m.attributes[g][k]}) выше максимума для поколения (${maxDots}, сейчас: ${m.header.generation || '—'})`, level: 'error' });
    }
    for (const g of ['talents', 'skills', 'knowledges']) for (const s of m.abilities[g]) {
      if (s.name && _num(s.val, 0) > maxDots) warnings.push({ text: `«${s.name}» (${s.val}) выше максимума для поколения (${maxDots})`, level: 'error' });
    }
    for (const d of m.disciplines) {
      if (d.name && d.val > maxDots) warnings.push({ text: `«${d.name}» (${d.val}) выше максимума для поколения (${maxDots})`, level: 'error' });
    }
    for (const b of m.backgrounds) {
      if (b.name && b.val > maxDots) warnings.push({ text: `«${b.name}» (${b.val}) выше максимума для поколения (${maxDots})`, level: 'error' });
    }
  } else {
    for (const g of ['physical', 'social', 'mental']) for (const [k, ru] of V20_ATTRS[g]) {
      if (m.attributes[g][k] > 5) warnings.push({ text: `«${ru}» выше 5`, level: 'error' });
    }
  }
  return { items, warnings };
}

function _v20RenderValidationReport(m) {
  const r = _v20Validate(m);
  const rows = r.items.map(it => `<div class="v20-val-row${it.used > it.max ? ' over' : ''}"><span>${escHtml(it.label)}</span><span>${it.used} / ${it.max}</span></div>`).join('');
  const warn = r.warnings.length
    ? `<ul class="v20-val-warnings">${r.warnings.map(w => `<li class="v20-val-${w.level}">${escHtml(w.text)}</li>`).join('')}</ul>`
    : `<div class="v20-val-ok">Нарушений не найдено.</div>`;
  return `<div class="v20-val-budgets">${rows}</div>${warn}<div class="v20-val-note">Свободные очки и опыт не учитываются — лимиты ориентировочные.</div>`;
}

function _v20ToggleValidation() {
  const box = document.getElementById('v20-validate-report');
  if (!box) return;
  if (box.classList.contains('open')) { box.classList.remove('open'); box.innerHTML = ''; return; }
  box.innerHTML = _v20RenderValidationReport(_v20Model);
  box.classList.add('open');
}

function _v20RenderSheet(panel, charName) {
  const m = _v20Model;
  const isVamp = (m.lineage || '') === 'vampires';
  const derived = _v20Derive(m);
  const clanInfo = isVamp ? v20ClanInfo(m.header.clan) : null;

  const genMaxDots = isVamp ? _v20MaxDotsForGen(m.header.generation) : 5;   // Единая таблица максимума точек (атрибуты/способности/дисциплины/факты биографии)
  const rollIcon = (kind, path) => `<button type="button" class="v20-roll-icon-btn" data-roll-seed="${kind}:${path}" title="Бросок">🎲</button>`;
  const attrCol = g => `<div class="v20-col"><div class="v20-col-title">${V20_ATTR_GROUP_LABELS[g]}</div>${V20_ATTRS[g].map(([k, ru]) =>
    `<div class="v20-row-roll-wrap">${_v20DotRow(ru, `attributes.${g}.${k}`, m.attributes[g][k], genMaxDots)}${rollIcon('attr', `attributes.${g}.${k}`)}</div>`).join('')}</div>`;
  const abilCol = g => {
    const baseline = _v20AbilityBaselineLen(g);
    const rows = m.abilities[g].map((slot, i) => {
      const rowHtml = slot.fixed
        ? _v20DotRow(slot.name, `abilities.${g}.${i}.val`, slot.val, genMaxDots)
        : _v20NamedDotRow(`abilities.${g}.${i}.name`, slot.name, `abilities.${g}.${i}.val`, slot.val, genMaxDots, i >= baseline ? `abilities:${g}` : '');
      return `<div class="v20-row-roll-wrap">${rowHtml}${slot.name ? rollIcon('abil', `abilities.${g}.${i}`) : ''}</div>`;
    }).join('');
    return `<div class="v20-col"><div class="v20-col-title">${V20_ABILITY_GROUP_LABELS[g]}${_v20AddRowBtn(`abilities:${g}`)}</div>${rows}</div>`;
  };

  const header = `
    <div class="v20-header">
      ${_v20Field('Имя', 'header.name', m.header.name)}
      ${_v20Field('Натура', 'header.nature', m.header.nature)}
      ${isVamp ? _v20Field('Клан', 'header.clan', m.header.clan) : _v20Field('Концепция', 'header.concept', m.header.concept)}
      ${_v20Field('Игрок', 'header.player', m.header.player)}
      ${_v20Field('Маска', 'header.demeanor', m.header.demeanor)}
      ${isVamp ? _v20Field('Поколение', 'header.generation', m.header.generation) : _v20Field('—', 'header._x1', '')}
      ${_v20Field('Хроника', 'header.chronicle', m.header.chronicle)}
      ${_v20Field('Амплуа', 'header.concept', m.header.concept)}
      ${isVamp ? _v20Field('Сир', 'header.sire', m.header.sire) : _v20Field('—', 'header._x2', '')}
    </div>`;

  const attributes = `
    <div class="v20-band">Характеристики</div>
    <div class="v20-grid3">${attrCol('physical')}${attrCol('social')}${attrCol('mental')}</div>`;

  const abilities = `
    <div class="v20-band">Способности</div>
    <div class="v20-grid3">${abilCol('talents')}${abilCol('skills')}${abilCol('knowledges')}</div>`;

  const discFillBtn = clanInfo && m.disciplines.slice(0, 3).every(d => !d.name)
    ? `<button type="button" class="v20-mini-action" data-v20-action="fill-clan-disc">+ клановые</button>` : '';
  const discLibBtn = `<button type="button" class="v20-mini-action v20-lib-add-btn" data-v20-lib-kind="discipline" title="Добавить из справочника дисциплин">+ Из справочника</button>`;
  const discRow = (d, i) => {
    const known = !!v20DisciplineKey(d.name);
    const infoBtn = known ? `<button type="button" class="v20-disc-info-btn" data-disc-view="${escAttr(d.name)}" title="Силы по уровням: ${escAttr(d.name)}">ℹ</button>` : '';
    const rm = i >= _V20_BASELINE_LEN.disciplines ? `<button type="button" class="v20-row-remove-btn" data-v20-remove="disciplines" data-v20-remove-idx="${i}" title="Удалить строку">×</button>` : '';
    return `<div class="v20-row v20-named v20-disc-row">${rm}${infoBtn}<input class="v20-line-input" data-tpath="disciplines.${i}.name" value="${escAttr(d.name)}" placeholder="…">${_v20DotsHtml(`disciplines.${i}.val`, d.val, genMaxDots)}</div>`;
  };
  const discCol = `<div class="v20-col">
    <div class="v20-col-title">Дисциплины${discFillBtn}${discLibBtn}${_v20AddRowBtn('disciplines')}</div>
    <div class="v20-lib-picker" data-v20-lib-kind="discipline" hidden>
      <input type="text" class="v20-lib-search" placeholder="Поиск…" data-v20-lib-kind="discipline">
      <div class="v20-lib-list" data-v20-lib-kind="discipline"></div>
    </div>
    ${m.disciplines.map(discRow).join('')}
  </div>`;
  const bgLibBtn = `<button type="button" class="v20-mini-action v20-lib-add-btn" data-v20-lib-kind="background" title="Добавить из справочника фактов биографии">+ Из справочника</button>`;
  const bgCol = `<div class="v20-col"><div class="v20-col-title">Факты биографии${bgLibBtn}${_v20AddRowBtn('backgrounds')}</div>
    <div class="v20-lib-picker" data-v20-lib-kind="background" hidden>
      <input type="text" class="v20-lib-search" placeholder="Поиск…" data-v20-lib-kind="background">
      <div class="v20-lib-list" data-v20-lib-kind="background"></div>
    </div>
    ${m.backgrounds.map((b, i) => _v20NamedDotRow(`backgrounds.${i}.name`, b.name, `backgrounds.${i}.val`, b.val, genMaxDots, i >= _V20_BASELINE_LEN.backgrounds ? 'backgrounds' : '')).join('')}</div>`;
  const virtCol = `<div class="v20-col"><div class="v20-col-title">Добродетели</div>
      ${_v20DotRow('Совесть/Решимость', 'virtues.conscience', m.virtues.conscience)}
      ${_v20DotRow('Самоконтроль/Инстинкты', 'virtues.selfcontrol', m.virtues.selfcontrol)}
      ${_v20DotRow('Смелость', 'virtues.courage', m.virtues.courage)}</div>`;
  const advantages = `
    <div class="v20-band">Преимущества</div>
    <div class="v20-grid3">${isVamp ? discCol : ''}${bgCol}${virtCol}</div>`;

  // Психические способности — мортал-зеркало дисциплин (см. discCol выше): «Нумина / Грани»
  // листа смертного (Шаг 8, character_sheet_mortal.md) для экстрасенсов/практиков худо-магии;
  // у обычного смертного секция рендерится с пустыми/нулевыми строками, как и Дисциплины:0
  // у вампира без выбранного клана. Только для мортал-линейки — вампиры/ченджлинги её не видят.
  const isMortal = (m.lineage || '') === 'mortals';
  const psyLibBtn = `<button type="button" class="v20-mini-action v20-lib-add-btn" data-v20-lib-kind="numina" title="Добавить из справочника психических способностей">+ Из справочника</button>`;
  const psyRow = (p, i) => {
    const known = !!v20PsychicKey(p.name);
    const infoBtn = known ? `<button type="button" class="v20-disc-info-btn" data-psy-view="${escAttr(p.name)}" title="Силы по уровням: ${escAttr(p.name)}">ℹ</button>` : '';
    const rm = i >= _V20_BASELINE_LEN.psychicPowers ? `<button type="button" class="v20-row-remove-btn" data-v20-remove="psychicPowers" data-v20-remove-idx="${i}" title="Удалить строку">×</button>` : '';
    return `<div class="v20-row v20-named v20-disc-row">${rm}${infoBtn}<input class="v20-line-input" data-tpath="psychicPowers.${i}.name" value="${escAttr(p.name)}" placeholder="…">${_v20DotsHtml(`psychicPowers.${i}.val`, p.val, 5)}</div>`;
  };
  const psychics = isMortal ? `
    <div class="v20-band">Психические способности</div>
    <div class="v20-grid3">
      <div class="v20-col">
        <div class="v20-col-title">Нумина / Грани${psyLibBtn}${_v20AddRowBtn('psychicPowers')}</div>
        <div class="v20-lib-picker" data-v20-lib-kind="numina" hidden>
          <input type="text" class="v20-lib-search" placeholder="Поиск…" data-v20-lib-kind="numina">
          <div class="v20-lib-list" data-v20-lib-kind="numina"></div>
        </div>
        ${m.psychicPowers.map(psyRow).join('')}
      </div>
      <div class="v20-col"></div>
      <div class="v20-col"></div>
    </div>` : '';

  const healthRows = V20_HEALTH.map(([k, ru, pen]) =>
    `<label class="v20-health-row"><input type="checkbox" class="v20-box" data-bpath="health.${k}"${m.health[k] ? ' checked' : ''}><span class="v20-health-name">${escHtml(ru)}</span><span class="v20-health-pen">${escHtml(pen)}</span></label>`).join('');

  const mfLibBtn = `<button type="button" class="v20-mini-action v20-lib-add-btn" data-v20-lib-kind="meritflaw" title="Добавить из справочника достоинств/недостатков">+ Из справочника</button>`;
  const mfRows = m.meritsFlaws.map((mf, i) => {
    const rm = `<button type="button" class="v20-row-remove-btn" data-v20-remove="meritsFlaws" data-v20-remove-idx="${i}" title="Удалить строку">×</button>`;
    return `<div class="v20-row v20-named v20-mf-row">${rm}
      <input class="v20-line-input" data-tpath="meritsFlaws.${i}.name" value="${escAttr(mf.name)}" placeholder="Название">
      <select class="v20-mf-kind" data-tpath="meritsFlaws.${i}.kind">
        <option value="merit"${mf.kind !== 'flaw' ? ' selected' : ''}>Достоинство</option>
        <option value="flaw"${mf.kind === 'flaw' ? ' selected' : ''}>Недостаток</option>
      </select>
      <input type="number" min="0" class="v20-mini-input" data-tpath="meritsFlaws.${i}.points" value="${escAttr(mf.points)}">
    </div>`;
  }).join('');

  const bottom = `
    <div class="v20-band">Преимущества и состояние</div>
    <div class="v20-grid3 v20-bottom">
      <div class="v20-col">
        <div class="v20-col-title">Достоинства и недостатки${mfLibBtn}${_v20AddRowBtn('meritsFlaws')}</div>
        <div class="v20-lib-picker" data-v20-lib-kind="meritflaw" hidden>
          <input type="text" class="v20-lib-search" placeholder="Поиск…" data-v20-lib-kind="meritflaw">
          <div class="v20-lib-list" data-v20-lib-kind="meritflaw"></div>
        </div>
        ${mfRows}
        <div class="v20-col-title" style="margin-top:12px">Изъян${clanInfo && clanInfo.weakness ? `<button type="button" class="v20-mini-action" data-v20-action="insert-clan-weakness">+ слабость клана</button>` : ''}</div>
        <input class="v20-field-input" data-tpath="flaw" value="${escAttr(m.flaw)}">
      </div>
      <div class="v20-col">
        <div class="v20-stat-block">
          <div class="v20-stat-title">Человечность / Путь ${_v20AutoBadge(m.humanity, derived.humanity, 'humanity', 'dot')}</div>
          ${_v20DotsHtml('humanity', m.humanity, 10)}
          <input class="v20-line-input v20-path" data-tpath="path" value="${escAttr(m.path)}" placeholder="Столп (Путь)">
        </div>
        <div class="v20-stat-block">
          <div class="v20-stat-title">Воля ${_v20AutoBadge(m.willpower.permanent, derived.willpower, 'willpower.permanent', 'dot')}<button type="button" class="v20-mini-action" data-v20-action="spend-willpower" title="Потратить 1 пункт временной Воли">−1</button></div>
          ${_v20DotsHtml('willpower.permanent', m.willpower.permanent, 10)}
          ${_v20BoxesHtml('willpower.temp', m.willpower.temp)}
        </div>
        ${isVamp ? `<div class="v20-stat-block">
          <div class="v20-stat-title">Запас крови${derived.gen ? `<span class="v20-gen-info" title="Поколение ${escAttr(m.header.generation)}: max ${derived.gen.bloodMax ?? '— (счётчик)'}, предел/ход ${derived.gen.bloodPerTurn ?? '—'}, max точек (атрибуты/способности/дисциплины/факты биографии) ${derived.gen.maxDots}">ⓘ</span>` : ''}<button type="button" class="v20-mini-action" data-v20-action="spend-blood" title="Потратить 1 пункт крови">−1</button></div>
          ${derived.gen && derived.gen.bloodMax == null
            ? `<input type="number" min="0" class="v20-mini-input v20-blood-counter" data-tpath="bloodPoolCount" value="${escAttr(m.bloodPoolCount)}" title="3-е поколение — запас крови без фиксированного потолка">`
            : _v20BoxesHtml('bloodPool', m.bloodPool)}
          <label class="v20-inline-field">Предел траты в ход ${derived.gen && derived.gen.bloodPerTurn != null ? _v20AutoBadge(m.bloodPerTurn, derived.gen.bloodPerTurn, 'bloodPerTurn', 'text') : ''}<input class="v20-mini-input" data-tpath="bloodPerTurn" value="${escAttr(m.bloodPerTurn)}"></label>
        </div>` : ''}
      </div>
      <div class="v20-col">
        <div class="v20-col-title">Здоровье</div>
        <div class="v20-health">${healthRows}</div>
        <div class="v20-stat-block" style="margin-top:12px">
          <div class="v20-stat-title">Опыт</div>
          <label class="v20-inline-field">Всего <input class="v20-mini-input" data-tpath="experience.total" data-exp value="${escAttr(m.experience.total)}"></label>
          <label class="v20-inline-field">Потрачено <input class="v20-mini-input" data-tpath="experience.spent" data-exp value="${escAttr(m.experience.spent)}"></label>
          <label class="v20-inline-field">Остаток <span class="v20-exp-remain" id="v20-exp-remain">${_num(m.experience.total, 0) - _num(m.experience.spent, 0)}</span></label>
        </div>
        ${m.experience.log?.length ? `<div class="v20-xp-log">
          <div class="v20-xp-log-title">История трат</div>
          ${m.experience.log.slice(0, 8).map(le => `<div class="v20-xp-log-row"><span>${escHtml(le.date)} · ${escHtml(le.text)}</span><span>−${le.cost}</span></div>`).join('')}
        </div>` : ''}
      </div>
    </div>`;

  const specRows = m.specializations.map((s, i) =>
    `<div class="v20-pair-row"><input class="v20-line-input" data-tpath="specializations.${i}.ability" value="${escAttr(s.ability)}" placeholder="способность"><input class="v20-line-input" data-tpath="specializations.${i}.spec" value="${escAttr(s.spec)}" placeholder="специализация"></div>`).join('');
  const otRows = m.otherTraits.map((t, i) => _v20NamedDotRow(`otherTraits.${i}.name`, t.name, `otherTraits.${i}.val`, t.val, genMaxDots, i >= _V20_BASELINE_LEN.otherTraits ? 'otherTraits' : '')).join('');
  const ritRows = m.rituals.map((r, i) => {
    const rm = i >= _V20_BASELINE_LEN.rituals ? `<button type="button" class="v20-row-remove-btn" data-v20-remove="rituals" data-v20-remove-idx="${i}" title="Удалить строку">×</button>` : '';
    return `<div class="v20-pair-row">${rm}<input class="v20-line-input" data-tpath="rituals.${i}.name" value="${escAttr(r.name)}" placeholder="ритуал"><input class="v20-line-input v20-ritual-lvl" data-tpath="rituals.${i}.level" value="${escAttr(r.level)}" placeholder="ур."></div>`;
  }).join('');
  const V20_DESC = [['birthDate', 'Дата рождения'], ['apparentAge', 'Видимый возраст'], ['deathDate', 'Дата смерти'], ['gender', 'Пол'], ['race', 'Раса'], ['hair', 'Волосы'], ['eyes', 'Глаза'], ['heightWeight', 'Рост/Вес'], ['build', 'Телосложение'], ['nationality', 'Национальность']];
  // Видимый возраст = Год обращения − Год рождения (карточка, web/lib/parsers.js: c.birthYear/
  // c.embraceYear) — «замер на моменте Объятия» (character_sheet_v20.md, «Ограничения»). Если
  // поле листа пустое/0 (т.е. ИИ/пользователь его не задавал), предзаполняем расчётом, но
  // оставляем редактируемым — Рассказчик может переопределить по нестандартным лоровым причинам.
  // Деградация: при отсутствии/нечисловых годах (напр. «⚠️ Не указан») — обычный текстовый ввод.
  const apparentAgeComputed = _v20ComputeApparentAge(_v20Ctx?.card);
  if (apparentAgeComputed != null && !String(m.description.apparentAge || '').trim()) m.description.apparentAge = String(apparentAgeComputed);
  const descFields = V20_DESC.map(([k, l]) => {
    if (k !== 'apparentAge' || apparentAgeComputed == null) return _v20Field(l, `description.${k}`, m.description[k]);
    const isComputed = String(m.description[k] || '').trim() === String(apparentAgeComputed);
    const badge = _v20AutoBadge(m.description[k], apparentAgeComputed, 'description.apparentAge', 'text');
    return `<label class="v20-field"><span class="v20-field-lbl">${escHtml(l)}${badge}</span><input class="v20-field-input" data-tpath="description.${k}" value="${escAttr(m.description[k] || '')}" title="${isComputed ? 'Рассчитано: Год обращения − Год рождения' : ''}"></label>`;
  }).join('');
  const V20_COMBAT_COLS = ['weapon', 'diff', 'damage', 'range', 'rate', 'clip', 'size'];
  const combatHead = `<div class="v20-combat-row v20-combat-head"><span>Оружие/атака</span><span>Сложн.</span><span>Урон</span><span>Дальн.</span><span>Скор.</span><span>Магазин</span><span>Размер</span></div>`;
  const combatRows = m.combat.map((c, i) =>
    `<div class="v20-combat-row">${V20_COMBAT_COLS.map(k => `<input class="v20-line-input" data-tpath="combat.${i}.${k}" value="${escAttr(c[k])}">`).join('')}</div>`).join('');

  const page2 = `
    <div class="v20-band">Специализации · параметры${(isVamp || isMortal) ? ' · ритуалы' : ''}</div>
    <div class="v20-grid3">
      <div class="v20-col"><div class="v20-col-title">Специализации</div>${specRows}</div>
      <div class="v20-col"><div class="v20-col-title">Другие параметры${_v20AddRowBtn('otherTraits')}</div>${otRows}</div>
      ${(isVamp || isMortal) ? `<div class="v20-col"><div class="v20-col-title">Ритуалы${_v20AddRowBtn('rituals')}</div>${ritRows}</div>` : '<div class="v20-col"></div>'}
    </div>
    <div class="v20-band">История и описание</div>
    <div class="v20-grid3">
      <div class="v20-col">
        <div class="v20-col-title">История</div>
        <textarea class="v20-textarea" data-tpath="history" rows="5" placeholder="История персонажа…">${escHtml(m.history)}</textarea>
        <div class="v20-col-title" style="margin-top:12px">Цели</div>
        <textarea class="v20-textarea" data-tpath="goals" rows="3" placeholder="Цели…">${escHtml(m.goals)}</textarea>
      </div>
      <div class="v20-col">
        <div class="v20-col-title">Описание</div>
        <div class="v20-desc-fields">${descFields}</div>
      </div>
      <div class="v20-col">
        <div class="v20-col-title">Союзники и контакты</div>
        <textarea class="v20-textarea" data-tpath="allies" rows="4" placeholder="По строке на пункт…">${escHtml(m.allies)}</textarea>
        <div class="v20-col-title" style="margin-top:12px">Имущество и снаряжение</div>
        <textarea class="v20-textarea" data-tpath="possessions" rows="4" placeholder="По строке на пункт…">${escHtml(m.possessions)}</textarea>
      </div>
    </div>
    <div class="v20-band">Боевые столкновения</div>
    <div class="v20-combat">${combatHead}${combatRows}</div>`;

  panel.innerHTML = `
    <div class="cdet-sheet-toolbar">
      <button class="cdet-sheet-btn primary" id="v20-save" disabled>💾 Сохранено</button>
      <button class="cdet-sheet-btn" id="v20-regen">♻ Перегенерировать ИИ</button>
      <button class="cdet-sheet-btn" id="v20-validate">📋 Проверить лист</button>
      <button class="cdet-sheet-btn${_v20XpMode ? ' active' : ''}" id="v20-xpmode" title="В этом режиме поднятие точки списывает опыт по таблице обучения">🎓 Режим опыта${_v20XpMode ? ': вкл' : ''}</button>
      <button class="cdet-sheet-btn" id="v20-roll-btn" title="Открыть конструктор броска d10">🎲 Бросок</button>
      ${(isVamp || isMortal) ? `
      <button class="cdet-sheet-btn" id="v20-foundry-export" title="Скачать JSON для импорта в Foundry VTT (Import Data)">🜏 Экспорт в Foundry</button>
      <button class="cdet-sheet-btn" id="v20-foundry-import" title="Загрузить JSON, полученный через Export Data в Foundry VTT">📥 Импорт из Foundry</button>` : ''}
      <span class="v20-status" id="v20-status"></span>
    </div>
    <div class="v20-val-report" id="v20-validate-report"></div>
    <div class="v20-sheet">${header}${attributes}${abilities}${advantages}${psychics}${bottom}${page2}</div>
    <div class="v20-foot">Создание: Характеристики 7/5/3 · Способности 13/9/5 · Дисциплины 3 · Факты биографии 5 · Добродетели 7 · Свободные пункты 15</div>`;

  document.getElementById('v20-save').addEventListener('click', _v20Save);
  document.getElementById('v20-roll-btn').addEventListener('click', () => _v20OpenRollModal());
  document.getElementById('v20-regen').addEventListener('click', e => _v20Regen(e.currentTarget));
  document.getElementById('v20-validate').addEventListener('click', _v20ToggleValidation);
  document.getElementById('v20-xpmode').addEventListener('click', () => { _v20XpMode = !_v20XpMode; _v20RenderSheet(panel, charName); });
  document.getElementById('v20-foundry-export')?.addEventListener('click', _v20ExportFoundry);
  document.getElementById('v20-foundry-import')?.addEventListener('click', () => document.getElementById('import-foundry-file')?.click());
  _v20BindPanel(panel);
}

function _v20RebuildDots(span, val) {
  const max = +span.dataset.max || 5;
  span.querySelectorAll('.v20-dot').forEach(dot => {
    const d = +dot.dataset.d;
    dot.classList.toggle('on', d <= val);
    dot.setAttribute('aria-checked', d === val);
  });
  const num = span.querySelector('.v20-dot-num');
  if (num) num.textContent = val;
}

function _v20BindPanel(panel) {
  if (panel._v20Bound) return;
  panel._v20Bound = true;
  const onDot = async dot => {
    const span = dot.closest('.v20-dots'); if (!span) return;
    const dpath = span.dataset.dpath, d = +dot.dataset.d;
    const cur = _v20Get(_v20Model, dpath) || 0;
    const cap = _v20DotCapFor(dpath, _v20Model);
    const nv = Math.min(cap, (cur === d) ? d - 1 : d);     // click filled max → step down; else set to d (clamped to generation/trait cap)
    if (_v20XpMode && nv > cur) {
      const info = _v20XpKindFromPath(dpath, _v20Model);
      if (info) {
        const cost = v20XpCost(info.kind, cur, nv, info.isClanDisc);
        const avail = _num(_v20Model.experience.total, 0) - _num(_v20Model.experience.spent, 0);
        if (cost > avail && !await showConfirm(`«${info.label}»: ${cur}→${nv} стоит ${cost} XP, доступно ${avail}. Всё равно повысить?`, { confirmText: 'Повысить' })) return;
        _v20Model.experience.spent = _num(_v20Model.experience.spent, 0) + cost;
        _v20Model.experience.log.unshift({ date: new Date().toISOString().slice(0, 10), text: `${info.label}: ${cur}→${nv}`, cost });
        _v20Set(_v20Model, dpath, nv);
        _v20MarkDirty();
        _v20RenderSheet(panel, _v20Ctx.name);
        return;
      }
    }
    _v20Set(_v20Model, dpath, nv);
    _v20RebuildDots(span, nv);
    _v20MarkDirty();
  };
  panel.addEventListener('click', e => {
    const dot = e.target.closest('.v20-dot'); if (dot) { onDot(dot); return; }
    const badge = e.target.closest('.v20-auto-badge'); if (badge) { _v20ApplyAutoBadge(badge); return; }
    const action = e.target.closest('[data-v20-action]'); if (action) { _v20RunAction(action.dataset.v20Action); return; }
    const discView = e.target.closest('[data-disc-view]'); if (discView) { _v20OpenDisciplineModal(discView.dataset.discView); return; }
    const psyView = e.target.closest('[data-psy-view]'); if (psyView) { _v20OpenPsychicModal(psyView.dataset.psyView); return; }
    const rollBtn = e.target.closest('.v20-roll-icon-btn'); if (rollBtn) {
      const [kind, path] = rollBtn.dataset.rollSeed.split(':');
      _v20OpenRollModal(kind === 'attr' ? { attr: path } : { abil: path });
      return;
    }
    const addBtn = e.target.closest('[data-v20-add]'); if (addBtn) {
      const [section, group] = addBtn.dataset.v20Add.split(':');
      _v20AddRow(section, group || null);
      return;
    }
    const rmBtn = e.target.closest('[data-v20-remove]'); if (rmBtn) {
      const [section, group] = rmBtn.dataset.v20Remove.split(':');
      _v20RemoveRow(section, group || null, +rmBtn.dataset.v20RemoveIdx);
      return;
    }
    const libAddBtn = e.target.closest('.v20-lib-add-btn'); if (libAddBtn) {
      const kind = libAddBtn.dataset.v20LibKind;
      if (kind) _v20ToggleLibPicker(kind);
      return;
    }
    const libItem = e.target.closest('.v20-lib-item'); if (libItem) {
      const kind = libItem.dataset.v20LibKind;
      const name = libItem.dataset.v20LibItem;
      if (kind && name) {
        _v20AddLibraryItem(kind, name);
        // Close the picker after selection
        const panel = e.target.closest('#cdet-sheet-panel') || document.getElementById('cdet-sheet-panel');
        if (panel) {
          const picker = panel.querySelector(`.v20-lib-picker[data-v20-lib-kind="${kind}"]`);
          if (picker) picker.hidden = true;
        }
      }
      return;
    }
  });
  panel.addEventListener('input', e => {
    const search = e.target.closest('.v20-lib-search');
    if (search) {
      const kind = search.dataset.v20LibKind;
      const query = search.value.toLowerCase();
      const picker = search.closest('.v20-lib-picker');
      if (picker && kind) {
        (async () => {
          const lib = await _v20LoadLibrary(kind);
          const filtered = query ? lib.filter(item => (item.name || item.ru || '').toLowerCase().includes(query)) : lib;
          _v20RenderV20LibList(kind, filtered, picker);
        })();
      }
      return;
    }
  });
  panel.addEventListener('keydown', e => {
    const dot = e.target.closest('.v20-dot');
    if (dot && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onDot(dot); }
  });
  panel.addEventListener('change', e => {
    const box = e.target.closest('.v20-box');
    if (box) {
      const bp = box.dataset.bpath;
      if (box.dataset.i !== undefined) { const arr = _v20Get(_v20Model, bp) || []; arr[+box.dataset.i] = box.checked; _v20Set(_v20Model, bp, arr); }
      else _v20Set(_v20Model, bp, box.checked);
      _v20MarkDirty();
      return;
    }
    const t = e.target.closest('[data-tpath="header.clan"], [data-tpath="header.generation"]');
    if (t) {
      if (t.dataset.tpath === 'header.generation') _v20ClampToGen(_v20Model);   // generation dropped → re-cap traits already above the new ceiling
      _v20RenderSheet(panel, _v20Ctx.name);  // refresh clan/gen-derived badges & actions
    }
  });
  panel.addEventListener('input', e => {
    const t = e.target.closest('[data-tpath]'); if (!t) return;
    _v20Set(_v20Model, t.dataset.tpath, t.value);
    if (t.dataset.exp !== undefined) {
      const el = document.getElementById('v20-exp-remain');
      if (el) el.textContent = _num(_v20Model.experience.total, 0) - _num(_v20Model.experience.spent, 0);
    }
    _v20MarkDirty();
  });
}

function _v20MarkDirty() {
  _v20DirtyFlag = true;
  const btn = document.getElementById('v20-save');
  const st = document.getElementById('v20-status');
  if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
  if (st) { st.textContent = '● Не сохранено'; st.className = 'v20-status dirty'; }
}

async function _v20Save() {
  const btn = document.getElementById('v20-save'), st = document.getElementById('v20-status');
  btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Сохранение…';
  // Coerce numeric text fields before persisting
  _v20Model.experience.total = _num(_v20Model.experience.total, 0);
  _v20Model.experience.spent = _num(_v20Model.experience.spent, 0);
  _v20Model.bloodPerTurn = _num(_v20Model.bloodPerTurn, 0);
  _v20Model.bloodPoolCount = _num(_v20Model.bloodPoolCount, 0);
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(_v20Ctx.name))}/sheet-data${location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: _v20Model }) }
    ).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'не удалось');
    _v20DirtyFlag = false;
    btn.textContent = '💾 Сохранено'; btn.disabled = true;
    if (st) { st.textContent = '✓ Сохранено'; st.className = 'v20-status ok'; }
  } catch (e) {
    btn.disabled = false; btn.textContent = old;
    if (st) { st.textContent = '✗ ' + e.message; st.className = 'v20-status err'; }
  }
}

function _v20ExportFoundry() {
  const slug = _charSlug(_v20Ctx.name);
  window.location.href = `/api/characters/${encodeURIComponent(slug)}/export-foundry${location.search}`;
}

async function _v20ImportFoundryFile(file) {
  if (!file) return;
  let actor;
  try {
    actor = JSON.parse(await file.text());
  } catch (e) {
    showToast('Не удалось прочитать JSON-файл: ' + e.message, 'error');
    return;
  }
  const slug = _charSlug(_v20Ctx.name);
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(slug)}/import-foundry${location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor }),
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'не удалось');
    showToast('Импортировано из Foundry. Обновляю лист…', 'success');
    const d = await fetch(`/api/characters/${slug}/sheet-data${location.search}`).then(r => r.json());
    _v20Model = _v20ModelFrom(d);
    _v20DirtyFlag = false;
    _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
    if (r.cardFields && (r.cardFields.clan || r.cardFields.sect || r.cardFields.generation || r.cardFields.sire)) {
      showToast(`Предложены поля карточки — клан «${r.cardFields.clan || '—'}», секта «${r.cardFields.sect || '—'}», поколение «${r.cardFields.generation || '—'}». Примените их вручную во вкладке «Инфо», если нужно.`, 'info', 8000);
    }
  } catch (e) {
    showToast('Ошибка импорта: ' + e.message, 'error');
  }
}

document.getElementById('import-foundry-file')?.addEventListener('change', async e => {
  await _v20ImportFoundryFile(e.target.files[0]);
  e.target.value = '';
});

async function _v20Regen(btn) {
  if (_v20DirtyFlag && !await showConfirm('Есть несохранённые правки. Перегенерировать числа из ИИ-листа и потерять их?', { danger: true, confirmText: 'Перегенерировать' })) return;
  else if (!_v20DirtyFlag && !await showConfirm('Перегенерировать числа из ИИ-листа? Текущие значения формы будут заменены.', { confirmText: 'Перегенерировать' })) return;
  const old = btn.textContent; btn.disabled = true; btn.textContent = '⏳ ИИ…';
  try {
    const ok = await _generateSheet({ scope: 'character', name: _v20Ctx.name }, null);
    if (!ok) throw new Error('генерация не удалась');
    const q = location.search ? location.search + '&fromMd=1' : '?fromMd=1';
    const d = await fetch(`/api/characters/${encodeURIComponent(_charSlug(_v20Ctx.name))}/sheet-data${q}`).then(r => r.json());
    _v20Model = _v20ModelFrom(d);
    _v20DirtyFlag = false;
    _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = old;
  }
}

let _v20Model = null, _v20Ctx = null, _v20DirtyFlag = false;
let _v20LibraryCache = { discipline: null, numina: null, meritflaw: null, background: null };
async function _loadCharSheet(charName) {
  const panel = document.getElementById('cdet-sheet-panel');
  if (!panel) return;
  panel.dataset.loaded = '1';
  panel.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка листа…</div>';
  // Card-level birthYear/embraceYear (already parsed by parseCharacter, см. web/lib/parsers.js)
  // — used to auto-fill description.apparentAge = embraceYear − birthYear (Шаг: апп. возраст).
  const card = (STATE.characters || []).find(ch => ch.name === charName) || null;
  _v20Ctx = { name: charName, card }; _v20DirtyFlag = false; _v20XpMode = false;
  let d;
  try {
    // Prefetch in parallel (cached after first call) so the ℹ-lookup buttons in psyRow/discRow
    // already know which rows match the library on the very first render, not only after the
    // user opens the 📚 reference modal once.
    [d] = await Promise.all([
      fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/sheet-data${location.search}`).then(r => r.json()),
      ensurePsychics(),
    ]);
  }
  catch (e) { panel.innerHTML = `<div class="cdet-empty">Ошибка загрузки: ${escHtml(e.message)}</div>`; return; }
  _v20Model = _v20ModelFrom(d);
  _v20RenderSheet(panel, charName);
}

// ═══════════════════ V20 sheet: generate · view · edit (dot-radio) ═══════════════════

function _sheetApi(ctx) {
  const qs = location.search;
  if (ctx.scope === 'module') {
    const base = `/api/chronicles/${encodeURIComponent(ctx.chr)}/modules/${encodeURIComponent(ctx.mod)}/npc/${encodeURIComponent(ctx.slug)}/sheet`;
    return { get: base + qs, gen: base + '/generate' + qs, put: base + qs };
  }
  const base = `/api/characters/${encodeURIComponent(_charSlug(ctx.name))}/sheet`;
  return { get: base + qs, gen: base + '/generate' + qs, put: base + qs };
}

const _SHEET_EDIT_SECTIONS = /атрибут|способност|преимуществ|дисциплин|предыстор|добродетел|нумина|(?<!производные )характеристик/i;
function _sheetDots(v) { v = Math.max(0, Math.min(5, v | 0)); return '●'.repeat(v) + '○'.repeat(5 - v); }

// Find which cells of a table row carry a 0–5 rating (dots / number / combined).
function _parseRatingCells(cells) {
  let dotsIdx = -1, numIdx = -1, combinedIdx = -1, value = null, m;
  for (let j = 1; j < cells.length; j++) {
    const c = cells[j];
    if (/^[●○]+$/.test(c)) { dotsIdx = j; value = (c.match(/●/g) || []).length; }
    else if ((m = c.match(/^([●○]+)\s*(\d+)$/))) { combinedIdx = j; value = parseInt(m[2], 10); }
    else if (/^\d+$/.test(c)) { const n = parseInt(c, 10); if (n >= 0 && n <= 5) { numIdx = j; value = n; } }
  }
  if (value == null || value < 0 || value > 5) return null;
  return { value, dotsIdx, numIdx, combinedIdx };
}

// Parse a sheet markdown into editable rated rows (preserving line indices for rebuild).
function _parseSheetForEdit(md) {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const groups = [], editable = [];
  let curSection = '', curSub = '', curGroup = null, m;
  const flush = () => {
    if (curGroup && curGroup.rows.length) {
      curGroup.firstLineIdx = curGroup.rows[0].lineIdx;
      curGroup.lastLineIdx = curGroup.rows[curGroup.rows.length - 1].lineIdx;
      groups.push(curGroup);
    }
    curGroup = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if ((m = ln.match(/^##\s+(.+)$/)))  { flush(); curSection = m[1].replace(/[#*]/g, '').trim(); curSub = ''; continue; }
    if ((m = ln.match(/^###\s+(.+)$/))) { flush(); curSub     = m[1].replace(/[#*]/g, '').trim(); continue; }
    if (!(_SHEET_EDIT_SECTIONS.test(curSection) || _SHEET_EDIT_SECTIONS.test(curSub))) continue;
    if (!/^\s*\|/.test(ln) || /\|\s*:?-{3,}/.test(ln)) continue;     // not a data row / separator
    const cells = ln.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const name = cells[0].replace(/\*\*/g, '').trim();
    // Skip table header rows (\b is unreliable for Cyrillic, so match stems anchored at start)
    if (!name || /^(название|поле|характеристик|атрибут|способност|дисциплин|предыстор|добродетел|уровень|значение)/i.test(name)) continue;
    const rating = _parseRatingCells(cells);
    if (!rating) continue;
    if (!curGroup) curGroup = { section: curSection, subsection: curSub, rows: [] };
    const row = { name, value: rating.value, lineIdx: i, cells, rating };
    curGroup.rows.push(row); editable.push(row);
  }
  flush();
  return { lines, groups, editable };
}

function _rebuildSheetRow(cells, rating, v) {
  const out = cells.slice();
  if (rating.combinedIdx >= 0) out[rating.combinedIdx] = _sheetDots(v) + ' ' + v;
  if (rating.dotsIdx >= 0)     out[rating.dotsIdx]     = _sheetDots(v);
  if (rating.numIdx >= 0)      out[rating.numIdx]      = String(v);
  return '| ' + out.join(' | ') + ' |';
}
// New row added from a library picker — same 3-column shape (name / dots / value)
// as every existing Дисциплины/Нумина table row, so _rebuildSheetRow renders it
// identically to a parsed one. lineIdx stays null: it doesn't exist in the
// original file yet, _buildEditedSheet below splices it in by group range.
function _makeNewSheetRow(name) {
  return { name, value: 1, lineIdx: null, cells: [name, '', ''], rating: { value: 1, dotsIdx: 1, numIdx: 2, combinedIdx: -1 } };
}
function _buildEditedSheet(parsed) {
  const lines = parsed.lines.slice();
  // Rebuild each group's row range from its current (possibly add/removed-from)
  // rows list. Processing bottom-of-file-first keeps not-yet-processed groups'
  // firstLineIdx/lastLineIdx (captured at parse time, before any edits) valid —
  // a splice only ever shifts line numbers *below* itself.
  const ordered = parsed.groups.slice().sort((a, b) => b.firstLineIdx - a.firstLineIdx);
  for (const g of ordered) {
    const rowLines = g.rows.map(r => _rebuildSheetRow(r.cells, r.rating, r.value));
    lines.splice(g.firstLineIdx, g.lastLineIdx - g.firstLineIdx + 1, ...rowLines);
  }
  return lines.join('\n');
}

// Which library (if any) backs this group's "+ Добавить" picker.
function _sheetLibraryKind(g) {
  const t = `${g.section} ${g.subsection}`;
  if (/дисциплин/i.test(t)) return 'discipline';
  if (/нумина/i.test(t)) return 'numina';
  return null;
}
function _libraryEntryDesc(kind, entry) {
  return kind === 'discipline' ? (entry.note || entry.clans || '') : (entry.category || '');
}
// Loads (once per modal open) only the library kinds actually present among
// the sheet's editable groups — a mortal sheet never fetches disciplines,
// a vampire sheet never fetches psychics.
async function _prefetchSheetLibraries(state) {
  const kinds = new Set();
  for (const g of state.parsed.groups) { const k = _sheetLibraryKind(g); if (k) kinds.add(k); }
  await Promise.all([...kinds].map(async k => {
    const url = k === 'discipline' ? '/api/library/disciplines' : '/api/library/psychics';
    try { state.library[k] = await fetch(url).then(r => r.json()); }
    catch { state.library[k] = []; }
  }));
}
function _renderLibList(state, groupIdx, filter) {
  const g = state.parsed.groups[groupIdx];
  const kind = _sheetLibraryKind(g);
  const list = state.library[kind] || [];
  const q = (filter || '').trim().toLowerCase();
  const filtered = q ? list.filter(e => e.name.toLowerCase().includes(q)) : list;
  if (!filtered.length) return '<div class="sheet-lib-empty">Ничего не найдено</div>';
  return filtered.map(e => `<button type="button" class="sheet-lib-item" data-group-idx="${groupIdx}" data-name="${escHtml(e.name)}">
    <span class="sheet-lib-item-name">${escHtml(e.name)}</span>
    <span class="sheet-lib-item-desc">${escHtml(_libraryEntryDesc(kind, e))}</span>
  </button>`).join('');
}

function _dotControl(idx, v) {
  let s = `<span class="sheet-dots" data-row="${idx}">`;
  for (let d = 1; d <= 5; d++) s += `<span class="sheet-dot${d <= v ? ' on' : ''}" data-row="${idx}" data-val="${d}"></span>`;
  return s + `<span class="sheet-dot-val">${v}</span></span>`;
}
function _renderSheetEditor(state) {
  const parsed = state.parsed;
  if (!parsed.editable.length) return '<div class="cdet-empty">В листе не найдено редактируемых характеристик.</div>';
  return parsed.groups.map((g, gi) => {
    const title = [g.section, g.subsection].filter(Boolean).join(' · ');
    const rows = g.rows.map(r => {
      const idx = parsed.editable.indexOf(r);
      return `<div class="sheet-edit-row">
        <span class="sheet-edit-name">${escHtml(r.name)}</span>
        ${_dotControl(idx, r.value)}
        <button type="button" class="sheet-row-remove" data-row="${idx}" title="Удалить строку">✕</button>
      </div>`;
    }).join('');
    const kind = _sheetLibraryKind(g);
    const addUi = (kind && state.library[kind]) ? `
      <button type="button" class="sheet-add-btn" data-group-idx="${gi}">+ Добавить из справочника</button>
      <div class="sheet-lib-picker" data-group-idx="${gi}" hidden>
        <input type="text" class="sheet-lib-search" data-group-idx="${gi}" placeholder="Поиск…">
        <div class="sheet-lib-list" data-group-idx="${gi}"></div>
      </div>` : '';
    return `<div class="sheet-edit-group"><div class="sheet-edit-gtitle">${escHtml(title)}</div>${rows}${addUi}</div>`;
  }).join('');
}
function _rerenderSheetEditor() {
  const body = document.getElementById('sheet-modal-body');
  if (body && _sheetEditState) body.innerHTML = `<div class="sheet-edit">${_renderSheetEditor(_sheetEditState)}</div>`;
}

let _sheetEditState = null;
function _ensureSheetOverlay() {
  let ov = document.getElementById('sheet-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'sheet-overlay'; ov.className = 'sheet-overlay';
  ov.innerHTML = `<div class="sheet-modal">
    <div class="sheet-modal-head">
      <span class="sheet-modal-title" id="sheet-modal-title">Лист персонажа</span>
      <div class="sheet-modal-actions" id="sheet-modal-actions"></div>
      <button class="sheet-modal-close" id="sheet-modal-close" title="Закрыть">✕</button>
    </div>
    <div class="sheet-modal-body" id="sheet-modal-body"></div>
    <div class="sheet-modal-status" id="sheet-modal-status"></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) _closeSheetOverlay(); });
  ov.querySelector('#sheet-modal-close').addEventListener('click', _closeSheetOverlay);
  ov.querySelector('#sheet-modal-body').addEventListener('click', e => {
    const dot = e.target.closest('.sheet-dot');
    if (dot) { _onSheetDotClick(dot); return; }
    const addBtn = e.target.closest('.sheet-add-btn');
    if (addBtn) { _onSheetAddBtnClick(addBtn); return; }
    const item = e.target.closest('.sheet-lib-item');
    if (item) { _onSheetLibItemClick(item); return; }
    const rm = e.target.closest('.sheet-row-remove');
    if (rm) { _onSheetRowRemoveClick(rm); return; }
  });
  ov.querySelector('#sheet-modal-body').addEventListener('input', e => {
    const search = e.target.closest('.sheet-lib-search');
    if (search) _onSheetLibSearchInput(search);
  });
  return ov;
}
function _closeSheetOverlay() { const ov = document.getElementById('sheet-overlay'); if (ov) ov.classList.remove('open'); _sheetEditState = null; }
function _onSheetDotClick(dotEl) {
  if (!_sheetEditState) return;
  const idx = +dotEl.dataset.row, dv = +dotEl.dataset.val;
  const r = _sheetEditState.parsed.editable[idx]; if (!r) return;
  r.value = (r.value === dv) ? dv - 1 : dv;                 // click active dot → step down (allows 0)
  const cont = dotEl.closest('.sheet-dots');
  cont.querySelectorAll('.sheet-dot').forEach(el => el.classList.toggle('on', +el.dataset.val <= r.value));
  cont.querySelector('.sheet-dot-val').textContent = r.value;
}
function _onSheetAddBtnClick(btn) {
  const picker = btn.parentElement.querySelector('.sheet-lib-picker');
  if (!picker) return;
  const opening = picker.hidden;
  picker.hidden = !opening;
  if (opening) {
    const gi = +btn.dataset.groupIdx;
    picker.querySelector('.sheet-lib-list').innerHTML = _renderLibList(_sheetEditState, gi, '');
    const search = picker.querySelector('.sheet-lib-search');
    search.value = '';
    search.focus();
  }
}
function _onSheetLibSearchInput(input) {
  const gi = +input.dataset.groupIdx;
  const list = input.closest('.sheet-lib-picker').querySelector('.sheet-lib-list');
  list.innerHTML = _renderLibList(_sheetEditState, gi, input.value);
}
function _onSheetLibItemClick(item) {
  const gi = +item.dataset.groupIdx;
  const g = _sheetEditState.parsed.groups[gi];
  const row = _makeNewSheetRow(item.dataset.name);
  g.rows.push(row);
  _sheetEditState.parsed.editable.push(row);
  _rerenderSheetEditor();
}
function _onSheetRowRemoveClick(btn) {
  const idx = +btn.dataset.row;
  const row = _sheetEditState.parsed.editable[idx];
  if (!row) return;
  for (const g of _sheetEditState.parsed.groups) {
    const ri = g.rows.indexOf(row);
    if (ri >= 0) { g.rows.splice(ri, 1); break; }
  }
  _sheetEditState.parsed.editable.splice(idx, 1);
  _rerenderSheetEditor();
}

async function openSheetOverlay(ctx, mode) {
  _ensureSheetOverlay();
  const ov = document.getElementById('sheet-overlay'); ov.classList.add('open');
  const title = ov.querySelector('#sheet-modal-title');
  const actions = ov.querySelector('#sheet-modal-actions');
  const body = ov.querySelector('#sheet-modal-body');
  const status = ov.querySelector('#sheet-modal-status');
  status.textContent = ''; status.className = 'sheet-modal-status'; actions.innerHTML = '';
  title.textContent = `${ctx.name || ctx.label || 'Персонаж'} — Лист V20`;
  body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка…</div>';

  let d;
  try { d = await fetch(_sheetApi(ctx).get).then(r => r.json()); }
  catch (e) { body.innerHTML = `<div class="cdet-empty">Ошибка: ${escHtml(e.message)}</div>`; return; }
  if (!d.exists || !d.content) { body.innerHTML = '<div class="cdet-empty">Лист ещё не сгенерирован.</div>'; return; }

  if (mode === 'edit') {
    _sheetEditState = { ctx, parsed: _parseSheetForEdit(d.content), library: {} };
    await _prefetchSheetLibraries(_sheetEditState);
    body.innerHTML = `<div class="sheet-edit">${_renderSheetEditor(_sheetEditState)}</div>`;
    actions.innerHTML = `<button class="sheet-btn sheet-btn-save" id="sheet-save">💾 Сохранить</button>`;
    ov.querySelector('#sheet-save').addEventListener('click', _saveSheetEdit);
  } else {
    _sheetEditState = null;
    body.innerHTML = `<div class="sheet-view md-body">${mdToHtmlBlock(_stripSheetHeader(d.content))}</div>`;
    actions.innerHTML = `<button class="sheet-btn" id="sheet-to-edit">✏ Редактировать</button>`;
    ov.querySelector('#sheet-to-edit').addEventListener('click', async () => await openSheetOverlay(ctx, 'edit'));
  }
}

async function _saveSheetEdit() {
  if (!_sheetEditState) return;
  const status = document.getElementById('sheet-modal-status');
  const btn = document.getElementById('sheet-save');
  btn.disabled = true; btn.textContent = '⏳ Сохранение…'; status.textContent = ''; status.className = 'sheet-modal-status';
  try {
    const md = _buildEditedSheet(_sheetEditState.parsed);
    const d = await fetch(_sheetApi(_sheetEditState.ctx).put,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: md }) }
    ).then(r => r.json());
    if (!d.ok) throw new Error(d.error || 'не удалось');
    status.textContent = '✓ Сохранено'; status.classList.add('ok');
    _sheetEditState.ctx.onSaved?.();
  } catch (e) { status.textContent = '✗ ' + e.message; status.classList.add('err'); }
  finally { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
}

// Generate (or regenerate) a sheet for any context (character / module NPC).
async function _generateSheet(ctx, btn) {
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация…'; }
  try {
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref  = _getPref(prefs, 'sheet', 'claude');
    const d = await fetch(_sheetApi(ctx).gen,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: pref.provider, model: pref.model }) }
    ).then(r => r.json());
    if (!d.ok) throw new Error(d.error || 'не удалось');
    ctx.onSaved?.();
    return true;
  } catch (e) { showToast('Ошибка генерации листа: ' + e.message, 'error'); return false; }
  finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

async function _diaryGenerate(charName) {
  const period = document.getElementById('diary-period').value.trim();
  if (!period) { _diaryMsg('Укажи период (ГГГГ-ММ)', false); return; }
  const btn = document.getElementById('diary-gen'); const old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Генерация…'; _diaryMsg('');
  try {
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref         = _getPref(featPrefs, 'prose', 'openrouter');
    const preferSource = pref.provider;
    const orModel      = preferSource === 'openrouter' ? (pref.model || null) : null;
    const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/diary/generate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session: document.getElementById('diary-session').value.trim(), hint: document.getElementById('diary-hint').value.trim(), preferSource, orModel }) }).then(r => r.json());
    if (r.error) { _diaryMsg(r.error, false); return; }
    document.getElementById('diary-text').value = r.text || '';
    _diaryMsg(`Сгенерировано (${r.source}). Проверь и сохрани.`);
  } catch (e) { _diaryMsg('Ошибка: ' + e.message, false); }
  finally { btn.disabled = false; btn.textContent = old; }
}

async function _diarySave(charName) {
  const period = document.getElementById('diary-period').value.trim();
  const text   = document.getElementById('diary-text').value.trim();
  if (!period) { _diaryMsg('Укажи период (ГГГГ-ММ)', false); return; }
  if (!text)   { _diaryMsg('Пустой текст записи', false); return; }
  const btn = document.getElementById('diary-save'); const old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳…';
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(_charSlug(charName))}/diary`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session: document.getElementById('diary-session').value.trim(), text }) }).then(r => r.json());
    if (r.error) { _diaryMsg(r.error, false); return; }
    _diaryMsg('✓ Сохранено');
    STATE.characters = []; await ensureCharsLoaded();
    const c = STATE.characters.find(ch => ch.name === charName);
    const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
    if (panel && c) panel.innerHTML = renderDiaryList(c);
  } catch (e) { _diaryMsg('Ошибка: ' + e.message, false); }
  finally { btn.disabled = false; btn.textContent = old; }
}

