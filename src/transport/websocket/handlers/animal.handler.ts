import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../../infrastructure/logger/logger.js";
import type { AnimalService } from "../../../modules/animal/animal.service.js";
import type { UserActionService } from "../../../modules/user-actions/userAction.service.js";
import { AppError } from "../../../shared/errors/appError.js";
import { wsActionLimiter } from "../ws.rateLimiter.js";
import { sendGameMessage as send } from "../ws.codec.js";
import type { WsOutboundMessage, WsUserData } from "../ws.types.js";

export async function handleAnimalFeed(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  animals: AnimalService,
  userActions: UserActionService,
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
    void userActions.log(userId, "ANIMAL_FEED", payload);
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
  userActions: UserActionService,
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
    void userActions.log(userId, "ANIMAL_HARVEST", payload);
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
