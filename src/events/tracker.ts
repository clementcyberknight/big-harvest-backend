import { supabase } from '../db/supabase.js';
import { redis } from '../economy/redis.js';

type AlertCallback = (commodityId: string, alertType: string, volume: number, priceImpact: number) => void;
let globalAlertCb: AlertCallback | null = null;

export class TrackerEngine {
  static setAlertCallback(cb: AlertCallback) {
    globalAlertCb = cb;
  }

  // ==========================================
  // 1. Player Activity Feed
  // ==========================================

  /**
   * Logs a significant action so other players can see it.
   */
  static async logActivity(profileId: string, action: string, details: any = {}) {
    // Fire and forget
    supabase.from('player_activity').insert({
      profile_id: profileId,
      action,
      details
    }).then(({ error }) => {
      if (error) console.error('[Tracker] Failed to log activity:', error);
    });
  }

  static async getPlayerActivity(targetWallet: string, limit = 50) {
    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('wallet_address', targetWallet)
      .maybeSingle();

    if (!targetProfile) throw new Error('Target player not found');

    const { data: activities, error } = await supabase
      .from('player_activity')
      .select('action, details, created_at')
      .eq('profile_id', targetProfile.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error('Failed to fetch activity');
    return activities || [];
  }

  // ==========================================
  // 2. Commodity Tracker (Dumping/Hoarding)
  // ==========================================

  /**
   * Tracks a commodity trade (buy or sell) and checks for market manipulation.
   * type: 'buy' | 'sell'
   */
  static async trackCommodity(commodityId: string, type: 'buy' | 'sell', qty: number) {
    const now = Date.now();
    const window5m = 5 * 60 * 1000;
    const cutoff = now - window5m;

    const keySells = `commodity:${commodityId}:sells:5m`;
    const keyBuys = `commodity:${commodityId}:buys:5m`;
    const targetKey = type === 'sell' ? keySells : keyBuys;

    // We can use a Redis ZSET to store individual trades with timestamp as score,
    // which allows us to exactly roll the window.
    await redis.zAdd(targetKey, [{ score: now, value: `${now}:${qty}` }]);
    
    // Prune old entries
    await redis.zRemRangeByScore(keySells, '-inf', cutoff);
    await redis.zRemRangeByScore(keyBuys, '-inf', cutoff);

    // Calculate totals in the rolling window
    const [sellsRaw, buysRaw] = await Promise.all([
      redis.zRange(keySells, 0, -1),
      redis.zRange(keyBuys, 0, -1)
    ]);

    const sumQty = (arr: string[]) => arr.reduce((sum, item) => sum + parseInt(item.split(':')[1] || '0', 10), 0);
    const totalSells = sumQty(sellsRaw);
    const totalBuys = sumQty(buysRaw);

    // To compare against "averages", we could maintain a long-term moving average.
    // For simplicity, we compare to hardcoded thresholds or current market depth.
    // Let's assume an average 5m volume is ~10,000 for standard items. 
    // In a real game, this would be periodically computed.
    const AVG_5M_QTY = 5000; 

    // Dumping Detection
    if (type === 'sell' && totalSells > AVG_5M_QTY * 10) {
      await this.triggerAlert(commodityId, 'DUMP_DETECTED', totalSells, -0.35); // simulated price impact -35%
    }

    // Hoarding / Surge Buying Detection
    if (type === 'buy' && totalBuys > AVG_5M_QTY * 5 && totalSells < AVG_5M_QTY) {
      await this.triggerAlert(commodityId, 'HOARD_DETECTED', totalBuys, 0.25); // simulated price impact +25%
    }
  }

  private static async triggerAlert(commodityId: string, alertType: string, volume: number, priceImpact: number) {
    // Avoid spamming alerts for the same item/event by setting a cooldown
    const cooldownKey = `alert:${commodityId}:cooldown`;
    const inCooldown = await redis.get(cooldownKey);
    if (inCooldown) return;

    await redis.setEx(cooldownKey, 60, '1'); // 1 minute cooldown

    // Log to DB
    supabase.from('commodity_events').insert({
      commodity_id: commodityId,
      event_type: alertType,
      volume,
      price_impact: priceImpact
    }).then(({ error }) => {
      if (error) console.error('[Tracker] Failed to log commodity alert:', error);
    });

    // Broadcast via callback
    if (globalAlertCb) {
      globalAlertCb(commodityId, alertType, volume, priceImpact);
    }
  }
}
