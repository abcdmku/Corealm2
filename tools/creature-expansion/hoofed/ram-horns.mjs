import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Growth rings are shallow cuts in a continuous horn. Their spacing drifts along
// the curl, and the smaller marks fade toward the polished terminal section.
function keratinGrain(t, angle) {
  const phase = (t * 43 + .32 * Math.sin(t * 15) + .18 * Math.sin(t * 29)) * Math.PI * 2
    + .11 * Math.sin(angle * 2 + t * 4);
  const fine = Math.max(0, Math.cos(phase)) ** 5;
  const broadPhase = (t * 21 + .17 * Math.sin(t * 15) + .08 * Math.sin(t * 29)) * Math.PI * 2
    + .10 * Math.sin(angle * 2 + t * 4);
  const broad = Math.max(0, Math.cos(broadPhase)) ** 4;
  const fineDepth = (.0040 * broad + .0020 * fine) * (1 - .68 * smooth(.73, 1, t));
  let older = 0;
  for (const [position, width, strength] of [[.17, .008, .0035], [.34, .006, .005], [.53, .007, .003], [.76, .005, .004]]) {
    older += strength * Math.exp(-(((t - position) / width) ** 2));
  }
  return { cut: fineDepth + older, fine };
}

/** Heavy anatomical curl with a smooth keratin surface and subdued growth marks. */
export function ramHorns(s, _p) {
  const rings = 128, sides = 24;
  const rootColor = new THREE.Color(0x938263);
  const shaftColor = new THREE.Color(0xb5a382);
  const tipColor = new THREE.Color(0x88765a);
  for (const side of [-1, 1]) {
    const horn = [
      [side * .12, 1.59, .93, .103, .112],
      [side * .19, 1.68, .91, .138, .146],
    ];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const angle = t * 5.20 - .10;
      const curlRadius = .365 * (1 - .47 * t);
      const x = side * (.20 + .23 * Math.sin(Math.min(1, t * 2.8) * Math.PI / 2));
      const taper = Math.pow(1 - t, .78);
      horn.push([
        x, 1.33 + curlRadius * Math.cos(angle), .83 - curlRadius * Math.sin(angle),
        .135 * taper + .004, .155 * taper + .0045,
      ]);
    }
    s.loft(horn, 'Head', (_point, index) => {
      const t = Math.floor(index / sides) / rings;
      const angle = (index % sides) / sides * Math.PI * 2;
      const grain = keratinGrain(t, angle);
      const color = rootColor.clone().lerp(shaftColor, smooth(.06, .61, t));
      color.lerp(tipColor, smooth(.82, 1, t) * .62);
      // Most growth marks are pigment changes. The geometric cuts stay under a
      // millimetre through most of the shaft instead of inflating each band.
      return color.multiplyScalar(1 - grain.fine * .024 - grain.cut * .7
        + .011 * Math.sin(angle * 5 + t * 3) + .007 * Math.sin(angle * 11 - t * 2));
    }, {
      rings, sides, material: 2,
      detail: (t, angle) => {
        const grain = keratinGrain(t, angle);
        // A rounded triangular section is strongest near the heavy base and
        // becomes rounder through the narrowing outer curl.
        const section = .027 * (1 - smooth(.30, .91, t)) * Math.cos(angle * 3 + .25);
        const longitudinal = .003 * Math.cos(angle * 7 + t * .7);
        return 1 + section + longitudinal - grain.cut;
      },
    });
  }
}
