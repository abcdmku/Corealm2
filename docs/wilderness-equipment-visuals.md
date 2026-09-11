# Wilderness equipment appearance

The production equipment table covers every visible Cindersteel, Nightglass, Dragonhide and Starhide item from `WILDERNESS_LOOT_ITEMS`. Both player bodies resolve to the existing Knight or Ranger parts, including the tier-20 collar, skirt and hip pieces. Rings and charms follow the existing accessory behavior and have no worn mesh.

Cindersteel has a warm dark steel treatment. Nightglass has cool blue-grey metal, Dragonhide has an oxblood cloth treatment, and Starhide has muted violet cloth. The existing metallic and cloth masks retain painted wear, normal maps and leather detail. Wood and leather grips keep their authored materials.

Teak and Magic weapons use the fourth-grade Corealm sword, shield, wand and staff models at their reviewed hand scales. Cindersteel and Nightglass gathering tools retain the tier-20 tool fit. Their higher skill requirements do not increase the model scale. Casting weapons use a small amber or violet gem accent; metal and grips receive no uniform emission.

Ashseal Guard, Regent Staff, Chainbound Sword, Nightmarshal Plate and Hollowstar Staff all have production appearances. Each inherits the fitted parts of its recipe's base equipment with a separate material treatment. Nightmarshal Plate keeps the chest, shoulder, scarf and collar assembly. These are equipment mappings onto shipped constructions, not newly authored weapon or armour models.

The focused check compares every new item with its authored equip slot, confirms both body variants and real GLB files, checks sockets and hand sizes, and verifies that tinting preserves grips and surface maps. Production lab equip actions and normal-camera screenshots remain the root's acceptance gate before world integration.

`tools/wilderness-equipment-lab-test.ts` prepares three separate production lab jobs, each with a 60-second ceiling. Run them serially after receiving the shared GPU lane:

```powershell
npx tsx tools/wilderness-equipment-lab-test.ts --set melee --url http://127.0.0.1:4174
npx tsx tools/wilderness-equipment-lab-test.ts --set magic --url http://127.0.0.1:4174
npx tsx tools/wilderness-equipment-lab-test.ts --set keepers --url http://127.0.0.1:4174
```

The melee job covers complete T50 and T70 sets. Magic covers both sets with their staff and wand. Keepers covers each of the five named rewards. Each case checks equipped IDs, loaded armour parts, bone attachments, actual colour-pass draws, tier materials and preserved armour maps; then it walks with keyboard input and checks that the held equipment stays attached. Front and walking captures use mouse orbit and the normal player-follow camera within its 6–11 metre zoom range.

The lab exposes the male player rig. Female equipment remains covered by the unit asset and slot checks only; these browser jobs do not claim female visual acceptance. The generated reports and full-size screenshots are disposable evidence under `test-results/wilderness-equipment-lab`. Preparing or passing a driver does not replace the root's visual review.

The focused browser run passed all 11 cases: melee in 11.6 seconds, magic in 14.7 seconds, and keepers in 18.2 seconds, each on an isolated server with HMR disabled. All 22 captures retain the player-follow camera at 6 metres and a 0.4-radian pitch. The driver accounts for the production default inverted vertical orbit and asserts the requested angle. The warm/cool metal and red/violet cloth differences read clearly; keeper material differences are subtler because their silhouettes remain those of the existing constructions. No game, page or console errors were recorded. This is male rendering and movement evidence; the root still owns final visual acceptance and world registration.
