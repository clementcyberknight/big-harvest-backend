/**
 * Solana wallet signature verification (Ed25519).
 */

import * as ed from '@noble/ed25519';
import bs58 from 'bs58';

const encoder = new TextEncoder();

/**
 * Verifies a Solana wallet signature.
 * @param message - Raw message that was signed (e.g. nonce string)
 * @param signatureBase58 - Base58-encoded signature from wallet
 * @param publicKeyBase58 - Base58-encoded Solana public key
 */
export async function verifyWalletSignature(
  message: string,
  signatureBase58: string,
  publicKeyBase58: string
): Promise<boolean> {
  try {
    const messageBytes = encoder.encode(message);
    const signature = bs58.decode(signatureBase58);
    const publicKey = bs58.decode(publicKeyBase58);

    if (signature.length !== 64 || publicKey.length !== 32) return false;

    return ed.verify(signature, messageBytes, publicKey);
  } catch {
    return false;
  }
}
