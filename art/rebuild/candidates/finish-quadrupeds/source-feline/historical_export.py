import bpy,json,os,sys,math,collections
from mathutils import Vector
folder=os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(folder,'cat.historical-2017.original.fbx'),use_anim=True)
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
actors=[o for o in bpy.context.scene.objects if o.type=='MESH' and len(o.data.vertices) and o.name!='Plane']
actions=[a for a in bpy.data.actions if a.name.endswith('|Walk') or a.name.endswith('|run')]
report={'source':'cat.historical-2017.original.fbx','fps':bpy.context.scene.render.fps,'armature':{'name':arm.name,'bones':len(arm.data.bones),'matrix_world':[list(row) for row in arm.matrix_world]},'meshes':[],'nativeActions':[]}
for o in actors:
    weightCounts=[];loss=[]
    for v in o.data.vertices:
        weights=sorted([g.weight for g in v.groups if g.weight>0],reverse=True)
        weightCounts.append(len(weights));loss.append(sum(weights[4:])/sum(weights) if sum(weights)>0 else 0)
    counts=collections.Counter(p.material_index for p in o.data.polygons)
    report['meshes'].append({'name':o.name,'vertices':len(o.data.vertices),'polygons':len(o.data.polygons),'parent':o.parent.name if o.parent else None,
        'materialPolygons':{o.material_slots[i].name:n for i,n in counts.items()},'boundsWorld':[[min((o.matrix_world@v.co)[i] for v in o.data.vertices) for i in range(3)],[max((o.matrix_world@v.co)[i] for v in o.data.vertices) for i in range(3)]],
        'influenceCountHistogram':dict(collections.Counter(weightCounts)),'fourWeightDiscardMaxFraction':max(loss),'fourWeightDiscardMeanFraction':sum(loss)/len(loss),
        'armatureModifiers':[{'name':m.name,'object':m.object.name if m.object else None} for m in o.modifiers if m.type=='ARMATURE']})
for action in actions:
    report['nativeActions'].append({'name':action.name,'range':list(action.frame_range),'slots':[s.identifier for s in action.slots]})
report['bones']=[{'name':b.name,'head':list(b.head_local),'tail':list(b.tail_local),'parent':b.parent.name if b.parent else None} for b in arm.data.bones]
with open(os.path.join(folder,'historical-rig-audit.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps({k:v for k,v in report.items() if k!='bones'}))
if '--compare-body' in sys.argv:
    import numpy as np
    body=next(o for o in actors if o.name=='Cat')
    old=np.array([list(v.co) for v in body.data.vertices]);oldpolys=[list(p.vertices) for p in body.data.polygons]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(folder,'cat.original.fbx'),use_anim=False)
    newbody=next(o for o in bpy.context.scene.objects if o.type=='MESH');new=np.array([list(v.co) for v in newbody.data.vertices])
    delta=np.linalg.norm(new-old,axis=1)
    comparison={'historicalVertices':len(old),'currentVertices':len(new),'polygonIndicesIdentical':oldpolys==[list(p.vertices) for p in newbody.data.polygons],
        'localPositionMaxDifferenceBlenderUnits':float(delta.max()),'localPositionMeanDifferenceBlenderUnits':float(delta.mean()),
        'historicalLocalBounds':[old.min(axis=0).tolist(),old.max(axis=0).tolist()],'currentLocalBounds':[new.min(axis=0).tolist(),new.max(axis=0).tolist()]}
    with open(os.path.join(folder,'historical-body-comparison.json'),'w') as f:json.dump(comparison,f,indent=2)
    print(json.dumps(comparison));sys.exit(0)
if '--weight-error' in sys.argv:
    import numpy as np
    body=next(o for o in actors if o.name=='Cat')
    def frame_vertices(action,frame):
        arm.animation_data.action=action
        if action.slots:arm.animation_data.action_slot=action.slots[0]
        bpy.context.scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()
        evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
        values=np.empty(len(mesh.vertices)*3,dtype=np.float64);mesh.vertices.foreach_get('co',values);values=values.reshape((-1,3))
        matrix=np.asarray(evaluated.matrix_world,dtype=np.float64);values=(values@matrix[:3,:3].T+matrix[:3,3])*.1
        evaluated.to_mesh_clear();return values
    for track in arm.animation_data.nla_tracks:track.mute=True
    frames=[(action,float(action.frame_range[0]+i*(action.frame_range[1]-action.frame_range[0])/24)) for action in actions for i in range(25)]
    original=[frame_vertices(a,f) for a,f in frames]
    weights=[sorted([(g.group,g.weight) for g in v.groups if g.weight>0],key=lambda x:-x[1])[:4] for v in body.data.vertices]
    allindices=list(range(len(body.data.vertices)))
    for group in body.vertex_groups:group.remove(allindices)
    for i,pairs in enumerate(weights):
        total=sum(w for _,w in pairs)
        for gi,w in pairs:body.vertex_groups[gi].add([i],w/total,'REPLACE')
    results=[]
    for (action,frame),before in zip(frames,original):
        after=frame_vertices(action,frame);distance=np.linalg.norm(after-before,axis=1)
        results.append({'action':action.name,'frame':frame,'maxMetres':float(distance.max()),'p95Metres':float(np.quantile(distance,.95)),'meanMetres':float(distance.mean()),'maxVertex':int(distance.argmax())})
    with open(os.path.join(folder,'historical-four-weight-error.json'),'w') as f:json.dump({'method':'Blender evaluated full original weights vs normalized top four. 25 samples per native clip; final display scale .1. In-memory experiment only; no mesh or GLB saved.','frames':results,'maxMetres':max(v['maxMetres'] for v in results)},f,indent=2)
    print('FOUR_WEIGHT_MAX_METRES',max(v['maxMetres'] for v in results));sys.exit(0)
if '--export' not in sys.argv:sys.exit(0)
# Keep native actor meshes and rig, exclude source camera, floor and empty eye.
for o in list(bpy.context.scene.objects):
    if o!=arm and o not in actors:bpy.data.objects.remove(o,do_unlink=True)
for action in list(bpy.data.actions):
    if action not in actions:bpy.data.actions.remove(action)
arm.animation_data_create();arm.animation_data.action=None
for track in list(arm.animation_data.nla_tracks):arm.animation_data.nla_tracks.remove(track)
for action in actions:
    source_name=action.name;action.name='Walk' if source_name.endswith('|Walk') else 'Run'
    track=arm.animation_data.nla_tracks.new();track.name=action.name
    strip=track.strips.new(action.name,1,action);strip.action_frame_start=action.frame_range[0];strip.action_frame_end=action.frame_range[1]
    strip.frame_start=1;strip.frame_end=1+action.frame_range[1]-action.frame_range[0]
    track.mute=True
    next(row for row in report['nativeActions'] if row['name']==source_name)['exportName']=action.name
bpy.context.scene.frame_set(1)
bpy.ops.export_scene.gltf(filepath=os.path.join(folder,'Cat.historical-native.glb'),export_format='GLB',
    export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_def_bones=True,
    export_force_sampling=True,export_frame_step=1,export_optimize_animation_size=False,export_anim_slide_to_zero=True,
    export_yup=True,export_normals=True,export_texcoords=True,export_all_vertex_colors=True,export_all_influences=True,
    export_materials='EXPORT',export_cameras=False,export_lights=False)
with open(os.path.join(folder,'historical-rig-audit.json'),'w') as f:json.dump(report,f,indent=2)
