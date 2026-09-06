import type { Vec3 } from "../contracts.js";
import type { WorldScene } from "../render/scene.js";
import type { AssetRegistry } from "../render/assets.js";
import type { RegionalPackDef } from "../content/regionalPacks.js";
import { createRpgRegionalPackCatalogue } from "../content/rpgRegionalPacks.js";
import { assembleRegionalPack, type RegionalPackCatalogue } from "./regionalPackEntities.js";
import { auditRegionalPack, type RegionalPackAuditOptions, type RegionalPackAuditResult } from "./regionalPackAudit.js";

export interface RegionalPackWorldAuditPorts {
  readonly scene: Pick<WorldScene, "sampleWorld" | "meshHeightAt">;
  readonly assets: Pick<AssetRegistry, "entry" | "baseY">;
  /** Pass Navigation.findPath directly. The debug API rounds coordinates for presentation. */
  readonly findPath: (from: Vec3, to: Vec3) => readonly Vec3[] | null;
  readonly resolveSolid: (desired: Vec3, from: Vec3, radius: number) => Vec3;
  readonly forestOverlaps: (position: Vec3, radius: number) => readonly string[];
  /** Move the production residency centre here and wait until the generated forest tile and
   * trunk registry cover this whole reservation. Return false on missing/incomplete coverage. */
  readonly preparePack: (pack: RegionalPackDef) => Promise<boolean>;
}

/** Run serially on the real generated world. It does not move saved creatures, edit terrain,
 * switch off collisions, fake a plane, or register the candidate population. Root controls
 * residency through preparePack and can restore its initial camera/player after the audit. */
export async function auditRegionalPackWorld(
  ports: RegionalPackWorldAuditPorts,
  options: RegionalPackAuditOptions & { readonly packIds?: readonly string[] } = {},
  suppliedCatalogue?: RegionalPackCatalogue,
): Promise<{ accepted: boolean; packs: readonly RegionalPackAuditResult[] }> {
  const catalogue = suppliedCatalogue ?? createRpgRegionalPackCatalogue((id) => {
    const entry = ports.assets.entry(id);
    return entry?.base ? { size: entry.size, base: entry.base } : null;
  }, options.packIds);
  const results: RegionalPackAuditResult[] = [];
  for (const pack of catalogue.packs) {
    if (options.packIds && !options.packIds.includes(pack.id)) continue;
    if (!await ports.preparePack(pack)) {
      results.push({ packId: pack.id, accepted: false, checkedRoutes: 0, sampledPoints: 0,
        failures: [{ kind: "incomplete-world-residency", memberId: "", position: [pack.centre[0], 0, pack.centre[1]] }] });
      continue;
    }
    const assembly = assembleRegionalPack(pack.id, {
      heightAt: (x, z) => ports.scene.meshHeightAt(x, z), baseY: (id) => ports.assets.baseY(id),
      assetSize: (id) => ports.assets.entry(id)?.size ?? null,
    }, {}, catalogue);
    // Per-pack cache retains exact coordinates. A sample used by several residents should not
    // resample the same generated terrain or repeat its water-contour lookup thousands of times.
    const surfaces = new Map<string, ReturnType<typeof ports.scene.sampleWorld>>();
    results.push(auditRegionalPack(assembly, {
      sample: (x, z) => {
        const key = `${x},${z}`;
        let sample = surfaces.get(key);
        if (!sample) { sample = ports.scene.sampleWorld(x, z); surfaces.set(key, sample); }
        return { regionId: sample.playable ? sample.semanticRegion : null, height: sample.height,
          slopeDegrees: sample.slope === null ? NaN : Math.atan(sample.slope) * 180 / Math.PI,
          // sampleWorld identifies the solved closed-water polygon. Any intersection is rejected.
          waterDepth: sample.waterBodyId ? 1 : 0 };
      },
      path: (from, to) => ports.findPath(
        [from[0], ports.scene.meshHeightAt(from[0], from[2]), from[2]],
        [to[0], ports.scene.meshHeightAt(to[0], to[2]), to[2]],
      ),
      clearance: (x, z, radius) => {
        const position: Vec3 = [x, ports.scene.meshHeightAt(x, z), z];
        const resolved = ports.resolveSolid(position, position, radius);
        return Math.hypot(resolved[0] - x, resolved[2] - z) <= 0.001
          && ports.forestOverlaps(position, radius).length === 0;
      },
    }, options));
  }
  return { accepted: results.length > 0 && results.every((row) => row.accepted), packs: results };
}
