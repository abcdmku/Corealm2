"""Studio donor motion: resolve a donor, import it headless and sample its takes at 30 fps.

A donor spec (an entry of a class donor map, or of the shared catalog py/donors.json) is one of

  {"file": "<path>"} or {"files": ["<path>", ...]}        one file; takes are its actions
  {"zip": "<archive>", "member": "<path inside>"}          the same, extracted from a zip
  {"unitypackage": "<.unitypackage>", "member": "Assets/..."}  the same, from a Unity package
  {"rig": <file spec>, "takes": {"Walk": {"file": <file spec>, "range": [first, last], "action": "..."}}}
                                                           one take per file (or per range of a file)
  {"pack": "animalpack", "name": "Wolf"}                   a pack preset, expanded by PACKS below
  {"pack": "unity", "package": "<.unitypackage or extracted dir>", "rig": "Assets/...", "takes": "Assets/.../*.fbx"}
  {"ref": "<catalog key>", ...}                            an entry of py/donors.json, fields overridden

A file spec is a path string or any of the first three forms. Common options:
  "yaw"      degrees about +Y applied to the whole donor, so it faces +Z like the targets
  "armature" armature object name when a file holds several
  "range"    [first, last] in the file's own frames (Unity clip ranges), sampled at 30 fps
  "map"      {primary donor bone: this donor's bone or null}, used when a class mixes donors

Licensed studio sources are extracted into the git-ignored work area, never into the repo.

Sampling reads evaluated pose matrices, so the importer's bone axes do not matter for positions.
The retargeter does need each rest frame's Y axis along the bone (towards its child), because a
limb that follows its donor points where the donor frame's Y points. Importers that keep node
axes (FBX from Maya or Max: bones along X) are re-aligned here by a constant per-bone turn that
is applied to the rest and to every sampled frame alike.
"""
import fnmatch
import glob
import json
import os
import re
import tarfile
import zipfile

import numpy as np

from .mathx import GLTF_FROM_BLENDER, axis_angle, min_arc, normalize, orthonormalize

FPS = 30
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(HERE, "donors.json")


# ------------------------------------------------------------------ files
def _unity_index(package, cache_dir):
    """{asset path: guid} of a .unitypackage (a tar.gz of <guid>/pathname + <guid>/asset), cached."""
    os.makedirs(cache_dir, exist_ok=True)
    stat = os.stat(package)
    key = re.sub(r"[^A-Za-z0-9]+", "_", os.path.basename(package))[:60]
    cache = os.path.join(cache_dir, f"{key}.{stat.st_size}.index.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    index = {}
    with tarfile.open(package, "r:gz") as tar:
        for member in tar:
            if member.name.endswith("/pathname"):
                index[tar.extractfile(member).read().decode("utf8").splitlines()[0]] = member.name.split("/")[0]
    json.dump(index, open(cache, "w"))
    return index


def _unity_extract(package, members, cache_dir):
    """Extracts asset paths from a Unity package into cache_dir (keeping their relative paths)."""
    index = _unity_index(package, cache_dir)
    root = os.path.join(cache_dir, re.sub(r"[^A-Za-z0-9]+", "_", os.path.splitext(os.path.basename(package))[0])[:60])
    want = {index[m] + "/asset": m for m in members if not os.path.exists(os.path.join(root, m))}
    missing = [m for m in members if m not in index]
    if missing:
        raise FileNotFoundError(f"{os.path.basename(package)} has no {missing[:3]}")
    if want:
        with tarfile.open(package, "r:gz") as tar:
            for member in tar:
                if member.name in want:
                    out = os.path.join(root, want[member.name])
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    with open(out, "wb") as dst:
                        dst.write(tar.extractfile(member).read())
    return {m: os.path.join(root, m) for m in members}


def resolve_file(spec, cache_dir):
    if isinstance(spec, str):
        spec = {"file": spec}
    for f in ([spec["file"]] if spec.get("file") else []) + spec.get("files", []):
        if os.path.exists(f):
            return f
    if spec.get("zip") and os.path.exists(spec["zip"]):
        os.makedirs(cache_dir, exist_ok=True)
        out = os.path.join(cache_dir, os.path.basename(spec["member"]))
        if not os.path.exists(out):
            with zipfile.ZipFile(spec["zip"]) as z, z.open(spec["member"]) as src, open(out, "wb") as dst:
                dst.write(src.read())
        return out
    if spec.get("unitypackage") and os.path.exists(spec["unitypackage"]):
        return _unity_extract(spec["unitypackage"], [spec["member"]], cache_dir)[spec["member"]]
    raise FileNotFoundError(f"donor file not found: {spec}")


# ------------------------------------------------------------------ packs
ANIMALPACK = os.environ.get("CREATURE_RIG_ANIMALPACK", "C:/Users/Borg/.t3/tmp/animalpack")


def _animalpack(spec, cache_dir):
    """janpec Animal pack deluxe: Models/<Name>_Rig.fbx (or <name>_rig_exp.FBX) plus one
    Animations/<Name>_<Take>.fbx per take. The Unity import ranges (clip-ranges.json, read from
    the package's .meta files) slice the _exp takes, which all share one long timeline."""
    root = os.path.join(spec.get("root", ANIMALPACK), "extracted/Assets/Animal pack deluxe")
    ranges = json.load(open(os.path.join(spec.get("root", ANIMALPACK), "clip-ranges.json")))
    name = spec["name"]
    files = [f for d in ("Models", "Animations") for f in glob.glob(os.path.join(root, d, "*")) if f.lower().endswith(".fbx")]
    stem = lambda f: os.path.splitext(os.path.basename(f))[0]
    mine = [f for f in files if stem(f).lower().startswith(name.lower() + "_")]
    rig = next((f for f in mine if "_rig" in stem(f).lower()), None)
    if rig is None:
        raise FileNotFoundError(f"animalpack has no rig for {name}")
    takes = {}
    for f in mine:
        if f == rig:
            continue
        take = re.sub(r"(_anim)?(_exp)?$", "", stem(f)[len(name) + 1:], flags=re.I)
        take = take[:1].upper() + take[1:]
        r = ranges.get(os.path.basename(f))
        takes[take] = {"file": f, **({"range": [r["first"], r["last"]]} if r else {})}
    return {"rig": rig, "takes": takes}


def _unity(spec, cache_dir):
    """A Unity package (or an already extracted copy of one): a rig member plus take members
    given by a glob; each take is the file's only clip (or its range)."""
    packages = spec["package"] if isinstance(spec["package"], list) else [spec["package"]]
    package = next((p for p in packages if os.path.exists(p)), None)
    if package is None:
        raise FileNotFoundError(f"unity pack: none of {packages} exists")
    if os.path.isdir(package):
        root = package
        members = [os.path.relpath(p, root).replace("\\", "/") for p in glob.glob(os.path.join(root, "Assets", "**", "*"), recursive=True)]
        fetch = lambda ms: {m: os.path.join(root, m) for m in ms}
    else:
        members = list(_unity_index(package, cache_dir))
        fetch = lambda ms: _unity_extract(package, ms, cache_dir)
    rig = [m for m in members if fnmatch.fnmatch(m.lower(), spec["rig"].lower())]
    take_members = sorted(m for m in members if fnmatch.fnmatch(m.lower(), spec["takes"].lower()) and m.lower().endswith(".fbx"))
    if not rig or not take_members:
        raise FileNotFoundError(f"unity pack {os.path.basename(package)}: rig {spec['rig']} ({len(rig)}), takes {spec['takes']} ({len(take_members)})")
    paths = fetch(rig[:1] + take_members)
    ranges = spec.get("ranges", {})
    takes = {}
    for m in take_members:
        take = os.path.splitext(os.path.basename(m))[0]
        takes[take] = {"file": paths[m], **({"range": ranges[take]} if take in ranges else {})}
    return {"rig": paths[rig[0]], "takes": takes}


PACKS = {"animalpack": _animalpack, "unity": _unity}


def expand(spec, cache_dir):
    """Resolves catalog references and pack presets to a plain file or rig+takes spec."""
    spec = dict(spec)
    if "ref" in spec:
        catalog = json.load(open(CATALOG))["donors"]
        base = dict(catalog[spec.pop("ref")])
        base.update(spec)
        spec = base
    if "pack" in spec:
        expanded = PACKS[spec["pack"]](spec, cache_dir)
        spec = {**{k: v for k, v in spec.items() if k not in ("takes", "rig")}, **expanded}
    return spec


# ------------------------------------------------------------------ donor
class Donor:
    """Rest data and sampled clips of one donor armature, in glTF axes (+Y up, facing +Z)."""

    def __init__(self, key, path):
        self.key = key
        self.path = path
        self.bones = []
        self.parent = {}
        self.rest_frame = {}
        self.rest_head = {}
        self.rest_tail = {}
        self.clips = {}
        self.report = {}
        self.map = None
        self.source = None

    def index(self, name):
        return self.bones.index(name)

    def children(self, name):
        return [b for b in self.bones if self.parent[b] == name]

    def roots(self):
        return [b for b in self.bones if self.parent[b] is None]

    def chain(self, names):
        """Joins takes authored to follow each other; the shared boundary frame is kept once."""
        key = "+".join(names)
        parts = [self.clips[n] for n in names]
        frames = np.concatenate([parts[0]["frames"]] + [p["frames"][1:] for p in parts[1:]])
        heads = np.concatenate([parts[0]["heads"]] + [p["heads"][1:] for p in parts[1:]])
        self.clips[key] = {"frames": frames, "heads": heads, "fps": FPS, "duration": (len(frames) - 1) / FPS}
        return key


def _import(path):
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False, anim_offset=0.0)
    elif ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
        scene = bpy.context.scene
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    return scene, scene.render.fps / scene.render.fps_base


def _armature(name=None):
    import bpy

    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("no armature")
    if name:
        return next(o for o in arms if o.name == name)
    return max(arms, key=lambda o: len(o.data.bones))


def _find_action(actions, name):
    found = actions.get(name) or next((a for n, a in actions.items() if n.endswith(name) or n.split("|")[-1] == name), None)
    if found:
        return found
    low = name.lower()
    return next((a for n, a in actions.items() if n.lower().endswith(low) or n.split("|")[-1].lower() == low), None)


def _sample(scene, arm, action, bones, file_fps, frame_range=None):
    """World rotation frames and heads of the named bones at 30 fps over the action (or range)."""
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and len(getattr(action, "slots", [])):
        arm.animation_data.action_slot = action.slots[0]
    start, end = frame_range if frame_range else action.frame_range
    step = file_fps / FPS
    count = int(round((end - start) / step)) + 1
    world = np.array(arm.matrix_world)
    C = GLTF_FROM_BLENDER
    frames = np.zeros((count, len(bones), 3, 3))
    heads = np.zeros((count, len(bones), 3))
    pose = arm.pose.bones
    for f in range(count):
        x = min(start + f * step, end)
        whole = int(np.floor(x + 1e-6))
        scene.frame_set(whole, subframe=max(0.0, x - whole))
        for i, bone in enumerate(bones):
            m = world @ np.array(pose[bone].matrix)
            frames[f, i] = orthonormalize(C @ m[:3, :3])
            heads[f, i] = C @ m[:3, 3]
    return frames, heads


def _align(donor):
    """Turns each rest frame (and every sampled frame by the same constant) so its Y axis points
    at the bone's child, when the importer kept node axes instead. Returns the median misalignment
    (degrees) that decided it."""
    def child_dir(b):
        kids = [c for c in donor.children(b) if np.linalg.norm(donor.rest_head[c] - donor.rest_head[b]) > 1e-5]
        if not kids:
            return None
        return normalize(np.mean([donor.rest_head[c] for c in kids], axis=0) - donor.rest_head[b])

    single = [b for b in donor.bones if len(donor.children(b)) == 1 and child_dir(b) is not None]
    errs = [np.degrees(np.arccos(np.clip(np.dot(donor.rest_frame[b][:, 1], child_dir(b)), -1, 1))) for b in single]
    median = float(np.median(errs)) if errs else 0.0
    if median < 5.0:
        return median, False
    K = {}
    for b in donor.bones:  # parents come first in Blender's bone order
        D = donor.rest_frame[b]
        d = child_dir(b)
        if d is None:
            p = donor.parent[b]
            d = donor.rest_frame[p][:, 1] if p else D[:, 1]  # the parent is already re-aligned
        D2 = min_arc(D[:, 1], d) @ D
        K[b] = D.T @ D2
        length = np.linalg.norm(donor.rest_tail[b] - donor.rest_head[b])
        kids = [c for c in donor.children(b) if np.linalg.norm(donor.rest_head[c] - donor.rest_head[b]) > 1e-5]
        if len(kids) == 1:
            length = np.linalg.norm(donor.rest_head[kids[0]] - donor.rest_head[b])
        donor.rest_frame[b] = D2
        donor.rest_tail[b] = donor.rest_head[b] + D2[:, 1] * length
    Ks = np.array([K[b] for b in donor.bones])
    for clip in donor.clips.values():
        clip["frames"] = np.einsum("fbij,bjk->fbik", clip["frames"], Ks)
    return median, True


def _turn(donor, R):
    for b in donor.bones:
        donor.rest_frame[b] = R @ donor.rest_frame[b]
        donor.rest_head[b] = R @ donor.rest_head[b]
        donor.rest_tail[b] = R @ donor.rest_tail[b]
    for clip in donor.clips.values():
        clip["frames"] = np.einsum("ij,fbjk->fbik", R, clip["frames"])
        clip["heads"] = clip["heads"] @ R.T


def load(key, spec, cache_dir, clip_names=None):
    """Imports the donor and samples the named takes (all takes when clip_names is None)."""
    import bpy

    spec = expand(spec, cache_dir)
    takes = spec.get("takes")
    rest_file = resolve_file(spec.get("rig") or spec, cache_dir)
    scene, file_fps = _import(rest_file)
    arm = _armature(spec.get("armature"))
    donor = Donor(key, rest_file)
    world = np.array(arm.matrix_world)
    C = GLTF_FROM_BLENDER
    for b in arm.data.bones:
        donor.bones.append(b.name)
        donor.parent[b.name] = b.parent.name if b.parent else None
        m = world @ np.array(b.matrix_local)
        donor.rest_frame[b.name] = orthonormalize(C @ m[:3, :3])
        donor.rest_head[b.name] = C @ m[:3, 3]
        donor.rest_tail[b.name] = C @ (world @ np.append(np.array(b.tail_local), 1.0))[:3]

    available = sorted(takes) if takes else sorted(a.name for a in bpy.data.actions)
    donor.report = {"file": rest_file, "fps": file_fps, "bones": len(donor.bones), "takes": available}
    if clip_names is None:
        clip_names = available
    lookup = {t.lower(): t for t in takes} if takes else {}
    by_file = {}
    for name in clip_names:
        if takes:
            take = takes.get(name) or takes.get(lookup.get(name.lower(), ""))
            if take is None:
                raise KeyError(f"{key}: no take {name}; has {available}")
            take = take if isinstance(take, dict) else {"file": take}
            by_file.setdefault(resolve_file(take["file"], cache_dir), []).append((name, take))
        else:
            by_file.setdefault(rest_file, []).append((name, {"range": spec.get("ranges", {}).get(name)}))
    current = rest_file
    for path, wanted in by_file.items():
        if path != current:
            scene, file_fps = _import(path)
            current = path
        take_arm = _armature(spec.get("armature"))
        actions = {a.name: a for a in bpy.data.actions}
        missing = [b for b in donor.bones if b not in take_arm.pose.bones]
        if missing:
            raise KeyError(f"{key}: {os.path.basename(path)} lacks bones {missing[:5]}")
        assigned = take_arm.animation_data.action if take_arm.animation_data else None
        # A take file carries its own copy of the skeleton; report how far its rest is from the rig's.
        tw = np.array(take_arm.matrix_world)
        rest_delta = max(float(np.linalg.norm(C @ (tw @ np.array(take_arm.data.bones[b].matrix_local))[:3, 3] - donor.rest_head[b])) for b in donor.bones)
        for name, take in wanted:
            if take.get("action"):
                action = _find_action(actions, take["action"])
            elif takes:
                action = assigned or next(iter(actions.values()), None)
            else:
                action = _find_action(actions, name)
            if action is None:
                raise KeyError(f"{key}: no clip {name} in {os.path.basename(path)}; has {sorted(actions)[:80]}")
            frames, heads = _sample(scene, take_arm, action, donor.bones, file_fps, take.get("range"))
            donor.clips[name] = {"frames": frames, "heads": heads, "fps": FPS, "duration": (len(frames) - 1) / FPS,
                                 "source": {"file": path, "action": action.name, "fileFps": file_fps,
                                            "range": [float(v) for v in (take.get("range") or action.frame_range)],
                                            "restDelta": rest_delta}}
    donor.report["misalignedDegrees"], donor.report["realigned"] = _align(donor)
    if spec.get("yaw"):
        _turn(donor, axis_angle([0.0, 1.0, 0.0], np.radians(spec["yaw"])))
    donor.report["yaw"] = spec.get("yaw", 0)
    donor.map = spec.get("map")
    donor.source = spec.get("source")
    return donor


def facing(donor):
    """Horizontal forward estimates from the rest pose: from the root to the head bones, and along
    the toe bones. Both should be about [0, 0, 1]; set the donor's "yaw" when they are not."""
    heads, tails = donor.rest_head, donor.rest_tail
    root = heads[donor.roots()[0]]
    flat = lambda v: np.round(normalize(np.array([v[0], 0.0, v[2]])), 3).tolist() if np.hypot(v[0], v[2]) > 1e-6 else None
    named = lambda pat: [b for b in donor.bones if re.search(pat, b, re.I)]
    out = {}
    head = named(r"head")
    if head:
        out["rootToHead"] = flat(np.mean([heads[b] for b in head] + [tails[b] for b in head], axis=0) - root)
    toes = [b for b in named(r"toe") if not donor.children(b) or re.search(r"toes?_?0?1", b, re.I)]
    if toes:
        out["toes"] = flat(np.mean([tails[b] - heads[b] for b in toes], axis=0))
    return out
