"""Biped landmarks shared by the upright classes: the torso seed and the head, foot and hand tips.

- Seed: the thickest core point near the midline in the torso band (the intake centres the feet
  on x=0; a big sleeve, a held censer or a shield can be thicker than the torso).
- Head: the highest extremity near the midline (with none, the highest midline core point),
  unless it rises well above the column that
  continues the spine (an antenna, a branch, a horn tip). The column is tracked slab by slab from
  the seed upwards, each slab's piece touching the previous one, and ends where it thins to a
  stalk; its top is then the head. A head lower than the column top (hunched forward below the
  shoulders' hump) keeps its tip.
- Feet: of the low tips on each side, the pair whose medial paths from the head part lowest (at
  the crotch). Knuckles of arms long enough to reach the floor part from the feet at the chest.
- Hands: lateral tips that are not on a leg (their paths leave the feet's above the crotch),
  farthest from the head along the body. Knuckles near the floor count.

All coordinates are glTF: +Y up, the creature faces +Z, +X is the creature's left.
"""
import numpy as np


def path_nodes(pred, end):
    out = []
    while end >= 0:
        out.append(int(end))
        end = pred[end]
    return out[::-1]


def fork(a, b):
    """Index of the last node two root-first node paths share."""
    k = 0
    while k < min(len(a), len(b)) and a[k] == b[k]:
        k += 1
    return k - 1


def torso_seed(body):
    H = body.height
    x = body.origin[0] + (np.arange(body.dt.shape[0]) + 0.5) * body.h
    y = body.origin[1] + (np.arange(body.dt.shape[1]) + 0.5) * body.h - body.min[1]
    torso = (np.abs(x) < 0.1 * H)[:, None, None] & ((y > 0.45 * H) & (y < 0.85 * H))[None, :, None]
    return body.to_world(np.unravel_index(np.argmax(np.where(torso, body.dt, -1)), body.dt.shape))


def spine_column(body, seed, window=0.1, stalk=0.1):
    """The core column above the seed: per slab, the piece that touches the previous slab's piece.
    Ends where no piece continues it, or where it narrows to a stalk (a slab under stalk times
    the largest slab of the last window x height). Returns [(y, centroid xz, voxel count)]."""
    H = body.height
    out = []
    prev_pts = None
    prev_c = np.asarray(seed, float)[[0, 2]]
    y = float(seed[1])
    while y < body.max[1] + body.h:
        comps = body.slab(y)
        if not comps:
            break
        if prev_pts is None:
            pick = min(comps, key=lambda c: np.min(np.linalg.norm(c["points"] - prev_c, axis=1)))
        else:
            touching = [c for c in comps if _touches(c["points"], prev_pts, 1.5 * body.h)]
            if not touching:
                break
            pick = max(touching, key=lambda c: c["count"])
        recent = [n for yy, _, n in out if yy >= y - window * H]
        if recent and pick["count"] < stalk * max(recent):
            break
        out.append((y, pick["centroid"], pick["count"]))
        prev_pts = pick["points"]
        y += body.h
    return out


def _touches(a, b, reach):
    from scipy.spatial import cKDTree

    d, _ = cKDTree(b).query(a, distance_upper_bound=reach)
    return bool(np.isfinite(d).any())


def biped_tips(body, legs=True):
    """Returns {seed, ext, dist, pred, head, feet{l,r}, hands{l,r}, head_dist, head_pred, notes}.
    head, feet and hands are entries of ext ({node, position, distance})."""
    H = body.height
    seed = torso_seed(body)
    ext, dist, pred = body.extremities(seed, 0.07 * H, 0.12 * H)
    ext = list(ext)
    world = body.to_world(body.nodes)
    pos = lambda e: e["position"]
    notes = {}

    # ------------------------------------------------------------- head
    central = [e for e in ext if abs(pos(e)[0] - seed[0]) < 0.15 * H and pos(e)[1] > seed[1]]
    column = spine_column(body, seed)
    col_top = None
    if column:
        y_top, c_top, _ = column[-1]
        col_top = np.array([c_top[0], y_top, c_top[1]])
    if not central:
        # Antlers, horns or a crest split the crown into side tips: the head top is then the
        # highest core point on the midline above the torso.
        mid = np.nonzero(np.abs(world[:, 0] - seed[0]) < 0.08 * H)[0]
        top = int(mid[np.argmax(world[mid, 1])])
        central = [{"node": top, "position": world[top], "distance": float(dist[top])}]
        ext.append(central[0])
        notes["headFromMidline"] = world[top].tolist()
    head = max(central, key=lambda e: pos(e)[1])
    if col_top is not None and pos(head)[1] - col_top[1] > 0.08 * H:
        # The highest midline tip is off the spine's column (an antenna, a branch, a horn) or
        # there is none: the column's top is the head.
        node = body.nearest_node(col_top)
        notes["headFromColumn"] = {"replaced": pos(head).tolist(), "top": col_top.tolist()}
        head = {"node": node, "position": world[node], "distance": float(dist[node])}
        ext.append(head)
    others = [e for e in ext if e is not head]
    head_dist, head_pred = body.geodesic(pos(head))
    from_head = {id(e): path_nodes(head_pred, e["node"]) for e in others}

    # ------------------------------------------------------------- feet
    feet = {}
    crotch_y = None
    if legs:
        low = [e for e in others if pos(e)[1] < 0.15 * H and np.isfinite(head_dist[e["node"]])]
        sides = {s: [e for e in low if sign * (pos(e)[0] - seed[0]) > 0.02 * H] for s, sign in (("l", 1), ("r", -1))}
        for s in sides:
            if not sides[s]:
                raise RuntimeError(f"no {s} foot tip found; set legs:false for a floating body")
        # The feet are the pair whose paths from the head part lowest: legs part at the crotch,
        # an arm from a leg (or from the other arm) at the chest.
        pairs = [(world[from_head[id(a)][fork(from_head[id(a)], from_head[id(b)])]][1], a, b)
                 for a in sides["l"] for b in sides["r"]]
        crotch_y = min(p[0] for p in pairs)
        keep = [p for p in pairs if p[0] <= crotch_y + 0.05 * H]
        for s, k in (("l", 1), ("r", 2)):
            cands = list({id(p[k]): p[k] for p in keep}.values())
            feet[s] = max(cands, key=lambda e: pos(e)[2] - pos(e)[1])
        kept = {id(p[k]) for p in keep for k in (1, 2)}
        dropped = [pos(e).tolist() for e in low if id(e) not in kept]
        if dropped:
            notes["notFeet"] = dropped
        notes["crotchFork"] = float(crotch_y)

    # ------------------------------------------------------------ hands
    def on_leg(e):
        # A tip whose path from the head leaves a foot's below the crotch (a heel, a second toe)
        # or just above it (a tail, a hem corner) hangs off the lower body.
        return any(world[from_head[id(e)][fork(from_head[id(e)], from_head[id(f)])]][1] < crotch_y + 0.1 * H
                   for f in feet.values())

    hands = {}
    for side, sign in (("l", 1), ("r", -1)):
        lateral = [e for e in others if e not in feet.values() and sign * pos(e)[0] > 0.1 * H and np.isfinite(head_dist[e["node"]])]
        cands = [e for e in lateral if pos(e)[1] > 0.2 * H]
        if legs:
            # Knuckles of floor-length arms: tips near the floor that are not feet and not on a leg.
            knuckles = [e for e in lateral if pos(e)[1] <= 0.1 * H and not on_leg(e)]
            if knuckles:
                notes.setdefault("lowHands", {})[side] = [pos(e).tolist() for e in knuckles]
                cands += knuckles
        if not cands:
            raise RuntimeError(f"no {side} hand tip found")
        reach = max(sign * pos(e)[0] for e in cands)
        cands = [e for e in cands if sign * pos(e)[0] >= 0.6 * reach]
        hands[side] = max(cands, key=lambda e: head_dist[e["node"]])
    return {"seed": seed, "ext": ext, "dist": dist, "pred": pred, "head": head, "feet": feet, "hands": hands,
            "head_dist": head_dist, "head_pred": head_pred, "notes": notes}

