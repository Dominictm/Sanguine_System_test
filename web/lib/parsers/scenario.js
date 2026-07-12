'use strict';
// Module scenario.md section parsing and mutation. Extracted from
// parsers.js during the 2026-07-12 decomposition. Sole consumer:
// web/routes/modules/shared.js.

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

module.exports = {
  parseScenarioSections, splitH3Body, serializeScenarioSections,
  replaceScenarioSection, findScenarioSectionIndex, replaceScenarioSections,
  SCENE_ADDED_MARKER_RE, isFinaleHeading, hasManualSceneMarker,
  addManualSceneMarker, clearManualSceneMarker, insertScenarioScene,
  SCENARIO_REQUIRED_TOPICS, checkScenarioStructure,
};
