"""Winged class: flying insects (wasps) and winged fae (imps, sprites) that hover on beating wings.

Profiles pick the body plan with "body":
  insect  a thorax, a head, a hanging abdomen ending in a sting, legs hanging under the thorax and
          wings on the thorax: the plan of the donor, the Quaternius Easy Enemy wasp
  fae     a small humanoid (torso and head on a medial line, arms, legs) carrying wings on its back

Both are driven by the wasp's takes, so flight is the native locomotion of every clip: Idle, Walk
and Run all play its flying cycle, Attack its sting strike and Death its fall. The wasp has no hit
take; Hit is left to the runtime's hit fallback.

Body parts are measured on the mesh. The body proper (head, thorax and abdomen, or torso and head)
is the solid opened by two voxels, which strips every thin appendage; the appendages are the
connected pieces of the surface standing off it. Long, flat, membrane-thin appendages are wings.
On an insect the rest are legs, antennae and the sting, told apart by where they attach along the
medial line from the head to the abdomen's end. On a fae they are arms (lateral), legs (reaching
the floor of the grounded bind pose) and ornaments that ride the body.

Wings are thin sheets. Each gets a 3-bone chain along its span (root to tip, joints on the
centroid line of shells of distance from the hinge). The root bone adds the donor wing's motion on
top of the wing's own rest (follow 0), so fore and hind wings keep their own spread and beat
together; the outer bones follow it. Membrane weights are hats along the span, like cloth(); bone
heat would bleed across the thin membrane to the body bones.

Every other bone also adds its donor bone's motion to its own rest (follow 0): these bodies keep
their authored silhouette (a curled sting, hanging legs) and take the wasp's bob, pitch, abdomen
swing and strike on top of it.
"""
import json
import os

import numpy as np
from scipy import ndimage
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from classes import authored
from crlib import donor as donors_mod
from crlib.body import resample
from crlib.mathx import normalize, quat_from_matrix, slerp_matrix
from crlib.skeleton import Skeleton
from crlib.skin import adjacency

NAME = "winged"
HERE = os.path.dirname(os.path.abspath(__file__))


# ------------------------------------------------------------------ body regions
def _proper_core(body, iterations=2):
    """The body without its appendages: the solid opened by `iterations` voxels, largest piece."""
    ball = ndimage.generate_binary_structure(3, 1)
    opened = ndimage.binary_opening(body.solid, structure=ball, iterations=iterations)
    labels, count = ndimage.label(opened)
    if count > 1:
        sizes = ndimage.sum(opened, labels, range(1, count + 1))
        opened = labels == 1 + int(np.argmax(sizes))
    return opened


def _appendages(body, proper, gap):
    """Connected pieces of the surface standing more than gap off the body proper. Each is
    {idx, hinge, near} with near the piece's vertex closest to the body and hinge the point
    between it and the body surface."""
    V, F = body.verts, body.faces
    pts = body.to_world(np.argwhere(proper))
    tree = cKDTree(pts)
    d, k = tree.query(V)
    mask = d > gap
    adj = adjacency(len(V), F)
    idx = np.nonzero(mask)[0]
    count, label = connected_components(adj[mask][:, mask], directed=False)
    out, crumbs = [], []
    for c in range(count):
        m = idx[label == c]
        if len(m) < 8:
            crumbs.append(m)
            continue
        near = int(m[np.argmin(d[m])])
        hinge = 0.5 * (V[near] + pts[k[near]])
        out.append({"idx": m, "near": near, "hinge": hinge})
    # Crumbs (a few loose vertices, such as a vein shard floating on a wing) join the appendage
    # they sit on, or they would stay behind when it moves.
    if out:
        owner = np.concatenate([np.full(len(p["idx"]), i) for i, p in enumerate(out)])
        ptree = cKDTree(V[np.concatenate([p["idx"] for p in out])])
        for m in crumbs:
            dist, j = ptree.query(V[m])
            if dist.min() < 4 * gap:
                p = out[owner[j[np.argmin(dist)]]]
                p["idx"] = np.concatenate([p["idx"], m])
    return out, d


def _extent(points):
    """Singular values of the centred points (largest first): a sheet has a small third one."""
    return np.linalg.svd(points - points.mean(0), compute_uv=False) / np.sqrt(max(len(points), 1))


def _is_wing(body, part):
    """A long, flat and membrane-thin appendage (a T-posed arm with a flat hand is flat and long
    too, but it is thicker through)."""
    P = body.verts[part["idx"]]
    s = _extent(P)
    span = np.linalg.norm(P - part["hinge"], axis=1).max()
    thin = np.quantile(body.thickness()[part["idx"]], 0.8) < 0.02 * body.height
    return span > 0.3 * body.height and s[2] < 0.5 * s[1] and thin


def _centre_line(body, part, bands=10):
    """Polyline from the hinge to the far tip of an appendage: centroids of shells of distance
    from the hinge (wing and leg meshes are too sparse for surface geodesics to be reliable)."""
    V = body.verts
    m = part["idx"]
    g = np.linalg.norm(V[m] - part["hinge"], axis=1)
    tip = V[m[np.argmax(g)]]
    edges = np.linspace(0, g.max(), bands + 1)
    line = [part["hinge"]]
    for a, b in zip(edges[1:-1], edges[2:]):
        sel = m[(g >= a) & (g <= b)]
        if len(sel):
            line.append(V[sel].mean(0))
    line.append(tip)
    return np.array(line)


def _split(line, fractions):
    """Joints along a polyline at arc fractions (0 and 1 included)."""
    pts, _ = resample(line, 200)
    return [pts[int(round(np.clip(f, 0, 1) * 200))] for f in fractions]


def _tip(donor, bone):
    """A donor bone's far end: its FBX leaf bone (<name>_end) when it has one, else its tail."""
    return donor.rest_head.get(f"{bone}_end", donor.rest_tail[bone])


def _donor_fractions(donor, chain, end=None):
    """Cumulative arc fractions of a donor bone chain's joints (its heads, then the last tail)."""
    P = [donor.rest_head[b] for b in chain] + [_tip(donor, chain[-1]) if end is None else donor.rest_head[end]]
    seg = np.linalg.norm(np.diff(np.array(P), axis=0), axis=1)
    return np.concatenate([[0], np.cumsum(seg) / seg.sum()])


# ------------------------------------------------------------------ wings
def _add_wings(sk, body, parts, parent_of, mid_x, attached, off, gap):
    """Wing chains (3 bones root to tip) for the wing parts; fore = the one with the higher tip.

    A wing vertex far off the wing's plane (a stray fan of membrane reaching back to the body's
    midline) or lying on the body away from the hinge stays with the body; carried by the wing it
    would stick out as a spike."""
    wings = []
    for part in parts:
        V = body.verts[part["idx"]]
        span = np.linalg.norm(V - part["hinge"], axis=1)
        centre = np.median(V, axis=0)
        _, s, vt = np.linalg.svd(V - centre, full_matrices=False)
        plane = np.abs((V - centre) @ vt[2])
        stray = plane > max(4 * np.median(plane), 0.04 * body.height)
        resting = stray | ((off[part["idx"]] < 3 * gap) & (span > 0.2 * span.max()))
        if part.get("whole"):
            # A wing modelled as its own loose piece moves whole: a vertex of it left with the
            # body tears the membrane open at the hinge.
            resting[:] = False
        part = {**part, "idx": part["idx"][~resting], "resting": int(resting.sum())}
        line = _centre_line(body, part)
        side = "l" if np.mean(body.verts[part["idx"], 0]) > mid_x else "r"
        wings.append({"part": part, "line": line, "side": side, "tip_y": line[-1][1]})
    specs = []
    for side in ("l", "r"):
        mine = sorted([w for w in wings if w["side"] == side], key=lambda w: -w["tip_y"])
        for i, w in enumerate(mine):
            w["name"] = ("wing" if len(mine) == 1 else f"wing_{('fore', 'hind', 'third')[min(i, 2)]}") + f"_{side}"
            specs.append(w)
    for w in specs:
        pts, _ = resample(w["line"], 3)
        parent = parent_of(pts[0])
        bones = []
        for i in range(3):
            name = f"{w['name']}_{i + 1:02d}"
            donor = ("Wing.L" if w["side"] == "l" else "Wing.R") if i == 0 else None
            sk.add(name, parent, pts[i], pts[i + 1], donor=donor, follow=0.0, kind="wing", heat=False)
            bones.append(name)
            parent = name
        w["bones"] = bones
        w["attached"] = attached
    return specs


def _wing_override(body, sk, wings):
    """Membrane weights: hats on the chain's bone midpoints along the span (arc fraction of the
    nearest point of the chain), blended into the body's heat weights near an attached root."""
    V = body.verts
    names = sk.names()

    def override(W):
        W = W.copy()
        fixed = np.zeros(len(V), bool)
        if W.shape[1] < len(names):
            W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
        for w in wings:
            idx = w["part"]["idx"]
            P = V[idx]
            bones = w["bones"]
            joints = np.array([sk[b].head for b in bones] + [sk[bones[-1]].tail])
            links = len(bones)
            best = np.full(len(P), np.inf)
            t = np.zeros(len(P))
            for s in range(links):
                a, b = joints[s], joints[s + 1]
                ab = b - a
                u = np.clip((P - a) @ ab / max(ab @ ab, 1e-12), 0, 1)
                dist = np.linalg.norm(P - (a + u[:, None] * ab), axis=1)
                better = dist < best
                best[better] = dist[better]
                t[better] = (s + u[better]) / links
            chain_w = np.zeros((len(idx), len(names)))
            centres = (np.arange(links) + 0.5) / links
            for bi, bname in enumerate(bones):
                hat = np.clip(1 - np.abs(t - centres[bi]) * links, 0, 1)
                if bi == 0:
                    hat[t < centres[0]] = 1.0
                if bi == links - 1:
                    hat[t > centres[-1]] = 1.0
                chain_w[:, names.index(bname)] = hat
            chain_w /= np.maximum(chain_w.sum(1, keepdims=True), 1e-9)
            if w["attached"]:
                a = np.clip(t / 0.12, 0, 1)
                a = a * a * (3 - 2 * a)
            else:
                a = np.ones(len(idx))
            heat = W[idx] / np.maximum(W[idx].sum(1, keepdims=True), 1e-9)
            W[idx] = (1 - a)[:, None] * heat + a[:, None] * chain_w
            fixed[idx] = a > 0.5
        return W, fixed

    return override


# ------------------------------------------------------------------ insect
LEG_ROWS = ("Top", "Mid", "Bottom")  # donor leg pairs, front to back


def _profile_minima(r, count=2, margin=0.06):
    """The count most prominent local minima of a radius profile, away from its ends."""
    n = len(r)
    lo, hi = int(margin * n), int((1 - margin) * n)
    found = []
    for i in range(max(lo, 1), min(hi, n - 1)):
        if r[i] <= r[i - 1] and r[i] <= r[i + 1]:
            prominence = min(r[:i].max(), r[i + 1:].max()) - r[i]
            found.append((prominence, i))
    found.sort(reverse=True)
    return sorted(i for _, i in found[:count])


def _fit_insect(body, donor, profile):
    H = body.height
    V = body.verts
    proper = _proper_core(body, profile.get("openVoxels", 2))
    proper_pts = body.to_world(np.argwhere(proper))
    proper_dt = ndimage.distance_transform_edt(proper) * body.h
    mid_x = float(np.median(proper_pts[:, 0]))
    notes = {}

    # Medial line from the front of the head to the far end of the abdomen, inside the body proper.
    head_front = proper_pts[np.argmax(proper_pts[:, 2] - 2.0 * np.abs(proper_pts[:, 0] - mid_x))]
    dist, pred = body.geodesic(head_front)
    inside = proper[tuple(body.nodes.T)]
    far = int(np.argmax(np.where(inside & np.isfinite(dist), dist, -1)))
    path, _ = resample(body.path(pred, far), 200)
    radius = np.array([proper_dt[tuple(np.clip(body.to_index(p), 0, np.array(proper.shape) - 1))] for p in path])
    radius = np.convolve(np.pad(radius, 4, mode="edge"), np.ones(9) / 9, mode="valid")
    # The waist (petiole) is the deepest narrowing; the thorax is the thickest point in front of
    # it. A head often sits on the thorax without a narrowing in the medial radius, so the neck is
    # the smallest cross-section near the donor's head-to-thorax proportion.
    waists = [i for i in _profile_minima(radius, 3) if i > 0.2 * len(radius)]
    if not waists:
        raise RuntimeError("insect body: no waist along the medial line from the head to the abdomen")
    waist_i = waists[0]
    thorax_i = int(np.argmax(radius[:waist_i]))
    hd = [_tip(donor, "Head"), donor.rest_head["Head"], donor.rest_head["Neck"], donor.rest_head["Thorax"]]
    seg = np.linalg.norm(np.diff(np.array(hd), axis=0), axis=1)
    prior = int(round(seg[0] / seg.sum() * thorax_i))
    window = range(max(2, int(0.6 * prior)), max(int(1.4 * prior), int(0.6 * prior) + 1) + 1)
    area = {i: body.section_centroid(path[i], path[min(i + 3, 200)] - path[max(i - 3, 0)], 0.3 * H)[1] for i in window}
    neck_i = min(window, key=lambda i: area[i])
    head_joint = path[neck_i]
    thorax = path[thorax_i]
    waist = path[waist_i]
    notes["medial"] = {"neck": head_joint.tolist(), "thorax": thorax.tolist(), "waist": waist.tolist(), "end": path[-1].tolist()}

    gap = profile.get("appendageGap", 2.0) * body.h
    parts, off = _appendages(body, proper, gap)
    tree = cKDTree(path)
    wings, legs, head_parts, sting = [], [], [], None
    for part in parts:
        at = int(tree.query(part["hinge"])[1])
        part["at"] = at
        if _is_wing(body, part):
            wings.append(part)
        elif at >= 190:
            if sting is None or len(part["idx"]) > len(sting["idx"]):
                sting = part
        elif at <= neck_i:
            head_parts.append(part)
        elif V[part["idx"], 1].min() < part["hinge"][1] - 0.08 * H:
            legs.append(part)  # hangs below where it attaches
        else:
            head_parts.append(part)
    notes["appendages"] = {"wings": len(wings), "legs": len(legs), "other": len(head_parts), "sting": sting is not None}

    sk = Skeleton()
    root_head = np.array([thorax[0], 0.0, thorax[2]])
    sk.add("root", None, root_head, root_head + [0, 0.1 * H, 0], donor="Root", follow=0.0, kind="root", heat=False)
    sk.add("thorax", "root", thorax, head_joint, donor="Thorax", follow=0.0)
    sk.add("head", "thorax", head_joint, path[0], donor="Head", follow=0.0)

    # Abdomen: waist to the end of the medial line, then on to the sting's tip, split in the
    # donor's proportions.
    abdomen = path[waist_i:]
    if sting is not None:
        abdomen = np.vstack([abdomen, _centre_line(body, sting)[1:]])
    chain = ["Abdomen", "Abdomen2", "Abdomen3", "Sting"]
    joints = _split(abdomen, _donor_fractions(donor, chain, None))
    names = ["abdomen_01", "abdomen_02", "abdomen_03", "sting"]
    parent = "thorax"
    for i, name in enumerate(names):
        sk.add(name, parent, joints[i], joints[i + 1], donor=chain[i], follow=0.0, kind="tail")
        parent = name

    # Legs: per side, front to back, onto the donor's leg pairs.
    for side in ("l", "r"):
        mine = [p for p in legs if (np.mean(V[p["idx"], 0]) > mid_x) == (side == "l")]
        mine.sort(key=lambda p: -p["hinge"][2])
        rows = LEG_ROWS if len(mine) >= 3 else LEG_ROWS[:len(mine)]
        for row, part in zip(rows, mine):
            d = f"{row}Leg%d.{side.upper()}"
            dchain = [d % 1, d % 2, d % 3]
            line = _centre_line(body, part)
            joints = _split(line, _donor_fractions(donor, dchain))
            parent = "thorax"
            for i in range(3):
                name = f"leg_{row.lower()}_{side}_{i + 1:02d}"
                sk.add(name, parent, joints[i], joints[i + 1], donor=dchain[i], follow=0.0, kind="leg")
                parent = name

    wing_specs = _add_wings(sk, body, wings, lambda p: "thorax", mid_x, attached=True, off=off, gap=gap)
    sk.winged = {"wings": wing_specs}
    notes["wings"] = [{"name": w["name"], "root": w["line"][0].tolist(), "tip": w["line"][-1].tolist(), "leftToBody": w["part"]["resting"]} for w in wing_specs]
    return sk, notes


# ------------------------------------------------------------------ fae
# A winged fae is a small humanoid: torso and head on a medial line, arms and legs as appendages.
# Its flight (Idle, Walk, Run) is the wasp's: the pelvis carries the thorax's bob and pitch, the
# wings the wasp's beat, with the arms layered from a humanoid treading the air (UAL
# Swim_Idle_Loop). Its hit is a humanoid (UAL) take with the wasp's wings layered on, its death the
# wasp's fall. A sprite's strike is a humanoid cast with the wings layered on; an imp's is the
# wasp's own lunge with its arms layered from a claw swipe (UAL2 Zombie_Scratch). Arms copy their donor's orientation (follow 1), as a humanoid's do, so a humanoid take poses
# them whatever the bind. The legs dangle: they have no donor twin in either and hang as damped
# spring chains from the pelvis, so they swing behind the body and never pass through the floor.
ARM_DONOR = ("TopLeg1", "TopLeg2", "TopLeg3")
UAL_MAP = {"root": "root", "pelvis": "pelvis", "spine": "spine_03", "Head": "Head",
           **{f"{b}_{s}": f"{b}_{s}" for b in ("upperarm", "lowerarm", "hand") for s in ("l", "r")}}


class _Proportions:
    """Rest joint positions of a glTF skeleton (read from the file's node tree, no Blender import),
    standing in for a donor where only its proportions are used."""

    def __init__(self, path):
        import struct

        data = open(path, "rb").read()
        length = struct.unpack_from("<I", data, 12)[0]
        gltf = json.loads(data[20:20 + length])
        nodes = gltf["nodes"]
        parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}

        def local(n):
            if "matrix" in n:
                return np.array(n["matrix"]).reshape(4, 4).T
            x, y, z, w = n.get("rotation", [0, 0, 0, 1])
            R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                          [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                          [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
            M = np.eye(4)
            M[:3, :3] = R * np.array(n.get("scale", [1, 1, 1]))
            M[:3, 3] = n.get("translation", [0, 0, 0])
            return M

        world = {}

        def get(i):
            if i not in world:
                world[i] = (get(parent[i]) if i in parent else np.eye(4)) @ local(nodes[i])
            return world[i]

        self.rest_head = {nodes[j]["name"]: get(j)[:3, 3] for j in gltf["skins"][0]["joints"]}


def _humanoid_fractions():
    """Joint fractions of a humanoid arm (shoulder, elbow, wrist, middle fingertip) and leg (hip,
    knee, ankle, toe) from the Universal Animation Library rest skeleton."""
    from crlib.donor import resolve_file

    spec = json.load(open(os.path.join(HERE, "humanoid.donors.json")))["donors"]["ual1"]
    cache = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "test-results", "creature-motion", "rig", "donors"))
    rest = _Proportions(resolve_file(spec, cache)).rest_head

    def fractions(names):
        seg = np.linalg.norm(np.diff(np.array([rest[n] for n in names]), axis=0), axis=1)
        return np.concatenate([[0], np.cumsum(seg) / seg.sum()])

    return {"arm": fractions(["upperarm_l", "lowerarm_l", "hand_l", "middle_03_l"]),
            "leg": fractions(["thigh_l", "calf_l", "foot_l", "ball_l"])}


def _loose_pieces(body):
    count, label = connected_components(adjacency(len(body.verts), body.faces), directed=False)
    return label, np.bincount(label, minlength=count)


def _fit_fae(body, donor, profile):
    H = body.height
    V = body.verts
    proper = _proper_core(body, profile.get("openVoxels", 2))
    proper_pts = body.to_world(np.argwhere(proper))
    gap = profile.get("appendageGap", 2.0) * body.h
    parts, off = _appendages(body, proper, gap)
    mid_x = float(np.median(proper_pts[:, 0]))
    wings, arms, legs, other = [], [], [], []
    for part in parts:
        P = V[part["idx"]]
        span = np.linalg.norm(P - part["hinge"], axis=1).max()
        if _is_wing(body, part):
            wings.append(part)
        elif span < 0.12 * H:
            other.append(part)
        elif P[:, 1].min() < 0.12 * H:
            legs.append(part)  # reaches the floor of the grounded bind pose
        elif np.abs(P[:, 0] - mid_x).mean() > 0.1 * H:
            arms.append(part)
        else:
            other.append(part)
    notes = {"appendages": {"wings": len(wings), "arms": len(arms), "legs": len(legs), "other": len(other)}}

    def by_side(found):
        # A pair is told apart by x even when both sit on one side of the midline (legs held
        # together); the largest two count, extra pieces stay with the body.
        found = sorted(found, key=lambda p: -len(p["idx"]))[:2]
        if len(found) == 2:
            found.sort(key=lambda p: -V[p["idx"], 0].mean())
            return {"l": found[0], "r": found[1]}
        return {("l" if V[p["idx"], 0].mean() > mid_x else "r"): p for p in found}

    arms, legs = by_side(arms), by_side(legs)

    # Medial line of the torso from between the hips up to the crown.
    top = proper_pts[np.argmax(proper_pts[:, 1] - 2.0 * np.abs(proper_pts[:, 0] - mid_x))]
    if legs:
        hips = np.mean([p["hinge"] for p in legs.values()], axis=0)
        hips[0] = mid_x
    else:
        hips = proper_pts[np.argmin(proper_pts[:, 1] + 2.0 * np.abs(proper_pts[:, 0] - mid_x))]
    hips[1] += 0.05 * H  # above the crotch, inside the body
    _, pred = body.geodesic(top)
    path, _ = resample(body.path(pred, body.nearest_node(hips))[::-1], 200)  # hips -> crown
    path[:, 0] = mid_x  # a winged fae is left-right symmetric; keep the torso on its midline
    # Neck: the smallest cross-section of the line above the arms.
    shoulder_y = np.mean([p["hinge"][1] for p in arms.values()]) if arms else path[120][1]
    band = [i for i in range(100, 190) if path[i][1] >= shoulder_y] or list(range(140, 190))
    area = {i: body.section_centroid(path[i], path[min(i + 3, 200)] - path[max(i - 3, 0)], 0.3 * H)[1] for i in band}
    neck_i = min(band, key=lambda i: area[i])
    chest_i = neck_i // 2
    notes["medial"] = {"hips": path[0].tolist(), "chest": path[chest_i].tolist(), "neck": path[neck_i].tolist(), "crown": path[-1].tolist()}

    sk = Skeleton()
    root_head = np.array([path[chest_i // 2][0], 0.0, path[chest_i // 2][2]])
    sk.add("root", None, root_head, root_head + [0, 0.1 * H, 0], donor="Root", follow=0.0, kind="root", heat=False)
    # The pelvis turns about the middle of the lower torso, where the wasp's thorax turns, so a
    # pitch swings the body about its mass instead of about the hips.
    sk.add("pelvis", "root", path[chest_i // 2], path[chest_i], donor="Thorax", follow=0.0)
    sk.add("spine", "pelvis", path[chest_i], path[neck_i], donor="Neck", follow=0.0)
    sk.add("Head", "spine", path[neck_i], path[-1], donor="Head", follow=0.0)

    prior = _humanoid_fractions()
    for side, part in arms.items():
        joints = _split(_centre_line(body, part), prior["arm"])
        parent = "spine"
        for i, name in enumerate(("upperarm", "lowerarm", "hand")):
            sk.add(f"{name}_{side}", parent, joints[i], joints[i + 1], donor=f"{ARM_DONOR[i]}.{side.upper()}", follow=1.0, kind="arm")
            parent = f"{name}_{side}"
    for side, part in legs.items():
        joints = _split(_centre_line(body, part), prior["leg"])
        parent = "pelvis"
        for i, name in enumerate(("thigh", "calf", "foot")):
            sk.add(f"{name}_{side}", parent, joints[i], joints[i + 1], donor=None, follow=0.0, kind="leg")
            parent = f"{name}_{side}"

    # A loose wing piece is a wing whole: its part near the body would otherwise keep heat weights
    # and shear off the moving wing.
    label, sizes = _loose_pieces(body)
    for part in wings:
        pieces = np.unique(label[part["idx"]])
        small = pieces[sizes[pieces] < 0.1 * len(V)]
        part["idx"] = np.unique(np.concatenate([part["idx"], np.nonzero(np.isin(label, small))[0]]))
        part["whole"] = bool(len(small)) and bool(np.isin(label[part["idx"]], small).all())
    wing_specs = _add_wings(sk, body, wings, lambda p: "spine", mid_x, attached=False, off=off, gap=gap)
    sk.winged = {"wings": wing_specs}
    notes["wings"] = [{"name": w["name"], "root": w["line"][0].tolist(), "tip": w["line"][-1].tolist(), "leftToBody": w["part"]["resting"]} for w in wing_specs]
    return sk, notes


# ------------------------------------------------------------------ contract
def fit(body, donor, profile, source=None):
    kind = profile.get("body", "insect")
    if kind == "insect":
        return _fit_insect(body, donor, profile)
    if kind == "fae":
        return _fit_fae(body, donor, profile)
    raise ValueError(f"winged: unknown body {kind}")


def cloth(body, sk, profile, heat):
    wings = getattr(sk, "winged", {}).get("wings")
    return _wing_override(body, sk, wings) if wings else None


def bind_turns(sk, profile):
    """A T-posed fae is re-bound with its arms lowered to bindArmAngle (default 50 degrees) below
    horizontal, the middle of the range its donor drives, as the humanoid class does."""
    from crlib.mathx import min_arc

    target = np.radians(profile.get("bindArmAngle", 50.0))
    turns = {}
    for side in ("l", "r"):
        if f"upperarm_{side}" not in sk:
            continue
        b = sk[f"upperarm_{side}"]
        d = normalize(b.tail - b.head)
        if np.degrees(np.arcsin(np.clip(-d[1], -1, 1))) >= 35.0:
            continue
        flat = normalize(np.array([d[0], 0.0, d[2]]))
        turns[b.name] = min_arc(d, flat * np.cos(target) + np.array([0.0, -np.sin(target), 0.0]))
    return turns


def plan(sk, body, profile):
    from crlib.retarget import CapsuleCollider

    hips = "thorax" if "thorax" in sk else "pelvis"
    chains, colliders = [], []
    legs = [[f"{n}_{s}" for n in ("thigh", "calf", "foot")] for s in ("l", "r") if f"thigh_{s}" in sk]
    for bones in legs:
        chains.append({"bones": bones, "stiffness": profile.get("legStiffness", 30.0), "damping": 6.0,
                       "gravity": 0.0, "hang": profile.get("legHang", 0.2), "clearance": 0.0})
    if legs:
        for bone in ("pelvis", "spine"):
            b = sk[bone]
            colliders.append(CapsuleCollider(sk, bone, 0.9 * body.radius_at(0.5 * (b.head + b.tail))))
    return {"hips": hips, "legs": [], "chains": chains, "colliders": colliders,
            "hip_motion": profile.get("hipMotion", 1.0), "hip_mode": profile.get("hipMode", "vertical")}


def donor_map(sk, donor, profile):
    """A humanoid (UAL) donor drives the fae's torso, head and arms by their humanoid names."""
    if donor.key.startswith("ual"):
        return {name: UAL_MAP.get(name) for name in sk.names()}
    return None


def recoil_bones(sk, plan, profile):
    """A flier has nothing planted: every bone past the root and the hips may take the hit."""
    return [b.name for b in sk.bones if b.parent is not None and b.name != plan["hips"] and b.deform]


def closeup_joints(sk, profile):
    names = ["wing_fore_l_01", "wing_hind_l_01", "abdomen_02", "sting", "leg_top_l_02", "upperarm_l", "thigh_l", "head", "Head"]
    return [n for n in names if n in sk][:5]


# ------------------------------------------------------------------ derived hit
HIT_RECOIL, HIT_RETURN = 6, 10  # frames at 30 fps


def _rotvec_deg(R):
    q = quat_from_matrix(R)
    if q[3] < 0:
        q = -q
    angle = 2.0 * np.arccos(np.clip(q[3], -1.0, 1.0))
    s = np.sin(angle / 2.0)
    return np.zeros(3) if s < 1e-9 else np.degrees(angle) * q[:3] / s


@authored.motion("wasp_hit")
def _wasp_hit(spec):
    """The wasp has no hit take. Its Death opens with a recoil (the body jerks up and back while
    the wings keep beating); Wasp_Hit is that first beat, blended back into Wasp_Flying at the
    same wing phase (the two takes beat identically over these frames), so the wasp flinches and
    flies on. Every value comes from the donor's sampled takes; nothing is keyed by hand."""
    d = donors_mod.load("wasp_src", {"ref": "quat_enemy_wasp"}, spec["_cache"], ["Wasp_Death", "Wasp_Flying"])
    death, fly = d.clips["Wasp_Death"], d.clips["Wasp_Flying"]
    # The loader turned the donor to face +Z; authored keys are in the raw file's axes.
    from crlib.mathx import axis_angle

    Ry = axis_angle([0.0, 1.0, 0.0], np.radians(d.report.get("yaw", 0)))
    frames = HIT_RECOIL + HIT_RETURN
    t = np.clip((np.arange(frames + 1) - HIT_RECOIL) / HIT_RETURN, 0.0, 1.0)
    w = t * t * (3 - 2 * t)

    def delta(clip, f, b):
        # The bone's rotation relative to its parent, away from rest, in armature axes.
        i, p = d.index(b), d.parent[b]
        W = clip["frames"][f][i]
        if p is None:
            return W @ d.rest_frame[b].T
        Wp = clip["frames"][f][d.index(p)]
        return d.rest_frame[p] @ Wp.T @ W @ d.rest_frame[b].T

    take = authored.Take("Wasp_Hit", frames)
    for b in d.bones:
        keys = [(f, _rotvec_deg(Ry.T @ slerp_matrix(delta(death, f, b), delta(fly, f, b), w[f]) @ Ry)) for f in range(frames + 1)]
        take.key(b, keys)
    # Only Body (a child of the static root) is translated in these frames' hover and recoil.
    i = d.index("Body")
    rest = d.rest_head["Body"]
    take.move("Body", [(f, Ry.T @ ((1 - w[f]) * death["heads"][f][i] + w[f] * fly["heads"][f][i] - rest)) for f in range(frames + 1)])
    return authored.Rig.donor({"ref": "quat_enemy_wasp"}), [take]
