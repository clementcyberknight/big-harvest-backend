import { z } from "zod";

const invEntry = z.object({
  item: z.string().min(1).max(64),
  quantity: z.number().int().positive(),
});

export const loanOpenSchema = z.object({
  principal: z.number().int().positive(),
  collateralInventory: z.array(invEntry).max(24),
  collateralPlotIds: z.array(z.number().int().nonnegative()).max(16),
  requestId: z.string().min(8).max(128),
});

export const loanRepaySchema = z.object({
  loanId: z.string().uuid(),
  requestId: z.string().min(8).max(128),
});
