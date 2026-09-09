import type { SpellElement } from "../contracts.js";

export type ElementalSpellId =
  | "breeze-puff"
  | "water-bead"
  | "pebble-toss"
  | "kindle"
  | "air-needle"
  | "razor-crescent"
  | "vacuum-coil"
  | "thunder-lance"
  | "skybreaker"
  | "waterjet"
  | "tidal-fan"
  | "geyser-chain"
  | "undertow"
  | "deluge"
  | "flint-shot"
  | "faultline"
  | "basalt-jaw"
  | "siege-boulder"
  | "mountainfall"
  | "ember-dart"
  | "furnace-whip"
  | "cinder-mine"
  | "phoenix-pass"
  | "starfall";

export interface ElementalSpellDef {
  id: ElementalSpellId;
  name: string;
  element: SpellElement;
  rank: number;
  scale: string;
  description: string;
  watch: string;
}

export const ELEMENTAL_SPELLS: readonly ElementalSpellDef[] = [
  {
    id: "breeze-puff", name: "Breeze puff", element: "wind", rank: 0, scale: "Basic",
    description: "A tiny silver-blue enchantment gathers at the staff and releases one rippling pocket of air. One 10-damage hit within 0.9 m.",
    watch: "A quick puff reaches T5 and opens into one fading pressure ripple.",
  },
  {
    id: "air-needle",
    name: "Air needle",
    element: "wind",
    rank: 1,
    scale: "Precision",
    description:
      "A silver-violet wind sign gathers a bright pressure dart. Its curved wake breaks against a brief floating seal on contact. One 18-damage strike within 1.1 m.",
    watch: "The centre dummy takes one hit; its neighbours stay untouched.",
  },
  {
    id: "razor-crescent",
    name: "Razor crescent",
    element: "wind",
    rank: 2,
    scale: "Wide sweep",
    description:
      "Three enchanted crescents bank across the target line 140 ms apart. Each has its own tilt, curling edge and broken wind inscription. Each deals 14 damage within 2.2 m and pushes targets sideways.",
    watch:
      "Follow the staggered blade arrivals and compare the side dummies' positions.",
  },
  {
    id: "vacuum-coil",
    name: "Vacuum coil",
    element: "wind",
    rank: 3,
    scale: "Control field",
    description:
      "Three levitating binding signs surround an open eye above a slowly turning wind ward. Four 9-damage contractions pull targets within 5.5 m toward its core. The eye snaps shut and releases a 28-damage pressure rupture.",
    watch: "Watch the inward currents gather the dummies, then collapse into the eye before the final rupture.",
  },
  {
    id: "thunder-lance",
    name: "Thunder lance",
    element: "wind",
    rank: 4,
    scale: "Piercing lane",
    description:
      "A heraldic wind gate opens before the staff, releasing one luminous corkscrew of compressed air down the lane. Five unequal contact blooms deal 26 damage each within 1.7 m and briefly stagger victims.",
    watch:
      "Near and far lane targets are hit in order as the lance passes through.",
  },
  {
    id: "skybreaker",
    name: "Skybreaker",
    element: "wind",
    rank: 5,
    scale: "Massive storm",
    description:
      "A five-point storm ward summons a violent wedge tornado with an 11 m base, wrapped in luminous pressure curtains. Its central touchdown deals 45 damage; three unequal sweeping fronts reach 10 m, dealing 18 each and flinging targets outward.",
    watch:
      "The storm rises above the dummies; the outer rows react to the later shells.",
  },
  {
    id: "water-bead", name: "Water bead", element: "water", rank: 0, scale: "Basic",
    description: "A blue spark at the staff condenses into one enchanted water bead, stretching forward and popping into a small liquid crown. One 12-damage hit within 0.9 m, with a brief wet slow.",
    watch: "One bead, one splash, one hit on T5. No follow-up burst.",
  },
  {
    id: "waterjet",
    name: "Waterjet",
    element: "water",
    rank: 1,
    scale: "Focused stream",
    description:
      "A blue water sign draws a concentrated liquid stream from the staff, leaving two different luminous impact seals. Two close 11-damage impacts arrive 120 ms apart in a 1.2 m pocket and leave a short slow.",
    watch: "Two hits land on the centre dummy, with a narrow splash footprint.",
  },
  {
    id: "tidal-fan",
    name: "Tidal fan",
    element: "water",
    rank: 2,
    scale: "Liquid spread",
    description:
      "Five enchanted streams fan across a 10 m arc and arrive 35 ms apart, each with a different curve and water inscription. Each deals 16 damage in a 1.6 m pocket and slows movement. Rolled, forked and fanned splashes fall in sheets and spray.",
    watch:
      "Follow five liquid paths, then the falling splashes around the middle row.",
  },
  {
    id: "geyser-chain",
    name: "Geyser chain",
    element: "water",
    rank: 3,
    scale: "Rising columns",
    description:
      "Three wellspring seals awaken along the aim line, conjuring successive blue geysers. Each column punches a 2.7 m area for 24 damage, then bursts again for 12 as the water crown collapses.",
    watch:
      "Each column has an upward hit and a second splash, with six impacts total.",
  },
  {
    id: "undertow",
    name: "Undertow",
    element: "water",
    rank: 4,
    scale: "Whirlpool",
    description:
      "Three blue foci orbit a turning water ward as its whirlpool draws targets inward in three 12-damage pulses over 1.1 seconds. A 35-damage surge lifts and drenches the gathered group inside 3.5 m.",
    watch:
      "The inward spiral gathers targets before the smaller finishing hit.",
  },
  {
    id: "deluge",
    name: "Deluge",
    element: "water",
    rank: 5,
    scale: "Massive flood",
    description:
      "Three unequal water gates open, release a summoned flood, then fade as its waves arrive. Each 14 m front curls into a continuous, foaming crest. Four adjacent contact areas deal 20 damage each and shove targets downrange as the wave breaks.",
    watch:
      "Compare the first and last rows as successive waves cross the yard.",
  },
  {
    id: "pebble-toss", name: "Pebble toss", element: "earth", rank: 0, scale: "Basic",
    description: "A small green staff-light lifts one enchanted pebble into a shallow arc. It chips apart on contact for 14 damage within 0.9 m, leaving a pinch of mineral dust.",
    watch: "The small stone breaks at T5. Neighbouring dummies remain untouched.",
  },
  {
    id: "flint-shot",
    name: "Flint shot",
    element: "earth",
    rank: 1,
    scale: "Stone projectile",
    description:
      "A suspended mineral seal binds a solid flint boulder as it spins through a shallow arc. One 1.2 m impact deals 24 damage, splitting the same stone into 72 tumbling pieces and a dense shower of chips.",
    watch: "Watch the intact boulder separate at contact. Its pieces start inside the original stone.",
  },
  {
    id: "faultline",
    name: "Faultline",
    element: "earth",
    rank: 2,
    scale: "Ground rupture",
    description:
      "A procession of jade earth signs awakens one jagged ridge along a ground seam. Five sections heave 150 ms apart, each dealing 19 damage within 1.8 m and briefly staggering targets.",
    watch:
      "Follow the moving front along the connected ridge and the dust thrown from its seam.",
  },
  {
    id: "basalt-jaw",
    name: "Basalt jaw",
    element: "earth",
    rank: 3,
    scale: "Closing trap",
    description:
      "Two upright binding seals call serrated basalt walls from a broad earth ward. Six initial contacts deal 10 each; the walls close inward for a 40-damage crush within 3.5 m and root targets for 1.8 seconds.",
    watch:
      "The two jaws rise, lean inward and close. The centre hit lands as they meet.",
  },
  {
    id: "siege-boulder",
    name: "Siege boulder",
    element: "earth",
    rank: 4,
    scale: "Heavy bombardment",
    description:
      "Two crossing mineral seals bind a massive airborne boulder. It strikes a 5 m area for 65 damage and splits into 180 connected fracture pieces. A delayed 18-damage debris surge reaches 7 m and pushes survivors away.",
    watch:
      "Follow the same boulder from flight to breakup, then watch its fragments tumble and strike the ground.",
  },
  {
    id: "mountainfall",
    name: "Mountainfall",
    element: "earth",
    rank: 5,
    scale: "Massive upheaval",
    description:
      "Four ancient earth signs raise one huge, asymmetric mountain from an inscribed ward for 50 damage. Eight avalanches shed from its slopes around a 7 m perimeter, dealing 32 per 3 m pocket. The mountain collapses into a final 10 m quake for 22.",
    watch:
      "The mountain rises as one mass, sheds debris down its slopes, then collapses outward.",
  },
  {
    id: "kindle", name: "Kindle", element: "fire", rank: 0, scale: "Basic",
    description: "A gold staff-light releases one small living flame. A short orange tail curls behind it before a single 11-damage flash within 0.9 m. A few embers drift upward and go dark.",
    watch: "One quick flame and one hit on T5, without a lingering burn attack.",
  },
  {
    id: "ember-dart",
    name: "Ember dart",
    element: "fire",
    rank: 1,
    scale: "Quick ignition",
    description:
      "A bright ember heart trails red-gold flame and brands its target with a brief fire sign, dealing 15 damage within 1.1 m. Two lingering cinder bursts deal 4 damage each at the original impact point, 400 ms apart.",
    watch: "The first hit is followed by two small burns at the same place.",
  },
  {
    id: "furnace-whip",
    name: "Furnace whip",
    element: "fire",
    rank: 2,
    scale: "Flame arc",
    description:
      "An incanted red-gold lash bends through six points in a broad crescent, stamping different fire signs as it strikes. Each contact deals 13 damage within 1.9 m, shedding sparks as the lash flexes and recoils.",
    watch:
      "Follow the single lash as its tip sweeps the arc. Contact damage follows the moving tip.",
  },
  {
    id: "cinder-mine",
    name: "Cinder mine",
    element: "fire",
    rank: 3,
    scale: "Delayed detonation",
    description:
      "A contracting fire inscription feeds one bright ember heart. After 1.8 seconds it bursts into a broad flame canopy for 55 damage within 4.5 m. A low 6 m afterblast deals 15 and knocks targets back.",
    watch:
      "The warning contracts inward; the detonation rolls outward. Show hit areas reveals both blast radii.",
  },
  {
    id: "phoenix-pass",
    name: "Phoenix pass",
    element: "fire",
    rank: 4,
    scale: "Returning attack",
    description:
      "A gold fire gate summons one large phoenix across the lane, dealing 21 damage at five 3 m contacts. It folds its wings, turns and returns through five smaller 10-damage contacts.",
    watch: "The outward wing pattern reverses direction for the return pass.",
  },
  {
    id: "starfall",
    name: "Sunfall",
    element: "fire",
    rank: 5,
    scale: "Massive bombardment",
    description:
      "A descending sun hangs in a turning solar seal, lashing nine different coronal strikes across a 12 m grid for 30 damage each. It lands at the centre for 70 damage within 9 m and releases a broad rolling wall of flame.",
    watch:
      "Track the single descending sun, its coronal strikes and the final outward flame front.",
  },
];

export function elementalSpell(id: string): ElementalSpellDef {
  const spell = ELEMENTAL_SPELLS.find((entry) => entry.id === id);
  if (!spell) throw new Error(`Unknown elemental spell: ${id}`);
  return spell;
}
