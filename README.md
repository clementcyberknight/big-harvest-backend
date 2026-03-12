# Big Harvest Backend (Farville)

High-performance WebSocket backend for Farville — built for 10k+ users on a $5 VPS.

## Tech Stack

- **uWebSockets.js** — WebSocket server
- **Supabase** — PostgreSQL + service role
- **Solana wallet** — Ed25519 auth (sign once, access/refresh tokens)
- **Protobuf** — Binary streaming (`proto/ws_messages.proto`)
- **TypeScript** — Strict mode

## Quick Start

```bash
pnpm install
cp .env.example .env
# Edit .env with your Supabase credentials and JWT_SECRET
pnpm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (backend only) |
| `JWT_SECRET` | 32+ byte secret for access tokens |
| `RAPIDAPI_KEY` | RapidAPI key for commodity prices (investing-real-time) |
| `PORT` | WebSocket port (default: 3001) |

## Auth Flow

1. **Connect** → `ws://host:3001/ws`
2. **Receive** `auth_challenge` with `nonce` and `timestamp`
3. **Sign** `nonce:timestamp` with Solana wallet
4. **Send** `auth` with `public_key`, `signature`, `nonce`, `timestamp`
5. **Receive** `auth_success` with `access_token` and `refresh_token`

**Reconnect:** Send `auth` with `session_token` (access_token).

**Refresh:** `POST /auth/refresh` with `{ "refresh_token": "..." }`.

**Commodities:** `GET /market/commodities` — returns cached commodity prices (JSON).

### Wire Format (Protobuf)

Messages use **size-delimited** format: `varint(length) + message_bytes`. Share `proto/ws_messages.proto` with the frontend for encoding/decoding.

## Database

Run Supabase migrations in `supabase/migrations/`:

```bash
supabase db push
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Dev server with hot reload |
| `pnpm build` | Compile TypeScript |
| `pnpm start` | Run compiled output |

## Project Structure

```
src/
├── auth/          # Wallet verify, tokens
├── config/        # Env loading
├── db/            # Supabase client
├── http/          # POST /auth/refresh
├── market/        # Price engine (5min broadcast)
├── ws/             # WebSocket server
└── index.ts       # Entry point
```

## License

ISC
