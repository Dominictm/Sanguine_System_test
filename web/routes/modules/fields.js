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

module.exports = function fieldsRouter() {
  const router = express.Router();

  router.put('/api/chronicles/:chr/modules/:mod/fields', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ error: 'Недопустимое имя' });
      const fields = req.body?.fields || {};
      const skipped = [];

      const modPath = path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`);
      let raw = await fs.readFile(modPath, 'utf-8').catch(() => null);
      if (!raw) return res.status(404).json({ error: 'Файл модуля не найден' });
      // BOM (из PowerShell-редакторов) ломает ^-якоря регексов — H1 молча не патчится
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

      for (const [key, val] of Object.entries(fields)) {
        if (val === undefined || val === null) continue;

        if (key === 'title') {
          const v = String(val).trim();
          if (v) raw = raw.replace(/^#\s+.+$/m, `# ${v}`);

        } else if (['type', 'time', 'location', 'tone', 'format'].includes(key)) {
          const labels = { type: 'Тип', time: 'Время', location: 'Локация', tone: 'Тон', format: 'Формат' };
          const label  = labels[key];
          const v = String(val).trim();
          const cellRe = new RegExp(`(\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*)([^|\\n]*)(\\|)`);
          if (cellRe.test(raw)) {
            raw = raw.replace(cellRe, `$1${v} $3`);
          } else if (v) {
            // Строки ещё нет в файле (модуль создан до появления поля, либо файл
            // собран вручную/ИИ без него) — добавляем новую строку в таблицу
            // параметров, а не молча теряем значение.
            const sepRe = /(\|\s*Параметр\s*\|\s*Значение\s*\|\r?\n\|---\|---\|\r?\n)/;
            if (sepRe.test(raw)) {
              const nl = /\r\n/.test(raw) ? '\r\n' : '\n';
              raw = raw.replace(sepRe, `$1| **${label}** | ${v} |${nl}`);
            } else skipped.push(key);
          }

        } else if (key === 'trackInChronology') {
          const label = 'Учитывать в хронологии';
          const v = val ? 'да' : 'нет';
          const cellRe = new RegExp(`(\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*)([^|\\n]*)(\\|)`);
          if (cellRe.test(raw)) {
            raw = raw.replace(cellRe, `$1${v} $3`);
          } else {
            const sepRe = /(\|\s*Параметр\s*\|\s*Значение\s*\|\r?\n\|---\|---\|\r?\n)/;
            if (sepRe.test(raw)) {
              const nl = /\r\n/.test(raw) ? '\r\n' : '\n';
              raw = raw.replace(sepRe, `$1| **${label}** | ${v} |${nl}`);
            } else skipped.push(key);
          }

        } else if (key === 'description') {
          const v = String(val).trim();
          // Replace section between «## 💡 Концепция» header and next ## or ---
          if (/## 💡 Концепция/.test(raw)) {
            raw = raw.replace(
              /(## 💡 Концепция\s*\n)([\s\S]*?)(?=\n## |\n---|$)/,
              `$1\n${v}\n\n`
            );
          }

        } else if (key === 'pcs') {
          const arr = Array.isArray(val) ? val : JSON.parse(String(val) || '[]');
          const block = arr.length
            ? arr.map(n => `  - ${n} — Персонаж игрока`).join('\n')
            : '  - ⚠️ Уточнить';
          raw = raw.replace(
            /(\*\*Персонажи игроков:\*\*\s*\n)((?:[ \t]*- [^\n]+\n?)*)/,
            `$1${block}\n`
          );

        } else if (key === 'npcs') {
          const arr = Array.isArray(val) ? val : JSON.parse(String(val) || '[]');
          const block = arr.length
            ? arr.map(n => `  - ${n} — НПС`).join('\n')
            : '  - ⚠️ Уточнить';
          raw = raw.replace(
            /(\*\*НПС:\*\*\s*\n)((?:[ \t]*- [^\n]+\n?)*)/,
            `$1${block}\n`
          );
        }
      }

      await writeFileAtomic(modPath, raw, 'utf-8');
      invalidateChars(city);
      console.log(`[mod-fields] ${city}/${chr}/${mod} →`, Object.keys(fields).join(', '));
      res.json({ ok: true, ...(skipped.length ? { skipped } : {}) });
    } catch (e) {
      console.error('[mod-fields]', e.message);
      serverError(res, e);
    }
  });

  // ── Replace scenario.md ────────────────────────────────────────────────────────


  router.put('/api/chronicles/:chr/modules/:mod/finale', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ error: 'Недопустимое имя' });
      const content = (req.body?.content || '').trim();
      if (!content) return res.status(400).json({ error: 'Пустой финал' });

      const modDir    = path.join(chroniclesDir(city), chr, 'modules', mod);
      const finalePath = path.join(modDir, 'finale.md');

      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      await writeFileAtomic(finalePath, content.endsWith('\n') ? content : content + '\n', 'utf-8');
      invalidateChars(city);
      console.log(`[mod-finale] ${city}/${chr}/${mod} finale.md rewritten`);
      res.json({ ok: true });
    } catch (e) {
      console.error('[mod-finale]', e.message);
      serverError(res, e);
    }
  });

  // ── Add single NPC to module ───────────────────────────────────────────────────


  return router;
};
