import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../../config/env.js";

export type AccessTokenPayload = {
  sub: string;
  wal: string;
};

export function signAccessToken(userId: string, walletAddress: string): string {
  return jwt.sign(
    { sub: userId, wal: walletAddress },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN } as SignOptions,
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded !== "object" || decoded === null) return null;
    const p = decoded as jwt.JwtPayload;
    if (typeof p.sub !== "string" || typeof p.wal !== "string") return null;
    return { sub: p.sub, wal: p.wal };
  } catch {
    return null;
  }
}
