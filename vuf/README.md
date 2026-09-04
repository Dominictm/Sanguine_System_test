# Vuf

Greenfield система для ведения хронико-масштабных настольных RPG-кампаний (миры Vampire: The Masquerade V20 и подобные). Включает управление персонажами, локациями и сценариями.

Стек: **React + Vite** (web), **Node.js + Express + Prisma** (API), **MySQL 8** (БД), **npm workspaces** (монорепозиторий).

## Структура

```
vuf/
├─ apps/
│  ├─ api/            # Express REST API (ЭСМ, /api/v1)
│  └─ web/            # React + Vite фронтенд (порт 5173)
├─ packages/
│  └─ shared/         # общие типы, DTO, утилиты
├─ infra/
│  ├─ docker/         # docker-compose (MySQL 8)
│  └─ migrations/     # Prisma-схема и миграции
└─ docs/              # документация
```

## Быстрый старт

Предусловия: Node ≥ 20, Docker с Docker Compose.

```bash
# 1. база данных (MySQL в Docker)
docker compose -f infra/docker/docker-compose.yml up -d

# 2. зависимости
npm install

# 3. prisma client + миграции
npm run db:generate
npm run db:migrate

# 4. сид-данные (опционально)
npm run seed

# 5. запуск (два терминала)
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:5173
```

Проверка API: `GET http://localhost:4000/health`.

См. также `docs/setup.md`.

## Скрипты (корень)

| Команда | Описание |
| --- | --- |
| `dev:api` | запуск API в dev-режиме (tsx watch, порт 4000) |
| `dev:web` | запуск web в dev-режиме (Vite, порт 5173) |
| `build` | сборка всех пакетов |
| `typecheck` | проверка типов во всех пакетах |
| `db:generate` | генерация Prisma Client |
| `db:migrate` | применение миграций (create/migrate) |
| `seed` | наполнение БД демо-данными |

## REST API (v1)

- `GET    /api/v1/characters` — список (пагинация, фильтры `clan`, `status`, `search`)
- `POST   /api/v1/characters` — создать персонажа
- `GET    /api/v1/characters/:id`
- `PUT    /api/v1/characters/:id` — обновить
- `DELETE /api/v1/characters/:id`
- Аналогичные ресурсы: `locations`, `scenarios`
- `GET /api/v1/scenarios/:id/characters`, `/locations` — связи сценария
- `PUT /api/v1/scenarios/:id/characters`, `/locations` — переопределить связи

## Дорожные заметки

- Тематика домена соответствует VtM V20: кланы, атрибуты/способности/добродетели/дисциплины (JSON), поколение 1–16, человечность 0–10.
- Репозиторий не содержит продакшен-секретов; переменные окружения — в `.env` (в gitignore).
