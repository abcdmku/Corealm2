# Slice 02: planted hit reactions and faster movement

> Superseded by `SLICE-03-RUNNING-HIT-OVERLAY.md` at the user's request. The speed changes remain; the movement hold described below has been removed. This record preserves the earlier acceptance history.

Player run speed is now5.2m/s, increased from4.2. All creature pursuit and return movement uses4.68m/s, exactly90% of player run. Ordinary idle wandering retains its slower walking gait. Route estimates derive from the same player speed.

A hit now holds both semantic movement and collision separation for the actual reaction duration. The renderer settles the preceding walking interpolation at contact before showing Hit. The reaction and simulation deadline account for tick phase and time scale, so pursuit does not resume underneath an unfinished reaction. Interrupted enemy strikes are cancelled and new strikes wait for recovery, preventing invisible counterattacks. Measured creature gait playback follows actual movement speed without the old cadence ceiling causing ground sliding. Asset stride measurements and model files were not changed.

## Acceptance

- 114 focused tests pass across movement, route pricing, hit recovery, combat commitment, realm isolation and resident animation.
- TypeScript passes. Vite production bundling passes.
- Public-asset Chromium tests on RTX5080/D3D11 used real spell damage during pursuit, without health, pose or position overrides.
- Beetle:78 sampled Hit frames, zero semantic and rendered body drift; measured player5.200001m/s, pursuit4.680000m/s.
- Forest:42 sampled Hit frames, zero semantic and rendered body drift; measured player5.200001m/s, pursuit4.680000m/s.
- Both resumed rendered Run after the reaction. Root inspected the pursuit, hit and recovery screenshots for both creatures.

Evidence folders under `test-results/creature-hit-movement/`:

- `beetle_golem-2026-09-05T23-13-59-248Z`
- `mossback_sentinel-2026-09-05T23-14-24-508Z`

Earlier failing evidence is retained, including the diagnostic that found walking interpolation continuing35–43cm into Hit. Raw browser reports retain their original pending-review field; review decisions are separate.

The shared fix applies to all creature AI; this browser slice covers the two named source creatures, not every authored animation on the roster. Full project `npm run build` remains blocked by existing exterior-geology manifest provenance/license validation. This slice does not resolve that unrelated release gate.

Refresh the open preview to load the changes. Other project workstreams remain paused.
