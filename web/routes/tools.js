'use strict';
// Роутер инструментов: запуск Node/PowerShell CLI-тулов, статус авторизации AI,
// Claude Code OAuth (PKCE-логин без API-ключа), «Log session» (оркестрированная
// пост-сессионная запись — хроника/модуль/дневники/нити/статусы), здоровье
// claude CLI, настройки (.env).
// Фабрика с DI: генерация/OAuth-кэш и рестарт-машинерия остаются в server.js
// (используются также makeGenerationClient и /api/restart), сюда приходят только
// вызовы через DI — см. module.exports ниже.
// Вынесено из server.js (E1.2d).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const crypto  = require('crypto');
const { spawn } = require('child_process');
const { serverError } = require('../lib/http');
const {
  ROOT, reqCity, cityDir, chroniclesDir, archiveDir, writeFileAtomic,
  invalidateChars, getAllCharacters, listModules,
  renderChronicleEventsSkeleton, renderOpenThreadsSkeleton,
  aggregateEvents, makeNameResolver, eventMonthKey,
  getBrokenLinks, setBrokenLinks,
} = require('../lib/db');
const { slugify } = require('../lib/parsers');

// ── Run a PowerShell tool ─────────────────────────────────────────────────────

// Switch params: passed as bare flags (-Name) without a value string.
// List them here so they aren't quoted as strings in the PS command.
const SWITCH_PARAMS = ['Fix'];

// Tools that write project files → trigger background revalidation on success.
const FILE_MUTATING_TOOLS = new Set(['new_npc', 'new_city']);

// ── Run a Node CLI tool (cities/-aware) ────────────────────────────────────────
// Args are passed as an array to spawn() WITHOUT a shell → no injection risk.
const NODE_TOOLS = new Set(['new_city', 'new_npc', 'new_location', 'migrate_char', 'close_chronicle', 'build_city_events', 'sync_index']);

// ── Log session: orchestrated post-session write ───────────────────────────────
//
// Produces ALL factual artifacts of a played session in one action, following
// CHECKLIST §2 / chronicle / module_rules / diary_rules / open_threads.
// Prose (diary bodies, финал) is NOT fabricated — seeded stubs carry the facts +
// the Master's comments, and Claude authors the prose as a follow-up step.
//
// Two-phase by contract: dryRun=true returns a preview + previewHash; the write
// call must echo that hash, and the server rebuilds the plan and refuses to write
// if the plan changed since preview (no drift).

const CLAN_DIARY_STYLE = {
  'тореадор':       'Эстетический, чувственный, драматичный',
  'вентру':         'Контролируемый, аналитический, статус-ориентированный',
  'малкавиан':      'Фрагментированный, символичный, скачущий',
  'носферату':      'Циничный, наблюдательный, теневой',
  'гэнгрел':        'Дикий, инстинктивный, немногословный',
  'бруха':          'Страстный, бунтарский, прямой',
  'тремер':         'Методичный, оккультный, осторожный',
  'цимисхи':        'Отстранённый, висцеральный, философский',
  'каппадокий':     'Отстранённый, висцеральный, философский',
  'ассамит':        'Дисциплинированный, ритуальный, сдержанный',
  'тзими':          'Отстранённый, висцеральный, философский',
  'красная шапка':  'Архаичный, хищный, прямой',
  'слуаг':          'Лаконичный, теневой, точный',
  'пак':            'Игровой, импульсивный, момент настоящего',
  'сидхи':          'Возвышенный, церемониальный',
};
function diaryToneFor(c) {
  const clan = (c.clan || '').toLowerCase();
  for (const k in CLAN_DIARY_STYLE) if (clan.includes(k)) return CLAN_DIARY_STYLE[k];
  if (c.lineage === 'mortal') return 'Наблюдательный, человеческий';
  if (c.lineage === 'fairy')  return 'Грёзовый, образный';
  return 'Меланхоличный';
}

// Project URL convention: encode spaces/parens only, keep Cyrillic as-is
function encUrl(s) { return String(s).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29'); }

// Drop placeholder field values (⚠️, «неизвестно», «—») from display
function cleanMeta(v) { return (v && !/⚠️|неизвест|уточнен|^\s*—\s*$/i.test(v)) ? v : ''; }

function renderChronicleEntry(p, parts, modslug, hasFinale) {
  const L = [];
  L.push(`### 📅 ${p.event.dateLabel} — ${p.event.title}.`);
  if (p.event.parallel) L.push(`> ⚡ *${p.event.parallel}*`);
  L.push('');
  L.push(`- **📍 Локация:** ${p.event.locationLine}`);
  L.push('- **👥 Участники:**');
  for (const pt of parts) {
    const meta = [cleanMeta(pt.clan), cleanMeta(pt.gen)].filter(Boolean).join(', ');
    L.push(`  - ${pt.name}${meta ? ` (${meta})` : ''} — ${pt.role || 'участник'}`);
  }
  L.push('- **📋 События:**');
  const scenes = p.event.scenes || [];
  if (scenes.length) {
    if (p.event.summary && p.event.summary.trim()) { L.push(`  ${p.event.summary.trim()}`); L.push(''); }
    scenes.forEach((s, i) => {
      L.push(`  *Сцена ${i + 1} — ${s.title}:* ${(s.text || '').trim()}`);
      if (i < scenes.length - 1) L.push('');
    });
  } else {
    L.push(`  ${(p.event.summary || '').trim()}`);
  }
  if ((p.event.consequences || []).length) {
    L.push('- **⚖️ Последствия:**');
    p.event.consequences.forEach(c => L.push(`  - ${c}`));
  }
  if ((p.event.worldChanges || []).length) {
    L.push('- **🌍 Изменения состояния мира:**');
    p.event.worldChanges.forEach(c => L.push(`  - ${c}`));
  }
  L.push('');
  const finaleLink = hasFinale ? ` | [Литературный финал](modules/${modslug}/finale.md)` : '';
  L.push(`> 🔗 [Модуль](modules/${modslug}/${modslug}.md)${finaleLink}`);
  return L.join('\n');
}

function renderModuleMain(p, modslug, parts) {
  const diaryLinks = parts.filter(pt => pt.diary).map(pt =>
    `[${pt.name}](../../../../characters/${pt.lineageFolder}/${pt.slug}/journal/${p.diaryPeriod}.md)`
  ).join(' | ');
  return [
    `# ${p.event.dateLabel} — ${p.event.title}`,
    '> Хроника | Vampire: The Masquerade V20 / Changeling: The Dreaming',
    '',
    '> 🔗 [Хроника](../../events.md)',
    '',
    '---',
    '',
    '| Параметр | Значение |',
    '|---|---|',
    `| **Тип** | ${p.module.type || 'Игровая сессия'} |`,
    `| **Время** | ${p.event.dateLabel} |`,
    `| **Локация** | ${p.event.locationLine} |`,
    '',
    '---',
    '',
    (p.event.summary && p.event.summary.trim())
      ? p.event.summary.trim()
      : '*Краткое содержание — см. запись хроники.*',
    '',
    diaryLinks ? `> 🔗 Дневники: ${diaryLinks}` : '',
    ''
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

function renderNpcMd(p, modslug, parts) {
  const pcs = parts.filter(pt => /игрок|пк|персонаж игрока/i.test(pt.role || '') || pt.isPC);
  const canon = parts.filter(pt => !pcs.includes(pt));
  const line = pt => `- ${pt.name} — ${pt.role || 'роль'} → 🔗 [Карточка](../../../../characters/${pt.lineageFolder}/${pt.slug}/${pt.slug}.md)`;
  return [
    `# НПС модуля: ${p.event.dateLabel} — ${p.event.title}`,
    '',
    `> 🔗 [Модуль](${modslug}.md)`,
    '> ℹ️ Каноничные НПС → ссылка на карточку в `characters/`. Модульные → карточки в `npc/`.',
    '',
    '---',
    '',
    '## 🎭 Игровые персонажи (ПК)',
    '',
    pcs.length ? pcs.map(line).join('\n') : '- —',
    '',
    '---',
    '',
    '## 📚 Каноничные НПС',
    '',
    canon.length ? canon.map(line).join('\n') : '- —',
    '',
    '---',
    '',
    '## 🆕 Модульные НПС (неканоничные)',
    '',
    '> Карточки в `npc/`. Условия продвижения — `system/rules/module_rules.md`.',
    '',
    '- —',
    ''
  ].join('\n');
}

function renderDiaryStub(p, author, parts) {
  const others = parts.filter(x => x.name !== author.name).map(x => x.name);
  const tone = diaryToneFor(author);
  const note = (author.diaryComment || '').trim();
  return [
    `### 📅 ${p.event.dateLabel} — ⏳ ОЖИДАЕТ ГЕНЕРАЦИИ`,
    `- **👤 Автор:** ${author.name}`,
    `- **📍 Локация:** ${p.event.locationLine}`,
    `- **🎭 Тон/Стиль:** ${tone}`,
    '- **📖 Текст записи:**',
    '  ⏳ ОЖИДАЕТ ГЕНЕРАЦИИ — Claude напишет прозу по фактам события и стилю клана.',
    note ? `  <!-- 📝 КОММЕНТАРИЙ МАСТЕРА (учесть при генерации, затем удалить): ${note} -->` : '',
    `  <!-- ФАКТЫ (источник истины): хроника ${p.chronicle} → «${p.event.title}» -->`,
    '- **🔗 Зеркальная ссылка:**',
    others.length ? others.map(o => `  ${o} → ⏳`).join('\n') : '  —',
    ''
  ].filter(Boolean).join('\n');
}

function renderFinaleStub(p, modslug, parts) {
  const note = (p.finale && p.finale.comment || '').trim();
  return [
    `# ${p.event.dateLabel} — Литературный финал`,
    '',
    `> 🔗 [Модуль](${modslug}.md) | [Хроника](../../events.md)`,
    '',
    '---',
    '',
    '⏳ ОЖИДАЕТ ГЕНЕРАЦИИ — Claude напишет литературный финал.',
    '',
    note ? `<!-- 📝 КОММЕНТАРИЙ МАСТЕРА (учесть при генерации, затем удалить): ${note} -->` : '',
    `<!-- Опорные факты: «${p.event.title}»; участники: ${parts.map(x => x.name).join(', ')} -->`,
    ''
  ].filter(Boolean).join('\n');
}

function patchCardStatus(raw, status, details) {
  let out = raw;
  if (status) out = out.replace(/^(\s*-\s*\*\*Статус:\*\*).*$/m, `$1 ${status}`);
  if (details) {
    if (/^\s*-\s*\*\*Детали статуса:\*\*/m.test(out))
      out = out.replace(/^(\s*-\s*\*\*Детали статуса:\*\*).*$/m, `$1 ${details}`);
    else
      out = out.replace(/^(\s*-\s*\*\*Статус:\*\*.*)$/m, `$1\n- **Детали статуса:** ${details}`);
  }
  return out;
}

function addThreadRows(raw, newThreads, source) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  // find last numbered data row of the main table
  let lastIdx = -1, maxNum = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\|\s*(\d+)\s*\|/);
    if (m) { lastIdx = i; maxNum = Math.max(maxNum, parseInt(m[1])); }
  }
  if (lastIdx === -1) {                       // empty table → insert after header separator
    lastIdx = lines.findIndex(l => /^\|\s*-{2,}/.test(l));
    if (lastIdx === -1) return raw;
  }
  const rows = newThreads.map((t, i) => {
    const n = maxNum + i + 1;
    const status = /высок/i.test(t.priority) ? '🔴 Активна' : '🟡 Фоновая';
    return `| ${n} | **${t.title}** — ${t.desc || ''} | ${source} | ${status} | ${t.priority || 'Средний'} |`;
  });
  lines.splice(lastIdx + 1, 0, ...rows);
  return lines.join('\n');
}

function closeThreadRows(raw, ids) {
  const idset = new Set((ids || []).map(Number));
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const moved = [];
  const kept = [];
  for (const l of lines) {
    const m = l.match(/^\|\s*(\d+)\s*\|/);
    if (m && idset.has(parseInt(m[1]))) {
      moved.push(l.replace(/🔴 Активна|🟡 Фоновая/, '🟢 Закрыта'));
    } else kept.push(l);
  }
  let out = kept.join('\n');
  if (moved.length) {
    // Replace the archive placeholder, or append under the archive header
    if (/\*\(пусто[^\n]*\)\*/.test(out))
      out = out.replace(/\*\(пусто[^\n]*\)\*/, moved.join('\n'));
    else
      out = out.replace(/(##\s*🗂️[^\n]*\n)/, `$1\n${moved.join('\n')}\n`);
  }
  return out;
}

function appendChronicleEntry(raw, entryBlock) {
  const body = raw.replace(/\s+$/, '');         // keep the file's trailing ---
  return body + '\n\n' + entryBlock + '\n\n---\n';
}

function bumpWorldStateStamp(raw, monthLabel) {
  return raw.replace(/(Последнее обновление:\s*\*\*)[^*]+(\*\*)/, `$1${monthLabel}$2`);
}

// Минимальная карточка НПС (для инлайн-создания из формы сессии)
function renderMinimalNpcCard(name, slug, lineageFolder, lineageRu, cityDisplay) {
  const emoji = { vampires: '🧛', fairies: '🧚', mortals: '🧑', werewolves: '🐺', mages: '🔮', hunters: '🏹' }[lineageFolder] || '👤';
  return `# ${emoji} ${name}\n\n> 🔗 [Все персонажи](../../../archive/characters_index.md)\n\n---\n\n` +
    `- **Слаг:** ${slug}\n- **Родной город:** ${cityDisplay}\n- **Линейка WoD:** ${lineageRu}\n- **Статус:** Жив\n` +
    `- **Роль:** ⚠️ Требуется уточнение\n- **Принадлежность:** Персонаж мастера\n- **Биография:** ⚠️ Требуется уточнение\n- **Внешность:** ⚠️ Требуется уточнение\n\n---\n\n` +
    `## 🖼️ Изображения\n- ⏳ Изображение не предоставлено\n`;
}

// Build the full change plan (used identically for preview and write)
async function buildSessionPlan(payload) {
  const errors = [], warnings = [], notes = [];
  const p = JSON.parse(JSON.stringify(payload || {}));
  const city = p.city;

  if (!p.event || !p.event.title) errors.push('Название события обязательно.');
  if (!p.event || !p.event.dateLabel) errors.push('Дата (dateLabel) обязательна.');
  if (!p.event || !p.event.locationLine) errors.push('Локация обязательна.');
  if (!p.event || !p.event.month || !/^\d{4}-\d{2}$/.test(p.event.month)) errors.push('Месяц должен быть в формате YYYY-MM.');

  // resolve chronicle + module
  let chr, modslug, moduleNew = false, chronicleNew = false, chrDisplay = '';
  const allMods = await listModules(city);
  if (p.module.mode === 'existing') {
    const it = allMods.find(m => m.name === p.module.folder);
    if (!it) errors.push(`Модуль «${p.module.folder}» не найден.`);
    else { chr = it.chronicle; modslug = it.name; }
  } else {
    modslug = slugify(p.module.newName || '');
    moduleNew = true;
    if (!modslug) errors.push('Укажите название нового модуля.');
    const cspec = p.chronicle || {};
    if (cspec.mode === 'new') {
      chr = slugify(cspec.newName || '');
      chrDisplay = (cspec.newName || chr).trim();
      chronicleNew = true;
      if (!chr) errors.push('Укажите название новой хроники.');
    } else {
      chr = cspec.slug;
      if (!chr) errors.push('Выберите хронику для нового модуля.');
      else if (!(await fs.access(path.join(chroniclesDir(city), chr)).then(() => true).catch(() => false)))
        errors.push(`Хроника «${chr}» не найдена.`);
    }
  }
  if (errors.length) return { errors, warnings, notes, changes: [] };
  p.chronicle = chr;

  // chronicle events file (existing or fresh skeleton)
  const chrEventsRel = `cities/${city}/chronicles/${chr}/events.md`;
  let chronicleRaw = await fs.readFile(path.join(ROOT, chrEventsRel), 'utf-8').catch(() => null);
  const chrEventsExisted = chronicleRaw != null;
  chronicleRaw = chrEventsExisted ? chronicleRaw.replace(/^﻿/, '') : renderChronicleEventsSkeleton(chrDisplay || chr);

  // chronological conflict (across the whole city)
  const evs = await aggregateEvents(city);
  if (p.event.title && evs.some(e => (e.title || '').trim() === p.event.title.trim()
        && (eventMonthKey(e.date) || {}).key === p.event.month))
    errors.push(`Запись «${p.event.title}» за ${p.event.month} уже существует (хронологический конфликт).`);

  // resolve participants (+ инлайн-создание НПС, если имя неизвестно, но указана линейка)
  const chars = await getAllCharacters(city);
  const resolve = makeNameResolver(chars.map(c => c.name));
  const byName = Object.fromEntries(chars.map(c => [c.name, c]));
  let cityDisplay = city;
  try {
    const m = (await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8')).replace(/^﻿/, '').match(/^#\s+(.+)$/m);
    if (m) cityDisplay = m[1].replace(/^[^\p{L}\p{N}]+/u, '').split(/[,—–-]/)[0].trim();
  } catch {}
  const LINEAGE_RU = { vampires: 'Вампир', fairies: 'Фея / Ченджлинг', mortals: 'Смертный', werewolves: 'Оборотень', mages: 'Маг', hunters: 'Охотник' };
  const LINEAGE_CODE = { vampires: 'vampire', fairies: 'fairy', mortals: 'mortal', werewolves: 'werewolf', mages: 'mage', hunters: 'hunter' };
  const newNpcCards = [];
  const parts = [];
  for (const inp of (p.participants || [])) {
    const rid = resolve(inp.name);
    if (!rid) {
      const lf = inp.lineage;
      if (lf && LINEAGE_RU[lf]) {
        const slug = slugify(inp.name);
        if (!slug) { errors.push(`Участник «${inp.name}»: не удалось собрать slug.`); continue; }
        newNpcCards.push({ rel: `cities/${city}/characters/${lf}/${slug}/${slug}.md`, content: renderMinimalNpcCard(inp.name, slug, lf, LINEAGE_RU[lf], cityDisplay) });
        parts.push({ name: inp.name, slug, clan: inp.clan || '', gen: '', lineage: LINEAGE_CODE[lf], lineageFolder: lf,
          role: inp.role || '', diary: !!inp.diary, isPC: !!inp.isPC, diaryComment: inp.diaryComment || '',
          statusChange: inp.statusChange || null, statusDetails: inp.statusDetails || '' });
        continue;
      }
      errors.push(`Участник «${inp.name}» не сопоставлен — выберите линейку, чтобы создать НПС инлайн, или создайте его заранее.`);
      continue;
    }
    const c = byName[rid];
    parts.push({
      name: c.name, slug: c.slug, clan: c.clan || '', gen: c.generation || '',
      lineage: c.lineage, lineageFolder: c.lineageFolder,
      role: inp.role || '', diary: !!inp.diary, isPC: !!inp.isPC,
      diaryComment: inp.diaryComment || '',
      statusChange: inp.statusChange || null, statusDetails: inp.statusDetails || ''
    });
  }
  if (errors.length) return { errors, warnings, notes, changes: [] };

  const preNov2010 = p.event.month < '2010-11';
  p.diaryPeriod = preNov2010 ? 'retrospective' : p.event.month;

  const hasFinale = !!(p.finale && p.finale.create);
  const changes = [];
  const add = (rel, action, after, preview) => changes.push({ rel, action, after, preview });

  // 0. Inline-created NPC stub cards (для неизвестных участников с указанной линейкой)
  for (const nc of newNpcCards) add(nc.rel, 'create', nc.content, `новый НПС (stub): ${nc.rel.split('/').pop()}`);
  if (newNpcCards.length) notes.push(`Создано НПС-заготовок: ${newNpcCards.length} — заполни поля ⚠️ по system/rules/npcs_city.md.`);

  // 1. Chronicle entry → append to chronicles/<chr>/events.md
  const entry = renderChronicleEntry(p, parts, modslug, hasFinale);
  add(chrEventsRel, chrEventsExisted ? 'modify' : 'create', appendChronicleEntry(chronicleRaw, entry),
    `${chrEventsExisted ? 'append' : 'new'} запись: ### 📅 ${p.event.dateLabel} — ${p.event.title}`);

  // 1a. New chronicle → seed chronicle.md (спина + статус «Активна»)
  if (chronicleNew) {
    add(`cities/${city}/chronicles/${chr}/chronicle.md`, 'create',
      `# 📕 ${chrDisplay || chr}\n\n- **Статус:** 🟡 Активна\n\n> Спина хроники. События — [events.md](events.md). Нити — [open_threads.md](open_threads.md).\n> Закрыть хронику: \`node tools/close_chronicle.js ${city} ${chr} "финал"\`\n`,
      'новая хроника: chronicle.md (статус Активна)');
  }

  // 1b. World-state stamp in archive/events.md
  const monthLabel = p.event.dateLabel.split(',')[0];
  const archiveRel = `cities/${city}/archive/events.md`;
  const archiveRaw = await fs.readFile(path.join(ROOT, archiveRel), 'utf-8')
    .then(s => s.replace(/^﻿/, '')).catch(() => null);
  if (archiveRaw && /Последнее обновление:/.test(archiveRaw))
    add(archiveRel, 'modify', bumpWorldStateStamp(archiveRaw, monthLabel), `штамп «Состояние мира» → ${monthLabel}`);
  if ((p.event.worldChanges || []).length)
    notes.push('Отрази вручную в сводных таблицах «🌍 Состояние мира» (правятся не автоматически):\n' +
      p.event.worldChanges.map(c => `   • ${c}`).join('\n'));
  notes.push('Индекс «Сводная хроника» (archive/events.md) перегенерируется после записи.');

  // 2. Module files
  const modRel = `cities/${city}/chronicles/${chr}/modules/${modslug}`;
  if (moduleNew) {
    add(`${modRel}/${modslug}.md`, 'create', renderModuleMain(p, modslug, parts), 'новый главный файл модуля');
    add(`${modRel}/npc.md`,        'create', renderNpcMd(p, modslug, parts),       'npc.md (ПК / каноничные / модульные)');
  } else {
    notes.push('Существующий модуль — главный файл и npc.md не перезаписываются.');
  }
  if (hasFinale) {
    const finaleRel = `${modRel}/finale.md`;
    const exists = await fs.readFile(path.join(ROOT, finaleRel), 'utf-8').then(() => true).catch(() => false);
    if (!exists) add(finaleRel, 'create', renderFinaleStub(p, modslug, parts), 'stub финала (ОЖИДАЕТ ГЕНЕРАЦИИ)');
    else warnings.push('finale.md уже существует — не трогаем.');
  }

  // 3. Diary seed-stubs → characters/<lin>/<slug>/journal/<period>.md
  const stubs = [];
  for (const pt of parts.filter(x => x.diary)) {
    const rel = `cities/${city}/characters/${pt.lineageFolder}/${pt.slug}/journal/${p.diaryPeriod}.md`;
    const existing = await fs.readFile(path.join(ROOT, rel), 'utf-8').catch(() => null);
    const stub = renderDiaryStub(p, pt, parts);
    if (existing == null) {
      const header = `# 📖 Дневник — ${pt.name}\n\n> 🔗 [Карточка](../${pt.slug}.md)\n\n---\n\n`;
      add(rel, 'create', header + stub + '\n', `дневник-stub ${pt.name} (${p.diaryPeriod})`);
    } else {
      add(rel, 'modify', existing.replace(/^﻿/, '').replace(/\s+$/, '') + '\n\n---\n\n' + stub + '\n', `+сцена в дневник ${pt.name} (${p.diaryPeriod})`);
    }
    stubs.push(rel);
  }
  if (hasFinale) stubs.push(`${modRel}/finale.md`);

  // 4. Threads → chronicles/<chr>/open_threads.md
  const otRel = `cities/${city}/chronicles/${chr}/open_threads.md`;
  let otRaw = await fs.readFile(path.join(ROOT, otRel), 'utf-8').then(s => s.replace(/^﻿/, '')).catch(() => null);
  const otExisted = otRaw != null;
  if (!otExisted) otRaw = renderOpenThreadsSkeleton(chrDisplay || chr);
  if ((p.threads.new || []).length) otRaw = addThreadRows(otRaw, p.threads.new, `«${p.event.title}», ${monthLabel}`);
  if ((p.threads.close || []).length) otRaw = closeThreadRows(otRaw, p.threads.close);
  if ((p.threads.new || []).length || (p.threads.close || []).length)
    add(otRel, otExisted ? 'modify' : 'create', otRaw, `нити: +${(p.threads.new || []).length} / закрыто ${(p.threads.close || []).length}`);

  // 5. Character status patches
  for (const pt of parts.filter(x => x.statusChange)) {
    const rel = `cities/${city}/characters/${pt.lineageFolder}/${pt.slug}/${pt.slug}.md`;
    const cardRaw = await fs.readFile(path.join(ROOT, rel), 'utf-8').catch(() => null);
    if (cardRaw == null) { warnings.push(`Карточка ${pt.name} не найдена для смены статуса.`); continue; }
    add(rel, 'modify', patchCardStatus(cardRaw.replace(/^﻿/, ''), pt.statusChange, pt.statusDetails),
      `Статус → ${pt.statusChange}${pt.statusDetails ? ' (' + pt.statusDetails + ')' : ''}`);
  }

  return { errors, warnings, notes, changes, stubs, summary: {
    city, chronicle: chr, chronicleNew, module: modslug, moduleNew, diaryPeriod: p.diaryPeriod,
    participants: parts.length, diaries: parts.filter(x => x.diary).length, finale: hasFinale
  } };
}

function planHash(changes) {
  const canon = changes.map(c => `${c.rel}\x00${c.action}\x00${c.after}`).join('\x01');
  return crypto.createHash('sha256').update(canon, 'utf8').digest('hex');
}

// Фабрика: server.js передаёт OAuth-кэш/рестарт-хелперы при монтировании (общее
// состояние с makeGenerationClient и /api/restart, которые остаются в server.js).
module.exports = function toolsRouter({
  runValidationBackground,
  readOauthCached, refreshClaudeOauth, writeClaudeOauth,
  claudeOauthConfig: getClaudeOauthConfig, claudeCredsPath,
  invalidateGeminiClient,
  scheduleRestart, isSupervised,
  envPath, defaultClaudeModel,
}) {
  const router = express.Router();
  // CLAUDE_OAUTH is a `const` initialized after this factory runs at server.js
  // module-load time — server.js passes it as a lazy getter, called per-request
  // (never at mount time) to avoid a TDZ crash.

  router.post('/api/tool/:name', async (req, res) => {
    const name = req.params.name;
    if (!NODE_TOOLS.has(name)) return res.status(400).json({ ok: false, output: 'Unknown tool' });
    const args = (Array.isArray(req.body.args) ? req.body.args : []).map(a => String(a));  // keep empties (positional)
    const ps = spawn('node', [path.join(ROOT, 'tools', `${name}.js`), ...args], { cwd: ROOT });
    let out = '', err = '';
    const timer = setTimeout(() => ps.kill(), 30000);
    ps.stdout.on('data', d => out += d.toString('utf8'));
    ps.stderr.on('data', d => err += d.toString('utf8'));
    ps.on('error', e => { clearTimeout(timer); res.json({ ok: false, output: e.message }); });
    ps.on('close', code => {
      clearTimeout(timer);
      if (code === 0) { invalidateChars(); runValidationBackground(); }
      res.json({ ok: code === 0, output: (out + err).trim(), exitCode: code });
    });
  });

  router.post('/api/run-tool', async (req, res) => {
    const { tool, params = {} } = req.body;
    // PowerShell tools only. new_city/new_npc are Node tools (use /api/tool/:name);
    // module creation lives in the chronicle flow (POST /api/chronicles/:slug/modules).
    const allowed = ['validate_links', 'search'];
    if (!allowed.includes(tool)) return res.status(400).json({ error: 'Unknown tool' });

    const script = path.join(ROOT, 'tools', `${tool}.ps1`);

    // -Force skips interactive Read-Host / ReadKey for all interactive tools
    const forceFlag = ['validate_links'].includes(tool) ? '-Force' : '';

    // Regular params (-Key 'Value')
    const regularParamStr = Object.entries(params)
      .filter(([k, v]) => !SWITCH_PARAMS.includes(k) && v !== undefined && v !== null && String(v).trim() !== '')
      .map(([k, v]) => `-${k} '${String(v).replace(/'/g, "''")}'`)
      .join(' ');

    // Switch params (-Key with no value)
    const switchParamStr = SWITCH_PARAMS
      .filter(k => params[k] === true || params[k] === 'true')
      .map(k => `-${k}`)
      .join(' ');

    const allArgs = [regularParamStr, forceFlag, switchParamStr].filter(Boolean).join(' ');

    const cmd = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$OutputEncoding = [System.Text.Encoding]::UTF8',
      `& '${script.replace(/\\/g, '\\\\').replace(/'/g, "''")}' ${allArgs}`
    ].join('; ');

    const ps = spawn('powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', cmd],
      { cwd: ROOT, env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' } });

    ps.stdin.end();
    let out = '', err = '';
    ps.stdout.on('data', d => { out += d.toString('utf8'); });
    ps.stderr.on('data', d => { err += d.toString('utf8'); });

    const timer = setTimeout(() => { ps.kill(); }, 30000);

    ps.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        invalidateChars();
        if (FILE_MUTATING_TOOLS.has(tool)) runValidationBackground();
      }
      // For validate_links the exit code IS the broken link count
      if (tool === 'validate_links') setBrokenLinks(code);
      res.json({ success: code === 0, output: out || err, exitCode: code });
    });
    ps.on('error', e => {
      clearTimeout(timer);
      res.json({ success: false, output: e.message, exitCode: -1 });
    });
  });

  // ── Auth status endpoint ──────────────────────────────────────────────────────

  router.get('/api/auth-status', async (req, res) => {
    try {
      // Google Gemini (shown only when explicitly queried; doesn't override OpenRouter default)
      if (process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
        return res.json({ source: 'gemini', ok: true, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
      }

      // OpenRouter
      if (process.env.OPENROUTER_API_KEY) {
        return res.json({
          source: 'openrouter',
          ok:     true,
          model:  process.env.OPENROUTER_MODEL || 'openrouter/free',
        });
      }

      // OpenAI / GPT
      if (process.env.OPENAI_API_KEY) {
        return res.json({ source: 'openai', ok: true, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' });
      }

      // Anthropic API key
      if (process.env.ANTHROPIC_API_KEY) {
        return res.json({ source: 'api-key', ok: true });
      }

      // Claude.ai OAuth
      const raw   = await fs.readFile(claudeCredsPath(), 'utf-8').catch(() => null);
      const creds = raw ? JSON.parse(raw) : null;
      const oauth = creds?.claudeAiOauth;
      if (oauth?.accessToken) {
        const expired   = Date.now() >= (oauth.expiresAt || 0);
        const expiresIn = Math.round((oauth.expiresAt - Date.now()) / 60000);
        return res.json({
          source: 'claude-login', ok: !expired,
          subscription: oauth.subscriptionType || 'unknown',
          expiresIn: expired ? 0 : expiresIn, expired,
        });
      }

      res.json({ source: 'none', ok: false });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── Claude Code OAuth login (subscription token, no API key) ───────────────────
  // Same PKCE flow Claude Code CLI uses: build an authorize URL, user logs in and
  // pastes the returned code, we exchange it for a token and write .credentials.json.
  const _oauthPending = new Map(); // state -> { verifier, createdAt }

  function _pkcePair() {
    const verifier  = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  const _oauthInfo = o => o && ({
    expired:      !!(o.expiresAt && Date.now() >= o.expiresAt),
    subscription: o.subscriptionType || 'unknown',
    expiresIn:    o.expiresAt ? Math.max(0, Math.round((o.expiresAt - Date.now()) / 60000)) : null,
    hasRefresh:   !!o.refreshToken,
  });

  // Step 1 — build the authorize URL (PKCE) and remember the verifier by state.
  router.post('/api/claude/oauth/start', express.json(), async (req, res) => {
    try {
      const { verifier, challenge } = _pkcePair();
      const state = crypto.randomBytes(16).toString('hex');
      _oauthPending.set(state, { verifier, createdAt: Date.now() });
      for (const [k, v] of _oauthPending) if (Date.now() - v.createdAt > 15 * 60_000) _oauthPending.delete(k);

      const u = new URL(getClaudeOauthConfig().authorizeUrl);
      u.searchParams.set('code', 'true');
      u.searchParams.set('client_id', getClaudeOauthConfig().clientId);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('redirect_uri', getClaudeOauthConfig().redirectUri);
      u.searchParams.set('scope', getClaudeOauthConfig().scope);
      u.searchParams.set('code_challenge', challenge);
      u.searchParams.set('code_challenge_method', 'S256');
      u.searchParams.set('state', state);
      res.json({ ok: true, url: u.toString(), state });
    } catch (e) { serverError(res, e); }
  });

  // Step 2 — exchange the pasted code («CODE#STATE») for a token; write credentials.
  router.post('/api/claude/oauth/exchange', express.json(), async (req, res) => {
    try {
      const pasted = String(req.body?.code || '').trim();
      if (!pasted) return res.status(400).json({ ok: false, error: 'Вставь код авторизации.' });
      const [rawCode, hashState] = pasted.split('#');
      const state   = (hashState || req.body?.state || '').trim();
      const pending = _oauthPending.get(state);
      if (!pending) return res.status(400).json({ ok: false, error: 'Сессия входа не найдена или истекла. Нажми «Войти через Claude Code» заново.' });

      const r = await fetch(getClaudeOauthConfig().tokenUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type:    'authorization_code',
          code:          rawCode.trim(),
          state,
          client_id:     getClaudeOauthConfig().clientId,
          redirect_uri:  getClaudeOauthConfig().redirectUri,
          code_verifier: pending.verifier,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(r.status >= 400 && r.status < 600 ? r.status : 500)
        .json({ ok: false, error: data.error_description || data.error || `Обмен кода не удался (${r.status})` });

      _oauthPending.delete(state);
      const oauth = await writeClaudeOauth(data);
      res.json({ ok: true, claudeOauth: _oauthInfo(oauth) });
    } catch (e) { serverError(res, e); }
  });

  // Refresh the access token (used when expired but a refresh_token exists).
  router.post('/api/claude/oauth/refresh', express.json(), async (req, res) => {
    try { res.json({ ok: true, claudeOauth: _oauthInfo(await refreshClaudeOauth()) }); }
    catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
  });

  // Fresh Claude auth status (bypasses the 60s cache) — for the «Обновить статус» button.
  router.get('/api/claude/status', async (req, res) => {
    try {
      const oauth = await readOauthCached(true);
      res.json({ ok: true, claudeOauth: _oauthInfo(oauth) || null, hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY });
    } catch (e) { serverError(res, e); }
  });

  router.post('/api/log-session', async (req, res) => {
    try {
      const payload = req.body || {};
      if (!payload.city) payload.city = reqCity(req);   // from ?city= (fetch wrapper)
      const plan = await buildSessionPlan(payload);
      if (plan.errors.length)
        return res.status(400).json({ ok: false, errors: plan.errors, warnings: plan.warnings });

      const hash = planHash(plan.changes);
      const preview = plan.changes.map(c => ({ rel: c.rel, action: c.action, preview: c.preview }));

      // PREVIEW
      if (payload.dryRun !== false) {
        return res.json({ ok: true, dryRun: true, previewHash: hash,
          changes: preview, stubs: plan.stubs, warnings: plan.warnings, notes: plan.notes, summary: plan.summary });
      }

      // WRITE — must match the previewed plan exactly
      if (payload.previewHash !== hash)
        return res.status(409).json({ ok: false, errors: ['План изменился с момента предпросмотра — повторите предпросмотр.'] });

      const written = [];
      for (const c of plan.changes) {
        const abs = path.join(ROOT, c.rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        // npc/ dir for new modules (modular NPC cards)
        if (c.rel.endsWith('/npc.md')) await fs.mkdir(path.join(path.dirname(abs), 'npc'), { recursive: true }).catch(() => {});
        const text = c.after.replace(/\r\n/g, '\n');     // LF, matches migrated files
        await writeFileAtomic(abs, text, 'utf-8');
        written.push({ rel: c.rel, action: c.action });
      }
      invalidateChars(plan.summary.city);

      // Regenerate the city's aggregate event index, then revalidate links.
      await new Promise(resolve => {
        const ps = spawn('node', [path.join(ROOT, 'tools', 'build_city_events.js'), plan.summary.city], { cwd: ROOT });
        ps.on('close', () => resolve()); ps.on('error', () => resolve());
      });
      runValidationBackground();

      res.json({ ok: true, dryRun: false, written, stubs: plan.stubs, warnings: plan.warnings,
        notes: plan.notes, summary: plan.summary });
    } catch (e) {
      // Не serverError() напрямую — этот эндпоинт (и его фронтенд-обработчик,
      // scripts.js lsRunWrite()) читает {ok, errors:[...]}, а не {error: '...'};
      // serverError() дал бы пустой список ошибок в UI. Тот же принцип
      // (не течь e.message клиенту, логировать полный стек на сервере) —
      // просто в форме, которую реально читает вызывающий код.
      console.error('[error]', e?.stack || e?.message || e);
      res.status(500).json({ ok: false, errors: ['Внутренняя ошибка сервера — подробности в логе сервера.'] });
    }
  });

  // Cache Claude CLI health check (5 min) — avoids spawning a shell on every diary load
  let _claudeHealthCache = null;
  let _claudeHealthCacheAt = 0;
  const CLAUDE_HEALTH_TTL = 5 * 60_000;

  router.get('/api/claude/health', (req, res) => {
    if (_claudeHealthCache && (Date.now() - _claudeHealthCacheAt) < CLAUDE_HEALTH_TTL) {
      return res.json(_claudeHealthCache);
    }
    let sent = false;
    const done = body => {
      if (!sent) {
        sent = true;
        _claudeHealthCache = body;
        _claudeHealthCacheAt = Date.now();
        res.json(body);
      }
    };
    const ps = spawn('claude --version', { shell: true });
    let out = '';
    const timer = setTimeout(() => { ps.kill(); done({ available: false }); }, 8000);
    ps.stdout.on('data', d => out += d.toString('utf8'));
    ps.on('error', () => { clearTimeout(timer); done({ available: false }); });
    ps.on('close', code => { clearTimeout(timer); done({ available: code === 0, version: out.trim(), defaultModel: defaultClaudeModel() || null }); });
  });

  // ── Settings (save .env + optional restart) ───────────────────────────────────

  router.get('/api/settings', async (req, res) => {
    try {
      const raw = await fs.readFile(envPath(), 'utf-8').catch(() => '');
      const env = {};
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (m) env[m[1]] = m[2].trim();
      }
      // Claude Code OAuth status (independent of OpenRouter priority in /api/auth-status)
      const oauth = await readOauthCached().catch(() => null);
      const claudeOauth = oauth?.accessToken ? {
        expired:      !!(oauth.expiresAt && Date.now() >= oauth.expiresAt),
        subscription: oauth.subscriptionType || 'unknown',
        expiresIn:    oauth.expiresAt ? Math.max(0, Math.round((oauth.expiresAt - Date.now()) / 60000)) : null,
        hasRefresh:   !!oauth.refreshToken,
      } : null;

      res.json({
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ? '***' : '',
        OPENROUTER_MODEL:   env.OPENROUTER_MODEL   || '',
        hasKey:             !!env.OPENROUTER_API_KEY,
        OPENAI_MODEL:       env.OPENAI_MODEL       || '',
        hasOpenAIKey:       !!env.OPENAI_API_KEY,
        hasAnthropicKey:    !!env.ANTHROPIC_API_KEY,
        hasGeminiKey:       !!env.GEMINI_API_KEY,
        GEMINI_MODEL:       env.GEMINI_MODEL       || '',
        claudeOauth,
      });
    } catch (e) { serverError(res, e); }
  });

  router.post('/api/settings', express.json(), async (req, res) => {
    try {
      const { OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENAI_API_KEY, OPENAI_MODEL, ANTHROPIC_API_KEY, GEMINI_API_KEY, GEMINI_MODEL } = req.body || {};

      // Read current .env
      const raw = await fs.readFile(envPath(), 'utf-8').catch(() => '');
      const lines = raw.split('\n').filter(l => l.trim() !== '');
      const env = {};
      for (const l of lines) { const m = l.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim(); }

      // Update only provided fields (empty string = remove; '***' = unchanged sentinel)
      const setKey = (name, val) => {
        if (val === undefined || val === '***') return;
        if (String(val).trim()) env[name] = String(val).trim(); else delete env[name];
      };
      setKey('OPENROUTER_API_KEY', OPENROUTER_API_KEY);
      setKey('OPENAI_API_KEY',     OPENAI_API_KEY);
      setKey('ANTHROPIC_API_KEY',  ANTHROPIC_API_KEY);
      setKey('GEMINI_API_KEY',     GEMINI_API_KEY);
      if (OPENROUTER_MODEL !== undefined) {
        if (OPENROUTER_MODEL.trim()) env.OPENROUTER_MODEL = OPENROUTER_MODEL.trim();
        else delete env.OPENROUTER_MODEL;
      }
      if (OPENAI_MODEL !== undefined) {
        if (OPENAI_MODEL.trim()) env.OPENAI_MODEL = OPENAI_MODEL.trim();
        else delete env.OPENAI_MODEL;
      }
      if (GEMINI_MODEL !== undefined) {
        if (GEMINI_MODEL.trim()) env.GEMINI_MODEL = GEMINI_MODEL.trim();
        else delete env.GEMINI_MODEL;
      }
      invalidateGeminiClient(); // invalidate cached client on key/model change

      const newContent = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      await writeFileAtomic(envPath(), newContent, 'utf-8');

      const needsRestart = req.body?.restart !== false;
      res.json({ ok: true, needsRestart, supervised: isSupervised() });
      if (needsRestart) scheduleRestart('[settings]');
    } catch (e) {
      console.error('[settings]', e.message);
      serverError(res, e);
    }
  });

  return router;
};
