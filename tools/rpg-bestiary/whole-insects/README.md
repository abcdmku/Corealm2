# Whole source insects

`buildWholeInsect(id)` in `index.mjs` returns `{object, clips, meta}` for `webweaver_spider` and `marsh_wasp`.

Run `python tools/rpg-bestiary/whole-insects/prepare.py` to extract the two hash-pinned source FBXs from the existing local cache. The source bodies, materials, UVs, and bone hierarchy are retained. The complete source spider has 59 bones; the complete source wasp has 39. Three's FBX importer normalizes the strongest four influences for vertices with more source influences.

These are Quaternius Easy Enemy Pack assets under CC0. Exact archive and member hashes come from `../replacement-inventory/nature.json`. The source pack is https://quaternius.itch.io/animated-easy-enemies.

Idle and Walk retain source idle/walk or flying takes. Run uses source locomotion at 1.65 times the source rate. Attack and Death retain source takes. The source contains no hit animations; Hit, HitLeft, and HitRight use source idle/flying motion with authored whole-body recoil. A separate wrapper lifts sampled geometry above the floor. Wasp flight keeps source altitude. Forward is +Z after a constant source orientation change.

Contact markers are measured from maximum forward reach of the spider's source Head_end or wasp's Sting_end bone. They require production visual review before acceptance. No humanoid bases or detached head parts are used.

Run `node tools/rpg-bestiary/whole-insects/audit.mjs` for CPU geometry, floor, weight, and native-gait checks. This creates `cpu-audit.json`; it does not substitute for the parent's production gallery and motion review.
