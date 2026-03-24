import { App, DISABLED } from "uWebSockets.js";
import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../infrastructure/logger/logger.js";
import { dispatchWsMessage, type WsGameContext } from "./ws.router.js";
import type { WsUserData } from "./ws.types.js";

export type ListenToken = unknown;

export function createWsApp(ctx: WsGameContext) {
  return (
    App()
      .ws<WsUserData>("/*", {
        compression: DISABLED,
        idleTimeout: 120,
        maxPayloadLength: 16 * 1024,
        upgrade(res, req, context) {
          const userId = req.getQuery("userId") ?? "";
          if (!userId) {
            res.writeStatus("401 Unauthorized").end("userId query required");
            return;
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
          /* userId already set in upgrade */
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
      .get("/health", (res) => {
        res.writeStatus("200 OK").end("ok");
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
