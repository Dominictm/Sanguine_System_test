'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..', '..');
const LINEAGES = ['vampires', 'mortals', 'fairies', 'werewolves', 'mages', 'hunters'];

// ── Literary style cache ──────────────────────────────────────────────────────
// One read per server lifetime; all prose endpoints share the full text.
let _litStyleCache = null;
async function loadLiteraryStyle() {
  if (_litStyleCache !== null) return _litStyleCache;
  try {
    _litStyleCache = await fs.promises.readFile(
      path.join(ROOT, 'system', 'rules', 'literary_style.md'), 'utf-8'
    );
  } catch {
    _litStyleCache = '';
  }
  return _litStyleCache;
}

// ── Diary clan-style rules (two prose sections from diary_rules.md) ─────────────
// Returns only «🎭 Правила литературной стилизации по лору» + «📜 Общие требования»
// so prose generators get clan voices without the diary-storage boilerplate.
let _diaryStyleCache = null;
async function loadDiaryStyleRules() {
  if (_diaryStyleCache !== null) return _diaryStyleCache;
  try {
    const raw = await fs.promises.readFile(
      path.join(ROOT, 'system', 'rules', 'diary_rules.md'), 'utf-8'
    );
    // Extract from the stylization section to the end of the prose requirements section
    const m = raw.match(/(## 🎭 Правила литературной стилизации по лору[\s\S]+?## 📜 Общие требования к прозе[\s\S]+?)(?=\n---\n## )/);
    _diaryStyleCache = m ? m[1].trim() : '';
  } catch {
    _diaryStyleCache = '';
  }
  return _diaryStyleCache;
}

// ── Narrative core (Storyteller-only subset of CLAUDE.md) ─────────────────────
// Web prose endpoints use this as their base system prompt.
// Does NOT contain dev tools, CI/CD, web interface — only storytelling rules.
let _narrativeCoreCache = null;
async function loadNarrativeCore() {
  if (_narrativeCoreCache !== null) return _narrativeCoreCache;
  try {
    _narrativeCoreCache = await fs.promises.readFile(
      path.join(ROOT, 'system', 'narrative_core.md'), 'utf-8'
    );
  } catch {
    _narrativeCoreCache = '';
  }
  return _narrativeCoreCache;
}

// ── Character card lookup ─────────────────────────────────────────────────────
function findCharacterCard(city, slug) {
  if (!city || !slug) return null;
  for (const lineage of LINEAGES) {
    const p = path.join(ROOT, 'cities', city, 'characters', lineage, slug, `${slug}.md`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── Event history → compact state JSON ───────────────────────────────────────
// Converts events.md array (parsed by parseEvent) into a compact state object.
// Replaces passing raw event history text into system prompts (~60% token reduction).
//
// Schema:
//   { tension, characters: { slug: { status, last } }, world_flags: { flag: true } }
function compressEventsToState(events = []) {
  const state = { tension: 0, characters: {}, world_flags: {} };
  for (const e of events) {
    if (typeof e.tension === 'number') {
      state.tension = Math.max(state.tension, e.tension);
    }
    for (const c of (e.characters || [])) {
      const id = typeof c === 'string' ? c : (c.id || c.slug || c.name);
      if (!id) continue;
      if (!state.characters[id]) {
        state.characters[id] = { status: c.status || 'active', last: e.summary || e.title || '' };
      } else {
        // Keep last known status and most recent action
        if (c.status) state.characters[id].status = c.status;
        state.characters[id].last = e.summary || e.title || state.characters[id].last;
      }
    }
    for (const f of (e.flags || [])) {
      state.world_flags[f] = true;
    }
  }
  return state;
}

// ── Full narrative context builder ────────────────────────────────────────────
// Assembles system prompt for prose generation from:
//   1. system/narrative_core.md  (storytelling rules only)
//   2. cities/<city>/city.md     (city-specific setting, factions, tone)
//   3. character cards            (active characters only — not all)
//   4. compressed scene state    (compact JSON, not raw event history)
//   5. scene prompt              (the actual generation request)
//
// Options:
//   city       — city slug (e.g. 'paris')
//   characters — array of character slugs to include (active scene participants)
//   state      — compact state JSON from compressEventsToState() or { tension, characters, ... }
//   prompt     — the scene/generation request text
//   coreMd     — override for narrative_core.md content (skip auto-load if provided)
async function buildNarrativeContext({ city, characters = [], state, prompt, coreMd } = {}) {
  const parts = [];

  // 1. Narrative core
  const core = coreMd !== undefined ? coreMd : await loadNarrativeCore();
  if (core) parts.push(core);

  // 2. Literary style (always included — all prose must follow it)
  const litStyle = await loadLiteraryStyle();
  if (litStyle) parts.push(`# ЛИТЕРАТУРНЫЙ СТИЛЬ\n${litStyle}`);

  // 3. City context
  if (city) {
    const cityPath = path.join(ROOT, 'cities', city, 'city.md');
    if (fs.existsSync(cityPath)) {
      parts.push(fs.readFileSync(cityPath, 'utf-8'));
    }
  }

  // 4. Active character cards (only explicitly listed ones)
  for (const slug of characters) {
    const cardPath = findCharacterCard(city, slug);
    if (cardPath) {
      parts.push(fs.readFileSync(cardPath, 'utf-8'));
    }
  }

  // 5. Compressed scene state
  if (state && Object.keys(state).length) {
    parts.push(
      '## Состояние мира (Scene State)\n```json\n' +
      JSON.stringify(state, null, 2) +
      '\n```'
    );
  }

  // 6. Scene prompt
  if (prompt) parts.push(`## Сцена\n${prompt}`);

  return parts.join('\n\n---\n\n');
}

// ── Tension heuristic ─────────────────────────────────────────────────────────
// Estimates tension score (0–10) from parsed event content using keyword matching.
// High-stakes keywords (убийство, война, нападение…) → 3 pts; medium (конфликт,
// угроза, предательство…) → 2 pts; any other non-empty event → 1 pt.
// Final tension = sum of last 3 events, capped at 10.
function _estimateEventTension(ev) {
  const text = ((ev.title || '') + ' ' + (ev.worldChanges || []).join(' ')).toLowerCase();
  const HIGH = /убийств|война|нападени|резн|уничтожен|катастроф|апокалипс/;
  const MED  = /конфликт|угроз|предательств|схватк|стычк|кризис|смерть|погиб/;
  if (HIGH.test(text)) return 3;
  if (MED.test(text))  return 2;
  if (text.trim())     return 1;
  return 0;
}

// ── Chronicle events.md → compact state ──────────────────────────────────────
// Adapter for the real parseEvent() output shape from web/lib/parsers.js.
// Converts a chronicle's events array into a compact Scene State JSON.
// Called by the /api/chronicles/:chr/state endpoint.
//
// parseEvent() returns: { title, date, participants: [{name, text}], eventsText, worldChanges, consequences }
// Tension is estimated from the last 3 events via keyword heuristic.
function compressChronicleEvents(parsedEvents = []) {
  const state = { tension: 0, characters: {}, world_flags: {} };
  // Tension: sum scores of last 3 events, cap at 10
  const last3 = parsedEvents.slice(-3);
  state.tension = Math.min(10, last3.reduce((sum, e) => sum + _estimateEventTension(e), 0));
  for (const e of parsedEvents) {
    const summary = e.title || e.date || '';
    for (const p of (e.participants || [])) {
      const name = p.name || p.text || '';
      if (!name) continue;
      if (!state.characters[name]) {
        state.characters[name] = { status: 'active', last: summary };
      } else {
        state.characters[name].last = summary;
      }
    }
    for (const wc of (e.worldChanges || [])) {
      const flag = wc.slice(0, 80).trim();
      if (flag) state.world_flags[flag] = true;
    }
  }
  return state;
}

// ── Parse raw events.md text → array of event objects ────────────────────────
// Light standalone parser; does NOT require parsers.js (avoids circular dep).
// Splits by "### 📅" headers, extracts title/date/participants/worldChanges.
function parseEventsText(raw = '') {
  const chunks = raw.split(/(?=^### 📅)/m).filter(c => c.trim());
  return chunks.map((chunk, id) => {
    const lines = chunk.split('\n');
    const heading = lines[0].replace(/^###\s*📅\s*/, '').trim();
    const dash = heading.indexOf(' — ');
    const date  = dash !== -1 ? heading.slice(0, dash).trim() : heading;
    const afterDash = dash !== -1 ? heading.slice(dash + 3).trim() : '';
    const sentences = afterDash.split('. ');
    const title = (sentences.length > 1 ? sentences.slice(1).join('. ') : afterDash).replace(/\.\s*$/, '').trim();

    const participants = [], worldChanges = [];
    let field = null;
    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^-\s*\*\*👥/.test(t)) { field = 'participants'; continue; }
      if (/^-\s*\*\*🌍/.test(t)) { field = 'worldChanges'; continue; }
      if (/^-\s*\*\*[📍📋⚖️]/.test(t)) { field = null; continue; }
      if (field === 'participants' && /^\s*-\s+/.test(lines[i])) {
        const clean = t.replace(/^-\s*/, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
        const name = clean.split(/\s+\(|\s+—\s+|\s+→\s+/)[0].trim();
        if (name) participants.push({ name, text: clean });
      }
      if (field === 'worldChanges' && /^\s*-\s+/.test(lines[i])) {
        const clean = t.replace(/^-\s*/, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
        if (clean) worldChanges.push(clean);
      }
    }
    return { id, date, title, participants, worldChanges };
  });
}

// ── Ограничения города для промтов генерации (D2, план 2026-07-15) ────────────
// Секции city.md, которые генерация обязана соблюдать. Живут в конце файла и
// не попадают в cityMd.slice(0, 2000) — поэтому извлекаются явно.
const CITY_CONSTRAINT_SECTIONS = [
  ['limits', 'Ограничения генерации'],
  ['edicts', 'Законы домена'],
  ['hunting', 'Охотничьи угодья'],
  ['tech', 'Технологии и Маскарад'],
];

// Блок «ОГРАНИЧЕНИЯ ГОРОДА» для system-промтов генерации сценариев/локаций.
// Пустые секции (плейсхолдер «- …» парсится в '') пропускаются; если не
// заполнено ничего — возвращает '' (в промт не попадает).
function buildCityConstraints(city) {
  const { parseCityMd } = require('./parsers');
  let parsed;
  try {
    parsed = parseCityMd(fs.readFileSync(path.join(ROOT, 'cities', city, 'city.md'), 'utf8'));
  } catch { return ''; }
  const parts = [];
  for (const [key, heading] of CITY_CONSTRAINT_SECTIONS) {
    const v = ((parsed.sections || {})[key] || '').trim();
    if (v) parts.push(`## ${heading}\n${v}`);
  }
  if (!parts.length) return '';
  return `# ОГРАНИЧЕНИЯ ГОРОДА — соблюдай строго: не создавай локации и сущности сверх этих лимитов; при конфликте переиспользуй существующие\n${parts.join('\n\n')}`;
}

// ── Часы угроз (E1, план 2026-07-15) ──────────────────────────────────────────
// Секция «⏱️ Часы угроз» в блоке «Состояние мира» (events.md): таблица
// Угроза | Прогресс N/M | Заметка. Тикает Рассказчик руками (кнопка в UI);
// генерация получает часы фоном — назревающие процессы города.
function buildThreatClocks(city) {
  const { parseWorldStateBlock } = require('./parsers');
  let ws;
  try {
    ws = parseWorldStateBlock(fs.readFileSync(path.join(ROOT, 'cities', city, 'archive', 'events.md'), 'utf8'));
  } catch { return ''; }
  const sec = (ws.sections || []).find(s => /часы угроз/i.test(s.heading));
  if (!sec || !sec.rows.length) return '';
  const lines = sec.rows.map(cells => {
    const full = cells.some(c => { const m = String(c).trim().match(/^(\d+)\s*\/\s*(\d+)$/); return m && +m[1] >= +m[2]; });
    return `- ${cells.filter(Boolean).join(' — ')}${full ? ' [ПРОБИЛО — угроза разразилась]' : ''}`;
  });
  return `# ЧАСЫ УГРОЗ ГОРОДА — назревающие процессы (прогресс N/M). Учитывай их как фон сцен; пробитые часы уже разразились\n${lines.join('\n')}`;
}

// ── Именник города (F, план 2026-07-15) ───────────────────────────────────────
// Секция «Именник и фактура» city.md: банк имён по слоям общества, клановые
// конвенции, фактура эпохи. Против англицизмов и повторов в AI-именах НПС.
function buildCityNaming(city) {
  const { parseCityMd } = require('./parsers');
  let parsed;
  try {
    parsed = parseCityMd(fs.readFileSync(path.join(ROOT, 'cities', city, 'city.md'), 'utf8'));
  } catch { return ''; }
  const v = ((parsed.sections || {}).naming || '').trim();
  if (!v) return '';
  return `# ИМЕННИК И ФАКТУРА ГОРОДА — имена новых НПС выбирай отсюда (или в этом же духе), не повторяя имён существующих персонажей города; фактуру используй для достоверности деталей\n${v}`;
}

module.exports = {
  loadLiteraryStyle,
  loadDiaryStyleRules,
  loadNarrativeCore,
  findCharacterCard,
  compressEventsToState,
  compressChronicleEvents,
  parseEventsText,
  buildNarrativeContext,
  buildCityConstraints,
  buildThreatClocks,
  buildCityNaming,
};
