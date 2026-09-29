"""Arthropod class: hexapods and octopods (beetles, spiders, weavers, crawlers, crabs).

The body is the thorax-and-abdomen blob: the solid opened by a ball about half the body's
thickness, so the legs fall away and the carapace stays. Legs are the ground tips; each is the
medial path from the blob to its tip, fitted with three segments (femur, tibia, tarsus) at the
path's own bends. Front tips that are not legs (mandibles, pedipalps, pincers) are front chains.

The carapace is one rigid piece: the body bone carries the thorax, the head and the abdomen, and the
weight override keeps leg and mandible weight off the shell, so plates never bend like skin.

Legs are paired with the donor's by side and order. A hexapod drops one donor pair: the pair whose
removal leaves the donor's own walk as close to an alternating tripod as possible (same side front
and back legs in phase, the middle leg and the other side opposite), with the legs' directions
breaking ties. So the donor's leg timing is kept, not re-authored. Mandibles and pincers take the
donor's pedipalp motion on top of their own rest (follow 0); legs do too, and the core's chain IK
then plants each tip on the donor's scaled tip path, so a leg keeps its own modelled shape.

Profiles (arthropod.donors.json): "hexapod" (beetles, crawlers, the crab), "spider" (the weavers:
spider Attack) and "claws" (pincers that rest on the ground, the rift carapace). Walk and Run are
the donor's own takes retargeted rest-relative: each tip follows the donor's tip path scaled by leg
length, never a redrawn one. Death is the Quaternius spider's roll onto its back with its hop damped
("hipRise"). Hit is the first beat of the scorpion's death take, eased back to its first frame.

Donor layouts (which donor bones are the legs, palps and hub) live in arthropod.donors.json under
"layouts", keyed by the class donor key.
"""
import itertools
import json
import os

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from crlib.body import resample
from crlib.mathx import normalize
from crlib.skeleton import Skeleton

NAME = "arthropod"
HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUTS = json.load(open(os.path.join(HERE, "arthropod.donors.json")))["layouts"]
SIDES = (("l", 1.0), ("r", -1.0))


# ------------------------------------------------------------------ donors
def _layout(donor):
    key = donor.key
    if key not in LAYOUTS:
        raise KeyError(f"arthropod.donors.json has no layout for donor {key}")
    return LAYOUTS[key]


def _phase(donor, clip, bone):
    """Phase (radians) of the first harmonic of a leg tip's height over one cycle."""
    if clip not in donor.clips:
        return None
    heads = donor.clips[clip]["heads"]
    frames = donor.clips[clip]["frames"]
    i = donor.index(bone)
    tip = heads[:, i] + np.einsum("fij,j->fi", frames[:, i], donor.rest_frame[bone].T @ (donor.rest_tail[bone] - donor.rest_head[bone]))
    y = tip[:, 1] - tip[:, 1].mean()
    n = len(y)
    return float(np.angle(np.sum(y * np.exp(-2j * np.pi * np.arange(n) / max(n - 1, 1)))))


def _plan_dir(v):
    return normalize(np.array([v[0], 0.0, v[2]]))


def choose_pairs(donor, targets):
    """Donor leg-pair indices (front to back) for the target's leg pairs. targets[side] is a list of
    (hip, tip) per target leg, front to back. Keeps the donor's gait: for a hexapod the subset whose
    walk phases are closest to an alternating tripod; for two pairs, the pair stepping in turn."""
    lay = _layout(donor)
    n_donor = len(lay["legs"]["l"])
    n = max(len(targets["l"]), len(targets["r"]))
    if n >= n_donor:
        return list(range(n_donor)), {"reason": "one to one"}
    walk = lay.get("walk")
    phase = {s: [_phase(donor, walk, lay["legs"][s][i][-1]) for i in range(n_donor)] for s, _ in SIDES}
    have_phase = all(p is not None for s in phase for p in phase[s])
    d_dirs = {s: [_plan_dir(donor.rest_tail[lay["legs"][s][i][-1]] - donor.rest_head[lay["legs"][s][i][0]]) for i in range(n_donor)] for s, _ in SIDES}
    best = None
    for subset in itertools.combinations(range(n_donor), n):
        gait = 0.0
        if have_phase:
            for s, _ in SIDES:
                p = [phase[s][i] for i in subset]
                # Neighbours on one side alternate; the two sides of one pair alternate.
                gait += sum(-np.cos(p[k + 1] - p[k]) for k in range(n - 1))
            gait += sum(-np.cos(phase["l"][i] - phase["r"][i]) for i in subset)
        space = 0.0
        for s, _ in SIDES:
            for k, (hip, tip) in enumerate(targets[s][:n]):
                space += float(np.dot(_plan_dir(tip - hip), d_dirs[s][subset[k]]))
        score = gait + 0.25 * space
        if best is None or score > best[0]:
            best = (score, list(subset), gait, space)
    return best[1], {"gaitScore": round(best[2], 3), "spaceScore": round(best[3], 3),
                     "phasesDeg": {s: [None if p is None else round(float(np.degrees(p))) for p in phase[s]] for s in phase}}


# ------------------------------------------------------------------ mesh
def _blob(body, frac):
    """The carapace: the core opened by a ball of frac times its largest radius (legs fall away)."""
    R = float(body.dt.max())
    k = max(1, int(round(frac * R / body.h)))
    seedset = body.dt > frac * R
    blob = ndimage.binary_dilation(seedset, iterations=k) & body.core
    labels, count = ndimage.label(blob)
    if count > 1:
        sizes = ndimage.sum(blob, labels, range(1, count + 1))
        blob = labels == (1 + int(np.argmax(sizes)))
    return blob


def _in_blob(body, blob, p):
    i = np.clip(body.to_index(p), 0, np.array(blob.shape) - 1)
    return bool(blob[tuple(i)])


def _fit_polyline(pts, segments, prior):
    """Break points of the polyline with `segments` pieces that best follows pts (resampled path),
    with the donor's segment proportions (prior, fractions summing to 1) as a weak pull, so a
    straight leg still gets donor-like joints. Returns the joint indices [0, ..., len-1]."""
    m = len(pts) - 1
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    total = s[-1]

    def seg_err(a, b):
        A, B = pts[a], pts[b]
        ab = B - A
        rel = pts[a:b + 1] - A
        t = np.clip(rel @ ab / max(ab @ ab, 1e-12), 0, 1)
        return float(np.sum(np.linalg.norm(rel - t[:, None] * ab, axis=1) ** 2))

    step = 4
    grid = range(step, m - step + 1, step)
    cum = np.cumsum([0] + list(prior))
    best = None
    for idx in itertools.combinations(grid, segments - 1):
        joints = [0, *idx, m]
        err = sum(seg_err(joints[k], joints[k + 1]) for k in range(segments))
        frac = s[joints] / total
        pull = float(np.sum((frac - cum) ** 2)) * total * total * 0.02 * m
        if best is None or err + pull < best[0]:
            best = (err + pull, joints)
    return best[1]


def _one_tip_per_limb(body, tips, S):
    """A foot with two claws or splayed toes gives several tips on one limb. Tips whose paths out
    of the carapace pass through the same place halfway out (within a few limb radii) are one
    limb; its tip is the one nearest the group's mean tip (the middle toe)."""
    def mid(t):
        pts, _ = resample(t["out"], 40) if len(t["out"]) > 1 else (np.array([t["pos"]] * 41), 0)
        return pts[20]
    groups = []
    for t in sorted(tips, key=lambda t: -t["length"]):
        m = mid(t)
        reach = max(3.0 * body.radius_at(m), 0.05 * S)
        bump = max(3.0 * body.radius_at(t["pos"]), 0.07 * S)
        for g in groups:
            # Same limb: halfway out at the same place, or a bump (a knee) on a longer limb's path.
            if np.linalg.norm(mid(g[0]) - m) < reach or np.min(np.linalg.norm(g[0]["out"] - t["pos"], axis=1)) < bump:
                g.append(t)
                break
        else:
            groups.append([t])
    out = []
    for g in groups:
        # Toes reach about as far as each other; a knee bump does not.
        g = [t for t in g if t["length"] >= 0.85 * g[0]["length"]]
        centre = np.mean([t["pos"] for t in g], axis=0)
        best = min(g, key=lambda t: np.linalg.norm(t["pos"] - centre))
        out.append(best)
    return out


def _leaves_blob(body, blob, path):
    """Index along a seed-to-tip path of the last point inside the blob."""
    inside = [_in_blob(body, blob, p) for p in path]
    last = 0
    for i, v in enumerate(inside):
        if v:
            last = i
    return last


def fit(body, donor, profile, source=None):
    H = body.height
    V = body.verts
    S = float(max(np.ptp(V, axis=0)))
    mid_x = 0.5 * (V[:, 0].min() + V[:, 0].max())
    seed = body.to_world(np.unravel_index(np.argmax(body.dt), body.dt.shape))
    blob = _blob(body, profile.get("blobFrac", 0.5))
    bp = body.to_world(np.argwhere(blob))
    notes = {"size": S, "seed": seed.tolist(), "blob": {"min": bp.min(0).tolist(), "max": bp.max(0).tolist(), "voxels": int(len(bp))}}
    half_w = 0.5 * np.ptp(bp[:, 0])

    if body.height < 0.6 * S:
        # Body cuts medial-graph edges between parts whose surfaces are 0.35 heights apart; for a
        # flat body (a crab) that is a few centimetres and severs the claws from the carapace.
        # Rebuild the graph against the body's size instead (reported as a core issue).
        height = body.height
        body.height = S
        body._medial_graph()
        body.height = height
        notes["medialGraphSize"] = S
    ext, dist, pred = body.extremities(seed, 0.045 * S, 0.12 * S)
    tips = []
    for e in ext:
        path = body.path(pred, e["node"])
        k = _leaves_blob(body, blob, path)
        out = path[k:]
        length = float(np.sum(np.linalg.norm(np.diff(out, axis=0), axis=1))) if len(out) > 1 else 0.0
        tips.append({"pos": e["position"], "path": path, "attach": path[k], "out": out, "length": length})
    # Ground tips: low relative to the body's height, or to its size for a flat body (a crab).
    ground = profile.get("groundTip", max(0.12 * H, min(0.08 * S, 0.35 * H)))
    front_zone = bp[:, 2].min() + profile.get("frontZone", 0.6) * np.ptp(bp[:, 2])
    legs = []
    for t in tips:
        p = t["pos"]
        lateral = abs(p[0] - mid_x)
        if t["length"] < 0.08 * S:
            continue
        ahead = p[2] > bp[:, 2].max() - 0.02 * S and lateral < 0.6 * half_w
        if p[1] < ground and lateral > 0.05 * S and not ahead:
            legs.append(t)
    legs = _one_tip_per_limb(body, legs, S)
    # Mandibles, pedipalps and pincers: per side, the core point farthest (along the medial graph)
    # from the body centre among the points ahead of the front zone that are not on a leg and not
    # above the body (antennae, horns). A pincer's fingertip is found even when it curls back and
    # makes no separate extremity.
    front = []
    nodes = body.to_world(body.nodes)
    leg_pts = np.vstack([t["out"] for t in legs]) if legs else np.zeros((1, 3)) + 1e9
    d_leg, _ = cKDTree(leg_pts).query(nodes)
    radius = body.dt[tuple(body.nodes.T)]
    ok = np.isfinite(dist) & (nodes[:, 2] > front_zone) & (nodes[:, 1] < seed[1] + 0.05 * S) & (d_leg > np.maximum(3 * radius, 0.1 * S))
    for sign in (1.0, -1.0):
        cand = np.nonzero(ok & (sign * (nodes[:, 0] - mid_x) > 0.01 * S))[0]
        if not len(cand):
            continue
        n = int(cand[np.argmax(dist[cand])])
        path = body.path(pred, n)
        k = _leaves_blob(body, blob, path)
        out = path[k:]
        length = float(np.sum(np.linalg.norm(np.diff(out, axis=0), axis=1))) if len(out) > 1 else 0.0
        if length >= profile.get("minFront", 0.08) * S and path[k][2] >= front_zone - 0.1 * np.ptp(bp[:, 2]):
            front.append({"pos": nodes[n], "path": path, "attach": path[k], "out": out, "length": length})
    for left in (True, False):
        if any((t["pos"][0] > mid_x) == left for t in front):
            continue
        # Flat mandibles are thinner than the voxel core keeps: take them from the mesh itself,
        # the vertices ahead of the carapace on this side, below the antennae and off the legs.
        V_ = body.verts
        d_leg_v, _ = cKDTree(leg_pts).query(V_)
        sel = (V_[:, 2] > bp[:, 2].max()) & (((V_[:, 0] - mid_x) > 0.01 * S) == left) & (np.abs(V_[:, 0] - mid_x) > 0.01 * S) \
            & (V_[:, 1] < seed[1] + 0.05 * S) & (V_[:, 1] > 0.1 * H) & (d_leg_v > 0.1 * S)
        if sel.sum() < 20:
            continue
        P = V_[sel]
        tip = P[np.argmax(P[:, 2])]
        base = bp[np.argmin(np.linalg.norm(bp - tip, axis=1))]
        length = float(np.linalg.norm(tip - base))
        if length >= profile.get("minFront", 0.08) * S:
            out = np.linspace(base, tip, 12)
            front.append({"pos": tip, "path": out, "attach": base, "out": out, "length": length, "thin": True})
    if profile.get("groundPincers"):
        # Pincers big enough to rest on the ground (the rift carapace) end in ground tips: the
        # frontmost ground limb on each side is the pincer, not a leg.
        front = []
        for left in (True, False):
            mine = [t for t in legs if (t["pos"][0] > mid_x) == left]
            if mine:
                claw = max(mine, key=lambda t: t["pos"][2])
                legs = [t for t in legs if t is not claw]
                front.append(claw)
    used = {id(t) for t in legs + front}
    notes["tips"] = {"legs": [t["pos"].tolist() for t in legs], "front": [t["pos"].tolist() for t in front],
                     "ignored": [t["pos"].tolist() for t in tips if id(t) not in used]}

    lay = _layout(donor)
    d_legs = lay["legs"]
    d_len = lambda chain: [np.linalg.norm(donor.rest_head[chain[i + 1]] - donor.rest_head[chain[i]]) for i in range(len(chain) - 1)] + \
        [np.linalg.norm(donor.rest_tail[chain[-1]] - donor.rest_head[chain[-1]])]
    prior = np.mean([d_len(c) for s in ("l", "r") for c in d_legs[s]], axis=0)
    prior = prior / prior.sum()

    # ---------------------------------------------------------------- legs
    fitted = {"l": [], "r": []}
    for t in legs:
        side = "l" if t["pos"][0] > mid_x else "r"
        pts, _ = resample(t["out"], 120)
        joints = _fit_polyline(pts, 3, prior)
        J = [pts[j].copy() for j in joints]
        fitted[side].append({"joints": J, "hip": J[0], "tip": J[-1]})
    for side in fitted:
        fitted[side].sort(key=lambda g: -g["hip"][2])
    _symmetrise(fitted, mid_x, 0.08 * S)
    subset, why = choose_pairs(donor, {s: [(g["hip"], g["tip"]) for g in fitted[s]] for s in fitted})
    notes["legPairs"] = {"donorPairs": subset, **why}

    # ---------------------------------------------------------------- body
    near = lambda z: bp[np.abs(bp[:, 2] - z) < 2 * body.h]
    hips = [g["hip"] for s in fitted for g in fitted[s]]
    hub_z = float(np.mean([h[2] for h in hips])) if hips else float(seed[2])
    sec = near(hub_z)
    hub = np.array([mid_x, float(sec[:, 1].mean()) if len(sec) else seed[1], hub_z])
    fr = bp[bp[:, 2] > bp[:, 2].max() - 3 * body.h]
    rr = bp[bp[:, 2] < bp[:, 2].min() + 3 * body.h]
    front_pt = np.array([mid_x, float(fr[:, 1].mean()), float(fr[:, 2].max())])
    rear_pt = np.array([mid_x, float(rr[:, 1].mean()), float(rr[:, 2].min())])
    if np.linalg.norm(front_pt - hub) < 0.1 * S:
        front_pt = hub + np.array([0, 0, 0.1 * S])
    sk = Skeleton()
    sk.add("root", None, np.array([mid_x, 0.0, hub_z]), np.array([mid_x, 0.1 * H, hub_z]), donor=lay["root"], follow=0.0, kind="root")
    sk.add("body", "root", hub, front_pt, donor=lay["hub"], follow=0.0)
    # profile "abdomen": false keeps the abdomen on the body bone: a beetle's elytra are one
    # shell with the thorax, and a separate abdomen bone opens them like a clam when the
    # donor's abdomen swings (the spider's Death) or the runtime Hit recoils it.
    if profile.get("abdomen", True) and np.linalg.norm(rear_pt - hub) > 0.1 * S:
        sk.add("abdomen", "body", hub, rear_pt, donor=lay.get("abdomen"), follow=0.0)

    leg_follow = profile.get("legFollow", 0.0)
    for side, _ in SIDES:
        for o, g in enumerate(fitted[side]):
            if o >= len(subset):
                break
            chain = d_legs[side][subset[o]]
            J = g["joints"]
            parent = "body"
            for k in range(3):
                name = f"leg_{side}{o}_{k + 1}"
                sk.add(name, parent, J[k], J[k + 1], donor=chain[k], follow=leg_follow, kind="leg")
                parent = name
            g["bones"] = [f"leg_{side}{o}_{k + 1}" for k in range(3)]

    # --------------------------------------------------------- front chains
    palps = lay.get("palps") or {}
    front.sort(key=lambda t: -t["length"])
    count = {"l": 0, "r": 0}
    for t in front:
        side = "l" if t["pos"][0] > mid_x else "r"
        L = t["length"]
        n = profile.get("frontBones") or (1 if L < 0.18 * S else (2 if L < 0.35 * S else 3))
        pts, _ = resample(t["out"], 60)
        joints = _fit_polyline(pts, n, [1.0 / n] * n) if n > 1 else [0, len(pts) - 1]
        J = [pts[j] for j in joints]
        d_chain = (palps.get(side) or [None] * 3)[-n:]
        parent = "body"
        i = count[side]
        count[side] += 1
        for k in range(n):
            name = f"palp_{side}{i}_{k + 1}"
            sk.add(name, parent, J[k], J[k + 1], donor=d_chain[k], follow=0.0, kind="arm")
            parent = name
    notes["front"] = [{"tip": t["pos"].tolist(), "length": t["length"]} for t in front]
    if source and source.get("labels"):
        # A healthy Tripo rig (the arachnid download) cross-checks the fitted legs: its legs by
        # side and order against ours, hip to hip and tip to tip.
        pos = {j["name"]: np.asarray(j["position"], float) for j in source["joints"]}
        check = {}
        for g in source["labels"]["legs"]:
            mine = fitted[g["side"]][g["order"]] if g["order"] < len(fitted[g["side"]]) else None
            lateral = [n for n in g["chain"] if abs(pos[n][0] - mid_x) > 0.05 * S]
            if mine is None or not lateral:
                continue
            check[f"{g['side']}{g['order']}"] = {"hip": round(float(np.linalg.norm(pos[lateral[0]] - mine["hip"]) / S), 3),
                                                  "tip": round(float(np.linalg.norm(pos[g["tip"]] - mine["tip"]) / S), 3)}
        notes["sourceCheck"] = {"file": source.get("file"), "legs": len(source["labels"]["legs"]), "offsetsOverSize": check}
    pads = []
    for side in fitted:
        for g in fitted[side]:
            h, t = g["joints"][2], g["joints"][3]
            pads.append(np.median([body.radius_at(h + u * (t - h)) for u in (0.3, 0.5, 0.7)]) / max(np.linalg.norm(t - h), 1e-9))
    notes["footPad"] = round(float(np.median(pads)), 3) if pads else 0.0
    sk.arth = {"pad": notes["footPad"], "subset": subset, "legs": {s: [g.get("bones") for g in fitted[s] if g.get("bones")] for s in fitted}, "blob": blob,
               "bodyLength": float(np.ptp(V[:, 2])), "belly": float(bp[:, 1].min())}
    return sk, notes


def _symmetrise(fitted, mid_x, tolerance):
    """Averages mirrored joints of legs with the same order on both sides when they agree."""
    mirror = lambda p: np.array([2 * mid_x - p[0], p[1], p[2]])
    for L, R in zip(fitted["l"], fitted["r"]):
        if max(np.linalg.norm(a - mirror(b)) for a, b in zip(L["joints"], R["joints"])) > 3 * tolerance:
            continue
        for k in range(len(L["joints"])):
            avg = 0.5 * (L["joints"][k] + mirror(R["joints"][k]))
            L["joints"][k], R["joints"][k] = avg, mirror(avg)
        L["hip"], L["tip"] = L["joints"][0], L["joints"][-1]
        R["hip"], R["tip"] = R["joints"][0], R["joints"][-1]


def donor_map(sk, donor, profile):
    """Maps the primary donor's bones to another donor's by leg side and order (same pair subset,
    by index), hub and root; palps without a twin follow their parent."""
    lay = _layout(donor)
    _damp_rise(donor, lay, profile)
    _rebase_palps(donor, lay, profile)
    _crouch(sk, donor, lay, profile)
    _hit_beat(sk, donor, lay, profile)
    out = {}
    for b in sk.bones:
        if b.name == "root":
            out[b.name] = lay["root"]
        elif b.name == "body":
            out[b.name] = lay["hub"]
        elif b.name == "abdomen":
            out[b.name] = lay.get("abdomen")
        elif b.name.startswith("leg_"):
            side, order, k = b.name[4], int(b.name[5]), int(b.name.split("_")[-1]) - 1
            idx = sk.arth["subset"][order]
            chains = lay["legs"][side]
            out[b.name] = chains[idx][k] if idx < len(chains) else None
        elif b.name.startswith("palp_"):
            side = b.name[5]
            chain = (lay.get("palps") or {}).get(side)
            n = len([x for x in sk.bones if x.name.startswith(b.name.rsplit("_", 1)[0] + "_")])
            k = int(b.name.split("_")[-1]) - 1
            out[b.name] = chain[-n:][k] if chain else None
    return out


def cloth(body, sk, profile, heat):
    """Not cloth: the weight override that keeps parts apart. Every vertex belongs to the carapace
    (it is nearer the blob than any limb's capsules) or to one limb (a leg, a mandible, a pincer:
    the limb bone heat mostly gives it to, else the nearest capsule). A vertex keeps only its own
    limb's weight plus the carapace, so a foot modelled against its neighbour never takes that
    neighbour's weight, and the shell carries no limb weight except in a thin band at each limb's
    base: plates stay rigid."""
    from crlib.skin import segment_distance

    V = body.verts
    names = sk.names()
    blob = sk.arth["blob"]
    edt = ndimage.distance_transform_edt(~blob) * body.h
    idx = np.clip(body.to_index(V), 0, np.array(blob.shape) - 1)
    d_body = edt[tuple(idx.T)]
    parts = {}
    for b in sk.bones:
        if b.kind in ("leg", "arm"):
            parts.setdefault(b.name.rsplit("_", 1)[0], []).append(b.name)
    shell = [n for n in ("body", "abdomen") if n in names]
    keys = list(parts)
    D = np.full((len(V), len(keys)), np.inf)
    for k, key in enumerate(keys):
        bones = [sk[n] for n in parts[key]]
        heads = np.array([b.head for b in bones])
        tails = np.array([b.tail for b in bones])
        radii = []
        for b in bones:
            samples = [b.head + t * (b.tail - b.head) for t in (0.25, 0.5, 0.75)]
            radii.append(max(np.median([body.radius_at(p) for p in samples]), body.h))
        D[:, k] = (segment_distance(V, heads, tails) - np.array(radii)[None, :]).min(1)
    band = profile.get("hipBand", 1.5) * body.h
    # Which limb a vertex belongs to: the limb bone heat mostly gives it to (heat spreads inside
    # the surface, so a pincer's finger stays with the pincer even where a leg passes close
    # behind it); where heat is split between limbs (feet modelled touching), the nearest capsule.
    names0 = sk.names()
    mass = np.stack([heat[:, [names0.index(n) for n in parts[key]]].sum(1) for key in keys], axis=1)
    total = mass.sum(1)
    clear = (total > 1e-6) & (mass.max(1) > 0.7 * np.maximum(total, 1e-9))
    nearest = np.where(clear, np.argmax(mass, axis=1), np.argmin(D, axis=1))
    d_part = D[np.arange(len(V)), nearest]
    col = {n: i for i, n in enumerate(names)}
    shell_cols = [col[n] for n in shell]

    def override(W):
        W = W.copy()
        if W.shape[1] < len(names):
            W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
        out = np.zeros_like(W)
        on_body = d_body <= d_part - band
        on_part = ~on_body
        # Carapace: shell bones only.
        out[np.ix_(on_body, shell_cols)] = W[np.ix_(on_body, shell_cols)]
        # A part and the band where it meets the shell: its own bones plus the shell.
        for k, key in enumerate(keys):
            rows = np.nonzero(on_part & (nearest == k))[0]
            cols = [col[n] for n in parts[key]] + shell_cols
            out[np.ix_(rows, cols)] = W[np.ix_(rows, cols)]
            # Well away from the shell the part carries no shell weight at all.
            far = rows[d_body[rows] > d_part[rows] + 3 * band]
            out[np.ix_(far, shell_cols)] = 0.0
        empty = out.sum(1) < 1e-6
        if empty.any():
            # Heat gave this vertex only to other parts: its own part's nearest bone (or the shell).
            for v in np.nonzero(empty)[0]:
                if on_body[v]:
                    out[v, col["body"]] = 1.0
                else:
                    bones = parts[keys[nearest[v]]]
                    b = min(bones, key=lambda n: segment_distance(V[v:v + 1], sk[n].head[None], sk[n].tail[None])[0, 0])
                    out[v, col[b]] = 1.0
        out /= out.sum(1, keepdims=True)
        # Parts the mesh fuses (two feet modelled touching) must not be smoothed into each other:
        # vertices with a neighbour in another part are locked.
        part = np.where(on_body, -1, nearest)
        F = body.faces
        e = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
        cross = (part[e[:, 0]] != part[e[:, 1]]) & (part[e[:, 0]] >= 0) & (part[e[:, 1]] >= 0)
        seam = np.zeros(len(V), bool)
        seam[e[cross].ravel()] = True
        return out, on_body | seam
    return override


def _damp_rise(donor, lay, profile):
    """profile "hipRise": {State: k} scales how far the donor's hub rises above its rest height in
    that state's take (the Quaternius spider's death hops 1.4 standing heights before it lands on
    its back; at k=0.35 it rolls over close to the ground). Drops are kept as they are."""
    for state, k in (profile.get("hipRise") or {}).items():
        spec = profile["clips"].get(state)
        if not spec or spec["donor"] != donor.key or spec["clip"] not in donor.clips or getattr(donor, "_damped", {}).get(spec["clip"]):
            continue
        heads = donor.clips[spec["clip"]]["heads"]
        i = donor.index(lay["hub"])
        rest_y = donor.rest_head[lay["hub"]][1]
        above = heads[:, i, 1] - rest_y
        lift = np.where(above > 0, (k - 1.0) * above, 0.0)
        # The hub's children ride along (their heads are world positions sampled with it).
        below = [j for j, b in enumerate(donor.bones) if _descends(donor, b, lay["hub"])]
        heads[:, below, 1] += lift[:, None]
        donor._damped = {**getattr(donor, "_damped", {}), spec["clip"]: k}


def _rebase_palps(donor, lay, profile):
    """The scorpion's Walk and Run takes hold the pedipalps 22-25 degrees (the tail base 5) off the
    rig's rest for the whole cycle (their take files carry another rest), while Idle holds them at
    rest. On a crab's
    claw that is a visible roll every time the gait starts. In loop takes the palps' motion is
    taken relative to the take's first frame instead, so only the cycle's own movement transfers."""
    palps = [b for side in (lay.get("palps") or {}).values() for b in side] + ([lay["abdomen"]] if lay.get("abdomen") else [])
    if not palps or not profile.get("palpRebase", True):
        return
    done = getattr(donor, "_rebased", set())
    for spec in profile["clips"].values():
        if spec["donor"] != donor.key or not spec.get("loop") or spec["clip"] not in donor.clips or spec["clip"] in done:
            continue
        frames = donor.clips[spec["clip"]]["frames"]
        for b in palps:
            i = donor.index(b)
            fix = frames[0, i].T @ donor.rest_frame[b]
            frames[:, i] = frames[:, i] @ fix
        done.add(spec["clip"])
    donor._rebased = done


def _leg_scale(sk, donor, lay):
    """The core's size ratio (target leg length over donor leg length, the pairs in use), and the
    target's mean leg length."""
    t, d = [], []
    for side in ("l", "r"):
        for o, bones in enumerate(sk.arth["legs"][side]):
            t.append(sum(np.linalg.norm(sk[b].tail - sk[b].head) for b in bones))
            chain = lay["legs"][side][sk.arth["subset"][o]]
            J = [donor.rest_head[b] for b in chain] + [donor.rest_tail[chain[-1]]]
            d.append(sum(np.linalg.norm(J[i + 1] - J[i]) for i in range(len(J) - 1)))
    return float(np.mean(t) / np.mean(d)), float(np.mean(t))


def _tip_path(donor, clip, bone):
    heads = donor.clips[clip]["heads"]
    frames = donor.clips[clip]["frames"]
    i = donor.index(bone)
    return heads[:, i] + np.einsum("fij,j->fi", frames[:, i], donor.rest_frame[bone].T @ (donor.rest_tail[bone] - donor.rest_head[bone]))


def _crouch(sk, donor, lay, profile):
    """profile "crouch": {State: share of the hips' height}: the body rides that much lower for
    the whole take (the hub's path is lowered; the leg tips stay where the donor puts them, so the
    legs bend more). A scuttle runs crouched, and the weavers stand in the low, splayed crouch
    their production idle had."""
    done = getattr(donor, "_crouched", set())
    if sk.arth["pad"] > profile.get("stumpyPad", 0.2):
        # Stumpy feet (the slag crawler's pads are a third as thick as they are long) cannot bend
        # under a lower body: the pad tips and digs into the floor. They stand as modelled.
        return
    i = donor.index(lay["hub"])
    scale, _ = _leg_scale(sk, donor, lay)
    for state, share in (profile.get("crouch") or {}).items():
        spec = profile["clips"].get(state)
        if not spec or spec["donor"] != donor.key or spec["clip"] not in donor.clips or spec["clip"] in done:
            continue
        # A low-slung body (the slag crawler) has little room under its belly: never more than
        # half of it.
        drop = min(share * sk["body"].head[1], 0.5 * sk.arth["belly"])
        donor.clips[spec["clip"]]["heads"][:, i, 1] -= drop / scale
        done.add(spec["clip"])
    donor._crouched = done


def _hit_beat(sk, donor, lay, profile):
    """profile "clips"."Hit": {donor, clip, "beat": [first, last], "recover": frames}: the donor
    take's first beat (the scorpion's death flinch: the body tips back and drops, pincers snap in)
    played to its peak, then eased back to its first frame by slerping every bone and lerping every
    head over "recover" frames. The source is sampled motion, not a curve typed here."""
    spec = profile["clips"].get("Hit")
    if not spec or spec["donor"] != donor.key or "beat" not in spec or spec["clip"] not in donor.clips:
        return
    from crlib.mathx import slerp_matrix

    src = donor.clips[spec["clip"]]
    a, b = spec["beat"]
    g = spec.get("gain", 1.0)
    # "gain" scales the beat's motion away from its first frame (1.5: the scorpion flinches a
    # third of a hip height; the recoil should read on a large shell at game distance).
    frames = [np.array([slerp_matrix(src["frames"][a, i], src["frames"][f, i], g) for i in range(len(donor.bones))]) for f in range(a, b + 1)]
    heads = [src["heads"][a] + g * (src["heads"][f] - src["heads"][a]) for f in range(a, b + 1)]
    peak_f, peak_h = frames[-1], heads[-1]
    R = spec.get("recover", 9)
    for k in range(1, R + 1):
        t = k / R
        w = t * t * (3 - 2 * t)
        frames.append(np.array([slerp_matrix(peak_f[i], src["frames"][a, i], w) for i in range(len(donor.bones))]))
        heads.append((1 - w) * peak_h + w * src["heads"][a])
    # The flinch drops the hub; keep the belly off the floor (at most 70% of its clearance, the
    # crouch included; 15% on stumpy feet, which dig in when the legs fold).
    heads = np.array(heads)
    hub = donor.index(lay["hub"])
    scale, leg = _leg_scale(sk, donor, lay)
    stumpy = sk.arth["pad"] > profile.get("stumpyPad", 0.2)
    room = 0.15 if stumpy else 0.7
    floor = donor.rest_head[lay["hub"]][1] - room * sk.arth["belly"] / scale
    lift = np.maximum(floor - heads[:, hub, 1], 0.0)
    # The shell recoils back by at most 6% of a leg's length: further and the legs, planted
    # below, would have to reach past their length.
    back = heads[:, hub, [0, 2]] - heads[0, hub, [0, 2]]
    cap = 0.06 * leg / scale
    norm = np.linalg.norm(back, axis=1)
    shrink = np.where(norm > cap, cap / np.maximum(norm, 1e-12), 1.0) - 1.0
    below_h = [j for j, bone in enumerate(donor.bones) if _descends(donor, bone, lay["hub"])]
    for j in below_h:
        heads[:, j, 0] += shrink * back[:, 0]
        heads[:, j, 2] += shrink * back[:, 1]
    below = [j for j, bone in enumerate(donor.bones) if _descends(donor, bone, lay["hub"])]
    heads[:, below, 1] += lift[:, None]
    # The shell tips back by at most the angle that moves its ends by 20% of a leg (6% on stumpy
    # feet, whose pads pitch into the floor as the legs fold): the scorpion's
    # tilt on a long, short-legged shell (the slag crawler) lifts the front legs off the floor and
    # folds the back ones through it.
    ang_cap = np.arcsin(min(1.0, (0.06 if stumpy else 0.2) * leg / max(0.5 * sk.arth["bodyLength"], 1e-9)))
    legs_used = {b for side in ("l", "r") for o in range(len(sk.arth["legs"][side])) for b in lay["legs"][side][sk.arth["subset"][o]]}
    ride = [j for j in below_h if donor.bones[j] not in legs_used]
    for f in range(len(frames)):
        D = frames[f][hub] @ frames[0][hub].T
        angle = np.arccos(np.clip((np.trace(D) - 1) / 2, -1, 1))
        if angle <= ang_cap:
            continue
        C = slerp_matrix(np.eye(3), D, ang_cap / angle) @ D.T
        c = heads[f, hub].copy()
        for j in ride:
            frames[f][j] = C @ frames[f][j]
            heads[f, j] = c + C @ (heads[f, j] - c)
    # Feet stay planted where they stood: the flinch is the shell's, and the runtime overlay
    # layers it on locomotion with the legs protected anyway.
    # The legs also keep their segments' orientations (a stumpy pad tipped by the death take's
    # leg curl digs into the floor); the chain IK alone bends them under the moving shell.
    frames = np.array(frames)
    for side in ("l", "r"):
        for o in range(len(sk.arth["legs"][side])):
            chain = lay["legs"][side][sk.arth["subset"][o]]
            for bone in chain:
                frames[:, donor.index(bone)] = frames[0, donor.index(bone)]
            last = chain[-1]
            j = donor.index(last)
            tip = heads[:, j] + np.einsum("fij,j->fi", frames[:, j], donor.rest_frame[last].T @ (donor.rest_tail[last] - donor.rest_head[last]))
            heads[:, j] += tip[0] - tip
    name = f"{spec['clip']} beat {a}-{b} recovered"
    donor.clips[name] = {"frames": frames, "heads": heads, "fps": src["fps"], "duration": (len(frames) - 1) / src["fps"]}
    spec["clip"] = name


def _descends(donor, bone, ancestor):
    while bone is not None:
        if bone == ancestor:
            return True
        bone = donor.parent[bone]
    return False


def plan(sk, body, profile):
    legs = []
    for side in ("l", "r"):
        for bones in sk.arth["legs"][side]:
            legs.append({"chain": bones, "foot": None, "toe": None, "pivot": None})
    return {"hips": "body", "legs": legs, "chains": [], "colliders": [], "hip_motion": profile.get("hipMotion", 1.0)}


def bind_turns(sk, profile):
    """profile "legArch" (degrees): a leg modelled running flat along the floor (the reed strider's
    legs drop straight to a knee near the floor) has its femur raised by that angle and its tibia
    turned back down until the tip is at its bind height again, so the knee is the leg's high
    point, like a strider's or a spider's. A flat leg has no room to bend: the donor's knee bend
    folds it through the floor. The mesh is re-posed once with dual quaternions; rest == bind."""
    arch = profile.get("legArch")
    if not arch:
        return {}
    from crlib.mathx import axis_angle

    turns = {}
    for side in ("l", "r"):
        for bones in sk.arth["legs"][side]:
            femur, tibia, tarsus = (sk[b] for b in bones)
            out = femur.tail - femur.head
            flat = normalize(np.array([out[0], 0.0, out[2]]))
            axis = normalize(np.cross(flat, [0.0, 1.0, 0.0]))
            up = axis_angle(axis, np.radians(arch))
            knee = femur.head + up @ (femur.tail - femur.head)
            rest_tip = tarsus.tail
            # The tibia (and the tarsus with it) turns down about the raised knee until the tip is
            # back at its bind height.
            below = [up @ (p - femur.tail) for p in (tibia.tail, tarsus.tail)]
            angles = np.radians(np.arange(0.0, -120.0, -0.25))
            ys = np.array([knee[1] + (axis_angle(axis, a) @ below[1])[1] for a in angles])
            k = int(np.argmin(np.abs(ys - rest_tip[1])))
            turns[bones[0]] = up
            turns[bones[1]] = axis_angle(axis, angles[k])
    return turns


def recoil_bones(sk, plan, profile):
    """The runtime Hit overlay moves the abdomen and the mandibles or pincers. Not the legs, and not
    the body bone either: the legs hang from it, so its recoil would swing every planted foot
    through the floor under the locomotion it is layered on."""
    return [b.name for b in sk.bones if b.name == "abdomen" or b.name.startswith("palp_")]


def closeup_joints(sk, profile):
    """Knees of a front, a middle and a back leg, the first mandible or pincer joint, the shell."""
    names = [f"leg_l0_2", f"leg_l1_2", f"leg_r{max(len(sk.arth['legs']['r']) - 1, 0)}_2", "palp_l0_1", "body"]
    return [n for n in names if n in sk]
