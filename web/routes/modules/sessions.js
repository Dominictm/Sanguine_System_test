'use strict';
const express = require('express');
const {
  path, fs, serverError, aiRateLimit,
  ROOT, cityDir, charsDir, locsDir, chroniclesDir, archiveDir,
  reqCity, writeFileAtomic, invalidateChars,
  getAllCharacters, getAllLocations, listModules, tableCell, LINEAGE_MAP,
  _nameMatch, rmdir, getChronicleDisplay,
  slugify, parseEvent, parseScenarioSections, replaceScenarioSection, replaceScenarioSections,
  splitH3Body, serializeScenarioSections, findScenarioSectionIndex, checkScenarioStructure,
  insertScenarioScene, hasManualSceneMarker, clearManualSceneMarker, isFinaleHeading,
  MOD_AUX, syncChronicleModuleLinks, getCityDisplayName, _npcSheetPaths, _checkNpcPromotion,
  _cleanLocName, _locType, _extractMetaList, _extractLocNamesFromScenario, _extractNpcNamesFromScenario,
  _renderModuleNpcMd, _charTimelineDigest, _extractScenarioSection, _SCENE_HEADING_RE,
  _parseScenarioScenesDirect, _parseScenarioScenesLegacy, _parseScenarioScenes, _parseScenarioLocations,
  _parseModuleLocSlugs, _writeModuleLocSlugs, _parseSessions, _cleanNpcName, _npcCardHref,
  _parseNpcEntries, _findNpcMdSection, _removeNpcEntry, _parseNpcMdGroups, _renderSessionBlock,
  _writeSessionsFile, _patchModuleMain,
  _upsertSceneNoteEntry, _upsertModuleSection, _readModuleSection,
  unescapeFreeformBody,
} = require('./shared');

module.exports = function sessionsRouter() {
  const router = express.Router();

  router.post('/api/chronicles/:chr/modules/:mod/session', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ ok: false, error: 'Модуль не найден' });

      const date   = (req.body?.date   || '').trim();
      const status = (req.body?.status || '').trim();
      const scenes = (req.body?.scenes || '').trim();
      const notes  = (req.body?.notes  || '').trim();
      if (!notes && !scenes)
        return res.status(400).json({ ok: false, error: 'Заполни «Что произошло» или «Сыграно сцен»' });

      const raw = await fs.readFile(path.join(modDir, 'sessions.md'), 'utf-8').catch(() => '');
      const sessions = _parseSessions(raw);
      sessions.push({ date, scenes, status, body: notes });
      await _writeSessionsFile(modDir, mod, sessions);
      console.log(`[module-session] ${city}/${chr}/${mod} → session ${sessions.length}`);
      res.json({ ok: true, n: sessions.length });
    } catch (e) {
      console.error('[module-session]', e.message);
      serverError(res, e);
    }
  });

  // ── Edit an existing session entry (Phase B) ───────────────────────────────────

  router.put('/api/chronicles/:chr/modules/:mod/session/:idx', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod, idx } = req.params;
      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      const raw = await fs.readFile(path.join(modDir, 'sessions.md'), 'utf-8').catch(() => '');
      const sessions = _parseSessions(raw);
      const i = parseInt(idx, 10);
      if (!Number.isInteger(i) || i < 0 || i >= sessions.length)
        return res.status(404).json({ ok: false, error: 'Запись сессии не найдена' });

      const date   = (req.body?.date   || '').trim();
      const status = (req.body?.status || '').trim();
      const scenes = (req.body?.scenes || '').trim();
      const notes  = (req.body?.notes  || '').trim();
      if (!notes && !scenes)
        return res.status(400).json({ ok: false, error: 'Заполни «Что произошло» или «Сыграно сцен»' });

      sessions[i] = { date, scenes, status, body: notes };
      await _writeSessionsFile(modDir, mod, sessions);
      console.log(`[module-session] ${city}/${chr}/${mod} → edit session ${i + 1}`);
      res.json({ ok: true, n: i + 1 });
    } catch (e) {
      console.error('[module-session-edit]', e.message);
      serverError(res, e);
    }
  });

  // ── Delete an existing session entry (Phase B) ─────────────────────────────────

  router.delete('/api/chronicles/:chr/modules/:mod/session/:idx', async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod, idx } = req.params;
      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      const raw = await fs.readFile(path.join(modDir, 'sessions.md'), 'utf-8').catch(() => '');
      const sessions = _parseSessions(raw);
      const i = parseInt(idx, 10);
      if (!Number.isInteger(i) || i < 0 || i >= sessions.length)
        return res.status(404).json({ ok: false, error: 'Запись сессии не найдена' });

      sessions.splice(i, 1);
      await _writeSessionsFile(modDir, mod, sessions);
      console.log(`[module-session] ${city}/${chr}/${mod} → delete session ${i + 1}`);
      res.json({ ok: true, n: sessions.length });
    } catch (e) {
      console.error('[module-session-delete]', e.message);
      serverError(res, e);
    }
  });

  // ── Scene notes (scene_notes.md) — per-scene freeform notes taken during play.
  //    Одна сцена может доигрываться в нескольких игровых сессиях подряд, поэтому
  //    каждая сцена хранит СПИСОК записей, по одной на сессию (### Сессия N —
  //    см. _upsertSceneNoteEntry в shared.js), а не единственный плоский текст. ──

  router.get('/api/chronicles/:chr/modules/:mod/scene-notes', async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });

      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ ok: false, error: 'Модуль не найден' });

      const raw = await fs.readFile(path.join(modDir, 'scene_notes.md'), 'utf-8').catch(() => '');
      const { sections } = parseScenarioSections(raw);
      const notesByHeading = {};
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        if (s.level !== 2) continue;
        const entries = [];
        // Заметка, сохранённая ДО разбивки по сессиям (плоское тело без
        // ###-детей) — не теряем, отдаём первой записью без номера сессии.
        if (s.body) entries.push({ session: null, text: unescapeFreeformBody(s.body) });
        for (let j = i + 1; j < sections.length && sections[j].level === 3 && sections[j].parent === s.heading; j++) {
          const m = sections[j].heading.match(/^Сессия\s+(\d+)$/);
          entries.push({ session: m ? parseInt(m[1], 10) : null, text: unescapeFreeformBody(sections[j].body) });
        }
        notesByHeading[s.heading] = entries;
      }
      res.json(notesByHeading);
    } catch (e) {
      console.error('[scene-notes]', e.message);
      serverError(res, e);
    }
  });

  router.put('/api/chronicles/:chr/modules/:mod/scene-note', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });

      const heading = (req.body?.heading || '').trim();
      const session = parseInt(req.body?.session, 10);
      const text    = (req.body?.text    || '');
      if (!heading)
        return res.status(400).json({ ok: false, error: 'Укажи заголовок сцены' });
      if (!Number.isInteger(session) || session < 1)
        return res.status(400).json({ ok: false, error: 'Укажи номер сессии' });

      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ ok: false, error: 'Модуль не найден' });

      const notesPath = path.join(modDir, 'scene_notes.md');
      const raw = await fs.readFile(notesPath, 'utf-8').catch(() => '# Заметки сцен\n\n');
      const updated = _upsertSceneNoteEntry(raw, heading, session, text);
      await writeFileAtomic(notesPath, updated, 'utf-8');
      console.log(`[scene-note] ${city}/${chr}/${mod} → «${heading}» (Сессия ${session})`);
      res.json({ ok: true });
    } catch (e) {
      console.error('[scene-note]', e.message);
      serverError(res, e);
    }
  });

  // ── Session notes (## 📝 Заметки сессии внутри <mod>.md) ───────────────────────

  router.get('/api/chronicles/:chr/modules/:mod/session-notes', async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });

      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ ok: false, error: 'Модуль не найден' });

      const text = await _readModuleSection(modDir, mod, '📝 Заметки сессии');
      res.json({ text });
    } catch (e) {
      console.error('[session-notes]', e.message);
      serverError(res, e);
    }
  });

  router.put('/api/chronicles/:chr/modules/:mod/session-notes', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });

      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ ok: false, error: 'Модуль не найден' });

      const text = req.body?.text || '';
      await _upsertModuleSection(modDir, mod, '📝 Заметки сессии', text);
      console.log(`[session-notes] ${city}/${chr}/${mod} → updated`);
      res.json({ ok: true });
    } catch (e) {
      console.error('[session-notes]', e.message);
      serverError(res, e);
    }
  });

  // ── Edit module fields ─────────────────────────────────────────────────────────


  return router;
};
