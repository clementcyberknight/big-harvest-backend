# Ravolo / Big Harvest — Agent instructions

This repository is the **real-time game backend** for **Ravolo** a farming + global economy simulation with WebSockets, Redis hot state, and durable persistence. Treat **players as adversarial**: they will spam, retry, race, collude, and manipulate time.

---

## Product & performance bar

- **SLO:** ~**100 ms average** end-to-end for player actions over WebSockets (validate → authoritative state change → ack). Optimize the hot path continuously.
- **Hot path:** connection auth, routing, **Redis Lua** for mutations that must be atomic, minimal JS work, **structured logs (pino only; no `console` in modules/transport)**, **WebSocket binary MessagePack** (`msgpackr` in `transport/websocket/ws.codec.ts` — outbound always binary; inbound accepts msgpack binary or UTF-8 JSON for dev/tools).
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
│   │   ├── ws.codec.ts         # MessagePack binary frames (hot path)
│   │   └── handlers/
│   │       ├── plant.handler.ts
│   │       ├── harvest.handler.ts
│   │       ├── sell.handler.ts
│   │       └── buy.handler.ts
│
├── workers/                    # Background Workers
│   ├── pricing.worker.ts
│   └── userActionsFlush.worker.ts
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
- **`user_actions` (implemented)** — Hot path is **only** `RPUSH` to Redis list `ravolo:user_actions:queue`. `src/workers/userActionsFlush.worker.ts` batch-drains with **`MULTI` `LRANGE` + `LTRIM`** (atomic), then bulk-inserts to Supabase; failed batches are re-queued at the head. Use `app.disposeAsync()` on shutdown so the worker finishes and a final drain runs before Redis closes.

---

## Hot path vs cold path (performance)

- **WebSocket gameplay** should not `await` HTTP to Supabase (or other remote APIs). Keep mutations in **Redis/Lua**; push analytics/audit through **Redis queues** or **BullMQ** and flush in workers.
- **`/auth/*` and `/profile/*`** are **cold path**: a few Supabase round-trips per signup/login is acceptable; they are not on the per-tick game loop.
- **Pricing worker** (`pricing.worker.ts`) does more Redis reads per tick (flows + history per item). If tick cost grows, move heavy stats to a slower cadence or sample.
- **`jsonwebtoken` verify** on WebSocket upgrade is local crypto only — cheap vs network I/O.
- **Per-action `JSON.stringify`** for audit payloads is CPU-only; keep payloads small. Oversized lines are truncated using `USER_ACTIONS_MAX_LINE_BYTES`.

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
- **Logging:** pino (`infrastructure/logger/logger.ts`; redacts common secret fields in structured logs)

Align new dependencies with this architecture; prefer boring, fast primitives over heavy frameworks on the hot path.

---

## Naming

- **Ravolo** = backend / app name in repo metadata.

## HTTP & WebSocket status codes (mandatory)

**Never return an error payload with HTTP 200.** The status code is the signal — the body is the detail.
A `{ "error": "...", "message": "..." }` body on a 200 response is invisible to any HTTP-aware client,
CLI, proxy, or retry layer. Treat it as a silent corruption of the API contract.

### HTTP endpoints (`/auth/*`, `/profile/*`, cold path)

| Condition                                        | Status |
| ------------------------------------------------ | ------ |
| Success                                          | `200`  |
| Malformed body / failed Zod validation           | `400`  |
| Missing, expired, or invalid JWT / refresh token | `401`  |
| Valid token but insufficient permission          | `403`  |
| Resource conflict / duplicate idempotency key    | `409`  |
| Unhandled internal error                         | `500`  |

**Refresh token failures** (`INVALID_REFRESH_TOKEN`, `EXPIRED_REFRESH_TOKEN`, etc.) **must return `401`**, not `200`.
The client uses the HTTP status to decide whether to redirect to login — a `200` suppresses that logic.

### WebSocket game actions (hot path)

WS frames don't have HTTP status codes, but every outbound envelope must carry an explicit `ok` field
and a stable `error` code the client can branch on:

```ts
// success
{ ok: true,  type: "HARVEST_ACK",  data: { ... } }

// failure
{ ok: false, type: "HARVEST_ACK",  error: "PLOT_NOT_READY", message: "Plot matures in 42 s" }
```

Never send `{ ok: false }` wrapped inside an `{ ok: true }` envelope. If the Lua script returns an
error sentinel, propagate it as `ok: false` from the handler — do not swallow it into a successful frame.

### Implementation checklist for every new endpoint / handler

1. **HTTP routes:** use `res.status(4xx).json(...)` / `res.status(5xx).json(...)` — never `res.status(200).json({ error: ... })`.
2. **WS handlers:** set `ok: false` and include a stable `error` string from `AppError` codes.
3. **`AppError` mapping in transport:** each domain error class maps to exactly one HTTP status and one WS error code — add the mapping when you add the error.
4. **Auth errors specifically:** `INVALID_REFRESH_TOKEN`, `EXPIRED_REFRESH_TOKEN`, `TOKEN_REUSE_DETECTED` → always `401`. Never `200`, never `400`.
5. **No stack traces to the client** — error body shape is `{ error: CODE, message: string }` only.

## Auth & session lifecycle

- **JWT claims** must include: `sub` (userId), `sessionId`, `role`, `iat`, `exp`. No other data.
- **Access tokens** expire in ≤15 min. **Refresh tokens** expire in ≤30 days and are single-use.
- **Refresh token rotation:** on every use, invalidate the presented token and issue a new one atomically
  in a single Redis `SET NX` + Supabase upsert. A reused (already-invalidated) refresh token signals
  compromise — immediately revoke **all** sessions for that user and log `WARN token_reuse_detected`.
- **Session revocation** is a Redis `SET ravolo:session:revoked:{sessionId} 1 EX <ttl>` checked on
  every WS upgrade and on every auth middleware pass. TTL = remaining token lifetime.
- **Banning / kicking** a player: write the revocation key, then publish to Redis pub/sub channel
  `ravolo:kick:{userId}` so all WS nodes can close that player's socket immediately.
- **WS upgrade auth:** verify JWT locally (no network call), check revocation key in Redis, reject with
  HTTP `401` before the upgrade completes. Never allow an unauthenticated socket to enter the router.

## Input validation rules (beyond Zod shapes)

- **String lengths:** usernames ≤ 32 chars, display names ≤ 64, chat messages ≤ 500, item names ≤ 128.
  Enforce in Zod schemas with `.max()`; never rely only on DB constraints.
- **Numeric bounds:** all quantity/amount fields must have explicit `.min(1).max(MAX_SAFE_INT)` in schema.
- **Unicode:** normalise all user-supplied strings to NFC before storing. Reject strings containing null
  bytes (`\u0000`) or non-printable control characters.
- **Homoglyph / look-alike usernames:** run a confusables check at registration (not at runtime).
- **No free-form JSON from clients** in game action payloads — every field must appear in the Zod schema.
  Unknown fields are stripped (`z.object({...}).strict()`).

## Resilience & circuit breaking

- **Redis unavailable:** if the Redis client cannot connect within 200 ms, reject new WS upgrades with a
  `503` and emit a `pino.error` with `reason: 'redis_unavailable'`. Do not silently queue actions in
  process memory — this masks the outage.
- **Supabase unavailable:** BullMQ workers retry with exponential backoff (base 1 s, max 5 min, 10
  attempts). After 10 failures the job moves to the dead-letter queue (`ravolo:dlq`). Alert (log
  `ERROR dlq_job_added`) — do not drop silently.
- **Circuit breaker on external calls** (Supabase, any third-party API): use a simple in-process
  counter; after 5 consecutive failures open the breaker for 30 s, return a fast error to callers, then
  allow one probe request to close it.
- **Never catch-and-swallow errors** in infrastructure code. Always: log at `error` level with full
  context, then either propagate or push to the DLQ.

## Secrets management

- All secrets come from environment variables only — never from config files committed to the repo.
- Required secrets: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `REDIS_URL`, `SUPABASE_SERVICE_KEY`.
  `config/env.ts` must throw on startup if any required secret is missing.
- **Pino redact list** (extend as needed): `['password', 'token', 'refreshToken', 'authorization',
'JWT_SECRET', 'SUPABASE_SERVICE_KEY', 'req.headers.authorization']`.
- Secrets must never appear in structured log `data` fields even under different key names. If you're
  logging an object that might contain a secret, explicitly omit or mask the field.
- **Rotation:** JWT secrets must be rotatable without downtime — support a `JWT_SECRET_PREV` env var
  that the verify step also accepts during a rotation window.

## Observability

### Metrics (expose via `/metrics` in Prometheus format)

- `ws_connections_active` — gauge, current open sockets.
- `ws_message_duration_ms` — histogram, per `type` label; target p99 < 100 ms.
- `redis_lua_errors_total` — counter, per script name.
- `bullmq_queue_depth` — gauge, per queue name.
- `bullmq_job_duration_ms` — histogram, per queue + job type.
- `dlq_jobs_total` — counter; page on sustained increase.

### Health endpoints (HTTP, unauthenticated)

- `GET /healthz` — returns `200 OK` if the process is alive (no external checks).
- `GET /readyz` — returns `200 OK` only if Redis ping < 50 ms AND DB connection pool is open.
  Returns `503` otherwise. k8s/load balancer readiness probe uses this endpoint.

### Tracing

- Every WS message and every worker job must carry a `requestId` (UUIDv7, generated at the transport
  edge for WS; from the BullMQ job ID for workers).
- Pass `requestId` as a pino child logger binding through the entire call chain.
- Do not implement distributed trace propagation beyond this for now — add OpenTelemetry if/when a
  tracing backend is adopted.

## Worker configuration

- **Concurrency:** default `concurrency: 5` per worker. Increase only with a measured Redis CPU budget.
- **Max queue depth:** set `defaultJobOptions.removeOnComplete: 1000` and `removeOnFail: 5000`.
  Alert (log `WARN queue_depth_high`) if a queue exceeds 10 000 jobs.
- **Stalled job detection:** `stalledInterval: 30_000`, `maxStalledCount: 2`. After 2 stalls a job is
  marked failed and moves toward DLQ.
- **Shutdown:** `worker.close()` on `SIGTERM`; drain in-flight jobs up to 30 s then force-close.
  The `app.disposeAsync()` order: stop accepting new WS connections → drain workers → flush
  `user_actions` queue → close Redis → exit.

## Protocol versioning

- Every WS envelope includes a top-level `"v": 1` field (integer, incremented on breaking changes).
- Clients send their supported version on connect (`HELLO` message). If the server cannot support that
  version, reject with `{ ok: false, error: "VERSION_NOT_SUPPORTED" }` before routing.
- **Additive changes** (new optional fields) do not require a version bump.
- **Breaking changes** (renamed fields, removed fields, changed semantics) require a bump and a
  migration window where both versions are handled simultaneously.
- Lua scripts are versioned by their `EVALSHA` hash — loading new scripts at startup is backwards-safe
  because the old hash is simply no longer called.

## Pagination conventions

- All list endpoints and WS list responses use **keyset (cursor) pagination**, never offset.
- Cursor is an opaque base64-encoded string encoding `{ id, timestamp }` of the last seen record.
- Default page size: 20. Maximum: 100. Enforce in Zod with `.max(100)`.
- Response envelope: `{ items: T[], nextCursor: string | null }`. `null` means no more pages.
