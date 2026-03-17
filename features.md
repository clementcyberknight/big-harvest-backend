# Big Harvest MMO - Features for Frontend Integration

This document outlines all the new Addictive MMO features added to the `big-harvest-backend` server, their underlying mechanisms, and the specific WebSocket endpoints the Frontend Dev will need to consume.

## 1. FOMO Mechanics

These mechanics are designed to force players to log in regularly.

### Crop Withering
- **Logic:** Crops have a strict time-to-live. If a crop is ready to harvest, the player has a limited window (e.g. 5 minutes for Starter plots, 10 mins for Premium) to harvest it before it dies.
- **Frontend Action:** When sending `harvest { plot_id }`, check if the response contains `withered: true`.
- **UI Implication:** Display a warning timer over crops that are ready to harvest. If they wither, display a dead plant sprite.

### Animal Sickness (The "Tamagotchi" Effect)
- **Logic:** Animals must be collected/fed every 2.5 minutes. If ignored for 5 cycles (~12.5 mins), they become `sad` and stop producing. If ignored for 20 cycles (~50 mins), they become `sick` and require expensive medicine.
- **Frontend Actions:**
  - `collect_animal { animal_id }`: Server response may include `{ status: "sad" | "sick" }` along with the items.
  - `feed_animal { animal_id }`: Cures "sadness" but **not** sickness.
  - NEW: `cure_animal { animal_id }`: Requires 1 `medicine`. Cures sickness.
- **UI Implication:** Provide visual states for Sad (drooping) and Sick (greenish hue/thermometer). Warn the player they must buy medicine from the store.

### Black Market Trader (Flash Sales)
- **Logic:** Server randomly spawns an NPC every few game days for only 10 minutes. He sells rare/bulk goods at a discount.
- **WS Server Event:** Listen for `{ type: "trader_arrived", items: [...], expires_at: 123456789 }`.
- **Frontend Action:** NEW: `buy_black_market { item_id, qty }`.
- **UI Implication:** Show a pop-up or a character in the corner of the farm when the trader arrives. Display the countdown timer (`expires_at`) aggressively to build urgency.

---

## 2. Social & Economic Warfare

### Player Syndicates (Cartels)
- **Logic:** Decentralized groups up to 50 players. Used to coordinate market manipulations via Group Chat.
- **Frontend Actions:**
  - `create_syndicate { name, description }`
  - `join_syndicate { syndicate_id }`
  - `leave_syndicate {}`
  - `kick_member { profile_id }` // Leader only
  - `send_chat { message }`
- **WS Server Events:** Listen for `{ type: "chat_message", sender_id, content, timestamp }`. *Players are automatically subscribed to their syndicate chat room upon WS Auth.*
- **UI Implication:** A "Syndicate" tab with a real-time chat window and member list.

### Player-to-Player (P2P) Funding
- **Logic:** Players can send coins or inventory items directly to each other's wallets.
- **Frontend Actions:**
  - `transfer_funds { target_wallet, amount }`
  - `transfer_items { target_wallet, item_id, qty }`
- **UI Implication:** Inside the Syndicate member list or player profile, add a "Send Gift" button.

### Farmer Protests (Targeted Tax Decrees)
- **Logic:** If a farmer becomes too rich, players can sign a petition against them. If enough signatures (dynamic, usually ~10% of active players) are met, the King slaps that player with a massive tax penalty and monthly tribute for a full game year (28 mins).
- **Frontend Actions:**
  - `file_protest { target_wallet }`
  - `get_protest_status { target_wallet }`
- **WS Server Event:** Listen for `{ type: "protest_status", target_wallet, status, signer_count, required }`
- **UI Implication:** Allow inspecting another player's profile and clicking "File Petition". Show a progress bar of signatures.

---

## 3. Global Server Systems

### Progressive Wealth Tax & Charitable Donations
- **Logic:** Tax on sales scales from 0% (poor) to 50% (mega-rich). This is calculated dynamically against the server average wealth. Players can donate tokens to lower their tax bracket via "Goodwill Points".
- **Frontend Action:** NEW: `donate_treasury { amount }`.
- **WS Server Event:** Listen for `{ type: "goodwill_update", points, effective_tax_rate }`.
- **UI Implication:** Show effective tax rate on the Market UI. Show a "Donate to King" button to reduce taxes temporarily.

### Live Season Leaderboards
- **Logic:** Redis tracks player net worth (Coins + Plots + Animals) in real-time.
- **WS Server Event:** Listen for `{ type: "leaderboard_update", top: [...] }` broadcast every **10 seconds**.
- **UI Implication:** Display a scrolling ticker or a dedicated Leaderboard modal updating live.

### Global Bounties
- **Logic:** Server triggers a collective goal (e.g. "Deliver 100,000 Wheat in 15 mins"). Everyone who contributes gets a share of the massive payout.
- **Frontend Action:** NEW: `contribute_bounty { item_id, qty }`.
- **WS Server Events:** 
  - `{ type: "bounty_progress", current, target }` broadcast every **5 seconds**.
- **UI Implication:** A giant progress bar at the top of the screen when a bounty is active.

### Player Activity Feed & Commodity Tracker
- **Logic:** The server logs trades, purchases, and alerts for market dumping inside Redis and Supabase.
- **Frontend Action:** NEW: `get_player_activity { target_wallet }`.
- **WS Server Events:** 
  - Listen for `{ type: "player_activity", activities: [...] }`.
  - Listen for `{ type: "commodity_alert", commodity_id, alert: "DUMP_DETECTED" | "HOARD_DETECTED", volume, price_impact }`.
- **UI Implication:** A terminal-style "Activity Log" or notification toast for market alerts (e.g. "🚨 DUMP DETECTED: Beef prices crashing!").
