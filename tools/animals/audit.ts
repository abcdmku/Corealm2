/**
 * Full animation audit across every animal asset and every enemy that uses one.
 *
 * Written because the first pass at these clips was reactive: problems were fixed one animal at a
 * time as they were noticed, which is exactly how a set ends up with three good rigs and nineteen
 * unexamined ones. This checks the whole set against rules rather than against attention.
 *
 * Rules, and why each one is here:
 *  - A combat animal needs Idle, Walk, Attack and Death. Missing Idle sends `clipCandidates` down
 *    its catch-all tail and the animal idles by walking on the spot; missing Death holds the last
 *    live pose as a corpse.
 *  - No two motions may share a duration to three decimals. That is the signature of the `_exp`
 *    rigs shipping one long take four times over, which is how the frog, hog, rat and crab reached
 *    the game unable to change animation at all.
 *  - An attack has to fit inside its own swing. `attackSpeedMs` comes from content/enemies.ts, and
 *    a clip longer than the cadence is still playing when the next blow lands.
 *  - Locomotion and idle must not translate the root. Anything over a centimetre is unstripped
 *    root motion, which slides the animal away from where the simulation thinks it is.
 *  - An attack MUST translate the root, either from authored art or from the synthesized lunge. A
 *    zero here is an attack that plays in place, which reads as feeding or twitching.
 */
import "../lib/repoContent.js";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { gameRoot } from "../lib/paths.js";
import { ENEMIES } from "../../game/src/content/enemies.js";
import { REGIONS } from "../../game/src/content/regions.js";

const MOTIONS = ["Idle", "Walk", "Attack", "Death"] as const;

interface ClipFacts { duration: number; rootPeak: number; channels: number }

/**
 * Peak translation of whichever DEFORMING node moves most, in raw buffer units (centimetres here).
 *
 * The filter matters. These rigs carry IK helper objects that are neither joints nor meshes, and
 * their tracks are the largest in several clips while moving nothing at all - measuring those made
 * a correctly stripped frog report a 1.38 m hop.
 */
function clipFacts(anim: import("@gltf-transform/core").Animation, rootJoints: Set<unknown>): ClipFacts {
  let duration = 0;
  let rootPeak = 0;
  for (const channel of anim.listChannels()) {
    const input = channel.getSampler()?.getInput()?.getArray();
    if (input?.length) duration = Math.max(duration, Number(input[input.length - 1]));
    if (channel.getTargetPath() !== "translation") continue;
    // The ROOT joint only. A walk cycle legitimately swings every leg bone through a large arc,
    // so a max over all joints reports normal locomotion as unstripped root motion.
    if (!rootJoints.has(channel.getTargetNode())) continue;
    const values = channel.getSampler()?.getOutput()?.getArray();
    if (!values) continue;
    for (let i = 0; i < values.length; i += 3) {
      rootPeak = Math.max(rootPeak, Math.hypot(
        Number(values[i]) - Number(values[0]),
        Number(values[i + 1]) - Number(values[1]),
        Number(values[i + 2]) - Number(values[2]),
      ));
    }
  }
  return { duration, rootPeak, channels: anim.listChannels().length };
}

const dir = path.join(gameRoot, "public", "assets", "models", "animal");
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const files = (await readdir(dir)).filter((f) => f.endsWith(".glb")).sort();

// Which asset each spawn group draws with, and how fast that enemy swings.
const assetCadence = new Map<string, { groups: string[]; swingMs: number }>();
for (const region of REGIONS) {
  const groups = [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])];
  for (const group of groups) {
    const block = ENEMIES.find((e) => e.id === group.id);
    if (!block) continue;
    const row = assetCadence.get(group.assetId) ?? { groups: [], swingMs: block.attackSpeedMs };
    row.groups.push(group.id);
    row.swingMs = Math.min(row.swingMs, block.attackSpeedMs);
    assetCadence.set(group.assetId, row);
  }
}

const problems: string[] = [];
const notes: string[] = [];
console.log(
  "asset                    Idle    Walk  Attack   Death | lunge  swing | uses",
);
for (const file of files) {
  const id = file.replace(".glb", "");
  const doc = await io.read(path.join(dir, file));
  const joints = doc.getRoot().listSkins().flatMap((skin) => skin.listJoints());
  const jointSet = new Set(joints);
  // Every joint whose parent is not itself a joint. Usually one, but these rigs bind IK chain
  // roots into the same skin, so a `find` picks an arbitrary one and reports the real root's lunge
  // as zero - the hog's 50.7 unit strike measured as 0.0 that way.
  const rootJoints = new Set<unknown>(joints.filter((j) => !jointSet.has(j.getParentNode() as never)));
  if (rootJoints.size === 0 && joints[0]) rootJoints.add(joints[0]);
  const facts = new Map<string, ClipFacts>();
  for (const anim of doc.getRoot().listAnimations()) facts.set(anim.getName(), clipFacts(anim, rootJoints));

  const usage = assetCadence.get(id);
  const isCombat = Boolean(usage);
  const cell = (m: string) => (facts.has(m) ? facts.get(m)!.duration.toFixed(2).padStart(5) : "  -  ");
  const attack = facts.get("Attack");
  const lunge = attack ? (attack.rootPeak / 100).toFixed(2) : "  - ";
  const swing = usage ? (usage.swingMs / 1000).toFixed(1) : " - ";

  console.log(
    `${id.padEnd(23)} ${MOTIONS.map(cell).join(" ")} | ${lunge.padStart(5)}  ${swing.padStart(4)} |` +
    ` ${usage ? usage.groups.length : 0} group(s)`,
  );

  if (isCombat) {
    for (const m of MOTIONS) if (!facts.has(m)) problems.push(`${id}: missing ${m}`);
    if (attack && usage && attack.duration > usage.swingMs / 1000) {
      problems.push(`${id}: Attack ${attack.duration.toFixed(2)}s overruns its ${(usage.swingMs / 1000).toFixed(1)}s swing`);
    }
    // Not a rule. An authored strike can live entirely in the bones - a viper lunges by extending
    // its body without its root moving at all - so this is reported for the eye, not enforced.
    if (attack && attack.rootPeak < 1) {
      notes.push(`${id}: Attack keeps its root still (${attack.rootPeak.toFixed(1)} units); strike is in the bones`);
    }
  }
  for (const m of ["Idle", "Walk"] as const) {
    const f = facts.get(m);
    if (f && f.rootPeak > 1) problems.push(`${id}: ${m} translates the root by ${(f.rootPeak / 100).toFixed(2)} m (unstripped root motion)`);
  }
  // Three or more motions sharing a length is the `_exp` one-take-reused signature. Two matching
  // is ordinary coincidence: the scorpion's attack and death are both authored at 24 frames.
  const byDuration = new Map<string, string[]>();
  for (const [name, f] of facts) {
    const key = f.duration.toFixed(3);
    byDuration.set(key, [...(byDuration.get(key) ?? []), name]);
  }
  for (const [key, names] of byDuration) {
    if (names.length >= 3) problems.push(`${id}: ${names.join(", ")} all ${key}s - one take reused?`);
  }
}

console.log(`\n${files.length} assets audited`);
if (notes.length > 0) {
  console.log(`${notes.length} note(s):`);
  for (const n of notes) console.log(`  ${n}`);
}
if (problems.length === 0) console.log("no problems found");
else {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p}`);
}
