# Source humanoid candidates

`../humanoids.mjs` builds all twelve source variants. `goblin.mjs` keeps the
Quaternius body weights, UVs and source animation channels while applying the
same proportion map to vertices and bind joint positions.

Gnolls use the Animal Pack Deluxe wolf head, cropped by actual head and neck
skin influences and fitted to the humanoid neck. Lizardmen use the shipped
crocodile's head, teeth and scale atlas. Each has a separate jaw joint.
Lizardmen also have seven blended tail joints. These derivatives need visual
acceptance; exporting or finding finite bounds does not establish that.

## Local source cache

Run `python tools/rpg-bestiary/humanoid-source/prepare-source.py --cache <cache>`
with the existing Quaternius archive directory. Pass `--animals <unitypackage>`
if Animal Pack Deluxe is outside the normal Unity entitlement cache.
The helper checks archive hashes before extracting selected assets. It requires
Pillow for TGA conversion. `derived/` is ignored and must remain a local cache.

Body, outfits, axe, sword, shield, staff, crocodile and runtime animation sources
come from the existing `game/public/assets/models/` files. Texture PNGs are
prepared locally for the parent's CPU exporter. The wolf's FBX UV vertical
coordinate is inverted once for glTF; existing glTF UVs remain unchanged.

## Animation contacts

| Attack | Normalized contact | Basis |
| --- | --- | --- |
| Sword and axe swing | 0.30 | Production `Sword_Attack` marker |
| Spear thrust | 0.42 | Production `Punch_Jab` marker; derivative reach needs review |
| Spell | 0.42 | Production `Spell_Simple_Shoot` marker |
| Bow | 0.48 | Authored two-arm IK release on the source skeleton |

Neither entitled Standard animation library contains an archery clip. The bow
motion is explicitly authored rather than relabeling a sword or pistol clip.
The bow and arrow geometry are Quaternius Medieval Weapons source assets.

Floor correction samples the full deformed geometry at 60 Hz and every original
key timestamp. Root lift has a 2 mm interpolation allowance. Independent samples
support the floor check, not foot contact, locomotion speed or gameplay approval.

Per-model metadata records the source packs and hashes. Quaternius inputs are
CC0. Animal Pack Deluxe heads and Blink staves retain their respective Unity
Asset Store licenses; these derivatives must not be labeled wholly CC0.
