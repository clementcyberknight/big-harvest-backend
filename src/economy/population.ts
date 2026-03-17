import { redis } from './redis.js';

const ACTIVE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Records that a player is currently online and active.
 * Uses a Redis Sorted Set with the timestamp as the score.
 */
export async function recordPlayerActivity(profileId: string) {
  await redis.zAdd('economy:active_players', [{ score: Date.now(), value: profileId }]);
}

/**
 * Returns the number of unique players active within the last hour.
 * Cleans up expired entries.
 */
export async function getActivePopulation(): Promise<number> {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  // Prune old players
  await redis.zRemRangeByScore('economy:active_players', '-inf', cutoff);
  // Count remaining
  const count = await redis.zCard('economy:active_players');
  // Always return at least 1 to prevent divide-by-zero or zero-scaled economies
  return Math.max(1, count);
}
