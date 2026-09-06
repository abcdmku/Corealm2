# Fox gameplay contact draft

Latest complete review candidate: **Fox.gameplay-contact-draft.glb** with **gameplay-contact-draft-catalogue.json**. It contains eight distinct clips: Survey, Walk, Run, Attack, Hit, HitLeft, HitRight, Death. The original source, frozen geometry, queued reach candidate and previous prototypes remain unchanged. No hardware acceptance is claimed.

## Authored roles

| Role | Duration | Authored behavior | Important event |
|---|---:|---|---|
| Attack | 1.05 s | Anticipation crouch, short pounce, downward head strike, landing and braced recovery | Strike at 0.46 s |
| Hit | 0.72 s | Rearward recoil with four planted paws | Peak at 0.13 s |
| HitLeft | 0.72 s | Rightward displacement and yaw away from a left-side impact; counter-tail and brace | Peak at 0.13 s |
| HitRight | 0.72 s | Leftward displacement and yaw away from a right-side impact; counter-tail and brace | Peak at 0.13 s |
| Death | 1.40 s | Collapse, folded limbs, side roll, head/torso contact and motionless rest | Settled from 0.95 s |

These are new animations authored on the licensed original rig. The attack does not animate a jaw and is not presented as an animated bite. All clip channel-data hashes are distinct; none is an alias. Mesh attributes, indices, skin weights, inverse binds and node transforms match the input. Survey, Walk and Run channel hashes are preserved from the contact-corrected input.

All five new clips pass finite and whole-mesh quarter-key contact checks. Worst burial is **0.0145 mm** in Attack. Hit variants return to their starting pose within numerical noise. Death holds its final 0.45 seconds still; maximum transform drift is 3.6e-15. Final bounds are about **0.709 x 0.244 x 1.529 m**. Head support touches the floor; torso support is within **0.206 mm**, pelvis within **0.559 mm**. This avoids a corpse balanced on its head while the trunk floats. Root hardware review still needs to judge the complete silhouette and deformation.

## Revised contact motion

The prior 0.55 s reach prototype has a real brief landing-velocity discontinuity. It remains frozen for comparison. The latest draft instead inherits `Fox.contact-dense.glb`: a new **0.4 s Run** at explicit authored **1.8 m/s**, and Walk at **0.58 m/s** with its original 0.708333313 s duration. Quintic swing transfer, velocity-matched takeoff/landing retraction and C2 vertical lift remove the discontinuity. The solver constrains the physical 0.5 mm bind sole band rather than an 18 mm band containing non-contact upper-paw vertices. Run is baked at 3840 Hz to keep skinned interpolation inside the existing physical velocity limit; Walk uses 240 Hz.

The same actual mesh vertex must lie at or below floor+0.5 mm in both adjacent samples; no stance-label filter is used. Maximum ground residual is **4.346 mm/s Walk / 10.335 mm/s Run**, below the existing 12 mm/s criterion. Whole-mesh burial is **0.0215 mm Walk / 0.000898 mm Run**. Maximum reach-driven pelvis lowering is **8.6 mm Walk / 28.8 mm Run**. Native Survey remains unchanged and retains its earlier approximately 1.32 mm penetration; that idle issue is not claimed fixed here.

The contact input is 2,422,580 bytes; the eight-clip draft is **2,895,828 bytes**. This is an intentionally dense CPU-authored review candidate. Runtime memory/loading and visual cadence still need root acceptance.

Source code gives a minimum authored Fox drawn stride scale of **0.855**: species scale1, tier1 silhouette0.9 and minimum enemy build0.95; regional rank multipliers are at least1 and no Z-axis override is authored. At unchanged gameplay run speed1.8, the 0.4 s clip requires playback1.1696 and cadence2.924 Hz, below the unchanged3 Hz cap. Runtime state must confirm that path. No gameplay speed, renderer or cap was changed.

Evidence: `gameplay-contact-draft-review.json`, `contact-dense-review.json`, `contact-dense-velocity-review.json`. Reproduce the role draft with `node art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/gameplay-contact-actions.mjs`. Reproduce its gait input with `motion-contact-dense.mjs --paw`, followed by `physical-contact-dense-velocity.mjs`.
