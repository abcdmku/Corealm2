/**
 * A world a live server baked for itself, after its authors changed the world's geometry
 * (`worldTerrain`, `worldRegions`, `resourcePlacements`, dressing habitats, creature bodies).
 *
 * The build ships one baked world, pinned to the build's `generationRevision`. A server whose
 * geometry content differs bakes its own: the server world pack (terrain, solids, navmesh) into its
 * data directory, and the client world records, world manifest and navmesh into its file store under
 * the same `generated/...` paths the build uses. Each world descriptor then names the geometry
 * revision it runs (`WorldDescriptor.worldRevision`); a page whose build differs reloads onto the
 * server's files before its scene is built.
 */

/** Tables whose rows shape terrain, solids, navigation or scatter. A publish touching one starts a bake. */
export const GEOMETRY_TABLES = ["worldTerrain", "worldRegions", "resourcePlacements", "placements", "encounters", "creatureDefinitions", "resources", "items"] as const;

export type WorldBakeStatus = "queued" | "baking" | "ready" | "failed" | "superseded";

export interface ServerWorldBake {
  /** The geometry revision: see `worldGeometryRevision`. */
  revision: string;
  /** The content revision it was baked from. */
  catalogRevision: string;
  status: WorldBakeStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Per step, for the devdocs status line. */
  steps?: { name: "pack" | "records" | "navmesh" | "publish"; ms?: number; ok?: boolean }[];
  /** `generated/...` paths written to the file store: world records, `generated/world/manifest.json`, `generated/corealm-navmesh.nav`. */
  files?: string[];
  /** The navmesh fingerprint clients check the `.nav` against. */
  navFingerprint?: string;
  error?: string;
}

/**
 * The geometry revision of a server world: the build's code revision (its `generationRevision`,
 * which already covers every generation source file) combined with the hash of the geometry views
 * of the server's content. Equal code and equal geometry content give the same revision, so a server
 * whose content still matches the build runs the build's own world and bakes nothing.
 */
export async function worldGeometryRevision(codeRevision: string, geometryContentHash: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${codeRevision}\n${geometryContentHash}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
