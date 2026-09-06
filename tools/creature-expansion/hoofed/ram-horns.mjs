import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Growth rings change the silhouette as well as the pigment. Relief is a
// fraction of section radius and diminishes toward the horn tip.
function keratinGrain(t, angle) {
  const phase = (t * 43 + .32 * Math.sin(t * 15) + .18 * Math.sin(t * 29)) * Math.PI * 2
    + .11 * Math.sin(angle * 2 + t * 4);
  const fine = Math.max(0, Math.cos(phase)) ** 5;
  const broadPhase = (t * 21 + .17 * Math.sin(t * 15) + .08 * Math.sin(t * 29)) * Math.PI * 2
    + .10 * Math.sin(angle * 2 + t * 4);
  const broad = Math.max(0, Math.cos(broadPhase)) ** 4;
  const fineDepth = (.073 * broad + .020 * fine) * (1 - .88 * smooth(.68, 1, t));
  let older = 0;
  for (const [position, width, strength] of [[.17, .008, .0035], [.34, .006, .005], [.53, .007, .003], [.76, .005, .004]]) {
    older += strength * Math.exp(-(((t - position) / width) ** 2));
  }
  return { cut: fineDepth + older, fine, broad };
}

/** Compact cheek curl, embedded poll roots, and a tapered keratin section. */
export function ramHorns(s, p, options={}) {
  const rings = 256, sides = 24;
  const rootColor = new THREE.Color(0x938263);
  const shaftColor = new THREE.Color(0xb5a382);
  const tipColor = new THREE.Color(0x88765a);
  const headOffset = p?.head
    ? [p.head[0], p.head[1] - 1.470, p.head[2] - .925]
    : [0, 0, 0];
  for (const side of [-1, 1]) {
    // The heavy shaft sweeps backward above the ear, wraps behind the jaw,
    // then turns forward/up. Its lower edge stays beside the jaw rather than
    // making a thin ring suspended below the throat.
    const horn = [
      [.112, 1.535, .929, .055, .061],
      [.157, 1.583, .884, .067, .075],
      [.215, 1.622, .818, .068, .077],
      [.270, 1.627, .742, .064, .072],
      [.305, 1.589, .672, .056, .064],
      [.320, 1.525, .622, .048, .056],
      [.323, 1.449, .613, .041, .048],
      [.320, 1.378, .643, .034, .040],
      [.315, 1.332, .705, .027, .033],
      [.308, 1.320, .779, .021, .026],
      [.301, 1.343, .851, .015, .020],
      [.295, 1.376, .910, .010, .014],
      [.288, 1.412, .951, .006, .009],
      [.282, 1.432, .968, .002, .004],
    ].map(point => [side * point[0], ...point.slice(1)]);
    for (const point of horn) {
      point[0] += headOffset[0];
      point[1] += headOffset[1];
      point[2] += headOffset[2];
    }
    s.loft(horn, 'Head', (_point, index) => {
      const t = Math.floor(index / sides) / rings;
      const angle = (index % sides) / sides * Math.PI * 2;
      if(options.color)return options.color(t,angle);
      const grain = keratinGrain(t, angle);
      const color = rootColor.clone().lerp(shaftColor, smooth(.06, .61, t));
      color.lerp(tipColor, smooth(.82, 1, t) * .62);
      return color.multiplyScalar(1 - grain.fine * .045 - grain.broad * .11 - grain.cut * .7
        + .011 * Math.sin(angle * 5 + t * 3) + .007 * Math.sin(angle * 11 - t * 2));
    }, {
      rings, sides, material: 2,
      detail: options.detail ?? ((t, angle) => {
        const grain = keratinGrain(t, angle);
        // Broad keratin faces and rounded corners remain visible under light.
        // Their relief diminishes with the horn's narrowing terminal section.
        const face = angle * 3 + .25;
        const section = (1 - .72 * smooth(.35, 1, t))
          * (.155 * Math.cos(face) - .028 * Math.cos(face * 2));
        const longitudinal = .004 * Math.cos(angle * 7 + t * .7);
        return 1 + section + longitudinal - grain.cut;
      }),
    });
  }
}
