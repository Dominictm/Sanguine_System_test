import { loadEnvFile } from 'node:process';

// Подгружаем .env из каталога приложения (apps/api), если он есть
try {
  loadEnvFile();
} catch {
  /* .env отсутствует — используем переменные окружения */
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
