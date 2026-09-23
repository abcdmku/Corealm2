"""Inspect exported horse clips and mesh deformation with Blender CPU evaluation."""
import bpy
import json
from pathlib import Path
from mathutils import Vector

candidate = Path('assets/art/tripo/imports/creatures/audit-wild-horse/wild-horse-candidate.glb').resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(candidate))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.name != 'Icosphere']
assert len(meshes) == 5
assert len(arm.data.bones) == 19
assert all(any(m.type == 'ARMATURE' for m in o.modifiers) for o in meshes)

def bounds():
    deps = bpy.context.evaluated_depsgraph_get()
    points = []
    centers = {}
    for o in meshes:
        evaluated = o.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        vertex_points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
        points.extend(vertex_points)
        centers[o.name] = list(sum(vertex_points, Vector()) / len(vertex_points))
        evaluated.to_mesh_clear()
    return {'min': [min(p[i] for p in points) for i in range(3)],
            'max': [max(p[i] for p in points) for i in range(3)],
            'centers': centers}

results = {'source': str(candidate), 'clips': {}, 'meshes': [o.name for o in meshes]}
for action in bpy.data.actions:
    arm.animation_data_create()
    arm.animation_data.action = action
    frames = [0, round(action.frame_range[1] / 3), round(action.frame_range[1] * .5),
              round(action.frame_range[1] * .75), round(action.frame_range[1])]
    observations = []
    for frame in sorted(set(frames)):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        obs = bounds()
        obs['frame'] = frame
        observations.append(obs)
    results['clips'][action.name] = observations
Path('assets/art/tripo/imports/creatures/audit-wild-horse/deformation-samples.json').write_text(json.dumps(results, indent=2))
print(json.dumps({name: [{'frame': o['frame'], 'min':o['min'], 'max':o['max']}
                         for o in obs] for name,obs in results['clips'].items()}, indent=2))
