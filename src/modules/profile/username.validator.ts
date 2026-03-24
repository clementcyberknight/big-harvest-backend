import { z } from "zod";

/** Display name chosen or updated by the player. */
export const usernameUpdateSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(24, "Username must be at most 24 characters")
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Only letters, numbers, underscore, and hyphen allowed",
  );
