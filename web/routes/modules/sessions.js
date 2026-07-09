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
      res.status(500).json({ ok: false, error: e.message });
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
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Edit module fields ─────────────────────────────────────────────────────────


  return router;
};
