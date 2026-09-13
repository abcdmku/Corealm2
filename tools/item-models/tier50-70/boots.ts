import * as THREE from 'three';
import { bodyProfile } from '../core/profile';
import type { ArmorMaterials, ArmorTheme } from './contracts';
import { addScaleField } from './scale-field';
import { TAU, V, lerp, smoothFit, shell, ribbon, border, diamond, mirror, type Surface } from './lower-shapes';

type BootPoint = (angle: number, y: number, lift?: number) => THREE.Vector3;

/** Broad scales at the calf become narrower over the long, curved instep. */
function instepHeight(v: number, start: number, end: number): number {
  const anchors = [[0, start], [.25, .083], [.43, .16], [1, end]] as const;
  let index = 0;
  while (index < anchors.length - 2 && v > anchors[index + 1]![0]) index++;
  const a = anchors[index]!, b = anchors[index + 1]!;
  return lerp(a[1], b[1], (v - a[0]) / (b[0] - a[0]));
}

function addToeWork(g: THREE.Group, theme: ArmorTheme, m: ArmorMaterials, point: BootPoint): void {
  const toe: Surface = (u, v) => point(lerp(-.91, .91, u), lerp(.008, .043, v), .003);
  // The toe ornament follows the curved upper and converges at its actual point.
  for (const side of [-1, 1]) {
    ribbon(g, 'Toe cap swept metal branch', toe,
      t => [.5 + side * .45 * Math.sin(t * Math.PI * .57), .04 + .90 * t], m.metal, .005, 48);
    ribbon(g, 'Toe cap fine chased inner line', toe,
      t => [.5 + side * .36 * Math.sin(t * Math.PI * .57), .13 + .82 * t], m.thread, .00055, 42, .0018);
    const scroll: Surface = (u, v) => point(side * .40 + (u - .5) * .45, lerp(.017, .054, v), .004);
    ribbon(g, 'Toe small returning scroll', scroll, t => {
      const angle = lerp(-Math.PI * .62, Math.PI * 1.1, t), radius = lerp(.43, .045, t);
      return [.50 + radius * Math.cos(angle), .50 + radius * Math.sin(angle)];
    }, m.metal, .0022, 44);
  }
  ribbon(g, 'Toe cap narrow central leaf', toe, t => [.5, lerp(.03, .92, t)], m.metal, .0045, 44);
  ribbon(g, 'Toe leaf engraved center', toe, t => [.5, lerp(.10, .80, t)], m.thread, .0005, 38, .0022);
  if (theme === 'starhide') {
    diamond(g, 'Silver vamp four point jewel setting', toe, .5, .91, .15, .12, m.metal, .0031);
    diamond(g, 'Vamp fine inset jewel', toe, .5, .91, .062, .061, m.gem, .0016);
  }
  ribbon(g, 'Curving toe cap stitched seam', toe, t => [t, .92 - .12 * Math.sin(t * Math.PI)], m.thread, .0007, 54);
}

function addSole(g: THREE.Group, m: ArmorMaterials, point: BootPoint): void {
  const sole: Surface = (u, v) => {
    const p = point(u * TAU, .006, .0017);
    const arch = .007 * Math.exp(-Math.pow((p.z + .044) / .030, 2));
    const front = THREE.MathUtils.smoothstep(p.z, .09, .18);
    return V(p.x, lerp(-.011 + arch + .003 * front, .0075 + .004 * front, v), p.z);
  };
  shell(g, 'Thin leather outsole with undercut arch', sole, m.sole, m.sole, 84, 4, .0026);
  ribbon(g, 'Fine outsole welt stitch', sole, t => [t, .89], m.thread, .0007, 96, .0003);
  ribbon(g, 'Stacked leather sole lower seam', sole, t => [t, .28], m.sole, .0010, 84, .0004);
  const bottom: Surface = (u, v) => {
    const p = sole(u, 0);
    return V(lerp(.126, p.x, Math.max(.0001, v)), p.y - .0002, lerp(-.020, p.z, Math.max(.0001, v)));
  };
  shell(g, 'Closed shaped outsole underside', bottom, m.sole, m.sole, 84, 3, .001);

  const heel: Surface = (u, v) => {
    const a = u * TAU, taper = lerp(.90, 1, v);
    const sx = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), .62);
    const sz = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), .62);
    return V(.121 + sx * .036 * taper, lerp(-.034, -.009, v), -.106 + sz * .037 * taper);
  };
  shell(g, 'Low rounded tapered leather heel', heel, m.sole, m.sole, 48, 3, .002);
  for (const v of [.30, .60]) ribbon(g, 'Heel stacked leather layer', heel, t => [t, v], m.sole, .0009, 48, .0003);
  const heelBottom: Surface = (u, v) => {
    const p = heel(u, 0);
    return V(lerp(.121, p.x, Math.max(.0001, v)), -.034, lerp(-.106, p.z, Math.max(.0001, v)));
  };
  shell(g, 'Closed low heel contact face', heelBottom, m.sole, m.sole, 48, 2, .001);
}

function addStarhide(g: THREE.Group, m: ArmorMaterials, point: BootPoint, crown: (a: number) => number): void {
  const inset = (u: number, v: number, trimLift = 0) => {
    const width = .75 + .40 * v - .26 * Math.exp(-Math.pow((v - .49) / .20, 2));
    const curve = .09 * Math.sin(v * Math.PI * 1.7);
    const a = (u * 2 - 1) * width + curve;
    const bottom = .042 + .009 * Math.pow(Math.abs(u * 2 - 1), 1.6);
    const top = crown(a) - .014 - .022 * Math.pow(Math.abs(u * 2 - 1), 1.5);
    return point(a, instepHeight(v, bottom, top), .0017 + trimLift);
  };
  shell(g, 'Continuous curved calf and instep scale leather', inset, m.lining, m.lining, 24, 42, .0011);
  addScaleField(g, 'Continuous starhide calf to vamp', inset, m, { columns: 5, rows: 23, seed: 521, lift: .00025 });
  border(g, 'Sweeping silver scale field frame', (u, v) => inset(u, v, .003), m.metal, .0055);
  for (const side of [-1, 1]) {
    // Cloth remains visible between the scale edge and the heel-quarter frame.
    const panel = (u: number, v: number, trimLift = 0) => {
      const inner = .86 + .32 * v + .12 * Math.sin(v * Math.PI * 2);
      const a = side * (inner + .32) + (u - .5) * .62;
      const y = lerp(.034 + .024 * Math.abs(u - .5), crown(a) - .013, v);
      return point(a, y, .0022 + trimLift);
    };
    shell(g, 'Swept indigo cloth side quarter', panel, m.cloth, m.lining, 14, 38, .0012);
    const innerU = side > 0 ? .02 : .98, outerU = 1 - innerU;
    const panelTrim: Surface = (u, v) => panel(u, v, .003);
    ribbon(g, 'Long silver side leaf spine', panelTrim, t => [innerU, t], m.metal, .0045);
    ribbon(g, 'Side panel outer silver return', panelTrim, t => [outerU, t], m.metal, .0031);
    ribbon(g, 'Side panel fine hand stitched seam', panel, t => [lerp(innerU, outerU, .20), t], m.thread, .00065);
    const scroll: Surface = (u, v) => point(side * 1.11 + (u - .5) * .92, lerp(.25, .449, v), .0071);
    ribbon(g, 'Large silver calf returning curl', scroll, t => {
      const angle = lerp(-Math.PI * .72, Math.PI * 1.13, t), radius = lerp(.47, .07, t);
      return [.5 + side * radius * Math.cos(angle), .50 + radius * Math.sin(angle)];
    }, m.metal, .0039, 68);
    ribbon(g, 'Fine engraving within calf curl', scroll, t => {
      const angle = lerp(-Math.PI * .70, Math.PI * 1.13, t), radius = lerp(.445, .055, t);
      return [.5 + side * radius * Math.cos(angle), .50 + radius * Math.sin(angle)];
    }, m.thread, .00055, 66, .0019);
    const ankleLeaf: Surface = (u, v) => point(side * 1.14 + (u - .5) * .53, lerp(.062, .245, v), .0065);
    for (const edge of [-1, 1]) ribbon(g, 'Silver ankle leaf return', ankleLeaf,
      t => [.50 + edge * .36 * Math.sin(t * Math.PI), t], m.metal, edge < 0 ? .0039 : .0026, 55);
    ribbon(g, 'Ankle leaf fine central vein', ankleLeaf, t => [.5 + .045 * Math.sin(t * TAU), lerp(.06, .95, t)], m.thread, .00055, 40);
  }
}

function addDragonhide(g: THREE.Group, m: ArmorMaterials, point: BootPoint, crown: (a: number) => number): void {
  for (const side of [-1, 1]) {
    const sideScales = (u: number, v: number, trimLift = 0) => {
      const width = .64 + .91 * Math.sin(v * Math.PI * .70);
      const middle = 1.11 + .17 * Math.sin(v * Math.PI);
      const a = side * middle + (u - .5) * width;
      const low = .048 + .023 * Math.abs(u - .5);
      return point(a, lerp(low, crown(a) - .015, v), .0024 + trimLift);
    };
    shell(g, 'Long broad dragon scale side backing', sideScales, m.lining, m.lining, 18, 32, .0012);
    addScaleField(g, 'Broad dragon side armor', sideScales, m, { columns: 3, rows: 17, seed: side > 0 ? 703 : 709, lift: .0002 });
    const sideTrim: Surface = (u, v) => sideScales(u, v, .003);
    border(g, 'Gold side scale field framing', sideTrim, m.metal, .0046);
    const seamU = side > 0 ? .024 : .976;
    ribbon(g, 'Fine gold side frame chasing', sideTrim, t => [seamU, t], m.thread, .0006, 58, .0022);
  }
  // The upper chevron ends well above the ankle, exposing the red leather front.
  const upper = (u: number, v: number, trimLift = 0) => {
    const half = .11 + .94 * Math.pow(v, .72), a = (u * 2 - 1) * half;
    const top = crown(a) - .009;
    return point(a, lerp(.262, top, v), .004 + trimLift);
  };
  shell(g, 'Angular upper calf scale chevron backing', upper, m.lining, m.lining, 20, 25, .0013);
  addScaleField(g, 'Dragon upper calf chevron', upper, m, { columns: 5, rows: 8, seed: 719, lift: .0001 });
  const upperTrim: Surface = (u, v) => upper(u, v, .003);
  border(g, 'Angular gold calf crest frame', upperTrim, m.metal, .0061);
  const blade: Surface = (u, v) => {
    const half = .016 + .102 * Math.pow(Math.sin(v * Math.PI), 1.6);
    return point((u * 2 - 1) * half, lerp(.252, .478, v), .0098);
  };
  shell(g, 'Narrow raised gold central calf blade', blade, m.metal, m.metal, 6, 22, .0012);
  ribbon(g, 'Calf blade fine engraved ridge', blade, t => [.5, lerp(.025, .97, t)], m.thread, .00055, 52, .0005);
  diamond(g, 'Calf crest angular open jewel frame', upperTrim, .5, .54, .135, .14, m.metal, .0030);
  diamond(g, 'Calf crest small dark inset', upperTrim, .5, .54, .042, .07, m.gem, .0015);

  for (let bandIndex = 0; bandIndex < 3; bandIndex++) {
    const wrap: Surface = (u, v) => {
      const a = lerp(-1.17, 1.17, u);
      const base = .091 + bandIndex * .023 + .018 * Math.sin(a + .20);
      const p = point(a, base + v * .020, .008 + .0008 * Math.sin(v * Math.PI));
      return p;
    };
    shell(g, 'Burgundy overlapping ankle wrap', wrap, m.cloth, m.lining, 28, 5, .0019);
    ribbon(g, 'Ankle wrap fine stitched fold', wrap, t => [t, .22], m.thread, .00065, 48, .0007);
    if (bandIndex !== 1) ribbon(g, 'Ankle wrap narrow gold boundary', wrap, t => [t, bandIndex === 0 ? .02 : .98], m.metal, .0041, 48);
  }
  const buckle: Surface = (u, v) => point((u - .5) * .7, lerp(.087, .185, v), .0132);
  diamond(g, 'Long angular ankle wrap clasp', buckle, .52, .52, .15, .38, m.metal, .0042);
  diamond(g, 'Ankle clasp chased inset', buckle, .52, .52, .077, .25, m.thread, .0007);

  const vamp = (u: number, v: number, trimLift = 0) => {
    const a = (u * 2 - 1) * lerp(.88, .63, v);
    return point(a, lerp(.027 + .010 * Math.pow(Math.abs(u * 2 - 1), 1.4), .091, v), .0033 + trimLift);
  };
  shell(g, 'Dragon scale armored instep backing', vamp, m.lining, m.lining, 20, 22, .0012);
  addScaleField(g, 'Broad dragon instep courses', vamp, m, { columns: 4, rows: 8, seed: 727, lift: .00025 });
  const vampTrim: Surface = (u, v) => vamp(u, v, .003);
  border(g, 'Gold instep shield frame', vampTrim, m.metal, .0047);
  ribbon(g, 'Gold instep center spine', vampTrim, t => [.5 + .025 * Math.sin(t * Math.PI), t], m.metal, .0038, 50);
}

/** Native fitted boots. Both themes share a foot fit but keep their icon construction. */
export function buildBoots(theme: ArmorTheme, m: ArmorMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = `${theme} fitted pointed boots`;
  for (const sign of [1, -1]) {
    const local = new THREE.Group();
    const crown = (a: number): number => theme === 'dragonhide'
      ? .451 + .025 * Math.pow(Math.abs(Math.sin(a)), 7) + .006 * Math.cos(a * 2)
      : .447 + .026 * Math.pow(Math.abs(Math.sin(a)), 6) + .011 * Math.cos(a * 4);
    const point: BootPoint = (a, y, lift = 0) => {
      // The boot contains the gathered trousers and their fine shin embroidery.
      // Keep the measured foot snug, then provide shaft clearance at the calf.
      const shaft = THREE.MathUtils.smoothstep(y, .095, .155);
      const crownTaper = THREE.MathUtils.smoothstep(y, .395, .466);
      const ease = .009 + shaft * (.017 - .005 * crownTaper);
      const foot = smoothFit(bodyProfile.leftFoot, y, a, ease + lift);
      const leg = smoothFit(bodyProfile.leftLeg, y, a, ease + lift);
      const p = foot.lerp(leg, THREE.MathUtils.smoothstep(y, .145, .180));
      const frontAngle = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      const toe = Math.pow(Math.max(0, 1 - frontAngle / 1.05), 1.32)
        * Math.exp(-Math.pow((y - .012) / .036, 2));
      p.z += .055 * toe;
      const front = Math.pow(Math.max(0, Math.cos(a)), 3);
      const fold = .0016 * Math.sin(y * 132 + a * 2.5)
        * Math.exp(-Math.pow((y - .185) / .065, 2)) * (.32 + .68 * front);
      p.add(V(Math.sin(a) * fold, 0, Math.cos(a) * fold));
      return p;
    };
    const boot: Surface = (u, v) => point(u * TAU, lerp(.004, crown(u * TAU), v));
    shell(local, 'Fitted cloth boot with curved calf and narrow ankle', boot, m.cloth, m.lining, 72, 58, .0028);
    ribbon(local, 'Shaped crown narrow metal binding', boot, t => [t, 1], m.metal, .0042, 96);
    ribbon(local, 'Crown inner hand stitch', boot, t => [t, .977], m.thread, .00065, 96, .0003);
    ribbon(local, 'Back quarter vertical seam', boot, t => [.5, t], m.thread, .0007, 66, .0005);
    const heelSeam: Surface = (u, v) => point(lerp(Math.PI * .55, Math.PI * 1.45, u), lerp(.015, .105, v), .0013);
    ribbon(local, 'Heel quarter curved double seam', heelSeam, t => [t, .20 + .58 * Math.sin(t * Math.PI)], m.thread, .00075, 56);
    if (theme === 'dragonhide') addDragonhide(local, m, point, crown);
    else addStarhide(local, m, point, crown);
    addToeWork(local, theme, m, point);
    addSole(local, m, point);
    mirror(group, local, sign, `${theme} boot`);
  }
  return group;
}
