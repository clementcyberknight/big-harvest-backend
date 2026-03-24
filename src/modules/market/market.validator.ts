import { z } from "zod";

export const treasuryTradeSchema = z.object({
  item: z.string().min(1).max(64),
  quantity: z.number().int().positive(),
  requestId: z.string().min(8).max(128),
});

export type TreasuryTradeInput = z.infer<typeof treasuryTradeSchema>;
