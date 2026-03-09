# Indian SME Engine

A multi-tenant CRM platform with a rule-based agent engine, built specifically for small businesses in India — coaching centers, gyms, salons, clinics, restaurants, and retail stores.

The platform captures incoming leads, classifies and scores them automatically, triggers configurable automations, and surfaces the right follow-up actions to the business owner through a real-time dashboard.

---

## The Problem

Indian small business owners receive enquiries across multiple channels simultaneously — website forms, WhatsApp, walk-ins, phone calls — with no system to prioritise them.

Most leads are either forgotten or followed up too late. The business with the fastest, most informed response wins the customer.

This platform gives small businesses a structured, automated layer between an incoming enquiry and the owner's first call.

---

## What the Platform Does

1. Accepts leads from multiple entry points — public form submissions, direct API calls, and internal simulation
2. Runs each lead through a hybrid classification engine (rule-first, optional model fallback)
3. Assigns a numeric priority score based on keyword weights and message signals
4. Fires configurable automation rules (follow-up scheduling, intent alerts, high-priority alerts)
5. Logs every classification, score, and automation decision as a `LeadActivity` row, making each decision traceable to the rule or threshold that produced it
6. Broadcasts updates over WebSocket to the business dashboard in real time
7. Surfaces Next Best Action suggestions and outreach drafts to the owner

---

## Core Features

### Lead Management
- Public lead capture endpoint per business slug (rate-limited, honeypot-protected)
- Lead status workflow: `NEW → CONTACTED → QUALIFIED → WON / LOST`
- Per-lead activity timeline showing the full event history

### Agent Engine
- Hybrid intent classifier — rule-first keyword scoring, optional model fallback for low-confidence or ambiguous leads
- Keyword weight scoring — each matched keyword contributes to a numeric priority score
- Classification result includes `tags[]`, `bestCategory`, `confidenceLabel`, `confidenceScore`, and `via` (`rule` / `model` / `fallback`)
- Per-business `AgentConfig` stored in the database — industry-specific presets applied on first activation
- All classification and scoring decisions recorded as `LeadActivity` rows

### Automation Engine
- Triggers fire on tag matches and score thresholds
- Supported types: `AUTOMATION_ALERT` (high priority), `AUTOMATION_DEMO_INTENT`, `AUTOMATION_ADMISSION_INTENT`
- All automation events logged to the activity timeline

### Multi-Tenant Architecture
- Every database query is scoped to `businessId` extracted from the JWT
- Business identity never comes from the request body
- One API instance serves all tenants with zero data leakage between them

### Real-Time Dashboard (Business Owner)
- WebSocket push on every new lead
- Live lead feed with priority score, tags, and status
- Lead activity timeline per lead
- Outreach drafts and Next Best Action suggestions per lead
- Agent configuration editor
- Industry-aware UI — different stat labels, themes, and column layouts per industry

### Admin Control Center (Platform Owner)
- Cross-tenant view of all businesses, leads, and automation activity
- Business lifecycle stage tracking and manual stage updates
- Platform analytics: stage distribution, growth metrics, lead conversion signals
- Suggested stage upgrades based on lead volume and automation event thresholds

### First-Run Activation Flow

When a new business logs in for the first time (`stage = STARTING`), the dashboard shows a one-screen activation overlay instead of the main view.

The flow:
1. The system applies the industry-appropriate `AgentConfig` preset (keywords, weights, follow-up timing)
2. The business owner submits a short test message describing a realistic enquiry
3. The backend creates a lead and runs the full classification and scoring pipeline — the same pipeline that handles every real enquiry
4. The overlay shows the detected intent tags, priority score, and follow-up timing
5. The owner clicks "Open my dashboard" — the overlay closes and the full dashboard renders

Stage advances from `STARTING` to `LEADS_ACTIVE` when the engine successfully processes a lead. Submitting the test lead during activation triggers the full pipeline, so the stage advances at that point. Calling activate or skip alone does not advance the stage — only a processed lead does.

"Skip for now" dismisses the overlay and applies the preset config so future leads use the correct keywords and weights, but stage does not advance until a lead is processed.

### Business Lifecycle Tracking

The platform tracks where each business is in its adoption journey:

| Stage | Description |
|---|---|
| `STARTING` | Signed up, activation not yet complete |
| `WEBSITE_DESIGN` | Website in progress |
| `WEBSITE_LIVE` | Website launched |
| `LEADS_ACTIVE` | Engine has processed at least one lead |
| `AUTOMATION_ACTIVE` | Automation engine running |
| `SCALING` | High-volume lead operations |

Stage advances automatically when the engine processes a lead, or can be updated manually by the platform owner.

---

## Lead Processing Pipeline

```
Incoming enquiry (public form, direct API call, simulation, etc.)
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
        ├─► classify(lead)                        ← hybrid classifier
        │     ├─ rule-first: keyword scoring → tags[], topCategory, confidence
        │     └─ low confidence / ambiguous → optional model fallback
        │     └─ LeadActivity: AGENT_CLASSIFIED (tags, bestCategory, confidenceLabel, via)
        │
        ├─► score(lead, tags)
        │     └─ keyword weight sum → priorityScore
        │     └─ LeadActivity: AGENT_PRIORITIZED
        │
        └─► runAutomations(lead, tags, score)
              └─ evaluate automation rules
              └─ LeadActivity: AUTOMATION_ALERT, AUTOMATION_DEMO_INTENT, etc.
        │
        ▼
Stage advance: STARTING → LEADS_ACTIVE (first successful run only, no-op otherwise)
        │
        ▼
WebSocket broadcast → lead:new event
        │
        ▼
Business dashboard updates in real time
```

---

## Agent Engine Design

The classification layer runs deterministic keyword rules first. A model-backed path is available but off by default.

### How classification works

Each `AgentConfig` stores `classificationRules` — a map of intent categories to keyword lists:

```json
{
  "classificationRules": {
    "keywords": {
      "DEMO_REQUEST": ["demo", "demo class", "trial class"],
      "ADMISSION":    ["admission", "enroll", "join"],
      "FEE_ENQUIRY":  ["fee", "fees", "price", "cost"],
      "CALL_REQUEST": ["call me", "callback", "phone call"]
    }
  }
}
```

The engine scans the lead's message against these keywords. Every category with at least one match is added to `tags[]`. The top-scoring category becomes `bestCategory`.

### Hybrid classification

The classifier uses a rule-first approach. When the rule result is low-confidence (no matches, a tie between categories, or a single weak match on a long message), it can escalate to a model-backed classifier.

Controlled by the `CLASSIFIER_MODE` environment variable:

| Mode | Behaviour |
|---|---|
| `rule_only` | (default) Never calls a model. Safe for dev and CI. |
| `hybrid` | Rule-first. Model fallback on low-confidence or ambiguous results. |

The `via` field in `AGENT_CLASSIFIED` metadata records whether the result came from `rule`, `model`, or `fallback`.

### How priority scoring works

Each `AgentConfig` stores `priorityRules` — a map of keywords to numeric weights:

```json
{
  "priorityRules": {
    "weights": {
      "urgent":      30,
      "immediately": 25,
      "today":       20,
      "demo":        20,
      "admission":   25,
      "fee":         10
    }
  }
}
```

Weights are summed across all matches. The resulting score determines priority:

| Score | Priority |
|---|---|
| ≥ 30 | HIGH |
| ≥ 10 | NORMAL |
| < 10 | LOW |

### Industry-specific presets

When a new business completes the activation flow, the system applies an `AgentConfig` preset matched to their industry. Presets exist for: `academy`, `gym`, `salon`, `clinic`, `restaurant`, `retail` (with a generic fallback for any other industry).

Each preset includes industry-appropriate keyword categories, weight values, and follow-up timing. The preset is applied eagerly on activation — not lazily on first lead.

---

## Architecture

```
indian-sme-engine/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma               ← data models
│   │   ├── migrations/                 ← migration history
│   │   └── seed.js                     ← idempotent demo data seed
│   └── src/
│       ├── agents/
│       │   ├── engine.js               ← AgentEngine orchestrator
│       │   ├── classifier.js           ← hybrid intent classifier
│       │   ├── modelClassifier.js      ← model-backed classification path
│       │   ├── index.js                ← entry point
│       │   ├── leadSuggestions.js      ← Next Best Action logic
│       │   ├── outreachDrafts.js       ← outreach draft generator
│       │   └── policies/
│       │       └── basicPolicy.js      ← keyword scoring + classification rules
│       ├── constants/
│       │   ├── agentConfig.presets.js  ← industry-specific AgentConfig presets
│       │   └── industry.config.js      ← UI themes, stat labels, column config
│       ├── app.js                      ← Express app + route mounting
│       ├── server.js                   ← HTTP + WebSocket server init
│       ├── config/                     ← env validation
│       ├── controllers/                ← HTTP handlers (incl. activation.controller.js)
│       ├── middleware/                 ← JWT auth, superadmin auth, error handler
│       ├── realtime/socket.js          ← WebSocket server + broadcast()
│       ├── routes/                     ← Express routers
│       ├── services/                   ← database query layer
│       ├── tests/                      ← Jest + Supertest integration tests
│       └── utils/                      ← JWT helpers, hash helpers
│
├── backend/scripts/
│   └── simulateLeads.js                ← lead simulation engine (see below)
│
├── dashboard/                          ← Business owner SPA (Vanilla JS)
│   ├── index.html                      ← CRM dashboard (login, activation overlay, lead feed, tabs)
│   ├── agent.html                      ← Agent config editor
│   ├── lead-activity.html              ← Per-lead activity timeline
│   ├── lead-priority.html              ← Priority visualisation
│   ├── style.css
│   └── js/
│       ├── api.js                      ← DashAPI factory (all fetch calls)
│       ├── ui.js                       ← DashUI factory (all DOM rendering)
│       ├── realtime.js                 ← WebSocket client + auto-reconnect
│       ├── dashboard.js                ← Orchestration: wires api + ui + realtime
│       ├── agent.js                    ← Agent config page logic
│       ├── lead-activity.js            ← Activity timeline page logic
│       └── lead-priority.js            ← Priority cards page logic
│
├── admin/                              ← Platform owner control center (Vanilla JS)
│   ├── index.html
│   ├── style.css
│   └── js/
│       ├── config.js                   ← Base URL config
│       ├── admin-api.js                ← AdminAPI factory
│       └── admin.js                    ← All admin UI logic
│
└── frontend/                           ← Public landing page (static, no framework)
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

Accepts a lead from a website form. Rate-limited to 20 requests per 15 minutes per IP.

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
GET    /api/admin/config                    ← dashboard config (needsActivation, industry-aware stat cards, enums)
GET    /api/admin/business                  ← business profile
GET    /api/admin/dashboard                 ← stat counts
GET    /api/admin/leads                     ← leads with priorityScore, tags, priority, status
GET    /api/admin/leads/:id/activity        ← full activity timeline for a lead
GET    /api/admin/leads/:id/suggestions     ← Next Best Action suggestions
GET    /api/admin/leads/:id/outreach-draft  ← outreach draft for a lead
GET    /api/admin/leads/by-day?days=7       ← lead counts by day (for chart)
PATCH  /api/leads/:id/status                ← update lead status
DELETE /api/leads/:id                       ← delete lead
GET|PUT /api/agent                          ← read/update AgentConfig

POST   /api/admin/activate                  ← first-run: apply industry preset → { testMessage }
POST   /api/admin/activate/skip             ← first-run: apply preset, dismiss overlay (stage stays STARTING)
```

`GET /api/admin/config` returns `needsActivation: true` when `business.stage === 'STARTING'`. The dashboard uses this to show the activation overlay before rendering the main view.

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

`backend/scripts/simulateLeads.js` generates realistic Indian leads and submits them through the public API — it does not write directly to the database.

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

The seed script (`npx prisma db seed`) populates demo businesses, leads, and LeadActivity data. Run `npm run simulate` to generate additional traffic through the full classification, scoring, and automation pipeline.

| Deployment status | Local only |
|---|---|
| Dashboard URLs | `localhost:4000/dashboard` and `localhost:4000/admin` |

---

## What's Next

- [ ] WhatsApp integration (inbound lead capture via WhatsApp webhook)
- [ ] Scheduled follow-up delivery (actual message sending, not just scheduling)
- [ ] Multi-user support within a business (OWNER + STAFF roles)
- [ ] Public deployment
- [ ] Mobile-responsive dashboard
- [ ] Export leads to CSV
