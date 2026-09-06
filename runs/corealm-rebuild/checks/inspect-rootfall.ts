import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {NodeIO} from '@gltf-transform/core';
import {Matrix4,Vector3} from 'three';
const d=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read('game/public/assets/models/nature/tree_twisted_2.glb');
for(const n of d.getRoot().listNodes()) {const m=n.getMesh();if(!m)continue;const matrix=new Matrix4().fromArray(n.getWorldMatrix());for(const p of m.listPrimitives()){const a=p.getAttribute('POSITION')!;const v=new Vector3(),pos:number[][]=[];for(let i=0;i<a.getCount();i++){const e=a.getElement(i,[]);v.fromArray(e).applyMatrix4(matrix);pos.push(v.toArray());}const ind=p.getIndices()?.getArray()??Array.from({length:pos.length},(_,i)=>i);const cut=-.201+18.949*.24;let kept=0,cross=0,max=-Infinity;for(let i=0;i<ind.length;i+=3){const ys=[pos[ind[i]!]![1]!,pos[ind[i+1]!]![1]!,pos[ind[i+2]!]![1]!];if(ys.reduce((a,b)=>a+b)/3<=cut){kept++;max=Math.max(max,...ys);if(Math.max(...ys)>cut)cross++;}}console.log(n.getName(),p.getMaterial()?.getName(),{bounds: [Math.min(...pos.map(v=>v[1]!)),Math.max(...pos.map(v=>v[1]!))],cut,kept,cross,max});}}

