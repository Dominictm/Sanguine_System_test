'use strict';
// Single entry point: unit tests for lib/parsers.js + integration tests for API.
// Run: node --test --test-reporter=./tests/reporter.js tests/all.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs').promises;
const path   = require('path');
const { startServer, stopServer, apiJson } = require('./helpers');
const {
  readPrompt, writePrompt, periodLabel,
  threadStatusKey, parseThreadsContent, THREAD_STATUS,
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
const CHAR_GERSON   = encodeURIComponent('Герсон');
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
    it('is no-op when block is absent', () => {
      const base = '# Без блока\n\nТекст.';
      assert.equal(writePrompt(base, 'image', 'test', 'indented'), base);
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
  });

  // ── Chronicles & modules ───────────────────────────────────────────────────
  describe('Chronicles & modules', () => {
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
    it(`GET /api/chronicles/${CHR}/events → array`, async () => {
      const { status, body } = await apiJson(`/api/chronicles/${CHR}/events${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      if (body.length > 0) assert.ok('date' in body[0] || 'title' in body[0]);
    });
    it(`GET /api/chronicles/${CHR}/modules → array`, async () => {
      const { status, body } = await apiJson(`/api/chronicles/${CHR}/modules${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
    });
    it('GET /api/modules → non-empty array', async () => {
      const { status, body } = await apiJson(`/api/modules${CITY}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body) && body.length > 0);
    });
    it(`GET /api/chronicles/${CHR}/modules/${MOD}/detail → full object`, async () => {
      const { status, body } = await apiJson(
        `/api/chronicles/${CHR}/modules/${MOD}/detail${CITY}`);
      assert.equal(status, 200);
      assert.equal(body.name, MOD);
      assert.equal(body.chronicle, CHR);
      assert.ok(Array.isArray(body.pcs));
      assert.ok(Array.isArray(body.npcs));
      assert.ok(Array.isArray(body.events));
      assert.ok('title' in body);
    });
    it('GET nonexistent module/detail → 404', async () => {
      const { status } = await apiJson(
        `/api/chronicles/${CHR}/modules/__NOMOD__/detail${CITY}`);
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
      const { status, body } = await apiJson(`/api/search?q=ab${CITY}`);
      assert.equal(status, 200);
      assert.equal(body.total, 0);
    });
    it('returns expected shape for real query', async () => {
      const { status, body } = await apiJson(`/api/search?q=Paris${CITY}`);
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
      const { body } = await apiJson(`/api/search?q=Париж${CITY}`);
      for (const c of (body.results?.characters || [])) {
        assert.ok(typeof c.slug    === 'string');
        assert.ok(typeof c.name    === 'string');
        assert.ok(typeof c.excerpt === 'string');
      }
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
    const CHAR_ENC     = encodeURIComponent(CHAR_NAME);
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

}); // API — integration
