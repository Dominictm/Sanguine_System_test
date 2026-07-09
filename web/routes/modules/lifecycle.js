'use strict';
const express = require('express');
const { spawn } = require('child_process');
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

module.exports = function lifecycleRouter({ makeGenerationClient, isOA, oaCall }) {
  const router = express.Router();

  router.get('/api/chronicles/:chr/modules/:mod/delete-preview', async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ error: 'Недопустимое имя' });

      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      // Count MD files
      const allEntries = await fs.readdir(modDir, { recursive: true }).catch(() => []);
      const fileCount  = allEntries.filter(e => String(e).endsWith('.md')).length;

      // Count modular NPCs (subdirectories of npc/)
      let modularNpcs = [];
      try {
        const npcEntries = await fs.readdir(path.join(modDir, 'npc'), { withFileTypes: true });
        modularNpcs = npcEntries.filter(e => e.isDirectory()).map(e => e.name);
      } catch {}

      // Count events in chronicle events.md referencing this module
      const escapedMod = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let eventCount = 0;
      const evTxt = await fs.readFile(
        path.join(chroniclesDir(city), chr, 'events.md'), 'utf-8').catch(() => '');
      if (evTxt) {
        const modRe = new RegExp(`modules/${escapedMod}/`, 'g');
        eventCount = (evTxt.match(modRe) || []).length;
      }

      // Find canonical chars whose journal entries mention this module
      const chars = await getAllCharacters(city).catch(() => []);
      const affectedChars = [];
      const modLinkPat = new RegExp(`modules/${escapedMod}/`);
      for (const ch of chars) {
        const jDir = path.join(charsDir(city), ch.lineageFolder, ch.slug, 'journal');
        const jFiles = await fs.readdir(jDir).catch(() => []);
        for (const f of jFiles) {
          if (!f.endsWith('.md')) continue;
          const txt = await fs.readFile(path.join(jDir, f), 'utf-8').catch(() => '');
          if (modLinkPat.test(txt)) { affectedChars.push(ch.name); break; }
        }
      }

      res.json({ ok: true, fileCount, modularNpcs, eventCount, affectedChars });
    } catch (e) {
      console.error('[mod-delete-preview]', e.message);
      serverError(res, e);
    }
  });

  // ── Delete module ─────────────────────────────────────────────────────────────

  router.delete('/api/chronicles/:chr/modules/:mod', express.json(), async (req, res) => {
    try {
      const city   = reqCity(req);
      const { chr, mod } = req.params;
      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);

      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      // 1. Find episodic NPCs from npc.md in module
      const npcMd = await fs.readFile(path.join(modDir, 'npc.md'), 'utf-8').catch(() => '');
      // Names referenced in npc/ subfolder (module-local cards)
      let npcSubEntries = [];
      try { npcSubEntries = await fs.readdir(path.join(modDir, 'npc'), { withFileTypes: true }); } catch {}
      const episodicSlugs = npcSubEntries.filter(e => e.isDirectory()).map(e => e.name);

      // 2. Find canonical chars referenced in module (for cleanup of module mentions)
      const chars = await getAllCharacters(city);
      const modLinkPat = new RegExp(`modules/${mod}/`, 'i');

      // 3. Clean up diary/journal entries that mention this module in canonical chars
      const cleanedChars = [];
      for (const ch of chars) {
        const journalDir = path.join(charsDir(city), ch.lineageFolder, ch.slug, 'journal');
        let files; try { files = await fs.readdir(journalDir); } catch { continue; }
        for (const f of files) {
          if (!f.endsWith('.md')) continue;
          const fp  = path.join(journalDir, f);
          const txt = await fs.readFile(fp, 'utf-8').catch(() => null);
          if (!txt || !modLinkPat.test(txt)) continue;
          // Remove lines that link to this module
          const cleaned = txt.split('\n').filter(l => !modLinkPat.test(l)).join('\n');
          if (cleaned !== txt) {
            await writeFileAtomic(fp, cleaned, 'utf-8');
            cleanedChars.push(`${ch.name}/${f}`);
          }
        }
      }

      // 4. Remove WHOLE event blocks referencing this module from chronicle events.md
      let removedEvents = 0;
      const evPath = path.join(chroniclesDir(city), chr, 'events.md');
      const evTxt  = await fs.readFile(evPath, 'utf-8').catch(() => null);
      if (evTxt) {
        const nl    = evTxt.replace(/\r\n/g, '\n');
        const parts = nl.split(/\n(?=###\s*📅)/);          // header + per-event blocks
        const modRe = new RegExp(`modules/${mod}/`);
        const kept  = parts.filter((seg, i) => {
          if (i === 0 && !/^###\s*📅/.test(seg.trim())) return true;   // file header
          if (modRe.test(seg)) { removedEvents++; return false; }      // this module's event
          return true;
        });
        const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n');
        if (cleaned !== nl) await writeFileAtomic(evPath, cleaned, 'utf-8');
      }

      // 5. Delete module directory (its npc/ — modular NPCs — go with it)
      await rmdir(modDir);
      await syncChronicleModuleLinks(city, chr);

      // 6. Rebuild the city's aggregate event index (archive/events.md)
      if (removedEvents) {
        await new Promise(resolve => {
          const ps = spawn('node', [path.join(ROOT, 'tools', 'build_city_events.js'), city], { cwd: ROOT });
          ps.on('close', () => resolve()); ps.on('error', () => resolve());
        });
      }
      console.log(`[delete-module] ${city}/${chr}/modules/${mod} | events: ${removedEvents} | diaries: ${cleanedChars.join(', ') || '—'} | npcs: ${episodicSlugs.join(', ') || '—'}`);

      invalidateChars(city);
      res.json({ ok: true, mod, removedEvents, cleanedChars, episodicSlugs });
    } catch (e) {
      console.error('[delete-module]', e.message);
      serverError(res, e);
    }
  });

  // ── Move module to another chronicle ────────────────────────────────────────
  // Moves the whole module directory; events.md entries stay with the ORIGINAL
  // chronicle (they're written at session-log time and reference that chronicle's
  // own timeline) — only the module folder + both chronicles' "## 🔗 Модули" link
  // lists move/update.
  router.put('/api/chronicles/:chr/modules/:mod/move', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      const toChronicle = (req.body?.toChronicle || '').trim();
      if (chr.includes('..') || mod.includes('..') || toChronicle.includes('..'))
        return res.status(400).json({ error: 'Недопустимое имя' });
      if (!toChronicle) return res.status(400).json({ error: 'Укажи целевую хронику' });
      if (toChronicle === chr) return res.json({ ok: true, mod, chronicle: chr });

      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      const toChrDir = path.join(chroniclesDir(city), toChronicle);
      if (!await fs.stat(toChrDir).catch(() => null))
        return res.status(404).json({ error: `Хроника «${toChronicle}» не найдена` });

      const newModDir = path.join(toChrDir, 'modules', mod);
      if (await fs.stat(newModDir).catch(() => null))
        return res.status(409).json({ error: `В хронике «${toChronicle}» уже есть модуль «${mod}»` });

      await fs.mkdir(path.join(toChrDir, 'modules'), { recursive: true });
      await fs.rename(modDir, newModDir);

      await syncChronicleModuleLinks(city, chr);
      await syncChronicleModuleLinks(city, toChronicle);

      invalidateChars(city);
      console.log(`[move-module] ${city}: ${chr}/modules/${mod} → ${toChronicle}/modules/${mod}`);
      res.json({ ok: true, mod, chronicle: toChronicle });
    } catch (e) {
      console.error('[move-module]', e.message);
      serverError(res, e);
    }
  });

  // ── Close module (Phase C — MODULE-close rules, not chronicle-close) ────────────

  router.post('/api/chronicles/:chr/modules/:mod/close', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);
      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ ok: false, error: 'Модуль не найден' });

      const mainTxt     = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
      const scenario    = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8').catch(() => '');
      const sessionsRaw = await fs.readFile(path.join(modDir, 'sessions.md'), 'utf-8').catch(() => '');
      const npcMd       = await fs.readFile(path.join(modDir, 'npc.md'), 'utf-8').catch(() => '');
      const moduleRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'module_rules.md'), 'utf-8').catch(() => '');
      const cityMd      = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8').catch(() => '');

      const titleM   = mainTxt.match(/^#\s+(.+)$/m);
      const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;
      const sessions = _parseSessions(sessionsRaw);
      const playLog  = sessions.map(s => `• ${s.title}${s.scenes ? ` [сцены: ${s.scenes}]` : ''}: ${s.body || ''}`).join('\n')
                    || '(сессии не зафиксированы — опирайся на сценарий)';

      const gen = await makeGenerationClient(req.body?.source || null, req.body?.model || null).catch(() => null);
      if (!gen?.client && !(gen && isOA(gen)))
        return res.status(503).json({ ok: false, error: 'Нет доступного AI-провайдера. Настрой в Инструменты → Модели AI.' });

      // Phase-C rules slice as context (MODULE-close, NOT chronicle-close)
      const phaseC = (moduleRules.match(/Фаза C[\s\S]{0,700}/)?.[0]) || '';
      const baseCtx = `Ты — Рассказчик Vampire: The Masquerade V20. Закрываешь МОДУЛЬ по правилам Фазы C из system/rules/module_rules.md — это НЕ закрытие хроники.

  # СЕТТИНГ ГОРОДА
  ${cityMd.slice(0, 1500)}

  # ПРАВИЛА ЗАКРЫТИЯ МОДУЛЯ (Фаза C)
  ${phaseC}`;

      const runGen = async (system, user, maxTokens) => {
        if (isOA(gen)) {
          return oaCall(gen)(gen.model, system, user, [], 90000, maxTokens);
        }
        const m = await gen.client.messages.create({ model: 'claude-opus-4-8', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
        return m.content[0]?.text?.trim() || '';
      };

      // 1. finale.md — literary finale by what actually happened in play
      let finale = false;
      const finaleText = await runGen(baseCtx,
  `Напиши литературный финал (finale.md) модуля «${modTitle}».

  Сценарий (план):
  ${scenario.slice(0, 2500)}

  Что реально произошло в игре (журнал сессий):
  ${playLog}

  Напиши цельный литературный финал ПО ФАКТАМ ИГРЫ (если игра отступила от сценария — следуй игре). Русский, готический нуар. Верни только текст финала, без метаданных.`, 2500).catch(() => '');
      if (finaleText) {
        const header = `# ${modTitle} — Литературный финал\n\n> 🔗 [Модуль](${mod}.md) | [Хроника](../../events.md)\n\n---\n\n`;
        await writeFileAtomic(path.join(modDir, 'finale.md'), header + finaleText + '\n', 'utf-8');
        finale = true;
      }

      // 2. Canonical event entry → chronicles/<chr>/events.md (transfer from sessions)
      let event = false;
      const eventBlock = await runGen(baseCtx,
  `Собери КАНОНИЧНУЮ запись события для хроники по итогам сыгранного модуля «${modTitle}».

  НПС/участники модуля:
  ${npcMd.slice(0, 1200)}

  Журнал сессий (источник истины):
  ${playLog}

  Формат записи СТРОГО:
  ### 📅 <дата/время> — <краткое название>.

  - **📍 Локация:** <…>
  - **👥 Участники:**
    - <Имя> — <роль>
  - **📋 События:**
    <связный пересказ по фактам игры>
  - **⚖️ Последствия:**
    - <…>

  Верни ТОЛЬКО блок записи, без пояснений. Русский.`, 2000).catch(() => '');
      const trackInChronology = !/\|\s*\*\*Учитывать в хронологии\*\*\s*\|\s*нет\s*\|/i.test(mainTxt);
      if (eventBlock && /###\s*📅/.test(eventBlock) && trackInChronology) {
        const evPath     = path.join(chroniclesDir(city), chr, 'events.md');
        const finaleLink = finale ? ` | [Литературный финал](modules/${mod}/finale.md)` : '';
        const block      = eventBlock.trim() + `\n\n> 🔗 [Модуль](modules/${mod}/${mod}.md)${finaleLink}\n`;
        const evTxt      = (await fs.readFile(evPath, 'utf-8').catch(() => '')).replace(/\s*$/, '');
        await writeFileAtomic(evPath, evTxt + '\n\n' + block, 'utf-8');
        event = true;
      }

      // 3. Mark the module status as closed in the main file
      const today = new Date().toISOString().slice(0, 10);
      let main = mainTxt.replace(/^﻿/, '');
      if (/^-\s*\*\*Статус(?: модуля)?:\*\*/m.test(main))
        main = main.replace(/^(-\s*\*\*Статус(?: модуля)?:\*\*\s*).*$/m, `$1🟢 Закрыт (${today})`);
      else
        main = main.replace(/^(>\s*🔗\s*\[Хроника\][^\n]*)$/m, `$1\n\n- **Статус модуля:** 🟢 Закрыт (${today})`);
      await writeFileAtomic(path.join(modDir, `${mod}.md`), main, 'utf-8');

      // 4. Rebuild the aggregate event index
      if (event) {
        await new Promise(resolve => {
          const ps = spawn('node', [path.join(ROOT, 'tools', 'build_city_events.js'), city], { cwd: ROOT });
          ps.on('close', () => resolve()); ps.on('error', () => resolve());
        });
      }
      invalidateChars(city);

      // 5. Remaining Phase-C steps needing per-character / manual attention
      const reminders = [
        'Дневники участников (journal/) — сгенерировать на вкладке персонажа',
        'Открытые нити (open_threads.md) — внести новые',
        'Модульные НПС — проверить условия продвижения в каноничные (module_rules.md)',
        'tools/validate_links.ps1',
      ];
      console.log(`[close-module] ${city}/${chr}/${mod} | finale=${finale} event=${event}`);
      res.json({ ok: true, finale, event, reminders });
    } catch (e) {
      console.error('[close-module]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });


  return router;
};
