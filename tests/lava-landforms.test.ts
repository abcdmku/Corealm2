import { describe, expect, it } from 'vitest';
import { carveLavaTerrain, lavaBankWidthAt, lavaSections, WILDERNESS_LAVA_CHANNELS,
  DEEP_WILDERNESS_LAVA_LAB_CHANNELS, type LavaChannel } from '../game/src/content/wildernessLava.js';
import { buildLavaSurfaceField } from '../game/src/world/lavaSurface.js';
import { buildLavaTextureField } from '../game/src/world/lavaTextureFlow.js';
import { rockMassHeight } from '../game/src/world/lavaLandforms.js';

const channel: LavaChannel = { id: 'cut', points: [[0,0],[0,20]], bedHeights: [0,-1],
  halfWidth: 4, bankWidth: 6, depth: 2, seed: 12, openEnds: [true,true],
  rockMasses: [{ id:'wall', crown:8, polygon:[[-12,4],[-2,4],[-2,16],[-12,16]] }], rugged:true };

describe('volcanic valley, bed and free surface', () => {
  it('uses sloping shoulders and different widths on opposite banks without exceeding the reserved footprint', () => {
    const mass = { ...channel.rockMasses![0]!, weathered:true };
    const a = rockMassHeight(3,-7,10,mass), b = rockMassHeight(3,-2,10,mass);
    expect(a).toBeGreaterThan(b);
    expect(a).toBeLessThan(mass.crown);
    expect(rockMassHeight(3,-30,10,mass)).toBe(3);
    const flow = WILDERNESS_LAVA_CHANNELS[0]!;
    const widths = lavaSections(flow,3).flatMap(row => [-1,1].map(side => lavaBankWidthAt(flow,row.progress,side)));
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(1);
    expect(Math.max(...widths)).toBeLessThanOrEqual(flow.bankWidth);
  });
  it('raises a connected resistant body while the channel cuts through its edge', () => {
    const mass = channel.rockMasses![0]!;
    expect(rockMassHeight(3,-9,10,mass)).toBe(8);
    expect(rockMassHeight(3,-30,10,mass)).toBe(3);
    const cut = (x:number,z:number) => carveLavaTerrain(3,x,z,[channel]);
    expect(cut(-9,10)).toBeGreaterThan(6);
    expect(cut(0,10)).toBeCloseTo(-.5,2);
    expect(cut(0,10)).toBeLessThan(cut(3,10));
  });
  it('keeps the liquid grade independent of ground bumps and the surrounding rock crown', () => {
    const smooth = buildLavaSurfaceField([channel], () => 0);
    const rough = buildLavaSurfaceField([channel], (x,z) => Math.sin(x*3+z)*5);
    for (const x of [-2,-1,0,1,2]) {
      expect(rough(x,10)).toBeCloseTo(smooth(x,10),6);
      expect(rough(x,10)).toBeCloseTo(.54,2);
    }
    expect(rough(0,15)).toBeLessThan(rough(0,5));
  });
  it('transports one fixed scale downstream and aligns tributaries at their mouth', () => {
    const tributary: LavaChannel = { ...channel, id:'tributary', rockMasses:[],
      points:[[0,10],[10,10]], bedHeights:[-.5,.5], halfWidth:1.5 };
    const field = buildLavaTextureField([channel,tributary], () => 0);
    const parent = buildLavaTextureField([channel], () => 0);
    expect(field(0,15)[1]).toBeGreaterThan(field(0,5)[1]);
    expect(field(8,10)[1]).toBeLessThan(field(5,10)[1]);
    expect(field(0,10)).toEqual(parent(0,10));
    const early = field(0,12)[1] - field(0,10)[1];
    const late = (field(0,12)[1] - 3600*.11) - (field(0,10)[1] - 3600*.11);
    expect(late).toBeCloseTo(early,8);
  });
  it('does not invert transport along the authored world tributaries and trunks', () => {
    for (const paths of [WILDERNESS_LAVA_CHANNELS, DEEP_WILDERNESS_LAVA_LAB_CHANNELS.filter(c => c.id.startsWith('lab-bypass'))]) {
      const field = buildLavaTextureField(paths, () => 0);
      for (const flow of paths.filter(c => c.kind !== 'pool')) {
        for (const row of lavaSections(flow, 2).filter(r => r.progress > .05 && r.progress < .95)) {
          const before = field(row.x - row.tx * .1, row.z - row.tz * .1)[1];
          const after = field(row.x + row.tx * .1, row.z + row.tz * .1)[1];
          expect(after - before, `${flow.id} station ${row.progress}`).toBeGreaterThan(-.01);
        }
      }
    }
  });
});
