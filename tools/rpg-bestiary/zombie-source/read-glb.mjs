import fs from 'node:fs';
// Independent CPU reader for the uncompressed, nonsparse entitled source GLBs.
export function readSourceGlb(file){
  const bytes=fs.readFileSync(file);if(bytes.readUInt32LE(0)!==0x46546c67)throw new Error('Not GLB: '+file);
  const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length)),bin=bytes.subarray(28+length);
  const sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},types={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
  function accessor(index){const a=json.accessors[index];if(a.sparse||a.bufferView===undefined)throw new Error('Unsupported source accessor '+index);const view=json.bufferViews[a.bufferView],C=types[a.componentType],n=sizes[a.type],array=new C(a.count*n),stride=view.byteStride||C.BYTES_PER_ELEMENT*n;
    for(let i=0;i<a.count;i++){const offset=(view.byteOffset||0)+(a.byteOffset||0)+i*stride;array.set(new C(bin.buffer.slice(bin.byteOffset+offset,bin.byteOffset+offset+C.BYTES_PER_ELEMENT*n)),i*n);}return {array,itemSize:n,normalized:!!a.normalized};}
  return {json,bin,accessor,file};
}
