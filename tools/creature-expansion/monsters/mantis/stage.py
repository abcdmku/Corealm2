"""Extract Monster09 source assets, preserving Unity pathname values."""
import argparse
import json
from pathlib import Path
import tarfile


def main():
    root = Path(__file__).resolve().parents[4]
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, default=Path.home() / "AppData/Roaming/Unity/Asset Store-5.x/PixeliusVita/3D ModelsCharactersCreatures/Fantasy Monster 09 Game Ready Rigged Animations PixeliusVita.unitypackage")
    parser.add_argument("--out", type=Path, default=root / "test-results/creature-expansion/sources/monsters/mantis")
    args = parser.parse_args()
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest = []
    with tarfile.open(args.package, "r:gz") as archive:
        members = {member.name: member for member in archive.getmembers()}
        for name, member in members.items():
            if not name.endswith("/pathname"):
                continue
            # This package appends a newline and literal 00 to pathname records.
            pathname = archive.extractfile(member).read().decode().splitlines()[0].rstrip("\0")
            if not Path(pathname).suffix:
                continue
            asset = members.get(name[:-8] + "asset")
            if not asset or not asset.isfile():
                continue
            destination = (output / pathname).resolve()
            if not destination.is_relative_to(output):
                raise ValueError(f"Unsafe Unity pathname: {pathname}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.extractfile(asset).read())
            manifest.append({"path": pathname, "bytes": asset.size})
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Extracted {len(manifest)} Monster09 source files to {output}")


if __name__ == "__main__":
    main()
