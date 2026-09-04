import { createApp } from './app.js';
import { env } from './env.js';
import { prisma } from './db.js';

async function main() {
  const app = createApp();

  try {
    await prisma.$connect();
    console.log('[vuf-api] Подключение к БД установлено');
  } catch (err) {
    console.error('[vuf-api] Не удалось подключиться к БД:', err);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`[vuf-api] REST API запущен: http://localhost:${env.port}`);
    console.log(`[vuf-api] Health: http://localhost:${env.port}/health`);
    console.log(`[vuf-api] Characters: http://localhost:${env.port}/api/v1/characters`);
  });

  const shutdown = async () => {
    console.log('[vuf-api] Остановка...');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
