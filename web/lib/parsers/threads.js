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

module.exports = { threadStatusKey, parseThreadsContent };
