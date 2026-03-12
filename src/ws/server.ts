/**
 * WebSocket server (uWebSockets.js).
 */

import { createRequire } from "node:module";
import type { WebSocket, us_listen_socket } from "uWebSockets.js";
import {
  createChallenge,
  authenticateWithWallet,
  verifyAccessToken,
} from "../auth/index.js";
import { startMarketEngine } from "../market/engine.js";
import {
  parseMessage,
  serializeMessage,
  type ServerMessage,
} from "./messages.js";
import { registerRefreshRoute } from "../http/refresh.js";
import { registerCommoditiesRoute } from "../http/commodities.js";
import { env } from "../config/env.js";

const require = createRequire(import.meta.url);
const uws = require("uWebSockets.js") as typeof import("uWebSockets.js");
const { App } = uws;

const TOPIC_MARKET = "market";
const TOPIC_GLOBAL = "global";

interface WsUserData {
  profileId: string | null;
  wallet: string | null;
  authenticated: boolean;
}

function userTopic(wallet: string): string {
  return `user:${wallet}`;
}

function send(ws: WebSocket<WsUserData>, msg: ServerMessage): void {
  const bytes = serializeMessage(msg);
  ws.send(bytes, true);
}

export function createWsServer(): void {
  const app = App();

  app.ws<WsUserData>("/ws", {
    compression: uws.DISABLED,
    maxPayloadLength: 16 * 1024,
    idleTimeout: 120,

    open: (ws) => {
      ws.getUserData().profileId = null;
      ws.getUserData().wallet = null;
      ws.getUserData().authenticated = false;

      const challenge = createChallenge();
      send(ws, {
        type: "auth_challenge",
        nonce: challenge.nonce,
        timestamp: challenge.timestamp,
        expires_in: challenge.expiresIn,
      });
    },

    message: async (ws, message, _isBinary) => {
      const msg = parseMessage(message);
      if (!msg) return;

      if (msg.type === "auth") {
        if (msg.session_token) {
          const payload = await verifyAccessToken(msg.session_token);
          if (payload) {
            ws.getUserData().profileId = payload.sub;
            ws.getUserData().wallet = payload.wallet;
            ws.getUserData().authenticated = true;
            ws.subscribe(userTopic(payload.wallet));
            ws.subscribe(TOPIC_MARKET);
            ws.subscribe(TOPIC_GLOBAL);
            send(ws, {
              type: "auth_success",
              access_token: msg.session_token,
              refresh_token: "",
              expires_in: 15 * 60,
            });
            return;
          }
          send(ws, { type: "auth_failed", reason: "Invalid or expired token" });
          return;
        }

        if (
          msg.public_key &&
          msg.signature &&
          msg.nonce !== undefined &&
          msg.timestamp !== undefined
        ) {
          const result = await authenticateWithWallet(
            msg.public_key,
            msg.signature,
            msg.nonce,
            msg.timestamp,
            msg.device_info,
          );

          if ("error" in result) {
            send(ws, { type: "auth_failed", reason: result.error });
            return;
          }

          ws.getUserData().profileId = result.profileId;
          ws.getUserData().wallet = result.wallet;
          ws.getUserData().authenticated = true;
          ws.subscribe(userTopic(result.wallet));
          ws.subscribe(TOPIC_MARKET);
          ws.subscribe(TOPIC_GLOBAL);

          send(ws, {
            type: "auth_success",
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
            expires_in: result.expiresIn,
          });
          return;
        }

        send(ws, { type: "auth_failed", reason: "Missing auth data" });
        return;
      }

      if (msg.type === "heartbeat") {
        if (!ws.getUserData().authenticated) return;
        send(ws, {
          type: "heartbeat_ack",
          payload: { server_time: Math.floor(Date.now() / 1000) },
        });
      }
    },

    close: (ws) => {
      const data = ws.getUserData();
      if (data.wallet) {
        ws.unsubscribe(userTopic(data.wallet));
      }
      ws.unsubscribe(TOPIC_MARKET);
      ws.unsubscribe(TOPIC_GLOBAL);
    },
  });

  registerRefreshRoute(app);
  registerCommoditiesRoute(app);

  startMarketEngine((pulse) => {
    const msg: ServerMessage = {
      type: "market_pulse",
      payload: { ...pulse.multipliers, timestamp: pulse.timestamp },
    };
    const bytes = serializeMessage(msg);
    app.publish(TOPIC_MARKET, bytes, true);
  });

  app.listen(env.port, (listenSocket: us_listen_socket | false) => {
    if (!listenSocket) {
      console.error("Failed to listen on port", env.port);
      process.exit(1);
    }
    console.log(`WebSocket server listening on port ${env.port}`);
  });
}
