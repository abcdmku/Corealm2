import * as THREE from 'three';
import { bodyProfile } from '../core/profile';
import type { StarhideMaterials } from './contracts';
import { TAU, V, lerp, fit, shell, ribbon, border, diamond, mirror, mesh, type Surface } from './lower-shapes';

/** Tailored indigo trousers, thin inset knee shields, split embroidered hip tabs. */
export function buildLeggings(m: StarhideMaterials): THREE.Group {
  const g = new THREE.Group(); g.name = 'Starhide tailored leggings';
  const waist: Surface = (u, v) => fit(bodyProfile.torso, lerp(.925, 1.055, v), u * TAU, .008);
  shell(g, 'Continuous fitted waist and seat', waist, m.cloth, m.lining, 64, 14, .0025);
  ribbon(g, 'Narrow bound waistband', waist, t => [t, 1], m.silver, .0028);
  for (const side of [1, -1]) {
    const leg = new THREE.Group();
    const trousers: Surface = (u, v) => {
      const y = lerp(.112, .955, v), a = u * TAU;
      const kneeFold = .0018 * Math.sin(y * 112 + a * 2) * Math.exp(-Math.pow((y - .57) / .10, 2));
      const ease = .007 + .002 * Math.exp(-Math.pow((y - .76) / .12, 2)) + kneeFold;
      const p = fit(bodyProfile.leftLeg, y, a, ease);
      // The inseam closes at the crotch without two inflated tubes overlapping.
      if (y > .85 && p.x < .005) p.x = .004;
      return p;
    };
    shell(leg, 'Smooth fitted cloth leg', trousers, m.cloth, m.lining, 48, 44, .0025);
    ribbon(leg, 'Outer leg fine tailored seam', trousers, t => [.245, t], m.thread, .0008);
    ribbon(leg, 'Inseam thread', trousers, t => [.74, t], m.thread, .0006);
    ribbon(leg, 'Narrow trouser ankle binding', trousers, t => [t, 0], m.silver, .002);

    // A single curved shield on each knee. Its outline follows the knee surface.
    const knee: Surface = (u, v) => {
      const halfAngle = .76 * (0.12 + .88 * Math.pow(Math.sin(v * Math.PI * .76), .75));
      const a = (u * 2 - 1) * halfAngle;
      const y = lerp(.452, .608, v) + .012 * Math.sin(u * Math.PI) * Math.pow(v, 5);
      return fit(bodyProfile.leftLeg, y, a, .0115);
    };
    const panel = shell(leg, 'Single flush scale inset knee shield', knee, m.scales, m.lining, 28, 22, .0018);
    const kneeUV = panel.geometry.getAttribute('uv');
    for (let i = 0; i < kneeUV.count; i++) kneeUV.setXY(i, kneeUV.getX(i) * 2, kneeUV.getY(i) * 1.25);
    border(leg, 'Knee shield fine silver frame', knee, m.silver, .0034);
    diamond(leg, 'Knee lower engraved spear', knee, .5, .105, .16, .10, m.silver, .0022);
    diamond(leg, 'Knee upper four point inset', knee, .5, .88, .07, .08, m.silver, .0013);

    // Narrow dark shin panel leaves the calf slim; ornament is sewn into its face.
    const shin: Surface = (u, v) => {
      const y = lerp(.118, .471, v), width = lerp(.46, .52, v) - .13 * Math.sin(v * Math.PI);
      return fit(bodyProfile.leftLeg, y, (u * 2 - 1) * width + .08 * Math.sin(v * Math.PI), .0095);
    };
    shell(leg, 'Long narrow indigo shin applique', shin, m.cloth, m.lining, 18, 30, .0013);
    border(leg, 'Shin fine ribbon binding', shin, m.silver, .0018);
    for (const [v, h] of [[.1,.07],[.31,.075],[.55,.08],[.78,.085]] as const) {
      diamond(leg, 'Branching four point shin embroidery', shin, .5, v, .19, h, m.thread, .00105);
    }
    ribbon(leg, 'Shin embroidered central stem', shin, t => [.5 + .10 * Math.sin(t * Math.PI * 2), t], m.thread, .0009);
    for (const s of [-1, 1]) ribbon(leg, 'Shin curving branch', shin,
      t => [.5 + s * .36 * Math.sin(t * Math.PI), lerp(.06, .91, t)], m.thread, .0007);
    // Long sparse embroidery carries the icon's thin pointed thigh detail.
    const thigh: Surface = (u, v) => fit(bodyProfile.leftLeg, lerp(.61, .885, v), (u * 2 - 1) * .53, .0105);
    for (const s of [.17,.83]) ribbon(leg, 'Thigh silver stitch line', thigh, t => [s + .055 * Math.sin(t * Math.PI), t], m.thread, .00075);
    diamond(leg, 'Thigh tapered silver star', thigh, .5, .56, .105, .135, m.silver, .0017);
    diamond(leg, 'Thigh nested star engraving', thigh, .5, .59, .052, .065, m.thread, .0008);
    mirror(g, leg, side, 'Trouser');
  }

  const hipPoint = (a: number, y: number, ease: number) => {
    const p = fit(bodyProfile.torso, Math.max(.937, y), a, ease);
    const flare = Math.max(0, .937 - y) * .16;
    return p.add(V(Math.sin(a) * flare, y - Math.max(.937, y), Math.cos(a) * flare * .45));
  };
  // Four separate angular skirt tabs, with open seams at the front and rear.
  for (const side of [1, -1]) for (const rear of [false, true]) {
    const local = new THREE.Group();
    const start = rear ? 1.58 : .08, end = rear ? 2.98 : 1.55;
    const tab: Surface = (u, v) => {
      const a = lerp(start, end, u);
      const bottom = rear ? .823 - .045 * Math.sin(u * Math.PI) : .862 - .089 * (u <= .78 ? u / .78 : (1 - u) / .22);
      return hipPoint(a, lerp(bottom, 1.014, v), .0095);
    };
    const cloth = shell(local, 'Short angular split hip tab', tab, m.cloth, m.lining, 28, 18, .002);
    cloth.userData.itemModelDeform = 'skirt';
    border(local, 'Hip tab fine silver border', tab, m.silver, .0027);
    const inset: Surface = (u, v) => {
      const p = tab(lerp(.17, .92, u), lerp(.07, .50 + .20 * u, v));
      return p.add(V(Math.sin(lerp(start,end,lerp(.17,.92,u))) * .0014, 0, Math.cos(lerp(start,end,lerp(.17,.92,u))) * .0014));
    };
    const sc = shell(local, 'Flush hip scale inset', inset, m.scales, m.lining, 20, 14, .001);
    const uv = sc.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 1.25);
    sc.userData.itemModelDeform = 'skirt';
    border(local, 'Hip scale inset silver edge', inset, m.silver, .0024);
    for (const child of local.children) child.userData.itemModelDeform = 'skirt';
    mirror(g, local, side, rear ? 'Rear hip' : 'Front hip');
  }

  // Crossed, flat bands meeting a small blue diamond at the front.
  for (const slope of [-1, 1]) {
    const belt: Surface = (u, v) => {
      const a = u * TAU, y = 1.025 + slope * .020 * Math.sin(a) + lerp(-.015,.015,v);
      return fit(bodyProfile.torso, y, a, .0108 + (slope > 0 ? .001 : 0));
    };
    shell(g, 'Crossed narrow cloth waistband', belt, m.cloth, m.lining, 64, 4, .0015);
    ribbon(g, 'Crossed waistband lower silver line', belt, t => [t,0], m.silver, .0023);
    ribbon(g, 'Crossed waistband upper silver line', belt, t => [t,1], m.silver, .0023);
  }
  const clasp: Surface = (u,v) => {
    const y = lerp(.976,1.073,v); return fit(bodyProfile.torso, y, (u*2-1)*.28,.014);
  };
  diamond(g,'Slender diamond belt clasp',clasp,.5,.5,.27,.49,m.silver,.0033);
  diamond(g,'Diamond clasp inner engraving',clasp,.5,.5,.17,.31,m.silver,.0018);
  const gem = new THREE.OctahedronGeometry(1,0); gem.scale(.010,.020,.0035);
  const p=clasp(.5,.5); gem.translate(p.x,p.y,p.z+.0015); mesh(g,'Small inset blue diamond clasp',gem,m.gem);
  return g;
}
