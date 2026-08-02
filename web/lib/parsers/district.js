'use strict';
// district.md build/parse — карточка Района (план 2026-08-02-city-creation-restructure,
// §5.1/§8: Город → Район → Локация, без «Округа» как уровня пути). Файл лежит внутри
// самой папки района, рядом со вложенными папками его локаций:
//   cities/<city>/locations/<rayon-slug>/district.md
//   cities/<city>/locations/<rayon-slug>/<loc-slug>/<loc-slug>.md
// Имя файла всегда буквально «district.md» (не слаг) — не совпадает с именем папки
// локации (у которой имя файла = слаг папки), поэтому легко отличить от карточки
// локации при обходе дерева. Единый источник для POST /api/cities/:slug/districts,
// PUT того же, tools/new_district.js и бэкофилл-миграции
// (tools/migrations/003_district_md_backfill.js) — как buildCityMd/cityScaffold для города.

const DISTRICT_FILENAME = 'district.md';
const PLACEHOLDER = '⚠️ Требуется уточнение';

/**
 * Собирает содержимое district.md из полей формы/CLI.
 * @param {{name?: string, type?: string, sect?: string, clan?: string, description?: string}} fields
 * @returns {string} готовый Markdown district.md
 */
function buildDistrictMd(fields = {}) {
  const name        = String(fields.name || '').trim() || 'Район';
  const type        = String(fields.type || '').trim() || PLACEHOLDER;
  const sect        = String(fields.sect || '').trim() || PLACEHOLDER;
  const clan        = String(fields.clan || '').trim() || PLACEHOLDER;
  const description = String(fields.description || '').trim() || PLACEHOLDER;
  return `# 🏘️ ${name}

- **Тип района:** ${type}
- **Влияние — Секта:** ${sect}
- **Влияние — Клан:** ${clan}

---

## 📝 Описание

${description}
`;
}

/**
 * Разбирает district.md обратно в структуру для формы редактирования/API.
 * @param {string} raw — содержимое district.md
 * @returns {{name: string, type: string, sect: string, clan: string, description: string}}
 */
function parseDistrictMd(raw) {
  const content = String(raw == null ? '' : raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');

  // Name from # header (strip leading emoji / whitespace) — same convention as parseCharacter.
  const hm = content.match(/^#\s+[^\wЀ-ӿ]*([\wЀ-ӿ].+)$/m);
  const name = hm ? hm[1].trim() : '';

  function metaField(label) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = content.match(new RegExp(`\\*\\*${esc}:\\*\\*\\s*([^|\\n]+?)(?=\\s*\\||\\s*\\n|$)`, 'm'));
    return m ? m[1].trim() : '';
  }
  const type = metaField('Тип района');
  const sect = metaField('Влияние — Секта');
  const clan = metaField('Влияние — Клан');

  const descM = content.match(/## (?:📝\s+)?Описание[^\n]*\n+([\s\S]+?)(?=\n## |\n---|$)/i);
  const description = descM ? descM[1].trim() : '';

  const isPlaceholder = v => !v || v === PLACEHOLDER;
  return {
    name,
    type: isPlaceholder(type) ? '' : type,
    sect: isPlaceholder(sect) ? '' : sect,
    clan: isPlaceholder(clan) ? '' : clan,
    description: isPlaceholder(description) ? '' : description,
  };
}

module.exports = { DISTRICT_FILENAME, DISTRICT_PLACEHOLDER: PLACEHOLDER, buildDistrictMd, parseDistrictMd };
