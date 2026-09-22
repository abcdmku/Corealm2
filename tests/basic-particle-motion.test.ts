import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { basicParticleInputs, BasicParticleMotion } from '../game/src/render/basicParticleMotion.js';
import { BasicElementalVfx } from '../game/src/render/basicElementalVfx.js';
import { ElementalParticleCloud } from '../game/src/render/elementalParticleCloud.js';
import { ElementalFluidBodies } from '../game/src/render/elementalFluidBodies.js';
import { basicSpellPath } from '../game/src/render/basicSpellPath.js';
import { BASIC_ELEMENTAL_SPELL } from '../game/src/content/basicSpellVariants.js';
import { ELEMENTAL_ENERGY } from '../game/src/render/elementalEnergyStyles.js';
import type { ElementalCast } from '../game/src/systems/elementalAttacks.js';
import type { SpellElement, Vec3 } from '../game/src/contracts.js';
import { lowerToWgsl } from './helpers/wgsl.js';

const release: Vec3 = [2, 3, 4], impact: Vec3 = [8, 2, 12], groundY = .5;
const random = (i: number, s = 0) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
function cast(element: SpellElement, density = 1, missed = false): ElementalCast {
  return { id: 1, spellId: BASIC_ELEMENTAL_SPELL[element], origin: [0, 0, 0], aim: impact,
    started: 1300, releaseAt: 150, release, particleScale: density, missed,
    pulses: [{ at: 700, point: impact, radius: 1, damage: 1, form: 'dart', height: 1.5 }],
    resolved: 0, damage: 0, hits: 0 };
}

// Evaluate the actual input graph against a draw's attributes/uniforms, before particle raster shading.
// This is deliberately small: unsupported nodes fail rather than silently approximating the shader.
type Graph = Node & { node?: Node; nodes?: Node[]; components?: string; value?: unknown; property?: string;
  object?: object | null; op?: string; method?: string; aNode?: Node; bNode?: Node; cNode?: Node;
  condNode?: Node; ifNode?: Node; elseNode?: Node; getAttributeName?(): string };
function evaluate(root: Node, mesh: THREE.Mesh, index: number): number[] {
  const cache = new Map<Node, number[]>();
  const vector = (value: unknown): number[] => typeof value === 'number' ? [value]
    : typeof value === 'boolean' ? [Number(value)]
    : (value as { toArray(): number[] }).toArray();
  const run = (source: Node): number[] => {
    const cached = cache.get(source); if (cached) return cached;
    const node = source as Graph, kind = node.constructor.name;
    const a = () => run(node.aNode!), b = () => run(node.bNode!), c = () => run(node.cNode!);
    const zip = (fn: (...numbers: number[]) => number, ...inputs: number[][]) =>
      Array.from({ length: Math.max(...inputs.map(value => value.length)) }, (_, component) =>
        fn(...inputs.map(value => value.length === 1 ? value[0]! : value[component]!)));
    let result: number[];
    if (kind === 'ConstNode') result = vector(node.value);
    else if (kind === 'VarNode' || kind === 'ConvertNode') result = run(node.node!);
    else if (kind === 'JoinNode') result = node.nodes!.flatMap(run);
    else if (kind === 'SplitNode') {
      const value = run(node.node!);
      result = [...node.components!].map(component => value['xyzw'.indexOf(component) >= 0
        ? 'xyzw'.indexOf(component) : 'rgba'.indexOf(component)]!);
    } else if (kind === 'AttributeNode') {
      const attribute = mesh.geometry.getAttribute(node.getAttributeName!());
      result = Array.from({ length: attribute.itemSize }, (_, component) => Number(attribute.array[index * attribute.itemSize + component]));
    } else if (kind === 'ReferenceNode') {
      let value: unknown = node.object ?? mesh;
      for (const property of node.property!.split('.')) value = (value as Record<string, unknown>)[property];
      result = vector(value);
    } else if (kind === 'ConditionalNode') result = run(run(node.condNode!)[0] ? node.ifNode! : node.elseNode!);
    else if (kind === 'OperatorNode') {
      const operations: Record<string, (x: number, y: number) => number> = {
        '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y,
        '==': (x, y) => Number(x === y), '>=': (x, y) => Number(x >= y), '||': (x, y) => Number(Boolean(x || y)),
      };
      if (!operations[node.op!]) throw new Error(`Unsupported operator ${node.op}`);
      result = zip(operations[node.op!]!, a(), b());
    } else if (kind === 'MathNode') {
      switch (node.method) {
        case 'sin': result = a().map(Math.sin); break;
        case 'cos': result = a().map(Math.cos); break;
        case 'negate': result = a().map(value => -value); break;
        case 'max': result = zip(Math.max, a(), b()); break;
        case 'clamp': result = zip((x, lo, hi) => Math.max(lo, Math.min(hi, x)), a(), b(), c()); break;
        case 'mix': result = zip((x, y, t) => x * (1 - t) + y * t, a(), b(), c()); break;
        default: throw new Error(`Unsupported math ${node.method}`);
      }
    } else throw new Error(`Unsupported node ${kind}`);
    cache.set(source, result); return result;
  };
  return run(root);
}

function expected(phase: 'flight' | 'impact', element: SpellElement, age: number, index: number, gain: number) {
  const palette = ELEMENTAL_ENERGY[BASIC_ELEMENTAL_SPELL[element]], local = (age - 700) / 1000;
  let position: number[], size: number, alpha: number, hex: number, energy: number;
  if (phase === 'flight') {
    const v = clamp((age - 150) / 550) - random(index) * .14, point = basicSpellPath(release, impact)(v);
    const angle = random(index, 1) * Math.PI * 2 + age * .015, r = .035 + random(index, 2) * .10;
    position = [point[0] + .8 * Math.cos(angle) * r, point[1] + Math.sin(angle) * r, point[2] - .6 * Math.cos(angle) * r];
    size = .014 + random(index, 3) * .019; alpha = v >= 0 ? .7 : 0;
    hex = element === 'fire' ? (index % 9 ? 0xc43b08 : 0xffb654) : index % 5 ? palette.edge : palette.core;
    energy = element === 'wind' || element === 'fire' ? 1.1 : 1.7;
  } else {
    const angle = random(index, 4) * Math.PI * 2, distance = local * (.5 + random(index, 5) * 2);
    position = [impact[0] + Math.cos(angle) * distance, element === 'fire'
      ? impact[1] + local * (.3 + random(index, 6) * 1.5)
      : Math.max(groundY + .03, impact[1] + local * random(index, 6) * 2 - local * local * 3.8),
    impact[2] + Math.sin(angle) * distance];
    size = .013 + random(index, 7) * .020; alpha = (1 - smooth(local / .88)) * (1 - random(index, 8) * .5);
    hex = element === 'fire' ? (index % 11 ? 0xc73a09 : 0xffb654) : palette.edge;
    energy = element === 'wind' ? 1 : element === 'fire' ? 1.1 : 1.8;
  }
  return { centre: [...position, size], tint: [...new THREE.Color(hex).multiplyScalar(energy * gain).toArray(), alpha],
    shape: [index * .71, .55 + Math.abs(Math.sin(index * 3)) * .6, phase === 'flight' ? 1.2 : 1.3, index] };
}

describe('GPU basic particle motion', () => {
  it('matches the authored absolute-time path, scatter, color, energy, fade and shapes', () => {
    const pool = new BasicParticleMotion(new THREE.Group());
    try {
      for (const element of ['wind', 'earth', 'water', 'fire'] as const) for (const age of [0, 170, 480, 700, 920, 1470, 1578]) {
        const authored = cast(element, 4.2), now = authored.started + age;
        pool.begin(now / 1000, 1.15); pool.update(authored, now, element, release, impact, .6, .8, groundY);
        const phase = age < 700 ? 'flight' : 'impact', graph = basicParticleInputs(phase);
        for (const index of [0, 5, 9, 11, 73, 755]) {
          const sample = expected(phase, element, age, index, 1.15);
          for (const channel of ['centre', 'tint', 'shape'] as const)
            evaluate(graph[channel], pool.meshes[phase], index).forEach((value, component) =>
              expect(value, `${element}/${phase}/${age}/${index}/${channel}/${component}`).toBeCloseTo(sample[channel][component]!, 4));
        }
      }
    } finally { pool.dispose(); }
  });

  it('counts live candidates at every density and transition without uploading new attributes', () => {
    const pool = new BasicParticleMotion(new THREE.Group());
    const attributes = Object.values(pool.meshes).flatMap(mesh => Object.values(mesh.geometry.attributes)) as THREE.BufferAttribute[];
    const original = attributes.map(attribute => ({ version: attribute.version, array: Array.from(attribute.array) }));
    try {
      for (const density of [1, 1.6, 2.6, 4.2]) for (const missed of [false, true])
        for (const age of [-1, 0, 151, 175, 300, 699, 700, 1000, 1550, 1575, 1580, 1621]) {
          const authored = cast('wind', density, missed), now = authored.started + age;
          pool.begin(now / 1000); pool.update(authored, now, 'wind', release, impact, .6, .8, groundY);
          const total = Math.round((age < 700 ? 180 : missed ? 32 : 320) * density);
          let live = 0;
          if (age >= 0 && age <= 1620) for (let index = 0; index < total; index++)
            if (expected(age < 700 ? 'flight' : 'impact', 'wind', age, index, 1).tint[3]! >= .006) live++;
          expect(pool.liveCount, `${density}/${missed}/${age}`).toBe(live);
          expect(pool.dropped).toBe(0);
          expect(Object.values(pool.meshes).filter(mesh => mesh.visible).length).toBe(live ? 1 : 0);
        }
      attributes.forEach((attribute, index) => {
        expect(attribute.version).toBe(original[index]!.version);
        expect(Array.from(attribute.array)).toEqual(original[index]!.array);
      });
    } finally { pool.dispose(); }
  });

  it('shares graphs but keeps each caster independent and retains the surviving material', () => {
    const first = new BasicParticleMotion(new THREE.Group()), second = new BasicParticleMotion(new THREE.Group());
    const dispose = vi.spyOn(first.meshes.flight.material, 'dispose');
    try {
      expect(first.meshes.flight.material).toBe(second.meshes.flight.material);
      expect(first.meshes.impact.material).toBe(second.meshes.impact.material);
      const request = cast('earth');
      first.begin(1.8, 1.05); first.update(request, 1800, 'earth', release, impact, .6, .8, groundY);
      second.begin(2.4, 1.25); second.update(cast('fire'), 2400, 'fire', release, impact, .6, .8, groundY);
      expect(first.meshes.flight.visible).toBe(true); expect(second.meshes.impact.visible).toBe(true);
      expect(first.meshes.flight.userData.basicParticle).not.toBe(second.meshes.flight.userData.basicParticle);
      expect(first.meshes.flight.userData.effectClock.value).toBe(1.8);
      first.dispose(); expect(dispose).not.toHaveBeenCalled();
      second.dispose(); expect(dispose).toHaveBeenCalledOnce();
    } finally { first.dispose(); second.dispose(); vi.restoreAllMocks(); }
  });

  it('keeps only sparse fragment/drop CPU submissions and reports moved light particles separately', () => {
    const parent = new THREE.Group();
    const fragments = new ElementalParticleCloud(parent, 'fragment', 320), fluids = new ElementalFluidBodies(parent);
    const basic = new BasicElementalVfx(parent, () => .5, fragments, fluids);
    const fragmentPut = vi.spyOn(fragments, 'put'), fluidPut = vi.spyOn(fluids, 'put');
    try {
      for (const element of ['earth', 'water', 'fire'] as const) {
        fragmentPut.mockClear(); fluidPut.mockClear();
        basic.begin(2.4, 1.15); basic.update(cast(element, 4.2), 2400, element); basic.end();
        expect(basic.particleCount).toBe(1344);
        expect(basic.droppedParticles).toBe(0);
        if (element === 'earth') expect(fragmentPut).toHaveBeenCalledTimes(Math.ceil(1344 / 5));
        if (element === 'water') expect(fluidPut.mock.calls.filter(call => call[0] === 'drop')).toHaveLength(84);
        if (element === 'fire') expect(fragmentPut).not.toHaveBeenCalled();
      }
      basic.begin(5); basic.end(); expect(basic.particleCount).toBe(0);
    } finally { basic.dispose(); fragments.dispose(); fluids.dispose(); vi.restoreAllMocks(); }
  });

  it('keeps millisecond motion precision after a long-running session', () => {
    const pool = new BasicParticleMotion(new THREE.Group()), request = cast('wind');
    request.started = 864_000_000;
    try {
      const sampled: number[] = [];
      for (const age of [500, 501, 502]) {
        pool.begin((request.started + age) / 1000);
        pool.update(request, request.started + age, 'wind', release, impact, .6, .8, groundY);
        sampled.push(Math.fround(pool.meshes.flight.userData.basicParticle.timing.x));
      }
      expect(sampled[0]).toBeCloseTo(.500, 6);
      expect(sampled[1]).toBeCloseTo(.501, 6);
      expect(sampled[2]).toBeCloseTo(.502, 6);
    } finally { pool.dispose(); }
  });

  it('lowers both shared recipes with independent static attributes', () => {
    const pools = [new BasicParticleMotion(new THREE.Group()), new BasicParticleMotion(new THREE.Group())];
    try {
      pools.forEach((pool, index) => { pool.begin(1.8 + index); pool.update(cast('wind'), 1800 + index * 1000, 'wind', release, impact, .6, .8, groundY); });
      for (const phase of ['flight', 'impact'] as const) {
        const a = lowerToWgsl(pools[0]!.meshes[phase]), b = lowerToWgsl(pools[1]!.meshes[phase]);
        expect(a).toEqual(b); expect(a.vertex).toContain('basicMotion'); expect(a.vertex).toContain('basicShape');
        expect(a.fragment).toContain('discard');
      }
    } finally { pools.forEach(pool => pool.dispose()); }
  });
});
