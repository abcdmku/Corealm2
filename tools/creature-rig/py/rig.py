"""Blender stage of the creature rig pipeline: fit, skin and retarget one creature.

  PYTHONPATH=D:/CorealmAgentCache/bpy-5.2 py -3.13 tools/creature-rig/py/rig.py [--donors <dir>] <work dir>

Reads <work>/intake.json and <work>/mesh.glb (from intake.mjs) and the asset config
tools/creature-rig/assets/<id>.json (class, profile, profileOverrides; read here, not cached by
the intake), loads the body class module classes/<class>.py and its donor map
classes/<class>.donors.json, and writes <work>/rig.json (bind
skeleton, per-vertex weights, sampled clips) plus <work>/fit.png for review. The assembler writes
the GLB from rig.json.
"""
import importlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from crlib import donor as donors_mod  # noqa: E402
from crlib import labels as labels_mod  # noqa: E402
from crlib import rebind  # noqa: E402
from crlib.body import Body, load_blender_mesh  # noqa: E402
from crlib.debug import fit_sheet  # noqa: E402
from crlib.retarget import Retargeter, clip_tracks, lying_lift, overlay  # noqa: E402
from crlib.skin import robust_heat, skin  # noqa: E402


def merge(base, over):
    """profileOverrides merge: dictionaries merge key by key (so {"clips": {"Walk": {"speed": 0.8}}}
    changes one field of one clip); anything else replaces."""
    out = dict(base)
    for k, v in over.items():
        out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def asset_config(asset_id):
    return json.load(open(os.path.join(HERE, "..", "assets", f"{asset_id}.json")))


def closeup_joints(cls, sk, profile):
    """Joints the review close-ups frame: the class's closeup_joints(sk, profile) if it has one,
    else the humanoid set that exists, else the first joint of each limb kind."""
    if hasattr(cls, "closeup_joints"):
        return [j for j in cls.closeup_joints(sk, profile) if j in sk]
    joints = [j for j in ("upperarm_l", "lowerarm_l", "thigh_l", "calf_l", "spine_02") if j in sk]
    if joints:
        return joints
    for kind in ("arm", "leg", "wing", "tail", "body"):
        bones = [b.name for b in sk.bones if b.kind == kind and sk.children(b.name)]
        joints += bones[:2]
    return joints[:5]


def recoil_bones(cls, sk, plan, profile, body):
    """Bones the runtime's additive Hit recoil may move (written as node extras hitRecoil: true).
    The class's recoil_bones(sk, plan, profile), else the profile's recoilBones, else every
    deforming bone except the root, the hips, legs (kind leg or in the plan's leg chains), cloth
    springs and chains lying on the floor (a crawler's planted body)."""
    if hasattr(cls, "recoil_bones"):
        return [b for b in cls.recoil_bones(sk, plan, profile) if b in sk]
    if profile.get("recoilBones"):
        return [b for b in profile["recoilBones"] if b in sk]
    from crlib.retarget import normalize_leg

    legs = {b for leg in map(normalize_leg, plan.get("legs", [])) for b in leg["chain"] + [leg["foot"], leg["toe"]] if b}
    floor = 0.1 * body.height
    return [b.name for b in sk.bones
            if b.deform and b.kind not in ("root", "leg", "cloth") and b.name != plan["hips"] and b.name not in legs
            and not (b.head[1] < floor and b.tail[1] < floor)]


def main(work, cache=None):
    t0 = time.time()
    intake = json.load(open(os.path.join(work, "intake.json")))
    config = asset_config(intake["assetId"])
    intake["class"], intake["profile"] = config["class"], config["profile"]
    cls = importlib.import_module(f"classes.{config['class']}")
    donor_map = json.load(open(os.path.join(HERE, "classes", f"{config['class']}.donors.json")))
    profile = merge(donor_map["profiles"][config["profile"]], config.get("profileOverrides") or {})
    clips = profile["clips"]

    cache = cache or os.path.join(os.path.dirname(os.path.dirname(work)), "donors")
    needed = {}
    # A clip spec, and each of its donor layers, names a donor and a take (or takes that chain).
    specs = [x for spec in clips.values() for x in [spec, *spec.get("layers", [])]]
    for spec in specs:
        takes = spec["clip"] if isinstance(spec["clip"], list) else [spec["clip"]]
        needed.setdefault(spec["donor"], set()).update(takes)
    primary_key = donor_map.get("primary", next(iter(needed)))
    needed.setdefault(primary_key, set())
    donors = {}
    for key, names in needed.items():
        # "_work" tells a generated donor (an authored pack) where this asset's work files are.
        donors[key] = donors_mod.load(key, {**donor_map["donors"][key], "_work": work}, cache, sorted(names))
    for spec in specs:
        if isinstance(spec["clip"], list):
            # A take authored to chain into the next (a strike and its recovery) plays as one clip.
            spec["clip"] = donors[spec["donor"]].chain(spec["clip"])
    primary = donors[primary_key]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    obj, V, F = load_blender_mesh(os.path.join(work, "mesh.glb"))
    body = Body(V, F)
    source = intake.get("source")
    if source and source.get("kind") == "tripo-rig" and labels_mod.is_generic(source["joints"]):
        # bone_0 ... bone_N rigs carry no names: label the tree (legs by side and order, spine,
        # neck, head, jaw, tail, wings) for the class's fit().
        source["labels"] = labels_mod.label(source["joints"], height=body.height)
    sk, notes = cls.fit(body, primary, profile, source=source)
    heat, heat_report = robust_heat(obj, sk, body)
    extra = cls.cloth(body, sk, profile, heat) if hasattr(cls, "cloth") else None
    W, skin_report = skin(obj, V, F, sk, heat=heat, passes=profile.get("smoothPasses", 2),
                          rigid=profile.get("rigidPieces", True), overrides=extra,
                          rigid_exclude=list(profile.get("rigidExclude", [])) + list(getattr(sk, "rigid_exclude", [])))
    order = np.argsort(-W, axis=1)[:, :4]
    skin_report.update(heat_report)
    weights = np.take_along_axis(W, order, axis=1)
    turns = cls.bind_turns(sk, profile) if hasattr(cls, "bind_turns") else {}
    bind_V, bind_rot = V, None
    if turns:
        bind_V, bind_rot = rebind.apply(sk, V, order, weights, rebind.repose(sk, turns))
    sk.solve_frames(primary)
    plan = cls.plan(sk, body, profile)

    plan.setdefault("hip_mode", profile.get("hipMode", "legs"))
    plan.setdefault("hover", profile.get("hover"))
    # Each donor drives the skeleton through its own rest frames (Skeleton.frame is the primary's);
    # a class maps a secondary donor's bone names with donor_map() or the donor spec's "map".
    bindings = {}
    for key, d in donors.items():
        bone_map = cls.donor_map(sk, d, profile) if hasattr(cls, "donor_map") else None
        bindings[key] = {"map": bone_map if bone_map is not None else getattr(d, "map", None), "primary": key == primary_key}

    def retargeter(key):
        return Retargeter(sk, donors[key], plan, bindings[key]["map"], primary=bindings[key]["primary"],
                          skin=(bind_V, order, weights))

    out_clips = []
    for state, spec in clips.items():
        r = retargeter(spec["donor"])
        if r.bind.unmapped or r.skipped_legs:
            notes.setdefault("donorGaps", {})[spec["donor"]] = {"unmapped": r.bind.unmapped, "legsWithoutIk": r.skipped_legs}
        result = r.sample(state, spec)
        for layer in spec.get("layers", []):
            # A body subset (listed bones, or bones of the listed kinds) driven by another donor's
            # take in the same clip, e.g. wings from a flyer on a body from a walker.
            bones = [b.name for b in sk.bones if b.name in layer.get("bones", []) or b.kind in layer.get("kinds", [])]
            lr = retargeter(layer["donor"])
            overlay(result, lr.sample(state, {"loop": spec.get("loop"), **layer, "ik": False}), bones)
        if plan["chains"]:
            result = r.secondary(result, plan["chains"], plan["colliders"])
        lift = lying_lift(sk, bind_V, order, weights, result, plan["hips"], body.height)
        root = sk.bones[0]
        pelvis_local = [(root.frame.T @ (p - root.head)).tolist() for p in result["pelvis"]]
        out_clips.append({
            "name": state, "fps": result["fps"], "loop": result["loop"], "frames": result["n"],
            "donor": f"{spec['donor']}:{spec['clip']}", "legScale": r.scale, "lyingLift": lift,
            "hipMode": result["hipMode"], "hipSource": result["hipSource"], "ikMiss": round(result["ikMiss"], 4),
            "speed": float(spec.get("speed", 1.0)), "soleLift": round(result["soleLift"], 4), "hover": round(result["hover"], 4),
            "layers": [f"{x['donor']}:{x['clip']}" for x in spec.get("layers", [])],
            "tracks": clip_tracks(sk, result), "hipsTranslation": pelvis_local,
        })

    names = sk.names()
    thin, _ = body.thin_vertices()
    fit_sheet(os.path.join(work, "fit.png"), bind_V, sk, intake["assetId"], thin=thin, weights=(names, W))
    rig = {
        "assetId": intake["assetId"], "class": intake["class"], "profile": intake["profile"],
        "hips": plan["hips"],
        "skeleton": sk.to_json(),
        "vertices": np.round(V, 6).tolist(),
        "bindVertices": None if bind_rot is None else np.round(bind_V, 6).tolist(),
        "bindRotations": None if bind_rot is None else np.round(bind_rot, 6).tolist(),
        "rebound": sorted(turns),
        "joints": order.tolist(), "weights": np.round(weights, 5).tolist(),
        "clips": out_clips,
        "fit": notes, "skin": skin_report,
        "closeup": closeup_joints(cls, sk, profile),
        "recoil": recoil_bones(cls, sk, plan, profile, body),
        "donors": {k: d.source or k for k, d in donors.items()},
        "seconds": round(time.time() - t0, 1),
    }
    json.dump(rig, open(os.path.join(work, "rig.json"), "w"), default=float)
    print(json.dumps({"asset": intake["assetId"], "bones": len(names), "clips": [c["name"] for c in out_clips],
                      "skin": {k: skin_report[k] for k in ("heatSource", "heatMissingMesh", "heatMissingShare", "influences", "rigidPieces")},
                      "seconds": rig["seconds"]}, default=float))


if __name__ == "__main__":
    argv = sys.argv[1:]
    donors_dir = argv[argv.index("--donors") + 1] if "--donors" in argv else None
    main(os.path.abspath(argv[-1]), donors_dir)
