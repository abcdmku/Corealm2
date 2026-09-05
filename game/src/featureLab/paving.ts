import { collectPavingStamps, DEFAULT_WORLD_SEED } from "../app/worldSurface.js";
import { REGIONS } from "../content/regions.js";
import { pavingStampFromRect, type PavingStamp, type WorldScene } from "../render/scene.js";

const authoredPaving = REGIONS.flatMap((region) => region.settlement?.paving ?? []);
const productionStamps = collectPavingStamps();

/** Twelve-metre samples of the three production pavements, separated by four metres of grass. */
export const PAVING_LAB_PATCHES = ([
  { id: "stone", sourcePavingId: "coldbrace_pave_square", centre: [-16, -12] },
  { id: "brick", sourcePavingId: "highcairn_yard", centre: [0, -12] },
  { id: "plank", sourcePavingId: "rootfall_paving_green", centre: [16, -12] },
] as const).map((patch) => {
  const authored = authoredPaving.find((paving) => paving.id === patch.sourcePavingId);
  if (!authored) throw new Error(`The paving lab requires production pavement ${patch.sourcePavingId}`);
  const rect = pavingStampFromRect(authored.rect);
  const source = productionStamps.find((stamp) =>
    stamp.centre[0] === rect.centre[0] && stamp.centre[1] === rect.centre[1]
    && stamp.halfExtents[0] === rect.halfExtents[0] && stamp.halfExtents[1] === rect.halfExtents[1]);
  if (!source || source.surface !== patch.id) {
    throw new Error(`Production pavement ${patch.sourcePavingId} must resolve to ${patch.id}`);
  }
  const centre = patch.centre;
  // Crop and translate the actual stamp. Its material selection and edge treatment stay intact.
  const stamp: PavingStamp = { ...source, centre, halfExtents: [6, 6] };
  return {
    id: patch.id,
    sourcePavingId: authored.id,
    assetId: authored.assetId,
    sourceCentre: source.centre,
    centre,
    stamp,
  };
});

/** Called after the shared height lattice exists and before the terrain chunks are shaded. */
export function preparePavingLabSurface(scene: WorldScene): typeof PAVING_LAB_PATCHES {
  scene.setGroundStamps({
    roads: [], water: [], seed: DEFAULT_WORLD_SEED,
    paving: PAVING_LAB_PATCHES.map((patch) => patch.stamp),
  });
  return PAVING_LAB_PATCHES;
}
