"""Load donors headless and report what a class can use from them.

  PYTHONPATH=D:/CorealmAgentCache/bpy-5.2 py -3.13 tools/creature-rig/py/donor_check.py <key> [<key> ...]
  ... donor_check.py --class quadruped          every donor of classes/quadruped.donors.json
  ... donor_check.py --catalog                  every entry of py/donors.json
  ... donor_check.py --spec '{"pack": "animalpack", "name": "Wolf"}'

A key is a catalog key (py/donors.json). Per donor it prints the file, source fps, bone count, the
bone tree (--tree), whether the bone axes were re-aligned, the facing estimates (both should be
[0, 0, 1] once "yaw" is right), and per take: frames at 30 fps, seconds, source range and the root
bone's travel (a walk that is not in place travels towards +Z). Exit code 1 if any donor fails.
"""
import argparse
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from crlib import donor as donors_mod  # noqa: E402

CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "test-results", "creature-motion", "rig", "donors")


def tree(d):
    lines = []

    def walk(b, depth):
        h = d.rest_head[b]
        lines.append(f"{'  ' * depth}{b}  [{h[0]:.3f} {h[1]:.3f} {h[2]:.3f}]")
        for c in d.children(b):
            walk(c, depth + 1)
    for r in d.roots():
        walk(r, 1)
    return "\n".join(lines)


def check(key, spec, show_tree=False):
    d = donors_mod.load(key, spec, CACHE)
    heads = np.array([d.rest_head[b] for b in d.bones])
    root = d.roots()[0]
    hub = root
    while len(d.children(hub)) == 1:
        hub = d.children(hub)[0]
    out = {**d.report, "height": round(float(np.ptp(heads[:, 1])), 3), "length": round(float(np.ptp(heads[:, 2])), 3),
           "facing": donors_mod.facing(d), "root": root, "hub": hub}
    takes = out.pop("takes")
    print(f"== {key}: " + json.dumps(out, default=float))
    print(f"   takes available: {takes}")
    for name, clip in d.clips.items():
        H = clip["heads"][:, d.index(hub)]
        travel = H[-1] - H[0]
        print(f"   {name:<24} {len(clip['frames']):>4} f {clip['duration']:6.3f} s  src {clip['source']['fileFps']:g} fps "
              f"range {clip['source']['range']}  hub travel {np.round(travel, 3).tolist()}  hub y {H[:, 1].min():.3f}..{H[:, 1].max():.3f}"
              f"  rest delta {clip['source']['restDelta']:.3g}")
    if show_tree:
        print(tree(d))
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", nargs="*")
    ap.add_argument("--class", dest="cls")
    ap.add_argument("--catalog", action="store_true")
    ap.add_argument("--spec")
    ap.add_argument("--tree", action="store_true")
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    catalog = json.load(open(donors_mod.CATALOG))["donors"]
    jobs = []
    if args.spec:
        jobs.append(("spec", json.loads(args.spec)))
    if args.cls:
        jobs += list(json.load(open(os.path.join(HERE, "classes", f"{args.cls}.donors.json")))["donors"].items())
    if args.catalog:
        jobs += list(catalog.items())
    jobs += [(k, {"ref": k}) for k in args.keys]
    failed = 0
    for key, spec in jobs:
        try:
            check(key, spec, args.tree)
        except Exception:
            failed += 1
            print(f"{key}: FAILED\n{traceback.format_exc()}", file=sys.stderr)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
