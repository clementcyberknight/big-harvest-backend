/**
 * Big Harvest Backend - Entry point.
 * High-performance WebSocket server with Solana wallet auth.
 */

import "./config/env.js";
import { initProto } from "./ws/proto.js";
import { createWsServer } from "./ws/server.js";

async function main(): Promise<void> {
  await initProto();
  createWsServer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
