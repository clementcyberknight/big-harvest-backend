/**
 * Protobuf schema loader and message types.
 * Uses protobufjs for runtime loading (no codegen step).
 */

import protobuf from "protobufjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const protoPath = resolve(__dirname, "../../proto/ws_messages.proto");

let root: protobuf.Root | null = null;

async function loadRoot(): Promise<protobuf.Root> {
  if (root) return root;
  root = await protobuf.load(protoPath);
  return root;
}

export async function getClientMessageType(): Promise<protobuf.Type> {
  const r = await loadRoot();
  return r.lookupType("ClientMessage");
}

export async function getServerMessageType(): Promise<protobuf.Type> {
  const r = await loadRoot();
  return r.lookupType("ServerMessage");
}

let clientType: protobuf.Type | null = null;
let serverType: protobuf.Type | null = null;

export async function initProto(): Promise<void> {
  const [ct, st] = await Promise.all([
    getClientMessageType(),
    getServerMessageType(),
  ]);
  clientType = ct;
  serverType = st;
}

export function getClientType(): protobuf.Type {
  if (!clientType) throw new Error("Proto not initialized - call initProto() first");
  return clientType;
}

export function getServerType(): protobuf.Type {
  if (!serverType) throw new Error("Proto not initialized - call initProto() first");
  return serverType;
}
