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

## Authorized follow-up: medieval fantasy invocation

2026-09-09: the owner requested a progress commit and a rethink of every spell around Knight Online. Commit `ba5aefc` preserves the preceding 24-spell version. Add a production robed mage and staff to the transient lab fixture, animated weapon-socket light, original school-specific inscriptions, spell-specific summoning patterns, concentrated magical cores and richer elemental coloration. Preserve all 24 damage patterns, the four simple starters, liquid-only water, wind distortion without rocks, connected earth fracture, organic fire and gameplay camera limits. Validate every spell in the existing range. No final-world registration is requested.


## Authorized follow-up: glowing motion before elemental matter

The owner rejected the repeated lettered circles and oversized central objects, with the large tornado explicitly retained. Remove the inscription layer. Flying attacks must read primarily as glowing magic, with small elemental cores, textured swooshes and fine particles. Use a few thicker strokes to describe motion, with open space between them. Recompose the large water, earth and fire attacks as distributed bursts and moving fronts. Preserve combat timings, all 24 selectable spells, simple starters and normal gameplay camera limits. This instruction supersedes the inscription and central-mass direction above.


## Authorized refinement: contrast and elemental motion

The owner accepted this as an improvement and requested stronger contrast in air, more interesting flowing water, clearer fire magic, and a smaller refinement of earth. Keep the glyph-free composition and distributed impacts. Deepen the air pressure body beneath a narrow silver leading edge; move dense spray through water currents and break up the surf crests; give fire curling tapered tongues with red shoulders and gold-hot centers. Retain the low-triangle spatial surfaces, small particles and gameplay camera.


## Upper-body targeting and manual area casting

The owner authorized direct contact at 75% of creature height, removal of staff arcs in favour of socket glow with environmental gathering, a draining Undertow finish, complete replacement of Phoenix Pass, one impactful Sunfall strike, further Furnace Whip refinement, and darker dust/debris in large air attacks. Advanced spells use a repositionable manual action bar. The existing sixteen auto-cast spells use four strength variants of each new basic spell, retaining their progression and combat rules. The lab proves these production paths before world integration.

## Authorized elemental finales

The owner requests the rank-five water, earth and fire spells to rival Skybreaker in intensity, with longer animations for all four final spells. Skybreaker must form organically while descending, sustain its circulation, then release debris that visibly falls and settles after the wind fades. Preserve gameplay camera limits, the basic tiers, manual activation and single-impact Sunfall. Longer build, active and aftermath phases share timing with combat and the action-bar lock.

The subsequent correction asks for a sharper burst of energy at every finale's impact. Tornado debris must scatter in varied directions, with interior and distant landings rather than a perfect circle. Use quick pressure fronts, breaking white water, luminous mineral fractures and a single hot solar blast to distinguish the four contacts.


## Authorized implosions and fire contrast

The owner rejected Skybreaker's artificial pulse. Remove its expanding shells and impact rings while retaining continuous wind and irregular falling debris. Deluge must surround its area with waves that converge and collide into a large upward splash. Mountainfall must collapse inward. All fire spells, including the four basic strengths, need richer dark flames, visible hot seams and black smoke. Retain the real gameplay camera, low-triangle surfaces and finite particle pools.


## Authorized motion revision

The owner rejected visible procedural repetition and requested stronger explosive and implosive motion. Deluge must retain the surrounding inward surf and upward splash, with one connected irregular front. Mountainfall must use rigid, individually shaped slabs that accelerate into a toppling collapse and break into their own pieces. Sunfall must retain one impact, with a fast expanding, rolling flame mass instead of radial lashes and matching pillars. Smaller multi-contact effects need different shapes and directions. Preserve existing damage, timing, casting controls, small particle sizes, and gameplay camera limits.


## Faster contact and material refinement, 2026-09-09

User-authorized revision: Deluge should use Undertow's broken flowing currents, with visible ground between streams, instead of an opaque blue circle. All fire spells need a dedicated detailed flame texture, sharper hot edges, richer dark folds and more forceful attack shapes. AOE windups should lead into a sharp hit; compress gathering and contact travel on a shared combat/presentation timeline, retaining falling and cooling motion after contact. Correct earth fragment rotation and ground landing. Keep the existing damage amounts, hit areas, basic tiers, action bars and gameplay camera limits.

## Implosion pacing and elemental balance

The next correction asks for a little more gathering time before the water and earth implosions, more body in the liquid, fewer earth rocks with more visible magic, and less repeated texture in the otherwise accepted fire treatment. Extend only the water/earth finale gathering windows. Keep the sharp collapse and slower aftermath. Give Deluge denser teal wave bodies without restoring the blue pool. Reduce Mountainfall to five stone anchors with fewer fragments and use jade currents and mineral light for its main energy. Vary flame texture scale, shear, phase and flow per surface while retaining its colors and attack shapes.

## Fire repetition, water splash and Furnace Whip

The owner still sees repeated fire patterns and asks to rethink Furnace Whip. Remove mirrored texture pairs and repeated conical flame silhouettes. Preserve the rich red fire, smoke and glow, with varied flowing detail within each body. Furnace Whip should unfurl as one broad ribbon, crack across the existing six contacts, then break into cinders. The owner also rejected Deluge's cone-shaped explosion. Keep the heavier water and accepted timing, but split the upward blast into unequal curling lobes with visible gaps and spray released from their moving crests. Preserve damage, the triangle budgets and gameplay camera limits.

## Continuous organic fire

The owner rejected the remaining repeated fire patterns and requests substantially more organic fire. Replace Sunfall's array of flame sheets and matching smoke pockets with a continuous turbulent combustion volume. Give the fire spatially changing density and temperature, rising motion, tearing boundaries and cooling soot. Remove its repeated corona loops. The other fire recipes should retain their distinct movements while losing repeated surface motifs. Preserve accepted water and earth effects, existing damage, casting controls, particle size and normal gameplay camera limits.

## Clear water spray and a lighter fire blast

The owner rejects fuzzy glow around Deluge's droplets and its central splash, and finds the continuous Sunfall explosion too dense. Render Deluge's spray as small shaded liquid droplets outside the bloom pass. Replace the hanging central arches with broad low fans and rounded, bending upward streams, retaining its inward surf and accepted timing. Reduce Sunfall's optical density and introduce irregular clear gaps while preserving the turbulent fire, sharp single impact and cooling aftermath. Keep the existing damage, controls, low-triangle budgets and gameplay cameras.

## Deluge collision and circulation

The owner finds the reduced water collision weak and its enlarged splash too blocky. Apply the air tornado's continuous spatial turbulence and circulating currents to the implosion. Carry the surrounding water into a twisting inward surge, then release a heavy, irregular collision and directional spray. Replace the flat splash silhouettes with a low-triangle volume and curved flow strips. Preserve clear non-blooming droplets, accepted contact timing, damage, controls and gameplay cameras. Other elements retain their current rendering.

## Basic spell arcs

All sixteen basic spells must arc upward during flight and descend into their existing hit point. The elemental body, luminous wake and trailing particles must follow the same path in the range and normal combat. Scale arc height with shot distance so short shots stay compact. Preserve the four tier sizes and particle densities, upper-body aiming, hit timing, damage and normal gameplay camera.
