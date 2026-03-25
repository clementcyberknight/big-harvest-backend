export type MarketEventOutcome = "crash" | "surge" | "boycott";

export type MarketEventTrigger =
  | "price_deviation"
  | "gold_imbalance"
  | "analytics_anomaly"
  | "scheduled";

export interface MarketEvent {
  id: string;
  title: string;
  description: string;
  affectedItems: string[];
  outcome: MarketEventOutcome;
  multiplier: number;
  playerTip: string;
  trigger: MarketEventTrigger;
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
