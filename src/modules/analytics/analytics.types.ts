export type AnomalyType = "hoarding" | "wash_trading" | "monopoly";

export interface MarketAnomaly {
  type: AnomalyType;
  entityId: string;
  entityType: "player" | "syndicate";
  itemId: string;
  severity: number; // 0.0 to 1.0
  description: string;
  detectedAtMs: number;
}
