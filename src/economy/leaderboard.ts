import { supabase } from "../db/supabase.js";
import { redis } from "./redis.js";
import { getPlayerBalance } from "../economy/ledger.js";

export class LeaderboardEngine {
  /**
   * Recalculates and updates the player's net worth in the Redis leaderboard.
   * Net worth = Coins + Value of Plots + Value of Animals.
   */
  static async updatePlayerScore(profileId: string) {
    const balance = await getPlayerBalance(profileId);

    // Simplification for performance: we could cache asset values or estimate them based on tiers.
    // For now, let's do a simple count query to estimate asset wealth.
    const { data: plotData } = await supabase
      .from("plots")
      .select("id, tier")
      .eq("owner_id", profileId);
    const { data: animalData } = await supabase
      .from("animals")
      .select("id, animal_type")
      .eq("owner_id", profileId);

    let plotValue = 0;
    if (plotData) {
      plotValue = plotData.reduce((sum, plot) => sum + plot.tier * 2500, 0);
    }

    let animalValue = 0;
    if (animalData) {
      animalValue = animalData.length * 1000;
    }

    const netWorth = balance + plotValue + animalValue;

    await redis.zAdd("leaderboard", [{ score: netWorth, value: profileId }]);
  }

  static async getTopPlayers(limit = 10) {
    const parsedTop = await redis.zRangeWithScores(
      "leaderboard",
      0,
      limit - 1,
      { REV: true },
    );

    if (parsedTop.length === 0) return [];

    // Resolve profile IDs to usernames/wallets
    const profileIds = parsedTop.map((t) => t.value);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, wallet_address")
      .in("id", profileIds);

    const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);

    return parsedTop.map((t, idx) => ({
      rank: idx + 1,
      profile_id: t.value,
      username: profileMap.get(t.value)?.username || "Unknown Farmer",
      wallet: profileMap.get(t.value)?.wallet_address,
      net_worth: t.score,
    }));
  }

  /**
   * Called occasionally to sync the `stats:total_wealth`
   */
  static async recalculateTotalWealth() {
    // Actually redis doesn't have a built-in ZSUM, we can get all scores or estimate based on averages
    // This could just be done differently.
  }

  static async snapshot(year: number, season: string) {
    const top = await this.getTopPlayers(3);
    const { error } = await supabase.from("leaderboard_snapshots").insert({
      year,
      season,
      data: top, // storing JSON
    });
    if (error)
      console.error("[leaderboard] Failed to snapshot leaderboard", error);
  }
}
