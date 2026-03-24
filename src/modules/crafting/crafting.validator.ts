import { z } from "zod";
import { isCraftRecipeId, type CraftRecipeId } from "./crafting.recipes.js";

export const craftStartSchema = z.object({
  recipeId: z.custom<CraftRecipeId>(
    (v): v is CraftRecipeId => typeof v === "string" && isCraftRecipeId(v),
  ),
  requestId: z.string().min(8).max(128),
});

export const craftClaimSchema = z.object({
  pendingId: z.string().uuid(),
  requestId: z.string().min(8).max(128),
});
