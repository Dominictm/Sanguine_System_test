#!/usr/bin/env node
'use strict';
// Кросс-город персонажи (модель «один источник истины»).
//   Присутствие (гость, без переноса карточки):
//     node tools/migrate_char.js visit <home_city> <lineage> <slug> <to_city> ["<когда/контекст>"]
//   Переезд (сменить родной город, перенести папку):
//     node tools/migrate_char.js move <from_city> <lineage> <slug> <to_city>
//
// visit  → добавляет поле «Присутствие» в карточку + строку в cities/<to>/archive/visitors.md (ссылка на дом).
// move   → переносит папку персонажа в новый город, меняет «Родной город», правит оба characters_index.
//          ⚠️ Входящие ссылки из других карточек/событий на старый путь нужно проверить вручную (validate_links).

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const mode = process.argv[2];

function cityName(city) {
  try {
    const m = fs.readFileSync(path.join(ROOT, 'cities', city, 'city.md'), 'utf8').replace(/^﻿/, '').match(/^#\s+(.+)$/m);
    if (m) return m[1].replace(/^[^\p{L}\p{N}]+/u, '').split(/[,—–-]/)[0].trim();
  } catch {}
  return city;
}
function h1Name(file) {
  try { const m = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').match(/^#\s+(.+)$/m); if (m) return m[1].replace(/^[^\p{L}\p{N}]+/u, '').trim(); } catch {}
  return null;
}
const exists = p => fs.existsSync(p);

if (mode === 'visit') {
  const [, , , home, lineage, slug, to, when] = process.argv;
  if (!home || !lineage || !slug || !to) { console.error('node tools/migrate_char.js visit <home_city> <lineage> <slug> <to_city> ["<когда>"]'); process.exit(1); }
  const card = path.join(ROOT, 'cities', home, 'characters', lineage, slug, `${slug}.md`);
  if (!exists(card)) { console.error(`Карточка не найдена: ${card}`); process.exit(1); }
  const visitors = path.join(ROOT, 'cities', to, 'archive', 'visitors.md');
  if (!exists(visitors)) { console.error(`Город назначения "${to}" или его visitors.md не найден.`); process.exit(1); }
  const name = h1Name(card) || slug;
  const ctx = when || '—';

  // 1) поле «Присутствие» в карточку
  let raw = fs.readFileSync(card, 'utf8'); const bom = raw.charCodeAt(0) === 0xFEFF; let c = bom ? raw.slice(1) : raw;
  const entry = `${cityName(to)} — ${ctx}`;
  if (/^- \*\*Присутствие:\*\*/m.test(c)) c = c.replace(/^(- \*\*Присутствие:\*\*\s*)(.*)$/m, (m, p, v) => `${p}${v && v !== '—' ? v + '; ' : ''}${entry}`);
  else c = c.replace(/^(- \*\*Родной город:\*\*.*)$/m, `$1\n- **Присутствие:** ${entry}`);
  fs.writeFileSync(card, (bom ? '﻿' : '') + c, 'utf8');

  // 2) строка в visitors.md города назначения (ссылка на дом)
  let vraw = fs.readFileSync(visitors, 'utf8'); const vbom = vraw.charCodeAt(0) === 0xFEFF; let v = vbom ? vraw.slice(1) : vraw;
  const link = `../../${home}/characters/${lineage}/${slug}/${slug}.md`.replace(/^\.\.\/\.\.\//, '../../../cities/');
  const row = `| [${name}](../../../cities/${home}/characters/${lineage}/${slug}/${slug}.md) | ${cityName(home)} | ${ctx} |`;
  v = v.replace(/\|\s*\|\s*\|\s*\|\s*\n?/, '');                 // убрать пустую строку-болванку
  v = v.replace(/\s*$/, '') + '\n' + row + '\n';
  fs.writeFileSync(visitors, (vbom ? '﻿' : '') + v, 'utf8');

  console.log(`✓ ${name}: присутствие в «${cityName(to)}» (${ctx}) зафиксировано. Карточка осталась в ${home}.`);
  process.exit(0);
}

if (mode === 'move') {
  const [, , , from, lineage, slug, to] = process.argv;
  if (!from || !lineage || !slug || !to) { console.error('node tools/migrate_char.js move <from_city> <lineage> <slug> <to_city>'); process.exit(1); }
  const src = path.join(ROOT, 'cities', from, 'characters', lineage, slug);
  const dstDir = path.join(ROOT, 'cities', to, 'characters', lineage);
  const dst = path.join(dstDir, slug);
  if (!exists(src)) { console.error(`Источник не найден: ${src}`); process.exit(1); }
  if (exists(dst)) { console.error(`В "${to}" уже есть ${lineage}/${slug}.`); process.exit(1); }
  if (!exists(path.join(ROOT, 'cities', to))) { console.error(`Город "${to}" не найден.`); process.exit(1); }
  const card = path.join(src, `${slug}.md`);
  const name = h1Name(card) || slug;

  fs.mkdirSync(dstDir, { recursive: true });
  fs.renameSync(src, dst);

  // «Родной город» → новый
  const ncard = path.join(dst, `${slug}.md`);
  let raw = fs.readFileSync(ncard, 'utf8'); const bom = raw.charCodeAt(0) === 0xFEFF; let c = bom ? raw.slice(1) : raw;
  c = c.replace(/^(- \*\*Родной город:\*\*\s*).*$/m, `$1${cityName(to)}`);
  fs.writeFileSync(ncard, (bom ? '﻿' : '') + c, 'utf8');

  // индексы: убрать из старого, добавить в новый
  const idxRow = `- [${name}](../characters/${lineage}/${slug}/${slug}.md)`;
  for (const [city, add] of [[from, false], [to, true]]) {
    const idx = path.join(ROOT, 'cities', city, 'archive', 'characters_index.md');
    if (!exists(idx)) continue;
    let r = fs.readFileSync(idx, 'utf8'); const b = r.charCodeAt(0) === 0xFEFF; let cc = b ? r.slice(1) : r;
    if (add) cc = cc.replace(/\s*$/, '') + `\n${idxRow} — переехал из ${cityName(from)}\n`;
    else cc = cc.split('\n').filter(l => !l.includes(`/${slug}/${slug}.md`)).join('\n');
    fs.writeFileSync(idx, (b ? '﻿' : '') + cc, 'utf8');
  }

  console.log(`✓ ${name} переехал: ${from} → ${to} (${lineage}/${slug}). «Родной город» обновлён.`);
  console.log(`  ⚠️ Проверь входящие ссылки: tools/validate_links.ps1 (события/карточки старого города могли ссылаться на персонажа).`);
  process.exit(0);
}

console.error('Режим: visit | move. Подробности — заголовок файла.');
process.exit(1);
