import { App, DISABLED } from "uWebSockets.js";
import type { WebSocket } from "uWebSockets.js";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logger/logger.js";
import { getActiveEvent } from "../../modules/ai-events/event.service.js";
import { verifyAccessToken } from "../../modules/auth/jwt.js";
import {
  registerAuthHttp,
  type AuthHttpDeps,
} from "../http/registerAuthHttp.js";
import { registerCatalogHttp } from "../http/registerCatalogHttp.js";
import { sendGameMessage } from "./ws.codec.js";
import { dispatchWsMessage, type WsGameContext } from "./ws.router.js";
import type { WsOutboundMessage, WsUserData } from "./ws.types.js";

// Global reference for broadcasting outside WS handlers (e.g. workers)
let globalApp: ReturnType<typeof App> | null = null;

export function broadcastToSyndicate(
  syndicateId: string,
  message: WsOutboundMessage,
) {
  if (!globalApp) return;
  const topic = `syndicate:${syndicateId}`;
  globalApp.publish(topic, JSON.stringify(message), false);
}

export function broadcastToAll(message: WsOutboundMessage) {
  if (!globalApp) return;
  globalApp.publish("global", JSON.stringify(message), false);
}

export async function broadcastGameStatus(ctx: WsAppContext) {
  if (!globalApp) return;
  try {
    const [prices, activeEvent] = await Promise.all([
      ctx.market.getAllPrices(),
      getActiveEvent(ctx.redis),
    ]);
    broadcastToAll({
      type: "GAME_STATUS",
      data: { prices, activeEvent },
    });
  } catch (err) {
    logger.error({ err }, "failed to broadcast game status");
  }
}

export type ListenToken = unknown;

export type WsAppContext = WsGameContext & AuthHttpDeps;

export function createWsApp(ctx: WsAppContext) {
  const app = App();
  globalApp = app;

  registerAuthHttp(app, {
    auth: ctx.auth,
    profile: ctx.profile,
    userActions: ctx.userActions,
  });
  registerCatalogHttp(app);

  return app.ws<WsUserData>("/ws", {
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
    open(ws: WebSocket<WsUserData>) {
      /* userId set in upgrade */
      // NOTE: "global" subscription is deferred until after the initial unicast
      // messages are sent. Subscribing here would cause any concurrent
      // broadcastGameStatus() call to deliver a second GAME_STATUS to this
      // client before the explicit send below, resulting in a duplicate.
      const { userId } = ws.getUserData();
      logger.debug({ userId }, "ws connected");
      void (async () => {
        try {
          const [prices, activeEvent, gold, inventory, plots] = await Promise.all([
            ctx.market.getAllPrices(),
            getActiveEvent(ctx.redis),
            ctx.market.getUserGold(userId),
            ctx.market.getUserInventory(userId),
            ctx.planting.getPlots(userId),
          ]);

          sendGameMessage(ws, {
            type: "GAME_STATUS",
            data: { prices, activeEvent },
          });

          sendGameMessage(ws, {
            type: "GAME_STATE",
            data: { inventory, gold, plots },
          });

          // Subscribe to global broadcasts only after the initial state has
          // been unicast to this client, avoiding a duplicate GAME_STATUS.
          ws.subscribe("global");

          const sid = await ctx.syndicates
            .viewMembers(ws.getUserData().userId, { syndicateId: "auth-check" })
            .catch(() => null);
          const userSid = await ctx.syndicates.getUserSyndicateId(
            ws.getUserData().userId,
          );

          if (userSid) {
            ws.subscribe(`syndicate:${userSid}`);
          }
        } catch (err) {
          logger.error(
            { err, userId },
            "failed to fetch user syndicate on ws open",
          );
        }
      })();
    },
    message(ws, message, isBinary) {
      void ctx.syndicates.touchPresence(ws.getUserData().userId);
      void dispatchWsMessage(ws, message, isBinary, ctx).catch((err) => {
        logger.error(
          { err, userId: ws.getUserData().userId },
          "ws dispatch failed",
        );
        try {
          sendGameMessage(ws, {
            type: "ERROR",
            code: "INTERNAL",
            message: "Internal error",
          });
        } catch {
          /* ignore */
        }
      });
    },
    close(ws, code, _reason) {
      logger.debug({ userId: ws.getUserData().userId, code }, "ws closed");
    },
  });
}

export function listenGameWs(
  app: ReturnType<typeof createWsApp>,
  port: number,
): Promise<ListenToken> {
  return new Promise((resolve, reject) => {
    app.listen(port, (token) => {
      if (!token) {
        logger.fatal(
          { port },
          "uWS failed to bind — port in use or permission denied",
        );
        reject(new Error(`Failed to listen on port ${port}`));
        return;
      }
      logger.info({ port }, "uWS server listening (HTTP + WS)");
      resolve(token);
    });
  });
}
