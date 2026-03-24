import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../../infrastructure/logger/logger.js";
import type { CraftingService } from "../../../modules/crafting/crafting.service.js";
import { AppError } from "../../../shared/errors/appError.js";
import { wsActionLimiter } from "../ws.rateLimiter.js";
import type { WsOutboundMessage, WsUserData } from "../ws.types.js";

function send(ws: WebSocket<WsUserData>, msg: WsOutboundMessage): void {
  ws.send(JSON.stringify(msg), false);
}

export async function handleCraftStart(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  crafting: CraftingService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  try {
    await wsActionLimiter.consume(userId);
  } catch {
    send(ws, { type: "ERROR", code: "RATE_LIMITED", message: "Too many actions" });
    return;
  }
  try {
    const data = await crafting.start(userId, payload);
    send(ws, { type: "CRAFT_START_OK", data });
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
    logger.error({ err: e, userId }, "craft start failed");
    send(ws, { type: "ERROR", code: "INTERNAL", message: "Internal error" });
  }
}

export async function handleCraftClaim(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  crafting: CraftingService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  try {
    await wsActionLimiter.consume(userId);
  } catch {
    send(ws, { type: "ERROR", code: "RATE_LIMITED", message: "Too many actions" });
    return;
  }
  try {
    const data = await crafting.claim(userId, payload);
    send(ws, { type: "CRAFT_CLAIM_OK", data });
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
    logger.error({ err: e, userId }, "craft claim failed");
    send(ws, { type: "ERROR", code: "INTERNAL", message: "Internal error" });
  }
}
