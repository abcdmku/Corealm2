"""Studio mode: add retargeted donor clips to a studio body that keeps its own skeleton, skin and
native clips byte-identical.

  PYTHONPATH=D:/CorealmAgentCache/bpy-5.2 py -3.13 tools/creature-rig/py/studio.py [--donors <dir>] <work dir>

The asset config's "studio" block drives it (see README, "Studio mode"). The studio skeleton is
read from the production GLB, at the first frame of studio.referenceClip when one is given. Mapped
joints (studio.map: node name -> {bone, donor?, follow?, kind?, parent?, tail?, noTail?, noKey?,
translate?}, or "arp" for an Auto-Rig Pro skeleton driven by Auto-Rig Pro donors) form a crlib
Skeleton with the class's donor bone names; the crlib Retargeter samples each donor clip
(rest-relative, hips scaled by leg length, leg IK with ball and toe contact on every leg: studio.legs,
else humanoid thigh/calf/foot chains, else the chains of the bones mapped as kind "leg"). Each mapped node's new world rotation is its
retargeted frame rotation carried onto the node's own reference rotation; locals are taken against
the node's real parent. Joints whose logical parent is not their node parent (IK-baked feet) also
get translation keys so they stay on the limb. Writes <work>/studio.json for studio.mjs.
"""
import copy
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from crlib import donor as donors_mod  # noqa: E402
from crlib.glbpy import Glb  # noqa: E402
from crlib.mathx import continuous_quats, matrix_from_quat, min_arc, normalize, orthonormalize, quat_from_matrix, slerp_matrix  # noqa: E402
from crlib.retarget import CapsuleCollider, Retargeter, forward  # noqa: E402
from crlib.skeleton import Skeleton  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

# Auto-Rig Pro deform bones that carry the class's canonical names (the hips, the spine and the
# limbs), so the leg IK and the tail picks find them. Sided names end in l or r.
ARP_CORE = {"rootx": ("pelvis", "body"), "spine_01x": ("spine_01", "body"), "spine_02x": ("spine_02", "body"),
            "spine_03x": ("spine_03", "body"), "neckx": ("neck_01", "body"), "headx": ("Head", "body")}
ARP_SIDED = {"shoulder": ("clavicle", "arm"), "arm_stretch": ("upperarm", "arm"), "forearm_stretch": ("lowerarm", "arm"),
             "hand": ("hand", "arm"), "thigh_stretch": ("thigh", "leg"), "leg_stretch": ("calf", "leg"),
             "foot": ("foot", "leg"), "toes_01": ("ball", "leg")}


def arp_map(g, joints, donors, skip):
    """{node: spec} for an Auto-Rig Pro skeleton driven by Auto-Rig Pro donors (PixeliusVita packs).
    glTF drops the dots of ARP names (thigh_stretch.l -> thigh_stretchl). A joint is driven by the
    donor bone of the same name when that bone hangs from the same parent in some donor, so a helmet
    plume named c_tail under the head never takes a real tail's motion. Other joints stay unmapped
    (they follow their parent; see holdUnmapped)."""
    lookup, parent_of = {}, {}
    for d in donors:
        for b in d.bones:
            key = b.replace(".", "")
            lookup.setdefault(key, b)
            parent_of.setdefault(key, (d.parent[b] or "").replace(".", ""))
    out = {}
    for i in joints:
        n = g.nodes[i]["name"]
        if n in skip or n not in lookup:
            continue
        node_parent = g.nodes[g.parent[i]]["name"] if i in g.parent else ""
        if parent_of[n] != node_parent and not (n == "rootx"):
            continue
        spec = {"donor": lookup[n], "kind": "body"}
        if n in ARP_CORE:
            spec["bone"], spec["kind"] = ARP_CORE[n]
        else:
            m = re.fullmatch(r"(.+?)([lr])", n)
            if m and m.group(1) in ARP_SIDED:
                base, spec["kind"] = ARP_SIDED[m.group(1)]
                spec["bone"] = f"{base}_{m.group(2)}"
            else:
                spec["bone"] = n
                if "twist" in n:
                    spec["noTail"] = True
                if "_stretch" in n or "twist" in n or re.match(r"(shoulder|hand)", n):
                    spec["kind"] = "leg" if re.match(r"(thigh|leg)_", n) else "arm"
        out[n] = spec
    return out


def rested(d, take, clip=None, hub=None):
    """The donor seen from the first frame of one of its takes: that pose becomes its rest, so a
    clip transfers as motion away from the donor's own stance (its Idle) onto the target's. Takes
    of one pack start at different ground positions (baked root motion): the rest moves over the
    clip's first hub position, so only the clip's own travel and height change carry over."""
    c = d.clips[take]
    shift = np.zeros(3)
    if clip is not None and hub is not None:
        shift = d.clips[clip]["heads"][0][d.index(hub)] - c["heads"][0][d.index(hub)]
        shift[1] = 0.0
    r = copy.copy(d)
    r.rest_frame = {b: c["frames"][0][i] for i, b in enumerate(d.bones)}
    r.rest_head = {b: c["heads"][0][i] + shift for i, b in enumerate(d.bones)}
    r.rest_tail = {b: r.rest_head[b] + r.rest_frame[b][:, 1] * np.linalg.norm(d.rest_tail[b] - d.rest_head[b]) for b in d.bones}
    return r


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
    # The reference pose covers the joints and every node above them: a wrapper (a Biped's Bip001)
    # that the reference clip moves carries the whole body, so leaving it at rest would build the
    # skeleton away from the stance the clip shows (the skeleton soldier's Death started 0.15 m
    # above its Idle).
    ref = None
    if cfg.get("referenceClip"):
        carried = set(joints)
        for j in joints:
            while j in g.parent:
                j = g.parent[j]
                carried.add(j)
        ref = g.clip_pose(cfg["referenceClip"], 0.0, only=carried)
    world = {i: g.world(i, ref) for i in range(len(g.nodes))}
    by_name = g.name_index

    # ---- donors: the class's donor map; clips from the studio block, else the class profile
    donor_map = json.load(open(os.path.join(HERE, "classes", f"{config['class']}.donors.json"), encoding="utf-8"))
    cfg = dict(cfg, clips=cfg.get("clips") or donor_map["profiles"][config["profile"]]["clips"])
    primary_key = cfg.get("primary", donor_map["primary"])
    # A clip's "rest" (or studio.donorRest[donor]) names a donor take whose first frame is that
    # donor's rest: the clip transfers as motion away from that stance.
    for spec in cfg["clips"].values():
        spec.setdefault("rest", cfg.get("donorRest", {}).get(spec["donor"]))
    needed = {}
    for spec in cfg["clips"].values():
        for part in [spec] + ([spec["layer"]] if spec.get("layer") else []):
            takes = part["clip"] if isinstance(part["clip"], list) else [part["clip"]]
            needed.setdefault(part.get("donor", spec.get("donor")), set()).update(takes)
        if spec.get("rest"):
            needed[spec["donor"]].add(spec["rest"])
    needed.setdefault(primary_key, set())
    donors = {k: donors_mod.load(k, donor_map["donors"][k], cache, sorted(v)) for k, v in needed.items()}
    primary = donors[primary_key]
    for spec in cfg["clips"].values():
        for part in [spec] + ([spec["layer"]] if spec.get("layer") else []):
            if isinstance(part["clip"], list):
                part["clip"] = donors[part.get("donor", spec.get("donor"))].chain(part["clip"])

    # ---- skeleton from the studio joints
    props = cfg.get("props", {})  # prop node -> the hand node that carries it
    if cfg["map"] == "arp":
        mp = arp_map(g, joints, list(donors.values()), set(props))
    else:
        mp = dict(cfg["map"])  # node name -> {bone, donor, follow, kind, parent?}
    # "chains": a target chain (a tail) driven by a donor chain of another length, spread by index
    # along both: [{"from": first node, "donor": first donor bone, "in": donor key}]. Each chain
    # follows its first joint child down.
    def chain_down(first_child, start):
        out = [start]
        while True:
            kids = first_child(out[-1])
            if not kids:
                return out
            out.append(kids[0])
    joint_names = {g.nodes[i]["name"] for i in joints}
    for ch in cfg.get("chains", []):
        d = donors[ch["in"]] if ch.get("in") else next(x for x in donors.values() if ch["donor"] in x.bones)
        tgt = chain_down(lambda n: [g.nodes[c]["name"] for c in g.nodes[by_name[n]].get("children", []) if g.nodes[c]["name"] in joint_names], ch["from"])
        src = chain_down(d.children, ch["donor"])[:ch.get("donorLength")]
        for i, n in enumerate(tgt):
            j = round(i * (len(src) - 1) / max(len(tgt) - 1, 1))
            mp[n] = {"bone": n, "donor": src[j], "kind": "tail"}
    # "springs": a chain with no donor twin (a tail dragging on the floor) follows its parent and
    # is then driven by crlib's damped spring chain with the floor as a plane:
    # [{"from": first node, stiffness?, damping?, gravity?, clearance?, hang?}].
    spring_chains = []
    for sc in cfg.get("springs", []):
        tgt = chain_down(lambda n: [g.nodes[c]["name"] for c in g.nodes[by_name[n]].get("children", []) if g.nodes[c]["name"] in joint_names], sc["from"])
        for n in tgt:
            mp[n] = {"bone": n, "donor": None, "kind": "tail"}
        spring_chains.append(dict({k: v for k, v in sc.items() if k != "from"}, bones=tgt))
    for n, spec in cfg.get("mapOverrides", {}).items():
        if spec is None:
            mp.pop(n, None)
        else:
            mp[n] = dict(mp.get(n, {}), **spec)
    # "donor" may name a bone per donor ({donor key: bone or null}) when donors of different rigs
    # drive one skeleton; the primary donor's name is the bone's own.
    bone_maps = {k: {} for k in donors}
    if cfg["map"] == "arp":
        # A donor that is not Auto-Rig Pro (a UAL humanoid) drives the canonical hips, spine, head
        # and limb bones by their own names (the UE names the canonical ones are); every other
        # joint follows its parent in that donor's clips.
        canonical = {b for b, _ in ARP_CORE.values()} | {f"{b}_{s}" for b, _ in ARP_SIDED.values() for s in "lr"}
        for k, d in donors.items():
            if "root.x" not in d.bones and "rootx" not in d.bones:
                bone_maps[k] = {b: b for b in canonical if b in d.bones}
    for n, v in mp.items():
        if isinstance(v.get("donor"), dict):
            per = v["donor"]
            for k in donors:
                bone_maps[k][v["bone"]] = per.get(k)
            v["donor"] = per.get(primary_key) or next((x for x in per.values() if x), None)
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
    # "hinges": rigid hanging pieces that are not joints (a mantle panel, a tabard plate on a
    # prop node): each becomes a one-bone spring chain from its top edge to its bottom edge on the
    # nearest mapped ancestor, so it trails and swings with the body and settles on the floor
    # instead of riding the torso like armour. [{node, stiffness?, damping?, gravity?, clearance?,
    # hang?, group?}]; hinges of one group are linked so a split panel keeps its spacing.
    hinge_rel, hinge_pivot = {}, []
    spring_chains_cloth, cloth_joints, cloth_weights, cloth_meshes = [], [], {}, set()
    for hc in cfg.get("hinges", []):
        n = hc["node"]
        i = by_name[n]
        pts = []
        stack = [i]
        while stack:
            k = stack.pop()
            stack += g.nodes[k].get("children", [])
            if "mesh" in g.nodes[k]:
                for prim in g.json["meshes"][g.nodes[k]["mesh"]]["primitives"]:
                    P = g.accessor(prim["attributes"]["POSITION"])
                    pts.append((np.hstack([P, np.ones((len(P), 1))]) @ world[k].T)[:, :3])
        pts = np.vstack(pts)
        if hc.get("pivotNode"):
            # The strap end: a named child mesh's centre (a quiver's upper rim, not its feathers);
            # the free end is the far band of the piece from there.
            k = by_name[hc["pivotNode"]]
            P = g.accessor(g.json["meshes"][g.nodes[k]["mesh"]]["primitives"][0]["attributes"]["POSITION"])
            head = (np.hstack([P, np.ones((len(P), 1))]) @ world[k].T)[:, :3].mean(0)
            dist = np.linalg.norm(pts - head, axis=1)
            tail = pts[dist >= 0.9 * dist.max()].mean(0)
        else:
            top, bottom = pts[:, 1].max(), pts[:, 1].min()
            band = 0.1 * (top - bottom)
            head = pts[pts[:, 1] >= top - band].mean(0)
            tail = pts[pts[:, 1] <= bottom + band].mean(0)
        k = i
        while k in g.parent and g.nodes[g.parent[k]].get("name") not in mp:
            k = g.parent[k]
        parent_node = g.parent[k]
        sk.add(n, mp[g.nodes[parent_node]["name"]]["bone"], head, tail, donor=None, follow=0.0, kind="cloth")
        hinge_rel[n] = world[i][:3, 3] - head
        # The pivot rides its parent rigidly, so the floor lift keeps it (less the piece's own
        # clearance, its half thickness) on the floor: a body lying on its quiver rests on it.
        hinge_pivot.append((parent_node, np.linalg.inv(world[parent_node]) @ np.append(head, 1.0), hc.get("pivotClearance", hc.get("clearance", 0.0))))
    # "cloth": a skinned hanging sheet the studio bound to the torso only (a loincloth, a skirt):
    # [{mesh, parent, columns?, links?, seam?, stiffness?, damping?, gravity?, clearance?, hang?}].
    # New joints hang from the parent joint in columns round the sheet (links bones each, from the
    # waist to the hem); the sheet's weights blend from the studio's own at the waist to the
    # columns below it (seam: the share of the sheet's height the blend takes), and the columns
    # are spring chains of one linked sheet. Kept clips never key the new joints, so there the
    # sheet rides its parent as before; added clips swing it.
    skin0 = g.json["skins"][0]
    ibm0 = g.accessor(skin0["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    bind_of = {j: np.linalg.inv(ibm0[k]) for k, j in enumerate(skin0["joints"])}
    for cc in cfg.get("cloth", []):
        mi = by_name[cc["mesh"]]
        cloth_meshes.add(mi)
        per = []
        for prim in g.json["meshes"][g.nodes[mi]["mesh"]]["primitives"]:
            P = g.accessor(prim["attributes"]["POSITION"])
            Jp = g.accessor(prim["attributes"]["JOINTS_0"]).astype(int)
            Wp = g.accessor(prim["attributes"]["WEIGHTS_0"])
            Ph = np.hstack([P, np.ones((len(P), 1))])
            X = np.zeros((len(P), 3))
            skin_m = np.array([bind_of[j] @ ibm0[k] for k, j in enumerate(skin0["joints"])])
            for c in range(4):
                X += Wp[:, c:c + 1] * np.einsum("nij,nj->ni", skin_m[Jp[:, c]], Ph)[:, :3]
            per.append((X, Jp, Wp))
        X = np.vstack([x for x, _, _ in per])
        top, bottom = X[:, 1].max(), X[:, 1].min()
        centre = X.mean(0)
        K, links = cc.get("columns", 6), cc.get("links", 2)
        ang = np.arctan2(X[:, 0] - centre[0], X[:, 2] - centre[2])
        pn = by_name[cc["parent"]]
        levels = np.linspace(top, bottom, links + 1)
        sigma = 0.5 * (top - bottom) / links
        columns = []
        first = len(cloth_joints)
        for k in range(K):
            th = -np.pi + (k + 0.5) * 2 * np.pi / K
            d = np.abs((ang - th + np.pi) % (2 * np.pi) - np.pi)
            sector = d < 1.2 * np.pi / K
            if sector.sum() < 2:
                continue
            Q = X[sector]
            pts = []
            for h in levels:
                w = np.exp(-0.5 * ((Q[:, 1] - h) / sigma) ** 2) + 1e-9
                q = (Q * w[:, None]).sum(0) / w.sum()
                q[1] = h
                pts.append(q)
            parent_bind, parent_name, parent_ref, parent_bone = bind_of[pn], cc["parent"], world[pn], mp[cc["parent"]]["bone"]
            names = []
            for j in range(links):
                jn = f"{cc['mesh']}_c{k}_{j + 1}"
                Jb = np.eye(4)
                Jb[:3, 3] = pts[j]
                local = np.linalg.inv(parent_bind) @ Jb
                Mref = parent_ref @ local
                tail_ref = Mref[:3, :3] @ (pts[j + 1] - pts[j]) + Mref[:3, 3]
                sk.add(jn, parent_bone, Mref[:3, 3].copy(), tail_ref, donor=None, follow=0.0, kind="cloth")
                cloth_joints.append({"name": jn, "parent": parent_name, "local": local, "bind": Jb, "ref": Mref})
                names.append(jn)
                parent_bind, parent_name, parent_ref, parent_bone = Jb, jn, Mref, jn
            columns.append({"th": th, "bones": names})
            # "ring": the columns link to their neighbours round the sheet (a skirt round the
            # legs); other keys (falloff, drag, sided, substeps, ...) go to crlib's spring chain.
            spring_chains_cloth.append(dict({k2: v for k2, v in cc.items() if k2 not in ("mesh", "parent", "columns", "links", "seam", "ring")},
                                            bones=names, group=cc["mesh"], **({"links": "ring"} if cc.get("ring") else {})))
        base = len(skin0["joints"])
        index = {c["name"]: base + i for i, c in enumerate(cloth_joints) if i >= first}
        centres = (np.arange(links) + 0.5) / links
        out_prims = []
        for X1, Jp, Wp in per:
            t = np.clip((top - X1[:, 1]) / max(top - bottom, 1e-9), 0, 1)
            a = np.clip(t / cc.get("seam", 0.35), 0, 1)
            a = a * a * (3 - 2 * a)
            ang1 = np.arctan2(X1[:, 0] - centre[0], X1[:, 2] - centre[2])
            rows_j, rows_w = [], []
            for v in range(len(X1)):
                w = {}
                for c in range(4):
                    if Wp[v, c] > 0:
                        w[int(Jp[v, c])] = w.get(int(Jp[v, c]), 0.0) + (1 - a[v]) * Wp[v, c]
                cw = np.array([max(0.0, 1 - abs((ang1[v] - col["th"] + np.pi) % (2 * np.pi) - np.pi) / (2 * np.pi / len(columns))) for col in columns])
                cw /= max(cw.sum(), 1e-9)
                for col, wc in zip(columns, cw):
                    for bi, bname in enumerate(col["bones"]):
                        hat = max(0.0, 1 - abs(t[v] - centres[bi]) * links)
                        if (bi == 0 and t[v] < centres[0]) or (bi == links - 1 and t[v] > centres[-1]):
                            hat = 1.0
                        if hat * wc > 0:
                            w[index[bname]] = w.get(index[bname], 0.0) + a[v] * wc * hat
                top4 = sorted(w.items(), key=lambda kv: -kv[1])[:4]
                total = sum(x for _, x in top4)
                top4 += [(0, 0.0)] * (4 - len(top4))
                rows_j.append([j for j, _ in top4])
                rows_w.append([x / total for _, x in top4])
            out_prims.append({"joints": rows_j, "weights": rows_w})
        cloth_weights[cc["mesh"]] = out_prims
    sk.solve_frames(primary)
    if "legs" in cfg:
        # Explicit legs in node names ({chain: [...], foot?, toe?, pivot?}), e.g. a crawler's arm chains.
        legs = [dict(leg, chain=[node_bone[x] for x in leg["chain"]], **{k: node_bone[leg[k]] for k in ("foot", "toe") if leg.get(k)}) for leg in cfg["legs"]]
    else:
        legs = [(f"thigh_{s}", f"calf_{s}", f"foot_{s}", f"ball_{s}") for s in ("l", "r") if f"thigh_{s}" in sk and f"ball_{s}" in sk]
        legs += [(f"thigh_{s}", f"calf_{s}", f"foot_{s}") for s in ("l", "r") if f"thigh_{s}" in sk and f"ball_{s}" not in sk]
        if not legs:
            # Any other skeleton: the chains of the bones mapped as kind "leg".
            legs = leg_chains(sk, {v["bone"] for v in mp.values() if v.get("kind") == "leg"})
    plan = {"hips": hips, "legs": legs, "chains": [], "colliders": [], "hip_motion": cfg.get("hipMotion", 1.0)}
    for hc in cfg.get("hinges", []):
        spring_chains.append(dict({k: v for k, v in hc.items() if k not in ("node", "pivotNode", "pivotClearance")}, bones=[hc["node"]]))
    spring_chains += spring_chains_cloth
    # "colliders": [{node, radius}] capsules along mapped joints that spring chains and hinges
    # cannot pass through (the torso a mantle hangs against, the legs a loincloth swings between).
    colliders = [CapsuleCollider(sk, mp[c["node"]]["bone"], c["radius"]) for c in cfg.get("colliders", [])]
    for key in ("hipMode", "hipSource", "scale"):
        if key in cfg:
            plan[{"hipMode": "hip_mode", "hipSource": "hip_source"}.get(key, key)] = cfg[key]

    # Node reference rotations (scale removed) for every mapped node.
    def rot_scale(Mw):
        s = np.linalg.norm(Mw[:3, :3], axis=0)
        return orthonormalize(Mw[:3, :3] / s[None, :]), s

    ref_rot = {n: rot_scale(world[by_name[n]])[0] for n in mp}
    keyed = [n for n in mp if not mp[n].get("noKey")]
    keyed_idx = {by_name[n] for n in keyed}
    # holdUnmapped: every other joint (a tail tip, a plume, a helmet flap) is keyed at its
    # reference pose, so it rides its parent as in the native Idle instead of snapping to bind.
    held = [g.nodes[i]["name"] for i in joints if g.nodes[i]["name"] not in mp and g.nodes[i]["name"] not in props] if cfg.get("holdUnmapped") else []
    prop_offset = {n: np.linalg.inv(world[by_name[hand]]) @ world[by_name[n]] for n, hand in props.items()}

    held_names = set(held)

    def rest_local(i):
        # What an unkeyed node shows at runtime: its node rest, except the joints held at the
        # reference pose (they are keyed there). A wrapper node the added clips do not key plays
        # at its rest even when the reference clip moved it.
        return g.local(i, ref if g.nodes[i].get("name") in held_names else None)

    # Long axis of each prop node in its hand's frame (from its meshes' extent).
    prop_axis = {}
    flat_props = lambda spec: spec.get("flatProp") if isinstance(spec.get("flatProp"), list) else [spec["flatProp"]] if spec.get("flatProp") else []
    for fp in [fp for spec in cfg["clips"].values() for fp in flat_props(spec)]:
        if fp["node"] in prop_axis or fp["node"] in props:
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
        # The long end: the axis turned to point from the hand along the prop's bulk.
        centre = Lp[:3, :3] @ pts.mean(0) + Lp[:3, 3]
        if np.dot(centre, prop_axis[fp["node"]]) < 0:
            prop_axis[fp["node"]] = -prop_axis[fp["node"]]

    skin = g.json["skins"][0]
    ibm = g.accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    skinned = []
    for ni, node in enumerate(g.nodes):
        # A cloth sheet settles on the floor by its own springs; the lift ignores it.
        if "mesh" in node and "skin" in node and ni not in cloth_meshes:
            for prim in g.json["meshes"][node["mesh"]]["primitives"]:
                Pp = g.accessor(prim["attributes"]["POSITION"])[::3]
                Jp = g.accessor(prim["attributes"]["JOINTS_0"])[::3].astype(int)
                Wp = g.accessor(prim["attributes"]["WEIGHTS_0"])[::3]
                skinned.append((np.hstack([Pp, np.ones((len(Pp), 1))]), Jp, Wp))

    # A skinned prop (its own bone, carried on a hand) takes its long axis from the vertices it
    # owns, in its bone's frame, turned into the hand's frame by the carry offset.
    for fp in [fp for spec in cfg["clips"].values() for fp in flat_props(spec)]:
        if fp["node"] not in props or fp["node"] in prop_axis:
            continue
        k = skin["joints"].index(by_name[fp["node"]])
        pts = []
        for node in g.nodes:
            if "mesh" in node and "skin" in node:
                for prim in g.json["meshes"][node["mesh"]]["primitives"]:
                    P = g.accessor(prim["attributes"]["POSITION"])
                    J = g.accessor(prim["attributes"]["JOINTS_0"]).astype(int)
                    W = g.accessor(prim["attributes"]["WEIGHTS_0"])
                    own = J[np.arange(len(J)), W.argmax(1)] == k
                    pts.append((ibm[k] @ np.hstack([P[own], np.ones((own.sum(), 1))]).T).T[:, :3])
        pts = np.vstack(pts)
        axis = np.linalg.svd(pts - pts.mean(0), full_matrices=False)[2][0]
        prop_axis[fp["node"]] = normalize(rot_scale(prop_offset[fp["node"]])[0] @ axis)

    # Rigid meshes (a staff, a quiver, a mantle plate on a joint) count for the floor too: a
    # body lying on its back must not bury what it carries.
    rigid = []
    hinged = set()
    for hc in cfg.get("hinges", []):
        stack = [by_name[hc["node"]]]
        while stack:
            k = stack.pop()
            hinged.add(k)
            stack += g.nodes[k].get("children", [])
    for ni, node in enumerate(g.nodes):
        if "mesh" in node and "skin" not in node and ni not in hinged:
            for prim in g.json["meshes"][node["mesh"]]["primitives"]:
                Pp = g.accessor(prim["attributes"]["POSITION"])
                rigid.append((ni, np.hstack([Pp, np.ones((len(Pp), 1))])))

    def skinned_min_y(wm):
        mats = np.array([wm(j) @ ibm[k] for k, j in enumerate(skin["joints"])])
        low = np.inf
        for Ph, Jp, Wp in skinned:
            ys = np.zeros(len(Ph))
            for c in range(4):
                ys += Wp[:, c] * np.einsum("nj,nj->n", mats[Jp[:, c], 1, :], Ph)
            low = min(low, ys.min())
        for ni, Ph in rigid:
            low = min(low, (Ph @ wm(ni)[1]).min())
        for ni, p, clearance in hinge_pivot:
            low = min(low, wm(ni)[1] @ p - clearance)
        return low

    # The floor is where the rest pose stands.
    floor_y = skinned_min_y(lambda i: g.world(i, ref if cfg.get("floor") == "reference" else None)) if skinned else 0.0
    print(f"rest floor {floor_y:.4f}", file=sys.stderr)

    out = {"clips": [], "replace": cfg.get("replace", []), "propPoseClip": cfg.get("propPoseClip"), "scale": None}
    for state, spec in cfg["clips"].items():
        d = donors[spec["donor"]]
        if spec.get("rest"):
            hub = bone_maps.get(spec["donor"], {}).get("pelvis", sk["pelvis"].donor)
            d = rested(d, spec["rest"], spec["clip"], hub)
        # A clip hipMotion replaces the body's (the retargeter multiplies the two). Every donor
        # binds through its own rest frames (primary=False), which is exact for the primary too.
        clip_map = dict(bone_maps.get(spec["donor"], {}))
        # "still": joints (with everything mapped under them) that keep their reference pose on
        # their parent in this clip, e.g. a shield arm holding its guard through a two-handed swipe.
        for root_node in spec.get("still", []):
            stack = [by_name[root_node]]
            while stack:
                i = stack.pop()
                if g.nodes[i]["name"] in mp:
                    clip_map[mp[g.nodes[i]["name"]]["bone"]] = None
                stack += g.nodes[i].get("children", [])
        # "remap": {node: donor bone or null} changes which donor bone drives a node in this clip
        # only, e.g. a short worm spread over the viper's front half so the strike rears the body.
        for node, donor_bone in spec.get("remap", {}).items():
            b = mp[node]["bone"]
            clip_map.pop(sk[b].donor, None)
            clip_map[b] = donor_bone
        # A clip whose donor drives neither hips nor legs (an upper-body Hit) sets its own "scale".
        r = Retargeter(sk, d, dict(plan, hip_motion=1.0 if "hipMotion" in spec else plan["hip_motion"], **({"scale": spec["scale"]} if "scale" in spec else {})),
                       bone_map=clip_map, primary=False)
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
        # A clip may retune a chain: {"springs": {first node: {gravity, stiffness, ease, ...}}}.
        tune = spec.get("springs") or {}
        chains = [dict(c, base=c, **tune.get(c["bones"][0], {})) for c in spring_chains]
        unsprung = dict(res, L=[dict(L) for L in res["L"]])
        if chains:
            res = r.secondary(res, chains, colliders, floor=floor_y)
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
            for fp in flat_props(spec) if res["n"] > 1 else []:
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
                    elif fp.get("to") == "side":
                        # Laid out beside the body: the long end points away from the hips along
                        # the body's lateral axis, on the hand's side, so a staff held over the
                        # chest does not lie across the ribcage and head.
                        R0, P0 = R, P
                        lateral = (R0[hips] @ sk[hips].frame.T)[:, 0].copy()
                        lateral[1] = 0.0
                        side = np.sign(np.dot(Mh[:3, 3] - P0[hips], lateral)) or 1.0
                        flat = side * lateral
                    if np.linalg.norm(flat) > 1e-6:
                        turn = slerp_matrix(np.eye(3), min_arc(axis_w, flat), w)
                        Mh[:3, :3] = (turn @ Rh) * sh[None, :]
            for n, hand in props.items():
                new_world[by_name[n]] = new_world[by_name[hand]] @ prop_offset[n]
            for n, rel in hinge_rel.items():
                D = R[n] @ sk[n].frame.T
                Mw = world[by_name[n]].copy()
                Mw[:3, :3] = D @ Mw[:3, :3]
                Mw[:3, 3] = P[n] + D @ rel
                new_world[by_name[n]] = Mw
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

        if spec.get("land"):
            # A body whose legs are shorter or longer than the donor's does not end its fall on the
            # floor: move the hips by the final pose's floor gap, eased in with the fall itself
            # (the share of the hips' total drop reached so far).
            _, wm = frame_world(res["n"] - 1, res["pelvis"][-1])
            gap = skinned_min_y(wm) - floor_y
            ys = np.array([p[1] for p in res["pelvis"]])
            drop = ys[0] - ys
            total = drop[-1] if abs(drop[-1]) > 1e-4 else 0.0
            u = np.clip(drop / total, 0, 1) if total else np.linspace(0, 1, res["n"])
            u = np.maximum.accumulate(u * u * (3 - 2 * u))
            res["pelvis"] = [p - np.array([0.0, gap * w, 0.0]) for p, w in zip(res["pelvis"], u)]
            print(f"{state}: landing moves the hips {-gap:+.3f}", file=sys.stderr)

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
                # The clip starts from the reference stance on the floor and blends in from the
                # clip before it: the centred envelope must not raise the first frames. Before
                # the first frame that needs a lift it eases in from zero.
                first = int(np.argmax(need > 0))
                if first > 0:
                    u = np.arange(first) / first
                    lift[:first] *= u * u * (3 - 2 * u)
                res["pelvis"] = [p + np.array([0.0, l, 0.0]) for p, l in zip(res["pelvis"], lift)]
                print(f"{state}: lying lift max {lift.max():.3f} end {lift[-1]:.3f}", file=sys.stderr)

        if chains and (spec.get("land") or spec.get("lift")):
            # Land and lift moved the hips after the springs were solved: solve them again from
            # the moved body, so a chain or hinge settles on the floor where the body finally lies.
            res = r.secondary(dict(unsprung, pelvis=res["pelvis"]), chains, colliders, floor=floor_y)

        for n in list(props) + held + list(hinge_rel):
            tracks[n] = {"rotation": [], "translation": []}
        for f in range(res["n"]):
            # A prop on its own bone (a sword under the root, posed by the studio's child-of
            # constraint in the native takes) rides its hand at the reference offset (frame_world).
            new_world, wmat = frame_world(f, res["pelvis"][f])
            for n in keyed + list(props) + list(hinge_rel):
                i = by_name[n]
                parent_w = wmat(g.parent[i]) if i in g.parent else np.eye(4)
                L = np.linalg.inv(parent_w) @ new_world[i]
                Rl = orthonormalize(L[:3, :3] / np.linalg.norm(L[:3, :3], axis=0)[None, :])
                tracks[n]["rotation"].append(quat_from_matrix(Rl))
                tracks[n]["translation"].append(L[:3, 3].copy())
            for n in held:
                L = g.local(by_name[n], ref)
                tracks[n]["rotation"].append(quat_from_matrix(orthonormalize(L[:3, :3] / np.linalg.norm(L[:3, :3], axis=0)[None, :])))
                tracks[n]["translation"].append(L[:3, 3].copy())
        # Cloth joints (new nodes): locals against their parent's new world, in chain order.
        cloth_tracks = {c["name"]: {"rotation": [], "translation": []} for c in cloth_joints}
        for f in range(res["n"]) if cloth_joints else []:
            new_world, wmat = frame_world(f, res["pelvis"][f])
            R, P = forward(sk, res["L"][f], hips, res["pelvis"][f])
            cw = {}
            for c in cloth_joints:
                n = c["name"]
                Mw = c["ref"].copy()
                Mw[:3, :3] = R[n] @ sk[n].frame.T @ Mw[:3, :3]
                Mw[:3, 3] = P[n]
                cw[n] = Mw
                parent_w = cw[c["parent"]] if c["parent"] in cw else wmat(by_name[c["parent"]])
                L = np.linalg.inv(parent_w) @ Mw
                cloth_tracks[n]["rotation"].append(quat_from_matrix(orthonormalize(L[:3, :3] / np.linalg.norm(L[:3, :3], axis=0)[None, :])))
                cloth_tracks[n]["translation"].append(L[:3, 3].copy())
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
        for n in keyed + list(props) + held + list(hinge_rel):
            i = by_name[n]
            q = continuous_quats(tracks[n]["rotation"])
            entry = {"rotation": [x.tolist() for x in q]}
            t = np.array(tracks[n]["translation"])
            rest_t = np.array(g.nodes[i].get("translation", [0, 0, 0]))
            spec_n = mp.get(n, {"translate": True})
            if node_bone.get(n) == hips or spec_n.get("translate") or np.abs(t - rest_t).max() > 1e-4 * max(1.0, np.abs(rest_t).max()):
                if node_bone.get(n) != hips and not spec_n.get("translate") and not spec_n.get("parent"):
                    print(f"warn: {state} {n} drifts {np.abs(t - rest_t).max():.2e} from rest translation", file=sys.stderr)
                # Keyed wherever it differs from the node rest (a reference clip's own joint
                # offsets, an IK-parented foot), so unkeyed rest never pulls a joint off its limb.
                entry["translation"] = t.tolist()
            clip_out["tracks"][n] = entry
        for n, tr in cloth_tracks.items():
            clip_out["tracks"][n] = {"rotation": [x.tolist() for x in continuous_quats(tr["rotation"])], "translation": np.array(tr["translation"]).tolist()}
        out["clips"].append(clip_out)
    # Bones the runtime hit overlay may turn (node extras hitRecoil): the joints under each listed
    # root. Never a walking limb, nor an arm that carries a prop on its own bone (the prop would stay
    # behind while the overlay turns the arm).
    recoil = set()
    for r in cfg.get("recoil", []):
        stack = [by_name[r]]
        while stack:
            i = stack.pop()
            if i in joints:
                recoil.add(g.nodes[i]["name"])
            stack += g.nodes[i].get("children", [])
    out["recoil"] = sorted(recoil)
    out["props"] = props

    def trs(M):
        s3 = np.linalg.norm(M[:3, :3], axis=0)
        return {"translation": M[:3, 3].tolist(), "rotation": quat_from_matrix(orthonormalize(M[:3, :3] / s3[None, :])).tolist(), "scale": s3.tolist()}
    # New cloth joints (node TRS under their parent, inverse bind column-major) and the cloth
    # meshes' new JOINTS_0 / WEIGHTS_0 per primitive, for studio.mjs.
    out["cloth"] = {"joints": [dict(trs(c["local"]), name=c["name"], parent=c["parent"], ibm=np.linalg.inv(c["bind"]).T.flatten().tolist()) for c in cloth_joints],
                    "weights": cloth_weights}
    out["legScale"] = out["scale"]
    out["skeleton"] = {b.name: {"head": b.head.tolist(), "tail": b.tail.tolist(), "parent": b.parent} for b in sk.bones}
    json.dump(out, open(os.path.join(work, "studio.json"), "w"))
    print(json.dumps({"clips": [c["name"] for c in out["clips"]], "legScale": out["scale"], "keyed": len(keyed)}))


if __name__ == "__main__":
    argv = sys.argv[1:]
    main(os.path.abspath(argv[-1]), argv[argv.index("--donors") + 1] if "--donors" in argv else os.path.join(REPO, "test-results/creature-motion/rig/donors"))
