import * as T from 'three';
import {readSourceGlb} from '../humanoid-source/read-glb.mjs';

/** CPU source reader for Blender glTF output; authored UVs, weights and inverse binds are retained. */
export function loadLavaSource(file){
  const source=readSourceGlb(file),j=source.json;
  const joints=new Set((j.skins||[]).flatMap(s=>s.joints));
  const nodes=j.nodes.map((n,i)=>{const o=joints.has(i)?new T.Bone():new T.Group();o.name=`lava_src_${i}_${(n.name||'node').replace(/[^a-zA-Z0-9_]/g,'_')}`;if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);if(n.matrix)new T.Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);return o;});
  j.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>nodes[i].add(nodes[c])));
  const object=new T.Group();object.name='lava_source';for(const i of j.scenes[j.scene||0].nodes)object.add(nodes[i]);object.updateMatrixWorld(true);
  const materials=(j.materials||[]).map((m,i)=>new T.MeshStandardMaterial({name:`lava_authored_${i}_${m.name}`,color:new T.Color().fromArray(m.pbrMetallicRoughness?.baseColorFactor||[1,1,1]),roughness:m.pbrMetallicRoughness?.roughnessFactor??.86,metalness:m.pbrMetallicRoughness?.metallicFactor??0,side:m.doubleSided?T.DoubleSide:T.FrontSide,alphaTest:m.alphaMode==='MASK'?(m.alphaCutoff??.5):0}));
  const skeletons=(j.skins||[]).map(s=>{const inv=s.inverseBindMatrices===undefined?null:source.accessor(s.inverseBindMatrices).array;return new T.Skeleton(s.joints.map(i=>nodes[i]),inv?s.joints.map((_,i)=>new T.Matrix4().fromArray(inv,i*16)):undefined);});
  j.nodes.forEach((n,i)=>{if(n.mesh===undefined)return;for(const [pi,p]of j.meshes[n.mesh].primitives.entries()){const g=new T.BufferGeometry();for(const [a,b]of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',TEXCOORD_1:'uv1',COLOR_0:'color',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'})){if(p.attributes[a]===undefined)continue;const v=source.accessor(p.attributes[a]);g.setAttribute(b,new T.BufferAttribute(v.array.slice(),v.itemSize,v.normalized));}if(p.indices!==undefined)g.setIndex(new T.BufferAttribute(source.accessor(p.indices).array.slice(),1));const mat=materials[p.material];mat.vertexColors=!!g.attributes.color;const mesh=n.skin===undefined?new T.Mesh(g,mat):new T.SkinnedMesh(g,mat);mesh.name=`${nodes[i].name}_mesh${pi}`;mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;nodes[i].add(mesh);if(n.skin!==undefined)mesh.bind(skeletons[n.skin],new T.Matrix4());}});
  object.updateMatrixWorld(true);
  const clips=(j.animations||[]).map(animation=>{const tracks=[];for(const c of animation.channels){const sampler=animation.samplers[c.sampler],times=source.accessor(sampler.input).array.slice(),values=source.accessor(sampler.output).array.slice(),target=nodes[c.target.node],field={rotation:'quaternion',translation:'position',scale:'scale'}[c.target.path];if(!field)continue;if(sampler.interpolation==='CUBICSPLINE')throw new Error('Blender source must bake cubic tracks to linear');const Type=field==='quaternion'?T.QuaternionKeyframeTrack:T.VectorKeyframeTrack;tracks.push(new Type(`${target.name}.${field}`,times,values,sampler.interpolation==='STEP'?T.InterpolateDiscrete:T.InterpolateLinear));}return new T.AnimationClip(animation.name,-1,tracks);});
  return {object,clips,materials,nodes,source};
}

