'use strict';
// Роутер «Инструменты → Бэкап»: архивация города(ов) в zip (фоновая задача, без
// 30-секундного таймаута соседних /api/tool и /api/run-tool — Compress-Archive на
// Париже, ~198 МБ, в этот бюджет не укладывается), отдельный маленький архив настроек
// (.env/ключи), и восстановление из zip в два шага (inspect → commit), где inspect
// ничего не трогает на диске проекта, только распаковывает во временную папку и
// проверяет структуру — реальная замена происходит только в commit, после того как
// пользователь увидел точную сводку. Планы: docs/design/2026-08-13-backup-tab-workplan.md,
// docs/design/2026-08-13-backup-tab-techspec.md.

const express = require('express');
const path    = require('path');
const os      = require('os');
const fs      = require('fs').promises;
const crypto  = require('crypto');
const { spawn } = require('child_process');
const { serverError } = require('../lib/http');
const {
  ROOT, CITIES_DIR, cityDir, listCities, dirSize,
  invalidateChars, invalidateLocs,
} = require('../lib/db');
const { parseCityMd } = require('../lib/parsers');

// Слаг не может НАЧИНАТЬСЯ с '_' — slugify() (lib/parsers/shared.js) обрезает ведущие/
// хвостовые '_' у любого настоящего сгенерированного слага, так что реальный город
// под таким именем невозможен в принципе. Важно не только для формы (POST
// /api/backup/city — там и так есть проверка через listCities()), но и для
// restore/inspect, где имя папки берётся из чужого архива БЕЗ сверки со списком
// существующих городов: голый /^[a-z0-9_]+$/ пропустил бы папку "_deleted" или
// "_restore_tmp" — служебные имена, зарезервированные под мягкое удаление/временную
// распаковку самим сервером (см. cities.js DELETE, CITIES_DIR/_restore_tmp ниже).
const CITY_SLUG_RE = /^[a-z0-9][a-z0-9_]*$/;

// Задачи живут в памяти процесса, не на диске — рестарт сервера прерывает
// незавершённый бэкап, что приемлемо для редкой ручной операции.
const _backupJobs  = new Map(); // id → { status, filePath, fileName, error }
const _restoreJobs = new Map(); // id → { extractDir, tmpDir, summary }

// Задачи, за которыми никто не вернулся (скачивание/подтверждение), не должны
// копить временные файлы на диске бесконечно — подчищаем через час.
const JOB_TTL_MS = 60 * 60 * 1000;
function _scheduleJobCleanup(map, id, dirToRemove) {
  setTimeout(() => {
    if (!map.has(id)) return;
    map.delete(id);
    fs.rm(dirToRemove, { recursive: true, force: true }).catch(() => {});
  }, JOB_TTL_MS).unref();
}

function runPowerShell(cmd) {
  return new Promise((resolve, reject) => {
    const full = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$OutputEncoding = [System.Text.Encoding]::UTF8',
      '$ErrorActionPreference = "Stop"',
      cmd,
    ].join('; ');
    const ps = spawn('powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', full],
      { cwd: ROOT, env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' } });
    let err = '';
    ps.stderr.on('data', d => { err += d.toString('utf8'); });
    ps.on('error', reject);
    ps.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `PowerShell завершился с кодом ${code}`));
    });
  });
}

const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;

async function displayNameFromDir(dir, fallback) {
  const raw = await fs.readFile(path.join(dir, 'city.md'), 'utf-8').catch(() => '');
  const parsed = raw ? parseCityMd(raw) : null;
  return (parsed && parsed.display) || fallback;
}

async function countFilesRecursive(dir) {
  let n = 0;
  for (const item of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) n += await countFilesRecursive(full);
    else n++;
  }
  return n;
}

// dirSize обходит fs.stat по каждому файлу дерева — для Парижа (~200 МБ, тысячи
// файлов арта) это заметная работа на КАЖДОЕ открытие вкладки. Кэш на минуту —
// вкладку открывают редко, а размер города между двумя открытиями за минуту
// меняется на копейки, не на что смотреть заново.
const _sizeCache = new Map(); // slug → { sizeMb, ts }
const SIZE_CACHE_TTL_MS = 60_000;
async function cachedDirSizeMb(slug) {
  const cached = _sizeCache.get(slug);
  if (cached && Date.now() - cached.ts < SIZE_CACHE_TTL_MS) return cached.sizeMb;
  const sizeMb = Math.round((await dirSize(cityDir(slug))) / 1024 / 1024);
  _sizeCache.set(slug, { sizeMb, ts: Date.now() });
  return sizeMb;
}

module.exports = function backupRouterFactory({ envPath }) {
  const vertexKeyPath = () => path.join(path.dirname(envPath()), '.gemini-vertex-key.json');
  const router = express.Router();

  // ── Список городов с размером на диске ──────────────────────────────────────
  router.get('/api/backup/cities-info', async (req, res) => {
    try {
      const slugs = await listCities();
      const cities = await Promise.all(slugs.map(async slug => {
        const [sizeMb, display] = await Promise.all([
          cachedDirSizeMb(slug),
          displayNameFromDir(cityDir(slug), slug),
        ]);
        return { slug, display, sizeMb };
      }));
      res.json({ cities });
    } catch (e) { serverError(res, e); }
  });

  // ── Создание бэкапа одного/нескольких городов (фоновая задача) ─────────────
  router.post('/api/backup/city', express.json(), async (req, res) => {
    const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs : [];
    if (!slugs.length) return res.status(400).json({ error: 'Не выбран ни один город' });
    const cities = await listCities();
    const bad = slugs.find(s => typeof s !== 'string' || !CITY_SLUG_RE.test(s) || !cities.includes(s));
    if (bad !== undefined) return res.status(400).json({ error: `Недопустимый город: ${bad}` });

    const id = crypto.randomBytes(8).toString('hex');
    _backupJobs.set(id, { status: 'running', filePath: null, fileName: null, error: null });
    res.json({ id });

    (async () => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const fileName = slugs.length === 1
        ? `VTM-backup-${slugs[0]}-${timestamp}.zip`
        : `VTM-backup-${slugs.length}cities-${timestamp}.zip`;
      const jobDir  = path.join(os.tmpdir(), `vtm_web_backup_${id}`);
      const zipPath = path.join(jobDir, fileName);
      await fs.mkdir(jobDir, { recursive: true });

      // Compress-Archive с несколькими -Path кладёт содержимое каждой папки под её
      // собственным именем внутри архива (paris/…, balmont/…) — ровно та структура,
      // которую потом ожидает restore/inspect. Без промежуточной копии: архивируем
      // cities/<slug> напрямую, фильтровать внутри города нечего (весь архив = только
      // данные городов, ключи/настройки — отдельный, второй, эндпоинт).
      const pathsArg = slugs.map(s => psQuote(cityDir(s))).join(',');
      const cmd = `Compress-Archive -Path ${pathsArg} -DestinationPath ${psQuote(zipPath)} -CompressionLevel Optimal`;

      try {
        await runPowerShell(cmd);
        _backupJobs.set(id, { status: 'done', filePath: zipPath, fileName, error: null });
        _scheduleJobCleanup(_backupJobs, id, jobDir);
      } catch (e) {
        _backupJobs.set(id, { status: 'error', filePath: null, fileName: null, error: e.message });
        await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
      }
    })();
  });

  router.get('/api/backup/job/:id', (req, res) => {
    const job = _backupJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Задача не найдена' });
    res.json({ status: job.status, fileName: job.fileName, error: job.error });
  });

  // Файл НЕ удаляется сразу после отдачи: пользователь может отменить системный
  // диалог «Сохранить как» уже после того, как ответ полностью пришёл в браузер
  // (fetch() отрабатывает независимо от диалога), и тогда повторный клик «Сохранить
  // файл» должен уметь скачать его ещё раз. Реальная уборка — только по TTL
  // (_scheduleJobCleanup, час с момента готовности), не по факту первого GET.
  router.get('/api/backup/job/:id/download', (req, res) => {
    const job = _backupJobs.get(req.params.id);
    if (!job || job.status !== 'done') return res.status(404).json({ error: 'Файл не готов' });
    res.download(job.filePath, job.fileName);
  });

  // ── Бэкап настроек (.env + service-account key + AI-feature-prefs с фронта) ──
  // Синхронно — это килобайты, не сотни мегабайт, фоновая задача не нужна.
  router.post('/api/backup/settings', express.json(), async (req, res) => {
    let tmpDir;
    try {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vtm_settings_backup_'));
      const stageDir = path.join(tmpDir, 'stage');
      await fs.mkdir(stageDir, { recursive: true });

      await fs.copyFile(envPath(), path.join(stageDir, '.env')).catch(() => {});
      await fs.copyFile(vertexKeyPath(), path.join(stageDir, '.gemini-vertex-key.json')).catch(() => {});
      if (req.body?.aiFeaturePrefs)
        await fs.writeFile(path.join(stageDir, 'ai-feature-prefs.json'), String(req.body.aiFeaturePrefs), 'utf-8');

      const staged = await fs.readdir(stageDir).catch(() => []);
      if (!staged.length) return res.status(404).json({ error: 'Нечего сохранять — настройки не найдены' });

      const fileName = `VTM-settings-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)}.zip`;
      const zipPath  = path.join(tmpDir, fileName);
      await runPowerShell(`Compress-Archive -Path ${psQuote(path.join(stageDir, '*'))} -DestinationPath ${psQuote(zipPath)} -CompressionLevel Optimal`);

      res.download(zipPath, fileName, async () => {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      });
    } catch (e) {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      serverError(res, e);
    }
  });

  // ── Восстановление, шаг 1: принять zip, распаковать, проверить — ничего в
  // cities/ на этом этапе не трогается. Приём — сырым потоком мимо express.json:
  // общий лимит тела (20mb, server.js) и сам факт, что body-parser метит req._body
  // при первом успешном парсинге (см. комментарий про /api/audio в server.js), делают
  // JSON/base64 непригодными для бинарника в сотни мегабайт. Content-Type должен
  // быть НЕ application/json — иначе общий express.json() выше по цепочке его съест.
  router.post('/api/backup/restore/inspect', (req, res) => {
    const inspectId = crypto.randomBytes(8).toString('hex');
    let extractDirForCleanup = null;
    (async () => {

      // Приём zip'а — во временную папку ОС (не переживается rename'ом, годится
      // любой диск). Распаковка — НЕ туда: commit ниже переносит папку города из
      // extractDir в cities/<slug> через fs.rename(), а Node's rename() кидает
      // EXDEV при переносе между разными физическими дисками (обычная раскладка
      // Windows — TEMP на системном диске, проект на другом). extractDir поэтому
      // живёт под cities/_restore_tmp/ — тот же диск, что и cities/<slug>, ровно
      // как cities/_deleted/ уже используется для мягкого удаления/отката.
      const uploadDir = path.join(os.tmpdir(), `vtm_restore_upload_${inspectId}`);
      await fs.mkdir(uploadDir, { recursive: true });
      const uploadPath = path.join(uploadDir, 'upload.zip');

      // Без express.json() тело не проходит через его лимит (20mb) — этот путь
      // намеренно сырой (см. комментарий выше), поэтому предел нужен свой. 1 ГБ —
      // с большим запасом над самым тяжёлым реальным городом (~200 МБ), но не
      // бесконечность: без него сервер, слушающий не только 127.0.0.1 (HOST=…,
      // см. server.js), можно заставить писать на диск неограниченный поток.
      const MAX_RESTORE_UPLOAD_BYTES = 1024 * 1024 * 1024;
      let uploadedBytes = 0;
      const writeStream = require('fs').createWriteStream(uploadPath);
      await new Promise((resolve, reject) => {
        req.on('data', chunk => {
          uploadedBytes += chunk.length;
          if (uploadedBytes > MAX_RESTORE_UPLOAD_BYTES) {
            req.destroy();
            writeStream.destroy();
            reject(new Error('файл слишком большой (>1 ГБ)'));
          }
        });
        req.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        req.on('error', reject);
      });

      const extractDir = path.join(CITIES_DIR, '_restore_tmp', inspectId);
      extractDirForCleanup = extractDir;
      await fs.mkdir(extractDir, { recursive: true });
      try {
        await runPowerShell(`Expand-Archive -Path ${psQuote(uploadPath)} -DestinationPath ${psQuote(extractDir)} -Force`);
      } finally {
        await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      }

      const entries = (await fs.readdir(extractDir, { withFileTypes: true })).filter(e => e.isDirectory());
      if (!entries.length) throw new Error('В архиве не найдено ни одной папки города');

      const cities = await listCities();
      const summary = [];
      for (const dirent of entries) {
        const slug = dirent.name;
        if (!CITY_SLUG_RE.test(slug)) throw new Error(`Недопустимое имя папки в архиве: ${slug}`);
        const candidatePath = path.join(extractDir, slug);
        const hasCityMd = await fs.stat(path.join(candidatePath, 'city.md')).then(() => true).catch(() => false);
        if (!hasCityMd) throw new Error(`Папка «${slug}» в архиве не похожа на город (нет city.md)`);
        const [fileCount, sizeBytes, display] = await Promise.all([
          countFilesRecursive(candidatePath),
          dirSize(candidatePath),
          displayNameFromDir(candidatePath, slug),
        ]);
        summary.push({ slug, display, fileCount, sizeMb: Math.round(sizeBytes / 1024 / 1024), exists: cities.includes(slug) });
      }

      _restoreJobs.set(inspectId, { extractDir, tmpDir: extractDir, summary });
      _scheduleJobCleanup(_restoreJobs, inspectId, extractDir);
      res.json({ inspectId, summary });
    })().catch(async e => {
      if (extractDirForCleanup) await fs.rm(extractDirForCleanup, { recursive: true, force: true }).catch(() => {});
      res.status(400).json({ error: 'Не удалось разобрать архив: ' + e.message });
    });
  });

  // ── Восстановление, шаг 2: применить ранее проверенный inspect. Существующие
  // города откатываются в cities/_deleted/ (тот же механизм, что DELETE
  // /api/cities/:slug в cities.js) — восстановление не стирает, а замещает.
  router.post('/api/backup/restore/commit', express.json(), async (req, res) => {
    const inspectId = req.body?.inspectId;
    const job = _restoreJobs.get(inspectId);
    if (!job) return res.status(404).json({ error: 'Проверка архива истекла — загрузите файл заново' });
    _restoreJobs.delete(inspectId);

    const results = [];
    try {
      for (const item of job.summary) {
        const src = path.join(job.extractDir, item.slug);
        if (item.exists) {
          const deletedDir = path.join(CITIES_DIR, '_deleted');
          await fs.mkdir(deletedDir, { recursive: true });
          const rollbackDest = path.join(deletedDir, `${item.slug}__before_restore_${Date.now()}`);
          await fs.rename(cityDir(item.slug), rollbackDest);
          results.push({ slug: item.slug, rolledBackTo: path.relative(ROOT, rollbackDest).replace(/\\/g, '/') });
        } else {
          results.push({ slug: item.slug, rolledBackTo: null });
        }
        await fs.rename(src, cityDir(item.slug));
        invalidateChars(item.slug);
        invalidateLocs(item.slug);
      }
      // Удаляем только при полном успехе: fs.rename ПЕРЕМЕЩАЕТ папку города из
      // extractDir, так что после частичного сбоя там остаются ровно те города,
      // которые ещё не встали на место, — единственная копия их данных на этот
      // момент. Удалить extractDir в этом случае (как раньше — безусловно, в
      // finally) значило стереть последнюю сохранившуюся версию невставшего
      // города без какого-либо способа восстановить её, кроме повторной
      // загрузки архива с нуля. При ошибке extractDir сознательно остаётся на
      // диске (путь — в логе) для ручного разбора.
      await fs.rm(job.tmpDir, { recursive: true, force: true }).catch(() => {});
      res.json({ ok: true, results });
    } catch (e) {
      console.error('[restore-commit]', e, '— неперенесённые данные оставлены в', job.tmpDir);
      res.status(500).json({
        error: 'Восстановление прервано — см. лог сервера. Уже перенесённые города откачены (см. results); данные, не успевшие перенестись, сохранены на сервере для ручного разбора.',
        results,
      });
    }
  });

  return router;
};
