/**
 * Environment configuration.
 * Uses dotenv (standard for Node.js) - loads .env from project root.
 */

import "dotenv/config";

const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const env = {
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseSecretKey,
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV ?? "development",
  rapidApiKey: process.env.RAPIDAPI_KEY ?? "",
} as const;
