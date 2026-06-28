'use strict';
/**
 * E2E — сквозной цикл хроники Sanguine System.
 * Поднимает сервер на порту 3097, создаёт одноразовый тестовый город,
 * проходит: new_city → new_npc → new_location → /api/log-session (preview + commit,
 * включая инлайн-НПС) → /api/status → close_chronicle → build_city_events →
 * validate_cards --strict. Убирает за собой.
 *
 * Запуск: node --test tests/e2e.test.js  (из web/)
 */

const { describe, it, before, after } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const http     = require('http');
const { spawn, spawnSync } = require('child_process');
const { slugify } = require('../lib/parsers');

const ROOT     = path.resolve(__dirname, '../..');
const E2E_PORT = Number(process.env.E2E_PORT || 3097);
const TS       = Date.now().toString().slice(-8);
const CITY     = `e2e_${TS}`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpReq(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      { host: '127.0.0.1', port: E2E_PORT, path: urlPath, method,
        headers: { 'Content-Type': 'application/json',
                   ...(data ? { 'Content-Length': data.length } : {}) } },
      res => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          let json = null; try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, json, raw: buf });
        });
      });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const get  = p       => httpReq('GET',  p, null);
const post = (p, b)  => httpReq('POST', p, b);
const tool = (name, args) => post(`/api/tool/${name}`, { args });

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await get('/api/cities')).status === 200) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Сервер не поднялся на порту ${E2E_PORT} за ${timeoutMs} мс`);
}

// ── FS helpers ────────────────────────────────────────────────────────────────
const abs        = rel => path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
const fileExists = rel => fs.existsSync(abs(rel));
const readFile   = rel => fs.readFileSync(abs(rel), 'utf-8');
function rmTestCity(slug) {
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) return;
  try { fs.rmSync(path.join(ROOT, 'cities', slug), { recursive: true, force: true }); } catch {}
}

// ── Session payload (shared fixture) ─────────────────────────────────────────
const SESSION_PAYLOAD = {
  module:      { mode: 'new', newName: 'Кровь на мостовой' },
  chronicle:   { mode: 'new', newName: 'Е2Е-арка' },
  event:       { month: '2011-02', dateLabel: 'Февраль 2011', title: 'Первая встреча',
                 locationLine: 'Клуб Носферату', summary: 'Завязка интриги.' },
  participants: [
    { name: 'Виктор Ламбер', role: 'патрон', diary: true },
    { name: 'Безымянный Гуль', lineage: 'mortals', role: 'информатор' },
  ],
  threads: {
    new: [{ title: 'Кто заказал убийство?', desc: 'Главная загадка', priority: 'Высокий' }],
    close: [],
  },
};

// ── Shared state across sequential tests ─────────────────────────────────────
let serverProc;
let previewHash, chrSlug;

// ══════════════════════════════════════════════════════════════════════════════

describe('E2E — сквозной цикл хроники', () => {

  before(async () => {
    serverProc = spawn('node', [path.join(ROOT, 'web', 'server.js')], {
      cwd:   path.join(ROOT, 'web'),
      // AI_MOCK → deterministic offline generation; the disposable test city is
      // a safe sandbox for write-generation (sheets) since after() removes it.
      env:   { ...process.env, PORT: String(E2E_PORT), AI_MOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.on('data', () => {});
    serverProc.stderr.on('data', () => {});
    await waitForServer();
  });

  after(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill();
      await new Promise(r => serverProc.once('exit', r));
    }
    rmTestCity(CITY);
  });

  // ── 1. Город ───────────────────────────────────────────────────────────────

  describe('1. Город', () => {
    it('POST /api/tool/new_city создаёт город', async () => {
      const r = await tool('new_city', [CITY, 'Тестополис', '2010']);
      assert.strictEqual(r.status, 200, `HTTP ${r.status}`);
      assert.ok(r.json?.ok, `ok=false: ${r.json?.output}`);
      assert.ok(fileExists(`cities/${CITY}/city.md`));
      assert.ok(fileExists(`cities/${CITY}/archive/characters_index.md`));
    });

    it('город виден в /api/cities', async () => {
      const r = await get('/api/cities');
      assert.ok(r.json.cities.includes(CITY), `города ${CITY} нет в списке`);
    });

    it('/api/status отдаёт домен города', async () => {
      const r = await get(`/api/status?city=${CITY}`);
      assert.strictEqual(r.json.city, CITY);
      assert.match(r.json.domain, /Тестополис/);
      assert.strictEqual(r.json.characters, 0, 'новый город должен быть без персонажей');
    });
  });

  // ── 1b. CRUD городов через прямые эндпоинты (POST/PUT/DELETE /api/cities) ─────
  describe('1b. CRUD городов (API)', () => {
    const CRUD = slugify('Крудтест');   // отдельный город, не задевает основной e2e CITY

    after(() => {
      rmTestCity(CRUD);                 // на случай, если DELETE-тест не отработал
      // убрать артефакт мягкого удаления cities/_deleted/krudtest_<ts> (только свой)
      try {
        const bin = path.join(ROOT, 'cities', '_deleted');
        for (const n of fs.readdirSync(bin))
          if (n.startsWith(CRUD + '_')) fs.rmSync(path.join(bin, n), { recursive: true, force: true });
        if (!fs.readdirSync(bin).length) fs.rmdirSync(bin);
      } catch {}
    });

    it('POST /api/cities создаёт город из полей', async () => {
      const r = await post('/api/cities', { name: 'Крудтест', year: '2012',
        description: 'Сырой портовый город под вечной моросью.',
        political: 'Камарилья правит\nКнязь: Тестус', factions: 'Камарилья\nДжованни',
        locations: 'Элизиум — Ратуша' });
      assert.strictEqual(r.status, 200, `HTTP ${r.status}`);
      assert.ok(r.json?.ok, `ok=false: ${JSON.stringify(r.json)}`);
      assert.strictEqual(r.json.slug, slugify('Крудтест'));
      assert.ok(fileExists(`cities/${r.json.slug}/city.md`));
    });

    it('POST пробрасывает description и factions в city.md', async () => {
      const slug = slugify('Крудтест');
      const d = await get(`/api/cities/${slug}/detail`);
      assert.match(d.json.parsed.description, /Сырой портовый город/);
      assert.match(d.json.parsed.sections.factions, /Камарилья/);
      assert.match(d.json.parsed.sections.factions, /Джованни/);
    });

    it('POST синхронизирует «Карту фракций» (political_state.md) при создании', () => {
      const ps = readFile(`cities/${slugify('Крудтест')}/archive/political_state.md`);
      assert.match(ps, /Князь/, 'роль Князь не попала в Карту фракций');
      assert.match(ps, /Тестус/, 'персонаж не попал в Карту фракций');
    });

    it('POST с уже существующим слагом → 409', async () => {
      const r = await post('/api/cities', { name: 'Крудтест', year: '2012' });
      assert.strictEqual(r.status, 409, `ожидался 409, получен ${r.status}`);
    });

    it('POST без названия → 400', async () => {
      const r = await post('/api/cities', { year: '2012' });
      assert.strictEqual(r.status, 400);
    });

    it('POST без года → 400', async () => {
      const r = await post('/api/cities', { name: 'Безгода' });
      assert.strictEqual(r.status, 400);
    });

    it('POST с нечисловым годом → 400', async () => {
      const r = await post('/api/cities', { name: 'Кривогод', year: 'abcd' });
      assert.strictEqual(r.status, 400);
    });

    it('GET detail отдаёт parsed.display/year/секции', async () => {
      const r = await get(`/api/cities/${slugify('Крудтест')}/detail`);
      assert.strictEqual(r.json.parsed.display, 'Крудтест');
      assert.strictEqual(r.json.parsed.year, '2012');
      assert.match(r.json.parsed.sections.political, /Камарилья правит/);
    });

    it('PUT (fields) переписывает display', async () => {
      const slug = slugify('Крудтест');
      const r = await httpReq('PUT', `/api/cities/${slug}`, { fields: { display: 'Крудтест-2', year: '2013' } });
      assert.strictEqual(r.status, 200, `HTTP ${r.status}`);
      const d = await get(`/api/cities/${slug}/detail`);
      assert.strictEqual(d.json.parsed.display, 'Крудтест-2');
      assert.strictEqual(d.json.parsed.year, '2013');
    });

    it('PUT (raw cityMd) сохраняет произвольный markdown', async () => {
      const slug = slugify('Крудтест');
      const md = `# Крудтест-3, 2014 — сеттинг города\n\n## Своя секция\n- кастомный контент\n`;
      const r = await httpReq('PUT', `/api/cities/${slug}`, { cityMd: md });
      assert.strictEqual(r.status, 200, `HTTP ${r.status}`);
      const raw = readFile(`cities/${slug}/city.md`);
      assert.match(raw, /Своя секция/, 'кастомная секция не сохранилась');
    });

    it('PUT без cityMd/fields → 400', async () => {
      const r = await httpReq('PUT', `/api/cities/${slugify('Крудтест')}`, {});
      assert.strictEqual(r.status, 400);
    });

    it('DELETE мягко удаляет (город пропадает из /api/cities)', async () => {
      const slug = slugify('Крудтест');
      const r = await httpReq('DELETE', `/api/cities/${slug}`, null);
      assert.strictEqual(r.status, 200, `HTTP ${r.status}`);
      assert.ok(r.json?.ok);
      const list = await get('/api/cities');
      assert.ok(!list.json.cities.includes(slug), 'удалённый город всё ещё в списке');
    });
  });

  // ── 2. Персонаж и локация ───────────────────────────────────────────────────

  describe('2. Персонаж и локация', () => {
    it('new_npc создаёт карточку вампира', async () => {
      const r = await tool('new_npc', [CITY, 'vampires', 'Виктор Ламбер', 'Мужской', 'Тореадор']);
      assert.ok(r.json?.ok, `ok=false: ${r.json?.output}`);
      assert.ok(fileExists(`cities/${CITY}/characters/vampires/viktor_lamber/viktor_lamber.md`));
    });

    it('карточка содержит обязательные поля', () => {
      const md = readFile(`cities/${CITY}/characters/vampires/viktor_lamber/viktor_lamber.md`);
      assert.match(md, /^#\s+🧛\s+Виктор Ламбер/m, 'нет H1 с эмодзи');
      assert.match(md, /Слаг:\*\*\s*viktor_lamber/, 'нет слага');
      assert.match(md, /Родной город:\*\*\s*Тестополис/, 'нет родного города');
      assert.match(md, /## 🖼️ Изображения/, 'нет секции изображений');
    });

    it('new_location создаёт карточку локации', async () => {
      const r = await tool('new_location', [CITY, '1', 'Клуб Носферату', 'Центр', 'dangerous']);
      assert.ok(r.json?.ok, `ok=false: ${r.json?.output}`);
      assert.ok(fileExists(`cities/${CITY}/locations/district_01/tsentr/klub_nosferatu/klub_nosferatu.md`));
      const md = readFile(`cities/${CITY}/locations/district_01/tsentr/klub_nosferatu/klub_nosferatu.md`);
      assert.match(md, /🔴 Опасная/, 'зона не проставлена');
    });

    it('/api/characters отдаёт созданного персонажа', async () => {
      const r = await get(`/api/characters?city=${CITY}`);
      assert.ok(r.json.length >= 1);
      assert.ok(r.json.some(c => c.name === 'Виктор Ламбер'), 'персонаж не найден в API');
    });
  });

  // ── 2b. AI-генерация (mock-провайдер: офлайн, детерминированно) ──────────────
  // Пишущая генерация (лист V20) безопасна — всё внутри одноразового города.

  describe('2b. AI-генерация (mock)', () => {
    const VICTOR = encodeURIComponent('Виктор Ламбер');

    it('POST sheet/generate создаёт и сохраняет лист V20', async () => {
      const r = await post(`/api/characters/${VICTOR}/sheet/generate?city=${CITY}`, {});
      assert.strictEqual(r.status, 200, `HTTP ${r.status}: ${r.raw}`);
      assert.ok(r.json?.ok, `ok=false: ${r.raw}`);
      assert.ok((r.json.content || '').length > 0, 'пустой лист');
      assert.ok(fileExists(`cities/${CITY}/characters/vampires/viktor_lamber/viktor_lamber-sheet.md`),
        'файл листа не создан');
    });

    it('GET sheet возвращает сохранённый лист', async () => {
      const r = await get(`/api/characters/${VICTOR}/sheet?city=${CITY}`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json?.exists, true, 'лист не виден после генерации');
      assert.ok((r.json.content || '').length > 0);
    });

    it('POST dialogue возвращает реплики в характере', async () => {
      const r = await post(`/api/characters/${VICTOR}/dialogue?city=${CITY}`,
        { situation: 'Допрос в подвале клуба', count: 2 });
      assert.strictEqual(r.status, 200, `HTTP ${r.status}: ${r.raw}`);
      assert.ok(r.json?.ok && (r.json.text || '').length > 0, 'нет реплик');
    });

    it('POST canon-check возвращает массив issues', async () => {
      const r = await post(`/api/canon-check?city=${CITY}`,
        { text: 'Виктор Ламбер появился на премьере в Опере.' });
      assert.strictEqual(r.status, 200, `HTTP ${r.status}: ${r.raw}`);
      assert.ok(r.json?.ok && Array.isArray(r.json.issues), 'issues не массив');
    });
  });

  // ── 2c. Удаление персонажа (мягкое: папка → characters/_deleted/) ────────────
  describe('2c. Удаление персонажа', () => {
    const DELNAME = 'Удаляемый Гуль';
    const DELSLUG = 'udalyaemyy_gul';

    it('new_npc создаёт одноразового персонажа', async () => {
      const r = await tool('new_npc', [CITY, 'mortals', DELNAME, 'Женский']);
      assert.ok(r.json?.ok, `ok=false: ${r.json?.output}`);
      assert.ok(fileExists(`cities/${CITY}/characters/mortals/${DELSLUG}/${DELSLUG}.md`));
    });

    it('DELETE архивирует папку в _deleted', async () => {
      const r = await httpReq('DELETE', `/api/characters/${encodeURIComponent(DELNAME)}?city=${CITY}`, null);
      assert.strictEqual(r.status, 200, `HTTP ${r.status}: ${r.raw}`);
      assert.ok(r.json?.ok, `ok=false: ${r.raw}`);
      assert.ok(!fileExists(`cities/${CITY}/characters/mortals/${DELSLUG}/`), 'исходная папка осталась');
      assert.ok(fileExists(`cities/${CITY}/characters/_deleted/${DELSLUG}/${DELSLUG}.md`), 'не перемещено в _deleted');
    });

    it('персонаж исчез из /api/characters', async () => {
      const r = await get(`/api/characters?city=${CITY}`);
      assert.ok(!r.json.some(c => c.name === DELNAME), 'удалённый всё ещё в списке');
    });

    it('строка реестра удалена', () => {
      const idx = readFile(`cities/${CITY}/archive/characters_index.md`);
      assert.ok(!new RegExp(`${DELSLUG}/${DELSLUG}\\.md`).test(idx), 'ссылка осталась в индексе');
    });
  });

  // ── 3. Логирование сессии ───────────────────────────────────────────────────

  describe('3. Логирование сессии', () => {
    it('предпросмотр (dryRun) возвращает previewHash и план', async () => {
      const r = await post(`/api/log-session?city=${CITY}`, { ...SESSION_PAYLOAD, dryRun: true });
      assert.strictEqual(r.status, 200, `HTTP ${r.status}: ${r.raw}`);
      assert.ok(r.json?.ok && r.json?.previewHash, 'нет previewHash');
      previewHash = r.json.previewHash;
      const rels = r.json.changes.map(c => c.rel);
      assert.ok(rels.some(x => /chronicle\.md$/.test(x)), 'нет авто-создания chronicle.md');
      assert.ok(rels.some(x => /characters\/mortals\/.*\.md$/.test(x)), 'инлайн-НПС не запланирован');
      chrSlug = (rels.find(x => /chronicles\/.+\/chronicle\.md$/.test(x)) || '').split('/')[3];
      assert.ok(chrSlug, 'не удалось определить слаг хроники');
    });

    it('запись с устаревшим хэшем отклоняется (409)', async () => {
      const r = await post(`/api/log-session?city=${CITY}`,
        { ...SESSION_PAYLOAD, dryRun: false, previewHash: 'stale-hash' });
      assert.strictEqual(r.status, 409, `ожидался 409, получен ${r.status}: ${r.raw}`);
    });

    it('запись (dryRun:false) с верным хэшем создаёт артефакты', async () => {
      assert.ok(previewHash, 'previewHash не установлен предыдущим тестом');
      assert.ok(chrSlug,    'chrSlug не установлен предыдущим тестом');
      const r = await post(`/api/log-session?city=${CITY}`,
        { ...SESSION_PAYLOAD, dryRun: false, previewHash });
      assert.strictEqual(r.status, 200, `HTTP ${r.status}: ${r.raw}`);
      assert.ok(r.json?.ok, `запись не удалась: ${r.raw}`);
      assert.ok(r.json.written.length >= 3);
      assert.ok(fileExists(`cities/${CITY}/chronicles/${chrSlug}/chronicle.md`));
      assert.ok(fileExists(`cities/${CITY}/chronicles/${chrSlug}/events.md`));
    });

    it('инлайн-НПС записан как карточка-заготовка', () => {
      assert.ok(fileExists(`cities/${CITY}/characters/mortals/bezymyannyy_gul/bezymyannyy_gul.md`));
      const md = readFile(`cities/${CITY}/characters/mortals/bezymyannyy_gul/bezymyannyy_gul.md`);
      assert.match(md, /Родной город:\*\*\s*Тестополис/);
      assert.match(md, /Линейка WoD:\*\*\s*Смертный/);
    });
  });

  // ── 4. Состояние после сессии ───────────────────────────────────────────────

  describe('4. Состояние после сессии', () => {
    it('/api/status отражает события, модуль и персонажей', async () => {
      const r = await get(`/api/status?city=${CITY}`);
      assert.ok(r.json.characters >= 2,   'должно быть >=2 персонажей');
      assert.ok(r.json.events     >= 1,   'нет событий');
      assert.ok(r.json.modules    >= 1,   'нет модулей');
      assert.ok(r.json.openThreads >= 1,  'нет открытых нитей');
    });

    it('/api/chronicles содержит созданную хронику', async () => {
      const r    = await get(`/api/chronicles?city=${CITY}`);
      const list = Array.isArray(r.json) ? r.json : (r.json?.chronicles || []);
      assert.match(JSON.stringify(list), new RegExp(chrSlug || 'UNKNOWN'), 'хроника не найдена');
    });
  });

  // ── 5. Закрытие хроники ────────────────────────────────────────────────────

  describe('5. Закрытие хроники', () => {
    it('close_chronicle проставляет статус «Закрыта»', async () => {
      assert.ok(chrSlug, 'chrSlug не установлен предыдущим тестом');
      const r = await tool('close_chronicle', [CITY, chrSlug, 'Финал: заказчик найден.']);
      assert.ok(r.json?.ok, `ok=false: ${r.json?.output}`);
      const md = readFile(`cities/${CITY}/chronicles/${chrSlug}/chronicle.md`);
      assert.match(md, /🟢 Закрыта/, 'статус не сменился на Закрыта');
      assert.match(md, /🏁 Финал хроники/, 'нет секции финала');
    });

    it('открытые нити закрыты после close_chronicle', async () => {
      const r = await get(`/api/status?city=${CITY}`);
      assert.strictEqual(r.json.openThreads, 0, 'остались открытые нити');
    });

    it('build_city_events пересобирает индекс города', async () => {
      const r = await tool('build_city_events', [CITY]);
      assert.ok(r.json?.ok, `ok=false: ${r.json?.output}`);
      assert.match(r.json.output, /событ/i);
    });
  });

  // ── 6. Целостность данных ──────────────────────────────────────────────────

  describe('6. Целостность данных', () => {
    it('validate_cards --strict проходит без ошибок', () => {
      const res = spawnSync(
        'node', [path.join(ROOT, 'system', 'schema', 'validate_cards.js'), '--strict'],
        { cwd: ROOT, encoding: 'utf-8' });
      assert.strictEqual(res.status, 0,
        `линтер карточек вернул ошибки:\n${res.stdout || ''}${res.stderr || ''}`);
    });
  });

});
