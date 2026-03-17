import { supabase } from '../db/supabase.js';
import { GAME_CROPS } from '../market/crops.js';

// Generic crafting times per tier
const CRAFT_TIMES_MS = {
  1: 15 * 1000,      // 15 seconds
  2: 60 * 1000,      // 1 minute
  3: 5 * 60 * 1000,  // 5 minutes
  'special': 10 * 60 * 1000 
};

export class CraftingEngine {
  static onComplete?: (profileId: string, itemId: string, qty: number) => void;
  
  static async startCrafting(profileId: string, recipeId: string) {
    const item = GAME_CROPS.find(c => c.id === recipeId);
    if (!item || item.category !== 'crafted' || !item.recipe) {
      throw new Error('Invalid recipe');
    }

    // 1. Check all ingredients
    for (const req of item.recipe) {
      const hasEnough = await this.hasInventory(profileId, req.id, req.qty);
      if (!hasEnough) {
        throw new Error(`Insufficient ingredient: ${req.id} (need ${req.qty})`);
      }
    }

    // 2. Consume ingredients
    for (const req of item.recipe) {
      await this.decrementInventory(profileId, req.id, req.qty);
    }

    // 3. Determine time
    const waitMs = CRAFT_TIMES_MS[item.tier as keyof typeof CRAFT_TIMES_MS] || 30000;
    const readyAt = Date.now() + waitMs;

    // 4. Schedule completion
    // In a full production env, this would go into a Redis Sorted Set or a BullMQ queue
    // to survive server restarts. For this architecture MVP, we use setTimeout.
    setTimeout(() => {
      this.completeCrafting(profileId, recipeId).catch(console.error);
    }, waitMs);

    return { item: recipeId, ready_at: readyAt };
  }

  private static async completeCrafting(profileId: string, recipeId: string) {
    // Add crafted item to inventory
    const { data } = await supabase.from('inventory')
      .select('id, quantity').eq('profile_id', profileId).eq('item_id', recipeId).maybeSingle();
    
    if (data) {
      await supabase.from('inventory').update({ quantity: data.quantity + 1 }).eq('id', data.id);
    } else {
      await supabase.from('inventory').insert({ profile_id: profileId, item_id: recipeId, quantity: 1 });
    }

    if (this.onComplete) {
      this.onComplete(profileId, recipeId, 1);
    }
  }

  // --- Helpers ---
  private static async hasInventory(profileId: string, itemId: string, reqQty: number): Promise<boolean> {
    const { data } = await supabase.from('inventory')
      .select('quantity').eq('profile_id', profileId).eq('item_id', itemId).maybeSingle();
    return !!data && data.quantity >= reqQty;
  }

  private static async decrementInventory(profileId: string, itemId: string, qty: number) {
    const { data } = await supabase.from('inventory')
      .select('id, quantity').eq('profile_id', profileId).eq('item_id', itemId).single();
    if (data) {
      await supabase.from('inventory').update({ quantity: data.quantity - qty }).eq('id', data.id);
    }
  }
}
