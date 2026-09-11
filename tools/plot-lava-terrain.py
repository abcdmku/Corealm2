"""Render the measured production section written by lava-terrain-survey.ts."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

rows = json.loads(Path("test-results/lava-survey/cross-section.json").read_text())
x = np.array([r["offset"] for r in rows])
terrain = np.array([r["terrain"] for r in rows])
original = np.array([r["original"] for r in rows])
lava = np.array([np.nan if r["lava"] is None else r["lava"] for r in rows])
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "svg.fonttype": "none"})
fig, ax = plt.subplots(figsize=(10, 4.5), layout="constrained")
fig.patch.set_facecolor("#f5f2eb")
ax.set_facecolor("#f5f2eb")
ax.fill_between(x, 4, terrain, color="#54545a", alpha=.88)
ax.plot(x, terrain, color="#292932", lw=1.6, label="Rebuilt terrain (production lattice)")
ax.plot(x, original, color="#887867", lw=1.4, ls="--", label="Original ground")
ax.fill_between(x, terrain, lava, where=np.isfinite(lava), color="#dc5429", alpha=.72)
ax.plot(x, lava, color="#fa5720", lw=2.8, label="Lava free surface")
ax.set(xlim=(-25, 25), ylim=(4, 16), xlabel="Distance across the channel (metres)",
       ylabel="World elevation (metres)", title="Widow's Furnace: measured terrain cross-section")
ax.grid(axis="y", color="#c7c3bb", lw=.5, alpha=.55)
ax.set_axisbelow(True)
ax.spines[["top", "right"]].set_visible(False)
ax.legend(loc="upper left", frameon=False, fontsize=9)
ax.text(.99, .03, "Shared terrain geometry, not an erosion simulation", transform=ax.transAxes,
        ha="right", fontsize=8, color="#eeeeef")
Path("docs/figures").mkdir(exist_ok=True)
fig.savefig("docs/figures/lava-terrain-cross-section.svg")
svg_path = Path("docs/figures/lava-terrain-cross-section.svg")
svg_path.write_text("\n".join(line.rstrip() for line in svg_path.read_text().splitlines()) + "\n")
fig.savefig("test-results/lava-survey/cross-section.png", dpi=150)
