import type { WebSocket } from "uWebSockets.js";
import type { Redis } from "ioredis";
import { logger } from "../../infrastructure/logger/logger.js";
import type { AnimalService } from "../../modules/animal/animal.service.js";
import type { CraftingService } from "../../modules/crafting/crafting.service.js";
import type { HarvestingService } from "../../modules/harvesting/harvesting.service.js";
import type { LoanService } from "../../modules/loan/loan.service.js";
import type { MarketService } from "../../modules/market/market.service.js";
import type { PlantingService } from "../../modules/planting/planting.service.js";
import type { UserActionService } from "../../modules/user-actions/userAction.service.js";
import type { SyndicateService } from "../../modules/syndicate/syndicate.service.js";
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
import { handleViewLeaderboard } from "./handlers/leaderboard.handler.js";
import type { LeaderboardService } from "../../modules/leaderboard/leaderboard.service.js";
import {
  handleAcceptRequest,
  handleAttackSyndicate,
  handleBuyShield,
  handleCreateSyndicate,
  handleDepositBank,
  handleDisbandSyndicate,
  handleIdolContribute,
  handleLeaveSyndicate,
  handleListSyndicate,
  handleRequestJoin,
  handleSyndicateChatList,
  handleSyndicateChatSend,
  handleViewCommodityBank,
  handleViewGoldBank,
  handleViewMemberContribution,
  handleViewSyndicate,
  handleViewSyndicateMember,
} from "./handlers/syndicate.handler.js";
import { parseWsInbound, sendGameMessage } from "./ws.codec.js";
import type { WsUserData } from "./ws.types.js";

export type WsGameContext = {
  redis: Redis;
  planting: PlantingService;
  harvesting: HarvestingService;
  market: MarketService;
  loan: LoanService;
  animals: AnimalService;
  crafting: CraftingService;
  userActions: UserActionService;
  syndicates: SyndicateService;
  leaderboards: LeaderboardService;
};

export async function dispatchWsMessage(
  ws: WebSocket<WsUserData>,
  rawMessage: ArrayBuffer | Uint8Array,
  isBinary: boolean,
  ctx: WsGameContext,
): Promise<void> {
  const msg = parseWsInbound(rawMessage, isBinary);
  if (!msg) {
    sendGameMessage(ws, {
      type: "ERROR",
      code: "BAD_REQUEST",
      message: "Invalid message",
    });
    return;
  }

  switch (msg.type) {
    case "PING":
      sendGameMessage(ws, { type: "PONG" });
      return;
    case "PLANT":
      await handlePlant(ws, msg.payload, ctx.planting, ctx.userActions);
      return;
    case "HARVEST":
      await handleHarvest(ws, msg.payload, ctx.harvesting, ctx.userActions);
      return;
    case "SELL":
      await handleSell(ws, msg.payload, ctx.market, ctx.userActions);
      return;
    case "BUY":
      await handleBuy(ws, msg.payload, ctx.market, ctx.userActions);
      return;
    case "LOAN_OPEN":
      await handleLoanOpen(ws, msg.payload, ctx.loan, ctx.userActions);
      return;
    case "LOAN_REPAY":
      await handleLoanRepay(ws, msg.payload, ctx.loan, ctx.userActions);
      return;
    case "ANIMAL_FEED":
      await handleAnimalFeed(ws, msg.payload, ctx.animals, ctx.userActions);
      return;
    case "ANIMAL_HARVEST":
      await handleAnimalHarvest(ws, msg.payload, ctx.animals, ctx.userActions);
      return;
    case "CRAFT_START":
      await handleCraftStart(ws, msg.payload, ctx.crafting, ctx.userActions);
      return;
    case "CRAFT_CLAIM":
      await handleCraftClaim(ws, msg.payload, ctx.crafting, ctx.userActions);
      return;
    case "CREATE_SYNDICATE":
      await handleCreateSyndicate(ws, msg.payload, ctx.syndicates, ctx.userActions);
      return;
    case "LIST_SYNDICATE":
      await handleListSyndicate(ws, msg.payload, ctx.syndicates);
      return;
    case "VIEW_SYNDICATE":
      await handleViewSyndicate(ws, msg.payload, ctx.syndicates);
      return;
    case "REQUEST_JOIN":
      await handleRequestJoin(ws, msg.payload, ctx.syndicates, ctx.userActions);
      return;
    case "ACCEPT_REQUEST":
      await handleAcceptRequest(ws, msg.payload, ctx.syndicates, ctx.userActions);
      return;
    case "DEPOSIT_BANK":
      await handleDepositBank(ws, msg.payload, ctx.syndicates, ctx.userActions);
      return;
    case "BUY_SHIELD":
      await handleBuyShield(ws, msg.payload, ctx.syndicates, ctx.userActions);
      return;
    case "ATTACK_SYNDICATE":
      await handleAttackSyndicate(ws, msg.payload, ctx.syndicates, ctx.userActions);
      return;
    case "IDOL_CONTRIBUTE":
      await handleIdolContribute(ws, msg.payload, ctx.syndicates, ctx.userActions);
      return;
    case "SYNDICATE_CHAT_SEND":
      await handleSyndicateChatSend(ws, msg.payload, ctx.syndicates);
      return;
    case "SYNDICATE_CHAT_LIST":
      await handleSyndicateChatList(ws, msg.payload, ctx.syndicates);
      return;
    case "LEAVE_SYNDICATE":
      await handleLeaveSyndicate(ws, msg.payload, ctx.syndicates, ctx.userActions);
      return;
    case "DISBAND_SYNDICATE":
      await handleDisbandSyndicate(ws, msg.payload, ctx.syndicates, ctx.userActions);
      return;
    case "VIEW_SYNDICATE_MEMBER":
      await handleViewSyndicateMember(ws, msg.payload, ctx.syndicates);
      return;
    case "VIEW_GOLD_BANK":
      await handleViewGoldBank(ws, msg.payload, ctx.syndicates);
      return;
    case "VIEW_COMMODITY_BANK":
      await handleViewCommodityBank(ws, msg.payload, ctx.syndicates);
      return;
    case "VIEW_MEMBER_CONTRIBUTION":
      await handleViewMemberContribution(ws, msg.payload, ctx.syndicates);
      return;
    case "VIEW_LEADERBOARD":
      await handleViewLeaderboard(ws, msg.payload, ctx);
      return;
    default:
      logger.warn({ msg }, "unhandled ws message type");
      sendGameMessage(ws, {
        type: "ERROR",
        code: "BAD_REQUEST",
        message: "Unknown type",
      });
  }
}
