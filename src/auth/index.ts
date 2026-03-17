/**
 * Auth service: wallet verification + token issuance.
 */

import { randomUUID } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { verifyWalletSignature } from './verify.js';
import { Treasury } from '../economy/treasury.js';
import { PricingEngine } from '../economy/pricing.js';
import { executeTransfer } from '../economy/ledger.js';
import { GAME_CROPS } from '../market/crops.js';
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

  // Try to find the profile first
  let { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('wallet_address', publicKey)
    .single();


  // If missing, create it
  if (!profile) {
    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert({ wallet_address: publicKey, updated_at: new Date().toISOString() })
      .select('id')
      .single();

    if (insertError || !newProfile) {
      return { error: 'Failed to create profile' };
    }
    profile = newProfile;

    // Disburse Dynamic Sign-Up Bonus via Treasury Ledger
    try {
      // 1. Calculate dynamic costs
      const plotPrice = await PricingEngine.getPlotPrice('starter');
      let cheapestSeed = 999999;
      for (const crop of GAME_CROPS) {
        const state = await PricingEngine.getState(crop.id);
        if (state && state.current_buy_price < cheapestSeed) {
          cheapestSeed = state.current_buy_price;
        }
      }
      if (cheapestSeed === 999999) cheapestSeed = 10; // Fallback

      // 2 * plot + 2 * seeds
      const signupBonus = (2 * plotPrice) + (2 * cheapestSeed);

      // 2. Transfer from Treasury to Player using Ledger
      const treasuryId = await Treasury.getId();
      await executeTransfer({
        fromType: 'treasury', 
        fromId: treasuryId,
        toType: 'player', 
        toId: newProfile.id,
        amount: signupBonus,
        reason: 'signup_bonus',
        metadata: {
          plot_price: plotPrice,
          seed_price: cheapestSeed
        }
      });
      console.log(`Disbursed dynamic sign-up bonus: ${signupBonus} tokens to new player ${profile.id}`);
    } catch (err) {
      console.error('Failed to issue sign-up bonus:', err);
      // We don't fail the auth if bonus fails, but we log the critical error
    }
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
