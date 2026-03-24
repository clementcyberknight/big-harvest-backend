import { getSupabase } from "../../infrastructure/supabase/client.js";
import { logger } from "../../infrastructure/logger/logger.js";

function jsonSafePayload(payload: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(payload ?? {})) as Record<string, unknown>;
  } catch {
    return { _note: "unserializable_payload" };
  }
}

export class UserActionService {
  private readonly supabase = getSupabase();

  /** Best-effort audit log; failures do not break gameplay. */
  async log(userId: string, actionType: string, payload: unknown): Promise<void> {
    try {
      const { error } = await this.supabase.from("user_actions").insert({
        user_id: userId,
        action_type: actionType,
        payload: jsonSafePayload(payload),
      });
      if (error) {
        logger.warn({ err: error, userId, actionType }, "user_actions insert failed");
      }
    } catch (e) {
      logger.warn({ err: e, userId, actionType }, "user_actions insert threw");
    }
  }
}
