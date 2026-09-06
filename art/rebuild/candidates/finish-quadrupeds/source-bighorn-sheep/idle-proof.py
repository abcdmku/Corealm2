import bpy,pathlib,math,json,hashlib
from mathutils import Vector
root=pathlib.Path(__file__).resolve().parent;out=root/'motion-diagnosis';out.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(root/'v4/bighorn-source-adaptation.blend'),load_ui=False,use_scripts=False)
body=next(o for o in bpy.data.objects if o.type=='MESH' and 'whole_body' in o.name);rig=body.parent
rig.animation_data_clear();rig.animation_data_create();rig.data.pose_position='POSE'
for bone in rig.pose.bones:
    bone.location=(0,0,0);bone.rotation_mode='XYZ';bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
for action in list(bpy.data.actions):bpy.data.actions.remove(action)
feet={}
for name in ['forearm L','forearm R','Shin L','Shin R']:
    g=body.vertex_groups[name]
    ids=[v.index for v in body.data.vertices if any(w.group==g.index and w.weight>.9 for w in v.groups)]
    cutoff=min(body.data.vertices[i].co.z for i in ids)+.025
    feet[name]=[i for i in ids if body.data.vertices[i].co.z<cutoff]
bpy.context.view_layer.update()
ground=min((body.matrix_world@body.data.vertices[i].co).z for ids in feet.values() for i in ids)
rig.location.z-=ground
action=bpy.data.actions.new('Idle_Calm_Authored');rig.animation_data.action=action
scene=bpy.context.scene;scene.render.fps=24;scene.frame_start=0;scene.frame_end=120
for frame in range(0,121,3):
    phase=math.tau*frame/120
    neck=rig.pose.bones['neck'];head=rig.pose.bones['HEAD']
    neck.rotation_euler=(.006*math.sin(phase),0,0)
    head.rotation_euler=(.020*math.sin(phase),.012*math.sin(phase)*math.sin(phase),.008*math.sin(phase))
    for bone in [neck,head]:bone.keyframe_insert(data_path='rotation_euler',frame=frame,group=bone.name)
samples=[];baseline={};max_slip=0;nonfinite=0;segment_delta=0;base_lengths={}
for frame in range(121):
    scene.frame_set(frame);bpy.context.view_layer.update()
    evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh();points=[evaluated.matrix_world@v.co for v in mesh.vertices]
    nonfinite+=sum(not all(math.isfinite(k)for k in p)for p in points)
    soles={}
    for name,ids in feet.items():
        positions=[points[i] for i in ids];center=sum(positions,Vector())/len(positions)
        if name not in baseline:baseline[name]=center.copy()
        delta=center-baseline[name];max_slip=max(max_slip,Vector((delta.x,delta.y,0)).length)
        soles[name]=min(p.z for p in positions)
        bone=rig.pose.bones[name];length=((rig.matrix_world@bone.tail)-(rig.matrix_world@bone.head)).length
        if name not in base_lengths:base_lengths[name]=length
        segment_delta=max(segment_delta,abs(length-base_lengths[name]))
    samples.append({'frame':frame,'weightedPhysicalSoles':soles});evaluated.to_mesh_clear()
sole_min=min(y for s in samples for y in s['weightedPhysicalSoles'].values());sole_max=max(y for s in samples for y in s['weightedPhysicalSoles'].values())
assert nonfinite==0 and max_slip<.0001 and segment_delta<.0001
assert sole_min>-.0001 and sole_max<.012, (sole_min,sole_max)
scene.frame_set(0);bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'calm-idle-proof.blend'))
bpy.ops.object.select_all(action='SELECT')
file=out/'calm-idle-proof.glb'
bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_force_sampling=True,export_frame_range=True,export_skins=True,export_def_bones=False,export_yup=True,export_apply=True,export_extras=True)
report={'action':'Idle_Calm_Authored','authored':True,'sourceActionAlias':False,'bones':len(rig.data.bones),'seconds':5,'framesSampled':121,'soleRangeMeters':[sole_min,sole_max],'maxHorizontalSoleCentroidDisplacementMeters':max_slip,'maxSegmentLengthChangeMeters':segment_delta,'physicalSegmentLengthsMeters':base_lengths,'nonfiniteVertices':nonfinite,'contactPassed':True,'productionAccepted':False,'license':'CC-BY-SA-3.0','sourceAuthor':'p0ss','texturePhotographer':'titus tscharntke','adaptationAuthor':'Corealm','sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'samples':samples}
(out/'calm-idle-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items()if k!='samples'}))
