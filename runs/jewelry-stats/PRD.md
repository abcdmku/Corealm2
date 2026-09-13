# Jewelry and combat stats

Status: approved by the owner's instruction to implement this update, including T70 Vitality. The item-art policy is directly authorized by the current request and is already recorded in docs/item-icons.md.

## Stat contract

All equipment totals, item tooltips, comparison deltas, guides, and combat calculations use this order and meaning:

| Display name | Field | Effect |
| --- | --- | --- |
| Melee Accuracy | meleeAccuracy | Melee hit chance |
| Magic Accuracy | magicAccuracy | Spell hit chance |
| Defence | defence | Defence against both melee and magic attacks |
| Health | health | Added maximum health |
| Melee Power | meleePower | Melee damage |
| Magic Power | magicPower | Spell damage |
| Vitality | vitality | Critical hit chance |

Keep the existing skill-derived base health formula. Replace its equipment Vitality input with Health. Migrate all existing health bonuses to Health so existing armor does not suddenly grant critical chance. Convert existing Accuracy and Power to their melee names. Collapse old armour and magicArmour with the larger of the two values per item or set bonus, rather than adding both. This conversion preserves each piece's stronger protection; combat tuning must be checked for both attack styles.

Initial critical rule: each Vitality point adds one percentage point of critical chance, capped at 100%; each successful melee hit or spell pulse rolls once for 1.5 times damage, rounded down. Misses remain misses. Damage-over-time, healing, reflected damage, and environmental damage do not roll critical hits. These are implementation tuning values. Existing content gets no automatic Vitality allocation when Health is migrated.

## Craftable jewelry

Owner clarification: one stat per tier, not six choices at every tier. Each tier's metal and gem combination produces jewelry with exactly its assigned stat. No craftable jewelry has a second nonzero bonus or hidden set bonus.

| Tier | Single bonus |
| --- | --- |
| T10 | Melee Accuracy |
| T20 | Magic Accuracy |
| T30 | Defence |
| T40 | Health |
| T50 | Melee Power |
| T60 | Magic Power |
| T70 | Vitality, critical hit chance |

The owner approved Vitality at T70. Each tier has one ring and one earring with identical bonuses, for 14 canonical craftable items.

Use one bar and one tier-appropriate gem per piece at the crafting table, with the matching crafting tier requirement. Initial bonuses: tier / 10 points for accuracy, defence, and power; three times that amount for Health. Preserve existing material identities where possible. Author one tier-to-metal, gem, and stat table, filling gaps in existing production data before implementation.

Mining keeps the primary ore yield and rolls separately for one rare secondary gem appropriate to the resource. Use 7% secondary gem rolls on new higher-tier mining sources, and preserve gem uses outside jewelry. Do not add six gem choices per tier. Check inventory capacity and the production gathering path so neither ore nor a bonus gem disappears during partial delivery.

## Equipment and miniboss rewards

Expose Ring 1, Ring 2, Earring 1, and Earring 2 as four equipment slots. Either slot of a shape accepts the same item. Equipping selects an empty compatible slot first; when both are occupied, the player can choose the replacement slot. Comparison tooltips use that target. Two copies of the same item may be equipped if the player owns them. Each copy contributes its bonus exactly once.

Each tier has one shared rare ring and one shared rare earring, dropped by every miniboss of that tier. There are 14 rare items in total. Both use the tier's following bonus profile regardless of the boss's attack style:

| Tier | Bonuses on each item |
| --- | --- |
| T10 | Melee Accuracy + Defence |
| T20 | Magic Accuracy + Defence |
| T30 | Defence + Health |
| T40 | Melee Accuracy + Melee Power |
| T50 | Magic Accuracy + Magic Power |
| T60 | Melee Accuracy + Melee Power + Defence |
| T70 | Magic Accuracy + Magic Power + Defence |

Every included stat on a rare ring or earring grants exactly +2, including Health, at every tier. No Vitality bonus is implied by these profiles. Owner clarification: each boss drops its tier's shared ring and earring, both carrying the same tier-specific combination, with a 30% chance for a jewelry drop. Implementation interpretation: one 30% roll per kill, then an equal choice of ring or earring, giving 15% each and 70% no jewelry. This is not two independent 30% rolls. Remove the old guaranteed generic Warden reward and the old 2% unique rate.

The miniboss ladder starts at T10, including starter-region minibosses. Ordinary enemy levels are unchanged. The second Wilderness miniboss is T70; the first remains T50. Each region keeps its two existing boss sockets.

## Consolidation and saves

Inventory all jewelry definitions, crafting recipes, shops, quest references, and loot tables before removal. Replace the parallel melee ring, magic ring, pendant, charm, generic Warden, and unique guardian families with the canonical craftable matrix and shared tier pair where they overlap. Preserve unrelated quest items and genuinely distinct rewards.

Write an explicit old-item-ID to canonical-item-ID migration table. Apply it to inventory, bank, equipped items, ground loot, and persisted containers. Preserve quantities and avoid converting one item twice. Save loading already clears production activity. Production consumes inputs only at completion, so retiring an unfinished job loses no inputs. Update content references and generated guides so retired items are no longer newly obtainable.

Map legacy accessories to compatible new slots. If a migration needs to move an item to storage, preserve it even when the normal inventory is full. Version and test the save migration; loading an old save must neither erase jewelry nor award new copies.

## Item art

The current policy is docs/item-icons.md. Luna max audits actual 256px and 48px images and traces source provenance. Classify missing provenance separately from visible quality failures. Consolidate the catalogue before commissioning replacements, and retain a durable source/prompt record for every surviving icon.

Remove the publishing generator's procedural/rendered fallback. Missing prompt-backed artwork must fail before any output is changed, including with --all or --out. Generated-only jewelry must work without a 3D appearance mapping. Keep model inspection tools only for real gameplay assets.

## Acceptance and integration

Root owns shared contracts, migration, integration, and acceptance. Freeze the revised stat and equipment contracts before any concurrent feature implementation. The current Luna audit is read-only and does not modify those contracts.

1. Boot the existing game and persistent production lab in Chromium.
2. Implement the stat, jewelry, recipe, mining, and equipment production modules and a deterministic jewelry workbench in the lab. Stage content and icons before final-world registration.
3. Test all seven tier profiles and every craftable combination, single-stat counts, dual rings and earrings, explicit replacement, insufficient requirements, full inventory, old saves, critical boundaries, Health changes, and Defence in both attack styles.
4. In Chromium, craft, equip, replace, unequip, mine, and claim controlled boss drops through production actions. Compare semantic inventory, equipped IDs, totals, damage, and health before and after. Inspect the equipment panel and item hover screenshots, including 48px icon readability.
5. Root accepts lab evidence, then integrates the accepted data with world sources, shops, saves, and generated guides. Check actual T10 and T70 reward access in the final world.
6. Run typecheck, focused tests, build, relevant icon and guide checks, a representative final-world browser check, and fresh read-only review. Keep generated screenshots and reports in ignored test-results paths unless explicitly promoted as durable evidence.

No lab-first exception is needed for this work.

## Final materials

T10 Cobalt + Garnet; T20 Titanium + Opal; T30 Cobalt + Quartz; T40 Titanium + Amber; T50 Cindersteel + Garnet; T60 Cindersteel + Opal; T70 Nightglass + Opal.

## September 13 art and consolidation amendment

Craftable rings have a simple undecorated band and one small stone. Rare rings retain ornate crowns, thorns, filigree and substantial settings. Consolidate numbered boss rewards into `guardian_ring_t10` / `guardian_earring_t10` through T70. Migration preserves quantities, shape and tier, including two equipped copies from formerly distinct bosses.
