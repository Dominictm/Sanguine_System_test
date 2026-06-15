'use strict';
// Pure helpers shared between server.js and the test suite.
// No file I/O, no Express — just string parsing and formatting.

const RU_MONTHS_NOM = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

// Thread status display strings keyed by slug
const THREAD_STATUS = {
  active:     '🔴 Активна',
  background: '🟡 Фоновая',
  closed:     '🟢 Закрыта',
  abandoned:  '⚫ Заброшена',
};

// ── Image prompts ──────────────────────────────────────────────────────────────
// Two canonical layouts in VTM cards:
//   A) "indented"  — character cards: bullet label + indented continuation lines
//        - **🎨 Промт для генерации изображения:**
//          [Блок] …
//        - **🚫 Негативный промт:**
//          …
//   B) "fenced"    — location cards: bold label + ``` code block
//        **GPT / DALL-E 3:**
//        ```
//        …
//        ```
//        **Негативный промт (SD / Flux):**
//        ```
//        …
//        ```
// `which` ∈ 'image' | 'negative'
function readPrompt(content, which) {
  // Format B (fenced) — absent in character cards (no code fences there)
  const fenceLabel = which === 'negative' ? 'Негативный промт' : 'GPT';
  const fenced = content.match(
    new RegExp('\\*\\*' + fenceLabel + '[^*\\n]*\\*\\*[:\\s]*\\n```[^\\n]*\\n([\\s\\S]+?)\\n```')
  );
  if (fenced) return fenced[1].trim();

  // Format A (indented bullet block)
  const bulletLabel = which === 'negative' ? 'Негативный промт' : 'Промт для генерации';
  const indented = content.match(
    new RegExp('- \\*\\*[^*]*' + bulletLabel + '[^*]*\\*\\*[^\\n]*\\n((?:[ \\t]+[^\\n]+\\n?)+)')
  );
  if (indented) return indented[1].replace(/^[ \t]+/gm, '').trim();
  return undefined;
}

function writePrompt(card, which, rawValue, format) {
  const value = String(rawValue).trim();
  if (format === 'fenced') {
    const label = which === 'negative' ? 'Негативный промт' : 'GPT';
    const re = new RegExp('(\\*\\*' + label + '[^*\\n]*\\*\\*[:\\s]*\\n```[^\\n]*\\n)([\\s\\S]+?)(\\n```)');
    if (re.test(card)) return card.replace(re, (_, pre, _old, post) => `${pre}${value}${post}`);
    if (which === 'negative') {
      const lastFence = card.lastIndexOf('```');
      const block = `\n\n**Негативный промт (SD / Flux):**\n\`\`\`\n${value}\n\`\`\``;
      if (lastFence !== -1) {
        const at = lastFence + 3;
        return card.slice(0, at) + block + card.slice(at);
      }
      return card + block + '\n';
    }
    return card + `\n\n## 🎨 Промт для генерации изображения\n\n**GPT / DALL-E 3:**\n\`\`\`\n${value}\n\`\`\`\n`;
  }
  // format === 'indented' (character cards)
  const label    = which === 'negative' ? 'Негативный промт' : 'Промт для генерации';
  const indented = value.split('\n').map(l => l.trim() ? '  ' + l.trim() : '').join('\n');
  const re = new RegExp('(-\\s*\\*\\*[^*]*' + label + '[^*]*\\*\\*[^\\n]*\\n)((?:[ \\t]+[^\\n]+\\n?)+)');
  if (re.test(card)) return card.replace(re, `$1${indented}\n`);
  return card; // block absent → no-op
}

// ── Dates / periods ────────────────────────────────────────────────────────────
function periodLabel(period) {
  const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (m) return `${RU_MONTHS_NOM[parseInt(m[2]) - 1] || m[2]} ${m[1]}`;
  if (period === 'retrospective') return 'Ретроспектива';
  return String(period || '');
}

// ── Threads ────────────────────────────────────────────────────────────────────
function threadStatusKey(cell) {
  return cell.includes('🔴') ? 'active'
       : cell.includes('🟡') ? 'background'
       : cell.includes('🟢') ? 'closed'
       : cell.includes('⚫') ? 'abandoned' : 'unknown';
}

// Parse one open_threads.md table; tags each row with the city-relative source file.
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

module.exports = {
  RU_MONTHS_NOM,
  THREAD_STATUS,
  readPrompt,
  writePrompt,
  periodLabel,
  threadStatusKey,
  parseThreadsContent,
};
