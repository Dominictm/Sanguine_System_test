'use strict';
// Роутер модулей (module-level): список/детали, создание, AI-генерация сценария,
// сессии (Фаза B), правка полей/сценария, добавление НПС, delete-preview/delete,
// закрытие модуля (Фаза C, AI), локации-подресурс, листы эпизодических НПС и их
// продвижение в каноничные персонажи.
// Хроника-уровневый слой (список хроник, delete, recap, /api/chronicle, state) —
// routes/chronicles.js.
// Фабрика с DI: AI-хелперы (makeGenerationClient, isOA, oaCall) приходят из
// server.js при монтировании — сам AI-слой пока живёт там (E1.2). Лист V20 для
// эпизодических НПС переиспользует character-sheet генерацию сервера
// (generateV20Sheet, ensureSheetLink) — тоже через DI, т.к. она общая с
// /api/characters/:slug/sheet* и её отдельная миграция не входит в этот срез.
//
// Разбит 2026-07-09 из monolithic modules.js (2543 строки, 30 роутов в одном
// файле) на домены — см. docs/audit/2026-07-09-project-improvement-plan.md,
// P0.2. Общие хелперы (парсинг сценария/сессий/npc.md и т.п.) — ./shared.js.
// Каждый домен — свой Express-роутер, здесь только их монтирование.

const express = require('express');

module.exports = function modulesRouter(deps) {
  const router = express.Router();

  router.use(require('./list')());
  router.use(require('./fill')(deps));
  router.use(require('./scenario')(deps));
  router.use(require('./sessions')());
  router.use(require('./fields')());
  router.use(require('./npc')(deps));
  router.use(require('./lifecycle')(deps));
  router.use(require('./locations')());

  return router;
};
