import { App, DISABLED } from "uWebSockets.js";
import type { WebSocket } from "uWebSockets.js";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logger/logger.js";
import { verifyAccessToken } from "../../modules/auth/jwt.js";
import {
  registerAuthHttp,
  type AuthHttpDeps,
} from "../http/registerAuthHttp.js";
import { dispatchWsMessage, type WsGameContext } from "./ws.router.js";
import type { WsUserData } from "./ws.types.js";

export type ListenToken = unknown;

export type WsAppContext = WsGameContext & AuthHttpDeps;

export function createWsApp(ctx: WsAppContext) {
  const app = App();

  registerAuthHttp(app, {
    auth: ctx.auth,
    profile: ctx.profile,
    userActions: ctx.userActions,
  });

  return (
    app
      .ws<WsUserData>("/*", {
        compression: DISABLED,
        idleTimeout: 120,
        maxPayloadLength: 16 * 1024,
        upgrade(res, req, context) {
          let userId: string;

          if (env.AUTH_DEV_BYPASS) {
            const q = req.getQuery("userId") ?? "";
            if (!q) {
              res
                .writeStatus("401 Unauthorized")
                .end("userId query required when AUTH_DEV_BYPASS=true");
              return;
            }
            userId = q;
          } else {
            const header = req.getHeader("authorization");
            let token = "";
            if (header?.toLowerCase().startsWith("bearer ")) {
              token = header.slice(7).trim();
            }
            if (!token) {
              token = (req.getQuery("token") ?? "").trim();
            }
            if (!token) {
              res
                .writeStatus("401 Unauthorized")
                .end("JWT required: Authorization: Bearer <token> or ?token=");
              return;
            }
            const payload = verifyAccessToken(token);
            if (!payload) {
              res.writeStatus("401 Unauthorized").end("Invalid or expired token");
              return;
            }
            userId = payload.sub;
          }

          res.upgrade(
            { userId },
            req.getHeader("sec-websocket-key"),
            req.getHeader("sec-websocket-protocol"),
            req.getHeader("sec-websocket-extensions"),
            context,
          );
        },
        open(_ws: WebSocket<WsUserData>) {
          /* userId set in upgrade */
        },
        message(ws, message, _isBinary) {
          const text = Buffer.from(message).toString("utf8");
          void dispatchWsMessage(ws, text, ctx).catch((err) => {
            logger.error({ err, userId: ws.getUserData().userId }, "ws dispatch failed");
            try {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  code: "INTERNAL",
                  message: "Internal error",
                }),
                false,
              );
            } catch {
              /* ignore */
            }
          });
        },
        close(ws, code, _reason) {
          logger.debug({ userId: ws.getUserData().userId, code }, "ws closed");
        },
      })
  );
}

export function listenGameWs(app: ReturnType<typeof createWsApp>, port: number): Promise<ListenToken> {
  return new Promise((resolve, reject) => {
    app.listen(port, (token) => {
      if (!token) {
        reject(new Error(`Failed to listen on port ${port}`));
        return;
      }
      logger.info({ port }, "WebSocket server listening");
      resolve(token);
    });
  });
}
