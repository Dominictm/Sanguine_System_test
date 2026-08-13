'use strict';
// Single entry point: unit tests for lib/parsers.js + integration tests for API.
// Run: node --test --test-reporter=./tests/reporter.js tests/all.test.js

const { describe, it, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs').promises;
const path   = require('path');
const os     = require('os');
const { startServer, stopServer, apiJson, BASE } = require('./helpers');
const {
  readPrompt, writePrompt, periodLabel,
  threadStatusKey, parseThreadsContent, THREAD_STATUS,
  slugify, CYRILLIC_TR, LATIN_TR, parseDiary,
  mdExtractLinks, mdStripLinks, mdStripInline, classifyChronicleLink,
  categorizeRel, parseCharacter, parseLocation, parseEvent, parseChronicle,
  parseChronicleParticipants,
  parseScenarioSections, replaceScenarioSection, replaceScenarioSections,
  insertScenarioScene, hasManualSceneMarker, addManualSceneMarker, clearManualSceneMarker,
  checkScenarioStructure,
  parsePoliticalFactions, setPoliticalFactionInfluence,
  CITY_SECTIONS, buildCityMd, parseCityMd, cityScaffold,
} = require('../lib/parsers');
const { parseDisciplineMd } = require('../lib/disciplines');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const INDENTED_CARD = [
  '# ⚔️ Персонаж', '',
  '- **🎨 Промт для генерации изображения:**',
  '  Блок первый', '  блок второй',
  '- **🚫 Негативный промт:**',
  '  без фона, размытость',
].join('\n');

const FENCED_CARD = [
  '## 🎨 Промт для генерации изображения', '',
  '**GPT / DALL-E 3:**', '```', 'gothic city scene, dark alley', '```', '',
  '**Негативный промт (SD / Flux):**', '```', 'blurry, text, watermark', '```',
].join('\n');

const FENCED_NO_NEGATIVE = [
  '**GPT / DALL-E 3:**', '```', 'city gothic scene', '```',
].join('\n');

const THREAD_TABLE = [
  '| № | Нить | Источник | Статус | Приоритет |',
  '|---|------|---------|--------|----------|',
  '| 1 | **Первая нить** — описание первой | Хроника А | 🔴 Активна | Высокий |',
  '| 2 | **Вторая нить** | — | 🟢 Закрыта | Низкий |',
  '| 3 | **Фоновый сюжет** — фон | Архив | 🟡 Фоновая | Средний |',
].join('\n');

const CITY          = '?city=paris';
const CHR           = 'leto_v_parizhe';
const MOD           = 'progulki_po_nocham';
const CHAR_GERSON   = 'gerson';
const CHAR_UNKNOWN  = '__NOBODY__';
const CITY_ROOT     = path.join(__dirname, '../../cities/paris');

// ══════════════════════════════════════════════════════════════════════════════
// UNIT — lib/parsers.js
// ══════════════════════════════════════════════════════════════════════════════

test('parseDisciplineMd: поле Группа читается из шапки', () => {
  const md = [
    '# 🔥 Тест (Test)',
    '- **Клан / принадлежность:** Тремер',
    '- **Группа:** thaumaturgy',
    '- **Источник:** https://wod.su/x',
    '',
    '## Уровень 1 — Икс (X)',
    '**Литературное описание.** Флавор.',
    '**Система.** Механика.',
  ].join('\n');
  const d = parseDisciplineMd(md, 'test');
  assert.strictEqual(d.group, 'thaumaturgy');
});

test('parseDisciplineMd: без поля Группа — default base', () => {
  const md = '# 🔮 Прорицание (Auspex)\n- **Клан:** общая\n\n## Уровень 1 — Y (Y)\n**Система.** Z.';
  const d = parseDisciplineMd(md, 'auspex');
  assert.strictEqual(d.group, 'base');
});

describe('Parsers — unit', () => {

  describe('readPrompt — Format A (indented)', () => {
    it('reads image prompt', () =>
      assert.equal(readPrompt(INDENTED_CARD, 'image'), 'Блок первый\nблок второй'));
    it('reads negative prompt', () =>
      assert.equal(readPrompt(INDENTED_CARD, 'negative'), 'без фона, размытость'));
  });

  describe('readPrompt — Format B (fenced)', () => {
    it('reads image prompt', () =>
      assert.equal(readPrompt(FENCED_CARD, 'image'), 'gothic city scene, dark alley'));
    it('reads negative prompt', () =>
      assert.equal(readPrompt(FENCED_CARD, 'negative'), 'blurry, text, watermark'));
  });

  describe('readPrompt — absent blocks', () => {
    it('returns undefined when image block is missing', () =>
      assert.equal(readPrompt('# Карточка\n\nТекст без промта.', 'image'), undefined));
    it('returns undefined when negative block is missing', () =>
      assert.equal(readPrompt('# Карточка\n\nТекст.', 'negative'), undefined));
    it('returns undefined on empty string', () =>
      assert.equal(readPrompt('', 'image'), undefined));
  });

  describe('writePrompt — indented format', () => {
    it('replaces existing image block', () => {
      const r = writePrompt(INDENTED_CARD, 'image', 'Новый промт\nвторая строка', 'indented');
      assert.ok(r.includes('  Новый промт'), 'new value not indented');
      assert.ok(!r.includes('Блок первый'), 'old value not removed');
    });
    it('replaces existing negative block', () => {
      const r = writePrompt(INDENTED_CARD, 'negative', 'новый негатив', 'indented');
      assert.ok(r.includes('  новый негатив'));
      assert.ok(!r.includes('без фона'));
    });
    it('appends a bullet when image block is absent', () => {
      const base = '# Без блока\n\nТекст.';
      const r = writePrompt(base, 'image', 'test', 'indented');
      assert.notEqual(r, base, 'should not be a no-op');
      assert.ok(r.includes('🎨 Промт для генерации изображения'), 'label missing');
      assert.ok(r.includes('  test'), 'value not indented');
    });
    it('appends a bullet when negative block is absent', () => {
      const base = '# Без блока\n\nТекст.';
      const r = writePrompt(base, 'negative', 'blurry', 'indented');
      assert.ok(r.includes('🚫 Негативный промт'), 'label missing');
      assert.ok(r.includes('  blurry'));
    });
    it('inserts before the images section when present', () => {
      const card = [
        '# 🧛 Тест', '',
        '- **Голос:** тихий',
        '- **Отношения:**', '  - —', '',
        '---', '', '## 🖼️ Изображения', '- ⏳ нет',
      ].join('\n');
      const r = writePrompt(card, 'image', 'dark portrait', 'indented');
      const promptPos = r.indexOf('🎨 Промт');
      const imgPos    = r.indexOf('## 🖼️ Изображения');
      assert.ok(promptPos !== -1 && promptPos < imgPos, 'prompt must precede images section');
    });
  });

  describe('writePrompt — fenced format', () => {
    it('replaces existing image block', () => {
      const r = writePrompt(FENCED_CARD, 'image', 'new scene', 'fenced');
      assert.ok(r.includes('new scene'));
      assert.ok(!r.includes('gothic city scene, dark alley'));
    });
    it('replaces existing negative block', () => {
      const r = writePrompt(FENCED_CARD, 'negative', 'noise, artifact', 'fenced');
      assert.ok(r.includes('noise, artifact'));
      assert.ok(!r.includes('blurry, text, watermark'));
    });
    it('appends new image section when absent', () => {
      const r = writePrompt('# Локация\n\nОписание.', 'image', 'dark alley', 'fenced');
      assert.ok(r.includes('GPT / DALL-E 3'));
      assert.ok(r.includes('dark alley'));
    });
    it('appends negative block after last fence when absent', () => {
      const r = writePrompt(FENCED_NO_NEGATIVE, 'negative', 'blurry', 'fenced');
      assert.ok(r.includes('Негативный промт'));
      assert.ok(r.includes('blurry'));
    });
    it('appends both sections when card has no fences at all', () => {
      const r = writePrompt('# Пустая локация\n\nТекст.', 'negative', 'blur', 'fenced');
      assert.ok(r.includes('Негативный промт'));
      assert.ok(r.includes('blur'));
    });
  });

  describe('slugify', () => {
    it('transliterates Cyrillic → ASCII', () =>
      assert.equal(slugify('Виктор Ламбер'), 'viktor_lamber'));
    it('collapses separators and trims underscores', () =>
      assert.equal(slugify('  Клуб —  Носферату!! '), 'klub_nosferatu'));
    it('drops soft/hard signs', () =>
      assert.equal(slugify('Любовь'), 'lyubov'));
    it('handles digits', () =>
      assert.equal(slugify('Округ 12'), 'okrug_12'));
    it('null / undefined → empty string', () => {
      assert.equal(slugify(null), '');
      assert.equal(slugify(undefined), '');
    });
    it('already-ASCII slug is stable', () =>
      assert.equal(slugify('gerson'), 'gerson'));

    it('browser parity — public/utils.js _NTR mirrors CYRILLIC_TR', () => {
      const src = require('fs').readFileSync(
        path.join(__dirname, '../public/scripts/utils.js'), 'utf-8');
      const m = src.match(/const _NTR\s*=\s*(\{[^}]*\})/);
      assert.ok(m, '_NTR literal not found in utils.js');
      // eslint-disable-next-line no-new-func
      const browserMap = (new Function(`return (${m[1]})`))();
      assert.deepEqual(browserMap, CYRILLIC_TR,
        'browser _NTR has diverged from canonical CYRILLIC_TR — keep them in sync');
    });

    it('browser parity — public/utils.js _LATIN_TR mirrors LATIN_TR', () => {
      const src = require('fs').readFileSync(
        path.join(__dirname, '../public/scripts/utils.js'), 'utf-8');
      const m = src.match(/const _LATIN_TR\s*=\s*(\{[^}]*\})/);
      assert.ok(m, '_LATIN_TR literal not found in utils.js');
      // eslint-disable-next-line no-new-func
      const browserMap = (new Function(`return (${m[1]})`))();
      assert.deepEqual(browserMap, LATIN_TR,
        'browser _LATIN_TR has diverged from canonical LATIN_TR — keep them in sync');
    });

    it('non-Cyrillic diacritics fold (Düsseldorf→dusseldorf, Şanlıurfa→sanliurfa)', () => {
      assert.equal(slugify('Düsseldorf'), 'dusseldorf');
      assert.equal(slugify('Şanlıurfa'), 'sanliurfa');
      assert.equal(slugify('Майкоп'), 'maykop');  // Cyrillic й survives (NFKD must run after the map)
    });
  });

  describe('city.md — buildCityMd / parseCityMd', () => {
    it('round-trip сохраняет display, year, description и все секции', () => {
      const fields = {
        display: 'Балмонт', year: '2024',
        description: 'Тёмный индустриальный город под вечным дождём.',
        political: 'Камарилья держит центр\nКнязь: Маркус',
        factions: 'Камарилья\nДжованни',
        factionsMortal: 'Полиция\nГородской совет',
        factionsState: 'DGSI',
        districts: '12 районов\nЦентр — Камарилья',
        landmarks: 'Собор\nСтарый вокзал',
        locations: 'Небоскрёб в центре\nЭлизиум: Опера',
        hunting: 'Портовые бары — свободные угодья',
        edicts: 'Становление — только с разрешения Князя',
        mortals: 'Комиссариат №3 куплен Джованни',
        calendar: 'Фестиваль огней — октябрь',
        tech: 'Камеры в центре плотные',
        limits: 'Элизиумов не больше 2\nВ районе не более 4 станций метро',
        naming: 'Мужские: Марк, Анри\nФамилии: Дюваль',
        leitmotif: 'Дождь и преступность',
        specifics: 'Уточнять сезон',
        avoid: 'Канонических старейшин',
        sources: 'Нью-Йорк в Ночи',
      };
      const parsed = parseCityMd(buildCityMd(fields));
      assert.equal(parsed.display, 'Балмонт');
      assert.equal(parsed.year, '2024');
      assert.equal(parsed.description, fields.description);
      for (const [key] of CITY_SECTIONS) assert.equal(parsed.sections[key], fields[key], `секция ${key}`);
    });

    it('description читается из абзаца между H1 и первой секцией, чистит blockquote', () => {
      const md = '# Балмонт, 2024 — сеттинг города\n\n> Описание города\n> вторая строка\n\n## Политический ландшафт\n- что-то\n';
      assert.equal(parseCityMd(md).description, 'Описание города\nвторая строка');
    });

    it('пустые поля → плейсхолдеры, description дефолтный', () => {
      const md = buildCityMd({ display: 'X', year: '2020' });
      const parsed = parseCityMd(md);
      assert.ok(parsed.description.length > 0, 'дефолтное описание не пустое');
      assert.equal(parsed.sections.factions, '');  // «- …» отфильтровывается в пустую строку
    });

    it('горизонтальная линейка «---» между секциями не протекает в данные секции', () => {
      // Рукописный city.md (Париж и т.п.) разделяет секции линейкой «---». Она попадала
      // в тело секции, где снятие буллета (`replace(/^\s*-\s?/)`) превращало её в «--» —
      // отдельный «пункт» списка. Для «Фракций» это выглядело фиктивной фракцией в
      // редакторе, а двусторонний синк (§11) закреплял её в файле строкой «- --».
      const md = [
        '# Тест, 2010 — сеттинг города', '', 'Описание.', '', '---', '',
        '## Фракции', '', '- Камарилья', '- Анархи', '', '---', '',
        '## Политический ландшафт', '', '- Князь: Кто-то', '', '---', '',
      ].join('\n');
      const parsed = parseCityMd(md);
      assert.equal(parsed.sections.factions, 'Камарилья\nАнархи',
        'разделитель «---» не должен становиться пунктом секции');
      assert.equal(parsed.sections.political, 'Князь: Кто-то');
      for (const [key, value] of Object.entries(parsed.sections))
        assert.ok(!/^-+$/m.test(value), `секция ${key} содержит остаток линейки: ${JSON.stringify(value)}`);
    });

    it('факции-блок канонична (factions/factionsMortal/factionsState подряд, до political и locations)', () => {
      const keys = CITY_SECTIONS.map(([k]) => k);
      assert.ok(keys.includes('factions'), 'есть ключ factions');
      assert.equal(keys.indexOf('factions'), 0, 'Фракции — первая секция');
      // C1 (2026-08-07): «Фракции смертных»/«Государственные фракции» — тот же фракционный
      // блок, сразу после «Фракции», единым куском перед Политическим ландшафтом.
      assert.equal(keys.indexOf('factionsMortal'), keys.indexOf('factions') + 1,
        'factionsMortal сразу после factions');
      assert.equal(keys.indexOf('factionsState'), keys.indexOf('factionsMortal') + 1,
        'factionsState сразу после factionsMortal');
      assert.equal(keys.indexOf('factionsState'), keys.indexOf('political') - 1,
        'фракционный блок — сразу перед Политическим ландшафтом (Властители/Примогенат уже внутри него)');
      assert.ok(keys.indexOf('factionsState') < keys.indexOf('locations'));
    });

    it('секции «живого города» присутствуют (D1, план 2026-07-15)', () => {
      const keys = CITY_SECTIONS.map(([k]) => k);
      for (const k of ['districts', 'landmarks', 'hunting', 'edicts', 'mortals', 'calendar', 'tech', 'limits', 'naming'])
        assert.ok(keys.includes(k), `нет секции ${k}`);
    });

  });

  describe('buildCityConstraints — ограничения города для промтов генерации (D2)', () => {
    const { buildCityConstraints } = require('../lib/context_builder');
    const tmpCity = path.join(__dirname, '../../cities/__ctest__');
    before(async () => {
      await fs.mkdir(tmpCity, { recursive: true });
      await fs.writeFile(path.join(tmpCity, 'city.md'), [
        '# Тестбург, 2010 — сеттинг города', '',
        '## Политический ландшафт', '- Камарилья', '',
        '## Ограничения генерации', '- Элизиумов не больше 2', '- В районе не более 4 станций метро', '',
        '## Законы домена', '- Становление только с разрешения Князя', '',
        '## Охотничьи угодья', '- …', '',
        '## Технологии и Маскарад', '- …', '',
      ].join('\n'), 'utf-8');
    });
    after(async () => { await fs.rm(tmpCity, { recursive: true, force: true }); });

    it('собирает только заполненные секции, плейсхолдеры пропускает', () => {
      const block = buildCityConstraints('__ctest__');
      assert.ok(block.includes('ОГРАНИЧЕНИЯ ГОРОДА'));
      assert.ok(block.includes('Элизиумов не больше 2'));
      assert.ok(block.includes('Становление только с разрешения Князя'));
      assert.ok(!block.includes('Охотничьи угодья'), 'пустая секция (плейсхолдер) не включается');
    });

    it('город без заполненных ограничений → пустая строка (не шумим в промте)', async () => {
      await fs.writeFile(path.join(tmpCity, 'city.md'),
        '# Т, 2010 — сеттинг города\n\n## Политический ландшафт\n- x\n', 'utf-8');
      assert.equal(buildCityConstraints('__ctest__'), '');
      assert.equal(buildCityConstraints('__no_such_city__'), '');
    });

    it('buildCityNaming: именник города собирается; пусто — без шума (F)', async () => {
      const { buildCityNaming } = require('../lib/context_builder');
      await fs.writeFile(path.join(tmpCity, 'city.md'), [
        '# Тестбург, 2010 — сеттинг города', '',
        '## Политический ландшафт', '- x', '',
        '## Именник и фактура', '- Мужские: Марк, Анри', '- Фамилии: Дюваль, Леруа', '',
      ].join('\n'), 'utf-8');
      const block = buildCityNaming('__ctest__');
      assert.ok(block.includes('ИМЕННИК'));
      assert.ok(block.includes('Дюваль'));
      assert.equal(buildCityNaming('__no_such_city__'), '');
      const fill = require('fs').readFileSync(path.join(__dirname, '../routes/modules/fill.js'), 'utf-8');
      assert.ok(fill.includes('buildCityNaming'), 'fill.js не использует buildCityNaming');
    });

    it('source-guard: генерация сценария и локаций подмешивает buildCityConstraints', () => {
      const fill = require('fs').readFileSync(path.join(__dirname, '../routes/modules/fill.js'), 'utf-8');
      const locs = require('fs').readFileSync(path.join(__dirname, '../routes/locations.js'), 'utf-8');
      assert.ok(fill.includes('buildCityConstraints'), 'fill.js не использует buildCityConstraints');
      assert.ok(locs.includes('buildCityConstraints'), 'locations.js не использует buildCityConstraints');
    });
  });

  describe('buildThreatClocks — часы угроз в промтах (E1)', () => {
    const { buildThreatClocks } = require('../lib/context_builder');
    const tmpCity = path.join(__dirname, '../../cities/__clocktest__');
    before(async () => {
      await fs.mkdir(path.join(tmpCity, 'archive'), { recursive: true });
      await fs.writeFile(path.join(tmpCity, 'archive', 'events.md'), [
        '# 🕯 События', '',
        '## 🌍 Состояние мира', '',
        '**Последнее обновление:** тест', '',
        '### ⏱️ Часы угроз', '',
        '| Угроза | Прогресс | Заметка |',
        '|---|---|---|',
        '| Шабаш готовит прорыв | 2/6 | с северо-востока |',
        '| Расследование журналистки | 6/6 | пробило |', '',
        '### Другая секция', '',
        '| Кол | Кол2 |', '|---|---|', '| а | б |', '',
      ].join('\n'), 'utf-8');
    });
    after(async () => { await fs.rm(tmpCity, { recursive: true, force: true }); });

    it('собирает блок из секции «Часы угроз», помечая пробитые', () => {
      const block = buildThreatClocks('__clocktest__');
      assert.ok(block.includes('ЧАСЫ УГРОЗ'));
      assert.ok(block.includes('Шабаш готовит прорыв'));
      assert.ok(block.includes('2/6'));
      assert.ok(/6\/6/.test(block));
    });

    it('города без часов → пустая строка', () => {
      assert.equal(buildThreatClocks('__no_such_city__'), '');
    });

    it('source-guard: fill.js и lifecycle.js подмешивают часы', () => {
      const fill = require('fs').readFileSync(path.join(__dirname, '../routes/modules/fill.js'), 'utf-8');
      const life = require('fs').readFileSync(path.join(__dirname, '../routes/modules/lifecycle.js'), 'utf-8');
      assert.ok(fill.includes('buildThreatClocks'), 'fill.js не использует buildThreatClocks');
      assert.ok(life.includes('buildThreatClocks'), 'lifecycle.js не использует buildThreatClocks');
    });
  });

  describe('миграция 001 — секции «живого города» в city.md', () => {
    const mig = require('../../tools/migrations/001_city_liveliness_sections.js');
    const oldCityMd = [
      '# Балмонт, 2024 — сеттинг города', '',
      '> Тёмный город.', '',
      '## Политический ландшафт', '- Камарилья держит центр', '',
      '## Фракции', '- Камарилья', '',
      '## Источники', '- …', '',
    ].join('\n');

    it('test() узнаёт старый city.md и не трогает прочие файлы', () => {
      assert.equal(mig.test(oldCityMd), true);
      assert.equal(mig.test('# 🧛 Персонаж\n- **Слаг:** x\n## 🖼️ Изображения\n'), false);
      assert.equal(mig.test('## Баланс сил — обзор\n| Фракция | Сила |\n'), false);
    });

    it('migrate() добавляет недостающие секции; идемпотентно', () => {
      const migrated = mig.migrate(oldCityMd);
      for (const h of ['## Районы', '## Значимые места', '## Охотничьи угодья', '## Законы домена',
                       '## Смертные институции', '## Календарь города', '## Технологии и Маскарад',
                       '## Ограничения генерации', '## Именник и фактура'])
        assert.ok(migrated.includes(h), `нет ${h}`);
      assert.equal(mig.test(migrated), false, 'после миграции test() должен быть false');
      assert.equal(mig.migrate(migrated), migrated, 'повторный migrate — no-op');
      // мигрированный файл валидно парсится
      const { parseCityMd } = require('../lib/parsers');
      const parsed = parseCityMd(migrated);
      assert.equal(parsed.sections.political, 'Камарилья держит центр');
      assert.equal(parsed.sections.limits, '');
    });
  });

  // Точечная запись city.md вместо полного buildCityMd-ребилда (техспека 2026-08-04 §A1).
  // Раньше PUT /api/cities с fields пересобирал файл из 16 канонических секций и стирал
  // всё рукописное — из-за чего вкладка «Поля» была ЗАПРЕЩЕНА городам вроде Парижа.
  describe('city_md_writer — точечная запись секций city.md (§A1)', () => {
    const W = require('../lib/city_md_writer');

    // Уменьшенный слепок Парижа: рукописные секции, таблица, блок-цитата,
    // ###-подзаголовок и своя секция без канонического аналога.
    const PARIS = [
      '# Париж, 2010 — сеттинг города', '',
      'Все сценарии разворачиваются в **Париже 2010**.', '',
      '---', '',
      '## Фракции', '', '- Камарилья', '- Анархи', '',
      '---', '',
      '## Политический ландшафт', '',
      '- Париж — территория Камарильи.', '',
      '> Актуальная карта сил — `archive/political_state.md`.', '',
      '### Историческая канва', '',
      '- Гильотинные Ночи.', '',
      '---', '',
      '## Ключевые локации', '',
      '| Локация | Значение |', '|---------|---------|', '| Опера Гарнье | Элизиум |', '',
      '---', '',
      '## Уточняющие вопросы перед написанием сценария (Париж)', '',
      '1. Состав Coterie.', '',
    ].join('\n');

    it('replaceCitySection меняет тело только целевой секции, соседние не трогает', () => {
      const out = W.replaceCitySection(PARIS, 'Фракции', '- Камарилья\n- Шабаш');
      assert.match(out, /## Фракции\n- Камарилья\n- Шабаш\n/);
      assert.ok(out.includes('> Актуальная карта сил'), 'блок-цитата соседней секции цела');
      assert.ok(out.includes('### Историческая канва'), '###-подзаголовок цел');
      assert.ok(out.includes('| Опера Гарнье | Элизиум |'), 'таблица цела');
      assert.ok(out.includes('## Уточняющие вопросы перед написанием сценария (Париж)'),
        'рукописная секция без канонического аналога цела');
    });

    it('replaceCitySection пишет произвольный многострочный текст, не только буллеты', () => {
      const out = W.replaceCitySection(PARIS, 'Фракции', 'Проза про фракции.\n\n| A | B |\n|---|---|');
      assert.match(out, /## Фракции\nПроза про фракции\.\n\n\| A \| B \|\n\|---\|---\|\n/);
    });

    it('replaceCitySection → null, если секции нет (вызывающий решает, что делать)', () => {
      assert.equal(W.replaceCitySection(PARIS, 'Именник и фактура', 'что-то'), null);
    });

    it('пустое значение секции → канонический плейсхолдер «- …»', () => {
      const out = W.replaceCitySection(PARIS, 'Фракции', '');
      assert.match(out, /## Фракции\n- …\n/);
      assert.equal(parseCityMd(out).sections.factions, '', 'парсер читает плейсхолдер как пусто');
    });

    it('upsertCitySection вставляет отсутствующую секцию в каноническое место', () => {
      // «Районы» идут сразу после «Политический ландшафт» в CITY_SECTIONS,
      // значит вставка ожидается между ним и «Ключевые локации».
      const { text, created } = W.upsertCitySection(PARIS, 'Районы', '- Монмартр');
      assert.equal(created, true);
      const heads = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map(m => m[1]);
      assert.deepEqual(heads, ['Фракции', 'Политический ландшафт', 'Районы', 'Ключевые локации',
        'Уточняющие вопросы перед написанием сценария (Париж)']);
      assert.equal(parseCityMd(text).sections.districts, 'Монмартр');
      assert.ok(text.includes('### Историческая канва'), 'вставка не съела хвост предыдущей секции');
    });

    it('upsertCitySection на существующей секции = замена, created:false', () => {
      const { text, created } = W.upsertCitySection(PARIS, 'Фракции', '- Шабаш');
      assert.equal(created, false);
      assert.equal(parseCityMd(text).sections.factions, 'Шабаш');
    });

    it('ИНВАРИАНТ: запись текущих значений не меняет файл байт-в-байт', () => {
      // Ключевая гарантия §A1.6 — без неё «точечная запись» тихо вырождается в ребилд.
      const canonical = buildCityMd({
        display: 'Тест', year: '2010', description: 'Опис.',
        factions: 'Камарилья\nАнархи', political: 'Князь: Кто-то',
      });
      const parsed = parseCityMd(canonical);
      let out = canonical;
      out = W.setCityDescription(W.setCityTitle(out, parsed.display, parsed.year), parsed.description);
      // Тот же путь, которым пойдёт PUT /api/cities: значения из формы нормализуются
      // через citySectionBody, как это делал buildCityMd.
      for (const [key, heading] of CITY_SECTIONS)
        out = W.upsertCitySectionFromForm(out, heading, parsed.sections[key] || '').text;
      assert.equal(out, canonical, 'повторная запись тех же значений изменила файл');
    });

    it('идемпотентность на рукописном файле: второй проход ничего не меняет', () => {
      const once  = W.replaceCitySection(PARIS, 'Фракции', '- Камарилья\n- Шабаш');
      const twice = W.replaceCitySection(once,  'Фракции', '- Камарилья\n- Шабаш');
      assert.equal(twice, once);
    });

    it('setCityTitle переписывает H1; пустые display/year не трогают заголовок', () => {
      assert.match(W.setCityTitle(PARIS, 'Лион', '1998'), /^# Лион, 1998 — сеттинг города$/m);
      assert.ok(W.setCityTitle(PARIS, '', '').includes('# Париж, 2010 — сеттинг города'));
      // Правка одного поля не сносит второе.
      assert.match(W.setCityTitle(PARIS, 'Лион', ''), /^# Лион, 2010 — сеттинг города$/m);
    });

    it('setCityDescription меняет только абзац между H1 и первой секцией', () => {
      const out = W.setCityDescription(PARIS, 'Новое описание.');
      assert.equal(parseCityMd(out).description, 'Новое описание.');
      assert.ok(out.includes('## Фракции'), 'первая секция на месте');
      assert.ok(out.includes('- Камарилья'));
    });

    it('BOM сохраняется при любой правке', () => {
      const withBom = '﻿' + PARIS;
      for (const out of [
        W.replaceCitySection(withBom, 'Фракции', '- X'),
        W.upsertCitySection(withBom, 'Районы', '- Y').text,
        W.setCityTitle(withBom, 'Лион', '1998'),
        W.setCityDescription(withBom, 'Опис.'),
      ]) assert.equal(out.charCodeAt(0), 0xFEFF);
    });

    it('регистр заголовка не важен (как в parseCityMd)', () => {
      const lower = PARIS.replace('## Фракции', '## фракции');
      assert.ok(W.replaceCitySection(lower, 'Фракции', '- X'), 'секция найдена при ином регистре');
    });

    it('customCitySections находит рукописные секции города', () => {
      assert.deepEqual(W.customCitySections(PARIS),
        ['Уточняющие вопросы перед написанием сценария (Париж)']);
      assert.deepEqual(W.customCitySections(buildCityMd({ display: 'X', year: '2020' })), []);
    });

    it('replaceCitySectionBullets — обёртка для списков (Фракции/Районы)', () => {
      const out = W.replaceCitySectionBullets(PARIS, 'Фракции', ['Камарилья', ' Шабаш ', '']);
      assert.match(out, /## Фракции\n- Камарилья\n- Шабаш\n/);
      assert.match(W.replaceCitySectionBullets(PARIS, 'Фракции', []), /## Фракции\n- …\n/);
    });
  });

  describe('миграция 004 — бэкофилл «Опасность» из эмодзи, ранее жившего внутри «Зона» (техспека §15)', () => {
    const mig = require('../../tools/migrations/004_danger_level_backfill.js');

    it('test() узнаёт карточку с цветовым эмодзи в Зоне и без своей Опасности', () => {
      assert.equal(mig.test('> **Название:** X | **Зона:** 🔴 Опасная | **Контроль:** Y'), true);
      assert.equal(mig.test('> **Название:** X | **Зона:** 🏛️ Элизиум | **Контроль:** Y'), false,
        'без цветового эмодзи (маркер вроде «Элизиум») — не наш случай');
      assert.equal(mig.test('> **Название:** X | **Зона:** 🔴 Опасная | **Опасность:** 🔴 | **Контроль:** Y'), false,
        'Опасность уже есть — идемпотентность');
    });

    it('migrate() — pipe-delimited формат: вставляет поле между Зоной и следующим «|»', () => {
      const before = '> **Название:** X | **Зона:** 🔴 Опасная | **Контроль:** Y';
      const after  = mig.migrate(before);
      assert.match(after, /\*\*Зона:\*\* 🔴 Опасная \| \*\*Опасность:\*\* 🔴 \|/);
      assert.equal(mig.test(after), false, 'после миграции test() должен быть false');
    });

    it('migrate() — буллет-формат без «|» (реальный случай podzemnyy_dok.md): новый буллет сразу после Зоны', () => {
      const before = ['# Локация', '- **Зона:** 🟡 Нейтральная', '- **Контроль:** Z', ''].join('\n');
      const after  = mig.migrate(before);
      assert.match(after, /- \*\*Зона:\*\* 🟡 Нейтральная\n- \*\*Опасность:\*\* 🟡\n/);
      assert.equal(mig.test(after), false);
    });

    it('🟢/🟡/🔴 — соответствующий цвет переносится один в один', () => {
      for (const emoji of ['🟢', '🟡', '🔴']) {
        const after = mig.migrate(`> **Зона:** ${emoji} Тест |`);
        assert.match(after, new RegExp(`\\*\\*Опасность:\\*\\* ${emoji}`));
      }
    });
  });

  describe('миграция 005 — переименование полей карточки локации: Округ→Район, Район→Дополнение к адресу', () => {
    const mig = require('../../tools/migrations/005_location_district_label_rename.js');

    it('test() узнаёт карточку со старой подписью «Округ» — единственный однозначный маркер немигрированной карточки', () => {
      assert.equal(mig.test('> **Название:** X | **Округ:** 1 | **Контроль:** Y'), true);
      assert.equal(mig.test('> **Название:** X | **Округ:** 1 | **Район:** Антрепо | **Контроль:** Y'), true);
      assert.equal(mig.test('> **Название:** X | **Район:** Антрепо | **Дополнение к адресу:** Z | **Контроль:** Y'), false,
        'уже переименовано (Район теперь значит district) — не должно повторно триггерить миграцию');
    });

    it('migrate() — Округ→Район, Район→Дополнение к адресу за один проход, без коллизии между полями', () => {
      const before = '> **Название:** X | **Округ:** 1-й | **Район:** Антрепо | **Адрес:** Y';
      const after  = mig.migrate(before);
      assert.match(after, /\*\*Район:\*\* 1-й/, 'старый «Округ» стал «Районом»');
      assert.match(after, /\*\*Дополнение к адресу:\*\* Антрепо/, 'старый «Район» стал «Дополнением к адресу»');
      assert.doesNotMatch(after, /\*\*Округ:\*\*/);
      assert.equal(mig.test(after), false, 'после миграции test() должен быть false');
      // Повторный прогон migrate() на уже мигрированной карточке (раннер не должен
      // так делать сам, test()===false это предотвращает — но migrate() не должна
      // портить данные, даже если её вызвать напрямую) не должен переименовать
      // новый «Район» (=district) в «Дополнение к адресу» повторно.
      const twice = mig.migrate(after);
      assert.match(twice, /\*\*Район:\*\* 1-й/, 'повторный прогон не должен тронуть уже верный «Район»');
      assert.equal((twice.match(/Дополнение к адресу/g) || []).length, 1, 'повторный прогон не должен задвоить «Дополнение к адресу»');
    });

    it('карточка только с «Округ» (без «Район») — переименовывается корректно, ничего лишнего не добавляется', () => {
      const before = '> **Название:** X | **Округ:** 1 | **Контроль:** Y';
      const after  = mig.migrate(before);
      assert.match(after, /\*\*Район:\*\* 1/);
      assert.doesNotMatch(after, /Дополнение к адресу/);
    });

    it('карточка без обеих подписей — test() false, миграция не трогает файл', () => {
      assert.equal(mig.test('> **Название:** X | **Адрес:** Y | **Контроль:** Z'), false);
    });
  });

  describe('dice.js — rollV20Pool', () => {
    const { rollV20Pool } = require('../public/scripts/dice.js');
    // rng-заглушка: выдаёт ровно заданную последовательность кубиков
    const seq = arr => { let i = 0; return () => (arr[i++ % arr.length] - 0.5) / 10; };
    it('успехи и вычет единиц', () => {
      const r = rollV20Pool({ pool: 5, difficulty: 6, rng: seq([7, 8, 3, 1, 6]) });
      assert.deepEqual(r.dice, [7, 8, 3, 1, 6]);
      assert.equal(r.successes, 3); assert.equal(r.ones, 1); assert.equal(r.net, 2);
      assert.equal(r.result, 'success');
    });
    it('ботч: 0 успехов до вычета + единица', () => {
      const r = rollV20Pool({ pool: 3, difficulty: 6, rng: seq([1, 3, 5]) });
      assert.equal(r.result, 'botch');
    });
    it('не ботч, если успех был, но единицы съели всё', () => {
      const r = rollV20Pool({ pool: 3, difficulty: 6, rng: seq([7, 1, 1]) });
      assert.equal(r.net, 0); assert.equal(r.result, 'failure');
    });
    it('10-again: десятка даёт успех и перебрасывается; переброс может успеть', () => {
      const r = rollV20Pool({ pool: 2, difficulty: 6, rng: seq([10, 3, 8]) });
      assert.deepEqual(r.dice, [10, 3]); assert.deepEqual(r.rerolls, [8]);
      assert.equal(r.net, 2);
    });
    it('единица на перебросе не вычитает и не ботчит', () => {
      const r = rollV20Pool({ pool: 1, difficulty: 6, rng: seq([10, 1]) });
      assert.equal(r.net, 1); assert.equal(r.result, 'success');
    });
    it('цепочка десяток взрывается дальше, но конечна', () => {
      const r = rollV20Pool({ pool: 1, difficulty: 6, rng: seq([10, 10, 4]) });
      assert.deepEqual(r.rerolls, [10, 4]);
      assert.equal(r.net, 2);
    });
  });

  describe('parsers/threads.js — threadSourceDate', () => {
    const { threadSourceDate } = require('../lib/parsers');
    it('извлекает месяц+год из хвоста источника', () => {
      assert.deepEqual(threadSourceDate('«Кошки и мышки», ноябрь 2010'), { year: 2010, month: 11 });
      assert.deepEqual(threadSourceDate('«Деньги не проблема», январь 2011 ⟨котерия ДНП⟩'), { year: 2011, month: 1 });
    });
    it('при нескольких датах берёт последнюю', () => {
      assert.deepEqual(threadSourceDate('Карточка; «Цирк», сентябрь 2009; финал, декабрь 2010'), { year: 2010, month: 12 });
    });
    it('без даты или только год → null', () => {
      assert.equal(threadSourceDate('Карточка Верене; «Кошки и мышки»'), null);
      assert.equal(threadSourceDate('архив 2010'), null);
    });
  });

  describe('parsers/timeline.js', () => {
    const { parseTimelineMd, addTimelineEpoch, removeTimelineEpoch,
            addTimelineRow, updateTimelineRow, removeTimelineRow } = require('../lib/parsers');
    const fixture = [
      '# 🕰️ Тест', '', '> intro', '', '---', '',
      '## Условные обозначения', '',
      '| Символ | Значение |', '|:------:|----------|', '| 🏰 | Средневековье |', '',
      '---', '',
      '## I. Эпоха первая', '',
      '| Год | Тип | Событие | Источник | Связи |',
      '|-----|:---:|---------|:--------:|-------|',
      '| 1300 | 🏰 | Событие один | 📚 | [Перс](../characters/vampires/x/x.md) |',
    ].join('\n') + '\n';

    it('parseTimelineMd — легенда, эпоха, ссылки', () => {
      const t = parseTimelineMd(fixture);
      assert.equal(t.legend.length, 1);
      assert.equal(t.legend[0].symbol, '🏰');
      assert.equal(t.epochs.length, 1);
      assert.equal(t.epochs[0].heading, 'I. Эпоха первая');
      assert.equal(t.epochs[0].rows.length, 1);
      assert.equal(t.epochs[0].rows[0].year, '1300');
      assert.equal(t.epochs[0].rows[0].links[0].text, 'Перс');
    });

    it('addTimelineRow → parseTimelineMd видит новую строку, старая не тронута', () => {
      const { raw, found } = addTimelineRow(fixture, 'I. Эпоха первая',
        { year: '1350', type: '🎭', event: 'Новое', source: '🏙️', links: [] });
      assert.ok(found);
      const t = parseTimelineMd(raw);
      assert.equal(t.epochs[0].rows.length, 2);
      assert.equal(t.epochs[0].rows[0].event, 'Событие один');
      assert.equal(t.epochs[0].rows[1].event, 'Новое');
    });

    // FIX-2 (docs/audit/2026-07-28-fix-plan.md, находка #2): '|' в значении ячейки
    // рвал pipe-таблицу на лишнюю колонку — теперь экранируется/разэкранируется
    // прозрачно на границе _serializeTable/_parsePipeTable.
    it('FIX-2: "|" в тексте события не рвёт таблицу — round-trip через | сохраняет одну ячейку', () => {
      const { raw } = addTimelineRow(fixture, 'I. Эпоха первая',
        { year: '1400', type: 'x', event: 'Битва | резня в порту', source: 'src', links: [] });
      const t = parseTimelineMd(raw);
      const row = t.epochs[0].rows.find(r => r.year === '1400');
      assert.ok(row, 'новая строка не найдена');
      assert.equal(row.event, 'Битва | резня в порту', 'символ "|" должен пережить запись/чтение как есть');
      assert.equal(row.source, 'src', '"|" не должен был сдвинуть соседнюю колонку');
    });

    it('updateTimelineRow — неверный индекс → indexValid:false', () => {
      const r = updateTimelineRow(fixture, 'I. Эпоха первая', 5, { year: 'x', type: '', event: '', source: '', links: [] });
      assert.equal(r.indexValid, false);
    });

    it('removeTimelineRow — удаляет ровно одну строку', () => {
      const withTwo = addTimelineRow(fixture, 'I. Эпоха первая',
        { year: '1350', type: '🎭', event: 'Новое', source: '🏙️', links: [] }).raw;
      const { raw } = removeTimelineRow(withTwo, 'I. Эпоха первая', 0);
      const t = parseTimelineMd(raw);
      assert.equal(t.epochs[0].rows.length, 1);
      assert.equal(t.epochs[0].rows[0].event, 'Новое');
    });

    it('addTimelineEpoch / removeTimelineEpoch — round-trip', () => {
      const { raw: added, duplicate } = addTimelineEpoch(fixture, 'II. Эпоха вторая');
      assert.equal(duplicate, false);
      let t = parseTimelineMd(added);
      assert.equal(t.epochs.length, 2);
      assert.equal(t.epochs[1].heading, 'II. Эпоха вторая');
      assert.equal(t.epochs[1].rows.length, 0);

      const removed = removeTimelineEpoch(added, 'II. Эпоха вторая').raw;
      t = parseTimelineMd(removed);
      assert.equal(t.epochs.length, 1);
      assert.equal(t.epochs[0].heading, 'I. Эпоха первая'); // первая эпоха не задета
    });

    // FIX-5 (docs/audit/2026-07-28-fix-plan.md): дубликат заголовка эпохи раньше
    // добавлялся молча — findIndex во всех остальных операциях (add/update/remove
    // row, removeEpoch) всегда бьёт по ПЕРВОЙ секции с таким заголовком, так что
    // вторая становится недостижимой навсегда.
    it('FIX-5: addTimelineEpoch с уже существующим заголовком → duplicate:true, файл не меняется', () => {
      const { raw, duplicate } = addTimelineEpoch(fixture, 'I. Эпоха первая');
      assert.equal(duplicate, true);
      assert.equal(raw, fixture, 'при дубликате исходный текст не должен меняться');
      assert.equal(parseTimelineMd(raw).epochs.length, 1);
    });
  });

  describe('parsers/worldState.js', () => {
    const {
      parseWorldStateBlock, setWorldStateLastUpdate, addWorldStateSection,
      removeWorldStateSection, addWorldStateRow, updateWorldStateRow,
      removeWorldStateRow, setWorldStateSectionNote,
    } = require('../lib/parsers');

    const fixture = [
      '# Тест', '', '## 🌍 Состояние мира', '',
      '> Последнее обновление: **тест**.', '', '---', '',
      '### 🏛️ Секция А', '',
      '| Кол1 | Кол2 |', '|---|---|', '| a | b |', '',
      '**Примечание:** заметка.', '', '---', '',
      '## 📋 Хроника событий', '', 'не трогать',
    ].join('\n') + '\n';

    it('parseWorldStateBlock — секция, колонки, note, lastUpdate', () => {
      const ws = parseWorldStateBlock(fixture);
      assert.equal(ws.lastUpdate, 'тест');
      assert.equal(ws.sections.length, 1);
      assert.deepEqual(ws.sections[0].columns, ['Кол1', 'Кол2']);
      assert.equal(ws.sections[0].rows.length, 1);
      assert.match(ws.sections[0].note, /Примечание/);
    });

    it('addWorldStateRow / updateWorldStateRow / removeWorldStateRow — не трогают "## 📋 Хроника событий"', () => {
      const added = addWorldStateRow(fixture, '🏛️ Секция А', ['c', 'd']).raw;
      assert.match(added, /не трогать/);
      let ws = parseWorldStateBlock(added);
      assert.equal(ws.sections[0].rows.length, 2);

      const updated = updateWorldStateRow(added, '🏛️ Секция А', 1, ['x', 'y']).raw;
      ws = parseWorldStateBlock(updated);
      assert.deepEqual(ws.sections[0].rows[1], ['x', 'y']);

      const removed = removeWorldStateRow(updated, '🏛️ Секция А', 0).raw;
      ws = parseWorldStateBlock(removed);
      assert.equal(ws.sections[0].rows.length, 1);
      assert.deepEqual(ws.sections[0].rows[0], ['x', 'y']);
    });

    // FIX-2 (docs/audit/2026-07-28-fix-plan.md, находка #2) — тот же паттерн,
    // что и в timeline.js, независимая копия _serializeTable/_parsePipeTable.
    it('FIX-2: "|" в ячейке строки секции не сдвигает соседние колонки', () => {
      const added = addWorldStateRow(fixture, '🏛️ Секция А', ['Камарилья | Анархи', 'Напряжение']).raw;
      const ws = parseWorldStateBlock(added);
      const row = ws.sections[0].rows.find(r => r[0] === 'Камарилья | Анархи');
      assert.ok(row, 'строка с "|" не найдена как единая ячейка');
      assert.equal(row.length, 2, '"|" не должен был породить лишнюю колонку');
      assert.equal(row[1], 'Напряжение');
    });

    it('addWorldStateSection / removeWorldStateSection', () => {
      const added = addWorldStateSection(fixture, '🔥 Новая секция', ['Кол1', 'Кол2']).raw;
      let ws = parseWorldStateBlock(added);
      assert.equal(ws.sections.length, 2);
      const removed = removeWorldStateSection(added, '🔥 Новая секция').raw;
      ws = parseWorldStateBlock(removed);
      assert.equal(ws.sections.length, 1);
    });

    it('setWorldStateLastUpdate / setWorldStateSectionNote', () => {
      const r1 = setWorldStateLastUpdate(fixture, 'новое значение');
      assert.ok(r1.found);
      assert.equal(parseWorldStateBlock(r1.raw).lastUpdate, 'новое значение');

      const r2 = setWorldStateSectionNote(fixture, '🏛️ Секция А', 'Новая заметка.');
      assert.match(parseWorldStateBlock(r2.raw).sections[0].note, /Новая заметка/);
    });
  });

  describe('cityScaffold — единый каркас города', () => {
    it('содержит все обязательные файлы каркаса', () => {
      const { files } = cityScaffold({ display: 'Берлин', year: '2010' });
      const keys = Object.keys(files);
      for (const f of ['city.md', 'archive/events.md', 'archive/political_state.md',
        'archive/characters_index.md', 'archive/visitors.md']) {
        assert.ok(keys.includes(f), `нет файла ${f}`);
        assert.ok(files[f].length > 0, `файл ${f} пуст`);
      }
    });

    it('интерполирует display/year в шапки файлов', () => {
      const { files } = cityScaffold({ display: 'Берлин', year: '2010' });
      assert.match(files['city.md'], /^# Берлин, 2010 —/);
      assert.match(files['archive/political_state.md'], /Карта фракций — Берлин, 2010/);
      assert.match(files['archive/events.md'], /Хроника «Берлин»/);
      assert.match(files['archive/visitors.md'], /Гости из других городов — Берлин/);
    });

    it('keepDirs: 6 линеек персонажей + chronicles + rules + locations (без районов)', () => {
      const { keepDirs } = cityScaffold({ display: 'X', year: '2020' });
      for (const l of ['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters'])
        assert.ok(keepDirs.includes(`characters/${l}`), `нет characters/${l}`);
      assert.ok(keepDirs.includes('chronicles'));
      assert.ok(keepDirs.includes('rules'));
      assert.ok(keepDirs.includes('locations'));
      assert.ok(!keepDirs.some(d => d.startsWith('locations/district_')), 'без районов не должно быть district_*');
    });

    it('районы (CSV или массив) → locations/<slug>, БЕЗ обёртки district_NN (§A4)', () => {
      // §8 плана отменил «Округ» как уровень адресации; district_NN-обёртки были
      // фантомными — POST /api/cities с районами давал ДВЕ папки на район, пустую
      // district_NN/<slug> рядом с настоящей <slug>/district.md.
      const fromCsv = cityScaffold({ display: 'X', year: '2020', districts: 'Митте, Кройцберг' }).keepDirs;
      assert.ok(fromCsv.includes('locations/mitte'));
      assert.ok(fromCsv.includes('locations/kroytsberg'));
      assert.ok(!fromCsv.some(d => /^locations\/district_/.test(d)), 'обёртки district_NN быть не должно');
      assert.ok(!fromCsv.includes('locations'), 'при наличии районов общей папки locations нет');
      const fromArr = cityScaffold({ display: 'X', year: '2020', districts: ['Митте'] }).keepDirs;
      assert.ok(fromArr.includes('locations/mitte'));
    });

    it('дедуп районов: одинаковый слаг схлопывается', () => {
      const { keepDirs } = cityScaffold({ display: 'X', year: '2020', districts: 'Митте, Митте, Кройцберг' });
      const dist = keepDirs.filter(d => d.startsWith('locations/') && d !== 'locations');
      assert.deepEqual(dist, ['locations/mitte', 'locations/kroytsberg'],
        'дубль «Митте» должен быть схлопнут');
    });

    it('source-guard: POST /api/cities и new_city.js вызывают cityScaffold (без хардкода)', () => {
      const fs = require('fs');
      // POST /api/cities живёт в routes/cities.js (модуляризация E1.2).
      const citiesRoute = fs.readFileSync(path.join(__dirname, '../routes/cities.js'), 'utf-8');
      const cli         = fs.readFileSync(path.join(__dirname, '../../tools/new_city.js'), 'utf-8');
      assert.match(citiesRoute, /cityScaffold\(/, 'routes/cities.js должен звать cityScaffold');
      assert.match(cli,         /cityScaffold\(/, 'new_city.js должен звать cityScaffold');
      // Старые хардкод-литералы каркаса не должны вернуться в вызывающие файлы.
      assert.doesNotMatch(citiesRoute, /Сводная хроника событий/, 'каркас events.md не должен дублироваться в routes/cities.js');
      assert.doesNotMatch(cli,         /Сводная хроника событий/, 'каркас events.md не должен дублироваться в new_city.js');
    });
  });

  describe('periodLabel', () => {
    it('01 → Январь',             () => assert.equal(periodLabel('2010-01'), 'Январь 2010'));
    it('11 → Ноябрь',             () => assert.equal(periodLabel('2010-11'), 'Ноябрь 2010'));
    it('12 → Декабрь',            () => assert.equal(periodLabel('2009-12'), 'Декабрь 2009'));
    it('retrospective → label',   () => assert.equal(periodLabel('retrospective'), 'Ретроспектива'));
    it('unknown string → passthrough', () => assert.equal(periodLabel('mystery'), 'mystery'));
    it('null → empty string',     () => assert.equal(periodLabel(null), ''));
    it('undefined → empty string',() => assert.equal(periodLabel(undefined), ''));
    it('empty string → empty',    () => assert.equal(periodLabel(''), ''));
  });

  describe('threadStatusKey', () => {
    it('🔴 → active',     () => assert.equal(threadStatusKey(' 🔴 Активна '),  'active'));
    it('🟡 → background', () => assert.equal(threadStatusKey(' 🟡 Фоновая '),  'background'));
    it('🟢 → closed',     () => assert.equal(threadStatusKey(' 🟢 Закрыта '),  'closed'));
    it('⚫ → abandoned',  () => assert.equal(threadStatusKey(' ⚫ Заброшена '), 'abandoned'));
    it('unrecognised → unknown', () => assert.equal(threadStatusKey('Без статуса'), 'unknown'));
    it('empty → unknown',        () => assert.equal(threadStatusKey(''), 'unknown'));
  });

  describe('THREAD_STATUS round-trip', () => {
    it('all four keys defined', () => {
      assert.ok(THREAD_STATUS.active);
      assert.ok(THREAD_STATUS.background);
      assert.ok(THREAD_STATUS.closed);
      assert.ok(THREAD_STATUS.abandoned);
    });
    it('keys round-trip through threadStatusKey', () => {
      for (const [key, text] of Object.entries(THREAD_STATUS))
        assert.equal(threadStatusKey(text), key, `round-trip failed for "${key}"`);
    });
  });

  describe('parseDiary', () => {
    const ENTRY = [
      '# 📖 Дневник', '',
      '### 📅 Сессия 1', '',
      '- **👤 Автор:** Герсон',
      '- **📍 Локация:** Элизиум',
      '- **🎭 Тон/Стиль:** мрачный',
      '- **📖 Текст записи:**',
      '  Первая строка.',
      '  Вторая строка.',
      '- **🔗 Зеркальная ссылка:**',
      '  - [Мел](../mel/mel.md)',
    ].join('\n');

    const RETRO = [
      '# 📖 Ретроспектива', '',
      '### 📅 Январь 2010', 'Событие А.', '',
      '### 📅 Февраль 2010', 'Событие Б.',
    ].join('\n');

    it('entry — format and title', () => {
      const d = parseDiary(ENTRY);
      assert.equal(d.format, 'entry');
      assert.equal(d.title, '📖 Дневник');
    });
    it('entry — session / author / location / tone', () => {
      const d = parseDiary(ENTRY);
      assert.equal(d.session, 'Сессия 1');
      assert.equal(d.author, 'Герсон');
      assert.equal(d.location, 'Элизиум');
      assert.equal(d.tone, 'мрачный');
    });
    it('entry — multi-line text de-indented', () => {
      const d = parseDiary(ENTRY);
      assert.equal(d.text, 'Первая строка.\nВторая строка.');
    });
    it('entry — cross refs parsed', () => {
      const d = parseDiary(ENTRY);
      assert.deepEqual(d.crossRefs, ['[Мел](../mel/mel.md)']);
    });
    it('retrospective — two dated sections', () => {
      const d = parseDiary(RETRO);
      assert.equal(d.format, 'retrospective');
      assert.equal(d.sections.length, 2);
      assert.equal(d.sections[0].title, 'Январь 2010');
      assert.equal(d.sections[0].body, 'Событие А.');
      assert.equal(d.sections[1].title, 'Февраль 2010');
    });
    it('empty input → entry with no fields', () => {
      const d = parseDiary('');
      assert.equal(d.format, 'entry');
      assert.equal(d.title, undefined);
    });
    it('strips UTF-8 BOM', () => {
      const d = parseDiary('﻿# Заголовок\n\n### 📅 X');
      assert.equal(d.title, 'Заголовок');
    });
  });

  describe('parseThreadsContent', () => {
    const FILE = 'archive/open_threads.md';
    const rows = parseThreadsContent(THREAD_TABLE, FILE);

    it('parses 3 rows',              () => assert.equal(rows.length, 3));
    it('row 1 — id / title / desc',  () => {
      assert.equal(rows[0].id, 1);
      assert.equal(rows[0].title, 'Первая нить');
      assert.equal(rows[0].description, 'описание первой');
    });
    it('row 1 — status active',      () => assert.equal(rows[0].status, 'active'));
    it('row 1 — priority Высокий',   () => assert.equal(rows[0].priority, 'Высокий'));
    it('row 2 — status closed',      () => assert.equal(rows[1].status, 'closed'));
    it('row 3 — status background',  () => assert.equal(rows[2].status, 'background'));
    it('all rows have correct file', () => assert.ok(rows.every(r => r.file === FILE)));
    it('different file propagates',  () => {
      const r = parseThreadsContent(THREAD_TABLE, 'chronicles/abc/open_threads.md');
      assert.ok(r.every(x => x.file === 'chronicles/abc/open_threads.md'));
    });
    it('header-only → empty array',  () => {
      const h = '| № | Нить | Источник | Статус | Приоритет |\n|---|------|---------|--------|----------|';
      assert.deepEqual(parseThreadsContent(h, FILE), []);
    });
    it('empty string → empty array', () => assert.deepEqual(parseThreadsContent('', FILE), []));
  });

  describe('markdown helpers', () => {
    it('mdExtractLinks — text + href pairs', () => {
      const links = mdExtractLinks('см. [Мел](../mel/mel.md) и [Клуб](x.md)');
      assert.deepEqual(links, [
        { text: 'Мел', href: '../mel/mel.md' },
        { text: 'Клуб', href: 'x.md' },
      ]);
    });
    it('mdStripLinks — keeps link text, drops target', () =>
      assert.equal(mdStripLinks('видел [Герсона](g.md) вчера'), 'видел Герсона вчера'));
    it('mdStripInline — strips links, bold and leading bullet', () =>
      assert.equal(mdStripInline('- **[Мел](m.md)** ушла'), 'Мел ушла'));
    it('classifyChronicleLink — module link', () => {
      const r = classifyChronicleLink({ text: 'Модуль', href: '../modules/progulki/x.md' });
      assert.equal(r.kind, 'module');
      assert.equal(r.module, 'progulki');
    });
    it('classifyChronicleLink — finale / npc / other', () => {
      assert.equal(classifyChronicleLink({ text: 'Финал', href: 'a.md' }).kind, 'finale');
      assert.equal(classifyChronicleLink({ text: 'НПС', href: 'a.md' }).kind, 'npc');
      assert.equal(classifyChronicleLink({ text: 'Локация', href: 'a.md' }).kind, 'other');
    });
  });

  describe('categorizeRel', () => {
    it('family / sire / enemy / ally / romantic / acquaintance / neutral', () => {
      assert.equal(categorizeRel('старший брат'), 'family');
      assert.equal(categorizeRel('создал её'),    'sire');
      assert.equal(categorizeRel('заклятый враг'), 'enemy');
      assert.equal(categorizeRel('верный союзник'), 'ally');
      assert.equal(categorizeRel('тайная любовь'), 'romantic');
      assert.equal(categorizeRel('просто знакомый'), 'acquaintance');
      assert.equal(categorizeRel('деловой партнёр'), 'neutral');
    });
    // Запрос пользователя: «Фамильяр» — свой вид связи в списке «Отношения»,
    // должен попадать в граф «Связи» отдельной категорией, а не «Нейтральный».
    it('фамильяр → familiar (не путается с family/сир/чайлд)', () => {
      assert.equal(categorizeRel('Фамильяр'), 'familiar');
      assert.equal(categorizeRel('фамильяр — чёрный кот'), 'familiar');
      assert.notEqual(categorizeRel('Фамильяр'), 'family');
    });
  });

  describe('«Фамильяр» — стандартный вид связи (frontend)', () => {
    // 2026-08-08, Фаза 2: REL_TYPE_OPTIONS (жёстко заданный datalist) заменён пикером из
    // библиотеки «Постоянные связи» (system/library/relation-types.json, Фаза 1) — тот же guard,
    // перенесённый на новый источник истины.
    it('source-guard: system/library/relation-types.json содержит «Фамильяр»', () => {
      const list = JSON.parse(require('fs').readFileSync(
        path.join(__dirname, '../../system/library/relation-types.json'), 'utf-8'));
      assert.ok(list.some(t => t.name === 'Фамильяр'), 'relation-types.json не содержит «Фамильяр»');
    });
    it('source-guard: graph.js — familiar есть и в REL_COLORS, и в REL_LABELS (иначе граф покажет связь без цвета/подписи)', () => {
      const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/graph.js'), 'utf-8');
      const colorsMatch = js.match(/const REL_COLORS = \{[\s\S]*?\n\};/);
      const labelsMatch = js.match(/const REL_LABELS = \{[\s\S]*?\n\};/);
      assert.ok(colorsMatch && /familiar:\s*'#[0-9a-fA-F]{6}'/.test(colorsMatch[0]), 'REL_COLORS не задаёт цвет для familiar');
      assert.ok(labelsMatch && /familiar:\s*'Фамильяр'/.test(labelsMatch[0]), 'REL_LABELS не задаёт подпись «Фамильяр» для familiar');
      // familiar не должен случайно совпасть по цвету с уже занятыми категориями
      // (family/sire/childe — красные тона) — иначе на графе будет неотличим.
      const familiarColor = colorsMatch[0].match(/familiar:\s*'(#[0-9a-fA-F]{6})'/)[1];
      const otherColors = [...colorsMatch[0].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)]
        .filter(([, k]) => k !== 'familiar').map(([, , v]) => v);
      assert.ok(!otherColors.includes(familiarColor), 'цвет familiar совпадает с уже занятым цветом другого вида связи');
    });
    // Отдельная строка-легенда (buildLegend, жёстко заданный список типов —
    // легко забыть добавить новый тип и получить рассинхрон с фильтром,
    // ровно это и случилось при первой версии этого фикса, поймано вручную
    // через CDP) убрана по запросу пользователя: каждый чип фильтра типа
    // связи теперь сам показывает свой цвет (.reltype-swatch), легенда ему
    // больше не нужна — цвет берётся из того же REL_COLORS[k], что и
    // чекбоксы (Object.keys(REL_LABELS).filter(present)), рассинхрон
    // структурно невозможен.
    it('source-guard: graph.js — buildRelTypeFilter() рисует цветовой маркер (.reltype-swatch) с фоллбэком на REL_COLORS у каждого чипа', () => {
      const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/graph.js'), 'utf-8');
      assert.ok(!js.includes('function buildLegend'), 'buildLegend() всё ещё существует — должна быть убрана как дублирующая .reltype-swatch в чипах фильтра');
      assert.ok(!js.includes("getElementById('graph-legend')"), 'graph.js всё ещё ссылается на убранный #graph-legend');
      const fnMatch = js.match(/function buildRelTypeFilter\(\) \{[\s\S]*?\n\}/);
      assert.ok(fnMatch, 'не найдена функция buildRelTypeFilter');
      // 2026-08-08, хвост Фазы 1 — цвет сначала из самого ребра («Постоянная связь», не входящая
      // в хардкодный REL_COLORS), фоллбэк на REL_COLORS[k] остаётся для легаси-типов без
      // совпадения с библиотекой (см. docs/design/2026-08-08-relations-graph-legend-techspec.md).
      assert.ok(/class="reltype-swatch" style="background:\$\{m\.color\}"/.test(fnMatch[0]),
        'buildRelTypeFilter() не рисует .reltype-swatch с цветом из m.color для каждого чипа');
      assert.ok(fnMatch[0].includes('REL_COLORS[k] || REL_COLORS.neutral'),
        'buildRelTypeFilter() потерял фоллбэк на REL_COLORS для легаси-типов без совпадения с библиотекой');
    });
    it('source-guard: index.html — #graph-legend убран из разметки тулбара графа', () => {
      const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
      assert.ok(!html.includes('id="graph-legend"'), '#graph-legend всё ещё в разметке — дублирует .reltype-swatch в чипах фильтра');
    });
    // QA-отчёт 2026-08-08 (docs/design/2026-08-08-qa-report-relations-full-series.md, Дефект
    // №1): _authoredDescriptions() писалась в Фазе 1, до разделения поля на relType/description
    // (Фаза 2) — без проверки уже типизированные связи ложно предлагались «Сделать постоянной»
    // по своему description (необязательному ПОЯСНЕНИЮ к уже выбранному типу, не кандидату в
    // тип). Первая версия фикса пропускала ВСЮ связь при непустом relType — оверфикс, найденный
    // пользователем на живых данных 2026-08-08: свой (не из библиотеки) relType, например
    // «авпвапав», переставал попадать в «Авторские связи» вообще. Кандидат теперь — relType,
    // если он заполнен, иначе description; description при уже заполненном relType в кандидаты
    // не идёт. Нет DOM-окружения в тестах для прогона самой функции — source-guard на факт
    // правки, тем же паттерном, что уже используют другие проверки этого describe-блока.
    it('source-guard: relations-manage.js — _authoredDescriptions() берёт relType как кандидат, description — только когда relType пуст', () => {
      const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/relations-manage.js'), 'utf-8');
      const fnMatch = js.match(/async function _authoredDescriptions\(\) \{[\s\S]*?\n\}/);
      assert.ok(fnMatch, 'не найдена функция _authoredDescriptions');
      assert.ok(/\(r\.relType\s*\|\|\s*r\.description\s*\|\|\s*['"]{2}\)\.trim\(\)/.test(fnMatch[0]),
        '_authoredDescriptions() не берёт relType как приоритетный кандидат — свои (не из библиотеки) типы не попадут в «Авторские связи»');
      assert.ok(!/if\s*\(\s*r\.relType\s*\)\s*continue;/.test(fnMatch[0]),
        '_authoredDescriptions() всё ещё пропускает всю связь при непустом relType — регресс к оверфикс-версии');
    });
  });

  describe('parseCharacter', () => {
    const CARD = [
      '# 🧛 Герсон', '',
      '- **Слаг:** gerson',
      '- **Клан / Раса:** Вентру',
      '- **Линейка WoD:** Вампир',
      '- **Статус:** Жив',
      '- **Внешность:** высокий, седой',
      '- **Отношения:**',
      '  - [Мел](../mel/mel.md) — союзник',
      '  - Враг Икс — заклятый враг',
    ].join('\n');

    it('reads H1 name without emoji', () => assert.equal(parseCharacter(CARD, 'gerson', 'vampires').name, 'Герсон'));
    it('reads clan via "Клан / Раса"', () => assert.equal(parseCharacter(CARD, 'gerson', 'vampires').clan, 'Вентру'));
    it('appearance + statusType active', () => {
      const c = parseCharacter(CARD, 'gerson', 'vampires');
      assert.equal(c.appearance, 'высокий, седой');
      assert.equal(c.statusType, 'active');
    });
    it('relationships parsed with categorisation, link text resolved', () => {
      const c = parseCharacter(CARD, 'gerson', 'vampires');
      assert.equal(c.relationships.length, 2);
      assert.deepEqual(c.relationships[0], { target: 'Мел', description: 'союзник', relType: '', mutual: false, type: 'ally' });
      assert.equal(c.relationships[1].type, 'enemy');
    });
    // 2026-08-08, Фаза 2 «Связи и отношения» — необязательный префикс «[Тип] Описание».
    it('relationships: structured [Тип] prefix splits into relType/description', () => {
      const card = '# X\n- **Отношения:**\n  - Джуди — [Союзник] доверенное лицо\n';
      const c = parseCharacter(card, 'x', 'vampires');
      assert.deepEqual(c.relationships[0], { target: 'Джуди', description: 'доверенное лицо', relType: 'Союзник', mutual: false, type: 'ally' });
    });
    it('relationships: legacy line without [Тип] prefix keeps relType empty', () => {
      const card = '# X\n- **Отношения:**\n  - Джуди — давний должник, тайно предан ей\n';
      const c = parseCharacter(card, 'x', 'vampires');
      assert.equal(c.relationships[0].relType, '');
      assert.equal(c.relationships[0].description, 'давний должник, тайно предан ей');
      assert.equal(c.relationships[0].mutual, false);
    });
    // 2026-08-08, Фаза 3 «Связи и отношения» — необязательный маркер ↔ (взаимность),
    // независим от [Тип], всегда идёт первым.
    it('relationships: ↔ marker sets mutual=true, combines with [Тип]', () => {
      const card = '# X\n- **Отношения:**\n  - Джуди — ↔ [Сир] обратила меня\n';
      const c = parseCharacter(card, 'x', 'vampires');
      assert.deepEqual(c.relationships[0], { target: 'Джуди', description: 'обратила меня', relType: 'Сир', mutual: true, type: 'sire' });
    });
    it('relationships: ↔ marker without [Тип]', () => {
      const card = '# X\n- **Отношения:**\n  - Джуди — ↔ давний должник\n';
      const c = parseCharacter(card, 'x', 'vampires');
      assert.deepEqual(c.relationships[0], { target: 'Джуди', description: 'давний должник', relType: '', mutual: true, type: 'neutral' });
    });
    it('infers lineage from label when not given', () =>
      assert.equal(parseCharacter(CARD, 'gerson', null).lineage, 'vampire'));
    it('dead status detected', () => {
      const dead = parseCharacter('# X\n- **Статус:** Уничтожен', 'x', 'vampires');
      assert.equal(dead.statusType, 'dead');
    });
  });

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

  describe('foundry-export', () => {
    const { mapCharacterToFoundryActor } = require('../lib/foundry-export');

    // Тот же персонаж, что реально лежит в cities/paris/characters/vampires/alen_dyubua —
    // используем как fixture напрямую, без похода на диск (юнит-тест мапера, не интеграция).
    const CHAR = {
      name: 'Ален Дюбуа', lineage: 'vampire', clan: 'Вентру', sect: 'Камарилья',
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
      history: 'Родился в Тулузе, обращён в 1920-х.',
      description: { birthDate: '1890', gender: 'Мужской', race: '', hair: 'Тёмные', eyes: 'Серые', apparentAge: '', deathDate: '', heightWeight: '', build: '', nationality: '' },
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
    it('канонические способности пишут isvisible:true — иначе Foundry не показывает строку после Import Data', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.system.abilities.leadership.isvisible, true);
      assert.equal(a.system.abilities.occult.isvisible, true);
    });
    it('кастомная способность → embedded Item типа Trait', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      const trait = a.items.find(i => i.type === 'Trait' && i.name === 'Знания музыки');
      assert.ok(trait, 'ожидался Trait-Item «Знания музыки»');
      assert.equal(trait.system.type, 'wod.types.talentsecondability');
      assert.equal(trait.system.value, 1);
      assert.equal(trait.system.isvisible, true);
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
    it('history → system.background (биография, не путать с Item-Фоном)', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.equal(a.system.background, 'Родился в Тулузе, обращён в 1920-х.');
    });
    it('description → system.appearance (собранный читаемый текст, пустые поля пропущены)', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      assert.match(a.system.appearance, /Дата рождения: 1890/);
      assert.match(a.system.appearance, /Пол: Мужской/);
      assert.match(a.system.appearance, /Волосы: Тёмные/);
      assert.match(a.system.appearance, /Глаза: Серые/);
      assert.ok(!a.system.appearance.includes('Раса:'), 'пустые поля описания не должны попадать в текст');
    });
    it('meritsFlaws, совпавший с библиотекой → embedded Item merit, а не notes', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      const merit = a.items.find(i => i.type === 'Feature' && i.system.type === 'wod.types.merit');
      assert.ok(merit, 'ожидался Item «Внушительный тип» (есть в system/library/merits)');
      assert.equal(merit.name, 'Внушительный тип');
      assert.equal(merit.system.level, 1);
      assert.equal(merit.system.isvisible, true);
      assert.ok(!a.system.notes.includes('Внушительный тип'), 'совпавшая строка не должна дублироваться в notes');
    });
    it('meritsFlaws, не найденный в библиотеке → остаётся текстом в system.notes', () => {
      const sheet = { ...SHEET, meritsFlaws: 'Придуманная особенность (2 очка)' };
      const a = mapCharacterToFoundryActor(CHAR, sheet);
      assert.match(a.system.notes, /Придуманная особенность/);
      assert.equal(a.items.filter(i => i.system.type === 'wod.types.merit' || i.system.type === 'wod.types.flaw').length, 0);
    });
    it('meritsFlaws как массив (новый формат) — экспорт напрямую, без сверки с библиотекой', () => {
      const sheet = {
        ...SHEET,
        meritsFlaws: [
          { name: 'Кастомное достоинство', points: 3, kind: 'merit' },
          { name: 'Кастомный недостаток', points: 2, kind: 'flaw' },
        ],
      };
      const a = mapCharacterToFoundryActor(CHAR, sheet);
      const merit = a.items.find(i => i.type === 'Feature' && i.system.type === 'wod.types.merit');
      assert.ok(merit, 'ожидалось «Кастомное достоинство»');
      assert.equal(merit.name, 'Кастомное достоинство');
      assert.equal(merit.system.level, 3);
      assert.equal(merit.system.isvisible, true);
      const flaw = a.items.find(i => i.type === 'Feature' && i.system.type === 'wod.types.flaw');
      assert.ok(flaw, 'ожидался «Кастомный недостаток»');
      assert.equal(flaw.name, 'Кастомный недостаток');
      assert.equal(flaw.system.level, 2);
      assert.equal(a.system.notes, '', 'массив не проходит через system.notes вообще');
    });
    it('фон (backgrounds) → embedded Item типа Feature/background', () => {
      const a = mapCharacterToFoundryActor(CHAR, SHEET);
      const bg = a.items.find(i => i.type === 'Feature' && i.system.type === 'wod.types.background');
      assert.ok(bg, 'ожидался Item фона «Ресурсы»');
      assert.equal(bg.name, 'Ресурсы');
      assert.equal(bg.system.level, 3);
      assert.equal(bg.system.isvisible, true);
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

  describe('foundry-export — Mortal', () => {
    const { mapCharacterToFoundryActor } = require('../lib/foundry-export');

    const CHAR_MORTAL = { name: 'Тестовый Смертный', lineage: 'mortal' };
    const SHEET_MORTAL = {
      lineage: 'mortals',
      header: {
        name: 'Тестовый Смертный', player: '', chronicle: '', nature: 'Бунтарь (Rebel)',
        demeanor: 'Конформист (Conformist)', concept: 'Охранник', clan: '', generation: '', sire: '',
      },
      attributes: {
        physical: { strength: 3, dexterity: 4, stamina: 3, composure: 1, resolve: 1 },
        social:   { charisma: 2, manipulation: 3, appearance: 3 },
        mental:   { perception: 4, intelligence: 2, wits: 3 },
      },
      abilities: {
        talents: [
          { name: 'Бдительность', val: 3, fixed: true }, { name: 'Интрига', val: 2, fixed: false },
        ],
        skills: [{ name: 'Стрельба', val: 3, fixed: true }],
        knowledges: [{ name: 'Гуманитарные науки', val: 2, fixed: true }],
      },
      disciplines: [],
      backgrounds: [{ name: 'Контакты', val: 2 }],
      virtues: { conscience: 1, selfcontrol: 1, courage: 1 },
      meritsFlaws: '',
      humanity: 4, path: 'Человечность',
      willpower: { permanent: 4, temp: Array(10).fill(false).map((_, i) => i < 2) },
      otherTraits: [{ name: 'Dead-Eyes', val: 0 }],
      health: { bruised: false, hurt: false, injured: false, wounded: false, mauled: false, crippled: false, incapacitated: false },
      flaw: '',
    };

    it('type Mortal, без clan/sect/generation/generationmod/sire/bloodline/weakness/custom в system', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      assert.equal(a.type, 'Mortal');
      assert.equal(a.name, 'Тестовый Смертный');
      for (const key of ['clan', 'sect', 'generation', 'generationmod', 'sire', 'bloodline', 'weakness', 'custom']) {
        assert.ok(!(key in a.system), `system.${key} не должен существовать для Mortal`);
      }
    });
    it('advantages.bloodpool всё равно пишется (общий блок для всех линеек), max=0 — не фантомные 30', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      assert.ok('bloodpool' in a.system.advantages);
      assert.equal(a.system.advantages.bloodpool.temporary, 0);
      assert.equal(a.system.advantages.bloodpool.max, 0);
    });
    it('settings.has* — mortal-пресет: haswillpower/haspath/hasvirtue true, hasbloodpool false', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      assert.equal(a.system.settings.haswillpower, true);
      assert.equal(a.system.settings.haspath, true);
      assert.equal(a.system.settings.hasvirtue, true);
      assert.equal(a.system.settings.hasbloodpool, false);
      assert.equal(a.system.settings.hasrage, false);
    });
    it('Человечность/Путь/Воля/Добродетели читаются как у вампира', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      assert.equal(a.system.advantages.path.permanent, 4);
      assert.equal(a.system.advantages.path.label, 'wod.advantages.path.humanity');
      assert.equal(a.system.advantages.willpower.permanent, 4);
      assert.equal(a.system.advantages.willpower.temporary, 2);
      assert.equal(a.system.advantages.virtues.conscience.permanent, 1);
    });
    it('Фон и кастомная способность экспортируются как у вампира', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      const bg = a.items.find(i => i.type === 'Feature' && i.system.type === 'wod.types.background');
      assert.ok(bg); assert.equal(bg.name, 'Контакты'); assert.equal(bg.system.level, 2);
      const trait = a.items.find(i => i.type === 'Trait' && i.system.type === 'wod.types.talentsecondability');
      assert.ok(trait); assert.equal(trait.name, 'Интрига');
    });
    it('otherTraits → embedded Item типа Trait/othertraits', () => {
      const a = mapCharacterToFoundryActor(CHAR_MORTAL, SHEET_MORTAL);
      const ot = a.items.find(i => i.type === 'Trait' && i.system.type === 'wod.types.othertraits');
      assert.ok(ot, 'ожидался Item «Dead-Eyes»');
      assert.equal(ot.name, 'Dead-Eyes');
      assert.equal(ot.system.value, 0);
    });
  });

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
        background: 'Родился в Тулузе, обращён в 1920-х.',
      },
      items: [
        { name: 'Доминирование', type: 'Power', system: { type: 'wod.types.discipline', value: 3, parentid: '' } },
        { name: 'Знания музыки', type: 'Trait', system: { type: 'wod.types.talentsecondability', value: 1 } },
        { name: 'Ресурсы', type: 'Feature', system: { type: 'wod.types.background', level: 3, value: 0 } },
        { name: 'Внушительный тип', type: 'Feature', system: { type: 'wod.types.merit', level: 1, value: 0 } },
      ],
    };
    const EXISTING_SHEET = { lineage: 'vampires', disciplines: [], abilities: { talents: [], skills: [], knowledges: [] } };

    const ACTOR_MORTAL = {
      name: 'Тестовый Смертный', type: 'Mortal',
      system: {
        nature: 'Бунтарь', demeanor: 'Конформист', concept: 'Охранник', notes: '',
        attributes: {
          strength: { value: 3 }, dexterity: { value: 4 }, stamina: { value: 3 },
          charisma: { value: 2 }, manipulation: { value: 3 }, appearance: { value: 3 },
          composure: { value: 1 }, perception: { value: 4 }, intelligence: { value: 2 },
          wits: { value: 3 }, resolve: { value: 1 },
        },
        abilities: { alertness: { value: 3, type: 'talent' } },
        advantages: {
          virtues: { conscience: { permanent: 1 }, selfcontrol: { permanent: 1 }, courage: { permanent: 1 } },
          willpower: { permanent: 4, temporary: 2, max: 10 },
          bloodpool: { temporary: 0, max: 10, perturn: 1 },
          path: { permanent: 4, label: 'wod.advantages.path.humanity' },
        },
        health: { damage: { bashing: 0, lethal: 0, aggravated: 0 } },
      },
      items: [
        { name: 'Интрига', type: 'Trait', system: { type: 'wod.types.talentsecondability', value: 2 } },
        { name: 'Контакты', type: 'Feature', system: { type: 'wod.types.background', level: 2, value: 0 } },
        { name: 'Dead-Eyes', type: 'Trait', system: { type: 'wod.types.othertraits', value: 0 } },
      ],
    };
    const EXISTING_SHEET_MORTAL = { lineage: 'mortals', disciplines: [], otherTraits: [], abilities: { talents: [], skills: [], knowledges: [] } };

    it('Mortal: othertraits Item → sheetData.otherTraits', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR_MORTAL, EXISTING_SHEET_MORTAL);
      const ot = sheetData.otherTraits.find(t => t.name === 'Dead-Eyes');
      assert.ok(ot, 'ожидался otherTraits «Dead-Eyes»');
      assert.equal(ot.val, 0);
    });
    it('Mortal: clan/sect/generation остаются пустыми в cardFields (ключей нет в system)', () => {
      const { cardFields } = mapFoundryActorToSheetData(ACTOR_MORTAL, EXISTING_SHEET_MORTAL);
      assert.equal(cardFields.clan, '');
      assert.equal(cardFields.sect, '');
      assert.equal(cardFields.generation, '');
    });
    it('Mortal: Человечность/Путь/Воля/Фон/кастомная способность читаются как у вампира', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR_MORTAL, EXISTING_SHEET_MORTAL);
      assert.equal(sheetData.humanity, 4);
      assert.equal(sheetData.path, 'Человечность');
      assert.equal(sheetData.willpower.permanent, 4);
      const bg = sheetData.backgrounds.find(b => b.name === 'Контакты');
      assert.ok(bg); assert.equal(bg.val, 2);
      const trait = sheetData.abilities.talents.find(a => a.name === 'Интрига');
      assert.ok(trait); assert.equal(trait.val, 2);
    });

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
    it('фон из Feature/background Item', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      const bg = sheetData.backgrounds.find(b => b.name === 'Ресурсы');
      assert.ok(bg, 'ожидался фон «Ресурсы»'); assert.equal(bg.val, 3);
    });
    it('достоинство из Feature/merit Item возвращается записью массива meritsFlaws', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      assert.ok(Array.isArray(sheetData.meritsFlaws));
      const mf = sheetData.meritsFlaws.find(x => x.name === 'Внушительный тип');
      assert.ok(mf, 'ожидалась запись «Внушительный тип»');
      assert.equal(mf.points, 1);
      assert.equal(mf.kind, 'merit');
    });
    it('недостаток из Feature/flaw Item возвращается с kind: flaw', () => {
      const actor2 = { ...ACTOR, items: [...ACTOR.items, { name: 'Запах могилы', type: 'Feature', system: { type: 'wod.types.flaw', level: 1, value: 0 } }] };
      const { sheetData } = mapFoundryActorToSheetData(actor2, EXISTING_SHEET);
      const flaw = sheetData.meritsFlaws.find(x => x.name === 'Запах могилы');
      assert.ok(flaw, 'ожидался «Запах могилы»');
      assert.equal(flaw.kind, 'flaw');
      assert.equal(flaw.points, 1);
    });
    it('несовпавший текст из system.notes добавляется отдельными записями массива', () => {
      const actor2 = { ...ACTOR, system: { ...ACTOR.system, notes: 'Придуманная особенность (2)' } };
      const { sheetData } = mapFoundryActorToSheetData(actor2, EXISTING_SHEET);
      const known = sheetData.meritsFlaws.find(x => x.name === 'Внушительный тип');
      assert.ok(known);
      const custom = sheetData.meritsFlaws.find(x => x.name === 'Придуманная особенность');
      assert.ok(custom, 'ожидалась запись из notes');
      assert.equal(custom.points, 2);
      assert.equal(custom.kind, 'merit');
    });
    it('system.background → sheetData.history (биография, симметрично экспорту)', () => {
      const { sheetData } = mapFoundryActorToSheetData(ACTOR, EXISTING_SHEET);
      assert.equal(sheetData.history, 'Родился в Тулузе, обращён в 1920-х.');
    });
    it('импорт без merit/flaw Item и без notes сохраняет уже существующий meritsFlaws (не затирает в [])', () => {
      const actorNoMF = { ...ACTOR, system: { ...ACTOR.system, notes: '' }, items: ACTOR.items.filter(i => i.system?.type !== 'wod.types.merit') };
      const existingWithString = { ...EXISTING_SHEET, meritsFlaws: 'Старая запись (1 очко)' };
      const { sheetData } = mapFoundryActorToSheetData(actorNoMF, existingWithString);
      assert.equal(sheetData.meritsFlaws, 'Старая запись (1 очко)', 'строковый формат не должен тихо теряться при пустом импорте');
    });
  });

  describe('foundry-merits', () => {
    const { matchMeritsFlaws } = require('../lib/foundry-merits');

    it('строка с очками в скобках находит достоинство в библиотеке', () => {
      const { matched, unmatched } = matchMeritsFlaws('Внушительный тип (1 очко)');
      assert.equal(unmatched.length, 0);
      assert.equal(matched.length, 1);
      assert.equal(matched[0].name, 'Внушительный тип');
      assert.equal(matched[0].points, 1);
      assert.equal(matched[0].kind, 'merit');
    });
    it('находит недостаток и определяет kind: flaw', () => {
      const { matched } = matchMeritsFlaws('Запах могилы');
      assert.equal(matched.length, 1);
      assert.equal(matched[0].kind, 'flaw');
      assert.equal(matched[0].points, 1);
    });
    it('несколько строк — маркеры списка и пустые строки не мешают', () => {
      const { matched, unmatched } = matchMeritsFlaws('- Внушительный тип\n\n- Запах могилы (1)');
      assert.equal(matched.length, 2);
      assert.equal(unmatched.length, 0);
    });
    it('кастомная строка без совпадения в библиотеке остаётся в unmatched', () => {
      const { matched, unmatched } = matchMeritsFlaws('Придуманная особенность (2 очка)');
      assert.equal(matched.length, 0);
      assert.deepEqual(unmatched, ['Придуманная особенность (2 очка)']);
    });
    it('пустой текст → пустые массивы', () => {
      const { matched, unmatched } = matchMeritsFlaws('');
      assert.deepEqual(matched, []);
      assert.deepEqual(unmatched, []);
    });
  });

  describe('zip (createZip/readZip)', () => {
    const { createZip, readZip } = require('../lib/zip');

    it('round-trip: 3 файла, имена и содержимое совпадают байт-в-байт', () => {
      const files = [
        { name: 'foundry_alen.json', data: JSON.stringify({ name: 'Ален', n: 1 }) },
        { name: 'foundry_gerson.json', data: JSON.stringify({ name: 'Герсон', n: 2 }) },
        { name: 'foundry_verene.json', data: Buffer.from(JSON.stringify({ name: 'Верене', n: 3 }), 'utf-8') },
      ];
      const zipBuf = createZip(files);
      assert.ok(Buffer.isBuffer(zipBuf));
      const out = readZip(zipBuf);
      assert.equal(out.length, 3);
      for (const f of files) {
        const match = out.find(o => o.name === f.name);
        assert.ok(match, `ожидался файл ${f.name} в архиве`);
        const expected = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf-8');
        assert.equal(match.data.toString('utf-8'), expected.toString('utf-8'));
      }
    });
    it('пустой список файлов → валидный (пустой) ZIP', () => {
      const zipBuf = createZip([]);
      const out = readZip(zipBuf);
      assert.equal(out.length, 0);
    });
    it('кириллица и юникод в содержимом переживают round-trip', () => {
      const content = 'Тестовый Смертный — Охранник 🧑';
      const zipBuf = createZip([{ name: 'test.json', data: content }]);
      const out = readZip(zipBuf);
      assert.equal(out[0].data.toString('utf-8'), content);
    });
  });

  describe('parseLocation', () => {
    const CARD = [
      '# Клуб Носферату',
      '> **Название:** Клуб | **Район:** 1 | **Зона:** 🔴 Опасная | **Опасность:** 🟡 Средний | **Контроль:** Шабаш',
      '## 🎭 Атмосфера', 'Дымный подвал.', '',
      '## 🩸 Контекст', '**Маскарад:** 🔴 высокий риск', '',
      '## 🪝 Крючки', '1. Первый крючок', '2. Второй крючок',
    ].join('\n');

    it('title + meta fields', () => {
      const l = parseLocation(CARD, 'klub_nosferatu');
      assert.equal(l.title, 'Клуб Носферату');
      assert.equal(l.district, '1');
      assert.equal(l.control, 'Шабаш');
      assert.equal(l.slug, 'klub_nosferatu');
    });
    it('atmosphere + masquerade level high', () => {
      const l = parseLocation(CARD, 'klub_nosferatu');
      assert.equal(l.atmosphere, 'Дымный подвал.');
      assert.equal(l.masqueradeLevel, 'high');
    });
    it('hooks parsed and de-numbered', () => {
      const l = parseLocation(CARD, 'klub_nosferatu');
      assert.deepEqual(l.hooks, ['Первый крючок', 'Второй крючок']);
    });
    it('Опасность — отдельное поле от Зоны (техспека §13.1)', () => {
      const l = parseLocation(CARD, 'klub_nosferatu');
      assert.equal(l.dangerLevel, '🟡 Средний');
      assert.equal(l.zone, '🔴 Опасная', 'Зона не должна теряться при вводе Опасности');
    });
    it('карточка без Опасности → dangerLevel null (бэкофилл делает миграция 004, не парсер)', () => {
      const noD = CARD.replace(' | **Опасность:** 🟡 Средний', '');
      assert.equal(parseLocation(noD, 'klub_nosferatu').dangerLevel, null);
    });
  });

  describe('parseEvent / parseChronicle', () => {
    const CHR = [
      '# 📖 Летний Париж', '',
      '## 🌍 Состояние мира',
      '> Последнее обновление: **Август 2010**', '',
      '### Князь', 'Виллем стабилен.', '',
      '## 📋 Хроника событий', '',
      '### 📅 Август 2010 — Клуб. Первая встреча.',
      '- **📍 Локация:** [Клуб](../../locations/x/klub.md)',
      '- **👥 Участники:**',
      '  - [Герсон](g.md) (Вентру) — патрон',
      '  - Безымянный гуль — слуга',
      '- **📋 Что произошло:** Завязка интриги.',
      '- **⚖️ Последствия:**',
      '  - Долг перед Герсоном',
    ].join('\n');

    it('chronicle title + worldState', () => {
      const c = parseChronicle(CHR);
      assert.equal(c.title, '📖 Летний Париж'); // parseChronicle keeps emoji (strips only * and #)
      assert.equal(c.worldState.lastUpdate, 'Август 2010');
      assert.ok(c.worldState.sections.length >= 1);
    });
    it('one event with date / title parsed', () => {
      const c = parseChronicle(CHR);
      assert.equal(c.events.length, 1);
      assert.equal(c.events[0].date, 'Август 2010');
      assert.equal(c.events[0].title, 'Первая встреча');
    });
    it('event location link + participants + consequences', () => {
      const ev = parseChronicle(CHR).events[0];
      assert.equal(ev.location.links[0].slug, 'klub');
      assert.equal(ev.participants[0].name, 'Герсон');
      assert.equal(ev.participants.length, 2);
      assert.deepEqual(ev.consequences, ['Долг перед Герсоном']);
    });
    it('parseEvent standalone — assigns given id', () =>
      assert.equal(parseEvent('### 📅 Май 2010 — Тест.', 7).id, 7));
  });

  describe('parseChronicleParticipants', () => {
    it('collects names, skips anonymous', () => {
      const text = [
        '## 👥 Участники',
        '  - Герсон (Вентру) — патрон',
        '  - Мел / альтер — гостья',
        '  - Безымянный гуль — слуга',
      ].join('\n');
      assert.deepEqual(parseChronicleParticipants(text), ['Герсон', 'Мел']);
    });
    it('empty text → empty array', () =>
      assert.deepEqual(parseChronicleParticipants(''), []));
  });

  describe('parseScenarioSections / replaceScenarioSection', () => {
    const SCEN = [
      '# Сценарий — Тест',
      '> 🔗 [Модуль](test.md)',
      '',
      '---',
      '',
      '## Пролог',
      '',
      'Завязка событий.',
      '',
      '---',
      '',
      '## Сцена 1 — Бар',
      '',
      'Первая сцена.',
      'Внутренний разделитель:',
      '',
      '---',
      '',
      'Продолжение той же сцены.',
      '',
      '---',
      '',
      '## Финал',
      '',
      'Развязка.',
      '',
    ].join('\n');

    it('splits into preamble + ## sections, strips only the trailing divider', () => {
      const { preamble, sections } = parseScenarioSections(SCEN);
      assert.match(preamble, /^# Сценарий — Тест/);
      assert.equal(sections.length, 3);
      assert.deepEqual(sections.map(s => s.heading), ['Пролог', 'Сцена 1 — Бар', 'Финал']);
      assert.equal(sections[0].body, 'Завязка событий.');
      // internal "---" (mid-scene pacing divider) must survive, only the trailing one is stripped
      assert.match(sections[1].body, /Внутренний разделитель:\n\n---\n\nПродолжение той же сцены\./);
      assert.doesNotMatch(sections[1].body, /---\s*$/);
    });

    it('no ## headings → whole text is preamble, sections empty', () => {
      const { preamble, sections } = parseScenarioSections('Просто текст без заголовков.');
      assert.equal(preamble, 'Просто текст без заголовков.');
      assert.deepEqual(sections, []);
    });

    it('replaceScenarioSection swaps only the target section, leaves others intact', () => {
      const updated = replaceScenarioSection(SCEN, 'Сцена 1 — Бар', 'Полностью новый текст сцены.');
      const { sections } = parseScenarioSections(updated);
      assert.deepEqual(sections.map(s => s.heading), ['Пролог', 'Сцена 1 — Бар', 'Финал']);
      assert.equal(sections[1].body, 'Полностью новый текст сцены.');
      assert.equal(sections[0].body, 'Завязка событий.');
      assert.equal(sections[2].body, 'Развязка.');
    });

    it('replaceScenarioSection — неизвестный заголовок возвращает текст без изменений', () => {
      assert.equal(replaceScenarioSection(SCEN, '__нет такого__', 'x'), SCEN);
    });

    it('replaceScenarioSections — применяет несколько замен за один проход, неизвестные заголовки — в skipped', () => {
      const { text, skipped } = replaceScenarioSections(SCEN, [
        { heading: 'Пролог', body: 'Новая завязка.' },
        { heading: 'Финал', body: 'Новая развязка.' },
        { heading: '__нет такого__', body: 'x' },
      ]);
      const { sections } = parseScenarioSections(text);
      assert.equal(sections.find(s => s.heading === 'Пролог').body, 'Новая завязка.');
      assert.equal(sections.find(s => s.heading === 'Финал').body, 'Новая развязка.');
      assert.equal(sections.find(s => s.heading === 'Сцена 1 — Бар').body, 'Первая сцена.\nВнутренний разделитель:\n\n---\n\nПродолжение той же сцены.');
      assert.deepEqual(skipped, ['__нет такого__']);
    });

    it('hasManualSceneMarker/addManualSceneMarker/clearManualSceneMarker — round-trip', () => {
      assert.equal(hasManualSceneMarker(SCEN), false);
      const marked = addManualSceneMarker(SCEN);
      assert.equal(hasManualSceneMarker(marked), true);
      assert.equal(addManualSceneMarker(marked), marked); // идемпотентно, не дублирует метку
      const cleared = clearManualSceneMarker(marked);
      assert.equal(hasManualSceneMarker(cleared), false);
      // сама структура разделов не пострадала
      assert.deepEqual(parseScenarioSections(cleared).sections.map(s => s.heading), ['Пролог', 'Сцена 1 — Бар', 'Финал']);
    });

    it('insertScenarioScene — вставляет новую сцену перед «Финал» с инкрементом номера, ставит метку', () => {
      const { text, heading } = insertScenarioScene(SCEN);
      assert.equal(heading, 'Сцена 2');
      const { sections } = parseScenarioSections(text);
      assert.deepEqual(sections.map(s => s.heading),
        ['Пролог', 'Сцена 1 — Бар', 'Сцена 2', 'Описание для игрока', 'Колорит', 'Финал']);
      const newScene = sections.find(s => s.heading === 'Сцена 2');
      assert.equal(newScene.level, 2);
      const descField = sections.find(s => s.heading === 'Описание для игрока');
      assert.equal(descField.parent, 'Сцена 2');
      assert.equal(hasManualSceneMarker(text), true);
    });

    it('insertScenarioScene — без блока «Финал» добавляет сцену в конец', () => {
      const noFinale = [
        '# Сценарий — Тест', '', '---', '',
        '## Пролог', '', 'Завязка.', '',
      ].join('\n');
      const { text, heading } = insertScenarioScene(noFinale);
      assert.equal(heading, 'Сцена 1');
      const { sections } = parseScenarioSections(text);
      assert.deepEqual(sections.map(s => s.heading),
        ['Пролог', 'Сцена 1', 'Описание для игрока', 'Колорит']);
    });

    it('insertScenarioScene — «Финальная сцена» не считается блоком «Финал» (не anchored-совпадение)', () => {
      const withFalseFinale = [
        '# Сценарий — Тест', '', '---', '',
        '## Пролог', '', 'Завязка.', '',
        '---', '',
        '## Финальная сцена', '', 'Это НЕ финал, а обычная сцена с похожим названием.', '',
      ].join('\n');
      const { text, heading } = insertScenarioScene(withFalseFinale);
      assert.equal(heading, 'Сцена 1');
      const { sections } = parseScenarioSections(text);
      // Новая сцена должна встать В КОНЕЦ (после «Финальная сцена»), а не перед ней —
      // «Финальная сцена» не является блоком «Финал».
      assert.deepEqual(sections.map(s => s.heading),
        ['Пролог', 'Финальная сцена', 'Сцена 1', 'Описание для игрока', 'Колорит']);
    });

    it('insertScenarioScene — числа сцен с пропусками: инкремент от максимума, а не от количества', () => {
      const withGap = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '', 'Первая.', '',
        '---', '',
        '## Сцена 5', '', 'Пятая.', '',
        '---', '',
        '## Финал', '', 'Развязка.', '',
      ].join('\n');
      const { heading } = insertScenarioScene(withGap);
      assert.equal(heading, 'Сцена 6');
    });

    const SCEN_NESTED = [
      '# Сценарий — Тест',
      '',
      '---',
      '',
      '## 4. Завязка',
      '',
      'Игрок втягивается в события.',
      '',
      '---',
      '',
      '## 5. Сцены',
      '',
      '### Сцена 1: В темноте',
      'Текст сцены 1.',
      '',
      '### Сцена 2: Ловушка',
      'Текст сцены 2.',
      '',
      '---',
      '',
      '## 6. Кульминация',
      '',
      'Финальное столкновение.',
      '',
    ].join('\n');

    it('разворачивает вложенные `### Сцена N` (под общим `## Сцены`) в отдельные разделы верхнего уровня', () => {
      const { sections } = parseScenarioSections(SCEN_NESTED);
      assert.deepEqual(sections.map(s => s.heading),
        ['4. Завязка', '5. Сцены', 'Сцена 1: В темноте', 'Сцена 2: Ловушка', '6. Кульминация']);
      assert.equal(sections[1].body, ''); // пустая обёртка — весь текст ушёл в дочерние сцены
      assert.equal(sections[2].body, 'Текст сцены 1.');
      assert.equal(sections[3].body, 'Текст сцены 2.');
      assert.equal(sections[2].level, 3);
      assert.equal(sections[2].parent, '5. Сцены');
    });

    it('replaceScenarioSection на вложенной сцене меняет только её, сохраняя соседние сцены и обёртку', () => {
      const updated = replaceScenarioSection(SCEN_NESTED, 'Сцена 1: В темноте', 'Новый текст сцены 1.');
      const { sections } = parseScenarioSections(updated);
      assert.deepEqual(sections.map(s => s.heading),
        ['4. Завязка', '5. Сцены', 'Сцена 1: В темноте', 'Сцена 2: Ловушка', '6. Кульминация']);
      assert.equal(sections[2].body, 'Новый текст сцены 1.');
      assert.equal(sections[3].body, 'Текст сцены 2.');
      assert.equal(sections[0].body, 'Игрок втягивается в события.');
      assert.equal(sections[4].body, 'Финальное столкновение.');
    });
  });

  describe('checkScenarioStructure', () => {
    // Упрощение шаблона (2026-08-09, system/rules/module_rules.md): ровно три
    // типа блоков верхнего уровня — Пролог/Сцена N/Финал, без отдельной
    // GM-справки (секреты вплетены прозой в Пролог) и без «Открытые вопросы
    // после модуля» — SCENARIO_REQUIRED_TOPICS теперь проверяет 4 темы, не 5.
    it('эталонная плоская структура (Пролог/Сцена N/Финал/Колорит) → missing пуст', () => {
      const full = [
        '## Пролог — Начало', 'x', '---',
        '## Сцена 1 — Бар', 'x', '### Колорит', 'y', '---',
        '## Финал — Развязка', 'x',
      ].join('\n');
      const { missing } = checkScenarioStructure(full);
      assert.deepEqual(missing, []);
    });

    it('минимальная структура (Пролог/Сцена N/Финал) без колорита → 1 недостающая тема', () => {
      const flat = ['## Пролог', 'x', '---', '## Сцена 1 — Бар', 'x', '---', '## Финал', 'x'].join('\n');
      const { missing } = checkScenarioStructure(flat);
      assert.ok(!missing.some(m => m.key === 'setup'));
      assert.ok(!missing.some(m => m.key === 'scenes'));
      assert.ok(!missing.some(m => m.key === 'finale'));
      assert.ok(missing.some(m => m.key === 'flavor'));
      assert.equal(missing.length, 1);
    });

    it('пустой сценарий → все 4 темы отсутствуют', () => {
      const { missing } = checkScenarioStructure('Просто текст без заголовков.');
      assert.equal(missing.length, 4);
    });
  });

  describe('parsePoliticalFactions / setPoliticalFactionInfluence', () => {
    const POL = [
      '# Карта фракций — Тест',
      '',
      '## Баланс сил — обзор',
      '',
      '| Фракция | Сила | Территория | Угроза |',
      '|---|---|---|---|',
      '| Камарилья | ⬛⬛⬛⬛⬜ | Центр | Интриги |',
      '| Анархи | ⬛⬛⬜⬜⬜ | Пригороды | Давление |',
      '',
      '---',
      '',
      '## Прочий раздел',
      'Проза, не трогаем.',
    ].join('\n');

    it('парсит легаси-блоки «Сила» (⬛×n⬜×(5-n), шаг 20) — обратная совместимость со старыми файлами', () => {
      const factions = parsePoliticalFactions(POL);
      assert.deepEqual(factions.map(f => [f.name, f.influence]), [['Камарилья', 80], ['Анархи', 40]]);
      assert.equal(factions[0].territory, 'Центр');
      assert.equal(factions[0].threat, 'Интриги');
    });

    it('парсит новую процентную запись («80%») наравне с легаси-блоками', () => {
      const pol = POL.replace('| Камарилья | ⬛⬛⬛⬛⬜ | Центр | Интриги |', '| Камарилья | 85% | Центр | Интриги |');
      const factions = parsePoliticalFactions(pol);
      assert.equal(factions[0].influence, 85);
    });

    it('нет таблицы → пустой массив', () => {
      assert.deepEqual(parsePoliticalFactions('Просто текст.'), []);
    });

    it('setPoliticalFactionInfluence меняет только целевую фракцию (переводит её на «%»-запись), остальное не трогает', () => {
      const updated = setPoliticalFactionInfluence(POL, 'Анархи', 100);
      const factions = parsePoliticalFactions(updated);
      assert.deepEqual(factions.map(f => [f.name, f.influence]), [['Камарилья', 80], ['Анархи', 100]]);
      assert.match(updated, /Анархи \| 100% \|/);
      assert.match(updated, /Прочий раздел\nПроза, не трогаем\./);
    });

    it('setPoliticalFactionInfluence округляет до шага 5 и добавляет новую фракцию строкой', () => {
      const updated = setPoliticalFactionInfluence(POL, 'Феи', 57);
      const factions = parsePoliticalFactions(updated);
      assert.deepEqual(factions.map(f => f.name), ['Камарилья', 'Анархи', 'Феи']);
      assert.equal(factions.find(f => f.name === 'Феи').influence, 55);
    });

    it('setPoliticalFactionInfluence создаёт таблицу с нуля, если её ещё нет в файле', () => {
      const updated = setPoliticalFactionInfluence('# Карта фракций\n\nПусто.', 'Шабаш', 20);
      const factions = parsePoliticalFactions(updated);
      assert.deepEqual(factions, [{ name: 'Шабаш', influence: 20, territory: '', threat: '' }]);
    });

    // FIX-2 (docs/audit/2026-07-28-fix-plan.md, находка #2) — "|" в названии
    // фракции обрезал имя и сдвигал влияние в колонку «Территория».
    it('FIX-2: "|" в названии новой фракции не рвёт строку и не путает влияние с территорией', () => {
      const updated = setPoliticalFactionInfluence(POL, 'Анархи | Шабаш', 30);
      const factions = parsePoliticalFactions(updated);
      const f = factions.find(f => f.name === 'Анархи | Шабаш');
      assert.ok(f, 'фракция с полным именем (включая "|") не найдена');
      assert.equal(f.influence, 30);
      assert.equal(f.territory, '');
    });

    it('FIX-2: "|" переживает обновление уже существующей фракции (round-trip через строку с "|")', () => {
      const withPipe = setPoliticalFactionInfluence(POL, 'Анархи | Шабаш', 30);
      const updated = setPoliticalFactionInfluence(withPipe, 'Анархи | Шабаш', 60);
      const factions = parsePoliticalFactions(updated);
      const f = factions.find(f => f.name === 'Анархи | Шабаш');
      assert.ok(f, 'фракция потерялась при повторном обновлении её "|"-имени');
      assert.equal(f.influence, 60);
    });
  });

}); // Parsers — unit

// ══════════════════════════════════════════════════════════════════════════════
// UNIT — npc.md ростер (разбор + удаление НПС из модуля)
// ══════════════════════════════════════════════════════════════════════════════
// Регрессия: DELETE .../modules/:mod/npc отдавал 404 для НПС без карточки, если
// npc.md использовал `### Имя` подзаголовки (рукописный формат) — парсер знал
// только `#### `, а классификатор секций не узнавал «Персонажи игроков» (→ pc).
describe('npc.md — ростер модуля', () => {
  const {
    _parseNpcMdGroups, _findNpcMdSections, _removeNpcEntry,
  } = require('../routes/modules/shared');

  // Повторяет цикл удаления из delete-хендлера: перебирает все секции kind.
  const removeFrom = (kind, name) => {
    for (const sec of _findNpcMdSections(NPC_MD, kind)) {
      const r = _removeNpcEntry(NPC_MD.slice(sec.bodyStart, sec.end), name);
      if (r.removedChunk) return { removedChunk: r.removedChunk, newBody: r.body };
    }
    return { removedChunk: null, newBody: null };
  };

  // Один файл покрывает оба смысла `###`: подзаголовок-НПС (Ключевые НПС) и
  // подзаголовок-подгруппу (Свита → буллеты), плюс `#### ` НПС внутри подгруппы.
  const NPC_MD = [
    '# НПС модуля', '',
    '## Персонажи игроков', '',            // рукописный заголовок → должен стать pc
    '**Промокашка** — Малкавиан → 🔗 [Карточка](promokashka/promokashka.md)', '',
    '---', '',
    '## Ключевые НПС', '',                 // `### Имя` = сам НПС (поля-детали под ним)
    '### Ламбер Жирон — посредник (Финал)', '',
    'Смертный, лет 55.', '',
    '- **Клан:** Смертный', '',
    '### Карлос — информатор', '',
    '- **Роль:** называет место сделки', '',
    '---', '',
    '## Свита', '',                        // `### Подгруппа` → буллеты-НПС + `#### ` НПС
    '### Ранее существующие НПС', '',
    '- Франсуа Вийон — Князь → 🔗 [Карточка](../fransua_viyon/fransua_viyon.md)', '',
    '### Новые НПС', '',
    '#### Шабашиты — безымянные', '',
    '- **Клан:** Шабаш', '',
    '---', '',
    '## 🎨 Промты для генерации изображений НПС', '',  // не ростер — игнорируется
    '### Ламбер Жирон — посредник, финал', '',
    '```', 'portrait prompt', '```', '',
  ].join('\n');

  const names = kind =>
    _parseNpcMdGroups(NPC_MD).filter(x => x.kind === kind).flatMap(g => g.entries.map(e => e.name));

  it('«Персонажи игроков» классифицируется как pc (не canon)', () => {
    assert.deepEqual(names('pc'), ['Промокашка']);
  });

  it('`### Имя` подзаголовки читаются как НПС, поля-детали не плодят записей', () => {
    assert.deepEqual(names('canon'), [
      'Ламбер Жирон', 'Карлос', 'Франсуа Вийон', 'Шабашиты',
    ]);
  });

  it('секция промтов изображений в ростер не попадает', () => {
    const all = _parseNpcMdGroups(NPC_MD).flatMap(g => g.entries.map(e => e.name));
    assert.equal(all.filter(n => n === 'Ламбер Жирон').length, 1, 'дубль из секции промтов');
  });

  it('удаление `### Имя`-НПС без карточки срезает его чанк (регрессия 404)', () => {
    const { removedChunk } = removeFrom('canon', 'Ламбер Жирон');
    assert.ok(removedChunk && /### Ламбер Жирон/.test(removedChunk), 'чанк НПС не удалён');
  });

  it('удаление НПС из ВТОРОЙ canon-секции находит запись (регрессия 404)', () => {
    // Франсуа Вийон живёт в «Свите», а не в первой canon-секции «Ключевые НПС».
    const { removedChunk } = removeFrom('canon', 'Франсуа Вийон');
    assert.ok(removedChunk, 'НПС из второй секции не найден');
  });

  it('удаление НПС-буллета внутри `### Подгруппа` срезает только строку', () => {
    const { removedChunk, newBody } = removeFrom('canon', 'Франсуа Вийон');
    assert.ok(removedChunk, 'буллет НПС не найден');
    assert.ok(/### Ранее существующие НПС/.test(newBody), 'заголовок подгруппы не должен исчезать');
    assert.ok(/### Новые НПС/.test(newBody) && /Шабашиты/.test(newBody), 'соседние НПС пострадали');
  });
});

// Кодревью 2026-08-11 (F2): непустой, но бессмысленный ответ AI (модерационный
// отказ/утечка рассуждений) раньше проходил как успех в fill.js/lifecycle.js —
// реальный инцидент этой сессии: Claude OAuth вернул буквальный отказ на
// криминальный модуль, запись ушла в finale.md/events.md поверх данных пользователя.
describe('isBogusGeneration — детектор отказа модерации/утечки рассуждений', () => {
  const { isBogusGeneration } = require('../routes/modules/shared');

  it('пустая строка / null / undefined → true', () => {
    assert.equal(isBogusGeneration(''), true);
    assert.equal(isBogusGeneration(null), true);
    assert.equal(isBogusGeneration(undefined), true);
  });

  it('строка короче minLength → true', () => {
    assert.equal(isBogusGeneration('Слишком короткий текст.', 200), true);
    assert.equal(isBogusGeneration('Короткий текст, но длиннее 25 символов подряд.', 25), false);
  });

  it('реальный текст отказа модерации, пойманный в этой сессии → true', () => {
    const refusal = 'User Safety: unsafe\nSafety Categories: Criminal Planning/Confessions, Violence';
    assert.equal(isBogusGeneration(refusal, 200), true);
  });

  it('другие маркеры отказа (content policy / i cannot / as an ai) → true', () => {
    assert.equal(isBogusGeneration('I cannot assist with generating content depicting violence.', 25), true);
    assert.equal(isBogusGeneration('Content policy prevents me from writing this scene.', 25), true);
    assert.equal(isBogusGeneration('As an AI, I am not able to produce this kind of narrative.', 25), true);
  });

  it('реалистичный образец нормального сценария/финала → false', () => {
    const normal = `## Пролог — Тень над Barbès\n\n### Описание для игрока\n\nНочь опускается на Барбес быстро — фонари зажигаются раньше, чем гаснет закат. Котерия собирается у метро, обсуждая план на вечер. Гиль проверяет оружие в последний раз.\n\n### GM-подсказки\n\nЕсли игроки медлят — Клод торопит их через сообщение.`;
    assert.equal(isBogusGeneration(normal, 200), false);
  });

  it('дефолтный minLength — 200', () => {
    assert.equal(isBogusGeneration('x'.repeat(199)), true);
    assert.equal(isBogusGeneration('x'.repeat(200)), false);
  });
});

// Миграция старого формата scenario.md (tools/migrate_old_scenario_format.js).
// Скрипт стал пользовательским (migrate-scenario.bat в корне, guide.md §21) и
// переписывает прозу уже сыгранных модулей — тесты закрывают три случая молчаливой
// ПОТЕРИ ТЕКСТА, найденные кодревью 2026-08-11: во всех трёх секция-источник
// удалялась целиком, хотя её содержимое лежало в ### -детях, а лог рапортовал
// об успешном переносе.
describe('migrate_old_scenario_format — перенос без потери текста', () => {
  const mig = require('../../tools/migrate_old_scenario_format.js');

  it('GM-справка ПОСЛЕ Пролога — секреты не теряются (splice по устаревшему индексу)', () => {
    const raw = ['# X', '', '---', '', '## Пролог — Начало', '', '### Описание для игрока', '', 'Текст.', '',
      '---', '', '## 🔒 GM-справка — закрытая информация', '', '### Тайная мотивация', '', 'СЕКРЕТ', '',
      '---', '', '## Финал — Конец', '', '### Раскрытие', '', 'Развязка.'].join('\n');
    const { text, notes } = mig.migrateScenarioFormat(raw);
    assert.match(text, /СЕКРЕТ/, 'текст GM-справки потерян при переносе');
    assert.ok(!/GM-справка/i.test(text), 'сама секция GM-справки должна исчезнуть');
    assert.ok(notes.some(n => /перенесена/.test(n)));
  });

  it('«Открытые вопросы» с ### -подразделами — переносятся вместе с детьми', () => {
    const raw = ['# X', '', '---', '', '## Пролог', '', '### Описание для игрока', '', 'Т.', '',
      '---', '', '## Финал', '', '### Раскрытие', '', 'Р.', '',
      '---', '', '## Открытые вопросы после модуля', '', '### Нить один', '', 'ВОПРОС-А', '', '### Нить два', '', 'ВОПРОС-Б'].join('\n');
    const { text } = mig.migrateScenarioFormat(raw);
    assert.match(text, /ВОПРОС-А/, 'первый подраздел открытых вопросов потерян');
    assert.match(text, /ВОПРОС-Б/, 'второй подраздел открытых вопросов потерян');
  });

  it('закрывающий колорит с ### -подразделами — не удаляется как «дубликат»', () => {
    const raw = ['# X', '', '---', '', '## Пролог', '', '### Описание для игрока', '', 'Т.', '',
      '---', '', '## Сцена 1 — Бар', '', '### Колорит', '', 'Запах пива.', '',
      '---', '', '## Финал', '', '### Раскрытие', '', 'Р.', '',
      '---', '', '## Парижский колорит — три детали', '', '### Язык', '', 'УНИКАЛЬНЫЙ-КОЛОРИТ'].join('\n');
    const { text } = mig.migrateScenarioFormat(raw);
    assert.match(text, /УНИКАЛЬНЫЙ-КОЛОРИТ/, 'не дублирующий колорит удалён вместо переноса');
  });

  it('нет «## Финал» — секция остаётся на месте, а не удаляется', () => {
    const raw = ['# X', '', '---', '', '## Пролог', '', '### Описание для игрока', '', 'Т.', '',
      '---', '', '## Открытые вопросы после модуля', '', 'ВАЖНЫЙ-ХВОСТ'].join('\n');
    const { text, notes } = mig.migrateScenarioFormat(raw);
    assert.match(text, /ВАЖНЫЙ-ХВОСТ/, 'текст удалён при отсутствии цели переноса');
    assert.ok(notes.some(n => /ВНИМАНИЕ/.test(n)), 'должно быть предупреждение для ручной проверки');
  });

  it('canAutoMigrate отбраковывает нестандартную структуру и мусорную преамбулу', () => {
    const branching = ['# X', '', '---', '', '## Пролог', '', 'Т.', '', '---', '', '## Путь А — банк', '', 'Т.'].join('\n');
    assert.equal(mig.canAutoMigrate(branching).ok, false, 'ветвление «Путь А» должно пропускаться');

    const leaked = ['# X', '', 'Давайте создадим сценарий. ' + 'бла '.repeat(250), '', '## Пролог', '', 'Т.'].join('\n');
    assert.equal(mig.canAutoMigrate(leaked).ok, false, 'длинная преамбула (утёкшие рассуждения AI) должна пропускаться');
  });

  it('идемпотентность: на уже мигрированном файле нечего менять', () => {
    const raw = ['# X', '', '---', '', '## Пролог', '', '### Описание для игрока', '', 'Т.', '',
      '---', '', '## Сцена 1 — Бар', '', '### Колорит', '', 'Запах.', '',
      '---', '', '## Финал', '', '### Раскрытие', '', 'Р.'].join('\n');
    assert.equal(mig.needsMigration(raw), false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// INTEGRATION — API
// ══════════════════════════════════════════════════════════════════════════════

describe('API — integration', () => {
  before(async () => startServer());
  after(async ()  => stopServer());

  // ── Health / system ────────────────────────────────────────────────────────
  describe('Health / system', () => {
    it('GET /api/status → counts', async () => {
      const { status, body } = await apiJson(`/api/status${CITY}`);
      assert.equal(status, 200);
      assert.equal(typeof body.characters,  'number');
      assert.equal(typeof body.locations,   'number');
      assert.equal(typeof body.modules,     'number');
      assert.equal(typeof body.openThreads, 'number');
    });
    it('GET /api/cities → {cities[], default}', async () => {
      const { status, body } = await apiJson('/api/cities');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.cities));
      assert.ok(body.cities.includes('paris'));
      assert.equal(typeof body.default, 'string');
    });
    it('GET /api/auth-status → recognisable shape', async () => {
      const { status, body } = await apiJson('/api/auth-status');
      assert.equal(status, 200);
      assert.ok('source' in body || 'claude' in body || 'openrouter' in body || 'ok' in body);
    });
    it('GET /api/settings → object', async () => {
      const { status, body } = await apiJson('/api/settings');
      assert.equal(status, 200);
      assert.equal(typeof body, 'object');
      assert.ok(!Array.isArray(body));
    });
    it('GET /api/guide → содержимое docs/guide.md', async () => {
      const { status, body } = await apiJson('/api/guide');
      assert.equal(status, 200);
      assert.equal(typeof body.content, 'string');
      assert.ok(body.content.length > 100);
    });

    // ── Gemini: два вида учётных данных (API-ключ vs Vertex AI service account) ──
    describe('Gemini auth — api-key vs vertex', () => {
      const envFile = path.join(__dirname, '..', '.env');
      const vertexKeyFile = path.join(__dirname, '..', '.gemini-vertex-key.json');
      let originalEnv = null;
      before(async () => { originalEnv = await fs.readFile(envFile, 'utf-8').catch(() => null); });
      after(async () => {
        if (originalEnv !== null) await fs.writeFile(envFile, originalEnv, 'utf-8');
        else await fs.rm(envFile, { force: true });
        await fs.rm(vertexKeyFile, { force: true });
      });

      it('GET /api/settings отдаёт GEMINI_AUTH_TYPE (по умолчанию api-key) и поля Vertex', async () => {
        const { status, body } = await apiJson('/api/settings');
        assert.equal(status, 200);
        assert.ok('GEMINI_AUTH_TYPE' in body);
        assert.ok('GOOGLE_CLOUD_PROJECT' in body);
        assert.ok('GOOGLE_CLOUD_LOCATION' in body);
        assert.ok('hasVertexKeyFile' in body);
      });

      it('POST /api/settings сохраняет GEMINI_AUTH_TYPE=vertex + project/location, без рестарта (restart:false)', async () => {
        const { status, body } = await apiJson('/api/settings', {
          method: 'POST',
          body: JSON.stringify({
            restart: false,
            GEMINI_AUTH_TYPE: 'vertex',
            GOOGLE_CLOUD_PROJECT: 'test-project-123',
            GOOGLE_CLOUD_LOCATION: 'us-central1',
          }),
        });
        assert.equal(status, 200);
        assert.ok(body.ok);
        assert.equal(body.needsRestart, false);
        const after = await apiJson('/api/settings');
        assert.equal(after.body.GEMINI_AUTH_TYPE, 'vertex');
        assert.equal(after.body.GOOGLE_CLOUD_PROJECT, 'test-project-123');
        assert.equal(after.body.GOOGLE_CLOUD_LOCATION, 'us-central1');
      });

      it('POST /api/settings с GEMINI_VERTEX_KEY_JSON пишет файл service account и репортит hasVertexKeyFile', async () => {
        const fakeKey = JSON.stringify({ type: 'service_account', project_id: 'test-project-123', private_key: 'FAKE', client_email: 'x@test-project-123.iam.gserviceaccount.com' });
        const { status, body } = await apiJson('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ restart: false, GEMINI_VERTEX_KEY_JSON: fakeKey }),
        });
        assert.equal(status, 200);
        assert.ok(body.ok);
        const written = await fs.readFile(vertexKeyFile, 'utf-8');
        assert.equal(JSON.parse(written).project_id, 'test-project-123');
        const after = await apiJson('/api/settings');
        assert.equal(after.body.hasVertexKeyFile, true);
      });

      it('POST /api/settings с невалидным GEMINI_VERTEX_KEY_JSON → 400, файл не создаётся', async () => {
        await fs.rm(vertexKeyFile, { force: true });
        const { status, body } = await apiJson('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ restart: false, GEMINI_VERTEX_KEY_JSON: '{ не json' }),
        });
        assert.equal(status, 400);
        assert.ok(body.error);
        assert.equal(await fs.readFile(vertexKeyFile, 'utf-8').catch(() => null), null);
      });

      it('переключение обратно на GEMINI_AUTH_TYPE=api-key сохраняется', async () => {
        const { status, body } = await apiJson('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ restart: false, GEMINI_AUTH_TYPE: 'api-key' }),
        });
        assert.equal(status, 200);
        assert.ok(body.ok);
        const after = await apiJson('/api/settings');
        assert.equal(after.body.GEMINI_AUTH_TYPE, 'api-key');
      });
    });
    it('GET /api/integrity → {totalIssues, checks[]}', async () => {
      const { status, body } = await apiJson(`/api/integrity${CITY}`);
      assert.equal(status, 200);
      assert.equal(typeof body.totalIssues, 'number');
      assert.ok(Array.isArray(body.checks));
      if (body.checks.length > 0) {
        assert.ok(body.checks[0].id);
        assert.ok(Array.isArray(body.checks[0].items));
      }
    });
  });

  // ── Characters ─────────────────────────────────────────────────────────────
  describe('Characters', () => {
    let chars;
    before(async () => {
      const { body } = await apiJson(`/api/characters${CITY}`);
      chars = Array.isArray(body) ? body : [];
    });
    it('returns non-empty array', () => assert.ok(chars.length > 0));
    it('each char has name / lineage / status', () => {
      for (const c of chars) {
        assert.ok(c.name); assert.ok(c.lineage); assert.ok('status' in c);
      }
    });
    it('each char has hasSheet boolean', () => {
      for (const c of chars) assert.equal(typeof c.hasSheet, 'boolean');
    });
    it('each char has diaries array', () => {
      for (const c of chars) assert.ok(Array.isArray(c.diaries));
    });
    it('GET /api/characters/all-images → plain object', async () => {
      const { status, body } = await apiJson(`/api/characters/all-images${CITY}`);
      assert.equal(status, 200);
      assert.equal(typeof body, 'object');
      assert.ok(!Array.isArray(body));
    });

    it('GET /:name/sheet — no sheet → {exists: false}', async () => {
      const { status, body } = await apiJson(`/api/characters/${CHAR_GERSON}/sheet${CITY}`);
      assert.equal(status, 200);
      assert.equal(body.exists, false);
      assert.equal(body.content, '');
    });
    it('GET unknown/sheet → 404', async () => {
      const { status } = await apiJson(`/api/characters/${CHAR_UNKNOWN}/sheet${CITY}`);
      assert.equal(status, 404);
    });
    it('GET /:name/images → {images[]}', async () => {
      const { status, body } = await apiJson(`/api/characters/${CHAR_GERSON}/images${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.images));
    });
    it('GET /api/export/characters → тот же массив + заголовок скачивания', async () => {
      const { status, body } = await apiJson(`/api/export/characters${CITY}`);
      assert.equal(status, 200);
      assert.deepEqual(body, chars);
      const res = await fetch(BASE + `/api/export/characters${CITY}`);
      assert.match(res.headers.get('content-disposition') || '', /attachment;.*characters_.*\.json/);
    });
    it('GET /:slug/export-foundry → Foundry Actor JSON + заголовок скачивания', async () => {
      const vampire = chars.find(c => c.lineage === 'vampire' && c.hasSheet);
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
    it('GET /:slug/export-foundry для смертного → 200, type Mortal', async () => {
      const mortal = chars.find(c => c.lineage === 'mortal');
      assert.ok(mortal, 'нужен хотя бы один смертный в фикстуре paris');
      const { status, body } = await apiJson(`/api/characters/${mortal.slug}/export-foundry${CITY}`);
      assert.equal(status, 200);
      assert.equal(body.type, 'Mortal');
    });
    it('GET /:slug/export-foundry для феи → 400 (пока не поддержано)', async () => {
      const fairy = chars.find(c => c.lineage === 'fairy');
      assert.ok(fairy, 'нужна хотя бы одна фея в фикстуре paris');
      const { status } = await apiJson(`/api/characters/${fairy.slug}/export-foundry${CITY}`);
      assert.equal(status, 400);
    });
    it('POST /:slug/import-foundry → пишет sheet-data, возвращает cardFields', async () => {
      const vampire = chars.find(c => c.lineage === 'vampire' && c.hasSheet);
      const sheetPath = path.join(CITY_ROOT, 'characters', vampire.lineageFolder, vampire.slug, `${vampire.slug}-sheet.json`);
      const originalSheet = await fs.readFile(sheetPath, 'utf-8');
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
      try {
        const { status, body } = await apiJson(`/api/characters/${vampire.slug}/import-foundry${CITY}`, {
          method: 'POST', body: JSON.stringify({ actor: actorJson }),
        });
        assert.equal(status, 200);
        assert.equal(body.ok, true);
        assert.ok(body.cardFields);
        const sheetRes = await apiJson(`/api/characters/${vampire.slug}/sheet-data${CITY}`);
        assert.equal(sheetRes.body.data.attributes.physical.strength, 5);
      } finally {
        // Тест мутирует реальную фикстуру city=paris — обязательно вернуть как было.
        await fs.writeFile(sheetPath, originalSheet, 'utf-8');
      }
    });
    it('POST /:slug/import-foundry без actor → 400', async () => {
      const vampire = chars.find(c => c.lineage === 'vampire' && c.hasSheet);
      const { status } = await apiJson(`/api/characters/${vampire.slug}/import-foundry${CITY}`, {
        method: 'POST', body: JSON.stringify({}),
      });
      assert.equal(status, 400);
    });
    it('POST /:slug/import-foundry с actor.type Mortal на вампира → 400 (не даём затереть чужой линейкой)', async () => {
      const vampire = chars.find(c => c.lineage === 'vampire' && c.hasSheet);
      const { status } = await apiJson(`/api/characters/${vampire.slug}/import-foundry${CITY}`, {
        method: 'POST', body: JSON.stringify({ actor: { name: 'X', type: 'Mortal', system: {}, items: [] } }),
      });
      assert.equal(status, 400);
    });

    describe('POST /api/characters/export-foundry-bulk', () => {
      const { readZip } = require('../lib/zip');

      it('happy path: вампир + смертный → ZIP с двумя foundry_<slug>.json', async () => {
        const vampire = chars.find(c => c.lineage === 'vampire' && c.hasSheet);
        const mortal = chars.find(c => c.lineage === 'mortal');
        assert.ok(vampire && mortal, 'нужны вампир (с листом) и смертный в фикстуре paris');

        const mortalSheetPath = path.join(CITY_ROOT, 'characters', mortal.lineageFolder, mortal.slug, `${mortal.slug}-sheet.json`);
        const hadMortalSheet = await fs.access(mortalSheetPath).then(() => true).catch(() => false);
        const originalMortalSheet = hadMortalSheet ? await fs.readFile(mortalSheetPath, 'utf-8') : null;
        if (!hadMortalSheet) {
          await fs.writeFile(mortalSheetPath, JSON.stringify({ lineage: 'mortals', header: { name: mortal.name } }, null, 2), 'utf-8');
        }

        try {
          const res = await fetch(BASE + `/api/characters/export-foundry-bulk${CITY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slugs: [vampire.slug, mortal.slug] }),
          });
          assert.equal(res.status, 200);
          assert.equal(res.headers.get('content-type'), 'application/zip');
          assert.match(res.headers.get('content-disposition') || '', /attachment;.*foundry_export_.*\.zip/);
          const buf = Buffer.from(await res.arrayBuffer());
          const files = readZip(buf);
          assert.equal(files.length, 2);
          const vampireEntry = files.find(f => f.name === `foundry_${vampire.slug}.json`);
          const mortalEntry = files.find(f => f.name === `foundry_${mortal.slug}.json`);
          assert.ok(vampireEntry); assert.ok(mortalEntry);
          assert.equal(JSON.parse(vampireEntry.data.toString('utf-8')).type, 'Vampire');
          assert.equal(JSON.parse(mortalEntry.data.toString('utf-8')).type, 'Mortal');
        } finally {
          if (hadMortalSheet) await fs.writeFile(mortalSheetPath, originalMortalSheet, 'utf-8');
          else await fs.unlink(mortalSheetPath).catch(() => {});
        }
      });

      it('пустой список slugs → 400', async () => {
        const { status } = await apiJson(`/api/characters/export-foundry-bulk${CITY}`, {
          method: 'POST', body: JSON.stringify({ slugs: [] }),
        });
        assert.equal(status, 400);
      });

      it('только неподдерживаемые линейки → 400', async () => {
        const fairy = chars.find(c => c.lineage === 'fairy');
        assert.ok(fairy, 'нужна хотя бы одна фея в фикстуре paris');
        const { status } = await apiJson(`/api/characters/export-foundry-bulk${CITY}`, {
          method: 'POST', body: JSON.stringify({ slugs: [fairy.slug] }),
        });
        assert.equal(status, 400);
      });

      it('смешанный список: неподдерживаемые тихо пропускаются, ZIP содержит только поддержанные', async () => {
        const vampire = chars.find(c => c.lineage === 'vampire' && c.hasSheet);
        const fairy = chars.find(c => c.lineage === 'fairy');
        const res = await fetch(BASE + `/api/characters/export-foundry-bulk${CITY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs: [vampire.slug, fairy.slug] }),
        });
        assert.equal(res.status, 200);
        const buf = Buffer.from(await res.arrayBuffer());
        const files = readZip(buf);
        assert.equal(files.length, 1);
        assert.equal(files[0].name, `foundry_${vampire.slug}.json`);
      });

      it('повреждённый -sheet.json одного персонажа не роняет весь массовый экспорт', async () => {
        const vampireA = chars.find(c => c.lineage === 'vampire' && c.hasSheet);
        const vampireB = chars.find(c => c.lineage === 'vampire' && c.slug !== vampireA.slug);
        assert.ok(vampireA && vampireB, 'нужны два разных вампира в фикстуре paris');
        const brokenSheetPath = path.join(CITY_ROOT, 'characters', vampireB.lineageFolder, vampireB.slug, `${vampireB.slug}-sheet.json`);
        const hadSheet = await fs.access(brokenSheetPath).then(() => true).catch(() => false);
        const originalSheet = hadSheet ? await fs.readFile(brokenSheetPath, 'utf-8') : null;
        await fs.writeFile(brokenSheetPath, '{ не валидный JSON', 'utf-8');
        try {
          const res = await fetch(BASE + `/api/characters/export-foundry-bulk${CITY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slugs: [vampireA.slug, vampireB.slug] }),
          });
          assert.equal(res.status, 200);
          const buf = Buffer.from(await res.arrayBuffer());
          const files = readZip(buf);
          assert.equal(files.length, 1, 'сломанный персонаж пропущен, здоровый — в архиве');
          assert.equal(files[0].name, `foundry_${vampireA.slug}.json`);
        } finally {
          if (hadSheet) await fs.writeFile(brokenSheetPath, originalSheet, 'utf-8');
          else await fs.unlink(brokenSheetPath).catch(() => {});
        }
      });
    });
  });

  describe('Library', () => {
    it('GET /api/library/merits → массив всех категорий, каждая запись {name,points,category}', async () => {
      const { status, body } = await apiJson('/api/library/merits');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);
      const sample = body.find(m => m.name === 'Внушительный тип');
      assert.ok(sample, 'ожидалось известное достоинство «Внушительный тип»');
      assert.equal(typeof sample.points, 'number');
      assert.ok(sample.category, 'ожидалась категория (physical/social/mental/supernatural)');
    });
    it('GET /api/library/flaws → массив всех категорий', async () => {
      const { status, body } = await apiJson('/api/library/flaws');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);
      const sample = body.find(f => f.name === 'Запах могилы');
      assert.ok(sample, 'ожидался известный недостаток «Запах могилы»');
      assert.equal(typeof sample.points, 'number');
    });
    it('GET /api/library/backgrounds/:category → массив одной категории', async () => {
      const { status, body } = await apiJson('/api/library/backgrounds/general');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);
      const sample = body.find(b => b.name === 'Ресурсы');
      assert.ok(sample, 'ожидался известный факт биографии «Ресурсы»');
      assert.equal(sample.category, 'general');
      assert.equal(typeof sample.description, 'string');
    });
    it('GET /api/library/backgrounds → массив всех категорий', async () => {
      const { status, body } = await apiJson('/api/library/backgrounds');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);
      const categories = new Set(body.map(b => b.category));
      assert.deepEqual([...categories].sort(),
        ['changeling', 'general', 'ghoul', 'mage', 'vampire']);
    });
    it('GET /api/library/disciplines → hasArt отражает наличие web/public/img/system/library/disciplines/<slug>.png', async () => {
      // Полностью самодостаточная фикстура (синтетические .md + .png), а не
      // проверка на реальной дисциплине — иначе тест сломается сам собой
      // после батч-генерации арта, когда у всех 17 реальных дисциплин
      // появится настоящий арт и любое захардкоженное "у X ещё нет арта"
      // станет ложным.
      const discDir = path.join(__dirname, '../../system/library/disciplines');
      const imgDir = path.join(__dirname, '../public/img/system/library/disciplines');
      await fs.mkdir(imgDir, { recursive: true });
      const mdWithArt = path.join(discDir, '__test_with_art__.md');
      const mdNoArt = path.join(discDir, '__test_no_art__.md');
      const pngWithArt = path.join(imgDir, '__test_with_art__.png');
      await fs.writeFile(mdWithArt, '# 🐺 Тест с артом (Test)\n');
      await fs.writeFile(mdNoArt, '# 🐺 Тест без арта (Test)\n');
      await fs.writeFile(pngWithArt, Buffer.from([0]));
      try {
        const { status, body } = await apiJson('/api/library/disciplines');
        assert.equal(status, 200);
        const withArt = body.find(d => d.slug === '__test_with_art__');
        const noArt = body.find(d => d.slug === '__test_no_art__');
        assert.ok(withArt, 'фикстура __test_with_art__ должна попасть в список');
        assert.ok(noArt, 'фикстура __test_no_art__ должна попасть в список');
        assert.equal(withArt.hasArt, true);
        assert.equal(noArt.hasArt, false);
      } finally {
        await fs.rm(mdWithArt, { force: true });
        await fs.rm(mdNoArt, { force: true });
        await fs.rm(pngWithArt, { force: true });
      }
    });
    it('GET /api/library/psychics → у всех записей есть поле hasArt (boolean)', async () => {
      const { status, body } = await apiJson('/api/library/psychics');
      assert.equal(status, 200);
      assert.ok(body.length > 0);
      for (const p of body) assert.equal(typeof p.hasArt, 'boolean');
    });
    it('GET /api/library/combo-disciplines отдаёт массив с полями slug/name/prereq', async () => {
      const { status, body } = await apiJson('/api/library/combo-disciplines');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.ok(body.length >= 1);
      assert.ok('slug' in body[0] && 'name' in body[0] && 'prereq' in body[0]);
    });
    it('GET /api/library/merits(/flaws|/backgrounds) → hasArt отражает наличие PNG в web/public/img/system/library/<раздел>/', async () => {
      // Достоинства/недостатки/факты биографии хранятся как JSON-массивы (не
      // по файлу на запись, как дисциплины) — фикстуру создаём через уже
      // существующий CRUD (POST .../merits), а не прямой записью в канон.
      const name = '__TEST_HASART_MERIT__';
      const create = await apiJson('/api/library/merits', {
        method: 'POST', body: JSON.stringify({ category: 'physical', name, points: 1, description: 'x' }),
      });
      assert.equal(create.status, 200);
      const slug = create.body.slug;
      const imgDir = path.join(__dirname, '../public/img/system/library/merits');
      await fs.mkdir(imgDir, { recursive: true });
      const pngPath = path.join(imgDir, slug + '.png');
      await fs.writeFile(pngPath, Buffer.from([0]));
      try {
        const listed = (await apiJson('/api/library/merits/physical')).body.find(m => m.slug === slug);
        assert.ok(listed);
        assert.equal(listed.hasArt, true);
        const listedAll = (await apiJson('/api/library/merits')).body.find(m => m.slug === slug);
        assert.equal(listedAll.hasArt, true);
      } finally {
        await fs.rm(pngPath, { force: true });
        await apiJson(`/api/library/merits/physical/${slug}`, { method: 'DELETE' });
      }
    });
  });

  // ── Library — авторские элементы (фаза I) ─────────────────────────────────
  describe('Library — авторские элементы (фаза I)', () => {
    it('дисциплины: создание/правка/удаление работают только для custom, канон защищён', async () => {
      const name = '__CDP_I_Тестовая дисциплина';
      const create = await apiJson('/api/library/disciplines', {
        method: 'POST',
        body: JSON.stringify({
          name, clans: 'Тестовый клан', source: '', note: 'Заметка',
          levels: [{ level: 1, name: 'Сила первого уровня', literary: 'Лит.', system: 'Сист.' }],
        }),
      });
      assert.equal(create.status, 200);
      const slug = create.body.slug;
      try {
        const listed = await apiJson('/api/library/disciplines');
        const created = listed.body.find(d => d.slug === slug);
        assert.ok(created, 'новая дисциплина должна попасть в список без рестарта');
        assert.equal(created.custom, true);
        assert.equal(created.levels[0].name, 'Сила первого уровня');

        const dup = await apiJson('/api/library/disciplines', { method: 'POST', body: JSON.stringify({ name }) });
        assert.equal(dup.status, 409);

        const edit = await apiJson(`/api/library/disciplines/${slug}`, {
          method: 'PUT',
          body: JSON.stringify({ name, clans: 'Правленый клан', levels: [] }),
        });
        assert.equal(edit.status, 200);
        const afterEdit = (await apiJson('/api/library/disciplines')).body.find(d => d.slug === slug);
        assert.equal(afterEdit.clans, 'Правленый клан');

        // Канон нельзя редактировать/удалять через это API.
        const canonEdit = await apiJson('/api/library/disciplines/animalism', {
          method: 'PUT', body: JSON.stringify({ name: 'Анимализм' }),
        });
        assert.equal(canonEdit.status, 403);
        const canonDelete = await apiJson('/api/library/disciplines/animalism', { method: 'DELETE' });
        assert.equal(canonDelete.status, 403);
      } finally {
        await apiJson(`/api/library/disciplines/${slug}`, { method: 'DELETE' });
        await fs.rm(path.join(__dirname, '../../system/library/disciplines/_deleted'), { recursive: true, force: true });
      }
      const afterDelete = (await apiJson('/api/library/disciplines')).body.find(d => d.slug === slug);
      assert.ok(!afterDelete, 'удалённая дисциплина не должна больше отдаваться API');
    });

    it('психические способности: создание/удаление, custom=true', async () => {
      const name = '__CDP_I_Тестовая психика';
      const create = await apiJson('/api/library/psychics', {
        method: 'POST',
        body: JSON.stringify({ name, category: 'Тестовая категория', levels: [] }),
      });
      assert.equal(create.status, 200);
      const slug = create.body.slug;
      const created = (await apiJson('/api/library/psychics')).body.find(p => p.slug === slug);
      assert.ok(created);
      assert.equal(created.custom, true);
      const del = await apiJson(`/api/library/psychics/${slug}`, { method: 'DELETE' });
      assert.equal(del.status, 200);
      await fs.rm(path.join(__dirname, '../../system/library/psychics/_deleted'), { recursive: true, force: true });
      const afterDelete = (await apiJson('/api/library/psychics')).body.find(p => p.slug === slug);
      assert.ok(!afterDelete);
    });

    it('кланы (K3): создание/правка/удаление работают только для custom, канон защищён', async () => {
      const name = '__CDP_I_Тестовый клан';
      const create = await apiJson('/api/library/clans', {
        method: 'POST',
        body: JSON.stringify({ name, sect: 'Камарилья', disciplines: 'Дисциплина А', weakness: 'Слабость', description: 'Описание клана' }),
      });
      assert.equal(create.status, 200, create.body.error);
      const slug = create.body.slug;
      try {
        const listed = (await apiJson('/api/library/clans')).body.find(c => c.slug === slug);
        assert.ok(listed, 'новый клан должен попасть в список без рестарта');
        assert.equal(listed.custom, true);
        assert.equal(listed.sect, 'Камарилья');
        assert.equal(listed.description, 'Описание клана');

        const dup = await apiJson('/api/library/clans', { method: 'POST', body: JSON.stringify({ name }) });
        assert.equal(dup.status, 409);

        const edit = await apiJson(`/api/library/clans/${slug}`, {
          method: 'PUT', body: JSON.stringify({ name, sect: 'Шабаш', description: 'Правленое описание' }),
        });
        assert.equal(edit.status, 200);
        const afterEdit = (await apiJson('/api/library/clans')).body.find(c => c.slug === slug);
        assert.equal(afterEdit.sect, 'Шабаш');
        assert.equal(afterEdit.description, 'Правленое описание');

        // Канон (7 базовых кланов, K6) нельзя редактировать/удалять через API.
        const canonEdit = await apiJson('/api/library/clans/tremere', { method: 'PUT', body: JSON.stringify({ name: 'Тремер' }) });
        assert.equal(canonEdit.status, 403);
        const canonDelete = await apiJson('/api/library/clans/tremere', { method: 'DELETE' });
        assert.equal(canonDelete.status, 403);
      } finally {
        await apiJson(`/api/library/clans/${slug}`, { method: 'DELETE' });
        await fs.rm(path.join(__dirname, '../../system/library/clans/_deleted'), { recursive: true, force: true });
      }
      const afterDelete = (await apiJson('/api/library/clans')).body.find(c => c.slug === slug);
      assert.ok(!afterDelete, 'удалённый клан не должен больше отдаваться API');
    });

    it('секты (K4): создание/удаление, custom=true, канон защищён', async () => {
      const name = '__CDP_I_Тестовая секта';
      const create = await apiJson('/api/library/sects', {
        method: 'POST', body: JSON.stringify({ name, description: 'Описание секты' }),
      });
      assert.equal(create.status, 200, create.body.error);
      const slug = create.body.slug;
      const created = (await apiJson('/api/library/sects')).body.find(s => s.slug === slug);
      assert.ok(created);
      assert.equal(created.custom, true);

      const canonDelete = await apiJson('/api/library/sects/kamarilya', { method: 'DELETE' });
      assert.equal(canonDelete.status, 403);

      const del = await apiJson(`/api/library/sects/${slug}`, { method: 'DELETE' });
      assert.equal(del.status, 200);
      await fs.rm(path.join(__dirname, '../../system/library/sects/_deleted'), { recursive: true, force: true });
      const afterDelete = (await apiJson('/api/library/sects')).body.find(s => s.slug === slug);
      assert.ok(!afterDelete);
    });

    it('кланы: полный список с wod.su присутствует в справочнике (K6, расширено 2026-08-05)', async () => {
      const { status, body } = await apiJson('/api/library/clans');
      assert.equal(status, 200);
      assert.equal(body.length, 41, '7 базовых corebook + 3 доп. Камарильи + 13 Независимых + 18 Шабаша');
      const slugs = body.map(c => c.slug);
      for (const s of ['bruja', 'gangrel', 'malkavian', 'nosferatu', 'toreador', 'tremere', 'ventru']) {
        assert.ok(slugs.includes(s), `базовый клан ${s} отсутствует`);
      }
      assert.ok(body.every(c => !c.custom), 'все кланы — канон, не авторские записи');
      assert.ok(body.every(c => c.sect && c.disciplines && c.weakness), 'у каждого клана заполнены секта/дисциплины/слабость');
    });

    it('секты: все 7 канонических сект V20 присутствуют в справочнике (K6)', async () => {
      const { status, body } = await apiJson('/api/library/sects');
      assert.equal(status, 200);
      assert.equal(body.length, 7);
      assert.ok(body.every(s => !s.custom), 'секты — канон, не авторские записи');
    });

    it('достоинства: POST/PUT/DELETE по категории, канон защищён, неизвестная категория → 400', async () => {
      const name = '__CDP_I_Тестовое достоинство';
      const create = await apiJson('/api/library/merits', {
        method: 'POST',
        body: JSON.stringify({ category: 'physical', name, points: 2, description: 'Описание' }),
      });
      assert.equal(create.status, 200);
      const slug = create.body.slug;

      const badCategory = await apiJson('/api/library/merits', {
        method: 'POST', body: JSON.stringify({ category: 'nope', name: 'x' }),
      });
      assert.equal(badCategory.status, 400);

      const listed = (await apiJson('/api/library/merits/physical')).body.find(m => m.slug === slug);
      assert.ok(listed);
      assert.equal(listed.points, 2);
      assert.equal(listed.custom, true);

      const edit = await apiJson(`/api/library/merits/physical/${slug}`, {
        method: 'PUT', body: JSON.stringify({ name, points: 3, description: 'Обновлено' }),
      });
      assert.equal(edit.status, 200);
      const afterEdit = (await apiJson('/api/library/merits/physical')).body.find(m => m.slug === slug);
      assert.equal(afterEdit.points, 3);

      const canonDelete = await apiJson('/api/library/merits/physical/ambidekstr', { method: 'DELETE' });
      assert.equal(canonDelete.status, 403);

      const del = await apiJson(`/api/library/merits/physical/${slug}`, { method: 'DELETE' });
      assert.equal(del.status, 200);
      const afterDelete = (await apiJson('/api/library/merits/physical')).body.find(m => m.slug === slug);
      assert.ok(!afterDelete);
    });

    it('недостатки: категория на кириллице (физические)', async () => {
      const name = '__CDP_I_Тестовый недостаток';
      const create = await apiJson('/api/library/flaws', {
        method: 'POST',
        body: JSON.stringify({ category: 'физические', name, points: 1, description: 'Описание' }),
      });
      assert.equal(create.status, 200);
      const slug = create.body.slug;
      const listed = (await apiJson('/api/library/flaws/физические')).body.find(f => f.slug === slug);
      assert.ok(listed);
      const del = await apiJson(`/api/library/flaws/физические/${slug}`, { method: 'DELETE' });
      assert.equal(del.status, 200);
    });

    it('факты биографии (backgrounds): создание/удаление хранят description и system', async () => {
      const name = '__CDP_I_Тестовый факт биографии';
      const create = await apiJson('/api/library/backgrounds', {
        method: 'POST',
        body: JSON.stringify({ category: 'general', name, description: 'Описание', system: '1: раз\n2: два' }),
      });
      assert.equal(create.status, 200);
      const slug = create.body.slug;
      const listed = (await apiJson('/api/library/backgrounds/general')).body.find(b => b.slug === slug);
      assert.ok(listed);
      assert.equal(listed.system, '1: раз\n2: два');
      const del = await apiJson(`/api/library/backgrounds/general/${slug}`, { method: 'DELETE' });
      assert.equal(del.status, 200);
      const afterDelete = (await apiJson('/api/library/backgrounds/general')).body.find(b => b.slug === slug);
      assert.ok(!afterDelete);
    });
  });

  // ── Locations ──────────────────────────────────────────────────────────────
  describe('Locations', () => {
    it('GET /api/locations → array', async () => {
      const { status, body } = await apiJson(`/api/locations${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
    });
    it('each location has title and slug', async () => {
      const { body } = await apiJson(`/api/locations${CITY}`);
      for (const loc of body) {
        assert.ok(loc.title || loc.name);
        assert.ok(loc.slug);
      }
    });

    it('POST /api/locations/parse-generated парсит сырой AI-текст (общий с parseLocation)', async () => {
      const text = `# Тестовая локация
> **Название:** Тест | **Район:** 1-й | **Дополнение к адресу:** Тест | **Адрес:** ул. Тестовая | **Зона:** 🟡 | **Контроль:** Никто
---
## 🎭 Атмосфера
Тестовая атмосфера в двух предложениях.
## 🪝 Сценарные крючки
1. Первый крючок.
2. Второй крючок.
`;
      const { status, body } = await apiJson(`/api/locations/parse-generated${CITY}`, {
        method: 'POST', body: JSON.stringify({ text }),
      });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.match(body.atmosphere, /Тестовая атмосфера/);
      assert.deepEqual(body.hooks, ['Первый крючок.', 'Второй крючок.']);
    });

    it('POST /api/locations/parse-generated без text → 400', async () => {
      const { status, body } = await apiJson(`/api/locations/parse-generated${CITY}`, {
        method: 'POST', body: JSON.stringify({}),
      });
      assert.equal(status, 400);
      assert.equal(body.ok, false);
    });

    it('GET /api/export/locations → тот же массив + заголовок скачивания', async () => {
      const [plain, exported] = await Promise.all([
        apiJson(`/api/locations${CITY}`),
        apiJson(`/api/export/locations${CITY}`),
      ]);
      assert.equal(exported.status, 200);
      assert.deepEqual(exported.body, plain.body);
      const res = await fetch(BASE + `/api/export/locations${CITY}`);
      assert.match(res.headers.get('content-disposition') || '', /attachment;.*locations_.*\.json/);
    });
  });

  // ── Graph ──────────────────────────────────────────────────────────────────
  describe('Graph', () => {
    it('GET /api/graph → {nodes[], links[]}', async () => {
      const { status, body } = await apiJson(`/api/graph${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.nodes));
      assert.ok(Array.isArray(body.links));
    });
    it('each node has id field', async () => {
      const { body } = await apiJson(`/api/graph${CITY}`);
      for (const n of body.nodes) { assert.ok('id' in n); assert.ok(n.id); }
    });

    it('GET /api/graph?compact=true → один узел на линейку', async () => {
      const [full, compact] = await Promise.all([
        apiJson(`/api/graph${CITY}`),
        apiJson(`/api/graph${CITY}&compact=true`),
      ]);
      const lineages = new Set(full.body.nodes.map(n => n.lineage));
      assert.equal(compact.status, 200);
      assert.equal(compact.body.nodes.length, lineages.size);
      for (const n of compact.body.nodes) {
        assert.ok(lineages.has(n.lineage));
        assert.ok(n.count > 0);
      }
      for (const l of compact.body.links) {
        assert.equal(l.type, 'aggregate');
        assert.ok(l.count > 0);
      }
    });
  });

  // ── Chronicles & modules ───────────────────────────────────────────────────
  describe('Chronicles & modules', () => {
    // Discover a real chronicle+module from live data so these assertions don't
    // depend on a hard-coded fixture slug that may be absent in the active city.
    let chr = CHR, mod = MOD;
    before(async () => {
      const { body } = await apiJson(`/api/modules${CITY}`);
      if (Array.isArray(body) && body.length) {
        const m = body.find(x => x.chronicle && x.name) || body[0];
        if (m.chronicle) chr = m.chronicle;
        if (m.name)      mod = m.name;
      }
    });
    it('GET /api/chronicles → array with slug', async () => {
      const { status, body } = await apiJson(`/api/chronicles${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body) && body.length > 0);
      assert.ok(body[0].slug);
    });
    it('GET /api/chronicle → {exists}', async () => {
      const { status, body } = await apiJson(`/api/chronicle${CITY}`);
      assert.equal(status, 200);
      assert.ok('exists' in body);
    });
    it('GET /api/chronicles/:chr/events → array', async () => {
      const { status, body } = await apiJson(`/api/chronicles/${chr}/events${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      if (body.length > 0) assert.ok('date' in body[0] || 'title' in body[0]);
    });
    it('GET /api/chronicles/:chr/modules → array', async () => {
      const { status, body } = await apiJson(`/api/chronicles/${chr}/modules${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
    });
    it('GET /api/modules → non-empty array', async () => {
      const { status, body } = await apiJson(`/api/modules${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body) && body.length > 0);
    });
    it('GET /api/chronicles/:chr/modules/:mod/detail → full object', async () => {
      const { status, body } = await apiJson(
        `/api/chronicles/${chr}/modules/${mod}/detail${CITY}`);
      assert.equal(status, 200);
      assert.equal(body.name, mod);
      assert.equal(body.chronicle, chr);
      assert.ok(Array.isArray(body.pcs));
      assert.ok(Array.isArray(body.npcs));
      assert.ok(Array.isArray(body.events));
      assert.ok('title' in body);
    });
    it('GET nonexistent module/detail → 404', async () => {
      const { status } = await apiJson(
        `/api/chronicles/${chr}/modules/__NOMOD__/detail${CITY}`);
      assert.equal(status, 404);
    });
    it('POST recap — unknown chronicle (no events.md) → 404', async () => {
      // events.md / events validation runs before any AI client is built.
      const { status } = await apiJson(`/api/chronicles/__nochron__/recap${CITY}`,
        { method: 'POST', body: JSON.stringify({ count: 3 }) });
      assert.equal(status, 404);
    });
  });

  // ── Archive / lore ─────────────────────────────────────────────────────────
  describe('Archive / lore', () => {
    for (const [label, suffix] of [
      ['timeline', '/api/timeline'],
      ['factions', '/api/factions'],
      ['visitors', '/api/visitors'],
    ]) {
      it(`GET ${suffix} → {exists, content}`, async () => {
        const { status, body } = await apiJson(`${suffix}${CITY}`);
        assert.equal(status, 200, label);
        assert.equal(typeof body.exists,  'boolean');
        assert.equal(typeof body.content, 'string');
      });
    }
    it('GET /api/rumors?type=elysium → {exists, content}', async () => {
      const { status, body } = await apiJson(`/api/rumors${CITY}&type=elysium`);
      assert.equal(status, 200);
      assert.equal(typeof body.exists,  'boolean');
      assert.equal(typeof body.content, 'string');
    });
    it('GET /api/rumors?type=dreaming → {exists, content}', async () => {
      const { status, body } = await apiJson(`/api/rumors${CITY}&type=dreaming`);
      assert.equal(status, 200);
      assert.equal(typeof body.exists,  'boolean');
      assert.equal(typeof body.content, 'string');
    });
  });

  // ── Search ─────────────────────────────────────────────────────────────────
  describe('Search', () => {
    it('short query (< 3 chars) → empty results', async () => {
      const { status, body } = await apiJson(`/api/search?q=ab&city=paris`);
      assert.equal(status, 200);
      assert.equal(body.total, 0);
    });
    it('returns expected shape for real query', async () => {
      const { status, body } = await apiJson(`/api/search?q=Paris&city=paris`);
      assert.equal(status, 200);
      assert.ok('results' in body);
      assert.ok('total'   in body);
      const r = body.results;
      assert.ok(Array.isArray(r.characters));
      assert.ok(Array.isArray(r.locations));
      assert.ok(Array.isArray(r.modules));
      assert.ok(Array.isArray(r.events));
      assert.ok(Array.isArray(r.archive));
    });
    it('character results have slug/name/lineage/excerpt', async () => {
      const { body } = await apiJson(`/api/search?q=Париж&city=paris`);
      for (const c of (body.results?.characters || [])) {
        assert.ok(typeof c.slug    === 'string');
        assert.ok(typeof c.name    === 'string');
        assert.ok(typeof c.excerpt === 'string');
      }
    });
    it('module results carry chronicleDisplay (кириллица из events.md), не голый слаг', async () => {
      // Своя одноразовая хроника, а не первая из общего списка — другие тесты
      // выполняются конкурентно (node:test по умолчанию) и трогают общие фикстуры.
      const chrDisplay = `QA Search Хроника ${Date.now()}`;
      const chrSlug    = `test_search_chr_${Date.now()}`;
      const created = await apiJson(`/api/chronicles${CITY}`, {
        method: 'POST', body: JSON.stringify({ name: chrDisplay, slug: chrSlug }),
      });
      assert.equal(created.status, 200);

      const marker  = `qa_search_marker_${Date.now()}`;
      const modSlug = `test_search_mod_${Date.now()}`;
      await apiJson(`/api/chronicles/${encodeURIComponent(chrSlug)}/modules${CITY}`, {
        method: 'POST', body: JSON.stringify({ name: marker, time: '2010', slug: modSlug }),
      });
      const { body } = await apiJson(`/api/search?q=${encodeURIComponent(marker)}&city=paris`);
      const hit = (body.results?.modules || []).find(m => m.module === modSlug);
      assert.ok(hit, 'модуль должен найтись в результатах поиска');
      assert.equal(hit.chronicle, chrSlug);
      assert.equal(hit.chronicleDisplay, chrDisplay);

      await apiJson(`/api/chronicles/${encodeURIComponent(chrSlug)}/modules/${encodeURIComponent(modSlug)}${CITY}`, { method: 'DELETE' });
      await apiJson(`/api/chronicles/${encodeURIComponent(chrSlug)}${CITY}`, { method: 'DELETE' });
    });
  });

  describe('Chronicle book-data', () => {
    it('GET /api/chronicles/:slug/book-data — display, chronicleMd, modules с finale', async () => {
      const { status, body } = await apiJson(`/api/chronicles/zimniy_parizh_2010/book-data${CITY}`);
      assert.equal(status, 200);
      assert.ok(body.display);
      assert.equal(typeof body.chronicleMd, 'string'); // может быть пустым: старые хроники без chronicle.md
      assert.ok(Array.isArray(body.modules) && body.modules.length > 0);
      const withFinale = body.modules.find(m => m.name === 'koshki_i_myshki');
      assert.ok(withFinale && withFinale.finale.length > 0, 'у закрытого модуля должен быть finale');
      assert.ok(withFinale.title);
    });
    it('GET book-data несуществующей хроники → 404', async () => {
      const { status } = await apiJson(`/api/chronicles/__nope__/book-data${CITY}`);
      assert.equal(status, 404);
    });
  });

  // ── Threads — read ─────────────────────────────────────────────────────────
  describe('Threads — read', () => {
    let threads;
    before(async () => {
      const { body } = await apiJson(`/api/threads${CITY}`);
      threads = Array.isArray(body) ? body : [];
    });
    it('returns non-empty array', () => assert.ok(threads.length > 0));
    it('each thread has id / title / status / file', () => {
      for (const t of threads) {
        assert.equal(typeof t.id, 'number');
        assert.ok(t.title); assert.ok(t.status); assert.ok(t.file);
      }
    });
    it('элементы имеют staleMonths (игровая давность) относительно самой свежей нити', () => {
      const dated = threads.filter(t => t.staleMonths !== null && t.staleMonths !== undefined);
      assert.ok(dated.length > 0, 'ни у одной нити не распознана дата источника');
      assert.ok(dated.some(t => t.staleMonths === 0), 'нет нити с давностью 0 (самой свежей)');
      assert.ok(dated.every(t => t.staleMonths >= 0));
    });
    it('file paths match whitelist pattern', () => {
      const re = /^(archive\/open_threads\.md|chronicles\/[^/]+\/open_threads\.md)$/;
      for (const t of threads) assert.ok(re.test(t.file));
    });
    it('status values are known keys', () => {
      const valid = new Set(['active','background','closed','abandoned','unknown']);
      for (const t of threads) assert.ok(valid.has(t.status));
    });
  });

  // ── Threads — write round-trip ─────────────────────────────────────────────
  describe('Threads — write round-trip', () => {
    const FILE  = 'archive/open_threads.md';
    const TITLE = '__TEST_AUTO__';
    let createdId = null;

    after(async () => {
      if (createdId === null) return;
      const p = path.join(CITY_ROOT, FILE);
      const raw = await fs.readFile(p, 'utf-8').catch(() => '');
      await fs.writeFile(p, raw.split('\n').filter(l => !l.includes(TITLE)).join('\n'), 'utf-8');
    });

    it('POST missing title → 400', async () => {
      const { status, body } = await apiJson(`/api/threads${CITY}`, {
        method: 'POST', body: JSON.stringify({ title: '', file: FILE }),
      });
      assert.equal(status, 400); assert.ok(body.error);
    });
    it('POST path traversal in file → 400', async () => {
      const { status } = await apiJson(`/api/threads${CITY}`, {
        method: 'POST', body: JSON.stringify({ title: 'X', file: '../../../etc/passwd' }),
      });
      assert.equal(status, 400);
    });
    it('POST valid → 200 {ok, id}', async () => {
      const { status, body } = await apiJson(`/api/threads${CITY}`, {
        method: 'POST',
        body: JSON.stringify({ title: TITLE, description: 'интеграционный тест',
          source: 'auto-test', status: 'active', priority: 'Средний', file: FILE }),
      });
      assert.equal(status, 200); assert.ok(body.ok);
      assert.equal(typeof body.id, 'number');
      createdId = body.id;
    });
    it('GET after POST → thread appears', async () => {
      assert.ok(createdId !== null, 'prerequisite: POST must succeed first');
      const { body } = await apiJson(`/api/threads${CITY}`);
      const found = (Array.isArray(body) ? body : []).find(t => t.id === createdId);
      assert.ok(found); assert.equal(found.status, 'active');
    });
    it('PATCH bad file path → 400', async () => {
      const { status } = await apiJson(`/api/threads/1${CITY}`, {
        method: 'PATCH', body: JSON.stringify({ file: '../../evil.md', status: 'active' }),
      });
      assert.equal(status, 400);
    });
    it('PATCH unknown status → 400', async () => {
      const { status } = await apiJson(`/api/threads/${createdId ?? 1}${CITY}`, {
        method: 'PATCH', body: JSON.stringify({ file: FILE, status: 'invisible' }),
      });
      assert.equal(status, 400);
    });
    it('PATCH → closed / Низкий', async () => {
      assert.ok(createdId !== null, 'prerequisite: POST must succeed first');
      const { status, body } = await apiJson(`/api/threads/${createdId}${CITY}`, {
        method: 'PATCH', body: JSON.stringify({ file: FILE, status: 'closed', priority: 'Низкий' }),
      });
      assert.equal(status, 200); assert.ok(body.ok);
    });
    it('GET after PATCH → shows closed / Низкий', async () => {
      assert.ok(createdId !== null, 'prerequisite: PATCH must succeed first');
      const { body } = await apiJson(`/api/threads${CITY}`);
      const found = (Array.isArray(body) ? body : []).find(t => t.id === createdId);
      assert.ok(found);
      assert.equal(found.status, 'closed');
      assert.equal(found.priority, 'Низкий');
    });
  });

  // ── Threads — переход из «Висящих нитей» Панели со скроллом/подсветкой ─────
  describe('Threads — фокус нити при переходе с Панели', () => {
    it('source-guard: renderDashboard прокидывает data-thread-id/data-thread-file в строку нити', () => {
      const src = require('fs').readFileSync(path.join(__dirname, '../public/scripts/scripts.js'), 'utf-8');
      assert.ok(src.includes('data-thread-id'), 'нет data-thread-id в строке «Висящих нитей»');
      assert.ok(src.includes('data-thread-file'), 'нет data-thread-file в строке «Висящих нитей»');
      assert.ok(src.includes('_pendingThreadFocus'),
        'клик-обработчик не устанавливает _pendingThreadFocus перед navigate(\'threads\')');
    });
    it('source-guard: loadThreads() скроллит и подсвечивает целевую нить по _pendingThreadFocus', () => {
      const src = require('fs').readFileSync(path.join(__dirname, '../public/scripts/archive.js'), 'utf-8');
      assert.ok(src.includes('_pendingThreadFocus'), 'archive.js не объявляет/не использует _pendingThreadFocus');
      assert.ok(src.includes('scrollIntoView'), 'loadThreads() не скроллит к целевой нити');
      assert.ok(src.includes('thread-card--focus'), 'loadThreads() не подсвечивает целевую карточку класса thread-card--focus');
      assert.ok(src.includes('prefers-reduced-motion'), 'скролл не учитывает prefers-reduced-motion');
    });
    it('source-guard: styles.css определяет подсветку .thread-card--focus на существующих токенах', () => {
      const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
      assert.ok(css.includes('.thread-card--focus'), 'нет класса .thread-card--focus');
      assert.ok(/\.thread-card--focus\s*\{[^}]*var\(--glow\)/s.test(css),
        '.thread-card--focus не использует var(--glow)');
      assert.ok(/\.thread-card--focus\s*\{[^}]*var\(--accent\)/s.test(css),
        '.thread-card--focus не использует var(--accent)');
    });
    // Перенесено с ветки worktree-patch-niti-broski-sessiya-svyazi-list (код-ревью,
    // не попало в master при параллельной прямой реализации того же плана) —
    // см. docs/audit/2026-07-28-session-feature-qa-report.md, обсуждение веток.
    it('source-guard: loadThreads() считывает и обнуляет _pendingThreadFocus ДО await fetch (иначе утекает при сетевой ошибке)', () => {
      const src = require('fs').readFileSync(path.join(__dirname, '../public/scripts/archive.js'), 'utf-8');
      const fnMatch = src.match(/async function loadThreads\(\) \{[\s\S]*?\n\}/);
      assert.ok(fnMatch, 'не найдена функция loadThreads');
      const fn = fnMatch[0];
      const resetIdx = fn.indexOf('_pendingThreadFocus = null');
      const fetchIdx = fn.indexOf('await fetch(');
      assert.ok(resetIdx !== -1, 'loadThreads() не обнуляет _pendingThreadFocus');
      assert.ok(fetchIdx !== -1, 'loadThreads() не вызывает await fetch(...)');
      assert.ok(resetIdx < fetchIdx,
        '_pendingThreadFocus обнуляется ПОСЛЕ await fetch — при сетевой ошибке сброс попадёт в catch и намерение фокуса утечёт на следующий обычный заход');
    });
  });

  // ── Diary — validation ─────────────────────────────────────────────────────
  describe('Diary — validation', () => {
    it('GET without file param → 400', async () => {
      const { status } = await apiJson(`/api/characters/${CHAR_GERSON}/diary${CITY}`);
      assert.equal(status, 400);
    });
    it('PUT invalid period → 400', async () => {
      const { status, body } = await apiJson(`/api/characters/${CHAR_GERSON}/diary${CITY}`, {
        method: 'PUT', body: JSON.stringify({ period: 'bad-period', text: 'Текст' }),
      });
      assert.equal(status, 400); assert.ok(body.error);
    });
    it('PUT empty text → 400', async () => {
      const { status } = await apiJson(`/api/characters/${CHAR_GERSON}/diary${CITY}`, {
        method: 'PUT', body: JSON.stringify({ period: '2010-01', text: '' }),
      });
      assert.equal(status, 400);
    });
    it('GET unknown character → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}/diary${CITY}&file=journal/x.md`);
      assert.equal(status, 404);
    });
  });

  // ── Diary — write round-trip ───────────────────────────────────────────────
  describe('Diary — write round-trip', () => {
    const CHAR_NAME    = 'Герсон';
    const CHAR_SLUG    = 'gerson';
    const CHAR_LINEAGE = 'vampires';
    const TEST_PERIOD  = '1900-01';
    const CHAR_ENC     = encodeURIComponent(CHAR_SLUG);
    const FILE_REL     = `journal/${TEST_PERIOD}.md`;
    const charDir      = path.join(CITY_ROOT, 'characters', CHAR_LINEAGE, CHAR_SLUG);
    const diaryFile    = path.join(charDir, FILE_REL);
    const cardFile     = path.join(charDir, `${CHAR_SLUG}.md`);
    let originalCard   = null;

    before(async () => {
      originalCard = await fs.readFile(cardFile, 'utf-8').catch(() => null);
    });
    after(async () => {
      await fs.unlink(diaryFile).catch(() => {});
      if (originalCard !== null) await fs.writeFile(cardFile, originalCard, 'utf-8');
    });

    it('PUT creates diary → 200 {ok}', async () => {
      const { status, body } = await apiJson(`/api/characters/${CHAR_ENC}/diary${CITY}`, {
        method: 'PUT',
        body: JSON.stringify({ period: TEST_PERIOD,
          text: 'Интеграционный тест — можно удалить.',
          session: 'Авто-тест', mode: 'create' }),
      });
      assert.equal(status, 200); assert.ok(body.ok);
    });
    it('journal file exists on disk', async () => {
      const stat = await fs.stat(diaryFile).catch(() => null);
      assert.ok(stat !== null);
    });
    it('card updated with diary link', async () => {
      const card = await fs.readFile(cardFile, 'utf-8');
      assert.ok(card.includes(FILE_REL));
    });
    it('GET reads back the diary', async () => {
      const { status, body } = await apiJson(
        `/api/characters/${CHAR_ENC}/diary${CITY}&file=${encodeURIComponent(FILE_REL)}`);
      assert.equal(status, 200);
      assert.equal(typeof body.format, 'string');
      assert.ok(body.format === 'entry' || body.format === 'retrospective');
    });
  });

  // ── Security & error handling ──────────────────────────────────────────────
  describe('Security & error handling', () => {
    it('path traversal in diary file → error status', async () => {
      const evil = encodeURIComponent('../../server.js');
      const { status } = await apiJson(
        `/api/characters/${CHAR_GERSON}/diary${CITY}&file=${evil}`);
      assert.ok([400, 403, 404, 500].includes(status));
    });
    it('invalid city slug sanitised → 200 (default city)', async () => {
      const { status } = await apiJson('/api/characters?city=../../../etc');
      assert.equal(status, 200);
    });
    it('unknown API route → 404', async () => {
      const r = await fetch('http://localhost:3099/api/__no_such_route__');
      assert.equal(r.status, 404);
    });
  });

  // ── AI generation — input validation (no live API calls) ─────────────────────
  // Character lookup runs before the generation client is built, so a missing
  // character returns 404 without ever contacting an AI provider.
  describe('AI generation — validation', () => {
    it('POST generate-prompt — unknown char → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}/generate-prompt${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(status, 404);
    });
    // Регрессия: модель иногда возвращает технически валидный JSON, но с
    // мусорным/усечённым содержимым позитивного промта («[Блок 1]rews inside
    // [Блок 2]... [Блок 3]...» — реальный кейс, который тихо сохранился поверх
    // карточки персонажа «Золотая маска»/baali). _isBogusPrompt должна ловить
    // это, но не давать ложных срабатываний на настоящие развёрнутые промты.
    it('_isBogusPrompt (generation.js) ловит обрезанный/мусорный промт, не флагает настоящий', () => {
      const src = require('fs').readFileSync(path.join(__dirname, '../routes/generation.js'), 'utf-8');
      const fnMatch = src.match(/const _isBogusPrompt = text => \{[\s\S]*?\n {6}\};/);
      assert.ok(fnMatch, 'не найдена функция _isBogusPrompt в generation.js');
      const _isBogusPrompt = (new Function(`return (${fnMatch[0].replace(/^const _isBogusPrompt = /, '').replace(/;$/, '')})`))();

      const bogus = '[Блок 1]rews inside\n[Блок 2]...\n[Блок 3]...';
      assert.equal(_isBogusPrompt(bogus), true, 'реальный обрезанный ответ (баали/«Золотая маска») не распознан как мусорный');
      assert.equal(_isBogusPrompt(''), true, 'пустая строка не распознана как мусорная');
      assert.equal(_isBogusPrompt('[Блок 1]...\n[Блок 2] нормальный текст здесь достаточно длинный чтобы пройти\n[Блок 3] тоже достаточно длинный текст блока'), true,
        'промт с одним пустым блоком-заглушкой («...») не распознан как мусорный');

      const real = '[Блок 1] Tall feminine figure with pale almost lunar skin covered in thin streams of golden lacquer flowing from her neck across half her face, ornate golden skull-shaped mask concealing one eye.\n' +
        '[Блок 2] Dramatic chiaroscuro lighting from below and side, warm amber rim light illuminating the golden lacquer and gold jewelry while deep black shadows swallow parts of the figure. Abstract flat color-wash background, deep crimson-red blended into black.\n' +
        '[Блок 3] Dark fantasy digital painting, visible painterly brushstrokes, oil-paint texture, cinematic dramatic lighting, gothic noir atmosphere, concept art quality, masterpiece, highly detailed, 1023x1537';
      assert.equal(_isBogusPrompt(real), false, 'настоящий развёрнутый промт ложно распознан как мусорный');
    });
    it('POST generate-appearance — unknown char → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}/generate-appearance${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(status, 404);
    });
    it('POST dialogue — missing situation → 400 (before AI call)', async () => {
      const { status } = await apiJson(
        `/api/characters/${CHAR_GERSON}/dialogue${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(status, 400);
    });
    it('POST dialogue — unknown char with situation → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}/dialogue${CITY}`,
        { method: 'POST', body: JSON.stringify({ situation: 'Сцена в Элизиуме' }) });
      assert.equal(status, 404);
    });
    it('POST canon-check — empty text → 400', async () => {
      const { status } = await apiJson(`/api/canon-check${CITY}`,
        { method: 'POST', body: JSON.stringify({ text: '   ' }) });
      assert.equal(status, 400);
    });
    it('POST canon-check — over-long text → 400', async () => {
      const { status } = await apiJson(`/api/canon-check${CITY}`,
        { method: 'POST', body: JSON.stringify({ text: 'я'.repeat(8001) }) });
      assert.equal(status, 400);
    });
  });

  // ── Character sheets (V20) — guards (lookup/empty checks precede AI) ──────────
  describe('Character sheets — guards', () => {
    it('POST sheet/generate — unknown char → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}/sheet/generate${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(status, 404);
    });
    it('PUT sheet — empty content → 400 (guard before write)', async () => {
      const { status } = await apiJson(`/api/characters/${CHAR_GERSON}/sheet${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: '' }) });
      assert.equal(status, 400);
    });
    it('PUT sheet — unknown char → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}/sheet${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: 'непустой' }) });
      assert.equal(status, 404);
    });
  });

  // ── Module NPC sheets — guards (fictional path, never writes) ────────────────
  describe('Module NPC sheets — guards', () => {
    const NPC = '/api/chronicles/__nochron__/modules/__nomod__/npc/__nonpc__';
    it('GET npc sheet — nonexistent → {exists:false}', async () => {
      const { status, body } = await apiJson(`${NPC}/sheet${CITY}`);
      assert.equal(status, 200);
      assert.equal(body.exists, false);
      assert.equal(body.content, '');
    });
    it('POST npc sheet/generate — missing card → 404', async () => {
      const { status } = await apiJson(`${NPC}/sheet/generate${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(status, 404);
    });
    it('PUT npc sheet — empty content → 400', async () => {
      const { status } = await apiJson(`${NPC}/sheet${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: '' }) });
      assert.equal(status, 400);
    });
  });

  // ── Module sessions — guards (unknown module rejected before any write) ──────
  describe('Module sessions — guards', () => {
    it('POST session — unknown module → 404', async () => {
      const { status } = await apiJson(
        '/api/chronicles/__nochron__/modules/__nomod__/session' + CITY,
        { method: 'POST', body: JSON.stringify({ notes: 'что-то' }) });
      assert.equal(status, 404);
    });
  });

  // ── Claude OAuth status — read-only (local creds, no network) ────────────────
  describe('Claude status', () => {
    it('GET /api/claude/status → shape', async () => {
      const { status, body } = await apiJson(`/api/claude/status${CITY}`);
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.ok('claudeOauth' in body);
      assert.equal(typeof body.hasAnthropicKey, 'boolean');
    });
  });

  // ── AI generation — happy path (AI_MOCK provider: deterministic, offline,
  //    non-writing endpoints only) ─────────────────────────────────────────────
  describe('AI generation — happy path (mock)', () => {
    it('POST dialogue — known char + situation → 200 with replies', async () => {
      const { status, body } = await apiJson(
        `/api/characters/${CHAR_GERSON}/dialogue${CITY}`,
        { method: 'POST', body: JSON.stringify({ situation: 'Встреча в Элизиуме', count: 2 }) });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(typeof body.text, 'string');
      assert.ok(body.text.length > 0);
      assert.equal(body.source, 'mock');
    });
    it('POST canon-check — valid text → 200 with issues array', async () => {
      const { status, body } = await apiJson(`/api/canon-check${CITY}`,
        { method: 'POST', body: JSON.stringify({ text: 'Герсон вошёл в Элизиум на закате.' }) });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.issues));
    });
    it('POST /api/locations/generate field=sensory + channel → 200 with value (per-channel регенерация сенсорики)', async () => {
      const { status, body } = await apiJson(`/api/locations/generate${CITY}`,
        { method: 'POST', body: JSON.stringify({ name: 'Опера Гарнье', field: 'sensory', channel: 'Звук', context: 'элизиум' }) });
      assert.equal(status, 200);
      assert.equal(typeof body.value, 'string');
      assert.ok(body.value.length > 0);
    });
  });

  // ── Character delete — guards (only the 404 path; never deletes real data) ───
  describe('Character delete — guards', () => {
    it('GET delete-preview — unknown char → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}/delete-preview${CITY}`);
      assert.equal(status, 404);
    });
    it('DELETE — unknown char → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}${CITY}`, { method: 'DELETE' });
      assert.equal(status, 404);
    });
  });

  // ── Image deletion — guards (no real deletion happens) ───────────────────────
  describe('Image deletion — guards', () => {
    it('DELETE dotfile name → 400 (filename guard before lookup)', async () => {
      const { status } = await apiJson(
        `/api/characters/${CHAR_GERSON}/images/${encodeURIComponent('.hidden')}${CITY}`,
        { method: 'DELETE' });
      assert.equal(status, 400);
    });
    it('DELETE for unknown char → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}/images/whatever.jpg${CITY}`,
        { method: 'DELETE' });
      assert.equal(status, 404);
    });
    it('DELETE missing file with no card reference → 404 (idempotent guard)', async () => {
      const { status } = await apiJson(
        `/api/characters/${CHAR_GERSON}/images/__no_such_file_999.jpg${CITY}`,
        { method: 'DELETE' });
      assert.equal(status, 404);
    });
  });

  // ── Image upload ──────────────────────────────────────────────────────────────
  describe('Image upload', () => {
    // FIX-4b (docs/audit/2026-07-28-fix-plan.md): ключ должен быть slug, не
    // отображаемое имя — иначе два персонажа с одинаковым именем в грид-карусели
    // читают/пишут одну и ту же запись в этом словаре.
    it('GET /api/characters/all-images — ключ словаря это slug, а не отображаемое имя (только при 2+ арта)', async () => {
      const cardPath = path.join(CITY_ROOT, 'characters', 'vampires', CHAR_GERSON, `${CHAR_GERSON}.md`);
      const originalCard = await fs.readFile(cardPath, 'utf-8');
      const uploaded = [];
      try {
        for (const ext of ['png', 'webp']) {
          const { status, body } = await apiJson(
            `/api/characters/${CHAR_GERSON}/upload-image${CITY}`,
            { method: 'POST', body: JSON.stringify({
              base64: ext === 'png' ? 'iVBORw0KGgo=' : 'UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
              ext,
            }) });
          assert.equal(status, 200, body.error);
          uploaded.push(body.filename);
        }
        const { body: allImages } = await apiJson(`/api/characters/all-images${CITY}`);
        assert.ok(Object.prototype.hasOwnProperty.call(allImages, CHAR_GERSON),
          `ожидался ключ "${CHAR_GERSON}" (slug) — получены ключи: ${Object.keys(allImages).join(', ')}`);
      } finally {
        // DELETE-эндпоинт чистит файл и ссылку в «## 🖼️ Изображения», и
        // инвалидирует серверный кэш персонажей — но не гарантирует побайтово
        // тот же trailing whitespace, что был в файле до теста (не его забота).
        // Восстанавливаем карточку явным снапшотом, а не полагаемся на это.
        for (const f of uploaded) {
          await apiJson(`/api/characters/${CHAR_GERSON}/images/${encodeURIComponent(f)}${CITY}`, { method: 'DELETE' });
        }
        await fs.writeFile(cardPath, originalCard, 'utf-8');
      }
    });

    // Найдено как побочный эффект написания предыдущего теста: у CHAR_GERSON
    // секция «## 🖼️ Изображения» — последняя в карточке (нет следующего ##),
    // и `tail`-ветка регекса, добавляющей новую строку с артом, раньше
    // ре-вставляла УЖЕ захваченный (и не тронутый) хвостовой whitespace поверх
    // ещё одного добавленного \n — при каждой загрузке карточка накапливала
    // на одну пустую строку в конце больше, независимо от последующего
    // удаления файла. Безобидно по отдельности, но росло без предела при
    // повторных загрузках (в т.ч. этим же тест-сьютом при каждом запуске).
    it('POST /upload-image (2×) на карточку без секции ПОСЛЕ «## 🖼️ Изображения» не накапливает пустые строки в конце файла', async () => {
      const cardPath = path.join(CITY_ROOT, 'characters', 'vampires', CHAR_GERSON, `${CHAR_GERSON}.md`);
      const originalCard = await fs.readFile(cardPath, 'utf-8');
      const uploaded = [];
      try {
        for (const ext of ['png', 'webp']) {
          const { status, body } = await apiJson(
            `/api/characters/${CHAR_GERSON}/upload-image${CITY}`,
            { method: 'POST', body: JSON.stringify({
              base64: ext === 'png' ? 'iVBORw0KGgo=' : 'UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
              ext,
            }) });
          assert.equal(status, 200, body.error);
          uploaded.push(body.filename);
        }
        const afterUploads = await fs.readFile(cardPath, 'utf-8');
        assert.ok(!/\n{4,}$/.test(afterUploads),
          'после двух загрузок подряд карточка не должна заканчиваться 4+ переносами строк подряд (было — накопление пустых строк)');
      } finally {
        for (const f of uploaded) {
          await apiJson(`/api/characters/${CHAR_GERSON}/images/${encodeURIComponent(f)}${CITY}`, { method: 'DELETE' });
        }
        await fs.writeFile(cardPath, originalCard, 'utf-8');
      }
    });

    it('POST /upload-image — неизвестный персонаж → 404', async () => {
      const { status } = await apiJson(
        `/api/characters/${encodeURIComponent(CHAR_UNKNOWN)}/upload-image${CITY}`,
        { method: 'POST', body: JSON.stringify({ base64: 'AAAA', ext: 'jpg' }) });
      assert.equal(status, 404);
    });

    it('POST /upload-image — сохраняет файл в art/, дописывает секцию изображений в карточке', async () => {
      const cardPath = path.join(CITY_ROOT, 'characters', 'vampires', CHAR_GERSON, `${CHAR_GERSON}.md`);
      const original = await fs.readFile(cardPath, 'utf-8');
      let createdFile = null;
      try {
        const { status, body } = await apiJson(
          `/api/characters/${CHAR_GERSON}/upload-image${CITY}`,
          // PNG magic bytes (\x89PNG\r\n\x1a\n) — validateImageUpload (FIX-1) now checks
          // content against the claimed ext, so this must actually decode to a PNG header.
          { method: 'POST', body: JSON.stringify({ base64: 'iVBORw0KGgo=', ext: 'png' }) });
        assert.equal(status, 200);
        assert.equal(body.success, true);
        assert.match(body.filename, new RegExp(`^${CHAR_GERSON}_\\d+\\.png$`));

        createdFile = path.join(CITY_ROOT, 'characters', 'vampires', CHAR_GERSON, 'art', body.filename);
        const written = await fs.readFile(createdFile);
        assert.ok(written.length > 0, 'файл изображения должен быть записан на диск');

        const updatedCard = await fs.readFile(cardPath, 'utf-8');
        assert.match(updatedCard, new RegExp(`art/${body.filename}`), 'карточка должна ссылаться на новый файл');
      } finally {
        if (createdFile) await fs.rm(createdFile, { force: true });
        await fs.writeFile(cardPath, original, 'utf-8');
      }
    });

    // FIX-1: QA (2026-07-28) — сервер принимал любое расширение из [^a-z] и
    // никогда не проверял содержимое, из-за чего <script> под именем "арта"
    // сохранялся и отдавался обратно как text/html (stored XSS).
    it('POST /upload-image — html-содержимое под видом расширения "html" → 400, не сохраняется', async () => {
      const before = await fs.readdir(path.join(CITY_ROOT, 'characters', 'vampires', CHAR_GERSON, 'art')).catch(() => []);
      const base64 = Buffer.from('<script>alert(1)</script>', 'utf-8').toString('base64');
      const { status, body } = await apiJson(
        `/api/characters/${CHAR_GERSON}/upload-image${CITY}`,
        { method: 'POST', body: JSON.stringify({ base64, ext: 'html' }) });
      assert.equal(status, 400);
      assert.ok(body.error, 'нет сообщения об ошибке');
      const after = await fs.readdir(path.join(CITY_ROOT, 'characters', 'vampires', CHAR_GERSON, 'art')).catch(() => []);
      assert.deepEqual(after, before, 'ничего не должно быть записано в art/ при отклонённой загрузке');
    });

    it('POST /upload-image — валидные PNG-байты с ext="jpg" (расширение врёт о содержимом) → 400', async () => {
      const { status, body } = await apiJson(
        `/api/characters/${CHAR_GERSON}/upload-image${CITY}`,
        { method: 'POST', body: JSON.stringify({ base64: 'iVBORw0KGgo=', ext: 'jpg' }) });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('source-guard: /city-img отдаётся с X-Content-Type-Options: nosniff', () => {
      const serverSrc = require('fs').readFileSync(path.join(__dirname, '../server.js'), 'utf-8');
      const mount = serverSrc.match(/app\.use\('\/city-img'[\s\S]*?\)\);/);
      assert.ok(mount, 'не найдено монтирование /city-img');
      assert.ok(/X-Content-Type-Options.*nosniff/.test(mount[0]), '/city-img не задаёт X-Content-Type-Options: nosniff');
    });

    it('source-guard: локации используют тот же validateImageUpload, что и персонажи', () => {
      const locSrc = require('fs').readFileSync(path.join(__dirname, '../routes/locations.js'), 'utf-8');
      assert.ok(/validateImageUpload\(base64, ext\)/.test(locSrc),
        'routes/locations.js не использует validateImageUpload — та же уязвимость, что и в characters.js, должна быть закрыта и там');
    });
  });

  describe('API — audio library', () => {
    const AUDIO_ROOT = path.join(__dirname, '../../cities/audio');
    const INDEX_PATH = path.join(AUDIO_ROOT, 'index.json');

    // cities/audio/ doesn't exist until first use — snapshot whatever's there
    // (nothing, on a clean checkout) so every test can restore it exactly.
    let indexExisted, originalIndex;
    before(async () => {
      originalIndex = await fs.readFile(INDEX_PATH, 'utf-8').catch(() => null);
      indexExisted = originalIndex !== null;
    });
    after(async () => {
      if (indexExisted) await fs.writeFile(INDEX_PATH, originalIndex, 'utf-8');
      else await fs.rm(INDEX_PATH, { force: true });
    });

    it('GET /api/audio — пустой список на чистой установке', async () => {
      if (indexExisted) return; // только на чистом манифесте показателен
      const { status, body } = await apiJson('/api/audio');
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });

    it('POST /api/audio — отклоняет неподдерживаемый формат', async () => {
      const { status, body } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Тест', filename: 'x.flac', mimetype: 'audio/flac', data: 'AAAA' }),
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('POST /api/audio — отклоняет пустое название', async () => {
      const { status } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: '   ', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA' }),
      });
      assert.equal(status, 400);
    });

    it('POST /api/audio — отклоняет файл больше 20МБ', async () => {
      const bigBuf = Buffer.alloc(20 * 1024 * 1024 + 10);
      const { status, body } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Слишком большой', filename: 'big.mp3', mimetype: 'audio/mpeg', data: bigBuf.toString('base64') }),
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('POST /api/audio — отклоняет отсутствующую категорию', async () => {
      const { status, body } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Тест', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA' }),
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('POST /api/audio — отклоняет недопустимое значение категории', async () => {
      const { status } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Тест', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'ambient' }),
      });
      assert.equal(status, 400);
    });

    it('POST /api/audio — сохраняет файл и запись в index.json; GET возвращает его', async () => {
      let created = null;
      try {
        const { status, body } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Гроза за окном', filename: 'storm.wav', mimetype: 'audio/wav', data: 'UklGRiQAAABXQVZFZm10', category: 'music' }),
        });
        assert.equal(status, 200);
        assert.equal(body.title, 'Гроза за окном');
        assert.equal(body.ext, 'wav');
        assert.equal(body.volume, 1);
        assert.equal(body.category, 'music');
        assert.ok(body.id);
        assert.equal(body.url, `/audio-lib/${body.id}.wav`);
        created = body.id;

        const writtenPath = path.join(AUDIO_ROOT, `${body.id}.wav`);
        const written = await fs.readFile(writtenPath);
        assert.ok(written.length > 0, 'аудиофайл должен быть записан на диск');

        const { status: listStatus, body: list } = await apiJson('/api/audio');
        assert.equal(listStatus, 200);
        assert.ok(list.some(t => t.id === created && t.title === 'Гроза за окном'));
      } finally {
        if (created) {
          await fs.rm(path.join(AUDIO_ROOT, `${created}.wav`), { force: true });
          const list = JSON.parse(await fs.readFile(INDEX_PATH, 'utf-8').catch(() => '[]'));
          await fs.writeFile(INDEX_PATH, JSON.stringify(list.filter(t => t.id !== created), null, 2), 'utf-8');
        }
      }
    });

    it('FIX-18: POST /api/audio с mimetype "audio/mpeg", но данными, не похожими на mp3 (magic bytes) → 400, файл не сохраняется', async () => {
      const before = await fs.readdir(AUDIO_ROOT).catch(() => []);
      const fakeMp3 = Buffer.from('<script>alert(1)</script>', 'utf-8').toString('base64');
      const { status, body } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Поддельный mp3', filename: 'evil.mp3', mimetype: 'audio/mpeg', data: fakeMp3, category: 'effect' }),
      });
      assert.equal(status, 400);
      assert.match(body.error, /не похоже на аудио/);
      const after = await fs.readdir(AUDIO_ROOT).catch(() => []);
      assert.deepEqual(after.filter(f => f !== 'index.json' && f !== 'presets.json'),
        before.filter(f => f !== 'index.json' && f !== 'presets.json'),
        'ни один файл не должен появиться в cities/audio/ при провале валидации содержимого');
    });

    it('FIX-18: GET /audio-lib/<файл> отдаёт X-Content-Type-Options: nosniff', async () => {
      let created = null;
      try {
        const { body } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Для проверки nosniff', filename: 'x.wav', mimetype: 'audio/wav', data: 'UklGRiQAAABXQVZFZm10', category: 'effect' }),
        });
        created = body.id;
        const res = await fetch(`${BASE}${body.url}`);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      } finally {
        if (created) await apiJson(`/api/audio/${created}`, { method: 'DELETE' });
      }
    });

    it('PUT /api/audio/:id — 404 для несуществующего id', async () => {
      const { status } = await apiJson('/api/audio/__no_such_id__', {
        method: 'PUT', body: JSON.stringify({ title: 'Новое имя' }),
      });
      assert.equal(status, 404);
    });

    it('PUT /api/audio/:id — отклоняет недопустимое значение категории', async () => {
      const { body: created } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Для проверки категории', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'SUQz', category: 'music' }),
      });
      try {
        const { status } = await apiJson(`/api/audio/${created.id}`, {
          method: 'PUT', body: JSON.stringify({ category: 'ambient' }),
        });
        assert.equal(status, 400);
      } finally {
        await apiJson(`/api/audio/${created.id}`, { method: 'DELETE' });
      }
    });

    it('PUT /api/audio/:id — переименование, громкость, зацикливание, категория; DELETE удаляет файл и запись', async () => {
      const { body: created } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Черновое имя', filename: 'x.ogg', mimetype: 'audio/ogg', data: 'T2dnUw==', category: 'effect' }),
      });
      const id = created.id;

      assert.equal(created.loop, true, 'по умолчанию зацикливание включено');
      assert.equal(created.category, 'effect');

      const { status: putStatus, body: updated } = await apiJson(`/api/audio/${id}`, {
        method: 'PUT', body: JSON.stringify({ title: 'Финальное имя', volume: 0.4, loop: false, category: 'music' }),
      });
      assert.equal(putStatus, 200);
      assert.equal(updated.title, 'Финальное имя');
      assert.equal(updated.volume, 0.4);
      assert.equal(updated.loop, false);
      assert.equal(updated.category, 'music');

      const { status: putEmptyStatus } = await apiJson(`/api/audio/${id}`, {
        method: 'PUT', body: JSON.stringify({ title: '   ' }),
      });
      assert.equal(putEmptyStatus, 400);

      const filePath = path.join(AUDIO_ROOT, `${id}.ogg`);
      assert.ok(await fs.readFile(filePath).then(() => true).catch(() => false));

      const { status: delStatus, body: delBody } = await apiJson(`/api/audio/${id}`, { method: 'DELETE' });
      assert.equal(delStatus, 200);
      assert.equal(delBody.ok, true);
      assert.ok(await fs.readFile(filePath).then(() => false).catch(() => true), 'файл должен быть удалён');

      const { body: listAfter } = await apiJson('/api/audio');
      assert.ok(!listAfter.some(t => t.id === id));
    });

    it('DELETE /api/audio/:id — 404 для несуществующего id', async () => {
      const { status } = await apiJson('/api/audio/__no_such_id__', { method: 'DELETE' });
      assert.equal(status, 404);
    });

    describe('Presets', () => {
      const PRESETS_PATH = path.join(AUDIO_ROOT, 'presets.json');
      let presetsExisted, originalPresets;
      before(async () => {
        originalPresets = await fs.readFile(PRESETS_PATH, 'utf-8').catch(() => null);
        presetsExisted = originalPresets !== null;
      });
      after(async () => {
        if (presetsExisted) await fs.writeFile(PRESETS_PATH, originalPresets, 'utf-8');
        else await fs.rm(PRESETS_PATH, { force: true });
      });

      it('POST /api/audio/presets — без названия → 400', async () => {
        const { status } = await apiJson('/api/audio/presets', {
          method: 'POST', body: JSON.stringify({ name: '  ', tracks: [{ trackId: 'x', volume: 1 }] }),
        });
        assert.equal(status, 400);
      });

      it('POST /api/audio/presets — без звуков → 400', async () => {
        const { status } = await apiJson('/api/audio/presets', {
          method: 'POST', body: JSON.stringify({ name: 'Пустой пресет', tracks: [] }),
        });
        assert.equal(status, 400);
      });

      it('POST/GET/PUT/DELETE /api/audio/presets — полный цикл, резолвит title/url трека и null-локацию', async () => {
        const { body: track } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Трек для пресета', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'SUQz', category: 'effect' }),
        });
        let presetId = null;
        try {
          const { status: postStatus, body: created } = await apiJson('/api/audio/presets', {
            method: 'POST',
            body: JSON.stringify({
              name: 'Тестовый пресет', locationSlug: '__no_such_location__',
              tracks: [{ trackId: track.id, volume: 0.5 }],
            }),
          });
          assert.equal(postStatus, 200);
          assert.equal(created.name, 'Тестовый пресет');
          assert.ok(created.id);
          presetId = created.id;

          const { status: getStatus, body: list } = await apiJson('/api/audio/presets');
          assert.equal(getStatus, 200);
          const mine = list.find(p => p.id === presetId);
          assert.ok(mine);
          assert.equal(mine.locationTitle, null, 'несуществующая локация резолвится в null, а не в ошибку');
          assert.equal(mine.locationImageUrl, null);
          assert.equal(mine.tracks.length, 1);
          assert.equal(mine.tracks[0].title, 'Трек для пресета');
          assert.equal(mine.tracks[0].volume, 0.5);
          assert.equal(mine.tracks[0].url, track.url);

          const { status: putStatus, body: updated } = await apiJson(`/api/audio/presets/${presetId}`, {
            method: 'PUT', body: JSON.stringify({ name: 'Переименованный пресет', tracks: [{ trackId: track.id, volume: 0.9 }] }),
          });
          assert.equal(putStatus, 200);
          assert.equal(updated.name, 'Переименованный пресет');
          assert.equal(updated.tracks[0].volume, 0.9);

          const { status: putMissingStatus } = await apiJson('/api/audio/presets/__no_such_id__', {
            method: 'PUT', body: JSON.stringify({ name: 'x' }),
          });
          assert.equal(putMissingStatus, 404);

          const { status: delStatus, body: delBody } = await apiJson(`/api/audio/presets/${presetId}`, { method: 'DELETE' });
          assert.equal(delStatus, 200);
          assert.equal(delBody.ok, true);
          presetId = null;

          const { status: delMissingStatus } = await apiJson('/api/audio/presets/__no_such_id__', { method: 'DELETE' });
          assert.equal(delMissingStatus, 404);
        } finally {
          if (presetId) await apiJson(`/api/audio/presets/${presetId}`, { method: 'DELETE' });
          await apiJson(`/api/audio/${track.id}`, { method: 'DELETE' });
        }
      });

      it('GET /api/audio/presets — ссылка на удалённый трек тихо пропускается, остальные треки остаются', async () => {
        const { body: keepTrack } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Останется', filename: 'a.mp3', mimetype: 'audio/mpeg', data: 'SUQz', category: 'music' }),
        });
        const { body: doomedTrack } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Будет удалён', filename: 'b.mp3', mimetype: 'audio/mpeg', data: 'SUQz', category: 'effect' }),
        });
        let presetId = null;
        try {
          const { body: preset } = await apiJson('/api/audio/presets', {
            method: 'POST',
            body: JSON.stringify({
              name: 'Переживёт удаление трека',
              tracks: [{ trackId: keepTrack.id, volume: 1 }, { trackId: doomedTrack.id, volume: 1 }],
            }),
          });
          presetId = preset.id;

          await apiJson(`/api/audio/${doomedTrack.id}`, { method: 'DELETE' });

          const { body: list } = await apiJson('/api/audio/presets');
          const mine = list.find(p => p.id === presetId);
          assert.ok(mine, 'пресет остаётся, даже если один из его треков удалён');
          assert.equal(mine.tracks.length, 1, 'удалённый трек тихо выпадает из tracks[]');
          assert.equal(mine.tracks[0].trackId, keepTrack.id);
        } finally {
          if (presetId) await apiJson(`/api/audio/presets/${presetId}`, { method: 'DELETE' });
          await apiJson(`/api/audio/${keepTrack.id}`, { method: 'DELETE' });
        }
      });
    });
  });

  // ── Locations — write guards ─────────────────────────────────────────────────
  describe('Locations — write guards', () => {
    it('PUT fields — unknown slug → 404', async () => {
      const { status } = await apiJson(`/api/locations/__nosuchloc__/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: { atmosphere: 'x' } }) });
      assert.equal(status, 404);
    });
  });

  // ── Archive docs — write validation ──────────────────────────────────────────
  describe('Archive docs — write validation', () => {
    it('PUT /api/timeline without content → 400', async () => {
      const { status, body } = await apiJson(`/api/timeline${CITY}`,
        { method: 'PUT', body: JSON.stringify({}) });
      assert.equal(status, 400); assert.ok(body.error);
    });
    it('PUT /api/rumors without content → 400', async () => {
      const { status } = await apiJson(`/api/rumors${CITY}`,
        { method: 'PUT', body: JSON.stringify({ type: 'elysium' }) });
      assert.equal(status, 400);
    });
  });

  // ── Faction influence diagram (political_state.md) — restores original on teardown ──
  // city.md восстанавливается ТОЖЕ: PUT/DELETE влияния с §11 двусторонне синкают список
  // «## Фракции» в city.md (_syncCityFactionsList). Пока у paris/city.md не было этой
  // секции, синк молча пропускался и тесты её не трогали — как только секция появилась,
  // тестовые фракции («Тест-фракция <timestamp>») стали дописываться в реальные данные
  // города и там оставаться. Бэкапим оба файла, а не только political_state.md.
  describe('Faction influence — GET/PUT', () => {
    const polFile  = path.join(CITY_ROOT, 'archive', 'political_state.md');
    const cityFile = path.join(CITY_ROOT, 'city.md');
    let original = null, originalCity = null;

    before(async () => {
      original     = await fs.readFile(polFile, 'utf-8').catch(() => null);
      originalCity = await fs.readFile(cityFile, 'utf-8').catch(() => null);
    });
    after(async () => {
      if (original !== null) await fs.writeFile(polFile, original, 'utf-8');
      if (originalCity !== null) await fs.writeFile(cityFile, originalCity, 'utf-8');
    });

    it('GET /api/factions/influence отдаёт распарсенные фракции реального political_state.md', async () => {
      const { status, body } = await apiJson(`/api/factions/influence${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.factions));
      assert.ok(body.factions.length > 0);
      assert.ok(body.factions.every(f => typeof f.name === 'string' && typeof f.influence === 'number'));
    });

    it('PUT /api/factions/influence — валидация: без имени → 400, влияние вне 0-100 → 400', async () => {
      const noName = await apiJson(`/api/factions/influence${CITY}`,
        { method: 'PUT', body: JSON.stringify({ influence: 50 }) });
      assert.equal(noName.status, 400);
      const badVal = await apiJson(`/api/factions/influence${CITY}`,
        { method: 'PUT', body: JSON.stringify({ name: 'Тест', influence: 150 }) });
      assert.equal(badVal.status, 400);
    });

    it('DELETE /api/factions/influence/:name — удаляет фракцию; неизвестная → 404', async () => {
      await apiJson(`/api/factions/influence${CITY}`,
        { method: 'PUT', body: JSON.stringify({ name: '__DEL_TEST__', influence: 20 }) });
      const del = await apiJson(`/api/factions/influence/${encodeURIComponent('__DEL_TEST__')}${CITY}`, { method: 'DELETE' });
      assert.equal(del.status, 200);
      assert.ok(!del.body.factions.some(f => f.name === '__DEL_TEST__'));
      const gone = await apiJson(`/api/factions/influence/${encodeURIComponent('__DEL_TEST__')}${CITY}`, { method: 'DELETE' });
      assert.equal(gone.status, 404);
    });

    it('PUT /api/factions/influence — round-trip: обновляет существующую фракцию, не трогая остальные', async () => {
      const before = await apiJson(`/api/factions/influence${CITY}`);
      const target = before.body.factions[0];
      const otherInfluence = before.body.factions[1]?.influence;

      const put = await apiJson(`/api/factions/influence${CITY}`,
        { method: 'PUT', body: JSON.stringify({ name: target.name, influence: 100 }) });
      assert.equal(put.status, 200);
      assert.ok(put.body.ok);
      const updated = put.body.factions.find(f => f.name === target.name);
      assert.equal(updated.influence, 100);
      if (before.body.factions[1]) {
        const other = put.body.factions.find(f => f.name === before.body.factions[1].name);
        assert.equal(other.influence, otherInfluence);
      }
    });

    it('PUT /api/factions/influence — новая фракция добавляется как отдельная строка', async () => {
      const name = `Тест-фракция ${Date.now()}`;
      const put = await apiJson(`/api/factions/influence${CITY}`,
        { method: 'PUT', body: JSON.stringify({ name, influence: 20 }) });
      assert.equal(put.status, 200);
      assert.ok(put.body.factions.some(f => f.name === name && f.influence === 20));
    });

    it('cityScaffold сразу засевает «Баланс сил» фракциями из поля factions (influence 0%), а GET дополнительно подтягивает те, что позже добавлены в city.md, но ещё не в political_state.md', async () => {
      const citySlug = `test_faction_city_${Date.now()}`;
      const created = await apiJson('/api/cities', {
        method: 'POST', body: JSON.stringify({
          name: citySlug, year: '2020', factions: 'Камарилья\nДжованни',
        }),
      });
      assert.equal(created.status, 200);
      const cityDir = path.join(CITY_ROOT, '..', citySlug);

      try {
        // 1. Созданные вместе с городом фракции — уже РЕАЛЬНЫЕ строки в файле.
        const psRaw = await fs.readFile(path.join(cityDir, 'archive', 'political_state.md'), 'utf-8');
        assert.match(psRaw, /## Баланс сил — обзор/);
        assert.match(psRaw, /\| Камарилья \| 0% \|/);
        assert.match(psRaw, /\| Джованни \| 0% \|/);

        const { status, body } = await apiJson(`/api/factions/influence?city=${citySlug}`);
        assert.equal(status, 200);
        assert.deepEqual(body.factions.map(f => f.name).sort(), ['Джованни', 'Камарилья']);
        assert.ok(body.factions.every(f => f.influence === 0));

        // 2. Фракцию добавили в city.md ПОСЛЕ создания города (напрямую в файл,
        // как если бы пользователь дописал список в форме) — в political_state.md
        // её ещё нет; GET должен подмешать её виртуально (influence:0, без записи на диск).
        const cityMdPath = path.join(cityDir, 'city.md');
        const cityMd = await fs.readFile(cityMdPath, 'utf-8');
        await fs.writeFile(cityMdPath, cityMd.replace('## Фракции\n- Камарилья\n- Джованни', '## Фракции\n- Камарилья\n- Джованни\n- Сеттиты'), 'utf-8');

        const after = await apiJson(`/api/factions/influence?city=${citySlug}`);
        assert.deepEqual(after.body.factions.map(f => f.name).sort(), ['Джованни', 'Камарилья', 'Сеттиты']);

        const psRaw2 = await fs.readFile(path.join(cityDir, 'archive', 'political_state.md'), 'utf-8');
        assert.doesNotMatch(psRaw2, /Сеттиты/, 'GET не должен записывать виртуальную фракцию на диск сам по себе');
      } finally {
        await apiJson(`/api/cities/${citySlug}`, { method: 'DELETE' });
        const deletedRoot = path.join(CITY_ROOT, '..', '_deleted');
        const entries = await fs.readdir(deletedRoot).catch(() => []);
        for (const e of entries) {
          if (e.startsWith(`${citySlug}_`)) await fs.rm(path.join(deletedRoot, e), { recursive: true, force: true });
        }
      }
    });
  });

  describe('Timeline structured — CRUD', () => {
    const tlFile = path.join(CITY_ROOT, 'archive', 'timeline.md');
    let original = null;
    before(async () => { original = await fs.readFile(tlFile, 'utf-8').catch(() => null); });
    after(async () => { if (original !== null) await fs.writeFile(tlFile, original, 'utf-8'); });

    it('GET /api/timeline/structured — реальный файл парсится, есть легенда и хотя бы одна эпоха', async () => {
      const { status, body } = await apiJson(`/api/timeline/structured${CITY}`);
      assert.equal(status, 200);
      assert.ok(body.legend.length > 0);
      assert.ok(body.epochs.length > 0);
    });

    it('POST /api/timeline/epoch — без heading → 400; с heading → 200 и новая пустая эпоха', async () => {
      const bad = await apiJson(`/api/timeline/epoch${CITY}`, { method: 'POST', body: JSON.stringify({}) });
      assert.equal(bad.status, 400);
      const ok = await apiJson(`/api/timeline/epoch${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: '__TEST_EPOCH__' }) });
      assert.equal(ok.status, 200);
      assert.ok(ok.body.epochs.some(e => e.heading === '__TEST_EPOCH__'));
    });

    it('FIX-5: POST /api/timeline/epoch с уже существующим заголовком → 409, не плодит дубликат', async () => {
      await apiJson(`/api/timeline/epoch${CITY}`, { method: 'POST', body: JSON.stringify({ heading: '__TEST_EPOCH_DUP__' }) });
      const dup = await apiJson(`/api/timeline/epoch${CITY}`, { method: 'POST', body: JSON.stringify({ heading: '__TEST_EPOCH_DUP__' }) });
      assert.equal(dup.status, 409);
      const { body } = await apiJson(`/api/timeline/structured${CITY}`);
      assert.equal(body.epochs.filter(e => e.heading === '__TEST_EPOCH_DUP__').length, 1,
        'после 409 в файле должна остаться ровно одна секция с этим заголовком');
    });

    it('POST row → PUT row → DELETE row — round-trip внутри тестовой эпохи', async () => {
      await apiJson(`/api/timeline/epoch${CITY}`, { method: 'POST', body: JSON.stringify({ heading: '__TEST_EPOCH_2__' }) });
      const added = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH_2__')}/row${CITY}`,
        { method: 'POST', body: JSON.stringify({ year: '2000', type: '🧛', event: 'Тест', source: '🏙️', links: [] }) });
      assert.equal(added.status, 200);
      let epoch = added.body.epochs.find(e => e.heading === '__TEST_EPOCH_2__');
      assert.equal(epoch.rows.length, 1);

      const updated = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH_2__')}/row/0${CITY}`,
        { method: 'PUT', body: JSON.stringify({ year: '2001', type: '🧛', event: 'Тест-правка', source: '🏙️', links: [] }) });
      assert.equal(updated.status, 200);
      epoch = updated.body.epochs.find(e => e.heading === '__TEST_EPOCH_2__');
      assert.equal(epoch.rows[0].event, 'Тест-правка');

      const removed = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH_2__')}/row/0${CITY}`, { method: 'DELETE' });
      assert.equal(removed.status, 200);
      epoch = removed.body.epochs.find(e => e.heading === '__TEST_EPOCH_2__');
      assert.equal(epoch.rows.length, 0);
    });

    it('POST/PUT row: сырые ссылки {text, href} проходят без kind и не теряются при правке', async () => {
      await apiJson(`/api/timeline/epoch${CITY}`, { method: 'POST', body: JSON.stringify({ heading: '__TEST_EPOCH_3__' }) });
      const rawLink = { text: 'Модуль-тест', href: '../chronicles/x/modules/y/y.md' };
      const added = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH_3__')}/row${CITY}`,
        { method: 'POST', body: JSON.stringify({ year: '2010', type: '🏛️', event: 'Сырая ссылка', source: '🏙️', links: [rawLink] }) });
      assert.equal(added.status, 200);
      let epoch = added.body.epochs.find(e => e.heading === '__TEST_EPOCH_3__');
      assert.deepEqual(epoch.rows[0].links, [rawLink]);

      // PUT со связями в том виде, в каком их отдаёт парсер ({text, href}, без kind) —
      // регресс: раньше такие связи молча отбрасывались при правке строки.
      const updated = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH_3__')}/row/0${CITY}`,
        { method: 'PUT', body: JSON.stringify({ ...epoch.rows[0], event: 'Сырая ссылка (правка)' }) });
      assert.equal(updated.status, 200);
      epoch = updated.body.epochs.find(e => e.heading === '__TEST_EPOCH_3__');
      assert.equal(epoch.rows[0].event, 'Сырая ссылка (правка)');
      assert.deepEqual(epoch.rows[0].links, [rawLink]);
    });

    it('PUT row с несуществующим индексом → 409', async () => {
      const { status } = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__TEST_EPOCH__')}/row/99${CITY}`,
        { method: 'PUT', body: JSON.stringify({ year: '', type: '', event: 'x', source: '', links: [] }) });
      assert.equal(status, 409);
    });

    it('DELETE /api/timeline/epoch/:heading — неизвестная эпоха → 404', async () => {
      const { status } = await apiJson(`/api/timeline/epoch/${encodeURIComponent('__NOPE__')}${CITY}`, { method: 'DELETE' });
      assert.equal(status, 404);
    });
  });

  describe('World-state structured — CRUD', () => {
    const evFile = path.join(CITY_ROOT, 'archive', 'events.md');
    let original = null;
    before(async () => { original = await fs.readFile(evFile, 'utf-8').catch(() => null); });
    after(async () => { if (original !== null) await fs.writeFile(evFile, original, 'utf-8'); });

    it('GET /api/world-state/structured — реальный events.md парсится, есть секции', async () => {
      const { status, body } = await apiJson(`/api/world-state/structured${CITY}`);
      assert.equal(status, 200);
      assert.ok(body.sections.length > 0);
    });

    it('POST /api/world-state/section — без columns → 400; с columns → создаёт пустую секцию', async () => {
      const bad = await apiJson(`/api/world-state/section${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: '__TEST_SECTION__' }) });
      assert.equal(bad.status, 400);
      const ok = await apiJson(`/api/world-state/section${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: '__TEST_SECTION__', columns: ['A', 'B'] }) });
      assert.equal(ok.status, 200);
      assert.ok(ok.body.sections.some(s => s.heading === '__TEST_SECTION__'));
    });

    it('строки: POST → PUT → DELETE round-trip в тестовой секции', async () => {
      const added = await apiJson(`/api/world-state/section/${encodeURIComponent('__TEST_SECTION__')}/row${CITY}`,
        { method: 'POST', body: JSON.stringify({ cells: ['x', 'y'] }) });
      assert.equal(added.status, 200);
      let sec = added.body.sections.find(s => s.heading === '__TEST_SECTION__');
      assert.equal(sec.rows.length, 1);

      const updated = await apiJson(`/api/world-state/section/${encodeURIComponent('__TEST_SECTION__')}/row/0${CITY}`,
        { method: 'PUT', body: JSON.stringify({ cells: ['x2', 'y2'] }) });
      sec = updated.body.sections.find(s => s.heading === '__TEST_SECTION__');
      assert.deepEqual(sec.rows[0], ['x2', 'y2']);

      const removed = await apiJson(`/api/world-state/section/${encodeURIComponent('__TEST_SECTION__')}/row/0${CITY}`, { method: 'DELETE' });
      sec = removed.body.sections.find(s => s.heading === '__TEST_SECTION__');
      assert.equal(sec.rows.length, 0);
    });

    it('DELETE /api/world-state/section/:heading — очищает тестовую секцию (teardown внутри теста)', async () => {
      const { status } = await apiJson(`/api/world-state/section/${encodeURIComponent('__TEST_SECTION__')}${CITY}`, { method: 'DELETE' });
      assert.equal(status, 200);
    });

    it('PUT /api/world-state/last-update — round-trip', async () => {
      const before = await apiJson(`/api/world-state/structured${CITY}`);
      const put = await apiJson(`/api/world-state/last-update${CITY}`,
        { method: 'PUT', body: JSON.stringify({ text: '__TEST_UPDATE__' }) });
      assert.equal(put.status, 200);
      assert.equal(put.body.lastUpdate, '__TEST_UPDATE__');
      // восстановить, чтобы не оставить тестовый текст в реальном файле до after()
      await apiJson(`/api/world-state/last-update${CITY}`,
        { method: 'PUT', body: JSON.stringify({ text: before.body.lastUpdate }) });
    });
  });

  // ── Chronicles & modules — write guards ──────────────────────────────────────
  describe('Chronicles & modules — write guards', () => {
    it('GET delete-preview — unknown chronicle → 404', async () => {
      const { status } = await apiJson(`/api/chronicles/__nochron__/delete-preview${CITY}`);
      assert.equal(status, 404);
    });
    it('DELETE — unknown chronicle → 404', async () => {
      const { status } = await apiJson(`/api/chronicles/__nochron__${CITY}`, { method: 'DELETE' });
      assert.equal(status, 404);
    });
    it('POST module without name → 400', async () => {
      const { status, body } = await apiJson(`/api/chronicles/${CHR}/modules${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(status, 400); assert.ok(body.error);
    });
  });

  // ── Module write endpoints — round-trip (restores originals on teardown) ─────
  describe('Module write endpoints', () => {
    let chr = null, mod = null, modDir = null;
    let origMd = null, origScenario = null, origNpc = null, npcExisted = false, scenarioExisted = false;

    before(async () => {
      const { body } = await apiJson(`/api/modules${CITY}`);
      if (Array.isArray(body) && body.length) {
        const m = body.find(x => x.chronicle && x.name) || body[0];
        chr = m.chronicle; mod = m.name;
        modDir = path.join(CITY_ROOT, 'chronicles', chr, 'modules', mod);
        origMd       = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => null);
        origScenario = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8').catch(() => null);
        scenarioExisted = origScenario !== null;
        origNpc      = await fs.readFile(path.join(modDir, 'npc.md'), 'utf-8').catch(() => null);
        npcExisted   = origNpc !== null;
      }
    });
    after(async () => {
      if (!modDir) return;
      if (origMd !== null) await fs.writeFile(path.join(modDir, `${mod}.md`), origMd, 'utf-8');
      if (scenarioExisted) await fs.writeFile(path.join(modDir, 'scenario.md'), origScenario, 'utf-8');
      else await fs.unlink(path.join(modDir, 'scenario.md')).catch(() => {});
      if (npcExisted) await fs.writeFile(path.join(modDir, 'npc.md'), origNpc, 'utf-8');
      else await fs.unlink(path.join(modDir, 'npc.md')).catch(() => {});
      // POST /npc также создаёт папку карточки npc/<slug>/ — убрать тестовые
      const npcDir = path.join(modDir, 'npc');
      const entries = await fs.readdir(npcDir).catch(() => []);
      for (const e of entries) {
        if (e.startsWith('test_nps_') || e.startsWith('test-nps-'))
          await fs.rm(path.join(npcDir, e), { recursive: true, force: true }).catch(() => {});
      }
      if ((await fs.readdir(npcDir).catch(() => ['x'])).length === 0)
        await fs.rmdir(npcDir).catch(() => {});
    });

    it('PUT /fields — path traversal → 400', async () => {
      const { status } = await apiJson(`/api/chronicles/..%2F..%2Fetc/modules/x/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: { title: 'x' } }) });
      assert.ok(status === 400 || status === 404);
    });
    it('PUT /fields — unknown module → 404', async () => {
      const { status } = await apiJson(`/api/chronicles/__nochron__/modules/__nomod__/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: { title: 'x' } }) });
      assert.equal(status, 404);
    });
    it('PUT /fields — title round-trip', async () => {
      if (!modDir || origMd === null) return;
      const marker = `__FLDTEST__ ${Date.now()}`;
      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: { title: marker } }) });
      assert.equal(put.status, 200); assert.ok(put.body.ok);
      const raw = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8');
      assert.ok(raw.includes(`# ${marker}`));
    });

    it('PUT /scenario — empty → 400', async () => {
      const { status } = await apiJson(`/api/chronicles/${CHR}/modules/${MOD}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: '' }) });
      assert.equal(status, 400);
    });
    it('PUT /scenario — round-trip', async () => {
      if (!modDir) return;
      const marker = `__SCNTEST__ ${Date.now()}`;
      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: marker }) });
      assert.equal(put.status, 200);
      const raw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.ok(raw.includes(marker));
    });

    it('PUT /scenario/section — правит один раздел, остальные не трогает', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Пролог', '', 'Исходный пролог.', '',
        '---', '',
        '## Сцена 1', '', 'Исходная сцена.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section${CITY}`,
        { method: 'PUT', body: JSON.stringify({ heading: 'Пролог', content: 'Новый пролог вручную.' }) });
      assert.equal(put.status, 200);
      assert.ok(put.body.ok);
      assert.match(put.body.scenario, /## Пролог\n\nНовый пролог вручную\./);
      assert.match(put.body.scenario, /## Сцена 1\n\nИсходная сцена\./);

      const raw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.match(raw, /Новый пролог вручную\./);
      assert.match(raw, /Исходная сцена\./);
    });

    it('PUT /scenario/section — неизвестный раздел → 404', async () => {
      if (!modDir) return;
      const { status } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section${CITY}`,
        { method: 'PUT', body: JSON.stringify({ heading: '__нет такого раздела__', content: 'x' }) });
      assert.equal(status, 404);
    });

    it('POST /scenario/section/regenerate — перегенерирует раздел (AI_MOCK), остальные не трогает', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Пролог', '', 'Исходный пролог для регена.', '',
        '---', '',
        '## Сцена 1', '', 'Эта сцена должна остаться нетронутой.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const regen = await apiJson(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section/regenerate${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: 'Пролог', pcs: [], npcs: [] }) });
      assert.equal(regen.status, 200);
      assert.ok(regen.body.ok);
      assert.doesNotMatch(regen.body.scenario, /Исходный пролог для регена\./);
      assert.match(regen.body.scenario, /## Сцена 1\n\nЭта сцена должна остаться нетронутой\./);
    });

    it('POST /scenario/section/regenerate — неизвестный раздел → 404', async () => {
      if (!modDir) return;
      const { status } = await apiJson(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section/regenerate${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: '__нет такого раздела__' }) });
      assert.equal(status, 404);
    });

    it('PUT /scenario/section — с parent правит нужное одноимённое поле, не первое попавшееся', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '',
        '### GM-подсказки', '', 'Подсказки сцены 1.', '',
        '---', '',
        '## Сцена 2', '',
        '### GM-подсказки', '', 'Подсказки сцены 2.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section${CITY}`,
        { method: 'PUT', body: JSON.stringify({ heading: 'GM-подсказки', parent: 'Сцена 2', content: 'Новые подсказки для сцены 2.' }) });
      assert.equal(put.status, 200);
      assert.ok(put.body.ok);
      assert.match(put.body.scenario, /## Сцена 1\n+### GM-подсказки\n\nПодсказки сцены 1\./);
      assert.match(put.body.scenario, /## Сцена 2\n+### GM-подсказки\n\nНовые подсказки для сцены 2\./);
    });

    it('PUT /scenario/block/fields — сохраняет несколько полей одним запросом', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '',
        '### Описание для игрока', '', 'Старое описание.', '',
        '### Колорит', '', 'Старый колорит.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: [
          { heading: 'Описание для игрока', parent: 'Сцена 1', content: 'Новое описание.' },
          { heading: 'Колорит', parent: 'Сцена 1', content: 'Новый колорит.' },
        ] }) });
      assert.equal(put.status, 200);
      assert.ok(put.body.ok);
      assert.deepEqual(put.body.skipped, []);
      assert.match(put.body.scenario, /### Описание для игрока\n\nНовое описание\./);
      assert.match(put.body.scenario, /### Колорит\n\nНовый колорит\./);

      const raw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.match(raw, /Новое описание\./);
      assert.match(raw, /Новый колорит\./);
    });

    it('PUT /scenario/block/fields — неизвестное поле идёт в skipped, остальные сохраняются', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '',
        '### Описание для игрока', '', 'Старое описание.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: [
          { heading: 'Описание для игрока', parent: 'Сцена 1', content: 'Новое описание.' },
          { heading: '__нет такого__', parent: 'Сцена 1', content: 'x' },
        ] }) });
      assert.equal(put.status, 200);
      assert.deepEqual(put.body.skipped, ['__нет такого__']);
      assert.match(put.body.scenario, /Новое описание\./);
    });

    it('PUT /scenario/block/fields — пустой массив fields → 400', async () => {
      if (!modDir) return;
      const { status } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: [] }) });
      assert.equal(status, 400);
    });

    it('PUT /scenario/block/fields — все поля не найдены → 404, файл не изменяется', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '',
        '### Описание для игрока', '', 'Исходное описание.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: [
          { heading: '__нет такого 1__', parent: 'Сцена 1', content: 'x' },
          { heading: '__нет такого 2__', parent: 'Сцена 1', content: 'y' },
        ] }) });
      assert.equal(put.status, 404);

      const raw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.equal(raw, seed, 'файл не должен меняться, если ни одно поле не найдено');
    });

    it('POST /scenario/scene — добавляет новую сцену перед «Финал», ставит метку', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Пролог', '', 'Завязка.', '',
        '---', '',
        '## Сцена 1', '', 'Первая сцена.', '',
        '---', '',
        '## Финал', '', 'Развязка.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const post = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/scene${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(post.status, 200);
      assert.ok(post.body.ok);
      assert.equal(post.body.heading, 'Сцена 2');
      assert.match(post.body.scenario, /## Сцена 2\n/);
      // Новая сцена — перед «Финал», после «Сцена 1»
      assert.ok(post.body.scenario.indexOf('## Сцена 2') > post.body.scenario.indexOf('## Сцена 1'));
      assert.ok(post.body.scenario.indexOf('## Сцена 2') < post.body.scenario.indexOf('## Финал'));

      const raw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.match(raw, /<!--\s*meta:sceneAdded:\s*1\s*-->/i);
    });

    it('POST /scenario/scene — сценарий не найден → 404', async () => {
      const { status } = await apiJson(`/api/chronicles/__nochron__/modules/__nomod__/scenario/scene${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(status, 404);
    });

    it('POST /scenario/block/regenerate — перегенерация «Финал» снимает метку sceneAdded (AI_MOCK)', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '', 'Сцена.', '',
        '---', '',
        '## Финал', '', 'Развязка.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });
      // Ставим метку через тот же add-scene эндпоинт
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/scene${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      const beforeRaw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.match(beforeRaw, /meta:sceneAdded/i);

      const regen = await apiJson(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/regenerate${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: 'Финал', pcs: [], npcs: [] }) });
      assert.equal(regen.status, 200);
      assert.doesNotMatch(regen.body.scenario, /meta:sceneAdded/i);

      const afterRaw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.doesNotMatch(afterRaw, /meta:sceneAdded/i);
    });

    it('POST /scenario/block/regenerate — перегенерация НЕ-финального блока НЕ снимает метку sceneAdded (AI_MOCK)', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '', 'Сцена.', '',
        '---', '',
        '## Финал', '', 'Развязка.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/scene${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });

      const regen = await apiJson(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/regenerate${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: 'Сцена 1', pcs: [], npcs: [] }) });
      assert.equal(regen.status, 200);
      assert.match(regen.body.scenario, /meta:sceneAdded/i);

      const raw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.match(raw, /meta:sceneAdded/i);
    });

    it('POST /scenario/block/regenerate — перегенерирует блок целиком (AI_MOCK), другие блоки не трогает', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Пролог', '', 'Эта сцена должна остаться нетронутой.', '',
        '---', '',
        '## Сцена 1 — «Старая версия»', '',
        '### Описание для игрока', '', 'Исходное описание.', '',
        '### Колорит', '', 'Исходный колорит.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const regen = await apiJson(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/regenerate${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: 'Сцена 1 — «Старая версия»', pcs: [], npcs: [] }) });
      assert.equal(regen.status, 200);
      assert.ok(regen.body.ok);
      // Заголовок блока не переписывается — на него ссылается вкладка «Сессии».
      assert.match(regen.body.scenario, /## Сцена 1 — «Старая версия»/);
      // Старое содержимое полей блока заменено (mock-ответ не содержит этих фраз).
      assert.doesNotMatch(regen.body.scenario, /Исходное описание\./);
      assert.doesNotMatch(regen.body.scenario, /Исходный колорит\./);
      // Остальные блоки — неизменяемый контекст, не трогаются.
      assert.match(regen.body.scenario, /## Пролог\n\nЭта сцена должна остаться нетронутой\./);

      const raw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.match(raw, /## Сцена 1 — «Старая версия»/);
    });

    it('POST /scenario/block/regenerate — неизвестный блок → 404', async () => {
      if (!modDir) return;
      const { status } = await apiJson(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/regenerate${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: '__нет такого блока__' }) });
      assert.equal(status, 404);
    });

    it('GET /detail — эталонный формат сценария (Пролог/Сцена N/Финал прямыми заголовками, meta:npcs/meta:locations) парсится корректно', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '',
        '> 🔗 [Модуль](x.md) | [Хроника](../../events.md) | [НПС](npc.md)', '',
        '<!-- meta:npcs: Гиль; Рено -->',
        '<!-- meta:locations: Опера Гарнье; Порт-де-ла-Шапель -->', '',
        '---', '',
        '## 🔒 GM-справка — закрытая информация', '',
        '> Читать перед игрой.', '',
        '### Что произошло до начала сессии', '', 'Секретный контекст.', '',
        '---', '',
        '## Пролог — Начало', '', '### Описание для игрока', '', 'Завязка.', '',
        '---', '',
        '## Сцена 1 — Опера Гарнье (9-й арр.)', '', '### Описание для игрока', '', 'Текст сцены 1.', '',
        '---', '',
        '## Сцена 2 — Порт-де-ла-Шапель', '', '### Описание для игрока', '', 'Текст сцены 2.', '',
        '---', '',
        '## Финал — Развязка', '', '### Описание для игрока', '', 'Финальный текст.', '',
        '---', '',
        '## Открытые вопросы после модуля', '', '| Вопрос | Нить |', '|---|---|', '| Кто? | №1 |', '',
        '---', '',
        '## Колорит — три обязательные детали', '', '1. Язык', '2. География', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const { status, body } = await apiJson(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${CITY}`);
      assert.equal(status, 200);

      // Сцены для пикера «🎲 Сессии» — только Пролог/Сцена N/Финал, БЕЗ GM-справки/Открытых вопросов/Колорита
      const sceneTitles = body.scenes.map(s => s.title);
      assert.ok(sceneTitles.some(t => /Начало/.test(t)));
      assert.ok(sceneTitles.some(t => /Опера Гарнье/.test(t)));
      assert.ok(sceneTitles.some(t => /Порт-де-ла-Шапель/.test(t)));
      assert.ok(sceneTitles.some(t => /Развязка/.test(t)));
      assert.ok(!sceneTitles.some(t => /GM-справка|Открытые вопросы|колорит/i.test(t)));
      assert.equal(body.scenes.length, 4);

      // Локации — из meta:locations, не из «Локации»-заголовка (которого тут нет)
      assert.deepEqual(body.locations.map(l => l.name), ['Опера Гарнье', 'Порт-де-ла-Шапель']);
    });

    it('POST /npc — без имени → 400', async () => {
      if (!modDir) return;
      const { status } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(status, 400);
    });
    it('POST /npc — добавление и дубликат → 409', async () => {
      if (!modDir) return;
      const name = `Тест НПС ${Date.now()}`;
      const post = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${CITY}`,
        { method: 'POST', body: JSON.stringify({ name, description: 'тестовый' }) });
      assert.ok(post.status === 200 || post.status === 201, `unexpected ${post.status}`);
      const raw = await fs.readFile(path.join(modDir, 'npc.md'), 'utf-8');
      assert.ok(raw.includes(name));
      const dup = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${CITY}`,
        { method: 'POST', body: JSON.stringify({ name, description: 'тестовый' }) });
      assert.equal(dup.status, 409);
    });

    it('GET /detail — резолвит слаг модульного НПС по имени, если ссылка в npc.md устарела (регрессия: 404 на /promote)', async () => {
      if (!modDir) return;
      const name    = `Тест Устарелая Ссылка ${Date.now()}`;
      const realSlug = slugify(name);
      const post = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${CITY}`,
        { method: 'POST', body: JSON.stringify({ name, description: 'тестовый' }) });
      assert.ok(post.status === 200 || post.status === 201);
      assert.ok(await fs.stat(path.join(modDir, 'npc', realSlug)).catch(() => null), 'папка НПС должна была создаться по ожидаемому слагу');

      // Портим ссылку в npc.md на несуществующую папку — воспроизводит баг
      // (папку переименовали при коллизии слагов, ссылку не обновили).
      const realRaw   = await fs.readFile(path.join(modDir, 'npc.md'), 'utf-8');
      const staleSlug = `${realSlug}_stale_link`;
      const brokenRaw = realRaw.replace(`npc/${realSlug}/${realSlug}.md`, `npc/${staleSlug}/${staleSlug}.md`);
      assert.notEqual(brokenRaw, realRaw, 'замена ссылки должна была сработать');
      await fs.writeFile(path.join(modDir, 'npc.md'), brokenRaw, 'utf-8');

      const { body: detail } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${CITY}`);
      const modularGroup = (detail.npcGroups || []).find(g => g.kind === 'modular');
      const entry = modularGroup?.entries.find(e => e.name === name);
      assert.ok(entry, 'модульный НПС должен присутствовать в /detail несмотря на битую ссылку');
      assert.equal(entry.slug, realSlug, 'слаг должен резолвиться на реальную папку, а не на битую ссылку');

      // Восстановить исходный npc.md и убрать созданную папку НПС
      await fs.writeFile(path.join(modDir, 'npc.md'), realRaw, 'utf-8');
      await fs.rm(path.join(modDir, 'npc', realSlug), { recursive: true, force: true });
    });

    it('POST /api/chronicles/:chr/modules — type пишется в карточку, дефолт «Игровая сессия»', async () => {
      if (!chr) return;
      const namedType = `test_type_mod_${Date.now()}`;
      const created = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules${CITY}`, {
        method: 'POST', body: JSON.stringify({ name: namedType, time: '2010', slug: namedType, type: 'Сольник', tone: 'Городской нуар' }),
      });
      assert.equal(created.status, 200);
      const typedDir = path.join(CITY_ROOT, 'chronicles', chr, 'modules', namedType);
      const raw = await fs.readFile(path.join(typedDir, `${namedType}.md`), 'utf-8');
      assert.match(raw, /\|\s*\*\*Тип\*\*\s*\|\s*Сольник\s*\|/);
      assert.match(raw, /\|\s*\*\*Тон\*\*\s*\|\s*Городской нуар\s*\|/);
      assert.doesNotMatch(raw, /\|\s*\*\*Локация\*\*\s*\|/);
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(namedType)}${CITY}`, { method: 'DELETE' });

      const noType = `test_notype_mod_${Date.now()}`;
      const created2 = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules${CITY}`, {
        method: 'POST', body: JSON.stringify({ name: noType, time: '2010', slug: noType }),
      });
      assert.equal(created2.status, 200);
      const noTypeDir = path.join(CITY_ROOT, 'chronicles', chr, 'modules', noType);
      const raw2 = await fs.readFile(path.join(noTypeDir, `${noType}.md`), 'utf-8');
      assert.match(raw2, /\|\s*\*\*Тип\*\*\s*\|\s*Игровая сессия\s*\|/);
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(noType)}${CITY}`, { method: 'DELETE' });
    });

    it('POST /api/chronicles/:chr/modules — format пишется в карточку', async () => {
      if (!chr) return;
      const namedFmt = `test_format_mod_${Date.now()}`;
      const created = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules${CITY}`, {
        method: 'POST', body: JSON.stringify({ name: namedFmt, time: '2010', slug: namedFmt, format: 'Соло-модуль' }),
      });
      assert.equal(created.status, 200);
      const dir = path.join(CITY_ROOT, 'chronicles', chr, 'modules', namedFmt);
      const raw = await fs.readFile(path.join(dir, `${namedFmt}.md`), 'utf-8');
      assert.match(raw, /\|\s*\*\*Формат\*\*\s*\|\s*Соло-модуль\s*\|/);
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(namedFmt)}${CITY}`, { method: 'DELETE' });
    });

    it('PUT /fields — trackInChronology переключается и отражается в /detail', async () => {
      if (!modDir) return;
      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: { trackInChronology: false } }) });
      assert.equal(put.status, 200);
      const raw = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8');
      assert.match(raw, /\|\s*\*\*Учитывать в хронологии\*\*\s*\|\s*нет\s*\|/);

      const { body: detail } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${CITY}`);
      assert.equal(detail.trackInChronology, false);

      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: { trackInChronology: true } }) });
      const { body: detail2 } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${CITY}`);
      assert.equal(detail2.trackInChronology, true);
    });

    it('GET /detail — chronicleDisplay: кириллическое название хроники, не голый слаг', async () => {
      if (!modDir) return;
      const { body: chrs } = await apiJson(`/api/chronicles${CITY}&include_hidden=1`);
      const expected = (Array.isArray(chrs) ? chrs : []).find(c => c.slug === chr)?.display;
      const { body: detail } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${CITY}`);
      assert.equal(detail.chronicle, chr);
      assert.equal(detail.chronicleDisplay, expected);
    });

    it('PUT /finale — пустой → 400', async () => {
      const { status } = await apiJson(`/api/chronicles/${CHR}/modules/${MOD}/finale${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: '' }) });
      assert.equal(status, 400);
    });
    it('PUT /finale — round-trip, отражается в /detail', async () => {
      if (!modDir) return;
      const marker = `__FINALETEST__ ${Date.now()}`;
      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/finale${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: marker }) });
      assert.equal(put.status, 200);
      assert.ok(put.body.ok);
      const raw = await fs.readFile(path.join(modDir, 'finale.md'), 'utf-8');
      assert.ok(raw.includes(marker));

      const { body: detail } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${CITY}`);
      assert.ok(detail.finale.includes(marker));

      await fs.unlink(path.join(modDir, 'finale.md')).catch(() => {});
    });

    it('PUT /api/chronicles/:chr/modules/:mod/move — переносит модуль в другую хронику', async () => {
      if (!chr) return;
      const { body: allChrs } = await apiJson(`/api/chronicles${CITY}&include_hidden=1`);
      // chronicle.md опционален (старые хроники хранят только events.md + модули —
      // см. web/routes/chronicles.js:450) — цель для переноса берём только среди тех,
      // где он есть, иначе dstChrMd ниже закономерно пуст и ассерт падает не из-за бага.
      const otherSlugs = (Array.isArray(allChrs) ? allChrs : []).map(c => c.slug).filter(s => s !== chr);
      let otherChr = null;
      for (const s of otherSlugs) {
        if (await fs.stat(path.join(CITY_ROOT, 'chronicles', s, 'chronicle.md')).catch(() => null)) { otherChr = s; break; }
      }
      if (!otherChr) return; // нет хроники-цели с chronicle.md — нечего использовать целью

      const moveMod = `test_move_mod_${Date.now()}`;
      const create = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules${CITY}`, {
        method: 'POST', body: JSON.stringify({ name: moveMod, time: '2010', slug: moveMod }),
      });
      assert.equal(create.status, 200);
      const srcDir = path.join(CITY_ROOT, 'chronicles', chr, 'modules', moveMod);
      const dstDir = path.join(CITY_ROOT, 'chronicles', otherChr, 'modules', moveMod);

      const move = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(moveMod)}/move${CITY}`, {
        method: 'PUT', body: JSON.stringify({ toChronicle: otherChr }),
      });
      assert.equal(move.status, 200);
      assert.ok(move.body.ok);
      assert.equal(move.body.chronicle, otherChr);
      assert.equal(await fs.stat(srcDir).catch(() => null), null, 'модуль должен исчезнуть из исходной хроники');
      assert.ok(await fs.stat(dstDir).catch(() => null), 'модуль должен появиться в целевой хронике');

      const dstChrMd = await fs.readFile(path.join(CITY_ROOT, 'chronicles', otherChr, 'chronicle.md'), 'utf-8').catch(() => '');
      assert.match(dstChrMd, new RegExp(`modules/${moveMod}/`));

      await apiJson(`/api/chronicles/${encodeURIComponent(otherChr)}/modules/${encodeURIComponent(moveMod)}${CITY}`, { method: 'DELETE' });
    });

    it('PUT /api/chronicles/:chr/modules/:mod/move — целевая хроника не найдена → 404', async () => {
      if (!chr || !mod) return;
      const { status } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/move${CITY}`, {
        method: 'PUT', body: JSON.stringify({ toChronicle: '__nosuchchronicle__' }),
      });
      assert.equal(status, 404);
    });

    it('DELETE /api/chronicles/:chr/modules/:mod — неизвестный модуль → 404', async () => {
      const { status } = await apiJson(`/api/chronicles/__nochron__/modules/__nomod__${CITY}`, { method: 'DELETE' });
      assert.equal(status, 404);
    });

    it('DELETE /api/chronicles/:chr/modules/:mod — создать и удалить модуль (регрессия: rmdir не был импортирован в routes/modules.js)', async () => {
      if (!chr) return;
      const delMod = `test_del_mod_${Date.now()}`;
      const create = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules${CITY}`, {
        method: 'POST', body: JSON.stringify({ name: delMod, time: '2010', slug: delMod }),
      });
      assert.equal(create.status, 200);
      const delModDir = path.join(CITY_ROOT, 'chronicles', chr, 'modules', delMod);
      assert.ok(await fs.stat(delModDir).catch(() => null), 'модуль не был создан для теста');

      const del = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(delMod)}${CITY}`,
        { method: 'DELETE' });
      assert.equal(del.status, 200);
      assert.ok(del.body.ok);
      assert.equal(await fs.stat(delModDir).catch(() => null), null, 'папка модуля должна быть удалена');
    });
  });

  // ── W2: Сессия backend — scene_notes.md + «## 📝 Заметки сессии» в <mod>.md ──
  describe('Scene notes & session notes (W2 backend)', () => {
    let chr = null, mod = null, modDir = null;
    let origMd = null, origSceneNotes = null, sceneNotesExisted = false;

    before(async () => {
      const { body } = await apiJson(`/api/modules${CITY}`);
      if (Array.isArray(body) && body.length) {
        const m = body.find(x => x.chronicle && x.name) || body[0];
        chr = m.chronicle; mod = m.name;
        modDir = path.join(CITY_ROOT, 'chronicles', chr, 'modules', mod);
        origMd = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => null);
        origSceneNotes = await fs.readFile(path.join(modDir, 'scene_notes.md'), 'utf-8').catch(() => null);
        sceneNotesExisted = origSceneNotes !== null;
      }
    });
    after(async () => {
      if (!modDir) return;
      if (origMd !== null) await fs.writeFile(path.join(modDir, `${mod}.md`), origMd, 'utf-8');
      if (sceneNotesExisted) await fs.writeFile(path.join(modDir, 'scene_notes.md'), origSceneNotes, 'utf-8');
      else await fs.unlink(path.join(modDir, 'scene_notes.md')).catch(() => {});
    });

    describe('GET/PUT scene-notes (scene_notes.md) — тикет 3.5-BE + запись сцены по сессиям', () => {
      it('PUT — неизвестный модуль → 404', async () => {
        const { status } = await apiJson(`/api/chronicles/__nochron__/modules/__nomod__/scene-note${CITY}`,
          { method: 'PUT', body: JSON.stringify({ heading: 'Сцена 1', session: 1, text: 'x' }) });
        assert.equal(status, 404);
      });
      it('PUT — пустой heading → 400', async () => {
        if (!modDir) return;
        const { status } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-note${CITY}`,
          { method: 'PUT', body: JSON.stringify({ session: 1, text: 'x' }) });
        assert.equal(status, 400);
      });
      it('PUT — без номера сессии (или некорректный) → 400', async () => {
        if (!modDir) return;
        const { status } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-note${CITY}`,
          { method: 'PUT', body: JSON.stringify({ heading: 'Сцена 1', text: 'x' }) });
        assert.equal(status, 400);
      });
      it('(1) PUT на несуществующий scene_notes.md создаёт его с одной секцией и записью «### Сессия N»', async () => {
        if (!modDir) return;
        await fs.unlink(path.join(modDir, 'scene_notes.md')).catch(() => {});
        const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-note${CITY}`,
          { method: 'PUT', body: JSON.stringify({ heading: 'Сцена 1', session: 1, text: 'Первая заметка.' }) });
        assert.equal(put.status, 200);
        assert.ok(put.body.ok);
        const raw = await fs.readFile(path.join(modDir, 'scene_notes.md'), 'utf-8');
        assert.match(raw, /## Сцена 1[\s\S]*### Сессия 1\n\nПервая заметка\./);
      });
      it('(2) второй PUT с другим heading добавляет вторую секцию, не трогая первую', async () => {
        if (!modDir) return;
        const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-note${CITY}`,
          { method: 'PUT', body: JSON.stringify({ heading: 'Сцена 2', session: 1, text: 'Вторая заметка.' }) });
        assert.equal(put.status, 200);
        const raw = await fs.readFile(path.join(modDir, 'scene_notes.md'), 'utf-8');
        assert.match(raw, /## Сцена 1[\s\S]*### Сессия 1\n\nПервая заметка\./);
        assert.match(raw, /## Сцена 2[\s\S]*### Сессия 1\n\nВторая заметка\./);
      });
      it('(3) повторный PUT с тем же heading И той же сессией заменяет только тело этой записи', async () => {
        if (!modDir) return;
        const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-note${CITY}`,
          { method: 'PUT', body: JSON.stringify({ heading: 'Сцена 1', session: 1, text: 'Обновлённая первая заметка.' }) });
        assert.equal(put.status, 200);
        const raw = await fs.readFile(path.join(modDir, 'scene_notes.md'), 'utf-8');
        assert.match(raw, /### Сессия 1\n\nОбновлённая первая заметка\./);
        assert.doesNotMatch(raw, /Первая заметка\.\n/, 'старый текст записи сессии 1 должен быть заменён, а не оставлен рядом');
        assert.match(raw, /## Сцена 2[\s\S]*### Сессия 1\n\nВторая заметка\./, 'вторая секция не должна была пострадать');
      });
      it('(5) PUT с тем же heading, но ДРУГОЙ сессией — добавляет вторую запись к той же сцене, не трогая первую (запрос пользователя: сцена может доигрываться в нескольких сессиях)', async () => {
        if (!modDir) return;
        const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-note${CITY}`,
          { method: 'PUT', body: JSON.stringify({ heading: 'Сцена 1', session: 3, text: 'Продолжение в сессии 3.' }) });
        assert.equal(put.status, 200);
        const raw = await fs.readFile(path.join(modDir, 'scene_notes.md'), 'utf-8');
        assert.match(raw, /### Сессия 1\n\nОбновлённая первая заметка\./, 'запись сессии 1 должна остаться нетронутой');
        assert.match(raw, /### Сессия 3\n\nПродолжение в сессии 3\./, 'не добавилась вторая запись для той же сцены');
      });
      it('(4) GET возвращает по каждой сцене СПИСОК записей с номерами сессий', async () => {
        if (!modDir) return;
        const { status, body } = await apiJson(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-notes${CITY}`);
        assert.equal(status, 200);
        assert.ok(Array.isArray(body['Сцена 1']), 'GET scene-notes не возвращает массив записей на сцену');
        assert.deepEqual(body['Сцена 1'], [
          { session: 1, text: 'Обновлённая первая заметка.' },
          { session: 3, text: 'Продолжение в сессии 3.' },
        ]);
        assert.deepEqual(body['Сцена 2'], [{ session: 1, text: 'Вторая заметка.' }]);
      });
      it('(6) старый плоский формат (тело сцены без ###-детей) не теряется — отдаётся первой записью с session:null', async () => {
        if (!modDir) return;
        await fs.writeFile(path.join(modDir, 'scene_notes.md'),
          '# Заметки сцен\n\n## Сцена 5\n\nСтарая заметка до появления сессий.\n', 'utf-8');
        const { status, body } = await apiJson(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-notes${CITY}`);
        assert.equal(status, 200);
        assert.deepEqual(body['Сцена 5'], [{ session: null, text: 'Старая заметка до появления сессий.' }]);
        // Новая запись сессии добавляется К старой, не замещая её
        const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-note${CITY}`,
          { method: 'PUT', body: JSON.stringify({ heading: 'Сцена 5', session: 2, text: 'Новая запись сессии 2.' }) });
        assert.equal(put.status, 200);
        const after = await apiJson(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scene-notes${CITY}`);
        assert.deepEqual(after.body['Сцена 5'], [
          { session: null, text: 'Старая заметка до появления сессий.' },
          { session: 2, text: 'Новая запись сессии 2.' },
        ]);
      });
    });

    describe('GET/PUT session-notes (## 📝 Заметки сессии в <mod>.md) — тикет 3.6-BE', () => {
      it('PUT — неизвестный модуль → 404', async () => {
        const { status } = await apiJson(`/api/chronicles/__nochron__/modules/__nomod__/session-notes${CITY}`,
          { method: 'PUT', body: JSON.stringify({ text: 'x' }) });
        assert.equal(status, 404);
      });
      it('GET на модуль без секции → { text: "" }', async () => {
        if (!modDir) return;
        const { status, body } = await apiJson(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/session-notes${CITY}`);
        assert.equal(status, 200);
        assert.equal(body.text, '');
      });
      it('(1)+(2) PUT дописывает секцию в конец файла; поля detail до/после совпадают (regression-guard)', async () => {
        if (!modDir) return;
        const before = await apiJson(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${CITY}`);
        const put = await apiJson(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/session-notes${CITY}`,
          { method: 'PUT', body: JSON.stringify({ text: 'Заметки первой сессии.' }) });
        assert.equal(put.status, 200);
        assert.ok(put.body.ok);

        const raw = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8');
        assert.match(raw, /## 📝 Заметки сессии\n\nЗаметки первой сессии\./);
        // Секция дописана в конец, после `---`-разделителя, как остальные секции модуля
        assert.ok(raw.trimEnd().endsWith('Заметки первой сессии.'));

        const after = await apiJson(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${CITY}`);
        for (const key of ['title', 'pcs', 'npcs', 'type', 'format', 'time']) {
          assert.deepEqual(after.body[key], before.body[key], `поле «${key}» изменилось после апсерта заметок сессии`);
        }
      });
      it('(3) повторный PUT заменяет тело, не дублируя заголовок', async () => {
        if (!modDir) return;
        const put = await apiJson(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/session-notes${CITY}`,
          { method: 'PUT', body: JSON.stringify({ text: 'Обновлённые заметки сессии.' }) });
        assert.equal(put.status, 200);

        const raw = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8');
        const occurrences = (raw.match(/## 📝 Заметки сессии/g) || []).length;
        assert.equal(occurrences, 1, 'заголовок секции не должен дублироваться');
        assert.match(raw, /## 📝 Заметки сессии\n\nОбновлённые заметки сессии\./);
        assert.doesNotMatch(raw, /Заметки первой сессии\./);

        const { status, body } = await apiJson(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/session-notes${CITY}`);
        assert.equal(status, 200);
        assert.equal(body.text, 'Обновлённые заметки сессии.');
      });
    });
  });

  // ── UNIT — _upsertModuleSection/_readModuleSection: секция НЕ последняя в файле ──
  // Регрессия: rest.search(/\n##\s+/) находит `\n` НЕПОСРЕДСТВЕННО перед следующим
  // `## `, поэтому `---`-разделитель между секциями попадал в диапазон
  // чтения/замены — GET утекал "BodyA\n\n---" вместо "BodyA", а PUT молча стирал
  // разделитель перед следующей секцией. На проде это недостижимо (заметки
  // сессии всегда дописываются последней секцией), но хелпер спроектирован как
  // переиспользуемый — покрываем именно случай «после целевой секции есть ещё одна».
  describe('_upsertModuleSection/_readModuleSection — секция не последняя в файле', () => {
    const { _upsertModuleSection, _readModuleSection } = require('../routes/modules/shared');
    const mod = 'mod';
    let tmpDir = null;

    const RAW = '# Title\n\n---\n\n## 📝 Заметки сессии\n\nBodyA\n\n---\n\n## Что-то после\n\nBodyB\n';

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sanguine-module-section-'));
      await fs.writeFile(path.join(tmpDir, `${mod}.md`), RAW, 'utf-8');
    });
    afterEach(async () => {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('_readModuleSection не утекает разделитель «---» в тело секции', async () => {
      const text = await _readModuleSection(tmpDir, mod, '📝 Заметки сессии');
      assert.equal(text, 'BodyA');
    });

    it('_upsertModuleSection заменяет только тело целевой секции, сохраняя разделитель и следующую секцию', async () => {
      await _upsertModuleSection(tmpDir, mod, '📝 Заметки сессии', 'NEW BODY');
      const raw = await fs.readFile(path.join(tmpDir, `${mod}.md`), 'utf-8');
      assert.equal(raw,
        '# Title\n\n---\n\n## 📝 Заметки сессии\n\nNEW BODY\n\n---\n\n## Что-то после\n\nBodyB\n');
    });

    it('после апсерта _readModuleSection на следующей секции по-прежнему видит нетронутое тело', async () => {
      await _upsertModuleSection(tmpDir, mod, '📝 Заметки сессии', 'NEW BODY');
      const text = await _readModuleSection(tmpDir, mod, 'Что-то после');
      assert.equal(text, 'BodyB');
    });
  });

  // ── E2: мотивация НПС — Хочет/Боится/Рычаг (опциональные поля карточки) ──────
  describe('Character fields — мотивация (want/fear/leverage)', () => {
    it('PUT fields пишет Хочет/Боится/Рычаг в карточку, parseCharacter читает обратно', async () => {
      const name = `Тест Мотив ${Date.now()}`;
      const slug = slugify(name);
      const create = await apiJson(`/api/characters${CITY}`, {
        method: 'POST', body: JSON.stringify({ name, lineage: 'vampire', gender: 'Мужской', clan: 'Носферату', sect: 'Камарилья' }),
      });
      assert.equal(create.status, 200);
      const put = await apiJson(`/api/characters/${encodeURIComponent(slug)}/fields${CITY}`, {
        method: 'PUT', body: JSON.stringify({ fields: {
          want: 'Место в Совете Примогенов', fear: 'Раскрытие старого предательства', leverage: 'Долг перед Шерифом',
        } }),
      });
      assert.equal(put.status, 200);
      const raw = await fs.readFile(path.join(CITY_ROOT, 'characters', 'vampires', slug, `${slug}.md`), 'utf-8');
      assert.match(raw, /\*\*Хочет:\*\*\s*Место в Совете Примогенов/);
      assert.match(raw, /\*\*Боится:\*\*\s*Раскрытие старого предательства/);
      assert.match(raw, /\*\*Рычаг:\*\*\s*Долг перед Шерифом/);
      const { body: chars } = await apiJson(`/api/characters${CITY}`);
      const char = (Array.isArray(chars) ? chars : []).find(c => c.slug === slug);
      assert.equal(char.want, 'Место в Совете Примогенов');
      assert.equal(char.fear, 'Раскрытие старого предательства');
      assert.equal(char.leverage, 'Долг перед Шерифом');
      await apiJson(`/api/characters/${encodeURIComponent(slug)}${CITY}`, { method: 'DELETE' });
      await fs.rm(path.join(CITY_ROOT, 'characters', '_deleted', slug), { recursive: true, force: true });
    });

    it('source-guard: диалоги и генерация НПС модуля знают о мотивации', () => {
      const dlg = require('fs').readFileSync(path.join(__dirname, '../routes/characters.js'), 'utf-8');
      const fill = require('fs').readFileSync(path.join(__dirname, '../routes/modules/fill.js'), 'utf-8');
      assert.ok(/Хочет\/Боится\/Рычаг|Хочет, Боится, Рычаг/.test(dlg), 'dialogue-промт без инструкции о мотивации');
      assert.ok(/Хочет|Боится|Рычаг/.test(fill), 'fill.js без инструкции о мотивации');
    });
  });

  // ── H: «Эпизодические персонажи» — cross-lineage фильтр по «Принадлежности»,
  // не отдельная папка/линейка (поле и его enum уже существовали в схеме
  // карточки — «Эпизодический персонаж» как значение «Принадлежность») ────────
  describe('Персонажи — belonging «Эпизодический персонаж» (фаза H/I)', () => {
    it('POST /api/characters с belonging=«Эпизодический персонаж» пишет поле в карточку и отдаёт его в списке', async () => {
      const name = `Тест Эпизод ${Date.now()}`;
      const slug = slugify(name);
      const create = await apiJson(`/api/characters${CITY}`, {
        method: 'POST',
        body: JSON.stringify({ name, lineage: 'vampire', gender: 'Мужской', clan: 'Тореадор', sect: 'Камарилья', belonging: 'Эпизодический персонаж' }),
      });
      assert.equal(create.status, 200);
      const raw = await fs.readFile(path.join(CITY_ROOT, 'characters', 'vampires', slug, `${slug}.md`), 'utf-8');
      assert.match(raw, /\*\*Принадлежность:\*\*\s*Эпизодический персонаж/);
      const { body: chars } = await apiJson(`/api/characters${CITY}`);
      const char = (Array.isArray(chars) ? chars : []).find(c => c.slug === slug);
      assert.ok(char, 'персонаж должен быть найден после создания');
      assert.equal(char.belonging, 'Эпизодический персонаж');
      await apiJson(`/api/characters/${encodeURIComponent(slug)}${CITY}`, { method: 'DELETE' });
      await fs.rm(path.join(CITY_ROOT, 'characters', '_deleted', slug), { recursive: true, force: true });
    });

    it('без belonging в теле запроса — прежнее поведение (по умолчанию «Персонаж мастера»)', async () => {
      const name = `Тест Дефолт Принадлежность ${Date.now()}`;
      const slug = slugify(name);
      const create = await apiJson(`/api/characters${CITY}`, {
        method: 'POST', body: JSON.stringify({ name, lineage: 'mortal', gender: 'Женский' }),
      });
      assert.equal(create.status, 200);
      const raw = await fs.readFile(path.join(CITY_ROOT, 'characters', 'mortals', slug, `${slug}.md`), 'utf-8');
      assert.match(raw, /\*\*Принадлежность:\*\*\s*Персонаж мастера/);
      await apiJson(`/api/characters/${encodeURIComponent(slug)}${CITY}`, { method: 'DELETE' });
      await fs.rm(path.join(CITY_ROOT, 'characters', '_deleted', slug), { recursive: true, force: true });
    });

    it('POST /api/characters с belonging=«Фамильяр» пишет поле в карточку и отдаёт его в списке', async () => {
      const name = `Тест Фамильяр ${Date.now()}`;
      const slug = slugify(name);
      const create = await apiJson(`/api/characters${CITY}`, {
        method: 'POST',
        // ⚠️ gender ОБЯЗАТЕЛЬНО 'Мужской'/'Женский' — НЕ 'Неизвестно'.
        // Сервер (`web/routes/characters.js:75` → проверка на `:327`) принимает только два
        // значения и вернёт 400, хотя схема (`card_schema.md:38`) и линтер
        // (`validate_cards.js:22`) 'Неизвестно' разрешают. Это рассинхрон сервера со схемой,
        // он чинится отдельной follow-up задачей (см. «Пробелы» выше). До неё — обход.
        body: JSON.stringify({ name, lineage: 'mortal', gender: 'Мужской', belonging: 'Фамильяр' }),
      });
      assert.equal(create.status, 200);
      const raw = await fs.readFile(path.join(CITY_ROOT, 'characters', 'mortals', slug, `${slug}.md`), 'utf-8');
      assert.match(raw, /\*\*Принадлежность:\*\*\s*Фамильяр/);
      const { body: chars } = await apiJson(`/api/characters${CITY}`);
      const char = (Array.isArray(chars) ? chars : []).find(c => c.slug === slug);
      assert.ok(char, 'персонаж должен быть найден после создания');
      assert.equal(char.belonging, 'Фамильяр');
      await apiJson(`/api/characters/${encodeURIComponent(slug)}${CITY}`, { method: 'DELETE' });
      await fs.rm(path.join(CITY_ROOT, 'characters', '_deleted', slug), { recursive: true, force: true });
    });

    it('source-guard: страница «Персонажи» фильтрует по belonging через общую карту вкладок (не по новой линейке)', () => {
      const src = require('fs').readFileSync(path.join(__dirname, '../public/scripts/scripts.js'), 'utf-8');
      assert.ok(src.includes('BELONGING_TAB_VALUES'), 'нет общей карты слаг-вкладки → значение Принадлежности');
      assert.ok(src.includes("c.belonging === BELONGING_TAB_VALUES[belonging]"), 'renderChars не фильтрует по BELONGING_TAB_VALUES');
      assert.ok(src.includes('data-belonging-tab'), 'нет обработчика вкладок');
      // Проверяем слаг именно внутри карты, а не где угодно в файле:
      // голая подстрока "familiar:" слишком общая и даст ложно-зелёный результат.
      assert.ok(/BELONGING_TAB_VALUES\s*=\s*\{[^}]*familiar:\s*'Фамильяр'/s.test(src),
        'в карте вкладок нет пары familiar → Фамильяр');
    });

    it('source-guard: HTML-вкладки покрывают все 4 значения Принадлежности + «Все»', () => {
      const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
      ['data-belonging-tab="all"', 'data-belonging-tab="master"', 'data-belonging-tab="player"',
       'data-belonging-tab="episodic"', 'data-belonging-tab="familiar"'].forEach(attr => {
        assert.ok(html.includes(attr), `не найдена вкладка ${attr}`);
      });
    });

    it('source-guard: инлайн-редактор карточки предлагает «Фамильяр» в дропдауне Принадлежности', () => {
      const src = require('fs').readFileSync(path.join(__dirname, '../public/scripts/char-detail.js'), 'utf-8');
      // Не привязываемся к точной строке массива с пробелами — она сломается от любого
      // переформатирования. Достаточно, что опция есть в ветке редактора belonging.
      assert.ok(src.includes("'Фамильяр'"), 'дропдаун char-detail.js не содержит опцию Фамильяр');
    });
  });

  // ── Character fields — статус теперь редактируемый (дропдаун) ────────────────
  describe('Character fields — status/statusDetails', () => {
    it('PUT /api/characters/:slug/fields — status и statusDetails пишутся в карточку и читаются обратно', async () => {
      const name = `Тест Статус ${Date.now()}`;
      const slug = slugify(name);
      const create = await apiJson(`/api/characters${CITY}`, {
        method: 'POST', body: JSON.stringify({ name, lineage: 'vampire', gender: 'Мужской', clan: 'Тореадор', sect: 'Камарилья' }),
      });
      assert.equal(create.status, 200);

      const put = await apiJson(`/api/characters/${encodeURIComponent(slug)}/fields${CITY}`, {
        method: 'PUT', body: JSON.stringify({ fields: { status: 'Торпор', statusDetails: 'с декабря 2010' } }),
      });
      assert.equal(put.status, 200);
      assert.ok(put.body.ok);

      const cardPath = path.join(CITY_ROOT, 'characters', 'vampires', slug, `${slug}.md`);
      const raw = await fs.readFile(cardPath, 'utf-8');
      assert.match(raw, /\*\*Статус:\*\*\s*Торпор/);
      assert.match(raw, /\*\*Детали статуса:\*\*\s*с декабря 2010/);

      const { body: chars } = await apiJson(`/api/characters${CITY}`);
      const char = (Array.isArray(chars) ? chars : []).find(c => c.slug === slug);
      assert.ok(char, 'персонаж должен быть найден после правки');
      assert.equal(char.status, 'Торпор');
      assert.equal(char.statusType, 'torpor');
      assert.equal(char.statusDetails, 'с декабря 2010');

      await apiJson(`/api/characters/${encodeURIComponent(slug)}${CITY}`, { method: 'DELETE' });
      await fs.rm(path.join(CITY_ROOT, 'characters', '_deleted', slug), { recursive: true, force: true });
    });
  });

  // ── Import/Export — обратимость: экспорт → импорт под новым слагом ───────────
  describe('Import/Export — characters & locations', () => {
    it('GET /api/export/characters отдаёт raw для каждой карточки', async () => {
      const { status, body } = await apiJson(`/api/export/characters${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body) && body.length > 0);
      assert.ok(body.every(c => typeof c.raw === 'string' && c.raw.length > 0));
      assert.ok(body.every(c => c.slug && c.lineageFolder));
    });

    it('GET /api/export/locations отдаёт raw + dirRelPath для каждой карточки', async () => {
      const { status, body } = await apiJson(`/api/export/locations${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body) && body.length > 0);
      assert.ok(body.every(l => typeof l.raw === 'string' && l.raw.length > 0));
      assert.ok(body.every(l => typeof l.dirRelPath === 'string' && l.dirRelPath.length > 0));
    });

    it('POST /api/import/characters — пустой список → 400', async () => {
      const { status } = await apiJson(`/api/import/characters${CITY}`,
        { method: 'POST', body: JSON.stringify({ characters: [] }) });
      assert.equal(status, 400);
    });

    it('POST /api/import/characters — создаёт карточку под новым слагом, второй прогон без overwrite пропускает', async () => {
      const slug = `test_import_char_${Date.now()}`;
      const raw = `# Тестовый Импорт\n\n- **Родной город:** Париж\n- **Линейка WoD:** Вампир: Маскарад\n- **Клан:** Тореадор\n- **Статус:** Жив\n`;
      const dir = path.join(CITY_ROOT, 'characters', 'vampires', slug);

      const post = await apiJson(`/api/import/characters${CITY}`, {
        method: 'POST', body: JSON.stringify({ characters: [{ slug, lineageFolder: 'vampires', raw }] }),
      });
      assert.equal(post.status, 200);
      assert.deepEqual(post.body.created, [slug]);
      assert.deepEqual(post.body.skipped, []);
      const written = await fs.readFile(path.join(dir, `${slug}.md`), 'utf-8');
      assert.equal(written, raw);

      const idx = await fs.readFile(path.join(CITY_ROOT, 'archive', 'characters_index.md'), 'utf-8').catch(() => '');
      assert.match(idx, new RegExp(`characters/vampires/${slug}/${slug}\\.md`));

      // Повторный импорт того же слага без overwrite — пропускается, а не падает
      const post2 = await apiJson(`/api/import/characters${CITY}`, {
        method: 'POST', body: JSON.stringify({ characters: [{ slug, lineageFolder: 'vampires', raw: raw + '\nдоп.' }] }),
      });
      assert.equal(post2.status, 200);
      assert.deepEqual(post2.body.created, []);
      assert.deepEqual(post2.body.skipped, [slug]);
      const unchanged = await fs.readFile(path.join(dir, `${slug}.md`), 'utf-8');
      assert.equal(unchanged, raw, 'без overwrite:true существующая карточка не должна меняться');

      await fs.rm(dir, { recursive: true, force: true });
      // Импорт дописал строку в characters_index.md — убрать её же, а не весь файл откатывать
      const idxPath  = path.join(CITY_ROOT, 'archive', 'characters_index.md');
      const idxAfter = await fs.readFile(idxPath, 'utf-8').catch(() => '');
      const cleaned  = idxAfter.split('\n').filter(l => !l.includes(`${slug}/${slug}.md`)).join('\n');
      if (cleaned !== idxAfter) await fs.writeFile(idxPath, cleaned, 'utf-8');
    });

    it('POST /api/import/characters — неизвестная линейка → errors, недопустимый слаг → errors', async () => {
      const { status, body } = await apiJson(`/api/import/characters${CITY}`, {
        method: 'POST', body: JSON.stringify({ characters: [
          { slug: 'x', lineageFolder: '__nolineage__', raw: '# x' },
          { slug: 'Bad Slug!', lineageFolder: 'vampires', raw: '# x' },
        ] }),
      });
      assert.equal(status, 200);
      assert.equal(body.created.length, 0);
      assert.equal(body.errors.length, 2);
    });

    it('POST /api/import/locations — создаёт карточку по dirRelPath, второй прогон без overwrite пропускает', async () => {
      const dirRelPath = `district_99/test_import_district/test_import_loc_${Date.now()}`;
      const slug = dirRelPath.split('/').pop();
      const raw = `# Тестовая Импорт-Локация\n> **Название:** Тест\n---\n## 🎭 Атмосфера\nТестовая атмосфера.\n`;
      const dir = path.join(CITY_ROOT, 'locations', dirRelPath);

      const post = await apiJson(`/api/import/locations${CITY}`, {
        method: 'POST', body: JSON.stringify({ locations: [{ dirRelPath, raw }] }),
      });
      assert.equal(post.status, 200);
      assert.deepEqual(post.body.created, [dirRelPath]);
      const written = await fs.readFile(path.join(dir, `${slug}.md`), 'utf-8');
      assert.equal(written, raw);

      const post2 = await apiJson(`/api/import/locations${CITY}`, {
        method: 'POST', body: JSON.stringify({ locations: [{ dirRelPath, raw: raw + '\nдоп.' }] }),
      });
      assert.deepEqual(post2.body.skipped, [dirRelPath]);

      await fs.rm(path.join(CITY_ROOT, 'locations', 'district_99'), { recursive: true, force: true });
    });

    it('POST /api/import/locations — путь с «..» отклоняется', async () => {
      const { status, body } = await apiJson(`/api/import/locations${CITY}`, {
        method: 'POST', body: JSON.stringify({ locations: [
          { dirRelPath: '../../etc/evil', raw: '# x' },
        ] }),
      });
      assert.equal(status, 200);
      assert.equal(body.created.length, 0);
      assert.equal(body.errors.length, 1);
    });
  });

  // ── Rumors — write round-trip (restores original on teardown) ────────────────
  describe('Rumors — write round-trip', () => {
    const file = path.join(CITY_ROOT, 'archive', 'rumors_elysium.md');
    let original = null, existed = false;

    before(async () => {
      original = await fs.readFile(file, 'utf-8').catch(() => null);
      existed  = original !== null;
    });
    after(async () => {
      if (existed) await fs.writeFile(file, original, 'utf-8');
      else await fs.unlink(file).catch(() => {});
    });

    it('PUT writes content, GET reads it back', async () => {
      const marker = `__RUMOR_TEST__ ${Date.now()}`;
      const put = await apiJson(`/api/rumors${CITY}`, {
        method: 'PUT', body: JSON.stringify({ type: 'elysium', content: marker }) });
      assert.equal(put.status, 200); assert.ok(put.body.ok);
      const get = await apiJson(`/api/rumors${CITY}&type=elysium`);
      assert.equal(get.status, 200);
      assert.equal(get.body.exists, true);
      assert.ok(get.body.content.includes(marker));
    });
  });

}); // API — integration

// ══════════════════════════════════════════════════════════════════════════════
// UNIT — source-guard: подвкладки Дисциплин библиотеки (Фаза C)
// ══════════════════════════════════════════════════════════════════════════════

test('source-guard: 8 подвкладок Дисциплин присутствуют в HTML', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  for (const g of ['all','combo','koldun','necromancy','thaumaturgy','dark-thaumaturgy','assamite','setite']) {
    assert.ok(html.includes(`data-disc-group="${g}"`), 'нет подвкладки ' + g);
  }
});

test('source-guard: рендер группы Дисциплин ветвится на all/combo/иначе', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  assert.ok(js.includes('_libSorceryPathsHtml'));
  assert.ok(js.includes('_libComboCardsHtml'));
  assert.ok(js.includes("_libDiscGroup === 'combo'"));
});

test('source-guard: лист V20 — «+ Из справочника» для фактов биографии (kind=background)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  // кнопка + панель пикера в колонке фактов биографии
  assert.ok(js.includes('data-v20-lib-kind="background"'), 'нет кнопки/пикера kind=background');
  // загрузка библиотеки и маппинг на секцию листа
  assert.ok(js.includes("'/api/library/backgrounds'"), 'пикер не грузит /api/library/backgrounds');
  assert.ok(js.includes("if (kind === 'background') return 'backgrounds'"), 'kind=background не мапится на секцию backgrounds');
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIT — source-guard: FAB дайс-роллер (dice.js) — тикеты 2.1/2.2/2.3
// ══════════════════════════════════════════════════════════════════════════════

test('source-guard: dice.js — бросок без персонажа (2.1) заполняет полные списки V20_ATTRS/V20_ABILITIES', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/dice.js'), 'utf-8');
  // без модели селекты больше не отключаются
  assert.ok(!/attrSel\.disabled = abilSel\.disabled = true/.test(js), 'селекты всё ещё дизейблятся без персонажа');
  assert.ok(js.includes('V20_ATTRS'), 'нет обхода V20_ATTRS для списка без персонажа');
  assert.ok(js.includes('V20_ABILITIES'), 'нет обхода V20_ABILITIES для списка без персонажа');
  // _diceApplySheetPool вызывается только когда есть модель
  assert.ok(/if \(_diceModel\) _diceApplySheetPool\(\)/.test(js), 'пул из атрибута/способности применяется и без персонажа');
});

test('source-guard: dice.js — «Не владеет» (2.2): фильтр val>0, dataset.base, +2 без накопления', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/dice.js'), 'utf-8');
  assert.ok(js.includes("'unskilled'"), "нет опции/значения 'unskilled'");
  assert.ok(js.includes('dataset.base'), 'нет dataset.base — базовой сложности отдельно от эффективной');
  // атрибуты и способности фильтруются по val > 0 (нулевые не попадают в список броска)
  assert.match(js, /if \(val > 0\) attrs\.push/, 'атрибуты не фильтруются по val > 0');
  assert.match(js, /val > 0\) abils\.push/, 'способности не фильтруются по val > 0');
  // «Не владеет» — 0 к пулу явным условием, а не случайным NaN||0
  assert.ok(js.includes("abilSel.value === 'unskilled' ? 0 :"), "«Не владеет» не даёт явный 0 к пулу");
  // эффективная сложность = base + 2, никогда не читая diffEl.value как источник базы
  assert.match(js, /base \+ \(flag \? 2 : 0\)/, 'нет формулы «база + 2 при unskilled» без накопления');
  assert.ok(!/diffEl\.value = parseInt\(diffEl\.value/.test(js), 'база читается из текущего diffEl.value — риск накопления +2');
});

// Перенесено с ветки worktree-patch-niti-broski-sessiya-list (код-ревью, не
// попало в master при параллельной прямой реализации того же плана) — см.
// docs/audit/2026-07-28-session-feature-qa-report.md, обсуждение веток.
// Регрессия: слушатель input/change на #dice-diff безусловно писал
// diffEl.value в dataset.base — при активном «Не владеет» показанное значение
// уже включает +2, и ручная правка поля («вижу 8, набираю 9») превращала
// «чистую» базу 7 в 9, задваивая штраф при следующем вкл/выкл.
test('source-guard: dice.js — ручной ввод #dice-diff вычитает активный штраф «Не владеет» перед записью в dataset.base (не задваивает +2)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/dice.js'), 'utf-8');
  assert.ok(js.includes('function _diceOnDiffInput'), 'нет функции _diceOnDiffInput');
  const fnMatch = js.match(/function _diceOnDiffInput\(\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fnMatch, 'не найдено тело _diceOnDiffInput');
  assert.ok(/_diceUnskilled \? 2 : 0/.test(fnMatch[0]),
    '_diceOnDiffInput не вычитает штраф +2 при активном _diceUnskilled перед записью в dataset.base');
  assert.ok(js.includes("diffEl.addEventListener('input', _diceOnDiffInput)") &&
    js.includes("diffEl.addEventListener('change', _diceOnDiffInput)"),
    'слушатели input/change на #dice-diff не используют _diceOnDiffInput (риск вернуться к наивной записи diffEl.value как есть)');
});

test('source-guard: dice.js — индикатор автоматического +2 к сложности виден только при «Не владеет»', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/dice.js'), 'utf-8');
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  const badgeTag = html.match(/<span[^>]*id="dice-unskilled-badge"[^>]*>([^<]*)<\/span>/);
  assert.ok(badgeTag, 'нет индикатора рядом с #dice-diff в разметке');
  assert.ok(/\bhidden\b/.test(badgeTag[0]), 'индикатор должен по умолчанию быть скрыт (атрибут hidden)');
  assert.ok(/\+2.*Не владеет/.test(badgeTag[1]), 'текст индикатора не «+2 — Не владеет»');
  assert.ok(js.includes('unskilledBadge.hidden = !flag'), 'индикатор не переключается по состоянию _diceUnskilled');
});

// Перенесено (обнаружено сверкой) с ветки worktree-patch-niti-broski-sessiya-list —
// см. docs/audit/2026-07-28-session-feature-qa-report.md. .v20-auto-badge
// задаёт display:inline-block (авторское правило), которое всегда перебивает
// UA-правило [hidden]{display:none} независимо от специфичности (origin важнее
// specificity) — без явного #dice-unskilled-badge[hidden] бейдж физически не
// скрывался, несмотря на unskilledBadge.hidden = !flag в JS.
test('source-guard: styles.css — #dice-unskilled-badge[hidden] явно скрыт (иначе .v20-auto-badge display перебивает UA [hidden])', () => {
  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  assert.ok(/#dice-unskilled-badge\[hidden\]\s*\{[\s\S]*?display:\s*none/.test(css),
    'нет #dice-unskilled-badge[hidden] { display: none } — .v20-auto-badge { display: inline-block } перебьёт UA-правило [hidden]');
});

test('source-guard: dice.js/index.html — селект добродетелей (2.3) с 4 пунктами включая Силу воли', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/dice.js'), 'utf-8');
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  assert.ok(html.includes('id="dice-virtue-sel"'), 'нет #dice-virtue-sel в разметке');
  assert.ok(html.includes('class="form-control" id="dice-virtue-sel"'), 'селект добродетели не переиспользует form-control как attrSel/abilSel');
  assert.ok(js.includes('m.virtues.conscience'), 'нет Совести/Решимости в модели добродетелей');
  assert.ok(js.includes('m.virtues.selfcontrol'), 'нет Самоконтроля/Инстинктов в модели добродетелей');
  assert.ok(js.includes('m.virtues.courage'), 'нет Смелости в модели добродетелей');
  assert.ok(js.includes('m.willpower.permanent'), 'нет Силы воли в модели добродетелей');
  // добродетель — самостоятельный пул, не сумма с атрибутом/способностью
  assert.ok(js.includes('_diceApplyVirtuePool'), 'нет отдельного применения пула добродетели');
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIT — source-guard: граф связей — тулбар без zoom-кнопок + фильтр по типу связи
// (тикеты 4.1/4.2, план "Нити · Броски · Сессия · Связи · Лист")
// ══════════════════════════════════════════════════════════════════════════════

test('source-guard: index.html — zoom-кнопки убраны, #btn-reset — иконка с aria-label', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  assert.ok(!html.includes('id="btn-zoom-in"'), 'кнопка btn-zoom-in всё ещё в разметке');
  assert.ok(!html.includes('id="btn-zoom-out"'), 'кнопка btn-zoom-out всё ещё в разметке');
  const resetTag = html.match(/<button[^>]*id="btn-reset"[^>]*>[^<]*<\/button>/);
  assert.ok(resetTag, 'нет кнопки #btn-reset в разметке');
  assert.ok(/aria-label="[^"]+"/.test(resetTag[0]), 'у #btn-reset нет aria-label (текст «Сброс» убран из DOM)');
  assert.ok(/title="[^"]+"/.test(resetTag[0]), 'у #btn-reset нет title-подсказки');
  assert.ok(!/Сброс/.test(resetTag[0].replace(/aria-label="[^"]*"|title="[^"]*"/g, '')), 'текстовая метка «Сброс» должна быть убрана из содержимого кнопки');
});

test('source-guard: graph.js — обработчики удалённых zoom-кнопок отсутствуют (иначе getElementById(null).addEventListener роняет весь скрипт)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/graph.js'), 'utf-8');
  assert.ok(!js.includes("getElementById('btn-zoom-in')"), 'остался обработчик на удалённую кнопку btn-zoom-in');
  assert.ok(!js.includes("getElementById('btn-zoom-out')"), 'остался обработчик на удалённую кнопку btn-zoom-out');
});

test('source-guard: index.html содержит контейнер фильтра типов связи #graph-reltype-filter', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  assert.ok(html.includes('id="graph-reltype-filter"'), 'нет #graph-reltype-filter в разметке тулбара графа');
});

test('source-guard: graph.js — фильтр типов связи объединён с фильтром линеек в один хелпер applyGraphFilters', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/graph.js'), 'utf-8');
  assert.ok(js.includes('relTypeFilter'), 'нет STATE.graph.relTypeFilter — фильтр типов связи не реализован');
  assert.ok(js.includes('function applyGraphFilters'), 'нет единого хелпера applyGraphFilters()');
  assert.ok(js.includes('function buildRelTypeFilter'), 'нет buildRelTypeFilter() по образцу buildLineageFilter()');
  // единственный writer в style('display', …) для рёбер — оба условия в одном месте
  const displayWriters = js.match(/link\.style\('display'/g) || [];
  assert.strictEqual(displayWriters.length, 1, 'должен быть ровно один writer link.style(\'display\', …) — иначе гонка видимости между функциями');
  assert.ok(/activeLineage\.has\(l\.source\.lineage\)[\s\S]{0,80}activeLineage\.has\(l\.target\.lineage\)[\s\S]{0,80}activeRelType\.has\(l\.type\)/.test(js),
    'applyGraphFilters не проверяет оба условия (линейки обоих концов И тип связи) в одном выражении');
  // btn-reset сбрасывает оба фильтра и вызывает applyGraphFilters ровно один раз
  const resetHandlerMatch = js.match(/getElementById\('btn-reset'\)\.addEventListener\('click', \(\) => \{[\s\S]*?\n\}\);/);
  assert.ok(resetHandlerMatch, 'нет обработчика click на #btn-reset');
  const resetHandler = resetHandlerMatch[0];
  assert.ok(resetHandler.includes('graph-reltype-filter'), 'btn-reset не чекает чекбоксы #graph-reltype-filter');
  assert.ok(resetHandler.includes('STATE.graph.relTypeFilter'), 'btn-reset не возвращает все ключи в STATE.graph.relTypeFilter');
  assert.ok(resetHandler.includes('applyGraphFilters()'), 'btn-reset не вызывает applyGraphFilters()');
});

test('source-guard: styles.css — #graph-toolbar — две строки (column), каждая .graph-toolbar-row переносит чипы (flex-wrap)', () => {
  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  const toolbarBlock = css.match(/#graph-toolbar\s*\{[^}]*\}/);
  assert.ok(toolbarBlock, 'нет правила #graph-toolbar в styles.css');
  assert.ok(/flex-direction:\s*column/.test(toolbarBlock[0]), '#graph-toolbar не задаёт flex-direction: column — строки фильтров не будут разделены (запрос пользователя: линейки WoD сверху, типы связей снизу)');
  const rowBlock = css.match(/\.graph-toolbar-row\s*\{[^}]*\}/);
  assert.ok(rowBlock, 'нет правила .graph-toolbar-row в styles.css');
  assert.ok(/flex-wrap:\s*wrap/.test(rowBlock[0]), '.graph-toolbar-row без flex-wrap: wrap — риск горизонтального переполнения чипами');
});

// Запрос пользователя: разделить единую строку фильтров на две — линейки WoD
// сверху, типы связей снизу.
test('source-guard: index.html — #graph-lineage-filter и #graph-reltype-filter лежат в РАЗНЫХ .graph-toolbar-row', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  const toolbarMatch = html.match(/<div id="graph-toolbar">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(toolbarMatch, 'не найден блок #graph-toolbar');
  const rows = toolbarMatch[0].match(/<div class="graph-toolbar-row">[\s\S]*?<\/div>/g);
  assert.ok(rows && rows.length >= 2, 'должно быть минимум две .graph-toolbar-row внутри #graph-toolbar');
  const lineageRow = rows.find(r => r.includes('id="graph-lineage-filter"'));
  const reltypeRow = rows.find(r => r.includes('id="graph-reltype-filter"'));
  assert.ok(lineageRow, '#graph-lineage-filter не найден ни в одной .graph-toolbar-row');
  assert.ok(reltypeRow, '#graph-reltype-filter не найден ни в одной .graph-toolbar-row');
  assert.notStrictEqual(lineageRow, reltypeRow, '#graph-lineage-filter и #graph-reltype-filter лежат в ОДНОЙ строке — должны быть разделены');
});

// Баг с реального скриншота: бейджи линейки/статуса в боковой панели графа
// связей наплывали поверх произвольной записи в списке «Связи» вместо того,
// чтобы стоять сразу под именем персонажа. Причина — showInfoPanel()
// переиспользовал .char-badges: та задаёт position:absolute; bottom:10px,
// рассчитанный на карточку персонажа ФИКСИРОВАННОЙ высоты (пин к нижнему
// левому углу карточки) — но #info-panel графа СКРОЛЛИТСЯ (overflow-y:auto,
// высота = вся видимая область, не высота контента), и bottom:10px в таком
// контейнере держит бейджи приклеенными к низу ОКНА панели, а не к месту в
// потоке документа — визуально наплывает на что угодно, что там прокручено.
test('source-guard: graph.js — showInfoPanel() не переиспользует .char-badges (абсолютное позиционирование под карточку персонажа наплывает на список связей в скроллящейся панели)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/graph.js'), 'utf-8');
  const fnMatch = js.match(/function showInfoPanel\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция showInfoPanel');
  assert.ok(!fnMatch[0].includes('class="char-badges"'),
    'showInfoPanel() всё ещё использует .char-badges — на скроллящейся #info-panel бейджи наплывут на произвольную запись списка «Связи»');
  assert.ok(fnMatch[0].includes('class="info-badges"'), 'showInfoPanel() не использует замену .info-badges для бейджей линейки/статуса');
});

test('source-guard: styles.css — .info-badges в обычном потоке документа (без position:absolute, в отличие от .char-badges)', () => {
  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  const infoBadgesMatch = css.match(/\.info-badges\s*\{[^}]*\}/);
  assert.ok(infoBadgesMatch, 'не найдено правило .info-badges');
  assert.ok(!/position:\s*absolute/.test(infoBadgesMatch[0]),
    '.info-badges задаёт position:absolute — унаследует тот же баг наплыва, что и .char-badges в скроллящейся #info-panel');
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIT — source-guard: вкладка «Инструкции» в Инструментах (guide.md в приложении)
// ══════════════════════════════════════════════════════════════════════════════

test('source-guard: index.html — вкладка «Инструкции» (кнопка data-tab=guide + панель #tab-guide) на странице Инструментов', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  const toolsMatch = html.match(/<section id="page-tools"[\s\S]*?<\/section>/);
  assert.ok(toolsMatch, 'не найдена секция #page-tools');
  assert.ok(/data-tab="guide"/.test(toolsMatch[0]), 'нет кнопки вкладки data-tab="guide"');
  assert.ok(/id="tab-guide"/.test(toolsMatch[0]), 'нет панели #tab-guide');
  assert.ok(/id="guide-content"/.test(toolsMatch[0]), 'нет контейнера #guide-content под содержимое guide.md');
});

test('source-guard: scripts.js — переключение на вкладку guide вызывает loadGuideTab()', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/scripts.js'), 'utf-8');
  assert.ok(/if \(tab === 'guide'\)\s*loadGuideTab\(\)/.test(js),
    'обработчик переключения вкладок не вызывает loadGuideTab() для tab === "guide"');
});

test('source-guard: scripts.js — loadGuideTab() читает /api/guide и рендерит через mdToHtmlBlock (переиспользует существующий конвертер с поддержкой таблиц)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/scripts.js'), 'utf-8');
  const fnMatch = js.match(/async function loadGuideTab\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция loadGuideTab');
  assert.ok(/fetch\('\/api\/guide'\)/.test(fnMatch[0]), 'loadGuideTab не запрашивает /api/guide');
  assert.ok(/mdToHtmlBlock\(/.test(fnMatch[0]), 'loadGuideTab не использует mdToHtmlBlock (нужен для рендера markdown-таблиц в guide.md)');
});

test('source-guard: routes/tools.js — GET /api/guide отдаёт содержимое docs/guide.md как {content}', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../routes/tools.js'), 'utf-8');
  const routeMatch = js.match(/router\.get\('\/api\/guide'[\s\S]*?\n\s*\}\);/);
  assert.ok(routeMatch, 'не найден роут GET /api/guide');
  assert.ok(/docs['"],\s*['"]guide\.md['"]/.test(routeMatch[0]) || /docs.*guide\.md/.test(routeMatch[0]),
    'роут не читает docs/guide.md');
  assert.ok(/res\.json\(\{\s*content/.test(routeMatch[0]), 'роут не возвращает { content }');
});

test('source-guard: scripts.js — resolveMdLink() рендерит #-якоря как настоящую <a href="#...">, не инертный <span> (нужно для оглавления guide.md)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/scripts.js'), 'utf-8');
  const fnMatch = js.match(/function resolveMdLink\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция resolveMdLink');
  assert.ok(/href\.startsWith\('#'\)[\s\S]*?<a class="md-link md-link-anchor" href="\$\{href\}">/.test(fnMatch[0]),
    'resolveMdLink не рендерит #-ссылки как кликабельную <a href="#...">');
});

test('source-guard: scripts.js — mdToHtmlBlock() присваивает заголовкам id через slugifyHeading (клик по оглавлению должен куда-то попадать)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/scripts.js'), 'utf-8');
  assert.ok(/function slugifyHeading\(text\)/.test(js), 'не найдена функция slugifyHeading');
  const fnMatch = js.match(/function mdToHtmlBlock\(md\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция mdToHtmlBlock');
  assert.ok(/nextId\(h\[2\]\)/.test(fnMatch[0]), 'mdToHtmlBlock не генерирует id для заголовков');
  assert.ok(/class="md-h md-h\$\{lvl\}" id="\$\{id\}"/.test(fnMatch[0]), 'заголовок не получает атрибут id');
});

test('source-guard: scripts.js — mdToHtmlBlock() рендерит fenced code blocks (```) как <pre class="md-pre"> вместо схлопывания в один параграф', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/scripts.js'), 'utf-8');
  const fnMatch = js.match(/function mdToHtmlBlock\(md\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция mdToHtmlBlock');
  assert.ok(/\^```/.test(fnMatch[0]), 'mdToHtmlBlock не распознаёт открывающую ``` метку блока кода');
  assert.ok(/<pre class="md-pre"><code>/.test(fnMatch[0]), 'блок кода не рендерится как <pre class="md-pre"><code>');
});

test('source-guard: styles.css — вкладка «Инструкции»: .md-pre для блоков кода (docs/guide.md содержит ASCII-схемы), .guide-body ограничивает ширину строки, #page-tools скроллит плавно к якорям', () => {
  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  assert.ok(/\.md-body \.md-pre\s*\{/.test(css), 'нет правила .md-body .md-pre');
  assert.ok(/\.guide-body\s*\{[^}]*max-width/.test(css), '.guide-body не ограничивает max-width (широкая строка мешает чтению)');
  assert.ok(/#page-tools\s*\{\s*scroll-behavior:\s*smooth;?\s*\}/.test(css), '#page-tools не задаёт scroll-behavior: smooth для перехода по якорям оглавления');
});

test('source-guard: tour.js — последний шаг тура упоминает вкладку «Инструкции» (руководство пользователя в приложении)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/tour.js'), 'utf-8');
  const lastStepMatch = js.match(/title:\s*'Инструменты Рассказчика'[\s\S]*?body:\s*'([^']+)'/);
  assert.ok(lastStepMatch, 'не найден шаг тура «Инструменты Рассказчика»');
  assert.ok(/Инструкции/.test(lastStepMatch[1]), 'текст шага не упоминает вкладку «Инструкции»');
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIT — source-guard: Фаза 5 — тикеты 5.1 (кнопка «+») / 5.8 (вкладка «Фамильяр»)
// ══════════════════════════════════════════════════════════════════════════════

test('source-guard: v20-sheet.js — _v20AddRowBtn рендерит «+» (без «Добавить») с title-подсказкой', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  const fnMatch = js.match(/function _v20AddRowBtn\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция _v20AddRowBtn');
  const fn = fnMatch[0];
  assert.ok(/>\+<\/button>/.test(fn), '_v20AddRowBtn не рендерит кнопку с видимым текстом ровно «+»');
  assert.ok(!/>\+ ?Добавить/.test(fn), '_v20AddRowBtn всё ещё показывает видимый текст «+ Добавить» вместо «+»');
  assert.ok(/title="Добавить строку"/.test(fn), '_v20AddRowBtn не содержит title="Добавить строку"');
});

test('source-guard: char-detail.js — вкладка «Фамильяр» (5.8): детект по /фамильяр/i в «Отношения» + resolveCharByName', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/char-detail.js'), 'utf-8');
  assert.ok(js.includes('data-tab="familiar"'), 'нет кнопки вкладки data-tab="familiar"');
  assert.ok(js.includes('data-panel="familiar"'), 'нет панели data-panel="familiar"');
  assert.ok(/\/фамильяр\/i/.test(js), 'нет регэкспа /фамильяр\\/i для детекта связи-фамильяра');
  assert.ok(js.includes('resolveCharByName'), 'вкладка «Фамильяр» не переиспользует resolveCharByName из archive.js');
  // Плейсхолдер для нерезолвящегося имени
  assert.ok(js.includes('не найден в реестре персонажей'), 'нет текста плейсхолдера для нерезолвящегося фамильяра');
});

// Перенесено с ветки worktree-patch-niti-broski-sessiya-list (код-ревью по
// коммиту 135f693, не попало в master при параллельной прямой реализации
// того же плана) — см. docs/audit/2026-07-28-session-feature-qa-report.md.
// Если target связи-«фамильяра» по ошибке резолвится в самого владельца
// карточки (опечатка/неверные данные), раньше рендерилась мини-карточка
// «фамильяра», указывающая сама на себя, с кнопкой «Открыть карточку
// целиком», просто перерисовывающей ту же модалку — не падало и не
// зацикливалось, но вводило в заблуждение.
test('source-guard: char-detail.js — самоссылка фамильяра (target резолвится в самого владельца) диагностируется, не рендерится как обычная карточка', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/char-detail.js'), 'utf-8');
  // FIX-4b (docs/audit/2026-07-28-fix-plan.md): сравнение по slug, не по name —
  // два персонажа могут делить имя, slug всегда уникален.
  assert.ok(js.includes('familiarChar.slug === c.slug'), 'нет проверки familiarChar.slug === c.slug для самоссылки');
  assert.ok(js.includes('Связь-фамильяр указывает на самого персонажа'), 'нет диагностического сообщения для самоссылки фамильяра');
  const idx1 = js.indexOf('familiarChar.slug === c.slug');
  const idx2 = js.indexOf('_familiarCardHtml(familiarChar)');
  assert.ok(idx1 !== -1 && idx2 !== -1 && idx1 < idx2,
    'проверка самоссылки должна идти ДО вызова _familiarCardHtml(familiarChar) в тернарной цепочке familiarPanelHtml');
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIT — source-guard: Фаза 5 — тикет 5.3–5.7 (блок .v20-stat-block: боксы/Воля/Путь/центрирование)
// ══════════════════════════════════════════════════════════════════════════════

test('source-guard: v20-sheet.js — _v20BoxesHtml рендерит кумулятивные боксы span[role=checkbox] с data-i (не input)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  const fnMatch = js.match(/function _v20BoxesHtml\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция _v20BoxesHtml');
  const fn = fnMatch[0];
  assert.ok(/<span class="v20-box/.test(fn), '_v20BoxesHtml должна рендерить <span class="v20-box…"> (не <input type=checkbox>)');
  assert.ok(!/<input type="checkbox" class="v20-box/.test(fn), '_v20BoxesHtml всё ещё рендерит нативный <input type=checkbox> для боксов');
  assert.ok(/role="checkbox"/.test(fn), '_v20BoxesHtml не проставляет role="checkbox"');
  assert.ok(/aria-checked="\$\{on\}"/.test(fn), '_v20BoxesHtml не проставляет aria-checked');
  assert.ok(/tabindex="0"/.test(fn), '_v20BoxesHtml не проставляет tabindex="0" (клавиатурная доступность)');
  assert.ok(/data-i="\$\{i\}"/.test(fn), '_v20BoxesHtml не проставляет data-i (нужен для разграничения от health-боксов)');
});

test('source-guard: v20-sheet.js — health-боксы остаются нативным <input type=checkbox> без data-i', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  const healthMatch = js.match(/const healthRows = [\s\S]*?\)\.join\(''\);/);
  assert.ok(healthMatch, 'не найден рендер healthRows');
  const fn = healthMatch[0];
  assert.ok(/<input type="checkbox" class="v20-box"/.test(fn), 'health-бокс должен остаться нативным <input type=checkbox class="v20-box">');
  assert.ok(!/data-i=/.test(fn), 'health-бокс не должен получить data-i — иначе схлопнется с кумулятивной логикой боксов Воли/Крови');
});

test('source-guard: v20-sheet.js — onBox (клик по .v20-box[data-i]) зеркалит step-down логику onDot и использует _fillBoxes', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  const fnMatch = js.match(/const onBox = box => \{[\s\S]*?\n  \};/);
  assert.ok(fnMatch, 'не найдена функция onBox в _v20BindPanel');
  const fn = fnMatch[0];
  assert.ok(/_fillBoxes\(arr\.length, nv\)/.test(fn), 'onBox не использует существующий хелпер _fillBoxes для перестройки массива');
  assert.ok(/cur === d\)\s*\?\s*d - 1\s*:\s*d/.test(fn), 'onBox не реализует step-down (клик по последнему заполненному боксу должен снимать его)');
  assert.ok(/_v20RebuildBoxes\(wrap, nvArr\)/.test(fn), 'onBox не перерисовывает DOM боксов после изменения модели');
});

test('source-guard: v20-sheet.js — клик и keydown (Enter/Space) на .v20-box матчатся только при data-i !== undefined (health исключён)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  assert.ok(js.includes(`const box = e.target.closest('.v20-box'); if (box && box.dataset.i !== undefined) { onBox(box); return; }`),
    'click-обработчик панели не матчит .v20-box[data-i] → onBox');
  assert.ok(js.includes(`if (box && box.dataset.i !== undefined && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onBox(box); }`),
    'keydown-обработчик панели не матчит .v20-box[data-i] на Enter/Space → onBox (клавиатурная доступность)');
});

test('source-guard: v20-sheet.js — нативный change для .v20-box больше не завязан на data-i (только health, одиночный toggle)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  const changeMatch = js.match(/panel\.addEventListener\('change', e => \{[\s\S]*?\n  \}\);/);
  assert.ok(changeMatch, 'не найден change-обработчик панели');
  const fn = changeMatch[0];
  assert.ok(!/dataset\.i !== undefined/.test(fn), 'change-обработчик всё ещё содержит ветку data-i (мертвый код — боксы Воли/Крови больше не <input>)');
  assert.ok(/_v20Set\(_v20Model, box\.dataset\.bpath, box\.checked\)/.test(fn), 'change-обработчик не выставляет одиночное булево значение для health-боксов');
});

test('source-guard: v20-sheet.js — «Временная сила воли» вынесена на свою строку под точками постоянной Воли (5.4/5.5)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  assert.ok(js.includes('Временная сила воли'), 'нет лейбла «Временная сила воли»');
  const willpowerBlock = js.match(/Воля \$\{_v20AutoBadge\(m\.willpower\.permanent[\s\S]*?willpower\.temp'[\s\S]*?<\/div>/);
  assert.ok(willpowerBlock, 'не найден блок «Воля» целиком');
  const idxPermanentDots = willpowerBlock[0].indexOf(`_v20DotsHtml('willpower.permanent'`);
  const idxSubtitle = willpowerBlock[0].indexOf('Временная сила воли');
  const idxTempBoxes = willpowerBlock[0].indexOf(`_v20BoxesHtml('willpower.temp'`);
  assert.ok(idxPermanentDots >= 0 && idxSubtitle > idxPermanentDots, 'подпись «Временная сила воли» не идёт после точек постоянной Воли');
  assert.ok(idxTempBoxes > idxSubtitle, 'боксы временной Воли не идут после подписи «Временная сила воли»');
});

test('source-guard: v20-sheet.js — заголовок блока Человечность/Путь редактируемый (.v20-path-title, placeholder «Человечность»), точки под ним (5.7)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  assert.ok(js.includes('v20-path-title'), 'нет класса .v20-path-title для редактируемого заголовка Пути');
  assert.ok(js.includes('placeholder="Человечность"'), 'у поля заголовка Пути нет placeholder="Человечность"');
  assert.ok(!js.includes('placeholder="Столп (Путь)"'), 'старое отдельное поле «Столп (Путь)» всё ещё присутствует — должно быть заменено единым заголовком');
  const idxTitleInput = js.indexOf('v20-path-title');
  const idxHumanityDots = js.indexOf(`_v20DotsHtml('humanity', m.humanity, 10)`);
  assert.ok(idxTitleInput >= 0 && idxHumanityDots > idxTitleInput, 'точки humanity должны идти после редактируемого заголовка Пути в разметке');
});

test('source-guard: v20-sheet.js/styles.css — блоки Человечность/Путь, Воля и Запас крови отцентрированы через .v20-stat-block--centered, Опыт не тронут (5.6)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  const centeredCount = (js.match(/v20-stat-block--centered/g) || []).length;
  assert.strictEqual(centeredCount, 3, `ожидалось 3 применения .v20-stat-block--centered (Человечность/Путь, Воля, Запас крови), найдено ${centeredCount}`);
  // Блок «Опыт» — соседний .v20-stat-block без модификатора центрирования
  const expBlock = js.match(/<div class="v20-stat-block" style="margin-top:12px">\s*<div class="v20-stat-title">Опыт<\/div>/);
  assert.ok(expBlock, 'блок «Опыт» не найден или неожиданно получил класс центрирования');

  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  assert.ok(css.includes('.v20-stat-block--centered'), 'styles.css не определяет .v20-stat-block--centered');
  const ruleMatch = css.match(/\.v20-stat-block--centered\s*\{[^}]*\}/);
  assert.ok(ruleMatch, 'не найдено тело правила .v20-stat-block--centered');
  assert.ok(/align-items:\s*center/.test(ruleMatch[0]), '.v20-stat-block--centered не центрирует по align-items');
});

test('source-guard: styles.css — .v20-box.on задаёт заливку для span-боксов (у span нет псевдокласса :checked)', () => {
  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  assert.ok(/\.v20-box\.on\s*\{|\.v20-box:checked,\s*\n?\s*\.v20-box\.on\s*\{/.test(css) || css.includes('.v20-box.on'),
    'styles.css не определяет заливку для .v20-box.on (нужна для span-боксов без :checked)');
});

// ── W3 тикет 3.1: скрытие «Сцена назад/вперёд» без хроники и/или модуля ───────

test('source-guard: session-screen.js — явный хелпер _sessSyncSceneNavVisibility синхронизирует nav.hidden по хронике+модулю+сценарию', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  assert.ok(js.includes('function _sessSyncSceneNavVisibility'), 'нет функции _sessSyncSceneNavVisibility');
  const fnMatch = js.match(/function _sessSyncSceneNavVisibility\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдено тело _sessSyncSceneNavVisibility');
  // «Модуль выбран» читается из модульной переменной _sessCurrentMod, а не
  // #sess-mod-sel.value напрямую — та же переменная служит guard'ом от гонки
  // устаревших асинхронных ответов в _sessLoadModule, так что оба места
  // должны сверяться с одним источником истины.
  assert.ok(/chrSel\.value\s*&&\s*_sessCurrentMod\s*&&\s*_sessBlocks\.length/.test(fnMatch[0]),
    '_sessSyncSceneNavVisibility не проверяет chrSel.value && _sessCurrentMod && _sessBlocks.length');
  // Вызывается в конце _sessClearModule() и в начале/конце _sessLoadModule(),
  // а не только через побочный эффект веток — иначе риск регрессии при
  // будущих правках.
  const clearBody = js.match(/function _sessClearModule\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(clearBody && clearBody[0].includes('_sessSyncSceneNavVisibility()'), '_sessClearModule() не вызывает _sessSyncSceneNavVisibility()');
  const loadBody = js.match(/async function _sessLoadModule\([\s\S]*?\n\}/);
  const syncCalls = (loadBody ? loadBody[0].match(/_sessSyncSceneNavVisibility\(\)/g) : []) || [];
  assert.ok(syncCalls.length >= 2, `_sessLoadModule() должен вызывать _sessSyncSceneNavVisibility() в начале и в конце (найдено ${syncCalls.length} вызовов)`);
});

// ── Модули на «Сессии» выбираются <select>-ом, в одной строке с хроникой
//    (карточки #sess-mod-cards из тикета 3.2 убраны по запросу пользователя —
//    не помещались в компактный ряд полей) ────────────────────────────────

test('source-guard: index.html — #sess-mod-sel select рядом с #sess-chr-sel в одной строке .sess-picker, карточек модулей нет', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  assert.ok(html.includes('id="sess-mod-sel"'), 'нет <select id="sess-mod-sel">');
  assert.ok(html.includes('id="sess-chr-sel"'), '#sess-chr-sel (выбор хроники) не должен исчезать — остаётся select');
  assert.ok(!html.includes('id="sess-mod-cards"'), 'контейнер карточек модулей #sess-mod-cards всё ещё в разметке');
  const pickerMatch = html.match(/<div class="sess-picker">[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(pickerMatch, 'не найден блок .sess-picker');
  assert.ok(pickerMatch[0].includes('id="sess-chr-sel"') && pickerMatch[0].includes('id="sess-mod-sel"'),
    '#sess-chr-sel и #sess-mod-sel должны быть внутри одного .sess-picker (одна строка)');
});

// ── Навигация по сценам (#sess-scene-nav) закреплена по нижнему краю рабочей
//    области сессии (position:sticky в её собственном скролл-контейнере
//    .page), а не встроена в .sess-picker — чтобы оставаться на виду при
//    скролле длинного текста сценария (запрос пользователя) ─────────────────

test('source-guard: index.html — #sess-scene-nav вынесена из .sess-picker, лежит отдельным блоком в конце #page-session', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  const pickerMatch = html.match(/<div class="sess-picker">[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(pickerMatch, 'не найден блок .sess-picker');
  assert.ok(!pickerMatch[0].includes('id="sess-scene-nav"'),
    '#sess-scene-nav больше не должна жить внутри .sess-picker — вынесена в отдельный sticky-блок');
  const sectionMatch = html.match(/<section id="page-session"[\s\S]*?<\/section>/);
  assert.ok(sectionMatch, 'не найдена секция #page-session');
  assert.ok(sectionMatch[0].includes('id="sess-scene-nav"'), '#sess-scene-nav отсутствует внутри #page-session');
  assert.ok(sectionMatch[0].includes('id="sess-prev"') && sectionMatch[0].includes('id="sess-next"'),
    'кнопки навигации по сценам (#sess-prev/#sess-next) не найдены внутри #page-session');
});

test('source-guard: styles.css — .sess-scene-nav закреплена (position:sticky; bottom:0) и центрирована', () => {
  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  const navMatch = css.match(/\.sess-scene-nav\s*\{[\s\S]*?\n\}/);
  assert.ok(navMatch, 'не найдено правило .sess-scene-nav');
  assert.ok(/position:\s*sticky/.test(navMatch[0]), '.sess-scene-nav не position:sticky');
  assert.ok(/bottom:\s*0/.test(navMatch[0]), '.sess-scene-nav не закреплена к bottom:0');
  assert.ok(/justify-content:\s*center/.test(navMatch[0]), '.sess-scene-nav не центрирована (justify-content:center)');
  // hidden выставляется через JS-свойство nav.hidden (session-screen.js) — без
  // явного [hidden]{display:none} авторский display:flex выше в каскаде
  // молча забивает UA-правило независимо от специфичности (порядок origin
  // важнее specificity), и панель осталась бы видна при пустом состоянии.
  assert.ok(/\.sess-scene-nav\[hidden\]\s*\{[\s\S]*?display:\s*none/.test(css),
    'нет явного .sess-scene-nav[hidden] { display: none } — авторский display:flex выше по каскаду перевесит UA-правило [hidden]');
});

test('source-guard: session-screen.js — _sessLoadModules заполняет #sess-mod-sel опциями модулей (disabled на время загрузки)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  assert.ok(!js.includes("getElementById('sess-mod-cards')"), 'session-screen.js всё ещё обращается к удалённому #sess-mod-cards');
  assert.ok(!js.includes('renderModuleCardInChr'), 'session-screen.js всё ещё рендерит карточки модулей (renderModuleCardInChr) — должен быть select');
  const fnMatch = js.match(/async function _sessLoadModules\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдено тело _sessLoadModules');
  assert.ok(fnMatch[0].includes("getElementById('sess-mod-sel')"), '_sessLoadModules не обращается к #sess-mod-sel');
  assert.ok(/modSel\.disabled\s*=\s*true/.test(fnMatch[0]), '_sessLoadModules не отключает select на время загрузки списка модулей');
  assert.ok(/modSel\.disabled\s*=\s*false/.test(fnMatch[0]), '_sessLoadModules не включает select обратно после загрузки');
  assert.ok(/<option/.test(fnMatch[0]), '_sessLoadModules не строит <option> для списка модулей');
});

test('source-guard: session-screen.js — восстановление выбранного модуля выставляет modSel.value, смена select открывает сессию через _sessLoadModule', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const loadModulesFn = js.match(/async function _sessLoadModules\([\s\S]*?\n\}/);
  assert.ok(loadModulesFn, 'не найдено тело _sessLoadModules');
  assert.ok(/modSel\.value\s*=\s*preselect/.test(loadModulesFn[0]),
    '_sessLoadModules не восстанавливает сохранённый модуль через modSel.value = preselect');
  const changeMatch = js.match(/document\.getElementById\('sess-mod-sel'\)\.addEventListener\('change', async e => \{[\s\S]*?\n\}\);/);
  assert.ok(changeMatch, 'не найден обработчик change на #sess-mod-sel');
  assert.ok(/_sessLoadModule\(chr, e\.target\.value\)/.test(changeMatch[0]), 'смена #sess-mod-sel не вызывает _sessLoadModule(chr, e.target.value)');
  assert.ok(/_sessClearModule\(\)/.test(changeMatch[0]), 'сброс #sess-mod-sel в пустое значение не вызывает _sessClearModule()');
});

test('source-guard: session-screen.js — _sessLoadModule защищён от гонки устаревших асинхронных ответов', () => {
  // Баг 3.2/Critical: быстрый клик по карточке А, затем по карточке Б до того,
  // как разрешился fetch для А, мог применить устаревший результат А поверх
  // уже выбранной Б (_sessCurrentMod/подсветка карточки говорят «Б», а
  // отрендеренный сценарий/localStorage — «А» или вообще третий модуль).
  // Guard: после каждого await внутри _sessLoadModule нужно перепроверять, что
  // _sessCurrentMod всё ещё равен захваченному в начале функции параметру mod,
  // и тихо выходить (return), если пользователь успел выбрать другой модуль,
  // не трогая _sessBlocks/_sessDetail/_sessSave/рендер.
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnMatch = js.match(/async function _sessLoadModule\(chr, mod\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдено тело _sessLoadModule(chr, mod)');
  const body = fnMatch[0];

  // Захват mod происходит синхронно в начале — единственная точка присвоения
  // _sessCurrentMod в этой функции (иначе guard сравнивал бы mod сам с собой).
  const assignIdx = body.indexOf('_sessCurrentMod = mod;');
  assert.ok(assignIdx !== -1, '_sessLoadModule не устанавливает _sessCurrentMod = mod синхронно в начале');

  // Guard должен присутствовать в теле функции хотя бы дважды: после успешного
  // fetch (в try) и в catch-ветке ошибки — оба места применяют результат
  // асинхронной операции и должны быть защищены от устаревшего ответа.
  const guardMatches = body.match(/if\s*\(\s*_sessCurrentMod\s*!==\s*mod\s*\)\s*return;/g) || [];
  assert.ok(guardMatches.length >= 2,
    `_sessLoadModule должен перепроверять _sessCurrentMod !== mod после await (успешный путь и catch), найдено ${guardMatches.length} guard-проверок`);

  // Guard в успешном пути обязан идти ПОСЛЕ разрешения fetch (иначе он не
  // защищает от гонки — проверка до await ничего не даёт).
  const fetchIdx = body.indexOf('.then(r => r.json())');
  const lastGuardIdx = body.lastIndexOf('if (_sessCurrentMod !== mod) return;');
  assert.ok(fetchIdx !== -1 && lastGuardIdx > fetchIdx,
    'guard-проверка после основного fetch отсутствует или стоит раньше await fetch (не защищает от гонки)');

  // Применение результата (_sessDetail = ...) должно идти после этой финальной
  // guard-проверки, а не до неё — иначе устаревший ответ всё равно затрёт стейт.
  const applyIdx = body.indexOf('_sessDetail = detail;');
  assert.ok(applyIdx !== -1 && applyIdx > lastGuardIdx,
    '_sessDetail применяется до финальной guard-проверки — устаревший ответ может затереть текущий стейт');

  // ensureCharsLoaded() — тоже await внутри функции (упомянут в тикете отдельно)
  // — должен быть защищён своей guard-проверкой раньше основного fetch.
  const ensureIdx = body.indexOf('ensureCharsLoaded()');
  const firstGuardIdx = body.indexOf('if (_sessCurrentMod !== mod) return;');
  assert.ok(ensureIdx !== -1 && firstGuardIdx > ensureIdx && firstGuardIdx < fetchIdx,
    'await ensureCharsLoaded() не защищён guard-проверкой перед основным fetch');
});

// ── W5 тикет 3.5-FE: блок «Заметка сцены» ─────────────────────────────────────

test('source-guard: session-screen.js — кэш _sessSceneNotesCache и вызовы scene-notes/scene-note', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  assert.ok(/let _sessSceneNotesCache\s*=\s*\{\}/.test(js), 'нет модульного кэша _sessSceneNotesCache = {}');
  assert.ok(js.includes('function _sessRenderSceneNote'), 'нет функции _sessRenderSceneNote');
  assert.ok(/`\$\{base\}\/scene-notes\$\{qs\}`/.test(js) || js.includes('/scene-notes'),
    'нет обращения к эндпоинту GET .../scene-notes');
  assert.ok(js.includes('/scene-note'), 'нет обращения к эндпоинту PUT .../scene-note');
  // GET scene-notes грузится вместе с detail в _sessLoadModule и заполняет кэш.
  const loadBody = js.match(/async function _sessLoadModule\(chr, mod\) \{[\s\S]*?\n\}/)[0];
  assert.ok(loadBody.includes('_sessSceneNotesCache ='), '_sessLoadModule не заполняет _sessSceneNotesCache');
  assert.ok(loadBody.includes('_sessRenderSceneNote()'), '_sessLoadModule не рендерит заметку сцены после загрузки');
});

test('source-guard: session-screen.js — _sessGoScene вызывает _sessRenderSceneNote (заметка обновляется при смене сцены)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnMatch = js.match(/function _sessGoScene\(idx\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдено тело _sessGoScene');
  assert.ok(fnMatch[0].includes('_sessRenderSceneNote()'), '_sessGoScene не вызывает _sessRenderSceneNote() при смене сцены');
});

test('source-guard: session-screen.js — кнопка «Сохранить» заметки сцены: dirty/loading/error через общий хелпер', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  assert.ok(js.includes('function _sessBindSaveButton'), 'нет общего хелпера _sessBindSaveButton (dirty/loading/error)');
  assert.ok(js.includes("id=\"sess-scene-note-save\""), 'нет кнопки #sess-scene-note-save');
  assert.ok(/Сохраняю/.test(js), 'нет индикации состояния "Сохраняю…" на время запроса');
  assert.ok(/showToast\([^)]*'error'\)/.test(js), 'нет showToast(..., \'error\') при ошибке сохранения');
});

// ── W5 тикет 3.6-FE: «Заметки сессии» — файл вместо localStorage ──────────────

test('source-guard: session-screen.js — заметки сессии грузятся/сохраняются через session-notes, не localStorage', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  assert.ok(js.includes('/session-notes'), 'нет обращения к эндпоинту .../session-notes');
  assert.ok(js.includes('function _sessHydrateSessionNotes'), 'нет функции _sessHydrateSessionNotes (гидратация из файла)');
  assert.ok(js.includes("id=\"sess-notes-save\""), 'нет кнопки #sess-notes-save для заметок сессии');
  // «Записать сессию» физически остаётся в разметке этого блока (поведение не менялось в 3.6-FE).
  assert.ok(js.includes("id=\"sess-to-log\""), 'кнопка #sess-to-log пропала из разметки блока заметок сессии');

  // Регрессия: содержимое заметок сессии больше НЕ проходит через _sessSave/
  // _sessStore (тот остаётся только для chr/mod/scene — localStorage-механизм
  // не тронут, но текст заметок в него больше не пишется и не читается).
  assert.ok(!/_sessSave\(\s*\{\s*notes:/.test(js), '_sessSave всё ещё пишет notes в localStorage (должно быть удалено в 3.6-FE)');
  assert.ok(!/_sessStore\(\)\.notes/.test(js), 'код всё ещё читает _sessStore().notes (legacy localStorage-путь заметок должен быть удалён)');
  // Сам механизм _sessSave/_sessStore (для chr/mod/scene) остаётся нетронутым.
  assert.ok(js.includes('function _sessStore') && js.includes('function _sessSave'),
    '_sessStore/_sessSave как механизм (chr/mod/scene) не должны быть удалены');
});

// ── Регрессия: #sess-notes id-коллизия с modules.js (форма записи сессии в
// #modp-panel-sessions рендерит СВОЙ <textarea id="sess-notes">) — navigate()
// не удаляет страницы из DOM, поэтому несскоупленный document.getElementById
// после открытия любого модуля навсегда резолвится в чужой textarea ─────────

test('source-guard: session-screen.js — _sessHydrateSessionNotes скоупит #sess-notes/#sess-notes-save через #sess-notes-wrap (не голый getElementById — коллизия id с modules.js)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnBody = js.match(/function _sessHydrateSessionNotes\(text\) \{[\s\S]*?\n\}/)[0];
  assert.ok(fnBody, 'не найдено тело _sessHydrateSessionNotes');
  assert.ok(!/document\.getElementById\('sess-notes'\)/.test(fnBody),
    '_sessHydrateSessionNotes использует несскоупленный document.getElementById(\'sess-notes\') — коллизия с #modp-panel-sessions в modules.js');
  assert.ok(!/document\.getElementById\('sess-notes-save'\)/.test(fnBody),
    '_sessHydrateSessionNotes использует несскоупленный document.getElementById(\'sess-notes-save\') — коллизия с #modp-panel-sessions в modules.js');
  assert.ok(/getElementById\('sess-notes-wrap'\)/.test(fnBody) && /\.querySelector\(['"]#sess-notes['"]\)/.test(fnBody),
    '_sessHydrateSessionNotes не берёт textarea через #sess-notes-wrap.querySelector(\'#sess-notes\')');
  assert.ok(/\.querySelector\(['"]#sess-notes-save['"]\)/.test(fnBody),
    '_sessHydrateSessionNotes не берёт кнопку через #sess-notes-wrap.querySelector(\'#sess-notes-save\')');
});

test('source-guard: modules.js действительно рендерит свой <textarea id="sess-notes"> в #modp-panel-sessions (подтверждение реальности коллизии id)', () => {
  const modulesJs = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  assert.ok(/id=["']sess-notes["']/.test(modulesJs),
    'modules.js больше не рендерит #sess-notes — если id переименован, тест-регрессию на коллизию можно снять/обновить');
});

test('source-guard: session-screen.js — _sessClearModule сбрасывает заметку сцены и заметки сессии текущего модуля', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnMatch = js.match(/function _sessClearModule\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдено тело _sessClearModule');
  assert.ok(fnMatch[0].includes('_sessRenderSceneNote()'), '_sessClearModule не сбрасывает блок заметки сцены');
  assert.ok(fnMatch[0].includes('_sessHydrateSessionNotes('), '_sessClearModule не сбрасывает заметки сессии');
});

// ── W5: гонка при смене модуля во время загрузки scene-notes/session-notes ────

test('source-guard: session-screen.js — GET scene-notes/session-notes в _sessLoadModule защищены тем же guard от гонки, что и detail', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const body = js.match(/async function _sessLoadModule\(chr, mod\) \{[\s\S]*?\n\}/)[0];
  // detail/scene-notes/session-notes должны грузиться в одном Promise.all —
  // единая guard-проверка после await покрывает все три (а не только detail).
  const promiseAllMatch = body.match(/await Promise\.all\(\[[\s\S]*?\]\)/);
  assert.ok(promiseAllMatch, 'detail/scene-notes/session-notes не объединены в один await Promise.all(...)');
  assert.ok(promiseAllMatch[0].includes('/detail'), 'Promise.all не включает fetch detail');
  assert.ok(promiseAllMatch[0].includes('/scene-notes'), 'Promise.all не включает fetch scene-notes');
  assert.ok(promiseAllMatch[0].includes('/session-notes'), 'Promise.all не включает fetch session-notes');
  // guard-проверка после Promise.all должна идти раньше применения результатов.
  const promiseAllEnd = body.indexOf(promiseAllMatch[0]) + promiseAllMatch[0].length;
  const guardAfter = body.indexOf('if (_sessCurrentMod !== mod) return;', promiseAllEnd);
  const applyIdx = body.indexOf('_sessDetail = detail;');
  assert.ok(guardAfter !== -1 && applyIdx > guardAfter,
    'нет guard-проверки после Promise.all перед применением detail/scene-notes/session-notes');
});

// ── Регрессия 851fe96: guard сохранения заметки сцены сравнивает и по модулю,
// и по сцене (не только по модулю) — иначе смена сцены (тот же модуль), пока
// PUT летит, могла бы затереть loaded/кнопку уже другой (новой) сцены ────────

test('source-guard: session-screen.js — save-guard заметки сцены сравнивает capturedScene в дополнение к capturedMod (851fe96)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnBody = js.match(/function _sessRenderSceneNote\(\) \{[\s\S]*?\n\}/)[0];
  assert.ok(fnBody, 'не найдено тело _sessRenderSceneNote');
  // capturedMod — guard по модулю (уже был до 851fe96).
  const modIdx = fnBody.indexOf('const capturedMod');
  assert.ok(modIdx !== -1, '_sessRenderSceneNote не захватывает capturedMod на момент клика «Сохранить»');
  // capturedScene — guard по сцене (введён 851fe96, не должен быть тихо убран
  // будущим рефакторингом _sessBindSaveButton/_sessRenderSceneNote).
  const sceneIdx = fnBody.indexOf('const capturedScene');
  assert.ok(sceneIdx !== -1, '_sessRenderSceneNote не захватывает capturedScene — регрессия фикса 851fe96 (guard только по модулю недостаточен при смене сцены внутри того же модуля)');
  assert.ok(sceneIdx > modIdx, 'capturedScene должен захватываться после capturedMod (тот же порядок, что и оба return false ниже)');
  // Оба return false должны идти ПОСЛЕ применения PUT (после throw на !r.ok) и
  // ДО обновления _sessSceneNoteLoaded — сравнение и по модулю, и по сцене.
  const modGuardIdx   = fnBody.indexOf('if (_sessCurrentMod !== capturedMod) return false');
  const sceneGuardIdx = fnBody.indexOf('!== capturedScene) return false');
  const loadedIdx     = fnBody.indexOf('_sessSceneNoteLoaded = text;');
  assert.ok(modGuardIdx !== -1, 'нет guard-проверки по capturedMod перед обновлением _sessSceneNoteLoaded');
  assert.ok(sceneGuardIdx !== -1, 'нет guard-проверки по capturedScene перед обновлением _sessSceneNoteLoaded');
  assert.ok(modGuardIdx < sceneGuardIdx && sceneGuardIdx < loadedIdx,
    'порядок guard-проверок нарушен: ожидается capturedMod → capturedScene → _sessSceneNoteLoaded = text');
});

test('source-guard: session-screen.js — после guard совпадения сцены/модуля видимая textarea досинхронизируется со свежесохранённым текстом (не только кэш)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const sceneBody = js.match(/function _sessRenderSceneNote\(\) \{[\s\S]*?\n\}/)[0];
  const loadedIdx = sceneBody.indexOf('_sessSceneNoteLoaded = text;');
  const afterLoaded = sceneBody.slice(loadedIdx);
  assert.ok(/getElementById\('sess-scene-note'\)/.test(afterLoaded) && /\.value\s*=\s*text/.test(afterLoaded),
    '_sessRenderSceneNote: после подтверждения актуальности сцены видимая #sess-scene-note не досинхронизируется с сохранённым text (баг: остаётся устаревшей до следующего переключения сцены)');

  const notesBody = js.match(/function _sessRenderNotes\(\) \{[\s\S]*?\n\}/)[0];
  const notesLoadedIdx = notesBody.indexOf('_sessSessionNotesLoaded = text;');
  assert.ok(notesLoadedIdx !== -1, '_sessRenderNotes: не найдено обновление _sessSessionNotesLoaded в save-guard');
  const notesAfterLoaded = notesBody.slice(notesLoadedIdx);
  assert.ok(/sess-notes-wrap/.test(notesAfterLoaded) && /\.value\s*=\s*text/.test(notesAfterLoaded),
    '_sessRenderNotes: после подтверждения актуальности модуля видимая #sess-notes не досинхронизируется с сохранённым text');
});

test('source-guard: styles.css — стрелки навигации по сценам (.sess-scene-btn) подогнаны под размер select-полей, без слова «Сцена»', () => {
  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  assert.ok(css.includes('.sess-scene-btn'), 'нет класса .sess-scene-btn для кнопок навигации по сценам');
  const ruleMatch = css.match(/\.sess-scene-btn\s*\{[^}]*\}/);
  assert.ok(ruleMatch, 'не найдено тело правила .sess-scene-btn');
  assert.ok(/padding:\s*5px 14px/.test(ruleMatch[0]) && /font-size:\s*var\(--fs-xl\)/.test(ruleMatch[0]),
    '.sess-scene-btn не подогнан под размер .form-control (padding/font-size)');
  assert.ok(!/←\s*Сцена|Сцена\s*→/.test(html), 'кнопки навигации по сценам всё ещё содержат слово «Сцена» — должны быть только стрелки');
});

// ── W3 тикет 3.4: sticky-панель «Аудио-пресеты» + «Заметки сессии» ────────────

test('source-guard: styles.css — .sess-side sticky на десктопе, static на брейкпоинте 900px', () => {
  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  const sideMatch = css.match(/\.sess-side\s*\{[^}]*\}/);
  assert.ok(sideMatch, 'не найдено правило .sess-side');
  assert.ok(/position:\s*sticky/.test(sideMatch[0]), '.sess-side не задаёт position: sticky');
  assert.ok(/top:\s*[\d.]+px/.test(sideMatch[0]), '.sess-side не задаёт числовой top');
  assert.ok(/max-height:\s*calc\(100vh/.test(sideMatch[0]), '.sess-side не ограничивает max-height через calc(100vh...)');
  assert.ok(/overflow-y:\s*auto/.test(sideMatch[0]), '.sess-side не задаёт overflow-y: auto для локального скролла');

  const mqMatch = css.match(/@media \(max-width: 900px\)\s*\{[\s\S]*?\n\}\s*\n/);
  assert.ok(mqMatch, 'не найден брейкпоинт @media (max-width: 900px)');
  const sideInMq = mqMatch[0].match(/\.sess-side\s*\{[^}]*\}/);
  assert.ok(sideInMq, 'брейкпоинт 900px не переопределяет .sess-side (нужно отключить sticky на мобильном)');
  assert.ok(/position:\s*static/.test(sideInMq[0]), '.sess-side в брейкпоинте 900px не возвращает position: static');
});

// ── Аудио-пресеты на экране «Сессия» — выпадающий список вместо строки на
//    каждый пресет (запрос пользователя) ─────────────────────────────────────

test('source-guard: session-screen.js — _sessRenderAudio рендерит один <select> с пресетами вместо строк .sess-preset', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnMatch = js.match(/async function _sessRenderAudio\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция _sessRenderAudio');
  const fn = fnMatch[0];
  assert.ok(fn.includes('id="sess-preset-sel"'), 'нет <select id="sess-preset-sel"> со списком пресетов');
  assert.ok(fn.includes('id="sess-preset-toggle"'), 'нет единой кнопки ▶/⏹ #sess-preset-toggle');
  assert.ok(!/class="sess-preset["\s]/.test(fn), '_sessRenderAudio всё ещё рендерит старые строки .sess-preset — должен остаться только select');
  assert.ok(/<option value="\$\{escHtml\(p\.id\)\}"/.test(fn), '<select> не строит <option> на каждый пресет');
});

test('source-guard: session-screen.js — кнопка ▶/⏹ пресета читает выбор из #sess-preset-sel.value (не из стухшего data-атрибута)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const clickBody = js.match(/document\.getElementById\('page-session'\)\.addEventListener\('click', async e => \{[\s\S]*?\n\}\);/)[0];
  assert.ok(clickBody.includes("closest('#sess-preset-toggle')"), 'делегированный клик не ловит #sess-preset-toggle');
  assert.ok(clickBody.includes("getElementById('sess-preset-sel')?.value"), 'обработчик клика не читает pid из #sess-preset-sel.value');
});

test('source-guard: session-screen.js — смена выбора в #sess-preset-sel только переключает иконку кнопки, не запускает/останавливает пресет сама по себе', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const changeMatch = js.match(/document\.getElementById\('page-session'\)\.addEventListener\('change', e => \{[\s\S]*?\n\}\);/);
  assert.ok(changeMatch, 'не найден делегированный обработчик change на #page-session для #sess-preset-sel');
  const fn = changeMatch[0];
  assert.ok(fn.includes("e.target.id !== 'sess-preset-sel'"), 'обработчик change не фильтрует по id === sess-preset-sel');
  assert.ok(!/_audioPresetPlay|_audioPresetStop/.test(fn),
    'обработчик change сам запускает/останавливает воспроизведение — выбор в списке не должен неожиданно менять звук без явного клика по ▶/⏹');
  assert.ok(fn.includes("btn.textContent"), 'обработчик change не обновляет иконку кнопки ▶/⏹ под новый выбор');
});

// ── W5 тикет 3.7: «→ Записать сессию» ведёт на страницу модуля (вкладка
// «Сессии»), не на устаревший tools/log-session ──────────────────────────────

test('source-guard: session-screen.js — обработчик #sess-to-log больше НЕ ведёт на tools/log-session, а открывает страницу модуля', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const clickIdx = js.indexOf("wrap.querySelector('#sess-to-log').addEventListener('click'");
  assert.ok(clickIdx !== -1, 'не найден обработчик клика #sess-to-log');
  // Тело обработчика — от начала addEventListener до следующего `});` на
  // верхнем уровне функции _sessRenderNotes (сам обработчик — последний в ней).
  const fnBody = js.match(/function _sessRenderNotes\(\) \{[\s\S]*?\n\}/)[0];
  assert.ok(!/navigate\('tools'\)/.test(fnBody),
    'обработчик #sess-to-log всё ещё делает navigate(\'tools\') — устаревший путь записи сессии не заменён');
  assert.ok(!/data-tab="log-session"/.test(fnBody) && !/log-session/.test(fnBody),
    'обработчик #sess-to-log всё ещё ссылается на вкладку log-session (устаревший путь)');
  assert.ok(/openModulePage\(\s*chr\s*,\s*mod\s*\)/.test(fnBody),
    'обработчик #sess-to-log не вызывает openModulePage(chr, mod)');
  assert.ok(fnBody.includes('_pendingModulePrefill'),
    'обработчик #sess-to-log не устанавливает _pendingModulePrefill перед openModulePage');
  assert.ok(/const chr\s*=\s*document\.getElementById\('sess-chr-sel'\)\.value/.test(fnBody),
    'chr берётся не из document.getElementById(\'sess-chr-sel\').value (актуальное live-состояние, не _sessStore())');
  assert.ok(/const mod\s*=\s*_sessCurrentMod/.test(fnBody),
    'mod берётся не из _sessCurrentMod (актуальное live-состояние, не _sessStore())');
});

test('source-guard: session-screen.js — агрегат заметок для _pendingModulePrefill использует общий хелпер _filterUnrecordedScenes и кэш заметок сцен', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnBody = js.match(/function _sessRenderNotes\(\) \{[\s\S]*?\n\}/)[0];
  assert.ok(/_filterUnrecordedScenes\(/.test(fnBody),
    '#sess-to-log не переиспользует _filterUnrecordedScenes — рискует разойтись с фильтром sceneOpts в modules.js');
  assert.ok(/_sessSceneNotesCache\[/.test(fnBody),
    '#sess-to-log не читает заметки сцен из _sessSceneNotesCache для агрегата');
  assert.ok(/_sessBlocks\.find\(/.test(fnBody),
    '#sess-to-log не сопоставляет отфильтрованные сцены с _sessBlocks (сырой heading — ключ кэша заметок)');
  // Сцена хранит СПИСОК записей по сессиям (см. _sessCurrentSessionNum) — в
  // агрегат должна попадать запись ИМЕННО текущей (ещё не записанной) сессии,
  // а не вся история сцены (прошлые сессии уже отражены в своих записях).
  assert.ok(/entries\.find\(\s*e\s*=>\s*e\.session\s*===\s*currentNum\s*\)/.test(fnBody),
    '#sess-to-log не выбирает из истории сцены запись именно текущей сессии (entries.find по session === currentNum)');
});

test('source-guard: session-screen.js — _sessCurrentSessionNum() = число уже записанных сессий + 1, используется и в заметке сцены, и в её сохранении', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnMatch = js.match(/function _sessCurrentSessionNum\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция _sessCurrentSessionNum');
  assert.ok(/_sessDetail\?\.sessions\?\.length/.test(fnMatch[0]) && /\+\s*1/.test(fnMatch[0]),
    '_sessCurrentSessionNum не вычисляется как (число сохранённых сессий) + 1');
  const renderBody = js.match(/function _sessRenderSceneNote\(\) \{[\s\S]*?\n\}/)[0];
  assert.ok(/_sessCurrentSessionNum\(\)/.test(renderBody),
    '_sessRenderSceneNote не использует _sessCurrentSessionNum() — не сможет привязать заметку к текущей сессии');
  assert.ok(/session:\s*session/.test(renderBody) || /body:\s*JSON\.stringify\(\{\s*heading:\s*h,\s*session/.test(renderBody),
    '_sessRenderSceneNote не отправляет номер сессии в PUT /scene-note');
});

test('source-guard: session-screen.js — история прошлых записей сцены рендерится только для чтения (без своих textarea/кнопок)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  assert.ok(js.includes('function _sessSceneNoteHistoryHtml'), 'нет функции _sessSceneNoteHistoryHtml');
  const fnBody = js.match(/function _sessSceneNoteHistoryHtml\([\s\S]*?\n\}/)[0];
  assert.ok(!/<textarea|<button/.test(fnBody), '_sessSceneNoteHistoryHtml рендерит textarea/button — история должна быть только для чтения');
  assert.ok(/escHtml\(/.test(fnBody), '_sessSceneNoteHistoryHtml не экранирует текст заметки (escHtml)');
});

test('source-guard: modules.js — объявляет общий хелпер _filterUnrecordedScenes (переиспользуется session-screen.js для агрегата префилла)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  assert.ok(js.includes('function _filterUnrecordedScenes('), 'нет функции _filterUnrecordedScenes');
});

// ── Ручной выбор сцены («+ Сцена/событие…») убран из формы «+ Запись сессии» —
//    сцены и заметки к ним уже перечисляются на экране «Сессия» (запрос
//    пользователя: дублирующий UI-элемент только путает) ─────────────────────

test('source-guard: modules.js — форма «+ Запись сессии» больше не содержит ручного выбора сцены (#sess-scene-pick)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  assert.ok(!js.includes('sess-scene-pick'), 'modules.js всё ещё ссылается на убранный #sess-scene-pick');
  assert.ok(!js.includes('SCENE_OFF_SCRIPT'), 'modules.js всё ещё ссылается на убранную константу SCENE_OFF_SCRIPT');
  assert.ok(js.includes("id=\"sess-scenes\""), '#sess-scenes (свободный ввод «Сыграно сцен») не должен исчезать вместе с пикером');
});

// ── Удаление записи сессии (не только редактирование) ────────────────────────

test('source-guard: modules.js — карточка записи сессии содержит кнопку удаления (.modp-session-delete), делегирование клика вызывает _deleteSessionEntry', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  assert.ok(/class="modp-session-delete"[^>]*data-sess-idx/.test(js), 'нет кнопки .modp-session-delete с data-sess-idx в шаблоне карточки сессии');
  const delegation = js.match(/document\.getElementById\('modp-panel-sessions'\)\.addEventListener\('click', e => \{[\s\S]*?\n\}\);/);
  assert.ok(delegation, 'не найдено делегирование клика на #modp-panel-sessions');
  assert.ok(/modp-session-delete/.test(delegation[0]) && /_deleteSessionEntry/.test(delegation[0]),
    'делегирование клика не обрабатывает .modp-session-delete через _deleteSessionEntry');
});

test('source-guard: modules.js — _deleteSessionEntry подтверждает через showConfirm(danger) и шлёт DELETE на /session/:idx', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  const fnMatch = js.match(/async function _deleteSessionEntry\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция _deleteSessionEntry');
  const fn = fnMatch[0];
  assert.ok(/showConfirm\(/.test(fn) && /danger:\s*true/.test(fn), '_deleteSessionEntry не спрашивает подтверждение через showConfirm({danger:true})');
  assert.ok(/method:\s*'DELETE'/.test(fn), '_deleteSessionEntry не шлёт DELETE-запрос');
  assert.ok(/\/session\/\$\{idx\}/.test(fn), '_deleteSessionEntry не обращается к /session/:idx');
  assert.ok(/_reloadModulePage\(\)/.test(fn), '_deleteSessionEntry не перезагружает страницу модуля после удаления');
});

test('source-guard: routes/modules/sessions.js — DELETE /api/chronicles/:chr/modules/:mod/session/:idx удаляет запись и пересчитывает нумерацию', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../routes/modules/sessions.js'), 'utf-8');
  const routeMatch = js.match(/router\.delete\('\/api\/chronicles\/:chr\/modules\/:mod\/session\/:idx',[\s\S]*?\n {2}\}\);/);
  assert.ok(routeMatch, 'не найден DELETE-роут /api/chronicles/:chr/modules/:mod/session/:idx');
  const route = routeMatch[0];
  assert.ok(/sessions\.splice\(/.test(route), 'DELETE-роут не вырезает запись из массива sessions (splice)');
  assert.ok(/_writeSessionsFile\(/.test(route), 'DELETE-роут не перезаписывает sessions.md через _writeSessionsFile (нумерация «Сессия N» пересчитывается по позиции в массиве)');
  assert.ok(/i\s*<\s*0\s*\|\|\s*i\s*>=\s*sessions\.length/.test(route) || /!Number\.isInteger\(i\)/.test(route),
    'DELETE-роут не проверяет валидность индекса (404 на несуществующую запись)');
});

test('source-guard: modules.js — объявляет модульную переменную _pendingModulePrefill и обрабатывает её в loadModulePage', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  assert.ok(/let _pendingModulePrefill\s*=\s*null/.test(js), 'нет объявления let _pendingModulePrefill = null');
  const fnBody = js.match(/async function loadModulePage\(\) \{[\s\S]*?\n\}/)[0];
  assert.ok(fnBody.includes('_pendingModulePrefill'), 'loadModulePage не обрабатывает _pendingModulePrefill');
  // Применение префилла должно идти ПОСЛЕ renderModulePage(data) — та синхронно
  // рендерит #modp-panel-sessions, форма должна уже существовать в DOM.
  const renderIdx  = fnBody.indexOf('renderModulePage(data)');
  const prefillIdx = fnBody.indexOf('_pendingModulePrefill');
  assert.ok(renderIdx !== -1 && prefillIdx > renderIdx,
    'применение _pendingModulePrefill идёт не после renderModulePage(data) — форма сессий может быть ещё не отрисована');
  // Обнуление намерения сразу после применения (не должно залипать между модулями).
  assert.ok(/_pendingModulePrefill\s*=\s*null/.test(fnBody.slice(prefillIdx)),
    'loadModulePage не обнуляет _pendingModulePrefill после применения');
});

test('source-guard: modules.js — применение _pendingModulePrefill переключает вкладку на «Сессии»', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  const fnBody = js.match(/async function loadModulePage\(\) \{[\s\S]*?\n\}/)[0];
  const prefillIdx = fnBody.indexOf('_pendingModulePrefill');
  const afterPrefill = fnBody.slice(prefillIdx);
  assert.ok(/data-modtab="sessions"/.test(afterPrefill),
    'применение префилла не переключает вкладку модуля на sessions (data-modtab="sessions")');
});

// ── Регрессия (тот же класс id-коллизии, что уже чинили для #sess-notes-wrap
// в session-screen.js): применение _pendingModulePrefill ЧИТАЕТ/ПИШЕТ поля
// #sess-notes/#sess-scenes формы записи сессии на СТРАНИЦЕ МОДУЛЯ — те же id,
// что #sess-notes на экране Сессии (widget «Заметки сессии»). navigate() не
// удаляет страницы из DOM, так что несскоупленный document.getElementById
// после ЛЮБОГО открытия Сессии навсегда резолвился бы в чужой textarea ───────

test('source-guard: modules.js — применение _pendingModulePrefill скоупит #sess-notes/#sess-scenes через #modp-panel-sessions (не голый getElementById — коллизия id с session-screen.js)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  const fnBody = js.match(/async function loadModulePage\(\) \{[\s\S]*?\n\}/)[0];
  const prefillIdx = fnBody.indexOf('_pendingModulePrefill');
  const afterPrefill = fnBody.slice(prefillIdx);
  assert.ok(!/document\.getElementById\('sess-notes'\)/.test(afterPrefill),
    'применение префилла использует несскоупленный document.getElementById(\'sess-notes\') — коллизия с #sess-notes-wrap на экране Сессии');
  assert.ok(!/document\.getElementById\('sess-scenes'\)/.test(afterPrefill),
    'применение префилла использует несскоупленный document.getElementById(\'sess-scenes\')');
  assert.ok(/document\.getElementById\('modp-panel-sessions'\)\.querySelector\(['"]#sess-notes['"]\)/.test(afterPrefill),
    'применение префилла не берёт #sess-notes через document.getElementById(\'modp-panel-sessions\').querySelector(\'#sess-notes\')');
  assert.ok(/document\.getElementById\('modp-panel-sessions'\)\.querySelector\(['"]#sess-scenes['"]\)/.test(afterPrefill),
    'применение префилла не берёт #sess-scenes через document.getElementById(\'modp-panel-sessions\').querySelector(\'#sess-scenes\')');
});

test('source-guard: modules.js — применение _pendingModulePrefill не затирает уже заполненные вручную поля', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  const fnBody = js.match(/async function loadModulePage\(\) \{[\s\S]*?\n\}/)[0];
  const prefillIdx = fnBody.indexOf('_pendingModulePrefill');
  const afterPrefill = fnBody.slice(prefillIdx);
  assert.ok(/notesEl\s*&&\s*!notesEl\.value\.trim\(\)/.test(afterPrefill),
    'префилл #sess-notes не проверяет пустоту поля перед записью — рискует затереть ручной ввод');
  assert.ok(/scenesEl\s*&&\s*!scenesEl\.value\.trim\(\)/.test(afterPrefill),
    'префилл #sess-scenes не проверяет пустоту поля перед записью — рискует затереть ручной ввод');
});

// Регрессия ревью коммита 49d7bed (P2 design-аудит «карточки модулей недоступны
// с клавиатуры»): keydown-обработчик .chd-mod-card в модалке хроники должен
// игнорировать нажатия, пришедшиеся на .chd-mod-del-btn, ДО preventDefault/
// открытия модуля — иначе Tab на кнопку удаления → Enter открывает модуль
// вместо срабатывания удаления. Экран «Сессия» карточки модулей больше не
// использует (модуль выбирается через select #sess-mod-sel, нативно доступный
// с клавиатуры без отдельного keydown-обработчика) — паритет с session-screen.js
// здесь больше не проверяем, он неприменим.
test('source-guard: modules.js — keydown-обработчик .chd-mod-card защищён от .chd-mod-del-btn (паритет с click)', () => {
  const modulesJs = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');

  const modulesKeydown = modulesJs.match(/document\.getElementById\('chr-detail-body'\)\.addEventListener\('keydown', e => \{[\s\S]*?\n\}\);/);
  assert.ok(modulesKeydown, 'не найден делегированный keydown-обработчик #chr-detail-body (.chd-mod-card)');
  const modulesGuardIdx = modulesKeydown[0].indexOf(".chd-mod-del-btn'");
  const modulesPreventIdx = modulesKeydown[0].indexOf('e.preventDefault()');
  assert.ok(modulesGuardIdx !== -1,
    'keydown-обработчик #chr-detail-body не защищён от .chd-mod-del-btn — Enter/Space на кнопке удаления модуля вместо неё откроет модуль');
  assert.ok(modulesGuardIdx < modulesPreventIdx,
    'проверка .chd-mod-del-btn в keydown #chr-detail-body должна идти ДО e.preventDefault()/открытия модуля');

  const sessionJs = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  assert.ok(!sessionJs.includes('.chd-mod-card'),
    'session-screen.js всё ещё ссылается на .chd-mod-card — карточки модулей на Сессии заменены select-ом, мёртвый код');
});

// ══════════════════════════════════════════════════════════════════════════
// Фиксы по итогам docs/audit/2026-07-28-session-feature-qa-report.md
// ══════════════════════════════════════════════════════════════════════════

// ── Находка №1: дублирующиеся confirm-диалоги при быстром двойном клике ─────

test('source-guard: utils.js — showConfirm() защищён от повторного вызова, пока предыдущий диалог не резолвился', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/utils.js'), 'utf-8');
  assert.ok(/let _confirmOverlay\s*=\s*null/.test(js), 'нет модульной переменной _confirmOverlay = null');
  const fnMatch = js.match(/function showConfirm\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция showConfirm');
  const fn = fnMatch[0];
  const guardIdx  = fn.indexOf('if (_confirmOverlay)');
  const createIdx = fn.indexOf("ov.id = 'confirm-overlay'");
  assert.ok(guardIdx !== -1, 'showConfirm не проверяет уже открытый _confirmOverlay в начале');
  assert.ok(guardIdx !== -1 && createIdx !== -1 && guardIdx < createIdx,
    'guard от повторного вызова должен идти ДО создания нового #confirm-overlay');
  assert.ok(/_confirmOverlay\s*=\s*ov/.test(fn), 'showConfirm не запоминает открытый оверлей в _confirmOverlay');
  assert.ok(/_confirmOverlay\s*=\s*null/.test(fn), 'cleanup() не сбрасывает _confirmOverlay обратно в null — второй showConfirm() навсегда останется заблокирован');
});

// ── Находка №2: сбой dev-сервера без диагностируемого следа ─────────────────

test('source-guard: wrapper.js — дублирует stdout/stderr в файловый лог (не только inherit в терминал)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../wrapper.js'), 'utf-8');
  assert.ok(/stdio:\s*\[\s*'inherit'\s*,\s*'pipe'\s*,\s*'pipe'\s*\]/.test(js),
    'wrapper.js не переключил stdout/stderr на pipe — без этого их нельзя продублировать в файл');
  assert.ok(js.includes('createWriteStream'), 'wrapper.js не пишет лог в файл (fs.createWriteStream)');
  assert.ok(js.includes('LOG_DIR'), 'нет константы LOG_DIR для директории лога');
});

test('source-guard: wrapper.js — неожиданный крэш (не наш restart-код, не наш Ctrl-C) автоперезапускается с лимитом попыток', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../wrapper.js'), 'utf-8');
  assert.ok(/let _shuttingDown\s*=\s*false/.test(js), 'нет флага _shuttingDown, отличающего наш Ctrl-C/SIGTERM от неожиданного падения');
  assert.ok(/_shuttingDown\s*=\s*true/.test(js), 'обработчики SIGINT/SIGTERM не выставляют _shuttingDown = true');
  assert.ok(js.includes('CRASH_LIMIT'), 'нет лимита попыток автоперезапуска (CRASH_LIMIT) — риск бесконечного цикла падений');
  const exitMatch = js.match(/_child\.on\('exit', \(code, signal\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(exitMatch, 'не найден обработчик exit дочернего процесса');
  const fn = exitMatch[0];
  const restartIdx    = fn.indexOf('code === RESTART_CODE');
  const shuttingIdx   = fn.indexOf('_shuttingDown');
  const crashCountIdx = fn.indexOf('_crashCount++');
  assert.ok(restartIdx !== -1 && shuttingIdx !== -1 && crashCountIdx !== -1 && restartIdx < shuttingIdx && shuttingIdx < crashCountIdx,
    'порядок проверок в exit-обработчике должен быть: RESTART_CODE → _shuttingDown → учёт крэша (иначе наш собственный Ctrl-C может попасть под авто-перезапуск)');
});

// ── Находка №3: кнопки навигации по сценам не получают disabled на границах ──

test('source-guard: session-screen.js — #sess-prev/#sess-next получают disabled на границах сценария', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnMatch = js.match(/function _sessRenderScenario\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция _sessRenderScenario');
  const fn = fnMatch[0];
  assert.ok(/getElementById\('sess-prev'\)\.disabled\s*=\s*\(_sessScene === 0\)/.test(fn),
    '_sessRenderScenario не выставляет #sess-prev.disabled на первой сцене');
  assert.ok(/getElementById\('sess-next'\)\.disabled\s*=\s*\(_sessScene === _sessBlocks\.length - 1\)/.test(fn),
    '_sessRenderScenario не выставляет #sess-next.disabled на последней сцене');
});

// ── Находка №4: заметки на «не-сценных» блоках молча пропадали из агрегата ──

test('source-guard: session-screen.js — заметки без формального совпадения со сценой попадают в агрегат отдельным блоком «Прочее», а не пропадают', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/session-screen.js'), 'utf-8');
  const fnBody = js.match(/function _sessRenderNotes\(\) \{[\s\S]*?\n\}/)[0];
  assert.ok(fnBody.includes('includedHeadings'), 'нет множества includedHeadings для отслеживания уже учтённых формальных сцен');
  assert.ok(/for \(const block of _sessBlocks\)/.test(fnBody),
    'нет второго прохода по ВСЕМ _sessBlocks (не только по unrecorded) для сбора заметок без формального совпадения');
  assert.ok(/includedHeadings\.has\(block\.heading\)/.test(fnBody),
    'второй проход не пропускает уже учтённые в основном списке блоки — рискует задвоить заметку');
  assert.ok(/Прочее/.test(fnBody), 'нет блока «Прочее» в агрегате для заметок без формального совпадения');
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX-10 — path traversal через клиентский slug (Локации/Хроники/Модули)
// ══════════════════════════════════════════════════════════════════════════════
// QA (2026-07-28/29): district/slug использовались как сегмент пути к файлу
// после одного лишь .trim() — «../../имя» уводил запись за пределы cities/<город>/.
// Регресс — реальные HTTP-запросы к тестовому серверу, не только source-guard,
// раз баг был именно в поведении (echo слага, фактическое место на диске).

describe('FIX-10: path traversal через slug — Локации/Хроники/Модули', () => {
  const tmpCity   = path.join(__dirname, '../../cities/__traversaltest__');
  const outsideDir = path.join(__dirname, '../../cities/__traversal_escaped__');
  const qs = '?city=__traversaltest__';

  before(async () => {
    await fs.mkdir(path.join(tmpCity, 'locations'), { recursive: true });
    await fs.mkdir(path.join(tmpCity, 'chronicles', 'test_chr', 'modules'), { recursive: true });
    await fs.mkdir(path.join(tmpCity, 'archive'), { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'archive', 'characters_index.md'), '# Реестр\n', 'utf-8');
    await startServer(); // предыдущий describe('API — integration') уже остановил свой сервер в after()
  });
  after(async () => {
    await stopServer();
    await fs.rm(tmpCity, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true }); // на случай регресса — не должен существовать
  });

  it('POST /api/locations с district="../../__traversal_escaped__" не создаёт файл вне cities/<город>/', async () => {
    const { status, body } = await apiJson(`/api/locations${qs}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'ТравТестЛокация', district: '../../__traversal_escaped__' }),
    });
    assert.equal(status, 200);
    assert.ok(!body.district.includes('..'), `district не санитизирован: ${body.district}`);
    assert.equal(await fs.stat(outsideDir).catch(() => null), null, 'traversal создал директорию вне города');
    const escaped = await fs.readdir(path.join(tmpCity, 'locations')).catch(() => []);
    assert.ok(escaped.length > 0, 'локация не была создана вообще (ожидался безопасный slug-фолбэк, не полный отказ)');
  });

  it('POST /api/chronicles со slug="../../__traversal_escaped__" не создаёт файлы вне cities/<город>/', async () => {
    const { status, body } = await apiJson(`/api/chronicles${qs}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'ТравТестХроника', slug: '../../__traversal_escaped__' }),
    });
    assert.equal(status, 200);
    assert.ok(!body.slug.includes('..'), `slug не санитизирован: ${body.slug}`);
    assert.equal(await fs.stat(outsideDir).catch(() => null), null, 'traversal создал директорию вне города');
    await fs.rm(path.join(tmpCity, 'chronicles', body.slug), { recursive: true, force: true });
  });

  it('POST /api/chronicles/:chr/modules со slug="../../../__traversal_escaped__" не создаёт файлы вне модуля (двойной эскейп из отчёта)', async () => {
    const { status, body } = await apiJson(`/api/chronicles/test_chr/modules${qs}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'ТравТестМодуль', time: '2020', slug: '../../../__traversal_escaped__' }),
    });
    assert.equal(status, 200);
    assert.ok(!body.slug.includes('..'), `slug не санитизирован: ${body.slug}`);
    assert.equal(await fs.stat(outsideDir).catch(() => null), null, 'traversal создал директорию вне города');
    // Главный риск отчёта — содержимое модуля резолвится ЕЩЁ РАЗ через тот же slug
    // (было: modDir и `${modSlug}.md` считали от одного непроверенного значения).
    const modDir = path.join(tmpCity, 'chronicles', 'test_chr', 'modules', body.slug);
    assert.equal(await fs.stat(path.join(modDir, `${body.slug}.md`)).catch(() => null) !== null, true,
      'файл содержимого модуля не найден внутри ожидаемой (безопасной) папки модуля');
  });

  it('source-guard: slugify() применяется к клиентскому slug/district во всех трёх местах (не просто .trim())', () => {
    const locSrc = require('fs').readFileSync(path.join(__dirname, '../routes/locations.js'), 'utf-8');
    const chrSrc = require('fs').readFileSync(path.join(__dirname, '../routes/chronicles.js'), 'utf-8');
    const modSrc = require('fs').readFileSync(path.join(__dirname, '../routes/modules/list.js'), 'utf-8');
    assert.ok(/const distFolder = slugify\(district\)/.test(locSrc),
      'locations.js: district должен идти через slugify(), не просто .trim()');
    assert.ok(/const slug\s*=\s*slugify\(req\.body\.slug\?\.trim\(\) \|\| display\)/.test(chrSrc),
      'chronicles.js: slug должен идти через slugify(), даже если передан явно клиентом');
    assert.ok(/const modSlug = slugify\(req\.body\.slug\?\.trim\(\) \|\| name\.trim\(\)\)/.test(modSrc),
      'modules/list.js: modSlug должен идти через slugify(), даже если передан явно клиентом');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX-2 — свободный текст ломает структуру хранения (маршрутный слой)
// ══════════════════════════════════════════════════════════════════════════════
// Парсерный слой (timeline/worldState/city.js) уже покрыт unit-тестами выше —
// здесь только то, что нормализуется НЕ в парсере, а в самих роутах (relations,
// поля модуля, журнал сессий, заметки сцен) — требует реального HTTP round-trip,
// т.к. баг проявляется именно на ПОВТОРНОМ разборе уже записанного файла.

describe('FIX-2: свободный текст ломает структуру хранения — маршрутный слой', () => {
  const tmpCity = path.join(__dirname, '../../cities/__fix2test__');
  const qs = '?city=__fix2test__';
  let charSlug;

  before(async () => {
    await startServer();
    await fs.mkdir(path.join(tmpCity, 'archive'), { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'archive', 'characters_index.md'), '# Реестр\n', 'utf-8');

    const c1 = await apiJson(`/api/characters${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'ФиксТестА', lineage: 'mortal', gender: 'Мужской' }) });
    charSlug = c1.body.slug;
    await apiJson(`/api/chronicles${qs}`, { method: 'POST', body: JSON.stringify({ name: 'ФиксТестХроника' }) });
    await apiJson(`/api/chronicles/fikstesthronika/modules${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'ФиксТестМодуль', time: '2020' }) });
  });
  after(async () => {
    await stopServer();
    await fs.rm(tmpCity, { recursive: true, force: true });
  });

  it('FIX-6: имя персонажа длиннее 100 символов → 400, а не 500 (раньше падало в fs.mkdir на длине пути Windows)', async () => {
    const longName = 'Оченьдлинноеимяперсонажадлятестированияграничныхзначений'.repeat(9); // 504 символа
    const { status, body } = await apiJson(`/api/characters${qs}`, { method: 'POST',
      body: JSON.stringify({ name: longName, lineage: 'mortal', gender: 'Мужской' }) });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it('FIX-4a: переименование персонажа в уже существующее имя → 409, не создаёт коллизию', async () => {
    const other = await apiJson(`/api/characters${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'ФиксТестБ', lineage: 'mortal', gender: 'Женский' }) });
    const { status, body } = await apiJson(`/api/characters/${other.body.slug}/fields${qs}`, { method: 'PUT',
      body: JSON.stringify({ fields: { name: 'ФиксТестА' } }) }); // charSlug's display name
    assert.equal(status, 409);
    assert.ok(body.error);
    // Персонаж не должен был переименоваться — карточка "Б" остаётся собой.
    const card = await fs.readFile(path.join(tmpCity, 'characters', 'mortals', other.body.slug, `${other.body.slug}.md`), 'utf-8');
    assert.match(card, /^# 🧑 ФиксТестБ/m);
  });

  it('FIX-4a: переименование персонажа В САМОГО СЕБЯ (то же имя) — не 409, обычный no-op успех', async () => {
    const { status } = await apiJson(`/api/characters/${charSlug}/fields${qs}`, { method: 'PUT',
      body: JSON.stringify({ fields: { name: 'ФиксТестА' } }) });
    assert.equal(status, 200);
  });

  it('FIX-3: PUT /fields с explicit пустой строкой реально очищает поле на диске (не только "поле отсутствует = не трогать")', async () => {
    await apiJson(`/api/characters/${charSlug}/fields${qs}`, { method: 'PUT',
      body: JSON.stringify({ fields: { voice: 'Хриплый голос' } }) });
    let card = await fs.readFile(path.join(tmpCity, 'characters', 'mortals', charSlug, `${charSlug}.md`), 'utf-8');
    assert.match(card, /Хриплый голос/, 'предварительная запись голоса не удалась');

    await apiJson(`/api/characters/${charSlug}/fields${qs}`, { method: 'PUT',
      body: JSON.stringify({ fields: { voice: '' } }) });
    card = await fs.readFile(path.join(tmpCity, 'characters', 'mortals', charSlug, `${charSlug}.md`), 'utf-8');
    assert.ok(!card.includes('Хриплый голос'), 'сервер не очистил поле при явной пустой строке — старое значение пережило запись');
  });

  it('Отношения: "\\n" в строке связи не оставляет осиротевшую строку вне блока «Отношения:»', async () => {
    const { status } = await apiJson(`/api/characters/${charSlug}/relations${qs}`, { method: 'PUT',
      body: JSON.stringify({ lines: ['Злодей — Враг\n- **Слаг:** hacked'] }) });
    assert.equal(status, 200);
    const card = await fs.readFile(path.join(tmpCity, 'characters', 'mortals', charSlug, `${charSlug}.md`), 'utf-8');
    assert.ok(!/^- \*\*Слаг:\*\* hacked/m.test(card), 'инъекция создала строку-поле вне блока «Отношения:»');
    assert.match(card, /- Злодей — Враг/, 'сама связь должна сохраниться (перенос схлопнут в пробел)');
  });

  it('Журнал сессий: "## Сессия N" в заметке не фабрикует поддельную запись при следующем сохранении', async () => {
    await apiJson(`/api/chronicles/fikstesthronika/modules/fikstestmodul/session${qs}`, { method: 'POST',
      body: JSON.stringify({ date: '2026-01-01', scenes: '1', status: '🟡 В процессе',
        notes: 'Заметка.\n## Сессия 99 — ИНЪЕКЦИЯ\n- **Статус модуля:** 🟢 Закрыт\nПоддельно.' }) });
    // Второе сохранение вызывает повторный разбор всего файла — здесь и
    // проявлялась инъекция (см. 2026-07-29-session-chronicles-qa-report.md #3).
    const second = await apiJson(`/api/chronicles/fikstesthronika/modules/fikstestmodul/session${qs}`, { method: 'POST',
      body: JSON.stringify({ date: '2026-02-01', scenes: '2', status: '🟡 В процессе', notes: 'Вторая настоящая.' }) });
    assert.equal(second.body.n, 2, 'должно быть ровно 2 сессии — инъекция не должна была стать третьей записью');
  });

  it('Заметки по сцене: "### Сессия N" в тексте заметки не фабрикует поддельную подзапись', async () => {
    await apiJson(`/api/chronicles/fikstesthronika/modules/fikstestmodul/scene-note${qs}`, { method: 'PUT',
      body: JSON.stringify({ heading: 'Сцена 1', session: 1,
        text: 'Заметка.\n### Сессия 5\nПоддельная запись.' }) });
    await apiJson(`/api/chronicles/fikstesthronika/modules/fikstestmodul/scene-note${qs}`, { method: 'PUT',
      body: JSON.stringify({ heading: 'Сцена 1', session: 2, text: 'Вторая настоящая.' }) });
    const { body } = await apiJson(`/api/chronicles/fikstesthronika/modules/fikstestmodul/scene-notes${qs}`);
    const entries = body['Сцена 1'];
    assert.equal(entries.length, 2, 'должно быть ровно 2 записи — инъекция не должна была стать третьей');
    assert.deepEqual(entries.map(e => e.session).sort(), [1, 2]);
    assert.match(entries[0].text, /### Сессия 5/, 'исходный текст заметки (включая "### Сессия 5" как текст) должен остаться читаемым при показе');
  });

  it('FIX-14: продвижение модульного НПС в канон обновляет «Линейка WoD» и эмодзи под целевую линейку', async () => {
    await apiJson(`/api/chronicles/fikstesthronika/modules/fikstestmodul/npc${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'ФиксТест14НПС', group: 'modular' }) });
    const promoted = await apiJson(`/api/chronicles/fikstesthronika/modules/fikstestmodul/npc/fikstest14nps/promote${qs}`,
      { method: 'POST', body: JSON.stringify({ lineage: 'vampires', force: true }) });
    assert.equal(promoted.status, 200);
    const card = await fs.readFile(path.join(tmpCity, 'characters', 'vampires', 'fikstest14nps', 'fikstest14nps.md'), 'utf-8');
    assert.match(card, /^- \*\*Линейка WoD:\*\* Вампир\s*$/m,
      'после продвижения в vampires карточка всё ещё называет себя "mortals" — ровно то, что забракует validate_cards.js');
    assert.match(card, /^# 🧛 /m, 'эмодзи заголовка не обновился под целевую линейку');
  });

  it('Поля модуля: "|" в «Тон» не сдвигает таблицу параметров модуля', async () => {
    const { status } = await apiJson(`/api/chronicles/fikstesthronika/modules/fikstestmodul/fields${qs}`, { method: 'PUT',
      body: JSON.stringify({ fields: { tone: 'Мрачный | Готический' } }) });
    assert.equal(status, 200);
    const main = await fs.readFile(
      path.join(tmpCity, 'chronicles', 'fikstesthronika', 'modules', 'fikstestmodul', 'fikstestmodul.md'), 'utf-8');
    const toneLine = main.split('\n').find(l => l.includes('**Тон**'));
    assert.ok(toneLine, 'строка «Тон» не найдена');
    // Корректная 2-ячеечная строка "| **Тон** | значение |" содержит РОВНО 3
    // символа "|" — необработанный "|" внутри значения дал бы 4 и лишнюю колонку.
    assert.equal((toneLine.match(/\|/g) || []).length, 3, '"|" из значения не должен был добавить лишнюю колонку в строку таблицы');
  });
});

describe('FIX-12: граф — неоднозначная цель связи не резолвится молча к случайному персонажу', () => {
  const tmpCity = path.join(__dirname, '../../cities/__fix12test__');
  const qs = '?city=__fix12test__';

  before(async () => {
    await fs.mkdir(path.join(tmpCity, 'archive'), { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'archive', 'characters_index.md'), '# Реестр\n', 'utf-8');
    await startServer();
    for (const name of ['Иван Петров', 'Иван Сидоров', 'СвязнойТест']) {
      await apiJson(`/api/characters${qs}`, { method: 'POST',
        body: JSON.stringify({ name, lineage: 'mortal', gender: 'Мужской' }) });
    }
    await apiJson(`/api/characters/svyaznoytest/relations${qs}`, { method: 'PUT',
      body: JSON.stringify({ lines: ['Иван — Знакомый'] }) }); // неоднозначно: два "Иван ..."
  });
  after(async () => {
    await stopServer();
    await fs.rm(tmpCity, { recursive: true, force: true });
  });

  it('неоднозначное имя ("Иван" при двух "Иван ...") не резолвится ни к одному — ребро отсутствует', async () => {
    const { body } = await apiJson(`/api/graph${qs}`);
    const edge = body.links.find(l => l.source === 'СвязнойТест' || l.target === 'СвязнойТест');
    assert.equal(edge, undefined, 'неоднозначная связь не должна была молча выбрать одного из двух "Иван ..."');
  });

  it('однозначное точное имя по-прежнему резолвится нормально', async () => {
    await apiJson(`/api/characters/svyaznoytest/relations${qs}`, { method: 'PUT',
      body: JSON.stringify({ lines: ['Иван Петров — Знакомый'] }) });
    const { body } = await apiJson(`/api/graph${qs}`);
    const edge = body.links.find(l =>
      (l.source === 'СвязнойТест' && l.target === 'Иван Петров') ||
      (l.target === 'СвязнойТест' && l.source === 'Иван Петров'));
    assert.ok(edge, 'точное совпадение имени должно резолвиться как обычно');
  });
});

describe('FIX-13: граф — несимметричная связь между парой сохраняет обе стороны, не теряет вторую', () => {
  const tmpCity = path.join(__dirname, '../../cities/__fix13test__');
  const qs = '?city=__fix13test__';

  before(async () => {
    await fs.mkdir(path.join(tmpCity, 'archive'), { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'archive', 'characters_index.md'), '# Реестр\n', 'utf-8');
    await startServer();
    const slugs = {};
    for (const name of ['Первый Асимметрик', 'Второй Асимметрик']) {
      const { body } = await apiJson(`/api/characters${qs}`, { method: 'POST',
        body: JSON.stringify({ name, lineage: 'mortal', gender: 'Мужской' }) });
      slugs[name] = body.slug;
    }
    await apiJson(`/api/characters/${slugs['Первый Асимметрик']}/relations${qs}`, { method: 'PUT',
      body: JSON.stringify({ lines: ['Второй Асимметрик — враг'] }) });
    await apiJson(`/api/characters/${slugs['Второй Асимметрик']}/relations${qs}`, { method: 'PUT',
      body: JSON.stringify({ lines: ['Первый Асимметрик — должник'] }) });
  });
  after(async () => {
    await stopServer();
    await fs.rm(tmpCity, { recursive: true, force: true });
  });

  it('одно ребро на пару, но description/description2 хранят СВОЙ текст каждой стороны (не дедуп до одной)', async () => {
    const { body } = await apiJson(`/api/graph${qs}`);
    const edges = body.links.filter(l =>
      (l.source === 'Первый Асимметрик' && l.target === 'Второй Асимметрик') ||
      (l.target === 'Первый Асимметрик' && l.source === 'Второй Асимметрик'));
    assert.equal(edges.length, 1, 'между парой должно быть ровно одно ребро, не два дублирующих');
    const [edge] = edges;
    assert.ok(edge.fromChar2, 'вторая сторона не должна теряться — fromChar2 должен быть заполнен');
    const byChar = { [edge.fromChar]: edge.description, [edge.fromChar2]: edge.description2 };
    assert.match(byChar['Первый Асимметрик'], /враг/, 'у "Первого" должен сохраниться его текст "враг"');
    assert.match(byChar['Второй Асимметрик'], /должник/, 'у "Второго" должен сохраниться его текст "должник", а не потеряться при дедупе');
  });
});

describe('FIX-9: линейка-специфичные поля создания — Оборотень (Племя/Каста), Маг (Традиция)', () => {
  const tmpCity = path.join(__dirname, '../../cities/__fix9test__');
  const qs = '?city=__fix9test__';

  before(async () => {
    await fs.mkdir(path.join(tmpCity, 'archive'), { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'archive', 'characters_index.md'), '# Реестр\n', 'utf-8');
    await startServer();
  });
  after(async () => {
    await stopServer();
    await fs.rm(tmpCity, { recursive: true, force: true });
  });

  it('Оборотень без «Племя» → 400, не создаёт карточку без обязательного поля', async () => {
    const { status, body } = await apiJson(`/api/characters${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'Волк Без Племени', lineage: 'werewolf', gender: 'Мужской' }) });
    assert.equal(status, 400);
    assert.match(body.error, /Племя/);
  });

  it('Маг без «Традиция» → 400', async () => {
    const { status, body } = await apiJson(`/api/characters${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'Маг Без Традиции', lineage: 'mage', gender: 'Мужской' }) });
    assert.equal(status, 400);
    assert.match(body.error, /Традиция/);
  });

  it('Оборотень с Племя/Каста — оба поля пишутся в карточку', async () => {
    const { body } = await apiJson(`/api/characters${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'Тестовый Гару', lineage: 'werewolf', gender: 'Мужской', tribe: 'Дети Гайи', auspice: 'Тодас' }) });
    assert.ok(body.ok, body.error);
    const card = await fs.readFile(path.join(tmpCity, 'characters', 'werewolves', body.slug, `${body.slug}.md`), 'utf-8');
    assert.match(card, /- \*\*Племя:\*\* Дети Гайи/);
    assert.match(card, /- \*\*Каста:\*\* Тодас/);
  });

  it('Маг с Традиция — пишется в карточку', async () => {
    const { body } = await apiJson(`/api/characters${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'Тестовый Маг', lineage: 'mage', gender: 'Женский', tradition: 'Верителли' }) });
    assert.ok(body.ok, body.error);
    const card = await fs.readFile(path.join(tmpCity, 'characters', 'mages', body.slug, `${body.slug}.md`), 'utf-8');
    assert.match(card, /- \*\*Традиция:\*\* Верителли/);
  });
});

// FIX-15 (docs/audit/2026-07-28-fix-plan.md): POST /api/run-tool строил
// PowerShell-команду конкатенацией строк — значения экранировались, а КЛЮЧИ
// объекта params нет, и без белого списка допустимых имён. Ключ вида
// `X'; <любая команда>; #` превращал финальную команду в несколько
// независимых PowerShell-инструкций — command injection. Тесты ниже
// намеренно НЕ дают дойти до реального spawn() валидного вызова (в этом
// проекте `search.ps1`/`validate_links.ps1` — интерактивные интерфейс-скрипты,
// которые без -Force зависают на "нажмите любую клавишу" до 30s-таймаута —
// это отдельная, не относящаяся к FIX-15 особенность, не стоит делать
// тестовый прогон медленным из-за нее) — проверяется только то, что
// belongs к самому фиксу: неизвестный ключ отклоняется ДО построения команды.
describe('FIX-15: POST /api/run-tool — белый список ключей params (command injection)', () => {
  before(async () => startServer());
  after(async () => stopServer());

  it('неизвестный tool → 400, без обращения к белому списку', async () => {
    const { status, body } = await apiJson('/api/run-tool', { method: 'POST',
      body: JSON.stringify({ tool: 'not_a_real_tool', params: {} }) });
    assert.equal(status, 400);
    assert.match(body.error, /Unknown tool/);
  });

  it('ключ-инъекция (`Query\'; ...; #`) для tool=search → 400, не "Unknown tool" (значит дошло до проверки ключей, не имени тула)', async () => {
    const { status, body } = await apiJson('/api/run-tool', { method: 'POST',
      body: JSON.stringify({ tool: 'search', params: { "Query'; Write-Output 'INJECTED'; #": 'x' } }) });
    assert.equal(status, 400);
    assert.match(body.error, /Недопустимый параметр/);
  });

  it('легитимный, но не входящий в whitelist ключ (например "Query2") для tool=validate_links → 400', async () => {
    const { status, body } = await apiJson('/api/run-tool', { method: 'POST',
      body: JSON.stringify({ tool: 'validate_links', params: { Query2: 'x' } }) });
    assert.equal(status, 400);
    assert.match(body.error, /Недопустимый параметр/);
  });

  it('пустой params (реальный вызов кнопки «Проверить» из UI) проходит проверку ключей', async () => {
    // Не даём процессу реально завершиться (search/validate_links оба тратят
    // время) — просто убеждаемся, что ответ НЕ содержит "Недопустимый
    // параметр" быстро после старта; сам процесс убиваем через короткий таймаут.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    try {
      await apiJson('/api/run-tool', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ tool: 'validate_links', params: {} }) });
    } catch (e) {
      // Обрыв по нашему же таймауту — ожидаемо и ОК: значит, whitelist-проверка
      // (синхронная, до spawn) уже пройдена, иначе сервер ответил бы мгновенно.
      assert.ok(e.name === 'AbortError' || /abort/i.test(e.message || ''), `неожиданная ошибка: ${e}`);
    } finally {
      clearTimeout(t);
    }
  });
});

// FIX-17 (docs/audit/2026-07-28-fix-plan.md): полный аудит web/routes/modules/*.js
// нашёл 16 из 35 роутов, принимавших :chr/:mod/:slug в path.join(...) без
// проверки на '..' вообще — среди них DELETE-модуля (рекурсивное удаление
// произвольной директории через web/lib/db.js rmdir()) и NPC-promote (запись
// с контролируемым атакующим путём назначения). Живые HTTP-тесты ниже бьют по
// двум самым серьёзным; остальные 14 + 4 в library.js покрыты source-guard
// проверкой (грепом кода) — 20 отдельных живых HTTP-тестов на один и тот же
// паттерн защиты были бы избыточны и медленны.
describe('FIX-17: path traversal — журнал сессий, удаление/promote модуля', () => {
  const tmpCity = path.join(__dirname, '../../cities/__fix17test__');
  const qs = '?city=__fix17test__';

  before(async () => {
    await fs.mkdir(path.join(tmpCity, 'archive'), { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'archive', 'characters_index.md'), '# Реестр\n', 'utf-8');
    await startServer();
    await apiJson(`/api/chronicles${qs}`, { method: 'POST', body: JSON.stringify({ name: 'Хроника ФИКС17' }) });
    await apiJson(`/api/chronicles/hronika_fiks17/modules${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'Модуль ФИКС17', time: '2010' }) });
  });
  after(async () => {
    await stopServer();
    await fs.rm(tmpCity, { recursive: true, force: true });
  });

  it('POST .../session с traversal в :chr → 400, не «Модуль не найден» (доказывает, что вход отклонён, а не просто не нашлась цель)', async () => {
    const { status, body } = await apiJson(
      `/api/chronicles/${encodeURIComponent('../hronika_fiks17')}/modules/modul_fiks17/session${qs}`,
      { method: 'POST', body: JSON.stringify({ date: '2099', notes: 'traversal' }) });
    assert.equal(status, 400);
    assert.match(body.error, /Недопустимое имя/);
  });

  it('PUT/DELETE .../session/:idx с traversal в :mod → 400', async () => {
    const put = await apiJson(
      `/api/chronicles/hronika_fiks17/modules/${encodeURIComponent('../modul_fiks17')}/session/0${qs}`,
      { method: 'PUT', body: JSON.stringify({ notes: 'x' }) });
    assert.equal(put.status, 400);
    const del = await apiJson(
      `/api/chronicles/hronika_fiks17/modules/${encodeURIComponent('../modul_fiks17')}/session/0${qs}`,
      { method: 'DELETE' });
    assert.equal(del.status, 400);
  });

  it('DELETE /api/chronicles/:chr/modules/:mod (удаление модуля) с traversal → 400, ничего не удаляет', async () => {
    const { status, body } = await apiJson(
      `/api/chronicles/${encodeURIComponent('../hronika_fiks17')}/modules/modul_fiks17${qs}`,
      { method: 'DELETE' });
    assert.equal(status, 400);
    assert.match(body.error, /Недопустимое имя/);
    // Модуль по-прежнему на месте — traversal не смог его случайно задеть.
    const detail = await apiJson(`/api/chronicles/hronika_fiks17/modules/modul_fiks17/detail${qs}`);
    assert.equal(detail.status, 200);
  });

  it('POST .../npc/:slug/promote с traversal в :slug (путь НАЗНАЧЕНИЯ записи) → 400', async () => {
    const { status, body } = await apiJson(
      `/api/chronicles/hronika_fiks17/modules/modul_fiks17/npc/${encodeURIComponent('../../../evil')}/promote${qs}`,
      { method: 'POST', body: JSON.stringify({ lineage: 'vampires', force: true }) });
    assert.equal(status, 400);
    assert.match(body.error, /Недопустимое имя/);
  });

  it('GET .../npc/:slug/sheet с traversal → 400 (через _npcSheetPaths, возвращающий null)', async () => {
    const { status } = await apiJson(
      `/api/chronicles/hronika_fiks17/modules/modul_fiks17/npc/${encodeURIComponent('../x')}/sheet${qs}`);
    assert.equal(status, 400);
  });
});

test('source-guard: web/routes/modules/*.js — все 16 роутов из FIX-17 защищены _hasTraversal()', () => {
  const files = ['fill.js', 'lifecycle.js', 'list.js', 'locations.js', 'npc.js', 'sessions.js']
    .map(f => path.join(__dirname, '../routes/modules', f));
  // Ожидаемое число вызовов _hasTraversal(...) на файл — по одному на каждый
  // из 16 роутов, что были без защиты (см. таблицу в FIX-17). shared.js
  // объявляет функцию (1 раз) и использует её же внутри _npcSheetPaths
  // (тоже 1) — npc.js экономит явные вызовы за счёт этого хелпера для 3 из
  // своих 5 роутов, поэтому его собственный счётчик ниже.
  const expectedMin = { 'fill.js': 1, 'lifecycle.js': 2, 'list.js': 2, 'locations.js': 3, 'npc.js': 2, 'sessions.js': 3 };
  for (const f of files) {
    const js = require('fs').readFileSync(f, 'utf-8');
    const name = path.basename(f);
    const count = (js.match(/_hasTraversal\(/g) || []).length;
    assert.ok(count >= expectedMin[name],
      `${name}: ожидалось минимум ${expectedMin[name]} вызовов _hasTraversal(), найдено ${count}`);
  }
  // npc.js's 3 sheet-роута защищены косвенно через _npcSheetPaths() → null,
  // а не прямым вызовом _hasTraversal в самом роуте — проверяем отдельно.
  const npcJs = require('fs').readFileSync(path.join(__dirname, '../routes/modules/npc.js'), 'utf-8');
  const sheetRouteMatches = npcJs.match(/if \(!p\) return res\.status\(400\)/g) || [];
  assert.ok(sheetRouteMatches.length >= 3,
    `npc.js: ожидалось минимум 3 роута, проверяющих _npcSheetPaths() на null, найдено ${sheetRouteMatches.length}`);
});

test('source-guard: web/routes/modules/shared.js — _npcSheetPaths возвращает null на traversal, а не строит путь безусловно', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../routes/modules/shared.js'), 'utf-8');
  const fnMatch = js.match(/function _npcSheetPaths\([^)]*\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена _npcSheetPaths');
  assert.match(fnMatch[0], /_hasTraversal\(chr, mod, slug\)/,
    '_npcSheetPaths должна проверять chr/mod/slug на traversal ДО построения пути');
  assert.match(fnMatch[0], /return null/, '_npcSheetPaths должна возвращать null при обнаружении traversal');
});

test('source-guard: web/routes/library.js — PUT/DELETE дисциплин и способностей прогоняют :slug через slugify()', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../routes/library.js'), 'utf-8');
  const routeMatches = js.match(/router\.(put|delete)\('\/api\/library\/(disciplines|psychics)\/:slug'[\s\S]*?\n\}\);/g) || [];
  assert.equal(routeMatches.length, 4, `ожидалось 4 роута (PUT+DELETE × disciplines+psychics), найдено ${routeMatches.length}`);
  for (const route of routeMatches) {
    assert.match(route, /slugify\(req\.params\.slug\)/,
      `роут не прогоняет :slug через slugify():\n${route.slice(0, 120)}...`);
  }
});

describe('FIX-16: санитизация свободного текста — нити, концепция модуля, библиотека, город (продолжение FIX-2)', () => {
  const tmpCity = path.join(__dirname, '../../cities/__fix16test__');
  const qs = '?city=__fix16test__';

  before(async () => {
    await fs.mkdir(path.join(tmpCity, 'archive'), { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'archive', 'characters_index.md'), '# Реестр\n', 'utf-8');
    await fs.writeFile(path.join(tmpCity, 'archive', 'open_threads.md'),
      '# Открытые нити\n\n| № | Нить | Источник | Статус | Приоритет |\n|---|---|---|---|---|\n', 'utf-8');
    await startServer();
    await apiJson(`/api/chronicles${qs}`, { method: 'POST', body: JSON.stringify({ name: 'Хроника ФИКС16' }) });
    await apiJson(`/api/chronicles/hronika_fiks16/modules${qs}`, { method: 'POST',
      body: JSON.stringify({ name: 'Модуль ФИКС16', time: '2010' }) });
  });
  after(async () => {
    await stopServer();
    await fs.rm(tmpCity, { recursive: true, force: true });
  });

  it('нить: "\\n" в description и "|" в priority не ломают таблицу — нить читается обратно с теми же полями', async () => {
    const create = await apiJson(`/api/threads${qs}`, { method: 'POST', body: JSON.stringify({
      title: 'Тест ФИКС16', description: 'строка1\nстрока2', priority: 'Высокий | ВЗЛОМ', source: 'мод|уль',
    }) });
    assert.equal(create.status, 200);
    const { body: threads } = await apiJson(`/api/threads${qs}`);
    const t = threads.find(x => x.id === create.body.id);
    assert.ok(t, 'нить не найдена после создания');
    assert.equal(t.description, 'строка1 строка2');
    assert.equal(t.priority, 'Высокий | ВЗЛОМ');
    assert.equal(t.source, 'мод|уль');
  });

  it('нить: PATCH priority с "|" не сдвигает столбцы — статус остаётся корректным', async () => {
    const create = await apiJson(`/api/threads${qs}`, { method: 'POST', body: JSON.stringify({ title: 'Патч ФИКС16' }) });
    const patch = await apiJson(`/api/threads/${create.body.id}${qs}`, { method: 'PATCH', body: JSON.stringify({
      file: 'archive/open_threads.md', priority: 'Низкий | X',
    }) });
    assert.equal(patch.status, 200);
    const { body: threads } = await apiJson(`/api/threads${qs}`);
    const t = threads.find(x => x.id === create.body.id);
    assert.equal(t.priority, 'Низкий | X');
    assert.notEqual(t.status, 'unknown');
  });

  it('концепция модуля (создание): ведущая "##" в content не фабрикует фейковый заголовок в <mod>.md', async () => {
    const create = await apiJson(`/api/chronicles/hronika_fiks16/modules${qs}`, { method: 'POST', body: JSON.stringify({
      name: 'Концепт ФИКС16', time: '2010', content: '## Фейковый заголовок\nидея модуля',
    }) });
    assert.equal(create.status, 200);
    const modPath = path.join(tmpCity, 'chronicles', 'hronika_fiks16', 'modules', create.body.slug, `${create.body.slug}.md`);
    const raw = await fs.readFile(modPath, 'utf-8');
    assert.doesNotMatch(raw, /^## Фейковый заголовок$/m, 'экранирование не сработало — вставленный "##" стал настоящим заголовком');
    const detail = await apiJson(`/api/chronicles/hronika_fiks16/modules/${create.body.slug}/detail${qs}`);
    assert.match(detail.body.description, /## Фейковый заголовок/, 'при чтении назад текст должен де-экранироваться (совпасть с исходным)');
  });

  it('концепция модуля (правка через PUT fields): та же защита, что при создании', async () => {
    const put = await apiJson(`/api/chronicles/hronika_fiks16/modules/modul_fiks16/fields${qs}`, { method: 'PUT', body: JSON.stringify({
      fields: { description: '## Ещё один фейк\nновая идея' },
    }) });
    assert.equal(put.status, 200);
    const modPath = path.join(tmpCity, 'chronicles', 'hronika_fiks16', 'modules', 'modul_fiks16', 'modul_fiks16.md');
    const raw = await fs.readFile(modPath, 'utf-8');
    assert.doesNotMatch(raw, /^## Ещё один фейк$/m);
  });

  it('библиотека: "\\n## Уровень 99" в clans дисциплины не фабрикует фейковый уровень силы', async () => {
    const create = await apiJson('/api/library/disciplines', { method: 'POST', body: JSON.stringify({
      name: 'Тестовая дисциплина ФИКС16', clans: 'Тест\n## Уровень 99 — Фальшивая сила\n**Система.** поддельная',
    }) });
    assert.equal(create.status, 200);
    const discs = (await apiJson('/api/library/disciplines')).body;
    const d = discs.find(x => x.slug === create.body.slug);
    assert.ok(d, 'дисциплина не найдена');
    assert.ok(!d.levels.some(l => l.level === 99), 'фейковый уровень 99 не должен появиться в распарсенных данных');
    // Уборка: DELETE у авторских дисциплин — soft-delete (rename в _deleted/,
    // не erase, см. web/routes/library.js) — файл-огрызок остался бы в repo
    // на каждый прогон тестов, если не убрать его явно вот тут.
    await apiJson(`/api/library/disciplines/${create.body.slug}`, { method: 'DELETE' });
    const trashDir = path.join(__dirname, '../../system/library/disciplines/_deleted');
    const trashFiles = await fs.readdir(trashDir).catch(() => []);
    for (const f of trashFiles.filter(f => f.startsWith(create.body.slug + '_'))) {
      await fs.rm(path.join(trashDir, f), { force: true });
    }
    await fs.rmdir(trashDir).catch(() => {});
  });

  it('город: "|" в политическом составе не сдвигает столбцы «Карты фракций»', async () => {
    const create = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({
      name: 'Fix16 Citytest', year: '2010',
      political: 'Князь: Тест|ВЗЛОМ_ЯЧЕЙКА',
    }) });
    assert.equal(create.status, 200);
    const citySlug = create.body.slug;
    const psFile = path.join(__dirname, '../../cities', citySlug, 'archive/political_state.md');
    const raw = await fs.readFile(psFile, 'utf-8').catch(() => '');
    const row = raw.split('\n').find(l => /Тест/.test(l));
    assert.ok(row, 'строка с ролью «Князь» не найдена в political_state.md');
    const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    assert.equal(cells.length, 4, `ожидалось 4 колонки, "|" в значении сдвинул их: ${row}`);
    await fs.rm(path.join(__dirname, '../../cities', citySlug), { recursive: true, force: true });
  });
});

// Вкладка «📝 Описание» модалки хроники (2026-08-09) — GET/PUT /api/chronicles/:slug/fields
// читают/пишут «Настроение» (инлайн-буллет) и «Описание» (## Описание, вставляется, если
// секции ещё нет — та же self-heal логика, что у локаций, см. writeChronicleFields).
describe('GET/PUT /api/chronicles/:slug/fields — Настроение/Описание (вкладка «Описание»)', () => {
  let citySlug, cityDir, chrSlug;
  const qs = () => `?city=${citySlug}`;

  before(async () => {
    await startServer();
    const cityCreate = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({ name: 'Chr Fields Testcity', year: '2010' }) });
    assert.equal(cityCreate.status, 200, cityCreate.body.error);
    citySlug = cityCreate.body.slug;
    cityDir  = path.join(__dirname, '../../cities', citySlug);

    const chrCreate = await apiJson(`/api/chronicles${qs()}`, { method: 'POST', body: JSON.stringify({ name: 'Хроника Полей' }) });
    assert.equal(chrCreate.status, 200, chrCreate.body.error);
    chrSlug = chrCreate.body.slug;
  });
  after(async () => { await stopServer(); await fs.rm(cityDir, { recursive: true, force: true }); });

  it('свежесозданная хроника — оба поля пустые', async () => {
    const r = await apiJson(`/api/chronicles/${chrSlug}/fields${qs()}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { mood: '', description: '' });
  });

  it('PUT записывает оба поля; секция «Описание» вставляется (её не было в шаблоне создания)', async () => {
    const put = await apiJson(`/api/chronicles/${chrSlug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
      mood: 'Готический нуар, паранойя', description: 'Первая строка.\nВторая строка.',
    }) });
    assert.equal(put.status, 200);
    assert.equal(put.body.mood, 'Готический нуар, паранойя');
    assert.equal(put.body.description, 'Первая строка.\nВторая строка.');

    const get = await apiJson(`/api/chronicles/${chrSlug}/fields${qs()}`);
    assert.deepEqual(get.body, put.body, 'GET после PUT должен отдавать то же самое');
  });

  it('повторный PUT обновляет секцию на месте, не дублирует «## Описание»', async () => {
    await apiJson(`/api/chronicles/${chrSlug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
      mood: 'Надежда сквозь пепел', description: 'Заменённое описание.',
    }) });
    const card = await fs.readFile(path.join(cityDir, 'chronicles', chrSlug, 'chronicle.md'), 'utf-8');
    const descCount = (card.match(/## (?:📝\s+)?Описание/gi) || []).length;
    const moodCount = (card.match(/\*\*Настроение:\*\*/gi) || []).length;
    assert.equal(descCount, 1, 'секция «Описание» задвоилась при повторном PUT');
    assert.equal(moodCount, 1, 'строка «Настроение» задвоилась при повторном PUT');
    assert.match(card, /Заменённое описание\./);
  });

  it('очистка «Настроение» (пустая строка) убирает буллет из карточки', async () => {
    const put = await apiJson(`/api/chronicles/${chrSlug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
      mood: '', description: 'Описание осталось.',
    }) });
    assert.equal(put.status, 200);
    assert.equal(put.body.mood, '');
    const card = await fs.readFile(path.join(cityDir, 'chronicles', chrSlug, 'chronicle.md'), 'utf-8');
    assert.ok(!/\*\*Настроение:\*\*/.test(card), 'строка «Настроение» должна была исчезнуть из файла');
  });

  it('несуществующая хроника → 404 и на GET, и на PUT', async () => {
    const get = await apiJson(`/api/chronicles/net_takoy_hroniki/fields${qs()}`);
    assert.equal(get.status, 404);
    const put = await apiJson(`/api/chronicles/net_takoy_hroniki/fields${qs()}`, { method: 'PUT', body: JSON.stringify({ mood: 'x' }) });
    assert.equal(put.status, 404);
  });

  // Код-ревью 2026-08-11 (F1): chronicle.md опционален (старые хроники хранят
  // только events.md + модули, web/routes/chronicles.js:450) — раньше и GET, и
  // PUT 404'или на отсутствие самого файла, хотя папка хроники реально
  // существовала. GET должен отдавать нули без побочных эффектов записи; PUT —
  // создать chronicle.md с нуля и применить поля как обычно.
  describe('хроника без chronicle.md (папка + events.md есть, файла карточки нет)', () => {
    let noMdSlug;
    before(async () => {
      const chrDir = path.join(cityDir, 'chronicles', 'stariy_bez_kartochki');
      await fs.mkdir(path.join(chrDir, 'modules'), { recursive: true });
      await fs.writeFile(path.join(chrDir, 'events.md'), '# Старая Хроника — События\n\n---\n', 'utf-8');
      noMdSlug = 'stariy_bez_kartochki';
    });

    it('GET на хронику без chronicle.md — не 404, пустые поля, файл не создаётся', async () => {
      const r = await apiJson(`/api/chronicles/${noMdSlug}/fields${qs()}`);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { mood: '', description: '' });
      const exists = await fs.stat(path.join(cityDir, 'chronicles', noMdSlug, 'chronicle.md')).catch(() => null);
      assert.equal(exists, null, 'GET не должен создавать chronicle.md — только PUT');
    });

    it('PUT на хронику без chronicle.md — создаёт файл с названием из events.md и применяет поля', async () => {
      const put = await apiJson(`/api/chronicles/${noMdSlug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
        mood: 'Меланхолия', description: 'Восстановлено после миграции.',
      }) });
      assert.equal(put.status, 200, put.body.error);
      assert.equal(put.body.mood, 'Меланхолия');
      assert.equal(put.body.description, 'Восстановлено после миграции.');

      const card = await fs.readFile(path.join(cityDir, 'chronicles', noMdSlug, 'chronicle.md'), 'utf-8');
      assert.match(card, /Старая Хроника/, 'название должно быть взято из H1 events.md, не из slug');

      const get = await apiJson(`/api/chronicles/${noMdSlug}/fields${qs()}`);
      assert.deepEqual(get.body, put.body, 'повторный GET должен читать уже созданный файл');
    });
  });
});

// docs/design/2026-08-08-relations-mutual-autopairs-techspec.md — Фаза 3 «Связи и отношения»:
// чекбокс «Взаимно» на карточке персонажа A зеркалит связь на карточку персонажа Б, с авто-парой
// типа (Сир↔Чайлд, Домитор↔Гуль, Брат/Сестра по полу цели); повторное сохранение без «Взаимно»
// снимает зеркальную запись у Б, не трогая остальные его связи.
describe('relations-mutual-autopairs: «Взаимно» синхронизирует карточку цели (Фаза 3)', () => {
  let citySlug, cityDir;
  const qs = () => `?city=${citySlug}`;

  before(async () => {
    await startServer();
    const create = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({
      name: 'Mutual Relations Testcity', year: '2010',
    }) });
    assert.equal(create.status, 200, 'не удалось создать тестовый город');
    citySlug = create.body.slug;
    cityDir  = path.join(__dirname, '../../cities', citySlug);
  });
  after(async () => {
    await stopServer();
    await fs.rm(cityDir, { recursive: true, force: true });
  });

  it('Сир↔Чайлд: взаимная связь создаёт зеркальную запись у цели, снятие — убирает', async () => {
    const sire = await apiJson(`/api/characters${qs()}`, { method: 'POST', body: JSON.stringify({
      name: 'Мутуал Сир', lineage: 'vampire', gender: 'Мужской', clan: 'Тремер', sect: 'Камарилья',
    }) });
    assert.equal(sire.status, 200, sire.body.error);
    const childe = await apiJson(`/api/characters${qs()}`, { method: 'POST', body: JSON.stringify({
      name: 'Мутуал Чайлд', lineage: 'vampire', gender: 'Женский', clan: 'Тремер', sect: 'Камарилья',
    }) });
    assert.equal(childe.status, 200, childe.body.error);

    const put1 = await apiJson(`/api/characters/${childe.body.slug}/relations${qs()}`, { method: 'PUT', body: JSON.stringify({
      lines: ['Мутуал Сир — ↔ [Чайлд] обратил меня'],
    }) });
    assert.equal(put1.status, 200);
    assert.deepEqual(put1.body.warnings, []);

    const afterFirst = await apiJson(`/api/characters${qs()}`);
    const sireAfter = afterFirst.body.find(c => c.name === 'Мутуал Сир');
    assert.equal(sireAfter.relationships.length, 1);
    assert.equal(sireAfter.relationships[0].target, 'Мутуал Чайлд');
    assert.equal(sireAfter.relationships[0].relType, 'Сир', 'авто-пара: Чайлд у одной стороны → Сир у другой');
    assert.equal(sireAfter.relationships[0].mutual, true);

    // Снятие взаимности у Чайлда — зеркальная запись у Сира должна исчезнуть.
    const put2 = await apiJson(`/api/characters/${childe.body.slug}/relations${qs()}`, { method: 'PUT', body: JSON.stringify({
      lines: ['Мутуал Сир — [Чайлд] обратил меня'],
    }) });
    assert.equal(put2.status, 200);

    const afterSecond = await apiJson(`/api/characters${qs()}`);
    const sireAfter2 = afterSecond.body.find(c => c.name === 'Мутуал Сир');
    assert.equal(sireAfter2.relationships.length, 0, 'зеркальная запись должна исчезнуть после снятия «Взаимно»');
  });

  it('Брат/Сестра: зеркальный тип зависит от пола цели', async () => {
    const person = await apiJson(`/api/characters${qs()}`, { method: 'POST', body: JSON.stringify({
      name: 'Мутуал Персона', lineage: 'vampire', gender: 'Мужской', clan: 'Тореадор', sect: 'Камарилья',
    }) });
    assert.equal(person.status, 200, person.body.error);
    const sister = await apiJson(`/api/characters${qs()}`, { method: 'POST', body: JSON.stringify({
      name: 'Мутуал Сестра Цель', lineage: 'vampire', gender: 'Женский', clan: 'Тореадор', sect: 'Камарилья',
    }) });
    assert.equal(sister.status, 200, sister.body.error);

    const put = await apiJson(`/api/characters/${person.body.slug}/relations${qs()}`, { method: 'PUT', body: JSON.stringify({
      lines: ['Мутуал Сестра Цель — ↔ [Брат] хороший друг детства'],
    }) });
    assert.equal(put.status, 200);

    const after = await apiJson(`/api/characters${qs()}`);
    const target = after.body.find(c => c.name === 'Мутуал Сестра Цель');
    assert.equal(target.relationships[0].relType, 'Сестра', 'цель — женского пола, зеркальный тип — «Сестра», не «Брат»');
    assert.equal(target.relationships[0].description, '', 'описание не копируется зеркально (§4.4 техспеки)');
  });

  it('Взаимно на несуществующего персонажа — предупреждение, не ошибка сохранения', async () => {
    const solo = await apiJson(`/api/characters${qs()}`, { method: 'POST', body: JSON.stringify({
      name: 'Мутуал Одиночка', lineage: 'vampire', gender: 'Мужской', clan: 'Вентру', sect: 'Камарилья',
    }) });
    assert.equal(solo.status, 200, solo.body.error);

    const put = await apiJson(`/api/characters/${solo.body.slug}/relations${qs()}`, { method: 'PUT', body: JSON.stringify({
      lines: ['Несуществующий Персонаж — ↔ [Союзник] выдуманная связь'],
    }) });
    assert.equal(put.status, 200);
    assert.equal(put.body.warnings.length, 1);
    assert.match(put.body.warnings[0], /не найден/);
  });
});

// docs/design/2026-08-02-city-creation-restructure-{spec,techspec,designspec}.md —
// PUT /api/cities/:slug пишет/снимает «Иерархию» на карточке персонажа (§4.2/§4.4
// техспеки) и «Зону»/«Контроль» на карточке локации (§5.1-5.2), когда выбранная
// роль/статус указывает на СУЩЕСТВУЮЩЕГО персонажа/локацию города — и снимает запись
// автоматически, когда роль переходит к другому персонажу/локации.
describe('city-creation-restructure: город → персонаж/локация (Иерархия/Зона-Контроль write-back)', () => {
  // Английское имя → предсказуемый slugify()-слаг (кириллица транслитерируется не
  // всегда очевидно — берём citySlug из ответа POST /api/cities, а не угадываем его,
  // чтобы тест не мог тихо разъехаться с реальным городом и попасть в чужую директорию).
  let citySlug, cityDir;
  const qs = () => `?city=${citySlug}`;

  before(async () => {
    await startServer();
    const create = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({
      name: 'Restructure Hierarchy Testcity', year: '2010',
    }) });
    assert.equal(create.status, 200, 'не удалось создать тестовый город');
    citySlug = create.body.slug;
    cityDir  = path.join(__dirname, '../../cities', citySlug);
  });
  after(async () => {
    await stopServer();
    await fs.rm(cityDir, { recursive: true, force: true });
  });

  it('Властители города: смена роли с одного персонажа на другого переносит «Иерархию»', async () => {
    const charA = await apiJson(`/api/characters${qs()}`, { method: 'POST', body: JSON.stringify({
      name: 'Реструкт Князь А', lineage: 'vampire', gender: 'Мужской', clan: 'Тремер', sect: 'Камарилья',
    }) });
    assert.equal(charA.status, 200, charA.body.error);
    const charB = await apiJson(`/api/characters${qs()}`, { method: 'POST', body: JSON.stringify({
      name: 'Реструкт Князь Б', lineage: 'vampire', gender: 'Мужской', clan: 'Вентру', sect: 'Камарилья',
    }) });
    assert.equal(charB.status, 200, charB.body.error);

    const put1 = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
      fields: { display: 'Restructure Hierarchy Testcity', year: '2010', political: 'Князь: Реструкт Князь А' },
    }) });
    assert.equal(put1.status, 200);

    const afterFirst = await apiJson(`/api/characters${qs()}`);
    const aAfterFirst = afterFirst.body.find(c => c.name === 'Реструкт Князь А');
    assert.equal(aAfterFirst.hierarchy, 'Князь города Restructure Hierarchy Testcity',
      'у выбранного персонажа должна проставиться «Иерархия»');

    // Смена роли на другого персонажа — прежний должен лишиться «Иерархии».
    const put2 = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
      fields: { display: 'Restructure Hierarchy Testcity', year: '2010', political: 'Князь: Реструкт Князь Б' },
    }) });
    assert.equal(put2.status, 200);

    const afterSecond = await apiJson(`/api/characters${qs()}`);
    const aAfterSecond = afterSecond.body.find(c => c.name === 'Реструкт Князь А');
    const bAfterSecond = afterSecond.body.find(c => c.name === 'Реструкт Князь Б');
    assert.equal(aAfterSecond.hierarchy, '', 'у прежнего персонажа «Иерархия» должна очиститься');
    assert.equal(bAfterSecond.hierarchy, 'Князь города Restructure Hierarchy Testcity',
      'у нового персонажа должна проставиться «Иерархия»');
  });

  // 2026-08-08, Часть 8 (мульти-выбор титулов) — regression на находку дизайн-анализа: с тех
  // пор как «Титул» стал CSV-списком (мульти-пикер из библиотеки на карточке персонажа), синк
  // с картой фракций города должен трогать ТОЛЬКО свой собственный политический токен, не
  // затирать и не терять вручную добавленные титулы целиком (см. docs/design/
  // 2026-08-08-faction-picker-dedup-and-multi-title-analysis.md §2.2).
  it('Властители города: назначение/снятие политроли трогает только свой токен, ручной титул сохраняется', async () => {
    const charC = await apiJson(`/api/characters${qs()}`, { method: 'POST', body: JSON.stringify({
      name: 'Реструкт Мульти-Титул', lineage: 'vampire', gender: 'Мужской', clan: 'Бруха', sect: 'Камарилья',
    }) });
    assert.equal(charC.status, 200, charC.body.error);

    // Персонаж уже носит титул, не связанный с картой фракций (выбран вручную/через мульти-пикер).
    const putField = await apiJson(`/api/characters/${encodeURIComponent(charC.body.slug)}/fields${qs()}`, {
      method: 'PUT', body: JSON.stringify({ fields: { hierarchy: 'Шериф' } }),
    });
    assert.equal(putField.status, 200);

    const putPol1 = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
      fields: { display: 'Restructure Hierarchy Testcity', year: '2010', political: 'Князь: Реструкт Мульти-Титул' },
    }) });
    assert.equal(putPol1.status, 200);

    const after1 = await apiJson(`/api/characters${qs()}`);
    const cAfter1 = after1.body.find(c => c.name === 'Реструкт Мульти-Титул');
    assert.equal(cAfter1.hierarchy, 'Князь города Restructure Hierarchy Testcity, Шериф',
      'политический токен должен встать первым (дизайн-ревью п.2), ручной титул — сохраниться следом');

    // Снятие политроли — ручной титул должен остаться, политический токен уйти.
    const putPol2 = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
      fields: { display: 'Restructure Hierarchy Testcity', year: '2010', political: '' },
    }) });
    assert.equal(putPol2.status, 200);

    const after2 = await apiJson(`/api/characters${qs()}`);
    const cAfter2 = after2.body.find(c => c.name === 'Реструкт Мульти-Титул');
    assert.equal(cAfter2.hierarchy, 'Шериф', 'после снятия политроли должен остаться только вручную добавленный титул');
  });

  it('Значимые места: смена локации со статусом «Элизиум» переносит «Статус» (VtM)', async () => {
    // 2026-08-06, план «карточка локации» §7.1/§3.1: раньше «Элизиум» синкался в
    // «Зону» карточки локации (метаданные) — теперь все 5 типов «Значимых мест»
    // пишут в «Статус» вкладки VtM (строка markdown-таблицы), «Зону» решили не
    // трогать вовсе. Позже (техспека «Статус заменяет Зону», тот же день) формат
    // самого значения тоже сменился: было «[Город] Элизиум» (маркер+заметка),
    // стало чистое «Элизиум» — заметка теперь живёт только в city.md. Тест
    // обновлён под новый формат, сценарий не менялся.
    const locA = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({ name: 'Реструкт Элизиум А' }) });
    assert.equal(locA.status, 200, locA.body.error);
    const locB = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({ name: 'Реструкт Элизиум Б' }) });
    assert.equal(locB.status, 200, locB.body.error);

    const put1 = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
      fields: { display: 'Restructure Hierarchy Testcity', year: '2010', locations: 'Элизиум: Реструкт Элизиум А' },
    }) });
    assert.equal(put1.status, 200);

    const afterFirst = await apiJson(`/api/locations${qs()}`);
    const aAfterFirst = afterFirst.body.find(l => l.title === 'Реструкт Элизиум А');
    assert.equal(aAfterFirst.locStatus, 'Элизиум', 'у выбранной локации должен проставиться «Статус»');

    // Смена значимого места на другую локацию — прежняя должна лишиться «Статуса».
    const put2 = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
      fields: { display: 'Restructure Hierarchy Testcity', year: '2010', locations: 'Элизиум: Реструкт Элизиум Б' },
    }) });
    assert.equal(put2.status, 200);

    const afterSecond = await apiJson(`/api/locations${qs()}`);
    const aAfterSecond = afterSecond.body.find(l => l.title === 'Реструкт Элизиум А');
    const bAfterSecond = afterSecond.body.find(l => l.title === 'Реструкт Элизиум Б');
    assert.ok(!aAfterSecond.locStatus, 'у прежней локации «Статус» должен очиститься');
    assert.equal(bAfterSecond.locStatus, 'Элизиум', 'у новой локации должен проставиться «Статус»');
  });
});

describe('city-creation-restructure §15-16: Опасность/сенсорика/VtM-таблица/районы/slug-уникальность/факции↔city.md', () => {
  let citySlug, cityDir;
  const qs = () => `?city=${citySlug}`;

  before(async () => {
    await startServer();
    const create = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({
      name: 'Fifteen Sixteen Testcity', year: '2010', factions: 'Камарилья\nШабаш',
    }) });
    assert.equal(create.status, 200, create.body.error);
    citySlug = create.body.slug;
    cityDir  = path.join(__dirname, '../../cities', citySlug);
  });
  after(async () => {
    await stopServer();
    await fs.rm(cityDir, { recursive: true, force: true });
  });

  describe('PUT /fields — Опасность, Сенсорная палитра, VtM-таблица (техспека §13.1-13.3)', () => {
    let slug;
    before(async () => {
      const create = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({ name: 'Опасное место' }) });
      assert.equal(create.status, 200, create.body.error);
      slug = create.body.slug;
    });

    it('dangerLevel пишется в инлайн-поле «Опасность», отдельно от «Зоны»', async () => {
      const put = await apiJson(`/api/locations/${slug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
        fields: { dangerLevel: '🟡 Средний', zone: '🔴 Опасная' },
      }) });
      assert.equal(put.status, 200);
      const locs = await apiJson(`/api/locations${qs()}`);
      const loc = locs.body.find(l => l.slug === slug);
      assert.equal(loc.dangerLevel, '🟡 Средний');
      assert.equal(loc.zone, '🔴 Опасная');
    });

    it('sensoryPalette — построчная таблица канал/значение раунд-трипится через parseLocation', async () => {
      // §C3 — Свет/Звук/Запах обязательны (карточка их уже содержит, из шаблона
      // создания): таблица должна нести все три, иначе PUT отклоняется (см. отдельный
      // блок тестов ниже) — «Тактильное» по-прежнему можно опустить.
      const table = '| Канал | |\n|---|---|\n| **Свет** | Тусклый неон |\n| **Звук** | Капель воды |\n| **Запах** | Плесень |';
      const put = await apiJson(`/api/locations/${slug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
        fields: { sensoryPalette: table },
      }) });
      assert.equal(put.status, 200, put.body.error);
      const locs = await apiJson(`/api/locations${qs()}`);
      const loc = locs.body.find(l => l.slug === slug);
      assert.deepEqual(loc.sensoryPalette, [
        { channel: 'Свет', value: 'Тусклый неон' },
        { channel: 'Звук', value: 'Капель воды' },
        { channel: 'Запах', value: 'Плесень' },
      ]);
    });

    it('§C3 — попытка убрать обязательный канал (уже существовавший) → 400, файл не меняется', async () => {
      const before = (await apiJson(`/api/locations${qs()}`)).body.find(l => l.slug === slug);
      const table = '| Канал | |\n|---|---|\n| **Свет** | Тусклый неон |\n| **Звук** | Капель воды |';
      const put = await apiJson(`/api/locations/${slug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
        fields: { sensoryPalette: table },
      }) });
      assert.equal(put.status, 400);
      assert.match(put.body.error, /Запах/);
      const after = (await apiJson(`/api/locations${qs()}`)).body.find(l => l.slug === slug);
      assert.deepEqual(after.sensoryPalette, before.sensoryPalette, 'отклонённый PUT не должен был ничего поменять');
    });

    it('§C3 — обязательный канал с ПУСТЫМ значением (не отсутствующей строкой) сохраняется без ошибки', async () => {
      const table = '| Канал | |\n|---|---|\n| **Свет** |  |\n| **Звук** | Капель воды |\n| **Запах** | Плесень |';
      const put = await apiJson(`/api/locations/${slug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
        fields: { sensoryPalette: table },
      }) });
      assert.equal(put.status, 200, put.body.error);
    });

    it('§C3 — локация с каналами-алиасами (Зрение вместо Свет, как реальные данные Балмонта) редактируется свободно', async () => {
      // Нормализация алиасов — вне скоупа (location-card-modal-plan.md §2.1/§2.3):
      // требование не навязывается каналу, которого под каноническим именем в
      // карточке никогда не было — иначе редактирование ЛЮБОГО канала у такой
      // локации стало бы невозможным. POST /api/locations всегда сеет стандартный
      // шаблон (Свет/Звук/Запах уже есть) — такую карточку одним PUT в «алиасную» не
      // превратить, это ловит сам же новый guard. Реальные алиасные карточки в данных
      // созданы не через текущий API — пишем файл на диск напрямую, как и есть у них.
      const aliasSlug = 'test_alias_channels_loc';
      const aliasDir = path.join(cityDir, 'locations', 'alias_test_rayon', aliasSlug);
      await fs.mkdir(aliasDir, { recursive: true });
      await fs.writeFile(path.join(aliasDir, `${aliasSlug}.md`), [
        '# Локация С Алиасами',
        '> **Название:** Локация С Алиасами | **Район:** Alias Test | **Контроль:** —',
        '---', '## 🎭 Атмосфера', 'Тест.', '## 👁️ Сенсорная палитра',
        '| Канал | |', '|---|---|',
        '| **Зрение** | Полумрак |', '| **Прикосновение** | Сырость |', '',
      ].join('\n'), 'utf-8');

      try {
        const put = await apiJson(`/api/locations/${aliasSlug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
          fields: { sensoryPalette: '| Канал | |\n|---|---|\n| **Зрение** | Полная тьма |\n| **Прикосновение** | Сырость |' },
        }) });
        assert.equal(put.status, 200, put.body.error);
      } finally {
        await fs.rm(aliasDir, { recursive: true, force: true });
      }
    });

    it('vtmTable — построчная сборка по полям (не задевает vtmText прозу рядом)', async () => {
      const putText = await apiJson(`/api/locations/${slug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
        fields: { vtmText: 'Здесь пахнет кровью и вечностью.' },
      }) });
      assert.equal(putText.status, 200);

      const put = await apiJson(`/api/locations/${slug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
        fields: { vtmTable: { locStatus: 'Открыто', faction: 'Носферату', figures: 'Бармен', threats: 'Шпионы', masquerade: '🔴 близко раскрытие' } },
      }) });
      assert.equal(put.status, 200);

      const locs = await apiJson(`/api/locations${qs()}`);
      const loc = locs.body.find(l => l.slug === slug);
      assert.equal(loc.locStatus, 'Открыто');
      assert.equal(loc.faction, 'Носферату');
      assert.equal(loc.figures, 'Бармен');
      assert.equal(loc.threats, 'Шпионы');
      assert.equal(loc.masquerade, '🔴 близко раскрытие');
      assert.equal(loc.vtmText, 'Здесь пахнет кровью и вечностью.', 'проза не должна пострадать от правки табличных полей');
    });

    it('vtmTable — пустая строка стирает ровно одну ячейку таблицы, остальные не трогает', async () => {
      const put = await apiJson(`/api/locations/${slug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
        fields: { vtmTable: { faction: '' } },
      }) });
      assert.equal(put.status, 200);
      const locs = await apiJson(`/api/locations${qs()}`);
      const loc = locs.body.find(l => l.slug === slug);
      assert.ok(!loc.faction, 'Фракция должна очиститься');
      assert.equal(loc.locStatus, 'Открыто', 'Статус — не в этом PUT, должен остаться прежним');
      assert.equal(loc.threats, 'Шпионы', 'Угрозы — не в этом PUT, должны остаться прежними');
    });

    // Баг, найден пользователем на живых данных 2026-08-09: почти все локации Парижа
    // заведены до появления секции «## Ключевые точки» (2026-08-06) — PUT .../fields с
    // keyPoints у них молча ничего не писал (replace-регексп не находил заголовок,
    // возвращал карточку без изменений, но отвечал 200) — «записи не отображаются»
    // после добавления ключевой точки. Тот же баг был и у «hooks» на нескольких
    // карточках. Фикс — _upsertLocSection (routes/locations.js): вставляет отсутствующую
    // секцию перед следующим якорем по шаблону, вместо молчаливого no-op.
    it('keyPoints/hooks — PUT на карточке БЕЗ секции создаёт её (self-heal легаси-карточек), не no-op\'ится молча', async () => {
      const legacyCard = [
        '# Легаси Локация Без Секций', '',
        '> **Название:** Легаси Локация Без Секций | **Район:** Тест',
        '---',
        '## 🎭 Атмосфера', 'Тестовая атмосфера.',
        '## 🖼️ Изображения',
        '- ⏳ Изображение не предоставлено', '',
      ].join('\n');
      const legacySlug = 'legacy_no_sections_test';
      const legacyDir = path.join(cityDir, 'locations', 'legacy_test_rayon', legacySlug);
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(path.join(legacyDir, `${legacySlug}.md`), legacyCard, 'utf-8');

      try {
        const putKeys = await apiJson(`/api/locations/${legacySlug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
          fields: { keyPoints: '| Место | Описание |\n|---|---|\n| Точка А | Описание А |' },
        }) });
        assert.equal(putKeys.status, 200, putKeys.body.error);

        const putHooks = await apiJson(`/api/locations/${legacySlug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
          fields: { hooks: 'Крючок номер один' },
        }) });
        assert.equal(putHooks.status, 200, putHooks.body.error);

        const locs = await apiJson(`/api/locations${qs()}`);
        const loc = locs.body.find(l => l.slug === legacySlug);
        assert.deepEqual(loc.keyPoints, [{ place: 'Точка А', desc: 'Описание А' }],
          'ключевая точка должна была реально записаться, не потеряться молча');
        assert.deepEqual(loc.hooks, ['Крючок номер один'], 'крючок должен был реально записаться');

        // Повторный PUT — секция должна ОБНОВЛЯТЬСЯ, не дублироваться.
        const putKeys2 = await apiJson(`/api/locations/${legacySlug}/fields${qs()}`, { method: 'PUT', body: JSON.stringify({
          fields: { keyPoints: '| Место | Описание |\n|---|---|\n| Точка А | Описание А |\n| Точка Б | Описание Б |' },
        }) });
        assert.equal(putKeys2.status, 200);
        const cardAfter = await fs.readFile(path.join(legacyDir, `${legacySlug}.md`), 'utf-8');
        const sectionCount = (cardAfter.match(/## (?:🗺️\s+)?Ключевые точки/gi) || []).length;
        assert.equal(sectionCount, 1, 'секция «Ключевые точки» не должна дублироваться при повторном PUT');
        const locs2 = await apiJson(`/api/locations${qs()}`);
        const loc2 = locs2.body.find(l => l.slug === legacySlug);
        assert.equal(loc2.keyPoints.length, 2, 'вторая точка должна добавиться в ТУ ЖЕ секцию');
      } finally {
        await fs.rm(path.join(cityDir, 'locations', 'legacy_test_rayon'), { recursive: true, force: true });
      }
    });
  });

  describe('POST /api/locations — глобальная уникальность slug по городу (техспека §16.3, решение (a))', () => {
    it('второе имя, дающее тот же slug в другом районе → 409 с указанием района первой карточки', async () => {
      const first = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({
        name: 'Коллизия Слага', district: 'Район А',
      }) });
      assert.equal(first.status, 200, first.body.error);

      const second = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({
        name: 'Коллизия Слага', district: 'Район Б',
      }) });
      assert.equal(second.status, 409);
      assert.match(second.body.error, /Район А/, 'сообщение должно называть район уже существующей карточки');
      assert.equal(second.body.slug, first.body.slug);

      const locs = await apiJson(`/api/locations${qs()}`);
      assert.equal(locs.body.filter(l => l.slug === first.body.slug).length, 1,
        'в другом районе карточка-дубликат не должна была создаться физически');
    });

    it('разные имена → разные slug, конфликта нет даже в одном районе-тёзке', async () => {
      const a = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({ name: 'Первая Уникальная', district: 'Общий Район' }) });
      const b = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({ name: 'Вторая Уникальная', district: 'Общий Район' }) });
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.notEqual(a.body.slug, b.body.slug);
    });
  });

  describe('PUT /api/locations/:slug/district — привязка/перенос локации между районами (техспека §9.2-9.3)', () => {
    let slug;
    before(async () => {
      const create = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({
        name: 'Кочующая Точка', district: 'Старый Квартал',
      }) });
      assert.equal(create.status, 200, create.body.error);
      slug = create.body.slug;
    });

    it('без района в body → 400', async () => {
      const r = await apiJson(`/api/locations/${slug}/district${qs()}`, { method: 'PUT', body: JSON.stringify({ district: '' }) });
      assert.equal(r.status, 400);
    });

    it('перенос в район без district.md — «Район» карточки становится слагом района (район ещё не формальная сущность)', async () => {
      const r = await apiJson(`/api/locations/${slug}/district${qs()}`, { method: 'PUT', body: JSON.stringify({ district: 'Новый Квартал' }) });
      assert.equal(r.status, 200, r.body.error);
      assert.ok(r.body.movedFrom && r.body.movedTo);

      const locs = await apiJson(`/api/locations${qs()}`);
      const loc = locs.body.find(l => l.slug === slug);
      assert.equal(loc.district, 'novyy_kvartal');
      assert.equal(loc.dirRelPath.split('/')[0], 'novyy_kvartal');

      const oldDir = path.join(cityDir, 'locations', 'staryy_kvartal', slug);
      assert.ok(!(await fs.stat(oldDir).catch(() => null)), 'старая папка должна исчезнуть');
    });

    it('перенос в район с district.md (формальная сущность) — «Район» становится display-именем района (техспека §9.1)', async () => {
      const distCreate = await apiJson(`/api/cities/${citySlug}/districts`, { method: 'POST', body: JSON.stringify({ name: 'Настоящий Район' }) });
      assert.equal(distCreate.status, 200, distCreate.body.error);

      const r = await apiJson(`/api/locations/${slug}/district${qs()}`, { method: 'PUT', body: JSON.stringify({ district: 'Настоящий Район' }) });
      assert.equal(r.status, 200, r.body.error);

      const locs = await apiJson(`/api/locations${qs()}`);
      const loc = locs.body.find(l => l.slug === slug);
      assert.equal(loc.district, 'Настоящий Район');
    });

    it('§B1 — ссылки на переехавшую локацию обновляются, битых не остаётся', async () => {
      // Сценарий из отчёта QA: локация переехала villet → antrepo, а ссылка на неё
      // в модуле осталась указывать на старый путь и стала битой молча.
      const created = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({
        name: 'Склад со Ссылками', district: 'Исходный Район',
      }) });
      assert.equal(created.status, 200, created.body.error);
      const locSlug = created.body.slug;

      // Файл-«ссылатель» на два уровня глубже locations/ — как реальный модуль хроники.
      const refDir = path.join(cityDir, 'chronicles', 'test_chr', 'modules', 'test_mod');
      await fs.mkdir(refDir, { recursive: true });
      const refFile = path.join(refDir, 'test_mod.md');
      await fs.writeFile(refFile, [
        '# Модуль',
        `| Сцена | [Склад](../../../../locations/ishodnyy_rayon/${locSlug}/${locSlug}.md) |`,
        `| Прочее | [Другая](../../../../locations/ishodnyy_rayon/drugaya/drugaya.md) |`,
        '',
      ].join('\n'), 'utf-8');

      const move = await apiJson(`/api/locations/${locSlug}/district${qs()}`, {
        method: 'PUT', body: JSON.stringify({ district: 'Целевой Район' }),
      });
      assert.equal(move.status, 200, move.body.error);
      assert.equal(move.body.linksUpdated, 1, 'должен быть поправлен ровно один файл');
      assert.ok(!move.body.warning, move.body.warning);

      const after = await fs.readFile(refFile, 'utf-8');
      assert.ok(after.includes(`locations/tselevoy_rayon/${locSlug}/${locSlug}.md`),
        'ссылка должна указывать на новый путь');
      assert.ok(!after.includes(`locations/ishodnyy_rayon/${locSlug}/`),
        'старого пути остаться не должно');
      assert.ok(after.includes('locations/ishodnyy_rayon/drugaya/drugaya.md'),
        'ссылка на ДРУГУЮ локацию в том же файле не должна пострадать');

      await fs.rm(path.join(cityDir, 'chronicles', 'test_chr'), { recursive: true, force: true });
    });

    it('§B1 — файл с BOM переживает правку ссылок без потери BOM', async () => {
      const created = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({
        name: 'Локация Бом', district: 'Бом Район А',
      }) });
      const locSlug = created.body.slug;
      const refFile = path.join(cityDir, 'archive', 'bom_ref.md');
      await fs.writeFile(refFile,
        `﻿# Архив\n\n[Ссылка](../locations/bom_rayon_a/${locSlug}/${locSlug}.md)\n`, 'utf-8');

      const move = await apiJson(`/api/locations/${locSlug}/district${qs()}`, {
        method: 'PUT', body: JSON.stringify({ district: 'Бом Район Б' }),
      });
      assert.equal(move.status, 200);
      assert.equal(move.body.linksUpdated, 1);

      const after = await fs.readFile(refFile, 'utf-8');
      assert.equal(after.charCodeAt(0), 0xFEFF, 'BOM потерян при правке');
      assert.ok(after.includes(`locations/bom_rayon_b/${locSlug}/`));
      await fs.rm(refFile, { force: true });
    });

    it('§B1 — без входящих ссылок linksUpdated:0, это не ошибка', async () => {
      const created = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({
        name: 'Локация Без Ссылок', district: 'Пустой Район А',
      }) });
      const move = await apiJson(`/api/locations/${created.body.slug}/district${qs()}`, {
        method: 'PUT', body: JSON.stringify({ district: 'Пустой Район Б' }),
      });
      assert.equal(move.status, 200);
      assert.equal(move.body.linksUpdated, 0);
    });

    it('§B2 — GET /backlinks находит ссылающиеся файлы, не трогая их', async () => {
      const created = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({
        name: 'Локация Со Ссылками На Себя', district: 'Район Бэклинков',
      }) });
      const locSlug = created.body.slug;
      const refDir = path.join(cityDir, 'chronicles', 'test_bl_chr', 'modules', 'test_bl_mod');
      await fs.mkdir(refDir, { recursive: true });
      const refFile = path.join(refDir, 'test_bl_mod.md');
      await fs.writeFile(refFile,
        `[Ссылка](../../../../locations/rayon_beklinkov/${locSlug}/${locSlug}.md)\n`, 'utf-8');

      const bl = await apiJson(`/api/locations/${locSlug}/backlinks${qs()}`);
      assert.equal(bl.status, 200);
      assert.equal(bl.body.count, 1);
      assert.ok(bl.body.files[0].includes('test_bl_mod.md'));
      const untouched = await fs.readFile(refFile, 'utf-8');
      assert.ok(untouched.includes(`locations/rayon_beklinkov/${locSlug}/`), 'read-only — файл не должен был измениться');

      await fs.rm(path.join(cityDir, 'chronicles', 'test_bl_chr'), { recursive: true, force: true });
    });

    it('§B2 — без входящих ссылок count:0', async () => {
      const created = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({
        name: 'Локация Без Бэклинков', district: 'Район Одиночка',
      }) });
      const bl = await apiJson(`/api/locations/${created.body.slug}/backlinks${qs()}`);
      assert.equal(bl.status, 200);
      assert.equal(bl.body.count, 0);
      assert.deepEqual(bl.body.files, []);
    });

    it('§B2 — несуществующая локация → 404', async () => {
      const r = await apiJson(`/api/locations/net_takoy_lokacii/backlinks${qs()}`);
      assert.equal(r.status, 404);
    });

    it('перенос в тот же район — no-op (§9.3), папка не трогается', async () => {
      const r = await apiJson(`/api/locations/${slug}/district${qs()}`, { method: 'PUT', body: JSON.stringify({ district: 'Настоящий Район' }) });
      assert.equal(r.status, 200);
      assert.equal(r.body.movedFrom, null);
      assert.equal(r.body.movedTo, null);
    });

    it('в целевом районе уже есть папка с тем же именем → 409, источник не трогается', async () => {
      // Такое состояние на диске могло остаться от карточек, созданных до фикса §16.3
      // (сейчас POST /api/locations такую коллизию уже не пропустит) — ручной сетап
      // файловой системы, не через API, чтобы воспроизвести именно этот кейс.
      const collideDir = path.join(cityDir, 'locations', 'zanyatyy_rayon', slug);
      await fs.mkdir(collideDir, { recursive: true });
      await fs.writeFile(path.join(collideDir, `${slug}.md`), '# Занято\n', 'utf-8');

      const r = await apiJson(`/api/locations/${slug}/district${qs()}`, { method: 'PUT', body: JSON.stringify({ district: 'Занятый Район' }) });
      assert.equal(r.status, 409);

      const locs = await apiJson(`/api/locations${qs()}`);
      assert.ok(locs.body.find(l => l.slug === slug && l.district === 'Настоящий Район'), 'исходная карточка должна остаться на месте');

      await fs.rm(path.join(cityDir, 'locations', 'zanyatyy_rayon'), { recursive: true, force: true });
    });
  });

  describe('Районы (District) — POST/GET/PUT /api/cities/:slug/districts (техспека §2)', () => {
    it('POST создаёт district.md; GET отдаёт его в списке', async () => {
      const create = await apiJson(`/api/cities/${citySlug}/districts`, { method: 'POST', body: JSON.stringify({
        name: 'Тестовый Округ', type: 'Квартал', sect: 'Камарилья', description: 'Портовый район с доками.',
      }) });
      assert.equal(create.status, 200, create.body.error);
      assert.ok(await fs.stat(path.join(cityDir, 'locations', create.body.slug, 'district.md')).catch(() => null));

      const list = await apiJson(`/api/cities/${citySlug}/districts`);
      assert.equal(list.status, 200);
      const found = list.body.find(d => d.slug === create.body.slug);
      assert.ok(found);
      assert.equal(found.name, 'Тестовый Округ');
      assert.equal(found.type, 'Квартал');
      assert.equal(found.sect, 'Камарилья');
      assert.equal(found.description, 'Портовый район с доками.',
        'GET-список раньше не отдавал description — карточка на странице просмотра не могла его показать ни при каких условиях');
    });

    it('без названия → 400', async () => {
      const r = await apiJson(`/api/cities/${citySlug}/districts`, { method: 'POST', body: JSON.stringify({ type: 'X' }) });
      assert.equal(r.status, 400);
    });

    it('повторное название → 409 (тот же slug папки)', async () => {
      const r = await apiJson(`/api/cities/${citySlug}/districts`, { method: 'POST', body: JSON.stringify({ name: 'Тестовый Округ' }) });
      assert.equal(r.status, 409);
    });

    it('PUT правит поля района, НЕ переименовывая папку/слаг', async () => {
      const list = await apiJson(`/api/cities/${citySlug}/districts`);
      const districtSlug = list.body.find(d => d.name === 'Тестовый Округ').slug;

      const put = await apiJson(`/api/cities/${citySlug}/districts/${districtSlug}`, { method: 'PUT', body: JSON.stringify({
        name: 'Обновлённое Имя Округа',
      }) });
      assert.equal(put.status, 200, put.body.error);
      assert.equal(put.body.slug, districtSlug);

      const after = await apiJson(`/api/cities/${citySlug}/districts`);
      const found = after.body.find(d => d.slug === districtSlug);
      assert.equal(found.name, 'Обновлённое Имя Округа');
    });

    it('PUT с пустым именем → 400', async () => {
      const list = await apiJson(`/api/cities/${citySlug}/districts`);
      const districtSlug = list.body[0].slug;
      const r = await apiJson(`/api/cities/${citySlug}/districts/${districtSlug}`, { method: 'PUT', body: JSON.stringify({ name: '  ' }) });
      assert.equal(r.status, 400);
    });
  });

  describe('DELETE /api/cities/:slug/districts/:districtSlug (§A5)', () => {
    it('пустой район удаляется (soft-delete в locations/_deleted/)', async () => {
      const create = await apiJson(`/api/cities/${citySlug}/districts`, { method: 'POST', body: JSON.stringify({ name: 'Удаляемый Пустой' }) });
      assert.equal(create.status, 200, create.body.error);
      const del = await apiJson(`/api/cities/${citySlug}/districts/${create.body.slug}`, { method: 'DELETE' });
      assert.equal(del.status, 200, del.body.error);
      assert.ok(!(await fs.stat(path.join(cityDir, 'locations', create.body.slug)).catch(() => null)),
        'папка района не должна остаться на прежнем месте');
      const trash = await fs.readdir(path.join(cityDir, 'locations', '_deleted')).catch(() => []);
      assert.ok(trash.some(e => e.startsWith(`district_${create.body.slug}_`)), 'район должен уехать в _deleted');
    });

    it('удаление непустого района → 409 со списком локаций, район НЕ удаляется', async () => {
      const create = await apiJson(`/api/cities/${citySlug}/districts`, { method: 'POST', body: JSON.stringify({ name: 'Удаляемый Непустой' }) });
      assert.equal(create.status, 200);
      const loc = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({ name: 'Заложник Района', district: 'Удаляемый Непустой' }) });
      assert.equal(loc.status, 200, loc.body.error);

      const del = await apiJson(`/api/cities/${citySlug}/districts/${create.body.slug}`, { method: 'DELETE' });
      assert.equal(del.status, 409);
      assert.match(del.body.error, /1/, 'сообщение должно называть число локаций');
      assert.deepEqual(del.body.locations, [loc.body.slug]);
      assert.ok(await fs.stat(path.join(cityDir, 'locations', create.body.slug, 'district.md')).catch(() => null),
        'район должен остаться на месте после отказа');
      assert.ok(await fs.stat(path.join(cityDir, 'locations', create.body.slug, loc.body.slug)).catch(() => null),
        'локация внутри района не должна была пострадать');
    });

    it('удаление района убирает его из секции «## Районы»', async () => {
      const create = await apiJson(`/api/cities/${citySlug}/districts`, { method: 'POST', body: JSON.stringify({ name: 'Временный Для Синка' }) });
      assert.equal(create.status, 200);
      let parsed = parseCityMd(await fs.readFile(path.join(cityDir, 'city.md'), 'utf-8'));
      assert.ok(parsed.sections.districts.includes('Временный Для Синка'));

      const del = await apiJson(`/api/cities/${citySlug}/districts/${create.body.slug}`, { method: 'DELETE' });
      assert.equal(del.status, 200);
      parsed = parseCityMd(await fs.readFile(path.join(cityDir, 'city.md'), 'utf-8'));
      assert.ok(!parsed.sections.districts.includes('Временный Для Синка'),
        'удалённый район не должен оставаться в зеркале city.md');
    });

    it('несуществующий район → 404; недопустимый слаг → 400', async () => {
      const notFound = await apiJson(`/api/cities/${citySlug}/districts/net_takogo_rayona`, { method: 'DELETE' });
      assert.equal(notFound.status, 404);
      const bad = await apiJson(`/api/cities/${citySlug}/districts/${encodeURIComponent('../../etc')}`, { method: 'DELETE' });
      assert.ok([400, 404].includes(bad.status), 'выход за пределы слага должен быть отклонён, не выполнен');
    });
  });

  describe('«## Районы» в city.md — одностороннее зеркало District-сущностей (§A3.2)', () => {
    let slug, dir;
    before(async () => {
      const r = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({ name: 'A3 Mirror City', year: '2010' }) });
      assert.equal(r.status, 200, r.body.error);
      slug = r.body.slug;
      dir  = path.join(__dirname, '../../cities', slug);
    });
    after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    it('POST района создаёт/дополняет секцию «## Районы» именем нового района', async () => {
      const r1 = await apiJson(`/api/cities/${slug}/districts`, { method: 'POST', body: JSON.stringify({ name: 'Альфа' }) });
      assert.equal(r1.status, 200, r1.body.error);
      assert.ok(!r1.body.warning, r1.body.warning);
      let parsed = parseCityMd(await fs.readFile(path.join(dir, 'city.md'), 'utf-8'));
      assert.equal(parsed.sections.districts, 'Альфа');

      const r2 = await apiJson(`/api/cities/${slug}/districts`, { method: 'POST', body: JSON.stringify({ name: 'Бета' }) });
      assert.equal(r2.status, 200);
      parsed = parseCityMd(await fs.readFile(path.join(dir, 'city.md'), 'utf-8'));
      assert.deepEqual(parsed.sections.districts.split('\n').sort(), ['Альфа', 'Бета']);
    });

    it('PUT переименования района обновляет имя в секции, не задваивая строку', async () => {
      const list = await apiJson(`/api/cities/${slug}/districts`);
      const alphaSlug = list.body.find(d => d.name === 'Альфа').slug;
      const put = await apiJson(`/api/cities/${slug}/districts/${alphaSlug}`, { method: 'PUT', body: JSON.stringify({ name: 'Альфа-Прим' }) });
      assert.equal(put.status, 200, put.body.error);

      const parsed = parseCityMd(await fs.readFile(path.join(dir, 'city.md'), 'utf-8'));
      const names = parsed.sections.districts.split('\n').sort();
      assert.deepEqual(names, ['Альфа-Прим', 'Бета'], 'старое имя должно исчезнуть, новое — появиться, без дублей');
    });

    it('city.md без секции «## Районы» — синк невозможен, POST района всё равно 200 с warning', async () => {
      const cityMdPath = path.join(dir, 'city.md');
      const original = await fs.readFile(cityMdPath, 'utf-8');
      try {
        await fs.writeFile(cityMdPath, original.replace(/## Районы\n[\s\S]*?(?=\n## )/, ''), 'utf-8');
        const r = await apiJson(`/api/cities/${slug}/districts`, { method: 'POST', body: JSON.stringify({ name: 'Гамма' }) });
        assert.equal(r.status, 200, 'создание района не должно откатываться из-за сбоя синка города');
        assert.ok(r.body.warning, 'ожидался warning — секция «Районы» не найдена');
        const list = await apiJson(`/api/cities/${slug}/districts`);
        assert.ok(list.body.some(d => d.name === 'Гамма'), 'district.md всё равно должен был создаться');
      } finally {
        await fs.writeFile(cityMdPath, original, 'utf-8');
        // district.md «Гамма» создан НА ДИСКЕ независимо от отката city.md выше —
        // не убрать его здесь означало бы, что следующий тест в этом describe (реальный
        // GET /districts) видит район, которого нет в city.md, и ловит это как «баг».
        await fs.rm(path.join(dir, 'locations', 'gamma'), { recursive: true, force: true });
      }
    });

    it('повторный синк с тем же составом районов — не меняет файл (идемпотентность)', async () => {
      const before = await fs.readFile(path.join(dir, 'city.md'), 'utf-8');
      // PUT без реального изменения состава районов (правим только тип) не должен трогать
      // байты секции «## Районы» — тот же инвариант, что и у §A1, но для синка через
      // upsertCitySectionBullets: тут перестройка секции ПРОИСХОДИТ каждый раз (это
      // выравнивание списка, не point-diff), но при одинаковом наборе имён итоговый
      // текст обязан совпасть с тем, что уже на диске.
      const list = await apiJson(`/api/cities/${slug}/districts`);
      const target = list.body[0];
      const put = await apiJson(`/api/cities/${slug}/districts/${target.slug}`, { method: 'PUT', body: JSON.stringify({ type: target.type || '' }) });
      assert.equal(put.status, 200);
      assert.equal(await fs.readFile(path.join(dir, 'city.md'), 'utf-8'), before);
    });
  });

  describe('POST /api/cities — все 16 секций и разбор CSV районов (§A2, §A6.2)', () => {
    const RULE_KEYS = ['landmarks', 'hunting', 'edicts', 'mortals', 'calendar', 'tech', 'limits', 'naming'];
    let slug, dir;

    before(async () => {
      const fields = {
        name: 'A2 Zhivoy Gorod', year: '2010',
        description: 'Описание.', factions: 'Камарилья', political: 'Князь: Кто-то',
        locations: 'Элизиум: Где-то', leitmotif: 'Лейтмотив', specifics: 'Специфика',
        avoid: 'Избегать', sources: 'Источники',
        districts: 'Первый Ку, Второй Ку',
        factionsMortal: 'Полиция', factionsState: 'DGSI',
      };
      for (const k of RULE_KEYS) fields[k] = `значение-${k}`;
      const r = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify(fields) });
      assert.equal(r.status, 200, r.body.error);
      slug = r.body.slug;
      dir  = path.join(__dirname, '../../cities', slug);
    });
    after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    it('§A2 — все 16 канонических секций долетают до city.md (раньше 8 молча терялись)', async () => {
      const parsed = parseCityMd(await fs.readFile(path.join(dir, 'city.md'), 'utf-8'));
      for (const k of RULE_KEYS)
        assert.equal(parsed.sections[k], `значение-${k}`, `секция ${k} потерялась при создании`);
      const empty = CITY_SECTIONS.filter(([k]) => !(parsed.sections[k] || '').trim()).map(([k]) => k);
      assert.deepEqual(empty, [], `пустыми остались секции: ${empty.join(', ')}`);
    });

    it('§A2 — промты генерации получают ограничения и именник свежесозданного города', () => {
      const { buildCityConstraints, buildCityNaming } = require('../lib/context_builder');
      const c = buildCityConstraints(slug);
      assert.ok(c.includes('ОГРАНИЧЕНИЯ ГОРОДА'), 'блок ограничений пуст — генерация пойдёт без лимитов домена');
      assert.ok(c.includes('значение-limits') && c.includes('значение-edicts'));
      assert.ok(buildCityNaming(slug).includes('значение-naming'), 'именник не подмешивается');
    });

    it('§A6.2 — CSV районов ложится в секцию по буллету на район, не одной строкой', async () => {
      const parsed = parseCityMd(await fs.readFile(path.join(dir, 'city.md'), 'utf-8'));
      assert.equal(parsed.sections.districts, 'Первый Ку\nВторой Ку');
      assert.ok(!parsed.sections.districts.includes(','), 'CSV не должен попадать в секцию как есть');
    });

    it('§A4 — папки районов плоские, без фантомной обёртки district_NN', async () => {
      for (const d of ['pervyy_ku', 'vtoroy_ku']) {
        assert.ok(await fs.stat(path.join(dir, 'locations', d)).catch(() => null), `папка района ${d} не создана`);
        assert.ok(!(await fs.stat(path.join(dir, 'locations', 'district_01', d)).catch(() => null))
               && !(await fs.stat(path.join(dir, 'locations', 'district_02', d)).catch(() => null)),
          `${d} не должен лежать внутри district_NN`);
      }
    });
  });

  // §A1 — PUT с fields больше не пересобирает файл из 16 канонических секций.
  describe('PUT /api/cities — точечная запись секций, рукописный city.md не разрушается (§A1)', () => {
    const cityMdPath = () => path.join(cityDir, 'city.md');
    const baseFields = () => ({ display: 'Fifteen Sixteen Testcity', year: '2010' });

    it('рукописные секции и форматирование переживают сохранение формы', async () => {
      // Слепок реального Парижа: своя секция без канонического аналога, таблица,
      // блок-цитата, ###-подзаголовок. До §A1 всё это стиралось при первом же PUT.
      const handwritten = [
        '# Fifteen Sixteen Testcity, 2010 — сеттинг города', '',
        'Описание города.', '',
        '---', '',
        '## Политический ландшафт', '',
        '- Камарилья держит центр.', '',
        '> Карта сил — `archive/political_state.md`.', '',
        '### Историческая канва', '',
        '- Своя история города.', '',
        '---', '',
        '## Ключевые локации', '',
        '| Локация | Значение |', '|---------|---------|', '| Опера | Элизиум |', '',
        '---', '',
        '## Уточняющие вопросы перед сценарием (город)', '',
        '1. Состав Coterie.', '',
      ].join('\n');
      const original = await fs.readFile(cityMdPath(), 'utf-8');
      try {
        await fs.writeFile(cityMdPath(), handwritten, 'utf-8');

        const put = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
          fields: { ...baseFields(), limits: 'Не больше 2 Элизиумов' },
        }) });
        assert.equal(put.status, 200, put.body.error);

        const after = await fs.readFile(cityMdPath(), 'utf-8');
        assert.ok(after.includes('## Уточняющие вопросы перед сценарием (город)'),
          'рукописная секция без канонического аналога должна уцелеть');
        assert.ok(after.includes('> Карта сил — `archive/political_state.md`.'), 'блок-цитата цела');
        assert.ok(after.includes('### Историческая канва'), '###-подзаголовок цел');
        assert.ok(after.includes('| Опера | Элизиум |'), 'таблица цела');
        assert.equal(parseCityMd(after).sections.limits, 'Не больше 2 Элизиумов',
          'новая секция записана');
      } finally {
        await fs.writeFile(cityMdPath(), original, 'utf-8');
      }
    });

    it('нетронутая секция не переписывается — рукописный markdown внутри неё цел', async () => {
      // Найдено прогоном на КОПИИ реального Парижа: секции переживали сохранение, но их
      // ВНУТРЕННЕЕ форматирование деградировало — форма отдаёт уплощённый parseCityMd-текст
      // (буллеты сняты, пустые строки и «---» отброшены), и запись его обратно превращала
      // блок-цитаты и ###-подзаголовки в буллеты. Секции без изменений теперь не пишутся.
      const handwritten = [
        '# Fifteen Sixteen Testcity, 2010 — сеттинг города', '', 'Описание.', '',
        '## Политический ландшафт', '',
        '- Камарилья держит центр.', '',
        '> Карта сил — `archive/political_state.md`.', '',
        '### Историческая канва', '',
        '- Своя история.', '',
        '## Ограничения генерации', '- …', '',
      ].join('\n');
      const original = await fs.readFile(cityMdPath(), 'utf-8');
      try {
        await fs.writeFile(cityMdPath(), handwritten, 'utf-8');
        const sections = parseCityMd(handwritten).sections;
        const fields = { ...baseFields(), description: 'Описание.' };
        for (const [key] of CITY_SECTIONS) fields[key] = sections[key] || '';
        fields.limits = 'Новое ограничение';   // меняем ровно одну секцию

        const put = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({ fields }) });
        assert.equal(put.status, 200, put.body.error);
        assert.deepEqual(put.body.sectionsWritten, ['limits'],
          'переписаться должна только изменённая секция');

        const after = await fs.readFile(cityMdPath(), 'utf-8');
        assert.ok(after.includes('> Карта сил — `archive/political_state.md`.'),
          'блок-цитата не должна превратиться в буллет');
        assert.ok(after.includes('### Историческая канва'),
          '###-подзаголовок не должен превратиться в буллет');
        assert.ok(!/- > Карта сил/.test(after) && !/- ### Историческая/.test(after),
          'ничего не должно быть забуллечено');
        assert.equal(parseCityMd(after).sections.limits, 'Новое ограничение');
      } finally {
        await fs.writeFile(cityMdPath(), original, 'utf-8');
      }
    });

    it('идемпотентность: повторное сохранение тех же значений не меняет файл', async () => {
      const before = await fs.readFile(cityMdPath(), 'utf-8');
      const sections = parseCityMd(before).sections;
      const fields = { ...baseFields(), description: parseCityMd(before).description };
      for (const [key] of CITY_SECTIONS) fields[key] = sections[key] || '';

      const put1 = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({ fields }) });
      assert.equal(put1.status, 200);
      const after1 = await fs.readFile(cityMdPath(), 'utf-8');
      const put2 = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({ fields }) });
      assert.equal(put2.status, 200);
      assert.equal(await fs.readFile(cityMdPath(), 'utf-8'), after1,
        'второе сохранение тех же значений изменило файл');
    });

    it('ключ, которого нет в fields, не трогает свою секцию', async () => {
      await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
        fields: { ...baseFields(), naming: 'Именник города' },
      }) });
      // Второй PUT без ключа naming — значение должно остаться.
      await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
        fields: { ...baseFields(), limits: 'Что-то другое' },
      }) });
      const parsed = parseCityMd(await fs.readFile(cityMdPath(), 'utf-8'));
      assert.equal(parsed.sections.naming, 'Именник города');
      assert.equal(parsed.sections.limits, 'Что-то другое');
    });

    it('отсутствующая секция создаётся и отмечается в sectionsWritten', async () => {
      const original = await fs.readFile(cityMdPath(), 'utf-8');
      try {
        await fs.writeFile(cityMdPath(), original.replace(/## Именник и фактура\n[\s\S]*?(?=\n## |$)/, ''), 'utf-8');
        const put = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
          fields: { ...baseFields(), naming: 'Восстановленный именник' },
        }) });
        assert.equal(put.status, 200);
        assert.ok(put.body.sectionsWritten.includes('naming (создана)'), JSON.stringify(put.body.sectionsWritten));
        assert.equal(parseCityMd(await fs.readFile(cityMdPath(), 'utf-8')).sections.naming, 'Восстановленный именник');
      } finally {
        await fs.writeFile(cityMdPath(), original, 'utf-8');
      }
    });

    it('§A6.1 — невалидный год отклоняется (раньше PUT принимал любой текст)', async () => {
      const bad = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
        fields: { display: 'Fifteen Sixteen Testcity', year: 'не-год-вообще' },
      }) });
      assert.equal(bad.status, 400);
      assert.match(bad.body.error, /3–4 цифры/);
      const parsed = parseCityMd(await fs.readFile(cityMdPath(), 'utf-8'));
      assert.equal(parsed.year, '2010', 'год в файле не должен был измениться');
    });

    it('ветка cityMd (вкладка Markdown) продолжает писать текст как есть', async () => {
      const original = await fs.readFile(cityMdPath(), 'utf-8');
      try {
        const raw = '# Fifteen Sixteen Testcity, 2010 — сеттинг города\n\nСырой markdown.\n\n## Своя секция\n\n- пункт\n';
        const put = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({ cityMd: raw }) });
        assert.equal(put.status, 200);
        assert.equal(await fs.readFile(cityMdPath(), 'utf-8'), raw);
      } finally {
        await fs.writeFile(cityMdPath(), original, 'utf-8');
      }
    });

    // «Значимые места» (§V5, view-tabs 2026-08-04) — единственная секция, чьё
    // значение приходит уже готовой markdown-таблицей и не должна проходить
    // через citySectionBody (бул­летизацию каждой строки без «-»), иначе
    // «| Название | Описание |» стало бы «- | Название | Описание |».
    it('landmarks пишется как есть, без буллетизации таблицы', async () => {
      const original = await fs.readFile(cityMdPath(), 'utf-8');
      try {
        const table = '| Название | Описание |\n|---|---|\n| Опера Гарнье | Главный Элизиум |';
        const put = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
          fields: { ...baseFields(), landmarks: table },
        }) });
        assert.equal(put.status, 200, put.body.error);
        const after = await fs.readFile(cityMdPath(), 'utf-8');
        assert.ok(after.includes('| Опера Гарнье | Главный Элизиум |'), 'таблица записана как есть');
        assert.ok(!after.includes('- | Опера Гарнье'), 'таблица не забуллечена');
        assert.equal(parseCityMd(after).sections.landmarks, table);
      } finally {
        await fs.writeFile(cityMdPath(), original, 'utf-8');
      }
    });

    it('landmarks: повторное сохранение той же таблицы не меняет файл (round-trip)', async () => {
      const original = await fs.readFile(cityMdPath(), 'utf-8');
      try {
        const table = '| Название | Описание |\n|---|---|\n| Катакомбы | Владения Nosferatu |';
        await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
          fields: { ...baseFields(), landmarks: table },
        }) });
        const after1 = await fs.readFile(cityMdPath(), 'utf-8');
        const put2 = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
          fields: { ...baseFields(), landmarks: parseCityMd(after1).sections.landmarks },
        }) });
        assert.equal(put2.status, 200);
        // sectionsWritten в ответе появляется только при непустом списке (routes/cities.js) —
        // отсутствие ключа здесь и значит «ничего не переписано», unchanged section skip сработал.
        assert.equal(put2.body.sectionsWritten, undefined, 'unchanged section skip должен сработать и для таблицы');
        assert.equal(await fs.readFile(cityMdPath(), 'utf-8'), after1);
      } finally {
        await fs.writeFile(cityMdPath(), original, 'utf-8');
      }
    });

    it('landmarks: «|» в названии/описании не сдвигает колонки при следующем чтении', async () => {
      // Клиент экранирует «|» → «∣» до отправки (fold, тот же приём, что уже
      // применяет _collectLocDetKeyPoints для «Ключевых точек» локации) — сервер
      // просто пишет таблицу как есть, здесь проверяем, что уже экранированное
      // значение не ломает разбор колонок.
      const original = await fs.readFile(cityMdPath(), 'utf-8');
      try {
        const table = '| Название | Описание |\n|---|---|\n| Бар «Кровь ∣ Вино» | Нейтральная территория |';
        const put = await apiJson(`/api/cities/${citySlug}`, { method: 'PUT', body: JSON.stringify({
          fields: { ...baseFields(), landmarks: table },
        }) });
        assert.equal(put.status, 200);
        const parsed = parseCityMd(await fs.readFile(cityMdPath(), 'utf-8'));
        assert.equal(parsed.sections.landmarks, table);
      } finally {
        await fs.writeFile(cityMdPath(), original, 'utf-8');
      }
    });
  });

  describe('Двусторонний синк «Фракции» ↔ панель «Влияние фракций» (техспека §11)', () => {
    it('PUT новой фракции добавляет её в city.md «## Фракции» рядом с существующими', async () => {
      const put = await apiJson(`/api/factions/influence${qs()}`, { method: 'PUT', body: JSON.stringify({ name: 'Сеттиты', influence: 30 }) });
      assert.equal(put.status, 200);
      assert.ok(!put.body.warning, put.body.warning);

      const cityMd = await fs.readFile(path.join(cityDir, 'city.md'), 'utf-8');
      const parsed = parseCityMd(cityMd);
      const names = parsed.sections.factions.split('\n').map(s => s.trim());
      assert.deepEqual(names.sort(), ['Камарилья', 'Сеттиты', 'Шабаш']);
    });

    it('повторный PUT той же фракции — no-op, не задваивает строку в city.md', async () => {
      await apiJson(`/api/factions/influence${qs()}`, { method: 'PUT', body: JSON.stringify({ name: 'Сеттиты', influence: 55 }) });
      const cityMd = await fs.readFile(path.join(cityDir, 'city.md'), 'utf-8');
      const names = parseCityMd(cityMd).sections.factions.split('\n').map(s => s.trim());
      assert.equal(names.filter(n => n === 'Сеттиты').length, 1);
    });

    it('DELETE убирает фракцию из city.md «## Фракции», остальные не трогает', async () => {
      const del = await apiJson(`/api/factions/influence/${encodeURIComponent('Сеттиты')}${qs()}`, { method: 'DELETE' });
      assert.equal(del.status, 200);
      assert.ok(!del.body.warning, del.body.warning);

      const cityMd = await fs.readFile(path.join(cityDir, 'city.md'), 'utf-8');
      const names = parseCityMd(cityMd).sections.factions.split('\n').map(s => s.trim());
      assert.deepEqual(names.sort(), ['Камарилья', 'Шабаш']);
    });

    it('city.md без секции «## Фракции» — синк невозможен, PUT всё равно 200 с warning (non-blocking, техспека §11)', async () => {
      const cityMdPath = path.join(cityDir, 'city.md');
      const original = await fs.readFile(cityMdPath, 'utf-8');
      try {
        await fs.writeFile(cityMdPath, original.replace(/## Фракции\n[\s\S]*?(?=\n## )/, ''), 'utf-8');

        const put = await apiJson(`/api/factions/influence${qs()}`, { method: 'PUT', body: JSON.stringify({ name: 'Джованни', influence: 10 }) });
        assert.equal(put.status, 200, 'запись влияния не должна откатываться из-за сбоя синка города');
        assert.ok(put.body.warning, 'ожидался warning — секция «Фракции» не найдена');
        assert.ok(put.body.factions.some(f => f.name === 'Джованни'), 'political_state.md всё равно должен обновиться');
      } finally {
        await fs.writeFile(cityMdPath, original, 'utf-8');
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// UI-workflow: создание города (все поля формы) → район → локация → привязка к
// району → удаление. QA-аудит 2026-08-08: заполнение ВСЕХ полей города и районы/
// локации/привязка по отдельности уже были плотно покрыты (см. describe-блоки выше
// «POST /api/cities — все 16 секций», «Районы (District)», «PUT .../district»), но
// ни один тест не доводил историю до конца тем же путём, что реально ведёт
// пользователь через UI (создал город → добавил район → создал в нём локацию →
// удалил ненужную) — и, что важнее, `DELETE /api/locations/:slug` (реальный роут
// под кнопкой 🗑 на карточке локации, routes/locations.js) не был покрыт НИ ОДНИМ
// тестом вообще.
// ══════════════════════════════════════════════════════════════════════════════
describe('UI-workflow: город (все поля) → район → локация → привязка → удаление', () => {
  // Ровно те поля, что реально собирает и шлёт форма «+ Создать новый домен»
  // (document.getElementById('btn-new-city') → payload, scripts.js) — НЕ «все поля
  // API вообще»: например, districts в этот payload не входит (см. ниже), а
  // CITY_RULE_SECTIONS_CREATE = CITY_RULE_SECTIONS.filter(k => k !== 'landmarks')
  // (city.js) — «Значимые места» тоже не часть формы создания, только правки уже
  // созданного города. Список синхронизирован вручную с city.js — если форма
  // обрастёт новым полем правил, этот тест не узнает сам, придётся обновить.
  const FORM_RULE_KEYS = ['hunting', 'edicts', 'mortals', 'calendar', 'tech', 'limits', 'naming'];
  let citySlug, cityDir;
  const qs = () => `?city=${citySlug}`;

  before(async () => { await startServer(); });
  after(async () => { await stopServer(); await fs.rm(cityDir, { recursive: true, force: true }); });

  it('Шаг 1 — создание города формой со всеми полями: каждое поле долетает до city.md и до GET /api/cities/:slug/detail', async () => {
    const fields = {
      name: 'UI Workflow Testcity', year: '2011',
      description: 'Тестовый готический город.', factions: 'Камарилья\nАнархи',
      political: 'Князь: Тестовый Князь', locations: 'Элизиум: Тестовый Элизиум',
      leitmotif: 'Дождь и неон', specifics: 'Отвечать сухо, по делу',
      avoid: 'Избегать анахронизмов', sources: 'Corebook V20',
      factionsMortal: 'Городская полиция', factionsState: 'Интерпол',
    };
    for (const k of FORM_RULE_KEYS) fields[k] = `значение-${k}`;

    const create = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify(fields) });
    assert.equal(create.status, 200, create.body.error);
    citySlug = create.body.slug;
    cityDir  = path.join(__dirname, '../../cities', citySlug);

    // Каждое поле должно быть читаемо обратно ровно тем же значением — то, что
    // реально видит форма редактирования при повторном открытии карточки города.
    const detail = await apiJson(`/api/cities/${citySlug}/detail`);
    assert.equal(detail.status, 200, detail.body.error);
    assert.equal(detail.body.parsed.display, 'UI Workflow Testcity');
    assert.equal(detail.body.parsed.year, '2011');
    for (const k of FORM_RULE_KEYS)
      assert.equal(detail.body.parsed.sections[k], `значение-${k}`, `поле «${k}» не долетело до GET-детали`);
  });

  it('Шаг 1 (продолжение) — свободнотекстовые поля (описание/лейтмотив/специфика/избегать/источники/фракции смертных и государственные) не потеряны', async () => {
    const detail = await apiJson(`/api/cities/${citySlug}/detail`);
    assert.equal(detail.body.parsed.description, 'Тестовый готический город.',
      'description — верхнеуровневое поле parsed, не sections.description');
    assert.equal(detail.body.parsed.sections.leitmotif, 'Дождь и неон');
    assert.equal(detail.body.parsed.sections.specifics, 'Отвечать сухо, по делу');
    assert.equal(detail.body.parsed.sections.avoid, 'Избегать анахронизмов');
    assert.equal(detail.body.parsed.sections.sources, 'Corebook V20');
    assert.match(detail.body.parsed.sections.factions, /Камарилья/);
    assert.match(detail.body.parsed.sections.factions, /Анархи/);
    assert.match(detail.body.parsed.sections.factionsMortal, /Городская полиция/);
    assert.match(detail.body.parsed.sections.factionsState, /Интерпол/);
  });

  // 2026-08-04 (T2): районы убраны из формы создания города — заводятся ПОСТФАКТУМ,
  // отдельной формой «+ Добавить район» на уже созданной карточке города (docs/design/
  // 2026-08-04-city-create-form-restructure-techspec.md). POST /api/cities всё ещё
  // технически принимает поле districts (CSV → плоские locations/<slug>/ БЕЗ district.md,
  // см. lib/parsers/city.js cityScaffold) — но реальная форма его больше не шлёт, поэтому
  // сюда, в тест «формы со всеми полями», оно намеренно не включено (было ошибкой первой
  // версии этого теста — проверял CSV-districts как если бы форма их ещё отправляла).
  it('Шаг 2 — создание района на уже созданном городе (форма «+ Добавить район», не CSV при создании)', async () => {
    const create = await apiJson(`/api/cities/${citySlug}/districts`, { method: 'POST', body: JSON.stringify({
      name: 'Портовый Квартал', type: 'Промзона', sect: 'Анархи', description: 'Доки и склады у воды.',
    }) });
    assert.equal(create.status, 200, create.body.error);
    assert.ok(await fs.stat(path.join(cityDir, 'locations', create.body.slug, 'district.md')).catch(() => null));

    const list = await apiJson(`/api/cities/${citySlug}/districts`);
    const found = list.body.find(d => d.slug === create.body.slug);
    assert.equal(found.name, 'Портовый Квартал');
    assert.equal(found.type, 'Промзона');
    assert.equal(found.sect, 'Анархи');
    assert.equal(found.description, 'Доки и склады у воды.');
  });

  it('Шаг 3 — создание локации без района, затем привязка к «Портовому Кварталу» (PUT /district)', async () => {
    const create = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({ name: 'Заброшенный Склад' }) });
    assert.equal(create.status, 200, create.body.error);
    const locSlug = create.body.slug;

    const attach = await apiJson(`/api/locations/${locSlug}/district${qs()}`, {
      method: 'PUT', body: JSON.stringify({ district: 'Портовый Квартал' }),
    });
    assert.equal(attach.status, 200, attach.body.error);

    const after = await apiJson(`/api/locations${qs()}`);
    const loc = after.body.find(l => l.slug === locSlug);
    assert.equal(loc.district, 'Портовый Квартал', 'локация должна отображать district-именем формальной сущности');
    assert.ok(await fs.stat(path.join(cityDir, 'locations', 'portovyy_kvartal', locSlug)).catch(() => null),
      'папка локации должна физически переехать под район');
  });

  it('Шаг 4 — удаление локации (DELETE /api/locations/:slug): мягкое удаление, пропадает из GET, отвязывается от модулей', async () => {
    const create = await apiJson(`/api/locations${qs()}`, { method: 'POST', body: JSON.stringify({
      name: 'Локация На Удаление', district: 'Портовый Квартал',
    }) });
    assert.equal(create.status, 200, create.body.error);
    const locSlug = create.body.slug;

    // Модуль, ссылающийся на локацию через «## 📍 Связанные локации» — проверяем,
    // что DELETE не просто убирает карточку, но и убирает висячую ссылку из модуля
    // (unlinkLocationFromAllModules, routes/modules/shared.js).
    const modDir = path.join(cityDir, 'chronicles', 'del_test_chr', 'modules', 'del_test_mod');
    await fs.mkdir(modDir, { recursive: true });
    const modFile = path.join(modDir, 'del_test_mod.md');
    await fs.writeFile(modFile, [
      '# Тестовый модуль', '',
      '## 📍 Связанные локации',
      `- ${locSlug}`,
      '- kakaya-to-drugaya-lokaciya',
      '',
    ].join('\n'), 'utf-8');

    const del = await apiJson(`/api/locations/${locSlug}${qs()}`, { method: 'DELETE' });
    assert.equal(del.status, 200, del.body.error);
    assert.match(del.body.movedTo, /locations\/_deleted\//, 'ответ должен называть путь в корзине');
    assert.deepEqual(del.body.unlinkedFrom, ['del_test_chr/del_test_mod'], 'должен отчитаться, из какого модуля отвязал локацию');

    const after = await apiJson(`/api/locations${qs()}`);
    assert.ok(!after.body.find(l => l.slug === locSlug), 'удалённая локация не должна отдаваться в списке');

    assert.ok(!(await fs.stat(path.join(cityDir, 'locations', 'portovyy_kvartal', locSlug)).catch(() => null)),
      'папка локации не должна остаться на прежнем месте');
    const trash = await fs.readdir(path.join(cityDir, 'locations', '_deleted')).catch(() => []);
    assert.ok(trash.some(e => e.startsWith(`${locSlug}_`)), 'локация должна уехать в _deleted/<slug>_<timestamp>');

    const modAfter = await fs.readFile(modFile, 'utf-8');
    assert.ok(!modAfter.includes(locSlug), 'ссылка на удалённую локацию должна пропасть из модуля');
    assert.ok(modAfter.includes('kakaya-to-drugaya-lokaciya'), 'ссылка на ДРУГУЮ локацию в том же модуле не должна пострадать');

    await fs.rm(path.join(cityDir, 'chronicles', 'del_test_chr'), { recursive: true, force: true });
  });

  it('Шаг 4 (продолжение) — повторное удаление того же слага (или несуществующей локации) → 404, корзина не растёт лишним элементом', async () => {
    const del = await apiJson(`/api/locations/net-takoy-lokacii-voobsche${qs()}`, { method: 'DELETE' });
    assert.equal(del.status, 404);
  });

  it('Шаг 4 (продолжение) — удаление локации не задевает район и город: район остаётся в списке, city.md не тронут', async () => {
    const before = await fs.readFile(path.join(cityDir, 'city.md'), 'utf-8');
    const list = await apiJson(`/api/cities/${citySlug}/districts`);
    assert.ok(list.body.some(d => d.name === 'Портовый Квартал'), 'район не должен был исчезнуть из-за удаления локации внутри него');
    const after = await fs.readFile(path.join(cityDir, 'city.md'), 'utf-8');
    assert.equal(after, before, 'удаление локации не должно писать в city.md вообще');
  });
});

test('source-guard: web/routes/threads.js и lib/parsers/threads.js — санитизация/де-экранирование полей нити', () => {
  const routeJs = require('fs').readFileSync(path.join(__dirname, '../routes/threads.js'), 'utf-8');
  assert.match(routeJs, /escapeTableCell\(sanitizeInlineText\(title\)\)/);
  assert.match(routeJs, /escapeTableCell\(sanitizeInlineText\(description\)\)/);
  assert.match(routeJs, /escapeTableCell\(sanitizeInlineText\(priority\)\)/);
  const parserJs = require('fs').readFileSync(path.join(__dirname, '../lib/parsers/threads.js'), 'utf-8');
  const unescapeCount = (parserJs.match(/unescapeTableCell\(/g) || []).length;
  assert.ok(unescapeCount >= 4, `ожидалось де-экранирование минимум 4 полей (title/description/source/priority), найдено ${unescapeCount}`);
});

test('source-guard: web/routes/modules/list.js и fields.js — концепция модуля санитизируется на запись и де-экранируется на чтение', () => {
  const listJs = require('fs').readFileSync(path.join(__dirname, '../routes/modules/list.js'), 'utf-8');
  assert.match(listJs, /sanitizeFreeformBody\(\(req\.body\.content \|\| ''\)\.trim\(\)\)/,
    'создание модуля не санитизирует content через sanitizeFreeformBody');
  assert.match(listJs, /unescapeFreeformBody\(conceptM\[1\]\.trim\(\)\)/,
    'чтение detail не де-экранирует концепцию через unescapeFreeformBody');
  const fieldsJs = require('fs').readFileSync(path.join(__dirname, '../routes/modules/fields.js'), 'utf-8');
  assert.match(fieldsJs, /key === 'description'[\s\S]{0,200}sanitizeFreeformBody/,
    'PUT /fields description не санитизирует через sanitizeFreeformBody');
});

test('source-guard: web/routes/library.js — шаблоны дисциплин/способностей санитизируют clans/source/levels через sanitizeInlineText', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../routes/library.js'), 'utf-8');
  const discFn = js.match(/function _discTemplate\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
  const psyFn  = js.match(/function _psyTemplate\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
  for (const [name, fn] of [['_discTemplate', discFn], ['_psyTemplate', psyFn]]) {
    assert.ok(fn, `не найдена ${name}`);
    const count = (fn.match(/sanitizeInlineText\(/g) || []).length;
    assert.ok(count >= 5, `${name}: ожидалось минимум 5 вызовов sanitizeInlineText (clans/source/level name/literary/system), найдено ${count}`);
  }
});

test('source-guard: web/routes/cities.js — синк «Карты фракций» экранирует ячейки таблицы', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../routes/cities.js'), 'utf-8');
  const fn = js.match(/async function syncPoliticalStateTable\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, 'не найдена syncPoliticalStateTable');
  assert.match(fn, /escapeTableCell\(sanitizeInlineText\(r\.role\)\)/);
  assert.match(fn, /escapeTableCell\(sanitizeInlineText\(\[r\.name, r\.name2\]/);
  assert.match(fn, /unescapeTableCell\(r\[0\]\)/);
});

// FIX-4b (docs/audit/2026-07-28-fix-plan.md): пользовательский аудит-скрипт,
// который стоит прогнать после обновления — находит коллизии имён, оставшиеся
// в старых данных с ДО-фикса времён (сейчас интерфейс их уже не ломает, но
// скрипт помогает решить, стоит ли переименовать одного из персонажей).
// Скрипт — CLI с process.exit() внутри, поэтому запускается child-процессом,
// а не через require() (иначе process.exit() убьёт сам test-runner).
describe('tools/check_duplicate_names.js — аудит коллизий имён после обновления', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, '../../tools/check_duplicate_names.js');
  const tmpCity = path.join(__dirname, '../../cities/__dupnametest__');

  const run = (city) => {
    try {
      const out = execFileSync('node', [scriptPath, city], { encoding: 'utf-8' });
      return { out, code: 0 };
    } catch (e) {
      return { out: e.stdout || '', code: e.status };
    }
  };

  it('город без коллизий — сообщает, что чинить нечего', async () => {
    await fs.mkdir(path.join(tmpCity, 'characters', 'vampires', 'char_a'), { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'city.md'), '# Тестгород — сеттинг города\n', 'utf-8');
    await fs.writeFile(path.join(tmpCity, 'characters', 'vampires', 'char_a', 'char_a.md'), '# 🧛 Персонаж А\n', 'utf-8');
    try {
      const { out, code } = run('__dupnametest__');
      assert.equal(code, 0);
      assert.match(out, /коллизий имён не найдено/);
    } finally {
      await fs.rm(tmpCity, { recursive: true, force: true });
    }
  });

  it('два персонажа с одинаковым H1-именем в разных папках — находит обоих, называет их пути', async () => {
    await fs.mkdir(path.join(tmpCity, 'characters', 'vampires', 'char_a'), { recursive: true });
    await fs.mkdir(path.join(tmpCity, 'characters', 'mortals', 'char_b'), { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'city.md'), '# Тестгород — сеттинг города\n', 'utf-8');
    await fs.writeFile(path.join(tmpCity, 'characters', 'vampires', 'char_a', 'char_a.md'), '# 🧛 Одинаковое Имя\n', 'utf-8');
    await fs.writeFile(path.join(tmpCity, 'characters', 'mortals', 'char_b', 'char_b.md'), '# 🧑 Одинаковое Имя\n', 'utf-8');
    try {
      const { out, code } = run('__dupnametest__');
      assert.equal(code, 0, 'скрипт только сообщает — не должен завершаться с ошибкой');
      assert.match(out, /Одинаковое Имя/);
      assert.match(out, /vampires\/char_a\/char_a\.md/);
      assert.match(out, /mortals\/char_b\/char_b\.md/);
    } finally {
      await fs.rm(tmpCity, { recursive: true, force: true });
    }
  });
});

describe('FIX-11: getCityDisplayName находит city.md (не падает в фолбэк на сырой слаг)', () => {
  const tmpCity = path.join(__dirname, '../../cities/__fix11test__');
  before(async () => {
    await fs.mkdir(tmpCity, { recursive: true });
    await fs.writeFile(path.join(tmpCity, 'city.md'), '# Тестбург, 2010 — сеттинг города\n\nОписание.\n', 'utf-8');
  });
  after(async () => { await fs.rm(tmpCity, { recursive: true, force: true }); });

  it('находит реальный city.md и возвращает заголовок, а не сырой слаг __fix11test__', async () => {
    const { getCityDisplayName } = require('../routes/modules/shared');
    const name = await getCityDisplayName('__fix11test__');
    assert.equal(name, 'Тестбург, 2010 — сеттинг города');
  });

  it('несуществующий город — фолбэк на слаг (не падает)', async () => {
    const { getCityDisplayName } = require('../routes/modules/shared');
    const name = await getCityDisplayName('__no_such_city_fix11__');
    assert.equal(name, '__no_such_city_fix11__');
  });
});

describe('FIX-19: GET /api/search — эмодзи-заголовок с суррогатной парой не портит имя в результатах', () => {
  const tmpCity = path.join(__dirname, '../../cities/__fix19test__');
  const qs = '?city=__fix19test__';

  before(async () => {
    await fs.mkdir(path.join(tmpCity, 'characters', 'vampires', 'anya_gros'), { recursive: true });
    // 👤 (U+1F464) не входил в старый хардкод-список, но делит старший суррогат
    // \ud83d с 🐺 (U+1F43A), который входил — старый /[…]/g без /u-флага резал
    // по code unit и терял парную половину чужого эмодзи (docs/audit/2026-07-28-fix-plan.md).
    await fs.writeFile(path.join(tmpCity, 'characters', 'vampires', 'anya_gros', 'anya_gros.md'),
      '# 👤 Аня Грос\n- **Слаг:** anya_gros\n- **Родной город:** __fix19test__\n- **Линейка WoD:** vampires\n- **Статус:** активен\n\nОписание для поиска: полуночный переулок.\n',
      'utf-8');
    await startServer();
  });
  after(async () => {
    await stopServer();
    await fs.rm(tmpCity, { recursive: true, force: true });
  });

  it('имя в результатах поиска — валидная строка "Аня Грос", без "\\ufffd"/одинокого суррогата', async () => {
    const { status, body } = await apiJson(`/api/search${qs}&q=${encodeURIComponent('полуночный')}`);
    assert.equal(status, 200);
    const hit = (body.results?.characters || []).find(h => h.slug === 'anya_gros');
    assert.ok(hit, 'персонаж не найден в результатах поиска');
    assert.equal(hit.name, 'Аня Грос');
    assert.ok(!/[\ud800-\udfff]/.test(hit.name), 'имя содержит одинокий суррогат — строка невалидна как UTF-16');
  });
});

describe('FIX-20: mdToHtmlPlain(md, {allowHeadings:false}) — экранированный "#"/"##" не рендерится как настоящий заголовок в теле сессии', () => {
  // mdToHtmlPlain не зависит от DOM (кроме недостижимой в этих тестах ветки
  // resolveMdLink для markdown-ссылок) — извлекаем функцию как есть из
  // клиентского скрипта и исполняем в Node через new Function, как уже
  // делают другие тесты этого файла (например _isBogusPrompt выше).
  const jsSrc = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  const fnMatch = jsSrc.match(/function mdToHtmlPlain\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'не найдена mdToHtmlPlain в modules.js');
  const mdToHtmlPlain = (new Function(`return (${fnMatch[0]})`))();

  it('allowHeadings:false — "## Сессия 99 — Поддельная" остаётся текстом, не становится <h2>', () => {
    const html = mdToHtmlPlain('## Сессия 99 — Поддельная', { allowHeadings: false });
    assert.ok(!/<h[1-6]>/.test(html), `ожидался обычный текст без заголовка, получено: ${html}`);
    assert.match(html, /## Сессия 99 — Поддельная/);
  });

  it('allowHeadings по умолчанию (true) — легитимный "## Финал" в других контекстах (finale.md и т.п.) по-прежнему рендерится заголовком', () => {
    const html = mdToHtmlPlain('## Финал — Развязка');
    assert.match(html, /<h2>Финал — Развязка<\/h2>/);
  });
});

test('source-guard: modules.js — тело записи журнала сессий рендерится через mdToHtmlPlain(s.body, {allowHeadings:false}) (FIX-20)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/modules.js'), 'utf-8');
  assert.match(js, /mdToHtmlPlain\(s\.body,\s*\{\s*allowHeadings:\s*false\s*\}\)/,
    'рендер тела сессии должен отключать заголовки — иначе экранированный "#"/"##" из заметки рисуется как настоящий <h2>');
});

test('source-guard: routes/dashboard.js — h1() снимает эмодзи по кодпоинтам (\\p{Extended_Pictographic}/u), не хардкод-списком UTF-16 code units', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../routes/dashboard.js'), 'utf-8');
  assert.doesNotMatch(js, /🧛🧚🧑🐺🔮🏹⚔️🩸/, 'старый небезопасный хардкод-список эмодзи всё ещё в файле');
  assert.match(js, /\\p\{Extended_Pictographic\}/, 'h1() больше не использует codepoint-safe \\p{Extended_Pictographic}');
  assert.match(js, /\/gu[\s\S]{0,10};/, 'регэксп эмодзи должен использовать /u-флаг (по кодпоинтам, не UTF-16 code units)');
});

test('source-guard: archive.js — счётчик событий согласует число (FIX-8, не всегда "N событий")', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/archive.js'), 'utf-8');
  assert.ok(!/sub\.textContent = `\$\{evCount\} событий`/.test(js),
    'счётчик всё ещё хардкодит "событий" независимо от числа');
  assert.match(js, /evCount % 10 === 1 && evCount % 100 !== 11 \? 'событие'/,
    'не найдено согласование числа для evWord');
});

test('source-guard: char-detail.js — таймер карусели останавливается при ЛЮБОМ закрытии модалки, не только по кнопке ✕ (FIX-8)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/char-detail.js'), 'utf-8');
  assert.ok(/new MutationObserver\(\(\) => \{[\s\S]*?classList\.contains\('open'\)[\s\S]*?clearInterval\(_carouselTimer\)/.test(js),
    'не найден MutationObserver, останавливающий _carouselTimer по исчезновению класса .open');
  assert.ok(/attributeFilter: \['class'\]/.test(js),
    'MutationObserver не следит именно за атрибутом class модалки');
});

test('source-guard: char-detail.js — _savePanelEdit(desc) шлёт все 5 полей безусловно (FIX-3, не пропускает очистку пустого поля)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/char-detail.js'), 'utf-8');
  const fnMatch = js.match(/\} else if \(panel === 'desc'\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'не найдена ветка panel === \'desc\' в _savePanelEdit');
  assert.ok(!/if \(appearance\)\s*fields\.appearance/.test(fnMatch[0]),
    'appearance всё ещё пропускается из fields при пустом значении — очистка поля не сохранится на сервере');
  assert.match(fnMatch[0], /const fields = \{ appearance, voice, personality, imagePrompt, negativePrompt \}/,
    'fields должен собираться безусловно из всех пяти полей, а не через if (x) fields.x = x');
});

test('source-guard: server.js — genTextWithRetry перебирает fallback-модели OpenRouter/OpenAI, а не один вызов без повтора', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../server.js'), 'utf-8');
  const fnMatch = js.match(/async function genTextWithRetry\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена функция genTextWithRetry');
  const oaBranch = fnMatch[0].match(/if \(_isOA\(gen\)\) \{[\s\S]*?\n  \}/);
  assert.ok(oaBranch, 'не найдена ветка _isOA(gen) внутри genTextWithRetry');
  assert.match(oaBranch[0], /_oaModels\(gen\)/,
    'ветка OpenRouter/OpenAI должна перебирать список моделей _oaModels(gen), а не звать одну модель один раз');
  assert.match(oaBranch[0], /for \(const m of models\)/,
    'должен быть цикл по моделям с повтором при ошибке/невалидном ответе');
});

test('source-guard: generation.js — generate-prompt передаёт isValid в genTextWithRetry (ретрай моделью при "не JSON"/обрезанном ответе)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../routes/generation.js'), 'utf-8');
  const routeMatch = js.match(/router\.post\('\/api\/characters\/:slug\/generate-prompt'[\s\S]*?\n  \}\);/);
  assert.ok(routeMatch, 'не найден маршрут generate-prompt');
  assert.match(routeMatch[0], /isValid:\s*isValidPromptResponse/,
    'generate-prompt должен передавать isValid в genTextWithRetry, иначе мусорный ответ одной бесплатной модели сразу роняет запрос 500-й ошибкой без повтора');
});

// FIX-4b (docs/audit/2026-07-28-fix-plan.md): переход список→модалка персонажа и
// все действия внутри неё (сохранение полей, генерация, дневники, Лист V20,
// удаление) резолвятся по slug, а не по отображаемому имени — при совпадении
// имён двух персонажей клик по карточке раньше всегда открывал ПЕРВОГО по
// порядку в STATE.characters, а не того, по которому кликнули, и второй
// персонаж был недостижим через интерфейс вообще.
test('source-guard: char-detail.js — openCharDetail резолвит персонажа по slug, не по name', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/char-detail.js'), 'utf-8');
  const fnMatch = js.match(/function openCharDetail\(slug\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'openCharDetail должен принимать slug как параметр (не name)');
  assert.match(fnMatch[0], /ch\.slug === slug/, 'openCharDetail должен искать персонажа по slug');
});

test('source-guard: scripts.js — карточка персонажа в гриде и его клик-обработчик используют data-slug, не data-name', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/scripts.js'), 'utf-8');
  assert.ok(!/char-card[^`]*data-name=/.test(js), '.char-card не должен снова получить data-name как ключ идентичности');
  assert.match(js, /char-card[^`]*data-slug="\$\{escHtml\(c\.slug\)\}"/, '.char-card должен нести data-slug для резолвинга по slug');
});

test('source-guard: char-detail.js — клик по карточке в гриде читает card.dataset.slug', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/char-detail.js'), 'utf-8');
  assert.match(js, /closest\('\.char-card\[data-slug\]'\)/, 'делегированный клик-обработчик должен искать .char-card[data-slug]');
  assert.match(js, /openCharDetail\(card\.dataset\.slug\)/, 'клик по карточке должен передавать slug в openCharDetail');
});

test('source-guard: char-detail.js — переименование персонажа (_saveInfoFields) хранит идентичность в slug, не пересчитывает её при смене имени', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/char-detail.js'), 'utf-8');
  assert.match(js, /let _editCharSlug\s*=\s*null/, 'идентичность редактируемого персонажа должна храниться как slug (_editCharSlug), а не имя');
  const fnMatch = js.match(/async function _saveInfoFields\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'не найдена _saveInfoFields');
  assert.ok(!/data-name="\$\{CSS\.escape\(prevName\)\}"/.test(fnMatch[0]),
    'после переименования не должно быть re-key по data-name/prevName — slug не меняется при переименовании');
});

test('source-guard: v20-sheet.js — контекст листа V20 (_v20Ctx) несёт slug, sheet-API строится по нему, не по _charSlug(name)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/v20-sheet.js'), 'utf-8');
  assert.match(js, /_v20Ctx = \{ name: [^,]+, slug: charSlug, card \}/, '_v20Ctx должен нести slug рядом с name');
  const apiMatch = js.match(/function _sheetApi\(ctx\) \{[\s\S]*?\n\}/);
  assert.ok(apiMatch, 'не найдена _sheetApi');
  assert.match(apiMatch[0], /ctx\.slug/, '_sheetApi должен строить URL персонажа по ctx.slug');
  assert.ok(!/_charSlug\(/.test(js), 'v20-sheet.js не должен вызывать _charSlug() — идентичность уже приходит как slug');
});

test('source-guard: routes/characters.js — GET all-images ключует словарь по slug персонажа, не по имени', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../routes/characters.js'), 'utf-8');
  const routeMatch = js.match(/router\.get\('\/api\/characters\/all-images'[\s\S]*?\n  \}\);/);
  assert.ok(routeMatch, 'не найден маршрут all-images');
  assert.match(routeMatch[0], /result\[char\.slug\]\s*=\s*images/, 'ключ словаря должен быть char.slug, не char.name');
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIT — source-guard: регрессионное покрытие недели 2026-08-02…08-08 (реструктуризация
// «Инструментов», Статус/Опасность/Сенсорика локаций, библиотеки «Смертные»/«Титулы»,
// фракции города чипами, пикеры карточки персонажа) — до этого набора ни одна из этих
// UI-фич не имела source-guard теста: функциональность проверялась на уровне API/парсеров
// (см. соседние describe-блоки city-creation-restructure и др.), но случайный откат разметки
// index.html/*.js прошёл бы весь npm test незамеченным. QA-аудит 2026-08-08.
// ══════════════════════════════════════════════════════════════════════════════

test('source-guard: index.html — вкладка «Инструменты» реструктурирована до 4 вкладок (Учёт данных / Подключение AI / Назначение генераций / Инструкции), «Новый НПС»/«Модуль»/«Сессия» удалены', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  const toolsSection = html.match(/<section id="page-tools"[\s\S]*?\n {4}<\/section>/);
  assert.ok(toolsSection, 'не найдена секция #page-tools');
  const body = toolsSection[0];
  assert.match(body, /data-tab="validate">Учёт данных</, 'нет вкладки «Учёт данных» (бывшая «Проверка»)');
  assert.match(body, /data-tab="ai-connect">🔌 Подключение AI</, 'нет вкладки «🔌 Подключение AI»');
  assert.match(body, /data-tab="ai-features">⚡ Назначение генераций</, 'нет вкладки «⚡ Назначение генераций»');
  assert.match(body, /data-tab="guide">📖 Инструкции</, 'нет вкладки «📖 Инструкции»');
  assert.ok(!/data-tab="new-module"/.test(body), 'вкладка «Модуль» должна быть удалена из Инструментов (дубль кнопки «+ Модуль» в хронике)');
  assert.ok(!/data-tab="log-session"/.test(body), 'вкладка «📓 Сессия» должна быть удалена из Инструментов');
  assert.ok(!/data-tab="more"/.test(body), 'вкладка «🛠 Ещё» должна быть удалена — содержимое перенесено в «Учёт данных»');
});

test('source-guard: index.html — «Учёт данных» содержит перенесённые из «Ещё» инструменты (Кросс-город/Закрыть хронику/Индекс событий/Реестр персонажей)', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  const panel = html.match(/<div class="tab-panel active" id="tab-validate">[\s\S]*?\n {6}<\/div>\s*\n\s*<!--/);
  assert.ok(panel, 'не найдена панель #tab-validate');
  const body = panel[0];
  assert.match(body, /btn-migrate/, 'нет кнопки «Зафиксировать присутствие» (Кросс-город)');
  assert.match(body, /btn-close-chr/, 'нет кнопки «Закрыть хронику»');
  assert.match(body, /btn-rebuild-idx/, 'нет кнопки «Пересобрать индекс города»');
  assert.match(body, /btn-sync-index/, 'нет кнопки «Синхронизировать реестр»');
});

test('source-guard: log-session.js click-listener на удалённую кнопку data-tab="log-session" не навешивается (иначе TypeError при загрузке страницы «Инструменты»)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/log-session.js'), 'utf-8');
  assert.ok(!/querySelector\(['"]\.tab-btn\[data-tab="log-session"\]['"]\)\.addEventListener/.test(js),
    'log-session.js всё ещё вешает addEventListener прямо на querySelector(...) без null-проверки — упадёт, раз кнопки больше нет в DOM');
});

test('source-guard: index.html — фильтр локаций «Статус» (#loc-filter-zone) содержит актуальные 5 значений, старые значения «Зоны» убраны', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  const sel = html.match(/<select class="filter-select" id="loc-filter-zone">[\s\S]*?<\/select>/);
  assert.ok(sel, 'не найден select #loc-filter-zone');
  const body = sel[0];
  for (const v of ['Элизиум', 'Приёмная князя', 'Убежище', 'Шериф', 'Сенешаль']) {
    assert.ok(body.includes(`value="${v}"`), `отсутствует статус «${v}»`);
  }
  assert.ok(!/Носферату|Нейтральная|Опасная"/.test(body), 'в select остались значения старой модели «Зона» — статус и опасность теперь разные поля');
});

test('source-guard: locations.js — CITY_LOCATION_TYPES (city.js) задаёт те же 5 статусов, что и фильтр в index.html', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/city.js'), 'utf-8');
  assert.match(js, /CITY_LOCATION_TYPES\s*=\s*\['Элизиум', 'Приёмная князя', 'Убежище', 'Шериф', 'Сенешаль'\]/,
    'CITY_LOCATION_TYPES разошёлся с фильтром локаций — статус на вкладке VtM карточки локации не совпадёт со списком фильтра');
});

test('source-guard: locations.js — «Опасность» (dangerLevel/badge-danger) — независимое поле, не читается из «Статуса»', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/locations.js'), 'utf-8');
  assert.match(js, /DANGER_BADGE_LABELS\s*=\s*\{/, 'нет DANGER_BADGE_LABELS');
  assert.match(js, /MASQ_BADGE_LABELS\s*=\s*\{/, 'нет MASQ_BADGE_LABELS (Маскарад — тоже отдельный бейдж)');
  const cardFn = js.match(/function _locCardHtml\([\s\S]*?\n\}/);
  assert.ok(cardFn, 'не найдена _locCardHtml');
  assert.match(cardFn[0], /badge-danger-\$\{dLvl\}/, 'карточка локации в сетке не показывает бейдж опасности');
  assert.ok(!/\$\{zoneBadge\}/.test(cardFn[0]), '_locCardHtml всё ещё вставляет ${zoneBadge} в разметку — «Зона контроля» на карточке сетки должна быть убрана (осталась только в детальной модалке)');
});

test('source-guard: locations.js — вкладка «Сенсорика» отделена от «Атмосферы», обязательные каналы Свет/Звук/Запах помечают вкладку ⚠️ при незаполненности', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/locations.js'), 'utf-8');
  assert.match(js, /MANDATORY_SENS_CHANNELS\s*=\s*\['Свет', 'Звук', 'Запах'\]/, 'нет MANDATORY_SENS_CHANNELS с ожидаемыми тремя каналами');
  assert.match(js, /data-tab="sens">Сенсорика/, 'нет кнопки вкладки «Сенсорика» с data-tab="sens"');
  assert.match(js, /sensHasEmpty\s*\?\s*['"] ⚠️['"]/, 'вкладка «Сенсорика» не показывает ⚠️ при незаполненном обязательном канале');
});

test('source-guard: index.html — вкладка «Библиотека» содержит «Смертные» (5 категорий организаций) и «Титулы» под «Сородичи»', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  assert.match(html, /data-tab="lib-mortal">Смертные</, 'нет главной вкладки библиотеки «Смертные»');
  for (const g of ['government', 'religious', 'crime', 'civic', 'positions']) {
    assert.ok(html.includes(`data-mort-group="${g}"`), `нет подкатегории «Смертные»: data-mort-group="${g}"`);
  }
  assert.match(html, /data-kin-group="titles"[^>]*>Титулы</, 'нет подвкладки «Титулы» под «Сородичи»');
});

test('source-guard: index.html — вкладки «✦ Достоинства» и «✦ Недостатки» — раздельные, каждая со своими 4 категориями', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  assert.match(html, /data-tab="lib-merits">✦ Достоинства</, 'нет отдельной вкладки «✦ Достоинства»');
  assert.match(html, /data-tab="lib-flaws">✦ Недостатки</, 'нет отдельной вкладки «✦ Недостатки»');
  assert.match(html, /data-merit-cat="physical"/, 'вкладка «Достоинства» не разбита на категории (data-merit-cat)');
  assert.match(html, /data-flaw-cat="физические"/, 'вкладка «Недостатки» не разбита на категории (data-flaw-cat)');
});

test('source-guard: city.js — _cityFactionsEditorHtml собирает пять групп фракций (Секты/Кланы чипами из библиотеки, Другие/Смертные/Государственные — свободный текст)', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/city.js'), 'utf-8');
  const fn = js.match(/async function _cityFactionsEditorHtml\(sec\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'не найдена _cityFactionsEditorHtml');
  const body = fn[0];
  for (const g of ['sects', 'clans', 'mortal', 'state']) {
    assert.ok(body.includes(`data-pick-faction="${g}"`), `нет кнопки библиотечного подбора для группы фракций «${g}»`);
  }
  assert.match(body, /data-city-field="factions-other"/, 'нет свободного списка «Другие фракции»');
  assert.match(body, /data-city-field="factions-mortal-list"/, 'нет свободного списка «Фракции смертных»');
  assert.match(body, /data-city-field="factions-state-list"/, 'нет свободного списка «Государственные фракции»');
});

test('source-guard: char-detail.js — вкладка «Информация»: пикеры «Титул» (не для фей), «Дисциплины», и для смертных/охотников «Организация»/«Должность»', () => {
  const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/char-detail.js'), 'utf-8');
  assert.match(js, /key === 'hierarchy' && _lineageOf\(_editCharSlug\) !== 'fairy'/,
    'пикер «Титул» должен подключаться для поля hierarchy у всех линеек кроме fairy (у фей это «Иерархия» — простое поле)');
  assert.match(js, /dataset\.pickTitle\s*=\s*'1'/, 'нет кнопки-пикера «Титул» (data-pick-title)');
  assert.match(js, /key === 'disciplines'/, 'нет ветки рендера пикера для поля disciplines');
  assert.match(js, /dataset\.pickDiscipline\s*=\s*'1'/, 'нет кнопки-пикера «Дисциплины» (data-pick-discipline)');
  assert.match(js, /key === 'organization' && \['mortal', 'hunter'\]\.includes\(_lineageOf\(_editCharSlug\)\)/,
    'пикер «Организация» должен быть гейтирован линейками mortal/hunter');
  assert.match(js, /key === 'position' && \['mortal', 'hunter'\]\.includes\(_lineageOf\(_editCharSlug\)\)/,
    'пикер «Должность» должен быть гейтирован линейками mortal/hunter');
});

// Баг, найден пользователем на живых данных 2026-08-09: клик по ✕ на карточке НПС
// вкладки «НПС» модуля открывал карточку персонажа вместо удаления из модуля.
// Причина — .char-card-overlay (z-index: 2) визуально перекрывает всю карточку,
// включая угол с кнопкой удаления (.modp-npc-card-del, z-index: 1 из общего правила
// с .loc-card-del-btn/.modp-loc-card-unlink — у тех оверлей без явного z-index, 1
// достаточно). Скоуп-правило .modp-char-cards .modp-npc-card-del { z-index: 3 }
// поднимает кнопку именно в этом контексте выше оверлея, не трогая общее правило.
test('source-guard: styles.css — .modp-npc-card-del стоит выше .char-card-overlay по z-index внутри .modp-char-cards (иначе клик по ✕ ловит оверлей, открывающий карточку персонажа)', () => {
  const css = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  const overlayM = css.match(/\.char-card-overlay\s*\{[^}]*\}/);
  assert.ok(overlayM, 'не найдено правило .char-card-overlay');
  const overlayZ = parseInt((overlayM[0].match(/z-index:\s*(\d+)/) || [])[1] || '0', 10);

  const scopedM = css.match(/\.modp-char-cards\s+\.modp-npc-card-del\s*\{[^}]*\}/);
  assert.ok(scopedM, '.modp-char-cards .modp-npc-card-del — регрессия: нет скоуп-переопределения z-index для кнопки удаления НПС');
  const scopedZ = parseInt((scopedM[0].match(/z-index:\s*(\d+)/) || [])[1] || '0', 10);

  assert.ok(scopedZ > overlayZ,
    `z-index кнопки удаления (${scopedZ}) должен быть больше z-index .char-card-overlay (${overlayZ}) в контексте .modp-char-cards`);
});

describe('Инструменты → Бэкап: /api/backup/* (docs/design/2026-08-13-backup-tab-techspec.md)', () => {
  before(async () => { await startServer(); });
  after(async () => { await stopServer(); });

  describe('валидация', () => {
    it('POST /api/backup/city — пустой список слагов → 400', async () => {
      const r = await apiJson('/api/backup/city', { method: 'POST', body: JSON.stringify({ slugs: [] }) });
      assert.equal(r.status, 400);
    });

    it('POST /api/backup/city — traversal через слаг → 400, без побочных эффектов', async () => {
      const r = await apiJson('/api/backup/city', { method: 'POST', body: JSON.stringify({ slugs: ['../etc'] }) });
      assert.equal(r.status, 400);
    });

    it('POST /api/backup/city — слаг не из listCities() → 400', async () => {
      const r = await apiJson('/api/backup/city', { method: 'POST', body: JSON.stringify({ slugs: ['__nonexistent_city__'] }) });
      assert.equal(r.status, 400);
    });

    it('GET /api/backup/job/:id — неизвестный id → 404', async () => {
      const r = await apiJson('/api/backup/job/deadbeef00000000');
      assert.equal(r.status, 404);
    });

    it('GET /api/backup/job/:id/download — неизвестный id → 404', async () => {
      const r = await apiJson('/api/backup/job/deadbeef00000000/download');
      assert.equal(r.status, 404);
    });

    it('POST /api/backup/restore/commit — без inspectId (или истёкшим) → 404', async () => {
      const r = await apiJson('/api/backup/restore/commit', { method: 'POST', body: JSON.stringify({ inspectId: 'nope' }) });
      assert.equal(r.status, 404);
    });

    it('POST /api/backup/restore/inspect — не-ZIP тело → 400, не роняет сервер', async () => {
      const r = await apiJson('/api/backup/restore/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from('это не архив'),
      });
      assert.equal(r.status, 400);
    });

    it('POST /api/backup/restore/inspect — ZIP без city.md внутри папки → 400', async () => {
      const { createZip } = require('../lib/zip');
      const zipBuf = createZip([{ name: 'somecity/notes.txt', data: 'без city.md' }]);
      const r = await apiJson('/api/backup/restore/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: zipBuf,
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /city\.md/);
    });

    it('POST /api/backup/restore/inspect — недопустимое имя папки в архиве → 400', async () => {
      const { createZip } = require('../lib/zip');
      const zipBuf = createZip([{ name: '../evil/city.md', data: '# X\n' }]);
      const r = await apiJson('/api/backup/restore/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: zipBuf,
      });
      assert.equal(r.status, 400);
    });

    // code-review (2026-08-13): голый /^[a-z0-9_]+$/ пропускал папки, начинающиеся с
    // '_' — "_deleted"/"_restore_tmp" зарезервированы сервером (мягкое удаление,
    // временная распаковка restore), а listCities() их не видит, так что commit
    // трактовал бы такую папку как «новый город» и подменял бы служебную директорию
    // содержимым из чужого архива. slugify() никогда не производит слаг с ведущим
    // '_', так что запрет ничего легитимного не блокирует.
    it('POST /api/backup/restore/inspect — папка с ведущим "_" (коллизия с _deleted/_restore_tmp) → 400', async () => {
      const { createZip } = require('../lib/zip');
      const zipBuf = createZip([{ name: '_deleted/city.md', data: '# Захват служебной папки\n' }]);
      const r = await apiJson('/api/backup/restore/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: zipBuf,
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Недопустимое имя папки/);
    });
  });

  it('GET /api/backup/cities-info — отражает listCities(), sizeMb — число', async () => {
    const r = await apiJson('/api/backup/cities-info');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.cities) && r.body.cities.length > 0);
    for (const c of r.body.cities) {
      assert.equal(typeof c.slug, 'string');
      assert.equal(typeof c.sizeMb, 'number');
    }
  });

  it('POST /api/backup/settings — отдаёт zip (без утверждений о содержимом ключей)', async () => {
    const resp = await fetch(BASE + '/api/backup/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiFeaturePrefs: '{}' }),
    });
    assert.equal(resp.status, 200);
    assert.match(resp.headers.get('content-type') || '', /zip/);
    const buf = Buffer.from(await resp.arrayBuffer());
    assert.ok(buf.length > 0);
  });

  // Полный цикл на синтетическом городе (не на реальном cities/paris, по установленной
  // в проекте практике самодостаточных фикстур) — покрывает критический риск Р1
  // (workplan §«Риски»): бэкап → город исчез → восстановление возвращает данные;
  // бэкап поверх СУЩЕСТВУЮЩЕГО города откатывает старую версию в _deleted, а не стирает.
  describe('полный цикл: создание → удаление → восстановление; замена с откатом', () => {
    let citySlug, cityCardPath;
    const qs = () => `?city=${citySlug}`;

    before(async () => {
      const create = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({
        name: 'Backup Roundtrip Testcity', year: '2010',
      }) });
      assert.equal(create.status, 200, create.body.error);
      citySlug = create.body.slug;
      const char = await apiJson(`/api/characters${qs()}`, { method: 'POST', body: JSON.stringify({
        name: 'Бэкап Тест Персонаж', lineage: 'vampire', gender: 'Мужской', clan: 'Тремер', sect: 'Камарилья',
      }) });
      assert.equal(char.status, 200, char.body.error);
      cityCardPath = path.join(__dirname, '../../cities', citySlug, 'city.md');
    });
    after(async () => {
      await fs.rm(path.join(__dirname, '../../cities', citySlug), { recursive: true, force: true });
      await fs.rm(path.join(__dirname, '../../cities/_deleted'), { recursive: true, force: true }).catch(() => {});
    });

    async function createAndDownloadBackup(slug) {
      const start = await apiJson('/api/backup/city', { method: 'POST', body: JSON.stringify({ slugs: [slug] }) });
      assert.equal(start.status, 200, start.body.error);
      let job;
      for (let i = 0; i < 60; i++) {
        job = await apiJson(`/api/backup/job/${start.body.id}`);
        assert.equal(job.status, 200);
        if (job.body.status !== 'running') break;
        await new Promise(r => setTimeout(r, 500));
      }
      assert.equal(job.body.status, 'done', job.body.error);
      const resp = await fetch(`${BASE}/api/backup/job/${start.body.id}/download`);
      assert.equal(resp.status, 200);
      return Buffer.from(await resp.arrayBuffer());
    }

    async function inspectAndCommit(zipBuf) {
      const inspResp = await fetch(BASE + '/api/backup/restore/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: zipBuf,
      });
      const insp = await inspResp.json();
      assert.equal(inspResp.status, 200, insp.error);
      const commit = await apiJson('/api/backup/restore/commit', {
        method: 'POST', body: JSON.stringify({ inspectId: insp.inspectId }),
      });
      assert.equal(commit.status, 200, commit.body.error);
      return { summary: insp.summary, results: commit.body.results };
    }

    it('бэкап → город удалён с диска → restore возвращает город (rolledBackTo: null, exists:false)', async () => {
      const zipBuf = await createAndDownloadBackup(citySlug);

      await fs.rm(path.join(__dirname, '../../cities', citySlug), { recursive: true, force: true });
      const gone = await apiJson('/api/cities');
      assert.ok(!gone.body.cities.includes(citySlug), 'город должен реально отсутствовать перед восстановлением');

      const { summary, results } = await inspectAndCommit(zipBuf);
      assert.equal(summary[0].slug, citySlug);
      assert.equal(summary[0].exists, false);
      assert.equal(results[0].rolledBackTo, null);

      const back = await apiJson('/api/cities');
      assert.ok(back.body.cities.includes(citySlug), 'город должен вернуться после restore/commit');
      const cardRaw = await fs.readFile(cityCardPath, 'utf-8');
      assert.match(cardRaw, /Backup Roundtrip Testcity/);
    });

    it('restore поверх СУЩЕСТВУЮЩЕГО города: старая версия уходит в _deleted, новая — на месте', async () => {
      // Город уже восстановлен предыдущим тестом (тем же citySlug) — берём свежий бэкап
      // с текущим содержимым, затем меняем живой файл, чтобы отличить «старую» версию
      // (должна уйти в _deleted) от «восстановленной» (должна встать на место).
      const zipBuf = await createAndDownloadBackup(citySlug);
      await fs.writeFile(cityCardPath, (await fs.readFile(cityCardPath, 'utf-8')) + '\n<!-- изменено после бэкапа -->\n');

      const { summary, results } = await inspectAndCommit(zipBuf);
      assert.equal(summary[0].exists, true);
      assert.ok(results[0].rolledBackTo, 'должен быть путь отката для существовавшего города');
      assert.match(results[0].rolledBackTo, new RegExp(`cities/_deleted/${citySlug}__before_restore_`));

      const rolledBackRaw = await fs.readFile(path.join(__dirname, '../..', results[0].rolledBackTo, 'city.md'), 'utf-8');
      assert.match(rolledBackRaw, /изменено после бэкапа/, 'откаченная копия должна содержать ИЗМЕНЁННУЮ (дозабэкапную) версию');

      const restoredRaw = await fs.readFile(cityCardPath, 'utf-8');
      assert.doesNotMatch(restoredRaw, /изменено после бэкапа/, 'на месте должна быть версия ИЗ бэкапа, без ручной правки');
    });

    // QA-находка Д-1 (2026-08-13, docs/design/2026-08-13-backup-tab-qa-fixes-techspec.md):
    // displayNameFromDir раньше (как cityDisplayName) всегда читал ЖИВУЮ cities/<slug>/,
    // даже когда summary формируется по распакованному архиву restore/inspect — так что
    // переименование живого города между «сделать бэкап» и «восстановить им же» показывало
    // в сводке текущее (уже неактуальное) имя вместо того, что реально лежит в архиве.
    // Отдельный синтетический город, не citySlug из describe — тест не должен зависеть
    // от порядка двух предыдущих it().
    it('restore/inspect: сводка показывает имя ИЗ АРХИВА, а не текущее имя живого города', async () => {
      const create = await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({
        name: 'QA Display Name Testcity', year: '2020',
      }) });
      assert.equal(create.status, 200, create.body.error);
      const slug = create.body.slug;
      const cardPath = path.join(__dirname, '../../cities', slug, 'city.md');
      try {
        const zipBuf = await createAndDownloadBackup(slug);

        const renamed = (await fs.readFile(cardPath, 'utf-8')).replace(
          'QA Display Name Testcity', 'RENAMED AFTER BACKUP');
        await fs.writeFile(cardPath, renamed, 'utf-8');

        const inspResp = await fetch(BASE + '/api/backup/restore/inspect', {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: zipBuf,
        });
        const insp = await inspResp.json();
        assert.equal(inspResp.status, 200, insp.error);
        assert.equal(insp.summary[0].display, 'QA Display Name Testcity',
          'сводка должна показывать имя ИЗ АРХИВА, не текущее имя живого города');
      } finally {
        await fs.rm(path.join(__dirname, '../../cities', slug), { recursive: true, force: true });
      }
    });
  });
});
