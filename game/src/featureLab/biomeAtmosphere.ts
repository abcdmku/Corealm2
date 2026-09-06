import { BIOME_LOOKS, type BiomeAtmosphere } from "../render/biomeAtmosphere.js";
import type { RegionId } from "../contracts.js";

/** Same view, assets and lighting for every production grade. */
export function createBiomeAtmosphereWorkbench(atmosphere: BiomeAtmosphere): void {
  const panel = document.createElement("label");
  panel.textContent = "Biome atmosphere ";
  panel.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:90;background:#171d20;color:#eee;padding:10px 14px;border:1px solid #788279;border-radius:6px;font:14px sans-serif";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Biome atmosphere");
  for (const [id, name] of [["neutral", "Neutral reference"], ...Object.entries(BIOME_LOOKS).map(([id, look]) => [id, look.name])]) {
    const option = document.createElement("option");
    option.value = id!; option.textContent = name!; select.append(option);
  }
  atmosphere.setPreview("neutral");
  select.addEventListener("change", () => atmosphere.setPreview(select.value as RegionId | "neutral"));
  panel.append(select); document.body.append(panel);
  (window as Window & { __biomeAtmosphereLab?: unknown }).__biomeAtmosphereLab = {
    getState: () => atmosphere.snapshot(),
  };
}
