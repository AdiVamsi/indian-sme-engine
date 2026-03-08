# Indian SME Engine

A multi-tenant CRM platform with a deterministic AI agent engine, built specifically for small businesses in India — coaching centers, gyms, salons, clinics, restaurants, and retail stores.

The platform captures incoming leads, classifies and scores them automatically, triggers configurable automations, and surfaces the right follow-up actions to the business owner through a real-time dashboard.

---

## The Problem

Indian small business owners receive enquiries across multiple channels simultaneously — website forms, WhatsApp, walk-ins, phone calls — with no system to prioritise them.

Most leads are either forgotten or followed up too late. The business with the fastest, most informed response wins the customer.

This platform gives small businesses a structured, automated layer between an incoming enquiry and the owner's first call.

---

## What the Platform Does

1. Accepts leads from a public form endpoint (no authentication required)
2. Runs each lead through a deterministic classification engine
3. Assigns a numeric priority score based on keyword weights and message signals
4. Fires configurable automation rules (follow-up scheduling, intent alerts, SLA alerts)
5. Logs every system decision as an auditable `LeadActivity` row
6. Broadcasts updates over WebSocket to the business dashboard in real time
7. Surfaces Next Best Action suggestions and AI-drafted outreach messages to the owner

Every action the system takes is traceable. There are no black-box decisions.

---

## Core Features

### Lead Management
- Public lead capture endpoint per business slug (rate-limited, honeypot-protected)
- Lead status workflow: `NEW → CONTACTED → QUALIFIED → WON / LOST`
- Per-lead activity timeline showing the full event history

### Agent Engine (Deterministic AI)
- Rule-based lead classification — assigns keyword tags like `DEMO_REQUEST`, `ADMISSION`, `URGENCY_SIGNAL`
- Keyword weight scoring — each matched keyword contributes to a numeric priority score
- Configurable per-business policies (`AgentConfig`) stored in the database
- Default policy created automatically on first lead if no config exists

### Automation Engine
- Triggers fire on tag matches and score thresholds
- Supported automation types: `AUTOMATION_DEMO_INTENT`, `AUTOMATION_ADMISSION_INTENT`, `FOLLOW_UP_SCHEDULED`, `SLA_ALERT`
- All automation events logged to the activity timeline

### Multi-Tenant Architecture
- Every database query is scoped to `businessId` extracted from the JWT
- Business identity never comes from the request body
- One API instance serves all tenants with zero data leakage between them

### Real-Time Dashboard (Business Owner)
- WebSocket push on every new lead
- Live lead feed with priority score, tags, and status
- Lead activity timeline per lead
- AI-generated outreach drafts and Next Best Action suggestions
- Agent configuration editor

### Admin Control Center (Platform Owner)
- Cross-tenant view of all businesses, leads, and automation activity
- Business lifecycle stage tracking and manual stage update
- Platform analytics: stage distribution, growth metrics, lead conversion signals
- Suggested stage upgrades based on lead volume and automation event thresholds

### Business Lifecycle Tracking
The platform tracks where each business is in its adoption journey:

| Stage | Description |
|---|---|
| `STARTING` | Signed up, no website yet |
| `WEBSITE_DESIGN` | Website in progress |
| `WEBSITE_LIVE` | Website launched |
| `LEADS_ACTIVE` | Receiving and managing leads |
| `AUTOMATION_ACTIVE` | Automation engine running |
| `SCALING` | High-volume lead operations |

Stage can be updated manually by the platform owner or triggered by the Suggested Stage system.

---

## Lead Processing Pipeline

```
Incoming enquiry (website form, simulation, etc.)
        │
        ▼
POST /api/public/:slug/leads
        │
        ▼
Zod validation + honeypot check + rate limit
        │
        ▼
findBusinessBySlug → resolve tenant
        │
        ▼
createLead → Lead row in PostgreSQL
        │
        ▼
AgentEngine.run(lead, agentConfig)
        │
        ├─► classify(lead)
        │     └─ match classificationRules → tags[]
        │     └─ LeadActivity: AGENT_CLASSIFIED
        │
        ├─► score(lead, tags)
        │     └─ keyword weight sum + message-length bonus
        │     └─ Lead.priorityScore updated
        │     └─ LeadActivity: AGENT_PRIORITIZED
        │
        └─► runAutomations(lead, tags, score)
              └─ evaluate automation rules
              └─ LeadActivity: FOLLOW_UP_SCHEDULED, SLA_ALERT, AUTOMATION_*
        │
        ▼
WebSocket broadcast → lead:new event
        │
        ▼
Business dashboard updates in real time
```

---

## Agent Engine Design

The intelligence layer is **not LLM-based**. It is a deterministic, rule-driven system.

### Why not an LLM?

Small businesses need a system that is:
- **Fast** — decisions complete in milliseconds
- **Cheap** — no per-request token cost
- **Predictable** — the same input always produces the same output
- **Auditable** — every decision is traceable to a specific rule

### How classification works

Each `AgentConfig` stores a set of `classificationRules` — objects mapping keywords to tags:

```json
{
  "classificationRules": [
    { "keyword": "demo",      "tag": "DEMO_REQUEST" },
    { "keyword": "urgent",    "tag": "URGENCY_SIGNAL" },
    { "keyword": "admission", "tag": "ADMISSION" }
  ]
}
```

The engine scans the lead's name and message against these rules. Matched tags are stored in the `LeadActivity` metadata for full traceability.

### How priority scoring works

Each `AgentConfig` stores `priorityRules` — keyword-to-weight mappings:

```json
{
  "priorityRules": [
    { "keyword": "urgent",      "weight": 30 },
    { "keyword": "demo",        "weight": 20 },
    { "keyword": "immediately", "weight": 25 }
  ]
}
```

Weights are summed across all matches. A message-length bonus applies for longer, more detailed enquiries. The resulting score is stored on the `Lead` row.

---

## Architecture

```
indian-sme-engine/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          ← data models
│   │   ├── migrations/            ← migration history
│   │   ├── seed.js                ← idempotent demo data seed
│   └── src/
│       ├── agents/
│       │   ├── engine.js          ← AgentEngine orchestrator
│       │   ├── index.js           ← entry point
│       │   ├── leadSuggestions.js ← Next Best Action logic
│       │   ├── outreachDrafts.js  ← AI-drafted message generator
│       │   └── policies/
│       │       └── basicPolicy.js ← default classification + priority rules
│       ├── app.js                 ← Express app + route mounting
│       ├── server.js              ← HTTP + WebSocket server init
│       ├── config/                ← env validation
│       ├── constants/             ← industry config (labels, themes, stat cards)
│       ├── controllers/           ← HTTP handlers
│       ├── middleware/            ← JWT auth, superadmin auth, error handler
│       ├── realtime/socket.js     ← WebSocket server + broadcast()
│       ├── routes/                ← Express routers
│       ├── services/              ← database query layer
│       ├── tests/                 ← Jest + Supertest integration tests
│       └── utils/                 ← JWT helpers, hash helpers
│
├── scripts/
│   └── simulateLeads.js           ← lead simulation engine (see below)
│
├── dashboard/                     ← Business owner SPA (Vanilla JS)
│   ├── index.html                 ← CRM dashboard (login, lead feed, tabs)
│   ├── agent.html                 ← Agent config editor
│   ├── lead-activity.html         ← Per-lead activity timeline
│   ├── lead-priority.html         ← Priority visualisation
│   ├── style.css
│   └── js/
│       ├── api.js                 ← DashAPI factory (all fetch calls)
│       ├── ui.js                  ← DashUI factory (all DOM rendering)
│       ├── realtime.js            ← WebSocket client + auto-reconnect
│       ├── dashboard.js           ← Orchestration: wires api + ui + realtime
│       ├── agent.js               ← Agent config page logic
│       ├── lead-activity.js       ← Activity timeline page logic
│       └── lead-priority.js       ← Priority cards page logic
│
├── admin/                         ← Platform owner control center (Vanilla JS)
│   ├── index.html
│   ├── style.css
│   └── js/
│       ├── config.js              ← Base URL config
│       ├── admin-api.js           ← AdminAPI factory
│       └── admin.js               ← All admin UI logic
│
└── frontend/                      ← Public landing page (static, no framework)
    ├── index.html
    ├── style.css
    ├── script.js
    └── js/api.js
```

---

## Tech Stack

### Backend
| Technology | Role |
|---|---|
| Node.js 20 | Runtime |
| Express 5 | HTTP framework |
| Prisma 6 | ORM + migrations |
| PostgreSQL | Relational database |
| `ws` | WebSocket server |
| JWT | Stateless multi-tenant authentication |
| Zod | Request body validation |
| Bcrypt | Password hashing |
| Helmet | Secure HTTP headers |
| express-rate-limit | Rate limiting on public endpoints |
| Morgan | HTTP request logging |

### Frontend
| Technology | Role |
|---|---|
| HTML5 + CSS3 | Structure and design system |
| Vanilla JavaScript (ES6) | Dashboard logic, no framework |
| WebSocket API | Real-time lead feed |
| Fetch API | All backend communication |

### Testing
| Technology | Role |
|---|---|
| Jest | Test runner |
| Supertest | HTTP integration testing |

---

## Multi-Tenant Design

Each registered business has a unique `slug`. The JWT issued on login carries `businessId` and `userId`.

**All tenant-scoped queries extract `businessId` from the JWT — never from the request body or URL params.**

This means:
- A business owner cannot query another tenant's data even if they know the ID
- No additional row-level security configuration is required at the database layer
- The pattern is enforced consistently in every service function

The SuperAdmin role is separate from tenant auth. It uses a different signing secret (`SUPERADMIN_SECRET`) and a different middleware chain. SuperAdmin routes are prefixed `/api/superadmin` and have no overlap with tenant routes.

---

## API Reference

### Public (no authentication)

```
POST   /api/public/:slug/leads
```

Accepts a lead from a website form. Does not require authentication. Rate-limited to 20 requests per 15 minutes per IP.

Request body:
```json
{
  "name":    "Rahul Sharma",
  "phone":   "+91 98765 43210",
  "email":   "rahul@example.com",
  "message": "I want a demo session urgently"
}
```

Response: `201 { "ok": true }`

---

### Business Auth

```
POST   /api/auth/login
```

Body: `{ "businessSlug", "email", "password" }` → returns `{ "token" }`

---

### Business Dashboard (requires Bearer JWT)

```
GET    /api/admin/config              ← dashboard config (industry-aware)
GET    /api/admin/dashboard           ← stat counts
GET    /api/admin/leads               ← leads with priorityScore, tags, status
GET    /api/leads/:id/activity        ← full activity timeline for a lead
PATCH  /api/leads/:id/status          ← update lead status
DELETE /api/leads/:id                 ← delete lead
GET    /api/leads/:id/suggestions     ← Next Best Action suggestions
GET    /api/leads/:id/outreach        ← AI-drafted outreach messages
GET|PUT /api/agent                    ← read/update AgentConfig
```

---

### SuperAdmin (requires SuperAdmin JWT)

```
POST   /api/superadmin/login
GET    /api/superadmin/overview              ← platform-wide stat counts
GET    /api/superadmin/businesses            ← all businesses with stage, leadCount
GET    /api/superadmin/leads                 ← cross-tenant lead explorer
GET    /api/superadmin/logs                  ← automation event feed
GET    /api/superadmin/analytics             ← lifecycle distribution, growth metrics, lead signals
PATCH  /api/superadmin/businesses/:id/stage  ← update business lifecycle stage
```

`PATCH /api/superadmin/businesses/:id/stage` body:
```json
{ "stage": "LEADS_ACTIVE" }
```

Valid stage values: `STARTING`, `WEBSITE_DESIGN`, `WEBSITE_LIVE`, `LEADS_ACTIVE`, `AUTOMATION_ACTIVE`, `SCALING`

---

## Local Development Setup

### Prerequisites
- Node.js 20+
- PostgreSQL (local instance or Docker)

### Backend

```bash
cd backend
cp .env.example .env
# Set DATABASE_URL and JWT_SECRET in .env
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev
```

The API starts at `http://localhost:4000`.

### Access the dashboards

Both dashboards are served as static files by the Express backend:

| Interface | URL |
|---|---|
| Business dashboard | http://localhost:4000/dashboard |
| Admin control center | http://localhost:4000/admin |
| Public lead form | served from `frontend/` |

### Default seed credentials

| Field | Value |
|---|---|
| Business slug | `sharma-jee-academy-delhi` |
| Email | `owner@sharmajeeacademy.in` |
| Password | `Admin@12345` |

SuperAdmin password is set via the `SUPERADMIN_PASSWORD` environment variable.

---

## Lead Simulation Engine

`backend/scripts/simulateLeads.js` generates realistic Indian leads and submits them through the real public API — it does not write directly to the database.

It is used to simulate live traffic and demonstrate the platform with a working, moving data feed.

Configuration (top of file):

```js
const BASE_URL         = 'http://localhost:4000';
const LEADS_PER_MINUTE = 5;      // controls interval in normal mode
const BURST_MODE       = false;  // true → fires 20 leads rapidly then exits
const ANALYSE_AFTER    = true;   // log agent tags + score after each lead
```

Run it:
```bash
# In one terminal: start the backend
npm run dev

# In another terminal: start the simulator
npm run simulate
```

Sample output:
```
[SIM] Loaded 12 businesses.
[SIM] slug=sunrise-dance-academy  name="Priya Sharma"  msg="I want a demo session urgently"
    [SIM] → HTTP 201
    [SIM][AI] tags=[DEMO_REQUEST, URGENCY_SIGNAL]  score=50  automations=AUTOMATION_DEMO_INTENT
    [SIM] next lead in 9.4s
```

`Ctrl+C` shuts down gracefully with Prisma disconnect.

---

## Tests

```bash
cd backend
npm test
```

Tests create isolated business contexts and clean up after themselves. Safe to run repeatedly against a development database.

Test coverage includes:
- Lead creation triggers correct LeadActivity rows
- Classification tags are applied from message keywords
- No cross-tenant data leakage between businesses
- Default `AgentConfig` is created when none exists

---

## Current Status

The platform is **fully functional locally**. It is not deployed.

| Metric | Value |
|---|---|
| Businesses in demo DB | ~12 |
| Leads | ~300+ |
| AI events (LeadActivity rows) | ~1,000+ |
| Deployment status | Local only |
| Dashboard URLs | `localhost:4000/dashboard` and `localhost:4000/admin` |

Live simulation via `npm run simulate` generates continuous lead traffic through the real API, triggering the full classification, scoring, and automation pipeline on every submission.

---

## Roadmap

- [ ] WhatsApp integration (inbound lead capture via WhatsApp webhook)
- [ ] Scheduled follow-up delivery (actual message sending, not just scheduling)
- [ ] Multi-user support within a business (OWNER + STAFF roles active)
- [ ] Public deployment (hosting TBD)
- [ ] Onboarding flow for new business registration
- [ ] Mobile-responsive dashboard
- [ ] Export leads to CSV
