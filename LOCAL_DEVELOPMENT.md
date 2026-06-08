# Local Development — analytics-mono

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 20 |
| pnpm | 9.x (`npm i -g pnpm@9`) |
| Docker + Docker Compose | any recent version |

---

## 1. Install dependencies

```bash
pnpm install
```

---

## 2. Environment variables

```bash
cp .env.example .env
```

Fill in any blank values in `.env`. The defaults already wire up the local Postgres instance — you only need to supply external credentials:

| Variable | Required for |
|---|---|
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` | `pnpm run:zoho` sync |
| `SALEOR_API_TOKEN` | `pnpm run:saleor` sync |
| `DOCAPP_DATABASE_URL` | `pnpm run:doc-app` sync |
| `CF_DISTRIBUTION_ID` | production deploy only — leave blank locally |

---

## 3. Start backing services

```bash
docker compose up -d
```

This starts three containers:

| Container | Port | Purpose |
|---|---|---|
| `analytics_pg` | **5433** | Postgres 16 (note: 5433, not 5432, to avoid clashing with a local install) |
| `analytics_localstack` | **4566** | LocalStack — S3 + Lambda smoke tests |
| `analytics_adminer` | **8080** | Adminer DB UI → open http://localhost:8080 |

Wait for Postgres to be healthy before running migrations:

```bash
docker compose ps        # STATUS should show "healthy" for analytics_pg
```

To start only a specific service (e.g. just Postgres):

```bash
docker compose up -d postgres
```

Useful compose commands:

```bash
docker compose logs -f           # tail all service logs
docker compose down              # stop containers (keeps volumes)
docker compose down -v           # stop + wipe all volumes (full reset)
```

---

## 4. Run database migrations

```bash
pnpm db:migrate
```

To generate a new migration after changing the schema in `packages/db`:

```bash
pnpm db:generate
```

To browse the schema interactively:

```bash
cd packages/db && pnpm db:studio
```

---

## 5. Start the apps

### All apps in parallel (Turborepo)

```bash
pnpm dev
```

### Individual apps

| App | Command | Default port |
|---|---|---|
| `apps/api` — Lambda dev server | `cd apps/api && pnpm dev` | 3001 |
| `apps/web` — Next.js frontend | `cd apps/web && pnpm dev` | 3000 |

> **Sync workers** (`apps/sync`) have no persistent dev server — run them on demand (see below).

---

## 7. Run sync workers manually

EventBridge Scheduler is AWS Pro — these are run directly locally:

```bash
# from apps/sync
cd apps/sync

pnpm run:zoho       # pull data from Zoho CRM
pnpm run:saleor     # pull data from Saleor + sync orders with grams
pnpm run:doc-app    # pull patients, supply tracking, cart sessions, and orders from Doc-App
```

The sync workers populate all tables the health index and shop analytics pages need.
Run `pnpm run:doc-app` and `pnpm run:saleor` at least once before using `/health-data` or `/shop-analytics`.

---

## 8. Build

```bash
pnpm build
```

---

## Workspace structure

```
analytics-mono/
├── apps/
│   ├── api/        # Lambda handlers + local Express dev server
│   ├── sync/       # ETL workers (Zoho, Saleor + orders, Doc-App + supply/cart/orders)
│   └── web/        # Next.js frontend (static export → S3)
├── packages/
│   └── db/         # Drizzle ORM schema + migrations (shared by api & sync)
│       └── schema/
│           ├── customers.ts
│           ├── supply-tracking.ts   ← doc-app supply intervals
│           ├── cart-sessions.ts     ← doc-app shop visits
│           ├── orders-dispatched.ts ← doc-app dispatched orders
│           └── saleor-orders.ts     ← Saleor order grams
├── scripts/
│   └── localstack-init.sh   # Auto-creates S3 bucket on LocalStack startup
├── docker-compose.yml
└── .env.example
```
