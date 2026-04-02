import type { HttpResponse } from "uWebSockets.js";
import { env } from "../../config/env.js";

/**
 * Parsed set of allowed origins from ALLOWED_ORIGINS env var.
 * Evaluated once at module load so there's no per-request parsing overhead.
 */
const allowedOrigins: Set<string> = new Set(
  env.ALLOWED_ORIGINS
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
);

/**
 * Write CORS headers. Only reflects the request Origin back if it appears in
 * the ALLOWED_ORIGINS whitelist — never sends a wildcard on authenticated routes.
 */
export function applyCors(res: HttpResponse, origin?: string): void {
  if (origin && allowedOrigins.has(origin)) {
    res.writeHeader("Access-Control-Allow-Origin", origin);
    res.writeHeader("Vary", "Origin");
  }
  // Always advertise allowed headers/methods so preflight works even when the
  // origin is not in the whitelist (the browser will still block the request).
  res.writeHeader(
    "Access-Control-Allow-Headers",
    "content-type, authorization",
  );
  res.writeHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
}

/**
 * Write security headers that should appear on every response.
 */
export function applySecurityHeaders(res: HttpResponse): void {
  res.writeHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.writeHeader("X-Content-Type-Options", "nosniff");
  res.writeHeader("X-Frame-Options", "DENY");
  res.writeHeader("X-XSS-Protection", "1; mode=block");
}

export function readRequestBody(
  res: HttpResponse,
  maxBytes = 65536,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    res.onAborted(() => finish(null));

    const chunks: Buffer[] = [];
    let total = 0;

    res.onData((arrayBuffer, isLast) => {
      const chunk = Buffer.from(arrayBuffer);
      total += chunk.length;
      if (total > maxBytes) {
        res.cork(() => {
          res.writeStatus("413 Payload Too Large");
          applyCors(res);
          applySecurityHeaders(res);
          res.end();
        });
        finish(null);
        return;
      }
      chunks.push(chunk);
      if (isLast) {
        finish(Buffer.concat(chunks).toString("utf8"));
      }
    });
  });
}

export function sendJson(
  res: HttpResponse,
  status: string,
  body: unknown,
  origin?: string,
): void {
  const payload = JSON.stringify(body);
  res.cork(() => {
    res.writeStatus(status);
    applyCors(res, origin);
    applySecurityHeaders(res);
    res.writeHeader("Content-Type", "application/json; charset=utf-8");
    res.end(payload);
  });
}

export function sendText(
  res: HttpResponse,
  status: string,
  text: string,
  origin?: string,
): void {
  res.cork(() => {
    res.writeStatus(status);
    applyCors(res, origin);
    applySecurityHeaders(res);
    res.writeHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(text);
  });
}
