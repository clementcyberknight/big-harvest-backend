import type { Redis } from "ioredis";
import { env } from "../config/env.js";
import { getSupabase } from "../infrastructure/supabase/client.js";
import { logger } from "../infrastructure/logger/logger.js";
import { atomicDrainUserActionBatch } from "../infrastructure/redis/userActionQueue.js";
import { userActionsQueueKey } from "../infrastructure/redis/keys.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type QueuedUserAction = {
  userId?: string;
  actionType?: string;
  payload?: Record<string, unknown>;
  ts?: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseQueueLine(line: string): {
  user_id: string;
  action_type: string;
  payload: Record<string, unknown>;
} | null {
  try {
    const o = JSON.parse(line) as QueuedUserAction;
    if (typeof o.userId !== "string" || typeof o.actionType !== "string") {
      return null;
    }
    if (!UUID_RE.test(o.userId)) return null;
    const payload =
      o.payload && typeof o.payload === "object" ? o.payload : {};
    return {
      user_id: o.userId,
      action_type: o.actionType,
      payload,
    };
  } catch {
    return null;
  }
}

async function requeueBatch(redis: Redis, batch: string[]): Promise<void> {
  if (batch.length === 0) return;
  await redis.lpush(userActionsQueueKey(), ...[...batch].reverse());
}

export async function flushBatchToSupabase(
  redis: Redis,
  batch: string[],
): Promise<void> {
  if (batch.length === 0) return;

  const rows = batch.map(parseQueueLine).filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) {
    logger.warn({ dropped: batch.length }, "user_actions batch had no valid rows");
    return;
  }

  const supabase = getSupabase();
  const { error } = await supabase.from("user_actions").insert(rows);
  if (error) {
    logger.error({ err: error, count: rows.length }, "user_actions batch insert failed; requeueing");
    await requeueBatch(redis, batch);
    await sleep(2000);
  }
}

/**
 * Cold path: drain Redis queue into Supabase in batches. Hot path only does RPUSH.
 */
export function startUserActionsFlushWorker(redis: Redis): () => Promise<void> {
  let stopped = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  void (async () => {
    try {
      while (true) {
        if (stopped) {
          const tail = await atomicDrainUserActionBatch(
            redis,
            env.USER_ACTIONS_BATCH_SIZE,
          );
          if (tail.length === 0) break;
          await flushBatchToSupabase(redis, tail);
          continue;
        }

        const batch = await atomicDrainUserActionBatch(
          redis,
          env.USER_ACTIONS_BATCH_SIZE,
        );
        if (batch.length > 0) {
          await flushBatchToSupabase(redis, batch);
        } else {
          await sleep(env.USER_ACTIONS_POLL_MS);
        }
      }
    } catch (e) {
      logger.error({ err: e }, "user_actions worker crashed");
    } finally {
      resolveDone();
    }
  })();

  return async () => {
    stopped = true;
    await done;
  };
}

/** Best-effort drain after worker stopped (usually empty). */
export async function flushUserActionsQueueToSupabase(redis: Redis): Promise<void> {
  const supabase = getSupabase();
  const key = userActionsQueueKey();
  for (;;) {
    const batch = await atomicDrainUserActionBatch(redis, 500);
    if (batch.length === 0) break;
    const rows = batch.map(parseQueueLine).filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length === 0) continue;
    const { error } = await supabase.from("user_actions").insert(rows);
    if (error) {
      logger.error({ err: error }, "user_actions shutdown flush failed; restoring queue head");
      await redis.lpush(key, ...[...batch].reverse());
      return;
    }
  }
}
