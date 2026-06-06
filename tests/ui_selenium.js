'use strict';
/**
 * VTM Chronicle Manager — UI-автотесты на Selenium (запуск в браузере Chrome).
 *
 * Проверяет реальный фронтенд: загрузку SPA, навигацию, панель, грид персонажей,
 * переключатель города и вкладку «Инструменты» (создание города/НПС/локации через
 * /api/tool, проверка ссылок). Создаёт одноразовый город и убирает его за собой.
 *
 * Требования: установлен Google Chrome; selenium-webdriver (npm i в tests/).
 *   Selenium Manager сам скачает ChromeDriver.
 *
 * Запуск:   node tests/ui_selenium.js            (видимый браузер)
 *           HEADLESS=1 node tests/ui_selenium.js  (без окна, для CI)
 * Отчёт:    tests/report_ui.html
 */
const path = require('path');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const H = require('./_helpers');
const { assert } = H;

const PORT = Number(process.env.UI_PORT || 3098);
const BASE = `http://localhost:${PORT}`;
const TS   = Date.now().toString().slice(-8);
const UI_NAME = `Uiburg${TS}`;                 // латиница → предсказуемый слаг
const UI_CITY = H.slugify(UI_NAME);
const R = new H.Runner('UI — Selenium (Chrome)');

const NAV_PAGES = ['dashboard', 'chronicle', 'characters', 'graph', 'modules', 'threads', 'locations', 'tools'];

async function pickBrowseCity() {
  const { json } = await H.get('/api/cities', PORT);
  const cities = (json && json.cities) || [];
  for (const c of cities) {
    const s = await H.get('/api/status?city=' + c, PORT);
    if (s.json && s.json.characters > 0) return { city: c, chars: s.json.characters };
  }
  return { city: cities[0] || '', chars: 0 };
}

(async () => {
  let server, driver, browse = { city: '', chars: 0 };
  try {
    server = H.startServer(PORT);
    await H.waitForServer(PORT);
    browse = await pickBrowseCity();

    const opts = new chrome.Options().addArguments('--window-size=1440,960', '--lang=ru');
    if (process.env.HEADLESS) opts.addArguments('--headless=new', '--no-sandbox', '--disable-gpu');
    driver = await new Builder().forBrowser('chrome').setChromeOptions(opts).build();
    driver.manage().setTimeouts({ implicit: 0 });

    const css      = (s, t = 15000) => driver.wait(until.elementLocated(By.css(s)), t, `нет элемента: ${s}`);
    const id       = (s, t = 15000) => driver.wait(until.elementLocated(By.id(s)), t, `нет #${s}`);
    const count    = s => driver.findElements(By.css(s)).then(a => a.length);
    const navTo    = async page => { await (await css(`.nav-item[data-page="${page}"]`)).click(); await css(`#page-${page}.page.active`); };
    const openTab  = async tab => { await (await css(`.tab-btn[data-tab="${tab}"]`)).click(); await css(`#tab-${tab}.tab-panel.active`); };
    const typeIn   = async (elId, val) => { const e = await id(elId); await e.clear(); await e.sendKeys(val); };
    const waitOut  = (elId, re, t = 25000) => driver.wait(async () => {
      try { return re.test(await (await driver.findElement(By.id(elId))).getText()); } catch { return false; }
    }, t, `не дождались текста ${re} в #${elId}`);

    // ── Загрузка ──────────────────────────────────────────────────────────────
    R.group('🌐 Загрузка приложения');
    await R.test('SPA открывается, заголовок и сайдбар на месте', async () => {
      await driver.get(BASE + '?city=' + browse.city);
      assert.eq(await driver.getTitle(), 'VTM Chronicle Manager');
      await css('#sidebar .sidebar-logo');
      assert.ge(await count('.nav-item'), NAV_PAGES.length, 'не все пункты меню');
    });
    await R.test('domain-label прогружается (не «Загрузка»)', async () => {
      await driver.wait(async () => !/Загрузка/.test(await (await id('domain-label')).getText()), 15000);
    });
    await R.test('заход без ?city= редиректит на активный город', async () => {
      await driver.get(BASE + '/');
      await driver.wait(async () => /[?&]city=/.test(await driver.getCurrentUrl()), 15000, 'нет редиректа на ?city=');
    });

    // ── Навигация ─────────────────────────────────────────────────────────────
    R.group('🧭 Навигация по разделам');
    await driver.get(BASE + '?city=' + browse.city);
    for (const page of NAV_PAGES) {
      await R.test(`раздел «${page}» открывается`, async () => {
        await navTo(page);
        const active = await driver.findElements(By.css(`#page-${page}.active`));
        assert.eq(active.length, 1, `#page-${page} не активна`);
      });
    }

    // ── Панель ────────────────────────────────────────────────────────────────
    R.group('📊 Панель управления');
    await R.test('карточки статистики отрисованы', async () => {
      await navTo('dashboard');
      await css('.stat-card');
      assert.ge(await count('.stat-card'), 3, 'мало stat-card');
    });
    await R.test('счётчик персонажей — число', async () => {
      const txt = await (await id('sv-chars')).getText();
      assert.match(txt, /^\d+$/, `ожидалось число, получено «${txt}»`);
    });

    // ── Персонажи ─────────────────────────────────────────────────────────────
    R.group('🎭 Персонажи');
    await R.test('грид персонажей рендерится', async () => {
      await navTo('characters');
      await css('#chars-grid');
      if (browse.chars > 0) assert.ge(await count('.char-card'), 1, 'нет карточек, хотя персонажи есть');
    });
    await R.test('поиск фильтрует грид', async () => {
      if (browse.chars === 0) return;                 // нечего фильтровать
      const before = await count('.char-card');
      await typeIn('search-input', 'оченьмаловероятноеимяzzz');
      await driver.wait(async () => (await count('.char-card')) < before, 8000, 'фильтр не сработал');
      await typeIn('search-input', '');
    });

    // ── Переключатель города ──────────────────────────────────────────────────
    R.group('🏙️ Переключатель города');
    await R.test('в выпадашке есть города', async () => {
      const n = await count('#city-select option');
      assert.ge(n, 1, 'нет опций города');
    });

    // ── Инструменты ────────────────────────────────────────────────────────────
    R.group('⚙️ Инструменты (Node-инструменты через UI)');
    await R.test('создание города через вкладку «Новый домен»', async () => {
      await navTo('tools');
      await openTab('new-city');
      await typeIn('city-name', UI_NAME);
      await typeIn('city-year', '2010');
      await (await id('btn-new-city')).click();
      await waitOut('out-new-city', /✓|создан/i);
      assert.fileExists(`cities/${UI_CITY}/city.md`);
    });
    await R.test('создание НПС через вкладку «Новый НПС»', async () => {
      await driver.get(BASE + '?city=' + UI_CITY);     // активный город = новый
      await navTo('tools');
      await openTab('new-npc');
      await typeIn('npc-name', 'Тестовый Носферату');
      await (await id('btn-new-npc')).click();
      await waitOut('out-new-npc', /✓|создан/i);
      assert.fileExists(`cities/${UI_CITY}/characters/vampires/testovyy_nosferatu/testovyy_nosferatu.md`);
    });
    await R.test('создание локации во вкладке «🛠 Ещё»', async () => {
      await navTo('tools');
      await openTab('more');
      await typeIn('loc-district', '1');
      await typeIn('loc-name', 'Подземный док');
      await (await id('btn-new-loc')).click();
      await waitOut('out-more', /✓|создан/i);
      assert.fileExists(`cities/${UI_CITY}/locations/district_01/podzemnyy_dok/podzemnyy_dok.md`);
    });
    await R.test('кнопка «Пересобрать индекс» отрабатывает', async () => {
      await (await id('btn-rebuild-idx')).click();
      await waitOut('out-more', /обновл|событ/i);
    });
    await R.test('кнопка «Проверить ссылки» возвращает вывод', async () => {
      await openTab('validate');
      await (await id('btn-validate')).click();
      await waitOut('out-validate', /ссыл|битых|broken|✓|0/i, 40000);
    });

  } catch (e) {
    R.group('Фатальная ошибка');
    await R.test('инициализация браузера/сервера', () => { throw e; });
  } finally {
    if (driver) { try { await driver.quit(); } catch {} }
    await H.stopServer(server);
    H.rmTestCity(UI_CITY);
  }

  R.writeReport(path.join(__dirname, 'report_ui.html'));
  const ok = R.summary();
  console.log(`\nОтчёт: tests/report_ui.html`);
  process.exit(ok ? 0 : 1);
})();
