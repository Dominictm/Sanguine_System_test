'use strict';
// Pure helpers shared between server.js and the test suite.
// No file I/O, no Express — just string parsing and formatting.

const {
  RU_MONTHS_NOM, CYRILLIC_TR, LATIN_TR, slugify,
  THREAD_STATUS, readPrompt, writePrompt, periodLabel,
  mdExtractLinks, mdStripLinks, mdStripInline,
} = require('./parsers/shared');
const {
  CITY_SECTIONS, CITY_DEFAULT_DESCRIPTION, buildCityMd, parseCityMd,
  cityScaffold, parsePoliticalFactions, setPoliticalFactionInfluence,
} = require('./parsers/city');
const { parseDiary, categorizeRel, parseCharacter } = require('./parsers/character');

// ── Scenario sections (scenario.md ## split) ─────────────────────────────────
// Splits a module's scenario.md into independently editable/regenerable blocks
// by top-level `## ` headings. Real generated scenarios don't follow a fixed
// heading list (scene titles vary each time — "Пролог", "Сцена 1 — Метро",
// "Финал — Манеж" …), so this parses by WHATEVER `## ` headings are actually
// present rather than matching a hardcoded set of names.
/**
 * @param {string} raw — содержимое scenario.md
 * @returns {{preamble: string, sections: {heading: string, body: string}[]}}
 *   preamble — всё до первого `## ` (H1-заголовок, хлебные крошки, `---`), не редактируется по разделам
 */
// Разбивает тело `## `-раздела на вводный текст (до первого `### `) и список
// вложенных `### `-подразделов — используется и при первичном парсинге
// (parseScenarioSections), и при пересборке одного блока целиком после его
// AI-перегенерации (см. routes/modules.js scenario/block/regenerate).
function splitH3Body(body) {
  const h3Idx = body.search(/^###\s+/m);
  if (h3Idx === -1) return { intro: body, children: [] };
  const intro = body.slice(0, h3Idx).replace(/\s+$/, '');
  const children = [];
  const h3parts = body.slice(h3Idx).split(/\n(?=###\s+)/);
  for (const h3part of h3parts) {
    const h3nl = h3part.indexOf('\n');
    const heading = (h3nl === -1 ? h3part : h3part.slice(0, h3nl)).replace(/^###\s+/, '').trim();
    let h3body = h3nl === -1 ? '' : h3part.slice(h3nl + 1);
    h3body = h3body.replace(/^\n+/, '').replace(/\s+$/, '');
    children.push({ heading, body: h3body });
  }
  return { intro, children };
}

function parseScenarioSections(raw) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const firstIdx = text.search(/^##\s+/m);
  if (firstIdx === -1) return { preamble: text, sections: [] };

  const preamble = text.slice(0, firstIdx);
  const rest = text.slice(firstIdx);
  const parts = rest.split(/\n(?=##\s+)/);
  const sections = [];
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).replace(/^##\s+/, '').trim();
    let body = nl === -1 ? '' : part.slice(nl + 1);
    // Trailing "---" divider before the NEXT heading belongs to the layout,
    // not to this section's content — strip only if it's the very last thing.
    body = body.replace(/\n+---+\s*$/, '').replace(/^\n+/, '').replace(/\s+$/, '');

    // Some модуль-шаблоны вкладывают отдельные сцены (или, в новом формате,
    // отдельные поля сцены — «Описание для игрока», «Колорит» и т.д.) как
    // `### ` под общим `## `-заголовком — каждая такая единица должна
    // редактироваться/перегенерироваться независимо, поэтому разворачиваем их
    // в отдельные разделы (level 3, с привязкой к родительскому heading).
    const { intro, children } = splitH3Body(body);
    if (children.length) {
      sections.push({ heading, body: intro, level: 2, parent: null });
      for (const c of children) sections.push({ heading: c.heading, body: c.body, level: 3, parent: heading });
    } else {
      sections.push({ heading, body, level: 2, parent: null });
    }
  }
  return { preamble, sections };
}

// Пересобирает preamble + плоский список sections (level 2/3, с parent у
// level-3) обратно в полный текст scenario.md. Используется replaceScenarioSection
// и scenario/block/regenerate — единственное место, знающее формат сборки
// (`---` только между top-level блоками, `### ` дети — без него).
function serializeScenarioSections(preamble, sections) {
  const blocks = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.level === 3) continue; // handled by its parent below
    let block = `## ${s.heading}\n\n${s.body ? s.body + '\n' : ''}`;
    for (let j = i + 1; j < sections.length && sections[j].level === 3 && sections[j].parent === s.heading; j++) {
      block += `\n### ${sections[j].heading}\n\n${sections[j].body}\n`;
    }
    blocks.push(block);
  }
  return preamble.replace(/\n*$/, '\n\n') + blocks.join('\n---\n\n');
}

/**
 * Заменяет содержимое одного раздела (по заголовку, опционально уточнённому
 * родителем — см. дизамбигуацию в scenario/section эндпоинтах) и пересобирает
 * файл целиком.
 * @param {string} raw — содержимое scenario.md
 * @param {string} heading — точный текст заголовка (как в `## <heading>` / `### <heading>`)
 * @param {string} newBody — новое содержимое раздела (без строки заголовка)
 * @param {string|null} [parent] — если указан, ищет раздел ТОЛЬКО среди детей этого родителя
 *   (разные сцены нередко используют одинаковые названия полей — «GM-подсказки»,
 *   «Описание для игрока» — без parent совпадёт первый попавшийся)
 * @returns {string} обновлённый полный текст; если заголовок не найден — возвращает raw без изменений
 */
function replaceScenarioSection(raw, heading, newBody, parent) {
  const { preamble, sections } = parseScenarioSections(raw);
  const idx = findScenarioSectionIndex(sections, heading, parent);
  if (idx === -1) return raw;
  sections[idx] = { ...sections[idx], body: String(newBody == null ? '' : newBody).trim() };
  return serializeScenarioSections(preamble, sections);
}

// Находит индекс раздела по заголовку; если передан parent — совпадение
// должно быть именно среди его детей (см. replaceScenarioSection).
function findScenarioSectionIndex(sections, heading, parent) {
  if (parent != null) {
    const i = sections.findIndex(s => s.heading === heading && s.parent === parent);
    if (i !== -1) return i;
  }
  return sections.findIndex(s => s.heading === heading);
}

/**
 * Батч-версия replaceScenarioSection — применяет несколько замен за один
 * parse/serialize проход (одна файловая запись вместо N) для кнопки
 * «Сохранить всё» на блоке сценария.
 * @param {string} raw
 * @param {{heading:string, parent?:string, body:string}[]} replacements
 * @returns {{ text: string, skipped: string[] }} skipped — заголовки, для которых раздел не найден
 */
function replaceScenarioSections(raw, replacements) {
  const { preamble, sections } = parseScenarioSections(raw);
  const skipped = [];
  for (const r of replacements) {
    const idx = findScenarioSectionIndex(sections, r.heading, r.parent);
    if (idx === -1) { skipped.push(r.heading); continue; }
    sections[idx] = { ...sections[idx], body: String(r.body == null ? '' : r.body).trim() };
  }
  return { text: serializeScenarioSections(preamble, sections), skipped };
}

// Метка «сценарий был изменён вручную (добавлена своя сцена)» — живёт в
// preamble scenario.md (до первого `## `, значит никогда не рендерится в
// самой вкладке «Сценарий» — см. _renderScenarioPanel). Снимается точечно
// при перегенерации блока «Финал» (routes/modules.js scenario/block/regenerate).
const SCENE_ADDED_MARKER_RE = /\n?<!--\s*meta:sceneAdded:\s*1\s*-->\n?/i;

// Проверяет, является ли заголовок блока «Финал» (в т.ч. с подзаголовком —
// «Финал — Название»), а не просто словом, начинающимся на «Финал»
// («Финальная сцена», «Финал пролога» и т.п. — не совпадают).
function isFinaleHeading(heading) {
  return /^Финал(?:\s*[—–:.-].*)?$/i.test(heading);
}

function hasManualSceneMarker(raw) {
  return SCENE_ADDED_MARKER_RE.test(raw);
}

function addManualSceneMarker(raw) {
  if (hasManualSceneMarker(raw)) return raw;
  const firstHeadingIdx = raw.search(/^##\s+/m);
  if (firstHeadingIdx === -1) return raw.replace(/\n*$/, '\n') + '<!-- meta:sceneAdded: 1 -->\n';
  return raw.slice(0, firstHeadingIdx) + '<!-- meta:sceneAdded: 1 -->\n' + raw.slice(firstHeadingIdx);
}

function clearManualSceneMarker(raw) {
  return raw.replace(SCENE_ADDED_MARKER_RE, '\n');
}

/**
 * Добавляет пустую сцену «## Сцена N[ — title]» перед блоком «Финал» (или в
 * конец документа, если «Финал» нет), с двумя заготовленными полями внутри.
 * Номер сцены — на 1 больше максимального среди уже существующих «Сцена N».
 * Ставит метку hasManualSceneMarker (см. выше) — используется UI, чтобы
 * предложить перегенерировать «Финал» под новую сцену.
 * @param {string} raw
 * @param {string} [title] — необязательный подзаголовок сцены («Сцена N — <title>»)
 * @returns {{ text: string, heading: string }} heading — точный заголовок вставленной сцены
 */
function insertScenarioScene(raw, title) {
  const { preamble, sections } = parseScenarioSections(raw);
  const nums = sections
    .filter(s => s.level === 2)
    .map(s => parseInt((s.heading.match(/^Сцена\s*(\d+)/i) || [])[1], 10))
    .filter(n => !Number.isNaN(n));
  const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
  const safeTitle = String(title || '').replace(/[\r\n]+/g, ' ').trim();
  const heading = `Сцена ${nextNum}${safeTitle ? ` — ${safeTitle}` : ''}`;

  const newScene  = { heading, body: '', level: 2, parent: null };
  const newFields = [
    { heading: 'Описание для игрока', body: '⚠️ Заполни описание сцены для игрока.', level: 3, parent: heading },
    { heading: 'Колорит', body: '⚠️ 2-3 детали места/времени, которые нельзя перепутать с другим городом.', level: 3, parent: heading },
  ];

  const finaleIdx = sections.findIndex(s => s.level === 2 && isFinaleHeading(s.heading));
  const insertAt  = finaleIdx === -1 ? sections.length : finaleIdx;
  const newSections = [
    ...sections.slice(0, insertAt),
    newScene, ...newFields,
    ...sections.slice(insertAt),
  ];
  const text = addManualSceneMarker(serializeScenarioSections(preamble, newSections));
  return { text, heading };
}

// Обязательные смысловые блоки сценария — по эталонному формату (см. пример
// `tsirk_tsirk_tsirk/scenario.md`): GM-справка + Пролог/Сцены прямыми `##`-
// заголовками (без обёртки), Финал, закрывающая таблица вопросов, колорит
// города. Предпосылки/Локации/НПС/Завязка в этом формате не отдельные разделы —
// они вплетены прозой в GM-справку/Пролог, поэтому больше не проверяются как
// самостоятельные заголовки (раньше требовались per module_rules.md — старый,
// более плоский шаблон).
const SCENARIO_REQUIRED_TOPICS = [
  { key: 'setup',    label: 'Пролог / завязка',         re: /Пролог|Завязк/i },
  { key: 'scenes',   label: 'Сцены',                    re: /Сцен/i },
  { key: 'finale',   label: 'Финал / развязка',         re: /Финал|Кульминаци|Развязка|Раскрытие/i },
  { key: 'threads',  label: 'Открытые вопросы / нити',  re: /Открыт|Крючк|Зацепк/i },
  { key: 'flavor',   label: 'Колорит города',           re: /Колорит/i },
];

/**
 * Проверяет, что сгенерированный/отредактированный сценарий покрывает все
 * обязательные смысловые блоки из module_rules.md — только по заголовкам
 * разделов (наличие ОТДЕЛЬНОГО раздела на тему, а не просто упоминания).
 * @param {string} raw — содержимое scenario.md
 * @returns {{missing: {key:string,label:string}[], present: string[]}}
 */
function checkScenarioStructure(raw) {
  const { sections } = parseScenarioSections(raw);
  const headings = sections.map(s => s.heading);
  const joined   = headings.join(' | ');
  const missing  = SCENARIO_REQUIRED_TOPICS.filter(t => !t.re.test(joined)).map(t => ({ key: t.key, label: t.label }));
  return { missing, present: headings };
}

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

/**
 * @param {{text: string, href: string}} link
 * @returns {{text: string, href: string, kind: 'finale'|'module'|'npc'|'other', module: string|null}}
 */
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

// ── Chronicle (events.md) parsers ────────────────────────────────────────────
// Extract clickable location links (those pointing into locations/) + plain text
/**
 * @param {string} rest — текст после «📍 Локация:» в записи события
 * @returns {{text: string, links: {text: string, slug: string}[]}} ссылки — только ведущие в `locations/`
 */
function parseChronicleLocation(rest) {
  const links = mdExtractLinks(rest)
    .filter(l => /locations\//.test(l.href))
    .map(l => {
      const base = l.href.split('/').pop().replace(/\.md$/i, '');
      return { text: l.text, slug: decodeURIComponent(base) };
    });
  return { text: mdStripLinks(rest).trim(), links };
}

/**
 * @param {string} line — под-буллет из «👥 Участники» события
 * @returns {{text: string, name: string}} name — ведущий идентификатор до первой `(`/`—`/`→`, для сверки с карточками
 */
function parseParticipant(line) {
  const clean = mdStripLinks(line.replace(/^\s*-\s*/, '')).replace(/\*\*/g, '').trim();
  // Name = leading text before first " (", " — " or " →"
  const name = clean.split(/\s+\(|\s+—\s+|\s+→\s+/)[0].trim();
  return { text: clean, name };
}

/**
 * @param {string[]} lines — строки блока (может содержать не-табличные строки вперемешку)
 * @returns {{headers: string[], rows: string[][]}|null} null, если строк таблицы меньше 2 (заголовок+разделитель)
 */
function parseTable(lines) {
  const rowLines = lines.filter(l => /^\s*\|/.test(l));
  if (rowLines.length < 2) return null;
  const parseRow = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => mdStripLinks(c).replace(/\*\*/g, '').trim());
  const headers = parseRow(rowLines[0]);
  const body = rowLines.slice(2).map(parseRow);   // skip separator row
  return { headers, rows: body };
}

/**
 * @param {string} block — блок «## 🌍 Состояние мира» из events.md
 * @returns {{lastUpdate: string|null, sections: {heading: string, table: {headers: string[], rows: string[][]}|null, prose: string[]}[]}}
 */
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

/**
 * @param {string} chunk — один блок `### 📅 …` из events.md
 * @param {number} id — порядковый номер события в хронике
 * @returns {{id: number, heading: string, date: string, title: string, parallel: string|null,
 *   location: {text: string, links: {text: string, slug: string}[]},
 *   participants: {text: string, name: string}[], eventsText: string,
 *   consequences: string[], worldChanges: string[], links: object[]}}
 */
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

/**
 * @param {string} raw — содержимое `events.md` хроники
 * @returns {{title: string, worldState: object|null, events: object[]}} events — см. {@link parseEvent}
 */
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

/**
 * Собирает уникальные отображаемые имена участников из текста events.md хроники.
 * @param {string} eventsText
 * @returns {string[]}
 */
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
  parseScenarioSections,
  replaceScenarioSection,
  splitH3Body,
  serializeScenarioSections,
  findScenarioSectionIndex,
  replaceScenarioSections,
  insertScenarioScene,
  hasManualSceneMarker,
  addManualSceneMarker,
  clearManualSceneMarker,
  isFinaleHeading,
  checkScenarioStructure,
  parsePoliticalFactions,
  setPoliticalFactionInfluence,
};
