#!/usr/bin/env node
'use strict';
// Создаёт карточку персонажа в cities/<city>/characters/<lineage>/<slug>/<slug>.md
// со всеми обязательными полями (контракт system/schema/card_schema.md).
// Запуск:  node tools/new_npc.js <city> <lineage> "<Имя>" <Мужской|Женский> ["<Клан/Раса>"]
//   lineage ∈ vampires|fairies|mortals|werewolves|mages|hunters
//   пример: node tools/new_npc.js london vampires "Эдвард Грей" Мужской "Вентру"

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const { slugify } = require('../web/lib/parsers');  // single source of truth for RU→ASCII slugs

const LINEAGE = {
  vampires: 'Вампир', fairies: 'Фея / Ченджлинг', mortals: 'Смертный',
  werewolves: 'Оборотень', mages: 'Маг', hunters: 'Охотник'
};
const GENDER = ['Мужской', 'Женский'];

const [city, lineage, name, gender, clan, sect, role, belonging] = [
  process.argv[2], process.argv[3], process.argv[4], process.argv[5],
  process.argv[6] || '', process.argv[7] || '', process.argv[8] || '',
  process.argv[9] || 'Персонаж мастера'
];
if (!city || !LINEAGE[lineage] || !name || !GENDER.includes(gender)) {
  console.error('Использование: node tools/new_npc.js <city> <vampires|fairies|mortals|werewolves|mages|hunters> "<Имя>" <Мужской|Женский> ["<Клан>"] ["<Секта>"] ["<Роль>"]');
  process.exit(1);
}
const cityDir = path.join(ROOT, 'cities', city);
if (!fs.existsSync(cityDir)) { console.error(`Город "${city}" не найден. Создай: node tools/new_city.js ${city} "<Название>"`); process.exit(1); }

const slug = slugify(name);
if (!slug) { console.error('Не удалось собрать slug из имени.'); process.exit(1); }
const dir = path.join(cityDir, 'characters', lineage, slug);
if (fs.existsSync(dir)) { console.error(`Персонаж "${slug}" уже существует в ${city}/${lineage}.`); process.exit(1); }

// display-имя города из city.md (H1 до запятой/тире), иначе slug города
let cityName = city;
try {
  const cm = fs.readFileSync(path.join(cityDir, 'city.md'), 'utf8').replace(/^﻿/, '');
  const m = cm.match(/^#\s+(.+)$/m);
  if (m) cityName = m[1].replace(/^[^\p{L}\p{N}]+/u, '').split(/[,—–-]/)[0].trim();
} catch {}

const emoji = { vampires: '🧛', fairies: '🧚', mortals: '🧑', werewolves: '🐺', mages: '🔮', hunters: '🏹' }[lineage];
const card = `# ${emoji} ${name}

> 🔗 [Все персонажи](../../../archive/characters_index.md)

---

- **Слаг:** ${slug}
- **Родной город:** ${cityName}
- **Линейка WoD:** ${LINEAGE[lineage]}
- **Пол:** ${gender}
- **Клан / Раса:** ${clan || '⚠️ Требуется уточнение'}
- **Секта / Двор:** ${sect || '⚠️ Требуется уточнение'}
- **Статус:** Жив
- **Роль:** ${role || '⚠️ Требуется уточнение'}
- **Принадлежность:** ${belonging}
- **Биография:** ⚠️ Требуется уточнение
- **Внешность:** ⚠️ Требуется уточнение (3–5 визуальных маркеров)
- **Голос:** ⚠️ Требуется уточнение
- **Отношения:**
  - —
- **🎨 Промт для генерации изображения:**
  ⏳ Заполнить по system/rules/portret.md (3 блока)
- **🚫 Негативный промт:**
  photorealistic photography, anime, cartoon, watermark, text, blurry, deformed anatomy, extra limbs, bright white background, 3D render, CGI.

---

## 🖼️ Изображения
- ⏳ Изображение не предоставлено
`;

const W = (rel, txt) => { const a = path.join(dir, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, txt, 'utf8'); };
W(`${slug}.md`, card);
fs.mkdirSync(path.join(dir, 'art'), { recursive: true }); fs.writeFileSync(path.join(dir, 'art', '.gitkeep'), '');
fs.mkdirSync(path.join(dir, 'journal'), { recursive: true }); fs.writeFileSync(path.join(dir, 'journal', '.gitkeep'), '');

// добавить в сводник
const idx = path.join(cityDir, 'archive', 'characters_index.md');
try {
  let raw = fs.readFileSync(idx, 'utf8'); const bom = raw.charCodeAt(0) === 0xFEFF; let c = bom ? raw.slice(1) : raw;
  c = c.replace(/\s*$/, '') + `\n- [${name}](../characters/${lineage}/${slug}/${slug}.md) — ${LINEAGE[lineage]}${clan ? `, ${clan}` : ''}\n`;
  fs.writeFileSync(idx, (bom ? '﻿' : '') + c, 'utf8');
} catch {}

console.log(`✓ Персонаж «${name}» создан: cities/${city}/characters/${lineage}/${slug}/${slug}.md`);
console.log(`  Заполни поля ⚠️ (биография, внешность, голос, промт) — по system/rules/npcs_city.md.`);
