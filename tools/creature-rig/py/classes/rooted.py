"""Rooted plant class: a flower maw on a thorn bulb, carried by four hooked root legs.

The Thorn Maw roams (it walks and chases in game), so its legs and bulb are a four-legged body
(special_quad) named after the animal-pack crocodile, whose sprawled legs match the splayed roots.
Walk is the crocodile's own gait; its gallop twists the root feet, so Run is left to the
runtime's Walk fallback. The maw is the crocodile's head: Head_Top carries the upper lip and
Head_Jaw the lower lip, hinged at the back of the cup. Leaves hanging at the sides
and the curled tendrils on top have no donor twin; they are spring chains that follow through.

A plant does not idle, strike, flinch or die like a crocodile, so Idle, Attack, Hit and Death are
authored on the crocodile rig (motion set "maw"): a slow sway with a breathing maw, a snap with a
rear-back anticipation, overshoot and settle, a recoil, and a collapse onto the floor.
"""
import numpy as np

from classes import authored
from classes.special_quad import feet_override, fit_quad, quad_legs
from crlib.body import resample

NAME = "rooted"


def _tip_chain(body, seed, tip, length, links):
    """Points along the last `length` of the medial path from the body seed to a tip."""
    dist, pred = body.geodesic(seed)
    path = body.path(pred, body.nearest_node(tip))
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    keep = path[s >= s[-1] - length]
    if len(keep) < 2:
        keep = path[-2:]
    pts, _ = resample(np.vstack([keep, tip]), links)
    return pts


def fit(body, donor, profile, source=None):
    V, H = body.verts, body.height
    x0 = float(np.median(V[:, 0]))
    # The maw: the front of the upper lip (the frontmost point in the maw's upper half) and of
    # the lower lip (the frontmost point below it, above the bulb's middle); the hinge is at the
    # back of the cup between them.
    upper = V[V[:, 1] > 0.7 * H]
    up_tip = upper[np.argmax(upper[:, 2])]
    lower = V[(V[:, 1] > 0.5 * H) & (V[:, 1] < up_tip[1] - 0.08 * H)]
    low_tip = lower[np.argmax(lower[:, 2])]
    hinge_y = 0.5 * (up_tip[1] + low_tip[1])
    cup = body.slab(hinge_y, 2 * body.h)[0]
    hinge = np.array([x0, hinge_y, float(cup["min"][1] + 0.3 * (cup["max"][1] - cup["min"][1]))])
    base = np.array([x0, hinge_y - 0.18 * H, hinge[2] - 0.05 * H])
    head_tip = np.array([x0, up_tip[1], up_tip[2]])
    sk, notes = fit_quad(body, donor, profile, head_tip, head_base=base, head_joint=hinge)
    P = sk.quad["prefix"]
    # Lower lip on the crocodile jaw, with the drooping lower petal on the jaw end.
    droop = V[(V[:, 2] > low_tip[2] - 0.1 * H) & (V[:, 1] < low_tip[1])]
    droop_tip = droop[np.argmin(droop[:, 1])] if len(droop) else low_tip - [0, 0.1 * H, 0]
    lip = np.array([x0, low_tip[1], low_tip[2]])
    sk.add(f"{P}_Head_JawSHJnt", f"{P}_Neck_TopSHJnt", hinge, lip, donor=f"{P}_Head_JawSHJnt", follow=0.0)
    sk.add(f"{P}_Head_JawEndSHJnt", f"{P}_Head_JawSHJnt", lip, np.array([x0, droop_tip[1], droop_tip[2]]),
           donor=f"{P}_Head_JawEndSHJnt", follow=0.0)

    # Follow-through: the tendrils curling up behind the maw and the leaves hanging at the sides.
    seed = body.to_world(np.unravel_index(np.argmax(body.dt), body.dt.shape))
    ext, _, _ = body.extremities(seed, 0.08 * H, 0.3 * H)
    chains = []
    spine_top = f"{P}_Spine_TopSHJnt"
    for side, sign in (("l", 1), ("r", -1)):
        tendril = [e["position"] for e in ext if sign * (e["position"][0] - x0) > 0.1 * H and e["position"][1] > 0.75 * H and e["position"][2] < hinge[2]]
        leaf = [e["position"] for e in ext if sign * (e["position"][0] - x0) > 0.35 * H and 0.12 * H < e["position"][1] < 0.45 * H]
        for kind, cands, parent, length, links in (("tendril", tendril, f"{P}_Neck_TopSHJnt", 0.3 * H, 3), ("leaf", leaf, spine_top, 0.35 * H, 2)):
            if not cands:
                continue
            tip = max(cands, key=lambda p: sign * p[0] if kind == "leaf" else p[1])
            pts = _tip_chain(body, seed, tip, length, links)
            prev = parent
            bones = []
            for i in range(links):
                name = f"{kind}_{side}_{i + 1:02d}"
                sk.add(name, prev, pts[i], pts[i + 1], kind="tail")
                bones.append(name)
                prev = name
            chains.append({"bones": bones, "kind": kind})
    sk.chains = chains
    notes.update({"hinge": hinge.tolist(), "upperLip": head_tip.tolist(), "lowerLip": lip.tolist(),
                  "chains": [c["bones"] for c in chains]})
    return sk, notes


def cloth(body, sk, profile, heat):
    """No cloth: the root toes ride the feet (see special_quad.feet_override)."""
    return feet_override(body, sk)


def plan(sk, body, profile):
    P = sk.quad["prefix"]
    chains = []
    for c in sk.chains:
        if c["kind"] == "leaf":
            chains.append({"bones": c["bones"], "stiffness": 30.0, "damping": 5.0, "gravity": 0.0, "hang": 0.5, "clearance": 0.02 * body.height})
        else:
            chains.append({"bones": c["bones"], "stiffness": 45.0, "damping": 6.0, "gravity": 0.0, "hang": 0.0, "clearance": 0.0})
    return {"hips": f"{P}_ROOTSHJnt", "legs": quad_legs(sk), "chains": chains, "colliders": [],
            "hip_motion": profile.get("hipMotion", 1.0)}


# ------------------------------------------------------------------ authored takes
C = "Crocodile"
NECK = [f"{C}_Neck_01SHJnt", f"{C}_Neck_02SHJnt", f"{C}_Neck_TopSHJnt"]
SPINE = [f"{C}_Spine_0{i}SHJnt" for i in range(1, 5)] + [f"{C}_Spine_TopSHJnt"]
TOP, JAW, JAW_END, ROOT = f"{C}_Head_TopSHJnt", f"{C}_Head_JawSHJnt", f"{C}_Head_JawEndSHJnt", f"{C}_ROOTSHJnt"
HIP = 0.248  # crocodile hips height: authored offsets are shares of it
LEGS = [tuple(f"{C}_{s}_{e}Leg_{j}SHJnt" for j in ("Hip", "Knee", "Ankle")) for s in "lr" for e in ("Front", "Hind")]


@authored.motion("maw")
def maw_motion(spec):
    """Degrees about world axes (+X the maw's left: a positive X turn tips the maw nose-down),
    relative to the parent; offsets in crocodile metres."""
    idle = authored.Take("Idle", 96, loop=True)
    # A slow figure-of-eight sway of the bulb and maw, the maw lagging the bulb and breathing.
    idle.key(ROOT, [(0, (0, 0, 0)), (24, (1.5, 2, 2)), (48, (0, 0, 0)), (72, (-1, -2, -2))])
    idle.move(ROOT, [(0, (0, 0, 0)), (24, (0, -0.012 * HIP, 0)), (48, (0, 0.006 * HIP, 0)), (72, (0, -0.012 * HIP, 0))])
    idle.chain(SPINE[3:], [(0, (0, 1, 1)), (24, (2, 3, 2)), (48, (0, -1, -1)), (72, (-2, -3, -2))], delay=4, gain=[0.8, 1.0])
    idle.chain(NECK, [(0, (0, 1, 1.5)), (24, (3, 4, 3)), (48, (0, -1, -1.5)), (72, (-3, -4, -3))], delay=5, gain=[0.7, 1.0, 1.2])
    idle.key(TOP, [(0, (0, 0, 0)), (20, (-5, 0, 0)), (36, (-7, 0, 0)), (60, (1, 0, 0)), (80, (0, 0, 0))])
    idle.key(JAW, [(0, (0, 0, 0)), (22, (6, 0, 0)), (38, (9, 0, 0)), (62, (-1, 0, 0)), (82, (0, 0, 0))])
    idle.key(JAW_END, [(0, (0, 0, 0)), (28, (4, 0, 0)), (44, (6, 0, 0)), (70, (-1, 0, 0))])

    attack = authored.Take("Attack", 40)
    # Rear back and gape (0-13), snap forward and shut (13-18), overshoot and grind (18-25),
    # settle (25-40). The bulb carries the strike: it crouches back, then surges forward.
    attack.move(ROOT, [(0, 0), (11, (0, -0.10 * HIP, -0.12 * HIP)), (17, (0, -0.02 * HIP, 0.22 * HIP)), (21, (0, -0.04 * HIP, 0.18 * HIP)), (30, (0, -0.01 * HIP, 0.04 * HIP)), (40, 0)])
    attack.key(ROOT, [(0, 0), (11, (-5, 0, 0)), (17, (4, 0, 0)), (22, (3, 0, 0)), (32, (0.5, 0, 0)), (40, 0)])
    attack.chain(SPINE[3:], [(0, 0), (11, (-5, 0, 0)), (16, (5, 0, 0)), (22, (3, 0, 0)), (34, (0, 0, 0)), (40, 0)], delay=1, gain=[0.8, 1.0])
    attack.chain(NECK, [(0, 0), (4, (-4, 0, 0)), (12, (-12, 0, 0)), (16, (9, 0, 0)), (19, (12, 0, 0)), (24, (6, 0, 0)), (33, (1, 0, 0)), (40, 0)], delay=1, gain=[0.4, 0.55, 0.7])
    attack.key(TOP, [(0, 0), (6, (-10, 0, 0)), (12, (-26, 0, 0)), (16, (6, 0, 0)), (18, (9, 0, 0)), (21, (4, 0, 0)), (24, (6, 0, 0)), (32, (0, 0, 0)), (40, 0)])
    attack.key(JAW, [(0, 0), (6, (12, 0, 0)), (12, (30, 0, 0)), (16, (-6, 0, 0)), (18, (-9, 0, 0)), (21, (-3, 0, 0)), (24, (-6, 0, 0)), (32, (0, 0, 0)), (40, 0)])
    attack.key(JAW_END, [(0, 0), (8, (6, 0, 0)), (13, (14, 0, 0)), (17, (-8, 0, 0)), (21, (4, 0, 0)), (28, (-2, 0, 0)), (40, 0)])

    hit = authored.Take("Hit", 18)
    # Knocked back: the bulb rocks back and sideways, the maw clamps shut and whips after it.
    hit.move(ROOT, [(0, 0), (3, (0, -0.02 * HIP, -0.10 * HIP)), (7, (0, -0.03 * HIP, -0.08 * HIP)), (13, (0, 0, 0.01 * HIP)), (18, 0)])
    hit.key(ROOT, [(0, 0), (3, (-5, 0, 3)), (7, (-4, 0, 2)), (12, (1, 0, -1)), (15, (-0.3, 0, 0.2)), (18, 0)])
    hit.chain(NECK, [(0, 0), (3, (-8, 3, 3)), (7, (-9, 4, 2)), (12, (3, -1, -1)), (15, (-1, 0, 0)), (18, 0)], delay=1, gain=[0.4, 0.55, 0.7])
    hit.key(TOP, [(0, 0), (2, (5, 0, 0)), (6, (6, 0, 0)), (12, (-2, 0, 0)), (18, 0)])
    hit.key(JAW, [(0, 0), (2, (-5, 0, 0)), (6, (-6, 0, 0)), (12, (3, 0, 0)), (18, 0)])

    death = authored.Take("Death", 72)
    # A collapse: a last shudder with the maw gaping (0-6); the root legs buckle under the bulb
    # (6-20: the hips drop over the planted feet, so the knees fold); the trunk topples onto its
    # side and forward (18-34) with the maw lagging, then slamming down onto the floor (34-38);
    # a small rebound (38-46) and the maw flopping after it; everything settles by 56 and holds.
    # A positive Z turn tips the top towards -X, so the bulb slides that way as it falls.
    death.move(ROOT, [(0, 0), (5, (0, 0.04 * HIP, -0.02 * HIP)), (14, (-0.03 * HIP, -0.35 * HIP, 0.04 * HIP)),
                      (24, (-0.10 * HIP, -0.52 * HIP, 0.08 * HIP)), (33, (-0.15 * HIP, -0.65 * HIP, 0.10 * HIP)),
                      (40, (-0.16 * HIP, -0.59 * HIP, 0.10 * HIP)), (48, (-0.16 * HIP, -0.65 * HIP, 0.10 * HIP)),
                      (56, (-0.16 * HIP, -0.63 * HIP, 0.10 * HIP)), (72, (-0.16 * HIP, -0.63 * HIP, 0.10 * HIP))])
    death.key(ROOT, [(0, 0), (5, (-4, 0, -2)), (14, (1, 0, 6)), (24, (3, 0, 16)), (33, (4, 0, 30)),
                     (40, (3, 0, 25)), (48, (4, 0, 31)), (56, (4, 0, 30)), (72, (4, 0, 30))])
    death.chain(SPINE[3:], [(0, 0), (5, (-4, 0, -1)), (16, (1, 0, 4)), (30, (3, 0, 10)), (38, (4, 0, 12)),
                            (46, (2, 0, 9)), (56, (3, 0, 10)), (72, (3, 0, 10))], delay=2, gain=[0.8, 1.0])
    # The neck lags the trunk on the way down, whips nose-down and sideways as the maw hits the
    # floor, rebounds and flops back.
    death.chain(NECK, [(0, 0), (5, (-12, 3, 0)), (16, (-8, 2, 4)), (26, (2, 0, 10)), (34, (10, -3, 16)),
                       (38, (13, -4, 19)), (44, (6, -3, 13)), (50, (11, -4, 17)), (58, (10, -4, 16)), (72, (10, -4, 16))],
                delay=2, gain=[0.4, 0.55, 0.7])
    death.key(TOP, [(0, 0), (5, (-16, 0, 0)), (14, (-24, 0, 0)), (30, (-10, 0, 0)), (37, (4, 0, 0)),
                    (43, (-14, 0, 0)), (50, (-4, 0, 0)), (58, (-8, 0, 0)), (72, (-8, 0, 0))])
    death.key(JAW, [(0, 0), (5, (16, 0, 0)), (14, (26, 0, 0)), (30, (18, 0, 0)), (37, (6, 0, 0)),
                    (43, (22, 0, 0)), (50, (12, 0, 0)), (58, (16, 0, 0)), (72, (16, 0, 0))])
    death.key(JAW_END, [(0, 0), (10, (10, 0, 0)), (26, (20, 0, 0)), (38, (4, 0, 0)), (46, (18, 0, 0)), (56, (12, 0, 0)), (72, (12, 0, 0))])
    for take in (idle, attack, hit, death):
        take.plant(*LEGS)
    return authored.Rig.donor({"ref": "animal_crocodile"}), [idle, attack, hit, death]
