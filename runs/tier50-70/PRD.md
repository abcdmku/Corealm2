# T50 and T70 reference armor

The user's current request authorizes model creation. Working scope is Dragonhide T50 and Starhide T70, five garments each: hood, robe, leggings, boots, wraps. Use `art/item-icons/generated/{dragonhide,starhide}_*.png`. Preserve prior Starhide review exports and package; create a separate authoring round.

Build slim native male 65-bone garments with full fingers and layered fitted clothing. Dragonhide uses burgundy cloth, violet-blue scales and antique gold trim; Starhide uses indigo cloth, cyan-blue-violet scales and silver trim. Match each item’s distinct panel contours and embellishments rather than applying a palette swap. Prioritize actual thin overlapping scutes, raised engraved borders, smooth cloth profiles, readable woven/leather surface detail, and animated layering clearance.

Frozen interfaces remain `game/src/contracts.ts` and `tools/item-models/contracts.ts`. New round material and builder contracts are in `tools/item-models/tier50-70/contracts.ts`. Root owns interfaces, author wrappers, exporter integration, browser tests, acceptance and packaging. Workers have distinct source ownership.

The production combat lab booted successfully in Chromium for this run before geometry workers started. No lab-first exception applies. Each candidate requires individual front/side/back review, worn idle/walk/casting proof through normal player camera controls, fresh read-only visual critique, and root acceptance. Build/typecheck and appropriate focused tests must pass. Production promotion requires visual acceptance; otherwise deliver honestly labeled review files without changing normal equipment.

Deliver two editable packed Blender scenes, ten standalone skinned GLBs, actual model studio renders, reproducible sources, and source/hash/validation evidence. Single-view artwork leaves unseen construction unspecified; continue the visible design language there. Record remaining deviations plainly.
