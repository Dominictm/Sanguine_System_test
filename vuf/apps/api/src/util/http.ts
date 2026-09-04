import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message = 'Ресурс не найден') =>
  new HttpError(404, 'NOT_FOUND', message);

// Обёртка async-роута: пробрасывает ошибки в error middleware
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

export function parsePagination(query: Record<string, unknown>) {
  const page = Number(query.page) || 1;
  const pageSize = Number(query.pageSize) || 25;
  return { page, pageSize };
}

// Централизованная обработка ошибок
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Некорректные данные запроса',
        details: err.flatten(),
      },
    });
  }

  // Prisma: запись с таким уникальным ключом уже существует
  const code = (err as { code?: string })?.code;
  if (code === 'P2002') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Запись с таким ключом уже существует' },
    });
  }
  if (code === 'P2025') {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Ресурс не найден' },
    });
  }

  console.error(err);
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' },
  });
}
