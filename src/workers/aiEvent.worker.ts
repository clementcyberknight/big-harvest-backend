import type { Redis } from "ioredis";
import { logger } from "../infrastructure/logger/logger.js";
import {
  collectAiSignals,
  commitAiEvent,
  decideEventTier,
  generateFastEvent,
  generateNarrativeAiEvent,
  getAiEventHistory,
  getAiPressure,
  getActiveEvent,
  getTierCooldownTtl,
  resetPressureAfterEvent,
  setAiPressure,
  computeNextPressure,
} from "../modules/ai-events/event.service.js";
import type { AiEventTier, MarketEvent } from "../modules/ai-events/event.types.js";
import { AI_EVENT_TICK_MS } from "../config/constants.js";

export type AiEventBroadcaster = (event: MarketEvent) => void | Promise<void>;

let broadcaster: AiEventBroadcaster | null = null;

function logTierCooldownSkip(tier: AiEventTier, ttl: number, pressure: number): void {
  logger.info(
    { tier, remainingSeconds: ttl, pressure },
    "[ai-events] Tier cooldown active, skipping event generation",
  );
}

export function setAiEventBroadcaster(fn: AiEventBroadcaster): void {
  broadcaster = fn;
}

export async function runAiEventTick(redis: Redis): Promise<void> {
  const active = await getActiveEvent(redis);
  if (active) {
    logger.info(
      { activeEventId: active.id, activeEventTitle: active.title },
      "[ai-events] Active event exists, skipping tick",
    );
    return;
  }

  const signal = await collectAiSignals(redis);
  const previousPressure = await getAiPressure(redis);
  const nextPressure = computeNextPressure(previousPressure.value, signal);

  await setAiPressure(redis, {
    value: nextPressure,
    updatedAtMs: Date.now(),
  });

  if (signal.pressureDelta <= 0 && nextPressure === 0) {
    logger.debug("[ai-events] No meaningful event pressure detected");
    return;
  }

  const tierDecision = decideEventTier(nextPressure);
  if (tierDecision.tier === "none") {
    logger.debug(
      { pressure: nextPressure, signalDelta: signal.pressureDelta },
      "[ai-events] Pressure below event threshold",
    );
    return;
  }

  const tier = tierDecision.tier;
  const cooldownTtl = await getTierCooldownTtl(redis, tier);
  if (cooldownTtl > 0) {
    logTierCooldownSkip(tier, cooldownTtl, nextPressure);
    return;
  }

  const history = await getAiEventHistory(redis);
  const trigger =
    signal.dominantType === "analytics_anomaly"
      ? "analytics_anomaly"
      : signal.dominantType === "gold_imbalance"
        ? "gold_imbalance"
        : signal.dominantType === "price_deviation"
          ? "price_deviation"
          : "pressure_release";
  const nowMs = Date.now();

  logger.info(
    {
      tier,
      pressure: nextPressure,
      signalDelta: signal.pressureDelta,
      dominantType: signal.dominantType,
      drivers: signal.drivers,
    },
    "[ai-events] Event tier selected",
  );

  const generated =
    tier === "medium" || tier === "major"
      ? await generateNarrativeAiEvent(redis, {
          tier,
          trigger,
          pressure: nextPressure,
          signal,
          nowMs,
          history,
        })
      : await generateFastEvent(redis, {
          tier,
          trigger,
          pressure: nextPressure,
          signal,
          nowMs,
          history,
        });

  if (!generated) {
    logger.info(
      { tier, pressure: nextPressure },
      "[ai-events] Fast event generation returned no valid event",
    );
    return;
  }

  if ("ok" in generated && !generated.ok) {
    if (generated.reason === "missing_api_key") {
      logger.warn(
        { tier },
        "[ai-events] Narrative event generation skipped: XAI_API_KEY not configured",
      );
      return;
    }
    if (generated.reason === "repetition_blocked") {
      logger.info(
        { tier, pressure: nextPressure },
        "[ai-events] Narrative event blocked by repetition guard",
      );
      return;
    }
    logger.warn(
      { tier, reason: generated.reason, details: generated.details },
      "[ai-events] Narrative event generation failed",
    );
    return;
  }

  const event = generated.event;
  const templateKey = "templateKey" in generated ? generated.templateKey : null;
  const pressureAfterEvent = resetPressureAfterEvent(nextPressure, event.tier);

  await commitAiEvent(redis, event, pressureAfterEvent, templateKey);

  const emoji =
    event.outcome === "boycott" ? "🚫" : event.outcome === "surge" ? "📈" : "📉";
  logger.info(
    {
      id: event.id,
      title: event.title,
      tier: event.tier,
      outcome: event.outcome,
      multiplier: event.multiplier,
      items: event.affectedItems,
      pressureBeforeReset: nextPressure,
      pressureAfterReset: pressureAfterEvent,
    },
    `[ai-events] ${emoji} Event triggered: "${event.title}"`,
  );
  if (broadcaster) {
    await broadcaster(event);
    logger.info(
      { eventId: event.id, tier: event.tier },
      "[ai-events] Broadcast sent to connected clients",
    );
  }
}

export function startAiEventLoop(redis: Redis): () => void {
  const tick = () => {
    void runAiEventTick(redis).catch((err) => {
      logger.error({ err }, "[ai-events] tick failed");
    });
  };
  setTimeout(tick, 10_000);
  const id = setInterval(tick, AI_EVENT_TICK_MS);
  return () => clearInterval(id);
}
