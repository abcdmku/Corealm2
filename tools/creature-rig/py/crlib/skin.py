"""Skin weights: Blender bone-heat on the merged mesh, then clean-up.

1. Bone heat (automatic weights) against the fitted armature, in bind pose.
2. Vertices heat could not reach take their mesh neighbours' weights; loose pieces heat skipped
   entirely take the weights of the nearest weighted surface.
3. Loose pieces that heat already binds mostly to one bone (a helmet, a gauntlet, a pauldron, a
   horn) are bound rigidly to that bone on purpose, so plates do not bend like skin. A piece heat
   gives to a bone far from it (a thigh plate to the hand hanging beside it) goes to its nearest
   bone instead.
4. One or two Laplacian passes over the rest, then at most four influences, normalised.
"""
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree


def adjacency(n, faces):
    e = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    e = np.vstack([e, e[:, ::-1]])
    return csr_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)).tocsr()


def bone_heat(mesh_obj, skeleton):
    import bpy

    arm = skeleton.build_blender_armature()
    for o in bpy.data.objects:
        o.select_set(False)
    mesh_obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    mesh_obj.vertex_groups.clear()
    for m in list(mesh_obj.modifiers):
        mesh_obj.modifiers.remove(m)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    names = [b.name for b in skeleton.bones]
    W = np.zeros((len(mesh_obj.data.vertices), len(names)))
    group_bone = {g.index: names.index(g.name) for g in mesh_obj.vertex_groups if g.name in names}
    for v in mesh_obj.data.vertices:
        for g in v.groups:
            if g.group in group_bone:
                W[v.index, group_bone[g.group]] = g.weight
    return W


def fill_unweighted(W, verts, faces, adj):
    W = W.copy()
    empty = W.sum(1) < 1e-6
    for _ in range(200):
        if not empty.any():
            break
        spread = adj @ W
        grow = empty & (spread.sum(1) > 1e-9)
        if not grow.any():
            break
        W[grow] = spread[grow] / spread[grow].sum(1, keepdims=True)
        empty &= ~grow
    if empty.any():
        # Pieces heat never reached (separate islands): nearest weighted vertex.
        tree = cKDTree(verts[~empty])
        _, k = tree.query(verts[empty])
        W[empty] = W[~empty][k]
    return W


def segment_distance(points, heads, tails):
    """Distance from each point to each bone segment (points x bones)."""
    ab = tails - heads
    rel = points[:, None, :] - heads[None, :, :]
    t = np.clip(np.einsum("pbk,bk->pb", rel, ab) / np.maximum(np.einsum("bk,bk->b", ab, ab), 1e-12), 0, 1)
    return np.linalg.norm(rel - t[..., None] * ab[None], axis=2)


def rigid_islands(W, faces, n, verts=None, skeleton=None, dominance=0.7, max_share=0.08, reach=2.0):
    """Loose pieces (up to max_share of the mesh) whose heat weight is mostly one bone. Heat can
    hand a piece to a bone it is far from (a thigh plate to the hand hanging next to it); when the
    heat bone is more than reach times as far from the piece as the nearest bone, the piece goes
    to the nearest bone instead. Returns (labels, {piece: bone}, {piece: (heat bone, nearest)})."""
    adj = adjacency(n, faces)
    count, label = connected_components(adj, directed=False)
    sizes = np.bincount(label, minlength=count)
    rigid, moved = {}, {}
    if skeleton is not None:
        usable = np.array([b.deform and b.heat and b.kind != "cloth" for b in skeleton.bones])
        heads = np.array([b.head for b in skeleton.bones])
        tails = np.array([b.tail for b in skeleton.bones])
    for c in range(count):
        if sizes[c] > max_share * n:
            continue
        mass = W[label == c].sum(0)
        if mass.sum() <= 0:
            continue
        bone = int(np.argmax(mass))
        if mass[bone] / mass.sum() < dominance:
            continue
        if skeleton is not None:
            dist = segment_distance(verts[label == c], heads, tails).mean(0)
            dist[~usable] = np.inf
            nearest = int(np.argmin(dist))
            if dist[bone] > reach * max(dist[nearest], 1e-9):
                moved[c] = (bone, nearest)
                bone = nearest
        rigid[c] = bone
    return label, rigid, moved


def smooth(W, adj, passes, locked):
    deg = np.asarray(adj.sum(1)).ravel()
    for _ in range(passes):
        avg = (adj @ W) / np.maximum(deg, 1)[:, None]
        W = np.where(locked[:, None], W, 0.5 * W + 0.5 * avg)
    return W


def limit(W, count=4):
    W = W.copy()
    if W.shape[1] > count:
        cut = np.argsort(-W, axis=1)[:, count:]
        np.put_along_axis(W, cut, 0.0, axis=1)
    W[W < 0.01] = 0.0
    s = W.sum(1, keepdims=True)
    return W / np.maximum(s, 1e-12)


def skin(mesh_obj, verts, faces, skeleton, heat=None, passes=2, rigid=True, overrides=None):
    """Returns (weights N x bones, report). heat: bone-heat weights already computed for the
    first bones of the skeleton (class modules read them to find cloth before adding its bones).
    overrides(W) may replace rows (cloth panels)."""
    names = [b.name for b in skeleton.bones]
    W = bone_heat(mesh_obj, skeleton) if heat is None else heat
    if W.shape[1] < len(names):
        W = np.hstack([W, np.zeros((len(W), len(names) - W.shape[1]))])
    heat_missing = float((W.sum(1) < 1e-6).mean())
    adj = adjacency(len(verts), faces)
    W = fill_unweighted(W, verts, faces, adj)
    locked = np.zeros(len(verts), bool)
    report = {"heatMissingShare": heat_missing, "rigidPieces": {}}
    if rigid:
        label, pieces, moved = rigid_islands(W, faces, len(verts), verts, skeleton)
        report["rigidMoved"] = [{"vertices": int((label == c).sum()), "heat": names[a], "nearest": names[b]} for c, (a, b) in moved.items()]
        for c, bone in pieces.items():
            rows = label == c
            W[rows] = 0.0
            W[rows, bone] = 1.0
            locked |= rows
            report["rigidPieces"].setdefault(names[bone], 0)
            report["rigidPieces"][names[bone]] += int(rows.sum())
    if overrides:
        W, fixed = overrides(W)
        locked |= fixed
    W = smooth(W, adj, passes, locked)
    W = limit(W, 4)
    report["influences"] = {int(k): int(v) for k, v in zip(*np.unique((W > 0).sum(1), return_counts=True))}
    report["boneShare"] = {names[i]: round(float(W[:, i].sum() / len(W)), 4) for i in range(len(names)) if W[:, i].sum() > 0}
    return W, report
