# Windows 11 — Local Setup (Phase 1)

Goal: run PostgreSQL locally, validate the Prisma schema, create the first
migration, and generate Prisma Client. No application code exists yet (Phase 2+).

## Option A — Docker Desktop (recommended)

### Prerequisites
- Windows 11 with WSL 2 enabled
- Docker Desktop for Windows (WSL 2 backend)
- Node.js LTS 20+ (`node -v` should print v20 or higher)
- Git for Windows

### Steps (PowerShell, inside the repo folder)

```powershell
# 1. Environment file (local values only — never commit .env)
Copy-Item .env.example .env

# 2. Start PostgreSQL 16 (host port 5433, see docker-compose.yml)
docker compose up -d db
docker compose ps          # wait until the db service is "healthy"

# 3. Install dependencies (Prisma)
npm install

# 4. Validate + generate
npx prisma format
npx prisma validate
npx prisma generate

# 5. Create and apply the first migration
npx prisma migrate dev --name init

# 6. Check status / inspect data (optional)
npx prisma migrate status
npx prisma studio
```

`DATABASE_URL` in `.env.example` already matches the Docker defaults:
user `school`, database `school_saas`, host port `5433`.

## Option B — Native PostgreSQL on Windows (no Docker)

1. Install PostgreSQL 16 from postgresql.org (Windows x86-64 installer).
   Remember the `postgres` superuser password you set during install.
2. Open **SQL Shell (psql)** as `postgres` and run:

```sql
CREATE USER school WITH PASSWORD 'school_dev_password';
CREATE DATABASE school_saas OWNER school;
```

3. Copy `.env.example` to `.env`. If you kept the default Postgres port,
   change `5433` in `DATABASE_URL` to `5432`.
4. Then run steps 3–6 from Option A (`npm install`, `prisma validate`,
   `prisma generate`, `prisma migrate dev --name init`).

## Required environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | Prisma | Full Postgres connection string. Local dev value is in `.env.example`. Treat the production value as a secret. |
| `POSTGRES_USER` | docker-compose only | Default `school` |
| `POSTGRES_PASSWORD` | docker-compose only | Local dev only — change for any shared/production use |
| `POSTGRES_DB` | docker-compose only | Default `school_saas` |
| `POSTGRES_PORT` | docker-compose only | Host port, default `5433` (avoids clashing with a native install on 5432) |

No other environment variables are needed in Phase 1. WhatsApp/push/provider
keys arrive in Phase 4 and must never be committed.

## One-command helper

`scripts\setup-windows.ps1` runs the Docker path end-to-end and stops on the
first failure:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

## Troubleshooting

- **Port 5433 already in use:** change `POSTGRES_PORT` in `.env` AND the port
  inside `DATABASE_URL` to the same new value, then `docker compose up -d db`.
- **`prisma migrate dev` cannot connect:** check `docker compose ps` shows the
  db as healthy, and that `.env` exists in the repo root.
- **Docker not starting:** confirm WSL 2 is enabled and Docker Desktop shows
  "Engine running".
