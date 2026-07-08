# Foundry Sync Phase 1 (экспорт/импорт вампирских персонажей) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю кнопки «Экспорт в Foundry» / «Импорт из Foundry» на V20-листе вампира в Sanguine, конвертирующие данные листа в/из формата, который штатный Foundry «Import Data»/«Export Data» понимает — без прямого доступа к LevelDB.

**Architecture:** Два чистых mapper-модуля на сервере (`web/lib/foundry-export.js`, `web/lib/foundry-import.js`) конвертируют между JSON-моделью Sanguine (`<slug>-sheet.json`, та же форма, что строит `_v20Empty()` в `web/public/scripts.js`) и JSON-моделью Foundry Actor (`worldofdarkness` v7.1.5, схема подтверждена в `docs/superpowers/specs/2026-07-08-foundry-integration-design.md`). Два новых роута в `web/routes/characters.js` дают файл на скачивание / принимают загруженный файл. Клиент — новые кнопки в панели инструментов V20-листа, по образцу уже существующего экспорта/импорта карточек (`btn-export-chars`/`btn-import-chars`, `web/public/scripts.js:9812-9824`).

**Tech Stack:** Node.js/Express (сервер), vanilla JS (клиент, без сборщика — файлы подключены `<script>`-тегами), `node:test` (юнит- и интеграционные тесты, `web/tests/all.test.js`).

---

## ⚠️ Важные уточнения по ходу исследования кода (перед тем как начинать)

Пока искал точные структуры для плана, нашлись два расхождения с таблицей маппинга раздела 2 спеки — план ниже их учитывает:

1. **Достоинства/Недостатки (`meritsFlaws`) в реальной модели Sanguine — не таблица «Название/Тип/Очки», а один многострочный `<textarea>`** (`web/public/scripts.js:7306`, `data-tpath="meritsFlaws"`, placeholder «По строке на пункт…»), где перемешаны и достоинства, и недостатки одной массой, без структурированных очков. Оба реальных фикстур-персонажа (`alen_dyubua`, `graf_zhubaka`) имеют это поле пустым. Программно разделить «достоинство/недостаток» и очки из вольного текста нельзя, не придумывая эвристику, которая будет молча ошибаться. План экспортирует этот текст в `system.notes` Foundry (реальное HTML-поле партиала `base`, раздел 1.3 спеки) как есть — без попытки создать embedded `Item` типа `Feature` для каждой строки. Это осознанное сужение объёма, а не пробел.
2. **Здоровье Foundry — не параллельный набор булевых отметок, а очки урона.** Реальный экспорт персонажа (раздел 1.7 спеки) показывает: `health.bruised/hurt/.../incapacitated` у **любого** персонажа всегда `{value:1,total:1,penalty:N}` — это описание самих уровней («слот существует»), а не отметка «помят/не помят». Актуальный урон хранится отдельно — `health.damage.{bashing,lethal,aggravated}` (счётчик очков), из которого сама система вычисляет `woundlevel`/`woundpenalty`. Sanguine хранит ровно противоположное: 7 булевых полей «отмечен ли уровень», без разбивки по типу урона. План маппит количество отмеченных Sanguine-уровней в `health.damage.lethal` (Sanguine не различает тип урона — «летальный» выбран как разумный дефолт для вампирского персонажа) и **не пишет** `health.<level>.value/total/penalty` — они получаются производными, как и `soak`/`initiative`/`movement` (решение раздела 6, п.6 спеки).

---

## Task 1: `web/lib/foundry-clans.js` — таблицы клан/секта/поколение

**Files:**
- Create: `web/lib/foundry-clans.js`
- Test: `web/tests/all.test.js` (новый `describe` блок в существующем unit-разделе)

Модуль без побочных эффектов: RU-название клана/секты (как в `system/rules/character_sheet_v20.md` / карточке персонажа) ⇄ i18n-ключ Foundry (`wod.bio.vampire.<key>`, подтверждено разделом 1.7 спеки и файлом `ru-ru`). Плюс парсер строки поколения Sanguine («7-е») в число и таблица `bloodMax` по поколению (зеркало `RULES_V20.generations` из `web/public/rules-v20.js:25-37`, тем же способом дублирования, что уже практикуется в проекте — см. комментарий вверху `rules-v20.js`: «Зеркало ключевых таблиц... При правке таблиц в этих файлах — обновить и здесь»).

- [ ] **Step 1: Написать падающий тест**

Добавить в `web/tests/all.test.js` внутри `describe('Parsers — unit', ...)` (после блока `describe('parseCharacter', ...)`, около строки 496) новый блок:

```javascript
  describe('foundry-clans', () => {
    const {
      clanRuToFoundryKey, clanFoundryKeyToRu,
      sectRuToFoundryKey, sectFoundryKeyToRu,
      parseGenerationNumber, bloodMaxForGeneration,
    } = require('../lib/foundry-clans');

    it('clanRuToFoundryKey — известный клан', () => {
      assert.equal(clanRuToFoundryKey('Малкавиан'), 'malkavian');
      assert.equal(clanRuToFoundryKey('Вентру'), 'ventrue');
      assert.equal(clanRuToFoundryKey('тореадор'), 'toreador'); // регистронезависимо
    });
    it('clanRuToFoundryKey — неизвестный клан → null', () => {
      assert.equal(clanRuToFoundryKey('Каппадокийцы'), null);
      assert.equal(clanRuToFoundryKey('Истинный Бруха'), null);
    });
    it('clanFoundryKeyToRu — обратное преобразование', () => {
      assert.equal(clanFoundryKeyToRu('malkavian'), 'Малкавиан');
      assert.equal(clanFoundryKeyToRu('nosuchclan'), null);
    });
    it('sectRuToFoundryKey / sectFoundryKeyToRu', () => {
      assert.equal(sectRuToFoundryKey('Камарилья'), 'camarilla');
      assert.equal(sectRuToFoundryKey('Шабаш'), 'sabbat');
      assert.equal(sectFoundryKeyToRu('camarilla'), 'Камарилья');
      assert.equal(sectRuToFoundryKey('Нет такой секты'), null);
    });
    it('parseGenerationNumber — «N-е» → число', () => {
      assert.equal(parseGenerationNumber('7-е'), 7);
      assert.equal(parseGenerationNumber('13-е'), 13);
      assert.equal(parseGenerationNumber('нет данных'), null);
    });
    it('bloodMaxForGeneration — по таблице RULES_V20', () => {
      assert.equal(bloodMaxForGeneration(7), 20);
      assert.equal(bloodMaxForGeneration(13), 10);
      assert.equal(bloodMaxForGeneration(3), null); // 3-е поколение — «счётчик» без предела
    });
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd web && npm run test:unit`
Expected: `Cannot find module '../lib/foundry-clans'` (файла ещё нет)

- [ ] **Step 3: Написать модуль**

Создать `web/lib/foundry-clans.js`:

```javascript
'use strict';
// Таблицы соответствия RU-названий клан/секта (как в system/rules/character_sheet_v20.md
// и карточках персонажей) ⇄ i18n-ключи системы worldofdarkness в Foundry
// (Data/modules/ru-ru/i18n/systems/worldofdarkness.json → wod.bio.vampire.*, подтверждено
// разбором реального Export Data — см. docs/superpowers/specs/2026-07-08-foundry-integration-design.md,
// раздел 1.7). Плюс таблица «Поколение → запас крови» — зеркало web/public/rules-v20.js
// (RULES_V20.generations) тем же способом дублирования, что уже практикуется в проекте.

// RU-название клана (как в RULES_V20.clans / карточке персонажа) → foundry-ключ.
// Каппадокийцы и Истинный Бруха у Foundry-словаря ru-ru эквивалента не имеют —
// намеренно не включены, вызывающий код должен обработать null (см. foundry-export.js).
const CLAN_RU_TO_KEY = {
  'тореадор': 'toreador',
  'малкавиан': 'malkavian',
  'вентру': 'ventrue',
  'бруха': 'brujah',
  'гангрел': 'gangrel',
  'носферату': 'nosferatu',
  'тремер': 'tremere',
  'цимисхи': 'tzimisce',
  'ассамиты': 'assamite',
};

const CLAN_KEY_TO_RU = {
  toreador: 'Тореадор', malkavian: 'Малкавиан', ventrue: 'Вентру', brujah: 'Бруха',
  gangrel: 'Гангрел', nosferatu: 'Носферату', tremere: 'Тремер', tzimisce: 'Цимисхи',
  assamite: 'Ассамиты', giovanni: 'Джованни', lasombra: 'Ласомбра', ravnos: 'Равнос',
  set: 'Последователи Сета', caitiff: 'Каитифф',
};

const SECT_RU_TO_KEY = {
  'камарилья': 'camarilla',
  'шабаш': 'sabbat',
  'анархи': 'anarch',
  'независимый': 'independent',
  'независимые': 'independent',
  'инконну': 'inconnu',
};

const SECT_KEY_TO_RU = {
  camarilla: 'Камарилья', sabbat: 'Шабаш', anarch: 'Движение Анархов',
  independent: 'Независимый', inconnu: 'Инконну', blackhand: 'Истинная Черная Рука',
};

function _norm(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
}

function clanRuToFoundryKey(ru) {
  return CLAN_RU_TO_KEY[_norm(ru)] || null;
}
function clanFoundryKeyToRu(key) {
  return CLAN_KEY_TO_RU[String(key || '').toLowerCase()] || null;
}
function sectRuToFoundryKey(ru) {
  return SECT_RU_TO_KEY[_norm(ru)] || null;
}
function sectFoundryKeyToRu(key) {
  return SECT_KEY_TO_RU[String(key || '').toLowerCase()] || null;
}

// «7-е» / «13-е поколение» → 7 / 13. Тот же регекс, что уже использует
// v20GenerationInfo() в web/public/rules-v20.js:85 — держим идентичным.
function parseGenerationNumber(gen) {
  const n = parseInt(String(gen || '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Зеркало RULES_V20.generations[].bloodMax (web/public/rules-v20.js:25-37).
// null = 3-е поколение, запас крови без фиксированного предела («счётчик»).
const BLOOD_MAX_BY_GEN = {
  3: null, 4: 50, 5: 40, 6: 30, 7: 20, 8: 15, 9: 14, 10: 13, 11: 12, 12: 11, 13: 10,
};
function bloodMaxForGeneration(genNumber) {
  const clamped = Math.max(3, Math.min(13, genNumber));
  return BLOOD_MAX_BY_GEN[clamped] ?? null;
}

module.exports = {
  clanRuToFoundryKey, clanFoundryKeyToRu,
  sectRuToFoundryKey, sectFoundryKeyToRu,
  parseGenerationNumber, bloodMaxForGeneration,
};
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd web && npm run test:unit`
Expected: все тесты `foundry-clans` — PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/foundry-clans.js web/tests/all.test.js
git commit -m "feat: add RU<->Foundry clan/sect key tables and generation parser"
```

---

## Task 2: `web/lib/foundry-export.js` — маппер Sanguine → Foundry Actor JSON

**Files:**
- Create: `web/lib/foundry-export.js`
- Test: `web/tests/all.test.js`

Чистая функция `mapCharacterToFoundryActor(char, sheetData)`, где `char` — объект из `getAllCharacters()` (поля `.name`, `.clan`, `.sect`, `.generation`, `.sire` — уже распарсены из карточки, `web/lib/db.js:90`), `sheetData` — распарсенный `<slug>-sheet.json` (форма `_v20Empty()`, `web/public/scripts.js:6189-6226`). Возвращает объект, готовый под `JSON.stringify` для скачивания и последующего `Import Data` в Foundry.

- [ ] **Step 1: Написать падающий тест**

Добавить в `web/tests/all.test.js` после блока `foundry-clans` из Task 1:

```javascript
  describe('foundry-export', () => {
    const { mapCharacterToFoundryActor } = require('../lib/foundry-export');

    // Тот же персонаж, что реально лежит в cities/paris/characters/vampires/alen_dyubua —
    // используем как fixture напрямую, без похода на диск (юнит-тест мапера, не интеграция).
    const CHAR = {
      name: 'Ален Дюбуа', clan: 'Вентру', sect: 'Камарилья',
      generation: '7-е', sire: 'Жаном Де Вален',
    };
    const SHEET = {
      lineage: 'vampires',
      header: {
        name: 'Ален Дюбуа', player: '', chronicle: '', nature: 'Лидер (Leader)',
        demeanor: 'Аристократ (Aristocrat)', concept: 'Примоген Вентру',
        clan: 'Вентру', generation: '7-е', sire: 'Жаном Де Вален',
      },
      attributes: {
        physical: { strength: 2, dexterity: 2, stamina: 3, composure: 0, resolve: 0 },
        social:   { charisma: 3, manipulation: 4, appearance: 2 },
        mental:   { perception: 2, intelligence: 3, wits: 3 },
      },
      abilities: {
        talents: [
          { name: 'Атлетика', val: 0, fixed: true }, { name: 'Лидерство', val: 4, fixed: true },
          { name: 'Знания музыки', val: 1, fixed: false }, { name: '', val: 0, fixed: false },
        ],
        skills: [{ name: 'Вождение', val: 0, fixed: true }],
        knowledges: [{ name: 'Оккультизм', val: 2, fixed: true }],
      },
      disciplines: [
        { name: 'Доминирование', val: 3 }, { name: 'Стойкость', val: 1 },
        { name: '', val: 0 }, { name: '', val: 0 }, { name: '', val: 0 }, { name: '', val: 0 },
      ],
      backgrounds: [{ name: 'Ресурсы', val: 3 }, { name: '', val: 0 }],
      virtues: { conscience: 3, selfcontrol: 4, courage: 2 },
      meritsFlaws: 'Внушительный тип (1 очко)',
      humanity: 7, path: 'Человечность',
      willpower: { permanent: 6, temp: [true, true, true, false, false, false, false, false, false, false] },
      bloodPool: Array(20).fill(false).map((_, i) => i < 12), bloodPoolCount: 0, bloodPerTurn: 1,
      health: { bruised: true, hurt: true, injured: false, wounded: false, mauled: false, crippled: false, incapacitated: false },
      flaw: 'Избирательность — пьёт только у знати',
    };

    it('shape: type Vampire, header/generation/clan/sect', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.type, 'Vampire');
      assert.equal(a.name, 'Ален Дюбуа');
      assert.equal(a.system.generation, 7);
      assert.equal(a.system.clan, 'wod.bio.vampire.ventrue');
      assert.equal(a.system.sect, 'wod.bio.vampire.camarilla');
      assert.equal(a.system.sire, 'Жаном Де Вален');
    });
    it('неизвестный клан/секта → custom.{clan,sect}, а не сломанный ключ', () => {
      const a = mapCharacterToFoundryActor({ ...CHAR, clan: 'Каппадокийцы', sect: 'Неизвестная секта' }, SHEET);
      assert.equal(a.system.clan, '');
      assert.equal(a.system.custom.clan, 'Каппадокийцы');
      assert.equal(a.system.sect, '');
      assert.equal(a.system.custom.sect, 'Неизвестная секта');
    });
    it('атрибуты — все 11 ключей, включая composure/resolve', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.system.attributes.strength.value, 2);
      assert.equal(a.system.attributes.manipulation.value, 4);
      assert.equal(a.system.attributes.wits.value, 3);
      assert.equal(a.system.attributes.composure.value, 0);
      assert.equal(a.system.attributes.resolve.value, 0);
    });
    it('канонические способности → abilities.<key>.value', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.system.abilities.leadership.value, 4);
      assert.equal(a.system.abilities.drive.value, 0);
      assert.equal(a.system.abilities.occult.value, 2);
    });
    it('кастомная способность → embedded Item типа Trait', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      const trait = a.items.find(i => i.type === 'Trait' && i.name === 'Знания музыки');
      assert.ok(trait, 'ожидался Trait-Item «Знания музыки»');
      assert.equal(trait.system.type, 'wod.types.talentsecondability');
      assert.equal(trait.system.value, 1);
    });
    it('дисциплины (непустые) → embedded Item типа Power/discipline', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      const disc = a.items.filter(i => i.type === 'Power' && i.system.type === 'wod.types.discipline');
      assert.equal(disc.length, 2);
      const dom = disc.find(d => d.name === 'Доминирование');
      assert.equal(dom.system.value, 3);
    });
    it('добродетели/воля/запас крови', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.system.advantages.virtues.conscience.permanent, 3);
      assert.equal(a.system.advantages.willpower.permanent, 6);
      assert.equal(a.system.advantages.willpower.temporary, 3); // 3 из 10 отмечены true
      assert.equal(a.system.advantages.bloodpool.temporary, 12); // 12 из 20 отмечены
      assert.equal(a.system.advantages.bloodpool.max, 20); // bloodMaxForGeneration(7)
    });
    it('Путь/Человечность → advantages.path', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.system.advantages.path.permanent, 7);
      assert.equal(a.system.advantages.path.label, 'wod.advantages.path.humanity');
    });
    it('здоровье → damage.lethal, не отдельные value/total', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.system.health.damage.lethal, 2); // bruised + hurt = 2 отмечено
      assert.equal(a.system.health.damage.bashing, 0);
      assert.ok(!('bruised' in a.system.health) || a.system.health.bruised === undefined,
        'уровни здоровья не должны переопределяться маппером — их считает Foundry');
    });
    it('flaw (слабость клана) → system.weakness', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.system.weakness, 'Избирательность — пьёт только у знати');
    });
    it('meritsFlaws → system.notes (без попытки структурировать)', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.match(a.system.notes, /Внушительный тип/);
    });
    it('settings — минимальный набор has*-флагов для вампира, без soak/initiative/movement', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.system.settings.haswillpower, true);
      assert.equal(a.system.settings.haspath, true);
      assert.equal(a.system.settings.hasbloodpool, true);
      assert.equal(a.system.settings.hasvirtue, true);
      assert.equal(a.system.settings.hasrage, false);
      assert.ok(!('soak' in a.system), 'soak должен пересчитывать Foundry, не маппер');
      assert.ok(!('initiative' in a.system));
      assert.ok(!('movement' in a.system));
    });
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd web && npm run test:unit`
Expected: `Cannot find module '../lib/foundry-export'`

- [ ] **Step 3: Написать модуль**

Создать `web/lib/foundry-export.js`:

```javascript
'use strict';
// Маппер Sanguine → Foundry Actor JSON (система worldofdarkness v7.1.5).
// Схема Actor.system подтверждена разбором реального Export Data — см.
// docs/superpowers/specs/2026-07-08-foundry-integration-design.md, разделы 1.3/1.7/2.
//
// Что НЕ экспортируется (осознанно, см. шапку файла плана docs/superpowers/plans/
// 2026-07-08-foundry-sync-phase1.md):
// - Фон (backgrounds) — system.type для Item-Фона не подтверждён на реальных данных,
//   доделывается в Фазе 2 после проверки на персонаже с непустым Фоном.
// - Достоинства/Недостатки — Sanguine хранит их одним свободным текстом без очков/типа,
//   структурировать нельзя не изобретая эвристику — текст целиком уходит в system.notes.
// - system.settings/soak/initiative/movement — производные поля, их пересчитывает
//   сама система Foundry при открытии листа; маппер пишет только has*-флаги.
// - Уровни здоровья (health.<level>.value/total/penalty) — тоже производные от
//   health.damage.*, не пишутся напрямую (см. Task 2, шапка плана).

const {
  clanRuToFoundryKey, sectRuToFoundryKey,
  parseGenerationNumber, bloodMaxForGeneration,
} = require('./foundry-clans');

// Sanguine ability display name (RU, как в V20_ABILITIES web/public/scripts.js:6170-6174)
// → Foundry fixed abilities.<key> (EN, template.json partial `ability`).
const ABILITY_KEY_BY_RU = {
  // talents
  'атлетика': 'athletics', 'бдительность': 'alertness', 'драка': 'brawl',
  'запугивание': 'intimidation', 'красноречие': 'expression', 'лидерство': 'leadership',
  'уличное чутьё': 'streetwise', 'хитрость': 'subterfuge', 'шестое чувство': 'awareness',
  'эмпатия': 'empathy',
  // skills
  'вождение': 'drive', 'воровство': 'larceny', 'выживание': 'survival',
  'исполнение': 'performance', 'обращение с животными': 'animalken', 'ремесло': 'craft',
  'скрытность': 'stealth', 'стрельба': 'firearms', 'фехтование': 'melee', 'этикет': 'etiquette',
  // knowledges
  'гуманитарные науки': 'academics', 'естественные науки': 'science', 'законы': 'law',
  'информатика': 'computer', 'медицина': 'medicine', 'оккультизм': 'occult',
  'политика': 'politics', 'расследование': 'investigation', 'финансы': 'finance',
  'электроника': 'technology',
};
const ABILITY_GROUP_TYPE = { talents: 'talent', skills: 'skill', knowledges: 'knowledge' };

function _norm(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
}

// Плоский {key: {value,max,type}} словарь способностей: канонические (найденные
// в ABILITY_KEY_BY_RU) идут в system.abilities; кастомные (не найденные — свободные
// слоты вроде «Знания музыки») собираются отдельно как embedded Trait-Items.
function _mapAbilities(sheetAbilities) {
  const abilities = {};
  const customTraits = [];
  for (const group of ['talents', 'skills', 'knowledges']) {
    for (const slot of sheetAbilities?.[group] || []) {
      const name = String(slot?.name || '').trim();
      if (!name) continue;
      const key = ABILITY_KEY_BY_RU[_norm(name)];
      if (key) {
        abilities[key] = { value: Number(slot.val) || 0, max: 5, type: ABILITY_GROUP_TYPE[group] };
      } else {
        customTraits.push({ name, value: Number(slot.val) || 0, group });
      }
    }
  }
  return { abilities, customTraits };
}

function _traitItem(name, value, group) {
  const typeSuffix = { talents: 'talentsecondability', skills: 'skillsecondability', knowledges: 'knowledgesecondability' }[group];
  return {
    name, type: 'Trait',
    system: { type: `wod.types.${typeSuffix}`, level: '0', value, max: 7, isrollable: false },
  };
}

function _disciplineItems(disciplines) {
  return (disciplines || [])
    .filter(d => String(d?.name || '').trim())
    .map(d => ({
      name: d.name, type: 'Power',
      system: { type: 'wod.types.discipline', level: 0, value: Number(d.val) || 0, max: 7, game: 'vampire' },
    }));
}

// Sanguine отмечает 7 уровней здоровья булевыми флагами (порядок = тяжесть),
// Foundry хранит суммарные очки урона по типу. Sanguine не различает тип урона —
// весь отмеченный урон уходит в damage.lethal (разумный дефолт для вампира).
const HEALTH_LEVELS = ['bruised', 'hurt', 'injured', 'wounded', 'mauled', 'crippled', 'incapacitated'];
function _healthDamage(health) {
  const marked = HEALTH_LEVELS.filter(k => !!health?.[k]).length;
  return { bashing: 0, lethal: marked, aggravated: 0, woundlevel: '', woundpenalty: 0 };
}

function mapCharacterToFoundryActor(char, sheetData) {
  const s = sheetData || {};
  const genNumber = parseGenerationNumber(char.generation || s.header?.generation) || 13;
  const bloodMax = bloodMaxForGeneration(genNumber);

  const clanKey = clanRuToFoundryKey(char.clan || s.header?.clan);
  const sectKey = sectRuToFoundryKey(char.sect);

  const { abilities, customTraits } = _mapAbilities(s.abilities);
  const attrs = {
    strength: s.attributes?.physical?.strength, dexterity: s.attributes?.physical?.dexterity,
    stamina: s.attributes?.physical?.stamina, charisma: s.attributes?.social?.charisma,
    manipulation: s.attributes?.social?.manipulation, appearance: s.attributes?.social?.appearance,
    composure: s.attributes?.social?.composure, perception: s.attributes?.mental?.perception,
    intelligence: s.attributes?.mental?.intelligence, wits: s.attributes?.mental?.wits,
    resolve: s.attributes?.mental?.resolve,
  };
  const attributesOut = {};
  for (const [k, v] of Object.entries(attrs)) attributesOut[k] = { value: Number(v) || 0, max: 5 };

  const willpowerTemp = (s.willpower?.temp || []).filter(Boolean).length;
  const bloodTemp = bloodMax == null
    ? Number(s.bloodPoolCount) || 0
    : (s.bloodPool || []).filter(Boolean).length;

  const items = [
    ...customTraits.map(t => _traitItem(t.name, t.value, t.group)),
    ..._disciplineItems(s.disciplines),
  ];

  return {
    name: char.name || s.header?.name || '',
    type: 'Vampire',
    system: {
      nature: s.header?.nature || '', demeanor: s.header?.demeanor || '',
      concept: s.header?.concept || '', background: '', notes: s.meritsFlaws || '',
      settings: {
        haswillpower: true, haspath: true, hasbloodpool: true, hasvirtue: true,
        hasrage: false, hasgnosis: false, hasglamour: false, hasbanality: false,
        hasnightmare: false, hasconviction: false, hasfaith: false, hastorment: false,
        hasessence: false, hascorpus: false, haspathos: false, hasangst: false,
        hasvitality: false, hasspite: false, hasbalance: false, hassekhem: false,
        hasquintessence: false,
      },
      attributes: attributesOut,
      abilities,
      advantages: {
        virtues: {
          conscience: { permanent: Number(s.virtues?.conscience) || 0, temporary: Number(s.virtues?.conscience) || 0, max: 5 },
          selfcontrol: { permanent: Number(s.virtues?.selfcontrol) || 0, temporary: Number(s.virtues?.selfcontrol) || 0, max: 5 },
          courage: { permanent: Number(s.virtues?.courage) || 0, temporary: Number(s.virtues?.courage) || 0, max: 5 },
        },
        willpower: { permanent: Number(s.willpower?.permanent) || 0, temporary: willpowerTemp, max: 10 },
        bloodpool: { temporary: bloodTemp, max: bloodMax ?? 30, perturn: Number(s.bloodPerTurn) || 1 },
        path: {
          permanent: Number(s.humanity) || 0, value: 0, max: 10, custom: '',
          label: s.path && _norm(s.path) !== 'человечность' ? '' : 'wod.advantages.path.humanity',
        },
      },
      health: { damage: _healthDamage(s.health) },
      custom: { clan: clanKey ? '' : (char.clan || ''), sect: sectKey ? '' : (char.sect || '') },
      clan: clanKey || '', sect: sectKey || '',
      bloodline: '', weakness: s.flaw || '',
      generation: genNumber, generationmod: 0,
      sire: char.sire || s.header?.sire || '',
    },
    items,
  };
}

module.exports = { mapCharacterToFoundryActor };
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd web && npm run test:unit`
Expected: все тесты `foundry-export` — PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/foundry-export.js web/tests/all.test.js
git commit -m "feat: add Sanguine sheet-data -> Foundry Actor JSON mapper"
```

---

## Task 3: `web/lib/foundry-import.js` — маппер Foundry Actor JSON → Sanguine sheet-data

**Files:**
- Create: `web/lib/foundry-import.js`
- Test: `web/tests/all.test.js`

Обратный маппер: принимает распарсенный JSON, полученный из штатного Foundry «Export Data», и текущую (уже существующую) `sheetData` персонажа Sanguine — возвращает `{ sheetData, cardFields }`, где `sheetData` — обновлённая модель для записи в `<slug>-sheet.json`, `cardFields` — предложение для существующего `PUT /api/characters/:slug/fields` (клан/секта/поколение/сир), которое клиент вызывает отдельно (см. Task 4).

- [ ] **Step 1: Написать падающий тест**

Добавить в `web/tests/all.test.js` после блока `foundry-export`:

```javascript
  describe('foundry-import', () => {
    const { mapFoundryActorToSheetData } = require('../lib/foundry-import');

    const ACTOR = {
      name: 'Ален Дюбуа', type: 'Vampire',
      system: {
        nature: 'Лидер', demeanor: 'Аристократ', concept: 'Примоген', notes: 'Внушительный тип (1)',
        attributes: {
          strength: { value: 2 }, dexterity: { value: 3 }, stamina: { value: 3 },
          charisma: { value: 3 }, manipulation: { value: 4 }, appearance: { value: 2 },
          composure: { value: 1 }, perception: { value: 2 }, intelligence: { value: 3 },
          wits: { value: 3 }, resolve: { value: 1 },
        },
        abilities: {
          leadership: { value: 4, type: 'talent' }, drive: { value: 1, type: 'skill' },
          occult: { value: 2, type: 'knowledge' },
        },
        advantages: {
          virtues: {
            conscience: { permanent: 3 }, selfcontrol: { permanent: 4 }, courage: { permanent: 2 },
          },
          willpower: { permanent: 6, temporary: 4, max: 10 },
          bloodpool: { temporary: 15, max: 20, perturn: 1 },
          path: { permanent: 7, label: 'wod.advantages.path.humanity' },
        },
        health: { damage: { bashing: 0, lethal: 3, aggravated: 0 } },
        clan: 'wod.bio.vampire.ventrue', sect: 'wod.bio.vampire.camarilla',
        custom: { clan: '', sect: '' },
        generation: 7, sire: 'Жаном Де Вален', weakness: 'Избирательность',
      },
      items: [
        { name: 'Доминирование', type: 'Power', system: { type: 'wod.types.discipline', value: 3, parentid: '' } },
        { name: 'Знания музыки', type: 'Trait', system: { type: 'wod.types.talentsecondability', value: 1 } },
      ],
    };
    const EXISTING_SHEET = { lineage: 'vampires', disciplines: [], abilities: { talents: [], skills: [], knowledges: [] } };

    it('атрибуты (9 канонических + composure/resolve)', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      assert.equal(sheetData.attributes.physical.strength, 2);
      assert.equal(sheetData.attributes.social.composure, 1);
      assert.equal(sheetData.attributes.mental.resolve, 1);
    });
    it('канонические способности возвращаются как fixed:true строки с RU-именем', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      const lead = sheetData.abilities.talents.find(a => a.name === 'Лидерство');
      assert.ok(lead, 'ожидалось «Лидерство» среди talents');
      assert.equal(lead.val, 4);
    });
    it('Trait-Item → кастомная способность в нужной группе', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      const custom = sheetData.abilities.talents.find(a => a.name === 'Знания музыки');
      assert.ok(custom, 'кастомная способность должна вернуться в talents');
      assert.equal(custom.val, 1);
    });
    it('дисциплины из Power/discipline Item', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      const dom = sheetData.disciplines.find(d => d.name === 'Доминирование');
      assert.ok(dom); assert.equal(dom.val, 3);
    });
    it('добродетели/воля/запас крови', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      assert.equal(sheetData.virtues.conscience, 3);
      assert.equal(sheetData.willpower.permanent, 6);
      assert.equal(sheetData.willpower.temp.filter(Boolean).length, 4);
      assert.equal(sheetData.bloodPool.filter(Boolean).length, 15);
    });
    it('Путь/Человечность', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      assert.equal(sheetData.humanity, 7);
      assert.equal(sheetData.path, 'Человечность');
    });
    it('здоровье: damage.lethal=3 → 3 первых уровня отмечены', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      assert.equal(sheetData.health.bruised, true);
      assert.equal(sheetData.health.hurt, true);
      assert.equal(sheetData.health.injured, true);
      assert.equal(sheetData.health.wounded, false);
    });
    it('cardFields — клан/секта/поколение/сир для PUT /fields', () => {
      const { cardFields } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      assert.equal(cardFields.clan, 'Вентру');
      assert.equal(cardFields.sect, 'Камарилья');
      assert.equal(cardFields.generation, '7-е');
      assert.equal(cardFields.sire, 'Жаном Де Вален');
    });
    it('неизвестный i18n-ключ клана → берём custom.clan как есть', () => {
      const actor2 = { ...ACTOR, system: { ...ACTOR.system, clan: '', custom: { clan: 'Каппадокийцы', sect: '' } } };
      const { cardFields } = mapFoundryActorToSheetData(actor2, EXISTING_SHEET);
      assert.equal(cardFields.clan, 'Каппадокийцы');
    });
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd web && npm run test:unit`
Expected: `Cannot find module '../lib/foundry-import'`

- [ ] **Step 3: Написать модуль**

Создать `web/lib/foundry-import.js`:

```javascript
'use strict';
// Обратный маппер: Foundry Actor JSON (Export Data) → Sanguine sheet-data + card fields.
// См. шапку web/lib/foundry-export.js и docs/superpowers/specs/2026-07-08-foundry-integration-design.md.

const { clanFoundryKeyToRu, sectFoundryKeyToRu } = require('./foundry-clans');

const ABILITY_RU_BY_KEY = {
  athletics: 'Атлетика', alertness: 'Бдительность', brawl: 'Драка', intimidation: 'Запугивание',
  expression: 'Красноречие', leadership: 'Лидерство', streetwise: 'Уличное чутьё',
  subterfuge: 'Хитрость', awareness: 'Шестое чувство', empathy: 'Эмпатия',
  drive: 'Вождение', larceny: 'Воровство', survival: 'Выживание', performance: 'Исполнение',
  animalken: 'Обращение с животными', craft: 'Ремесло', stealth: 'Скрытность',
  firearms: 'Стрельба', melee: 'Фехтование', etiquette: 'Этикет',
  academics: 'Гуманитарные науки', science: 'Естественные науки', law: 'Законы',
  computer: 'Информатика', medicine: 'Медицина', occult: 'Оккультизм', politics: 'Политика',
  investigation: 'Расследование', finance: 'Финансы', technology: 'Электроника',
};
const GROUP_BY_ABILITY_TYPE = { talent: 'talents', skill: 'skills', knowledge: 'knowledges' };
const GROUP_BY_TRAIT_TYPE = {
  'wod.types.talentsecondability': 'talents',
  'wod.types.skillsecondability': 'skills',
  'wod.types.knowledgesecondability': 'knowledges',
};

const HEALTH_LEVELS = ['bruised', 'hurt', 'injured', 'wounded', 'mauled', 'crippled', 'incapacitated'];

function mapFoundryActorToSheetData(actor, existingSheetData) {
  const sys = actor?.system || {};
  const items = Array.isArray(actor?.items) ? actor.items : [];
  const base = existingSheetData || {};

  const abilities = { talents: [], skills: [], knowledges: [] };
  for (const [key, ru] of Object.entries(ABILITY_RU_BY_KEY)) {
    const a = sys.abilities?.[key];
    if (!a) continue;
    const group = GROUP_BY_ABILITY_TYPE[a.type] || Object.entries(ABILITY_RU_BY_KEY).length && null;
  }
  // Заполняем канонические способности по их фактической группе (type в Foundry-данных),
  // а не по жёсткой карте — talent/skill/knowledge может отличаться от RU-таблицы выше
  // только по значению value, группа всегда следует за system.abilities.<key>.type.
  for (const [key, ru] of Object.entries(ABILITY_RU_BY_KEY)) {
    const a = sys.abilities?.[key];
    if (!a) continue;
    const group = GROUP_BY_ABILITY_TYPE[a.type] || 'talents';
    abilities[group].push({ name: ru, val: Number(a.value) || 0, fixed: true });
  }
  for (const item of items) {
    if (item.type !== 'Trait') continue;
    const group = GROUP_BY_TRAIT_TYPE[item.system?.type];
    if (!group) continue;
    abilities[group].push({ name: item.name, val: Number(item.system?.value) || 0, fixed: false });
  }

  const disciplines = items
    .filter(i => i.type === 'Power' && i.system?.type === 'wod.types.discipline')
    .map(i => ({ name: i.name, val: Number(i.system?.value) || 0 }));

  const lethal = Number(sys.health?.damage?.lethal) || 0;
  const health = {};
  HEALTH_LEVELS.forEach((k, i) => { health[k] = i < lethal; });

  const willpowerTemp = Array(10).fill(false).map((_, i) => i < (Number(sys.advantages?.willpower?.temporary) || 0));
  const bloodMax = Number(sys.advantages?.bloodpool?.max) || 20;
  const bloodPool = Array(20).fill(false).map((_, i) => i < (Number(sys.advantages?.bloodpool?.temporary) || 0));

  const sheetData = {
    ...base,
    header: {
      ...base.header,
      name: actor.name || base.header?.name || '',
      nature: sys.nature || base.header?.nature || '',
      demeanor: sys.demeanor || base.header?.demeanor || '',
      concept: sys.concept || base.header?.concept || '',
      sire: sys.sire || base.header?.sire || '',
      generation: sys.generation ? `${sys.generation}-е` : (base.header?.generation || ''),
    },
    attributes: {
      physical: {
        strength: Number(sys.attributes?.strength?.value) || 0,
        dexterity: Number(sys.attributes?.dexterity?.value) || 0,
        stamina: Number(sys.attributes?.stamina?.value) || 0,
      },
      social: {
        charisma: Number(sys.attributes?.charisma?.value) || 0,
        manipulation: Number(sys.attributes?.manipulation?.value) || 0,
        appearance: Number(sys.attributes?.appearance?.value) || 0,
        composure: Number(sys.attributes?.composure?.value) || 0,
      },
      mental: {
        perception: Number(sys.attributes?.perception?.value) || 0,
        intelligence: Number(sys.attributes?.intelligence?.value) || 0,
        wits: Number(sys.attributes?.wits?.value) || 0,
        resolve: Number(sys.attributes?.resolve?.value) || 0,
      },
    },
    abilities,
    disciplines,
    virtues: {
      conscience: Number(sys.advantages?.virtues?.conscience?.permanent) || 0,
      selfcontrol: Number(sys.advantages?.virtues?.selfcontrol?.permanent) || 0,
      courage: Number(sys.advantages?.virtues?.courage?.permanent) || 0,
    },
    meritsFlaws: sys.notes || base.meritsFlaws || '',
    humanity: Number(sys.advantages?.path?.permanent) || 0,
    path: sys.advantages?.path?.label === 'wod.advantages.path.humanity' ? 'Человечность' : (base.path || 'Человечность'),
    willpower: { permanent: Number(sys.advantages?.willpower?.permanent) || 0, temp: willpowerTemp },
    bloodPool, bloodPoolCount: base.bloodPoolCount || 0,
    bloodPerTurn: Number(sys.advantages?.bloodpool?.perturn) || 1,
    health,
    flaw: sys.weakness || base.flaw || '',
  };

  const clanRu = sys.clan ? clanFoundryKeyToRu(sys.clan.replace('wod.bio.vampire.', '')) : null;
  const sectRu = sys.sect ? sectFoundryKeyToRu(sys.sect.replace('wod.bio.vampire.', '')) : null;
  const cardFields = {
    clan: clanRu || sys.custom?.clan || '',
    sect: sectRu || sys.custom?.sect || '',
    generation: sys.generation ? `${sys.generation}-е` : '',
    sire: sys.sire || '',
  };

  return { sheetData, cardFields };
}

module.exports = { mapFoundryActorToSheetData };
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd web && npm run test:unit`
Expected: все тесты `foundry-import` — PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/foundry-import.js web/tests/all.test.js
git commit -m "feat: add Foundry Actor JSON -> Sanguine sheet-data mapper"
```

---

## Task 4: Роуты `export-foundry` / `import-foundry`

**Files:**
- Modify: `web/routes/characters.js`
- Test: `web/tests/all.test.js` (интеграционный раздел, `describe('Characters', ...)`)

- [ ] **Step 1: Написать падающий тест**

В `web/tests/all.test.js`, внутри `describe('API — integration', ...) > describe('Characters', ...)` (после теста `GET /api/export/characters`, около строки 948), добавить:

```javascript
    it('GET /:slug/export-foundry → Foundry Actor JSON + заголовок скачивания', async () => {
      const vampire = chars.find(c => c.lineage === 'vampires' && c.hasSheet);
      assert.ok(vampire, 'нужен хотя бы один вампир с листом в фикстуре paris');
      const { status, body } = await apiJson(`/api/characters/${vampire.slug}/export-foundry${CITY}`);
      assert.equal(status, 200);
      assert.equal(body.type, 'Vampire');
      assert.equal(body.name, vampire.name);
      const res = await fetch(BASE + `/api/characters/${vampire.slug}/export-foundry${CITY}`);
      assert.match(res.headers.get('content-disposition') || '', /attachment;.*foundry.*\.json/);
    });
    it('GET unknown/export-foundry → 404', async () => {
      const { status } = await apiJson(`/api/characters/${CHAR_UNKNOWN}/export-foundry${CITY}`);
      assert.equal(status, 404);
    });
    it('POST /:slug/import-foundry → пишет sheet-data, возвращает cardFields', async () => {
      const vampire = chars.find(c => c.lineage === 'vampires' && c.hasSheet);
      const actorJson = {
        name: vampire.name, type: 'Vampire',
        system: {
          attributes: { strength: { value: 5 }, dexterity: { value: 5 }, stamina: { value: 5 },
            charisma: { value: 1 }, manipulation: { value: 1 }, appearance: { value: 1 },
            perception: { value: 1 }, intelligence: { value: 1 }, wits: { value: 1 } },
          abilities: {}, advantages: { virtues: {}, willpower: {}, bloodpool: {}, path: {} },
          health: { damage: {} }, clan: '', sect: '', custom: {}, generation: 9, sire: '',
        },
        items: [],
      };
      const { status, body } = await apiJson(`/api/characters/${vampire.slug}/import-foundry${CITY}`, {
        method: 'POST', body: JSON.stringify({ actor: actorJson }),
      });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.ok(body.cardFields);
      const sheetRes = await apiJson(`/api/characters/${vampire.slug}/sheet-data${CITY}`);
      assert.equal(sheetRes.body.data.attributes.physical.strength, 5);
    });
    it('POST /:slug/import-foundry без actor → 400', async () => {
      const vampire = chars.find(c => c.lineage === 'vampires' && c.hasSheet);
      const { status } = await apiJson(`/api/characters/${vampire.slug}/import-foundry${CITY}`, {
        method: 'POST', body: JSON.stringify({}),
      });
      assert.equal(status, 400);
    });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd web && npm run test:unit`
Expected: `404` на несуществующий роут `export-foundry`/`import-foundry` (роутов ещё нет)

- [ ] **Step 3: Добавить роуты**

В `web/routes/characters.js`, в начало файла (после существующих `require`, около строки 21) добавить:

```javascript
const { mapCharacterToFoundryActor } = require('../lib/foundry-export');
const { mapFoundryActorToSheetData } = require('../lib/foundry-import');
```

Затем — сразу после блока `router.put('/api/characters/:slug/sheet-data', ...)` (перед `return router;`, около строки 963 в текущем файле), добавить:

```javascript
  // ── Foundry sync (Фаза 1, вариант c — см. docs/superpowers/specs/
  // 2026-07-08-foundry-integration-design.md): экспорт/импорт JSON через штатный
  // Foundry Export/Import Data, без прямого доступа к LevelDB. Только вампиры.
  router.get('/api/characters/:slug/export-foundry', async (req, res) => {
    try {
      const city  = reqCity(req);
      const slug  = decodeURIComponent(req.params.slug);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
      if (char.lineage !== 'vampires') return res.status(400).json({ error: 'Экспорт в Foundry пока поддержан только для вампиров' });
      const dir = path.join(charsDir(city), char.lineageFolder, char.slug);
      const raw = await fs.readFile(path.join(dir, `${char.slug}-sheet.json`), 'utf-8').catch(() => null);
      const sheetData = raw ? JSON.parse(raw) : {};
      const actor = mapCharacterToFoundryActor(char, sheetData);
      res.setHeader('Content-Disposition', `attachment; filename="foundry_${char.slug}.json"`);
      res.json(actor);
    } catch (e) { serverError(res, e); }
  });

  router.post('/api/characters/:slug/import-foundry', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const city  = reqCity(req);
      const slug  = decodeURIComponent(req.params.slug);
      const actor = req.body?.actor;
      if (!actor || typeof actor !== 'object') return res.status(400).json({ error: 'Нет данных Foundry Actor (ожидалось поле actor)' });
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
      const dir = path.join(charsDir(city), char.lineageFolder, char.slug);
      const raw = await fs.readFile(path.join(dir, `${char.slug}-sheet.json`), 'utf-8').catch(() => null);
      const existing = raw ? JSON.parse(raw) : {};
      const { sheetData, cardFields } = mapFoundryActorToSheetData(actor, existing);
      await writeFileAtomic(path.join(dir, `${char.slug}-sheet.json`), JSON.stringify(sheetData, null, 2), 'utf-8');
      res.json({ ok: true, cardFields });
    } catch (e) { serverError(res, e); }
  });

```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd web && npm run test:unit`
Expected: все новые тесты в `describe('Characters', ...)` — PASS

- [ ] **Step 5: Commit**

```bash
git add web/routes/characters.js web/tests/all.test.js
git commit -m "feat: add GET export-foundry / POST import-foundry routes"
```

---

## Task 5: `composure`/`resolve` — новые атрибуты в V20-листе

**Files:**
- Modify: `system/rules/character_sheet_v20.md`
- Modify: `web/public/scripts.js`

Решение раздела 6 (п.2) дизайн-спеки: атрибуты Foundry `composure`/`resolve`, которых нет в классической 9-атрибутной сетке V20, добавляются в Sanguine как два новых поля (Социальные/Ментальные соответственно — так их категоризирует сам `template.json`).

- [ ] **Step 1: Обновить документацию листа**

В `system/rules/character_sheet_v20.md`, в таблицах «Социальные» и «Ментальные» (строки 160-165, 167-172) добавить по одной строке:

```markdown
### Социальные
| Характеристика | ● | Значение |
|---|---|---|
| Обаяние (Charisma) | ●●○○○ | 2 |
| Манипуляция (Manipulation) | ●●●○○ | 3 |
| Привлекательность (Appearance) | ●●○○○ | 2 |
| Самообладание (Composure) | ●○○○○ | 1 |

### Ментальные
| Характеристика | ● | Значение |
|---|---|---|
| Восприятие (Perception) | ●●○○○ | 2 |
| Интеллект (Intelligence) | ●●○○○ | 2 |
| Смекалка (Wits) | ●●●○○ | 3 |
| Решительность (Resolve) | ●○○○○ | 1 |
```

- [ ] **Step 2: Расширить модель листа в `scripts.js`**

В `web/public/scripts.js:6164-6167`, добавить два новых ключа в `V20_ATTRS` (рендер уже полностью общий по этому объекту, см. `attrCol()` строка 7211 — правки там не требуется):

```javascript
const V20_ATTRS = {
  physical: [['strength', 'Сила'], ['dexterity', 'Ловкость'], ['stamina', 'Выносливость']],
  social:   [['charisma', 'Обаяние'], ['manipulation', 'Манипуляция'], ['appearance', 'Привлекательность'], ['composure', 'Самообладание']],
  mental:   [['perception', 'Восприятие'], ['intelligence', 'Интеллект'], ['wits', 'Смекалка'], ['resolve', 'Решительность']],
};
```

В `web/public/scripts.js:6195-6197` (внутри `_v20Empty()`), добавить дефолтные значения:

```javascript
    attributes: {
      physical: { strength: 1, dexterity: 1, stamina: 1 },
      social:   { charisma: 1, manipulation: 1, appearance: 1, composure: 1 },
      mental:   { perception: 1, intelligence: 1, wits: 1, resolve: 1 },
    },
```

`_v20Normalize()` (строка 6340: `Object.assign(e.attributes[g], _v20PickClamped(m.attributes?.[g], maxDots))`) и `_v20ClampToGen()` (строка 6319: `for (const k in m.attributes[g])`) уже перебирают ключи объекта generically — правок не требуют. Листы существующих персонажей без `composure`/`resolve` в JSON получат дефолт `1` при следующей загрузке через `_v20Normalize` (не ломается — сохраняет обратную совместимость).

- [ ] **Step 3: Проверить вручную в браузере**

Использовать скилл `run-sanguine-web`: перезапустить dev-сервер (`POST /api/restart`), открыть персонажа-вампира с листом (например `alen_dyubua`), перейти на вкладку «Лист V20», убедиться что в колонках «Социальные» и «Ментальные» появились новые строки «Самообладание»/«Решительность» с точками, кликабельны как остальные атрибуты (задают значение по клику на точку).

- [ ] **Step 4: Прогнать юнит-тесты (regression)**

Run: `cd web && npm run test:unit`
Expected: все существующие тесты по-прежнему PASS (composure/resolve не должны ничего сломать — `_v20PickClamped`/`_v20ClampToGen` уже общие по ключам)

- [ ] **Step 5: Commit**

```bash
git add system/rules/character_sheet_v20.md web/public/scripts.js
git commit -m "feat: add composure/resolve attributes to V20 sheet"
```

---

## Task 6: Кнопки «Экспорт в Foundry» / «Импорт из Foundry» на листе

**Files:**
- Modify: `web/public/index.html` (скрытый `<input type="file">`, по образцу `import-chars-file`)
- Modify: `web/public/scripts.js` (кнопки в тулбаре листа + обработчики)

- [ ] **Step 1: Добавить скрытый file input в `index.html`**

Рядом с существующим `<input type="file" id="import-chars-file" ...>` (`web/public/index.html:151`), добавить:

```html
        <input type="file" id="import-foundry-file" accept="application/json,.json" style="display:none">
```

(Один общий input на всё приложение — открывается по клику на кнопку листа, аналогично тому, как `import-chars-file` используется в другом месте интерфейса; конфликта не будет, так как открывается только когда лист активен и клика на «Импорт из Foundry» ждали явно.)

- [ ] **Step 2: Добавить кнопки в тулбар листа**

В `web/public/scripts.js`, в `_v20RenderSheet()` (строка 7401-7407), добавить две кнопки после `v20-roll-btn`:

```javascript
    <div class="cdet-sheet-toolbar">
      <button class="cdet-sheet-btn primary" id="v20-save" disabled>💾 Сохранено</button>
      <button class="cdet-sheet-btn" id="v20-regen">♻ Перегенерировать ИИ</button>
      <button class="cdet-sheet-btn" id="v20-validate">📋 Проверить лист</button>
      <button class="cdet-sheet-btn${_v20XpMode ? ' active' : ''}" id="v20-xpmode" title="В этом режиме поднятие точки списывает опыт по таблице обучения">🎓 Режим опыта${_v20XpMode ? ': вкл' : ''}</button>
      <button class="cdet-sheet-btn" id="v20-roll-btn" title="Открыть конструктор броска d10">🎲 Бросок</button>
      ${m.lineage === 'vampires' ? `
      <button class="cdet-sheet-btn" id="v20-foundry-export" title="Скачать JSON для импорта в Foundry VTT (Import Data)">🜏 Экспорт в Foundry</button>
      <button class="cdet-sheet-btn" id="v20-foundry-import" title="Загрузить JSON, полученный через Export Data в Foundry VTT">📥 Импорт из Foundry</button>` : ''}
      <span class="v20-status" id="v20-status"></span>
    </div>
```

И после существующей регистрации обработчиков (после строки `document.getElementById('v20-xpmode').addEventListener(...)`, строка 7417):

```javascript
  document.getElementById('v20-foundry-export')?.addEventListener('click', _v20ExportFoundry);
  document.getElementById('v20-foundry-import')?.addEventListener('click', () => document.getElementById('import-foundry-file')?.click());
```

- [ ] **Step 3: Написать обработчики экспорта/импорта**

Добавить в `web/public/scripts.js` сразу после `_v20Save()` (после строки 7574):

```javascript
function _v20ExportFoundry() {
  const slug = _charSlug(_v20Ctx.name);
  window.location.href = `/api/characters/${encodeURIComponent(slug)}/export-foundry${location.search}`;
}

async function _v20ImportFoundryFile(file) {
  if (!file) return;
  let actor;
  try {
    actor = JSON.parse(await file.text());
  } catch (e) {
    showToast('Не удалось прочитать JSON-файл: ' + e.message, 'error');
    return;
  }
  const slug = _charSlug(_v20Ctx.name);
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(slug)}/import-foundry${location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor }),
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'не удалось');
    showToast('Импортировано из Foundry. Обновляю лист…', 'success');
    const d = await fetch(`/api/characters/${slug}/sheet-data${location.search}`).then(r => r.json());
    _v20Model = _v20ModelFrom(d);
    _v20DirtyFlag = false;
    _v20RenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
    if (r.cardFields && (r.cardFields.clan || r.cardFields.sect || r.cardFields.generation || r.cardFields.sire)) {
      showToast(`Предложены поля карточки — клан «${r.cardFields.clan || '—'}», секта «${r.cardFields.sect || '—'}», поколение «${r.cardFields.generation || '—'}». Примените их вручную во вкладке «Инфо», если нужно.`, 'info', 8000);
    }
  } catch (e) {
    showToast('Ошибка импорта: ' + e.message, 'error');
  }
}

document.getElementById('import-foundry-file')?.addEventListener('change', async e => {
  await _v20ImportFoundryFile(e.target.files[0]);
  e.target.value = '';
});
```

- [ ] **Step 4: Проверить вручную в браузере**

Использовать скилл `run-sanguine-web`:
1. Перезапустить dev-сервер, открыть персонажа-вампира с листом (`alen_dyubua`), вкладка «Лист V20».
2. Кликнуть «🜏 Экспорт в Foundry» — убедиться, что браузер скачивает файл `foundry_alen_dyubua.json`; открыть его и проверить, что там `"type": "Vampire"`, `"system.generation": 7`, есть массив `items` с дисциплинами.
3. Кликнуть «📥 Импорт из Foundry», выбрать этот же скачанный файл — убедиться, что появляется toast «Импортировано из Foundry…», лист перерисовывается без ошибок в консоли.
4. Открыть DevTools Network, убедиться что `POST .../import-foundry` вернул `200` и `{ ok: true, cardFields: {...} }`.

- [ ] **Step 5: Commit**

```bash
git add web/public/index.html web/public/scripts.js
git commit -m "feat: add Foundry export/import buttons to V20 sheet toolbar"
```

---

## Self-Review (проведён при написании плана)

**1. Покрытие спеки:** таблица маппинга раздела 2 спеки покрыта тасками 1-3 (атрибуты/способности/дисциплины/добродетели/воля/запас крови/Путь/здоровье/клан/секта/поколение/сир); композур/резолв — Task 5 (решение раздела 6 п.2); settings/soak/initiative/movement не пишутся — Task 2 (решение раздела 6 п.6); UTF-8 — тесты работают на реальных русскоязычных фикстурах (`alen_dyubua`, кириллица в именах способностей/клана), явных доп. шагов на encoding не требуется, т.к. `fs.readFile(..., 'utf-8')`/`res.json()`/`file.text()` везде уже используют UTF-8 по умолчанию в Node/браузере — риск раздела 6 п.7 был именно про то, чтобы не потерять эту гарантию, что и обеспечивается использованием стандартных JSON/UTF-8 API без ручных Buffer-манипуляций.

**2. Не покрыто сознательно (см. шапку плана):** Достоинства/Недостатки — не структурируются, идут в `notes`; Фон (backgrounds) — не экспортируется вовсе (`system.type` не подтверждён, раздел 6 п.5) — оставлено на Фазу 2, как решено в спеке.

**3. Плейсхолдеров нет** — каждый шаг содержит конкретный код и точный путь к файлу/строке.

**4. Типы согласованы** — `mapCharacterToFoundryActor(char, sheetData)` (Task 2) и `mapFoundryActorToSheetData(actor, existingSheetData)` (Task 3) используют одинаковые имена полей на всех уровнях (`system.attributes.<key>.value`, `system.advantages.virtues.<key>.permanent` и т.д.) — сверено построчно при написании обоих тестов.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-foundry-sync-phase1.md`.**
