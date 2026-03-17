import { redis } from '../economy/redis.js';
import { supabase } from '../db/supabase.js';
import { executeTransfer } from '../economy/ledger.js';

export class BountyEngine {
  
  static async triggerBounty(itemId: string, targetQty: number, durationMinutes: number) {
    const expiresAt = Date.now() + (durationMinutes * 60 * 1000);
    
    await redis.mSet({
      'bounty:active': '1',
      'bounty:item_id': itemId,
      'bounty:target_qty': targetQty.toString(),
      'bounty:current_qty': '0',
      'bounty:expires_at': expiresAt.toString()
    });

    // We keep track of individual contributions in a sorted set or hash
    await redis.del('bounty:contributors');

    return { itemId, targetQty, expiresAt };
  }

  static async contribute(profileId: string, qty: number) {
    const isActive = await redis.get('bounty:active');
    if (isActive !== '1') throw new Error('No active bounty');

    const expiresAtStr = await redis.get('bounty:expires_at');
    if (expiresAtStr && Date.now() > parseInt(expiresAtStr, 10)) {
       await this.failBounty();
       throw new Error('Bounty has expired');
    }

    const itemId = await redis.get('bounty:item_id');
    if (!itemId) throw new Error('Bounty invalid');

    // Debit player inventory
    const { data: inventory } = await supabase.from('inventory')
      .select('id, quantity').eq('profile_id', profileId).eq('item_id', itemId).maybeSingle();
      
    if (!inventory || inventory.quantity < qty) throw new Error('Not enough items to contribute');

    // Actually debit them
    await supabase.from('inventory').update({ quantity: inventory.quantity - qty }).eq('id', inventory.id);

    // Update global counter and contributor tally
    const targetQtyStr = await redis.get('bounty:target_qty');

    const newCurrent = await redis.incrBy('bounty:current_qty', qty);
    await (redis as any).zincrby('bounty:contributors', qty, profileId);

    const targetQty = parseInt(targetQtyStr || '0', 10);

    if (newCurrent >= targetQty) {
      await this.succeedBounty();
      return { status: 'completed', message: 'You completed the bounty!' };
    }

    return { status: 'contributed', message: `Contributed ${qty}. Progress: ${newCurrent}/${targetQty}` };
  }

  static async succeedBounty() {
    await redis.del('bounty:active');
    
    // Distribute rewards proportional to contribution
    // For simplicity, let's say the total reward pool is 5 * targetQty
    const targetQtyStr = await redis.get('bounty:target_qty');
    const targetQty = parseInt(targetQtyStr || '0', 10);
    const totalPool = targetQty * 5;

    // We can't use ZRANGE WITHSCORES directly without specific types, let's just get the raw array
    // ioredis returns flat array ['profileA', '100', 'profileB', '200']
    const contributors = await (redis as any).zrange('bounty:contributors', 0, -1, 'WITHSCORES');

    for (let i = 0; i < contributors.length; i += 2) {
      const profileId = contributors[i];
      const contribution = parseInt(contributors[i+1], 10);
      
      const share = contribution / targetQty;
      const reward = Math.floor(totalPool * share);

      if (reward > 0) {
        await executeTransfer({
          fromType: 'treasury', fromId: 'treasury-singleton',
          toType: 'player', toId: profileId,
          amount: reward, reason: 'bounty_reward'
        });

        // Award badge (simplified: just track in a generic json column or table)
        // A real app might have a `badges` table
      }
    }

    await redis.del(['bounty:item_id', 'bounty:target_qty', 'bounty:current_qty', 'bounty:expires_at', 'bounty:contributors']);
  }

  static async failBounty() {
    await redis.del(['bounty:active', 'bounty:item_id', 'bounty:target_qty', 'bounty:current_qty', 'bounty:expires_at', 'bounty:contributors']);
  }
}
