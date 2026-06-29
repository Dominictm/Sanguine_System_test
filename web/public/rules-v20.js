// ═══════════════════ Машиночитаемый слой правил V20 / cWoD ═══════════════════
// Зеркало ключевых таблиц из system/rules/character_sheet_v20.md,
// character_sheet_mortal.md, character_sheet_changeling.md.
// При правке таблиц в этих файлах — обновить и здесь.

const RULES_V20 = {
  // Клан → клановые дисциплины + клановая слабость (раздел «Дисциплины/Слабости кланов проекта»).
  clans: {
    'тореадор':      { disciplines: ['Прорицание', 'Стремительность', 'Присутствие'], weakness: 'Зачарованность — при встрече с исключительной красотой или искусством: Самоконтроль (сл. 6) или ступор' },
    'малкавиан':      { disciplines: ['Прорицание', 'Помешательство', 'Затемнение'], weakness: 'Безумие — минимум один постоянный деранжемент' },
    'вентру':         { disciplines: ['Доминирование', 'Стойкость', 'Присутствие'], weakness: 'Избирательность — может питаться только от одного типа жертв (определяется при создании)' },
    'бруха':          { disciplines: ['Стремительность', 'Могущество', 'Присутствие'], weakness: 'Вспыльчивость — Самоконтроль/Инстинкты при френезии: сложность +2' },
    'гангрел':        { disciplines: ['Анимализм', 'Стойкость', 'Превращение'], weakness: 'Зверство — после каждого френезия: +1 звериная черта' },
    'носферату':      { disciplines: ['Анимализм', 'Затемнение', 'Могущество'], weakness: 'Чудовищный облик — Привлекательность = 0 всегда' },
    'тремер':         { disciplines: ['Прорицание', 'Доминирование', 'Тауматургия'], weakness: 'Иерархия — строгие обязательства перед кланом' },
    'цимисхи':        { disciplines: ['Анимализм', 'Прорицание', 'Изменчивость'], weakness: 'Земля предков — сон только в родной земле (≈2,5 кг), иначе −3 ко всем характеристикам за каждые сутки' },
    'каппадокийцы':   { disciplines: ['Прорицание', 'Стойкость', 'Смерть'], weakness: 'Мёртвая плоть — Привлекательность = 0, облик смерти невозможно скрыть без магии' },
    'ассамиты':       { disciplines: ['Стремительность', 'Затемнение', 'Чародейство Ассамитов'], weakness: 'Кровная жажда — компульсивное влечение к крови вампиров; бросок Самоконтроля при контакте' },
    'истинный бруха': { disciplines: ['Могущество', 'Присутствие', 'Темпорис'], weakness: '' },
  },

  // Поколение → запас крови (max; null = «счётчик» без фиксированного предела, 3-е поколение),
  // предел траты в ход, max точек дисциплины (legacy — см. maxDots), max точек ЛЮБОЙ черты
  // (характеристики/способности/дисциплины/факты биографии — «Единая таблица максимума точек»).
  generations: {
    3:  { bloodMax: null, bloodPerTurn: null, discMax: 10, maxDots: 10 },
    4:  { bloodMax: 50, bloodPerTurn: 10, discMax: 9,  maxDots: 9 },
    5:  { bloodMax: 40, bloodPerTurn: 8,  discMax: 10, maxDots: 8 },
    6:  { bloodMax: 30, bloodPerTurn: 6,  discMax: 9,  maxDots: 7 },
    7:  { bloodMax: 20, bloodPerTurn: 4,  discMax: 8,  maxDots: 6 },
    8:  { bloodMax: 15, bloodPerTurn: 3,  discMax: 6,  maxDots: 5 },
    9:  { bloodMax: 14, bloodPerTurn: 2,  discMax: 6,  maxDots: 5 },
    10: { bloodMax: 13, bloodPerTurn: 1,  discMax: 5,  maxDots: 5 },
    11: { bloodMax: 12, bloodPerTurn: 1,  discMax: 5,  maxDots: 5 },
    12: { bloodMax: 11, bloodPerTurn: 1,  discMax: 5,  maxDots: 5 },
    13: { bloodMax: 10, bloodPerTurn: 1,  discMax: 5,  maxDots: 5 },
  },

  // Бюджеты создания по линейке (характеристики/способности — приоритет 1/2/3).
  creation: {
    vampires: {
      kamarilla: { label: 'Камарилья', attrs: [7, 5, 3], abilities: [13, 9, 5], disciplines: 3, backgrounds: 5, virtues: 7, freebies: 15 },
      anarch:    { label: 'Анарх',     attrs: [6, 5, 3], abilities: [12, 8, 5], disciplines: 4, backgrounds: 6, virtues: 7, freebies: 18 },
      sabbat:    { label: 'Шабаш',     attrs: [7, 5, 3], abilities: [13, 9, 5], disciplines: 4, backgrounds: 0, virtues: 5, freebies: 15 },
    },
    mortals: { label: 'Смертный',  attrs: [6, 4, 3], abilities: [11, 7, 4], backgrounds: 5, virtues: 7, freebies: 21 },
    fairies: { label: 'Подменыш',  attrs: [7, 5, 3], abilities: [13, 9, 5], arts: 3, realms: 5, backgrounds: 5, virtues: 7, freebies: 15 },
  },

  // Стоимость свободного очка за точку, по линейке.
  freebieCosts: {
    vampires: { attribute: 5, ability: 2, discipline: 7, background: 1, virtue: 2, humanity: 1, willpower: 1 },
    mortals:  { attribute: 5, ability: 2, background: 1, virtue: 2, humanity: 1 },
    fairies:  { attribute: 5, art: 5, glamour: 3, realm: 3, ability: 2, willpower: 2, background: 1 },
  },

  // Стоимость обучения (XP) — вампиры; для Фазы 2.
  xpCosts: {
    newAbility: 3, ability: 'тек.×2', clanDiscipline: 'тек.×5', outClanDiscipline: 'тек.×7',
    newDiscipline: 10, attribute: 'тек.×4', virtue: 'тек.×2', humanity: 'тек.×2', willpower: 'тек.',
  },

  // Какие разделы листа активны по линейке (folder-имя, как в модели листа).
  lineageRules: {
    vampires: { hasClan: true, hasGeneration: true, hasBlood: true, hasDisciplines: true },
    mortals:  { hasClan: false, hasGeneration: false, hasBlood: false, hasDisciplines: false },
    fairies:  { hasClan: false, hasGeneration: false, hasBlood: false, hasDisciplines: false, note: 'Искусства/Сферы и Glamour/Banality пока вне структурной модели листа' },
  },
};

// Клан из шапки листа → ключ таблицы RULES_V20.clans (нормализация: нижний регистр, без скобок).
function v20ClanKey(name) {
  return String(name || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
}
function v20ClanInfo(name) {
  const key = v20ClanKey(name);
  if (!key) return null;
  if (RULES_V20.clans[key]) return RULES_V20.clans[key];
  const found = Object.keys(RULES_V20.clans).find(k => key.startsWith(k) || k.startsWith(key));
  return found ? RULES_V20.clans[found] : null;
}

// Поколение (строка/число из шапки) → таблица «Запас крови / max точек по поколению».
function v20GenerationInfo(gen) {
  const n = parseInt(String(gen || '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(3, Math.min(13, n));
  return RULES_V20.generations[clamped] || null;
}

// Стоимость одного шага повышения (тек. рейтинг ДО шага → +1) по таблице «Стоимость обучения».
function v20XpStepCost(kind, curStep, isClanDisc) {
  switch (kind) {
    case 'attribute':  return curStep * 4;
    case 'ability':     return curStep === 0 ? 3 : curStep * 2;
    case 'virtue':      return curStep * 2;
    case 'humanity':    return curStep * 2;
    case 'willpower':   return curStep || 1;
    case 'discipline':  return curStep === 0 ? 10 : curStep * (isClanDisc ? 5 : 7);
    default: return 0;
  }
}
// Суммарная стоимость поднятия от cur до next (несколько шагов, если ставят сразу несколько точек).
function v20XpCost(kind, cur, next, isClanDisc) {
  let total = 0;
  for (let s = cur; s < next; s++) total += v20XpStepCost(kind, s, isClanDisc);
  return total;
}

if (typeof window !== 'undefined') {
  window.RULES_V20 = RULES_V20;
  window.v20ClanKey = v20ClanKey;
  window.v20ClanInfo = v20ClanInfo;
  window.v20GenerationInfo = v20GenerationInfo;
  window.v20XpCost = v20XpCost;
}
