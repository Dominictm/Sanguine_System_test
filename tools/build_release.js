#!/usr/bin/env node
'use strict';
// Пересобирает релизную (тестовую) версию из текущего рабочего дерева:
//   1. Применяет точечные правки из tools/release-overrides.json (find -> replace,
//      падает с ошибкой, если find не найден ровно один раз — чтобы не разойтись
//      молча при будущих правках исходных файлов).
//   2. Вычищает содержимое cities/<город>/ (оставляя файлы прямо в cities/, напр. README.md).
//   3. Удаляет пути из tools/release-exclude.json (дев-окружение: .claude, .github,
//      .vscode, .impeccable, art-genegic — не нужны Рассказчику в релизе).
//
// Используется автосборкой релиза (.github/workflows/release-test.yml) и локально:
//   node tools/build_release.js [--root <dir>] [--dry-run]
//
// Никогда не трогает .git и не делает push — это делает вызывающий workflow/скрипт.

const fs = require('fs'), path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const rootIdx = args.indexOf('--root');
const ROOT = path.resolve(rootIdx !== -1 ? args[rootIdx + 1] : path.join(__dirname, '..'));

function applyOverrides() {
  const overridesPath = path.join(ROOT, 'tools', 'release-overrides.json');
  const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
  const changed = [];
  for (const { file, find, replace } of overrides) {
    const fp = path.join(ROOT, file);
    if (!fs.existsSync(fp)) throw new Error(`release-overrides: файл не найден: ${file}`);
    const raw = fs.readFileSync(fp, 'utf8');
    const bom = raw.charCodeAt(0) === 0xFEFF;
    const crlf = raw.includes('\r\n');
    const text = (bom ? raw.slice(1) : raw).replace(/\r\n/g, '\n');
    const count = text.split(find).length - 1;
    if (count !== 1) {
      throw new Error(
        `release-overrides: в "${file}" строка-якорь найдена ${count} раз(а), ожидался 1.\n` +
        `  Якорь: ${JSON.stringify(find)}\n` +
        `  Файл изменился с момента написания этого override — обновите tools/release-overrides.json.`
      );
    }
    let next = text.replace(find, replace);
    if (crlf) next = next.replace(/\n/g, '\r\n');
    if (!dryRun) fs.writeFileSync(fp, (bom ? '﻿' : '') + next, 'utf8');
    changed.push(file);
  }
  return changed;
}

function stripCities() {
  const citiesDir = path.join(ROOT, 'cities');
  if (!fs.existsSync(citiesDir)) return [];
  const removed = [];
  for (const entry of fs.readdirSync(citiesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue; // оставить файлы прямо в cities/ (README.md)
    removed.push(entry.name);
    if (!dryRun) fs.rmSync(path.join(citiesDir, entry.name), { recursive: true, force: true });
  }
  return removed;
}

function stripExcluded() {
  const excludePath = path.join(ROOT, 'tools', 'release-exclude.json');
  if (!fs.existsSync(excludePath)) return [];
  const list = JSON.parse(fs.readFileSync(excludePath, 'utf8'));
  const removed = [];
  for (const rel of list) {
    const fp = path.join(ROOT, rel);
    if (!fs.existsSync(fp)) continue;
    removed.push(rel);
    if (!dryRun) fs.rmSync(fp, { recursive: true, force: true });
  }
  return removed;
}

function main() {
  console.log(`[build_release] root: ${ROOT}${dryRun ? ' (dry-run)' : ''}`);
  const changed = applyOverrides();
  console.log(`[build_release] applied overrides: ${changed.join(', ')}`);
  const removed = stripCities();
  console.log(`[build_release] removed cities/: ${removed.length ? removed.join(', ') : '(none)'}`);
  const excluded = stripExcluded();
  console.log(`[build_release] removed excluded: ${excluded.length ? excluded.join(', ') : '(none)'}`);
}

main();
