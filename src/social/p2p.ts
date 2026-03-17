import { supabase } from "../db/supabase.js";
import { executeTransfer } from "../economy/ledger.js";
import { FarmingEngine } from "../game/farming.js";

export class P2PEngine {
  static async transferFunds(
    senderProfileId: string,
    targetWallet: string,
    amount: number,
  ) {
    if (amount <= 0) throw new Error("Invalid amount");

    // Resolve target wallet to profile ID
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("wallet_address", targetWallet)
      .maybeSingle();

    if (!targetProfile) throw new Error("Target player not found");
    if (targetProfile.id === senderProfileId)
      throw new Error("Cannot transfer to yourself");

    const success = await executeTransfer({
      fromType: "player",
      fromId: senderProfileId,
      toType: "player",
      toId: targetProfile.id,
      amount,
      reason: "p2p_transfer",
    });

    if (!success) throw new Error("Insufficient funds");

    return { targetProfileId: targetProfile.id };
  }

  static async transferItems(
    senderProfileId: string,
    targetWallet: string,
    itemId: string,
    qty: number,
  ) {
    if (qty <= 0) throw new Error("Invalid quantity");

    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("wallet_address", targetWallet)
      .maybeSingle();

    if (!targetProfile) throw new Error("Target player not found");
    if (targetProfile.id === senderProfileId)
      throw new Error("Cannot transfer to yourself");

    const { data: senderInventory } = await supabase
      .from("inventory")
      .select("id, quantity")
      .eq("profile_id", senderProfileId)
      .eq("item_id", itemId)
      .maybeSingle();

    if (!senderInventory || senderInventory.quantity < qty) {
      throw new Error("Not enough items in inventory");
    }

    // Debit sender
    await supabase
      .from("inventory")
      .update({ quantity: senderInventory.quantity - qty })
      .eq("id", senderInventory.id);

    // Credit receiver
    await FarmingEngine.incrementInventory(targetProfile.id, itemId, qty);

    return { targetProfileId: targetProfile.id };
  }
}
