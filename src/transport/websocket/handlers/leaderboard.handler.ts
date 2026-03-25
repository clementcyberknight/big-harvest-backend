import type { WebSocket } from "uWebSockets.js";
import { logger } from "../../../infrastructure/logger/logger.js";
import { AppError } from "../../../shared/errors/appError.js";
import { sendGameMessage } from "../ws.codec.js";
import type { WsGameContext } from "../ws.router.js";
import type { WsUserData } from "../ws.types.js";
import { viewLeaderboardSchema } from "../../../modules/leaderboard/leaderboard.validator.js";

export async function handleViewLeaderboard(
  ws: WebSocket<WsUserData>,
  data: unknown,
  ctx: WsGameContext,
): Promise<void> {
  const userId = ws.getUserData().userId;

  try {
    const cmd = viewLeaderboardSchema.parse(data);
    const entries = await ctx.leaderboards.getTop(cmd.category, cmd.limit);
    const userRank = await ctx.leaderboards.getPlayerRank(userId, cmd.category);

    sendGameMessage(ws, {
      type: "VIEW_LEADERBOARD_OK",
      data: {
        category: cmd.category,
        entries,
        userRank,
      },
    });
  } catch (err) {
    logger.debug({ err, userId }, "VIEW_LEADERBOARD failed");
    if (err instanceof Error && err.name === "ZodError") {
      throw new AppError("BAD_REQUEST", "Invalid leaderboard query format");
    }
    throw err;
  }
}
