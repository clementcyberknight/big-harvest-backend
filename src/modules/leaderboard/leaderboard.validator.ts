import { z } from "zod";

export const viewLeaderboardSchema = z.object({
  category: z.enum([
    "player_gold",
    "player_networth",
    "syndicate_gold",
    "syndicate_commodity_value",
  ]),
  limit: z.number().int().positive().max(100).optional(),
});

export type ViewLeaderboardCmd = z.infer<typeof viewLeaderboardSchema>;
