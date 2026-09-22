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

| Status | Assets | What remains |
| --- | --- | --- |
| Production committed | Novice Marchhide robes | Continue using the production feature lab for any later material or fit changes. |
| Production integrated | Copper Grithe, Iron Corven, Charhide red wizard set, Dewglass teal armor | Charhide and Dewglass each have five exact armor pieces. PBR correction is synced for Grithe, Corven, and Dewglass. Focused armor checks pass 8/8 and the production build passed. |
| Fit review held | Crownsilver armor | Review the sleeved-body fit capture before accepting or promoting the set. |
| Material review held | Bramble Tiller creature candidate | Its Tripo source has an 8K albedo only, with no metallic/roughness, normal, or emissive maps. Refine its layered PBR materials and complete the quick motion check before starter-world integration. |
| Provenance held | Heath Knucker creature candidate | The Tripo preview is a mechanical leopard, while the approved image shows a russet-and-cream creature. Do not promote without a matching, verified model. |

The Tripo armor material correction syncs metal response to the plate regions while keeping cloth and leather matte. Armor source GLBs came in below the requested 8K resolution despite the export setting; do not describe these armor textures as 8K. The persistent lab and acceptance workflow is documented in [Development and acceptance loop](feature-lab.md) and [lab reference](lab-reference.md).

The browser check is `npx tsx tools/asset-review/test.ts`. It switches current armor to staged armor and back, checks the rendered asset identities, exercises the standalone gallery, and verifies that the production manifest remains unchanged. Evidence goes to ignored `test-results/asset-review/`.
