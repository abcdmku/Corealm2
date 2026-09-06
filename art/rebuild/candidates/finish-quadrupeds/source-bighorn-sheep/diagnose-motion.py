import bpy,json,pathlib,math
from mathutils import Vector
root=pathlib.Path(__file__).resolve().parent
source=root.parent/'source-caprine-free/sheepies.blend'
out=root/'motion-diagnosis';out.mkdir(exist_ok=True)
report={}
def reset(rig):
    rig.animation_data_create();rig.animation_data.action=None
    for bone in rig.pose.bones:
        bone.location=(0,0,0);bone.rotation_quaternion=(1,0,0,0);bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
for variant in ['original','original_object_parent','adapted_v3','corrected_v4']:
    file=root/'v3/bighorn-source-adaptation.blend' if variant=='adapted_v3' else root/'v4/bighorn-source-adaptation.blend' if variant=='corrected_v4' else source
    bpy.ops.wm.open_mainfile(filepath=str(file),load_ui=False,use_scripts=False)
    body=next(o for o in bpy.data.objects if o.type=='MESH' and ('whole_body' in o.name or o.name=='Sheep 2'))
    rig=body.parent;reset(rig);rig.data.pose_position='REST';bpy.context.view_layer.update()
    parent_type=body.parent_type;world=body.matrix_world.copy()
    if variant=='original_object_parent':body.parent_type='OBJECT';body.matrix_world=world;bpy.context.view_layer.update()
    relative=rig.matrix_world.inverted()@body.matrix_world
    rest=[relative@v.co for v in body.data.vertices]
    foot_ids={}
    for name in ['forearm L','forearm R','Shin L','Shin R']:
        group=body.vertex_groups.get(name)
        ids=[v.index for v in body.data.vertices if any(g.group==group.index and g.weight>.4 for g in v.groups)]
        cutoff=min(rest[i].z for i in ids)+.045
        foot_ids[name]=[i for i in ids if rest[i].z<cutoff]
    ground=min((body.matrix_world@v.co).z for v in body.data.vertices)
    scale=1 if variant in ['adapted_v3','corrected_v4'] else .6
    entry={'bodyParentTypeBefore':parent_type,'bodyParentBone':body.parent_bone,'soleVertexCounts':{n:len(ids)for n,ids in foot_ids.items()},'sourceGround':ground,'worldScaleComparison':scale,'motions':[]}
    rig.data.pose_position='POSE'
    for action in bpy.data.actions:
        reset(rig);rig.animation_data.action=action
        start,end=action.frame_range;samples=[]
        for step in range(9):
            frame=round(start+(end-start)*step/8);bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
            evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
            feet={}
            for name,ids in foot_ids.items():
                points=[evaluated.matrix_world@mesh.vertices[i].co for i in ids]
                center=sum(points,Vector())/len(points)
                feet[name]={'soleY':(min(p.z for p in points)-ground)*scale,'center':[center.x*scale,center.y*scale,(center.z-ground)*scale]}
            segments={b.name:((rig.matrix_world@b.tail)-(rig.matrix_world@b.head)).length*scale for b in rig.pose.bones if b.name in foot_ids}
            samples.append({'frame':frame,'feet':feet,'physicalBoneLengths':segments})
            evaluated.to_mesh_clear()
        entry['motions'].append({'action':action.name,'samples':samples,'soleRange':[min(f['soleY']for s in samples for f in s['feet'].values()),max(f['soleY']for s in samples for f in s['feet'].values())]})
    report[variant]=entry
(out/'original-vs-adapted.json').write_text(json.dumps(report,indent=2))
print(json.dumps({key:{'parent':value['bodyParentTypeBefore'],'motions':{m['action']:m['soleRange']for m in value['motions']}}for key,value in report.items()}))
