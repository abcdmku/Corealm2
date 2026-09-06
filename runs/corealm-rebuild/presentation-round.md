# Presentation round

The UI changes fix bounded interaction defects. This is not final presentation acceptance.

- Panel ordering stays below menus after repeated raises. Clicking a panel raises it and moves its Escape handler to the top.
- Panel drags stop on pointer cancellation, window blur, close and disposal. Another pointer cannot move the current drag.
- Closing a background panel does not steal focus. Hidden former focus targets are skipped.
- Already loaded deferred overlays honor their visibility guard.
- Custom bank/shop/production quantity input refreshes while typing. Quantity radios support arrow keys, Home, End and one tab stop.
- A disposed audio director ignores late movement, combat, activity and event observations.
- Equipment shows current set pieces and each active or pending threshold using the frozen equipment set catalogue.
- The Quests panel hosts the production hunt board. Root binds it with `ui.setHuntContracts(hunts)`. Snapshot changes refresh through the existing 220 ms visible panel update, and reopening refreshes immediately. No standalone world overlay is created.
- Quest region labels now retain their skill requirement suffix.

## Checks

`npx vitest run tests/presentation-lifecycle.test.ts tests/lazy-panel-ordering.test.ts tests/audioEngine.test.ts tests/production-panel-quantity.test.ts` passed 30 checks across four files on Node 24.14.0.

`npx tsx runs/corealm-rebuild/checks/presentation-browser.ts` passed against port 4175. Set `COREALM_URL` to change the server. This fixture loads production UI modules and styles directly without starting WebGL. It checks z-order and Escape after 30 raises, pointer drag cancellation, actual quantity typing and arrow keys, equipment set state after removing a piece, and real hunt acceptance through the production system. Closing and reopening the journal preserves the hunt and hides its board while closed.

Disposable evidence is in `test-results/presentation-browser`. The 1280x720 and 800x600 panel captures, equipment set capture and journal hunt capture were inspected. The narrow equipment panel scrolls to expose all set thresholds.

## Remaining root acceptance

Run TypeScript and combined checks after integration. Exercise the same modules through the real lab and final game with actual inventory, shops, banking, equipment changes, death and travel. The isolated DOM fixture proves these controls and lifecycle changes, not all end-to-end game input paths.

Player models, grips, locomotion, camera collision, species voice quality and final-world region/interior ambience remain outside this round's proof. Existing production gathering audio uses rig contact markers and magic casting uses launch events.

## Follow-up audio and lifecycle work

Animal one-shots now use Web Audio HRTF panners with source positions and a camera-oriented listener. Linear distance attenuation combines with a quiet source trim. UI, player footsteps and tool contacts remain centred. Panners disconnect on end, reset and disposal. Region changes invalidate pending old one-shots, reset creature cadence and refresh listener position. Death cancels pending sounds and suppresses creature chatter until the player is alive. Reset also handles a rewound simulation clock. Resource depletion adds its break/fall cue without duplicating the contact sound already emitted by the rig marker.

The six focused suites now pass 52 checks, including four audio travel tests. `audio-spatial-browser.ts` passes through the production AudioEngine and actual Chromium OfflineAudioContext without WebGL. Deterministic broadband input verifies left/right direction, reversal after a 180-degree camera turn and distance attenuation. Near-channel energy is 21.65 versus 9.25 in the far channel. At 30 metres, combined energy is 0.63 versus 30.90 at 6 metres. This proves the spatial graph, not subjective recording quality.

Visible loot and transient panels close on death and region changes. New game also hides an already loaded death report. DeferredOverlay now exposes hide while retaining its loaded module.

The same-ID hover refresh now reads the semantic label at the existing 70 ms throttle. It skips DOM/layout work when text has not changed. The DOM browser suite instantiates the production InputController, holds the pointer still on a depleted Oak, changes its semantic state to available and observes `Chop Oak` without pointer movement.

`presentation-game-browser.ts` passed 20 panel bound/text/Escape checks on hardware RTX 5080 in 9.1 seconds, at 1280x720 and 800x600. Screenshots were inspected. The shop capture showed an out-of-range empty state, so it does not prove the stock catalogue; the next run approaches its authored interaction point and requires real stock rows. Spellbook rung labels and element headers were cramped, prompting width 360 and a 48-pixel rung column. These last two corrections await a fresh scheduled GPU run. Actual dialogue/death interactions remain required.

`presentation-shop-loot-browser.ts` is prepared as a separate 59-second scheduled hardware check: both shop and corrected spellbook at both sizes, followed by five real loot-grid clicks and nonoverlapping catalogue-named receipt checks over the rendered game. The imported pile is explicitly diagnostic setup, separate from QA's natural boss loot-generation proof. Every run uses a timestamped evidence directory to retain failures.

## Ordrun loot receipt correction

The five natural Ordrun pickups exposed two VFX defects: labels fell back to legacy item IDs and the horizontal damage fan did not separate long receipt strings. `render/vfx.ts` now reads the current catalogue name before event-provided text. Receipt text uses cached measured dimensions and screen collision checks to shift older overlapping labels upward. Damage numbers retain their original fan and all lifetimes remain unchanged.

Hardware retry `test-results/presentation-shop-loot/1788637783451` verified readable shop stock and widened spellbook at both viewports. Receipt evidence failed on four visible rows rather than five: the final transfer removes the source pile before the queued event reaches Vfx. Loot receipts now fall back to player position when that source no longer exists. The DOM regression passes 12 scenarios including final-stack source removal. Actual hardware final Fur Pelt visibility and expiry remain pending; the failed hardware report and screenshot are preserved.

Final hardware acceptance passed in 8.4 seconds at `test-results/presentation-shop-loot/1788638625858`, using RTX 5080 / Direct3D11. All five screenshots were inspected: shop stock, prices and controls fit both 1280x720 and 800x600; spellbook rung labels and element headers are readable at both sizes; the rendered scene shows five separated receipts, including `+2 Fur Pelt` after final-stack removal. All five inventory totals match the declared imported fixture, the pile is absent, and the real receipt expiry wait passed. The helper waits for the final receipt's published event because the 100ms simulation tick can follow two render frames. Earlier failed directories remain preserved. This proves production loot transfer and presentation; natural boss drop generation is covered separately by gameplay QA.

`loot-receipts-browser.ts` exercises production Vfx with the actual five item IDs at simultaneous and 80 ms arrival intervals. At 400, 700 and 1100 ms it checks every label pair for overlap and asserts Cobalt Sword and Garnet. All six scenarios pass, labels expire at the original deadline, and both disposable screenshots were inspected. It runs without WebGL. The full Ordrun scene remains queued for root visual acceptance.
