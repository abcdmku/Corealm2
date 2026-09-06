"""Evaluate real source leg IK, write deltas only; never save original Blender file."""
import bpy, pathlib, json, math, hashlib, base64, time, sys
import numpy as np
from mathutils import Matrix, Vector
OUT=pathlib.Path(__file__).resolve().parent;source=OUT/'cdmir-rat-original.blend'
inputs=json.loads((OUT/'contact-ik-input.json').read_text());scale=inputs['normalization']['scale'];floor=-inputs['normalization']['translation'][1]/scale
smooth='--smooth' in sys.argv
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
arm=bpy.data.objects['Armature'];scene=bpy.context.scene;fps=scene.render.fps/scene.render.fps_base
initial={b.name:b.matrix_basis.copy() for b in arm.pose.bones};arm_initial=arm.matrix_basis.copy()
limbs=list(inputs['feet']);bones=[n+suffix for n in limbs for suffix in ['', '.001','.002','.003']]
correctives=inputs['correctives'];corrective_ids=[c['vertex'] for c in correctives]
if any(c['object']!='Body' for c in correctives):
    # Head corrective vertices have their own source mesh, handled separately.
    pass
def evaluate():
    bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();ae=arm.evaluated_get(deps)
    matrices=np.array([np.array(ae.matrix_world@ae.pose.bones[n].matrix) for n in bones])
    arrays={}
    for name in ['Body','Head']:
        ev=bpy.data.objects[name].evaluated_get(deps);mesh=ev.to_mesh();p=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('co',p);p=p.reshape(-1,3);m=np.array(ev.matrix_world);arrays[name]=p@m[:3,:3].T+m[:3,3];ev.to_mesh_clear()
    points=np.array([arrays[c['object']][c['vertex']] for c in correctives])
    protected=np.array([np.array(ae.matrix_world@ae.pose.bones[n].matrix) for n in ['Hip','Backbone','Backbone.001','Backbone.002','Head']])
    return matrices,arrays['Body'],points,protected
def encode(a):return base64.b64encode(np.asarray(a,dtype='<f4').tobytes()).decode()
clips=[];failures=[];started=time.monotonic()
for clip in inputs['clips']:
    action=bpy.data.actions[clip['name']];arm.matrix_basis=arm_initial.copy()
    for b in arm.pose.bones:b.matrix_basis=initial[b.name]
    arm.animation_data.action=action;lo=float(action.frame_range[0]);series=[];before_bones=[];after_bones=[];before_correctives=[];after_correctives=[]
    for si,sec in enumerate(clip['times']):
        arm.matrix_basis=arm_initial.copy()
        for b in arm.pose.bones:b.matrix_basis=initial[b.name]
        f=lo+sec*fps;scene.frame_set(math.floor(f),subframe=f-math.floor(f));bpy.context.view_layer.update()
        original_m,body,original_c,protected=evaluate();targets={n:arm.pose.bones['IK-'+n].matrix.copy() for n in limbs};plans={}
        for n in limbs:
            ids=inputs['feet'][n]['distalSourceVertices'];p=body[ids];minimum=float(p[:,2].min());lift=0.;angle=0.
            if minimum<floor+(.00025 if smooth else -.0001)/scale:
                pivot=np.array((arm.matrix_world@targets[n]).translation);relative=p-pivot
                def objective(deg):
                    a=math.radians(deg);r=np.array(Matrix.Rotation(a,3,'X'));rotated=relative@r.T+pivot
                    required=max(0.,floor+.00025/scale-float(rotated[:,2].min()))
                    cost=(required*scale/.035)**2+.30*(deg/15)**2
                    return cost,required,a
                best=min((objective(deg) for deg in range(-15,16,3)),key=lambda r:r[0])
                if smooth:
                    centre=math.degrees(best[2]);left=max(-15.,centre-3);right=min(15.,centre+3);ratio=(math.sqrt(5)-1)/2
                    x1=right-ratio*(right-left);x2=left+ratio*(right-left);f1=objective(x1);f2=objective(x2)
                    for _ in range(24):
                        if f1[0]<f2[0]:right=x2;x2=x1;f2=f1;x1=right-ratio*(right-left);f1=objective(x1)
                        else:left=x1;x1=x2;f1=f2;x2=left+ratio*(right-left);f2=objective(x2)
                    best=min([best,f1,f2,objective(0)],key=lambda r:r[0])
                _,lift,angle=best
            plans[n]=dict(lift=lift,angle=angle,before=minimum)
        def apply():
            for n,p in plans.items():
                m=targets[n].copy();loc=m.translation.copy();m=Matrix.Translation(loc)@Matrix.Rotation(p['angle'],4,'X')@Matrix.Translation(-loc)@m;m.translation.z+=p['lift'];arm.pose.bones['IK-'+n].matrix=m
            return evaluate()
        changed=any(p['lift'] or p['angle'] for p in plans.values())
        if changed:
            for iteration in range(8):
                new_m,new_body,new_c,new_protected=apply();needs=False
                for n,p in plans.items():
                    if not (p['lift'] or p['angle']):continue
                    minimum=float(new_body[inputs['feet'][n]['distalSourceVertices'],2].min());error=floor+.00025/scale-minimum
                    if error>.00008/scale:p['lift']+=error;needs=True
                if not needs:break
            new_m,new_body,new_c,new_protected=apply()
        else:new_m,new_body,new_c,new_protected=original_m,body,original_c,protected
        sample=dict(time=sec,protectedMatrixDelta=float(np.abs(new_protected-protected).max()),feet={})
        for n,p in plans.items():
            after=float(new_body[inputs['feet'][n]['distalSourceVertices'],2].min());rec=dict(liftMeters=p['lift']*scale,pawPitchDegrees=math.degrees(p['angle']),beforeMinY=p['before']*scale+inputs['normalization']['translation'][1],afterMinY=after*scale+inputs['normalization']['translation'][1]);sample['feet'][n]=rec
            if rec['liftMeters']>.0350001 or abs(rec['pawPitchDegrees'])>15.0001 or rec['afterMinY']<-.0002:failures.append(dict(clip=clip['name'],time=sec,limb=n,**rec))
        before_bones.append(original_m);after_bones.append(new_m);before_correctives.append(original_c);after_correctives.append(new_c);series.append(sample)
    clips.append(dict(name=clip['name'],times=clip['times'],boneMatricesBefore=encode(before_bones),boneMatricesAfter=encode(after_bones),correctivePositionsBefore=encode(before_correctives),correctivePositionsAfter=encode(after_correctives),series=series))
    print(json.dumps(dict(clip=clip['name'],samples=len(series),failures=len(failures),maxLiftMm=max(s['feet'][n]['liftMeters']*1000 for s in series for n in limbs),maxProtected=max(s['protectedMatrixDelta'] for s in series))),flush=True)
report=dict(source=source.name,sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),inputSha256=inputs['sha256'],blender=bpy.app.version_string,normalization=inputs['normalization'],bones=bones,correctives=correctives,encoding='Base64 little-endian float32. Bone matrices shape [samples,bones,4,4] row-major; corrective positions [samples,correctives,3].',method='Original native action and IK chains evaluated. Existing poles and torso controls preserved. Each penetrating limb gets <=15-degree IK-target paw pitch plus a <=35-mm target lift, with iterative source-weighted distal minimum clearance. .003 toe local animation untouched; no whole-body lift or stance lock.',pitchSearch='Continuous bounded golden search with 24 iterations' if smooth else 'Coarse 3-degree grid, rejected for temporal stepping',clips=clips,failures=failures,elapsedSeconds=time.monotonic()-started)
(OUT/('contact-source-ik-smooth.json' if smooth else 'contact-source-ik.json')).write_text(json.dumps(report,separators=(',',':')))
