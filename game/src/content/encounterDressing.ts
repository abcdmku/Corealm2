import type { HabitatDef } from "./worldHabitats.js";
import type { RpgBodyFamily } from "./rpgBestiary.js";

type Piece = HabitatDef["dressing"][number];
type LocalPiece = Omit<Piece, "id"> & { readonly id: string };
export type EncounterSettingKind = "supply-camp" | "burial-shrine" | "stone-working" | "roost" | "ritual-court";

export interface EncounterSetting {
  readonly kind: EncounterSettingKind;
  readonly purpose: string;
  readonly approach: "south";
  readonly dressing: HabitatDef["dressing"];
}

/** Pieces occupy a central island behind the south approach. Models retain deliberate practical
 * dimensions; tight formations use fewer pieces instead of shrinking every prop to fit. */
export function encounterSetting(
  family: RpgBodyFamily, centre: readonly [number, number], availableRadius: number,
): EncounterSetting {
  if (!Number.isFinite(availableRadius) || availableRadius < 1.5)
    throw new Error(`Encounter ${family} needs at least 1.5 m of central setting space`);
  const roomy = availableRadius >= 2.7;
  let kind: EncounterSettingKind, purpose: string, pieces: LocalPiece[];
  if (["goblin", "orc", "gnoll", "lizardman"].includes(family)) {
    kind = "supply-camp";
    purpose = "A lookout's ration cache and water barrel mark a defended rest stop. The open south side is its approach.";
    pieces = [
      { id: "ration-cache", assetId: "crate_wood", x: -0.65, z: -0.55, yaw: 0.08, scale: 0.85 },
      { id: "water-barrel", assetId: "barrel", x: 0.62, z: -0.55, yaw: 0, scale: 0.9 },
    ];
    if (roomy) pieces.push(
      { id: "back-barricade", assetId: "fence_wood_single", x: 0, z: -1.75, yaw: 0, scale: 1 },
      { id: "blade-stone", assetId: "whetstone", x: -1.65, z: 0.2, yaw: 0.25, scale: 0.75 },
    );
  } else if (["skeleton", "zombie", "wraith"].includes(family)) {
    kind = "burial-shrine";
    purpose = "Paired weathered grave markers face a broken offering table, leaving a clear approach for mourners and intruders.";
    pieces = [
      { id: "offering-table", assetId: "altar_ruins_altar", x: 0, z: -0.6, yaw: 0, scale: 0.8 },
    ];
    if (roomy) pieces.push(
      { id: "grave-west", assetId: "corealm_rock_strata_3", x: -1.7, z: 0.25, yaw: 0.1, scale: [0.1, 0.36, 0.17], sink: 0.08 },
      { id: "grave-east", assetId: "corealm_rock_strata_3", x: 1.7, z: 0.25, yaw: -0.08, scale: [0.1, 0.3, 0.17], sink: 0.06 },
      { id: "chapel-remnant", assetId: "wall_brick_straight", x: 0, z: -1.9, yaw: 0, scale: [0.75, 0.25, 1] },
    );
  } else if (family === "golem") {
    kind = "stone-working";
    purpose = "A split stone block and abandoned sorting crate mark an old working face. The front aisle remains open.";
    pieces = [
      { id: "split-block", assetId: "corealm_rock_strata_2", x: -0.5, z: -0.5, yaw: 0.1, scale: [0.28, 0.3, 0.25], sink: 0.08 },
      { id: "sorting-box", assetId: "crate_wood", x: 0.85, z: -0.45, yaw: -0.1, scale: 0.75 },
    ];
    if (roomy) pieces.push({ id: "abandoned-workface", assetId: "corealm_rock_strata_1", x: 0, z: -1.75,
      yaw: 0.1, scale: [0.55, 0.45, 0.22], sink: 0.16 });
  } else if (family === "harpy" || family === "gargoyle") {
    kind = "roost";
    purpose = "An exposed stone perch anchors the roost. Its low fallen slab leaves landing and retreat space around it.";
    pieces = [{ id: "stone-perch", assetId: "corealm_rock_strata_2", x: 0, z: -0.5,
      yaw: 0.1, scale: [0.28, 0.4, 0.25], sink: 0.1 }];
    if (roomy) pieces.push({ id: "fallen-slab", assetId: "corealm_rock_strata_3", x: -1.5, z: 0.3,
      yaw: 0.4, scale: [0.2, 0.13, 0.3], sink: 0.08 });
  } else {
    kind = "ritual-court";
    purpose = "A surviving altar and broken rear wall mark a ruined ritual court. Its open front gives the guards a readable approach.";
    pieces = [{ id: "ritual-altar", assetId: "altar_ruins_altar", x: 0, z: -0.6, yaw: 0, scale: 0.8 }];
    if (roomy) pieces.push({ id: "court-remnant", assetId: "wall_brick_straight", x: 0, z: -1.9,
      yaw: 0, scale: [0.9, 0.35, 1] });
  }
  return { kind, purpose, approach: "south", dressing: pieces.map((piece) => ({ ...piece,
    x: centre[0] + piece.x, z: centre[1] + piece.z })) };
}
