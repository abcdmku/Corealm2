import type { PartPlacement } from "../buildings.js";

/** A closed masonry fortress, authored facing +Z. The six-metre gate opens onto a combat court. */
export const BLACK_KEEP = { halfWidth: 18, halfDepth: 20, gateHalfWidth: 3, courtZ: 7 } as const;

export function buildBlackKnightCastle(): PartPlacement[] {
  const parts: PartPlacement[] = [];
  const storey = 3.123;
  const place = (tag: string, assetId: string, x: number, y: number, z: number,
    yaw = 0, scale = 1, axes?: readonly [number, number, number]) => {
    parts.push({ tag, assetId, dx: x, dy: y, dz: z, rotationY: yaw, scale,
      ...(axes ? { scaleAxes: axes } : {}) });
  };
  // Every curtain has two faces and full-depth ends. Panels retain their two-metre stone courses.
  const curtain = (tag: string, x: number, z: number, length: number, yaw: number, floors: number) => {
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    for (let i = 0; i < length / 2; i++) {
      const along = -length / 2 + 1 + i * 2;
      const px = x + along * cos, pz = z - along * sin;
      for (let floor = 0; floor < floors; floor++) for (const side of [-1, 1]) {
        place(`${tag}_${i}_${floor}_${side}`, "wall_brick_straight",
          px + side * .56 * sin, floor * storey, pz + side * .56 * cos,
          yaw + (side < 0 ? Math.PI : 0));
      }
      // A stone walkway seats on the wall heads. Alternating merlons break the crown silhouette.
      place(`${tag}_coping_${i}`, "kerb_straight", px - .7 * sin, floors * storey, pz - .7 * cos,
        yaw, 1, [1, 2.2, 2]);
      // Crowns that enter a taller corner tower terminate in its masonry, without a hairline gap.
      const crownDepth = tag === 'rear_curtain' || tag.startsWith('front_') && !tag.includes('face') ? 5.2 : 3.2;
      place(`${tag}_merlon_${i}`, "wall_brick_straight", px, floors * storey + .24, pz,
        yaw, 1, [.48, .29, crownDepth]);
    }
    for (const end of [-1, 1]) {
      const px = x + end * length / 2 * cos, pz = z - end * length / 2 * sin;
      for (let floor = 0; floor < floors; floor++) place(`${tag}_end_${end}_${floor}`,
        "wall_brick_straight", px, floor * storey, pz, yaw + Math.PI / 2, 1, [.66, 1, 1]);
    }
  };
  const tower = (tag: string, x: number, z: number, width: number, floors: number, spire = false) => {
    for (let side = 0; side < 4; side++) {
      const yaw = side * Math.PI / 2;
      curtain(`${tag}_face_${side}`, x + Math.sin(yaw) * width / 2,
        z + Math.cos(yaw) * width / 2, width, yaw, floors);
    }
    // Four masonry buttresses join the wall corners and carry the taller tower's weight.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(`${tag}_buttress_${sx}_${sz}`,
      "corner_brick", x + sx * width / 2, .01, z + sz * width / 2,
      Math.atan2(sx, sz), 1, [2, floors * storey / 3.016, 2]);
    if (spire) {
      const roofScale = (width + 1.4) / 5.427;
      place(`${tag}_slate_spire`, "roof_tower", x, floors * storey + .572 * roofScale,
        z, 0, roofScale);
    }
  };
  curtain("west_curtain", -18, 0, 34, Math.PI / 2, 2);
  curtain("east_curtain", 18, 0, 34, Math.PI / 2, 2);
  curtain("rear_curtain", 0, -20, 32, 0, 2);
  curtain("front_west", -11, 20, 10, 0, 2);
  curtain("front_east", 11, 20, 10, 0, 2);
  for (const side of [-1, 1]) {
    tower(`front_${side}`, side * 17, 18, 6, 3);
    tower(`rear_${side}`, side * 17, -18, 6, 3);
    tower(`gate_${side}`, side * 6, 20, 6, 3, true);
  }
  // Elevated gate head: nothing at ground level closes the passage between x=-3 and +3.
  for (let i = 0; i < 3; i++) for (const face of [-1, 1]) place(`gate_head_${i}_${face}`,
    "wall_brick_straight", -2 + i * 2, 6.246, 20 + face * 2.8,
    face > 0 ? 0 : Math.PI);
  for (let i = 0; i < 3; i++) place(`gate_cap_${i}`, "kerb_straight", -2 + i * 2, 9.369,
    17, 0, 1, [1, 2, 8.57]);
  tower("keep", 0, -10, 10, 4, true);
  // A thick raised portal on the keep is a sealed hall entrance, away from the open fighting court.
  place("keep_door", "door_frame_round", 0, 0, -4.28, 0, 1.8);
  place("keep_door_leaf", "door_round_1", -.99, 0, -4.18, 0, 1.8);
  for (const side of [-1, 1]) {
    place(`gate_banner_${side}`, "banner_2", side * 6, 6.4, 23.6, 0, 1.5);
    place(`keep_banner_${side}`, "banner_1", side * 3, 7.2, -4.25, 0, 1.4);
    place(`court_brazier_${side}`, "torch", side * 4, 2.1, -4.6, 0, 2.2);
  }
  return parts;
}
