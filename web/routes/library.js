'use strict';
// Роутер библиотеки: справочники дисциплин и психических способностей
// (system/library/…). Город-нейтральные данные, кэш по mtime файлов.
// loadDisciplines/loadPsychics экспортируются отдельно — их использует
// генерация V20-листов в server.js.

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError } = require('../lib/http');
const { ROOT, writeFileAtomic } = require('../lib/db');
const { slugify } = require('../lib/parsers');
const { parseDisciplineMd, pathArtSlug } = require('../lib/disciplines');
const { parsePsychicMd } = require('../lib/psychics');
const { getMerits, getAllMerits, invalidateMerits } = require('../lib/merits-loader');
const { getFlaws, getAllFlaws, invalidateFlaws } = require('../lib/flaws-loader');
const { getBackgrounds, getAllBackgrounds, invalidateBackgrounds } = require('../lib/backgrounds-loader');

const router = express.Router();

// ── Библиотека: справочник дисциплин (system/library/disciplines/*.md) ──────────
// Город-нейтральные данные → кэшируются по mtime каталога.
let _discCache = null; // { sig, list }
const DISC_DIR = path.join(ROOT, 'system', 'library', 'disciplines');

async function loadDisciplines() {
  const files = (await fs.readdir(DISC_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();

  const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', 'disciplines');
  const artFiles = await fs.readdir(imgDir).catch(() => []);
  // Арт Путей (path-based школы) живёт отдельно: paths/<disc>__<path>.png.
  const pathsImgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', 'paths');
  const pathArtFiles = await fs.readdir(pathsImgDir).catch(() => []);

  // Сигнатура по mtime каждого файла: правка содержимого существующего .md
  // не меняет mtime каталога, поэтому ключевать по нему нельзя (иначе кэш не сбросится).
  // Список картинок тоже входит в сигнатуру — появление нового PNG должно
  // сбрасывать кэш так же надёжно, как правка текста дисциплины.
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(DISC_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|')
    + '||art:' + artFiles.sort().join(',')
    + '||partart:' + pathArtFiles.sort().join(',');
  if (_discCache && _discCache.sig === sig) return _discCache.list;

  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(DISC_DIR, f), 'utf-8').catch(() => '');
    if (md) {
      const parsed = parseDisciplineMd(md, slug);
      parsed.hasArt = artFiles.includes(slug + '.png');
      for (const p of parsed.paths) {
        p.artSlug = pathArtSlug(slug, p.name);
        p.hasArt = pathArtFiles.includes(p.artSlug + '.png');
      }
      list.push(parsed);
    }
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

  const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', 'psychics');
  const artFiles = await fs.readdir(imgDir).catch(() => []);

  const stats = await Promise.all(mds.map(f => fs.stat(path.join(PSY_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|') + '||art:' + artFiles.sort().join(',');
  if (_psyCache && _psyCache.sig === sig) return _psyCache.list;

  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(PSY_DIR, f), 'utf-8').catch(() => '');
    if (md) {
      const parsed = parsePsychicMd(md, slug);
      parsed.hasArt = artFiles.includes(slug + '.png');
      list.push(parsed);
    }
  }
  _psyCache = { sig, list };
  return list;
}

router.get('/api/library/psychics', async (_req, res) => {
  try { res.json(await loadPsychics()); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: комбинированные дисциплины (system/library/combo_disciplines.json) ──
// Город-нейтральные данные. У комбо нет шкалы 1–5 — только предпосылки (prereq)
// и описание, поэтому это отдельный JSON, а не .md-дисциплина (иначе комбо
// засоряли бы список «все дисциплины» и требовали фиктивных уровней-точек).
const COMBO_FILE = path.join(ROOT, 'system', 'library', 'combo_disciplines.json');
let _comboCache = null; // { mtimeMs, list }
async function loadCombos() {
  const st = await fs.stat(COMBO_FILE).catch(() => null);
  if (!st) return [];
  if (_comboCache && _comboCache.mtimeMs === st.mtimeMs) return _comboCache.list;
  const raw = await fs.readFile(COMBO_FILE, 'utf-8').catch(() => '[]');
  let list;
  try { list = JSON.parse(raw); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  _comboCache = { mtimeMs: st.mtimeMs, list };
  return list;
}
router.get('/api/library/combo-disciplines', async (_req, res) => {
  // hasArt — как у merits/flaws: файлы combo/<slug>.png читаются на каждый
  // запрос (см. _artFileSet ниже), чтобы новый арт подхватывался без рестарта.
  try { res.json(_withArt(await loadCombos(), await _artFileSet('combo'))); }
  catch (e) { serverError(res, e); }
});

// Набор PNG-файлов в web/public/img/system/library/<section>/ (генерирует
// tools/generate_library_art.js) — читается на каждый запрос (каталог
// маленький, кэш не нужен), т.к. hasArt считается отдельно от кэша
// getMerits/getFlaws/getBackgrounds — иначе появление нового арта без
// рестарта сервера не отражалось бы в ответе (эти три лоадера кэшируют
// сами записи бессрочно, см. web/lib/merits-loader.js).
async function _artFileSet(section) {
  const dir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', section);
  const files = await fs.readdir(dir).catch(() => []);
  return new Set(files);
}
const _withArt = (list, art) => list.map(x => ({ ...x, hasArt: art.has(x.slug + '.png') }));

// ── Библиотека: справочник достоинств (system/library/merits/*.json) ──────────
// JSON-based merits library (physical, social, mental, supernatural)
router.get('/api/library/merits/:category', async (req, res) => {
  try {
    const merits = getMerits(req.params.category);
    res.json(_withArt(merits, await _artFileSet('merits')));
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник недостатков (system/library/flaws/*.json) ──────────
// JSON-based flaws library (физические, умственные, социальные, сверхъестественные)
router.get('/api/library/flaws/:category', async (req, res) => {
  try {
    const flaws = getFlaws(req.params.category);
    res.json(_withArt(flaws, await _artFileSet('flaws')));
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: объединённые списки достоинств/недостатков (все категории слиты) ──
// Для пикера в листе персонажа (см. web/public/scripts.js: _v20LoadLibrary) — не нужно
// отдельно грузить 4+4 эндпоинта по категориям на клиенте.
router.get('/api/library/merits', async (_req, res) => {
  try { res.json(_withArt(Object.values(getAllMerits()).flat(), await _artFileSet('merits'))); }
  catch (e) { serverError(res, e); }
});

router.get('/api/library/flaws', async (_req, res) => {
  try { res.json(_withArt(Object.values(getAllFlaws()).flat(), await _artFileSet('flaws'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник фактов биографии (system/library/backgrounds/*.json) ──
// JSON-based backgrounds library (general, vampire, ghoul, mage, changeling)
router.get('/api/library/backgrounds/:category', async (req, res) => {
  try {
    const backgrounds = getBackgrounds(req.params.category);
    res.json(_withArt(backgrounds, await _artFileSet('backgrounds')));
  } catch (e) { serverError(res, e); }
});

router.get('/api/library/backgrounds', async (_req, res) => {
  try { res.json(_withArt(Object.values(getAllBackgrounds()).flat(), await _artFileSet('backgrounds'))); }
  catch (e) { serverError(res, e); }
});

// ═══════════════════════════════════════════════════════════════════════════
// Фаза I — авторские (не канонические) элементы библиотеки: CRUD поверх тех же
// файлов. Создание помечает запись «Авторское: да» (MD) / "custom": true
// (JSON) — правка и удаление разрешены ТОЛЬКО для таких записей, канонический
// V20-контент через это API не редактируется и не удаляется.
// ═══════════════════════════════════════════════════════════════════════════

function _discTemplate({ name, clans, source, note, levels }) {
  const lines = [`# ${name}`, `- **Клан / принадлежность:** ${clans || ''}`];
  if (source) lines.push(`- **Источник:** ${source}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${l}`); }
  lines.push('');
  for (const lvl of (levels || [])) {
    lines.push(`## Уровень ${lvl.level} — ${lvl.name}`, '', `**Литературное описание.** ${lvl.literary || ''}`, '', `**Система.** ${lvl.system || ''}`, '');
  }
  return lines.join('\n');
}

router.post('/api/library/disciplines', express.json(), async (req, res) => {
  try {
    const { name, clans, source, note, levels } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(DISC_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Дисциплина с таким названием уже существует', slug });
    await writeFileAtomic(file, _discTemplate({ name: name.trim(), clans, source, note, levels }), 'utf-8');
    _discCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/disciplines/:slug', express.json(), async (req, res) => {
  try {
    const slug = req.params.slug;
    const file = path.join(DISC_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Дисциплина не найдена' });
    if (!parseDisciplineMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских дисциплин' });
    const { name, clans, source, note, levels } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _discTemplate({ name: name.trim(), clans, source, note, levels }), 'utf-8');
    _discCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/disciplines/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const file = path.join(DISC_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Дисциплина не найдена' });
    if (!parseDisciplineMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских дисциплин' });
    const trashDir = path.join(DISC_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _discCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

function _psyTemplate({ name, category, roll, source, note, levels }) {
  const lines = [`# ${name}`, `- **Категория:** ${category || ''}`];
  if (roll) lines.push(`- **Бросок:** ${roll}`);
  if (source) lines.push(`- **Источник:** ${source}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${l}`); }
  lines.push('');
  for (const lvl of (levels || [])) {
    lines.push(`## Уровень ${lvl.level} — ${lvl.name}`, '', `**Литературное описание.** ${lvl.literary || ''}`, '', `**Система.** ${lvl.system || ''}`, '');
  }
  return lines.join('\n');
}

router.post('/api/library/psychics', express.json(), async (req, res) => {
  try {
    const { name, category, roll, source, note, levels } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(PSY_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Способность с таким названием уже существует', slug });
    await writeFileAtomic(file, _psyTemplate({ name: name.trim(), category, roll, source, note, levels }), 'utf-8');
    _psyCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/psychics/:slug', express.json(), async (req, res) => {
  try {
    const slug = req.params.slug;
    const file = path.join(PSY_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Способность не найдена' });
    if (!parsePsychicMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских способностей' });
    const { name, category, roll, source, note, levels } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _psyTemplate({ name: name.trim(), category, roll, source, note, levels }), 'utf-8');
    _psyCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/psychics/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const file = path.join(PSY_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Способность не найдена' });
    if (!parsePsychicMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских способностей' });
    const trashDir = path.join(PSY_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _psyCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── JSON-track (достоинства/недостатки/факты биографии) ─────────────────────
const MERIT_CATEGORIES      = ['physical', 'social', 'mental', 'supernatural'];
const FLAW_CATEGORIES       = ['физические', 'умственные', 'социальные', 'сверхъестественные'];
const BACKGROUND_CATEGORIES = ['general', 'vampire', 'ghoul', 'mage', 'changeling'];

async function _readJsonArray(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf-8')); }
  catch { return []; }
}

function _jsonLibRoutes({ apiName, dir, categories, invalidate, extraFields }) {
  const dirPath = path.join(ROOT, 'system', 'library', dir);

  router.post(`/api/library/${apiName}`, express.json(), async (req, res) => {
    try {
      const { category, name } = req.body || {};
      if (!categories.includes(category)) return res.status(400).json({ error: 'Неизвестная категория' });
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      const slug = slugify(name);
      if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
      const file = path.join(dirPath, `${category}.json`);
      const list = await _readJsonArray(file);
      if (list.some(x => x.slug === slug))
        return res.status(409).json({ error: 'Запись с таким названием уже есть в категории', slug });
      const entry = { slug, name: name.trim(), ...extraFields(req.body), category, custom: true };
      list.push(entry);
      await writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n', 'utf-8');
      invalidate(category);
      res.json({ ok: true, slug });
    } catch (e) { serverError(res, e); }
  });

  router.put(`/api/library/${apiName}/:category/:slug`, express.json(), async (req, res) => {
    try {
      const { category, slug } = req.params;
      if (!categories.includes(category)) return res.status(400).json({ error: 'Неизвестная категория' });
      const file = path.join(dirPath, `${category}.json`);
      const list = await _readJsonArray(file);
      const idx = list.findIndex(x => x.slug === slug);
      if (idx === -1) return res.status(404).json({ error: 'Запись не найдена' });
      if (!list[idx].custom) return res.status(403).json({ error: 'Редактирование доступно только для авторских записей' });
      const { name } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      list[idx] = { ...list[idx], name: name.trim(), ...extraFields(req.body) };
      await writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n', 'utf-8');
      invalidate(category);
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  router.delete(`/api/library/${apiName}/:category/:slug`, async (req, res) => {
    try {
      const { category, slug } = req.params;
      if (!categories.includes(category)) return res.status(400).json({ error: 'Неизвестная категория' });
      const file = path.join(dirPath, `${category}.json`);
      const list = await _readJsonArray(file);
      const idx = list.findIndex(x => x.slug === slug);
      if (idx === -1) return res.status(404).json({ error: 'Запись не найдена' });
      if (!list[idx].custom) return res.status(403).json({ error: 'Удаление доступно только для авторских записей' });
      list.splice(idx, 1);
      await writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n', 'utf-8');
      invalidate(category);
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });
}

_jsonLibRoutes({
  apiName: 'merits', dir: 'merits', categories: MERIT_CATEGORIES, invalidate: invalidateMerits,
  extraFields: b => ({ points: b.points ?? '', description: b.description || '' }),
});
_jsonLibRoutes({
  apiName: 'flaws', dir: 'flaws', categories: FLAW_CATEGORIES, invalidate: invalidateFlaws,
  extraFields: b => ({ points: b.points ?? '', description: b.description || '' }),
});
_jsonLibRoutes({
  apiName: 'backgrounds', dir: 'backgrounds', categories: BACKGROUND_CATEGORIES, invalidate: invalidateBackgrounds,
  extraFields: b => ({ description: b.description || '', system: b.system || '' }),
});

module.exports = { router, loadDisciplines, loadPsychics };
