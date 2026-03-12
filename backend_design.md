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
- `username`: text
- `xp`: bigint (default 0)
- `coins`: bigint (default 100)
- `last_sync_at`: timestamptz
- `daily_donations_count`: integer (resets UTC 00:00)
- `created_at`, `updated_at`: timestamptz

### `refresh_tokens`
- `id`: uuid (PK)
- `profile_id`: uuid (FK → profiles)
- `token_hash`: text (SHA-256 of token)
- `device_info`: text (optional)
- `expires_at`: timestamptz
- `created_at`: timestamptz
- `revoked_at`: timestamptz (NULL = active)

### `crops` (Configuration - Read Only)
- `id`: uuid (PK)
- `name`: text
- `growth_time_seconds`: integer
- `base_buy_price`: integer
- `base_sell_price`: integer
- `xp_on_harvest`: integer

### `plots` (Active Farm State)
- `id`: uuid (PK)
- `user_id`: uuid (FK → profiles)
- `crop_id`: uuid (FK, nullable)
- `planted_at`: timestamptz (nullable)
- `boost_applied`: boolean

### `inventory`
- `user_id`: uuid (FK)
- `item_type`: text
- `item_id`: uuid
- `quantity`: integer

### `orders_log` (Anti-Cheating & Audit)
- `id`: uuid (PK)
- `user_id`: uuid (FK)
- `action`: text ('harvest', 'sell', 'craft')
- `details`: jsonb
- `server_timestamp`: timestamptz (default now())

---

## 3. WebSocket Protocols (uWebSockets.js)

### Topics
- `/market`: Price updates every 5 minutes
- `/user/{wallet}`: Private channel per user
- `/global`: Leaderboard, announcements

### Message Types (Protobuf / JSON)

#### Server → Client
- `auth_challenge` — nonce, timestamp, expires_in
- `auth_success` — access_token, refresh_token, expires_in
- `auth_failed` — reason
- `market_pulse` — crop multipliers, timestamp

#### Client → Server
- `auth` — public_key, signature, nonce (first connect) OR session_token (reconnect)
- `heartbeat` — local_time, last_action_id

---

## 4. Market Price Engine

1. Fetch real-world commodity data (undici)
2. Volatility Factor: `(current / historical_avg) * random_variation`
3. In-memory `price_multipliers` cache
4. Broadcast to `/market` every 5 minutes

---

## 5. Anti-Cheating Strategy

- **Time Check**: `delta = server_now - planted_at`
- **Growth Threshold**: Reject if `delta < crop.growth_time_seconds * (1 - MAX_BOOST)`
- **Session Check**: Verify `profile_id` in JWT matches DB update
