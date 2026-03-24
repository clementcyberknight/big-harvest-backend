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
  | { type: "ERROR"; code: string; message: string; details?: unknown }
  | { type: "PONG" };
