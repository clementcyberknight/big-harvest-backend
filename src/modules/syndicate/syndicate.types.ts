export type SyndicateVisibility = "public" | "private";

export type SyndicateRole = "owner" | "officer" | "member";

export type SyndicateSummary = {
  id: string;
  name: string;
  description: string;
  visibility: SyndicateVisibility;
  levelPreferenceMin: number;
  goldPreferenceMin: number;
  members: number;
  shieldExpiresAtMs: number;
  idolLevel: number;
  emblemId: string;
};

export type SyndicateMember = {
  userId: string;
  role: SyndicateRole;
  level: number;
  lastSeenAtMs: number;
};

export type SyndicateView = SyndicateSummary & {
  ownerId: string;
  createdAtMs: number;
  joinRequests?: { userId: string; requestedAtMs: number }[];
  membersList: SyndicateMember[];
};

export type CreateSyndicateCommand = {
  requestId: string;
  name: string;
  description: string;
  visibility: SyndicateVisibility;
  levelPreferenceMin: number;
  goldPreferenceMin: number;
  emblemId: string;
};

export type ListSyndicatesQuery = {
  includePrivate?: boolean;
};

export type RequestJoinCommand = {
  requestId: string;
  syndicateId: string;
};

export type AcceptJoinCommand = {
  requestId: string;
  syndicateId: string;
  userId: string;
};

export type DepositBankCommand =
  | { requestId: string; syndicateId: string; kind: "gold"; amount: number }
  | { requestId: string; syndicateId: string; kind: "item"; itemId: string; amount: number };

export type BuyShieldCommand = {
  requestId: string;
  syndicateId: string;
  goldPaid: number;
};

export type AttackSyndicateCommand = {
  requestId: string;
  targetSyndicateId: string;
  attackPower: number;
  lootGoldMax: number;
  lootItemId?: string;
  lootItemMax?: number;
};

export type IdolContributeCommand = {
  requestId: string;
  syndicateId: string;
  requestKey: string;
  itemId: string;
  amount: number;
};

export type LeaveSyndicateCommand = {
  requestId: string;
};

export type DisbandSyndicateCommand = {
  requestId: string;
  syndicateId: string;
};

export type SyndicateChatSendCommand = {
  requestId: string;
  syndicateId: string;
  text: string;
};

export type ViewSyndicateMemberQuery = {
  syndicateId: string;
};

export type ViewBankQuery = {
  syndicateId: string;
};

export type ViewContributionQuery = {
  syndicateId: string;
  userId: string;
};
