# Player input and ground feedback

Local movement now advances on every render frame, in collision steps of at most 20 ms.
The player, camera and shadow use that current position. Enemy simulation, combat cadence,
quests and other world systems retain their 100 ms tick. Starting keyboard or joystick
movement immediately cancels the previous pursuit, including inputs shorter than a world tick.

A mouse press on an actionable entity owns that gesture: a few pixels of hand movement
cannot turn an attack into ground steering. Touch retains the target beneath the finger
at press time, so a creature moving before release does not turn a tap into a walk command.
Static object picking tests cached instance bounds and only intersects the matching source
parts. Creature picking uses the existing moving body capsules, avoiding raycasts through
the complete animated render batches. Static objects still occlude targets behind them.

Selection and walking use hollow rings with feathered edges, projected onto the active
terrain or cave floor. The overhead selection diamond and filled walk disc are removed.
Walking has a faint beam that fades upwards. The walk marker is reused and its texture-free
material variant is prepared before play; newly created selection rings share that variant
and bypass the background scenery preparation queue.

Queued route completion and cancellation events clear feedback only once navigation is idle.
A fresh keyboard or joystick gesture clears the previous destination immediately; held mouse
steering replaces it on that frame. This prevents an old route's delayed event from erasing a
newer walk marker. The lab regression pauses the world clock, cancels a route through real
movement input, clicks a new destination, then resumes and verifies the new ring survives.

## Reproduce

```sh
npx tsx tools/player-interaction-test.ts
npx tsx tools/player-interaction-test.ts --mobile
npm run build
npx tsx tools/player-interaction-test.ts --world
npx tsx tools/player-interaction-test.ts --world --mobile
npx tsx tools/player-interaction-test.ts --world --cave --mobile
npx tsx tools/walking-stream-test.ts --label interaction-mobile --mbps 20 --cpu 2 --shaders
npx tsx tools/walking-stream-test.ts --desktop --label interaction-desktop --mbps 50 --cpu 1
```

The production combat lab uses actual mouse or touch input and checks target selection,
pointer jitter, health loss, cancellation, movement onset, the drawn player position,
ground conformity and marker availability on the next animation frame. The world mode uses
the release build and a nearby live creature. Browser setup positions the player; tested
interactions use normal controls. Screenshots use the gameplay camera and remain disposable
under `test-results/player-interaction/`.

Focused regressions cover fixed-clock time conservation at different frame rates, pointer
jitter, a creature moving during a touch press, static object occlusion without whole-batch
raycasts, active-map ground projection and prewarmed feedback during pending scenery work.

## September 16, 2026 acceptance

The lab passed with mouse and touch, registering 9 damage through real attacks. The release
world passed on desktop and mobile against a Red Worm, and in Gravelmaw against a cave spider;
each registered 2 damage. Direct movement cancelled combat, the drawn player matched its
current position, and subsequent ground clicks moved the player. Selection and walk markers
were drawable immediately. Their geometry followed the cave floor within 4 mm of its intended
25 mm offset. Surface and cave screenshots were inspected without changing camera limits.

Mobile interaction tests use 844 by 390 at DPR 2 and a 2x CPU slowdown. Measured from the input
event timestamp to the first displaced player frame, movement took 78.4 ms at the surface
and 46.3 ms in the cave. Thirty screen-pick probes averaged 2.80 ms on the surface (5.5 ms maximum)
and 1.02 ms in the cave (2.3 ms maximum). These are individual local Chromium runs on a hardware
GPU, not measurements from the user's physical Chrome/5G phone.

The cold mobile walking check used 20 Mbps, 80 ms latency, CPU slowdown 2x and disabled HTTP
cache. First playable was 17.101 seconds. Walking averaged 50.1 FPS, with a 33.4 ms 95th
percentile frame interval and one 166.6 ms outlier. It loaded 22 additional models while
travelling and finished all asset, view and shader queues within 2.040 seconds after movement
stopped. Browser errors, failed models and slow shader-log queries were zero. The prior
release's same-route sample was 17.827 seconds, 46.4 FPS and a 166.7 ms maximum. This pass
reduces input latency; it does not establish hitch-free play on every device.

Desktop at 50 Mbps, 80 ms latency and no CPU slowdown loaded in 18.361 seconds. Walking
averaged 43.8 FPS, with a 33.4 ms 95th-percentile frame interval and one 183.3 ms outlier.
All queues settled 2.043 seconds after movement stopped, with no failed models or browser
errors. The previous desktop sample was 18.587 seconds, 42.1 FPS and a 183.4 ms maximum.
These cold checks use release entry `index-CbSouT2m.js`; both tested delivery profiles stay
under the 20-second first-load target. They do not establish that target on slower connections.

The full unit suite passed 2,913 tests with one skipped. After the final route-event guard,
TypeScript, 28 focused regressions, both pointer/touch lab checks and the combined gameplay
gate passed. The combined gate took 51.051 seconds and covered real keyboard movement,
melee, spells, bank transfers and building interactions with no browser errors.
The final release build passed all 13 artifact/navigation checks and the desktop/mobile
production interaction tests, including replacement of a route while its old event was queued.
