/**
 * AI-generated market events.
 */

import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "../config/env.js";
import { GAME_CROPS } from "./crops.js";

const EVENT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const EVENT_DURATION_MS = 30 * 60 * 1000;

const VALID_CROP_IDS = new Set(GAME_CROPS.map((c) => c.id));

function getCurrentSeason(): string {
  const month = new Date().getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return "Spring";
  if (month >= 6 && month <= 8) return "Summer";
  if (month >= 9 && month <= 11) return "Autumn";
  return "Winter";
}

function getCurrentMonthName(): string {
  return new Date().toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

// ── Zod schema for structured Gemini output ──────────────────────────────────

const marketEventSchema = z.object({
  event: z.string().describe("Short, dramatic event title (max 8 words)"),
  description: z
    .string()
    .describe(
      "2–3 vivid sentences explaining the event and its devastating or euphoric impact on farmers and buyers. Be dramatic.",
    ),
  affect: z
    .array(z.string())
    .describe(
      "List of 1–4 game commodity IDs affected. Use only IDs from the provided list.",
    ),
  outcome: z
    .enum(["crash", "surge", "boycott"])
    .describe(
      "'crash' = prices fall sharply (supply shock or oversupply). " +
        "'surge' = prices spike sharply (scarcity or war). " +
        "'boycott' = total demand collapse — nobody wants to buy this item (health scare, scandal, taboo, viral panic). " +
        "Use 'boycott' for the most extreme situations where demand hits near-zero.",
    ),
  impact_multiplier: z
    .number()
    .min(0.02)
    .max(2.0)
    .describe(
      "Price multiplier applied to all affected items. " +
        "crash: 0.30–0.70. surge: 1.25–1.85. boycott: 0.02–0.12 (near worthless).",
    ),
  player_tip: z
    .string()
    .describe(
      "One short sentence of in-game advice for players. E.g. 'Sell your corn stockpile immediately!' or 'Invest in cotton fields now!'",
    ),
});

// ── Public types ─────────────────────────────────────────────────────────────

export type MarketEventOutcome = "crash" | "surge" | "boycott";

export interface MarketEvent {
  event: string;
  description: string;
  affect: string[];
  outcome: MarketEventOutcome;
  impact_multiplier: number;
  player_tip: string;
  generated_at: string;
  expires_at: string;
}

// ── In-memory state ──────────────────────────────────────────────────────────

let activeEvent: MarketEvent | null = null;

/** All events generated so far today (UTC date). Resets at midnight UTC. */
let dailyEventLog: MarketEvent[] = [];
let logDate: string = new Date().toISOString().slice(0, 10);

function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── Core generation ──────────────────────────────────────────────────────────

async function generateMarketEvent(): Promise<MarketEvent | null> {
  if (!env.googleAiKey) {
    console.warn(
      "[events] GOOGLE_GENERATIVE_AI_API_KEY not set — skipping event generation",
    );
    return null;
  }

  const season = getCurrentSeason();
  const month = getCurrentMonthName();
  const cropIdList = Array.from(VALID_CROP_IDS).join(", ");

  try {
    const { object } = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: marketEventSchema,
      prompt: `You are the game master for a dramatic farming simulation game called Big Harvest.

Current season: ${season} (${month})

Available commodity IDs you may use in "affect":
${cropIdList}

Generate ONE dramatic, unpredictable market event for ${season} that will shock and challenge players.
The event MUST use commodity IDs from the list above.

Multiplier rules:
- CRASH: impact_multiplier 0.30–0.70 (sharp supply shock or oversupply)
- SURGE: impact_multiplier 1.25–1.85 (scarcity, war, or panic buying)
- BOYCOTT: impact_multiplier 0.02–0.12 (near-zero demand — nobody will buy)

You MUST vary between all three outcome types. Be creative and dramatic.

Example BOYCOTT events (use these as inspiration, not literally):
- "Viral Panic: Sugarcane Linked to Mystery Illness" — A social media post claims sugarcane causes a mysterious disease. Buyers refuse to touch it. Farmers are stuck with mountains of worthless cane.
- "Government Contamination Alert: Milk Recalled Nationwide" — A toxin found in milk batches. All dairy sales halted by emergency decree.
- "Celebrity Exposé Destroys Pork Market" — A famous influencer's documentary accuses local pork farms of horrific conditions. Consumers boycott overnight.
- "Fishing Ban: Lobsters Carry Rare Parasite" — Health authorities warn of a parasite in lobster. Restaurants pull it from menus immediately.
- "Cotton Clothing Blamed for Skin Disease" — Doctors warn of a cotton allergy epidemic. Thread and fabric prices collapse.

Example CRASH events:
- "Record Harvest Floods the Corn Market" — Bumper crops mean too much supply; prices free-fall.
- "Cold Snap Freezes Strawberry Exports" — Crops survive but international buyers cancel orders.
- "Hurricane Season Floods Sugar Cane Fields" — Severe flooding destroys sugarcane yield.

Example SURGE events:
- "War Embargo Cuts Off Wheat Imports" — Trading partners halt exports; domestic wheat becomes scarce and priceless.
- "Global Coffee Shortage After Brazilian Frost" — Coffee bean supply halved worldwide; prices explode.
- "Truffle Fever: Rare Pig Discovery Goes Viral" — A pig finds a 10kg truffle; demand for truffles surges worldwide.

Season-specific ideas for ${season}:
- Spring: frost killing seedlings, early pest swarms, planting season panic buying
- Summer: drought, heat wave, bumper-harvest glut, disease outbreak, parasites
- Autumn: hurricane, floods, trade wars, harvest festivals driving demand
- Winter: shipping freeze, storage failures, cold snaps, festive demand surges`,
    });

    // Filter out any IDs that Gemini hallucinated
    const validAffect = object.affect.filter((id) => VALID_CROP_IDS.has(id));
    if (validAffect.length === 0) {
      console.warn(
        "[events] Gemini returned no valid crop IDs — skipping event",
      );
      return null;
    }

    // Enforce multiplier bounds per outcome type
    let clampedMultiplier = object.impact_multiplier;
    if (object.outcome === "boycott") {
      clampedMultiplier = Math.max(0.02, Math.min(0.12, clampedMultiplier));
    } else if (object.outcome === "crash") {
      clampedMultiplier = Math.max(0.3, Math.min(0.75, clampedMultiplier));
    } else {
      clampedMultiplier = Math.max(1.25, Math.min(1.85, clampedMultiplier));
    }

    return {
      event: object.event,
      description: object.description,
      affect: validAffect,
      outcome: object.outcome,
      impact_multiplier: clampedMultiplier,
      player_tip: object.player_tip,
      generated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + EVENT_DURATION_MS).toISOString(),
    };
  } catch (err) {
    console.error("[events] Failed to generate market event:", err);
    return null;
  }
}

export function getActiveEvent(): MarketEvent | null {
  return activeEvent;
}

export function getEventMultiplierFor(cropId: string): number {
  if (!activeEvent) return 1.0;
  if (Date.now() > new Date(activeEvent.expires_at).getTime()) return 1.0;
  if (!activeEvent.affect.includes(cropId)) return 1.0;
  return activeEvent.impact_multiplier;
}

export async function refreshEvent(): Promise<MarketEvent | null> {
  const today = getTodayUTC();
  if (today !== logDate) {
    dailyEventLog = [];
    logDate = today;
    console.log(`[events] New UTC day (${today}) — daily event log reset`);
  }

  const event = await generateMarketEvent();
  if (event) {
    activeEvent = event;
    dailyEventLog.push(event);
    const emoji =
      event.outcome === "boycott"
        ? "🚫"
        : event.outcome === "surge"
          ? "📈"
          : "📉";
    console.log(
      `[events] ${emoji} #${dailyEventLog.length}/24 "${event.event}" (${event.outcome} ×${event.impact_multiplier}) → ${event.affect.join(", ")}`,
    );
  }
  return activeEvent;
}

export function getEventLog(): {
  date: string;
  count: number;
  events: MarketEvent[];
} {
  return {
    date: logDate,
    count: dailyEventLog.length,
    events: [...dailyEventLog],
  };
}

export function startEventEngine(
  onEvent: (event: MarketEvent | null) => void,
): NodeJS.Timeout {
  let expiryTimer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }

    const event = await refreshEvent();
    onEvent(event);

    if (event) {
      const msUntilExpiry = new Date(event.expires_at).getTime() - Date.now();
      expiryTimer = setTimeout(
        () => {
          activeEvent = null;
          expiryTimer = null;
          console.log("[events] ⏰ Event expired — prices reset to normal");
          onEvent(null);
        },
        Math.max(0, msUntilExpiry),
      );
    }
  };

  void tick();
  return setInterval(tick, EVENT_REFRESH_INTERVAL_MS);
}
