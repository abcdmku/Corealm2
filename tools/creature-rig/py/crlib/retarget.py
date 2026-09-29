"""Rest-relative retargeting of donor clips onto a fitted skeleton.

Per bone and frame, in world space:
  follow = 1 (limbs): the target bone takes the donor bone's world orientation. Because the target
    rest frame is the donor rest frame turned onto the target bone, this first swings the target
    from its own rest (T-pose, A-pose, hunched) into the donor's rest and then applies the donor's
    motion, i.e. the rest poses are matched before transfer and bone roll carries over.
  follow = 0 (torso, head, clavicles): the donor's rotation away from its rest is applied on top
    of the target's own rest, so a hunched back stays hunched.
Only the hips translate, by the donor's hip offset scaled by the leg-length ratio. Ground gaits
get two-bone foot IK towards the donor's scaled ankle path, which keeps planted feet planted.
Bones with no donor twin (tails, capes, loincloth panels) follow their parent and are then driven
by a damped spring chain (follow-through), with the legs as colliders and the floor as a plane.
"""
import numpy as np

from .mathx import axis_angle, min_arc, normalize, orthonormalize, quat_from_matrix, slerp_matrix, continuous_quats


def forward(skeleton, local_R, pelvis_name, pelvis_pos):
    """World rotations and head positions from local rotations and the hips position."""
    R, P = {}, {}
    for b in skeleton.bones:
        if b.parent is None:
            R[b.name] = local_R[b.name]
            P[b.name] = b.head.copy()
            continue
        p = skeleton[b.parent]
        R[b.name] = R[b.parent] @ local_R[b.name]
        if b.name == pelvis_name:
            P[b.name] = pelvis_pos
        else:
            P[b.name] = P[b.parent] + R[b.parent] @ (p.frame.T @ (b.head - p.head))
    return R, P


def to_local(skeleton, R):
    return {b.name: (R[b.name] if b.parent is None else R[b.parent].T @ R[b.name]) for b in skeleton.bones}


def two_bone_ik(hip, knee_fk, goal, l1, l2):
    """Knee position reaching goal, bending in the plane the FK knee bends in."""
    d_vec = goal - hip
    d = np.linalg.norm(d_vec)
    d = np.clip(d, abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
    u = normalize(d_vec)
    goal = hip + u * d
    pole = knee_fk - hip
    pole = pole - np.dot(pole, u) * u
    if np.linalg.norm(pole) < 1e-6:
        pole = np.array([0.0, 0.0, 1.0]) - np.dot([0, 0, 1.0], u) * u
    pole = normalize(pole)
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = np.sqrt(max(l1 * l1 - a * a, 0.0))
    return hip + u * a + pole * h, goal


def _pitch_to(offset, axis, target_dy, exact):
    """Rotation about axis (the bone's lateral axis) that brings the offset's height to
    target_dy: exactly when the donor foot is in contact, otherwise only up to it (no sinking)."""
    now = offset[1]
    if not exact and now >= target_dy:
        return np.eye(3)
    angles = np.radians(np.arange(-80, 80.5, 0.5))
    ys = np.array([(axis_angle(axis, a) @ offset)[1] for a in angles])
    ok = ys >= target_dy - 1e-4 if not exact else np.ones_like(ys, bool)
    cost = np.abs(ys - target_dy) + 0.02 * np.abs(angles)
    if not exact:
        cost = np.where(ok, np.abs(angles), np.inf)
        if not np.isfinite(cost).any():
            cost = -ys
    return axis_angle(axis, angles[int(np.argmin(cost))])


class Retargeter:
    def __init__(self, skeleton, donor, plan):
        self.sk = skeleton
        self.donor = donor
        self.plan = plan
        self.hips = plan["hips"]
        self.legs = plan.get("legs", [])
        sk = skeleton
        d = donor
        # Leg-length ratio: target hip-to-ankle over donor hip-to-ankle (rest), for hips and feet.
        if self.legs:
            t_len = np.mean([np.linalg.norm(sk[c].head - sk[t].head) + np.linalg.norm(sk[f].head - sk[c].head) for t, c, f, *_ in self.legs])
            d_len = np.mean([np.linalg.norm(d.rest_head[sk[c].donor] - d.rest_head[sk[t].donor]) + np.linalg.norm(d.rest_head[sk[f].donor] - d.rest_head[sk[c].donor]) for t, c, f, *_ in self.legs])
        else:
            t_len = sk[self.hips].head[1]
            d_len = d.rest_head[sk[self.hips].donor][1]
        self.scale = t_len / d_len

    # ------------------------------------------------------------------ core
    def _world_targets(self, clip, f):
        sk, d = self.sk, self.donor
        frames = d.clips[clip]["frames"][f]
        T = {}
        for b in sk.bones:
            if b.donor:
                W = frames[d.index(b.donor)]
                D = d.rest_frame[b.donor]
                delta = W @ D.T @ b.frame
                T[b.name] = delta if b.follow <= 0 else (W if b.follow >= 1 else slerp_matrix(delta, W, b.follow))
            else:
                parent = sk[b.parent]
                T[b.name] = T[b.parent] @ parent.frame.T @ b.frame
        return T

    def sample(self, name, spec):
        sk, d = self.sk, self.donor
        clip = d.clips[spec["clip"]]
        n = len(clip["frames"])
        hips_d = d.index(sk[self.hips].donor)
        rest_hips_d = d.rest_head[sk[self.hips].donor]
        hips_path = clip["heads"][:, hips_d] - rest_hips_d
        drift = np.zeros((n, 3))
        if spec.get("loop") or spec.get("in_place", True):
            # In place: remove the net horizontal travel (keep sway and bob).
            travel = hips_path[-1] - hips_path[0] if spec.get("loop") else np.zeros(3)
            drift[:, [0, 2]] = np.outer(np.linspace(0, 1, n), travel[[0, 2]])
            if not spec.get("loop"):
                drift[:, [0, 2]] = 0.0
        hip_motion = self.plan.get("hip_motion", 1.0)
        out_R, out_T = [], []
        for f in range(n):
            T = self._world_targets(spec["clip"], f)
            L = to_local(sk, T)
            pelvis = sk[self.hips].head + self.scale * hip_motion * (hips_path[f] - drift[f])
            R, P = forward(sk, L, self.hips, pelvis)
            if spec.get("ik", True):
                for thigh, calf, foot, *_ in self.legs:
                    donor_ankle = clip["heads"][f, d.index(sk[foot].donor)]
                    goal = sk[foot].head + self.scale * (donor_ankle - d.rest_head[sk[foot].donor] - drift[f])
                    l1 = np.linalg.norm(sk[calf].head - sk[thigh].head)
                    l2 = np.linalg.norm(sk[foot].head - sk[calf].head)
                    knee, goal = two_bone_ik(P[thigh], P[calf], goal, l1, l2)
                    swing = min_arc(P[calf] - P[thigh], knee - P[thigh])
                    R[thigh] = swing @ R[thigh]
                    R[calf] = swing @ R[calf]
                    calf_dir = R[calf] @ (sk[calf].frame.T @ (sk[foot].head - sk[calf].head))
                    # The calf keeps its FK twist; it swings onto the solved knee-to-ankle line.
                    # The foot keeps its donor world orientation (the ankle absorbs the change).
                    R[calf] = min_arc(calf_dir, goal - knee) @ R[calf]
                    P[calf], P[foot] = knee, goal
                    # Foot and toes pitch so the ball and the toe tip follow the donor's scaled
                    # heights: a heel-off rolls over the ball instead of pushing it into the floor.
                    toe = rest[3] if len(rest := (thigh, calf, foot, *_)) > 3 else None
                    if toe:
                        heads = clip["heads"][f]
                        ball_d = heads[d.index(sk[toe].donor)]
                        lift = ball_d[1] - d.rest_head[sk[toe].donor][1]
                        contact = lift < 0.01
                        lateral = R[foot] @ (sk[foot].frame.T @ np.array([1.0, 0.0, 0.0]))
                        offset = R[foot] @ (sk[foot].frame.T @ (sk[toe].head - sk[foot].head))
                        swing = _pitch_to(offset, lateral, sk[toe].head[1] + self.scale * max(lift, 0.0) - goal[1], contact)
                        R[foot] = swing @ R[foot]
                        R[toe] = swing @ R[toe]
                        ball = goal + R[foot] @ (sk[foot].frame.T @ (sk[toe].head - sk[foot].head))
                        W_toe = clip["frames"][f][d.index(sk[toe].donor)]
                        tip_d = ball_d + W_toe @ d.rest_frame[sk[toe].donor].T @ (d.rest_tail[sk[toe].donor] - d.rest_head[sk[toe].donor])
                        tip_lift = tip_d[1] - d.rest_tail[sk[toe].donor][1]
                        lateral = R[toe] @ (sk[toe].frame.T @ np.array([1.0, 0.0, 0.0]))
                        offset = R[toe] @ (sk[toe].frame.T @ (sk[toe].tail - sk[toe].head))
                        R[toe] = _pitch_to(offset, lateral, sk[toe].tail[1] + self.scale * max(tip_lift, 0.0) - ball[1], tip_lift < 0.01) @ R[toe]
                L = to_local(sk, R)
            out_R.append(L)
            out_T.append(pelvis)
        return {"n": n, "fps": clip["fps"], "L": out_R, "pelvis": out_T, "loop": bool(spec.get("loop"))}

    # ------------------------------------------------------------- secondary
    def secondary(self, result, chains, colliders, floor=0.0, cycles=3):
        """Damped spring chains for bones with no donor. Loops run several cycles and keep the
        last one, so the motion is periodic; one-shots settle on their first frame first."""
        sk = self.sk
        n = result["n"]
        dt = 1.0 / result["fps"]
        sub = 4
        h = dt / sub
        poses = []
        for f in range(n):
            R, P = forward(sk, {k: v for k, v in result["L"][f].items()}, self.hips, result["pelvis"][f])
            poses.append((R, P))
        for chain in chains:
            bones = chain["bones"]
            stiff, damp, grav = chain.get("stiffness", 60.0), chain.get("damping", 6.0), chain.get("gravity", 2.0)
            rest_len = [np.linalg.norm(sk[b].tail - sk[b].head) for b in bones]

            hang = chain.get("hang", 0.0)
            root_rest = sk[bones[0]].head

            def targets(f):
                R, P = poses[f]
                # Where each joint would be if the chain kept its rest shape relative to its
                # attachment bone, turned only part of the way with it ("hang" keeps the rest of
                # the way in world space, as a sheet hanging under its own weight does).
                parent = sk[bones[0]].parent
                Rp, Pp = R[parent], P[parent]
                base = sk[parent]
                root = Pp + Rp @ (base.frame.T @ (root_rest - base.head))
                turn = Rp @ base.frame.T
                if hang > 0:
                    turn = slerp_matrix(turn, np.eye(3), hang)
                return [root + turn @ (sk[b].tail - root_rest) for b in bones], root

            tgt0, _ = targets(0)
            x = [t.copy() for t in tgt0]
            v = [np.zeros(3) for _ in bones]
            frames = list(range(n)) * (cycles if result["loop"] else 1)
            if not result["loop"]:
                frames = [0] * 30 + frames
            history = []
            for step, f in enumerate(frames):
                tgt, root = targets(f)
                for _ in range(sub):
                    for i in range(len(bones)):
                        acc = stiff * (tgt[i] - x[i]) - damp * v[i] + np.array([0.0, -grav, 0.0])
                        v[i] = v[i] + acc * h
                        x[i] = x[i] + v[i] * h
                    # Length constraints from the attachment down, then colliders and the floor.
                    prev = root
                    for i in range(len(bones)):
                        for c in colliders:
                            x[i] = c.push(x[i], poses[f])
                        x[i][1] = max(x[i][1], floor + chain.get("clearance", 0.0))
                        x[i] = prev + normalize(x[i] - prev) * rest_len[i]
                        prev = x[i]
                history.append((f, [p.copy() for p in x]))
            keep = history[-n:]
            for f, pts in keep:
                R, P = poses[f]
                for i, b in enumerate(bones):
                    bone = sk[b]
                    parent = sk[bone.parent]
                    follow = R[bone.parent] @ parent.frame.T @ bone.frame
                    head = P[b] if i == 0 else pts[i - 1]
                    rest_dir = follow @ (bone.frame.T @ (bone.tail - bone.head))
                    R[b] = min_arc(rest_dir, pts[i] - head) @ follow
                    if i + 1 < len(bones):
                        P[bones[i + 1]] = pts[i]
                result["L"][f] = to_local(sk, R)
        return result


class CapsuleCollider:
    """A capsule along a bone (head to tail) with a radius, pushing chain joints out."""

    def __init__(self, skeleton, bone, radius):
        self.sk, self.bone, self.radius = skeleton, bone, radius
        b = skeleton[bone]
        self.local_a = np.zeros(3)
        self.local_b = b.frame.T @ (b.tail - b.head)

    def push(self, p, pose):
        R, P = pose
        a = P[self.bone]
        b = a + R[self.bone] @ self.local_b
        ab = b - a
        t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-12), 0, 1)
        c = a + t * ab
        d = p - c
        dist = np.linalg.norm(d)
        if dist < self.radius:
            return c + normalize(d if dist > 1e-9 else np.array([0, 0, -1.0])) * self.radius
        return p


def clip_tracks(skeleton, result):
    """Per-bone local rotation quaternions (xyzw) and the hips translation, parent-relative."""
    sk = skeleton
    tracks = {}
    for b in sk.bones:
        qs = continuous_quats([quat_from_matrix(orthonormalize(L[b.name])) for L in result["L"]])
        tracks[b.name] = {"rotation": [q.tolist() for q in qs]}
    return tracks


def deform(skeleton, verts, joints, weights, local_R, hips, hips_pos):
    """Linear-blend-skinned vertex positions for one frame (bind pose == rest)."""
    R, P = forward(skeleton, local_R, hips, hips_pos)
    names = skeleton.names()
    A = np.array([R[n] @ skeleton[n].frame.T for n in names])
    t = np.array([P[n] - A[i] @ skeleton[n].head for i, n in enumerate(names)])
    out = np.zeros_like(verts)
    for k in range(joints.shape[1]):
        j = joints[:, k]
        out += weights[:, k:k + 1] * (np.einsum("nij,nj->ni", A[j], verts) + t[j])
    return out


def lying_lift(skeleton, verts, joints, weights, result, hips, height):
    """A body thicker or longer-waisted than the donor's goes through the floor when it falls and
    lies down. Only for clips whose hips drop to the floor (deaths, knock-downs): lift the hips by a
    smooth envelope of the penetration (a sliding max, then a sliding mean of the same span, so it
    never undercuts and never steps). Standing clips are never touched; their feet are solved by
    the leg IK instead."""
    rest_y = skeleton[hips].head[1]
    hips_y = np.array([p[1] for p in result["pelvis"]])
    if (rest_y - hips_y).max() < 0.5 * rest_y:
        return 0.0
    min_y = np.array([deform(skeleton, verts, joints, weights, result["L"][f], hips, result["pelvis"][f])[:, 1].min() for f in range(result["n"])])
    need = np.maximum(-min_y, 0.0)
    need[need < 0.003 * height] = 0.0
    if not need.any():
        return 0.0
    span = 9
    padded = np.pad(need, span, mode="edge")
    envelope = np.array([padded[i:i + 2 * span + 1].max() for i in range(len(need))])
    padded = np.pad(envelope, span // 2, mode="edge")
    lift = np.array([padded[i:i + span].mean() for i in range(len(need))])
    lift = np.maximum(lift, need)
    result["pelvis"] = [p + np.array([0.0, l, 0.0]) for p, l in zip(result["pelvis"], lift)]
    return float(lift[-1])
