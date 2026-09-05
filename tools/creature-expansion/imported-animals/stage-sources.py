"""Stage licensed animal FBXs and lossless PNG textures for the browser asset compiler."""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import shutil
from PIL import Image


SOURCES = {
    "reedjaw_crocodile": {
        "rig": "Crocodile_Rig.fbx",
        "animations": [f"Crocodile_{clip}.fbx" for clip in ("Idle", "Walk", "Run", "Bite", "Die")],
        "textures": ["crocodile_col7_unity.tga", "crocodile_nrml3.tga"],
    },
    "kiln_salamander": {
        "rig": "FireSalamander_Rig.fbx",
        "animations": [f"FireSalamander_{clip}.fbx" for clip in ("Idle", "Walk", "Run", "Die")],
        "textures": ["fire_salamander_col3_unity.tga", "fire_salamander_nrml3.tga"],
    },
    "reedbank_goose": {
        "rig": "swan_goose_rig_exp.FBX",
        "animations": [f"swan_goose_{clip}_anim.FBX" for clip in ("idle", "walk", "run", "die")],
        "textures": ["swan_goose_col_unity.tga", "swan_goose_nrml13.tga"],
    },
    "quarry_snail": {
        "rig": "snail_rig_exp.FBX",
        "animations": [f"snail_{clip}_anim.FBX" for clip in ("idle", "walk", "die")],
        "textures": ["snail_col4_unity.tga", "snail_nrml3.tga"],
    },
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("C:/Users/Borg/.t3/tmp/animalpack/extracted/Assets/Animal pack deluxe"))
    parser.add_argument("--output", type=Path, default=Path("test-results/creature-expansion/sources/animals"))
    args = parser.parse_args()
    animals = []
    for species, entry in SOURCES.items():
        destination = args.output / species
        destination.mkdir(parents=True, exist_ok=True)
        files = []
        source_files = [("rig", "Models", entry["rig"])] + [("animation", "Animations", file) for file in entry["animations"]] + [("texture", "Textures", file) for file in entry["textures"]]
        for role, folder, filename in source_files:
            original = args.source / folder / filename
            staged = destination / (Path(filename).with_suffix(".png").name if role == "texture" else filename)
            if role == "texture":
                with Image.open(original) as image:
                    image.load()
                    decoded = image.tobytes()
                    image.save(staged, format="PNG")
                    with Image.open(staged) as check:
                        assert check.mode == image.mode and check.size == image.size and check.tobytes() == decoded, original
                operation = "lossless TGA-to-PNG; identical decoded pixels"
            else:
                shutil.copyfile(original, staged)
                assert staged.read_bytes() == original.read_bytes(), original
                operation = "byte-for-byte copy"
            files.append({
                "role": role, "operation": operation,
                "originalPath": str(original), "sourceRelativePath": f"{folder}/{filename}",
                "stagedPath": str(staged),
                "originalSha256": sha256(original.read_bytes()).hexdigest(),
                "stagedSha256": sha256(staged.read_bytes()).hexdigest(),
                "originalBytes": original.stat().st_size, "stagedBytes": staged.stat().st_size,
                **({"decodedPixelSha256": sha256(decoded).hexdigest()} if role == "texture" else {}),
            })
        animals.append({"id": species, "directory": str(destination), "files": files})
    manifest = {
        "schemaVersion": 1, "sourcePack": "Animal pack deluxe", "author": "janpec",
        "license": "Standard Unity Asset Store EULA; project owner must confirm entitlement",
        "sourceRoot": str(args.source), "stagedRoot": str(args.output), "animals": animals,
        "notes": ["FBXs retain source names and bytes.", "PNG textures retain source dimensions, pixel data, and orientation.", "Snail has no source Run. Its faster crawl and missing combat clips are authored by motions.mjs."],
    }
    (args.output / "source-provenance.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Staged {sum(len(animal['files']) for animal in animals)} files for {len(animals)} species.")


if __name__ == "__main__":
    main()
