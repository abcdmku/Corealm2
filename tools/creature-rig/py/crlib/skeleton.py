"""Target skeleton: bones with measured heads/tails, and rest frames derived from donor frames.

Rest pose == bind pose. A bone's rest frame is its donor bone's rest frame turned by the shortest
arc onto the target bone direction, so bone roll is consistent with the donor (and so twist
transfers cleanly). Bones without a donor take their parent's frame turned the same way.
"""
from dataclasses import dataclass, field

import numpy as np

from .mathx import min_arc, normalize, quat_from_matrix


@dataclass
class Bone:
    name: str
    parent: str | None
    head: np.ndarray
    tail: np.ndarray
    donor: str | None = None      # donor bone driving this bone
    follow: float = 1.0           # 1: copy donor direction (limbs); 0: add donor delta to own rest (torso)
    kind: str = "body"            # body | leg | arm | cloth | tail | root
    deform: bool = True
    heat: bool = True             # bone-heat weighting sees this bone (cloth chains are weighted by the class)
    frame: np.ndarray = field(default=None)


class Skeleton:
    def __init__(self):
        self.bones: list[Bone] = []
        self.by_name: dict[str, Bone] = {}

    def add(self, name, parent, head, tail, **kw):
        bone = Bone(name, parent, np.asarray(head, float), np.asarray(tail, float), **kw)
        self.bones.append(bone)
        self.by_name[name] = bone
        return bone

    def __getitem__(self, name):
        return self.by_name[name]

    def __contains__(self, name):
        return name in self.by_name

    def children(self, name):
        return [b for b in self.bones if b.parent == name]

    def names(self):
        return [b.name for b in self.bones]

    def solve_frames(self, donor):
        for bone in self.bones:
            direction = normalize(bone.tail - bone.head)
            if bone.donor:
                base = donor.rest_frame[bone.donor]
            elif bone.parent:
                base = self.by_name[bone.parent].frame
            else:
                base = np.eye(3)
            bone.frame = min_arc(base[:, 1], direction) @ base

    def rest_local(self):
        """glTF rest TRS per bone (rotation xyzw, translation) relative to its parent."""
        out = {}
        for bone in self.bones:
            if bone.parent:
                p = self.by_name[bone.parent]
                r = p.frame.T @ bone.frame
                t = p.frame.T @ (bone.head - p.head)
            else:
                r, t = bone.frame, bone.head
            out[bone.name] = {"rotation": quat_from_matrix(r).tolist(), "translation": t.tolist()}
        return out

    def to_json(self):
        rest = self.rest_local()
        return [{
            "name": b.name, "parent": b.parent, "head": b.head.tolist(), "tail": b.tail.tolist(),
            "kind": b.kind, "donor": b.donor, "follow": b.follow, "deform": b.deform,
            "rotation": rest[b.name]["rotation"], "translation": rest[b.name]["translation"],
        } for b in self.bones]

    def build_blender_armature(self, name="Rig"):
        """Armature object in Blender coordinates for bone-heat weighting (deform bones only)."""
        import bpy
        from .mathx import to_blender

        data = bpy.data.armatures.new(name)
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        for bone in self.bones:
            eb = data.edit_bones.new(bone.name)
            eb.head = to_blender(bone.head)
            eb.tail = to_blender(bone.tail)
            eb.use_deform = bone.deform and bone.heat
        for bone in self.bones:
            if bone.parent:
                data.edit_bones[bone.name].parent = data.edit_bones[bone.parent]
        bpy.ops.object.mode_set(mode="OBJECT")
        return obj
