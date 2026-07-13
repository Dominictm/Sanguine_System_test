'use strict';
// archive/open_threads.md parsing. Extracted from parsers.js during
// the 2026-07-12 decomposition. Sole consumer: web/routes/threads.js.

// ── Threads ────────────────────────────────────────────────────────────────────
/**
 * @param {string} cell — ячейка таблицы open_threads.md с эмодзи-статусом
 * @returns {'active'|'background'|'closed'|'abandoned'|'unknown'}
 */
function threadStatusKey(cell) {
  return cell.includes('🔴') ? 'active'
       : cell.includes('🟡') ? 'background'
       : cell.includes('🟢') ? 'closed'
       : cell.includes('⚫') ? 'abandoned' : 'unknown';
}

/**
 * Разбирает одну таблицу open_threads.md.
 * @param {string} content — содержимое файла
 * @param {string} file — city-relative путь источника (проставляется в каждую строку)
 * @returns {{id: number, title: string, description: string, source: string, status: string, priority: string, file: string}[]}
 */
function parseThreadsContent(content, file) {
  const out = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*\*\*([^*]+)\*\*(.*?)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
    if (!m) continue;
    out.push({
      id:          parseInt(m[1]),
      title:       m[2].trim(),
      description: m[3].replace(/^[\s—-]+/, '').trim(),
      source:      m[4].trim(),
      status:      threadStatusKey(m[5]),
      priority:    m[6].replace(/\|?\s*$/, '').trim(),
      file,
    });
  }
  return out;
}

// ── Игровая дата источника нити ────────────────────────────────────────────────
// Колонка «Источник» обычно кончается игровой датой упоминания
// («Кошки и мышки», ноябрь 2010). Стемы отсортированы по убыванию длины,
// чтобы матч был однозначным («сент» раньше «сен»).
const RU_MONTH_STEMS = [
  ['сент', 9], ['нояб', 11], ['март', 3],
  ['янв', 1], ['фев', 2], ['мар', 3], ['апр', 4], ['мая', 5], ['май', 5],
  ['июн', 6], ['июл', 7], ['авг', 8], ['сен', 9], ['окт', 10], ['ноя', 11], ['дек', 12],
];

/**
 * Последняя пара «месяц год» в тексте источника нити.
 * @param {string} source — ячейка «Источник» из open_threads.md
 * @returns {{year: number, month: number} | null}
 */
function threadSourceDate(source) {
  let last = null;
  const re = /([а-яё]+)\s+(\d{4})/gi;
  let m;
  while ((m = re.exec(source || '')) !== null) {
    const word = m[1].toLowerCase();
    const hit = RU_MONTH_STEMS.find(([stem]) => word.startsWith(stem));
    if (hit) last = { year: parseInt(m[2]), month: hit[1] };
  }
  return last;
}

module.exports = { threadStatusKey, parseThreadsContent, threadSourceDate };
