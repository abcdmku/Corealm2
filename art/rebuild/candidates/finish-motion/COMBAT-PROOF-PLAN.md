# Remaining combat motion proof

The promoted gait repairs do not establish attack contact, directional recoil, death settlement or residency continuity. The CPU inventory in `tools/creature-motion/motion-metadata-audit.json` verifies all 19 audited public assets have Attack, Hit, HitLeft, HitRight and Death clips with consistent metadata. Public rhinos still use the old attack and recoil; their repaired candidate remains separate.

## Attack contact

Run one pair per browser session, with the root's GPU lease:

```powershell
npx tsx tools/creature-motion/attack-contact-proof.ts --url http://127.0.0.1:4175 --only=animal_bear,animal_coyote --out test-results/attack-1
```

The eight pairs are bear/coyote, cattle/aurochs, goat/ibex, deer/boar, hog/rat, rabbit/rabbit_dark, frog/frog_green and crab/scorpion. Prefix each with `animal_`. Use distinct output folders. Each session permits at most two actors and has a 120-second hard ceiling. Actual response bytes are hashed. Only health changes bracketed by a living actor's continuous exact Attack count; other health changes remain unattributed. Frames and video still require contact review.

## Recoil, death and residency

```powershell
npx tsx tools/creature-motion/combat-residency-proof.ts --url http://127.0.0.1:4175 --only=animal_coyote --stage=all --out test-results/combat-residency-coyote
```

This helper currently supports the twelve legacy mammals, with a singleton recommended and a two-actor maximum. `--stage=residency` and `--stage=combat` allow separate bounded sessions. It uses actual camera distance to cross live/sample boundaries and compares phase across each switch. Ordinary player combat must produce an authored side recoil, Death, then the settled endpoint before natural fade. One observed side does not establish all three hit directions. Ground creatures still require equivalent recoil/death/residency coverage; this legacy fixture helper does not claim it.

## Repaired rhinos

```powershell
npx tsx tools/creature-motion/rhino-browser-proof.ts --url http://127.0.0.1:4175 --only=boss_rhino_earth,boss_rhino_water --out test-results/rhino-earth-water
npx tsx tools/creature-motion/rhino-directional-proof.ts --url http://127.0.0.1:4175 --only=boss_rhino_earth --out test-results/rhino-directional-earth
npx tsx tools/creature-motion/rhino-directional-proof.ts --url http://127.0.0.1:4175 --only=boss_rhino_water --out test-results/rhino-directional-water
```

The fixture marker is `0.33229264631653577`. Air candidate Attack evidence already exists in `test-results/rhino-attack-repaired`; earth/water and directional recoil remain pending. New runs bind actual served bytes. Each command has a 120-second hard ceiling. No helper changes simulation time, AI, pose, damage or health directly. Root owns browser scheduling, screenshot acceptance and promotion.
