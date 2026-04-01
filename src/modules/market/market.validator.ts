import { z } from "zod";

export const treasuryTradeSchema = z.object({
  item: z.string().min(1).max(64),
  // Accept floats like 2.0 from JSON clients and truncate — Lua requires integers.
  quantity: z
    .number()
    .positive()
    .transform((n) => Math.floor(n))
    .pipe(z.number().int().positive()),
  requestId: z.string().min(8).max(128),
});

export type TreasuryTradeInput = z.infer<typeof treasuryTradeSchema>;
