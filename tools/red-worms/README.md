# Red worms

The owner's September 12 request adds the small model from their owned Worms FREE package to the grass outside Millfield's south wall. Their follow-up reduces the first preview by 20% and darkens the red again. The production scale is 9.6, about 1.75 m long after the tier-one silhouette factor.

`python tools/red-worms/extract.py` stages the owned Unity archive. The pack ships only a Look take; the Walk, Run, Attack, Hit and Death that `build.mjs` keyed as sine waves were removed on 2026-09-29 with the other repo motion generators. The worm is rebuilt by `tools/creature-rig/` (retargeted from a snake donor, or hand-keyed in Blender if that fails).

The accepted lab run used real attack-button input, recorded worm health 8 to 0 and player health 23 to 18, checked the native idle and authored movement, and reported no browser or game errors. Images and semantic journals stay disposable under `test-results/red-worms/`.

World placement follows the authored-world exception because the receiving wall, gate and terrain exist only in the full world. The model, material and local interaction were accepted in the lab first. The owner's next follow-up requests eight worms closer together. Eight fixed residents now occupy the eastern verge, screen-left when approaching the south gate, with about 3–4 m between roots and a 0.35 m wandering radius. `?mode=combat&spawnSpacing=1&population=worms` exercises their production placement in the lab. `npx tsx tools/red-worms/world-test.ts` checks the promoted asset, count, receiving ground, placement and actual keyboard movement with the ordinary player-follow camera.

The generic 25 m starter exclusion otherwise pushes this requested group away from the wall. Boot permits only this passive group inside the bounded verge, x between -154 and -132, z between -129 and -112. Collision, dry-floor, navigation and neighbour spacing checks remain active.
