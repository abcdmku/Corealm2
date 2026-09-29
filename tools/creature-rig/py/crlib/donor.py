"""Studio donor motion: resolve a donor file, import it headless and sample clips.

A donor entry in a class donor map looks like
  {"zip": "<archive>", "member": "<path inside>", "files": ["<already extracted copies>"]}
Licensed studio sources are extracted into the git-ignored work area, never into the repo.

Sampling reads evaluated pose matrices, so the result is independent of how the importer oriented
bones: every bone gets its rest frame, and per frame its world rotation and head position (glTF
coordinates), which is all the retargeter needs.
"""
import os
import zipfile

import numpy as np

from .mathx import GLTF_FROM_BLENDER, orthonormalize

FPS = 30


def resolve(spec, cache_dir):
    for f in spec.get("files", []):
        if os.path.exists(f):
            return f
    if spec.get("zip") and os.path.exists(spec["zip"]):
        os.makedirs(cache_dir, exist_ok=True)
        out = os.path.join(cache_dir, os.path.basename(spec["member"]))
        if not os.path.exists(out):
            with zipfile.ZipFile(spec["zip"]) as z, z.open(spec["member"]) as src, open(out, "wb") as dst:
                dst.write(src.read())
        return out
    raise FileNotFoundError(f"donor not found: {spec}")


class Donor:
    """Rest data and sampled clips of one donor armature."""

    def __init__(self, key, path):
        self.key = key
        self.path = path
        self.bones = []
        self.parent = {}
        self.rest_frame = {}
        self.rest_head = {}
        self.rest_tail = {}
        self.clips = {}

    def index(self, name):
        return self.bones.index(name)

    def chain(self, names):
        """Joins takes authored to follow each other; the shared boundary frame is kept once."""
        key = "+".join(names)
        parts = [self.clips[n] for n in names]
        frames = np.concatenate([parts[0]["frames"]] + [p["frames"][1:] for p in parts[1:]])
        heads = np.concatenate([parts[0]["heads"]] + [p["heads"][1:] for p in parts[1:]])
        self.clips[key] = {"frames": frames, "heads": heads, "fps": FPS, "duration": (len(frames) - 1) / FPS}
        return key


def load(key, path, clip_names):
    """Imports the donor into an empty Blender file and samples the named clips at 30 fps."""
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    donor = Donor(key, path)
    world = np.array(arm.matrix_world)
    C = GLTF_FROM_BLENDER
    for b in arm.data.bones:
        donor.bones.append(b.name)
        donor.parent[b.name] = b.parent.name if b.parent else None
        m = world @ np.array(b.matrix_local)
        donor.rest_frame[b.name] = orthonormalize(C @ m[:3, :3])
        donor.rest_head[b.name] = C @ m[:3, 3]
        donor.rest_tail[b.name] = C @ (world @ np.append(np.array(b.tail_local), 1.0))[:3]

    if arm.animation_data is None:
        arm.animation_data_create()
    actions = {a.name: a for a in bpy.data.actions}
    for name in clip_names:
        action = actions.get(name) or next((a for n, a in actions.items() if n.endswith(name) or n.split("|")[-1] == name), None)
        if action is None:
            raise KeyError(f"{key}: no clip {name}; has {sorted(actions)[:80]}")
        arm.animation_data.action = action
        if hasattr(arm.animation_data, "action_slot") and len(getattr(action, "slots", [])):
            arm.animation_data.action_slot = action.slots[0]
        start, end = action.frame_range
        count = int(round((end - start))) + 1
        frames = np.zeros((count, len(donor.bones), 3, 3))
        heads = np.zeros((count, len(donor.bones), 3))
        for f in range(count):
            scene.frame_set(int(start) + f)
            for i, bone in enumerate(donor.bones):
                pb = arm.pose.bones[bone]
                m = world @ np.array(pb.matrix)
                frames[f, i] = orthonormalize(C @ m[:3, :3])
                heads[f, i] = C @ m[:3, 3]
        donor.clips[name] = {"frames": frames, "heads": heads, "fps": FPS, "duration": (count - 1) / FPS}
    return donor
