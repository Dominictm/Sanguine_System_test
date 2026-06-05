#!/usr/bin/env node
'use strict';
// ИСПОЛНИТЕЛЬ миграции (Фазы 3-6). Двигает файлы по tools/_migration_map.json
// и переписывает ВСЕ внутренние ссылки во ВСЕХ .md (вкл. неперемещаемые, напр. CLAUDE.md).
// .md — читаются с сохранением BOM; бинарь (png/jpg) — копируется как есть.
// Запуск:  node tools/migrate_apply.js --apply
// Без --apply — только печатает, что будет сделано.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup'); // удалить старые оригиналы картинок + пустые папки

const MAPT = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
};
const slugify = s => s.toLowerCase().split('').map(c => MAPT[c] !== undefined ? MAPT[c] : c).join('')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const moves = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '_migration_map.json'), 'utf8'));
const slugmap = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '_slugmap.json'), 'utf8'));
const chronMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '_chronicle_map.json'), 'utf8'));

// ── Карта переименований (файлы + папки) для разрешения ссылок ───────────
const oldToNew = new Map();         // точное: файл old → new (или null=удалить)
for (const m of moves) oldToNew.set(m.old, m.new);

const prefixes = [];                // [oldPrefix, newPrefix] для startsWith
for (const m of moves) if (m.new) prefixes.push([m.old, m.new]);        // файлы (точно)
for (const e of slugmap) prefixes.push([e.old_path, `cities/paris/characters/${e.lineage}/${e.slug}`]);
const DATE_RE = /^(январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)_\d{4}_/;
for (const [city, chrons] of Object.entries(chronMap))
  for (const [chr, def] of Object.entries(chrons))
    for (const folder of def.modules) {
      const slug = slugify(folder.replace(DATE_RE, '').replace(/^лос-анджелес_/, ''));
      prefixes.push([`modules/${folder}`, `cities/${city}/chronicles/${chr}/modules/${slug}`]);
    }
// папки локаций (однозначны — карточка и арт в одной папке)
for (const m of moves) if (m.kind === 'location' && m.new) {
  const o = path.posix.dirname(m.old), n = path.posix.dirname(m.new);
  if (o !== '.' && !prefixes.some(([a]) => a === o)) prefixes.push([o, n]);
}
for (const lin of ['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters'])
  prefixes.push([`characters/${lin}`, `cities/paris/characters/${lin}`]);
prefixes.push(['characters', 'cities/paris/characters'], ['locations', 'cities/paris/locations']);
prefixes.sort((a, b) => b[0].length - a[0].length);

function remap(targetOld) {
  if (oldToNew.has(targetOld)) return oldToNew.get(targetOld);
  for (const [o, n] of prefixes) {
    if (targetOld === o) return n;
    if (targetOld.startsWith(o + '/')) return n + targetOld.slice(o.length);
  }
  return null;
}

// ── Перезапись ссылок ───────────────────────────────────────────────────
const dec = u => { try { return decodeURIComponent(u); } catch { return u; } };
const encSeg = s => s.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
const encPath = p => p.split('/').map(encSeg).join('/');
let linkChanges = 0;

// Возвращает новый путь (encoded) или null, если ссылка не меняется.
function remapUrl(u, oldDir, newDir) {
  let s = u.trim();
  if (/^(https?:|mailto:|tel:|#)/i.test(s)) return null;
  let anchor = '';
  const h = s.indexOf('#'); if (h >= 0) { anchor = s.slice(h); s = s.slice(0, h); }
  if (!s) return null;
  const mapped = remap(path.posix.normalize(path.posix.join(oldDir, dec(s))));
  if (mapped == null) return null;
  linkChanges++;
  return encPath(path.posix.relative(newDir, mapped) || '.') + anchor;
}

// Сканер: понимает ](<url с пробелами/скобками>) и ](url) с балансировкой скобок.
function rewrite(content, oldRel, newRel) {
  const oldDir = path.posix.dirname(oldRel), newDir = path.posix.dirname(newRel);
  let out = '', i = 0;
  while (true) {
    const open = content.indexOf('](', i);
    if (open === -1) { out += content.slice(i); break; }
    out += content.slice(i, open + 2);
    let j = open + 2, bracket = false, url, end;
    if (content[j] === '<') {
      const close = content.indexOf('>', j);
      if (close === -1) { out += content.slice(j); break; }
      bracket = true; url = content.slice(j + 1, close); end = close + 1;
    } else {
      let k = j, depth = 0;
      while (k < content.length) {
        const c = content[k];
        if (c === '(') depth++;
        else if (c === ')') { if (depth === 0) break; depth--; }
        else if (c === '\n') break;
        k++;
      }
      url = content.slice(j, k); end = k;
    }
    let title = '', u = url;
    const t = u.indexOf(' "'); if (t >= 0) { title = u.slice(t); u = u.slice(0, t); }
    const mapped = remapUrl(u, oldDir, newDir);
    const newU = mapped == null ? url : mapped + title;
    out += bracket ? '<' + newU + '>' : newU;
    i = end;
  }
  return out;
}

// ── Сбор всех .md (текущие пути) ─────────────────────────────────────────
function allMd(rel) {
  const out = [], abs = rel ? path.join(ROOT, rel) : ROOT;
  for (const n of fs.readdirSync(abs)) {
    if (n === '.git' || n === 'node_modules') continue;
    const r = rel ? rel + '/' + n : n;
    if (isDir(path.join(ROOT, r))) out.push(...allMd(r));
    else if (n.toLowerCase().endsWith('.md')) out.push(r);
  }
  return out;
}

// ── План записей ─────────────────────────────────────────────────────────
const writes = [];      // {newRel, data, bom}
const deleteOld = [];   // старые .md-пути для удаления (после записи)
for (const rel of allMd('')) {
  let c = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const bom = c.charCodeAt(0) === 0xFEFF; if (bom) c = c.slice(1);
  const newRel = oldToNew.has(rel) ? oldToNew.get(rel) : rel;
  if (newRel === null) { deleteOld.push(rel); continue; }     // удалить (npc_image_mapping)
  const out = rewrite(c, rel, newRel);
  writes.push({ newRel, data: (bom ? '﻿' : '') + out });
  if (newRel !== rel) deleteOld.push(rel);
}
const binMoves = moves.filter(m => m.new && !m.old.toLowerCase().endsWith('.md'));
const deletes = moves.filter(m => m.new === null && m.old.toLowerCase().endsWith('.md'));

console.log(`md-файлов обработано: ${writes.length} · перемещений .md: ${deleteOld.filter(r => oldToNew.get(r)).length} · бинарь: ${binMoves.length} · удалить: ${deletes.length}`);
console.log(`ссылок переписано: ${linkChanges}`);
if (!APPLY && !CLEANUP) { console.log('\n(dry — запусти --apply, затем после проверки --cleanup)'); process.exit(0); }

// ── Исполнение ───────────────────────────────────────────────────────────
const mkdirp = abs => fs.mkdirSync(path.dirname(abs), { recursive: true });
function prune(rel) {
  const abs = path.join(ROOT, rel); if (!fs.existsSync(abs) || !isDir(abs)) return;
  for (const n of fs.readdirSync(abs)) prune(rel + '/' + n);
  if (fs.existsSync(abs) && isDir(abs) && fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
}

if (CLEANUP) {
  // финальный шаг: удалить старые оригиналы (картинки и пр.) + пустые папки
  let removed = 0;
  for (const m of moves) { const a = path.join(ROOT, m.old); if (fs.existsSync(a)) { fs.unlinkSync(a); removed++; } }
  ['characters', 'modules', 'locations', 'rules'].forEach(prune);
  console.log(`✓ cleanup: удалено старых файлов ${removed}, пустые папки убраны`);
  process.exit(0);
}

// APPLY (image-safe): .md → запись new + удаление old; картинки → ТОЛЬКО копирование (оригиналы целы)
for (const w of writes) { const a = path.join(ROOT, w.newRel); mkdirp(a); fs.writeFileSync(a, w.data, 'utf8'); }
for (const m of binMoves) { const a = path.join(ROOT, m.new); mkdirp(a); fs.copyFileSync(path.join(ROOT, m.old), a); }
for (const rel of deleteOld) { const a = path.join(ROOT, rel); if (fs.existsSync(a)) fs.unlinkSync(a); } // только .md
for (const m of deletes) { const a = path.join(ROOT, m.old); if (fs.existsSync(a)) fs.unlinkSync(a); }       // npc_image_mapping.md
console.log('✓ apply завершён (image-safe: оригиналы картинок сохранены до --cleanup)');
