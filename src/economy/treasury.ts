import { redis } from './redis.js';
import { supabase } from '../db/supabase.js';

export const TOTAL_SUPPLY = 50_000_000;

export class Treasury {
  /**
   * Initializes the treasury balance in Redis from Supabase.
   * Call this on server boot.
   */
  static async init() {
    // Check if treasury balance is already in Redis
    const exists = await redis.exists('treasury:balance');
    if (!exists) {
      // Load from Supabase (include id for ledger UUID compliance)
      const { data, error } = await supabase
        .from('treasury')
        .select('id, balance, epoch_ms')
        .limit(1)
        .single();
      
      if (error || !data) {
        console.error('Failed to load treasury from DB:', error);
        // Fallback for local testing if DB is completely empty and unmigrated
        await redis.set('treasury:balance', TOTAL_SUPPLY.toString());
        await redis.set('economy:epoch', Date.now().toString());
        return;
      }
      
      await redis.set('treasury:balance', data.balance.toString());
      await redis.set('economy:epoch', data.epoch_ms.toString());
      await redis.set('treasury:id', data.id);
      console.log(`Treasury initialized with ${data.balance} tokens`);
    } else {
      console.log('Treasury already loaded in Redis');
    }
  }

  /**
   * Gets the treasury row UUID for ledger inserts (schema requires UUID for from_id/to_id).
   */
  static async getId(): Promise<string> {
    let id = await redis.get('treasury:id');
    if (!id) {
      const { data } = await supabase.from('treasury').select('id').limit(1).single();
      id = data?.id ?? '';
      if (id) await redis.set('treasury:id', id);
    }
    return id || '';
  }

  /**
   * Gets the current treasury balance from Redis (0ms latency).
   */
  static async getBalance(): Promise<number> {
    const balance = await redis.get('treasury:balance');
    return balance ? parseInt(balance, 10) : TOTAL_SUPPLY;
  }

  /**
   * Calculates the treasury ratio (balance / 50M).
   * Used by the dynamic pricing engine to determine multiplier bands.
   */
  static async getRatio(): Promise<number> {
    const balance = await this.getBalance();
    return balance / TOTAL_SUPPLY;
  }

  /**
   * Returns the global game epoch (ms timestamp).
   * Used for consistent loan deadlines.
   */
  static async getEpoch(): Promise<number> {
    const epoch = await redis.get('economy:epoch');
    return epoch ? parseInt(epoch, 10) : Date.now();
  }

  /**
   * Periodically syncs the treasury balance back to Supabase.
   */
  static async syncToDB() {
    const balance = await this.getBalance();
    const id = await this.getId();
    if (!id) {
      console.error('Failed to sync treasury: no ID');
      return;
    }
    const { error } = await supabase
      .from('treasury')
      .update({ balance, updated_at: new Date().toISOString() })
      .eq('id', id);
    
    if (error) {
      console.error('Failed to sync treasury to DB:', error);
    }
  }

  /**
   * Conservation Law Audit: Ensures total tokens in existence == 50,000,000.
   * Scans treasury, all players in profiles, and active loans.
   */
  static async auditIntegrity(): Promise<{ total: number, diff: number, status: 'valid' | 'corrupt' }> {
    const treasuryBal = await this.getBalance();
    
    // Sum player balances from DB (Redis balances are flushed periodically or on exit, so DB is source of truth for cold audit)
    const { data: profiles } = await supabase.from('profiles').select('coins');
    const playerTotal = (profiles || []).reduce((sum, p) => sum + Number(p.coins || 0), 0);
    
    // Sum outstanding loans
    const { data: loans } = await supabase.from('loans').select('total_due').eq('status', 'active');
    const loanTotal = (loans || []).reduce((sum, l) => sum + Number(l.total_due || 0), 0);
    
    const grandTotal = treasuryBal + playerTotal + loanTotal;
    const diff = grandTotal - TOTAL_SUPPLY;
    
    console.log(`[Audit] Total tokens: ${grandTotal} (Diff: ${diff})`);
    
    return {
      total: grandTotal,
      diff,
      status: Math.abs(diff) < 1 ? 'valid' : 'corrupt'
    };
  }
}
