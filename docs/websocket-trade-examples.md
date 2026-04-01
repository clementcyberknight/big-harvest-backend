# WebSocket Trade Examples — Farmer Buy & Sell

The Ravolo backend uses **uWebSockets.js** on the `/ws` endpoint (default port `9001`).
The codec accepts **both** binary MessagePack frames (production) and **UTF-8 JSON text frames**
(dev / tooling), so all examples below use JSON text which works out-of-the-box with `wscat`.

> `curl` does not support WebSocket natively.  
> Install `wscat`: `npm install -g wscat`

---

## 1. Connection

### Production (JWT auth)

```bash
# 1. Obtain a JWT access token from the HTTP auth endpoint first
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 2. Connect — token via Authorization header
wscat --connect "ws://localhost:9001/ws" \
      --header "Authorization: Bearer $TOKEN"

# OR — token via query string (useful when wscat header flags are unavailable)
wscat --connect "ws://localhost:9001/ws?token=$TOKEN"
```

### Development bypass (`AUTH_DEV_BYPASS=true`)

```bash
# userId is passed as a plain query param — no JWT required
wscat --connect "ws://localhost:9001/ws?userId=farmer_001"
```

---

## 2. Message Format

All frames are **JSON text** (UTF-8) with the shape:

```json
{ "type": "<ACTION>", "payload": { ... } }
```

Responses are **always** one of:

| Response `type` | Meaning |
|-----------------|---------|
| `BUY_OK`        | Purchase succeeded |
| `SELL_OK`       | Sale succeeded |
| `ERROR`         | Any failure (see `code`) |
| `GAME_STATUS`   | Broadcast — current prices + active event |
| `GAME_STATE`    | Sent on open — your gold, inventory, plots |

---

## 3. SELL — Farmer sells wheat to the treasury

### Request

```json
{
  "type": "SELL",
  "payload": {
    "item": "wheat",
    "quantity": 50,
    "requestId": "req_sell_wheat_001"
  }
}
```

**Field rules:**
- `item` — inventory field name (string, 1–64 chars)
- `quantity` — positive integer
- `requestId` — idempotency key, 8–128 chars; re-sending the same `requestId` within TTL is a no-op

### Success Response

```json
{
  "type": "SELL_OK",
  "data": {
    "item": "wheat",
    "quantity": 50,
    "goldPaid": 75,
    "priceMicro": 1500000
  }
}
```

**How `goldPaid` is computed:**
```
base sell (reference) = 2 gold  →  2,000,000 micro
dynamic sell price (SPREAD_SELL_FACTOR=0.75 applied by pricing worker)
  → priceMicro ≈ 1,500,000
goldPaid = floor(1,500,000 × 50 / 1,000,000) = floor(75) = 75 gold
```

### Error Responses

**Not enough inventory:**
```json
{
  "type": "ERROR",
  "code": "INSUFFICIENT_INV",
  "message": "Not enough inventory",
  "details": { "item": "wheat", "quantity": 50 }
}
```

**Item cannot be sold to treasury (e.g. a non-sellable item):**
```json
{
  "type": "ERROR",
  "code": "UNKNOWN_ITEM",
  "message": "Item cannot be sold to treasury",
  "details": { "item": "tool:mill" }
}
```

**Treasury reserve depleted (CBN has no gold to pay out):**
```json
{
  "type": "ERROR",
  "code": "TREASURY_DEPLETED",
  "message": "Treasury cannot settle this sale",
  "details": { "item": "wheat" }
}
```

**Rate limited:**
```json
{
  "type": "ERROR",
  "code": "RATE_LIMITED",
  "message": "Too many actions"
}
```

**Invalid payload (missing field / wrong type):**
```json
{
  "type": "ERROR",
  "code": "BAD_REQUEST",
  "message": "Invalid sell payload",
  "details": {
    "issues": [
      {
        "code": "too_small",
        "minimum": 1,
        "type": "number",
        "inclusive": true,
        "message": "Number must be greater than or equal to 1",
        "path": ["quantity"]
      }
    ]
  }
}
```

---

## 4. BUY — Farmer buys wheat seeds from the treasury

### Request

```json
{
  "type": "BUY",
  "payload": {
    "item": "seed:wheat",
    "quantity": 20,
    "requestId": "req_buy_seed_wheat_001"
  }
}
```

### Success Response

```json
{
  "type": "BUY_OK",
  "data": {
    "item": "seed:wheat",
    "quantity": 20,
    "goldSpent": 52,
    "priceMicro": 2600000
  }
}
```

**How `goldSpent` is computed:**
```
base buy (reference) = 2 gold  →  2,000,000 micro
dynamic buy price (SPREAD_BUY_FACTOR=1.30 applied by pricing worker)
  → priceMicro ≈ 2,600,000
goldSpent = ceil(2,600,000 × 20 / 1,000,000) = ceil(52) = 52 gold
```

Notice: `goldSpent` (52 gold to buy seeds) > `goldPaid` (75 gold to sell 50 wheat) — buy
price is always higher per unit than sell price, so there is no risk-free arbitrage.

### Error Responses

**Not enough gold:**
```json
{
  "type": "ERROR",
  "code": "INSUFFICIENT_GOLD",
  "message": "Not enough gold",
  "details": { "item": "seed:wheat", "need": 52 }
}
```

**Item not sold by treasury (produce cannot be bought from CBN):**
```json
{
  "type": "ERROR",
  "code": "UNKNOWN_ITEM",
  "message": "Item not sold by treasury",
  "details": { "item": "wheat" }
}
```

**Level too low:**
```json
{
  "type": "ERROR",
  "code": "ITEM_LOCKED",
  "message": "Level too low for this item",
  "details": { "item": "seed:saffron", "need": 5, "have": 2 }
}
```

**Rate limited:**
```json
{
  "type": "ERROR",
  "code": "RATE_LIMITED",
  "message": "Too many actions"
}
```

**Invalid payload:**
```json
{
  "type": "ERROR",
  "code": "BAD_REQUEST",
  "message": "Invalid buy payload",
  "details": {
    "issues": [
      {
        "code": "too_small",
        "minimum": 8,
        "type": "string",
        "inclusive": true,
        "message": "String must contain at least 8 character(s)",
        "path": ["requestId"]
      }
    ]
  }
}
```

---

## 5. Full wscat Session Example

```
$ wscat --connect "ws://localhost:9001/ws?userId=farmer_001"
Connected (press CTRL+C to quit)

< {"type":"GAME_STATUS","data":{"prices":{"wheat":{"buy":2600000,"sell":1500000},"corn":{"buy":6500000,"sell":3000000},"seed:wheat":{"buy":2600000,"sell":1000000}},"activeEvent":null,"serverNowMs":1712000000000}}
< {"type":"GAME_STATE","data":{"inventory":{"wheat":100,"seed:wheat":5},"gold":300,"plots":[]}}

> {"type":"SELL","payload":{"item":"wheat","quantity":50,"requestId":"req_001"}}
< {"type":"SELL_OK","data":{"item":"wheat","quantity":50,"goldPaid":75,"priceMicro":1500000}}

> {"type":"BUY","payload":{"item":"seed:wheat","quantity":20,"requestId":"req_002"}}
< {"type":"BUY_OK","data":{"item":"seed:wheat","quantity":20,"goldSpent":52,"priceMicro":2600000}}

> {"type":"BUY","payload":{"item":"seed:wheat","quantity":9999,"requestId":"req_003"}}
< {"type":"ERROR","code":"INSUFFICIENT_GOLD","message":"Not enough gold","details":{"item":"seed:wheat","need":25974}}

> {"type":"SELL","payload":{"item":"wheat","quantity":500,"requestId":"req_004"}}
< {"type":"ERROR","code":"INSUFFICIENT_INV","message":"Not enough inventory","details":{"item":"wheat","quantity":500}}
```

---

## 6. Price Spread Reference (baseline before dynamic ticks)

All gold values shown are **approximate at runtime** — the pricing worker applies
demand/scarcity/volatility and spread factors every tick.

| Item | Buy (player pays) | Sell (player receives) | Spread |
|------|:-----------------:|:----------------------:|:------:|
| `seed:wheat` | ~3 gold | ~1 gold | ~3x |
| `wheat` | ~4 gold | ~2 gold | ~2x |
| `corn` | ~7 gold | ~3 gold | ~2.3x |
| `tomato` | ~8 gold | ~4 gold | ~2x |
| `saffron` | ~35 gold | ~18 gold | ~1.9x |
| `seed:saffron` | ~13 gold | ~7 gold | ~1.9x |
| `animal:cow` | ~33 gold | ~18 gold | ~1.8x |
| `tool:mill` | ~78 gold | ~40 gold | ~1.95x |

> During an AI event (e.g. drought) the multiplier shifts both sides of the spread
> simultaneously, so the gap remains intact while absolute prices spike or crash.

---

## 7. Idempotency

Every trade request requires a unique `requestId`. If the same `requestId` is sent again
within the TTL window (default 60 s), the server silently accepts it without double-executing
the trade. Use `requestId` values like `UUIDs` or `timestamp + random` strings to avoid
accidental replay.

```bash
# Generate a suitable requestId in bash
REQUEST_ID="$(date +%s%N)-$(head /dev/urandom | tr -dc 'a-f0-9' | head -c 8)"
```
