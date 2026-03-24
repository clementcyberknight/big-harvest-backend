export type HarvestCommand = {
  plotId: number;
  requestId: string;
};

export type HarvestResult = {
  /** Inventory field credited (e.g. wheat, cocoa_pods). */
  itemId: string;
  quantity: number;
  idempotentReplay?: boolean;
};
