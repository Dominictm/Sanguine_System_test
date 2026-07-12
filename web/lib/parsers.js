'use strict';
// Pure helpers shared between server.js and the test suite.
// No file I/O, no Express — just string parsing and formatting.

const {
  RU_MONTHS_NOM, CYRILLIC_TR, LATIN_TR, slugify,
  THREAD_STATUS, readPrompt, writePrompt, periodLabel,
  mdExtractLinks, mdStripLinks, mdStripInline,
} = require('./parsers/shared');
const {
  CITY_SECTIONS, CITY_DEFAULT_DESCRIPTION, buildCityMd, parseCityMd,
  cityScaffold, parsePoliticalFactions, setPoliticalFactionInfluence,
} = require('./parsers/city');
const { parseDiary, categorizeRel, parseCharacter } = require('./parsers/character');
const { parseLocation } = require('./parsers/location');
const {
  parseScenarioSections, splitH3Body, serializeScenarioSections,
  replaceScenarioSection, findScenarioSectionIndex, replaceScenarioSections,
  SCENE_ADDED_MARKER_RE, isFinaleHeading, hasManualSceneMarker,
  addManualSceneMarker, clearManualSceneMarker, insertScenarioScene,
  SCENARIO_REQUIRED_TOPICS, checkScenarioStructure,
} = require('./parsers/scenario');
const { threadStatusKey, parseThreadsContent } = require('./parsers/threads');

/**
 * @param {{text: string, href: string}} link
 * @returns {{text: string, href: string, kind: 'finale'|'module'|'npc'|'other', module: string|null}}
 */
function classifyChronicleLink({ text, href }) {
  const t = text.toLowerCase();
  let kind = 'other';
  if (t.includes('инал'))                       kind = 'finale';
  else if (t.includes('одул'))                  kind = 'module';
  else if (t.includes('нпс') || t.includes('npc')) kind = 'npc';
  // Module folder name = first path segment after modules/
  let module = null;
  const mm = href.match(/modules\/([^/]+)\//);
  if (mm) module = decodeURIComponent(mm[1]);
  return { text, href, kind, module };
}

// ── Chronicle (events.md) parsers ────────────────────────────────────────────
// Extract clickable location links (those pointing into locations/) + plain text
/**
 * @param {string} rest — текст после «📍 Локация:» в записи события
 * @returns {{text: string, links: {text: string, slug: string}[]}} ссылки — только ведущие в `locations/`
 */
function parseChronicleLocation(rest) {
  const links = mdExtractLinks(rest)
    .filter(l => /locations\//.test(l.href))
    .map(l => {
      const base = l.href.split('/').pop().replace(/\.md$/i, '');
      return { text: l.text, slug: decodeURIComponent(base) };
    });
  return { text: mdStripLinks(rest).trim(), links };
}

/**
 * @param {string} line — под-буллет из «👥 Участники» события
 * @returns {{text: string, name: string}} name — ведущий идентификатор до первой `(`/`—`/`→`, для сверки с карточками
 */
function parseParticipant(line) {
  const clean = mdStripLinks(line.replace(/^\s*-\s*/, '')).replace(/\*\*/g, '').trim();
  // Name = leading text before first " (", " — " or " →"
  const name = clean.split(/\s+\(|\s+—\s+|\s+→\s+/)[0].trim();
  return { text: clean, name };
}

/**
 * @param {string[]} lines — строки блока (может содержать не-табличные строки вперемешку)
 * @returns {{headers: string[], rows: string[][]}|null} null, если строк таблицы меньше 2 (заголовок+разделитель)
 */
function parseTable(lines) {
  const rowLines = lines.filter(l => /^\s*\|/.test(l));
  if (rowLines.length < 2) return null;
  const parseRow = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => mdStripLinks(c).replace(/\*\*/g, '').trim());
  const headers = parseRow(rowLines[0]);
  const body = rowLines.slice(2).map(parseRow);   // skip separator row
  return { headers, rows: body };
}

/**
 * @param {string} block — блок «## 🌍 Состояние мира» из events.md
 * @returns {{lastUpdate: string|null, sections: {heading: string, table: {headers: string[], rows: string[][]}|null, prose: string[]}[]}}
 */
function parseWorldState(block) {
  const ws = { lastUpdate: null, sections: [] };
  const lu = block.match(/Последнее обновление:\s*\*\*([^*]+)\*\*/);
  if (lu) ws.lastUpdate = lu[1].trim();

  for (const part of block.split(/\n(?=###\s)/)) {
    const lines = part.split('\n');
    if (!/^###\s/.test(lines[0])) continue;
    const heading = lines[0].replace(/^###\s*/, '').trim();
    const body = lines.slice(1);
    const table = parseTable(body);
    const prose = body
      .map(l => l.trim())
      .filter(l => l && !/^\|/.test(l) && !/^---+$/.test(l) && !/^>/.test(l))
      .map(mdStripLinks);
    ws.sections.push({ heading, table, prose });
  }
  return ws;
}

/**
 * @param {string} chunk — один блок `### 📅 …` из events.md
 * @param {number} id — порядковый номер события в хронике
 * @returns {{id: number, heading: string, date: string, title: string, parallel: string|null,
 *   location: {text: string, links: {text: string, slug: string}[]},
 *   participants: {text: string, name: string}[], eventsText: string,
 *   consequences: string[], worldChanges: string[], links: object[]}}
 */
function parseEvent(chunk, id) {
  const lines = chunk.split('\n');
  const ev = {
    id, parallel: null, location: { text: '', links: [] },
    participants: [], eventsText: '', consequences: [], worldChanges: [], links: []
  };
  ev.heading = lines[0].replace(/^###\s*📅\s*/, '').trim();
  const dash = ev.heading.indexOf(' — ');
  ev.date  = dash !== -1 ? ev.heading.slice(0, dash).trim() : ev.heading;
  // После даты заголовок имеет вид "[краткая локация]. [Название]." Первое предложение —
  // локация (дублирует поле 📍 ниже), остальное — название. Если предложение одно
  // (напр. у записей, созданных логгером) — это и есть название.
  const afterDash = dash !== -1 ? ev.heading.slice(dash + 3).trim() : '';
  const sentences = afterDash.split('. ');
  ev.title = (sentences.length > 1 ? sentences.slice(1).join('. ') : afterDash).replace(/\.\s*$/, '').trim();

  let field = null;
  const proseBuf = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (/^>\s*🔗/.test(t)) { mdExtractLinks(t).forEach(l => ev.links.push(classifyChronicleLink(l))); continue; }
    if (/^>\s*⚡/.test(t)) { const m = t.match(/\*(.+?)\*/); ev.parallel = m ? m[1].trim() : t.replace(/^>\s*⚡\s*/, '').trim(); continue; }

    const fm = t.match(/^-\s*\*\*([^:]+):\*\*\s*(.*)$/);
    if (fm && /📍|👥|📋|⚖️|🌍/.test(fm[1])) {
      const lbl = fm[1], rest = fm[2];
      if      (lbl.includes('📍')) { field = 'location';     const pl = parseChronicleLocation(rest); ev.location = pl; }
      else if (lbl.includes('👥')) { field = 'participants'; }
      else if (lbl.includes('📋')) { field = 'events';       if (rest) proseBuf.push(rest); }
      else if (lbl.includes('⚖️')) { field = 'consequences'; }
      else if (lbl.includes('🌍')) { field = 'worldChanges'; }
      continue;
    }

    if      (field === 'participants' && /^-\s+/.test(t)) ev.participants.push(parseParticipant(t));
    else if (field === 'consequences' && /^-\s+/.test(t)) ev.consequences.push(mdStripInline(t));
    else if (field === 'worldChanges' && /^-\s+/.test(t)) ev.worldChanges.push(mdStripInline(t));
    else if (field === 'events')                          proseBuf.push(raw);
    else if (field === 'location' && t && !/^-/.test(t))  ev.location.text += ' ' + mdStripLinks(t).trim();
  }
  ev.eventsText = proseBuf.join('\n').trim();
  return ev;
}

/**
 * @param {string} raw — содержимое `events.md` хроники
 * @returns {{title: string, worldState: object|null, events: object[]}} events — см. {@link parseEvent}
 */
function parseChronicle(raw) {
  const content = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const hm = content.match(/^#\s+(.+)$/m);
  const title = hm ? hm[1].replace(/[*#]/g, '').trim() : 'Хроника';

  // World state block: between "## 🌍 Состояние мира" and "## 📋 Хроника событий"
  let worldState = null;
  const wsM = content.match(/##\s*🌍[^\n]*\n([\s\S]*?)(?=\n##\s)/);
  if (wsM) worldState = parseWorldState(wsM[1]);

  // Events block: after "## 📋 Хроника событий"
  const events = [];
  const evBlockM = content.match(/##\s*📋[^\n]*\n([\s\S]*)$/);
  if (evBlockM) {
    const chunks = evBlockM[1].split(/\n(?=###\s*📅)/).filter(c => /^###\s*📅/.test(c.trim()));
    chunks.forEach((c, i) => events.push(parseEvent(c.trim(), i)));
  }

  return { title, worldState, events };
}

/**
 * Собирает уникальные отображаемые имена участников из текста events.md хроники.
 * @param {string} eventsText
 * @returns {string[]}
 */
function parseChronicleParticipants(eventsText) {
  const names = new Set();
  let inPart = false;
  for (const line of eventsText.split('\n')) {
    if (/👥\s*Участники/i.test(line)) { inPart = true; continue; }
    if (inPart) {
      if (/^\s*-\s+/.test(line)) {
        // "  - Имя Фамилия (Клан, ...) — роль" — extract before first ( or —
        const raw = line.replace(/^\s*-\s+/, '').split(/[\(—\/]/)[0].trim();
        if (raw && !/без имён|безымянн/i.test(raw)) names.add(raw);
      } else if (!/^\s*$/.test(line) && !/^\s{2,}/.test(line)) {
        inPart = false;
      }
    }
  }
  return [...names];
}

module.exports = {
  RU_MONTHS_NOM,
  THREAD_STATUS,
  CYRILLIC_TR,
  LATIN_TR,
  slugify,
  CITY_SECTIONS,
  buildCityMd,
  parseCityMd,
  cityScaffold,
  parseDiary,
  readPrompt,
  writePrompt,
  periodLabel,
  threadStatusKey,
  parseThreadsContent,
  // markdown helpers
  mdExtractLinks,
  mdStripLinks,
  mdStripInline,
  classifyChronicleLink,
  // card & chronicle parsers
  categorizeRel,
  parseCharacter,
  parseLocation,
  parseChronicleLocation,
  parseParticipant,
  parseTable,
  parseWorldState,
  parseEvent,
  parseChronicle,
  parseChronicleParticipants,
  parseScenarioSections,
  replaceScenarioSection,
  splitH3Body,
  serializeScenarioSections,
  findScenarioSectionIndex,
  replaceScenarioSections,
  insertScenarioScene,
  hasManualSceneMarker,
  addManualSceneMarker,
  clearManualSceneMarker,
  isFinaleHeading,
  checkScenarioStructure,
  parsePoliticalFactions,
  setPoliticalFactionInfluence,
};
