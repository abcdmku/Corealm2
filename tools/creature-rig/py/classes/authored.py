"""Authored motion for bodies (or states) no studio donor covers.

A centipede, a walking flower maw and a radial star have no studio take to retarget, and a snail
donor has no strike. Their motion is keyed here and baked into a Blender file that the donor
loader reads like any studio file, so authored takes go through the same rest-relative retarget,
validation and review as donor takes.

A class registers a motion set with @motion("name") and names it in its donors.json as
{"pack": "authored", "name": "name", ...}. The set returns a rig and its takes:

  rig    Rig.bones([(name, parent, head, tail), ...]) builds a fresh armature (glTF metres), or
         Rig.donor({"ref": "animal_snail"}) extends a studio rig with new takes.
  takes  Take objects. A take keys bone rotations and the hips offset on cubic spline curves:
         keys are (frame, value) with value in degrees about the rest pose's world axes, relative
         to the parent (+X is the creature's left, +Y up, +Z forward), so a key reads as "pitch
         the neck 20 degrees nose-down". Tangents are auto-clamped (flat at every turning point,
         as Blender's auto-clamped Bezier handles are), so a strike eases out of its anticipation
         and overshoots only where a key says so. Keys may be (frame, value, "linear") for a
         constant-speed stretch. Loop takes wrap their tangents, and a closing frame equal to the
         first is added.

The curves are evaluated at every frame at 30 fps and keyed into a Blender action, one per take
(saved with a fake user), in <donor cache>/authored/<name>.blend. Building is deterministic and
runs whenever the donor loads, so the file never goes stale.
"""
import os

import numpy as np

from crlib import donor as donors_mod
from crlib.mathx import BLENDER_FROM_GLTF, GLTF_FROM_BLENDER, axis_angle, orthonormalize, quat_from_matrix, to_blender

FPS = donors_mod.FPS
MOTIONS = {}


def motion(name):
    def register(fn):
        MOTIONS[name] = fn
        return fn
    return register


# ------------------------------------------------------------------ curves
def _tangents(times, values, modes):
    """Auto-clamped tangents: Catmull-Rom slope, zero on any component that turns at the key
    (no overshoot between keys) and zero where a key asks for "flat" (ease in and out). The end
    keys of a one-shot are flat: it starts and ends at rest."""
    T = np.zeros_like(values)
    for i in range(1, len(times) - 1):
        if modes[i] == "flat":
            continue
        slope = (values[i + 1] - values[i - 1]) / (times[i + 1] - times[i - 1])
        turning = (values[i] - values[i - 1]) * (values[i + 1] - values[i]) <= 0
        T[i] = np.where(turning, 0.0, slope)
    return T


class Curve:
    """A vector-valued cubic Hermite spline through keys (frame, value[, mode]). A loop curve is
    periodic over loop_frames: its keys repeat a period before and after, so tangents wrap."""

    def __init__(self, keys, loop_frames=None):
        keys = [(float(k[0]), np.broadcast_to(np.asarray(k[1], float), (3,)), k[2] if len(k) > 2 else "auto") for k in keys]
        if loop_frames is not None:
            N = float(loop_frames)
            base = sorted(((f % N, v, m) for f, v, m in keys), key=lambda k: k[0])
            keys = [(f - N, v, m) for f, v, m in base] + base + [(f + N, v, m) for f, v, m in base]
        keys = sorted(keys, key=lambda k: k[0])
        self.t = np.array([k[0] for k in keys])
        self.v = np.array([k[1] for k in keys])
        self.mode = [k[2] for k in keys]
        self.T = _tangents(self.t, self.v, self.mode) if len(keys) > 1 else np.zeros_like(self.v)

    def __call__(self, f):
        t, v, T = self.t, self.v, self.T
        if len(t) == 1 or f <= t[0]:
            return v[0].copy()
        if f >= t[-1]:
            return v[-1].copy()
        i = int(np.searchsorted(t, f, side="right")) - 1
        h = t[i + 1] - t[i]
        s = (f - t[i]) / h
        if self.mode[i] == "linear":
            return v[i] + s * (v[i + 1] - v[i])
        h00, h10, h01, h11 = 2 * s**3 - 3 * s**2 + 1, s**3 - 2 * s**2 + s, -2 * s**3 + 3 * s**2, s**3 - s**2
        return h00 * v[i] + h10 * h * T[i] + h01 * v[i + 1] + h11 * h * T[i + 1]


def rotvec_matrix(deg):
    r = np.radians(np.asarray(deg, float))
    a = np.linalg.norm(r)
    return np.eye(3) if a < 1e-12 else axis_angle(r / a, a)


# ------------------------------------------------------------------ takes
class Take:
    """One authored clip over frames 0..frames: the cycle length of a loop (its closing frame
    repeats frame 0) or the last key of a one-shot."""

    def __init__(self, name, frames, loop=False):
        self.name, self.frames, self.loop = name, int(frames), loop
        self.rot = {}
        self.offset = {}
        self.planted = []

    def _curve(self, keys):
        return Curve(keys, self.frames if self.loop else None)

    def key(self, bone, keys):
        """Rotation keys (frame, (x, y, z) degrees about world axes, relative to the parent)."""
        if bone in self.rot:
            raise ValueError(f"{self.name}: {bone} keyed twice; merge the keys")
        self.rot[bone] = self._curve(keys)
        return self

    def move(self, bone, keys):
        """Offset keys (frame, (x, y, z) metres) for the hips."""
        self.offset[bone] = self._curve(keys)
        return self

    def chain(self, bones, keys, delay=0.0, gain=None):
        """Keys the bones of a chain with the same curve, each one delay frames after the one
        before it and scaled by gain[i]: follow-through down a neck, a tail or a stalk."""
        gain = gain if gain is not None else [1.0] * len(bones)
        for i, b in enumerate(bones):
            shifted = []
            for k in keys:
                f = k[0] + i * delay
                if not self.loop and f > self.frames:
                    continue
                shifted.append((f, np.asarray(k[1], float) * gain[i], *k[2:]))
            if not self.loop and shifted and shifted[0][0] > 0:
                shifted.insert(0, (0, np.zeros(3)))
            self.key(b, shifted)
        return self

    def plant(self, *legs):
        """Keeps these legs' feet where they stand at rest while the body above them moves:
        each leg is (hip, knee, ankle); the hip and knee are solved as two-bone IK every frame
        (bending in the plane the leg already bends in) and the foot stays flat."""
        self.planted.extend(legs)
        return self

    @property
    def length(self):
        """Keyed frames 0..frames: a loop's last frame repeats its first; a one-shot ends on its
        last key."""
        return self.frames + 1

    def pose(self, f):
        return ({b: rotvec_matrix(c(f)) for b, c in self.rot.items()},
                {b: c(f) for b, c in self.offset.items()})


# ------------------------------------------------------------------ rigs
class Rig:
    def __init__(self, bones=None, donor=None):
        self.bone_list, self.donor_spec = bones, donor

    @staticmethod
    def bones(bones):
        return Rig(bones=bones)

    @staticmethod
    def donor(spec):
        return Rig(donor=spec)


def _make_armature(bones):
    import bpy

    data = bpy.data.armatures.new("Authored")
    obj = bpy.data.objects.new("Authored", data)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head, tail in bones:
        eb = data.edit_bones.new(name)
        eb.head, eb.tail = to_blender(head), to_blender(tail)
        if parent:
            eb.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def _plant(take, rots, offsets, order, parent, heads):
    """Two-bone IK on the take's planted legs (glTF world axes); returns the new rotations."""
    from crlib.mathx import min_arc
    from crlib.retarget import two_bone_ik

    I = np.eye(3)
    D, P = {}, {}
    for b in order:
        p = parent[b]
        D[b] = (D[p] if p else I) @ rots.get(b, I)
        P[b] = (P[p] + D[p] @ (heads[b] - heads[p]) if p else heads[b].copy()) + offsets.get(b, 0.0)
    rots = dict(rots)
    for hip, knee, ankle in take.planted:
        H, K, A = P[hip], P[knee], P[ankle]
        new_knee, reach = two_bone_ik(H, K, heads[ankle], np.linalg.norm(K - H), np.linalg.norm(A - K))
        d1 = min_arc(K - H, new_knee - H)
        A1 = H + d1 @ (A - H)
        d2 = min_arc(A1 - new_knee, reach - new_knee)
        D_hip, D_knee = d1 @ D[hip], d2 @ d1 @ D[knee]
        rots[hip] = D[parent[hip]].T @ D_hip
        rots[knee] = D_hip.T @ D_knee
        rots[ankle] = D_knee.T  # the planted foot keeps its rest orientation
    return rots


def build(spec, cache_dir):
    """Donor pack preset: builds the motion set's .blend and returns its rig + takes spec."""
    import bpy

    name = spec["name"]
    if name not in MOTIONS:
        raise KeyError(f"no authored motion set {name}; the class module registers it on import")
    rig, takes = MOTIONS[name](spec)
    out_dir = os.path.join(cache_dir, "authored")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{name}.blend")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    if rig.donor_spec is not None:
        base = donors_mod.expand(rig.donor_spec, cache_dir)
        donors_mod._import(donors_mod.resolve_file(base.get("rig") or base, cache_dir))
        scene = bpy.context.scene
        arm = donors_mod._armature(base.get("armature"))
    else:
        arm = _make_armature(rig.bone_list)
    scene.render.fps, scene.render.fps_base = FPS, 1.0

    world = np.array(arm.matrix_world)
    scale = np.linalg.norm(world[:3, :3], axis=0).mean()
    Robj = orthonormalize(world[:3, :3])
    rest = {b.name: orthonormalize(np.array(b.matrix_local)[:3, :3]) for b in arm.data.bones}
    B, G = BLENDER_FROM_GLTF, GLTF_FROM_BLENDER
    order = [b.name for b in arm.data.bones]
    parent = {b.name: b.parent.name if b.parent else None for b in arm.data.bones}
    heads = {b.name: G @ (world @ np.append(np.array(b.head_local), 1.0))[:3] for b in arm.data.bones}
    if arm.animation_data is None:
        arm.animation_data_create()
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    result = {}
    for take in takes:
        missing = [b for b in list(take.rot) + list(take.offset) if b not in arm.pose.bones]
        if missing:
            raise KeyError(f"{name}/{take.name}: no bones {missing}")
        action = bpy.data.actions.new(f"authored:{take.name}")
        action.use_fake_user = True
        arm.animation_data.action = action
        for f in range(take.length):
            rots, offsets = take.pose(f)
            if take.planted:
                rots = _plant(take, rots, offsets, order, parent, heads)
            for pb in arm.pose.bones:
                R = rots.get(pb.name)
                q = np.array([0.0, 0.0, 0.0, 1.0])
                if R is not None:
                    Ra = Robj.T @ (B @ R @ G) @ Robj
                    q = quat_from_matrix(rest[pb.name].T @ Ra @ rest[pb.name])
                pb.rotation_quaternion = (q[3], q[0], q[1], q[2])
                pb.keyframe_insert("rotation_quaternion", frame=f)
                o = offsets.get(pb.name)
                if o is not None:
                    local = rest[pb.name].T @ (Robj.T @ (B @ o)) / scale
                    pb.location = tuple(local)
                    pb.keyframe_insert("location", frame=f)
        result[take.name] = {"file": out, "action": action.name}
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.ops.wm.save_as_mainfile(filepath=out)
    return {"rig": out, "takes": result}


donors_mod.PACKS["authored"] = build
