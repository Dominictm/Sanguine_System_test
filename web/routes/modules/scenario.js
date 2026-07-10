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

module.exports = function scenarioRouter({ makeGenerationClient, genTextWithRetry }) {
  const router = express.Router();

  router.put('/api/chronicles/:chr/modules/:mod/scenario/section', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });
      const { heading, content, parent } = req.body || {};
      if (!heading) return res.status(400).json({ ok: false, error: 'Не указан раздел' });

      const scenarioPath = path.join(chroniclesDir(city), chr, 'modules', mod, 'scenario.md');
      const raw = await fs.readFile(scenarioPath, 'utf-8').catch(() => null);
      if (raw == null) return res.status(404).json({ ok: false, error: 'Сценарий не найден' });

      const { sections } = parseScenarioSections(raw);
      if (findScenarioSectionIndex(sections, heading, parent) === -1)
        return res.status(404).json({ ok: false, error: `Раздел «${heading}» не найден` });

      const updated = replaceScenarioSection(raw, heading, content || '', parent);
      await writeFileAtomic(scenarioPath, updated, 'utf-8');
      invalidateChars(city);
      console.log(`[scenario-section] ${city}/${chr}/${mod} → «${heading}» отредактирован вручную`);
      res.json({ ok: true, scenario: updated });
    } catch (e) { serverError(res, e); }
  });

  // ── Scenario, block: batch-save all fields at once («Сохранить всё» в режиме
  // редактирования блока) — один parse/serialize проход вместо N отдельных
  // PUT /scenario/section запросов. ──────────────────────────────────────────
  router.put('/api/chronicles/:chr/modules/:mod/scenario/block/fields', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });
      const fields = Array.isArray(req.body?.fields) ? req.body.fields : [];
      if (!fields.length) return res.status(400).json({ ok: false, error: 'Не переданы поля' });

      const scenarioPath = path.join(chroniclesDir(city), chr, 'modules', mod, 'scenario.md');
      const raw = await fs.readFile(scenarioPath, 'utf-8').catch(() => null);
      if (raw == null) return res.status(404).json({ ok: false, error: 'Сценарий не найден' });

      const replacements = fields.map(f => ({ heading: f.heading, parent: f.parent, body: f.content }));
      const { text, skipped } = replaceScenarioSections(raw, replacements);
      if (skipped.length === fields.length)
        return res.status(404).json({ ok: false, error: 'Ни одно из переданных полей не найдено', skipped });

      await writeFileAtomic(scenarioPath, text, 'utf-8');
      invalidateChars(city);
      console.log(`[scenario-block-fields] ${city}/${chr}/${mod} → сохранено ${fields.length - skipped.length}/${fields.length}`);
      res.json({ ok: true, scenario: text, skipped });
    } catch (e) { serverError(res, e); }
  });

  // ── Scenario: add an empty manual scene before «Финал» (без ИИ) ────────────────
  router.post('/api/chronicles/:chr/modules/:mod/scenario/scene', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });
      const title = String(req.body?.title || '').trim();

      const scenarioPath = path.join(chroniclesDir(city), chr, 'modules', mod, 'scenario.md');
      const raw = await fs.readFile(scenarioPath, 'utf-8').catch(() => null);
      if (raw == null) return res.status(404).json({ ok: false, error: 'Сценарий не найден' });

      const { text, heading } = insertScenarioScene(raw, title);
      await writeFileAtomic(scenarioPath, text, 'utf-8');
      invalidateChars(city);
      console.log(`[scenario-scene] ${city}/${chr}/${mod} → добавлена «${heading}»`);
      res.json({ ok: true, scenario: text, heading });
    } catch (e) {
      console.error('[scenario-scene]', e.message);
      serverError(res, e);
    }
  });

  // ── Scenario, per-section: AI regeneration (учитывает остальной сценарий) ──────
  router.post('/api/chronicles/:chr/modules/:mod/scenario/section/regenerate', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });
      const { heading, parent, pcs = [], npcs = [] } = req.body || {};
      if (!heading) return res.status(400).json({ ok: false, error: 'Не указан раздел' });

      const modDir       = path.join(chroniclesDir(city), chr, 'modules', mod);
      const scenarioPath = path.join(modDir, 'scenario.md');
      const raw = await fs.readFile(scenarioPath, 'utf-8').catch(() => null);
      if (raw == null) return res.status(404).json({ ok: false, error: 'Сценарий не найден' });

      const { sections } = parseScenarioSections(raw);
      const targetIdx = findScenarioSectionIndex(sections, heading, parent);
      const target = targetIdx === -1 ? null : sections[targetIdx];
      if (!target) return res.status(404).json({ ok: false, error: `Раздел «${heading}» не найден` });

      const moduleRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'module_rules.md'), 'utf-8').catch(() => '');
      const cityMd      = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8').catch(() => '');
      const chars       = await getAllCharacters(city);
      const charCards   = [];
      for (const name of [...pcs, ...npcs]) {
        const ch = chars.find(c => c.name === name || c.name.toLowerCase() === name.toLowerCase());
        if (!ch) continue;
        const cardPath = path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}.md`);
        const card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
        if (!card) continue;
        const kind = pcs.includes(name) ? 'ПК' : 'НПС';
        charCards.push(`### ${ch.name} (${kind})\n${card.slice(0, 2000)}`);
      }

      const mainTxt = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
      const titleM  = mainTxt.match(/^#\s+(.+)$/m);
      const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;

      const systemPrompt = `Ты — Мастер (Рассказчик) в Vampire: The Masquerade V20. Переписываешь ОДИН раздел уже существующего сценария модуля — остальные разделы менять нельзя, только использовать их как контекст для согласованности.

# ПРАВИЛА МОДУЛЕЙ
${moduleRules.slice(0, 3000)}

# СЕТТИНГ ГОРОДА
${cityMd.slice(0, 2000)}

# УЧАСТНИКИ МОДУЛЯ
${charCards.join('\n\n') || '(не указаны)'}`;

      const userPrompt = `Полный текущий сценарий модуля «${modTitle}» (для контекста и согласованности — НЕ переписывать целиком):

${raw}

---

Перепиши ТОЛЬКО раздел «${heading}». Его текущее содержание:

${target.body}

Требования:
- Учитывай события, имена, локации и факты из ОСТАЛЬНЫХ разделов сценария — новая версия должна оставаться с ними согласованной, не противоречить уже упомянутому за пределами этого раздела.
- Стиль — тот же, что у остального сценария: готический нуар, VtM атмосфера, русский язык.
- Верни ТОЛЬКО новый текст раздела — без строки заголовка «## ${heading}» и без обрамляющих markdown-разделителей «---».`;

      const gen = await makeGenerationClient().catch(() => null);
      if (!gen) return res.status(503).json({ ok: false, error: 'Нет доступного AI-провайдера. Настрой в Инструменты → Модели AI.' });
      const newBody = (await genTextWithRetry(gen, {
        system: systemPrompt, user: userPrompt, maxTokens: 2500, model: 'claude-opus-4-8',
      })).text.trim();
      if (!newBody) return res.status(500).json({ ok: false, error: 'AI вернул пустой ответ.' });

      const updated = replaceScenarioSection(raw, heading, newBody, parent);
      await writeFileAtomic(scenarioPath, updated, 'utf-8');
      invalidateChars(city);
      console.log(`[scenario-section] ${city}/${chr}/${mod} → «${heading}» перегенерирован`);
      res.json({ ok: true, scenario: updated });
    } catch (e) {
      console.error('[scenario-section-regen]', e.message);
      serverError(res, e);
    }
  });

  // ── Scenario, whole block: AI regeneration (GM-справка / Пролог / Сцена N / Финал
  // целиком — родительский `## ` + все его `### `-поля одним вызовом, с учётом уже
  // имеющегося содержимого блока; остальной сценарий — неизменяемый контекст) ──────
  router.post('/api/chronicles/:chr/modules/:mod/scenario/block/regenerate', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });
      const { heading, pcs = [], npcs = [] } = req.body || {};
      if (!heading) return res.status(400).json({ ok: false, error: 'Не указан блок' });

      const modDir       = path.join(chroniclesDir(city), chr, 'modules', mod);
      const scenarioPath = path.join(modDir, 'scenario.md');
      const raw = await fs.readFile(scenarioPath, 'utf-8').catch(() => null);
      if (raw == null) return res.status(404).json({ ok: false, error: 'Сценарий не найден' });

      const { preamble, sections } = parseScenarioSections(raw);
      const blockIdx = sections.findIndex(s => s.level === 2 && s.heading === heading);
      if (blockIdx === -1) return res.status(404).json({ ok: false, error: `Блок «${heading}» не найден` });
      const children = [];
      for (let j = blockIdx + 1; j < sections.length && sections[j].level === 3 && sections[j].parent === heading; j++)
        children.push(sections[j]);

      // Текущее содержимое блока в исходном markdown-виде — то же, что видит игрок/ГМ,
      // без строки заголовка «## ...» (её AI переписывать не должен: на неё ссылается
      // подбор сцен во вкладке «Сессии»).
      const currentBlockMd = (sections[blockIdx].body ? sections[blockIdx].body + '\n\n' : '')
        + children.map(c => `### ${c.heading}\n\n${c.body}`).join('\n\n');

      const moduleRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'module_rules.md'), 'utf-8').catch(() => '');
      const cityMd      = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8').catch(() => '');
      const chars       = await getAllCharacters(city);
      const charCards   = [];
      for (const name of [...pcs, ...npcs]) {
        const ch = chars.find(c => c.name === name || c.name.toLowerCase() === name.toLowerCase());
        if (!ch) continue;
        const cardPath = path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}.md`);
        const card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
        if (!card) continue;
        const kind = pcs.includes(name) ? 'ПК' : 'НПС';
        charCards.push(`### ${ch.name} (${kind})\n${card.slice(0, 2000)}`);
      }

      const mainTxt = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
      const titleM  = mainTxt.match(/^#\s+(.+)$/m);
      const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;

      const systemPrompt = `Ты — Мастер (Рассказчик) в Vampire: The Masquerade V20. Переписываешь ОДИН смысловой блок уже существующего сценария модуля целиком (заголовок «## ${heading}» со всеми его подразделами «### »)  — остальные блоки менять нельзя, только использовать их как контекст для согласованности.

# ПРАВИЛА МОДУЛЕЙ
${moduleRules.slice(0, 3000)}

# СЕТТИНГ ГОРОДА
${cityMd.slice(0, 2000)}

# УЧАСТНИКИ МОДУЛЯ
${charCards.join('\n\n') || '(не указаны)'}`;

      const userPrompt = `Полный текущий сценарий модуля «${modTitle}» (для контекста и согласованности — НЕ переписывать целиком):

${raw}

---

Перепиши блок «${heading}» целиком, с учётом уже имеющейся информации в нём. Его текущее содержание:

${currentBlockMd}

Требования:
- Учитывай события, имена, локации и факты из ОСТАЛЬНЫХ блоков сценария — новая версия должна оставаться с ними согласованной.
- Можешь свободно менять набор и содержание подразделов «### » внутри блока (добавлять/убирать/переписывать), но не переписывай саму строку заголовка «## ${heading}» — на неё ссылается вкладка «Сессии».
- Если блок — сцена, ОБЯЗАТЕЛЬНО сохрани (или добавь, если не было) подраздел «### Колорит» с 2-3 деталями места/времени, которые нельзя перепутать с другим городом.
- Стиль — тот же, что у остального сценария: готический нуар, VtM атмосфера, русский язык.
- Верни ТОЛЬКО новый текст блока начиная СРАЗУ с первого «### » (без строки заголовка «## ${heading}», без обрамляющих markdown-разделителей «---»). Если нужен вводный текст перед первым «### » — начни с него.`;

      const gen = await makeGenerationClient().catch(() => null);
      if (!gen) return res.status(503).json({ ok: false, error: 'Нет доступного AI-провайдера. Настрой в Инструменты → Модели AI.' });
      const newBlockText = (await genTextWithRetry(gen, {
        system: systemPrompt, user: userPrompt, maxTokens: 3000, model: 'claude-opus-4-8',
      })).text.trim();
      if (!newBlockText) return res.status(500).json({ ok: false, error: 'AI вернул пустой ответ.' });

      const { intro, children: newChildren } = splitH3Body(newBlockText);
      const newSections = [
        ...sections.slice(0, blockIdx),
        { heading, body: intro, level: 2, parent: null },
        ...newChildren.map(c => ({ heading: c.heading, body: c.body, level: 3, parent: heading })),
        ...sections.slice(blockIdx + 1 + children.length),
      ];
      let updated = serializeScenarioSections(preamble, newSections);
      if (isFinaleHeading(heading) && hasManualSceneMarker(updated)) updated = clearManualSceneMarker(updated);
      await writeFileAtomic(scenarioPath, updated, 'utf-8');
      invalidateChars(city);
      console.log(`[scenario-block] ${city}/${chr}/${mod} → блок «${heading}» перегенерирован`);
      res.json({ ok: true, scenario: updated });
    } catch (e) {
      console.error('[scenario-block-regen]', e.message);
      serverError(res, e);
    }
  });

  // ── Append in-play session entry (Phase B) ─────────────────────────────────────


  router.put('/api/chronicles/:chr/modules/:mod/scenario', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ error: 'Недопустимое имя' });
      const content = (req.body?.content || '').trim();
      if (!content) return res.status(400).json({ error: 'Пустой сценарий' });

      const modDir      = path.join(chroniclesDir(city), chr, 'modules', mod);
      const scenarioPath = path.join(modDir, 'scenario.md');

      if (!await fs.stat(modDir).catch(() => null))
        return res.status(404).json({ error: 'Модуль не найден' });

      await writeFileAtomic(scenarioPath, content.endsWith('\n') ? content : content + '\n', 'utf-8');
      invalidateChars(city);
      console.log(`[mod-scenario] ${city}/${chr}/${mod} scenario.md rewritten`);
      res.json({ ok: true });
    } catch (e) {
      console.error('[mod-scenario]', e.message);
      serverError(res, e);
    }
  });


  return router;
};
