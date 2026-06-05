#!/usr/bin/env node
'use strict';
// Сборка полной карты перемещений (dry-run, Фаза 2). Ничего не двигает.
// Вход: tools/_slugmap.json (персонажи), tools/_chronicle_map.json (модули→хроники).
// Выход: tools/_migration_map.json + сводка в консоль (+ коллизии/непокрытое).

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const MAP = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
};
const translit = s => s.toLowerCase().split('').map(ch => MAP[ch] !== undefined ? MAP[ch] : ch).join('');
const slugify = s => translit(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
// слаг для файла: сохраняем расширение. stripNum — срезать хвост «_<цифры>»
// (округ у .md-карточек локаций); для картинок НЕ срезаем (это номера вариантов).
function slugFile(name, stripNum) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return slugify(name);
  const ext = name.slice(dot).toLowerCase();
  let stem = name.slice(0, dot);
  if (stripNum) stem = stem.replace(/_\d+$/, '');
  return slugify(stem) + ext;
}

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const listDirs = p => isDir(p) ? fs.readdirSync(p).filter(n => isDir(path.join(p, n))) : [];
function walk(rel) {
  const abs = path.join(ROOT, rel), out = [];
  if (!fs.existsSync(abs)) return out;
  for (const n of fs.readdirSync(abs)) {
    const r = rel + '/' + n;
    if (isDir(path.join(ROOT, r))) out.push(...walk(r)); else out.push(r);
  }
  return out;
}

const slugmap = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '_slugmap.json'), 'utf8'));
const chronMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '_chronicle_map.json'), 'utf8'));

const moves = [];
const unmapped = [];

// ── Персонажи ───────────────────────────────────────────────────────────
function charFile(newDir, name, slug, rel) {
  const parts = rel.split('/');
  if (rel === name + '.md') return `${newDir}/${slug}.md`;
  if (rel === name + '-лист.md') return `${newDir}/${slug}-sheet.md`;
  if (parts[0].startsWith('Journal_')) return `${newDir}/journal/${parts.slice(1).join('/')}`;
  if (parts.length === 1 && /\.(png|jpe?g|webp|gif)$/i.test(rel)) return `${newDir}/art/${slugFile(rel)}`;
  return `${newDir}/${rel}`;
}
for (const e of slugmap) {
  const name = path.basename(e.old_path);
  const newDir = `cities/paris/characters/${e.lineage}/${e.slug}`;
  for (const f of walk(e.old_path)) moves.push({ old: f, new: charFile(newDir, name, e.slug, f.slice(e.old_path.length + 1)), kind: 'character' });
}

// ── Модули → хроники ────────────────────────────────────────────────────
const DATE_RE = /^(январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)_\d{4}_/;
const bareModuleName = folder => folder.replace(DATE_RE, '').replace(/^лос-анджелес_/, '');
const MODFILE = { 'нпс': 'npc', 'финал': 'finale', 'сценарий': 'scenario' };
function moduleFile(bareName, modslug, rel) {
  return rel.split('/').map((s, i, arr) => {
    if (!((i === arr.length - 1) && s.includes('.'))) return slugify(s);
    const dot = s.lastIndexOf('.'), ext = s.slice(dot).toLowerCase(), stem = s.slice(0, dot);
    if (stem === bareName) return modslug + ext;                       // главный файл модуля
    const lm = stem.match(/^(.*)-лист$/); if (lm) return slugify(lm[1]) + '-sheet' + ext;
    if (MODFILE[stem]) return MODFILE[stem] + ext;
    return slugify(stem) + ext;
  }).join('/');
}
const modLookup = {};
for (const [city, chrons] of Object.entries(chronMap))
  for (const [chr, def] of Object.entries(chrons))
    for (const m of def.modules) modLookup[m] = { city, chr };
for (const folder of listDirs(path.join(ROOT, 'modules'))) {
  const info = modLookup[folder];
  if (!info) { unmapped.push(`modules/${folder} (нет в _chronicle_map.json)`); continue; }
  const bare = bareModuleName(folder), modslug = slugify(bare);
  const newDir = `cities/${info.city}/chronicles/${info.chr}/modules/${modslug}`;
  for (const f of walk(`modules/${folder}`)) moves.push({ old: f, new: `${newDir}/${moduleFile(bare, modslug, f.slice(`modules/${folder}`.length + 1))}`, kind: 'module' });
}

// ── Локации (гибкая глубина) ────────────────────────────────────────────
function locNew(rel) {
  const segs = rel.split('/');
  if (segs.length === 1) return `cities/paris/locations/${slugFile(segs[0])}`; // бесхозный файл
  const tm = segs[0].match(/^(.+)_([^_]+)$/);
  const numeric = tm && /^\d+$/.test(tm[2]);
  const district = numeric ? 'district_' + tm[2].padStart(2, '0') : slugify(segs[0]);
  const rayon = numeric ? slugify(tm[1]) : null;
  const inner = segs.slice(1).map((s, i, arr) => {
    const isFile = (i === arr.length - 1) && /\.[a-z0-9]+$/i.test(s);
    return isFile ? slugFile(s, s.toLowerCase().endsWith('.md')) : slugify(s.replace(/_\d+$/, ''));
  });
  return ['cities/paris/locations', district, ...(rayon ? [rayon] : []), ...inner].join('/');
}
for (const f of walk('locations')) moves.push({ old: f, new: locNew(f.slice('locations/'.length)), kind: 'location' });

// ── Правила и архивы (статическая карта) ────────────────────────────────
const STATIC = {
  'rules/npcs_city.md': 'system/rules/npcs_city.md',
  'rules/module_rules.md': 'system/rules/module_rules.md',
  'rules/diary_rules.md': 'system/rules/diary_rules.md',
  'rules/chronicle_paris.md': 'system/rules/chronicle.md',
  'rules/character_sheet_v20.md': 'system/rules/character_sheet_v20.md',
  'rules/portret.md': 'system/rules/portret.md',
  'rules/CHECKLIST.md': 'system/rules/CHECKLIST.md',
  'rules/reference_wod.md': 'system/rules/reference_wod.md',
  'rules/timeline_paris.md': 'cities/paris/archive/timeline.md',
  'rules/open_threads.md': 'cities/paris/archive/open_threads.md',
  'rules/npc_image_mapping.md': '__DELETE__',
  'factions_paris.md': 'cities/paris/archive/political_state.md',
  'rumors_elysium.md': 'cities/paris/archive/rumors_elysium.md',
  'rumors_dreaming.md': 'cities/paris/archive/rumors_dreaming.md',
  'characters/characters_ALL.md': 'cities/paris/archive/characters_index.md',
  'Stories_of_Paris.md': 'cities/paris/archive/events.md',
};
for (const [old, dst] of Object.entries(STATIC)) {
  if (!fs.existsSync(path.join(ROOT, old))) { unmapped.push(`${old} (файл не найден)`); continue; }
  moves.push({ old, new: dst === '__DELETE__' ? null : dst, kind: dst === '__DELETE__' ? 'delete' : 'static' });
}
for (const f of walk('rules')) if (!(f in STATIC)) unmapped.push(`${f} (правило не задано)`);

// ── Коллизии ────────────────────────────────────────────────────────────
const byNew = new Map();
for (const m of moves) if (m.new) { if (!byNew.has(m.new)) byNew.set(m.new, []); byNew.get(m.new).push(m.old); }
const collisions = [...byNew.entries()].filter(([, v]) => v.length > 1);

fs.writeFileSync(path.join(ROOT, 'tools', '_migration_map.json'), JSON.stringify(moves, null, 2), 'utf8');

// ── Сводка ──────────────────────────────────────────────────────────────
const by = k => moves.filter(m => m.kind === k).length;
console.log('КАРТА ПЕРЕМЕЩЕНИЙ (dry) — файлов:', moves.length);
console.log(`  персонажи: ${by('character')} · модули: ${by('module')} · локации: ${by('location')} · правила/архив: ${by('static')} · удалить: ${by('delete')}`);
console.log('\nПерсонаж (пример полной сущности):');
for (const m of moves.filter(m => m.old.includes('Верене де Кюстин'))) console.log(`  ${m.old}\n   → ${m.new}`);
console.log('\nМодули (главные файлы):');
for (const m of moves.filter(m => m.kind === 'module' && /modules\/[^/]+\/[^/]+\.md$/.test(m.new) && path.basename(m.new, '.md') === m.new.split('/').slice(-2)[0])) console.log(`  ${m.old}\n   → ${m.new}`);
console.log('\nЛокации (примеры):');
for (const m of moves.filter(m => m.kind === 'location').slice(0, 5)) console.log(`  ${m.old}\n   → ${m.new}`);
console.log('\nКоллизии:', collisions.length);
for (const [n, v] of collisions.slice(0, 30)) console.log(`  ⚠ ${n}  ←  ${v.join(' | ')}`);
console.log('\nНепокрытое:', unmapped.length);
for (const u of unmapped) console.log('  •', u);
console.log('\nJSON → tools/_migration_map.json');
