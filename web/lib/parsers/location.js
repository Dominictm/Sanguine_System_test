'use strict';
// Location card parsing. Extracted from parsers.js during the
// 2026-07-12 decomposition.

const { readPrompt } = require('./shared');

// ── Location card parser ─────────────────────────────────────────────────────
/**
 * Разбирает Markdown-карточку локации в плоскую структуру для API/фронтенда.
 * Тот же источник истины, которым парсится и сохранённая карточка, и сырой
 * AI-сгенерированный текст (см. `POST /api/locations/parse-generated`).
 * @param {string} rawContent — содержимое `<slug>.md` (или сырой сгенерированный текст той же структуры)
 * @param {string} folderName — имя папки локации (кладётся в `slug`)
 * @returns {{slug: string, title?: string, subtype?: string, district?: string, neighborhood?: string,
 *   address?: string, zone?: string, control?: string, atmosphere?: string,
 *   sensoryPalette: {channel: string, value: string}[], locStatus?: string, faction?: string,
 *   figures?: string, threats?: string, masquerade?: string, masqueradeLevel: 'low'|'medium'|'high'|'unknown',
 *   vtmText?: string, hooks: string[], keyPoints: {place: string, desc: string}[],
 *   imagePrompt?: string, negativePrompt?: string}}
 */
function parseLocation(rawContent, folderName) {
  const content = rawContent.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const loc = { slug: folderName };

  const hm = content.match(/^#\s+(.+)$/m);
  if (hm) loc.title = hm[1].trim();

  // Parse any **Label:** value | or end-of-line pattern
  function metaField(label) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = content.match(new RegExp(`\\*\\*${esc}:\\*\\*\\s*([^|\\n]+?)(?=\\s*\\||\\s*\\n|$)`, 'm'));
    return m ? m[1].trim() : null;
  }

  loc.subtype      = metaField('Название');
  loc.district     = metaField('Округ');
  loc.neighborhood = metaField('Район');
  loc.address      = metaField('Адрес');
  loc.zone         = metaField('Зона');
  loc.control      = metaField('Контроль');

  // Atmosphere — emoji and exact wording optional
  const atmM = content.match(/## (?:🎭\s+)?Атмосфера[^\n]*\n+([\s\S]+?)(?=\n## |\n---)/);
  if (atmM) loc.atmosphere = atmM[1].trim();

  // Sensory palette — raw table text
  const sensM = content.match(/## (?:👁️\s+)?Сенсорная палитра[^\n]*\n+([\s\S]+?)(?=\n## |\n---)/i);
  if (sensM) {
    loc.sensoryPalette = (sensM[1].match(/^\|[^|\n]+\|[^|\n]+\|/gm) || [])
      .filter(r => !r.match(/[-]{3}/))
      .map(r => {
        const cells = r.split('|').slice(1, -1).map(c => c.replace(/\*\*/g, '').trim());
        return { channel: cells[0], value: cells[1] };
      })
      .filter(r => r.channel && r.value);
  } else {
    loc.sensoryPalette = [];
  }

  // VtM table fields
  for (const [label, key] of [
    ['Статус',            'locStatus'],
    ['Фракция',           'faction'],
    ['Постоянные фигуры', 'figures'],
    ['Угрозы',            'threats'],
    ['Маскарад',          'masquerade'],
  ]) {
    const m = content.match(new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|\\n]+)\\|`));
    if (m) loc[key] = m[1].trim();
  }

  // VtM section — prose only (strip table rows, separator lines, Маскарад inline)
  const vtmFreeM = content.match(/## (?:🩸\s+)?(?:VtM[^\n]*|Контекст[^\n]*)\n+([\s\S]+?)(?=\n## |\n---)/i);
  if (vtmFreeM) {
    const prose = vtmFreeM[1]
      .split('\n')
      .filter(l => !l.startsWith('|'))
      .join('\n')
      .replace(/\*\*Маскарад:\*\*[^\n]*/g, '')
      .trim();
    if (prose) loc.vtmText = prose;
  }

  // Masquerade from inline bold if not found in table
  if (!loc.masquerade) {
    const maqInline = content.match(/\*\*Маскарад:\*\*\s*([^\n]+)/);
    if (maqInline) loc.masquerade = maqInline[1].trim();
  }

  const maq = loc.masquerade || '';
  loc.masqueradeLevel = maq.includes('🟢') ? 'low' : maq.includes('🟡') ? 'medium' : maq.includes('🔴') ? 'high' : 'unknown';

  // Hooks — emoji, numbering and heading text optional
  const hooksM = content.match(/## (?:🪝\s+)?(?:Сценарные крючки|\d+\s+крючка?|Крючки)[^\n]*\n+([\s\S]+?)(?=\n## |\n---|$)/i);
  loc.hooks = hooksM
    ? (hooksM[1].match(/^\d+\..+$/gm) || []).map(h => h.replace(/^\d+\.\s*/, '').trim())
    : [];

  // Key points table (## Ключевые точки...)
  const keyM = content.match(/## (?:🗺️\s+)?Ключевые точки[^\n]*\n+([\s\S]+?)(?=\n## |\n---|$)/i);
  if (keyM) {
    loc.keyPoints = (keyM[1].match(/^\|[^|\n]+\|[^|\n]+\|/gm) || [])
      .filter(r => !r.match(/[-]{3}/) && !r.match(/^\|\s*\*?\*?(?:Место|Place|Параметр)\*?\*?\s*\|/i))
      .map(r => {
        const cells = r.split('|').slice(1, -1).map(c => c.replace(/\*\*/g, '').trim());
        return { place: cells[0], desc: cells[1] };
      })
      .filter(r => r.place);
  } else {
    loc.keyPoints = [];
  }

  // Image prompts (handles both card formats — see readPrompt)
  const imgPM = readPrompt(content, 'image');
  if (imgPM !== undefined) loc.imagePrompt = imgPM;
  const negPM = readPrompt(content, 'negative');
  if (negPM !== undefined) loc.negativePrompt = negPM;

  return loc;
}

module.exports = { parseLocation };
