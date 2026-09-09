# Elemental spell art review

2026-09-08. Reference review after the owner rejected the latest revisions and asked to stop and reconsider. This records the next visual target, not acceptance of the current renderer. No spell implementation was changed during this review.

## Reference evidence

Reviewed all eight attached stills and sampled preparation, active effects and dissipation in both supplied videos: [ARPG Earth Bending VFX Pack](https://www.youtube.com/watch?v=sxlg3EcyloY) and [Realistic Water and Ice Content Overview](https://www.youtube.com/watch?v=6cyHAmjhLs8). The repeated earth URL is the same video. Knight Online and RuneScape remain the owner's broader RPG references. The more specific supplied visuals and subsequent elemental corrections govern this pass.

| Supplied still | Visual lesson to preserve |
| --- | --- |
| Two long orange-purple and blue projectiles | A continuous bright core, a saturated surrounding body, torn trailing sheets, and tiny sparks following one direction. |
| Floating dark stones beside a blue impact | Clearly shaded solid masses, broad irregular energy wrapping around them, fine fragments, and open space between layers. |
| Single boulder beside a gold impact | One coherent stone before contact. A broad, ragged ground impact with upward debris and a short-lived bright leading edge. |
| Traveling earth rupture | One advancing violent front. The trail records where it passed and fades behind it. Dust and fragments originate at the rupture. |
| Ice effect catalogue | Strong differences in silhouette and scale, with fine detail supporting larger forms. The owner's later ban on ice overrides its literal shapes and materials for water. |
| Magenta eruption with blue ground energy | Irregular overlapping sheets, holes, uneven heights, bright local edges, and darker saturated interiors. |
| Massive earth explosion with two pressure fronts | Wide textured shockwave bands, turbulent dusty interiors, dark stone fragments of varied sizes, and a concentrated central thrust. |
| Long stone ridge | Substantial irregular slabs, varied height and lean, weathered surfaces, and smaller broken material connecting the base to the ground. Keep the stone character; reduce the fiery treatment as requested. |

The video samples reinforce changing, torn contours and a transition from concentrated impact into fragmented wisps and debris. Their appearance does not establish how their geometry, textures or particles were implemented.

## Diagnosis of the current work

The owner's rejection remains authoritative. Tests establish behavior, not art quality. The latest saved Cinder Mine capture reads as diffuse orange fog around the targets. The latest Sunfall capture exposes separate smooth curved strands with weak connection to its main mass. Those captures do not meet the reference target.

The revisions repeatedly emphasized generic geometry, particle totals and shader changes before establishing a convincing silhouette, material and motion. Dense particles need to follow an authored flow and concentrate around meaningful events. Bloom needs localized bright sources with enough surrounding color and darker detail to remain readable.

## Element requirements

- **Air:** background distortion and pressure ripples carry the body. Give the moving edge a subtle, broken white highlight. Tornadoes need a large turbulent funnel, spiraling condensation of uneven density, and a violent touchdown spreading from the contact point. Keep rocks out of the wind effect.
- **Water:** cohesive blue liquid with enough opacity to show thickness. Surface detail must visibly travel along the flow, gather into crests, fold at contact, and break into droplets and foam. No ice, frozen status, crystal shapes or rigid panels.
- **Fire:** connected organic flame with uneven lobes and torn edges. Concentrate bright heat near active cores; retain saturated orange/red body color and darker gaps. Embers trail the flow and burst from contact. Avoid repeated symmetrical loops and uniform orange haze.
- **Earth:** solid mineral mass, weathered surfaces, dark fracture interiors and grounded dust. Flint Shot and Siege Boulder must visibly separate the original stone at contact. Large chunks transition into smaller chips; all debris begins at the breaking body. Mountainfall needs one monumental formation with a distinct movement and silhouette. Earth should not read as another fire attack.

## Execution order and acceptance

Start with **Siege Boulder**, because the owner identified earth as the closest thematic fit. Establish one complete sequence: a single substantial stone in flight, connected fracture at contact, a heavy expanding dust front, and tumbling fragments that settle. Match the reference's distribution of large mass, irregular impact sheets and fine debris, using a mineral palette rather than fire colors.

Review the whole cast at normal speed and in the existing slow-motion mode. Inspect flight, first contact, breakup, peak and fade through the actual gameplay camera. The stone must remain coherent before impact, and its fragments must visibly come from that same body. Keep the impact location and target reactions aligned. Do not spread a new treatment across the other spells until this example passes visual review.

Use triangles where they affect the visible silhouette or shaded solid mass. Use particles, texture detail, animated masks and flow on spatially arranged VFX surfaces for fine motion. The effects must retain depth and parallax in the game; a single painted image is insufficient. Lower triangle count alone is not a performance result: measure frame cost, transparency overdraw and effect cleanup after the appearance works.

Keep five spells per element and distinguish them by silhouette, movement and impact, not just count or scale. Preserve the small particle size the owner liked. Review in the existing gameplay lighting and camera limits; do not move the camera target, zoom beyond gameplay bounds or darken the scene to make weak effects appear stronger.

The existing lab remains the test surface, with Reset & cast, Next, Repeat and Slow motion. This review authorizes no final-world integration and records no new visual acceptance.
