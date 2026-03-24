import { RateLimiterMemory } from "rate-limiter-flexible";
import { WS_RATE_DURATION_MS, WS_RATE_POINTS } from "../../config/constants.js";

/** Shared per-user limit for all WS game actions on this process. */
export const wsActionLimiter = new RateLimiterMemory({
  points: WS_RATE_POINTS,
  duration: Math.max(1, Math.ceil(WS_RATE_DURATION_MS / 1000)),
});
