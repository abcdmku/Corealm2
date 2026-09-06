# Quadruped source decisions

This is a CPU/source audit, not visual acceptance. Every keep decision retains a source for review. Front, side, rear, gameplay-distance and moving production review are still required for the catalogue. No source is marked replace without evidence that it cannot be repaired. Exact license records, FBX names, source clips, GLB hashes, geometry and skin counts, and hash-matched physical contact findings are in source-audit.json.

| Asset | Decision | Source | Work still required |
| --- | --- | --- | --- |
| animal_cattle | rebuild | Cattle_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| animal_aurochs | rebuild | Cattle_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| animal_goat | rebuild | Goat_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| animal_deer | rebuild | Deer_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| animal_coyote | rebuild | Wolf_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| animal_bear | rebuild | Bear_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| animal_boar | rebuild | WildBoar_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| animal_ibex | rebuild | Ibex_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| animal_hog | rebuild | iron_age_pig_rig_exp.FBX | rebuild motion; retain mesh provisionally for required visual audit |
| animal_rat | rebuild | rat_rig_exp.FBX | rebuild motion; retain mesh provisionally for required visual audit |
| animal_rabbit | rebuild | WildRabbit_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| animal_rabbit_dark | rebuild | WildRabbit_Rig.fbx | rebuild motion; retain mesh provisionally for required visual audit |
| boss_rhino_air | rebuild | Fantasy Rhino | rebuild motion; retain mesh provisionally for required visual audit |
| boss_rhino_earth | rebuild | Fantasy Rhino | rebuild motion; retain mesh provisionally for required visual audit |
| boss_rhino_water | rebuild | Fantasy Rhino | rebuild motion; retain mesh provisionally for required visual audit |
| creature_marchwild_horse | keep | Corealm original creature expansion | retain current source for visual review; no visual acceptance implied |
| creature_redbrush_fox | keep | Corealm original creature expansion | retain current source for visual review; no visual acceptance implied |
| creature_duskoak_lynx | rebuild | Corealm original creature expansion | anatomy/material candidate rebuilding; public asset remains rejected |
| creature_rootdelve_badger | keep | Corealm original creature expansion | retain current source for visual review; no visual acceptance implied |
| creature_quillback_porcupine | keep | Corealm original creature expansion | retain current source for visual review; no visual acceptance implied |
| creature_cairn_bighorn | rebuild | Corealm original creature expansion | anatomy/material candidate rebuilding; public asset remains rejected |
| creature_marsh_moose | keep | Corealm original creature expansion | retain current source for visual review; no visual acceptance implied |
| creature_bracken_tapir | rebuild | Corealm original creature expansion | anatomy/material candidate rebuilding; public asset remains rejected |
| creature_reedjaw_crocodile | keep | Crocodile_Rig.fbx | retain current source for visual review; no visual acceptance implied |
| creature_kiln_salamander | keep | FireSalamander_Rig.fbx | retain current source for visual review; no visual acceptance implied |
| creature_slateback_tortoise | keep | Corealm original creature expansion | retain current source for visual review; no visual acceptance implied |
| creature_ashscale_monitor | keep | Corealm original creature expansion | retain current source for visual review; no visual acceptance implied |
| creature_basalt_drake | keep | Dragon the Soul Eater and Dragon Boar | retain current source for visual review; no visual acceptance implied |
| creature_quarry_nightmare | keep | Dragon for Boss Monster: PBR | retain current source for visual review; no visual acceptance implied |

15 current assets are byte-identical to preserved physical-sole audits that report inconsistent stance velocity. These findings remain applicable to the current GLBs. Contact metadata alone does not resolve them. Source integrity found 0 invalid skin weights and 0 nonfinite values.

Shared geometry groups: animal_cattle, animal_aurochs; animal_rabbit, animal_rabbit_dark; boss_rhino_air, boss_rhino_earth, boss_rhino_water. Recolored variants in these groups do not count as different anatomical families.
