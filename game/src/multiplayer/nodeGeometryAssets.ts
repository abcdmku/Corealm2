import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial } from "three";
import type { AssetEntry, AssetManifest } from "../render/assets.js";

/** Loads the production GLB triangles and manifest measurements without textures, DOM, or WebGL. */
export class NodeGeometryAssets {
  private readonly loaded = new Map<string, Promise<Group>>();
  private readonly ready = new Map<string, Group>();
  private constructor(private readonly directory: string, private readonly entries: Map<string,AssetEntry>,private readonly manifest:AssetManifest) {}
  static async open(directory: string): Promise<NodeGeometryAssets> {
    const root=resolve(directory);
    const manifest=JSON.parse(await readFile(resolve(root,"manifest.json"),"utf8")) as AssetManifest;
    return new NodeGeometryAssets(root,new Map(manifest.assets.map(entry=>[entry.id,entry])),manifest);
  }
  entry(id:string):AssetEntry|undefined{return this.entries.get(id);}
  getManifest():AssetManifest{return this.manifest;}
  byTags(...tags:string[]):AssetEntry[]{return [...this.entries.values()].filter(entry=>tags.every(tag=>entry.tags.includes(tag)));}
  async loadMany(ids:readonly string[]):Promise<void>{await Promise.all(ids.map(id=>this.load(id)));}
  baseY(id:string):number {const entry=this.entries.get(id);return entry?.groundY??entry?.base?.y??0;}
  assetSize(id:string):{x:number;y:number;z:number}|null{return this.entries.get(id)?.size??null;}
  assetCenterXZ(id:string):{x:number;z:number}|null{
    const entry=this.entries.get(id);return entry?{x:(entry.base?.x??-entry.size.x/2)+entry.size.x/2,z:(entry.base?.z??-entry.size.z/2)+entry.size.z/2}:null;
  }
  load(id:string):Promise<Group>{
    let pending=this.loaded.get(id);
    if(!pending){pending=this.read(id);this.loaded.set(id,pending);}
    return pending;
  }
  instance(id:string):Group{const root=this.ready.get(id);if(!root)throw new Error(`Geometry asset not loaded: ${id}`);return root.clone(true);}
  private async read(id:string):Promise<Group>{
    const entry=this.entries.get(id);if(!entry)throw new Error(`Unknown geometry asset: ${id}`);
    const file=resolve(this.directory,entry.file);const local=relative(this.directory,file);
    if(local.startsWith("..")||isAbsolute(local))throw new Error("Geometry asset escapes manifest directory");
    const document=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
    const root=new Group();root.name=id;
    for(const node of document.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
      const positions=primitive.getAttribute("POSITION")?.getArray();if(!positions)continue;
      const geometry=new BufferGeometry();geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
      for(const [semantic,name,size] of [["NORMAL","normal",3],["COLOR_0","color",3],["TEXCOORD_0","uv",2]] as const){
        const channel=primitive.getAttribute(semantic);if(channel?.getArray())geometry.setAttribute(name,new Float32BufferAttribute(channel.getArray()!,channel.getElementSize()||size));
      }
      const indices=primitive.getIndices()?.getArray();if(indices)geometry.setIndex(Array.from(indices));
      geometry.applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));
      const material=new MeshStandardMaterial();material.name=primitive.getMaterial()?.getName()??"";
      const mesh=new Mesh(geometry,material);mesh.name=node.getName();root.add(mesh);
    }
    this.ready.set(id,root);return root;
  }
}
