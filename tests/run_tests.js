/**
 * VTM Chronicle Manager — Автотесты
 *
 * Запуск:  node tests/run_tests.js
 *          или через  tests/run_tests.bat
 *
 * Отчёт:  tests/report.html  (перезаписывается при каждом запуске)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');

const ROOT   = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'web', 'server.js');

// ── Мини-фреймворк ────────────────────────────────────────────────────────────

const GROUPS  = [];
let _group    = null;
let _totalRun = 0;   // всего запущено
let _pass     = 0;   // всего прошло
let _fail     = 0;   // всего упало
const W = process.stdout.columns || 80;

// Строка прогресс-бара: ████████░░░░ XX/YY
function bar(done, total, width) {
  width = width || 24;
  var filled = total ? Math.round(done / total * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// Очистить текущую строку и вернуться к началу
function clearLine() { process.stdout.write('\r\x1b[K'); }

// Напечатать шапку группы
function printGroupHeader(g) {
  var line = '\n  ┌─ ' + g.title;
  if (g.desc) line += '\n  │  \x1b[2m' + g.desc + '\x1b[0m';
  line += '\n  └──────────────────────────────';
  process.stdout.write(line + '\n');
}

// Напечатать итог группы
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

const GROUPS_META = [];  // хранит ссылки на группы для footer

function group(title, desc) {
  // Закрываем предыдущую группу
  if (_group && _group.tests.length) printGroupFooter(_group);
  _group = { title, desc, tests: [] };
  GROUPS.push(_group);
  GROUPS_META.push(_group);
  printGroupHeader(_group);
}

async function t(name, desc, fn) {
  _totalRun++;
  var idx    = _totalRun;
  var prefix = '\x1b[2m[' + String(idx).padStart(2) + ']\x1b[0m ';

  // Живой индикатор "выполняется"
  var runLine = prefix + '\x1b[33m⟳\x1b[0m  ' + name.slice(0, W - 12);
  process.stdout.write('  ' + runLine);

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

  // Строка общего прогресса (перезаписывается при следующем тесте)
  var overallBar = bar(_pass + _fail, _totalRun, 30);
  var pLine = '\r  \x1b[2m' + overallBar + '  ' + (_pass + _fail) + ' / ' + _totalRun
    + '   \x1b[32m✓' + _pass + '\x1b[0m\x1b[2m  \x1b[31m✗' + _fail + '\x1b[0m\x1b[2m\x1b[0m';
  process.stdout.write(pLine);

  _group.tests.push(entry);
}

function assert(cond, msg)         { if (!cond)      throw new Error(msg || 'Условие не выполнено'); }
function assertGte(a, b, msg)      { if (a < b)       throw new Error(`${msg || ''}: ${a} < ${b}`); }
function assertEq(a, b, msg)       { if (a !== b)     throw new Error(`${msg || ''}: получено "${a}", ожидалось "${b}"`); }
function assertInc(s, sub, msg)    { if (!s.includes(sub))  throw new Error(`${msg || ''}: "${sub}" не найдено`); }
function assertNotInc(s, sub, msg) { if (s.includes(sub))   throw new Error(`${msg || ''}: "${sub}" найдено, но не должно`); }

// ── HTTP-хелпер ───────────────────────────────────────────────────────────────

function apiGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body), body }); }
        catch { resolve({ status: res.statusCode, json: null, body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(6000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function waitForServer(base, ms) {
  ms = ms || 12000;
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    function probe() {
      http.get(`${base}/api/status`, res => { res.resume(); resolve(); })
        .on('error', function() {
          if (Date.now() - t0 > ms) reject(new Error('Сервер не ответил за ' + ms + 'ms'));
          else setTimeout(probe, 300);
        });
    }
    probe();
  });
}

function serverIsUp(base) {
  return new Promise(resolve => {
    http.get(`${base}/api/status`, res => { res.resume(); resolve(true); })
      .on('error', () => resolve(false));
  });
}

// ── Файловые хелперы ──────────────────────────────────────────────────────────

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8').replace(/\r\n/g, '\n');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function findMDFiles(relDir) {
  const dir = path.join(ROOT, relDir);
  if (!fs.existsSync(dir)) return [];
  const results = [];
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) results.push(full);
    }
  }
  walk(dir);
  return results;
}

// ═════════════════════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ
// ═════════════════════════════════════════════════════════════════════════════

async function main() {

  // Шапка запуска
  var hr = '═'.repeat(54);
  process.stdout.write('\n\x1b[1m' + hr + '\x1b[0m\n');
  process.stdout.write('  \x1b[31m🩸\x1b[0m  \x1b[1mVTM Chronicle Manager\x1b[0m — Автотесты\n');
  process.stdout.write('  ' + new Date().toLocaleString('ru-RU', { hour12: false }) + '\n');
  process.stdout.write('\x1b[1m' + hr + '\x1b[0m\n');

  // ── ГРУППА 1: Структура файлов ─────────────────────────────────────────────
  group('📁 Структура файлов', 'Проверяет наличие всех ключевых файлов и папок проекта');

  const KEY_FILES = [
    ['web/server.js',                          'Основной серверный файл Node.js/Express'],
    ['web/public/scripts.js',                  'Фронтенд-логика SPA (персонажи, локации, граф, дневники)'],
    ['web/public/index.html',                  'Точка входа SPA'],
    ['web/public/styles.css',                  'Глобальные стили Gothic-UI'],
    ['web/public/fonts/Inkulinati-Regular.otf','Шрифт заголовков страниц (кириллический)'],
    ['characters/characters_ALL.md',           'Сводный справочник всех персонажей проекта'],
    ['rules/diary_rules.md',                   'Правила формата дневников персонажей'],
    ['tools/new_npc.ps1',                      'PowerShell-скрипт создания карточки НПС'],
    ['tools/new_location.ps1',                 'PowerShell-скрипт создания карточки локации'],
    ['tools/validate_links.ps1',               'PowerShell-скрипт проверки внутренних ссылок'],
  ];

  for (var i = 0; i < KEY_FILES.length; i++) {
    (function(kf) {
      // Используем IIFE чтобы захватить переменную в цикле
    })(KEY_FILES[i]);
  }

  for (const [relPath, desc] of KEY_FILES) {
    await t('Файл: ' + relPath, desc, (function(rp) {
      return function() { assert(fileExists(rp), 'Файл не существует'); };
    })(relPath));
  }

  // ── ГРУППА 2: Синтаксис кода ───────────────────────────────────────────────
  group('⚙️  Синтаксис кода', 'node --check не даёт синтаксических ошибок');

  await t('server.js — синтаксис', 'node --check проходит без ошибок', function() {
    execSync('node --check "' + path.join(ROOT, 'web', 'server.js') + '"', { stdio: 'pipe' });
  });

  await t('scripts.js — синтаксис', 'node --check проходит без ошибок', function() {
    execSync('node --check "' + path.join(ROOT, 'web', 'public', 'scripts.js') + '"', { stdio: 'pipe' });
  });

  // ── ГРУППА 3: Целостность данных ──────────────────────────────────────────
  group('📝 Целостность данных', 'Проверяет содержимое .md файлов без запуска сервера');

  await t('characters_ALL.md — нет фантомной записи "3"',
    'Тестовая запись [🧛 3](vampires/3/3.md) должна быть удалена; её файла не существует',
    function() { assertNotInc(readFile('characters/characters_ALL.md'), 'vampires/3/3.md', 'Найдена битая запись'); });

  await t('characters_ALL.md — содержит Эмилия Индра-Ландорг',
    'Персонаж переименован из "Эмилия" — ссылка в сводном списке должна быть обновлена',
    function() { assertInc(readFile('characters/characters_ALL.md'), 'Эмилия Индра-Ландорг'); });

  await t('Файл Эмилии Индра-Ландорг существует',
    'После переименования папка и файл должны называться точно "Эмилия Индра-Ландорг"',
    function() { assert(fileExists('characters/vampires/Эмилия Индра-Ландорг/Эмилия Индра-Ландорг.md')); });

  await t('Старой папки "Эмилия" нет',
    'Исходная папка characters/vampires/Эмилия/ не должна существовать после переименования',
    function() { assert(!fileExists('characters/vampires/Эмилия/Эмилия.md'), 'Старый файл всё ещё существует'); });

  await t('Ганеш.md → ссылка на Эмилию Индра-Ландорг',
    'Обратная ссылка мужа должна указывать на актуальное имя персонажа',
    function() { assertInc(readFile('characters/vampires/Ганеш/Ганеш.md'), 'Эмилия%20Индра-Ландорг'); });

  await t('Ямала.md — поле "Род: Красная Шапка"',
    'Для фей поле "Род" используется в веб-интерфейсе вместо "Клан"',
    function() { assertInc(readFile('characters/fairies/Ямала/Ямала.md'), '**Род:** Красная Шапка'); });

  await t('Ева.md — пометка "Японка" в особенностях',
    'Национальность должна быть явно указана в поле Особенности',
    function() { assertInc(readFile('characters/vampires/Ева/Ева.md'), 'Японка'); });

  await t('Ева.md — Тома Бошен как поручитель',
    'В разделе Отношения должна быть ссылка на Тома Бошена (поручитель после гибели сира)',
    function() { assertInc(readFile('characters/vampires/Ева/Ева.md'), 'Тома Бошен'); });

  await t('Верене.md — промт «Тёмные века» добавлен',
    'Промт средневекового облика XIV в. без пирсинга добавлен в карточку персонажа',
    function() { assertInc(readFile('characters/vampires/Верене де Кюстин/Верене де Кюстин.md'), 'Тёмные века'); });

  await t('Верене.md — промт «Тёмные века» без пирсинга',
    'В блоке «Тёмные века» не должно быть "septum piercing" — анахронизм для XIV в.',
    function() {
      var md  = readFile('characters/vampires/Верене де Кюстин/Верене де Кюстин.md');
      var idx = md.indexOf('Тёмные века');
      assert(idx !== -1, 'Блок «Тёмные века» не найден');
      var block = md.slice(idx, idx + 600);
      assertNotInc(block, 'septum piercing', 'Септум-пирсинг найден в блоке «Тёмные века»');
    });

  await t('Journal_Ямала/retrospective.md существует',
    'Ретроспектива дневника должна лежать в canonical-именованном файле retrospective.md',
    function() { assert(fileExists('characters/fairies/Ямала/Journal_Ямала/retrospective.md')); });

  await t('Все локации имеют 6 обязательных мета-полей',
    'Каждый .md файл в locations/ должен содержать: Название, Округ, Район, Адрес, Зона, Контроль',
    function() {
      var files   = findMDFiles('locations');
      var missing = [];
      var fields  = ['Название', 'Округ', 'Район', 'Адрес', 'Зона', 'Контроль'];
      files.forEach(function(f) {
        var c = fs.readFileSync(f, 'utf-8');
        fields.forEach(function(field) {
          if (!c.includes('**' + field + ':**')) {
            missing.push(path.basename(f) + ': "' + field + '"');
          }
        });
      });
      assert(missing.length === 0, 'Отсутствующие поля: ' + missing.slice(0, 4).join('; '));
    });

  await t('new_npc.ps1 — нет жёсткого "Активен"',
    'Шаблон НПС должен использовать нейтральный "Жив / Жива" вместо мужского рода',
    function() { assertNotInc(readFile('tools/new_npc.ps1'), 'Статус:** Активен', 'Найдено устаревшее'); });

  await t('new_npc.ps1 — содержит "Жив / Жива"',
    'Шаблон подсказывает заполнить пол-нейтральный статус перед созданием',
    function() { assertInc(readFile('tools/new_npc.ps1'), 'Жив / Жива'); });

  await t('new_location.ps1 — содержит поле "Название"',
    'Шаблон новой локации включает новое обязательное поле Название (тип места)',
    function() { assertInc(readFile('tools/new_location.ps1'), 'Название'); });

  await t('Все персонажи-вампиры имеют поле "Линейка WoD"',
    'Обязательное поле для определения lineage в парсере server.js. Проверяются только главные карточки, не дневники.',
    function() {
      var vampDir = path.join(ROOT, 'characters', 'vampires');
      var bad = [];
      // Перебираем только папки персонажей (один уровень)
      fs.readdirSync(vampDir, { withFileTypes: true }).forEach(function(entry) {
        if (!entry.isDirectory()) return;
        var charName = entry.name;
        var cardPath = path.join(vampDir, charName, charName + '.md');
        if (!fs.existsSync(cardPath)) return;
        var c = fs.readFileSync(cardPath, 'utf-8');
        if (!c.includes('**Линейка WoD:**')) bad.push(charName);
      });
      assert(bad.length === 0, 'Без поля Линейка WoD: ' + bad.slice(0, 3).join(', '));
    });

  // ── API-тесты: определяем базовый URL ─────────────────────────────────────
  const BASE3000 = 'http://localhost:3000';
  const BASE3001 = 'http://localhost:3001';

  var apiBase        = null;
  var spawnedServer  = null;

  // Пробуем порт 3000 (рабочий сервер разработчика)
  const up3000 = await serverIsUp(BASE3000);
  if (up3000) {
    apiBase = BASE3000;
    console.log('\n🌐  Сервер на :3000 найден — используем его для API-тестов');
  } else {
    // Пробуем запустить тестовый сервер на 3001
    console.log('\n🌐  Запускаем тестовый сервер на :3001...');
    // Проверяем поддержку PORT env в server.js
    var serverSrc = fs.readFileSync(SERVER, 'utf-8');
    if (!serverSrc.includes('process.env.PORT')) {
      console.log('    ℹ  server.js не поддерживает env PORT — API-тесты пропущены');
    } else {
      spawnedServer = spawn('node', [SERVER], {
        cwd: path.join(ROOT, 'web'),
        env: Object.assign({}, process.env, { PORT: '3001' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      try {
        await waitForServer(BASE3001, 12000);
        apiBase = BASE3001;
        console.log('    ✓  Сервер поднят');
      } catch (e) {
        console.log('    ✗  ' + e.message + ' — API-тесты пропущены');
        spawnedServer.kill();
        spawnedServer = null;
      }
    }
  }

  // ── ГРУППА 4: API — Персонажи ─────────────────────────────────────────────
  group('🧛 API — Персонажи', 'GET /api/characters: структура и содержимое ответа');

  if (apiBase) {
    await t('/api/characters → 200, массив',
      'Эндпоинт возвращает HTTP 200 и JSON-массив',
      async function() {
        var r = await apiGet(apiBase + '/api/characters');
        assertEq(r.status, 200, 'HTTP статус');
        assert(Array.isArray(r.json), 'Ответ не является массивом');
      });

    await t('/api/characters → не менее 30 персонажей',
      'В проекте: вампиры, феи, смертные — итого ≥30',
      async function() {
        var r = await apiGet(apiBase + '/api/characters');
        assertGte(r.json.length, 30, 'Количество персонажей');
      });

    await t('/api/characters — все имеют name, lineage, statusType',
      'Каждый объект должен содержать обязательные поля для рендера карточки в UI',
      async function() {
        var r   = await apiGet(apiBase + '/api/characters');
        var bad = r.json.filter(function(c) { return !c.name || !c.lineage || !c.statusType; });
        assert(bad.length === 0, 'Без обязательных полей: ' + bad.map(function(c) { return c.name || '?'; }).join(', '));
      });

    await t('/api/characters — персонаж Ева присутствует',
      'Ева добавлена как Малкавиан-детектив, японка-альбинос, ПК',
      async function() {
        var r = await apiGet(apiBase + '/api/characters');
        assert(r.json.some(function(c) { return c.name === 'Ева'; }), 'Ева не найдена');
      });

    await t('/api/characters — Ямала.clan = "Красная Шапка"',
      'Поле "Род" для фей подставляется в clan — проверка парсера',
      async function() {
        var r  = await apiGet(apiBase + '/api/characters');
        var ch = r.json.find(function(c) { return c.name === 'Ямала'; });
        assert(ch, 'Ямала не найдена');
        assertEq(ch.clan, 'Красная Шапка', 'clan Ямалы');
      });

    await t('/api/characters — Эмилия Индра-Ландорг присутствует',
      'После переименования персонаж отображается под новым полным именем',
      async function() {
        var r = await apiGet(apiBase + '/api/characters');
        assert(r.json.some(function(c) { return c.name === 'Эмилия Индра-Ландорг'; }));
      });

    await t('/api/characters — нет персонажа "3"',
      'Фантомная тестовая запись "3" удалена из characters_ALL.md',
      async function() {
        var r = await apiGet(apiBase + '/api/characters');
        assert(!r.json.some(function(c) { return c.name === '3'; }), 'Найден фантомный персонаж "3"');
      });

    await t('/api/characters — смертные определяются корректно',
      'Персонажи в mortals/ должны иметь lineage="mortal"',
      async function() {
        var r      = await apiGet(apiBase + '/api/characters');
        var mortal = r.json.filter(function(c) { return c.lineage === 'mortal'; });
        assertGte(mortal.length, 3, 'Смертных персонажей');
      });

  } else {
    _group.tests.push({ name: '(пропущено)', desc: 'Сервер недоступен', status: 'SKIP', error: null });
    console.log('    ⚠  Сервер недоступен — группа пропущена');
  }

  // ── ГРУППА 5: API — Локации ───────────────────────────────────────────────
  group('🗺️  API — Локации', 'GET /api/locations: парсинг мета-полей и VtM-данных');

  if (apiBase) {
    await t('/api/locations → 200, массив',
      'Эндпоинт возвращает HTTP 200 и JSON-массив',
      async function() {
        var r = await apiGet(apiBase + '/api/locations');
        assertEq(r.status, 200, 'HTTP статус');
        assert(Array.isArray(r.json), 'Ответ не является массивом');
      });

    await t('/api/locations → ровно 25 локаций',
      'В проекте ровно 25 карточек локаций',
      async function() {
        var r = await apiGet(apiBase + '/api/locations');
        assertEq(r.json.length, 25, 'Количество локаций');
      });

    await t('/api/locations — все имеют subtype (Название)',
      'Новое обязательное поле subtype из мета-блока **Название:** должно быть у всех',
      async function() {
        var r   = await apiGet(apiBase + '/api/locations');
        var bad = r.json.filter(function(l) { return !l.subtype; });
        assert(bad.length === 0, 'Без subtype: ' + bad.map(function(l) { return l.slug; }).join(', '));
      });

    await t('/api/locations — все имеют district (Округ)',
      'Поле district обязательно для фильтра по округам в UI',
      async function() {
        var r   = await apiGet(apiBase + '/api/locations');
        var bad = r.json.filter(function(l) { return !l.district; });
        assert(bad.length === 0, 'Без district: ' + bad.map(function(l) { return l.slug; }).join(', '));
      });

    await t('/api/locations — Опера Гарнье имеет locStatus',
      'Таблица ## 🩸 Контекст Камарильи должна парситься: | **Статус** | → locStatus',
      async function() {
        var r   = await apiGet(apiBase + '/api/locations');
        var loc = r.json.find(function(l) { return l.slug.includes('Опера'); });
        assert(loc, 'Опера не найдена');
        assert(loc.locStatus, 'locStatus пуст у ' + loc.slug);
      });

    await t('/api/locations — Фобур-Сент-Антуан имеет vtmText',
      'Свободный текст из ## VtM-контекст должен парситься в vtmText',
      async function() {
        var r   = await apiGet(apiBase + '/api/locations');
        var loc = r.json.find(function(l) { return l.slug.includes('Фобур'); });
        assert(loc, 'Фобур не найден');
        assert(loc.vtmText && loc.vtmText.length > 20, 'vtmText пуст или слишком короткий');
      });

    await t('/api/locations — Фобур vtmText без "**Маскарад:**"',
      'Строка **Маскарад:** вырезается из vtmText при парсинге',
      async function() {
        var r   = await apiGet(apiBase + '/api/locations');
        var loc = r.json.find(function(l) { return l.slug.includes('Фобур'); });
        assert(loc && loc.vtmText, 'Фобур/vtmText не найден');
        assertNotInc(loc.vtmText, '**Маскарад:**', 'Маскарад не вырезан из vtmText');
      });

    await t('/api/locations — Фобур имеет keyPoints (≥3)',
      'Таблица ## Ключевые точки локации парсится в массив keyPoints',
      async function() {
        var r   = await apiGet(apiBase + '/api/locations');
        var loc = r.json.find(function(l) { return l.slug.includes('Фобур'); });
        assert(loc, 'Фобур не найден');
        assert(Array.isArray(loc.keyPoints) && loc.keyPoints.length >= 3,
          'keyPoints: ' + JSON.stringify(loc.keyPoints));
      });

  } else {
    _group.tests.push({ name: '(пропущено)', desc: 'Сервер недоступен', status: 'SKIP', error: null });
    console.log('    ⚠  Сервер недоступен — группа пропущена');
  }

  // ── ГРУППА 6: API — Дневники ──────────────────────────────────────────────
  group('📖 API — Дневники', 'GET /api/characters/:name/diary: парсинг форматов и безопасность');

  if (apiBase) {
    await t('Ямала ретроспектива → format=retrospective',
      'Файл с множеством секций ### 📅 определяется как "retrospective"',
      async function() {
        var r = await apiGet(apiBase + '/api/characters/' + encodeURIComponent('Ямала') + '/diary?file=' + encodeURIComponent('Journal_Ямала/retrospective.md'));
        assertEq(r.status, 200, 'HTTP статус');
        assertEq(r.json.format, 'retrospective', 'format');
      });

    await t('Ямала ретроспектива → sections ≥ 10',
      'Ретроспектива охватывает XI–XXI вв. — секций должно быть много',
      async function() {
        var r = await apiGet(apiBase + '/api/characters/' + encodeURIComponent('Ямала') + '/diary?file=' + encodeURIComponent('Journal_Ямала/retrospective.md'));
        assertGte(r.json.sections.length, 10, 'Количество секций');
      });

    await t('Верене 2010-11 → format=entry',
      'Одиночная запись с полями Автор/Локация/Тон/Текст определяется как "entry"',
      async function() {
        var r = await apiGet(apiBase + '/api/characters/' + encodeURIComponent('Верене де Кюстин') + '/diary?file=' + encodeURIComponent('Journal_Верене/2010-11.md'));
        assertEq(r.status, 200, 'HTTP статус');
        assertEq(r.json.format, 'entry', 'format');
      });

    await t('Верене 2010-11 → поле text заполнено',
      'Текст записи должен парситься из блока "- **📖 Текст записи:**"',
      async function() {
        var r = await apiGet(apiBase + '/api/characters/' + encodeURIComponent('Верене де Кюстин') + '/diary?file=' + encodeURIComponent('Journal_Верене/2010-11.md'));
        assert(r.json.text && r.json.text.length > 20, 'Поле text пусто или слишком короткое');
      });

    await t('Path traversal ../../ → 403 Forbidden',
      'Попытка выйти за пределы папки персонажа через ../../ блокируется сервером',
      async function() {
        var r = await apiGet(apiBase + '/api/characters/' + encodeURIComponent('Ямала') + '/diary?file=' + encodeURIComponent('../../web/server.js'));
        assertEq(r.status, 403, 'Ожидался 403 Forbidden');
      });

  } else {
    _group.tests.push({ name: '(пропущено)', desc: 'Сервер недоступен', status: 'SKIP', error: null });
    console.log('    ⚠  Сервер недоступен — группа пропущена');
  }

  // ── ГРУППА 7: API — Граф и Статус ─────────────────────────────────────────
  group('📊 API — Граф и Статус', 'GET /api/graph и /api/status');

  if (apiBase) {
    await t('/api/graph → 200, nodes + links',
      'Граф отношений возвращает узлы (персонажи) и рёбра (отношения)',
      async function() {
        var r = await apiGet(apiBase + '/api/graph');
        assertEq(r.status, 200, 'HTTP статус');
        assert(Array.isArray(r.json.nodes), 'nodes не массив');
        assert(Array.isArray(r.json.links), 'links не массив');
      });

    await t('/api/graph → nodes ≥ 30',
      'Каждый персонаж = узел графа',
      async function() {
        var r = await apiGet(apiBase + '/api/graph');
        assertGte(r.json.nodes.length, 30, 'Узлов в графе');
      });

    await t('/api/graph → есть рёбра',
      'Отношения между персонажами должны отображаться как рёбра',
      async function() {
        var r = await apiGet(apiBase + '/api/graph');
        assertGte(r.json.links.length, 1, 'Рёбер в графе');
      });

    await t('/api/status → 200, поле vampires ≥ 20',
      'Статус-дашборд возвращает статистику по линейкам',
      async function() {
        var r = await apiGet(apiBase + '/api/status');
        assertEq(r.status, 200, 'HTTP статус');
        assert(typeof r.json.vampires === 'number', 'Поле vampires не число');
        assertGte(r.json.vampires, 20, 'Количество вампиров');
      });

    await t('/api/status → brokenLinks = 0 или null',
      'После исправления битых ссылок (Эмилия, запись "3") ошибок не должно быть',
      async function() {
        var r  = await apiGet(apiBase + '/api/status');
        var bl = r.json.brokenLinks;
        assert(bl === null || bl === 0,
          'brokenLinks = ' + bl + ' (нужно запустить validate_links или есть реальные ошибки)');
      });

  } else {
    _group.tests.push({ name: '(пропущено)', desc: 'Сервер недоступен', status: 'SKIP', error: null });
    console.log('    ⚠  Сервер недоступен — группа пропущена');
  }

  // Останавливаем тестовый сервер если запускали
  if (spawnedServer) { spawnedServer.kill(); }

  // Закрываем последнюю группу + сбрасываем строку прогресса
  if (_group && _group.tests.length) { clearLine(); printGroupFooter(_group); }

  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // HTML-ОТЧЁТ
  // ═══════════════════════════════════════════════════════════════════════════

  var allTests  = GROUPS.reduce(function(a, g) { return a.concat(g.tests); }, []);
  var totalPass = allTests.filter(function(t) { return t.status === 'PASS'; }).length;
  var totalFail = allTests.filter(function(t) { return t.status === 'FAIL'; }).length;
  var totalSkip = allTests.filter(function(t) { return t.status === 'SKIP'; }).length;
  var total     = allTests.length;
  var pct       = total ? Math.round(totalPass / total * 100) : 0;

  var stamp    = new Date().toLocaleString('ru-RU', { hour12: false });
  var allGreen = totalFail === 0;

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // Строки таблицы тестов
  function renderRows(tests) {
    if (!tests.length) return '<tr><td colspan="3" class="skip-row">Тесты пропущены — сервер недоступен</td></tr>';
    return tests.map(function(tt) {
      var cls  = tt.status === 'PASS' ? 'pass' : (tt.status === 'SKIP' ? 'skip' : 'fail');
      var icon = tt.status === 'PASS' ? '✓' : (tt.status === 'SKIP' ? '–' : '✗');
      var err  = tt.error
        ? '<div class="err-msg">' + esc(tt.error.slice(0, 200)) + '</div>'
        : '';
      return '<tr class="row-' + cls + '">'
        + '<td class="col-status"><span class="badge-' + cls + '">' + icon + '</span></td>'
        + '<td class="col-name">' + esc(tt.name) + err + '</td>'
        + '<td class="col-desc">' + esc(tt.desc) + '</td>'
        + '</tr>';
    }).join('');
  }

  // Секции групп
  var groupsHtml = GROUPS.map(function(g) {
    var gPass = g.tests.filter(function(t) { return t.status === 'PASS'; }).length;
    var gFail = g.tests.filter(function(t) { return t.status === 'FAIL'; }).length;
    var gSkip = g.tests.filter(function(t) { return t.status === 'SKIP'; }).length;
    var gPct  = g.tests.length ? Math.round(gPass / g.tests.length * 100) : 0;
    var gcls  = gFail > 0 ? 'group-fail' : (gSkip === g.tests.length ? 'group-skip' : 'group-pass');

    return '<section class="group ' + gcls + '">'
      + '<div class="group-header">'
      +   '<div class="group-title">' + esc(g.title) + '</div>'
      +   '<div class="group-meta">'
      +     '<span class="group-desc">' + esc(g.desc) + '</span>'
      +     '<div class="group-stats">'
      +       '<span class="gs-pass">' + gPass + ' прошли</span>'
      +       (gFail ? '<span class="gs-fail">' + gFail + ' упали</span>' : '')
      +       (gSkip ? '<span class="gs-skip">' + gSkip + ' пропущены</span>' : '')
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

  var html = '<!DOCTYPE html>\n<html lang="ru">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<title>VTM — Отчёт тестов</title>\n'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    + '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Share+Tech+Mono&display=swap" rel="stylesheet">\n'
    + '<style>\n'
    + ':root{'
    +   '--bg:#07050a;--bg2:#0d0a10;--bg3:#120f18;--bg4:#181420;'
    +   '--red:#8B0000;--red2:#B80000;--red3:#CC2200;'
    +   '--gold:#B8860B;--gold2:#DAA520;'
    +   '--green:#1a5c1a;--green2:#2d8c2d;--green3:#4CAF50;'
    +   '--text:#E8E0D0;--text2:#a89880;--text3:#5a5050;'
    +   '--border:rgba(139,0,0,.22);--border2:rgba(180,20,0,.4);'
    +   '--fh:"Cinzel",serif;--fb:"Cormorant Garamond",Georgia,serif;--fm:"Share Tech Mono","Courier New",monospace;'
    + '}'
    + '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}'
    + 'html{scroll-behavior:smooth}'
    + 'body{background:var(--bg);color:var(--text);font-family:var(--fb);font-size:16px;line-height:1.6;min-height:100vh}'
    + '::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:var(--bg2)}::-webkit-scrollbar-thumb{background:var(--red);border-radius:3px}'

    // Header
    + '.header{background:var(--bg2);border-bottom:2px solid var(--border2);padding:40px 48px 32px;position:relative;overflow:hidden}'
    + '.header::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(139,0,0,.18) 0%,transparent 70%);pointer-events:none}'
    + '.header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:32px;margin-bottom:32px}'
    + '.logo{display:flex;flex-direction:column;gap:4px}'
    + '.logo-drop{font-size:11px;color:var(--text3);font-family:var(--fm);letter-spacing:.1em;text-transform:uppercase}'
    + '.logo-title{font-family:var(--fh);font-size:28px;font-weight:700;color:var(--text);letter-spacing:.18em;text-transform:uppercase}'
    + '.logo-sub{font-family:var(--fh);font-size:12px;color:var(--text3);letter-spacing:.22em;text-transform:uppercase;margin-top:2px}'
    + '.stamp{font-family:var(--fm);font-size:12px;color:var(--text3);text-align:right;line-height:1.8}'

    // Status banner
    + '.status-banner{display:flex;align-items:center;gap:20px;padding:20px 28px;border-radius:6px;border:1px solid;}'
    + '.status-banner.all-pass{background:rgba(26,92,26,.15);border-color:rgba(76,175,80,.35)}'
    + '.status-banner.has-fail{background:rgba(139,0,0,.15);border-color:rgba(180,20,0,.45)}'
    + '.status-icon{font-size:36px;flex-shrink:0}'
    + '.status-text{flex:1}'
    + '.status-headline{font-family:var(--fh);font-size:18px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px}'
    + '.all-pass .status-headline{color:var(--green3)}'
    + '.has-fail .status-headline{color:#ff6b6b}'
    + '.status-sub{font-family:var(--fm);font-size:12px;color:var(--text2)}'

    // Big stats
    + '.stats-row{display:flex;gap:16px;margin-top:28px}'
    + '.stat{flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:20px 16px;text-align:center;position:relative;overflow:hidden}'
    + '.stat::after{content:"";position:absolute;top:0;left:0;right:0;height:2px}'
    + '.stat-pass::after{background:linear-gradient(90deg,var(--green3),transparent)}'
    + '.stat-fail::after{background:linear-gradient(90deg,var(--red2),transparent)}'
    + '.stat-skip::after{background:linear-gradient(90deg,var(--gold),transparent)}'
    + '.stat-total::after{background:linear-gradient(90deg,var(--text3),transparent)}'
    + '.stat-num{font-family:var(--fh);font-size:48px;font-weight:700;line-height:1}'
    + '.stat-pass .stat-num{color:var(--green3)}'
    + '.stat-fail .stat-num{color:#ff6b6b}'
    + '.stat-skip .stat-num{color:var(--gold)}'
    + '.stat-total .stat-num{color:var(--text2)}'
    + '.stat-lbl{font-family:var(--fh);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--text3);margin-top:6px}'

    // Progress bar
    + '.progress-wrap{margin-top:28px}'
    + '.progress-label{display:flex;justify-content:space-between;font-family:var(--fm);font-size:11px;color:var(--text3);margin-bottom:6px}'
    + '.progress-track{height:8px;background:var(--bg4);border-radius:4px;overflow:hidden;border:1px solid var(--border)}'
    + '.progress-fill{height:100%;border-radius:4px;transition:width .5s;background:linear-gradient(90deg,var(--green2),var(--green3))}'
    + '.progress-fill.fail{background:linear-gradient(90deg,var(--red),var(--red3))}'

    // Main content
    + '.main{max-width:1200px;margin:0 auto;padding:40px 48px}'

    // Group sections
    + '.group{margin-bottom:36px;border:1px solid var(--border);border-radius:8px;overflow:hidden}'
    + '.group-header{padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;cursor:pointer}'
    + '.group-pass .group-header{background:rgba(26,92,26,.08);border-bottom:1px solid rgba(76,175,80,.18)}'
    + '.group-fail .group-header{background:rgba(139,0,0,.12);border-bottom:1px solid rgba(180,20,0,.3)}'
    + '.group-skip .group-header{background:rgba(90,80,80,.08);border-bottom:1px solid var(--border)}'
    + '.group-title{font-family:var(--fh);font-size:16px;font-weight:600;letter-spacing:.1em;color:var(--text);white-space:nowrap}'
    + '.group-meta{flex:1;display:flex;flex-direction:column;gap:6px;align-items:flex-end}'
    + '.group-desc{font-size:13px;color:var(--text3);font-style:italic;text-align:right}'
    + '.group-stats{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}'
    + '.gs-pass{font-family:var(--fm);font-size:11px;color:var(--green3)}'
    + '.gs-fail{font-family:var(--fm);font-size:11px;color:#ff6b6b}'
    + '.gs-skip{font-family:var(--fm);font-size:11px;color:var(--gold)}'
    + '.mini-bar{width:80px;height:5px;background:var(--bg4);border-radius:3px;overflow:hidden;border:1px solid var(--border)}'
    + '.mini-fill{height:100%;background:var(--green3);}'
    + '.group-fail .mini-fill{background:var(--red2)}'

    // Test table
    + '.test-table{width:100%;border-collapse:collapse}'
    + '.test-table th{padding:10px 16px;text-align:left;font-family:var(--fh);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--text3);background:var(--bg3);border-bottom:1px solid var(--border)}'
    + '.test-table td{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top}'
    + '.row-pass:hover td{background:rgba(255,255,255,.02)}'
    + '.row-fail td{background:rgba(139,0,0,.06)}'
    + '.row-fail:hover td{background:rgba(139,0,0,.1)}'
    + '.row-skip td{opacity:.5}'
    + '.col-status{width:56px;text-align:center}'
    + '.col-name{font-family:var(--fm);font-size:13px;color:var(--text);width:38%}'
    + '.col-desc{font-size:13px;color:var(--text2);font-style:italic}'
    + '.badge-pass{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:rgba(76,175,80,.15);border:1px solid rgba(76,175,80,.4);color:var(--green3);font-size:13px;font-weight:700}'
    + '.badge-fail{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:rgba(139,0,0,.2);border:1px solid rgba(180,20,0,.5);color:#ff6b6b;font-size:13px;font-weight:700}'
    + '.badge-skip{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:rgba(90,80,80,.15);border:1px solid var(--border);color:var(--text3);font-size:13px}'
    + '.err-msg{margin-top:6px;padding:8px 12px;background:rgba(139,0,0,.15);border-left:3px solid var(--red2);border-radius:0 4px 4px 0;font-family:var(--fm);font-size:11px;color:#ff9999;line-height:1.5}'
    + '.skip-row{text-align:center;padding:20px;color:var(--text3);font-style:italic;font-size:13px}'

    // Footer
    + '.footer{text-align:center;padding:32px 48px;border-top:1px solid var(--border);font-family:var(--fm);font-size:11px;color:var(--text3);letter-spacing:.06em}'

    + '</style>\n</head>\n<body>\n'

    // HEADER
    + '<header class="header">\n'
    + '  <div class="header-top">\n'
    + '    <div class="logo">\n'
    + '      <span class="logo-drop">🩸 Vampire: The Masquerade — Paris 2010</span>\n'
    + '      <div class="logo-title">VTM Chronicle Manager</div>\n'
    + '      <div class="logo-sub">Отчёт автотестов</div>\n'
    + '    </div>\n'
    + '    <div class="stamp">📅 ' + esc(stamp) + '<br>tests/run_tests.js<br>' + total + ' тестов · 7 групп</div>\n'
    + '  </div>\n'

    + '  <div class="status-banner ' + (allGreen ? 'all-pass' : 'has-fail') + '">\n'
    + '    <div class="status-icon">' + (allGreen ? '🟢' : '🔴') + '</div>\n'
    + '    <div class="status-text">\n'
    + '      <div class="status-headline">' + (allGreen ? 'Все тесты прошли успешно' : 'Есть упавшие тесты: ' + totalFail) + '</div>\n'
    + '      <div class="status-sub">' + totalPass + ' прошли &nbsp;·&nbsp; ' + totalFail + ' упали &nbsp;·&nbsp; ' + totalSkip + ' пропущены &nbsp;·&nbsp; ' + total + ' всего</div>\n'
    + '    </div>\n'
    + '  </div>\n'

    + '  <div class="stats-row">\n'
    + '    <div class="stat stat-pass"><div class="stat-num">' + totalPass + '</div><div class="stat-lbl">Прошли</div></div>\n'
    + '    <div class="stat stat-fail"><div class="stat-num">' + totalFail + '</div><div class="stat-lbl">Упали</div></div>\n'
    + '    <div class="stat stat-skip"><div class="stat-num">' + totalSkip + '</div><div class="stat-lbl">Пропущены</div></div>\n'
    + '    <div class="stat stat-total"><div class="stat-num">' + total + '</div><div class="stat-lbl">Всего</div></div>\n'
    + '  </div>\n'

    + '  <div class="progress-wrap">\n'
    + '    <div class="progress-label"><span>Прогресс выполнения</span><span>' + pct + '%</span></div>\n'
    + '    <div class="progress-track"><div class="progress-fill ' + (allGreen ? '' : 'fail') + '" style="width:' + pct + '%"></div></div>\n'
    + '  </div>\n'
    + '</header>\n'

    // MAIN
    + '<main class="main">\n'
    + groupsHtml
    + '</main>\n'

    // FOOTER
    + '<footer class="footer">Сгенерировано автоматически · tests/run_tests.js · ' + esc(stamp) + '</footer>\n'
    + '</body>\n</html>';

  var reportPath = path.join(__dirname, 'report.html');
  fs.writeFileSync(reportPath, html, 'utf-8');

  // Финальный вывод в консоль
  var finalColor = allGreen ? '\x1b[32m' : '\x1b[31m';
  var badge      = allGreen ? '🟢  ВСЕ ТЕСТЫ ПРОШЛИ' : '🔴  ЕСТЬ ОШИБКИ: ' + totalFail;
  var finalBar   = bar(totalPass, total, 40);
  var hr2        = '═'.repeat(54);

  process.stdout.write('\n\x1b[1m' + hr2 + '\x1b[0m\n');
  process.stdout.write('  \x1b[1m' + finalColor + badge + '\x1b[0m\n');
  process.stdout.write('  ' + finalColor + finalBar + '\x1b[0m  ' + pct + '%\n');
  process.stdout.write(
    '  \x1b[32m✓ ' + totalPass + ' прошли\x1b[0m'
    + '   \x1b[31m✗ ' + totalFail + ' упали\x1b[0m'
    + (totalSkip ? '   \x1b[33m– ' + totalSkip + ' пропущены\x1b[0m' : '')
    + '   \x1b[2m' + total + ' всего\x1b[0m\n'
  );
  process.stdout.write('  \x1b[2mОтчёт: tests/report.html\x1b[0m\n');
  process.stdout.write('\x1b[1m' + hr2 + '\x1b[0m\n\n');

  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(function(e) {
  console.error('FATAL:', e);
  process.exit(2);
});
