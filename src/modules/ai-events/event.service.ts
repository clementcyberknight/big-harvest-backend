import crypto from "node:crypto";
import type { Redis } from "ioredis";
import { generateObject } from "ai";
import { createXai } from "@ai-sdk/xai";
import { z } from "zod";
import {
  AI_EVENT_ACTIVE_TTL_SEC,
  AI_EVENT_HISTORY_LIMIT,
  AI_EVENT_PRESSURE_THRESHOLDS,
  AI_PRESSURE_DECAY_PER_TICK,
  AI_PRESSURE_MAX,
  AI_PRESSURE_RESET_BPS,
  AI_TIER_COOLDOWN_SEC,
  MAX_TREASURY_GOLD_SUPPLY,
} from "../../config/constants.js";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logger/logger.js";
import {
  aiEventActiveKey,
  aiEventCooldownKey,
  aiEventHistoryKey,
  aiEventPressureKey,
  treasuryPricesKey,
  treasuryReserveKey,
  treasurySellFlowKey,
} from "../../infrastructure/redis/keys.js";
import { PRICED_ITEM_IDS, resolveBaseMicro } from "../market/market.catalog.js";
import type { MarketAnomaly } from "../analytics/analytics.types.js";
import type {
  AiEventHistoryEntry,
  AiEventTier,
  AiPressureState,
  AiSignalSnapshot,
  AiTierDecision,
  GenerateFastEventInput,
  GenerateNarrativeAiEventInput,
  MarketEvent,
  MarketEventOutcome,
  MarketEventTrigger,
  PriceDeviation,
} from "./event.types.js";

function getCurrentSeason(): string {
  const month = new Date().getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return "Spring";
  if (month >= 6 && month <= 8) return "Summer";
  if (month >= 9 && month <= 11) return "Autumn";
  return "Winter";
}

const ACTIVE_EVENT_KEY = aiEventActiveKey();
const AI_PRESSURE_KEY = aiEventPressureKey();
const AI_EVENT_HISTORY_KEY = aiEventHistoryKey();
const PRESSURE_SCALE_BPS = 10_000;
const RECENT_ITEM_WINDOW_MS = 45 * 60 * 1000;
const RECENT_OUTCOME_WINDOW_MS = 30 * 60 * 1000;
const RECENT_TEMPLATE_WINDOW_MS = 60 * 60 * 1000;
const DEVIATION_SCORE_CAP = 90;
const GOLD_SCORE_CAP = 75;
const ANOMALY_SCORE_CAP = 80;

const FAST_EVENT_TEMPLATES = {
  price_crash_micro: {
    title: "Market Cool-Off",
    description:
      "Traders are stepping back after a short-lived rush. Treasury buyers are offering softer prices on the hottest commodities.",
    playerTip: "Sell diversified stock instead of piling into a single inflated item.",
    outcome: "crash" as const,
    templateKey: "price_crash_micro",
    multiplierByTier: {
      micro: 0.95,
      minor: 0.9,
      medium: 0.78,
    },
  },
  price_surge_micro: {
    title: "Supply Squeeze",
    description:
      "Buyers are scrambling to secure stock after inventories tightened. Treasury prices are climbing for scarce goods.",
    playerTip: "If you have inventory ready, this is a strong window to sell.",
    outcome: "surge" as const,
    templateKey: "price_surge_micro",
    multiplierByTier: {
      micro: 1.06,
      minor: 1.14,
      medium: 1.28,
    },
  },
  reserve_surge: {
    title: "Treasury Buyback Drive",
    description:
      "The treasury is paying up to pull more produce back into reserve circulation. High-volume commodities are seeing stronger bids.",
    playerTip: "Move fast on the busiest commodities while the treasury is injecting demand.",
    outcome: "surge" as const,
    templateKey: "reserve_surge",
    multiplierByTier: {
      micro: 1.05,
      minor: 1.12,
      medium: 1.25,
    },
  },
  reserve_crash: {
    title: "Reserve Tightening",
    description:
      "Officials are cooling overheated reserve balances by marking down rich treasury offers. Inflated commodities lose some of their premium.",
    playerTip: "Avoid overexposed items until reserve pressure settles.",
    outcome: "crash" as const,
    templateKey: "reserve_crash",
    multiplierByTier: {
      micro: 0.96,
      minor: 0.9,
      medium: 0.76,
    },
  },
  anomaly_boycott: {
    title: "Trader Boycott",
    description:
      "Suspicious activity has rattled confidence across the exchange. Buyers are refusing to pay normal rates on tainted goods.",
    playerTip: "Wait out the panic or move into unaffected commodities.",
    outcome: "boycott" as const,
    templateKey: "anomaly_boycott",
    multiplierByTier: {
      micro: 0.11,
      minor: 0.09,
      medium: 0.06,
    },
  },
} as const;

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

export async function getHighVolumeItems(
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tierMultiplier(
  tier: Exclude<AiEventTier, "medium" | "major">,
  template: keyof typeof FAST_EVENT_TEMPLATES,
): number {
  return FAST_EVENT_TEMPLATES[template].multiplierByTier[tier];
}

function normalizeTemplateMultiplier(
  outcome: MarketEventOutcome,
  multiplier: number,
): number {
  if (outcome === "boycott") return clamp(multiplier, 0.02, 0.12);
  if (outcome === "crash") return clamp(multiplier, 0.3, 0.75);
  return clamp(multiplier, 1.25, 1.85);
}

function resolveTierFromPressure(pressure: number): AiTierDecision {
  if (pressure >= AI_EVENT_PRESSURE_THRESHOLDS.major) return { tier: "major", pressure };
  if (pressure >= AI_EVENT_PRESSURE_THRESHOLDS.medium) return { tier: "medium", pressure };
  if (pressure >= AI_EVENT_PRESSURE_THRESHOLDS.minor) return { tier: "minor", pressure };
  if (pressure >= AI_EVENT_PRESSURE_THRESHOLDS.micro) return { tier: "micro", pressure };
  return { tier: "none", pressure };
}

function computeTrigger(signal: AiSignalSnapshot): MarketEventTrigger {
  if (signal.dominantType === "analytics_anomaly") return "analytics_anomaly";
  if (signal.dominantType === "gold_imbalance") return "gold_imbalance";
  if (signal.dominantType === "price_deviation") return "price_deviation";
  return "pressure_release";
}

function scorePriceDeviation(deviations: PriceDeviation[]): number {
  if (deviations.length === 0) return 0;
  const topAbsPct = Math.max(...deviations.map((d) => Math.abs(d.deviationPct)));
  return clamp(Math.round(deviations.length * 7 + topAbsPct * 0.45), 0, DEVIATION_SCORE_CAP);
}

function scoreGoldBalance(reservePct: number, needsInjection: boolean, needsDrain: boolean): number {
  if (!needsInjection && !needsDrain) return 0;
  const distance = needsInjection ? 20 - reservePct : reservePct - 80;
  return clamp(Math.round(distance * 3), 0, GOLD_SCORE_CAP);
}

function scoreAnomalies(anomalies: MarketAnomaly[]): number {
  if (anomalies.length === 0) return 0;
  const severity = anomalies.reduce((sum, anomaly) => sum + Math.round((anomaly.severity ?? 0.5) * 30), 0);
  return clamp(severity, 0, ANOMALY_SCORE_CAP);
}

function chooseDominantType(scores: Record<"price_deviation" | "gold_imbalance" | "analytics_anomaly", number>): AiSignalSnapshot["dominantType"] {
  const entries = Object.entries(scores) as Array<[
    "price_deviation" | "gold_imbalance" | "analytics_anomaly",
    number,
  ]>;
  entries.sort((a, b) => b[1] - a[1]);
  if (entries[0]?.[1] === 0) return "mixed";
  if ((entries[0]?.[1] ?? 0) === (entries[1]?.[1] ?? -1)) return "mixed";
  return entries[0]![0];
}

function createDrivers(
  deviations: PriceDeviation[],
  goldBalance: {
    reservePct: number;
    needsInjection: boolean;
    needsDrain: boolean;
  },
  anomalies: MarketAnomaly[],
): string[] {
  const drivers: string[] = [];
  for (const deviation of deviations.slice(0, 3)) {
    drivers.push(
      `${deviation.itemId}:${deviation.direction}:${Math.round(Math.abs(deviation.deviationPct))}pct`,
    );
  }
  if (goldBalance.needsInjection) {
    drivers.push(`gold_shortage:${goldBalance.reservePct.toFixed(1)}pct`);
  }
  if (goldBalance.needsDrain) {
    drivers.push(`gold_excess:${goldBalance.reservePct.toFixed(1)}pct`);
  }
  for (const anomaly of anomalies.slice(0, 3)) {
    drivers.push(`anomaly:${anomaly.type}:${anomaly.itemId}`);
  }
  return drivers;
}

function historyTooRepetitive(
  event: MarketEvent,
  history: AiEventHistoryEntry[],
  templateKey: string | null,
  nowMs: number,
): boolean {
  const primaryItemId = event.affectedItems[0] ?? null;
  const recentSameTemplate = history.some(
    (entry) =>
      entry.templateKey &&
      templateKey &&
      entry.templateKey === templateKey &&
      nowMs - entry.createdAtMs < RECENT_TEMPLATE_WINDOW_MS,
  );
  if (recentSameTemplate) return true;

  const recentSameOutcome = history.filter(
    (entry) =>
      entry.outcome === event.outcome &&
      nowMs - entry.createdAtMs < RECENT_OUTCOME_WINDOW_MS,
  ).length;
  if (recentSameOutcome >= 2) return true;

  if (primaryItemId) {
    const recentSameItem = history.filter(
      (entry) =>
        entry.primaryItemId === primaryItemId &&
        nowMs - entry.createdAtMs < RECENT_ITEM_WINDOW_MS,
    ).length;
    if (recentSameItem >= 2) return true;
  }

  return false;
}

function selectItemsForFastEvent(
  signal: AiSignalSnapshot,
  outcome: MarketEventOutcome,
  maxItems: number,
): string[] {
  if (signal.anomalies.length > 0 && outcome === "boycott") {
    return [...new Set(signal.anomalies.map((a) => a.itemId))].slice(0, maxItems);
  }

  if (outcome === "surge") {
    const below = signal.deviations
      .filter((d) => d.direction === "below")
      .sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct))
      .map((d) => d.itemId);
    if (below.length > 0) return below.slice(0, maxItems);
  }

  if (outcome === "crash") {
    const above = signal.deviations
      .filter((d) => d.direction === "above")
      .sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct))
      .map((d) => d.itemId);
    if (above.length > 0) return above.slice(0, maxItems);
  }

  const fallback = signal.deviations.map((d) => d.itemId);
  return [...new Set(fallback)].slice(0, maxItems);
}

export async function collectAiSignals(redis: Redis): Promise<AiSignalSnapshot> {
  const [deviations, goldBalance, anomalies] = await Promise.all([
    detectPriceDeviations(redis, 60),
    checkGoldBalance(redis),
    new (await import("../analytics/analytics.service.js")).AnalyticsService(redis).runPeriodicAnalysis(),
  ]);

  const priceScore = scorePriceDeviation(deviations);
  const goldScore = scoreGoldBalance(
    goldBalance.reservePct,
    goldBalance.needsInjection,
    goldBalance.needsDrain,
  );
  const anomalyScore = scoreAnomalies(anomalies);

  const dominantType = chooseDominantType({
    price_deviation: priceScore,
    gold_imbalance: goldScore,
    analytics_anomaly: anomalyScore,
  });

  const topDeviationAbsPct =
    deviations.length > 0
      ? Math.max(...deviations.map((d) => Math.abs(d.deviationPct)))
      : 0;

  const pressureDelta = clamp(priceScore + goldScore + anomalyScore, 0, 180);

  return {
    pressureDelta,
    dominantType,
    drivers: createDrivers(deviations, goldBalance, anomalies),
    metrics: {
      deviationCount: deviations.length,
      reservePct: goldBalance.reservePct,
      anomalyCount: anomalies.length,
      topDeviationAbsPct,
    },
    deviations,
    goldBalance,
    anomalies: anomalies.map((anomaly) => ({
      type: anomaly.type,
      itemId: anomaly.itemId,
      entityId: anomaly.entityId,
      description: anomaly.description,
      severity: anomaly.severity,
    })),
  };
}

export async function getAiPressure(redis: Redis): Promise<AiPressureState> {
  const raw = await redis.get(AI_PRESSURE_KEY);
  if (!raw) return { value: 0, updatedAtMs: 0 };
  try {
    const parsed = JSON.parse(raw) as AiPressureState;
    return {
      value: clamp(Math.floor(parsed.value || 0), 0, AI_PRESSURE_MAX),
      updatedAtMs: Math.floor(parsed.updatedAtMs || 0),
    };
  } catch {
    return { value: 0, updatedAtMs: 0 };
  }
}

export async function setAiPressure(redis: Redis, state: AiPressureState): Promise<void> {
  await redis.set(AI_PRESSURE_KEY, JSON.stringify(state));
}

export function computeNextPressure(previousPressure: number, signal: AiSignalSnapshot): number {
  return clamp(previousPressure + signal.pressureDelta - AI_PRESSURE_DECAY_PER_TICK, 0, AI_PRESSURE_MAX);
}

export function decideEventTier(pressure: number): AiTierDecision {
  return resolveTierFromPressure(pressure);
}

export async function getTierCooldownTtl(redis: Redis, tier: AiEventTier): Promise<number> {
  const ttl = await redis.ttl(aiEventCooldownKey(tier));
  return Math.max(0, ttl);
}

export async function setTierCooldown(redis: Redis, tier: AiEventTier): Promise<void> {
  await redis.set(aiEventCooldownKey(tier), "1", "EX", AI_TIER_COOLDOWN_SEC[tier]);
}

export async function getAiEventHistory(redis: Redis): Promise<AiEventHistoryEntry[]> {
  const rows = await redis.lrange(AI_EVENT_HISTORY_KEY, 0, AI_EVENT_HISTORY_LIMIT - 1);
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row) as AiEventHistoryEntry];
    } catch {
      return [];
    }
  });
}

export async function appendAiEventHistory(
  redis: Redis,
  entry: AiEventHistoryEntry,
): Promise<void> {
  const multi = redis.multi();
  multi.lpush(AI_EVENT_HISTORY_KEY, JSON.stringify(entry));
  multi.ltrim(AI_EVENT_HISTORY_KEY, 0, AI_EVENT_HISTORY_LIMIT - 1);
  await multi.exec();
}

export async function generateFastEvent(
  redis: Redis,
  input: GenerateFastEventInput,
): Promise<{ event: MarketEvent; templateKey: string } | null> {
  const { tier, trigger, pressure, signal, nowMs, history } = input;
  const highVolumeItems = await getHighVolumeItems(redis, 4);

  let templateKey: keyof typeof FAST_EVENT_TEMPLATES;
  if (signal.anomalies.length > 0) {
    templateKey = "anomaly_boycott";
  } else if (signal.goldBalance.needsInjection) {
    templateKey = "reserve_surge";
  } else if (signal.goldBalance.needsDrain) {
    templateKey = "reserve_crash";
  } else {
    const moreAbove = signal.deviations.filter((d) => d.direction === "above").length;
    const moreBelow = signal.deviations.filter((d) => d.direction === "below").length;
    templateKey = moreBelow > moreAbove ? "price_surge_micro" : "price_crash_micro";
  }

  const template = FAST_EVENT_TEMPLATES[templateKey];
  const affectedItems =
    selectItemsForFastEvent(signal, template.outcome, tier === "micro" ? 1 : tier === "minor" ? 2 : 3)
      .concat(
        (templateKey === "reserve_surge" ? highVolumeItems : []).filter(
          (item) => !signal.deviations.some((d) => d.itemId === item),
        ),
      )
      .slice(0, tier === "micro" ? 1 : tier === "minor" ? 2 : 3);

  if (affectedItems.length === 0) return null;

  const event: MarketEvent = {
    id: crypto.randomUUID(),
    title: template.title,
    description: template.description,
    affectedItems,
    outcome: template.outcome,
    multiplier: normalizeTemplateMultiplier(template.outcome, tierMultiplier(tier, templateKey)),
    playerTip: template.playerTip,
    trigger,
    tier,
    startsAtMs: nowMs,
    expiresAtMs: nowMs + AI_EVENT_ACTIVE_TTL_SEC * 1000,
  };

  if (historyTooRepetitive(event, history, template.templateKey, nowMs)) return null;

  logger.info(
    { tier, trigger, templateKey, pressure, affectedItems },
    "[ai-events] Generated deterministic market event",
  );

  return {
    event,
    templateKey: template.templateKey,
  };
}

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

export async function generateNarrativeAiEvent(
  redis: Redis,
  input: GenerateNarrativeAiEventInput,
): Promise<
  | {
      ok: true;
      event: MarketEvent;
    }
  | {
      ok: false;
      reason: "missing_api_key" | "provider_error" | "invalid_affected_items" | "repetition_blocked";
      details?: Record<string, unknown>;
    }
> {
  if (!env.XAI_API_KEY) {
    return { ok: false, reason: "missing_api_key" };
  }

  const season = getCurrentSeason();
  const validIds = new Set(PRICED_ITEM_IDS);
  const highVolumeItems = await getHighVolumeItems(redis, 8);
  const historySummary = input.history
    .slice(0, 5)
    .map((entry) => `${entry.tier}:${entry.outcome}:${entry.primaryItemId ?? "none"}`)
    .join(", ");

  const devLines = input.signal.deviations
    .slice(0, 5)
    .map(
      (d) =>
        `- ${d.itemId}: ${d.deviationPct > 0 ? "+" : ""}${d.deviationPct.toFixed(0)}% (${d.direction})`,
    )
    .join("\n");

  const anomalyLines = input.signal.anomalies
    .slice(0, 3)
    .map((a) => `- ${a.type}:${a.itemId} (${a.description})`)
    .join("\n");

  const aiPrompt = `You are the game master for a dramatic farming simulation game called Ravolo.
Current season: ${season}
Event tier: ${input.tier}
Pressure score: ${input.pressure}/1000
Dominant signal: ${input.signal.dominantType}
Drivers:
${input.signal.drivers.map((driver) => `- ${driver}`).join("\n")}

High-volume commodities: ${highVolumeItems.join(", ")}
Available commodity IDs: ${PRICED_ITEM_IDS.join(", ")}
Recent event history to avoid repeating: ${historySummary || "none"}

Price deviations:
${devLines || "- none"}

Anomalies:
${anomalyLines || "- none"}

Generate ONE ${input.tier} market event. It should feel narrative, dramatic, and corrective for the economy.
Do not repeat the same affected items or same tone as the recent history if possible.
Use only listed commodity IDs.`;

  let objectResult: z.infer<typeof marketEventSchema>;
  try {
    const xai = createXai({ apiKey: env.XAI_API_KEY });
    const { object } = await generateObject({
      model: xai("grok-3-mini-fast"),
      schema: marketEventSchema,
      prompt: aiPrompt,
    });
    objectResult = object;
  } catch (err) {
    logger.error({ err, pressure: input.pressure }, "[ai-events] Major narrative generation failed");
    return { ok: false, reason: "provider_error" };
  }

  const validAffect = objectResult.affect.filter((id) => validIds.has(id));
  if (validAffect.length === 0) {
    return {
      ok: false,
      reason: "invalid_affected_items",
      details: { returnedAffect: objectResult.affect },
    };
  }

  const event: MarketEvent = {
    id: crypto.randomUUID(),
    title: objectResult.event,
    description: objectResult.description,
    affectedItems: validAffect,
    outcome: objectResult.outcome,
    multiplier: normalizeTemplateMultiplier(objectResult.outcome, objectResult.impact_multiplier),
    playerTip: objectResult.player_tip,
    trigger: input.trigger,
    tier: input.tier,
    startsAtMs: input.nowMs,
    expiresAtMs: input.nowMs + AI_EVENT_ACTIVE_TTL_SEC * 1000,
  };

  if (historyTooRepetitive(event, input.history, null, input.nowMs)) {
    return { ok: false, reason: "repetition_blocked" };
  }

  return { ok: true, event };
}

export async function commitAiEvent(
  redis: Redis,
  event: MarketEvent,
  pressureAfterEvent: number,
  templateKey: string | null,
): Promise<void> {
  const historyEntry: AiEventHistoryEntry = {
    id: event.id,
    tier: event.tier,
    outcome: event.outcome,
    trigger: event.trigger,
    affectedItems: event.affectedItems,
    primaryItemId: event.affectedItems[0] ?? null,
    title: event.title,
    templateKey,
    createdAtMs: event.startsAtMs,
  };

  await Promise.all([
    setActiveEvent(redis, event),
    setTierCooldown(redis, event.tier),
    appendAiEventHistory(redis, historyEntry),
    setAiPressure(redis, { value: pressureAfterEvent, updatedAtMs: Date.now() }),
  ]);
}

export function resetPressureAfterEvent(currentPressure: number, tier: AiEventTier): number {
  const resetBps = AI_PRESSURE_RESET_BPS[tier];
  return clamp(Math.floor((currentPressure * resetBps) / PRESSURE_SCALE_BPS), 0, AI_PRESSURE_MAX);
}

export async function setActiveEvent(
  redis: Redis,
  event: MarketEvent,
): Promise<void> {
  await redis.set(
    ACTIVE_EVENT_KEY,
    JSON.stringify(event),
    "EX",
    AI_EVENT_ACTIVE_TTL_SEC,
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
