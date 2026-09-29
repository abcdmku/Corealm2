"""Treant class: the humanoid body plan (two arms, a head, two root legs) with a heavy profile.

The Bloomheart Matriarch and the Amethyst Sovereign are one Tripo tree spirit: a biped with
branch arms, a flower crown and a leaf skirt. Fitting, the skirt panels, the arm re-bind and the
retarget plan are the humanoid class's; this module carries its own donor map (treant profiles).

Blender's bone heat fails on this mesh as a whole (59 loose pieces, some interpenetrating: the
solve finds no solution and returns no weight at all), but succeeds piece by piece. cloth() is the
first class hook that sees the heat weights, so it fills them per loose piece in place before the
humanoid cloth step reads them.
"""
import numpy as np

from classes import humanoid
from classes.humanoid import bind_turns  # noqa: F401

NAME = "special_treant"


def heat_by_pieces(sk, heat):
    """Bone heat per loose piece, written into heat (vertices x bones) in place."""
    import bpy

    from crlib.skin import bone_heat

    src = next(o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) == len(heat))
    copy = src.copy()
    copy.data = src.data.copy()
    copy.modifiers.clear()
    copy.vertex_groups.clear()
    bpy.context.scene.collection.objects.link(copy)
    layer = copy.data.attributes.new("source_index", "INT", "POINT")
    layer.data.foreach_set("value", np.arange(len(heat), dtype=np.int32))
    for o in bpy.data.objects:
        o.select_set(False)
    copy.select_set(True)
    bpy.context.view_layer.objects.active = copy
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    for piece in pieces:
        idx = np.zeros(len(piece.data.vertices), dtype=np.int32)
        piece.data.attributes["source_index"].data.foreach_get("value", idx)
        W = bone_heat(piece, sk)
        heat[idx] = W[:, :heat.shape[1]]
        for arm in [o for o in bpy.data.objects if o.type == "ARMATURE"]:
            bpy.data.objects.remove(arm)
        bpy.data.objects.remove(piece)
    return heat


def _armpit(body, sk):
    """Scanning down from the neck, the first slab where the torso and both arms are separate
    pieces. Returns (height, {side: (shoulder x, arm z)}) or None."""
    pelvis, neck = sk["pelvis"].head, sk["neck_01"].head
    x0 = pelvis[0]
    for y in np.arange(neck[1], pelvis[1], -0.5 * body.h):
        comps = body.slab(y, 2 * body.h)
        torso = min(comps, key=lambda c: abs(c["centroid"][0] - x0))
        half = max(abs(torso["min"][0] - x0), abs(torso["max"][0] - x0))
        arms = {}
        for side, sign in (("l", 1), ("r", -1)):
            outer = [c for c in comps if c is not torso and c["count"] > 0.2 * torso["count"] and sign * (c["centroid"][0] - x0) > half]
            if outer:
                c = min(outer, key=lambda c: abs(c["centroid"][0] - x0))
                inner = min(abs(c["min"][0] - x0), abs(c["max"][0] - x0))
                arms[side] = (x0 + sign * 0.5 * (half + inner), float(c["centroid"][1]))
        if len(arms) == 2:
            return float(y), arms
    return None


def fit(body, donor, profile, source=None):
    """The humanoid fit, with the shoulders moved to the armpit. Where a broad shoulder mass of
    branches and leaves joins the arm to the neck, the humanoid probe stops next to the neck; the
    armpit (the highest slab where both arms are clear of the torso) is where the arm leaves the
    body. The elbow is re-placed at the donor's upper-to-lower arm ratio."""
    sk, notes = humanoid.fit(body, donor, profile, source)
    found = _armpit(body, sk)
    if found is None:
        return sk, notes
    y, arms = found
    moved = {}
    for side, (x, z) in arms.items():
        up, low = sk[f"upperarm_{side}"], sk[f"lowerarm_{side}"]
        shoulder = np.array([x, y + 0.02 * body.height, z])
        if abs(shoulder[0] - sk["pelvis"].head[0]) <= abs(up.head[0] - sk["pelvis"].head[0]):
            continue
        wrist = low.tail
        a = np.linalg.norm(donor.rest_head[f"lowerarm_{side}"] - donor.rest_head[f"upperarm_{side}"])
        b = np.linalg.norm(donor.rest_head[f"hand_{side}"] - donor.rest_head[f"lowerarm_{side}"])
        elbow = shoulder + a / (a + b) * (wrist - shoulder)
        elbow[1] = max(elbow[1], low.head[1]) if elbow[1] < low.head[1] else elbow[1]
        sk[f"clavicle_{side}"].tail = shoulder
        up.head, up.tail = shoulder, elbow
        low.head = elbow
        moved[side] = {"shoulder": shoulder.tolist(), "elbow": elbow.tolist()}
    notes["armpitShoulders"] = moved
    return sk, notes


def plan(sk, body, profile):
    """The humanoid plan; the leaf skirt reaches the ground, so its chains keep a clearance of a
    few per cent of the height (the hem stays on the floor instead of folding under it)."""
    out = humanoid.plan(sk, body, profile)
    for chain in out["chains"]:
        if chain.get("group"):
            chain["clearance"] = profile.get("skirtClearance", 0.03) * body.height
    return out


def crown_to_head(body, sk, heat):
    """Loose pieces of the crown (twigs and blossoms above the shoulders, clear of the arms) ride
    the head: heat alone hands a twig beside the head to the nearest arm bone."""
    from scipy.sparse.csgraph import connected_components

    from crlib.skin import adjacency

    names = sk.names()
    _, label = connected_components(adjacency(len(body.verts), body.faces), directed=False)
    sizes = np.bincount(label)
    shoulder_y = min(sk["upperarm_l"].head[1], sk["upperarm_r"].head[1])
    neck = sk["neck_01"].head
    head = names.index("Head")
    moved = 0
    for c in np.nonzero(sizes < 0.08 * len(label))[0]:
        idx = np.nonzero(label == c)[0]
        P = body.verts[idx]
        if P[:, 1].min() > shoulder_y + 0.25 * (neck[1] - shoulder_y):
            heat[idx] = 0.0
            heat[idx, head] = 1.0
            moved += len(idx)
    return moved


def cloth(body, sk, profile, heat):
    if (heat.sum(1) < 1e-6).mean() > 0.5:
        heat_by_pieces(sk, heat)
    crown_to_head(body, sk, heat)
    return humanoid.cloth(body, sk, profile, heat)
