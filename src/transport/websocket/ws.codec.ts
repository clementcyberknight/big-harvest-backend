import { Packr } from "msgpackr";
import type { WebSocket } from "uWebSockets.js";
import type {
  WsInboundMessage,
  WsOutboundMessage,
  WsUserData,
} from "./ws.types.js";

/**
 * Binary MessagePack for the WebSocket hot path.
 * Outbound is always msgpack binary frames; inbound accepts msgpack binary or UTF-8 JSON (dev/tools).
 */
export const packr = new Packr({
  /* Avoid record structures so arbitrary game payloads round-trip without schema registration */
  useRecords: false,
});

function bufferFromMessage(message: ArrayBuffer | Uint8Array): Buffer {
  return Buffer.from(
    message instanceof ArrayBuffer ? new Uint8Array(message) : message,
  );
}

export function sendGameMessage(
  ws: WebSocket<WsUserData>,
  msg: WsOutboundMessage,
): void {
  const packed = packr.pack(msg) as Buffer;
  ws.send(packed, true);
}

function normalizeInbound(o: unknown): WsInboundMessage | null {
  if (typeof o !== "object" || o === null) return null;
  const rec = o as Record<string, unknown>;
  const type = rec.type;
  if (
    type === "PLANT" ||
    type === "HARVEST" ||
    type === "SELL" ||
    type === "BUY" ||
    type === "LOAN_OPEN" ||
    type === "LOAN_REPAY" ||
    type === "ANIMAL_FEED" ||
    type === "ANIMAL_HARVEST" ||
    type === "CRAFT_START" ||
    type === "CRAFT_CLAIM" ||
    type === "CREATE_SYNDICATE" ||
    type === "LIST_SYNDICATE" ||
    type === "VIEW_SYNDICATE" ||
    type === "REQUEST_JOIN" ||
    type === "ACCEPT_REQUEST" ||
    type === "DEPOSIT_BANK" ||
    type === "BUY_SHIELD" ||
    type === "ATTACK_SYNDICATE" ||
    type === "IDOL_CONTRIBUTE" ||
    type === "SYNDICATE_CHAT_SEND" ||
    type === "SYNDICATE_CHAT_LIST" ||
    type === "LEAVE_SYNDICATE" ||
    type === "DISBAND_SYNDICATE" ||
    type === "VIEW_SYNDICATE_MEMBER" ||
    type === "VIEW_GOLD_BANK" ||
    type === "VIEW_COMMODITY_BANK" ||
    type === "VIEW_MEMBER_CONTRIBUTION" ||
    type === "VIEW_LEADERBOARD"
  ) {
    return { type, payload: rec.payload } as WsInboundMessage;
  }
  if (type === "PING") {
    return { type: "PING", payload: rec.payload };
  }
  return null;
}

export function parseWsInbound(
  message: ArrayBuffer | Uint8Array,
  isBinary: boolean,
): WsInboundMessage | null {
  if (isBinary) {
    try {
      const unpacked = packr.unpack(bufferFromMessage(message));
      return normalizeInbound(unpacked);
    } catch {
      return null;
    }
  }

  try {
    const text = bufferFromMessage(message).toString("utf8");
    const raw = JSON.parse(text) as unknown;
    return normalizeInbound(raw);
  } catch {
    return null;
  }
}
