/**
 * WebSocket + HTTP server.
 */

import { createRequire } from "node:module";
import type { WebSocket, us_listen_socket } from "uWebSockets.js";
import { createChallenge, authenticateWithWallet, verifyAccessToken } from "../auth/index.js";
import { startMarketEngine, getMarketPulse, rebuildWithCurrentEvent } from "../market/engine.js";
import { startEventEngine, getActiveEvent } from "../market/events.js";
import { startGameClock, getCurrentGameTime } from "../game/clock.js";
import { parseMessage, serializeMessage, type ServerMessage } from "./messages.js";
import { registerRefreshRoute } from "../http/refresh.js";
import { registerCommoditiesRoute } from "../http/commodities.js";
import { registerEventsRoute } from "../http/events.js";
import { env } from "../config/env.js";
import { FarmingEngine } from "../game/farming.js";
import { AnimalEngine } from "../game/animals.js";
import { CraftingEngine } from "../game/crafting.js";
import { getPlayerBalance, setPlayerBalance } from "../economy/ledger.js";
import { supabase } from "../db/supabase.js";
import { withLock } from "../utils/lock.js";
import { recordPlayerActivity } from "../economy/population.js";
import { Treasury } from "../economy/treasury.js";
import { PricingEngine } from "../economy/pricing.js";
import { LoanSystem } from "../economy/loans.js";

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

  // Ensure balance is sent down
  const pid = ws.getUserData().profileId;
  if (pid) {
    getPlayerBalance(pid).then(bal => {
      send(ws, { type: "balance_update", balance: bal });
    }).catch(console.error);
  }
}

async function loadPlayerSession(pid: string) {
  const { data } = await supabase.from('profiles').select('coins').eq('id', pid).single();
  const coins = data?.coins || 0;
  await setPlayerBalance(pid, coins);
}

async function settlePlayerSession(pid: string) {
  const bal = await getPlayerBalance(pid);
  await supabase.from('profiles').update({ coins: bal }).eq('id', pid);
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
            ws.subscribe(`profile:${payload.sub}`);
            ws.subscribe(TOPIC_MARKET);
            ws.subscribe(TOPIC_GLOBAL);
            
            await loadPlayerSession(payload.sub);
            await recordPlayerActivity(payload.sub);

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
          ws.subscribe(`profile:${result.profileId}`);
          ws.subscribe(TOPIC_MARKET);
          ws.subscribe(TOPIC_GLOBAL);

          await loadPlayerSession(result.profileId);
          await recordPlayerActivity(result.profileId);

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
        const pid = ws.getUserData().profileId;
        if (pid) recordPlayerActivity(pid).catch(console.error);

        send(ws, {
          type: "heartbeat_ack",
          payload: { server_time: Math.floor(Date.now() / 1000) },
        });
        return;
      }

      // --- Authenticated Gameplay Actions ---
      if (!ws.getUserData().authenticated || !ws.getUserData().profileId) return;
      const pid = ws.getUserData().profileId as string;

      try {
        await withLock(`player:${pid}`, async () => {
          switch (msg.type) {
            case 'buy_plot': {
              const res = await FarmingEngine.buyPlot(pid, msg.tier as any);
              send(ws, { type: 'action_result', action_type: 'buy_plot', message: 'Plot purchased' });
              send(ws, { type: 'plot_update', plot_id: res.id });
              send(ws, { type: 'balance_update', balance: await getPlayerBalance(pid) });
              break;
            }
            case 'buy_seed': {
              await FarmingEngine.buySeed(pid, msg.crop_id, msg.qty);
              send(ws, { type: 'action_result', action_type: 'buy_seed', message: `Bought ${msg.qty} ${msg.crop_id} seeds` });
              send(ws, { type: 'balance_update', balance: await getPlayerBalance(pid) });
              // Note: In real app, we would query DB to send exact inventory count update
              break;
            }
            case 'plant_crop': {
              await FarmingEngine.plantCrop(pid, msg.plot_id, msg.crop_id);
              send(ws, { type: 'action_result', action_type: 'plant_crop', message: `Planted ${msg.crop_id}` });
              send(ws, { type: 'plot_update', plot_id: msg.plot_id, crop_id: msg.crop_id, planted_at: Date.now(), boost_applied: false });
              break;
            }
            case 'harvest': {
              const res = await FarmingEngine.harvest(pid, msg.plot_id);
              send(ws, { type: 'action_result', action_type: 'harvest', message: `Harvested ${res.items[0].qty} items (xp: ${res.xp})` });
              send(ws, { type: 'plot_update', plot_id: msg.plot_id }); // clears it
              break;
            }
            case 'sell': {
              const res = await FarmingEngine.sell(pid, msg.item_id, msg.qty);
              send(ws, { type: 'action_result', action_type: 'sell', message: `Sold for ${res.earned} tokens` });
              send(ws, { type: 'balance_update', balance: await getPlayerBalance(pid) });
              break;
            }
            case 'collect_animal': {
              const res = await AnimalEngine.collect(pid, msg.animal_id);
              send(ws, { type: 'action_result', action_type: 'collect_animal', message: `Collected! Rare dropped: ${res.rare}` });
              break;
            }
            case 'buy_animal': {
              const res = await AnimalEngine.buyAnimal(pid, msg.animal_type);
              send(ws, { type: 'action_result', action_type: 'buy_animal', message: `Bought a ${msg.animal_type}` });
              send(ws, { type: 'animal_update', id: res.id, animal_type: res.animal_type, locked_for_loan: false, last_mated_at: 0, gestation_ready_at: 0, is_fed: false });
              send(ws, { type: 'balance_update', balance: await getPlayerBalance(pid) });
              break;
            }
            case 'sell_animal': {
              const res = await AnimalEngine.sellAnimal(pid, msg.animal_id);
              send(ws, { type: 'action_result', action_type: 'sell_animal', message: `Sold animal for ${res.refund} tokens` });
              send(ws, { type: 'balance_update', balance: await getPlayerBalance(pid) });
              break;
            }
            case 'feed_animal': {
              await AnimalEngine.feedAnimal(pid, msg.animal_id);
              send(ws, { type: 'action_result', action_type: 'feed_animal', message: `Animal fed! Production doubled.` });
              break;
            }
            case 'mate_animals': {
              const res = await AnimalEngine.mateAnimals(pid, msg.sire_id, msg.dam_id);
              send(ws, { type: 'action_result', action_type: 'mate_animals', message: res.message });
              break;
            }
            case 'buy_incubator': {
              const res = await AnimalEngine.buyIncubator(pid);
              send(ws, { type: 'action_result', action_type: 'buy_incubator', message: 'Incubator purchased!' });
              send(ws, { type: 'incubator_update', id: res.id, egg_type: '', ready_at: 0 });
              send(ws, { type: 'balance_update', balance: await getPlayerBalance(pid) });
              break;
            }
            case 'start_incubation': {
              const res = await AnimalEngine.startIncubation(pid, msg.incubator_id, msg.egg_item_id);
              send(ws, { type: 'action_result', action_type: 'start_incubation', message: `Incubation started, ready at ${res.readyAt}` });
              send(ws, { type: 'incubator_update', id: msg.incubator_id, egg_type: msg.egg_item_id, ready_at: res.readyAt });
              break;
            }
            case 'finish_incubation': {
              const res = await AnimalEngine.finishIncubation(pid, msg.incubator_id);
              send(ws, { type: 'action_result', action_type: 'finish_incubation', message: `Hatched a ${res.animal_type}!` });
              send(ws, { type: 'animal_update', id: res.id, animal_type: res.animal_type, locked_for_loan: false, last_mated_at: 0, gestation_ready_at: 0, is_fed: false });
              break;
            }
            case 'craft': {
              const res = await CraftingEngine.startCrafting(pid, msg.recipe_id);
              send(ws, { type: 'action_result', action_type: 'craft', message: `Crafting started... ready at ${res.ready_at}` });
              break;
            }
            case 'request_loan': {
              const res = await LoanSystem.requestLoan(pid, msg.amount);
              send(ws, { type: 'loan_result', loan_id: res.id, amount: msg.amount, due_at: res.due_at });
              send(ws, { type: 'balance_update', balance: await getPlayerBalance(pid) });
              break;
            }
            case 'repay_loan': {
              const res = await LoanSystem.repayLoan(pid, msg.loan_id, msg.amount);
              send(ws, { type: 'action_result', action_type: 'repay_loan', message: `Repaid ${msg.amount}. Paid off? ${res.isPaidOff}` });
              send(ws, { type: 'balance_update', balance: await getPlayerBalance(pid) });
              break;
            }
          }
        });
      } catch (err: any) {
        send(ws, { type: 'action_error', action_type: msg.type, error: err.message || 'Action failed' });
      }
    },

    close: (ws) => {
      const data = ws.getUserData();
      if (data.wallet) ws.unsubscribe(userTopic(data.wallet));
      ws.unsubscribe(TOPIC_MARKET);
      ws.unsubscribe(TOPIC_GLOBAL);
      
      if (data.profileId) {
        settlePlayerSession(data.profileId).catch(console.error);
      }
    },
  });

  registerRefreshRoute(app);
  registerCommoditiesRoute(app);
  registerEventsRoute(app);

  CraftingEngine.onComplete = (pid, itemId, qty) => {
    // In uWebSockets, we need to know the wallet to find the topic.
    // However, our `pid` is the profile ID. We can either query the DB for the wallet,
    // or we can just subscribe users to a `profile:${pid}` topic instead.
    // Let's use `profile:${pid}` for targeted notifications.
    app.publish(`profile:${pid}`, serializeMessage({ type: 'craft_complete', item_id: itemId, quantity: qty }), true);
  };

  LoanSystem.onSeizure = (pid, seizedAssets, remainingDebt) => {
    app.publish(
      `profile:${pid}`,
      serializeMessage({
        type: 'loan_default',
        seized_assets: seizedAssets,
        remaining_debt: remainingDebt,
      }),
      true
    );
    console.log(`[loan] Seizure notification sent to player ${pid}: ${seizedAssets.length} assets seized, debt: ${remainingDebt}`);
  };

  // Pricing recalculation every 30s (spec §3)
  setInterval(() => {
    PricingEngine.recalculateAll().catch(console.error);
  }, 30 * 1000);

  // Background Database Sync Loop (Every 60s)
  let syncCount = 0;
  setInterval(() => {
    Treasury.syncToDB().catch(console.error);
    PricingEngine.syncToDB().catch(console.error);
    LoanSystem.processSeizures().catch(console.error);
    
    syncCount++;
    if (syncCount % 5 === 0) {
      Treasury.auditIntegrity().catch(console.error);
      PricingEngine.snapshotPriceHistory().catch(console.error);
    }
  }, 60 * 1000);

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
    rebuildWithCurrentEvent();
    if (event) {
      app.publish(
        TOPIC_GLOBAL,
        serializeMessage({ type: "game_event", payload: event }),
        true,
      );
    }
    const pulse = getMarketPulse();
    app.publish(
      TOPIC_MARKET,
      serializeMessage({ type: "market_pulse", payload: { ...pulse.multipliers, timestamp: pulse.timestamp } }),
      true,
    );
  });

  startMarketEngine(async (pulse) => {
    const bytes = serializeMessage({
      type: "market_pulse",
      payload: { ...pulse.multipliers, timestamp: pulse.timestamp },
    });
    app.publish(TOPIC_MARKET, bytes, true);

    // Also send the full price update as requested in architecture §9
    const prices = await PricingEngine.getAllPrices();
    app.publish(TOPIC_MARKET, serializeMessage({ type: 'price_update', prices } as any), true);
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
