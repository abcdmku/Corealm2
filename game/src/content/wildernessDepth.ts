/** Root-owned depth contract. Semantic ownership stays `wilderness`; these are progression bands. */
export const WILDERNESS_DEPTH = {
  south: 460, divide: 700, north: 940, shallowTier: 50, deepTier: 70,
  magicFadeStart: 650, magicFadeEnd: 810,
} as const;

export function wildernessTierAt(z: number): 50 | 70 {
  return z < WILDERNESS_DEPTH.divide ? 50 : 70;
}

/** Continuous colour and atmosphere transition. Never use a hard depth cutoff for art. */
export function wildernessMagicAt(x: number, z: number): number {
  const warped = z + Math.sin(x * .018) * 12 + Math.sin(x * .043 + z * .012) * 7;
  const t = Math.max(0, Math.min(1, (warped - WILDERNESS_DEPTH.magicFadeStart)
    / (WILDERNESS_DEPTH.magicFadeEnd - WILDERNESS_DEPTH.magicFadeStart)));
  return t * t * (3 - 2 * t);
}

/** Five invocation runes from the merged magic system; Cosmic Runes supplement their drops. */
export const WILDERNESS_RUNE_KEEPERS = [
  { id: 'ashseal_warden', name: 'Ashseal Warden', tier: 50, multiplier: 3, rune: 'mind_rune' },
  { id: 'furnace_regent', name: 'Furnace Regent', tier: 50, multiplier: 4, rune: 'chaos_rune' },
  { id: 'chainbound_archon', name: 'Chainbound Archon', tier: 70, multiplier: 3, rune: 'death_rune' },
  { id: 'nightforge_marshal', name: 'Nightforge Marshal', tier: 70, multiplier: 4, rune: 'blood_rune' },
  { id: 'hollow_star', name: 'The Hollow Star', tier: 70, multiplier: 5, rune: 'wrath_rune' },
] as const;

/** Reservable authored intentions, shared by placement workers before final-world registration. */
export const WILDERNESS_EXPANSION_SITES = [
  { id: 'cinder_chain_foundry', position: [-210, 735], footprint: [64, 56], rotationY: .12 },
  { id: 'nightforge_bastion', position: [175, 815], footprint: [68, 64], rotationY: -.14 },
  { id: 'hollow_star_sanctum', position: [-20, 875], footprint: [70, 64], rotationY: .08 },
] as const;

export const WILDERNESS_RESOURCE_INTENTS = [
  { id: 'cindervein_workings', tier: 50, kind: 'mine', position: [-285, 680] },
  { id: 'nightglass_excavation', tier: 70, kind: 'mine', position: [285, 895] },
  { id: 'lastroot_teak', tier: 50, kind: 'grove', position: [-285, 490] },
  { id: 'ember_shelter_teak', tier: 50, kind: 'grove', position: [280, 585] },
  { id: 'starwood_hollow', tier: 70, kind: 'grove', position: [-285, 850] },
  { id: 'moonvein_copse', tier: 70, kind: 'grove', position: [285, 755] },
] as const;
