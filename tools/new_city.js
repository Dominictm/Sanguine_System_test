#!/usr/bin/env node
'use strict';
// Создаёт каркас нового города в cities/<slug>/ (нейтральный, без привязки к домену).
// Запуск:  node tools/new_city.js <slug> "<Название>" [год]
//   slug — ASCII [a-z0-9_]; пример:  node tools/new_city.js london "Лондон" 2010

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');

const slug = (process.argv[2] || '').toLowerCase();
const display = process.argv[3] || slug;
const year = process.argv[4] || '20XX';
if (!/^[a-z0-9_]+$/.test(slug)) {
  console.error('Использование: node tools/new_city.js <slug:[a-z0-9_]> "<Название>" [год]');
  process.exit(1);
}
const base = path.join(ROOT, 'cities', slug);
if (fs.existsSync(base)) { console.error(`Город "${slug}" уже существует.`); process.exit(1); }

const W = (rel, txt) => { const a = path.join(base, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, txt, 'utf8'); };
const KEEP = rel => { const a = path.join(base, rel, '.gitkeep'); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, ''); };

W('city.md',
`# ${display}, ${year} — сеттинг города

> Шаблон. Опиши здесь свой домен: политический ландшафт, ключевые фракции и локации,
> атмосферу, лейтмотивы, чего избегать, источники. Этот файл — то, с чем сверяется
> Рассказчик перед сценой (см. CLAUDE.md → «Активный город»).

## Политический ландшафт
- …

## Ключевые локации
- …

## Чего избегать
- …
`);

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
KEEP('locations');
KEEP('rules');

console.log(`✓ Город «${display}» создан: cities/${slug}/`);
console.log(`  Дальше: опиши cities/${slug}/city.md, добавь персонажей (system/rules/npcs_city.md),`);
console.log(`  логируй сессии через веб (вкладка «Сессия», выбери город «${slug}»).`);
