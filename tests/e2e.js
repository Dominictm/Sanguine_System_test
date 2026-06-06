'use strict';
/**
 * VTM Chronicle Manager — End-to-End автотест (без браузера).
 *
 * Проходит весь рабочий цикл Рассказчика на одноразовом тестовом городе:
 *   new_city → new_npc → new_location → /api/log-session (предпросмотр + запись,
 *   включая инлайн-создание НПС) → /api/status → close_chronicle →
 *   build_city_events → линтер карточек (validate_cards --strict).
 *
 * Сам поднимает сервер на отдельном порту и убирает за собой тестовый город.
 *
 * Запуск:  node tests/e2e.js            (отчёт: tests/report_e2e.html)
 */
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./_helpers');
const { assert } = H;

const PORT = Number(process.env.E2E_PORT || 3097);
const TS   = Date.now().toString().slice(-8);
const CITY = `e2e_${TS}`;                          // одноразовый город
const R = new H.Runner('E2E — сквозной цикл хроники');

const tool = (name, args) => H.post(`/api/tool/${name}`, { args }, PORT);

(async () => {
  let server;
  try {
    server = H.startServer(PORT);
    await H.waitForServer(PORT);

    // ── 1. Создание города ──────────────────────────────────────────────────────
    R.group('1. Город');
    await R.test('POST /api/tool/new_city создаёт город', async () => {
      const r = await tool('new_city', [CITY, 'Тестополис', '2010']);
      assert.eq(r.status, 200, `HTTP ${r.status}`);
      assert.ok(r.json && r.json.ok, 'ok=false: ' + (r.json && r.json.output));
      assert.fileExists(`cities/${CITY}/city.md`);
      assert.fileExists(`cities/${CITY}/archive/characters_index.md`);
    });
    await R.test('город виден в /api/cities', async () => {
      const r = await H.get('/api/cities', PORT);
      assert.includes(r.json.cities, CITY, 'города нет в списке');
    });
    await R.test('/api/status отдаёт домен города', async () => {
      const r = await H.get(`/api/status?city=${CITY}`, PORT);
      assert.eq(r.json.city, CITY);
      assert.match(r.json.domain, /Тестополис/);
      assert.eq(r.json.characters, 0, 'новый город должен быть без персонажей');
    });

    // ── 2. Персонаж и локация ────────────────────────────────────────────────────
    R.group('2. Персонаж и локация');
    await R.test('new_npc создаёт карточку вампира', async () => {
      const r = await tool('new_npc', [CITY, 'vampires', 'Виктор Ламбер', 'Тореадор']);
      assert.ok(r.json && r.json.ok, 'ok=false: ' + (r.json && r.json.output));
      assert.fileExists(`cities/${CITY}/characters/vampires/viktor_lamber/viktor_lamber.md`);
    });
    await R.test('карточка содержит обязательные поля', () => {
      const md = H.readFile(`cities/${CITY}/characters/vampires/viktor_lamber/viktor_lamber.md`);
      assert.match(md, /^#\s+🧛\s+Виктор Ламбер/m, 'нет H1 с эмодзи');
      assert.match(md, /Слаг:\*\*\s*viktor_lamber/, 'нет слага');
      assert.match(md, /Родной город:\*\*\s*Тестополис/, 'нет родного города');
      assert.match(md, /## 🖼️ Изображения/, 'нет секции изображений');
    });
    await R.test('new_location создаёт карточку локации', async () => {
      const r = await tool('new_location', [CITY, '1', 'Клуб Носферату', 'Центр', 'dangerous']);
      assert.ok(r.json && r.json.ok, 'ok=false: ' + (r.json && r.json.output));
      assert.fileExists(`cities/${CITY}/locations/district_01/tsentr/klub_nosferatu/klub_nosferatu.md`);
      const md = H.readFile(`cities/${CITY}/locations/district_01/tsentr/klub_nosferatu/klub_nosferatu.md`);
      assert.match(md, /🔴 Опасная/, 'зона не проставлена');
    });
    await R.test('/api/characters отдаёт созданного персонажа', async () => {
      const r = await H.get(`/api/characters?city=${CITY}`, PORT);
      assert.ge(r.json.length, 1);
      assert.ok(r.json.some(c => c.name === 'Виктор Ламбер'), 'персонаж не найден в API');
    });

    // ── 3. Логирование сессии (две фазы + инлайн-НПС) ────────────────────────────
    R.group('3. Логирование сессии');
    const payloadBase = {
      module:      { mode: 'new', newName: 'Кровь на мостовой' },
      chronicle:   { mode: 'new', newName: 'Е2Е-арка' },
      event:       { month: '2011-02', dateLabel: 'Февраль 2011', title: 'Первая встреча',
                     locationLine: 'Клуб Носферату', summary: 'Завязка интриги.' },
      participants: [
        { name: 'Виктор Ламбер', role: 'патрон', diary: true },
        { name: 'Безымянный Гуль', lineage: 'mortals', role: 'информатор' },   // инлайн-НПС
      ],
      threads: { new: [{ title: 'Кто заказал убийство?', desc: 'Главная загадка', priority: 'Высокий' }], close: [] },
    };
    let previewHash, chrSlug;
    await R.test('предпросмотр (dryRun) возвращает previewHash и план', async () => {
      const r = await H.post(`/api/log-session?city=${CITY}`, { ...payloadBase, dryRun: true }, PORT);
      assert.eq(r.status, 200, `HTTP ${r.status}: ${r.raw}`);
      assert.ok(r.json.ok && r.json.previewHash, 'нет previewHash');
      previewHash = r.json.previewHash;
      const rels = r.json.changes.map(c => c.rel);
      assert.ok(rels.some(x => /chronicle\.md$/.test(x)), 'нет авто-создания chronicle.md');
      assert.ok(rels.some(x => /characters\/mortals\/.*\.md$/.test(x)), 'инлайн-НПС не запланирован');
      chrSlug = (rels.find(x => /chronicles\/.+\/chronicle\.md$/.test(x)) || '').split('/')[3];
      assert.ok(chrSlug, 'не удалось определить слаг хроники');
    });
    await R.test('запись с устаревшим хэшем отклоняется (409)', async () => {
      // план строится чисто (ещё ничего не записано), но хэш неверный → 409
      const r = await H.post(`/api/log-session?city=${CITY}`,
        { ...payloadBase, dryRun: false, previewHash: 'stale-hash' }, PORT);
      assert.eq(r.status, 409, `ожидался 409, получен ${r.status}: ${r.raw}`);
    });
    await R.test('запись (dryRun:false) c верным хэшем создаёт артефакты', async () => {
      const r = await H.post(`/api/log-session?city=${CITY}`,
        { ...payloadBase, dryRun: false, previewHash }, PORT);
      assert.eq(r.status, 200, `HTTP ${r.status}: ${r.raw}`);
      assert.ok(r.json.ok, 'запись не удалась: ' + r.raw);
      assert.ge(r.json.written.length, 3);
      assert.fileExists(`cities/${CITY}/chronicles/${chrSlug}/chronicle.md`);
      assert.fileExists(`cities/${CITY}/chronicles/${chrSlug}/events.md`);
    });
    await R.test('инлайн-НПС записан как карточка-заготовка', () => {
      assert.fileExists(`cities/${CITY}/characters/mortals/bezymyannyy_gul/bezymyannyy_gul.md`);
      const md = H.readFile(`cities/${CITY}/characters/mortals/bezymyannyy_gul/bezymyannyy_gul.md`);
      assert.match(md, /Родной город:\*\*\s*Тестополис/);
      assert.match(md, /Линейка WoD:\*\*\s*Смертный/);
    });

    // ── 4. Статус после сессии ───────────────────────────────────────────────────
    R.group('4. Состояние после сессии');
    await R.test('/api/status отражает события, модуль и персонажей', async () => {
      const r = await H.get(`/api/status?city=${CITY}`, PORT);
      assert.ge(r.json.characters, 2, 'должно быть >=2 персонажей (Виктор + инлайн-гуль)');
      assert.ge(r.json.events, 1, 'нет событий');
      assert.ge(r.json.modules, 1, 'нет модулей');
      assert.ge(r.json.openThreads, 1, 'нет открытых нитей');
    });
    await R.test('/api/chronicles содержит созданную хронику', async () => {
      const r = await H.get(`/api/chronicles?city=${CITY}`, PORT);
      const list = Array.isArray(r.json) ? r.json : (r.json.chronicles || []);
      const flat = JSON.stringify(list);
      assert.match(flat, new RegExp(chrSlug), 'хроника не найдена в /api/chronicles');
    });

    // ── 5. Закрытие хроники и переиндексация ─────────────────────────────────────
    R.group('5. Закрытие хроники');
    await R.test('close_chronicle проставляет статус «Закрыта»', async () => {
      const r = await tool('close_chronicle', [CITY, chrSlug, 'Финал: заказчик найден.']);
      assert.ok(r.json && r.json.ok, 'ok=false: ' + (r.json && r.json.output));
      const md = H.readFile(`cities/${CITY}/chronicles/${chrSlug}/chronicle.md`);
      assert.match(md, /🟢 Закрыта/, 'статус не сменился на Закрыта');
      assert.match(md, /🏁 Финал хроники/, 'нет секции финала');
    });
    await R.test('открытые нити закрыты после close_chronicle', async () => {
      const r = await H.get(`/api/status?city=${CITY}`, PORT);
      assert.eq(r.json.openThreads, 0, 'остались открытые нити');
    });
    await R.test('build_city_events пересобирает индекс города', async () => {
      const r = await tool('build_city_events', [CITY]);
      assert.ok(r.json && r.json.ok, 'ok=false: ' + (r.json && r.json.output));
      assert.match(r.json.output, /событ/i);
    });

    // ── 6. Целостность ───────────────────────────────────────────────────────────
    R.group('6. Целостность данных');
    await R.test('validate_cards --strict проходит без ошибок', () => {
      const res = spawnSync('node', [path.join(H.ROOT, 'system', 'schema', 'validate_cards.js'), '--strict'],
        { cwd: H.ROOT, encoding: 'utf-8' });
      assert.eq(res.status, 0, 'линтер карточек вернул ошибки:\n' + (res.stdout || '') + (res.stderr || ''));
    });

  } catch (e) {
    R.group('Фатальная ошибка');
    await R.test('инициализация', () => { throw e; });
  } finally {
    await H.stopServer(server);
    H.rmTestCity(CITY);
  }

  R.writeReport(path.join(__dirname, 'report_e2e.html'));
  const ok = R.summary();
  console.log(`\nОтчёт: tests/report_e2e.html`);
  process.exit(ok ? 0 : 1);
})();
