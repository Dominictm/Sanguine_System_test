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
  parseScenarioSections, replaceScenarioSection, replaceScenarioSections,
  insertScenarioScene, hasManualSceneMarker, addManualSceneMarker, clearManualSceneMarker,
  checkScenarioStructure,
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
