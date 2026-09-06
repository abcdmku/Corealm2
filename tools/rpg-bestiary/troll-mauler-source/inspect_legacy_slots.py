"""Read original Blender 2.73 SDNA/MTex slot fields; does not save or convert assets."""
import struct,re,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
p=ROOT/'test-results/coherent-humanoid-source-cache/troll-mauler.blend';data=p.read_bytes()
assert hashlib.sha256(data).hexdigest()=='83fc5e524d31020d8b7c9641517f965cecd65840b3119582b4e984649f708c51'
assert data[:12]==b'BLENDER-v273'
blocks=[];pos=12
while pos+24<=len(data):
 code,size,ptr,sdna,count=struct.unpack_from('<4sIQII',data,pos);blocks.append({'code':code,'ptr':ptr,'sdna':sdna,'count':count,'bytes':data[pos+24:pos+24+size]});pos+=24+size
dna=next(b['bytes'] for b in blocks if b['code']==b'DNA1');off=8
def strings():
 global off
 n=struct.unpack_from('<I',dna,off)[0];off+=4;out=[]
 for _ in range(n):end=dna.index(0,off);out.append(dna[off:end].decode());off=end+1
 off=(off+3)&~3;return out
names=strings();assert dna[off:off+4]==b'TYPE';off+=4;types=strings();assert dna[off:off+4]==b'TLEN';off+=4
lengths=list(struct.unpack_from('<'+'H'*len(types),dna,off));off=(off+2*len(types)+3)&~3;assert dna[off:off+4]==b'STRC';off+=4
n=struct.unpack_from('<I',dna,off)[0];off+=4;structs=[]
for _ in range(n):
 ti,nf=struct.unpack_from('<HH',dna,off);off+=4;fields=[];cursor=0
 for _ in range(nf):
  ft,fn=struct.unpack_from('<HH',dna,off);off+=4;name=names[fn];count=1
  for amount in re.findall(r'\[(\d+)\]',name):count*=int(amount)
  pointer='*' in name;size=(8 if pointer else lengths[ft])*count
  fields.append({'name':re.sub(r'\[.*','',name).replace('*',''),'raw':name,'type':types[ft],'offset':cursor,'size':size,'pointer':pointer,'count':count});cursor+=size
 structs.append({'name':types[ti],'size':lengths[ti],'calculatedSize':cursor,'fields':fields})
byname={s['name']:s for s in structs};byaddr={b['ptr']:b for b in blocks}
def decode(raw,typ):
 out={}
 for f in byname[typ]['fields']:
  chunk=raw[f['offset']:f['offset']+f['size']];t=f['type'];v=None
  if f['pointer']:v=list(struct.unpack('<'+'Q'*f['count'],chunk))
  elif t in ['char','uchar']:v=chunk.split(b'\0')[0].decode(errors='replace') if f['count']>1 else int.from_bytes(chunk,'little',signed=t=='char')
  elif t in ['short','ushort','int','uint','float','double','int64_t','uint64_t']:
   fmt={'short':'h','ushort':'H','int':'i','uint':'I','float':'f','double':'d','int64_t':'q','uint64_t':'Q'}[t];v=list(struct.unpack('<'+fmt*f['count'],chunk))
  elif t=='ID':v=decode(chunk,'ID')['name']
  if v is not None:out[f['name']]=v[0] if isinstance(v,list) and len(v)==1 else v
 return out
report={'header':data[:12].decode(),'materials':[],'structSizes':{n:[byname[n]['size'],byname[n]['calculatedSize']] for n in ['Material','MTex','Tex','Image','ID']}}
for b in blocks:
 if structs[b['sdna']]['name']!='Material':continue
 m=decode(b['bytes'],'Material');slots=[]
 for i,ptr in enumerate(m.get('mtex',[])):
  if not ptr:continue
  slot=decode(byaddr[ptr]['bytes'],'MTex');tex=decode(byaddr[slot['tex']]['bytes'],'Tex') if slot.get('tex') in byaddr else None
  image=decode(byaddr[tex['ima']]['bytes'],'Image') if tex and tex.get('ima') in byaddr else None
  slots.append({'index':i,'disabledBySeptex':bool(m.get('septex',0)&(1<<i)),'slot':slot,'texture':tex,'image':image})
 report['materials'].append({'name':m.get('id'),'septex':m.get('septex'),'use_textures':m.get('use_textures'),'slots':slots})
(ROOT/'test-results/troll-mauler-source/legacy-slots.json').write_text(json.dumps(report,indent=2))
print('structSizes',report['structSizes'])
for m in report['materials']:
 print(m['name'],'septex',m['septex'])
 for s in m['slots']:print(s['index'],s['disabledBySeptex'],s['texture']['id'],s['image'].get('id') if s['image'] else None,{k:s['slot'].get(k) for k in ['mapto','blendtype','colfac','norfac','difffac','varfac','texco','texflag']})
