'use strict';
// Роутер звуковой библиотеки (саундборд) — общая для всех городов коллекция
// аудиодорожек. Хранится в cities/audio/ (index.json + файлы по id), см.
// docs/superpowers/specs/2026-07-10-audio-library-design.md. Ничего здесь не
// коммитится в git (.gitignore) — каждая установка собирает свою библиотеку.

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const crypto  = require('crypto');
const { serverError } = require('../lib/http');
const { AUDIO_DIR, writeFileAtomic } = require('../lib/db');

const router = express.Router();

const INDEX_PATH = path.join(AUDIO_DIR, 'index.json');

const MIME_EXT = {
  'audio/mpeg':  'mp3',
  'audio/ogg':   'ogg',
  'audio/wav':   'wav',
  'audio/x-wav': 'wav',
};
const MAX_BYTES = 20 * 1024 * 1024; // 20MB, см. спеку

async function readIndex() {
  const raw = await fs.readFile(INDEX_PATH, 'utf-8').catch(() => null);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function writeIndex(list) {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await writeFileAtomic(INDEX_PATH, JSON.stringify(list, null, 2), 'utf-8');
}

router.get('/api/audio', async (_req, res) => {
  try {
    const list = await readIndex();
    res.json(list.map(t => ({ ...t, url: `/audio-lib/${t.id}.${t.ext}` })));
  } catch (e) { serverError(res, e); }
});

router.post('/api/audio', async (req, res) => {
  try {
    const { title, filename, mimetype, data } = req.body || {};
    const ext = MIME_EXT[mimetype];
    if (!ext) return res.status(400).json({ error: 'Неподдерживаемый формат аудио (нужен mp3/ogg/wav)' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Название не может быть пустым' });
    if (!data) return res.status(400).json({ error: 'Файл не передан' });

    const buf = Buffer.from(data, 'base64');
    if (buf.length > MAX_BYTES) return res.status(400).json({ error: 'Файл больше 20МБ' });

    const id = crypto.randomUUID();
    await fs.mkdir(AUDIO_DIR, { recursive: true });
    await writeFileAtomic(path.join(AUDIO_DIR, `${id}.${ext}`), buf);

    const list = await readIndex();
    const entry = {
      id, ext, filename: filename || `${id}.${ext}`,
      title: title.trim(), volume: 1, createdAt: new Date().toISOString(),
    };
    list.push(entry);
    await writeIndex(list);

    res.json({ ...entry, url: `/audio-lib/${id}.${ext}` });
  } catch (e) { serverError(res, e); }
});

module.exports = { router, readIndex, writeIndex };
