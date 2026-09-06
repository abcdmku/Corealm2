"""Correct lost smoothness inversion in a separate frozen-source material preview."""
import pathlib,sys,json,struct,io,hashlib
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'python-lib'))
from PIL import Image,ImageOps,ImageChops,ImageStat
import UnityPy
source=root/'gonsplitters-badger-preview-normalized.glb';raw=source.read_bytes();size=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+size]);binary=raw[28+size:]
material=doc['materials'][0];textureIndex=material['pbrMetallicRoughness']['metallicRoughnessTexture']['index'];imageIndex=doc['textures'][textureIndex]['source'];imageDef=doc['images'][imageIndex];oldView=doc['bufferViews'][imageDef['bufferView']]
oldImage=Image.open(io.BytesIO(binary[oldView.get('byteOffset',0):oldView.get('byteOffset',0)+oldView['byteLength']])).convert('RGB')
sourceGloss=Image.open(root/'gonsplitters-badger_Metal_Roughness.png').convert('RGBA');sourceAO=Image.open(root/'gonsplitters-badger_AmbOc.png').convert('RGBA')
gloss=sourceGloss.getchannel('A');roughness=ImageOps.invert(gloss);metallic=sourceGloss.getchannel('R');ao=sourceAO.getchannel('G')
assert ImageChops.difference(oldImage.getchannel('G'),gloss).getbbox() is None,'Expected frozen inversion bug differs; stop and inspect'
orm=Image.merge('RGB',(ao,roughness,metallic));stream=io.BytesIO();orm.save(stream,format='PNG');payload=stream.getvalue()
start=len(binary);binary+=payload;binary+=b'\0'*((-len(binary))%4)
imageDef['bufferView']=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(payload)});imageDef['name']='Source_Unity_ORM_corrected_smoothness_inversion'
doc['buffers'][0]['byteLength']=len(binary);material['pbrMetallicRoughness']['roughnessFactor']=1;material['pbrMetallicRoughness']['metallicFactor']=1
# Source metal R is identically zero. Factor 1 now follows the explicit packed channel.
assert metallic.getextrema()==(0,0)
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
target=root/'gonsplitters-badger-preview-material-v2.glb';target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
assert binary[:len(raw[28+size:])]==raw[28+size:],'Frozen geometry/image buffer unexpectedly changed'
unityMaterial={}
for o in UnityPy.load(str(root/'gonsplitters-gpbadger01')).objects:
    if o.type.name=='Material':unityMaterial=o.read_typetree()
def stats(im):return {'extrema':im.getextrema(),'mean':ImageStat.Stat(im).mean}
report={'sourceSha256':hashlib.sha256(raw).hexdigest(),'outputSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'bug':'Blender export ignored the SUBTRACT inversion node and copied Unity smoothness alpha directly to GLTF roughness green.','proof':'Old GLTF roughness G is pixel-exact equal to original metallic/gloss alpha.','oldRoughness':stats(oldImage.getchannel('G')),'correctedRoughness':stats(roughness),'correctedMetallic':stats(metallic),'correctedAO':stats(ao),'normalInterpretation':'Original red=255; Unity AG unpack X=alpha, Y=green, Z=sqrt(max(0,1-X^2-Y^2)); existing reconstructed normal preserved.','geometryNodesAndPriorBinaryUnchanged':True,'sourceUnityMaterial':unityMaterial,'rights':'Publisher declares CC-BY-SA4. Original creator grant remains unverified. Provisional source review only.','validation':'CPU texture channel and byte checks only; hardware coat comparison required.'}
(root/'material-v2-report.json').write_text(json.dumps(report,indent=2))
catalogue=json.loads((root/'candidate-catalogue.json').read_text());asset=catalogue['assets'][0];asset['sha256']=report['outputSha256'];asset['bytes']=report['bytes'];asset['is']+='; material-v2 corrects lost smoothness inversion';catalogue['files'][asset['id']]=target.name;catalogue['materialCorrection']={'report':'material-v2-report.json','frozenSourceSha256':report['sourceSha256'],'geometryUnchanged':True,'onlyChange':'Explicit Unity gloss-alpha to GLTF roughness-green inversion and explicit original zero-metallic channel.'}
(root/'candidate-catalogue-material-v2.json').write_text(json.dumps(catalogue,indent=2))
print(json.dumps({k:report[k] for k in ['sourceSha256','outputSha256','bytes','oldRoughness','correctedRoughness','correctedMetallic','geometryNodesAndPriorBinaryUnchanged']},indent=2))
