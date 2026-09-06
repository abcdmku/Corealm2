import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
const directory=path.resolve('tools/rpg-bestiary/mocap-goblin-source/derived');
const data=JSON.parse(fs.readFileSync(path.join(directory,'source.json'),'utf8'));

/** Direct source construction. Kept separate for Blender-pose parity tests. */
export function buildNativeGoblin(){
  const object=new T.Group();object.name='mocap_goblin';
  const nodes=data.nodes.map((n,i)=>{const b=i?new T.Bone():new T.Group();b.name=`mocap_${n.name}`;b.position.fromArray(n.position);b.quaternion.fromArray(n.quaternion);b.scale.fromArray(n.scale);return b;});
  data.nodes.forEach((n,i)=>(n.parent===null?object:nodes[n.parent]).add(nodes[i]));object.updateMatrixWorld(true);
  const d=data.meshes[0],skeleton=new T.Skeleton(d.joints.map(i=>nodes[i]),d.inverseBindMatrices.map(a=>new T.Matrix4().fromArray(a)));
  const materials=[new T.MeshStandardMaterial({name:'mocap_goblin_original_body',color:0xffffff,roughness:.85}),new T.MeshStandardMaterial({name:'mocap_goblin_original_knife',color:0xffffff,roughness:.57,metalness:.28})];
  const meshes=[];
  for(let material=0;material<2;material++){
    const arrays={position:[],normal:[],uv:[],skinIndex:[],skinWeight:[]},sourceIndices=[];
    for(let triangle=0;triangle<d.materialIndices.length;triangle++)if(d.materialIndices[triangle]===material)for(let k=0;k<3;k++){
      const i=triangle*3+k;sourceIndices.push(d.sourceControlIndices[i]);
      arrays.position.push(...d.positions.slice(i*3,i*3+3));arrays.normal.push(...d.normals.slice(i*3,i*3+3));
      // Blender UVs use bottom-left texture origin. Export rows remain unchanged.
      arrays.uv.push(d.uvs[i*2],1-d.uvs[i*2+1]);arrays.skinIndex.push(...d.skinIndices.slice(i*4,i*4+4));arrays.skinWeight.push(...d.skinWeights.slice(i*4,i*4+4));
    }
    const geometry=new T.BufferGeometry();
    for(const [name,size]of Object.entries({position:3,normal:3,uv:2,skinIndex:4,skinWeight:4}))geometry.setAttribute(name,name==='skinIndex'?new T.Uint16BufferAttribute(arrays[name],size):new T.Float32BufferAttribute(arrays[name],size));
    const mesh=new T.SkinnedMesh(geometry,materials[material]);mesh.name=`mocap_goblin_${material===0?'body':'knife'}`;mesh.userData.sourceControlIndices=sourceIndices;mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;nodes[0].add(mesh);mesh.bind(skeleton,new T.Matrix4());meshes.push(mesh);
  }
  const clips=data.clips.map(c=>new T.AnimationClip(c.name,-1,c.tracks.flatMap(t=>[
    new T.VectorKeyframeTrack(`${nodes[t.node].name}.position`,c.times,t.position),
    new T.QuaternionKeyframeTrack(`${nodes[t.node].name}.quaternion`,c.times,t.quaternion),
    new T.VectorKeyframeTrack(`${nodes[t.node].name}.scale`,c.times,t.scale),
  ])));
  object.updateMatrixWorld(true);return {object,clips,meshes,nodes,data};
}

export function buildMocapGoblin(id='goblin_scout'){
  const native=buildNativeGoblin(),{object}=native;object.name=id;
  const mapping={Idle:'Idle',Walk:'Walk',Run:'Walk',Attack:'Attack2',AttackSecondary:'Attack1',Death:'Die'};
  const clips=Object.entries(mapping).map(([name,source])=>{const clip=native.clips.find(c=>c.name===source).clone();clip.name=name;return clip;});
  const run=clips.find(c=>c.name==='Run');for(const track of run.tracks)for(let i=0;i<track.times.length;i++)track.times[i]*=.70;run.resetDuration();
  const idle=clips[0],times=[0,.08,.19,.34,.48];
  for(const name of ['Hit','HitLeft','HitRight']){
    const tracks=idle.tracks.map(t=>{const size=t.getValueSize(),initial=Array.from(t.values.slice(0,size));return new t.constructor(t.name,times,times.flatMap(()=>initial));});
    for(const [bone,angle]of [['LowerBack',.16],['Spine',.18],['Head',.11]]){
      const track=tracks.find(t=>t.name===`mocap_${bone}.quaternion`);if(!track)continue;
      for(let i=0;i<times.length;i++){
        const amount=[0,1,.6,.12,0][i],q=new T.Quaternion().fromArray(track.values,i*4);
        q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),angle*amount));
        if(name!=='Hit')q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),(name==='HitLeft'?1:-1)*.25*amount));q.toArray(track.values,i*4);
      }
    }
    clips.push(new T.AnimationClip(name,.48,tracks));
  }
  const mixer=new T.AnimationMixer(object);mixer.clipAction(idle).play();mixer.setTime(0);object.updateMatrixWorld(true);
  let box=new T.Box3().setFromObject(object,true),size=box.getSize(new T.Vector3()),scale=1.35/size.y;
  object.scale.setScalar(scale);object.updateMatrixWorld(true);box=new T.Box3().setFromObject(object,true);
  const center=box.getCenter(new T.Vector3());object.position.set(-center.x,.006-box.min.y,-center.z);mixer.stopAllAction();object.updateMatrixWorld(true);
  const root=native.nodes[0],floorCorrection={};
  // Only translation of the locomotion origin is removed; native limb motion remains intact.
  for(const clip of clips.filter(c=>c.name==='Walk'||c.name==='Run')){
    const track=clip.tracks.find(t=>t.name==='mocap_Hips.position');if(track)for(let i=0;i<track.values.length;i+=3){track.values[i]=track.values[0];track.values[i+1]=track.values[1];}
  }
  for(const clip of clips){
    const action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const count=Math.ceil(clip.duration*60),times=Array.from({length:count+1},(_,i)=>i*clip.duration/count),values=[];let maxLift=0;
    for(const time of times){mixer.setTime(time);object.updateMatrixWorld(true);const floor=new T.Box3().setFromObject(object,true).min.y,lift=Math.max(0,.006-floor)/scale;values.push(root.position.x,root.position.y+lift,root.position.z);maxLift=Math.max(maxLift,lift*scale);}
    action.stop();mixer.uncacheClip(clip);clip.tracks.push(new T.VectorKeyframeTrack(`${root.name}.position`,times,values));floorCorrection[clip.name]={samples:times.length,maximumWorldLift:maxLift};
  }
  mixer.stopAllAction();object.updateMatrixWorld(true);object.animations=clips;
  return {object,clips,meta:{family:'goblin',height:1.35,rig:'original-mocap-goblin-25-bone',sourceSkinned:true,license:'CC-BY-3.0 derivative; CC0 original body',source:'https://opengameart.org/content/goblin-animated-by-motion-capture',revision:'mocap-goblin-source-review-2',runtimeClipMap:mapping,sourceClipping:{report:'test-results/mocap-goblin-source/clipping.json',method:'Native Blender evaluated knife versus torso/head triangle intersection; 25 samples per clip',Flee:{affectedSamples:3,maxTrianglePairs:78,disposition:'retained in source archive only'},Attack1:{affectedSamples:4,maxTrianglePairs:153,disposition:'preserved as AttackSecondary; do not use without visual review'},Attack2:{affectedSamples:0,disposition:'primary Attack'},Walk:{affectedSamples:0,disposition:'Walk plus .70 duration Run alias'}},attackContact:.5,attackContactSource:'Provisional until native attack screenshot/contact review',floorCorrection,weightReduction:data.weightReduction,sourceFacts:data.sourceFacts,textureBindings:[{materialName:'mocap_goblin_original_body',baseColorPath:path.join(directory,'goblin-texture.png'),normalPath:path.join(directory,'goblin-normal.png'),flipY:false},{materialName:'mocap_goblin_original_knife',baseColorPath:path.join(directory,'Goblin-Knife-texture.png'),flipY:false}],provenance:{source:'https://opengameart.org/content/goblin-animated-by-motion-capture',sourceUrl:'https://opengameart.org/content/goblin-animated-by-motion-capture',attribution:'Goblin animated by Motion capture by Danimal, based on the CC0 goblin by xGhostx7, with knife by Wind astella. Converted for Corealm with source geometry preserved and runtime clip adaptation.',licenseUrl:'https://creativecommons.org/licenses/by/3.0/',licenseURLs:['https://creativecommons.org/licenses/by/3.0/','https://creativecommons.org/publicdomain/zero/1.0/'],contributors:[{author:'Danimal',role:'animation and derivative',source:'https://opengameart.org/content/goblin-animated-by-motion-capture',license:'CC-BY-3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/'},{author:'xGhostx7',role:'original body',source:'https://www.blendswap.com/blends/view/72394',license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'},{author:'Wind astella',role:'original knife',source:'https://opengameart.org/content/wind-weapon-pack-1',license:'CC-BY-3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/'}],author:'Danimal; body xGhostx7; knife Wind astella',license:'CC-BY-3.0 derivative; body CC0; knife CC-BY-3.0',sourcePacks:[{id:'goblin-animated-by-motion-capture',sha256:'9dd294e6a509ec9a4036d3694e73e13eeaaf80e800604e4e7e7957088d46cc3f'}],sourceFiles:data.sourceFiles,modifications:'Original whole mesh, knife, normals, material-specific UV layers and all four native influences preserved. Original NLA strips sampled at 48 Hz with native timing. Primary Attack uses native Attack2; clipped Attack1 preserved as AttackSecondary. Run uses Walk at .70 duration because native Flee has confirmed knife/torso intersections; Flee remains in original source data only. Uniform height normalization; locomotion origin held in place; whole-mesh floor correction. Three authored hit reactions added because source has none.'},sourceClips:data.clips.filter(c=>Object.values(mapping).includes(c.name)).map(c=>({name:c.name,action:c.action,firstFrame:c.firstFrame,lastFrame:c.lastFrame,timelineStart:c.timelineStart,timelineEnd:c.timelineEnd,fps:c.fps})),animationAcceptance:'Unapproved source alternative. Original author warns mocap clipping; CPU parity is not combat or visual acceptance.'}};
}
