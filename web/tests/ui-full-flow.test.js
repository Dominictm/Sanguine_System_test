'use strict';
/**
 * Полный UI-цикл изолированного города.
 *
 * По умолчанию генерация сценария использует AI_MOCK: тест не требует ключей,
 * не обращается к внешней сети и не расходует лимиты. Для реального smoke-теста
 * OpenRouter запускайте из web/:
 *
 *   $env:UI_LIVE_OPENROUTER='1'; $env:OPENROUTER_API_KEY='…'; npm run test:ui:flow
 *
 * Город и все созданные в нём файлы удаляются окончательно в after(), включая
 * папку, в которую API перемещает город при soft-delete.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { Builder, By, until, Select } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { slugify } = require('../lib/parsers');

const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.UI_FLOW_PORT || 3099);
const BASE = `http://127.0.0.1:${PORT}`;
const RUN_ID = Date.now().toString().slice(-8);
const CITY_NAME = `Провероград ${RUN_ID}`;
const CITY = slugify(CITY_NAME);
const CHRONICLE_NAME = `Хроника проверки ${RUN_ID}`;
const CHRONICLE = slugify(CHRONICLE_NAME);
const MODULE_NAME = `Тени теста ${RUN_ID}`;
const MODULE = slugify(MODULE_NAME);
const LIVE_OPENROUTER = process.env.UI_LIVE_OPENROUTER === '1';

const CHARACTERS = [
  { type: 'vampire',  name: `Вампир Тест ${RUN_ID}`,  belonging: 'Персонаж игрока', folder: 'vampires', clan: 'Носферату', sect: 'Камарилья' },
  { type: 'mortal',   name: `Смертный Тест ${RUN_ID}`, belonging: 'Персонаж мастера', folder: 'mortals' },
  { type: 'fairy',    name: `Фея Тест ${RUN_ID}`,     belonging: 'Эпизодический персонаж', folder: 'fairies', seeming: 'Сид' },
  { type: 'werewolf', name: `Волк Тест ${RUN_ID}`,    belonging: 'Персонаж мастера', folder: 'werewolves', tribe: 'Гару Дети Гайи' },
  { type: 'mage',     name: `Маг Тест ${RUN_ID}`,     belonging: 'Персонаж мастера', folder: 'mages', tradition: 'Верителли' },
  { type: 'hunter',   name: `Охотник Тест ${RUN_ID}`, belonging: 'Фамильяр', folder: 'hunters' },
];

let serverProc;
let driver;

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: route, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      if ((await request('GET', '/api/cities')).status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('UI flow server did not start in 20 seconds');
}

async function waitUntil(predicate, timeout = 15000, message = 'condition was not met') {
  await driver.wait(predicate, timeout, message);
}

async function css(selector, timeout = 15000) {
  return driver.wait(until.elementLocated(By.css(selector)), timeout, `нет элемента: ${selector}`);
}

async function id(name, timeout = 15000) {
  return driver.wait(until.elementLocated(By.id(name)), timeout, `нет #${name}`);
}

async function fill(name, value) {
  const el = await id(name);
  await driver.wait(until.elementIsVisible(el), 10000, `#${name} не стал видимым`);
  await el.clear();
  await el.sendKeys(value);
}

async function go(page) {
  await (await css(`.nav-item[data-page="${page}"]`)).click();
  await css(`#page-${page}.page.active`);
}

async function openToolTab(tab) {
  await (await css(`#page-tools .tab-btn[data-tab="${tab}"]`)).click();
  await css(`#page-tools #tab-${tab}.tab-panel.active`);
}

async function waitOutput(name, re, timeout = 20000) {
  await waitUntil(async () => re.test(await (await id(name)).getText()), timeout, `нет ${re} в #${name}`);
}

function removeSoftDeletedCity(movedTo) {
  if (!movedTo) return;
  const citiesRoot = path.resolve(ROOT, 'cities');
  const target = path.resolve(ROOT, movedTo);
  const allowed = path.resolve(citiesRoot, '_deleted');
  const expected = new RegExp(`^${CITY}_[0-9]+$`);
  if (path.dirname(target) !== allowed || !expected.test(path.basename(target))) {
    throw new Error(`Cleanup refused unexpected path: ${movedTo}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

describe('UI — полный изолированный цикл города', { concurrency: false }, () => {
  before(async () => {
    if (LIVE_OPENROUTER && !process.env.OPENROUTER_API_KEY) {
      throw new Error('UI_LIVE_OPENROUTER=1 требует OPENROUTER_API_KEY');
    }

    // Selenium ищет драйвер через PATH; сохраняем его локально в tests/bin.
    process.env.PATH = `${path.join(__dirname, 'bin')};${process.env.PATH}`;
    const serverEnv = { ...process.env, PORT: String(PORT) };
    if (!LIVE_OPENROUTER) serverEnv.AI_MOCK = '1';
    serverProc = spawn('node', [path.join(ROOT, 'web', 'server.js')], {
      cwd: path.join(ROOT, 'web'), env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer();

    const options = new chrome.Options().addArguments(
      '--window-size=1440,1100', '--lang=ru', '--headless=new', '--no-sandbox', '--disable-gpu',
    );
    driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    await driver.manage().setTimeouts({ implicit: 0 });
    await driver.get(BASE);
    await driver.executeScript("localStorage.setItem('sanguine-tour-seen', '1');");
    await driver.executeScript(`localStorage.setItem('ai-feature-prefs', JSON.stringify({ prose: { provider: 'openrouter', model: 'openrouter/free' }, locations: { provider: 'openrouter', model: 'openrouter/free' } }));`);
    // Тур успевает отрисовать backdrop при первом заходе; перезагрузка после
    // записи флага — единственный способ проверить именно обычный UI-flow.
    await driver.get(BASE);
  });

  after(async () => {
    // Сначала используем штатный API, затем окончательно удаляем только его
    // безопасно проверенную soft-delete-папку.
    try {
      const list = await request('GET', '/api/cities');
      if (list.json?.cities?.includes(CITY)) {
        const removed = await request('DELETE', `/api/cities/${encodeURIComponent(CITY)}`);
        assert.equal(removed.status, 200, `cleanup API: ${removed.text}`);
        removeSoftDeletedCity(removed.json?.movedTo);
      }
    } finally {
      if (driver) await driver.quit().catch(() => {});
      if (serverProc && !serverProc.killed) {
        serverProc.kill();
        await new Promise(resolve => serverProc.once('exit', resolve));
      }
    }
  });

  it('создаёт новый город через UI', async () => {
    await go('city-new');
    await (await css('#city-create-spoiler summary')).click();
    await fill('city-name', CITY_NAME);
    await fill('city-year', '2010');
    await fill('city-description', 'Изолированный домен для сквозной UI-проверки.');
    await (await id('btn-new-city')).click();
    await waitOutput('out-new-city', /создан/i);
    assert.ok(fs.existsSync(path.join(ROOT, 'cities', CITY, 'city.md')));
    await driver.get(`${BASE}/?city=${encodeURIComponent(CITY)}`);
    await waitUntil(async () => {
      const sel = new Select(await id('city-select'));
      return (await sel.getFirstSelectedOption().then(o => o.getText())).length > 0;
    });
  });

  it('создаёт локацию в тестовом городе через модалку на странице «Локации»', async () => {
    await go('locations');
    await (await id('loc-page-create-btn')).click();
    await css('#loc-edit-modal.open');
    await fill('loc-edit-name', `Театр проверки ${RUN_ID}`);
    await fill('loc-edit-district', 'Тестовый район');
    await (await id('loc-edit-save-btn')).click();
    await waitUntil(async () => (await driver.findElements(By.css('#loc-edit-modal.open'))).length === 0,
      10000, 'модалка локации не закрылась после сохранения');
    const districtSlug = slugify('Тестовый район');
    const locSlug = slugify(`Театр проверки ${RUN_ID}`);
    assert.ok(fs.existsSync(path.join(ROOT, 'cities', CITY, 'locations', districtSlug, locSlug, `${locSlug}.md`)));
  });

  // Точка входа создания персонажа переехала со вкладки «Инструменты → Новый
  // НПС» (удалена) на модалку «+ Создать» страницы «Персонажи» (#char-modal) —
  // шаг 1 выбор линейки (.lineage-pick-btn), шаг 2 поля по data-param.
  async function fillModalField(param, value) {
    const el = await css(`#modal-fields [data-param="${param}"]`);
    await driver.wait(until.elementIsVisible(el), 10000, `#modal-fields [data-param="${param}"] не стал видимым`);
    const tag = await el.getTagName();
    if (tag === 'select') await new Select(el).selectByValue(value);
    else { await el.clear(); await el.sendKeys(value); }
  }

  for (const character of CHARACTERS) {
    it(`создаёт через UI: ${character.type}`, async () => {
      await go('characters');
      await (await id('btn-open-create-char')).click();
      await css('#char-modal.open');
      // #char-modal — .modal-overlay с CSS-переходом opacity/visibility (~280мс,
      // --dur-base) — класс .open появляется мгновенно, но элемент физически
      // некликабелен, пока переход не завершится (ElementNotInteractableError
      // при клике сразу после .open, воспроизведено вживую).
      const lineageBtn = await css(`.lineage-pick-btn[data-type="${character.type}"]`);
      await driver.wait(until.elementIsVisible(lineageBtn), 10000, 'кнопка выбора линейки не стала видимой');
      await lineageBtn.click();
      await fillModalField('name', character.name);
      await fillModalField('gender', 'Мужской');
      if (character.type === 'vampire') {
        await fillModalField('clan', character.clan);
        await fillModalField('sect', character.sect);
      }
      if (character.type === 'fairy') await fillModalField('seeming', character.seeming);
      if (character.type === 'werewolf') await fillModalField('tribe', character.tribe);
      if (character.type === 'mage') await fillModalField('tradition', character.tradition);
      await fillModalField('belonging', character.belonging);
      await (await id('modal-submit')).click();
      await waitOutput('modal-output', /создан/i);
      const slug = slugify(character.name);
      assert.ok(fs.existsSync(path.join(ROOT, 'cities', CITY, 'characters', character.folder, slug, `${slug}.md`)));
      // Модалка автозакрывается через ~900мс после успеха — дожидаемся перед
      // следующей итерацией, иначе следующий клик «+ Создать» может попасть
      // в ещё открытую модалку прошлого персонажа.
      await waitUntil(async () => (await driver.findElements(By.css('#char-modal.open'))).length === 0,
        3000, 'модалка создания не закрылась автоматически после успеха');
    });
  }

  it('создаёт хронику и модуль с участниками через UI', async () => {
    await go('chronicles-page');
    await (await id('btn-create-chronicle')).click();
    await fill('chr-create-name', CHRONICLE_NAME);
    await fill('chr-create-mood', 'Тестовая интрига');
    await (await id('chr-create-submit')).click();
    await waitUntil(async () => (await driver.findElements(By.css(`.chp-card[data-slug="${CHRONICLE}"]`))).length === 1, 15000, 'карточка хроники не появилась');

    await go('modules');
    await (await id('btn-create-module-standalone')).click();
    await new Select(await id('mod-create-chr')).selectByValue(CHRONICLE);
    await fill('mod-create-name', MODULE_NAME);
    await fill('mod-create-time', 'Декабрь 2010, пятница');
    await fill('mod-create-content', 'Исчезновение курьера приводит котерию в театр, где старый долг становится угрозой Маскараду.');
    await fill('mod-create-pc-input', CHARACTERS[0].name);
    await (await id('mod-create-add-pc')).click();
    await fill('mod-create-npc-input', CHARACTERS[1].name);
    await (await id('mod-create-add-npc')).click();
    await (await id('mod-create-submit')).click();
    await waitUntil(async () => (await driver.findElements(By.css(`.module-card[data-name="${MODULE}"]`))).length === 1, 15000, 'карточка модуля не появилась');
  });

  it('генерирует сценарий модуля через выбранный OpenRouter-поток и открывает его в UI', async () => {
    await (await css(`.module-card[data-name="${MODULE}"]`)).click();
    await css('#page-module.page.active');
    await (await id('modp-gen-btn')).click();
    await waitUntil(async () => {
      const result = await id('modp-gen-result');
      return /Сгенерировано/.test(await result.getText());
    }, LIVE_OPENROUTER ? 120000 : 30000, 'сценарий не был сгенерирован');
    await (await css('.modp-tab[data-modtab="scenario"]')).click();
    await css('#modp-panel-scenario.active');
    await waitUntil(async () => /Сцена|GM-справка/.test(await (await id('modp-panel-scenario')).getText()), 15000, 'сценарий не отрендерился');

    const detail = await request('GET', `/api/chronicles/${encodeURIComponent(CHRONICLE)}/modules/${encodeURIComponent(MODULE)}/detail?city=${encodeURIComponent(CITY)}`);
    assert.equal(detail.status, 200);
    assert.ok(detail.json?.scenario, 'API detail не содержит сценарий');
  });

  it('покрывает все созданные сущности в API перед очисткой', async () => {
    const chars = await request('GET', `/api/characters?city=${encodeURIComponent(CITY)}`);
    assert.equal(chars.status, 200);
    for (const expected of CHARACTERS) {
      assert.ok(chars.json.some(item => item.name === expected.name && item.lineage === expected.type), `нет ${expected.type}: ${expected.name}`);
    }
    const locations = await request('GET', `/api/locations?city=${encodeURIComponent(CITY)}`);
    assert.equal(locations.status, 200);
    assert.ok(locations.json.some(item => item.title && item.title.includes(`Театр проверки ${RUN_ID}`)));
  });
});
