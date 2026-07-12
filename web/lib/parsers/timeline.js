'use strict';
const { mdExtractLinks } = require('./shared');

const TIMELINE_HEADERS = ['Год', 'Тип', 'Событие', 'Источник', 'Связи'];

// Верхнеуровневые "## "-блоки: blocks[0].heading === null — это H1+вступление
// (не редактируется формой), остальные — либо легенда, либо эпоха. Разбор по
// позиции в СЫРОМ тексте (start/end — индексы в исходной строке), чтобы
// точечные patch-функции ниже могли заменить ровно один блок.
function _splitTopBlocks(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const starts = [0];
  const re = /\n(?=##\s)/g;
  let m;
  while ((m = re.exec(text))) starts.push(m.index + 1);
  starts.push(text.length);
  const blocks = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const block = text.slice(starts[i], starts[i + 1]);
    const hm = block.match(/^##\s+(.+?)\s*\n/);
    blocks.push({ start: starts[i], end: starts[i + 1], heading: hm ? hm[1].trim() : null, raw: block });
  }
  return blocks;
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

function _rowFromCells(cells) {
  return {
    year: cells[0] || '', type: cells[1] || '', event: cells[2] || '',
    source: cells[3] || '', links: mdExtractLinks(cells[4] || ''),
  };
}
function _cellsFromRow(row) {
  const links = (row.links || []).map(l => `[${l.text}](${l.href})`).join(', ');
  return [row.year || '', row.type || '', row.event || '', row.source || '', links];
}

/**
 * @param {string} raw — содержимое timeline.md
 * @returns {{intro:string, legend:{symbol:string,meaning:string}[], epochs:{heading:string, rows:object[]}[]}}
 */
function parseTimelineMd(raw) {
  const blocks = _splitTopBlocks(raw);
  const intro = blocks[0] ? blocks[0].raw : '';
  const legendBlock = blocks.find(b => b.heading && /^условные обозначения/i.test(b.heading));
  const legend = [];
  if (legendBlock) {
    const t = _parsePipeTable(legendBlock.raw);
    for (const cells of t.body) if (cells[0]) legend.push({ symbol: cells[0], meaning: cells[1] || '' });
  }
  const epochs = blocks
    .filter(b => b.heading && b !== legendBlock)
    .map(b => ({ heading: b.heading, rows: _parsePipeTable(b.raw).body.map(_rowFromCells) }));
  return { intro, legend, epochs };
}

function addTimelineEpoch(raw, heading) {
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const table = _serializeTable(TIMELINE_HEADERS, []);
  return `${text}\n\n---\n\n## ${heading}\n\n${table}\n`;
}

function removeTimelineEpoch(raw, heading) {
  const blocks = _splitTopBlocks(raw);
  const idx = blocks.findIndex(b => b.heading === heading);
  if (idx === -1) return { raw, found: false };
  const text = String(raw || '').replace(/\r\n/g, '\n');
  let before = text.slice(0, blocks[idx].start);
  const after = text.slice(blocks[idx].end);
  before = before.replace(/\n+---\n+$/, '\n\n');
  return { raw: before + after, found: true };
}

function _patchEpochTable(raw, heading, mutate) {
  const blocks = _splitTopBlocks(raw);
  const idx = blocks.findIndex(b => b.heading === heading);
  if (idx === -1) return { raw, found: false, indexValid: true };
  const b = blocks[idx];
  const t = _parsePipeTable(b.raw);
  const headers = t.headers.length ? t.headers : TIMELINE_HEADERS;
  const result = mutate(t.body);
  if (result === null) return { raw, found: true, indexValid: false };
  const headingLine = b.raw.match(/^##\s+.+?\s*\n/)[0];
  const newBlock = `${headingLine}\n${_serializeTable(headers, result)}\n`;
  const text = String(raw || '').replace(/\r\n/g, '\n');
  return { raw: text.slice(0, b.start) + newBlock + text.slice(b.end), found: true, indexValid: true };
}

function addTimelineRow(raw, heading, row) {
  return _patchEpochTable(raw, heading, body => [...body, _cellsFromRow(row)]);
}
function updateTimelineRow(raw, heading, index, row) {
  return _patchEpochTable(raw, heading, body => {
    if (index < 0 || index >= body.length) return null;
    return body.map((cells, i) => (i === index ? _cellsFromRow(row) : cells));
  });
}
function removeTimelineRow(raw, heading, index) {
  return _patchEpochTable(raw, heading, body => {
    if (index < 0 || index >= body.length) return null;
    return body.filter((_, i) => i !== index);
  });
}

module.exports = {
  parseTimelineMd, addTimelineEpoch, removeTimelineEpoch,
  addTimelineRow, updateTimelineRow, removeTimelineRow,
};
