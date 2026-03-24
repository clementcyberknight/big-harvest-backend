import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../../infrastructure/logger/logger.js";
import type { HarvestingService } from "../../../modules/harvesting/harvesting.service.js";
import { AppError } from "../../../shared/errors/appError.js";
import { wsActionLimiter } from "../ws.rateLimiter.js";
import type { WsOutboundMessage, WsUserData } from "../ws.types.js";

function send(ws: WebSocket<WsUserData>, msg: WsOutboundMessage): void {
  ws.send(JSON.stringify(msg), false);
}

export async function handleHarvest(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  harvesting: HarvestingService,
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
    const data = await harvesting.harvest(userId, payload);
    send(ws, { type: "HARVEST_OK", data });
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
    logger.error({ err: e, userId }, "harvest failed");
    send(ws, {
      type: "ERROR",
      code: "INTERNAL",
      message: "Internal error",
    });
  }
}
