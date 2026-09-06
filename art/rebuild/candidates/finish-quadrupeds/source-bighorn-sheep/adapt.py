import bpy, math, json, pathlib, hashlib
from mathutils import Matrix, Vector

ROOT = pathlib.Path(__file__).resolve().parent
SOURCE = ROOT.parent / 'source-caprine-free' / 'sheepies.blend'
EXPECTED = 'bd4cf09e732facd65c2313ff626b1a4a2cddd4d91cbda6c6ab8eb922dc026447'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == EXPECTED
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
body = bpy.data.objects['Sheep 2']
rig = body.parent
source_actions = list(bpy.data.actions)
rig.animation_data_clear()
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()

def smooth(a, b, x):
    t = max(0, min(1, (x-a)/(b-a)))
    return t*t*(3-2*t)

def gaussian(x, center, radius):
    return math.exp(-((x-center)/radius)**2)

def warp(point):
    # Source rig coordinates: +X forward, +/-Y lateral, +Z up. Continuous
    # regional deformation preserves the selected body's topology and weights.
    x, y, z = point
    head = smooth(.86, 1.15, x) * smooth(-.40, -.13, z)
    neck = gaussian(x, .79, .26) * smooth(-.61, -.20, z)
    chest = gaussian(x, .40, .38) * smooth(-1.04, -.56, z)
    back = (1-smooth(.52, .90, x)) * smooth(-.50, -.13, z)
    waist = gaussian(x, -.12, .34) * gaussian(z, -.76, .22)
    return Vector((x*.985 - .052*head*smooth(1.13, 1.42, x),
                   y*(.90 - .16*head + .17*neck + .075*chest),
                   z + .065*neck + .045*chest - .026*back + .060*waist
                   - .027*head*smooth(1.15, 1.42, x)))

# Convert all original body vertices into rig coordinates before the same
# deformation is applied to the body and bone rest positions.
relative = rig.matrix_world.inverted() @ body.matrix_world
original = [relative @ v.co for v in body.data.vertices]
old_edges = [tuple(edge.vertices) for edge in body.data.edges]
# Rebuild the old Blender mesh container while preserving every vertex, face,
# UV and named weight. Legacy deform custom-data otherwise drops skin export.
old_mesh=body.data
group_names=[g.name for g in body.vertex_groups]
weights=[[(g.group,g.weight) for g in v.groups] for v in old_mesh.vertices]
uvs=[(layer.name,[tuple(d.uv) for d in layer.data]) for layer in old_mesh.uv_layers]
clean=bpy.data.meshes.new('Sheep2_preserved_topology_clean_container')
clean.from_pydata([tuple(v.co) for v in old_mesh.vertices],[],[tuple(p.vertices) for p in old_mesh.polygons]);clean.update()
for name,values in uvs:
    layer=clean.uv_layers.new(name=name)
    for dest,value in zip(layer.data,values):dest.uv=value
body.data=clean
for name in group_names:body.vertex_groups.new(name=name)
for i,entries in enumerate(weights):
    for group,weight in entries:body.vertex_groups[group].add([i],weight,'REPLACE')
for vertex, point in zip(body.data.vertices, original):
    vertex.co = warp(point)
body.matrix_parent_inverse = Matrix.Identity(4)
body.matrix_basis = Matrix.Identity(4)
body.parent_type='OBJECT'
for modifier in body.modifiers:
    if modifier.type=='ARMATURE':modifier.object=rig
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for bone in rig.data.edit_bones:
    head, tail = warp(bone.head), warp(bone.tail)
    bone.head, bone.tail = head, tail
bpy.ops.object.mode_set(mode='OBJECT')

# Move the complete body and rig together. This is a uniform size choice,
# and does not shorten the lower legs independently of their bones.
ground = min(v.co.z for v in body.data.vertices)
scale = .60
rig.matrix_world = Matrix.Translation((0, 0, -ground*scale)) @ Matrix.Rotation(-math.pi/2, 4, 'Z') @ Matrix.Diagonal((scale, scale, scale, 1))
body.name = 'p0ss_Sheep2_whole_body_bighorn_adaptation'
body['license'] = 'CC-BY-SA-3.0'
body['original_author'] = 'p0ss'
body['source_sha256'] = EXPECTED
body['adaptation_status'] = 'CPU candidate; not production accepted'
body['source_topology_retained'] = True

image = next(image for image in bpy.data.images if image.packed_file and tuple(image.size)==(1024,1024))
image.filepath_raw = str(ROOT/'source-diffuse.png'); image.file_format='PNG'; image.save()
material = bpy.data.materials.new('Bighorn_coat_original_diffuse_and_regional_tint')
material.use_nodes=True
nodes, links = material.node_tree.nodes, material.node_tree.links
shader=nodes.get('Principled BSDF'); shader.inputs['Roughness'].default_value=.90
tex=nodes.new('ShaderNodeTexImage');tex.image=image
colors=nodes.new('ShaderNodeVertexColor');colors.layer_name='BighornCoat'
multiply=nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1
links.new(tex.outputs['Color'],multiply.inputs[1]);links.new(colors.outputs['Color'],multiply.inputs[2]);links.new(multiply.outputs[0],shader.inputs['Base Color'])
body.data.materials.clear();body.data.materials.append(material)
attribute=body.data.color_attributes.new(name='BighornCoat',type='FLOAT_COLOR',domain='CORNER')
body.data.color_attributes.active_color=attribute
def tint(point):
    x,y,z=point
    base=Vector((.47,.405,.32))
    shoulder=gaussian(x,.45,.36)*smooth(-.78,-.20,z)
    base=base.lerp(Vector((.36,.325,.28)),.28*shoulder)
    back=smooth(-.47,-.12,z)*(1-smooth(.7,1,x));base=base.lerp(Vector((.40,.37,.32)),.25*back)
    pale=max((1-smooth(-.79,-.62,x))*smooth(-1.02,-.71,z),smooth(1.21,1.40,x)*(1-smooth(-.05,.12,z)))
    base=base.lerp(Vector((.81,.76,.64)),pale*.84)
    hoof=(1-smooth(-1.565,-1.45,z));base=base.lerp(Vector((.24,.235,.21)),hoof*.91)
    flank=gaussian(x,-.03,.45)*gaussian(z,-.65,.22);base=base.lerp(Vector((.57,.49,.38)),flank*.20)
    return (*base,1)
for polygon in body.data.polygons:
    polygon.material_index=0;polygon.use_smooth=True
    for loop in polygon.loop_indices:attribute.data[loop].color=tint(body.data.vertices[body.data.loops[loop].vertex_index].co)

# One subdivision smooths the source's existing connected surface. It adds no
# substitute torso, muzzle, limb, or eye object and interpolates original UVs.
subdivision=body.modifiers.new('Whole_source_surface_refinement','SUBSURF');subdivision.levels=1;subdivision.render_levels=1
# Place subdivision before skinning so rest topology is stable in every frame.
bpy.context.view_layer.objects.active=body
bpy.ops.object.modifier_move_up(modifier=subdivision.name)

# Horn controls are part of this CC-BY-SA adaptation. The side projection is
# broad near the skull and tapers through an open cheek curl. Cross-sections
# have rounded triangular keratin faces, with shallow irregular growth cuts.
horn_controls=[
    [1.055,.120,.130,.062,.096], [.985,.205,.287,.081,.125],
    [.865,.275,.377,.091,.137], [.690,.315,.353,.084,.130],
    [.566,.335,.233,.074,.113], [.535,.341,.061,.064,.091],
    [.598,.338,-.088,.054,.071], [.744,.326,-.161,.043,.053],
    [.904,.305,-.126,.031,.037], [1.023,.284,-.038,.018,.023],
    [1.066,.272,.039,.008,.011],
]
def catmull(values,t):
    q=t*(len(values)-1);i=min(len(values)-2,int(q));a=q-i
    p0=values[max(0,i-1)];p1=values[i];p2=values[i+1];p3=values[min(len(values)-1,i+2)]
    return [((2*p1[k])+(-p0[k]+p2[k])*a+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*a*a+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*a*a*a)*.5 for k in range(len(p1))]
horn_material=bpy.data.materials.new('Bighorn_keratin');horn_material.use_nodes=True
horn_shader=horn_material.node_tree.nodes.get('Principled BSDF');horn_shader.inputs['Base Color'].default_value=(.42,.355,.255,1);horn_shader.inputs['Roughness'].default_value=.78
horns=[]
for side in [-1,1]:
    vertices=[];faces=[];rings=160;sides=24
    controls=[[x,side*y,z,rx,rz] for x,y,z,rx,rz in horn_controls]
    for row in range(rings+1):
        t=row/rings;p=catmull(controls,t);before=catmull(controls,max(0,t-.0001));after=catmull(controls,min(1,t+.0001))
        tangent=Vector(after[:3])-Vector(before[:3]);tangent.normalize()
        u=Vector((0,1,0));u-=tangent*u.dot(tangent);u.normalize();v=tangent.cross(u).normalized()
        for col in range(sides):
            angle=col/sides*math.tau
            angular=.125*math.cos(angle*3+.15)-.02*math.cos(angle*6+.30)
            phase=(t*30+.12*math.sin(t*17))*math.tau+.1*math.sin(angle*2)
            growth=.017*max(0,math.cos(phase))**6*(1-.80*smooth(.70,1,t))
            detail=1+angular*(1-.7*t)-growth
            pos=Vector(p[:3])+u*math.cos(angle)*p[3]*detail+v*math.sin(angle)*p[4]*detail
            vertices.append(tuple(pos))
    for row in range(rings):
        for col in range(sides):
            a=row*sides+col;b=row*sides+(col+1)%sides;faces.append((a,b,b+sides,a+sides))
    faces.append(tuple(reversed(range(sides))));faces.append(tuple(rings*sides+k for k in range(sides)))
    mesh=bpy.data.meshes.new('Bighorn_continuous_horn');mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new('Bighorn_horn_'+str(side),mesh);bpy.context.collection.objects.link(obj)
    obj.parent=rig;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_basis=Matrix.Identity(4)
    group=obj.vertex_groups.new(name='HEAD');group.add(list(range(len(vertices))),1,'REPLACE')
    modifier=obj.modifiers.new('Source_HEAD_binding','ARMATURE');modifier.object=rig
    mesh.materials.append(horn_material)
    for polygon in mesh.polygons:polygon.use_smooth=True
    obj['license']='CC-BY-SA-3.0';obj['adaptation_author']='Corealm';horns.append(obj)

for obj in list(bpy.data.objects):
    if obj not in [body,rig,*horns]:bpy.data.objects.remove(obj,do_unlink=True)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.select_all(action='DESELECT')
for obj in [body,rig,*horns]:obj.select_set(True)
rig.data.pose_position='POSE'
for action in source_actions:action.name='Source_'+action.name.replace(' ','_');action.use_fake_user=True
rig.animation_data_create();rig.animation_data.action=source_actions[0]

# Measure source motion on the adapted body. Ground error is evidence, not an
# automatically approved tolerance: these source clips are not production roles.
feet={}
for name,x,y in [('ForeL',.60,.25),('ForeR',.60,-.29),('HindL',-.64,.25),('HindR',-.65,-.28)]:
    ids=[i for i,p in enumerate(original) if p.z<-1.50 and abs(p.x-x)<.25 and abs(p.y-y)<.13]
    feet[name]=ids
motion=[]
subdivision.show_viewport=False
for action in source_actions:
    rig.animation_data.action=None
    for bone in rig.pose.bones:
        bone.location=(0,0,0);bone.rotation_quaternion=(1,0,0,0);bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
    rig.animation_data.action=action
    start,end=action.frame_range;low=1e9;high=-1e9;nonfinite=0;foot_low=1e9;foot_high=-1e9;contact_samples=0;previous={};slip_max=0
    for step in range(33):
        bpy.context.scene.frame_set(int(start+(end-start)*step/32));bpy.context.view_layer.update()
        evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());em=evaluated.to_mesh()
        # Bounds include every evaluated vertex, including subdivided soles.
        for vertex in em.vertices:
            point=evaluated.matrix_world@vertex.co
            if not all(math.isfinite(v)for v in point):nonfinite+=1
            low=min(low,point.z)
        for name,ids in feet.items():
            points=[evaluated.matrix_world@em.vertices[i].co for i in ids]
            sole=min(p.z for p in points);center=sum(points,Vector())/len(points)
            foot_low=min(foot_low,sole);foot_high=max(foot_high,sole)
            planted=abs(sole)<.025
            if planted:contact_samples+=1
            if name in previous and planted and previous[name][1]:
                delta=center-previous[name][0];slip_max=max(slip_max,Vector((delta.x,delta.y,0)).length)
            previous[name]=(center,planted)
        evaluated.to_mesh_clear()
    motion.append({'name':action.name,'frames':[start,end],'durationSeconds':(end-start)/bpy.context.scene.render.fps,'sampledFrames':33,'minimumMeshGroundY':low,'nonfiniteVertices':nonfinite,
        'sourceSoleHeightRange':[foot_low,foot_high],'nearGroundFootSamples':contact_samples,'maximumNearGroundHorizontalSampleDisplacement':slip_max,'contactPassed':False})
subdivision.show_viewport=True
rig.animation_data.action=None;rig.data.pose_position='REST';bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
out=ROOT/'bighorn-source-adaptation.glb'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'bighorn-source-adaptation.blend'))
rest_objects=[]
for obj in [body,*horns]:
    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=bpy.context.evaluated_depsgraph_get())
    mesh.transform(obj.matrix_world)
    static=bpy.data.objects.new(obj.name+'_rest_bake',mesh);bpy.context.collection.objects.link(static);rest_objects.append(static)
bpy.ops.object.select_all(action='DESELECT')
for obj in rest_objects:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'bighorn-rest-review.glb'),export_format='GLB',use_selection=True,
    export_animations=False,export_skins=False,export_yup=True,
    export_apply=True,export_extras=True,export_materials='EXPORT',export_image_format='AUTO')
for obj in rest_objects:bpy.data.objects.remove(obj,do_unlink=True)
for obj in [body,rig,*horns]:obj.select_set(True)
rig.data.pose_position='POSE';rig.animation_data.action=source_actions[0]
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_animations=True,
    export_animation_mode='ACTIONS',export_anim_single_armature=True,export_force_sampling=True,
    export_frame_range=False,export_skins=True,export_def_bones=False,export_yup=True,
    export_apply=True,export_extras=True,export_materials='EXPORT',export_image_format='AUTO')
ratios=[]
for a,b in old_edges:
    old=(original[a]-original[b]).length
    if old>1e-8:ratios.append((body.data.vertices[a].co-body.data.vertices[b].co).length/old)
report={'source':str(SOURCE),'sourceSha256':EXPECTED,'sourceMesh':'Sheep 2','sourceVertices':len(original),
    'retainedBodyVertices':len(body.data.vertices),'retainedBodyPolygons':len(body.data.polygons),'sourceTopologyRetained':True,
    'bones':len(rig.data.bones),'sourceActions':[a.name for a in source_actions],
    'missingProductionRoles':['Run','Attack','Hit','HitLeft','HitRight','Death'],
    'motionGroundMeasurements':motion,'sourceFootVertexSamples':{k:len(v)for k,v in feet.items()},
    'edgeDeformationRatio':[min(ratios),max(ratios)],'uniformScale':scale,
    'license':'CC-BY-SA-3.0','accepted':False,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
(ROOT/'adaptation-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
