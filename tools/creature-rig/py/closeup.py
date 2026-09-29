"""Close-up review renders of joint regions (shoulders, hips, knees) for a candidate GLB, so skin
deformation can be judged at a size the contact sheet cannot show.

  PYTHONPATH=D:/CorealmAgentCache/bpy-5.2 py -3.13 tools/creature-rig/py/closeup.py <glb> <out.png>
      [--clips Idle,Walk] [--phases 3] [--joints upperarm_l,thigh_l,calf_l] [--size 260]

One row per clip phase, one column per joint and view (front and side), each framed on the joint's
posed position. Workbench render with textures; the bind pose is the first row.
"""
import argparse
import math
import os
import sys

import bpy
import mathutils


def main():
    p = argparse.ArgumentParser()
    p.add_argument("glb")
    p.add_argument("out")
    p.add_argument("--clips", default="Idle,Walk")
    p.add_argument("--phases", type=int, default=3)
    p.add_argument("--joints", default="upperarm_l,upperarm_r,thigh_l,calf_l")
    p.add_argument("--size", type=int, default=260)
    p.add_argument("--span", type=float, default=0.22, help="view width as a share of body height")
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=a.glb)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    height = max(max((o.matrix_world @ mathutils.Vector(c)).z for c in o.bound_box) for o in meshes)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = a.size
    scene.render.resolution_y = a.size
    scene.render.film_transparent = False
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = a.span * height

    joints = [j for j in a.joints.split(",") if j in arm.pose.bones]
    actions = {act.name: act for act in bpy.data.actions}
    rows = [("bind", None, 0)]
    for clip in a.clips.split(","):
        act = next((x for n, x in actions.items() if n == clip or n.startswith(clip + "_") or n.endswith(clip)), None)
        if act is None:
            continue
        start, end = act.frame_range
        for k in range(a.phases):
            rows.append((clip, act, start + (end - start) * k / max(a.phases, 1)))
    tiles = []
    tmp = os.path.join(os.path.dirname(os.path.abspath(a.out)), "_closeup_tile.png")
    for label, act, frame in rows:
        if act is None:
            arm.animation_data_clear()
            for pb in arm.pose.bones:
                pb.matrix_basis = mathutils.Matrix()
            arm.data.pose_position = "REST"
        else:
            arm.data.pose_position = "POSE"
            if arm.animation_data is None:
                arm.animation_data_create()
            arm.animation_data.action = act
            if hasattr(arm.animation_data, "action_slot") and len(getattr(act, "slots", [])):
                arm.animation_data.action_slot = act.slots[0]
        scene.frame_set(int(frame), subframe=frame - int(frame))
        bpy.context.view_layer.update()
        row = []
        for j in joints:
            centre = arm.matrix_world @ arm.pose.bones[j].head
            for view in ((0, -1, 0), (1, 0, 0)):
                d = mathutils.Vector(view)
                cam.location = centre + d * height * 2
                cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
                scene.render.filepath = tmp
                bpy.ops.render.render(write_still=True)
                img = bpy.data.images.load(tmp)
                row.append(list(img.pixels))
                bpy.data.images.remove(img)
        tiles.append((f"{label} {frame:.0f}", row))
    cols = len(joints) * 2
    W, H = cols * a.size, len(tiles) * a.size
    sheet = bpy.data.images.new("sheet", W, H)
    px = [0.0] * (W * H * 4)
    for r, (_, row) in enumerate(tiles):
        for c, tile in enumerate(row):
            for y in range(a.size):
                dst = ((H - (r + 1) * a.size + y) * W + c * a.size) * 4
                src = y * a.size * 4
                px[dst:dst + a.size * 4] = tile[src:src + a.size * 4]
    sheet.pixels = px
    sheet.filepath_raw = a.out
    sheet.file_format = "PNG"
    sheet.save()
    if os.path.exists(tmp):
        os.remove(tmp)
    print(a.out, "rows:", [t[0] for t in tiles], "cols:", [f"{j}:{v}" for j in joints for v in ("front", "side")])


if __name__ == "__main__":
    main()
