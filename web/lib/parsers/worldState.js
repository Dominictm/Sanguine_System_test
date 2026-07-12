'use strict';

// Извлекает блок "## 🌍 Состояние мира" из events.md — от заголовка до
// следующего "## " (там начинается индекс событий) либо до конца файла.
// Та же граница, что уже использует parseChronicle (chronicle.js) для чтения.
function _extractBlock(eventsRaw) {
  const text = String(eventsRaw || '').replace(/\r\n/g, '\n');
  const m = text.match(/##\s*🌍[^\n]*\n/);
  if (!m) return null;
  const start = m.index;
  const bodyStart = start + m[0].length;
  const rest = text.slice(bodyStart);
  const relEnd = rest.search(/\n(?=##\s)/);
  const end = relEnd === -1 ? text.length : bodyStart + relEnd + 1;
  return { start, end, headingLine: m[0], body: text.slice(bodyStart, end) };
}

/** Патчит блок «Состояние мира» внутри events.md, остальной файл не трогает. */
function replaceWorldStateBlock(eventsRaw, newBodyMd) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const text = String(eventsRaw || '').replace(/\r\n/g, '\n');
  return { raw: text.slice(0, block.start) + block.headingLine + newBodyMd + text.slice(block.end), found: true };
}

// Тело блока → {preamble, sections}: preamble — всё до первого "### " (обычно
// цитата "Обновляется после каждой сессии... Последнее обновление: **...**");
// sections[i].raw включает заголовок, таблицу, note и хвостовой "---" —
// склейка preamble + sections.map(s=>s.raw).join('') даёт исходное тело 1:1.
function _splitSections(body) {
  // Находим границы ВСЕХ "### "-секций (позиция самого "#", не предшествующего
  // \n) — тот же приём, что _splitTopBlocks в timeline.js, только для "### "
  // вместо "## " и с поддержкой секции, начинающейся с позиции 0 (без preamble).
  const starts = [];
  const re = /(?:^|\n)(?=###\s)/g;
  let m;
  while ((m = re.exec(body))) {
    starts.push(body[m.index] === '\n' ? m.index + 1 : m.index);
    if (m[0].length === 0) re.lastIndex += 1; // не зациклиться на нулевом совпадении по ^
  }
  if (!starts.length) return { preamble: body, sections: [] };
  const preamble = body.slice(0, starts[0]);
  const bounds = [...starts, body.length];
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const raw = body.slice(bounds[i], bounds[i + 1]);
    const hm = raw.match(/^###\s+(.+?)\s*\n/);
    sections.push({ heading: hm ? hm[1].trim() : '', raw });
  }
  return { preamble, sections };
}

function _parsePipeTable(text) {
  const rows = String(text || '').split('\n').filter(l => /^\s*\|/.test(l));
  if (rows.length < 2) return { headers: [], body: [] };
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  return { headers: cells(rows[0]), body: rows.slice(2).map(cells) };
}
function _serializeTable(headers, bodyRows) {
  const sep = headers.map(() => '---').join(' | ');
  const line = cells => `| ${cells.join(' | ')} |`;
  return [line(headers), `| ${sep} |`, ...bodyRows.map(line)].join('\n');
}
// Свободный абзац после таблицы секции (например «**Главный Элизиум:** …»).
function _extractNote(sectionRaw) {
  const lines = sectionRaw.split('\n').slice(1);
  return lines.map(l => l.trim()).filter(l => l && !/^\|/.test(l) && !/^---+$/.test(l)).join(' ').trim();
}
function _sectionRaw(heading, columns, rows, note) {
  const table = columns.length ? _serializeTable(columns, rows) : '';
  const noteBlock = note ? `\n\n${note}` : '';
  return `### ${heading}\n\n${table}${noteBlock}\n\n---\n\n`;
}

/**
 * @returns {{lastUpdate:string|null, sections:{heading:string, columns:string[], rows:string[][], note:string}[]}}
 */
function parseWorldStateBlock(eventsRaw) {
  const block = _extractBlock(eventsRaw);
  if (!block) return null;
  const lu = block.body.match(/Последнее обновление:\s*\*\*([^*]+)\*\*/);
  const { sections } = _splitSections(block.body);
  return {
    lastUpdate: lu ? lu[1].trim() : null,
    sections: sections.map(s => {
      const t = _parsePipeTable(s.raw);
      return { heading: s.heading, columns: t.headers, rows: t.body, note: _extractNote(s.raw) };
    }),
  };
}

function setWorldStateLastUpdate(eventsRaw, text) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const has = /Последнее обновление:\s*\*\*[^*]+\*\*/.test(block.body);
  const newBody = has
    ? block.body.replace(/Последнее обновление:\s*\*\*[^*]+\*\*/, `Последнее обновление: **${text}**`)
    : block.body; // формат без строки обновления — не создаём новую структуру самовольно
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: has };
}

function addWorldStateSection(eventsRaw, heading, columns) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const { preamble, sections } = _splitSections(block.body);
  sections.push({ heading, raw: _sectionRaw(heading, columns, [], '') });
  const newBody = preamble + sections.map(s => s.raw).join('');
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: true };
}

function removeWorldStateSection(eventsRaw, heading) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const { preamble, sections } = _splitSections(block.body);
  const idx = sections.findIndex(s => s.heading === heading);
  if (idx === -1) return { raw: eventsRaw, found: false };
  sections.splice(idx, 1);
  const newBody = preamble + sections.map(s => s.raw).join('');
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: true };
}

function setWorldStateSectionNote(eventsRaw, heading, note) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false };
  const { preamble, sections } = _splitSections(block.body);
  const idx = sections.findIndex(s => s.heading === heading);
  if (idx === -1) return { raw: eventsRaw, found: false };
  const t = _parsePipeTable(sections[idx].raw);
  sections[idx] = { heading, raw: _sectionRaw(heading, t.headers, t.body, note) };
  const newBody = preamble + sections.map(s => s.raw).join('');
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: true };
}

function _patchSectionRows(eventsRaw, heading, mutate) {
  const block = _extractBlock(eventsRaw);
  if (!block) return { raw: eventsRaw, found: false, indexValid: true };
  const { preamble, sections } = _splitSections(block.body);
  const idx = sections.findIndex(s => s.heading === heading);
  if (idx === -1) return { raw: eventsRaw, found: false, indexValid: true };
  const t = _parsePipeTable(sections[idx].raw);
  const note = _extractNote(sections[idx].raw);
  const result = mutate(t.body);
  if (result === null) return { raw: eventsRaw, found: true, indexValid: false };
  sections[idx] = { heading, raw: _sectionRaw(heading, t.headers, result, note) };
  const newBody = preamble + sections.map(s => s.raw).join('');
  return { ...replaceWorldStateBlock(eventsRaw, newBody), found: true, indexValid: true };
}

function addWorldStateRow(eventsRaw, heading, cells) {
  return _patchSectionRows(eventsRaw, heading, body => [...body, cells]);
}
function updateWorldStateRow(eventsRaw, heading, index, cells) {
  return _patchSectionRows(eventsRaw, heading, body => {
    if (index < 0 || index >= body.length) return null;
    return body.map((r, i) => (i === index ? cells : r));
  });
}
function removeWorldStateRow(eventsRaw, heading, index) {
  return _patchSectionRows(eventsRaw, heading, body => {
    if (index < 0 || index >= body.length) return null;
    return body.filter((_, i) => i !== index);
  });
}

module.exports = {
  parseWorldStateBlock, replaceWorldStateBlock, setWorldStateLastUpdate,
  addWorldStateSection, removeWorldStateSection, setWorldStateSectionNote,
  addWorldStateRow, updateWorldStateRow, removeWorldStateRow,
};
