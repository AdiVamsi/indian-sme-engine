# Indian SME Engine

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)
![WebSockets](https://img.shields.io/badge/WebSockets-Live-6366f1?logo=socket.io&logoColor=white)
![Jest](https://img.shields.io/badge/Tests-passing-brightgreen?logo=jest&logoColor=white)
![Render](https://img.shields.io/badge/Backend-Render-46E3B7?logo=render&logoColor=white)
![Netlify](https://img.shields.io/badge/Frontend-Netlify-00C7B7?logo=netlify&logoColor=white)

AI-powered CRM platform for Indian small businesses to capture, score, prioritize, and manage leads automatically.

---

## Live Demo

| Layer | URL |
|-------|-----|
| Frontend | **https://your-site.netlify.app** |
| Backend API | **https://your-backend.onrender.com** |
| Health check | **https://your-backend.onrender.com/api/health/full** |

> Replace the URLs above after deploying.

---

## Features

- **AI Lead Classification** — agent tags each incoming lead (e.g. `DEMO_REQUEST`, `URGENT`) based on configurable keyword rules
- **AI Lead Prioritization** — every lead receives a numeric priority score; configurable keyword weights + message-length bonus
- **Automation Engine** — rule-based automations trigger on tags and score thresholds (e.g. auto-schedule demo, flag high-value leads)
- **Multi-Tenant CRM Architecture** — one API instance serves unlimited businesses; every query is scoped by `businessId` from JWT
- **Lead Workflow Pipeline** — NEW → CONTACTED → QUALIFIED → WON / LOST with full status history
- **Activity Timeline** — every agent action, status change, and automation is logged as a `LeadActivity` row with metadata
- **Real-time Dashboard** — WebSocket push on every new lead; dashboard updates instantly without page reload
- **Public Lead Capture Forms** — rate-limited, honeypot-protected public endpoints per business slug

---

## System Architecture

```
Public Form → POST /api/public/:slug/leads
                │
                ▼
         Express API (JWT auth, Zod validation, rate limiting)
                │
                ├─► Prisma → PostgreSQL  (Lead + LeadActivity stored)
                │
                ├─► AgentEngine
                │     ├─ applyPolicy()    → classificationRules + priorityRules from AgentConfig
                │     ├─ LeadActivity     → AGENT_CLASSIFIED, AGENT_PRIORITIZED, FOLLOW_UP_SCHEDULED
                │     └─ runAutomations() → rule-based triggers, further LeadActivity rows
                │
                └─► WebSocket broadcast  → lead:new (priorityScore + tags included)
                                               │
                                               ▼
                                     Admin Dashboard (Vanilla JS)
                                     live row prepend + toast alert
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
| WebSockets (`ws`) | Real-time push to dashboard |
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
| Vanilla JS (ES6 modules) | Dashboard, realtime, agent config, lead timeline |
| WebSocket API | Live lead feed without page reload |
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
│   │   ├── schema.prisma        ← data models (Lead, LeadActivity, AgentConfig, …)
│   │   ├── migrations/          ← committed migration history
│   │   └── seed.js              ← idempotent seed
│   └── src/
│       ├── agents/              ← AgentEngine + basicPolicy + automations
│       ├── config/env.js        ← centralised env validation
│       ├── controllers/         ← HTTP layer
│       ├── services/            ← DB query layer
│       ├── routes/              ← Express routers
│       ├── realtime/socket.js   ← WebSocket server + broadcast()
│       ├── middleware/          ← JWT auth + error handler
│       └── utils/               ← jwt + hash helpers
│
├── dashboard/                   ← Admin SPA (Vanilla JS, ES modules)
│   ├── index.html               ← main dashboard (login + CRM tabs)
│   ├── agent.html               ← AI agent config editor
│   ├── lead-activity.html       ← per-lead activity timeline
│   ├── lead-priority.html       ← AI priority visualization
│   ├── style.css                ← shared design system
│   └── js/
│       ├── api.js               ← DashAPI factory (all fetch calls)
│       ├── ui.js                ← DashUI factory (all DOM rendering)
│       ├── realtime.js          ← WebSocket client + auto-reconnect
│       ├── dashboard.js         ← orchestration (login, tabs, realtime)
│       ├── agent.js             ← agent config page
│       ├── lead-activity.js     ← activity timeline page
│       └── lead-priority.js     ← priority cards page
│
└── frontend/                    ← Public landing page (no framework)
    ├── index.html
    ├── config.js                ← all content + API config
    ├── script.js                ← render + animations + form logic
    ├── style.css
    └── js/api.js
```

---

## How to Run Locally

```bash
# Backend
cd backend
cp .env.example .env        # fill in DATABASE_URL and JWT_SECRET
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev                 # → http://localhost:4000

# Dashboard (served by the backend at /dashboard)
# → http://localhost:4000/dashboard/

# Public form (served by the backend at /form)
# → http://localhost:4000/form/
```

Default seed credentials:
- **Slug:** `sharma-jee-academy-delhi`
- **Email:** `owner@sharmajeeacademy.in`
- **Password:** `Admin@12345`

---

## API Summary

```
GET  /api/health                              → liveness
GET  /api/health/full                         → uptime + environment
POST /api/admin/login                         → returns JWT
POST /api/public/:slug/leads                  → public lead capture (no auth)

GET  /api/admin/config                        → dashboard config (industry-aware) [auth]
GET  /api/admin/dashboard                     → stat counts                       [auth]
GET  /api/admin/leads                         → leads with priorityScore + tags   [auth]

GET  /api/leads/:id/activity                  → lead activity timeline            [auth]
PATCH /api/leads/:id/status                   → update lead status                [auth]
DELETE /api/leads/:id                         → delete lead                       [auth]

GET|PUT /api/agent                            → agent config (rules + timing)     [auth]

POST|GET|PATCH|DELETE  /api/appointments      → appointments                      [auth]
POST|GET|PATCH|DELETE  /api/services          → services                          [auth]
POST|GET|DELETE        /api/testimonials      → testimonials                      [auth]
```

---

## Tests

```bash
cd backend
npm test
```

All tests create isolated business data and clean up on completion — safe to run repeatedly against any dev database.

---

## Deployment

See [`backend/README.md`](backend/README.md) for the full Render deployment guide.
See [`frontend/README.md`](frontend/README.md) for the full Netlify deployment guide.
