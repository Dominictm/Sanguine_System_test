'use strict';
// Парсер справочника сект: system/library/sects/<slug>.md → структура для API/веба.
// Формат см. README.md там же — зеркало clans.js, но без «Дисциплины»/«Слабость»
// (эти поля специфичны для клана, не для секты).
//
// Формат файла:
//   # <Название>
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

function parseSectMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const s = { slug, name: slug, source: '', note: '', description: '', custom: false };

  const hm = content.match(EMOJI_RE);
  if (hm) s.name = hm[2].trim();
  s.source = field(content, 'Источник') || '';
  s.custom = field(content, 'Авторское') === 'да';

  const head = content.split(/\n##\s/)[0];
  const noteLines = (head.match(/^>\s?(.*)$/gm) || []).map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean);
  if (noteLines.length) s.note = noteLines.join(' ');

  const dm = content.match(/\n##\s+Описание\s*\n+([\s\S]*)$/i);
  if (dm) s.description = dm[1].replace(/\n-{3,}\s*$/, '').trim();

  return s;
}

module.exports = { parseSectMd };
