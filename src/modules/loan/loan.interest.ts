import {
  LOAN_GRACE_MS,
  LOAN_PENALTY_BPS_PER_DAY,
  LOAN_TERM_APR_BPS,
  LOAN_TERM_MS,
} from "../../config/loan.constants.js";

const MS_PER_DAY = 86_400_000;

export type RepaymentBreakdown = {
  principal: number;
  interest: number;
  penalty: number;
  total: number;
};

export function computeRepayment(
  principal: number,
  borrowedAtMs: number,
  dueAtMs: number,
  nowMs: number,
): RepaymentBreakdown {
  const elapsed = Math.max(0, nowMs - borrowedAtMs);
  const accrueMs = Math.min(elapsed, LOAN_TERM_MS);
  const interest = Math.floor(
    (principal * LOAN_TERM_APR_BPS * accrueMs) / LOAN_TERM_MS / 10_000,
  );

  let penalty = 0;
  const lateStart = dueAtMs + LOAN_GRACE_MS;
  if (nowMs > lateStart) {
    const lateMs = nowMs - lateStart;
    const days = Math.ceil(lateMs / MS_PER_DAY);
    const base = principal + interest;
    penalty = Math.floor((base * LOAN_PENALTY_BPS_PER_DAY * days) / 10_000);
  }

  const total = principal + interest + penalty;
  return { principal, interest, penalty, total };
}
