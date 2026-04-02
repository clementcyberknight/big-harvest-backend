import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import {
  refreshTokenStorageKey,
  refreshTokenRevokedKey,
  refreshTokenUsedKey,
} from "../../infrastructure/redis/keys.js";

export type RefreshTokenPayload = {
  userId: string;
  walletAddress: string;
  sessionId: string;
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
  usedMarkerTtlSec: number,
): Promise<RefreshTokenPayload | null> {
  const trimmed = rawToken.trim();
  if (trimmed.length < 32) return null;
  const hash = sha256Hex(trimmed);
  const key = refreshTokenStorageKey(hash);
  const usedKey = refreshTokenUsedKey(hash);
  const revokedKey = refreshTokenRevokedKey(hash);

  const revoked = await redis.get(revokedKey);
  if (revoked === "1") return null;
  const val = await redis.getdel(key);
  if (!val) return null;
  // Mark this refresh token hash as already-used so we can detect reuse attempts.
  // NX avoids extending TTL if a concurrent redemption races here.
  await redis.set(usedKey, val, "EX", usedMarkerTtlSec, "NX");
  try {
    const o = JSON.parse(val) as RefreshTokenPayload;
    if (
      typeof o.userId !== "string" ||
      typeof o.walletAddress !== "string" ||
      typeof o.sessionId !== "string"
    ) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

/**
 * Explicitly revoke a refresh token (logout). Best-effort returns the payload if present.
 * Also writes a revocation marker so later use is rejected even if the token key was already gone.
 */
export async function revokeRefreshToken(
  redis: Redis,
  rawToken: string,
  ttlSec: number,
): Promise<RefreshTokenPayload | null> {
  const trimmed = rawToken.trim();
  if (trimmed.length < 32) return null;
  const hash = sha256Hex(trimmed);
  const key = refreshTokenStorageKey(hash);
  const revokedKey = refreshTokenRevokedKey(hash);
  const val = await redis.getdel(key);
  await redis.set(revokedKey, "1", "EX", ttlSec);
  if (!val) return null;
  try {
    const o = JSON.parse(val) as RefreshTokenPayload;
    if (
      typeof o.userId !== "string" ||
      typeof o.walletAddress !== "string" ||
      typeof o.sessionId !== "string"
    ) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export async function readUsedRefreshTokenPayload(
  redis: Redis,
  rawToken: string,
): Promise<RefreshTokenPayload | null> {
  const trimmed = rawToken.trim();
  if (trimmed.length < 32) return null;
  const hash = sha256Hex(trimmed);
  const usedKey = refreshTokenUsedKey(hash);
  const val = await redis.get(usedKey);
  if (!val) return null;
  try {
    const o = JSON.parse(val) as RefreshTokenPayload;
    if (
      typeof o.userId !== "string" ||
      typeof o.walletAddress !== "string" ||
      typeof o.sessionId !== "string"
    ) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}
