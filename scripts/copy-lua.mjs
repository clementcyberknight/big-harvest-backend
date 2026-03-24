import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src", "infrastructure", "redis", "scripts");
const destDir = join(root, "dist", "infrastructure", "redis", "scripts");

if (!existsSync(srcDir)) {
  console.error("Missing Lua source dir:", srcDir);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
for (const name of [
  "plant.lua",
  "harvest.lua",
  "onboarding.lua",
  "treasurySell.lua",
  "treasuryBuy.lua",
  "loanOriginate.lua",
  "loanRepay.lua",
  "animalFeed.lua",
  "animalHarvest.lua",
  "craftStart.lua",
  "craftClaim.lua",
]) {
  cpSync(join(srcDir, name), join(destDir, name));
}
