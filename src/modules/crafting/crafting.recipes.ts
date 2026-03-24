export type CraftRecipeId = "cake" | "chocolate";

export type CraftRecipeDefinition = {
  id: CraftRecipeId;
  /** Inventory field → qty */
  ingredients: Record<string, number>;
  outputItem: string;
  outputQty: number;
  craftTimeSec: number;
  /** Required tool in inventory (not consumed). */
  toolField: string;
  toolMin: number;
};

export const CRAFT_RECIPES: Record<CraftRecipeId, CraftRecipeDefinition> = {
  cake: {
    id: "cake",
    ingredients: { wheat: 1, egg: 1 },
    outputItem: "craft:cake",
    outputQty: 1,
    craftTimeSec: 3 * 60,
    toolField: "tool:bakery",
    toolMin: 1,
  },
  chocolate: {
    id: "chocolate",
    ingredients: { cocoa_pods: 1, sugar: 1 },
    outputItem: "craft:chocolate",
    outputQty: 1,
    craftTimeSec: 5 * 60,
    toolField: "tool:chocolate_processor",
    toolMin: 1,
  },
};

export function isCraftRecipeId(s: string): s is CraftRecipeId {
  return s in CRAFT_RECIPES;
}

export function getCraftRecipe(id: CraftRecipeId): CraftRecipeDefinition {
  return CRAFT_RECIPES[id];
}
