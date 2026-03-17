import { redis } from '../economy/redis.js';

/**
 * Acquires a Redis-based distributed mutex lock for the given key.
 * Throws an error if the lock is already held.
 * Prevents race conditions by ensuring a player can only execute one action at a time.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  const lockKey = `lock:${key}`;
  
  // NX: Set only if it does not exist. PX: Expire in timeoutMs.
  const acquired = await redis.set(lockKey, '1', { NX: true, PX: timeoutMs });
  
  if (!acquired) {
    throw new Error('Action blocked: please wait for your previous action to finish.');
  }

  try {
    return await fn();
  } finally {
    // Release the lock when the operation finishes (or errors)
    await redis.del(lockKey);
  }
}
