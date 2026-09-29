"""Golem class: heavy bipeds (stone, lava and crystal golems, bark treants) on the humanoid
skeleton. The humanoid module fits the skeleton, skins it and makes the capes; this module adds
what makes a heavy body read as heavy and a rock or bark body move as rock or bark:

- quietBones: torso bones that take no donor motion of their own and ride their parent rigidly.
  A human donor's walk spreads a twist and a sway over three spine bones; a golem's torso is one
  block, so only the lower spine carries it.
- rigidByThickness: rock plates, crystals and bark plates. Loose pieces (not joined to the body
  surface) that are thick and compact, and pieces bone heat shares between two neighbouring
  bones, are bound rigidly to their dominant bone so they do not bend like skin. Thin loose pieces
  (fringes, moss) keep smooth weights.
- branches: treant branches, antlers and fronds that stand off the head and shoulders become
  spring chains (kind "tail", one chain each), driven by the core's follow-through simulation.

Profiles are in golem.donors.json.
"""
import numpy as np
from scipy.sparse.csgraph import connected_components

from classes import humanoid
from crlib.body import Body, resample
from crlib.skin import adjacency

NAME = "golem"


# ---------------------------------------------------------------- skeleton
def fit(body, donor, profile, source=None):
    fit_body = body
    thin, _ = body.thin_vertices()
    if thin.mean() > profile.get("refitThinShare", 0.12):
        # Spindly limbs and claws thinner than two voxels vanish from the opened core, and the
        # fit then ends the arms at the elbows. Measure on a finer grid (the body the skin and
        # capes use stays the default one).
        fit_body = Body(body.verts, body.faces, resolution=profile.get("fineResolution", 200))
    sk, notes = humanoid.fit(fit_body, donor, profile, source=source)
    notes["fitResolution"] = round(float(fit_body.height / fit_body.h))
    notes["thinShare"] = round(float(thin.mean()), 3)
    sk.notes = notes  # cloth() records the rigid plates here; rig.json keeps the notes
    if profile.get("soleJoints", True):
        _sole_joints(sk, profile)
    for name in profile.get("quietBones", []):
        if name in sk:
            sk[name].donor = None
    if profile.get("branches"):
        notes["branches"] = _branches(body, sk, notes, profile)
    return sk, notes


def _sole_joints(sk, profile):
    """A golem's foot is a block whose sole sits well below the humanoid ball joint (placed at a
    third of the ankle height). The core pitches the foot and toes so the ball and the toe tip
    follow the donor's heights, which keeps those points above the floor but lets the sole's
    front corner dip through it at toe-off. Joints on the sole make the points it protects the
    sole's own."""
    for side in ("l", "r"):
        foot, ball = f"foot_{side}", f"ball_{side}"
        if foot not in sk:
            continue
        y = profile.get("soleHeight", 0.12) * sk[foot].head[1]
        sk[ball].head[1] = y
        sk[ball].tail[1] = y
        sk[foot].tail = sk[ball].head.copy()


def _segment_distance(p, a, b):
    ab = b - a
    t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-12), 0, 1)
    return float(np.linalg.norm(p - (a + t * ab)))


def _branches(body, sk, notes, profile):
    """Spring chains for the tips the humanoid fit left unused: each runs from where the branch
    leaves the body (the medial path's first point within reach of a bone) to its tip."""
    H = body.height
    seed = np.array(notes["seed"])
    ext, dist, pred = body.extremities(seed, 0.07 * H, 0.12 * H)
    used = [np.array(p) for p in notes["tips"].values()]
    shoulder_y = notes["shoulder_y"]
    hosts = [b for b in sk.bones if b.kind != "root" and b.name.split("_")[0] in (
        "Head", "neck", "spine", "clavicle", "upperarm")]
    min_len = profile.get("branchMinLength", 0.12) * H
    added = []
    for e in ext:
        tip = e["position"]
        if any(np.linalg.norm(tip - u) < 0.1 * H for u in used) or tip[1] < shoulder_y - 0.05 * H:
            continue
        pts = body.path(pred, e["node"])[::-1]  # tip -> core
        # Where the branch joins: the first point whose medial radius reaches the host limb's
        # surface (the core is thicker than the branch there), measured against host bones.
        base_k = None
        for k, p in enumerate(pts):
            near = min(hosts, key=lambda b: _segment_distance(p, b.head, b.tail))
            reach = _segment_distance(p, near.head, near.tail)
            if reach <= body.radius_at(p) + 0.5 * body.radius_at(0.5 * (near.head + near.tail)):
                base_k = k
                break
        if base_k is None or base_k < 3:
            continue
        seg = pts[:base_k + 1][::-1]  # base -> tip
        length = float(np.sum(np.linalg.norm(np.diff(seg, axis=0), axis=1)))
        if length < min_len:
            continue
        host = min(hosts, key=lambda b: _segment_distance(seg[0], b.head, b.tail))
        links = 3 if length > 0.25 * H else 2
        joints, _ = resample(seg, links)
        k = len(added) + 1
        parent = host.name
        names = []
        for i in range(links):
            name = f"branch{k:02d}_{i + 1:02d}"
            sk.add(name, parent, joints[i], joints[i + 1], kind="tail")
            names.append(name)
            parent = name
        added.append({"host": host.name, "bones": names, "tip": tip.tolist(), "length": length})
    return added


def plan(sk, body, profile):
    out = humanoid.plan(sk, body, profile)
    # humanoid.plan makes every tail bone one chain; each branch is its own chain here.
    tails = {b.name for b in sk.bones if b.kind == "tail"}
    chains = [c for c in out["chains"] if not set(c["bones"]) & tails]
    groups = {}
    for b in sk.bones:
        if b.kind == "tail":
            groups.setdefault(b.name.split("_")[0], []).append(b.name)
    for bones in groups.values():
        chains.append({"bones": bones, "stiffness": profile.get("branchStiffness", 90.0),
                       "damping": profile.get("branchDamping", 9.0), "gravity": 0.0, "hang": 0.0,
                       "clearance": 0.0})
    out["chains"] = chains
    return out


def bind_turns(sk, profile):
    return humanoid.bind_turns(sk, profile)


# -------------------------------------------------------------------- skin
def cloth(body, sk, profile, heat):
    """Capes from the humanoid module, then foot blocks, then rigid rock, crystal and bark
    plates. Returns the weight override skin() applies before smoothing."""
    capes = humanoid.cloth(body, sk, profile, heat) if profile.get("cloth", True) else None
    H = body.height
    V, F = body.verts, body.faces
    names = sk.names()

    def feet(W):
        """Everything below the ankle is the foot block. Bone heat hands the heel behind the
        ankle to the calf, and a heel that turns with the shin digs into the floor at every
        heel strike. Calf and thigh weight moves to the foot below the ankle, blended over a
        band around it."""
        for side in ("l", "r"):
            foot = f"foot_{side}"
            if foot not in sk:
                continue
            ankle = sk[foot].head
            other = sk[f"foot_{'r' if side == 'l' else 'l'}"].head
            mine = np.linalg.norm(V[:, [0, 2]] - ankle[[0, 2]], axis=1) < np.linalg.norm(V[:, [0, 2]] - other[[0, 2]], axis=1)
            near = mine & (np.linalg.norm(V[:, [0, 2]] - ankle[[0, 2]], axis=1) < 0.25 * H)
            lo, hi = 0.8 * ankle[1], 1.4 * ankle[1]
            t = np.clip((hi - V[:, 1]) / max(hi - lo, 1e-6), 0, 1) * near
            t = t * t * (3 - 2 * t)
            f = names.index(foot)
            for leg in (f"calf_{side}", f"thigh_{side}"):
                k = names.index(leg)
                move = W[:, k] * t
                W[:, k] -= move
                W[:, f] += move
        return W

    thick = body.thickness() if profile.get("rigidByThickness") else None
    count, label = connected_components(adjacency(len(V), F), directed=False)
    sizes = np.bincount(label, minlength=count)
    parents = {i: names.index(b.parent) if b.parent else -1 for i, b in enumerate(sk.bones)}
    max_share = profile.get("plateMaxShare", 0.12)
    min_thick = profile.get("plateMinThickness", 0.02) * H

    def plates(W, fixed):
        found = {}
        for c in range(count):
            rows = (label == c) & ~fixed
            if sizes[c] > max_share * len(V) or sizes[c] < 12 or not rows.any():
                continue
            # A plate is thick through (a fringe or a moss strand is not) and compact: its
            # extent is small next to the body, so it rides one bone.
            if np.median(thick[rows]) < min_thick or np.ptp(V[rows], axis=0).max() > 0.35 * H:
                continue
            mass = W[rows].sum(0)
            bone = int(np.argmax(mass))
            # Heat on a loose piece split between a bone and its parent or child (a shoulder
            # plate between the clavicle and the upper arm) still means one plate: bind it whole.
            related = {bone, parents.get(bone, -1)} | {i for i, p in parents.items() if p == bone}
            if sum(mass[i] for i in related if i >= 0) / max(mass.sum(), 1e-9) < 0.6:
                continue
            W[rows] = 0.0
            W[rows, bone] = 1.0
            fixed |= rows
            found[names[bone]] = found.get(names[bone], 0) + int(rows.sum())
        sk.notes["rigidPlates"] = found
        return W, fixed

    def override(W):
        W, fixed = capes(W) if capes else (W, np.zeros(len(V), bool))
        if W.shape[1] < len(names):
            W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
        W = feet(W)
        if profile.get("rigidByThickness"):
            W, fixed = plates(W, fixed)
        return W, fixed

    return override
