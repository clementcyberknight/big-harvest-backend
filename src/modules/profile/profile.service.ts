import { generateUsername } from "unique-username-generator";
import { ACHIEVEMENT_NEW_PLAYER } from "../../config/achievements.js";
import { getSupabase } from "../../infrastructure/supabase/client.js";
import { AppError } from "../../shared/errors/appError.js";
import type { FarmerProfile } from "./profile.types.js";

export class ProfileService {
  private readonly supabase = getSupabase();

  async findByWallet(walletAddress: string): Promise<FarmerProfile | null> {
    const { data: profile, error } = await this.supabase
      .from("profiles")
      .select("id, wallet_address, username, created_at")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (error) throw new AppError("DATABASE", error.message);
    if (!profile) return null;

    const achievements = await this.listAchievements(profile.id);
    return this.mapRow(profile, achievements);
  }

  async findById(userId: string): Promise<FarmerProfile | null> {
    const { data: profile, error } = await this.supabase
      .from("profiles")
      .select("id, wallet_address, username, created_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw new AppError("DATABASE", error.message);
    if (!profile) return null;

    const achievements = await this.listAchievements(profile.id);
    return this.mapRow(profile, achievements);
  }

  /**
   * Creates profile + new_player achievement. Username collisions retry with fresh generator output.
   */
  async createFarmerProfile(walletAddress: string): Promise<FarmerProfile> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const username = generateUsername("-", 0, 20);
      const { data: inserted, error } = await this.supabase
        .from("profiles")
        .insert({
          wallet_address: walletAddress,
          username,
        })
        .select("id, wallet_address, username, created_at")
        .single();

      if (error) {
        if (error.code === "23505") continue;
        throw new AppError("DATABASE", error.message);
      }

      const { error: achErr } = await this.supabase
        .from("user_achievements")
        .insert({
          user_id: inserted.id,
          achievement_key: ACHIEVEMENT_NEW_PLAYER,
        });

      if (achErr) {
        await this.supabase.from("profiles").delete().eq("id", inserted.id);
        throw new AppError("DATABASE", achErr.message);
      }

      return this.mapRow(inserted, [ACHIEVEMENT_NEW_PLAYER]);
    }

    throw new AppError(
      "USERNAME_COLLISION",
      "Could not allocate a unique username; try again",
    );
  }

  async updateUsername(userId: string, username: string): Promise<FarmerProfile> {
    const { data, error } = await this.supabase
      .from("profiles")
      .update({ username, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id, wallet_address, username, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new AppError("USERNAME_TAKEN", "That username is already taken");
      }
      throw new AppError("DATABASE", error.message);
    }

    const achievements = await this.listAchievements(data.id);
    return this.mapRow(data, achievements);
  }

  private async listAchievements(userId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("user_achievements")
      .select("achievement_key")
      .eq("user_id", userId);

    if (error) throw new AppError("DATABASE", error.message);
    return (data ?? []).map((r) => r.achievement_key as string);
  }

  private mapRow(
    row: {
      id: string;
      wallet_address: string;
      username: string;
      created_at: string;
    },
    achievements: string[],
  ): FarmerProfile {
    return {
      id: row.id,
      walletAddress: row.wallet_address,
      username: row.username,
      createdAt: row.created_at,
      achievements,
    };
  }
}
