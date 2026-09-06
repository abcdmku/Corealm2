# Slice 13: equipment in motion

Both supported bodies wear mixed metal, hide and cloth outfits through real locomotion, melee,
casting, chopping, mining, fishing, hit and death, and the held gear that had never been finished —
shields, daggers, staves and wands — gets its grips, its constructions and its material zones.

Everything below was captured in the production feature lab through production code paths, in real
Chromium on the hardware renderer, and inspected image by image. A passing script is not acceptance;
the acceptance is the inspection, and the defects it found are listed whether or not this slice
fixes them.

Renderer for every run: `ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0
ps_5_0, D3D11)`, asserted per run by `checks/equipment-hardware.ts`. Server: the stable Vite lab on
port 4187 with HMR off, restarted after every source change so no capture is served stale modules.

## Body x outfit x action matrix

    npx tsx runs/corealm-rebuild/checks/equipment-motion-matrix.ts \
      --body <male|female> --kit <knight|ranger|mixed-a|mixed-b> [--scene fishing] \
      --url http://127.0.0.1:4187

| Kit | head | body | legs | hands | feet | main hand | off hand |
| --- | --- | --- | --- | --- | --- | --- | --- |
| knight | Cobalt | Cobalt | Cobalt | Cobalt | Cobalt | Kaldite sword | Cairnpine shield |
| ranger | Heavy Hide | Heavy Hide | Heavy Hide | Heavy Hide | Heavy Hide | Grithe sword | Palewood shield |
| mixed-a | Titanium | Hide | Copper | Heavy Hide | Titanium | Emberite sword | Cinderpine shield |
| mixed-b | Heavy Hide | Copper | Hide | Titanium | Heavy Hide | Emberite sword | Cinderpine shield |

The two mixed kits deliberately put the lowest and the highest tier of both lines on one body at
once, which is the case a single-tier kit hides.

Each forest shard captures 24 frames: three restored idles, three close seam views, four real
keyboard run directions, three real melee frames against a live production creature, staff idle and
cast, wand idle and cast, hatchet chop raise and strike after a real hover-verified tree click,
pickaxe raise and strike after a real cut-face ore click, a hit flinch, a death fall and a low
corpse view. Each fishing shard captures the rod from the side, the front and one close grip view
after a real school click in the Redsill basin.

| Scene | Body | Kit | Result | Frames | Worn layer set | Held |
| --- | --- | --- | --- | --- | --- | --- |
| forest | male | knight | pass | 24 | `outfit_male_knight_*` | corealm_sword_3 + corealm_shield_3 |
| forest | male | ranger | pass | 24 | `outfit_male_ranger_*` | corealm_sword_1 + corealm_shield_1 |
| forest | male | mixed-a | pass | 24 | male knight + male ranger | corealm_sword_4 + corealm_shield_4 |
| forest | male | mixed-b | pass | 24 | male knight + male ranger | corealm_sword_4 + corealm_shield_4 |
| forest | female | knight | pass | 24 | `outfit_female_knight_*` | corealm_sword_3 + corealm_shield_3 |
| forest | female | ranger | pass | 24 | `outfit_female_ranger_*` | corealm_sword_1 + corealm_shield_1 |
| forest | female | mixed-a | pass | 24 | female knight + female ranger | corealm_sword_4 + corealm_shield_4 |
| forest | female | mixed-b | pass | 24 | female knight + female ranger | corealm_sword_4 + corealm_shield_4 |
| fishing | male | mixed-a | pass | 3 | male knight + male ranger | proc_rod_cairnpine |
| fishing | female | mixed-a | pass | 3 | female knight + female ranger | proc_rod_cairnpine |

`pass` means the run completed with empty engine, console and request error lists, and that every
capture asserted its production pose, its clip fraction, an unchanged worn layer signature and asset
list, no attachment errors, hair hidden under headgear, and the expected main-hand asset. Visual
acceptance is the inspection below, not that word.

## What the captures actually show

### Fixed in this slice

**The shield was not on the arm.** Held at `hand_l`, the board's back plane sat at local x = +0.035
while the forearm runs along x = 0 with about a 0.045 m radius, so the arm came out through the face
of the boards in every left-side view, and the melee clip swung the board over the head like a tray
with the arm plainly detached from it. It now straps to `lowerarm_l`. Across all eight forest shards
the board sits on the outside of the forearm, covers shoulder to hip or knee depending on tier, and
tracks the arm through run, swing, chop, mine and death.

**The pickaxe was nearly a metre wide.** `pickaxe.glb` spans 0.813 m across the head at scale 1, and
the tier factor took Cobalt and Titanium to 0.936 and 0.997 m against the rig's 0.424 m shoulder
span. `SocketParts` gained an asset fit scale and a 0.68 fit brings every tier under 0.70 m of head.
The mine strike now reads as a one-handed pick.

**The fishing rod had no measured socket at all.** Every `proc_rod_*` was riding
`CharacterRig.socketFor`'s unmeasured fallback, which happened to match what the rod was authored
against. Any change to that fallback would have moved it silently. There is now an explicit entry
that pins the same transform, and `07-fish-grip` shows the butt and reel below the fist with the
shaft above it.

**The dagger was a short sword.** 0.778 m end to end with a 0.53 m blade against a 1.81 m rig, next
to a 1.03 m Cobalt sword, and one mesh recoloured four times. The four grades are now separate
constructions at 0.448 to 0.475 m with 0.26 to 0.29 m blades, and each keeps its grip centre at
asset y = -0.100 so the reviewed hand socket did not move.

**Nine staff ids and nine wand ids shared one imported mesh each.** The staff's head is a broad
spear point, so every "staff" in the game read as a spear, and no tier had a construction. The wand
was a 0.79 m hooked twig with no metal or crystal to separate from the wood. Both are replaced by
four authored Corealm grades apiece.

**Four shield ids shared one imported round board.** Replaced by four authored boards: oval plank
buckler, heater, kite, tower.

**The dark magic tiers had no wood left in them.** The tier colour was multiplied by a grain factor
floored at 0.20, which stacks two dark values, so the Cairnpine staff came out of the lab as flat
slate and the Cinderpine wand as a black stick. The Corealm grades separate wood, leather, metal and
crystal into their own materials, so the tier colour reaches the fittings and the wood keeps its
authored grain. In the current captures the staves read as wood for the first time.

**Hide and Heavy Hide were the same outfit above the waist.** The ranger tier treatment guarded
"leather" with red-minus-blue alone, which is positive for the hood's mossy green, the tan boots and
the pauldron fur, so those three parts kept their source colour at every tier. Tier 1 and tier 20
differed only in the shirt and trousers. Leather now has to be brown, not merely warm, and even
guarded leather carries 42% of the tier. Heavy Hide now reads as one dark charhide outfit.

**The female body wore male-cut outfits.** Found by reading the reports rather than the pictures:
the female Cobalt shard listed `outfit_male_knight_*` in its committed layer assets, and its
captures were frame-for-frame identical to the male shard. Every slot has a female mesh and the rig
was already warming them per body, but `GearVisualsPort` had no body parameter on its resolve calls.
Fixed; the re-run female shards list the female variants and the female Ranger silhouette is
visibly its own.

### Found and not fixed here

These are real defects in the current build. They are worn-armour construction problems, which is
Slice 14's subject, and they are carried into that record with per-item dispositions.

**The hands slot leaves the hand bare.** Copper/Iron/Cobalt/Titanium gauntlets and all four hide
wraps render a wrist cuff with bare skin below it, on both bodies, in every close grip view, and in
the published 256 px icons. An item called Gauntlets has to cover the hand.

**Metal greaves leave a bare hip and upper thigh.** Between the cuirass skirt and the plate there is
a band of the base body's brown skin, visible in `00-restored-seams-lower`, in the melee and chop
frames, and in the icons, at all four metal tiers.

**The shoulder-to-forearm run is the base body sleeve** at every metal tier: black cloth between a
plate pauldron and a plate bracer.

**No metal or hide tier differs in construction.** Copper, Iron, Cobalt and Titanium are one
imported Knight mesh per slot with four tint values, and Hide, Thick Hide, Fur and Heavy Hide are
one imported Ranger mesh per slot. Held gear now has four constructions per family; worn armour
does not.

**The Titanium tower shield reads a little like a plank door** at gameplay distance. It is correct
as a tower shield and clearly separate from the other three boards, so it is accepted with the note
rather than reworked.

## Held gear: grips, construction and material zones

`npx tsx runs/corealm-rebuild/checks/equipment-grips.ts --url http://127.0.0.1:4187 --body male
--kit cobalt` captures three tight views around the holding hand plus a full figure for each of 21
held items, 84 frames.

| Family | Grade construction | Size | Grip |
| --- | --- | --- | --- |
| dagger 1..4 | tapered single edge, bar guard, disc pommel / fullered leaf, down-swept guard, faceted pommel / triangular stiletto, ring-and-quillon guard, ribbed pommel, one stone / recurved ridged blade, wide winged guard, capped pommel, two stones | 0.448-0.475 m | fist, grip centre asset y = -0.100 |
| shield 1..4 | oval plank buckler, plain boss, nailed battens / heater, riveted top edging, cross brace, octagonal boss / kite, full rolled rim, six radial straps, domed boss / tower, five face bands, corner caps, three-step boss | 0.606-0.626 x 0.740-0.886 m | `lowerarm_l`, rear plane 0.075 m clear of the bone |
| staff 1..4 | bound bent branch / turned shaft, ferrules, two-prong crown / segmented shaft, joint collars, four-prong cage / tapered shaft, spiral iron vine, closed cage with finial | 1.655-1.717 m | fist at the leather grip, held mid-shaft |
| wand 1..4 | lashed whittled stick / turned handle, flared ferrule, ring socket / faceted shaft, three-prong setting / ribbed shaft, collar, closed four-claw setting | 0.407-0.437 m, worn at a 1.22 fit | fist at the handle |
| sword 1..4 | four blade profiles, widths, guard spans and pommels (already promoted) | 0.77-0.96 m blade | fist, grip centre asset y = -0.100 |

Material zones, checked in the exported GLBs and confirmed in the lab: every grade separates
`wood`, `leather`, `metal` and `gem` into their own primitives. The tier tint pipeline only repaints
`metal` and `blade`, so a Cobalt kite shield takes bright steel on its rim and boss while its planks
stay the authored oak and its rear handgrip stays leather. Before this, the shield's tier tint was
applied to a single shared vertex-coloured trim material, which is what turned the Cobalt rim pink
and its grip near-black.

Elemental cores sit on the authored `elementalSocket` of each grade, staff [0, 0.85, 0] and wand
[0, 0.265, 0], with a radius slightly wider than the set crystal so a charged core reads as a shell
around the stone rather than a second solid inside it. Verified on the charged fire staff and water
wand, and on the staff and wand cast frames in every forest shard.

## Save and reload

Every forest shard imports its own save through the production path (`debug.loadSaveBlob`) before
any action and asserts, once the layers settle, that the restored equipment map, the inventory tool
call, max health, both hand attachments, the layer mesh list, the committed layer asset list and the
hair-hidden flag are all identical to the pre-save values. Eight shards, both bodies, four outfits,
all identical. This exercises production serialization; it is not a browser reload.

## Promotions

Twelve assets, `corealm_shield_1..4`, `corealm_staff_1..4`, `corealm_wand_1..4`, promoted from
`art/rebuild/candidates/2026-09-06/equipment-held-r3` through
`npx tsx tools/promote-finish-assets.ts --apply` after the production gallery review. The candidate
catalogue pins its own generator hash and the hash of `game/src/render/equipmentWeapons.ts` where the
geometry lives, and the manifest pack hash was updated to match.

The four dagger grades stay generated rather than promoted: the geometry is already in the client
bundle for the icon renderer, so four manifest entries would buy nothing.

## Evidence

Captures live under `test-results/` and are not committed. The montages are the inspected artefacts;
the per-frame PNGs behind them were deleted once the montage was read, as the disk budget requires.

- `test-results/matrix-montage/{forest,fishing}-{male,female}-{knight,ranger,mixed-a,mixed-b}.png` —
  ten shard montages, 24 or 3 frames each.
- `test-results/equipment-motion-matrix/*/report.json` — per-shard semantic record: renderer, worn
  members, layer assets, attachments, save restore comparison, per-capture motion state, error lists.
- `test-results/grips-{shield,staff,wand}.png` and
  `test-results/equipment-grips/male-cobalt/` — the 84-frame close grip pass.
- `test-results/dagger-grades-montage.png` — the four dagger grades in hand.
- `test-results/held-r3-montage.png` — the twelve promoted grades in the production gallery.
- `test-results/equipment-tiers/male/` — front, back and two close views of all eight armour sets,
  which is the evidence behind the armour findings above and behind Slice 14's tier decision.
- `test-results/icon-sheets/*.png` — per-group contact sheets of the published 256 px masters.

## Tests

`npm run typecheck`, plus `tests/equipment.test.ts`, `tests/equipment-weapons.test.ts`,
`tests/equipment-metal-materials.test.ts`, `tests/equipment-material-inheritance.test.ts`,
`tests/item-icon-parity.test.ts`, `tests/icon-renderer-polish.test.ts`,
`tests/fishing-render-visibility.test.ts` and `tests/mineral-items.test.ts`.

New or rewritten assertions: the shield socket is on `lowerarm_l` with its boss leaving along local
-X and every worn tier's inner face outside the forearm; every generated fishing rod has an explicit
grip; every pickaxe tier fits inside a believable one-handed swing; each magic tier resolves its own
construction; each shield tier resolves its own board; a Corealm shield tints only its iron; and a
part that takes no shader treatment still inherits its source's compile hook and cache key.

`tests/mineral-items.test.ts` was handed over as a baseline failure. It passes, on the branch point
and after the rebase, run three times to rule out flake. The garnet specimen the named case guards
is byte-identical to the promoted asset and satisfies the rule. Neither the test nor
`tools/build-corealm-minerals.ts` had changed since the branch point, so the handover note was
stale rather than describing a real regression.

## Limits

- Hit and death use `FeatureLabApi.previewPlayerReaction`, which drives the production
  `CharacterRig.play`. No health changes, so this covers rig and equipment behaviour under those
  clips, not the damage or death pipeline.
- Lab equip grants, skill levels and the single tool left in a cleared pack are declared fixture
  setup. The rig, sockets, materials, save import, tree click, ore click and school click are all
  production code.
- Save restoration is a production save import, not a browser reload.
- Still frames at chosen clip fractions. They do not certify every frame of every clip, and no
  timing or frame-rate claim is made anywhere in this slice.
- The staff is carried and cast one-handed. A genuine two-hand grip needs either new clips or arm
  IK, and the rig has neither; a socket alone cannot put the off hand on the shaft. Not attempted.
- Held gear was inspected on the Cobalt kit for the close grip pass and across all four kits in the
  matrix. It was not inspected on every kit at close range.
