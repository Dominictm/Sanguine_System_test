'use strict';
// Pure helpers shared between server.js and the test suite.
// No file I/O, no Express — just string parsing and formatting.

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
function slugify(s) {
  return String(s == null ? '' : s).toLowerCase()
    // Cyrillic first (NFKD would split й→и+◌̆ and corrupt it), then fold Latin diacritics.
    .split('').map(c => CYRILLIC_TR[c] !== undefined ? CYRILLIC_TR[c] : c).join('')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split('').map(c => LATIN_TR[c] !== undefined ? LATIN_TR[c] : c).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
}

// ── city.md ──────────────────────────────────────────────────────────────────
// Single source of truth for the city.md section layout, shared by tools/new_city.js,
// POST/PUT /api/cities and the edit form. Order = order rendered in the file.
const CITY_SECTIONS = [
  ['political',  'Политический ландшафт'],
  ['factions',   'Фракции'],
  ['locations',  'Ключевые локации'],
  ['leitmotif',  'Лейтмотивы и атмосфера'],
  ['specifics',  'Специфика ответа'],
  ['avoid',      'Чего избегать'],
  ['sources',    'Источники'],
];

// Multi-line textarea → markdown bullet list; empty → placeholder.
function _citySection(txt) {
  const lines = String(txt == null ? '' : txt).split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length ? lines.map(l => l.startsWith('-') ? l : `- ${l}`).join('\n') : '- …';
}

const CITY_DEFAULT_DESCRIPTION = 'Опиши здесь свой домен — то, с чем сверяется Рассказчик перед сценой (см. CLAUDE.md → «Активный город»).';

// Build city.md from form fields: { display, year, description, political, locations, leitmotif, specifics, avoid, sources }
function buildCityMd(fields = {}) {
  const display     = String(fields.display || '').trim() || 'Город';
  const year        = String(fields.year || '').trim() || '20XX';
  const description = String(fields.description || '').trim() || CITY_DEFAULT_DESCRIPTION;
  const body = CITY_SECTIONS.map(([key, heading]) => `## ${heading}\n${_citySection(fields[key])}`).join('\n\n');
  return `# ${display}, ${year} — сеттинг города

${description}

${body}
`;
}

// Parse city.md back into { display, year, description, sections:{...} } for the edit form
// and for robust display/year labels (no longer dependent on the exact H1 suffix matching).
function parseCityMd(raw) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  let display = '', year = '';
  const hm = text.match(/^#\s+(.+?)\s*$/m);
  if (hm) {
    const h1 = hm[1].replace(/\s*—\s*сеттинг города\s*$/i, '').trim();
    const m2 = h1.match(/^(.*?),\s*([^,]+?)\s*$/);
    if (m2) { display = m2[1].trim(); year = m2[2].trim(); }
    else display = h1;
  }
  // Текст между заголовком H1 и первой секцией "##" — общее описание/сеттинг города.
  let description = '';
  if (hm) {
    const afterH1 = text.slice(hm.index + hm[0].length);
    const firstHeadingIdx = afterH1.search(/^##\s+/m);
    const introRaw = firstHeadingIdx === -1 ? afterH1 : afterH1.slice(0, firstHeadingIdx);
    description = introRaw.split('\n').map(l => l.replace(/^>\s?/, '')).join('\n').trim();
  }
  const headingToKey = new Map(CITY_SECTIONS.map(([k, h]) => [h.toLowerCase(), k]));
  const sections = {};
  for (const part of text.split(/^##\s+/m).slice(1)) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase();
    const key = headingToKey.get(heading);
    if (!key) continue;
    const bodyTxt = nl === -1 ? '' : part.slice(nl + 1);
    sections[key] = bodyTxt.split('\n').map(l => l.replace(/^\s*-\s?/, '').trim())
      .filter(l => l && l !== '…').join('\n');
  }
  return { display, year, description, sections };
}

// Полный каркас нового города — ЕДИНЫЙ источник для POST /api/cities и tools/new_city.js.
// Чистая функция: только строит данные (содержимое файлов + список пустых папок под
// .gitkeep). Сам ввод-вывод делают вызывающие (атомарная запись в сервере, синхронная
// в CLI). До выноса оба пути хардкодили эти шаблоны по отдельности и успели разойтись
// (в visitors.md) — теперь источник один. Принимает те же поля, что buildCityMd, плюс
// districts (CSV-строка или массив).
function cityScaffold(fields = {}) {
  const display   = String(fields.display || '').trim() || 'Город';
  const year      = String(fields.year || '').trim() || '20XX';
  const districts = (Array.isArray(fields.districts)
    ? fields.districts
    : String(fields.districts || '').split(','))
    .map(d => String(d).trim()).filter(Boolean);

  const files = {
    'city.md': buildCityMd(fields),
    'archive/events.md':
`# 📖 Хроника «${display}» — События

> 🔗 Все персонажи — [characters_index.md](characters_index.md)
> 🔗 Протокол записей — [chronicle.md](../../../system/rules/chronicle.md)

---

## 🌍 Состояние мира

> Обновляется после каждой сессии.
> Последнее обновление: **—**.

---

## 📋 Сводная хроника событий

> Агрегат из \`chronicles/<хроника>/events.md\`. Индекс генерируется \`tools/build_city_events.js\` — вручную не править.

<!-- AUTO:events-index -->
<!-- /AUTO:events-index -->
`,
    'archive/political_state.md':
`# Карта фракций — ${display}, ${year}

> Шаблон. Кто контролирует домен, иерархия, ключевые NPC, конфликты.

| Должность | Персонаж | Клан | Примечание |
|---|---|---|---|
|  |  |  |  |
`,
    'archive/characters_index.md':
`# Персонажи — ${display}

> Сводник. Добавляется при создании карточек (по \`system/rules/npcs_city.md\`).
`,
    'archive/visitors.md':
`# Гости из других городов — ${display}

> Персонажи с \`Родной город\` ≠ ${display}, присутствующие здесь. Только ссылки —
> карточка-источник живёт в родном городе (один источник истины).

| Персонаж | Родной город | Появление |
|---|---|---|
|  |  |  |
`,
  };

  files['chronicles/sluchaynye_sobytiya/chronicle.md'] =
`# 📂 Случайные события

| **Статус:** | 🟡 Активна |
| **Скрыта** | да |

> Хроника для случайных/фоновых событий города. Не отображается в индексе хроник.
`;
  files['chronicles/sluchaynye_sobytiya/events.md'] =
`# Случайные события — События

`;

  const keepDirs = [
    ...['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters'].map(l => `characters/${l}`),
    'chronicles',
    'chronicles/sluchaynye_sobytiya/modules',
    'rules',
  ];
  if (districts.length) {
    // Дедуп по итоговому слагу: два района с одинаковым именем (или дающие один слаг)
    // не создают дублирующих папок. Оставшиеся нумеруются подряд district_01, 02…
    const seen = new Set();
    districts.forEach((d, i) => {
      const dslug = slugify(d) || `rayon_${String(i + 1).padStart(2, '0')}`;
      if (seen.has(dslug)) return;
      seen.add(dslug);
      keepDirs.push(`locations/district_${String(seen.size).padStart(2, '0')}/${dslug}`);
    });
    if (!seen.size) keepDirs.push('locations');
  } else {
    keepDirs.push('locations');
  }

  return { files, keepDirs };
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

// ── Diary parser ─────────────────────────────────────────────────────────────
// Single diary file → structured object. Two layouts:
//   • 'entry'         — one record (author/location/tone/text/crossRefs)
//   • 'retrospective' — several dated ### 📅 sections
function parseDiary(rawContent) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const d = {};

  const hm = content.match(/^#\s+(.+)$/m);
  if (hm) d.title = hm[1].trim();

  const sectionMatches = [...content.matchAll(/^###\s+📅\s+(.+)$/gm)];

  if (sectionMatches.length > 1) {
    d.format = 'retrospective';
    d.sections = sectionMatches.map((m, i) => {
      const title = m[1].trim();
      const bodyStart = m.index + m[0].length;
      const bodyEnd = i + 1 < sectionMatches.length ? sectionMatches[i + 1].index : content.length;
      const body = content.slice(bodyStart, bodyEnd).replace(/(\n---+)+\s*$/, '').trim();
      return { title, body };
    });
  } else {
    d.format = 'entry';
    if (sectionMatches.length === 1) d.session = sectionMatches[0][1].trim();

    for (const [label, key] of [
      ['👤 Автор',     'author'],
      ['📍 Локация',   'location'],
      ['🎭 Тон\\/Стиль', 'tone'],
    ]) {
      const m = content.match(new RegExp(`- \\*\\*${label}:\\*\\*\\s*(.+)$`, 'm'));
      if (m) d[key] = m[1].trim();
    }

    const textM = content.match(/- \*\*📖 Текст записи:\*\*\n([\s\S]+?)(?=\n- \*\*[🔗📝👁]|$)/);
    if (textM) d.text = textM[1].replace(/^[ \t]{1,2}/gm, '').trim();

    const crossM = content.match(/- \*\*🔗 Зеркальная ссылка:\*\*\n([\s\S]+?)(?=\n- \*\*[📝👁]|\n---|$)/);
    if (crossM) {
      d.crossRefs = crossM[1].split('\n')
        .filter(l => /^\s+-/.test(l))
        .map(l => l.replace(/^\s+-\s*/, '').trim())
        .filter(Boolean);
    }
  }

  return d;
}

// ── Markdown link helpers ────────────────────────────────────────────────────
function mdExtractLinks(s) {
  const out = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ text: m[1].trim(), href: m[2].trim() });
  return out;
}
function mdStripLinks(s) { return s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); }
function mdStripInline(s) { return mdStripLinks(s).replace(/\*\*/g, '').replace(/^\s*[-•]\s*/, '').trim(); }

function classifyChronicleLink({ text, href }) {
  const t = text.toLowerCase();
  let kind = 'other';
  if (t.includes('инал'))                       kind = 'finale';
  else if (t.includes('одул'))                  kind = 'module';
  else if (t.includes('нпс') || t.includes('npc')) kind = 'npc';
  // Module folder name = first path segment after modules/
  let module = null;
  const mm = href.match(/modules\/([^/]+)\//);
  if (mm) module = decodeURIComponent(mm[1]);
  return { text, href, kind, module };
}

// ── Relationship categoriser ─────────────────────────────────────────────────
function categorizeRel(desc) {
  const d = desc.toLowerCase();
  if (/сестр|брат|мать|отец|семь|родств|племян/.test(d)) return 'family';
  if (/сир|создал|обратил|обратила/.test(d))              return 'sire';
  if (/чайлд|потомок/.test(d))                            return 'childe';
  if (/враг|ненавид|угроз|конфликт|противн/.test(d))      return 'enemy';
  if (/союзник|друг|доверя|помощ|поддерж/.test(d))        return 'ally';
  if (/любов|романт|привязан|влюбл/.test(d))              return 'romantic';
  if (/подозр|осторожн|насторож/.test(d))                 return 'suspicious';
  if (/лояльн|предан|служ|свита/.test(d))                 return 'loyalty';
  if (/тайн|секрет|скрыт|негласн|подпольн/.test(d))       return 'secret';
  if (/знаком|приятел|контакт|встреч/.test(d))            return 'acquaintance';
  return 'neutral';
}

// ── Character card parser ────────────────────────────────────────────────────
function parseCharacter(rawContent, folderName, lineage) {
  const content = rawContent.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const c = { name: folderName, lineage, relationships: [] };

  // Name from # header (strip leading emoji / whitespace)
  const hm = content.match(/^#\s+[^\wЀ-ӿ]*([\wЀ-ӿ].+)$/m);
  if (hm) c.name = hm[1].trim();

  // Key-value fields:  - **Поле:** Значение
  const fRe = /^- \*\*([^*:\n]+):\*\*\s*(.+)$/gm;
  let m;
  while ((m = fRe.exec(content)) !== null) {
    const k = m[1].trim();
    const v = m[2].trim();
    if (k === 'Клан')         c.clan         = v;
    if (k === 'Секта')        c.sect         = v;
    if (k === 'Поколение')    c.generation   = v;
    if (k === 'Статус')                         c.status        = v;
    if (k === 'Детали статуса')                 c.statusDetails = v;
    if (k === 'Линейка WoD')                    c.lineageLabel  = v;
    if (k === 'Пол')                            c.gender        = v;
    if (k === 'Роль')                           c.role          = v;
    if (k === 'Год обращения')                  c.embraceYear   = v;
    if (k === 'Сир')                            c.sire          = v;
    if (k === 'Год рождения')                   c.birthYear     = v;
    if (k === 'Биография')                      c.biography     = v;
    if (k === 'Голос')                          c.voice         = v;
    if (k === 'Характер')                       c.personality   = v;
    if (k === 'Внешность')                      c.appearance    = v;
    if (k === 'Натура')                         c.nature        = v;
    if (k === 'Маска')                          c.demeanor      = v;
    if (k === 'Амплуа')                         c.concept       = v;
    if (k === 'Дитя')                           c.childe        = v;
    if (k === 'Домен / Локация')                c.location      = v;
    if (/иерархи/i.test(k))                     c.hierarchy     = v;   // «Иерархия в городе» / устар. варианты
    if (k === 'Деранжементы / Особенности')     c.derangements  = v;
    if (k === 'Дисциплины')                     c.disciplines   = v;
    if (k === 'Профессия')                      c.profession    = v;
    if (k === 'Клан / Раса' && !c.clan)         c.clan          = v;
    if (k === 'Род' && !c.clan)                 c.clan          = v;
    if (k === 'Секта / Двор' && !c.sect)        c.sect          = v;
    if (k === 'Фригольд / Локация' && !c.location) c.location  = v;
    if (k === 'Фригольд' && !c.location)        c.location      = v;
    if (k === 'Принадлежность')                 c.belonging     = v;
    if (k === 'Присутствие')                    c.presence      = v;   // появления в других городах
    if (k === 'Алиасы')                         c.aliases       = v;
    // ── Линейко-специфичные поля (феи/смертные/иное) ──
    if (k === 'Раса')                           c.race          = v;   // фейри: кит/раса
    if (k === 'Род')                            c.kith          = v;   // фейри: род (отд. от clan-fallback выше)
    if (k === 'Двор')                           c.court         = v;   // фейри: Сияющий/Сумрачный/Теневой двор
    if (k === 'Титул')                          c.title         = v;
    if (k === 'Особенности / Способности')      c.features      = v;
    if (k === 'Родственники')                   c.relatives     = v;   // смертные
    if (k === 'Отношение к сверхъестественному') c.attitude     = v;   // смертные
  }

  // Diary links: - **📖 Дневники:** [Title](path.md)
  const diaryField = content.match(/- \*\*📖 Дневники:\*\*\s*(.+)$/m);
  if (diaryField) {
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    c.diaries = [];
    let lm;
    while ((lm = linkRe.exec(diaryField[1])) !== null) {
      c.diaries.push({ title: lm[1], file: lm[2] });
    }
  } else {
    c.diaries = [];
  }

  // Image prompts (handles both card formats — see readPrompt)
  const imgP = readPrompt(content, 'image');
  if (imgP !== undefined) c.imagePrompt = imgP;
  const negP = readPrompt(content, 'negative');
  if (negP !== undefined) c.negativePrompt = negP;

  // Relationships section (indented sub-bullets after **Отношения:**)
  const relBlock = content.match(/- \*\*Отношения:\*\*\n((?:[ \t]+- .+\n?)+)/);
  if (relBlock) {
    const lines = relBlock[1].split('\n').filter(l => /^\s+-/.test(l));
    for (const line of lines) {
      const clean = line.trim().replace(/^-\s*/, '');
      const dash  = clean.indexOf(' — ');
      if (dash === -1) continue;
      const targets = clean.slice(0, dash).split(',')
        .map(t => t.trim().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim())
        .filter(Boolean);
      const desc = clean.slice(dash + 3).trim();
      for (const tgt of targets) {
        c.relationships.push({ target: tgt, description: desc, type: categorizeRel(desc) });
      }
    }
  }

  // Lineage normalisation
  if (!c.lineage) {
    const ll = (c.lineageLabel || '').toLowerCase();
    if      (ll.includes('вампир'))                     c.lineage = 'vampire';
    else if (ll.includes('фея') || ll.includes('ченджлинг')) c.lineage = 'fairy';
    else if (ll.includes('смертн') || ll.includes('человек')) c.lineage = 'mortal';
    else if (ll.includes('оборот'))                     c.lineage = 'werewolf';
    else if (ll.includes('маг'))                        c.lineage = 'mage';
    else if (ll.includes('охотник'))                    c.lineage = 'hunter';
    else                                                c.lineage = 'unknown';
  }

  // Status type
  const sl = (c.status || '').toLowerCase();
  c.statusType = (sl.includes('жив') || sl.includes('жива') || sl.includes('активен') || sl.includes('активна')) ? 'active'
    : sl.includes('торпор') ? 'torpor'
    : (sl.includes('мёртв') || sl.includes('мертва') || sl.includes('погиб') || sl.includes('уничтожен') || sl.includes('убит')) ? 'dead'
    : sl.includes('пропал') ? 'missing'
    : sl.includes('неизвестно') ? 'unknown'
    : 'unknown';

  return c;
}

// ── Location card parser ─────────────────────────────────────────────────────
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
  const keyM = content.match(/## (?:Ключевые точки[^\n]*)\n+([\s\S]+?)(?=\n## |\n---|$)/i);
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

// ── Chronicle (events.md) parsers ────────────────────────────────────────────
// Extract clickable location links (those pointing into locations/) + plain text
function parseChronicleLocation(rest) {
  const links = mdExtractLinks(rest)
    .filter(l => /locations\//.test(l.href))
    .map(l => {
      const base = l.href.split('/').pop().replace(/\.md$/i, '');
      return { text: l.text, slug: decodeURIComponent(base) };
    });
  return { text: mdStripLinks(rest).trim(), links };
}

// Participant sub-bullet → { text, name } where name is leading identity for matching
function parseParticipant(line) {
  const clean = mdStripLinks(line.replace(/^\s*-\s*/, '')).replace(/\*\*/g, '').trim();
  // Name = leading text before first " (", " — " or " →"
  const name = clean.split(/\s+\(|\s+—\s+|\s+→\s+/)[0].trim();
  return { text: clean, name };
}

function parseTable(lines) {
  const rowLines = lines.filter(l => /^\s*\|/.test(l));
  if (rowLines.length < 2) return null;
  const parseRow = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => mdStripLinks(c).replace(/\*\*/g, '').trim());
  const headers = parseRow(rowLines[0]);
  const body = rowLines.slice(2).map(parseRow);   // skip separator row
  return { headers, rows: body };
}

function parseWorldState(block) {
  const ws = { lastUpdate: null, sections: [] };
  const lu = block.match(/Последнее обновление:\s*\*\*([^*]+)\*\*/);
  if (lu) ws.lastUpdate = lu[1].trim();

  for (const part of block.split(/\n(?=###\s)/)) {
    const lines = part.split('\n');
    if (!/^###\s/.test(lines[0])) continue;
    const heading = lines[0].replace(/^###\s*/, '').trim();
    const body = lines.slice(1);
    const table = parseTable(body);
    const prose = body
      .map(l => l.trim())
      .filter(l => l && !/^\|/.test(l) && !/^---+$/.test(l) && !/^>/.test(l))
      .map(mdStripLinks);
    ws.sections.push({ heading, table, prose });
  }
  return ws;
}

function parseEvent(chunk, id) {
  const lines = chunk.split('\n');
  const ev = {
    id, parallel: null, location: { text: '', links: [] },
    participants: [], eventsText: '', consequences: [], worldChanges: [], links: []
  };
  ev.heading = lines[0].replace(/^###\s*📅\s*/, '').trim();
  const dash = ev.heading.indexOf(' — ');
  ev.date  = dash !== -1 ? ev.heading.slice(0, dash).trim() : ev.heading;
  // После даты заголовок имеет вид "[краткая локация]. [Название]." Первое предложение —
  // локация (дублирует поле 📍 ниже), остальное — название. Если предложение одно
  // (напр. у записей, созданных логгером) — это и есть название.
  const afterDash = dash !== -1 ? ev.heading.slice(dash + 3).trim() : '';
  const sentences = afterDash.split('. ');
  ev.title = (sentences.length > 1 ? sentences.slice(1).join('. ') : afterDash).replace(/\.\s*$/, '').trim();

  let field = null;
  const proseBuf = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (/^>\s*🔗/.test(t)) { mdExtractLinks(t).forEach(l => ev.links.push(classifyChronicleLink(l))); continue; }
    if (/^>\s*⚡/.test(t)) { const m = t.match(/\*(.+?)\*/); ev.parallel = m ? m[1].trim() : t.replace(/^>\s*⚡\s*/, '').trim(); continue; }

    const fm = t.match(/^-\s*\*\*([^:]+):\*\*\s*(.*)$/);
    if (fm && /📍|👥|📋|⚖️|🌍/.test(fm[1])) {
      const lbl = fm[1], rest = fm[2];
      if      (lbl.includes('📍')) { field = 'location';     const pl = parseChronicleLocation(rest); ev.location = pl; }
      else if (lbl.includes('👥')) { field = 'participants'; }
      else if (lbl.includes('📋')) { field = 'events';       if (rest) proseBuf.push(rest); }
      else if (lbl.includes('⚖️')) { field = 'consequences'; }
      else if (lbl.includes('🌍')) { field = 'worldChanges'; }
      continue;
    }

    if      (field === 'participants' && /^-\s+/.test(t)) ev.participants.push(parseParticipant(t));
    else if (field === 'consequences' && /^-\s+/.test(t)) ev.consequences.push(mdStripInline(t));
    else if (field === 'worldChanges' && /^-\s+/.test(t)) ev.worldChanges.push(mdStripInline(t));
    else if (field === 'events')                          proseBuf.push(raw);
    else if (field === 'location' && t && !/^-/.test(t))  ev.location.text += ' ' + mdStripLinks(t).trim();
  }
  ev.eventsText = proseBuf.join('\n').trim();
  return ev;
}

function parseChronicle(raw) {
  const content = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const hm = content.match(/^#\s+(.+)$/m);
  const title = hm ? hm[1].replace(/[*#]/g, '').trim() : 'Хроника';

  // World state block: between "## 🌍 Состояние мира" and "## 📋 Хроника событий"
  let worldState = null;
  const wsM = content.match(/##\s*🌍[^\n]*\n([\s\S]*?)(?=\n##\s)/);
  if (wsM) worldState = parseWorldState(wsM[1]);

  // Events block: after "## 📋 Хроника событий"
  const events = [];
  const evBlockM = content.match(/##\s*📋[^\n]*\n([\s\S]*)$/);
  if (evBlockM) {
    const chunks = evBlockM[1].split(/\n(?=###\s*📅)/).filter(c => /^###\s*📅/.test(c.trim()));
    chunks.forEach((c, i) => events.push(parseEvent(c.trim(), i)));
  }

  return { title, worldState, events };
}

// Collect participant display-names from a chronicle's events.md text.
function parseChronicleParticipants(eventsText) {
  const names = new Set();
  let inPart = false;
  for (const line of eventsText.split('\n')) {
    if (/👥\s*Участники/i.test(line)) { inPart = true; continue; }
    if (inPart) {
      if (/^\s*-\s+/.test(line)) {
        // "  - Имя Фамилия (Клан, ...) — роль" — extract before first ( or —
        const raw = line.replace(/^\s*-\s+/, '').split(/[\(—\/]/)[0].trim();
        if (raw && !/без имён|безымянн/i.test(raw)) names.add(raw);
      } else if (!/^\s*$/.test(line) && !/^\s{2,}/.test(line)) {
        inPart = false;
      }
    }
  }
  return [...names];
}

module.exports = {
  RU_MONTHS_NOM,
  THREAD_STATUS,
  CYRILLIC_TR,
  LATIN_TR,
  slugify,
  CITY_SECTIONS,
  buildCityMd,
  parseCityMd,
  cityScaffold,
  parseDiary,
  readPrompt,
  writePrompt,
  periodLabel,
  threadStatusKey,
  parseThreadsContent,
  // markdown helpers
  mdExtractLinks,
  mdStripLinks,
  mdStripInline,
  classifyChronicleLink,
  // card & chronicle parsers
  categorizeRel,
  parseCharacter,
  parseLocation,
  parseChronicleLocation,
  parseParticipant,
  parseTable,
  parseWorldState,
  parseEvent,
  parseChronicle,
  parseChronicleParticipants,
};
