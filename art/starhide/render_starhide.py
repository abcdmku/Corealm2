"""Render the saved armor with studio lighting without saving scene changes.

Usage: blender -b art/starhide/starhide-set.blend --python art/starhide/render_starhide.py
The saved armor's mesh data, materials, rig, and rest pose remain unchanged.
Pass -- --arms-down to lower the arms in the temporary render scene.
"""

import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
SOURCE = Path(bpy.data.filepath).resolve()
SOURCE_HASH = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
OUTPUT = ROOT / "starhide-studio.png"

scene = bpy.context.scene

# Validate the reopened production assembly before adding any studio objects.
source_records = json.loads(scene["source_sha256"])
source_directory = REPO_ROOT / scene["source_directory"]
assert len(source_records) == 5, "Saved project must identify exactly five source GLBs."
assert {item["file"] for item in source_records} == {path.name for path in source_directory.glob("*.glb")}
for item in source_records:
    assert hashlib.sha256((source_directory / item["file"]).read_bytes()).hexdigest() == item["sha256"], item["file"]
source_meshes = [obj for obj in scene.objects if obj.type == "MESH"]
source_rigs = [obj for obj in scene.objects if obj.type == "ARMATURE"]
source_images = [item for item in bpy.data.images if item.source == "FILE"]
assert len(source_rigs) == 1 and len(source_rigs[0].data.bones) == 65
assert all(obj.data.materials and obj.data.uv_layers for obj in source_meshes)
assert all(vertex.groups for obj in source_meshes for vertex in obj.data.vertices)
assert all(any(modifier.type == "ARMATURE" and modifier.object == source_rigs[0]
               for modifier in obj.modifiers) for obj in source_meshes)
for item in source_images:
    assert item.packed_file, f"Texture is not packed: {item.name}"
    assert len(item.pixels) > 0 and item.has_data, f"Texture cannot decode: {item.name}"
validation = {
    "candidateId": scene["candidate_id"],
    "source": SOURCE.name,
    "sourceSha256": SOURCE_HASH,
    "sourceBytes": SOURCE.stat().st_size,
    "blenderVersion": bpy.app.version_string,
    "reopenedFromDisk": True,
    "sourceFiles": source_records,
    "sourceFileHashesMatch": True,
    "pieces": len(source_records),
    "meshes": len(source_meshes),
    "vertices": sum(len(obj.data.vertices) for obj in source_meshes),
    "triangles": sum(len(face.vertices) - 2 for obj in source_meshes for face in obj.data.polygons),
    "rigs": len(source_rigs),
    "bones": len(source_rigs[0].data.bones),
    "allMeshesHaveUvsAndMaterials": True,
    "allVerticesWeighted": True,
    "allMeshesBoundToSharedRig": True,
    "packedImages": len(source_images),
    "allPackedImagesDecoded": True,
    "passed": True,
}
(ROOT / "starhide-validation.json").write_text(json.dumps(validation, indent=2) + "\n", encoding="utf-8")
print("STARHIDE_REOPEN_VALIDATION=" + json.dumps(validation))
pose_name = "saved rest pose"
if "--arms-down" in sys.argv:
    for name, degrees in [("upperarm_l", 62), ("upperarm_r", -62)]:
        bone = source_rigs[0].pose.bones[name]
        pivot = bone.head.copy()
        bone.matrix = (Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(degrees), 4, "Y")
                       @ Matrix.Translation(-pivot) @ bone.matrix)
    bpy.context.view_layer.update()
    pose_name = "temporary arms lowered 62 degrees; saved rest pose unchanged"
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 1800
scene.render.resolution_y = 1600
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.color_depth = "8"
scene.render.film_transparent = False
scene.render.filepath = str(OUTPUT)
scene.render.use_file_extension = True
scene.render.image_settings.compression = 30
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.65
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.eevee.taa_render_samples = 64

armor = [obj for obj in scene.objects if obj.type == "MESH"]
assert armor, "No armor meshes were loaded."
assert all(obj.data.materials for obj in armor), "Remove materialless exporter helpers before rendering."
corners = [obj.matrix_world @ Vector(corner) for obj in armor for corner in obj.bound_box]
minimum = Vector(tuple(min(corner[axis] for corner in corners) for axis in range(3)))
maximum = Vector(tuple(max(corner[axis] for corner in corners) for axis in range(3)))
target = Vector((0.0, 0.03, 0.94))

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

ground_data = bpy.data.meshes.new("Studio floor mesh")
floor_z = minimum.z - 0.003
ground_data.from_pydata(
    [(-200, -200, floor_z), (200, -200, floor_z), (200, 200, floor_z), (-200, 200, floor_z)],
    [],
    [(0, 1, 2, 3)],
)
ground = studio_object("Studio floor", ground_data)
ground_material = bpy.data.materials.new("Studio matte slate")
ground_material.use_nodes = True
ground_shader = ground_material.node_tree.nodes.get("Principled BSDF")
ground_shader.inputs["Base Color"].default_value = (0.024, 0.030, 0.042, 1)
ground_shader.inputs["Roughness"].default_value = 0.64
ground.data.materials.append(ground_material)


def area(name, position, energy, color, size, at=target):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = studio_object(name, data)
    obj.location = position
    aim(obj, at)
    return obj


area("Neutral large key", (-2.2, -3.2, 4.0), 160, (1.0, 1.0, 1.0), 3.0)
area("Neutral frontal fill", (2.7, -2.0, 2.2), 72, (1.0, 1.0, 1.0), 2.5)
area("Silver rim", (-1.4, 1.6, 2.8), 200, (0.90, 0.95, 1.0), 2.0)
area("Soft overhead", (0.6, 0.5, 4.2), 65, (1.0, 1.0, 1.0), 2.0)

camera_data = bpy.data.cameras.new("Studio camera")
camera = studio_object("Studio camera", camera_data)
camera.location = (2.2, -6.9, 2.25)
camera_data.type = "ORTHO"
camera_data.ortho_scale = 2.38
camera_data.lens = 70
camera_data.clip_start = 0.01
camera_data.clip_end = 500
aim(camera, target)
scene.camera = camera

bpy.context.view_layer.update()
bpy.ops.render.render(write_still=True)
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_HASH, "Source blend changed during render."
report = {
    "source": SOURCE.name,
    "sourceSha256": SOURCE_HASH,
    "render": OUTPUT.name,
    "renderSha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
    "renderer": scene.render.engine,
    "blenderVersion": bpy.app.version_string,
    "resolution": [scene.render.resolution_x, scene.render.resolution_y],
    "colorManagement": {
        "viewTransform": scene.view_settings.view_transform,
        "look": scene.view_settings.look,
        "exposure": scene.view_settings.exposure,
    },
    "lights": [{"name": obj.name, "energy": obj.data.energy, "color": list(obj.data.color)}
               for obj in studio.objects if obj.type == "LIGHT"],
    "camera": {
        "position": list(camera.location),
        "target": list(target),
        "type": camera.data.type,
        "orthoScale": camera.data.ortho_scale,
        "orientation": "Front three-quarter from positive X / negative Y; Z up.",
        "pose": pose_name,
    },
    "armorBounds": {"min": list(minimum), "max": list(maximum)},
    "sourceMeshes": len(armor),
    "sourceSaved": False,
    "note": "Standalone studio presentation of saved armor geometry. Not gameplay acceptance evidence.",
}
(ROOT / "starhide-studio.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print("STUDIO_RENDER=" + json.dumps(report))
