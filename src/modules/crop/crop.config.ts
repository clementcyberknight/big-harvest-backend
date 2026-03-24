import type { CropDefinition } from "./crop.types.js";

function crop(
  growMin: number,
  output: number,
  seedCost: number,
  basePriceCents: number,
  harvestItemId?: string,
): CropDefinition {
  const def: CropDefinition = {
    growTimeSec: growMin * 60,
    output,
    seedCost,
    basePriceCents,
  };
  if (harvestItemId !== undefined) def.harvestItemId = harvestItemId;
  return def;
}

export const CROP_CONFIG = {
  wheat: crop(1, 1, 1, 100),
  corn: crop(1, 1, 1, 110),
  rice: crop(2, 1, 1, 130),
  soybean: crop(2, 1, 1, 125),
  tomato: crop(2, 1, 1, 100),
  potato: crop(3, 2, 1, 85),
  onion: crop(3, 2, 1, 88),
  carrot: crop(3, 2, 1, 92),
  pepper: crop(4, 2, 1, 140),
  strawberry: crop(4, 2, 1, 135),
  sunflower: crop(3, 1, 1, 115, "sunflower_seeds"),
  sugarcane: crop(4, 2, 1, 105),
  cacao: crop(5, 3, 1, 220, "cocoa_pods"),
  coffee: crop(5, 3, 1, 240, "coffee_beans"),
  vanilla: crop(5, 3, 1, 260, "vanilla_pods"),
  tea: crop(4, 1, 1, 200, "tea_leaves"),
  lavender: crop(5, 2, 1, 180),
  grapes: crop(4, 1, 1, 210, "grape"),
  cotton: crop(5, 3, 1, 195),
  oat: crop(3, 2, 1, 95),
  saffron: crop(6, 3, 1, 600),
  sapling: crop(10, 1, 1, 150, "sapling"),
  mud_pit: crop(4, 1, 1, 40, "mud"),
  chili: crop(2, 1, 1, 140, "chili"),
} as const satisfies Record<string, CropDefinition>;

export type CropId = keyof typeof CROP_CONFIG;

export const CROP_IDS = Object.keys(CROP_CONFIG) as CropId[];

export function isCropId(id: string): id is CropId {
  return id in CROP_CONFIG;
}

export function getCropDefinition(cropId: CropId): CropDefinition {
  return CROP_CONFIG[cropId];
}

export function harvestFieldForCrop(cropId: CropId): string {
  const d = CROP_CONFIG[cropId];
  return d.harvestItemId ?? cropId;
}
