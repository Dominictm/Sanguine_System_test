'use strict';
// Роутер архива города: timeline, карта фракций, визитёры, слухи (d20).
// Сырые markdown-документы cities/<city>/archive/*, рендерятся на клиенте.
// Вынесено из server.js (E1.2).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError } = require('../lib/http');
const { archiveDir, cityDir, reqCity, writeFileAtomic, getAllCharacters, getAllLocations } = require('../lib/db');
const {
  parsePoliticalFactions, setPoliticalFactionInfluence, removePoliticalFaction, parseCityMd,
  parseTimelineMd, addTimelineEpoch, removeTimelineEpoch,
  addTimelineRow, updateTimelineRow, removeTimelineRow,
  parseWorldStateBlock, replaceWorldStateBlock, setWorldStateLastUpdate,
  addWorldStateSection, removeWorldStateSection, setWorldStateSectionNote,
  addWorldStateRow, updateWorldStateRow, removeWorldStateRow,
} = require('../lib/parsers');

const router = express.Router();

// Резолвит {kind, slug} → относительная markdown-ссылка от archive/timeline.md
// (персонажи: ../characters/<lineageFolder>/<slug>/<slug>.md; локации:
// ../locations/<dirRelPath>/<slug>.md, где dirRelPath уже содержит district_NN/<район>).
async function _resolveTimelineLink(city, l) {
  const { kind, slug } = l || {};
  if (kind === 'character') {
    const chars = await getAllCharacters(city);
    const c = chars.find(x => x.slug === slug);
    if (!c) return null;
    return { text: c.name, href: `../characters/${c.lineageFolder}/${c.slug}/${c.slug}.md` };
  }
  if (kind === 'location') {
    const locs = await getAllLocations(city);
    const loc = locs.find(x => x.slug === slug);
    if (!loc) return null;
    return { text: loc.name, href: `../locations/${loc.dirRelPath}/${loc.slug}.md` };
  }
  // Готовая ссылка ({text, href} без kind) — модуль/хроника/журнал или связи
  // существующей строки, которые парсер отдаёт без kind/slug. Пропускаем как есть.
  if (l && l.text && l.href) return { text: String(l.text), href: String(l.href) };
  return null;
}
async function _resolveTimelineLinks(city, links) {
  const out = [];
  for (const l of (links || [])) {
    const r = await _resolveTimelineLink(city, l);
    if (r) out.push(r);
  }
  return out;
}

// Raw markdown archive docs — rendered client-side with the lore renderer.
const archiveDoc = file => async (req, res) => {
  try {
    const content = await fs.readFile(path.join(archiveDir(reqCity(req)), file), 'utf-8').catch(() => null);
    res.json({ exists: content !== null, content: content || '' });
  } catch (e) { serverError(res, e); }
};
router.get('/api/timeline', archiveDoc('timeline.md'));          // historical lore (B3)
router.get('/api/factions', archiveDoc('political_state.md'));   // C1 — faction map
router.get('/api/visitors', archiveDoc('visitors.md'));          // C3 — cross-city guests

// ── Faction influence diagram — «Баланс сил — обзор» в political_state.md ─────
// Ручное редактирование 0-100 (шаг 5, см. lib/parsers.js). Список фракций
// подтягивается из city.md → «## Фракции» (CITY_SECTIONS.factions) — те, что там
// перечислены, но ещё не имеют строки в political_state.md, показываются с
// влиянием 0 (виртуально, без записи на диск — станут реальной строкой при
// первой правке через PUT, который уже умеет добавлять недостающие строки).
router.get('/api/factions/influence', async (req, res) => {
  try {
    const city = reqCity(req);
    const raw  = await fs.readFile(path.join(archiveDir(city), 'political_state.md'), 'utf-8').catch(() => '');
    const factions = parsePoliticalFactions(raw);

    const cityRaw = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8').catch(() => '');
    const cityFactionNames = (parseCityMd(cityRaw).sections.factions || '')
      .split('\n').map(s => s.trim()).filter(Boolean);
    const known = new Set(factions.map(f => f.name));
    for (const name of cityFactionNames) {
      if (!known.has(name)) { factions.push({ name, influence: 0, territory: '', threat: '' }); known.add(name); }
    }

    res.json({ factions });
  } catch (e) { serverError(res, e); }
});

router.put('/api/factions/influence', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const name = String(req.body?.name || '').trim();
    const influence = Number(req.body?.influence);
    if (!name) return res.status(400).json({ error: 'Укажи название фракции' });
    if (!Number.isFinite(influence) || influence < 0 || influence > 100)
      return res.status(400).json({ error: 'Влияние: число 0-100' });

    const file = path.join(archiveDir(city), 'political_state.md');
    const raw  = await fs.readFile(file, 'utf-8').catch(() => '');
    const updated = setPoliticalFactionInfluence(raw, name, influence);
    await fs.mkdir(archiveDir(city), { recursive: true });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, factions: parsePoliticalFactions(updated) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/factions/influence/:name', async (req, res) => {
  try {
    const city = reqCity(req);
    const name = decodeURIComponent(req.params.name).trim();
    if (!name) return res.status(400).json({ error: 'Укажи название фракции' });
    const file = path.join(archiveDir(city), 'political_state.md');
    const raw  = await fs.readFile(file, 'utf-8').catch(() => '');
    const { updated, found } = removePoliticalFaction(raw, name);
    if (!found) return res.status(404).json({ error: `Фракция «${name}» не найдена` });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, factions: parsePoliticalFactions(updated) });
  } catch (e) { serverError(res, e); }
});

// ── Хронология мира — структурированное редактирование (эпохи/строки) ────────
router.get('/api/timeline/structured', async (req, res) => {
  try {
    const city = reqCity(req);
    const raw = await fs.readFile(path.join(archiveDir(city), 'timeline.md'), 'utf-8').catch(() => '');
    res.json(parseTimelineMd(raw));
  } catch (e) { serverError(res, e); }
});

router.post('/api/timeline/epoch', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = String(req.body?.heading || '').trim();
    if (!heading) return res.status(400).json({ error: 'Укажи название эпохи' });
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const updated = addTimelineEpoch(raw, heading);
    await fs.mkdir(archiveDir(city), { recursive: true });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/timeline/epoch/:heading', async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const { raw: updated, found } = removeTimelineEpoch(raw, heading);
    if (!found) return res.status(404).json({ error: `Эпоха «${heading}» не найдена` });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});

router.post('/api/timeline/epoch/:heading/row', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const { year, type, event, source, links } = req.body || {};
    if (!String(event || '').trim()) return res.status(400).json({ error: 'Укажи текст события' });
    const resolvedLinks = await _resolveTimelineLinks(city, links);
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const { raw: updated, found } = addTimelineRow(raw, heading,
      { year: year || '', type: type || '', event: event.trim(), source: source || '', links: resolvedLinks });
    if (!found) return res.status(404).json({ error: `Эпоха «${heading}» не найдена` });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});

router.put('/api/timeline/epoch/:heading/row/:index', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const index = Number(req.params.index);
    const { year, type, event, source, links } = req.body || {};
    if (!String(event || '').trim()) return res.status(400).json({ error: 'Укажи текст события' });
    const resolvedLinks = await _resolveTimelineLinks(city, links);
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const { raw: updated, found, indexValid } = updateTimelineRow(raw, heading, index,
      { year: year || '', type: type || '', event: event.trim(), source: source || '', links: resolvedLinks });
    if (!found) return res.status(404).json({ error: `Эпоха «${heading}» не найдена` });
    if (!indexValid) return res.status(409).json({ error: 'Данные изменились, обновите страницу' });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/timeline/epoch/:heading/row/:index', async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const index = Number(req.params.index);
    const file = path.join(archiveDir(city), 'timeline.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    const { raw: updated, found, indexValid } = removeTimelineRow(raw, heading, index);
    if (!found) return res.status(404).json({ error: `Эпоха «${heading}» не найдена` });
    if (!indexValid) return res.status(409).json({ error: 'Данные изменились, обновите страницу' });
    await writeFileAtomic(file, updated, 'utf-8');
    res.json({ ok: true, ...parseTimelineMd(updated) });
  } catch (e) { serverError(res, e); }
});

// ── Состояние мира — структурированное редактирование блока в events.md ──────
// events.md живёт в archiveDir, не в chroniclesDir — тот же путь, что
// findChronicleFile в routes/chronicles.js.
const _eventsFile = city => path.join(archiveDir(city), 'events.md');

router.get('/api/world-state/structured', async (req, res) => {
  try {
    const city = reqCity(req);
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.json({ lastUpdate: null, sections: [] });
    res.json(parseWorldStateBlock(raw) || { lastUpdate: null, sections: [] });
  } catch (e) { serverError(res, e); }
});

router.put('/api/world-state/last-update', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Укажи текст' });
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = setWorldStateLastUpdate(raw, text);
    if (!found) return res.status(404).json({ error: 'Блок «Состояние мира» не найден' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.post('/api/world-state/section', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = String(req.body?.heading || '').trim();
    const columns = Array.isArray(req.body?.columns) ? req.body.columns.map(c => String(c).trim()).filter(Boolean) : [];
    if (!heading) return res.status(400).json({ error: 'Укажи заголовок секции' });
    if (!columns.length) return res.status(400).json({ error: 'Укажи хотя бы одну колонку' });
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = addWorldStateSection(raw, heading, columns);
    if (!found) return res.status(404).json({ error: 'Блок «Состояние мира» не найден' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/world-state/section/:heading', async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = removeWorldStateSection(raw, heading);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.put('/api/world-state/section/:heading/note', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const text = String(req.body?.text || '').trim();
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = setWorldStateSectionNote(raw, heading, text);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.post('/api/world-state/section/:heading/row', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const cells = Array.isArray(req.body?.cells) ? req.body.cells.map(c => String(c || '')) : [];
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = addWorldStateRow(raw, heading, cells);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.put('/api/world-state/section/:heading/row/:index', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const index = Number(req.params.index);
    const cells = Array.isArray(req.body?.cells) ? req.body.cells.map(c => String(c || '')) : [];
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found, indexValid } = updateWorldStateRow(raw, heading, index, cells);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    if (!indexValid) return res.status(409).json({ error: 'Данные изменились, обновите страницу' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/world-state/section/:heading/row/:index', async (req, res) => {
  try {
    const city = reqCity(req);
    const heading = decodeURIComponent(req.params.heading);
    const index = Number(req.params.index);
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found, indexValid } = removeWorldStateRow(raw, heading, index);
    if (!found) return res.status(404).json({ error: `Секция «${heading}» не найдена` });
    if (!indexValid) return res.status(409).json({ error: 'Данные изменились, обновите страницу' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true, ...parseWorldStateBlock(updated) });
  } catch (e) { serverError(res, e); }
});

router.get('/api/world-state/raw', async (req, res) => {
  try {
    const city = reqCity(req);
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.json({ exists: false, content: '' });
    const m = raw.match(/##\s*🌍[^\n]*\n([\s\S]*?)(?=\n##\s)/);
    res.json({ exists: !!m, content: m ? m[1] : '' });
  } catch (e) { serverError(res, e); }
});

router.put('/api/world-state/raw', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const raw = await fs.readFile(_eventsFile(city), 'utf-8').catch(() => null);
    if (raw === null) return res.status(404).json({ error: 'events.md не найден' });
    const { raw: updated, found } = replaceWorldStateBlock(raw, content);
    if (!found) return res.status(404).json({ error: 'Блок «Состояние мира» не найден' });
    await writeFileAtomic(_eventsFile(city), updated, 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// C2 — rumor tables (Elysium d20 / Dreaming d20)
router.get('/api/rumors', async (req, res) => {
  try {
    const which = req.query.type === 'dreaming' ? 'rumors_dreaming.md' : 'rumors_elysium.md';
    const content = await fs.readFile(path.join(archiveDir(reqCity(req)), which), 'utf-8').catch(() => null);
    res.json({ exists: content !== null, content: content || '', type: req.query.type === 'dreaming' ? 'dreaming' : 'elysium' });
  } catch (e) { serverError(res, e); }
});

// PUT — write archive docs back to disk
const _writeArchiveDoc = (file) => async (req, res) => {
  try {
    const city    = reqCity(req);
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const dir = archiveDir(city);
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, file), content, 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
};
router.put('/api/timeline', express.json(), _writeArchiveDoc('timeline.md'));
router.put('/api/factions', express.json(), _writeArchiveDoc('political_state.md'));
router.put('/api/visitors', express.json(), _writeArchiveDoc('visitors.md'));
router.put('/api/rumors', express.json(), async (req, res) => {
  try {
    const city    = reqCity(req);
    const type    = req.body?.type === 'dreaming' ? 'dreaming' : 'elysium';
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const file = type === 'dreaming' ? 'rumors_dreaming.md' : 'rumors_elysium.md';
    const dir  = archiveDir(city);
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, file), content, 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = { router };
