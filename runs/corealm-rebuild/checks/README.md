# Preserved review scripts

These scripts were previously local files under ignored `test-results`. They are retained as source so a new worktree can repeat the corresponding checks. Evidence output remains ignored. Run them from the repository root with `npx tsx runs/corealm-rebuild/checks/<script>.ts`.

Most scripts default to the stable server at port 4175 and take `COREALM_URL` (a few take `--url` or their own variable) to point somewhere else. `stable-server.mjs` reads `PORT`, so a worktree runs its own: `PORT=4189 node runs/corealm-rebuild/checks/stable-server.mjs`. It uses the real Vite game with HMR disabled. Do not start a competing server on a port another worktree already owns.

| Script | Scope / arguments |
| --- | --- |
| `native-prop-review.ts` | Production environment gallery. `--catalog <catalog.json> --out <directory> <asset IDs...>`. Reports captures, not automatic art acceptance. |
| `mine-access-browser.ts` | `--site <site ID> --mode lab` or `world`; supports `--url`, `--out`, `--entity`, `--catalog`. Real navigation/mining checks. |
| `portal-transition-browser.ts` | Real click/walk/curtain entry and return in the portal fixture. Does not prove final-world integration. |
| `portal-recovery-browser.ts` | Curtain failure, cancellation, stale completion and input release. |
| `cave-material-review.ts` | Four production cave views and shell/headroom checks. Human screenshot review still required. |
| `settlement-walk-browser.ts` | `--region <internal region ID>`, optional `--url` and `--trace-movement`. Normal interaction routes. Its 60 s budget allows 20 s for boot, which is not enough when the shipped navmesh artifact's fingerprint is stale and the runtime has to generate the mesh. |
| `shop-respawn-browser.ts` | `--scenario shop` or `respawn`. Quotes/receipts or settlement/death/save lifecycle. |
| `creature-review.ts` | Optional expansion species IDs. Gallery poses are visual diagnostics, not natural combat or translated gait proof. This older diagnostic needs a hard deadline before becoming an acceptance gate. |
| `stage-trees.ts` | Stages current oak/pine generator output under `test-results/tree-refinement/candidate` without public writes. |
| `tree-browser-catalog.mjs` | Builds the browser candidate catalogue from the staged tree catalogue. Run with Node after staging. |

The compact scripts include development casts and were outside the whole-project TypeScript include before this checkpoint. Moving them here preserves that diagnostic status. They use production GameDriver and game modules. They are not a second test framework. Consolidate useful scenarios into the persistent lab workflow when doing the developer-loop package.

Example candidate review:

```powershell
npx tsx runs/corealm-rebuild/checks/native-prop-review.ts --catalog art/rebuild/candidates/2026-09-05/cliffs/catalog.json --out test-results/cliffs-checkpoint corealm_sunder_ledge corealm_scree_slide
```
