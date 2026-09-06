"""Optional Cat anatomy adaptation. Import only; never imports assets or exports.

Coordinates are historical FBX armature-local: X lateral, Y rearward, Z up.
Caller owns a disposable imported scene, skin fitting, action rebaking and export.
"""
import math
from mathutils import Vector


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x-a)/(b-a)))
    return t*t*(3.0-2.0*t)


class LynxWarp:
    """One continuous deformation shared by mesh and optional rest-bone edits."""
    def __init__(self, armature):
        self.armature = armature
        names = ['Tail'] + ['Tail.%03d' % i for i in range(1, 8)]
        self.tail = [armature.data.bones[n].head_local.copy() for n in names]
        self.tail.append(armature.data.bones['Tail.007'].tail_local.copy())
        self.lengths = [0.0]
        for a, b in zip(self.tail, self.tail[1:]):
            self.lengths.append(self.lengths[-1]+(b-a).length)
        self.start = self.tail[0].copy()
        self.ears = [armature.data.bones[n].head_local.copy() for n in ['Ear', 'Ear.006']]
        self.feet = [armature.data.bones[n].tail_local.copy() for n in
                     ['Foot_front_L', 'Foot_front_R', 'Foot_Back_L', 'Foot_Back_R']]

    def tail_point(self, p):
        """Shorten centerline while retaining radial girth and the original closed tip."""
        best = None
        for i, (a, b) in enumerate(zip(self.tail, self.tail[1:])):
            d = b-a
            t = max(0.0, min(1.0, (p-a).dot(d)/d.length_squared))
            center = a+d*t
            distance = (p-center).length_squared
            if best is None or distance < best[0]:
                best = (distance, i, t, center, d.normalized())
        _, i, t, center, tangent = best
        u = (self.lengths[i] + t*(self.lengths[i+1]-self.lengths[i]))/self.lengths[-1]
        # ~1.35 source units, 13.5 cm at preview scale; gently descending stump.
        target = self.start + Vector((0, 1.32*u, -.30*u*u))
        target_tangent = Vector((0, 1.32, -.60*u)).normalized()
        radial = tangent.rotation_difference(target_tangent) @ (p-center)
        # Keep root radius; slightly plumper distal contour. Topology is untouched.
        return target + radial*(1.0+.10*smooth(.1, .8, u)), u

    def point(self, point, tail_weight=0.0):
        p = Vector(point)
        q = p.copy()
        # Paw expansion keeps sole Z and ankle position. It does not lengthen legs.
        for f in self.feet:
            influence = (1-smooth(.35, .95, abs(p.y-f.y))) * (1-smooth(-2.45, -1.90, p.z))
            influence *= 1-smooth(.35, .80, abs(p.x-f.x))
            q.x += (p.x-f.x)*.23*influence
            q.y += (p.y-f.y)*.10*influence
        # Restrained connected cheek flare, fading before muzzle and ear bases.
        ruff = math.exp(-((p.y+2.80)/.67)**2-((p.z-2.35)/.72)**2)
        q.x += p.x*.12*ruff
        # Pinna stays small; terminal band narrows and lengthens into an ear tuft.
        for ear in self.ears:
            side = 1 if ear.x > 0 else -1
            mask = smooth(.22, .48, p.x*side)*(1-smooth(.55, 1.05, abs(p.y-ear.y)))
            height = p.z-ear.z
            rise = smooth(0, .70, height)*mask
            q.x += (ear.x-p.x)*.16*rise
            q.z -= max(0.0, height)*.17*rise
            tuft = smooth(.64, .90, height)*mask
            q.x += (side*1.01-q.x)*.45*tuft
            q.z += .20*tuft
        if tail_weight > 0:
            mapped, _ = self.tail_point(p)
            # Bone weights fade the anatomical tail root into the connected rump.
            q = q.lerp(mapped, smooth(.03, .70, tail_weight))
        return q

    def points(self, points, tail_weights=None):
        """Batch API for parent-owned fitting. Inputs stay armature-local.

        This is the same spatial map for sampled evaluated targets. It is not
        pose-equivariant: parent must measure target errors and foot contacts.
        Supply original vertex tail-weight sums in the unchanged vertex order.
        """
        if tail_weights is None:
            tail_weights = [0.0]*len(points)
        if len(points) != len(tail_weights):
            raise ValueError('Point and tail-weight counts differ')
        return [self.point(p, w) for p, w in zip(points, tail_weights)]

    __call__ = points


def coat_color(p, tail_u=None):
    """Deterministic coherent grey/buff coat in source coordinates, linear RGB."""
    x, y, z = p
    underside = (1-smooth(.1, 1.65, z))*(1-smooth(1.05, 1.45, abs(x)))
    buff = .5+.5*math.sin(y*1.1+z*.7)
    base = [.30+.055*buff, .275+.027*buff, .235+.012*buff]
    for i in range(3):
        base[i] = base[i]*(1-.32*underside) + [.53,.49,.41][i]*.32*underside
    # Soft broken dapples with finer hair-like variation, no unrelated UV islands.
    wave = math.sin(x*12+math.sin(y*5))*math.sin(y*11+math.sin(z*6))*math.sin(z*14+x*3)
    dapple = smooth(.24, .68, wave)
    grain = math.sin(x*137+y*73+z*311)*math.sin(z*193-y*29)
    for i in range(3):
        base[i] = max(.02, base[i]*(1-.37*dapple)+.018*grain)
    tuft = smooth(4.17, 4.40, z)*(1-smooth(-3.25, -2.85, y))
    terminal = 0 if tail_u is None else smooth(.70, .86, tail_u)
    dark = max(tuft, terminal)
    return tuple(c*(1-.84*dark) for c in base)+(1.0,)


def adapt_cat(body, armature, *, adapt_rest_rig=False, native_motion_rebake_authorized=False,
              apply_coat=True):
    """Mutate caller's imported Cat only. Returns warp, landmarks and audit counts.

    Default mesh-only result is for static review. A changed rest rig invalidates
    original animation matrices; the explicit flag requires caller to rebake them.
    Fitted helper bones must be included in any subsequent rest/pose rebake.
    """
    import bpy
    if body.get('lynx_source_adapted'):
        raise ValueError('Cat was already adapted; reimport source before another pass')
    if adapt_rest_rig and not native_motion_rebake_authorized:
        raise ValueError('Rest edits require caller-owned full native action rebake')
    if body.type != 'MESH' or armature.type != 'ARMATURE':
        raise TypeError('Expected imported Cat mesh and original armature')
    if len(body.data.vertices) != 22650:
        raise ValueError('Expected complete 22,650-vertex JonasDichelle Cat source')
    warp = LynxWarp(armature)
    local = armature.matrix_world.inverted() @ body.matrix_world
    inverse = local.inverted()
    tail_groups = {g.index for g in body.vertex_groups
                   if g.name == 'Tail' or g.name.startswith('Tail.')} 
    source = [local @ v.co for v in body.data.vertices]
    old_polygons = len(body.data.polygons)
    max_delta = 0.0
    tail_count = 0
    tail_weights = []
    colors = []
    for vertex, p in zip(body.data.vertices, source):
        weight = sum(g.weight for g in vertex.groups if g.group in tail_groups)
        tail_weights.append(weight)
        q = warp.point(p, weight)
        vertex.co = inverse @ q
        max_delta = max(max_delta, (p-q).length)
        tail_count += int(weight > .03)
        u = warp.tail_point(p)[1] if weight > .5 else None
        colors.append(coat_color(p, u))
    # Shape-key corrections represent original coordinates; mapping every key is
    # necessary but not sufficient to prove post-adaptation animation accuracy.
    if body.data.shape_keys:
        for block in body.data.shape_keys.key_blocks:
            for vertex, key in zip(body.data.vertices, block.data):
                w = sum(g.weight for g in vertex.groups if g.group in tail_groups)
                key.co = inverse @ warp.point(local @ key.co, w)
    if apply_coat:
        existing = body.data.color_attributes.get('LynxCoat')
        if existing:
            body.data.color_attributes.remove(existing)
        attribute = body.data.color_attributes.new(name='LynxCoat', type='FLOAT_COLOR', domain='POINT')
        for item, color in zip(attribute.data, colors):
            item.color = color
        body.data.color_attributes.active_color = attribute
        material = bpy.data.materials.new('Lynx source grey buff dapple')
        material.use_nodes = True
        shader = material.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Roughness'].default_value = .89
        color_node = material.node_tree.nodes.new('ShaderNodeVertexColor')
        color_node.layer_name = 'LynxCoat'
        material.node_tree.links.new(color_node.outputs['Color'], shader.inputs['Base Color'])
        body.data.materials.clear()
        body.data.materials.append(material)
        for polygon in body.data.polygons:
            polygon.material_index = 0
    if adapt_rest_rig:
        previous = bpy.context.view_layer.objects.active
        bpy.context.view_layer.objects.active = armature
        armature.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        try:
            for bone in armature.data.edit_bones:
                # Core limb pivots remain unchanged. Only tail and pinna chains
                # need new rest positions; every other bone is deliberately kept.
                if bone.name.startswith('Tail'):
                    bone.head = warp.tail_point(bone.head)[0]
                    bone.tail = warp.tail_point(bone.tail)[0]
                elif bone.name.startswith('Ear'):
                    bone.head = warp.point(bone.head)
                    bone.tail = warp.point(bone.tail)
        finally:
            bpy.ops.object.mode_set(mode='OBJECT')
            bpy.context.view_layer.objects.active = previous
    body.data.update()
    body['lynx_source_adapted'] = True
    body['lynx_motion_requires_rebake'] = True
    return {'warp': warp, 'vertices': len(source), 'polygons': old_polygons,
            'tail_weights': tail_weights,
            'tail_vertices': tail_count, 'max_delta_source_units': max_delta,
            'native_motion_preserved': False, 'source_forward': '-Y', 'source_up': '+Z',
            'hindquarter_lift': 0.0, 'rest_rig_adapted': adapt_rest_rig}
