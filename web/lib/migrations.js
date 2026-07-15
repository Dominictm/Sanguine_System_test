'use strict';
// Миграции формата файлов городов (cities/<город>/**/*.md).
//
// Запускается автоматически при старте сервера (web/server.js) — так апдейт
// подхватывается независимо от того, как пользователь обновился (update.bat
// или вручную git pull): достаточно перезапустить сервер.
// Ручной запуск: node tools/run_migrations.js
//
// Формат модуля миграции — tools/migrations/NNN_slug.js:
//   module.exports = {
//     description: 'короткое описание изменения формата',
//     test(text)    { return /старый-паттерн/.test(text); },   // нужна ли миграция
//     migrate(text) { return text.replace(/старый-паттерн/, 'новый-паттерн'); },
//   };
// test() должен быть идемпотентным — false на уже мигрированном файле,
// иначе миграция будет применяться повторно при каждом старте сервера.

const fs = require('fs'), path = require('path');

function loadMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return [];
  const out = [];
  for (const f of fs.readdirSync(migrationsDir).filter(f => /^\d+_.+\.js$/.test(f)).sort()) {
    // Сломанный модуль миграции не должен ронять сервер целиком —
    // логируем и пропускаем (остальные миграции применяются).
    try {
      const mod = require(path.join(migrationsDir, f));
      if (typeof mod.test !== 'function' || typeof mod.migrate !== 'function') {
        throw new Error('должен экспортировать { test(text), migrate(text) }');
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
    for (const file of walkMarkdown(path.join(citiesDir, cityEntry.name))) {
      const raw = fs.readFileSync(file, 'utf8');
      const bom = raw.charCodeAt(0) === 0xFEFF;
      let text = bom ? raw.slice(1) : raw;
      let fileChanged = false;
      for (const m of migrations) {
        if (m.test(text)) {
          text = m.migrate(text);
          result.migrationsApplied++;
          fileChanged = true;
          log(`${m.id}: ${path.relative(root, file)}`);
        }
      }
      if (fileChanged) {
        fs.writeFileSync(file, (bom ? '﻿' : '') + text, 'utf8');
        result.filesChanged++;
      }
    }
  }
  return result;
}

module.exports = { runMigrations, loadMigrations, walkMarkdown };
