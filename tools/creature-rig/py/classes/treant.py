"""Treant class: bark and root bipeds (treants, saplings, sporekin, the fae garden guardians) on
the golem skeleton. The fit, the foot blocks, the heel pivot and the rigid bark plates are the
golem class's; this module owns the treants' donor map (treant.donors.json), so their attack is a
studio smash chosen for a tree body instead of the golem's claw or a boxer's punch.

Loose pieces ride what they grow from. A treant carries many small separate pieces: leaves on the
shoulders, drips under a mushroom cap, fronds on the back, shelf fungi on the stalk. Bone heat and
the golem's stray rule hand such a piece to the bone segment nearest to it, which for a drip
under a wide cap or a frond beside the shoulder is an arm bone: the piece then flies off with
the arm. Here every loose piece up to attachMaxShare of the mesh instead takes the weights of the
body vertex it touches or hangs closest to (profile "attachPieces", default on), and profile
"pieceBones" ([{"at": [x, y, z], "bone": name}], bind space) binds the piece nearest a point
rigidly to a named bone, for a piece that touches nothing it belongs to (a leaf floating beside
the antlers). Afterwards everything low around each foot moves to the foot (_root_feet), so a root
tendril that touches the shin does not sink with it.
"""
import numpy as np
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from classes import golem
from crlib.body import resample
from crlib.skin import adjacency

NAME = "treant"

fit = golem.fit
bind_turns = golem.bind_turns
recoil_bones = golem.recoil_bones


def _attach(W, fixed, body, sk, profile, own=None):
    """own: vertices that already have their own chain (a skirt, a frond); they anchor the small
    pieces that touch them (a flake lying on a leaf) and are never re-weighted here."""
    V = body.verts
    count, label = connected_components(adjacency(len(V), body.faces), directed=False)
    sizes = np.bincount(label, minlength=count)
    small = sizes <= profile.get("attachMaxShare", 0.12) * len(V)
    if own is not None:
        small[np.unique(label[own])] = False
    anchor = ~small[label]
    if not anchor.any():
        anchor = label == int(np.argmax(sizes))
    tree = cKDTree(V[anchor])
    anchor_idx = np.nonzero(anchor)[0]
    names = sk.names()
    found = {}
    for c in np.nonzero(small)[0]:
        rows = np.nonzero(label == c)[0]
        dist, near = tree.query(V[rows])
        a = anchor_idx[near[int(np.argmin(dist))]]
        W[rows] = W[a]
        fixed[rows] = True
        bone = names[int(np.argmax(W[a]))]
        found[bone] = found.get(bone, 0) + len(rows)
    for spec in profile.get("pieceBones", []):
        at = np.asarray(spec["at"], float)
        c = label[int(np.argmin(np.linalg.norm(V - at, axis=1)))]
        rows = label == c
        W[rows] = 0.0
        W[rows, names.index(spec["bone"])] = 1.0
        fixed |= rows
        found[f"{spec['bone']} (given)"] = int(rows.sum())
    sk.notes["attachedPieces"] = found
    return W, fixed


def _root_feet(W, sk, V, H, profile):
    """Everything low around each foot rides the foot. The golem's foot block reaches up to 1.4
    times the ankle height, but a root foot splays from the floor and its fit puts the ankle on
    the sole, so root tendrils a hand's width up the shin stay on the calf (or took the calf's
    weights as an attached piece) and sink through the floor at every shin turn. Calf and thigh
    weight moves to the foot below profile "rootFootHeight" (share of the height, default 0.07),
    blended over the top 40% of that band."""
    names = sk.names()
    ankles = {s: np.array(sk.notes.get("ankles", {}).get(s, sk[f"foot_{s}"].head)) for s in ("l", "r") if f"foot_{s}" in sk}
    hi = profile.get("rootFootHeight", 0.07) * H
    for side, ankle in ankles.items():
        other = ankles.get("r" if side == "l" else "l", ankle + [1e3, 0, 0])
        flat = np.linalg.norm(V[:, [0, 2]] - ankle[[0, 2]], axis=1)
        mine = (flat < np.linalg.norm(V[:, [0, 2]] - other[[0, 2]], axis=1)) & (flat < 0.25 * H)
        t = np.clip((hi - V[:, 1]) / (0.4 * hi), 0, 1) * mine
        t = t * t * (3 - 2 * t)
        f = names.index(f"foot_{side}")
        for leg in (f"calf_{side}", f"thigh_{side}"):
            k = names.index(leg)
            move = W[:, k] * t
            W[:, k] -= move
            W[:, f] += move
    return W


def _pieces(body):
    count, label = connected_components(adjacency(len(body.verts), body.faces), directed=False)
    return label, np.bincount(label, minlength=count)


def _hat_weights(t, links):
    """Weights of the links of a chain for points at fraction t (0 at the root, 1 at the tip):
    hat functions on the link midpoints, so the sheet bends smoothly between links."""
    centres = (np.arange(links) + 0.5) / links
    w = np.clip(1 - np.abs(t[:, None] - centres[None, :]) * links, 0, 1)
    w[t < centres[0], 0] = 1.0
    w[t > centres[-1], -1] = 1.0
    return w / np.maximum(w.sum(1, keepdims=True), 1e-9)


def _seam_release(body, rows, band):
    """0 where a sheet joins the rest of the surface, rising to 1 over the band (metres, and at
    least three edge rings) along the surface. A loose sheet is 1 everywhere."""
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra

    V, F = body.verts, body.faces
    sheet = np.zeros(len(V), bool)
    sheet[rows] = True
    e = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e = e[sheet[e[:, 0]] | sheet[e[:, 1]]]
    joined = np.unique(np.concatenate([e[~sheet[e[:, 0]], 0], e[~sheet[e[:, 1]], 1]]))
    if not len(joined):
        return np.ones(len(rows))
    length = np.maximum(np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1), 1e-9)
    ij = (np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]]))
    G = csr_matrix((np.concatenate([length, length]), ij), shape=(len(V), len(V)))
    dist = dijkstra(G, directed=False, indices=joined, min_only=True)
    hops = dijkstra(G.astype(bool).astype(float), directed=False, indices=joined, min_only=True)
    t = np.minimum(np.clip(dist[rows] / max(band, 1e-6), 0, 1), np.clip(hops[rows] / 3.0, 0, 1))
    return t * t * (3 - 2 * t)


def _skirt_rows(body, sk, spec, label):
    """The skirt's vertices: the loose pieces nearest the given points ("pieces"), and/or the
    surface between "top" and "bottom" (shares of the height) clear of the legs by "legClear"
    times their radius."""
    V = body.verts
    rows = np.zeros(len(V), bool)
    for at in spec.get("pieces", []):
        rows |= label == label[int(np.argmin(np.linalg.norm(V - np.asarray(at, float), axis=1)))]
    if "top" in spec:
        band = (V[:, 1] <= spec["top"] * body.height) & (V[:, 1] >= spec.get("bottom", 0.0) * body.height)
        for side in ("l", "r"):
            for bone in (f"thigh_{side}", f"calf_{side}"):
                b = sk[bone]
                ab = b.tail - b.head
                t = np.clip((V - b.head) @ ab / max(ab @ ab, 1e-12), 0, 1)
                d = np.linalg.norm(V - (b.head + t[:, None] * ab), axis=1)
                band &= d > spec.get("legClear", 1.3) * body.radius_at(0.5 * (b.head + b.tail))
        rows |= band
    return np.nonzero(rows)[0]


def _skirt(body, sk, profile, label):
    """Profile "skirt": a leaf skirt, petal skirt or train that wraps the hips is a ring of spring
    columns round the pelvis ("columns", default 8), each a chain of "links" (default 5) down the
    sheet in its own sector, so the sheet trails, swings and settles from the body's own motion
    and a leg pushes only the columns in front of it. Returns (rows, weights(W) -> fixed rows)."""
    spec = profile.get("skirt")
    if not spec:
        return None
    V, H = body.verts, body.height
    rows = _skirt_rows(body, sk, spec, label)
    if len(rows) < 20:
        return None
    P = V[rows]
    centre = sk["pelvis"].head
    ang = np.arctan2(P[:, 0] - centre[0], P[:, 2] - centre[2])
    K, links = spec.get("columns", 8), spec.get("links", 5)
    spine = [b for b in ("pelvis", "spine_01", "spine_02", "spine_03") if b in sk]
    cols = []
    for k in range(K):
        a = 2 * np.pi * k / K - np.pi
        d = np.angle(np.exp(1j * (ang - a)))
        Q = P[np.abs(d) <= np.pi / K]
        if len(Q) < 6 or np.ptp(Q[:, 1]) < 0.08 * H:
            continue
        bands = np.linspace(Q[:, 1].max(), Q[:, 1].min(), 2 * links + 1)
        line = np.array([Q[(Q[:, 1] <= hi) & (Q[:, 1] >= lo)].mean(0) for hi, lo in zip(bands[:-1], bands[1:])
                         if ((Q[:, 1] <= hi) & (Q[:, 1] >= lo)).any()])
        line[0][1], line[-1][1] = Q[:, 1].max(), Q[:, 1].min()
        pts, _ = resample(line, links)
        parent = next((b for b in reversed(spine) if sk[b].head[1] <= pts[0][1]), "pelvis")
        bones, prev = [], parent
        for i in range(links):
            name = f"skirt_{k}_{i + 1:02d}"
            sk.add(name, prev, pts[i], pts[i + 1], kind="cloth", heat=False)
            bones.append(name)
            prev = name
        cols.append({"angle": a, "bones": bones, "top": Q[:, 1].max(), "bottom": Q[:, 1].min()})
    if not cols:
        return None
    seam = _seam_release(body, rows, spec.get("seam", 0.04) * H)
    sk.notes["skirt"] = {"vertices": int(len(rows)), "columns": [c["bones"][0].rsplit("_", 1)[0] for c in cols]}

    def weights(W):
        names = sk.names()
        A = np.array([c["angle"] for c in cols])
        d = np.abs(np.angle(np.exp(1j * (ang[:, None] - A[None, :]))))
        # Each vertex blends the two columns on either side of it by angle, and each column's
        # links by the vertex's height between the column's top and bottom.
        near = np.argsort(d, axis=1)[:, :2] if len(cols) > 1 else np.zeros((len(rows), 1), int)
        dn = np.take_along_axis(d, near, 1)
        share = 1 - dn / np.maximum(dn.sum(1, keepdims=True), 1e-9) if len(cols) > 1 else np.ones((len(rows), 1))
        C = np.zeros((len(rows), len(names)))
        for j in range(near.shape[1]):
            for ci, col in enumerate(cols):
                sel = np.nonzero(near[:, j] == ci)[0]
                if not len(sel):
                    continue
                t = np.clip((col["top"] - P[sel, 1]) / max(col["top"] - col["bottom"], 1e-6), 0, 1)
                hw = _hat_weights(t, len(col["bones"]))
                for bi, b in enumerate(col["bones"]):
                    C[sel, names.index(b)] += share[sel, j] * hw[:, bi]
        C /= np.maximum(C.sum(1, keepdims=True), 1e-9)
        # At the waist the sheet eases in from the body's own weights, and where it is one surface
        # with the body it eases in along the surface from the join.
        top = max(c["top"] for c in cols)
        t = np.clip((top - P[:, 1]) / (0.12 * max(np.ptp(P[:, 1]), 1e-6)), 0, 1)
        a = t * t * (3 - 2 * t) * seam
        own = W[rows] / np.maximum(W[rows].sum(1, keepdims=True), 1e-9)
        W[rows] = (1 - a)[:, None] * own + a[:, None] * C
        return a > 0.5

    return rows, weights


def _fronds(body, sk, profile, label, sizes, taken):
    """Profile "fronds": loose thin pieces (leaves, fronds, moss strands) between "minShare" and
    "maxShare" of the mesh get a spring chain of "links" bones from where they touch the body to
    their far end, hung from the bone that carries the body there, so they sway and lag behind
    the body instead of riding it like armour. Returns weights(W, fixed) -> (W, fixed); it adds
    the bones once the attach step has settled which bone carries each frond's root."""
    spec = profile.get("fronds")
    if not spec:
        return None
    from scipy.spatial import cKDTree

    V, H = body.verts, body.height
    thick = body.thickness()
    main = int(np.argmax(sizes))
    anchor_idx = np.nonzero(label == main)[0]
    tree = cKDTree(V[anchor_idx])
    found = []
    lo, hi = spec.get("minShare", 0.01) * len(V), spec.get("maxShare", 0.12) * len(V)
    for c in np.nonzero((sizes >= lo) & (sizes <= hi))[0]:
        rows = np.nonzero(label == c)[0]
        if c == main or taken[rows].any():
            continue
        P = V[rows]
        if np.median(thick[rows]) > spec.get("maxThickness", 0.01) * H or np.ptp(P, axis=0).max() < spec.get("minLength", 0.08) * H:
            continue
        dist, near = tree.query(P)
        root_v = int(np.argmin(dist))
        root = P[root_v]
        reach = np.linalg.norm(P - root, axis=1)
        links = spec.get("links", 3)
        bands = np.linspace(0, reach.max(), 2 * links + 1)
        line = [root] + [P[(reach >= a) & (reach <= b)].mean(0) for a, b in zip(bands[:-1], bands[1:])
                         if ((reach >= a) & (reach <= b)).any()]
        line.append(P[int(np.argmax(reach))])
        pts, _ = resample(np.array(line), links)
        found.append({"rows": rows, "pts": pts, "anchor": int(anchor_idx[near[root_v]])})

    def weights(W, fixed):
        notes = {}
        for n, f in enumerate(found):
            names = sk.names()
            parent = names[int(np.argmax(W[f["anchor"]]))]
            bones, prev = [], parent
            for i in range(len(f["pts"]) - 1):
                name = f"frond_{n}_{i + 1:02d}"
                sk.add(name, prev, f["pts"][i], f["pts"][i + 1], kind="cloth", heat=False)
                bones.append(name)
                prev = name
            names = sk.names()
            W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
            rows = f["rows"]
            # Each vertex's place along the frond: its projection on the nearest link.
            seg = np.diff(f["pts"], axis=0)
            lens = np.linalg.norm(seg, axis=1)
            cum = np.concatenate([[0], np.cumsum(lens)])
            best = np.full(len(rows), np.inf)
            s = np.zeros(len(rows))
            for i in range(len(seg)):
                u = np.clip((V[rows] - f["pts"][i]) @ seg[i] / max(lens[i] ** 2, 1e-12), 0, 1)
                d = np.linalg.norm(V[rows] - (f["pts"][i] + u[:, None] * seg[i]), axis=1)
                better = d < best
                best[better] = d[better]
                s[better] = cum[i] + u[better] * lens[i]
            t = s / max(cum[-1], 1e-9)
            # The root of the frond rides its parent bone; the rest follows its chain.
            a = np.clip(t / 0.15, 0, 1)
            a = a * a * (3 - 2 * a)
            C = np.zeros((len(rows), len(names)))
            hw = _hat_weights(t, len(bones))
            for bi, b in enumerate(bones):
                C[:, names.index(b)] = a * hw[:, bi]
            C[:, names.index(parent)] += 1 - a
            W[rows] = C
            fixed[rows] = True
            notes[bones[0].rsplit("_", 1)[0]] = {"parent": parent, "vertices": int(len(rows))}
        sk.notes["fronds"] = notes
        return W, fixed

    weights.found = found
    return weights


def cloth(body, sk, profile, heat):
    base = golem.cloth(body, sk, profile, heat)
    label, sizes = _pieces(body)
    skirt = _skirt(body, sk, profile, label)
    taken = np.zeros(len(body.verts), bool)
    if skirt:
        taken[skirt[0]] = True
    fronds = _fronds(body, sk, profile, label, sizes, taken)
    fronds_rows = np.zeros(len(body.verts), bool)
    if fronds:
        fronds_rows[np.concatenate([f["rows"] for f in fronds.found] or [np.zeros(0, int)])] = True

    def override(W):
        W, fixed = base(W)
        names = sk.names()
        if W.shape[1] < len(names):
            W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
        # The skirt and the fronds take their chains first, so a small piece lying on them (a
        # duplicate rim, a flake) copies the chain weights and moves with them.
        if skirt:
            rows, weights = skirt
            fixed[rows] = weights(W)
        if fronds:
            W, fixed = fronds(W, fixed)
        if profile.get("attachPieces", True):
            W, fixed = _attach(W, fixed, body, sk, profile, own=taken | fronds_rows)
            W = _root_feet(W, sk, body.verts, body.height, profile)
        return W, fixed

    return override


def plan(sk, body, profile):
    """The golem plan. The skirt's columns are one linked sheet; each frond swings on its own.
    Profile "skirt" and "fronds" set their springs ("stiffness", "damping", "gravity", "hang",
    and "clearance" above the floor as a share of the height)."""
    out = golem.plan(sk, body, profile)
    # "colliderPad" widens the leg and torso capsules, so a sheet hanging close to the legs keeps
    # its whole surface, not only its joints, clear of them.
    pad = (profile.get("skirt") or {}).get("colliderPad", 1.0)
    for col in out["colliders"]:
        col.radius *= pad
    for chain in out["chains"]:
        key = {"skirt": "skirt", "frond": "fronds"}.get(chain["bones"][0].split("_")[0])
        if not key or not profile.get(key):
            continue
        spec = profile[key]
        chain.update({k: spec[k] for k in ("stiffness", "damping", "gravity", "hang") if k in spec})
        chain["clearance"] = spec.get("clearance", 0.01) * body.height
        if key == "fronds":
            chain.pop("group", None)
    return out
