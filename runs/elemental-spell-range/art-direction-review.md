# Glowing spell motion

2026-09-09. This direction follows the owner's rejection of the repeated rune circles and large central objects in `5caec8a`. The broad Skybreaker tornado is explicitly retained. All attacks still use the production renderer, combat clock and normal gameplay camera in the compact lab.

## Current composition

The inscription meshes have been removed. The main moving shape of a projectile is now its magical wake, with tapered luminous strokes, colored bloom and small particles peeling off its path. Water and stone cores are secondary details inside that wake. Large attacks spread their energy through separate contacts and fronts, leaving the target field visible between them.

| Spell | Current treatment |
| --- | --- |
| Breeze Puff | Small blue pressure streak with a pale rippling leading edge. |
| Air Needle | Concentrated light dart and two short pressure swooshes on contact. |
| Razor Crescent | Three differently banked cuts with dark blue pressure beneath narrow silver lips and fine wakes. |
| Vacuum Coil | Open low spirals and inward particles, followed by a pressure rupture. |
| Thunder Lance | A continuous concentrated wake through a corkscrew of pressure. |
| Skybreaker | Loose elevated curls grow into a descending neck and an 11.4 m base. The continuous vortex unravels and debris scatters in varied directions, falls and rests on the ground. |
| Water Bead | Tiny liquid detail inside a compact blue streak. |
| Waterjet | Two cobalt wakes with turquoise spray and thin liquid cores. |
| Tidal Fan | Five varied blue flight paths and asymmetric spray contacts. |
| Geyser Chain | Curling branching streams with spray travelling through their paths, thin liquid threads and falling droplets. |
| Undertow | Low inward blue wakes with open ground between the currents, then a collapsing eye, low incomplete water bands and falling spray. No ending arcs or geyser. |
| Deluge | One connected, uneven surf front surrounds the area and accelerates inward. Its crest spills at different times. The collision throws torn, bending water sheets upward, followed by falling droplets and a draining pool. |
| Pebble Toss | A mineral chip inside a short jade streak. |
| Flint Shot | A bright jade wake around a small core, retaining its 72-piece fracture. |
| Faultline | A running mineral seam over short ground ridges. |
| Basalt Jaw | Crossing light rakes with low opposing stone underneath. |
| Siege Boulder | A braided jade comet with a small core and retained 180-piece fracture. |
| Mountainfall | Eight differently assembled slabs emerge at full size, topple and skid inward with accelerating motion, then break into 144 tumbling pieces. Fine chips carry the later breakup; dust rolls through the gaps. No shrinking upright pillars or radial magic spokes. |
| Kindle | One compact gold-red streak and tapered ember flame. |
| Ember Dart | A gold-hot comet with red shoulders, a curved wake and two curling burning contacts. |
| Furnace Whip | A compact hooked flame lash travelling through six contacts, with torn flame folds and fine sparks. It is not tethered to the staff. |
| Cinder Mine | Inward embers followed by separated hooked flame tongues, red embers and gold-hot tips around an open front. |
| Kiln Rupture | Seven staggered ground vents with unequal hot tongues, dense rising embers and brief dark smoke. Replaces Phoenix Pass; its saved ID remains `phoenix-pass`. |
| Sunfall | A growing sun with torn corona trails descends into a brief hot flash and fast radial flame jets. Tall fire rolls outward; ballistic embers and dark ash linger from the same impact. No second damage wave. |

## Construction and review

The existing curved-body renderer has an explicit magical material mode. It uses a six-sided tapered sweep with 24 longitudinal segments, 288 triangles per curve, and the existing original flow mask for moving erosion and colored emission. Focus meshes use 80 triangles. Particle detail remains instanced. The larger formations lost substantial opaque geometry, but transparent glow still has a rendering cost.

Air contrast comes from darker pressure beneath the silver edge, retaining scene distortion. Liquid highlights advect with the flow and fine spray follows the same curved paths. Fire temperatures separate the red shoulders, gold tongues and narrow incandescent centers; reduced point-light intensity keeps the ground from becoming an orange wash. Earth retains shaded low ridges and connected fractures, with a smaller Siege core inside the luminous head.

Direct shots now meet the target at 75% of its rendered height; area effects remain grounded. Undertow retains its final damage but drains instead of erupting. Kiln Rupture uses seven staggered vents and Sunfall one 110-damage strike. The four starters at their lowest strength remain below 500 particles and eight principal bodies. Rune geometry is absent; regression coverage also bounds the flying mineral cores and requires their active magical wake. Actual readability is judged from live browser captures, not these counts. The latest checks and limitations are in [verification](./verification.md).

The earlier Knight Online storyboard study remains reference context. This pass is driven by the owner's specific correction, rather than an assertion that the previous rune treatment matched that game. No reference-game assets were shipped.

## Basic tiers and casting

The existing sixteen spellbook entries now share Breeze Puff, Water Bead, Pebble Toss and Kindle production recipes. Lash, Bolt, Burst and Surge scale their bodies by 1.0, 1.22, 1.48 and 1.8, and particle density by 1.0, 1.6, 2.6 and 4.2. Particle size stays small. Existing fuel, level, damage and cadence rules remain. Spellbook descriptions now describe single-target charms instead of the retired ice and area graphics.

Staff preparation uses socket glow and loose energy gathered from the ground, or surrounding air for wind. Advanced spells are manual: the lab action bar supports buttons, keys 1-5, bottom/side docking and saved free positioning. Selecting a spell never fires it; only basic spells can repeat.

## Finale timing and impact

The owner requested more impact and energy after the first scale pass. The initial long-finale pass used 6.2-7.2 second casts. The later timing revision below shortens preparation while preserving aftermath motion. Each has a separate build, fast impact, sustained effect and aftermath. Combat timings and the manual action-bar lock share `content/elementalFinales.ts`. Nominal pulse damage is unchanged. Deluge now contacts shrinking rings and pushes inward; Mountainfall pulls inward on collapse. Sunfall still resolves exactly one strike.

Tornado grains retain their positions through release, then take independently varied ballistic directions and speeds. Each stops moving when it lands. The ground pattern includes interior landings and distant fragments, rather than a circular perimeter. Grain opacity holds through landing before fading.


## Inward motion and darker fire

Skybreaker no longer draws expanding contact shells, ripple rings or radial burst crescents. Damage resolves inside its continuous wind. Deluge begins at the perimeter, pulls inward over three sets of contacts, then throws its compressed water upward. Mountainfall's rock positions and fracture sources both follow the inward collapse.

Fire now renders shaded crimson bodies in the scene pass and sends only hot moving seams to HDR glow. Reduced local light prevents an orange wash across the ground. Rolling smoke uses bounded, spatially sampled volumes with twelve triangles per proxy. Kindle leaves a small soot wisp, Ember Dart carries smoke behind its comet, Furnace Whip sheds soot along its moving hook, Cinder Mine throws rolling dark billows, Kiln Rupture raises separate soot columns and Sunfall has a dark wake and lingering smoke around its fire. The shared basic renderer carries this treatment through all four strengths. Final screenshot review reduced smoke optical density and lifted the basic impact wisps above the flame, eroded the solid surface edges, and replaced Sunfall's enclosed impact shell with a brief central flame plume.


## Acceleration and broken formations

The owner requested stronger dynamics after rejecting regular, repeated motion. Deluge now uses a connected 2,880-triangle surf sheet with varying crest height, curl and timing. A second sheet opens into a torn splash. Water accelerates into the collision instead of easing to a stop. Surface state is measured from the deformed vertices.

Mountainfall keeps the slab scale fixed during emergence and collapse. Each slab has different pieces, footprint, tilt, sliding path and acceleration. Partitioned rock chunks rotate after world scaling so their shape stays rigid. Ground response moves the whole chunk rather than flattening its vertices. Secondary crumbling reduces large chunks while fine chips carry the aftermath.

Sunfall's radial lashes and repeated tall pillars are removed. One impact drives overlapping, uneven volumes of burning gas outward quickly; buoyancy, lateral drift and different lifetimes shape the slower aftermath. The incoming sun uses rolling volume density. Kiln Rupture alternates broad low eruptions, leaning vents and split tongues. Geyser Chain varies fountain direction, spread, height and stream count. Smaller contact flashes vary between spray, one swept curl and a split impact instead of always drawing the same set of arcs.


## Material separation and fast contact

Deluge borrows Undertow's open currents. The opaque circular pool is removed. Its curling surface uses teal depth, flowing foam, refracted terrain and eroded gaps, followed by an upward sheet that tears into spray. Several partial currents sit at different offsets and radii; the ground stays visible between them.

Fire uses a new dedicated grayscale flame membrane texture instead of sharing water's turbulence mask. The shader carries upward flow, deep red body, fine gold edges and separate HDR emission onto curved surfaces. Lower, darker gas volumes support the brighter flame folds. Ember Dart sheds two unequal contact flames; Furnace Whip carries a broader textured hook; Cinder Mine opens into four unequal low combustion fronts; Kiln Rupture's vents reach their height quickly; Sunfall retains one impact.

`content/elementalTiming.ts` maps authored art beats to the live damage clock. Every area spell begins damage within 1.1 seconds. Finale first contacts are 1.00 seconds for Skybreaker, 0.80 for Deluge, 0.72 for Mountainfall and 1.10 for Sunfall. Full durations including aftermath are 4.95, 4.52, 3.87 and 4.30 seconds. The map preserves normal time progression after the final hit, so falling fragments and cooling flames are not sped through. Basic auto-cast cadence remains unchanged.

Boulder fragment landing now uses terrain height instead of the airborne contact plane. Fine fragments rotate around all three axes. Projectile particle wakes use the shot direction as their basis so casting east or diagonally does not leave particles in the fixed north-lane plane.

The alternate gameplay view exposed an earth shadow defect. Fracture positions now feed both projection and world-space shadow coordinates, and packed shadow coverage fades with each rock surface. The travelling fault ridge and collapsing outcrops have separate shader program keys so their different deformations cannot share a compiled program.

## Gathering time, water body and mineral magic

The owner asked for slightly longer water and earth implosions after the fast-contact pass. Deluge now reaches its final inward collision at 1.55 seconds, up from 1.12. Mountainfall collapses at 1.91 seconds, up from 1.37. Their full durations are 4.95 and 4.41 seconds. Preparation is longer, while the last inward rush and aftermath retain their existing character. Air, fire and basic cadence are unchanged.

Deluge's wave belly has denser coverage and more teal absorption, with erosion concentrated at the breaking lip. The curl is wider. The upward splash keeps a substantial lower sheet and tears toward its tips. No ground pool was restored.

Mountainfall has five narrower stone anchors and 64 fracture chunks, down from eight formations and 144 chunks. Fragments crumble to small pieces faster after release. Seven differently bent jade currents gather between the anchors, with light at each actual damage contact and four unequal mineral folds rising through the collision. Fine chips are less frequent, and luminous grains are brighter. Smaller earth bursts also replace half their solid chips with mineral motes. Terrain landings and fading fragment shadows remain.

Fire retains the same color and heat palette. Each surface now has a stable but different texture scale, shear, offset, upward speed and flutter. A second texture lookup warps the flame mask at a different scale. Its bright ridges are sampled directly rather than averaged into gray. The same variation applies to curved projectiles, flame sheets and burning gas volumes. No new image asset was generated for this revision.

## Fire texture repetition, folded splash and a new whip

The next review still found repeated fire motifs. The sampler now blends three independently cropped texture regions on a moving triangular grid instead of mirroring the whole image. The regions use different orientations, scales and offsets, with continuous noise bending the flow. This changes variation within each body as well as between bodies. The existing flame image is retained. Texture sampling increases from two reads to three per sample; no new image asset is added.

Fire plumes now use open, folded geometry with an unequal crown and eroded edges. Sunfall combines three low fronts, five differently proportioned tongues and rolling gas, with one gas pocket left without a matching sheet. Brighter edges retain the orange heat against red bodies and dark smoke. The changes keep one impact and the existing timing.

Furnace Whip is rebuilt as one 576-triangle ribbon following the tip's recent path. It unfurls into the first target, sweeps through the six existing contacts, then recoils and breaks into cinders. Its old hooked tube and repeated contact plumes are removed. A folded cross-section and tapered edges give the ribbon width and depth without additional skeleton animation.

Deluge's upward blast is now eight separate water lobes, still totaling 2,880 triangles. The masses have different roots, heights, widths, launch delays and lateral bends. Their crests roll outward and back down, with taller spray above lower broad splashes. Sheet height is roughly seven metres rather than the former tall cone; particle spray carries the upper reach. Emission begins at each moving crest and follows ballistic motion. The heavy teal body, inward surf, damage and accepted gathering time remain. The sheets dissolve before settling flat on the ground, while droplets continue to fall.

## Continuous fire after the repeated-pattern review

The owner still saw repetition in the fire. Sunfall's array of separate flame fronts, tongues and gas pockets is removed. One three-dimensional combustion field now drives the explosion. Its spatial fuel moves outward at impact, then rises through warped turbulence. Density and temperature vary within the volume, producing uneven flame folds, red cooling and dark soot. The former repeated corona curves are one torn incoming wake. Ember scattering no longer uses the three-lobed radial function.

This field uses hardware-filtered seeded noise, not projected flame images. Optical thickness scales with the ray's physical length; independent sample jitter removes regular integration bands. Smoke density falls away before its proxy boundary. The main blast uses one twelve-triangle proxy and a shared 256 KiB noise volume. Existing particles carry the sparks, and damage remains one contact.

Reviewed the live Sunfall sequence from two normal gameplay views, plus the six-fire overview, Cinder Mine and Kiln Rupture contacts, basic fire flight and same-frame glow comparison. The early volume candidate washed out its folds, so the accepted material reserves its brightest emission for hot regions and cools the rest into soot. Current browser and performance results are recorded in [verification](./verification.md). Water, earth and air were unchanged in this revision.

## Water spray, central collision and fire density

The owner rejected the fuzzy glow on Deluge's droplets, its central splash, and the density of Sunfall's explosion. Deluge now gives foam and rain their own non-emissive particle batch. Smooth normals and small specular highlights replace additive glow; the droplets remain small and sharply bounded. The eight-triangle meshes retain the low geometry cost. Fixed launch positions, velocities and variation are cached at setup, so the detailed spray does not recalculate its launch geometry every frame.

Four lower water fans spread from the collision while four rounded streams bend upward and outward. This replaces the tall hanging arches and subsequent flat-blade candidate. The body is lower, roughly five to six metres, with spray carrying its upper reach. Clearer liquid covers the lower body, and foam and erosion gather near the breaking ends. The 2,880-triangle budget, inward waves, damage and cast timing stay unchanged.

Sunfall retains its organic combustion field. Its explosion extinction falls from 1.4 to 0.6, and spatially warped clear gaps expose targets and ground between the flames. The incoming sun and smaller fire recipes keep their previous density. Reviews cover both water gameplay views, the lighter fire peak and aftermath, the clear rain, and the live six-spell water/fire casting gates. See [verification](./verification.md) for the current results.

## Deluge's rotating collision

The owner found the smaller splash weak and the enlarged fans blocky, and requested the tornado's approach to organic motion. Deluge now carries clockwise circulation from its inward surf into the collision and released droplets. Compression raises the wave bellies just before contact. Spray launches in a short burst, with some water thrown sideways and some carried upward.

The flat fan shapes are replaced by eight tapered, twisting currents around one turbulent liquid volume. The volume uses spatially advected noise, as the tornado does, but refracts and shades as teal water with pale foam. It rises sharply, broadens and drops rather than holding a tall column. Currents unravel as the volume breaks apart. The liquid writes its sampled depth so foreground targets remain readable. The small droplets still bypass bloom.

The volume adds twelve proxy triangles, a shared 256 KiB noise texture and up to 56 samples per ray. The currents retain the 2,880-triangle budget, with more segments along each curve and fewer across it. Particle storage and cached launch-data size are unchanged. Damage, cast timing, controls and the other elements are unchanged. Current browser, screenshot and performance evidence is recorded in [verification](./verification.md).

## Arcing basic spells

All four elements and all four basic strengths now use a shared rising and descending path. The elemental body, magical wake and particles sample that same path, including Kindle's flame controls. Arc height grows with horizontal shot distance and is capped at 4.5 metres above the direct release-to-impact line. Short shots stay compact. The shot still ends at the existing upper-body aim point on its scheduled contact frame. Tier sizes, particle counts and advanced spells retain their existing behavior.
