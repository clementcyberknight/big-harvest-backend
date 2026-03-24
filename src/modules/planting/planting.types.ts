import type { CropId } from "../crop/crop.config.js";

export type PlantCommand = {
  plotId: number;
  cropId: CropId;
  /** Client-generated idempotency token (UUID recommended). */
  requestId: string;
};

export type PlantResult = {
  cropId: string;
  plantedAtMs: number;
  readyAtMs: number;
  outputQty: number;
  idempotentReplay?: boolean;
};
