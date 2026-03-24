import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Redis } from "ioredis";
import { IDEMPOTENCY_TTL_SEC } from "../../config/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveLuaFile(name: string): string {
  const here = join(__dirname, "scripts", name);
  if (existsSync(here)) return here;
  const fromSrc = join(process.cwd(), "src", "infrastructure", "redis", "scripts", name);
  if (existsSync(fromSrc)) return fromSrc;
  const fromDist = join(process.cwd(), "dist", "infrastructure", "redis", "scripts", name);
  if (existsSync(fromDist)) return fromDist;
  throw new Error(`Missing Lua script: ${name}`);
}

let plantSha: string | null = null;
let harvestSha: string | null = null;
let onboardSha: string | null = null;
let sellSha: string | null = null;
let buySha: string | null = null;
let loanOpenSha: string | null = null;
let loanRepaySha: string | null = null;
let animalFeedSha: string | null = null;
let animalHarvestSha: string | null = null;
let craftStartSha: string | null = null;
let craftClaimSha: string | null = null;

export async function loadRedisScripts(redis: Redis): Promise<void> {
  const plantSrc = readFileSync(resolveLuaFile("plant.lua"), "utf8");
  const harvestSrc = readFileSync(resolveLuaFile("harvest.lua"), "utf8");
  const onboardSrc = readFileSync(resolveLuaFile("onboarding.lua"), "utf8");
  const sellSrc = readFileSync(resolveLuaFile("treasurySell.lua"), "utf8");
  const buySrc = readFileSync(resolveLuaFile("treasuryBuy.lua"), "utf8");
  const loanOpenSrc = readFileSync(resolveLuaFile("loanOriginate.lua"), "utf8");
  const loanRepaySrc = readFileSync(resolveLuaFile("loanRepay.lua"), "utf8");
  const animalFeedSrc = readFileSync(resolveLuaFile("animalFeed.lua"), "utf8");
  const animalHarvestSrc = readFileSync(resolveLuaFile("animalHarvest.lua"), "utf8");
  const craftStartSrc = readFileSync(resolveLuaFile("craftStart.lua"), "utf8");
  const craftClaimSrc = readFileSync(resolveLuaFile("craftClaim.lua"), "utf8");

  plantSha = (await redis.script("LOAD", plantSrc)) as string;
  harvestSha = (await redis.script("LOAD", harvestSrc)) as string;
  onboardSha = (await redis.script("LOAD", onboardSrc)) as string;
  sellSha = (await redis.script("LOAD", sellSrc)) as string;
  buySha = (await redis.script("LOAD", buySrc)) as string;
  loanOpenSha = (await redis.script("LOAD", loanOpenSrc)) as string;
  loanRepaySha = (await redis.script("LOAD", loanRepaySrc)) as string;
  animalFeedSha = (await redis.script("LOAD", animalFeedSrc)) as string;
  animalHarvestSha = (await redis.script("LOAD", animalHarvestSrc)) as string;
  craftStartSha = (await redis.script("LOAD", craftStartSrc)) as string;
  craftClaimSha = (await redis.script("LOAD", craftClaimSrc)) as string;
}

export type PlantScriptResult =
  | { ok: true; cropId: string; plantedAtMs: number; readyAtMs: number; outputQty: number }
  | { ok: true; idempotentReplay: true; cropId: string; plantedAtMs: number; readyAtMs: number; outputQty: number };

export type HarvestScriptResult =
  | { ok: true; itemId: string; quantity: number }
  | { ok: true; idempotentReplay: true; itemId: string; quantity: number };

function parsePlantPayload(raw: string, idempotent: boolean): PlantScriptResult {
  const parts = raw.split("|");
  if (parts[0] !== "OK" || parts.length !== 5) {
    throw new Error(`Invalid plant payload: ${raw}`);
  }
  const [, cropId, plantedAt, readyAt, outputQty] = parts;
  const base = {
    ok: true as const,
    cropId,
    plantedAtMs: Number(plantedAt),
    readyAtMs: Number(readyAt),
    outputQty: Number(outputQty),
  };
  return idempotent ? { ...base, idempotentReplay: true } : base;
}

function parseHarvestPayload(raw: string, idempotent: boolean): HarvestScriptResult {
  const parts = raw.split("|");
  if (parts[0] !== "OK" || parts.length !== 3) {
    throw new Error(`Invalid harvest payload: ${raw}`);
  }
  const [, itemId, qty] = parts;
  const base = { ok: true as const, itemId, quantity: Number(qty) };
  return idempotent ? { ...base, idempotentReplay: true } : base;
}

function isReplyError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

export async function redisPlant(
  redis: Redis,
  keys: { plotKey: string; invKey: string; idempKey: string },
  args: {
    cropId: string;
    plantedAtMs: number;
    readyAtMs: number;
    outputQty: number;
    seedField: string;
    seedCost: number;
    harvestItem: string;
  },
): Promise<PlantScriptResult> {
  if (!plantSha) throw new Error("Redis scripts not loaded");

  const idempTtl = IDEMPOTENCY_TTL_SEC;
  try {
    const res = (await redis.evalsha(
      plantSha,
      3,
      keys.plotKey,
      keys.invKey,
      keys.idempKey,
      args.cropId,
      String(args.plantedAtMs),
      String(args.readyAtMs),
      String(args.outputQty),
      args.seedField,
      String(args.seedCost),
      String(idempTtl),
      args.harvestItem,
    )) as string;
    return parsePlantPayload(res, false);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("ERR_PLOT_OCCUPIED")) throw e;
    if (isReplyError(e) && e.message.includes("ERR_INSUFFICIENT_SEEDS")) throw e;
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisPlant(redis, keys, args);
    }
    throw e;
  }
}

export async function redisGetPlantIdempotency(
  redis: Redis,
  idempKey: string,
): Promise<PlantScriptResult | null> {
  const raw = await redis.get(idempKey);
  if (!raw) return null;
  return parsePlantPayload(raw, true);
}

export async function redisHarvest(
  redis: Redis,
  keys: { plotKey: string; invKey: string; idempKey: string },
  args: { nowMs: number },
): Promise<HarvestScriptResult> {
  if (!harvestSha) throw new Error("Redis scripts not loaded");

  const idempTtl = IDEMPOTENCY_TTL_SEC;
  try {
    const res = (await redis.evalsha(
      harvestSha,
      3,
      keys.plotKey,
      keys.invKey,
      keys.idempKey,
      String(args.nowMs),
      String(idempTtl),
    )) as string;
    return parseHarvestPayload(res, false);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisHarvest(redis, keys, args);
    }
    throw e;
  }
}

export async function redisGetHarvestIdempotency(
  redis: Redis,
  idempKey: string,
): Promise<HarvestScriptResult | null> {
  const raw = await redis.get(idempKey);
  if (!raw) return null;
  return parseHarvestPayload(raw, true);
}

export async function redisOnboard(
  redis: Redis,
  keys: {
    accountInitKey: string;
    walletKey: string;
    invKey: string;
    plotsKey: string;
    reserveKey: string;
  },
  args: {
    starterGold: number;
    seedField: string;
    seedCount: number;
    plotCsv: string;
  },
): Promise<"OK" | "SKIP"> {
  if (!onboardSha) throw new Error("Redis scripts not loaded");
  try {
    const res = (await redis.evalsha(
      onboardSha,
      5,
      keys.accountInitKey,
      keys.walletKey,
      keys.invKey,
      keys.plotsKey,
      keys.reserveKey,
      String(args.starterGold),
      args.seedField,
      String(args.seedCount),
      args.plotCsv,
    )) as string;
    if (res === "SKIP" || res === "OK") return res;
    throw new Error(`Invalid onboard reply: ${res}`);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisOnboard(redis, keys, args);
    }
    throw e;
  }
}

export type TreasuryTradeScriptResult = {
  item: string;
  quantity: number;
  gold: number;
};

function parseTreasuryPayload(raw: string): TreasuryTradeScriptResult {
  const parts = raw.split("|");
  if (parts[0] !== "OK" || parts.length !== 4) {
    throw new Error(`Invalid treasury payload: ${raw}`);
  }
  return { item: parts[1]!, quantity: Number(parts[2]), gold: Number(parts[3]) };
}

export async function redisTreasurySell(
  redis: Redis,
  keys: {
    invKey: string;
    walletKey: string;
    idempKey: string;
    reserveKey: string;
    sellFlowKey: string;
    streamKey: string;
  },
  args: {
    item: string;
    quantity: number;
    goldPayout: number;
    idempTtlSec: number;
    streamEnable: boolean;
    userId: string;
    tsMs: number;
  },
): Promise<TreasuryTradeScriptResult> {
  if (!sellSha) throw new Error("Redis scripts not loaded");
  try {
    const res = (await redis.evalsha(
      sellSha,
      6,
      keys.invKey,
      keys.walletKey,
      keys.idempKey,
      keys.reserveKey,
      keys.sellFlowKey,
      keys.streamKey,
      args.item,
      String(args.quantity),
      String(args.goldPayout),
      String(args.idempTtlSec),
      args.streamEnable ? "1" : "0",
      args.userId,
      String(args.tsMs),
    )) as string;
    return parseTreasuryPayload(res);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisTreasurySell(redis, keys, args);
    }
    throw e;
  }
}

export async function redisTreasuryBuy(
  redis: Redis,
  keys: {
    invKey: string;
    walletKey: string;
    idempKey: string;
    reserveKey: string;
    buyFlowKey: string;
    streamKey: string;
  },
  args: {
    item: string;
    quantity: number;
    goldCost: number;
    idempTtlSec: number;
    streamEnable: boolean;
    userId: string;
    tsMs: number;
  },
): Promise<TreasuryTradeScriptResult> {
  if (!buySha) throw new Error("Redis scripts not loaded");
  try {
    const res = (await redis.evalsha(
      buySha,
      6,
      keys.invKey,
      keys.walletKey,
      keys.idempKey,
      keys.reserveKey,
      keys.buyFlowKey,
      keys.streamKey,
      args.item,
      String(args.quantity),
      String(args.goldCost),
      String(args.idempTtlSec),
      args.streamEnable ? "1" : "0",
      args.userId,
      String(args.tsMs),
    )) as string;
    return parseTreasuryPayload(res);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisTreasuryBuy(redis, keys, args);
    }
    throw e;
  }
}

export type LoanOpenScriptResult = { loanId: string; principal: number };

function parseLoanOpenPayload(raw: string): LoanOpenScriptResult {
  const parts = raw.split("|");
  if (parts[0] !== "OK" || parts.length !== 3) {
    throw new Error(`Invalid loan open payload: ${raw}`);
  }
  return { loanId: parts[1]!, principal: Number(parts[2]) };
}

export async function redisLoanOriginate(
  redis: Redis,
  keys: {
    invKey: string;
    invLockedKey: string;
    walletKey: string;
    reserveKey: string;
    loanRecordKey: string;
    idempKey: string;
    loanActiveKey: string;
    plotsKey: string;
    plotsLockedKey: string;
  },
  args: {
    loanId: string;
    principal: number;
    collateralValueGold: number;
    collateralInvSpec: string;
    collateralPlotCsv: string;
    idempTtlSec: number;
    userId: string;
    tsMs: number;
    borrowedAtMs: number;
    dueAtMs: number;
  },
): Promise<LoanOpenScriptResult> {
  if (!loanOpenSha) throw new Error("Redis scripts not loaded");
  try {
    const res = (await redis.evalsha(
      loanOpenSha,
      9,
      keys.invKey,
      keys.invLockedKey,
      keys.walletKey,
      keys.reserveKey,
      keys.loanRecordKey,
      keys.idempKey,
      keys.loanActiveKey,
      keys.plotsKey,
      keys.plotsLockedKey,
      args.loanId,
      String(args.principal),
      String(args.collateralValueGold),
      args.collateralInvSpec,
      args.collateralPlotCsv,
      String(args.idempTtlSec),
      args.userId,
      String(args.tsMs),
      String(args.borrowedAtMs),
      String(args.dueAtMs),
    )) as string;
    return parseLoanOpenPayload(res);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisLoanOriginate(redis, keys, args);
    }
    throw e;
  }
}

export type LoanRepayScriptResult = { loanId: string; totalPaid: number };

function parseLoanRepayPayload(raw: string): LoanRepayScriptResult {
  const parts = raw.split("|");
  if (parts[0] !== "OK" || parts.length !== 3) {
    throw new Error(`Invalid loan repay payload: ${raw}`);
  }
  return { loanId: parts[1]!, totalPaid: Number(parts[2]) };
}

export async function redisLoanRepay(
  redis: Redis,
  keys: {
    invKey: string;
    invLockedKey: string;
    walletKey: string;
    reserveKey: string;
    loanRecordKey: string;
    idempKey: string;
    loanActiveKey: string;
    plotsKey: string;
    plotsLockedKey: string;
  },
  args: {
    loanId: string;
    totalDueGold: number;
    idempTtlSec: number;
    userId: string;
    tsMs: number;
  },
): Promise<LoanRepayScriptResult> {
  if (!loanRepaySha) throw new Error("Redis scripts not loaded");
  try {
    const res = (await redis.evalsha(
      loanRepaySha,
      9,
      keys.invKey,
      keys.invLockedKey,
      keys.walletKey,
      keys.reserveKey,
      keys.loanRecordKey,
      keys.idempKey,
      keys.loanActiveKey,
      keys.plotsKey,
      keys.plotsLockedKey,
      args.loanId,
      String(args.totalDueGold),
      String(args.idempTtlSec),
      args.userId,
      String(args.tsMs),
    )) as string;
    return parseLoanRepayPayload(res);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisLoanRepay(redis, keys, args);
    }
    throw e;
  }
}

export type AnimalFeedResult = {
  species: string;
  feedUsed: number;
  nextProduceMs: number;
};

function parseAnimalFeedPayload(raw: string): AnimalFeedResult {
  const parts = raw.split("|");
  if (parts[0] !== "OK" || parts.length !== 4) {
    throw new Error(`Invalid animal feed payload: ${raw}`);
  }
  return {
    species: parts[1]!,
    feedUsed: Number(parts[2]),
    nextProduceMs: Number(parts[3]),
  };
}

export async function redisAnimalFeed(
  redis: Redis,
  keys: { invKey: string; stateKey: string; idempKey: string },
  args: {
    speciesKey: string;
    animalInvField: string;
    feedItem: string;
    feedPerAnimal: number;
    nowMs: number;
    produceIntervalMs: number;
    fedWindowMs: number;
    idempTtlSec: number;
  },
): Promise<AnimalFeedResult> {
  if (!animalFeedSha) throw new Error("Redis scripts not loaded");
  try {
    const res = (await redis.evalsha(
      animalFeedSha,
      3,
      keys.invKey,
      keys.stateKey,
      keys.idempKey,
      args.speciesKey,
      args.animalInvField,
      args.feedItem,
      String(args.feedPerAnimal),
      String(args.nowMs),
      String(args.produceIntervalMs),
      String(args.fedWindowMs),
      String(args.idempTtlSec),
    )) as string;
    return parseAnimalFeedPayload(res);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisAnimalFeed(redis, keys, args);
    }
    throw e;
  }
}

export type AnimalHarvestResult = {
  produceItem: string;
  quantity: number;
  nextProduceMs: number;
};

function parseAnimalHarvestPayload(raw: string): AnimalHarvestResult {
  const parts = raw.split("|");
  if (parts[0] !== "OK" || parts.length !== 4) {
    throw new Error(`Invalid animal harvest payload: ${raw}`);
  }
  return {
    produceItem: parts[1]!,
    quantity: Number(parts[2]),
    nextProduceMs: Number(parts[3]),
  };
}

export async function redisAnimalHarvest(
  redis: Redis,
  keys: { invKey: string; stateKey: string; idempKey: string },
  args: {
    speciesKey: string;
    animalInvField: string;
    produceItem: string;
    maxProduce: number;
    produceIntervalMs: number;
    nowMs: number;
    idempTtlSec: number;
  },
): Promise<AnimalHarvestResult> {
  if (!animalHarvestSha) throw new Error("Redis scripts not loaded");
  try {
    const res = (await redis.evalsha(
      animalHarvestSha,
      3,
      keys.invKey,
      keys.stateKey,
      keys.idempKey,
      args.speciesKey,
      args.animalInvField,
      args.produceItem,
      String(args.maxProduce),
      String(args.produceIntervalMs),
      String(args.nowMs),
      String(args.idempTtlSec),
    )) as string;
    return parseAnimalHarvestPayload(res);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisAnimalHarvest(redis, keys, args);
    }
    throw e;
  }
}

export type CraftStartResult = {
  pendingId: string;
  readyAtMs: number;
  outputItem: string;
  outputQty: number;
};

function parseCraftStartPayload(raw: string): CraftStartResult {
  const parts = raw.split("|");
  if (parts[0] !== "OK" || parts.length !== 5) {
    throw new Error(`Invalid craft start payload: ${raw}`);
  }
  return {
    pendingId: parts[1]!,
    readyAtMs: Number(parts[2]),
    outputItem: parts[3]!,
    outputQty: Number(parts[4]),
  };
}

export async function redisCraftStart(
  redis: Redis,
  keys: { invKey: string; pendingKey: string; idempKey: string },
  args: {
    pendingId: string;
    toolField: string;
    toolMin: number;
    ingredientSpec: string;
    readyAtMs: number;
    outputItem: string;
    outputQty: number;
    idempTtlSec: number;
  },
): Promise<CraftStartResult> {
  if (!craftStartSha) throw new Error("Redis scripts not loaded");
  try {
    const res = (await redis.evalsha(
      craftStartSha,
      3,
      keys.invKey,
      keys.pendingKey,
      keys.idempKey,
      args.pendingId,
      args.toolField,
      String(args.toolMin),
      args.ingredientSpec,
      String(args.readyAtMs),
      args.outputItem,
      String(args.outputQty),
      String(args.idempTtlSec),
    )) as string;
    return parseCraftStartPayload(res);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisCraftStart(redis, keys, args);
    }
    throw e;
  }
}

export type CraftClaimResult = { item: string; quantity: number };

function parseCraftClaimPayload(raw: string): CraftClaimResult {
  const parts = raw.split("|");
  if (parts[0] !== "OK" || parts.length !== 3) {
    throw new Error(`Invalid craft claim payload: ${raw}`);
  }
  return { item: parts[1]!, quantity: Number(parts[2]) };
}

export async function redisCraftClaim(
  redis: Redis,
  keys: { invKey: string; pendingKey: string; idempKey: string },
  args: { pendingId: string; nowMs: number; idempTtlSec: number },
): Promise<CraftClaimResult> {
  if (!craftClaimSha) throw new Error("Redis scripts not loaded");
  try {
    const res = (await redis.evalsha(
      craftClaimSha,
      3,
      keys.invKey,
      keys.pendingKey,
      keys.idempKey,
      args.pendingId,
      String(args.nowMs),
      String(args.idempTtlSec),
    )) as string;
    return parseCraftClaimPayload(res);
  } catch (e) {
    if (isReplyError(e) && e.message.includes("NOSCRIPT")) {
      await loadRedisScripts(redis);
      return redisCraftClaim(redis, keys, args);
    }
    throw e;
  }
}
