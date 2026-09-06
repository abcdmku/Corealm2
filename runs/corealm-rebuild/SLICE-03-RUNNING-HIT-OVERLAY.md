# Slice 03: running through hit reactions

Creatures continue pursuing while hit. Run/Walk keeps its own uninterrupted clock; a separate, smoothly weighted hit reaction rotates selected head and upper-body bones over it. Leg support chains and their ancestors retain the locomotion pose. Nonlethal damage no longer pauses movement or cancels a committed attack. Death still stops movement and clears the overlay.

Player run remains 5.2 m/s, up from 4.2. Creature pursuit and return remain 4.68 m/s (90% of player run); idle wandering retains its slower walking gait. Live and sampled rendering use the same additive composition. Model and authored motion files are unchanged.

Explicit hierarchy masks preserve reactions for 13 older rigs that the general bone-name mask could not identify. Twelve use native rotations; Scorpion uses a small, labelled pedipalp fallback because its native Hit has no changing rotation on the safe branches.

## Code checks

106 focused tests pass across nine files. TypeScript and Vite production bundling pass. Actual THREE.GLTFLoader inspection covers all 56 public characters declaring Hit: every asset has a nonempty overlay, with no loading errors and unchanged protected world transforms at sampled Walk/Hit phases. The four source-creature overlay track hashes remain identical to the browser-tested versions. Tests also cover continuous base phase, additive live/sample equivalence, death cleanup and unchanged pursuit speed.

## Browser evidence

Production combat-lab checks used real spell damage and public assets on RTX 5080/D3D11, without health, position, pose or time overrides.

| Creature | Movement during hit | Overlay samples | Maximum Run phase error |
| --- | --- | --- | --- |
| Beetle Golem | 5.616 m in 1.2 s, at 4.68 m/s | 76 | 0.00416 s |
| Mossback Sentinel | 2.808 m in 0.6 s, at 4.68 m/s | 37 | 0.00612 s |

Both continued Run afterward, with no recorded runtime errors or drawn-root snaps. Measured player speed was 5.200001 m/s. Root inspected each hit and recovery screenshot: both actors remain readable and coherent, with a stronger visible recoil on Beetle than Forest at the normal camera distance. Still images alone do not establish every frame's foot contact.

Evidence folders under `test-results/moving-hit-overlay/`:

- `beetle_golem-2026-09-05T23-34-18-425Z`
- `mossback_sentinel-2026-09-05T23-34-38-072Z`

Supplemental Forest Viper compatibility check passed in `forest_viper-2026-09-05T23-42-36-163Z`: 30 moving-hit samples, 1.872 m in 0.4 s at 4.68 m/s, Run phase error 0.0013 s, native neck overlay active. Root inspected hit/recovery images; the small snake is too distant to judge recoil strength, so this is semantic compatibility proof rather than close visual acceptance. The preceding failed attempt is preserved: its 12 m spawn let the retreat exceed spell range before a second moving hit. The passing retry changed only spawn distance to 10 m.

Raw reports retain their original pending visual-review fields. This slice supersedes the planted-hit behavior in Slice 02. Acceptance covers the named browser cases; it does not certify every roster animation. Other project workstreams remain paused.

Full project build remains blocked by the pre-existing exterior-geology provenance/license validation. That separate release gate is outside this slice.
