import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../../infrastructure/logger/logger.js";
import type { AnimalService } from "../../../modules/animal/animal.service.js";
import { AppError } from "../../../shared/errors/appError.js";
import { wsActionLimiter } from "../ws.rateLimiter.js";
import type { WsOutboundMessage, WsUserData } from "../ws.types.js";

function send(ws: WebSocket<WsUserData>, msg: WsOutboundMessage): void {
  ws.send(JSON.stringify(msg), false);
}

export async function handleAnimalFeed(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  animals: AnimalService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  try {
    await wsActionLimiter.consume(userId);
  } catch {
    send(ws, { type: "ERROR", code: "RATE_LIMITED", message: "Too many actions" });
    return;
  }
  try {
    const data = await animals.feed(userId, payload);
    send(ws, { type: "ANIMAL_FEED_OK", data });
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
    logger.error({ err: e, userId }, "animal feed failed");
    send(ws, { type: "ERROR", code: "INTERNAL", message: "Internal error" });
  }
}

export async function handleAnimalHarvest(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  animals: AnimalService,
): Promise<void> {
  const userId = ws.getUserData().userId;
  try {
    await wsActionLimiter.consume(userId);
  } catch {
    send(ws, { type: "ERROR", code: "RATE_LIMITED", message: "Too many actions" });
    return;
  }
  try {
    const data = await animals.harvest(userId, payload);
    send(ws, { type: "ANIMAL_HARVEST_OK", data });
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
    logger.error({ err: e, userId }, "animal harvest failed");
    send(ws, { type: "ERROR", code: "INTERNAL", message: "Internal error" });
  }
}
