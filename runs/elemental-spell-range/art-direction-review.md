# Medieval fantasy spell direction

2026-09-09. The owner requested a checkpoint commit and a rethink of all spells around Knight Online. The checkpoint is `ba5aefc`. This direction supersedes the earlier physical-effects-only review; the previous elemental restrictions still apply.

## Reference and interpretation

Reviewed the supplied Piloto images again and the storyboard sequence from [Knight Online Beginners Chapter #4 Mage](https://www.youtube.com/watch?v=wfps4olHIVo), especially the staff gestures, gold casting flares, ground markings and bright elemental attacks around 180 to 300 and 375 to 435 seconds. The storyboard images are sampled reference frames, not proof of continuous animation timing. Older local `knight-playing-*` captures showed a buffering player and were not used as motion evidence. No Knight Online assets were extracted or shipped.

The implementation interprets that visual language through a robed production mage, a staff-bound focus, an inscription that appears during invocation, concentrated elemental light, and an impact that resolves a deliberate magical sign. Symbols are supporting spell structures. Liquid, wind, stone and flame remain the main moving bodies. The daylight, terrain and gameplay camera are unchanged.

## Spell treatments

| Spell | Magical identity |
| --- | --- |
| Breeze Puff | A small silver-blue focus and one enchanted pressure puff. No full ritual. |
| Air Needle | A wind invocation, concentrated violet-silver dart and a brief upright contact seal. |
| Razor Crescent | Three banked wind blades with different curl signs, orientations and proportions. |
| Vacuum Coil | A rotating floor ward and three hovering binding signs around an open, contracting eye. |
| Thunder Lance | One upright heraldic gate at release; the continuing wind bore breaks varied signs along its lane. |
| Skybreaker | A broad five-point summoning ward anchors the violent 11.4 m tornado base and satellite currents. |
| Water Bead | One small blue focus, liquid bead and brief contact glint. |
| Waterjet | A concentrated liquid lance followed by two differently shaped blue contact inscriptions. |
| Tidal Fan | Five curved liquid trajectories with varied water signs, impact proportions and spray recipes. |
| Geyser Chain | Successive wellspring seals prepare the three liquid columns. |
| Undertow | A turning water ward with three orbiting blue foci, followed by the gathered surge. |
| Deluge | Three unequal gates with different central signs release a continuous flood. Gates fade as the wave arrives. Wave ends taper into side spills. |
| Pebble Toss | A small jade focus enchants one pebble. Its connected fracture remains intact. |
| Flint Shot | A suspended mineral inscription binds the moving stone and opens on impact. |
| Faultline | A procession of ground inscriptions wakes the connected ridge. |
| Basalt Jaw | Two upright binding seals command the unequal stone walls over a broad earth ward. |
| Siege Boulder | Two crossing mineral seals bind one heavy boulder before its 180-piece fracture. |
| Mountainfall | Four raised earth signs surround one monumental formation and its avalanche field. |
| Kindle | One gold focus releases a compact red-gold flame; one contact only. |
| Ember Dart | A concentrated ember heart in the existing organic comet, followed by a fire brand. |
| Furnace Whip | One continuous flame lash stamps differently shaped fire signs along its sweeping contacts. |
| Cinder Mine | A contracting inscription feeds a bright ember heart, then breaks open beneath its blast canopy. |
| Phoenix Pass | A gold summoning gate and selected feather-proportioned contact signs support the continuous bird. |
| Sunfall | A solar ward and turning airborne seal hold a bright descending sun; nine unequal contact flares precede impact. |

## Construction and limits

`ArcaneSpellVfx` is a production renderer driven by the existing combat clock. Its original inscriptions use tapered stroke geometry on shallow curved surfaces, with three geometrically different glyph forms per spell. They stay in world space and never face the camera. Shared instancing, 80-triangle focus meshes, shader reveal and existing small particles supply detail. The animated focus reads the production weapon's authored socket and falls back to the casting hand.

Air retains distortion, silver-blue leading edges and no rocks or smoke. Water remains saturated flowing liquid, foam and droplets, with no ice. Earth keeps shaded connected stone and jade mineral energy. Fire keeps organic red-gold matter. The four starters remain simple. Multi-contact effects retain the twelve authored matter recipes as well as distinct inscription variants and aspect ratios.

Lab proof must cover real pointer casts, unchanged damage behavior, cleanup, finite pools, the production mage kit and normal-camera screenshots. No final-world integration is part of this request. Verification results are recorded separately after the final browser run. The owner's judgement of the artwork remains the final aesthetic judgement.
