import { z } from "zod";

const requestIdSchema = z.string().min(8).max(128);

export const createSyndicateSchema = z.object({
  requestId: requestIdSchema,
  name: z.string().trim().min(3).max(28),
  description: z.string().trim().min(0).max(240).default(""),
  visibility: z.enum(["public", "private"]),
  levelPreferenceMin: z.coerce.number().int().min(1).max(100).default(1),
  goldPreferenceMin: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
});

export const requestJoinSchema = z.object({
  requestId: requestIdSchema,
  syndicateId: z.string().min(1).max(64),
});

export const acceptJoinSchema = z.object({
  requestId: requestIdSchema,
  syndicateId: z.string().min(1).max(64),
  userId: z.string().min(1).max(128),
});

export const depositBankSchema = z.discriminatedUnion("kind", [
  z.object({
    requestId: requestIdSchema,
    syndicateId: z.string().min(1).max(64),
    kind: z.literal("gold"),
    amount: z.coerce.number().int().positive().max(1_000_000_000),
  }),
  z.object({
    requestId: requestIdSchema,
    syndicateId: z.string().min(1).max(64),
    kind: z.literal("item"),
    itemId: z.string().min(1).max(64),
    amount: z.coerce.number().int().positive().max(1_000_000_000),
  }),
]);

export const buyShieldSchema = z.object({
  requestId: requestIdSchema,
  syndicateId: z.string().min(1).max(64),
  goldPaid: z.coerce.number().int().positive().max(1_000_000_000),
});

export const attackSyndicateSchema = z.object({
  requestId: requestIdSchema,
  targetSyndicateId: z.string().min(1).max(64),
  attackPower: z.coerce.number().int().positive().max(1_000_000_000),
  lootGoldMax: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  lootItemId: z.string().min(1).max(64).optional(),
  lootItemMax: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
});

export const idolContributeSchema = z.object({
  requestId: requestIdSchema,
  syndicateId: z.string().min(1).max(64),
  requestKey: z.string().min(1).max(128),
  itemId: z.string().min(1).max(64),
  amount: z.coerce.number().int().positive().max(1_000_000_000),
});

export const leaveSyndicateSchema = z.object({
  requestId: requestIdSchema,
});

export const disbandSyndicateSchema = z.object({
  requestId: requestIdSchema,
  syndicateId: z.string().min(1).max(64),
});

export const syndicateChatSendSchema = z.object({
  requestId: requestIdSchema,
  syndicateId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(400),
});

export const viewSyndicateMemberSchema = z.object({
  syndicateId: z.string().min(1).max(64),
});

export const viewBankSchema = z.object({
  syndicateId: z.string().min(1).max(64),
});

export const viewContributionSchema = z.object({
  syndicateId: z.string().min(1).max(64),
  userId: z.string().min(1).max(128),
});
