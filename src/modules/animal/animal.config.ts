/**
 * Livestock: buy `animal:*` from treasury, feed with crops, harvest on a timer.
 * Chicken ↔ corn, cow ↔ wheat (per design brief).
 */

export type AnimalSpeciesId =
  | "chicken"
  | "sheep"
  | "cow"
  | "goat"
  | "pig"
  | "silkworm"
  | "bee";

export type AnimalSpeciesDefinition = {
  speciesId: AnimalSpeciesId;
  inventoryField: string;
  produceItem: string;
  /** Seconds between harvests (after previous collection). */
  produceIntervalSec: number;
  feedItem: string;
  /** Feed units consumed per animal per feed action. */
  feedPerAnimal: number;
  /** Max produce granted per harvest click (spam cap). */
  maxProducePerHarvest: number;
};

export const ANIMAL_SPECIES: Record<AnimalSpeciesId, AnimalSpeciesDefinition> = {
  chicken: {
    speciesId: "chicken",
    inventoryField: "animal:chicken",
    produceItem: "egg",
    produceIntervalSec: 2 * 60,
    feedItem: "corn",
    feedPerAnimal: 1,
    maxProducePerHarvest: 64,
  },
  cow: {
    speciesId: "cow",
    inventoryField: "animal:cow",
    produceItem: "milk",
    produceIntervalSec: 3 * 60,
    feedItem: "wheat",
    feedPerAnimal: 2,
    maxProducePerHarvest: 64,
  },
  sheep: {
    speciesId: "sheep",
    inventoryField: "animal:sheep",
    produceItem: "wool",
    produceIntervalSec: 5 * 60,
    feedItem: "wheat",
    feedPerAnimal: 2,
    maxProducePerHarvest: 48,
  },
  goat: {
    speciesId: "goat",
    inventoryField: "animal:goat",
    produceItem: "milk",
    produceIntervalSec: 3 * 60,
    feedItem: "oat",
    feedPerAnimal: 2,
    maxProducePerHarvest: 48,
  },
  pig: {
    speciesId: "pig",
    inventoryField: "animal:pig",
    produceItem: "pork",
    produceIntervalSec: 4 * 60,
    feedItem: "corn",
    feedPerAnimal: 2,
    maxProducePerHarvest: 48,
  },
  silkworm: {
    speciesId: "silkworm",
    inventoryField: "animal:silkworm",
    produceItem: "silk",
    produceIntervalSec: 6 * 60,
    feedItem: "cotton",
    feedPerAnimal: 1,
    maxProducePerHarvest: 32,
  },
  bee: {
    speciesId: "bee",
    inventoryField: "animal:bee",
    produceItem: "honey",
    produceIntervalSec: 3 * 60,
    feedItem: "sunflower_seeds",
    feedPerAnimal: 1,
    maxProducePerHarvest: 64,
  },
};

const ids = Object.keys(ANIMAL_SPECIES) as AnimalSpeciesId[];

export function isAnimalSpeciesId(s: string): s is AnimalSpeciesId {
  return s in ANIMAL_SPECIES;
}

export function getAnimalSpecies(id: AnimalSpeciesId): AnimalSpeciesDefinition {
  return ANIMAL_SPECIES[id];
}

export const ANIMAL_SPECIES_IDS = ids;
