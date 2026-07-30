#!/usr/bin/env node
'use strict';
// Аудит после обновления (FIX-4b, docs/audit/2026-07-28-fix-plan.md): до этого
// фикса переименование персонажа не проверяло уникальность имени — если где-то
// в старых данных два персонажа делят одно отображаемое имя, раньше клик по
// карточке в списке «Персонажи» всегда открывал ПЕРВОГО по порядку, а второй
// был недостижим через интерфейс. С этой версии список/модалка резолвят
// персонажа по slug (папке), а не по имени — коллизия больше не ломает
// интерфейс, но остаётся визуально путающей (два одинаковых имени в списке).
// Скрипт ничего не меняет — только показывает, что нашлось, чтобы можно было
// решить, стоит ли переименовать одного из персонажей вручную.
//
// Запуск:  node tools/check_duplicate_names.js [city]
//   без аргумента — проверяет ВСЕ города в cities/

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');

// Тот же регекс, что parseCharacter() в web/lib/parsers/character.js — отбрасывает
// ведущий эмодзи, оставляет отображаемое имя ровно так, как его видит приложение.
const NAME_RE = /^#\s+[^\wЀ-ӿ]*([\wЀ-ӿ].+)$/m;

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function listCities() {
  const citiesDir = path.join(ROOT, 'cities');
  return fs.readdirSync(citiesDir)
    .filter(name => isDir(path.join(citiesDir, name)) && fs.existsSync(path.join(citiesDir, name, 'city.md')));
}

function findDuplicates(city) {
  const charsDir = path.join(ROOT, 'cities', city, 'characters');
  if (!isDir(charsDir)) return [];

  const byName = new Map(); // name → [{ slug, lineage }]
  for (const lineage of fs.readdirSync(charsDir).filter(n => isDir(path.join(charsDir, n)))) {
    if (lineage === '_deleted') continue;
    const lineageDir = path.join(charsDir, lineage);
    for (const slug of fs.readdirSync(lineageDir).filter(n => isDir(path.join(lineageDir, n)))) {
      const cardPath = path.join(lineageDir, slug, `${slug}.md`);
      let content;
      try { content = fs.readFileSync(cardPath, 'utf-8').replace(/^﻿/, ''); }
      catch { continue; }
      const m = content.match(NAME_RE);
      const name = m ? m[1].trim() : slug;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ slug, lineage });
    }
  }

  const dups = [];
  for (const [name, entries] of byName) {
    if (entries.length > 1) dups.push({ name, entries });
  }
  return dups;
}

const target = process.argv[2];
const cities = target ? [target] : listCities();

if (!cities.length) {
  console.error('Города не найдены (нет папок с city.md в cities/).');
  process.exit(1);
}

let totalDups = 0;
for (const city of cities) {
  const dups = findDuplicates(city);
  if (!dups.length) {
    console.log(`✓ ${city}: коллизий имён не найдено`);
    continue;
  }
  totalDups += dups.length;
  console.log(`⚠ ${city}: найдено ${dups.length} коллизи${dups.length === 1 ? 'я' : 'и'} имён —`);
  for (const { name, entries } of dups) {
    console.log(`  «${name}»:`);
    for (const { slug, lineage } of entries) {
      console.log(`    - cities/${city}/characters/${lineage}/${slug}/${slug}.md`);
    }
  }
}

console.log('');
if (totalDups === 0) {
  console.log('Ничего чинить не нужно — с этой версией клик по карточке и все действия в модалке (сохранение, генерация, Лист V20, дневники, удаление) уже резолвятся по slug (папке), а не по имени, так что даже коллизия, найденная выше, не ломает интерфейс.');
} else {
  console.log('Каждый персонаж выше по-прежнему корректно открывается и редактируется отдельно (slug у них разный) — переименовывать НЕ обязательно. Если совпадение случайное (не два разных персонажа с одним именем по сюжету), можно переименовать одного через карточку → «Информация» → «Редактировать», чтобы не путаться визуально в списках/выпадающих меню.');
}
process.exit(0);
