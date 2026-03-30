import type { HttpResponse } from "uWebSockets.js";

export function applyCors(res: HttpResponse): void {
  res.writeHeader("Access-Control-Allow-Origin", "*");
  res.writeHeader(
    "Access-Control-Allow-Headers",
    "content-type, authorization",
  );
  res.writeHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
}

export function readRequestBody(
  res: HttpResponse,
  maxBytes = 65536,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    res.onAborted(() => finish(null));

    const chunks: Buffer[] = [];
    let total = 0;

    res.onData((arrayBuffer, isLast) => {
      const chunk = Buffer.from(arrayBuffer);
      total += chunk.length;
      if (total > maxBytes) {
        res.cork(() => {
          applyCors(res);
          res.writeStatus("413 Payload Too Large");
          res.end();
        });
        finish(null);
        return;
      }
      chunks.push(chunk);
      if (isLast) {
        finish(Buffer.concat(chunks).toString("utf8"));
      }
    });
  });
}

export function sendJson(
  res: HttpResponse,
  status: string,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.cork(() => {
    res.writeStatus(status);
    res.writeHeader("Content-Type", "application/json; charset=utf-8");
    res.end(payload);
  });
}

export function sendText(res: HttpResponse, status: string, text: string): void {
  res.cork(() => {
    res.writeStatus(status);
    res.writeHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(text);
  });
}
