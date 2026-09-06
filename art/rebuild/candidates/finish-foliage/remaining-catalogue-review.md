# Remaining public foliage review

Worker disposition: retain all 11 current public models. Root owns final acceptance. This review covers the models individually; six accepted living trees did not supply evidence for these plants.

Ran `node art/rebuild/candidates/finish-foliage/review.mjs --public --remaining` against production on port 4175. The browser used NVIDIA GeForce RTX 5080, ANGLE Direct3D11. All 44 captures completed within the 55-second budget, with no page errors or staged asset interceptions. The browser closed and the GPU slot was released. Every shot waited for its exact gallery selection and checked that the corresponding entity was drawn without preceding scatter residue. Public file hashes matched the measured catalogue before launch.

Evidence: `test-results/foliage-catalogue/inventory.json` contains all full names, paths, SHA-256 values, material names, native dimensions and triangle counts. `report.json` binds each screenshot to its exact source hash and drawn state. Inspected all eleven original `-detail.png` images at full size; inspected all 33 front, rear and play views in contact sheets `contact-0.png`, `contact-3.png`, `contact-6.png` and `contact-9.png` (columns front/rear/play, catalogue order). Original captures remain available beside the sheets. The report deliberately leaves `visualAccepted: false` for root acceptance.

| Model | Triangles | Disposition and observed limits |
| --- | ---: | --- |
| Deadwood 1 / `corealm_deadwood_1` | 7,135 | Keep. Broad grounded root flare, continuous bark and asymmetric bare branches read from both sides. Broken crown and branch ends are pointed stylized splinters; no exposed gap or missing reverse surface observed. |
| Deadwood 2 / `corealm_deadwood_2` | 4,716 | Keep. Narrower upright trunk and more restrained branch spread provide a distinct silhouette. Retains the same pointed break convention. Full trunk remains readable at play distance. |
| Oak stump / `corealm_stump_oak` | 2,100 | Keep. Broad oak base, root flare and contrasting cut top communicate depletion clearly from both sides and at play distance. Rings are coarse polygon bands; bark stretches across the flare at extreme close range. |
| Pine stump / `corealm_stump_pine` | 1,078 | Keep. Smaller footprint and narrower cut top distinguish it from oak. Ground contact and reverse side remain intact. Shares polygonal rings and visible close-view bark stretching. |
| Fern 1 / `corealm_fern_1` | 20,968 | Keep. Low spreading arching fronds form a broad layered footprint with visible stems. Pinnae are broad and stylized rather than finely divided botanical fern leaflets. Reverse leaves remain present; silhouette reads at play distance. |
| Fern 2 / `corealm_fern_2` | 10,976 | Keep. Taller compact fronds and exposed central stems distinguish it from Fern 1. Broad repeated pinnae are intentionally stylized; no reverse-face disappearance observed. |
| Grass 1 / `corealm_grass_1` | 72 | Keep as sparse ground-cover blades. Thin angular blades remain present on both sides, with strong front/back lighting contrast. Low contrast and tiny projected area at 16 m limit standalone visibility; this is not a dense tussock. |
| Grass 2 / `corealm_grass_2` | 72 | Keep as taller wider ground-cover blades. The extended bent tip changes the silhouette. Same sparse geometry and low contrast at 16 m as Grass 1; no claim of detailed close botanical modeling. |
| Shrub 1 / `corealm_shrub_1` | 17,129 | Keep. Irregular taller crown, branching stems and pointed oval leaves remain visible from both sides. Dense repeated leaves are a stylized generic broadleaf shrub, not an identified species. |
| Shrub 2 / `corealm_shrub_2` | 16,933 | Keep. Shorter rounded crown and separated basal stems contrast with Shrub 1. Reverse leaves and crown volume remain intact. Dense repeated oval leaves share the same botanical limitation. |
| Flower 1 / `corealm_flower_1` | 1,500 | Keep. Cream petals, yellow centers, thin stems and basal pointed leaves read as a small flower cluster. Petal outlines are angular and simplified, but blooms remain visible from both sides and supply a small bright accent at play distance. |

No public regeneration or runtime change was made for this review. These images prove isolated production appearance at the recorded viewpoints; they do not by themselves prove dense world placement, every lighting condition, or animation. Existing world scatter evidence and the separate promoted-tree harvest/return checks cover their own scopes.
