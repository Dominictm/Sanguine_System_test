'use strict';
// Cross-domain helpers used by 3+ parser domains (city/character/location/
// chronicle/threads) -- extracted from parsers.js during the 2026-07-12
// decomposition (docs/audit/2026-07-12-project-status-report.md).

const RU_MONTHS_NOM = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

// ── Slug generation ──────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for RU→ASCII folder slugs across server.js, tools/*.js
// and the test suite. The browser copy in public/scripts.js must mirror
// CYRILLIC_TR exactly — a unit test enforces that parity.
const CYRILLIC_TR = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',
  л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',
  ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
};
// Latin letters that DON'T decompose under NFKD (so the diacritic strip can't reach
// them) — folded explicitly so international city names slug cleanly (Düsseldorf→
// dusseldorf, Şanlıurfa→sanliurfa, Malmö→malmo). Mirrored in scripts.js (_LATIN_TR).
const LATIN_TR = { ø:'o', ł:'l', đ:'d', ı:'i', ß:'ss', æ:'ae', œ:'oe', þ:'th', ð:'d' };
/**
 * @param {string} s — произвольная строка (кириллица/латиница/эмодзи)
 * @returns {string} ASCII-слаг: только `[a-z0-9_]`, без ведущих/двойных `_`
 */
function slugify(s) {
  return String(s == null ? '' : s).toLowerCase()
    // Cyrillic first (NFKD would split й→и+◌̆ and corrupt it), then fold Latin diacritics.
    .split('').map(c => CYRILLIC_TR[c] !== undefined ? CYRILLIC_TR[c] : c).join('')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split('').map(c => LATIN_TR[c] !== undefined ? LATIN_TR[c] : c).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
}

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
/**
 * @param {string} content — Markdown карточки (персонаж или локация)
 * @param {'image'|'negative'} which — какой из двух промтов читать
 * @returns {string|undefined} текст промта, либо undefined если секция отсутствует
 */
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

/**
 * @param {string} card — исходный Markdown карточки
 * @param {'image'|'negative'} which — какой промт записать
 * @param {string} rawValue — новый текст промта
 * @param {'fenced'|'indented'} format — layout карточки (locations → 'fenced', characters → 'indented')
 * @returns {string} обновлённый Markdown карточки (существующая секция заменена, либо вставлена новая)
 */
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

  // Block absent → insert a fresh bullet (mirrors 'fenced' behaviour, which also appends).
  // Place it just before the trailing "--- / ## 🖼️ Изображения" block; else append at end.
  const bulletLabel = which === 'negative'
    ? '- **🚫 Негативный промт:**'
    : '- **🎨 Промт для генерации изображения:**';
  const block = `${bulletLabel}\n${indented}\n`;
  const tail  = card.match(/\n+---\s*\n+##\s+🖼/);
  if (tail) return card.slice(0, tail.index) + '\n' + block + card.slice(tail.index);
  return card.replace(/\s*$/, '\n') + block;
}

// ── Dates / periods ────────────────────────────────────────────────────────────
/**
 * @param {string} period — `'ГГГГ-ММ'` (имя файла дневника) или `'retrospective'`
 * @returns {string} читаемая метка на русском («Март 2010», «Ретроспектива») — либо исходная строка как есть
 */
function periodLabel(period) {
  const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (m) return `${RU_MONTHS_NOM[parseInt(m[2]) - 1] || m[2]} ${m[1]}`;
  if (period === 'retrospective') return 'Ретроспектива';
  return String(period || '');
}

// ── Markdown link helpers ────────────────────────────────────────────────────
/** @param {string} s @returns {{text: string, href: string}[]} все `[text](href)` в строке */
function mdExtractLinks(s) {
  const out = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ text: m[1].trim(), href: m[2].trim() });
  return out;
}
/** @param {string} s @returns {string} тот же текст, но `[text](href)` → `text` */
function mdStripLinks(s) { return s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); }
/** @param {string} s @returns {string} без ссылок, `**bold**`, ведущего маркера списка */
function mdStripInline(s) { return mdStripLinks(s).replace(/\*\*/g, '').replace(/^\s*[-•]\s*/, '').trim(); }

module.exports = {
  RU_MONTHS_NOM, CYRILLIC_TR, LATIN_TR, slugify,
  THREAD_STATUS, readPrompt, writePrompt, periodLabel,
  mdExtractLinks, mdStripLinks, mdStripInline,
};
