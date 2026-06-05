#!/usr/bin/env node
'use strict';
// Генератор slug-карты (dry-run, Фаза 2). Ничего не перемещает.
// Транслитерирует имена папок-персонажей в ASCII-слаги, читает display_name из H1,
// выделяет алиас из скобок «Имя (Алиас)», детектит коллизии.
// Запуск:  node tools/slugmap.js   →  печатает таблицу + пишет tools/_slugmap.json

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const LINEAGES = ['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters'];
const MAP = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
};
const translit = s => s.toLowerCase().split('').map(ch => MAP[ch] !== undefined ? MAP[ch] : ch).join('');
const slugify = s => translit(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const listDirs = p => isDir(p) ? fs.readdirSync(p).filter(n => isDir(path.join(p, n))) : [];

function h1Of(file) {
  try {
    let c = fs.readFileSync(file, 'utf8');
    if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);
    const m = c.match(/^#\s+(.*)$/m);
    return m ? m[1].replace(/^[^\p{L}\p{N}]+/u, '').trim() : null;
  } catch { return null; }
}

const rows = [];
const seen = new Map(); // slug -> first folder

for (const lin of LINEAGES) {
  const linDir = path.join(ROOT, 'characters', lin);
  for (const folder of listDirs(linDir)) {
    const main = path.join(linDir, folder, folder + '.md');
    const paren = folder.match(/^(.*?)\s*\((.+?)\)\s*$/);
    const primary = paren ? paren[1].trim() : folder;
    const aliasHint = paren ? paren[2].trim() : '';
    let slug = slugify(primary);
    if (!slug) slug = slugify(folder) || 'x';
    let finalSlug = slug, n = 2;
    while (seen.has(finalSlug)) finalSlug = `${slug}_${n++}`;
    const collision = finalSlug !== slug;
    seen.set(finalSlug, folder);
    rows.push({
      type: 'character',
      lineage: lin,
      old_path: `characters/${lin}/${folder}`,
      new_path: `cities/paris/characters/${lin}/${finalSlug}`,
      slug: finalSlug,
      display_name: h1Of(main) || primary,
      alias_hint: aliasHint || undefined,
      collision: collision || undefined,
    });
  }
}

fs.writeFileSync(path.join(ROOT, 'tools', '_slugmap.json'), JSON.stringify(rows, null, 2), 'utf8');

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log(pad('LINEAGE', 10), pad('SLUG', 24), pad('DISPLAY_NAME', 26), 'ALIAS / ⚠');
console.log('-'.repeat(78));
let curr = '';
for (const r of rows) {
  if (r.lineage !== curr) { curr = r.lineage; }
  const note = [r.alias_hint ? `алиас: ${r.alias_hint}` : '', r.collision ? '⚠ коллизия' : ''].filter(Boolean).join('  ');
  console.log(pad(r.lineage, 10), pad(r.slug, 24), pad(r.display_name, 26), note);
}
console.log('-'.repeat(78));
console.log(`Всего: ${rows.length} · алиасов из скобок: ${rows.filter(r => r.alias_hint).length} · коллизий: ${rows.filter(r => r.collision).length}`);
console.log('JSON → tools/_slugmap.json');
