/** Material skins over the existing detailed trees and understory. Geometry and UVs stay native. */
export const FAIRY_FOLIAGE = [
  { id: 'corealm_willow_gloam_1', sourceId: 'corealm_willow_1', regionId: 'gloamgarden', species: 'willow', tier: 30 },
  { id: 'corealm_willow_gloam_2', sourceId: 'corealm_willow_2', regionId: 'gloamgarden', species: 'willow', tier: 30 },
  { id: 'corealm_yew_fae_1', sourceId: 'corealm_yew_1', regionId: 'faeholme', species: 'yew', tier: 60 },
  { id: 'corealm_yew_fae_2', sourceId: 'corealm_yew_2', regionId: 'faeholme', species: 'yew', tier: 60 },
  { id: 'corealm_fern_gloam_1', sourceId: 'corealm_fern_1', regionId: 'gloamgarden' },
  { id: 'corealm_shrub_fae_1', sourceId: 'corealm_shrub_1', regionId: 'faeholme' },
  { id: 'mushroom_gloam', sourceId: 'mushroom_common', regionId: 'gloamgarden' },
  { id: 'mushroom_fae', sourceId: 'mushroom_bracket', regionId: 'faeholme' },
] as const;

export const FAIRY_FOLIAGE_IDS = FAIRY_FOLIAGE.map(entry => entry.id);

/** Shared by the source material skin and the scatter grass colours. */
export const FAIRY_FOLIAGE_COLOURS = {
  gloam: { leaf: 0xb88dcc, bark: 0x72604d, glow: 0x77649b, grass: 0x467d68 },
  fae: { leaf: 0x949bda, bark: 0x625a50, glow: 0x7976bc, grass: 0x647f83 },
} as const;

export function fairyFoliageStyle(materialName: string): keyof typeof FAIRY_FOLIAGE_COLOURS | null {
  const style = /@fairy:(gloam|fae)(?:@|$)/.exec(materialName)?.[1];
  return style === 'gloam' || style === 'fae' ? style : null;
}
