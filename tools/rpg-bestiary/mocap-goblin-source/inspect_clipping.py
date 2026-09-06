"""CPU triangle intersections between the source knife and torso/head, excluding its grip."""
import bpy, json, math
from pathlib import Path
from mathutils.bvhtree import BVHTree
bpy.ops.wm.open_mainfile(filepath=str(Path('test-results/fantasy-collection-source/goblin-animated-by-motion-capture/Goblin.blend').resolve()),load_ui=False,use_scripts=False)
rig=bpy.data.objects['GoblinArmature'];mesh=bpy.data.objects['Goblin']
strips=[{'name':s.name,'action':s.action.name,'start':s.action_frame_start,'end':s.action_frame_end} for t in rig.animation_data.nla_tracks for s in t.strips if s.name in ['Idle','Walk','Flee','Attack1','Attack2','Die']]
rig.animation_data_clear();rig.animation_data_create()
torso={'Hips','LowerBack','Spine','Spine1','Neck','Neck1','Head'}
dominant=[]
for vertex in mesh.data.vertices:
    groups=[g for g in vertex.groups if mesh.vertex_groups[g.group].name in rig.data.bones]
    dominant.append(mesh.vertex_groups[max(groups,key=lambda g:g.weight).group].name)
results=[]
for strip in strips:
    action=bpy.data.actions[strip['action']];rig.animation_data.action=action
    if action.slots:rig.animation_data.action_slot=action.slots[0]
    rows=[]
    for i in range(25):
        phase=i/24;frame=strip['start']+(strip['end']-strip['start'])*phase
        bpy.context.scene.frame_set(math.floor(frame),subframe=frame%1);bpy.context.view_layer.update()
        evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());geometry=evaluated.to_mesh();geometry.calc_loop_triangles()
        positions=[v.co.copy() for v in geometry.vertices]
        knife=[tuple(t.vertices) for t in geometry.loop_triangles if t.material_index==1]
        body=[tuple(t.vertices) for t in geometry.loop_triangles if t.material_index==0 and all(dominant[v] in torso for v in t.vertices)]
        overlaps=BVHTree.FromPolygons(positions,knife,all_triangles=True).overlap(BVHTree.FromPolygons(positions,body,all_triangles=True))
        rows.append({'phase':phase,'sourceFrame':frame,'knifeTorsoTriangleIntersections':len(overlaps)})
        evaluated.to_mesh_clear()
    results.append({'clip':strip['name'],'samples':rows})
report={'method':'Native evaluated source triangles, knife material vs body faces fully weighted primarily to torso/head bones. Excludes hand grip. 25 evenly spaced source samples per clip. Zero crossings would not prove no other self-clipping.','clips':results}
out=Path('test-results/mocap-goblin-source');out.mkdir(parents=True,exist_ok=True);(out/'clipping.json').write_text(json.dumps(report,indent=2))
print(json.dumps([{'clip':r['clip'],'maximumKnifeTorsoIntersections':max(s['knifeTorsoTriangleIntersections'] for s in r['samples']),'affectedSamples':sum(s['knifeTorsoTriangleIntersections']>0 for s in r['samples'])} for r in results]))
