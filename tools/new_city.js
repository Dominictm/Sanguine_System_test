#!/usr/bin/env node
'use strict';
// Создаёт каркас нового города в cities/<slug>/ (нейтральный, без привязки к домену).
// Запуск:  node tools/new_city.js <slug> "<Название>" [год] [политика] [локации] [лейтмотивы] [специфика] [избегать] [источники] [районы]
//   slug — ASCII [a-z0-9_]; пример:  node tools/new_city.js london "Лондон" 2010
//   текстовые поля — многострочные (по строке на пункт), районы — список через запятую.

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const { slugify, buildCityMd } = require('../web/lib/parsers');

const slug = (process.argv[2] || '').toLowerCase();
const display = process.argv[3] || slug;
const year = process.argv[4] || '20XX';
const [political, locationsTxt, leitmotif, specifics, avoid, sources, districtsCsv] = process.argv.slice(5);
if (!/^[a-z0-9_]+$/.test(slug)) {
  console.error('Использование: node tools/new_city.js <slug:[a-z0-9_]> "<Название>" [год]');
  process.exit(1);
}
const base = path.join(ROOT, 'cities', slug);
if (fs.existsSync(base)) { console.error(`Город "${slug}" уже существует.`); process.exit(1); }

const W = (rel, txt) => { const a = path.join(base, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, txt, 'utf8'); };
const KEEP = rel => { const a = path.join(base, rel, '.gitkeep'); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, ''); };

// city.md — собирается общим билдером (единый шаблон с веб-формой, см. web/lib/parsers.js).
W('city.md', buildCityMd({
  display, year,
  political, locations: locationsTxt, leitmotif, specifics, avoid, sources,
}));

W('archive/events.md',
`# 📖 Хроника «${display}» — События

> 🔗 Все персонажи — [characters_index.md](characters_index.md)
> 🔗 Протокол записей — [chronicle.md](../../../system/rules/chronicle.md)

---

## 🌍 Состояние мира

> Обновляется после каждой сессии.
> Последнее обновление: **—**.

---

## 📋 Сводная хроника событий

> Агрегат из \`chronicles/<хроника>/events.md\`. Индекс генерируется \`tools/build_city_events.js\` — вручную не править.

<!-- AUTO:events-index -->
<!-- /AUTO:events-index -->
`);

W('archive/political_state.md',
`# Карта фракций — ${display}, ${year}

> Шаблон. Кто контролирует домен, иерархия, ключевые NPC, конфликты.

| Должность | Персонаж | Клан | Примечание |
|---|---|---|---|
|  |  |  |  |
`);

W('archive/characters_index.md',
`# Персонажи — ${display}

> Сводник. Добавляется при создании карточек (по \`system/rules/npcs_city.md\`).
`);

W('archive/visitors.md',
`# Гости из других городов — ${display}

> Персонажи с \`Родной город\` ≠ ${display}, присутствующие здесь. Только ссылки —
> карточка-источник живёт в родном городе (один источник истины).

| Персонаж | Родной город | Появление |
|---|---|---|
|  |  |  |
`);

for (const lin of ['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters']) KEEP(`characters/${lin}`);
KEEP('chronicles');
KEEP('rules');

const districts = (districtsCsv || '').split(',').map(d => d.trim()).filter(Boolean);
if (districts.length) {
  districts.forEach((d, i) => {
    const num = String(i + 1).padStart(2, '0');
    KEEP(`locations/district_${num}/${slugify(d) || `rayon_${num}`}`);
  });
} else {
  KEEP('locations');
}

console.log(`✓ Город «${display}» создан: cities/${slug}/`);
console.log(`  Дальше: опиши cities/${slug}/city.md, добавь персонажей (system/rules/npcs_city.md),`);
console.log(`  логируй сессии через веб (вкладка «Сессия», выбери город «${slug}»).`);
