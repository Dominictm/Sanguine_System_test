'use strict';
// Таблицы соответствия RU-названий клан/секта (как в system/rules/character_sheet_v20.md
// и карточках персонажей) ⇄ i18n-ключи системы worldofdarkness в Foundry
// (Data/modules/ru-ru/i18n/systems/worldofdarkness.json → wod.bio.vampire.*, подтверждено
// разбором реального Export Data — см. docs/superpowers/specs/2026-07-08-foundry-integration-design.md,
// раздел 1.7). Плюс таблица «Поколение → запас крови» — зеркало web/public/rules-v20.js
// (RULES_V20.generations) тем же способом дублирования, что уже практикуется в проекте.

// RU-название клана (как в RULES_V20.clans / карточке персонажа) → foundry-ключ.
// Каппадокийцы и Истинный Бруха у Foundry-словаря ru-ru эквивалента не имеют —
// намеренно не включены, вызывающий код должен обработать null (см. foundry-export.js).
const CLAN_RU_TO_KEY = {
  'тореадор': 'toreador',
  'малкавиан': 'malkavian',
  'вентру': 'ventrue',
  'бруха': 'brujah',
  'гангрел': 'gangrel',
  'носферату': 'nosferatu',
  'тремер': 'tremere',
  'цимисхи': 'tzimisce',
  'ассамиты': 'assamite',
};

const CLAN_KEY_TO_RU = {
  toreador: 'Тореадор', malkavian: 'Малкавиан', ventrue: 'Вентру', brujah: 'Бруха',
  gangrel: 'Гангрел', nosferatu: 'Носферату', tremere: 'Тремер', tzimisce: 'Цимисхи',
  assamite: 'Ассамиты', giovanni: 'Джованни', lasombra: 'Ласомбра', ravnos: 'Равнос',
  set: 'Последователи Сета', caitiff: 'Каитифф',
};

const SECT_RU_TO_KEY = {
  'камарилья': 'camarilla',
  'шабаш': 'sabbat',
  'анархи': 'anarch',
  'независимый': 'independent',
  'независимые': 'independent',
  'инконну': 'inconnu',
};

const SECT_KEY_TO_RU = {
  camarilla: 'Камарилья', sabbat: 'Шабаш', anarch: 'Движение Анархов',
  independent: 'Независимый', inconnu: 'Инконну', blackhand: 'Истинная Черная Рука',
};

function _norm(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
}

function clanRuToFoundryKey(ru) {
  return CLAN_RU_TO_KEY[_norm(ru)] || null;
}
function clanFoundryKeyToRu(key) {
  return CLAN_KEY_TO_RU[String(key || '').toLowerCase()] || null;
}
function sectRuToFoundryKey(ru) {
  return SECT_RU_TO_KEY[_norm(ru)] || null;
}
function sectFoundryKeyToRu(key) {
  return SECT_KEY_TO_RU[String(key || '').toLowerCase()] || null;
}

// «7-е» / «13-е поколение» → 7 / 13. Тот же регекс, что уже использует
// v20GenerationInfo() в web/public/rules-v20.js:85 — держим идентичным.
function parseGenerationNumber(gen) {
  const n = parseInt(String(gen || '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Зеркало RULES_V20.generations[].bloodMax (web/public/rules-v20.js:25-37).
// null = 3-е поколение, запас крови без фиксированного предела («счётчик»).
const BLOOD_MAX_BY_GEN = {
  3: null, 4: 50, 5: 40, 6: 30, 7: 20, 8: 15, 9: 14, 10: 13, 11: 12, 12: 11, 13: 10,
};
function bloodMaxForGeneration(genNumber) {
  const clamped = Math.max(3, Math.min(13, genNumber));
  return BLOOD_MAX_BY_GEN[clamped] ?? null;
}

module.exports = {
  clanRuToFoundryKey, clanFoundryKeyToRu,
  sectRuToFoundryKey, sectFoundryKeyToRu,
  parseGenerationNumber, bloodMaxForGeneration,
};
