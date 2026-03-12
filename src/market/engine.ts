/**
 * Market price engine - fetches commodity data from RapidAPI, computes game crop prices.
 * 18 farming game crops pegged to real commodities. No random fallback; cache persists on API failure.
 */

import { request } from "undici";
import { env } from "../config/env.js";

const MARKET_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RAPIDAPI_COMMODITIES_URL =
  "https://investing-real-time.p.rapidapi.com/markets/commodities";

// Peg keys used to derive multipliers from API
const PEG_WHEAT = "wheat";
const PEG_CORN = "corn";
const PEG_SOYBEANS = "soybeans";
const PEG_SUGARCANE = "sugarcane";
const PEG_COTTON = "cotton";
const PEG_COFFEE = "coffee";

const API_PEG: Record<string, string> = {
  "US Wheat": PEG_WHEAT,
  "US Corn": PEG_CORN,
  "US Soybeans": PEG_SOYBEANS,
  "US Sugar #11": PEG_SUGARCANE,
  "US Cotton #2": PEG_COTTON,
  "US Coffee C": PEG_COFFEE,
};

export interface GameCropDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | "special";
  base_price: number;
  peg: string;
}

export const GAME_CROPS: GameCropDef[] = [
  { id: "wheat", name: "Wheat", tier: 1, base_price: 15, peg: PEG_WHEAT },
  { id: "carrot", name: "Carrot", tier: 1, base_price: 22, peg: PEG_WHEAT },
  { id: "corn", name: "Corn", tier: 1, base_price: 18, peg: PEG_CORN },
  { id: "lettuce", name: "Lettuce", tier: 1, base_price: 20, peg: PEG_WHEAT },
  { id: "tomato", name: "Tomato", tier: 2, base_price: 55, peg: PEG_CORN },
  { id: "sugarcane", name: "Sugarcane", tier: 2, base_price: 70, peg: PEG_SUGARCANE },
  { id: "potato", name: "Potato", tier: 2, base_price: 75, peg: PEG_CORN },
  { id: "cotton", name: "Cotton", tier: 2, base_price: 90, peg: PEG_COTTON },
  { id: "sunflower", name: "Sunflower", tier: 2, base_price: 95, peg: PEG_SOYBEANS },
  { id: "pumpkin", name: "Pumpkin", tier: 3, base_price: 180, peg: PEG_CORN },
  { id: "watermelon", name: "Watermelon", tier: 3, base_price: 350, peg: PEG_SUGARCANE },
  { id: "strawberries", name: "Strawberries", tier: 3, base_price: 200, peg: PEG_SUGARCANE },
  { id: "blueberries", name: "Blueberries", tier: 3, base_price: 220, peg: PEG_SUGARCANE },
  { id: "coffee", name: "Coffee Beans", tier: 3, base_price: 280, peg: PEG_COFFEE },
  { id: "indigo", name: "Indigo Flower", tier: "special", base_price: 150, peg: PEG_COTTON },
  { id: "marigold", name: "Marigold", tier: "special", base_price: 130, peg: PEG_COTTON },
  { id: "madder", name: "Madder Root", tier: "special", base_price: 160, peg: PEG_COTTON },
];

export interface GameCommodity {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | "special";
  base_price: number;
  multiplier: number;
  sell_price: number;
}

let gameCommodityCache: GameCommodity[] = [];
let commodityCacheFetchedAt: Date | null = null;
let lastUpdate = 0;

interface CommodityPair {
  pair_name?: string;
  change_percent_val?: string;
}

interface RapidApiResponse {
  status_code?: number;
  data?: {
    pairs_data?: CommodityPair[];
  };
}

/**
 * Compute multiplier from % change. Base 1.0 + (change/100), clamped to 0.5-2.0.
 */
function changeToMultiplier(changePercent: string | undefined): number {
  const change = parseFloat(changePercent ?? "0");
  if (!Number.isFinite(change)) return 1.0;
  const mult = 1 + change / 100;
  return Math.max(0.5, Math.min(2, mult));
}

function buildGameCommodities(multipliers: Record<string, number>): GameCommodity[] {
  return GAME_CROPS.map((crop) => {
    const mult = multipliers[crop.peg] ?? 1.0;
    const sellPrice = Math.round(crop.base_price * mult * 100) / 100;
    return {
      id: crop.id,
      name: crop.name,
      tier: crop.tier,
      base_price: crop.base_price,
      multiplier: mult,
      sell_price: sellPrice,
    };
  });
}

async function fetchCommodityData(): Promise<Record<string, number> | null> {
  if (!env.rapidApiKey) {
    return null;
  }

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

    const result: Record<string, number> = {};

    for (const pair of pairs) {
      const pairName = pair.pair_name ?? "";
      const pegKey = API_PEG[pairName];
      if (pegKey) {
        result[pegKey] = changeToMultiplier(pair.change_percent_val);
      }
    }

    return result;
  } catch {
    return null;
  }
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
    gameCommodityCache = buildGameCommodities(data);
    commodityCacheFetchedAt = new Date();
    lastUpdate = Date.now();
  }
  // On API failure: do nothing, keep existing cache
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
  // Seed with defaults (multiplier 1.0) so frontend always has 18 crops
  const defaultMultipliers: Record<string, number> = {};
  for (const peg of [PEG_WHEAT, PEG_CORN, PEG_SOYBEANS, PEG_SUGARCANE, PEG_COTTON, PEG_COFFEE]) {
    defaultMultipliers[peg] = 1.0;
  }
  if (gameCommodityCache.length === 0) {
    gameCommodityCache = buildGameCommodities(defaultMultipliers);
  }

  const tick = async () => {
    const pulse = await updateMarketPrices().then(getMarketPulse);
    onUpdate(pulse);
  };

  void tick(); // initial
  return setInterval(tick, MARKET_UPDATE_INTERVAL_MS);
}
