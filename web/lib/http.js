'use strict';
// Общая HTTP-инфраструктура для server.js и доменных роутеров (routes/*.js):
// цвета терминала, унифицированный 500-ответ, rate-limit для AI-эндпоинтов.
// Вынесено из server.js (E1.2).

// ── Terminal colors ────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  magenta:'\x1b[35m',
  gray:   '\x1b[90m',
};

// Unified 500 response. Always logs the full error (many per-route catches previously
// returned e.message to the client WITHOUT logging it), and returns a stable envelope
// instead of leaking internal messages/paths/stacks. Intentional user-facing errors
// stay as their own explicit res.status(...).json({error: '…'}) calls.
function serverError(res, e) {
  console.error(`${C.red}[error]${C.reset}`, e?.stack || e?.message || e);
  if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка сервера — подробности в логе сервера.' });
}

// ── Rate-limit для AI-генерации ───────────────────────────────────────────────
// Простой in-memory скользящий счётчик: 20 AI-вызовов в минуту с одного IP.
// Защищает бюджет провайдеров от случайного спама (двойные клики, зацикленный скрипт).
const AI_RATE_WINDOW = 60_000;
const AI_RATE_LIMIT  = 20;
const _aiCallLog = new Map(); // ip -> [timestamps]
function aiRateLimit(req, res, next) {
  const ip = req.ip || 'local';
  const now = Date.now();
  const log = (_aiCallLog.get(ip) || []).filter(t => now - t < AI_RATE_WINDOW);
  if (log.length >= AI_RATE_LIMIT) {
    return res.status(429).json({ ok: false, error: 'Слишком много запросов к AI. Подождите минуту.' });
  }
  log.push(now);
  _aiCallLog.set(ip, log);
  next();
}
setInterval(() => {
  const cutoff = Date.now() - AI_RATE_WINDOW * 2;
  for (const [ip, log] of _aiCallLog) {
    const fresh = log.filter(t => t > cutoff);
    if (fresh.length === 0) _aiCallLog.delete(ip);
    else _aiCallLog.set(ip, fresh);
  }
}, 300_000).unref();

module.exports = { C, serverError, aiRateLimit };
