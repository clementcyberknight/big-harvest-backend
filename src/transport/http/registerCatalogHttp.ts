import type { TemplatedApp } from "uWebSockets.js";
import { CROP_CONFIG } from "../../modules/crop/crop.config.js";
import { ANIMAL_SPECIES } from "../../modules/animal/animal.config.js";
import { CRAFT_RECIPES } from "../../modules/crafting/crafting.recipes.js";
import { REFERENCE_GOLD } from "../../modules/economy/referencePrices.js";
import {
  STARTER_GOLD,
  STARTER_WHEAT_SEEDS,
  STARTER_PLOT_IDS,
  PRICE_MICRO_PER_GOLD,
  MAX_SYNDICATE_MEMBERS,
  IDOL_PUNISH_GOLD,
} from "../../config/constants.js";
import {
  LOAN_LTV_NUMERATOR,
  LOAN_LTV_DENOMINATOR,
  LOAN_TERM_APR_BPS,
  LOAN_TERM_MS,
  LOAN_PENALTY_BPS_PER_DAY,
  LOAN_GRACE_MS,
  LOAN_PLOT_COLLATERAL_GOLD,
} from "../../config/loan.constants.js";
import { applyCors, sendJson } from "./http.util.js";

/** Serialisable catalog payload — built once at startup, cached forever. */
const CATALOG = buildCatalog();

function buildCatalog() {
  // --- Seeds (buyable from treasury) ---
  const seeds = Object.entries(CROP_CONFIG).map(([cropId, def]) => ({
    id: `seed:${cropId}`,
    cropId,
    buyGold: REFERENCE_GOLD[`seed:${cropId}`]?.buy ?? 0,
    growTimeSec: def.growTimeSec,
    outputQty: def.output,
    harvestItemId: def.harvestItemId ?? cropId,
  }));

  // --- Crops / produce (sellable to treasury) ---
  const crops = Object.entries(CROP_CONFIG).map(([cropId, def]) => {
    const harvestItem = def.harvestItemId ?? cropId;
    return {
      cropId,
      harvestItemId: harvestItem,
      sellGold: REFERENCE_GOLD[harvestItem]?.sell ?? 0,
      basePriceCents: def.basePriceCents,
      growTimeSec: def.growTimeSec,
      outputQty: def.output,
    };
  });

  // --- Animals (buyable, produce items) ---
  const animals = Object.entries(ANIMAL_SPECIES).map(([id, def]) => ({
    speciesId: id,
    buyGold: REFERENCE_GOLD[`animal:${id}`]?.buy ?? 0,
    produceItem: def.produceItem,
    produceIntervalSec: def.produceIntervalSec,
    feedItem: def.feedItem,
    feedPerAnimal: def.feedPerAnimal,
    maxProducePerHarvest: def.maxProducePerHarvest,
    sellGold: REFERENCE_GOLD[def.produceItem]?.sell ?? 0,
  }));

  // --- Tools (buyable from treasury, required for crafting) ---
  const tools = Object.entries(REFERENCE_GOLD)
    .filter(([k]) => k.startsWith("tool:"))
    .map(([field, ref]) => ({
      id: field,
      buyGold: ref.buy,
    }));

  // --- Crafting recipes ---
  const recipes = Object.entries(CRAFT_RECIPES).map(([id, def]) => ({
    recipeId: id,
    ingredients: def.ingredients,
    outputItem: def.outputItem,
    outputQty: def.outputQty,
    craftTimeSec: def.craftTimeSec,
    requiredTool: def.toolField,
    sellGold: REFERENCE_GOLD[def.outputItem]?.sell ?? 0,
  }));

  // --- All sellable produce (treasury buy-back prices) ---
  const sellable = Object.entries(REFERENCE_GOLD)
    .filter(
      ([k, v]) =>
        v.sell > 0 &&
        !k.startsWith("seed:") &&
        !k.startsWith("tool:") &&
        !k.startsWith("animal:"),
    )
    .map(([itemId, ref]) => ({ itemId, sellGold: ref.sell }));

  // --- Sugar (buyable misc item) ---
  const misc = [
    {
      id: "sugar",
      buyGold: REFERENCE_GOLD["sugar"]?.buy ?? 0,
      sellGold: REFERENCE_GOLD["sugar"]?.sell ?? 0,
    },
  ];

  // --- Plots / Land ---
  const plots = {
    starterPlots: STARTER_PLOT_IDS.length,
    starterPlotIds: STARTER_PLOT_IDS,
    purchasable: false,
    note: "Plots are only acquired via the new-player starter grant. Additional plots can be unlocked in future updates.",
    loanCollateralValueGold: LOAN_PLOT_COLLATERAL_GOLD,
  };

  // --- Starter grant ---
  const onboarding = {
    starterGold: STARTER_GOLD,
    starterWheatSeeds: STARTER_WHEAT_SEEDS,
    starterPlots: STARTER_PLOT_IDS.length,
    newPlayerAchievement: "new_player",
    triggerNote:
      "Grant fires lazily on first game action, not on WebSocket connect.",
  };

  // --- Loan terms ---
  const loans = {
    ltvNumerator: LOAN_LTV_NUMERATOR,
    ltvDenominator: LOAN_LTV_DENOMINATOR,
    maxPrincipalFormula:
      "floor(collateralGold * LTV_NUMERATOR / LTV_DENOMINATOR)",
    maxPrincipalExample: `e.g. 200g collateral → max ${Math.floor((200 * LOAN_LTV_NUMERATOR) / LOAN_LTV_DENOMINATOR)}g loan`,
    termMs: LOAN_TERM_MS,
    termDays: LOAN_TERM_MS / 86_400_000,
    aprBps: LOAN_TERM_APR_BPS,
    aprPercent: LOAN_TERM_APR_BPS / 100,
    penaltyBpsPerDayOverdue: LOAN_PENALTY_BPS_PER_DAY,
    graceMs: LOAN_GRACE_MS,
    graceDays: LOAN_GRACE_MS / 86_400_000,
    plotCollateralGold: LOAN_PLOT_COLLATERAL_GOLD,
  };

  // --- Syndicate constants ---
  const syndicates = {
    maxMembers: MAX_SYNDICATE_MEMBERS,
    creatorMinLevel: 13,
    idolPunishGold: IDOL_PUNISH_GOLD,
  };

  // --- Pricing system ---
  const pricing = {
    microGoldPerGold: PRICE_MICRO_PER_GOLD,
    note: "All prices are base / reference values in whole gold. Live prices are dynamic and returned via BUY_OK / SELL_OK priceMicro field.",
    dynamicTickMs: 7000,
    demandClamp: [0.25, 4],
    scarcityClamp: [0.5, 3],
    volatilityClamp: [0.85, 1.35],
  };

  return {
    seeds,
    crops,
    animals,
    tools,
    recipes,
    sellable,
    misc,
    plots,
    onboarding,
    loans,
    syndicates,
    pricing,
  };
}

export function registerCatalogHttp(app: TemplatedApp): void {
  app.get("/catalog", (res) => {
    res.onAborted(() => {});
    applyCors(res);
    sendJson(res, "200 OK", CATALOG);
  });
}
