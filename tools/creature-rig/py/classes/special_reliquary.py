"""Reliquary class: a porcelain vessel carried on four stubby legs, with a small head.

The production mesh faces -X (its head is on the creature's right), so in game it walks
sideways. The fit works in a frame turned to face +Z, and bind_turns() turns the bind the same
way (a rigid turn of the whole body about the root), so the candidate faces +Z like every other
creature. The body is a rigid shell over four legs (special_quad), driven by the animal-pack
wild boar: a barrel body on short legs.
"""
import numpy as np

from classes.special_quad import fit_quad, quad_legs, rigid_body_override, touchdown_turns
from crlib.body import Body
from crlib.mathx import axis_angle

NAME = "special_reliquary"


def _turn(profile):
    return axis_angle([0.0, 1.0, 0.0], np.radians(profile.get("faceYaw", 90.0)))


def fit(body, donor, profile, source=None):
    R = _turn(profile)
    turned = Body(body.verts @ R.T, body.faces)
    V = turned.verts
    H = turned.height
    # The head: the body's farthest point forward above the feet.
    upper = V[V[:, 1] > 0.2 * H]
    tip = upper[np.argmax(upper[:, 2])]
    head = upper[upper[:, 2] > tip[2] - 0.08 * H].mean(0)
    head[2] = tip[2]
    sk, notes = fit_quad(turned, donor, profile, head)
    for b in sk.bones:
        b.head, b.tail = R.T @ b.head, R.T @ b.tail
    notes["faceYaw"] = profile.get("faceYaw", 90.0)
    return sk, notes


def bind_turns(sk, profile):
    """The facing turn; with profile "touchDown", a leg hanging above the floor at bind is turned
    down at its hip first (fitted before the facing turn, so only for faceYaw 0)."""
    turns = touchdown_turns(sk) if profile.get("touchDown") else {}
    if profile.get("faceYaw", 90.0):
        turns[sk.bones[0].name] = _turn(profile)
    return turns


def cloth(body, sk, profile, heat):
    P = sk.quad["prefix"]
    keep = [f"{P}_ROOTSHJnt"] + [f"{P}_Spine_0{i}SHJnt" for i in range(1, 5)] + [f"{P}_Spine_TopSHJnt"]
    return rigid_body_override(body, sk, keep)


def plan(sk, body, profile):
    P = sk.quad["prefix"]
    return {"hips": f"{P}_ROOTSHJnt", "legs": quad_legs(sk), "chains": [], "colliders": [],
            "hip_motion": profile.get("hipMotion", 1.0)}
