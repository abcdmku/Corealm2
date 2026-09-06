# Revision 2 TRS blend audit

File `Lynx.actor-contact-v2.glb`, SHA-256 `a78c815d15292dfd2d1cd0368396a6f13989b8c1f09655e0e0c9c35ef506b008`. Three revision 185. No asset or motion helper changed; no GPU used.

The actual Three AnimationMixer crossFadeTo path evaluated 1842 samples spanning three outgoing Idle phases, 25 incoming phases, 11 blend weights and 96 deterministic off-grid samples per incoming clip. Clip local times were held while the one-second fade advanced, so incoming weight and both clip times were controlled independently. This tests ordinary weighted TRS blending, without corrective pose code.

Every unique source vertex from Cat and both eye meshes was evaluated, including all actual foot-mask and fixed-sole vertices. Original source IDs map to exported triangle corners through actor-bake-data.npz; every mapped coordinate was checked against the loaded GLB before sampling. Floor is Y=0.

| Incoming clip | Standalone boundary worst | Interior blend worst |
| --- | --- | --- |
| Walk | 0.000 mm, Idle time 0.000000 s, Walk time 0.234375 s, incoming weight 1.000000, Cat source vertex 22454, exported corner 116492, foot hind_R | 0.000 mm, Idle time 0.000000 s, Walk time 0.562500 s, incoming weight 0.900000, Cat source vertex 12228, exported corner 130421, foot front_R |
| Run | 0.000 mm, Idle time 0.000000 s, Run time 0.121528 s, incoming weight 1.000000, Cat source vertex 12228, exported corner 130421, foot front_R | 0.000 mm, Idle time 0.000000 s, Run time 0.121528 s, incoming weight 0.900000, Cat source vertex 12228, exported corner 130421, foot front_R |

The JSON preserves all sample weights, actual effective action weights, clip times, whole-mesh minima, foot minima, fixed-sole minima and the worst vertex position. Boundary weights 0 and 1 are reported separately. Interior penetration cannot be dismissed by passing standalone clip contacts. This sampled audit does not establish a continuous bound between tested states or prove horizontal stance stability.
