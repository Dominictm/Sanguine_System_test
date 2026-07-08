'use strict';
// Маппер Sanguine → Foundry Actor JSON (система worldofdarkness v7.1.5).
// Схема Actor.system подтверждена разбором реального Export Data — см.
// docs/superpowers/specs/2026-07-08-foundry-integration-design.md, разделы 1.3/1.7/2.
//
// Что НЕ экспортируется (осознанно, см. шапку файла плана docs/superpowers/plans/
// 2026-07-08-foundry-sync-phase1.md):
// - Фон (backgrounds) — system.type для Item-Фона не подтверждён на реальных данных,
//   доделывается в Фазе 2 после проверки на персонаже с непустым Фоном.
// - Достоинства/Недостатки — Sanguine хранит их одним свободным текстом без очков/типа,
//   структурировать нельзя не изобретая эвристику — текст целиком уходит в system.notes.
// - system.settings/soak/initiative/movement — производные поля, их пересчитывает
//   сама система Foundry при открытии листа; маппер пишет только has*-флаги.
// - Уровни здоровья (health.<level>.value/total/penalty) — тоже производные от
//   health.damage.*, не пишутся напрямую (см. Task 2, шапка плана).

const {
  clanRuToFoundryKey, sectRuToFoundryKey,
  parseGenerationNumber, bloodMaxForGeneration,
} = require('./foundry-clans');

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
        abilities[key] = { value: Number(slot.val) || 0, max: 5, type: ABILITY_GROUP_TYPE[group] };
      } else {
        customTraits.push({ name, value: Number(slot.val) || 0, group });
      }
    }
  }
  return { abilities, customTraits };
}

function _traitItem(name, value, group) {
  const typeSuffix = { talents: 'talentsecondability', skills: 'skillsecondability', knowledges: 'knowledgesecondability' }[group];
  return {
    name, type: 'Trait',
    system: { type: `wod.types.${typeSuffix}`, level: '0', value, max: 7, isrollable: false },
  };
}

function _disciplineItems(disciplines) {
  return (disciplines || [])
    .filter(d => String(d?.name || '').trim())
    .map(d => ({
      name: d.name, type: 'Power',
      system: { type: 'wod.types.discipline', level: 0, value: Number(d.val) || 0, max: 7, game: 'vampire' },
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
  const genNumber = parseGenerationNumber(char.generation || s.header?.generation) || 13;
  const bloodMax = bloodMaxForGeneration(genNumber);

  const clanKey = clanRuToFoundryKey(char.clan || s.header?.clan);
  const sectKey = sectRuToFoundryKey(char.sect);

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

  const items = [
    ...customTraits.map(t => _traitItem(t.name, t.value, t.group)),
    ..._disciplineItems(s.disciplines),
  ];

  return {
    name: char.name || s.header?.name || '',
    type: 'Vampire',
    system: {
      nature: s.header?.nature || '', demeanor: s.header?.demeanor || '',
      concept: s.header?.concept || '', background: '', notes: s.meritsFlaws || '',
      settings: {
        haswillpower: true, haspath: true, hasbloodpool: true, hasvirtue: true,
        hasrage: false, hasgnosis: false, hasglamour: false, hasbanality: false,
        hasnightmare: false, hasconviction: false, hasfaith: false, hastorment: false,
        hasessence: false, hascorpus: false, haspathos: false, hasangst: false,
        hasvitality: false, hasspite: false, hasbalance: false, hassekhem: false,
        hasquintessence: false,
      },
      attributes: attributesOut,
      abilities,
      advantages: {
        virtues: {
          conscience: { permanent: Number(s.virtues?.conscience) || 0, temporary: Number(s.virtues?.conscience) || 0, max: 5 },
          selfcontrol: { permanent: Number(s.virtues?.selfcontrol) || 0, temporary: Number(s.virtues?.selfcontrol) || 0, max: 5 },
          courage: { permanent: Number(s.virtues?.courage) || 0, temporary: Number(s.virtues?.courage) || 0, max: 5 },
        },
        willpower: { permanent: Number(s.willpower?.permanent) || 0, temporary: willpowerTemp, max: 10 },
        bloodpool: { temporary: bloodTemp, max: bloodMax ?? 30, perturn: Number(s.bloodPerTurn) || 1 },
        path: {
          permanent: Number(s.humanity) || 0, value: 0, max: 10, custom: '',
          label: s.path && _norm(s.path) !== 'человечность' ? '' : 'wod.advantages.path.humanity',
        },
      },
      health: { damage: _healthDamage(s.health) },
      custom: { clan: clanKey ? '' : (char.clan || ''), sect: sectKey ? '' : (char.sect || '') },
      clan: clanKey ? `wod.bio.vampire.${clanKey}` : '',
      sect: sectKey ? `wod.bio.vampire.${sectKey}` : '',
      bloodline: '', weakness: s.flaw || '',
      generation: genNumber, generationmod: 0,
      sire: char.sire || s.header?.sire || '',
    },
    items,
  };
}

module.exports = { mapCharacterToFoundryActor };
