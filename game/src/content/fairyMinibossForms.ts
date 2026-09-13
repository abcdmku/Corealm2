/** Leaf mantids in T30; larger winged wardens in T60. All belong to the standard nine-body set. */
export const FAIRY_MINIBOSS_POOLS = {
  gloamgarden: ['02', '03', '07'],
  faeholme: ['06', '08', '09'],
} as const;

export const FAIRY_MINIBOSS_FORMS = Object.entries(FAIRY_MINIBOSS_POOLS).flatMap(([regionId, numbers]) =>
  numbers.map(number => ({ number, regionId, source: `fantasy_monster_${number}`,
    assetId: `fairy_guardian_${number}_${regionId}`, look: 'mint' as const })));

export function fairyMinibossAsset(number: string, regionId: string): string | undefined {
  return FAIRY_MINIBOSS_FORMS.find(form => form.number === number && form.regionId === regionId)?.assetId;
}
