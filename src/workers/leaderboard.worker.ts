import type { Redis } from "ioredis";
import { logger } from "../infrastructure/logger/logger.js";
import {
  syndicateIndexAllKey,
  inventoryKey,
  walletKey,
  syndicateBankGoldKey,
  syndicateBankItemsKey,
} from "../infrastructure/redis/keys.js";
import {
  updateScore,
  resetCategory,
} from "../modules/leaderboard/leaderboard.repository.js";
import { unitCollateralGold } from "../modules/economy/referencePrices.js";
import type { LeaderboardCategory } from "../modules/leaderboard/leaderboard.types.js";

const LEADERBOARD_TICK_MS = 5 * 60 * 1000; // 5 minutes
const LAST_RESET_KEY = "ravolo:lb:last_reset_week";

async function computePlayerNetWorth(
  redis: Redis,
  userId: string,
): Promise<number> {
  let netWorth = Number(await redis.hget(walletKey(userId), "gold")) || 0;

  const inv = await redis.hgetall(inventoryKey(userId));
  for (const [item, qtyStr] of Object.entries(inv)) {
    const qty = Number(qtyStr) || 0;
    if (qty > 0) {
      netWorth += qty * unitCollateralGold(item);
    }
  }
  return netWorth;
}

async function updatePlayerLeaderboards(redis: Redis) {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      "ravolo:{*}:wallet",
      "COUNT",
      100,
    );
    cursor = nextCursor;

    for (const k of keys) {
      const match = k.match(/^ravolo:\{(.+)\}:wallet$/);
      if (!match) continue;
      const userId = match[1];

      const gold = Number(await redis.hget(k, "gold")) || 0;
      const netWorth = await computePlayerNetWorth(redis, userId);

      await updateScore(redis, "player_gold", userId, gold);
      await updateScore(redis, "player_networth", userId, netWorth);
    }
  } while (cursor !== "0");
}

async function updateSyndicateLeaderboards(redis: Redis) {
  const syndicates = await redis.smembers(syndicateIndexAllKey());

  for (const sid of syndicates) {
    const gold = Number(await redis.get(syndicateBankGoldKey(sid))) || 0;

    let commodityValue = 0;
    const inv = await redis.hgetall(syndicateBankItemsKey(sid));
    for (const [item, qtyStr] of Object.entries(inv)) {
      const qty = Number(qtyStr) || 0;
      if (qty > 0) {
        commodityValue += qty * unitCollateralGold(item);
      }
    }

    await updateScore(redis, "syndicate_gold", sid, gold);
    await updateScore(redis, "syndicate_commodity_value", sid, commodityValue);
  }
}

function getCurrentWeekId(): string {
  const curr = new Date();
  curr.setUTCHours(0, 0, 0, 0);
  const day = curr.getUTCDay();
  const diff = curr.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
  const monday = new Date(curr.setUTCDate(diff));
  return `${monday.getUTCFullYear()}-W${Math.ceil((monday.getUTCDate() + 6) / 7)}`;
}

async function handleWeeklyReset(redis: Redis) {
  const currentWeek = getCurrentWeekId();
  const lastReset = await redis.get(LAST_RESET_KEY);

  if (lastReset !== currentWeek) {
    logger.info({ currentWeek }, "[leaderboard] Performing weekly reset");
    const categories: LeaderboardCategory[] = [
      "player_gold",
      "player_networth",
      "syndicate_gold",
      "syndicate_commodity_value",
    ];
    for (const c of categories) {
      await resetCategory(redis, c);
    }
    await redis.set(LAST_RESET_KEY, currentWeek);
  }
}

export async function runLeaderboardTick(redis: Redis): Promise<void> {
  try {
    await handleWeeklyReset(redis);
    await updateSyndicateLeaderboards(redis);
    await updatePlayerLeaderboards(redis);
  } catch (err) {
    logger.error({ err }, "[leaderboard] Tick failed");
  }
}

export function startLeaderboardLoop(redis: Redis): () => void {
  const tick = () => {
    void runLeaderboardTick(redis);
  };
  setTimeout(tick, 15_000);
  const id = setInterval(tick, LEADERBOARD_TICK_MS);
  return () => clearInterval(id);
}
