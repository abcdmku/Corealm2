"""Minimal GLB reader (numpy): nodes, world matrices, skins, accessors and clip poses. Used by the studio mode."""
import json, struct
import numpy as np

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
NORM = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}


class Glb:
    def __init__(self, path):
        data = open(path, "rb").read()
        off = 12
        self.bin = b""
        while off < len(data):
            length, kind = struct.unpack_from("<II", data, off)
            chunk = data[off + 8: off + 8 + length]
            if kind == 0x4E4F534A:
                self.json = json.loads(chunk)
            elif kind == 0x004E4942:
                self.bin = chunk
            off += 8 + length
        j = self.json
        self.nodes = j["nodes"]
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get("children", []):
                self.parent[c] = i
        self.name_index = {n.get("name", f"node{i}"): i for i, n in enumerate(self.nodes)}

    def accessor(self, idx):
        a = self.json["accessors"][idx]
        n = NCOMP[a["type"]]
        out = np.zeros((a["count"], n))
        if "bufferView" not in a:
            return out
        bv = self.json["bufferViews"][a["bufferView"]]
        if "extensions" in bv:
            raise RuntimeError("compressed buffer view")
        dt = np.dtype(COMP[a["componentType"]])
        stride = bv.get("byteStride") or dt.itemsize * n
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        for c in range(n):
            out[:, c] = np.ndarray((a["count"],), dt, self.bin, base + c * dt.itemsize, (stride,))
        if a.get("normalized"):
            out /= NORM[a["componentType"]]
        return out

    @staticmethod
    def trs(t, r, s):
        x, y, z, w = r
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        M = np.eye(4)
        M[:3, :3] = R * np.asarray(s)[None, :]
        M[:3, 3] = t
        return M

    def local(self, i, pose=None):
        n = self.nodes[i]
        if pose and i in pose:
            p = pose[i]
            return self.trs(p.get("translation", n.get("translation", [0, 0, 0])), p.get("rotation", n.get("rotation", [0, 0, 0, 1])), p.get("scale", n.get("scale", [1, 1, 1])))
        if "matrix" in n:
            return np.array(n["matrix"]).reshape(4, 4).T
        return self.trs(n.get("translation", [0, 0, 0]), n.get("rotation", [0, 0, 0, 1]), n.get("scale", [1, 1, 1]))

    def world(self, i, pose=None):
        M = self.local(i, pose)
        while i in self.parent:
            i = self.parent[i]
            M = self.local(i, pose) @ M
        return M

    def clip_pose(self, name, t=0.0, only=None):
        """Node TRS overrides from one animation sampled at time t (LINEAR/STEP)."""
        anim = next(a for a in self.json["animations"] if a["name"] == name)
        pose = {}
        for ch in anim["channels"]:
            node = ch["target"].get("node")
            if node is None or (only is not None and node not in only):
                continue
            s = anim["samplers"][ch["sampler"]]
            times = self.accessor(s["input"])[:, 0]
            vals = self.accessor(s["output"])
            if s.get("interpolation") == "CUBICSPLINE":
                vals = vals[1::3]
            k = int(np.searchsorted(times, t, side="right") - 1)
            k = max(0, min(k, len(times) - 1))
            pose.setdefault(node, {})[ch["target"]["path"]] = vals[k].tolist()
        return pose
