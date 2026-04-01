import type { WebSocket } from "uWebSockets.js";
import type { Redis } from "ioredis";
import { logger } from "../../../infrastructure/logger/logger.js";
import type { FarmService } from "../../../modules/farm/farm.service.js";
import type { UserActionService } from "../../../modules/user-actions/userAction.service.js";
import { AppError } from "../../../shared/errors/appError.js";
import { handleGetGameState } from "./gameState.handler.js";
import { wsActionLimiter } from "../ws.rateLimiter.js";
import { sendGameMessage as send } from "../ws.codec.js";
import type { WsUserData } from "../ws.types.js";

export async function handleBuyPlot(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  redis: Redis,
  farm: FarmService,
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
    const data = await farm.buyPlot(userId, payload);
    void userActions.log(userId, "BUY_PLOT", payload);
    send(ws, { type: "BUY_PLOT_OK", data });
    await handleGetGameState(ws, redis);
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
    logger.error({ err: e, userId }, "buy plot failed");
    send(ws, {
      type: "ERROR",
      code: "INTERNAL",
      message: "Internal error",
    });
  }
}
