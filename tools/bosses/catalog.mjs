/**
 * Source rhino animation catalogue. Walk and Run remain separate gaits; Get_Hit is a real clip.
 * tools/rebuild-creature-motion.ts additionally resolves duplicate FBX spine names by source node
 * identity. Its staged output must pass the feature lab before promotion to production assets.
 */

/**
 * Recorded in the manifest so the pack's provenance travels with the assets.
 *
 * Same shape and the same licence string as the other imported Unity packs, which is what
 * `content/validateGatheringProduction.ts` and `tools/gen-docs.ts` both match on. No archive hash:
 * there is no redistributable archive of ours to hash, so each asset row carries its own `sha256`
 * and that is the audit.
 */
export const BOSS_PACK = {
  id: "fantasy-rhino",
  name: "Fantasy Rhino",
  author: "Maksim Bugrimov",
  // TODO: pin the exact package URL once the purchasing account can be checked. This search URL
  // resolves to the product and is a real HTTPS source, but it is not the permanent product id.
  source: "https://assetstore.unity.com/?q=Fantasy%20Rhino",
  license: "Standard Unity Asset Store EULA; project owner must confirm entitlement",
};

/**
 * Source-unit correction, on top of the converter's centimetres-to-metres.
 *
 * MEASURED, not guessed. Converted at the animal pack's plain 0.01 this rig came out 10.47 x 17.07
 * x 26.33 m — a rhinoceros the size of a cathedral. A tenth of that is 1.05 x 1.71 x 2.63 m, which
 * is a real rhino's build, and it sits correctly beside `animal_bear` at 2.46 m and
 * `animal_aurochs` at 2.53 m. Bosses are then drawn at 1.6x by `world/regionBuilder.ts`, so what
 * the player meets is about 4.2 m of it.
 */
const RHINO_EXTRA_SCALE = 0.1;

/**
 * Emissive strength, per element.
 *
 * The map is the same seams at the same brightness in all three; what differs is how much the
 * element wants to bloom. Water is the source's own ice-blue and needs no help, air is the
 * lightest hue and washes out fastest against a bright sky, and earth is the darkest and needs the
 * most push to read as lit rather than merely painted.
 */
export const BOSSES = [
  {
    id: "boss_rhino_air",
    extraScale: RHINO_EXTRA_SCALE,
    is: "roc",
    tags: ["boss", "roc", "tempest", "air", "wind", "elemental", "monster", "territorial"],
    clips: [["Rhino@Idle", "Idle"], ["Rhino@Walk", "Walk"], ["Rhino@Run", "Run"], ["Rhino@Attack", "Attack"], ["Rhino@Get_Hit", "Hit"], ["Rhino@Dead", "Death"]],
    emissiveIntensity: 1.35,
  },
  {
    id: "boss_rhino_earth",
    extraScale: RHINO_EXTRA_SCALE,
    is: "rootheart",
    tags: ["boss", "rootheart", "earth", "stone", "elemental", "monster", "territorial"],
    clips: [["Rhino@Idle", "Idle"], ["Rhino@Walk", "Walk"], ["Rhino@Run", "Run"], ["Rhino@Attack", "Attack"], ["Rhino@Get_Hit", "Hit"], ["Rhino@Dead", "Death"]],
    emissiveIntensity: 1.5,
  },
  {
    id: "boss_rhino_water",
    extraScale: RHINO_EXTRA_SCALE,
    is: "quarrykeeper",
    tags: ["boss", "quarrykeeper", "ordrun", "water", "ice", "elemental", "monster", "territorial"],
    clips: [["Rhino@Idle", "Idle"], ["Rhino@Walk", "Walk"], ["Rhino@Run", "Run"], ["Rhino@Attack", "Attack"], ["Rhino@Get_Hit", "Hit"], ["Rhino@Dead", "Death"]],
    emissiveIntensity: 1.2,
  },
];
