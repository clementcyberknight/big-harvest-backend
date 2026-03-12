/**
 * HTTP endpoint for cached commodity prices (GET /market/commodities).
 */

import type { HttpResponse } from "uWebSockets.js";
import { getGameCommodities } from "../market/engine.js";

function sendJson(res: HttpResponse, status: number, data: object): void {
  res.cork(() => {
    res.writeStatus(
      `${status} ${status === 200 ? "OK" : "Internal Server Error"}`,
    );
    res.writeHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  });
}

export function registerCommoditiesRoute(app: {
  get: (path: string, handler: (res: HttpResponse, req: unknown) => void) => void;
}): void {
  app.get("/market/commodities", (_res, _req) => {
    const { commodities, fetched_at } = getGameCommodities();
    sendJson(_res, 200, {
      commodities,
      count: commodities.length,
      fetched_at,
    });
  });
}
