"""Reopen and verify an editable five-piece armor assembly.

blender -b SET.blend --disable-autoexec --python art/tier50-70/validate_blender.py
    -- --output SET-validation.json
"""

from __future__ import annotations

import argparse
from array import array
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

import bpy


REPO_ROOT = Path(__file__).resolve().parents[2]


def digest_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def matrix_values(matrix):
    return [round(value, 6) for row in matrix for value in row]


def checked_output(path, source, suffix):
    path, source = Path(path).resolve(), Path(source).resolve()
    assert path.suffix.lower() == suffix, f"Expected a {suffix} output: {path}"
    assert path != source and not (path.exists() and path.samefile(source)), "Output cannot replace the source .blend."
    return path


def socket_value(socket):
    if not hasattr(socket, "default_value"):
        return None
    value = socket.default_value
    if isinstance(value, (str, bool, int, float)):
        return value
    try:
        return list(value)
    except TypeError:
        return str(value)


def material_record(material):
    if material is None:
        return None
    result = {"name": material.name, "diffuseColor": list(material.diffuse_color),
              "useNodes": material.use_nodes}
    result["iridescence"] = {key: material[key] for key in material.keys() if key.startswith("corealm_iridescence_")}
    for attribute in ("surface_render_method", "use_transparency_overlap", "use_backface_culling",
                      "use_backface_culling_shadow", "displacement_method"):
        if hasattr(material, attribute):
            result[attribute] = getattr(material, attribute)
    if not material.use_nodes:
        return result
    nodes = []
    for node in material.node_tree.nodes:
        record = {"name": node.name, "type": node.bl_idname,
                  "muted": node.mute,
                  "inputs": [(socket.identifier, socket_value(socket)) for socket in node.inputs]}
        for attribute in ("operation", "blend_type", "uv_map", "interpolation", "extension",
                          "projection", "space", "vector_type", "convert_from", "convert_to"):
            if hasattr(node, attribute):
                record[attribute] = getattr(node, attribute)
        if hasattr(node, "image") and node.image:
            record["image"] = node.image.name
        if hasattr(node, "color_ramp"):
            record["colorRamp"] = {"interpolation": node.color_ramp.interpolation,
                                   "colorMode": node.color_ramp.color_mode,
                                   "elements": [(element.position, list(element.color)) for element in node.color_ramp.elements]}
        nodes.append(record)
    result["nodes"] = sorted(nodes, key=lambda item: item["name"])
    result["links"] = sorted((link.from_node.name, link.from_socket.identifier,
                              link.to_node.name, link.to_socket.identifier)
                             for link in material.node_tree.links)
    return result


def mesh_fingerprint(obj):
    """Hash editable source coordinates, topology, UVs, weights and material nodes."""
    mesh = obj.data
    geometry = hashlib.sha256()
    for vertex in mesh.vertices:
        geometry.update(struct.pack("<3f", *vertex.co))
    for polygon in mesh.polygons:
        geometry.update(struct.pack("<II?", len(polygon.vertices), polygon.material_index, polygon.use_smooth))
        geometry.update(struct.pack("<" + "I" * len(polygon.vertices), *polygon.vertices))
    uvs = hashlib.sha256()
    for layer in mesh.uv_layers:
        uvs.update(layer.name.encode() + b"\0")
        for corner in layer.data:
            uvs.update(struct.pack("<2f", *corner.uv))
    weights = hashlib.sha256()
    groups = {group.index: group.name for group in obj.vertex_groups}
    for vertex in mesh.vertices:
        influences = sorted((groups[group.group], group.weight) for group in vertex.groups)
        weights.update(struct.pack("<II", vertex.index, len(influences)))
        for name, weight in influences:
            weights.update(name.encode() + b"\0" + struct.pack("<f", weight))
    return {
        "worldMatrix": matrix_values(obj.matrix_world),
        "skinModifiers": [{"type": modifier.type, "enabledViewport": modifier.show_viewport,
                           "enabledRender": modifier.show_render, "useVertexGroups": modifier.use_vertex_groups,
                           "useBoneEnvelopes": modifier.use_bone_envelopes,
                           "preserveVolume": modifier.use_deform_preserve_volume}
                          for modifier in obj.modifiers if modifier.type == "ARMATURE"],
        "vertices": len(mesh.vertices), "polygons": len(mesh.polygons),
        "triangles": sum(len(face.vertices) - 2 for face in mesh.polygons),
        "uvLayers": len(mesh.uv_layers), "uvCoordinates": sum(len(layer.data) for layer in mesh.uv_layers),
        "weightedVertices": sum(bool(vertex.groups) for vertex in mesh.vertices),
        "vertexGroups": len(obj.vertex_groups), "materials": len(mesh.materials),
        "geometrySha256": geometry.hexdigest(), "uvSha256": uvs.hexdigest(),
        "weightsSha256": weights.hexdigest(),
        "materialsSha256": digest_json([material_record(material) for material in mesh.materials]),
    }


def image_record(image):
    assert image.packed_file, f"Texture is not packed: {image.name}"
    pixel_count = len(image.pixels)
    assert pixel_count > 0 and image.has_data, f"Texture cannot decode: {image.name}"
    pixels = array("f", [0.0]) * pixel_count
    image.pixels.foreach_get(pixels)
    return {"name": image.name, "size": list(image.size), "channels": image.channels,
            "colorSpace": image.colorspace_settings.name, "alphaMode": image.alpha_mode,
            "decodedPixels": pixel_count,
            "packedSha256": hashlib.sha256(bytes(image.packed_file.data)).hexdigest(),
            "decodedSha256": hashlib.sha256(pixels.tobytes()).hexdigest()}


def asset_manifest():
    return {
        "meshes": {obj.name: mesh_fingerprint(obj) for obj in bpy.context.scene.objects if obj.type == "MESH"},
        "bindings": {obj.name: {"parent": obj.parent.name if obj.parent else None,
                                 "parentType": obj.parent_type, "parentBone": obj.parent_bone,
                                 "armatures": [modifier.object.name if modifier.object else None
                                               for modifier in obj.modifiers if modifier.type == "ARMATURE"]}
                     for obj in bpy.context.scene.objects if obj.type == "MESH"},
        "rigs": {obj.name: {"worldMatrix": matrix_values(obj.matrix_world),
                             "posePosition": obj.data.pose_position,
                             "importedPoseMatrices": {bone.name: [value for row in bone.matrix_basis for value in row]
                                                      for bone in obj.pose.bones},
                             "bones": [{"name": bone.name, "parent": bone.parent.name if bone.parent else None,
                                        "restMatrix": matrix_values(bone.matrix_local),
                                        "length": round(bone.length, 6), "deform": bone.use_deform,
                                        "inheritScale": bone.inherit_scale,
                                        "inheritRotation": bone.use_inherit_rotation,
                                        "useLocalLocation": bone.use_local_location}
                                       for bone in obj.data.bones]}
                 for obj in bpy.context.scene.objects if obj.type == "ARMATURE"},
        "images": {image.name: image_record(image) for image in bpy.data.images if image.source == "FILE"},
    }


def validate(output=None):
    source = Path(bpy.data.filepath).resolve()
    assert source.is_file(), "Open a saved .blend before validating."
    if output:
        output = checked_output(output, source, ".json")
    scene = bpy.context.scene
    records = json.loads(scene["source_sha256"])
    directory = Path(scene["source_directory"])
    if not directory.is_absolute():
        directory = REPO_ROOT / directory
    assert len(records) == 5, "Expected five source GLBs."
    source_names = {path.name for path in directory.glob("*.glb")}
    record_names = {item["file"] for item in records}
    assert len(source_names) == len(record_names) == 5, "Expected five distinct source GLBs."
    assert record_names == source_names
    for record in records:
        assert hashlib.sha256((directory / record["file"]).read_bytes()).hexdigest() == record["sha256"], record["file"]
    spec = importlib.util.spec_from_file_location("armor_iridescence", Path(__file__).with_name("iridescence_blender.py"))
    iridescence = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(iridescence)
    film_report = iridescence.validate_preview(directory)
    assert json.loads(scene["iridescence_preservation"]) == film_report
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    rigs = [obj for obj in scene.objects if obj.type == "ARMATURE"]
    assert len(rigs) == 1 and len(rigs[0].data.bones) == 65, "Expected one 65-bone rig."
    assert meshes and all(obj.data.materials and obj.data.uv_layers for obj in meshes)
    assert all(vertex.groups for obj in meshes for vertex in obj.data.vertices)
    assert all(any(modifier.type == "ARMATURE" and modifier.object == rigs[0]
                   for modifier in obj.modifiers) for obj in meshes)
    # glTF quaternion conversion leaves about 1e-5 float noise in two thumb bones.
    # The manifest below also verifies the exact imported pose matrices on reopen.
    assert all(all(abs(value - (1.0 if row == col else 0.0)) < 2e-5
                   for row, values in enumerate(bone.matrix_basis) for col, value in enumerate(values))
               for bone in rigs[0].pose.bones), "Saved rig must retain the unposed rest assembly."
    observed = asset_manifest()
    expected = json.loads(scene["asset_manifest"])
    assert expected == observed, "Reopened geometry, UVs, weights, materials or textures changed."
    assert scene["source_geometry_preserved"] and scene["source_uvs_preserved"] and scene["source_skin_weights_preserved"]
    report = {
        "candidateId": scene["candidate_id"], "set": scene.get("armor_set", "unknown"),
        "source": source.name, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "sourceBytes": source.stat().st_size, "blenderVersion": bpy.app.version_string,
        "reopenedFromDisk": True, "sourceFiles": records, "sourceFileHashesMatch": True,
        "pieces": len(records), "meshes": len(meshes),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "triangles": sum(len(face.vertices) - 2 for obj in meshes for face in obj.data.polygons),
        "rigs": len(rigs), "bones": len(rigs[0].data.bones), "savedRestPose": True,
        "allMeshesHaveUvsAndMaterials": True, "allVerticesWeighted": True,
        "allMeshesBoundToSharedRig": True, "packedImages": len(observed["images"]),
        "allPackedImagesDecoded": True, "exactAssetManifestMatches": True,
        "iridescencePreservation": film_report,
        "manifest": observed, "passed": True,
    }
    if output:
        output = Path(output).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("ARMOR_REOPEN_VALIDATION=" + json.dumps({key: value for key, value in report.items() if key != "manifest"}))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    validate(args.output or Path(bpy.data.filepath).with_name(Path(bpy.data.filepath).stem + "-validation.json"))
