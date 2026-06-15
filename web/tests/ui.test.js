'use strict';
/**
 * UI — Selenium/Chrome автотесты VTM Chronicle Manager.
 * Проверяет реальный фронтенд: загрузку SPA, навигацию, персонажей, переключатель
 * города, вкладку «Инструменты». Создаёт одноразовый город и убирает за собой.
 *
 * Требования: Google Chrome (ChromeDriver скачается Selenium Manager автоматически).
 * selenium-webdriver берётся из ../tests/node_modules или из node_modules.
 *
 * Запуск:
 *   node --test tests/ui.test.js            (из web/, видимый браузер)
 *   HEADLESS=1 node --test tests/ui.test.js (headless)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');
const http   = require('http');

const { Builder, By, until } = require('selenium-webdriver');
const chromeOpts = require('selenium-webdriver/chrome');

const ROOT    = path.resolve(__dirname, '../..');
const UI_PORT = Number(process.env.UI_PORT || 3098);
const BASE    = `http://localhost:${UI_PORT}`;
const TS      = Date.now().toString().slice(-8);
const UI_NAME = `Uiburg${TS}`;
const _TR     = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
const slugify = s => (s || '').toLowerCase().split('').map(c => _TR[c] !== undefined ? _TR[c] : c).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
const UI_CITY = slugify(UI_NAME);

const NAV_PAGES = ['dashboard', 'chronicle', 'characters', 'graph', 'modules', 'threads', 'locations', 'tools'];

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpReq(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      { host: '127.0.0.1', port: UI_PORT, path: urlPath, method,
        headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) } },
      res => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          let json = null; try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, json });
        });
      });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const get = p => httpReq('GET', p, null);

async function waitForServer(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await httpReq('GET', '/api/cities', null)).status === 200) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Сервер не поднялся на порту ${port} за ${timeoutMs} мс`);
}

async function pickBrowseCity() {
  const { json } = await get('/api/cities');
  const cities = (json && json.cities) || [];
  for (const c of cities) {
    const s = await get('/api/status?city=' + c);
    if (s.json && s.json.characters > 0) return { city: c, chars: s.json.characters };
  }
  return { city: cities[0] || '', chars: 0 };
}

const fileExists = rel => fs.existsSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel));
function rmTestCity(slug) {
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) return;
  try { fs.rmSync(path.join(ROOT, 'cities', slug), { recursive: true, force: true }); } catch {}
}

// ── State ─────────────────────────────────────────────────────────────────────
let serverProc, driver;
let browse = { city: '', chars: 0 };

// ── Driver helpers (set after driver is created) ──────────────────────────────
let css, id_, count, navTo, openTab, typeIn, waitOut;

describe('UI — Selenium (Chrome)', () => {

  before(async () => {
    serverProc = spawn('node', [path.join(ROOT, 'web', 'server.js')], {
      cwd:   path.join(ROOT, 'web'),
      env:   { ...process.env, PORT: String(UI_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.on('data', () => {});
    serverProc.stderr.on('data', () => {});
    await waitForServer(UI_PORT);
    browse = await pickBrowseCity();

    const opts = new chromeOpts.Options()
      .addArguments('--window-size=1440,960', '--lang=ru');
    if (process.env.HEADLESS)
      opts.addArguments('--headless=new', '--no-sandbox', '--disable-gpu');

    driver = await new Builder().forBrowser('chrome').setChromeOptions(opts).build();
    driver.manage().setTimeouts({ implicit: 0 });

    // Bind driver helpers
    css     = (s, t = 15000) => driver.wait(until.elementLocated(By.css(s)), t, `нет элемента: ${s}`);
    id_     = (s, t = 15000) => driver.wait(until.elementLocated(By.id(s)),  t, `нет #${s}`);
    count   = s => driver.findElements(By.css(s)).then(a => a.length);
    navTo   = async page => {
      await (await css(`.nav-item[data-page="${page}"]`)).click();
      await css(`#page-${page}.page.active`);
    };
    openTab = async tab => {
      await (await css(`.tab-btn[data-tab="${tab}"]`)).click();
      await css(`#tab-${tab}.tab-panel.active`);
    };
    typeIn  = async (elId, val) => {
      const e = await id_(elId); await e.clear(); await e.sendKeys(val);
    };
    waitOut = (elId, re, t = 25000) => driver.wait(async () => {
      try { return re.test(await (await driver.findElement(By.id(elId))).getText()); } catch { return false; }
    }, t, `не дождались ${re} в #${elId}`);
  });

  after(async () => {
    if (driver) { try { await driver.quit(); } catch {} }
    if (serverProc && !serverProc.killed) {
      serverProc.kill();
      await new Promise(r => serverProc.once('exit', r));
    }
    rmTestCity(UI_CITY);
  });

  // ── Загрузка ────────────────────────────────────────────────────────────────

  describe('Загрузка приложения', () => {
    it('SPA открывается, заголовок и сайдбар на месте', async () => {
      await driver.get(`${BASE}?city=${browse.city}`);
      assert.strictEqual(await driver.getTitle(), 'VTM Chronicle Manager');
      await css('#sidebar .sidebar-logo');
      assert.ok(await count('.nav-item') >= NAV_PAGES.length, 'не все пункты меню');
    });

    it('domain-label прогружается (не «Загрузка»)', async () => {
      await driver.wait(async () =>
        !/Загрузка/.test(await (await id_('domain-label')).getText()), 15000);
    });

    it('заход без ?city= редиректит на активный город', async () => {
      await driver.get(`${BASE}/`);
      await driver.wait(async () =>
        /[?&]city=/.test(await driver.getCurrentUrl()), 15000, 'нет редиректа на ?city=');
    });
  });

  // ── Навигация ───────────────────────────────────────────────────────────────

  describe('Навигация по разделам', () => {
    before(async () => { await driver.get(`${BASE}?city=${browse.city}`); });

    for (const page of NAV_PAGES) {
      it(`раздел «${page}» открывается`, async () => {
        await navTo(page);
        const active = await driver.findElements(By.css(`#page-${page}.active`));
        assert.strictEqual(active.length, 1, `#page-${page} не активна`);
      });
    }
  });

  // ── Панель управления ────────────────────────────────────────────────────────

  describe('Панель управления', () => {
    it('карточки статистики отрисованы', async () => {
      await navTo('dashboard');
      await css('.stat-card');
      assert.ok(await count('.stat-card') >= 3, 'мало stat-card');
    });

    it('счётчик персонажей — число', async () => {
      const txt = await (await id_('sv-chars')).getText();
      assert.match(txt, /^\d+$/, `ожидалось число, получено «${txt}»`);
    });
  });

  // ── Персонажи ────────────────────────────────────────────────────────────────

  describe('Персонажи', () => {
    it('грид персонажей рендерится', async () => {
      await navTo('characters');
      await css('#chars-grid');
      if (browse.chars > 0)
        assert.ok(await count('.char-card') >= 1, 'нет карточек, хотя персонажи есть');
    });

    it('поиск фильтрует грид', async () => {
      if (browse.chars === 0) return;
      const before = await count('.char-card');
      await typeIn('search-input', 'оченьмаловероятноеимяzzz');
      await driver.wait(async () => (await count('.char-card')) < before, 8000, 'фильтр не сработал');
      await typeIn('search-input', '');
    });
  });

  // ── Переключатель города ──────────────────────────────────────────────────────

  describe('Переключатель города', () => {
    it('в выпадашке есть города', async () => {
      const n = await count('#city-select option');
      assert.ok(n >= 1, 'нет опций города');
    });
  });

  // ── Инструменты (создание через UI) ──────────────────────────────────────────

  describe('Инструменты (Node-инструменты через UI)', () => {
    it('создание города через вкладку «Новый домен»', async () => {
      await navTo('tools');
      await openTab('new-city');
      await typeIn('city-name', UI_NAME);
      await typeIn('city-year', '2010');
      await (await id_('btn-new-city')).click();
      await waitOut('out-new-city', /✓|создан/i);
      assert.ok(fileExists(`cities/${UI_CITY}/city.md`));
    });

    it('создание НПС через вкладку «Новый НПС»', async () => {
      await driver.get(`${BASE}?city=${UI_CITY}`);
      await navTo('tools');
      await openTab('new-npc');
      await typeIn('npc-name', 'Тестовый Носферату');
      await (await id_('btn-new-npc')).click();
      await waitOut('out-new-npc', /✓|создан/i);
      assert.ok(fileExists(`cities/${UI_CITY}/characters/vampires/testovyy_nosferatu/testovyy_nosferatu.md`));
    });

    it('создание локации во вкладке «🛠 Ещё»', async () => {
      await navTo('tools');
      await openTab('more');
      await typeIn('loc-district', '1');
      await typeIn('loc-name', 'Подземный док');
      await (await id_('btn-new-loc')).click();
      await waitOut('out-more', /✓|создан/i);
      assert.ok(fileExists(`cities/${UI_CITY}/locations/district_01/podzemnyy_dok/podzemnyy_dok.md`));
    });

    it('кнопка «Пересобрать индекс» отрабатывает', async () => {
      await (await id_('btn-rebuild-idx')).click();
      await waitOut('out-more', /обновл|событ/i);
    });

    it('кнопка «Проверить ссылки» возвращает вывод', async () => {
      await openTab('validate');
      await (await id_('btn-validate')).click();
      await waitOut('out-validate', /ссыл|битых|broken|✓|0/i, 40000);
    });
  });

});
