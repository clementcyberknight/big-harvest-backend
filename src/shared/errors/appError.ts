export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "UNKNOWN_CROP"
  | "UNKNOWN_ITEM"
  | "PLOT_NOT_OWNED"
  | "PLOT_OCCUPIED"
  | "INSUFFICIENT_SEEDS"
  | "INSUFFICIENT_INV"
  | "INSUFFICIENT_GOLD"
  | "EMPTY_PLOT"
  | "NOT_READY"
  | "INVALID_OUTPUT"
  | "RATE_LIMITED"
  | "TREASURY_DEPLETED"
  | "ITEM_LOCKED"
  | "LTV_REJECT"
  | "LOAN_ACTIVE"
  | "LOAN_MISMATCH"
  | "LOAN_NOT_ACTIVE"
  | "NO_ANIMALS"
  | "NOT_FED"
  | "INSUFFICIENT_FEED"
  | "MISSING_TOOL"
  | "NO_CRAFT"
  | "UNKNOWN_RECIPE"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpSafeMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpSafeMessage = message;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.httpSafeMessage, details: this.details };
  }
}
