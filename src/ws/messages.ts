/**
 * WebSocket message handling - Protobuf streaming.
 * Uses size-delimited format: varint length + message bytes.
 */

import type protobuf from "protobufjs";
import { getClientType, getServerType } from "./proto.js";

// Re-export parsed types for server logic
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
  let i = 0;
  for (; i < data.length; i++) {
    const b = data[i]!;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, bytesRead: i + 1 };
    shift += 7;
    if (shift >= 35) throw new Error("Varint too long");
  }
  throw new Error("Incomplete varint");
}

/**
 * Parse size-delimited protobuf from ArrayBuffer.
 * Returns null on parse error or incomplete data.
 */
export function parseMessage(data: ArrayBuffer): ParsedClientMessage | null {
  try {
    const bytes = new Uint8Array(data);
    if (bytes.length < 2) return null;

    const { value: size, bytesRead } = decodeVarint(bytes);
    if (bytes.length < bytesRead + size) return null;

    const msgBytes = bytes.subarray(bytesRead, bytesRead + size);
    const type = getClientType();
    const msg = type.decode(msgBytes) as protobuf.Message & { payload?: { auth?: object; heartbeat?: object } };

    const payload = msg.payload;
    if (!payload) return null;

    if (payload.auth) {
      const a = payload.auth as { publicKey?: string; signature?: string; nonce?: string; timestamp?: number; sessionToken?: string; deviceInfo?: string };
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
      const h = payload.heartbeat as { localTime?: number; lastActionId?: string };
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

export type ServerMessage =
  | { type: "auth_challenge"; nonce: string; timestamp: number; expires_in: number }
  | { type: "auth_success"; access_token: string; refresh_token: string; expires_in: number }
  | { type: "auth_failed"; reason: string }
  | { type: "market_pulse"; payload: Record<string, number> & { timestamp: number } }
  | { type: "heartbeat_ack"; payload?: { server_time: number } };

/**
 * Serialize server message to size-delimited protobuf binary.
 */
export function serializeMessage(msg: ServerMessage): Uint8Array {
  const type = getServerType();
  let payload: ServerMessagePayload["payload"] = {};

  switch (msg.type) {
    case "auth_challenge":
      payload = { authChallenge: { nonce: msg.nonce, timestamp: msg.timestamp, expiresIn: msg.expires_in } };
      break;
    case "auth_success":
      payload = { authSuccess: { accessToken: msg.access_token, refreshToken: msg.refresh_token, expiresIn: msg.expires_in } };
      break;
    case "auth_failed":
      payload = { authFailed: { reason: msg.reason } };
      break;
    case "market_pulse": {
      const { timestamp, ...multipliers } = msg.payload;
      payload = { marketPulse: { multipliers: multipliers as Record<string, number>, timestamp } };
      break;
    }
    case "heartbeat_ack":
      payload = { heartbeatAck: { serverTime: msg.payload?.server_time ?? 0 } };
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

// Internal - protobufjs uses camelCase for JSON
interface ServerMessagePayload {
  payload?: {
    authChallenge?: { nonce: string; timestamp: number; expiresIn: number };
    authSuccess?: { accessToken: string; refreshToken: string; expiresIn: number };
    authFailed?: { reason: string };
    marketPulse?: { multipliers: Record<string, number>; timestamp: number };
    heartbeatAck?: { serverTime: number };
  };
}
