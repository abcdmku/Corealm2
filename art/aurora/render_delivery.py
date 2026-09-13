"""Render the complete Aurora delivery in one Blender process.

blender -b art/aurora/aurora-set.blend --disable-autoexec
    --python art/aurora/render_delivery.py

The proven renderer validates before every view. This wrapper restores the
loaded rest assembly between views instead of reimporting or reopening it.
Neither the source .blend nor the GLBs are saved or changed.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time

import bpy


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
PIECES = ("hood", "robe", "leggings", "boots", "wraps")


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class RenderReset:
    """Restore precisely the state mutated by render_studio.main()."""

    # Objects first, then their containers and data, then material/world nodes.
    TEMPORARY_DATA = ("objects", "collections", "meshes", "cameras", "lights", "materials", "worlds")

    def __init__(self):
        self.scene = bpy.context.scene
        self.camera, self.world = self.scene.camera, self.scene.world
        self.ids = {name: {item.as_pointer() for item in getattr(bpy.data, name)}
                    for name in self.TEMPORARY_DATA}
        self.visibility = [(obj, obj.hide_render) for obj in self.scene.objects]
        self.pose = [(bone, bone.matrix_basis.copy(), {
                        "location": bone.location.copy(), "scale": bone.scale.copy(),
                        "rotation_mode": bone.rotation_mode,
                        "rotation_quaternion": bone.rotation_quaternion.copy(),
                        "rotation_euler": bone.rotation_euler.copy(),
                        "rotation_axis_angle": list(bone.rotation_axis_angle)})
                     for obj in self.scene.objects if obj.type == "ARMATURE"
                     for bone in obj.pose.bones]
        assert not any(obj.type in ("LIGHT", "CAMERA") for obj in self.scene.objects), \
            "Expected the canonical assembly without a saved studio."

    def restore(self):
        self.scene.camera, self.scene.world = self.camera, self.world
        for name in self.TEMPORARY_DATA:
            datablocks = getattr(bpy.data, name)
            for item in list(datablocks):
                if item.as_pointer() not in self.ids[name]:
                    datablocks.remove(item, do_unlink=True)
        for obj, visible in self.visibility:
            obj.hide_render = visible
        # Restore the original transform channels rather than decomposing a
        # matrix, which can introduce quaternion round-off in the exact manifest.
        for bone, _, channels in self.pose:
            for name, value in channels.items():
                setattr(bone, name, value)
        bpy.context.view_layer.update()
        assert all({item.as_pointer() for item in getattr(bpy.data, name)} == self.ids[name]
                   for name in self.TEMPORARY_DATA), "Temporary studio data did not reset."
        assert all(obj.hide_render == visible for obj, visible in self.visibility)
        assert all(bone.matrix_basis == matrix_basis for bone, matrix_basis, _ in self.pose), \
            "Imported rest pose did not reset."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--icon-size", type=int, default=512)
    parser.add_argument("--report", type=Path, default=ROOT / "render-delivery.json")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    assert 64 <= args.icon_size <= 8192
    source = Path(bpy.data.filepath).resolve()
    assert source.is_file() and source.suffix.lower() == ".blend", "Load the final saved Aurora .blend first."
    source_hash = sha256(source)
    renderer = load_module("aurora_delivery_renderer", ROOT / "render_studio.py")
    validator = load_module("aurora_delivery_validator", ROOT / "validate_blender.py")
    summary_path = validator.checked_output(args.report, source, ".json")
    validation_path = ROOT / "aurora-set-validation.json"
    assert summary_path != validation_path.resolve(), "Batch report must not replace the final validation."
    reset = RenderReset()
    jobs = [(ROOT / "aurora-studio.png", None, "front-three-quarter", False),
            (ROOT / "renders/frostweave_robe-back.png", "robe", "back-three-quarter", False)]
    jobs.extend((ROOT / f"renders/frostweave_{piece}.png", piece, "front-three-quarter", False)
                for piece in PIECES)
    jobs.extend((ROOT / f"icons/frostweave_{piece}.png", piece, "front-three-quarter", True)
                for piece in PIECES)
    outputs = {path.resolve() for path, _, _, _ in jobs}
    assert summary_path not in outputs and summary_path not in {path.with_suffix(".json") for path in outputs}
    original_argv = sys.argv
    started = time.monotonic()
    reports = []
    try:
        for index, (output, piece, view, transparent) in enumerate(jobs, 1):
            print(f"AURORA_DELIVERY_START={index}/{len(jobs)} {output.relative_to(ROOT)}", flush=True)
            sys.argv = [__file__, "--", "--output", str(output), "--arms-down", "--view", view]
            if piece:
                sys.argv += ["--piece", piece]
            if transparent:
                sys.argv += ["--transparent", "--size", str(args.icon_size)]
            try:
                renderer.main()
            finally:
                reset.restore()
            report_path = output.with_suffix(".json")
            report = json.loads(report_path.read_text(encoding="utf-8"))
            assert report["sourceSha256"] == source_hash
            assert report["renderSha256"] == sha256(output)
            assert report["sourceBlendHashUnchanged"] and report["sourceFileHashesStillMatchAfterRender"]
            assert report["transparent"] == transparent and report["floorPresent"] != transparent
            if transparent:
                assert report["colorMode"] == "RGBA" and report["resolution"] == [args.icon_size] * 2
            reports.append({"output": str(output.relative_to(REPO_ROOT)).replace("\\", "/"),
                            "report": str(report_path.relative_to(REPO_ROOT)).replace("\\", "/"),
                            "sha256": report["renderSha256"], "piece": piece,
                            "view": view, "transparent": transparent})
            print(f"AURORA_DELIVERY_DONE={index}/{len(jobs)} {output.name}", flush=True)
    finally:
        sys.argv = original_argv
    # A final exact mesh/rig/material/decoded-image manifest check proves that
    # the last in-memory reset also returned to the unchanged loaded assembly.
    validation = validator.validate(validation_path)
    assert validation["sourceSha256"] == source_hash == sha256(source)
    summary = {"set": "frostweave", "title": "T90 Aurora", "candidateId": validation["candidateId"],
               "source": str(source), "sourceSha256": source_hash,
               "sourceFiles": validation["sourceFiles"], "renders": reports,
               "studioRenders": 7, "transparentIcons": 5,
               "oneBlenderProcess": True, "reopenedBetweenRenders": False,
               "exactAssemblyRestoredAfterEveryRender": True,
               "sourceBlendHashUnchanged": True, "finalExactValidationPassed": True,
               "elapsedSeconds": round(time.monotonic() - started, 2), "passed": True}
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print("AURORA_RENDER_DELIVERY=" + json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
