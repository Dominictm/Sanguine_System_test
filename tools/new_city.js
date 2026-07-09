#!/usr/bin/env node
'use strict';
// Создаёт каркас нового города в cities/<slug>/ (нейтральный, без привязки к домену).
// Запуск:  node tools/new_city.js <slug> "<Название>" <год> [политика] [локации] [лейтмотивы] [специфика] [избегать] [источники] [районы]
//   slug — ASCII [a-z0-9_]; пример:  node tools/new_city.js london "Лондон" 2010
//   текстовые поля — многострочные (по строке на пункт), районы — список через запятую.
//
// ОТЛИЧИЕ ОТ ВЕБА (намеренное): здесь slug задаётся ЯВНО (первый аргумент), тогда как
// веб-форма выводит slug из названия через slugify. Явный slug нужен для скриптов и
// изоляции (контролируемое имя папки независимо от названия — напр. тесты создают
// e2e_<ts> с человеческим названием «Тестополис»). Год обязателен и валидируется как
// на сервере (3–4 цифры) — общего плейсхолдера «20XX» в пути создания нет.

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const { cityScaffold } = require('../web/lib/parsers');

const USAGE = 'Использование: node tools/new_city.js <slug:[a-z0-9_]> "<Название>" <год:3–4 цифры> [политика] [локации] [лейтмотивы] [специфика] [избегать] [источники] [районы]';
const slug = (process.argv[2] || '').toLowerCase();
const display = process.argv[3] || slug;
const year = process.argv[4] || '';
const [political, locationsTxt, leitmotif, specifics, avoid, sources, districtsCsv] = process.argv.slice(5);
if (!/^[a-z0-9_]+$/.test(slug)) {
  console.error(USAGE);
  process.exit(1);
}
if (!/^\d{3,4}$/.test(year)) {
  console.error(`Год обязателен и должен быть 3–4 цифрами (например 2010).\n${USAGE}`);
  process.exit(1);
}
const base = path.join(ROOT, 'cities', slug);
if (fs.existsSync(base)) { console.error(`Город "${slug}" уже существует.`); process.exit(1); }

try {
  const W = (rel, txt) => { const a = path.join(base, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, txt, 'utf8'); };
  const KEEP = rel => { const a = path.join(base, rel, '.gitkeep'); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, ''); };

  // Каркас (city.md + archive/* + пустые папки) — единый источник с POST /api/cities,
  // см. cityScaffold в web/lib/parsers.js.
  const { files, keepDirs } = cityScaffold({
    display, year,
    political, locations: locationsTxt, leitmotif, specifics, avoid, sources,
    districts: districtsCsv,
  });
  for (const [rel, txt] of Object.entries(files)) W(rel, txt);
  for (const rel of keepDirs) KEEP(rel);

  console.log(`✓ Город «${display}» создан: cities/${slug}/`);
  console.log(`  Дальше: опиши cities/${slug}/city.md, добавь персонажей (system/rules/npcs_city.md),`);
  console.log(`  логируй сессии через веб (вкладка «Сессия», выбери город «${slug}»).`);
} catch (e) {
  console.error(`Не удалось создать город "${slug}": ${e.message}`);
  process.exit(1);
}
