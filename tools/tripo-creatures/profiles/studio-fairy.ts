import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { addChannel, applyClip, duration, removeClip, restorePose, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';
import { limitGroundCorrectionSpeed, sampleGroundSupport } from '../retarget.js';
import { loadContactHelpers } from '../../calibrate-legacy-gait.js';
import { contactRig } from './studio-animals.js';
import { createStudioCrawlerDeath } from './studio-crawler-death.js';
import type { CreatureRepairContext, CreatureRepairResult } from '../repairProfile.js';

const trialNumbers = ['10', '11', '14', '16', '19', '27', '28', '30', '31', '34'];
export const studioFairyIds = [...trialNumbers.map(n => `fairy_monster_${n}`),
  ...['spriggle', 'wardling'].flatMap(body => ['gloamgarden', 'faeholme'].map(region => `fairy_garden_${body}_${region}`))];
const world = (node: Node) => new Matrix4().fromArray(node.getWorldMatrix());
const position = (node: Node) => new Vector3().setFromMatrixPosition(world(node));
const rotation = (node: Node) => { const q = new Quaternion(); world(node).decompose(new Vector3(), q, new Vector3()); return q.normalize(); };
const depth = (node: Node): number => node.getParentNode() ? 1 + depth(node.getParentNode()!) : 0;

/** Transfer a studio action relative to each rig's native idle, retaining authored segment lengths.
 * The trial rigs share Pixelius naming, but their serialized default is an arbitrary action pose.
 * Comparing native idle world rotations avoids treating that pose as a bind or copying bone rolls.
 */
export async function repairStudioFairy(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  const crawler = /(?:_10|_11|_14)$/.test(context.assetId) || context.assetId.includes('spriggle');
  const donorId = crawler ? 'animal_scorpion' : 'fantasy_monster_02';
  const donor = await context.readAsset(donorId);
  const lookup = (document: Document) => new Map(document.getRoot().listNodes().map(n => [n.getName(), n]));
  const target = lookup(doc), source = lookup(donor), root = target.get('rootx')!, sourceRoot = source.get(crawler ? 'Scorpion_ROOTSHJnt' : 'rootx')!;
  if (!root || !sourceRoot) throw new Error(`Missing verified trial motion root ${context.assetId}`);
  const original = storedPose(doc), donorOriginal = storedPose(donor);
  const idle = doc.getRoot().listAnimations().find(c => c.getName() === 'Idle')!;
  const sourceIdle = donor.getRoot().listAnimations().find(c => c.getName() === 'Idle')!;
  if (!idle || !sourceIdle) throw new Error('Trial repair requires native idle reference poses');
  applyClip(idle, 0); applyClip(sourceIdle, 0);
  const sourceBaseline = storedPose(donor);
  const targetRootStart = position(root), sourceRootStart = position(sourceRoot);
  const targetBox = deformedBounds(doc), sourceBox = deformedBounds(donor);
  const scale = (targetBox.max[1]! - targetBox.min[1]!) / (sourceBox.max[1]! - sourceBox.min[1]!);
  const mapping: Record<string, string> = {};
  if (crawler) {
    mapping.rootx = 'Scorpion_ROOTSHJnt';
    // The Pixelius head/torso is a single shell; preserve its idle shape. Its walking
    // limbs are named arms, while the extra _003 pair is the actual pair of pincers.
    for (const side of ['l', 'r']) {
      for (const [suffix, leg] of [['', 'FrontLeg'], ['_dupli_001', 'MidFrontLeg'], ['_dupli_002', 'BackLeg']]) {
        for (const [bone, joint] of [['arm_stretch', 'Hip'], ['forearm_stretch', 'Knee1'], ['hand', 'Ankle']]) {
          if (target.has(`${bone}${suffix}${side}`)) mapping[`${bone}${suffix}${side}`] = `Scorpion_${side}_${leg}_${joint}SHJnt`;
        }
      }
      for (const [bone, segment] of [['shoulder', '01'], ['arm_stretch', '02'], ['forearm_stretch', '03'], ['hand', '04']]) {
        const name = `${bone}_dupli_003${side}`;
        if (target.has(name)) mapping[name] = `Scorpion_${side}_Pedipalp_01_${segment}SHJnt`;
      }
    }
    const sourceTail = [...Array.from({ length: 5 }, (_, i) => `Scorpion_Abdomen_01_0${i + 1}SHJnt`),
      ...Array.from({ length: 7 }, (_, i) => `Scorpion_Sting_01_0${i + 1}SHJnt`)];
    for (const suffix of ['x', '_dupli_001x']) {
      const tail = [...target.keys()].filter(name => new RegExp(`^c_tail_\\d\\d${suffix}$`).test(name)).sort();
      tail.forEach((name, index) => { mapping[name] = sourceTail[Math.round(index * (sourceTail.length - 1) / Math.max(1, tail.length - 1))]!; });
    }
  } else {
    for (const skin of doc.getRoot().listSkins()) for (const node of skin.listJoints()) {
      // Twist helpers and finger/accessory controls follow their target parent. Their
      // same-looking names do not imply equal bone rolls or surface attachments.
      if (source.has(node.getName()) && /^(rootx|spine_\d\dx|neckx|headx|shoulder[lr]|arm_stretch[lr]|forearm_stretch[lr]|hand[lr]|thigh_stretch[lr]|leg_stretch[lr]|foot[lr]|toes_01[lr])$/.test(node.getName())) mapping[node.getName()] = node.getName();
    }
  }
  const directions: Record<string, string> = {};
  if (!crawler) Object.assign(directions, { rootx: 'spine_01x', spine_01x: 'spine_02x', spine_02x: 'spine_03x', spine_03x: 'neckx', neckx: 'headx' });
  for (const name of Object.keys(mapping)) {
    const child = name.startsWith('shoulder') ? name.replace('shoulder', 'arm_stretch')
      : name.startsWith('arm_stretch') ? name.replace('arm_stretch', 'forearm_stretch')
        : name.startsWith('forearm_stretch') ? name.replace('forearm_stretch', 'hand')
          : name.startsWith('thigh_stretch') ? name.replace('thigh_stretch', 'leg_stretch')
            : name.startsWith('leg_stretch') ? name.replace('leg_stretch', 'foot')
              : /^foot[lr]$/.test(name) ? name.replace('foot', 'toes_01')
                : name.startsWith('c_tail_') ? name.replace(/c_tail_(\d\d)/, (_, n) => `c_tail_${String(Number(n) + 1).padStart(2, '0')}`) : undefined;
    if (child && mapping[child]) directions[name] = child;
  }
  const pairs = Object.entries(mapping).map(([name, donorName]) => {
    const node = target.get(name)!, sourceNode = source.get(donorName)!;
    if (!sourceNode) throw new Error(`Missing native donor joint ${donorName}`);
    const targetRotation = rotation(node), child = directions[name];
    let sourceChild: Node | undefined, localDirection: Vector3 | undefined;
    if (child) {
      sourceChild = source.get(mapping[child]!)!;
      const targetDirection = position(target.get(child)!).sub(position(node));
      const sourceDirection = position(sourceChild).sub(position(sourceNode));
      if (targetDirection.lengthSq() > 1e-10 && sourceDirection.lengthSq() > 1e-10) {
        localDirection = targetDirection.clone().normalize().applyQuaternion(targetRotation.clone().invert());
        targetRotation.premultiply(new Quaternion().setFromUnitVectors(targetDirection.normalize(), sourceDirection.normalize()));
      }
    }
    return { node, sourceNode, sourceChild, localDirection, offset: rotation(sourceNode).invert().multiply(targetRotation) };
  }).sort((a, b) => depth(a.node) - depth(b.node));
  // The native mantis death is a backward somersault. Heavy trial bodies need a
  // planted collapse, so borrow only the humanoid library's grounded Death01.
  // Keep each creature's relaxed idle proportions when transferring its deltas.
  const groundedDeath = !crawler && context.assetId !== 'fairy_monster_16';
  const deathDonor = groundedDeath ? await context.readAsset('animation_library_1') : undefined;
  const deathOriginal = deathDonor ? storedPose(deathDonor) : undefined;
  const deathMapping: Record<string, string> = {
    rootx: 'pelvis', spine_01x: 'spine_01', spine_02x: 'spine_02', spine_03x: 'spine_03', neckx: 'neck_01', headx: 'Head',
  };
  for (const side of ['l', 'r']) for (const [name, from] of [
    ['shoulder', 'clavicle'], ['arm_stretch', 'upperarm'], ['forearm_stretch', 'lowerarm'], ['hand', 'hand'],
    ['thigh_stretch', 'thigh'], ['leg_stretch', 'calf'], ['foot', 'foot'], ['toes_01', 'ball'],
  ] as const) deathMapping[name + side] = `${from}_${side}`;
  let deathBaseline: ReturnType<typeof storedPose> | undefined, deathRoot: Node | undefined;
  let deathRootStart: Vector3 | undefined, deathScale = scale;
  const deathPairs: typeof pairs = [];
  if (deathDonor) {
    const nodes = lookup(deathDonor), idle = deathDonor.getRoot().listAnimations().find(clip => clip.getName() === 'Idle_Loop');
    if (!idle) throw new Error('Grounded trial death requires native UAL standing reference');
    applyClip(idle, 0); deathBaseline = storedPose(deathDonor); deathRoot = nodes.get('pelvis')!;
    if (!deathRoot || !(position(nodes.get('thigh_l')!).x > position(nodes.get('thigh_r')!).x)
      || !(position(target.get('thigh_stretchl')!).x > position(target.get('thigh_stretchr')!).x)) {
      throw new Error('Trial Death requires verified left-positive-X biped anatomy');
    }
    deathRootStart = position(deathRoot);
    const legLength = (a: Node, b: Node, c: Node) => position(a).distanceTo(position(b)) + position(b).distanceTo(position(c));
    deathScale = legLength(target.get('thigh_stretchl')!, target.get('leg_stretchl')!, target.get('footl')!)
      / legLength(nodes.get('thigh_l')!, nodes.get('calf_l')!, nodes.get('foot_l')!);
    for (const [name, from] of Object.entries(deathMapping)) {
      const node = target.get(name), sourceNode = nodes.get(from);
      if (!node) continue;
      if (!sourceNode) throw new Error(`Missing grounded Death donor joint ${from}`);
      deathPairs.push({ node, sourceNode, sourceChild: undefined, localDirection: undefined,
        offset: rotation(sourceNode).invert().multiply(rotation(node)) });
    }
    deathPairs.sort((a, b) => depth(a.node) - depth(b.node));
  }
  const settleCrawler = crawler ? createStudioCrawlerDeath(doc, target, root) : undefined;
  // Weapon roots are independent siblings of the pelvis in these FBX rigs. They
  // follow a hand in native motion through translated keys, not through parenting.
  const weapons = [...target.values()].filter(node => /^root_dupli_\d+x$/.test(node.getName())).map(node => {
    const hands = ['handl', 'handr'].map(name => target.get(name)).filter((hand): hand is Node => Boolean(hand));
    const hand = hands.sort((a, b) => position(a).distanceToSquared(position(node)) - position(b).distanceToSquared(position(node)))[0]!;
    const points: Vector3[] = [];
    for (const meshNode of doc.getRoot().listNodes()) {
      const skin = meshNode.getSkin(), jointIndex = skin?.listJoints().indexOf(node) ?? -1;
      if (!skin || jointIndex < 0) continue;
      const inverseBind = new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(jointIndex, []));
      for (const primitive of meshNode.getMesh()?.listPrimitives() ?? []) {
        const positions = primitive.getAttribute('POSITION')!, indices = primitive.getAttribute('JOINTS_0'), weights = primitive.getAttribute('WEIGHTS_0');
        if (!indices || !weights) continue;
        for (let vertex = 0; vertex < positions.getCount(); vertex++) {
          const joints = indices.getElement(vertex, []), values = weights.getElement(vertex, []);
          if (joints.some((joint, slot) => joint === jointIndex && values[slot]! > .99)) points.push(new Vector3().fromArray(positions.getElement(vertex, [])).applyMatrix4(inverseBind));
        }
      }
    }
    const spans = [0, 1, 2].map(axis => Math.max(...points.map(point => point.getComponent(axis))) - Math.min(...points.map(point => point.getComponent(axis))));
    const longAxis = new Vector3().setComponent(points.length ? spans.indexOf(Math.max(...spans)) : 1, 1);
    return { node, hand, points, longAxis, offset: world(hand).invert().multiply(world(node)) };
  });
  const settlingTails = crawler ? [] : [...target.values()].filter(node => /^(?:spline_def_\d\d|c_tail_\d\d)x$/.test(node.getName())).sort((a, b) => depth(a) - depth(b));
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const ground = doc.createNode('studio_trial_contact');
  for (const child of [...scene.listChildren()]) { scene.removeChild(child); ground.addChild(child); }
  scene.addChild(ground);
  const baselineWithGround = storedPose(doc), reports = [];
  const contactNodes = (crawler ? ['hand_dupli_003l', 'hand_dupli_003r'] : ['handr']).map(name => target.get(name)).filter((node): node is Node => Boolean(node));
  let contactNormalized = 0, furthestContact = -Infinity;
  try {
    for (const name of ['Attack', 'Hit', 'Death', 'Run']) {
      const useGroundedDeath = name === 'Death' && !!deathDonor;
      const actionDonor = useGroundedDeath ? deathDonor! : donor;
      const actionSource = useGroundedDeath ? 'animation_library_1' : donorId;
      const actionName = useGroundedDeath ? 'Death01' : name;
      const native = actionDonor.getRoot().listAnimations().find(c => c.getName() === actionName)!;
      if (!native) throw new Error(`Missing native ${donorId}/${name}`);
      const sourceSeconds = duration(native), seconds = sourceSeconds * (name === 'Death' ? 1.15 : 1);
      const frames = Math.ceil(seconds * 60), times: number[] = [];
      const tracks = new Map(baselineWithGround.map(p => [p.node, { t: [] as number[], r: [] as number[], s: [] as number[], translationTimes: undefined as number[] | undefined }]));
      let maximumGroundCorrection = 0, deathTimeScale = 1;
      for (let frame = 0; frame <= frames; frame++) {
        const phase = frame / frames;
        restorePose(useGroundedDeath ? deathBaseline! : sourceBaseline); applyClip(native, phase * sourceSeconds);
        restorePose(baselineWithGround);
        for (const pair of useGroundedDeath ? deathPairs : pairs) {
          const desired = rotation(pair.sourceNode).multiply(pair.offset), parent = pair.node.getParentNode();
          if (pair.sourceChild && pair.localDirection) {
            const direction = position(pair.sourceChild).sub(position(pair.sourceNode)).normalize();
            const predicted = pair.localDirection.clone().applyQuaternion(desired).normalize();
            desired.premultiply(new Quaternion().setFromUnitVectors(predicted, direction)).normalize();
          }
          pair.node.setRotation((parent ? rotation(parent).invert().multiply(desired) : desired).normalize().toArray());
        }
        const displacement = position(useGroundedDeath ? deathRoot! : sourceRoot)
          .sub(useGroundedDeath ? deathRootStart! : sourceRootStart).multiplyScalar(useGroundedDeath ? deathScale : scale);
        const point = targetRootStart.clone().add(displacement), parent = root.getParentNode();
        root.setTranslation((parent ? point.applyMatrix4(world(parent).invert()) : point).toArray());
        if (name === 'Death') settleCrawler?.(phase);
        if (name === 'Death') {
          const settle = Math.max(0, Math.min(1, (phase - .35) / .5));
          for (const node of settlingTails) {
            const child = node.listChildren().find(child => settlingTails.includes(child));
            if (!child) continue;
            const direction = position(child).sub(position(node)).normalize(), flat = direction.clone();
            flat.y = -.12;
            if (flat.x * flat.x + flat.z * flat.z < .01) flat.z = 1;
            flat.normalize();
            const desired = new Quaternion().setFromUnitVectors(direction, flat).multiply(rotation(node));
            const q = rotation(node).slerp(desired, settle), parent = node.getParentNode();
            node.setRotation((parent ? rotation(parent).invert().multiply(q) : q).toArray());
          }
        }
        for (const weapon of weapons) {
          const desired = world(weapon.hand).multiply(weapon.offset), parent = weapon.node.getParentNode();
          weapon.node.setMatrix((parent ? world(parent).invert().multiply(desired) : desired).toArray());
          if (name === 'Death' && weapon.points.length) {
            const settle = Math.max(0, Math.min(1, (phase - .45) / .4));
            const q = rotation(weapon.node), axis = weapon.longAxis.clone().applyQuaternion(q), flat = new Vector3(axis.x, 0, axis.z);
            if (flat.lengthSq() < .01) flat.set(0, 0, 1);
            const resting = new Quaternion().setFromUnitVectors(axis, flat.normalize()).multiply(q);
            q.slerp(resting, settle);
            weapon.node.setRotation((parent ? rotation(parent).invert().multiply(q) : q).toArray());
            const minimum = Math.min(...weapon.points.map(point => point.clone().applyMatrix4(world(weapon.node)).y));
            const drop = Math.max(0, Math.min(1, (phase - .7) / .2));
            const point = position(weapon.node); point.y += (.016 - minimum) * drop;
            weapon.node.setTranslation((parent ? point.applyMatrix4(world(parent).invert()) : point).toArray());
          }
        }
        if (name === 'Attack') for (const node of contactNodes) {
          const reach = position(node).z;
          if (reach > furthestContact) { furthestContact = reach; contactNormalized = phase; }
        }
        const lift = .016 - deformedBounds(doc).min[1]!;
        ground.setTranslation([0, lift, 0]); maximumGroundCorrection = Math.max(maximumGroundCorrection, Math.abs(lift));
        if (name === 'Death' && phase >= .7) for (const weapon of weapons) {
          if (!weapon.points.length) continue;
          const minimum = Math.min(...weapon.points.map(point => point.clone().applyMatrix4(world(weapon.node)).y));
          const point = position(weapon.node); point.y += (.016 - minimum) * Math.min(1, (phase - .7) / .2);
          const parent = weapon.node.getParentNode();
          weapon.node.setTranslation((parent ? point.applyMatrix4(world(parent).invert()) : point).toArray());
        }
        times.push(seconds * phase);
        for (const { node } of baselineWithGround) {
          const track = tracks.get(node)!; track.t.push(...node.getTranslation()); track.r.push(...node.getRotation()); track.s.push(...node.getScale());
        }
      }
      if (name === 'Death') {
        const qa = new Quaternion(), qb = new Quaternion();
        const sampled = sampleGroundSupport(times, time => {
          const frame = time / seconds * frames, left = Math.min(frames, Math.floor(frame)), right = Math.min(frames, left + 1), alpha = frame - left;
          for (const [node, track] of tracks) {
            if (node === ground) { node.setTranslation([0, 0, 0]); continue; }
            const vector = (values: number[]): [number, number, number] => [0, 1, 2].map(axis =>
              Math.fround(values[left * 3 + axis]!) * (1 - alpha) + Math.fround(values[right * 3 + axis]!) * alpha) as [number, number, number];
            node.setTranslation(vector(track.t)); node.setScale(vector(track.s));
            node.setRotation(qa.fromArray(track.r.slice(left * 4, left * 4 + 4).map(Math.fround))
              .slerp(qb.fromArray(track.r.slice(right * 4, right * 4 + 4).map(Math.fround)), alpha).toArray());
          }
          return .016 - deformedBounds(doc).min[1]!;
        });
        const groundTrack = tracks.get(ground)!, required = sampled.required;
        const maxSpeedMps = (targetBox.max[1]! - targetBox.min[1]!) * 1.25;
        // Heavy or long-tailed proportions can need more support travel than the
        // native one-second fall allows. Retain the phase sequence and grounded
        // endpoints by extending its time, rather than lifting the entry pose.
        let supportTimes: number[];
        if (useGroundedDeath) {
          // A short hand/foot support change must not make the entire body rise
          // ahead of impact. Slow only those source intervals, retaining every
          // articulated pose and the bounded vertical support speed.
          supportTimes = [0];
          for (let i = 1; i < sampled.times.length; i++) supportTimes.push(supportTimes[i - 1]! + Math.max(
            sampled.times[i]! - sampled.times[i - 1]!, Math.abs(required[i]! - required[i - 1]!) / maxSpeedMps * 1.001));
          for (const track of tracks.values()) {
            const t: number[] = [], r: number[] = [], s: number[] = [];
            for (const time of sampled.times) {
              const frame = time / seconds * frames, left = Math.min(frames, Math.floor(frame)), right = Math.min(frames, left + 1), alpha = frame - left;
              for (const [values, output] of [[track.t, t], [track.s, s]] as const) for (let axis = 0; axis < 3; axis++) {
                output.push(Math.fround(values[left * 3 + axis]!) * (1 - alpha) + Math.fround(values[right * 3 + axis]!) * alpha);
              }
              r.push(...qa.fromArray(track.r.slice(left * 4, left * 4 + 4).map(Math.fround))
                .slerp(qb.fromArray(track.r.slice(right * 4, right * 4 + 4).map(Math.fround)), alpha).toArray());
            }
            track.t = t; track.r = r; track.s = s;
          }
          times.splice(0, times.length, ...supportTimes);
          deathTimeScale = supportTimes.at(-1)! / seconds;
        } else {
          const minimumRate = Math.max(...required.flatMap((value, i) => [
            i ? (value - required[0]!) / sampled.times[i]! : 0,
            i < sampled.times.length - 1 ? (value - required.at(-1)!) / (seconds - sampled.times[i]!) : 0,
          ]));
          deathTimeScale = Math.max(1, minimumRate / maxSpeedMps * 1.001);
          for (let i = 0; i < times.length; i++) times[i] = times[i]! * deathTimeScale;
          supportTimes = sampled.times.map(time => time * deathTimeScale);
        }
        if (deathTimeScale > 1.8) throw new Error(`${context.assetId}: excessive Death retiming needed for grounded entry`);
        const limited = limitGroundCorrectionSpeed(supportTimes, required, maxSpeedMps);
        if (Math.abs(limited[0]! - required[0]!) > 1e-6 || Math.abs(limited.at(-1)! - required.at(-1)!) > 1e-6) {
          throw new Error(`${context.assetId}: ground envelope changes the Death entry or held floor: ${JSON.stringify({ maxSpeedMps, required: [required[0], required.at(-1)], limited: [limited[0], limited.at(-1)], peak: Math.max(...required), seconds })}`);
        }
        groundTrack.t = limited.flatMap(value => [0, value, 0]); groundTrack.translationTimes = supportTimes;
        maximumGroundCorrection = Math.max(...limited.map(Math.abs));
      }
      if (name === 'Death') {
        const heldEnd = times.at(-1)! + .3;
        times.push(heldEnd);
        for (const track of tracks.values()) { track.t.push(...track.t.slice(-3)); track.r.push(...track.r.slice(-4)); track.s.push(...track.s.slice(-3)); track.translationTimes?.push(heldEnd); }
      }
      removeClip(doc, name); const clip = doc.createAnimation(name);
      for (const [node, track] of tracks) { addChannel(doc, clip, node, 'translation', track.translationTimes ?? times, track.t); addChannel(doc, clip, node, 'rotation', times, track.r); addChannel(doc, clip, node, 'scale', times, track.s); }
      reports.push({ name, source: actionSource, sourceTake: native.getName(), sourceKind: crawler && name === 'Hit' ? 'Existing project recoil on the studio scorpion rig' : 'Native studio action', seconds: times[times.length - 1]!, maximumGroundCorrection, deathTimeScale });
    }
    for (const clip of doc.getRoot().listAnimations().filter(c => !['Attack', 'Hit', 'Death', 'Run'].includes(c.getName()))) {
      addChannel(doc, clip, ground, 'translation', [0, duration(clip)], [0, 0, 0, 0, 0, 0]);
    }
  } finally { restorePose(original); restorePose(donorOriginal); if (deathOriginal) restorePose(deathOriginal); ground.setTranslation([0, 0, 0]); }
  const rig = contactRig(doc), { measureContactGait } = await loadContactHelpers();
  const groups = crawler ? ['', '_dupli_001', '_dupli_002'].flatMap(suffix => ['l', 'r'].map(side => [`hand${suffix}${side}`]))
    : [['footl', 'toes_01l'], ['footr', 'toes_01r']];
  const contacts = ['Walk', 'Run'].map(name => ({ name, measurement: measureContactGait(rig.root,
    rig.clips.find(clip => clip.name === name), { samples: 960, axis: 'z', direction: 1,
      groups: groups.map(group => group.filter(name => target.has(name))).filter(group => group.length) }) }));
  if (contacts.some(({ measurement }) => !(measurement.speedMps && measurement.speedMps > 0))) {
    throw new Error(`${context.assetId}: missing measured foot contact: ${JSON.stringify(contacts)}`);
  }
  return { changes: ['Replaced malformed trial combat and duplicated Walk-as-Run with anatomically mapped native studio actions; preserved original Idle and Walk tracks.'],
    warnings: ['Requires every-state devdocs review.'], provenance: { donor: donorId, mapping, clips: reports,
      attackContact: { method: 'Maximum forward world reach of native strike hand or pincer after target retargeting', nodes: contactNodes.map(node => node.getName()), normalized: contactNormalized },
      reference: 'Motion relative to native Idle, without changing geometry, skin weights, inverse binds, segment lengths, materials, native Idle or native Walk.',
      contacts: contacts.map(({ name, measurement }) => ({ name, speedMps: measurement.speedMps,
        method: measurement.method, feet: measurement.feet })),
      deathGrounding: { maxSpeedMps: (targetBox.max[1]! - targetBox.min[1]!) * 1.25, unchangedEndpoints: true,
        crawlerSideSettleRadians: crawler ? 1.65 : 0, groundedDeathDonor: groundedDeath ? 'animation_library_1/Death01' : undefined,
        ...(groundedDeath ? { mapping: deathMapping, rootTranslationScale: deathScale } : {}) } },
    motion: { attackSeconds: reports[0]!.seconds, contactNormalized, groundY: .016,
      runClipSeconds: reports.find(report => report.name === 'Run')!.seconds,
      impliedWalkMps: contacts[0]!.measurement.speedMps!, impliedRunMps: contacts[1]!.measurement.speedMps! } };
}
