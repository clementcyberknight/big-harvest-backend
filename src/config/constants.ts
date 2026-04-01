/** Idempotency key TTL for plant/harvest/trade replays (seconds). */
export const IDEMPOTENCY_TTL_SEC = 86_400;

/** WebSocket action rate limit: points per duration (see handlers). */
export const WS_RATE_POINTS = 20;
export const WS_RATE_DURATION_MS = 1000;

/** Fixed treasury gold pool (integer gold units). No mint/burn beyond accounting moves. */
export const MAX_TREASURY_GOLD_SUPPLY = 100_000_000;

/** New account grant (debited from treasury reserve). */
export const STARTER_GOLD = 250;
export const STARTER_WHEAT_SEEDS = 2;
/** Plot indices granted on first join (4 plots). */
export const STARTER_PLOT_IDS = [0, 1, 2, 3] as const;

/**
 * Plot purchase tiers — each deed unlocks a fixed number of additional plot slots.
 * Plots are numbered sequentially starting from STARTER_PLOT_IDS.length (4).
 * deed_t1 covers plots 4–7, deed_t2 covers plots 8–11, deed_t3 covers plots 12–15.
 */
export const PLOT_DEED_TIERS: Record<
  string,
  { plotsPerDeed: number; maxOwnedPlots: number }
> = {
  "plot:deed_t1": { plotsPerDeed: 1, maxOwnedPlots: 8 },
  "plot:deed_t2": { plotsPerDeed: 1, maxOwnedPlots: 12 },
  "plot:deed_t3": { plotsPerDeed: 1, maxOwnedPlots: 16 },
};

/** Absolute ceiling on plots a single player can ever own. */
export const MAX_PLOTS_PER_USER = 16;

/**
 * Price is stored as micro-gold per 1 unit (1000 micro = 1 gold).
 * Totals: floor(priceMicro * qty / PRICE_MICRO_PER_GOLD) on sell payout, ceil on buy cost.
 */
export const PRICE_MICRO_PER_GOLD = 1000;

/** Dynamic pricing tick (ms). Keep between 5–10s per design. */
export const PRICING_TICK_MS = 7000;

/** Clamp multipliers applied in pricing engine. */
export const PRICE_DEMAND_CLAMP: [number, number] = [0.25, 4];
export const PRICE_SCARCITY_CLAMP: [number, number] = [0.5, 3];
export const PRICE_VOLATILITY_CLAMP: [number, number] = [0.85, 1.35];

/** Proxy "total supply" used in scarcity term (tunable macro constant). */
export const SCARCITY_TOTAL_UNITS = 1_000_000;

/**
 * Market spread factors applied to the "mid" price each pricing tick.
 * Buy price (player pays CBN)       = mid × SPREAD_BUY_FACTOR   (>1 → costs more)
 * Sell price (player receives CBN)  = mid × SPREAD_SELL_FACTOR  (<1 → earns less)
 * This guarantees buy > sell at all times, preventing arbitrage loops.
 */
export const SPREAD_BUY_FACTOR = 1.30;  // player pays 30 % above mid
export const SPREAD_SELL_FACTOR = 0.75; // player receives 25 % below mid

/** Maximum members per syndicate. */
export const MAX_SYNDICATE_MEMBERS = 25;

/** Idol request scheduler tick interval (ms). Every 5 minutes. */
export const IDOL_TICK_MS = 5 * 60 * 1000;

/** Idol request duration (ms). 7 days to fulfill. */
export const IDOL_REQUEST_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Duration of idol blessing (ms). 7 days. */
export const IDOL_BLESS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Duration of idol punishment (ms). 7 days. */
export const IDOL_PUNISH_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Gold penalty deducted from syndicate bank on idol failure. */
export const IDOL_PUNISH_GOLD = 500;
