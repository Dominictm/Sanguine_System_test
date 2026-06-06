#!/usr/bin/env node
'use strict';
// Создаёт карточку персонажа в cities/<city>/characters/<lineage>/<slug>/<slug>.md
// со всеми обязательными полями (контракт system/schema/card_schema.md).
// Запуск:  node tools/new_npc.js <city> <lineage> "<Имя>" ["<Клан/Раса>"]
//   lineage ∈ vampires|fairies|mortals|werewolves|mages|hunters
//   пример: node tools/new_npc.js london vampires "Эдвард Грей" "Вентру"

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');

const LINEAGE = {
  vampires: 'Вампир', fairies: 'Фея / Ченджлинг', mortals: 'Смертный',
  werewolves: 'Оборотень', mages: 'Маг', hunters: 'Охотник'
};
const _TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
const slugify = s => s.toLowerCase().split('').map(c => _TR[c] !== undefined ? _TR[c] : c).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');

const [city, lineage, name, clan, sect, role] = [
  process.argv[2], process.argv[3], process.argv[4],
  process.argv[5] || '', process.argv[6] || '', process.argv[7] || ''
];
if (!city || !LINEAGE[lineage] || !name) {
  console.error('Использование: node tools/new_npc.js <city> <vampires|fairies|mortals|werewolves|mages|hunters> "<Имя>" ["<Клан>"] ["<Секта>"] ["<Роль>"]');
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
- **Клан / Раса:** ${clan || '⚠️ Требуется уточнение'}
- **Секта / Двор:** ${sect || '⚠️ Требуется уточнение'}
- **Статус:** Жив
- **Роль:** ${role || '⚠️ Требуется уточнение'}
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
