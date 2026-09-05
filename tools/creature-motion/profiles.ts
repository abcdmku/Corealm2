/** Authored joint-space poses. Angles are around the model's world axes, in degrees. */
export interface JointGesture {
  bone: RegExp;
  axis: "x" | "y" | "z";
  angles: number[];
}

export interface MotionProfile {
  label: string;
  seconds: number;
  contactNormalized: number;
  phases: number[];
  joints: JointGesture[];
}

const strikePhases = [0, 0.23, 0.43, 0.50, 0.73, 0.9, 1];
const gesture = (bone: RegExp, axis: JointGesture["axis"], angles: number[]): JointGesture => ({ bone, axis, angles });

export const CRAB_IDLE: MotionProfile = {
  label: "planted source stance with quiet claw and mouthpart motion",
  seconds: 3.6,
  contactNormalized: 0,
  phases: [0, 0.28, 0.54, 0.78, 1],
  joints: [
    gesture(/^Bone005$/, "y", [0, 1.5, 0, -1, 0]),
    gesture(/^Bone009$/, "x", [0, -1, 0, 1.2, 0]),
    gesture(/^Bone012$/, "x", [0, -2, -0.5, -1, 0]),
    gesture(/^Bone014$/, "x", [0, 2, 0.5, 1, 0]),
    gesture(/^Bone016$/, "x", [0, -0.5, -1.5, -0.5, 0]),
    gesture(/^Bone018$/, "x", [0, 0.5, 1.5, 0.5, 0]),
  ],
};

/** The source has no combat take for these seven anatomies. No root translation is authored. */
export function attackProfile(id: string): MotionProfile | null {
  const common = { phases: strikePhases, contactNormalized: 0.43 };
  if (id.includes("chicken")) return { ...common, label: "alert neck coil, forward peck, recoil and settle", seconds: 0.70, joints: [
    gesture(/Chest_01_02/, "x", [0, -5, 7, 5, -2, 1, 0]),
    gesture(/Neck_01_01/, "x", [0, -12, 21, 17, -7, 2, 0]),
    gesture(/Neck_01_02/, "x", [0, -9, 15, 12, -5, 1, 0]),
    gesture(/Neck_01_03/, "x", [0, 8, -10, -8, 5, -1, 0]),
    gesture(/Head_JawSHJnt$/, "x", [0, 12, 0, 0, 5, 0, 0]),
    gesture(/_l_Leg_Hip/, "x", [0, -4, 6, 5, -2, 0, 0]),
    gesture(/_l_Leg_Knee/, "x", [0, 7, -9, -8, 3, 0, 0]),
    gesture(/_r_Leg_Hip/, "x", [0, 3, -4, -3, 1, 0, 0]),
    gesture(/_r_Leg_Knee/, "x", [0, -5, 6, 5, -2, 0, 0]),
    gesture(/Tail_01_01/, "x", [0, 4, -8, -6, 3, -1, 0]),
  ] };
  if (id.includes("rabbit")) return { ...common, label: "hindquarter brace, short articulated nip, ear follow-through", seconds: 0.66, joints: [
    gesture(/Spine_03/, "x", [0, -5, 8, 6, -3, 1, 0]),
    gesture(/Spine_Top/, "x", [0, -5, 9, 7, -3, 1, 0]),
    gesture(/Neck_01/, "x", [0, -12, 18, 13, -6, 1, 0]),
    gesture(/Neck_02/, "x", [0, -8, 12, 9, -4, 1, 0]),
    gesture(/Head_JawSHJnt$/, "x", [0, 20, 0, 0, 8, 0, 0]),
    gesture(/FrontLeg_Hip/, "x", [0, 4, -7, -6, 2, 0, 0]),
    gesture(/FrontLeg_Knee/, "x", [0, -7, 11, 9, -3, 0, 0]),
    gesture(/HindLeg_Hip/, "x", [0, -6, 4, 3, -1, 0, 0]),
    gesture(/HindLeg_Knee/, "x", [0, 9, -6, -5, 2, 0, 0]),
    gesture(/Ears_01_01/, "x", [0, -18, -6, 6, 9, -3, 0]),
  ] };
  if (id === "animal_deer") return { ...common, label: "antler presentation, planted head thrust, guarded recovery", seconds: 1.08, joints: [
    gesture(/Spine_04/, "x", [0, -3, 5, 5, -2, 0, 0]),
    gesture(/Neck_01/, "x", [0, 14, 22, 20, 8, -2, 0]),
    gesture(/Neck_02/, "x", [0, 14, 18, 16, 5, -2, 0]),
    gesture(/Neck_Top/, "x", [0, -9, -19, -18, -5, 2, 0]),
    gesture(/Head_Top/, "x", [0, 4, -7, -5, 3, -1, 0]),
    gesture(/FrontLeg_Hip/, "x", [0, -4, -7, -6, -2, 0, 0]),
    gesture(/FrontLeg_Knee1/, "x", [0, 7, 11, 9, 3, 0, 0]),
    gesture(/HindLeg_Hip/, "x", [0, 3, 5, 4, 1, 0, 0]),
    gesture(/HindLeg_Knee1/, "x", [0, -5, -7, -6, -2, 0, 0]),
  ] };
  if (id.includes("frog")) return { ...common, label: "hind leg compression, jaw snap and foreleg catch", seconds: 0.68, joints: [
    gesture(/^Bone003$/, "x", [0, -9, 12, 8, -4, 1, 0]),
    gesture(/^Bone004$/, "x", [0, 15, -8, -7, 5, -1, 0]),
    gesture(/^Bone008$/, "x", [0, 24, 0, 0, 10, 1, 0]),
    gesture(/^Bone010\(/, "x", [0, 12, -8, -6, 4, 0, 0]),
    gesture(/^Bone011\(/, "x", [0, -15, 10, 8, -5, 0, 0]),
    gesture(/^Bone015(?:\(|$)/, "x", [0, -5, 8, 6, -2, 0, 0]),
    gesture(/^Bone016(?:\(|$)/, "x", [0, 8, -12, -9, 3, 0, 0]),
  ] };
  if (id === "animal_hog") return { ...common, label: "lowered tusk guard, rising neck jab, shoulder recovery", seconds: 0.86, joints: [
    gesture(/^Bone012$/, "x", [0, 10, -14, -11, 6, -1, 0]),
    gesture(/^Bone013$/, "x", [0, 9, -13, -10, 5, -1, 0]),
    gesture(/^Bone014$/, "y", [0, -7, 12, 8, -4, 1, 0]),
    gesture(/^Bone023(?:\(|$)/, "x", [0, -4, 7, 6, -2, 0, 0]),
    gesture(/^Bone024(?:\(|$)/, "x", [0, 7, -10, -8, 3, 0, 0]),
    gesture(/^Bone029(?:\(|$)/, "x", [0, 4, -5, -4, 2, 0, 0]),
    gesture(/^Bone030(?:\(|$)/, "x", [0, -6, 8, 6, -2, 0, 0]),
  ] };
  if (id === "animal_rat") return { ...common, label: "crouched nip with jaw closure and tail balance", seconds: 0.58, joints: [
    gesture(/^Bone005$/, "x", [0, -5, 8, 6, -2, 1, 0]),
    gesture(/^Bone006$/, "x", [0, -9, 14, 10, -4, 1, 0]),
    gesture(/^Bone007$/, "x", [0, -7, 10, 8, -3, 1, 0]),
    gesture(/^Bone010$/, "x", [0, 20, 0, 0, 7, 0, 0]),
    gesture(/^Bone026(?:\(|$)/, "x", [0, 4, -6, -4, 2, 0, 0]),
    gesture(/^Bone027(?:\(|$)/, "x", [0, -7, 10, 7, -3, 0, 0]),
    gesture(/^Bone031(?:\(|$)/, "x", [0, -4, 5, 4, -1, 0, 0]),
    gesture(/^Bone032(?:\(|$)/, "x", [0, 6, -7, -5, 2, 0, 0]),
    gesture(/^Bone014$/, "y", [0, -5, 8, 5, -4, 1, 0]),
  ] };
  if (id === "animal_crab") return { ...common, label: "left claw cock, forward pinch, right claw guard", seconds: 0.88, joints: [
    gesture(/^Bone005$/, "y", [0, 20, -18, -16, 8, -2, 0]),
    gesture(/^Bone006$/, "x", [0, -16, 12, 10, -5, 1, 0]),
    gesture(/^Bone007$/, "y", [0, 14, -20, -17, 6, -1, 0]),
    gesture(/^Bone012$/, "x", [0, -22, 3, 2, -10, -2, 0]),
    gesture(/^Bone014$/, "x", [0, 22, -3, -2, 10, 2, 0]),
    gesture(/^Bone009$/, "x", [0, -12, -6, -5, -2, 0, 0]),
    gesture(/^Bone010$/, "y", [0, -10, 5, 4, -2, 0, 0]),
    gesture(/^Bone02[3469](?:\(|$)/, "z", [0, 3, -4, -3, 1, 0, 0]),
  ] };
  return null;
}

/** Recoil is delayed down the body; supporting limbs counter-rotate instead of sliding the root. */
export function hitProfile(id: string, side: -1 | 0 | 1): MotionProfile {
  const phases = [0, 0.12, 0.28, 0.50, 0.76, 1];
  const heavy = /bear|cattle|aurochs|boar|rhino/.test(id);
  const strength = heavy ? 0.7 : 1;
  const roll = side === 0 ? 0.25 : side;
  const joints: JointGesture[] = [];
  const add = (bone: RegExp, axis: JointGesture["axis"], values: number[]) => joints.push(gesture(bone, axis, values.map(v => v * strength)));
  const head = /chicken/.test(id) ? /Neck_01_02/ : /frog/.test(id) ? /^Bone003$/ : /hog/.test(id) ? /^Bone013$/ : /rat/.test(id) ? /^Bone006$/ : /crab/.test(id) ? /^Bone006$/ : /scorpion/.test(id) ? /Sting_01_03/ : /rhino/.test(id) ? /^CATRigHub003$/ : /Neck_02/;
  const chest = /chicken/.test(id) ? /Chest_01_02/ : /frog/.test(id) ? /^Bone005$/ : /hog/.test(id) ? /^Bone012$/ : /rat/.test(id) ? /^Bone004$/ : /crab/.test(id) ? /^Bone010$/ : /scorpion/.test(id) ? /Abdomen_01_03/ : /rhino/.test(id) ? /^CATRigHub002$/ : /viper/.test(id) ? /Front_01_09/ : /Spine_04/;
  add(head, "x", [0, -12, -7, 4, -1, 0]);
  add(head, "y", [0, 14 * roll, 8 * roll, -4 * roll, roll, 0]);
  add(chest, "z", [0, -3 * roll, -7 * roll, 3 * roll, -roll, 0]);
  add(chest, "x", [0, -2, -6, 2, -0.5, 0]);
  if (/frog/.test(id)) {
    add(/^Bone015(?:\(|$)/, "x", [0, 4, 7, 3, -1, 0]);
    add(/^Bone016(?:\(|$)/, "x", [0, -6, -10, -4, 1, 0]);
    add(/^Bone011\(/, "x", [0, 2, 5, 2, -1, 0]);
  } else if (/hog|rat/.test(id)) {
    add(id.includes("hog") ? /^Bone023(?:\(|$)/ : /^Bone026(?:\(|$)/, "x", [0, 4, 7, 2, -1, 0]);
    add(id.includes("hog") ? /^Bone024(?:\(|$)/ : /^Bone027(?:\(|$)/, "x", [0, -6, -10, -3, 1, 0]);
  } else if (id.includes("crab")) {
    add(/^Bone012$/, "x", [0, -14, -9, -3, 1, 0]);
    add(/^Bone014$/, "x", [0, 14, 9, 3, -1, 0]);
    add(/^Bone02[1467](?:\(|$)/, "x", [0, 2, 5, 2, -1, 0]);
  } else if (id.includes("viper")) {
    add(/Front_01_07/, "x", [0, 0, -6, 2, -1, 0]);
    add(/Front_01_07/, "y", [0, 0, -8 * roll, 3 * roll, -roll, 0]);
    add(/Back_01_03/, "y", [0, 0, 5 * roll, -2 * roll, roll, 0]);
  } else if (id.includes("rhino")) {
    add(/^CATRig[LR]Arm1$/, "x", [0, 3, 5, 2, -1, 0]);
    add(/^CATRig[LR]Arm2$/, "x", [0, -5, -8, -3, 1, 0]);
  } else {
    add(/(?:FrontLeg|_Leg)_Hip/, "x", [0, 3, 6, 2, -1, 0]);
    add(/(?:FrontLeg|_Leg)_Knee/, "x", [0, -5, -9, -3, 1, 0]);
    add(id.includes("scorpion") ? /Sting_01_06/ : /(?:Tail|Ears?)_01_01/, "y", [0, 0, -9 * roll, 5 * roll, -2 * roll, 0]);
  }
  return { label: `${side < 0 ? "left" : side > 0 ? "right" : "frontal"} impact, limb brace and damped recovery`, seconds: heavy ? 0.66 : 0.5, contactNormalized: 0.12, phases, joints };
}
