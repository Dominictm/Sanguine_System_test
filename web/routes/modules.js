'use strict';
// Роутер модулей (module-level): список/детали, создание, AI-генерация сценария,
// сессии (Фаза B), правка полей/сценария, добавление НПС, delete-preview/delete,
// закрытие модуля (Фаза C, AI), локации-подресурс, листы эпизодических НПС и их
// продвижение в каноничные персонажи.
// Хроника-уровневый слой (список хроник, delete, recap, /api/chronicle, state) —
// routes/chronicles.js.
// Фабрика с DI: AI-хелперы (makeGenerationClient, isOA, oaCall) приходят из
// server.js при монтировании — сам AI-слой пока живёт там (E1.2). Лист V20 для
// эпизодических НПС переиспользует character-sheet генерацию сервера
// (generateV20Sheet, ensureSheetLink) — тоже через DI, т.к. она общая с
// /api/characters/:slug/sheet* и её отдельная миграция не входит в этот срез.

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { spawn } = require('child_process');
const { serverError, aiRateLimit } = require('../lib/http');
const {
  ROOT, cityDir, charsDir, locsDir, chroniclesDir, archiveDir,
  reqCity, writeFileAtomic, invalidateChars,
  getAllCharacters, getAllLocations, listModules, tableCell, LINEAGE_MAP,
  _nameMatch, rmdir,
} = require('../lib/db');
const { slugify, parseEvent, parseScenarioSections, replaceScenarioSection } = require('../lib/parsers');

// Modules now live under chronicles/<chr>/modules/<mod>/ — flatten them with their chronicle.
const MOD_AUX = n => ['npc.md', 'scenario.md', 'finale.md'].includes(n) || n.endsWith('-sheet.md');

// Rebuild modules section in chronicle.md from current modules/ dir
async function syncChronicleModuleLinks(city, chr) {
  const chrDir = path.join(chroniclesDir(city), chr);
  const chrMdPath = path.join(chrDir, 'chronicle.md');
  const raw = await fs.readFile(chrMdPath, 'utf-8').catch(() => null);
  if (!raw) return; // no chronicle.md (older chronicle)

  // Read current modules
  let mEntries; try { mEntries = await fs.readdir(path.join(chrDir, 'modules'), { withFileTypes: true }); } catch { mEntries = []; }
  const mods = mEntries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => {
      // Try to read title from main md file
      let title = e.name;
      try {
        const mainTxt = require('fs').readFileSync(path.join(chrDir, 'modules', e.name, `${e.name}.md`), 'utf-8');
        const hm = mainTxt.match(/^#\s+(.+)$/m);
        if (hm) title = hm[1].replace(/[*[\]]/g, '').trim();
      } catch {}
      return { slug: e.name, title };
    });

  // Replace or add ## 🔗 Модули section
  const modsSection = mods.length
    ? `\n## 🔗 Модули\n\n${mods.map(m => `- [${m.title}](modules/${m.slug}/${m.slug}.md)`).join('\n')}\n`
    : '';

  let updated;
  if (/^## 🔗 Модули/m.test(raw)) {
    // Replace existing section
    updated = raw.replace(/\n## 🔗 Модули[\s\S]*?(?=\n## |\n---|\s*$)/, modsSection);
  } else {
    updated = raw.trimEnd() + '\n' + modsSection;
  }

  if (updated !== raw) await writeFileAtomic(chrMdPath, updated, 'utf-8');
}

// Build preview of what delete would do
// Resolve city display name from city.md H1
async function getCityDisplayName(city) {
  try {
    const cityMdPath = path.join(__dirname, '..', 'cities', city, 'city.md');
    const txt = await fs.readFile(cityMdPath, 'utf-8');
    const m = txt.match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : city;
  } catch { return city; }
}

// ── Module NPC sheets (episodic NPCs: chronicles/<chr>/modules/<mod>/npc/<slug>/) ──
function _npcSheetPaths(city, chr, mod, slug) {
  const dir = path.join(chroniclesDir(city), chr, 'modules', mod, 'npc', slug);
  return { dir, card: path.join(dir, `${slug}.md`), sheet: path.join(dir, `${slug}-sheet.md`) };
}

// ── NPC promotion: episodic → canonical character ─────────────────────────────

// Check the three promotion conditions for a modular NPC.
// Returns { survived, inFinale, inMultipleModules }.
async function _checkNpcPromotion(city, chr, mod, npcSlug) {
  const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
  const npcCard = path.join(modDir, 'npc', npcSlug, `${npcSlug}.md`);

  // 1. Survived — status in the modular NPC card is not dead/destroyed
  let survived = false;
  try {
    const card = await fs.readFile(npcCard, 'utf-8');
    const sl   = (card.match(/\*\*Статус\*\*[^|\n]*\|\s*([^|\n]+)\|/)?.[1] || '').toLowerCase();
    survived   = !/(мёртв|мертв|уничтожен|погиб|убит|final death)/i.test(sl);
  } catch { survived = false; }

  // 2. Mentioned in finale.md of this module
  let inFinale = false;
  try {
    const finale = await fs.readFile(path.join(modDir, 'finale.md'), 'utf-8');
    inFinale = finale.toLowerCase().includes(npcSlug.replace(/-/g, ' '));
    if (!inFinale) {
      // Also match slug directly (dashes kept)
      inFinale = finale.toLowerCase().includes(npcSlug);
    }
    if (!inFinale) {
      // Try matching the name from the card
      const nameM = (await fs.readFile(npcCard, 'utf-8').catch(() => ''))
        .match(/^#{1,3}\s+[^\p{L}]*(.+?)(?:\s*[—–].*)?$/mu);
      if (nameM) inFinale = finale.toLowerCase().includes(nameM[1].trim().toLowerCase());
    }
  } catch { inFinale = false; }

  // 3. Appears in 2+ modules (count all modules across all chronicles that have this slug in npc/)
  let moduleCount = 0;
  try {
    const chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true });
    for (const cEntry of chrs) {
      if (!cEntry.isDirectory()) continue;
      const mods = await fs.readdir(path.join(chroniclesDir(city), cEntry.name, 'modules'), { withFileTypes: true }).catch(() => []);
      for (const mEntry of mods) {
        if (!mEntry.isDirectory()) continue;
        const exists = await fs.stat(
          path.join(chroniclesDir(city), cEntry.name, 'modules', mEntry.name, 'npc', npcSlug)
        ).catch(() => null);
        if (exists) moduleCount++;
      }
    }
  } catch { moduleCount = 1; }
  const inMultipleModules = moduleCount >= 2;

  return { survived, inFinale, inMultipleModules };
}

// Extract location names from generated scenario text (no AI call needed).
// Looks for "### Name" headers inside the "Локации" section, falling back to
// bold list items. Returns up to `max` names.
// Clean a raw scenario location heading into a bare place name
// e.g. "1. Станция Марселье (Line 13) — 23:47" → "Станция Марселье"
function _cleanLocName(raw) {
  return String(raw)
    .replace(/[*_`[\]]/g, '')
    .split(/\s+[—–]\s+/)[0]        // "Name — time/desc" → "Name"
    .replace(/\([^)]*\)/g, ' ')    // drop "(Line 13)"
    .replace(/^[\s\d.)]+/, '')     // drop leading "1. " numbering
    .replace(/^[^\p{L}«»"]+/u, '') // drop leading emoji/symbols
    .replace(/\s{2,}/g, ' ')
    .trim();
}
// Coarse location "type" — used to avoid multiplying same-type places
// (e.g. inventing a new metro station when one already exists).
function _locType(name) {
  const n = String(name).toLowerCase();
  if (/метро|métro|\bmetro\b|перрон|перон|станци/.test(n)) return 'metro';
  if (/катакомб|подземель/.test(n))                        return 'catacombs';
  if (/кладбищ|cimeti|погост|пер-лашез/.test(n))           return 'cemetery';
  return null;
}
// Location names mentioned in the scenario's «Локации» section (robust, bounded)
function _extractLocNamesFromScenario(text, max = 5) {
  return _parseScenarioLocations(text).map(l => l.name).filter(Boolean).slice(0, max);
}

// Pull NPC names from the scenario's «НПС» section
function _extractNpcNamesFromScenario(text, max = 12) {
  const secM = text.match(/(?:^|\n)#{1,4}[^\n]*НПС[^\n]*\n([\s\S]*?)(?=\n#{1,2}\s|\n---|\s*$)/i);
  const block = secM ? secM[1] : '';
  if (!block) return [];
  const names = [];
  const push = raw => {
    let n = String(raw).replace(/[*_`[\]()«»"]/g, '').replace(/^[^\p{L}]+/u, '').trim();
    n = n.split(/[—–:(]/)[0].trim();
    if (n.length >= 2 && n.length <= 60 && !/^(нпс|роль|имя)$/i.test(n)
        && !names.some(x => _nameMatch(x, n))) names.push(n);
  };
  for (const m of block.matchAll(/^\s*[-*•]\s*\*\*([^*\n]+?)\*\*/gm)) push(m[1]);
  for (const m of block.matchAll(/^\s*[-*•]\s*([^—–\n*[]{2,60}?)\s*[—–]/gm)) push(m[1]);
  for (const m of block.matchAll(/^#{2,4}\s+([^—–\n]{2,60}?)(?:\s*[—–]|$)/gm)) push(m[1]);
  return names.slice(0, max);
}
// Render npc.md — ПК / Каноничные (reused) / Модульные (new)
function _renderModuleNpcMd(modTitle, mod, pcs, canonNpcs, newNpcs, allChars) {
  const charLink = ch => `../../../../characters/${ch.lineageFolder}/${ch.slug}/${ch.slug}.md`;
  const pcLines = (pcs && pcs.length) ? pcs.map(nm => {
    const ch = allChars.find(c => _nameMatch(nm, c.name));
    return ch ? `- ${ch.name} — Персонаж игрока → 🔗 [Карточка](${charLink(ch)})`
              : `- ${nm} — Персонаж игрока`;
  }).join('\n') : '- —';
  const canonLines = canonNpcs.length
    ? canonNpcs.map(x => `- ${x.char.name} — ${x.role || 'роль в модуле'} → 🔗 [Карточка](${charLink(x.char)})`).join('\n')
    : '- —';
  const newLines = newNpcs.length
    ? newNpcs.map(x => { const s = slugify(x.name); return `- ${x.name} — ${x.role || 'роль'} → 🔗 [Карточка](npc/${s}/${s}.md)`; }).join('\n')
    : '- —';
  return [
    `# НПС модуля: ${modTitle}`, '',
    `> 🔗 [Модуль](${mod}.md)`,
    '> ℹ️ Каноничные НПС → ссылка на карточку в `characters/`. Модульные (неканоничные) → карточки в `npc/`.', '',
    '---', '', '## 🎭 Игровые персонажи (ПК)', '', pcLines, '',
    '---', '', '## 📚 Каноничные НПС', '', canonLines, '',
    '---', '', '## 🆕 Модульные НПС (неканоничные)', '',
    '> Карточки в `npc/`. Условия продвижения — `system/rules/module_rules.md`.', '', newLines, '',
  ].join('\n');
}
// Compact per-character digest (status, role, date markers, relationships) for the
// generation prompt — lets the AI reason about timeline compatibility & relations.
function _charTimelineDigest(name, kind, card) {
  const field = re => (card.match(re)?.[1] || '').replace(/\r/g, '').trim();
  const status  = field(/\*\*Статус:\*\*\s*([^\n]+)/);
  const det     = field(/\*\*Детали статуса:\*\*\s*([^\n]+)/);
  const hier    = field(/\*\*Парижская иерархия:\*\*\s*([^\n]+)/) || field(/\*\*Иерархия в городе:\*\*\s*([^\n]+)/);
  const role    = field(/\*\*Роль:\*\*\s*([^\n]+)/);
  const embrace = field(/\*\*Год обращения:\*\*\s*([^\n]+)/);
  const relM    = card.match(/\*\*Отношения:\*\*\s*\n([\s\S]*?)(?=\n-\s*\*\*|\n##\s|\n---)/);
  const rels    = relM ? relM[1].replace(/\r/g, '').replace(/\s+$/g, '') : '';
  const dates   = [...card.matchAll(/(?:[А-Яа-яЁё]+\s+)?\b(?:19|20)\d{2}\b/g)]
    .map(m => m[0].trim()).filter((v, i, a) => a.indexOf(v) === i).slice(0, 10);
  const L = [`### ${name} (${kind})`];
  if (status)        L.push(`- Статус: ${status}${det ? ` — ${det}` : ''}`);
  if (hier || role)  L.push(`- Роль/иерархия: ${[hier, role].filter(Boolean).join(' / ')}`);
  if (embrace && !/не указан/i.test(embrace)) L.push(`- Год обращения: ${embrace}`);
  if (dates.length)  L.push(`- Даты в карточке: ${dates.join(', ')}`);
  if (rels.trim())   L.push(`- Связи:\n${rels.split('\n').filter(Boolean).map(l => '  ' + l.trim()).join('\n')}`);
  return L.join('\n');
}
// Return the markdown body of a scenario section whose header matches headerRe,
// up to the next header of the same or higher level. '' if not found.
function _extractScenarioSection(text, headerRe) {
  if (!text) return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,4})\s+(.+)$/);
    if (h && headerRe.test(h[2])) { start = i + 1; level = h[1].length; break; }
  }
  if (start === -1) return '';
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,4})\s+/);
    if (h && h[1].length <= level) break;
    if (/^-{3,}\s*$/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}
// Parse the scenario's «Сцены» section into [{date, title, description}]
function _parseScenarioScenes(text) {
  const block = _extractScenarioSection(text, /Сцены/i);
  if (!block) return [];
  const out = [];
  for (const part of block.split(/\n(?=#{2,4}\s)/)) {
    const h = part.match(/^#{2,4}\s+(.+)$/m);
    if (!h) continue;
    let head = h[1].replace(/[*_`]/g, '').replace(/^[^\p{L}\d]+/u, '').trim();
    let date = '', title = head;
    const sm = head.match(/^((?:Сцена|Эпизод)\s*\d+)\s*[—–:.-]\s*(.+)$/i);
    if (sm) { date = sm[1].trim(); title = sm[2].trim(); }
    else { date = head.match(/^(?:Сцена|Эпизод)\s*\d+/i)?.[0] || ''; }
    const body = part.slice(h[0].length).replace(/^\s+/, '').trim();
    const desc = body.replace(/^\s*[-*•]\s*/gm, '').replace(/\*\*/g, '').trim();
    if (title || desc) out.push({ date, title: title || date, description: desc });
  }
  return out;
}
// Parse the scenario's «Локации» section into [{name, description}]
function _parseScenarioLocations(text) {
  const block = _extractScenarioSection(text, /Локаци/i);
  if (!block) return [];
  const out = [], seen = new Set();
  const add = (rawName, rawDesc) => {
    const name = _cleanLocName(rawName);
    if (!name || name.length < 2 || name.length > 100) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, description: String(rawDesc || '').replace(/[*_`]/g, '').trim() });
  };
  for (const line of block.split('\n')) {
    const bm = line.trim().match(/^[-*•]\s+(.+)$/);
    if (!bm) continue;
    const parts = bm[1].split(/\s*(?:[—–]|→|🔗|\|)\s*/);
    const desc = parts.slice(1).filter(p => p && !/^\[?Карточк/i.test(p)).join(' — ');
    add(parts[0], desc);
  }
  for (const part of block.split(/\n(?=#{2,4}\s)/)) {
    const h = part.match(/^#{2,4}\s+(.+)$/m);
    if (!h) continue;
    const body = part.slice(h[0].length).replace(/^\s+/, '')
      .split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 2).join(' ');
    add(h[1], body);
  }
  return out;
}
// Parse/write the «## 📍 Связанные локации» section of a module .md
function _parseModuleLocSlugs(raw) {
  const m = raw.replace(/\r\n/g, '\n').match(/##\s*📍\s*Связанные локации\s*\n([\s\S]*?)(?=\n##|\s*$)/i);
  if (!m) return [];
  return m[1].split('\n').map(l => l.match(/^\s*-\s+(\S+)/)?.[1]).filter(Boolean);
}
function _writeModuleLocSlugs(raw, slugs) {
  const n = raw.replace(/\r\n/g, '\n'); // normalise CRLF so \n## lookahead always works
  if (!slugs.length) {
    return n.replace(/\n*##\s*📍\s*Связанные локации[ \t]*\n[\s\S]*?(?=\n##|\s*$)/i, '').trimEnd() + '\n';
  }
  const section = `## 📍 Связанные локации\n${slugs.map(s => `- ${s}`).join('\n')}\n`;
  if (/##\s*📍\s*Связанные локации/i.test(n)) {
    return n.replace(/##\s*📍\s*Связанные локации[ \t]*\n[\s\S]*?(?=\n##|\s*$)/i, section);
  }
  return n.trimEnd() + '\n\n' + section;
}

// Parse sessions.md (Phase B log) into [{title, date, scenes, status, body}]
function _parseSessions(raw) {
  if (!raw) return [];
  const text = raw.replace(/\r\n/g, '\n');
  const out = [];
  for (const part of text.split(/\n(?=##\s+Сесси)/)) {
    const h = part.match(/^##\s+(.+)$/m);
    if (!h || !/Сесси/.test(h[1])) continue;
    const head   = h[1].trim();
    const scenes = (part.match(/\*\*Сыграно сцен:\*\*\s*([^\n]*)/)?.[1] || '').trim().replace(/^—$/, '');
    const status = (part.match(/\*\*Статус модуля:\*\*\s*([^\n]*)/)?.[1] || '').trim();
    let body = part.slice(part.indexOf(h[0]) + h[0].length)
      .replace(/^\s*-\s*\*\*Сыграно сцен:\*\*[^\n]*\n?/m, '')
      .replace(/^\s*-\s*\*\*Статус модуля:\*\*[^\n]*\n?/m, '')
      .replace(/\n-{3,}\s*$/, '')
      .trim();
    if (/^\*\(без заметок\)\*$/.test(body)) body = '';
    const date = (head.match(/[—–-]\s*(.+)$/)?.[1] || '').trim();
    out.push({ title: head, date, scenes, status, body });
  }
  return out;
}

// Parse npc.md into structured groups for the module page «НПС» tab.
// Groups: ПК / Каноничные / Модульные. Tolerates bullet, bold and «#### » subsection layouts.
function _cleanNpcName(s) {
  return String(s || '').replace(/^[\s>*]+/, '').replace(/^[^\p{L}]+/u, '').replace(/[\s*]+$/, '').trim();
}
function _npcCardHref(chunk) {
  return (chunk.match(/\[Карточка\]\(([^)]+)\)/) || [])[1] || '';
}
function _parseNpcEntries(body) {
  const entries = [];
  // Format C — «#### Имя — роль» subsections (модульные НПС со встроенным мини-листом)
  if (/^####\s+/m.test(body)) {
    for (const part of body.split(/\n(?=####\s+)/)) {
      const h = part.match(/^####\s+(.+)$/m);
      if (!h) continue;
      const [namePart, ...rest] = h[1].split(/\s*[—–]\s*/);
      const name = _cleanNpcName(namePart);
      if (!name) continue;
      const after = part.slice(part.indexOf(h[0]) + h[0].length);
      const descBits = [rest.join(' — ').trim()];
      for (const ln of after.split('\n')) {
        const t = ln.trim();
        if (!t || /\[Карточка\]/.test(t)) continue;
        descBits.push(t.replace(/^[-*]\s*/, ''));
      }
      entries.push({ name, desc: descBits.filter(Boolean).join(' — ').replace(/\*\*/g, '').trim(), cardHref: _npcCardHref(part) });
    }
    return entries;
  }
  // Formats A/B — one entry per line («- Имя — роль …» или «**Имя** — описание …»)
  for (const ln of body.split('\n')) {
    const t = ln.trim();
    if (!t || /^>/.test(t)) continue;
    if (!/\[Карточка\]/.test(t) && !/^\s*[-*]/.test(t) && !/^\*\*/.test(t)) continue;
    let prefix = t
      .replace(/[→➔➜]?\s*🔗?\s*\[Карточка\]\([^)]*\).*$/, '')   // drop «→ 🔗 [Карточка](…)» trailer
      .replace(/^\s*-\s+/, '')                                   // strip leading «- » bullet
      .replace(/\*\*/g, '')                                      // drop bold markers
      .trim();
    if (!prefix) continue;
    const [namePart, ...rest] = prefix.split(/\s*[—–]\s*/);
    const name = _cleanNpcName(namePart);
    if (!name) continue;
    entries.push({ name, desc: rest.join(' — ').trim(), cardHref: _npcCardHref(t) });
  }
  return entries;
}
function _parseNpcMdGroups(raw) {
  if (!raw) return [];
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const heads = [];
  const re = /^##\s+(.+)$/gm;
  let m;
  while ((m = re.exec(text))) heads.push({ title: m[1].trim(), bodyStart: m.index + m[0].length, at: m.index });
  const groups = [];
  for (let i = 0; i < heads.length; i++) {
    const body  = text.slice(heads[i].bodyStart, i + 1 < heads.length ? heads[i + 1].at : text.length);
    const title = heads[i].title;
    const kind  = /игров|\bпк\b|персонаж\w*\s+игрок/i.test(title) ? 'pc'
                : /модульн|неканон/i.test(title) ? 'modular'
                : 'canon';
    const entries = _parseNpcEntries(body);
    if (entries.length) groups.push({ title, kind, entries });
  }
  return groups;
}
// Render one session block for sessions.md
function _renderSessionBlock(n, date, scenes, status, body) {
  return [
    '', '---', '',
    `## Сессия ${n} — ${(date || '').trim() || new Date().toISOString().slice(0, 10)}`, '',
    `- **Сыграно сцен:** ${(scenes || '').trim() || '—'}`,
    `- **Статус модуля:** ${(status || '').trim() || '🟡 В процессе'}`, '',
    (body || '').trim() || '*(без заметок)*', '',
  ].join('\n');
}
// Rewrite the whole sessions.md from the session array (append & edit share this)
async function _writeSessionsFile(modDir, mod, sessions) {
  const titleM = (await fs.readFile(path.join(modDir, `${mod}.md`), 'utf-8').catch(() => '')).replace(/^﻿/, '').match(/^#\s+(.+)$/m);
  const modTitle = titleM ? titleM[1].replace(/[*[\]]/g, '').trim() : mod;
  const header = `# Журнал сессий: ${modTitle}\n\n> 🔗 [Модуль](${mod}.md) | [Сценарий](scenario.md)\n> Фаза B — ведение во время игры. Правила: system/rules/module_rules.md`;
  const blocks = sessions.map((s, i) => _renderSessionBlock(i + 1, s.date, s.scenes, s.status, s.body)).join('');
  await writeFileAtomic(path.join(modDir, 'sessions.md'), header + blocks + '\n', 'utf-8');
}
// Patch <mod>.md after generation WITHOUT destroying its concept/participants
async function _patchModuleMain(modDir, mod, firstLoc) {
  const p = path.join(modDir, `${mod}.md`);
  let txt = await fs.readFile(p, 'utf-8').catch(() => '');
  if (!txt) return;
  if (!/\[Сценарий\]\(scenario\.md\)/.test(txt)) {
    txt = txt.replace(/^(>\s*🔗\s*\[Хроника\]\([^)]*\))(.*)$/m,
      `$1 | [Сценарий](scenario.md) | [НПС](npc.md)$2`);
  }
  if (firstLoc) {
    txt = txt.replace(/(\|\s*\*\*Локация\*\*\s*\|)([^|\n]*)\|/,
      (m, pre, val) => val.trim() ? m : `${pre} ${firstLoc} |`);
  }
  await writeFileAtomic(p, txt, 'utf-8');
}

// Фабрика: server.js передаёт AI-хелперы и character-sheet генерацию при монтировании.
module.exports = function modulesRouter({
  makeGenerationClient, isOA, oaCall, generateV20Sheet, ensureSheetLink,
}) {
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
  # ПРАВИЛО ТИПОВЫХ ЛОКАЦИЙ: не выдумывай новых названий для типовых мест (станция метро, кафе, переулок, катакомбы), если в каталоге уже есть место ТОГО ЖЕ ТИПА — используй существующее (по названию). Новое типовое место вводи ТОЛЬКО если действие переносится в округ, где такого места ещё нет; тогда привяжи его к конкретному округу.`;

      const userPrompt = `Создай полный сценарий (scenario.md) для модуля «${modTitle}» по следующей идее:

  ${content}

  Время действия модуля: ${moduleWhen}
  Персонажи игроков: ${pcs.length ? pcs.join(', ') : '(не указаны)'}
  НПС: ${npcs.length ? npcs.join(', ') : '(не указаны)'}

  ВАЖНО — переиспользование: сначала проверь списки «СУЩЕСТВУЮЩИЕ НПС» и «СУЩЕСТВУЮЩИЕ ЛОКАЦИИ» — если кто-то/что-то подходит, используй ИХ ИМЕНА ДОСЛОВНО. Новых вводи только если среди существующих нет подходящих.

  ВАЖНО — проверка таймлайна: сверь дату «${moduleWhen}» с разделом «ТАЙМЛАЙН И СВЯЗИ УЧАСТНИКОВ». Если на эту дату персонаж НЕ МОГ участвовать или его статус/роль был ИНЫМ (ещё не на должности, в торпоре, ещё не обращён/не прибыл, уже уничтожен) — обязательно это отметь. В САМОМ НАЧАЛЕ сценария добавь раздел «## ⚠️ Проверка таймлайна» с предупреждениями Мастеру по каждому такому персонажу: что именно не сходится и как это обыграть (заменить, понизить статус, объяснить присутствие). Если конфликтов нет — напиши «Конфликтов таймлайна не выявлено».

  ВАЖНО — связи: учитывай СВЯЗИ между персонажами (раздел «Связи» в таймлайне) — вплетай их в мотивации, конфликты и сцены, а не игнорируй.

  ВАЖНО — НПС: КАЖДЫЙ НПС, включая эпизодических антагонистов и второстепенных (охотник, информатор, гуль, торговец и т.п.), должен иметь КОНКРЕТНОЕ ИМЯ и быть перечислен в разделе «НПС» отдельным пунктом «- Имя — роль». Безымянных функциональных персонажей в разделе НПС быть не должно — иначе для них не создастся карточка.

  Структура сценария (строго по правилам module_rules.md):
  0. ## ⚠️ Проверка таймлайна — в самом начале (см. выше)
  1. Предпосылки — что привело к этой ситуации
  2. Локации — 2-3 ключевых места с атмосферой (раздел с заголовком «Локации», каждая — отдельным пунктом)
  3. НПС — мотивации, секреты, роли (раздел «НПС»; каждый с ИМЕНЕМ, отдельным пунктом «- Имя — роль»)
  4. Завязка — как ПК втягиваются в события
  5. Сцены (3–5) — каждая с конфликтом и вариантами развития
  6. Кульминация — пиковый момент напряжения
  7. Варианты финала — 2-3 возможных исхода
  8. Открытые нити — что останется неразрешённым
  9. Колорит города — 2-3 детали, делающие сцену именно этим городом и временем

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
      const header = `# Сценарий: ${modTitle}\n\n> 🔗 [Модуль](${mod}.md) | [Хроника](../../events.md)\n\n---\n\n`;
      await writeFileAtomic(scenarioPath, header + scenarioText + '\n', 'utf-8');
      console.log(`[fill-module] ${city}/${chr}/${mod}/scenario.md written`);

      // (allLocs + char catalog already loaded above for the generation prompt)

      // First location mentioned in scenario (for the main file's «Локация» cell)
      const locLineMatch = scenarioText.match(/(?:локация|место действия)[^\n:]*[:]\s*([^\n]+)/i);
      const firstLoc = locLineMatch ? locLineMatch[1].replace(/\*\*/g, '').trim() : '';

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

      res.json({
        ok: true,
        file: `chronicles/${chr}/modules/${mod}/scenario.md`,
        locations: createdLocations,
        reusedLocations,
        npcs: createdNpcs,
        canonNpcs: canonNpcs.map(x => x.char.name),
        timelineWarnings,
      });
    } catch (e) {
      console.error('[fill-module]', e.message, e.cause || e.stack || '');
      const detail = e.cause ? `${e.message}: ${e.cause?.message || e.cause}` : e.message;
      res.status(500).json({ ok: false, error: detail });
    }
  });

  // ── Scenario, per-section: manual edit ──────────────────────────────────────
  // Replaces one `## <heading>` block of scenario.md, leaves the rest untouched.
  router.put('/api/chronicles/:chr/modules/:mod/scenario/section', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });
      const { heading, content } = req.body || {};
      if (!heading) return res.status(400).json({ ok: false, error: 'Не указан раздел' });

      const scenarioPath = path.join(chroniclesDir(city), chr, 'modules', mod, 'scenario.md');
      const raw = await fs.readFile(scenarioPath, 'utf-8').catch(() => null);
      if (raw == null) return res.status(404).json({ ok: false, error: 'Сценарий не найден' });

      const { sections } = parseScenarioSections(raw);
      if (!sections.some(s => s.heading === heading))
        return res.status(404).json({ ok: false, error: `Раздел «${heading}» не найден` });

      const updated = replaceScenarioSection(raw, heading, content || '');
      await writeFileAtomic(scenarioPath, updated, 'utf-8');
      invalidateChars(city);
      console.log(`[scenario-section] ${city}/${chr}/${mod} → «${heading}» отредактирован вручную`);
      res.json({ ok: true, scenario: updated });
    } catch (e) { serverError(res, e); }
  });

  // ── Scenario, per-section: AI regeneration (учитывает остальной сценарий) ──────
  router.post('/api/chronicles/:chr/modules/:mod/scenario/section/regenerate', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });
      const { heading, pcs = [], npcs = [] } = req.body || {};
      if (!heading) return res.status(400).json({ ok: false, error: 'Не указан раздел' });

      const modDir       = path.join(chroniclesDir(city), chr, 'modules', mod);
      const scenarioPath = path.join(modDir, 'scenario.md');
      const raw = await fs.readFile(scenarioPath, 'utf-8').catch(() => null);
      if (raw == null) return res.status(404).json({ ok: false, error: 'Сценарий не найден' });

      const { sections } = parseScenarioSections(raw);
      const target = sections.find(s => s.heading === heading);
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
      let newBody = '';
      if (gen && isOA(gen)) {
        newBody = await oaCall(gen)(gen.model, systemPrompt, userPrompt, [], 60000, 2500);
      } else if (gen?.client) {
        const msg = await gen.client.messages.create({
          model: 'claude-opus-4-8', max_tokens: 2500,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        newBody = msg.content[0]?.text?.trim() || '';
      } else {
        return res.status(503).json({ ok: false, error: 'Нет доступного AI-провайдера. Настрой в Инструменты → Модели AI.' });
      }
      if (!newBody) return res.status(500).json({ ok: false, error: 'AI вернул пустой ответ.' });

      const updated = replaceScenarioSection(raw, heading, newBody);
      await writeFileAtomic(scenarioPath, updated, 'utf-8');
      invalidateChars(city);
      console.log(`[scenario-section] ${city}/${chr}/${mod} → «${heading}» перегенерирован`);
      res.json({ ok: true, scenario: updated });
    } catch (e) {
      console.error('[scenario-section-regen]', e.message);
      serverError(res, e);
    }
  });

  // ── Append in-play session entry (Phase B) ─────────────────────────────────────

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
            const sepRe = /(\|\s*Параметр\s*\|\s*Значение\s*\|\n\|---\|---\|\n)/;
            if (sepRe.test(raw)) raw = raw.replace(sepRe, `$1| **${label}** | ${v} |\n`);
            else skipped.push(key);
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

  // ── Add single NPC to module ───────────────────────────────────────────────────

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

  // ── Delete-preview for module ─────────────────────────────────────────────────

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

      const result = { name: mod, chronicle: chr, title: mod, pcs: [], npcs: [], locations: [], events: [] };

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
              e.slug = m ? m[1] : slugify(e.name);
              e.sheetScope = 'module';
              e.hasSheet = !!(await fs.stat(path.join(modDir, 'npc', e.slug, `${e.slug}-sheet.md`)).catch(() => null));
              e.promoteCheck = await _checkNpcPromotion(city, chr, mod, e.slug).catch(() => null);
            } else {
              const ch = allChars.find(c => c.name === e.name) || allChars.find(c => _nameMatch(c.name, e.name));
              e.slug = ch?.slug || null;
              e.sheetScope = 'character';
              e.hasSheet = ch
                ? !!(await fs.stat(path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}-sheet.md`)).catch(() => null))
                : false;
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
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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
