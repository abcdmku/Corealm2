import * as THREE from "three";

export type ClothingRegion = "body" | "hands" | "sleeves" | "legs" | "feet";
export interface ItemBodyCoverageSpan {
  readonly region: "torso" | "legs";
  readonly minY: number;
  readonly maxY: number;
}
const protectedRegion = 5;
const regionCount = protectedRegion + 1;

function regionForBone(name: string): number {
  if (/^spine_\d+$/.test(name)) return 0;
  if (/^(clavicle|upperarm|lowerarm)(_|$)/.test(name)) return 1;
  if (name === "pelvis" || /^(thigh|calf)_/.test(name)) return 2;
  if (/^(foot|ball)_/.test(name)) return 3;
  if (/^(hand|index|middle|ring|pinky|thumb)(_|$)/.test(name)) return 4;
  return protectedRegion; // Head, neck, root, and unknown bones remain visible.
}

/** Remove covered body triangles without changing vertex data or skin bindings.
 * Boundary triangles stay when any corner belongs mainly to an exposed region. This leaves a
 * small overlap under clothing rather than cutting holes beside its shoulder or ankle seam.
 * Spans use POSITION.y in native bind-pose meters. The native male/female body meshes have
 * identity bind matrices; callers with another coordinate space must transform height sampling
 * into that space before using spans. Output attributes always stay in their original space.
 */
export function maskLegacyClothing(
  geometry: THREE.BufferGeometry,
  boneNames: readonly string[],
  covered: ReadonlySet<ClothingRegion>,
  spans: readonly ItemBodyCoverageSpan[] = [],
): THREE.BufferGeometry {
  for (const span of spans) {
    if (!["torso", "legs"].includes(span.region) || !Number.isFinite(span.minY) || !Number.isFinite(span.maxY) || span.minY >= span.maxY) {
      throw new Error("Body coverage span requires a supported region and increasing finite meter heights");
    }
  }
  const result = geometry.clone();
  if (!covered.size && !spans.length) return result;
  const position = geometry.getAttribute("position");
  const joint = geometry.getAttribute("skinIndex"), weight = geometry.getAttribute("skinWeight");
  if (!position || !joint || !weight) return result;
  if (joint.count !== position.count || weight.count !== position.count || joint.itemSize !== weight.itemSize) {
    throw new Error("Body coverage requires matching position and skin attributes");
  }
  // Legacy hands cover whole arms. Sleeves stop before the hand and finger joints.
  const coveredRegions = [covered.has("body"), covered.has("hands") || covered.has("sleeves"),
    covered.has("legs"), covered.has("feet"), covered.has("hands")];
  const boneRegions = boneNames.map(regionForBone);
  const scores = new Float64Array(position.count * regionCount);
  const removable = new Uint8Array(position.count);
  const spanVertices = spans.map(() => new Uint8Array(position.count));
  for (let vertex = 0; vertex < position.count; vertex++) {
    let total = 0, headWeight = 0, spineWeight = 0, legWeight = 0;
    for (let influence = 0; influence < weight.itemSize; influence++) {
      const strength = weight.getComponent(vertex, influence);
      if (!Number.isFinite(strength) || strength < 0) throw new Error("Body coverage found invalid skin weights");
      if (!strength) continue;
      const bone = joint.getComponent(vertex, influence), region = boneRegions[bone] ?? protectedRegion;
      scores[vertex * regionCount + region]! += strength;
      total += strength;
      if (/^(Head|head|neck)(_|$)/.test(boneNames[bone] ?? "")) headWeight += strength;
      if (/^spine_\d+$/.test(boneNames[bone] ?? "")) spineWeight += strength;
      if (/^(thigh|calf)_/.test(boneNames[bone] ?? "")) legWeight += strength;
    }
    // Native shoulders carry tiny neck weights as far down as y=1.37. Preserve the neck
    // transition at 25%, while allowing those mostly spine-driven back vertices to be covered.
    if (total === 0 || headWeight / total >= 0.25) continue;
    const y = position.getY(vertex);
    spans.forEach((span, index) => {
      // All corners must fall strictly within one span. A triangle crossing a hem survives.
      if (y > span.minY && y < span.maxY && (span.region === "torso" ? spineWeight : legWeight) / total >= .65) {
        spanVertices[index]![vertex] = 1;
      }
    });
    let dominant = protectedRegion, maximum = scores[vertex * regionCount + protectedRegion]!, coveredWeight = 0;
    for (let region = 0; region < protectedRegion; region++) {
      const score = scores[vertex * regionCount + region]!;
      if (coveredRegions[region]) coveredWeight += score;
      if (score > maximum) { maximum = score; dominant = region; }
    }
    // A 50/50 shoulder belongs to neither garment with enough certainty to cut it.
    if (coveredRegions[dominant] && coveredWeight / total >= 0.65) removable[vertex] = 1;
  }

  const sourceIndex = geometry.getIndex(), count = sourceIndex?.count ?? position.count;
  const kept: number[] = [];
  const prefix = new Uint32Array(count + 1);
  for (let offset = 0; offset < count; offset += 3) {
    const corners = [0, 1, 2].map(corner => sourceIndex ? sourceIndex.getX(offset + corner) : offset + corner);
    const triangleScores = new Array<number>(regionCount).fill(0);
    for (const vertex of corners) {
      for (let region = 0; region < regionCount; region++) triangleScores[region]! += scores[vertex * regionCount + region] ?? 0;
    }
    let dominant = protectedRegion;
    for (let region = 0; region < protectedRegion; region++) if (triangleScores[region]! > triangleScores[dominant]!) dominant = region;
    const remove = offset + 2 < count && (
      (coveredRegions[dominant] && corners.every(vertex => removable[vertex] === 1))
      || spanVertices.some(vertices => corners.every(vertex => vertices[vertex] === 1))
    );
    for (let corner = 0; corner < 3 && offset + corner < count; corner++) {
      if (!remove) kept.push(corners[corner]!);
      prefix[offset + corner + 1] = kept.length;
    }
  }
  if (kept.length === count) return result;
  // Retain every original vertex and cloned attribute, including normalized, interleaved,
  // custom, and morph attributes. Only the triangle index changes.
  result.setIndex(kept);
  const at = (offset: number) => prefix[Math.max(0, Math.min(count, Math.floor(offset)))]!;
  result.clearGroups();
  for (const group of geometry.groups) {
    const start = at(group.start), end = at(group.start + group.count);
    if (end > start) result.addGroup(start, end - start, group.materialIndex);
  }
  const start = at(geometry.drawRange.start), end = at(geometry.drawRange.start + geometry.drawRange.count);
  result.setDrawRange(start, end - start);
  return result;
}
