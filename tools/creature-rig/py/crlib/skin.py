"""Skin weights: Blender bone-heat on the merged mesh, then clean-up.

1. Bone heat (automatic weights) against the fitted armature, in bind pose (robust_heat: on the
   render mesh, else a welded copy, else the outer surface of the voxel solid).
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


def _heat_on(verts, faces, skeleton, name):
    """Bone heat on a throwaway mesh (glTF coordinates); the mesh and its armature are removed."""
    import bpy
    from .mathx import BLENDER_FROM_GLTF

    me = bpy.data.meshes.new(name)
    me.from_pydata((np.asarray(verts) @ BLENDER_FROM_GLTF.T).tolist(), [], np.asarray(faces).tolist())
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    active = bpy.context.view_layer.objects.active
    try:
        W = bone_heat(obj, skeleton)
    finally:
        arm = obj.parent
        bpy.data.objects.remove(obj)
        bpy.data.meshes.remove(me)
        if arm is not None and arm.type == "ARMATURE":
            bpy.data.objects.remove(arm)
        bpy.context.view_layer.objects.active = active
    return W


def welded(verts, faces, tol):
    """The mesh with vertices closer than tol merged and degenerate faces dropped. Returns
    (verts, faces, index of each input vertex's welded vertex)."""
    q = np.round(np.asarray(verts) / tol).astype(np.int64)
    _, first, inverse = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.ravel()
    F = inverse[np.asarray(faces)]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 2] != F[:, 0])]
    return np.asarray(verts)[first], F, inverse


def solid_proxy(body, max_quads=160000):
    """The outer surface of the body's filled voxel solid, as a quad-split triangle mesh. A
    double-walled or non-manifold shell hides every bone from bone heat; this surface is closed
    and one-sided."""
    from scipy import ndimage

    S = ndimage.binary_fill_holes(body.solid)
    h, origin = body.h, body.origin
    step = 1
    while True:
        P = np.pad(S, 1)
        quads = []
        corner = {0: [(0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)],
                  1: [(0, 0, 0), (0, 0, 1), (1, 0, 1), (1, 0, 0)],
                  2: [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]}
        for axis in range(3):
            d = np.diff(P.astype(np.int8), axis=axis)
            for sign in (1, -1):
                idx = np.argwhere(d == sign)
                base = idx.copy()
                base[:, axis] += 1
                q = base[:, None, :] + np.array(corner[axis])[None]
                quads.append(q if sign == 1 else q[:, ::-1])
        Q = np.concatenate(quads)
        if len(Q) <= max_quads:
            break
        # Too fine for a quick heat solve: halve the grid.
        step *= 2
        S = np.pad(S, [(0, n % 2) for n in S.shape])
        a, b, c = (n // 2 for n in S.shape)
        S = S.reshape(a, 2, b, 2, c, 2).any(axis=(1, 3, 5))
    uniq, inv = np.unique(Q.reshape(-1, 3), axis=0, return_inverse=True)
    quad = inv.ravel().reshape(-1, 4)
    verts = origin + (uniq - 1) * h * step
    faces = np.vstack([quad[:, [0, 1, 2]], quad[:, [0, 2, 3]]])
    return verts, faces


def transfer(src_verts, src_W, dst_verts, k=4):
    """Weights at dst from the k nearest src vertices, inverse-distance blended."""
    d, i = cKDTree(src_verts).query(dst_verts, k=k)
    w = 1.0 / np.maximum(d, 1e-9)
    W = np.einsum("nk,nkb->nb", w, src_W[i])
    return W / np.maximum(W.sum(1, keepdims=True), 1e-12)


def robust_heat(mesh_obj, skeleton, body, weld_above=0.02, island_above=0.5, proxy_above=0.15, replace_above=0.3,
                max_pieces=150):
    """Bone heat with three fallbacks. Returns (W, report).

    1. Heat on the render mesh.
    2. When more than weld_above of the vertices get no weight, heat again on a welded copy (near-
       duplicate vertices make Blender's system singular) and keep it if it covers more.
    3. When more than island_above is still missing, heat on each loose piece of the welded copy
       on its own (one bad piece can sink the joined solve), for up to max_pieces pieces.
    4. When more than proxy_above is still missing, heat on the outer surface of the filled voxel
       solid (double-walled and non-manifold shells), transferred to the render mesh by the nearest
       proxy surface points: to every vertex when more than replace_above was missing (a failed
       solve's surviving rows are not trusted either), otherwise only to the missing ones.
    """
    V, F = body.verts, body.faces
    W = bone_heat(mesh_obj, skeleton)
    missing = lambda X: float((X.sum(1) < 1e-6).mean())
    report = {"heatSource": "mesh", "heatMissingMesh": missing(W)}
    if missing(W) > weld_above:
        Vw, Fw, k = welded(V, F, 4e-4 * body.height)
        Ww = _heat_on(Vw, Fw, skeleton, "heat_welded")
        if missing(Ww[k]) < missing(W):
            W = Ww[k]
            report["heatSource"] = "welded"
        if missing(W) > island_above:
            # One loose piece can make the joined system unsolvable for every piece (armour sets):
            # solve each loose piece of the welded mesh on its own.
            Wi = np.zeros_like(Ww)
            count, label = connected_components(adjacency(len(Vw), Fw), directed=False)
            sizes = np.bincount(label, minlength=count)
            # Hundreds of pieces (a sculpted plumage) would take minutes; the voxel proxy covers them.
            for c in (range(count) if (sizes >= 30).sum() <= max_pieces else []):
                rows = np.nonzero(label == c)[0]
                if len(rows) < 30:
                    continue
                remap = -np.ones(len(Vw), int)
                remap[rows] = np.arange(len(rows))
                faces = remap[Fw[np.all(label[Fw] == c, axis=1)]]
                Wi[rows] = _heat_on(Vw[rows], faces, skeleton, "heat_piece")
            if missing(Wi[k]) < missing(W):
                W = Wi[k]
                report["heatSource"] = "pieces"
    if missing(W) > proxy_above:
        Vp, Fp = solid_proxy(body)
        Wp = _heat_on(Vp, Fp, skeleton, "heat_proxy")
        covered = Wp.sum(1) > 1e-6
        report["proxy"] = {"vertices": len(Vp), "coverage": round(float(covered.mean()), 4)}
        if covered.any():
            T = transfer(Vp[covered], Wp[covered], V)
            rows = np.ones(len(V), bool) if missing(W) > replace_above else W.sum(1) < 1e-6
            W = W.copy()
            W[rows] = T[rows]
            report["heatSource"] = "solid-proxy" if rows.all() else f"{report['heatSource']}+solid-proxy"
    report["heatMissing"] = missing(W)
    if report["heatMissing"] >= 1.0:
        raise RuntimeError("bone heat found no weights on the mesh, a welded copy or the voxel-solid proxy")
    return W, report


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


def rigid_islands(W, faces, n, verts=None, skeleton=None, dominance=0.7, max_share=0.08, reach=2.0, exclude=()):
    """Loose pieces (up to max_share of the mesh) whose heat weight is mostly one bone. Heat can
    hand a piece to a bone it is far from (a thigh plate to the hand hanging next to it); when the
    heat bone is more than reach times as far from the piece as the nearest bone, the piece goes
    to the nearest bone instead. Bones in exclude never take a rigid piece (a piece mostly on one
    keeps its smooth weights). Returns (labels, {piece: bone}, {piece: (heat bone, nearest)})."""
    adj = adjacency(n, faces)
    count, label = connected_components(adj, directed=False)
    sizes = np.bincount(label, minlength=count)
    rigid, moved = {}, {}
    if skeleton is not None:
        usable = np.array([b.deform and b.heat and b.kind != "cloth" and b.name not in exclude for b in skeleton.bones])
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
        if skeleton is not None and not usable[bone]:
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


def skin(mesh_obj, verts, faces, skeleton, heat=None, passes=2, rigid=True, overrides=None, rigid_exclude=()):
    """Returns (weights N x bones, report). heat: bone-heat weights already computed for the
    first bones of the skeleton (class modules read them to find cloth before adding its bones).
    overrides(W) may replace rows (cloth panels). rigid_exclude: bones the loose-piece rule never
    binds a piece to."""
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
        label, pieces, moved = rigid_islands(W, faces, len(verts), verts, skeleton, exclude=set(rigid_exclude))
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
