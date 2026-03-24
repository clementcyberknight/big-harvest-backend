# Ravolo / Big Harvest — Agent instructions

This repository is the **real-time game backend** for **Ravolo** a farming + global economy simulation with WebSockets, Redis hot state, and durable persistence. Treat **players as adversarial**: they will spam, retry, race, collude, and manipulate time.

---

## Product & performance bar

- **SLO:** ~**100 ms average** end-to-end for player actions over WebSockets (validate → authoritative state change → ack). Optimize the hot path continuously.
- **Hot path:** connection auth, routing, **Redis Lua** for mutations that must be atomic, minimal JS work, structured logs (pino), binary payloads where it helps (msgpack).
- **Cold path:** pricing ticks, settlements, heavy analytics → **workers** (BullMQ), **not** inside WS handlers.

---

## Canonical `src/` layout

Implement and extend code **only** along these boundaries. New domains get a folder under `modules/` with the same shape (`*.service.ts`, `*.repository.ts`, `*.types.ts`, validators where needed).

```
src/
│
├── app.ts                     # app bootstrap
├── server.ts                  # WebSocket server init
│
├── config/                    # env & constants
│   ├── env.ts
│   └── constants.ts
│
├── infrastructure/            # External systems
│   ├── redis/
│   │   ├── client.ts
│   │   ├── commands.ts
│   │   └── scripts/
│   │       ├── harvest.lua
│   │       ├── sell.lua
│   │       ├── buy.lua
│   │       ├── loan.lua
│   │       └── craft.lua
│   │
│   ├── db/
│   │   ├── client.ts
│   │   └── schema.ts
│   │
│   └── logger/
│       └── logger.ts
│
├── modules/                   # DOMAIN MODULES / ENGINES
│
│   ├── crop/
│   │   ├── crop.config.ts
│   │   └── crop.types.ts
│
│   ├── farm/                   # Farm/Plot Engine
│   │   ├── farm.service.ts
│   │   ├── farm.repository.ts
│   │   └── farm.types.ts
│
│   ├── planting/               # Planting Engine
│   │   ├── planting.service.ts
│   │   ├── planting.repository.ts
│   │   ├── planting.validator.ts
│   │   └── planting.types.ts
│
│   ├── harvesting/             # Harvesting Engine
│   │   ├── harvesting.service.ts
│   │   ├── harvesting.repository.ts
│   │   └── harvesting.types.ts
│
│   ├── animal/                 # Animal & Produce Engine
│   │   ├── animal.service.ts
│   │   ├── animal.repository.ts
│   │   └── animal.types.ts
│
│   ├── inventory/              # Inventory & Asset Engine
│   │   ├── inventory.service.ts
│   │   ├── inventory.repository.ts
│   │   └── inventory.types.ts
│
│   ├── wallet/                 # Wallet & Loan Engine
│   │   ├── wallet.service.ts
│   │   ├── wallet.repository.ts
│   │   └── wallet.types.ts
│
│   ├── market/                 # Market Engine (Buy/Sell)
│   │   ├── market.service.ts
│   │   ├── pricing.service.ts  # Dynamic Pricing Engine
│   │   ├── market.repository.ts
│   │   └── market.types.ts
│
│   ├── treasury/               # Treasury / CBN Engine
│   │   ├── treasury.service.ts
│   │   └── treasury.types.ts
│
│   ├── ai-events/              # AI Event Engine
│   │   ├── event.service.ts
│   │   ├── event.repository.ts
│   │   └── event.types.ts
│
│   ├── syndicate/              # Syndicate Engine
│   │   ├── syndicate.service.ts
│   │   ├── syndicate.repository.ts
│   │   └── syndicate.types.ts
│
│   ├── crafting/               # Crafting Engine
│   │   ├── crafting.service.ts
│   │   ├── crafting.repository.ts
│   │   └── crafting.types.ts
│
│   ├── leaderboard/            # Leaderboard / Ranking Engine
│   │   ├── leaderboard.service.ts
│   │   ├── leaderboard.repository.ts
│   │   └── leaderboard.types.ts
│
│   ├── scheduler/              # Cron / Scheduler Engine
│   │   ├── scheduler.service.ts
│   │   └── jobs/
│   │       ├── price-update.job.ts
│   │       ├── crop-decay.job.ts
│   │       └── idol-request.job.ts
│
│   └── analytics/              # Analytics & Trend Detection Engine
│       ├── analytics.service.ts
│       └── analytics.repository.ts
│
├── transport/                  # Communication Layer
│   ├── websocket/
│   │   ├── ws.server.ts
│   │   ├── ws.router.ts
│   │   └── handlers/
│   │       ├── plant.handler.ts
│   │       ├── harvest.handler.ts
│   │       ├── sell.handler.ts
│   │       └── buy.handler.ts
│
├── workers/                    # Background Workers
│   ├── pricing.worker.ts
│   └── settlement.worker.ts
│
└── shared/
    ├── utils/
    │   ├── time.ts
    │   └── id.ts
    └── errors/
        └── appError.ts
```

**Dependency direction:** `transport/` → `modules/` → `infrastructure/`. Domain modules must not import WebSocket server types.

---

## Layer responsibilities

| Layer              | Role                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **transport**      | Auth context, rate limits, message routing, serialization. **No business rules** beyond input shape.                                                                                                           |
| **modules**        | Use cases: orchestrate reads/writes, enforce game rules **that can be checked in JS** only when Redis already holds invariants — money/inventory/plot transitions belong in Lua or single-script atomic paths. |
| **infrastructure** | Redis, DB, external APIs, logging.                                                                                                                                                                             |
| **workers**        | Scheduled / queued jobs: price updates (~30s cadence in design), snapshots, reconciliation, notifications.                                                                                                     |

---

## Authoritative state & time

- **Never trust client timestamps** for gameplay or economy. Use **server time only** (`Date.now()` / monotonic clocks where appropriate).
- **Redis** is the **source of truth for concurrent game state** during play (plots, cooldowns, locks, idempotency).
- **Postgres (or Supabase)** is **durable truth** for profiles, audit, anti-cheat review, and recovery. Design **explicit sync**: Redis success → enqueue durable write → retry on failure (BullMQ), with state markers (`pending` / `confirmed`) where mismatch is unacceptable.

---

## Money, inventory, and math

- Store **integers in smallest units** (e.g. token “cents”, crop counts as whole items). No floats for balances or prices persisted in hot storage.
- **Validate non-negative and sufficient balance** inside the **same atomic Redis operation** that mutates state (Lua script), not only in TypeScript.

---

## Concurrency, idempotency, and exploits (mandatory patterns)

Before shipping any feature that spends or grants value, answer: **Is it atomic? Can it be spammed? Can it be duplicated? Can Redis and DB diverge? Can timing cheat it?** If any answer is “maybe,” fix it.

1. **Double spend / duplicate actions** — HARVEST, SELL, loan withdrawal, etc.: use **idempotency keys** per logical request; store `processed:{requestId}` in Redis with TTL. Combine with **Lua** so “check idempotency + mutate” is one atomic unit when needed.
2. **Client time manipulation** — no client clocks in authority paths.
3. **Early harvest / premature actions** — readiness and season logic enforced **inside Lua** (or one atomic script), not “check in JS then write in Redis.”
4. **Negative inventory** — in script: `if current < amount then return ERR end`.
5. **Gold duplication** — **inventory decrement + wallet credit in one atomic Redis operation** (e.g. `atomicSell.lua`).
6. **Price manipulation** — detect **self-trades / circular trades / syndicate wash trading**; exclude or down-weight in pricing inputs; fees/cooldowns where appropriate.
7. **Cross-action races** (harvest+sell, sell+loan, plant+harvest) — **per-resource locks** in Redis with **TTL** (`lock:plot:{id}`, `lock:inventory:{userId}`), or fold into a single script that touches all keys for that operation. **Always expire locks** to avoid zombies.
8. **Loan collateral** — **lock or segregate** collateral: `inventory:available` vs `inventory:locked` before disbursing funds.
9. **Redis memory** — TTL on ephemeral keys; move cold history to Postgres; avoid unbounded keys per player action.
10. **Event storms** — no unbounded recursion between events; caps and cooldowns on triggers.
11. **WebSocket flood** — **rate-limiter-flexible** (or equivalent): per-connection and per-user limits (e.g. ~10 actions/sec with burst control); drop or queue fairly.
12. **Lost data** — AOF/snapshot strategy for Redis in ops; **periodic DB snapshots** from workers; document RPO/RTO expectations.
13. **Redis OK, DB write failed** — **outbox / retry queue** (BullMQ); reconcile jobs; never assume “Redis wrote = done” for irreversible economy actions without durability path.
14. **Floating point** — integers only in stored economy state.
15. **Blocking handlers** — keep handlers thin; CPU-heavy pricing/market simulation in workers.
16. **Syndicate / sybil** — caps, account-age/activity signals, anomaly detection hooks in `market` / future `syndicate` module.

**Rule of thumb:** _If it’s not enforced inside Redis atomically, it’s not safe under load and malice._

---

## Redis implementation notes

- Prefer **Lua scripts** (`EVALSHA`) loaded at startup from `infrastructure/redis/scripts/` and registered in `commands.ts`.
- Use **hash tags** in cluster mode for multi-key ops: keys that must live in the same slot share `{userId}` (or `{plotId}`) in the key name.
- Keep scripts **short**; avoid `KEYS`, unbounded scans, or O(N) work on large structures in the hot path.

---

## Errors & API surface

- Use **`shared/errors/appError.ts`** for typed, stable error codes the client can handle.
- Handlers map domain errors → WebSocket message envelopes; **do not leak stack traces** to clients.

---

## When adding a new feature

1. Place types and pure config in `modules/<domain>/`.
2. Add or extend **Lua** if the feature moves items, currency, or plot state under contention.
3. Add **idempotency** if the client can retry (mobile networks always retry).
4. Add **rate limiting** at the transport edge if it’s an action endpoint.
5. If Postgres must reflect the change, enqueue a **worker job** with retry and idempotent DB upsert.
6. Log with **correlation** (userId, requestId, message type) at info/warn; errors with stack at error.

---

## Stack reference (this repo)

- **WebSockets:** uWebSockets.js
- **Cache / hot state:** ioredis + Lua
- **Queues / workers:** BullMQ
- **DB client:** Supabase JS (adapt to your actual Postgres access pattern)
- **Validation:** Zod
- **Logging:** pino

Align new dependencies with this architecture; prefer boring, fast primitives over heavy frameworks on the hot path.

---

## Naming

- **Ravolo** = backend / app name in repo metadata.
- **Big Harvest** = player-facing game name and economy design.  
  Documentation and agent prompts may use either; code comments should stay factual and short.
