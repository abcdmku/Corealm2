# Armor and inventory presentation audit

Source audit with hardware review, 2026-09-05. Sixteen full outfits were captured front/back in the production lab. The post-fix headgear rerun then passed with 12 inspected captures proving hide/restore on both bodies. Motion acceptance remains pending. This note does not approve the entire armor catalogue.

## Material change

`equipmentVisuals.ts` now retains the source material's `onBeforeCompile` and `customProgramCacheKey` when cloning a worn part. Three's clone omits those callbacks, which previously discarded any authored shader treatment before the armor tint ran. The same preservation already exists in `MaterialManager.variant` and `depleted`. The change keeps source material ownership and textures intact.

Focused CPU validation passed: `npx vitest run tests/equipment-material-inheritance.test.ts tests/equipment-metal-materials.test.ts`, 30 tests across 2 files. The new regression exercises Knight, Ranger and wood tier shaders with an authored source callback and checks source immutability. It does not measure appearance in Chromium.

## Current armor construction

- Both body variants resolve all five armor slots to their matching male or female source mesh. No skinned part receives a tier scale.
- Knight has four palettes across helmet, chest, pauldron, scarf, legs, boots and gloves. The chest item supplies the pauldron and scarf too. Its metallic mask preserves authored cloth and leather pixels.
- Ranger has four palettes across hood, chest, pauldron, legs, boots and gloves. The texture luminance treatment distinguishes warm leather pixels from cloth. It uses no emissive lift.
- `rebindSkinnedPart` preserves each part's inverse bind matrices while resolving host bones by name, resets mesh transforms, and uses attached bind mode. This is the correct source path to examine during deformation proof.
- Material merge names include tint and accent, so mixed tiers remain separate after the rig combines meshes.

These are two imported outfit silhouettes recolored into eight sets. The mappings alone do not meet the request for new reference-driven armor construction.

## Rig findings for the integration owner

The audit found that `CharacterRig.rebuildLayersNow` cleared the old layers after an individual clothing load failed, then applied a cap based on requested coverage. The package now aborts before mutation on any source-load failure and retains the complete previous outfit and cap. `tests/character-rig-layer-recovery.test.ts` checks that recovery behavior.

The hardware review confirmed hair through helmet crowns on both bodies and female hair buns through hoods. The package now removes the hair layer while headgear occupies the head region, preserving the base hairstyle for headgear removal. Faces and neck skin stay present. A focused test checks hair hide/restore loading. The post-fix normal-swap browser check passed with semantic slot checks and inspected front/back/head-removed screenshots for male/female Copper and Hide outfits.

The head cap removes the entire body below its threshold once torso, legs, feet and hands are covered. Check cuffs, neck seams, and gaps during death and gathering, including mixed Knight/Ranger pieces. Making armor larger would violate the skinned fit assumption and is not an appropriate source-only fix.

## Required lab acceptance matrix

Use the real combat lab, production gear resolver, `CharacterRig`, asset loader and animation mixer. The root schedules the single GPU session. For each row, record selected body, equipment IDs, loaded mesh IDs, attachment/rebind status, action state, camera and screenshots. Use normal equip actions and compare state before and after.

| Scope | Cases | Checks |
| --- | --- | --- |
| Every armor item on both bodies | Male and female × 8 sets × head/body/legs/feet/hands, 80 slot/body cases | Load success; correct body asset; no source-material mutation; correct selected item and stats; readable shape at gameplay distance |
| Every complete outfit | Both bodies × 8 sets, 16 outfits | Front, rear, left and right; metal versus leather/cloth; neck, underarm, elbow, waist, crotch, knee and ankle seams |
| Motion for every complete outfit | Idle, walking, running, turning, melee, right-hand casting, chopping, mining, hit and death | Capture start, peak joint bend/impact, and recovery/end. No skin leaks, detached armor, missing limbs, hair protrusion, or weapon/armor intersections |
| Mixed armor | Both bodies; Knight chest/Ranger limbs and reverse; lowest/highest tiers together | Separate material colors survive merging; all five slots replace and restore correctly; pauldron/scarf do not remain from removed chest |
| Head compatibility | Both bodies; each available hairstyle; helmet, hood and unequipped head | Face stays present; scalp is covered; hair does not protrude through rigid surfaces |
| Runtime changes | Equip, swap tier, unequip, gathering-tool replacement, death/respawn, save/reload | Visible parts and semantic bonuses match persisted slots; no stale attachments or materials; recover cleanly from failed load |

Any unprovided body/action selector must be added to the persistent lab before acceptance. A separate turntable cannot replace motion proof.

## Inventory and accessories

The 16 ladder rings/pendants/charms intentionally return no worn mesh and are excluded from visible equip slots. Inventory presentation is separate: `itemIconAppearances.ts` maps rings to the ring primitive and pendants/charms to an amulet, including additional animal-derived variants. This is deliberate coverage, not worn jewelry proof.

The icon catalogue routes gathering tools through the production appearance resolver, preserving their tint and grip geometry. Food uses shared raw/cooked geometry with color differences. Animal drops and accessories use procedural icon forms. Their mapping existence does not establish recognition at 48 px.

After model approval, the icon owner must generate the full catalogue at 256 px and 48 px and inspect contact sheets. Compare raw versus cooked food, ring versus pendant/charm, every tool family, every animal drop, and every mineral. Record item ID and recipe/tooltip/equipment consistency. Amber, opal and garnet remain subject to the mineral owner's staged review. No icons were regenerated during this source audit.
