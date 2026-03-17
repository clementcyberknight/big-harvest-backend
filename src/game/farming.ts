import { supabase } from '../db/supabase.js';
import { executeTransfer } from '../economy/ledger.js';
import { PricingEngine } from '../economy/pricing.js';
import { TaxEngine } from '../economy/tax.js';
import { calculateYield, calculateGrowthTimeMs, isWithered, PlotTier } from '../economy/yields.js';
import { GAME_CROPS } from '../market/crops.js';
import { TrackerEngine } from '../events/tracker.js';

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

    TrackerEngine.logActivity(profileId, 'bought_plot', { tier, cost }).catch(console.error);

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
    await TrackerEngine.trackCommodity(cropId, 'buy', qty).catch(console.error);
    TrackerEngine.logActivity(profileId, 'bought_seed', { cropId, qty, totalCost }).catch(console.error);

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

    TrackerEngine.logActivity(profileId, 'planted_crop', { cropId }).catch(console.error);

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
    const plantedAt = Number(plot.planted_at);
    
    if (now < plantedAt + growthTimeMs) {
      throw new Error('Crop not ready yet');
    }

    // Check if crop has withered (past the harvest window)
    if (isWithered(plantedAt, crop, plot.plot_tier as PlotTier)) {
      // Crop is dead — clear the plot and return nothing
      await supabase.from('plots').update({
        crop_id: null,
        planted_at: null,
        boost_applied: false
      }).eq('id', plotId);

      return { items: [], xp: 0, withered: true };
    }

    const yieldAmount = calculateYield(plot.crop_id, plot.plot_tier as PlotTier, plot.boost_applied);

    await supabase.from('plots').update({
      crop_id: null,
      planted_at: null,
      boost_applied: false
    }).eq('id', plotId);

    await this.incrementInventory(profileId, plot.crop_id, yieldAmount);

    TrackerEngine.logActivity(profileId, 'harvested_crop', { cropId: plot.crop_id, yieldAmount }).catch(console.error);

    return { items: [{ id: plot.crop_id, qty: yieldAmount }], xp: 10, withered: false };
  }

  static async sell(profileId: string, itemId: string, qty: number) {
    if (qty <= 0) throw new Error('Invalid quantity');

    const state = await PricingEngine.getState(itemId);
    if (!state) throw new Error('Cannot sell this item');

    if (['starter_plot', 'fertile_plot', 'premium_plot'].includes(itemId)) {
      throw new Error('Please use the property manager to sell land');
    }
    if (['chicken', 'cow', 'pig', 'sheep', 'bee'].includes(itemId)) {
      throw new Error('Please use the barn manager to sell animals');
    }

    const hasItem = await this.decrementInventory(profileId, itemId, qty);
    if (!hasItem) throw new Error('Not enough items in inventory');

    const grossEarned = state.current_sell_price * qty;

    // Apply progressive tax
    const { netAmount, taxAmount, effectiveRate } = await TaxEngine.applySaleTax(profileId, grossEarned);

    // Check for protest penalty (garnished wages against a fixed fine)
    const protestPenalty = await TaxEngine.getProtestPenalty(profileId);
    let protestTax = 0;
    if (protestPenalty && protestPenalty.remainingFine > 0) {
      protestTax = Math.floor(netAmount * protestPenalty.garnishRate);
      if (protestTax > protestPenalty.remainingFine) {
        protestTax = protestPenalty.remainingFine;
      }
      
      // Pay down fine
      await TaxEngine.payDownProtestFine(profileId, protestTax);
    }

    const finalNet = netAmount - protestTax;
    const totalTax = taxAmount + protestTax;

    // Player receives net amount
    const success = await executeTransfer({
      fromType: 'treasury', fromId: 'treasury-singleton',
      toType: 'player', toId: profileId,
      amount: finalNet, reason: 'produce_sale',
      metadata: { itemId, qty, grossEarned, taxAmount: totalTax, effectiveRate }
    });

    if (!success) {
      await this.incrementInventory(profileId, itemId, qty);
      throw new Error('Treasury rejected sale (insufficient funds)');
    }

    await PricingEngine.recordSale(itemId, qty);
    await TrackerEngine.trackCommodity(itemId, 'sell', qty).catch(console.error);
    TrackerEngine.logActivity(profileId, 'sold_item', { itemId, qty, finalNet, totalTax }).catch(console.error);

    return {
      earned: finalNet,
      grossEarned,
      taxAmount: totalTax,
      effectiveRate,
      protestTax: protestTax > 0 ? protestTax : undefined
    };
  }

  static async donateTreasury(profileId: string, amount: number) {
    return TaxEngine.donateTreasury(profileId, amount);
  }

  // --- Helpers for inventory ---
  static async incrementInventory(profileId: string, itemId: string, qty: number) {
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
