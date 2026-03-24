import { z } from "zod";
import { isAnimalSpeciesId, type AnimalSpeciesId } from "./animal.config.js";

export const animalFeedSchema = z.object({
  species: z.custom<AnimalSpeciesId>(
    (v): v is AnimalSpeciesId => typeof v === "string" && isAnimalSpeciesId(v),
  ),
  requestId: z.string().min(8).max(128),
});

export const animalHarvestSchema = z.object({
  species: z.custom<AnimalSpeciesId>(
    (v): v is AnimalSpeciesId => typeof v === "string" && isAnimalSpeciesId(v),
  ),
  requestId: z.string().min(8).max(128),
});
