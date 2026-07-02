'use strict';
// Роутер архива города: timeline, карта фракций, визитёры, слухи (d20).
// Сырые markdown-документы cities/<city>/archive/*, рендерятся на клиенте.
// Вынесено из server.js (E1.2).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError } = require('../lib/http');
const { archiveDir, reqCity, writeFileAtomic } = require('../lib/db');

const router = express.Router();

// Raw markdown archive docs — rendered client-side with the lore renderer.
const archiveDoc = file => async (req, res) => {
  try {
    const content = await fs.readFile(path.join(archiveDir(reqCity(req)), file), 'utf-8').catch(() => null);
    res.json({ exists: content !== null, content: content || '' });
  } catch (e) { serverError(res, e); }
};
router.get('/api/timeline', archiveDoc('timeline.md'));          // historical lore (B3)
router.get('/api/factions', archiveDoc('political_state.md'));   // C1 — faction map
router.get('/api/visitors', archiveDoc('visitors.md'));          // C3 — cross-city guests

// C2 — rumor tables (Elysium d20 / Dreaming d20)
router.get('/api/rumors', async (req, res) => {
  try {
    const which = req.query.type === 'dreaming' ? 'rumors_dreaming.md' : 'rumors_elysium.md';
    const content = await fs.readFile(path.join(archiveDir(reqCity(req)), which), 'utf-8').catch(() => null);
    res.json({ exists: content !== null, content: content || '', type: req.query.type === 'dreaming' ? 'dreaming' : 'elysium' });
  } catch (e) { serverError(res, e); }
});

// PUT — write archive docs back to disk
const _writeArchiveDoc = (file) => async (req, res) => {
  try {
    const city    = reqCity(req);
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const dir = archiveDir(city);
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, file), content, 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
};
router.put('/api/timeline', express.json(), _writeArchiveDoc('timeline.md'));
router.put('/api/factions', express.json(), _writeArchiveDoc('political_state.md'));
router.put('/api/visitors', express.json(), _writeArchiveDoc('visitors.md'));
router.put('/api/rumors', express.json(), async (req, res) => {
  try {
    const city    = reqCity(req);
    const type    = req.body?.type === 'dreaming' ? 'dreaming' : 'elysium';
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const file = type === 'dreaming' ? 'rumors_dreaming.md' : 'rumors_elysium.md';
    const dir  = archiveDir(city);
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, file), content, 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = { router };
