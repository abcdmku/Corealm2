# Elemental spell range

Status: Approved scope through the owner's current implementation request and clarification of five spells per element.

Further owner correction during this pass: air still looks plain and lacks variation. Replace the shared travelling sphere and duplicated tornado silhouettes with separate spatial choreography for a pointed dart, three banked wind blades, a low inward spiral eye, one continuous corkscrew air cannon and the broad wedge tornado. Add eroded luminous current edges and fine circulating motes while retaining pressure distortion, no rocks, simple starter spells and normal gameplay camera limits.

2026-09-09 follow-up, approved by the owner's implementation request: preserve the accepted art and refine all 20 existing spells. Author different contact silhouettes, flow directions and breakup patterns for repeated and multi-target hits. Skybreaker's main tornado must have a much wider wedge-shaped base with layered rotating wind and a violent touchdown. Add four simple single-hit starter spells, one per element, for 24 total. Keep the five existing tiers per element and label the additional spell Basic. Retain the same gameplay camera, particle size, liquid-only water, organic fire and connected stone fractures. Acceptance includes all 24 pointer casts, repeated-hit visual review and bounds/cleanup checks.

Latest correction: add a subtle white leading edge to wind and a large, detailed tornado with a violent touchdown. Water must be liquid throughout, less transparent and visibly flowing. Replace Frost Fan with Tidal Fan and remove freezing from water attacks. Flint Shot and Siege Boulder must shatter their actual connected bodies into many pieces at contact. Redesign the repeated earth and fire eruptions as distinct cast-level shapes, including a single huge mountain mass and one continuous phoenix. Preserve five spells per element, normal gameplay camera limits and lab-first proof. Timings and hit areas must describe the new visual shapes accurately.

The preceding revision established small luminous sparks, continuous energy trails, colored bloom, and charge, release, impact and dissipation. Preserve that emission pipeline and five attacks per element. Particle count alone is not a quality measure.

Current visual direction supersedes the earlier sprite pass. The owner rejected large painted cards and requests dense, fully spatial attacks following [ARPG Earth Bending VFX Pack](https://www.youtube.com/watch?v=sxlg3EcyloY), [the second supplied demo](https://www.youtube.com/watch?v=6cyHAmjhLs8), and eight attached stills. Hero attacks must have actual 3D depth, thousands of small independently moving particles, turbulent trails, fragment showers, fractured stone and liquid spray, layered expanding impacts, and brief residue. Do not use painted flames, giant crescent sprites, flat water panels, or thin stretched rock wedges as the body of an attack. Keep the 20 authored patterns and normal gameplay camera. Measure live particle populations and frame cost in the lab. Automated damage checks alone do not accept this revision.

Owner correction: Never use camera angles unavailable in gameplay. This range and its acceptance
captures must use normal player-follow focus, ordinary pitch limits and the interactive 6–11 m
zoom range. Do not detach the camera or use the 34 m authoring zoom to make large spells fit.

Build 20 new attacks, ordered by scale within each element. Each needs a distinct spatial or temporal pattern, a readable charge and impact, a detailed description and a concrete test cue. Use reusable production content, attack resolution and rendering modules. Register them only in the feature lab in this round.

Provide an opt-in combat spell range, reachable from the ordinary lab, with element and spell selectors, one-click reset-and-cast, previous/next, repeat casting, target reset, camera framing and observable health, hit counts, displacement and status. Label test dummies and damage explicitly. This is deterministic attack-design testing, separate from the existing spellbook's fuel and progression rules.

Acceptance requires a production Chromium boot, pointer-driven casts for all 20 spells, before/after target state, delayed impact and reset checks, bounded visuals, typecheck, build, focused behavior tests and inspected representative screenshots. No final-world registration or world-authoring exception is needed.

Use a caster gesture and charge, continuous travel, a distinct contact silhouette, and brief residue. Damage guides are opt-in. The renderer uses instanced 3D motes and fragments, eroding curved surfaces, shaded fractured stone and flowing water bodies. Water has no ice geometry or freezing status. An original grayscale flow texture supplies material detail on spatial surfaces; it is never drawn as a whole attack card. Reference-game assets are not imported.

Visual references: [Knight Online mage fire skills](https://www.youtube.com/watch?v=VXXKPvZGhtc) for caster preparation and concentrated elemental attacks; [Old School RuneScape Ice Barrage](https://oldschool.runescape.wiki/w/Ice_Barrage) for an immediately readable target encasement. These guide shape and timing, not asset reuse or a claim of visual parity.

Review live casts at charge, travel, first contact, peak, final impact and fade. Capture through the actual Slow motion control at 0.35×, recording elapsed simulation time and the normal gameplay camera alongside each frame. The range's training targets should leave spell shapes visible and react to hits.
