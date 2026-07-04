'use strict';
// Single entry point: unit tests for lib/parsers.js + integration tests for API.
// Run: node --test --test-reporter=./tests/reporter.js tests/all.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs').promises;
const path   = require('path');
const { startServer, stopServer, apiJson, BASE } = require('./helpers');
const {
  readPrompt, writePrompt, periodLabel,
  threadStatusKey, parseThreadsContent, THREAD_STATUS,
  slugify, CYRILLIC_TR, LATIN_TR, parseDiary,
  mdExtractLinks, mdStripLinks, mdStripInline, classifyChronicleLink,
  categorizeRel, parseCharacter, parseLocation, parseEvent, parseChronicle,
  parseChronicleParticipants,
  parseScenarioSections, replaceScenarioSection, checkScenarioStructure,
  parsePoliticalFactions, setPoliticalFactionInfluence,
  CITY_SECTIONS, buildCityMd, parseCityMd, cityScaffold,
} = require('../lib/parsers');

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
        path.join(__dirname, '../public/utils.js'), 'utf-8');
      const m = src.match(/const _NTR\s*=\s*(\{[^}]*\})/);
      assert.ok(m, '_NTR literal not found in utils.js');
      // eslint-disable-next-line no-new-func
      const browserMap = (new Function(`return (${m[1]})`))();
      assert.deepEqual(browserMap, CYRILLIC_TR,
        'browser _NTR has diverged from canonical CYRILLIC_TR — keep them in sync');
    });

    it('browser parity — public/utils.js _LATIN_TR mirrors LATIN_TR', () => {
      const src = require('fs').readFileSync(
        path.join(__dirname, '../public/utils.js'), 'utf-8');
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
        locations: 'Небоскрёб в центре\nЭлизиум: Опера',
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

    it('факции-секция канонична (между political и locations)', () => {
      const keys = CITY_SECTIONS.map(([k]) => k);
      assert.ok(keys.includes('factions'), 'есть ключ factions');
      assert.equal(keys.indexOf('factions'), keys.indexOf('political') + 1);
      assert.equal(keys.indexOf('factions'), keys.indexOf('locations') - 1);
    });

    it('browser parity — public/scripts.js CITY_SECTION_DEFS зеркалит CITY_SECTIONS', () => {
      const src = require('fs').readFileSync(
        path.join(__dirname, '../public/scripts.js'), 'utf-8');
      const m = src.match(/const CITY_SECTION_DEFS\s*=\s*(\[[\s\S]*?\n\]);/);
      assert.ok(m, 'CITY_SECTION_DEFS literal not found in scripts.js');
      // eslint-disable-next-line no-new-func
      const browserDefs = (new Function(`return (${m[1]})`))();
      assert.deepEqual(browserDefs, CITY_SECTIONS,
        'browser CITY_SECTION_DEFS диверговал от CITY_SECTIONS — держите в синхроне');
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
    it('полный сценарий (все 9 тем module_rules.md) → missing пуст', () => {
      const full = [
        '## Предпосылки', 'x', '---',
        '## Локации', 'x', '---',
        '## НПС', 'x', '---',
        '## Завязка', 'x', '---',
        '## Сцены', 'x', '---',
        '## Кульминация', 'x', '---',
        '## Варианты финала', 'x', '---',
        '## Открытые нити', 'x', '---',
        '## Колорит города', 'x',
      ].join('\n');
      const { missing } = checkScenarioStructure(full);
      assert.deepEqual(missing, []);
    });

    it('реальная плоская структура (Пролог/Сцена N/Финал) тоже покрывает Кульминацию и Сцены', () => {
      const flat = ['## Пролог', 'x', '---', '## Сцена 1 — Бар', 'x', '---', '## Финал', 'x'].join('\n');
      const { missing } = checkScenarioStructure(flat);
      assert.ok(!missing.some(m => m.key === 'scenes'));
      assert.ok(!missing.some(m => m.key === 'climax'));
      // «Предпосылки»/«Локации»/«НПС»/«Завязка»/«Колорит» реально отсутствуют в этом примере
      assert.ok(missing.some(m => m.key === 'flavor'));
    });

    it('пустой сценарий → все 8 тем отсутствуют', () => {
      const { missing } = checkScenarioStructure('Просто текст без заголовков.');
      assert.equal(missing.length, 8);
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
