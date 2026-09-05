# Gameplay audit

Source review on September 4, 2026. This report identifies reproducible code paths, not accepted gameplay. No code, browser session, test, or whole-game check was run or changed. Existing work was preserved. Root owns repairs and browser acceptance. File references describe the code reviewed and may move during concurrent integration.

The highest-impact repairs are the two quest locks, incorrect shop payouts, and preserving rejected saves. The Root Tunnel also has an authored interaction that cannot succeed. These are bounded fixes worth completing before adding more progression content.

## Confirmed defects

### 1. Completed quests never deliver rewards deferred by a full inventory

Priority P1. `game/src/systems/quests.ts:475` skips every record whose status is not `active`, before `flushPending` at line 477. `completeQuest` at line 524 sets the record to `complete` and then applies its reward. `giveOrPark` at line 653 correctly records items that cannot fit, but no later evaluation visits those completed records.

Finish The Carter's Wager with a full bag. The four Seared Minnows are parked under `pending:seared_minnow`. Freeing slots, waiting, or reloading never delivers them. This affects every quest reward and any earlier parked grant still owed when a quest completes.

Fix by flushing pending grants for both active and completed records before the stage-evaluation guard. Keep stage progression and completion rewards exclusive to active records so retrying delivery cannot pay XP or marks twice. Explain a deferred reward in the player notice rather than only saying the bag is full.

Prove in a compact quest fixture using the production inventory and quest systems. Complete with zero free slots, free one slot, verify exactly one reward arrives, reload, then make room for the remainder. Assert exact item conservation and unchanged completion XP/marks through repeated ticks.

### 2. Early Air Altar awakening permanently blocks The Sparking Stone

Priority P1. The quest is offered at Mining 10 in Karrowmoor, while its Air Orb and altar are available in tier-1 Fallowmarch. `game/src/content/quests.ts:730` requires a new Roc kill, followed by a physical `air_orb` at line 745. `game/src/systems/essence.ts:228` permanently records an orb's consumption when its altar awakens. `game/src/systems/combat.ts:1084` suppresses all future drops of an already consumed orb.

A player who kills the Roc and awakens the Air Altar before meeting Vess can accept the quest and kill the Roc again, but can never satisfy its next stage. Their progression has made a later quest impossible. Existing saves with an awakened altar are affected too.

Fix the orb objective to accept the corresponding persisted altar awakening as proof of prior use. Keep the one-orb rule. Update the objective/hint when that step is already done. Root can decide whether the initial repeat kill should also acknowledge prior completion; removing the physical-orb dead end is the required correctness fix.

Prove the ordinary first-time sequence and the pre-awakened-altar sequence, including save/reload before quest acceptance. Both must reach the staff objective and eventually complete without another orb being created.

### 3. Shops apply the 60% resale rate twice and show the wrong price

Priority P1. `game/src/content/index.ts:384` defines `sellPrice(value)` as `round(value * 0.6)`. All authored shops set `sellMultiplier` to `0.6` in `game/src/content/shops.ts:27`. `game/src/systems/economy.ts:101` multiplies those together, paying about 36% of value. The reference shop table explicitly describes 60% resale.

The error also breaks displayed-price accuracy. For items absent from shop stock, `game/src/ui/shopPanel.ts:229` falls back to `itemSellPrice`, which applies 60% once. A Grithe Ore worth 12 shows a sale price of 7 marks and actually credits 4. Stocked goods instead display the already reduced price.

Fix by applying the authored resale multiplier once. Use one price calculation for the transaction, shop list, inventory sale row, and tooltip. Avoid compensating only the displayed price.

Prove one stocked item and one gathered item not listed in stock through actual shop clicks. The shown per-item price multiplied by the sold quantity must equal the wallet increase, and the inventory must lose exactly that quantity. Repeat with quantity All. No `EconomySystem` integration test currently appears under `tests`; the formula-only test cannot catch this composition error.

### 4. The Root Tunnel shortcut always rejects its authored verb

Priority P2. `game/src/content/regions.ts:1202` defines `root_tunnel` as an Agility 8 obstacle with `interaction: "enter"`, a 3.5-second duration, and a 145 m saving. `game/src/systems/agility.ts:87` registers only `climb` and `vault`. `game/src/systems/travel.ts:49` registers `enter`, then rejects every entity carrying an obstacle block at lines 55-58. Comments describe delegation to agility, but no delegation occurs.

At the correct level, standing at the tunnel and selecting Enter always returns `UNAVAILABLE`. The route is not merely hard to find; its interaction cannot execute.

Fix dispatch so obstacle Enter uses the normal agility driver and portal Enter uses travel. Root owns any shared handler/port change. Do not turn the shortcut into an unconditional teleport.

Prove a production obstacle fixture at level 7 and level 8, with real input, elapsed traversal, endpoint change, XP, and `obstaclesUsed`. Then check the authored Root Tunnel once in the world. Also check that the Gravelmaw portal still enters/exits normally.

### 5. A rejected save is subsequently overwritten with a fresh character

Priority P1. `game/src/app/boot.ts:203` logs a failed load and continues with the fresh store. `game/src/app/loop.ts:773` autosaves dirty state, and `game/src/app/boot.ts:1204` saves on pagehide. Both write the same `corealm.save.v1` key. The failed source data has no quarantine or write protection.

Open a save from a newer build with this build, or encounter a repair failure. Continuing until autosave or leaving the page can destroy the original save that the failure handler could not read. The migration code's care to preserve raw input does not protect the stored record from those later writes.

Fix by preserving rejected raw save data and blocking writes to its key until successful recovery or an explicit new-game action. Expose the load failure and a concrete recovery/export route in the existing title/settings flow. A diagnostic entry alone does not prevent data loss.

Prove newer-version rejection, malformed JSON, and repair failure. Compare stored bytes before and after autosave and pagehide. Successful normal loading and an explicitly chosen new game must still save.

### 6. Death always returns an ordinary character to Coldbrace

Priority P2. `game/src/state/store.ts:194` initializes `player.respawnPointId` to `coldbrace`. There is no subsequent assignment to this field in `game/src`. `game/src/app/boot.ts:935` resolves that valid node before considering its regional fallback. `runs/corealm/PRD.md:598` requires the last settlement respawn point visited.

Visit Rootfall, Highcairn, or Emberfast and die. The save still identifies Coldbrace as the last respawn point. This creates a long return journey to recover items regardless of later settlement visits.

Fix by updating the anchor upon entering an authored settlement respawn area, using explicit respawn locations. A region boundary alone is not a settlement visit. Persist the new anchor.

Prove visiting settlement A, then B, revisiting A, and saving/reloading before death. Check the resulting semantic respawn position and region, plus an in-world approach to a later settlement.

### 7. Reloading extends the recovery-cache deadline

Priority P2. `game/src/systems/death.ts:199` stores `atMs + RECOVERY_CACHE_TTL_MS` on the current simulation clock. `game/src/persistence/storage.ts:148` and `game/src/persistence/worldContainers.ts:54` restore the deadline unchanged. `game/src/core/time.ts:8` begins a new session clock at zero. The specification at `runs/corealm/PRD.md:600` requires expiry fifteen real minutes after creation, surviving reload.

Die twenty minutes into a session, then reload. The cache now has roughly thirty-five minutes on the new clock. Repeated reloads can continue extending its lifetime. Closing the game also pauses what the specified rule calls real-time expiry.

Fix by storing and comparing a consistent persisted time basis. Update cache countdown readers and migrate existing records together. Death-screen countdown code currently interprets the deadline as simulation time, so changing creation alone would break feedback.

Prove remaining time before and after reload, expiry while the page is closed, and consistent removal from both saved state and semantic entities. The live countdown must agree with the actual expiry.

### 8. Malformed imported state can replace the running game before it fails

Priority P2, lower than ordinary play defects. `game/src/persistence/storage.ts:87` returns `loaded` after recomputation without validating required player/metadata fields. With the current version, `{"meta":{"saveVersion":7}}` can pass this boundary. `game/src/app/boot.ts:2012` replaces the live store before rebuilding the world and reading player fields.

Importing such a blob through the supported debug save path can leave the game holding invalid state after a later access throws. The original running state was usable before the import.

Fix by validating mandatory records before returning a loaded state, and only replacing runtime owners after validation succeeds. Preserve the running state on rejection. This can share validation work with the rejected-save repair above.

Prove missing player, invalid coordinates, incomplete metadata, and a valid current save. Rejections must leave player position, inventory, quests, current world, and stored bytes unchanged.

## Acceptance coverage that is missing

The test suite has substantial focused coverage for melee contact timing, animation continuity, gather receipt ownership, production rollback, magic fuel, loot transfer, and container reconstruction. That is useful source evidence, but this audit did not execute those tests or inspect motion frames.

The progression gaps are concrete. Only `magic-quest.test.ts` and `quest-journal-visibility.test.ts` instantiate `QuestSystem`. The magic quest fixture always grants inventory space and directly inserts the orb/staff, so it cannot reject either quest defect above. Its happy sequence also starts before altar awakening. There are no `EconomySystem`, `AgilitySystem`, or `TravelSystem` constructions in the current `tests` search.

`tools/agent-proof.ts:338` labels its quest proof `cold-iron-start` and accepts an `active` status. This proves discovery and acceptance, not completion or rewards. `tools/scenarios/long-cairn.json` contains a debug stage jump. `docs/feature-lab.md` correctly classifies recordings without expectations as diagnostic, so those scenarios must not be presented as proof of natural quest completion.

Add compact lab fixtures for the affected production quest, shop, travel, and save paths. Root should run exact state assertions through real browser actions, inspect relevant UI screenshots, then perform a shallow authored-world check. Keep full progression play targeted to a small number of cross-system routes; another large matrix of model captures would not test these defects.

Combat source already resolves melee damage at contact and spell damage on arrival. No additional combat/animation defect is claimed here without evidence. Creature and equipment visual quality remains with the separate audits and the root's browser review.

## Respawn repair follow-up

The follow-up inspection corrects part of finding 6. The saved respawn ID never updating is confirmed, but the earlier claim that `coldbrace` resolves to a valid navigation node was incorrect. Navigation's lookup is a direct map lookup. The canonical respawn IDs are `coldbrace`, `rootfall`, `highcairn`, and `emberfast`; their authored settlement route IDs are `town_center`, `rootfall_hamlet`, `highcairn_outpost`, and `emberfast_town`. Consequently, the existing resolver can fall back to the death region's entrance instead of the last visited settlement. Updating the stored ID alone would leave this second defect in place.

The new `game/src/systems/respawnAnchors.ts` provides both pieces. `RespawnAnchorSystem` updates the existing saved ID when a living player enters a 12 m courtyard around an authored settlement route point. The region must match and the player's height must be within 4 m of the point. Merely crossing a regional boundary, standing in a dungeon below a settlement, or being dead cannot bind a surface settlement. Returning to an earlier settlement binds it again. `resolve` maps the saved canonical ID to that settlement's actual route position, including height.

Root integration has two calls. Register the system at its declared order 50, after movement and before combat/death. Make the death resolver prefer `respawnAnchors.resolve(respawnPointId)` before its existing fallback. `buildSettlementRespawnAnchors(id => nav.routeNode(id))` derives the mapping from production settlement and route content. It returns no island anchors when the compact lab does not have those routes. No save migration or shared contract change is needed, and a fresh character retains `coldbrace`.

For isolated browser proof, provide two translated production `RespawnAnchor` records through the system's `anchors` callback, with 12 m radii and at least 40 m between their centres. Put both in the yard's `fallowmarch` region and use `groundHeightAt` for Y. Walk from 12.1 m to 11.9 m from anchor A through real input, and compare `player.respawnPointId` before and after. Visit B, return to A, and verify the last entered anchor wins. Stand directly above an anchor by more than 4 m as a negative setup check. Save/load with B bound, move beyond both courtyards, then use the production death path and verify that the position and region equal B's resolver result. Repeat once in the authored world by visiting a later settlement, leaving its region, and dying. This source change remains pending root browser acceptance.

The focused `tests/respawn-anchors.test.ts` run passed all ten tests in 1.06 seconds. It covers both range boundaries, dead and wrong-region visits, A to B to A selection, unchanged-state writes, SaveService round trips, the real DeathSystem using the saved anchor after crossing a region boundary, and all four production settlement-to-route mappings. No browser, build, or whole-game checks were run for this subtask.
