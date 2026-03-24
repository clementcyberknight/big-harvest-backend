import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../../infrastructure/logger/logger.js";
import type { MarketService } from "../../../modules/market/market.service.js";
import type { UserActionService } from "../../../modules/user-actions/userAction.service.js";
import { AppError } from "../../../shared/errors/appError.js";
import { wsActionLimiter } from "../ws.rateLimiter.js";
import type { WsOutboundMessage, WsUserData } from "../ws.types.js";

function send(ws: WebSocket<WsUserData>, msg: WsOutboundMessage): void {
  ws.send(JSON.stringify(msg), false);
}

export async function handleSell(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  market: MarketService,
  userActions: UserActionService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  try {
    await wsActionLimiter.consume(userId);
  } catch {
    send(ws, {
      type: "ERROR",
      code: "RATE_LIMITED",
      message: "Too many actions",
    });
    return;
  }

  try {
    const data = await market.sell(userId, payload);
    void userActions.log(userId, "SELL", payload);
    send(ws, { type: "SELL_OK", data });
  } catch (e) {
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
    logger.error({ err: e, userId }, "sell failed");
    send(ws, {
      type: "ERROR",
      code: "INTERNAL",
      message: "Internal error",
    });
  }
}
