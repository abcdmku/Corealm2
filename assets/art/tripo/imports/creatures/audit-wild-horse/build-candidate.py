"""Repair ChadM's CC0 horse rig and author a self-contained Corealm clip set.

Run from the repository root with bpy on PYTHONPATH. Source files are read-only.
"""
import bpy
import hashlib
import json
import math
from mathutils import Matrix, Quaternion, Vector
from pathlib import Path

ROOT = Path.cwd()
HERE = ROOT / 'assets/art/tripo/imports/creatures/audit-wild-horse'
SOURCE = ROOT / 'art/rebuild/candidates/finish-quadrupeds/source-hoofed'
BLEND = SOURCE / 'riggedHorse.blend'
STATIC = SOURCE / 'horse-source-static.glb'
ORIGINAL = SOURCE / 'original/horse'
OUTPUT = HERE / 'wild-horse-candidate.glb'
EXPECTED_STATIC_SHA256 = 'cdf4f716f7bd1a980814c53ed9fa81d28e016e2e316ed3f319982d7e3cbce782'
assert hashlib.sha256(STATIC.read_bytes()).hexdigest() == EXPECTED_STATIC_SHA256

bpy.ops.wm.open_mainfile(filepath=str(BLEND), load_ui=False, use_scripts=False)
bpy.context.scene.render.fps = 30
bpy.context.scene.render.fps_base = 1
arm = bpy.data.objects['Armature']
# The derivative Blend contains legacy IK constraints with missing targets.
# Our keyed FK poses fully define the required motion, so discard these stale
# constraints before sampling; otherwise exported channels bake wrong poses.
for pose_bone in arm.pose.bones:
    for constraint in list(pose_bone.constraints):
        pose_bone.constraints.remove(constraint)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
assert {o.name for o in meshes} == {'Plane', 'BezierCurve', 'BezierCurve.005', 'Sphere', 'Sphere.002'}
for o in list(bpy.data.objects):
    if o.type not in {'ARMATURE', 'MESH'}:
        bpy.data.objects.remove(o, do_unlink=True)

def material(name, diffuse, normal=None, alpha=False):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    pbr = nodes.new('ShaderNodeBsdfPrincipled')
    pbr.inputs['Roughness'].default_value = .83
    mat.node_tree.links.new(pbr.outputs['BSDF'], out.inputs['Surface'])
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(ORIGINAL / diffuse), check_existing=True)
    mat.node_tree.links.new(tex.outputs['Color'], pbr.inputs['Base Color'])
    if normal:
        ntex = nodes.new('ShaderNodeTexImage')
        ntex.image = bpy.data.images.load(str(ORIGINAL / normal), check_existing=True)
        ntex.image.colorspace_settings.name = 'Non-Color'
        nmap = nodes.new('ShaderNodeNormalMap')
        mat.node_tree.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        mat.node_tree.links.new(nmap.outputs['Normal'], pbr.inputs['Normal'])
    if alpha:
        mat.surface_render_method = 'DITHERED'
        mat.use_transparency_overlap = False
        mat.node_tree.links.new(tex.outputs['Alpha'], pbr.inputs['Alpha'])
    return mat

bodymat = material('Wild horse · source coat', 'HorseMain2k00.png', 'HorseMain2k00Norm00.png')
hairmat = material('Wild horse · source hair', 'Hair12Main2k.png', 'Hair12Main2kNorm.png', True)
eyemat = material('Wild horse · source eye', 'eye_texture.png')
for o in meshes:
    o.data.materials.clear()
    o.data.materials.append(bodymat if o.name == 'Plane' else eyemat if o.name.startswith('Sphere') else hairmat)

def attach(o, weights):
    """Skin source geometry in armature space without moving a single vertex."""
    world = o.matrix_world.copy()
    world_points = [world @ v.co for v in o.data.vertices]
    for name in weights:
        o.vertex_groups.new(name=name)
    for vertex, point in zip(o.data.vertices, world_points):
        assigned = weights[next(iter(weights))](point) if len(weights) == 1 else None
        if assigned is not None:
            o.vertex_groups[next(iter(weights))].add([vertex.index], 1.0, 'REPLACE')
            continue
        raw = {name: max(0.0, fn(point)) for name, fn in weights.items()}
        total = sum(raw.values())
        if total <= 1e-9:
            raise RuntimeError(f'Unweighted vertex {o.name}:{vertex.index}')
        for name, weight in raw.items():
            if weight > 1e-5:
                o.vertex_groups[name].add([vertex.index], weight / total, 'REPLACE')
    o.parent = arm
    o.matrix_world = world
    mod = o.modifiers.new('Native horse skin repair', 'ARMATURE')
    mod.object = arm

def blend3(y, points):
    """Piecewise linear bone weights along the horse's longitudinal axis."""
    result = {}
    for name, center, width in points:
        result[name] = max(0, 1 - abs(y - center) / width)
    return result

# Mane runs from poll to withers; smooth neck/body/head weights prevent the
# original unweighted hair sheet from staying behind during attack and death.
attach(bpy.data.objects['BezierCurve'], {
    'Bone': lambda p: blend3(p.y, [('Bone', -1.8, 2.5)])["Bone"],
    'Bone.001': lambda p: blend3(p.y, [('Bone.001', -4.7, 3.3)])["Bone.001"],
    'Bone.002': lambda p: blend3(p.y, [('Bone.002', -7.5, 2.4)])["Bone.002"],
})
attach(bpy.data.objects['BezierCurve.005'], {
    'Bone.003': lambda p: max(0, 1 - max(0, p.y - 4.4) / 1.8),
    'Bone.004': lambda p: max(0, min(1, (p.y - 4.4) / 1.8)),
})
for name in ('Sphere', 'Sphere.002'):
    attach(bpy.data.objects[name], {'Bone.002': lambda p: 1.0})

# All source objects retain their geometry and UVs. An empty supplies one
# measured, uniform normalization for the whole rig and all appendages.
bounds = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = [min(p[i] for p in bounds) for i in range(3)]
hi = [max(p[i] for p in bounds) for i in range(3)]
scale = 2.4 / (hi[2] - lo[2])
center_y = (hi[1] + lo[1]) / 2
normalizer = bpy.data.objects.new('Corealm horse normalization', None)
bpy.context.collection.objects.link(normalizer)
normalizer.location = (-(hi[0]+lo[0]) * .5 * scale, -center_y * scale, -lo[2] * scale)
normalizer.scale = (scale, scale, scale)
for o in [arm]:
    world = o.matrix_world.copy()
    o.parent = normalizer
    o.matrix_world = world

# Keyed native-bone actions. Body and appendages share one skin and one timeline.
rest_q = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}
def world_axis(name, axis, angle):
    q = rest_q[name]
    return q.inverted() @ Quaternion(Vector(axis), angle) @ q

def bell(t, center, width):
    u = abs(t-center) / width
    return 0 if u >= 1 else (1+math.cos(math.pi*u)) / 2

clips = {'Idle': 2.0, 'Walk': 1.2, 'Run': 23/30, 'Attack': 29/30,
         'Hit': 17/30, 'HitLeft': 17/30, 'HitRight': 17/30, 'Death': 1.6}
fore = [('Bone_L', 'Bone_L.001', 'Bone_L.002', 0.0),
        ('Bone_R', 'Bone_R.001', 'Bone_R.002', .5)]
hind = [('Bone_L.003', 'Bone_L.004', 'Bone_L.005', .75),
        ('Bone_R.003', 'Bone_R.004', 'Bone_R.005', .25)]
origin = arm.location.copy()
for clip, duration in clips.items():
    action = bpy.data.actions.new(clip)
    arm.animation_data_create()
    arm.animation_data.action = action
    samples = max(12, round(duration * 30))
    for frame in range(samples+1):
        t = frame / samples
        f = frame
        angle = {b.name: 0.0 for b in arm.data.bones}
        location = origin.copy()
        roll = 0.0
        if clip in ('Walk', 'Run'):
            running = clip == 'Run'
            amp = .45 if running else .29
            for upper, middle, lower, offset in fore + hind:
                phase = 2*math.pi*(t+offset+(0 if not running or upper in ('Bone_L','Bone_L.001','Bone_L.002') else 0))
                angle[upper] = amp * math.sin(phase)
                angle[middle] = -.27 * max(0, math.sin(phase)) if running else -.16 * max(0, math.sin(phase))
                angle[lower] = .16 * max(0, math.sin(phase))
            angle['Bone'] = .028*math.sin(4*math.pi*t)
            angle['Bone.001'] = -.04*math.sin(4*math.pi*t)
            angle['Bone.003'] = .07*math.sin(2*math.pi*t)
        elif clip == 'Idle':
            angle['Bone.001'] = .016*math.sin(2*math.pi*t)
            angle['Bone.002'] = .025*math.sin(2*math.pi*t+.7)
            angle['Bone.003'] = .05*math.sin(2*math.pi*t)
            angle['Bone.004'] = .06*math.sin(2*math.pi*t+.8)
        elif clip == 'Attack':
            rear = bell(t,.46,.26)
            recoil = bell(t,.18,.17)
            angle['Bone'] = -.12*rear + .045*recoil
            angle['Bone.001'] = .12*rear
            angle['Bone.002'] = -.08*rear
            # Lethal hind kick; front pair brace and head drives forward.
            angle['Bone_L.003'] = 1.00*rear
            angle['Bone_L.004'] = -.30*rear
            angle['Bone_L.005'] = -.22*rear
            angle['Bone_R.003'] = .33*rear
            angle['Bone_R.004'] = -.12*rear
            angle['Bone_L'] = -.18*rear
            angle['Bone_R'] = -.18*rear
            angle['Bone.003'] = .15*rear
        elif clip.startswith('Hit'):
            hit = bell(t,.3,.29)
            side = 1 if clip == 'HitLeft' else -1 if clip == 'HitRight' else 0
            angle['Bone'] = .10*hit
            angle['Bone.001'] = -.20*hit
            angle['Bone.002'] = .16*hit
            roll = side*.075*hit
        elif clip == 'Death':
            s = min(1.0, max(0.0, (t-.12)/.72))
            s = s*s*(3-2*s)
            roll = 1.34*s
            # Keep the shoulder above ground while the torso rolls; the
            # final lift vanishes, leaving the body settled on its side.
            location.z = origin.z - 3.35*s + 1.25*math.sin(math.pi*s)
            angle['Bone.001'] = .15*s
            angle['Bone.002'] = -.12*s
            for upper, middle, lower, offset in fore+hind:
                angle[upper] = (.16 if upper in ('Bone_L', 'Bone_R') else -.12)*s
                angle[middle] = -.2*s
        arm.location = location
        arm.rotation_mode = 'XYZ'
        arm.rotation_euler = (0,roll,0)
        arm.keyframe_insert(data_path='location', frame=f, group='Root')
        arm.keyframe_insert(data_path='rotation_euler', frame=f, group='Root')
        for bone in arm.pose.bones:
            bone.rotation_mode = 'QUATERNION'
            bone.rotation_quaternion = world_axis(bone.name, (1,0,0), angle[bone.name])
            bone.keyframe_insert(data_path='rotation_quaternion', frame=f, group=bone.name)
    action.use_fake_user = True
    action['corealm_duration_seconds'] = duration
    print('ACTION', clip, duration, samples+1)

arm.animation_data.action = None
arm.location = origin
arm.rotation_euler = (0,0,0)
for bone in arm.pose.bones:
    bone.rotation_quaternion.identity()
bpy.context.view_layer.update()

bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=False,
                          export_animations=True, export_animation_mode='ACTIONS',
                          export_force_sampling=True, export_frame_step=1,
                          export_extras=True)

manifest = {
    'id': 'creature_marchwild_horse',
    'identity': 'Genuine CC0 horse; Lyndon Daniels body/textures, ChadM source rig adapted',
    'source': {'nativeBlend': str(BLEND.relative_to(ROOT)).replace('\\','/'),
               'nativeBlendSha256': hashlib.sha256(BLEND.read_bytes()).hexdigest(),
               'staticReviewGlb': str(STATIC.relative_to(ROOT)).replace('\\','/'),
               'staticReviewSha256': EXPECTED_STATIC_SHA256,
               'licenseEvidence': str((SOURCE/'LICENSE.md').relative_to(ROOT)).replace('\\','/'),
               'license': 'CC0-1.0',
               'originalAuthor': 'Lyndon Daniels', 'rigAuthor': 'ChadM'},
    'candidate': OUTPUT.name,
    'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
    'bytes': OUTPUT.stat().st_size,
    'sourceMeshObjects': [o.name for o in meshes],
    'restHeightMeters': 2.4,
    'restBounds': {'min': [(lo[0]-(hi[0]+lo[0])*.5)*scale, 0.0,
                           -(hi[1]-center_y)*scale],
                   'max': [(hi[0]-(hi[0]+lo[0])*.5)*scale, 2.4,
                           -(lo[1]-center_y)*scale]},
    'sourceNormalizationScale': scale,
    'nativeBones': len(arm.data.bones),
    'repairedSkins': ['mane', 'tail', 'left eye', 'right eye'],
    'clipsSeconds': clips,
    'attackContactPhase': .46,
    'pending': ['Root lab motion/screenshot acceptance', 'Root production integration'],
}
(HERE/'candidate.json').write_text(json.dumps(manifest, indent=2))
catalog = {'schema': 'corealm-lab-asset-candidates/1',
           'assets': [{'id': manifest['id'], 'file': 'models/creature/creature_marchwild_horse.glb',
                       'pack': 'lyndon-realtime-ranchers-cc0', 'category': 'character',
                       'is': 'wild horse', 'tags': ['animal','hoofed','horse','cc0','source-rigged'],
                       'bytes': manifest['bytes'], 'sha256': manifest['sha256'],
                       'triangles': 14986,
                       'size': dict(zip(('x','y','z'), [hi_v-lo_v for hi_v,lo_v in zip(manifest['restBounds']['max'], manifest['restBounds']['min'])])),
                       'base': dict(zip(('x','y','z'), manifest['restBounds']['min'])),
                       'bounds': manifest['restBounds'], 'groundY': 0,
                       'animations': list(clips), 'skinned': True,
                       'walkClipSeconds': 1.2, 'runClipSeconds': 23/30,
                       'attackSeconds': 29/30,
                       'sourceProvenance': manifest['source'],
                       'acceptance': {'sourceIdentityVerified': True, 'rigAccepted': False,
                                      'motionAccepted': False, 'texturesAccepted': False,
                                      'labAccepted': False, 'worldIntegrated': False}}],
           'files': {manifest['id']: OUTPUT.name},
           'pack': {'id': 'lyndon-realtime-ranchers-cc0', 'name':'Realtime Rancher horse',
                    'author':'Lyndon Daniels; rig by ChadM',
                    'source':'https://opengameart.org/content/realtime-ranchers-3d-model-pack',
                    'license':'CC0-1.0'},
           'reviewOnly': True}
(HERE/'lab-catalog.json').write_text(json.dumps(catalog, indent=2))
print('RESULT', json.dumps(manifest))
