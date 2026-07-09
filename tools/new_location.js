#!/usr/bin/env node
'use strict';
// Создаёт карточку локации в cities/<city>/locations/<district>/[<район>/]<slug>/<slug>.md
// Запуск:  node tools/new_location.js <city> <district> "<Название>" ["<район>"] [зона]
//   district: число (→ district_NN) или slug; зона ∈ safe|neutral|dangerous (по умолч. neutral)
//   пример: node tools/new_location.js london 1 "Театр Лицей" "Вест-Энд" dangerous

const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const { slugify } = require('../web/lib/parsers');  // single source of truth for RU→ASCII slugs

const ZONES = { safe: '🟢 Безопасная', neutral: '🟡 Нейтральная', dangerous: '🔴 Опасная' };
const [city, districtRaw, name, rayon, zoneKey] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5] || '', process.argv[6] || 'neutral'];
if (!city || !districtRaw || !name) {
  console.error('Использование: node tools/new_location.js <city> <district> "<Название>" ["<район>"] [safe|neutral|dangerous]');
  process.exit(1);
}
const cityDir = path.join(ROOT, 'cities', city);
if (!fs.existsSync(cityDir)) { console.error(`Город "${city}" не найден.`); process.exit(1); }

const district = /^\d+$/.test(districtRaw) ? 'district_' + districtRaw.padStart(2, '0') : slugify(districtRaw);
const locSlug = slugify(name);
if (!locSlug) { console.error('Не удалось собрать slug из названия.'); process.exit(1); }
const parts = ['locations', district, ...(rayon ? [slugify(rayon)] : []), locSlug];
const dir = path.join(cityDir, ...parts);
if (fs.existsSync(dir)) { console.error(`Локация "${locSlug}" уже существует по этому пути.`); process.exit(1); }
const zone = ZONES[zoneKey] || ZONES.neutral;

const card = `# 📍 ${name}

- **Название:** ⚠️ тип локации
- **Округ:** ${districtRaw}
${rayon ? `- **Район:** ${rayon}\n` : ''}- **Адрес:** ⚠️ Требуется уточнение
- **Зона:** ${zone}
- **Контроль:** ⚠️ Требуется уточнение

---

## 🎭 Атмосфера

⚠️ Сенсорная палитра: что видно, слышно, пахнет; свет, фактуры, звуки.

---

## 🩸 VtM-контекст

| Параметр | Значение |
|---|---|
| **Статус** | ⚠️ |
| **Фракция** | ⚠️ |
| **Постоянные фигуры** | ⚠️ |
| **Угрозы** | ⚠️ |
| **Маскарад** | 🟡 Средний |

---

## 🪝 Сценарные крючки

1. ⚠️ Зацепка
2. ⚠️ Угроза/тайна

---

## 🎨 Промт для генерации изображения

**GPT/DALL-E**:
\`\`\`
⚠️ Заполнить по system/rules/portret.md (локация, [город] [год], night)
\`\`\`

## 🖼️ Изображения
- ⏳ Изображение не предоставлено
`;

try {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${locSlug}.md`), card, 'utf8');
  console.log(`✓ Локация «${name}» создана: cities/${city}/${parts.join('/')}/${locSlug}.md`);
  console.log(`  Заполни поля ⚠️ (атмосфера, VtM-контекст, крючки, промт) — по system/rules/portret.md.`);
} catch (e) {
  console.error(`Не удалось создать локацию "${locSlug}": ${e.message}`);
  process.exit(1);
}
