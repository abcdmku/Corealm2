"""Golem class: heavy bipeds (stone, crystal and beetle golems, bark and root treants) on the
humanoid skeleton. The humanoid module fits the skeleton and makes the capes; this module adds
what makes a heavy body read as heavy and a rock or bark body move as rock or bark:

- quietBones: torso bones that take no donor motion of their own and ride their parent rigidly.
  A human donor spreads its lean, twist and sway over three spine bones and the neck; a golem's
  torso is one block, so only the lower spine carries it and the head stops bobbing.
- soleJoints: the ball and toe joints sit on the sole. The core pitches the foot so the ball and
  the toe tip follow the donor's heights, which then protects the sole itself.
- heelPivot: the foot joint sits at the back of the sole. Block and root feet reach far behind
  the ankle; with the pivot there the foot IK keeps the heel on the floor at heel strike and the
  block rolls over it. The cape finder still sees the real ankle.
- Foot blocks: everything below the ankle is weighted to the foot, so a big heel does not turn
  with the shin and dig into the floor at every heel strike.
- rigidByThickness: rock plates, crystals, carapace and bark plates. Loose pieces (not joined to
  the body surface) that are thick and compact are bound rigidly to one bone, also when bone heat
  splits them between a bone and its parent or child (a shoulder plate between the clavicle and
  the upper arm). Thin loose pieces (fringes, moss) keep smooth weights.

- brute_arms (authored motion set): arm layers for a brute whose arms reach the floor. A human
  donor lets its arms hang straight down, which drives floor-length arms through the floor; these
  takes carry the arms out from the body so the knuckles swing clear of it.

Profiles are in golem.donors.json.
"""
import numpy as np
from scipy.sparse.csgraph import connected_components

from classes import authored, humanoid
from crlib.skin import adjacency, segment_distance

NAME = "golem"


# ---------------------------------------------------------------- skeleton
def fit(body, donor, profile, source=None):
    # A body modelled turned about the vertical (profile "yaw") is fitted facing +Z and turned back.
    body_f = humanoid.faced(body, profile)
    sk, notes = humanoid.fit_upright(body_f, donor, profile, source=source)
    sk.notes = notes  # cloth() records the rigid plates here; rig.json keeps the notes
    if profile.get("soleJoints", True):
        _sole_joints(sk, profile)
    if profile.get("heelPivot"):
        _heel_pivot(sk, body_f, profile)
    for name in profile.get("quietBones", []):
        if name in sk:
            sk[name].donor = None
    ankles = {s: np.array(p) for s, p in notes.get("ankles", {}).items()}
    humanoid.unface(sk, profile, list(ankles.values()))
    if ankles:
        notes["ankles"] = {s: p.tolist() for s, p in ankles.items()}
    return sk, notes


def _sole_joints(sk, profile):
    """A golem's foot is a block whose sole sits well below the humanoid ball joint (a third of
    the ankle height). Joints on the sole make the points the foot IK protects the sole's own."""
    for side in ("l", "r"):
        foot, ball = f"foot_{side}", f"ball_{side}"
        if foot not in sk:
            continue
        y = profile.get("soleHeight", 0.12) * sk[foot].head[1]
        sk[ball].head[1] = y
        sk[ball].tail[1] = y
        sk[foot].tail = sk[ball].head.copy()


def _heel_pivot(sk, body, profile):
    """A block or root foot reaches far behind the ankle, and a heel that far back dips through
    the floor whenever the donor's foot is toes-up (heel strike). The foot joint moves to the back
    of the sole, so the foot IK, which follows the donor's ankle path, keeps the heel on the floor
    and the block rolls over it."""
    V = body.verts
    for side in ("l", "r"):
        foot, calf = f"foot_{side}", f"calf_{side}"
        if foot not in sk:
            continue
        ankle = sk[foot].head.copy()
        near = (np.linalg.norm(V[:, [0, 2]] - ankle[[0, 2]], axis=1) < 0.25 * body.height) & (V[:, 1] < ankle[1])
        near &= np.sign(V[:, 0] - sk["pelvis"].head[0]) == np.sign(ankle[0] - sk["pelvis"].head[0])
        if not near.any():
            continue
        sk.notes.setdefault("ankles", {})[side] = ankle.tolist()
        heel_z = np.percentile(V[near, 2], profile.get("heelPercentile", 5))
        reach = ankle[2] - heel_z
        back = profile.get("heelShare", 0.7) * max(reach, 0.0)
        head = np.array([ankle[0], sk[f"ball_{side}"].head[1], ankle[2] - back])
        sk[foot].head = head
        sk[calf].tail = head.copy()


def plan(sk, body, profile):
    return humanoid.plan(sk, body, profile)


def bind_turns(sk, profile):
    return humanoid.bind_turns(sk, profile)


# -------------------------------------------------------------------- skin
def _foot_blocks(W, sk, V, H):
    """Everything below the ankle is the foot block. Bone heat hands a heel or a root foot behind
    the ankle to the calf, and a heel that turns with the shin digs into the floor at every heel
    strike. Calf and thigh weight moves to the foot below the ankle, blended over a band from 0.8
    to 1.4 times the ankle height."""
    names = sk.names()
    ankles = {s: np.array(sk.notes.get("ankles", {}).get(s, sk[f"foot_{s}"].head)) for s in ("l", "r") if f"foot_{s}" in sk}
    for side, ankle in ankles.items():
        other = ankles.get("r" if side == "l" else "l", ankle + [1e3, 0, 0])
        flat = np.linalg.norm(V[:, [0, 2]] - ankle[[0, 2]], axis=1)
        mine = (flat < np.linalg.norm(V[:, [0, 2]] - other[[0, 2]], axis=1)) & (flat < 0.25 * H)
        lo, hi = 0.8 * ankle[1], 1.4 * ankle[1]
        t = np.clip((hi - V[:, 1]) / max(hi - lo, 1e-6), 0, 1) * mine
        t = t * t * (3 - 2 * t)
        f = names.index(f"foot_{side}")
        for leg in (f"calf_{side}", f"thigh_{side}"):
            k = names.index(leg)
            move = W[:, k] * t
            W[:, k] -= move
            W[:, f] += move
    return W


def _capes(body, sk, profile, heat):
    """The humanoid cape finder keeps sheets clear of the leg bones and off the feet. It must see
    the ankle where the foot really bends, not the heel pivot, and heat with the foot blocks
    already on the foot, or it takes a root foot trailing behind the ankle for a cape hem."""
    heat = _foot_blocks(heat.copy(), sk, body.verts, body.height)
    ankles = sk.notes.get("ankles", {})
    moved = {}
    for side, ankle in ankles.items():
        moved[side] = sk[f"foot_{side}"].head.copy()
        sk[f"foot_{side}"].head = np.array(ankle)
        sk[f"calf_{side}"].tail = np.array(ankle)
    try:
        return humanoid.cloth(body, sk, profile, heat)
    finally:
        for side, head in moved.items():
            sk[f"foot_{side}"].head = head
            sk[f"calf_{side}"].tail = head.copy()


def cloth(body, sk, profile, heat):
    """Capes from the humanoid module, then foot blocks, then rigid plates. Returns the weight
    override skin() applies before smoothing."""
    capes = _capes(body, sk, profile, heat) if profile.get("cloth", True) else None
    H = body.height
    V, F = body.verts, body.faces
    names = sk.names()
    count, label = connected_components(adjacency(len(V), F), directed=False)
    sizes = np.bincount(label, minlength=count)
    parents = {i: names.index(b.parent) if b.parent else -1 for i, b in enumerate(sk.bones)}
    usable = np.array([b.deform and b.heat and b.kind != "cloth" for b in sk.bones])
    heads = np.array([b.head for b in sk.bones])
    tails = np.array([b.tail for b in sk.bones])
    max_share = profile.get("plateMaxShare", 0.12)
    min_thick = profile.get("plateMinThickness", 0.02) * H

    def strays(W):
        """A small loose piece (an eye, a tooth, a chip of rock) that bone heat or the core's
        loose-piece rule handed to a bone it only sits near (a face chip to the upper arm beside
        the head) goes to the nearest bone, unless the two bones are parent and child. Otherwise
        it detaches from the body whenever the two bones move apart."""
        moved = {}
        for c in range(count):
            if sizes[c] > 0.01 * len(V):
                continue
            rows = label == c
            bone = int(np.argmax(W[rows].sum(0)))
            dist = segment_distance(V[rows], heads, tails).mean(0)
            dist[~usable] = np.inf
            nearest = int(np.argmin(dist))
            if nearest == bone or parents.get(bone) == nearest or parents.get(nearest) == bone:
                continue
            if dist[bone] < 1.25 * dist[nearest]:
                continue
            W[rows] = 0.0
            W[rows, nearest] = 1.0
            moved[f"{names[bone]}->{names[nearest]}"] = moved.get(f"{names[bone]}->{names[nearest]}", 0) + int(rows.sum())
        sk.notes["strayPieces"] = moved
        return W

    def plates(W, fixed):
        thick = body.thickness()
        found = {}
        for c in range(count):
            rows = (label == c) & ~fixed
            if sizes[c] > max_share * len(V) or sizes[c] < 12 or not rows.any():
                continue
            # A plate is thick through (a fringe or a moss strand is not) and compact next to the
            # body, so it rides one bone.
            if np.median(thick[rows]) < min_thick or np.ptp(V[rows], axis=0).max() > 0.35 * H:
                continue
            mass = W[rows].sum(0)
            bone = int(np.argmax(mass))
            related = {bone, parents.get(bone, -1)} | {i for i, p in parents.items() if p == bone}
            if sum(mass[i] for i in related if i >= 0) / max(mass.sum(), 1e-9) < 0.6:
                continue
            # The core's rule for loose pieces: heat can hand a plate to a bone it only hangs
            # beside (a thigh plate to the hand); then the nearest bone takes it.
            dist = segment_distance(V[rows], heads, tails).mean(0)
            dist[~usable] = np.inf
            nearest = int(np.argmin(dist))
            if dist[bone] > 2.0 * max(dist[nearest], 1e-9):
                bone = nearest
            W[rows] = 0.0
            W[rows, bone] = 1.0
            fixed |= rows
            found[names[bone]] = found.get(names[bone], 0) + int(rows.sum())
        sk.notes["rigidPlates"] = found
        return W, fixed

    def override(W):
        W, fixed = capes(W) if capes else (W, np.zeros(len(V), bool))
        if W.shape[1] < len(names):
            W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
        W = _foot_blocks(W, sk, V, H)
        W = strays(W)
        if profile.get("rigidByThickness"):
            W, fixed = plates(W, fixed)
        return W, fixed

    return override


def recoil_bones(sk, plan, profile):
    return humanoid.recoil_bones(sk, plan, profile)


# ------------------------------------------------------------------ authored arm layers
@authored.motion("brute_arms")
def brute_arms(spec):
    """Arm takes on the UAL rig (T-pose rest, +X the creature's left) for layering over a UAL body
    clip. The upper arms hang abduct degrees out from vertical and swing fore and aft against the
    legs of the matching UAL gait (Walk_Loop and Jog_Fwd_Loop have the left foot forward and the
    left arm back at frame 0); the forearms flex bend degrees forward and the hands wrist degrees
    more, so long arms carry their fists forward at knee height instead of hanging to the floor.
    Keys are about the T-pose's world axes, where the arms lie along X: a turn about +Z lowers the
    right arm (negative, the left), and a turn about +Y swings the left arm and its forearm and
    hand back (negative, forward) and, on the right arm, forward: one key swings the arms in
    opposition.

    spec: {"base": <UAL donor spec>, "abduct": degrees from vertical, "bend": forearm flex,
    "wrist": hand flex (degrees)}."""
    down = 90.0 - spec.get("abduct", 25.0)
    bend, wrist = spec.get("bend", 45.0), spec.get("wrist", 20.0)

    def arms(take, swing, flex=0.0, lift=None):
        """swing: [(frame, degrees back for the left arm)], the right arm mirrored; flex: extra
        forearm flex; lift: [(frame, extra abduction)] for both arms."""
        lift = dict(lift or [(0, 0.0)])
        at = lambda f: float(np.interp(f, sorted(lift), [lift[k] for k in sorted(lift)]))
        take.key("upperarm_l", [(f, (0.0, a, -(down - at(f)))) for f, a in swing])
        take.key("upperarm_r", [(f, (0.0, a, down - at(f))) for f, a in swing])
        for side, sign in (("l", 1.0), ("r", -1.0)):
            take.key(f"lowerarm_{side}", [(0, (0.0, -sign * (bend + flex), 0.0))])
            take.key(f"hand_{side}", [(0, (0.0, -sign * wrist, 0.0))])
        return take

    idle = arms(authored.Take("Idle", 75, loop=True), [(0, 1.5), (38, -1.5)], 0.0, [(0, 0.0), (38, 2.0)])
    walk = arms(authored.Take("Walk", 40, loop=True), [(0, 14.0), (20, -14.0)])
    run = arms(authored.Take("Run", 28, loop=True), [(0, 20.0), (14, -20.0)], 15.0, [(0, 4.0), (7, 2.0), (14, 4.0), (21, 2.0)])
    hit = arms(authored.Take("Hit", 10), [(0, 0.0), (3, 12.0), (10, 0.0)], 0.0, [(0, 0.0), (3, 10.0), (10, 0.0)])
    return authored.Rig.donor(spec["base"]), [idle, walk, run, hit]
