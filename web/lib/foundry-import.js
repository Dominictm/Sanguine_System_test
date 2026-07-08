'use strict';
// Обратный маппер: Foundry Actor JSON (Export Data) → Sanguine sheet-data + card fields.
// См. шапку web/lib/foundry-export.js и docs/superpowers/specs/2026-07-08-foundry-integration-design.md.

const { clanFoundryKeyToRu, sectFoundryKeyToRu } = require('./foundry-clans');

const ABILITY_RU_BY_KEY = {
  athletics: 'Атлетика', alertness: 'Бдительность', brawl: 'Драка', intimidation: 'Запугивание',
  expression: 'Красноречие', leadership: 'Лидерство', streetwise: 'Уличное чутьё',
  subterfuge: 'Хитрость', awareness: 'Шестое чувство', empathy: 'Эмпатия',
  drive: 'Вождение', larceny: 'Воровство', survival: 'Выживание', performance: 'Исполнение',
  animalken: 'Обращение с животными', craft: 'Ремесло', stealth: 'Скрытность',
  firearms: 'Стрельба', melee: 'Фехтование', etiquette: 'Этикет',
  academics: 'Гуманитарные науки', science: 'Естественные науки', law: 'Законы',
  computer: 'Информатика', medicine: 'Медицина', occult: 'Оккультизм', politics: 'Политика',
  investigation: 'Расследование', finance: 'Финансы', technology: 'Электроника',
};
const GROUP_BY_ABILITY_TYPE = { talent: 'talents', skill: 'skills', knowledge: 'knowledges' };
const GROUP_BY_TRAIT_TYPE = {
  'wod.types.talentsecondability': 'talents',
  'wod.types.skillsecondability': 'skills',
  'wod.types.knowledgesecondability': 'knowledges',
};

const HEALTH_LEVELS = ['bruised', 'hurt', 'injured', 'wounded', 'mauled', 'crippled', 'incapacitated'];

function mapFoundryActorToSheetData(actor, existingSheetData) {
  const sys = actor?.system || {};
  const items = Array.isArray(actor?.items) ? actor.items : [];
  const base = existingSheetData || {};

  // Заполняем канонические способности по их фактической группе (type в Foundry-данных),
  // группа всегда следует за system.abilities.<key>.type, не за жёсткой RU-картой.
  const abilities = { talents: [], skills: [], knowledges: [] };
  for (const [key, ru] of Object.entries(ABILITY_RU_BY_KEY)) {
    const a = sys.abilities?.[key];
    if (!a) continue;
    const group = GROUP_BY_ABILITY_TYPE[a.type] || 'talents';
    abilities[group].push({ name: ru, val: Number(a.value) || 0, fixed: true });
  }
  for (const item of items) {
    if (item.type !== 'Trait') continue;
    const group = GROUP_BY_TRAIT_TYPE[item.system?.type];
    if (!group) continue;
    abilities[group].push({ name: item.name, val: Number(item.system?.value) || 0, fixed: false });
  }

  const disciplines = items
    .filter(i => i.type === 'Power' && i.system?.type === 'wod.types.discipline')
    .map(i => ({ name: i.name, val: Number(i.system?.value) || 0 }));

  const lethal = Number(sys.health?.damage?.lethal) || 0;
  const health = {};
  HEALTH_LEVELS.forEach((k, i) => { health[k] = i < lethal; });

  const willpowerTemp = Array(10).fill(false).map((_, i) => i < (Number(sys.advantages?.willpower?.temporary) || 0));
  const bloodPool = Array(20).fill(false).map((_, i) => i < (Number(sys.advantages?.bloodpool?.temporary) || 0));

  const sheetData = {
    ...base,
    header: {
      ...base.header,
      name: actor.name || base.header?.name || '',
      nature: sys.nature || base.header?.nature || '',
      demeanor: sys.demeanor || base.header?.demeanor || '',
      concept: sys.concept || base.header?.concept || '',
      sire: sys.sire || base.header?.sire || '',
      generation: sys.generation ? `${sys.generation}-е` : (base.header?.generation || ''),
    },
    attributes: {
      physical: {
        strength: Number(sys.attributes?.strength?.value) || 0,
        dexterity: Number(sys.attributes?.dexterity?.value) || 0,
        stamina: Number(sys.attributes?.stamina?.value) || 0,
      },
      social: {
        charisma: Number(sys.attributes?.charisma?.value) || 0,
        manipulation: Number(sys.attributes?.manipulation?.value) || 0,
        appearance: Number(sys.attributes?.appearance?.value) || 0,
        composure: Number(sys.attributes?.composure?.value) || 0,
      },
      mental: {
        perception: Number(sys.attributes?.perception?.value) || 0,
        intelligence: Number(sys.attributes?.intelligence?.value) || 0,
        wits: Number(sys.attributes?.wits?.value) || 0,
        resolve: Number(sys.attributes?.resolve?.value) || 0,
      },
    },
    abilities,
    disciplines,
    virtues: {
      conscience: Number(sys.advantages?.virtues?.conscience?.permanent) || 0,
      selfcontrol: Number(sys.advantages?.virtues?.selfcontrol?.permanent) || 0,
      courage: Number(sys.advantages?.virtues?.courage?.permanent) || 0,
    },
    meritsFlaws: sys.notes || base.meritsFlaws || '',
    humanity: Number(sys.advantages?.path?.permanent) || 0,
    path: sys.advantages?.path?.label === 'wod.advantages.path.humanity' ? 'Человечность' : (base.path || 'Человечность'),
    willpower: { permanent: Number(sys.advantages?.willpower?.permanent) || 0, temp: willpowerTemp },
    bloodPool, bloodPoolCount: base.bloodPoolCount || 0,
    bloodPerTurn: Number(sys.advantages?.bloodpool?.perturn) || 1,
    health,
    flaw: sys.weakness || base.flaw || '',
  };

  const clanRu = sys.clan ? clanFoundryKeyToRu(sys.clan.replace('wod.bio.vampire.', '')) : null;
  const sectRu = sys.sect ? sectFoundryKeyToRu(sys.sect.replace('wod.bio.vampire.', '')) : null;
  const cardFields = {
    clan: clanRu || sys.custom?.clan || '',
    sect: sectRu || sys.custom?.sect || '',
    generation: sys.generation ? `${sys.generation}-е` : '',
    sire: sys.sire || '',
  };

  return { sheetData, cardFields };
}

module.exports = { mapFoundryActorToSheetData };
