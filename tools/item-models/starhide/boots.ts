import * as THREE from 'three';
import { bodyProfile } from '../core/profile';
import type { StarhideMaterials } from './contracts';
import { TAU, V, lerp, fit, shell, ribbon, border, diamond, mirror, mesh, type Surface } from './lower-shapes';

/** Calf-high fitted cloth boots with a continuous scale vamp and slim pointed toes. */
export function buildBoots(m: StarhideMaterials): THREE.Group {
  const g = new THREE.Group(); g.name = 'Starhide fitted pointed boots';
  for (const sign of [1,-1]) {
    const local = new THREE.Group();
    const crown = (a: number) => .425 + .038 * Math.pow(Math.abs(Math.sin(a)), 8) + .012 * Math.cos(a * 4);
    const point = (angle: number, y: number, lift = 0) => {
      const a = angle;
      const p = fit(y <= .18 ? bodyProfile.leftFoot : bodyProfile.leftLeg, y, a, .012 + lift);
      // The narrow extension grows out of the measured forefoot instead of adding a bulb.
      const frontAngle = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      const toe = Math.pow(Math.max(0, 1 - frontAngle / .70), 1.3) * Math.exp(-Math.pow((y - .013) / .043, 2));
      p.z += .073 * toe;
      // Tiny broken ankle folds follow the shaft and stay below its surface relief.
      const fold = .0012 * Math.sin(y * 140 + a * 2) * Math.exp(-Math.pow((y - .145) / .055, 2));
      p.add(V(Math.sin(a) * fold, 0, Math.cos(a) * fold));
      return p;
    };
    const boot: Surface = (u, v) => point(u * TAU, lerp(.005, crown(u * TAU), v));
    shell(local, 'Continuous slim cloth boot upper', boot, m.cloth, m.lining, 64, 46, .003);
    ribbon(local, 'Scalloped crown narrow silver binding', boot, t => [t,1], m.silver, .0034);
    ribbon(local, 'Crown fine inner stitch', boot, t => [t,.983], m.thread, .00065);
    ribbon(local, 'Back quarter long stitch seam', boot, t => [.5,t], m.thread, .0008);
    ribbon(local, 'Low sole silver welt', boot, t => [t,.009], m.silver, .0015);

    // A single scale inset follows the full instep, ankle and front calf.
    const scaleFront: Surface = (u,v) => {
      const y = lerp(.043,.431,v);
      const halfWidth = .57 + .28 * Math.pow(v,3) - .15 * Math.exp(-Math.pow((v-.24)/.16,2));
      const a = (u*2-1)*halfWidth + .07*Math.sin(v*Math.PI*1.3);
      const low = .031 + .035 * Math.pow(Math.abs(u*2-1), 1.8);
      const top = Math.min(crown(a)-.024, .429 + .018*Math.sin(u*Math.PI));
      return point(a,lerp(low,top,v),.0019);
    };
    const scale = shell(local, 'Continuous inset scales from calf onto instep', scaleFront, m.scales, m.lining, 30, 46, .0012);
    const uv=scale.geometry.getAttribute('uv');
    // Centered transverse distance and a shared centerline length avoid UV shear
    // as the inset narrows over the ankle and bends onto the instep.
    for (let layer = 0; layer < 2; layer++) for (let row = 0; row <= 46; row++) {
      const start = layer * 31 * 47 + row * 31;
      const midU = uv.getX(start + 15), centerV = uv.getY(start + 15);
      for (let col = 0; col <= 30; col++) {
        const index = start + col;
        uv.setXY(index, (uv.getX(index) - midU) * 2, centerV * 1.25);
      }
    }
    border(local,'Curved silver scale inset framing',scaleFront,m.silver,.0035);

    // Swept cloth side panels and their narrow flowing borders echo the icon.
    for (const side of [-1,1]) {
      const sweep: Surface=(u,v)=>{
        const y=lerp(.055,.447,v);
        const inner=.48+.42*v+.18*Math.sin(v*Math.PI*2);
        const a=side*lerp(inner,inner+.26,u);
        return point(a,Math.min(y,crown(a)-.008),.003);
      };
      shell(local,'Swept indigo side panel',sweep,m.cloth,m.lining,12,38,.0013);
      ribbon(local,'Long curved silver side filigree',sweep,t=>[.04,t],m.silver,.0031);
      ribbon(local,'Fine parallel engraved side line',sweep,t=>[.20,t],m.thread,.00065);
      ribbon(local,'Outer pointed side seam',sweep,t=>[.96,t],m.silver,.0018);
      const flourish: Surface=(u,v)=>point(side*(.78+.68*u),lerp(.30,.438,v),.0035);
      ribbon(local,'Curled crown silver flourish',flourish,t=>[.18+.62*Math.sin(t*Math.PI),.12+.76*t],m.silver,.0025);
      ribbon(local,'Crown engraved return flourish',flourish,t=>[.23+.42*Math.sin(t*Math.PI),.19+.68*t],m.thread,.00085);
    }

    // A fine silver leaf at the toe, and a small nested diamond over the vamp.
    const toe: Surface=(u,v)=>{
      const a=lerp(-.70,.70,u), y=lerp(.011,.067,v);
      return point(a,y,.0034);
    };
    for(const side of [-1,1]) ribbon(local,'Pointed toe silver sweep',toe,
      t=>[.5+side*(.015+.42*Math.sin(t*Math.PI*.68)),lerp(.03,.90,t)],m.silver,.0027);
    ribbon(local,'Toe central narrow silver leaf',toe,t=>[.5,t*.88],m.silver,.0023);
    diamond(local,'Vamp four point silver ornament',toe,.5,.64,.17,.20,m.silver,.0018);
    diamond(local,'Vamp small inset star',toe,.5,.64,.085,.10,m.thread,.00085);
    ribbon(local,'Vamp curved cap seam',toe,t=>[t,.88-.20*Math.sin(t*Math.PI)],m.thread,.0007);

    // Low stacked leather outsole, with a shallow undercut arch and separate heel.
    const sole: Surface=(u,v)=>{
      const a=u*TAU,p=point(a,.007,.0014);
      const heelBlend=THREE.MathUtils.smoothstep(p.z,-.08,-.015);
      const bottom=-.010+.004*Math.sin(heelBlend*Math.PI);
      return V(p.x,lerp(bottom,.009,v),p.z);
    };
    shell(local,'Thin stacked leather outsole wall',sole,m.sole,m.sole,72,3,.0025);
    ribbon(local,'Outsole top stitched welt',sole,t=>[t,.91],m.thread,.0007);
    ribbon(local,'Outsole leather layer one',sole,t=>[t,.29],m.sole,.0011);
    ribbon(local,'Outsole leather layer two',sole,t=>[t,.57],m.sole,.0011);
    const bottom: Surface=(u,v)=>{
      const p=sole(u,0), c=V(.126,p.y,-.012);
      return c.lerp(p,Math.max(.0001,v));
    };
    shell(local,'Closed leather outsole bottom',bottom,m.sole,m.sole,72,3,.001);
    // Heel footprint is deliberately low and narrow, staying inside the rear boot.
    const heelGeo=new THREE.BoxGeometry(.063,.018,.079,1,1,1);
    heelGeo.translate(.121,-.010,-.091);
    const bevelPositions=heelGeo.getAttribute('position');
    for(let i=0;i<bevelPositions.count;i++) if(bevelPositions.getY(i)<-.012) {
      bevelPositions.setX(i,.121+(bevelPositions.getX(i)-.121)*.91);
      bevelPositions.setZ(i,-.091+(bevelPositions.getZ(i)+.091)*.93);
    }
    heelGeo.computeVertexNormals();
    mesh(local,'Low tapered stacked heel',heelGeo,m.sole);
    mirror(g,local,sign,'Boot');
  }
  return g;
}
