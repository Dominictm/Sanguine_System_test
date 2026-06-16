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
      env:   { ...process.env, PORT: String(E2E_PORT) },
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

  // ── 2. Персонаж и локация ───────────────────────────────────────────────────

  describe('2. Персонаж и локация', () => {
    it('new_npc создаёт карточку вампира', async () => {
      const r = await tool('new_npc', [CITY, 'vampires', 'Виктор Ламбер', 'Тореадор']);
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
