/** Authoritative server time in milliseconds (never use client clocks for gameplay). */
export function serverNowMs(): number {
  return Date.now();
}
