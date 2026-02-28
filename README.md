# Indian SME Engine

A multi-tenant CRM backend for Indian small businesses. Each business manages its own leads, services, and staff users from a single hosted instance.

## Day 1 Features

- **Auth** — JWT login per business (`POST /api/auth/login`, `GET /api/me`)
- **Leads CRUD** — Create, list, update status, delete (`/api/leads`)
- **Health check** — `GET /api/health`
- **Prisma + PostgreSQL** — schema, migrations, idempotent seed
- **Integration tests** — Jest + Supertest (10 tests, fully isolated)

## Project Structure

```
indian-sme-engine/
└── backend/                  ← the only Node.js project
    ├── prisma/
    │   ├── schema.prisma     ← data models
    │   ├── migrations/       ← applied migrations (commit these)
    │   └── seed.js           ← sample business + user
    ├── src/
    │   ├── routes/
    │   ├── controllers/
    │   ├── services/         ← all DB queries live here
    │   ├── middleware/
    │   ├── utils/
    │   └── tests/
    ├── .env                  ← secrets (not committed)
    ├── .nvmrc                ← Node 20.20.0
    └── package.json
```

## Prerequisites

- Node.js 20.20.0 via [nvm](https://github.com/nvm-sh/nvm)
- PostgreSQL running locally

## Setup

```bash
# 1. Switch to the pinned Node version
nvm install 20.20.0
nvm use 20.20.0

# 2. Install dependencies
cd backend
npm install

# 3. Create your .env file
cp .env.example .env
# Then edit DATABASE_URL and JWT_SECRET

# 4. Apply database migrations
npx prisma migrate dev

# 5. Seed sample data (idempotent — safe to run multiple times)
npx prisma db seed

# 6. Start the dev server
npm run dev
# → Server running on port 4000
```

## Running Tests

```bash
cd backend
npm test
```

Tests spin up their own isolated Business + User in the DB and delete them on completion. Safe to run against any local dev database.

## Environment Variables

| Variable | Example |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/sme_engine` |
| `PORT` | `4000` |
| `JWT_SECRET` | `change_this_in_production` |
| `JWT_EXPIRES_IN` | `7d` |

## API Overview

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | Health check |
| POST | `/api/auth/login` | — | Login, returns JWT |
| GET | `/api/me` | ✓ | Current user payload |
| POST | `/api/leads` | ✓ | Create a lead |
| GET | `/api/leads` | ✓ | List leads (optional `?status=`) |
| PATCH | `/api/leads/:id/status` | ✓ | Update lead status |
| DELETE | `/api/leads/:id` | ✓ | Delete a lead |
