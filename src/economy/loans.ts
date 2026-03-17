import { supabase } from "../db/supabase.js";
import { executeTransfer } from "./ledger.js";
import { PricingEngine } from "./pricing.js";

const MS_PER_GAME_DAY = 60 * 1000;
const REPAYMENT_WINDOW_MS = 365 * MS_PER_GAME_DAY; // 1 Game Year
const GRACE_PERIOD_MS = 2 * MS_PER_GAME_DAY;
const BASE_INTEREST_RATE = 0.10;
const DEFAULTER_INTEREST_RATE = 0.15; // 15% for players who have previously defaulted

interface CollateralItem {
  type: "plot" | "animal";
  id: string;
  value: number;
}

export class LoanSystem {
  /**
   * Called when a player's assets are seized. Wired up in ws/server.ts
   * to send a real-time WebSocket notification to the affected player.
   */
  static onSeizure?: (
    profileId: string,
    seizedAssets: CollateralItem[],
    remainingDebt: number
  ) => void;

  /**
   * Returns the interest rate for a player, accounting for prior defaults.
   */
  private static async getInterestRate(profileId: string): Promise<number> {
    const { data } = await supabase
      .from('profiles')
      .select('has_defaulted')
      .eq('id', profileId)
      .single();

    return data?.has_defaulted ? DEFAULTER_INTEREST_RATE : BASE_INTEREST_RATE;
  }

  /**
   * Calculates the maximum loan a player can take based on 50% of unlocked collateral.
   */
  static async calculateMaxLoan(
    profileId: string,
  ): Promise<{ maxLoan: number; collateral: CollateralItem[] }> {
    let totalValue = 0;
    const collateral: CollateralItem[] = [];

    // Get unlocked plots
    const { data: plots } = await supabase
      .from("plots")
      .select("id, plot_tier")
      .eq("profile_id", profileId)
      .eq("locked_for_loan", false);

    if (plots) {
      for (const plot of plots) {
        // Use live dynamic pricing for plot collateral value
        const val = await PricingEngine.getPlotPrice(plot.plot_tier as any);
        totalValue += val;
        collateral.push({ type: "plot", id: plot.id, value: val });
      }
    }

    // Get unlocked animals
    const { data: animals } = await supabase
      .from("animals")
      .select("id, animal_type")
      .eq("profile_id", profileId)
      .eq("locked_for_loan", false);

    if (animals) {
      for (const animal of animals) {
        // Use live dynamic pricing for animal collateral value
        const val = await PricingEngine.getAnimalPrice(animal.animal_type);
        totalValue += val;
        collateral.push({ type: "animal", id: animal.id, value: val });
      }
    }

    return { maxLoan: Math.floor(totalValue * 0.5), collateral };
  }

  /**
   * Request a new loan.
   */
  static async requestLoan(profileId: string, amount: number) {
    if (amount < 100) throw new Error("Minimum loan is 100 tokens");

    // Check if they already have an active loan
    const { data: existing } = await supabase
      .from("loans")
      .select("id")
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (existing) throw new Error("You already have an active loan");

    const { maxLoan, collateral } = await this.calculateMaxLoan(profileId);
    if (amount > maxLoan)
      throw new Error(`Requested amount exceeds max loan of ${maxLoan}`);

    // We only lock enough collateral to cover the loan amount (at 50% LTV, we need 2x the amount in collateral)
    const requiredCollateralValue = amount * 2;
    let lockedValue = 0;
    const pledged: CollateralItem[] = [];

    // Sort collateral by lowest value first so we lock cheap things first
    collateral.sort((a, b) => a.value - b.value);

    for (const item of collateral) {
      if (lockedValue >= requiredCollateralValue) break;
      pledged.push(item);
      lockedValue += item.value;
    }

    // Lock the assets in the DB
    const plotIds = pledged.filter((p) => p.type === "plot").map((p) => p.id);
    const animalIds = pledged
      .filter((p) => p.type === "animal")
      .map((p) => p.id);

    if (plotIds.length > 0) {
      await supabase
        .from("plots")
        .update({ locked_for_loan: true })
        .in("id", plotIds);
    }
    if (animalIds.length > 0) {
      await supabase
        .from("animals")
        .update({ locked_for_loan: true })
        .in("id", animalIds);
    }

    const now = Date.now();
    const interestRate = await this.getInterestRate(profileId);
    const totalDue = Math.floor(amount * (1 + interestRate));

    // Create loan
    const { data: loan, error } = await supabase
      .from("loans")
      .insert({
        profile_id: profileId,
        principal: amount,
        interest_rate: interestRate,
        total_due: totalDue,
        due_at: now + REPAYMENT_WINDOW_MS,
        grace_until: now + REPAYMENT_WINDOW_MS + GRACE_PERIOD_MS,
        status: "active",
        collateral: pledged,
      })
      .select()
      .single();

    if (error || !loan) {
      // Rollback locks
      if (plotIds.length > 0)
        await supabase
          .from("plots")
          .update({ locked_for_loan: false })
          .in("id", plotIds);
      if (animalIds.length > 0)
        await supabase
          .from("animals")
          .update({ locked_for_loan: false })
          .in("id", animalIds);
      throw new Error("Failed to create loan record");
    }

    // Disburse tokens using double entry in Redis
    const success = await executeTransfer({
      fromType: "treasury",
      fromId: "treasury-singleton",
      toType: "player",
      toId: profileId,
      amount: amount,
      reason: "loan_disbursement",
      metadata: { loanId: loan.id },
    });

    if (!success) {
      // Rollback everything (Edge case: Treasury somehow ran out of tokens)
      await supabase.from("loans").delete().eq("id", loan.id);
      if (plotIds.length > 0)
        await supabase
          .from("plots")
          .update({ locked_for_loan: false })
          .in("id", plotIds);
      if (animalIds.length > 0)
        await supabase
          .from("animals")
          .update({ locked_for_loan: false })
          .in("id", animalIds);
      throw new Error("Treasury could not disburse funds");
    }

    return loan;
  }

  /**
   * Repay a loan. If amount >= totalDue, the loan is closed and assets unlocked.
   */
  static async repayLoan(profileId: string, loanId: string, amount: number) {
    const { data: loan } = await supabase
      .from("loans")
      .select("*")
      .eq("id", loanId)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .single();

    if (!loan) throw new Error("Active loan not found");
    if (amount > loan.total_due) amount = loan.total_due;

    const success = await executeTransfer({
      fromType: "player",
      fromId: profileId,
      toType: "treasury",
      toId: "treasury-singleton",
      amount: amount,
      reason: "loan_repayment",
      metadata: { loanId: loan.id },
    });

    if (!success) throw new Error("Insufficient funds for repayment");

    const newDue = loan.total_due - amount;
    const isPaidOff = newDue <= 0;

    await supabase
      .from("loans")
      .update({
        total_due: isPaidOff ? 0 : newDue,
        status: isPaidOff ? "repaid" : "active",
      })
      .eq("id", loanId);

    if (isPaidOff) {
      // Unlock collateral
      const pledged: CollateralItem[] = loan.collateral;
      const plotIds = pledged.filter((p) => p.type === "plot").map((p) => p.id);
      const animalIds = pledged
        .filter((p) => p.type === "animal")
        .map((p) => p.id);

      if (plotIds.length > 0)
        await supabase
          .from("plots")
          .update({ locked_for_loan: false })
          .in("id", plotIds);
      if (animalIds.length > 0)
        await supabase
          .from("animals")
          .update({ locked_for_loan: false })
          .in("id", animalIds);
    }

    return { remainingDue: newDue, isPaidOff };
  }

  /**
   * Background worker job: Instantly seizes assets from defaulted loans past grace period.
   * Runs every minute.
   */
  static async processSeizures() {
    const now = Date.now();
    const { data: defaultedLoans } = await supabase
      .from("loans")
      .select("*")
      .eq("status", "active")
      .lt("grace_until", now);

    if (!defaultedLoans || defaultedLoans.length === 0) return;

    for (const loan of defaultedLoans) {
      console.log(`Processing instant seizure for defaulted loan: ${loan.id}`);

      const pledged: CollateralItem[] = loan.collateral;

      // Separate into plots and animals for batch deletes
      const plotIds = pledged.filter((p) => p.type === "plot").map((p) => p.id);
      const animalIds = pledged
        .filter((p) => p.type === "animal")
        .map((p) => p.id);

      // Instant seizure: Delete the seized assets (they belong to the Treasury now, effect is destroyed)
      if (plotIds.length > 0)
        await supabase.from("plots").delete().in("id", plotIds);
      if (animalIds.length > 0)
        await supabase.from("animals").delete().in("id", animalIds);

      // Mark defaulted in DB
      await supabase
        .from("loans")
        .update({ status: "defaulted" })
        .eq("id", loan.id);

      // Mark player as a defaulter — raises future loan interest from 10% to 15%
      await supabase
        .from('profiles')
        .update({ has_defaulted: true })
        .eq('id', loan.profile_id);

      // Notify the player via WebSocket if they are currently connected
      if (this.onSeizure) {
        this.onSeizure(
          loan.profile_id,
          pledged,
          loan.total_due
        );
      }
    }
  }
}
