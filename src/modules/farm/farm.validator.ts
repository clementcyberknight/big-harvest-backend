import { z } from "zod";

export const buyPlotSchema = z.object({
  requestId: z.string().min(8).max(128),
});
