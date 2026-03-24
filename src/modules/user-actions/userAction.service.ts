import type { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logger/logger.js";
import { userActionsQueueKey } from "../../infrastructure/redis/keys.js";

function jsonSafePayload(payload: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(payload ?? {})) as Record<string, unknown>;
  } catch {
    return { _note: "unserializable_payload" };
  }
}

/**
 * Hot path: one Redis RPUSH per action (no Supabase await). A worker flushes batches to Postgres.
 */
export class UserActionService {
  constructor(private readonly redis: Redis) {}

  log(userId: string, actionType: string, payload: unknown): void {
    const safe = jsonSafePayload(payload);
    const record = {
      userId,
      actionType,
      payload: safe,
      ts: Date.now(),
    };

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({
        userId,
        actionType,
        payload: {},
        ts: Date.now(),
      });
    }

    if (Buffer.byteLength(line, "utf8") > env.USER_ACTIONS_MAX_LINE_BYTES) {
      line = JSON.stringify({
        userId,
        actionType,
        payload: { _truncated: true },
        ts: Date.now(),
      });
    }

    void this.redis
      .rpush(userActionsQueueKey(), line)
      .catch((err) =>
        logger.warn({ err, userId, actionType }, "user_actions queue rpush failed"),
      );
  }
}
