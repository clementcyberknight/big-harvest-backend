# Big Harvest Backend

High-performance WebSocket + HTTP backend for a farming simulation game.
Built for 10k+ concurrent users on small server.

## Tech Stack

- **uWebSockets.js** — WebSocket + HTTP server
- **Supabase** — PostgreSQL + service role
- **Solana wallet** — Ed25519 auth (sign once, access/refresh tokens)
- **Protobuf** — Binary WebSocket streaming (`proto/ws_messages.proto`)
- **Google Gemini** — AI-generated market events
- **RapidAPI** — Real-world commodity prices
- **TypeScript** — Strict mode

## Quick Start

```bash
pnpm install
cp .env.example .env
# Fill in .env
pnpm run dev
```

## Environment Variables

| Variable                       | Description                          |
| ------------------------------ | ------------------------------------ |
| `SUPABASE_URL`                 | Supabase project URL                 |
| `SUPABASE_SERVICE_ROLE_KEY`    | Service role key                     |
| `JWT_SECRET`                   | 32+ byte secret for access tokens    |
| `RAPIDAPI_KEY`                 | RapidAPI key (`investing-real-time`) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key (for market events)   |
| `PORT`                         | Server port (default: 3001)          |

## Project Structure

```
src/
├── auth/           wallet verify, JWT, refresh tokens
├── config/         env loading
├── db/             Supabase client
├── game/           clock.ts — game timing constants
├── http/           REST endpoints
├── market/         crops.ts · engine.ts · events.ts
└── ws/             WebSocket server, proto, messages
proto/
└── ws_messages.proto
```

## Auth Flow

1. Connect → `ws://host:3001/ws`
2. Receive `auth_challenge` (`nonce`, `timestamp`)
3. Sign `nonce:timestamp` with Solana wallet (Ed25519)
4. Send `auth` with `public_key`, `signature`, `nonce`, `timestamp`
5. New players automatically receive a dynamic Sign-Up Bonus (2 starter plots + 2 cheapest seeds) from the Treasury.
6. Receive `auth_success` + full game state snapshot (clock, market prices, AI event).

**Reconnect:** Send `auth` with `session_token` (your `access_token`).

**Token refresh:** `POST /auth/refresh` `{ "refresh_token": "..." }`

## WebSocket Stream

All messages are **size-delimited protobuf**: `varint(length) + message_bytes`.
See `proto/ws_messages.proto` for the full schema.

| Trigger                         | Message sent                                                  | Topic    |
| ------------------------------- | ------------------------------------------------------------- | -------- |
| On connect                      | `auth_challenge`                                              | direct   |
| After auth                      | `auth_success` + `game_clock` + `market_pulse` + `game_event` | direct   |
| Every game day (1 min)          | `game_clock`                                                  | `market` |
| Every season (7 days)           | `season_change` + `game_event`                                | `global` |
| Every 30 real seconds           | `market_pulse` + `price_update` (Dynamic pricing tick)        | `market` |
| Every 30 real minutes           | `game_event` (new AI monetary policy event)                   | `global` |
| On collateral seizure (Default) | `loan_default`                                                | `profile`|
| On heartbeat                    | `heartbeat_ack`                                               | direct   |

## HTTP Endpoints

| Method | Path                  | Description                      |
| ------ | --------------------- | -------------------------------- |
| `POST` | `/auth/refresh`       | Rotate refresh token             |
| `GET`  | `/market/commodities` | Full commodity list with prices  |
| `GET`  | `/market/events`      | Active event + today's event log |

### `GET /market/commodities`

```json
{
  "commodities": [
    {
      "id": "potato",
      "name": "Potato",
      "tier": 2,
      "category": "crop",
      "base_price": 75.0,
      "multiplier": 1.013,
      "event_multiplier": 1.0,
      "sell_price": 76.0
    }
  ],
  "count": 60,
  "fetched_at": "2025-03-12T14:00:00.000Z"
}
```

### `GET /market/events`

```json
{
  "active_event": {
    "event": "Drought Hits Corn Belt",
    "description": "...",
    "affect": ["corn", "cornmeal", "hearty_stew"],
    "outcome": "crash",
    "impact_multiplier": 0.45,
    "player_tip": "Sell your corn stockpile immediately!",
    "generated_at": "2025-03-12T14:00:00.000Z"
  },
  "today": [ ...up to 24 events... ],
  "count": 5,
  "date": "2025-03-12"
}
```

**Event outcomes:**

| Outcome   | Multiplier range | Meaning                                  |
| --------- | ---------------- | ---------------------------------------- |
| `surge`   | 1.25 – 1.85      | Scarcity or panic buying                 |
| `crash`   | 0.30 – 0.75      | Oversupply or disaster                   |
| `boycott` | 0.02 – 0.12      | Near-zero demand (health scare, scandal) |

## Game Timing

All timing is defined in `src/game/clock.ts`. The game clock resets on server restart (in-memory).

| Real time  | Game time     |
| ---------- | ------------- |
| 1 minute   | 1 game day    |
| 7 minutes  | 1 season      |
| 28 minutes | 1 game year   |
| 2 hours    | ~4 game years |

**Crop growth (real minutes = game days):**

| Tier    | Crops                                        | Time  |
| ------- | -------------------------------------------- | ----- |
| 1       | Wheat, Corn, Carrot, Lettuce                 | 1 min |
| 2       | Tomato, Potato, Sugarcane, Cotton, Sunflower | 2 min |
| 3       | Watermelon, Pumpkin, Coffee, Strawberries    | 5 min |
| Special | Indigo, Marigold, Madder                     | 3 min |

**Animal husbandry (real minutes):**
Animals operate on a 10-minute collect cycle. They can be fed `animal_feed` to double their output and increase their rare drop chance by 1.5x.

| Animal  | Produces          | Rare Drop | Base Rare Rate|
| ------- | ----------------- | --------- | ------------- |
| Chicken | Egg               | Golden Egg| 5%            |
| Cow     | Milk              | Rich Milk | 8%            |
| Sheep   | Wool              | -         | -             |
| Bee     | Honey / Honeycomb | Royal Jell| 3%            |
| Pig     | Pork              | Truffle   | 4%            |

**Mating & Incubation:**
- Animals of the same species can be mated (2-hour cooldown).
- **Mammals:** undergo a 1-hour gestation period.
- **Birds:** drop a fertilzed egg that must be placed in a purchased **Incubator** for 30 minutes.

**Crafting time (real seconds):**

| Layer | Examples                                  | Time  |
| ----- | ----------------------------------------- | ----- |
| 1     | Flour, Thread, Butter, Yarn               | 30 s  |
| 2     | Bread, Cheese, Bacon, Fabric              | 60 s  |
| 3     | Cake, Pizza, Blue Sweater, Lobster Bisque | 120 s |

Speed boost reduces harvest time by up to 25% (`MAX_HARVEST_BOOST = 0.25`).

## Market Pricing (The Economy)

Prices are fully dynamic and recalculate every 30 seconds based on 4 factors:
1. **Treasury Ratio**: Scarcity valve based on how much of the 50M supply cap the Treasury holds.
2. **Demand Multiplier**: Real-time sales vs purchases tracking per commodity.
3. **Token Velocity**: Inflationary pressure based on transaction frequency.
4. **AI Policy Events**: Macro-economic events (Taxes, Subsidies, Crunches).

`sell_price = base_price × treasury_mult × demand_mult × velocity_mult × event_mult`
`buy_price = sell_price × 0.3` (seeds are cheaper than produce)

Real-world commodities (RapidAPI) are used as peg foundations but the in-game economy is isolated and self-balancing based on real player activity.

## Commodity Categories

| Category  | Examples                                 |
| --------- | ---------------------------------------- |
| `crop`    | wheat, corn, potato, watermelon          |
| `animal`  | egg, milk, pork, truffle, raw_wool       |
| `fishing` | sardine, salmon, lobster, pearl          |
| `crafted` | flour, bread, cheese, cake, blue_sweater |

## Crafting Chains

Layer 1 (raw → refined):

```
wheat × 2     → flour
sugarcane × 2 → sugar
sunflower × 2 → cooking_oil
cotton × 1    → thread
milk × 2      → butter
raw_wool × 2  → yarn
```

Layer 2 (refined + raw → goods):

```
flour + egg        → bread
egg × 2 + oil      → mayonnaise
milk × 2 + flour   → cheese
thread × 2         → fabric
fabric × 2         → shirt
```

Layer 3 (premium):

```
flour + egg + sugar + butter         → cake
flour + tomato_paste + cheese        → pizza
yarn × 2 + blue_dye                  → blue_sweater
truffle + cooking_oil                → truffle_oil (special, 1050 coins)
pearl × 2 + thread                   → pearl_necklace (special, 1400 coins)
```

## Database

Run migrations with:

```bash
supabase db push
```

## Scripts

| Command      | Description                |
| ------------ | -------------------------- |
| `pnpm dev`   | Dev server with hot reload |
| `pnpm build` | Compile TypeScript         |
| `pnpm start` | Run compiled output        |

## License

ISC
