"""Render each saved Starhide piece. Never saves or edits the source blend.

Usage: blender -b art/starhide/starhide-set.blend --python art/starhide/render_piece_studios.py
These studio views are asset presentation, not gameplay acceptance evidence.
"""
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "pieces"
OUTPUT.mkdir(exist_ok=True)
SOURCE = Path(bpy.data.filepath).resolve()
SOURCE_HASH = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
scene = bpy.context.scene
armor = [obj for obj in scene.objects if obj.type == "MESH"]
rig = next(obj for obj in scene.objects if obj.type == "ARMATURE")
collections = sorted([c for c in bpy.data.collections if "starhide_" in c.name], key=lambda c: c.name)
assert len(collections) == 5
rest_matrices = {name: rig.pose.bones[name].matrix.copy() for name in ["upperarm_l", "upperarm_r"]}

scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.eevee.taa_render_samples = 48
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.color_depth = "8"
scene.render.film_transparent = False
scene.render.image_settings.compression = 30
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.65

studio = bpy.data.collections.new("Piece studio render only")
scene.collection.children.link(studio)


def studio_object(name, data):
    obj = bpy.data.objects.new(name, data)
    studio.objects.link(obj)
    return obj


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


world = bpy.data.worlds.new("Piece studio slate environment")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.060, 0.070, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
scene.world = world
lights = []
for name, position, energy, color, size in [
    ("Neutral large key", (-2.2, -3.2, 4.0), 160, (1, 1, 1), 3.0),
    ("Neutral frontal fill", (2.7, -2.0, 2.2), 72, (1, 1, 1), 2.5),
    ("Silver rim", (-1.4, 1.6, 2.8), 200, (0.90, 0.95, 1.0), 2.0),
    ("Soft overhead", (0.6, 0.5, 4.2), 65, (1, 1, 1), 2.0),
]:
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.color, data.size = energy, color, size
    data.shape = "DISK"
    obj = studio_object(name, data)
    obj.location = position
    lights.append(obj)

camera_data = bpy.data.cameras.new("Piece studio camera")
camera_data.type = "ORTHO"
camera_data.clip_start, camera_data.clip_end = 0.01, 500
camera = studio_object("Piece studio camera", camera_data)
scene.camera = camera

reports = []
for collection in collections:
    piece = collection.name.split(" ", 1)[1]
    selected = list(collection.objects)
    for obj in armor:
        obj.hide_render = obj not in selected
    for name, matrix in rest_matrices.items():
        rig.pose.bones[name].matrix = matrix
    bpy.context.view_layer.update()
    pose = "saved rest pose"
    if piece in {"starhide_robe", "starhide_wraps"}:
        for name, degrees in [("upperarm_l", 62), ("upperarm_r", -62)]:
            bone = rig.pose.bones[name]
            pivot = bone.head.copy()
            bone.matrix = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(degrees), 4, "Y") @ Matrix.Translation(-pivot) @ bone.matrix
        pose = "temporary arms lowered 62 degrees; saved rest pose unchanged"
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in selected:
        evaluated = obj.evaluated_get(depsgraph)
        points.extend(evaluated.matrix_world @ vertex.co for vertex in evaluated.data.vertices)
    minimum = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    maximum = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    target = (minimum + maximum) / 2
    camera.location = target + Vector((2.2, -6.9, 1.31))
    aim(camera, target)
    rotation = camera.rotation_euler.to_matrix().transposed()
    projected = [rotation @ (point - target) for point in points]
    left, right = min(p.x for p in projected), max(p.x for p in projected)
    bottom, top = min(p.y for p in projected), max(p.y for p in projected)
    # Shift to the projected center before fitting both dimensions with margins.
    offset = camera.rotation_euler.to_matrix() @ Vector(((left + right) / 2, (bottom + top) / 2, 0))
    camera.location += offset
    target += offset
    width, height = right - left, top - bottom
    scene.render.resolution_x, scene.render.resolution_y = (1280, 1024) if width > height else (1024, 1280)
    aspect = scene.render.resolution_x / scene.render.resolution_y
    camera_data.ortho_scale = (max(width, height * aspect) if aspect > 1 else max(height, width / aspect)) * 1.17
    for light in lights:
        aim(light, target)
    output = OUTPUT / f"{piece}.png"
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    report = {
        "piece": piece,
        "source": str(SOURCE.relative_to(ROOT.parent.parent)).replace("\\", "/"),
        "sourceSha256": SOURCE_HASH,
        "candidateId": scene.get("candidate_id"),
        "render": output.name,
        "renderSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "resolution": [scene.render.resolution_x, scene.render.resolution_y],
        "renderer": scene.render.engine,
        "blenderVersion": bpy.app.version_string,
        "sourceMeshes": len(selected),
        "bounds": {"min": list(minimum), "max": list(maximum)},
        "camera": {"position": list(camera.location), "target": list(target), "orthoScale": camera_data.ortho_scale, "orientation": "Front three-quarter, positive X / negative Y, Z up", "pose": pose},
        "colorManagement": {"viewTransform": scene.view_settings.view_transform, "look": scene.view_settings.look, "exposure": scene.view_settings.exposure},
        "sourceSaved": False,
        "note": "Standalone studio presentation of the saved 3D piece. Not gameplay acceptance evidence.",
    }
    (OUTPUT / f"{piece}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    reports.append(report)
    print("PIECE_STUDIO=" + json.dumps(report))
    if piece == "starhide_wraps":
        # The paired view keeps both gloves visible. This second camera isolates
        # the complete positive-X glove without touching its mesh or materials.
        points = [point for point in points if point.x > 0]
        target = Vector(tuple((min(p[i] for p in points) + max(p[i] for p in points)) / 2 for i in range(3)))
        camera.location = target + Vector((2.2, -6.9, 1.31))
        aim(camera, target)
        rotation = camera.rotation_euler.to_matrix().transposed()
        projected = [rotation @ (point - target) for point in points]
        left, right = min(p.x for p in projected), max(p.x for p in projected)
        bottom, top = min(p.y for p in projected), max(p.y for p in projected)
        offset = camera.rotation_euler.to_matrix() @ Vector(((left + right) / 2, (bottom + top) / 2, 0))
        camera.location += offset
        target += offset
        scene.render.resolution_x, scene.render.resolution_y = 1024, 1280
        camera_data.ortho_scale = max(top - bottom, (right - left) / 0.8) * 1.17
        output = OUTPUT / "starhide_wraps_detail.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        detail = dict(report)
        detail.update({"render": output.name, "renderSha256": hashlib.sha256(output.read_bytes()).hexdigest(), "resolution": [1024, 1280], "camera": {"position": list(camera.location), "target": list(target), "orthoScale": camera_data.ortho_scale, "pose": pose}, "note": "Complete positive-X glove detail. The counterpart is outside this camera view. Geometry and materials unchanged. Studio presentation, not gameplay acceptance evidence."})
        (OUTPUT / "starhide_wraps_detail.json").write_text(json.dumps(detail, indent=2) + "\n", encoding="utf-8")
        reports.append(detail)
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_HASH, "Source blend changed during render"
(OUTPUT / "studios.json").write_text(json.dumps({"sourceSha256": SOURCE_HASH, "sourceUnchanged": True, "pieces": reports}, indent=2) + "\n", encoding="utf-8")
