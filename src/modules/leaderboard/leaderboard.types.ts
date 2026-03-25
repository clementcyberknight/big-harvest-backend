export type LeaderboardCategory =
  | "player_gold"
  | "player_networth"
  | "syndicate_gold"
  | "syndicate_commodity_value";

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  score: number;
}

export interface LeaderboardQuery {
  category: LeaderboardCategory;
  limit?: number;
}
