import { redis } from './redis.js';
import { executeTransfer } from './ledger.js';

/**
 * Progressive Tax Brackets — wealth_ratio = player_net_worth / avg_net_worth.
 * Players can reduce their effective rate via Goodwill Points (charitable donations).
 */
const TAX_BRACKETS: { maxRatio: number; rate: number }[] = [
  { maxRatio: 2.0,  rate: 0.00 },  // Small farmers pay nothing
  { maxRatio: 5.0,  rate: 0.05 },
  { maxRatio: 10.0, rate: 0.10 },
  { maxRatio: 20.0, rate: 0.20 },
  { maxRatio: 50.0, rate: 0.35 },
  { maxRatio: Infinity, rate: 0.50 }, // Mega-rich
];

function getBracketRate(wealthRatio: number): number {
  for (const bracket of TAX_BRACKETS) {
    if (wealthRatio < bracket.maxRatio) return bracket.rate;
  }
  return TAX_BRACKETS[TAX_BRACKETS.length - 1].rate;
}

export class TaxEngine {

  static async getPlayerNetWorth(profileId: string): Promise<number> {
    const playerScore = await redis.zScore('leaderboard', profileId);
    return playerScore ?? 0;
  }

  static async getAverageNetWorth(): Promise<number> {
    const totalPlayers = await redis.zCard('leaderboard');
    if (totalPlayers === 0) return 1;
    const totalWealth = await redis.get('stats:total_wealth');
    return Math.max(1, Math.floor((totalWealth ? parseInt(totalWealth, 10) : 0) / totalPlayers));
  }

  static async getTreasuryRatio(): Promise<number> {
    const treasuryBalance = await redis.get('economy:treasury_balance');
    return (treasuryBalance ? parseInt(treasuryBalance, 10) : 25_000_000) / 50_000_000;
  }

  /**
   * Gets the effective tax rate for a player on sell actions.
   * Factors in: wealth ratio, goodwill points, and treasury stress multiplier.
   */
  static async getEffectiveTaxRate(profileId: string): Promise<{
    bracketRate: number;
    goodwillPoints: number;
    effectiveRate: number;
    wealthRatio: number;
  }> {
    const playerNetWorth = await this.getPlayerNetWorth(profileId);
    const avgNetWorth = await this.getAverageNetWorth();
    const wealthRatio = playerNetWorth / avgNetWorth;
    
    let bracketRate = getBracketRate(wealthRatio);

    // Treasury stress multiplier
    const treasuryRatio = await this.getTreasuryRatio();
    if (treasuryRatio < 0.25) {
      bracketRate = Math.min(0.75, bracketRate * 1.5);
    }

    // Goodwill points reduce tax by 1 percentage point each
    const goodwillRaw = await redis.get(`goodwill:${profileId}`);
    const goodwillPoints = goodwillRaw ? parseInt(goodwillRaw, 10) : 0;

    const effectiveRate = Math.max(0, bracketRate - (goodwillPoints * 0.01));

    return { bracketRate, goodwillPoints, effectiveRate, wealthRatio };
  }

  /**
   * Applies the progressive tax to a sale amount.
   * Returns the net amount the player receives and the tax amount sent to Treasury.
   */
  static async applySaleTax(
    profileId: string,
    grossAmount: number
  ): Promise<{ netAmount: number; taxAmount: number; effectiveRate: number }> {
    const { effectiveRate } = await this.getEffectiveTaxRate(profileId);
    
    const taxAmount = Math.floor(grossAmount * effectiveRate);
    const netAmount = grossAmount - taxAmount;

    return { netAmount, taxAmount, effectiveRate };
  }

  /**
   * Donate tokens to the Treasury to earn Goodwill Points.
   * 1,000 tokens = 1 Goodwill Point.
   */
  static async donateTreasury(
    profileId: string,
    amount: number
  ): Promise<{ goodwillEarned: number; totalGoodwill: number; effectiveRate: number }> {
    if (amount < 100) throw new Error('Minimum donation is 100 tokens');

    const success = await executeTransfer({
      fromType: 'player', fromId: profileId,
      toType: 'treasury', toId: 'treasury-singleton',
      amount, reason: 'charitable_donation'
    });

    if (!success) throw new Error('Insufficient funds');

    const goodwillEarned = Math.floor(amount / 1000);
    
    if (goodwillEarned > 0) {
      await redis.incrBy(`goodwill:${profileId}`, goodwillEarned);
    }

    const { effectiveRate, goodwillPoints } = await this.getEffectiveTaxRate(profileId);

    return {
      goodwillEarned,
      totalGoodwill: goodwillPoints,
      effectiveRate
    };
  }

  /**
   * Called every game year (28 min) to decay goodwill points by 1.
   */
  static async decayAllGoodwill(): Promise<void> {
    // Get all goodwill keys and decrement each by 1
    const keys = await redis.keys('goodwill:*');
    for (const key of keys) {
      const val = await redis.get(key);
      if (val && parseInt(val, 10) > 1) {
        await redis.decrBy(key, 1);
      } else {
        await redis.del(key);
      }
    }
  }

  /**
   * Check if a player has an active protest tax penalty.
   * Returns the penalty details (Debt / Garnish rate) or null.
   */
  static async getProtestPenalty(profileId: string): Promise<{
    garnishRate: number;
    remainingFine: number;
    reputationPenalty: number;
  } | null> {
    const data = await redis.hGetAll(`penalty:${profileId}:protest_tax`);
    if (!data || !data.garnish_rate) return null;
    return {
      garnishRate: parseFloat(data.garnish_rate),
      remainingFine: parseInt(data.remaining_fine, 10),
      reputationPenalty: parseFloat(data.reputation_penalty)
    };
  }

  /**
   * Deducts funds from the player's active fine debt.
   * If fine reaches 0, the penalty is cleared.
   */
  static async payDownProtestFine(profileId: string, amountPaid: number): Promise<void> {
    const penaltyKey = `penalty:${profileId}:protest_tax`;
    
    // Decrement the fine in Redis
    const newFine = await redis.hIncrBy(penaltyKey, 'remaining_fine', -amountPaid);
    
    // Also update Postgres
    const { supabase } = await import('../db/supabase.js');
    await supabase.from('protests')
      .update({ tribute: Math.max(0, newFine) }) // tribute field holds remaining fine
      .eq('target_id', profileId)
      .eq('status', 'active');

    if (newFine <= 0) {
      // Debt paid off! Remove penalty
      await redis.del(penaltyKey);
      await supabase.from('protests')
        .update({ status: 'resolved' })
        .eq('target_id', profileId)
        .eq('status', 'active');
    }
  }
}
