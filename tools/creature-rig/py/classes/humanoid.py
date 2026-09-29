"""Humanoid class: two arms, a head and either two legs (knights, brutes, ogres, undead) or a
floating lower body (spirits, wraiths, robed shades).

The skeleton uses the UE mannequin names of the donor (Quaternius Universal Animation Library), so
the runtime hit overlay recognises it and every bone has a donor twin. Joints are placed on the
mesh: limb paths are medial geodesics from the body core to each extremity, joints sit on
cross-section centroids, and positions along a limb come from measured features (the fork where two
limbs part, the heel corner, the neck and wrist narrowings) with the donor's own proportions as the
prior where the mesh has no feature.
"""
import numpy as np

from crlib.body import corner, resample
from crlib.mathx import normalize
from crlib.skeleton import Skeleton

NAME = "humanoid"


def _path_nodes(pred, end):
    out = []
    while end >= 0:
        out.append(int(end))
        end = pred[end]
    return out[::-1]


def _fork(a, b):
    """Index of the last node two root-first node paths share."""
    k = 0
    while k < min(len(a), len(b)) and a[k] == b[k]:
        k += 1
    return k - 1


def _nearest_index(points, p):
    return int(np.argmin(np.linalg.norm(points - p, axis=1)))


def _donor_ratio(donor, a, b, c):
    """Where joint b sits between joints a and c on the donor, as an arc fraction."""
    pa, pb, pc = (donor.rest_head[n] for n in (a, b, c))
    ab = np.linalg.norm(pb - pa)
    return ab / (ab + np.linalg.norm(pc - pb))


def _section(body, p, tangent, reach):
    c, n = body.section_centroid(p, tangent, reach)
    return c if n else np.asarray(p, float)


def _symmetrise(pair, mid_x, tolerance):
    """Average mirrored left/right joints of a near-symmetric bind pose, so one side's mesh noise
    does not give the two limbs different proportions."""
    mirror = lambda p: np.array([2 * mid_x - p[0], p[1], p[2]])
    keys = [k for k in pair["l"] if isinstance(pair["l"][k], np.ndarray)]
    if max(np.linalg.norm(pair["l"][k] - mirror(pair["r"][k])) for k in keys) > 3 * tolerance:
        return False
    for k in keys:
        avg = 0.5 * (pair["l"][k] + mirror(pair["r"][k]))
        pair["l"][k], pair["r"][k] = avg, mirror(avg)
    return True


# Healthy Tripo rigs come in three humanoid namings. A joint found here replaces the fitted one.
SOURCE_NAMES = {
    "pelvis": ["mixamorig:Hips", "mixamorigHips", "Hips", "Pelvis"],
    "spine_01": ["mixamorig:Spine", "mixamorigSpine", "Spine", "Waist"],
    "spine_02": ["mixamorig:Spine1", "mixamorigSpine1", "Chest", "Spine01"],
    "spine_03": ["mixamorig:Spine2", "mixamorigSpine2", "UpperChest", "Spine02"],
    "neck_01": ["mixamorig:Neck", "mixamorigNeck", "Neck", "NeckTwist01"],
    "Head": ["mixamorig:Head", "mixamorigHead", "Head"],
    **{f"{ours}_{s}": [f"mixamorig:{side}{mx}", f"mixamorig{side}{mx}", f"{side}_{tb}", f"{s.upper()}_{old}"]
       for s, side in (("l", "Left"), ("r", "Right"))
       for ours, mx, tb, old in (("clavicle", "Shoulder", "Shoulder", "Clavicle"), ("upperarm", "Arm", "UpperArm", "UpperArm"),
                                 ("lowerarm", "ForeArm", "LowerArm", "Forearm"), ("hand", "Hand", "Hand", "Hand"),
                                 ("thigh", "UpLeg", "UpperLeg", "Thigh"), ("calf", "Leg", "LowerLeg", "Calf"),
                                 ("foot", "Foot", "Foot", "Foot"), ("ball", "ToeBase", "Toes", "Toe0"))},
}


def _source_joints(source):
    """Joint heads from a healthy source rig, by our bone name, if its sides agree with ours."""
    if not source or source.get("kind") != "tripo-rig":
        return {}
    by_name = {j["name"]: np.array(j["position"]) for j in source["joints"]}
    found = {ours: next((by_name[n] for n in names if n in by_name), None) for ours, names in SOURCE_NAMES.items()}
    found = {k: v for k, v in found.items() if v is not None}
    if "upperarm_l" in found and "upperarm_r" in found:
        span = found["upperarm_l"] - found["upperarm_r"]
        # Mirrored, or turned about the vertical relative to the production mesh (a source
        # exported with another forward axis): do not trust it.
        if span[0] <= 0 or abs(span[0]) < 0.9 * np.linalg.norm(span):
            return {}
    return found


def fit(body, donor, profile, source=None):
    H = body.height
    legs = profile.get("legs", True)
    # The torso is the thickest part on the midline (the intake centres the feet on x=0). A big
    # sleeve, a held censer or a shield can be thicker, so the search stays near the midline.
    x = body.origin[0] + (np.arange(body.dt.shape[0]) + 0.5) * body.h
    y = body.origin[1] + (np.arange(body.dt.shape[1]) + 0.5) * body.h - body.min[1]
    torso = (np.abs(x) < 0.1 * H)[:, None, None] & ((y > 0.45 * H) & (y < 0.85 * H))[None, :, None]
    seed = body.to_world(np.unravel_index(np.argmax(np.where(torso, body.dt, -1)), body.dt.shape))
    ext, dist, pred = body.extremities(seed, 0.07 * H, 0.12 * H)
    nodes = {id(e): _path_nodes(pred, e["node"]) for e in ext}
    world = body.to_world(body.nodes)
    pos = lambda e: e["position"]

    # Head top: the highest tip near the body's midline.
    central = [e for e in ext if abs(pos(e)[0] - seed[0]) < 0.15 * H and pos(e)[1] > seed[1]]
    if not central:
        # Antlers, horns or a crest split the crown into side tips: the head top is then the
        # highest core point on the midline above the torso.
        world_nodes = body.to_world(body.nodes)
        mid = np.nonzero(np.abs(world_nodes[:, 0] - seed[0]) < 0.08 * H)[0]
        top = int(mid[np.argmax(world_nodes[mid, 1])])
        central = [{"node": top, "position": world_nodes[top], "distance": 0.0}]
        ext = ext + central
    head_tip = max(central, key=lambda e: pos(e)[1])
    others = [e for e in ext if e is not head_tip]

    feet = {}
    if legs:
        low = [e for e in others if pos(e)[1] < 0.15 * H]
        for side, sign in (("l", 1), ("r", -1)):
            cands = [e for e in low if sign * (pos(e)[0] - seed[0]) > 0.02 * H]
            if not cands:
                raise RuntimeError(f"no {side} foot tip found; set legs:false for a floating body")
            feet[side] = max(cands, key=lambda e: pos(e)[2] - pos(e)[1])
    # Hand tips (sides measured from the midline x=0, where the intake centres the feet; the
    # thickest point can sit off-centre beside a held censer): the lateral tips farthest from the head along the body (a knuckle or a thumb is
    # a tip too, but nearer).
    head_dist, head_pred = body.geodesic(pos(head_tip))
    hands = {}
    for side, sign in (("l", 1), ("r", -1)):
        cands = [e for e in others if e not in feet.values() and pos(e)[1] > 0.2 * H and sign * pos(e)[0] > 0.1 * H]
        if not cands:
            raise RuntimeError(f"no {side} hand tip found")
        reach = max(sign * pos(e)[0] for e in cands)
        cands = [e for e in cands if sign * pos(e)[0] >= 0.6 * reach]
        hands[side] = max(cands, key=lambda e: head_dist[e["node"]])

    sk = Skeleton()
    notes = {"seed": seed.tolist(), "tips": {k: pos(v).tolist() for k, v in {**{"head": head_tip}, **{f"hand_{s}": e for s, e in hands.items()}, **{f"toe_{s}": e for s, e in feet.items()}}.items()}}

    # ---------------------------------------------------------------- arms
    # Walking in along the medial path from the hand tip towards the head, a probe from the arm
    # towards the torso (perpendicular to the arm, in the frontal plane) crosses a gap until it
    # reaches the armpit. The shoulder joint is on the path there.
    arm = {}
    for side, sign in (("l", 1), ("r", -1)):
        pts = body.path(head_pred, hands[side]["node"])[::-1]  # hand tip -> head
        pts, _ = resample(pts, 150)
        radius = np.array([body.radius_at(p) for p in pts])
        arm_r = float(np.median(radius[20:75]))
        reach = max(3.0 * arm_r, 0.06 * H)
        k = 20
        for k in range(20, 150):
            t = normalize(pts[max(k - 4, 0)] - pts[min(k + 4, 150)])  # outward along the arm
            probe = sign * np.array([t[1], -t[0], 0.0])
            if np.linalg.norm(probe) < 0.2:
                continue
            probe = normalize(probe)
            steps = [pts[k] + probe * d for d in np.arange(body.h, reach, body.h / 2)]
            idx = [np.clip(body.to_index(q), 0, np.array(body.core.shape) - 1) for q in steps]
            if all(body.core[tuple(i)] for i in idx):
                break
        tangent = normalize(pts[k] - pts[max(k - 4, 0)])
        shoulder = _section(body, pts[k], tangent, 2.5 * max(radius[k], body.h))
        pts = pts[:k][::-1]  # shoulder -> hand tip
        rest, arm_len = resample(np.vstack([shoulder, pts[1:]]), 100)
        hand_len = np.linalg.norm(donor.rest_tail.get(f"middle_03_{side}", donor.rest_head[f"hand_{side}"]) - donor.rest_head[f"hand_{side}"])
        upper_len, lower_len = (np.linalg.norm(donor.rest_head[b] - donor.rest_head[a]) for a, b in
                                ((f"upperarm_{side}", f"lowerarm_{side}"), (f"lowerarm_{side}", f"hand_{side}")))
        total = upper_len + lower_len + hand_len
        e0, w0 = upper_len / total, (upper_len + lower_len) / total
        tan2 = lambda i: rest[min(i + 3, 100)] - rest[max(i - 3, 0)]
        # Wrist: the smallest arm cross-section near the donor-proportioned wrist (a flat hand is
        # thin but wide, so area, not radius). Elbow: the path's bend if the arm is bent, else the
        # donor proportion of shoulder-to-wrist.
        wi = int(round(w0 * 100))
        window = range(max(wi - 15, 30), min(wi + 6, 95))
        area = {i: body.section_centroid(rest[i], tan2(i), 0.2 * H)[1] for i in window}
        wk = min(window, key=lambda i: area[i])
        elbow_c, ef = corner(rest[:wk + 1], 0.35, 0.65)
        chord = normalize(rest[wk] - rest[0])
        off = elbow_c - rest[0]
        deviation = np.linalg.norm(off - np.dot(off, chord) * chord)
        bend = float(np.degrees(np.arccos(np.clip(np.dot(normalize(elbow_c - rest[0]), normalize(rest[wk] - elbow_c)), -1, 1))))
        ek = int(round(ef * wk)) if bend > 20 and deviation > body.radius_at(elbow_c) else int(round(e0 / w0 * wk))
        r2 = np.array([body.radius_at(p) for p in rest])
        elbow = _section(body, rest[ek], tan2(ek), 2.5 * max(r2[ek], body.h))
        wrist = _section(body, rest[wk], tan2(wk), 2.5 * max(r2[wk], body.h))
        tip = rest[-1]
        arm[side] = {"shoulder": shoulder, "elbow": elbow, "wrist": wrist, "tip": tip, "bend": float(bend)}

    mid_x = 0.5 * (pos(hands["l"])[0] + pos(hands["r"])[0])
    _symmetrise(arm, mid_x, 0.08 * H)

    shoulder_y = np.mean([arm[s]["shoulder"][1] for s in arm])
    hand_tip_y = np.mean([arm[s]["tip"][1] for s in arm])

    # ----------------------------------------------------------------- legs
    leg = {}
    if legs:
        a, b = nodes[id(feet["l"])], nodes[id(feet["r"])]
        fork = world[a[_fork(a, b)]]
        # The crotch: going down from the fork, the first slab where the two leg paths sit in
        # separate pieces.
        lp, _ = resample(world[a[_fork(a, b):]], 200)
        rp, _ = resample(world[b[_fork(a, b):]], 200)
        crotch = fork[1]
        y = fork[1]
        while y > 0.15 * H:
            comps = body.slab(y)
            pl = lp[_nearest_index(lp[:, 1:2], [y])]
            pr = rp[_nearest_index(rp[:, 1:2], [y])]
            owner = lambda p: next((i for i, c in enumerate(comps) if np.min(np.linalg.norm(c["points"] - p[[0, 2]], axis=1)) < 1.5 * body.h), -1)
            if owner(pl) != owner(pr) and owner(pl) >= 0 and owner(pr) >= 0:
                crotch = y
                break
            y -= body.h
        notes["crotch"] = float(crotch)
        for side, path, tip in (("l", lp, feet["l"]), ("r", rp, feet["r"])):
            below = path[_nearest_index(path[:, 1:2], [crotch - 0.04 * H])]
            hip_c = _section(body, below, [0, 1, 0], 0.12 * H)
            hip = np.array([hip_c[0], crotch + 0.04 * H, hip_c[2]])
            k = _nearest_index(path, below)
            lower_path, leg_len = resample(np.vstack([hip, path[k:]]), 200)
            # The ankle is where the foot's fore-aft extent narrows to the shin's; the toe is the
            # foot's most forward point.
            shin = lower_path[_nearest_index(lower_path[:, 1:2], [0.3 * hip[1]])]
            V = body.verts
            near = np.linalg.norm(V[:, [0, 2]] - shin[[0, 2]], axis=1) < 0.18 * H
            region = V[near & (V[:, 1] < 0.35 * hip[1])]
            band = lambda y: region[np.abs(region[:, 1] - y) < body.h]
            shin_depth = np.ptp(band(shin[1])[:, 2]) if len(band(shin[1])) > 2 else 0.05 * H
            ankle_y = 0.03 * H
            for y in np.arange(body.h, 0.3 * hip[1], body.h / 2):
                b = band(y)
                if len(b) > 2 and np.ptp(b[:, 2]) <= 1.35 * shin_depth:
                    ankle_y = y
                    break
            # A boot or a greave keeps the foot's extent wide far up the shin; an ankle above the
            # donor's proportion puts the lower shin on the foot bone, which then digs its toe
            # into the floor on every toe-off.
            # (ankleCap, a multiple of the donor's ankle-to-hip proportion, lowers such an ankle.)
            cap = 0.12 * H
            if profile.get("ankleCap"):
                cap = min(cap, profile["ankleCap"] * donor.rest_head[f"foot_{side}"][1] / donor.rest_head[f"thigh_{side}"][1] * hip[1])
            ankle_y = float(np.clip(ankle_y, 0.02 * H, cap))
            ak = _nearest_index(lower_path[:, 1:2], [ankle_y])
            ankle = _section(body, lower_path[ak], [0, 1, 0], 0.08 * H)
            ankle[1] = ankle_y
            knee_y = 0.5 * (hip[1] + ankle[1])
            kk = _nearest_index(lower_path[:ak + 1, 1:2], [knee_y])
            knee = _section(body, lower_path[kk], [0, 1, 0], 0.1 * H)
            knee[1] = knee_y
            sole = region[region[:, 1] < ankle_y]
            toe = sole[int(np.argmax(sole[:, 2]))].copy() if len(sole) else pos(tip).copy()
            ball = ankle + 0.7 * (toe - ankle)
            ball[1] = 0.35 * ankle[1]
            toe[1] = ball[1]
            leg[side] = {"hip": hip, "knee": knee, "ankle": ankle, "ball": ball, "toe": toe}
        _symmetrise(leg, mid_x, 0.08 * H)
        pelvis = np.mean([leg[s]["hip"] for s in leg], axis=0)
    else:
        # A floating body has no crotch: the waist sits where a biped's would relative to its
        # shoulders and hanging hands.
        waist_y = hand_tip_y + 0.27 * (shoulder_y - hand_tip_y)
        comps = body.slab(waist_y)
        mid = min(comps, key=lambda c: np.linalg.norm(c["centroid"] - seed[[0, 2]]))
        pelvis = np.array([mid["centroid"][0], waist_y, mid["centroid"][1]])

    # ---------------------------------------------------------------- spine
    # Centroids of the torso slabs from the pelvis to the head top; the neck is the narrowest
    # slab above the shoulders.
    spine_pts = []
    prev = pelvis[[0, 2]]
    tip = pos(head_tip)
    crown = body.verts[np.linalg.norm(body.verts[:, [0, 2]] - tip[[0, 2]], axis=1) < 0.12 * H]
    top = float(crown[:, 1].max())
    for y in np.arange(pelvis[1], top, body.h):
        comps = body.slab(y)
        if not comps:
            continue
        c = min(comps, key=lambda c: np.linalg.norm(c["centroid"] - prev))
        # In a T-pose the arms join the shoulder slabs; keep the torso part near the previous centroid.
        near = c["points"][np.abs(c["points"][:, 0] - prev[0]) < 0.12 * H]
        centre = near.mean(0) if len(near) else c["centroid"]
        width = np.ptp(near[:, 0]) if len(near) else 0
        spine_pts.append((y, centre, width))
        prev = centre
    ys = np.array([s[0] for s in spine_pts])
    widths = np.array([s[2] for s in spine_pts])
    at = lambda y: np.array([spine_pts[_nearest_index(ys[:, None], [y])][1][0], y, spine_pts[_nearest_index(ys[:, None], [y])][1][1]])
    band = (ys > shoulder_y) & (ys < top - 0.03 * H)
    neck_y = ys[band][int(np.argmin(widths[band]))] if band.any() else shoulder_y + 0.3 * (top - shoulder_y)
    head_joint = at(neck_y)
    neck_frac = _donor_ratio(donor, "upperarm_l", "neck_01", "Head")
    neck_base = at(shoulder_y + neck_frac * (neck_y - shoulder_y))
    spine_heads = []
    for name in ("spine_01", "spine_02", "spine_03"):
        f = (donor.rest_head[name][1] - donor.rest_head["pelvis"][1]) / (donor.rest_head["neck_01"][1] - donor.rest_head["pelvis"][1])
        spine_heads.append(at(pelvis[1] + f * (neck_base[1] - pelvis[1])))
    notes.update({"shoulder_y": float(shoulder_y), "neck_y": float(neck_y), "hand_tip_y": float(hand_tip_y)})

    # A healthy source skeleton overrides the fitted joints it has; tips stay measured.
    src = _source_joints(source)
    if src:
        notes["sourceJoints"] = sorted(src)
        pelvis = src.get("pelvis", pelvis)
        spine_heads = [src.get(n, p) for n, p in zip(("spine_01", "spine_02", "spine_03"), spine_heads)]
        neck_base = src.get("neck_01", neck_base)
        head_joint = src.get("Head", head_joint)
        for side in ("l", "r"):
            for key, bone in (("shoulder", "upperarm"), ("elbow", "lowerarm"), ("wrist", "hand")):
                arm[side][key] = src.get(f"{bone}_{side}", arm[side][key])
            if legs:
                for key, bone in (("hip", "thigh"), ("knee", "calf"), ("ankle", "foot"), ("ball", "ball")):
                    leg[side][key] = src.get(f"{bone}_{side}", leg[side][key])

    # ---------------------------------------------------------- assemble
    root_head = np.array([pelvis[0], 0.0, pelvis[2]])
    # The root stays on the floor while the hips move: it must not take skin weight (bone heat
    # would hand it the hem or tail tip that hangs near the floor).
    sk.add("root", None, root_head, root_head + [0, 0.1 * H, 0], donor="root", follow=0.0, kind="root", deform=False)
    sk.add("pelvis", "root", pelvis, spine_heads[0], donor="pelvis", follow=0.0)
    chain = ["spine_01", "spine_02", "spine_03"]
    for i, name in enumerate(chain):
        tail = spine_heads[i + 1] if i + 1 < len(chain) else neck_base
        sk.add(name, "pelvis" if i == 0 else chain[i - 1], spine_heads[i], tail, donor=name, follow=0.0)
    sk.add("neck_01", "spine_03", neck_base, head_joint, donor="neck_01", follow=0.0)
    sk.add("Head", "neck_01", head_joint, np.array([head_joint[0], top, head_joint[2]]), donor="Head", follow=0.0)
    for side, sign in (("l", 1), ("r", -1)):
        a_ = arm[side]
        clav = neck_base + np.array([sign * 0.15 * abs(a_["shoulder"][0] - neck_base[0]), 0.5 * (a_["shoulder"][1] - neck_base[1]), 0])
        sk.add(f"clavicle_{side}", "spine_03", clav, a_["shoulder"], donor=f"clavicle_{side}", follow=0.0, kind="arm")
        sk.add(f"upperarm_{side}", f"clavicle_{side}", a_["shoulder"], a_["elbow"], donor=f"upperarm_{side}", follow=1.0, kind="arm")
        sk.add(f"lowerarm_{side}", f"upperarm_{side}", a_["elbow"], a_["wrist"], donor=f"lowerarm_{side}", follow=1.0, kind="arm")
        sk.add(f"hand_{side}", f"lowerarm_{side}", a_["wrist"], a_["wrist"] + 0.6 * (a_["tip"] - a_["wrist"]), donor=f"hand_{side}", follow=1.0, kind="arm")
    if legs:
        for side in ("l", "r"):
            g = leg[side]
            sk.add(f"thigh_{side}", "pelvis", g["hip"], g["knee"], donor=f"thigh_{side}", follow=1.0, kind="leg")
            sk.add(f"calf_{side}", f"thigh_{side}", g["knee"], g["ankle"], donor=f"calf_{side}", follow=1.0, kind="leg")
            # Feet add the donor's motion to their own rest, so a sole that is flat at rest is flat
            # when the donor's is, whatever the foot's shape.
            sk.add(f"foot_{side}", f"calf_{side}", g["ankle"], g["ball"], donor=f"foot_{side}", follow=0.0, kind="leg")
            sk.add(f"ball_{side}", f"foot_{side}", g["ball"], g["toe"], donor=f"ball_{side}", follow=0.0, kind="leg")
    else:
        low_tip = min(others, key=lambda e: pos(e)[1])
        tail_nodes = nodes[id(low_tip)]
        tail_pts = world[tail_nodes]
        k = _nearest_index(tail_pts, pelvis)
        tail, _ = resample(np.vstack([pelvis, tail_pts[k + 1:]]), 3)
        parent = "pelvis"
        for i in range(3):
            name = f"tail_{i + 1:02d}"
            sk.add(name, parent, tail[i], tail[i + 1], kind="tail")
            parent = name
        notes["tail_tip"] = pos(low_tip).tolist()
    return sk, notes


def plan(sk, body, profile):
    """Retarget plan: hips, foot-IK legs, follow-through chains and their colliders."""
    from crlib.retarget import CapsuleCollider

    legs = [(f"thigh_{s}", f"calf_{s}", f"foot_{s}", f"ball_{s}") for s in ("l", "r") if f"thigh_{s}" in sk]
    if not profile.get("toePitch", True):
        legs = [leg[:3] for leg in legs]
    colliders = []
    for bone in [n for leg in legs for n in leg[:2]] + ["pelvis", "spine_01", "spine_02", "spine_03"]:
        b = sk[bone]
        colliders.append(CapsuleCollider(sk, bone, 0.95 * body.radius_at(0.5 * (b.head + b.tail)) + body.h))
    chains = []
    tail = [b.name for b in sk.bones if b.kind == "tail"]
    if tail:
        chains.append({"bones": tail, "stiffness": 40.0, "damping": 7.0, "gravity": 0.0, "hang": 0.3, "clearance": 0.0})
    for group in sorted({b.name.rsplit("_", 1)[0] for b in sk.bones if b.kind == "cloth"}):
        bones = [b.name for b in sk.bones if b.kind == "cloth" and b.name.rsplit("_", 1)[0] == group]
        chains.append({"bones": bones, "group": group.split("_")[0], "stiffness": 40.0, "damping": 7.0, "gravity": 0.0, "hang": 0.6, "clearance": 0.01})
    return {"hips": "pelvis", "legs": legs, "chains": chains, "colliders": colliders,
            "hip_motion": profile.get("hipMotion", 1.0)}


def _floating_skirt(body, sk):
    """A floating body's skirt or tail rides the waist and the tail chain only. Bone heat (or the
    rigid-piece rule) hands a skirt panel that a hand rests on to that hand, which then lifts
    the panel with every arm swing."""
    names = sk.names()
    arm = [i for i, n in enumerate(names) if n.split("_")[0] in ("clavicle", "upperarm", "lowerarm", "hand")]
    keep = [i for i, n in enumerate(names) if n in ("pelvis", "spine_01") or sk[n].kind == "tail"]
    waist = sk["pelvis"].head[1]
    rows = np.nonzero(body.verts[:, 1] < waist - 0.02 * body.height)[0]

    def override(W):
        W = W.copy()
        fixed = np.zeros(len(W), bool)
        R = W[rows]
        armed = R[:, arm].sum(1) > 0.01
        if not armed.any():
            return W, fixed
        sub = rows[armed]
        K = np.zeros_like(W[sub])
        K[:, keep] = W[sub][:, keep]
        empty = K.sum(1) < 1e-6
        if empty.any():
            # No waist or tail weight at all: the nearest tail bone by height.
            tails = [i for i in keep if sk[names[i]].kind == "tail"] or keep
            mid = np.array([0.5 * (sk[names[i]].head[1] + sk[names[i]].tail[1]) for i in tails])
            pick = np.argmin(np.abs(body.verts[sub[empty], 1][:, None] - mid[None, :]), axis=1)
            K[np.nonzero(empty)[0], np.array(tails)[pick]] = 1.0
        W[sub] = K / K.sum(1, keepdims=True)
        return W, fixed

    return override


def _heel_fix(body, sk):
    """Below the ankle the heel belongs to the foot. A big boot or a heel far behind the ankle
    joint is nearer the shin bone than the foot bone, so bone heat hands it to the calf and it
    digs into the floor whenever the shin leans. The calf's share there moves to the foot,
    blended over the band just above the ankle."""
    V = body.verts
    names = sk.names()
    moves = []
    # The heel point (the rearmost low vertex under each ankle), for a retargeter that keeps a
    # heel strike from driving a long heel into the floor.
    sk.heels = {}
    for side in ("l", "r"):
        if f"foot_{side}" not in sk:
            continue
        ankle = sk[f"foot_{side}"].head
        near = np.linalg.norm(V[:, [0, 2]] - ankle[[0, 2]], axis=1) < 0.25 * body.height
        # Only this foot's own sole: on this side of the midline and within a foot's length.
        own = (np.sign(V[:, 0] - sk["pelvis"].head[0]) == np.sign(ankle[0] - sk["pelvis"].head[0]))
        own &= np.linalg.norm(V[:, [0, 2]] - ankle[[0, 2]], axis=1) < 0.15 * body.height
        sole = own & (V[:, 1] < 0.5 * ankle[1])
        if sole.any():
            sk.heels[f"foot_{side}"] = V[sole][int(np.argmin(V[sole][:, 2]))].copy()
        t = np.clip((1.25 * ankle[1] - V[:, 1]) / (0.5 * ankle[1]), 0, 1) * near
        moves.append((names.index(f"calf_{side}"), names.index(f"foot_{side}"), t))

    def override(W):
        W = W.copy()
        for calf, foot, t in moves:
            share = W[:, calf] * t
            W[:, calf] -= share
            W[:, foot] += share
        return W, np.zeros(len(W), bool)

    return override


def cloth(body, sk, profile, heat):
    sheet = _cloth(body, sk, profile, heat)
    if "thigh_l" not in sk or not profile.get("heelFix", True):
        return sheet
    heel = _heel_fix(body, sk)
    if sheet is None:
        return heel

    def both(W):
        W, fixed = sheet(W)
        W, _ = heel(W)
        return W, fixed

    return both


def _cloth(body, sk, profile, heat):
    """Capes, tabards and loincloth flaps: thin sheets hanging below the hips get their own bone
    chains (front and back, one or two columns), so legs swing through their own space instead of
    dragging the sheet, and the sheet follows through. Returns the weight override for skin()."""
    if "thigh_l" not in sk:
        return _floating_skirt(body, sk)
    if not profile.get("cloth", True):
        return None
    H = body.height
    V = body.verts
    # Sheet vertices: thin through the mesh, and not on a hand (fingers are thin too).
    thin = body.thickness() < 0.025 * H
    # Fingers and toes are thin too; bone heat already knows they belong to a hand or a foot.
    names0 = sk.names()
    extremity = [i for i, n in enumerate(names0) if n.split("_")[0] in ("hand", "lowerarm", "upperarm", "foot", "ball")]
    thin &= ~np.isin(np.argmax(heat, axis=1), extremity) | (heat.sum(1) < 1e-6)

    def clear_of(head, tail, radius):
        ab = tail - head
        t = np.clip((V - head) @ ab / max(ab @ ab, 1e-12), 0, 1)
        return np.linalg.norm(V - (head + t[:, None] * ab), axis=1) > radius

    for side in ("l", "r"):
        hand = sk[f"hand_{side}"]
        thin &= clear_of(hand.head, hand.head + (hand.tail - hand.head) / 0.6, 0.07 * H)
    # ... hanging below the hips and clear of the legs (a thigh plate is thin too, but it is on
    # the thigh and follows it).
    hips_y = sk["pelvis"].head[1]
    # Above the hips a sheet (the top of a cape, a tabard's bib) rides the spine only: bone heat
    # would otherwise hand it to a clavicle or an arm and swing it through the body.
    shoulder_x = max(abs(sk["upperarm_l"].head[0] - sk["pelvis"].head[0]), abs(sk["upperarm_r"].head[0] - sk["pelvis"].head[0]))
    shoulder_y = min(sk["upperarm_l"].head[1], sk["upperarm_r"].head[1])
    torso_sheet = thin & (V[:, 1] >= hips_y + 0.03 * H) & (V[:, 1] <= shoulder_y) & (np.abs(V[:, 0] - sk["pelvis"].head[0]) < shoulder_x)
    thin &= V[:, 1] < hips_y + 0.03 * H
    guard = profile.get("shinGuard", False)
    for side in ("l", "r"):
        for bone in (f"thigh_{side}", f"calf_{side}", f"foot_{side}", f"ball_{side}"):
            b = sk[bone]
            # shinGuard: below the knee a strip wrapped round the shin is on the leg, not a
            # hanging panel (tattered wraps); a knight's long cape keeps the default reach.
            reach = 2.0 if guard and bone.startswith("calf") else 1.5
            thin &= clear_of(b.head, b.tail, reach * body.radius_at(0.5 * (b.head + b.tail)) + 0.02 * H)
    if guard:
        # A boot sole or heel rim is thin too; nothing at ankle height is a hanging panel.
        thin &= V[:, 1] > max(sk["foot_l"].head[1], sk["foot_r"].head[1])
    spine = [sk[n] for n in ("pelvis", "spine_01", "spine_02", "spine_03", "neck_01")]
    spine_z = np.interp(V[:, 1], [b.head[1] for b in spine], [b.head[2] for b in spine])
    # A sheet that hangs below the hips carries its part above the hips with it (a cape from the
    # shoulders); one that stops above the hips rides the spine.
    # In front only a flap between the legs is its own panel (a tabard, a loincloth); a sheet at
    # the sides is the cape wrapping round and belongs to the back panel.
    between = np.abs(V[:, 0] - sk["pelvis"].head[0]) < 0.5 * abs(sk["thigh_l"].head[0] - sk["thigh_r"].head[0])
    front = thin & (V[:, 2] >= spine_z) & between
    below = {"back": thin & ~front, "front": front}
    # Above the hips only the part that stands off the back is cape; a thin plate lying on the
    # back is armour and rides the spine.
    off_body, _ = body.thin_vertices()
    above = {"back": torso_sheet & off_body & (V[:, 2] < spine_z), "front": np.zeros(len(V), bool)}
    groups = {k: [np.nonzero(below[k] | (above[k] if below[k].sum() >= 0.01 * len(V) else False))[0]] for k in below}
    torso_sheet = torso_sheet & ~np.isin(np.arange(len(V)), np.concatenate([g[0] for g in groups.values()]))
    groups = {k: [i for i in v if len(i) >= 0.01 * len(V) and np.ptp(V[i, 1]) > 0.1 * H] for k, v in groups.items()}
    panels = []
    for side, parts in groups.items():
        if not parts:
            continue
        idx = np.concatenate(parts)
        P = V[idx]
        top, bottom = P[:, 1].max(), P[:, 1].min()
        parent = next((b.name for b in reversed(spine[:-1]) if b.head[1] <= top), "pelvis")
        mid_x = float(np.median(P[:, 0]))
        columns = [("l", P[:, 0] >= mid_x), ("r", P[:, 0] < mid_x)] if np.ptp(P[:, 0]) > 0.22 * H else [("", np.ones(len(P), bool))]
        name = "cape" if side == "back" else "tabard"
        chains = []
        for col, mask in columns:
            Q = P[mask]
            bands = np.linspace(Q[:, 1].max(), Q[:, 1].min(), 9)
            line = []
            for a, b in zip(bands[:-1], bands[1:]):
                sel = Q[(Q[:, 1] <= a) & (Q[:, 1] >= b)]
                if len(sel):
                    line.append(sel.mean(0))
            line = np.array(line)
            line[0][1] = Q[:, 1].max()
            line[-1][1] = Q[:, 1].min()
            links = 4 if np.ptp(Q[:, 1]) > 0.35 * H else 3
            pts, _ = resample(line, links)
            bones = []
            prev = parent
            for i in range(links):
                bname = f"{name}_{col}_{i + 1:02d}" if col else f"{name}_{i + 1:02d}"
                sk.add(bname, prev, pts[i], pts[i + 1], kind="cloth", heat=False)
                bones.append(bname)
                prev = bname
            chains.append({"bones": bones, "x": float(np.mean(Q[:, 0]))})
        panels.append({"side": side, "idx": idx, "top": top, "bottom": bottom, "chains": chains})

    names = sk.names()
    spine_cols = [names.index(n) for n in ("pelvis", "spine_01", "spine_02", "spine_03", "neck_01")]

    def override(W):
        W = W.copy()
        fixed = np.zeros(len(V), bool)
        if W.shape[1] < len(names):
            W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
        rows = np.nonzero(torso_sheet)[0]
        if len(rows):
            keep = np.zeros_like(W[rows])
            keep[:, spine_cols] = W[rows][:, spine_cols]
            empty = keep.sum(1) < 1e-6
            if empty.any():
                heights = np.array([sk[names[c]].head[1] for c in spine_cols])
                nearest = np.argmin(np.abs(V[rows[empty], 1][:, None] - heights[None, :]), axis=1)
                keep[np.nonzero(empty)[0], np.array(spine_cols)[nearest]] = 1.0
            W[rows] = keep / keep.sum(1, keepdims=True)
        if not panels:
            return W, fixed
        idx = np.unique(np.concatenate([p["idx"] for p in panels]))
        P = V[idx]
        blended = []
        for panel in panels:
            span = max(panel["top"] - panel["bottom"], 1e-6)
            t = np.clip((panel["top"] - P[:, 1]) / span, 0, 1)
            chain_w = np.zeros((len(idx), len(names)))
            xs = [c["x"] for c in panel["chains"]]
            for chain in panel["chains"]:
                # Blend across columns by x, and along the chain by height (hat functions on bone
                # midpoints), so the sheet bends smoothly.
                if len(xs) == 2:
                    lo, hi = min(xs), max(xs)
                    u = np.clip((P[:, 0] - lo) / max(hi - lo, 1e-6), 0, 1)
                    col_w = u if chain["x"] == hi else 1 - u
                else:
                    col_w = np.ones(len(idx))
                links = len(chain["bones"])
                centres = (np.arange(links) + 0.5) / links
                for bi, bname in enumerate(chain["bones"]):
                    hat = np.clip(1 - np.abs(t - centres[bi]) * links, 0, 1)
                    if bi == 0:
                        hat[t < centres[0]] = 1.0
                    if bi == links - 1:
                        hat[t > centres[-1]] = 1.0
                    chain_w[:, names.index(bname)] += col_w * hat
            chain_w /= np.maximum(chain_w.sum(1, keepdims=True), 1e-9)
            a = np.clip(t / 0.12, 0, 1)
            blended.append((panel["side"], chain_w, a * a * (3 - 2 * a)))
        if len(blended) == 2:
            # Where a cape wraps round to meet a tabard the sheet is continuous: blend the two
            # sides over a band around the spine's plane instead of cutting it.
            band = 0.06 * H
            back = np.clip((spine_z[idx] + band - P[:, 2]) / (2 * band), 0, 1)
            back = back * back * (3 - 2 * back)
            (sa, wa, aa), (sb, wb, ab) = blended
            fa = back if sa == "back" else 1 - back
            chain_w = fa[:, None] * wa + (1 - fa)[:, None] * wb
            a = fa * aa + (1 - fa) * ab
        else:
            _, chain_w, a = blended[0]
        # Where a hem is welded to a boot or a greave (one surface), the rings of the panel next to
        # the leg ride the leg; otherwise the weld tears into a spike on every step.
        a = a * _weld_release(idx, W)
        heat = W[idx] / np.maximum(W[idx].sum(1, keepdims=True), 1e-9)
        W[idx] = (1 - a)[:, None] * heat + a[:, None] * chain_w
        fixed[idx] = a > 0.5
        return W, fixed

    leg_cols = [i for i, n in enumerate(names0) if n.split("_")[0] in ("thigh", "calf", "foot", "ball")]
    knee_y = max(sk["calf_l"].head[1], sk["calf_r"].head[1])
    adj = None

    def _weld_release(idx, W):
        nonlocal adj
        if adj is None:
            from crlib.skin import adjacency
            adj = adjacency(len(V), body.faces)
        panel = np.zeros(len(V), bool)
        panel[idx] = True
        dominant = np.argmax(W[:, :len(names0)], axis=1)
        frontier = ~panel & np.isin(dominant, leg_cols)
        ring = np.full(len(V), np.inf)
        ring[frontier] = 0
        low = panel & (V[:, 1] < knee_y)
        for r in range(1, 4):
            nxt = low & np.isinf(ring) & (np.asarray(adj @ frontier.astype(float)).ravel() > 0)
            ring[nxt] = r
            frontier = nxt
        return np.clip((ring[idx] - 2.0) / 2.0, 0.0, 1.0)

    return override


def bind_turns(sk, profile):
    """A T-posed body is re-bound with its arms lowered to bindArmAngle below horizontal (default
    50 degrees, the middle of the donors' working range), so the shoulders bend half as far."""
    from crlib.mathx import min_arc

    target = np.radians(profile.get("bindArmAngle", 50.0))
    turns = {}
    for side in ("l", "r"):
        b = sk[f"upperarm_{side}"]
        d = normalize(b.tail - b.head)
        if np.degrees(np.arcsin(np.clip(-d[1], -1, 1))) >= 35.0:
            continue
        flat = normalize(np.array([d[0], 0.0, d[2]]))
        turns[b.name] = min_arc(d, flat * np.cos(target) + np.array([0.0, -np.sin(target), 0.0]))
    return turns
