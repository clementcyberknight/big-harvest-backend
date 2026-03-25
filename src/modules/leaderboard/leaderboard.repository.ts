import type { Redis } from "ioredis";
import type { LeaderboardCategory, LeaderboardEntry } from "./leaderboard.types.js";

// ── Redis key helpers ────────────────────────────────────────────────────────

function lbKey(category: LeaderboardCategory): string {
  return `ravolo:lb:${category}`;
}

// ── Repository ───────────────────────────────────────────────────────────────

export async function updateScore(
  redis: Redis,
  category: LeaderboardCategory,
  memberId: string,
  score: number,
): Promise<void> {
  await redis.zadd(lbKey(category), String(score), memberId);
}

export async function getTopEntries(
  redis: Redis,
  category: LeaderboardCategory,
  limit: number,
): Promise<Array<{ id: string; score: number }>> {
  const raw = await redis.zrevrange(lbKey(category), 0, limit - 1, "WITHSCORES");
  const entries: Array<{ id: string; score: number }> = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({ id: raw[i]!, score: Number(raw[i + 1]) });
  }
  return entries;
}

export async function getMemberRank(
  redis: Redis,
  category: LeaderboardCategory,
  memberId: string,
): Promise<number | null> {
  const rank = await redis.zrevrank(lbKey(category), memberId);
  return rank !== null ? rank + 1 : null;
}

export async function resetCategory(
  redis: Redis,
  category: LeaderboardCategory,
): Promise<void> {
  await redis.del(lbKey(category));
}
