import type { Redis } from "ioredis";
import type { LeaderboardCategory, LeaderboardEntry } from "./leaderboard.types.js";
import { getTopEntries, getMemberRank } from "./leaderboard.repository.js";
import {
  syndicateMetaKey,
  syndicateIndexAllKey,
} from "../../infrastructure/redis/keys.js";

const DEFAULT_LIMIT = 20;

export class LeaderboardService {
  constructor(private readonly redis: Redis) {}

  async getTop(
    category: LeaderboardCategory,
    limit?: number,
  ): Promise<LeaderboardEntry[]> {
    const cap = Math.min(limit ?? DEFAULT_LIMIT, 100);
    const raw = await getTopEntries(this.redis, category, cap);

    const entries: LeaderboardEntry[] = [];
    for (let i = 0; i < raw.length; i++) {
      const e = raw[i]!;
      let name = e.id;

      // Resolve display name
      if (category.startsWith("syndicate_")) {
        const meta = await this.redis.hget(syndicateMetaKey(e.id), "name");
        if (meta) name = meta;
      } else {
        // Player: use profile username if available
        const profile = await this.redis.hget(`ravolo:user:${e.id}:profile`, "username");
        if (profile) name = profile;
      }

      entries.push({
        rank: i + 1,
        id: e.id,
        name,
        score: e.score,
      });
    }

    return entries;
  }

  async getPlayerRank(
    userId: string,
    category: LeaderboardCategory,
  ): Promise<number | null> {
    return getMemberRank(this.redis, category, userId);
  }
}
