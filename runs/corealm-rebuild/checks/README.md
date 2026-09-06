# Preserved review scripts

These scripts were previously local files under ignored `test-results`. They are retained as source so a new worktree can repeat the corresponding checks. Evidence output remains ignored. Run them from the repository root with `npx tsx runs/corealm-rebuild/checks/<script>.ts`.

Most scripts default to the stable server at port 4175. Start it with `node runs/corealm-rebuild/checks/stable-server.mjs` if no server is already there. It uses the real Vite game with HMR disabled. Do not start a competing server on that port. Parameterize separate ports before running across worktrees.

| Script | Scope / arguments |
| --- | --- |
| `native-prop-review.ts` | Production environment gallery. `--catalog <catalog.json> --out <directory> <asset IDs...>`. Reports captures, not automatic art acceptance. |
| `mine-access-browser.ts` | `--site <site ID> --mode lab` or `world`; supports `--url`, `--out`, `--entity`, `--catalog`. Real navigation/mining checks. |
| `portal-transition-browser.ts` | Real click/walk/curtain entry and return in the portal fixture. Does not prove final-world integration. |
| `portal-recovery-browser.ts` | Curtain failure, cancellation, stale completion and input release. |
| `cave-material-review.ts` | Four production cave views and shell/headroom checks. Human screenshot review still required. |
| `settlement-walk-browser.ts` | `--region <internal region ID>`, optional `--url` and `--trace-movement`. Normal interaction routes. |
| `shop-respawn-browser.ts` | `--scenario shop` or `respawn`. Quotes/receipts or settlement/death/save lifecycle. |
| `creature-review.ts` | Optional expansion species IDs. Gallery poses are visual diagnostics, not natural combat or translated gait proof. This older diagnostic needs a hard deadline before becoming an acceptance gate. |
| `stage-trees.ts` | Stages current oak/pine generator output under `test-results/tree-refinement/candidate` without public writes. |
| `tree-browser-catalog.mjs` | Builds the browser candidate catalogue from the staged tree catalogue. Run with Node after staging. |

## Audio

These take `--url`, then `COREALM_URL`, then their own default of 4186 rather than the 4175 lease, via `audioCheckUrl()` in `audio-capture-support.ts`. `audio-file-review.ts` needs no server. The browser ones need `ffmpeg` and `ffprobe` on PATH; each writes an MP3 listening copy and deletes its webm, because a shared disk does not want eleven worktrees of raw captures.

| Script | Scope / arguments |
| --- | --- |
| `audio-file-review.ts` | Every catalogue variant and loop: duration, peak, active RMS, LUFS, silence, onset, clipping, DC, spectral centroid and bands, per-cue spread, plus concatenated MP3 listening copies with a timestamp sheet. No server, no listening claim. |
| `audio-timing-browser.ts` | `--case chop\|mine\|melee\|spell\|fish`. Hardware D3D11 with real audio. Milliseconds between a semantic marker and the `AudioBufferSource.start` it caused, and between the rig's contact frame and the damage roll. |
| `audio-actions-browser.ts` | `--case travel\|death\|kills\|mix`. Portal ambience handover and reload, death cleanup, node census across five real kills, and a default-volume mixed-gameplay balance take measured with EBU R128. |
| `audio-output-browser.ts` | `--case species\|ambience\|contacts`. DOM-only recording of the production bus mix from real catalogue files. Soundboard stimuli, not gameplay timing. |
| `audio-spatial-browser.ts` | Production graph in an OfflineAudioContext: directional energy and distance attenuation. No renderer. |
| `prepare-audio-candidates.mjs`, `audio-quality-audit.mjs` | Build and measure the unpromoted CC0 chicken and rabbit crops under `../audio-candidates`, and the listening page that goes with them. Both are pending a user decision; neither has replaced anything. |

The compact scripts include development casts and were outside the whole-project TypeScript include before this checkpoint. Moving them here preserves that diagnostic status. They use production GameDriver and game modules. They are not a second test framework. Consolidate useful scenarios into the persistent lab workflow when doing the developer-loop package.

Example candidate review:

```powershell
npx tsx runs/corealm-rebuild/checks/native-prop-review.ts --catalog art/rebuild/candidates/2026-09-05/cliffs/catalog.json --out test-results/cliffs-checkpoint corealm_sunder_ledge corealm_scree_slide
```
