import type { HttpRequest, HttpResponse, TemplatedApp } from "uWebSockets.js";
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
  readRequestBody,
  sendJson,
  sendText,
} from "./http.util.js";
import { logger } from "../../infrastructure/logger/logger.js";

export type AuthHttpDeps = {
  auth: AuthService;
  profile: ProfileService;
  userActions: UserActionService;
};

function httpStatusForAppError(code: string): string {
  switch (code) {
    case "INVALID_SIGNATURE":
    case "INVALID_REFRESH_TOKEN":
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
  app.options("/*", (res) => {
    applyCors(res);
    res.writeStatus("204 No Content");
    res.end();
  });

  app.get("/auth/challenge", (res) => {
    applyCors(res);
    void (async () => {
      try {
        const challenge = await deps.auth.createChallenge();
        sendJson(res, "200 OK", challenge);
      } catch (e) {
        logger.error({ err: e }, "GET /auth/challenge failed");
        const msg = e instanceof Error ? e.message : "Internal error";
        sendJson(res, "500 Internal Server Error", { error: msg });
      }
    })();
  });

  app.post("/auth/verify", (res, req) => {
    applyCors(res);
    void (async () => {
      const raw = await readRequestBody(res);
      if (raw === null) return;

      let body: {
        wallet?: string;
        signature?: string;
        challengeId?: string;
      };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        sendJson(res, "400 Bad Request", { error: "Invalid JSON" });
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
        });
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
        });
      } catch (e) {
        if (e instanceof AppError) {
          sendJson(res, httpStatusForAppError(e.code), {
            error: e.code,
            message: e.httpSafeMessage,
          });
          return;
        }
        logger.error({ err: e }, "POST /auth/verify failed");
        sendJson(res, "500 Internal Server Error", { error: "Internal error" });
      }
    })();
  });

  app.post("/auth/refresh", (res, req) => {
    applyCors(res);
    void (async () => {
      const raw = await readRequestBody(res);
      if (raw === null) return;

      let body: { refreshToken?: string };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        sendJson(res, "400 Bad Request", { error: "Invalid JSON" });
        return;
      }

      const rt =
        typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
      if (!rt) {
        sendJson(res, "400 Bad Request", {
          error: "refreshToken is required",
        });
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
        });
      } catch (e) {
        if (e instanceof AppError) {
          sendJson(res, httpStatusForAppError(e.code), {
            error: e.code,
            message: e.httpSafeMessage,
          });
          return;
        }
        logger.error({ err: e }, "POST /auth/refresh failed");
        sendJson(res, "500 Internal Server Error", { error: "Internal error" });
      }
    })();
  });

  app.post("/auth/logout", (res, req) => {
    applyCors(res);
    void (async () => {
      const raw = await readRequestBody(res);
      if (raw === null) return;

      let body: { refreshToken?: string };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        sendJson(res, "400 Bad Request", { error: "Invalid JSON" });
        return;
      }

      const rt =
        typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
      if (rt) {
        await deps.auth.revokeRefreshToken(rt);
      }
      sendJson(res, "200 OK", { ok: true });
    })();
  });

  app.patch("/profile/username", (res, req) => {
    applyCors(res);
    void (async () => {
      const token = parseBearer(req);
      if (!token) {
        sendJson(res, "401 Unauthorized", { error: "Missing bearer token" });
        return;
      }

      const payload = verifyAccessToken(token);
      if (!payload) {
        sendJson(res, "401 Unauthorized", { error: "Invalid or expired token" });
        return;
      }

      const raw = await readRequestBody(res);
      if (raw === null) return;

      let body: { username?: string };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        sendJson(res, "400 Bad Request", { error: "Invalid JSON" });
        return;
      }

      const parsed = usernameUpdateSchema.safeParse(body.username);
      if (!parsed.success) {
        sendJson(res, "400 Bad Request", {
          error: "BAD_REQUEST",
          message: parsed.error.issues[0]?.message ?? "Invalid username",
        });
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
        });
      } catch (e) {
        if (e instanceof AppError) {
          sendJson(res, httpStatusForAppError(e.code), {
            error: e.code,
            message: e.httpSafeMessage,
          });
          return;
        }
        logger.error({ err: e }, "PATCH /profile/username failed");
        sendJson(res, "500 Internal Server Error", { error: "Internal error" });
      }
    })();
  });

  app.get("/health", (res) => {
    sendText(res, "200 OK", "ok");
  });
}
