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

module.exports = function npcRouter({ makeGenerationClient, generateV20Sheet, ensureSheetLink }) {
  const router = express.Router();

  router.post('/api/chronicles/:chr/modules/:mod/npc', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ error: 'Недопустимое имя' });

      const { name, group = 'modular', initOnly = false } = req.body || {};

      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      const npcMdPath = path.join(modDir, 'npc.md');

      // initOnly: create skeleton npc.md without adding any NPC line
      if (initOnly) {
        if (!await fs.stat(npcMdPath).catch(() => null)) {
          const mainTxt2  = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
          const titleM2   = mainTxt2.match(/^#\s+(.+)$/m);
          const modTitle2 = titleM2 ? titleM2[1].replace(/[*[\]]/g, '').trim() : mod;
          const skeleton = [
            `# НПС модуля: ${modTitle2}`, ``,
            `## 🎭 Игровые персонажи (ПК)`, ``,
            `## 📚 Каноничные НПС`, ``,
            `## 🆕 Модульные НПС`, ``,
          ].join('\n');
          await writeFileAtomic(npcMdPath, skeleton, 'utf-8');
        }
        invalidateChars(city);
        return res.json({ ok: true, initOnly: true });
      }

      if (!name?.trim()) return res.status(400).json({ error: 'Укажи имя' });

      const nm     = name.trim();
      const mainTxt  = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
      const titleM   = mainTxt.match(/^#\s+(.+)$/m);
      const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;

      const allChars = await getAllCharacters(city);

      let cardHref = '';
      let createdCard = false;

      if (group === 'modular') {
        const npcSlug = slugify(nm);
        if (!npcSlug) return res.status(400).json({ error: 'Не удалось сформировать slug из имени' });
        const npcDir  = path.join(modDir, 'npc', npcSlug);
        const npcFile = path.join(npcDir, `${npcSlug}.md`);
        if (!await fs.stat(npcFile).catch(() => null)) {
          await fs.mkdir(npcDir, { recursive: true });
          const stub = [
            `# 🎭 ${nm}`,
            ``,
            `> 🔗 [Модуль](../../${mod}.md)`,
            ``,
            `- **Слаг:** ${npcSlug}`,
            `- **Родной город:** ${await getCityDisplayName(city)}`,
            `- **Линейка WoD:** mortals`,
            `- **Статус:** 🔵 Активен`,
            `- **Принадлежность:** Эпизодический персонаж`,
            `- **Пол:** Неизвестно`,
            ``,
            `## 🖼️ Изображения`,
            `- ⏳ Изображение не предоставлено`,
          ].join('\n');
          await writeFileAtomic(npcFile, stub + '\n', 'utf-8');
          createdCard = true;
        }
        cardHref = `npc/${npcSlug}/${npcSlug}.md`;

      } else if (group === 'canon' || group === 'pc') {
        const ch = allChars.find(c => _nameMatch(nm, c.name));
        if (ch) cardHref = `../../../../characters/${ch.lineageFolder}/${ch.slug}/${ch.slug}.md`;
      }

      // Read current npc.md (create skeleton if missing)
      let npcRaw = await fs.readFile(npcMdPath, 'utf-8').catch(() => '');
      if (!npcRaw) {
        npcRaw = [
          `# НПС модуля: ${modTitle}`,
          ``,
          `## 🎭 Игровые персонажи (ПК)`,
          ``,
          `## 📚 Каноничные НПС`,
          ``,
          `## 🆕 Модульные НПС`,
          ``,
        ].join('\n');
      }

      // Prevent duplicate entries
      if (npcRaw.includes(`- ${nm} —`)) {
        return res.status(409).json({ ok: false, error: 'НПС уже добавлен', name: nm });
      }

      // Build new line
      const line = cardHref
        ? `- ${nm} — ${group === 'pc' ? 'Персонаж игрока' : 'НПС'} → 🔗 [Карточка](${cardHref})`
        : `- ${nm} — ${group === 'pc' ? 'Персонаж игрока' : 'НПС'}`;

      // Insert line under the appropriate section heading
      const headings = {
        pc:      /^## 🎭 Игровые персонажи/m,
        canon:   /^## 📚 Каноничные НПС/m,
        modular: /^## 🆕 Модульные НПС/m,
      };
      const re = headings[group];
      if (re && re.test(npcRaw)) {
        npcRaw = npcRaw.replace(re, (heading) => `${heading}\n${line}`);
      } else {
        npcRaw += `\n${line}\n`;
      }

      await writeFileAtomic(npcMdPath, npcRaw, 'utf-8');
      invalidateChars(city);
      console.log(`[mod-npc-add] ${city}/${chr}/${mod} → ${nm} (${group})`);
      res.json({ ok: true, name: nm, group, createdCard, cardHref });
    } catch (e) {
      console.error('[mod-npc-add]', e.message);
      serverError(res, e);
    }
  });

  // ── Remove one НПС/ПК entry from npc.md («НПС» tab) ───────────────────────────
  // Only drops the reference line for canon/pc entries (the roster character is
  // never touched). Modular (неканоничные) entries also lose their own card
  // folder — npc/<slug>/ only ever existed for this module's npc.md.
  router.delete('/api/chronicles/:chr/modules/:mod/npc', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ error: 'Недопустимое имя' });

      const { name, group } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Укажи имя' });
      if (!['pc', 'canon', 'modular'].includes(group))
        return res.status(400).json({ error: 'Недопустимая группа' });
      const nm = name.trim();

      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      const npcMdPath = path.join(modDir, 'npc.md');
      const rawFile = await fs.readFile(npcMdPath, 'utf-8').catch(() => null);
      if (rawFile == null) return res.status(404).json({ error: 'npc.md отсутствует' });
      const bom = rawFile.charCodeAt(0) === 0xFEFF;
      const text = (bom ? rawFile.slice(1) : rawFile).replace(/\r\n/g, '\n');

      const section = _findNpcMdSection(text, group);
      if (!section) return res.status(404).json({ ok: false, error: 'Раздел не найден в npc.md' });

      const body = text.slice(section.bodyStart, section.end);
      const { body: newBody, removedChunk } = _removeNpcEntry(body, nm);
      if (!removedChunk) return res.status(404).json({ ok: false, error: 'НПС не найден в списке' });

      const newText = text.slice(0, section.bodyStart) + newBody + text.slice(section.end);
      await writeFileAtomic(npcMdPath, (bom ? '﻿' : '') + newText, 'utf-8');

      let cardDeleted = false;
      if (group === 'modular') {
        const hrefM = removedChunk.match(/npc\/([^/]+)\//);
        const slug  = hrefM ? hrefM[1] : slugify(nm);
        const npcDir = path.join(modDir, 'npc', slug);
        if (await fs.stat(npcDir).catch(() => null)) {
          await rmdir(npcDir);
          cardDeleted = true;
        }
      }

      invalidateChars(city);
      console.log(`[mod-npc-rm] ${city}/${chr}/${mod} → ${nm} (${group})${cardDeleted ? ' + карточка npc/' : ''}`);
      res.json({ ok: true, name: nm, group, cardDeleted });
    } catch (e) {
      console.error('[mod-npc-rm]', e.message);
      serverError(res, e);
    }
  });

  // ── Delete-preview for module ─────────────────────────────────────────────────


  router.get('/api/chronicles/:chr/modules/:mod/npc/:slug/sheet', async (req, res) => {
    try {
      const { chr, mod, slug } = req.params;
      const { sheet } = _npcSheetPaths(reqCity(req), chr, mod, decodeURIComponent(slug));
      const content = await fs.readFile(sheet, 'utf-8').catch(() => null);
      res.json({ exists: content !== null, content: content || '' });
    } catch (e) { serverError(res, e); }
  });

  router.post('/api/chronicles/:chr/modules/:mod/npc/:slug/sheet/generate', aiRateLimit, express.json(), async (req, res) => {
    try {
      const { chr, mod, slug } = req.params;
      const p = _npcSheetPaths(reqCity(req), chr, mod, decodeURIComponent(slug));
      const card = await fs.readFile(p.card, 'utf-8').catch(() => '');
      if (!card) return res.status(404).json({ ok: false, error: 'Карточка НПС не найдена' });
      const displayName = (card.match(/^#{1,6}\s+(.+)$/m)?.[1] || slug)
        .replace(/^[^\p{L}]+/u, '').replace(/^карточка\s+нпс\s*:?\s*/i, '').split(/\s*[—–]\s*/)[0].trim();
      const gen  = await makeGenerationClient(req.body?.source || null, req.body?.model || null);
      const text = await generateV20Sheet({ card, displayName, gen });
      if (!text) return res.status(500).json({ ok: false, error: 'ИИ вернул пустой лист' });
      await writeFileAtomic(p.sheet, text + '\n', 'utf-8');
      await ensureSheetLink(p.card, `${decodeURIComponent(slug)}-sheet.md`);
      res.json({ ok: true, content: text });
    } catch (e) { res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ ok: false, error: e.message }); }
  });

  router.put('/api/chronicles/:chr/modules/:mod/npc/:slug/sheet', express.json(), async (req, res) => {
    try {
      const { chr, mod, slug } = req.params;
      const content = String(req.body?.content || '');
      if (!content.trim()) return res.status(400).json({ ok: false, error: 'Пустой лист' });
      const p = _npcSheetPaths(reqCity(req), chr, mod, decodeURIComponent(slug));
      if (!await fs.stat(p.dir).catch(() => null)) return res.status(404).json({ ok: false, error: 'Папка НПС не найдена' });
      await writeFileAtomic(p.sheet, content.replace(/\s*$/, '') + '\n', 'utf-8');
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  // GET /api/chronicles/:chr/modules/:mod/npc/:slug/promote-check
  router.get('/api/chronicles/:chr/modules/:mod/npc/:slug/promote-check', async (req, res) => {
    try {
      const city    = reqCity(req);
      const { chr, mod, slug } = req.params;
      const npcSlug = decodeURIComponent(slug);
      const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(path.join(modDir, 'npc', npcSlug)).catch(() => null))
        return res.status(404).json({ ok: false, error: 'Модульный НПС не найден' });
      const conditions = await _checkNpcPromotion(city, chr, mod, npcSlug);
      const canPromote = conditions.survived && conditions.inFinale && conditions.inMultipleModules;
      res.json({ ok: true, canPromote, conditions });
    } catch (e) { serverError(res, e); }
  });

  // POST /api/chronicles/:chr/modules/:mod/npc/:slug/promote
  // Moves modular NPC into the city's canonical characters folder.
  router.post('/api/chronicles/:chr/modules/:mod/npc/:slug/promote', express.json(), async (req, res) => {
    try {
      const city    = reqCity(req);
      const { chr, mod, slug } = req.params;
      const npcSlug = decodeURIComponent(slug);
      const { lineage = 'vampires', force = false } = req.body || {};

      const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
      const npcDir  = path.join(modDir, 'npc', npcSlug);
      const npcCard = path.join(npcDir, `${npcSlug}.md`);

      if (!await fs.stat(npcCard).catch(() => null))
        return res.status(404).json({ ok: false, error: 'Карточка модульного НПС не найдена' });

      // Check promotion conditions unless force=true
      if (!force) {
        const cond = await _checkNpcPromotion(city, chr, mod, npcSlug);
        if (!cond.survived || !cond.inFinale || !cond.inMultipleModules)
          return res.status(422).json({ ok: false, error: 'Условия продвижения не выполнены', conditions: cond });
      }

      const validLineages = Object.keys(LINEAGE_MAP);
      if (!validLineages.includes(lineage))
        return res.status(400).json({ ok: false, error: `Неверная линейка: ${lineage}` });

      const targetDir = path.join(charsDir(city), lineage, npcSlug);
      if (await fs.stat(targetDir).catch(() => null))
        return res.status(409).json({ ok: false, error: 'Персонаж с таким слагом уже существует в каноне' });

      // Copy NPC folder (card + any art/sheets) to canonical characters directory
      await fs.mkdir(targetDir, { recursive: true });
      const npcFiles = await fs.readdir(npcDir, { withFileTypes: true });
      for (const f of npcFiles) {
        const src = path.join(npcDir, f.name);
        const dst = path.join(targetDir, f.name);
        if (f.isDirectory()) {
          await fs.mkdir(dst, { recursive: true });
          for (const sf of await fs.readdir(src)) {
            await fs.copyFile(path.join(src, sf), path.join(dst, sf));
          }
        } else {
          await fs.copyFile(src, dst);
        }
      }

      // Patch the card: update city field if it has a placeholder
      const cardContent = await fs.readFile(path.join(targetDir, `${npcSlug}.md`), 'utf-8');
      const patched = cardContent.replace(
        /(\*\*Родной\s+город\*\*[^|\n]*\|\s*)(⚠️[^|\n]*|—)(\s*\|)/i,
        (_, pre, _old, post) => `${pre}${city.charAt(0).toUpperCase() + city.slice(1)}${post}`
      );
      if (patched !== cardContent) await writeFileAtomic(path.join(targetDir, `${npcSlug}.md`), patched, 'utf-8');

      // Update characters_index.md
      const idxPath = path.join(archiveDir(city), 'characters_index.md');
      const idxRaw  = await fs.readFile(idxPath, 'utf-8').catch(() => '');
      const name    = (cardContent.match(/^#{1,3}\s+[^\p{L}]*(.+?)(?:\s*[—–].*)?$/mu)?.[1] || npcSlug).trim();
      const idxLine = `- [${name}](../characters/${lineage}/${npcSlug}/${npcSlug}.md) — продвинут из модуля ${mod}\n`;
      if (idxRaw && !idxRaw.includes(npcSlug)) {
        await writeFileAtomic(idxPath, idxRaw.trimEnd() + '\n' + idxLine, 'utf-8');
      }

      // Invalidate character cache so the new canonical char is visible immediately
      invalidateChars(city);

      res.json({ ok: true, slug: npcSlug, lineage, name });
    } catch (e) { serverError(res, e); }
  });

  return router;
};
