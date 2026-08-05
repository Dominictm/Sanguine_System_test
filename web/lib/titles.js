'use strict';
// Парсер справочника титулов: system/library/titles/<slug>.md → структура для API/веба.
// Зеркало clans.js/sects.js, с двумя отличиями: поле «Принадлежность» (свободный
// текст — не всегда секта, у части титулов это клан или смертный род) вместо
// «Секта», и опциональный boolean-флаг «Негативный» (нет у Клана/Секты).
//
// Формат файла:
//   # <Название>
//   - **Принадлежность:** …
//   - **Негативный:** да          ← строка присутствует только если true
//   - **Источник:** https://wod.fandom.com/…
//   > (опц. примечание — строки-цитаты)
//   ## Описание
//   <текст>

const EMOJI_RE = /^#\s+([^\wА-Яа-яЁё]*)\s*(.+)$/m;

function field(content, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = content.match(new RegExp(`^[-*]\\s*\\*\\*${esc}\\s*:\\*\\*\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

function parseTitleMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const t = { slug, name: slug, affiliation: '', negative: false, source: '', note: '', description: '', custom: false };

  const hm = content.match(EMOJI_RE);
  if (hm) t.name = hm[2].trim();
  t.affiliation = field(content, 'Принадлежность') || '';
  t.negative    = field(content, 'Негативный') === 'да';
  t.source      = field(content, 'Источник') || '';
  t.custom      = field(content, 'Авторское') === 'да';

  // Примечание — строки-цитаты ДО первого «## ».
  const head = content.split(/\n##\s/)[0];
  const noteLines = (head.match(/^>\s?(.*)$/gm) || []).map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean);
  if (noteLines.length) t.note = noteLines.join(' ');

  // «## Описание» — единственная содержательная секция (без вложенных уровней).
  const dm = content.match(/\n##\s+Описание\s*\n+([\s\S]*)$/i);
  if (dm) t.description = dm[1].replace(/\n-{3,}\s*$/, '').trim();

  return t;
}

module.exports = { parseTitleMd };
