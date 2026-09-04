import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { charactersRouter } from './routes/characters.js';
import { locationsRouter } from './routes/locations.js';
import { scenariosRouter } from './routes/scenarios.js';
import { errorHandler } from './util/http.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vuf-api', time: new Date().toISOString() });
  });

  app.use('/api/v1/characters', charactersRouter);
  app.use('/api/v1/locations', locationsRouter);
  app.use('/api/v1/scenarios', scenariosRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Маршрут не найден' } });
  });

  app.use(errorHandler);

  return app;
}
