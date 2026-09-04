# Vuf — установка и запуск (VUF-19)

Руководство по развёртыванию проекта на локальной машине (Windows, PowerShell).

## Требования

- Node.js ≥ 20 (проверено на v22)
- npm ≥ 10
- Docker + Docker Compose (для локального MySQL)
- Git

## 1. Клонирование и зависимости

```powershell
git clone <repo-url> vuf
cd vuf
npm install
```

## 2. База данных (MySQL в Docker)

```powershell
docker compose -f infra/docker/docker-compose.yml up -d
```

Файл compose поднимает контейнер `vuf-mysql` (mysql:8.0), порт `3306`:
- БД: `vuf`
- пользователь: `vuf` / пароль `vuf`
- root-пароль: `root`
- том `vuf_mysql_data` для сохранения данных

Проверка готовности:

```powershell
docker inspect --format '{{.State.Health.Status}}' vuf-mysql   # -> healthy
```

> Примечание (Windows-разработка): бездоменную учётку `vuf` нельзя создать без
> `docker exec vuf-mysql mysql -uroot -proot -e "GRANT ALL PRIVILEGES ON *.* TO 'vuf'@'%' WITH GRANT OPTION; FLUSH PRIVILEGES;"`

## 3. Prisma: клиент и миграции

```powershell
npm run db:generate   # генерация Prisma Client
npm run db:migrate    # применение миграций
```

Схема: `infra/migrations/schema.prisma`. Миграции формируются в `infra/migrations/migrations/`.
Строка подключения берётся из `apps/api/.env` (см. `apps/api/.env.example`):

```
DATABASE_URL="mysql://vuf:vuf@localhost:3306/vuf"
PORT=4000
```

## 4. Сид-данные (опционально)

```powershell
npm run seed
```

Создаёт демо-пользователя, персонажа (Люсьен Вейл), две локации, сценарий «Шёпот в Элизиуме» и связи.

## 5. Запуск

Два терминала:

```powershell
npm run dev:api   # REST API на http://localhost:4000
npm run dev:web   # фронтенд Vite на http://localhost:5173
```

Проверка API:

```powershell
curl.exe http://localhost:4000/health
# {"status":"ok",...}
```

Web-фронтенд ходит в API через Vite-прокси (`/api` → `http://localhost:4000`), поэтому
CORS-настройки не требуются.

## Скрипты монорепозитория

| Команда | Действие |
| --- | --- |
| `dev:api` / `dev:web` | dev-серверы API и фронтенда |
| `build` | сборка всех пакетов |
| `typecheck` | проверка типов во всех пакетах |
| `db:generate` / `db:migrate` | Prisma client и миграции |
| `db:studio` | Prisma Studio (управление данными) |
| `seed` | наполнение демо-данными |

## Ключевые точки входа

- API: `apps/api/src/index.ts`, маршруты — `apps/api/src/routes/`
- Схема БД: `infra/migrations/schema.prisma`
- Общие типы: `packages/shared/src/index.ts`
- Web: страницы в `apps/web/src/pages/`, REST-клиент `apps/web/src/lib/api.ts`

## Известные ограничения

- Аутентификация/авторизация пока не реализованы (public-эндпоинты для каркаса).
- REST-обновление реализовано через `PUT` (частичная замена полей).
- Миграции через Docker требуют прав `vuf`-пользователя на создание shadow-database (см. п. 2).
