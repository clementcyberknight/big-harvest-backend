# Big Harvest — Frontend Integration Guide

This document explains how the frontend should connect to and interact with the Big Harvest WebSocket backend.

## 1. WebSocket Connection & Authentication

The backend is entirely WebSocket-driven (`ws://<server>/ws`). Authentication uses Solana wallet signatures to instantly log the user in or seamlessly register them with a dynamic sign-up bonus.

**Auth Flow:**
1. Connect to WebSocket.
2. Server immediately sends: `{ type: "auth_challenge", nonce, timestamp, expires_in }`
3. Client prompts the user's wallet to sign the message: `"${nonce}:${timestamp}"`
4. Client sends:
   ```json
   {
     "type": "auth",
     "public_key": "UserWalletAddress...",
     "signature": "SignedMessageHex...",
     "nonce": "...",
     "timestamp": 1234567890
   }
   ```
5. Server replies with `{ type: "auth_success", access_token, refresh_token }`. You can use `access_token` for future reconnections using `{ type: "auth", session_token: "..." }`.

**Heartbeat:**
You must send `{ type: "heartbeat" }` periodically to keep the connection alive. The server will reply with `{ type: "heartbeat_ack", payload: { server_time } }`.

---

## 2. Server State Subscriptions

Once authenticated, the server automatically subscribes the client to global, market, and personal topics.

### The Game Clock
The game time determines crop growth. The server broadcasts time updates.
* **1 real minute = 1 game day**
* **1 season = 7 days (7 minutes)**
* **1 year = 4 seasons (28 minutes)**

**Message:**
```json
// Broadcast every 10 seconds (market topic)
{ 
  "type": "game_clock", 
  "payload": { 
    "year": 1, 
    "season": "spring", 
    "season_day": 3, 
    "total_days": 10,
    "next_day_at": 1710600000 
  } 
}
```

### Market Pricing (Dynamic)
Crop prices change every 30 seconds based on supply, demand, transaction velocity, and treasury ratios.

**Messages:**
```json
// Detailed price update broadcast every 30s
{
  "type": "price_update",
  "prices": [
    {
      "id": "wheat",
      "current_buy_price": 10.5,
      "current_sell_price": 35.0,
      "demand_multiplier": 1.12
    }
  ]
}

// Rapid pulse update for real-time tickers
{
  "type": "market_pulse",
  "payload": {
    "wheat": 1.12,
    "corn": 0.95,
    "timestamp": 1710600000
  }
}
```

### Player Balances
Whenever the player earns, spends, or borrows tokens, the server pushes an update:
```json
{ "type": "balance_update", "balance": 1540 }
```

---

## 3. The Farming Loop

Farming relies on `buy_plot`, `buy_seed`, `plant_crop`, [harvest](file:///c:/Users/NCC/Documents/big-harvest-backend/src/game/farming.ts#124-158), and [sell](file:///c:/Users/NCC/Documents/big-harvest-backend/src/game/farming.ts#159-197) commands.

### Buying a Plot
Plots come in three tiers: `starter`, `fertile`, and `premium`.
* **Client:** `{ type: "buy_plot", tier: "starter" }`
* **Success:** `{ type: "plot_update", plot_id: "uuid-...", tier: "starter", ... }`

### Buying Seeds
* **Client:** `{ type: "buy_seed", crop_id: "wheat", qty: 5 }`

### Planting
* **Client:** `{ type: "plant_crop", plot_id: "uuid-...", crop_id: "wheat" }`
* **Success:** `{ type: "plot_update", plot_id: "uuid-...", crop_id: "wheat", planted_at: 1710600000 }`
* **UI Note:** Calculate harvest time locally using `planted_at + growth_time`.

### Harvesting
* **Client:** `{ type: "harvest", plot_id: "uuid-..." }`
* **Success:** `{ type: "action_result", action_type: "harvest", message: "Harvested 2 items (xp: 10)" }`

### Selling Produce
* **Client:** `{ type: "sell", item_id: "wheat", qty: 10 }`
* **Success:** `{ type: "action_result", action_type: "sell", message: "Sold for 350 tokens" }` + `balance_update` event.

---

## 4. Animals & Husbandry

### Buying & Selling Animals
Animals have dynamic prices based on the global economy. 
* **Buy:** `{ type: "buy_animal", animal_type: "chicken" }`
* **Success:** `{ type: "action_result", ... }` + `{ type: "animal_update", ... }` + `balance_update`
* **Sell:** `{ type: "sell_animal", animal_id: "uuid-..." }`
* **Success:** Refunds 50% purchase price + `balance_update`

### Feeding & Collecting
Animals operate on a 10-minute real-world cycle. Collecting requires them to be ready. Feeding an animal consumes 1 `animal_feed` from inventory, but it **doubles** their next output and increases the rare drop chance by 1.5x.
* **Feed:** `{ type: "feed_animal", animal_id: "uuid-..." }`
* **Collect:** `{ type: "collect_animal", animal_id: "uuid-..." }`
* **Success:** `{ type: "action_result", message: "Collected! Rare dropped: true" }` + inventory updates.

### Mating & Reproduction
Animals of the same species can be mated. Mating has a 2-hour cooldown.
* **Client:** `{ type: "mate_animals", sire_id: "uuid-1", dam_id: "uuid-2" }`
* **Birds (e.g. chicken):** Drops a `fertilized_egg_chicken` into your inventory.
* **Mammals (e.g. cow):** Starts a 1-hour gestation period on the mother (`gestation_ready_at` sent in `animal_update`).

### Incubators
To hatch a `fertilized_egg`, players must buy an Incubator machine.
* **Buy Machine:** `{ type: "buy_incubator" }` 
* **Start Hatching:** `{ type: "start_incubation", incubator_id: "uuid-...", egg_item_id: "chicken" }`
* **Finish Hatching:** `{ type: "finish_incubation", incubator_id: "uuid-..." }` (After 30 minutes, drops a new live animal).

---

## 5. Crafting
Crafting takes real-world time (15s to 10m based on tier) and happens on the server.
* **Client:** `{ type: "craft", recipe_id: "bread" }`
* **Server Acknowledges:** `{ type: "action_result", action_type: "craft", message: "... ready at 1710600500" }`
* **Server Completes (Async Push):** `{ type: "craft_complete", item_id: "bread", quantity: 1 }`

---

## 5. The Loan System

Players can borrow tokens using their plots and animals as collateral.

### Rules:
* Max loan is 50% of unlocked collateral value.
* Current interest rate is 10% (15% if the player has defaulted before).
* Repayment window is 1 game year (28 real minutes).
* Assets pledged as collateral are **locked** (cannot be sold or harvested).

### Requesting a Loan
* **Client:** `{ type: "request_loan", amount: 500 }`
* **Success:** `{ type: "loan_result", loan_id: "uuid-...", amount: 500, due_at: 1710616800 }`

### Repaying a Loan
* **Client:** `{ type: "repay_loan", loan_id: "uuid-...", amount: 200 }`

### Defaulting (Seizure)
If the player does not repay the loan + interest by `due_at + grace_period`, the server will **instantly** seize the collateral, delete the assets, and push this event to the client:

```json
{
  "type": "loan_default",
  "seized_assets": [
    { "type": "plot", "id": "uuid-...", "value": 200 }
  ],
  "remaining_debt": 0
}
```

---

## 6. AI Economic Events

The AI controls the economy by parsing metrics every 30 minutes. It can trigger inflation, deflation, taxes, or subsidies.

When an AI policy triggers, the server broadcasts an event:
```json
{
  "type": "game_event",
  "payload": {
    "type": "tax_harvest",
    "description": "Due to treasury shortages, all harvest sales will be taxed 10%."
  }
}
```
*Note: This event should trigger an in-game News UI on the frontend so players know why prices just spiked or crashed.*
