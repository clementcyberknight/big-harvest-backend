import type { Redis } from "ioredis";
import { createXai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "../../config/env.js";
import { MAX_TREASURY_GOLD_SUPPLY } from "../../config/constants.js";
import { logger } from "../../infrastructure/logger/logger.js";
import {
  treasuryPricesKey,
  treasuryReserveKey,
  treasurySellFlowKey,
} from "../../infrastructure/redis/keys.js";
import { resolveBaseMicro, PRICED_ITEM_IDS } from "../market/market.catalog.js";
import type {
  MarketEvent,
  MarketEventTrigger,
  PriceDeviation,
} from "./event.types.js";
import crypto from "node:crypto";

const ACTIVE_EVENT_KEY = "ravolo:ai_event:active";
const EVENT_COOLDOWN_KEY = "ravolo:ai_event:cooldown";
const ACTIVE_EVENT_TTL_SEC = 30 * 60;
const AI_COOLDOWN_SEC = 60 * 60;

const marketEventSchema = z.object({
  event: z.string().describe("Short dramatic event title (max 8 words)"),
  description: z
    .string()
    .describe(
      "2–3 vivid sentences explaining the event and its devastating or euphoric impact on farmers and buyers. Be dramatic.",
    ),
  affect: z
    .array(z.string())
    .describe(
      "List of 1–4 game commodity IDs affected. Use only IDs from the provided list.",
    ),
  outcome: z
    .enum(["crash", "surge", "boycott"])
    .describe(
      "'crash' = prices fall sharply. 'surge' = prices spike. 'boycott' = total demand collapse.",
    ),
  impact_multiplier: z
    .number()
    .min(0.02)
    .max(2.0)
    .describe(
      "Price multiplier. crash: 0.30–0.70. surge: 1.25–1.85. boycott: 0.02–0.12.",
    ),
  player_tip: z
    .string()
    .describe("One short sentence of in-game advice for players."),
});

function getCurrentSeason(): string {
  const month = new Date().getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return "Spring";
  if (month >= 6 && month <= 8) return "Summer";
  if (month >= 9 && month <= 11) return "Autumn";
  return "Winter";
}

export async function detectPriceDeviations(
  redis: Redis,
  thresholdPct: number,
): Promise<PriceDeviation[]> {
  const pricesK = treasuryPricesKey();
  const deviations: PriceDeviation[] = [];
  const pipe = redis.multi();
  for (const id of PRICED_ITEM_IDS) pipe.hget(pricesK, id);
  const raw = await pipe.exec();
  if (!raw) return deviations;

  for (let i = 0; i < PRICED_ITEM_IDS.length; i++) {
    const itemId = PRICED_ITEM_IDS[i]!;
    const currentMicro = Number(raw[i]?.[1]) || 0;
    if (currentMicro < 1) continue;
    const baseMicro = resolveBaseMicro(itemId);
    if (baseMicro < 1) continue;
    const deviationPct = ((currentMicro - baseMicro) / baseMicro) * 100;
    if (Math.abs(deviationPct) >= thresholdPct) {
      deviations.push({
        itemId,
        currentMicro,
        baseMicro,
        deviationPct,
        direction: deviationPct > 0 ? "above" : "below",
      });
    }
  }
  return deviations;
}

export async function checkGoldBalance(redis: Redis): Promise<{
  reservePct: number;
  needsInjection: boolean;
  needsDrain: boolean;
}> {
  const reserve = Number(await redis.get(treasuryReserveKey())) || 0;
  const reservePct = (reserve / MAX_TREASURY_GOLD_SUPPLY) * 100;
  return {
    reservePct,
    needsInjection: reservePct < 20,
    needsDrain: reservePct > 80,
  };
}

async function getHighVolumeItems(
  redis: Redis,
  limit: number,
): Promise<string[]> {
  const sellFlowK = treasurySellFlowKey();
  const pipe = redis.multi();
  for (const id of PRICED_ITEM_IDS) pipe.hget(sellFlowK, id);
  const raw = await pipe.exec();
  if (!raw) return [];
  const items = PRICED_ITEM_IDS.map((id, i) => ({
    id,
    flow: Number(raw[i]?.[1]) || 0,
  }));
  items.sort((a, b) => b.flow - a.flow);
  return items.slice(0, limit).map((x) => x.id);
}

export type AiEventContext = {
  deviations?: PriceDeviation[];
  goldBalance?: {
    reservePct: number;
    needsInjection: boolean;
    needsDrain: boolean;
  };
  anomalies?: Array<{
    type: string;
    itemId: string;
    entityId: string;
    description: string;
  }>;
};

export async function generateAiEvent(
  redis: Redis,
  trigger: MarketEventTrigger,
  context: AiEventContext,
): Promise<MarketEvent | null> {
  if (!env.XAI_API_KEY) {
    logger.info(
      "[ai-events] XAI_API_KEY not set — skipping AI event generation",
    );
    return null;
  }

  const ttl = await redis.ttl(EVENT_COOLDOWN_KEY);
  if (ttl > 0) {
    logger.info(
      { remainingSeconds: ttl },
      "[ai-events] AI generation on cooldown",
    );
    return null;
  }

  const season = getCurrentSeason();
  const validIds = new Set(PRICED_ITEM_IDS);
  const highVolumeItems = await getHighVolumeItems(redis, 8);

  let situationContext = "";

  if (context.deviations && context.deviations.length > 0) {
    const devLines = context.deviations
      .map(
        (d) =>
          `  - ${d.itemId}: ${d.deviationPct > 0 ? "+" : ""}${d.deviationPct.toFixed(0)}% from base (${d.direction})`,
      )
      .join("\n");
    situationContext += `\nPRICE ALERT — the following items have deviated significantly:\n${devLines}\n\nYou MUST create an event that CORRECTS these prices:\n- Items that are TOO HIGH → generate a "crash" to bring them DOWN\n- Items that are TOO LOW → generate a "surge" to bring them UP\n`;
  }

  if (context.goldBalance?.needsInjection) {
    situationContext += `\nGOLD SHORTAGE — Treasury reserve is at ${context.goldBalance.reservePct.toFixed(0)}%. Generate a "surge" event targeting HIGH VOLUME items (${highVolumeItems.slice(0, 4).join(", ")}) to encourage selling back to the treasury and inject gold into the economy.\n`;
  }

  if (context.goldBalance?.needsDrain) {
    situationContext += `\nGOLD EXCESS — Treasury reserve is at ${context.goldBalance.reservePct.toFixed(0)}%. Generate a "crash" event to encourage buying from treasury, draining excess gold from the economy.\n`;
  }

  // need to monitor the situation before i implement this
  // if (context.anomalies && context.anomalies.length > 0) {
  //   const aiAnomalies = context.anomalies.filter(a => a.type !== "wash_trading");
  //   if (aiAnomalies.length > 0) {
  //     const anomalyDetails = aiAnomalies
  //       .map((a) => `  - ${a.type.toUpperCase()}: ${a.description}`)
  //       .join("\n");
  //     situationContext += `\nMARKET ABUSE DETECTED — Organized manipulation spotted:\n${anomalyDetails}\n\nYou MUST punish the abusers by generating a punishing event targeting the involved commodities. Create a "crash" or "boycott" event to wipe out their value.\n`;
  //   }
  // }

  let objectResult;
  const aiPrompt = `You are the game master for a dramatic farming simulation game called Ravolo.

Current season: ${season}
High-volume commodities (most traded): ${highVolumeItems.join(", ")}

Available commodity IDs you may use in "affect":
${PRICED_ITEM_IDS.join(", ")}
${situationContext}

Generate ONE dramatic, unpredictable market event that will shock and challenge players.
The event MUST use commodity IDs from the list above.

Multiplier rules:
- CRASH: impact_multiplier 0.30–0.70 (sharp supply shock or oversupply)
- SURGE: impact_multiplier 1.25–1.85 (scarcity, war, or panic buying)
- BOYCOTT: impact_multiplier 0.02–0.12 (near-zero demand)

Be creative, dramatic, and season-appropriate. Vary between all three outcome types.`;

  try {
    const xai = createXai({ apiKey: env.XAI_API_KEY });
    const { object } = await generateObject({
      model: xai("grok-3-mini-fast"),
      schema: marketEventSchema,
      prompt: aiPrompt,
    });
    objectResult = object;
    logger.info("[ai-events] Successfully generated event using grok-3-mini-fast");
  } catch (err) {
    logger.error(
      { err, trigger, context },
      "[ai-events] Grok event generation failed",
    );
    return null;
  }

  const validAffect = objectResult.affect.filter((id) => validIds.has(id));
  if (validAffect.length === 0) {
    logger.info(
      { returnedAffect: objectResult.affect },
      "[ai-events] AI returned no valid commodity IDs",
    );
    return null;
  }

  let multiplier = objectResult.impact_multiplier;
  if (objectResult.outcome === "boycott") {
    multiplier = Math.max(0.02, Math.min(0.12, multiplier));
  } else if (objectResult.outcome === "crash") {
    multiplier = Math.max(0.3, Math.min(0.75, multiplier));
  } else {
    multiplier = Math.max(1.25, Math.min(1.85, multiplier));
  }

  const now = Date.now();
  const event: MarketEvent = {
    id: crypto.randomUUID(),
    title: objectResult.event,
    description: objectResult.description,
    affectedItems: validAffect,
    outcome: objectResult.outcome,
    multiplier,
    playerTip: objectResult.player_tip,
    trigger,
    startsAtMs: now,
    expiresAtMs: now + ACTIVE_EVENT_TTL_SEC * 1000,
  };

  await redis.set(EVENT_COOLDOWN_KEY, "1", "EX", AI_COOLDOWN_SEC);
  return event;
}

export async function setActiveEvent(
  redis: Redis,
  event: MarketEvent,
): Promise<void> {
  await redis.set(
    ACTIVE_EVENT_KEY,
    JSON.stringify(event),
    "EX",
    ACTIVE_EVENT_TTL_SEC,
  );
}

export async function getActiveEvent(
  redis: Redis,
): Promise<MarketEvent | null> {
  const raw = await redis.get(ACTIVE_EVENT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MarketEvent;
  } catch {
    return null;
  }
}

export async function getEventMultiplier(
  redis: Redis,
  itemId: string,
): Promise<number> {
  const event = await getActiveEvent(redis);
  if (!event) return 1.0;
  if (Date.now() > event.expiresAtMs) return 1.0;
  if (!event.affectedItems.includes(itemId)) return 1.0;
  return event.multiplier;
}
