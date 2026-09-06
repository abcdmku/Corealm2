import { describe, expect, it } from "vitest";
import { ccAssetCredits, validateCcAssetPack } from "../tools/lib/cc-asset-license.js";
import { validateManifestPack } from "../tools/gen-docs.js";
import { validateGatheringManifestProvenance } from "../game/src/content/validateGatheringProduction.js";

const fixture = (shareAlike = true) => ({
  id: "source-creature", name: "Original creature", author: "Original artist; animator",
  source: "https://opengameart.org/content/source-creature", archiveSha256: "a".repeat(64),
  license: shareAlike ? "CC-BY-SA-3.0" : "CC-BY-3.0",
  derivativeLicense: shareAlike ? "CC-BY-SA-3.0" : "CC-BY-3.0",
  licenseUrl: `https://creativecommons.org/licenses/${shareAlike ? "by-sa" : "by"}/3.0/`,
  attribution: "Original creature by Original artist, animated by animator.",
  derivation: "Converted the complete source rig to GLB and adapted its clips.",
});

describe("explicit Creative Commons asset provenance", () => {
  it.each([true, false])("accepts complete pinned metadata, share-alike=%s", (shareAlike) => {
    const pack = fixture(shareAlike);
    expect(() => validateCcAssetPack(pack)).not.toThrow();
    expect(() => validateManifestPack(pack, { generatedAt: "", packs: [pack], assets: [] })).not.toThrow();
    expect(validateGatheringManifestProvenance({ packs: [pack], assets: [] }, new Map())).toEqual([]);
    const credits = ccAssetCredits(pack);
    for (const value of [pack.author, pack.source, pack.attribution, pack.derivation, pack.licenseUrl]) expect(credits).toContain(value);
    expect(credits).toContain(`Adapted asset license: [${pack.derivativeLicense}]`);
  });
  it.each(["name", "author", "source", "attribution", "derivation", "derivativeLicense"])("rejects missing %s", (field) => {
    expect(() => validateCcAssetPack({ ...fixture(), [field]: "  " })).toThrow();
  });
  it.each(["CC-BY-NC-3.0", "CC-BY-ND-3.0", "CC-BY-SA-4.0", "CC0-1.0"])("does not infer permission for %s", (license) => {
    expect(() => validateCcAssetPack({ ...fixture(), license })).toThrow("unsupported attribution license");
  });
  it("rejects a mismatched deed and share-alike relicensing", () => {
    const mismatchedDeed = { ...fixture(), licenseUrl: fixture(false).licenseUrl };
    const relicensed = { ...fixture(), derivativeLicense: "LicenseRef-Corealm-Original" };
    expect(() => validateCcAssetPack(mismatchedDeed)).toThrow("licenseUrl");
    expect(() => validateCcAssetPack(relicensed)).toThrow("derivativeLicense");
    const invalid = { ...fixture(), derivativeLicense: "CC0-1.0" };
    expect(validateGatheringManifestProvenance({ packs: [invalid], assets: [] }, new Map()).join(" ")).toContain("derivativeLicense");
  });
  it.each(["", "A".repeat(64), "a".repeat(63)])("preserves the archive pin requirement", (archiveSha256) => {
    expect(() => validateCcAssetPack({ ...fixture(), archiveSha256 })).toThrow("archive SHA-256");
  });
  it.each(["file:///source.blend", "https://", "https://user:secret@example.org/source"])("rejects unsuitable source %s", (source) => {
    expect(() => validateCcAssetPack({ ...fixture(), source })).toThrow();
  });
});
