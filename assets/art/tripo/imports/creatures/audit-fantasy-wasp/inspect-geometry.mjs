import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const file = 'assets/art/tripo/imports/creatures/audit-fantasy-wasp/corealm_fantasy_briar_wasp_p1_2k_pbr_rigged.glb';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const a = p.getAttribute('POSITION').getArray();
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="600"><rect width="100%" height="100%" fill="#111"/>';
for (let i = 0; i < a.length; i += 12) {
  const [x, y, z] = a.slice(i, i + 3);
  const py = 550 - y * 500;
  svg += `<circle cx="${250 + x * 500}" cy="${py}" r="1.5" fill="${z < 0 ? '#39c5ff' : '#ffbf36'}" opacity=".65"/>`;
  svg += `<circle cx="${750 + z * 500}" cy="${py}" r="1.5" fill="${x < 0 ? '#6dff72' : '#ff69dd'}" opacity=".65"/>`;
  svg += `<circle cx="${1250 + z * 500}" cy="${300 + x * 500}" r="1.5" fill="${y > .6 ? '#eafb6f' : '#9989fc'}" opacity=".65"/>`;
}
svg += '</svg>';
await sharp(Buffer.from(svg)).png().toFile('assets/art/tripo/imports/creatures/audit-fantasy-wasp/source-projections.png');
