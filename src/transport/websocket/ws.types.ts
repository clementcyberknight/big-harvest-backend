/** Wire format: MessagePack binary frames via `ws.codec.ts` (same object shapes). */
export type WsUserData = { userId: string };

export type WsInboundMessage =
  | { type: "PLANT"; payload: unknown }
  | { type: "HARVEST"; payload: unknown }
  | { type: "SELL"; payload: unknown }
  | { type: "BUY"; payload: unknown }
  | { type: "LOAN_OPEN"; payload: unknown }
  | { type: "LOAN_REPAY"; payload: unknown }
  | { type: "ANIMAL_FEED"; payload: unknown }
  | { type: "ANIMAL_HARVEST"; payload: unknown }
  | { type: "CRAFT_START"; payload: unknown }
  | { type: "CRAFT_CLAIM"; payload: unknown }
  | { type: "CREATE_SYNDICATE"; payload: unknown }
  | { type: "LIST_SYNDICATE"; payload: unknown }
  | { type: "VIEW_SYNDICATE"; payload: unknown }
  | { type: "REQUEST_JOIN"; payload: unknown }
  | { type: "ACCEPT_REQUEST"; payload: unknown }
  | { type: "DEPOSIT_BANK"; payload: unknown }
  | { type: "BUY_SHIELD"; payload: unknown }
  | { type: "ATTACK_SYNDICATE"; payload: unknown }
  | { type: "IDOL_CONTRIBUTE"; payload: unknown }
  | { type: "SYNDICATE_CHAT_SEND"; payload: unknown }
  | { type: "SYNDICATE_CHAT_LIST"; payload: unknown }
  | { type: "LEAVE_SYNDICATE"; payload: unknown }
  | { type: "DISBAND_SYNDICATE"; payload: unknown }
  | { type: "VIEW_SYNDICATE_MEMBER"; payload: unknown }
  | { type: "VIEW_GOLD_BANK"; payload: unknown }
  | { type: "VIEW_COMMODITY_BANK"; payload: unknown }
  | { type: "VIEW_MEMBER_CONTRIBUTION"; payload: unknown }
  | { type: "VIEW_LEADERBOARD"; payload: unknown }
  | { type: "PING"; payload?: unknown };

export type WsOutboundMessage =
  | { type: "PLANT_OK"; requestEcho?: string; data: unknown }
  | { type: "HARVEST_OK"; requestEcho?: string; data: unknown }
  | { type: "SELL_OK"; data: unknown }
  | { type: "BUY_OK"; data: unknown }
  | { type: "LOAN_OPEN_OK"; data: unknown }
  | { type: "LOAN_REPAY_OK"; data: unknown }
  | { type: "ANIMAL_FEED_OK"; data: unknown }
  | { type: "ANIMAL_HARVEST_OK"; data: unknown }
  | { type: "CRAFT_START_OK"; data: unknown }
  | { type: "CRAFT_CLAIM_OK"; data: unknown }
  | { type: "CREATE_SYNDICATE_OK"; data: unknown }
  | { type: "LIST_SYNDICATE_OK"; data: unknown }
  | { type: "VIEW_SYNDICATE_OK"; data: unknown }
  | { type: "REQUEST_JOIN_OK"; data: unknown }
  | { type: "ACCEPT_REQUEST_OK"; data: unknown }
  | { type: "DEPOSIT_BANK_OK"; data: unknown }
  | { type: "BUY_SHIELD_OK"; data: unknown }
  | { type: "ATTACK_SYNDICATE_OK"; data: unknown }
  | { type: "IDOL_CONTRIBUTE_OK"; data: unknown }
  | { type: "SYNDICATE_CHAT_SEND_OK"; data: unknown }
  | { type: "SYNDICATE_CHAT_LIST_OK"; data: unknown }
  | { type: "LEAVE_SYNDICATE_OK"; data: unknown }
  | { type: "DISBAND_SYNDICATE_OK"; data: unknown }
  | { type: "VIEW_SYNDICATE_MEMBER_OK"; data: unknown }
  | { type: "VIEW_GOLD_BANK_OK"; data: unknown }
  | { type: "VIEW_COMMODITY_BANK_OK"; data: unknown }
  | { type: "VIEW_MEMBER_CONTRIBUTION_OK"; data: unknown }
  | { type: "VIEW_LEADERBOARD_OK"; data: unknown }
  | { type: "AI_EVENT"; data: unknown }
  | {
      type: "GAME_STATUS";
      data: {
        prices: import("../../modules/market/market.types.js").MarketStatus;
        activeEvent: any | null;
        serverNowMs: number;
      };
    }
  | { type: "GAME_STATE"; data: { inventory: Record<string, number>; gold: number; plots: any[] } }
  | { type: "SYNDICATE_IDOL_EVENT"; data: unknown }
  | { type: "ERROR"; code: string; message: string; details?: unknown }
  | { type: "PONG"; serverNowMs: number; clientTs?: unknown };
