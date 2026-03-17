import { supabase } from '../db/supabase.js';

const ANIMAL_CYCLE_MS = 10 * 60 * 1000; // 10 minutes per cycle

const DROPS: Record<string, { normal: string[], rare?: { id: string, chance: number } }> = {
  chicken: { normal: ['egg'], rare: { id: 'golden_egg', chance: 0.05 } },
  cow: { normal: ['milk'], rare: { id: 'rich_milk', chance: 0.08 } },
  bee: { normal: ['honeycomb', 'raw_honey'], rare: { id: 'royal_jelly', chance: 0.03 } },
  pig: { normal: ['pork'], rare: { id: 'truffle', chance: 0.04 } },
  sheep: { normal: ['raw_wool'] }
};

export class AnimalEngine {

  static async collect(profileId: string, animalId: string) {
    const { data: animal } = await supabase
      .from('animals')
      .select('animal_type, last_collected')
      .eq('id', animalId)
      .eq('profile_id', profileId)
      .single();

    if (!animal) throw new Error('Animal not found or does not belong to you');

    const now = Date.now();
    const lastCollected = animal.last_collected ? Number(animal.last_collected) : 0;
    
    if (now < lastCollected + ANIMAL_CYCLE_MS) {
      throw new Error('Animal not ready for collection');
    }

    const dropConfig = DROPS[animal.animal_type];
    if (!dropConfig) throw new Error('Unknown animal type');

    const itemsToAdd: { id: string, qty: number }[] = [];
    
    for (const normalId of dropConfig.normal) {
      itemsToAdd.push({ id: normalId, qty: 1 });
    }

    let rareDropped = false;
    if (dropConfig.rare && Math.random() < dropConfig.rare.chance) {
      itemsToAdd.push({ id: dropConfig.rare.id, qty: 1 });
      rareDropped = true;
    }

    // Update animal collection time
    await supabase.from('animals').update({
      last_collected: now
    }).eq('id', animalId);

    // Give items to inventory
    for (const item of itemsToAdd) {
      const { data } = await supabase.from('inventory')
        .select('id, quantity').eq('profile_id', profileId).eq('item_id', item.id).maybeSingle();
      
      if (data) {
        await supabase.from('inventory').update({ quantity: data.quantity + item.qty }).eq('id', data.id);
      } else {
        await supabase.from('inventory').insert({ profile_id: profileId, item_id: item.id, quantity: item.qty });
      }
    }

    return { 
      items: itemsToAdd, 
      rare: rareDropped,
      xp: 15
    };
  }
}
