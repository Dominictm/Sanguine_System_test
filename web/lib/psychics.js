'use strict';
// Парсер справочника психических способностей: system/library/psychics/<slug>.md → структура для API/веба.
// Канонический источник — MD-файлы (по одному на способность). Формат см. README.md там же.
// Зеркало web/lib/disciplines.js (parseDisciplineMd) — психические способности устроены проще:
// нет Путей (нет вложенных H3), шкала всегда плоская «Уровень 1..5». Метаполе шапки — «Категория»
// вместо «Клан / принадлежность» (психики не привязаны к фракции).
//
// Формат файла:
//   # <emoji> <Название> (English)
//   - **Категория:** …
//   - **Бросок:** Атрибут + Способность   (опционально, не у всех способностей есть общая формула)
//   - **Источник:** https://wod.fandom.com/ru/…
//   > (опц. примечание способности — строки-цитаты)
//   ## Уровень N — <Название уровня>
//   **Литературное описание.** …
//   **Система.** …

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

function parsePsychicMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const p = { slug, name: slug, category: '', roll: '', source: '', note: '', levels: [] };

  const hm = content.match(EMOJI_RE);
  if (hm) p.name = hm[2].trim();
  p.category = field(content, 'Категория') || '';
  p.roll     = field(content, 'Бросок') || '';
  p.source   = field(content, 'Источник') || '';

  // Примечание способности — строки-цитаты ДО первого «## ».
  const head = content.split(/\n##\s/)[0];
  const noteLines = (head.match(/^>\s?(.*)$/gm) || []).map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean);
  if (noteLines.length) p.note = noteLines.join(' ');

  // Разбить на H2-секции — у психических способностей шкала всегда плоская (нет Путей/H3).
  const h2parts = content.split(/\n##\s+/).slice(1); // [0] — шапка
  for (const part of h2parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const bodyAll = nl === -1 ? '' : part.slice(nl + 1);

    const ph = parsePowerHeading(heading);
    if (!ph) continue; // неизвестный H2 (не «Уровень N — …») — пропускаем
    p.levels.push({ ...ph, ...splitPowerBody(bodyAll) });
  }

  return p;
}

module.exports = { parsePsychicMd };
