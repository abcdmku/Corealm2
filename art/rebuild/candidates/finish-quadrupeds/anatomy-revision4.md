# Revision 4 anatomy construction

Source choices are project-authored meshes. The locally installed Animal Pack Deluxe archive contains goat and ibex but no exact bighorn, tapir or lynx source. Its other species are retained for the catalogue audit; a mismatched rig was not substituted for these three.

References consulted:
- Tapir: https://animals.sandiegozoo.org/animals/tapir — small ears, a front-tapered body with broader hindquarters, four front and three hind digits. The profile row coordinates are authored interpretations, not measurements extracted from a photograph.
- Bighorn: https://www.nps.gov/features/colm/virtualtour/section/hard/activity/sheep-101/ and https://sdzsafaripark.org/animals/bighorn-sheep — shoulder, head and curled horn landmarks. The bighorn helper records the specific anatomical proportions used.
- Lynx: https://www.nps.gov/yell/learn/nature/canada-lynx.htm and https://animaldiversity.org/accounts/Lynx_canadensis/ — large paws, hindquarter silhouette and compact ear pinnae with tufts.

Tapir torso and head now use axial section contours with a continuous Hermite interpolation. This directly defines the back, belly and body taper, replacing three overlapping ellipsoidal torso masses. Shoulder height is about 1.04m; broad rump height about 1.07m; total nose-to-rump length about 2.40m. The ear pinna height is 0.11m. The rig hip is 0.70m high, with nearly vertical forelegs. Toe count remains four in front and three behind. Locomotion stride was reduced to fit those shorter limbs; durations and contact event positions remain unchanged.

Bighorn now has authored planar rib, flank, scapular, neck, skull and jaw fields; independent front and rear rig landmarks; higher horns curving behind the jaw; shorter upper-limb muscle envelopes. The profile module and horn module contain the geometry source. Stride was shortened to fit the straighter resting limbs.

Lynx has a larger skull and cheek ruff, shorter outward-angled ears and shorter tufts, fuller paws and continuous limb fields. Foreleg pivots changed; rig and clip identities remain intact.

CPU export and animation checks do not establish visual acceptance. Revision 4 requires hardware production-gallery inspection and root review before any candidate can replace a shipped asset. Runtime AI, turning, transitions, terrain contact and representative final-world encounters remain separate acceptance work.
