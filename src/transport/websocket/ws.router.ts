import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../infrastructure/logger/logger.js";
import type { AnimalService } from "../../modules/animal/animal.service.js";
import type { CraftingService } from "../../modules/crafting/crafting.service.js";
import type { HarvestingService } from "../../modules/harvesting/harvesting.service.js";
import type { LoanService } from "../../modules/loan/loan.service.js";
import type { MarketService } from "../../modules/market/market.service.js";
import type { PlantingService } from "../../modules/planting/planting.service.js";
import {
  handleAnimalFeed,
  handleAnimalHarvest,
} from "./handlers/animal.handler.js";
import { handleBuy } from "./handlers/buy.handler.js";
import { handleCraftClaim, handleCraftStart } from "./handlers/crafting.handler.js";
import { handleLoanOpen, handleLoanRepay } from "./handlers/loan.handler.js";
import { handleHarvest } from "./handlers/harvest.handler.js";
import { handlePlant } from "./handlers/plant.handler.js";
import { handleSell } from "./handlers/sell.handler.js";
import type {
  WsInboundMessage,
  WsOutboundMessage,
  WsUserData,
} from "./ws.types.js";

export type WsGameContext = {
  planting: PlantingService;
  harvesting: HarvestingService;
  market: MarketService;
  loan: LoanService;
  animals: AnimalService;
  crafting: CraftingService;
};

function send(ws: WebSocket<WsUserData>, msg: WsOutboundMessage): void {
  ws.send(JSON.stringify(msg), false);
}

function parseInbound(text: string): WsInboundMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (
    type === "PLANT" ||
    type === "HARVEST" ||
    type === "SELL" ||
    type === "BUY" ||
    type === "LOAN_OPEN" ||
    type === "LOAN_REPAY" ||
    type === "ANIMAL_FEED" ||
    type === "ANIMAL_HARVEST" ||
    type === "CRAFT_START" ||
    type === "CRAFT_CLAIM"
  ) {
    return { type, payload: o.payload } as WsInboundMessage;
  }
  if (type === "PING") {
    return { type: "PING", payload: o.payload };
  }
  return null;
}

export async function dispatchWsMessage(
  ws: WebSocket<WsUserData>,
  text: string,
  ctx: WsGameContext,
): Promise<void> {
  const msg = parseInbound(text);
  if (!msg) {
    send(ws, {
      type: "ERROR",
      code: "BAD_REQUEST",
      message: "Invalid message",
    });
    return;
  }

  switch (msg.type) {
    case "PING":
      send(ws, { type: "PONG" });
      return;
    case "PLANT":
      await handlePlant(ws, msg.payload, ctx.planting);
      return;
    case "HARVEST":
      await handleHarvest(ws, msg.payload, ctx.harvesting);
      return;
    case "SELL":
      await handleSell(ws, msg.payload, ctx.market);
      return;
    case "BUY":
      await handleBuy(ws, msg.payload, ctx.market);
      return;
    case "LOAN_OPEN":
      await handleLoanOpen(ws, msg.payload, ctx.loan);
      return;
    case "LOAN_REPAY":
      await handleLoanRepay(ws, msg.payload, ctx.loan);
      return;
    case "ANIMAL_FEED":
      await handleAnimalFeed(ws, msg.payload, ctx.animals);
      return;
    case "ANIMAL_HARVEST":
      await handleAnimalHarvest(ws, msg.payload, ctx.animals);
      return;
    case "CRAFT_START":
      await handleCraftStart(ws, msg.payload, ctx.crafting);
      return;
    case "CRAFT_CLAIM":
      await handleCraftClaim(ws, msg.payload, ctx.crafting);
      return;
    default:
      logger.warn({ msg }, "unhandled ws message type");
      send(ws, {
        type: "ERROR",
        code: "BAD_REQUEST",
        message: "Unknown type",
      });
  }
}
