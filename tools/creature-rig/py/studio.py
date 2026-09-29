"""Studio mode: add retargeted donor clips to a studio body that keeps its own skeleton, skin and
native clips byte-identical.

  PYTHONPATH=D:/CorealmAgentCache/bpy-5.2 py -3.13 tools/creature-rig/py/studio.py [--donors <dir>] <work dir>

The asset config's "studio" block drives it (see README, "Studio mode"). The studio skeleton is
read from the production GLB, at the first frame of studio.referenceClip when one is given. Mapped
joints (studio.map: node name -> {bone, donor?, follow?, kind?, parent?, tail?, noTail?, noKey?,
translate?}) form a crlib Skeleton with the class's donor bone names; the crlib Retargeter samples
each donor clip (rest-relative, hips scaled by leg length, leg IK with ball and toe contact on every
leg: studio.legs, else the chains of the bones mapped as kind "leg", for any skeleton). Each mapped
node's new world rotation is its retargeted frame rotation carried onto the node's own reference
rotation; locals are taken against the node's real parent. Joints whose logical parent is not their
node parent (IK-baked feet) also get translation keys so they stay on the limb. Writes
<work>/studio.json for studio.mjs.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from crlib import donor as donors_mod  # noqa: E402
from crlib.glbpy import Glb  # noqa: E402
from crlib.mathx import continuous_quats, matrix_from_quat, min_arc, normalize, orthonormalize, quat_from_matrix, slerp_matrix  # noqa: E402
from crlib.retarget import Retargeter, forward  # noqa: E402
from crlib.skeleton import Skeleton  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def leg_chains(sk, leg_bones):
    """Plan legs from the bones mapped as legs: each chain of them that hangs from a non-leg bone,
    followed down while it has one leg child. Four or more bones end in a foot and a toe (ball
    contact), three in a foot, and two drive the tail of the last bone (a leg tip)."""
    legs = []
    for b in sk.bones:
        if b.name not in leg_bones or b.parent in leg_bones:
            continue
        chain = [b.name]
        while True:
            kids = [c.name for c in sk.children(chain[-1]) if c.name in leg_bones]
            if len(kids) != 1:
                break
            chain.append(kids[0])
        if len(chain) >= 4:
            legs.append({"chain": chain[:-2], "foot": chain[-2], "toe": chain[-1]})
        elif len(chain) == 3:
            legs.append({"chain": chain[:-1], "foot": chain[-1], "toe": None})
        elif len(chain) == 2:
            legs.append({"chain": chain, "foot": None, "toe": None})
    return legs


def main(work, cache):
    asset_id = os.path.basename(os.path.normpath(work))
    config = json.load(open(os.path.join(HERE, "..", "assets", f"{asset_id}.json"), encoding="utf-8"))
    cfg = config["studio"]
    manifest = json.load(open(os.path.join(REPO, "game/public/assets/manifest.json"), encoding="utf-8"))
    entry = next(a for a in manifest["assets"] if a["id"] == asset_id)
    g = Glb(os.path.join(REPO, "game/public/assets", entry["file"]))
    joints = g.json["skins"][0]["joints"]
    ref = g.clip_pose(cfg["referenceClip"], 0.0, only=set(joints)) if cfg.get("referenceClip") else None
    world = {i: g.world(i, ref) for i in range(len(g.nodes))}
    by_name = g.name_index

    # ---- donors: the class's donor map; clips from the studio block, else the class profile
    donor_map = json.load(open(os.path.join(HERE, "classes", f"{config['class']}.donors.json"), encoding="utf-8"))
    cfg = dict(cfg, clips=cfg.get("clips") or donor_map["profiles"][config["profile"]]["clips"])
    primary_key = donor_map["primary"]
    needed = {}
    for spec in cfg["clips"].values():
        for part in [spec] + ([spec["layer"]] if spec.get("layer") else []):
            takes = part["clip"] if isinstance(part["clip"], list) else [part["clip"]]
            needed.setdefault(part.get("donor", spec.get("donor")), set()).update(takes)
    needed.setdefault(primary_key, set())
    donors = {k: donors_mod.load(k, donor_map["donors"][k], cache, sorted(v)) for k, v in needed.items()}
    primary = donors[primary_key]
    for spec in cfg["clips"].values():
        for part in [spec] + ([spec["layer"]] if spec.get("layer") else []):
            if isinstance(part["clip"], list):
                part["clip"] = donors[part.get("donor", spec.get("donor"))].chain(part["clip"])

    # ---- skeleton from the studio joints
    mp = cfg["map"]  # node name -> {bone, donor, follow, kind, parent?}
    hips = cfg.get("hips", "pelvis")  # the class bone that carries the hips translation
    pos = lambda n: world[by_name[n]][:3, 3]
    bone_node = {v["bone"]: n for n, v in mp.items()}
    node_bone = {n: v["bone"] for n, v in mp.items()}

    def logical_parent(n):
        if mp[n].get("parent"):
            return mp[n]["parent"]
        i = by_name[n]
        while i in g.parent:
            i = g.parent[i]
            nm = g.nodes[i].get("name")
            if nm in mp:
                return mp[nm]["bone"]
        return "root"

    sk = Skeleton()
    root_node = cfg["rootNode"]
    root_head = pos(root_node).copy()
    root_head[1] = 0.0
    sk.add("root", None, root_head, root_head + [0, 0.1, 0], donor="root", follow=0.0, kind="root")
    order = []
    pending = list(mp)
    placed = {"root"}
    while pending:
        progressed = False
        for n in list(pending):
            if logical_parent(n) in placed:
                order.append(n)
                placed.add(mp[n]["bone"])
                pending.remove(n)
                progressed = True
        if not progressed:
            raise RuntimeError(f"unplaced {pending}")
    children = {}
    for n in order:
        children.setdefault(logical_parent(n), []).append(n)
    for n in order:
        v = mp[n]
        head = pos(n)
        kids = [c for c in children.get(v["bone"], []) if not mp[c].get("noTail")]
        if v.get("tail"):
            tail = pos(v["tail"]) if isinstance(v["tail"], str) else head + np.array(v["tail"])
        elif kids and v["bone"] != hips:
            pick = kids[0] if len(kids) == 1 else next((k for k in kids if mp[k]["bone"].startswith(("spine", "neck", "Head", "lowerarm", "hand", "calf", "foot", "ball"))), kids[0])
            tail = pos(pick)
        else:
            par = sk[logical_parent(n)]
            d = head - par.head
            if v["bone"] == "Head":
                tail = head + np.array([0, max(np.linalg.norm(d), 0.1), 0])
            elif v["bone"].startswith("ball"):
                d = head - par.head
                d[1] = 0
                tail = head + normalize(d) * 0.5 * np.linalg.norm(head - par.head)
            else:
                tail = head + 0.5 * d
        if v["bone"] == hips:
            spine = next((c for c in children.get(hips, []) if mp[c]["bone"].startswith("spine")), None)
            tail = pos(spine) if spine else head + [0, 0.1, 0]
            if np.linalg.norm(tail - head) < 1e-4:
                tail = head + [0, 0.1, 0]
        sk.add(v["bone"], logical_parent(n), head, tail, donor=v["donor"] if "donor" in v else v["bone"], follow=v.get("follow", 0.0), kind=v.get("kind", "body"))
    sk.solve_frames(primary)
    # Leg IK with ball and toe contact on every leg: the studio block's legs ({chain, foot, toe,
    # pivot?} in class bone names), else the chains of the bones mapped as kind "leg".
    if cfg.get("legs") is not None:
        legs = cfg["legs"]
    else:
        legs = leg_chains(sk, {v["bone"] for v in mp.values() if v.get("kind") == "leg"})
    plan = {"hips": hips, "legs": legs, "chains": [], "colliders": [], "hip_motion": cfg.get("hipMotion", 1.0)}
    print(f"legs {json.dumps(legs)}", file=sys.stderr)

    # Node reference rotations (scale removed) for every mapped node.
    def rot_scale(Mw):
        s = np.linalg.norm(Mw[:3, :3], axis=0)
        return orthonormalize(Mw[:3, :3] / s[None, :]), s

    ref_rot = {n: rot_scale(world[by_name[n]])[0] for n in mp}
    keyed = [n for n in mp if not mp[n].get("noKey")]
    keyed_idx = {by_name[n] for n in keyed}

    def rest_local(i):
        return g.local(i, None)

    # Long axis of each prop node in its hand's frame (from its meshes' extent).
    prop_axis = {}
    for spec in cfg["clips"].values():
        fp = spec.get("flatProp")
        if not fp or fp["node"] in prop_axis:
            continue
        pi = by_name[fp["node"]]
        pts = []
        stack = [pi]
        while stack:
            i = stack.pop()
            stack += g.nodes[i].get("children", [])
            if "mesh" in g.nodes[i]:
                Mrel = np.linalg.inv(g.world(pi)) @ g.world(i)
                for prim in g.json["meshes"][g.nodes[i]["mesh"]]["primitives"]:
                    P = g.accessor(prim["attributes"]["POSITION"])
                    pts.append((Mrel[:3, :3] @ P.T).T + Mrel[:3, 3])
        pts = np.vstack(pts)
        c = pts - pts.mean(0)
        axis = np.linalg.svd(c, full_matrices=False)[2][0]
        Lp = g.local(pi)
        Rp = Lp[:3, :3] / np.linalg.norm(Lp[:3, :3], axis=0)[None, :]
        prop_axis[fp["node"]] = normalize(Rp @ axis)

    skin = g.json["skins"][0]
    ibm = g.accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    skinned = []
    for ni, node in enumerate(g.nodes):
        if "mesh" in node and "skin" in node:
            for prim in g.json["meshes"][node["mesh"]]["primitives"]:
                Pp = g.accessor(prim["attributes"]["POSITION"])[::3]
                Jp = g.accessor(prim["attributes"]["JOINTS_0"])[::3].astype(int)
                Wp = g.accessor(prim["attributes"]["WEIGHTS_0"])[::3]
                skinned.append((np.hstack([Pp, np.ones((len(Pp), 1))]), Jp, Wp))

    def skinned_min_y(wm):
        mats = np.array([wm(j) @ ibm[k] for k, j in enumerate(skin["joints"])])
        low = np.inf
        for Ph, Jp, Wp in skinned:
            ys = np.zeros(len(Ph))
            for c in range(4):
                ys += Wp[:, c] * np.einsum("nj,nj->n", mats[Jp[:, c], 1, :], Ph)
            low = min(low, ys.min())
        return low

    # The floor is where the rest pose stands.
    floor_y = skinned_min_y(lambda i: g.world(i)) if skinned else 0.0
    print(f"rest floor {floor_y:.4f}", file=sys.stderr)

    out = {"clips": [], "replace": cfg.get("replace", []), "propPoseClip": cfg.get("propPoseClip"), "scale": None}
    for state, spec in cfg["clips"].items():
        d = donors[spec["donor"]]
        # A clip hipMotion replaces the body's (the retargeter multiplies the two).
        r = Retargeter(sk, d, dict(plan, hip_motion=1.0 if "hipMotion" in spec else plan["hip_motion"]))
        out["scale"] = r.scale
        res = r.sample(state, spec)
        if spec.get("layer"):
            lay = spec["layer"]
            rl = Retargeter(sk, donors[lay.get("donor", spec["donor"])], plan).sample(state, {"clip": lay["clip"], "loop": True})
            for f in range(res["n"]):
                src = rl["L"][(f * lay.get("rate", 1)) % rl["n"]] if lay.get("hold") is None else rl["L"][lay["hold"]]
                w = 1.0
                if lay.get("release") and res["n"] > 1:
                    u = f / (res["n"] - 1)
                    a, b2 = lay["release"]
                    w = float(np.clip((b2 - u) / (b2 - a), 0, 1))
                for b in lay["bones"]:
                    res["L"][f][b] = slerp_matrix(res["L"][f][b], src[b], w)
        tracks = {n: {"rotation": [], "translation": []} for n in keyed}
        pys = [p[1] for p in res["pelvis"]]
        print(f"{state}: hips y rest {sk[hips].head[1]:.3f} range {min(pys):.3f}..{max(pys):.3f} scale {r.scale:.3f} ikMiss {res['ikMiss']:.4f}", file=sys.stderr)
        def frame_world(f, pelvis_pos):
            R, P = forward(sk, res["L"][f], hips, pelvis_pos)
            new_world = {}
            for n in keyed:
                b = node_bone[n]
                Wr = R[b] @ sk[b].frame.T @ ref_rot[n]
                s = rot_scale(world[by_name[n]])[1]
                Mw = np.eye(4)
                Mw[:3, :3] = Wr * s[None, :]
                Mw[:3, 3] = P[b]
                new_world[by_name[n]] = Mw
            fp = spec.get("flatProp")
            if fp and res["n"] > 1:
                # A long prop (staff, bow) lies flat once the body is down: turn the hand so the
                # prop's long axis is horizontal, blended in from fp["from"].
                u = f / (res["n"] - 1)
                w = 1.0 if fp["from"] <= 0 else float(np.clip((u - fp["from"]) / 0.15, 0, 1))
                if w > 0:
                    hi = by_name[fp["hand"]]
                    Mh = new_world[hi]
                    sh = np.linalg.norm(Mh[:3, :3], axis=0)
                    Rh = Mh[:3, :3] / sh[None, :]
                    axis_w = Rh @ prop_axis[fp["node"]]
                    flat = axis_w.copy(); flat[1] = 0.0
                    if fp.get("to") == "up":
                        flat = np.array([0.0, np.sign(axis_w[1]) or 1.0, 0.0])
                    if np.linalg.norm(flat) > 1e-6:
                        turn = slerp_matrix(np.eye(3), min_arc(axis_w, flat), w)
                        Mh[:3, :3] = (turn @ Rh) * sh[None, :]
            cache_w = {}

            def wmat(i):
                if i in new_world:
                    return new_world[i]
                if i in cache_w:
                    return cache_w[i]
                m = rest_local(i) if i not in g.parent else wmat(g.parent[i]) @ rest_local(i)
                cache_w[i] = m
                return m

            return new_world, wmat

        if spec.get("lift"):
            # A bulkier body than the donor's sinks into the floor when it lies down: lift the hips
            # by a smooth envelope of the skinned mesh's floor penetration (as crlib lying_lift).
            need = np.zeros(res["n"])
            for f in range(res["n"]):
                _, wm = frame_world(f, res["pelvis"][f])
                need[f] = max(0.0, floor_y - skinned_min_y(wm))
            need[need < 0.005] = 0.0
            if need.any():
                span = 9
                padded = np.pad(need, span, mode="edge")
                env = np.array([padded[i:i + 2 * span + 1].max() for i in range(len(need))])
                padded = np.pad(env, span // 2, mode="edge")
                lift = np.maximum(np.array([padded[i:i + span].mean() for i in range(len(need))]), need)
                res["pelvis"] = [p + np.array([0.0, l, 0.0]) for p, l in zip(res["pelvis"], lift)]
                print(f"{state}: lying lift max {lift.max():.3f} end {lift[-1]:.3f}", file=sys.stderr)

        for f in range(res["n"]):
            new_world, wmat = frame_world(f, res["pelvis"][f])
            for n in keyed:
                i = by_name[n]
                parent_w = wmat(g.parent[i]) if i in g.parent else np.eye(4)
                L = np.linalg.inv(parent_w) @ new_world[i]
                own_s = np.array(g.nodes[i].get("scale", [1, 1, 1]))
                Rl = orthonormalize(L[:3, :3] / np.linalg.norm(L[:3, :3], axis=0)[None, :])
                tracks[n]["rotation"].append(quat_from_matrix(Rl))
                tracks[n]["translation"].append(L[:3, 3].copy())
        for n, clip_name in cfg.get("grip", {}).items():
            # A weapon hand keeps the native grip: its local rotation from the native clip's first
            # frame, so a sword, bow or staff points where the studio authored it.
            q = g.clip_pose(clip_name, 0.0, only={by_name[n]}).get(by_name[n], {}).get("rotation", g.nodes[by_name[n]].get("rotation", [0, 0, 0, 1]))
            G = matrix_from_quat(q)
            fade = spec.get("gripRelease")  # [start, end] fractions of a one-shot: let go of the grip
            for f in range(res["n"]):
                w = 1.0
                if fade and res["n"] > 1:
                    u = f / (res["n"] - 1)
                    w = float(np.clip((fade[1] - u) / (fade[1] - fade[0]), 0, 1))
                Rf = matrix_from_quat(tracks[n]["rotation"][f])
                tracks[n]["rotation"][f] = quat_from_matrix(slerp_matrix(Rf, G, w))
        clip_out = {"name": state, "fps": res["fps"], "frames": res["n"], "donor": f"{spec['donor']}:{spec['clip']}", "tracks": {}}
        for n in keyed:
            i = by_name[n]
            q = continuous_quats(tracks[n]["rotation"])
            entry = {"rotation": [x.tolist() for x in q]}
            t = np.array(tracks[n]["translation"])
            rest_t = np.array(g.nodes[i].get("translation", [0, 0, 0]))
            if node_bone[n] == hips or mp[n].get("translate") or np.abs(t - rest_t).max() > 1e-4 * max(1.0, np.abs(rest_t).max()):
                if node_bone[n] != hips and not mp[n].get("translate") and not mp[n].get("parent"):
                    print(f"warn: {state} {n} drifts {np.abs(t - rest_t).max():.2e} from rest translation", file=sys.stderr)
                # Keyed wherever it differs from the node rest (a reference clip's own joint
                # offsets, an IK-parented foot), so unkeyed rest never pulls a joint off its limb.
                entry["translation"] = t.tolist()
            clip_out["tracks"][n] = entry
        out["clips"].append(clip_out)
    out["legScale"] = out["scale"]
    out["skeleton"] = {b.name: {"head": b.head.tolist(), "tail": b.tail.tolist(), "parent": b.parent} for b in sk.bones}
    json.dump(out, open(os.path.join(work, "studio.json"), "w"))
    print(json.dumps({"clips": [c["name"] for c in out["clips"]], "legScale": out["scale"], "keyed": len(keyed)}))


if __name__ == "__main__":
    argv = sys.argv[1:]
    main(os.path.abspath(argv[-1]), argv[argv.index("--donors") + 1] if "--donors" in argv else os.path.join(REPO, "test-results/creature-motion/rig/donors"))
