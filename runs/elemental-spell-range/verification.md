# Medieval fantasy spell verification

2026-09-09. The prior 24-spell implementation was committed as `ba5aefc` before this art pass. All 24 attacks now have an invocation and enchanted focus. Advanced spells add composed seals, gates or bindings with different school symbols and three geometric glyph variants per spell. The four starters retain compact focus and contact light. [The art review](./art-direction-review.md) describes every spell and the reference interpretation.

The production Marchhide robe and wooden staff are equipped through the transient feature-lab state. The casting light follows the weapon's authored focus. Exported merged staff meshes lack the procedural socket metadata, so `CharacterRig` restores it from the equipment system's existing socket table. A regression test exercises this metadata-free load, animated hand transforms and weapon removal.

Elemental matter remains spatial: refracting silver-blue wind, flowing saturated blue water, shaded stone with jade mineral energy, and organic red-gold flame. The wide tornado, connected boulder fractures, asymmetrical mountain, continuous flood and phoenix retain their existing choreography. Damage and impact timing are unchanged. No final-world integration was performed.

## Completed checks

- `npm run typecheck` and `npm run build` passed after the final socket correction. Existing mixed dynamic-import and bundle-size warnings remain.
- `npx vitest run tests/elemental-attacks.test.ts tests/spell-vfx.test.ts tests/spells.test.ts tests/character-rig-layer-recovery.test.ts`: **39 tests passed**. This includes all 24 spells using a supplied animated focus, cleanup, damage bounds, distinct attack patterns, single-hit starters, spatial geometry, finite pools and equipment recovery.
- All four Chromium elemental shards passed after the final art changes: **24 pointer casts**, health before and after, delayed impacts, reset, next, repeat, slow motion, HDR/refraction activity and cleanup. No console/shader errors or pool overflow were reported.
- Live motion capture passed for **all 24 spells** at charge, travel, contact, peak, final impact and fade. Flint Shot and Siege Boulder also capture the intact body and its breakup. All phase galleries and the four element overview sheets were visually inspected.
- The final staff socket correction was then checked with the rig regression and a fresh Air Needle motion capture. Its full-resolution charge image shows the light at the staff head. The four shard performance measurements below precede that attachment-only correction; the shared focus path is covered for all 24 spells by the unit test.
- Captures use the normal player-follow target and gameplay pitch/zoom limits. Tall spells can extend above the frame. The camera target was never lifted or detached to fit an effect.
- Final same-frame HDR comparisons passed for Cinder Mine and Vacuum Coil, including idle equivalence, viewport resize and cleanup. Their images were inspected for readable silhouettes and localized bloom.
- Final same-frame refraction comparisons passed for Vacuum Coil and Geyser Chain. Both use one shared scene-color copy, leave the tested foreground outside the effects unchanged, preserve the camera, and pass idle, resize and cleanup checks. The liquid image was inspected.

## Renderer comparisons

| Comparison | Changed pixels | Halo pixels | Saturated changed pixels |
| --- | ---: | ---: | ---: |
| Cinder Mine HDR | 73,308 | 30,182 | 63,494 |
| Vacuum Coil HDR | 126,645 | 92,784 | 16,515 |

The saturation count detects a saturated channel, not necessarily a white pixel. These comparisons establish that the isolated glow pass contributes to the live image; aesthetic quality was also reviewed visually.

| Refraction comparison | Changed pixels | Changed foreground pixels outside effect | Scene copies |
| --- | ---: | ---: | ---: |
| Vacuum Coil | 17,257 | 0 | 1 |
| Geyser Chain | 37,296 | 0 | 1 |

## Performance

Hardware Chromium/D3D11 at 1440 by 1000. Values are the highest measurements across each element's six spells.

| Element | Peak live particles | Peak principal bodies, including inscriptions/foci | Peak strand segments | Highest VFX CPU update p95 |
| --- | ---: | ---: | ---: | ---: |
| Air | 9,012 | 48 | 0 | 2.2 ms |
| Water | 20,201 | 43 | 430 | 2.9 ms |
| Earth | 15,224 | 57 | 112 | 3.5 ms |
| Fire | 13,025 | 45 | 48 | 2.9 ms |

The highest observed frame-interval p95 was 16.8 ms. Particle, strand, body and liquid-pool overflow were zero. These results apply to this machine and compact lab. Focus meshes use 80 triangles each; inscriptions use bounded instanced stroke geometry, and fine elemental detail remains in material flow and particles. Transparent rendering and the additional glow pass still have a cost.

## Review and reproduction

The preview runs at `http://127.0.0.1:4178/index.html?mode=combat&spells=1`. Select an element and spell, then use **Reset & cast**, **Next**, **Repeat** or **Slow motion**. Commands are in [the feature-lab workflow](../../docs/feature-lab.md#elemental-spell-range).

Disposable screenshots, phase galleries, state and performance reports remain under ignored `test-results/elemental-spells/`. Knight Online storyboard reference frames remain under `test-results/knight-online-study/`; sampled frames informed the art direction but were not used to claim continuous animation timing. No reference assets were shipped. This report records implementation and testing; the owner's review determines whether the new art fits the desired style.