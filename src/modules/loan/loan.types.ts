import type { RepaymentBreakdown } from "./loan.interest.js";

export type CollateralInventoryEntry = { item: string; quantity: number };

export type LoanOpenCommand = {
  principal: number;
  collateralInventory: CollateralInventoryEntry[];
  collateralPlotIds: number[];
  requestId: string;
};

export type LoanRepayCommand = {
  loanId: string;
  requestId: string;
};

export type LoanOpenResult = {
  loanId: string;
  principal: number;
  collateralValueGold: number;
  borrowedAtMs: number;
  dueAtMs: number;
};

export type LoanRepayResult = {
  loanId: string;
  totalPaid: number;
  breakdown: RepaymentBreakdown;
};
