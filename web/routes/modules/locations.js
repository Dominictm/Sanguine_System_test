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

module.exports = function locationsRouter() {
  const router = express.Router();

  router.get('/api/chronicles/:chr/modules/:mod/locations', async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      const modFile = path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`);
      if (!await fs.stat(modFile).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      const mainRaw    = await fs.readFile(modFile, 'utf-8').catch(() => '');
      const linkedSlugs = _parseModuleLocSlugs(mainRaw);
      const allLocs    = await getAllLocations(city);
      const linked     = linkedSlugs.map(s => allLocs.find(l => l.slug === s) || { slug: s });
      res.json({ linked, extracted: _parseScenarioLocations(mainRaw) });
    } catch (e) { serverError(res, e); }
  });

  router.post('/api/chronicles/:chr/modules/:mod/locations', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      const { slug: locSlug } = req.body || {};
      if (!locSlug) return res.status(400).json({ error: 'slug обязателен' });

      const modFile = path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`);
      if (!await fs.stat(modFile).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      let raw      = await fs.readFile(modFile, 'utf-8');
      const existing = _parseModuleLocSlugs(raw);
      if (!existing.includes(locSlug)) {
        existing.push(locSlug);
        raw = _writeModuleLocSlugs(raw, existing);
        await writeFileAtomic(modFile, raw, 'utf-8');
      }
      res.json({ ok: true, slugs: existing });
    } catch (e) { serverError(res, e); }
  });

  router.delete('/api/chronicles/:chr/modules/:mod/locations/:locSlug', async (req, res) => {
    try {
      const city       = reqCity(req);
      const { chr, mod, locSlug } = req.params;
      const decodedSlug = decodeURIComponent(locSlug);

      const modFile = path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`);
      if (!await fs.stat(modFile).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      let raw = await fs.readFile(modFile, 'utf-8');
      const existing = _parseModuleLocSlugs(raw);
      const filtered = existing.filter(s => s !== decodedSlug);
      if (filtered.length !== existing.length) {
        raw = _writeModuleLocSlugs(raw, filtered);
        await writeFileAtomic(modFile, raw, 'utf-8');
      }
      res.json({ ok: true, slugs: filtered });
    } catch (e) { serverError(res, e); }
  });


  return router;
};
