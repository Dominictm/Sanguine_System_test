'use strict';
// Роутер открытых нитей: агрегированный список (archive + per-chronicle),
// создание строки таблицы, смена статуса/приоритета.
// Вынесено из server.js (E1.2).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError } = require('../lib/http');
const { DEFAULT_CITY, cityDir, chroniclesDir, reqCity, writeFileAtomic } = require('../lib/db');
const { THREAD_STATUS, parseThreadsContent } = require('../lib/parsers');

const router = express.Router();

// All threads across archive + per-chronicle files, each tagged with its file.
async function readThreadsStructured(city = DEFAULT_CITY) {
  const threads = [];
  const archRel = 'archive/open_threads.md';
  const archRaw = await fs.readFile(path.join(cityDir(city), archRel), 'utf-8').catch(() => null);
  if (archRaw) threads.push(...parseThreadsContent(archRaw, archRel));
  let chrs; try { chrs = await fs.readdir(chroniclesDir(city), { withFileTypes: true }); } catch { chrs = []; }
  for (const ch of chrs) {
    if (!ch.isDirectory()) continue;
    const rel = `chronicles/${ch.name}/open_threads.md`;
    const raw = await fs.readFile(path.join(cityDir(city), rel), 'utf-8').catch(() => null);
    if (raw) threads.push(...parseThreadsContent(raw, rel));
  }
  return threads;
}

// Whitelist + resolve a city-relative thread file to an absolute path (no traversal).
function resolveThreadFile(city, rel) {
  if (!/^(archive\/open_threads\.md|chronicles\/[^/]+\/open_threads\.md)$/.test(rel || '')) return null;
  return path.join(cityDir(city), rel);
}

router.get('/api/threads', async (req, res) => {
  try {
    res.json(await readThreadsStructured(reqCity(req)));
  } catch (e) { serverError(res, e); }
});

// Create a new thread (appends a table row). Default target: archive/open_threads.md.
router.post('/api/threads', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const { title, description = '', source = '', status = 'active', priority = 'Средний' } = req.body || {};
    const rel = req.body?.file || 'archive/open_threads.md';
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Укажите заголовок нити' });
    const abs = resolveThreadFile(city, rel);
    if (!abs) return res.status(400).json({ error: 'Некорректный файл нити' });
    const content = await fs.readFile(abs, 'utf-8').catch(() => null);
    if (content === null) return res.status(404).json({ error: 'Файл нитей не найден' });

    const lines     = content.split('\n');
    const headerIdx = lines.findIndex(l => /^\|\s*(№|#)\s*\|\s*Нить/.test(l));
    if (headerIdx === -1) return res.status(400).json({ error: 'В файле нет таблицы нитей' });

    const ids    = parseThreadsContent(content, rel).map(t => t.id);
    const nextId = ids.length ? Math.max(...ids) + 1 : 1;
    const desc   = String(description).trim();
    const statusText = THREAD_STATUS[status] || THREAD_STATUS.active;
    const row = `| ${nextId} | **${String(title).trim()}**${desc ? ' — ' + desc : ''} | ${String(source).trim() || '—'} | ${statusText} | ${priority} |`;

    let insertAt = headerIdx + 2; // skip header + separator
    while (insertAt < lines.length && lines[insertAt].trimStart().startsWith('|')) insertAt++;
    lines.splice(insertAt, 0, row);
    await writeFileAtomic(abs, lines.join('\n'), 'utf-8');
    res.json({ ok: true, id: nextId });
  } catch (e) { serverError(res, e); }
});

// Update a thread's status and/or priority in its source file.
router.patch('/api/threads/:id', express.json(), async (req, res) => {
  try {
    const city = reqCity(req);
    const id   = parseInt(req.params.id);
    const { file, status, priority } = req.body || {};
    if (status && !THREAD_STATUS[status]) return res.status(400).json({ error: 'Неизвестный статус' });
    const abs = resolveThreadFile(city, file);
    if (!abs) return res.status(400).json({ error: 'Некорректный файл нити' });

    const content = await fs.readFile(abs, 'utf-8').catch(() => null);
    if (content === null) return res.status(404).json({ error: 'Файл нитей не найден' });
    const lines = content.split('\n');

    let done = false;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\|\s*(\d+)\s*\|/);
      if (!m || parseInt(m[1]) !== id) continue;
      const cells = lines[i].split('|'); // ['', ' id ', ' **t** desc ', ' src ', ' status ', ' prio ', '']
      if (cells.length < 6) break;
      if (status)   cells[4] = ` ${THREAD_STATUS[status]} `;
      if (priority) cells[5] = ` ${String(priority).trim()} `;
      lines[i] = cells.join('|');
      done = true;
      break;
    }
    if (!done) return res.status(404).json({ error: 'Нить не найдена' });
    await writeFileAtomic(abs, lines.join('\n'), 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = { router };
