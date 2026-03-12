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
    };

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
  | { type: "game_event"; payload: MarketEvent };

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
      payload?: { auth?: object; heartbeat?: object };
    };

    const payload = msg.payload;
    if (!payload) return null;

    if (payload.auth) {
      const a = payload.auth as {
        publicKey?: string;
        signature?: string;
        nonce?: string;
        timestamp?: number;
        sessionToken?: string;
        deviceInfo?: string;
      };
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
      const h = payload.heartbeat as {
        localTime?: number;
        lastActionId?: string;
      };
      return {
        type: "heartbeat",
        payload: { local_time: h.localTime, last_action_id: h.lastActionId },
      };
    }

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
}
