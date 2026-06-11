# analytics-mono

A TypeScript monorepo that unifies customer data from three disconnected systems — **Saleor** (e-commerce), **Zoho CRM**, and the internal **Doctor App** — into a single Postgres database, served via a REST API and visualized in a Next.js analytics dashboard.

The business couldn't answer "did this customer buy, get seen, and get followed up with?" without querying three separate systems. This is the layer that changes that.

---

## What It Does

| Capability | How |
|---|---|
| **Funnel event ingest** | Real-time POST endpoint writes browser events to `funnel_events` |
| **External data sync** | Three scheduled Lambda jobs pull from Saleor, Zoho, and the Doctor App |
| **Customer reconciliation** | Cross-references records across all sources; tracks gaps in `reconciliation_log` |
| **Patient adherence monitoring** | Segments patients by treatment plan adherence tier (Red → Orange → Green → Purple) so marketing can drive engagement campaigns and protect high-value retention |
| **Analytics dashboard** | Next.js UI: `/health`, `/funnel-analytics`, `/patients`, `/shop-analytics`, `/zoho-health` |

---

## Architecture

```
External Sources                    analytics-mono               Consumers
─────────────────                   ──────────────               ─────────
Saleor (GraphQL)  ──► apps/sync ──►
Zoho CRM (REST)   ──► apps/sync ──► packages/db (Postgres 16) ──► apps/api ──► apps/web
Doctor App (PG)   ──► apps/sync ──►
                                           ▲
Browser Events    ──► apps/api ────────────┘
```

**Sync is always inward.** Nothing in this repo writes back to Saleor, Zoho, or the Doctor App.

### Component Responsibilities

| Component | Runtime | Trigger | Responsibility |
|---|---|---|---|
| `apps/sync/saleor.ts` | Lambda | Scheduled | Cursor-paginated GraphQL pull — customers + fully-charged orders |
| `apps/sync/zoho.ts` | Lambda | Scheduled | OAuth2 incremental sync — contacts, deals, calls, tasks, events via `sync_checkpoints` |
| `apps/sync/doc-app.ts` | Lambda | Scheduled | Cross-DB pull from Doctor App Postgres — patients, supply tracking, cart sessions, dispatched orders |
| `apps/api/ingest.ts` | Lambda | `POST /ingest` | Writes browser funnel events (sessionId, eventName, email, properties) to `funnel_events` |
| `apps/api/customers.ts` | Lambda | `GET /customers` | Paginated customer query with optional reconciliation status filter |
| `apps/web` | Next.js 15 | Browser | Marketing & ops dashboard — `/health` (patient adherence tiers), `/funnel-analytics`, `/patients`, `/shop-analytics`, `/zoho-health` |

---

## Monorepo Structure

```
analytics-mono/
├── apps/
│   ├── api/          # Lambda handlers (ingest, customers) + local Express dev server
│   ├── sync/         # Scheduled Lambda sync jobs (saleor, zoho, doc-app)
│   └── web/          # Next.js 15 dashboard (health, funnel-analytics, patients, shop-analytics, zoho-health)
├── packages/
│   └── db/           # Shared Drizzle ORM schema, migrations, Postgres client
├── scripts/          # One-off scripts (e.g. backfill-supply-tracking.ts)
├── docker-compose.yml
├── .env.example
└── LOCAL_DEVELOPMENT.md
```

Build orchestration: **Turborepo** + **pnpm workspaces**. All apps share `packages/db` — change a table schema once, all consumers get it.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| pnpm | 9.x | `npm install -g pnpm@9` |
| Docker + Docker Compose | any recent | [docs.docker.com](https://docs.docker.com) |

---

## Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Fill in the required variables — see Environment Variables below

# 3. Start local services
docker compose up -d

# 4. Run database migrations
pnpm db:migrate

# 5. Start all apps
pnpm dev
```

Once running:

| Service | URL |
|---|---|
| Web dashboard | http://localhost:3000 |
| API (local Express) | http://localhost:3001 |
| Adminer (DB UI) | http://localhost:8080 |
| Postgres | localhost:5433 |
| LocalStack (AWS emulation) | http://localhost:4566 |

---

## Environment Variables

Copy `.env.example` → `.env`. The `DATABASE_URL` default is pre-wired for the local Docker container — no edit needed for local dev.

| Variable | Required | Description |
|---|---|---|
| `ZOHO_CLIENT_ID` | ✅ | Zoho OAuth app client ID |
| `ZOHO_CLIENT_SECRET` | ✅ | Zoho OAuth app client secret |
| `ZOHO_REFRESH_TOKEN` | ✅ | Zoho long-lived refresh token |
| `SALEOR_API_TOKEN` | ✅ | Saleor API auth token |
| `SALEOR_API_URL` | ✅ | Saleor GraphQL endpoint URL |
| `DOCAPP_DATABASE_URL` | ✅ | Postgres connection string for the Doctor App DB |
| `DATABASE_URL` | pre-wired | Analytics Postgres (default: `postgresql://postgres:postgres@localhost:5433/analytics`) |
| `API_PORT` | optional | API dev server port (default: `3001`) |
| `CF_DISTRIBUTION_ID` | prod only | CloudFront distribution ID — leave blank locally |

---

## Available Commands

### Root (all packages via Turborepo)

```bash
pnpm dev          # Start all apps in dev/watch mode
pnpm build        # Build all apps and packages
pnpm db:generate  # Generate Drizzle migration files from schema changes
pnpm db:migrate   # Apply pending migrations to the database
```

### Run sync jobs manually

```bash
pnpm --filter @analytics/sync run:zoho      # Zoho CRM sync
pnpm --filter @analytics/sync run:saleor    # Saleor sync
pnpm --filter @analytics/sync run:doc-app   # Doctor App sync
```

### Individual apps

```bash
pnpm --filter @analytics/api dev    # API server only → port 3001
pnpm --filter @analytics/web dev    # Web dashboard only → port 3000
```

### Deploy

```bash
./deploy.sh    # Production Lambda + Next.js deploy
```

---

## Database Tables

| Table | Populated By |
|---|---|
| `funnel_events` | Website ingest (real-time) |
| `customers` | Saleor sync |
| `saleor_orders` | Saleor sync |
| `zoho_contacts` | Zoho sync |
| `zoho_deals` | Zoho sync |
| `zoho_events` | Zoho sync |
| `db_patients` | Doctor App sync |
| `db_treatment_plans` | Doctor App sync |
| `supply_tracking` | Doctor App sync |
| `cart_sessions` | Doctor App sync |
| `orders_dispatched` | Doctor App sync |
| `reconciliation_log` | Doc-App sync (cross-source matching) |
| `sync_jobs` | Internal sync state |
| `sync_checkpoints` | Zoho incremental sync cursors |

---

## Dashboard Pages (`apps/web`)

### `/health` — Customer Health Index

The primary marketing tool. Segments patients with active treatment plans by how much of their allotted grams remain in the current interval. Marketing uses this to drive engagement campaigns (move patients up tiers) and monitor high-adherence patients at risk of drop-off.

| Tier | Remaining Allowance | Signal |
|---|---|---|
| 🔴 Red | >75% remaining | Low engagement — prioritize outreach |
| 🟠 Orange | 50–75% remaining | Moderate use — nurture toward Green |
| 🟢 Green | 25–50% remaining | Good adherence — move toward Purple |
| 🟣 Purple | ≤25% remaining | High adherence — retain & watch for drop-off |

**Tier assignment is computed at query time** from `supply_tracking` — not stored. `supply_tracking` sync freshness is operationally critical; stale data means marketing is working against an outdated cohort.

Also surfaces: behavioral segments (`loyal_power_buyer`, `window_shopper`, `at_risk`, etc.), visit frequency, conversion rate, grams used vs. allotted, fill counts.

### `/funnel-analytics`

Visualizes patient funnel events to track progression through the acquisition and conversion pipeline.

### `/patients`

Patient-level browsing and lookup for operational review.

### `/shop-analytics`

Shop-level performance metrics and purchase analytics.

### `/zoho-health`

Operational view of Zoho CRM sync status and data integrity.

---

## Local Development

See [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for detailed guidance on Docker Compose, seeding, and debugging sync jobs locally.
