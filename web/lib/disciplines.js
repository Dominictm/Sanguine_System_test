'use strict';
// Парсер справочника дисциплин: system/library/disciplines/<slug>.md → структура для API/веба.
// Канонический источник — MD-файлы (по одному на дисциплину). Формат см. README.md там же.
//
// Формат файла:
//   # <emoji> <Название> (English)
//   - **Клан / принадлежность:** …
//   - **Источник:** https://wod.su/…
//   > (опц. примечание дисциплины — строки-цитаты)
//   ## Уровень N — <Название силы> (English)      ← «плоская» сила
//   **Литературное описание.** …
//   **Система.** …
//   ## Путь … (The … Path)                          ← группа (Некромантия/Тауматургия)
//   ### Уровень N — <Сила>
//   **Литературное описание.** … / **Система.** …

const EMOJI_RE = /^#\s+([^\wА-Яа-яЁё]*)\s*(.+)$/m;

function field(content, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = content.match(new RegExp(`^[-*]\\s*\\*\\*${esc}\\s*:\\*\\*\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

// «Уровень 3 — Усмирение Зверя (Quell the Beast)» → { level:3, name:'…' }
function parsePowerHeading(text) {
  const m = text.match(/^Уровень\s+(\d+)\s*[—–-]\s*(.+)$/i);
  if (!m) return null;
  return { level: parseInt(m[1], 10), name: m[2].trim() };
}

// Из тела секции вытащить «Литературное описание.» и «Система.»
function splitPowerBody(body) {
  const lit = body.match(/\*\*Литературное описание\.?\*\*\s*([\s\S]*?)(?=\n\s*\*\*Система|\s*$)/i);
  const sys = body.match(/\*\*Система\.?\*\*\s*([\s\S]*?)\s*$/i);
  // Снять хвостовой markdown-разделитель (--- перед следующим заголовком) и схлопнуть пробелы.
  const clean = s => s ? s.replace(/\n-{3,}\s*$/, '').replace(/\s+/g, ' ').replace(/\s*-{3,}\s*$/, '').trim() : '';
  return { literary: clean(lit && lit[1]), system: clean(sys && sys[1]) };
}

function parseDisciplineMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const d = { slug, name: slug, clans: '', source: '', note: '', group: 'base', levels: [], paths: [], custom: false };

  const hm = content.match(EMOJI_RE);
  if (hm) d.name = hm[2].trim();
  d.clans  = field(content, 'Клан / принадлежность') || field(content, 'Клан') || '';
  d.group = (field(content, 'Группа') || 'base').trim().toLowerCase();
  d.source = field(content, 'Источник') || '';
  d.custom = field(content, 'Авторское') === 'да';

  // Примечание дисциплины — строки-цитаты ДО первого «## ».
  const head = content.split(/\n##\s/)[0];
  const noteLines = (head.match(/^>\s?(.*)$/gm) || []).map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean);
  if (noteLines.length) d.note = noteLines.join(' ');

  // Разбить на H2-секции.
  const h2parts = content.split(/\n##\s+/).slice(1); // [0] — шапка
  for (const part of h2parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const bodyAll = nl === -1 ? '' : part.slice(nl + 1);

    // «Уровень N — …» → плоская сила дисциплины.
    const ph = parsePowerHeading(heading);
    if (ph) { d.levels.push({ ...ph, ...splitPowerBody(bodyAll) }); continue; }

    // Иначе это группа-Путь (Некромантия/Тауматургия) — её имя может и не содержать
    // слова «Путь» («Привлечение Огней», «Руки Разрушения»). Признак — наличие
    // вложенных H3-сил «Уровень N — …». Путь без сил не добавляем.
    const h3parts = bodyAll.split(/\n###\s+/).slice(1);
    const levels = [];
    for (const h3 of h3parts) {
      const n3 = h3.indexOf('\n');
      const h3head = (n3 === -1 ? h3 : h3.slice(0, n3)).trim();
      const h3body = n3 === -1 ? '' : h3.slice(n3 + 1);
      const p3 = parsePowerHeading(h3head);
      if (!p3) continue;
      levels.push({ ...p3, ...splitPowerBody(h3body) });
    }
    if (!levels.length) continue;
    const curPath = { name: heading, levels };
    // Возможна вводная заметка пути до первого H3.
    const pathHead = bodyAll.split(/\n###\s+/)[0];
    const pnote = (pathHead.match(/^>\s?(.*)$/gm) || []).map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean);
    if (pnote.length) curPath.note = pnote.join(' ');
    d.paths.push(curPath);
  }

  d.noLevels = d.levels.length === 0 && d.paths.length > 0;
  return d;
}

// ── Слаг файла арта для Пути ────────────────────────────────────────────────
// «Путь Ветра (Way of the Wind)» → 'koldun__way_of_the_wind'. Базой служит
// английское имя в скобках; у Путей без него (Некромантия: «Путь Склепа»)
// — транслитерация русского. Единая точка истины для сервера (hasArt) и
// tools/generate_library_art.js (имена PNG в манифесте).
const RU_TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function slugifyName(s) {
  return String(s || '').toLowerCase()
    .split('').map(ch => RU_TR[ch] !== undefined ? RU_TR[ch] : ch).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function pathArtSlug(discSlug, pathName) {
  const m = String(pathName || '').match(/\(([^)]+)\)\s*$/);
  return discSlug + '__' + slugifyName(m ? m[1] : pathName);
}

module.exports = { parseDisciplineMd, slugifyName, pathArtSlug };
