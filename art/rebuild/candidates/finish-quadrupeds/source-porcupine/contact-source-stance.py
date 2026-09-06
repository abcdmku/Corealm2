"""Separate source-IK stance experiment. Never writes a source or frozen GLB."""
import bpy, pathlib, json, math, hashlib, base64, time
import numpy as np
from mathutils import Matrix, Vector, Quaternion
OUT=pathlib.Path(__file__).resolve().parent
inputs=json.loads((OUT/'contact-ik-input.json').read_text())
scale=inputs['normalization']['scale']; floor=-inputs['normalization']['translation'][1]/scale
source=OUT/'cdmir-rat-original.blend'
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
arm=bpy.data.objects['Armature']; scene=bpy.context.scene; fps=scene.render.fps/scene.render.fps_base
initial={b.name:b.matrix_basis.copy() for b in arm.pose.bones}; arm_initial=arm.matrix_basis.copy()
limbs=list(inputs['feet']); bones=[n+s for n in limbs for s in ['', '.001','.002','.003']]
correctives=inputs['correctives']
# Full transfer intervals. The first/last .015 cycle is vertical landing/liftoff;
# horizontal/orientation transfer takes place outside these intervals, in air.
windows={
 'Walk':{'FrontLeg_L':[(.35,.85)],'FrontLeg_R':[(-.15,.35)],'BackLeg_L':[(-.18,.25)],'BackLeg_R':[(.32,.75)]},
 'Run':{'FrontLeg_L':[(.4266,.5317),(.635,1.06)],'FrontLeg_R':[(.5808,1.065)],'BackLeg_L':[(.79,1.315)],'BackLeg_R':[(.675,1.15)]}}
core={'Walk':{'FrontLeg_L':(.63,432),'FrontLeg_R':(.13,181),'BackLeg_L':(.10,366),'BackLeg_R':(.60,122)},'Run':{'FrontLeg_L':(.8,432),'FrontLeg_R':(.82,181),'BackLeg_L':(.92,361),'BackLeg_R':(.90,700)}}
for c in core:
    core[c]['BackLeg_L']=(core[c]['BackLeg_L'][0],361)
    core[c]['BackLeg_R']=(core[c]['BackLeg_R'][0],112)
air_boundaries={'BackLeg_L':[(.292,.327)],'FrontLeg_L':[(.413,.451),(.507,.547)],'FrontLeg_R':[(.56,.62)]}
def ease(x):
    x=max(0.,min(1.,x));return x*x*x*(10+x*(-15+6*x))
def reset_frame(action,t):
    arm.matrix_basis=arm_initial.copy()
    for b in arm.pose.bones:b.matrix_basis=initial[b.name]
    arm.animation_data.action=action
    f=float(action.frame_range[0])+t*fps;scene.frame_set(math.floor(f),subframe=f-math.floor(f));bpy.context.view_layer.update()
def evaluate():
    bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();ae=arm.evaluated_get(deps)
    mats=np.array([np.array(ae.matrix_world@ae.pose.bones[n].matrix) for n in bones]);arrays={}
    for name in ['Body','Head']:
        ev=bpy.data.objects[name].evaluated_get(deps);mesh=ev.to_mesh();p=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('co',p);m=np.array(ev.matrix_world);arrays[name]=p.reshape(-1,3)@m[:3,:3].T+m[:3,3];ev.to_mesh_clear()
    points=np.array([arrays[c['object']][c['vertex']] for c in correctives])
    protected=np.array([np.array(ae.matrix_world@ae.pose.bones[n].matrix) for n in ['Hip','Backbone','Backbone.001','Backbone.002','Head']])
    return mats,arrays['Body'],points,protected
def encode(a):return base64.b64encode(np.asarray(a,dtype='<f4').tobytes()).decode()
clips=[];failures=[];started=time.monotonic()
for clip in inputs['clips']:
    action=bpy.data.actions[clip['name']];duration=max(clip['times']);speed=.32 if clip['name']=='Walk' else 1.
    clip['times']=[float(t) for t in np.linspace(0,duration,math.ceil(duration*1200)+1,dtype=np.float32)]
    references={}
    for n in limbs:
        references[n]=[]
        for a,b in windows[clip['name']][n]:
            ref,sid=core[clip['name']][n]
            if clip['name']=='Run' and n=='FrontLeg_L' and a<.55:ref=(a+b)/2
            reset_frame(action,(ref%1)*duration);_,body,_,_=evaluate()
            q=arm.pose.bones['IK-'+n].matrix.to_quaternion();toe=arm.pose.bones[n+'.003'].matrix_basis.to_quaternion()
            if n.startswith('BackLeg'):q=Quaternion(Vector((1,0,0)),math.radians(5))@q
            elif clip['name']=='Run':q=Quaternion(Vector((1,0,0)),math.radians(2))@q
            # Fit one common-speed support track to the complete original
            # interval, instead of anchoring an uneven native sweep at one frame.
            points=[]
            for t in np.linspace(a,b,25):
                reset_frame(action,(t%1)*duration);_,samplebody,_,_=evaluate();point=samplebody[sid].copy();point[1]-=speed*(t-ref)*duration/scale;points.append(point)
            point=np.mean(points,axis=0)
            if clip['name']=='Run' and n=='BackLeg_L':point[1]-=.025/scale
            references[n].append(dict(start=a,end=b,phase=ref,support=int(sid),point=point,q=q,toe=toe))
    before_bones=[];after_bones=[];before_correctives=[];after_correctives=[];series=[]
    for sec in clip['times']:
        phase=sec/duration;reset_frame(action,sec);original_m,body,original_c,protected=evaluate()
        targets={n:arm.pose.bones['IK-'+n].matrix.copy() for n in limbs};toe_basis={n:arm.pose.bones[n+'.003'].matrix_basis.copy() for n in limbs};plans={}
        for n in limbs:
            # Select the nearest circular contact interval. Contact alignment is
            # complete before descending into the near-ground audit band.
            opts=[]
            for r in references[n]:
                for shift in [-1,0,1]:
                    p=phase+shift;distance=max(r['start']-p,0,p-r['end']);opts.append((distance,abs(p-r['phase']),p,r))
            _,_,p,r=min(opts,key=lambda z:(z[0],z[1]));a,b=r['start'],r['end']
            entry=.10 if clip['name']=='Run' and n=='FrontLeg_L' and a<.55 else .04
            alpha=ease((p-(a-entry))/entry)*ease(((b+.04)-p)/.04)
            grounded=ease((p-a)/.015)*ease((b-p)/.015)
            desired=r['point'].copy();desired[1]+=speed*(p-r['phase'])*duration/scale
            desired[2]=floor+(.00015+.008*(1-grounded))/scale
            orientation=alpha
            if clip['name']=='Run' and n=='BackLeg_L':orientation*=ease((1.26-p)/.10)
            if clip['name']=='Run' and n=='FrontLeg_L':
                first,second=references[n]
                if first['end']<phase<second['start']:
                    # Two nearby real contacts: transfer directly between their
                    # support poses during flight, without returning to a large
                    # native toe swing only to reverse it immediately afterward.
                    mix=ease((phase-first['end'])/(second['start']-first['end']))
                    pa=first['point'].copy();pb=second['point'].copy()
                    pa[1]+=speed*(phase-first['phase'])*duration/scale;pb[1]+=speed*(phase-second['phase'])*duration/scale
                    desired=pa*(1-mix)+pb*mix
                    r={**first,'q':first['q'].slerp(second['q'],mix),'toe':first['toe'].slerp(second['toe'],mix)}
                    alpha=orientation=1.;grounded=0.
            plans[n]=dict(alpha=alpha,orientation=orientation,grounded=grounded,reference=r,desired=desired,delta=np.zeros(3),before=float(body[inputs['feet'][n]['distalSourceVertices'],2].min()))
        def apply():
            for n,p in plans.items():
                m=targets[n];loc,q,s=m.decompose();q=q.slerp(p['reference']['q'],p['orientation']);new=Matrix.LocRotScale(loc+Vector(p['delta']),q,s);arm.pose.bones['IK-'+n].matrix=new
                tl,tq,ts=toe_basis[n].decompose();arm.pose.bones[n+'.003'].matrix_basis=Matrix.LocRotScale(tl,tq.slerp(p['reference']['toe'],p['orientation']),ts)
            return evaluate()
        # Fixed support translation plus genuine airborne clearance. Solves use
        # evaluated, fully weighted source geometry and the original IK poles.
        for iteration in range(65):
            new_m,new_body,new_c,new_protected=apply();residual=0.
            for n,p in plans.items():
                sid=p['reference']['support'];ids=inputs['feet'][n]['distalSourceVertices']
                target=body[sid]*(1-p['alpha'])+p['desired']*p['alpha']
                err=target-new_body[sid];err[2]=0
                minz=float(new_body[ids,2].min())
                # Outside alignment, preserve source swing height if already
                # clear; use 8mm clearance where recovery previously dragged.
                source_min=p['before'];source_height=(source_min-floor)*scale
                requested=floor+(.00015*p['grounded']+max(.008,source_height)*(1-p['grounded']))/scale
                if clip['name']=='Run':
                    restore=max([ease((phase-(a-.02))/.02)*ease(((b+.02)-phase)/.02) for a,b in air_boundaries.get(n,[])]+[0])
                    requested=requested*(1-restore)+max(floor+.00015/scale,source_min)*restore
                err[2]=requested-minz
                p['delta']+=err*.65;residual=max(residual,float(np.linalg.norm(err))*scale)
                norm=float(np.linalg.norm(p['delta']))*scale
                if norm>.15:p['delta']*=.15/norm
            if residual<.00000004:break
        new_m,new_body,new_c,new_protected=apply()
        sample=dict(time=sec,protectedMatrixDelta=float(np.abs(new_protected-protected).max()),feet={})
        for ni,n in enumerate(limbs):
            p=plans[n];lengths0=np.linalg.norm(np.diff(original_m[ni*4:ni*4+4,:3,3],axis=0),axis=1);lengths1=np.linalg.norm(np.diff(new_m[ni*4:ni*4+4,:3,3],axis=0),axis=1)
            rec=dict(liftMeters=float(p['delta'][2]*scale),targetTranslationMeters=float(np.linalg.norm(p['delta'])*scale),pawPitchDegrees=math.degrees(targets[n].to_quaternion().rotation_difference(arm.pose.bones['IK-'+n].matrix.to_quaternion()).angle),beforeMinY=p['before']*scale+inputs['normalization']['translation'][1],afterMinY=float(new_body[inputs['feet'][n]['distalSourceVertices'],2].min())*scale+inputs['normalization']['translation'][1],alignment=p['alpha'],grounded=p['grounded'],support=p['reference']['support'],segmentLengthChangeMeters=float(np.max(np.abs(lengths1-lengths0)))*scale)
            sample['feet'][n]=rec
            if rec['segmentLengthChangeMeters']>.0005 or rec['targetTranslationMeters']>.15 or rec['afterMinY']<-.0002:failures.append(dict(clip=clip['name'],time=sec,limb=n,**rec))
        before_bones.append(original_m);after_bones.append(new_m);before_correctives.append(original_c);after_correctives.append(new_c);series.append(sample)
    clips.append(dict(name=clip['name'],times=clip['times'],boneMatricesBefore=encode(before_bones),boneMatricesAfter=encode(after_bones),correctivePositionsBefore=encode(before_correctives),correctivePositionsAfter=encode(after_correctives),series=series))
    print(json.dumps(dict(clip=clip['name'],failures=len(failures),maxTargetMm=max(s['feet'][n]['targetTranslationMeters']*1000 for s in series for n in limbs),maxLengthMm=max(s['feet'][n]['segmentLengthChangeMeters']*1000 for s in series for n in limbs))),flush=True)
report=dict(source=source.name,sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),solverSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),inputSha256=inputs['sha256'],normalization=inputs['normalization'],bones=bones,correctives=correctives,method='Native IK at original segment lengths and poles. Original toe support follows fixed controller speed (.32/1 m/s), with stable stance paw/toe orientation, 5-degree hind roll and 2-degree Run forepaw roll. Separate airborne horizontal transfer and continuous native-height-to-plane landing; Run flight boundary height arcs are restored from original evaluated weighted feet. Short Run forefoot support poses connect directly through the genuine air gap. No weights, source geometry, torso controls or original files changed. Final-byte contact and temporal proof required.',configuration=dict(sampleRateHz=1200,hindRollDegrees=5,runForeRollDegrees=2,stanceFloorMeters=.00015,swingClearanceMeters=.008,sourceSolveToleranceMeters=.00000004,maximumIterations=65,targetTranslationLimitMeters=.15,segmentLengthErrorLimitMeters=.0005,airBoundaryArcs=air_boundaries),clips=clips,failures=failures,windows=windows,elapsedSeconds=time.monotonic()-started)
(OUT/'contact-source-stance-v6.json').write_text(json.dumps(report,separators=(',',':')))
