# Upgrade fount and ranked equipment

Status: approved through the owner's implementation request and subsequent decisions on failure, jewelry chances, and the +9 to +10 rate.

## Player flow

The tier-one town center has an interactive Upgrade Fount built from the supplied stone platform model. Keep the original GLB unchanged and trim unwanted underside geometry in the imported derivative. Prove its scale, collisions, placement surface and interaction in the existing feature lab before town integration.

At the fount, choose a carried equipment piece and one of Rank upgrade, Jewelry combine or Magic enhancement. Show current and resulting stats, required materials, exact success percentage and failure outcome before the player commits. Show the booster as an optional consumed ingredient. Keep the result visible and update inventory and equipment facts immediately.

All armor, weapons and jewelry have an upgrade rank from +1 through +10, distinct from material tier and equipment requirements. Existing equipment starts at +1 with unchanged base stats. Higher rank never removes skill requirements. Drops cannot exceed +7. Crafting and shops yield +1 unless explicitly authored otherwise.

## Rank chances

Reference: [Knight Online Upgrading](https://knight-online.fandom.com/wiki/Upgrading), retrieved September 26, 2026. The guide describes player estimates, not verified server probabilities. Adopt these as explicit game balance values.

| Attempt | Low class | Middle class | High class |
| --- | --- | --- | --- |
| +1 to +2 | 100% | 100% | 100% |
| +2 to +3 | 100% | 100% | 100% |
| +3 to +4 | 70% | 70% | 70% |
| +4 to +5 | 70% | 70% | 70% |
| +5 to +6 | 65% | 60% | 55% |
| +6 to +7 | 35% | 35% | 25% |
| +7 to +8 | 5% | 5% | 5% |
| +8 to +9 | 1% | 1% | 1% |
| +9 to +10 | 0.5% | 0.5% | 0.5% |

Proposed class mapping: material tiers 1/10/20 are low, 30/40 middle, and 50/60/70 high. Confirm actual catalog tier values during implementation. Low-class equipment needs basic scrolls through the +6 to +7 attempt, then medium scrolls. Middle-class equipment needs medium scrolls through +6 to +7, then high scrolls. High-class equipment always needs high scrolls. The three-scroll design combines Knight Online's separate high and blessed scrolls into one high scroll, using its blessed chances.

Approved failure behavior follows Knight Online: destroy the selected item and consume its scroll and any booster. No hidden pity or previous-attempt influence. The server draws once after validating the complete transaction. Rank +10 cannot be submitted.

The approved booster multiplies chance by 1.2 per booster, up to nine boosters, capped at 100%, and does not protect an item. It is consumed on either result. Boss-only drop chance is proposed at 0.01% per eligible kill; its vendor price is exactly 100,000,000 gold.

## Jewelry and magic

Jewelry consumes three copies of the same item, same rank and matching enhancements, with no scroll required. Success yields one next-rank copy; failure destroys all three. Attempts from +1 through +4 are guaranteed because the reference starts at +5. Attempts from +5 through +9 use the reference chances of 55%, 60%, 75%, 90% and 95% respectively. Never silently consume a differently ranked or enhanced copy.

Rank scaling proposal: multiply base equipment bonuses by `1 + 0.1 * (rank - 1)`, round once per item, and retain +1 values exactly. Use one shared calculation for combat, equipment totals, tooltips and previews.

Magic enhancements are independent of rank. Initial armor choices are Strength, Health and Recoil; weapon choices are Poison, Flame and Frost slow. Strength uses the existing Melee Power stat instead of introducing a duplicate attribute. Recoil returns a bounded fraction of incoming damage without recursive reflection. Poison ticks, flame damage and frost slow must affect authoritative combat and show their duration and magnitude. One enhancement per piece initially; applying another replaces it explicitly. Preserve it on a successful rank upgrade. Proposed application is guaranteed and consumes its material. Existing authored base bonuses remain base bonuses.

Enhancement materials come from level-50-and-higher monsters, with higher miniboss/boss chances. Proposed initial chances are 0.1% on eligible regular monsters, 5% on minibosses and 10% on bosses, selecting one compatible material from the reward pool.

## Drops

Rank an equipment reward after selecting its base item. Use both monster combat level and region tier to choose a bounded rank distribution, retaining existing item identity and reward eligibility. Strong monsters can yield highly ranked lower-material-tier items. Never replace the whole existing loot table with upgrade materials.

Proposed lowest-level rank weights for +1 through +7 are 85%, 12%, 2.5%, 0.45%, 0.04%, 0.009% and 0.001%. Higher progression bands shift probability toward +3 through +7. Author all distributions as validated balance data and test exact boundaries rather than flaky random samples.

Proposed basic/medium/high scroll chances on low-level minibosses are 35%/2%/0.2%; on middle-level minibosses 15%/30%/2%; on high-level minibosses 5%/15%/30%. Regular monsters use one hundredth of these chances. Each kill makes at most one scroll award using disjoint probability intervals. Tune through shared content data.

## State and presentation

Root owns the contract change. Equipment identity must distinguish base item, rank and enhancement through inventory, equip/unequip, bank, shops, ground loot, death recovery, trading, persistence, worker messages and remote player appearance. Transactions address the selected piece, not merely its base item ID. Prevent merging incompatible pieces and reject stale or repeated upgrade commands without duplicate consumption.

Weapon particles begin at +8 and become stronger at +9/+10. Armor +8 has a subtle pulse, +9 a bright glow and +10 a radiant treatment. Maintain readable silhouettes and use bounded pooled effects. Local and remote worn equipment must agree. Inventory names display rank; tooltips show rank-derived and magic bonuses separately.

New scrolls, enhancement materials and the booster require prompted GPT Image 2.5 artwork, source/prompt records, and 256px/48px review under docs/item-icons.md. Existing equipment keeps its accepted icon; rank is a UI label.

## Acceptance

Reuse the existing combat/equipment and loot lab controls. Extend them only for missing setup or interaction controls. No new standalone fixture or runner by default. No lab-first exception is needed for the fount, its UI or upgrade effects.

Focused tests cover rate tables, booster math, rank limits, class/scroll eligibility, jewelry matching, rank stats, combat effects, loot boundaries, insufficient materials, full inventory, transaction atomicity, persistence and transfer preservation. Browser proof must exercise real fount actions and compare semantic state before and after success, failure, jewelry combination and enhancement. Inspect normal-camera screenshots at +7/+8/+9/+10 and the fount panel. After lab acceptance, integrate the town fount and verify one final-world interaction. Run relevant content checks, typecheck and production build.


## Owner decisions

Failures destroy equipment and consume materials. Jewelry uses Knight Online failure chances. Weapon/armor +9 to +10 is 0.5%. Players may consume zero through nine boosters per attempt. Chance is multiplied by 1.2 ** count, capped at 100%; nine boosters raise 0.5% to approximately 2.58%. Boosters do not prevent destruction.
