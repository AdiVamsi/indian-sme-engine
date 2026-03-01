# Indian SME Engine

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)
![Jest](https://img.shields.io/badge/Tests-28%20passing-brightgreen?logo=jest&logoColor=white)
![Render](https://img.shields.io/badge/Backend-Render-46E3B7?logo=render&logoColor=white)
![Netlify](https://img.shields.io/badge/Frontend-Netlify-00C7B7?logo=netlify&logoColor=white)

A **full-stack, multi-tenant CRM platform** for Indian small businesses — built from scratch in 8 days. A live public landing page captures student enquiries and feeds them directly into a secured backend API with a full lead management system.

---

## Live Demo

| Layer | URL |
|-------|-----|
| Frontend | **https://your-site.netlify.app** |
| Backend API | **https://your-backend.onrender.com** |
| Health check | **https://your-backend.onrender.com/api/health/full** |

> Replace the URLs above after deploying.

---

## What Was Built

This is a real, production-deployed system — not a tutorial clone.

- **Multi-tenant architecture** — one API serves multiple businesses, each fully isolated
- **Public lead capture** — a live landing page sends enquiries to the backend database
- **Full CRM backend** — leads, services, testimonials, and appointments, all behind JWT auth
- **28 integration tests** — Jest + Supertest, isolated per-business, all passing
- **Production hardened** — rate limiting, honeypot, Helmet, input validation, graceful shutdown
- **Deployed end-to-end** — Render (backend) + Netlify (frontend) + Render PostgreSQL (database)

---

## System Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        STUDENT / USER                         │
└────────────────────────┬──────────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │   NETLIFY (CDN)     │  index.html + style.css
              │   Vanilla JS SPA    │  config.js · js/api.js · script.js
              └──────────┬──────────┘
                         │ HTTPS POST /api/public/:slug/leads
                         │
              ┌──────────▼──────────────────────┐
              │   RENDER — Express REST API      │
              │                                  │
              │  Auth middleware (JWT)           │
              │  Route → Controller → Service    │
              │  Zod validation · Rate limiter   │
              │  Helmet · Morgan · Error handler │
              └──────────┬──────────────────────┘
                         │ Prisma ORM
                         │
              ┌──────────▼──────────────────────┐
              │   RENDER — PostgreSQL 16         │
              │                                  │
              │  Business · User · Lead          │
              │  Service · Testimonial           │
              │  Appointment                     │
              └──────────────────────────────────┘
```

---

## Tech Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| Node.js 20 | Runtime |
| Express 5 | HTTP framework |
| Prisma 6 | ORM + migrations |
| PostgreSQL 16 | Relational database |
| JWT | Stateless authentication |
| Zod | Request body validation |
| Bcrypt | Password hashing |
| Helmet | Secure HTTP headers |
| express-rate-limit | Abuse prevention |
| Morgan | HTTP request logging |
| Jest + Supertest | Integration testing |

### Frontend
| Technology | Purpose |
|-----------|---------|
| HTML5 | Semantic structure |
| CSS3 | Design system (custom properties, BEM, responsive) |
| Vanilla JS (ES6) | Dynamic rendering, animations, form logic |
| IntersectionObserver | Scroll animations + counter trigger |
| Fetch API | Backend communication |

### Deployment
| Service | What runs there |
|---------|----------------|
| Render | Express API + PostgreSQL database |
| Netlify | Static frontend (HTML/CSS/JS) |

---

## Repository Structure

```
indian-sme-engine/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma        ← 5 models, 3 enums
│   │   ├── migrations/          ← committed migration history
│   │   └── seed.js              ← idempotent seed
│   ├── src/
│   │   ├── config/env.js        ← centralised env validation
│   │   ├── controllers/         ← HTTP layer
│   │   ├── services/            ← DB query layer
│   │   ├── routes/              ← Express routers
│   │   ├── middleware/          ← JWT auth + error handler
│   │   ├── utils/               ← jwt + hash helpers
│   │   └── tests/               ← 28 integration tests
│   ├── .env.example             ← env var template
│   ├── render.yaml              ← Render deploy config
│   └── Dockerfile               ← Docker support
│
└── frontend/
    ├── index.html               ← zero-content shell
    ├── config.js                ← all content + API config
    ├── script.js                ← render + animation + form logic
    ├── style.css                ← full design system
    └── js/
        └── api.js               ← backend communication layer
```

---

## Quick Start (Local)

```bash
# Backend
cd backend
cp .env.example .env        # fill in DATABASE_URL and JWT_SECRET
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev                 # → http://localhost:4000

# Frontend (separate terminal)
cd frontend
npx serve .                 # → http://localhost:3000
```

Update `frontend/config.js` → `baseUrl: 'http://localhost:4000'` for local testing.

---

## API Summary

```
GET  /api/health                              → liveness
GET  /api/health/full                         → uptime + environment
POST /api/auth/login                          → returns JWT
POST /api/public/:slug/leads                  → public lead capture (no auth)

GET  /api/me                                  → current user  [auth]
POST|GET|PATCH|DELETE  /api/leads             → lead CRM      [auth]
POST|GET|PATCH|DELETE  /api/services          → services      [auth]
POST|GET|DELETE        /api/testimonials      → testimonials  [auth]
POST|GET|PATCH|DELETE  /api/appointments      → appointments  [auth]
```

---

## Tests

```bash
cd backend
npm test
# 28 tests · 7 suites · ~3s
```

All tests create isolated business data and clean up on completion — safe to run repeatedly against any dev database.

---

## Deployment

See [`backend/README.md`](backend/README.md) for the full Render deployment guide.
See [`frontend/README.md`](frontend/README.md) for the full Netlify deployment guide.
