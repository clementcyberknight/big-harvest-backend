import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "../config/env.js";
import { redis } from "./redis.js";
import { Treasury, TOTAL_SUPPLY } from "./treasury.js";
import { getActivePopulation } from "./population.js";

const POLICY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const policySchema = z.object({
  analysis: z
    .string()
    .describe(
      "A short sentence explaining the macroeconomic reasoning based on the telemetry provided.",
    ),
  policy_decision: z
    .enum(["inflationary_boom", "deflationary_squeeze", "neutral_stance"])
    .describe("The macroeconomic stance to take."),
  global_event_mult: z
    .number()
    .min(0.5)
    .max(1.5)
    .describe(
      "Global multiplier applied to all commodity base prices. 1.0 is neutral. 0.5 is severe deflation. 1.5 is heavy inflation.",
    ),
  news_headline: z
    .string()
    .describe(
      "A dramatic in-game news headline announcing this economic shift to players.",
    ),
});

export class AIPolicyEngine {
  static async runPolicyReview() {
    if (!env.googleAiKey) {
      console.warn("No Google AI Key, skipping monetary policy review.");
      return;
    }

    try {
      async function gatherTelemetry() {
        const balance = await Treasury.getBalance();
        const ratio = balance / TOTAL_SUPPLY;
        const population = await getActivePopulation();

        // Very basic transaction velocity tracking (requires ledger to increment 'economy:tx_volume')
        const volumeRaw = await redis.get("economy:tx_volume");
        const volume = volumeRaw ? parseInt(volumeRaw, 10) : 0;

        // reset volume for next window
        await redis.set("economy:tx_volume", 0);

        return {
          treasuryBalance: balance,
          treasuryRatio: ratio,
          transactionVolume: volume,
          activePopulation: population,
        };
      }
      const telemetry = await gatherTelemetry();

      const prompt = `
You are the Chairman of the Central Bank in a farming simulation game.
Total Supply cap is strictly ${TOTAL_SUPPLY} tokens. No new tokens can be printed.
The Treasury acts as the game's buyer and seller.
      Your goal is to maintain a balanced, engaging economy that is enjoyable regardless of the player population size.
      
      CURRENT TELEMETRY:
      - Active Population (last 1h): ${telemetry.activePopulation} users
      - Treasury Balance: ${telemetry.treasuryBalance} / ${TOTAL_SUPPLY} tokens (${(telemetry.treasuryRatio * 100).toFixed(1)}%)
      - Transactions Since Last Check: ${telemetry.transactionVolume}

      ECONOMIC MANDATE:
      - If Treasury ratio < 20% (Low funds): Economy is overheating or oversupplied. Consider tightening (multiplier < 1.0).
      - If Treasury ratio > 80% (High funds): Economy is stagnant or players are broke. Consider easing (multiplier > 1.0).
      - Always account for Active Population: if volume is high but population is low, players are very active. If volume is high and population is high, it's normal.

      Generate a macro-economic policy analysis and set the global event multiplier.
    `;

      const { object } = await generateObject({
        model: google("gemini-2.5-flash"),
        schema: policySchema,
        prompt,
      });

      console.log(
        `[Policy] ${object.policy_decision}: ${object.news_headline} (Mult: ${object.global_event_mult})`,
      );

      // Save the global event multiplier to Redis for pricing.ts to read
      await redis.set(
        "economy:event_mult",
        object.global_event_mult.toString(),
      );
      await redis.set("economy:latest_news", object.news_headline);
    } catch (err) {
      console.error("[Policy] AI Engine failed to run review:", err);
    }
  }

  static startEngine() {
    // Run an initial review after 10 seconds of boot
    setTimeout(() => this.runPolicyReview(), 10000);

    return setInterval(() => {
      this.runPolicyReview();
    }, POLICY_INTERVAL_MS);
  }
}
