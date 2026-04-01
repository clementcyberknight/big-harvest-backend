export type MarketEventOutcome = "crash" | "surge" | "boycott";

export type AiEventTier = "micro" | "minor" | "medium" | "major";

export type MarketEventTrigger =
  | "price_deviation"
  | "gold_imbalance"
  | "analytics_anomaly"
  | "scheduled"
  | "pressure_release";

export interface MarketEvent {
  id: string;
  title: string;
  description: string;
  affectedItems: string[];
  outcome: MarketEventOutcome;
  multiplier: number;
  playerTip: string;
  trigger: MarketEventTrigger;
  tier: AiEventTier;
  startsAtMs: number;
  expiresAtMs: number;
}

export interface PriceDeviation {
  itemId: string;
  currentMicro: number;
  baseMicro: number;
  deviationPct: number;
  direction: "above" | "below";
}

export type AiSignalType =
  | "price_deviation"
  | "gold_imbalance"
  | "analytics_anomaly"
  | "mixed";

export type AiSignalMetrics = {
  deviationCount: number;
  reservePct: number;
  anomalyCount: number;
  topDeviationAbsPct: number;
};

export type AiSignalSnapshot = {
  pressureDelta: number;
  dominantType: AiSignalType;
  drivers: string[];
  metrics: AiSignalMetrics;
  deviations: PriceDeviation[];
  goldBalance: {
    reservePct: number;
    needsInjection: boolean;
    needsDrain: boolean;
  };
  anomalies: Array<{
    type: string;
    itemId: string;
    entityId: string;
    description: string;
    severity?: number;
  }>;
};

export type AiPressureState = {
  value: number;
  updatedAtMs: number;
};

export type AiTierDecision =
  | {
      tier: "none";
      pressure: number;
    }
  | {
      tier: AiEventTier;
      pressure: number;
    };

export type AiEventHistoryEntry = {
  id: string;
  tier: AiEventTier;
  outcome: MarketEventOutcome;
  trigger: MarketEventTrigger;
  affectedItems: string[];
  primaryItemId: string | null;
  title: string;
  templateKey: string | null;
  createdAtMs: number;
};

export type GenerateFastEventInput = {
  tier: Exclude<AiEventTier, "major">;
  trigger: MarketEventTrigger;
  pressure: number;
  signal: AiSignalSnapshot;
  nowMs: number;
  history: AiEventHistoryEntry[];
};

export type GenerateNarrativeAiEventInput = {
  tier: "major";
  trigger: MarketEventTrigger;
  pressure: number;
  signal: AiSignalSnapshot;
  nowMs: number;
  history: AiEventHistoryEntry[];
};
