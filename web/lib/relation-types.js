'use strict';
// Библиотека «Постоянные связи» (2026-08-08, Фаза 1 «Связи и отношения») — плоский список
// без категорий, читается CRUD-роутами (web/routes/library.js) и графом (web/routes/
// dashboard.js, /api/graph — подстрочное сопоставление description для цвета ребра).
const fs   = require('fs').promises;
const path = require('path');
const { ROOT } = require('./db');

const FILE = path.join(ROOT, 'system', 'library', 'relation-types.json');

async function getRelationTypes() {
  try { return JSON.parse(await fs.readFile(FILE, 'utf-8')); }
  catch { return []; }
}

// Случайный цвет (п.9 запроса) — HSL с фиксированным диапазоном S/L, подобранным под уже
// используемую на графе палитру REL_COLORS (средняя насыщенность/светлота, читаемо на тёмном
// фоне интерфейса) — только оттенок (H) варьируется случайно.
function randomRelColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 55 + Math.floor(Math.random() * 15); // 55–70%
  const l = 45 + Math.floor(Math.random() * 10); // 45–55%
  return hslToHex(h, s, l);
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

module.exports = { FILE, getRelationTypes, randomRelColor };
