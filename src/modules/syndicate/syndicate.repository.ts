import type { Redis } from "ioredis";
import {
  syndicateBankGoldKey,
  syndicateBankItemsKey,
  syndicateChatKey,
  syndicateContributionGoldKey,
  syndicateContributionItemsKey,
  syndicateIdolKey,
  syndicateIndexAllKey,
  syndicateIndexPublicKey,
  syndicateJoinRequestsKey,
  syndicateMemberRolesKey,
  syndicateMembersKey,
  syndicateMemberSeenKey,
  syndicateMetaKey,
  syndicateShieldExpiresAtKey,
  userLevelKey,
} from "../../infrastructure/redis/keys.js";

export class SyndicateRepository {
  async listIds(redis: Redis, includePrivate: boolean): Promise<string[]> {
    const key = includePrivate ? syndicateIndexAllKey() : syndicateIndexPublicKey();
    const ids = await redis.smembers(key);
    return ids ?? [];
  }

  async getMeta(redis: Redis, syndicateId: string): Promise<Record<string, string>> {
    return (await redis.hgetall(syndicateMetaKey(syndicateId))) ?? {};
  }

  async getMemberIds(redis: Redis, syndicateId: string): Promise<string[]> {
    return (await redis.smembers(syndicateMembersKey(syndicateId))) ?? [];
  }

  async getMemberRoles(
    redis: Redis,
    syndicateId: string,
    userIds: string[],
  ): Promise<Record<string, string>> {
    if (userIds.length === 0) return {};
    const res = await redis.hmget(syndicateMemberRolesKey(syndicateId), ...userIds);
    const out: Record<string, string> = {};
    for (let i = 0; i < userIds.length; i++) {
      const v = res[i];
      if (typeof v === "string" && v) out[userIds[i]!] = v;
    }
    return out;
  }

  async getMemberSeen(
    redis: Redis,
    syndicateId: string,
    userIds: string[],
  ): Promise<Record<string, number>> {
    if (userIds.length === 0) return {};
    const res = await redis.hmget(syndicateMemberSeenKey(syndicateId), ...userIds);
    const out: Record<string, number> = {};
    for (let i = 0; i < userIds.length; i++) {
      const n = Number(res[i]);
      out[userIds[i]!] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    }
    return out;
  }

  async getMemberLevels(redis: Redis, userIds: string[]): Promise<Record<string, number>> {
    if (userIds.length === 0) return {};
    const pipe = redis.multi();
    for (const uid of userIds) {
      pipe.hget(userLevelKey(uid), "level");
    }
    const res = await pipe.exec();
    const out: Record<string, number> = {};
    for (let i = 0; i < userIds.length; i++) {
      const raw = res?.[i]?.[1];
      const n = Number(raw);
      out[userIds[i]!] = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    }
    return out;
  }

  async bankGold(redis: Redis, syndicateId: string): Promise<number> {
    const raw = await redis.get(syndicateBankGoldKey(syndicateId));
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  async bankItems(redis: Redis, syndicateId: string): Promise<Record<string, number>> {
    const raw = await redis.hgetall(syndicateBankItemsKey(syndicateId));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
    }
    return out;
  }

  async shieldExpiresAtMs(redis: Redis, syndicateId: string): Promise<number> {
    const raw = await redis.get(syndicateShieldExpiresAtKey(syndicateId));
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  async idolLevel(redis: Redis, syndicateId: string): Promise<number> {
    const raw = await redis.hget(syndicateIdolKey(syndicateId), "level");
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  async joinRequests(redis: Redis, syndicateId: string): Promise<string[]> {
    return (await redis.smembers(syndicateJoinRequestsKey(syndicateId))) ?? [];
  }

  async memberContributionGold(
    redis: Redis,
    syndicateId: string,
    userId: string,
  ): Promise<number> {
    const raw = await redis.hget(syndicateContributionGoldKey(syndicateId), userId);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  async memberContributionItems(
    redis: Redis,
    syndicateId: string,
    userId: string,
  ): Promise<Record<string, number>> {
    // Stored as "userId|itemId" -> qty
    const raw = await redis.hgetall(syndicateContributionItemsKey(syndicateId));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (!k.startsWith(`${userId}|`)) continue;
      const itemId = k.slice(userId.length + 1);
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[itemId] = Math.floor(n);
    }
    return out;
  }

  async chatRecent(redis: Redis, syndicateId: string, limit: number): Promise<string[]> {
    const n = Math.max(1, Math.min(500, limit));
    return (await redis.lrange(syndicateChatKey(syndicateId), -n, -1)) ?? [];
  }
}

