#!/usr/bin/env node
'use strict';
// Линтер карточек персонажей. Контракт — system/schema/card_schema.md.
// Запуск:  node system/schema/validate_cards.js [--strict]
// До Фазы 5 новые поля (Слаг/Родной город) дают WARNING; с --strict — ERROR.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const STRICT = process.argv.includes('--strict');

const LINEAGES = {
  vampires:  /Вампир/i,
  fairies:   /Фея|Ченджлинг/i,
  mortals:   /Смертн/i,
  werewolves:/Оборотень/i,
  mages:     /Маг/i,
  hunters:   /Охотник/i,
};
const STATUS = ['Жив', 'Жива', 'Торпор', 'Мёртв', 'Мертва', 'Уничтожен', 'Пропал', 'Неизвестно', 'Активен'];
const GENDER = ['Мужской', 'Женский'];

const isDir  = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = p => { try { return fs.existsSync(p); } catch { return false; } };
const listDirs = p => isDir(p) ? fs.readdirSync(p).filter(n => isDir(path.join(p, n))) : [];

// Находим корни персонажей: cities/<city>/characters/<lineage>/ либо legacy characters/<lineage>/
function discover() {
  const out = [];
  const cities = path.join(ROOT, 'cities');
  for (const city of listDirs(cities)) {
    const cd = path.join(cities, city, 'characters');
    for (const lin of listDirs(cd)) if (LINEAGES[lin]) out.push({ city, lineage: lin, dir: path.join(cd, lin) });
  }
  const legacy = path.join(ROOT, 'characters');
  for (const lin of listDirs(legacy)) if (LINEAGES[lin]) out.push({ city: '(legacy)', lineage: lin, dir: path.join(legacy, lin) });
  return out;
}

function field(content, name) {
  const re = new RegExp('^[\\-*]\\s*\\*\\*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\*\\*\\s*(.*)$', 'm');
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

const errors = [], warns = [];
const byCity = {};
const reg = city => byCity[city] || (byCity[city] = { slug: new Map(), name: new Map(), alias: new Map() });

let cardCount = 0;
for (const grp of discover()) {
  for (const slugDir of listDirs(grp.dir)) {
    const dir = path.join(grp.dir, slugDir);
    const main = path.join(dir, slugDir + '.md');
    const rel = path.relative(ROOT, main).replace(/\\/g, '/');
    if (!exists(main)) { errors.push(`${path.relative(ROOT, dir).replace(/\\/g, '/')}: нет главной карточки ${slugDir}.md`); continue; }
    cardCount++;
    let c = fs.readFileSync(main, 'utf8');
    if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1); // снять UTF-8 BOM
    const E = m => errors.push(`${rel}: ${m}`);
    const W = m => warns.push(`${rel}: ${m}`);
    const soft = STRICT ? E : W;

    if (!/^#\s+\S/m.test(c)) E('нет H1-заголовка');
    if (!/🔗/.test(c)) W('нет нав-ссылки 🔗');

    const lin = field(c, 'Линейка WoD');
    if (!lin) E('нет поля «Линейка WoD»');
    else if (!LINEAGES[grp.lineage].test(lin)) E(`«Линейка WoD: ${lin}» не соответствует папке ${grp.lineage}`);

    const st = field(c, 'Статус');
    if (!st) E('нет поля «Статус»');
    else if (!STATUS.some(s => st.startsWith(s))) E(`статус «${st}» вне enum`);

    if (!/##\s*🖼️?\s*Изображения/.test(c)) E('нет секции «## 🖼️ Изображения»');

    // Новое поле — обязательно при создании, но в карточках до его введения отсутствует.
    // Всегда WARNING (даже в --strict), пока не принято решение о массовом бэкфилле.
    const gender = field(c, 'Пол');
    if (!gender) W('нет поля «Пол»');
    else if (!GENDER.includes(gender)) W(`пол «${gender}» вне enum (Мужской/Женский)`);

    const r = reg(grp.city);
    const h1 = (c.match(/^#\s+(.*)$/m) || [])[1] || slugDir;
    const dn = h1.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (r.name.has(dn)) W(`display_name «${dn}» дублируется (${r.name.get(dn)})`);
    else r.name.set(dn, rel);

    const slug = field(c, 'Слаг');
    const home = field(c, 'Родной город');
    const aliases = field(c, 'Алиасы');

    if (!slug) soft('нет поля «Слаг»');
    else {
      if (!/^[a-z0-9_]+$/.test(slug)) E(`слаг «${slug}» не соответствует [a-z0-9_]`);
      if (r.slug.has(slug)) E(`слаг «${slug}» дублируется (${r.slug.get(slug)})`);
      else r.slug.set(slug, rel);
    }
    if (!home) soft('нет поля «Родной город»');

    if (aliases) for (const a of aliases.split(/[,;]/).map(s => s.trim()).filter(Boolean)) {
      if (r.alias.has(a)) W(`алиас «${a}» дублируется (${r.alias.get(a)})`);
      else r.alias.set(a, rel);
    }
  }
}

for (const r of Object.values(byCity))
  for (const [a, rel] of r.alias)
    if (r.name.has(a) && r.name.get(a) !== rel) errors.push(`${rel}: алиас «${a}» совпадает с именем другого персонажа (${r.name.get(a)})`);

for (const w of warns) console.log('  WARN  ' + w);
for (const e of errors) console.log('  ERROR ' + e);
console.log(`\nКарточек: ${cardCount} · ошибок: ${errors.length} · предупреждений: ${warns.length}${STRICT ? ' · режим: strict' : ''}`);
process.exit(errors.length ? 1 : 0);
