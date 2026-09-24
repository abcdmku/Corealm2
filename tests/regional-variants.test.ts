import { expect, it } from 'vitest';
import { REGIONAL_VARIANT_RESERVED_PACK_IDS, AMETHYST_CAVE_HABITAT } from '../game/src/content/regionalVariantHabitats.js';
import { activatedRegionalPackIds } from '../game/src/content/regionalPackActivation.js';

it('never overlays a regional pack on an occupied variant reservation when regions activate', () => {
 const active = activatedRegionalPackIds({regions:['fallowmarch','vellenwood','karrowmoor','kilnhalt'],
  excludedPackIds:REGIONAL_VARIANT_RESERVED_PACK_IDS,assignmentOverrides:{}});
 for (const id of REGIONAL_VARIANT_RESERVED_PACK_IDS) expect(active).not.toContain(id);
});

it('contains cave activity anchors within the authored patrol radius', () => {
 const habitat = AMETHYST_CAVE_HABITAT;
 for (const [x,z] of habitat.anchors) expect(Math.hypot(x-habitat.centre[0],z-habitat.centre[1])).toBeLessThanOrEqual(habitat.radius);
});
