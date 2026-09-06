# Slice 14: equipment variety and the remaining items

Every armour tier gets a construction instead of a tint value, every one of the 227 catalogue items
gets a verdict with a reason and evidence, the held fire opal is revised and promoted, and the icons
for everything whose model changed are regenerated.

Renderer for every capture: `ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0
ps_5_0, D3D11)`. Server: the stable Vite lab on port 4187 with HMR off, restarted after every source
change.

## Tier construction

### What was wrong

`npx tsx runs/corealm-rebuild/checks/equipment-tiers.ts --url http://127.0.0.1:4187 --body male`
captures front, back, a close upper and a close lower view of all eight sets. Read as one sheet:

- Copper, Iron, Cobalt and Titanium were one imported Knight mesh per slot with four tint values.
  Helmet, cuirass, greaves, boots and gauntlets are the same object four times.
- Hide, Thick Hide, Fur and Heavy Hide were one imported Ranger mesh per slot, and worse: the tier
  treatment guarded "leather" with red-minus-blue alone, which the hood's mossy green, the tan boots
  and the pauldron fur all pass, so those three parts kept their source colour at every tier. Thick
  Hide and Heavy Hide were indistinguishable above the waist. Fixed in slice 13, and the current
  sheet shows four separable dye lots.
- Every metal tier left the base body's brown hip and upper thigh bare between the cuirass skirt and
  the greaves.
- Every tier of both lines leaves the hand bare below a wrist cuff, and the metal line leaves the
  shoulder-to-forearm run as the base body's black sleeve.

### The decision

Where a tier family's names promise plate, mail, leather and fur trim, the geometry has to say so.
Four new skinned sets per line is not what this slice could author and verify; fourteen additive
pieces riding one torso or hip bone over the existing outfit is, and it puts the difference exactly
where a player looks. Copper and Hide carry no neck piece on purpose: they are the plain baselines
the rest are read against. Every tier carries a hip piece, because that is also what closes the bare
hip the metal sets leave.

| Tier | Neck, on `spine_03` | Hip, on `pelvis` |
| --- | --- | --- |
| Copper | none, plain plate baseline | one leather-faced belt lame with buckle plates |
| Iron | riveted mail aventail | two riveted plate lames |
| Cobalt | that aventail under a stepped gorget | three articulated lames, scalloped hem |
| Titanium | three-lame fluted gorget with a standing collar, no mail | four lames with hanging hip tassets |
| Hide | none, plain baseline | hide panel ring under a knotted cord belt |
| Thick Hide | studded leather shoulder yoke | panels under a two-row studded belt |
| Fur | layered fur mantle | panels ending in a fur fringe |
| Heavy Hide | longer mantle with carved horn toggles | two overlapping panel rows with strap ends |

Each piece is authored in an upright character frame with the carrier joint at its origin, and its
socket cancels that bone's rest tilt: `spine_03` (-0.226, 0, 0) at world (0, 1.311, 0.007), `pelvis`
(0.286, 0, 0) at (0, 0.949, -0.043). All fourteen are symmetric about the Z axis, so the character's
facing does not enter into it. None has a vertex within 0.157 m of the hip axis or 0.078 m of the
neck axis, which is what lets the thighs and neck pass through rather than intersect.

Materials keep their roles, so the tier tint reaches the plate, mail, studs and hide panels while
straps, belts and panel backing keep their authored leather.

Vertex cost was the first version's problem. The mail was one lofted torus per ring: 134784 vertices
for the Iron neck band and 139776 for Cobalt's, against about 7000 for a whole promoted mineral
specimen. Rebuilt as shallow octagonal ring relief with bright rims and recessed centres, the
fourteen pieces run 1308 to 11860 vertices, 94366 in total.

| Piece | Vertices | Bounds Y | Minimum distance from the carrier axis |
| --- | ---: | --- | ---: |
| proc_armour_collar_5 | 5952 | 0.065 to 0.189 | 0.087 |
| proc_armour_collar_10 | 8052 | 0.065 to 0.189 | 0.087 |
| proc_armour_collar_20 | 5696 | 0.082 to 0.259 | 0.079 |
| proc_armour_fauld_1 | 1308 | 0.002 to 0.039 | 0.157 |
| proc_armour_fauld_5 | 5816 | -0.065 to 0.039 | 0.157 |
| proc_armour_fauld_10 | 8248 | -0.123 to 0.039 | 0.157 |
| proc_armour_fauld_20 | 11682 | -0.230 to 0.039 | 0.157 |
| proc_hide_yoke_5 | 5120 | 0.083 to 0.169 | 0.083 |
| proc_hide_yoke_10 | 8808 | -0.017 to 0.189 | 0.078 |
| proc_hide_yoke_20 | 11860 | -0.052 to 0.189 | 0.078 |
| proc_hide_skirt_1 | 3504 | -0.147 to 0.041 | 0.158 |
| proc_hide_skirt_5 | 6728 | -0.171 to 0.041 | 0.158 |
| proc_hide_skirt_10 | 6280 | -0.209 to 0.041 | 0.158 |
| proc_hide_skirt_20 | 5312 | -0.230 to 0.041 | 0.158 |

They are generated rather than promoted GLBs, so the manifest does not move and there is nothing to
download; the geometry already has to be in the client bundle for the icon renderer.

### What the captures show

All eight sets, four views each, in `test-results/tiers-parts-montage.png`, against the same eight
sets before the pieces in `test-results/tiers-male-montage.png`. The four metal tiers and the four
hide tiers are now separable by construction and not only by colour, and the hip pieces cover the
bare band from every normal angle. A little of the inner upper thigh can still show in a close low
view, which is recorded rather than claimed fixed.

Under motion: `forest-male-knight` and `forest-female-ranger` re-run through the full slice 13
matrix, so the pieces are seen through real run in four directions, a real melee open, staff and
wand casts, a real tree chop, a real ore strike, a hit flinch, a death fall and a corpse view. They
track the torso and pelvis; the thighs pass inside the fauld and skirt rather than through them at
the sampled stride.

### Still open

The hands slot and the metal line's upper arm both need a new skinned mesh per body. A
bone-parented piece cannot substitute for either: a hand bends at five joints and an upper arm
rotates independently of the spine. Both are recorded as `rework` in the item dispositions with the
reason spelled out.

## Item dispositions

`runs/corealm-rebuild/equipment-catalogue-disposition.json` now carries `resolution`,
`resolutionReason` and `resolutionEvidence` on all 227 items: **174 accept, 53 rework, 0 retire**.

Nothing is retired. No catalogue id is redundant in gameplay terms; every failure found is a
presentation failure on an item that still has to exist, so the honest verdict is rework.

Held gear, worn armour and the tools were judged in the production forest, mining and fishing labs
and the environment gallery. Every other group was judged from its published 256 px masters,
assembled into labelled per-group contact sheets under `test-results/icon-sheets/` and read one
sheet at a time. That is what "evidence" means for an icon-only group, and the limit is stated in
the file: a reworked icon has to be reviewed again after regeneration.

The 53 reworks, with the reason in one line each:

| Items | Why |
| --- | --- |
| 6 hides and pelts | one folded-pentagon shape recoloured six ways; boar_bristle is bristles drawn as a hide |
| 15 horns, fangs, claws, feet, tails and stings | one curved tusk recoloured fifteen ways |
| 2 glands | one stoppered flask twice; reads as a potion |
| hen_feather | drawn as a veined leaf |
| 12 meats | four cuts collapse into three icons that differ only by cooked state |
| 8 metal pendants and charms | drawn as the ring with a gem on it, so a pendant is a ring |
| 8 hands pieces | a wrist cuff over a bare hand, both lines, both bodies |
| marks | rendered nearly edge-on and very dark |

That is 24 drops, 12 food, 8 accessories, 8 armour hands and the coin. The metal line's bare
shoulder-to-forearm run is not on that list because the four metal body pieces are accepted on
their tier construction; the sleeve is carried in "Still open" above and in the slice 13 record.

An `accept` whose reason begins "Was:" records the state after this round reworked the item. The
text before the change is kept so the verdict can be re-checked rather than taken on trust.

## The revised opal

Held for a candy-like regular oval under broad colour bands. Two revision rounds, each reviewed
across a 24-yaw, three-pitch orbit plus a top-down in the production gallery
(`npx tsx runs/corealm-rebuild/checks/mineral-orbit-review.ts`).

- Before: a large lobed patch of nearly uniform tangerine with two or three darker lobes and one
  teal blotch. A full turn at three pitches did not change it. `test-results/opal-current-montage.png`
- Round one broke the outline into a real seam with rock tongues cutting into the lens, which is
  kept, but painted the fire into the albedo as large flat fully saturated tiles at equal size over
  the whole exposure: stained glass, and still static through a turn, because the colour was in the
  base map rather than the film. `test-results/opal-r9-montage.png`
- Round two keeps that outline, makes the base colour map the body — a warm amber-to-orange field
  with crimson seams and cloudy patches, 2.5% of its pixels outside the 10-60 degree warm band — and
  moves the fire into the thin film at 180-1100 nm with 0.75 iridescence, piecewise constant per
  flash cell. The flash pattern visibly differs between yaw 0 and yaw 5.76 at the same pitch.
  `test-results/opal-r10-montage.png`

Promoted. The other seven specimens are byte-identical, checked against the served files rather than
taken on trust, and `tests/mineral-items.test.ts` now pins all eight accepted hashes instead of
seven, so a future change to the opal has to come back through a review.

Honest limit: the flashes are warm and cream rather than spanning green and blue. That is a
defensible fire-opal read and it is not the full harlequin spectrum.

## Icons

Regenerated for the items whose model changed and was accepted, and for the accepted models whose
published icon predated them: 4 daggers, 4 shields, 9 staves, 9 wands, 8 minerals, 40 armour pieces.
74 masters and their 48 px derivatives. Each group was re-read as a contact sheet.

The armour icons needed one renderer fix first. It draws every part at the origin, which is right
for a skinned outfit piece carrying its bind pose and wrong for an additive tier piece authored
around its carrier joint: the first render put a neck ring and a hip ring on the floor beside a
shrunken cuirass. `wornTrimRestTransform` returns the body-space rest transform, composed from the
carrier bone's rest position and the socket that already cancels its tilt.

`npm run icons:verify` could not be completed. Its capture budget is 5 s and its whole-run deadline
270 s, and on this shared machine one full-game capture measured 26.6 s with 35 other Chromium
processes running and the CPU at 73%. The capture succeeds and the image is correct, so this is
contention rather than a stall: `GameDriver.screenshot` keeps its 5 s default and now takes
`COREALM_SCREENSHOT_TIMEOUT_MS` for a run that has to share the machine, but even at 60 s per
capture the run then exceeds its own 270 s deadline. Left for a quiet machine. The feature lab
itself is unaffected: a four-capture tier shard completes in 7 s.

What the gate substantively checks was run instead, as
`npx tsx runs/corealm-rebuild/checks/icon-panel-audit.ts`: the same four panel audits with no
captures. Inventory 19 rasters, bank 19, equipment 9, shop 19, every one loaded, every natural size
48 px, drawn at 44 px in the panels and 28 px in the shop, zero SVG fallbacks left visible, 26 icon
requests and every one of them under `/assets/icons/items/48/`, with empty engine and console error
lists. That is the gate's DOM half passing; it is not the gate, and it is not visual acceptance.

## Deletions

- `art/rebuild/candidates/2026-09-05/equipment-v1` — superseded by
  `art/rebuild/candidates/2026-09-06/equipment-held-r3`, which regenerates the same accepted sword
  and axe bytes, checked against the served files, from a newer generator that pins both its own
  hash and the hash of the file the geometry lives in. `equipment-candidates.ts`,
  `equipment-held-candidates.ts`, `stage-equipment-selection.ts` and the tool default were
  repointed first.
- `art/rebuild/candidates/2026-09-05/minerals` — superseded; the accepted selection lives in
  `equipment-selected/minerals` and the promoted bytes reproduce from the pinned generator. Only
  `MINERAL-PACKAGE05-AUDIT.md` referenced it, as a record.
- Intermediate held rounds r1 and r2 from this slice, never promoted and never committed.

`art/rebuild/candidates/2026-09-05/equipment-selected` is the accepted-selection store with its
provenance copies and is kept.

## Tests

`npm run typecheck`, plus `tests/equipment.test.ts`, `tests/equipment-weapons.test.ts`,
`tests/equipment-metal-materials.test.ts`, `tests/equipment-material-inheritance.test.ts`,
`tests/item-icon-parity.test.ts`, `tests/icon-renderer-polish.test.ts` and
`tests/mineral-items.test.ts`.

New assertions: every armour tier above its line's baseline resolves exactly one neck piece and
every tier resolves exactly one hip piece, no two tiers share a piece, and the eight pieces across a
line are distinct; a worn part that is not skinned must still have a socket; and all eight mineral
specimens reproduce their accepted bytes.

## Limits

- The tier pieces are rigid and parented to one bone each. They follow the spine and the pelvis
  correctly. A skirt does not simulate, so at an extreme leg lift a thigh will reach the inside of
  a fauld; nothing like that appeared at the strides sampled in the matrix, and nothing here claims
  it cannot happen.
- Set-bonus inference and save ids are untouched. The pieces are presentation only:
  `content/equipmentSets.ts` and every saved item id are unchanged.
- Judgements for icon-only groups come from the published master, not from a fresh render of the
  underlying object.
- No timing or frame-rate claim is made anywhere in this slice. The vertex counts above are static
  measurements of the geometry, not a performance result.
