'use strict';
// Миграции формата файлов городов (cities/<город>/**/*.md).
//
// Запускается автоматически при старте сервера (web/server.js) — так апдейт
// подхватывается независимо от того, как пользователь обновился (update.bat
// или вручную git pull): достаточно перезапустить сервер.
// Ручной запуск: node tools/run_migrations.js
//
// Два вида модулей миграции — tools/migrations/NNN_slug.js:
//
// 1) Контентная (правит текст ОДНОГО файла на месте, самый частый случай):
//   module.exports = {
//     description: 'короткое описание изменения формата',
//     test(text)    { return /старый-паттерн/.test(text); },   // нужна ли миграция
//     migrate(text) { return text.replace(/старый-паттерн/, 'новый-паттерн'); },
//   };
//   test() должен быть идемпотентным — false на уже мигрированном файле,
//   иначе миграция будет применяться повторно при каждом старте сервера.
//
// 2) Структурная (переносит/переименовывает папки, создаёт новые файлы —
//    контентный контракт test(text)/migrate(text) для этого не подходит,
//    т.к. он работает над содержимым уже существующего файла, а не над
//    деревом папок):
//   module.exports = {
//     description: 'короткое описание структурного изменения',
//     migrateFs({ cityDir, citySlug, root, log }) { … ; return { changed: N }; },
//   };
//   Вызывается один раз на город (не на файл). Должна быть идемпотентной —
//   повторный вызов на уже мигрированных данных возвращает { changed: 0 }.
//
// Модуль может экспортировать любой из двух контрактов (не оба сразу).
// Порядок применения — по номеру NNN, одинаково для обоих видов.

const fs = require('fs'), path = require('path');

function loadMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return [];
  const out = [];
  for (const f of fs.readdirSync(migrationsDir).filter(f => /^\d+_.+\.js$/.test(f)).sort()) {
    // Сломанный модуль миграции не должен ронять сервер целиком —
    // логируем и пропускаем (остальные миграции применяются).
    try {
      const mod = require(path.join(migrationsDir, f));
      const isContent    = typeof mod.test === 'function' && typeof mod.migrate === 'function';
      const isStructural = typeof mod.migrateFs === 'function';
      if (!isContent && !isStructural) {
        throw new Error('должен экспортировать { test(text), migrate(text) } или { migrateFs({cityDir,…}) }');
      }
      out.push({ id: f.replace(/\.js$/, ''), ...mod });
    } catch (e) {
      console.error(`[migrations] tools/migrations/${f} пропущена: ${e.message}`);
    }
  }
  return out;
}

function walkMarkdown(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(fp));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(fp);
  }
  return out;
}

function runMigrations({ root, migrationsDir, log = () => {} }) {
  const migrations = loadMigrations(migrationsDir || path.join(root, 'tools', 'migrations'));
  const result = { filesChanged: 0, migrationsApplied: 0 };
  if (!migrations.length) return result;

  const citiesDir = path.join(root, 'cities');
  if (!fs.existsSync(citiesDir)) return result;

  for (const cityEntry of fs.readdirSync(citiesDir, { withFileTypes: true })) {
    if (!cityEntry.isDirectory()) continue;
    const cityDir = path.join(citiesDir, cityEntry.name);
    // Миграции применяются по номеру ПОСЛЕДОВАТЕЛЬНО для этого города — структурная
    // миграция (перенос папок) должна успеть отработать до того, как контентная
    // миграция или следующая структурная миграция увидят дерево файлов. Поэтому
    // walkMarkdown() для контентных миграций пересчитывается заново на каждой
    // итерации (а не один раз до цикла) — иначе более ранняя структурная миграция
    // этого же прохода (переименование/создание файлов) была бы не видна.
    for (const m of migrations) {
      if (typeof m.migrateFs === 'function') {
        try {
          const r = m.migrateFs({ cityDir, citySlug: cityEntry.name, root, log: msg => log(`${m.id}: ${msg}`) }) || {};
          const n = Number(r.changed) || 0;
          if (n) { result.filesChanged += n; result.migrationsApplied += n; }
        } catch (e) {
          log(`${m.id}: структурная миграция упала для ${cityEntry.name}: ${e.message}`);
        }
        continue;
      }
      for (const file of walkMarkdown(cityDir)) {
        const raw = fs.readFileSync(file, 'utf8');
        const bom = raw.charCodeAt(0) === 0xFEFF;
        const text = bom ? raw.slice(1) : raw;
        if (!m.test(text)) continue;
        const migrated = m.migrate(text);
        fs.writeFileSync(file, (bom ? '﻿' : '') + migrated, 'utf8');
        result.migrationsApplied++;
        result.filesChanged++;
        log(`${m.id}: ${path.relative(root, file)}`);
      }
    }
  }
  return result;
}

module.exports = { runMigrations, loadMigrations, walkMarkdown };
