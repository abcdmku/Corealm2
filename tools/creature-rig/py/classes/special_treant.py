"""Bone heat per loose piece, for meshes whose whole-mesh heat solve fails (many interpenetrating
loose pieces: the solve finds no solution and returns no weight at all, but succeeds piece by piece).
The serpent and special_star classes call heat_by_pieces() from their cloth() hook, the first class
hook that sees the heat weights. (This was the Bloomheart Matriarch's class; that body now rigs on
the treant class, whose attach step handles its loose pieces.)
"""
import numpy as np


def heat_by_pieces(sk, heat):
    """Bone heat per loose piece, written into heat (vertices x bones) in place."""
    import bpy

    from crlib.skin import bone_heat

    src = next(o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) == len(heat))
    copy = src.copy()
    copy.data = src.data.copy()
    copy.modifiers.clear()
    copy.vertex_groups.clear()
    bpy.context.scene.collection.objects.link(copy)
    layer = copy.data.attributes.new("source_index", "INT", "POINT")
    layer.data.foreach_set("value", np.arange(len(heat), dtype=np.int32))
    for o in bpy.data.objects:
        o.select_set(False)
    copy.select_set(True)
    bpy.context.view_layer.objects.active = copy
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    for piece in pieces:
        idx = np.zeros(len(piece.data.vertices), dtype=np.int32)
        piece.data.attributes["source_index"].data.foreach_get("value", idx)
        W = bone_heat(piece, sk)
        heat[idx] = W[:, :heat.shape[1]]
        for arm in [o for o in bpy.data.objects if o.type == "ARMATURE"]:
            bpy.data.objects.remove(arm)
        bpy.data.objects.remove(piece)
    return heat
