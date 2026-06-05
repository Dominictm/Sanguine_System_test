#!/usr/bin/env node
'use strict';
// Агрегатор: пересобирает индекс «Сводная хроника событий» в cities/<city>/archive/events.md
// из chronicles/<хроника>/events.md. Город — аргумент (по умолчанию paris).
// Запуск:  node tools/build_city_events.js [city]
const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const city = process.argv[2] || 'paris';
const chronMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '_chronicle_map.json'), 'utf8'))[city] || {};

const rows = [];
for (const [chr, def] of Object.entries(chronMap)) {
  const f = path.join(ROOT, 'cities', city, 'chronicles', chr, 'events.md');
  if (!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, 'utf8'); if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);
  for (const m of c.matchAll(/^### 📅 (.+)$/gm)) {
    const h = m[1].trim(), d = h.indexOf(' — ');
    const date = d >= 0 ? h.slice(0, d) : h;
    const title = d >= 0 ? h.slice(d + 3) : '';
    rows.push(`| ${date} | ${title} | [${def.display}](../chronicles/${chr}/events.md) |`);
  }
}
const table = '| Дата | Событие | Хроника |\n|---|---|---|\n' + rows.join('\n');

const archive = path.join(ROOT, 'cities', city, 'archive', 'events.md');
let raw = fs.readFileSync(archive, 'utf8'); const bom = raw.charCodeAt(0) === 0xFEFF; let c = bom ? raw.slice(1) : raw;
if (!/<!-- AUTO:events-index -->[\s\S]*?<!-- \/AUTO:events-index -->/.test(c)) { console.error('Нет маркеров <!-- AUTO:events-index -->'); process.exit(1); }
c = c.replace(/<!-- AUTO:events-index -->[\s\S]*?<!-- \/AUTO:events-index -->/,
  '<!-- AUTO:events-index -->\n' + table + '\n<!-- /AUTO:events-index -->');
fs.writeFileSync(archive, (bom ? '﻿' : '') + c, 'utf8');
console.log(`Индекс города ${city} обновлён: ${rows.length} событий`);
