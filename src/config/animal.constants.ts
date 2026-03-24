/**
 * How long “fed” stays valid (ms). Must re-feed after this to keep harvesting.
 * Tuned for short game sessions; increase for slower live-ops.
 */
export const ANIMAL_FED_WINDOW_MS = 45 * 60 * 1000;
