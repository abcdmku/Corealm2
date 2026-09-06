import bpy,os,json,sys,numpy as np
folder=os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(folder,'cat.historical-2017.original.fbx'),use_anim=True)
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');body=bpy.data.objects['Cat']
for track in arm.animation_data.nla_tracks:track.mute=True
lynx='--lynx' in sys.argv
if lynx:
    sys.path.insert(0,folder)
    from lynx_adaptation import adapt_cat
    adapt_cat(body,arm,apply_coat=True,adapt_rest_rig=True,native_motion_rebake_authorized=True)
    bpy.context.view_layer.update()
bones=list(arm.data.bones);names=[b.name for b in bones];lookup={n:i for i,n in enumerate(names)}
vertices=np.array([list(v.co)+[1] for v in body.data.vertices],dtype=np.float64)
weights=np.zeros((len(vertices),len(bones)),dtype=np.float64)
for v in body.data.vertices:
    for g in v.groups:
        name=body.vertex_groups[g.group].name
        if name in lookup:weights[v.index,lookup[name]]=g.weight
weights/=weights.sum(axis=1,keepdims=True)
inverse_rest=[b.matrix_local.inverted() for b in bones]
matrices=[];truth=[];samples=[]
random_only='--random' in sys.argv
rng=np.random.default_rng(260905)
for action in [a for a in bpy.data.actions if a.name.endswith('|Walk') or a.name.endswith('|run')]:
    arm.animation_data.action=action
    if action.slots:arm.animation_data.action_slot=action.slots[0]
    first,last=map(float,action.frame_range)
    # Original integer keys fit; interleaved fractional frames validate.
    for split,offset in ([('random',0)] if random_only else [('train',0),('heldout',.5)]):
        frames=np.sort(rng.uniform(first,last,23)) if random_only else np.arange(first,last+.001 if offset==0 else last,1)+offset
        for frame in frames:
            bpy.context.scene.frame_set(int(frame),subframe=float(frame-int(frame)));bpy.context.view_layer.update()
            world=arm.matrix_world;local=world.inverted()@body.matrix_world
            mats=np.array([np.asarray(world@arm.pose.bones[b.name].matrix@inverse_rest[i]@local,dtype=np.float64)[:3,:]*.1 for i,b in enumerate(bones)])
            evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
            value=np.empty(len(mesh.vertices)*3,dtype=np.float64);mesh.vertices.foreach_get('co',value);value=value.reshape((-1,3));mat=np.asarray(evaluated.matrix_world)
            value=(value@mat[:3,:3].T+mat[:3,3])*.1;evaluated.to_mesh_clear()
            matrices.append(mats);truth.append(value);samples.append({'clip':action.name,'frame':float(frame),'split':split})
matrices=np.array(matrices);truth=np.array(truth)
full=np.zeros_like(truth)
for j in range(len(bones)):
    transformed=np.einsum('tij,vj->tvi',matrices[:,j],vertices)
    full+=transformed*weights[:,j][None,:,None]
error=np.linalg.norm(full-truth,axis=2)
prefix='weight-random-data' if random_only else 'weight-fit-data'
if lynx:prefix='lynx-'+prefix
np.savez_compressed(os.path.join(folder,prefix+'.npz'),vertices=vertices,weights=weights,matrices=matrices,truth=truth,train=np.array([s['split']=='train' for s in samples]))
with open(os.path.join(folder,prefix+'.json'),'w') as f:json.dump({'boneNames':names,'samples':samples,'vertexCount':len(vertices),'scale':.1,'sourceReconstructionMaxMetres':float(error.max()),'sourceReconstructionMeanMetres':float(error.mean()),'armaturePreserveVolume':next(m.use_deform_preserve_volume for m in body.modifiers if m.type=='ARMATURE')},f,indent=2)
print(json.dumps({'samples':len(samples),'vertices':len(vertices),'sourceReconstructionMaxMetres':float(error.max())}))
