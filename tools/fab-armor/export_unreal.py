"""Run inside Unreal Python; export private Fab sources without changing them."""
import json
import re
import traceback
from pathlib import Path

import unreal

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.asset-cache/fab-armor/paragon'
OUT.mkdir(parents=True, exist_ok=True)
ASSETS = {
    'mage-t50-rosewood': '/Game/ParagonKwang/Characters/Heroes/Kwang/Meshes/KwangRosewood',
    'melee-t50-novaborn': '/Game/ParagonGreystone/Characters/Heroes/Greystone/Skins/Novaborn/Meshes/Greystone_Novaborn',
    # Historical filename: Tough is the visually confirmed T70 selection.
    'melee-t50': '/Game/ParagonGreystone/Characters/Heroes/Greystone/Skins/Tough/Meshes/Greystone_Tough',
    # Historical filename: base Greystone is unselected, retained for comparison.
    'melee-t70': '/Game/ParagonGreystone/Characters/Heroes/Greystone/Meshes/Greystone',
    'melee-t90': '/Game/ParagonGreystone/Characters/Heroes/Greystone/Skins/WhiteTiger/Meshes/Greystone_WhiteTiger',
    'melee-t90-helmet': '/Game/ParagonGreystone/Characters/Heroes/Greystone/Skins/WhiteTiger/Meshes/SM_Greystone_TigerHelm',
    # Historical filename: GDC has purple cloth and is unselected.
    'mage-t50': '/Game/ParagonKwang/Characters/Heroes/Kwang/Meshes/Kwang_GDC',
    'mage-t70': '/Game/ParagonKwang/Characters/Heroes/Kwang/Meshes/KwangAlbino',
    'mage-t90': '/Game/ParagonKwang/Characters/Heroes/Kwang/Skins/Tier2/Kwang_Manbun_Zombie/Meshes/KwangFrostwalker',
}
report = []
try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    selected_asset = re.search(r'-ArmorAsset=([\w-]+)', unreal.SystemLibrary.get_command_line())
    if selected_asset:
        key = selected_asset.group(1)
        ASSETS = {key: ASSETS[key]}
        previous = OUT / 'export-report.json'
        if previous.exists():
            report = [row for row in json.loads(previous.read_text()) if row['name'] != key]
    if '-ArmorInspectOnly' in unreal.SystemLibrary.get_command_line():
        inspection = {'sockets': [], 'actors': []}
        tiger = unreal.load_asset(ASSETS['melee-t90'])
        for owner in (tiger, tiger.get_editor_property('skeleton')):
            try:
                for socket in owner.get_editor_property('sockets'):
                    inspection['sockets'].append({key: str(socket.get_editor_property(key)) for key in ('socket_name', 'bone_name', 'relative_location', 'relative_rotation', 'relative_scale')})
            except Exception:
                inspection['sockets'].append({'error': traceback.format_exc()})
        editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        kwang_inspection = '-ArmorInspectKwang' in unreal.SystemLibrary.get_command_line()
        editor.load_level('/Game/ParagonKwang/Characters/Maps/Kwang' if kwang_inspection else '/Game/ParagonGreystone/Characters/Maps/Greystone')
        for actor in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors():
            components = []
            for component in actor.get_components_by_class(unreal.MeshComponent):
                row = {'name': component.get_name(), 'class': component.get_class().get_name(), 'socket': str(component.get_attach_socket_name()), 'relative_location': str(component.get_editor_property('relative_location')), 'relative_rotation': str(component.get_editor_property('relative_rotation')), 'relative_scale3d': str(component.get_editor_property('relative_scale3d'))}
                for property_name in ('static_mesh', 'skeletal_mesh_asset'):
                    try:
                        mesh_value = component.get_editor_property(property_name)
                        if mesh_value:
                            row[property_name] = mesh_value.get_path_name()
                    except Exception:
                        pass
                components.append(row)
            if components:
                inspection['actors'].append({'name': actor.get_actor_label(), 'components': components})
        (OUT / ('kwang-map-inspection.json' if kwang_inspection else 'attachment-inspection.json')).write_text(json.dumps(inspection, indent=2))
        ASSETS = {}
    options = unreal.GLTFExportOptions()
    options.set_editor_property('default_material_bake_size', unreal.GLTFMaterialBakeSize(x=1024, y=1024))
    options.set_editor_property('default_level_of_detail', 0)
    options.set_editor_property('export_vertex_skin_weights', True)
    options.set_editor_property('export_morph_targets', False)
    for name, asset_path in ASSETS.items():
        row = {'name': name, 'asset': asset_path}
        try:
            mesh = unreal.load_asset(asset_path)
            if mesh is None:
                raise RuntimeError('Asset failed to load')
            row['class'] = mesh.get_class().get_name()
            materials = mesh.get_editor_property('materials' if row['class'] == 'SkeletalMesh' else 'static_materials')
            row['materials'] = [str(m.get_editor_property('material_interface').get_path_name()) if m.get_editor_property('material_interface') else None for m in materials]
            (OUT / 'current-asset.json').write_text(json.dumps(row, indent=2))
            output = OUT / (name + '.glb')
            result = unreal.GLTFExporter.export_to_gltf(mesh, str(output), options, set())
            row['result'] = str(result)
            row['bytes'] = output.stat().st_size if output.exists() else 0
            row['errors'] = [str(message) for message in result.errors]
            row['warnings'] = [str(message) for message in result.warnings]
            row['success'] = row['bytes'] > 0 and not row['errors']
        except Exception:
            row['error'] = traceback.format_exc()
            row['success'] = False
        report.append(row)
        (OUT / 'export-report.json').write_text(json.dumps(report, indent=2))
        unreal.log('COREALM_EXPORT ' + json.dumps(row))
except Exception:
    (OUT / 'fatal-error.txt').write_text(traceback.format_exc())
    unreal.log_error(traceback.format_exc())
finally:
    (OUT / 'finished.txt').write_text('Export script completed')
    unreal.SystemLibrary.quit_editor()
