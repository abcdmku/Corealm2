"""Knuckle class: an upright body whose floor-length arms are its front legs (the starroot
guardian, a treant that walks on its knuckles like a gorilla).

A human donor hangs such arms straight down and drives the knuckles through the floor, and a
human strike swings a two-metre arm through the body. A knuckle-walker moves like a heavy
quadruped instead, so every clip comes from a quadruped donor (the Animal pack bear) through a
role map: the arms are the front legs, the legs the hind legs, and the spine, neck and head
take the bear's spine, neck and head.

The skeleton is the golem fit (the humanoid landmarks, sole joints, heel pivot and rigid bark
plates) on the humanoid primary donor. No bone copies the bear's directions (a bear's horizontal
back would lay the torso flat): every bone adds the bear's motion on top of its own rest
(follow 0). The profile's "lean" re-poses the bind into a knuckle-walker's carriage (bind_turns),
so the torso is held far more upright than a bear's and the bear's rear-up in Attack lifts it to
upright with both arms overhead before the slam. The core's leg IK plants each knuckle and each
foot on the donor's scaled paw paths; the sole contact keeps the knuckles on the floor, never
through it. The hands keep their bind hang (_steady_hands).

Death is the cattle's collapse onto its side with the torso, neck and head riding the pelvis
("donorRoles") and a fifth of its hip drop: the crown's branches reach a metre sideways and hold
the fallen body up, so the full drop would bury them.
"""
import numpy as np

from classes import authored, golem, quadruped
from crlib.mathx import axis_angle

NAME = "knuckle"
SIDES = ("l", "r")

# Target bone -> bear role ({s} is the side). A profile "roleMap" replaces entries.
ROLE_MAP = {
    "root": "MAIN",
    "pelvis": "ROOT",
    "spine_01": "Spine_02",
    "spine_02": "Spine_03",
    "spine_03": "Spine_Top",
    "neck_01": "Neck_01",
    "Head": "Neck_Top",
    "clavicle_{s}": "{s}_Clavicle_01_01",
    "upperarm_{s}": "{s}_FrontLeg_Hip",
    "lowerarm_{s}": "{s}_FrontLeg_Knee",
    "hand_{s}": "{s}_FrontLeg_Ankle",
    "thigh_{s}": "{s}_HindLeg_Hip",
    "calf_{s}": "{s}_HindLeg_Knee",
    "foot_{s}": "{s}_HindLeg_Ankle",
    "ball_{s}": "{s}_HindLeg_Ball",
}

# The bear's Hit: its Die up to the first beat, eased back to Idle (the quadruped flinch).
authored.MOTIONS["flinch_bear"] = quadruped.flinch


def _roles(profile, key=None):
    """{target bone: donor role or None}. Profile "roleMap" replaces entries for every donor,
    "donorRoles": {donor key: {bone: role or null}} for one donor (a Death donor whose head goes
    to the floor can leave the head riding the chest: null follows the parent)."""
    table = {**ROLE_MAP, **(profile.get("roleMap") or {}), **((profile.get("donorRoles") or {}).get(key) or {})}
    out = {}
    for bone, role in table.items():
        for s in SIDES if "{s}" in bone else ("",):
            out[bone.replace("{s}", s)] = role.replace("{s}", s) if role else None
    return out


def fit(body, donor, profile, source=None):
    sk, notes = golem.fit(body, donor, profile, source=source)
    missing = [b for b in _roles(profile) if b not in sk]
    if missing:
        raise RuntimeError(f"the golem fit has no {missing}; the knuckle class needs arms and legs")
    for b in sk.bones:
        b.follow = 0.0
        if b.donor is None and b.name in _roles(profile):
            b.donor = b.name  # golem quiet bones: the bear drives the whole torso
    return sk, notes


def plan(sk, body, profile):
    base = golem.plan(sk, body, profile)
    legs = []
    for s in SIDES:
        # Front: shoulder to wrist bends, the hand is the foot (its knuckles are the sole).
        legs.append({"chain": [f"upperarm_{s}", f"lowerarm_{s}"], "foot": f"hand_{s}", "toe": None, "pivot": 1})
        legs.append({"chain": [f"thigh_{s}", f"calf_{s}"], "foot": f"foot_{s}", "toe": f"ball_{s}", "pivot": 1})
    return {**base, "legs": legs}


def donor_map(sk, donor, profile):
    """The bear drives the body by role; the humanoid primary names every bone already. A role
    the donor lacks falls back to its first numbered twin (cattle: Knee1 for Knee)."""
    if all(b.donor is None or b.donor in donor.rest_frame for b in sk.bones):
        return None
    r = quadruped.roles(donor, profile)
    _steady_hands(donor, r)
    out = {}
    for name, role in _roles(profile, getattr(donor, "key", None)).items():
        if name in sk:
            out[name] = (r.get(role) or r.get(role + "1")) if role else None
    return out


def _steady_hands(donor, r):
    """The front paw's position is the knuckles' IK path, but its turn is not the hand's: a bear
    flexes its paw through every swing, which flips a hand as long as a forearm up behind the
    arm. The donor's front ankles take the hub's turn in every frame (their heads, the paths, are
    kept), so the hand keeps its bind hang and turns only with the body."""
    if getattr(donor, "_steadyHands", False):
        return
    hub = r["ROOT"]
    k_hub = donor.index(hub)
    for side in SIDES:
        ankle = r.get(f"{side}_FrontLeg_Ankle")
        if not ankle:
            continue
        k = donor.index(ankle)
        fix = donor.rest_frame[hub].T @ donor.rest_frame[ankle]
        for clip in donor.clips.values():
            clip["frames"][:, k] = clip["frames"][:, k_hub] @ fix
    donor._steadyHands = True


def cloth(body, sk, profile, heat):
    return golem.cloth(body, sk, profile, heat)


def bind_turns(sk, profile):
    """profile "lean" (degrees): the knuckle-walker's carriage. The upper body pitches forward at
    the lower spine ("leanBone", default spine_01), the head turns back by "headKeep" of that so
    the face still looks ahead, and each arm swings back at the shoulder until its hand is at its
    bind height again: the knuckles land ahead of where they hung, under the forward shoulders.
    The mesh is re-posed once with dual quaternions; rest == bind as always, so every clip carries
    the stance and the bear's motion adds to it (its rear-up in Attack lifts the lean to upright)."""
    lean = float(profile.get("lean", 0.0))
    if not lean:
        return {}
    x = np.array([1.0, 0.0, 0.0])
    pivot_bone = profile.get("leanBone", "spine_01")
    pivot = sk[pivot_bone].head
    R = axis_angle(x, np.radians(lean))
    turns = {pivot_bone: R}
    keep = float(profile.get("headKeep", 0.8))
    if keep and "Head" in sk:
        turns["Head"] = axis_angle(x, np.radians(-lean * keep))
    moved = lambda p: pivot + R @ (p - pivot)
    for s in SIDES:
        shoulder = moved(sk[f"upperarm_{s}"].head)
        tip = moved(sk[f"hand_{s}"].tail)
        want = sk[f"hand_{s}"].tail[1]
        angles = np.radians(np.arange(0.0, -lean - 30.0, -0.25))
        ys = np.array([(shoulder + axis_angle(x, a) @ (tip - shoulder))[1] for a in angles])
        turns[f"upperarm_{s}"] = axis_angle(x, angles[int(np.argmin(np.abs(ys - want)))])
    return turns


def recoil_bones(sk, plan, profile):
    """The runtime Hit recoil moves the neck and head only: the spine carries the arms, which are
    legs here, so its recoil would slide the planted knuckles."""
    return [b for b in ("neck_01", "Head") if b in sk]


def closeup_joints(sk, profile):
    return ["upperarm_l", "lowerarm_l", "hand_l", "thigh_l", "calf_l", "spine_02"]
