'use strict';
// Обслуживание markdown-ссылок при перемещении карточек — техспека 2026-08-04 §B1.
//
// Первопричина: PUT /api/locations/:slug/district (привязка локации к району) физически
// переносит папку через fs.rename, но ссылки на старый путь («[Склад](../../../../locations/
// villet/sklad_kanal_yurk/sklad_kanal_yurk.md)» из модуля/хроники/архива) оставались
// битыми молча — ни ошибки, ни предупреждения. Кнопка «Проверка → Исправить
// автоматически» их не чинит: validate_links.ps1 -Fix работает только с изображениями.
//
// Алгоритм не новый: ровно это уже делала миграция округ→район
// (tools/migrations/002_district_rayon_paths.js), когда переносила все локации разом.
// Здесь он вынесен, чтобы у одиночного переноса и у миграции был один источник —
// логика внутри не менялась (сортировка по длине пути, граница (?=[/)]|$), BOM).

const fs = require('fs');
const path = require('path');

function _escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function _relPosix(root, p) { return path.relative(root, p).split(path.sep).join('/'); }

function _walkMd(dir, visit) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) _walkMd(fp, visit);
    else if (e.isFile() && e.name.endsWith('.md')) visit(fp);
  }
}

/**
 * Правит markdown-ссылки «<prefix>/<oldRel>» → «<prefix>/<newRel>» во всех .md файлах
 * города, на любой глубине «../» (матчится хвост пути, а не относительный префикс).
 *
 * @param {string} cityDir — абсолютный путь cities/<city>
 * @param {{oldRel: string, newRel: string}[]} renameMap — пути ОТНОСИТЕЛЬНО prefix-папки
 * @param {object}   [opts]
 * @param {string}   [opts.prefix='locations'] — 'locations' | 'characters' (§B3)
 * @param {Function} [opts.log]
 * @returns {{filesChanged: number, files: string[]}}
 */
function updateMdLinks(cityDir, renameMap, opts = {}) {
  const prefix = opts.prefix || 'locations';
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const map = (renameMap || []).filter(r => r && r.oldRel && r.newRel && r.oldRel !== r.newRel);
  if (!map.length) return { filesChanged: 0, files: [] };

  // Длинные пути первыми: иначе короткий путь-префикс перехватил бы совпадение,
  // предназначенное более длинному (например «luvr» vs «luvr/il_de_la_site»).
  const sorted = [...map].sort((a, b) => b.oldRel.length - a.oldRel.length);
  const files = [];

  _walkMd(cityDir, fp => {
    const raw = fs.readFileSync(fp, 'utf8');
    const hasBom = raw.charCodeAt(0) === 0xFEFF;
    let text = hasBom ? raw.slice(1) : raw;
    let touched = false;
    for (const { oldRel, newRel } of sorted) {
      // (?=[/)]|$) — граница пути: «villet/sklad» не должен матчиться внутри
      // «villet/sklad_2», а закрывающая «)» завершает markdown-ссылку.
      const re = new RegExp(_escapeRe(`${prefix}/${oldRel}`) + '(?=[/)]|$)', 'g');
      if (re.test(text)) {
        text = text.replace(re, `${prefix}/${newRel}`);
        touched = true;
      }
    }
    if (touched) {
      fs.writeFileSync(fp, (hasBom ? '﻿' : '') + text, 'utf8');
      files.push(_relPosix(cityDir, fp));
      log(`ссылки поправлены: ${_relPosix(cityDir, fp)}`);
    }
  });

  return { filesChanged: files.length, files };
}

/**
 * Обратный индекс: какие .md файлы города ссылаются на карточку. Тот же обход, что и
 * updateMdLinks, но без записи — нужен, чтобы предупредить перед удалением (§B2):
 * цель исчезает, автоподстановка нового пути невозможна.
 *
 * @returns {{count: number, files: string[]}}
 */
function findMdLinks(cityDir, rel, opts = {}) {
  const prefix = opts.prefix || 'locations';
  const re = new RegExp(_escapeRe(`${prefix}/${rel}`) + '(?=[/)]|$)');
  const files = [];
  _walkMd(cityDir, fp => {
    // Сама карточка ссылается на себя только через относительные пути внутри своей
    // папки — их этот матч не поймает, дополнительного исключения не требуется.
    if (re.test(fs.readFileSync(fp, 'utf8'))) files.push(_relPosix(cityDir, fp));
  });
  return { count: files.length, files };
}

module.exports = { updateMdLinks, findMdLinks };
