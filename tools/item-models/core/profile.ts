import raw from "./body-profile.json";
import type { ArmorBodyProfile } from "./contracts.js";

for (const name of ["torso", "head", "leftLeg", "leftArm", "leftHand", "leftFoot"] as const) {
  if (!raw[name].length) throw new Error(`Empty armor body profile ${name}`);
  for (const section of raw[name]) {
    if (!Number.isFinite(section.level) || section.center.length !== 2 || section.outline.length !== 32
      || ![...section.center, ...section.outline.flat()].every(Number.isFinite)
      || section.outline.some(point => point.length !== 2)) throw new Error(`Invalid armor body section ${name}`);
  }
}
export const bodyProfile = raw as unknown as ArmorBodyProfile;
