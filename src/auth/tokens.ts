/**
 * Access & refresh token management.
 */

import * as jose from 'jose';
import { randomBytes, createHash } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;
const CHALLENGE_TTL_SEC = 60;

export interface TokenPayload {
  sub: string; // profile_id (uuid)
  wallet: string;
  iat?: number;
  exp?: number;
}

let secret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (!secret) {
    const key = env.jwtSecret;
    if (key.length < 32) {
      secret = new TextEncoder().encode(key.padEnd(32, '0').slice(0, 32));
    } else {
      secret = createHash('sha256').update(key).digest();
    }
  }
  return secret;
}

export async function createAccessToken(profileId: string, wallet: string): Promise<string> {
  return new jose.SignJWT({ wallet })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(profileId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(getSecret());
}

export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getSecret());
    const sub = payload.sub as string;
    const wallet = payload.wallet as string;
    if (!sub || !wallet) return null;
    return { sub, wallet };
  } catch {
    return null;
  }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createRefreshToken(
  profileId: string,
  deviceInfo?: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateRefreshToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TTL_DAYS);

  const { error } = await supabase.from('refresh_tokens').insert({
    profile_id: profileId,
    token_hash: hashRefreshToken(token),
    device_info: deviceInfo ?? null,
    expires_at: expiresAt.toISOString(),
  });

  if (error) throw new Error('Failed to store refresh token');

  return { token, expiresAt };
}

export async function consumeRefreshToken(
  token: string
): Promise<{ profileId: string } | null> {
  const hash = hashRefreshToken(token);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('refresh_tokens')
    .select('id, profile_id')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .single();

  if (error || !data) return null;

  await supabase
    .from('refresh_tokens')
    .update({ revoked_at: now })
    .eq('id', data.id);

  return { profileId: data.profile_id };
}

export function isChallengeExpired(timestamp: number): boolean {
  return Date.now() / 1000 - timestamp > CHALLENGE_TTL_SEC;
}
