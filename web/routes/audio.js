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
const { AUDIO_DIR, writeFileAtomic, reqCity, getAllLocations } = require('../lib/db');

const router = express.Router();

const INDEX_PATH = path.join(AUDIO_DIR, 'index.json');
const PRESETS_PATH = path.join(AUDIO_DIR, 'presets.json');

const MIME_EXT = {
  'audio/mpeg':  'mp3',
  'audio/ogg':   'ogg',
  'audio/wav':   'wav',
  'audio/x-wav': 'wav',
};
const MAX_BYTES = 20 * 1024 * 1024; // 20MB, см. спеку
const CATEGORIES = ['music', 'effect'];

async function readIndex() {
  const raw = await fs.readFile(INDEX_PATH, 'utf-8').catch(() => null);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function writeIndex(list) {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await writeFileAtomic(INDEX_PATH, JSON.stringify(list, null, 2), 'utf-8');
}

async function readPresets() {
  const raw = await fs.readFile(PRESETS_PATH, 'utf-8').catch(() => null);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function writePresets(list) {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await writeFileAtomic(PRESETS_PATH, JSON.stringify(list, null, 2), 'utf-8');
}

router.get('/api/audio', async (_req, res) => {
  try {
    const list = await readIndex();
    res.json(list.map(t => ({ ...t, url: `/audio-lib/${t.id}.${t.ext}` })));
  } catch (e) { serverError(res, e); }
});

router.post('/api/audio', async (req, res) => {
  try {
    const { title, filename, mimetype, data, category } = req.body || {};
    const ext = MIME_EXT[mimetype];
    if (!ext) return res.status(400).json({ error: 'Неподдерживаемый формат аудио (нужен mp3/ogg/wav)' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Название не может быть пустым' });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Укажите категорию: фоновая музыка или аудио эффект' });
    if (!data) return res.status(400).json({ error: 'Файл не передан' });

    const buf = Buffer.from(data, 'base64');
    if (buf.length > MAX_BYTES) return res.status(400).json({ error: 'Файл больше 20МБ' });

    const id = crypto.randomUUID();
    await fs.mkdir(AUDIO_DIR, { recursive: true });
    await writeFileAtomic(path.join(AUDIO_DIR, `${id}.${ext}`), buf);

    const list = await readIndex();
    const entry = {
      id, ext, filename: filename || `${id}.${ext}`,
      title: title.trim(), volume: 1, loop: true, category, createdAt: new Date().toISOString(),
    };
    list.push(entry);
    await writeIndex(list);

    res.json({ ...entry, url: `/audio-lib/${id}.${ext}` });
  } catch (e) { serverError(res, e); }
});

router.put('/api/audio/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const list = await readIndex();
    const entry = list.find(t => t.id === id);
    if (!entry) return res.status(404).json({ error: 'Звук не найден' });

    if (typeof req.body.title === 'string') {
      const trimmed = req.body.title.trim();
      if (!trimmed) return res.status(400).json({ error: 'Название не может быть пустым' });
      entry.title = trimmed;
    }
    if (typeof req.body.volume === 'number') {
      entry.volume = Math.max(0, Math.min(1, req.body.volume));
    }
    if (typeof req.body.loop === 'boolean') {
      entry.loop = req.body.loop;
    }
    if (typeof req.body.category === 'string') {
      if (!CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: 'Недопустимая категория' });
      entry.category = req.body.category;
    }
    await writeIndex(list);
    res.json(entry);
  } catch (e) { serverError(res, e); }
});

router.delete('/api/audio/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const list = await readIndex();
    const idx = list.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Звук не найден' });

    const [entry] = list.splice(idx, 1);
    await fs.unlink(path.join(AUDIO_DIR, `${entry.id}.${entry.ext}`)).catch(() => {});
    await writeIndex(list);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

router.get('/api/audio/presets', async (req, res) => {
  try {
    const presets = await readPresets();
    const tracks  = await readIndex();
    const locs    = await getAllLocations(reqCity(req));
    const enriched = presets.map(p => {
      const loc = p.locationSlug ? locs.find(l => l.slug === p.locationSlug) : null;
      const resolvedTracks = p.tracks
        .map(pt => {
          const track = tracks.find(t => t.id === pt.trackId);
          if (!track) return null; // трек удалён из библиотеки — тихо пропускаем
          return { trackId: pt.trackId, volume: pt.volume, title: track.title, url: `/audio-lib/${track.id}.${track.ext}` };
        })
        .filter(Boolean);
      return {
        id: p.id, name: p.name, locationSlug: p.locationSlug || null,
        locationTitle: loc ? (loc.title || null) : null,
        locationImageUrl: loc ? (loc.imageUrl || null) : null,
        tracks: resolvedTracks, createdAt: p.createdAt,
      };
    });
    res.json(enriched);
  } catch (e) { serverError(res, e); }
});

function _cleanPresetTracks(rawTracks) {
  return (Array.isArray(rawTracks) ? rawTracks : [])
    .map(t => ({
      trackId: String(t?.trackId || ''),
      volume: Math.max(0, Math.min(1, typeof t?.volume === 'number' ? t.volume : 1)),
    }))
    .filter(t => t.trackId);
}

router.post('/api/audio/presets', async (req, res) => {
  try {
    const { name, locationSlug, tracks } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название пресета не может быть пустым' });
    const cleanTracks = _cleanPresetTracks(tracks);
    if (!cleanTracks.length) return res.status(400).json({ error: 'Пресет должен содержать хотя бы один звук' });

    const presets = await readPresets();
    const entry = {
      id: crypto.randomUUID(), name: name.trim(),
      locationSlug: locationSlug || null, tracks: cleanTracks,
      createdAt: new Date().toISOString(),
    };
    presets.push(entry);
    await writePresets(presets);
    res.json(entry);
  } catch (e) { serverError(res, e); }
});

router.put('/api/audio/presets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const presets = await readPresets();
    const entry = presets.find(p => p.id === id);
    if (!entry) return res.status(404).json({ error: 'Пресет не найден' });

    if (typeof req.body.name === 'string') {
      const trimmed = req.body.name.trim();
      if (!trimmed) return res.status(400).json({ error: 'Название пресета не может быть пустым' });
      entry.name = trimmed;
    }
    if ('locationSlug' in (req.body || {})) {
      entry.locationSlug = req.body.locationSlug || null;
    }
    if (req.body && req.body.tracks !== undefined) {
      const cleanTracks = _cleanPresetTracks(req.body.tracks);
      if (!cleanTracks.length) return res.status(400).json({ error: 'Пресет должен содержать хотя бы один звук' });
      entry.tracks = cleanTracks;
    }
    await writePresets(presets);
    res.json(entry);
  } catch (e) { serverError(res, e); }
});

router.delete('/api/audio/presets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const presets = await readPresets();
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Пресет не найден' });
    presets.splice(idx, 1);
    await writePresets(presets);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = { router, readIndex, writeIndex };
