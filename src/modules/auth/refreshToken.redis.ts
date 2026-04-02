import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import {
  refreshTokenStorageKey,
  refreshTokenRevokedKey,
  refreshTokenUsedKey,
} from "../../infrastructure/redis/keys.js";
import { getRedeemRefreshTokenSha } from "../../infrastructure/redis/commands.js";
import { logger } from "../../infrastructure/logger/logger.js";

export type RefreshTokenPayload = {
  userId: string;
  walletAddress: string;
  sessionId: string;
};

/**
 * Structured result from redeemRefreshToken — callers can distinguish
 * between the different failure modes for targeted security responses.
 */
export type RedeemResult =
  | { ok: true; payload: RefreshTokenPayload }
  | { ok: false; reason: "REVOKED" | "REUSED" | "EXPIRED" | "INVALID" };

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parsePayload(val: string): RefreshTokenPayload | null {
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
 * Atomically redeem a refresh token via Lua script (GETDEL + used-marker in
 * one round-trip). Returns a structured result so callers can distinguish
 * REVOKED / REUSED / EXPIRED failures for targeted security responses.
 */
export async function redeemRefreshToken(
  redis: Redis,
  rawToken: string,
  usedMarkerTtlSec: number,
): Promise<RedeemResult> {
  const trimmed = rawToken.trim();
  if (trimmed.length < 32) return { ok: false, reason: "INVALID" };
  const hash = sha256Hex(trimmed);
  const key = refreshTokenStorageKey(hash);
  const usedKey = refreshTokenUsedKey(hash);
  const revokedKey = refreshTokenRevokedKey(hash);

  let result: string;
  try {
    const sha = getRedeemRefreshTokenSha();
    result = (await redis.evalsha(
      sha,
      3,
      key,
      usedKey,
      revokedKey,
      String(usedMarkerTtlSec),
    )) as string;
  } catch (e: unknown) {
    const isNoscript =
      typeof e === "object" &&
      e !== null &&
      "message" in e &&
      typeof (e as { message: unknown }).message === "string" &&
      (e as { message: string }).message.includes("NOSCRIPT");
    if (isNoscript) {
      // Script was evicted from Redis cache — reload all scripts and retry once.
      const { loadRedisScripts } = await import(
        "../../infrastructure/redis/commands.js"
      );
      await loadRedisScripts(redis);
      return redeemRefreshToken(redis, rawToken, usedMarkerTtlSec);
    }
    throw e;
  }

  if (result === "REVOKED") {
    logger.warn({ tokenHash: hash }, "refresh_token_revoked_attempt");
    return { ok: false, reason: "REVOKED" };
  }
  if (result === "USED") {
    logger.warn({ tokenHash: hash }, "refresh_token_reuse_attempt");
    return { ok: false, reason: "REUSED" };
  }
  if (result === "NOTFOUND") {
    return { ok: false, reason: "EXPIRED" };
  }

  const payload = parsePayload(result);
  if (!payload) {
    logger.error({ tokenHash: hash }, "refresh_token_payload_corrupt");
    return { ok: false, reason: "INVALID" };
  }
  return { ok: true, payload };
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
  return parsePayload(val);
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
  return parsePayload(val);
}
