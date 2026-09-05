# Creature expansion design

September 4, 2026. Root approved the 24-species roster below and owns the PRD amendment, architecture, shared contracts, integration and acceptance. The first release uses terrestrial or amphibious creatures on dry ground. Flight, water combat and new special-attack systems are outside this roster's initial implementation.

The audit began read-only. Root subsequently assigned this worker game/src/content/creatureExpansion.ts and game/src/content/creatureLoot.ts for additive species, item and recipe data. The latter file has one delegated owner. No source models, generated models, shared contracts, authored world groups or browser state changed through this task.

## Frozen roster and count

There are six production work packages with four species each. They provide eight unused source bodies and sixteen original anatomical builds. Each worker needs exclusive source, authoring and staged-output ownership. A family does not mean four interchangeable rigs.

| Group | Frozen species IDs |
| --- | --- |
| Small and medium mammals | redbrush_fox, duskoak_lynx, rootdelve_badger, quillback_porcupine |
| Hoofed mammals | marchwild_horse, cairn_bighorn, marsh_moose, bracken_tapir |
| Sprawling vertebrates | reedjaw_crocodile, kiln_salamander, slateback_tortoise, ashscale_monitor |
| Ground birds | reedbank_goose, blackwater_heron, scree_bustard, marchfield_turkey |
| Crawling invertebrates | quarry_snail, antler_beetle, slag_centipede, hollowroot_spider |
| Large ground monsters | cinder_ravager, basalt_drake, gorge_mantis, quarry_nightmare |

Every asset ID is creature_ followed by the species ID. EnemyDef.family equals the species ID and EnemyDef.id is the species ID followed by _t and its tier. The initial catalogue scale is 1. Models and content need agreement on actual drawn dimensions before acceptance.

A species counts only after its body and motion are recognizably different from the current roster and its closest new neighbor at ordinary play distance. A new ID, palette, scale, tier, material, ornament or loot table alone earns no count. Reusing an existing skeleton is acceptable only when the new geometry, skinning and articulation fit genuinely new anatomy.

## Production audit

Before this expansion, game/src/content/enemies.ts had 35 canonical stat blocks and 38 group aliases. The 24 family strings included bosses and miniboss names. Neither number measured unique creatures.

tools/animals/catalog.mjs exports 22 animal GLBs from 18 distinct rigs. Three rigs are ambient fish. The other 15 terrestrial silhouettes underpin 16 ordinary family labels. Aurochs reuses the cattle body/rig; speckled chicken, dark rabbit and green frog are texture variants. Higher-tier bear, boar, ibex, coyote and viper rows reuse existing bodies. Three regional rhino bosses share one source body. Four regional minibosses share Monster02. None counts toward these 24 additions.

Current ordinary families are frog, hen, goat, cattle, coney, viper, deer, hog, coyote, bear, boar, ibex, aurochs, rat, scorpion and crab. Reaver is humanoid. Existing prose reserves monsters for bosses; root must amend that rule when the new fantasy residents enter ordinary populations.

EnemyDef in game/src/content/index.ts exposes stats, movement speeds, passive/aggressive/territorial behavior, independent drop rolls and optional marks. It has no special attack selector, poison, guard phase, flight, swimming or species-specific respawn. Initial entries use exactly that contract. A wing, fang, shell or gland does not grant an unimplemented mechanic.

The old lab catalogue derived creature presets from REGIONS and dungeon enemy groups. Root has added a shared production species catalogue independent of those groups, so the lab can accept assets before world registration. The lab and world should consume those same definitions, never copied stats.

game/src/content/worldHabitats.ts has 26 ordinary surface habitats with stable anchors, radius, region and dressing. Activities are graze, forage, prowl and patrol. Idle AI follows those points through production navigation and rejects snaps across walls or shores. This supports local ground movement. It does not supply actual feeding, burrowing, perching or coordinated herd behavior. Bosses and dungeon rooms have separate encounter authorship.

Direct production binary inspection supersedes stale model-audit prose. Terrestrial animal and rhino GLBs now contain Hit, HitLeft and HitRight. Hog and rat still lack a distinct Run. game/src/content/creatureMotionTiming.ts records attack duration and contact markers. The renderer resolves clips per asset to avoid binding identically named clips to incompatible skeletons.

Existing items provide four hide tiers and four raw/cooked/burnt meat sets. Those ingredients feed real recipes. Existing animal trophies mostly have sales value and descriptive prose; none of hen_feather, venom_gland, stag_antler, bear_claw or the other trophies occurs in the current pre-expansion recipe input set. New components therefore need actual recipe uses before world loot registration.

## Verified sources

Corealm2/.asset-cache is absent. Documentation describes its expected staging destination, not the current extracted source location.

The extracted animal source root exists at:

C:/Users/Borg/.t3/tmp/animalpack/extracted/Assets/Animal pack deluxe/

The original archive, which still contains animation .meta files absent from that extracted tree, is:

C:/Users/Borg/AppData/Roaming/Unity/Asset Store-5.x/janpec/3D ModelsCharactersAnimals/Animal pack deluxe.unitypackage

| Unused ground rig relative to source root | Bones | Actual motion and exact Unity frame ranges |
| --- | ---: | --- |
| Models/Crocodile_Rig.fbx | 43 | Animations/Crocodile_Idle.fbx and Walk/Run/Bite/Die siblings. Idle 1-240, Walk 1-43, Run 1-17, Bite 1-25, Die 1-47. Needs Hit. |
| Models/FireSalamander_Rig.fbx | 41 | Animations/FireSalamander_Idle.fbx and Walk/Run/Die siblings. Idle 1-160, Walk 1-39, Run 1-25, Die 1-80. Needs Attack and Hit. |
| Models/swan_goose_rig_exp.FBX | 28 | Animations/swan_goose_idle_anim.FBX and walk/run/eat/die siblings. Idle 100-400, Walk 10-40, Run 60-75, Eat 700-800, Die 500-530. Needs real Attack and Hit. |
| Models/snail_rig_exp.FBX | 9 | Animations/snail_idle_anim.FBX and walk/die siblings. Idle 400-670, Walk 10-140, Die 180-260. Needs Attack and Hit. No source Run. |

All four are single-geometry skinned rigs. Their FBXs expose one Take 001. Some animation files contain long takes, so importing the whole file and renaming it as every action is incorrect. Preserve exact Unity frame ranges and measure final exported duration.

Three other unused animal rigs exist but are outside the initial 24: butterfly_rig_exp.FBX, great_white_shark_rig_exp.FBX and octopus_rig_exp.FBX. Butterfly has one flight loop, shark has aquatic movement/attack without death/hit, and octopus has walk/run/death without idle/attack/hit. They need appropriate movement and combat fixtures, not placement on a dry creature grid.

All monster archives below are beneath C:/Users/Borg/AppData/Roaming/Unity/Asset Store-5.x/.

| Species | Archive and internal mesh |
| --- | --- |
| Cinder Ravager | PixeliusVita/3D ModelsCharactersCreatures/Fantasy Monster 3D Model 04 - Game Ready - PixeliusVita.unitypackage. Internal Assets/Stylized3DMonster/Monster04/Monster04_AllAnim.fbx. |
| Basalt Drake | Dungeon Mason/3D ModelsCharactersCreatures/Dragon the Soul Eater and Dragon Boar.unitypackage. Internal Assets/FreeDragons/Mesh/DragonBoarMesh.fbx. |
| Gorge Mantis | PixeliusVita/3D ModelsCharactersCreatures/Fantasy Monster 09 Game Ready Rigged Animations PixeliusVita.unitypackage. Internal Assets/Stylized3DMonster/Monster09/Monster09.fbx. |
| Quarry Nightmare | Dungeon Mason/3D ModelsCharactersCreatures/Dragon for Boss Monster PBR.unitypackage. Internal Assets/FourEvilDragonsPBR/Mesh/DragonTheNightmareMesh.fbx. |

Embedded prefab previews were inspected directly from the archives, without a game/browser run. Monster04 is a tailed reptilian biped with digitigrade legs, head spines and broad clawed forearms. Dragon Boar is a squat armored quadruped with short legs and dorsal spikes. Monster09 is a long-legged winged insectoid with claws. The Nightmare has a lean raised torso, long splayed clawed legs, a thin tail and broad horned head. These are four distinct source bodies; final material and motion still need production review.

Monster04 has eleven embedded named takes prefixed Monster04_: Idle, Idle_v02, Walk, Run, Attack01/02/03, Shoot, GetHit, Die and Stunned. This is a direct named-take import candidate.

Dragon Boar has separate FBXs under Assets/FreeDragons/Animations/DragonBoar/. Exact ranges are Idle 0-40, Walk 0-30, Run 0-24, Attack 0-40, HornAttack 0-48, GetHit 0-40, Die 0-40, Scream 0-80.

Monster09 has zero FBX AnimationStack nodes. Its eleven Unity .anim files contain real rotation/position/scale curves at 30 Hz. Walk is 1 second and Run is 0.667 seconds; both target left/right thigh, leg, foot and toe chains. Attack, hit and death curves also exist. The current named-FBX-take converter cannot ingest them. A Unity animation export or new curve importer is required. Their m_LoopTime is 0, so the importer must establish and verify loop closure. Ground locomotion avoids a flight dependency but still needs planted-foot proof.

Nightmare motions are under Assets/FourEvilDragonsPBR/Animations/DragonNightMare/. Each file contains Take 001. Source ranges are idle01/idle02 0-40, walk 0-40, run 0-30, walkLeft/walkRight 0-45, walkBack 0-41, Basic Attack 0-36, Horn Attack 0-65, Claw Attack 0-100, getHit 0-42, die 0-57, defend/Jump 0-60, Sleep 0-50 and scream 0-84. It has a full ground combat basis without flight.

FourEvilDragonsPBR also contains SoulEater, TerrorBringer and Usurper, with airborne motions. FreeDragons repeats SoulEater, so that duplicate is not an extra species. Skeleton demo is another reserve source, but has only idle/walk/attack and lacks hit/death/run.

Preserve actual attribution and source hashes. Existing provenance is in the animal/boss/miniboss catalogues and game/public/assets/UNITY_ASSET_SOURCES.md. New anatomy built on an imported skeleton should record both the source and original mesh work. Palette-prefab counts never measure unique bodies.

## Anatomy, motion and habitat briefs

The content rows specify proposed regions and activities. Exact coordinates, populations and world dressing belong to root's later authored-world pass. Unimplemented mechanics are excluded. Every attack initially resolves through existing production melee.

### Small and medium mammals

| Species | New silhouette and animation work | Initial habitat and combat niche |
| --- | --- | --- |
| Redbrush Fox, tier 1 | New narrow chest, pointed muzzle, large ears and broad brush tail. Wolf_Rig.fbx is only a reference. Light grounded gait, forepaw-braced nip, directional recoil and curled collapse. | Passive forager in Fallowmarch hedges with an escape lane. Low health and guardhair provide a starter hunting route. |
| Duskoak Lynx, tier 5 | New feline body, broad paws, long hind legs, cheek ruff, ear tufts and short tail. Wolf/deer skinning references need new proportions/gait. Planted paw strike rather than root teleport. | Aggressive solitary hunter on Vellenwood clearing margins. Smaller aggro radius and stronger, slower hits than coyotes. |
| Rootdelve Badger, tier 5 | New wedge-shaped low body, broad digging forefeet, long nose and short tail. Bear hierarchy is a reference only. Sniff/dig idle, rolling low walk and lateral claw strike. | Territorial forager beside Rootfall stumps, clear of harvest approaches. Physical armor and bristles reward a deliberate optional fight. |
| Quillback Porcupine, tier 10 | New heavy rump, short face and modeled quill fan. Rat rig is a small-mammal reference. Low walk and rearward sweep with ordinary melee contact. | Territorial root/scree browser in Karrowmoor. Tough physical coat, weaker magic defense and slow attacks. No reflected damage or projectile quills. |

### Hoofed mammals

| Species | New silhouette and animation work | Initial habitat and combat niche |
| --- | --- | --- |
| Marchwild Horse, tier 5 | New equine torso, single hooves, long straight legs, muzzle, mane and hanging tail. Deer hierarchy is reference only. Correct walk/canter contact and forefeet planted before a kick. | Passive grazer in northern Fallowmarch open grass. Tailhair supports fishing rods. No mount system is implied. |
| Cairn Bighorn Sheep, tier 10 | New wool-bearing barrel body, broad sheep muzzle, short shins and full curled horns beside the skull. Goat/ibex references need a genuinely different body. Weighty walk and planted ram. | Territorial grazer on broad Karrowmoor shelves. Fleece supports a durable crafting route. Must read distinctly beside both goat and ibex. |
| Marsh Moose, tier 10 | New high shoulder hump, very long legs, heavy muzzle, throat bell and palmate antlers. Rebuild deer torso/head/antlers and long stride. | Territorial grazer on broad dry Vellenwood marsh margins. Sparse population, wide anchors and a heavy slow shove. Clear the Blackwater casting lane. |
| Bracken Tapir, tier 5 | New smooth heavy barrel, compact neck, flexible short proboscis, round ears and splayed toes. Pig limbs/spine are references, not a recolored boar. Snout browse, low amble and weighty collapse. | Passive forager in sheltered dry wet-forest margins. Useful leather with lower combat risk. |

### Sprawling vertebrates

| Species | New silhouette and animation work | Initial habitat and combat niche |
| --- | --- | --- |
| Reedjaw Crocodile, tier 10 | Import unused source. Preserve flattened snout, low belly, splayed feet and heavy tail. Map source Bite contact and author directional Hit. | Territorial dry-bank predator with room for its tail. Slow heavy bite and useful scutes. No swimming. |
| Kiln Salamander, tier 20 | Import unused source. Small round head, flexible long trunk, splayed limbs and tapering tail. Author jaw-led bite and articulated recoil with planted feet. | Territorial forager beneath warm damp Ashfin rocks above water. Faster cadence and less physical armor than crocodile. No spit, fire breath or poison. |
| Slateback Tortoise, tier 10 | New rigid domed shell, stout legs, beak and retracting neck. Salamander/crocodile are references only. Shell stays rigid as neck extends for a slow bite. | Territorial warm-ledge browser. High static physical armor, low speed and shell plates. Retraction does not grant invulnerability. |
| Ashscale Monitor, tier 20 | New raised narrow skull, long neck, muscular trunk, spread claws and whip tail. Rebuild the salamander/crocodile anatomy. Tongue-flick idle, raised walk and neck-led snap. | Aggressive dry Kilnhalt scree hunter with a longer aggro range and fast bite. Distinct from sheltered salamander. |

### Ground birds

| Species | New silhouette and animation work | Initial habitat and combat niche |
| --- | --- | --- |
| Reedbank Goose, tier 1 | Import unused source. Long neck, broad bill, webbed feet and horizontal body. Real warning peck and wing flare replace the eating placeholder. | Territorial dry Redsill reed forager outside the fishing approach. Down feeds early crafting. |
| Blackwater Heron, tier 5 | New long legs/neck, narrow torso, spear bill and folded wings. Goose neck hierarchy is reference only; rebuild knees/ankles/contact. One-legged idle and deliberate bill strike. | Territorial dry Blackwater reed shelf. Long activity pauses and accurate slow hits. No standing underwater through a ground-height shortcut. |
| Scree Bustard, tier 10 | New tall stance, deep chest, heavy neck, broad short bill and display feathers. Chicken skeleton is reference only. Ground display, weighty run and planted strike. | Aggressive open-shelf ground bird in Karrowmoor. Fast light blows and useful plumes. |
| Marchfield Turkey, tier 1 | New fan tail, dropped wing tips, stout legs, bare neck, snood and wattle. Rebuild chicken proportions and articulate fan/neck. Strut, peck and folded-wing death. | Passive outer-orchard/paddock forager. Feathers provide an alternate fletching input. Must remain recognizable beside hens. |

### Crawling invertebrates

| Species | New silhouette and animation work | Initial habitat and combat niche |
| --- | --- | --- |
| Quarry Snail, tier 5 | Import unused source. Spiral shell, low foot and separate eye stalks. Add head recoil and rasping strike without bending the shell. | Passive damp-rock forager outside the mine work floor. Slow, low-risk mucus collection. |
| Antler Stag Beetle, tier 10 | New compact six-legged body, wing cases and jointed antler-like mandibles. Scorpion/crab limbs are references only; create the correct hierarchy. Alternating gait and planted clamp. | Territorial deadwood/scree forager. High physical shell armor, low magic defense and long recovery. |
| Slag Centipede, tier 20 | New linked trunk segments, paired legs, antennae and terminal legs. Needs a new segmented spine/gait. Keep length inside an honest navigation footprint; never rotate one rigid board. | Aggressive broad dry fissure-mouth hunter away from safe paths. Continuous leg wave and leading jaw bite. No multi-segment path-following system is implied. |
| Hollowroot Spider, tier 5 | New eight-legged arachnid, narrow waist, broad abdomen, small cephalothorax and fangs. Scorpion provides joint references only. No retained tail/pincers. Alternating gait and planted fang strike. | Aggressive dry hollow-root hunter with short aggro and light fast hits. Thread has a recipe use. No web trap or poison. |

### Large ground monsters

| Species | Distinct source and required motion | Initial habitat and combat niche |
| --- | --- | --- |
| Cinder Ravager, tier 20 | Monster04 tailed reptilian biped. Choose an appropriate claw take, measure contact and preserve real source locomotion/hit/death. | Sparse aggressive patrol in abandoned kiln courts. Strong slow hits and offensive crafting components. No Orb drops. |
| Basalt Drake, tier 20 | DragonBoar armored low quadruped. Source walk/run/horn attack or bite and full-body death. Inspect beside boar/rhino. | Territorial outer quarry bench with broad turns. High physical armor, weaker magic defense and scales. |
| Gorge Mantis, tier 20 | Monster09 long-legged insectoid after proper Unity-curve conversion. Use ground Walk/Run and one claw attack. Wings remain articulated body parts. | Aggressive sheltered Kilnhalt ravine hunter. Tall thin outline, fast light hits and scythes. No hovering or aerial dash. |
| Quarry Nightmare, tier 10 | TheNightmare lean ground dragon, long clawed legs, horned head and thin tail. Use grounded source attack and complete hit/death. | Sparse territorial patrol in broad abandoned Karrowmoor cuts. Higher health, slower hits and defensive plate recipes. |

## Loot and balance implementation

game/src/content/creatureExpansion.ts is the authoritative initial stat/drop table. Each species has its own canonical EnemyDef, disposition, gait-speed targets, activity, description and independent drops. Health/resistances/cadence use the existing tier 1/5/10/20 roster as a baseline. Slow armored targets favor magic; lighter high-magic-armor targets favor melee. Sparse monsters remain below regional miniboss health, with no phase mechanics or Orb drops.

Movement values are provisional until the model compiler provides measured stride and cycle duration. Tune content speeds against the actual new clips before acceptance. Copying a source animal's speed onto different proportions can cause foot slide even when the skeleton is shared. Check chase and faster leash-return cadence, not only idle wandering.

Each species pays one distinct new component. Components have lower sale value than the existing trophy line and real recipe consumption. Optional recipes complement the existing production ladder; old animals remain sufficient for ordinary hides and meat. No mandatory gear progression is locked behind a new rare species.

| Species | New component | Tier |
| --- | --- | ---: |
| Redbrush Fox | fox_guardhair | 1 |
| Duskoak Lynx | lynx_sinew | 5 |
| Rootdelve Badger | badger_bristle | 5 |
| Quillback Porcupine | porcupine_quill | 10 |
| Marchwild Horse | horse_tailhair | 5 |
| Cairn Bighorn Sheep | bighorn_fleece | 10 |
| Marsh Moose | moose_antler_palm | 10 |
| Bracken Tapir | tapir_leather | 5 |
| Reedjaw Crocodile | crocodile_scute | 10 |
| Kiln Salamander | salamander_secretion | 20 |
| Slateback Tortoise | tortoise_shell_plate | 10 |
| Ashscale Monitor | monitor_sinew | 20 |
| Reedbank Goose | goose_down | 1 |
| Blackwater Heron | heron_quill | 5 |
| Scree Bustard | bustard_plume | 10 |
| Marchfield Turkey | turkey_tailfeather | 1 |
| Quarry Snail | snail_mucus | 5 |
| Antler Stag Beetle | beetle_mandible | 10 |
| Slag Centipede | centipede_chitin | 20 |
| Hollowroot Spider | spider_thread | 5 |
| Cinder Ravager | ravager_talon | 20 |
| Basalt Drake | drake_scale | 20 |
| Gorge Mantis | mantis_scythe | 20 |
| Quarry Nightmare | nightmare_plate | 10 |

game/src/content/creatureLoot.ts owns 24 component items, eight accessory sidegrades and 24 recipes. Eight recipes make new rings/charms using existing equipment stats and slots. The remaining recipes produce existing useful resources, food or equipment through the ordinary production path. Exact quantities, outputs, requirements and bonuses live in that file rather than a second drifting table in this report. Root merges its exported item/recipe arrays into the existing registries; this worker does not edit shared items.ts or recipes.ts.

All new trophies must appear in at least one recipe input. Ingredient conversions must consume the component and avoid profitable reversible loops. Equipment outputs need valid slots, normal skill requirements and bonuses small enough to preserve the existing rare miniboss weapon niche. No accessory promises poison, retaliation, heat immunity or another unsupported effect.

Initial wildlife marks use a restrained range of 2 to 6 times tier. Check complete expected loot value against actual kill duration and bank travel before world population growth. Independent rare-weapon rolls and singleton Orb custody remain unchanged.

The first formula check used the production combat functions with only the tier's ordinary dagger/sword equipped. At Melee 3 with a Grithe dagger, new tier 1 targets take an expected 12.6-18.2 seconds. At Melee 7 with a Corven sword, tier 5 takes 19.8-36.5 seconds. At Melee 12 with a Kaldite sword, tier 10 takes 23.3-59.2 seconds, with Quarry Nightmare at the high end. At Melee 22 with an Emberite sword, tier 20 takes 23.4-62.0 seconds, with Basalt Drake at the high end. These are arithmetic predictions, not browser or survivability proof.

Focused strict TypeScript and content-reference checks passed for both files: 24 unique species/stat IDs, 32 new item IDs, 24 recipes, all 24 trophies dropped and consumed, valid item references/quantities/probabilities and eight accessory outputs. Tier populations are 3/7/8/6 for tiers 1/5/10/20. Dispositions are five passive, seven aggressive and twelve territorial. Passive creatures in the existing AI fight back once struck; they do not automatically flee.

Root still needs to register the exported item and recipe arrays. The equipment/icon owner is adding explicit appearances for all 24 components; the eight ring/charm IDs fit the existing accessory icon path. The current icon catalogue throws on missing registered item appearances, so this is a boot dependency.

Staged model metadata exposed a separate motion issue. The renderer currently divides world speed by asset-space implied stride without the final species/tier drawn scale. Root owns that correction. Imported monster metadata also underestimated stance velocity by dividing full travel by the whole cycle; the model lead is correcting its measurement. Do not increase pursuit to an implausible speed simply to satisfy the playback floor. Revise the source gait or select a suitable clip, then tune content against the accepted result. Original authored bodies have closer agreement between declared and independently sampled stance velocity, but all still need browser contact proof.

## Reusable tools and limits

| Tool/module | Reuse and limit |
| --- | --- |
| tools/build-animals.ts, tools/animals/catalog.mjs, tools/animals/convert.js | FBXLoader/GLTFExporter conversion, ranges, textures, grounding, bounds, gait metadata and sidecars. Defaults expect .asset-cache/animal-pack and write production outputs, so workers need explicit isolated staging. |
| tools/animals/stage-clip-ranges.py, stage-textures.py | Recover archive Unity metadata and texture conversion. Preserve exact source orientation and avoid the old forced-flip defect. |
| tools/creature-motion/source-clips.ts | Absolute FBX requests, named takes, ranges, held poses, source hashes and hierarchy. Reuse it instead of duplicating parsers per family. |
| tools/creature-motion/profiles.ts, pose.ts, bear-hit.ts, hooved-hit.ts, validate-deformation.ts | Articulated motion authoring and deformation/contact checks. Each new anatomy needs reviewed bones; one generic spine wiggle is insufficient. |
| tools/build-minibosses.ts, tools/build-bosses.ts | Existing nonhumanoid import patterns. Monster04 named takes, Dragon Boar separate FBXs and Monster09 Unity curves need different source adapters. |
| tools/import-unity-magic-assets.ps1/.cs/.ts | Transactional Unity export precedent. It currently exports static assets; animation export remains new work. |
| tools/rebuild-creature-motion.ts, tools/promote-creature-rebuild.ts | Stage and promote accepted motion/assets with metadata. Only root promotes shared manifests/sidecars/timing. |
| tools/audit-model-library.ts, tools/animals/inspect.ts | Offline geometry/material/bone/clip review. Source checks reject defects; they cannot prove gameplay or art quality. |
| tools/animals/motion-quality.ts, loop-check.ts, pose-shots.mjs, stride.mjs, tools/calibrate-creature-grounding.ts | Later pose, loop, speed and contact diagnostics. Stationary cycles do not prove grounded traveling actors. |
| tools/lab-session.ts, tools/creature-lab-test.ts, tools/creature-field-probe.ts, tools/creature-walk-probe.ts | Persistent Chromium and production lifecycle/locomotion checks. Root runs combined lab/whole-game gates. |
| tools/generate-item-icons.ts, tools/verify-item-icons.ts, game/src/render/itemIconAppearances.ts | Existing item artwork and validation path. New components need readable inventory-size shapes, not generic recolored gems. |

## Production rounds and acceptance

Root assigned tools/creature-expansion/** and tools/build-creature-expansion.ts to the model production lead. Its workers should own separate family sources/modules/staged outputs. No concurrent workers edit shared manifests, contracts, timing tables, content registries or world groups. Root integrates those after lab acceptance.

Start with unused crocodile because a real source bite already exists. In parallel, review one original mammal and bird body in isolated staging. Accept representatives before copying rig/material treatment across a family. Goose tests a missing attack, snail tests rigid shell and soft body, and Monster04/Dragon Boar test distinct import paths. Monster09 curve conversion is a separate prerequisite.

The owner's finer silhouette/material direction applies to creatures. Large flat body facets, stretched primitives, generic noise and attached spikes do not satisfy it. Inspect close and ordinary-play views before approving broad production.

Each species requires:

- Source identity, provenance, output IDs, dimensions, rig hierarchy, exact clip ranges and contact markers. Original bodies need a comparison beside their closest old/new neighbor.
- Production lab loading without errors and root-inspected three-quarter/profile/gameplay-distance screenshots. Distinct anatomy must survive ordinary lighting and distance.
- Articulated idle, locomotion, attack, directional hit and death. Filmstrips show anticipation/contact/recovery, planted feet, grounded tails and rigid armor/shells where appropriate.
- Real input and semantic changes through approach, provocation/aggro, attack, damage, flee/leash where applicable, death, loot reveal, receipt and natural respawn. Clip names and advancing clocks alone are insufficient.
- Production kill-path loot checks with valid IDs, independent rolls and quantities. A real recipe consumes a component and yields the working item. Icons, inventory and equipment behavior need review.
- Near/far/return motion continuity and representative same-species/mixed crowds at production graphics. Compare actual submitted geometry/calls and frame cost with identical cameras.
- Root acceptance before later world registration. Build success, imported GLBs and source review never increment the delivered-species count.

Add world groups only after acceptance, preserving existing group/entity identities. Use measured footprints and real terrain/navigation samples. Clear bank doors, yards, mine floors, fishing landings, safe approaches and main paths. Sparse dangerous species need escape space and recognizable settings. Do not scatter every species as a generic disc in every biome.

The current graze/forage/prowl/patrol vocabulary supplies authored movement and pauses, not actual food, den or nest interaction. Any intended gameplay interaction needs its own production lab fixture. Exact placements belong to root's world-authoring pass using terrain, navigation and site exclusions.

Final-world checks prove grounding, habitat bounds, shelter/escape space, route clearance, representative combat, loot access and save/reload identity. The world-authoring exception covers placement and world-scale population behavior only. Models, animation, controls, combat, loot and recipes still need lab acceptance first.

Generated reports/screenshots stay disposable unless root intentionally promotes a small evidence set. The delivered count is the number of distinct species that pass these checks, not the number of catalogue rows, textures, proposed names or staged files.
