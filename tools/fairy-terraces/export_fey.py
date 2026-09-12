"""Export locally supplied Fey meshes and source idle animation inside Unreal, without saving sources."""
import json
import traceback
from pathlib import Path
import unreal

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.asset-cache/fairy-terraces/fey'
OUT.mkdir(parents=True, exist_ok=True)
BASE = '/Game/ParagonFey/Characters/Heroes/Fey/'
ASSETS = {
    'fey_opaline': BASE + 'Skins/Opaline/Meshes/Fey_Opaline',
    'fey_nightshade': BASE + 'Skins/Nightshade/Meshes/Fey_Nightshade',
    'fey_autumn': BASE + 'Skins/AutumnKeeper/Meshes/Fey_AutumnKeeper',
    'fey_frostbloom': BASE + 'Skins/Frostbloom/Meshes/Fey_Frostbloom',
    'idle': BASE + 'Animations/Idle',
    'travel': BASE + 'Animations/Idle_Travel',
}
report = []
try:
    options = unreal.GLTFExportOptions()
    options.set_editor_property('default_material_bake_size', unreal.GLTFMaterialBakeSize(x=1024, y=1024))
    options.set_editor_property('default_level_of_detail', 1)
    options.set_editor_property('export_vertex_skin_weights', True)
    options.set_editor_property('export_animation_sequences', True)
    options.set_editor_property('export_preview_mesh', True)
    for name, asset_path in ASSETS.items():
        row = {'id': name, 'source': asset_path}
        try:
            asset = unreal.load_asset(asset_path)
            if not asset:
                raise RuntimeError('Missing source asset')
            output = OUT / (name + '.glb')
            result = unreal.GLTFExporter.export_to_gltf(asset, str(output), options, set())
            row.update(bytes=output.stat().st_size if output.exists() else 0,
                       errors=[str(x) for x in result.errors], warnings=[str(x) for x in result.warnings])
        except Exception:
            row['error'] = traceback.format_exc()
        report.append(row)
        (OUT / 'export-report.json').write_text(json.dumps(report, indent=2))
finally:
    unreal.SystemLibrary.quit_editor()
