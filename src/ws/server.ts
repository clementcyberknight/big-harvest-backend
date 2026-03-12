/**
 * WebSocket + HTTP server.
 */

import { createRequire } from "node:module";
import type { WebSocket, us_listen_socket } from "uWebSockets.js";
import { createChallenge, authenticateWithWallet, verifyAccessToken } from "../auth/index.js";
import { startMarketEngine, getMarketPulse } from "../market/engine.js";
import { startEventEngine, getActiveEvent } from "../market/events.js";
import { startGameClock, getCurrentGameTime } from "../game/clock.js";
import { parseMessage, serializeMessage, type ServerMessage } from "./messages.js";
import { registerRefreshRoute } from "../http/refresh.js";
import { registerCommoditiesRoute } from "../http/commodities.js";
import { registerEventsRoute } from "../http/events.js";
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
  ws.send(serializeMessage(msg), true);
}

function sendInitialState(ws: WebSocket<WsUserData>): void {
  const time = getCurrentGameTime();
  send(ws, { type: "game_clock", payload: time });

  const pulse = getMarketPulse();
  send(ws, {
    type: "market_pulse",
    payload: { ...pulse.multipliers, timestamp: pulse.timestamp },
  });

  const event = getActiveEvent();
  if (event) {
    send(ws, { type: "game_event", payload: event });
  }
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
            sendInitialState(ws);
            return;
          }
          send(ws, { type: "auth_failed", reason: "Invalid or expired token" });
          return;
        }

        // ── Full wallet sign-in ───────────────────────────────────────────
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
          sendInitialState(ws);
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
      if (data.wallet) ws.unsubscribe(userTopic(data.wallet));
      ws.unsubscribe(TOPIC_MARKET);
      ws.unsubscribe(TOPIC_GLOBAL);
    },
  });

  registerRefreshRoute(app);
  registerCommoditiesRoute(app);
  registerEventsRoute(app);

  startGameClock(
    // Every game day: broadcast game_clock to all market subscribers
    (time) => {
      const bytes = serializeMessage({ type: "game_clock", payload: time });
      app.publish(TOPIC_MARKET, bytes, true);
      console.log(
        `[clock] Day ${time.total_days} | Year ${time.year} | ${time.season} day ${time.season_day}`,
      );
    },

    // Every season change: broadcast season_change + push current active event
    (time) => {
      console.log(`[clock] Season → ${time.season} (Year ${time.year})`);

      app.publish(
        TOPIC_GLOBAL,
        serializeMessage({
          type: "season_change",
          payload: {
            new_season: time.season,
            year: time.year,
            started_at: time.real_time,
          },
        }),
        true,
      );

      // Re-broadcast the currently active event so clients know it applies to new season
      const event = getActiveEvent();
      if (event) {
        app.publish(
          TOPIC_GLOBAL,
          serializeMessage({ type: "game_event", payload: event }),
          true,
        );
      }
    },
  );

  startEventEngine((event) => {
    if (event) {
      app.publish(
        TOPIC_GLOBAL,
        serializeMessage({ type: "game_event", payload: event }),
        true,
      );
    }
  });

  startMarketEngine((pulse) => {
    const bytes = serializeMessage({
      type: "market_pulse",
      payload: { ...pulse.multipliers, timestamp: pulse.timestamp },
    });
    app.publish(TOPIC_MARKET, bytes, true);
  });

  app.listen(env.port, (listenSocket: us_listen_socket | false) => {
    if (!listenSocket) {
      console.error("[server] Failed to listen on port", env.port);
      process.exit(1);
    }
    const time = getCurrentGameTime();
    console.log(`[server] Listening on port ${env.port}`);
    console.log(
      `[clock]  Year ${time.year} | ${time.season} day ${time.season_day} | next day in ${Math.round((time.next_day_at - Date.now()) / 1000)}s`,
    );
  });
}
