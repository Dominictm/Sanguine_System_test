#!/usr/bin/env node
'use strict';
// Агрегатор: пересобирает индекс «Сводная хроника событий» в cities/<city>/archive/events.md
// из chronicles/<хроника>/events.md. Хроники берутся С ДИСКА (а не только из _chronicle_map.json),
// поэтому работают и динамически созданные через log-session. Город — аргумент (по умолчанию paris).
// Запуск:  node tools/build_city_events.js [city]
const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const city = process.argv[2] || 'paris';
let chronMap = {};
try { chronMap = (JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '_chronicle_map.json'), 'utf8'))[city]) || {}; } catch {}

const chronDir = path.join(ROOT, 'cities', city, 'chronicles');
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const disk = isDir(chronDir) ? fs.readdirSync(chronDir).filter(n => isDir(path.join(chronDir, n))) : [];
// Порядок: сначала известные из карты (в их порядке), затем остальные с диска.
const mapOrder = Object.keys(chronMap);
const ordered = [...mapOrder.filter(c => disk.includes(c)), ...disk.filter(c => !mapOrder.includes(c))];

const rows = [];
for (const chr of ordered) {
  const f = path.join(chronDir, chr, 'events.md');
  if (!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, 'utf8'); if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);
  const h1 = c.match(/^#\s+(.+?)\s+—\s+События\s*$/m);
  const display = (chronMap[chr] && chronMap[chr].display)
    || (h1 ? h1[1].replace(/^[^\p{L}\p{N}]+/u, '').trim() : chr);
  for (const m of c.matchAll(/^### 📅 (.+)$/gm)) {
    const h = m[1].trim(), d = h.indexOf(' — ');
    const date = d >= 0 ? h.slice(0, d) : h;
    const title = (d >= 0 ? h.slice(d + 3) : '').replace(/\.\s*$/, '');
    rows.push(`| ${date} | ${title} | [${display}](../chronicles/${chr}/events.md) |`);
  }
}
const table = '| Дата | Событие | Хроника |\n|---|---|---|\n' + rows.join('\n');

const archive = path.join(ROOT, 'cities', city, 'archive', 'events.md');
let raw = fs.readFileSync(archive, 'utf8'); const bom = raw.charCodeAt(0) === 0xFEFF; let cc = bom ? raw.slice(1) : raw;
if (!/<!-- AUTO:events-index -->[\s\S]*?<!-- \/AUTO:events-index -->/.test(cc)) { console.error('Нет маркеров <!-- AUTO:events-index -->'); process.exit(1); }
cc = cc.replace(/<!-- AUTO:events-index -->[\s\S]*?<!-- \/AUTO:events-index -->/,
  '<!-- AUTO:events-index -->\n' + table + '\n<!-- /AUTO:events-index -->');
fs.writeFileSync(archive, (bom ? '﻿' : '') + cc, 'utf8');
console.log(`Индекс города ${city} обновлён: ${rows.length} событий`);
