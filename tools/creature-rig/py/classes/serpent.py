"""Serpent class: a long segmented body. Profile "centipede": a spine bone per body segment, one
two-bone leg and a tarsus per segment and side, a head with forcipules, antennae and tail cerci.

No studio donor walks like a centipede, so every clip is authored (motion set "centipede"). The
motion is authored on this class's own fitted skeleton: the motion set fits the production mesh
itself (the same deterministic fit rig.py runs), builds that skeleton as the donor armature and
keys it, so the retarget is bone for bone and foot contact is solved in the creature's own
proportions:

- the body undulates laterally as a travelling wave whose phase runs along the arc length (each
  segment's heading is the slope of the wave at its place on the body, so the body bends as one
  curve and the wave runs from head to tail);
- every leg steps in a metachronal wave phase-locked to it: the stance slides straight back at
  the gait's ground speed, the swing lifts and eases forward, left and right in antiphase; the
  hip and knee are solved per frame so the foot follows that path exactly;
- the head counter-steers, the antennae and cerci are spring chains that follow through.

Joints are measured: the floor contacts give the legs (one per segment and side), each knee is the
leg's outermost high point, the spine joints lie midway between leg pairs on the body's centre
line, and the head, forcipules, antennae and cerci run to their measured tips.
"""
import os

import numpy as np

from classes import authored
from crlib.body import resample
from crlib.skeleton import Skeleton

NAME = "serpent"


def _clusters(values, gap):
    order = np.argsort(values)
    groups, cur = [], [order[0]]
    for a, b in zip(order[:-1], order[1:]):
        if values[b] - values[a] > gap:
            groups.append(cur)
            cur = []
        cur.append(b)
    groups.append(cur)
    return groups


def _line(points, axis, bins):
    """Centroids of points in bins along one axis (a thin curve such as an antenna)."""
    lo, hi = points[:, axis].min(), points[:, axis].max()
    edges = np.linspace(lo, hi, bins + 1)
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        sel = points[(points[:, axis] >= a) & (points[:, axis] <= b)]
        if len(sel):
            out.append(sel.mean(0))
    return np.array(out)


def fit(body, donor=None, profile=None, source=None):
    V, H = body.verts, body.height
    L = float(np.ptp(V[:, 2]))
    x0 = float(np.median(V[:, 0]))
    low = V[V[:, 1] < 0.08 * H]
    legs = {}
    for side, sign in (("l", 1), ("r", -1)):
        pts = low[sign * (low[:, 0] - x0) > 0.1 * H]
        groups = _clusters(pts[:, 2], 0.03 * L)
        feet = sorted((pts[g] for g in groups if len(g) >= 10), key=lambda p: -p[:, 2].mean())
        legs[side] = feet
    n = min(len(legs["l"]), len(legs["r"]))
    if n < 3:
        raise RuntimeError("fewer than three leg pairs on the floor")
    zs = [0.5 * (legs["l"][k][:, 2].mean() + legs["r"][k][:, 2].mean()) for k in range(n)]
    mid = np.abs(V[:, 0] - x0) < 0.25 * np.ptp(V[:, 0])

    def centre_y(z, reach):
        sel = V[mid & (np.abs(V[:, 2] - z) < reach) & (V[:, 1] > 0.3 * H)]
        return float(0.5 * (sel[:, 1].min() + sel[:, 1].max())) if len(sel) else 0.6 * H

    spacing = float(np.median(-np.diff(zs)))
    joints = [zs[0] + 0.5 * spacing] + [0.5 * (a + b) for a, b in zip(zs[:-1], zs[1:])] + [zs[-1] - 0.5 * spacing]
    jy = [centre_y(z, 0.25 * spacing) for z in joints]
    J = [np.array([x0, y, z]) for y, z in zip(jy, joints)]

    sk = Skeleton()
    sk.add("root", None, [x0, 0.0, 0.5 * (joints[0] + joints[-1])], [x0, 0.1 * H, 0.5 * (joints[0] + joints[-1])], donor="root", follow=0.0, kind="root")
    hips = n // 2 - 1
    seg = lambda k: f"seg_{k:02d}"
    # The hips segment points forward; the segments in front chain towards the head, the ones
    # behind towards the tail. Segment k spans the joints on either side of its leg pair.
    sk.add(seg(hips), "root", J[hips + 1], J[hips], donor=seg(hips), follow=0.0)
    for k in range(hips - 1, -1, -1):
        sk.add(seg(k), seg(k + 1), J[k + 1], J[k], donor=seg(k), follow=0.0)
    for k in range(hips + 1, n):
        sk.add(seg(k), seg(k - 1), J[k], J[k + 1], donor=seg(k), follow=0.0)

    # Head: from the first joint to the front of the head plate.
    head_pts = V[mid & (V[:, 2] > joints[0]) & (V[:, 1] > jy[0])]
    head_front = float(np.percentile(head_pts[:, 2], 97)) if len(head_pts) else joints[0] + spacing
    head_tip = np.array([x0, centre_y(head_front - 0.1 * spacing, 0.1 * spacing), head_front])
    sk.add("head", seg(0), J[0], head_tip, donor="head", follow=0.0)
    # Tail: from the last joint to the end of the last plate.
    sk.add("tail", seg(n - 1), J[n], J[n] + (J[n] - J[n - 1]) * 0.8, donor="tail", follow=0.0)

    for side, sign in (("l", 1), ("r", -1)):
        # Forcipules: the lowest-forward tips beside the head; antennae: the highest-forward.
        near = V[(sign * (V[:, 0] - x0) > 0.03 * H) & (V[:, 2] > joints[0] + 0.3 * spacing)]
        low_front = near[near[:, 1] < jy[0]]
        tip = low_front[np.argmax(low_front[:, 2])]
        base = np.array([x0 + sign * 0.35 * abs(tip[0] - x0), tip[1] + 0.3 * (jy[0] - tip[1]), joints[0] + 0.6 * spacing])
        sk.add(f"jaw_{side}", "head", base, tip, donor=f"jaw_{side}", follow=0.0)
        # Antennae: the thin feelers above the forcipules, forward of the head plate.
        feeler = near[(near[:, 2] > head_front) & (near[:, 1] > jy[0])]
        line = _line(feeler, 2, 6)
        start = np.array([x0 + sign * 0.5 * abs(line[0][0] - x0), line[0][1], head_front - 0.15 * spacing])
        pts, _ = resample(np.vstack([start, line]), 3)
        parent = "head"
        for i in range(3):
            name = f"antenna_{side}_{i + 1:02d}"
            sk.add(name, parent, pts[i], pts[i + 1], kind="tail")
            parent = name
        back = V[(sign * (V[:, 0] - x0) > 0.03 * H) & (V[:, 2] < joints[-1] + 0.2 * spacing)]
        line = _line(back, 2, 6)[::-1]
        start = J[n] + np.array([sign * 0.2 * abs(line[-1][0] - x0), 0, 0])
        pts, _ = resample(np.vstack([start, line[1:]]), 2)
        sk.add(f"cercus_{side}_01", "tail", pts[0], pts[1], kind="tail")
        sk.add(f"cercus_{side}_02", f"cercus_{side}_01", pts[1], pts[2], kind="tail")

        for k in range(n):
            foot_pts = legs[side][k]
            z = float(foot_pts[:, 2].mean())
            # The knee: the leg's outermost point at the femur's height (the femur runs out
            # level from the body; the tibia drops from the knee to the floor).
            leg_pts = V[(sign * (V[:, 0] - x0) > 0.1 * H) & (np.abs(V[:, 2] - z) < 0.3 * spacing) & (V[:, 1] > 0.7 * jy[k])]
            knee_v = leg_pts[np.argmax(sign * (leg_pts[:, 0] - x0))] if len(leg_pts) else foot_pts.mean(0) + [0, 0.5 * jy[k], 0]
            knee = np.array([knee_v[0] - sign * 0.02 * H, knee_v[1], z])
            hip = np.array([x0 + sign * 0.45 * abs(knee[0] - x0), knee[1], z])
            foot_c = foot_pts.mean(0)
            ankle = np.array([foot_c[0], 0.08 * H, z])
            claw = foot_pts[np.argmax(sign * (foot_pts[:, 0] - x0))]
            toe = np.array([claw[0], 0.02 * H, z])
            if np.linalg.norm(toe - ankle) < 0.02 * H:
                toe = ankle + [sign * 0.03 * H, -0.04 * H, 0]
            base = f"leg_{side}_{k:02d}"
            sk.add(f"{base}_femur", seg(k), hip, knee, donor=f"{base}_femur", follow=0.0, kind="leg")
            sk.add(f"{base}_tibia", f"{base}_femur", knee, ankle, donor=f"{base}_tibia", follow=0.0, kind="leg")
            sk.add(f"{base}_tarsus", f"{base}_tibia", ankle, toe, donor=f"{base}_tarsus", follow=0.0, kind="leg")
    sk.segments, sk.hips = n, seg(hips)
    notes = {"segments": n, "spacing": spacing, "legZ": [round(z, 4) for z in zs], "hips": seg(hips)}
    return sk, notes


def plan(sk, body, profile):
    legs = [{"chain": [f"leg_{s}_{k:02d}_femur", f"leg_{s}_{k:02d}_tibia"], "foot": f"leg_{s}_{k:02d}_tarsus", "toe": None}
            for s in "lr" for k in range(sk.segments)]
    chains = [{"bones": [f"antenna_{s}_{i:02d}" for i in (1, 2, 3)], "stiffness": 70.0, "damping": 6.0, "gravity": 0.0, "hang": 0.0, "clearance": 0.0} for s in "lr"]
    chains += [{"bones": [f"cercus_{s}_01", f"cercus_{s}_02"], "stiffness": 60.0, "damping": 6.0, "gravity": 0.0, "hang": 0.0, "clearance": 0.01} for s in "lr"]
    return {"hips": sk.hips, "legs": legs, "chains": chains, "colliders": [], "hip_motion": 1.0, "scale": 1.0}


def cloth(body, sk, profile, heat):
    """Blender's bone heat cannot solve this 247-piece mesh as a whole; fill it piece by piece."""
    if (heat.sum(1) < 1e-6).mean() > 0.5:
        from classes.special_treant import heat_by_pieces

        heat_by_pieces(sk, heat)
    return None


# ------------------------------------------------------------------ authored takes
def _fitted(spec):
    """The skeleton rig.py will fit: this class's fit on the asset's bind mesh."""
    from crlib.body import Body, load_blender_mesh
    import bpy

    work = spec["_work"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _, V, F = load_blender_mesh(os.path.join(work, "mesh.glb"))
    sk, _ = fit(Body(V, F))
    return sk


def _gait(take, sk, cycle, duty, speed, lift, wave, amp, stagger, keys=8):
    """A walking cycle: lateral travelling wave along the arc length plus a metachronal step on
    every leg. cycle frames; duty the stance share; speed m/s on the ground; lift the swing
    height (m); wave the wavelength as a share of the body length; amp the lateral amplitude (m);
    stagger the phase lag from one leg pair to the next (share of a cycle)."""
    n = sk.segments
    segs = [f"seg_{k:02d}" for k in range(n)]
    mid = {b: 0.5 * (sk[b].head[2] + sk[b].tail[2]) for b in segs + ["head", "tail"]}
    arc = {b: max(mid.values()) - z for b, z in mid.items()}  # arc length from the head back
    length = max(arc.values())
    lam = wave * length
    # Heading of the body curve x(s, t) = amp sin(2 pi (s / lam - t)) at each bone: the wave runs
    # tailwards. Each bone's yaw is its heading minus its parent's.
    frames = [int(round(i * cycle / keys)) for i in range(keys)]

    def heading(s, u):
        slope = amp * 2 * np.pi / lam * np.cos(2 * np.pi * (s / lam - u))
        return np.degrees(np.arctan(-slope))

    for b in segs + ["head", "tail"]:
        parent = sk[b].parent
        ks = []
        for f in frames:
            u = f / cycle
            own = heading(arc[b], u)
            up = heading(arc[parent], u) if parent in arc else 0.0
            yaw = own - up
            if b == "head":
                yaw *= 0.4  # the head steadies against the wave
            ks.append((f, (0.0, yaw, 0.0)))
        take.key(b, ks)
    hips = sk.hips
    take.move(hips, [(f, (amp * np.sin(2 * np.pi * (arc[hips] / lam - f / cycle)), 0.004 * np.cos(4 * np.pi * f / cycle), 0.0)) for f in frames])
    stride = speed * duty * cycle / authored.FPS
    for side, offset in (("l", 0.0), ("r", 0.5)):
        for k in range(n):
            phase = (offset + k * stagger) % 1.0
            ks = []
            for u, dz, dy, mode in ((0.0, 0.5 * stride, 0.0, "linear"), (duty, -0.5 * stride, 0.0, "auto"),
                                     (duty + 0.35 * (1 - duty), -0.1 * stride, lift, "auto"),
                                     (duty + 0.75 * (1 - duty), 0.4 * stride, 0.6 * lift, "auto")):
                ks.append(((u + phase) * cycle % cycle, (0.0, dy, dz), mode))
            base = f"leg_{side}_{k:02d}"
            take.step((f"{base}_femur", f"{base}_tibia", f"{base}_tarsus"), ks)


def _legs(sk):
    return [(f"leg_{s}_{k:02d}_femur", f"leg_{s}_{k:02d}_tibia", f"leg_{s}_{k:02d}_tarsus") for s in "lr" for k in range(sk.segments)]


@authored.motion("centipede")
def centipede_motion(spec):
    sk = _fitted(spec)
    n = sk.segments
    segs = [f"seg_{k:02d}" for k in range(n)]
    hips = sk.hips
    front = segs[: int(hips[-2:])][::-1]  # hips-side first, towards the head
    rig = authored.Rig.bones([(b.name, b.parent, b.head, b.tail) for b in sk.bones])

    walk = authored.Take("Walk", 30, loop=True)
    _gait(walk, sk, 30, duty=0.62, speed=0.4, lift=0.05, wave=0.9, amp=0.025, stagger=0.13)
    run = authored.Take("Run", 16, loop=True)
    _gait(run, sk, 16, duty=0.5, speed=1.2, lift=0.07, wave=0.7, amp=0.07, stagger=0.13, keys=8)

    idle = authored.Take("Idle", 120, loop=True)
    # A slow lateral drift of the whole body, the head casting about with pauses, the jaws
    # working, two legs re-setting their grip.
    _gait_free = [(0, (0, 0, 0)), (30, (0, 1.5, 0)), (60, (0, 0, 0)), (90, (0, -1.5, 0))]
    idle.chain([hips] + front, _gait_free, delay=4, gain=[0.6] + [0.8] * (len(front)))
    idle.key("head", [(0, (0, 0, 0)), (14, (-4, 9, 0)), (34, (-5, 11, 1)), (52, (1, -2, 0)), (70, (-2, -10, -1)), (92, (-3, -9, 0)), (108, (0, 0, 0))])
    idle.key("jaw_l", [(0, 0), (20, (0, 8, 0)), (26, (0, -2, 0)), (44, (0, 0, 0)), (80, (0, 6, 0)), (86, (0, -1, 0)), (100, 0)])
    idle.key("jaw_r", [(0, 0), (20, (0, -8, 0)), (26, (0, 2, 0)), (44, (0, 0, 0)), (80, (0, -6, 0)), (86, (0, 1, 0)), (100, 0)])
    idle.key(segs[-1], [(0, 0), (40, (0, -3, 0)), (75, (0, 2, 0))])
    idle.move(hips, [(0, (0, 0, 0)), (30, (0, -0.004, 0)), (60, (0, 0.002, 0)), (90, (0, -0.004, 0))])
    shuffle = {("l", 1): 44, ("r", 3): 90}
    for side, k in [(s, k) for s in "lr" for k in range(n)]:
        base = f"leg_{side}_{k:02d}"
        leg = (f"{base}_femur", f"{base}_tibia", f"{base}_tarsus")
        f0 = shuffle.get((side, k))
        if f0 is None:
            idle.plant(leg)
        else:
            # Re-sets its grip: lifts, reaches a little and comes down on the same mark.
            idle.step(leg, [(0, 0), (f0, 0), (f0 + 4, (0, 0.035, 0.02)), (f0 + 7, (0, 0.01, 0.01)), (f0 + 9, 0)])

    attack = authored.Take("Attack", 30)
    # Anticipation: the fore-body rears and draws back, forcipules spread (0-10); strike: it
    # drives forward and down and the forcipules snap shut (10-14), overshoot and bite (14-19),
    # recover (19-30). The front two leg pairs lift and re-plant ahead.
    rear = [(0, 0), (4, (-3, 0, 0)), (10, (-9, 0, 0)), (13, (1.5, 0, 0)), (15, (2.5, 0, 0)), (19, (1, 0, 0)), (26, (0.2, 0, 0)), (30, 0)]
    attack.chain(front, rear, delay=0.7, gain=[0.4, 0.7, 1.0, 1.2][: len(front)] + [1.2] * max(0, len(front) - 4))
    attack.key("head", [(0, 0), (6, (-6, 0, 0)), (11, (-14, 0, 0)), (14, (2, 0, 0)), (16, (3.5, 0, 0)), (20, (1, 0, 0)), (28, (0.2, 0, 0)), (30, 0)])
    attack.key("jaw_l", [(0, 0), (8, (0, 22, 0)), (11, (0, 28, 0)), (13, (0, -10, 0)), (15, (0, -14, 0)), (19, (0, -8, 0)), (26, (0, 0, 0)), (30, 0)])
    attack.key("jaw_r", [(0, 0), (8, (0, -22, 0)), (11, (0, -28, 0)), (13, (0, 10, 0)), (15, (0, 14, 0)), (19, (0, 8, 0)), (26, (0, 0, 0)), (30, 0)])
    attack.move(hips, [(0, 0), (10, (0, 0.01, -0.06)), (14, (0, -0.005, 0.09)), (19, (0, 0, 0.07)), (30, 0)])
    lifted = {0, 1}
    for side, k in [(s, k) for s in "lr" for k in range(n)]:
        base = f"leg_{side}_{k:02d}"
        leg = (f"{base}_femur", f"{base}_tibia", f"{base}_tarsus")
        if k in lifted:
            attack.step(leg, [(0, 0), (6 + k, (0, 0.06, -0.02)), (13 + k, (0, 0.03, 0.12)), (16 + k, (0, 0, 0.14)), (22, (0, 0, 0.14)), (30, 0)])
        else:
            attack.plant(leg)  # the body surges forward over the planted feet

    hit = authored.Take("Hit", 16)
    # Struck from the side: the middle of the body kicks away, the kink runs out to both ends
    # and the head recoils, then it straightens with a small overshoot.
    ripple = [(0, 0), (2, (0, 9, 0)), (5, (0, -6, 0)), (9, (0, 2, 0)), (13, (0, -0.5, 0)), (16, 0)]
    hit.chain([hips] + front, ripple, delay=1.2, gain=[1.0] + [0.7] * len(front))
    hit.chain(segs[int(hips[-2:]) + 1:], ripple, delay=1.2, gain=[-0.8] * (n - int(hips[-2:]) - 1))
    hit.key("head", [(0, 0), (3, (-10, 0, 0)), (6, (-8, 0, 0)), (11, (2, 0, 0)), (16, 0)])
    hit.key("jaw_l", [(0, 0), (2, (0, 14, 0)), (7, (0, -4, 0)), (16, 0)])
    hit.key("jaw_r", [(0, 0), (2, (0, -14, 0)), (7, (0, 4, 0)), (16, 0)])
    hit.move(hips, [(0, 0), (3, (-0.05, 0.01, 0)), (7, (-0.04, 0, 0)), (12, (0.005, 0, 0)), (16, 0)])
    for leg in _legs(sk):
        hit.plant(leg)

    death = authored.Take("Death", 56)
    # Death throes: two violent S-writhes, then the body curls into a C on its side as the legs
    # fold in, and it settles.
    death.move(hips, [(0, 0), (6, (0.03, 0.02, 0)), (14, (-0.04, 0.0, 0)), (30, (0.02, -0.10, 0)), (42, (0.03, -0.15, 0)), (56, (0.03, -0.15, 0))])
    death.key(hips, [(0, 0), (8, (0, 6, 4)), (16, (0, -8, -3)), (32, (0, 10, 11)), (44, (0, 12, 14)), (56, (0, 12, 14))])
    writhe = [(0, (0, 0, 0)), (5, (2, 14, 0)), (11, (-2, -16, 0)), (17, (1, 10, 0)), (28, (0, 16, 0)), (40, (0, 20, 0)), (46, (0, 19, 0)), (56, (0, 19, 0))]
    death.chain(front, writhe, delay=1.5, gain=[0.8] + [1.0] * (len(front) - 1))
    # Behind the hips the bones point tailwards: the same curl is the opposite yaw.
    death.chain(segs[int(hips[-2:]) + 1:], [(f, (a, -b, c)) for f, (a, b, c) in writhe], delay=1.5)
    death.key("head", [(0, 0), (6, (-18, 8, 0)), (12, (-10, -10, 0)), (22, (6, 6, 0)), (40, (14, 10, 0)), (56, (14, 10, 0))])
    death.key("jaw_l", [(0, 0), (4, (0, 30, 0)), (10, (0, -8, 0)), (18, (0, 24, 0)), (36, (0, 12, 0)), (56, (0, 12, 0))])
    death.key("jaw_r", [(0, 0), (4, (0, -30, 0)), (10, (0, 8, 0)), (18, (0, -24, 0)), (36, (0, -12, 0)), (56, (0, -12, 0))])
    for side, sign in (("l", 1), ("r", -1)):
        for k in range(n):
            base = f"leg_{side}_{k:02d}"
            d = 1.2 * (k % 3)
            up = 44 if side == "l" else 58  # the body rolls onto its right side
            death.key(f"{base}_femur", [(0, 0), (4 + d, (0, 10, sign * 14)), (9 + d, (0, -8, sign * 4)), (16 + d, (0, 6, sign * 24)), (34, (0, 0, sign * (up - 4))), (44, (0, 0, sign * up)), (56, (0, 0, sign * up))])
            death.key(f"{base}_tibia", [(0, 0), (5 + d, (0, 0, -sign * 20)), (10 + d, (0, 0, -sign * 6)), (18 + d, (0, 0, -sign * 40)), (36, (0, 0, -sign * 75)), (46, (0, 0, -sign * 80)), (56, (0, 0, -sign * 80))])
    return rig, [idle, walk, run, attack, hit, death]
