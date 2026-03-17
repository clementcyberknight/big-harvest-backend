# Farville Backend Architecture Design

This document outlines the backend stack, database schema, WebSocket protocols, and authentication flow for Farville.

## Tech Stack (The "Blazing Fast" Layer)

- **Language**: Node.js with TypeScript
- **WebSocket Engine**: `uWebSockets.js` - High-performance, low-latency communication
- **Database**: Supabase (PostgreSQL)
- **Auth**: Solana wallet signature + Access/Refresh tokens (jose)
- **External Integration**: `undici` for fetching real-world commodity data
- **Serialization**: Protocol Buffers (`@bufbuild/protobuf`) for streaming to frontend

---

## 1. Authentication Flow (Solana Wallet + Tokens)

### Sign In (Once in a Blue Moon)
1. Client connects to WebSocket (unauthenticated)
2. Server sends `auth_challenge` with nonce + timestamp
3. Client signs nonce with Solana wallet (Ed25519)
4. Server verifies signature → upserts profile → creates refresh_token (DB) + access_token (JWT)
5. Client stores both securely (Keychain/Keystore)

### Daily Use (No Re-sign)
- **Access Token** (15 min): Stateless JWT, used for WebSocket auth + API calls
- **Refresh Token** (30 days): Stored hashed in DB, used to obtain new access tokens
- On reconnect: Send access_token → if expired, POST `/auth/refresh` with refresh_token

### Security
- Refresh tokens: SHA-256 hashed, rotation on each refresh
- Ed25519 verification via `@noble/ed25519` + `bs58`

---

## 2. Database Schema (Supabase / PostgreSQL)

### `profiles` (Wallet = Identity)
- `id`: uuid (PK)
- `wallet_address`: text (unique, indexed) — Solana pubkey
- `has_defaulted`: boolean (default false) — Set true if a loan is seized
- `coins`: bigint (default 0) — Player's global balance

### `treasury` (Single Row)
- `id`: uuid (PK)
- `balance`: bigint (default 50,000,000)
- `epoch_ms`: bigint (persistent game clock start time)

### `commodity_prices` (Persistence layer for DP Engine)
- `id`: text (PK, e.g. 'wheat')
- `current_buy_price`, `current_sell_price`: numeric
- `demand_multiplier`: numeric (default 1.0)
- `sales_last_2h`, `purchases_last_2h`: int

### `price_history` (Analytics append-only log)
- `id`: uuid (PK)
- `commodity_id`: text
- `snapshot_at`: timestamptz

### `plots` (Active Farm State)
- `id`: uuid (PK)
- `profile_id`: uuid (FK → profiles)
- `plot_tier`: text ('starter', 'fertile', 'premium')
- `slot_index`: int
- `crop_id`: text (nullable)
- `planted_at`: bigint (nullable)
- `locked_for_loan`: boolean (default false)

### `animals` (Husbandry State)
- `id`: uuid (PK)
- `profile_id`: uuid (FK)
- `animal_type`: text (e.g. 'chicken', 'cow')
- `last_collected`: bigint
- `locked_for_loan`: boolean (default false)
- `last_mated_at`: bigint
- `gestation_ready_at`: bigint
- `is_fed`: boolean
- `parents`: jsonb
- `purchase_price`: bigint

### `incubators` (Egg Hatching)
- `id`: uuid (PK)
- `profile_id`: uuid (FK)
- `egg_type`: text
- `started_at`: bigint
- `ready_at`: bigint
- `locked_for_loan`: boolean
- `purchase_price`: bigint

### `inventory`
- `profile_id`: uuid (FK)
- `item_id`: text
- `quantity`: integer

### `loans`
- `id`: uuid (PK)
- `profile_id`: uuid (FK)
- `principal`, `total_due`: bigint
- `interest_rate`: numeric
- `status`: text ('active', 'repaid', 'defaulted')
- `due_at`, `grace_until`: bigint
- `collateral`: jsonb (snapshot of pledged plots/animals)

### `ledger` (Double-Entry Log)
- `id`: uuid (PK)
- `from_type`, `to_type`: text ('player' | 'treasury')
- `from_id`, `to_id`: uuid
- `amount`: bigint
- `reason`: text

---

## 3. WebSocket Protocols (uWebSockets.js)

### Topics
- `/market`: Price updates every 30 seconds
- `/global`: Season changes, AI events
- `/profile/{uuid}`: Private channel per user (e.g. for `craft_complete` or `loan_default`)

### Game Loop Handlers
- `buy_plot`, `buy_seed`, `plant_crop`, `harvest`, `sell`
- `craft`, `collect_animal`
- `buy_animal`, `sell_animal`, `feed_animal`, `mate_animals`
- `buy_incubator`, `start_incubation`, `finish_incubation`
- `request_loan`, `repay_loan`

---

## 4. Market Price Engine (The Economy)

1. **Redis Hot Storage**: All active interactions hit Redis (target <100ms response).
2. **Pricing Factors**: 
   - `treasury_ratio`: Scarcity valve based on how much of the 50M cap the Treasury holds.
   - `demand_mult`: Per-commodity volume tracker.
   - `velocity_mult`: Speed of token circulation.
   - `event_mult`: Global or specific multipliers from the AI Engine.
3. **Tick Rate**: Prices recalculate every 30 seconds.
4. **Persistence**: Batched back to `commodity_prices` in Supabase every 60 seconds.

---

## 5. Economy Systems & Anti-Cheating

- **Idempotency**: All player actions are wrapped in a per-player Redis mutex lock (`utils/lock.ts`) to prevent double-spending and race conditions.
- **Strict Ledger**: Tokens only move securely between the Treasury and Players via Double-Entry Lua Scripts in Redis.
- **Server-Authoritative Time**: Growth checks (`planted_at + growth_time`) are computed on the server based on the persistent `treasury.epoch_ms`.
- **Active Population Scaling**: Global demand adjusts based on the 1-hour rolling active player count in Redis.
