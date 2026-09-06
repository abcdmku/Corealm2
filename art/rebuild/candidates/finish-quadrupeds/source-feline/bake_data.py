"""CPU-only source sampling and corner attributes; never changes source files."""
import bpy,os,sys,json,numpy as np
from mathutils.bvhtree import BVHTree
folder=os.path.dirname(os.path.abspath(__file__));lynx='--lynx' in sys.argv
sys.path.insert(0,folder)
from lynx_adaptation import adapt_cat
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(folder,'cat.historical-2017.original.fbx'),use_anim=True)
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');body=bpy.data.objects['Cat']
for track in arm.animation_data.nla_tracks:track.mute=True
actions=[a for a in bpy.data.actions if a.name.endswith('|Walk') or a.name.endswith('|run')]
bones=list(arm.data.bones);names=[b.name for b in bones];lookup={n:i for i,n in enumerate(names)}
base=np.asarray(arm.matrix_world,dtype=float);bodyworld=np.asarray(body.matrix_world,dtype=float)
# Source matrices already include .1 display scale and evaluated object tracks.
# Native actions replace the FBX scene-placement transform; do not apply inverse
# of the unevaluated imported armature transform a second time.
C=np.array([[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]],float)
normalize=C
arm.animation_data.action=None;arm.data.pose_position='REST';bpy.context.view_layer.update()
eyeproof=[]
for eye in [bpy.data.objects['Sphere'],bpy.data.objects['Sphere.001']]:
    original=[v.co.copy() for v in eye.data.vertices]
    modifier=eye.modifiers.new('Source eye tessellation reduction','DECIMATE');modifier.ratio=.04
    bpy.context.view_layer.objects.active=eye
    # Only apply the new decimator; leave the original armature binding in place.
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    tree=BVHTree.FromPolygons([v.co for v in eye.data.vertices],[p.vertices[:] for p in eye.data.polygons])
    distances=[tree.find_nearest(p)[3] for p in original]
    eyeproof.append({'name':eye.name,'oldVertices':len(original),'vertices':len(eye.data.vertices),'triangles':sum(len(p.vertices)-2 for p in eye.data.polygons),'oneWaySurfaceMaxMmAtPointOneScale':max(distances)*100,'method':'Every original vertex to nearest reduced triangle. Reverse surface error and hardware silhouette remain separate checks.'})
def extract(obj):
    mesh=obj.data;mesh.update();mesh.calc_loop_triangles();relative=np.linalg.inv(bodyworld)@np.asarray(obj.matrix_world)
    verts=np.array([list(v.co) for v in mesh.vertices]);verts=verts@relative[:3,:3].T+relative[:3,3]
    weights=np.zeros((len(verts),len(bones)))
    for vertex in mesh.vertices:
        for g in vertex.groups:
            name=obj.vertex_groups[g.group].name
            if name in lookup:weights[vertex.index,lookup[name]]=g.weight
    weights/=weights.sum(axis=1,keepdims=True)
    ids=np.array([mesh.loops[li].vertex_index for t in mesh.loop_triangles for li in t.loops])
    uv=mesh.uv_layers.active
    uvs=np.array([list(uv.data[li].uv) if uv else [0,0] for t in mesh.loop_triangles for li in t.loops])
    normals=np.array([list(mesh.corner_normals[li].vector) for t in mesh.loop_triangles for li in t.loops]);normals=normals@np.linalg.inv(relative[:3,:3])
    lengths=np.linalg.norm(normals,axis=1);bad=lengths<1e-12
    if bad.any():
        face=np.cross(verts[ids.reshape(-1,3)[:,1]]-verts[ids.reshape(-1,3)[:,0]],verts[ids.reshape(-1,3)[:,2]]-verts[ids.reshape(-1,3)[:,0]])
        face/=np.maximum(np.linalg.norm(face,axis=1,keepdims=True),1e-15);normals[bad]=np.repeat(face,3,axis=0)[bad]
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-15)
    return {'positions':verts,'cornerIds':ids,'normals':normals,'uvs':uvs,'weights':weights}
geometry={o.name:extract(o) for o in [body,bpy.data.objects['Sphere'],bpy.data.objects['Sphere.001']]}
adapted=adapt_cat(body,arm,apply_coat=True,adapt_rest_rig=lynx,native_motion_rebake_authorized=lynx)
bones=list(arm.data.bones)
geometry['Lynx']=extract(body)
geometry['Lynx']['colors']=np.array([list(c.color) for c in body.data.color_attributes['LynxCoat'].data])
if lynx:geometry['Cat']=geometry['Lynx']
# Restore original mesh for source sampling; no file is saved.
for vertex,p in zip(body.data.vertices,geometry['Cat']['positions']):vertex.co=p
arm.data.pose_position='POSE';bpy.context.view_layer.update()
matrices=[];samples=[];inverse_rest=[b.matrix_local.inverted() for b in bones]
for action in actions:
    arm.animation_data.action=action
    if action.slots:arm.animation_data.action_slot=action.slots[0]
    first,last=map(float,action.frame_range)
    for frame in np.arange(first,last+.001,.125):
        bpy.context.scene.frame_set(int(frame),subframe=float(frame-int(frame)));bpy.context.view_layer.update()
        world=arm.matrix_world;local=world.inverted()@body.matrix_world
        mats=np.array([np.asarray(world@arm.pose.bones[b.name].matrix@inverse_rest[i]@local,dtype=float)[:3,:]*.1 for i,b in enumerate(bones)])
        matrices.append(mats);samples.append({'clip':'Walk' if action.name.endswith('|Walk') else 'Run','frame':float(frame),'time':float((frame-1)/24)})
arrays={'matrices':np.array(matrices),'normalize':normalize,'tailWeights':np.array(adapted['tail_weights'])}
for name,values in geometry.items():
    for key,value in values.items():arrays[name+'_'+key]=value
prefix='lynx-bake-data' if lynx else 'bake-data'
np.savez_compressed(os.path.join(folder,prefix+'.npz'),**arrays)
with open(os.path.join(folder,prefix+'.json'),'w') as f:json.dump({'boneNames':names,'samples':samples,'eyes':eyeproof,'sourceSceneRemoved':True,'displayScale':.1,'geometrySpace':'Original body-local; output skin matrices map to normalized Y-up at .1 scale.','samplingFps':192,'adaptation':{k:v for k,v in adapted.items() if k not in ['warp','tail_weights']}},f,indent=2)
print(json.dumps({'samples':len(samples),'eyes':eyeproof}))
