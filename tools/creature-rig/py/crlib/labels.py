"""Semantic labels for a generic source rig (Tripo "Other": bone_0 ... bone_N plus neutral_bone).

label(joints) turns the joint tree and bind positions into body parts:

  legs    [{side, order, chain, attach, tip}]  chains from the body to a ground-touching tip, by side
                                               ("l" is +X, the creature's left) and order (0 = front)
  spine   [joint, ...]   pelvis (where the hind legs attach) to chest (where the front limbs attach)
  neck    [joint, ...]   chest to head, exclusive
  head    joint          where the head's own branches (jaw, horns, ears) part, else the last neck joint
  jaw     [joint, ...]   the head branch whose tip is lowest and furthest forward, if any
  headExtras [[...]]     other head branches (horns, ears, crests)
  tail    [joint, ...]   pelvis to the rear tip of the body's midline
  limbs   [{side, kind, chain, attach, leaves}]  other lateral branches off the body: "wing" (branched,
                                               or longer than half the height and rising) or "arm"
  legHubs [joint, ...]   bones off the axis that only carry legs (Tripo joins both hind legs this way)
  root    joint|None     a root bone lying on the ground under the body (it is not the pelvis)
  other   [joint, ...]   everything else (tiny tip helpers, loose spikes)

Coordinates are glTF, +Y up, facing +Z (the intake maps source joints into the production space,
which faces +Z). neutral_bone is dropped. reassign_neutral() moves its skin weight to the nearest
labelled bone and reports where that mesh sits (a large share usually means an unrigged wing or
fin).

  py -3.13 tools/creature-rig/py/crlib/labels.py <rig.glb> [--png out.png]   (checks one download)
"""
import json
import re
import struct
import sys

import numpy as np

NEUTRAL = re.compile(r"neutral", re.I)
GENERIC = re.compile(r"^(bone_?\d+|neutral_bone|Armature|Root)$", re.I)


def is_generic(joints):
    """True when a rig's names carry no meaning (Tripo "Other" rigs)."""
    names = [j["name"] for j in joints]
    return sum(bool(GENERIC.match(n)) for n in names) >= 0.8 * len(names)


# ------------------------------------------------------------------ glb
def read_glb(path):
    """Joints (name, parent, bind position), bind vertices and skin weights of a skinned GLB."""
    data = open(path, "rb").read()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    blob = data[bin_start:]
    types = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    sizes = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def accessor(i):
        a = gltf["accessors"][i]
        view = gltf["bufferViews"][a["bufferView"]]
        dt = np.dtype(types[a["componentType"]])
        k = sizes[a["type"]]
        stride = view.get("byteStride") or dt.itemsize * k
        off = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        raw = np.frombuffer(blob, np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * k, offset=off)
        out = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], k * dt.itemsize), strides=(stride, 1))
        out = np.ascontiguousarray(out).view(dt).reshape(a["count"], k).astype(float)
        if a.get("normalized") and dt.kind in "ui":
            out /= np.iinfo(dt).max
        return out

    nodes = gltf["nodes"]
    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    skin = gltf["skins"][0]
    ibm = accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    joint_set = set(skin["joints"])
    joints = []
    for k, ni in enumerate(skin["joints"]):
        bind = np.linalg.inv(ibm[k])
        p = parent.get(ni)
        joints.append({"name": nodes[ni].get("name", f"joint_{k}"), "parent": nodes[p].get("name") if p in joint_set else None,
                       "position": bind[:3, 3].tolist()})
    V, J, W = [], [], []
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            a = prim["attributes"]
            if "JOINTS_0" not in a:
                continue
            V.append(accessor(a["POSITION"]))
            J.append(accessor(a["JOINTS_0"]).astype(int))
            W.append(accessor(a["WEIGHTS_0"]))
    return joints, np.vstack(V), np.vstack(J), np.vstack(W)


# ------------------------------------------------------------------ labels
def label(joints, height=None):
    names = [j["name"] for j in joints if not NEUTRAL.search(j["name"])]
    keep = set(names)
    pos = {j["name"]: np.asarray(j["position"], float) for j in joints if j["name"] in keep}
    parent = {j["name"]: (j["parent"] if j["parent"] in keep else None) for j in joints if j["name"] in keep}
    all_children = {n: [c for c in names if parent[c] == n] for n in names}
    P = np.array([pos[n] for n in names])
    floor = P[:, 1].min()
    H = height or float(np.ptp(P[:, 1])) or 1.0
    size = max(H, float(np.ptp(P[:, 2])), float(np.ptp(P[:, 0])))
    mid_x = float(np.median(P[:, 0]))
    y = lambda n: pos[n][1] - floor
    flat = lambda v: float(np.hypot(v[0], v[2]))

    def subtree(n, kids=None):
        kids = kids or all_children
        out, stack = [], [n]
        while stack:
            c = stack.pop()
            out.append(c)
            stack += kids[c]
        return out

    # Nubs: helper tips a few millimetres long (Tripo adds them at limb ends). They are labelled
    # "other" and ignored when reading the tree's shape.
    nub = set()
    for n in names:
        for c in all_children[n]:
            sub = subtree(c)
            if max(np.linalg.norm(pos[m] - pos[n]) for m in sub) < 0.03 * size:
                nub.update(sub)
    children = {n: [c for c in all_children[n] if c not in nub] for n in names}
    shape = [n for n in names if n not in nub]
    leaves = [n for n in shape if not children[n]]

    def path_up(n):
        out = [n]
        while parent[out[-1]]:
            out.append(parent[out[-1]])
        return out  # n ... root

    def tree_path(a, b):
        ua, ub = path_up(a), path_up(b)
        common = next(n for n in ua if n in ub)
        return ua[:ua.index(common) + 1] + ub[:ub.index(common)][::-1]

    plen = lambda p: sum(np.linalg.norm(pos[p[i + 1]] - pos[p[i]]) for i in range(len(p) - 1))
    near_mid = lambda n: abs(pos[n][0] - mid_x) < 0.08 * size
    root = next(n for n in names if parent[n] is None)
    ground_root = root if y(root) < 0.1 * H and children[root] else None

    # ----------------------------------------------------------- legs
    # A leg ends in a tip in the lower part of the body, below where it joins. From each such tip,
    # climb while the rest of the parent's subtree is the same foot (other tips within a foot's
    # reach, e.g. toes); stop where another limb or the body joins.
    def lowish(n):
        return y(n) < 0.3 * H

    legs, used = [], set()
    for leaf in sorted([n for n in leaves if lowish(n)], key=lambda n: y(n)):
        if leaf in used:
            continue
        node = leaf
        while parent[node] and parent[node] != ground_root:
            p = parent[node]
            other_leaves = [l for c in children[p] if c != node for l in subtree(c, children) if not children[l]]
            if not all(lowish(l) and flat(pos[l] - pos[leaf]) < 0.08 * size for l in other_leaves) or not parent[p]:
                break
            node = p
        chain = path_up(leaf)[::-1]
        chain = chain[chain.index(node):]
        attach = parent[node]
        drop = (y(attach) if attach else y(node)) - y(leaf)
        lateral = abs(pos[node][0] - mid_x) > 0.02 * size or abs(pos[leaf][0] - mid_x) > 0.05 * size
        if len(chain) < 2 or plen(chain) < 0.2 * H or drop < 0.15 * H or not lateral:
            continue
        legs.append({"chain": chain, "attach": attach, "tip": leaf, "side": "l" if pos[leaf][0] > mid_x else "r"})
        used.update(subtree(node))
    for side in "lr":
        mine = sorted([g for g in legs if g["side"] == side], key=lambda g: -pos[g["chain"][0]][2])
        for i, g in enumerate(mine):
            g["order"] = i
    leg_nodes = {n for g in legs for n in subtree(g["chain"][0])}

    # ----------------------------------------------------------- body axis
    # The midline: the longest tree path between two midline tips outside the legs; its front end
    # (larger z) is the head, the rear end the tail or abdomen. With one midline tip the axis runs
    # from it to the hub where most legs join (a spider's cephalothorax is its head).
    counts = {}
    for g in legs:
        counts[g["attach"]] = counts.get(g["attach"], 0) + 1
    hub = max(counts, key=counts.get) if counts else (children[ground_root][0] if ground_root else root)
    ends = [n for n in shape if n not in leg_nodes and n != ground_root and near_mid(n)
            and not [c for c in children[n] if c not in leg_nodes]]
    best = None
    for i, a in enumerate(ends):
        for b in ends[i + 1:]:
            p = tree_path(a, b)
            if best is None or plen(p) > plen(best):
                best = p
    if best is None:
        best = tree_path(ends[0], hub) if ends else [hub]
        if len(best) > 1 and pos[best[0]][2] > pos[hub][2]:
            best = best[::-1]  # the one tip is the head: hub ... head
    if pos[best[0]][2] > pos[best[-1]][2]:
        best = best[::-1]  # rear ... front
    axis = best
    on_axis = set(axis)
    # Where legs and other lateral limbs join the axis marks the pelvis (rearmost) and chest
    # (frontmost). Limbs joining off the axis (via a shared hub bone) count at their axis joint.
    def axis_joint(n):
        while n is not None and n not in on_axis:
            n = parent[n]
        return n

    marks = {axis_joint(g["attach"]) for g in legs} - {None}
    lateral_roots = []
    for n in axis:
        for c in children[n]:
            if c in on_axis or c in leg_nodes:
                continue
            sub = subtree(c, children)
            if all(m in leg_nodes for m in sub[1:]):
                continue  # a hub bone the legs share (Tripo joins both hind legs this way)
            if any(abs(pos[m][0] - mid_x) > 0.1 * size for m in sub):
                lateral_roots.append(c)
                marks.add(n)
    idx = sorted(axis.index(m) for m in marks) if marks else [axis.index(hub)] if hub in on_axis else [0]
    hind_i, chest_i = idx[0], idx[-1]
    head_i = len(axis) - 1 if chest_i == len(axis) - 1 else len(axis) - 2
    for i in range(len(axis) - 2, chest_i, -1):
        if any(c not in on_axis and c not in leg_nodes and c not in lateral_roots for c in children[axis[i]]):
            head_i = i
            break
    head_i = max(head_i, chest_i)
    strip = lambda seq: [n for n in seq if n != ground_root]
    out = {
        "root": ground_root,
        "legs": legs,
        "tail": strip(axis[:hind_i][::-1]),
        "spine": strip(axis[hind_i:chest_i + 1]),
        "neck": strip(axis[chest_i + 1:head_i]),
        "head": axis[head_i],
        "headTip": axis[-1],
    }
    # Head branches (not lateral limbs): the jaw is the lowest one that points forward.
    head = axis[head_i]
    chains = []
    for c in children[head]:
        if c in on_axis or c in leg_nodes or c in lateral_roots:
            continue
        sub = subtree(c, children)
        chains.append(tree_path(c, max(sub, key=lambda m: np.linalg.norm(pos[m] - pos[head]))))
    cand = [c for c in chains if pos[c[-1]][1] < pos[head][1] and pos[c[-1]][2] > pos[head][2] - 0.02 * size]
    jaw = max(cand, key=lambda c: (pos[c[-1]][2] - pos[head][2]) - 2.0 * (pos[c[-1]][1] - pos[head][1])) if cand else None
    out["jaw"] = jaw or []
    out["headExtras"] = [c for c in chains if c is not jaw]
    claimed = leg_nodes | on_axis | {n for c in chains for n in subtree(c[0], children)}
    # Other lateral limbs off the axis: wings (branched, or longer than half the height) or arms.
    limbs = []
    for c in lateral_roots:
        n = parent[c]
        sub = subtree(c, children)
        tip = max(sub, key=lambda m: np.linalg.norm(pos[m] - pos[n]))
        reach = np.linalg.norm(pos[tip] - pos[n])
        sub_leaves = [m for m in sub if not children[m]]
        limbs.append({"side": "l" if pos[tip][0] > mid_x else "r", "attach": n, "chain": tree_path(c, tip),
                      "leaves": len(sub_leaves), "kind": "wing" if len(sub) >= 3 and (len(sub_leaves) >= 2 or (reach > 0.5 * H and pos[tip][1] > pos[n][1])) else "arm"})
        claimed |= set(sub)
    out["limbs"] = limbs
    out["legHubs"] = sorted({g["attach"] for g in legs if g["attach"] not in on_axis})
    claimed |= set(out["legHubs"])
    out["other"] = [n for n in names if n not in claimed and n != ground_root]
    return out


def segments(joints):
    """Bone segments of a joint tree: joint to the mean of its children (a leaf is a point)."""
    pos = {j["name"]: np.asarray(j["position"], float) for j in joints}
    kids = {}
    for j in joints:
        if j["parent"]:
            kids.setdefault(j["parent"], []).append(j["name"])
    heads, tails = [], []
    for j in joints:
        heads.append(pos[j["name"]])
        tails.append(np.mean([pos[c] for c in kids[j["name"]]], axis=0) if j["name"] in kids else pos[j["name"]])
    return np.array(heads), np.array(tails)


def reassign_neutral(joints, V, J, W):
    """Moves neutral_bone weight to the nearest other bone segment. Returns (J, W, neutral share,
    {joint: share of the reassigned weight})."""
    from .skin import segment_distance

    names = [j["name"] for j in joints]
    neutral = [i for i, n in enumerate(names) if NEUTRAL.search(n)]
    if not neutral:
        return J, W, 0.0, {}
    heads, tails = segments(joints)
    usable = np.array([not NEUTRAL.search(n) for n in names])
    W = W / np.maximum(W.sum(1, keepdims=True), 1e-12)
    on = np.isin(J, neutral) & (W > 0)
    rows = np.nonzero(on.any(1))[0]
    share = float(W[on].sum() / len(W))
    moved = {}
    if len(rows):
        d = segment_distance(V[rows], heads, tails)
        d[:, ~usable] = np.inf
        nearest = np.argmin(d, axis=1)
        J, W = J.copy(), W.copy()
        for r, b in zip(rows, nearest):
            amount = W[r][np.isin(J[r], neutral)].sum()
            W[r][np.isin(J[r], neutral)] = 0.0
            slot = np.nonzero(J[r] == b)[0]
            if len(slot) == 0:
                slot = [int(np.argmin(W[r]))]
                J[r][slot[0]] = b
            W[r][slot[0]] += amount
            moved[names[b]] = moved.get(names[b], 0.0) + float(amount)
        moved = {k: round(v / len(W), 4) for k, v in sorted(moved.items(), key=lambda kv: -kv[1])}
    return J, W, share, moved


def sheet(path, joints, V, labels, title="", neutral=None):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    pos = {j["name"]: np.asarray(j["position"], float) for j in joints}
    colour = {}
    for g in labels["legs"]:
        for n in g["chain"]:
            colour[n] = ("#2f7de1" if g["side"] == "l" else "#1bb3c9", f"leg {g['side']}{g['order']}")
    for key, c in (("spine", "#111111"), ("neck", "#555555"), ("tail", "#b34bd6"), ("jaw", "#d9442b")):
        for n in labels[key]:
            colour[n] = (c, key)
    colour[labels["head"]] = ("#e0a800", "head")
    for ch in labels["headExtras"]:
        for n in ch:
            colour[n] = ("#e0a800", "head extra")
    for limb in labels["limbs"]:
        for n in limb["chain"]:
            colour[n] = ("#2fb35a" if limb["kind"] == "wing" else "#8bc34a", f"{limb['kind']} {limb['side']}")
    fig, axes = plt.subplots(1, 3, figsize=(21, 7))
    rng = np.random.default_rng(0)
    pick = rng.choice(len(V), size=min(len(V), 5000), replace=False)
    sample = V[pick]
    tint = np.where(neutral[pick], "#f28b82", "#b9c0c8") if neutral is not None else "#b9c0c8"
    for ax, (u, v, name) in zip(axes, ((0, 1, "front (x: creature left to the left)"), (2, 1, "side (z: forward)"), (0, 2, "top"))):
        flip = -1 if u == 0 else 1
        ax.scatter(flip * sample[:, u], sample[:, v], s=0.5, c=tint, alpha=0.5)
        for j in joints:
            if j["parent"] and j["parent"] in pos and j["name"] in pos:
                a, b = pos[j["parent"]], pos[j["name"]]
                c = colour.get(j["name"], ("#999999", "other"))[0]
                ax.plot([flip * a[u], flip * b[u]], [a[v], b[v]], "-", color=c, lw=2)
        for n, (c, lab) in colour.items():
            ax.plot(flip * pos[n][u], pos[n][v], "o", color=c, ms=3)
        for g in labels["legs"]:
            p = pos[g["tip"]]
            ax.annotate(f"{g['side']}{g['order']}", (flip * p[u], p[v]), fontsize=8)
        ax.set_aspect("equal")
        ax.set_title(name)
    fig.suptitle(title)
    fig.savefig(path, dpi=90)
    plt.close(fig)


def main(argv):
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--png")
    args = ap.parse_args(argv)
    joints, V, J, W = read_glb(args.glb)
    labels = label(joints)
    J2, W2, share, moved = reassign_neutral(joints, V, J, W)
    summary = {k: v for k, v in labels.items() if k not in ("legs", "limbs")}
    summary["legs"] = [f"{g['side']}{g['order']}: {'>'.join(g['chain'])} (from {g['attach']})" for g in labels["legs"]]
    summary["limbs"] = [f"{l['kind']} {l['side']}: {'>'.join(l['chain'])} (from {l['attach']}, {l['leaves']} tips)" for l in labels["limbs"]]
    summary["neutralShare"] = round(share, 4)
    summary["neutralTo"] = dict(list(moved.items())[:8])
    print(json.dumps(summary, indent=1))
    if args.png:
        names = [j["name"] for j in joints]
        nb = [i for i, n in enumerate(names) if NEUTRAL.search(n)]
        heavy = (np.isin(J, nb) * W).sum(1) > 0.5 * W.sum(1)
        sheet(args.png, joints, V, labels, f"{args.glb} (red: mesh on neutral_bone)", heavy)


if __name__ == "__main__":
    import os

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from crlib.labels import main as _main  # re-import as a package module so relative imports work

    _main(sys.argv[1:])
