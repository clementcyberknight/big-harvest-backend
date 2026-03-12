/**
 * Auth service: wallet verification + token issuance.
 */

import { randomUUID } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { verifyWalletSignature } from './verify.js';
import {
  createAccessToken,
  createRefreshToken,
  consumeRefreshToken,
  verifyAccessToken,
  isChallengeExpired,
} from './tokens.js';

export interface AuthChallenge {
  nonce: string;
  timestamp: number;
  expiresIn: number;
}

export interface AuthResult {
  profileId: string;
  wallet: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const CHALLENGE_TTL_SEC = 60;

export function createChallenge(): AuthChallenge {
  return {
    nonce: randomUUID(),
    timestamp: Math.floor(Date.now() / 1000),
    expiresIn: CHALLENGE_TTL_SEC,
  };
}

export async function authenticateWithWallet(
  publicKey: string,
  signature: string,
  nonce: string,
  timestamp: number,
  deviceInfo?: string
): Promise<AuthResult | { error: string }> {
  if (isChallengeExpired(timestamp)) {
    return { error: 'Challenge expired' };
  }

  const message = `${nonce}:${timestamp}`;
  const valid = await verifyWalletSignature(message, signature, publicKey);
  if (!valid) return { error: 'Invalid signature' };

  const { data: profile, error: upsertError } = await supabase
    .from('profiles')
    .upsert(
      {
        wallet_address: publicKey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (upsertError || !profile) {
    return { error: 'Failed to create/update profile' };
  }

  const [accessToken, { token: refreshToken }] = await Promise.all([
    createAccessToken(profile.id, publicKey),
    createRefreshToken(profile.id, deviceInfo),
  ]);

  return {
    profileId: profile.id,
    wallet: publicKey,
    accessToken,
    refreshToken,
    expiresIn: 15 * 60, // 15 min in seconds
  };
}

export async function authenticateWithRefreshToken(
  refreshToken: string
): Promise<AuthResult | { error: string }> {
  const result = await consumeRefreshToken(refreshToken);
  if (!result) return { error: 'Invalid or expired refresh token' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, wallet_address')
    .eq('id', result.profileId)
    .single();

  if (!profile) return { error: 'Profile not found' };

  const [accessToken, { token: newRefreshToken }] = await Promise.all([
    createAccessToken(profile.id, profile.wallet_address),
    createRefreshToken(profile.id),
  ]);

  return {
    profileId: profile.id,
    wallet: profile.wallet_address,
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: 15 * 60,
  };
}

export { verifyAccessToken };
