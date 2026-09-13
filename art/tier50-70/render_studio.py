"""Render a verified armor .blend with temporary studio lighting and optional arm pose.

blender -b SET.blend --disable-autoexec --python art/tier50-70/render_studio.py
    -- --output SET-studio.png --arms-down

Only the image and JSON reports are written. The saved armor stays unchanged.
Pass --piece hood|robe|leggings|boots|wraps for an isolated, automatically framed garment.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--validation-output", type=Path)
    parser.add_argument("--arms-down", action="store_true")
    parser.add_argument("--piece", choices=("hood", "robe", "leggings", "boots", "wraps"))
    parser.add_argument("--view", choices=("front-three-quarter", "back-three-quarter", "front"), default="front-three-quarter")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    source = Path(bpy.data.filepath).resolve()
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    piece_suffix = f"-{args.piece}" if args.piece else ""
    output = (args.output or source.with_name(source.stem.replace("-set", "") + piece_suffix + "-studio.png")).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path = (args.report or output.with_suffix(".json")).resolve()
    validation_path = (args.validation_output or output.with_name(output.stem.replace("-studio", "") + "-validation.json")).resolve()
    spec = importlib.util.spec_from_file_location("armor_validator", ROOT / "validate_blender.py")
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    output = validator.checked_output(output, source, ".png")
    report_path = validator.checked_output(report_path, source, ".json")
    validation_path = validator.checked_output(validation_path, source, ".json")
    assert len({output, report_path, validation_path}) == 3, "Image and report paths must be distinct."
    assert not (report_path.exists() and validation_path.exists()
                and report_path.samefile(validation_path)), "Report paths must name different files."
    validation = validator.validate(validation_path)
    scene = bpy.context.scene
    all_armor = [obj for obj in scene.objects if obj.type == "MESH"]
    def source_markers(obj):
        return {value for value in [obj.get("source_glb"),
                *(collection.get("source_glb") for collection in obj.users_collection)] if value}
    armor = all_armor
    if args.piece:
        expected_file = f"{validation['set']}_{args.piece}.glb"
        armor = [obj for obj in all_armor if expected_file in source_markers(obj)]
        assert armor, f"No production meshes match {expected_file}."
        for obj in all_armor:
            obj.hide_render = obj not in armor
    rigs = [obj for obj in scene.objects if obj.type == "ARMATURE"]
    pose_name = "saved rest pose"
    if args.arms_down:
        for name, degrees in [("upperarm_l", 62), ("upperarm_r", -62)]:
            bone = rigs[0].pose.bones[name]
            pivot = bone.head.copy()
            bone.matrix = (Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(degrees), 4, "Y")
                           @ Matrix.Translation(-pivot) @ bone.matrix)
        bpy.context.view_layer.update()
        pose_name = "temporary arms lowered 62 degrees; saved rest pose unchanged"
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 1800, 1600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 30
    scene.render.film_transparent = False
    scene.render.filepath = str(output)
    scene.render.use_file_extension = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.65
    scene.eevee.taa_render_samples = 64
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = [obj.evaluated_get(depsgraph) for obj in armor]
    if args.piece:
        # Fit the rendered skin, including the temporary pose, without changing mesh coordinates.
        corners = [obj.matrix_world @ vertex.co for obj in evaluated for vertex in obj.data.vertices]
    else:
        corners = [obj.matrix_world @ Vector(corner) for obj in evaluated for corner in obj.bound_box]
    minimum = Vector(tuple(min(corner[axis] for corner in corners) for axis in range(3)))
    maximum = Vector(tuple(max(corner[axis] for corner in corners) for axis in range(3)))
    assembled_target = Vector((0.0, 0.03, 0.94))
    target = (minimum + maximum) / 2 if args.piece else assembled_target.copy()
    studio = bpy.data.collections.new("Studio render only")
    scene.collection.children.link(studio)

    def studio_object(name, data):
        obj = bpy.data.objects.new(name, data)
        studio.objects.link(obj)
        return obj

    def aim(obj, at):
        obj.rotation_euler = (Vector(at) - obj.location).to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("Studio slate environment")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.060, 0.070, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
    scene.world = world
    floor_z = minimum.z - 0.003
    floor_mesh = bpy.data.meshes.new("Studio floor mesh")
    floor_mesh.from_pydata([(-200, -200, floor_z), (200, -200, floor_z),
                           (200, 200, floor_z), (-200, 200, floor_z)], [], [(0, 1, 2, 3)])
    floor = studio_object("Studio floor", floor_mesh)
    floor_material = bpy.data.materials.new("Studio matte slate")
    floor_material.use_nodes = True
    shader = floor_material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (0.024, 0.030, 0.042, 1)
    shader.inputs["Roughness"].default_value = 0.64
    floor.data.materials.append(floor_material)

    def area(name, position, energy, color, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.color, data.shape, data.size = energy, color, "DISK", size
        obj = studio_object(name, data)
        obj.location = position
        aim(obj, target)

    area("Neutral large key", (-2.2, -3.2, 4.0), 160, (1.0, 1.0, 1.0), 3.0)
    area("Neutral frontal fill", (2.7, -2.0, 2.2), 72, (1.0, 1.0, 1.0), 2.5)
    area("Silver rim", (-1.4, 1.6, 2.8), 200, (0.90, 0.95, 1.0), 2.0)
    area("Soft overhead", (0.6, 0.5, 4.2), 65, (1.0, 1.0, 1.0), 2.0)
    camera_data = bpy.data.cameras.new("Studio camera")
    camera = studio_object("Studio camera", camera_data)
    camera.location = {"front-three-quarter": (2.2, -6.9, 2.25),
                       "back-three-quarter": (-2.2, 6.9, 2.25), "front": (0, -7.2, 2.1)}[args.view]
    if args.piece:
        camera.location += target - assembled_target
    camera_data.type, camera_data.ortho_scale, camera_data.lens = "ORTHO", 2.38, 70
    camera_data.clip_start, camera_data.clip_end = 0.01, 500
    aim(camera, target)
    framing = None
    if args.piece:
        rotation = camera.rotation_euler.to_matrix()
        projected = [rotation.transposed() @ (point - target) for point in corners]
        left, right = min(point.x for point in projected), max(point.x for point in projected)
        bottom, top = min(point.y for point in projected), max(point.y for point in projected)
        offset = rotation @ Vector(((left + right) / 2, (bottom + top) / 2, 0))
        camera.location += offset
        target += offset
        width, height = right - left, top - bottom
        scene.render.resolution_x, scene.render.resolution_y = (1800, 1600) if width > height else (1600, 1800)
        camera_data.ortho_scale = 1.0
        frame = camera_data.view_frame(scene=scene)
        frame_width = max(point.x for point in frame) - min(point.x for point in frame)
        frame_height = max(point.y for point in frame) - min(point.y for point in frame)
        camera_data.ortho_scale = max(width / frame_width, height / frame_height) * 1.17
        for obj in studio.objects:
            if obj.type == "LIGHT":
                aim(obj, target)
        framing = {"method": "evaluated production vertices projected into camera frame",
                   "projectedWidth": width, "projectedHeight": height, "marginScale": 1.17}
    scene.camera = camera
    bpy.context.view_layer.update()
    bpy.ops.render.render(write_still=True)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash, "Saved armor changed during rendering."
    source_directory = Path(scene["source_directory"])
    if not source_directory.is_absolute():
        source_directory = ROOT.parents[1] / source_directory
    for record in validation["sourceFiles"]:
        assert hashlib.sha256((source_directory / record["file"]).read_bytes()).hexdigest() == record["sha256"], record["file"]
    report = {
        "candidateId": validation["candidateId"], "set": validation["set"], "source": source.name,
        "sourceSha256": source_hash, "sourceFiles": validation["sourceFiles"],
        "render": output.name, "renderSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "renderer": scene.render.engine, "blenderVersion": bpy.app.version_string,
        "resolution": [scene.render.resolution_x, scene.render.resolution_y],
        "colorManagement": {"viewTransform": scene.view_settings.view_transform,
                            "look": scene.view_settings.look, "exposure": scene.view_settings.exposure},
        "lights": [{"name": obj.name, "energy": obj.data.energy, "color": list(obj.data.color)}
                   for obj in studio.objects if obj.type == "LIGHT"],
        "camera": {"position": list(camera.location), "target": list(target), "type": camera.data.type,
                   "orthoScale": camera.data.ortho_scale, "view": args.view, "pose": pose_name},
        "armorBounds": {"min": list(minimum), "max": list(maximum)}, "sourceMeshes": len(armor),
        "piece": args.piece, "totalSourceMeshes": len(all_armor), "automaticFraming": framing,
        "visibleSourceFiles": sorted({marker for obj in armor for marker in source_markers(obj)}),
        "sourceFileHashesStillMatchAfterRender": True,
        "sourceSaved": False, "sourceBlendHashUnchanged": True,
        "note": "Standalone studio presentation of saved armor geometry. Not gameplay acceptance evidence.",
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("ARMOR_STUDIO_RENDER=" + json.dumps(report))


if __name__ == "__main__":
    main()
