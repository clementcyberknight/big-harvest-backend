import { supabase } from '../db/supabase.js';
import { executeTransfer } from '../economy/ledger.js';
import { PricingEngine } from '../economy/pricing.js';
import { calculateYield, calculateGrowthTimeMs, PlotTier } from '../economy/yields.js';
import { GAME_CROPS } from '../market/crops.js';

export class FarmingEngine {

  static async buyPlot(profileId: string, tier: PlotTier) {
    const cost = await PricingEngine.getPlotPrice(tier);
    
    // Limits
    const limits = { starter: 6, fertile: 4, premium: 2 };
    const maxPlots = limits[tier];

    const { count } = await supabase
      .from('plots')
      .select('id', { count: 'exact' })
      .eq('profile_id', profileId)
      .eq('plot_tier', tier);

    if (count !== null && count >= maxPlots) {
      throw new Error(`Max ${tier} plots reached`);
    }

    const nextSlot = (count || 0) + 1;

    // Fast-path token transfer
    const success = await executeTransfer({
      fromType: 'player',
      fromId: profileId,
      toType: 'treasury',
      toId: 'treasury-singleton',
      amount: cost,
      reason: 'plot_purchase',
      metadata: { tier }
    });

    if (!success) throw new Error('Insufficient funds');

    // Async/fire-and-forget style write to DB (we await for safety but it runs fast enough)
    const { data: plot, error } = await supabase.from('plots').insert({
      profile_id: profileId,
      plot_tier: tier,
      slot_index: nextSlot,
      purchase_price: cost
    }).select().single();

    if (error) {
      // Rollback (ideally, though rare)
      await executeTransfer({
        fromType: 'treasury', fromId: 'treasury-singleton',
        toType: 'player', toId: profileId,
        amount: cost, reason: 'plot_purchase_refund'
      });
      throw new Error('Database error creating plot');
    }

    return plot;
  }

  static async buySeed(profileId: string, cropId: string, qty: number) {
    const crop = GAME_CROPS.find(c => c.id === cropId);
    if (!crop || crop.category !== 'crop') throw new Error('Invalid seed');

    const state = await PricingEngine.getState(cropId);
    if (!state) throw new Error('Pricing uninitialized');

    const totalCost = state.current_buy_price * qty;

    const success = await executeTransfer({
      fromType: 'player', fromId: profileId,
      toType: 'treasury', toId: 'treasury-singleton',
      amount: totalCost, reason: 'seed_purchase',
      metadata: { cropId, qty }
    });

    if (!success) throw new Error('Insufficient funds');

    await PricingEngine.recordPurchase(cropId, qty);

    await this.incrementInventory(profileId, `${cropId}_seed`, qty);
    return { success: true, cost: totalCost };
  }

  static async plantCrop(profileId: string, plotId: string, cropId: string) {
    const crop = GAME_CROPS.find(c => c.id === cropId);
    if (!crop || crop.category !== 'crop') throw new Error('Invalid crop');

    const { data: plot } = await supabase
      .from('plots')
      .select('id, crop_id')
      .eq('id', plotId)
      .eq('profile_id', profileId)
      .single();

    if (!plot) throw new Error('Plot not found');
    if (plot.crop_id) throw new Error('Plot not empty');

    // Check inventory for seed
    const hasSeed = await this.decrementInventory(profileId, `${cropId}_seed`, 1);
    if (!hasSeed) {
      // Alternative: fallback to auto-buying seed if no seeds in inventory (matches architecture 4.1)
      const state = await PricingEngine.getState(cropId);
      if (!state) throw new Error('Pricing uninitialized');

      const success = await executeTransfer({
        fromType: 'player', fromId: profileId,
        toType: 'treasury', toId: 'treasury-singleton',
        amount: state.current_buy_price, reason: 'seed_purchase_auto',
      });
      if (!success) throw new Error('Insufficient seeds or funds');
      await PricingEngine.recordPurchase(cropId, 1);
    }

    await supabase.from('plots').update({
      crop_id: cropId,
      planted_at: Date.now()
    }).eq('id', plotId);

    return { success: true };
  }

  static async harvest(profileId: string, plotId: string) {
    const { data: plot } = await supabase
      .from('plots')
      .select('*')
      .eq('id', plotId)
      .eq('profile_id', profileId)
      .single();

    if (!plot || !plot.crop_id || !plot.planted_at) {
      throw new Error('Nothing to harvest');
    }

    const crop = GAME_CROPS.find(c => c.id === plot.crop_id);
    if (!crop) throw new Error('Unknown crop');

    const growthTimeMs = calculateGrowthTimeMs(crop, plot.plot_tier as PlotTier);
    const now = Date.now();
    
    if (now < Number(plot.planted_at) + growthTimeMs) {
      throw new Error('Crop not ready yet');
    }

    const yieldAmount = calculateYield(plot.crop_id, plot.plot_tier as PlotTier, plot.boost_applied);

    await supabase.from('plots').update({
      crop_id: null,
      planted_at: null,
      boost_applied: false
    }).eq('id', plotId);

    await this.incrementInventory(profileId, plot.crop_id, yieldAmount);

    return { items: [{ id: plot.crop_id, qty: yieldAmount }], xp: 10 };
  }

  static async sell(profileId: string, itemId: string, qty: number) {
    if (qty <= 0) throw new Error('Invalid quantity');

    const state = await PricingEngine.getState(itemId);
    if (!state) throw new Error('Cannot sell this item');

    // Rare produce and crafted items are inventory items, but Plots and Animals are distinct tables.
    // In our spec, only produce/seeds/inventory are sold via this `sell` method. 
    // Plot and Animal liquidations would need a dedicated endpoint, but in case they use this...
    if (['starter_plot', 'fertile_plot', 'premium_plot'].includes(itemId)) {
      throw new Error('Please use the property manager to sell land');
    }
    if (['chicken', 'cow', 'pig', 'sheep', 'bee'].includes(itemId)) {
      throw new Error('Please use the barn manager to sell animals');
    }

    const hasItem = await this.decrementInventory(profileId, itemId, qty);
    if (!hasItem) throw new Error('Not enough items in inventory');

    const totalEarned = state.current_sell_price * qty;

    const success = await executeTransfer({
      fromType: 'treasury', fromId: 'treasury-singleton',
      toType: 'player', toId: profileId,
      amount: totalEarned, reason: 'produce_sale',
      metadata: { itemId, qty }
    });

    if (!success) {
      // Refund item back
      await this.incrementInventory(profileId, itemId, qty);
      throw new Error('Treasury rejected sale (insufficient funds)');
    }

    await PricingEngine.recordSale(itemId, qty);

    return { earned: totalEarned };
  }

  // --- Helpers for inventory ---
  private static async incrementInventory(profileId: string, itemId: string, qty: number) {
    const { data } = await supabase.from('inventory')
      .select('id, quantity').eq('profile_id', profileId).eq('item_id', itemId).maybeSingle();
    
    if (data) {
      await supabase.from('inventory').update({ quantity: data.quantity + qty }).eq('id', data.id);
    } else {
      await supabase.from('inventory').insert({ profile_id: profileId, item_id: itemId, quantity: qty });
    }
  }

  private static async decrementInventory(profileId: string, itemId: string, qty: number): Promise<boolean> {
    const { data } = await supabase.from('inventory')
      .select('id, quantity').eq('profile_id', profileId).eq('item_id', itemId).maybeSingle();
    
    if (!data || data.quantity < qty) return false;

    await supabase.from('inventory').update({ quantity: data.quantity - qty }).eq('id', data.id);
    return true;
  }

}
