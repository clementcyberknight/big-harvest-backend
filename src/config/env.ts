import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  WS_PORT: z.coerce.number().int().positive().default(9001),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  AUTH_CHALLENGE_TTL_SEC: z.coerce.number().int().positive().default(300),
  AUTH_DEV_BYPASS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse({
  NODE_ENV: process.env.NODE_ENV,
  REDIS_URL: process.env.REDIS_URL,
  WS_PORT: process.env.WS_PORT,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  AUTH_CHALLENGE_TTL_SEC: process.env.AUTH_CHALLENGE_TTL_SEC,
  AUTH_DEV_BYPASS: process.env.AUTH_DEV_BYPASS,
});
