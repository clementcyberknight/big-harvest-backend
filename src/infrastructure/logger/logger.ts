import pino from "pino";
import { env } from "../../config/env.js";

/**
 * Structured logging for Ravolo (AGENTS.md). Use only this `logger` in runtime code — no `console.*` in services/transport.
 */
export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: {
    service: "ravolo-backend",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["req.headers.authorization", "password", "refreshToken", "accessToken"],
    censor: "[Redacted]",
  },
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});
