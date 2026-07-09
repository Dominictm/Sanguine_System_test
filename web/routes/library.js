'use strict';
// Роутер библиотеки: справочники дисциплин и психических способностей
// (system/library/…). Город-нейтральные данные, кэш по mtime файлов.
// loadDisciplines/loadPsychics экспортируются отдельно — их использует
// генерация V20-листов в server.js.

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError } = require('../lib/http');
const { ROOT } = require('../lib/db');
const { parseDisciplineMd } = require('../lib/disciplines');
const { parsePsychicMd } = require('../lib/psychics');
const { getMerits, getAllMerits } = require('../lib/merits-loader');
const { getFlaws, getAllFlaws } = require('../lib/flaws-loader');
const { getBackgrounds, getAllBackgrounds } = require('../lib/backgrounds-loader');

const router = express.Router();

// ── Библиотека: справочник дисциплин (system/library/disciplines/*.md) ──────────
// Город-нейтральные данные → кэшируются по mtime каталога.
let _discCache = null; // { sig, list }
const DISC_DIR = path.join(ROOT, 'system', 'library', 'disciplines');

async function loadDisciplines() {
  const files = (await fs.readdir(DISC_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();

  // Сигнатура по mtime каждого файла: правка содержимого существующего .md
  // не меняет mtime каталога, поэтому ключевать по нему нельзя (иначе кэш не сбросится).
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(DISC_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_discCache && _discCache.sig === sig) return _discCache.list;

  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(DISC_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parseDisciplineMd(md, slug));
  }
  _discCache = { sig, list };
  return list;
}

router.get('/api/library/disciplines', async (_req, res) => {
  try { res.json(await loadDisciplines()); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник психических способностей (system/library/psychics/*.md) ──
// Город-нейтральные данные → тот же mtime-кэш, что и у дисциплин (см. выше).
let _psyCache = null; // { sig, list }
const PSY_DIR = path.join(ROOT, 'system', 'library', 'psychics');

async function loadPsychics() {
  const files = (await fs.readdir(PSY_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();

  const stats = await Promise.all(mds.map(f => fs.stat(path.join(PSY_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_psyCache && _psyCache.sig === sig) return _psyCache.list;

  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(PSY_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parsePsychicMd(md, slug));
  }
  _psyCache = { sig, list };
  return list;
}

router.get('/api/library/psychics', async (_req, res) => {
  try { res.json(await loadPsychics()); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник достоинств (system/library/merits/*.json) ──────────
// JSON-based merits library (physical, social, mental, supernatural)
router.get('/api/library/merits/:category', (_req, res) => {
  try {
    const category = _req.params.category;
    const merits = getMerits(category);
    res.json(merits);
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник недостатков (system/library/flaws/*.json) ──────────
// JSON-based flaws library (физические, умственные, социальные, сверхъестественные)
router.get('/api/library/flaws/:category', (_req, res) => {
  try {
    const category = _req.params.category;
    const flaws = getFlaws(category);
    res.json(flaws);
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: объединённые списки достоинств/недостатков (все категории слиты) ──
// Для пикера в листе персонажа (см. web/public/scripts.js: _v20LoadLibrary) — не нужно
// отдельно грузить 4+4 эндпоинта по категориям на клиенте.
router.get('/api/library/merits', (_req, res) => {
  try { res.json(Object.values(getAllMerits()).flat()); }
  catch (e) { serverError(res, e); }
});

router.get('/api/library/flaws', (_req, res) => {
  try { res.json(Object.values(getAllFlaws()).flat()); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник фактов биографии (system/library/backgrounds/*.json) ──
// JSON-based backgrounds library (general, vampire, ghoul, mage, changeling)
router.get('/api/library/backgrounds/:category', (_req, res) => {
  try {
    const category = _req.params.category;
    const backgrounds = getBackgrounds(category);
    res.json(backgrounds);
  } catch (e) { serverError(res, e); }
});

router.get('/api/library/backgrounds', (_req, res) => {
  try { res.json(Object.values(getAllBackgrounds()).flat()); }
  catch (e) { serverError(res, e); }
});

module.exports = { router, loadDisciplines, loadPsychics };
