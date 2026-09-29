"""Bird class: ground birds and waders (bustards, fowl, quail, herons).

The skeleton follows the animal-pack Chicken, the primary donor, bone for bone:

  root, pelvis (the body hub), spine_01 and spine_02 (the breast, rigid with the hub), neck_01 to
  neck_03 and head (an S-neck of three links and the skull with its beak), tail_01 and tail_02 (the
  rump and a rigid tail fan), wing_<side>_01/02 (folded wings, no donor), and per side thigh (the
  feathered drumstick, hip to heel), tarsus (the bare shank, heel to the toe base), foot (the toes
  to their middle joint) and toe (the front toe).

The visible leg of a bird is its tibiotarsus and tarsometatarsus: the femur lies inside the body
contour, and the chicken rig has no femur either, so the leg is a two-link IK chain whose middle
joint is the reversed ankle (the heel points backwards). The neck is solved like a leg towards
the chicken's scaled head path, which carries the walking head-bob onto necks of any length.
Folded wings ride the hub as a very stiff spring chain.

Joints are measured on the mesh. Legs are traced upwards from the feet through filled horizontal
sections of the surface (thin wader legs vanish from the voxel core), and the heel is the corner
of that trace, or the point where the shank thickens into the drumstick when the leg is straight.
The neck and head sit on the medial path from the body to the beak tip: the head joint is where
the neck narrows behind the skull, the neck base is where the path leaves the body bulk.

Profile keys (bird.donors.json): strideScale (times the leg-length ratio: the size ratio for hips
and foot and head paths), hipMotion, neckIk (default true), wings (default true), rigidPieces. The donor "chicken_reach"
is the same rig with the neck base unmapped: that drops the neck IK for the peck (Eat frames 1-20
spliced to 214-230, a 4 degree seam) and the fall, whose scaled head paths would bury the beak.
"""
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from crlib.body import resample
from crlib.mathx import normalize
from crlib.skeleton import Skeleton

NAME = "bird"

C = "Chicken_"
DONOR = {
    "root": "MAINSHJnt", "pelvis": "ROOTSHJnt",
    "spine_01": "Chest_01_01SHJnt", "spine_02": "Chest_01_02SHJnt",
    "neck_01": "Chest_01_03SHJnt", "neck_02": "Neck_01_01SHJnt", "neck_03": "Neck_01_02SHJnt", "head": "Neck_01_03SHJnt",
    "tail_01": "Tail_01_01SHJnt", "tail_02": "Tail_01_02SHJnt",
    **{f"{ours}_{s}": f"{s}_Leg_{theirs}SHJnt" for s in ("l", "r")
       for ours, theirs in (("thigh", "Hip"), ("tarsus", "Knee"), ("foot", "Ankle"), ("toe", "Ball"))},
}


def _d(name):
    return C + DONOR[name]


def _surface_samples(body, count=150000, seed=0):
    """Area-uniform points on the surface plus the vertices, so thin parts are sampled densely."""
    V, F = body.verts, body.faces
    tri = V[F]
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    rng = np.random.default_rng(seed)
    k = rng.choice(len(F), size=count, p=area / area.sum())
    u, v = rng.random(count), rng.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    t = tri[k]
    return np.vstack([V, t[:, 0] + u[:, None] * (t[:, 1] - t[:, 0]) + v[:, None] * (t[:, 2] - t[:, 0])])


class _Sections:
    """Filled horizontal cross-sections of the surface: each connected piece of the slab at height y
    as a set of xz cells, with its centroid and area. A leg is its own piece until it enters the
    body, whose filled section then contains it."""

    def __init__(self, body):
        self.P = _surface_samples(body)
        self.H = body.height
        self.cell = self.H / 220
        self.dy = self.H / 120
        self.lo = self.P[:, [0, 2]].min(0) - 3 * self.cell
        self.shape = np.ceil((self.P[:, [0, 2]].max(0) - self.lo) / self.cell).astype(int) + 6

    def at(self, y):
        band = self.P[np.abs(self.P[:, 1] - y) <= self.dy / 2]
        grid = np.zeros(self.shape, bool)
        ij = np.floor((band[:, [0, 2]] - self.lo) / self.cell).astype(int)
        grid[ij[:, 0], ij[:, 1]] = True
        grid = ndimage.binary_fill_holes(ndimage.binary_dilation(grid, iterations=1))
        labels, count = ndimage.label(grid, structure=np.ones((3, 3)))
        out = []
        for k in range(1, count + 1):
            xz = self.lo + (np.argwhere(labels == k) + 0.5) * self.cell
            out.append({"xz": xz, "c": xz.mean(0), "area": len(xz) * self.cell ** 2, "x0": xz[:, 0].min(), "x1": xz[:, 0].max()})
        return out


def _trace_leg(sections, sign, mid_x):
    """Leg sections from the sole up to where the leg enters the body: [(y, centroid xz, area)]."""
    H, P = sections.H, sections.P
    side = P[sign * (P[:, 0] - mid_x) > 0.02 * H]
    # Start above the toes: separate thin toes do not trace as one leg.
    y = side[:, 1].min() + max(sections.dy, 0.04 * H)
    trace = []
    prev = None
    while y < 0.9 * H:
        comps = sections.at(y)
        spans = lambda c: c["x0"] < mid_x < c["x1"]
        if prev is None:
            mine = [c for c in comps if sign * (c["c"][0] - mid_x) > 0 and not spans(c)]
            if not mine:
                y += sections.dy
                continue
            xz = np.vstack([c["xz"] for c in mine])
            comp = {"xz": xz, "c": xz.mean(0), "area": len(xz) * sections.cell ** 2, "x0": xz[:, 0].min(), "x1": xz[:, 0].max()}
        else:
            # Near the sole the toes of both feet can meet under the body; only above the feet
            # does a section across the midline mean the leg has entered the body.
            low = y < side[:, 1].min() + 0.08 * H
            pool = [c for c in comps if not (low and spans(c))]
            if not pool:
                y += sections.dy / 2
                continue
            gap = lambda c: cKDTree(prev_xz).query(c["xz"])[0].min()
            comp = min(pool, key=gap)
            if gap(comp) > 0.03 * H:
                break
            if spans(comp):
                break
        trace.append((y, comp["c"], comp["area"]))
        prev, prev_xz = comp["c"], comp["xz"]
        y += sections.dy / 2
    if len(trace) < 8:
        raise RuntimeError(f"leg trace on side {sign:+d} is too short ({len(trace)} sections)")
    return trace


def _leg_joints(trace, sections, sign, mid_x, donor):
    """Hip, heel, ankle, ball and toe tip of one leg from its trace."""
    H, P = sections.H, sections.P
    ys = np.array([t[0] for t in trace])
    cs = np.array([t[1] for t in trace])
    areas = np.array([t[2] for t in trace])
    pts = np.column_stack([cs[:, 0], ys, cs[:, 1]])
    shank = float(np.median(np.sort(areas)[: max(3, int(0.4 * len(areas)))]))
    # Ankle: going up from the sole, where the section has narrowed from the toes to the shank.
    ai = next((i for i in range(len(areas)) if areas[i] <= 2.2 * shank and ys[i] > ys[0] + 0.02 * H), len(areas) // 5)
    top = len(pts) - 1
    ankle, entry = pts[ai], pts[top]
    # Heel: the backward corner between the ankle and the body; a straight leg has none, and the
    # heel is then where the bare shank thickens into the drumstick.
    chord = entry - ankle
    rel = pts[ai:top + 1] - ankle
    t = np.clip(rel @ chord / max(chord @ chord, 1e-12), 0, 1)
    off = rel - t[:, None] * chord
    # A sculpted leg can bow slightly forward at the heel; the corner is the heel either way.
    back = np.abs(off[:, 2])
    hk = int(np.argmax(back))
    how = "corner" if off[hk, 2] < 0 else "forward corner"
    if back[hk] < 0.012 * H or not (0.15 < t[hk] < 0.85):
        above = [i for i in range(ai, top) if areas[i] >= 1.35 * shank and ys[i] > ankle[1] + 0.2 * (entry[1] - ankle[1])]
        if above:
            hk = above[0] - ai
            how = "thickening"
        else:
            d = [donor.rest_head[_d(n)] for n in ("thigh_l", "tarsus_l", "foot_l")]
            f = np.linalg.norm(d[2] - d[1]) / (np.linalg.norm(d[1] - d[0]) + np.linalg.norm(d[2] - d[1]))
            hk = int(np.argmin(np.abs(ys[ai:top + 1] - (ankle[1] + f * (entry[1] - ankle[1])))))
            how = "donor ratio"
    heel = pts[ai + hk]
    # The drumstick continues inside the body contour: the hip joint (the bird's hidden knee) lies
    # on its line a third of its visible length further in.
    hip = entry + 0.35 * (entry - heel)
    # Toes: the most forward point of this foot; the ball sits at the middle toe joint.
    foot = P[(sign * (P[:, 0] - mid_x) > 0.02 * H) & (P[:, 1] < ankle[1]) & (np.linalg.norm(P[:, [0, 2]] - ankle[[0, 2]], axis=1) < 0.35 * H)]
    tip = foot[int(np.argmax(foot[:, 2]))].copy()
    ball = ankle + 0.6 * (tip - ankle)
    ball[1] = max(0.25 * ankle[1], 0.004 * H)
    tip[1] = ball[1]
    return {"hip": hip, "heel": heel, "ankle": ankle, "ball": ball, "toe": tip, "entry": entry, "heelBy": how,
            "shankArea": shank}


def _path_index(radius, start, stop, test):
    step = 1 if stop >= start else -1
    for i in range(start, stop + step, step):
        if test(i):
            return i
    return None


def fit(body, donor, profile, source=None):
    H = body.height
    V = body.verts
    mid_x = 0.5 * (V[:, 0].min() + V[:, 0].max())
    seed = body.to_world(np.unravel_index(np.argmax(body.dt), body.dt.shape))
    ext, dist, pred = body.extremities(seed, 0.05 * H, 0.1 * H)
    pos = lambda e: e["position"]
    notes = {"seed": seed.tolist()}

    # ---------------------------------------------------------------- legs
    sections = _Sections(body)
    leg = {}
    for side, sign in (("l", 1), ("r", -1)):
        trace = _trace_leg(sections, sign, mid_x)
        leg[side] = _leg_joints(trace, sections, sign, mid_x, donor)
    notes["legs"] = {s: {k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in g.items()} for s, g in leg.items()}
    hips_y = np.mean([leg[s]["hip"][1] for s in leg])
    hips_z = np.mean([leg[s]["hip"][2] for s in leg])

    # ---------------------------------------------------------- neck and head
    upper = [e for e in ext if pos(e)[1] > max(hips_y, 0.35 * H)]
    beak = max(upper, key=lambda e: pos(e)[2])
    path, length = resample(body.path(pred, beak["node"]), 100)
    step = length / 100
    r = np.array([body.radius_at(p) for p in path])
    r_seed = r[0]
    # Beak base: walking back from the tip, where the section reaches the skull's size.
    head_r = r[60:].max()
    b = _path_index(r, 100, 0, lambda i: r[i] >= 0.65 * head_r)
    # Neck base: where the path leaves the body bulk.
    nb = _path_index(r, 0, b, lambda i: r[i] < 0.5 * r_seed) or int(0.4 * b)
    window = max(4, int(round(0.2 * H / step)))
    s = int(np.argmax(r[max(b - window, nb):b + 1])) + max(b - window, nb)
    m = int(np.argmin(r[nb:s + 1])) + nb
    if r[s] > 1.15 * r[m]:
        # A neck that narrows behind the skull: the head joint is where it starts to widen.
        threshold = r[m] + 0.35 * (r[s] - r[m])
        hj = _path_index(r, s, m, lambda i: r[i] <= threshold)
        how = "narrowing"
    else:
        skull = r[max(b - 8, 0):b + 1].max()
        hj = max(nb + 2, b - int(round(1.5 * skull / step)))
        how = "skull size"
    # A neck hidden in plumage (quail, partridge) still needs room for its three links.
    skull = r[max(b - 8, 0):b + 1].max()
    nb = min(nb, hj - int(round(1.5 * skull / step)))
    nb = max(nb, 1)
    head_joint, neck_base = path[hj], path[nb]
    notes["neck"] = {"beakTip": pos(beak).tolist(), "beakBase": path[b].tolist(), "headJoint": head_joint.tolist(),
                     "neckBase": neck_base.tolist(), "headBy": how}

    # ------------------------------------------------------------- torso
    # The pelvis (hub) is at the body's vertical middle above the hips.
    column = body.core_points()
    col = column[(np.abs(column[:, 2] - hips_z) < 0.04 * H) & (np.abs(column[:, 0] - mid_x) < 0.06 * H) & (column[:, 1] > hips_y - 0.05 * H)]
    lo_y, hi_y = (col[:, 1].min(), col[:, 1].max()) if len(col) else (hips_y, hips_y + 0.2 * H)
    pelvis = np.array([mid_x, max(0.5 * (lo_y + hi_y), hips_y + 0.03 * H), hips_z])
    # The breast rises from the hub to the neck base in the donor's proportions.
    hub, c1, c2, c3 = (donor.rest_head[_d(n)] for n in ("pelvis", "spine_01", "spine_02", "neck_01"))
    seg = np.array([np.linalg.norm(c1 - hub), np.linalg.norm(c2 - c1), np.linalg.norm(c3 - c2)])
    f1, f2 = seg[0] / seg.sum(), seg[:2].sum() / seg.sum()
    spine_01 = pelvis + f1 * (neck_base - pelvis)
    spine_02 = pelvis + f2 * (neck_base - pelvis)
    # Neck links along the medial path, in the donor's proportions.
    n = [donor.rest_head[_d(k)] for k in ("neck_01", "neck_02", "neck_03", "head")]
    nseg = np.array([np.linalg.norm(n[i + 1] - n[i]) for i in range(3)])
    neck_pts, _ = resample(path[nb:hj + 1], 100)
    neck_02 = neck_pts[int(round(100 * nseg[0] / nseg.sum()))]
    neck_03 = neck_pts[int(round(100 * nseg[:2].sum() / nseg.sum()))]

    # -------------------------------------------------------------- tail
    back = [e for e in ext if pos(e)[1] > hips_y and pos(e)[2] < pelvis[2] - 0.15 * H]
    tail = None
    if back:
        far = min(pos(e)[2] for e in back)
        tips = [pos(e) for e in back if pos(e)[2] < far + 0.08 * H]
        tip_node = min(back, key=lambda e: pos(e)[2])["node"]
        tpath, _ = resample(body.path(pred, tip_node), 100)
        tr = np.array([body.radius_at(p) for p in tpath])
        tb = _path_index(tr, 0, 100, lambda i: tr[i] < 0.5 * r_seed) or 60
        rump = _path_index(tr, 0, tb, lambda i: tr[i] < 0.85 * r_seed) or tb // 2
        tip = np.mean(tips, axis=0)
        tip[0] = mid_x
        tail = {"rump": tpath[rump], "base": tpath[tb], "tip": tip}
        notes["tail"] = {k: v.tolist() for k, v in tail.items()}

    # ------------------------------------------------------------- wings
    # Folded wings lie along the flanks from the shoulder to the rump. They get their own bones so
    # the flank feathers ride the body rather than the drumsticks under them.
    wings = {}
    if profile.get("wings", True) and tail:
        def half_width(p):
            comps = body.slab(p[1])
            if not comps:
                return 0.1 * H
            c = min(comps, key=lambda c: np.linalg.norm(c["centroid"] - p[[0, 2]]))
            row = c["points"][np.abs(c["points"][:, 1] - p[2]) < 1.5 * body.h]
            return 0.5 * np.ptp(row[:, 0]) if len(row) else 0.5 * (c["max"][0] - c["min"][0])
        shoulder_c = spine_02 + 0.5 * (neck_base - spine_02)
        rump_c = tail["rump"]
        mid_c = 0.5 * (shoulder_c + rump_c)
        for side, sign in (("l", 1), ("r", -1)):
            pts = []
            for c in (shoulder_c, mid_c, rump_c):
                q = c.copy()
                q[0] = mid_x + sign * 0.7 * half_width(c)
                pts.append(q)
            wings[side] = pts
        notes["wings"] = {k: [p.tolist() for p in v] for k, v in wings.items()}

    # ---------------------------------------------------------- assemble
    sk = Skeleton()
    root_head = np.array([pelvis[0], 0.0, pelvis[2]])
    sk.add("root", None, root_head, root_head + [0, 0.1 * H, 0], donor=_d("root"), follow=0.0, kind="root")
    sk.add("pelvis", "root", pelvis, spine_01, donor=_d("pelvis"), follow=0.0)
    # The breast is one rigid mass with the hub: the chicken's chest links are the base of its
    # neck, and bending a long breast by their angles folds the front of the body into the floor.
    # The neck links still take the donor's world orientation, so the head goes where it should.
    sk.add("spine_01", "pelvis", spine_01, spine_02, donor=None, follow=0.0)
    sk.add("spine_02", "spine_01", spine_02, neck_base, donor=None, follow=0.0)
    sk.add("neck_01", "spine_02", neck_base, neck_02, donor=_d("neck_01"), follow=0.0)
    sk.add("neck_02", "neck_01", neck_02, neck_03, donor=_d("neck_02"), follow=0.0)
    sk.add("neck_03", "neck_02", neck_03, head_joint, donor=_d("neck_03"), follow=0.0)
    sk.add("head", "neck_03", head_joint, pos(beak), donor=_d("head"), follow=0.0)
    if tail:
        sk.add("tail_01", "pelvis", tail["rump"], tail["base"], donor=_d("tail_01"), follow=0.0, kind="tail")
        sk.add("tail_02", "tail_01", tail["base"], tail["tip"], donor=_d("tail_02"), follow=0.0, kind="tail")
    for side, pts in wings.items():
        # No donor has wings: they are carried by the hub and lag a little as a stiff spring.
        sk.add(f"wing_{side}_01", "pelvis", pts[0], pts[1], donor=None, follow=0.0, kind="wing")
        sk.add(f"wing_{side}_02", f"wing_{side}_01", pts[1], pts[2], donor=None, follow=0.0, kind="wing")
    for side in ("l", "r"):
        g = leg[side]
        sk.add(f"thigh_{side}", "pelvis", g["hip"], g["heel"], donor=_d(f"thigh_{side}"), follow=1.0, kind="leg")
        sk.add(f"tarsus_{side}", f"thigh_{side}", g["heel"], g["ankle"], donor=_d(f"tarsus_{side}"), follow=1.0, kind="leg")
        # Toes add the donor's motion to their own rest, so toes flat on the ground at rest are
        # flat when the donor's are.
        sk.add(f"foot_{side}", f"tarsus_{side}", g["ankle"], g["ball"], donor=_d(f"foot_{side}"), follow=0.0, kind="leg")
        sk.add(f"toe_{side}", f"foot_{side}", g["ball"], g["toe"], donor=_d(f"toe_{side}"), follow=0.0, kind="leg")
    # The size ratio the retargeter scales hips and foot paths by: the leg-length ratio, times the
    # profile's strideScale (the chicken walks in a deep crouch with long steps; a bustard or a
    # heron walks upright with shorter ones).
    d = [donor.rest_head[_d(n)] for n in ("thigh_l", "tarsus_l", "foot_l")]
    donor_leg = np.linalg.norm(d[1] - d[0]) + np.linalg.norm(d[2] - d[1])
    target_leg = np.mean([np.linalg.norm(leg[s]["heel"] - leg[s]["hip"]) + np.linalg.norm(leg[s]["ankle"] - leg[s]["heel"]) for s in leg])
    sk.leg_entry = {s: float(leg[s]["entry"][1]) for s in leg}
    sk.stride_scale = float(profile.get("strideScale", 1.0) * target_leg / donor_leg)
    notes["legRatio"] = float(target_leg / donor_leg)
    return sk, notes


def plan(sk, body, profile):
    from crlib.retarget import CapsuleCollider

    legs = [{"chain": [f"thigh_{s}", f"tarsus_{s}"], "foot": f"foot_{s}", "toe": f"toe_{s}", "pivot": 1} for s in ("l", "r")]
    if profile.get("neckIk", True):
        # The head-bob: a walking bird holds its head still in the world and then thrusts it
        # forward. Copying the chicken's neck angles onto a neck of other proportions loses that, so
        # the neck is solved like a leg towards the chicken's scaled head path (the head keeps the
        # donor's orientation).
        legs.append({"chain": ["neck_01", "neck_02", "neck_03"], "foot": "head", "toe": None, "pivot": 1})
    colliders = []
    for bone in ["thigh_l", "thigh_r", "tarsus_l", "tarsus_r", "pelvis", "spine_01"]:
        b = sk[bone]
        colliders.append(CapsuleCollider(sk, bone, 0.95 * body.radius_at(0.5 * (b.head + b.tail)) + body.h))
    chains = []
    for side in ("l", "r"):
        wing = [b.name for b in sk.bones if b.kind == "wing" and b.name.startswith(f"wing_{side}")]
        if wing:
            chains.append({"bones": wing, "stiffness": 400.0, "damping": 30.0, "gravity": 0.0, "hang": 0.0, "clearance": 0.0})
    return {"hips": "pelvis", "legs": legs, "chains": chains, "colliders": colliders,
            "hip_motion": profile.get("hipMotion", 1.0), "scale": getattr(sk, "stride_scale", None)}


def cloth(body, sk, profile, heat):
    """No sheets on a bird; this hook only rescues the weights when Blender's bone heat fails.

    Bone heat finds no solution on meshes built from many loose, open pieces (the sculpted heron's
    feathers and leg rings), and returns no weight at all. The rows heat left empty then get
    distance weights: each vertex goes to its nearest bone and blends towards the next ones over a
    band that widens with its distance from the skeleton. Loose pieces are made rigid by the skin
    step as usual."""
    from crlib.skin import segment_distance

    empty = heat.sum(1) < 1e-6
    if empty.mean() < 0.5:
        return None
    # What heat did solve on such a mesh is not trustworthy either: weight every row.
    empty[:] = True
    bones = [i for i, b in enumerate(sk.bones) if b.deform and b.heat and b.kind != "root"]
    heads = np.array([sk.bones[i].head for i in bones])
    tails = np.array([sk.bones[i].tail for i in bones])
    V = body.verts[empty]
    d = segment_distance(V, heads, tails)
    # A leg bone takes only the leg: its hip joint sits just under the belly, and the body's
    # underside (and the feathers on it) must stay with the body.
    # Above the point where the leg enters the body, the body's own surface and the feathers on
    # it stay with the body.
    raw = d.copy()
    entry = getattr(sk, "leg_entry", {})
    for k, i in enumerate(bones):
        name = sk.bones[i].name
        if name.split("_")[0] in ("thigh", "tarsus"):
            top = entry.get(name[-1], np.inf) - 0.005 * body.height
            d[:, k] = np.where((d[:, k] < 0.04 * body.height) & (V[:, 1] < top), d[:, k], np.inf)
    # Toes (below the ankles) belong to the foot and toe bones only, and a whole loose toe goes to
    # the foot it grows from (an inner toe can reach across the midline).
    from scipy.sparse.csgraph import connected_components
    from crlib.skin import adjacency

    _, piece = connected_components(adjacency(len(body.verts), body.faces), directed=False)
    piece = piece[empty]
    ankles = {s: sk[f"foot_{s}"].head for s in ("l", "r")}
    reach = {s: np.linalg.norm(V - a, axis=1) for s, a in ankles.items()}
    owner = {}
    for c in np.unique(piece):
        rows_c = piece == c
        owner[c] = min(ankles, key=lambda s: reach[s][rows_c].min())
    owner_of = np.array([owner[c] for c in piece])
    for side in ("l", "r"):
        foot = sk[f"foot_{side}"]
        below = V[:, 1] < foot.head[1] + 0.005 * body.height
        mine = below & (owner_of == side)
        for k, i in enumerate(bones):
            if sk.bones[i].name not in (f"foot_{side}", f"toe_{side}"):
                d[mine, k] = np.inf
    lost = ~np.isfinite(d).any(1)
    d[lost] = raw[lost]
    near = d.min(1, keepdims=True)
    band = 0.35 * near + 0.01 * body.height
    w = np.nan_to_num(np.clip(1.0 - (d - near) / band, 0.0, 1.0) ** 2)
    rows = np.zeros((len(V), heat.shape[1]))
    rows[:, bones] = w / w.sum(1, keepdims=True)
    # Loose pieces (feathers, leg scales, claws) move as one: each goes wholly to the bone that
    # holds most of it. This is done here rather than by the skin step's rigid pass, which would
    # hand the belly feathers to the thighs beside them (set "rigidPieces": false with this).
    counts = np.bincount(piece)
    for c in np.unique(piece):
        rows_c = np.nonzero(piece == c)[0]
        if counts[c] > 0.08 * len(piece):
            continue
        mass = rows[rows_c].sum(0)
        top = int(np.argmax(mass))
        if mass[top] >= 0.7 * mass.sum():
            rows[rows_c] = 0.0
            rows[rows_c, top] = 1.0
    heat[empty] = rows
    sk.heat_fallback = float(empty.mean())
    return None
