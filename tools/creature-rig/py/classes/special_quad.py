"""A round body carried on four legs, named after an animal-pack donor.

Shared by the reliquary (a porcelain vessel on four stubby legs) and the thorn maw (a flower maw
on a thorn bulb with four splayed root legs). The skeleton uses the donor's own bone names
(<Animal>_ROOTSHJnt, _Spine_01-04, _Spine_TopSHJnt, _<side>_<Front|Hind>Leg_<Hip|Knee..|Ankle|Ball>,
_Neck_01/_02/_Top, _Head_Top, _Head_Jaw), so the animal-pack takes retarget bone for bone.

Joints are measured, not typed: the feet are the four floor contacts (one per quadrant round the
body); each leg's centre line is followed up through horizontal slabs until it joins the body,
which puts the hip; knees and ankles sit on that line at the donor's height ratios; the ball and
toe run from the ankle to the foot's farthest point along the facing. The spine runs between the
hind and front hips at hip height; the neck runs from the chest to a head point the class gives.

Torso and neck add the donor's motion to their rest (follow 0); legs copy it (follow 1, or the
profile's legFollow for legs shaped unlike the donor's) and are IK-solved to the donor's scaled
foot paths, so planted feet stay planted.
"""
import re

import numpy as np

from crlib.body import resample
from crlib.skeleton import Skeleton


def prefix(donor):
    root = next(b for b in donor.bones if b.endswith("_ROOTSHJnt"))
    return root[: -len("_ROOTSHJnt")]


def leg_names(donor, side, end):
    """Donor bones of one leg, hip first: <P>_<side>_<Front|Hind>Leg_<part>SHJnt."""
    P = prefix(donor)
    pat = re.compile(rf"^{P}_{side}_{end}Leg_(\w+?)SHJnt$")
    out = []
    b = next(n for n in donor.bones if n == f"{P}_{side}_{end}Leg_HipSHJnt")
    while b is not None and pat.match(b):
        out.append(b)
        kids = [c for c in donor.children(b) if pat.match(c)]
        b = kids[0] if kids else None
    return out


def _track_leg(body, foot_xz, others, top):
    """Slab centroids of one leg from the floor up, until the leg's piece of the slab joins
    another leg's or grows into the body. Returns (points [n, 3], join height)."""
    pts = []
    prev = np.asarray(foot_xz, float)
    counts = []
    y = 0.03 * body.height
    while y < top:
        comps = body.slab(y, 1.5 * body.h)
        if not comps:
            break
        c = min(comps, key=lambda c: np.min(np.linalg.norm(c["points"] - prev, axis=1)))
        if np.min(np.linalg.norm(c["points"] - prev, axis=1)) > 4 * body.h:
            break
        shared = any(np.min(np.linalg.norm(c["points"] - o, axis=1)) < 2 * body.h for o in others)
        if len(counts) > 3 and (shared or c["count"] > 3.0 * np.median(counts)):
            return np.array(pts), y
        counts.append(c["count"])
        pts.append([c["centroid"][0], y, c["centroid"][1]])
        prev = c["centroid"]
        y += body.h
    return np.array(pts), y


def feet(body):
    """Four floor contacts, one per quadrant round the centre of the low band:
    {("l"|"r", "Front"|"Hind"): points}. +X is the creature's left, +Z its front."""
    V = body.verts
    low = V[V[:, 1] < 0.04 * body.height]
    c = 0.5 * (low.min(0) + low.max(0))
    out = {}
    for side, sx in (("l", 1), ("r", -1)):
        for end, sz in (("Front", 1), ("Hind", -1)):
            sel = low[(sx * (low[:, 0] - c[0]) > 0) & (sz * (low[:, 2] - c[2]) > 0)]
            if len(sel) < 5:
                raise RuntimeError(f"no {side} {end} foot on the floor")
            out[(side, end)] = sel
    return out, c


def fit_quad(body, donor, profile, head_tip, head_base=None, head_joint=None):
    """Skeleton for a body on four legs. head_tip: the point the head reaches (the snout, the
    maw's front); head_base: where the neck leaves the body (default: the chest); head_joint:
    where the head turns on the neck (default: three quarters of the way to the tip)."""
    H = body.height
    P = prefix(donor)
    contacts, centre = feet(body)
    V = body.verts
    top = float(V[:, 1].max())
    tracks, joins = {}, {}
    starts = {k: np.median(v[:, [0, 2]], axis=0) for k, v in contacts.items()}
    for key, xz in starts.items():
        others = [o for k, o in starts.items() if k != key]
        tracks[key], joins[key] = _track_leg(body, xz, others, top)
    notes = {"legJoin": {f"{k[0]}_{k[1]}": round(float(v), 4) for k, v in joins.items()}}

    legs = {}
    for (side, end), line in tracks.items():
        names = leg_names(donor, side, end)
        d = np.array([donor.rest_head[n] for n in names])
        hip_y = joins[(side, end)] + profile.get("hipInset", 0.04) * H
        hip = np.array([line[-1][0], hip_y, line[-1][2]])
        # Knees and ankle sit on the leg's centre line at the donor's arc-length ratios from the
        # hip down to the ankle (a sprawled donor's knee can be higher than its hip, so heights
        # alone would put it above the body). The ankle's height is the donor's share of the
        # hip height.
        parts = [n[len(f"{P}_{side}_{end}Leg_"):-len("SHJnt")] for n in names]
        k_ankle = parts.index("Ankle")
        seg = np.linalg.norm(np.diff(d[:k_ankle + 1], axis=0), axis=1)
        frac = np.concatenate([[0], np.cumsum(seg)]) / max(seg.sum(), 1e-9)
        ankle_y = max(d[k_ankle][1] / d[0][1] * hip_y, 0.03 * H)
        down = np.vstack([hip, line[::-1]])
        down = down[down[:, 1] >= ankle_y - 1e-9]
        down = np.vstack([down, [np.interp(ankle_y, line[:, 1], line[:, 0]), ankle_y, np.interp(ankle_y, line[:, 1], line[:, 2])]])
        path, _ = resample(down, 100)
        pos = {}
        for n, f in zip(names[:k_ankle + 1], frac):
            pos[n] = path[int(round(f * 100))]
        # Ball and toe: from the ankle forward to the foot's farthest point along the facing.
        pts = contacts[(side, end)]
        tip = pts[np.argmax(pts[:, 2])].copy()
        ankle = pos[names[-3]] if len(names) >= 3 else hip
        ball_name = next((n for n in names if n.endswith("_BallSHJnt")), None)
        toe_name = next((n for n in names if n.endswith("_ToeSHJnt")), None)
        if ball_name:
            ball = ankle + 0.55 * (tip - ankle)
            ball[1] = 0.25 * ankle[1]
            pos[ball_name] = ball
        tip[1] = pos[ball_name][1] if ball_name else tip[1]
        legs[(side, end)] = {"names": names, "pos": pos, "tip": tip, "toe": toe_name, "ball": ball_name}

    hind = np.mean([legs[(s, "Hind")]["pos"][legs[(s, "Hind")]["names"][0]] for s in "lr"], axis=0)
    front = np.mean([legs[(s, "Front")]["pos"][legs[(s, "Front")]["names"][0]] for s in "lr"], axis=0)
    lift = profile.get("spineLift", 0.1) * (top - hind[1])
    root = np.array([0.5 * (hind[0] + front[0]), hind[1] + lift, hind[2]])
    chest = np.array([root[0], front[1] + lift, front[2]])
    if profile.get("spineHeight") is not None:
        # A body whose hind legs join it high up (vines climbing the back) keeps its spine
        # level through the body's middle.
        root[1] = chest[1] = profile["spineHeight"] * H

    sk = Skeleton()
    main = np.array([root[0], 0.0, 0.5 * (hind[2] + front[2])])
    sk.add(f"{P}_MAINSHJnt", None, main, main + [0, 0.1 * H, 0], donor=f"{P}_MAINSHJnt", follow=0.0, kind="root")
    spine = [f"{P}_ROOTSHJnt", f"{P}_Spine_01SHJnt", f"{P}_Spine_02SHJnt", f"{P}_Spine_03SHJnt", f"{P}_Spine_04SHJnt", f"{P}_Spine_TopSHJnt"]
    heads, _ = resample(np.array([root, chest]), len(spine) - 1)
    neck_from = chest if head_base is None else np.asarray(head_base, float)
    head_tip = np.asarray(head_tip, float)
    parent = f"{P}_MAINSHJnt"
    for i, n in enumerate(spine):
        tail = heads[i + 1] if i + 1 < len(spine) else neck_from + 0.3 * (head_tip - neck_from)
        if np.linalg.norm(tail - heads[i]) < 1e-3:
            tail = heads[i] + [0, 0, 0.02 * H]
        sk.add(n, parent, heads[i], tail, donor=n, follow=0.0)
        parent = n
    neck = [f"{P}_Neck_01SHJnt", f"{P}_Neck_02SHJnt", f"{P}_Neck_TopSHJnt"]
    joint = neck_from + 0.75 * (head_tip - neck_from) if head_joint is None else np.asarray(head_joint, float)
    npts, _ = resample(np.array([neck_from, joint]), 3)
    parent = spine[-1]
    for i, n in enumerate(neck):
        sk.add(n, parent, npts[i], npts[i + 1], donor=n, follow=0.0)
        parent = n
    sk.add(f"{P}_Head_TopSHJnt", neck[-1], joint, head_tip, donor=f"{P}_Head_TopSHJnt", follow=0.0)

    for (side, end), leg in legs.items():
        names, pos = leg["names"], leg["pos"]
        if end == "Front":
            clav = f"{P}_{side}_Clavicle_01_01SHJnt"
            sk.add(clav, spine[-1], chest, pos[names[0]], donor=clav, follow=0.0)
            parent = clav
        else:
            parent = spine[0]
        chain = [n for n in names if n != leg["toe"]]
        for i, n in enumerate(chain):
            tail = pos[chain[i + 1]] if i + 1 < len(chain) else leg["tip"]
            is_foot = n.endswith("_AnkleSHJnt") or n == leg["ball"]
            follow = 0.0 if is_foot else profile.get("legFollow", 1.0)
            sk.add(n, parent, pos[n], tail, donor=n, follow=follow, kind="leg")
            parent = n
    sk.quad = {"prefix": P, "legs": {f"{s}_{e}": [n for n in leg["names"] if n != leg["toe"]] for (s, e), leg in legs.items()},
               "joinY": float(np.mean(list(joins.values())))}
    notes.update({"root": root.tolist(), "chest": chest.tolist(), "headTip": head_tip.tolist()})
    return sk, notes


def quad_legs(sk):
    """plan() legs: IK over the hip-to-ankle chain, the ankle bone as the foot, the ball as toe."""
    out = []
    for names in sk.quad["legs"].values():
        ankle = next(n for n in names if n.endswith("_AnkleSHJnt"))
        ball = next((n for n in names if n.endswith("_BallSHJnt")), None)
        chain = names[: names.index(ankle)]
        out.append({"chain": chain, "foot": ankle, "toe": ball})
    return out


def rigid_body_override(body, sk, keep, band=0.06):
    """Weight override for a rigid shell (a porcelain vessel): vertices above the legs' join take
    only the torso bones' weights (keep: bone names), blending into the heat weights over a band
    just above the join, so the shell moves as a whole and only the legs bend."""
    names = sk.names()
    cols = [names.index(n) for n in keep]
    y = body.verts[:, 1]
    lo = sk.quad["joinY"]
    a = np.clip((y - lo) / (band * body.height), 0, 1)
    a = a * a * (3 - 2 * a)

    def override(W):
        W = W.copy()
        torso = np.zeros_like(W)
        torso[:, cols] = W[:, cols]
        empty = torso.sum(1) < 1e-6
        if empty.any():
            heads = np.array([sk[n].head for n in keep])
            near = np.argmin(np.linalg.norm(body.verts[empty][:, None] - heads[None], axis=2), axis=1)
            torso[np.nonzero(empty)[0], np.array(cols)[near]] = 1.0
        torso /= torso.sum(1, keepdims=True)
        W = (1 - a)[:, None] * W + a[:, None] * torso
        return W, a > 0.999

    return override


def feet_override(body, sk, band=0.05):
    """Weight override for spread feet (claws, root toes): vertices below each ankle take only
    that leg's ankle and ball weights, blending into the heat weights over a band above the
    ankle, so a knee bending never drags the toes through the floor."""
    names = sk.names()
    V = body.verts
    legs = []
    for chain in sk.quad["legs"].values():
        ankle = next(n for n in chain if n.endswith("_AnkleSHJnt"))
        ball = next((n for n in chain if n.endswith("_BallSHJnt")), None)
        legs.append(([names.index(n) for n in (ankle, ball) if n], sk[ankle].head))
    heads = np.array([a[[0, 2]] for _, a in legs])
    owner = np.argmin(np.linalg.norm(V[:, None, [0, 2]] - heads[None], axis=2), axis=1)

    def override(W):
        W = W.copy()
        locked = np.zeros(len(W), bool)
        for k, (cols, ankle) in enumerate(legs):
            rows = np.nonzero(owner == k)[0]
            a = np.clip((ankle[1] + band * body.height - V[rows, 1]) / (band * body.height), 0, 1)
            a = a * a * (3 - 2 * a)
            foot = np.zeros((len(rows), W.shape[1]))
            foot[:, cols] = W[np.ix_(rows, cols)]
            empty = foot.sum(1) < 1e-6
            foot[empty, cols[0]] = 1.0
            foot /= foot.sum(1, keepdims=True)
            W[rows] = (1 - a)[:, None] * W[rows] + a[:, None] * foot
            locked[rows[a > 0.999]] = True
        return W, locked

    return override
