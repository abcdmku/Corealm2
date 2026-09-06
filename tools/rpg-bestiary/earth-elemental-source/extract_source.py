"""Extract original FBX 6100 with isolated ufbx wheel, keeping native wrapper references alive."""
import sys,json,re,hashlib,math
from pathlib import Path
sys.path.insert(0,'test-results/earth-elemental-source/python-runtime')
import ufbx
SRC=Path('test-results/richer-creatures-source-cache/earth-elemental/earth elemental 1.1')
OUT=Path('tools/rpg-bestiary/earth-elemental-source/derived');OUT.mkdir(exist_ok=True)
scene=ufbx.load_file(str(SRC/'earth elemental.fbx'));keep=[]
def hold(x):keep.append(x);return x
def items(x):hold(x);return [hold(x[i]) for i in range(len(x))]
def matrix(m):return [*m.c0,0,*m.c1,0,*m.c2,0,*m.c3,1]
def trs(t):return {'position':list(t.translation),'quaternion':list(t.rotation),'scale':list(t.scale)}
nodes=items(scene.nodes);meshes=items(scene.meshes);stacks=items(scene.anim_stacks);anim=hold(stacks[0].anim)
result={'nodes':[],'meshes':[],'clips':[],'sourceStacks':[{'name':a.name,'begin':a.time_begin,'end':a.time_end} for a in stacks]}
for n in nodes:
 parent=hold(n.parent);result['nodes'].append({'id':n.typed_id,'name':n.name or 'source_root','parent':parent.typed_id if parent else None,**trs(n.local_transform)})
maxLoss=0;lostVertices=0
for m in meshes:
 instances=items(m.instances);instance=instances[0];ds=items(m.skin_deformers);d=ds[0];clusters=items(d.clusters)
 verts=hold(m.vertices);faces=hold(m.faces);vi=hold(m.vertex_indices);norm=hold(m.vertex_normal);uv=hold(m.vertex_uv);nv=hold(norm.values);ni=hold(norm.indices);uvv=hold(uv.values);uvi=hold(uv.indices)
 sv=hold(d.vertices);sw=hold(d.weights);weights=[];fullweights=[]
 for i in range(len(verts)):
  v=sv[i];w=[sw[j] for j in range(v.weight_begin,v.weight_begin+v.num_weights)];w.sort(key=lambda w:-w.weight);total=sum(x.weight for x in w);loss=sum(x.weight for x in w[4:])/total if total else 0;maxLoss=max(maxLoss,loss);lostVertices+=loss>1e-6
  fullweights.append([(x.cluster_index,x.weight/total) for x in w]);top=w[:4];ts=sum(x.weight for x in top);weights.append([(x.cluster_index,x.weight/ts) for x in top])
 data={'positions':[],'normals':[],'uvs':[],'skinIndices':[],'skinWeights':[],'fullWeights':[],'joints':[],'inverseBindMatrices':[],'geometryToWorld':matrix(instance.geometry_to_world),'name':m.name}
 for c in clusters:
  bone=hold(c.bone_node);data['joints'].append(bone.typed_id);data['inverseBindMatrices'].append(matrix(c.geometry_to_bone))
 # The original file contains triangles and planar quads. Fan triangulation preserves winding and UV corners.
 for face in faces:
  for j in range(1,face.num_indices-1):
   for corner in [face.index_begin,face.index_begin+j,face.index_begin+j+1]:
    idx=vi[corner];data['fullWeights'].append(fullweights[idx]);data['positions'].extend(verts[idx]);data['normals'].extend(nv[ni[corner]]);data['uvs'].extend(uvv[uvi[corner]]);w=weights[idx];data['skinIndices'].extend([x[0] for x in w]+[0]*(4-len(w)));data['skinWeights'].extend([x[1] for x in w]+[0]*(4-len(w)))
 result['meshes'].append(data)
meta=(SRC/'earth elemental.fbx.meta').read_text();ranges=re.findall(r'name: ([^\n]+)\n\s+takeName: ([^\n]+)\n\s+firstFrame: ([^\n]+)\n\s+lastFrame: ([^\n]+)',meta)
for name,take,first,last in ranges:
 start=float(first)/24;end=float(last)/24;count=math.ceil((end-start)*30);times=[(end-start)*i/count for i in range(count+1)];tracks=[]
 for n in nodes:
  if n.typed_id in [1,4,5,6,7,8,9,10]:continue
  values={'position':[],'quaternion':[],'scale':[]}
  for t in times:
   v=trs(ufbx.evaluate_transform(anim,n,start+t))
   for k in values:values[k].extend(v[k])
  tracks.append({'node':n.typed_id,**values})
 result['clips'].append({'name':name,'take':take,'firstFrame':float(first),'lastFrame':float(last),'fps':24,'times':times,'tracks':tracks})
result['weightReduction']={'sourceMaximum':8,'runtimeMaximum':4,'maxDiscardedFraction':maxLoss,'affectedControlVertices':lostVertices}
result['sourceFiles']=[{'file':str(p).replace('\\','/'),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [SRC/'earth elemental.fbx',SRC/'earth elemental.fbx.meta',SRC/'textures/low poly text.png',SRC/'textures/low poly normal.png']]
(OUT/'source.json').write_text(json.dumps(result,separators=(',',':')))
print(json.dumps({'nodes':len(nodes),'triangles':len(result['meshes'][0]['positions'])//9,'clips':[x['name'] for x in result['clips']],'weights':result['weightReduction']}),flush=True)
