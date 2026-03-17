import { supabase } from '../db/supabase.js';
import { executeTransfer } from '../economy/ledger.js';
import { PricingEngine } from '../economy/pricing.js';

const ANIMAL_CYCLE_MS = 10 * 60 * 1000; // 10 minutes per cycle
const GESTATION_MS = 60 * 60 * 1000; // 1 hour for mammals
const INCUBATION_MS = 30 * 60 * 1000; // 30 minutes for eggs
const MATING_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

const DROPS: Record<string, { normal: string[], rare?: { id: string, chance: number } }> = {
  chicken: { normal: ['egg'], rare: { id: 'golden_egg', chance: 0.05 } },
  cow: { normal: ['milk'], rare: { id: 'rich_milk', chance: 0.08 } },
  bee: { normal: ['honeycomb', 'raw_honey'], rare: { id: 'royal_jelly', chance: 0.03 } },
  pig: { normal: ['pork'], rare: { id: 'truffle', chance: 0.04 } },
  sheep: { normal: ['raw_wool'] }
};

type HealthStatus = 'happy' | 'sad' | 'sick';

function getHealthStatus(missedCycles: number): HealthStatus {
  if (missedCycles >= 20) return 'sick';
  if (missedCycles >= 5) return 'sad';
  return 'happy';
}

export class AnimalEngine {

  static async buyAnimal(profileId: string, animalType: string) {
    if (!DROPS[animalType]) throw new Error('Unknown animal type');
    
    const cost = await PricingEngine.getAnimalPrice(animalType);
    
    const success = await executeTransfer({
      fromType: 'player', fromId: profileId,
      toType: 'treasury', toId: 'treasury-singleton',
      amount: cost, reason: 'buy_animal', metadata: { animalType }
    });
    
    if (!success) throw new Error('Insufficient funds');
    
    const { data: animal, error } = await supabase.from('animals').insert({
      profile_id: profileId,
      animal_type: animalType,
      purchase_price: cost
    }).select().single();
    
    if (error) {
      await executeTransfer({
        fromType: 'treasury', fromId: 'treasury-singleton',
        toType: 'player', toId: profileId,
        amount: cost, reason: 'buy_animal_refund'
      });
      throw new Error('Database error creating animal');
    }
    
    return animal;
  }

  static async sellAnimal(profileId: string, animalId: string) {
    const { data: animal } = await supabase
      .from('animals')
      .select('*')
      .eq('id', animalId)
      .eq('profile_id', profileId)
      .single();
      
    if (!animal) throw new Error('Animal not found');
    if (animal.locked_for_loan) throw new Error('Cannot sell an animal locked for a loan');
    
    // Sell price is 50% of its purchase price (or current market cost if 0)
    const refund = Math.floor((animal.purchase_price || await PricingEngine.getAnimalPrice(animal.animal_type)) * 0.5);
    
    await supabase.from('animals').delete().eq('id', animalId);
    
    await executeTransfer({
      fromType: 'treasury', fromId: 'treasury-singleton',
      toType: 'player', toId: profileId,
      amount: refund, reason: 'sell_animal', metadata: { animalType: animal.animal_type }
    });
    
    return { refund };
  }

  static async feedAnimal(profileId: string, animalId: string) {
    const { data: animal } = await supabase
      .from('animals')
      .select('animal_type, is_fed')
      .eq('id', animalId)
      .eq('profile_id', profileId)
      .single();
      
    if (!animal) throw new Error('Animal not found');
    if (animal.is_fed) throw new Error('Animal is already fed');
    
    const hasFeed = await this.decrementInventory(profileId, 'animal_feed', 1);
    if (!hasFeed) {
      throw new Error('Not enough animal_feed in inventory');
    }
    
    // Feeding resets missed_cycles and sets is_fed
    await supabase.from('animals').update({ is_fed: true, missed_cycles: 0, health_status: 'happy' }).eq('id', animalId);
    return { success: true };
  }

  static async cureAnimal(profileId: string, animalId: string) {
    const { data: animal } = await supabase
      .from('animals')
      .select('health_status')
      .eq('id', animalId)
      .eq('profile_id', profileId)
      .single();
      
    if (!animal) throw new Error('Animal not found');
    if (animal.health_status !== 'sick') throw new Error('Animal is not sick');
    
    const hasMedicine = await this.decrementInventory(profileId, 'medicine', 1);
    if (!hasMedicine) throw new Error('Not enough medicine in inventory');
    
    await supabase.from('animals').update({
      health_status: 'happy',
      missed_cycles: 0
    }).eq('id', animalId);
    
    return { success: true };
  }

  static async collect(profileId: string, animalId: string) {
    const { data: animal } = await supabase
      .from('animals')
      .select('animal_type, last_collected, is_fed, missed_cycles, health_status')
      .eq('id', animalId)
      .eq('profile_id', profileId)
      .single();

    if (!animal) throw new Error('Animal not found or does not belong to you');

    const now = Date.now();
    const lastCollected = animal.last_collected ? Number(animal.last_collected) : 0;
    
    if (now < lastCollected + ANIMAL_CYCLE_MS) {
      throw new Error('Animal not ready for collection');
    }

    // Calculate missed cycles (how many cycles passed since last collection minus 1)
    const cyclesPassed = Math.floor((now - lastCollected) / ANIMAL_CYCLE_MS);
    const newMissed = Math.max(0, (animal.missed_cycles || 0) + cyclesPassed - 1);
    const status = getHealthStatus(newMissed);

    // Update health status & missed cycles
    await supabase.from('animals').update({
      last_collected: now,
      is_fed: false,
      missed_cycles: newMissed,
      health_status: status
    }).eq('id', animalId);

    // Sick animals — cannot produce at all, need medicine
    if (status === 'sick') {
      return { items: [], rare: false, xp: 0, health_status: 'sick' as const };
    }

    // Sad animals — produce nothing but can still recover
    if (status === 'sad') {
      return { items: [], rare: false, xp: 0, health_status: 'sad' as const };
    }

    const dropConfig = DROPS[animal.animal_type];
    if (!dropConfig) throw new Error('Unknown animal type');

    const itemsToAdd: { id: string, qty: number }[] = [];
    
    // Fed animals double their output and increase rare chance by 1.5x
    const multiplier = animal.is_fed ? 2 : 1;
    
    for (const normalId of dropConfig.normal) {
      itemsToAdd.push({ id: normalId, qty: 1 * multiplier });
    }

    let rareDropped = false;
    if (dropConfig.rare) {
      const rareChance = animal.is_fed ? dropConfig.rare.chance * 1.5 : dropConfig.rare.chance;
      if (Math.random() < rareChance) {
        itemsToAdd.push({ id: dropConfig.rare.id, qty: 1 });
        rareDropped = true;
      }
    }

    for (const item of itemsToAdd) {
      await this.incrementInventory(profileId, item.id, item.qty);
    }

    return { items: itemsToAdd, rare: rareDropped, xp: 15 * multiplier, health_status: 'happy' as const };
  }

  static async mateAnimals(profileId: string, sireId: string, damId: string) {
    if (sireId === damId) throw new Error('Cannot mate an animal with itself');
    
    const { data: animals } = await supabase
      .from('animals')
      .select('*')
      .in('id', [sireId, damId])
      .eq('profile_id', profileId);
      
    if (!animals || animals.length !== 2) throw new Error('Animals not found');
    
    const sire = animals.find(a => a.id === sireId)!;
    const dam = animals.find(a => a.id === damId)!;
    
    if (sire.animal_type !== dam.animal_type) throw new Error('Animals must be the same species');
    
    const now = Date.now();
    if (
      (sire.last_mated_at && now < Number(sire.last_mated_at) + MATING_COOLDOWN_MS) ||
      (dam.last_mated_at && now < Number(dam.last_mated_at) + MATING_COOLDOWN_MS)
    ) {
      throw new Error('Animals are recovering from mating');
    }
    
    // Apply cooldowns
    await supabase.from('animals').update({ last_mated_at: now }).in('id', [sireId, damId]);
    
    const type = dam.animal_type;
    const isBird = type === 'chicken'; // Add 'duck' etc here later if needed
    
    if (isBird) {
      await this.incrementInventory(profileId, `fertilized_egg_${type}`, 1);
      return { type: 'egg', message: `Mating complete! Received a fertilized_egg_${type}` };
    } else {
      const readyAt = now + GESTATION_MS;
      await supabase.from('animals').update({ gestation_ready_at: readyAt }).eq('id', damId);
      return { type: 'gestation', message: `Mating complete! ${type} is gestating until ${readyAt}` };
    }
  }

  static async buyIncubator(profileId: string) {
    const cost = await PricingEngine.getIncubatorPrice();
    
    const success = await executeTransfer({
      fromType: 'player', fromId: profileId,
      toType: 'treasury', toId: 'treasury-singleton',
      amount: cost, reason: 'buy_incubator'
    });
    
    if (!success) throw new Error('Insufficient funds');
    
    const { data, error } = await supabase.from('incubators').insert({
      profile_id: profileId,
      purchase_price: cost
    }).select().single();
    
    if (error) {
      await executeTransfer({
        fromType: 'treasury', fromId: 'treasury-singleton',
        toType: 'player', toId: profileId,
        amount: cost, reason: 'buy_incubator_refund'
      });
      throw new Error('Database error creating incubator');
    }
    return data;
  }
  
  static async startIncubation(profileId: string, incubatorId: string, eggType: string) {
    const { data: incubator } = await supabase
      .from('incubators')
      .select('*')
      .eq('id', incubatorId)
      .eq('profile_id', profileId)
      .single();
      
    if (!incubator) throw new Error('Incubator not found');
    if (incubator.egg_type) throw new Error('Incubator is already in use');
    
    const eggItemId = `fertilized_egg_${eggType}`;
    const hasEgg = await this.decrementInventory(profileId, eggItemId, 1);
    if (!hasEgg) throw new Error(`You do not have a ${eggItemId}`);
    
    const startedAt = Date.now();
    const readyAt = startedAt + INCUBATION_MS;
    
    await supabase.from('incubators').update({
      egg_type: eggType,
      started_at: startedAt,
      ready_at: readyAt
    }).eq('id', incubatorId);
    
    return { readyAt };
  }
  
  static async finishIncubation(profileId: string, incubatorId: string) {
    const { data: incubator } = await supabase
      .from('incubators')
      .select('*')
      .eq('id', incubatorId)
      .eq('profile_id', profileId)
      .single();
      
    if (!incubator) throw new Error('Incubator not found');
    if (!incubator.egg_type || !incubator.ready_at) throw new Error('Incubator is empty');
    if (Date.now() < Number(incubator.ready_at)) throw new Error('Incubation not finished');
    
    const baseCost = await PricingEngine.getAnimalPrice(incubator.egg_type);
    
    const { data: newAnimal } = await supabase.from('animals').insert({
      profile_id: profileId,
      animal_type: incubator.egg_type,
      purchase_price: baseCost
    }).select().single();
    
    await supabase.from('incubators').update({
      egg_type: null,
      started_at: null,
      ready_at: null
    }).eq('id', incubatorId);
    
    return newAnimal;
  }
  
  // --- Inventory Helpers ---
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
