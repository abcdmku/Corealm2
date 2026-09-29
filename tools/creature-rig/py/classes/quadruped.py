"""Quadruped class: four legs under or beside a horizontal torso, a neck and head in front and a
tail behind (canids, felids, cervids, caprids, bovids, suids, mustelids, lizards, tortoises).

Every donor is an Animal pack deluxe rig (janpec, `<Name>_<Role>SHJnt`). They share the roles
ROOT, Spine_01..04, Spine_Top, Clavicle, Neck_01/02/Top, Head_Jaw, Tail_01_NN and a leg chain
Hip, Knee (or Knee1, Knee2), Ankle, Ball, Toe, so the skeleton is built from the primary donor's
roles and a secondary donor maps by role.

Joints are placed on the mesh:
  - the four feet are the lowest tip families, paired by side and ordered front to back;
  - the spine is the medial path from the rearmost tip (tail) to the frontmost tip (snout);
  - each leg is the medial path from its foot tip to the body core; the leg joins the torso where
    that path enters the torso's own radius, and the hip or shoulder joint sits part of the way in;
  - joints along a leg sit at the donor's arc-length proportions, snapped to the path's own bends
    (the mesh's hock or elbow) when there is one nearby; the paw's ball and toe come from the sole;
  - pelvis and chest are the spine points nearest the hind and front hips; the tail base and the
    skull joint are the narrowings of the spine path nearest the donor's proportions.
"""
import re

import numpy as np

from crlib.body import resample
from crlib.mathx import normalize
from crlib.skeleton import Skeleton

NAME = "quadruped"
ROLE = re.compile(r"^(?P<prefix>.+?)_(?P<role>MAIN|ROOT|Spine_\d+|Spine_Top|[lr]_Clavicle_01_01|[lr]_(?:Front|Hind)Leg_[A-Za-z0-9]+|Neck_\d+|Neck_Top|Head_Jaw|Head_JawEnd|Head_Top|Tail_01_\d+)SHJnt$")
LEG_ORDER = ("Hip", "Knee", "Knee1", "Knee2", "Ankle", "Ball", "Toe")


# ------------------------------------------------------------------ donor roles
def roles(donor, profile=None):
    """{role: donor bone} for an Animal pack deluxe rig, or the profile's "roles" map for this donor
    key (another studio's quadruped, e.g. a Dungeon Mason dragon; null means no such bone)."""
    mapped = ((profile or {}).get("roles") or {}).get(getattr(donor, "key", None))
    if mapped is not None:
        return dict(mapped)
    out = {}
    for b in donor.bones:
        m = ROLE.match(b)
        if m:
            out.setdefault(m.group("role"), b)
    return out


def leg_roles(r, side, kind):
    """Donor leg joints of one leg, hip first: e.g. [l_HindLeg_Hip, l_HindLeg_Knee1, ..., Toe]."""
    pre = f"{side}_{kind}Leg_"
    have = [k[len(pre):] for k in r if k.startswith(pre)]
    return [pre + j for j in LEG_ORDER if j in have]


def tail_roles(r):
    return sorted((k for k in r if k.startswith("Tail_01_")), key=lambda k: int(k.rsplit("_", 1)[1]))


def neck_roles(r):
    return sorted((k for k in r if re.fullmatch(r"Neck_\d+", k)), key=lambda k: int(k.split("_")[1])) + ["Neck_Top"]


def spine_roles(r):
    return sorted((k for k in r if re.fullmatch(r"Spine_\d+", k)), key=lambda k: int(k.split("_")[1])) + ["Spine_Top"]


# ------------------------------------------------------------------ geometry helpers
def _path_nodes(pred, end):
    out = []
    while end >= 0:
        out.append(int(end))
        end = pred[end]
    return out[::-1]


def _arc(points):
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(seg)])


def _at(points, s, arc=None):
    arc = _arc(points) if arc is None else arc
    return np.array([np.interp(s, arc, points[:, a]) for a in range(3)])


def _bends(points, window):
    """Turning angle (degrees) at each point of a polyline over +-window points."""
    n = len(points)
    out = np.zeros(n)
    for i in range(window, n - window):
        a = normalize(points[i] - points[i - window])
        b = normalize(points[i + window] - points[i])
        out[i] = np.degrees(np.arccos(np.clip(np.dot(a, b), -1, 1)))
    return out


def _donor_leg(donor, names):
    pts = np.array([donor.rest_head[n] for n in names])
    return pts, _arc(pts)


def _section(body, p, tangent, reach):
    c, n = body.section_centroid(p, tangent, reach)
    return c if n else np.asarray(p, float)


def _ground_feet(body, profile):
    """Four floor-contact patches (lateral, two per side, front and hind) as foot tips."""
    from scipy import ndimage

    V = body.verts
    H = body.height
    low = V[V[:, 1] < V[:, 1].min() + profile.get("contactHeight", 0.05) * H]
    h = body.h
    ij = np.floor((low[:, [0, 2]] - low[:, [0, 2]].min(0)) / h).astype(int)
    grid = np.zeros(ij.max(0) + 1, bool)
    grid[ij[:, 0], ij[:, 1]] = True
    grid = ndimage.binary_closing(grid, iterations=2)
    lab, n = ndimage.label(grid)
    comp = lab[ij[:, 0], ij[:, 1]]
    patches = [low[comp == k] for k in range(1, n + 1) if (comp == k).sum() >= 3]
    patches.sort(key=len, reverse=True)
    xs = [p[:, 0].mean() for p in patches[:4]]
    mid_x = 0.5 * (min(xs) + max(xs))
    feet = {}
    for side, sign in (("l", 1), ("r", -1)):
        mine = [p for p in patches[:6] if sign * (p[:, 0].mean() - mid_x) > 0.1 * np.ptp(xs)]
        if len(mine) < 2:
            raise RuntimeError(f"found {len(mine)} {side} floor-contact patches; need 2")
        mine.sort(key=lambda p: p[:, 2].mean())
        for kind, p in (("Front", mine[-1]), ("Hind", mine[0])):
            c = p.mean(0)
            tip = p[int(np.argmax(p[:, 2]))].copy()
            tip[0] = c[0]
            feet[(side, kind)] = {"node": None, "position": tip, "distance": 0.0}
    return feet, mid_x


# ------------------------------------------------------------------ fit
def fit(body, donor, profile, source=None):
    V = body.verts
    H = body.height
    S = float(np.ptp(V, axis=0).max())
    r = roles(donor, profile)
    seed = body.to_world(np.unravel_index(np.argmax(body.dt), body.dt.shape))
    ext, dist, pred = body.extremities(seed, profile.get("tipSeparation", 0.04) * S, 0.08 * S)
    world = body.to_world(body.nodes)
    pos = lambda e: e["position"]
    notes = {"seed": seed.tolist(), "size": S}

    # ---------------------------------------------------------------- feet
    # Low tips, grouped into foot families (a paw's toes are separate tips on a sprawled lizard);
    # the tail or chin lying on the ground is on the midline and is not a foot.
    low_y = profile.get("footHeight", 0.12) * H
    low = [e for e in ext if pos(e)[1] < low_y + V[:, 1].min()]
    # The midline runs through the torso core (the thickest point): a turned head or a tail tip
    # lying on the floor to one side skews the vertex median and the spread of low tips.
    mid_x = float(seed[0])
    lateral = max((abs(pos(e)[0] - mid_x) for e in low), default=0.0)
    low = [e for e in low if abs(pos(e)[0] - mid_x) > profile.get("footLateral", 0.3) * lateral]
    # Single-linkage families: toes of one splayed paw chain together.
    spread = min(profile.get("pawSpread", 0.12) * S, 0.5 * lateral)
    groups = []
    for e in low:
        joined = [g for g in groups if any(np.linalg.norm(pos(o)[[0, 2]] - pos(e)[[0, 2]]) < spread for o in g)]
        merged = [e] + [o for g in joined for o in g]
        groups = [g for g in groups if all(g is not j for j in joined)] + [merged]
    feet = {}
    if profile.get("groundFeet") or any(sum(sign * (pos(g[0])[0] - mid_x) > 0 for g in groups) < 2 for sign in (1, -1)):
        # Feet the voxel core does not reach (open-ended leg tubes on a multi-part model): the
        # floor-contact patches of the mesh itself, with straight leg paths from the core.
        feet, mid_x = _ground_feet(body, profile)
        notes["groundFeet"] = True
    for side, sign in (("l", 1), ("r", -1)) if not feet else ():
        mine = [g for g in groups if sign * (pos(g[0])[0] - mid_x) > 0]
        if len(mine) < 2:
            raise RuntimeError(f"found {len(mine)} {side} foot families; need 2 (tips {[np.round(pos(e), 3).tolist() for e in low]})")
        z = lambda g: np.mean([pos(e)[2] for e in g])
        front, hind = max(mine, key=z), min(mine, key=z)
        for kind, g in (("Front", front), ("Hind", hind)):
            # The family's tip whose medial path is longest is the middle toe.
            feet[(side, kind)] = max(g, key=lambda e: e["distance"])
    notes["feet"] = {f"{k[1]}_{k[0]}": pos(e).tolist() for k, e in feet.items()}

    # ---------------------------------------------------------------- spine path
    others = [e for e in ext if all(e is not f for f in feet.values())]
    head_tip = max(others, key=lambda e: pos(e)[2])
    tail_tip = min(others, key=lambda e: pos(e)[2])
    if profile.get("tailTip") == "lowest":
        rear = [e for e in others if pos(e)[2] < seed[2]]
        tail_tip = min(rear, key=lambda e: pos(e)[1]) if rear else tail_tip
    hd, hpred = body.geodesic(pos(head_tip))
    spine_path, _ = resample(body.path(hpred, tail_tip["node"])[::-1], 400)  # tail tip -> head tip
    spine_arc = _arc(spine_path)
    spine_r = np.array([body.radius_at(p) for p in spine_path])
    notes["tips"] = {"head": pos(head_tip).tolist(), "tail": pos(tail_tip).tolist()}

    # ---------------------------------------------------------------- legs
    hip_depth = profile.get("hipDepth", 0.45)
    legs = {}
    for (side, kind), tip in feet.items():
        names = leg_roles(r, side, kind)
        if tip.get("node") is None:
            path = np.linspace(seed, pos(tip), 300)
        else:
            path = world[_path_nodes(pred, tip["node"])]  # seed -> foot tip
        path, _ = resample(path, 300)
        d = np.linalg.norm(path[:, None, :] - spine_path[None, :, :], axis=2)
        k_sp = np.argmin(d, axis=1)
        inside = d[np.arange(len(path)), k_sp] <= profile.get("attach", 1.0) * spine_r[k_sp]
        # Walking up from the foot, the first point inside the torso's own radius is the attachment.
        k = len(path) - 1
        while k > 0 and not inside[k]:
            k -= 1
        entry = path[k]
        near = spine_path[k_sp[k]]
        hip = entry + hip_depth * (near - entry)
        # Sideways the joint stays over the leg: the leg path's x just below the torso (a narrow
        # chest enters the torso's radius only near the midline).
        out = next((i for i in range(k, len(path)) if d[i, k_sp[i]] > profile.get("attachOut", 1.3) * spine_r[k_sp[i]]), len(path) - 1)
        hip[0] = mid_x + profile.get("hipSpread", 0.85) * (path[out][0] - mid_x)
        lower, leg_len = resample(np.vstack([hip, path[k + 1:]]), 200)
        dpts, darc = _donor_leg(donor, [r[n] for n in names])
        frac = darc / darc[-1]
        bend = _bends(lower, 8)
        joints, joints_i = [hip], []
        # An upright donor leg (every joint below the one above it) places joints by height: the
        # donor's joint height over its hip height, on the mesh leg. A sprawled leg (a lizard's
        # knee rises above its hip) places them by arc length.
        upright = all(dpts[i + 1][1] <= dpts[i][1] + 1e-6 for i in range(len(dpts) - 2)) and not profile.get("arcJoints")
        ground = float(dpts[:, 1].min())
        for j in range(1, len(names) - 2):  # knees and ankle; ball and toe come from the sole
            i0 = int(round(frac[j] * 200))
            if upright:
                want = hip[1] * (dpts[j][1] - ground) / max(dpts[0][1] - ground, 1e-6)
                below = np.nonzero(lower[:, 1] <= want)[0]
                i0 = int(below[0]) if len(below) else i0
                i0 = int(np.clip(i0, joints_i[-1] + 3 if joints_i else 3, 197))
            joints_i.append(i0)
            w = 8 if upright else 16
            window = range(max(i0 - w, 10, joints_i[-2] + 3 if len(joints_i) > 1 else 0), min(i0 + w + 1, 190))
            best = max(window, key=lambda i: bend[i]) if len(window) else i0
            i = best if bend[best] > profile.get("snapBend", 18.0) else i0
            joints_i[-1] = i
            t = normalize(lower[min(i + 3, 200)] - lower[max(i - 3, 0)])
            joints.append(lower[i].copy() if notes.get("groundFeet") else _section(body, lower[i], t, 0.1 * S))
        if profile.get("hoofAnkle") and len(joints) >= 3:
            # A big hoof or paw belongs to the foot bone whole: the ankle goes up to the pastern,
            # the narrowest leg section above the hoof, and the knee above keeps clear of it.
            lo, hi = lower[-1][1] + 0.03 * H, profile.get("hoofTop", 0.3) * hip[1]
            cand = [i for i in range(joints_i[-2] + 3, 198) if lo <= lower[i][1] <= hi]
            if cand:
                area = {i: body.section_centroid(lower[i], normalize(lower[min(i + 3, 200)] - lower[max(i - 3, 0)]), 0.1 * S)[1] for i in cand}
                i = min(cand, key=lambda i: (area[i], -lower[i][1]))
                joints[-1] = _section(body, lower[i], normalize(lower[min(i + 3, 200)] - lower[max(i - 3, 0)]), 0.1 * S)
                if joints[-2][1] < joints[-1][1] + 0.04 * H:
                    joints[-2] = 0.5 * (joints[-3] + joints[-1])
        ankle = joints[-1]
        # Sole: mesh vertices under the ankle near the foot tip. The toe tip is the sole's most
        # forward point (a reptile's toes splay outward, so "forward" is along the path's end).
        tip_p = lower[-1]
        reach = max(np.linalg.norm(tip_p - ankle) * 1.3, 0.03 * S)
        # Only this paw's own vertices: nearer its foot tip than any other foot's.
        others_tips = np.array([pos(t) for k, t in feet.items() if k != (side, kind)])
        own = np.linalg.norm(V - pos(tip), axis=1) < np.min(np.linalg.norm(V[:, None, :] - others_tips[None], axis=2), axis=1)
        paw = V[own & (np.linalg.norm(V - tip_p, axis=1) < reach) & (V[:, 1] <= max(ankle[1], tip_p[1] + 0.02 * H))]
        fwd = np.array([0.0, 0.0, 1.0])
        if profile.get("toeAlongPath"):
            along = normalize(np.array([tip_p[0] - ankle[0], 0.0, tip_p[2] - ankle[2]]))
            fwd = along if np.linalg.norm(along) > 0.5 else fwd
        toe = paw[int(np.argmax(paw @ fwd))].copy() if len(paw) else tip_p.copy()
        sole_y = float(paw[:, 1].min()) if len(paw) else tip_p[1]
        # Ball: the donor's share of ankle-to-toe, on the sole.
        a_d, b_d, t_d = dpts[-3], dpts[-2], dpts[-1]
        share = np.linalg.norm(b_d - a_d) / (np.linalg.norm(b_d - a_d) + np.linalg.norm(t_d - b_d))
        ball = ankle + share * (toe - ankle)
        lift = (b_d[1] - t_d[1]) / max(a_d[1] - t_d[1], 1e-6)
        ball[1] = sole_y + np.clip(lift, 0.0, 1.0) * (ankle[1] - sole_y)
        toe[1] = sole_y + 0.25 * (ball[1] - sole_y)
        joints += [ball, toe]
        legs[(side, kind)] = {"names": names, "joints": joints, "entry": entry, "tip": pos(tip), "length": leg_len}
    # Mirror-average a near-symmetric pose so both sides get the same proportions.
    for kind in ("Front", "Hind"):
        L, R = legs[("l", kind)], legs[("r", kind)]
        mirror = lambda p: np.array([2 * mid_x - p[0], p[1], p[2]])
        err = max(np.linalg.norm(a - mirror(b)) for a, b in zip(L["joints"], R["joints"]))
        if err < profile.get("symmetry", 0.1) * S:
            for i in range(len(L["joints"])):
                avg = 0.5 * (L["joints"][i] + mirror(R["joints"][i]))
                L["joints"][i], R["joints"][i] = avg, mirror(avg)
        notes[f"asymmetry_{kind}"] = float(err)

    # ---------------------------------------------------------------- spine, neck, head, tail
    def spine_s(p):
        return spine_arc[int(np.argmin(np.linalg.norm(spine_path - p, axis=1)))]

    s_pelvis = np.mean([spine_s(legs[(s, "Hind")]["joints"][0]) for s in "lr"])
    s_chest = np.mean([spine_s(legs[(s, "Front")]["joints"][0]) for s in "lr"])
    s_end = spine_arc[-1]
    at = lambda s: _at(spine_path, s, spine_arc)
    rad = lambda s: float(np.interp(s, spine_arc, spine_r))
    sp_names = spine_roles(r)
    D = lambda n: donor.rest_head[r[n]]
    d_root, d_top = D("ROOT"), D("Spine_Top")
    d_span = np.linalg.norm(d_top - d_root)
    spine_heads = [at(s_pelvis)]
    for n in sp_names:
        f = np.linalg.norm(D(n) - d_root) / d_span
        spine_heads.append(at(s_pelvis + f * (s_chest - s_pelvis)))
    # Neck and skull: the skull joint is the narrowest spine-path point near the donor's share of
    # the chest-to-snout arc; the neck joints divide the way there by the donor's proportions.
    nk_names = neck_roles(r)
    d_neck = [d_top] + [D(n) for n in nk_names]
    d_snout = D("Head_JawEnd") if "Head_JawEnd" in r else donor.rest_tail[r["Neck_Top"]]
    d_neck_arc = _arc(np.array(d_neck + [d_snout]))
    f_skull = d_neck_arc[-2] / d_neck_arc[-1]
    span = s_end - s_chest
    s_skull = s_chest + profile.get("skullShare", f_skull) * span
    if profile.get("skullNarrowing", True):
        cand = np.linspace(s_skull - 0.12 * span, s_skull + 0.08 * span, 41)
        cand = cand[(cand > s_chest + 0.2 * span) & (cand < s_end - 0.15 * span)]
        if len(cand):
            s_skull = cand[int(np.argmin([rad(s) for s in cand]))]
    neck_heads = [at(s_chest + (d_neck_arc[i + 1] / d_neck_arc[-2]) * (s_skull - s_chest)) for i in range(len(nk_names))]
    head_tip = at(s_end)
    # Tail base: the narrowing behind the pelvis where the tail leaves the rump, but no further
    # back than 1.5 times the donor's pelvis-to-tail gap (a lizard's tail tapers from the hips).
    tl_names = tail_roles(r)
    gap = 0.0
    if tl_names:
        gap = 1.5 * np.linalg.norm(D(tl_names[0]) - d_root) / d_span * (s_chest - s_pelvis)
    s_tail0 = max(s_pelvis - gap, 0.0)
    torso_r = rad(s_pelvis)
    for s in np.linspace(s_pelvis, s_tail0, 60):
        if rad(s) < profile.get("tailNarrowing", 0.55) * torso_r:
            s_tail0 = s
            break
    tail = []
    if tl_names and s_tail0 > 0.02 * S and not profile.get("noTail"):
        count = min(len(tl_names), max(2, int(round(s_tail0 / (0.04 * S)))))
        # The last tail bones of a long donor tail drive the tip; spread the donor's bones over the mesh tail.
        pick = np.round(np.linspace(0, len(tl_names) - 1, count)).astype(int)
        ss = np.linspace(s_tail0, 0.0, count + 1)
        tail = [(tl_names[pick[i]], at(ss[i]), at(ss[i + 1])) for i in range(count)]

    # ---------------------------------------------------------------- assemble
    sk = Skeleton()
    pelvis = spine_heads[0]
    root_head = np.array([pelvis[0], 0.0, pelvis[2]])
    sk.add("root", None, root_head, root_head + [0, 0.1 * H, 0], donor=r.get("MAIN"), follow=0.0, kind="root")
    chain = ["pelvis"] + [f"spine_{i + 1:02d}" for i in range(len(sp_names))]
    donors_sp = ["ROOT"] + sp_names
    for i, name in enumerate(chain):
        tail_p = spine_heads[i + 1] if i + 1 < len(chain) else neck_heads[0]
        # A tortoise's torso is one rigid shell: its spine bones follow the pelvis.
        rigid = profile.get("rigidTorso") and i > 0
        sk.add(name, "root" if i == 0 else chain[i - 1], spine_heads[i], tail_p, donor=None if rigid else r[donors_sp[i]], follow=0.0)
    chest = chain[-1]
    nk_bones = [f"neck_{i + 1:02d}" for i in range(len(nk_names) - 1)] + ["head"]
    for i, name in enumerate(nk_bones):
        tail_p = neck_heads[i + 1] if i + 1 < len(nk_bones) else head_tip
        sk.add(name, chest if i == 0 else nk_bones[i - 1], neck_heads[i], tail_p, donor=r[nk_names[i]], follow=0.0)
    # A tail keeps the mesh's own shape: by default it is a spring chain that follows through
    # (a fox's level brush or a curled plume would flip over the back with a wolf's tail swings
    # added). "tailMode": "donor" drives it by the donor's tail, adding the donor's motion
    # (tailFollow 0) or copying its direction (tailFollow 1: a lizard's tail lies down like the
    # donor's).
    tail_donor = profile.get("tailMode", "spring") == "donor"
    tail_follow = profile.get("tailFollow", 0.0)
    parent = "pelvis"
    for i, (role, h, t) in enumerate(tail):
        name = f"tail_{i + 1:02d}"
        sk.add(name, parent, h, t, donor=r[role] if tail_donor else None, follow=tail_follow, kind="tail")
        parent = name
    for side in ("l", "r"):
        for kind in ("Hind", "Front"):
            leg = legs[(side, kind)]
            J, names = leg["joints"], leg["names"]
            parent = "pelvis"
            if kind == "Front":
                hip = J[0]
                clav = spine_heads[-1] + np.array([0.6 * (hip[0] - spine_heads[-1][0]), 0.0, 0.0])
                clav[2] = hip[2] - 0.15 * np.linalg.norm(hip - spine_heads[-1])
                sk.add(f"frontleg_scapula_{side}", chest, clav, hip, donor=r.get(f"{side}_Clavicle_01_01"), follow=0.0, kind="leg")
                parent = f"frontleg_scapula_{side}"
            for j in range(len(names) - 1):
                role = names[j].split("_")[-1].lower()
                name = bone_name(kind, role, side)
                # Limb bones copy the donor's direction (legFollow 1); a sprawled bind (a tortoise's
                # stumpy legs splayed to the shell's corners) adds the donor's motion instead (0).
                follow = profile.get("legFollow", 1.0) if j < len(names) - 3 else profile.get("footFollow", 0.0)
                sk.add(name, parent, J[j], J[j + 1], donor=r[names[j]], follow=follow, kind="leg")
                parent = name
    if profile.get("wings"):
        notes["wings"] = _fit_wings(sk, body, profile, r, chest, mid_x, spine_heads[-1])
    notes.update({"pelvisS": float(s_pelvis), "chestS": float(s_chest), "skullS": float(s_skull), "tailBaseS": float(s_tail0),
                  "spineLength": float(s_end), "tailBones": len(tail)})
    return sk, notes


def _fit_wings(sk, body, profile, r, chest, mid_x, chest_head):
    """Wing arms on a winged quadruped (a Tripo dragon): the wing is the mesh lateral of the body
    above the elbows. Its leading edge is the highest wing point per lateral band; the chain runs
    from the shoulder root on the back to the peak (the wrist of a raised wing) and on to the
    outermost tip, split at the profile's share. Wing bones copy the donor's wing direction
    (follow 1), so a donor that folds its wings on the ground folds these too."""
    V = body.verts
    H = body.height
    out = {}
    names = profile["wings"]  # [donor role of arm 1, 2, 3]
    for side, sign in (("l", 1), ("r", -1)):
        lat = sign * (V[:, 0] - mid_x)
        span = lat.max()
        wing = V[(lat > profile.get("wingInner", 0.3) * span) & (V[:, 1] > profile.get("wingLow", 0.3) * H)]
        tip = wing[int(np.argmax(sign * (wing[:, 0] - mid_x)))]
        peak = wing[int(np.argmax(wing[:, 1]))]
        # Leading edge between peak and tip: the highest point per lateral band.
        bands = np.linspace(sign * (peak[0] - mid_x), sign * (tip[0] - mid_x), 12)
        edge = [peak]
        for a, b in zip(bands[:-1], bands[1:]):
            sel = wing[(sign * (wing[:, 0] - mid_x) >= a) & (sign * (wing[:, 0] - mid_x) < b)]
            if len(sel):
                edge.append(sel[int(np.argmax(sel[:, 1]))])
        edge.append(tip)
        edge, _ = resample(np.array(edge), 40)
        root = chest_head + np.array([sign * profile.get("wingRootOffset", 0.35) * abs(peak[0] - mid_x), 0.0, 0.0])
        root[1] = max(root[1], peak[1] - 0.5 * (peak[1] - chest_head[1]))
        mid = edge[int(round(profile.get("wingSplit", 0.35) * 40))]
        pts = [root, peak, mid, tip]
        parent = chest
        for i in range(3):
            name = f"wing_{i + 1:02d}_{side}"
            donor = None if profile.get("wingSpring") else r.get(names[i].replace("{S}", side))
            sk.add(name, parent, pts[i], pts[i + 1], donor=donor, follow=profile.get("wingFollow", 1.0), kind="wing")
            parent = name
        out[side] = [np.round(p, 3).tolist() for p in pts]
    return out


def bone_name(kind, role, side):
    if kind == "Hind":
        return {"hip": f"thigh_{side}", "knee": f"calf_{side}", "knee1": f"calf_{side}"}.get(role, f"hindleg_{role}_{side}")
    return f"frontleg_{role}_{side}"


def leg_bones(sk, side, kind):
    """Leg bones from the hip or shoulder down (the scapula is not part of the IK chain)."""
    pre = "thigh" if kind == "Hind" else f"frontleg_hip"
    out = [f"{pre}_{side}"]
    while True:
        kids = [b.name for b in sk.bones if b.parent == out[-1] and b.kind == "leg"]
        if not kids:
            return out
        out.append(kids[0])


def plan(sk, body, profile):
    from crlib.retarget import CapsuleCollider

    legs = []
    for side in ("l", "r"):
        for kind in ("Front", "Hind"):
            bones = leg_bones(sk, side, kind)
            # bones: hip, knee(s), ankle, ball. The IK bends hip..last knee; the ankle bone is the
            # foot and the ball bone the toe.
            legs.append({"chain": bones[:-2], "foot": bones[-2], "toe": bones[-1], "pivot": None})
    colliders = []
    for b in sk.bones:
        if b.kind in ("leg", "body") and b.name != "root" and b.parent:
            colliders.append(CapsuleCollider(sk, b.name, 0.9 * body.radius_at(0.5 * (b.head + b.tail)) + body.h))
    chains = []
    tail = [b.name for b in sk.bones if b.kind == "tail" and b.donor is None]
    if tail:
        chains.append({"bones": tail, "stiffness": 40.0, "damping": 7.0, "gravity": 0.0, "hang": 0.2, "clearance": 0.0})
    for side in ("l", "r"):
        # Wings held in their bind shape on the chest, with spring follow-through (a Tripo dragon's
        # raised wing crumples when made to copy a studio dragon's folded wing).
        wing = [b.name for b in sk.bones if b.kind == "wing" and b.donor is None and b.name.endswith(f"_{side}")]
        if wing:
            chains.append({"bones": wing, "stiffness": profile.get("wingStiffness", 90.0), "damping": 9.0, "gravity": 0.0, "hang": 0.0, "clearance": 0.02})
    out = {"hips": "pelvis", "legs": legs, "chains": chains, "colliders": colliders,
           "hip_motion": profile.get("hipMotion", 1.0)}
    if profile.get("hipMode"):
        out["hip_mode"] = profile["hipMode"]
    return out


def cloth(body, sk, profile, heat):
    """No cloth. Binds a tortoise shell to the torso (_shell_override). Repairs the bone heat in place when Blender's solve failed: meshes with
    unmerged duplicate vertices and zero-area faces (procedural and polished Tripo bodies) make
    the heat Laplacian singular and every weight comes back zero. The heat is then solved on a
    copy with the duplicates merged and degenerate faces dissolved, and copied back to every
    original vertex from its nearest merged vertex."""
    shell = _shell_override(body, sk, profile)
    head = _head_override(body, sk, profile)
    plate = _ground_plate_override(body, sk)
    paws = _paw_override(body, sk, profile)
    parts = [o for o in (head, shell, plate, paws) if o]  # later parts win where two claim a vertex
    if not parts:
        return None

    def override(W):
        fixed = np.zeros(len(body.verts), bool)
        for o in parts:
            W, f = o(W)
            fixed |= f
        return W, fixed

    return override


def _paw_override(body, sk, profile):
    """profile "rigidPaw": a big hoof or paw (heel far behind the ankle) goes to its foot bone:
    every vertex of the leg below the ankle joint, nearest this foot, eases onto the foot and toe
    bones over a short band, so the heel cannot hang off the pastern and dip through the floor."""
    if not profile.get("rigidPaw"):
        return None
    V = body.verts
    names = sk.names()
    feet = []
    for side in ("l", "r"):
        for kind in ("Front", "Hind"):
            bones = leg_bones(sk, side, kind)
            feet.append((names.index(bones[-2]), names.index(bones[-1]), sk[bones[-2]].head))
    tips = np.array([f[2] for f in feet])
    own = np.argmin(np.linalg.norm(V[:, None, [0, 2]] - tips[None, :, [0, 2]], axis=2), axis=1)
    band = profile.get("pawBand", 0.04) * body.height

    def override(W):
        W = W.copy()
        fixed = np.zeros(len(V), bool)
        for k, (foot, toe, ankle) in enumerate(feet):
            rows = np.nonzero((own == k) & (V[:, 1] < ankle[1] + band))[0]
            t = np.clip((ankle[1] + band - V[rows, 1]) / (2 * band), 0, 1)
            a = t * t * (3 - 2 * t)
            norm = W[rows] / np.maximum(W[rows].sum(1, keepdims=True), 1e-9)
            keep = norm[:, [foot, toe]].sum(1, keepdims=True)
            target = np.zeros_like(norm)
            target[:, foot] = np.where(keep[:, 0] > 1e-6, norm[:, foot] / np.maximum(keep[:, 0], 1e-9), 1.0)
            target[:, toe] = np.where(keep[:, 0] > 1e-6, norm[:, toe] / np.maximum(keep[:, 0], 1e-9), 0.0)
            W[rows] = (1 - a[:, None]) * norm + a[:, None] * target
            fixed[rows[a > 0.5]] = True
        return W, fixed

    return override


def _ground_plate_override(body, sk):
    """A flat mesh piece lying on the floor under the body (a contact-shadow disc or base plate)
    is not anatomy: it binds to the static root so it stays on the ground."""
    from scipy.sparse.csgraph import connected_components

    from crlib.skin import adjacency

    V = body.verts
    _, label = connected_components(adjacency(len(V), body.faces), directed=False)
    rows = []
    for c in np.unique(label):
        idx = np.nonzero(label == c)[0]
        P = V[idx]
        span = np.ptp(P[:, [0, 2]], axis=0).min()
        if P[:, 1].max() < V[:, 1].min() + 0.08 * body.height and np.ptp(P[:, 1]) < 0.2 * span and span > 0.3 * np.ptp(V[:, 0]):
            rows.append(idx)
    if not rows:
        return None
    rows = np.concatenate(rows)
    root = sk.names().index(sk.bones[0].name)

    def override(W):
        W = W.copy()
        W[rows] = 0.0
        W[rows, root] = 1.0
        fixed = np.zeros(len(V), bool)
        fixed[rows] = True
        return W, fixed

    return override


def _head_override(body, sk, profile):
    """The skull, with its horns, antlers and ears, is one rigid piece: past a plane through the
    skull joint (normal along the neck) the neck and head weights blend into the head alone over
    a short band, so antlers never bend with the neck. There is no jaw bone (Tripo mouths are
    closed), so the whole head follows the skull."""
    band = profile.get("rigidHead", 0.6)
    if not band:
        return None
    V = body.verts
    names = sk.names()
    head = sk["head"]
    neck = [b for b in names if b.startswith("neck_")]
    n = normalize(head.head - sk[neck[-1]].head) if neck else normalize(head.tail - head.head)
    width = band * max(body.radius_at(head.head), body.h)
    t = np.clip(((V - head.head) @ n) / width, 0.0, 1.0)
    a = t * t * (3 - 2 * t)
    # Horns, antlers and ears are loose pieces seated on the crown, often behind the skull joint:
    # a small island whose seat (its vertex nearest the main body) is near the skull plane or
    # past it goes to the head whole.
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import cKDTree

    from crlib.skin import adjacency, segment_distance

    _, label = connected_components(adjacency(len(V), body.faces), directed=False)
    sizes = np.bincount(label)
    main = int(np.argmax(sizes))
    tree = cKDTree(V[label == main])
    reach = profile.get("crownReach", 2.5) * max(body.radius_at(head.head), body.h)
    crown = np.zeros(len(V), bool)
    heads = np.array([b.head for b in sk.bones])
    tails = np.array([b.tail for b in sk.bones])
    for c in np.nonzero(sizes < 0.1 * len(V))[0]:
        idx = np.nonzero(label == c)[0]
        d, _ = tree.query(V[idx])
        seat = V[idx[int(np.argmin(d))]]
        dist = segment_distance(seat[None], heads, tails)[0]
        near = names[int(np.argmin(dist))]
        # Seated on the skull: nearest the head, or nearest the last neck bone but above the skull
        # joint (antlers behind it); a shell plate by the neck opening sits lower.
        if (near == "head" or (near in neck[-1:] and seat[1] > head.head[1])) and (seat - head.head) @ n > -reach:
            a[idx] = 1.0
            crown[idx] = True
    legs = [i for i, b in enumerate(names) if sk[b].kind == "leg"]
    h = names.index("head")

    def override(W):
        W = W.copy()
        if W.shape[1] < len(names):
            W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
        # Everything past the plane but the legs (a raised forepaw can reach past a low head).
        share = W[:, legs].sum(1) / np.maximum(W.sum(1), 1e-9)
        rows = np.nonzero(((a > 0) & (share < 0.5)) | crown)[0]
        one = np.zeros(W.shape[1])
        one[h] = 1.0
        norm = W[rows] / np.maximum(W[rows].sum(1, keepdims=True), 1e-9)
        W[rows] = (1 - a[rows, None]) * norm + a[rows, None] * one
        fixed = np.zeros(len(V), bool)
        fixed[rows[a[rows] > 0.5]] = True
        return W, fixed

    return override


def _shell_override(body, sk, profile):
    """A shell (profile "shellRim": its lower edge as a share of the height) binds rigidly to the
    torso: its vertices keep only their torso-bone weights, so the rim never follows a leg or
    the neck. The neck, head, tail and legs below the rim deform as usual."""
    if profile.get("shellRim") is None:
        return None
    V = body.verts
    names = sk.names()
    torso = [names.index(n) for n in names if n == "pelvis" or n.startswith("spine_")]
    # The dome's fore-aft extent comes from its flanks (the neck, head and tail leave the shell
    # near the midline; the flanks are only shell).
    from crlib.skin import segment_distance

    rim = V[:, 1] >= V[:, 1].min() + profile["shellRim"] * body.height
    mid = sk["pelvis"].head[0]
    lat = np.abs(V[:, 0] - mid)
    flank = rim & (lat > 0.5 * lat[rim].max())
    # Fore-aft extent: the rim-height vertices clear of the neck, head and tail by a limb radius.
    axial = [b for b in sk.bones if b.kind == "tail" or b.name.startswith("neck_") or b.name == "head"]
    dist = segment_distance(V, np.array([b.head for b in axial]), np.array([b.tail for b in axial])).min(1)
    clear = dist > profile.get("shellLimbRadius", 0.1) * body.height
    dome = rim & clear
    margin = profile.get("shellDomeMargin", 0.12) * body.height
    flank_front = V[flank, 2].max()
    back = max(V[dome | flank, 2].min(), V[flank, 2].min() - margin)
    front = min(V[dome | flank, 2].max(), V[flank, 2].max() + margin)
    shell = rim & clear & (V[:, 2] <= front) & (V[:, 2] >= back)
    # Separate plates under the rim (a plastron, a marginal ring) are shell too: any loose piece
    # at least half the dome's width inside its fore-aft extent.
    from scipy.sparse.csgraph import connected_components

    from crlib.skin import adjacency

    _, label = connected_components(adjacency(len(V), body.faces), directed=False)
    main = np.argmax(np.bincount(label))
    width = np.ptp(V[flank, 0])
    for c in np.unique(label):
        if c == main:
            continue
        idx = label == c
        P = V[idx]
        if np.ptp(P[:, 0]) > 0.5 * width and P[:, 2].min() >= back - 0.05 * body.height and P[:, 2].max() <= front + 0.05 * body.height:
            shell |= idx
    # Plates welded to the body below the rim (a plastron): vertices inside the dome's extent
    # that are farther than a limb's radius from every limb bone (Tripo tortoises run the neck,
    # tail and legs deep inside the shell, so the nearest bone is often a limb's).
    # Legs keep their own skin: only vertices whose heat is mostly torso, neck, head or tail
    # qualify, and they must clear the neck, head and tail bones by a limb radius.
    legs = np.array([b.kind == "leg" for b in sk.bones])
    below = clear & (V[:, 2] <= front) & (V[:, 2] >= back) & ~rim

    def not_leg(W):
        share = W[:, :len(legs)][:, legs].sum(1) / np.maximum(W.sum(1), 1e-9)
        return share < 0.3
    heads = np.array([sk[names[c]].head for c in torso])

    def override(W):
        W = W.copy()
        if W.shape[1] < len(names):
            W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
        head_share = W[:, names.index("head")] / np.maximum(W.sum(1), 1e-9)
        ahead = V[:, 2] > flank_front  # only where a head can be
        mask = (shell | (below & not_leg(W))) & ~(ahead & (head_share >= 0.5))
        # A loose piece mostly in the shell (a seam strip or scute at the neck opening) is shell
        # whole, so no part of it follows the neck.
        for c in np.unique(label):
            idx = label == c
            if c != main and mask[idx].mean() > 0.3:
                mask |= idx
        rows = np.nonzero(mask)[0]
        keep = np.zeros((len(rows), W.shape[1]))
        keep[:, torso] = W[rows][:, torso]
        empty = keep.sum(1) < 1e-6
        if empty.any():
            nearest = np.argmin(np.linalg.norm(V[rows[empty]][:, None, :] - heads[None], axis=2), axis=1)
            keep[np.nonzero(empty)[0], np.array(torso)[nearest]] = 1.0
        W[rows] = keep / keep.sum(1, keepdims=True)
        fixed = np.zeros(len(V), bool)
        fixed[rows] = True
        return W, fixed

    return override


def bind_turns(sk, profile):
    """Re-poses a bind that sits far from the donors' working range (Tripo lizards arrive with a
    hind leg lifted or the tail curled over the back): a leg whose toe tip is off the floor turns
    at the hip until it touches down, and with "bindTailStraight" the tail is laid out behind
    along the pelvis's backward direction, bone by bone. The mesh is re-posed once with dual
    quaternions; rest == bind as always."""
    from crlib.mathx import min_arc

    turns = {}
    for side in ("l", "r"):
        for kind in ("Front", "Hind"):
            bones = leg_bones(sk, side, kind)
            hip, tip = sk[bones[0]].head, sk[bones[-1]].tail
            v = tip - hip
            lift = tip[1] - min(sk[b].tail[1] for b in sk.names() if sk[b].kind == "leg")
            if lift <= profile.get("liftedFoot", 0.12) * hip[1]:
                continue
            L = np.linalg.norm(v)
            flat = normalize(np.array([v[0], 0.0, v[2]]))
            down = min(hip[1] - (tip[1] - lift), L)
            want = flat * np.sqrt(max(L * L - down * down, 0.0)) + np.array([0.0, -down, 0.0])
            turns[bones[0]] = min_arc(v, want)
    if profile.get("bindTailStraight"):
        tail = [b.name for b in sk.bones if b.kind == "tail"]
        pelvis = sk["pelvis"]
        back = normalize(np.array([0.0, profile.get("tailDroop", -0.15), -1.0]))
        acc = np.eye(3)
        for name in tail:
            b = sk[name]
            cur = acc @ normalize(b.tail - b.head)
            T = min_arc(cur, back)
            turns[name] = T
            acc = T @ acc
    return turns


def recoil_bones(sk, plan, profile):
    """The runtime hit recoil moves the head, neck, spine and tail, never the legs."""
    return [b.name for b in sk.bones if b.kind in ("body", "tail") and b.name not in ("root", "pelvis")]


def closeup_joints(sk, profile):
    return ["calf_l", "frontleg_knee_l", "frontleg_hip_l", "neck_01", "spine_03"]


def donor_map(sk, donor, profile):
    """A secondary Animal pack donor maps by role: the primary's bone for each target bone is
    replaced by the bone with the same role in this donor (Knee and Knee1 are one role). A donor
    that already has every bone the skeleton names (the primary) needs no map."""
    if all(b.donor is None or b.donor in donor.rest_frame for b in sk.bones):
        return None
    r = roles(donor, profile)
    if not r:
        return None
    # The role of each primary donor bone: from a profile role map when the primary has one.
    inverse = {bone: role for mapped in ((profile or {}).get("roles") or {}).values() for role, bone in mapped.items() if bone}
    out = {}
    for b in sk.bones:
        if not b.donor:
            continue
        m = ROLE.match(b.donor)
        role = m.group("role") if m else inverse.get(b.donor)
        if role in r:
            out[b.name] = r[role]
        elif role and role.endswith("_Knee") and role + "1" in r:
            out[b.name] = r[role + "1"]
        elif role and role.endswith("_Knee1") and role[:-1] in r:
            out[b.name] = r[role[:-1]]
        elif role and role.startswith("Tail_01_"):
            tails = tail_roles(r)
            idx = int(role.rsplit("_", 1)[1]) - 1
            out[b.name] = r[tails[min(idx, len(tails) - 1)]] if tails else None
        else:
            out[b.name] = None
    return out


# ------------------------------------------------------------------ Hit (flinch)
# The Animal pack ships no Hit. A flinch is the donor's own Die up to its first beat (the recoil
# before the collapse), eased back to the Idle's first frame. It is baked as an authored take on a
# copy of the donor's rest skeleton, so it goes through the same retarget as every other clip.
from classes import authored  # noqa: E402  (registers the "authored" donor pack)
from crlib import donor as donors_mod  # noqa: E402
from crlib.mathx import quat_from_matrix, slerp_matrix  # noqa: E402


def _rotvec_deg(R):
    x, y, z, w = quat_from_matrix(R)
    if w < 0:
        x, y, z, w = -x, -y, -z, -w
    s = np.sqrt(max(1.0 - w * w, 0.0))
    angle = 2.0 * np.arctan2(s, w)
    axis = np.array([x, y, z]) / s if s > 1e-9 else np.zeros(3)
    return np.degrees(axis * angle)


def flinch(spec):
    base = dict(spec["base"])
    die, idle = spec.get("die", "Die"), spec.get("idle", "Idle")
    d = donors_mod.load("flinch_base", base, spec["_cache"], [die, idle])
    order = d.bones
    bones = []
    for b in order:
        head, tail = d.rest_head[b], d.rest_tail[b]
        if np.linalg.norm(tail - head) < 1e-5:
            tail = head + d.rest_frame[b][:, 1] * 1e-3
        bones.append((b, d.parent[b], head, tail))
    D = d.rest_frame
    hub = next(b for b in order if b.endswith("_ROOTSHJnt"))
    k_hub = d.index(hub)
    Dc, Ic = d.clips[die], d.clips[idle]
    n = len(Dc["frames"])
    hip_h = d.rest_head[hub][1]
    # The beat: the recoil before the collapse, up to where the hips have dropped 7% of their
    # height or the head has moved 30% of it (at most 10 donor frames). A fast Die (the boar
    # drops in 3 frames) is slowed to at least 5 frames so the flinch still reads.
    head_b = next((b for b in order if b.endswith("_Neck_TopSHJnt")), order[-1])
    k_head = d.index(head_b)
    moved = np.linalg.norm(Dc["heads"][:, k_head] - Dc["heads"][0, k_head], axis=1) / hip_h
    drop = (Dc["heads"][0, k_hub, 1] - Dc["heads"][:, k_hub, 1]) / hip_h
    t_beat = float(min(10, n - 1))
    for f in range(1, min(n, 11)):
        over = max(drop[f] / spec.get("maxDrop", 0.07), moved[f] / spec.get("maxMove", 0.3))
        if over >= 1.0:
            prev = max(drop[f - 1] / spec.get("maxDrop", 0.07), moved[f - 1] / spec.get("maxMove", 0.3))
            t_beat = f - 1 + (1.0 - prev) / max(over - prev, 1e-6)
            break
    beat = max(int(round(t_beat)), spec.get("minBeat", 5))
    back = spec.get("back", max(10, 20 - beat))

    def local(frames, f):
        delta = {b: frames[f][d.index(b)] @ D[b].T for b in order}
        return {b: (delta[d.parent[b]].T @ delta[b] if d.parent[b] else delta[b]) for b in order}

    def at(t):
        """Die pose and hips offset at fractional donor frame t."""
        f0 = int(np.floor(t))
        f1 = min(f0 + 1, n - 1)
        w = t - f0
        A, B = local(Dc["frames"], f0), local(Dc["frames"], f1)
        off = (1 - w) * Dc["heads"][f0, k_hub] + w * Dc["heads"][f1, k_hub] - d.rest_head[hub]
        return {b: slerp_matrix(A[b], B[b], w) for b in order}, off

    start, off_start = at(t_beat)
    end = local(Ic["frames"], 0)
    off_end = Ic["heads"][0, k_hub] - d.rest_head[hub]
    total = beat + back
    take = authored.Take("Hit", total)
    keys = {b: [] for b in order}
    hub_keys = []
    for f in range(total + 1):
        if f <= beat:
            u = f / beat
            L, off = at(t_beat * (1 - (1 - u) ** 2))  # sharp onset, easing into the beat
        else:
            t = (f - beat) / back
            t = t * t * (3 - 2 * t)
            L = {b: slerp_matrix(start[b], end[b], t) for b in order}
            off = (1 - t) * off_start + t * off_end
        for b in order:
            keys[b].append((f, _rotvec_deg(L[b]), "linear"))
        hub_keys.append((f, off, "linear"))
    for b in order:
        take.key(b, keys[b])
    take.move(hub, hub_keys)
    return authored.Rig.bones(bones), [take]


for _name in ("wolf", "deer", "ibex", "boar", "croc", "cattle"):
    authored.MOTIONS[f"flinch_{_name}"] = flinch
