import * as THREE from "three";
import {describe,expect,it} from "vitest";
import {crowdGeometryReady,simplifyCrowdGeometry} from "../game/src/render/crowdGeometry.js";

describe("crowd geometry",()=>{
  it("reduces a skinned surface while keeping exact surviving vertex attributes and the source intact",async()=>{
    await crowdGeometryReady;
    const source=new THREE.SphereGeometry(1,48,32),vertices=source.getAttribute("position").count;
    const joints=new Uint16Array(vertices*4),weights=new Float32Array(vertices*4);
    for(let v=0;v<vertices;v++) {
      joints[v*4]=3;joints[v*4+1]=7;
      weights[v*4]=(source.getAttribute("position").getY(v)+1)/2;weights[v*4+1]=1-weights[v*4]!;
    }
    source.setAttribute("skinIndex",new THREE.Uint16BufferAttribute(joints,4));
    source.setAttribute("skinWeight",new THREE.Float32BufferAttribute(weights,4));
    const original=Array.from(source.index!.array),lod=simplifyCrowdGeometry(source,0,original.length);
    expect(lod.index!.count).toBeLessThan(original.length*.7);
    expect(lod.getAttribute("position").count).toBeLessThan(vertices);
    expect(Array.from(source.index!.array)).toEqual(original);
    const sourcePositions=source.getAttribute("position"),positions=lod.getAttribute("position");
    for(let v=0;v<positions.count;v++){
      let originalVertex=-1;
      for(let i=0;i<vertices;i++) if([0,1,2].every(c=>positions.getComponent(v,c)===sourcePositions.getComponent(i,c))
        && [0,1].every(c=>lod.getAttribute("uv").getComponent(v,c)===source.getAttribute("uv").getComponent(i,c))) {originalVertex=i;break;}
      expect(originalVertex).toBeGreaterThanOrEqual(0);
      expect(lod.getAttribute("skinIndex").getX(v)).toBe(3);
      expect(lod.getAttribute("skinIndex").getY(v)).toBe(7);
      expect(lod.getAttribute("skinWeight").getX(v)).toBe(weights[originalVertex*4]);
      expect(lod.getAttribute("skinWeight").getY(v)).toBe(weights[originalVertex*4+1]);
    }
    expect(Math.max(...lod.index!.array)).toBeLessThan(positions.count);
    lod.dispose();source.dispose();
  });
  it("respects material ranges and preserves small attachments",async()=>{
    await crowdGeometryReady;
    const source=new THREE.BoxGeometry(1,1,1,12,12,12),group=source.groups[2]!;
    const allowed=new Set(Array.from(source.index!.array).slice(group.start,group.start+group.count));
    const lod=simplifyCrowdGeometry(source,group.start,group.count),positions=lod.getAttribute("position");
    for(let v=0;v<positions.count;v++)expect([...allowed].some(i=>[0,1,2].every(c=>
      positions.getComponent(v,c)===source.getAttribute("position").getComponent(i,c)))).toBe(true);
    const small=new THREE.BoxGeometry(),kept=simplifyCrowdGeometry(small,0,small.index!.count);
    expect(Array.from(kept.index!.array)).toEqual(Array.from(small.index!.array));
    expect(kept).not.toBe(small);
  });
  it("copies normalized and interleaved streams by value",async()=>{
    await crowdGeometryReady;
    const source=new THREE.PlaneGeometry(2,2,20,20),uv=source.getAttribute("uv"),vertices=uv.count;
    const data=new Float32Array(vertices*3),colours=new Uint8Array(vertices*3);
    for(let v=0;v<vertices;v++){
      data[v*3]=uv.getX(v);data[v*3+1]=uv.getY(v);data[v*3+2]=99;
      colours[v*3]=128;colours[v*3+1]=255;
    }
    source.setAttribute("uv",new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(data,3),2,0));
    source.setAttribute("color",new THREE.Uint8BufferAttribute(colours,3,true));
    const lod=simplifyCrowdGeometry(source,0,source.index!.count);
    expect(lod.index!.count).toBeLessThan(source.index!.count);
    for(let v=0;v<lod.getAttribute("position").count;v++){
      expect(lod.getAttribute("color").getX(v)).toBeCloseTo(128/255);
      expect(lod.getAttribute("color").getY(v)).toBe(1);
      expect(lod.getAttribute("uv").getX(v)).toBeCloseTo(lod.getAttribute("position").getX(v)/2+.5);
    }
  });
});
