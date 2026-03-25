import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { refreshTokenStorageKey } from "../../infrastructure/redis/keys.js";

export type RefreshTokenPayload = {
  userId: string;
  walletAddress: string;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function mintRefreshToken(
  redis: Redis,
  payload: RefreshTokenPayload,
  ttlSec: number,
): Promise<string> {
  const raw = randomBytes(48).toString("base64url");
  const key = refreshTokenStorageKey(sha256Hex(raw));
  await redis.set(key, JSON.stringify(payload), "EX", ttlSec);
  return raw;
}

/**
 * Atomically read and delete (Redis 6.2+ GETDEL). Used once per refresh / logout.
 */
export async function redeemRefreshToken(
  redis: Redis,
  rawToken: string,
): Promise<RefreshTokenPayload | null> {
  const trimmed = rawToken.trim();
  if (trimmed.length < 32) return null;
  const key = refreshTokenStorageKey(sha256Hex(trimmed));
  const val = await redis.getdel(key);
  if (!val) return null;
  try {
    const o = JSON.parse(val) as RefreshTokenPayload;
    if (typeof o.userId !== "string" || typeof o.walletAddress !== "string") {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}
