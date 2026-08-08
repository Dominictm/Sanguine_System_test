'use strict';
// Роутер библиотеки: справочники дисциплин и психических способностей
// (system/library/…). Город-нейтральные данные, кэш по mtime файлов.
// loadDisciplines/loadPsychics экспортируются отдельно — их использует
// генерация V20-листов в server.js.

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError, validateImageUpload } = require('../lib/http');
const { ROOT, writeFileAtomic } = require('../lib/db');
const { slugify, sanitizeInlineText } = require('../lib/parsers');
const { parseDisciplineMd, pathArtSlug } = require('../lib/disciplines');
const { parsePsychicMd } = require('../lib/psychics');
const { parseClanMd } = require('../lib/clans');
const { parseSectMd } = require('../lib/sects');
const { parseTitleMd } = require('../lib/titles');
const { getMerits, getAllMerits, invalidateMerits } = require('../lib/merits-loader');
const { getFlaws, getAllFlaws, invalidateFlaws } = require('../lib/flaws-loader');
const { getBackgrounds, getAllBackgrounds, invalidateBackgrounds } = require('../lib/backgrounds-loader');
const { FILE: RELATION_TYPES_FILE, getRelationTypes, randomRelColor } = require('../lib/relation-types');

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

// ── Библиотека: справочник кланов (system/library/clans/*.md) — K3, 2026-08-04 ──
// Город-нейтральные данные → тот же mtime-кэш, что у дисциплин/психики.
// hasArt — см. _withArt/_artFileSet ниже (те же PNG-конвенции, что у дисциплин).
let _clanCache = null; // { sig, list }
const CLANS_DIR = path.join(ROOT, 'system', 'library', 'clans');

async function loadClans() {
  const files = (await fs.readdir(CLANS_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(CLANS_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_clanCache && _clanCache.sig === sig) return _clanCache.list;
  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(CLANS_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parseClanMd(md, slug));
  }
  _clanCache = { sig, list };
  return list;
}

router.get('/api/library/clans', async (_req, res) => {
  try { res.json(_withArt(await loadClans(), await _artFileSet('clans'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник сект (system/library/sects/*.md) — K4, 2026-08-04 ──
let _sectCache = null; // { sig, list }
const SECTS_DIR = path.join(ROOT, 'system', 'library', 'sects');

async function loadSects() {
  const files = (await fs.readdir(SECTS_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(SECTS_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_sectCache && _sectCache.sig === sig) return _sectCache.list;
  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(SECTS_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parseSectMd(md, slug));
  }
  _sectCache = { sig, list };
  return list;
}

router.get('/api/library/sects', async (_req, res) => {
  try { res.json(_withArt(await loadSects(), await _artFileSet('sects'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник титулов (system/library/titles/*.md) — 2026-08-06 ──
// Зеркало clans/sects выше. Отличие от Клана/Секты: поле «Принадлежность»
// (свободный текст) вместо «Секта», и boolean-флаг «Негативный».
let _titleCache = null; // { sig, list }
const TITLES_DIR = path.join(ROOT, 'system', 'library', 'titles');

async function loadTitles() {
  const files = (await fs.readdir(TITLES_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(TITLES_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_titleCache && _titleCache.sig === sig) return _titleCache.list;
  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(TITLES_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parseTitleMd(md, slug));
  }
  _titleCache = { sig, list };
  return list;
}

router.get('/api/library/titles', async (_req, res) => {
  try { res.json(_withArt(await loadTitles(), await _artFileSet('titles'))); }
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

// sanitizeInlineText on clans/source/level name/literary/system: FIX-16
// (docs/audit/2026-07-28-fix-plan.md, continuation of FIX-2) — each is spliced
// into a single template line; an embedded '\n## Уровень N — …' would otherwise
// break out into a real H2/level heading that parseDisciplineMd then treats as
// genuine data (confirmed live during QA: a fake level 99 appeared in the API).
function _discTemplate({ name, clans, source, note, levels }) {
  const lines = [`# ${name}`, `- **Клан / принадлежность:** ${sanitizeInlineText(clans || '')}`];
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('');
  for (const lvl of (levels || [])) {
    lines.push(`## Уровень ${lvl.level} — ${sanitizeInlineText(lvl.name || '')}`, '', `**Литературное описание.** ${sanitizeInlineText(lvl.literary || '')}`, '', `**Система.** ${sanitizeInlineText(lvl.system || '')}`, '');
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
    // FIX-17 (docs/audit/2026-07-28-fix-plan.md): unlike POST (which derives its
    // filename via slugify(name)), this took :slug from the URL straight into
    // path.join — a '..' segment would resolve outside DISC_DIR. Gated in practice
    // by the "Авторское: да" check below (can only touch an existing, custom-marked
    // file, not write anywhere new), but slugify() closes it outright.
    const slug = slugify(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
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
    const slug = slugify(req.params.slug);   // FIX-17 — see PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
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

// sanitizeInlineText: see _discTemplate above (same FIX-16 breakout risk).
function _psyTemplate({ name, category, roll, source, note, levels }) {
  const lines = [`# ${name}`, `- **Категория:** ${sanitizeInlineText(category || '')}`];
  if (roll) lines.push(`- **Бросок:** ${sanitizeInlineText(roll)}`);
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('');
  for (const lvl of (levels || [])) {
    lines.push(`## Уровень ${lvl.level} — ${sanitizeInlineText(lvl.name || '')}`, '', `**Литературное описание.** ${sanitizeInlineText(lvl.literary || '')}`, '', `**Система.** ${sanitizeInlineText(lvl.system || '')}`, '');
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
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
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
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
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

// ── Библиотека: CRUD кланов (K3, 2026-08-04) — зеркало disciplines выше, но без
// «levels» (клан не силовая шкала, одна секция «## Описание»).
function _clanTemplate({ name, sect, disciplines, weakness, source, note, description }) {
  const lines = [`# ${name}`];
  if (sect) lines.push(`- **Секта:** ${sanitizeInlineText(sect)}`);
  if (disciplines) lines.push(`- **Дисциплины:** ${sanitizeInlineText(disciplines)}`);
  if (weakness) lines.push(`- **Слабость:** ${sanitizeInlineText(weakness)}`);
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('', '## Описание', '', sanitizeInlineText(description || ''), '');
  return lines.join('\n');
}

router.post('/api/library/clans', express.json(), async (req, res) => {
  try {
    const { name, sect, disciplines, weakness, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(CLANS_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Клан с таким названием уже существует', slug });
    await writeFileAtomic(file, _clanTemplate({ name: name.trim(), sect, disciplines, weakness, source, note, description }), 'utf-8');
    _clanCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/clans/:slug', express.json(), async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(CLANS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Клан не найден' });
    if (!parseClanMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских кланов' });
    const { name, sect, disciplines, weakness, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _clanTemplate({ name: name.trim(), sect, disciplines, weakness, source, note, description }), 'utf-8');
    _clanCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/clans/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(CLANS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Клан не найден' });
    if (!parseClanMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских кланов' });
    const trashDir = path.join(CLANS_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _clanCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: CRUD сект (K4, 2026-08-04) — зеркало clans выше, меньше полей.
function _sectTemplate({ name, source, note, description }) {
  const lines = [`# ${name}`];
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('', '## Описание', '', sanitizeInlineText(description || ''), '');
  return lines.join('\n');
}

router.post('/api/library/sects', express.json(), async (req, res) => {
  try {
    const { name, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(SECTS_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Секта с таким названием уже существует', slug });
    await writeFileAtomic(file, _sectTemplate({ name: name.trim(), source, note, description }), 'utf-8');
    _sectCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/sects/:slug', express.json(), async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(SECTS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Секта не найдена' });
    if (!parseSectMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских сект' });
    const { name, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _sectTemplate({ name: name.trim(), source, note, description }), 'utf-8');
    _sectCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/sects/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(SECTS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Секта не найдена' });
    if (!parseSectMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских сект' });
    const trashDir = path.join(SECTS_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _sectCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: CRUD титулов (2026-08-06) — зеркало сект выше, с двумя
// дополнительными полями: «Принадлежность» (affiliation) и boolean «Негативный».
function _titleTemplate({ name, affiliation, negative, source, note, description }) {
  const lines = [`# ${name}`];
  if (affiliation) lines.push(`- **Принадлежность:** ${sanitizeInlineText(affiliation)}`);
  if (negative) lines.push('- **Негативный:** да');
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('', '## Описание', '', sanitizeInlineText(description || ''), '');
  return lines.join('\n');
}

router.post('/api/library/titles', express.json(), async (req, res) => {
  try {
    const { name, affiliation, negative, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(TITLES_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Титул с таким названием уже существует', slug });
    await writeFileAtomic(file, _titleTemplate({ name: name.trim(), affiliation, negative, source, note, description }), 'utf-8');
    _titleCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/titles/:slug', express.json(), async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(TITLES_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Титул не найден' });
    if (!parseTitleMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских титулов' });
    const { name, affiliation, negative, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _titleTemplate({ name: name.trim(), affiliation, negative, source, note, description }), 'utf-8');
    _titleCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/titles/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(TITLES_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Титул не найден' });
    if (!parseTitleMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских титулов' });
    const trashDir = path.join(TITLES_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _titleCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: загрузка/замена изображения записи (2026-08-08) ─────────────
// Один слот на запись (не как у персонажа — там несколько портретов). Заменяет существующий
// файл тем же путём — writeFileAtomic делает саму перезапись идемпотентной, отдельной ветки
// «файла ещё нет» не требуется. Доступно для ЛЮБОЙ записи, включая каноническую — правка
// канона по духу (не по механике: файл заменяется целиком, не патчится) рискует тем же
// откатом на update.bat, что и правка текста, но цена мягче (не потеря авторского текста).
// Имя kind совпадает с именем каталога и в system/library/<kind>/, и в
// web/public/img/system/library/<kind>/ — везде без исключений, поэтому таблица
// kind → каталог не нужна, путь строится прямо из :kind (проверенного по белому списку).
const LIB_IMAGE_KINDS = new Set([
  'disciplines', 'psychics', 'clans', 'sects', 'titles', 'merits', 'flaws', 'backgrounds',
  'mortal-government', 'mortal-religious', 'mortal-crime', 'mortal-civic', 'mortal-positions',
]);

router.post('/api/library/:kind/:slug/image', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const kind = req.params.kind;
    if (!LIB_IMAGE_KINDS.has(kind)) return res.status(400).json({ error: 'Неизвестная категория библиотеки' });
    const slug = slugify(req.params.slug);   // FIX-17 pattern — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });

    // Только PNG — вся читающая сторона библиотеки жёстко предполагает .png. Фронтенд обязан
    // прислать уже сконвертированный PNG (<canvas>-конвертация, v20-sheet.js).
    const validated = validateImageUpload(req.body.base64, 'png');
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', kind);
    await fs.mkdir(imgDir, { recursive: true });
    await writeFileAtomic(path.join(imgDir, `${slug}.png`), validated.buffer);
    // Ни один *Cache-объект не хранит сам факт hasArt отдельно от чтения каталога на каждый
    // запрос (_artFileSet) — инвалидировать нечего, следующий GET увидит новый файл сразу.
    res.json({ ok: true, url: `/img/system/library/${kind}/${slug}.png` });
  } catch (e) { serverError(res, e); }
});

// ── Обобщённый MD-track CRUD (2026-08-08) — то же обобщение, что _jsonLibRoutes уже сделала
// для JSON-track при добавлении третьей JSON-категории (см. ниже). Кланы/Секты/Титулы НЕ
// переводятся на этот хелпер — своя разметка, есть причина для отдельного кода (у Клана есть
// «Дисциплины»/«Слабость», у Титула — «Принадлежность»/«Негативный») — только 5 новых категорий
// «Смертные», у которых схема идентична друг другу и «Секте» (имя/источник/примечание/описание,
// без специфичных полей).
function _mdLibRoutes({ apiName, dir, noun }) {
  const DIR = path.join(ROOT, 'system', 'library', dir);
  let cache = null; // { sig, list }

  async function load() {
    const files = (await fs.readdir(DIR).catch(() => null));
    if (!files) return [];
    const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
    const stats = await Promise.all(mds.map(f => fs.stat(path.join(DIR, f)).catch(() => null)));
    const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
    if (cache && cache.sig === sig) return cache.list;
    const list = [];
    for (const f of mds) {
      const slug = f.replace(/\.md$/, '');
      const md = await fs.readFile(path.join(DIR, f), 'utf-8').catch(() => '');
      if (md) list.push(parseSectMd(md, slug)); // формат идентичен «Секте» — тот же парсер
    }
    cache = { sig, list };
    return list;
  }

  router.get(`/api/library/${apiName}`, async (_req, res) => {
    try { res.json(_withArt(await load(), await _artFileSet(apiName))); }
    catch (e) { serverError(res, e); }
  });

  function template({ name, source, note, description }) {
    const lines = [`# ${name}`];
    if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
    lines.push('- **Авторское:** да');
    if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
    lines.push('', '## Описание', '', sanitizeInlineText(description || ''), '');
    return lines.join('\n');
  }

  router.post(`/api/library/${apiName}`, express.json(), async (req, res) => {
    try {
      const { name, source, note, description } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      const slug = slugify(name);
      if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
      const file = path.join(DIR, `${slug}.md`);
      if (await fs.stat(file).catch(() => null))
        return res.status(409).json({ error: `${noun} с таким названием уже существует`, slug });
      // В отличие от Кланов/Секты/Титулов, у этих пяти категорий каталог не гарантированно
      // существует заранее (новая библиотека без канонических записей на старте) — mkdir
      // идемпотентен, не мешает уже существующим каталогам с готовым контентом.
      await fs.mkdir(DIR, { recursive: true });
      await writeFileAtomic(file, template({ name: name.trim(), source, note, description }), 'utf-8');
      cache = null;
      res.json({ ok: true, slug });
    } catch (e) { serverError(res, e); }
  });

  router.put(`/api/library/${apiName}/:slug`, express.json(), async (req, res) => {
    try {
      const slug = slugify(req.params.slug);   // FIX-17 pattern — see disciplines PUT above
      if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
      const file = path.join(DIR, `${slug}.md`);
      const existing = await fs.readFile(file, 'utf-8').catch(() => null);
      if (existing == null) return res.status(404).json({ error: `${noun} не найден(а)` });
      if (!parseSectMd(existing, slug).custom)
        return res.status(403).json({ error: `Редактирование доступно только для авторских записей` });
      const { name, source, note, description } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      await writeFileAtomic(file, template({ name: name.trim(), source, note, description }), 'utf-8');
      cache = null;
      res.json({ ok: true, slug });
    } catch (e) { serverError(res, e); }
  });

  router.delete(`/api/library/${apiName}/:slug`, async (req, res) => {
    try {
      const slug = slugify(req.params.slug);   // FIX-17 pattern — see disciplines PUT above
      if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
      const file = path.join(DIR, `${slug}.md`);
      const existing = await fs.readFile(file, 'utf-8').catch(() => null);
      if (existing == null) return res.status(404).json({ error: `${noun} не найден(а)` });
      if (!parseSectMd(existing, slug).custom)
        return res.status(403).json({ error: `Удаление доступно только для авторских записей` });
      const trashDir = path.join(DIR, '_deleted');
      await fs.mkdir(trashDir, { recursive: true });
      await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
      cache = null;
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  return { load };
}

_mdLibRoutes({ apiName: 'mortal-government', dir: 'mortal-government', noun: 'Служба' });
_mdLibRoutes({ apiName: 'mortal-religious',  dir: 'mortal-religious',  noun: 'Организация' });
_mdLibRoutes({ apiName: 'mortal-crime',      dir: 'mortal-crime',      noun: 'Группировка' });
_mdLibRoutes({ apiName: 'mortal-civic',      dir: 'mortal-civic',      noun: 'Организация' });
_mdLibRoutes({ apiName: 'mortal-positions',  dir: 'mortal-positions',  noun: 'Должность' });

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

// ── Постоянные связи (2026-08-08, Фаза 1 «Связи и отношения») — плоский список, без
// категорий (в отличие от достоинств/недостатков), поэтому не через _jsonLibRoutes.
router.get('/api/library/relation-types', async (_req, res) => {
  try { res.json(await getRelationTypes()); }
  catch (e) { serverError(res, e); }
});

router.post('/api/library/relation-types', express.json(), async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const list = await getRelationTypes();
    if (list.some(x => x.slug === slug))
      return res.status(409).json({ error: 'Связь с таким названием уже есть', slug });
    // Цвет — ВСЕГДА генерируется сервером (п.9, «случайным образом»), клиент его не передаёт.
    const entry = { slug, name: name.trim(), color: randomRelColor(), custom: true };
    list.push(entry);
    await writeFileAtomic(RELATION_TYPES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8');
    res.json({ ok: true, slug, color: entry.color });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/relation-types/:slug', express.json(), async (req, res) => {
  try {
    const { slug } = req.params;
    const list = await getRelationTypes();
    const idx = list.findIndex(x => x.slug === slug);
    if (idx === -1) return res.status(404).json({ error: 'Связь не найдена' });
    if (!list[idx].custom) return res.status(403).json({ error: 'Редактирование доступно только для авторских связей' });
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    list[idx] = { ...list[idx], name: name.trim() }; // цвет правкой имени не меняется
    await writeFileAtomic(RELATION_TYPES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/relation-types/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const list = await getRelationTypes();
    const idx = list.findIndex(x => x.slug === slug);
    if (idx === -1) return res.status(404).json({ error: 'Связь не найдена' });
    if (!list[idx].custom) return res.status(403).json({ error: 'Удаление доступно только для авторских связей' });
    list.splice(idx, 1);
    await writeFileAtomic(RELATION_TYPES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = { router, loadDisciplines, loadPsychics };
