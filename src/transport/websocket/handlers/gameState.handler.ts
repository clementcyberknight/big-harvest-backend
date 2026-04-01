import type { WebSocket } from "uWebSockets.js";
import type { Redis } from "ioredis";
import { logger } from "../../../infrastructure/logger/logger.js";
import { sendGameMessage as send } from "../ws.codec.js";
import type { WsUserData } from "../ws.types.js";
import {
  walletKey,
  inventoryKey,
  inventoryLockedKey,
  ownedPlotsKey,
  plotKey,
  animalStateKey,
  craftPendingKey,
  loanActiveKey,
  userLevelKey,
  userSyndicateIdKey,
} from "../../../infrastructure/redis/keys.js";
import { serverNowMs } from "../../../shared/utils/time.js";

/**
 * GET_GAME_STATE — returns the full snapshot of the authenticated player's state.
 * No payload required. All Redis reads are issued in parallel.
 *
 * Response type: GAME_STATE_OK
 * Fields:
 *   gold           — wallet gold balance (integer)
 *   level          — player level (integer)
 *   inventory      — { [item]: quantity } free inventory
 *   lockedInv      — { [item]: quantity } inventory locked as loan collateral
 *   plots          — array of plot state objects (plotId, cropId, plantedAtMs, readyAtMs, status)
 *   animal         — raw animal state hash (null if not yet set up)
 *   craftPending   — active craft job (null if none), with readyAtMs for countdown
 *   activeLoanId   — loanId string if loan is active, null otherwise
 *   syndicateId    — syndicateId string if in a syndicate, null otherwise
 *   serverNowMs    — server timestamp so client can compute timers without drift
 */
export async function handleGetGameState(
  ws: WebSocket<WsUserData>,
  redis: Redis,
): Promise<void> {
  const { userId } = ws.getUserData();

  try {
    // ── Fetch everything in parallel ──────────────────────────────────────────
    const [
      walletRaw,
      levelRaw,
      invRaw,
      invLockedRaw,
      plotIds,
      animalRaw,
      craftRaw,
      activeLoanId,
      syndicateId,
    ] = await Promise.all([
      redis.hgetall(walletKey(userId)),
      redis.get(userLevelKey(userId)),
      redis.hgetall(inventoryKey(userId)),
      redis.hgetall(inventoryLockedKey(userId)),
      redis.smembers(ownedPlotsKey(userId)),
      redis.hgetall(animalStateKey(userId)),
      redis.hgetall(craftPendingKey(userId)),
      redis.get(loanActiveKey(userId)),
      redis.get(userSyndicateIdKey(userId)),
    ]);

    // ── Parse wallet ──────────────────────────────────────────────────────────
    // The Lua treasury scripts store gold as whole gold units (not micro-gold).
    // HINCRBY KEYS[walletKey] 'gold' pay — where pay = sellPayoutGold() in whole gold.
    // Do NOT divide by PRICE_MICRO_PER_GOLD here.
    const gold = Math.max(0, Math.floor(Number(walletRaw?.gold ?? 0)));

    // ── Parse level ───────────────────────────────────────────────────────────
    const level = Number(levelRaw ?? 1);

    // ── Parse inventories (convert string values to numbers) ──────────────────
    const inventory: Record<string, number> = {};
    for (const [k, v] of Object.entries(invRaw ?? {})) {
      const n = Number(v);
      if (n > 0) inventory[k] = n;
    }

    const lockedInv: Record<string, number> = {};
    for (const [k, v] of Object.entries(invLockedRaw ?? {})) {
      const n = Number(v);
      if (n > 0) lockedInv[k] = n;
    }

    // ── Fetch individual plot state in parallel ───────────────────────────────
    const now = serverNowMs();
    const plots = await Promise.all(
      plotIds.map(async (id) => {
        const state = await redis.hgetall(plotKey(userId, Number(id)));
        const readyAtMs = Number(state.readyAtMs ?? 0);
        const plantedAtMs = Number(state.plantedAtMs ?? 0);

        let status: "empty" | "growing" | "ready";
        if (!state.cropId) {
          status = "empty";
        } else if (readyAtMs > 0 && now >= readyAtMs) {
          status = "ready";
        } else {
          status = "growing";
        }

        return {
          plotId: Number(id),
          cropId: state.cropId ?? null,
          plantedAtMs: plantedAtMs || null,
          readyAtMs: readyAtMs || null,
          msUntilReady: status === "growing" ? Math.max(0, readyAtMs - now) : null,
          status,
        };
      }),
    );

    // Sort plots by plotId ascending for stable ordering
    plots.sort((a, b) => a.plotId - b.plotId);

    // ── Parse animal state ────────────────────────────────────────────────────
    const animal =
      Object.keys(animalRaw ?? {}).length > 0
        ? animalRaw
        : null;

    // ── Parse craft pending (HASH: pendingId, outputItem, outputQty, readyAtMs) ──
    let craftPending: Record<string, string | number> | null = null;
    if (Object.keys(craftRaw ?? {}).length > 0 && craftRaw.readyAtMs) {
      const craftReadyAtMs = Number(craftRaw.readyAtMs);
      craftPending = {
        pendingId: craftRaw.pendingId ?? "",
        outputItem: craftRaw.outputItem ?? "",
        outputQty: Number(craftRaw.outputQty ?? 0),
        readyAtMs: craftReadyAtMs,
        msUntilReady: Math.max(0, craftReadyAtMs - now),
        status: now >= craftReadyAtMs ? "ready" : "crafting",
      };
    }

    send(ws, {
      type: "GAME_STATE_OK",
      data: {
        gold,
        level,
        inventory,
        lockedInv,
        plots,
        animal,
        craftPending,
        activeLoanId: activeLoanId ?? null,
        syndicateId: syndicateId ?? null,
        serverNowMs: now,
      },
    });
  } catch (e) {
    logger.error({ err: e, userId }, "game state fetch failed");
    send(ws, {
      type: "ERROR",
      code: "INTERNAL",
      message: "Failed to load game state",
    });
  }
}
