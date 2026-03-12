/**
 * HTTP endpoint for token refresh (POST /auth/refresh).
 */

import type { HttpResponse } from "uWebSockets.js";
import { authenticateWithRefreshToken } from "../auth/index.js";

function sendJson(res: HttpResponse, status: number, data: object): void {
  res.cork(() => {
    res.writeStatus(
      `${status} ${status === 200 ? "OK" : status === 401 ? "Unauthorized" : "Bad Request"}`,
    );
    res.writeHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  });
}

export function registerRefreshRoute(app: {
  post: (p: string, h: (res: HttpResponse, req: unknown) => void) => void;
}): void {
  app.post("/auth/refresh", (res, _req) => {
    const chunks: Uint8Array[] = [];

    res.onData((chunk, isLast) => {
      chunks.push(new Uint8Array(chunk));
      if (isLast) {
        const body = Buffer.concat(chunks).toString("utf-8");
        let parsed: { refresh_token?: string };
        try {
          parsed = JSON.parse(body) as { refresh_token?: string };
        } catch {
          sendJson(res, 400, { error: "Invalid JSON" });
          return;
        }

        if (typeof parsed.refresh_token !== "string") {
          sendJson(res, 400, { error: "Missing refresh_token" });
          return;
        }

        void authenticateWithRefreshToken(parsed.refresh_token).then(
          (result) => {
            if ("error" in result) {
              sendJson(res, 401, { error: result.error });
              return;
            }
            sendJson(res, 200, {
              access_token: result.accessToken,
              refresh_token: result.refreshToken,
              expires_in: result.expiresIn,
            });
          },
        );
      }
    });

    res.onAborted(() => {});
  });
}
