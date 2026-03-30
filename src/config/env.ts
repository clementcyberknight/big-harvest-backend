import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  // The port the uWS server binds to. Set this explicitly; do NOT rely on
  // Railway's injected PORT variable — it maps to the internal port Railway
  // chooses, which may differ from the "Internal Port" you set in Public
  // Networking. Always set WS_PORT to match that Internal Port value.
  WS_PORT: z.coerce.number().int().positive().default(9001),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  /** Short-lived access JWT (WS + API). Use refresh token for long sessions. */
  JWT_ACCESS_EXPIRES_IN: z.string().default("24h"),
  /** Long-lived session; stored in Redis keyed by hash(refresh token). */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(90),
  AUTH_CHALLENGE_TTL_SEC: z.coerce.number().int().positive().default(300),
  AUTH_DEV_BYPASS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** Max rows drained per worker tick (MULTI LRANGE+LTRIM). */
  USER_ACTIONS_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(200),
  /** Sleep when queue empty before polling again. */
  USER_ACTIONS_POLL_MS: z.coerce.number().int().nonnegative().default(200),
  /** Drop oversized queue entries on enqueue (bytes UTF-8). */
  USER_ACTIONS_MAX_LINE_BYTES: z.coerce.number().int().positive().default(65536),
  /** xAI Grok API key for AI event generation. Optional — engine skips if absent. */
  XAI_API_KEY: z.string().optional(),
  /** Google Gemini API key for primary AI event generation. */
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse({
  NODE_ENV: process.env.NODE_ENV,
  REDIS_URL: process.env.REDIS_URL,
  WS_PORT: process.env.WS_PORT,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_ACCESS_EXPIRES_IN:
    process.env.JWT_ACCESS_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN ?? "24h",
  AUTH_CHALLENGE_TTL_SEC: process.env.AUTH_CHALLENGE_TTL_SEC,
  AUTH_DEV_BYPASS: process.env.AUTH_DEV_BYPASS,
  REFRESH_TOKEN_TTL_DAYS: process.env.REFRESH_TOKEN_TTL_DAYS,
  USER_ACTIONS_BATCH_SIZE: process.env.USER_ACTIONS_BATCH_SIZE,
  USER_ACTIONS_POLL_MS: process.env.USER_ACTIONS_POLL_MS,
  USER_ACTIONS_MAX_LINE_BYTES: process.env.USER_ACTIONS_MAX_LINE_BYTES,
  XAI_API_KEY: process.env.XAI_API_KEY,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});
