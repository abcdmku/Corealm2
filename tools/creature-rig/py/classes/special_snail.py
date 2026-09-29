"""Snail class: a foot sole, a rigid shell, a neck rising to the head and two eyestalks.

The skeleton takes the animal-pack snail's bone names (Bone001 shell, Bone002-006 the foot back
to the tail tip, Bone007-009 the front foot, neck and head), so its Idle, Walk and Die retarget
bone for bone; every bone adds the donor's motion to its own rest (follow 0), because the donor's
head lies on the ground while a garden snail holds its head up. The shell is bound rigidly to
Bone001. The eyestalks have no donor twin: they are spring chains that follow through.

The snail donor has no strike and no flinch, and no other donor has a snail strike, so the body
ships without Attack and Hit (the runtime's missing-hit flinch applies).
"""
import numpy as np

from crlib.body import resample
from crlib.skeleton import Skeleton
from crlib.skin import adjacency

NAME = "special_snail"


def _components(body):
    from scipy.sparse.csgraph import connected_components

    _, label = connected_components(adjacency(len(body.verts), body.faces), directed=False)
    return label


def _shell(body):
    """The shell: the largest separate piece whose centre sits above half the height. A snail
    modelled as one piece has no separable shell, and the class does not guess one."""
    label = _components(body)
    sizes = np.bincount(label)
    for c in np.argsort(-sizes):
        idx = np.nonzero(label == c)[0]
        if len(idx) < 0.1 * len(body.verts):
            break
        if body.verts[idx, 1].mean() > 0.45 * body.height and c != np.argmax(sizes):
            return idx
    raise RuntimeError("no separate shell piece; this snail needs a shell override")


def fit(body, donor, profile, source=None):
    V, H = body.verts, body.height
    shell_idx = _shell(body)
    shell = V[shell_idx]
    rest = np.ones(len(V), bool)
    rest[shell_idx] = False
    B = V[rest]
    x0 = float(np.median(B[:, 0]))

    # Foot sole: the body's lowest band, from the tail tip to the front of the foot.
    sole = B[B[:, 1] < 0.06 * H]
    foot_y = float(np.percentile(B[B[:, 1] < 0.12 * H][:, 1], 50))
    tail_z, front_z = float(sole[:, 2].min()), float(sole[:, 2].max())

    # Eyestalk tips: the highest body points in the front half, one each side of the midline.
    front = B[B[:, 2] > shell[:, 2].max() - 0.1 * H]
    tips = {}
    for side, sign in (("l", 1), ("r", -1)):
        cands = front[sign * (front[:, 0] - x0) > 0.02 * H]
        tips[side] = cands[np.argmax(cands[:, 1])]
    # Stalk base: going down from the tips, the first height where the head's surface crosses the
    # midline between the two stalks (they have joined the head).
    base_y = min(t[1] for t in tips.values())
    for y in np.arange(base_y, 0.3 * H, -0.5 * body.h):
        band = front[np.abs(front[:, 1] - y) < body.h]
        if (np.abs(band[:, 0] - x0) < 0.03 * H).any():
            base_y = y
            break
    base_y = float(base_y)

    # Neck centre line: centroids of the front body (ahead of the shell) in slabs from the foot up
    # to the stalk base.
    neck_front = B[B[:, 2] > shell[:, 2].max() - 0.02 * H]
    line = []
    for y in np.linspace(foot_y, base_y, 7):
        band = neck_front[np.abs(neck_front[:, 1] - y) < 0.04 * H]
        if len(band):
            line.append([x0, y, float(np.median(band[:, 2]))])
    line = np.array(line)
    neck_base = np.array([x0, foot_y, float(line[0][2])])
    head = np.array([x0, base_y, float(line[-1][2])])

    c = shell.mean(0)
    shell_pivot = np.array([c[0], shell[:, 1].min() + 0.25 * np.ptp(shell[:, 1]), c[2]])
    under = np.array([x0, foot_y, c[2]])

    sk = Skeleton()
    sk.add("root", None, [x0, 0.0, c[2]], [x0, 0.1 * H, c[2]], kind="root")
    sk.add("Bone001", "root", shell_pivot, [c[0], shell[:, 1].max(), c[2]], donor="Bone001", follow=0.0)
    foot, _ = resample(np.array([under, [x0, foot_y, 0.5 * (under[2] + tail_z)], [x0, foot_y * 0.8, tail_z + 0.02 * H]]), 5)
    parent = "Bone001"
    for i, name in enumerate(["Bone002", "Bone003", "Bone004", "Bone005", "Bone006"]):
        sk.add(name, parent, foot[i], foot[i + 1], donor=name, follow=0.0)
        parent = name
    # The neck rises from the front of the foot: Bone007-009 run from its base to the head. (On
    # the donor Bone007 is a short piece of front foot; here the front sole stays with the shell,
    # see cloth(), so it never pitches into the ground.)
    neck, _ = resample(np.vstack([neck_base + [0, foot_y, 0], line[1:]]), 3)
    for i, name in enumerate(["Bone007", "Bone008", "Bone009"]):
        sk.add(name, "Bone001" if i == 0 else f"Bone00{6 + i}", neck[i], neck[i + 1], donor=name, follow=0.0)
    sk.add("head", "Bone009", head, head + [0, 0.02 * H, 0.04 * H], follow=0.0)
    for side in ("l", "r"):
        t = tips[side]
        stalk_base = np.array([0.5 * (x0 + t[0]), base_y, 0.5 * (head[2] + t[2])])
        pts, _ = resample(np.array([stalk_base, t]), 2)
        sk.add(f"eye_{side}_01", "head", pts[0], pts[1], kind="tail")
        sk.add(f"eye_{side}_02", f"eye_{side}_01", pts[1], pts[2], kind="tail")

    # Hips offsets scale by the shell's height over the foot, relative to the donor's.
    d_rise = donor.rest_head["Bone001"][1] - donor.rest_head["Bone002"][1]
    sk.plan_scale = float((shell_pivot[1] - foot_y) / d_rise)
    sk.shell_idx = shell_idx
    sk.front_sole = np.nonzero(rest & (V[:, 2] > c[2]))[0]
    sk.foot_y = foot_y
    notes = {"shell": {"vertices": int(len(shell_idx)), "pivot": shell_pivot.tolist()},
             "footY": foot_y, "tailZ": tail_z, "frontZ": front_z, "stalkBaseY": base_y,
             "eyeTips": {k: v.tolist() for k, v in tips.items()}, "hipScale": sk.plan_scale}
    return sk, notes


def plan(sk, body, profile):
    chains = [{"bones": [f"eye_{s}_01", f"eye_{s}_02"], "stiffness": 110.0, "damping": 10.0, "gravity": 0.0,
               "hang": 0.0, "clearance": 0.0} for s in ("l", "r")]
    return {"hips": "Bone001", "legs": [], "chains": chains, "colliders": [], "scale": sk.plan_scale,
            "hip_motion": profile.get("hipMotion", 1.0)}


def cloth(body, sk, profile, heat):
    """No cloth: the override binds the shell rigidly to Bone001, and the sole in front of the
    shell to Bone001 too, blending into the neck's heat weights above the foot, so the front of
    the foot stays planted while the neck bends above it."""
    names = sk.names()
    shell = sk.shell_idx
    col = names.index("Bone001")
    sole = sk.front_sole
    y = body.verts[sole, 1]
    lo, hi = 1.2 * sk.foot_y, 1.2 * sk.foot_y + 0.1 * body.height
    a = np.clip((hi - y) / (hi - lo), 0, 1)
    a = a * a * (3 - 2 * a)

    def override(W):
        W = W.copy()
        W[sole] *= (1 - a)[:, None]
        W[sole, col] += a
        W[shell] = 0.0
        W[shell, col] = 1.0
        locked = np.zeros(len(W), bool)
        locked[shell] = True
        locked[sole[a > 0.99]] = True
        return W, locked

    return override


def bind_turns(sk, profile):
    """The donor snail carries its head low and raises it to look around; this snail's neck is
    modelled upright. The bind leans the neck forward into the crawling carry (the eyestalks stay
    upright), so the donor's raise brings it back up instead of folding it into the shell."""
    from crlib.mathx import axis_angle

    lean = np.radians(profile.get("neckLean", 30.0))
    turns = {"Bone007": axis_angle([1.0, 0, 0], lean)}
    for s in ("l", "r"):
        turns[f"eye_{s}_01"] = axis_angle([1.0, 0, 0], -lean)
    return turns


def recoil_bones(sk, plan, profile):
    """The neck, head and eyestalks recoil; the shell (Bone001, the hips) and the foot chain
    (Bone002-006, the front sole under Bone001) stay on the base pose."""
    return ["Bone008", "Bone009", "head", "eye_l_01", "eye_l_02", "eye_r_01", "eye_r_02"]
