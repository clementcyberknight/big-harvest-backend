import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

/**
 * Verifies an ed25519 detached signature over the exact UTF-8 message bytes.
 * Mobile must sign the same string returned from GET /auth/challenge (e.g. wallet adapter signMessage).
 */
export function verifySolanaSignature(
  messageUtf8: string,
  signatureBase58: string,
  walletAddressBase58: string,
): boolean {
  let pk: PublicKey;
  try {
    pk = new PublicKey(walletAddressBase58);
  } catch {
    return false;
  }
  let sig: Uint8Array;
  try {
    sig = bs58.decode(signatureBase58);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const msg = new TextEncoder().encode(messageUtf8);
  return nacl.sign.detached.verify(msg, sig, pk.toBytes());
}
