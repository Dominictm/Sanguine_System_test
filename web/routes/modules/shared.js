'use strict';
// Общие хелперы для web/routes/modules/* — разбито из monolithic modules.js
// (2543 строк, 30 роутов) на домены: list/fill/scenario/sessions/fields/npc/
// lifecycle/locations, каждый требует отсюда нужный ему набор хелперов.

const path    = require('path');
const fs      = require('fs').promises;
const { serverError, aiRateLimit, callAnthropicWithRetry } = require('../../lib/http');
const {
  ROOT, cityDir, charsDir, locsDir, chroniclesDir, archiveDir,
  reqCity, writeFileAtomic, invalidateChars,
  getAllCharacters, getAllLocations, listModules, tableCell, LINEAGE_MAP,
  _nameMatch, rmdir, getChronicleDisplay,
} = require('../../lib/db');
const { slugify, parseEvent, parseScenarioSections, replaceScenarioSection, replaceScenarioSections, splitH3Body, serializeScenarioSections, findScenarioSectionIndex, checkScenarioStructure, insertScenarioScene, hasManualSceneMarker, clearManualSceneMarker, isFinaleHeading } = require('../../lib/parsers');

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
// Эталонный формат сценария (см. tsirk_tsirk_tsirk/scenario.md) не выделяет
// «Локации»/«НПС» отдельными заголовками — имена вплетены в прозу GM-справки
// и сцен. Чтобы автосоздание карточек всё равно работало надёжно, промт
// генерации требует невидимую строку-комментарий в преамбуле файла (до
// первого `##`, поэтому никогда не рендерится в UI — см. _renderScenarioPanel):
//   <!-- meta:npcs: Имя1; Имя2 -->
//   <!-- meta:locations: Название1; Название2 -->
// Это основной путь извлечения; ниже — разбор старого «плоского» формата
// (заголовки «Локации»/«НПС») как резерв для сценариев, сгенерированных до
// этого изменения.
function _extractMetaList(text, key) {
  const m = String(text || '').match(new RegExp(`<!--\\s*meta:${key}:\\s*([^>]*?)-->`, 'i'));
  if (!m) return null;
  return m[1].split(';').map(s => s.trim()).filter(Boolean);
}

// Location names mentioned in the scenario — meta-комментарий, иначе legacy
// разбор секции «Локации» (см. _parseScenarioLocations, robust, bounded)
function _extractLocNamesFromScenario(text, max = 5) {
  return _parseScenarioLocations(text).map(l => l.name).filter(Boolean).slice(0, max);
}

// Pull NPC names — meta-комментарий, иначе legacy разбор секции «НПС»
function _extractNpcNamesFromScenario(text, max = 12) {
  const meta = _extractMetaList(text, 'npcs');
  if (meta) return meta.slice(0, max);

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
// Parse scenario scenes into [{date, title, description}] — for the session
// scene-picker («🎲 Сессии» tab). Two formats supported:
//  (a) эталонный — `## Пролог`/`## Сцена N — …`/`## Финал` идут ПРЯМО на
//      верхнем уровне, без общей обёртки (см. tsirk_tsirk_tsirk/scenario.md);
//  (b) legacy — сцены вложены как `### Сцена N` под одним `## Сцены`.
// (a) проверяется первым; если ничего не нашлось — резерв (b), для сценариев,
// сгенерированных до перехода на эталонный формат.
// Без `\b` — в JS-регэкспах граница слова основана на ASCII `\w` и не видит
// кириллицу: после «Пролог» (заканчивается на «г») `\b` не сработал бы никогда.
const _SCENE_HEADING_RE = /^(Пролог|Сцена\s*\d+|Эпизод\s*\d+|Финал)(?:\s*(?:[—–:.-]\s*(.+))?)?$/i;

function _parseScenarioScenesDirect(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  const idx = t.search(/^##\s+/m);
  if (idx === -1) return [];
  const out = [];
  for (const part of t.slice(idx).split(/\n(?=##\s+)/)) {
    const h = part.match(/^##\s+(.+)$/m);
    if (!h) continue;
    const head = h[1].replace(/[*_`]/g, '').replace(/^[^\p{L}\d]+/u, '').trim();
    const sm = head.match(_SCENE_HEADING_RE);
    if (!sm) continue;
    const date  = sm[1].trim();
    const title = (sm[2] || '').trim() || date;
    const body = part.slice(h[0].length).replace(/^\s+/, '').trim();
    const desc = body.replace(/^\s*[-*•]\s*/gm, '').replace(/\*\*/g, '').trim();
    out.push({ date, title, description: desc });
  }
  return out;
}

function _parseScenarioScenesLegacy(text) {
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

function _parseScenarioScenes(text) {
  const direct = _parseScenarioScenesDirect(text);
  // Только "Пролог"/"Финал" без хотя бы одной пронумерованной "Сцена N" не
  // считается новым форматом — вероятнее, что это старая обёрнутая структура,
  // где реальные сцены лежат вложенными под "## Сцены" (см. _parseScenarioScenesLegacy).
  const hasNumberedScene = direct.some(s => /^Сцена\s*\d+/i.test(s.date));
  return hasNumberedScene ? direct : _parseScenarioScenesLegacy(text);
}
// Parse scenario locations into [{name, description}] — meta-комментарий
// (эталонный формат, см. _extractMetaList) не несёт описаний, только имена;
// legacy разбор секции «Локации» даёт оба поля.
function _parseScenarioLocations(text) {
  const meta = _extractMetaList(text, 'locations');
  if (meta) return meta.map(name => ({ name, description: '' }));

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
// Locate the first `## ` heading in npc.md classified as `kind` (pc/canon/modular) —
// same classification _parseNpcMdGroups uses, so deletion always targets the exact
// section the «НПС» tab rendered the entry from, regardless of the heading's actual
// wording (hand-authored files vary: «## 🎭 Игровые персонажи (ПК)» vs «## Персонажи игроков»).
function _findNpcMdSection(text, kind) {
  const heads = [];
  const re = /^##\s+(.+)$/gm;
  let m;
  while ((m = re.exec(text))) heads.push({ title: m[1].trim(), at: m.index, bodyStart: m.index + m[0].length });
  for (let i = 0; i < heads.length; i++) {
    const title = heads[i].title;
    const k = /игров|\bпк\b|персонаж\w*\s+игрок/i.test(title) ? 'pc'
            : /модульн|неканон/i.test(title) ? 'modular'
            : 'canon';
    if (k === kind) return { bodyStart: heads[i].bodyStart, end: i + 1 < heads.length ? heads[i + 1].at : text.length };
  }
  return null;
}
// Remove one entry (by display name) from a npc.md section body — mirrors the three
// formats _parseNpcEntries tolerates (bullet/bold line, «#### » subsection). Returns
// the raw text of the removed entry (so callers can pull its cardHref/slug), or null
// if no matching entry was found.
function _removeNpcEntry(body, targetName) {
  const targetClean = _cleanNpcName(targetName).toLowerCase();
  if (/^####\s+/m.test(body)) {
    const chunks = body.split(/\n(?=####\s+)/);
    let removedChunk = null;
    const kept = chunks.filter(part => {
      if (removedChunk) return true; // only remove the first match
      const h = part.match(/^####\s+(.+)$/m);
      if (!h) return true;
      const [namePart] = h[1].split(/\s*[—–]\s*/);
      if (_cleanNpcName(namePart).toLowerCase() === targetClean) { removedChunk = part; return false; }
      return true;
    });
    return { body: kept.join(''), removedChunk };
  }
  const lines = body.split('\n');
  let removedChunk = null;
  const kept = lines.filter(ln => {
    if (removedChunk) return true;
    const t = ln.trim();
    if (!t || /^>/.test(t)) return true;
    if (!/\[Карточка\]/.test(t) && !/^\s*[-*]/.test(t) && !/^\*\*/.test(t)) return true;
    const prefix = t
      .replace(/[→➔➜]?\s*🔗?\s*\[Карточка\]\([^)]*\).*$/, '')
      .replace(/^\s*-\s+/, '')
      .replace(/\*\*/g, '')
      .trim();
    const [namePart] = prefix.split(/\s*[—–]\s*/);
    const name = _cleanNpcName(namePart);
    if (name && name.toLowerCase() === targetClean) { removedChunk = ln; return false; }
    return true;
  });
  return { body: kept.join('\n'), removedChunk };
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

module.exports = {
  path, fs, serverError, aiRateLimit, callAnthropicWithRetry,
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
};
