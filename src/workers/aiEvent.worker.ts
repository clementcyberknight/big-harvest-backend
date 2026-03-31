import type { Redis } from "ioredis";
import { logger } from "../infrastructure/logger/logger.js";
import {
  detectPriceDeviations,
  checkGoldBalance,
  generateAiEvent,
  setActiveEvent,
  getActiveEvent,
} from "../modules/ai-events/event.service.js";
import type { AiEventContext } from "../modules/ai-events/event.service.js";
import type { MarketEvent } from "../modules/ai-events/event.types.js";
import { AnalyticsService } from "../modules/analytics/analytics.service.js";

const DEVIATION_CHECK_MS = 60 * 1000;
const DEVIATION_THRESHOLD_PCT = 60;

export type AiEventBroadcaster = (event: MarketEvent) => void | Promise<void>;

let broadcaster: AiEventBroadcaster | null = null;

export function setAiEventBroadcaster(fn: AiEventBroadcaster): void {
  broadcaster = fn;
}

export async function runAiEventTick(redis: Redis): Promise<void> {
  const active = await getActiveEvent(redis);
  if (active) {
    logger.debug("[ai-events] Active event exists, skipping tick");
    return;
  }

  const deviations = await detectPriceDeviations(redis, DEVIATION_THRESHOLD_PCT);
  const goldBalance = await checkGoldBalance(redis);

  const analytics = new AnalyticsService(redis);
  const anomalies = await analytics.runPeriodicAnalysis();

  const hasDeviations = deviations.length > 0;
  const hasGoldIssue = goldBalance.needsInjection || goldBalance.needsDrain;
  const hasAnomalies = anomalies.length > 0;

  if (!hasDeviations && !hasGoldIssue && !hasAnomalies) {
    logger.debug("[ai-events] No deviations, gold issues, or anomalies detected");
    return;
  }

  let trigger: AiEventContext["anomalies"] extends infer _ ? "price_deviation" | "gold_imbalance" | "analytics_anomaly" : never = "price_deviation";
  if (hasAnomalies) trigger = "analytics_anomaly";
  else if (hasGoldIssue) trigger = "gold_imbalance";

  logger.info(
    { trigger, deviationCount: deviations.length, reservePct: goldBalance.reservePct.toFixed(1) },
    "[ai-events] Triggering AI event generation",
  );

  const ctx: AiEventContext = {
    deviations: hasDeviations ? deviations : undefined,
    goldBalance: hasGoldIssue ? goldBalance : undefined,
    anomalies: hasAnomalies
      ? anomalies.map((a) => ({ type: a.type, itemId: a.itemId, entityId: a.entityId, description: a.description }))
      : undefined,
  };

  const event = await generateAiEvent(redis, trigger, ctx);

  if (event) {
    await setActiveEvent(redis, event);
    const emoji = event.outcome === "boycott" ? "🚫" : event.outcome === "surge" ? "📈" : "📉";
    logger.info(
      { id: event.id, title: event.title, outcome: event.outcome, multiplier: event.multiplier, items: event.affectedItems },
      `[ai-events] ${emoji} Event triggered: "${event.title}"`,
    );
    if (broadcaster) await broadcaster(event);
  }
}

export function startAiEventLoop(redis: Redis): () => void {
  const tick = () => {
    void runAiEventTick(redis).catch((err) => {
      logger.error({ err }, "[ai-events] tick failed");
    });
  };
  setTimeout(tick, 10_000);
  const id = setInterval(tick, DEVIATION_CHECK_MS);
  return () => clearInterval(id);
}
