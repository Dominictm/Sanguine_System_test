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

    it('факции-секция канонична (сразу после political, до locations)', () => {
      const keys = CITY_SECTIONS.map(([k]) => k);
      assert.ok(keys.includes('factions'), 'есть ключ factions');
      assert.equal(keys.indexOf('factions'), keys.indexOf('political') + 1);
      assert.ok(keys.indexOf('factions') < keys.indexOf('locations'));
    });

    it('секции «живого города» присутствуют (D1, план 2026-07-15)', () => {
      const keys = CITY_SECTIONS.map(([k]) => k);
      for (const k of ['districts', 'landmarks', 'hunting', 'edicts', 'mortals', 'calendar', 'tech', 'limits', 'naming'])
        assert.ok(keys.includes(k), `нет секции ${k}`);
    });

    it('browser parity — public/city.js CITY_SECTION_DEFS зеркалит CITY_SECTIONS', () => {
      const src = require('fs').readFileSync(
        path.join(__dirname, '../public/scripts/city.js'), 'utf-8');
      const m = src.match(/const CITY_SECTION_DEFS\s*=\s*(\[[\s\S]*?\n\]);/);
      assert.ok(m, 'CITY_SECTION_DEFS literal not found in city.js');
      // eslint-disable-next-line no-new-func
      const browserDefs = (new Function(`return (${m[1]})`))();
      assert.deepEqual(browserDefs, CITY_SECTIONS,
        'browser CITY_SECTION_DEFS диверговал от CITY_SECTIONS — держите в синхроне');
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
      const added = addTimelineEpoch(fixture, 'II. Эпоха вторая');
      let t = parseTimelineMd(added);
      assert.equal(t.epochs.length, 2);
      assert.equal(t.epochs[1].heading, 'II. Эпоха вторая');
      assert.equal(t.epochs[1].rows.length, 0);

      const removed = removeTimelineEpoch(added, 'II. Эпоха вторая').raw;
      t = parseTimelineMd(removed);
      assert.equal(t.epochs.length, 1);
      assert.equal(t.epochs[0].heading, 'I. Эпоха первая'); // первая эпоха не задета
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

    it('районы (CSV или массив) → locations/district_NN/<slug>', () => {
      const fromCsv = cityScaffold({ display: 'X', year: '2020', districts: 'Митте, Кройцберг' }).keepDirs;
      assert.ok(fromCsv.includes('locations/district_01/mitte'));
      assert.ok(fromCsv.includes('locations/district_02/kroytsberg'));
      assert.ok(!fromCsv.includes('locations'), 'при наличии районов общей папки locations нет');
      const fromArr = cityScaffold({ display: 'X', year: '2020', districts: ['Митте'] }).keepDirs;
      assert.ok(fromArr.includes('locations/district_01/mitte'));
    });

    it('дедуп районов: одинаковый слаг схлопывается, нумерация подряд', () => {
      const { keepDirs } = cityScaffold({ display: 'X', year: '2020', districts: 'Митте, Митте, Кройцберг' });
      const dist = keepDirs.filter(d => d.startsWith('locations/district_'));
      assert.deepEqual(dist, ['locations/district_01/mitte', 'locations/district_02/kroytsberg'],
        'дубль «Митте» должен быть схлопнут, районы пронумерованы подряд');
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
    it('source-guard: scripts.js — REL_TYPE_OPTIONS содержит «Фамильяр»', () => {
      const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/scripts.js'), 'utf-8');
      const m = js.match(/const REL_TYPE_OPTIONS = \[([^\]]*)\]/);
      assert.ok(m, 'не найдена константа REL_TYPE_OPTIONS');
      assert.ok(m[1].includes("'Фамильяр'"), 'REL_TYPE_OPTIONS не содержит «Фамильяр»');
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
    it('source-guard: graph.js — buildRelTypeFilter() рисует цветовой маркер (.reltype-swatch) из REL_COLORS у каждого чипа', () => {
      const js = require('fs').readFileSync(path.join(__dirname, '../public/scripts/graph.js'), 'utf-8');
      assert.ok(!js.includes('function buildLegend'), 'buildLegend() всё ещё существует — должна быть убрана как дублирующая .reltype-swatch в чипах фильтра');
      assert.ok(!js.includes("getElementById('graph-legend')"), 'graph.js всё ещё ссылается на убранный #graph-legend');
      const fnMatch = js.match(/function buildRelTypeFilter\(\) \{[\s\S]*?\n\}/);
      assert.ok(fnMatch, 'не найдена функция buildRelTypeFilter');
      assert.ok(/class="reltype-swatch" style="background:\$\{REL_COLORS\[k\]\}"/.test(fnMatch[0]),
        'buildRelTypeFilter() не рисует .reltype-swatch с цветом из REL_COLORS[k] для каждого чипа');
    });
    it('source-guard: index.html — #graph-legend убран из разметки тулбара графа', () => {
      const html = require('fs').readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
      assert.ok(!html.includes('id="graph-legend"'), '#graph-legend всё ещё в разметке — дублирует .reltype-swatch в чипах фильтра');
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
      assert.deepEqual(c.relationships[0], { target: 'Мел', description: 'союзник', type: 'ally' });
      assert.equal(c.relationships[1].type, 'enemy');
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
      '> **Название:** Клуб | **Округ:** 1 | **Зона:** 🔴 Опасная | **Контроль:** Шабаш',
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
    it('эталонная плоская структура (GM-справка/Пролог/Сцена N/Финал/Открытые вопросы/Колорит) → missing пуст', () => {
      const full = [
        '## 🔒 GM-справка — закрытая информация', 'x', '---',
        '## Пролог — Начало', 'x', '---',
        '## Сцена 1 — Бар', 'x', '---',
        '## Финал — Развязка', 'x', '---',
        '## Открытые вопросы после модуля', 'x', '---',
        '## Колорит — три обязательные детали', 'x',
      ].join('\n');
      const { missing } = checkScenarioStructure(full);
      assert.deepEqual(missing, []);
    });

    it('минимальная структура (Пролог/Сцена N/Финал) без вопросов/колорита → 2 недостающие темы', () => {
      const flat = ['## Пролог', 'x', '---', '## Сцена 1 — Бар', 'x', '---', '## Финал', 'x'].join('\n');
      const { missing } = checkScenarioStructure(flat);
      assert.ok(!missing.some(m => m.key === 'setup'));
      assert.ok(!missing.some(m => m.key === 'scenes'));
      assert.ok(!missing.some(m => m.key === 'finale'));
      assert.ok(missing.some(m => m.key === 'threads'));
      assert.ok(missing.some(m => m.key === 'flavor'));
      assert.equal(missing.length, 2);
    });

    it('пустой сценарий → все 5 тем отсутствуют', () => {
      const { missing } = checkScenarioStructure('Просто текст без заголовков.');
      assert.equal(missing.length, 5);
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
> **Название:** Тест | **Округ:** 1-й | **Район:** Тест | **Адрес:** ул. Тестовая | **Зона:** 🟡 | **Контроль:** Никто
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
          { method: 'POST', body: JSON.stringify({ base64: 'iVBORw0KGgo=', ext: 'jpg' }) });
        assert.equal(status, 200);
        assert.equal(body.success, true);
        assert.match(body.filename, new RegExp(`^${CHAR_GERSON}_\\d+\\.jpg$`));

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

    it('PUT /api/audio/:id — 404 для несуществующего id', async () => {
      const { status } = await apiJson('/api/audio/__no_such_id__', {
        method: 'PUT', body: JSON.stringify({ title: 'Новое имя' }),
      });
      assert.equal(status, 404);
    });

    it('PUT /api/audio/:id — отклоняет недопустимое значение категории', async () => {
      const { body: created } = await apiJson('/api/audio', {
        method: 'POST',
        body: JSON.stringify({ title: 'Для проверки категории', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'music' }),
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
          body: JSON.stringify({ title: 'Трек для пресета', filename: 'x.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'effect' }),
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
          body: JSON.stringify({ title: 'Останется', filename: 'a.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'music' }),
        });
        const { body: doomedTrack } = await apiJson('/api/audio', {
          method: 'POST',
          body: JSON.stringify({ title: 'Будет удалён', filename: 'b.mp3', mimetype: 'audio/mpeg', data: 'AAAA', category: 'effect' }),
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
  describe('Faction influence — GET/PUT', () => {
    const polFile = path.join(CITY_ROOT, 'archive', 'political_state.md');
    let original = null;

    before(async () => { original = await fs.readFile(polFile, 'utf-8').catch(() => null); });
    after(async () => {
      if (original !== null) await fs.writeFile(polFile, original, 'utf-8');
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
      const otherChr = (Array.isArray(allChrs) ? allChrs : []).map(c => c.slug).find(s => s !== chr);
      if (!otherChr) return; // фикстура с одной хроникой — нечего использовать целью

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
  assert.ok(js.includes('familiarChar.name === c.name'), 'нет проверки familiarChar.name === c.name для самоссылки');
  assert.ok(js.includes('Связь-фамильяр указывает на самого персонажа'), 'нет диагностического сообщения для самоссылки фамильяра');
  const idx1 = js.indexOf('familiarChar.name === c.name');
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
