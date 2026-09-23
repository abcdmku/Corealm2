# Temporary asset review

Run `npm run assets:review`, then open <http://127.0.0.1:4186/review/>. Stop that command with Ctrl+C when finished. Use `npm run assets:review -- --port 4187` if the default port is busy.

Search by item name, item ID, or author group. Choose **Current** for the game's active item visuals or **Staged** for files in the item-model candidate catalogs. **View staged version** and **View current version** switch the same item between sources.

- **Wear set** equips the selected armor family through the production feature lab.
- **Wear item** equips an individual armor piece or weapon.
- **Model alone** places the source model in the existing environment gallery. Choose a component for multipart equipment, rotate the model, or enlarge a small item to 2 m. Source materials are shown here; wear equipment to see its current tier finish.

Click inside the game for WASD movement, right-drag camera rotation, and wheel zoom. The camera follows the player with normal gameplay limits. Jewelry and non-wearable items open in the model gallery. Staged wearable models use their authored male rig; current equipment also supports the female body.

The review server reads and validates the staged catalogs without modifying the production manifest or copying models into it. A separate in-memory manifest supplies staged files only to explicitly selected review sessions. Staged sets use the available candidate pieces across author groups; the selected group wins when more than one version exists. A staged entry can say **Same model as current** when its bytes already match the active model.

These are the saved candidate models, including designs previously set aside. Their presence in this preview does not mean they have passed art review or been added to the game. The normal game keeps its accepted equipment.

## Tripo integration status

Updated September 22, 2026. This snapshot tracks the current starter armor and creature integration round. Staged files remain candidates until root acceptance; the latest armor integration, focused checks, and production build have passed.

Tier direction: small, simple fauna remain T1; large or complex creatures start at T10+. Bramble Tiller and Galeskin are accepted in the T10 world after fresh authored-world proof.

| Status | Assets | What remains |
| --- | --- | --- |
| Production committed | Novice Marchhide robes | Continue using the production feature lab for any later material or fit changes. |
| Production integrated | Copper Grithe, Iron Corven, Charhide red wizard set, Dewglass teal armor | Charhide and Dewglass each have five exact armor pieces. PBR correction is synced for Grithe, Corven, and Dewglass. Focused armor checks pass 8/8 and the production build passed. |
| Production integrated; T10 accepted | Galeskin boss | Six-motion and content edits are complete. T10 Fallowmarch proof confirms the live `creature_boss_galeskin`, correct tier/asset/live rig, and zero errors; normal-camera capture: `test-results/tripo-lab/t10-galeskin-world-visible.png`. `worldIntegrated: true`. |
| Fit review held | Crownsilver armor | A 7-triangle reroute still leaves a blue-gray tab at the right underarm. Keep held until the fit is clean. |
| Production integrated; T10 accepted | Bramble Tiller creature | Production GLB/manifest and name, ecology, and drop sync completed; content check and build passed. Six-motion and warm woodland PBR passed. T10 Fallowmarch south proof confirms `creature_briar_harrow`, sampled-rig Walk/Idle, drawn bounds, and zero errors; normal-camera capture: `test-results/tripo-lab/t10-bramble-world.png`. `worldIntegrated: true`. |
| Art rebuild queued | Redbrush Prowler interim starter model | The current geometry is old, untextured, and lacks usable UVs. It is not an approved Tripo model; rebuild the art and review it before acceptance. |
| Provenance held | Heath Knucker creature candidate | The Tripo preview is a mechanical leopard, while the approved image shows a russet-and-cream creature. Do not promote without a matching, verified model. |
| Creation blocked | Cobalt armor | Tripo's upgrade paywall blocked generation; rigging and PBR maps were not produced. |
| Visual/motion review held | Grove Brute (Vellenwood T5 candidate) | Approved exact source; catalog status committed in `e57df42`. Candidate GLB was inspected in `test-results/grove-brute-review` and held for its generic bare-chested humanoid shape, shoulder sack, and awkward Run/Hit grounding. Not in game; the new tier rule requires a T10 redesign. |
| Lab review queued | Undercrag Mawer | Exact approved 8K source is archived; rig, animation, and PBR candidate files are prepared. Root lab visual/motion acceptance is pending; not production (`worldIntegrated: false`). |
| Lab review queued | Cragbound Keeper | Exact approved 8K source is archived; rig, animation, and PBR candidate files are prepared. Root lab visual/motion acceptance is pending; not production (`worldIntegrated: false`). |
| Rig repair held | Vetchrunner | Astra-low approved image `b589d56f-eaf7-4f04-92d8-cbbf75f82f2f`; Smart Mesh model `d45e1741-b2eb-4ae6-b98a-8fdb18bd4fdf` (~4K faces). The local GLB is committed in `a7bae79` with 8K color, 4K PBR maps, and UVs, but its skin is unrecoverable: corrupted inverse-bind bytes, identity rest nodes, single-root weights, and no clips. Await a corrected Tripo rig/export or separately reviewed full rig authoring; not in game. [Repair catalog](../assets/art/tripo/imports/creatures/starter-t1-images/vetchrunner-repair/catalog.json). |
| Rig repair held | Ryecrest | Astra-low approved image `fcdb7bb1-5cc0-4bbc-95bb-7131b299dc9b`. The local GLB is committed in `a7bae79` with 8K color, 4K PBR maps, and UVs, but its skin is unrecoverable: corrupted inverse-bind bytes, identity rest nodes, single-root weights, and no clips. Await a corrected Tripo rig/export or separately reviewed full rig authoring; not in game. [Repair catalog](../assets/art/tripo/imports/creatures/starter-t1-images/ryecrest-repair/catalog.json). |

The Tripo armor material correction syncs metal response to the plate regions while keeping cloth and leather matte. Armor source GLBs came in below the requested 8K resolution despite the export setting; do not describe these armor textures as 8K. Bramble's 8K source albedo is paired with 2K runtime normal and metallic-roughness maps. The persistent lab and acceptance workflow is documented in [Development and acceptance loop](feature-lab.md) and [lab reference](lab-reference.md).

The browser check is `npx tsx tools/asset-review/test.ts`. It switches current armor to staged armor and back, checks the rendered asset identities, exercises the standalone gallery, and verifies that the production manifest remains unchanged. Evidence goes to ignored `test-results/asset-review/`.
