'use strict';
// Парсер справочника кланов: system/library/clans/<slug>.md → структура для API/веба.
// Формат см. README.md там же. В отличие от дисциплин/психики клан — НЕ силовая
// шкала (нет «## Уровень N») — одна запись, один блок «## Описание» в теле.
//
// Формат файла:
//   # <emoji> <Название> (English)
//   - **Секта:** …
//   - **Дисциплины:** …
//   - **Слабость:** …
//   - **Источник:** https://wod.su/…
//   > (опц. примечание — строки-цитаты)
//   ## Описание
//   <текст>

const EMOJI_RE = /^#\s+([^\wА-Яа-яЁё]*)\s*(.+)$/m;

function field(content, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = content.match(new RegExp(`^[-*]\\s*\\*\\*${esc}\\s*:\\*\\*\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

function parseClanMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const c = { slug, name: slug, sect: '', disciplines: '', weakness: '', source: '', note: '', description: '', custom: false };

  const hm = content.match(EMOJI_RE);
  if (hm) c.name = hm[2].trim();
  c.sect        = field(content, 'Секта') || '';
  c.disciplines = field(content, 'Дисциплины') || '';
  c.weakness    = field(content, 'Слабость') || '';
  c.source      = field(content, 'Источник') || '';
  c.custom      = field(content, 'Авторское') === 'да';

  // Примечание — строки-цитаты ДО первого «## ».
  const head = content.split(/\n##\s/)[0];
  const noteLines = (head.match(/^>\s?(.*)$/gm) || []).map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean);
  if (noteLines.length) c.note = noteLines.join(' ');

  // «## Описание» — единственная содержательная секция (без вложенных уровней).
  const dm = content.match(/\n##\s+Описание\s*\n+([\s\S]*)$/i);
  if (dm) c.description = dm[1].replace(/\n-{3,}\s*$/, '').trim();

  return c;
}

module.exports = { parseClanMd };
