# Indian SME Engine — Backend API

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)
![Jest](https://img.shields.io/badge/Tests-28%20passing-brightgreen?logo=jest&logoColor=white)
![Render](https://img.shields.io/badge/Deployed-Render-46E3B7?logo=render&logoColor=white)

A **multi-tenant CRM REST API** for Indian small businesses. One hosted instance serves multiple businesses — each fully isolated by `businessId`. Designed and built from scratch over 8 days.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  CLIENT (Browser)                    │
│           Netlify-hosted Vanilla JS SPA              │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────┐
│              EXPRESS REST API (Render)               │
│                                                      │
│  ┌──────────┐  ┌────────────┐  ┌─────────────────┐  │
│  │  Routes  │→ │Controllers │→ │    Services      │  │
│  └──────────┘  └────────────┘  └────────┬────────┘  │
│                                          │           │
│  ┌────────────────────────────┐          │           │
│  │  Auth Middleware (JWT)     │          │           │
│  └────────────────────────────┘          │           │
└──────────────────────────────────────────┼──────────┘
                                           │ Prisma ORM
                                           ▼
┌─────────────────────────────────────────────────────┐
│              PostgreSQL Database                     │
│   Business · User · Lead · Service · Testimonial    │
│   Appointment                                        │
└─────────────────────────────────────────────────────┘
```

**Multi-tenancy model:** Every resource (Lead, Service, Testimonial, Appointment) belongs to a `Business` via `businessId`. Users authenticate per-business. There is no cross-business data access.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20.x |
| Framework | Express | 5.x |
| ORM | Prisma | 6.x |
| Database | PostgreSQL | 16.x |
| Auth | JWT (jsonwebtoken) | 9.x |
| Validation | Zod | 4.x |
| Security | Helmet, CORS | latest |
| Rate Limiting | express-rate-limit | 8.x |
| Password Hashing | bcrypt | 6.x |
| Logging | Morgan | 1.x |
| Testing | Jest + Supertest | 29.x |
| Deployment | Render | — |

---

## Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma        ← data models + relations
│   ├── migrations/          ← migration history (committed)
│   └── seed.js              ← idempotent seed (upsert)
├── src/
│   ├── config/
│   │   └── env.js           ← centralised env validation
│   ├── controllers/         ← HTTP request/response layer
│   ├── services/            ← all Prisma DB queries
│   ├── routes/              ← Express router definitions
│   ├── middleware/
│   │   ├── auth.middleware.js    ← JWT verification
│   │   └── error.middleware.js  ← global error handler
│   ├── utils/
│   │   ├── jwt.js           ← sign / verify tokens
│   │   └── hash.js          ← bcrypt helpers
│   └── tests/               ← Jest + Supertest integration tests
├── .env.example             ← template for environment variables
├── render.yaml              ← Render deployment config
├── Dockerfile               ← Docker support
└── package.json
```

---

## API Reference

### Public Endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness check — returns `{ status: "ok" }` |
| `GET` | `/api/health/full` | Detailed check — uptime, timestamp, environment |
| `POST` | `/api/auth/login` | Login with email + password, returns JWT |
| `POST` | `/api/public/:businessSlug/leads` | Submit an enquiry from a public landing page |

### Authenticated Endpoints (JWT required)

Send `Authorization: Bearer <token>` on every request.

#### Identity
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/me` | Returns current user's `userId`, `businessId`, `role` |

#### Leads
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/leads` | Create a lead |
| `GET` | `/api/leads` | List leads (filter: `?status=NEW\|CONTACTED\|QUALIFIED\|WON\|LOST`) |
| `PATCH` | `/api/leads/:id/status` | Update lead status |
| `DELETE` | `/api/leads/:id` | Delete a lead |

#### Services
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/services` | Create a service offering |
| `GET` | `/api/services` | List services |
| `PATCH` | `/api/services/:id` | Update a service |
| `DELETE` | `/api/services/:id` | Delete a service |

#### Testimonials
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/testimonials` | Create a testimonial |
| `GET` | `/api/testimonials` | List testimonials |
| `DELETE` | `/api/testimonials/:id` | Delete a testimonial |

#### Appointments
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/appointments` | Schedule an appointment |
| `GET` | `/api/appointments` | List appointments |
| `PATCH` | `/api/appointments/:id/status` | Update appointment status |
| `DELETE` | `/api/appointments/:id` | Delete an appointment |

---

## Authentication

The API uses **JWT (JSON Web Tokens)**:

1. Client calls `POST /api/auth/login` with `{ email, password }`.
2. Server validates credentials against `bcrypt`-hashed password in the database.
3. On success, server returns a signed JWT containing `userId`, `businessId`, and `role`.
4. Client sends the token in every subsequent request: `Authorization: Bearer <token>`.
5. `auth.middleware.js` verifies the token on every protected route and attaches `req.user`.

Tokens expire after `JWT_EXPIRES_IN` (default `7d`). The `JWT_SECRET` is never exposed to the client.

---

## Data Models

```
Business ──< User          (1 business, many users)
Business ──< Lead          (1 business, many leads)
Business ──< Service       (1 business, many services)
Business ──< Testimonial   (1 business, many testimonials)
Business ──< Appointment   (1 business, many appointments)
```

All relations use `onDelete: Cascade` — deleting a business removes all its data.

---

## Local Development

```bash
# 1. Install dependencies
cd backend
npm install          # also runs prisma generate via postinstall

# 2. Create environment file
cp .env.example .env
# Edit DATABASE_URL and JWT_SECRET

# 3. Apply migrations
npx prisma migrate dev

# 4. Seed sample data (safe to run multiple times)
npx prisma db seed

# 5. Start dev server (hot-reload)
npm run dev
# → http://localhost:4000
```

---

## Running Tests

```bash
npm test
```

- **28 tests** across 7 test suites
- Each test creates its own isolated `Business` + `User` and deletes them on completion
- Safe to run against any local dev database — no shared state

---

## Deployment (Render)

The `render.yaml` at the project root declares the service. Key settings:

| Setting | Value |
|---------|-------|
| Runtime | Node |
| Build command | `npm install` (triggers `postinstall → prisma generate`) |
| Start command | `npm start` |
| Required env vars | `DATABASE_URL`, `JWT_SECRET` |

On each deploy, Render runs `npm install` → `prisma generate` (via postinstall hook) → `npm start`.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret key for signing JWTs |
| `JWT_EXPIRES_IN` | — | Token lifetime (default: `7d`) |
| `PORT` | — | Server port (default: `4000`) |
| `NODE_ENV` | — | `development` or `production` |

See `.env.example` for the full template.

---

## Security Measures

- **Helmet** — sets secure HTTP headers
- **CORS** — configurable origin control
- **Rate limiting** — 20 requests / 15 min on the public lead endpoint
- **Honeypot field** — rejects bot-submitted lead forms silently
- **Bcrypt** — passwords hashed with cost factor 10
- **JWT expiry** — tokens expire and cannot be refreshed without re-login
- **Zod validation** — all request bodies validated at the route layer
- **JSON body limit** — `10kb` cap prevents payload flooding
- **Cascade deletes** — Prisma enforces referential integrity at the DB level
