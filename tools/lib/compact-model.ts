import { MeshoptEncoder } from 'meshoptimizer';

/** Meshopt delivery with optional bounded precision. Topology, rigs and external image URIs stay intact. */
export async function compactModel(input: Buffer, precision = false): Promise<Buffer> {
  await MeshoptEncoder.ready;
  const jsonSize = input.readUInt32LE(12);
  const json = JSON.parse(input.toString('utf8', 20, 20 + jsonSize));
  if (json.buffers?.length !== 1 || json.buffers[0].uri || json.extensionsUsed?.includes('EXT_meshopt_compression')) return input;
  let source = Buffer.from(input.subarray(28 + jsonSize));
  const parts: Buffer[] = [];
  let size = 0, fallbackSize = 0;
  const append = (data: Uint8Array): number => {
    const pad = (4 - size % 4) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); size += pad; }
    const offset = size; parts.push(Buffer.from(data)); size += data.length; return offset;
  };
  const indices = new Set<number>();
  const vertexPrecision = new Map<number, number>();
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    const accessor = json.accessors?.[primitive.indices];
    if (accessor?.bufferView !== undefined) indices.add(accessor.bufferView);
    if (precision) for (const [semantic, index] of Object.entries(primitive.attributes ?? {})) {
      const accessor = json.accessors[index as number];
      const bits = semantic === 'POSITION' ? 12 : /^NORMAL|TANGENT/.test(semantic) ? 10
        : /^TEXCOORD/.test(semantic) ? 14 : /^COLOR/.test(semantic) ? 10 : 0;
      if (bits && accessor?.componentType === 5126 && accessor.bufferView !== undefined)
        vertexPrecision.set(index as number,Math.max(bits,vertexPrecision.get(index as number) ?? 0));
    }
  }
  if (precision) for (const animation of json.animations ?? []) for (const sampler of animation.samplers) {
    const accessor=json.accessors[sampler.output];
    if(accessor.componentType===5126)vertexPrecision.set(sampler.output,16);
  }
  const widths: Record<string, number> = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  const components: Record<number, number> = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
  // Separate interleaved attributes so the codec predicts positions/normals independently.
  // Accessor identities and values stay intact; only their storage locations change.
  const relocated: Buffer[] = [], nextViews: any[] = [];
  let relocatedSize=0;
  const copyView=(view:any,bytes:Buffer) => {
    const pad=(4-relocatedSize%4)%4;if(pad){relocated.push(Buffer.alloc(pad));relocatedSize+=pad;}
    const id=nextViews.length;nextViews.push({...view,byteOffset:relocatedSize,byteLength:bytes.length});
    relocated.push(bytes);relocatedSize+=bytes.length;return id;
  };
  const remap=new Map<number,number>();
  const sourceAccessors=(json.bufferViews ?? []).map((_:unknown,i:number)=>(json.accessors ?? []).filter((a:any)=>a.bufferView===i));
  for(const [i,view] of (json.bufferViews ?? []).entries()) {
    const accessors=sourceAccessors[i]!;
    if(accessors.length>1 && !view.extensions && !(json.images ?? []).some((image:any)=>image.bufferView===i)
      && !(json.accessors ?? []).some((a:any)=>a.sparse?.indices?.bufferView===i || a.sparse?.values?.bufferView===i)) {
      for(const a of accessors) {
        const width=widths[a.type]!*components[a.componentType]!;
        const stride=view.target===34962 ? Math.ceil(width/4)*4 : width;
        const data=Buffer.alloc(a.count*stride);
        for(let row=0;row<a.count;row++) source.copy(data,row*stride,
          (view.byteOffset??0)+(a.byteOffset??0)+row*(view.byteStride??width),
          (view.byteOffset??0)+(a.byteOffset??0)+row*(view.byteStride??width)+width);
        const target={...view};delete target.byteStride;
        if(stride!==width)target.byteStride=stride;
        a.bufferView=copyView(target,data);a.byteOffset=0;
      }
    } else {
      const next=copyView(view,source.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength));remap.set(i,next);
      for(const a of accessors)a.bufferView=next;
    }
  }
  for(const image of json.images ?? []) if(image.bufferView!==undefined)image.bufferView=remap.get(image.bufferView);
  for(const a of json.accessors ?? []) if(a.sparse){
    a.sparse.indices.bufferView=remap.get(a.sparse.indices.bufferView);
    a.sparse.values.bufferView=remap.get(a.sparse.values.bufferView);
  }
  json.bufferViews=nextViews;source=Buffer.concat(relocated);
  indices.clear();
  for(const mesh of json.meshes??[])for(const p of mesh.primitives){const a=json.accessors?.[p.indices];if(a)indices.add(a.bufferView);}
  for (const [index,bits] of vertexPrecision) {
    const a = json.accessors[index], view = json.bufferViews[a.bufferView];
    const width = widths[a.type]!, stride = view.byteStride ?? width * 4;
    const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let c=0;c<width;c++) {
      let max = 0;
      for(let i=0;i<a.count;i++) max=Math.max(max,Math.abs(source.readFloatLE(offset+i*stride+c*4)));
      if (!max || !Number.isFinite(max)) continue;
      const step = 2 ** (Math.floor(Math.log2(max)) + 1 - bits);
      for(let i=0;i<a.count;i++) {
        const address=offset+i*stride+c*4, value=source.readFloatLE(address);
        source.writeFloatLE(Math.round(value/step)*step,address);
      }
    }
    if (a.min) a.min = a.min.map((v:number,c:number) => {
      let min=Infinity;for(let i=0;i<a.count;i++)min=Math.min(min,source.readFloatLE(offset+i*stride+c*4));return min;
    });
    if (a.max) a.max = a.max.map((v:number,c:number) => {
      let max=-Infinity;for(let i=0;i<a.count;i++)max=Math.max(max,source.readFloatLE(offset+i*stride+c*4));return max;
    });
  }
  let compressed = 0;
  for (const [i, view] of (json.bufferViews ?? []).entries()) {
    const bytes = source.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const accessors = (json.accessors ?? []).filter((a: any) => a.bufferView === i);
    const elementSize = accessors.length === 1 ? widths[accessors[0].type]! * components[accessors[0].componentType]! : 4;
    const stride = view.byteStride ?? elementSize;
    const isIndex = indices.has(i) && accessors.length === 1 && [2,4].includes(stride);
    if (bytes.length % stride || stride > 256 || (!isIndex && stride % 4)) {
      view.byteOffset = append(bytes); continue;
    }
    const mode = isIndex ? 'INDICES' : 'ATTRIBUTES';
    const encoded = MeshoptEncoder.encodeGltfBuffer(bytes, bytes.length / stride, stride, mode);
    fallbackSize += (4 - fallbackSize % 4) % 4;
    view.buffer = 1; view.byteOffset = fallbackSize; fallbackSize += bytes.length;
    view.extensions = {...view.extensions, EXT_meshopt_compression: {
      buffer: 0, byteOffset: append(encoded), byteLength: encoded.length,
      byteStride: stride, count: bytes.length / stride, mode, filter: 'NONE',
    }};
    compressed++;
  }
  if (!compressed) return input;
  json.buffers = [{byteLength:size}, {byteLength:fallbackSize,extensions:{EXT_meshopt_compression:{fallback:true}}}];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []),'EXT_meshopt_compression'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []),'EXT_meshopt_compression'])];
  const raw = Buffer.from(JSON.stringify(json));
  const jsonPad = (4 - raw.length % 4) % 4, binPad = (4 - size % 4) % 4;
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0); header.writeUInt32LE(2,4);
  header.writeUInt32LE(28 + raw.length + jsonPad + size + binPad,8);
  header.writeUInt32LE(raw.length + jsonPad,12); header.writeUInt32LE(0x4e4f534a,16);
  binHeader.writeUInt32LE(size + binPad,0); binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,raw,Buffer.alloc(jsonPad,32),binHeader,...parts,Buffer.alloc(binPad)]);
}
