import { describe, expect, it } from "vitest";
import { downloadName, formatBytes, isUploadType, repoPathOfSkinMap, sizeWarning } from "../devdocs/src/workspaces/art/creatures/skinFiles.js";

describe("skin file facts", () => {
  it("places a skin map under game/public/assets", () => {
    expect(repoPathOfSkinMap("skins/animal_deer/stag/animal_deer_mat.png")).toBe("game/public/assets/skins/animal_deer/stag/animal_deer_mat.png");
  });

  it("warns about a different size or aspect, not a match", () => {
    expect(sizeWarning({ width: 2048, height: 2048 }, { width: 2048, height: 2048 })).toBeUndefined();
    expect(sizeWarning({ width: 2048, height: 2048 }, { width: 1024, height: 1024 })).toBe("1024×1024, the model's map is 2048×2048: same aspect, it will be sampled at another resolution.");
    expect(sizeWarning({ width: 2048, height: 2048 }, { width: 2048, height: 1024 })).toBe("2048×1024, the model's map is 2048×2048: a different aspect stretches the paint across the UVs.");
  });

  it("formats sizes and names", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
    expect(downloadName("Stag · deer", "animal_deer_mat", "-uv")).toBe("Stag_deer-animal_deer_mat-uv.png");
    expect(isUploadType("image/webp")).toBe(true);
    expect(isUploadType("image/gif")).toBe(false);
  });
});
