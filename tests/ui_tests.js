/**
 * VTM Chronicle Manager — Selenium UI-тесты
 *
 * Запуск:  node tests/ui_tests.js
 *          или через  tests/run_ui_tests.bat
 *
 * Требования:
 *   - Google Chrome установлен
 *   - selenium-webdriver установлен (npm install в папке tests/)
 *   - Selenium Manager автоматически скачивает ChromeDriver
 *
 * Отчёт: tests/ui_report.html
 */

'use strict';

const { Builder, By, until } = require('selenium-webdriver');
const chrome  = require('selenium-webdriver/chrome');
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');

const BASE   = 'http://localhost:3000';
const ROOT   = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'web', 'server.js');
const WAIT   = 8000;
const W      = process.stdout.columns || 80;

// ── Мини-фреймворк (тот же стиль что у run_tests.js) ─────────────────────────

const GROUPS  = [];
let _group    = null;
let _totalRun = 0;
let _pass     = 0;
let _fail     = 0;

function bar(done, total, width) {
  width = width || 24;
  var filled = total ? Math.round(done / total * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function clearLine() { process.stdout.write('\r\x1b[K'); }

function printGroupHeader(g) {
  var line = '\n  ┌─ ' + g.title;
  if (g.desc) line += '\n  │  \x1b[2m' + g.desc + '\x1b[0m';
  line += '\n  └──────────────────────────────';
  process.stdout.write(line + '\n');
}

function printGroupFooter(g) {
  var gPass = g.tests.filter(function(t) { return t.status === 'PASS'; }).length;
  var gFail = g.tests.filter(function(t) { return t.status === 'FAIL'; }).length;
  var n     = g.tests.length;
  if (!n) return;
  var pct   = Math.round(gPass / n * 100);
  var icon  = gFail ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
  var color = gFail ? '\x1b[31m' : '\x1b[32m';
  var b     = bar(gPass, n, 20);
  process.stdout.write(
    '  ' + icon + '  ' + color + b + '\x1b[0m'
    + '  ' + gPass + '/' + n
    + (gFail ? '  \x1b[31m(' + gFail + ' упало)\x1b[0m' : '  \x1b[32m' + pct + '%\x1b[0m')
    + '\n'
  );
}

function group(title, desc) {
  if (_group && _group.tests.length) printGroupFooter(_group);
  _group = { title, desc, tests: [] };
  GROUPS.push(_group);
  printGroupHeader(_group);
}

async function t(name, desc, fn) {
  _totalRun++;
  var idx    = _totalRun;
  var prefix = '\x1b[2m[' + String(idx).padStart(2) + ']\x1b[0m ';
  process.stdout.write('  ' + prefix + '\x1b[33m⟳\x1b[0m  ' + name.slice(0, W - 12));
  const entry = { name, desc, status: 'PASS', error: null };
  try {
    await fn();
    _pass++;
    clearLine();
    process.stdout.write('  ' + prefix + '\x1b[32m✓\x1b[0m  ' + name + '\n');
  } catch (e) {
    _fail++;
    entry.status = 'FAIL';
    entry.error  = e.message || String(e);
    clearLine();
    process.stdout.write('  ' + prefix + '\x1b[31m✗\x1b[0m  ' + name + '\n');
    process.stdout.write('        \x1b[31m' + entry.error.slice(0, 120) + '\x1b[0m\n');
  }
  var overallBar = bar(_pass + _fail, _totalRun, 30);
  process.stdout.write('\r  \x1b[2m' + overallBar + '  ' + (_pass + _fail) + ' / ' + _totalRun
    + '   \x1b[32m✓' + _pass + '\x1b[0m\x1b[2m  \x1b[31m✗' + _fail + '\x1b[0m');
  _group.tests.push(entry);
}

// ── Selenium-хелперы ──────────────────────────────────────────────────────────

// Ждём пока спиннер исчезнет из контейнера
async function waitForNoSpinner(driver, containerId, timeout) {
  await driver.wait(async () => {
    const spinners = await driver.findElements(By.css('#' + containerId + ' .spinner'));
    return spinners.length === 0;
  }, timeout || WAIT, 'Spinner in #' + containerId + ' did not disappear');
}

// Переходим по навигации и ждём активации нужной страницы
async function navTo(driver, page) {
  const link = await driver.findElement(By.css('[data-page="' + page + '"]'));
  await link.click();
  await driver.wait(until.elementLocated(By.css('#page-' + page + '.active')), WAIT,
    'Page #page-' + page + ' did not become active');
}

// Ждём пока модальное окно станет видимым
async function waitModalVisible(driver, modalId) {
  const modal = await driver.findElement(By.id(modalId));
  await driver.wait(async () => {
    try { return await modal.isDisplayed(); } catch { return false; }
  }, WAIT, 'Modal #' + modalId + ' did not open');
  return modal;
}

// Ждём пока модальное окно скроется
async function waitModalHidden(driver, modalId) {
  const modal = await driver.findElement(By.id(modalId));
  await driver.wait(async () => {
    try { return !(await modal.isDisplayed()); } catch { return true; }
  }, WAIT, 'Modal #' + modalId + ' did not close');
}

// Считаем видимые элементы через JS (обходит display:none)
async function countVisible(driver, selector) {
  return driver.executeScript(function(sel) {
    return Array.from(document.querySelectorAll(sel))
      .filter(function(el) { return getComputedStyle(el).display !== 'none'; }).length;
  }, selector);
}

// ── Управление сервером ───────────────────────────────────────────────────────

function serverIsUp() {
  return new Promise(resolve => {
    http.get(BASE + '/api/status', res => { res.resume(); resolve(true); })
      .on('error', () => resolve(false));
  });
}

function waitForServer(ms) {
  ms = ms || 15000;
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function probe() {
      http.get(BASE + '/api/status', res => { res.resume(); resolve(); })
        .on('error', function() {
          if (Date.now() - t0 > ms) reject(new Error('Server did not start in ' + ms + 'ms'));
          else setTimeout(probe, 300);
        });
    })();
  });
}

// ── HTML-отчёт ────────────────────────────────────────────────────────────────

function buildReport(groups, totalPass, totalFail, totalRun, elapsed) {
  var stamp    = new Date().toLocaleString('ru-RU', { hour12: false });
  var allGreen = totalFail === 0;
  var pct      = totalRun ? Math.round(totalPass / totalRun * 100) : 0;

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  function renderRows(tests) {
    if (!tests.length) return '<tr><td colspan="3" class="skip-row">Нет тестов</td></tr>';
    return tests.map(function(tt) {
      var cls  = tt.status === 'PASS' ? 'pass' : 'fail';
      var icon = tt.status === 'PASS' ? '&#10003;' : '&#10007;';
      var err  = tt.error
        ? '<div class="err-msg">' + esc(tt.error.slice(0, 300)) + '</div>'
        : '';
      return '<tr class="row-' + cls + '">'
        + '<td class="col-status"><span class="badge-' + cls + '">' + icon + '</span></td>'
        + '<td class="col-name">' + esc(tt.name) + err + '</td>'
        + '<td class="col-desc">' + esc(tt.desc) + '</td>'
        + '</tr>';
    }).join('');
  }

  var groupsHtml = groups.map(function(g) {
    var gPass = g.tests.filter(function(t) { return t.status === 'PASS'; }).length;
    var gFail = g.tests.filter(function(t) { return t.status === 'FAIL'; }).length;
    var gPct  = g.tests.length ? Math.round(gPass / g.tests.length * 100) : 0;
    var gcls  = gFail > 0 ? 'group-fail' : 'group-pass';
    return '<section class="group ' + gcls + '">'
      + '<div class="group-header">'
      +   '<div class="group-title">' + esc(g.title) + '</div>'
      +   '<div class="group-meta">'
      +     '<span class="group-desc">' + esc(g.desc) + '</span>'
      +     '<div class="group-stats">'
      +       '<span class="gs-pass">' + gPass + ' прошли</span>'
      +       (gFail ? '<span class="gs-fail">' + gFail + ' упали</span>' : '')
      +       '<div class="mini-bar"><div class="mini-fill" style="width:' + gPct + '%"></div></div>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<table class="test-table"><thead><tr>'
      +   '<th class="col-status">Статус</th>'
      +   '<th class="col-name">Тест</th>'
      +   '<th class="col-desc">Что проверяет</th>'
      + '</tr></thead><tbody>'
      + renderRows(g.tests)
      + '</tbody></table></section>';
  }).join('');

  var css = ':root{'
    + '--bg:#07050a;--bg2:#0d0a10;--bg3:#120f18;--bg4:#181420;'
    + '--red:#8B0000;--red2:#B80000;--red3:#CC2200;'
    + '--gold:#B8860B;'
    + '--green:#1a5c1a;--green2:#2d8c2d;--green3:#4CAF50;'
    + '--text:#E8E0D0;--text2:#a89880;--text3:#5a5050;'
    + '--border:rgba(139,0,0,.22);--border2:rgba(180,20,0,.4);'
    + '--fh:"Cinzel",serif;--fb:"Cormorant Garamond",Georgia,serif;--fm:"Share Tech Mono","Courier New",monospace;'
    + '}'
    + '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}'
    + 'body{background:var(--bg);color:var(--text);font-family:var(--fb);font-size:16px;line-height:1.6}'
    + '::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:var(--bg2)}::-webkit-scrollbar-thumb{background:var(--red);border-radius:3px}'
    + '.header{background:var(--bg2);border-bottom:2px solid var(--border2);padding:40px 48px 32px;position:relative;overflow:hidden}'
    + '.header::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(139,0,0,.18) 0%,transparent 70%);pointer-events:none}'
    + '.header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:32px;margin-bottom:32px}'
    + '.logo{display:flex;flex-direction:column;gap:4px}'
    + '.logo-drop{font-size:11px;color:var(--text3);font-family:var(--fm);letter-spacing:.1em;text-transform:uppercase}'
    + '.logo-title{font-family:var(--fh);font-size:28px;font-weight:700;color:var(--text);letter-spacing:.18em;text-transform:uppercase}'
    + '.logo-sub{font-family:var(--fh);font-size:12px;color:var(--text3);letter-spacing:.22em;text-transform:uppercase;margin-top:2px}'
    + '.stamp{font-family:var(--fm);font-size:12px;color:var(--text3);text-align:right;line-height:1.8}'
    + '.badge-mode{display:inline-block;margin-top:8px;padding:3px 10px;background:rgba(90,80,80,.2);border:1px solid var(--border);border-radius:3px;font-family:var(--fm);font-size:10px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase}'
    + '.status-banner{display:flex;align-items:center;gap:20px;padding:20px 28px;border-radius:6px;border:1px solid}'
    + '.status-banner.all-pass{background:rgba(26,92,26,.15);border-color:rgba(76,175,80,.35)}'
    + '.status-banner.has-fail{background:rgba(139,0,0,.15);border-color:rgba(180,20,0,.45)}'
    + '.status-icon{font-size:36px;flex-shrink:0}'
    + '.status-text{flex:1}'
    + '.status-headline{font-family:var(--fh);font-size:18px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px}'
    + '.all-pass .status-headline{color:var(--green3)}.has-fail .status-headline{color:#ff6b6b}'
    + '.status-sub{font-family:var(--fm);font-size:12px;color:var(--text2)}'
    + '.stats-row{display:flex;gap:16px;margin-top:28px}'
    + '.stat{flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:20px 16px;text-align:center;position:relative;overflow:hidden}'
    + '.stat::after{content:"";position:absolute;top:0;left:0;right:0;height:2px}'
    + '.stat-pass::after{background:linear-gradient(90deg,var(--green3),transparent)}'
    + '.stat-fail::after{background:linear-gradient(90deg,var(--red2),transparent)}'
    + '.stat-total::after{background:linear-gradient(90deg,var(--text3),transparent)}'
    + '.stat-time::after{background:linear-gradient(90deg,var(--gold),transparent)}'
    + '.stat-num{font-family:var(--fh);font-size:48px;font-weight:700;line-height:1}'
    + '.stat-pass .stat-num{color:var(--green3)}.stat-fail .stat-num{color:#ff6b6b}'
    + '.stat-total .stat-num{color:var(--text2)}.stat-time .stat-num{color:var(--gold);font-size:32px}'
    + '.stat-lbl{font-family:var(--fh);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--text3);margin-top:6px}'
    + '.progress-wrap{margin-top:28px}'
    + '.progress-label{display:flex;justify-content:space-between;font-family:var(--fm);font-size:11px;color:var(--text3);margin-bottom:6px}'
    + '.progress-track{height:8px;background:var(--bg4);border-radius:4px;overflow:hidden;border:1px solid var(--border)}'
    + '.progress-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--green2),var(--green3))}'
    + '.progress-fill.fail{background:linear-gradient(90deg,var(--red),var(--red3))}'
    + '.main{max-width:1200px;margin:0 auto;padding:40px 48px}'
    + '.group{margin-bottom:36px;border:1px solid var(--border);border-radius:8px;overflow:hidden}'
    + '.group-header{padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px}'
    + '.group-pass .group-header{background:rgba(26,92,26,.08);border-bottom:1px solid rgba(76,175,80,.18)}'
    + '.group-fail .group-header{background:rgba(139,0,0,.12);border-bottom:1px solid rgba(180,20,0,.3)}'
    + '.group-title{font-family:var(--fh);font-size:16px;font-weight:600;letter-spacing:.1em;color:var(--text)}'
    + '.group-meta{flex:1;display:flex;flex-direction:column;gap:6px;align-items:flex-end}'
    + '.group-desc{font-size:13px;color:var(--text3);font-style:italic;text-align:right}'
    + '.group-stats{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}'
    + '.gs-pass{font-family:var(--fm);font-size:11px;color:var(--green3)}'
    + '.gs-fail{font-family:var(--fm);font-size:11px;color:#ff6b6b}'
    + '.mini-bar{width:80px;height:5px;background:var(--bg4);border-radius:3px;overflow:hidden;border:1px solid var(--border)}'
    + '.mini-fill{height:100%;background:var(--green3)}'
    + '.group-fail .mini-fill{background:var(--red2)}'
    + '.test-table{width:100%;border-collapse:collapse}'
    + '.test-table th{padding:10px 16px;text-align:left;font-family:var(--fh);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--text3);background:var(--bg3);border-bottom:1px solid var(--border)}'
    + '.test-table td{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top}'
    + '.row-pass:hover td{background:rgba(255,255,255,.02)}.row-fail td{background:rgba(139,0,0,.06)}'
    + '.col-status{width:56px;text-align:center}'
    + '.col-name{font-family:var(--fm);font-size:13px;color:var(--text);width:38%}'
    + '.col-desc{font-size:13px;color:var(--text2);font-style:italic}'
    + '.badge-pass{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:rgba(76,175,80,.15);border:1px solid rgba(76,175,80,.4);color:var(--green3);font-size:14px;font-weight:700}'
    + '.badge-fail{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:rgba(139,0,0,.2);border:1px solid rgba(180,20,0,.5);color:#ff6b6b;font-size:14px;font-weight:700}'
    + '.err-msg{margin-top:6px;padding:8px 12px;background:rgba(139,0,0,.15);border-left:3px solid var(--red2);border-radius:0 4px 4px 0;font-family:var(--fm);font-size:11px;color:#ff9999;line-height:1.5}'
    + '.footer{text-align:center;padding:32px 48px;border-top:1px solid var(--border);font-family:var(--fm);font-size:11px;color:var(--text3)}';

  return '<!DOCTYPE html>\n<html lang="ru">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<title>VTM — UI-отчёт</title>\n'
    + '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,400&family=Share+Tech+Mono&display=swap" rel="stylesheet">\n'
    + '<style>' + css + '</style>\n'
    + '</head>\n<body>\n'
    + '<header class="header">\n'
    + '  <div class="header-top">\n'
    + '    <div class="logo">\n'
    + '      <span class="logo-drop">&#129752; Vampire: The Masquerade</span>\n'
    + '      <div class="logo-title">VTM Chronicle Manager</div>\n'
    + '      <div class="logo-sub">UI-отчёт · Selenium</div>\n'
    + '    </div>\n'
    + '    <div class="stamp">&#128197; ' + esc(stamp) + '<br>tests/ui_tests.js<br>' + totalRun + ' тестов · ' + elapsed + 's<br>'
    + '      <span class="badge-mode">Headless Chrome</span></div>\n'
    + '  </div>\n'
    + '  <div class="status-banner ' + (allGreen ? 'all-pass' : 'has-fail') + '">\n'
    + '    <div class="status-icon">' + (allGreen ? '&#129001;' : '&#128308;') + '</div>\n'
    + '    <div class="status-text">\n'
    + '      <div class="status-headline">' + (allGreen ? 'Все UI-тесты прошли успешно' : 'Есть упавшие тесты: ' + totalFail) + '</div>\n'
    + '      <div class="status-sub">' + totalPass + ' прошли &nbsp;&middot;&nbsp; ' + totalFail + ' упали &nbsp;&middot;&nbsp; ' + totalRun + ' всего</div>\n'
    + '    </div>\n'
    + '  </div>\n'
    + '  <div class="stats-row">\n'
    + '    <div class="stat stat-pass"><div class="stat-num">' + totalPass + '</div><div class="stat-lbl">Прошли</div></div>\n'
    + '    <div class="stat stat-fail"><div class="stat-num">' + totalFail + '</div><div class="stat-lbl">Упали</div></div>\n'
    + '    <div class="stat stat-total"><div class="stat-num">' + totalRun + '</div><div class="stat-lbl">Всего</div></div>\n'
    + '    <div class="stat stat-time"><div class="stat-num">' + elapsed + 's</div><div class="stat-lbl">Время</div></div>\n'
    + '  </div>\n'
    + '  <div class="progress-wrap">\n'
    + '    <div class="progress-label"><span>Прогресс</span><span>' + pct + '%</span></div>\n'
    + '    <div class="progress-track"><div class="progress-fill ' + (allGreen ? '' : 'fail') + '" style="width:' + pct + '%"></div></div>\n'
    + '  </div>\n'
    + '</header>\n'
    + '<main class="main">\n' + groupsHtml + '</main>\n'
    + '<footer class="footer">Selenium WebDriver · Headless Chrome · ' + esc(stamp) + '</footer>\n'
    + '</body>\n</html>';
}

// ═════════════════════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  var hr = '═'.repeat(54);
  process.stdout.write('\n\x1b[1m' + hr + '\x1b[0m\n');
  process.stdout.write('  \x1b[31m🩸\x1b[0m  \x1b[1mVTM Chronicle Manager\x1b[0m — UI-тесты\n');
  process.stdout.write('  \x1b[2mSelenium WebDriver · Headless Chrome\x1b[0m\n');
  process.stdout.write('  ' + new Date().toLocaleString('ru-RU', { hour12: false }) + '\n');
  process.stdout.write('\x1b[1m' + hr + '\x1b[0m\n');

  // Запускаем сервер если нужно
  let serverProc = null;
  const isUp = await serverIsUp();
  if (!isUp) {
    process.stdout.write('\n  \x1b[33m⟳\x1b[0m  Запуск веб-сервера на порту 3000...\n');
    serverProc = spawn(process.execPath, [SERVER], {
      env: Object.assign({}, process.env, { PORT: '3000' }),
      stdio: 'ignore',
    });
    try {
      await waitForServer(15000);
      process.stdout.write('  \x1b[32m✓\x1b[0m  Сервер запущен\n');
    } catch (e) {
      process.stdout.write('  \x1b[31m✗\x1b[0m  ' + e.message + '\n');
      process.exit(1);
    }
  } else {
    process.stdout.write('\n  \x1b[32m✓\x1b[0m  Сервер уже запущен на порту 3000\n');
  }

  // Строим драйвер
  process.stdout.write('  \x1b[33m⟳\x1b[0m  Запуск Chrome (headless)...\n');
  const options = new chrome.Options();
  options.addArguments(
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1400,900',
    '--lang=ru-RU'
  );

  let driver;
  try {
    driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  } catch (e) {
    process.stdout.write('  \x1b[31m✗\x1b[0m  Chrome не запустился: ' + e.message + '\n');
    if (serverProc) serverProc.kill();
    process.exit(1);
  }
  process.stdout.write('  \x1b[32m✓\x1b[0m  Chrome запущен\n');

  const t0 = Date.now();

  try {

    // ── ГРУППА 1: Загрузка приложения ─────────────────────────────────────────
    group('Загрузка приложения', 'Базовые проверки запуска SPA и начального рендеринга');

    await t('Приложение открывается', 'GET / не выбрасывает исключений',
      async () => {
        await driver.get(BASE);
      });

    await t('Заголовок страницы', 'document.title содержит "VTM"',
      async () => {
        const title = await driver.getTitle();
        if (!title.includes('VTM')) throw new Error('Title: "' + title + '"');
      });

    await t('Логотип отображается', '.sidebar-logo виден в DOM',
      async () => {
        const el = await driver.findElement(By.css('.sidebar-logo'));
        if (!(await el.isDisplayed())) throw new Error('Logo not visible');
      });

    await t('8 пунктов навигации', '.nav-item — 8 элементов',
      async () => {
        const items = await driver.findElements(By.css('.nav-item'));
        if (items.length < 8) throw new Error('nav-item: ' + items.length + ', expected 8');
      });

    await t('Панель активна по умолчанию', '#page-dashboard имеет класс active',
      async () => {
        await driver.findElement(By.css('#page-dashboard.active'));
      });

    // ── ГРУППА 2: Навигация ────────────────────────────────────────────────────
    group('Навигация', 'Переключение разделов через сайдбар');

    const navPages = [
      ['characters', 'Персонажи'],
      ['graph',      'Граф связей'],
      ['modules',    'Модули'],
      ['threads',    'Нити'],
      ['locations',  'Локации'],
      ['tools',      'Инструменты'],
      ['dashboard',  'Панель'],
    ];

    for (const [page, label] of navPages) {
      await t('Переход: ' + label, 'Клик nav → #page-' + page + '.active',
        async () => { await navTo(driver, page); });
    }

    // ── ГРУППА 3: Панель управления ────────────────────────────────────────────
    group('Панель управления', 'Загрузка статистики хроники');

    await driver.get(BASE);

    await t('Данные загрузились', 'Спиннер в #dash-content исчез',
      async () => { await waitForNoSpinner(driver, 'dash-content', 10000); });

    await t('Карточки статистики', 'Минимум 3 элемента .stat-card',
      async () => {
        await driver.wait(until.elementLocated(By.css('.stat-card')), WAIT);
        const cards = await driver.findElements(By.css('.stat-card'));
        if (cards.length < 3) throw new Error('stat-card: ' + cards.length);
      });

    await t('Нет сообщения об ошибке', '.error-state не видна',
      async () => {
        const errors = await driver.findElements(By.css('.error-state'));
        for (const el of errors) {
          if (await el.isDisplayed()) throw new Error('Error state visible on dashboard');
        }
      });

    // ── ГРУППА 4: Персонажи ────────────────────────────────────────────────────
    group('Персонажи', 'Грид персонажей, фильтры, поиск');

    await navTo(driver, 'characters');

    await t('Грид загружается', 'Спиннер в #chars-grid исчез',
      async () => { await waitForNoSpinner(driver, 'chars-grid', 10000); });

    await t('Карточки персонажей присутствуют', 'Минимум 1 .char-card в гриде',
      async () => {
        await driver.wait(until.elementLocated(By.css('.char-card')), WAIT);
        const cards = await driver.findElements(By.css('.char-card'));
        if (!cards.length) throw new Error('No .char-card elements');
      });

    await t('Поиск фильтрует список', 'Нулевой запрос убирает карточки',
      async () => {
        // Сначала сбрасываем в чистое состояние через JS-событие
        await driver.executeScript(
          'var el=document.getElementById("search-input");' +
          'el.value="";el.dispatchEvent(new Event("input",{bubbles:true}));'
        );
        await driver.sleep(300);
        const totalBefore = await countVisible(driver, '.char-card');
        // Вводим несуществующее имя через JS чтобы гарантированно сработал input-event
        await driver.executeScript(
          'var el=document.getElementById("search-input");' +
          'el.value="zzznonsense999";el.dispatchEvent(new Event("input",{bubbles:true}));'
        );
        await driver.sleep(500);
        const totalAfter = await countVisible(driver, '.char-card');
        // Сбрасываем
        await driver.executeScript(
          'var el=document.getElementById("search-input");' +
          'el.value="";el.dispatchEvent(new Event("input",{bubbles:true}));'
        );
        await driver.sleep(300);
        if (totalAfter >= totalBefore) throw new Error('Filter did not reduce cards: before=' + totalBefore + ' after=' + totalAfter);
      });

    await t('Сброс поиска восстанавливает список', 'После очистки карточки снова видны',
      async () => {
        // Вводим фильтр и потом очищаем
        await driver.executeScript(
          'var el=document.getElementById("search-input");' +
          'el.value="zzznonsense999";el.dispatchEvent(new Event("input",{bubbles:true}));'
        );
        await driver.sleep(300);
        await driver.executeScript(
          'var el=document.getElementById("search-input");' +
          'el.value="";el.dispatchEvent(new Event("input",{bubbles:true}));'
        );
        await driver.sleep(400);
        const total = await countVisible(driver, '.char-card');
        if (total === 0) throw new Error('No cards visible after clearing search');
      });

    await t('Фильтр по линейке работает', 'Выбор "vampire" меняет набор карточек',
      async () => {
        const totalAll = await countVisible(driver, '.char-card');
        // Меняем значение select через JS и диспатчим change-событие
        await driver.executeScript(
          'var sel=document.getElementById("filter-lineage");' +
          'sel.value="vampire";sel.dispatchEvent(new Event("change",{bubbles:true}));'
        );
        await driver.sleep(500);
        const totalVamp = await countVisible(driver, '.char-card');
        // Сбрасываем
        await driver.executeScript(
          'var sel=document.getElementById("filter-lineage");' +
          'sel.value="all";sel.dispatchEvent(new Event("change",{bubbles:true}));'
        );
        await driver.sleep(300);
        if (totalVamp === totalAll) throw new Error('Filter had no effect: ' + totalAll + ' → ' + totalVamp);
      });

    await t('Кнопка "+ Создать" отображается', '#btn-open-create-char видна и кликабельна',
      async () => {
        const btn = await driver.findElement(By.id('btn-open-create-char'));
        if (!(await btn.isDisplayed())) throw new Error('Create button not visible');
      });

    // ── ГРУППА 5: Модал создания персонажа ────────────────────────────────────
    group('Модал создания персонажа', 'Двухшаговый флоу — выбор линейки, поля, закрытие');

    await t('Открытие модала', 'Клик "+ Создать" → #char-modal видим',
      async () => {
        const btn = await driver.findElement(By.id('btn-open-create-char'));
        await btn.click();
        await waitModalVisible(driver, 'char-modal');
      });

    await t('Шаг 1: 6 кнопок линеек', '.lineage-pick-btn × 6',
      async () => {
        const btns = await driver.findElements(By.css('.lineage-pick-btn'));
        if (btns.length < 6) throw new Error('lineage-pick-btn: ' + btns.length);
      });

    await t('Переход к шагу 2 (Вампир)', 'Клик [data-type=vampire] → #modal-s2 виден',
      async () => {
        const vBtn = await driver.findElement(By.css('[data-type="vampire"]'));
        await vBtn.click();
        await driver.wait(async () => {
          const s2 = await driver.findElement(By.id('modal-s2'));
          return s2.isDisplayed();
        }, WAIT, '#modal-s2 not visible after clicking Vampire');
      });

    await t('Кнопка "Назад" возвращает на шаг 1', 'Клик #modal-back → #modal-s1 снова виден',
      async () => {
        const back = await driver.findElement(By.id('modal-back'));
        await back.click();
        await driver.wait(async () => {
          const s1 = await driver.findElement(By.id('modal-s1'));
          return s1.isDisplayed();
        }, WAIT, '#modal-s1 not visible after Back');
      });

    await t('Закрытие модала (✕)', 'Клик #modal-close → модал скрыт',
      async () => {
        const closeBtn = await driver.findElement(By.id('modal-close'));
        await closeBtn.click();
        await waitModalHidden(driver, 'char-modal');
      });

    // ── ГРУППА 6: Граф отношений ───────────────────────────────────────────────
    group('Граф отношений', 'D3.js SVG граф: рендеринг, тулбар, узлы');

    await navTo(driver, 'graph');

    await t('SVG элемент присутствует', '#graph-svg видим на странице',
      async () => {
        const svg = await driver.findElement(By.id('graph-svg'));
        if (!(await svg.isDisplayed())) throw new Error('graph-svg not visible');
      });

    await t('Кнопки управления графом', '#graph-toolbar содержит 3 .btn-icon',
      async () => {
        const btns = await driver.findElements(By.css('#graph-toolbar .btn-icon'));
        if (btns.length < 3) throw new Error('btn-icon: ' + btns.length + ', expected 3');
      });

    await t('Узлы графа отрисованы', 'SVG содержит circle-элементы',
      async () => {
        await driver.wait(async () => {
          const nodes = await driver.findElements(By.css('#graph-svg circle'));
          return nodes.length > 0;
        }, 12000, 'Graph SVG: no circle elements after 12s');
        const nodes = await driver.findElements(By.css('#graph-svg circle'));
        if (!nodes.length) throw new Error('No circle nodes in SVG');
      });

    // ── ГРУППА 7: Инструменты ─────────────────────────────────────────────────
    group('Инструменты', 'Вкладки форм: домен, НПС, модуль, проверка ссылок');

    await navTo(driver, 'tools');

    await t('Вкладка "Новый домен" активна', '#tab-new-city.active существует',
      async () => {
        await driver.findElement(By.css('#tab-new-city.active'));
      });

    await t('Поля формы домена присутствуют', '#city-name и #city-year в DOM',
      async () => {
        await driver.findElement(By.id('city-name'));
        await driver.findElement(By.id('city-year'));
      });

    await t('Переключение → Новый НПС', 'Клик [data-tab=new-npc] → #tab-new-npc.active',
      async () => {
        const tab = await driver.findElement(By.css('[data-tab="new-npc"]'));
        await tab.click();
        await driver.wait(until.elementLocated(By.css('#tab-new-npc.active')), WAIT,
          '#tab-new-npc not active');
      });

    await t('Поле имени НПС присутствует', '#npc-name видно и доступно',
      async () => {
        const el = await driver.findElement(By.id('npc-name'));
        if (!(await el.isDisplayed())) throw new Error('#npc-name not visible');
      });

    await t('Переключение → Проверка ссылок', 'Клик [data-tab=validate] → #tab-validate.active',
      async () => {
        const tab = await driver.findElement(By.css('[data-tab="validate"]'));
        await tab.click();
        await driver.wait(until.elementLocated(By.css('#tab-validate.active')), WAIT,
          '#tab-validate not active');
      });

    await t('Кнопка "Проверить" присутствует', '#btn-validate видна',
      async () => {
        const btn = await driver.findElement(By.id('btn-validate'));
        if (!(await btn.isDisplayed())) throw new Error('#btn-validate not visible');
      });

    // ── ГРУППА 8: Детальный просмотр персонажа ────────────────────────────────
    group('Детальный просмотр персонажа', 'Открытие карточки, содержимое, закрытие');

    await navTo(driver, 'characters');
    await waitForNoSpinner(driver, 'chars-grid', 10000);
    // Сбрасываем все фильтры (могли остаться от предыдущих тестов)
    await driver.executeScript(
      'var s=document.getElementById("search-input");' +
      'if(s){s.value="";s.dispatchEvent(new Event("input",{bubbles:true}));}' +
      'var l=document.getElementById("filter-lineage");' +
      'if(l){l.value="all";l.dispatchEvent(new Event("change",{bubbles:true}));}'
    );
    await driver.sleep(400);
    await driver.wait(until.elementLocated(By.css('.char-card')), WAIT, 'No char-cards after resetting filters');

    await t('Клик карточки открывает модал', 'Первый .char-card → #char-detail-modal виден',
      async () => {
        const cards = await driver.findElements(By.css('.char-card'));
        if (!cards.length) throw new Error('No char-cards to click');
        await cards[0].click();
        await waitModalVisible(driver, 'char-detail-modal');
      });

    await t('Содержимое модала не пустое', '#char-detail-content содержит текст',
      async () => {
        const content = await driver.findElement(By.id('char-detail-content'));
        const text = await content.getText();
        if (!text.trim()) throw new Error('char-detail-content is empty');
      });

    await t('Закрытие детального модала', 'Клик #char-detail-close → модал скрыт',
      async () => {
        // Используем JS-клик: кнопка может перекрываться скролл-контейнером
        await driver.executeScript('document.getElementById("char-detail-close").click();');
        await waitModalHidden(driver, 'char-detail-modal');
      });

  } finally {
    await driver.quit().catch(() => {});
    if (serverProc) serverProc.kill();
  }

  // Закрываем последнюю группу
  if (_group && _group.tests.length) { clearLine(); printGroupFooter(_group); }

  // Финальный итог
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const total   = _pass + _fail;
  const pct     = total ? Math.round(_pass / total * 100) : 0;
  const allGreen = _fail === 0;
  const hr2      = '═'.repeat(54);
  const finalColor = allGreen ? '\x1b[32m' : '\x1b[31m';
  const badge      = allGreen ? 'ВСЕ UI-ТЕСТЫ ПРОШЛИ' : 'ЕСТЬ ОШИБКИ: ' + _fail;
  const finalBar   = bar(_pass, total, 40);

  process.stdout.write('\n\x1b[1m' + hr2 + '\x1b[0m\n');
  process.stdout.write('  \x1b[1m' + finalColor + badge + '\x1b[0m\n');
  process.stdout.write('  ' + finalColor + finalBar + '\x1b[0m  ' + pct + '%\n');
  process.stdout.write(
    '  \x1b[32m✓ ' + _pass + ' прошло\x1b[0m'
    + '   \x1b[31m✗ ' + _fail + ' упало\x1b[0m'
    + '   \x1b[2m' + total + ' всего  ' + elapsed + 's\x1b[0m\n'
  );

  const reportPath = path.join(__dirname, 'ui_report.html');
  fs.writeFileSync(reportPath, buildReport(GROUPS, _pass, _fail, total, elapsed), 'utf-8');
  process.stdout.write('  \x1b[2mОтчёт: tests/ui_report.html\x1b[0m\n');
  process.stdout.write('\x1b[1m' + hr2 + '\x1b[0m\n\n');

  process.exit(_fail > 0 ? 1 : 0);
}

main().catch(function(e) {
  process.stdout.write('\n\x1b[31mКритическая ошибка: ' + (e.message || String(e)) + '\x1b[0m\n');
  process.exit(1);
});
