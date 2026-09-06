import bpy, json, pathlib

root = pathlib.Path(__file__).resolve().parent
paths = [root / 'sheepies.blend', *sorted((root / 'pracalic-original').rglob('*.blend'))]
results = []
for path in paths:
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False, use_scripts=False)
    row = {'source': str(path.relative_to(root)), 'blender': bpy.app.version_string, 'objects': [], 'images': [], 'actions': []}
    for obj in bpy.data.objects:
        item = {'name': obj.name, 'type': obj.type, 'parent': obj.parent.name if obj.parent else None}
        if obj.type == 'MESH':
            item.update(vertices=len(obj.data.vertices), polygons=len(obj.data.polygons),
                        materials=[m.name if m else None for m in obj.data.materials],
                        vertex_groups=[g.name for g in obj.vertex_groups],
                        modifiers=[{'name': m.name, 'type': m.type} for m in obj.modifiers],
                        dimensions=list(obj.dimensions), unweighted_vertices=sum(not v.groups for v in obj.data.vertices))
        elif obj.type == 'ARMATURE':
            item['bones'] = [{'name': b.name, 'head': list(b.head_local), 'tail': list(b.tail_local)} for b in obj.data.bones]
        row['objects'].append(item)
    for image in bpy.data.images:
        row['images'].append({'name': image.name, 'path': image.filepath, 'packed': bool(image.packed_file), 'size': list(image.size)})
    for action in bpy.data.actions:
        row['actions'].append({'name': action.name, 'frames': list(action.frame_range)})
    results.append(row)
(root / 'native-inventory.json').write_text(json.dumps(results, indent=2), encoding='utf8')
print(json.dumps([{'source': row['source'], 'meshes': sum(o['type']=='MESH' for o in row['objects']), 'rigs': sum(o['type']=='ARMATURE' for o in row['objects']), 'actions': row['actions'], 'images': row['images']} for row in results]))
