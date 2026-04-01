export type BuyPlotCommand = {
  requestId: string;
};

export type BuyPlotResult = {
  plotId: number;
  goldSpent: number;
  totalOwnedPlots: number;
};

export type GameStatusPlotsData = {
  starterPlots: number;
  starterPlotIds: number[];
  purchasable: boolean;
  maxPlots: number;
  purchaseBaseGold: number;
  purchaseStepGold: number;
  pricingFormula: string;
  loanCollateralValueGold: number;
  note: string;
};
