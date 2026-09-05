# Imported animals

`../imported-animals.mjs` exports `SPECIES` and `buildSpecies(id)`. The browser compiler receives a Three.js object, eight animation clips, and metadata. It uses the existing production animal converter for source frame ranges, root-motion removal, loop closure, unit conversion and texture orientation.

Run `python tools/creature-expansion/imported-animals/stage-sources.py` from the repository root to stage the licensed source files. The default source is the verified extracted Animal pack deluxe directory. `--source` can point to another entitled extraction. Staging preserves FBX bytes and verifies that PNGs match the decoded TGA pixels. The source manifest includes hashes and source paths.

The four species use distinct unused source bodies. Crocodile retains its real source bite. The salamander has a new lower-jaw joint, separated lip surfaces and a skinned mouth interior. The goose has thin articulated vanes ray-fitted to its source torso and atlas; they follow the flank while folded. The snail shell is one rigid component with continuous source-contour curvature and modeled coiled-whorl gutters. Its soft foot has a rounded muscular margin and shallow contraction folds; its eye stalks are separately articulated. Its Run is a new traveling foot-contraction cycle.

All authored combat clips begin and end at the source Idle pose. The crocodile and salamander keep four ball contacts, the goose keeps two webbed-foot contacts, and the snail keeps its shell still through attack and hit recoil. The snail's locomotion uses a continuous sole, so its foot-chain probes are not equivalent to discrete leg contacts.

Metadata records exact gait joints and the median backward stance velocity sampled 120 times per cycle. It also retains the older source converter stride-per-cycle estimates. Source crocodile bite contact is 11/24 of the clip, where the jaw gap reaches its post-lunge minimum. The other authored contact markers match their gesture keys.

`probe.mjs` runs an asset-only browser preview against the parent compiler server on port 59099 and writes disposable pose images and support-motion measurements under `test-results/creature-expansion/imported-animals/`. It includes both flanks, projected-bounds camera fitting, and a snail clay view for judging geometry without texture. Those images are development checks. Production acceptance still belongs to the root's feature lab and gameplay checks.
