#!/usr/bin/env node
'use strict';
// Создаёт карточку района (Город → Район → Локация) — cities/<city>/locations/<slug>/district.md.
// Позволяет завести район в УЖЕ существующем городе в любой момент (не только при
// создании города через tools/new_city.js) — план 2026-08-02-city-creation-restructure,
// §5.1 «Добавление района в существующий город».
// Запуск:  node tools/new_district.js <city> "<Название>" [тип] [секта] [клан] [описание]
//   пример: node tools/new_district.js paris "Ла-Виллет" "Пром-зона" "Носферату" "" "Бывшие скотобойни у канала."

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const { slugify, buildDistrictMd, DISTRICT_FILENAME } = require('../web/lib/parsers');  // single source of truth, как cityScaffold/buildCityMd

const [city, name, type, sect, clan, description] = [
  process.argv[2], process.argv[3], process.argv[4] || '', process.argv[5] || '', process.argv[6] || '', process.argv[7] || '',
];
if (!city || !name) {
  console.error('Использование: node tools/new_district.js <city> "<Название>" [тип] [секта] [клан] [описание]');
  process.exit(1);
}
const cityDir = path.join(ROOT, 'cities', city);
if (!fs.existsSync(cityDir)) { console.error(`Город "${city}" не найден.`); process.exit(1); }

const districtSlug = slugify(name);
if (!districtSlug) { console.error('Не удалось собрать slug из названия.'); process.exit(1); }
const dir = path.join(cityDir, 'locations', districtSlug);
if (fs.existsSync(dir)) { console.error(`Район "${districtSlug}" уже существует по этому пути.`); process.exit(1); }

const md = buildDistrictMd({ name, type, sect, clan, description });

try {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, DISTRICT_FILENAME), md, 'utf8');
  console.log(`✓ Район «${name}» создан: cities/${city}/locations/${districtSlug}/${DISTRICT_FILENAME}`);
  if (!type || !sect || !clan || !description) console.log('  Заполни поля ⚠️ (тип района, влияние, описание).');
} catch (e) {
  console.error(`Не удалось создать район "${districtSlug}": ${e.message}`);
  process.exit(1);
}
