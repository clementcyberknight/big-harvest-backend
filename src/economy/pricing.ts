import { redis } from './redis.js';
import { supabase } from '../db/supabase.js';
import { GAME_CROPS } from '../market/crops.js';
import { TOTAL_SUPPLY, Treasury } from './treasury.js';
import { getActivePopulation } from './population.js';

export interface CommodityState {
  id: string;
  current_buy_price: number;
  current_sell_price: number;
  sales_last_2h: number;
  purchases_last_2h: number;
  demand_multiplier: number;
  last_recalc_at: number;
}

const SEED_RATIO = 0.3;

export class PricingEngine {
  /**
   * Initialize pricing from Supabase to Redis on boot.
   */
  static async init() {
    const { data, error } = await supabase.from('commodity_prices').select('*');
    if (error) {
      console.error('Failed to load commodity prices:', error);
      return;
    }

    const dbPrices = new Map(data.map((row) => [row.id, row]));

    // Seed Redis with either DB values or initial defaults
    for (const crop of GAME_CROPS) {
      const dbState = dbPrices.get(crop.id);
      
      const state: CommodityState = dbState ? {
        id: dbState.id,
        current_buy_price: Number(dbState.current_buy_price),
        current_sell_price: Number(dbState.current_sell_price),
        sales_last_2h: dbState.sales_last_2h,
        purchases_last_2h: dbState.purchases_last_2h,
        demand_multiplier: Number(dbState.demand_multiplier),
        last_recalc_at: Number(dbState.last_recalc_at),
      } : {
        id: crop.id,
        current_sell_price: crop.base_price,
        current_buy_price: Math.max(1, Math.floor(crop.base_price * SEED_RATIO)),
        sales_last_2h: 0,
        purchases_last_2h: 0,
        demand_multiplier: 1.0,
        last_recalc_at: Date.now(),
      };

      await this.saveStateToRedis(state);
    }
    console.log(`PricingEngine initialized ${GAME_CROPS.length} commodities.`);
  }

  static async saveStateToRedis(state: CommodityState) {
    await redis.hSet(`commodity:${state.id}`, {
      id: state.id,
      current_buy_price: state.current_buy_price.toString(),
      current_sell_price: state.current_sell_price.toString(),
      sales_last_2h: state.sales_last_2h.toString(),
      purchases_last_2h: state.purchases_last_2h.toString(),
      demand_multiplier: state.demand_multiplier.toString(),
      last_recalc_at: state.last_recalc_at.toString(),
    });
  }

  static async getState(id: string): Promise<CommodityState | null> {
    const data = await redis.hGetAll(`commodity:${id}`);
    if (!data || !data.id) return null;
    return {
      id: data.id,
      current_buy_price: parseFloat(data.current_buy_price),
      current_sell_price: parseFloat(data.current_sell_price),
      sales_last_2h: parseInt(data.sales_last_2h, 10),
      purchases_last_2h: parseInt(data.purchases_last_2h, 10),
      demand_multiplier: parseFloat(data.demand_multiplier),
      last_recalc_at: parseInt(data.last_recalc_at, 10),
    };
  }

  static async getAllPrices(): Promise<CommodityState[]> {
    const promises = GAME_CROPS.map(c => this.getState(c.id));
    const results = await Promise.all(promises);
    return results.filter((r): r is CommodityState => r !== null);
  }

  /**
   * Called when a player sells produce to the treasury.
   */
  static async recordSale(id: string, qty: number) {
    await redis.hIncrBy(`commodity:${id}`, 'sales_last_2h', qty);
  }

  /**
   * Called when a player buys a seed from the treasury.
   */
  static async recordPurchase(id: string, qty: number) {
    await redis.hIncrBy(`commodity:${id}`, 'purchases_last_2h', qty);
  }

  /**
   * Market tick (every 30s). Recalculates all prices based on constraints.
   */
  static async recalculateAll() {
    const treasuryRatio = await Treasury.getRatio();
    
    // Treasury Multiplier
    let treasuryMult = 1.0;
    if (treasuryRatio < 0.15) treasuryMult = 0.4;
    else if (treasuryRatio < 0.25) treasuryMult = 0.6;
    else if (treasuryRatio > 0.85) treasuryMult = 1.8;
    else if (treasuryRatio > 0.75) treasuryMult = 1.4;

    // Velocity multiplier based on token movement vs circulating supply
    const txVolumeRaw = await redis.get('economy:tx_volume');
    const txVolume = txVolumeRaw ? parseInt(txVolumeRaw, 10) : 0;
    const circulating = TOTAL_SUPPLY - (await Treasury.getBalance());
    
    // Velocity ratio: how many times tokens changed hands relative to supply
    // We expect this to be low (e.g. 0.01 - 0.1 per tick).
    // We scale it so higher velocity leads to a slight upward pressure (inflation).
    const velocityRatio = circulating > 0 ? (txVolume / circulating) : 0;
    const velocityMult = 1.0 + (velocityRatio * 10); // scale 0.01 to 1.1 etc.
    const clampedVelocityMult = Math.max(0.8, Math.min(1.3, velocityMult));

    const eventRaw = await redis.get('economy:event_mult');
    const eventMult = eventRaw ? parseFloat(eventRaw) : 1.0;

    const population = await getActivePopulation();
    const now = Date.now();

    for (const crop of GAME_CROPS) {
      const state = await this.getState(crop.id);
      if (!state) continue;

      // Adjust demand multiplier based on sales vs purchases
      const netSupply = state.sales_last_2h - state.purchases_last_2h;
      
      // Calculate how much net supply exists per active player
      // This ensures 10,000 crops sold has a huge impact for 10 players, but barely any for 10,000 players.
      const supplyPerCapita = netSupply / population;
      
      // If supplyPerCapita > 0 (oversupplied), demand drops
      // If supplyPerCapita < 0 (undersupplied), demand rises
      const demandShift = supplyPerCapita * -0.05; 
      
      let newDemandMult = state.demand_multiplier + demandShift;
      // Clamp demand between 0.5 and 2.0
      newDemandMult = Math.max(0.5, Math.min(2.0, newDemandMult));

      let sellPrice = crop.base_price * treasuryMult * newDemandMult * eventMult * clampedVelocityMult;
      
      // Seed formula depends on treasury ratio too
      let seedBaseMult = 1.0;
      if (treasuryRatio < 0.15) seedBaseMult = 2.0;    // CRITICAL: seeds expensive
      else if (treasuryRatio < 0.25) seedBaseMult = 1.5; // TIGHT
      else if (treasuryRatio > 0.85) seedBaseMult = 0.5; // OVERFLOW: seeds cheap
      else if (treasuryRatio > 0.75) seedBaseMult = 0.7; // FLUSH

      let buyPrice = (crop.base_price * seedBaseMult) * SEED_RATIO * newDemandMult * eventMult;

      // Rounding
      sellPrice = Math.max(1, Math.round(sellPrice * 100) / 100);
      buyPrice = Math.max(1, Math.round(buyPrice * 100) / 100);

      // Decay trackers slowly (simulating rolling 2h window locally by halving every few ticks, or just clear them periodically. 
      // For simplicity, multiply by 0.95 each 30s tick to simulate decay)
      const newSales = Math.floor(state.sales_last_2h * 0.95);
      const newPurch = Math.floor(state.purchases_last_2h * 0.95);

      await this.saveStateToRedis({
        id: crop.id,
        current_sell_price: sellPrice,
        current_buy_price: buyPrice,
        demand_multiplier: newDemandMult,
        sales_last_2h: newSales,
        purchases_last_2h: newPurch,
        last_recalc_at: now,
      });
    }
  }

  /**
   * Sync prices to Supabase (every 60s)
   */
  static async syncToDB() {
    const states = await this.getAllPrices();
    if (states.length === 0) return;

    const upserts = states.map(s => ({
      id: s.id,
      current_buy_price: s.current_buy_price,
      current_sell_price: s.current_sell_price,
      sales_last_2h: s.sales_last_2h,
      purchases_last_2h: s.purchases_last_2h,
      demand_multiplier: s.demand_multiplier,
      last_recalc_at: s.last_recalc_at,
      updated_at: new Date().toISOString()
    }));

    const { error } = await supabase.from('commodity_prices').upsert(upserts);
    if (error) {
      console.error('Failed to sync commodity prices to DB:', error);
    }
  }

  static async getPlotPrice(tier: 'starter' | 'fertile' | 'premium'): Promise<number> {
    const bases = { starter: 50, fertile: 200, premium: 500 };
    const base = bases[tier];
    
    const treasuryRatio = await Treasury.getRatio();
    let treasuryMult = 1.0;
    if (treasuryRatio < 0.25) treasuryMult = 1.5; // expensive plots if tight
    if (treasuryRatio > 0.75) treasuryMult = 0.7; // cheap plots if flush

    return Math.max(1, Math.floor(base * treasuryMult));
  }

  /**
   * Analytics: take a snapshot of all prices and multipliers every 5 minutes.
   */
  static async snapshotPriceHistory() {
    const states = await this.getAllPrices();
    if (states.length === 0) return;

    const treasuryRatio = await Treasury.getRatio();
    const eventRaw = await redis.get('economy:event_mult');
    const eventMult = eventRaw ? parseFloat(eventRaw) : 1.0;
    const population = await getActivePopulation();

    const historyRows = states.map(s => ({
      commodity_id: s.id,
      sell_price: s.current_sell_price,
      buy_price: s.current_buy_price,
      treasury_ratio: treasuryRatio,
      demand_mult: s.demand_multiplier,
      event_mult: eventMult,
      player_count: population
    }));

    const { error } = await supabase.from('price_history').insert(historyRows);
    if (error) {
      console.error('Failed to log price history:', error);
    }
  }
}
