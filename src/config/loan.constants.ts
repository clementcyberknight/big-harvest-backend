/**
 * Collateral must cover ≥150% of principal (50% over-collateralization).
 * Check: principal * LTV_NUMERATOR <= collateralValueGold * LTV_DENOMINATOR
 * with NUM=10, DEN=15 → principal <= collateral * (10/15) = 2/3 collateral.
 */
export const LOAN_LTV_NUMERATOR = 10;
export const LOAN_LTV_DENOMINATOR = 15;

/** Flat interest for the loan term (basis points on principal). */
export const LOAN_TERM_APR_BPS = 500;

/** Loan term length (ms) for interest accrual. */
export const LOAN_TERM_MS = 7 * 24 * 60 * 60 * 1000;

/** Extra penalty after due (basis points per started day on amount due). */
export const LOAN_PENALTY_BPS_PER_DAY = 100;

/** Grace after due before penalty clock (ms). */
export const LOAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** Gold credited per plot pledged as land collateral. */
export const LOAN_PLOT_COLLATERAL_GOLD = 200;
