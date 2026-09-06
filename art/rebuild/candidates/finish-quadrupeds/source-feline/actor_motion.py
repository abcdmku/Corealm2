"""Authored actor motion on disposable adapted source rig. No export or autorun."""
import math,json,os
import bpy
import numpy as np
from mathutils import Matrix,Vector,Quaternion

FOOT_CHAINS={
 'front_L':('Foot_front_L2','Foot_front_L'),
 'front_R':('Foot_front_L2.002','Foot_front_R'),
 'back_L':('Foot_Back_L','Foot_Back_L2'),
 'back_R':('Foot_Back_R','Foot_Back_L2.002'),
}

class ActorMotion:
    def __init__(self,arm,body):
        self.arm=arm;self.body=body
        self.actions={('Walk' if a.name.endswith('|Walk') else 'Run'):a for a in bpy.data.actions if a.name.endswith('|Walk') or a.name.endswith('|run')}
        self.duration={'Walk':1.125,'Run':14/24,'Idle':3.0}
        self.floor=float(min(v.co.z for v in body.data.vertices))
        self.contacts={};self.stance_windows={}
        for name,(ankle,paw) in FOOT_CHAINS.items():
            bones={ankle}|{b.name for b in arm.data.bones[ankle].children_recursive}
            ids={g.index for g in body.vertex_groups if g.name in bones}
            mask=np.array([sum(g.weight for g in v.groups if g.group in ids)>.65 for v in body.data.vertices])
            target=bpy.data.objects.new('Authored_contact_'+name,None);bpy.context.collection.objects.link(target)
            target.rotation_mode='QUATERNION'
            ik=arm.pose.bones[ankle].constraints.new('IK');ik.name='Authored actual sole contact';ik.target=target;ik.chain_count=3;ik.use_stretch=False;ik.iterations=100;ik.influence=0
            orient=bpy.data.objects.new('Authored_paw_orientation_'+name,None);bpy.context.collection.objects.link(orient);orient.rotation_mode='QUATERNION'
            rotation=arm.pose.bones[paw].constraints.new('COPY_ROTATION');rotation.name='Retain source paw orientation';rotation.target=orient;rotation.owner_space='WORLD';rotation.target_space='WORLD';rotation.influence=0
            self.contacts[name]={'ankle':ankle,'paw':paw,'mask':mask,'target':target,'orientation':orient,'ik':ik,'rotation':rotation}
        self.last_audit=None
        # Explicitly authored support timing, informed by the source backward
        # paw sweeps. These are repair windows, not claims of native contact.
        self.stance_windows={'Walk':{'front_L':[(0,.7037)],'front_R':[(.4815,1.1852)],'back_L':[(.2593,1)],'back_R':[(.7778,1.4815)]},
            'Run':{'front_L':[(.2143,.3929)],'front_R':[(.1429,.25)],'back_L':[(.8214,.8929)],'back_R':[(.6429,.8929)]}}
        self.native_speeds={'Walk':.65,'Run':2.2}
        audit=json.load(open(os.path.join(os.path.dirname(__file__),'lynx-gait-contact-audit.json')))
        for name,c in self.contacts.items():
            source_name=name.replace('back','hind')
            c['mask']=np.zeros(len(body.data.vertices),bool);c['mask'][audit['feet'][source_name]['vertexIndices']]=True
            c['sole']=np.array(audit['feet'][source_name]['soleVertexIndices'],int)
        self.periodic={};self.pose_names=[b.name for b in arm.pose.bones]
        for clip,action in self.actions.items():
            arm.animation_data.action=action
            if action.slots:arm.animation_data.action_slot=action.slots[0]
            rows=[]
            # Native final samples were inconsistent with the first pose. Keep
            # all preceding keyed poses, and author a periodic cubic closure.
            count=round(self.duration[clip]*24)
            for frame in range(1,count+1):
                bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
                values=[]
                for matrix in [arm.matrix_world]+[arm.pose.bones[n].matrix_basis for n in self.pose_names]:
                    p,q,s=matrix.decompose();values.append(list(p)+list(q)+list(s))
                rows.append(values)
            array=np.array(rows)
            for index in range(array.shape[1]):
                for ti in range(1,len(array)):
                    if np.dot(array[ti-1,index,3:7],array[ti,index,3:7])<0:array[ti,index,3:7]*=-1
            self.periodic[clip]=array
        self.original('Idle',0)
        for c in self.contacts.values():c['flat_orientation']=(arm.matrix_world@arm.pose.bones[c['paw']].matrix).to_quaternion()
        self.anchors={}
        for clip,feet in self.stance_windows.items():
            self.anchors[clip]={}
            for name,windows in feet.items():
                midpoint=sum(windows[0])/2;values=self.original(clip,(midpoint%1)*self.duration[clip])
                self.anchors[clip][name]=np.median(values[self.contacts[name]['sole']],axis=0)

    def vertices(self):
        evaluated=self.body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
        values=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('co',values);values=values.reshape(-1,3);M=np.asarray(evaluated.matrix_world)
        evaluated.to_mesh_clear();return values@M[:3,:3].T+M[:3,3]

    def original(self,clip,time):
        for contact in self.contacts.values():contact['ik'].influence=0;contact['rotation'].influence=0
        if clip=='Idle':
            self.arm.animation_data.action=None;self.arm.matrix_world=Matrix.Identity(4)
            for bone in self.arm.pose.bones:bone.matrix_basis=Matrix.Identity(4)
            phase=2*math.pi*time/self.duration['Idle']
            # Independent neutral breathing and attentive head/ear movement.
            # Dedicated rest stance, never a renamed locomotion clip.
            for name in ['Spine.001','Spine.002']:
                b=self.arm.pose.bones.get(name)
                if b:b.scale=(1+.008*math.sin(phase),1+.003*math.sin(phase),1+.006*math.sin(phase))
            for name,angle,axis in [('Head',.018,(0,1,0)),('Neck',.007,(1,0,0)),('Ear',.025,(0,1,0)),('Ear.006',-.021,(0,1,0))]:
                b=self.arm.pose.bones.get(name)
                if b:b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion(axis,angle*math.sin(phase))
        else:
            self.arm.animation_data.action=None
            keys=self.periodic[clip];phase=(time/self.duration[clip])%1;index=phase*len(keys);i=int(index);u=index-i
            a,b,c,d=[keys[j%len(keys)].copy() for j in [i-1,i,i+1,i+2]]
            for q in [a,c,d]:
                negative=np.sum(q[:,3:7]*b[:,3:7],axis=1)<0;q[negative,3:7]*=-1
            values=.5*((2*b)+(-a+c)*u+(2*a-5*b+4*c-d)*u*u+(-a+3*b-3*c+d)*u*u*u)
            for j,value in enumerate(values):
                quaternion=Quaternion(value[3:7]);quaternion.normalize();matrix=Matrix.LocRotScale(Vector(value[:3]),quaternion,Vector(value[7:]))
                if j==0:self.arm.matrix_world=matrix
                else:self.arm.pose.bones[self.pose_names[j-1]].matrix_basis=matrix
        bpy.context.view_layer.update()
        return self.vertices()

    def sample(self,clip,time,repair=True):
        original=self.original(clip,time);before={n:float(original[c['mask'],2].min()) for n,c in self.contacts.items()}
        if not repair:return original
        desired={};desired_centers={};support={};root_drop=0
        for name,c in self.contacts.items():
            # Until audited phase windows are supplied, clamp penetration only.
            # Idle explicitly has four planted feet. Swing flight is retained.
            stance=clip=='Idle';blend=1 if stance else 0;center=np.median(original[c['sole']],axis=0);desired_centers[name]=center.copy()
            phase=(time/self.duration[clip])%1
            for start,end in self.stance_windows.get(clip,{}).get(name,[]):
                middle=(start+end)/2;unwrapped=middle+((phase-middle+.5)%1)-.5
                stance|=start<=unwrapped<=end
                outside=max(start-unwrapped,unwrapped-end,0);edge=.065 if clip=='Walk' else .06
                u=max(0,min(1,1-outside/edge));blend=u*u*(3-2*u)
                anchor=self.anchors[clip][name].copy();anchor[1]+=self.native_speeds[clip]*10*(unwrapped-middle)*self.duration[clip]
                desired_centers[name][:2]=center[:2]*(1-blend)+anchor[:2]*blend
            support[name]=bool(stance)
            desired[name]=max(self.floor,before[name]*(1-blend)+self.floor*blend)
            point=self.arm.matrix_world@self.arm.pose.bones[c['ankle']].tail
            point.z+=desired[name]-before[name];point.x+=desired_centers[name][0]-center[0];point.y+=desired_centers[name][1]-center[1];c['target'].location=point
            native_orientation=(self.arm.matrix_world@self.arm.pose.bones[c['paw']].matrix).to_quaternion()
            c['orientation'].rotation_quaternion=native_orientation.slerp(c['flat_orientation'],blend)
            chain=[];bone=self.arm.pose.bones[c['ankle']]
            for _ in range(3):chain.append(bone);bone=bone.parent
            root=self.arm.matrix_world@chain[-1].head
            length=sum(((self.arm.matrix_world@b.tail)-(self.arm.matrix_world@b.head)).length for b in chain)
            horizontal=(root.x-point.x)**2+(root.y-point.y)**2
            reachable=math.sqrt(max((length*(1-.015*blend))**2-horizontal,0))
            if blend>0:root_drop=max(root_drop,max(0,root.z-point.z-reachable))
            c['ik'].influence=1;c['rotation'].influence=1
        # Preserve segment lengths: lower the body only when a planted/landing
        # target is outside leg reach, instead of stretching the source limbs.
        root_drop=min(root_drop,.40)
        if root_drop:
            matrix=self.arm.matrix_world.copy();matrix.translation.z-=root_drop;self.arm.matrix_world=matrix
        for iteration in range(8):
            bpy.context.view_layer.update();values=self.vertices()
            errors={n:np.r_[desired_centers[n][:2]-np.median(values[c['sole']],axis=0)[:2],desired[n]-float(values[c['mask'],2].min())] for n,c in self.contacts.items()}
            if max(np.linalg.norm(e) for e in errors.values())<.0005:break
            for name,error in errors.items():self.contacts[name]['target'].location+=Vector(error)
        bpy.context.view_layer.update();values=self.vertices()
        after={n:float(values[c['mask'],2].min()) for n,c in self.contacts.items()}
        self.last_audit={'clip':clip,'time':time,'floor':self.floor,'before':before,'desired':desired,'after':after,'support':support,'rootReachDropMm':root_drop*100,'centers':{n:np.median(values[c['sole']],axis=0).tolist() for n,c in self.contacts.items()},'maxSoleErrorMm':max(abs(after[n]-desired[n]) for n in after)*100,'maxCenterErrorMm':max(float(np.linalg.norm(np.median(values[c['sole']],axis=0)[:2]-desired_centers[n][:2])) for n,c in self.contacts.items())*100,'iterations':iteration+1}
        return values
