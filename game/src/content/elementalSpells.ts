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
    description: "A concentrated silver-blue dart slips through rippling air. Its tapered wake sheds fine sparks and opens into two short swooshes on contact. One 18-damage strike within 1.1 m.",
    watch: "The centre dummy takes one hit; its neighbours stay untouched.",
  },
  {
    id: "razor-crescent",
    name: "Razor crescent",
    element: "wind",
    rank: 2,
    scale: "Wide sweep",
    description: "Three luminous wind cuts bank across the target line 140 ms apart. Each has its own tilt, broad leading edge and scattered wake. Each deals 14 damage within 2.2 m and pushes targets sideways.",
    watch:
      "Follow the staggered blade arrivals and compare the side dummies' positions.",
  },
  {
    id: "vacuum-coil",
    name: "Vacuum coil",
    element: "wind",
    rank: 3,
    scale: "Control field",
    description: "Open spirals of silver light and pressure draw targets inward. Four 9-damage contractions pull targets within 5.5 m toward the empty eye, followed by a 28-damage pressure rupture.",
    watch: "Watch the inward currents gather the dummies, then collapse into the eye before the final rupture.",
  },
  {
    id: "thunder-lance",
    name: "Thunder lance",
    element: "wind",
    rank: 4,
    scale: "Piercing lane",
    description: "One concentrated light wake drives a corkscrew of compressed air down the lane. Five unequal contact bursts deal 26 damage each within 1.7 m and briefly stagger victims.",
    watch:
      "Near and far lane targets are hit in order as the lance passes through.",
  },
  {
    id: "skybreaker",
    name: "Skybreaker",
    element: "wind",
    rank: 5,
    scale: "Massive storm",
    description: "Loose storm currents form overhead and descend into a broad 11 m tornado. Touchdown deals 45 damage, then three sweeping fronts deal 18 each. After circulation breaks, lifted debris falls and settles. The full cast lasts 4.95 seconds.",
    watch: "Watch the neck form and widen during descent, then follow the debris to the ground after the wind fades.",
  },
  {
    id: "water-bead", name: "Water bead", element: "water", rank: 0, scale: "Basic",
    description: "A compact blue light streak carries a tiny water bead inside its wake. It scatters into a small liquid splash for 12 damage within 0.9 m, with a brief wet slow.",
    watch: "A small glowing shot reaches T5, followed by one splash and one hit.",
  },
  {
    id: "waterjet",
    name: "Waterjet",
    element: "water",
    rank: 1,
    scale: "Focused stream",
    description: "Two narrow cobalt light jets carry liquid threads inside their wakes, shedding turquoise spray. Two close 11-damage impacts arrive 120 ms apart in a 1.2 m pocket and leave a short slow.",
    watch: "Two hits land on the centre dummy, with a narrow splash footprint.",
  },
  {
    id: "tidal-fan",
    name: "Tidal fan",
    element: "water",
    rank: 2,
    scale: "Liquid spread",
    description: "Five luminous blue wakes bank across a 10 m arc and arrive 35 ms apart. Each has a different bend, breadth and spray direction. Each deals 16 damage in a 1.6 m pocket and slows movement.",
    watch:
      "Follow five liquid paths, then the falling splashes around the middle row.",
  },
  {
    id: "geyser-chain",
    name: "Geyser chain",
    element: "water",
    rank: 3,
    scale: "Rising columns",
    description: "Three branching spring bursts climb along the aim line. Separate glowing arcs carry thin liquid threads and falling spray. Each area takes 24 damage, then another 12 as the spray lands.",
    watch: "Watch three upward bursts and their falling spray, with six impacts total.",
  },
  {
    id: "undertow",
    name: "Undertow",
    element: "water",
    rank: 4,
    scale: "Whirlpool",
    description: "Low blue wakes curve inward through a shallow whirlpool. Three 12-damage pulses gather targets over 1.1 seconds, then the eye pinches shut in collapsing foam, striking the group for 35 damage inside 3.5 m.",
    watch:
      "The inward spiral gathers targets before the smaller finishing hit.",
  },
  {
    id: "deluge",
    name: "Deluge",
    element: "water",
    rank: 5,
    scale: "Massive flood",
    description: "Heavy teal waves gather around a 20 m field, then crash inward. Three converging sets of four 20-damage contacts pull targets toward the centre. The collision throws a towering splash upward, followed by falling spray over a 4.95-second cast.",
    watch: "Follow the perimeter waves toward the centre, then watch the collision rise into a tall splash and fall back as rain.",
  },
  {
    id: "pebble-toss", name: "Pebble toss", element: "earth", rank: 0, scale: "Basic",
    description: "A small jade streak carries an enchanted mineral chip through a shallow arc. The chip breaks on contact for 14 damage within 0.9 m, leaving fine sparks and grit.",
    watch: "Follow the short glowing wake to T5. Neighbouring dummies remain untouched.",
  },
  {
    id: "flint-shot",
    name: "Flint shot",
    element: "earth",
    rank: 1,
    scale: "Stone projectile",
    description: "A bright jade lance carries a small flint core under a curved light wake. One 1.2 m impact deals 24 damage, splitting the core into 72 pieces inside a fan of glowing mineral sparks.",
    watch: "The luminous shot breaks at contact. The stone fragments separate from its small core.",
  },
  {
    id: "faultline",
    name: "Faultline",
    element: "earth",
    rank: 2,
    scale: "Ground rupture",
    description: "A low jagged seam races down the lane, throwing jade light across the ground as short rock ridges heave beneath it. Five sections strike 150 ms apart for 19 damage within 1.8 m, briefly staggering targets.",
    watch:
      "Follow the moving front along the connected ridge and the dust thrown from its seam.",
  },
  {
    id: "basalt-jaw",
    name: "Basalt jaw",
    element: "earth",
    rank: 3,
    scale: "Closing trap",
    description: "Opposing mineral rakes sweep inward above low broken stone. Six outer strikes bind targets before a concentrated crossing burst crushes the centre for 40 damage. The ground stays visible between the light paths.",
    watch: "Watch the outer roots, then the crossing light and debris at the centre.",
  },
  {
    id: "siege-boulder",
    name: "Siege boulder",
    element: "earth",
    rank: 4,
    scale: "Heavy bombardment",
    description: "A heavy braided jade comet carries a small bound stone core through a high arc. Its first strike deals 65 damage within 5 m and breaks the core into 180 pieces. A later 18-damage ground sweep reaches 7 m.",
    watch: "Follow the glowing comet, its core fracture and the wider delayed sweep.",
  },
  {
    id: "mountainfall",
    name: "Mountainfall",
    element: "earth",
    rank: 5,
    scale: "Massive upheaval",
    description: "Jade currents gather around five stone anchors across an 18 m field, then crush inward and erupt as mineral light. The first rupture deals 50 damage, eight outer surges deal 32 each and the implosion deals 22 across 10 m. Fragments settle over 4.41 seconds.",
    watch: "Watch the ridges lean and move toward the centre before they fracture. The compressed debris surges upward, then falls.",
  },
  {
    id: "kindle", name: "Kindle", element: "fire", rank: 0, scale: "Basic",
    description: "One compact gold-red light streak carries a lick of flame to T5. A brief spray of embers deals 11 damage within 0.9 m.",
    watch: "One short glowing shot and one compact contact. No follow-up burst.",
  },
  {
    id: "ember-dart",
    name: "Ember dart",
    element: "fire",
    rank: 1,
    scale: "Quick ignition",
    description: "A tapered gold-red comet leaves a bright curled wake, then scatters embers on contact. The initial hit deals 15 damage, followed by two small 4-damage burns.",
    watch: "Track the comet arrival and the two smaller burning contacts.",
  },
  {
    id: "furnace-whip",
    name: "Furnace whip",
    element: "fire",
    rank: 2,
    scale: "Flame arc",
    description: "One broad ribbon of fire unfurls into the front line, then cracks sideways across six targets. The trailing flame follows the tip and tears into cinders. Six successive contacts deal 13 damage each.",
    watch: "Follow the single ribbon through its unfurl, sideways crack and falling cinders.",
  },
  {
    id: "cinder-mine",
    name: "Cinder mine",
    element: "fire",
    rank: 3,
    scale: "Delayed detonation",
    description: "Low ember streams draw inward, pause, then burst into separate flame tongues around an open blast front. The first strike deals 55 damage in 4.5 m; a later 15-damage wave reaches 6 m.",
    watch: "Watch the gathering sparks, brief pause and two outward bursts.",
  },
  {
    id: "phoenix-pass",
    name: "Kiln rupture",
    element: "fire",
    rank: 4,
    scale: "Erupting fire vents",
    description: "Seven uneven vents split the ground in sequence, each erupting into torn red-gold flames and rising ash. Each vent deals 32 damage within 2.7 m and burns targets.",
    watch: "Watch the ground brighten beneath each vent before its eruption. No returning pass.",
  },
  {
    id: "starfall",
    name: "Sunfall",
    element: "fire",
    rank: 5,
    scale: "Solar impact",
    description: "A large sun gathers a torn burning corona and accelerates into one 110-damage impact across 9 m. Tall rolling flames, airborne embers and dark ash linger from that single blast. The full cast lasts 4.3 seconds.",
    watch: "Follow the growing sun into one heavy strike, then watch the fire subside and embers fall. There is no second damage wave.",
  },
];

export function elementalSpell(id: string): ElementalSpellDef {
  const spell = ELEMENTAL_SPELLS.find((entry) => entry.id === id);
  if (!spell) throw new Error(`Unknown elemental spell: ${id}`);
  return spell;
}
