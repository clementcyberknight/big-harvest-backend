import type { HttpRequest, HttpResponse, TemplatedApp } from "uWebSockets.js";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthService } from "../../modules/auth/auth.service.js";
import type { ProfileService } from "../../modules/profile/profile.service.js";
import type { UserActionService } from "../../modules/user-actions/userAction.service.js";
import { usernameUpdateSchema } from "../../modules/profile/username.validator.js";
import {
  accessTokenExpUnix,
  verifyAccessToken,
} from "../../modules/auth/jwt.js";
import {
  applyCors,
  applySecurityHeaders,
  readRequestBody,
  sendJson,
  sendText,
} from "./http.util.js";
import { logger } from "../../infrastructure/logger/logger.js";

/**
 * IP-based rate limiter for auth endpoints.
 * Defaults: 5 requests per 60 seconds per IP.
 * Configurable via AUTH_RATE_LIMIT_POINTS / AUTH_RATE_LIMIT_DURATION_SEC.
 */
const authRateLimiter = new RateLimiterMemory({
  points: env.AUTH_RATE_LIMIT_POINTS,
  duration: env.AUTH_RATE_LIMIT_DURATION_SEC,
});

/**
 * Extract the best-effort client IP from the request.
 * Trusts x-forwarded-for when present (Railway / reverse-proxy environments).
 */
function getClientIp(req: HttpRequest): string {
  const forwarded = req.getHeader("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for may be a comma-separated list; take the first entry.
    return forwarded.split(",")[0]!.trim();
  }
  // uWebSockets does not expose the raw socket IP via HttpRequest; fall back to
  // a sentinel so the limiter still works (all unknown IPs share one bucket).
  return "unknown";
}

export type AuthHttpDeps = {
  auth: AuthService;
  profile: ProfileService;
  userActions: UserActionService;
};

function httpStatusForAppError(code: string): string {
  switch (code) {
    case "INVALID_SIGNATURE":
    case "INVALID_REFRESH_TOKEN":
    case "EXPIRED_REFRESH_TOKEN":
    case "REVOKED_REFRESH_TOKEN":
    case "TOKEN_REUSE_DETECTED":
      return "401 Unauthorized";
    case "CHALLENGE_EXPIRED":
      return "400 Bad Request";
    case "USERNAME_TAKEN":
      return "409 Conflict";
    case "USERNAME_COLLISION":
      return "503 Service Unavailable";
    case "DATABASE":
      return "503 Service Unavailable";
    case "BAD_REQUEST":
      return "400 Bad Request";
    default:
      return "400 Bad Request";
  }
}

function parseBearer(req: HttpRequest): string | null {
  const raw = req.getHeader("authorization");
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m?.[1] ?? null;
}

export function registerAuthHttp(app: TemplatedApp, deps: AuthHttpDeps): void {
  // OPTIONS preflight — must read origin synchronously before any async work.
  app.options("/*", (res, req) => {
    const origin = req.getHeader("origin");
    res.onAborted(() => {});
    res.cork(() => {
      res.writeStatus("204 No Content");
      // applyCors handles origin whitelisting; applySecurityHeaders adds HSTS etc.
      applyCors(res, origin || undefined);
      applySecurityHeaders(res);
      res.end();
    });
  });

  app.get("/auth/challenge", (res, req) => {
    // Read synchronous values before any async work (uWS requirement).
    const origin = req.getHeader("origin");
    const ip = getClientIp(req);
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
      logger.warn("GET /auth/challenge aborted by client");
    });
    (async (): Promise<void> => {
      try {
        await authRateLimiter.consume(ip);
      } catch {
        if (aborted) return;
        sendJson(res, "429 Too Many Requests", {
          error: "RATE_LIMITED",
          message: "Too many requests; please slow down",
        }, origin || undefined);
        return;
      }
      try {
        const challenge = await deps.auth.createChallenge();
        if (aborted) return;
        sendJson(res, "200 OK", challenge, origin || undefined);
      } catch (e) {
        if (aborted) return;
        logger.error({ err: e }, "GET /auth/challenge failed");
        sendJson(res, "500 Internal Server Error", { error: "Internal error" }, origin || undefined);
      }
    })().catch((e) => {
      logger.error({ err: e }, "GET /auth/challenge unhandled rejection");
      if (!aborted) {
        try {
          sendJson(res, "500 Internal Server Error", { error: "Internal error" }, origin || undefined);
        } catch {}
      }
    });
  });

  app.post("/auth/verify", (res, req) => {
    const origin = req.getHeader("origin");
    const ip = getClientIp(req);
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
      logger.warn("POST /auth/verify aborted by client");
    });
    (async (): Promise<void> => {
      try {
        await authRateLimiter.consume(ip);
      } catch {
        if (aborted) return;
        sendJson(res, "429 Too Many Requests", {
          error: "RATE_LIMITED",
          message: "Too many requests; please slow down",
        }, origin || undefined);
        return;
      }

      const raw = await readRequestBody(res);
      if (raw === null || aborted) return;

      let body: {
        wallet?: string;
        signature?: string;
        challengeId?: string;
      };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        sendJson(res, "400 Bad Request", { error: "Invalid JSON" }, origin || undefined);
        return;
      }

      const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
      const signature =
        typeof body.signature === "string" ? body.signature.trim() : "";
      const challengeId =
        typeof body.challengeId === "string" ? body.challengeId.trim() : "";

      if (!wallet || !signature || !challengeId) {
        sendJson(res, "400 Bad Request", {
          error: "wallet, signature, and challengeId are required",
        }, origin || undefined);
        return;
      }

      try {
        const result = await deps.auth.verifyChallengeAndUpsertProfile(
          wallet,
          signature,
          challengeId,
        );
        void deps.userActions.log(result.profile.id, "AUTH_SOLANA_VERIFY", {
          isNewUser: result.isNewUser,
        });
        const accessExp = accessTokenExpUnix(result.accessToken);
        sendJson(res, "200 OK", {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
          accessExpiresAt: accessExp,
          refreshExpiresInSec: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
          profile: {
            id: result.profile.id,
            walletAddress: result.profile.walletAddress,
            username: result.profile.username,
            createdAt: result.profile.createdAt,
            achievements: result.profile.achievements,
          },
          isNewUser: result.isNewUser,
        }, origin || undefined);
      } catch (e) {
        if (aborted) return;
        if (e instanceof AppError) {
          sendJson(res, httpStatusForAppError(e.code), {
            error: e.code,
            message: e.httpSafeMessage,
          }, origin || undefined);
          return;
        }
        logger.error({ err: e }, "POST /auth/verify failed");
        sendJson(res, "500 Internal Server Error", { error: "Internal error" }, origin || undefined);
      }
    })().catch((e) => {
      logger.error({ err: e }, "POST /auth/verify unhandled rejection");
      if (!aborted) {
        try {
          sendJson(res, "500 Internal Server Error", { error: "Internal error" }, origin || undefined);
        } catch {}
      }
    });
  });

  app.post("/auth/refresh", (res, req) => {
    const origin = req.getHeader("origin");
    const ip = getClientIp(req);
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
      logger.warn("POST /auth/refresh aborted by client");
    });
    (async (): Promise<void> => {
      try {
        await authRateLimiter.consume(ip);
      } catch {
        if (aborted) return;
        sendJson(res, "429 Too Many Requests", {
          error: "RATE_LIMITED",
          message: "Too many requests; please slow down",
        }, origin || undefined);
        return;
      }

      const raw = await readRequestBody(res);
      if (raw === null || aborted) return;

      let body: { refreshToken?: string };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        sendJson(res, "400 Bad Request", { error: "Invalid JSON" }, origin || undefined);
        return;
      }

      const rt =
        typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
      if (!rt) {
        sendJson(res, "400 Bad Request", {
          error: "refreshToken is required",
        }, origin || undefined);
        return;
      }

      try {
        const session = await deps.auth.refreshSession(rt);
        void deps.userActions.log(session.profile.id, "AUTH_REFRESH", {});
        const accessExp = accessTokenExpUnix(session.accessToken);
        sendJson(res, "200 OK", {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
          accessExpiresAt: accessExp,
          refreshExpiresInSec: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
          profile: {
            id: session.profile.id,
            walletAddress: session.profile.walletAddress,
            username: session.profile.username,
            createdAt: session.profile.createdAt,
            achievements: session.profile.achievements,
          },
        }, origin || undefined);
      } catch (e) {
        if (aborted) return;
        if (e instanceof AppError) {
          sendJson(res, httpStatusForAppError(e.code), {
            error: e.code,
            message: e.httpSafeMessage,
          }, origin || undefined);
          return;
        }
        logger.error({ err: e }, "POST /auth/refresh failed");
        sendJson(res, "500 Internal Server Error", { error: "Internal error" }, origin || undefined);
      }
    })().catch((e) => {
      logger.error({ err: e }, "POST /auth/refresh unhandled rejection");
      if (!aborted) {
        try {
          sendJson(res, "500 Internal Server Error", { error: "Internal error" }, origin || undefined);
        } catch {}
      }
    });
  });

  app.post("/auth/logout", (res, req) => {
    const origin = req.getHeader("origin");
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    (async (): Promise<void> => {
      const raw = await readRequestBody(res);
      if (raw === null || aborted) return;

      let body: { refreshToken?: string };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        sendJson(res, "400 Bad Request", { error: "Invalid JSON" }, origin || undefined);
        return;
      }

      const rt =
        typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
      if (rt) {
        await deps.auth.revokeRefreshToken(rt);
      }
      if (aborted) return;
      sendJson(res, "200 OK", { ok: true }, origin || undefined);
    })().catch((e) => {
      logger.error({ err: e }, "POST /auth/logout unhandled rejection");
      if (!aborted) {
        try {
          sendJson(res, "500 Internal Server Error", { error: "Internal error" }, origin || undefined);
        } catch {}
      }
    });
  });

  app.patch("/profile/username", (res, req) => {
    const origin = req.getHeader("origin");
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
      logger.warn("PATCH /profile/username aborted by client");
    });
    // Read synchronous req values BEFORE any async work
    const token = parseBearer(req);
    (async (): Promise<void> => {
      if (!token) {
        sendJson(res, "401 Unauthorized", { error: "Missing bearer token" }, origin || undefined);
        return;
      }

      const payload = verifyAccessToken(token);
      if (!payload) {
        sendJson(res, "401 Unauthorized", { error: "Invalid or expired token" }, origin || undefined);
        return;
      }
      const revoked = await deps.auth.isSessionRevoked(payload.sessionId);
      if (revoked) {
        sendJson(res, "401 Unauthorized", {
          error: "UNAUTHORIZED",
          message: "Session revoked; please sign in again",
        }, origin || undefined);
        return;
      }

      const raw = await readRequestBody(res);
      if (raw === null || aborted) return;

      let body: { username?: string };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        sendJson(res, "400 Bad Request", { error: "Invalid JSON" }, origin || undefined);
        return;
      }

      const parsed = usernameUpdateSchema.safeParse(body.username);
      if (!parsed.success) {
        sendJson(res, "400 Bad Request", {
          error: "BAD_REQUEST",
          message: parsed.error.issues[0]?.message ?? "Invalid username",
        }, origin || undefined);
        return;
      }

      try {
        const profile = await deps.profile.updateUsername(
          payload.sub,
          parsed.data,
        );
        void deps.userActions.log(payload.sub, "PROFILE_SET_USERNAME", {
          username: profile.username,
        });
        sendJson(res, "200 OK", {
          profile: {
            id: profile.id,
            walletAddress: profile.walletAddress,
            username: profile.username,
            createdAt: profile.createdAt,
            achievements: profile.achievements,
          },
        }, origin || undefined);
      } catch (e) {
        if (aborted) return;
        if (e instanceof AppError) {
          sendJson(res, httpStatusForAppError(e.code), {
            error: e.code,
            message: e.httpSafeMessage,
          }, origin || undefined);
          return;
        }
        logger.error({ err: e }, "PATCH /profile/username failed");
        sendJson(res, "500 Internal Server Error", { error: "Internal error" }, origin || undefined);
      }
    })().catch((e) => {
      logger.error({ err: e }, "PATCH /profile/username unhandled rejection");
      if (!aborted) {
        try {
          sendJson(res, "500 Internal Server Error", { error: "Internal error" }, origin || undefined);
        } catch {}
      }
    });
  });

  app.get("/health", (res) => {
    res.onAborted(() => {});
    sendText(res, "200 OK", "ok");
  });
}
