#!/usr/bin/env node
'use strict';
// Закрытие хроники: статус «Закрыта» в chronicle.md (создаётся, если нет),
// закрытие всех открытых нитей (🔴/🟡 → 🟢) и финальная заметка.
// Запуск:  node tools/close_chronicle.js <city> <chronicle_slug> ["финальная заметка"]

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const [city, chr, note] = [process.argv[2], process.argv[3], process.argv[4] || ''];
if (!city || !chr) { console.error('node tools/close_chronicle.js <city> <chronicle_slug> ["заметка"]'); process.exit(1); }

const chrDir = path.join(ROOT, 'cities', city, 'chronicles', chr);
if (!fs.existsSync(chrDir)) { console.error(`Хроника не найдена: cities/${city}/chronicles/${chr}`); process.exit(1); }

// display-имя хроники из events.md (H1 «… — События») или slug
let display = chr;
try { const m = fs.readFileSync(path.join(chrDir, 'events.md'), 'utf8').replace(/^﻿/, '').match(/^#\s+(.+?)\s+—\s+События/m); if (m) display = m[1].replace(/^[^\p{L}\p{N}]+/u, '').trim(); } catch {}

// 1) chronicle.md — статус + финал
const chronFile = path.join(chrDir, 'chronicle.md');
const today = new Date().toISOString().slice(0, 10);
if (fs.existsSync(chronFile)) {
  let raw = fs.readFileSync(chronFile, 'utf8'); const bom = raw.charCodeAt(0) === 0xFEFF; let c = bom ? raw.slice(1) : raw;
  if (/^- \*\*Статус:\*\*/m.test(c)) c = c.replace(/^(- \*\*Статус:\*\*\s*).*$/m, `$1🟢 Закрыта (${today})`);
  else c = c.replace(/^(#.*)$/m, `$1\n\n- **Статус:** 🟢 Закрыта (${today})`);
  if (note) c = c.replace(/\s*$/, '') + `\n\n## 🏁 Финал хроники\n\n${note}\n`;
  fs.writeFileSync(chronFile, (bom ? '﻿' : '') + c, 'utf8');
} else {
  fs.writeFileSync(chronFile,
`# 📕 ${display}

- **Статус:** 🟢 Закрыта (${today})

> Спина хроники. События — [events.md](events.md). Нити — [open_threads.md](open_threads.md).
${note ? `\n## 🏁 Финал хроники\n\n${note}\n` : ''}`, 'utf8');
}

// 2) закрыть все открытые нити
const otFile = path.join(chrDir, 'open_threads.md');
let closed = 0;
if (fs.existsSync(otFile)) {
  let raw = fs.readFileSync(otFile, 'utf8'); const bom = raw.charCodeAt(0) === 0xFEFF; let c = bom ? raw.slice(1) : raw;
  c = c.split('\n').map(l => {
    if (/^\|\s*\d+\s*\|/.test(l) && /🔴|🟡/.test(l)) { closed++; return l.replace(/🔴 ?Активна|🔴|🟡 ?Фоновая|🟡/g, '🟢 Закрыта'); }
    return l;
  }).join('\n');
  fs.writeFileSync(otFile, (bom ? '﻿' : '') + c, 'utf8');
}

console.log(`✓ Хроника «${display}» закрыта (${today}). Нитей закрыто: ${closed}. chronicle.md обновлён.`);
