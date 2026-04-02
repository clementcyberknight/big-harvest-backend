import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { STARTER_GOLD } from "../../config/constants.js";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logger/logger.js";
import { authChallengeKey } from "../../infrastructure/redis/keys.js";
import {
  sessionRevokedKey,
  userSessionSetKey,
} from "../../infrastructure/redis/keys.js";
import { AppError } from "../../shared/errors/appError.js";
import type { ProfileService } from "../profile/profile.service.js";
import type { OnboardingService } from "../onboarding/onboarding.service.js";
import { signAccessToken } from "./jwt.js";
import {
  mintRefreshToken,
  readUsedRefreshTokenPayload,
  redeemRefreshToken,
  revokeRefreshToken,
} from "./refreshToken.redis.js";
import { verifySolanaSignature } from "./solana.js";

export type AuthChallenge = {
  challengeId: string;
  message: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  profile: import("../profile/profile.types.js").FarmerProfile;
};

export type AuthVerifyResult = AuthSession & {
  isNewUser: boolean;
};

export class AuthService {
  private readonly refreshTtlSec: number;

  constructor(
    private readonly redis: Redis,
    private readonly profiles: ProfileService,
    private readonly onboarding: OnboardingService,
  ) {
    this.refreshTtlSec = env.REFRESH_TOKEN_TTL_DAYS * 86_400;
  }

  async createChallenge(): Promise<AuthChallenge> {
    const challengeId = randomUUID();
    const message = [
      "Sign in to Ravolo",
      "",
      `Challenge: ${challengeId}`,
      `Time: ${new Date().toISOString()}`,
    ].join("\n");

    await this.redis.set(
      authChallengeKey(challengeId),
      message,
      "EX",
      env.AUTH_CHALLENGE_TTL_SEC,
    );

    return { challengeId, message };
  }

  async verifyChallengeAndUpsertProfile(
    walletAddress: string,
    signatureBase58: string,
    challengeId: string,
  ): Promise<AuthVerifyResult> {
    const key = authChallengeKey(challengeId);
    const message = await this.redis.get(key);
    if (!message) {
      throw new AppError(
        "CHALLENGE_EXPIRED",
        "Challenge missing or expired; request a new one",
      );
    }

    const ok = verifySolanaSignature(message, signatureBase58, walletAddress);
    if (!ok) {
      throw new AppError("INVALID_SIGNATURE", "Signature verification failed");
    }

    await this.redis.del(key);

    let isNewUser = false;
    let profile = await this.profiles.findByWallet(walletAddress);
    if (!profile) {
      profile = await this.profiles.createFarmerProfile(walletAddress);
      isNewUser = true;
      await this.onboarding.ensureOnboarded(profile.id);
      logger.info(
        {
          userId: profile.id,
          walletAddress,
          username: profile.username,
          achievements: profile.achievements,
          starterGold: 250,
          starterPlots: 4,
          starterSeeds: { "seed:wheat": 2 },
        },
        "new user created — starter rewards granted",
      );
    }

    const sessionId = randomUUID();
    const accessToken = signAccessToken(profile.id, walletAddress, sessionId);
    const refreshToken = await mintRefreshToken(
      this.redis,
      { userId: profile.id, walletAddress, sessionId },
      this.refreshTtlSec,
    );
    // Track active sessions for mass revocation on refresh token reuse.
    // Best-effort: if this fails, auth still works; we just can't revoke all sessions later.
    try {
      const setKey = userSessionSetKey(profile.id);
      await this.redis
        .multi()
        .sadd(setKey, sessionId)
        .expire(setKey, this.refreshTtlSec)
        .exec();
    } catch (err) {
      logger.warn({ err, userId: profile.id }, "failed to track user session id");
    }
    return { accessToken, refreshToken, profile, isNewUser };
  }

  /**
   * Rotates refresh token (GETDEL old, mint new). Call when access JWT expires.
   */
  async refreshSession(refreshTokenRaw: string): Promise<AuthSession> {
    const session = await redeemRefreshToken(
      this.redis,
      refreshTokenRaw,
      this.refreshTtlSec,
    );
    if (!session) {
      const used = await readUsedRefreshTokenPayload(this.redis, refreshTokenRaw);
      if (used) {
        logger.warn(
          { userId: used.userId, sessionId: used.sessionId },
          "token_reuse_detected",
        );
        await this.revokeAllUserSessions(used.userId);
        throw new AppError(
          "TOKEN_REUSE_DETECTED",
          "Refresh token reuse detected; please sign in again",
        );
      }
      throw new AppError(
        "INVALID_REFRESH_TOKEN",
        "Invalid or expired refresh token",
      );
    }

    const profile = await this.profiles.findById(session.userId);
    if (!profile || profile.walletAddress !== session.walletAddress) {
      throw new AppError("INVALID_REFRESH_TOKEN", "Session no longer valid");
    }

    const revoked = await this.isSessionRevoked(session.sessionId);
    if (revoked) {
      throw new AppError(
        "INVALID_REFRESH_TOKEN",
        "Session revoked; please sign in again",
      );
    }

    const accessToken = signAccessToken(
      profile.id,
      profile.walletAddress,
      session.sessionId,
    );
    const refreshToken = await mintRefreshToken(
      this.redis,
      {
        userId: profile.id,
        walletAddress: profile.walletAddress,
        sessionId: session.sessionId,
      },
      this.refreshTtlSec,
    );

    return { accessToken, refreshToken, profile };
  }

  /** Revokes refresh token (e.g. logout). Idempotent. */
  async revokeRefreshToken(refreshTokenRaw: string): Promise<void> {
    const session = await revokeRefreshToken(
      this.redis,
      refreshTokenRaw,
      this.refreshTtlSec,
    );
    if (!session) return;
    await this.revokeSession(session.sessionId);
    try {
      await this.redis.srem(userSessionSetKey(session.userId), session.sessionId);
    } catch (err) {
      logger.warn(
        { err, userId: session.userId, sessionId: session.sessionId },
        "failed to remove session id from set",
      );
    }
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    const v = await this.redis.get(sessionRevokedKey(sessionId));
    return v === "1";
  }

  private async revokeSession(sessionId: string): Promise<void> {
    await this.redis.set(sessionRevokedKey(sessionId), "1", "EX", this.refreshTtlSec);
  }

  private async revokeAllUserSessions(userId: string): Promise<void> {
    const setKey = userSessionSetKey(userId);
    let sessionIds: string[] = [];
    try {
      sessionIds = await this.redis.smembers(setKey);
    } catch (err) {
      logger.warn({ err, userId }, "failed to list user session ids for revocation");
    }

    if (sessionIds.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const sid of sessionIds) {
        pipeline.set(sessionRevokedKey(sid), "1", "EX", this.refreshTtlSec);
      }
      pipeline.del(setKey);
      await pipeline.exec();
      return;
    }

    // If we have no tracked sessions, best-effort revoke just means clearing the set.
    await this.redis.del(setKey);
  }
}
