import type { Redis } from "ioredis";
import { logger } from "../../infrastructure/logger/logger.js";
import { runCropDecayTick } from "./jobs/crop-decay.job.js";
import { runPricingTick } from "../../workers/pricing.worker.js";
import { runAiEventTick, setAiEventBroadcaster } from "../../workers/aiEvent.worker.js";
import { runIdolRequestTick } from "../../workers/idolRequest.worker.js";
import { runLeaderboardTick } from "../../workers/leaderboard.worker.js";

// Schedules Configuration
const SCHEDULES = {
  PRICING: 30 * 1000,           // 30 seconds
  CROP_DECAY: 2 * 60 * 1000,    // 2 minutes
  IDOL_REQUEST: 5 * 60 * 1000,  // 5 minutes
  AI_EVENT: 60 * 1000,          // 60 seconds
  LEADERBOARD: 5 * 60 * 1000,   // 5 minutes 
};

export class SchedulerService {
  private intervals: NodeJS.Timeout[] = [];

  constructor(
    private readonly redis: Redis,
    private readonly onPricingTick?: () => Promise<void>,
  ) {}

  startAll(): void {
    logger.info("[scheduler] Starting centralized cron jobs");

    // 1. Pricing Worker
    this.scheduleJob("Pricing", SCHEDULES.PRICING, () =>
      runPricingTick(this.redis, this.onPricingTick),
    );

    // 2. Crop Decay
    this.scheduleJob("CropDecay", SCHEDULES.CROP_DECAY, () => runCropDecayTick(this.redis));

    // 3. Idol Request
    this.scheduleJob("IdolRequest", SCHEDULES.IDOL_REQUEST, async () => {
      await runIdolRequestTick(this.redis);
    });

    // 4. AI Event 
    this.scheduleJob("AiEvent", SCHEDULES.AI_EVENT, () => runAiEventTick(this.redis));

    // 5. Leaderboard
    this.scheduleJob("Leaderboard", SCHEDULES.LEADERBOARD, () => runLeaderboardTick(this.redis));
  }

  stopAll(): void {
    logger.info("[scheduler] Stopping all cron jobs");
    for (const id of this.intervals) {
      clearInterval(id);
    }
    this.intervals = [];
  }

  private scheduleJob(name: string, ms: number, jobFn: () => Promise<void>): void {
    // Initial run immediately (10s offset to let things settle)
    setTimeout(() => {
      void jobFn().catch((err) => logger.error({ err }, `[scheduler] ${name} job failed`));
    }, 10_000);

    const id = setInterval(() => {
      void jobFn().catch((err) => logger.error({ err }, `[scheduler] ${name} job failed`));
    }, ms);
    
    this.intervals.push(id);
  }
}
