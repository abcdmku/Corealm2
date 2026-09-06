# Frozen actor TRS blend audit

GLB SHA-256 `fcc4296906bfeec04b9b2c650639a150238d2bccf14b2ec45b427ade1453b2d5`. Three revision 185. No asset or motion helper changed; no GPU used.

The actual Three AnimationMixer crossFadeTo path evaluated 1842 samples spanning three outgoing Idle phases, 25 incoming phases, 11 blend weights and 96 deterministic off-grid samples per incoming clip. Clip local times were held while the one-second fade advanced, so incoming weight and both clip times were controlled independently. This tests ordinary weighted TRS blending, without corrective pose code.

Every unique source vertex from Cat and both eye meshes was evaluated, including all actual foot-mask and fixed-sole vertices. Original source IDs map to exported triangle corners through actor-bake-data.npz; every mapped coordinate was checked against the frozen GLB before sampling. Floor is Y=0.

| Incoming clip | Standalone boundary worst | Interior blend worst |
| --- | --- | --- |
| Walk | 0.000 mm, Idle time 0.000000 s, Walk time 0.609375 s, incoming weight 1.000000, Cat source vertex 5969, exported corner 63625, foot front_L | 139.465 mm, Idle time 0.000000 s, Walk time 0.984375 s, incoming weight 0.700000, Cat source vertex 3457, exported corner 36842, foot null |
| Run | 0.000 mm, Idle time 0.000000 s, Run time 0.194444 s, incoming weight 1.000000, Cat source vertex 5969, exported corner 63625, foot front_L | 156.618 mm, Idle time 0.000000 s, Run time 0.267361 s, incoming weight 0.400000, Cat source vertex 16794, exported corner 62627, foot front_L |

The JSON preserves all sample weights, actual effective action weights, clip times, whole-mesh minima, foot minima, fixed-sole minima and the worst vertex position. Boundary weights 0 and 1 are reported separately. Interior penetration cannot be dismissed by passing standalone clip contacts. This sampled audit does not establish a continuous bound between tested states or prove horizontal stance stability.
