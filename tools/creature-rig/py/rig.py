"""Blender stage of the creature rig pipeline: fit, skin and retarget one creature.

  PYTHONPATH=D:/CorealmAgentCache/bpy-5.2 py -3.13 tools/creature-rig/py/rig.py <work dir>

Reads <work>/intake.json and <work>/mesh.glb (from intake.mjs), loads the body class module
classes/<class>.py and its donor map classes/<class>.donors.json, and writes <work>/rig.json (bind
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
from crlib.retarget import Retargeter, clip_tracks, lying_lift  # noqa: E402
from crlib.skin import bone_heat, skin  # noqa: E402


def main(work):
    t0 = time.time()
    intake = json.load(open(os.path.join(work, "intake.json")))
    cls = importlib.import_module(f"classes.{intake['class']}")
    donor_map = json.load(open(os.path.join(HERE, "classes", f"{intake['class']}.donors.json")))
    profile = dict(donor_map["profiles"][intake["profile"]])
    profile.update(intake.get("profileOverrides") or {})
    clips = profile["clips"]

    cache = os.path.join(os.path.dirname(os.path.dirname(work)), "donors")
    needed = {}
    for spec in clips.values():
        takes = spec["clip"] if isinstance(spec["clip"], list) else [spec["clip"]]
        needed.setdefault(spec["donor"], set()).update(takes)
    primary_key = donor_map.get("primary", next(iter(needed)))
    needed.setdefault(primary_key, set())
    donors = {}
    for key, names in needed.items():
        donors[key] = donors_mod.load(key, donor_map["donors"][key], cache, sorted(names))
    for spec in clips.values():
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
    heat = bone_heat(obj, sk)
    extra = cls.cloth(body, sk, profile, heat) if hasattr(cls, "cloth") else None
    W, skin_report = skin(obj, V, F, sk, heat=heat, passes=profile.get("smoothPasses", 2),
                          rigid=profile.get("rigidPieces", True), overrides=extra)
    order = np.argsort(-W, axis=1)[:, :4]
    weights = np.take_along_axis(W, order, axis=1)
    turns = cls.bind_turns(sk, profile) if hasattr(cls, "bind_turns") else {}
    bind_V, bind_rot = V, None
    if turns:
        bind_V, bind_rot = rebind.apply(sk, V, order, weights, rebind.repose(sk, turns))
    sk.solve_frames(primary)
    plan = cls.plan(sk, body, profile)

    plan.setdefault("hip_mode", profile.get("hipMode", "legs"))
    # Each donor drives the skeleton through its own rest frames (Skeleton.frame is the primary's);
    # a class maps a secondary donor's bone names with donor_map() or the donor spec's "map".
    bindings = {}
    for key, d in donors.items():
        bone_map = cls.donor_map(sk, d, profile) if hasattr(cls, "donor_map") else None
        bindings[key] = {"map": bone_map if bone_map is not None else getattr(d, "map", None), "primary": key == primary_key}

    out_clips = []
    for state, spec in clips.items():
        r = Retargeter(sk, donors[spec["donor"]], plan, bindings[spec["donor"]]["map"], primary=bindings[spec["donor"]]["primary"])
        if r.bind.unmapped or r.skipped_legs:
            notes.setdefault("donorGaps", {})[spec["donor"]] = {"unmapped": r.bind.unmapped, "legsWithoutIk": r.skipped_legs}
        result = r.sample(state, spec)
        if plan["chains"]:
            result = r.secondary(result, plan["chains"], plan["colliders"])
        lift = lying_lift(sk, bind_V, order, weights, result, plan["hips"], body.height)
        root = sk.bones[0]
        pelvis_local = [(root.frame.T @ (p - root.head)).tolist() for p in result["pelvis"]]
        out_clips.append({
            "name": state, "fps": result["fps"], "loop": result["loop"], "frames": result["n"],
            "donor": f"{spec['donor']}:{spec['clip']}", "legScale": r.scale, "lyingLift": lift,
            "hipMode": result["hipMode"], "hipSource": result["hipSource"], "ikMiss": round(result["ikMiss"], 4),
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
        "donors": {k: d.source or k for k, d in donors.items()},
        "seconds": round(time.time() - t0, 1),
    }
    json.dump(rig, open(os.path.join(work, "rig.json"), "w"), default=float)
    print(json.dumps({"asset": intake["assetId"], "bones": len(names), "clips": [c["name"] for c in out_clips],
                      "skin": {k: skin_report[k] for k in ("heatMissingShare", "influences", "rigidPieces")},
                      "seconds": rig["seconds"]}, default=float))


if __name__ == "__main__":
    main(os.path.abspath(sys.argv[-1]))
