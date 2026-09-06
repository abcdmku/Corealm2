import bpy,json,math,hashlib
from pathlib import Path
from mathutils import Matrix
out=Path('tools/rpg-bestiary/beetle-golem-source/derived');out.mkdir(exist_ok=True)
original=Path('test-results/beetle-golem-source/BeetleGolem_v3.blend')
bpy.ops.wm.open_mainfile(filepath=str(original.resolve()),load_ui=False,use_scripts=False)
rig=bpy.data.objects['Armature'];mesh=bpy.data.objects['Mesh.001'];rig.animation_data_clear();bpy.context.scene.frame_set(0)
bones=list(rig.data.bones);boneids={b.name:i+1 for i,b in enumerate(bones)}
def mat(m):return [m[r][c] for c in range(4) for r in range(4)]
def trs(m):p,q,s=m.decompose();return {'position':list(p),'quaternion':[q.x,q.y,q.z,q.w],'scale':list(s)}
result={'nodes':[{'id':0,'name':'Armature','parent':None,**trs(Matrix.Rotation(-math.pi/2,4,'X')@rig.matrix_world)}],'meshes':[],'clips':[]}
for bone in bones:result['nodes'].append({'id':boneids[bone.name],'name':bone.name,'parent':boneids[bone.parent.name] if bone.parent else 0,**trs(bone.parent.matrix_local.inverted()@bone.matrix_local if bone.parent else bone.matrix_local)})
data={'name':mesh.name,'positions':[],'normals':[],'uvs':[],'skinIndices':[],'skinWeights':[],'fullWeights':[],'sourceControlIndices':[],'joints':[boneids[b.name] for b in bones],'inverseBindMatrices':[mat((rig.matrix_world@b.matrix_local).inverted()@mesh.matrix_world) for b in bones]}
weights=[];maxLoss=0;affected=0;maxNative=0
for v in mesh.data.vertices:
 w=[(boneids[mesh.vertex_groups[g.group].name]-1,g.weight) for g in v.groups if mesh.vertex_groups[g.group].name in boneids and g.weight>1e-8];w.sort(key=lambda x:-x[1]);total=sum(x[1] for x in w);w=[(i,x/total) for i,x in w];weights.append(w);maxNative=max(maxNative,len(w));loss=sum(x[1] for x in w[4:]);maxLoss=max(maxLoss,loss);affected+=loss>1e-6
mesh.data.calc_loop_triangles();uv=mesh.data.uv_layers.active.data
for tri in mesh.data.loop_triangles:
 for loop in tri.loops:
  vi=mesh.data.loops[loop].vertex_index;data['sourceControlIndices'].append(vi);v=mesh.data.vertices[vi];w=weights[vi];top=w[:4];total=sum(x[1] for x in top);data['positions'].extend(v.co);data['normals'].extend(mesh.data.corner_normals[loop].vector);data['uvs'].extend(uv[loop].uv);data['fullWeights'].append(w);data['skinIndices'].extend([x[0] for x in top]+[0]*(4-len(top)));data['skinWeights'].extend([x[1]/total for x in top]+[0]*(4-len(top)))
result['meshes'].append(data)
rig.animation_data_create()
for action in list(bpy.data.actions):
 if action.name=='OLD_AnimationLine':continue
 rig.animation_data.action=action
 if action.slots:rig.animation_data.action_slot=action.slots[0]
 start,end=action.frame_range;count=math.ceil((end-start)*2);times=[(end-start)*i/count/24 for i in range(count+1)];tracks=[{'node':boneids[b.name],'position':[],'quaternion':[],'scale':[]} for b in bones]
 for t in times:
  frame=start+t*24;bpy.context.scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame));bpy.context.view_layer.update()
  for b,track in zip(bones,tracks):
   pb=rig.pose.bones[b.name];local=pb.parent.matrix.inverted()@pb.matrix if pb.parent else pb.matrix;values=trs(local)
   for k in ['position','quaternion','scale']:track[k].extend(values[k])
 result['clips'].append({'name':action.name,'firstFrame':start,'lastFrame':end,'fps':24,'sampleFps':48,'times':times,'tracks':tracks})
result['nativeSamples']=[]
for actionName in ['Idle_Normal','Walk','Attack1','Hurt1','Hurt2','Death']:
 action=bpy.data.actions[actionName];rig.animation_data.action=action
 if action.slots:rig.animation_data.action_slot=action.slots[0]
 start,end=action.frame_range
 for frame in [start,(start+end)/2,end]:
  bpy.context.scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame));bpy.context.view_layer.update();evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());em=evaluated.to_mesh();matrix=Matrix.Rotation(-math.pi/2,4,'X')@mesh.matrix_world
  result['nativeSamples'].append({'action':actionName,'time':(frame-start)/24,'positions':[list(matrix@v.co) for v in em.vertices]});evaluated.to_mesh_clear()
result['weightReduction']={'sourceMaximum':maxNative,'runtimeMaximum':4,'maxDiscardedFraction':maxLoss,'affectedControlVertices':affected}
result['sourceFiles']=[{'file':str(original),'sha256':hashlib.sha256(original.read_bytes()).hexdigest()}]
result['sourceFacts']={'controlVertices':len(mesh.data.vertices),'triangles':len(mesh.data.loop_triangles),'bones':len(bones),'armaturePreserveVolume':mesh.modifiers[0].use_deform_preserve_volume,'animationNames':[a.name for a in bpy.data.actions]}
(out/'source.json').write_text(json.dumps(result,separators=(',',':')))
print(json.dumps({'facts':result['sourceFacts'],'weights':result['weightReduction']}))
