/**
 * Game time engine — single source of truth for all game timing.
 * 1 real minute = 1 game day. See README for full timing reference.
 */

export const GAME_DAY_MS = 60_000 as const;
export const SEASON_LENGTH_DAYS = 7 as const;
export const SEASONS_PER_YEAR = 4 as const;
export const YEAR_LENGTH_DAYS = SEASON_LENGTH_DAYS * SEASONS_PER_YEAR;
export const MAX_HARVEST_BOOST = 0.25 as const;

// ── Crop growth ───────────────────────────────────────────────────────────────

export const CROP_GROWTH_DAYS = {
  1:       1,
  2:       2,
  3:       5,
  special: 3,
} as const satisfies Record<1 | 2 | 3 | "special", number>;

export function cropGrowthMs(tier: keyof typeof CROP_GROWTH_DAYS): number {
  return CROP_GROWTH_DAYS[tier] * GAME_DAY_MS;
}

export function harvestReadyAt(
  plantedAtMs: number,
  tier: keyof typeof CROP_GROWTH_DAYS,
): number {
  return plantedAtMs + cropGrowthMs(tier);
}

export function isHarvestReady(
  plantedAtMs: number,
  tier: keyof typeof CROP_GROWTH_DAYS,
  boosted = false,
): boolean {
  const growthMs = cropGrowthMs(tier);
  const requiredMs = boosted ? growthMs * (1 - MAX_HARVEST_BOOST) : growthMs;
  return Date.now() - plantedAtMs >= requiredMs;
}

// ── Animal production ─────────────────────────────────────────────────────────

export const ANIMAL_PRODUCTION_MS = {
  chicken:  1 * GAME_DAY_MS,
  cow:      4 * GAME_DAY_MS,
  bee:      8 * GAME_DAY_MS,
  pig:     12 * GAME_DAY_MS,
  sheep:    6 * GAME_DAY_MS,
} as const;

export type AnimalType = keyof typeof ANIMAL_PRODUCTION_MS;

export function isProductionReady(startedAtMs: number, animal: AnimalType): boolean {
  return Date.now() - startedAtMs >= ANIMAL_PRODUCTION_MS[animal];
}

export function productionReadyAt(startedAtMs: number, animal: AnimalType): number {
  return startedAtMs + ANIMAL_PRODUCTION_MS[animal];
}

// ── Crafting ──────────────────────────────────────────────────────────────────

export const CRAFTING_TIME_MS = {
  1: 30_000,
  2: 60_000,
  3: 2 * 60_000,
} as const;

export type CraftingLayer = keyof typeof CRAFTING_TIME_MS;

export function craftingMs(layer: CraftingLayer): number {
  return CRAFTING_TIME_MS[layer];
}

// ── Season / Clock ────────────────────────────────────────────────────────────

export type Season = "spring" | "summer" | "autumn" | "winter";

const SEASON_ORDER: readonly Season[] = ["spring", "summer", "autumn", "winter"];

const EPOCH = Date.now();

export interface GameTime {
  year: number;
  season: Season;
  season_day: number;
  total_days: number;
  real_time: number;
  next_day_at: number;
  next_season_at: number;
}

export function getCurrentGameTime(): GameTime {
  const now = Date.now();
  const totalDays = Math.floor((now - EPOCH) / GAME_DAY_MS);

  const yearIndex = Math.floor(totalDays / YEAR_LENGTH_DAYS);
  const dayInYear = totalDays % YEAR_LENGTH_DAYS;
  const seasonIndex = Math.floor(dayInYear / SEASON_LENGTH_DAYS);
  const seasonDay = (dayInYear % SEASON_LENGTH_DAYS) + 1;

  const nextDayAt = EPOCH + (totalDays + 1) * GAME_DAY_MS;
  const nextSeasonAt =
    EPOCH + (Math.floor(totalDays / SEASON_LENGTH_DAYS) + 1) * SEASON_LENGTH_DAYS * GAME_DAY_MS;

  return {
    year: yearIndex + 1,
    season: SEASON_ORDER[seasonIndex] ?? "spring",
    season_day: seasonDay,
    total_days: totalDays,
    real_time: now,
    next_day_at: nextDayAt,
    next_season_at: nextSeasonAt,
  };
}

export function startGameClock(
  onDayChange: (time: GameTime) => void,
  onSeasonChange: (time: GameTime) => void | Promise<void>,
): NodeJS.Timeout {
  const initial = getCurrentGameTime();
  let lastTotalDays = initial.total_days;
  let lastSeason: Season = initial.season;

  return setInterval(() => {
    const time = getCurrentGameTime();
    if (time.total_days <= lastTotalDays) return;

    if (time.season !== lastSeason) void onSeasonChange(time);
    onDayChange(time);

    lastTotalDays = time.total_days;
    lastSeason = time.season;
  }, 10_000);
}
