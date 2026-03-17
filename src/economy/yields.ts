import { GAME_CROPS, GameCropDef } from '../market/crops.js';

export type PlotTier = 'starter' | 'fertile' | 'premium';

export function calculateYield(cropId: string, plotTier: PlotTier, isBoosted: boolean): number {
  const crop = GAME_CROPS.find(c => c.id === cropId);
  if (!crop) return 0; // Invalid crop

  let min = 1;
  let max = 2; // Default fallback

  // Base yields per seed tier as defined in architecture
  if (crop.tier === 1) {
    min = 1; max = 3;
  } else if (crop.tier === 2) {
    min = 1; max = 4;
  } else if (crop.tier === 3 || crop.tier === 'special') {
    min = 1; max = 2;
  }

  // Plot soil bonus
  let bonus = 0;
  if (plotTier === 'fertile' || plotTier === 'premium') {
    bonus += 1; // +1 yield range shift
  }

  // Fertilizer boost
  if (isBoosted) {
    bonus += 1;
  }

  // Calculate random yield in range, shifted by bonuses
  const baseYield = Math.floor(Math.random() * (max - min + 1)) + min;
  
  return baseYield + bonus;
}

/**
 * Calculates time needed to grow in MS, factoring in plot tier speed boost.
 */
export function calculateGrowthTimeMs(crop: GameCropDef, plotTier: PlotTier): number {
  // Base growth times (e.g. 1 min, 5 min, etc.)
  // For the sake of this example, we use generic layer times defined locally or from clock.ts
  const TIER1_MS = 60 * 1000;
  const TIER2_MS = 2 * 60 * 1000;
  const TIER3_MS = 5 * 60 * 1000;
  const SPECIAL_MS = 10 * 60 * 1000;

  let baseMs = TIER1_MS;
  if (crop.tier === 2) baseMs = TIER2_MS;
  if (crop.tier === 3) baseMs = TIER3_MS;
  if (crop.tier === 'special') baseMs = SPECIAL_MS;

  // Premium plot gets 10% faster growth
  if (plotTier === 'premium') {
    baseMs = Math.floor(baseMs * 0.9);
  }

  return baseMs;
}

/**
 * Wither window = 2× growth time. If a crop sits unharvested beyond this, it dies.
 */
export const WITHER_MULTIPLIER = 2;

export function getWitherWindowMs(crop: GameCropDef, plotTier: PlotTier): number {
  return calculateGrowthTimeMs(crop, plotTier) * WITHER_MULTIPLIER;
}

export function isWithered(plantedAtMs: number, crop: GameCropDef, plotTier: PlotTier): boolean {
  const growthMs = calculateGrowthTimeMs(crop, plotTier);
  const witherMs = getWitherWindowMs(crop, plotTier);
  return Date.now() > plantedAtMs + growthMs + witherMs;
}
