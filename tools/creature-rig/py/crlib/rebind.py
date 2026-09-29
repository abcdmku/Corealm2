"""Re-posing the bind.

Tripo bodies arrive in a T-pose. Every donor holds its arms 45-85 degrees lower most of the time,
so a T-pose bind makes linear blend skinning bend the shoulders 80 degrees in nearly every frame
and pinch the armpit. A class may ask for a different bind (arms at 45-50 degrees): the mesh is
posed there once with dual-quaternion skinning (no candy-wrapping), and that posed mesh becomes the
bind geometry, with rest == bind as always. Runtime rotations around the new bind are then about
half as large. Topology, UVs and weights are unchanged.
"""
import numpy as np

from .mathx import quat_from_matrix


def _qmul(a, b):
    ax, ay, az, aw = a.T
    bx, by, bz, bw = b.T
    return np.stack([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz], axis=-1)


def _qrotate(q, v):
    u, w = q[:, :3], q[:, 3:4]
    t = 2 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def repose(skeleton, turns):
    """turns: {bone: world rotation about its head}. Children of a turned bone turn with it.
    Returns per-bone (R, t) world transforms from the old bind to the new one."""
    moves = {}
    for b in skeleton.bones:
        parent = moves.get(b.parent, (np.eye(3), np.zeros(3)))
        R, t = parent
        if b.name in turns:
            head = R @ b.head + t
            T = turns[b.name]
            R, t = T @ R, T @ t + head - T @ head
        moves[b.name] = (R, t)
    return moves


def apply(skeleton, verts, joints, weights, moves):
    """Moves the skeleton to the new bind and returns (new verts, per-vertex rotation quats)."""
    names = skeleton.names()
    qr = np.array([quat_from_matrix(moves[n][0]) for n in names])
    tq = np.array([np.append(moves[n][1], 0.0) for n in names])
    qd = 0.5 * _qmul(tq, qr)
    lead = qr[joints[:, 0]]
    blend_r = np.zeros((len(verts), 4))
    blend_d = np.zeros((len(verts), 4))
    for k in range(joints.shape[1]):
        r = qr[joints[:, k]]
        d = qd[joints[:, k]]
        sign = np.sign(np.sum(r * lead, axis=1, keepdims=True))
        sign[sign == 0] = 1
        blend_r += weights[:, k:k + 1] * sign * r
        blend_d += weights[:, k:k + 1] * sign * d
    norm = np.linalg.norm(blend_r, axis=1, keepdims=True)
    blend_r /= norm
    blend_d /= norm
    conj = blend_r * np.array([-1, -1, -1, 1.0])
    t = 2 * _qmul(blend_d, conj)[:, :3]
    new_verts = _qrotate(blend_r, verts) + t
    for b in skeleton.bones:
        R, tt = moves[b.name]
        b.head, b.tail = R @ b.head + tt, R @ b.tail + tt
    return new_verts, blend_r
