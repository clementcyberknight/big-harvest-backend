import { z } from "zod";
import { isCropId } from "../crop/crop.config.js";
import type { CropId } from "../crop/crop.config.js";

export const plantCommandSchema = z.object({
  plotId: z.number().int().nonnegative(),
  cropId: z
    .string()
    .refine((s): s is CropId => isCropId(s), "invalid cropId"),
  requestId: z.string().min(8).max(128),
});

export type PlantCommandInput = z.infer<typeof plantCommandSchema>;
