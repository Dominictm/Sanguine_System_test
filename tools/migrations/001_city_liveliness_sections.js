'use strict';
// Секции «живого города» (план 2026-07-15-city-liveliness, фаза D1):
// добавляет в существующие city.md девять новых секций CITY_SECTIONS
// (районы, значимые места, охотничьи угодья, законы домена, смертные
// институции, календарь, технологии/Маскарад, ограничения генерации,
// именник). Файл city.md опознаётся по заголовку «## Политический
// ландшафт» — он есть и в каркасных, и в рукописных городах, и не
// встречается в других файлах города.

const NEW_SECTIONS = [
  'Районы',
  'Значимые места',
  'Охотничьи угодья',
  'Законы домена',
  'Смертные институции',
  'Календарь города',
  'Технологии и Маскарад',
  'Ограничения генерации',
  'Именник и фактура',
];

const hasHeading = (text, h) =>
  new RegExp(`^##\\s+${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(text);

module.exports = {
  description: 'city.md: добавить секции «живого города» (D1, 2026-07-15)',
  test(text) {
    return hasHeading(text, 'Политический ландшафт')
      && NEW_SECTIONS.some(h => !hasHeading(text, h));
  },
  migrate(text) {
    const missing = NEW_SECTIONS.filter(h => !hasHeading(text, h));
    if (!missing.length) return text;
    const tail = missing.map(h => `## ${h}\n- …`).join('\n\n');
    return text.replace(/\s*$/, '\n\n') + tail + '\n';
  },
};
