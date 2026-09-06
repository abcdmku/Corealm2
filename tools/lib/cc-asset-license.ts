import type { AssetPack } from "../../game/src/render/assets.js";
import { validateCcAssetPack } from "../../game/src/content/assetLicenses.js";
export { isSupportedCcAttributionLicense, validateCcAssetPack } from "../../game/src/content/assetLicenses.js";

const prose = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]<>|])/g, "\\$1");

export function ccAssetCredits(pack: AssetPack): string {
  validateCcAssetPack(pack);
  return [
    `### ${prose(pack.name)}`,
    "",
    `Author: ${prose(pack.author)}. Source: [${prose(pack.name)}](<${pack.source}>).`,
    "",
    `Attribution: ${prose(pack.attribution)}`,
    "",
    `Source license: [${pack.license}](${pack.licenseUrl}). Adapted asset license: [${pack.derivativeLicense}](${pack.licenseUrl}).`,
    "",
    `Changes: ${prose(pack.derivation)}`,
  ].join("\n");
}

