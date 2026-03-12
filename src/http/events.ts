/**
 * HTTP endpoint for AI-generated market events.
 * GET /market/events
 *
 * Returns:
 *   active_event — the most recent event (affects prices right now)
 *   today        — all events generated today (UTC date, up to 24)
 *   count        — how many events generated so far today
 *   date         — current UTC date (YYYY-MM-DD)
 */

import type { HttpResponse } from "uWebSockets.js";
import { getActiveEvent, getEventLog } from "../market/events.js";

function sendJson(res: HttpResponse, status: number, data: object): void {
  res.cork(() => {
    res.writeStatus(`${status} ${status === 200 ? "OK" : "Internal Server Error"}`);
    res.writeHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  });
}

export function registerEventsRoute(app: {
  get: (path: string, handler: (res: HttpResponse, req: unknown) => void) => void;
}): void {
  app.get("/market/events", (_res, _req) => {
    const { date, count, events } = getEventLog();
    sendJson(_res, 200, {
      active_event: getActiveEvent(),
      today: events,
      count,
      date,
    });
  });
}
