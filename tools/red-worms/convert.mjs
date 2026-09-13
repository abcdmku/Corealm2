import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { loadFbx, texture, groundObject } from '../creature-expansion/monsters/common.mjs';

const base = '/.asset-cache/red-worms/Assets/Worms FREE/1-Small Worm';
window.inspectWorm = async () => {
  const root = await loadFbx(`${base}/Meshes/Worm_HighPoly.fbx`);
  const animation = await loadFbx(`${base}/Animations/Worm_Look.fbx`);
  const bones = []; root.traverse(n => { if (n.isBone) bones.push(n.name); });
  return { bounds: new THREE.Box3().setFromObject(root, true), bones,
    clips: animation.animations.map(c => ({ name: c.name, duration: c.duration, tracks: c.tracks.map(t => t.name) })) };
};

window.convertWorm = async () => {
  const root = await loadFbx(`${base}/Meshes/Worm_HighPoly.fbx`);
  const source = await loadFbx(`${base}/Animations/Worm_Look.fbx`);
  // Unity imports centimetres at globalScale 4. Keep a metre-based source;
  // the production species enlarges that small worm 9.6-fold.
  const idle = THREE.AnimationUtils.subclip(source.animations[0], 'Idle', 1, 200, 24);
  const bodyMap = await texture(`${base}/Textures/Base_Colors/Pink_Red.png`);
  const normalMap = await texture(`${base}/Textures/Normal_Map.png`, false);
  const material = new THREE.MeshStandardMaterial({ name: 'animal_red_worm_skin', map: bodyMap,
    color: new THREE.Color().setRGB(.52, .26, .15), normalMap, normalScale: new THREE.Vector2(.65,.65),
    roughness: .62, metalness: 0 });
  root.traverse(n => { if (n.isMesh) { n.material = material; n.frustumCulled = false;
    if (n.isSkinnedMesh) n.normalizeSkinWeights(); } });
  // The pack contains only Look. Locomotion and combat below are explicitly
  // authored additions on its unchanged five-segment skeleton.
  const poseMixer=new THREE.AnimationMixer(root);
  poseMixer.clipAction(idle).play();poseMixer.setTime(0);root.updateMatrixWorld(true);
  const axes=new Map();
  root.traverse(n=>{if(n.isBone){
    const inverse=n.getWorldQuaternion(new THREE.Quaternion()).invert();
    axes.set(n.name,{up:new THREE.Vector3(0,1,0).applyQuaternion(inverse),side:new THREE.Vector3(1,0,0).applyQuaternion(inverse)});
  }});
  poseMixer.stopAllAction();poseMixer.uncacheRoot(root);
  const authored = (name, seconds) => {
    const tracks = [], frames = Math.ceil(seconds * 30);
    for (const track of idle.tracks) {
      const width = track.getValueSize(), initial = Array.from(track.values.slice(0,width));
      const values = [], times = [];
      const segment = Number(track.name.match(/^Worm_Rig(\d+)/)?.[1] ?? 0);
      for (let i=0;i<=frames;i++) {
        const p=i/frames, value=initial.slice();
        if (track.name.endsWith('.quaternion')) {
          let yaw=0, pitch=0;
          if (name==='Walk'||name==='Run') yaw=.17*Math.sin(p*Math.PI*2-segment*.85);
          if (name==='Attack') pitch=-.32*Math.sin(Math.PI*p)**2*(segment/5);
          if (name==='Hit') yaw=.22*Math.sin(Math.PI*p)**2;
          if (name==='Death') pitch=.2*(p*p*(3-2*p))*(segment/5);
          const axis=axes.get(track.name.split('.')[0]);
          new THREE.Quaternion().fromArray(value)
            .multiply(new THREE.Quaternion().setFromAxisAngle(axis.side,pitch))
            .multiply(new THREE.Quaternion().setFromAxisAngle(axis.up,yaw)).toArray(value);
        }
        times.push(p*seconds); values.push(...value);
      }
      const Type=track.name.endsWith('.quaternion')?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;
      tracks.push(new Type(track.name,times,values));
    }
    return new THREE.AnimationClip(name,seconds,tracks);
  };
  const clips=[idle,authored('Walk',2.4),authored('Run',1.5),authored('Attack',1),authored('Hit',.5),authored('Death',1.2)];
  const object=groundObject(root,clips,.04,'Worm_Rig_Main');
  // Recenter the horizontal body about its bounds, preserving root transforms.
  const box=new THREE.Box3().setFromObject(object,true);
  object.position.x-=(box.min.x+box.max.x)/2;
  object.position.z-=(box.min.z+box.max.z)/2;
  object.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(object,true);
  const bytes=await new GLTFExporter().parseAsync(object,{binary:true,animations:clips});
  let text='';for(const b of new Uint8Array(bytes))text+=String.fromCharCode(b);
  return {base64:btoa(text),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},clips:clips.map(c=>({name:c.name,seconds:c.duration}))};
};


