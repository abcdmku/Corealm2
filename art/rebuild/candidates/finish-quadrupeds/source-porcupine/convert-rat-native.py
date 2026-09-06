"""Faithful native-rat export with measured four-weight and interpolation error.
Read-only Blender source. No bpy save or modifications to frozen preview files.
"""
import bpy, pathlib, json, hashlib, struct, math, itertools, time
import numpy as np
from mathutils import Matrix, Vector

OUT=pathlib.Path(__file__).resolve().parent
SRC=OUT/'cdmir-rat-original.blend'
started=time.monotonic()
bpy.ops.wm.open_mainfile(filepath=str(SRC),load_ui=False,use_scripts=False)
arm=bpy.data.objects['Armature']; scene=bpy.context.scene
fps=scene.render.fps/scene.render.fps_base
original_basis={b.name:b.matrix_basis.copy() for b in arm.pose.bones}
original_arm=arm.matrix_basis.copy()
SCALE=.24083059
THRESHOLD=.001/SCALE
names=['Body','Head','Eyes','Teeth']
def frame_at(f):
    scene.frame_set(math.floor(f),subframe=f-math.floor(f));bpy.context.view_layer.update()
arm.animation_data.action=bpy.data.actions['Stand'];frame_at(0)
bones=[b for b in arm.data.bones if b.use_deform]
joints=[];bone_joints={}
for b in bones:
    ids=[]
    for seg in range(b.bbone_segments+1) if b.bbone_segments>1 else [None]:
        rest=b.matrix_local.copy()
        if seg is not None:rest=rest @ arm.pose.bones[b.name].bbone_segment_matrix(seg,rest=True)
        ids.append(len(joints))
        joints.append(dict(name=b.name if seg is None else b.name+'__segment_'+str(seg),source=b.name,segment=seg,rest=arm.matrix_world @ rest))
    bone_joints[b.name]=ids
records={}
for name in names:
    obj=bpy.data.objects[name];world=obj.matrix_world.copy()
    p=np.array([list(world @ v.co) for v in obj.data.vertices])
    w=np.zeros((len(p),len(joints)))
    for v in obj.data.vertices:
        valid=[(obj.vertex_groups[g.group].name,g.weight) for g in v.groups if obj.vertex_groups[g.group].name in bone_joints and g.weight>0]
        total=sum(x[1] for x in valid)
        if total<=0:raise RuntimeError('Unweighted vertex '+name+str(v.index))
        for bn,weight in valid:
            ids=bone_joints[bn]
            if len(ids)==1:w[v.index,ids[0]]+=weight/total
            else:
                point=arm.matrix_world.inverted() @ world @ v.co
                i,t=arm.pose.bones[bn].bbone_segment_index(point)
                w[v.index,ids[i]]+=weight/total*(1-t);w[v.index,ids[i+1]]+=weight/total*t
    normal_matrix=np.linalg.inv(np.array(world)[:3,:3]).T
    normals=np.array([normal_matrix@np.array(v.normal) for v in obj.data.vertices]);normals/=np.maximum(1e-12,np.linalg.norm(normals,axis=1))[:,None]
    records[name]=dict(obj=obj,p=p,w=w,world=world,restNormals=normals,sourceWeights=[[[obj.vertex_groups[g.group].name,float(g.weight)] for g in v.groups if g.weight>0] for v in obj.data.vertices])

def eval_pose():
    deps=bpy.context.evaluated_depsgraph_get();ae=arm.evaluated_get(deps)
    jm=[]
    for j in joints:
        pb=ae.pose.bones[j['source']];m=ae.matrix_world @ pb.matrix
        if j['segment'] is not None:m=m @ pb.bbone_segment_matrix(j['segment'],rest=False)
        jm.append(np.array(m))
    actual={}
    for name,r in records.items():
        ev=r['obj'].evaluated_get(deps);mesh=ev.to_mesh();mw=np.array(ev.matrix_world)
        p=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('co',p);p=p.reshape(-1,3);actual[name]=p@mw[:3,:3].T+mw[:3,3]
        nm=np.linalg.inv(mw[:3,:3]).T;normals=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('normal',normals);normals=normals.reshape(-1,3)@nm.T;normals/=np.maximum(1e-12,np.linalg.norm(normals,axis=1))[:,None];r['evaluatedNormals']=normals
        corner=np.empty(len(mesh.corner_normals)*3);mesh.corner_normals.foreach_get('vector',corner);corner=corner.reshape(-1,3)@nm.T;corner/=np.maximum(1e-12,np.linalg.norm(corner,axis=1))[:,None];r['evaluatedCornerNormals']=corner
        ev.to_mesh_clear()
    return np.array(jm),actual

def set_action(action):
    arm.matrix_basis=original_arm.copy()
    for b in arm.pose.bones:b.matrix_basis=original_basis[b.name]
    arm.animation_data.action=action

fit_m=[];fit_points={n:[] for n in names};fit_sample=[]
actions=list(bpy.data.actions)
for action in actions:
    set_action(action);lo,hi=map(float,action.frame_range)
    for idx,f in enumerate(np.linspace(lo,hi,33)):
        frame_at(float(f));jm,actual=eval_pose();fit_m.append(jm)
        for n in names:fit_points[n].append(actual[n])
        fit_sample.append(dict(action=action.name,frame=float(f),fit=idx%2==0))
fit_m=np.array(fit_m);fitmask=np.array([s['fit'] for s in fit_sample]);invrest=np.array([np.linalg.inv(np.array(j['rest'])) for j in joints])
deforms=fit_m@invrest
export_fit=np.array([[np.array(Matrix.LocRotScale(*Matrix(m.tolist()).decompose())) for m in frame] for frame in fit_m])
export_deforms=export_fit@invrest
def stats(e):
    return dict(maxSourceUnits=float(e.max()),rmsSourceUnits=float(np.sqrt(np.mean(e**2))),maxNormalizedMm=float(e.max()*SCALE*1000),rmsNormalizedMm=float(np.sqrt(np.mean(e**2))*SCALE*1000))
def support_solve(A,y,s):
    a=A[:,s];k=len(s);m=np.empty((k+1,k+1));m[:k,:k]=a.T@a;m[k,:k]=1;m[:k,k]=1;m[k,k]=0
    z=np.linalg.lstsq(m,np.r_[a.T@y,1.],rcond=1e-12)[0][:k]
    if z.min() < -1e-8:return None
    z=np.maximum(z,0);return z/z.sum()
audit={};correctives=[]
for name,r in records.items():
    p4=np.c_[r['p'],np.ones(len(r['p']))]
    traj=np.einsum('sjab,vb->svja',deforms,p4)[:,:,:,:3]
    actual=np.array(fit_points[name]);full=np.einsum('svjc,vj->svc',traj,r['w'])
    reconstruction=np.linalg.norm(full-actual,axis=2)
    if reconstruction.max()>2e-5:raise RuntimeError('Segment reconstruction mismatch '+name+' '+str(stats(reconstruction)))
    # Optimize against actual exportable joint TRS, including any source shear loss.
    traj=np.einsum('sjab,vb->svja',export_deforms,p4)[:,:,:,:3]
    top=np.argsort(-r['w'],axis=1)[:,:4];w4=np.zeros_like(r['w']);np.put_along_axis(w4,top,np.take_along_axis(r['w'],top,axis=1),axis=1);w4/=w4.sum(axis=1)[:,None]
    base=np.einsum('svjc,vj->svc',traj,w4);before=np.linalg.norm(base-actual,axis=2)
    changed=0
    for vi in np.where((r['w']>0).sum(axis=1)>4)[0]:
        cand=np.where(r['w'][vi]>0)[0].tolist();origin=traj[fitmask,vi,cand[0],:]
        A=(traj[fitmask,vi,:,:]-origin[:,None,:]).transpose(0,2,1).reshape(-1,len(joints));y=(actual[fitmask,vi,:]-origin).reshape(-1)
        best=w4[vi].copy();loss=float(np.mean((A@best-y)**2))
        for count in range(1,5):
            for support in itertools.combinations(cand,count):
                sw=support_solve(A,y,list(support))
                if sw is None:continue
                err=float(np.mean((A[:,support]@sw-y)**2))
                if err<loss:loss=err;best=np.zeros(len(joints));best[list(support)]=sw
        trial=np.linalg.norm(traj[:,vi].transpose(0,2,1)@best-actual[:,vi],axis=1)
        if trial.max()<=before[:,vi].max()+1e-8 and np.mean(trial[~fitmask]**2)<np.mean(before[~fitmask,vi]**2):w4[vi]=best;changed+=1
    error=np.linalg.norm(np.einsum('svjc,vj->svc',traj,w4)-actual,axis=2)
    correction_indices=np.where(error.max(axis=0)>THRESHOLD)[0]
    for vi in correction_indices:correctives.append(dict(name='correct_'+name+'_'+str(vi),object=name,vertex=int(vi),joint=len(joints)+len(correctives)))
    r['w4']=w4
    audit[name]=dict(vertices=len(r['p']),expandedInfluenceMax=int((r['w']>0).sum(axis=1).max()),verticesAboveFour=int(((r['w']>0).sum(axis=1)>4).sum()),optimizedVertices=changed,correctiveVertices=len(correction_indices),faithfulReconstruction=stats(reconstruction),topFour=stats(before),optimizedFour=stats(error),optimizedFourHeldOut=stats(error[~fitmask]))
    print(json.dumps({name:audit[name]}),flush=True)

# Preserve source mesh coordinates in world space; root alone converts Z-up to Y-up.
# Corrective joints use an identity bind and translation of that source vertex.
total_joints=len(joints)+len(correctives)
for n,r in records.items():
    r['weights']=np.pad(r['w4'],((0,0),(0,len(correctives))))
for c in correctives:
    w=records[c['object']]['weights'];w[c['vertex']]=0;w[c['vertex'],c['joint']]=1
for r in records.values():
    r['ids']=np.argsort(-r['weights'],axis=1)[:,:4]
    r['four']=np.take_along_axis(r['weights'],r['ids'],axis=1)
    r['p4']=np.c_[r['p'],np.ones(len(r['p']))]
def predict(matrices,r):
    return np.einsum('vkab,vb,vk->va',matrices[r['ids']],r['p4'],r['four'])[:,:3]

blob=bytearray();gltf=dict(asset=dict(version='2.0',generator='Corealm native source motion preservation audit'),scene=0,scenes=[dict(nodes=[0])],nodes=[dict(name='NativeRatZUpToYUp',rotation=[-math.sqrt(.5),0,0,math.sqrt(.5)],children=[])],buffers=[dict(byteLength=0)],bufferViews=[],accessors=[],meshes=[],materials=[],images=[],textures=[],samplers=[dict(magFilter=9729,minFilter=9987,wrapS=10497,wrapT=10497)],skins=[],animations=[])
def view(data):
    while len(blob)%4:blob.append(0)
    offset=len(blob);blob.extend(data);i=len(gltf['bufferViews']);gltf['bufferViews'].append(dict(buffer=0,byteOffset=offset,byteLength=len(data)));return i
def access(a,typ,component=5126,bounds=False):
    dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[component];a=np.asarray(a,dtype=dtype);v=view(a.tobytes());entry=dict(bufferView=v,componentType=component,count=len(a),type=typ)
    if bounds:entry.update(min=a.min(axis=0).reshape(-1).astype(float).tolist(),max=a.max(axis=0).reshape(-1).astype(float).tolist())
    i=len(gltf['accessors']);gltf['accessors'].append(entry);return i
texture_ids={}
def texture(name):
    if name in texture_ids:return texture_ids[name]
    im=bpy.data.images[name]
    if not im.packed_file:raise RuntimeError('Expected packed source texture '+name)
    data=bytes(im.packed_file.data);mime='image/png' if data[:8]==b'\x89PNG\r\n\x1a\n' else 'image/jpeg' if data[:2]==b'\xff\xd8' else None
    if not mime:raise RuntimeError('Unsupported packed texture '+name)
    ii=len(gltf['images']);gltf['images'].append(dict(name=name,bufferView=view(data),mimeType=mime));ti=len(gltf['textures']);gltf['textures'].append(dict(source=ii,sampler=0));texture_ids[name]=ti;return ti
material_ids={}
for n,r in records.items():
    for slot in r['obj'].material_slots:
        mat=slot.material
        if not mat or mat.name in material_ids:continue
        albedo={'body':'rat-body','head':'rat-head','head.001':'rat-head'}.get(mat.name)
        pbr=dict(metallicFactor=0,roughnessFactor=.82,baseColorFactor=[*list(mat.diffuse_color[:3]),1.])
        entry=dict(name=mat.name,pbrMetallicRoughness=pbr,doubleSided=False)
        if albedo:
            pbr['baseColorFactor']=[1,1,1,1];pbr['baseColorTexture']=dict(index=texture(albedo));entry['normalTexture']=dict(index=texture(albedo+'-Normalmap.png'))
        material_ids[mat.name]=len(gltf['materials']);gltf['materials'].append(entry)

joint_nodes=[]
for j in joints:
    loc,rot,scale=j['rest'].decompose();idx=len(gltf['nodes']);joint_nodes.append(idx);gltf['nodes'][0]['children'].append(idx)
    gltf['nodes'].append(dict(name=j['name'],translation=list(loc),rotation=[rot.x,rot.y,rot.z,rot.w],scale=list(scale)))
for c in correctives:
    idx=len(gltf['nodes']);joint_nodes.append(idx);gltf['nodes'][0]['children'].append(idx);gltf['nodes'].append(dict(name=c['name'],translation=[0,0,0]))
ibm=np.concatenate([invrest,np.tile(np.eye(4),(len(correctives),1,1))])
gltf['skins'].append(dict(name='NativeRatLinearizedSkin',joints=joint_nodes,inverseBindMatrices=access(ibm.transpose(0,2,1).reshape(-1,16),'MAT4'),skeleton=0))
topology={}
for n,r in records.items():
    mesh=r['obj'].data;mesh.calc_loop_triangles();uv=mesh.uv_layers.active
    if uv is None:raise RuntimeError('Missing UV '+n)
    normal_mat=np.linalg.inv(np.array(r['world'])[:3,:3]).T
    primitives=[];skipped=0;drawn=0
    for matidx,slot in enumerate(r['obj'].material_slots):
        positions=[];normals=[];uvs=[];indices=[];jidx=[];weights=[];source_indices=[];source_loops=[];lookup={}
        for tri in mesh.loop_triangles:
            if tri.material_index!=matidx:continue
            if len(set(tri.vertices))<3:skipped+=1;continue
            for li in tri.loops:
                loop=mesh.loops[li];vi=loop.vertex_index;normal=normal_mat@np.array(mesh.corner_normals[li].vector);normal/=max(1e-12,np.linalg.norm(normal));tc=uv.data[li].uv
                key=(vi,tuple(normal),tuple(tc))
                if key not in lookup:
                    lookup[key]=len(positions);positions.append(r['p'][vi]);source_indices.append(vi);source_loops.append(li);normals.append(normal);uvs.append([tc.x,1-tc.y]);ids=np.argsort(-r['weights'][vi])[:4];ww=r['weights'][vi,ids];ww/=ww.sum();jidx.append(ids);weights.append(ww)
                indices.append(lookup[key])
            drawn+=1
        if indices:primitives.append(dict(attributes=dict(POSITION=access(positions,'VEC3',bounds=True),NORMAL=access(normals,'VEC3'),TEXCOORD_0=access(uvs,'VEC2'),JOINTS_0=access(jidx,'VEC4',5123),WEIGHTS_0=access(weights,'VEC4')),indices=access(indices,'SCALAR',5125),material=material_ids[slot.material.name],mode=4,extras=dict(sourceObject=n,sourceVertexIndices=source_indices,sourceLoopIndices=source_loops)))
    mi=len(gltf['meshes']);gltf['meshes'].append(dict(name=n,primitives=primitives));ni=len(gltf['nodes']);gltf['nodes'].append(dict(name=n,mesh=mi,skin=0));gltf['nodes'][0]['children'].append(ni)
    topology[n]=dict(sourceVertices=len(mesh.vertices),sourceTriangles=len(mesh.loop_triangles),exportedTriangles=drawn,skippedRepeatedIndexTriangles=skipped,exportedVertices=sum(gltf['accessors'][p['attributes']['POSITION']]['count'] for p in primitives))

def trs(m):
    loc,rot,scale=Matrix(m.tolist()).decompose();return np.array(loc),np.array([rot.x,rot.y,rot.z,rot.w]),np.array(scale)
def matrix_trs(t,q,s):
    from mathutils import Quaternion
    return np.array(Matrix.LocRotScale(Vector(t),Quaternion([q[3],q[0],q[1],q[2]]),Vector(s)))
def interp_q(q1,q2,t):
    dot=float(q1@q2)
    if dot<0:q2=-q2;dot=-dot
    if dot>.9995:q=q1*(1-t)+q2*t;return q/np.linalg.norm(q)
    theta=math.acos(max(-1,min(1,dot)));return (math.sin((1-t)*theta)*q1+math.sin(t*theta)*q2)/math.sin(theta)
def simplify_track(times,arr,path):
    if len(times)<3:return np.arange(len(times))
    keep={0,len(times)-1};stack=[(0,len(times)-1)]
    tolerance=1e-4 if path=='rotation' else 1.5e-4 if path=='translation' else 1e-5
    while stack:
        a,b=stack.pop()
        if b-a<2:continue
        fractions=(times[a+1:b]-times[a])/(times[b]-times[a])
        if path=='rotation':
            q1=arr[a];q2=arr[b];dot=float(q1@q2)
            if dot<0:q2=-q2;dot=-dot
            if dot>.9995:
                pred=q1[None,:]*(1-fractions[:,None])+q2[None,:]*fractions[:,None];pred/=np.linalg.norm(pred,axis=1)[:,None]
            else:
                theta=math.acos(max(-1,min(1,dot)));pred=(np.sin((1-fractions)*theta)[:,None]*q1+np.sin(fractions*theta)[:,None]*q2)/math.sin(theta)
        else:pred=arr[a][None,:]*(1-fractions[:,None])+arr[b][None,:]*fractions[:,None]
        err=np.linalg.norm(pred-arr[a+1:b],axis=1);i=int(np.argmax(err))
        if err[i]>tolerance:
            mid=a+1+i;keep.add(mid);stack.extend([(a,mid),(mid,b)])
    return np.array(sorted(keep))

clip_reports=[]
export_actions=[action for action in actions if action.name!='Idle.000']
for action in export_actions:
    set_action(action);lo,hi=map(float,action.frame_range)
    # Include every source key plus dense regular samples. Long idle remains 1 frame.
    step=.03125 if action.name in ['Attack.000','Attack.001','Attack.End','Hit','Walk'] else .125 if hi-lo<=40 else .5 if hi-lo<=100 else 1.
    frames=set(float(x.co.x) for f in action.fcurves for x in f.keyframe_points if lo<=x.co.x<=hi)
    frames.update(lo+i*step for i in range(math.floor((hi-lo)/step)+1));frames.add(hi);frames=sorted(frames)
    translations=[];rotations=[];scales=[];key_max={n:0. for n in names};key_sse={n:0. for n in names};key_count={n:0 for n in names}
    cache={}
    def capture(f):
        if f in cache:return cache[f]
        frame_at(f);jm,actual=eval_pose();t=[];q=[];s=[]
        for m in jm:
            a,b,c=trs(m);t.append(a);q.append(b);s.append(c)
        for c in correctives:
            r=records[c['object']];vi=c['vertex'];dominant=int(r['w'][vi].argmax())
            base_rotation=Matrix((jm[dominant]@invrest[dominant]).tolist()).to_quaternion().normalized()
            rotation=base_rotation
            t.append(actual[c['object']][vi]-np.array(rotation.to_matrix())@r['p'][vi]);q.append([rotation.x,rotation.y,rotation.z,rotation.w]);s.append([1,1,1])
        matrices=np.array([matrix_trs(a,b,c) for a,b,c in zip(t,q,s)])@ibm
        for n,r in records.items():
            pred=predict(matrices,r)
            err=np.linalg.norm(pred-actual[n],axis=1);key_max[n]=max(key_max[n],float(err.max()));key_sse[n]+=float((err**2).sum());key_count[n]+=len(err)
        cache[f]=(np.array(t),np.array(q),np.array(s));return cache[f]
    for f in frames:capture(f)
    selected_frames=set(frames);stack=[(a,b,0) for a,b in zip(frames[:-1],frames[1:])];adaptive_max_remaining=0.;adaptive_added=0
    while stack:
        fa,fb,depth=stack.pop();mid=(fa+fb)/2
        ta,qa,sa=capture(fa);tb,qb,sb=capture(fb);tm,qm,sm=capture(mid)
        qi=np.array([interp_q(a,b,.5) for a,b in zip(qa,qb)])
        interp=np.array([matrix_trs(a,b,c) for a,b,c in zip((ta+tb)/2,qi,(sa+sb)/2)])@ibm
        exact=np.array([matrix_trs(a,b,c) for a,b,c in zip(tm,qm,sm)])@ibm
        error=max(float(np.linalg.norm(predict(interp,r)-predict(exact,r),axis=1).max()) for r in records.values())
        if error*SCALE*1000>.25 and depth<8:
            selected_frames.add(mid);adaptive_added+=1;stack.extend([(fa,mid,depth+1),(mid,fb,depth+1)])
        else:adaptive_max_remaining=max(adaptive_max_remaining,error*SCALE*1000)
    frames=sorted(selected_frames)
    translations=np.array([cache[f][0] for f in frames]);rotations=np.array([cache[f][1] for f in frames]);scales=np.array([cache[f][2] for f in frames])
    for i in range(1,len(frames)):
        flip=(rotations[i-1]*rotations[i]).sum(axis=1)<0;rotations[i,flip]*=-1
    # Held-out quarter points are not among sampled animation keys. Bound work
    # to 32 intervals per clip, including endpoints, and compare against Blender.
    held={n:[] for n in names};intervals=sorted(set(np.linspace(0,max(0,len(frames)-2),32).astype(int)))
    held_frames=[];held_worst={n:dict(error=0) for n in names}
    for ii in intervals:
        if len(frames)<2:continue
        for frac in [.25,.75]:
            f=frames[ii]*(1-frac)+frames[ii+1]*frac;frame_at(f);_,actual=eval_pose();held_frames.append(f)
            t=translations[ii]*(1-frac)+translations[ii+1]*frac;s=scales[ii]*(1-frac)+scales[ii+1]*frac;q=np.array([interp_q(a,b,frac) for a,b in zip(rotations[ii],rotations[ii+1])]);matrices=np.array([matrix_trs(a,b,c) for a,b,c in zip(t,q,s)])@ibm
            for n,r in records.items():
                pred=predict(matrices,r);err=np.linalg.norm(pred-actual[n],axis=1);held[n].append(err)
                if err.max()>held_worst[n]['error']:
                    vi=int(err.argmax());held_worst[n]=dict(error=float(err[vi]),frame=f,vertex=vi,corrective=any(c['object']==n and c['vertex']==vi for c in correctives))
    anim=dict(name=action.name,samplers=[],channels=[]);times=access((np.array(frames)-lo)/fps,'SCALAR',bounds=True)
    for ji,node in enumerate(joint_nodes):
        for path,arr,typ in [('translation',translations[:,ji],'VEC3'),('rotation',rotations[:,ji],'VEC4'),('scale',scales[:,ji],'VEC3')]:
            if ji>=len(joints) and path=='scale':continue
            if np.max(np.abs(arr-arr[0]))<1e-9:
                # Constant tracks still needed if static rest differs from clip pose.
                ti=access([0,(hi-lo)/fps],'SCALAR',bounds=True) if hi>lo else times;data=np.array([arr[0],arr[0]]) if hi>lo else arr[:1]
            else:
                selected=simplify_track(np.array(frames),arr,path);ti=access((np.array(frames)[selected]-lo)/fps,'SCALAR',bounds=True);data=arr[selected]
            si=len(anim['samplers']);anim['samplers'].append(dict(input=ti,output=access(data,typ),interpolation='LINEAR'));anim['channels'].append(dict(sampler=si,target=dict(node=node,path=path)))
    gltf['animations'].append(anim)
    cr=dict(name=action.name,sourceFrames=[lo,hi],durationSeconds=(hi-lo)/fps,keySamples=len(frames),sourceBakeSamples=len(cache),adaptiveAddedKeys=adaptive_added,adaptiveMaximumMidpointInterpolationMm=adaptive_max_remaining,heldOutSamples=len(held_frames),heldOutFrames=held_frames,meshes={n:dict(atKeys=dict(maxSourceUnits=key_max[n],rmsSourceUnits=math.sqrt(key_sse[n]/key_count[n]),maxNormalizedMm=key_max[n]*SCALE*1000),heldOut=stats(np.array(held[n])) if held[n] else None,worstHeldOut=held_worst[n]) for n in names})
    clip_reports.append(cr);print(json.dumps(dict(clip=action.name,keySamples=len(frames),atKeysMaxMm=max(cr['meshes'][n]['atKeys']['maxNormalizedMm'] for n in names),heldOutMaxMm=max((cr['meshes'][n]['heldOut']['maxNormalizedMm'] for n in names if cr['meshes'][n]['heldOut']),default=0))),flush=True)

gltf['buffers'][0]['byteLength']=len(blob)
rawjson=json.dumps(gltf,separators=(',',':')).encode();rawjson+=b' '*((-len(rawjson))%4);blob+=b'\0'*((-len(blob))%4)
target=OUT/'cdmir-rat-native.glb';target.write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(rawjson)+8+len(blob))+struct.pack('<II',len(rawjson),0x4e4f534a)+rawjson+struct.pack('<II',len(blob),0x004e4942)+blob)
report=dict(source=SRC.name,sourceSha256=hashlib.sha256(SRC.read_bytes()).hexdigest(),output=target.name,sha256=hashlib.sha256(target.read_bytes()).hexdigest(),bytes=target.stat().st_size,blender=bpy.app.version_string,fps=fps,units='Original source world scale, glTF Y up. Normalized metrics use .24083059 uniform scale.',nativeActions=len(export_actions),sourceNativeActions=len(actions),omittedNativeActions=[dict(name='Idle.000',reason='Original source B-bone discontinuities cause 33.4-51.35 mm normalized body jumps; see weight-audit-tail-discontinuity.json. Original .blend and rejected all-14 artifact retained.')],linearAndSegmentJoints=len(joints),translationCorrectiveJoints=len(correctives),totalJoints=total_joints,correctiveThresholdNormalizedMm=1.,weightAudit=audit,topology=topology,clips=clip_reports,correctives=correctives,materialTranslation='Original packed albedo and tangent normal textures; roughness .82. Legacy AO and vertex-color omitted; diffuse colors for untextured source materials.',omittedObjects=['Hair intentionally hidden in original source Collection6','lights','cameras','planes'],limits=['Measured skeletal approximation of original source, not a porcupine adaptation.','Four-weight residual below corrective threshold remains and is reported per clip.','Held-out checks cover 32 intervals per clip, not every temporal extremum.','CPU source-versus-export-equivalent TRS proof; browser playback remains untested.','No source mesh topology validation or edits; repeated-index triangles alone omitted if present.'],elapsedSeconds=time.monotonic()-started)
(OUT/'native-export-report.json').write_text(json.dumps(report,indent=2,allow_nan=False));print(json.dumps(dict(complete=True,bytes=report['bytes'],joints=total_joints,correctives=len(correctives),elapsed=report['elapsedSeconds'])),flush=True)
(OUT/'native-export-source-mapping.json').write_text(json.dumps(dict(sourceSha256=report['sourceSha256'],coordinateSystem='Primitive positions are original Blender world positions, Z up, nose -Y. Shared scene root rotates -90 degrees X, giving glTF Y up and nose +Z. Mesh nodes have identity transforms. No normalization.',objects={n:dict(sourceWorldPositions=r['p'].tolist(),originalVertexWeights=r['sourceWeights'],sourceWorldMatrix=[list(row) for row in r['world']]) for n,r in records.items()},joints=[dict(name=j['name'],sourceBone=j['source'],segment=j['segment'],restWorldMatrix=[list(row) for row in j['rest']]) for j in joints],correctives=correctives),indent=2))

# Independent accessor readback evaluates serialized float32 data and the final
# simplified tracks, at deterministic random times not used to fit weights.
raw=target.read_bytes();json_len=struct.unpack_from('<I',raw,12)[0]
decoded=json.loads(raw[20:20+json_len]);binary=raw[28+json_len:]
def read_accessor(index):
    ac=decoded['accessors'][index];bv=decoded['bufferViews'][ac['bufferView']]
    width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[ac['type']]
    dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[ac['componentType']]
    return np.frombuffer(binary,dtype=dtype,count=ac['count']*width,offset=bv.get('byteOffset',0)+ac.get('byteOffset',0)).reshape(ac['count'],width).astype(float)
skin=decoded['skins'][0];read_ibm=read_accessor(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
read_meshes=[];bad_values=0;weight_error=0.;normal_unit_error=0.
for mesh in decoded['meshes']:
    for prim in mesh['primitives']:
        attrs={k:read_accessor(v) for k,v in prim['attributes'].items()}
        bad_values+=sum(int((~np.isfinite(v)).sum()) for v in attrs.values())
        weight_error=max(weight_error,float(np.abs(attrs['WEIGHTS_0'].sum(axis=1)-1).max()))
        normal_unit_error=max(normal_unit_error,float(np.abs(np.linalg.norm(attrs['NORMAL'],axis=1)-1).max()))
    read_meshes.append(dict(name=mesh['name'],p4=np.c_[attrs['POSITION'],np.ones(len(attrs['POSITION']))],normal=attrs['NORMAL'],ids=attrs['JOINTS_0'].astype(int),weights=attrs['WEIGHTS_0'],source=np.array(prim['extras']['sourceVertexIndices'],dtype=int),sourceLoops=np.array(prim['extras']['sourceLoopIndices'],dtype=int)))
readback=[];rng=np.random.default_rng(5042026)
for anim in decoded['animations']:
    action=bpy.data.actions[anim['name']];set_action(action);lo,hi=map(float,action.frame_range);duration=(hi-lo)/fps
    channels=[];minimum_q_dot=1.
    for channel in anim['channels']:
        sampler=anim['samplers'][channel['sampler']];times=read_accessor(sampler['input'])[:,0];values=read_accessor(sampler['output']);path=channel['target']['path']
        if path=='rotation' and len(values)>1:minimum_q_dot=min(minimum_q_dot,float((values[:-1]*values[1:]).sum(axis=1).min()))
        channels.append((channel['target']['node'],path,times,values))
    timestamps=sorted(rng.uniform(0,duration,80).tolist()) if duration>0 else [0.]
    errors={n:[] for n in names};normal_errors={n:[] for n in names};worst={n:dict(error=0.) for n in names}
    for sec in timestamps:
        node_trs={node:{'translation':np.array(decoded['nodes'][node].get('translation',[0,0,0]),float),'rotation':np.array(decoded['nodes'][node].get('rotation',[0,0,0,1]),float),'scale':np.array(decoded['nodes'][node].get('scale',[1,1,1]),float)} for node in skin['joints']}
        for node,path,times,values in channels:
            idx=int(np.searchsorted(times,sec,side='right'))
            if idx==0:value=values[0]
            elif idx==len(times):value=values[-1]
            else:
                a=(sec-times[idx-1])/(times[idx]-times[idx-1]);value=interp_q(values[idx-1],values[idx],a) if path=='rotation' else values[idx-1]*(1-a)+values[idx]*a
            node_trs[node][path]=value
        matrices=np.array([matrix_trs(node_trs[n]['translation'],node_trs[n]['rotation'],node_trs[n]['scale']) for n in skin['joints']])@read_ibm
        frame_at(lo+sec*fps);_,actual=eval_pose()
        for mesh in read_meshes:
            pred=np.einsum('vkab,vb,vk->va',matrices[mesh['ids']],mesh['p4'],mesh['weights'])[:,:3]
            err=np.linalg.norm(pred-actual[mesh['name']][mesh['source']],axis=1);errors[mesh['name']].append(err)
            if err.max()>worst[mesh['name']]['error']:
                vi=int(err.argmax());worst[mesh['name']]=dict(error=float(err[vi]),normalizedMm=float(err[vi]*SCALE*1000),seconds=sec,sourceVertex=int(mesh['source'][vi]))
            # Smooth-normal diagnostic follows the stock shader's weighted matrix
            # direction. Source corner discontinuities can differ from vertex normals.
            predicted_normal=np.einsum('vkab,vb,vk->va',matrices[mesh['ids'],:3,:3],mesh['normal'],mesh['weights']);predicted_normal/=np.maximum(1e-12,np.linalg.norm(predicted_normal,axis=1))[:,None]
            reference=records[mesh['name']]['evaluatedCornerNormals'][mesh['sourceLoops']]
            angle=np.degrees(np.arccos(np.clip((predicted_normal*reference).sum(axis=1),-1,1)));normal_errors[mesh['name']].append(angle)
    result=dict(name=anim['name'],randomSamples=len(timestamps),timestampsSeconds=timestamps,minimumConsecutiveQuaternionDot=minimum_q_dot,meshes={n:dict(position=stats(np.concatenate(errors[n])),worst=worst[n],normalAngleDegrees=dict(max=float(np.concatenate(normal_errors[n]).max()),rms=float(np.sqrt(np.mean(np.concatenate(normal_errors[n])**2))),p95=float(np.quantile(np.concatenate(normal_errors[n]),.95)))) for n in names})
    readback.append(result);print(json.dumps(dict(readback=anim['name'],maxMm=max(result['meshes'][n]['position']['maxNormalizedMm'] for n in names))),flush=True)
validation=dict(file=target.name,sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),randomSeed=5042026,method='Reread final GLB bufferViews/accessors/IBMs and simplified float32 TRS channels. Deterministic 80 random timestamps per moving clip, one static Stand. Source Blender evaluated independently at the corresponding native action frame. Compare each exported corner to original source vertex via extras.sourceVertexIndices. Both source and result use same root Y-up rotation, omitted equally from Euclidean comparison.',nonfiniteAttributeValues=bad_values,maxWeightSumError=weight_error,maxRestNormalUnitError=normal_unit_error,clips=readback,normalMetricLimit='Normal diagnostic compares exported corner normals skinned with stock weighted matrices against corresponding evaluated Blender corner normals. Corrective joints use stable dominant source joint rotation; lighting approximation is explicitly measured.',limits=['Finite random sampling does not certify all temporal extrema.','No GPU render or gameplay acceptance.'])
(OUT/'native-export-readback-audit.json').write_text(json.dumps(validation,indent=2,allow_nan=False))
maximum=max(c['meshes'][n]['position']['maxNormalizedMm'] for c in readback for n in names)
report.update(releaseReady=maximum<=2. and max(c['adaptiveMaximumMidpointInterpolationMm'] for c in clip_reports)<=.3 and max(c['meshes'][n]['atKeys']['maxNormalizedMm'] for c in clip_reports for n in names)<=2. and bad_values==0 and weight_error<1e-6,finalByteAudit='native-export-readback-audit.json',finalByteAuditSha256=hashlib.sha256((OUT/'native-export-readback-audit.json').read_bytes()).hexdigest(),finalByteMaximumNormalizedMm=maximum,correctiveOrientation='Stable dominant source joint rotation; translation compensated to preserve source vertex position. Normal alignment intentionally not fitted because native source smooth normals can flip. Lighting approximation measured against exact source corner normals.')
(OUT/'native-export-report.json').write_text(json.dumps(report,indent=2,allow_nan=False))
print(json.dumps(dict(readbackComplete=True,maxMm=max(c['meshes'][n]['position']['maxNormalizedMm'] for c in readback for n in names),bytes=len(raw))),flush=True)

