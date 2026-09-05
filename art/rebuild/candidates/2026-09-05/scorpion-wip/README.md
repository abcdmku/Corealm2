# Scorpion Run checkpoint

Frozen on the user's checkpoint request. This work is incomplete and must not be promoted. No browser, runtime/public asset, gameplay-speed or rate-cap changes were made in this round. The three frozen frog/crab staged GLBs still match their recorded SHA-256 hashes.

## Files

- Current WIP author: `tools/lib/scorpion-ground-gait.ts`.
- Separate compiler entry: `tools/repair-ground-creature-gaits.ts --asset animal_scorpion`. It writes only `test-results/scorpion-ground-gait/`, not the frozen frog/crab directory.
- `animal_scorpion.glb`, `report.json` and `manifest-updates.json` describe the **first candidate**, which exported successfully but failed physical contact checks. `promotable` is false.
- `scorpion-first-candidate.source.txt` preserves the exact author source that generated that GLB. Its SHA matches the generator record in `report.json`.
- `inspect.ts` and `inspect.json` preserve the original skeleton, physical sole selectors, skin influences and body sampling.
- `checkpoint.json` records exact hashes, paths, failure status and the files to carry into another worktree.

The staging directory is ignored by default. Include these candidate files explicitly in the checkpoint or carry the directory alongside the commit. The ordinary source files alone do not contain the failed candidate GLB or its exact earlier author source.

## Current source versus staged candidate

The first candidate authors eight leg chains at **0.31 m/s**, retaining the original **0.6333333253860474 s** Run cadence. Each chain is Hip→Knee1→Knee2→Ankle→Ball→Toe. Actual lowest mesh vertices blend Knee1, Knee2, Ankle and Ball; the unweighted Toe nodes alone are not valid physical contact evidence.

That candidate has zero full-mesh penetration and zero positional loop discontinuity over two cycles at 3,840 intervals per cycle. Primary pad slip is at most 0.001534 m/s. It still fails:

- Left front and both rear near-floor sole speed checks. The worst stance sole error is about 0.01357 m/s, above the 0.012 m/s gate.
- Both rear all-phase contact-plane checks. Heel vertices 617 and 1256 touch during early swing and move at up to **0.092758 m/s**. Their phase is approximately 0.98242 and 0.48242 respectively.

The latest source adds an experimental rotation-only fit of the complete sole patches and reverses the rear lift-off pitch. Its last build stopped **before export** because the correction reached **0.699107775 radians**, above the **0.65-radian anatomical guard**. It did not replace the first candidate files. Keep that guard; this is an unresolved pose/constraint problem, not a reason to loosen acceptance or change speed caps.

The nullable channel-path TypeScript error was fixed after that attempted build. Scoped strict TypeScript passes on the current source. No new actual-skinning test file was completed before the stop request; the first candidate's full serialized skin audit remains in `report.json`. The existing four frog/crab repair tests were not modified in this round.

## Resume and reproduce

Current WIP command, expected to hit the anatomical guard until the solver is repaired:

```powershell
npx tsx tools/repair-ground-creature-gaits.ts --asset animal_scorpion
```

To reproduce the first candidate in an isolated worktree, restore `scorpion-first-candidate.source.txt` as `tools/lib/scorpion-ground-gait.ts`, then run that same command. The snapshot deliberately retains the exact historical source, including its later-fixed nullable-path type warning; `tsx` produced the recorded candidate from it. Do not overwrite the current WIP in the checkpoint worktree.

Original source input is `game/public/assets/models/animal/animal_scorpion.glb`, SHA-256 `69997972b3cd201feb1e20dc123fa0de64981b384be50de94b192446b42bc704`, 517,424 bytes. The compiler rejects a different source hash rather than reapplying the repair to a promoted model. The candidate retains all original BIN bytes, geometry, materials, rest hierarchy, skinning and seven other animation clips, including Walk. Original groundY remains -0.002 m.

The next repair should address the actual heel/sole constraints and plausible ankle motion, then rerun the dense exported audit. Root owns subsequent visual, movement, turn and blend acceptance. Nothing in this checkpoint certifies those checks.
