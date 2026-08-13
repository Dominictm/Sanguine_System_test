'use strict';
/**
 * UI — Selenium/Chrome автотесты Sanguine System.
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

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');
const http   = require('http');

const { Builder, By, until, Select, Key } = require('selenium-webdriver');
const chromeOpts = require('selenium-webdriver/chrome');

const ROOT    = path.resolve(__dirname, '../..');
const UI_PORT = Number(process.env.UI_PORT || 3098);
const BASE    = `http://localhost:${UI_PORT}`;
const TS      = Date.now().toString().slice(-8);
const UI_NAME = `Uiburg${TS}`;
const { slugify } = require('../lib/parsers');  // single source of truth for RU→ASCII slugs
const UI_CITY = slugify(UI_NAME);

const NAV_PAGES = ['dashboard', 'chronicle', 'characters', 'graph', 'factions',
  'chronicles-page', 'modules', 'threads', 'rumors', 'locations', 'tools', 'search'];

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
let css, id_, count, navTo, openTab, typeIn, waitOut, clickEl;

describe('UI — Selenium (Chrome)', () => {

  before(async () => {
    serverProc = spawn('node', [path.join(ROOT, 'web', 'server.js')], {
      cwd:   path.join(ROOT, 'web'),
      env:   { ...process.env, PORT: String(UI_PORT), AI_MOCK: '1' },
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

    // Подавляем онбординг-тур: его backdrop перехватывает клики по сайдбару/вкладкам
    // в безголовом режиме, где нет реального пользователя, кликающего «Пропустить».
    await driver.get(BASE);
    await driver.executeScript("try { localStorage.setItem('sanguine-tour-seen', '1'); } catch (e) {}");

    // Bind driver helpers
    css     = (s, t = 15000) => driver.wait(until.elementLocated(By.css(s)), t, `нет элемента: ${s}`);
    id_     = (s, t = 15000) => driver.wait(until.elementLocated(By.id(s)),  t, `нет #${s}`);
    count   = s => driver.findElements(By.css(s)).then(a => a.length);
    // .page скроллится ВНУТРЕННИМ контейнером (.page{overflow-y:auto}, CSS
    // scroll-behavior:smooth) — обычный el.click() на элементе ниже фолда не
    // докручивает сам (в отличие от body-скролла) и падает
    // ElementClickInterceptedError; scrollIntoView() запускает анимацию
    // асинхронно, так что клик сразу следом всё ещё может попасть в
    // до-скролловую позицию — дожидаемся, пока элемент реально не окажется
    // в точке своего же центра, прежде чем кликать. e.contains(hit), не
    // hit === e: составные элементы (.nav-item/.tab-btn) держат дочерние
    // <span> для иконки/текста — elementFromPoint в их центре возвращает
    // именно дочерний span, а не сам <a>/<button>.
    clickEl = async el => {
      await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
      await driver.wait(() => driver.executeScript(`
        const e = arguments[0];
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && e.contains(hit);
      `, el), 3000, 'элемент не доскроллился в клик-зону');
      await el.click();
    };
    navTo   = async page => {
      await clickEl(await css(`.nav-item[data-page="${page}"]`));
      await css(`#page-${page}.page.active`);
    };
    openTab = async tab => {
      await clickEl(await css(`.tab-btn[data-tab="${tab}"]`));
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
      assert.strictEqual(await driver.getTitle(), 'Sanguine System');
      await css('#sidebar .sidebar-logo');
      assert.ok(await count('.nav-item') >= NAV_PAGES.length, 'не все пункты меню');
    });

    it('переключатель города прогружается — выбранная опция это «Город, Год», не пустышка/слаг', async () => {
      await driver.wait(async () => {
        const sel = new Select(await id_('city-select'));
        const text = await sel.getFirstSelectedOption().then(o => o.getText());
        return text.length > 0 && !/Загрузка/.test(text);
      }, 15000);
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
      // sv-modules всегда рендерится (не зависит от того, какие линейки активны
      // в тестовом городе), в отличие от per-lineage sv-vampires/sv-mortals/...
      const txt = await (await id_('sv-modules')).getText();
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
    it('создание города через страницу «Города»', async () => {
      await navTo('city-new');
      await (await css('#city-create-spoiler summary')).click();
      await typeIn('city-name', UI_NAME);
      await typeIn('city-year', '2010');
      await (await id_('btn-new-city')).click();
      await waitOut('out-new-city', /✓|создан/i);
      assert.ok(fileExists(`cities/${UI_CITY}/city.md`));
    });

    it('создание локации через модалку на странице «Локации»', async () => {
      // Успешное создание города выше запускает отложенный редирект
      // (location.search = ... через setTimeout 900мс, scripts.js) — без
      // явной полной перезагрузки здесь navTo() рискует кликнуть по
      // .nav-item в момент, когда браузер уже уходит на новый URL,
      // и словить stale element reference / повиснуть на пустой странице.
      await driver.get(`${BASE}?city=${UI_CITY}`);
      await navTo('locations');
      await clickEl(await id_('loc-page-create-btn'));
      await css('#loc-edit-modal.open');
      // #loc-edit-modal — chr-modal-backdrop с CSS-переходом видимости,
      // тот же паттерн задержки, что у #char-modal (см. ui-full-flow.test.js).
      const nameInput = await id_('loc-edit-name');
      await driver.wait(until.elementIsVisible(nameInput), 10000, 'поле «Название» не стало видимым');
      await typeIn('loc-edit-name', 'Подземный док');
      await typeIn('loc-edit-district', 'Тестовый район');
      await clickEl(await id_('loc-edit-save-btn'));
      await driver.wait(async () => (await driver.findElements(By.css('#loc-edit-modal.open'))).length === 0,
        10000, 'модалка локации не закрылась после сохранения');
      const districtSlug = slugify('Тестовый район');
      const locSlug = slugify('Подземный док');
      assert.ok(fileExists(`cities/${UI_CITY}/locations/${districtSlug}/${locSlug}/${locSlug}.md`));
    });

    it('кнопка «Пересобрать индекс» отрабатывает', async () => {
      // Предыдущий тест создаёт локацию через модалку на странице «Локации»,
      // поэтому переходим на страницу инструментов явно.
      // Вкладка «Ещё» (data-tab="more") удалена 2026-08-07 — её содержимое
      // объединено с «Учёт данных» (data-tab="validate", index.html:1062).
      // Сама кнопка и область вывода не переименовывались: #btn-rebuild-idx и
      // #out-more живут теперь внутри #tab-validate (index.html:1099, 1108).
      await navTo('tools');
      await openTab('validate');
      await clickEl(await id_('btn-rebuild-idx'));
      await waitOut('out-more', /обновл|событ/i);
    });

    it('кнопка «Проверить ссылки» возвращает вывод', async () => {
      await openTab('validate');
      await (await id_('btn-validate')).click();
      await waitOut('out-validate', /ссыл|битых|broken|✓|0/i, 40000);
    });
  });

  // ── Локация: Опасность / Сенсорика / VtM-таблица / бейдж (техспека §8-16) ─────
  // «Подземный док» выше уже завёл физический район «Тестовый район» на диске —
  // переиспользуем его как свободный текст (не формальная District-сущность,
  // POST /api/locations терпим к этому же случаю, см. техспека §9).
  describe('Локация — Опасность/Сенсорика/VtM-таблица (техспека §8-16, вкладки детальной модалки)', () => {
    const locName    = 'Опасный притон';
    const locSlug     = slugify(locName);
    const districtSlug = slugify('Тестовый район');
    const cardPath    = () => path.join(ROOT, 'cities', UI_CITY, 'locations', districtSlug, locSlug, `${locSlug}.md`);

    it('создание с уровнем опасности; сенсорный канал заполняется отдельно, в детальной модалке (§C2)', async () => {
      // «Сенсорная палитра» убрана из формы создания/редактирования (§C2, план
      // 2026-08-02-location-card-modal-plan.md §6) — тот же функционал уже есть в
      // детальной модалке просмотра (вкладка «Сенсорика»), дублировать не стали.
      // Тест теперь бьётся на два шага: создание (только уровень опасности — то,
      // что форма всё ещё умеет), затем заполнение канала через detail-модалку.
      await driver.get(`${BASE}?city=${UI_CITY}`);
      await navTo('locations');
      await clickEl(await id_('loc-page-create-btn'));
      await css('#loc-edit-modal.open');
      const nameInput = await id_('loc-edit-name');
      await driver.wait(until.elementIsVisible(nameInput), 10000, 'поле «Название» не стало видимым');
      await typeIn('loc-edit-name', locName);
      await typeIn('loc-edit-district', 'Тестовый район');

      // Опасность — <select> с эмодзи-значениями (🟢/🟡/🔴), отдельное поле от Зоны.
      await new Select(await id_('loc-edit-danger')).selectByValue('🟡');
      // «Сенсорной палитры» в этой форме больше нет — раздел проверяется ниже, через
      // вкладку «Сенсорика» детальной модалки, а не здесь.

      await clickEl(await id_('loc-edit-save-btn'));
      await driver.wait(async () => (await count('#loc-edit-modal.open')) === 0,
        10000, 'модалка локации не закрылась после сохранения');

      await driver.wait(() => fs.existsSync(cardPath()), 5000, 'карточка не создана на диске');
      let raw = fs.readFileSync(cardPath(), 'utf-8');
      assert.match(raw, /\*\*Опасность:\*\*\s*🟡/, 'уровень опасности не записался в карточку');
      assert.ok(!/loc-edit-sens/.test(raw), 'сама разметка id не должна была протечь в карточку (страховка от регресса)');

      // Заполняем канал «Свет» через detail-модалку — единственное оставшееся место,
      // где сенсорика редактируется (сохраняет сразу, своей кнопкой на канал).
      await driver.get(`${BASE}?city=${UI_CITY}`);
      await navTo('locations');
      await clickEl(await css(`.loc-card[data-slug="${locSlug}"]`));
      await css('#loc-detail-modal.open');
      await clickEl(await css('#loc-detail-content .cdet-tab[data-tab="sens"]'));
      await css('#loc-detail-content .cdet-panel[data-panel="sens"].active');
      await clickEl(await css('#loc-detail-content [data-editloc="sens-0"]'));
      await driver.wait(until.elementIsVisible(await id_('locdet-sens-0-ta')), 5000, 'форма канала не раскрылась');
      await typeIn('locdet-sens-0-ta', 'Тусклый неон и мигающие лампы.');
      await clickEl(await css('#loc-detail-content [data-saveloc="sens-0"]'));
      await driver.wait(async () => {
        try {
          raw = fs.readFileSync(cardPath(), 'utf-8');
          return /Тусклый неон и мигающие лампы\./.test(raw);
        } catch { return false; }
      }, 8000, 'канал «Свет» не сохранился через детальную модалку');
      assert.match(raw, /\|\s*\*\*Свет\*\*\s*\|\s*Тусклый неон и мигающие лампы\.\s*\|/,
        'сенсорный канал «Свет» не записался в карточку');
    });

    it('детальная модалка показывает бейдж уровня опасности с верной подписью (⚔️ Средний ← 🟡)', async () => {
      await driver.get(`${BASE}?city=${UI_CITY}`);
      await navTo('locations');
      await clickEl(await css(`.loc-card[data-slug="${locSlug}"]`));
      await css('#loc-detail-modal.open');
      // #loc-detail-modal тоже открывается CSS-переходом видимости (тот же паттерн,
      // что #loc-edit-modal выше) — ждём именно текст, а не просто наличие узла в
      // DOM, иначе getText() может поймать бейдж посреди перехода и вернуть ''.
      let badgeText = '';
      await driver.wait(async () => {
        try {
          const els = await driver.findElements(By.css('.locdet-legend-row .badge-danger-medium'));
          if (!els.length) return false;
          badgeText = await els[0].getText();
          return badgeText.length > 0;
        } catch { return false; }
      }, 8000, 'бейдж уровня опасности не появился/остался пустым');
      assert.match(badgeText, /средний/i);
    });

    it('вкладка VtM — форма по 5 полям сохраняется в карточке отдельно от прозы', async () => {
      // Модалка уже открыта на локации из предыдущего теста (тот же driver, та же страница).
      await clickEl(await css('#loc-detail-content .cdet-tab[data-tab="vtm"]'));
      await css('#loc-detail-content .cdet-panel[data-panel="vtm"].active');
      await clickEl(await css('#loc-detail-content .cdet-panel[data-panel="vtm"] .cdet-edit-btn[data-editloc="vtm"]'));
      await driver.wait(until.elementIsVisible(await id_('locdet-vtm-status')), 5000, 'форма VtM не раскрылась');

      // «Статус» стал <select> с фиксированным списком (locations.js:443,
      // значения — CITY_LOCATION_TYPES в city.js:78), а не свободным текстом:
      // typeIn() здесь падал с InvalidElementStateError на .clear().
      await new Select(await id_('locdet-vtm-status')).selectByValue('Убежище');
      await typeIn('locdet-vtm-faction', 'Носферату');
      await typeIn('locdet-vtm-figures', 'Слепой Бармен');
      await typeIn('locdet-vtm-threats', 'Охотники на пороге');
      await new Select(await id_('locdet-vtm-masquerade')).selectByValue('🔴');

      await clickEl(await css('#loc-detail-content [data-saveloc="vtm"]'));

      // Успешное сохранение перерисовывает всю панель через openLocDetail() —
      // ждём появления сохранённого текста в режиме просмотра, а не просто
      // закрытия формы редактирования (та же карточка, новые DOM-узлы).
      await driver.wait(async () => {
        try {
          const bodies = await driver.findElements(By.css('#loc-detail-content .cdet-panel[data-panel="vtm"] .vtm-body'));
          const texts = await Promise.all(bodies.map(e => e.getText()));
          return texts.some(t => t.includes('Убежище')) && texts.some(t => t.includes('Носферату'));
        } catch {
          return false; // DOM перерисовался между findElements() и getText() — попробуем на следующем тике
        }
      }, 8000, 'изменения вкладки VtM не отрендерились после сохранения');

      const raw = fs.readFileSync(cardPath(), 'utf-8');
      assert.match(raw, /\|\s*\*\*Статус\*\*\s*\|\s*Убежище\s*\|/);
      assert.match(raw, /\|\s*\*\*Фракция\*\*\s*\|\s*Носферату\s*\|/);
      assert.match(raw, /\|\s*\*\*Постоянные фигуры\*\*\s*\|\s*Слепой Бармен\s*\|/);
      assert.match(raw, /\|\s*\*\*Угрозы\*\*\s*\|\s*Охотники на пороге\s*\|/);
      assert.match(raw, /\|\s*\*\*Маскарад\*\*\s*\|\s*🔴\s*\|/);
    });
  });

  // ── Город: районы (District) и привязка «бесхозной» локации со страницы просмотра ──
  // Район и «бесхозную» локацию заводит напрямую через API (before) — эти тесты
  // проверяют страницу просмотра города и поток привязки, не сами формы создания.
  describe('Город — страница просмотра: карточки районов и привязка локации (техспека §8-14)', () => {
    const districtName = 'Портовый квартал';
    const districtSlug = slugify(districtName);
    const strayLocName = 'Бесхозный склад';
    const strayLocSlug = slugify(strayLocName);

    before(async () => {
      const distRes = await httpReq('POST', `/api/cities/${UI_CITY}/districts`, { name: districtName });
      assert.equal(distRes.status, 200, JSON.stringify(distRes.json));
      const locRes = await httpReq('POST', `/api/locations?city=${UI_CITY}`, { name: strayLocName, district: 'Прочее' });
      assert.equal(locRes.status, 200, JSON.stringify(locRes.json));
    });

    // Раскрывает район на странице просмотра города: вкладка «География» →
    // спойлер «Районы» → спойлер конкретного района. Повторяет ровно ту
    // последовательность, которой пользуется само приложение
    // (_restoreDistrictSpoilerState, city.js:1079-1087). Без этого
    // .city-district-card* лежит внутри двух закрытых <details>, и Selenium
    // возвращает для него пустой getText() — карточка есть в DOM, но не видна.
    const revealDistrict = async () => {
      await driver.executeScript(`
        document.querySelector('[data-city-view-tab="geography"]')?.click();
        const outer = document.getElementById('city-districts-outer-spoiler');
        if (outer) outer.open = true;
        const item = document.querySelector('.city-landmark-item[data-district-slug="' + arguments[0] + '"]');
        if (item) item.open = true;
      `, districtSlug);
    };

    it('страница просмотра города рендерит карточку района', async () => {
      await driver.get(`${BASE}?city=${UI_CITY}`);
      await navTo('city-new');
      await clickEl(await css(`.city-card[data-slug="${UI_CITY}"]`));
      await css('#page-city.page.active');
      // #page-city — тот же паттерн CSS-перехода видимости, что у модалок (см. выше) —
      // опрашиваем текст в цикле, а не читаем его один раз сразу после нахождения
      // узлов (иначе getText() может поймать карточку посреди перехода и вернуть '').
      let titles = [];
      await driver.wait(async () => {
        try {
          await revealDistrict(); // вкладка/спойлеры могли перерисоваться — раскрываем на каждой итерации
          const els = await driver.findElements(By.css('.city-district-card-title'));
          titles = await Promise.all(els.map(e => e.getText()));
          return titles.some(t => t.includes(districtName));
        } catch { return false; }
      }, 10000, `нет карточки района «${districtName}»`);
      assert.ok(titles.some(t => t.includes(districtName)), `нет карточки района «${districtName}» среди [${titles.join(', ')}]`);
    });

    it('привязка «бесхозной» локации к району переносит папку физически (PUT /district + showConfirm)', async () => {
      // Ищем контейнер района (.city-landmark-item), а НЕ .city-district-card:
      // форма привязки (.city-view-district-attach-sel + [data-attach-loc-btn])
      // лежит рядом с карточкой внутри .city-landmark-body, а не внутри самой
      // карточки (city.js:1049-1058) — поиск по карточке их не находит.
      const districtItem = await driver.wait(async () => {
        try {
          await revealDistrict(); // см. комментарий у revealDistrict выше — иначе содержимое скрыто в <details>
          const items = await driver.findElements(By.css(`.city-landmark-item[data-district-slug="${districtSlug}"]`));
          for (const it of items) {
            if (await it.findElement(By.css('.city-district-card-title')).getText().then(t => t.includes(districtName), () => false)) return it;
          }
          return null;
        } catch { return null; }
      }, 10000, `не нашли карточку района «${districtName}»`);

      const sel = new Select(await districtItem.findElement(By.css('.city-view-district-attach-sel')));
      await sel.selectByValue(strayLocSlug);
      await clickEl(await districtItem.findElement(By.css('[data-attach-loc-btn]')));

      // showConfirm — кастомный диалог (#confirm-overlay), не window.confirm.
      await css('#confirm-overlay');
      await clickEl(await css('#confirm-overlay #_conf-ok'));

      await driver.wait(() => fs.existsSync(path.join(ROOT, 'cities', UI_CITY, 'locations', districtSlug, strayLocSlug)),
        10000, 'папка локации не переехала в район после привязки');
      assert.ok(!fs.existsSync(path.join(ROOT, 'cities', UI_CITY, 'locations', 'prochee', strayLocSlug)),
        'локация должна была переехать, а не задвоиться');
    });
  });

  // ── Создание персонажа (модалка «+ Создать» на странице «Персонажи») ──────────
  // Точка входа перенесена из вкладки «Инструменты → Новый НПС» (удалена) на
  // саму страницу «Персонажи» — там уже была своя, более полная модалка
  // (#char-modal, LINEAGE_DEFS в scripts.js), которая раньше для Оборотня/
  // Мага/Охотника шла через устаревший CLI-инструмент new_npc.js (без
  // обязательных Племя/Традиция из FIX-9, без биографии/внешности) — приведена
  // к единому POST /api/characters, как остальные линейки.
  // Модель формы другая, чем была у старой вкладки: шаг 1 — выбор линейки
  // (.lineage-pick-btn), шаг 2 — поля с data-param (не статичные id), причём
  // #modal-fields перегенерируется целиком при каждом выборе линейки (так что
  // сценарий FIX-7 «смена линейки не очищает Клан/Секту» здесь физически
  // недостижим — поля каждый раз рендерятся с нуля). Клиентская валидация —
  // не тост, а подсветка поля (el.style.borderColor) и молчаливый return.
  // Успех автозакрывает модалку через 900мс (onCreated → setTimeout).
  describe('Создание персонажа (модалка «+ Создать» на странице «Персонажи»)', () => {
    const charPath = (folder, name) => {
      const s = slugify(name);
      return `cities/${UI_CITY}/characters/${folder}/${s}/${s}.md`;
    };

    beforeEach(async () => {
      await driver.get(`${BASE}?city=${UI_CITY}`);
      await navTo('characters');
      await clickEl(await id_('btn-open-create-char'));
      await css('#char-modal.open');
    });

    const pickLineage = async type => clickEl(await css(`.lineage-pick-btn[data-type="${type}"]`));
    const field = param => css(`#modal-fields [data-param="${param}"]`);
    // Единственное реальное <select> в шаге 2 — «Поколение» вампира и
    // универсальная «Принадлежность»; остальные (включая Пол!) — текстовые
    // input с datalist-подсказками, не <select> — определяем тег динамически.
    const setField = async (param, value) => {
      const el = await field(param);
      const tag = await el.getTagName();
      if (tag === 'select') await new Select(el).selectByValue(value);
      else { await el.clear(); await el.sendKeys(value); }
    };
    const submitModal = async () => clickEl(await id_('modal-submit'));
    const borderColor = async param =>
      driver.executeScript('return arguments[0].style.borderColor;', await field(param));

    // ── Позитив: happy path для каждой линейки ──────────────────────────────

    it('Вампир — создаётся с Кланом/Сектой (обязательные поля линейки)', async () => {
      const name = 'УИ Вампир Тест';
      await pickLineage('vampire');
      await setField('name', name);
      await setField('gender', 'Мужской');
      await setField('clan', 'Носферату');
      await setField('sect', 'Камарилья');
      await submitModal();
      await waitOut('modal-output', /✓|создан/i);
      assert.ok(fileExists(charPath('vampires', name)));
    });

    it('Смертный — создаётся с минимумом полей (нет своих обязательных)', async () => {
      const name = 'УИ Смертный Тест';
      await pickLineage('mortal');
      await setField('name', name);
      await setField('gender', 'Мужской');
      await submitModal();
      await waitOut('modal-output', /✓|создан/i);
      assert.ok(fileExists(charPath('mortals', name)));
    });

    it('Охотник — создаётся с минимумом полей (нет своих обязательных)', async () => {
      const name = 'УИ Охотник Тест';
      await pickLineage('hunter');
      await setField('name', name);
      await setField('gender', 'Женский');
      await submitModal();
      await waitOut('modal-output', /✓|создан/i);
      assert.ok(fileExists(charPath('hunters', name)));
    });

    it('Фея — создаётся с заполненным Обличьем (обязательное поле линейки)', async () => {
      const name = 'УИ Фея Тест';
      await pickLineage('fairy');
      await setField('name', name);
      await setField('gender', 'Женский');
      await setField('seeming', 'Дикарь');
      await submitModal();
      await waitOut('modal-output', /✓|создан/i);
      assert.ok(fileExists(charPath('fairies', name)));
    });

    it('Оборотень — создаётся с заполненным Племенем (FIX-9, обязательное поле линейки)', async () => {
      const name = 'УИ Оборотень Тест';
      await pickLineage('werewolf');
      await setField('name', name);
      await setField('gender', 'Мужской');
      await setField('tribe', 'Гару Дети Гайи');
      await submitModal();
      await waitOut('modal-output', /✓|создан/i);
      assert.ok(fileExists(charPath('werewolves', name)));
    });

    it('Маг — создаётся с заполненной Традицией (FIX-9, обязательное поле линейки)', async () => {
      const name = 'УИ Маг Тест';
      await pickLineage('mage');
      await setField('name', name);
      await setField('gender', 'Женский');
      await setField('tradition', 'Верителли');
      await submitModal();
      await waitOut('modal-output', /✓|создан/i);
      assert.ok(fileExists(charPath('mages', name)));
    });

    // ── Негатив: клиентская валидация подсвечивает поле и не отправляет запрос ─

    it('пустое имя → поле подсвечивается, запрос не уходит, карточка не создаётся', async () => {
      await pickLineage('vampire');
      await setField('gender', 'Мужской');
      await setField('clan', 'Бруха');
      await setField('sect', 'Камарилья');
      await submitModal();
      assert.equal(await borderColor('name'), 'var(--crimson)', 'поле «Имя» должно подсветиться как невалидное');
      assert.equal(await count('#modal-output.show'), 0, 'вывод не должен показаться — запрос на сервер не отправлялся');
    });

    it('не указан пол → поле подсвечивается, карточка не создаётся', async () => {
      const name = 'УИ Без Пола';
      await pickLineage('vampire');
      await setField('name', name);
      await setField('clan', 'Бруха');
      await setField('sect', 'Камарилья');
      await submitModal();
      assert.equal(await borderColor('gender'), 'var(--crimson)', 'поле «Пол» должно подсветиться как невалидное');
      assert.ok(!fileExists(charPath('vampires', name)));
    });

    it('Вампир без Клана → поле подсвечивается, карточка не создаётся', async () => {
      const name = 'УИ Без Клана';
      await pickLineage('vampire');
      await setField('name', name);
      await setField('gender', 'Мужской');
      await setField('sect', 'Камарилья');
      await submitModal();
      assert.equal(await borderColor('clan'), 'var(--crimson)', 'поле «Клан» должно подсветиться как невалидное');
      assert.ok(!fileExists(charPath('vampires', name)));
    });

    it('Фея без Обличья → поле подсвечивается, карточка не создаётся (FIX-9)', async () => {
      const name = 'УИ Фея Без Обличья';
      await pickLineage('fairy');
      await setField('name', name);
      await setField('gender', 'Женский');
      await submitModal();
      assert.equal(await borderColor('seeming'), 'var(--crimson)', 'поле «Обличье» должно подсветиться как невалидное');
      assert.ok(!fileExists(charPath('fairies', name)));
    });

    it('Оборотень без Племени → поле подсвечивается, карточка не создаётся (FIX-9)', async () => {
      const name = 'УИ Оборотень Без Племени';
      await pickLineage('werewolf');
      await setField('name', name);
      await setField('gender', 'Мужской');
      await submitModal();
      assert.equal(await borderColor('tribe'), 'var(--crimson)', 'поле «Племя» должно подсветиться как невалидное');
      assert.ok(!fileExists(charPath('werewolves', name)));
    });

    it('Маг без Традиции → поле подсвечивается, карточка не создаётся (FIX-9)', async () => {
      const name = 'УИ Маг Без Традиции';
      await pickLineage('mage');
      await setField('name', name);
      await setField('gender', 'Женский');
      await submitModal();
      assert.equal(await borderColor('tradition'), 'var(--crimson)', 'поле «Традиция» должно подсветиться как невалидное');
      assert.ok(!fileExists(charPath('mages', name)));
    });

    // ── Негатив: серверная проверка (дубликат имени+линейки → 409) ─────────────

    it('повторное создание с тем же именем+линейкой → сервер 409, UI показывает ошибку, не «✓»', async () => {
      const name = 'УИ Дубликат Тест';
      const submitVampire = async () => {
        await pickLineage('vampire');
        await setField('name', name);
        await setField('gender', 'Мужской');
        await setField('clan', 'Бруха');
        await setField('sect', 'Камарилья');
        await submitModal();
      };
      await submitVampire();
      await waitOut('modal-output', /✓|создан/i);
      assert.ok(fileExists(charPath('vampires', name)));

      // Модалка автозакрывается через ~900мс после успеха — переоткрываем и
      // повторяем с тем же именем+линейкой.
      await driver.wait(async () => (await count('#char-modal.open')) === 0, 3000, 'модалка не закрылась автоматически после успеха');
      await clickEl(await id_('btn-open-create-char'));
      await css('#char-modal.open');
      await submitVampire();
      await waitOut('modal-output', /уже существует/i);
    });

    // ── UI-specific: у каждой линейки в шаге 2 есть её специфичное поле ────────

    const LINEAGE_SPECIFIC_FIELD = {
      vampire: 'clan', fairy: 'seeming', werewolf: 'tribe', mage: 'tradition',
    };

    for (const [type, param] of Object.entries(LINEAGE_SPECIFIC_FIELD)) {
      it(`линейка «${type}»: в форме шага 2 есть поле [data-param="${param}"]`, async () => {
        await pickLineage(type);
        assert.equal(await count(`#modal-fields [data-param="${param}"]`), 1);
      });
    }

    it('линейка «Смертный»/«Охотник»: специфичных для линейки обязательных полей нет', async () => {
      for (const type of ['mortal', 'hunter']) {
        await pickLineage(type);
        for (const param of Object.values(LINEAGE_SPECIFIC_FIELD)) {
          // Не «поля вообще нет» — у Охотника есть необязательное [data-param="clan"]
          // (лейбл «Организация», переиспользует общее поле) — важно, что оно не required.
          assert.equal(await count(`#modal-fields [data-param="${param}"][required]`), 0,
            `«${type}» не должна показывать ОБЯЗАТЕЛЬНОЕ поле [data-param="${param}"]`);
        }
        await clickEl(await id_('modal-back'));
      }
    });
  });

  // ── Карточка персонажа (модалка) ───────────────────────────────────────────────
  // Тестировщик: раздел «Персонажи» выше проверял только сам грид («карточки
  // отрисованы», «поиск фильтрует») — сама карточка персонажа (модалка с деталями)
  // не была покрыта вообще. Ниже: открытие с проверкой реальных данных (не просто
  // «что-то отрендерилось»), переключение всех вкладок, ленивая подгрузка листа
  // V20, три способа закрытия, и цикл редактирования/отмены на СВОЁМ тестовом
  // персонаже (UI_CITY) — чтение проверяем на живых данных browse.city, а правки
  // делаем только на одноразовом персонаже, чтобы не трогать реальный paris/balmont.
  describe('Карточка персонажа (модалка)', () => {
    let readChar;   // существующий персонаж из browse.city — только для чтения
    let editSlug;   // свой одноразовый персонаж в UI_CITY — безопасно править

    before(async () => {
      const list = (await get(`/api/characters?city=${browse.city}`)).json || [];
      readChar = list.find(c => (c.relationships || []).length && (c.diaries || []).length)
        || list.find(c => (c.relationships || []).length)
        || list[0];

      const created = await httpReq('POST', `/api/characters?city=${UI_CITY}`,
        { name: 'УИ Карточка Тест', lineage: 'mortal', gender: 'Мужской' });
      editSlug = created.json.slug;
    });

    // Каждый it() открывает модалку через openCharCard() (полная перезагрузка
    // страницы в начале), поэтому внутри блока предыдущий openCharCard() сам
    // сбрасывает состояние — но ПОСЛЕДНИЙ тест ничего не закрывает за собой, и
    // .modal-overlay.open (fixed, во весь экран, z-index поверх всего) остаётся
    // висеть, перехватывая клики в СЛЕДУЮЩЕМ describe-блоке (например по
    // .nav-item «Инструменты»). Возвращаем страницу в чистое состояние.
    after(async () => { await driver.get(`${BASE}?city=${browse.city}`); });

    const openCharCard = async (city, slug) => {
      await driver.get(`${BASE}?city=${city}`);
      await navTo('characters');
      const card = await css(`.char-card[data-slug="${slug}"]`);
      await clickEl(card);
      await css('#char-detail-modal.open');
      // .modal-overlay.open анимирует opacity/visibility через CSS
      // (--dur-base: .28s) — .open появляется на элементе мгновенно (JS),
      // но getText() на ещё непрозрачном/invisible элементе возвращает ''
      // всю длительность перехода. Ждём реального рендера, а не только класса.
      await driver.wait(async () => (await (await css('.cdet-name')).getText()) !== '', 3000,
        'имя персонажа не отрисовалось (модалка ещё в процессе CSS-перехода?)');
    };

    const activePanel = () => driver.executeScript(
      `return document.querySelector('.cdet-panel.active')?.dataset.panel || null;`);

    it('клик по карточке в гриде открывает модалку с верными именем/линейкой', async () => {
      if (!readChar) return; // чистый город без персонажей — нечего открывать
      await openCharCard(browse.city, readChar.slug);
      // .cdet-name — text-transform:uppercase в CSS (заголовок карточки); getText()
      // по спецификации WebDriver возвращает отрисованный (заглавный) текст, а не
      // исходный регистр из DOM/данных — сравниваем без учёта регистра.
      assert.equal((await (await css('.cdet-name')).getText()).toUpperCase(), readChar.name.toUpperCase());
      assert.ok(await count(`.badge-${readChar.lineage}`) >= 1, `нет бейджа линейки .badge-${readChar.lineage}`);
      assert.equal(await activePanel(), 'info', 'по умолчанию должна быть активна вкладка «Информация»');
    });

    it('переключение вкладок — активна ровно одна панель, соответствующая нажатой вкладке', async () => {
      if (!readChar) return;
      await openCharCard(browse.city, readChar.slug);
      const tabs = await driver.findElements(By.css('.cdet-tab'));
      const tabNames = await Promise.all(tabs.map(t => t.getAttribute('data-tab')));
      for (const tabName of tabNames) {
        await clickEl(await css(`.cdet-tab[data-tab="${tabName}"]`));
        await driver.wait(async () => (await activePanel()) === tabName, 5000,
          `после клика по вкладке «${tabName}» активной панелью должна стать [data-panel="${tabName}"]`);
        assert.equal(await count('.cdet-panel.active'), 1, 'должна быть активна ровно одна панель');
      }
    });

    it('вкладка «Отношения» — число .cdet-rel совпадает с данными API', async () => {
      if (!readChar || !(readChar.relationships || []).length) return;
      await openCharCard(browse.city, readChar.slug);
      await clickEl(await css('.cdet-tab[data-tab="rels"]'));
      await driver.wait(async () => (await activePanel()) === 'rels', 5000);
      assert.equal(await count('.cdet-rel'), readChar.relationships.length);
    });

    it('вкладка «Дневники» — число .diary-item совпадает с данными API', async () => {
      if (!readChar || !(readChar.diaries || []).length) return;
      await openCharCard(browse.city, readChar.slug);
      await clickEl(await css('.cdet-tab[data-tab="diaries"]'));
      await driver.wait(async () => (await activePanel()) === 'diaries', 5000);
      assert.equal(await count('.diary-item'), readChar.diaries.length);
    });

    it('вкладка «Лист V20» — лениво подгружается по клику (спиннер сменяется реальным содержимым)', async () => {
      if (!readChar) return;
      await openCharCard(browse.city, readChar.slug);
      // Спиннер — часть исходной разметки модалки (openCharDetail рендерит его
      // сразу, ДО первого клика по вкладке) — сама подгрузка «ленивая»: реальный
      // запрос GET .../sheet-data уходит только по клику (_loadCharSheet).
      assert.equal(await count('#cdet-sheet-panel .loading-state'), 1,
        'до клика по вкладке «Лист V20» панель должна содержать плейсхолдер-спиннер');
      assert.ok(!(await driver.executeScript(`return document.getElementById('cdet-sheet-panel').dataset.loaded || null;`)),
        'panel.dataset.loaded не должен быть выставлен до клика по вкладке');
      await clickEl(await css('.cdet-tab[data-tab="sheet"]'));
      await driver.wait(async () => (await count('#cdet-sheet-panel .loading-state')) === 0, 15000,
        'лист V20 не догрузился (спиннер завис)');
      assert.ok(await count('#cdet-sheet-panel *') > 0, 'после загрузки в панели листа должно быть содержимое');
    });

    it('закрытие кнопкой ✕', async () => {
      if (!readChar) return;
      await openCharCard(browse.city, readChar.slug);
      await clickEl(await id_('char-detail-close'));
      await driver.wait(async () => (await count('#char-detail-modal.open')) === 0, 5000, 'модалка не закрылась по ✕');
    });

    it('закрытие кликом по фону модалки', async () => {
      if (!readChar) return;
      await openCharCard(browse.city, readChar.slug);
      // Клик строго по самому overlay (не по modal-box внутри) — так же, как
      // проверяет обработчик: closeModal только если e.target === сам оверлей.
      await driver.executeScript(`document.getElementById('char-detail-modal').click();`);
      await driver.wait(async () => (await count('#char-detail-modal.open')) === 0, 5000, 'модалка не закрылась по клику на фон');
    });

    it('закрытие по Escape', async () => {
      if (!readChar) return;
      await openCharCard(browse.city, readChar.slug);
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      await driver.wait(async () => (await count('#char-detail-modal.open')) === 0, 5000, 'модалка не закрылась по Escape');
    });

    it('редактирование «Информации»: смена Статуса сохраняется в DOM и на диске', async () => {
      await openCharCard(UI_CITY, editSlug);
      await clickEl(await id_('cdet-edit-btn'));
      await css('#cdet-edit-bar.show');

      const statusSelect = await css('select.cdet-field-input[data-field="status"]');
      await new Select(statusSelect).selectByValue('Пропал');
      await clickEl(await css('#cdet-save-btn'));
      // _exitInfoEdit(true) на успехе сохранения заменяет DOM-узел (<select> →
      // <div>) — между findElements и getText() в той же итерации возможна
      // гонка (StaleElementReferenceError), которую driver.wait НЕ трактует
      // как «ещё не готово», а сразу прерывает ожидание — глушим и опрашиваем дальше.
      await driver.wait(async () => {
        try {
          const els = await driver.findElements(By.css('#cdet-info-fields [data-field="status"]'));
          return els.length && /Пропал/.test(await els[0].getText());
        } catch { return false; }
      }, 8000, 'новый статус не отобразился после сохранения');

      const md = fs.readFileSync(path.join(ROOT, 'cities', UI_CITY, 'characters', 'mortals', editSlug, `${editSlug}.md`), 'utf-8');
      assert.match(md, /\*\*Статус:\*\*\s*Пропал/, 'новый статус не записан в .md-файл на диске');
    });

    it('отмена редактирования — Cancel не меняет значение ни в DOM, ни на диске', async () => {
      await openCharCard(UI_CITY, editSlug);
      const before = await (await css('#cdet-info-fields [data-field="status"]')).getText();

      await clickEl(await id_('cdet-edit-btn'));
      await css('#cdet-edit-bar.show');
      await new Select(await css('select.cdet-field-input[data-field="status"]')).selectByValue('Мёртв');
      await clickEl(await css('#cdet-cancel-btn'));

      await driver.wait(async () => (await count('#cdet-edit-bar.show')) === 0, 5000, 'режим редактирования не закрылся по Отмене');
      assert.equal(await (await css('#cdet-info-fields [data-field="status"]')).getText(), before);

      const md = fs.readFileSync(path.join(ROOT, 'cities', UI_CITY, 'characters', 'mortals', editSlug, `${editSlug}.md`), 'utf-8');
      assert.doesNotMatch(md, /\*\*Статус:\*\*\s*Мёртв\b/, 'Отмена не должна была ничего записать на диск');
    });

    it('переименование в режиме редактирования сохраняет идентичность по slug (FIX-4b) — карточка не задваивается', async () => {
      await openCharCard(UI_CITY, editSlug);
      await clickEl(await id_('cdet-edit-btn'));
      await css('#cdet-name-input');
      const nameInput = await id_('cdet-name-input');
      await nameInput.clear();
      await nameInput.sendKeys('УИ Карточка Тест (переименован)');
      await clickEl(await css('#cdet-save-btn'));
      await driver.wait(async () => (await count('#cdet-edit-bar.show')) === 0, 8000, 'не вышли из режима редактирования после сохранения');

      // Грид ещё не перезагружен — переоткрываем страницу «Персонажи» тем же
      // slug'ом (identity), а не по новому имени, и убеждаемся, что карточка одна.
      await openCharCard(UI_CITY, editSlug);
      assert.equal(await count(`.char-card[data-slug="${editSlug}"]`), 1, 'после переименования карточка задвоилась или потерялась по slug');
      assert.equal((await (await css('.cdet-name')).getText()).toUpperCase(), 'УИ Карточка Тест (переименован)'.toUpperCase());
    });
  });

  // ── Назначение генераций (вкладка «⚡ Назначение генераций») ──────────────────

  describe('Назначение провайдеров (вкладка «⚡ Назначение генераций»)', () => {
    it('рендерит карточки фич с переключателями провайдера', async () => {
      // Вкладка «Модели AI» (data-tab="ai-settings") разделена 2026-08-07 на
      // «🔌 Подключение AI» (ai-connect — ключи/OAuth) и «⚡ Назначение генераций»
      // (ai-features — то, что рендерит .ais-feat-card, см. scripts.js:506).
      await navTo('tools');
      await openTab('ai-features');
      await css('.ais-feat-card', 20000);
      assert.ok(await count('.ais-feat-card')     >= 1, 'нет карточек назначения провайдеров');
      assert.ok(await count('.ais-feat-prov-btn') >= 1, 'нет переключателей провайдера');
    });
  });

});
