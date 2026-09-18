# Acceptance

Accepted production lab behavior before enabling the shared social UI in authored-world sessions. No lab-first exception. All browser captures used the normal gameplay camera.

- `npm run typecheck` passed.
- The focused 11-file multiplayer, loot and XP regression run passed 115 tests. Three subsequent cases added full eight-member rotation, partial transfers and unique-orb skips, and optional JSON argument compatibility. The final social suite passes all 12 tests.
- `npx tsx tools/multiplayer-social-test.ts` passed in 12.8 seconds with two independent Chromium contexts and no runtime errors. Real UI input created a party, invited and accepted a member, sent plain-text local chat, killed the production fixture enemy, and collected shared loot. Semantic state proved 50% kill-bonus XP and two successive item deliveries to different party members. A distant member received no local message. Typing did not move the player.
- `npx tsx tools/multiplayer-social-test.ts --authored` passed in 76.8 seconds. The real authored host and two Chromium clients completed party creation, invitation acceptance, local chat and leaving. No runtime errors. The main-world screenshot was inspected for readability.
- `npx tsx tools/multiplayer-lab-test.ts` passed all 28 checks, including contested pickups, private recovery caches, reconnect, restart persistence, shared monster-pile visibility, world isolation and movement. This caught and verified the fix for JSON null optional stack IDs on older piles and recovery caches.
- `npm run build` passed. The build refreshed navigation and generated world assets using the repository's release pipeline.

Disposable reports, build output and screenshots are under `test-results/multiplayer-social/`, `test-results/multiplayer-social-authored/` and `test-results/multiplayer-lab/`. They are not committed acceptance assets.

Hosts and clients must both use protocol version 3. Currency retains its direct kill reward; round robin applies to item pickups. Parties keep disconnected seats for 30 simulation seconds, including after host restart. Chat and invitations are ephemeral.

## Chat and party UI rework (2026-09-17)

User request: replace the separate chat panel. Chat now writes into the HUD message log with an input bar and gear filter menu under it. The party is shown as a section of the pinned-quest card with name, combat level and health for each member. Players invite by right-clicking a character or through the card's + list of online players. The gear menu creates a party. Server additions: party and whisper channels, a `who` roster capped at 100 players, combat level on party members, and invites at any distance to connected players. The protocol version stays 3 because multiplayer has not shipped.

- `npm run typecheck` passed. `tests/multiplayer-social.test.ts` passes 15 tests, including party/whisper routing, the roster, invites at any distance and slash-command parsing.
- `npx tsx tools/multiplayer-social-test.ts` passed 23 checks in 17.6 seconds with two Chromium contexts. Real UI input covered gear-created party, + roster (name and level only), Join, Enter-to-chat, typing without movement, party chat, whispers, channel hide and restore, shared loot, leaving from the gear menu, and a right-click invite on the other player's character. Screenshots inspected: `chat-party.png`, `invite-roster.png`, `player-menu.png`, `invitation.png`, `party-card.png`, `chat-open.png`.
- `--authored` passed 15 checks in 110 seconds against the 120-second budget, with no runtime errors. Screenshot inspected.
- One-off phone runs at 844x390 and 390x844 passed every chat and party check. The lab world panel was hidden for these runs. The chat bar was moved above the spell bar in both orientations after screenshots showed an overlap.
- Full `vitest run`: 3,119 passed and 4 failed outside this change. `renderer-warmup` has two failures from an undefined `elementalRefraction` in `renderer.ts`. The navigation and world release artifact checks report stale data and ask for `npm run world:build`.
- Follow-up: with no party the tracker card showed an empty 216x2 pixel sliver, because the party section registered with the tracker before it was marked hidden. The section is now created hidden, and `noCardWithoutParty` and `cardClearsOnLeave` cover it. The lab run passes 25 checks.
