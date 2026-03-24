import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../../infrastructure/logger/logger.js";
import type { LoanService } from "../../../modules/loan/loan.service.js";
import type { UserActionService } from "../../../modules/user-actions/userAction.service.js";
import { AppError } from "../../../shared/errors/appError.js";
import { wsActionLimiter } from "../ws.rateLimiter.js";
import type { WsOutboundMessage, WsUserData } from "../ws.types.js";

function send(ws: WebSocket<WsUserData>, msg: WsOutboundMessage): void {
  ws.send(JSON.stringify(msg), false);
}

export async function handleLoanOpen(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  loan: LoanService,
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
    const data = await loan.open(userId, payload);
    void userActions.log(userId, "LOAN_OPEN", payload);
    send(ws, { type: "LOAN_OPEN_OK", data });
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
    logger.error({ err: e, userId }, "loan open failed");
    send(ws, { type: "ERROR", code: "INTERNAL", message: "Internal error" });
  }
}

export async function handleLoanRepay(
  ws: WebSocket<WsUserData>,
  payload: unknown,
  loan: LoanService,
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
    const data = await loan.repay(userId, payload);
    void userActions.log(userId, "LOAN_REPAY", payload);
    send(ws, { type: "LOAN_REPAY_OK", data });
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
    logger.error({ err: e, userId }, "loan repay failed");
    send(ws, { type: "ERROR", code: "INTERNAL", message: "Internal error" });
  }
}
