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

module.exports = function listRouter() {
  const router = express.Router();

  router.get('/api/modules', async (req, res) => {
    try {
      const city = reqCity(req);
      const mods = [];
      for (const it of await listModules(city)) {
        const mod = { name: it.name, title: it.name, chronicle: it.chronicle };
        try {
          const names = (await fs.readdir(it.dir, { withFileTypes: true })).filter(f => f.isFile()).map(f => f.name);
          mod.hasScenario = names.includes('scenario.md');
          mod.hasFinale   = names.includes('finale.md');
          mod.hasNpc      = names.includes('npc.md');
          // Main file is named after the folder (<slug>.md); fall back to first non-aux .md
          const mainFile = names.includes(`${it.name}.md`) ? `${it.name}.md`
            : names.find(n => n.endsWith('.md') && !MOD_AUX(n));
          if (mainFile) {
            const content = (await fs.readFile(path.join(it.dir, mainFile), 'utf-8')).replace(/^﻿/, '');
            const hm = content.match(/^#\s+(.+)$/m);
            if (hm) mod.title = hm[1].replace(/[*[\]]/g, '').trim();
            for (const [label, key] of [['Тип','type'],['Формат','format'],['Время','time'],['Тон','tone']]) {
              const v = tableCell(content, label);
              if (v != null) mod[key] = v;
            }
          }
        } catch {}
        mods.push(mod);
      }
      res.json(mods);
    } catch (e) { serverError(res, e); }
  });

  // ── Modules by chronicle ──────────────────────────────────────────────────────

  router.get('/api/chronicles/:slug/modules', async (req, res) => {
    try {
      const city = reqCity(req);
      const slug = req.params.slug;
      const chrDir = path.join(chroniclesDir(city), slug);
      if (!await fs.stat(chrDir).catch(() => null)) return res.status(404).json({ error: 'Хроника не найдена' });

      const mods = [];
      let mEntries; try { mEntries = await fs.readdir(path.join(chrDir, 'modules'), { withFileTypes: true }); } catch { mEntries = []; }

      for (const e of mEntries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const dir   = path.join(chrDir, 'modules', e.name);
        const mod   = { name: e.name, title: e.name, chronicle: slug };
        try {
          const names = (await fs.readdir(dir, { withFileTypes: true })).filter(f => f.isFile()).map(f => f.name);
          mod.hasScenario = names.includes('scenario.md');
          mod.hasFinale   = names.includes('finale.md');
          mod.hasNpc      = names.includes('npc.md');
          const mainFile  = names.includes(`${e.name}.md`) ? `${e.name}.md` : names.find(n => n.endsWith('.md') && !MOD_AUX(n));
          if (mainFile) {
            const content = (await fs.readFile(path.join(dir, mainFile), 'utf-8')).replace(/^﻿/, '');
            const hm = content.match(/^#\s+(.+)$/m);
            if (hm) mod.title = hm[1].replace(/[*[\]]/g, '').trim();
            for (const [label, key] of [['Тип','type'],['Формат','format'],['Время','time'],['Тон','tone']]) {
              const v = tableCell(content, label);
              if (v != null) mod[key] = v;
            }
          }
        } catch {}
        mods.push(mod);
      }
      res.json(mods);
    } catch (e) { serverError(res, e); }
  });

  // ── Create module in chronicle ────────────────────────────────────────────────

  router.post('/api/chronicles/:slug/modules', express.json(), async (req, res) => {
    try {
      const city   = reqCity(req);
      const chr    = req.params.slug;
      const { name, time } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Укажи название модуля' });
      if (!time?.trim()) return res.status(400).json({ error: 'Укажи время/дату модуля — это нужно для проверки таймлайна (желательно с годом)' });

      const modSlug = req.body.slug?.trim() || slugify(name.trim());
      if (!modSlug) return res.status(400).json({ error: 'Не удалось сформировать slug' });

      const modDir = path.join(chroniclesDir(city), chr, 'modules', modSlug);
      if (await fs.stat(modDir).catch(() => null))
        return res.status(409).json({ error: `Модуль «${modSlug}» уже существует` });

      await fs.mkdir(modDir, { recursive: true });
      const timeStr   = (time || '').trim();
      const typeStr   = (req.body.type || '').trim() || 'Игровая сессия';
      const toneStr   = (req.body.tone || '').trim();
      const formatStr = (req.body.format || '').trim();
      const pcs       = Array.isArray(req.body.pcs)  ? req.body.pcs  : [];
      const npcs      = Array.isArray(req.body.npcs) ? req.body.npcs : [];
      const concept   = (req.body.content || '').trim();
      const track     = req.body.trackInChronology !== false; // default true

      const pcBlock  = pcs.length  ? pcs.map(n  => `  - ${n} — Персонаж игрока`).join('\n') : '  - ⚠️ Уточнить';
      const npcBlock = npcs.length ? npcs.map(n => `  - ${n} — НПС`).join('\n')             : '  - ⚠️ Уточнить';

      const mainContent = [
        `# ${name.trim()}`,
        '> Хроника | Vampire: The Masquerade V20 / Changeling: The Dreaming',
        '',
        '> 🔗 [Хроника](../../events.md)',
        '',
        '---',
        '',
        '| Параметр | Значение |',
        '|---|---|',
        `| **Тип** | ${typeStr} |`,
        `| **Формат** | ${formatStr} |`,
        `| **Время** | ${timeStr || '⚠️ Уточнить'} |`,
        `| **Тон** | ${toneStr} |`,
        `| **Учитывать в хронологии** | ${track ? 'да' : 'нет'} |`,
        '',
        '---',
        '',
        '## 👥 Участники',
        '',
        '**Персонажи игроков:**',
        pcBlock,
        '',
        '**НПС:**',
        npcBlock,
        '',
        ...(concept ? [
          '---',
          '',
          '## 💡 Концепция',
          '',
          concept,
          '',
        ] : [
          '---',
          '',
          '*Краткое содержание — см. запись хроники.*',
          '',
        ]),
      ].join('\n');

      await writeFileAtomic(path.join(modDir, `${modSlug}.md`), mainContent, 'utf-8');
      await syncChronicleModuleLinks(city, chr);
      console.log(`[create-module] ${city}/${chr}/modules/${modSlug}`);
      res.json({ ok: true, slug: modSlug, title: name.trim() });
    } catch (e) {
      console.error('[create-module]', e.message);
      serverError(res, e);
    }
  });

  // ── Fill module: generate scenario.md ────────────────────────────────────────


  router.get('/api/modules/:name', async (req, res) => {
    try {
      const city = reqCity(req);
      const name = decodeURIComponent(req.params.name);
      if (!/^[^/\\]+$/.test(name)) return res.status(400).json({ error: 'bad name' });
      const it = (await listModules(city)).find(m => m.name === name);
      if (!it) return res.status(404).json({ error: 'Модуль не найден' });

      const names = (await fs.readdir(it.dir, { withFileTypes: true })).filter(f => f.isFile() && f.name.endsWith('.md')).map(f => f.name);
      const read  = async fn => (fn && names.includes(fn) ? fs.readFile(path.join(it.dir, fn), 'utf-8').catch(() => null) : null);
      const mainName = names.includes(`${name}.md`) ? `${name}.md` : (names.find(n => !MOD_AUX(n)) || null);

      const out = { name, title: name, chronicle: it.chronicle };
      out.main     = await read(mainName);
      out.scenario = await read('scenario.md');
      out.finale   = await read('finale.md');
      out.npc      = await read('npc.md');

      if (out.main) {
        const hm = out.main.match(/^#\s+(.+)$/m);
        if (hm) out.title = hm[1].replace(/[*[\]]/g, '').trim();
      }
      res.json(out);
    } catch (e) { serverError(res, e); }
  });

  // ── Module detail ─────────────────────────────────────────────────────────────

  router.get('/api/chronicles/:chr/modules/:mod/detail', async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      const modDir = path.join(chroniclesDir(city), chr, 'modules', mod);

      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      const result = {
        name: mod, chronicle: chr, chronicleDisplay: await getChronicleDisplay(city, chr),
        title: mod, pcs: [], npcs: [], locations: [], events: [],
      };

      // 1. Main module file — title, metadata, participants, description
      const mainRaw = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
      if (mainRaw) {
        const mc = mainRaw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const hm = mc.match(/^#\s+(.+)$/m);
        if (hm) result.title = hm[1].replace(/[*[\]]/g, '').trim();

        for (const [label, key] of [['Тип','type'],['Формат','format'],['Время','time'],['Тон','tone'],['Локация','location']]) {
          const v = tableCell(mc, label);
          if (v != null) result[key] = v;
        }
        result.trackInChronology = !/\|\s*\*\*Учитывать в хронологии\*\*\s*\|\s*нет\s*\|/i.test(mc);

        // Module status (bullet line written on close: «- **Статус модуля:** 🟢 Закрыт …»)
        const stM = mc.match(/^-\s*\*\*Статус(?: модуля)?:\*\*\s*(.+)$/m);
        if (stM) result.status = stM[1].trim();

        // Description: prefer the «💡 Концепция» section (the module idea).
        // Fall back to free text between a --- divider and the first ## section,
        // but never surface the metadata table itself.
        const conceptM = mc.match(/##\s*💡\s*Концепция\s*\n+([\s\S]*?)(?=\n##|\n---|\s*$)/);
        if (conceptM && conceptM[1].trim()) {
          result.description = conceptM[1].trim();
        } else {
          for (const m of mc.matchAll(/\n---\s*\n+([\s\S]+?)(?=\n##|\n---|\s*$)/g)) {
            const block = m[1].trim();
            if (block && !block.startsWith('|')) { result.description = block; break; }
          }
        }

        // Participants: ## 👥 Участники или Действующие лица section
        // Find the section header and extract content until next ##
        const sectMatch = mc.match(/^##\s*[^\s]*?\s*(?:Участники|Действующие\s+лица)\s*\n/m);
        if (sectMatch) {
          const startIdx = mc.indexOf(sectMatch[0]) + sectMatch[0].length;
          const restContent = mc.substring(startIdx);
          const nextSectionIdx = restContent.search(/\n##[^#]/);
          const section = nextSectionIdx === -1 ? restContent : restContent.substring(0, nextSectionIdx);

          // Parse both formats:
          // 1. Bullet format: `- [Name](path) — Role`
          // 2. Subsection format: `### Emoji Name — Role`
          for (const line of section.split('\n')) {
            const t = line.trim();
            if (!t) continue;

            // Format 1: bullet list items `- [Name](path) — Role` or `- Name — Role`
            // Only process if it looks like a participant (has valid name and role)
            if (t.startsWith('-') && /[—–]/.test(t)) {
              const m = t.match(/^-\s+\[?([^\]()—–\n]+?)\]?(?:\([^)]*\))?\s*(?:[—–]\s*(.*))?$/);
              if (!m) continue;
              let name = m[1].trim();
              // Strip leading emoji/symbol if present (anything that's not a Cyrillic/Latin letter or common punctuation)
              name = name.replace(/^[^\p{L}]+/u, '').trim();
              // Skip if it starts with a quote or looks like descriptive text (not a name)
              if (/^[«"'«»]|^\d+\.|\s{2,}/.test(name) || name.length > 100) continue;
              const role = (m[2] || '').trim();
              // Validate role looks reasonable (not too long, not just a quote continuation)
              if (!role || role.length > 200 || /^[«"']$/.test(role)) continue;
              if (/персонаж игрока|ПК\b/i.test(role)) result.pcs.push({ name, role });
              else result.npcs.push({ name, role: role || 'НПС' });
            }
            // Format 2: subsection headers (### Emoji Name — Role)
            else if (t.startsWith('###')) {
              // Extract everything after ### (skip emoji), then split on em/en-dash
              const afterHash = t.replace(/^###\s+/, '').trim();
              if (!afterHash) continue;
              const parts = afterHash.split(/\s*[—–]\s*/);
              if (parts.length === 0) continue;
              // First part is name (may include role in parentheses)
              let name = parts[0].trim();
              let role = parts[1] ? parts[1].trim() : '';
              // Strip leading emoji/symbol from name (anything that's not a Cyrillic/Latin letter)
              name = name.replace(/^[^\p{L}]+/u, '').trim();
              // Extract name from "Name (role)" format if needed
              const nameMatch = name.match(/^([^()]+?)(?:\s*\(([^)]+)\))?$/);
              if (nameMatch) {
                name = nameMatch[1].trim();
                if (!role && nameMatch[2]) role = nameMatch[2].trim();
              }
              if (!name) continue;
              if (/персонаж игрока|ПК\b/i.test(role)) result.pcs.push({ name, role });
              else result.npcs.push({ name, role: role || 'НПС' });
            }
          }
        }
      }

      // 2. Scenario content
      result.scenario = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8').catch(() => '');

      // 2b. Literary finale (написан при закрытии модуля — Фаза C)
      result.finale = await fs.readFile(path.join(modDir, 'finale.md'), 'utf-8').catch(() => '');

      // 3. NPC details from npc.md
      result.npcContent = await fs.readFile(path.join(modDir, 'npc.md'), 'utf-8').catch(() => '');
      result.npcGroups  = _parseNpcMdGroups(result.npcContent);

      // Enrich each NPC with sheet status: episodic → npc/<slug>/<slug>-sheet.md, canonical → char's sheet
      {
        const allChars = await getAllCharacters(city).catch(() => []);
        for (const g of result.npcGroups) {
          for (const e of g.entries) {
            if (g.kind === 'modular') {
              const m = (e.cardHref || '').match(/npc\/([^/]+)\//);
              let slug = m ? m[1] : slugify(e.name);
              if (!await fs.stat(path.join(modDir, 'npc', slug)).catch(() => null)) {
                // Ссылка в npc.md устарела (папку переименовали, например при
                // коллизии слагов, а ссылку не обновили) — ищем реальную папку
                // по имени в карточке, а не молча 404-им на промоушене/листе.
                const npcEntries = await fs.readdir(path.join(modDir, 'npc'), { withFileTypes: true }).catch(() => []);
                for (const entry of npcEntries) {
                  if (!entry.isDirectory()) continue;
                  const card = await fs.readFile(path.join(modDir, 'npc', entry.name, `${entry.name}.md`), 'utf-8').catch(() => '');
                  const hm = card.match(/^#\s+(.+)$/m);
                  if (hm && _nameMatch(hm[1].replace(/[*[\]]/g, '').trim(), e.name)) { slug = entry.name; break; }
                }
              }
              e.slug = slug;
              e.sheetScope = 'module';
              e.hasSheet = !!(await fs.stat(path.join(modDir, 'npc', e.slug, `${e.slug}-sheet.md`)).catch(() => null));
              e.promoteCheck = await _checkNpcPromotion(city, chr, mod, e.slug).catch(() => null);
              // Модульные (неканоничные) НПС редко имеют art/ — но если завели
              // (см. tools/new_npc.js-подобный workflow вручную), карточка на
              // вкладке НПС должна показать её, как это уже делают локации.
              const artFiles = await fs.readdir(path.join(modDir, 'npc', e.slug, 'art')).catch(() => []);
              const imgFile = artFiles.find(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
              if (imgFile) {
                e.imageUrl = `/city-img/${city}/chronicles/${chr}/modules/${mod}/npc/${encodeURIComponent(e.slug)}/art/${encodeURIComponent(imgFile)}`;
              }
            } else {
              const ch = allChars.find(c => c.name === e.name) || allChars.find(c => _nameMatch(c.name, e.name));
              e.slug = ch?.slug || null;
              e.sheetScope = 'character';
              e.hasSheet = ch
                ? !!(await fs.stat(path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}-sheet.md`)).catch(() => null))
                : false;
              e.imageUrl = ch?.imageUrl || null;
              e.lineage  = ch?.lineage || null;
              e.clan     = ch?.clan || ch?.lineageLabel || null;
            }
          }
        }
      }

      // 3b. In-play session log (Phase B)
      result.sessions = _parseSessions(
        await fs.readFile(path.join(modDir, 'sessions.md'), 'utf-8').catch(() => ''));

      // 4. Events — prefer the module's own scenes («Сцены») from scenario.md;
      //    fall back to the chronicle's events.md.
      const scenes = _parseScenarioScenes(result.scenario);
      result.scenes = scenes; // raw scenario scenes (for the session scene-picker)
      if (scenes.length) {
        result.events = scenes;
      } else {
        const evRaw = await fs.readFile(path.join(chroniclesDir(city), chr, 'events.md'), 'utf-8').catch(() => '');
        if (evRaw) {
          const ec = evRaw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          ec.split(/\n(?=###\s*📅)/).filter(c => /^###\s*📅/.test(c.trim())).forEach(c => {
            const ev = parseEvent(c.trim(), result.events.length);
            ev.chronicle = chr;
            result.events.push(ev);
          });
        }
      }

      // 5. Open threads — prefer the module's own «Открытые нити / Крючки» from
      //    scenario.md; fall back to chronicle-level, then city archive.
      const scenarioThreads = _extractScenarioSection(result.scenario, /Открыт|Крючк|Зацепк/i);
      result.openThreads = scenarioThreads
        || await fs.readFile(path.join(chroniclesDir(city), chr, 'open_threads.md'), 'utf-8').catch(() => null)
        || await fs.readFile(path.join(cityDir(city), 'archive', 'open_threads.md'), 'utf-8').catch(() => '');

      // 6. Locations — parse the «Локации» section of scenario.md (robust to
      //    `- **Name** — desc`, `- Name → 🔗 …` and `### Name` subsection formats).
      result.locations = _parseScenarioLocations(result.scenario);

      // 7. Linked locations — explicit slugs from «## 📍 Связанные локации» in module .md
      const linkedSlugs = _parseModuleLocSlugs(mainRaw);
      if (linkedSlugs.length) {
        const allLocs = await getAllLocations(city);
        result.linkedLocations = linkedSlugs.map(s => allLocs.find(l => l.slug === s) || { slug: s });
      } else {
        result.linkedLocations = [];
      }

      res.json(result);
    } catch (e) {
      console.error('[module-detail]', e.message);
      serverError(res, e);
    }
  });

  // ── Module location sub-resource endpoints ────────────────────────────────────


  return router;
};
