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
  gloam: { leaf: 0x51c5bd, bark: 0x75618e, glow: 0x4bbbb7, grass: 0x528f9e },
  fae: { leaf: 0xb98ddd, bark: 0x667c92, glow: 0x9974cd, grass: 0x8473ac },
} as const;

export function fairyFoliageStyle(materialName: string): keyof typeof FAIRY_FOLIAGE_COLOURS | null {
  const style = /@fairy:(gloam|fae)(?:@|$)/.exec(materialName)?.[1];
  return style === 'gloam' || style === 'fae' ? style : null;
}
