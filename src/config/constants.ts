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

/** Proxy “total supply” used in scarcity term (tunable macro constant). */
export const SCARCITY_TOTAL_UNITS = 1_000_000;
