/**
 * Big Harvest Backend - Entry point.
 * High-performance WebSocket server with Solana wallet auth.
 *
 * Boot order:
 *   1. Redis connect
 *   2. Treasury init (load balance + epoch from Supabase → Redis)
 *   3. PricingEngine init (load commodity prices from Supabase → Redis)
 *   4. AI Policy engine start (30-min interval)
 *   5. Protobuf schema load
 *   6. WebSocket server start (includes game clock, market engine, sync loops)
 */

import "./config/env.js";
import { initRedis } from "./economy/redis.js";
import { Treasury } from "./economy/treasury.js";
import { PricingEngine } from "./economy/pricing.js";
import { AIPolicyEngine } from "./economy/policy.js";
import { initEpoch } from "./game/clock.js";
import { initProto } from "./ws/proto.js";
import { createWsServer } from "./ws/server.js";

async function main(): Promise<void> {
  console.log("[boot] Connecting to Redis...");
  await initRedis();

  console.log("[boot] Initializing Treasury from DB...");
  await Treasury.init();

  console.log("[boot] Loading persistent game epoch...");
  await initEpoch();

  console.log("[boot] Initializing PricingEngine from DB...");
  await PricingEngine.init();

  console.log("[boot] Starting AI Monetary Policy engine (30-min cycle)...");
  AIPolicyEngine.startEngine();

  console.log("[boot] Loading Protobuf schema...");
  await initProto();

  console.log("[boot] Starting WebSocket server...");
  createWsServer();
}

main().catch((err) => {
  console.error("[boot] Fatal error:", err);
  process.exit(1);
});
