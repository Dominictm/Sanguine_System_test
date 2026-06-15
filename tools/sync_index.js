#!/usr/bin/env node
'use strict';
// Сверяет characters_index.md города с папками персонажей на диске и ЧИНИТ расхождения:
//   • orphan  (папка есть, в реестре нет)  → дописывает буллет в формате new_npc.js;
//   • dangling(реестр ссылается на несуществующую папку) → НЕ удаляет, только сообщает.
// Неразрушающий и идемпотентный: формат и порядок существующих записей не трогает.
// Запуск:  node tools/sync_index.js [city]   (по умолчанию paris)

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');

const LINEAGES = ['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters'];
const LINEAGE_RU = {
  vampires: 'Вампир', fairies: 'Фея / Ченджлинг', mortals: 'Смертный',
  werewolves: 'Оборотень', mages: 'Маг', hunters: 'Охотник'
};

const city = process.argv[2] || 'paris';
const cityDir  = path.join(ROOT, 'cities', city);
const charsDir = path.join(cityDir, 'characters');
const idxPath  = path.join(cityDir, 'archive', 'characters_index.md');

if (!fs.existsSync(charsDir)) { console.error(`Нет папки персонажей: cities/${city}/characters`); process.exit(1); }
if (!fs.existsSync(idxPath))  { console.error(`Нет реестра: cities/${city}/archive/characters_index.md`); process.exit(1); }

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// 1. Папки на диске → Map "lineage/slug" → { lineage, slug, cardPath }
const actual = new Map();
for (const lin of LINEAGES) {
  const linDir = path.join(charsDir, lin);
  if (!isDir(linDir)) continue;
  for (const slug of fs.readdirSync(linDir)) {
    const card = path.join(linDir, slug, `${slug}.md`);
    if (isDir(path.join(linDir, slug)) && fs.existsSync(card)) {
      actual.set(`${lin}/${slug}`, { lineage: lin, slug, cardPath: card });
    }
  }
}

// 2. Ссылки из реестра (та же логика, что в integrity-проверке сервера)
const rawIdx  = fs.readFileSync(idxPath, 'utf8');
const bom     = rawIdx.charCodeAt(0) === 0xFEFF;
const referenced = new Set();
const refRe = /\([^)]*?\/(vampires|fairies|mortals|werewolves|mages|hunters)\/([^/)]+)\//g;
let m;
while ((m = refRe.exec(rawIdx)) !== null) referenced.add(`${m[1]}/${m[2]}`);

const orphans   = [...actual.keys()].filter(k => !referenced.has(k));
const danglings = [...referenced].filter(k => !actual.has(k));

// 3. Достаём имя (H1 без эмодзи) и клан/расу из карточки
function cardMeta(cardPath) {
  let name = '', clan = '';
  try {
    const c = fs.readFileSync(cardPath, 'utf8').replace(/^﻿/, '');
    const h = c.match(/^#\s+(.+)$/m);
    if (h) name = h[1].replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '').trim() || h[1].trim();
    const k = c.match(/-\s*\*\*(?:Клан|Раса|Клан \/ Раса)[^*]*:\*\*\s*(.+)$/m);
    if (k) clan = k[1].trim();
  } catch {}
  return { name, clan };
}

// 4. Дописываем orphan-буллеты (формат new_npc.js), реестр — в конец файла
let added = 0;
if (orphans.length) {
  let body = bom ? rawIdx.slice(1) : rawIdx;
  body = body.replace(/\s*$/, '');
  for (const key of orphans) {
    const { lineage, slug, cardPath } = actual.get(key);
    const { name, clan } = cardMeta(cardPath);
    const label = name || slug;
    body += `\n- [${label}](../characters/${lineage}/${slug}/${slug}.md) — ${LINEAGE_RU[lineage]}${clan ? `, ${clan}` : ''}`;
    console.log(`  + ${label}  (${lineage}/${slug})`);
    added++;
  }
  body += '\n';
  fs.writeFileSync(idxPath, (bom ? '﻿' : '') + body, 'utf8');
}

// 5. Итог
console.log('');
console.log(`Реестр ${city}: на диске ${actual.size}, добавлено ${added}.`);
if (danglings.length) {
  console.log(`⚠ Записи без папки (${danglings.length}) — проверь вручную (переименование/удаление):`);
  for (const d of danglings) console.log(`    – ${d}`);
} else {
  console.log('✓ Висячих записей нет.');
}
