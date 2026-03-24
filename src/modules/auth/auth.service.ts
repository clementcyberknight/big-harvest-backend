import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { authChallengeKey } from "../../infrastructure/redis/keys.js";
import { AppError } from "../../shared/errors/appError.js";
import type { ProfileService } from "../profile/profile.service.js";
import { signAccessToken } from "./jwt.js";
import { verifySolanaSignature } from "./solana.js";

export type AuthChallenge = {
  challengeId: string;
  message: string;
};

export type AuthVerifyResult = {
  accessToken: string;
  profile: import("../profile/profile.types.js").FarmerProfile;
  isNewUser: boolean;
};

export class AuthService {
  constructor(
    private readonly redis: Redis,
    private readonly profiles: ProfileService,
  ) {}

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
    }

    const accessToken = signAccessToken(profile.id, walletAddress);
    return { accessToken, profile, isNewUser };
  }
}
