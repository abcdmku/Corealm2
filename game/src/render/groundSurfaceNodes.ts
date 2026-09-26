import { DataTexture, RGBAFormat, SRGBColorSpace, type Texture, type Vector3, type Vector4 } from 'three';
import { type MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, If, abs, attribute, cameraViewMatrix, clamp, cos, cross, dFdx, dFdy, dot, exp,
  float, floor, fract, fwidth, max, min, mix, normalWorldGeometry, normalize,
  positionView, positionWorld, pow, reference, sign, sin, smoothstep, struct,
  texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { composeSurface } from './nodeMaterials.js';
import { DETAIL_VALUE_OFFSET } from './proceduralTextures.js';

type Binding<T> = { value: T };

/** Unequal, large weathering patches hide the period of the two rock projections. */
export function alpineRockBlend(point: Node<'vec3'>): Node<'float'> {
  return smoothstep(-0.8, 0.8, sin(point.x.mul(0.027).add(point.z.mul(0.019)))
    .add(cos(point.z.mul(0.033).sub(point.y.mul(0.021))))).mul(0.6).add(0.2);
}

/** Continuous elevation/slope bands shared by the massif assets and biome terrain. */
export function alpineSurfaceColor(rock: Node<'vec3'>, point: Node<'vec3'>, up: Node<'float'>): Node<'vec3'> {
  const snowLine = point.y.add(sin(point.x.mul(0.035)).mul(cos(point.z.mul(0.028))).mul(10));
  const snow = smoothstep(65, 115, snowLine).mul(smoothstep(0.26, 0.58, up));
  const meadow = float(1).sub(smoothstep(20, 58, point.y)).mul(smoothstep(0.42, 0.72, up));
  const grass = vec3(0.11, 0.29, 0.055).mul(rock.r.mul(0.7).add(0.65));
  return mix(mix(rock.mul(vec3(0.72, 0.80, 0.87)), grass, meadow), vec3(0.98, 1, 1), snow);
}

/** Stable bindings are shared with MaterialLibrary so surfaces loaded later update in place. */
export interface GroundSurfaceInputs {
  uAlpineRock: Binding<Texture | null>;
  uDetail: Binding<Texture>;
  uMacro: Binding<Texture>;
  uNormalGS: Binding<Texture>;
  uNormalRV: Binding<Texture>;
  uCobble: Binding<DataTexture>;
  uCobbleTiling: Binding<number>;
  uDetailTiling: Binding<Vector4>;
  uGroundStoneAlbedo: Binding<Texture | null>;
  uGroundStoneNormal: Binding<Texture | null>;
  uGroundStoneRoughness: Binding<Texture | null>;
  uGroundStoneMean: Binding<Vector3>;
  uGroundStoneTiling: Binding<number>;
  uGroundStoneReady: Binding<number>;
  uFairyGrassAlbedo: Binding<Texture | null>;
  uFairyGrassNormal: Binding<Texture | null>;
  uFairyGrassMean: Binding<Vector3>;
  uFairyGrassTiling: Binding<number>;
  uFairyGrassReady: Binding<number>;
}

const GroundSurface = struct({
  color: 'vec3', macroShade: 'float', groundBump: 'vec2',
  cobbleBump: 'vec2', cobbleCoverage: 'float', cobbleRoughness: 'float',
  cliffBump: 'vec3', cliffCoverage: 'float', cliffRoughness: 'float',
}) as unknown as (
  color: Node<'vec3'>, macroShade: Node<'float'>, groundBump: Node<'vec2'>,
  cobbleBump: Node<'vec2'>, cobbleCoverage: Node<'float'>, cobbleRoughness: Node<'float'>,
  cliffBump: Node<'vec3'>, cliffCoverage: Node<'float'>, cliffRoughness: Node<'float'>,
) => Node<'struct'>;

/** The texture axes are tangent to each projection's normal, including vertical cliffs. */
export const GROUND_CLIFF_PROJECTIONS = { x: 'zy', y: 'xz', z: 'xy' } as const;

export function groundCobbleCoverage(paved: Node<'float'>, pavingKind: Node<'float'>): Node<'float'> {
  return paved.mul(max(0, float(1).sub(pavingKind.mul(2))));
}

export function groundCliffCoverage(paved: Node<'float'>, worldNormal: Node<'vec3'>): Node<'float'> {
  return float(1).sub(paved).mul(smoothstep(0.10, 0.65, float(1).sub(abs(worldNormal.y))));
}

export function groundCliffProjectionWeights(worldNormal: Node<'vec3'>): Node<'vec3'> {
  const weights: Node<'vec3'> = pow(abs(worldNormal), vec3(4));
  return weights.div(max(weights.x.add(weights.y).add(weights.z), 0.0001));
}

const pavedHash = (cell: Node<'vec2'>): Node<'float'> => fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453));

/** Eight-way terrain, laid surfaces, triplanar cliffs and fairy vegetation in native TSL. */
export function applyGroundSurfaceNodes(material: MeshStandardNodeMaterial, inputs: GroundSurfaceInputs): void {
  const fallbacks = new Map<Binding<Texture | null>, DataTexture>();
  material.addEventListener('dispose', () => {
    for (const fallback of fallbacks.values()) fallback.dispose();
    fallbacks.clear();
  });

  // Explicit world coordinates bypass the texture's object-UV repeat matrix. Each sample follows
  // its stable wrapper so maps supplied after node construction do not require new materials.
  const sample = (binding: Binding<Texture | null>, uv: Node<'vec2'>, albedo = false): Node<'vec4'> => {
    let fallback = fallbacks.get(binding);
    if (!fallback) {
      // Distinct wrapper fallbacks must have distinct identities: otherwise the compiler would
      // merge two not-yet-loaded maps into one binding before their real textures arrive.
      fallback = new DataTexture(new Uint8Array(albedo ? [255, 255, 255, 255] : [128, 128, 255, 255]), 1, 1, RGBAFormat);
      if (albedo) fallback.colorSpace = SRGBColorSpace;
      fallback.needsUpdate = true;
      fallbacks.set(binding, fallback);
    }
    const fallbackTexture = fallback;
    const node = texture(binding.value ?? fallbackTexture, uv);
    node.updateMatrix = false;
    const updateTexture = node.update.bind(node);
    node.onRenderUpdate(frame => {
      node.value = binding.value ?? fallbackTexture;
      updateTexture(frame);
    });
    return node;
  };
  const triplanar = (binding: Binding<Texture | null>, point: Node<'vec3'>, weights: Node<'vec3'>, albedo = false): Node<'vec4'> =>
    sample(binding, point[GROUND_CLIFF_PROJECTIONS.x], albedo).mul(weights.x)
      .add(sample(binding, point[GROUND_CLIFF_PROJECTIONS.y], albedo).mul(weights.y))
      .add(sample(binding, point[GROUND_CLIFF_PROJECTIONS.z], albedo).mul(weights.z));
  const triplanarBump = (point: Node<'vec3'>, weights: Node<'vec3'>, worldNormal: Node<'vec3'>): Node<'vec3'> => {
    const x: Node<'vec2'> = sample(inputs.uGroundStoneNormal, point.zy).xy.mul(2).sub(1);
    const y: Node<'vec2'> = sample(inputs.uGroundStoneNormal, point.xz).xy.mul(2).sub(1);
    const z: Node<'vec2'> = sample(inputs.uGroundStoneNormal, point.xy).xy.mul(2).sub(1);
    const bump: Node<'vec3'> = vec3(0, x.y, x.x).mul(weights.x)
      .add(vec3(y.x, 0, y.y).mul(weights.y)).add(vec3(z.x, z.y, 0).mul(weights.z));
    return bump.sub(worldNormal.mul(dot(bump, worldNormal)));
  };

  const splatA: Node<'vec4'> = varying(attribute('aSplatA', 'vec4'));
  const splatB: Node<'vec4'> = varying(attribute('aSplatB', 'vec4'));
  const ground: Node<'vec4'> = varying(attribute('aGround', 'vec4'));
  const pavingKind: Node<'float'> = varying(attribute('aPaved', 'float'));
  const tiling: Node<'vec4'> = reference('value', 'vec4', inputs.uDetailTiling);
  const cobbleTiling: Node<'float'> = reference('value', 'float', inputs.uCobbleTiling);
  const stoneTiling: Node<'float'> = reference('value', 'float', inputs.uGroundStoneTiling);
  const stoneReady: Node<'float'> = reference('value', 'float', inputs.uGroundStoneReady);
  const stoneMean: Node<'vec3'> = reference('value', 'vec3', inputs.uGroundStoneMean);
  const grassTiling: Node<'float'> = reference('value', 'float', inputs.uFairyGrassTiling);
  const grassReady: Node<'float'> = reference('value', 'float', inputs.uFairyGrassReady);
  const grassMean: Node<'vec3'> = reference('value', 'vec3', inputs.uFairyGrassMean);
  const geometricWorldNormal: Node<'vec3'> = normalize(normalWorldGeometry);
  const cobbleCoverage: Node<'float'> = groundCobbleCoverage(splatB.z, pavingKind);
  const cliffCoverage: Node<'float'> = groundCliffCoverage(splatB.z, geometricWorldNormal);
  const projectionWeights: Node<'vec3'> = groundCliffProjectionWeights(geometricWorldNormal);
  // The biome sampler writes the alpine exposure into the formerly unused fourth ground byte.
  const alpine: Node<'float'> = ground.w;
  const rockPoint = positionWorld.div(vec3(42, 36, 42));
  const firstRock = triplanar(inputs.uAlpineRock, rockPoint, projectionWeights, true).rgb;
  const secondRock = triplanar(inputs.uAlpineRock,
    vec3(rockPoint.z, rockPoint.y, rockPoint.x.negate()).mul(0.617).add(vec3(0.37, 0.19, 0.73)),
    projectionWeights.zyx, true).rgb;
  const alpineRock: Node<'vec3'> = mix(firstRock, secondRock, alpineRockBlend(positionWorld));
  // Broad height variation lets snow follow shelves and gullies instead of drawing a level cap.
  const alpineColor = alpineSurfaceColor(alpineRock, positionWorld, geometricWorldNormal.y);

  // One shared fragment calculation feeds color, roughness and normals. The returned struct
  // keeps all relief terms in the same scope and avoids sampling the terrain three times.
  const surface: Node<'struct'> = Fn((): Node<'struct'> => {
    const detailUv: Node<'vec2'> = positionWorld.xz.mul(tiling.x);
    const detail: Node<'vec4'> = sample(inputs.uDetail, detailUv).add(DETAIL_VALUE_OFFSET);
    const near: Node<'vec4'> = sample(inputs.uMacro, positionWorld.xz.mul(tiling.y)).add(DETAIL_VALUE_OFFSET);
    const middle: Node<'vec4'> = sample(inputs.uMacro, positionWorld.xz.mul(tiling.z)).add(DETAIL_VALUE_OFFSET);
    const macro: Node<'vec4'> = sample(inputs.uMacro, positionWorld.xz.mul(tiling.w)).add(DETAIL_VALUE_OFFSET);
    const channel: Node<'vec4'> = vec4(
      splatA.x.add(splatA.y.mul(0.55)),
      splatA.y.mul(0.45).add(splatB.x).add(splatB.y).add(splatB.w),
      splatA.z, splatA.w.add(splatB.z),
    ).toVar();
    channel.mulAssign(channel);
    channel.divAssign(max(0.001, channel.x.add(channel.y).add(channel.z).add(channel.w)));
    const macroShade: Node<'float'> = mix(1, dot(channel, near), 0.45)
      .mul(mix(1, dot(channel, middle), 0.72)).mul(mix(1, dot(channel, macro), 0.72)).toVar();
    const detailStrength: Node<'float'> = dot(channel, vec4(0.28, 0.25, 0.36, 0.65));
    const shade: Node<'float'> = clamp(mix(1, dot(channel, detail), detailStrength).mul(macroShade), 0.50, 1.46).toVar();
    const perpendicular: Node<'float'> = ground.x.sub(0.5).mul(7);
    const rut: Node<'float'> = float(1).sub(grassReady).mul(ground.y)
      .mul(exp(pow(abs(perpendicular).sub(0.55).div(0.16), 2).negate()));
    const rutShade: Node<'float'> = float(1).sub(rut.mul(0.22));
    shade.mulAssign(rutShade);
    const macroBump: Node<'float'> = macroShade.mul(rutShade).toVar();
    const bumpGS: Node<'vec4'> = sample(inputs.uNormalGS, detailUv).mul(2).sub(1);
    const bumpRV: Node<'vec4'> = sample(inputs.uNormalRV, detailUv).mul(2).sub(1);
    const groundBump: Node<'vec2'> = bumpGS.xy.mul(channel.x).add(bumpGS.zw.mul(channel.y))
      .add(bumpRV.xy.mul(channel.z)).add(bumpRV.zw.mul(channel.w)).toVar();
    const dryness: Node<'float'> = smoothstep(0.88, 1.16, macro.x);
    const tint: Node<'vec3'> = mix(vec3(0.880, 1.056, 0.802), vec3(1.115, 0.998, 0.685), dryness).mul(channel.x)
      .add(vec3(1.184, 0.973, 0.722).mul(channel.y))
      .add(vec3(0.987, 0.997, 1.068).mul(channel.z))
      .add(vec3(1.035, 0.996, 0.937).mul(channel.w)).toVar();

    const paved: Node<'float'> = splatB.z;
    const stoneWeight: Node<'float'> = max(0, float(1).sub(pavingKind.mul(2)));
    const plankWeight: Node<'float'> = max(0, pavingKind.mul(2).sub(1));
    const brickWeight: Node<'float'> = float(1).sub(stoneWeight).sub(plankWeight);
    const cobbleBump: Node<'vec2'> = vec2(0).toVar();
    const cobbleRoughness: Node<'float'> = float(0.97).toVar();
    If(cobbleCoverage.greaterThan(0.004), () => {
      const cobble: Node<'vec4'> = sample(inputs.uCobble, positionWorld.xz.mul(cobbleTiling));
      const stoneDetail: Node<'vec3'> = vec3(1).toVar();
      const stoneNormal: Node<'vec2'> = vec2(0).toVar();
      If(stoneReady.greaterThan(0.5), () => {
        const stoneUv: Node<'vec2'> = positionWorld.xz.mul(stoneTiling);
        const relative: Node<'vec3'> = sample(inputs.uGroundStoneAlbedo, stoneUv, true).rgb.div(stoneMean).toVar();
        const luma: Node<'float'> = dot(relative, vec3(0.2126, 0.7152, 0.0722));
        relative.assign(mix(vec3(luma), relative, 0.45));
        stoneDetail.assign(clamp(mix(vec3(1), relative, 0.86), vec3(0.42), vec3(1.90)));
        stoneNormal.assign(sample(inputs.uGroundStoneNormal, stoneUv).xy.mul(2).sub(1));
        cobbleRoughness.assign(mix(0.95, clamp(sample(inputs.uGroundStoneRoughness, stoneUv).g, 0.52, 0.96), cobble.a));
      });
      shade.assign(mix(shade, cobble.r.mul(1.5).mul(macroShade), cobbleCoverage));
      groundBump.mulAssign(float(1).sub(cobbleCoverage));
      cobbleBump.assign(cobble.gb.mul(2).sub(1).add(stoneNormal.mul(0.65).mul(cobble.a)));
      macroBump.assign(mix(macroBump, macroShade, cobbleCoverage));
      tint.assign(mix(tint, mix(vec3(1), stoneDetail, cobble.a), cobbleCoverage));
    });

    const laid: Node<'float'> = paved.mul(float(1).sub(stoneWeight));
    If(laid.greaterThan(0.004), () => {
      const unit: Node<'vec2'> = vec2(0.62, 0.52).mul(stoneWeight).add(vec2(0.68, 0.30).mul(brickWeight))
        .add(vec2(2.40, 0.30).mul(plankWeight));
      const jointWidth: Node<'float'> = stoneWeight.mul(0.045).add(brickWeight.mul(0.026)).add(plankWeight.mul(0.020));
      const toneVariation: Node<'float'> = stoneWeight.mul(0.30).add(brickWeight.mul(0.15)).add(plankWeight.mul(0.22));
      const jointDark: Node<'float'> = stoneWeight.mul(0.52).add(brickWeight.mul(0.60)).add(plankWeight.mul(0.66));
      const point: Node<'vec2'> = positionWorld.xz;
      const row: Node<'float'> = floor(point.y.div(unit.y));
      const bond: Node<'float'> = mix(pavedHash(vec2(row, 7.3)), fract(row.mul(0.5)), brickWeight);
      const column: Node<'float'> = point.x.div(unit.x).add(bond);
      const cell: Node<'vec2'> = vec2(floor(column), row);
      const border: Node<'float'> = min(float(0.5).sub(abs(fract(column).sub(0.5))).mul(unit.x),
        float(0.5).sub(abs(fract(point.y.div(unit.y)).sub(0.5))).mul(unit.y));
      const tone: Node<'float'> = pavedHash(cell.add(0.5));
      const footprint: Node<'float'> = fwidth(point.x).add(fwidth(point.y));
      const face: Node<'float'> = smoothstep(0, jointWidth.mul(float(0.55).add(tone.mul(0.9))).add(footprint), border);
      const grain: Node<'float'> = float(1).add(plankWeight.mul(0.085).mul(sin(point.x.mul(23).add(tone.mul(40)))));
      const bed: Node<'float'> = mix(1, detail.w, 0.25);
      const pavedShade: Node<'float'> = float(1).sub(toneVariation.mul(0.5)).add(toneVariation.mul(tone))
        .mul(mix(jointDark, 1, face)).mul(grain).mul(bed);
      shade.assign(mix(shade, clamp(pavedShade.mul(macroShade), 0.42, 1.46), laid));
      macroBump.assign(mix(macroBump, macroShade.mul(mix(0.78, 1, face)), laid));
      tint.assign(mix(tint, vec3(1), laid));
    });

    const cliffRoughness: Node<'float'> = float(0.96).toVar();
    const cliffBump: Node<'vec3'> = vec3(0).toVar();
    If(cliffCoverage.greaterThan(0.004), () => {
      const cliffMacro: Node<'float'> = triplanar(inputs.uMacro, positionWorld.mul(tiling.y), projectionWeights).z.add(DETAIL_VALUE_OFFSET);
      const rockRelative: Node<'vec3'> = vec3(1).toVar();
      If(stoneReady.greaterThan(0.5), () => {
        const stonePoint: Node<'vec3'> = positionWorld.mul(stoneTiling);
        rockRelative.assign(triplanar(inputs.uGroundStoneAlbedo, stonePoint, projectionWeights, true).rgb.div(stoneMean));
        cliffBump.assign(triplanarBump(stonePoint, projectionWeights, geometricWorldNormal));
        cliffRoughness.assign(clamp(triplanar(inputs.uGroundStoneRoughness, stonePoint, projectionWeights).g, 0.72, 0.98));
      }).Else(() => {
        rockRelative.assign(vec3(triplanar(inputs.uDetail, positionWorld.mul(tiling.x), projectionWeights).z.add(DETAIL_VALUE_OFFSET)));
      });
      const rockLuma: Node<'float'> = max(0.05, dot(rockRelative, vec3(0.2126, 0.7152, 0.0722))).toVar();
      const rockChroma: Node<'vec3'> = clamp(mix(vec3(1), rockRelative.div(rockLuma), 0.35), vec3(0.78), vec3(1.22)).toVar();
      const moss: Node<'float'> = float(0.34).add(smoothstep(0.12, 0.83, max(geometricWorldNormal.y, 0)).mul(0.46))
        .mul(smoothstep(0.88, 1.16, cliffMacro)).toVar();
      If(grassReady.greaterThan(0.5), () => {
        const mossPatch: Node<'float'> = smoothstep(0.88, 1.10, cliffMacro.add(max(geometricWorldNormal.y, 0).mul(0.24)));
        const mossDetail: Node<'vec3'> = triplanar(inputs.uFairyGrassAlbedo, positionWorld.mul(grassTiling), projectionWeights, true).rgb.div(grassMean);
        rockLuma.assign(mix(rockLuma, clamp(dot(mossDetail, vec3(0.2126, 0.7152, 0.0722)), 0.5, 1.5).mul(0.88), mossPatch.mul(0.8)));
        moss.assign(max(moss, mossPatch.mul(0.86)));
      });
      const mossTint: Node<'vec3'> = mix(vec3(1), vec3(0.49, 0.74, 0.30), moss);
      const cliffShade: Node<'float'> = clamp(mix(1, cliffMacro, 0.75).mul(mix(1, rockLuma, 0.82)), 0.46, 1.50)
        .mul(mix(1, 0.80, grassReady));
      shade.assign(mix(shade, cliffShade, cliffCoverage));
      tint.assign(mix(tint, rockChroma.mul(mossTint), cliffCoverage));
      groundBump.mulAssign(float(1).sub(cliffCoverage));
      macroBump.assign(mix(macroBump, mix(1, cliffMacro, 0.75), cliffCoverage));
    });

    const color: Node<'vec3'> = tint.mul(shade).toVar();
    If(grassReady.greaterThan(0.5), () => {
      const grassCoverage: Node<'float'> = float(1).sub(paved).mul(float(1).sub(cliffCoverage))
        .mul(float(0.65).add(channel.x.mul(0.35)));
      const grassUv: Node<'vec2'> = positionWorld.xz.mul(grassTiling);
      const grassRelative: Node<'vec3'> = sample(inputs.uFairyGrassAlbedo, grassUv, true).rgb.div(grassMean);
      const grassDetail: Node<'vec3'> = clamp(grassRelative, vec3(0.28), vec3(2.15));
      color.mulAssign(mix(vec3(1), grassDetail, grassCoverage));
      const grassNormal: Node<'vec2'> = sample(inputs.uFairyGrassNormal, grassUv).xy.mul(2).sub(1);
      groundBump.assign(mix(groundBump, grassNormal.mul(1.3), grassCoverage));
      macroBump.assign(mix(macroBump, 1, grassCoverage.mul(0.95)));
    });
    return GroundSurface(color, macroBump, groundBump, cobbleBump, cobbleCoverage,
      cobbleRoughness, cliffBump, cliffCoverage, cliffRoughness);
  })();

  const surfaceColor: Node<'vec3'> = surface.get('color') as Node<'vec3'>;
  const macroShade: Node<'float'> = surface.get('macroShade') as Node<'float'>;
  const groundBump: Node<'vec2'> = surface.get('groundBump') as Node<'vec2'>;
  const cobbleBump: Node<'vec2'> = surface.get('cobbleBump') as Node<'vec2'>;
  const cobbleAmount: Node<'float'> = surface.get('cobbleCoverage') as Node<'float'>;
  const cliffBump: Node<'vec3'> = surface.get('cliffBump') as Node<'vec3'>;
  const cliffAmount: Node<'float'> = surface.get('cliffCoverage') as Node<'float'>;
  composeSurface(material, {
    color: previous => mix(previous.mul(surfaceColor), alpineColor, alpine),
    roughness: previous => mix(mix(previous, surface.get('cobbleRoughness') as Node<'float'>, cobbleAmount),
      surface.get('cliffRoughness') as Node<'float'>, cliffAmount),
    normal: previous => Fn(() => {
      const gradient: Node<'vec2'> = vec2(dFdx(macroShade), dFdy(macroShade)).mul(0.6);
      const sigmaX: Node<'vec3'> = normalize(dFdx(positionView));
      const sigmaY: Node<'vec3'> = normalize(dFdy(positionView));
      const r1: Node<'vec3'> = cross(sigmaY, previous);
      const r2: Node<'vec3'> = cross(previous, sigmaX);
      const determinant: Node<'float'> = dot(sigmaX, r1);
      const result: Node<'vec3'> = normalize(previous.mul(abs(determinant))
        .sub(r1.mul(gradient.x).add(r2.mul(gradient.y)).mul(sign(determinant)))).toVar();
      const viewDirection = (direction: Node<'vec3'>): Node<'vec3'> => cameraViewMatrix.mul(vec4(direction, 0)).xyz;
      result.assign(normalize(result.add(viewDirection(vec3(groundBump.x, 0, groundBump.y).mul(0.3)))));
      result.assign(normalize(result.add(viewDirection(vec3(cobbleBump.x, 0, cobbleBump.y).mul(0.72).mul(cobbleAmount)))));
      result.assign(normalize(result.add(viewDirection(cliffBump).mul(0.72).mul(cliffAmount))));
      // Broad fractured faces carry the shape; suppress the old all-over terrain grain here.
      const face: Node<'vec3'> = normalize(cross(dFdx(positionView), dFdy(positionView)));
      return normalize(mix(result, face, alpine.mul(0.35)));
    })(),
  });
  material.userData.groundSurface = {
    inputs,
    nodes: { surface, cobbleCoverage, cliffCoverage, projectionWeights, surfaceColor },
  };
}
