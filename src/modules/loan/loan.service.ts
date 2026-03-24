import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { IDEMPOTENCY_TTL_SEC } from "../../config/constants.js";
import {
  LOAN_LTV_DENOMINATOR,
  LOAN_LTV_NUMERATOR,
  LOAN_PLOT_COLLATERAL_GOLD,
  LOAN_TERM_MS,
} from "../../config/loan.constants.js";
import {
  inventoryKey,
  inventoryLockedKey,
  loanActiveKey,
  loanOpenIdempotencyKey,
  loanRecordKey,
  loanRepayIdempotencyKey,
  ownedPlotsKey,
  plotsLockedKey,
  treasuryReserveKey,
  walletKey,
} from "../../infrastructure/redis/keys.js";
import { redisLoanOriginate, redisLoanRepay } from "../../infrastructure/redis/commands.js";
import {
  hasReferencePrice,
  unitCollateralGold,
} from "../economy/referencePrices.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import { AppError } from "../../shared/errors/appError.js";
import { serverNowMs } from "../../shared/utils/time.js";
import { computeRepayment } from "./loan.interest.js";
import type { LoanOpenResult, LoanRepayResult } from "./loan.types.js";
import { loanOpenSchema, loanRepaySchema } from "./loan.validator.js";

function isReplyError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

function buildInvSpec(entries: { item: string; quantity: number }[]): string {
  if (entries.length === 0) return "";
  return entries.map((e) => `${e.item}:${e.quantity}`).join("|");
}

function buildPlotCsv(ids: number[]): string {
  if (ids.length === 0) return "";
  return ids.map(String).join(",");
}

export class LoanService {
  constructor(
    private readonly redis: Redis,
    private readonly onboarding = new OnboardingService(redis),
  ) {}

  private valueCollateral(
    inv: { item: string; quantity: number }[],
    plotIds: number[],
  ): number {
    let v = 0;
    for (const x of inv) {
      v += unitCollateralGold(x.item) * x.quantity;
    }
    v += plotIds.length * LOAN_PLOT_COLLATERAL_GOLD;
    return v;
  }

  async open(userId: string, raw: unknown): Promise<LoanOpenResult> {
    await this.onboarding.ensureOnboarded(userId);

    const parsed = loanOpenSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid loan open payload", {
        issues: parsed.error.issues,
      });
    }
    const { principal, collateralInventory, collateralPlotIds, requestId } =
      parsed.data;

    if (collateralInventory.length === 0 && collateralPlotIds.length === 0) {
      throw new AppError("BAD_REQUEST", "Collateral required (inventory and/or plots)");
    }

    for (const row of collateralInventory) {
      if (!hasReferencePrice(row.item)) {
        throw new AppError("UNKNOWN_ITEM", "Unknown collateral item", { item: row.item });
      }
    }

    const collateralValueGold = this.valueCollateral(
      collateralInventory,
      collateralPlotIds,
    );
    if (collateralValueGold < 1) {
      throw new AppError("BAD_REQUEST", "Collateral value too low");
    }

    const maxPrincipal = Math.floor(
      (collateralValueGold * LOAN_LTV_NUMERATOR) / LOAN_LTV_DENOMINATOR,
    );
    if (principal > maxPrincipal) {
      throw new AppError("LTV_REJECT", "Principal exceeds allowed LTV for this collateral", {
        principal,
        maxPrincipal,
        collateralValueGold,
      });
    }

    const now = serverNowMs();
    const dueAtMs = now + LOAN_TERM_MS;
    const loanId = randomUUID();
    const invSpec = buildInvSpec(collateralInventory);
    const plotCsv = buildPlotCsv(collateralPlotIds);

    const keys = {
      invKey: inventoryKey(userId),
      invLockedKey: inventoryLockedKey(userId),
      walletKey: walletKey(userId),
      reserveKey: treasuryReserveKey(),
      loanRecordKey: loanRecordKey(userId, loanId),
      idempKey: loanOpenIdempotencyKey(userId, requestId),
      loanActiveKey: loanActiveKey(userId),
      plotsKey: ownedPlotsKey(userId),
      plotsLockedKey: plotsLockedKey(userId),
    };

    try {
      await redisLoanOriginate(this.redis, keys, {
        loanId,
        principal,
        collateralValueGold,
        collateralInvSpec: invSpec,
        collateralPlotCsv: plotCsv,
        idempTtlSec: IDEMPOTENCY_TTL_SEC,
        userId,
        tsMs: now,
        borrowedAtMs: now,
        dueAtMs,
      });
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_LOAN_ACTIVE")) {
        throw new AppError("LOAN_ACTIVE", "An active loan must be repaid first");
      }
      if (isReplyError(e) && e.message.includes("ERR_LTV")) {
        throw new AppError("LTV_REJECT", "LTV check failed");
      }
      if (isReplyError(e) && e.message.includes("ERR_TREASURY_DEPLETED")) {
        throw new AppError("TREASURY_DEPLETED", "Treasury cannot fund this loan");
      }
      if (isReplyError(e) && e.message.includes("ERR_INSUFFICIENT_INV")) {
        throw new AppError("INSUFFICIENT_INV", "Insufficient free inventory for collateral");
      }
      if (isReplyError(e) && e.message.includes("ERR_PLOT_NOT_OWNED")) {
        throw new AppError("PLOT_NOT_OWNED", "Plot not available to pledge");
      }
      if (isReplyError(e) && e.message.includes("ERR_BAD_SPEC")) {
        throw new AppError("BAD_REQUEST", "Invalid collateral specification");
      }
      throw e;
    }

    return {
      loanId,
      principal,
      collateralValueGold,
      borrowedAtMs: now,
      dueAtMs,
    };
  }

  async repay(userId: string, raw: unknown): Promise<LoanRepayResult> {
    await this.onboarding.ensureOnboarded(userId);

    const parsed = loanRepaySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid loan repay payload", {
        issues: parsed.error.issues,
      });
    }
    const { loanId, requestId } = parsed.data;

    const active = await this.redis.get(loanActiveKey(userId));
    if (active !== loanId) {
      throw new AppError("LOAN_MISMATCH", "Loan is not active for this player");
    }

    const h = await this.redis.hgetall(loanRecordKey(userId, loanId));
    const principal = Number(h.principal ?? 0);
    const borrowedAtMs = Number(h.borrowedAtMs ?? 0);
    const dueAtMs = Number(h.dueAtMs ?? 0);
    if (!Number.isFinite(principal) || principal < 1) {
      throw new AppError("LOAN_NOT_ACTIVE", "Loan record missing or invalid");
    }

    const now = serverNowMs();
    const breakdown = computeRepayment(principal, borrowedAtMs, dueAtMs, now);

    const keys = {
      invKey: inventoryKey(userId),
      invLockedKey: inventoryLockedKey(userId),
      walletKey: walletKey(userId),
      reserveKey: treasuryReserveKey(),
      loanRecordKey: loanRecordKey(userId, loanId),
      idempKey: loanRepayIdempotencyKey(userId, requestId),
      loanActiveKey: loanActiveKey(userId),
      plotsKey: ownedPlotsKey(userId),
      plotsLockedKey: plotsLockedKey(userId),
    };

    try {
      const res = await redisLoanRepay(this.redis, keys, {
        loanId,
        totalDueGold: breakdown.total,
        idempTtlSec: IDEMPOTENCY_TTL_SEC,
        userId,
        tsMs: now,
      });
      return {
        loanId: res.loanId,
        totalPaid: res.totalPaid,
        breakdown,
      };
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_LOAN_MISMATCH")) {
        throw new AppError("LOAN_MISMATCH", "Active loan id mismatch");
      }
      if (isReplyError(e) && e.message.includes("ERR_LOAN_NOT_ACTIVE")) {
        throw new AppError("LOAN_NOT_ACTIVE", "Loan already closed");
      }
      if (isReplyError(e) && e.message.includes("ERR_INSUFFICIENT_GOLD")) {
        throw new AppError("INSUFFICIENT_GOLD", "Not enough gold to repay", {
          need: breakdown.total,
        });
      }
      if (isReplyError(e) && e.message.includes("ERR_LOCKED_MISMATCH")) {
        throw new AppError("INTERNAL", "Collateral lock state inconsistent");
      }
      throw e;
    }
  }
}
