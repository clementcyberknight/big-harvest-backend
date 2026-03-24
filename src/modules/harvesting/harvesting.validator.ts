import { z } from "zod";

export const harvestCommandSchema = z.object({
  plotId: z.number().int().nonnegative(),
  requestId: z.string().min(8).max(128),
});

export type HarvestCommandInput = z.infer<typeof harvestCommandSchema>;
