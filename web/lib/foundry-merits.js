'use strict';
// Сопоставление свободного текста Sanguine (`meritsFlaws`, «по строке на пункт») с
// каноничной библиотекой system/library/merits/*.json и system/library/flaws/*.json
// (та же библиотека, что наполняет раздел «Библиотека» веб-интерфейса). Строки,
// совпавшие по имени с библиотекой, экспортируются в Foundry как структурированные
// Item (`wod.types.merit`/`wod.types.flaw`, level = очки); несовпавшие остаются
// свободным текстом (см. web/lib/foundry-export.js).

const { getAllMerits } = require('./merits-loader');
const { getAllFlaws } = require('./flaws-loader');

function _norm(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
}

let _index = null;
function _buildIndex() {
  if (_index) return _index;
  _index = new Map();
  for (const list of Object.values(getAllMerits())) {
    for (const m of list) _index.set(_norm(m.name), { name: m.name, points: m.points, kind: 'merit' });
  }
  for (const list of Object.values(getAllFlaws())) {
    for (const f of list) _index.set(_norm(f.name), { name: f.name, points: f.points, kind: 'flaw' });
  }
  return _index;
}

// «Внушительный тип (1 очко)» / «- Внушительный тип» / «Внушительный тип — 1» →
// имя для поиска в библиотеке (без маркера строки, скобок и очков в конце).
function _extractName(line) {
  return String(line || '')
    .replace(/^[-•*]\s*/, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[—-]\s*\d+\s*(очк\w*)?\s*$/i, '')
    .trim();
}

// Разбирает многострочный meritsFlaws на { matched: [{name,points,kind}], unmatched: [строка,...] }.
function matchMeritsFlaws(text) {
  const index = _buildIndex();
  const matched = [];
  const unmatched = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const hit = index.get(_norm(_extractName(line)));
    if (hit) matched.push(hit); else unmatched.push(line);
  }
  return { matched, unmatched };
}

module.exports = { matchMeritsFlaws };
