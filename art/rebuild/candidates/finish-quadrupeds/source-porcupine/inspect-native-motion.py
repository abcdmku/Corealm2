import bpy, pathlib, json, hashlib, math, time
import numpy as np

out=pathlib.Path(__file__).resolve().parent
source=out/'cdmir-rat-original.blend'
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
arm=bpy.data.objects['Armature'];body_names=['Body','Head','Eyes','Teeth']
fps=bpy.context.scene.render.fps/bpy.context.scene.render.fps_base
initial_basis={b.name:b.matrix_basis.copy() for b in arm.pose.bones}
initial_arm_basis=arm.matrix_basis.copy()
start_time=time.monotonic()

def points(obj,evaluate=True):
    ev=obj.evaluated_get(bpy.context.evaluated_depsgraph_get()) if evaluate else obj
    mesh=ev.to_mesh() if evaluate else obj.data
    local=np.empty(len(mesh.vertices)*3,dtype=np.float64)
    mesh.vertices.foreach_get('co',local);local=local.reshape((-1,3))
    matrix=np.array(ev.matrix_world,dtype=float)
    world=local@matrix[:3,:3].T+matrix[:3,3]
    if evaluate:ev.to_mesh_clear()
    return world

def snapshot(names):
    result={};arrays={}
    for name in names:
        data=points(bpy.data.objects[name]);arrays[name]=data
        finite=np.isfinite(data)
        result[name]={'vertices':len(data),'nonfiniteValues':int((~finite).sum()),'min':data.min(axis=0).tolist(),'max':data.max(axis=0).tolist()}
    return result,arrays

def frame_at(frame):
    whole=math.floor(frame);bpy.context.scene.frame_set(whole,subframe=frame-whole)
    bpy.context.view_layer.update()

reports=[]
for action in list(bpy.data.actions):
    arm.matrix_basis=initial_arm_basis.copy()
    for bone in arm.pose.bones:bone.matrix_basis=initial_basis[bone.name]
    arm.animation_data.action=action
    lo,hi=map(float,action.frame_range)
    # All source integer frames, all keyed times, and half-frame samples for
    # ordinary clips. The1553-frame Idle.000 is sampled at every native frame.
    step=.5 if hi-lo<=100 else 1
    sample_frames=set(float(x) for f in action.fcurves for x in [k.co.x for k in f.keyframe_points] if lo<=x<=hi)
    sample_frames.update(lo+i*step for i in range(math.floor((hi-lo)/step)+1));sample_frames.add(hi)
    series=[];first=None;peak={n:0. for n in body_names};invalid=0
    path_errors=[]
    for curve in action.fcurves:
        try:arm.path_resolve(curve.data_path)
        except Exception:path_errors.append(curve.data_path)
    for frame in sorted(sample_frames):
        if time.monotonic()-start_time>170:raise RuntimeError('Native motion inspection exceeded170s budget')
        frame_at(frame);bounds,arrays=snapshot(body_names)
        if first is None:first={n:a.copy() for n,a in arrays.items()}
        for name,data in arrays.items():
            if data.shape==first[name].shape:peak[name]=max(peak[name],float(np.linalg.norm(data-first[name],axis=1).max()))
        invalid+=sum(b['nonfiniteValues'] for b in bounds.values())
        series.append({'frame':frame,'seconds':(frame-lo)/fps,'meshes':bounds})
    all_min=np.array([sample['meshes'][n]['min'] for sample in series for n in body_names]).min(axis=0)
    all_max=np.array([sample['meshes'][n]['max'] for sample in series for n in body_names]).max(axis=0)
    reports.append({'name':action.name,'sourceFrames':[lo,hi],'fps':fps,'durationSeconds':(hi-lo)/fps,'sampleCount':len(series),'samplingStepFrames':step,'fcurveCount':len(action.fcurves),'unresolvedPaths':sorted(set(path_errors)),'nonfiniteValues':invalid,'peakVertexDisplacementFromFirstFrame':peak,'clipBounds':{'min':all_min.tolist(),'max':all_max.tolist()},'observedDeformation':max(peak.values())>1e-5,'samples':series})
    print(json.dumps({k:reports[-1][k] for k in ['name','durationSeconds','sampleCount','nonfiniteValues','peakVertexDisplacementFromFirstFrame','unresolvedPaths']}),flush=True)

# Hair diagnostics are measured independently, never included in body bounds.
arm.animation_data.action=bpy.data.actions['Stand'];frame_at(0)
hair=bpy.data.objects['Hair'];diagnostic={'localHidden':hair.hide_get(),'hideRender':hair.hide_render,'hideViewport':hair.hide_viewport,'scale':list(hair.scale),'matrixWorld':[list(r) for r in hair.matrix_world],'parentInverse':[list(r) for r in hair.matrix_parent_inverse],'modifiers':[{'name':m.name,'type':m.type,'target':getattr(m,'object',None).name if getattr(m,'object',None) else None} for m in hair.modifiers]}
for mode in ['RAW','REST','POSE']:
    if mode!='RAW':arm.data.pose_position=mode;frame_at(0)
    data=points(hair,evaluate=mode!='RAW')
    diagnostic[mode.lower()]={'vertices':len(data),'min':data.min(axis=0).tolist(),'max':data.max(axis=0).tolist(),'nonfiniteValues':int((~np.isfinite(data)).sum())}
weights=[];missing=set();bad_weights=0
for vertex in hair.data.vertices:
    total=sum(g.weight for g in vertex.groups);weights.append(total)
    for group in vertex.groups:
        if not math.isfinite(group.weight) or group.weight<0:bad_weights+=1
        name=hair.vertex_groups[group.group].name
        if name not in arm.data.bones:missing.add(name)
diagnostic['weights']={'vertices':len(weights),'sumMin':min(weights),'sumMax':max(weights),'nonfiniteOrNegative':bad_weights,'missingBoneGroups':sorted(missing)}
diagnostic['sourceVisibility']={'visible':hair.visible_get(),'collections':[{'name':c.name,'hideViewport':c.hide_viewport,'hideRender':c.hide_render} for c in hair.users_collection],'matrixBasis':[list(r) for r in hair.matrix_basis]}
layers=[]
def reveal(layer):
    layers.append({'name':layer.name,'excluded':layer.exclude,'hideViewport':layer.hide_viewport})
    layer.exclude=False;layer.hide_viewport=False;layer.collection.hide_viewport=False
    for child in layer.children:reveal(child)
reveal(bpy.context.view_layer.layer_collection)
diagnostic['originalLayerVisibility']=layers
hair.hide_set(False);arm.data.pose_position='POSE';frame_at(0)
diagnostic['temporaryVisibilityOnlyInspection']={}
for mode in ['RAW','REST','POSE']:
    if mode!='RAW':arm.data.pose_position=mode;frame_at(0)
    data=points(hair,evaluate=mode!='RAW')
    diagnostic['temporaryVisibilityOnlyInspection'][mode.lower()]={'vertices':len(data),'min':data.min(axis=0).tolist(),'max':data.max(axis=0).tolist(),'nonfiniteValues':int((~np.isfinite(data)).sum())}
diagnostic['temporaryVisibilityOnlyInspection']['matrixWorld']=[list(r) for r in hair.matrix_world]
diagnostic['interpretation']='Original Hair belongs to an invisible collection. Original world matrix was identity despite nonidentity authored matrix_basis, so the initial oversized bounds are stale disabled-collection evaluation. Temporary visibility-only results measure its actual raw/rest/posed size. No mesh, rig, weight or transform repair was applied, and no Blender file was saved.'
report={'source':source.name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'blender':bpy.app.version_string,'fps':fps,'units':'Original Blender units, Z up. No normalized preview transform.','bodyObjects':body_names,'excludedObjects':['Hair','Plane','Plane.001','Camera','Hemi','Lamp','Sun'],'method':'Original action assigned to original armature for evaluation only; all native constraints, rig, mesh, material and child-object animation data preserved. Reset pose basis to original state between actions. No source file saved. Every integer frame plus keys sampled, half frames added for <=100-frame clips.','limits':['Finite deformation is not gameplay acceptance or visual motion quality.','Contact is not judged from whole-mesh extrema, and no grounding corrections are applied.','Native action names are retained; no retargeting, clip mapping or porcupine adaptation performed.'], 'actions':reports,'hairDiagnostic':diagnostic,'elapsedSeconds':time.monotonic()-start_time}
(out/'native-motion-inspection.json').write_text(json.dumps(report,indent=2,allow_nan=False))
print(json.dumps({'complete':True,'actions':len(reports),'samples':sum(a['sampleCount'] for a in reports),'hairDiagnostic':diagnostic,'elapsedSeconds':report['elapsedSeconds']}),flush=True)
