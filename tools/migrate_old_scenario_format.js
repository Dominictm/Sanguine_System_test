'use strict';
// Миграция старого формата scenario.md (GM-справка / «### Бросок» с ветвлением
// Успех:/Провал: / закрывающие «Открытые вопросы после модуля» и колорит-сводка)
// в новый упрощённый 3-блочный (Пролог / Сцена N / Финал) — см. упрощение шаблона
// 2026-08-09 (system/rules/module_rules.md) и техспеку
// docs/design/2026-08-11-analyst-review-fixes-techspec.md, раздел F4.
//
// НЕ зарегистрирован в tools/migrations/ и НЕ запускается автоматически при
// старте сервера (в отличие от обычных миграций, tools/migrations/README.md) —
// это правка прозы уже сыгранного/утверждённого контента реальных хроник, не
// переименование поля. Запуск только вручную:
//
//   node tools/migrate_old_scenario_format.js            — dry-run (по умолчанию)
//   node tools/migrate_old_scenario_format.js --apply     — реальная запись на диск
//
// Идемпотентна: повторный --apply на уже мигрированном файле — canAutoMigrate()
// возвращает false (GM-справки/Открытых вопросов больше нет), файл пропускается.
//
// Безопасность: скрипт НЕ гадает на структурах, которые не узнаёт (whitelist
// ролей секций, F4.2) — такие файлы пропускаются целиком с явной причиной в
// логе, не трогаются частично. Данные проекта уже под git — это и есть
// встроенная сеть безопасности для --apply, отдельный бэкап не нужен.

const fs = require('fs');
const path = require('path');
const {
  parseScenarioSections, serializeScenarioSections, isFinaleHeading, _SCENE_HEADING_RE,
} = require('../web/routes/modules/shared');

const ROOT = path.join(__dirname, '..');
const CITIES_DIR = path.join(ROOT, 'cities');

// Реальные файлы вперемешку используют ASCII-дефис (U+002D) и типографский
// неразрывный дефис (U+2011, «GM‑подсказки») — иногда оба варианта в ОДНОМ
// файле (vstrecha_v_parke.md: большинство «GM-подсказки» через ASCII, но
// «GM‑подсказки — финал» — через U+2011). Регексы на «GM<дефис>подсказки/справка»
// обязаны принимать оба, иначе findChild() не находит существующий подраздел и
// создаёт дубль вместо дополнения существующего (поймано на живом дифе razborki_na_reke).
const _DASH = '[-‑–—]';
const GM_BRIEF_RE = new RegExp(`GM${_DASH}справк`, 'i');
const GM_TIPS_RE = new RegExp(`GM${_DASH}подсказк`, 'i');

// ── Классификация top-level (## ) секций старого формата ────────────────────
function classifySection(heading) {
  if (GM_BRIEF_RE.test(heading)) return 'gmBrief';
  if (_SCENE_HEADING_RE.test(heading)) return 'scene';
  if (/Открыт.{0,3}(вопрос|крючк|зацепк)/i.test(heading)) return 'openThreads';
  if (/колорит/i.test(heading)) return 'closingFlavor';
  return 'unknown';
}

// Обычный preamble (H1 + хлебная крошка-ссылка + «---») — 100-450 символов на
// реальных файлах (проверено на всех 6 затронутых). 700 — с запасом, но ловит
// файл-выброс (progulki_po_metro.md — 1820 символов: буквально утёкшие
// рассуждения AI «Давайте создадим сценарий... Сначала проверю таймлайн» плюс
// GM-справка под H1 вместо H2, из-за чего целиком осела в preamble и не видна
// parseScenarioSections вообще — единственная причина, почему её не ловит
// unknown-секция ниже: для парсера там просто нет `## `-заголовков до «Пролог»).
const MAX_NORMAL_PREAMBLE = 700;

// Файл подходит под автомиграцию, только если КАЖДАЯ top-level секция узнана
// (whitelist), есть хотя бы один Пролог, вообще есть что парсить, и preamble не
// подозрительно длинный. Любое отклонение — файл пропускается целиком, не
// мигрируется частично.
function canAutoMigrate(raw) {
  const { preamble, sections } = parseScenarioSections(raw);
  if (preamble.length > MAX_NORMAL_PREAMBLE) {
    return { ok: false, reason: `preamble подозрительно длинный (${preamble.length} символов, обычно ≤${MAX_NORMAL_PREAMBLE}) — похоже на утёкшие рассуждения AI или секцию под неверным уровнем заголовка, нужна ручная проверка` };
  }
  const top = sections.filter(s => s.level === 2);
  if (!top.length) return { ok: false, reason: 'не найдено ни одной ## -секции (пустой или повреждённый файл)' };
  const unknown = top.find(s => classifySection(s.heading) === 'unknown');
  if (unknown) return { ok: false, reason: `неизвестная секция: «${unknown.heading}»` };
  const hasProlog = top.some(s => classifySection(s.heading) === 'scene' && /^Пролог/i.test(s.heading));
  if (!hasProlog) return { ok: false, reason: 'не найден «## Пролог»' };
  return { ok: true };
}

// Нужна ли вообще миграция — файл уже в новом формате (нет GM-справки, нет
// закрывающих секций, нет Успех:/Провал: ветвления ни в одном «### Бросок*»)?
function needsMigration(raw) {
  const { sections } = parseScenarioSections(raw);
  const top = sections.filter(s => s.level === 2);
  if (top.some(s => ['gmBrief', 'openThreads', 'closingFlavor'].includes(classifySection(s.heading)))) return true;
  const rollChildren = sections.filter(s => s.level === 3 && /^Бросок/i.test(s.heading));
  // Не переиспользовать глобальный _OUTCOME_RE.test() в .some() — global-флаг делает
  // .test() статeful (lastIndex переживает между вызовами на РАЗНЫХ строках), из-за
  // чего .some() по нескольким «### Бросок*» одной сцены может молча пропустить
  // совпадение. Отдельный non-global regex только для проверки наличия.
  return rollChildren.some(c => _HAS_OUTCOME_RE.test(c.body));
}

const _HAS_OUTCOME_RE = /^\s*-\s*\*\*(Успех|Провал)[^*]*\*\*/im;
// Строка-буллет «**Успех...**»/«**Провал...**» + весь текст до следующего такого
// буллета (или до конца тела) — блок исхода броска, целиком. .match()/.replace()
// с global-флагом безопасны для повторного использования (spec сбрасывает
// lastIndex=0 в начале каждого вызова) — в отличие от .test() выше.
const _OUTCOME_RE = /^\s*-\s*\*\*(Успех|Провал)[^*]*\*\*[^\n]*(\n(?!\s*-\s*\*\*)[^\n]*)*/gim;

function extractOutcomes(body) {
  const outcomes = body.match(_OUTCOME_RE);
  if (!outcomes) return null;
  const compact = body.replace(_OUTCOME_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  return { compact, outcomeText: outcomes.join('\n').trim() };
}

// «Дубликат» — каждая непустая строка закрывающей колорит-сводки узнаваемо (по
// первым ~20 символам, не точное совпадение — переформулировка не в счёт)
// присутствует хотя бы в одном per-scene «### Колорит»/«### <Город> колорит».
function isRedundantClosingFlavor(closingBody, sceneFlavorBodies) {
  const closingLines = String(closingBody || '').split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
  // Пусто = переносить нечего, удалить безопасно. Важно: сюда должен приходить
  // текст ВМЕСТЕ с ### -детьми секции (takeSectionWithChildren) — раньше
  // передавался только s.body, и секция, весь текст которой лежал в детях,
  // выглядела пустой и удалялась как «дубликат» (кодревью 2026-08-11).
  if (!closingLines.length) return true;
  // Не с чем сравнивать — значит не дубликат (иначе .every() по пустому
  // allSceneText дал бы false только из-за includes, но при пустом списке
  // сцен-колоритов вернее явно сказать «не дубликат», чем полагаться на это).
  if (!sceneFlavorBodies.length) return false;
  const allSceneText = sceneFlavorBodies.join('\n').toLowerCase();
  return closingLines.every(line => allSceneText.includes(line.slice(0, 20).toLowerCase()));
}

function findChild(sections, parentHeading, re) {
  return sections.find(s => s.level === 3 && s.parent === parentHeading && re.test(s.heading));
}

// Забирает секцию верхнего уровня ВМЕСТЕ со всеми её ### -детьми: возвращает её
// содержимое одним куском (дети становятся **жирными** подзаголовками, как и при
// переносе GM-справки) и удаляет из массива и саму секцию, и детей.
//
// Кодревью 2026-08-11: раньше каждое из трёх мест (GM-справка / Открытые вопросы /
// колорит-сводка) брало только s.body и не трогало детей — их текст молча пропадал,
// а лог рапортовал об успешном переносе. Плюс splice по индексу, посчитанному ДО
// вставки нового узла, мог снести не то (если вставка пришлась выше по массиву).
// Оба класса ошибок закрываются одним правилом: забрать содержимое и удалить
// секцию ПЕРЕД любой вставкой — тогда индексы не взаимодействуют вообще.
//
// parseScenarioSections кладёт детей непосредственно за родителем, поэтому
// splice(idx, 1 + children.length) снимает ровно эту группу.
function takeSectionWithChildren(sections, idx) {
  const heading  = sections[idx].heading;
  const children = sections.filter(s => s.level === 3 && s.parent === heading);
  const text = [
    sections[idx].body || null,
    ...children.map(c => `**${c.heading}**\n\n${c.body}`),
  ].filter(Boolean).join('\n\n');
  sections.splice(idx, 1 + children.length);
  return { text, childCount: children.length, heading };
}

// Вставляет level-3 узел сразу после последнего ребёнка указанного родителя.
// serializeScenarioSections собирает детей, идя от родителя подряд, поэтому
// «просто push в конец массива» работает, только если родитель — последний
// level-2 блок; вставка по месту надёжна при любом порядке секций.
function insertAfterLastChild(sections, parentHeading, node) {
  let at = sections.findIndex(s => s.level === 2 && s.heading === parentHeading) + 1;
  while (at < sections.length && sections[at].level === 3 && sections[at].parent === parentHeading) at++;
  sections.splice(at, 0, node);
}

// ── Основной алгоритм — см. techspec F4.3 ────────────────────────────────────
function migrateScenarioFormat(raw) {
  const { preamble, sections } = parseScenarioSections(raw);
  const notes = [];
  const MARKER = '_(перенесено при миграции формата, 2026-08-11)_';

  // 1. GM-справка → прозой в GM-подсказки Пролога.
  const gmIdx = sections.findIndex(s => s.level === 2 && classifySection(s.heading) === 'gmBrief');
  if (gmIdx !== -1) {
    const prolog = sections.find(s => s.level === 2 && classifySection(s.heading) === 'scene' && /^Пролог/i.test(s.heading));
    // Забираем и удаляем ДО вставки (см. takeSectionWithChildren) — иначе при
    // GM-справке, стоящей ПОСЛЕ Пролога, удаление по устаревшему индексу сносило
    // только что вставленный узел и весь секретный текст пропадал.
    const taken = takeSectionWithChildren(sections, gmIdx);
    const prologHeading = prolog?.heading;
    if (!prologHeading) {
      // canAutoMigrate() требует наличия Пролога, так что сюда попасть нельзя —
      // но текст ценнее аккуратности: возвращаем секцию на место, а не теряем.
      sections.splice(gmIdx, 0, { heading: taken.heading, body: taken.text, level: 2, parent: null });
      notes.push(`ВНИМАНИЕ: «${taken.heading}» не перенесена — не найден «## Пролог». Секция оставлена как была.`);
    } else {
      const prologGmTips = findChild(sections, prologHeading, GM_TIPS_RE);
      if (prologGmTips) {
        prologGmTips.body = `${prologGmTips.body}\n\n---\n\n${MARKER}\n\n${taken.text}`;
      } else {
        insertAfterLastChild(sections, prologHeading, { heading: 'GM-подсказки', body: `${MARKER}\n\n${taken.text}`, level: 3, parent: prologHeading });
      }
      notes.push(`GM-справка (${taken.childCount} подраздел${taken.childCount === 1 ? '' : 'а'}) перенесена в «${prologHeading}» → ### GM-подсказки`);
    }
  }

  // 2. Каждая сцена: «### Бросок*» с Успех:/Провал: → компактная строка +
  //    исходы в GM-подсказки той же сцены.
  const sceneHeadings = sections.filter(s => s.level === 2 && classifySection(s.heading) === 'scene').map(s => s.heading);
  for (const sceneHeading of sceneHeadings) {
    const rollChildren = sections.filter(s => s.level === 3 && s.parent === sceneHeading && /^Бросок/i.test(s.heading));
    for (const child of rollChildren) {
      const extracted = extractOutcomes(child.body);
      if (!extracted) continue; // уже компактный — нечего переносить
      child.body = extracted.compact;
      const outcomeBlock = `_Исходы броска «${child.heading}» ${MARKER.replace(/^_|_$/g, '')}:_\n\n${extracted.outcomeText}`;
      let sceneGmTips = findChild(sections, sceneHeading, GM_TIPS_RE);
      if (sceneGmTips) {
        sceneGmTips.body = `${sceneGmTips.body}\n\n${outcomeBlock}`;
      } else {
        const childIdx = sections.indexOf(child);
        let insertAt = childIdx + 1;
        while (insertAt < sections.length && sections[insertAt].level === 3 && sections[insertAt].parent === sceneHeading) insertAt++;
        sections.splice(insertAt, 0, { heading: 'GM-подсказки', body: outcomeBlock, level: 3, parent: sceneHeading });
      }
      notes.push(`«${sceneHeading}» → «${child.heading}»: исходы Успех/Провал вынесены в GM-подсказки`);
    }
    // «### Тактика X», «### Бой с Y» и подобные НЕ трогаем — не запрещены новым
    // форматом (переменный набор подразделов «по смыслу»), просто больше не
    // генерируются AI. Удаление — потеря механической информации без замены,
    // не входит в объём этой миграции.
  }

  // 3. Открытые вопросы/крючки → подраздел Финала.
  const openIdx = sections.findIndex(s => s.level === 2 && classifySection(s.heading) === 'openThreads');
  if (openIdx !== -1) {
    const finale = sections.find(s => s.level === 2 && isFinaleHeading(s.heading));
    if (!finale) {
      // Раньше секция УДАЛЯЛАСЬ вместе с текстом, а в лог писалось предупреждение.
      // Нет цели переноса — оставляем как есть: устаревший формат лучше потери.
      notes.push(`ВНИМАНИЕ: «${sections[openIdx].heading}» найдена, но нет «## Финал» — оставлена как была, перенеси вручную`);
    } else {
      const taken = takeSectionWithChildren(sections, openIdx);
      insertAfterLastChild(sections, finale.heading, { heading: 'Открытые вопросы', body: taken.text, level: 3, parent: finale.heading });
      notes.push(`«${taken.heading}» (${taken.childCount} подраздел${taken.childCount === 1 ? '' : 'а'}) перенесена в «${finale.heading}» → ### Открытые вопросы`);
    }
  }

  // 4. Закрывающая колорит-сводка — dedup-проверка (F4.4), не слепое удаление.
  const closingIdx = sections.findIndex(s => s.level === 2 && classifySection(s.heading) === 'closingFlavor');
  if (closingIdx !== -1) {
    const closingHeading = sections[closingIdx].heading;
    // Сравниваем с per-scene «### Колорит», ИСКЛЮЧАЯ собственных детей закрывающей
    // секции — иначе она сравнивается сама с собой и всегда выглядит дубликатом.
    const sceneFlavorBodies = sections
      .filter(s => s.level === 3 && /колорит/i.test(s.heading) && s.parent !== closingHeading)
      .map(s => s.body);
    const finale = sections.find(s => s.level === 2 && isFinaleHeading(s.heading));
    const taken  = takeSectionWithChildren(sections, closingIdx);

    if (isRedundantClosingFlavor(taken.text, sceneFlavorBodies)) {
      notes.push(`«${closingHeading}» — чистый дубликат per-scene «### Колорит», удалена без переноса`);
    } else if (finale) {
      insertAfterLastChild(sections, finale.heading, { heading: 'Колорит — сводка', body: `${MARKER}\n\n${taken.text}`, level: 3, parent: finale.heading });
      notes.push(`ВНИМАНИЕ: «${closingHeading}» содержит НЕ дублирующий текст — перенесена в «${finale.heading}» → ### Колорит — сводка, нужна ручная проверка`);
    } else {
      // Не дубликат и переносить некуда — возвращаем на место, а не теряем.
      sections.splice(closingIdx, 0, { heading: closingHeading, body: taken.text, level: 2, parent: null });
      notes.push(`ВНИМАНИЕ: «${closingHeading}» содержит не дублирующий текст, но нет «## Финал» — оставлена как была, нужна ручная проверка`);
    }
  }

  return { text: serializeScenarioSections(preamble, sections), notes };
}

// ── Обход реальных файлов ────────────────────────────────────────────────────
function findScenarioFiles() {
  const out = [];
  if (!fs.existsSync(CITIES_DIR)) return out;
  for (const city of fs.readdirSync(CITIES_DIR)) {
    const chrRoot = path.join(CITIES_DIR, city, 'chronicles');
    if (!fs.existsSync(chrRoot)) continue;
    for (const chr of fs.readdirSync(chrRoot)) {
      const modRoot = path.join(chrRoot, chr, 'modules');
      if (!fs.existsSync(modRoot)) continue;
      for (const mod of fs.readdirSync(modRoot)) {
        const p = path.join(modRoot, mod, 'scenario.md');
        if (fs.existsSync(p)) out.push(p);
      }
    }
  }
  return out;
}

function main() {
  const apply = process.argv.includes('--apply');
  const files = findScenarioFiles();
  let migrated = 0, skippedNonStandard = 0, alreadyClean = 0;

  console.log(`[migrate-scenario-format] режим: ${apply ? '--apply (запись на диск)' : 'dry-run (без записи, добавь --apply для реальной миграции)'}`);
  console.log(`[migrate-scenario-format] найдено scenario.md: ${files.length}\n`);

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const raw = fs.readFileSync(file, 'utf-8');
    const check = canAutoMigrate(raw);
    if (!check.ok) {
      console.log(`⏭  ПРОПУЩЕН: ${rel}\n    причина: ${check.reason}\n`);
      skippedNonStandard++;
      continue;
    }
    if (!needsMigration(raw)) {
      console.log(`✓  уже соответствует новому формату: ${rel}\n`);
      alreadyClean++;
      continue;
    }
    const { text, notes } = migrateScenarioFormat(raw);
    console.log(`✎  ${apply ? 'МИГРИРОВАН' : 'будет мигрирован'}: ${rel}`);
    for (const n of notes) console.log(`    - ${n}`);
    console.log('');
    if (apply) fs.writeFileSync(file, text, 'utf-8');
    migrated++;
  }

  console.log('─'.repeat(60));
  console.log(`Итого: мигрировано ${migrated}, уже в новом формате ${alreadyClean}, пропущено (нестандартная структура) ${skippedNonStandard}.`);
  if (!apply && migrated > 0) console.log('Это был dry-run — ничего не записано. Проверь вывод выше и запусти с --apply для реальной записи.');
}

if (require.main === module) main();

module.exports = { classifySection, canAutoMigrate, needsMigration, migrateScenarioFormat, isRedundantClosingFlavor, findScenarioFiles };
