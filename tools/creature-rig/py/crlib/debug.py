"""Fit review image: mesh points with the fitted skeleton, front and side, plus weight views."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def fit_sheet(path, verts, skeleton, title="", thin=None, weights=None):
    rng = np.random.default_rng(0)
    sample = rng.choice(len(verts), size=min(len(verts), 6000), replace=False)
    fig, axes = plt.subplots(1, 3 if weights is not None else 2, figsize=(18 if weights is not None else 12, 8))
    views = [(0, 1, "front (x→ creature left)", -1), (2, 1, "side (z→ forward)", 1)]
    for ax, (u, v, label, flip) in zip(axes, views):
        colours = np.where(thin[sample], "#d58f6c", "#9aa3ad") if thin is not None else "#9aa3ad"
        ax.scatter(flip * verts[sample, u], verts[sample, v], s=0.6, c=colours, alpha=0.5)
        for bone in skeleton.bones:
            colour = {"leg": "#2f7de1", "arm": "#2fb35a", "cloth": "#d9442b", "tail": "#b34bd6", "root": "#888888"}.get(bone.kind, "#111111")
            ax.plot([flip * bone.head[u], flip * bone.tail[u]], [bone.head[v], bone.tail[v]], "-", color=colour, lw=2)
            ax.plot(flip * bone.head[u], bone.head[v], "o", color=colour, ms=3)
        ax.set_aspect("equal")
        ax.set_title(f"{title} {label}")
    if weights is not None:
        ax = axes[2]
        names, w = weights
        dominant = np.argmax(w, axis=1)
        cmap = plt.get_cmap("tab20")
        ax.scatter(-verts[sample, 0], verts[sample, 1], s=0.8, c=[cmap(d % 20) for d in dominant[sample]])
        ax.set_aspect("equal")
        ax.set_title("dominant bone (front)")
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)
