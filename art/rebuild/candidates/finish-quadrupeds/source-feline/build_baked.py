"""Standard glTF skin conversion, source-derived baked Walk/Run, CPU only."""
import os,json,struct,itertools,hashlib,sys,numpy as np
from scipy.spatial.transform import Rotation
folder=os.path.dirname(os.path.abspath(__file__));actor2='--actor2' in sys.argv;actor='--actor' in sys.argv or actor2;lynx='--lynx' in sys.argv or actor;prefix='actor2-' if actor2 else ('actor-' if actor else ('lynx-' if lynx else ''))
d=np.load(os.path.join(folder,prefix+'bake-data.npz'));meta=json.load(open(os.path.join(folder,prefix+'bake-data.json')))
fit=np.load(os.path.join(folder,'actor2-corrective-fit.npz' if actor2 else ('actor-corrective-fit.npz' if actor else ('lynx-corrective-fit.npz' if lynx else 'anchor-corrective-fit.npz'))));helpers=fit['helpers'];weights=fit['weights'];names=meta['boneNames']
m=d['matrices'];N=d['normalize'];m4=np.zeros((*m.shape[:2],4,4));m4[:,:,:3,:]=m;m4[:,:,3,3]=1
m4=np.einsum('ij,tkjl->tkil',N,m4);h=np.einsum('hj,tjkl->thkl',helpers,m4)
bind=np.tile(np.eye(4),(len(names)+len(helpers),1,1))
if actor2:
    # Decompose anatomical joint-world transforms, not deformation matrices
    # about the mesh origin. Matching IBMs preserve every sampled skin result.
    bind[:len(names)]=d['restMatrices']
    for j in range(len(helpers)):
        strength=weights[:,len(names)+j]**2
        if strength.sum()>1e-12:bind[len(names)+j,:3,3]=np.average(d['Cat_positions'],axis=0,weights=strength)
    m4=np.einsum('tjik,jkl->tjil',m4,bind[:len(names)])
    h=np.einsum('tjik,jkl->tjil',h,bind[len(names):])
nodes=[];tracks={};jointnodes=[]
def quats(mats):
    q=Rotation.from_matrix(mats).as_quat()
    for i in range(1,len(q)):
        if np.dot(q[i-1],q[i])<0:q[i]*=-1
    return q
def node(name,translation=None,rotation=None,scale=None):
    n={'name':name};i=len(nodes);nodes.append(n);tracks[i]={}
    for path,value in [('translation',translation),('rotation',rotation),('scale',scale)]:
        if value is not None:n[path]=value[0].tolist();tracks[i][path]=value
    return i
perms=list(itertools.permutations(range(3)));signs=list(itertools.product([-1,1],repeat=3))
permutationMatrices=[];permutationIndices=[]
for perm in perms:
    for sign in signs:
        P=np.eye(3)[:,perm]*sign
        if np.linalg.det(P)>0:permutationMatrices.append(P);permutationIndices.append(perm)
P=np.array(permutationMatrices);pi=np.array(permutationIndices)
decompositionMax=0
def affine_node(name,matrices):
    global decompositionMax
    us=[];ss=[];vs=[];last=None
    for t,A in enumerate(matrices[:,:3,:3]):
        U,s,V=np.linalg.svd(A)
        if np.linalg.det(U)<0:U[:,2]*=-1;s[2]*=-1
        if np.linalg.det(V)<0:V[2,:]*=-1;s[2]*=-1
        # Equivalent signed permutations, selected by temporal rotation proximity.
        aa=np.einsum('ij,kjl->kil',U,P);bb=np.einsum('kji,jl->kil',P,V)
        index=0 if last is None else int((np.linalg.norm(aa-last[0],axis=(1,2))+np.linalg.norm(bb-last[1],axis=(1,2))).argmin())
        a=aa[index];b=bb[index];z=s[pi[index]];last=(a,b);us.append(a);ss.append(z);vs.append(b)
        decompositionMax=max(decompositionMax,float(np.max(np.abs(a@np.diag(z)@b-A))))
    outer=node(name+'_baked_frame',matrices[:,:3,3],quats(np.array(us)),np.array(ss))
    inner=node(name,rotation=quats(np.array(vs)));nodes[outer]['children']=[inner];return inner
nativeShear=[];nativePairCount=0
for j,name in enumerate(names):
    A=m4[:,j,:3,:3];scale=np.linalg.norm(A,axis=1);R=A/scale[:,None,:]
    nativeShear.append(float(np.max(np.abs(np.einsum('tji,tjk->tik',R,R)-np.eye(3)))))
    if nativeShear[-1]>2e-5:
        jointnodes.append(affine_node(name,m4[:,j]));nativePairCount+=1
    else:jointnodes.append(node(name,m4[:,j,:3,3],quats(R),scale))
for j in range(len(helpers)):jointnodes.append(affine_node('patch_%03d_deform'%j,h[:,j]))
doc={'asset':{'version':'2.0','generator':'Corealm measured source rig conversion','copyright':'Cat by JonasDichelle, CC-BY-3.0. Source mirror nrz/ylikuutio commit 864ea1982524367ed416803db425f1895e4a0717.'},'scene':0,'scenes':[{'nodes':[]}],'nodes':nodes,'skins':[],'meshes':[],'materials':[{'name':'Neutral source inspection','pbrMetallicRoughness':{'baseColorFactor':[.65,.65,.65,1],'metallicFactor':0,'roughnessFactor':.85}}],'animations':[],'accessors':[],'bufferViews':[],'buffers':[{}]}
binary=bytearray()
if lynx:doc['materials'].append({'name':'Source-adapted Lynx grey buff dapple','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':0,'roughnessFactor':.89}})
def accessor(values,kind,dtype=np.float32,bounds=False):
    values=np.asarray(values,dtype=dtype);binary.extend(b'\0'*((-len(binary))%4));offset=len(binary);binary.extend(values.tobytes())
    bv=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':values.nbytes})
    a={'bufferView':bv,'componentType':5126 if dtype==np.float32 else (5123 if dtype==np.uint16 else 5125),'count':len(values),'type':kind}
    if bounds:a.update(min=values.min(axis=0).tolist(),max=values.max(axis=0).tolist())
    idx=len(doc['accessors']);doc['accessors'].append(a);return idx
doc['skins'].append({'name':'Source-derived baked flat rig','joints':jointnodes,'inverseBindMatrices':accessor(np.linalg.inv(bind).transpose(0,2,1).reshape(-1,16),'MAT4')})
eyeMax=0
for name in ['Cat','Sphere','Sphere.001']:
    pos=d[name+'_positions'];ids=d[name+'_cornerIds'];w=weights if name=='Cat' else d[name+'_weights']
    eyeMax=max(eyeMax,int((w>1e-9).sum(axis=1).max()) if name!='Cat' else 0)
    if (w>1e-9).sum(axis=1).max()>4:raise ValueError('More than four active weights '+name)
    indices=np.argsort(w,axis=1)[:,-4:];values=np.take_along_axis(w,indices,axis=1);values/=values.sum(axis=1,keepdims=True)
    attributes={'POSITION':accessor(pos[ids],'VEC3',bounds=True),'NORMAL':accessor(d[name+'_normals'],'VEC3'),'TEXCOORD_0':accessor(d[name+'_uvs'],'VEC2'),'JOINTS_0':accessor(indices[ids],'VEC4',np.uint16),'WEIGHTS_0':accessor(values[ids],'VEC4')}
    if lynx and name=='Cat':attributes['COLOR_0']=accessor(d['Cat_colors'][ids],'VEC4')
    doc['meshes'].append({'name':name,'primitives':[{'attributes':attributes,'material':1 if lynx and name=='Cat' else 0,'mode':4}]})
    nodes.append({'name':name,'mesh':len(doc['meshes'])-1,'skin':0})
children={c for n in nodes for c in n.get('children',[])};doc['scenes'][0]['nodes']=[i for i in range(len(nodes)) if i not in children]
for clip in (['Idle','Walk','Run'] if actor else ['Walk','Run']):
    indices=np.array([i for i,s in enumerate(meta['samples']) if s['clip']==clip]);times=np.array([meta['samples'][i]['time'] for i in indices]);timeacc=accessor(times.reshape(-1,1),'SCALAR',bounds=True)
    animation={'name':clip,'samplers':[],'channels':[],'extras':{'sourceDerivedBake':clip!='Idle','newlyAuthored':actor and clip=='Idle','sourceDurationPreserved':clip!='Idle','originalHierarchyPreserved':False,'contactModified':actor}}
    for ni,paths in tracks.items():
        for path,values in paths.items():
            animation['samplers'].append({'input':timeacc,'output':accessor(values[indices],'VEC4' if path=='rotation' else 'VEC3'),'interpolation':'LINEAR'})
            animation['channels'].append({'sampler':len(animation['samplers'])-1,'target':{'node':ni,'path':path}})
    doc['animations'].append(animation)
doc['buffers'][0]['byteLength']=len(binary)
js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binary+=b'\0'*((-len(binary))%4)
result=struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary
output='Lynx.actor-contact-v2.glb' if actor2 else ('Lynx.actor-baked.glb' if actor else ('Lynx.adapted-baked.glb' if lynx else 'Cat.corrected-baked.glb'))
open(os.path.join(folder,output),'wb').write(result)
report={'file':'Cat.corrected-baked.glb','sha256':hashlib.sha256(result).hexdigest(),'bytes':len(result),'originalBytes':7301392,'nativeNamedJointNodes':len(names),'nativeShearedJointExtraFrames':nativePairCount,'sharedPatchPairs':len(helpers),'addedNodes':len(helpers)*2+nativePairCount,'skinJoints':len(jointnodes),'animationChannelsPerClip':[len(a['channels']) for a in doc['animations']],'sourceNativeChannelsPerClip':363,'denseSamplesTotal':len(m),'sampleFps':192,'affineDecompositionMaxAbs':decompositionMax,'nativeTRSOrthogonalityMax':max(nativeShear),'eyeMaxInfluences':eyeMax,'actualInterpolationValidation':'pending','productionAccepted':False}
report['file']=output;report['speciesAdapted']=lynx;report['authoredActorMotion']=actor
report['anatomicalBindPivots']=actor2
json.dump(report,open(os.path.join(folder,prefix+'baked-export-report.json'),'w'),indent=2);print(json.dumps(report))
