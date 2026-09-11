import type { LavaRockMass } from '../world/lavaLandforms.js';

/** Older volcanic remnants. Active channels cut these bodies; low benches leave
 * bank access while resistant spurs explain the major turns and confluences. */
export const WILDERNESS_LAVA_LANDFORMS: Readonly<Record<string, readonly LavaRockMass[]>> = {
  'widows-furnace': [
    { id:'widow-source-shoulder', crown:14.2, polygon:[[211,701],[215,708],[228,711],[234,704],[231,695],[225,692],[220,696]] },
    { id:'widow-confluence-spur', crown:14.5, polygon:[[195,667],[202,666],[210,672],[214,682],[208,685],[201,680],[197,679],[194,673]] },
    { id:'widow-southern-wall', crown:13.9, polygon:[[162,651],[174,648],[184,652],[187,659],[181,665],[172,662],[167,666],[160,660]] },
    { id:'widow-receiving-bench', crown:11.2, polygon:[[146,683],[153,680],[159,684],[166,681],[175,687],[174,694],[161,698],[149,692]] },
  ],
  'chainfire-rill': [
    { id:'chainfire-source-ridge', crown:16, polygon:[[-98,710],[-89,704],[-80,706],[-77,714],[-86,724],[-94,731],[-104,728],[-106,720]] },
    { id:'chainfire-join-divider', crown:14.7, polygon:[[-104,740],[-97,735],[-86,737],[-81,742],[-91,748],[-99,749],[-104,746]] },
    { id:'chainfire-western-wall', crown:14, polygon:[[-132,757],[-122,752],[-118,757],[-122,765],[-119,775],[-124,786],[-134,782],[-138,769]] },
    { id:'chainfire-eastern-bench', crown:12.4, polygon:[[-102,770],[-94,772],[-89,780],[-92,791],[-102,796],[-107,787],[-103,779]] },
  ],
  'veilburn-river': [
    { id:'veilburn-source-wall', crown:17.4, polygon:[[108,860],[119,863],[124,875],[118,885],[109,888],[102,881],[105,873],[100,866]] },
    { id:'veilburn-upper-bench', crown:13.6, polygon:[[52,838],[58,830],[64,833],[66,843],[71,850],[67,859],[56,856],[49,849]] },
    { id:'veilburn-confluence-wall', crown:16.1, polygon:[[84,817],[88,824],[99,829],[112,825],[118,818],[112,811],[101,810],[92,814]] },
    { id:'veilburn-lower-spur', crown:14.2, polygon:[[73,766],[79,759],[85,762],[85,770],[89,776],[85,785],[75,788],[70,779]] },
  ],
  'hollow-star-rift': [
    { id:'hollow-source-wall', crown:16.8, polygon:[[-118,903],[-110,908],[-108,920],[-116,930],[-123,927],[-127,918],[-124,911]] },
    { id:'hollow-branch-divide', crown:14.8, polygon:[[-178,885],[-172,891],[-169,902],[-176,909],[-183,904],[-187,895],[-184,889]] },
    { id:'hollow-southern-face', crown:13.2, polygon:[[-203,856],[-189,856],[-179,862],[-182,869],[-193,869],[-199,874],[-210,870],[-213,863]] },
    { id:'hollow-receiving-bench', crown:10.5, polygon:[[-228,881],[-220,886],[-212,888],[-208,896],[-219,901],[-230,895],[-235,888]] },
  ],
};
