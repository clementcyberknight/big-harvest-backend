import type { Redis } from "ioredis";
import {
  IDOL_TICK_MS,
  IDOL_REQUEST_DURATION_MS,
  IDOL_PUNISH_GOLD,
  IDOL_BLESS_DURATION_MS,
  IDOL_PUNISH_DURATION_MS,
} from "../config/constants.js";
import { logger } from "../infrastructure/logger/logger.js";
import {
  syndicateIndexAllKey,
  syndicateIdolKey,
  syndicateIdolRequestKey,
  treasurySellFlowKey,
} from "../infrastructure/redis/keys.js";
import { PRICED_ITEM_IDS } from "../modules/market/market.catalog.js";
import { serverNowMs } from "../shared/utils/time.js";
import { broadcastToSyndicate } from "../transport/websocket/ws.server.js";
import crypto from "node:crypto";

function getHighestCirculationItem(sellFlows: (string | null)[]): string {
  let bestItem = "wheat"; // Default fallback
  let maxFlow = -1;

  for (let i = 0; i < PRICED_ITEM_IDS.length; i++) {
    const item = PRICED_ITEM_IDS[i]!;
    if (item === "wheat") continue; // prefer non-wheat if possible
    const flow = Number(sellFlows[i]) || 0;
    if (flow > maxFlow) {
      maxFlow = flow;
      bestItem = item;
    }
  }
  return bestItem;
}

export async function runIdolRequestTick(redis: Redis): Promise<void> {
  const now = serverNowMs();

  // 1. Get all syndicates
  const syndicates = await redis.smembers(syndicateIndexAllKey());
  if (!syndicates.length) return;

  // 2. Fetch market data once for all to determine high-circulation commodity
  const pipe = redis.multi();
  for (const id of PRICED_ITEM_IDS) {
    pipe.hget(treasurySellFlowKey(), id);
  }
  const sellFlows = (await pipe.exec())?.map((r) => r?.[1] as string | null) ?? [];
  const targetCommodity = getHighestCirculationItem(sellFlows);

  // 3. Process each syndicate
  for (const sid of syndicates) {
    const idolK = syndicateIdolKey(sid);
    const idolData = await redis.hgetall(idolK);
    const level = Number(idolData.level) || 1;
    const currentReqKey = idolData.currentRequestKey;

    if (!currentReqKey) {
      // Generate new request
      const reqKey = crypto.randomUUID();
      // Increased base amount by ~15x since they now have a full week (168 hours) instead of 24h
      const scaledAmount = Math.floor(1500 * Math.pow(1.5, level - 1));
      const deadline = now + IDOL_REQUEST_DURATION_MS;

      const w = redis.multi();
      w.hset(
        syndicateIdolRequestKey(sid, reqKey),
        "itemId",
        targetCommodity,
        "required",
        String(scaledAmount),
        "progress",
        "0",
        "deadlineMs",
        String(deadline),
      );
      w.hset(idolK, "currentRequestKey", reqKey);
      await w.exec();

      broadcastToSyndicate(sid, {
        type: "SYNDICATE_IDOL_EVENT",
        data: {
          event: "NEW_REQUEST",
          item: targetCommodity,
          amount: scaledAmount,
          deadlineMs: deadline,
        },
      });
      continue;
    }

    // Check existing request
    const reqData = await redis.hgetall(syndicateIdolRequestKey(sid, currentReqKey));
    if (!reqData.deadlineMs) continue;

    const deadline = Number(reqData.deadlineMs);
    if (now >= deadline) {
      const progress = Number(reqData.progress) || 0;
      const required = Number(reqData.required) || 1;
      const w = redis.multi();

      if (progress >= required) {
        // BLESSED
        const nextLevel = level + 1;
        w.hset(
          idolK,
          "level",
          String(nextLevel),
          "status",
          "blessed",
          "blessedUntilMs",
          String(now + IDOL_BLESS_DURATION_MS),
        );
        w.hdel(idolK, "currentRequestKey");

        broadcastToSyndicate(sid, {
          type: "SYNDICATE_IDOL_EVENT",
          data: {
            event: "BLESSED",
            level: nextLevel,
            untilMs: now + IDOL_BLESS_DURATION_MS,
          },
        });
      } else {
        // PUNISHED
        w.hset(
          idolK,
          "status",
          "punished",
          "punishedUntilMs",
          String(now + IDOL_PUNISH_DURATION_MS),
        );
        w.hdel(idolK, "currentRequestKey");
        // Deduct gold penalty
        w.decrby(`ravolo:syndicate:${sid}:bank_gold`, IDOL_PUNISH_GOLD);

        broadcastToSyndicate(sid, {
          type: "SYNDICATE_IDOL_EVENT",
          data: {
            event: "PUNISHED",
            penaltyGold: IDOL_PUNISH_GOLD,
            untilMs: now + IDOL_PUNISH_DURATION_MS,
            disease: true,
          },
        });
      }
      await w.exec();
    }
  }
}

export function startIdolRequestLoop(redis: Redis): () => void {
  const tick = () => {
    void runIdolRequestTick(redis).catch((err) => {
      logger.error({ err }, "idol request tick failed");
    });
  };
  // Wait a bit before first tick so HTTP/WS server can boot
  setTimeout(tick, 5000);
  const id = setInterval(tick, IDOL_TICK_MS);
  return () => clearInterval(id);
}
