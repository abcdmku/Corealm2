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
the antlers).
"""
import numpy as np
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from classes import golem
from crlib.skin import adjacency

NAME = "treant"

fit = golem.fit
plan = golem.plan
bind_turns = golem.bind_turns
recoil_bones = golem.recoil_bones


def _attach(W, fixed, body, sk, profile):
    V = body.verts
    count, label = connected_components(adjacency(len(V), body.faces), directed=False)
    sizes = np.bincount(label, minlength=count)
    small = sizes <= profile.get("attachMaxShare", 0.12) * len(V)
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


def cloth(body, sk, profile, heat):
    base = golem.cloth(body, sk, profile, heat)

    def override(W):
        W, fixed = base(W)
        if profile.get("attachPieces", True):
            W, fixed = _attach(W, fixed, body, sk, profile)
        return W, fixed

    return override
