import type { Redis } from "ioredis";
import { IDEMPOTENCY_TTL_SEC, MAX_SYNDICATE_MEMBERS } from "../../config/constants.js";
import { logger } from "../../infrastructure/logger/logger.js";
import {
  inventoryKey,
  syndicateBankGoldKey,
  syndicateBankItemsKey,
  syndicateChatKey,
  syndicateContributionGoldKey,
  syndicateContributionItemsKey,
  syndicateIdolKey,
  syndicateIdolRequestKey,
  syndicateJoinRequestsKey,
  syndicateMemberRolesKey,
  syndicateMembersKey,
  syndicateMemberSeenKey,
  syndicateMetaKey,
  syndicateNameIndexKey,
  syndicateSeqKey,
  syndicateShieldExpiresAtKey,
  userAttackCooldownKey,
  userLastSeenKey,
  userLevelKey,
  userSyndicateIdKey,
  walletKey,
  syndicateHoldingsKey,
} from "../../infrastructure/redis/keys.js";
import {
  redisSyndicateAcceptJoin,
  redisSyndicateAttack,
  redisSyndicateBuyShield,
  redisSyndicateCreate,
  redisSyndicateDeposit,
  redisSyndicateIdolContribute,
  redisSyndicateLeaveOrDisband,
  redisSyndicateRequestJoin,
} from "../../infrastructure/redis/commands.js";
import { AppError } from "../../shared/errors/appError.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import { SyndicateRepository } from "./syndicate.repository.js";
import type {
  AcceptJoinCommand,
  AttackSyndicateCommand,
  BuyShieldCommand,
  CreateSyndicateCommand,
  DepositBankCommand,
  DisbandSyndicateCommand,
  IdolContributeCommand,
  LeaveSyndicateCommand,
  ListSyndicatesQuery,
  RequestJoinCommand,
  SyndicateChatSendCommand,
  SyndicateMember,
  SyndicateSummary,
  SyndicateView,
  ViewBankQuery,
  ViewContributionQuery,
  ViewSyndicateMemberQuery,
} from "./syndicate.types.js";
import {
  acceptJoinSchema,
  attackSyndicateSchema,
  buyShieldSchema,
  createSyndicateSchema,
  depositBankSchema,
  disbandSyndicateSchema,
  idolContributeSchema,
  leaveSyndicateSchema,
  requestJoinSchema,
  syndicateChatSendSchema,
  viewBankSchema,
  viewContributionSchema,
  viewSyndicateMemberSchema,
} from "./syndicate.validator.js";

const MIN_CREATE_LEVEL = 13;
const CHAT_MAX = 200;

function toInt(n: unknown, fallback: number): number {
  const x = Number(n);
  return Number.isFinite(x) ? Math.floor(x) : fallback;
}

function nowMs(): number {
  return Date.now();
}

export class SyndicateService {
  constructor(
    private readonly redis: Redis,
    private readonly repo = new SyndicateRepository(),
    private readonly onboarding = new OnboardingService(redis),
  ) {}

  async list(
    userId: string,
    raw: unknown,
  ): Promise<{ syndicates: SyndicateSummary[] }> {
    await this.onboarding.ensureOnboarded(userId);
    const q = (raw ?? {}) as ListSyndicatesQuery;
    const includePrivate = q.includePrivate === true;
    const ids = await this.repo.listIds(this.redis, includePrivate);

    const out: SyndicateSummary[] = [];
    for (const id of ids) {
      const meta = await this.repo.getMeta(this.redis, id);
      if (!meta.id) continue;
      if (!includePrivate && meta.visibility !== "public") continue;

      const members = await this.redis.scard(syndicateMembersKey(id));
      const shield = await this.repo.shieldExpiresAtMs(this.redis, id);
      const idolLevel = await this.repo.idolLevel(this.redis, id);
      out.push({
        id,
        name: meta.name ?? "",
        description: meta.description ?? "",
        visibility: (meta.visibility as "public" | "private") ?? "public",
        levelPreferenceMin: toInt(meta.levelPreferenceMin, 1),
        goldPreferenceMin: toInt(meta.goldPreferenceMin, 0),
        members: Number.isFinite(members) ? members : 0,
        shieldExpiresAtMs: shield,
        idolLevel,
        emblemId: meta.emblemId ?? "emblem:default",
      });
    }

    return { syndicates: out };
  }

  async view(userId: string, raw: unknown): Promise<SyndicateView> {
    await this.onboarding.ensureOnboarded(userId);
    const syndicateId = (raw as { syndicateId?: unknown })?.syndicateId;
    if (typeof syndicateId !== "string" || !syndicateId) {
      throw new AppError("BAD_REQUEST", "syndicateId required");
    }

    const meta = await this.repo.getMeta(this.redis, syndicateId);
    if (!meta.id)
      throw new AppError("NO_SUCH_SYNDICATE", "Syndicate not found");

    const memberIds = await this.repo.getMemberIds(this.redis, syndicateId);
    const roles = await this.repo.getMemberRoles(
      this.redis,
      syndicateId,
      memberIds,
    );
    const seen = await this.repo.getMemberSeen(
      this.redis,
      syndicateId,
      memberIds,
    );
    const lvls = await this.repo.getMemberLevels(this.redis, memberIds);
    const membersList: SyndicateMember[] = memberIds.map((uid) => ({
      userId: uid,
      role: (roles[uid] as SyndicateMember["role"]) ?? "member",
      level: lvls[uid] ?? 1,
      lastSeenAtMs: seen[uid] ?? 0,
    }));

    const shield = await this.repo.shieldExpiresAtMs(this.redis, syndicateId);
    const idolLevel = await this.repo.idolLevel(this.redis, syndicateId);

    const isMember = memberIds.includes(userId);
    const role = roles[userId] ?? "member";
    let joinRequests: SyndicateView["joinRequests"] | undefined;
    if (isMember && (role === "owner" || role === "officer")) {
      const reqs = await this.repo.joinRequests(this.redis, syndicateId);
      joinRequests = reqs.map((u) => ({ userId: u, requestedAtMs: 0 }));
    }

    return {
      id: syndicateId,
      name: meta.name ?? "",
      description: meta.description ?? "",
      visibility: (meta.visibility as "public" | "private") ?? "public",
      levelPreferenceMin: toInt(meta.levelPreferenceMin, 1),
      goldPreferenceMin: toInt(meta.goldPreferenceMin, 0),
      members: membersList.length,
      shieldExpiresAtMs: shield,
      idolLevel,
      emblemId: meta.emblemId ?? "emblem:default",
      ownerId: meta.ownerId ?? "",
      createdAtMs: toInt(meta.createdAtMs, 0),
      joinRequests,
      membersList,
    };
  }

  async create(userId: string, raw: unknown): Promise<{ syndicateId: string }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = createSyndicateSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid create syndicate payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as CreateSyndicateCommand;

    try {
      const res = await redisSyndicateCreate(
        this.redis,
        {
          seqKey: syndicateSeqKey(),
          userSyndicateKey: userSyndicateIdKey(userId),
          userLevelKey: userLevelKey(userId),
          nameIndexKey: syndicateNameIndexKey(),
          indexAllKey: "ravolo:syndicate:index:all",
          indexPublicKey: "ravolo:syndicate:index:public",
          idempKey: `ravolo:${userId}:idemp:syndicate_create:${cmd.requestId}`,
        },
        {
          userId,
          minLevel: MIN_CREATE_LEVEL,
          name: cmd.name,
          description: cmd.description,
          visibility: cmd.visibility,
          levelPrefMin: cmd.levelPreferenceMin,
          goldPrefMin: cmd.goldPreferenceMin,
          nowMs: nowMs(),
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
          syndicateKeyPrefix: "ravolo:syndicate:",
          emblemId: cmd.emblemId,
        },
      );
      return { syndicateId: res.syndicateId };
    } catch (e) {
      throw this.mapLuaError(e);
    }
  }

  async requestJoin(userId: string, raw: unknown): Promise<{ ok: true }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = requestJoinSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid request join payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as RequestJoinCommand;

    try {
      await redisSyndicateRequestJoin(
        this.redis,
        {
          userSyndicateKey: userSyndicateIdKey(userId),
          metaKey: syndicateMetaKey(cmd.syndicateId),
          membersKey: syndicateMembersKey(cmd.syndicateId),
          rolesKey: syndicateMemberRolesKey(cmd.syndicateId),
          joinReqKey: syndicateJoinRequestsKey(cmd.syndicateId),
          idempKey: `ravolo:${userId}:idemp:syndicate_join_req:${cmd.requestId}`,
          userLevelKey: userLevelKey(userId),
          userWalletKey: walletKey(userId),
        },
        { userId, nowMs: nowMs(), idempTtlSec: IDEMPOTENCY_TTL_SEC, maxMembers: MAX_SYNDICATE_MEMBERS },
      );
    } catch (e) {
      throw this.mapLuaError(e);
    }

    return { ok: true };
  }

  async acceptJoin(userId: string, raw: unknown): Promise<{ ok: true }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = acceptJoinSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid accept join payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as AcceptJoinCommand;

    try {
      await redisSyndicateAcceptJoin(
        this.redis,
        {
          actorUserSyndicateKey: userSyndicateIdKey(userId),
          metaKey: syndicateMetaKey(cmd.syndicateId),
          joinReqKey: syndicateJoinRequestsKey(cmd.syndicateId),
          membersKey: syndicateMembersKey(cmd.syndicateId),
          rolesKey: syndicateMemberRolesKey(cmd.syndicateId),
          targetUserSyndicateKey: userSyndicateIdKey(cmd.userId),
          idempKey: `ravolo:${userId}:idemp:syndicate_accept:${cmd.requestId}`,
        },
        {
          actorUserId: userId,
          targetUserId: cmd.userId,
          nowMs: nowMs(),
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
          maxMembers: MAX_SYNDICATE_MEMBERS,
        },
      );
    } catch (e) {
      throw this.mapLuaError(e);
    }

    return { ok: true };
  }

  async deposit(userId: string, raw: unknown): Promise<{ ok: true }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = depositBankSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid deposit payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as DepositBankCommand;

    try {
      await redisSyndicateDeposit(
        this.redis,
        {
          userSyndicateKey: userSyndicateIdKey(userId),
          userWalletKey: walletKey(userId),
          userInvKey: inventoryKey(userId),
          bankGoldKey: syndicateBankGoldKey(cmd.syndicateId),
          bankItemsKey: syndicateBankItemsKey(cmd.syndicateId),
          contribGoldKey: syndicateContributionGoldKey(cmd.syndicateId),
          contribItemsKey: syndicateContributionItemsKey(cmd.syndicateId),
          idempKey: `ravolo:${userId}:idemp:syndicate_deposit:${cmd.requestId}`,
          holdingsKey: syndicateHoldingsKey(cmd.syndicateId),
        },
        {
          userId,
          syndicateId: cmd.syndicateId,
          kind: cmd.kind,
          itemId: cmd.kind === "item" ? cmd.itemId : "",
          amount: cmd.amount,
          nowMs: nowMs(),
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
        },
      );
    } catch (e) {
      throw this.mapLuaError(e);
    }

    return { ok: true };
  }

  async buyShield(
    userId: string,
    raw: unknown,
  ): Promise<{ shieldExpiresAtMs: number }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = buyShieldSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid buy shield payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as BuyShieldCommand;

    let res;
    try {
      res = await redisSyndicateBuyShield(
        this.redis,
        {
          userSyndicateKey: userSyndicateIdKey(userId),
          bankGoldKey: syndicateBankGoldKey(cmd.syndicateId),
          shieldKey: syndicateShieldExpiresAtKey(cmd.syndicateId),
          idempKey: `ravolo:${userId}:idemp:syndicate_shield:${cmd.requestId}`,
        },
        {
          userId,
          syndicateId: cmd.syndicateId,
          goldPaid: cmd.goldPaid,
          nowMs: nowMs(),
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
        },
      );
    } catch (e) {
      throw this.mapLuaError(e);
    }

    return { shieldExpiresAtMs: res.shieldExpiresAtMs };
  }

  async attack(
    userId: string,
    raw: unknown,
  ): Promise<{
    ok: true;
    lootGold: number;
    lootItemId?: string;
    lootItemQty?: number;
  }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = attackSyndicateSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid attack payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as AttackSyndicateCommand;

    const attackerSid = await this.redis.get(userSyndicateIdKey(userId));
    if (!attackerSid)
      throw new AppError("NOT_IN_SYNDICATE", "Not in a syndicate");

    let res;
    try {
      res = await redisSyndicateAttack(
        this.redis,
        {
          attackerUserSyndicateKey: userSyndicateIdKey(userId),
          attackerBankGoldKey: syndicateBankGoldKey(attackerSid),
          attackerBankItemsKey: syndicateBankItemsKey(attackerSid),
          targetMetaKey: syndicateMetaKey(cmd.targetSyndicateId),
          targetBankGoldKey: syndicateBankGoldKey(cmd.targetSyndicateId),
          targetBankItemsKey: syndicateBankItemsKey(cmd.targetSyndicateId),
          targetShieldKey: syndicateShieldExpiresAtKey(cmd.targetSyndicateId),
          attackerCooldownKey: userAttackCooldownKey(userId),
          idempKey: `ravolo:${userId}:idemp:syndicate_attack:${cmd.requestId}`,
        },
        {
          userId,
          attackerSyndicateId: attackerSid,
          targetSyndicateId: cmd.targetSyndicateId,
          attackPower: cmd.attackPower,
          lootGoldMax: cmd.lootGoldMax,
          lootItemId: cmd.lootItemId ?? "",
          lootItemMax: cmd.lootItemMax ?? 0,
          nowMs: nowMs(),
          cooldownMs: 60_000,
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
        },
      );
    } catch (e) {
      throw this.mapLuaError(e);
    }

    return {
      ok: true,
      lootGold: res.lootGold,
      lootItemId: res.lootItemId || undefined,
      lootItemQty: res.lootItemQty || undefined,
    };
  }

  async idolContribute(
    userId: string,
    raw: unknown,
  ): Promise<{ ok: true; fulfilled: boolean }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = idolContributeSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid idol contribute payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as IdolContributeCommand;

    let res;
    try {
      res = await redisSyndicateIdolContribute(
        this.redis,
        {
          userSyndicateKey: userSyndicateIdKey(userId),
          bankItemsKey: syndicateBankItemsKey(cmd.syndicateId),
          idolReqKey: syndicateIdolRequestKey(cmd.syndicateId, cmd.requestKey),
          idolKey: syndicateIdolKey(cmd.syndicateId),
          idempKey: `ravolo:${userId}:idemp:syndicate_idol:${cmd.requestId}`,
        },
        {
          userId,
          syndicateId: cmd.syndicateId,
          requestKey: cmd.requestKey,
          itemId: cmd.itemId,
          amount: cmd.amount,
          nowMs: nowMs(),
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
        },
      );
    } catch (e) {
      throw this.mapLuaError(e);
    }

    return { ok: true, fulfilled: res.fulfilled };
  }

  async leave(userId: string, raw: unknown): Promise<{ ok: true }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = leaveSyndicateSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid leave payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as LeaveSyndicateCommand;

    try {
      await redisSyndicateLeaveOrDisband(
        this.redis,
        {
          userSyndicateKey: userSyndicateIdKey(userId),
          indexAllKey: "ravolo:syndicate:index:all",
          indexPublicKey: "ravolo:syndicate:index:public",
          nameIndexKey: syndicateNameIndexKey(),
          idempKey: `ravolo:${userId}:idemp:syndicate_leave:${cmd.requestId}`,
        },
        {
          userId,
          syndicateId: "",
          mode: "leave",
          nowMs: nowMs(),
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
        },
      );
    } catch (e) {
      throw this.mapLuaError(e);
    }
    return { ok: true };
  }

  async disband(userId: string, raw: unknown): Promise<{ ok: true }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = disbandSyndicateSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid disband payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as DisbandSyndicateCommand;

    try {
      await redisSyndicateLeaveOrDisband(
        this.redis,
        {
          userSyndicateKey: userSyndicateIdKey(userId),
          indexAllKey: "ravolo:syndicate:index:all",
          indexPublicKey: "ravolo:syndicate:index:public",
          nameIndexKey: syndicateNameIndexKey(),
          idempKey: `ravolo:${userId}:idemp:syndicate_disband:${cmd.requestId}`,
        },
        {
          userId,
          syndicateId: cmd.syndicateId,
          mode: "disband",
          nowMs: nowMs(),
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
        },
      );
    } catch (e) {
      throw this.mapLuaError(e);
    }
    return { ok: true };
  }

  private mapLuaError(e: unknown): AppError {
    if (typeof e === "object" && e !== null && "message" in e) {
      const msg = String((e as { message: string }).message);
      if (msg.includes("ERR_ALREADY_IN_SYNDICATE"))
        return new AppError("ALREADY_IN_SYNDICATE", "Already in a syndicate");
      if (msg.includes("ERR_LEVEL_TOO_LOW"))
        return new AppError("LEVEL_TOO_LOW", "Level too low", {
          minLevel: MIN_CREATE_LEVEL,
        });
      if (msg.includes("ERR_NAME_TAKEN"))
        return new AppError("NAME_TAKEN", "Syndicate name already taken");
      if (msg.includes("ERR_NO_SUCH_SYNDICATE"))
        return new AppError("NO_SUCH_SYNDICATE", "Syndicate not found");
      if (msg.includes("ERR_NOT_MEMBER"))
        return new AppError("NOT_MEMBER", "Not a syndicate member");
      if (msg.includes("ERR_NOT_AUTHORIZED"))
        return new AppError("NOT_AUTHORIZED", "Not authorized");
      if (msg.includes("ERR_JOIN_REQUEST_MISSING"))
        return new AppError("JOIN_REQUEST_MISSING", "Join request missing");
      if (msg.includes("ERR_TARGET_ALREADY_IN_SYNDICATE"))
        return new AppError(
          "TARGET_ALREADY_IN_SYNDICATE",
          "Target already in a syndicate",
        );
      if (msg.includes("ERR_ATTACK_COOLDOWN"))
        return new AppError("ATTACK_COOLDOWN", "Attack cooldown active");
      if (msg.includes("ERR_OWNER_CANNOT_LEAVE"))
        return new AppError(
          "OWNER_CANNOT_LEAVE",
          "Owner cannot leave; disband instead",
        );
      if (msg.includes("ERR_TOO_MANY_MEMBERS"))
        return new AppError(
          "TOO_MANY_MEMBERS",
          "Too many members to disband safely",
        );
      if (msg.includes("ERR_NO_IDOL_REQUEST"))
        return new AppError("NO_IDOL_REQUEST", "No active idol request");
      if (msg.includes("ERR_INSUFFICIENT_GOLD"))
        return new AppError("INSUFFICIENT_GOLD", "Insufficient gold");
      if (msg.includes("ERR_INSUFFICIENT_INV"))
        return new AppError("INSUFFICIENT_INV", "Insufficient inventory");
      if (msg.includes("ERR_BAD_ARGS"))
        return new AppError("BAD_REQUEST", "Invalid request");
    }
    logger.error({ err: e }, "unmapped syndicate lua error");
    return new AppError("INTERNAL", "Internal error");
  }

  async ensureOnboarded(userId: string): Promise<void> {
    return this.onboarding.ensureOnboarded(userId);
  }

  async getUserSyndicateId(userId: string): Promise<string | null> {
    return this.redis.get(userSyndicateIdKey(userId));
  }

  async viewMembers(
    userId: string,
    raw: unknown,
  ): Promise<{ members: SyndicateMember[] }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = viewSyndicateMemberSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid view members payload");
    const { syndicateId } = parsed.data as ViewSyndicateMemberQuery;

    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (!sid || sid !== syndicateId)
      throw new AppError("NOT_MEMBER" as never, "Not a member");

    const memberIds = await this.repo.getMemberIds(this.redis, syndicateId);
    const roles = await this.repo.getMemberRoles(this.redis, syndicateId, memberIds);
    const seen = await this.repo.getMemberSeen(this.redis, syndicateId, memberIds);
    const lvls = await this.repo.getMemberLevels(this.redis, memberIds);
    const members: SyndicateMember[] = memberIds.map((uid) => ({
      userId: uid,
      role: (roles[uid] as SyndicateMember["role"]) ?? "member",
      level: lvls[uid] ?? 1,
      lastSeenAtMs: seen[uid] ?? 0,
    }));
    return { members };
  }

  async viewGoldBank(
    userId: string,
    raw: unknown,
  ): Promise<{ gold: number }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = viewBankSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid view bank payload");
    const { syndicateId } = parsed.data as ViewBankQuery;

    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (!sid || sid !== syndicateId)
      throw new AppError("NOT_MEMBER" as never, "Not a member");

    const gold = await this.repo.bankGold(this.redis, syndicateId);
    return { gold };
  }

  async viewCommodityBank(
    userId: string,
    raw: unknown,
  ): Promise<{ commodities: Record<string, number> }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = viewBankSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid view bank payload");
    const { syndicateId } = parsed.data as ViewBankQuery;

    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (!sid || sid !== syndicateId)
      throw new AppError("NOT_MEMBER" as never, "Not a member");

    const commodities = await this.repo.bankItems(this.redis, syndicateId);
    return { commodities };
  }

  async viewMemberContribution(
    userId: string,
    raw: unknown,
  ): Promise<{ gold: number; items: Record<string, number> }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = viewContributionSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid view contribution payload");
    const { syndicateId, userId: targetUserId } =
      parsed.data as ViewContributionQuery;

    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (!sid || sid !== syndicateId)
      throw new AppError("NOT_MEMBER" as never, "Not a member");

    const gold = await this.repo.memberContributionGold(
      this.redis,
      syndicateId,
      targetUserId,
    );
    const items = await this.repo.memberContributionItems(
      this.redis,
      syndicateId,
      targetUserId,
    );
    return { gold, items };
  }

  async chatSend(userId: string, raw: unknown): Promise<{ ok: true }> {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = syndicateChatSendSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("BAD_REQUEST", "Invalid chat payload", {
        issues: parsed.error.issues,
      });
    const cmd = parsed.data as SyndicateChatSendCommand;

    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (!sid || sid !== cmd.syndicateId) {
      throw new AppError(
        "NOT_MEMBER" as never,
        "Not a member of this syndicate",
      );
    }

    const line = JSON.stringify({ ts: nowMs(), userId, text: cmd.text });
    const k = syndicateChatKey(cmd.syndicateId);
    await this.redis.multi().rpush(k, line).ltrim(k, -CHAT_MAX, -1).exec();
    return { ok: true };
  }

  async chatList(
    userId: string,
    raw: unknown,
  ): Promise<{ messages: unknown[] }> {
    await this.onboarding.ensureOnboarded(userId);
    const syndicateId = (raw as { syndicateId?: unknown })?.syndicateId;
    if (typeof syndicateId !== "string" || !syndicateId)
      throw new AppError("BAD_REQUEST", "syndicateId required");

    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (!sid || sid !== syndicateId)
      throw new AppError("NOT_MEMBER" as never, "Not a member");

    const rows = await this.repo.chatRecent(this.redis, syndicateId, 50);
    const msgs = rows
      .map((x) => {
        try {
          return JSON.parse(x) as unknown;
        } catch {
          return null;
        }
      })
      .filter((x) => x !== null);
    return { messages: msgs };
  }

  async touchPresence(userId: string): Promise<void> {
    const ms = nowMs();
    await this.redis.set(userLastSeenKey(userId), String(ms), "EX", 3600);
    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (sid) {
      await this.redis.hset(syndicateMemberSeenKey(sid), userId, String(ms));
    }
  }
}
