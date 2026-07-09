#!/usr/bin/env node
'use strict';
// Ручной запуск миграций формата без поднятия сервера:
//   node tools/run_migrations.js
// Сервер делает это же автоматически при каждом старте (web/server.js).

const path = require('path');
const { runMigrations } = require('../web/lib/migrations');

const ROOT = path.resolve(__dirname, '..');

try {
  const { filesChanged, migrationsApplied } = runMigrations({
    root: ROOT,
    log: msg => console.log(`[migrate] ${msg}`),
  });

  if (!filesChanged) console.log('Миграций не требуется — все файлы в актуальном формате.');
  else console.log(`Готово: обновлено файлов — ${filesChanged} (применений миграций — ${migrationsApplied}).`);
} catch (e) {
  console.error(`Миграции упали: ${e.message}`);
  process.exit(1);
}
