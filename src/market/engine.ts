/**
 * Market price engine.
 */

import { request } from "undici";
import { env } from "../config/env.js";
import { GAME_CROPS } from "./crops.js";
import type { GameCropDef, RecipeIngredient } from "./crops.js";
import { getEventMultiplierFor } from "./events.js";

export type {
  CommodityCategory,
  RecipeIngredient,
  GameCropDef,
} from "./crops.js";
export { GAME_CROPS } from "./crops.js";

const MARKET_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RAPIDAPI_COMMODITIES_URL =
  "https://investing-real-time.p.rapidapi.com/markets/commodities";

const API_PEG: Record<string, string> = {
  "US Wheat": "wheat",
  "US Corn": "corn",
  "US Soybeans": "soybeans",
  "US Sugar #11": "sugarcane",
  "US Cotton #2": "cotton",
  "US Coffee C": "coffee",
};

const ALL_PEGS = [
  "wheat",
  "corn",
  "soybeans",
  "sugarcane",
  "cotton",
  "coffee",
] as const;

export interface GameCommodity {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | "special";
  category: GameCropDef["category"];
  base_price: number;
  multiplier: number;
  event_multiplier: number;
  sell_price: number;
  recipe?: RecipeIngredient[];
}

interface PegData {
  multipliers: Record<string, number>;
  realPrices: Record<string, number>;
}

interface CommodityPair {
  pair_name?: string;
  last?: string;
  change_percent_val?: string;
}

interface RapidApiResponse {
  status_code?: number;
  data?: { pairs_data?: CommodityPair[] };
}

let gameCommodityCache: GameCommodity[] = [];
let commodityCacheFetchedAt: Date | null = null;
let lastUpdate = 0;
let referencePrices: Record<string, number> = {};
let lastPegData: PegData | null = null;

function parseRealPrice(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const num = parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function changeToMultiplier(changePercent: string | undefined): number {
  const change = parseFloat(changePercent ?? "0");
  if (!Number.isFinite(change)) return 1.0;
  return Math.max(0.5, Math.min(2, 1 + change / 100));
}

function buildGameCommodities(
  pegData: PegData,
  refPrices: Record<string, number>,
): GameCommodity[] {
  const { multipliers, realPrices } = pegData;

  return GAME_CROPS.map((crop) => {
    const mult = multipliers[crop.peg] ?? 1.0;
    const currentReal = realPrices[crop.peg];
    const refReal = refPrices[crop.peg];
    const priceScale =
      currentReal != null && refReal != null && refReal > 0
        ? Math.max(0.5, Math.min(2, currentReal / refReal))
        : 1.0;

    const effectiveBase = crop.base_price * priceScale;
    const eventMult = getEventMultiplierFor(crop.id);

    const sellPrice = Math.round(effectiveBase * mult * eventMult * 100) / 100;

    return {
      id: crop.id,
      name: crop.name,
      tier: crop.tier,
      category: crop.category,
      base_price: Math.round(effectiveBase * 100) / 100,
      multiplier: mult,
      event_multiplier: eventMult,
      sell_price: sellPrice,
      recipe: crop.recipe,
    };
  });
}

// ── RapidAPI fetch ───────────────────────────────────────────────────────────

async function fetchCommodityData(): Promise<PegData | null> {
  if (!env.rapidApiKey) return null;

  try {
    const { statusCode, body } = await request(RAPIDAPI_COMMODITIES_URL, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": "investing-real-time.p.rapidapi.com",
        "x-rapidapi-key": env.rapidApiKey,
      },
    });

    if (statusCode !== 200) return null;

    const json = (await body.json()) as RapidApiResponse;
    const pairs = json?.data?.pairs_data;
    if (!Array.isArray(pairs)) return null;

    const multipliers: Record<string, number> = {};
    const realPrices: Record<string, number> = {};

    for (const pair of pairs) {
      const pegKey = API_PEG[pair.pair_name ?? ""];
      if (pegKey) {
        multipliers[pegKey] = changeToMultiplier(pair.change_percent_val);
        const price = parseRealPrice(pair.last);
        if (price != null) realPrices[pegKey] = price;
      }
    }

    return { multipliers, realPrices };
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Rebuild the commodity cache with fresh event multipliers.
 *  Falls back to default pegs (1.0) if no RapidAPI data has arrived yet. */
export function rebuildWithCurrentEvent(): void {
  const pegData = lastPegData ?? {
    multipliers: Object.fromEntries(ALL_PEGS.map((p) => [p, 1.0])),
    realPrices: {},
  };
  gameCommodityCache = buildGameCommodities(pegData, referencePrices);
}

export function getGameCommodities(): {
  commodities: GameCommodity[];
  fetched_at: string | null;
} {
  return {
    commodities: [...gameCommodityCache],
    fetched_at: commodityCacheFetchedAt?.toISOString() ?? null,
  };
}

export function computeMultipliers(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of gameCommodityCache) {
    out[c.id] = c.multiplier;
  }
  return out;
}

export async function updateMarketPrices(): Promise<Record<string, number>> {
  const data = await fetchCommodityData();
  if (data) {
    if (
      Object.keys(referencePrices).length === 0 &&
      Object.keys(data.realPrices).length > 0
    ) {
      referencePrices = { ...data.realPrices };
    }
    lastPegData = data;
    gameCommodityCache = buildGameCommodities(data, referencePrices);
    commodityCacheFetchedAt = new Date();
    lastUpdate = Date.now();
  }
  // On API failure: keep existing cache unchanged
  return computeMultipliers();
}

export function getMarketPulse(): {
  multipliers: Record<string, number>;
  timestamp: number;
} {
  return {
    multipliers: computeMultipliers(),
    timestamp: Math.floor(lastUpdate / 1000) || Math.floor(Date.now() / 1000),
  };
}

export function startMarketEngine(
  onUpdate: (pulse: {
    multipliers: Record<string, number>;
    timestamp: number;
  }) => void,
): NodeJS.Timeout {
  if (gameCommodityCache.length === 0) {
    const defaultPegs: Record<string, number> = {};
    for (const peg of ALL_PEGS) defaultPegs[peg] = 1.0;
    gameCommodityCache = buildGameCommodities(
      { multipliers: defaultPegs, realPrices: {} },
      {},
    );
  }

  const tick = async () => {
    const pulse = await updateMarketPrices().then(getMarketPulse);
    onUpdate(pulse);
  };

  void tick();
  return setInterval(tick, MARKET_UPDATE_INTERVAL_MS);
}
