"""Mesh analysis shared by every body class.

The mesh is voxelised into a solid; thin sheets (capes, loincloths, robes, membranes) are removed by
a morphological opening so limbs can be measured without cloth hanging between them. Extremities
(head top, hand tips, toe tips, tail tips) are the far ends of a medial geodesic from the body core,
and each limb is a medial path from the core to its extremity. Class modules place joints on these
paths from cross-section centroids and measured features (forks, corners, narrowings); no joint
position is a typed constant.

All coordinates are glTF: +Y up, the creature faces +Z, +X is the creature's left.
"""
import numpy as np
from scipy import ndimage
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

from .mathx import GLTF_FROM_BLENDER, normalize


class Body:
    def __init__(self, verts, faces, resolution=110):
        self.verts = np.asarray(verts, float)
        self.faces = np.asarray(faces, int)
        self.min = self.verts.min(0)
        self.max = self.verts.max(0)
        self.height = float(self.max[1] - self.min[1])
        self.h = self.height / resolution
        self._voxelise()
        self._medial_graph()

    # ---------------------------------------------------------------- voxels
    def _voxelise(self):
        h = self.h
        self.origin = self.min - 3 * h
        shape = np.ceil((self.max - self.min) / h).astype(int) + 7
        shell = np.zeros(shape, bool)
        tri = self.verts[self.faces]
        edge = np.max(np.linalg.norm(tri - np.roll(tri, 1, axis=1), axis=2), axis=1)
        steps = np.maximum(1, np.ceil(edge / (0.45 * h)).astype(int))
        for n in np.unique(steps):
            sel = tri[steps == n]
            ij = [(i, j) for i in range(n + 1) for j in range(n + 1 - i)]
            bary = np.array([[1 - (i + j) / n, i / n, j / n] for i, j in ij])
            pts = np.einsum("kb,tbc->tkc", bary, sel).reshape(-1, 3)
            idx = np.floor((pts - self.origin) / h).astype(int)
            shell[idx[:, 0], idx[:, 1], idx[:, 2]] = True
        self.shell = shell
        # Inside = not reachable from outside once the shell's holes are sealed. Seal by closing
        # (dilate, fill, erode) with the smallest radius after which the solid stops growing: a
        # mesh with holes needs a few voxels, while a larger radius would also close real openings
        # such as the space under a cape.
        ball = ndimage.generate_binary_structure(3, 1)
        previous = None
        for k in range(1, 6):
            closed = ndimage.binary_dilation(shell, iterations=k)
            solid = ndimage.binary_erosion(ndimage.binary_fill_holes(closed), iterations=k) | shell
            size = int(ndimage.binary_opening(solid, structure=ball).sum())
            if previous is not None and size < 1.1 * previous[1]:
                break
            previous = (solid, size, k)
        self.solid, _, self.seal_radius = previous
        ball = ndimage.generate_binary_structure(3, 1)
        opened = ndimage.binary_opening(self.solid, structure=ball, iterations=1)
        labels, count = ndimage.label(opened)
        if count > 1:
            sizes = ndimage.sum(opened, labels, range(1, count + 1))
            opened = labels == (1 + int(np.argmax(sizes)))
        self.core = opened
        self.dt = ndimage.distance_transform_edt(self.core) * h

    def to_world(self, idx):
        return self.origin + (np.asarray(idx, float) + 0.5) * self.h

    def to_index(self, p):
        return np.floor((np.asarray(p, float) - self.origin) / self.h).astype(int)

    def core_points(self):
        return self.to_world(np.argwhere(self.core))

    # ------------------------------------------------------------ geodesics
    def _mesh_geodesic_landmarks(self, count=10):
        """Mesh-surface geodesic distances from farthest-point-sampled landmarks. Two voxels whose
        nearest surface points are far apart along the surface are in separate parts that merely
        touch (a hand resting on a thigh), so the medial graph must not join them."""
        V, F = self.verts, self.faces
        e = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
        w = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)
        graph = csr_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(len(V), len(V)))
        _, component = connected_components(graph, directed=False)
        main = np.argmax(np.bincount(component))
        start = int(np.argmax(np.where(component == main, V[:, 1], -np.inf)))
        landmarks = [start]
        dists = [dijkstra(graph, indices=start)]
        for _ in range(count - 1):
            nearest = np.min(np.where(np.isfinite(dists), dists, np.inf), axis=0)
            nearest[component != main] = -1
            nxt = int(np.argmax(nearest))
            landmarks.append(nxt)
            dists.append(dijkstra(graph, indices=nxt))
        self.mesh_component = component
        self.landmark_dist = np.array(dists)
        return self.landmark_dist

    def _medial_graph(self):
        idx = np.argwhere(self.core)
        self.nodes = idx
        lookup = -np.ones(self.core.shape, int)
        lookup[tuple(idx.T)] = np.arange(len(idx))
        self.lookup = lookup
        rows, cols, cost = [], [], []
        dt = self.dt[tuple(idx.T)]
        # Medial preference is relative to the local thickness, so thin limbs are not dearer than
        # the torso; only hugging a limb's surface is.
        size = max(3, int(round(0.08 * self.height / self.h)) | 1)
        local = ndimage.maximum_filter(self.dt, size=size)[tuple(idx.T)]
        D = self._mesh_geodesic_landmarks()
        _, surf = cKDTree(self.verts).query(self.to_world(idx))
        comp = self.mesh_component[surf]
        normals = vertex_normals(self.verts, self.faces)[surf]
        shallow = dt <= 3.0 * self.h
        cut_at = 0.35 * self.height
        self.cut_edges = 0
        cut = ([], [], [])
        for d in [(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (1, -1, 0), (1, 0, 1), (1, 0, -1), (0, 1, 1), (0, 1, -1),
                  (1, 1, 1), (1, 1, -1), (1, -1, 1), (1, -1, -1)]:
            nb = idx + d
            ok = np.all((nb >= 0) & (nb < self.core.shape), axis=1)
            a = np.nonzero(ok)[0]
            b = lookup[tuple(nb[ok].T)]
            keep = b >= 0
            a, b = a[keep], b[keep]
            sa, sb = surf[a], surf[b]
            same = comp[a] == comp[b]
            Da = np.nan_to_num(D[:, sa], posinf=-1.0)
            Db = np.nan_to_num(D[:, sb], posinf=-1.0)
            gap = np.max(np.where((Da >= 0) & (Db >= 0), np.abs(Da - Db), 0.0), axis=0)
            # Separate pieces pressed together (a hand on a loincloth): both voxels at the surface
            # and the two surfaces facing each other.
            facing = ~same & shallow[a] & shallow[b] & (np.einsum("ij,ij->i", normals[a], normals[b]) < -0.2)
            touching = (same & (gap > cut_at)) | facing
            self.cut_edges += int(touching.sum())
            step = np.linalg.norm(d) * self.h
            # Prefer the medial line: stepping through thin (near-surface) voxels costs more.
            w = step * (1.0 + 3.0 * (1.0 - np.minimum(dt[a], dt[b]) / np.maximum(local[a], local[b])) ** 2)
            rows += [a[~touching], b[~touching]]
            cols += [b[~touching], a[~touching]]
            cost += [w[~touching], w[~touching]]
            cut[0].append(a[touching])
            cut[1].append(b[touching])
            cut[2].append(w[touching])
        rows, cols, cost = np.concatenate(rows), np.concatenate(cols), np.concatenate(cost)
        rows, cols, cost = self._reattach(len(idx), rows, cols, cost, *(np.concatenate(c) for c in cut))
        self.graph = csr_matrix((cost, (rows, cols)), shape=(len(idx), len(idx)))

    def _reattach(self, n, rows, cols, cost, ca, cb, cw, min_share=0.01):
        """A separate mesh piece that only touches the body (a forearm or a claw modelled as its
        own island) is cut off whole by the contact cuts and would vanish from the medial graph.
        Each such piece of at least min_share of the core is joined again through the cut edges
        to the neighbouring part it shares the most contact with."""
        from scipy.sparse.csgraph import connected_components

        self.reattached = []
        for _ in range(8):
            graph = csr_matrix((cost, (rows, cols)), shape=(n, n))
            count, label = connected_components(graph, directed=False)
            sizes = np.bincount(label, minlength=count)
            main = int(np.argmax(sizes))
            la, lb = label[ca], label[cb]
            added = False
            for c in np.argsort(-sizes):
                if c == main or sizes[c] < min_share * n:
                    continue
                touch = ((la == c) & (lb != c)) | ((lb == c) & (la != c))
                if not touch.any():
                    continue
                other = np.where(la[touch] == c, lb[touch], la[touch])
                best = np.bincount(other, minlength=count).argmax()
                pick = touch.copy()
                pick[touch] = other == best
                rows = np.concatenate([rows, ca[pick], cb[pick]])
                cols = np.concatenate([cols, cb[pick], ca[pick]])
                cost = np.concatenate([cost, cw[pick], cw[pick]])
                self.reattached.append({"voxels": int(sizes[c]), "edges": int(pick.sum())})
                added = True
                break
            if not added:
                break
        return rows, cols, cost

    def nearest_node(self, p):
        tree = getattr(self, "_tree", None)
        if tree is None:
            tree = self._tree = cKDTree(self.to_world(self.nodes))
        return int(tree.query(p)[1])

    def geodesic(self, start):
        dist, pred = dijkstra(self.graph, indices=self.nearest_node(start), return_predecessors=True)
        return dist, pred

    def path(self, pred, end_node):
        out = []
        n = end_node
        while n >= 0:
            out.append(n)
            n = pred[n]
        return self.to_world(self.nodes[out[::-1]])

    def extremities(self, start, min_separation, min_distance):
        """Tips of the core: nodes whose medial geodesic distance from start is the largest within
        min_separation of them (head top, hand tips, toe tips, tail tips)."""
        dist, pred = self.geodesic(start)
        finite = np.isfinite(dist)
        grid = np.full(self.core.shape, -1.0)
        grid[tuple(self.nodes[finite].T)] = dist[finite]
        size = max(3, int(round(2 * min_separation / self.h)) | 1)
        peak = ndimage.maximum_filter(grid, size=size, mode="constant", cval=-1.0)
        tips = np.argwhere((grid >= 0) & (grid >= peak) & (grid >= min_distance))
        out = []
        for ijk in tips:
            n = int(self.lookup[tuple(ijk)])
            p = self.to_world(ijk)
            if all(np.linalg.norm(p - o["position"]) > min_separation for o in out):
                out.append({"node": n, "position": p, "distance": float(dist[n])})
        out.sort(key=lambda o: -o["distance"])
        return out, dist, pred

    # ---------------------------------------------------------- measurements
    def radius_at(self, p):
        i = np.clip(self.to_index(p), 0, np.array(self.core.shape) - 1)
        return float(self.dt[tuple(i)])

    def section_centroid(self, p, tangent, reach):
        """Centroid of the core cross-section through p normal to tangent, within reach of p."""
        pts = self.core_points()
        t = normalize(tangent)
        rel = pts - p
        along = rel @ t
        near = (np.abs(along) <= 0.75 * self.h) & (np.linalg.norm(rel - np.outer(along, t), axis=1) <= reach)
        if near.sum() < 3:
            return np.asarray(p, float), 0
        sel = pts[near]
        # Keep only the piece of the section connected to p (not a neighbouring limb in reach).
        tree = cKDTree(sel)
        seed = int(tree.query(p)[1])
        seen = {seed}
        stack = [seed]
        while stack:
            k = stack.pop()
            for m in tree.query_ball_point(sel[k], 1.8 * self.h):
                if m not in seen:
                    seen.add(m)
                    stack.append(m)
        sel = sel[sorted(seen)]
        return sel.mean(0), len(sel)

    def slab(self, y, thickness=None):
        """Core voxels in the horizontal slab at height y, split into connected 2D components."""
        thickness = thickness or self.h
        j0 = int(np.floor((y - thickness / 2 - self.origin[1]) / self.h))
        j1 = int(np.floor((y + thickness / 2 - self.origin[1]) / self.h))
        j0, j1 = max(j0, 0), min(max(j1, j0), self.core.shape[1] - 1)
        layer = self.core[:, j0:j1 + 1, :].any(axis=1)
        labels, count = ndimage.label(layer, structure=np.ones((3, 3)))
        comps = []
        for k in range(1, count + 1):
            ij = np.argwhere(labels == k)
            xz = self.origin[[0, 2]] + (ij + 0.5) * self.h
            comps.append({"count": len(ij), "centroid": xz.mean(0), "min": xz.min(0), "max": xz.max(0), "points": xz})
        return sorted(comps, key=lambda c: -c["count"])

    def thickness(self):
        """Per-vertex distance through the mesh along the inward normal (a cape or a flap is a
        few centimetres thick, a limb is its diameter)."""
        if getattr(self, "_thickness", None) is not None:
            return self._thickness
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree

        tree = BVHTree.FromPolygons([tuple(v) for v in self.verts], [tuple(f) for f in self.faces])
        normals = vertex_normals(self.verts, self.faces)
        eps = 1e-4 * self.height

        def cast(sign):
            out = np.full(len(self.verts), self.height)
            for i, (v, n) in enumerate(zip(self.verts, normals)):
                d = Vector(-sign * n)
                hit = tree.ray_cast(Vector(v) + d * eps, d, self.height)
                if hit[0] is None or d.dot(hit[1]) < 0:
                    # Leaving through a face that looks back at us: this is a single-sided sheet.
                    out[i] = 0.0
                else:
                    out[i] = hit[3] + eps
            return out

        out = cast(1.0)
        if (out == 0).mean() > 0.6:
            out = cast(-1.0)  # the mesh's normals point inwards
        # Single-sided sheets have no back face for the ray to hit; the solid's own local
        # thickness (distance transform, largest nearby) still says they are thin.
        solid_dt = ndimage.maximum_filter(ndimage.distance_transform_edt(self.solid) * self.h * 2.0, size=5)
        idx = np.clip(self.to_index(self.verts), 0, np.array(self.solid.shape) - 1)
        out = np.minimum(out, solid_dt[tuple(idx.T)])
        self._thickness = out
        return out

    def thin_vertices(self, gap=None):
        """Mesh vertices lying outside the opened core: cloth sheets, fins, fringes, weapon blades."""
        gap = self.h * 1.6 if gap is None else gap
        core_tree = cKDTree(self.core_points())
        d, _ = core_tree.query(self.verts)
        return d > gap, d


def vertex_normals(verts, faces):
    tri = verts[faces]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    out = np.zeros_like(verts)
    for k in range(3):
        np.add.at(out, faces[:, k], n)
    return out / np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-12)


def resample(path, count):
    """count+1 points evenly spaced along a polyline (after light smoothing)."""
    path = np.asarray(path, float)
    if len(path) > 4:
        k = np.ones(3) / 3
        smooth = np.vstack([np.convolve(path[:, a], k, mode="same") for a in range(3)]).T
        smooth[0], smooth[-1] = path[0], path[-1]
        path = smooth
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    target = np.linspace(0, s[-1], count + 1)
    return np.vstack([np.interp(target, s, path[:, a]) for a in range(3)]).T, s[-1]


def point_along(path, fraction):
    pts, _ = resample(path, 200)
    return pts[int(round(np.clip(fraction, 0, 1) * 200))]


def arc_param(path, point):
    """Arc-length fraction of the path point closest to point."""
    pts, length = resample(path, 200)
    return int(np.argmin(np.linalg.norm(pts - point, axis=1))) / 200.0


def corner(path, lo=0.0, hi=1.0):
    """Point of the path (between fractions lo and hi) farthest from the chord between its ends."""
    pts, _ = resample(path, 200)
    a, b = pts[0], pts[-1]
    chord = normalize(b - a)
    rel = pts - a
    dist = np.linalg.norm(rel - np.outer(rel @ chord, chord), axis=1)
    i0, i1 = int(lo * 200), int(hi * 200)
    k = i0 + int(np.argmax(dist[i0:i1 + 1]))
    return pts[k], k / 200.0


def load_blender_mesh(path):
    """Imports a GLB with merge_vertices into the current Blender file and joins it into one
    object. Returns (object, verts_gltf, faces)."""
    import bpy

    bpy.ops.import_scene.gltf(filepath=str(path), merge_vertices=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = obj.data
    verts = np.array([v.co[:] for v in me.vertices]) @ GLTF_FROM_BLENDER.T
    me.calc_loop_triangles()
    faces = np.array([t.vertices[:] for t in me.loop_triangles])
    return obj, verts, faces
