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

module.exports = function fillRouter({ makeGenerationClient, isOA, oaCall }) {
  const router = express.Router();

  router.post('/api/chronicles/:chr/modules/:mod/fill', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city    = reqCity(req);
      const { chr, mod } = req.params;
      const { pcs = [], npcs = [] } = req.body || {};
      let content = (req.body.content || '').trim();
      const cityDisplayName = await getCityDisplayName(city);

      // If content not provided, try to read it from the module's 💡 Концепция section
      if (!content) {
        const mainTxtForConcept = await fs.readFile(
          path.join(chroniclesDir(city), chr, 'modules', mod, `${mod}.md`), 'utf-8').catch(() => '');
        const conceptMatch = mainTxtForConcept.match(/## 💡 Концепция\s*\n+([\s\S]*?)(?=\n##|\n---|\s*$)/);
        if (conceptMatch) content = conceptMatch[1].trim();
      }

      if (!content) return res.status(400).json({ ok: false, error: 'Не заполнено поле «Содержание модуля» и концепция не найдена в файле модуля.' });

      // Read module rules
      const moduleRules = await fs.readFile(
        path.join(ROOT, 'system', 'rules', 'module_rules.md'), 'utf-8').catch(() => '');
      const cityMd = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8').catch(() => '');

      // Read character cards for participants + build a timeline/relations digest
      const chars = await getAllCharacters(city);
      const charCards   = [];
      const charDigests = [];
      for (const name of [...pcs, ...npcs]) {
        const ch = chars.find(c => c.name === name || c.name.toLowerCase() === name.toLowerCase());
        if (!ch) continue;
        const cardPath = path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}.md`);
        const card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
        if (!card) continue;
        const kind = pcs.includes(name) ? 'ПК' : 'НПС';
        charCards.push(`### ${ch.name} (${kind})\n${card.slice(0, 2000)}`);
        charDigests.push(_charTimelineDigest(ch.name, kind, card));
      }

      // Read module title from main file
      const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
      const mainTxt = await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '');
      const titleM  = mainTxt.match(/^#\s+(.+)$/m);
      const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;

      // Module date — for the timeline check (year falls back to the chronicle slug/spine)
      const chronicleMd = await fs.readFile(path.join(chroniclesDir(city), chr, 'chronicle.md'), 'utf-8').catch(() => '');
      const modTime   = (mainTxt.match(/\|\s*\*\*Время\*\*\s*\|\s*([^|\n]+)\|/)?.[1] || '').replace(/⚠️.*/, '').trim();
      const yearGuess = mainTxt.match(/\b(?:19|20)\d{2}\b/)?.[0]
                     || chr.match(/(?:19|20)\d{2}/)?.[0]
                     || chronicleMd.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
      const moduleWhen = [modTime || '', (yearGuess && !modTime.includes(yearGuess)) ? `(${yearGuess})` : '']
        .filter(Boolean).join(' ') || '(не указано)';

      // Catalogs of existing entities — so the AI REUSES them (by exact name) instead of inventing duplicates
      const allLocs    = await getAllLocations(city).catch(() => []);
      const npcCatalog = chars.map(c => `- ${c.name}${c.clan ? ` (${c.clan})` : ''}`).slice(0, 60).join('\n') || '(нет)';
      const locCatalog = allLocs.map(l => `- ${l.name}${l.district ? ` — ${l.district}` : ''}`).slice(0, 60).join('\n') || '(нет)';

      // Локации, уже привязанные Мастером вручную (панель «Связанные локации»
      // на странице модуля) — генерация должна ИСПОЛЬЗОВАТЬ их в сюжете, а не
      // изобретать замену; см. также _forceMergeLinkedLocations ниже.
      const linkedSlugs = _parseModuleLocSlugs(mainTxt);
      const linkedLocs  = linkedSlugs.map(s => allLocs.find(l => l.slug === s)).filter(Boolean);
      const linkedLocCatalog = linkedLocs.length
        ? linkedLocs.map(l => `- ${l.name}${l.district ? ` — ${l.district}` : ''}${l.atmosphere ? `: ${String(l.atmosphere).slice(0, 150)}` : ''}`).join('\n')
        : '';

      const systemPrompt = `Ты — Мастер (Рассказчик) в Vampire: The Masquerade V20. Создаёшь сценарий модуля по правилам игры.

  # ПРАВИЛА МОДУЛЕЙ
  ${moduleRules.slice(0, 3000)}

  # СЕТТИНГ ГОРОДА
  ${cityMd.slice(0, 2000)}

  # УЧАСТНИКИ МОДУЛЯ
  ${charCards.join('\n\n') || '(не указаны)'}

  # ТАЙМЛАЙН И СВЯЗИ УЧАСТНИКОВ (статус, роль, даты и связи — для проверки совместимости с датой модуля)
  ${charDigests.join('\n\n') || '(нет данных)'}

  # СУЩЕСТВУЮЩИЕ НПС (переиспользуй их ИМЕНА БЕЗ ИЗМЕНЕНИЙ, если подходят по смыслу; новых вводи только при необходимости)
  ${npcCatalog}

  # СУЩЕСТВУЮЩИЕ ЛОКАЦИИ — формат «Название — Округ» (переиспользуй НАЗВАНИЯ БЕЗ ИЗМЕНЕНИЙ, если подходят)
  ${locCatalog}
  # ПРАВИЛО ТИПОВЫХ ЛОКАЦИЙ: не выдумывай новых названий для типовых мест (станция метро, кафе, переулок, катакомбы), если в каталоге уже есть место ТОГО ЖЕ ТИПА — используй существующее (по названию). Новое типовое место вводи ТОЛЬКО если действие переносится в округ, где такого места ещё нет; тогда привяжи его к конкретному округу.
  ${linkedLocs.length ? `\n  # ОБЯЗАТЕЛЬНЫЕ ЛОКАЦИИ МОДУЛЯ (привязаны Мастером вручную — используй их в сюжете, НЕ заменяй и не игнорируй)\n  ${linkedLocCatalog}` : ''}`;

      const userPrompt = `Создай полный сценарий (scenario.md) для модуля «${modTitle}» по следующей идее:

  ${content}

  Время действия модуля: ${moduleWhen}
  Персонажи игроков: ${pcs.length ? pcs.join(', ') : '(не указаны)'}
  НПС: ${npcs.length ? npcs.join(', ') : '(не указаны)'}

  ВАЖНО — переиспользование: сначала проверь списки «СУЩЕСТВУЮЩИЕ НПС» и «СУЩЕСТВУЮЩИЕ ЛОКАЦИИ» — если кто-то/что-то подходит, используй ИХ ИМЕНА ДОСЛОВНО. Новых вводи только если среди существующих нет подходящих.
  ${linkedLocs.length ? `\n  ВАЖНО — привязанные локации: модуль уже привязан вручную к локациям из раздела «ОБЯЗАТЕЛЬНЫЕ ЛОКАЦИИ МОДУЛЯ» (${linkedLocs.map(l => l.name).join(', ')}). Хотя бы одна сцена ОБЯЗАНА разворачиваться в каждой из них — не придумывай для них замену и не оставляй неиспользованными.\n` : ''}
  ВАЖНО — проверка таймлайна: сверь дату «${moduleWhen}» с разделом «ТАЙМЛАЙН И СВЯЗИ УЧАСТНИКОВ». Если на эту дату персонаж НЕ МОГ участвовать или его статус/роль был ИНЫМ (ещё не на должности, в торпоре, ещё не обращён/не прибыл, уже уничтожен) — обязательно это отметь в подразделе «### Проверка таймлайна» внутри GM-справки (см. структуру ниже). Если конфликтов нет — напиши «Конфликтов таймлайна не выявлено».

  ВАЖНО — связи: учитывай СВЯЗИ между персонажами (раздел «Связи» в таймлайне) — вплетай их в мотивации, конфликты и сцены, а не игнорируй.

  ВАЖНО — НПС: КАЖДЫЙ НПС, включая эпизодических антагонистов и второстепенных (охотник, информатор, гуль, торговец и т.п.), должен иметь КОНКРЕТНОЕ ИМЯ.

  Структура сценария — ЭТАЛОННЫЙ формат (как в лучших сценариях этой хроники, без изменений порядка и без обёртки «## Сцены» вокруг сцен):

  1. «## 🔒 GM-справка — закрытая информация» — начни с блока-цитаты «> Читать перед игрой. Не раскрывать игроку напрямую.». Подразделы по необходимости: «### Что произошло до начала сессии», «### Тайная мотивация <Персонаж>» (для каждого ключевого антагониста/НПС с секретом), «### Проверка таймлайна» (если есть конфликты — см. выше), «### <Персонаж> — детали» (координация антагонистов, тактика).
  2. «## Пролог — <Название>» — как ПК втягивается в события. Подразделы: «### Описание для игрока», «### GM-подсказки».
  3. «## Сцена 1 — <Название (место, округ)>» … «## Сцена N — …» (3–5 сцен, СРАЗУ на верхнем уровне, НЕ вкладывай их под общий заголовок). Для каждой сцены — переменный набор подразделов по смыслу (не все нужны в каждой сцене): «### Описание для игрока», один или несколько «### Бросок» / «### Бросок — <название>» (характеристика + способность, сложность, результаты по успеху/провалу), «### Тактика <NPC>» и таблица «| Противник | Сила | Ловкость | Здоровье | Примечание |» для боевых столкновений, «### GM-подсказки». ОБЯЗАТЕЛЬНО в КАЖДОЙ сцене (не переменный, а строго обязательный подраздел): «### Колорит» — 2-3 детали места/района/времени, которые нельзя перепутать с другим городом или эпохой.
  4. «## Финал — <Название>» — развязка, теми же переменными подразделами (например «### Поединок — правила», «### Раскрытие», «### GM-подсказки — финал»); «### Колорит» в финале не обязателен.
  5. «## Открытые вопросы после модуля» — таблица «| Вопрос | Нить |», 3–5 строк.
  6. «## Колорит — три обязательные детали» — нумерованный список из 2-3 пунктов: язык, география, Маскарад под давлением (общий колорит всего модуля, отдельно от «### Колорит» внутри каждой сцены).

  ОБЯЗАТЕЛЬНО — служебные метаданные: в самом начале файла, ПЕРЕД первым «##» (после заголовка и ссылок, эта строка не показывается игроку и не рендерится в интерфейсе), добавь строго одной строкой на каждый список:
  <!-- meta:npcs: Имя1; Имя2; Имя3 -->
  <!-- meta:locations: Название1; Название2 -->
  Перечисли ВСЕ конкретные имена НПС (включая эпизодических) и ВСЕ названия локаций, использованные где-либо в сценарии — это единственный способ автоматически создать для них карточки; простое упоминание в прозе карточку не создаст.

  Язык: русский. Стиль: готический нуар, VtM атмосфера.`;

      // Use makeGenerationClient (respects OpenRouter/Claude preference)
      const gen = await makeGenerationClient().catch(() => null);
      let scenarioText = '';

      if (gen && isOA(gen)) {
        scenarioText = await oaCall(gen)(gen.model, systemPrompt, userPrompt, [], 90000, 4000);
      } else if (gen?.client) {
        const msg = await gen.client.messages.create({
          model: 'claude-opus-4-8', max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        scenarioText = msg.content[0]?.text?.trim() || '';
      } else {
        return res.status(503).json({ ok: false, error: 'Нет доступного AI-провайдера. Настрой в Инструменты → Модели AI.' });
      }

      if (!scenarioText) return res.status(500).json({ ok: false, error: 'AI вернул пустой ответ.' });

      // Save as scenario.md
      const scenarioPath = path.join(modDir, 'scenario.md');
      const header = `# Сценарий — ${modTitle}\n\n> 🔗 [Модуль](${mod}.md) | [Хроника](../../events.md) | [НПС](npc.md)\n\n---\n\n`;
      await writeFileAtomic(scenarioPath, header + scenarioText + '\n', 'utf-8');
      console.log(`[fill-module] ${city}/${chr}/${mod}/scenario.md written`);

      // (allLocs + char catalog already loaded above for the generation prompt)

      // First location mentioned in scenario (for the main file's «Локация» cell) —
      // meta:locations (эталонный формат) даёт точный список; иначе — старый
      // регэксп по буквальному «Локация:»/«Место действия:» в тексте.
      const metaLocs    = _extractMetaList(scenarioText, 'locations');
      const locLineMatch = scenarioText.match(/(?:локация|место действия)[^\n:]*[:]\s*([^\n]+)/i);
      const firstLoc = (metaLocs && metaLocs[0]) || (locLineMatch ? locLineMatch[1].replace(/\*\*/g, '').trim() : '');

      // Patch <mod>.md WITHOUT destroying the concept/participants (so re-gen works)
      await _patchModuleMain(modDir, mod, firstLoc)
        .catch(e => console.warn('[fill-module] main patch:', e.message));

      // ── Classify NPCs: existing canonical (reuse) vs new modular ──────────
      const npcCandidates = [...new Set(
        [...npcs, ..._extractNpcNamesFromScenario(scenarioText)]
          .map(s => String(s).trim()).filter(Boolean)
      )];
      const canonNpcs = [];   // { name, char }  — matched an existing card → reuse
      const newNpcs   = [];   // { name }         — no match → generate modular card
      for (const nm of npcCandidates) {
        const hit = chars.find(c => _nameMatch(nm, c.name));
        if (hit) { if (!canonNpcs.some(x => x.char.slug === hit.slug)) canonNpcs.push({ name: hit.name, char: hit }); }
        else if (!newNpcs.some(x => _nameMatch(x.name, nm))) newNpcs.push({ name: nm });
      }

      // ── Classify locations: existing (reuse) vs new (generate card) ───────
      // Reuse priority: (1) same name, (2) same TYPE already exists (don't multiply
      // generic places — e.g. a metro station — when one is already in the city).
      const reusedLocations = [];
      const newLocNames     = [];
      for (const ln of _extractLocNamesFromScenario(scenarioText)) {
        const nameHit = allLocs.find(l => _nameMatch(ln, l.name));
        if (nameHit) {
          if (!reusedLocations.includes(nameHit.name)) reusedLocations.push(nameHit.name);
          continue;
        }
        const type = _locType(ln);
        if (type) {
          const typeHit = allLocs.find(l => _locType(l.name) === type)
                       || allLocs.find(l => _locType(l.slug) === type);
          if (typeHit) {
            if (!reusedLocations.includes(typeHit.name)) reusedLocations.push(typeHit.name);
            console.log(`[fill-module] reuse by type «${type}»: "${ln}" → ${typeHit.name}`);
            continue;
          }
        }
        if (!newLocNames.some(x => _nameMatch(x, ln))) newLocNames.push(ln);
      }
      // Локации, привязанные вручную (см. linkedLocs выше), уже существуют как
      // карточки по определению — учитываем их как «reused» независимо от того,
      // упомянула ли модель их дословно в meta:locations (страховка на случай,
      // если генерация забыла явно их использовать).
      for (const l of linkedLocs) {
        if (!reusedLocations.includes(l.name)) reusedLocations.push(l.name);
      }

      // ── Generate cards for NEW locations only (single AI call) ────────────
      const locSource = req.body?.locSource || null;
      const locModel  = req.body?.locModel  || null;
      const createdLocations = [];
      try {
        if (newLocNames.length > 0) {
          const locGen = await makeGenerationClient(locSource, locModel).catch(() => null);
          const portretRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'portret.md'), 'utf-8').catch(() => '');

          const cardTemplate = (name) => {
            const locSlug = slugify(name);
            return `# 📍 ${name}
  - **Слаг:** ${locSlug}
  - **Родной город:** ${cityDisplayName}
  - **Принадлежность:** Локация модуля

  > **Название:** ${name} | **Округ:** [округ] | **Район:** [район] | **Адрес:** [адрес] | **Зона:** [🟢/🟡/🔴] | **Контроль:** [фракция]
  ---
  ## 🎭 Атмосфера
  [2–3 предложения атмосферного описания]
  ## 👁️ Сенсорная палитра
  | Канал | |
  |---|---|
  | **Свет** | |
  | **Звук** | |
  | **Запах** | |
  | **Тактильное** | |
  ---
  ## 🩸 Контекст Камарильи / Масок
  | | |
  |---|---|
  | **Статус** | |
  | **Фракция** | |
  | **Постоянные фигуры** | |
  | **Угрозы** | |
  | **Маскарад** | 🔴/🟡/🟢 |
  ---
  ## 🔗 Связанные модули
  - [${modTitle}](../../../../chronicles/${chr}/modules/${mod}/${mod}.md)
  ## 🖼️ Изображения
  - ⏳ Изображение не предоставлено`;
          };

          const allCardsPrompt = `Создай карточки локаций для Vampire: The Masquerade V20, ${city || 'Париж'} 2010.

  Правила оформления (кратко):
  ${portretRules.slice(0, 900)}

  Контекст модуля: ${modTitle}
  Сценарий (выдержка): ${scenarioText.slice(0, 350)}

  Создай карточки для КАЖДОЙ из ${newLocNames.length} локаций ниже.
  Верни СТРОГО JSON-массив без лишнего текста вне JSON:
  [{"name":"<название>","content":"<полная карточка markdown>"},...]

  Шаблон каждой карточки:
  ${cardTemplate('«название»')}

  Локации:
  ${newLocNames.map((n, i) => `${i + 1}. «${n}»`).join('\n')}

  Язык: русский. Стиль: готический нуар VtM.`;

          let allLocsRaw = '';
          if (locGen && isOA(locGen)) {
            allLocsRaw = await oaCall(locGen)(locGen.model, '', allCardsPrompt, [], 90000, newLocNames.length * 800 + 200);
          } else if (locGen?.client) {
            const m = await locGen.client.messages.create({
              model: 'claude-haiku-4-5-20251001', max_tokens: newLocNames.length * 800 + 200,
              messages: [{ role: 'user', content: allCardsPrompt }],
            });
            allLocsRaw = m.content[0]?.text || '';
          }

          if (allLocsRaw) {
            const locCards = JSON.parse(allLocsRaw.match(/\[[\s\S]*\]/)?.[0] || '[]');
            // Write all location cards in parallel
            await Promise.all(locCards.map(async ({ name, content }) => {
              if (!name || !content) return;
              const locSlug = slugify(name);
              if (!locSlug) return;
              const locDir  = path.join(locsDir(city), 'Другие', slugify(modTitle), locSlug);
              const locFile = path.join(locDir, `${locSlug}.md`);
              if (await fs.stat(locFile).catch(() => null)) return; // already exists
              await fs.mkdir(locDir, { recursive: true });
              await writeFileAtomic(locFile, content.trim() + '\n', 'utf-8');
              createdLocations.push(name);
              console.log(`[fill-module] location created: ${name}`);
            }));
          }
        }
      } catch (locErr) {
        console.warn('[fill-module] location generation failed:', locErr.message);
      }

      // ── Generate cards for NEW (modular) NPCs only (single AI call) ───────
      const createdNpcs = [];
      if (newNpcs.length > 0) {
        try {
          const npcRules  = await fs.readFile(path.join(ROOT, 'system', 'rules', 'npcs_city.md'), 'utf-8').catch(() => '');
          const tmplM     = npcRules.match(/Шаблон Г[\s\S]*?```markdown\n([\s\S]*?)```/);
          const gTemplate = tmplM ? tmplM[1].trim() : '';
          const npcPrompt = `Создай карточки эпизодических (модульных, неканоничных) НПС для модуля «${modTitle}» — Vampire: The Masquerade V20, ${city || 'Париж'} 2010.

  Идея модуля:
  ${content.slice(0, 800)}

  Сценарий (выдержка):
  ${scenarioText.slice(0, 1200)}

  Для КАЖДОГО из ${newNpcs.length} НПС ниже создай карточку строго по шаблону.
  Заполни характеристики разумными значениями уровня НПС, роль в модуле, внешность (2–3 маркера) и промт для генерации изображения (на английском, 3 блока: Персонаж → Свет/Атмосфера → Стиль).

  Шаблон карточки (заменяй [...] значениями):
  ${gTemplate || '(см. system/rules/npcs_city.md, Шаблон Г)'}

  НПС:
  ${newNpcs.map((n, i) => `${i + 1}. ${n.name}`).join('\n')}

  Верни СТРОГО JSON-массив без лишнего текста вне JSON:
  [{"name":"<имя>","content":"<полная карточка markdown>"},...]

  Язык: русский. Стиль: готический нуар VtM.`;

          let npcRaw = '';
          if (gen && isOA(gen)) {
            npcRaw = await oaCall(gen)(gen.model, '', npcPrompt, [], 90000, newNpcs.length * 900 + 300);
          } else if (gen?.client) {
            const m = await gen.client.messages.create({
              model: 'claude-haiku-4-5-20251001', max_tokens: newNpcs.length * 900 + 300,
              messages: [{ role: 'user', content: npcPrompt }],
            });
            npcRaw = m.content[0]?.text || '';
          }

          if (npcRaw) {
            const npcCards = JSON.parse(npcRaw.match(/\[[\s\S]*\]/)?.[0] || '[]');
            await Promise.all(npcCards.map(async ({ name, content: cardMd }) => {
              if (!name || !cardMd) return;
              const npcSlug = slugify(name);
              if (!npcSlug) return;
              const npcDir  = path.join(modDir, 'npc', npcSlug);
              const npcFile = path.join(npcDir, `${npcSlug}.md`);
              if (await fs.stat(npcFile).catch(() => null)) return; // already exists
              await fs.mkdir(npcDir, { recursive: true });
              await writeFileAtomic(npcFile, cardMd.trim() + '\n', 'utf-8');
              createdNpcs.push(name);
              console.log(`[fill-module] modular NPC created: ${name}`);
            }));
          }
        } catch (npcErr) {
          console.warn('[fill-module] NPC generation failed:', npcErr.message);
        }
      }

      // ── Write npc.md (ПК / Каноничные / Модульные) ────────────────────────
      try {
        await writeFileAtomic(path.join(modDir, 'npc.md'),
          _renderModuleNpcMd(modTitle, mod, pcs, canonNpcs, newNpcs, chars), 'utf-8');
        console.log('[fill-module] npc.md written');
      } catch (npcMdErr) {
        console.warn('[fill-module] npc.md:', npcMdErr.message);
      }

      // ── Timeline / canon quick-check (non-AI, non-blocking) ──────────────
      // Scan generated scenario text for obvious contradictions: dead/missing
      // chars appearing as active participants, and chars mentioned before their
      // embrace year. Warns the Storyteller without blocking generation.
      const timelineWarnings = [];
      try {
        const textLower = scenarioText.toLowerCase();
        for (const c of chars) {
          const nameLower = c.name.toLowerCase();
          if (!textLower.includes(nameLower)) continue;

          // Dead / missing character acting in scenario
          if (c.statusType === 'dead' || c.statusType === 'missing') {
            const label = c.statusType === 'dead' ? 'уничтожен/мёртв' : 'пропал';
            timelineWarnings.push({
              severity: 'high',
              character: c.name,
              issue: `Персонаж со статусом «${label}» упомянут как активный участник`,
            });
          }

          // Mentioned before embrace year
          if (c.embraceYear && !/⚠️/.test(c.embraceYear) && yearGuess) {
            const ey = parseInt(c.embraceYear, 10);
            const my = parseInt(yearGuess, 10);
            if (!isNaN(ey) && !isNaN(my) && my < ey) {
              timelineWarnings.push({
                severity: 'medium',
                character: c.name,
                issue: `Год модуля (${my}) предшествует дате обращения персонажа (${ey})`,
              });
            }
          }
        }
      } catch (warnErr) {
        console.warn('[fill-module] timeline check failed:', warnErr.message);
      }

      // Пост-генерационная проверка: AI-промт просит все 9 обязательных блоков
      // (module_rules.md), но ничего не мешает модели пропустить один из них —
      // предупреждаем Мастера сразу, а не когда это обнаружится в игре.
      const { missing: missingTopics } = checkScenarioStructure(scenarioText);

      res.json({
        ok: true,
        file: `chronicles/${chr}/modules/${mod}/scenario.md`,
        locations: createdLocations,
        reusedLocations,
        npcs: createdNpcs,
        canonNpcs: canonNpcs.map(x => x.char.name),
        timelineWarnings,
        missingTopics,
      });
    } catch (e) {
      console.error('[fill-module]', e.message, e.cause || e.stack || '');
      const detail = e.cause ? `${e.message}: ${e.cause?.message || e.cause}` : e.message;
      res.status(500).json({ ok: false, error: detail });
    }
  });

  // ── Scenario, per-section: manual edit ──────────────────────────────────────
  // Replaces one `## <heading>` block of scenario.md, leaves the rest untouched.

  return router;
};
