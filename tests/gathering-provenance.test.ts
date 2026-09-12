import { describe, expect, it } from "vitest";
import { validateGatheringManifestProvenance, type GatheringProductionAssetManifest } from "../game/src/content/validateGatheringProduction.js";

function fixture() {
  const generatorSha256 = "a".repeat(64);
  const sourceSha256 = "b".repeat(64);
  const upstream = { id: "dexsoft-rocks-free", source: "https://assetstore.unity.com/packages/3d/props/exterior/rocks-free-pack-98219", license: "Standard Unity Asset Store EULA" };
  const manifest: GatheringProductionAssetManifest = {
    packs: [upstream, {
      id: "corealm-original-equipment", source: "tools/build-corealm-equipment.ts", license: "LicenseRef-Corealm-Original", generatorSha256,
    }, {
      id: "corealm-original-ground-ores", source: "tools/build-ground-ores.ts",
      license: "Derivative geometry and material maps from DEXSOFT, under its existing Standard Unity Asset Store EULA.", generatorSha256,
      sourceReference: { assetId: "rocks_free_essence_node", file: "game/public/assets/models/magic/rocks_free_essence_node.glb", pack: upstream.id,
        sha256: sourceSha256, license: upstream.license, upstreamLicense: upstream.license, upstreamSource: upstream.source },
    }],
    assets: [{ id: "rocks_free_essence_node", pack: upstream.id, file: "models/magic/rocks_free_essence_node.glb" }],
  };
  const hashes = new Map([["tools/build-corealm-equipment.ts", generatorSha256], ["tools/build-ground-ores.ts", generatorSha256],
    ["game/public/assets/models/magic/rocks_free_essence_node.glb", sourceSha256]]);
  return { manifest, hashes };
}

describe("gathering build provenance", () => {
  it('accepts only the exact user-requested bridge upload without inventing a public license', () => {
    const pack = { id: 'user-supplied-medieval-bridge', source: 'User attachment medieval_bridge.zip',
      license: 'User-supplied; license not provided', archiveSha256: '1c1fdc8a4e9534e4740f13033790c79fb23439a532041e7ff78c1dcca7ddb073' };
    expect(validateGatheringManifestProvenance({packs:[pack],assets:[]}, new Map())).toEqual([]);
    for (const changed of [{...pack, archiveSha256:'a'.repeat(64)}, {...pack,id:'other-upload'}, {...pack,source:'Unknown file'}]) {
      expect(validateGatheringManifestProvenance({packs:[changed],assets:[]}, new Map()).length).toBeGreaterThan(0);
    }
  });
  it('accepts declared Fab Standard assets only with a Fab listing URL', () => {
    const { manifest, hashes } = fixture();
    const pack = { id: 'fab-armor', source: 'https://www.fab.com/listings/122fd7bf-6f12-4304-a930-cccbbacdaebc', license: 'Fab Standard License' };
    const withFab = { ...manifest, packs: [...manifest.packs, pack] };
    expect(validateGatheringManifestProvenance(withFab, hashes)).toEqual([]);
    for (const source of ['https://example.com/asset', 'https://fab.com.evil.test/listings/122fd7bf-6f12-4304-a930-cccbbacdaebc', 'Epic Games Launcher VaultCache']) {
      pack.source = source;
      expect(validateGatheringManifestProvenance(withFab, hashes).some(problem => problem.includes('unsupported license'))).toBe(true);
    }
  });
  it("accepts the original ore generator only with its measured source hash", () => {
    const { manifest, hashes } = fixture();
    const ore = manifest.packs[2]!;
    ore.license = "LicenseRef-Corealm-Original";
    delete ore.sourceReference;
    expect(validateGatheringManifestProvenance(manifest, hashes)).toEqual([]);
    hashes.set(ore.source, "c".repeat(64));
    expect(validateGatheringManifestProvenance(manifest, hashes).join("\n")).toContain("generator SHA-256 does not match");
  });
  it("accepts verified original equipment and the pinned DEXSOFT derivative without relabeling its license", () => {
    const { manifest, hashes } = fixture();
    expect(validateGatheringManifestProvenance(manifest, hashes)).toEqual([]);
    expect(manifest.packs[2]!.license).toContain("Standard Unity Asset Store EULA");
  });
  it("rejects a syntactically valid generator pin that differs from measured bytes", () => {
    const { manifest, hashes } = fixture();
    hashes.set("tools/build-corealm-equipment.ts", "c".repeat(64));
    expect(validateGatheringManifestProvenance(manifest, hashes).join("\n")).toContain("generator SHA-256 does not match");
  });
  it("rejects missing measured generator bytes", () => {
    const { manifest, hashes } = fixture();
    hashes.delete("tools/build-ground-ores.ts");
    expect(validateGatheringManifestProvenance(manifest, hashes).join("\n")).toContain("generator SHA-256 does not match");
  });
  it("rejects a missing upstream pack even when reference file hashes match", () => {
    const { manifest, hashes } = fixture();
    const missing = { ...manifest, packs: manifest.packs.filter((pack) => pack.id !== "dexsoft-rocks-free") };
    expect(validateGatheringManifestProvenance(missing, hashes).join("\n")).toContain("no verified licensed upstream reference");
  });
  it("rejects changed reference bytes and a mismatched source asset path", () => {
    const { manifest, hashes } = fixture();
    hashes.set("game/public/assets/models/magic/rocks_free_essence_node.glb", "c".repeat(64));
    expect(validateGatheringManifestProvenance(manifest, hashes).join("\n")).toContain("no verified licensed upstream reference");
    const changed = { ...manifest, assets: [{ ...manifest.assets[0]!, file: "models/other.glb" }] };
    expect(validateGatheringManifestProvenance(changed, fixture().hashes).join("\n")).toContain("no verified licensed upstream reference");
  });
  it("does not admit arbitrary original generators or derivative license prose", () => {
    const { manifest, hashes } = fixture();
    manifest.packs[1]!.source = "tools/unreviewed.ts";
    hashes.set("tools/unreviewed.ts", "a".repeat(64));
    manifest.packs[2]!.id = "other-derivative";
    const problems = validateGatheringManifestProvenance(manifest, hashes);
    expect(problems.filter((problem) => problem.includes("unsupported license"))).toHaveLength(2);
  });
});
