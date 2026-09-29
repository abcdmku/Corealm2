"""Radial star class: The Hollow Star, a floating ring of curved spines and membranes round a
hollow core, with a long spike trailing to the ground behind it.

It has no limbs and no studio counterpart, so its motion is authored (motion set "star") on this
class's own fitted skeleton, like the serpent class: a core bone at the ring's centre, a spine chain
per angular sector of the ring (two bones from near the core to the sector's farthest tip) and a
three-bone tail along the trailing spike.

The star hovers: every clip but Death holds it clear of the ground and bobs it on eased curves.
Spines move as a ripple that runs round the ring (each sector's flex is phased by its angle),
the second bone of each spine lagging the first; glides lean into the travel and sweep the
spines back; the cast gathers the spines in, then bursts them open with an overshoot; the death
spasms, droops and sinks the star onto its side on the ground.
"""
import os

import numpy as np

from classes import authored
from crlib.body import resample
from crlib.skeleton import Skeleton

NAME = "special_star"
SECTORS = 10


def fit(body, donor=None, profile=None, source=None):
    V, H = body.verts, body.height
    front = V[:, 2] > np.percentile(V[:, 2], 35)
    ring = V[front]
    lo, hi = ring.min(0), ring.max(0)
    core = np.array([0.5 * (lo[0] + hi[0]), 0.5 * (lo[1] + hi[1]) + 0.1 * (hi[1] - lo[1]), float(np.median(ring[:, 2]))])
    sk = Skeleton()
    sk.add("root", None, [core[0], 0.0, core[2]], [core[0], 0.1 * H, core[2]], donor="root", follow=0.0, kind="root")
    sk.add("core", "root", core, core + [0, 0, 0.1 * H], donor="core", follow=0.0)
    rel = ring - core
    ang = np.arctan2(rel[:, 1], rel[:, 0])
    rad = np.hypot(rel[:, 0], rel[:, 1])
    spines = []
    for i in range(SECTORS):
        a0 = -np.pi + 2 * np.pi * i / SECTORS
        sel = (ang >= a0) & (ang < a0 + 2 * np.pi / SECTORS)
        if sel.sum() < 20:
            continue
        P, R = ring[sel], rad[sel]
        tip = P[np.argmax(R)]
        r_tip = R.max()
        if r_tip < 0.2 * H:
            continue
        middle = P[(R > 0.45 * r_tip) & (R < 0.7 * r_tip)]
        mid = middle.mean(0) if len(middle) else core + 0.55 * (tip - core)
        d = tip - core
        d[2] = 0.0
        base = core + 0.2 * r_tip * d / max(np.linalg.norm(d), 1e-9)
        base[2] = core[2]
        name = f"spine_{i:02d}"
        sk.add(f"{name}_a", "core", base, mid, donor=f"{name}_a", follow=0.0)
        sk.add(f"{name}_b", f"{name}_a", mid, tip, donor=f"{name}_b", follow=0.0)
        spines.append({"name": name, "angle": float(np.arctan2(d[1], d[0]))})
    # The trailing spike: centroids of the rear points, from the core down to the ground tip.
    rear = V[V[:, 2] < core[2] - 0.35 * H]
    tip = rear[np.argmin(rear[:, 2])]
    pts, _ = resample(np.array([core + [0, -0.1 * H, -0.1 * H], 0.5 * (core + tip), tip]), 3)
    parent = "core"
    for i in range(3):
        sk.add(f"tail_{i + 1:02d}", parent, pts[i], pts[i + 1], donor=f"tail_{i + 1:02d}", follow=0.0)
        parent = f"tail_{i + 1:02d}"
    sk.spines = spines
    return sk, {"core": core.tolist(), "spines": spines}


def plan(sk, body, profile):
    return {"hips": "core", "legs": [], "chains": [], "colliders": [], "hip_motion": 1.0, "scale": 1.0}


def cloth(body, sk, profile, heat):
    if (heat.sum(1) < 1e-6).mean() > 0.5:
        from classes.special_treant import heat_by_pieces

        heat_by_pieces(sk, heat)
    return None


# ------------------------------------------------------------------ authored takes
def _fitted(spec):
    from crlib.body import Body, load_blender_mesh
    import bpy

    work = spec["_work"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _, V, F = load_blender_mesh(os.path.join(work, "mesh.glb"))
    sk, _ = fit(Body(V, F))
    return sk


def _flare(angle, deg):
    """Rotation vector (degrees) tipping a spine at this ring angle towards +Z (forward: the ring
    cups) by deg; negative sweeps it back."""
    d = np.array([np.cos(angle), np.sin(angle), 0.0])
    axis = np.cross(d, [0.0, 0.0, 1.0])  # turning d towards +Z
    return tuple(deg * axis)


def _ripple(take, sk, cycle, amp, lag, base=0.0, keys=8, turns=1):
    """Spines flex in a wave running round the ring `turns` times per cycle; the outer bone lags
    the inner one by `lag` frames and flexes further."""
    for sp in sk.spines:
        phase = turns * sp["angle"] / (2 * np.pi)
        for part, gain, delay in (("a", 1.0, 0.0), ("b", 1.4, lag)):
            ks = []
            for i in range(keys):
                f = i * cycle / keys
                w = np.sin(2 * np.pi * (f / cycle - phase))
                ks.append(((f + delay) % cycle, _flare(sp["angle"], gain * (base + amp * w))))
            take.key(f"{sp['name']}_{part}", ks)


LIFT = 0.22  # hover height above the bind (the bind rests the spike's tip on the ground)
TAIL_GAIN = [0.6, 0.9, 1.2]  # the hover carries the spike raised by (4 degrees x gain) per bone


@authored.motion("star")
def star_motion(spec):
    sk = _fitted(spec)
    rig = authored.Rig.bones([(b.name, b.parent, b.head, b.tail) for b in sk.bones])
    tail = ["tail_01", "tail_02", "tail_03"]

    idle = authored.Take("Idle", 120, loop=True)
    idle.move("core", [(0, (0, LIFT, 0)), (30, (0.01, LIFT + 0.06, 0)), (60, (0, LIFT + 0.01, 0)), (90, (-0.01, LIFT + 0.07, 0))])
    idle.key("core", [(0, (-6, 0, 0)), (30, (-4, 3, 4)), (60, (-7, 0, 0)), (90, (-4, -3, -4))])
    _ripple(idle, sk, 120, amp=9, lag=6, turns=1)
    idle.chain(tail, [(0, (4, 0, 0)), (30, (2, 4, 0)), (60, (5, 0, 0)), (90, (2, -4, 0))], delay=8, gain=TAIL_GAIN)

    walk = authored.Take("Walk", 46, loop=True)
    walk.move("core", [(0, (0, LIFT, 0)), (12, (0.02, LIFT + 0.05, 0)), (23, (0, LIFT - 0.01, 0)), (35, (-0.02, LIFT + 0.05, 0))])
    walk.key("core", [(0, (4, 0, 2)), (12, (6, 2, 0)), (23, (4, 0, -2)), (35, (6, -2, 0))])
    _ripple(walk, sk, 46, amp=7, lag=4, base=-8, turns=1)
    walk.chain(tail, [(0, (3, 0, 0)), (12, (5, 5, 0)), (23, (3, 0, 0)), (35, (5, -5, 0))], delay=5, gain=[0.6, 1.0, 1.3])

    run = authored.Take("Run", 28, loop=True)
    run.move("core", [(0, (0, LIFT + 0.02, 0)), (7, (0.03, LIFT + 0.08, 0)), (14, (0, LIFT, 0)), (21, (-0.03, LIFT + 0.08, 0))])
    run.key("core", [(0, (11, 0, 3)), (7, (14, 3, 0)), (14, (11, 0, -3)), (21, (14, -3, 0))])
    _ripple(run, sk, 28, amp=8, lag=3, base=-16, turns=2)
    run.chain(tail, [(0, (5, 0, 0)), (7, (7, 7, 0)), (14, (5, 0, 0)), (21, (7, -7, 0))], delay=3, gain=[0.6, 1.0, 1.3])

    attack = authored.Take("Attack", 40)
    # Gather: the star draws back and up and its spines fold forward round the core (0-14);
    # burst: it thrusts forward as the spines flare open past rest (14-19), hold the release,
    # overshoot back and settle (19-40).
    attack.move("core", [(0, (0, LIFT, 0)), (12, (0, LIFT + 0.14, -0.18)), (18, (0, LIFT + 0.02, 0.28)), (24, (0, LIFT + 0.04, 0.2)), (32, (0, LIFT, 0.03)), (40, (0, LIFT, 0))])
    attack.key("core", [(0, (-6, 0, 0)), (12, (-16, 0, 0)), (18, (8, 0, 0)), (24, (4, 0, 0)), (32, (-5, 0, 0)), (40, (-6, 0, 0))])
    for sp in sk.spines:
        for part, gain, delay in (("a", 1.0, 0), ("b", 1.5, 2)):
            ks = [(0, _flare(sp["angle"], 0)), (4 + delay, _flare(sp["angle"], gain * 6)), (13 + delay, _flare(sp["angle"], gain * 18)),
                  (17 + delay, _flare(sp["angle"], -gain * 16)), (21 + delay, _flare(sp["angle"], -gain * 22)), (28 + delay, _flare(sp["angle"], -gain * 4)),
                  (34 + delay, _flare(sp["angle"], gain * 3)), (40, _flare(sp["angle"], 0))]
            attack.key(f"{sp['name']}_{part}", ks)
    attack.chain(tail, [(0, (4, 0, 0)), (12, (13, 0, 0)), (18, (1, 0, 0)), (26, (5, 0, 0)), (40, (4, 0, 0))], delay=2, gain=TAIL_GAIN)

    hit = authored.Take("Hit", 20)
    hit.move("core", [(0, (0, LIFT, 0)), (3, (0.05, LIFT + 0.03, -0.14)), (8, (0.03, LIFT + 0.01, -0.1)), (14, (0, LIFT, 0.01)), (20, (0, LIFT, 0))])
    hit.key("core", [(0, (-6, 0, 0)), (3, (-13, 4, 8)), (8, (-11, 2, 5)), (14, (-5, 0, -1)), (20, (-6, 0, 0))])
    for sp in sk.spines:
        for part, gain, delay in (("a", 1.0, 0), ("b", 1.5, 2)):
            ks = [(0, _flare(sp["angle"], 0)), (2 + delay, _flare(sp["angle"], gain * 12)), (7 + delay, _flare(sp["angle"], -gain * 6)), (12 + delay, _flare(sp["angle"], gain * 2)), (20, _flare(sp["angle"], 0))]
            hit.key(f"{sp['name']}_{part}", ks)
    hit.chain(tail, [(0, (4, 0, 0)), (2, (11, 0, 0)), (5, (14, 0, 0)), (10, (8, 0, 0)), (20, (4, 0, 0))], delay=1, gain=TAIL_GAIN)

    death = authored.Take("Death", 64)
    # A last spasm (spines thrash open), then the light goes out: the spines droop, the star
    # sinks, tips forward onto its face and settles on the ground.
    death.move("core", [(0, (0, LIFT, 0)), (8, (0, LIFT + 0.1, -0.05)), (30, (0, 0.0, 0.15)), (44, (0.05, -0.55, 0.45)), (52, (0.06, -0.62, 0.5)), (64, (0.06, -0.62, 0.5))])
    death.key("core", [(0, (-6, 0, 0)), (8, (-14, 4, 6)), (30, (20, 2, 10)), (44, (58, 0, 16)), (50, (62, 0, 17)), (64, (62, 0, 17))])
    for sp in sk.spines:
        droop = -30 * max(0.0, np.sin(sp["angle"])) + 10  # upper spines fold back hardest
        for part, gain, delay in (("a", 1.0, 0), ("b", 1.4, 3)):
            ks = [(0, _flare(sp["angle"], 0)), (5 + delay, _flare(sp["angle"], -gain * 20)), (10 + delay, _flare(sp["angle"], gain * 12)),
                  (30 + delay, _flare(sp["angle"], gain * 0.5 * droop)), (46 + delay, _flare(sp["angle"], gain * droop)), (64, _flare(sp["angle"], gain * droop))]
            death.key(f"{sp['name']}_{part}", ks)
    death.chain(tail, [(0, (4, 0, 0)), (8, (12, 6, 0)), (30, (-16, 0, 0)), (46, (-34, 0, 0)), (64, (-34, 0, 0))], delay=3, gain=TAIL_GAIN)
    return rig, [idle, walk, run, attack, hit, death]


def recoil_bones(sk, plan, profile):
    """Everything past the core recoils: the ring's spines and the trailing spike. The root and
    the core (the hover) stay on the base pose."""
    return [b.name for b in sk.bones if b.name not in ("root", "core")]
