"""Package five frozen candidate GLBs as an editable, packed armor .blend.

blender -b --factory-startup --disable-autoexec --python art/aurora/package_blender.py
    -- --set frostweave --candidate-id ACCEPTED_MARKER --source-dir DIRECTORY --output SET.blend

Call after the root agent has frozen the candidate for the requested preview or final package.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys

import bpy


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", choices=("frostweave",), default="frostweave")
    parser.add_argument("--candidate-id", required=True)
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    source = (args.source_dir or REPO_ROOT / "art/item-models/candidates/armor-frostweave-aurora/models/items").resolve()
    output = (args.output or ROOT / "aurora-set.blend").resolve()
    assert output.suffix.lower() == ".blend", "Package output must use the .blend extension."
    expected = {f"frostweave_{piece}.glb" for piece in ("hood", "robe", "leggings", "boots", "wraps")}
    assert {path.name for path in source.glob("*.glb")} == expected, "Expected exactly the five frozen frostweave GLBs."
    validator = load_module("armor_validator", ROOT / "validate_blender.py")
    packager = load_module("proven_armor_packager", REPO_ROOT / "tools/item-models/starhide/save_blender.py")
    # The established importer compares these before and after rig consolidation.
    # Use exact hashes in addition to the original structural counts.
    packager.mesh_fingerprint = validator.mesh_fingerprint
    old_argv = sys.argv
    try:
        sys.argv = [__file__, "--", "--candidate-id", args.candidate_id,
                    "--source-dir", str(source), "--output", str(output)]
        packager.main()
    finally:
        sys.argv = old_argv
    title = "T90 Aurora"
    scene = bpy.context.scene
    scene.name = f"{title} armor set"
    scene["armor_set"] = args.set
    scene["armor_title"] = title
    scene["armor_tier"] = 90
    for collection in bpy.data.collections:
        if collection.name == "Starhide armor set":
            collection.name = f"{title} armor set"
    for obj in scene.objects:
        if obj.type == "ARMATURE":
            obj.name = f"{title} rig"
            obj.data.name = f"{title} skeleton"
    iridescence = load_module("armor_iridescence", ROOT / "iridescence_blender.py")
    scene["iridescence_preservation"] = json.dumps(iridescence.apply_preview(source), sort_keys=True)
    scene["asset_manifest"] = json.dumps(validator.asset_manifest(), sort_keys=True)
    scene["package_script"] = "art/aurora/package_blender.py"
    for text in bpy.data.texts:
        if text.name.startswith("READ ME"):
            text.clear()
            text.name = f"READ ME - {title}.txt"
            text.write(
                f"{title.upper()} ARMOR SET\n\n"
                "Editable assembly imported from five frozen candidate GLBs.\n"
                "Gameplay acceptance is recorded separately by the root agent in the delivery evidence.\n"
                "Each source item has its own collection. The Rig collection has one shared native skeleton.\n"
                "Mesh coordinates, topology, UVs, weights, imported material inputs, sheen, and texture pixels are preserved.\n"
                "All source iridescent materials add an editable EEVEE thin-film preview, including fabric and gems.\n"
                "A sampled thin-film curve applies restrained view-angle tint to the original base-color chain.\n"
                "This is not an exact glTF BRDF match. Source factor, IOR and thickness remain in material properties.\n"
                "All file textures are packed and decoded. The saved rig remains in its imported rest pose.\n"
                "Studio renders use a temporary scene and never save a pose, light, camera or floor into this file.\n\n"
                f"Candidate: {args.candidate_id}\n"
                "Rebuild with art/aurora/package_blender.py after the candidate is frozen.\n"
                "Reopen with art/aurora/validate_blender.py to check source hashes and exact asset data.\n"
                "The editing view and studio renders are not gameplay acceptance evidence.\n"
            )
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False, compress=True)
    print("ARMOR_BLEND_RESULT=" + json.dumps({"set": args.set, "candidateId": args.candidate_id,
          "sourceDirectory": str(source), "output": str(output), "outputBytes": output.stat().st_size}))


if __name__ == "__main__":
    main()
