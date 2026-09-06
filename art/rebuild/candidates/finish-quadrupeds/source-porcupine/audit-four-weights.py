"""Read-only source motion audit; output original mesh vertex-index weight overrides."""
import bpy, pathlib, json, hashlib, math, itertools, time, sys
import numpy as np
from mathutils import Vector

OUT = pathlib.Path(__file__).resolve().parent
SOURCE = OUT / 'cdmir-rat-original.blend'
started = time.monotonic()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
arm = bpy.data.objects['Armature']
initial_basis = {b.name: b.matrix_basis.copy() for b in arm.pose.bones}
initial_arm = arm.matrix_basis.copy()
names = ['Body', 'Head', 'Eyes', 'Teeth']
bones = [b for b in arm.data.bones if b.use_deform]
bone_names = [b.name for b in bones]
bone_index = {n:i for i,n in enumerate(bone_names)}
segment_mapping={};segment_mapping_max_delta=0.
records = {}
for name in names:
    obj = bpy.data.objects[name]
    p = np.array([list(v.co) + [1.] for v in obj.data.vertices])
    w = np.zeros((len(p), len(bones)))
    for v in obj.data.vertices:
        for g in v.groups:
            bn = obj.vertex_groups[g.group].name
            if bn in bone_index: w[v.index, bone_index[bn]] = g.weight
    sums = w.sum(axis=1)
    if np.any(sums <= 0): raise RuntimeError('Unweighted vertex in ' + name)
    w /= sums[:,None]
    top = np.argsort(-w, axis=1)[:,:4]
    w4 = np.zeros_like(w)
    np.put_along_axis(w4, top, np.take_along_axis(w, top, axis=1), axis=1)
    w4 /= w4.sum(axis=1)[:,None]
    records[name] = dict(obj=obj, p=p, w=w, w4=w4, trajectories=[], segmented=[], actual=[],
        sourceWeightSumRange=[float(sums.min()),float(sums.max())],
        modifiers=[dict(name=m.name, type=m.type, preserveVolume=getattr(m,'use_deform_preserve_volume',None), useVertexGroups=getattr(m,'use_vertex_groups',None), useBoneEnvelopes=getattr(m,'use_bone_envelopes',None)) for m in obj.modifiers])

if '--tail-discontinuity' in sys.argv:
    arm.animation_data.action=bpy.data.actions['Idle.000']
    fps=bpy.context.scene.render.fps/bpy.context.scene.render.fps_base
    cases=[('Tail',24.37190818786621,24.3720703125),('Tail',24.474609375,24.47477149963379),('Tail',36.26399612426758,36.26416015625),('Tail',36.36295700073242,36.36311721801758),('Tail.002',24.55045509338379,24.55061912536621),('Tail.002',36.19075393676758,36.19091796875)]
    findings=[]
    def probe(bone,f):
        bpy.context.scene.frame_set(math.floor(f),subframe=f-math.floor(f));bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();ae=arm.evaluated_get(deps);pb=ae.pose.bones[bone];m=pb.matrix@pb.bbone_segment_matrix(1,rest=False)
        ev=bpy.data.objects['Body'].evaluated_get(deps);mesh=ev.to_mesh();p=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('co',p);p=p.reshape(-1,3);mw=np.array(ev.matrix_world);p=p@mw[:3,:3].T+mw[:3,3];ev.to_mesh_clear()
        return m.to_quaternion(),np.array(m),p
    for bone,sa,sb in cases:
        a=sa*fps;b=sb*fps;qa,ma,pa=probe(bone,a);qb,mb,pb=probe(bone,b)
        original_dot=abs(qa.dot(qb))
        for _ in range(18):
            mid=(a+b)/2;qm,mm,pm=probe(bone,mid)
            if abs(qa.dot(qm))>.7:a=mid;qa,ma,pa=qm,mm,pm
            else:b=mid;qb,mb,pb=qm,mm,pm
        error=np.linalg.norm(pa-pb,axis=1);vi=int(error.argmax())
        findings.append(dict(bone=bone,initialQuaternionDot=original_dot,sourceFrames=[a,b],separationSeconds=(b-a)/fps,sourceMatrixDifference=float(np.linalg.norm(ma-mb)),sourceBodyMaxJumpUnits=float(error.max()),sourceBodyMaxJumpNormalizedMm=float(error.max()*240.83059),worstVertex=vi,sourcePositions=[pa[vi].tolist(),pb[vi].tolist()]))
    report=dict(source=SOURCE.name,sourceSha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),action='Idle.000',method='Locate serialized suspect segment intervals, then bisect original Blender segment orientation transitions 18 times. Compare original Blender evaluated body vertices immediately either side. No GLB or approximated skinning enters measured source positions.',findings=findings)
    (OUT/'weight-audit-tail-discontinuity.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True);raise SystemExit(0)

samples=[]
for action in bpy.data.actions:
    arm.matrix_basis = initial_arm.copy()
    for b in arm.pose.bones: b.matrix_basis = initial_basis[b.name]
    arm.animation_data.action = action
    lo,hi = map(float, action.frame_range)
    # Interleaved fitting and held-out samples cover endpoints and each clip phase.
    frames = np.linspace(lo, hi, 33 if hi > lo else 1)
    for fi, frame in enumerate(frames):
        whole=math.floor(frame)
        bpy.context.scene.frame_set(whole, subframe=float(frame-whole))
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        arm_eval = arm.evaluated_get(deps)
        transforms = [arm_eval.matrix_world @ arm_eval.pose.bones[b.name].matrix @ b.matrix_local.inverted() for b in bones]
        for name,r in records.items():
            obj=r['obj']; ev=obj.evaluated_get(deps)
            # Armature modifier starts in mesh-local coordinates, enters armature
            # space, applies pose * inverse bind, then returns to world space.
            to_arm = arm_eval.matrix_world.inverted() @ ev.matrix_world
            mats=np.array([np.array(t @ to_arm) for t in transforms])
            xyz=np.einsum('bij,vj->vbi',mats,r['p'])[:,:,:3]
            segmented=xyz.copy()
            for bi,b in enumerate(bones):
                if b.bbone_segments<=1:continue
                pb=arm_eval.pose.bones[b.name]
                for vi in np.where(r['w'][:,bi]>0)[0]:
                    point=to_arm @ Vector(r['p'][vi,:3])
                    index,blend=pb.bbone_segment_index(point)
                    mapping_key=(name,int(vi),b.name)
                    split={index:1-float(blend),index+1:float(blend)}
                    if mapping_key not in segment_mapping:segment_mapping[mapping_key]=split
                    else:
                        prior=segment_mapping[mapping_key]
                        segment_mapping_max_delta=max(segment_mapping_max_delta,max(abs(split.get(k,0)-prior.get(k,0)) for k in set(split)|set(prior)))
                    d1=pb.bbone_segment_matrix(index,rest=False) @ pb.bbone_segment_matrix(index,rest=True).inverted()
                    d2=pb.bbone_segment_matrix(index+1,rest=False) @ pb.bbone_segment_matrix(index+1,rest=True).inverted()
                    d=d1*(1-blend)+d2*blend
                    segmented[vi,bi]=arm_eval.matrix_world @ pb.matrix @ d @ b.matrix_local.inverted() @ point
            mesh=ev.to_mesh()
            if len(mesh.vertices)!=len(r['p']): raise RuntimeError('Topology mismatch '+name)
            local=np.array([list(v.co) for v in mesh.vertices]); wm=np.array(ev.matrix_world)
            actual=local @ wm[:3,:3].T + wm[:3,3]
            ev.to_mesh_clear()
            r['trajectories'].append(xyz);r['segmented'].append(segmented);r['actual'].append(actual)
        samples.append(dict(action=action.name,frame=float(frame),fit=fi%2==0))
    print('Sampled '+action.name,flush=True)

fit=np.array([s['fit'] for s in samples]); validation=~fit
def metrics(error):
    return dict(max=float(error.max()),rms=float(np.sqrt(np.mean(error**2))),p95=float(np.quantile(error,.95)),normalizedMillimeters=dict(max=float(error.max()*240.83059),rms=float(np.sqrt(np.mean(error**2))*240.83059)))

def solve_support(A,y,support):
    """Equality-constrained least squares; reject negative solutions.
    All positive support subsets are enumerated by caller, so boundaries are covered.
    """
    a=A[:,support]
    gram=a.T@a
    k=len(support)
    system=np.empty((k+1,k+1));system[:k,:k]=gram
    system[k,:k]=1;system[:k,k]=1;system[k,k]=0
    rhs=np.r_[a.T@y,1.]
    z=np.linalg.lstsq(system,rhs,rcond=1e-12)[0][:k]
    if np.min(z)<-1e-8:return None
    z=np.maximum(z,0);z/=z.sum()
    return z

summary={};overrides={};per_action={}
for name,r in records.items():
    linear=np.array(r['trajectories']);traj=np.array(r['segmented']);actual=np.array(r['actual'])
    full=np.einsum('svbc,vb->svc',traj,r['w'])
    faithful_error=np.linalg.norm(full-actual,axis=2)
    if faithful_error.max()>1e-4:
        si,vi=np.unravel_index(np.argmax(faithful_error),faithful_error.shape)
        print(json.dumps(dict(modifiers=r['modifiers'],sample=samples[si],vertex=int(vi),weights={bone_names[j]:float(r['w'][vi,j]) for j in np.where(r['w'][vi]>0)[0]},shapeKeys=[k.name for k in r['obj'].data.shape_keys.key_blocks] if r['obj'].data.shape_keys else None,bendy=[dict(name=b.name,segments=b.bbone_segments) for b in bones if b.bbone_segments>1],actual=actual[si,vi].tolist(),cpu=full[si,vi].tolist())),flush=True)
        raise RuntimeError('CPU reconstruction disagrees with Blender '+name+' '+str(metrics(faithful_error)))
    before=np.einsum('svbc,vb->svc',traj,r['w4'])
    before_error=np.linalg.norm(before-actual,axis=2)
    optimized=r['w4'].copy()
    changed=[]
    for vi in np.where((r['w']>0).sum(axis=1)>4)[0]:
        candidates=np.where(r['w'][vi]>0)[0].tolist()
        # Difference coordinates avoid poor conditioning from common world offset.
        origin=traj[fit,vi,candidates[0],:]
        A=(traj[fit,vi,:,:]-origin[:,None,:]).transpose(0,2,1).reshape(-1,len(bones))
        y=(actual[fit,vi,:]-origin).reshape(-1)
        baseline=optimized[vi].copy(); best=baseline.copy()
        best_loss=float(np.mean((A@best-y)**2))
        # Exact original-support enumeration, at most 12 candidates in source.
        for k in range(1,5):
            for support in itertools.combinations(candidates,k):
                sw=solve_support(A,y,list(support))
                if sw is None:continue
                loss=float(np.mean((A[:,support]@sw-y)**2))
                if loss<best_loss:
                    best_loss=loss;best=np.zeros(len(bones));best[list(support)]=sw
        old=np.linalg.norm(traj[:,vi,:,:].transpose(0,2,1)@baseline-actual[:,vi,:],axis=1)
        new=np.linalg.norm(traj[:,vi,:,:].transpose(0,2,1)@best-actual[:,vi,:],axis=1)
        # Keep only reductions that improve held-out RMS without a larger peak.
        if np.mean(new[validation]**2)<np.mean(old[validation]**2) and new.max()<=old.max()+1e-8:
            optimized[vi]=best
            changed.append(dict(vertex=int(vi),weights=[[bone_names[j],float(best[j])] for j in np.where(best>1e-9)[0]],before=metrics(old),after=metrics(new)))
    after=np.einsum('svbc,vb->svc',traj,optimized)
    after_error=np.linalg.norm(after-actual,axis=2)
    counts=(r['w']>0).sum(axis=1)
    summary[name]=dict(vertices=len(counts),verticesOverFour=int((counts>4).sum()),maxInfluences=int(counts.max()),influenceHistogram={str(k):int((counts==k).sum()) for k in np.unique(counts)},sourceWeightSumRange=r['sourceWeightSumRange'],modifiers=r['modifiers'],cpuVsBlender=metrics(faithful_error),topFourVsBlender=metrics(before_error),optimizedVsBlender=metrics(after_error),heldOutTopFourVsBlender=metrics(before_error[validation]),heldOutOptimizedVsBlender=metrics(after_error[validation]),overrides=len(changed))
    summary[name]['linearBoneVsBlender']=metrics(np.linalg.norm(np.einsum('svbc,vb->svc',linear,r['w'])-actual,axis=2))
    summary[name]['linearTopFourVsBlender']=metrics(np.linalg.norm(np.einsum('svbc,vb->svc',linear,r['w4'])-actual,axis=2))
    summary[name]['linearOptimizedVsBlender']=metrics(np.linalg.norm(np.einsum('svbc,vb->svc',linear,optimized)-actual,axis=2))
    worst_vertices=np.argsort(after_error.max(axis=0))[-10:][::-1]
    summary[name]['worstOptimizedVertices']=[dict(vertex=int(vi),sourceCoordinate=r['p'][vi,:3].tolist(),maxError=float(after_error[:,vi].max()),sample=samples[int(after_error[:,vi].argmax())],weights=[[bone_names[j],float(optimized[vi,j])] for j in np.where(optimized[vi]>0)[0]]) for vi in worst_vertices]
    overrides[name]=changed
    per_action[name]={action:dict(before=metrics(before_error[[s['action']==action for s in samples]]),after=metrics(after_error[[s['action']==action for s in samples]])) for action in sorted(set(s['action'] for s in samples))}
    print(json.dumps({name:summary[name]}),flush=True)

report=dict(source=SOURCE.name,sourceSha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),blender=bpy.app.version_string,units='Original Blender world units. normalizedMillimeters uses uniform scale .24083059.',method='Original four source meshes, original action/constraint evaluation; normalized deform-bone weights and segmented B-bone deformation verified against Blender. 33 uniformly distributed frames per action, alternate frames fit and held out. Exhaustive support enumeration up to four of all original joints. Equality-constrained nonnegative least squares. Keep only held-out RMS improvements with no sampled peak regression.',samples=samples,meshes=summary,perAction=per_action,limits=['Bounded samples do not prove unsampled extrema.','Audit concerns original source mesh indices before topology validation, remapping, or adaptation.','Does not measure exported GLB interpolation/coordinate conversion. Exported GLB requires a separate comparison.','Optimization metrics use faithful segmented B-bone deformation. linearOptimizedVsBlender separately reports ordinary joint export loss.'],elapsedSeconds=time.monotonic()-started)
(OUT/'weight-audit.json').write_text(json.dumps(report,indent=2,allow_nan=False))
(OUT/'weight-audit-overrides.json').write_text(json.dumps(dict(sourceSha256=report['sourceSha256'],indexSpace='Original Blender mesh vertex index before topology edits.',apply='Start with normalized four largest deform-bone weights for every vertex, then replace listed vertices with these complete weight lists. Clear all old deform groups on each overridden vertex before assigning.',objects=overrides),indent=2,allow_nan=False))
(OUT/'weight-audit-bbone-mapping.json').write_text(json.dumps(dict(sourceSha256=report['sourceSha256'],segmentMappingMaxDeltaAcrossSamples=segment_mapping_max_delta,recipe={'helperRestArmatureMatrix':'bone.matrix_local @ poseBone.bbone_segment_matrix(segment, rest=True)','helperAnimatedArmatureMatrix':'poseBone.matrix @ poseBone.bbone_segment_matrix(segment, rest=False)','weightSplit':'Original bone weight multiplied by listed segment factor. Apply after original-space optimization. Recheck expanded count against four-weight limit.','parent':'Armature object; helper local matrices are armature-space, no bone parenting.'},splits=[dict(object=k[0],vertex=k[1],bone=k[2],segments=[[int(i),float(w)] for i,w in split.items() if w>0]) for k,split in segment_mapping.items()]),indent=2,allow_nan=False))
print('Completed in '+str(report['elapsedSeconds'])+' seconds',flush=True)
