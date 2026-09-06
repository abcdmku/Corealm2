# Source motion diagnosis

The several-hundred-millimetre burial was a conversion defect. The original source armature has `use_mirror_x=True`. Updating edit-bone landmarks with that option enabled changed paired bones during the loop. Connected child heads could also inherit already-updated parent endpoints before being passed through the warp again. V4 disables mirror editing, snapshots every original head/tail/roll, temporarily disconnects bones, assigns the saved warped landmarks, and restores connectivity. V3 remains frozen.

The mesh is originally bone-parented to Lower Spine and also has the same armature modifier. This looked suspicious, but a controlled original-source conversion to object parenting with its rest world matrix preserved gave effectively identical weighted sole positions. It is not the cause of the large errors.

`original-vs-adapted.json` records actual evaluated mesh sole positions at nine evenly spaced frames of every original and adapted action. It independently selects strongly weighted distal vertices for each forearm/shin, rather than using rig anchors or an overall bounding box. Original measurements are uniformly scaled by 0.6 for comparison; segment lengths use transformed physical bone endpoints. Original walking soles range from −0.44 to 174.26 mm. V3 ranges from −543.09 to 700.54 mm. V4 ranges from −12.56 to 175.48 mm on those same nine sample times. The denser 33-frame V4 audit in `../v4/adaptation-report.json` still detects up to 39.47 mm of penetration. The correction restores the source motion's character but does not establish production contact acceptance.

The original idle itself lifts one sampled foot about 490.67 mm. It is not suitable as a calm standing idle, though this does not imply every source action is defective. Eating and transitions also have source offsets. No source action is renamed to hide these behaviours.

V4's rest GLB differs from frozen V3 by at most 0.0000002384 m in corresponding position components. The correction changes the rest rig, not the selected silhouette. Bone names and source action names remain intact. V4 retains the V3 local topology mapping and CC BY-SA 3.0 attribution in its separate ledger.

## Authored calm idle proof

`calm-idle-proof.blend` and `.glb` contain the genuine new five-second `Idle_Calm_Authored` action on the corrected original 22-bone skeleton. It has slight neck and head movement with stationary legs. The seven source actions are omitted from this isolated proof file; they remain preserved in V4. This is not an alias of a source action.

`calm-idle-report.json` measures all 121 frames using the actual weighted sole vertices. Their world heights remain 0–3.945 mm, horizontal centroid displacement is zero, physical lower-leg segment-length change is zero, and all evaluated body vertices remain finite. All three exported meshes have the 22-joint skin; the GLB contains exactly the authored action. These are CPU Blender and structural export checks, not runtime playback acceptance. Missing Run, Attack, Hit, HitLeft, HitRight and Death are still missing.

Credit: Sheep by p0ss; texture photograph by titus tscharntke; Bighorn and calm-idle adaptation by Corealm. The derivative assets remain [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), with the source and change notice preserved. Original source: https://opengameart.org/content/sheep-rigged-textured-and-animated . Texture source: https://opengameart.org/content/woodland-animals-texture-pack .
