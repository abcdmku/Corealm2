import { gzipSync } from "node:zlib";
import type { Mesh } from "three";
import type { Navigation } from "../../systems/navigation.js";
import { decodeNavigationArtifact, type NavigationArtifactMetadata } from "../../systems/navigationArtifact.js";

/**
 * The client's navmesh for a baked world: the artifact `tools/build-navmesh.ts` writes
 * (`corealm-navmesh.bin`), its gzip as the release serves it (`generated/corealm-navmesh.nav`), and
 * the release identity a client checks the `.nav` against (the fields of `virtual:corealm-release-navigation`).
 */
export interface ClientNavmesh {
  /** `corealm-navmesh.bin`: container header, metadata and the Detour mesh. */
  bin: Uint8Array;
  /** `generated/corealm-navmesh.nav`: `bin` gzipped at level 9, as `tools/lib/release-navigation.ts` emits it. */
  nav: Uint8Array;
  metadata: NavigationArtifactMetadata;
  release: { fingerprint: string; worldSeed: string; strategy: "solo" | "tiled"; sourceMeshes: number; sourceTriangles: number };
}

/** Serializes a built navmesh with the fingerprint of the geometry it was built from, exactly as the navmesh bake page does. */
export async function exportClientNavmesh(nav: Navigation, walkable: Mesh[], seed: number): Promise<ClientNavmesh> {
  const bin = await nav.exportArtifact(walkable, { worldSeed: seed });
  const { metadata } = await decodeNavigationArtifact(bin);
  if (metadata.settings.strategy !== "solo" && metadata.settings.strategy !== "tiled") throw new Error("Unexpected navmesh strategy");
  return { bin, nav: gzipSync(bin, { level: 9 }), metadata,
    release: { fingerprint: metadata.fingerprint, worldSeed: String(seed), strategy: metadata.settings.strategy,
      sourceMeshes: metadata.sourceMeshes, sourceTriangles: metadata.sourceTriangles } };
}
