"""Save the accepted Starhide GLBs as a self-contained editable Blender project.

Run only after the root agent marks the staged candidate final:
    blender --background --factory-startup --disable-autoexec --python \
      tools/item-models/starhide/save_blender.py -- --candidate-id FINAL_MARKER

The script imports production meshes without altering geometry, UVs, weights,
or texture pixels. Equivalent static armatures share one native Blender rig.
Armatures with different rest poses or animation remain separate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector


REPO_ROOT = Path(__file__).resolve().parents[3]


def arguments() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-id", required=True,
                        help="Root agent's final candidate marker, saved inside the project.")
    parser.add_argument("--source-dir", type=Path, default=REPO_ROOT / "art/item-models/candidates/armor-starhide-tailored/models/items")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "art/starhide/starhide-set.blend")
    return parser.parse_args(args)


def rounded_matrix(matrix) -> tuple[float, ...]:
    return tuple(round(value, 7) for row in matrix for value in row)


def rig_signature(obj):
    """Only merge rigs whose rest transforms and bone definitions are identical."""
    if obj.animation_data or obj.constraints:
        return None
    if any(bone.constraints for bone in obj.pose.bones):
        return None
    return (
        rounded_matrix(obj.matrix_world),
        obj.data.pose_position,
        tuple(sorted((bone.name, rounded_matrix(bone.matrix_basis)) for bone in obj.pose.bones)),
        tuple(sorted(
            (bone.name, bone.parent.name if bone.parent else "", rounded_matrix(bone.matrix_local),
             round(bone.length, 7), bone.use_deform, bone.inherit_scale, bone.use_inherit_rotation,
             bone.use_local_location)
            for bone in obj.data.bones
        )),
    )


def move_to_collection(obj, collection) -> None:
    for previous in list(obj.users_collection):
        previous.objects.unlink(obj)
    collection.objects.link(obj)


def consolidate_rigs(objects, rig_collection) -> tuple[int, int]:
    originals = [obj for obj in objects if obj.type == "ARMATURE"]
    equivalent = {}
    removed = 0
    for rig in originals:
        signature = rig_signature(rig)
        canonical = equivalent.get(signature) if signature is not None else None
        if canonical is None:
            if signature is not None:
                equivalent[signature] = rig
            move_to_collection(rig, rig_collection)
            rig.show_in_front = True
            rig.data.display_type = "OCTAHEDRAL"
            continue
        # Copy world transforms before changing parents so each piece stays in place.
        for obj in list(bpy.data.objects):
            if obj.parent == rig:
                world = obj.matrix_world.copy()
                obj.parent = canonical
                obj.matrix_world = world
            for modifier in obj.modifiers:
                if modifier.type == "ARMATURE" and modifier.object == rig:
                    modifier.object = canonical
            for constraint in obj.constraints:
                if hasattr(constraint, "target") and constraint.target == rig:
                    constraint.target = canonical
            if obj.type == "ARMATURE":
                for bone in obj.pose.bones:
                    for constraint in bone.constraints:
                        if hasattr(constraint, "target") and constraint.target == rig:
                            constraint.target = canonical
        bpy.data.objects.remove(rig, do_unlink=True)
        removed += 1
    rigs = list(rig_collection.objects)
    if len(rigs) == 1:
        rigs[0].name = "Starhide rig"
        rigs[0].data.name = "Starhide skeleton"
    return len(originals), removed


def mesh_fingerprint(obj) -> dict:
    """Verify structural import data remains intact during project organization."""
    return {
        "vertices": len(obj.data.vertices),
        "polygons": len(obj.data.polygons),
        "uv_layers": len(obj.data.uv_layers),
        "uv_coordinates": sum(len(layer.data) for layer in obj.data.uv_layers),
        "weighted_vertices": sum(bool(vertex.groups) for vertex in obj.data.vertices),
        "vertex_groups": len(obj.vertex_groups),
        "materials": len(obj.data.materials),
    }


def configure_edit_view(meshes) -> None:
    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    if not corners:
        return
    low = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    high = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    center = (low + high) / 2
    extent = max(high - low)
    # This is an editing workspace only. Game acceptance uses the production camera.
    eye_direction = Vector((2.6, -6.0, 1.7)).normalized()
    rotation = eye_direction.to_track_quat("Z", "Y")
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.shading.type = "MATERIAL"
                space.shading.use_scene_world = False
                space.shading.use_scene_lights = False
                space.overlay.show_floor = False
                space.overlay.show_axis_x = False
                space.overlay.show_axis_y = False
                space.clip_start = max(0.001, extent / 10000)
                space.clip_end = max(100, extent * 100)
                space.region_3d.view_location = center
                space.region_3d.view_distance = extent * 1.8
                space.region_3d.view_rotation = rotation
                space.region_3d.view_perspective = "PERSP"


def main() -> None:
    args = arguments()
    source_dir = args.source_dir.resolve()
    sources = sorted(source_dir.glob("*.glb"))
    if len(sources) != 5:
        raise RuntimeError(f"Expected exactly five final GLBs in {source_dir}; found {len(sources)}.")
    source_records = [
        {"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in sources
    ]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "Starhide armor set"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.view_settings.view_transform = "AgX"
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    assembly = bpy.data.collections.new("Starhide armor set")
    scene.collection.children.link(assembly)
    rig_collection = bpy.data.collections.new("Rig")
    assembly.children.link(rig_collection)
    meshes = []
    imported = []
    fingerprints = {}
    for index, path in enumerate(sources, start=1):
        existing = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path), disable_bone_shape=True)
        objects = [obj for obj in bpy.data.objects if obj not in existing]
        if not any(obj.type == "MESH" for obj in objects):
            raise RuntimeError(f"{path.name} imported without a mesh.")
        collection = bpy.data.collections.new(f"{index:02d} {path.stem}")
        collection["source_glb"] = path.name
        assembly.children.link(collection)
        for obj in objects:
            move_to_collection(obj, collection)
            obj.name = f"{path.stem} / {obj.name}"
            obj["source_glb"] = path.name
            if obj.type == "MESH":
                meshes.append(obj)
                fingerprints[obj.as_pointer()] = mesh_fingerprint(obj)
        imported.extend(objects)
    original_rigs, merged_rigs = consolidate_rigs(imported, rig_collection)
    for mesh in meshes:
        if mesh_fingerprint(mesh) != fingerprints[mesh.as_pointer()]:
            raise RuntimeError(f"Mesh structure changed while organizing {mesh.name}.")
        for modifier in mesh.modifiers:
            if modifier.type == "ARMATURE" and modifier.object is None:
                raise RuntimeError(f"Missing skin rig on {mesh.name}.")
    # glTF images are packed but lazily decoded in background Blender.
    # Accessing pixels proves the embedded texture can load before has_data.
    for image in bpy.data.images:
        if image.source == "FILE":
            len(image.pixels)
    missing_images = [image.name for image in bpy.data.images
                      if image.source == "FILE" and not image.has_data]
    if missing_images:
        raise RuntimeError(f"Imported textures have no pixel data: {missing_images}")
    for image in bpy.data.images:
        if image.source == "FILE" and image.has_data:
            image.pack()
    unpacked = [image.name for image in bpy.data.images
                if image.source == "FILE" and image.has_data and not image.packed_file]
    if unpacked:
        raise RuntimeError(f"Textures could not be packed: {unpacked}")
    for collection in list(bpy.data.collections):
        if collection not in [assembly, rig_collection] and not collection.objects and not collection.children:
            bpy.data.collections.remove(collection)
    scene["candidate_id"] = args.candidate_id
    scene["source_directory"] = str(source_dir.relative_to(REPO_ROOT)) if source_dir.is_relative_to(REPO_ROOT) else str(source_dir)
    scene["source_sha256"] = json.dumps(source_records, indent=2)
    scene["source_geometry_preserved"] = True
    scene["source_uvs_preserved"] = True
    scene["source_skin_weights_preserved"] = True
    summary = {
        "candidate_id": args.candidate_id,
        "pieces": len(sources),
        "meshes": len(meshes),
        "vertices": sum(len(mesh.data.vertices) for mesh in meshes),
        "polygons": sum(len(mesh.data.polygons) for mesh in meshes),
        "armatures_imported": original_rigs,
        "identical_armatures_merged": merged_rigs,
        "armatures_retained": original_rigs - merged_rigs,
        "packed_images": sum(bool(image.packed_file) for image in bpy.data.images),
        "source_files": source_records,
    }
    readme = bpy.data.texts.new("READ ME - Starhide.txt")
    readme.write(
        "STARHIDE ROBES\n\n"
        "Editable assembly imported from the final production GLBs.\n"
        "Each item has a separate collection. Show or hide a collection to isolate it.\n"
        "The Rig collection contains native Blender armatures. Pose bones there to\n"
        "inspect the imported skin. Identical rest-pose armatures share a rig;\n"
        "different rigs and rigs containing animation remain separate.\n\n"
        "Meshes, UV maps, vertex weights, and material nodes remain editable.\n"
        "All imported file textures are packed in this .blend file.\n"
        "Production geometry and texture pixels have not been changed by this import.\n"
        "The opening view is an editing view, not game acceptance evidence.\n\n"
        "Rebuild this file with tools/item-models/starhide/save_blender.py after\n"
        "the final candidate is accepted. Source model scripts remain provenance.\n\n"
        + json.dumps(summary, indent=2) + "\n"
    )
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = None
    configure_edit_view(meshes)
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False, compress=True)
    if not output.is_file() or output.stat().st_size < 1000:
        raise RuntimeError("Blender did not save a valid project file.")
    summary["output"] = str(output)
    summary["output_bytes"] = output.stat().st_size
    print("STARHIDE_BLEND_RESULT=" + json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
