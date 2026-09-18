import type * as THREE from "three";
import type { Vec3 } from "../contracts.js";
import type { TraversalSample } from "../systems/traversalMotion.js";
import { TraversalPoseLayer } from "./traversalPose.js";
import { FishingLine, FishingPoseLayer, type FishingSample } from "./fishingPose.js";

export interface RemoteActivitySample { traversal: TraversalSample | null; fishing: FishingSample | null; spot: Vec3 | null }

/** The same contact and fishing layers as the local rig, owned by one resident remote rig. */
export class RemoteActivityPose {
  private readonly traversal = new TraversalPoseLayer();
  private readonly fishing = new FishingPoseLayer();
  private line: FishingLine | null = null;
  private rod?: THREE.Object3D;
  constructor(private readonly root: THREE.Object3D, private readonly bones: ReadonlyMap<string,THREE.Bone>) {
    root.traverse(node=>{if(node.userData.fishingRod)this.rod=node;});
  }
  restore(): void { this.traversal.restore(); this.fishing.restore(); }
  apply(sample?: RemoteActivitySample): void {
    this.traversal.apply(this.root,this.bones,sample?.traversal??null);
    this.fishing.apply(this.root,this.bones,sample?.fishing??null,this.rod);
    if(sample?.fishing&&!this.line){this.line=new FishingLine();this.root.add(this.line.root);}
    this.line?.update(this.rod,sample?.spot??null,sample?.fishing??null);
  }
  dispose(): void { this.restore();this.line?.dispose(); }
  snapshot(): { fishingLineVisible: boolean } { return {fishingLineVisible:this.line?.root.visible??false}; }
}
