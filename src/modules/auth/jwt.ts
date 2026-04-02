import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../../config/env.js";

export type AccessTokenPayload = {
  sub: string;
  wal: string;
  sessionId: string;
  role: string;
};

export function signAccessToken(
  userId: string,
  walletAddress: string,
  sessionId: string,
  role = "player",
): string {
  return jwt.sign(
    { sub: userId, wal: walletAddress, sessionId, role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as SignOptions,
  );
}

/** Unix seconds from JWT `exp`, if present. */
export function accessTokenExpUnix(token: string): number | null {
  const decoded = jwt.decode(token);
  if (typeof decoded !== "object" || decoded === null) return null;
  const exp = (decoded as jwt.JwtPayload).exp;
  return typeof exp === "number" ? exp : null;
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    let decoded: unknown;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch {
      if (!env.JWT_SECRET_PREV) return null;
      decoded = jwt.verify(token, env.JWT_SECRET_PREV);
    }
    if (typeof decoded !== "object" || decoded === null) return null;
    const p = decoded as jwt.JwtPayload;
    if (
      typeof p.sub !== "string" ||
      typeof p.wal !== "string" ||
      typeof (p as any).sessionId !== "string" ||
      typeof (p as any).role !== "string"
    ) {
      return null;
    }
    return {
      sub: p.sub,
      wal: p.wal,
      sessionId: (p as any).sessionId as string,
      role: (p as any).role as string,
    };
  } catch {
    return null;
  }
}
