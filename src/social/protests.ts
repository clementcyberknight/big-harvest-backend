import { supabase } from "../db/supabase.js";
import { redis } from "../economy/redis.js";
import { TaxEngine } from "../economy/tax.js";
import { SyndicateEngine } from "./syndicates.js";

type AlertCallback = (targetId: string, message: string, level: string) => void;
let globalAlertCb: AlertCallback | null = null;

export class ProtestEngine {
  static setAlertCallback(cb: AlertCallback) {
    globalAlertCb = cb;
  }

  // Hardcoded for now, could be dynamic based on connected users
  static async getActivePlayersCount(): Promise<number> {
    const countStr = await redis.get("stats:active_1h");
    return countStr ? parseInt(countStr, 10) : 10; // min 10
  }

  static async fileProtest(signerId: string, targetWallet: string) {
    // 1. Resolve Target
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("wallet_address", targetWallet)
      .maybeSingle();

    if (!targetProfile) throw new Error("Target player not found");
    const targetId = targetProfile.id;

    if (signerId === targetId) throw new Error("You cannot protest yourself");

    // Anti-Abuse: Can't protest your own syndicate members
    const signerSynd = await SyndicateEngine.getPlayerSyndicate(signerId);
    if (signerSynd) {
      const targetSynd = await SyndicateEngine.getPlayerSyndicate(targetId);
      if (signerSynd === targetSynd) {
        throw new Error("You cannot protest a member of your own syndicate");
      }
    }

    // 2. Check if a protest already exists for this target
    let { data: protest } = await supabase
      .from("protests")
      .select("*")
      .eq("target_id", targetId)
      .eq("status", "pending")
      .maybeSingle();

    if (!protest) {
      // Create new protest
      const activePlayers = await this.getActivePlayersCount();
      const requiredSigners = Math.max(10, Math.floor(activePlayers * 0.1));

      const { data: newProtest, error } = await supabase
        .from("protests")
        .insert({
          target_id: targetId,
          signers: [signerId],
          required: requiredSigners,
          status: "pending",
        })
        .select()
        .single();

      if (error) throw new Error("Failed to create protest petition");
      protest = newProtest;
    } else {
      // Join existing protest
      if (protest.signers.includes(signerId)) {
        throw new Error("You have already signed this protest");
      }

      protest.signers.push(signerId);

      const { data: updated, error } = await supabase
        .from("protests")
        .update({ signers: protest.signers })
        .eq("id", protest.id)
        .select()
        .single();

      if (error) throw new Error("Failed to sign protest");
      protest = updated;
    }

    // 3. Check if threshold reached
    if (protest.signers.length >= protest.required) {
      await this.activateProtest(protest);
      return {
        status: "activated",
        message: "Protest threshold reached! Penalties applied.",
      };
    }

    // Check warning threshold
    const warningThreshold = Math.floor(protest.required * 0.5);
    if (protest.signers.length === warningThreshold) {
      if (globalAlertCb) {
        globalAlertCb(
          targetId,
          "The peasants are revolting! They are gathering signatures against you.",
          "warning",
        );
      }
    }

    return {
      status: "pending",
      message: `Protest signed. ${protest.signers.length}/${protest.required} signatures gathered.`,
    };
  }

  static async getProtestStatus(targetWallet: string) {
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("wallet_address", targetWallet)
      .maybeSingle();

    if (!targetProfile) throw new Error("Target player not found");

    const { data: protest } = await supabase
      .from("protests")
      .select("signers, required, status")
      .eq("target_id", targetProfile.id)
      .in("status", ["pending", "active"])
      .maybeSingle();

    if (!protest) return { status: "none", signer_count: 0, required: 0 };

    return {
      status: protest.status,
      signer_count: protest.signers.length,
      required: protest.required,
    };
  }

  private static async activateProtest(protest: any) {
    // 1. Calculate penalties
    const targetNetWorth = await TaxEngine.getPlayerNetWorth(protest.target_id);
    const avgNetWorth = await TaxEngine.getAverageNetWorth();
    const wealthRatio = avgNetWorth > 0 ? targetNetWorth / avgNetWorth : 1;

    let baseTaxRate = 0.2;
    let garnishRate = Math.min(0.6, baseTaxRate + wealthRatio * 0.05);

    // Convert to massive ONE-TIME FINE (Debt) to prevent offline evasion
    // Fine = 15% of total wealth
    let fineAmount = Math.floor(targetNetWorth * 0.15);

    const treasuryRatio = await TaxEngine.getTreasuryRatio();
    if (treasuryRatio < 0.25) {
      // King is desperate
      garnishRate = Math.min(0.8, garnishRate * 1.5);
      fineAmount = Math.floor(fineAmount * 1.5);
    }

    const reputationPenalty = Math.min(0.4, 0.1 + wealthRatio * 0.03);

    // 2. Save penalties to DB/Redis
    await supabase
      .from("protests")
      .update({
        status: "active",
        tax_rate: garnishRate,
        tribute: fineAmount,
        triggered_at: new Date().toISOString(),
      })
      .eq("id", protest.id);

    // Save active penalty to Redis for fast checks during `sell` operations
    // NO TTL: Stays active until fine is paid off via garnished wages
    const penaltyKey = `penalty:${protest.target_id}:protest_tax`;
    await redis.hSet(penaltyKey, {
      garnish_rate: garnishRate.toString(),
      remaining_fine: fineAmount.toString(),
      reputation_penalty: reputationPenalty.toString(),
    });

    if (globalAlertCb) {
      globalAlertCb(
        protest.target_id,
        "A Royal Decree has been issued against you! Your wages will be garnished until you pay your fine.",
        "critical",
      );
    }
  }
}
