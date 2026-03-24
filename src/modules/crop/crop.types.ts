export type CropDefinition = {
  /** Growth duration in seconds (from server clock). */
  growTimeSec: number;
  /** Harvested quantity added to inventory. */
  output: number;
  /** Seeds consumed per plant action. */
  seedCost: number;
  /** Reference valuation in cents (pricing layer maps to micro-gold). */
  basePriceCents: number;
  /** Inventory hash field for harvested goods (defaults to crop id key in config). */
  harvestItemId?: string;
};
