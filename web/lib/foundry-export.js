'use strict';
// Маппер Sanguine → Foundry Actor JSON (система worldofdarkness v7.1.5).
// Схема Actor.system подтверждена разбором реального Export Data — см.
// docs/superpowers/specs/2026-07-08-foundry-integration-design.md, разделы 1.3/1.7/2.
//
// Что НЕ экспортируется/экспортируется с оговоркой:
// - Достоинства/Недостатки — Sanguine хранит их одним свободным текстом без очков/типа.
//   Строки, совпавшие по имени с библиотекой system/library/{merits,flaws}/*.json
//   (см. foundry-merits.js), экспортируются как структурированные Item; несовпавшие
//   (кастомные, не из канона) остаются текстом в system.notes.
// - Фон (backgrounds) — экспортируется как Item типа Feature, system.type
//   "wod.types.background", по аналогии с достоинствами/недостатками (тот же паттерн
//   именования `wod.types.<kind>`, что и у всех подтверждённых типов). Подтверждено
//   на реальном Import Data в Foundry — Фон импортируется корректно.
// - system.settings/soak/initiative/movement — производные поля, их пересчитывает
//   сама система Foundry при открытии листа; маппер пишет только has*-флаги.
// - Уровни здоровья (health.<level>.value/total/penalty) — тоже производные от
//   health.damage.*, не пишутся напрямую.
// - system.background (свободный текст в базовом партиале template.json) — НЕ путать с Фоном
//   (Backgrounds, дотовая черта, экспортируется отдельно как Item). Сюда пишется «История»
//   листа Sanguine (sheetData.history) — биография персонажа. Обратного маппинга (Foundry →
//   Sanguine) для этого поля нет: и history, и background — свободный текст, читаются 1:1,
//   см. foundry-import.js.
// - system.appearance (тоже свободный текст) — собирается из структурированных полей
//   «Описание» листа Sanguine (sheetData.description: дата рождения, раса, волосы, глаза и
//   т.п.) в читаемые строки «Подпись: значение». Обратный маппинг НЕ делается — разбирать
//   свободный текст Foundry обратно в структурированные поля ненадёжно.

const {
  clanRuToFoundryKey, sectRuToFoundryKey,
  parseGenerationNumber, bloodMaxForGeneration,
} = require('./foundry-clans');
const { matchMeritsFlaws } = require('./foundry-merits');

// Линейки, для которых у нас есть собственный маппер (Changeling — отдельный будущий цикл,
// нужны новые поля модели листа: Glamour/Banality/Realms/Arts). Единый источник истины для
// обоих Foundry-роутов (export-foundry, export-foundry-bulk) в web/routes/characters.js —
// не дублировать этот список литералом на роутах.
const FOUNDRY_SUPPORTED_LINEAGES = ['vampire', 'mortal'];

// Описание (Внешность) листа Sanguine — структурированные поля (см. web/public/scripts.js:6321,
// _v20Empty().description) → Foundry system.appearance (единое свободное текстовое поле в базовом
// партиале template.json). Порядок и подписи — как в V20_DESC (web/public/scripts.js:7475).
const DESCRIPTION_LABELS = [
  ['birthDate', 'Дата рождения'], ['apparentAge', 'Видимый возраст'], ['deathDate', 'Дата смерти'],
  ['gender', 'Пол'], ['race', 'Раса'], ['hair', 'Волосы'], ['eyes', 'Глаза'],
  ['heightWeight', 'Рост/Вес'], ['build', 'Телосложение'], ['nationality', 'Национальность'],
];
function _appearanceText(description) {
  return DESCRIPTION_LABELS
    .map(([key, label]) => [label, String(description?.[key] || '').trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

// Sanguine ability display name (RU, как в V20_ABILITIES web/public/scripts.js:6170-6174)
// → Foundry fixed abilities.<key> (EN, template.json partial `ability`).
const ABILITY_KEY_BY_RU = {
  // talents
  'атлетика': 'athletics', 'бдительность': 'alertness', 'драка': 'brawl',
  'запугивание': 'intimidation', 'красноречие': 'expression', 'лидерство': 'leadership',
  'уличное чутьё': 'streetwise', 'хитрость': 'subterfuge', 'шестое чувство': 'awareness',
  'эмпатия': 'empathy',
  // skills
  'вождение': 'drive', 'воровство': 'larceny', 'выживание': 'survival',
  'исполнение': 'performance', 'обращение с животными': 'animalken', 'ремесло': 'craft',
  'скрытность': 'stealth', 'стрельба': 'firearms', 'фехтование': 'melee', 'этикет': 'etiquette',
  // knowledges
  'гуманитарные науки': 'academics', 'естественные науки': 'science', 'законы': 'law',
  'информатика': 'computer', 'медицина': 'medicine', 'оккультизм': 'occult',
  'политика': 'politics', 'расследование': 'investigation', 'финансы': 'finance',
  'электроника': 'technology',
};
const ABILITY_GROUP_TYPE = { talents: 'talent', skills: 'skill', knowledges: 'knowledge' };

function _norm(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
}

// Плоский {key: {value,max,type}} словарь способностей: канонические (найденные
// в ABILITY_KEY_BY_RU) идут в system.abilities; кастомные (не найденные — свободные
// слоты вроде «Знания музыки») собираются отдельно как embedded Trait-Items.
function _mapAbilities(sheetAbilities) {
  const abilities = {};
  const customTraits = [];
  for (const group of ['talents', 'skills', 'knowledges']) {
    for (const slot of sheetAbilities?.[group] || []) {
      const name = String(slot?.name || '').trim();
      if (!name) continue;
      const key = ABILITY_KEY_BY_RU[_norm(name)];
      if (key) {
        // isvisible: true обязателен — реальный Export Data (смертный.json) показывает, что
        // это поле не универсально true по умолчанию у системы (часть служебных ключей вроде
        // dodge/art скрыты по умолчанию); без явного isvisible канонические способности не
        // отображались на листе Foundry после Import Data (репортнуто пользователем).
        abilities[key] = { value: Number(slot.val) || 0, max: 5, type: ABILITY_GROUP_TYPE[group], isvisible: true };
      } else {
        customTraits.push({ name, value: Number(slot.val) || 0, group });
      }
    }
  }
  return { abilities, customTraits };
}

// isvisible: true на каждом Item — реальный Export Data (смертный.json) показывает это поле
// на всех embedded Item (оружие, Trait), и его отсутствие похоже на причину того, что канонические
// способности/черты не отображались на листе Foundry после Import Data (см. _mapAbilities).
function _traitItem(name, value, group) {
  const typeSuffix = { talents: 'talentsecondability', skills: 'skillsecondability', knowledges: 'knowledgesecondability' }[group];
  return {
    name, type: 'Trait',
    system: { type: `wod.types.${typeSuffix}`, level: '0', value, max: 7, isrollable: false, isvisible: true },
  };
}

function _disciplineItems(disciplines) {
  return (disciplines || [])
    .filter(d => String(d?.name || '').trim())
    .map(d => ({
      name: d.name, type: 'Power',
      system: { type: 'wod.types.discipline', level: 0, value: Number(d.val) || 0, max: 7, game: 'vampire', isvisible: true },
    }));
}

function _backgroundItems(backgrounds) {
  return (backgrounds || [])
    .filter(b => String(b?.name || '').trim())
    .map(b => ({
      name: b.name, type: 'Feature',
      system: { type: 'wod.types.background', level: Number(b.val) || 0, value: 0, max: 5, isvisible: true },
    }));
}

// Достоинства/недостатки, совпавшие с библиотекой (см. foundry-merits.js), —
// структурированные Item; несовпавшие остаются в system.notes (вызывающий код).
function _meritFlawItems(matched) {
  return matched.map(m => ({
    name: m.name, type: 'Feature',
    system: { type: `wod.types.${m.kind}`, level: m.points, value: 0, max: 5, isrollable: false, isvisible: true },
  }));
}

// «Прочие черты» — текстовые особенности без канонической категории (Item.type: "Trait",
// system.type: "wod.types.othertraits" — подтверждено на реальном Mortal Export Data,
// см. docs/superpowers/specs/2026-07-08-foundry-mortal-support-design.md, раздел 1).
// Лайнэдж-агностично: то же поле otherTraits существует в модели листа для вампиров тоже
// (страница 2 листа), просто раньше в мапперах этого типа Item не было вовсе.
function _otherTraitItems(otherTraits) {
  return (otherTraits || [])
    .filter(t => String(t?.name || '').trim())
    .map(t => ({
      name: t.name, type: 'Trait',
      system: { type: 'wod.types.othertraits', level: '0', value: Number(t.val) || 0, max: 0, isrollable: false, isvisible: true },
    }));
}

// Sanguine отмечает 7 уровней здоровья булевыми флагами (порядок = тяжесть),
// Foundry хранит суммарные очки урона по типу. Sanguine не различает тип урона —
// весь отмеченный урон уходит в damage.lethal (разумный дефолт для вампира).
const HEALTH_LEVELS = ['bruised', 'hurt', 'injured', 'wounded', 'mauled', 'crippled', 'incapacitated'];
function _healthDamage(health) {
  const marked = HEALTH_LEVELS.filter(k => !!health?.[k]).length;
  return { bashing: 0, lethal: marked, aggravated: 0, woundlevel: '', woundpenalty: 0 };
}

function mapCharacterToFoundryActor(char, sheetData) {
  const s = sheetData || {};
  const isVamp = char.lineage === 'vampire';

  const genNumber = isVamp ? (parseGenerationNumber(char.generation || s.header?.generation) || 13) : null;
  const bloodMax = isVamp ? bloodMaxForGeneration(genNumber) : null;

  const clanKey = isVamp ? clanRuToFoundryKey(char.clan || s.header?.clan) : null;
  const sectKey = isVamp ? sectRuToFoundryKey(char.sect) : null;

  const { abilities, customTraits } = _mapAbilities(s.abilities);
  const attrs = {
    strength: s.attributes?.physical?.strength, dexterity: s.attributes?.physical?.dexterity,
    stamina: s.attributes?.physical?.stamina, charisma: s.attributes?.social?.charisma,
    manipulation: s.attributes?.social?.manipulation, appearance: s.attributes?.social?.appearance,
    composure: s.attributes?.social?.composure, perception: s.attributes?.mental?.perception,
    intelligence: s.attributes?.mental?.intelligence, wits: s.attributes?.mental?.wits,
    resolve: s.attributes?.mental?.resolve,
  };
  const attributesOut = {};
  for (const [k, v] of Object.entries(attrs)) attributesOut[k] = { value: Number(v) || 0, max: 5 };

  const willpowerTemp = (s.willpower?.temp || []).filter(Boolean).length;
  const bloodTemp = bloodMax == null
    ? Number(s.bloodPoolCount) || 0
    : (s.bloodPool || []).filter(Boolean).length;

  const { matched: matchedMeritsFlaws, unmatched: unmatchedMeritsFlaws } = matchMeritsFlaws(s.meritsFlaws);

  const items = [
    ...customTraits.map(t => _traitItem(t.name, t.value, t.group)),
    ..._disciplineItems(s.disciplines),
    ..._backgroundItems(s.backgrounds),
    ..._meritFlawItems(matchedMeritsFlaws),
    ..._otherTraitItems(s.otherTraits),
  ];

  const settingsBase = {
    haswillpower: true,
    hasrage: false, hasgnosis: false, hasglamour: false, hasbanality: false,
    hasnightmare: false, hasconviction: false, hasfaith: false, hastorment: false,
    hasessence: false, hascorpus: false, haspathos: false, hasangst: false,
    hasvitality: false, hasspite: false, hasbalance: false, hassekhem: false,
    hasquintessence: false,
  };
  const settings = isVamp
    ? { ...settingsBase, haspath: true, hasbloodpool: true, hasvirtue: true }
    : { ...settingsBase, haspath: true, hasbloodpool: false, hasvirtue: true };

  // Клан/секта/поколение/сир/кровная линия/слабость/custom — только у вампира; для Mortal этих
  // ключей в system не должно быть вовсе (подтверждено на реальном Export Data, см. спеку).
  const vampireOnlySystem = isVamp ? {
    custom: { clan: clanKey ? '' : (char.clan || ''), sect: sectKey ? '' : (char.sect || '') },
    clan: clanKey ? `wod.bio.vampire.${clanKey}` : '',
    sect: sectKey ? `wod.bio.vampire.${sectKey}` : '',
    bloodline: '', weakness: s.flaw || '',
    generation: genNumber, generationmod: 0,
    sire: char.sire || s.header?.sire || '',
  } : {};

  return {
    name: char.name || s.header?.name || '',
    type: isVamp ? 'Vampire' : 'Mortal',
    system: {
      nature: s.header?.nature || '', demeanor: s.header?.demeanor || '',
      concept: s.header?.concept || '',
      appearance: _appearanceText(s.description),
      background: s.history || '',
      notes: unmatchedMeritsFlaws.join('\n'),
      settings,
      attributes: attributesOut,
      abilities,
      advantages: {
        virtues: {
          conscience: { permanent: Number(s.virtues?.conscience) || 0, temporary: Number(s.virtues?.conscience) || 0, max: 5 },
          selfcontrol: { permanent: Number(s.virtues?.selfcontrol) || 0, temporary: Number(s.virtues?.selfcontrol) || 0, max: 5 },
          courage: { permanent: Number(s.virtues?.courage) || 0, temporary: Number(s.virtues?.courage) || 0, max: 5 },
        },
        willpower: { permanent: Number(s.willpower?.permanent) || 0, temporary: willpowerTemp, max: 10 },
        bloodpool: { temporary: bloodTemp, max: isVamp ? (bloodMax ?? 30) : 0, perturn: Number(s.bloodPerTurn) || 1 },
        path: {
          permanent: Number(s.humanity) || 0, value: 0, max: 10, custom: '',
          label: s.path && _norm(s.path) !== 'человечность' ? '' : 'wod.advantages.path.humanity',
        },
      },
      health: { damage: _healthDamage(s.health) },
      ...vampireOnlySystem,
    },
    items,
  };
}

module.exports = { mapCharacterToFoundryActor, FOUNDRY_SUPPORTED_LINEAGES };
