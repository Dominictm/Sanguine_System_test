'use strict';
// Character card + diary entry parsing. Extracted from parsers.js
// during the 2026-07-12 decomposition.

const { readPrompt } = require('./shared');

// ── Diary parser ─────────────────────────────────────────────────────────────
// Single diary file → structured object. Two layouts:
//   • 'entry'         — one record (author/location/tone/text/crossRefs)
//   • 'retrospective' — several dated ### 📅 sections
/**
 * @param {string} rawContent — содержимое файла дневника (`ГГГГ-ММ.md` или `retrospective.md`)
 * @returns {{format: 'entry'|'retrospective', title?: string, session?: string, author?: string,
 *   location?: string, tone?: string, text?: string, crossRefs?: string[],
 *   sections?: {title: string, body: string}[]}}
 */
function parseDiary(rawContent) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const d = {};

  const hm = content.match(/^#\s+(.+)$/m);
  if (hm) d.title = hm[1].trim();

  const sectionMatches = [...content.matchAll(/^###\s+📅\s+(.+)$/gm)];

  if (sectionMatches.length > 1) {
    d.format = 'retrospective';
    d.sections = sectionMatches.map((m, i) => {
      const title = m[1].trim();
      const bodyStart = m.index + m[0].length;
      const bodyEnd = i + 1 < sectionMatches.length ? sectionMatches[i + 1].index : content.length;
      const body = content.slice(bodyStart, bodyEnd).replace(/(\n---+)+\s*$/, '').trim();
      return { title, body };
    });
  } else {
    d.format = 'entry';
    if (sectionMatches.length === 1) d.session = sectionMatches[0][1].trim();

    for (const [label, key] of [
      ['👤 Автор',     'author'],
      ['📍 Локация',   'location'],
      ['🎭 Тон\\/Стиль', 'tone'],
    ]) {
      const m = content.match(new RegExp(`- \\*\\*${label}:\\*\\*\\s*(.+)$`, 'm'));
      if (m) d[key] = m[1].trim();
    }

    const textM = content.match(/- \*\*📖 Текст записи:\*\*\n([\s\S]+?)(?=\n- \*\*[🔗📝👁]|$)/);
    if (textM) d.text = textM[1].replace(/^[ \t]{1,2}/gm, '').trim();

    const crossM = content.match(/- \*\*🔗 Зеркальная ссылка:\*\*\n([\s\S]+?)(?=\n- \*\*[📝👁]|\n---|$)/);
    if (crossM) {
      d.crossRefs = crossM[1].split('\n')
        .filter(l => /^\s+-/.test(l))
        .map(l => l.replace(/^\s+-\s*/, '').trim())
        .filter(Boolean);
    }
  }

  return d;
}

// ── Relationship categoriser ─────────────────────────────────────────────────
/**
 * @param {string} desc — свободный текст описания отношения
 * @returns {'family'|'sire'|'childe'|'enemy'|'ally'|'romantic'|'suspicious'|'loyalty'|'secret'|'acquaintance'|'neutral'}
 *   первое совпавшее по ключевым словам, иначе 'neutral'
 */
function categorizeRel(desc) {
  const d = desc.toLowerCase();
  if (/сестр|брат|мать|отец|семь|родств|племян/.test(d)) return 'family';
  if (/сир|создал|обратил|обратила/.test(d))              return 'sire';
  if (/чайлд|потомок/.test(d))                            return 'childe';
  if (/враг|ненавид|угроз|конфликт|противн/.test(d))      return 'enemy';
  if (/союзник|друг|доверя|помощ|поддерж/.test(d))        return 'ally';
  if (/любов|романт|привязан|влюбл/.test(d))              return 'romantic';
  if (/подозр|осторожн|насторож/.test(d))                 return 'suspicious';
  if (/лояльн|предан|служ|свита/.test(d))                 return 'loyalty';
  if (/тайн|секрет|скрыт|негласн|подпольн/.test(d))       return 'secret';
  if (/знаком|приятел|контакт|встреч/.test(d))            return 'acquaintance';
  return 'neutral';
}

// ── Character card parser ────────────────────────────────────────────────────
/**
 * Разбирает Markdown-карточку персонажа в плоскую структуру для API/фронтенда.
 * @param {string} rawContent — содержимое `<slug>.md`
 * @param {string} folderName — имя папки персонажа (fallback для `name`, если нет H1)
 * @param {string} [lineage] — линейка WoD, если уже известна (иначе выводится из «Линейка WoD»)
 * @returns {{name: string, lineage: string, lineageLabel?: string, statusType: string,
 *   relationships: {target: string, description: string, type: string}[], diaries: {title: string, file: string}[],
 *   imagePrompt?: string, negativePrompt?: string, [field: string]: *}}
 *   остальные поля (clan, sect, biography, appearance, …) — по маппингу русских лейблов карточки, см. тело функции
 */
function parseCharacter(rawContent, folderName, lineage) {
  const content = rawContent.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const c = { name: folderName, lineage, relationships: [] };

  // Name from # header (strip leading emoji / whitespace)
  const hm = content.match(/^#\s+[^\wЀ-ӿ]*([\wЀ-ӿ].+)$/m);
  if (hm) c.name = hm[1].trim();

  // Key-value fields:  - **Поле:** Значение
  const fRe = /^- \*\*([^*:\n]+):\*\*\s*(.+)$/gm;
  let m;
  while ((m = fRe.exec(content)) !== null) {
    const k = m[1].trim();
    const v = m[2].trim();
    if (k === 'Клан')         c.clan         = v;
    if (k === 'Секта')        c.sect         = v;
    if (k === 'Поколение')    c.generation   = v;
    if (k === 'Статус')                         c.status        = v;
    if (k === 'Детали статуса')                 c.statusDetails = v;
    if (k === 'Линейка WoD')                    c.lineageLabel  = v;
    if (k === 'Пол')                            c.gender        = v;
    if (k === 'Роль')                           c.role          = v;
    if (k === 'Год обращения')                  c.embraceYear   = v;
    if (k === 'Сир')                            c.sire          = v;
    if (k === 'Год рождения')                   c.birthYear     = v;
    if (k === 'Биография')                      c.biography     = v;
    if (k === 'Голос')                          c.voice         = v;
    if (k === 'Характер')                       c.personality   = v;
    if (k === 'Внешность')                      c.appearance    = v;
    if (k === 'Натура')                         c.nature        = v;
    if (k === 'Маска')                          c.demeanor      = v;
    if (k === 'Амплуа')                         c.concept       = v;
    if (k === 'Дитя')                           c.childe        = v;
    if (k === 'Домен / Локация')                c.location      = v;
    if (/иерархи/i.test(k))                     c.hierarchy     = v;   // «Иерархия в городе» / устар. варианты
    if (k === 'Деранжементы / Особенности')     c.derangements  = v;
    if (k === 'Дисциплины')                     c.disciplines   = v;
    if (k === 'Профессия')                      c.profession    = v;
    if (k === 'Клан / Раса' && !c.clan)         c.clan          = v;
    if (k === 'Род' && !c.clan)                 c.clan          = v;
    if (k === 'Секта / Двор' && !c.sect)        c.sect          = v;
    if (k === 'Фригольд / Локация' && !c.location) c.location  = v;
    if (k === 'Фригольд' && !c.location)        c.location      = v;
    if (k === 'Принадлежность')                 c.belonging     = v;
    if (k === 'Присутствие')                    c.presence      = v;   // появления в других городах
    if (k === 'Алиасы')                         c.aliases       = v;
    // ── Линейко-специфичные поля (феи/смертные/иное) ──
    if (k === 'Раса')                           c.race          = v;   // фейри: кит/раса
    if (k === 'Род')                            c.kith          = v;   // фейри: род (отд. от clan-fallback выше)
    if (k === 'Двор')                           c.court         = v;   // фейри: Сияющий/Сумрачный/Теневой двор
    if (k === 'Титул')                          c.title         = v;
    if (k === 'Особенности / Способности')      c.features      = v;
    if (k === 'Родственники')                   c.relatives     = v;   // смертные
    if (k === 'Отношение к сверхъестественному') c.attitude     = v;   // смертные
  }

  // Diary links: - **📖 Дневники:** [Title](path.md)
  const diaryField = content.match(/- \*\*📖 Дневники:\*\*\s*(.+)$/m);
  if (diaryField) {
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    c.diaries = [];
    let lm;
    while ((lm = linkRe.exec(diaryField[1])) !== null) {
      c.diaries.push({ title: lm[1], file: lm[2] });
    }
  } else {
    c.diaries = [];
  }

  // Image prompts (handles both card formats — see readPrompt)
  const imgP = readPrompt(content, 'image');
  if (imgP !== undefined) c.imagePrompt = imgP;
  const negP = readPrompt(content, 'negative');
  if (negP !== undefined) c.negativePrompt = negP;

  // Relationships section (indented sub-bullets after **Отношения:**)
  const relBlock = content.match(/- \*\*Отношения:\*\*\n((?:[ \t]+- .+\n?)+)/);
  if (relBlock) {
    const lines = relBlock[1].split('\n').filter(l => /^\s+-/.test(l));
    for (const line of lines) {
      const clean = line.trim().replace(/^-\s*/, '');
      const dash  = clean.indexOf(' — ');
      if (dash === -1) continue;
      const targets = clean.slice(0, dash).split(',')
        .map(t => t.trim().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim())
        .filter(Boolean);
      const desc = clean.slice(dash + 3).trim();
      for (const tgt of targets) {
        c.relationships.push({ target: tgt, description: desc, type: categorizeRel(desc) });
      }
    }
  }

  // Lineage normalisation
  if (!c.lineage) {
    const ll = (c.lineageLabel || '').toLowerCase();
    if      (ll.includes('вампир'))                     c.lineage = 'vampire';
    else if (ll.includes('фея') || ll.includes('ченджлинг')) c.lineage = 'fairy';
    else if (ll.includes('смертн') || ll.includes('человек')) c.lineage = 'mortal';
    else if (ll.includes('оборот'))                     c.lineage = 'werewolf';
    else if (ll.includes('маг'))                        c.lineage = 'mage';
    else if (ll.includes('охотник'))                    c.lineage = 'hunter';
    else                                                c.lineage = 'unknown';
  }

  // Status type
  const sl = (c.status || '').toLowerCase();
  c.statusType = (sl.includes('жив') || sl.includes('жива') || sl.includes('активен') || sl.includes('активна')) ? 'active'
    : sl.includes('торпор') ? 'torpor'
    : (sl.includes('мёртв') || sl.includes('мертва') || sl.includes('погиб') || sl.includes('уничтожен') || sl.includes('убит')) ? 'dead'
    : sl.includes('пропал') ? 'missing'
    : sl.includes('неизвестно') ? 'unknown'
    : 'unknown';

  return c;
}

module.exports = { parseDiary, categorizeRel, parseCharacter };
