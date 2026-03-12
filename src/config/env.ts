/**
 * Environment configuration.
 * Uses dotenv (standard for Node.js) - loads .env from project root.
 */

import "dotenv/config";

const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? "";

export const env = {
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseSecretKey,
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV ?? "development",
  rapidApiKey: process.env.RAPIDAPI_KEY ?? "",
  googleAiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "",
} as const;
