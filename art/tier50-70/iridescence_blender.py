"""Editable EEVEE preview of source glTF thin-film parameters.

Blender 4.5's glTF importer drops KHR_materials_iridescence. Its native thin
film is Cycles-only and excludes metals. This preview samples the Three.js
thin-film reflectance curve, then applies a bounded view-angle tint to the
existing base-color chain. It is an approximation, not the glTF BRDF. The
original maps, normal, metallic, roughness and clearcoat inputs remain intact.

Curve math adapted from Three.js iridescence_fragment.glsl.js and common.glsl.js.
Copyright (c) 2010-2026 three.js authors. MIT License:
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import re
import struct

import bpy


EXTENSION = "KHR_materials_iridescence"
MODE = "eevee-view-angle-tint-v1"
PREFIX = "Corealm Film "
SOURCE_KEY = "corealm_iridescence_source"
SAMPLES = 25
PREVIEW_STRENGTH = 0.55


def preserved_inputs(shader):
    """Record every original shading input except the intentionally tinted base."""
    result = {}
    for socket in shader.inputs:
        if socket.name == "Base Color":
            continue
        value = getattr(socket, "default_value", None)
        if value is not None and not isinstance(value, (bool, float, int, str)):
            value = list(value)
        result[socket.identifier] = {"default": value,
                                     "links": [[link.from_node.name, link.from_socket.identifier] for link in socket.links]}
    return result


def source_materials(directory):
    """Read exact named materials from GLB JSON, without touching buffer data."""
    sources = {}
    for path in sorted(Path(directory).glob("*.glb")):
        data = path.read_bytes()
        magic, version, length = struct.unpack_from("<4sII", data)
        assert magic == b"glTF" and version == 2 and length == len(data), path.name
        chunk_length, chunk_type = struct.unpack_from("<II", data, 12)
        assert chunk_type == 0x4E4F534A, f"GLB first chunk must be JSON: {path.name}"
        document = json.loads(data[20:20 + chunk_length])
        used = {primitive["material"] for mesh in document.get("meshes", [])
                for primitive in mesh.get("primitives", []) if "material" in primitive}
        rows = {}
        for index in sorted(used):
            material = document["materials"][index]
            name = material["name"]
            assert name not in rows, f"Ambiguous source material name: {name}"
            extension = material.get("extensions", {}).get(EXTENSION)
            if "-scute-" in name:
                assert extension and extension.get("iridescenceFactor", 0) > 0, name
            if extension:
                assert not any("Texture" in key for key in extension), "Preview expects scalar thin-film parameters."
            rows[name] = material
        sources[path.name] = rows
    assert sources, "No source GLBs for material preservation."
    return sources


def imported_materials(directory):
    """Match within each object's source GLB; accept only Blender's numeric suffix."""
    sources = source_materials(directory)
    expected = {(file, name) for file, rows in sources.items() for name, row in rows.items()
                if row.get("extensions", {}).get(EXTENSION, {}).get("iridescenceFactor", 0) > 0}
    observed, materials = set(), {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        file = obj.get("source_glb")
        assert file in sources, f"Missing source GLB for {obj.name}"
        for material in obj.data.materials:
            assert material is not None, obj.name
            matches = [name for name in sources[file]
                       if material.name == name or re.fullmatch(re.escape(name) + r"\.\d{3,}", material.name)]
            assert len(matches) == 1, f"Cannot map {file}: {material.name} to an exact source material."
            name = matches[0]
            if (file, name) not in expected:
                continue
            observed.add((file, name))
            row = sources[file][name]
            record = {"materialName": name, "extension": row["extensions"][EXTENSION],
                      "baseColorFactor": row.get("pbrMetallicRoughness", {}).get("baseColorFactor", [1, 1, 1, 1]),
                      "metallicFactor": row.get("pbrMetallicRoughness", {}).get("metallicFactor", 1)}
            key = material.as_pointer()
            if key in materials:
                assert materials[key][1] == record, f"Shared material has conflicting source values: {name}"
                materials[key][2].add(file)
            else:
                materials[key] = (material, record, {file})
    assert observed == expected and expected, "Some source iridescent materials were not imported."
    return list(materials.values())


def schlick(f0, cosine):
    fresnel = 2 ** ((-5.55473 * cosine - 6.98316) * cosine)
    return f0 * (1 - fresnel) + fresnel


def sensitivity(opd, shifts):
    phase = 2 * math.pi * opd * 1e-9
    amplitudes = (5.4856e-13, 4.4201e-13, 5.2481e-13)
    positions = (1.6810e6, 1.7953e6, 2.2084e6)
    variances = (4.3278e9, 9.3046e9, 6.6121e9)
    xyz = [a * math.sqrt(2 * math.pi * v) * math.cos(p * phase + shift)
           * math.exp(-phase * phase * v)
           for a, p, v, shift in zip(amplitudes, positions, variances, shifts)]
    xyz[0] += (9.7470e-14 * math.sqrt(2 * math.pi * 4.5282e9)
               * math.cos(2.2399e6 * phase + shifts[0]) * math.exp(-phase * phase * 4.5282e9))
    xyz = [value / 1.0685e-7 for value in xyz]
    return [sum(a * b for a, b in zip(row, xyz)) for row in
            ((3.2404542, -1.5371385, -0.4985314),
             (-0.9692660, 1.8760108, 0.0415560),
             (0.0556434, -0.2040259, 1.0572252))]


def reflectance(cosine, film_ior, thickness, f0):
    t = max(0, min(1, thickness / 0.03))
    eta = 1 + (film_ior - 1) * t * t * (3 - 2 * t)
    cosine_sq = 1 - (1 - cosine * cosine) / (eta * eta)
    if cosine_sq < 0:
        return [1, 1, 1]
    refracted = math.sqrt(cosine_sq)
    r12 = schlick(((eta - 1) / (eta + 1)) ** 2, cosine)
    transmission = 1 - r12
    base_iors = [(1 + math.sqrt(min(0.9999, max(0, value))))
                 / (1 - math.sqrt(min(0.9999, max(0, value)))) for value in f0]
    r23 = [schlick(((base - eta) / (base + eta)) ** 2, refracted) for base in base_iors]
    phase21 = math.pi if eta >= 1 else 0
    phases = [phase21 + (math.pi if base < eta else 0) for base in base_iors]
    r123 = [max(1e-5, min(0.9999, r12 * value)) for value in r23]
    rs = [transmission ** 2 * value / (1 - compound) for value, compound in zip(r23, r123)]
    result = [r12 + value for value in rs]
    coefficient = [value - transmission for value in rs]
    opd = 2 * eta * thickness * refracted
    for order in (1, 2):
        coefficient = [value * math.sqrt(compound) for value, compound in zip(coefficient, r123)]
        spectral = sensitivity(order * opd, [order * phase for phase in phases])
        result = [value + coefficient[channel] * 2 * spectral[channel]
                  for channel, value in enumerate(result)]
    return [max(0, value) for value in result]


def ramp_samples(record):
    extension = record["extension"]
    metallic = record["metallicFactor"]
    f0 = [0.04 * (1 - metallic) + value * metallic for value in record["baseColorFactor"][:3]]
    # Three uses the maximum thickness when no thickness texture is present.
    thickness = extension.get("iridescenceThicknessMaximum", 400)
    ior = extension.get("iridescenceIor", 1.3)
    for index in range(SAMPLES):
        cosine = index / (SAMPLES - 1)
        film = reflectance(cosine, ior, thickness, f0)
        ratio = [value / max(0.01, schlick(base, cosine)) for value, base in zip(film, f0)]
        luminance = max(1e-6, sum(value * weight for value, weight in zip(ratio, (0.2126, 0.7152, 0.0722))))
        # Keep the blue pigment and its texture. The curve contributes restrained
        # chromatic variation, while the untouched clearcoat produces highlights.
        tint = [0.5 * min(1.5, max(0.6, value / luminance)) for value in ratio]
        yield cosine, (*tint, 1.0)


def apply_preview(directory):
    rows = imported_materials(directory)
    for material, record, files in rows:
        assert SOURCE_KEY not in material, f"Preview already applied: {material.name}"
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shaders = [node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"]
        assert len(shaders) == 1, material.name
        shader = shaders[0]
        original_inputs = preserved_inputs(shader)
        frame = nodes.new("NodeFrame")
        frame.name = PREFIX + "Preview"
        frame.label = "EEVEE thin-film approximation / source glTF parameters preserved"

        def node(kind, name, x, y):
            result = nodes.new(kind)
            result.name = PREFIX + name
            result.label = name
            result.parent = frame
            result.location = x, y
            return result

        geometry = node("ShaderNodeNewGeometry", "View", 0, 0)
        dot = node("ShaderNodeVectorMath", "Incidence", 190, 0)
        dot.operation = "DOT_PRODUCT"
        absolute = node("ShaderNodeMath", "Absolute cosine", 390, 0)
        absolute.operation = "ABSOLUTE"
        ramp = node("ShaderNodeValToRGB", "Sampled interference", 570, 0)
        ramp.color_ramp.interpolation = "LINEAR"
        ramp.color_ramp.color_mode = "RGB"
        for index, (position, color) in enumerate(ramp_samples(record)):
            element = ramp.color_ramp.elements[index] if index < 2 else ramp.color_ramp.elements.new(position)
            element.position, element.color = position, color
        scale = node("ShaderNodeVectorMath", "Tint multiplier", 880, 0)
        scale.operation = "SCALE"
        scale.inputs[3].default_value = 2.0
        blend = node("ShaderNodeMixRGB", "Preserve blue pigment", 1090, 0)
        blend.blend_type = "MULTIPLY"
        blend.inputs[0].default_value = PREVIEW_STRENGTH * record["extension"].get("iridescenceFactor", 0)
        blend.use_clamp = False
        base = shader.inputs["Base Color"]
        original = {"default": list(base.default_value)}
        if base.is_linked:
            link = base.links[0]
            original["link"] = [link.from_node.name, link.from_socket.identifier]
            links.new(link.from_socket, blend.inputs[1])
        else:
            blend.inputs[1].default_value = base.default_value
        normal = shader.inputs["Normal"]
        links.new(normal.links[0].from_socket if normal.is_linked else geometry.outputs["Normal"], dot.inputs[0])
        links.new(geometry.outputs["Incoming"], dot.inputs[1])
        links.new(dot.outputs["Value"], absolute.inputs[0])
        links.new(absolute.outputs[0], ramp.inputs[0])
        links.new(ramp.outputs["Color"], scale.inputs[0])
        links.new(scale.outputs["Vector"], blend.inputs[2])
        links.new(blend.outputs[0], base)
        material[SOURCE_KEY] = json.dumps(record, sort_keys=True)
        material["corealm_iridescence_source_glbs"] = json.dumps(sorted(files))
        material["corealm_iridescence_mode"] = MODE
        material["corealm_iridescence_original_base"] = json.dumps(original, sort_keys=True)
        material["corealm_iridescence_original_inputs"] = json.dumps(original_inputs, sort_keys=True)
        material["corealm_iridescence_note"] = "Bounded view-angle base-color tint; not native glTF iridescence or an exact BRDF match."
    return validate_preview(directory)


def validate_preview(directory):
    rows = imported_materials(directory)
    for material, record, files in rows:
        assert json.loads(material.get(SOURCE_KEY, "null")) == record, material.name
        assert json.loads(material.get("corealm_iridescence_source_glbs", "null")) == sorted(files), material.name
        assert material.get("corealm_iridescence_mode") == MODE, material.name
        nodes = material.node_tree.nodes
        names = ("View", "Incidence", "Absolute cosine", "Sampled interference", "Tint multiplier", "Preserve blue pigment")
        selected = {name: nodes.get(PREFIX + name) for name in names}
        assert all(node is not None and not node.mute for node in selected.values()), material.name
        ramp, blend = selected["Sampled interference"], selected["Preserve blue pigment"]
        assert selected["Incidence"].operation == "DOT_PRODUCT"
        assert selected["Absolute cosine"].operation == "ABSOLUTE"
        assert selected["Tint multiplier"].operation == "SCALE"
        assert blend.blend_type == "MULTIPLY" and not blend.use_clamp
        assert math.isclose(selected["Tint multiplier"].inputs[3].default_value, 2.0)
        expected_strength = PREVIEW_STRENGTH * record["extension"].get("iridescenceFactor", 0)
        assert math.isclose(blend.inputs[0].default_value, expected_strength, abs_tol=1e-6)
        assert ramp.color_ramp.interpolation == "LINEAR" and ramp.color_ramp.color_mode == "RGB"
        assert len(ramp.color_ramp.elements) == SAMPLES
        for element, (position, color) in zip(ramp.color_ramp.elements, ramp_samples(record)):
            assert math.isclose(element.position, position, abs_tol=1e-6)
            assert all(math.isclose(a, b, abs_tol=1e-6) for a, b in zip(element.color, color))
        shader = next(node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
        assert not shader.mute and preserved_inputs(shader) == json.loads(material["corealm_iridescence_original_inputs"]), material.name

        def linked(destination, source):
            assert destination.is_linked and destination.links[0].from_socket == source, material.name

        linked(shader.inputs["Base Color"], blend.outputs[0])
        linked(blend.inputs[2], selected["Tint multiplier"].outputs["Vector"])
        linked(selected["Tint multiplier"].inputs[0], ramp.outputs["Color"])
        linked(ramp.inputs[0], selected["Absolute cosine"].outputs[0])
        linked(selected["Absolute cosine"].inputs[0], selected["Incidence"].outputs["Value"])
        linked(selected["Incidence"].inputs[1], selected["View"].outputs["Incoming"])
        normal = shader.inputs["Normal"]
        linked(selected["Incidence"].inputs[0], normal.links[0].from_socket if normal.is_linked else selected["View"].outputs["Normal"])
        original = json.loads(material["corealm_iridescence_original_base"])
        if "link" in original:
            link = blend.inputs[1].links[0] if blend.inputs[1].is_linked else None
            assert link and [link.from_node.name, link.from_socket.identifier] == original["link"], material.name
        else:
            assert not blend.inputs[1].is_linked
            assert all(math.isclose(a, b, abs_tol=1e-6) for a, b in zip(blend.inputs[1].default_value, original["default"]))
        outputs = [node for node in nodes if node.bl_idname == "ShaderNodeOutputMaterial" and node.is_active_output]
        assert outputs and any(output.inputs["Surface"].is_linked
                               and output.inputs["Surface"].links[0].from_node == shader for output in outputs), material.name
    return {"mode": MODE, "materials": len(rows), "sourceParametersMatch": True,
            "editableNodesConnected": True, "sampledCurveMatches": True,
            "nativeGltfBrdf": False}
