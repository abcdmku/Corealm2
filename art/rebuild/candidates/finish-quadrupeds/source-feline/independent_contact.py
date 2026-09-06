"""Physical contact audit. No solver stance labels or p95 acceptance logic."""
import os,sys,json,struct,hashlib,numpy as np
from scipy.spatial.transform import Rotation
folder=os.path.dirname(os.path.abspath(__file__));revision='--v2' in sys.argv
file='Lynx.actor-contact-v2.glb' if revision else 'Lynx.actor-baked.glb';raw=open(os.path.join(folder,file),'rb').read();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);binary=raw[28+length:]
def read(index):
    a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
    return np.frombuffer(binary,dtype={5126:np.float32,5123:np.uint16,5125:np.uint32}[a['componentType']],offset=v.get('byteOffset',0)+a.get('byteOffset',0),count=n*a['count']).reshape(-1,n).astype(float)
parents={c:i for i,n in enumerate(doc['nodes']) for c in n.get('children',[])};joints=doc['skins'][0]['joints'];animations={}
inverseBind=read(doc['skins'][0]['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
for animation in doc['animations']:
    paths=[]
    for c in animation['channels']:
        sampler=animation['samplers'][c['sampler']];paths.append((c['target']['node'],c['target']['path'],read(sampler['input'])[:,0],read(sampler['output'])))
    animations[animation['name']]=paths
def skin(clip,time):
    value=[{'translation':n.get('translation',[0,0,0]),'rotation':n.get('rotation',[0,0,0,1]),'scale':n.get('scale',[1,1,1])} for n in doc['nodes']]
    for ni,path,times,frames in animations[clip]:
        t=float(np.clip(time,0,times[-1]));r=min(int(np.searchsorted(times,t,'right')),len(times)-1);l=max(0,r-1);u=0 if r==l else (t-times[l])/(times[r]-times[l]);a=frames[l];b=frames[r]
        if path=='rotation':
            if np.dot(a,b)<0:b=-b
            angle=np.arccos(np.clip(np.dot(a,b),-1,1))
            q=a*(1-u)+b*u if angle<.001 else (a*np.sin((1-u)*angle)+b*np.sin(u*angle))/np.sin(angle);q/=np.linalg.norm(q);value[ni][path]=q
        else:value[ni][path]=a*(1-u)+b*u
    local=[]
    for v in value:
        m=np.eye(4);m[:3,:3]=Rotation.from_quat(v['rotation']).as_matrix()*v['scale'];m[:3,3]=v['translation'];local.append(m)
    world={}
    def visit(i):
        if i not in world:world[i]=visit(parents[i])@local[i] if i in parents else local[i]
        return world[i]
    return np.array([visit(i) for i in joints])@inverseBind
bake=np.load(os.path.join(folder,'actor-bake-data.npz'));_,first=np.unique(bake['Cat_cornerIds'],return_index=True);a=doc['meshes'][0]['primitives'][0]['attributes'];position=np.c_[read(a['POSITION'])[first],np.ones(len(first))];index=read(a['JOINTS_0'])[first].astype(int);weight=read(a['WEIGHTS_0'])[first]
def posed(clip,t):
    matrices=skin(clip,t);blend=(matrices[index]*weight[:,:,None,None]).sum(1);return np.einsum('vij,vj->vi',blend,position)[:,:3]
rng=np.random.default_rng(731029);result={'file':file,'sha256':hashlib.sha256(raw).hexdigest(),'predicate':'Same original vertex <=floor+.0005m at both timestamps, independent of authored stance/foot labels. All22650 body vertices eligible. Actual world XYZ velocity adds forward source speed. Maximum is acceptance statistic; limit.012m/s.','clips':{},'passed':True}
for clip,speed,duration in [('Idle',0,3),('Walk',.65,1.125),('Run',2.2,14/24)]:
    keys=animations[clip][0][2];boundaries=[0,duration]
    if clip!='Idle':
        windows={'Walk':[0,.7037,.4815,1.1852,.2593,1,.7778,1.4815],'Run':[.2143,.3929,.1429,.25,.8214,.8929,.6429,.8929]}[clip]
        boundaries.extend((p%1)*duration for p in windows)
    times=np.unique(np.r_[keys,(keys[:-1]+keys[1:])/2,rng.uniform(0,duration,96),[(b+e)%duration for b in boundaries for e in [-.001,-.0001,0,.0001,.001]]])
    worst={'xyzNormMps':0};axis=np.zeros(3);count=0;minY=1;dt=1/960
    for t in times:
        p=posed(clip,float(t%duration));q=posed(clip,float((t+dt)%duration));minY=min(minY,float(p[:,1].min()),float(q[:,1].min()));mask=(p[:,1]<=.000501)&(q[:,1]<=.000501)
        if not mask.any():continue
        velocity=(q[mask]-p[mask])/dt;velocity[:,2]+=speed;norm=np.linalg.norm(velocity,axis=1);vi=int(norm.argmax());count+=int(mask.sum());axis=np.maximum(axis,np.abs(velocity).max(0))
        if norm[vi]>worst['xyzNormMps']:worst={'xyzNormMps':float(norm[vi]),'xyzMps':velocity[vi].tolist(),'vertex':int(np.flatnonzero(mask)[vi]),'time':float(t),'nextTime':float((t+dt)%duration),'heightPair':p[mask][vi,1].tolist() if False else [float(p[mask][vi,1]),float(q[mask][vi,1])]}
    result['clips'][clip]={'posePairs':len(times),'sameVertexContactSamples':count,'wholeMeshMinY':minY,'maxAbsXYZMps':axis.tolist(),'worst':worst,'passed':worst['xyzNormMps']<=.012 and minY>=-.001};result['passed']&=result['clips'][clip]['passed'];print(json.dumps({clip:result['clips'][clip]}),flush=True)
json.dump(result,open(os.path.join(folder,'actor2-independent-contact.json' if revision else 'actor-independent-contact.json'),'w'),indent=2)
