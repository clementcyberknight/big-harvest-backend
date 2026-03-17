/**
 * WebSocket message handling.
 */

import type protobuf from "protobufjs";
import { getClientType, getServerType } from "./proto.js";
import type { GameTime } from "../game/clock.js";
import type { MarketEvent } from "../market/events.js";

// ── Client message types ──────────────────────────────────────────────────────

export type ParsedClientMessage =
  | {
      type: "auth";
      public_key?: string;
      signature?: string;
      nonce?: string;
      timestamp?: number;
      session_token?: string;
      device_info?: string;
    }
  | {
      type: "heartbeat";
      payload?: { local_time?: number; last_action_id?: string };
    }
  | { type: "buy_plot"; tier: string }
  | { type: "buy_seed"; crop_id: string; qty: number }
  | { type: "plant_crop"; plot_id: string; crop_id: string }
  | { type: "harvest"; plot_id: string }
  | { type: "sell"; item_id: string; qty: number }
  | { type: "collect_animal"; animal_id: string }
  | { type: "craft"; recipe_id: string }
  | { type: "buy_animal"; animal_type: string }
  | { type: "sell_animal"; animal_id: string }
  | { type: "feed_animal"; animal_id: string }
  | { type: "mate_animals"; sire_id: string; dam_id: string }
  | { type: "buy_incubator" }
  | { type: "start_incubation"; incubator_id: string; egg_item_id: string }
  | { type: "finish_incubation"; incubator_id: string }
  | { type: "request_loan"; amount: number }
  | { type: "repay_loan"; loan_id: string; amount: number };

// ── Server message types ─────────────────────────────────────────────────────

export type ServerMessage =
  | {
      type: "auth_challenge";
      nonce: string;
      timestamp: number;
      expires_in: number;
    }
  | {
      type: "auth_success";
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }
  | { type: "auth_failed"; reason: string }
  | { type: "heartbeat_ack"; payload?: { server_time: number } }
  | {
      type: "market_pulse";
      payload: Record<string, number> & { timestamp: number };
    }
  | { type: "game_clock"; payload: GameTime }
  | {
      type: "season_change";
      payload: { new_season: string; year: number; started_at: number };
    }
  | { type: "game_event"; payload: MarketEvent }
  | { type: "balance_update"; balance: number }
  | { type: "inventory_update"; item_id: string; quantity: number }
  | { type: "plot_update"; plot_id: string; crop_id?: string; planted_at?: number; boost_applied?: boolean }
  | { type: "action_result"; action_type: string; message: string }
  | { type: "action_error"; action_type: string; error: string }
  | { type: "loan_result"; loan_id: string; amount: number; due_at: number }
  | { type: "craft_complete"; item_id: string; quantity: number }
  | { type: "price_update"; prices: any[] }
  | { type: "loan_default"; seized_assets: Array<{ type: string; id: string; value: number }>; remaining_debt: number }
  | { type: "animal_update"; id: string; animal_type: string; locked_for_loan: boolean; last_mated_at: number; gestation_ready_at: number; is_fed: boolean }
  | { type: "incubator_update"; id: string; egg_type: string; ready_at: number };

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let n = value;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    bytes.push(b);
  } while (n);
  return new Uint8Array(bytes);
}

function decodeVarint(data: Uint8Array): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, bytesRead: i + 1 };
    shift += 7;
    if (shift >= 35) throw new Error("Varint too long");
  }
  throw new Error("Incomplete varint");
}

// ── Parse (Client → Server) ──────────────────────────────────────────────────

/**
 * Parse a size-delimited protobuf ClientMessage from an ArrayBuffer.
 * Returns null on any parse/decode error.
 */
export function parseMessage(data: ArrayBuffer): ParsedClientMessage | null {
  try {
    const bytes = new Uint8Array(data);
    if (bytes.length < 2) return null;

    const { value: size, bytesRead } = decodeVarint(bytes);
    if (bytes.length < bytesRead + size) return null;

    const msgBytes = bytes.subarray(bytesRead, bytesRead + size);
    const type = getClientType();
    const msg = type.decode(msgBytes) as protobuf.Message & {
      payload?: {
        auth?: object; 
        heartbeat?: object;
        buyPlot?: { tier: string };
        buySeed?: { cropId: string, qty: number };
        plantCrop?: { plotId: string, cropId: string };
        harvest?: { plotId: string };
        sell?: { itemId: string, qty: number };
        collectAnimal?: { animalId: string };
        craft?: { recipeId: string };
        buyAnimal?: { animalType: string };
        sellAnimal?: { animalId: string };
        feedAnimal?: { animalId: string };
        mateAnimals?: { sireId: string, damId: string };
        buyIncubator?: object;
        startIncubation?: { incubatorId: string, eggItemId: string };
        finishIncubation?: { incubatorId: string };
        requestLoan?: { amount: number };
        repayLoan?: { loanId: string; amount: number };
      };
    };

    const payload = msg.payload;
    if (!payload) return null;

    if (payload.auth) {
      const a = payload.auth as any;
      return {
        type: "auth",
        public_key: a.publicKey,
        signature: a.signature,
        nonce: a.nonce,
        timestamp: a.timestamp,
        session_token: a.sessionToken,
        device_info: a.deviceInfo,
      };
    }

    if (payload.heartbeat) {
      const h = payload.heartbeat as any;
      return {
        type: "heartbeat",
        payload: { local_time: h.localTime, last_action_id: h.lastActionId },
      };
    }

    if (payload.buyPlot) return { type: "buy_plot", tier: payload.buyPlot.tier };
    if (payload.buySeed) return { type: "buy_seed", crop_id: payload.buySeed.cropId, qty: payload.buySeed.qty };
    if (payload.plantCrop) return { type: "plant_crop", plot_id: payload.plantCrop.plotId, crop_id: payload.plantCrop.cropId };
    if (payload.harvest) return { type: "harvest", plot_id: payload.harvest.plotId };
    if (payload.sell) return { type: "sell", item_id: payload.sell.itemId, qty: payload.sell.qty };
    if (payload.collectAnimal) return { type: "collect_animal", animal_id: payload.collectAnimal.animalId };
    if (payload.craft) return { type: "craft", recipe_id: payload.craft.recipeId };
    if (payload.buyAnimal) return { type: "buy_animal", animal_type: payload.buyAnimal.animalType };
    if (payload.sellAnimal) return { type: "sell_animal", animal_id: payload.sellAnimal.animalId };
    if (payload.feedAnimal) return { type: "feed_animal", animal_id: payload.feedAnimal.animalId };
    if (payload.mateAnimals) return { type: "mate_animals", sire_id: payload.mateAnimals.sireId, dam_id: payload.mateAnimals.damId };
    if (payload.buyIncubator) return { type: "buy_incubator" };
    if (payload.startIncubation) return { type: "start_incubation", incubator_id: payload.startIncubation.incubatorId, egg_item_id: payload.startIncubation.eggItemId };
    if (payload.finishIncubation) return { type: "finish_incubation", incubator_id: payload.finishIncubation.incubatorId };
    if (payload.requestLoan) return { type: "request_loan", amount: payload.requestLoan.amount };
    if (payload.repayLoan) return { type: "repay_loan", loan_id: payload.repayLoan.loanId, amount: payload.repayLoan.amount };

    return null;
  } catch {
    return null;
  }
}

// ── Serialize (Server → Client) ──────────────────────────────────────────────

/**
 * Serialize a ServerMessage to size-delimited protobuf binary.
 * All messages use the same ServerMessage wrapper with a oneof payload.
 */
export function serializeMessage(msg: ServerMessage): Uint8Array {
  const type = getServerType();
  let payload: ProtoPayload = {};

  switch (msg.type) {
    case "auth_challenge":
      payload = {
        authChallenge: {
          nonce: msg.nonce,
          timestamp: msg.timestamp,
          expiresIn: msg.expires_in,
        },
      };
      break;

    case "auth_success":
      payload = {
        authSuccess: {
          accessToken: msg.access_token,
          refreshToken: msg.refresh_token,
          expiresIn: msg.expires_in,
        },
      };
      break;

    case "auth_failed":
      payload = { authFailed: { reason: msg.reason } };
      break;

    case "heartbeat_ack":
      payload = { heartbeatAck: { serverTime: msg.payload?.server_time ?? 0 } };
      break;

    case "market_pulse": {
      const { timestamp, ...multipliers } = msg.payload;
      payload = {
        marketPulse: {
          multipliers: multipliers as Record<string, number>,
          timestamp,
        },
      };
      break;
    }

    case "game_clock": {
      const t = msg.payload;
      payload = {
        gameClock: {
          season: t.season,
          seasonDay: t.season_day,
          year: t.year,
          totalDays: t.total_days,
          nextDayAt: t.next_day_at,
          nextSeasonAt: t.next_season_at,
        },
      };
      break;
    }

    case "season_change":
      payload = {
        seasonChange: {
          newSeason: msg.payload.new_season,
          year: msg.payload.year,
          startedAt: msg.payload.started_at,
        },
      };
      break;

    case "game_event": {
      const e = msg.payload;
      payload = {
        gameEvent: {
          eventTitle: e.event,
          description: e.description,
          affect: e.affect,
          outcome: e.outcome,
          impactMultiplier: e.impact_multiplier,
          playerTip: e.player_tip,
          generatedAt: new Date(e.generated_at).getTime(),
          expiresAt: new Date(e.expires_at).getTime(),
        },
      };
      break;
    }

    case "balance_update":
      payload = { balanceUpdate: { balance: msg.balance } };
      break;

    case "inventory_update":
      payload = { inventoryUpdate: { itemId: msg.item_id, quantity: msg.quantity } };
      break;

    case "plot_update":
      payload = {
        plotUpdate: {
          plotId: msg.plot_id,
          cropId: msg.crop_id || "",
          plantedAt: msg.planted_at || 0,
          boostApplied: msg.boost_applied || false
        }
      };
      break;

    case "action_result":
      payload = { actionResult: { actionType: msg.action_type, message: msg.message } };
      break;

    case "action_error":
      payload = { actionError: { actionType: msg.action_type, error: msg.error } };
      break;

    case "loan_result":
      payload = {
        loanResult: {
          loanId: msg.loan_id,
          amount: msg.amount,
          dueAt: msg.due_at,
        },
      };
      break;

    case "craft_complete":
      payload = { craftComplete: { itemId: msg.item_id, quantity: msg.quantity } };
      break;

    case "loan_default":
      payload = {
        loanDefault: {
          seizedAssets: msg.seized_assets.map(a => ({ type: a.type, id: a.id, value: a.value })),
          remainingDebt: msg.remaining_debt,
        },
      };
      break;

    case "price_update":
      payload = {
        priceUpdate: {
          prices: msg.prices.map(p => ({
            id: p.id,
            buyPrice: p.current_buy_price,
            sellPrice: p.current_sell_price,
            demandMult: p.demand_multiplier
          }))
        }
      };
      break;
  }

  const obj = type.create({ payload });
  const msgBytes = type.encode(obj).finish();
  const sizeBytes = encodeVarint(msgBytes.length);
  const out = new Uint8Array(sizeBytes.length + msgBytes.length);
  out.set(sizeBytes);
  out.set(msgBytes, sizeBytes.length);
  return out;
}

// ── Internal proto shape (protobufjs uses camelCase field names) ─────────────

interface ProtoPayload {
  authChallenge?: { nonce: string; timestamp: number; expiresIn: number };
  authSuccess?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  authFailed?: { reason: string };
  heartbeatAck?: { serverTime: number };
  marketPulse?: { multipliers: Record<string, number>; timestamp: number };
  gameClock?: {
    season: string;
    seasonDay: number;
    year: number;
    totalDays: number;
    nextDayAt: number;
    nextSeasonAt: number;
  };
  seasonChange?: { newSeason: string; year: number; startedAt: number };
  gameEvent?: {
    eventTitle: string;
    description: string;
    affect: string[];
    outcome: string;
    impactMultiplier: number;
    playerTip: string;
    generatedAt: number;
    expiresAt: number;
  };
  balanceUpdate?: { balance: number };
  inventoryUpdate?: { itemId: string; quantity: number };
  plotUpdate?: { plotId: string; cropId: string; plantedAt: number; boostApplied: boolean };
  actionResult?: { actionType: string; message: string };
  actionError?: { actionType: string; error: string };
  loanResult?: { loanId: string; amount: number; dueAt: number };
  craftComplete?: { itemId: string; quantity: number };
  loanDefault?: {
    seizedAssets: Array<{ type: string; id: string; value: number }>;
    remainingDebt: number;
  };
  priceUpdate?: {
    prices: Array<{
      id: string;
      buyPrice: number;
      sellPrice: number;
      demandMult: number;
    }>;
  };
  animalUpdate?: {
    id: string;
    animalType: string;
    lockedForLoan: boolean;
    lastMatedAt: number;
    gestationReadyAt: number;
    isFed: boolean;
  };
  incubatorUpdate?: {
    id: string;
    eggType: string;
    readyAt: number;
  };
}
