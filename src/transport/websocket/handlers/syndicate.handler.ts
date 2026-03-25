import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../../infrastructure/logger/logger.js";
import type { SyndicateService } from "../../../modules/syndicate/syndicate.service.js";
import type { UserActionService } from "../../../modules/user-actions/userAction.service.js";
import { AppError } from "../../../shared/errors/appError.js";
import { sendGameMessage as send } from "../ws.codec.js";
import { wsActionLimiter } from "../ws.rateLimiter.js";
import type { WsOutboundMessage, WsUserData } from "../ws.types.js";

async function consume(userId: string, ws: WebSocket<WsUserData>): Promise<boolean> {
  try {
    await wsActionLimiter.consume(userId);
    return true;
  } catch {
    send(ws, { type: "ERROR", code: "RATE_LIMITED", message: "Too many actions" });
    return false;
  }
}

function handleErr(ws: WebSocket<WsUserData>, userId: string, e: unknown, what: string) {
  if (e instanceof AppError) {
    logger.warn({ e: e.code, userId }, e.message);
    send(ws, {
      type: "ERROR",
      code: e.code,
      message: e.httpSafeMessage,
      details: e.details,
    });
    return;
  }
  logger.error({ err: e, userId }, what);
  send(ws, { type: "ERROR", code: "INTERNAL", message: "Internal error" });
}

export async function handleCreateSyndicate(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.create(userId, payload);
    userActions.log(userId, "CREATE_SYNDICATE", payload);
    send(ws, { type: "CREATE_SYNDICATE_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "create syndicate failed");
  }
}

export async function handleListSyndicate(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.list(userId, payload);
    send(ws, { type: "LIST_SYNDICATE_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "list syndicate failed");
  }
}

export async function handleViewSyndicate(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.view(userId, payload);
    send(ws, { type: "VIEW_SYNDICATE_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "view syndicate failed");
  }
}

export async function handleRequestJoin(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.requestJoin(userId, payload);
    userActions.log(userId, "REQUEST_JOIN", payload);
    send(ws, { type: "REQUEST_JOIN_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "request join failed");
  }
}

export async function handleAcceptRequest(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.acceptJoin(userId, payload);
    userActions.log(userId, "ACCEPT_REQUEST", payload);
    send(ws, { type: "ACCEPT_REQUEST_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "accept request failed");
  }
}

export async function handleDepositBank(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.deposit(userId, payload);
    userActions.log(userId, "DEPOSIT_BANK", payload);
    send(ws, { type: "DEPOSIT_BANK_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "deposit bank failed");
  }
}

export async function handleBuyShield(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.buyShield(userId, payload);
    userActions.log(userId, "BUY_SHIELD", payload);
    send(ws, { type: "BUY_SHIELD_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "buy shield failed");
  }
}

export async function handleAttackSyndicate(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.attack(userId, payload);
    userActions.log(userId, "ATTACK_SYNDICATE", payload);
    send(ws, { type: "ATTACK_SYNDICATE_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "attack syndicate failed");
  }
}

export async function handleIdolContribute(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.idolContribute(userId, payload);
    userActions.log(userId, "IDOL_CONTRIBUTE", payload);
    send(ws, { type: "IDOL_CONTRIBUTE_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "idol contribute failed");
  }
}

export async function handleSyndicateChatSend(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.chatSend(userId, payload);
    send(ws, { type: "SYNDICATE_CHAT_SEND_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "chat send failed");
  }
}

export async function handleSyndicateChatList(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.chatList(userId, payload);
    send(ws, { type: "SYNDICATE_CHAT_LIST_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "chat list failed");
  }
}

export async function handleLeaveSyndicate(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.leave(userId, payload);
    userActions.log(userId, "LEAVE_SYNDICATE", payload);
    send(ws, { type: "LEAVE_SYNDICATE_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "leave syndicate failed");
  }
}

export async function handleDisbandSyndicate(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.disband(userId, payload);
    userActions.log(userId, "DISBAND_SYNDICATE", payload);
    send(ws, { type: "DISBAND_SYNDICATE_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "disband syndicate failed");
  }
}

export async function handleViewSyndicateMember(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.viewMembers(userId, payload);
    send(ws, { type: "VIEW_SYNDICATE_MEMBER_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "view syndicate member failed");
  }
}

export async function handleViewGoldBank(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.viewGoldBank(userId, payload);
    send(ws, { type: "VIEW_GOLD_BANK_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "view gold bank failed");
  }
}

export async function handleViewCommodityBank(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.viewCommodityBank(userId, payload);
    send(ws, { type: "VIEW_COMMODITY_BANK_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "view commodity bank failed");
  }
}

export async function handleViewMemberContribution(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  syndicates: SyndicateService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  if (!(await consume(userId, ws))) return;
  try {
    const data = await syndicates.viewMemberContribution(userId, payload);
    send(ws, { type: "VIEW_MEMBER_CONTRIBUTION_OK", data } satisfies WsOutboundMessage);
  } catch (e) {
    handleErr(ws, userId, e, "view member contribution failed");
  }
}
