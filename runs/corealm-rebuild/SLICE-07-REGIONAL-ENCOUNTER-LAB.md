# Slice 07 — Regional encounter lab

Representative regional packs proven through the production `?mode=combat&rpg=1&pack=<id>` fixture
on real hardware Chromium (ANGLE D3D11, 1440x900). Semantic browser state is the evidence;
screenshots are inspected review material. This is lab acceptance of pack behaviour only. It does
not activate the final-world population, which stays gated in `content/regionalPackActivation.ts`.

Acceptance server: `PORT=4183 node runs/corealm-rebuild/checks/stable-server.mjs`.
Helper: `node --import tsx tools/regional-pack-lifecycle-test.ts --url http://127.0.0.1:4183 --pack <id>`.
One run per invocation, serial, ~80 s each, 200 s hard budget.

## What one run proves

In order, against production AI, combat, loot and respawn, on the normal clock (`timeScale === 1`):

1. The fixture is the requested pack; every resident is alive at full health, drawn with the
   pack's asset, named plainly and labelled with a real computed combat level (no `T<n>` tokens).
2. Natural idle/patrol inside the habitat: residents move, bodies never overlap, and no body
   overruns the habitat radius. Setting props sit inside the ring the residents circle.
3. Aggro and pursuit, enemy damage landing at the attack clip's contact marker, ranged and magic
   residents damaging from standoff distance.
4. A masked hit overlay (flinch) on a surviving resident the player strikes.
5. Death, kill XP, the natural coin roll, and — when the natural drop table rolls a pile — the
   real loot interaction with plain item names.
6. Survivors leash, return inside the habitat at full health, and resume the authored ranging
   order (anchor arrivals stay in circuit sequence).
7. Respawn on the normal `ENEMY_RESPAWN_MS` clock at the spawn point at full health.
8. No game, page or console errors.

## Fixture defects fixed this slice

| Defect | Symptom | Fix |
| --- | --- | --- |
| Aggro measured from the closing snapshot only | A provoked passive resident traded blows and disengaged inside the window, so `residentsInitiateOrAnswer` read 0 aggro despite `pursuitSeen` and an observed flinch | Track the peak aggro count across the window; report `residentsAggroAtClose` alongside it |
| Provocation attack left running | `corealm_attack` kept swinging, so a level-1 player killed an 8 HP passive resident before the flinch and kill steps could use it | Poll until the pack answers, then `corealm_stop`; the provoked residents keep fighting on their own |
| Catalogue pin hashed the CRLF checkout | `retained-unhorned15/catalog.json` SHA-256 mismatched on an autocrlf checkout | Hash the LF blob; GLB and texture bytes are still hashed individually by the installer |
| `stable-server.mjs` hardcoded port 4175 | Parallel worktrees could not hold their own acceptance server | `PORT` env override, 4175 remains the default |

## Pack x check matrix

<!-- MATRIX -->

## Per-region results

<!-- REGIONS -->

## Limits

- Lab acceptance only. Nothing here activates the final-world population.
- Screenshots are a compact review of formation, contact, corpse and respawn framing. They make no
  frame-cost claim and no authored-world placement claim.
- The generated-world spatial audit (`tools/regional-pack-world-test.ts` shards) and the dressed
  navigation recheck remain root's Slice 08 work.
- `test-results/` is disposable and gitignored. Regenerate with the commands above.
