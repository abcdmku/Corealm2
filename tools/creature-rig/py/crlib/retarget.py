"""Rest-relative retargeting of donor clips onto a fitted skeleton.

Per bone and frame, in world space:
  follow = 1 (limbs): the target bone takes the donor bone's world orientation. Because the target
    rest frame is the donor rest frame turned onto the target bone, this first swings the target
    from its own rest (T-pose, A-pose, hunched) into the donor's rest and then applies the donor's
    motion, i.e. the rest poses are matched before transfer and bone roll carries over.
  follow = 0 (torso, head, clavicles): the donor's rotation away from its rest is applied on top
    of the target's own rest, so a hunched back stays hunched.
Only the hips translate: by the donor's hip offset scaled by the leg-length ratio ("legs"), by its
vertical part only ("vertical": serpents, hovering bodies that must not sway), or by the offset of
the donor's moving root ("root": flyers whose donor bobs the root). Ground gaits get N-segment
leg IK towards the donor's scaled effector path, which keeps planted feet planted while every
joint but the pivot keeps its donor angle.
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


def two_bone_ik(hip, knee_fk, goal, l1, l2, bend=None):
    """Knee position reaching goal, bending in the plane the FK knee bends in, or towards bend (a
    world direction) when given."""
    d_vec = goal - hip
    d = np.linalg.norm(d_vec)
    d = np.clip(d, abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
    u = normalize(d_vec)
    goal = hip + u * d
    pole = (knee_fk - hip) if bend is None else np.asarray(bend, float)
    pole = pole - np.dot(pole, u) * u
    if np.linalg.norm(pole) < 1e-6:
        pole = np.array([0.0, 0.0, 1.0]) - np.dot([0, 0, 1.0], u) * u
    pole = normalize(pole)
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = np.sqrt(max(l1 * l1 - a * a, 0.0))
    return hip + u * a + pole * h, goal


def chain_ik(joints, goal, pivots, bend=None):
    """N-segment leg IK that keeps the FK (donor) pose as its prior.

    joints are the FK positions [hip, knee..., effector]. For each pivot joint k in turn, the part
    of the chain above k and the part below k act as two rigid bones and are solved as two-bone IK
    in the plane the chain already bends in; every other joint keeps its donor angle. The first
    pivot usually reaches the goal. When it cannot (the leg would have to straighten or fold past
    its reach), the next pivot takes the rest. bend (a world direction) replaces the FK plane for
    the first pivot: a joint that must always bend one way (a bird's heel points back). Returns
    the swings [(k, upper, lower, reached)] to apply to the bones above and below each pivot, and
    the solved joints."""
    J = [np.asarray(j, float) for j in joints]
    n = len(J) - 1
    swings = []
    for k in pivots:
        l1 = np.linalg.norm(J[k] - J[0])
        l2 = np.linalg.norm(J[n] - J[k])
        knee, reach = two_bone_ik(J[0], J[k], goal, l1, l2, bend if k == pivots[0] else None)
        upper = min_arc(J[k] - J[0], knee - J[0])
        J = [J[0] + upper @ (j - J[0]) for j in J]
        lower = min_arc(J[n] - J[k], reach - J[k])
        J = J[:k + 1] + [J[k] + lower @ (j - J[k]) for j in J[k + 1:]]
        swings.append((k, upper, lower, reach))
        if np.linalg.norm(reach - goal) < 1e-6:
            break
    return swings, J


def _pitch_to(offset, axis, target_dy, exact, prev=0.0):
    """Angle about axis (the bone's lateral axis) that brings the offset's height to target_dy:
    exactly when the donor foot is in contact, otherwise only up to it (no sinking). prev is the
    angle this joint took on the previous frame: a hanging foot can often be lifted by pitching
    either way, and without memory the choice flips between frames; a released contact eases
    back towards the donor's angle instead of snapping to it."""
    angles = np.radians(np.arange(-120, 120.5, 0.5))
    ys = np.array([(axis_angle(axis, a) @ offset)[1] for a in angles])
    if exact:
        cost = np.abs(ys - target_dy) + 0.02 * np.abs(angles) + 0.05 * np.abs(angles - prev)
    else:
        cost = np.where(ys >= target_dy - 1e-4, np.abs(angles - 0.6 * prev), np.inf)
        if not np.isfinite(cost).any():
            cost = -ys + 0.05 * np.abs(angles - prev)
    return float(angles[int(np.argmin(cost))])


HIP_MODES = ("legs", "vertical", "root")


def normalize_leg(leg):
    """A plan leg: {"chain": [bone, ...], "foot": bone|None, "toe": bone|None, "pivot": k|None,
    "scale": s|None}. The chain bones are the segments the IK bends (hip to ankle); the effector
    is the foot's head, or the last chain bone's tail when there is no foot (a spider's leg tip).
    scale multiplies the size ratio for this chain's effector path (a neck solved like a leg that
    must not bury the beak). bend is a bind-space direction the first pivot always bends towards,
    carried by the bone the chain hangs from. The tuple form (upper, lower, foot[, toe]) is a two-bone chain."""
    if isinstance(leg, dict):
        return {"chain": list(leg["chain"]), "foot": leg.get("foot"), "toe": leg.get("toe"), "pivot": leg.get("pivot"),
                "scale": float(leg.get("scale") or 1.0), "bend": leg.get("bend")}
    return {"chain": list(leg[:2]), "foot": leg[2], "toe": leg[3] if len(leg) > 3 else None, "pivot": None, "scale": 1.0}


def skin_points(skeleton, R, P, verts, joints, weights):
    """Linear-blend-skinned positions of a few bind vertices for a pose given as world rotations
    and heads (bind pose == rest)."""
    names = skeleton.names()
    A = np.array([R[n] @ skeleton[n].frame.T for n in names])
    t = np.array([P[n] - A[i] @ skeleton[n].head for i, n in enumerate(names)])
    out = np.zeros_like(verts)
    for k in range(joints.shape[1]):
        j = joints[:, k]
        out += weights[:, k:k + 1] * (np.einsum("nij,nj->ni", A[j], verts) + t[j])
    return out


def sole_points(skeleton, leg, verts, joints, weights, share=0.3, limit=400):
    """The bind vertices under a leg's foot: skinned at least share to the foot and toe bones (the
    last chain bone for a leg without a foot), in the lowest band of that region."""
    names = skeleton.names()
    bones = [b for b in (leg["foot"], leg["toe"]) if b] or [leg["chain"][-1]]
    cols = [names.index(b) for b in bones]
    own = (weights * np.isin(joints, cols)).sum(1)
    sel = np.nonzero(own >= share)[0]
    if not len(sel):
        return None
    ankle = skeleton[leg["foot"]].head[1] if leg["foot"] else skeleton[leg["chain"][-1]].tail[1]
    low = verts[sel, 1].min()
    height = max(b.head[1] for b in skeleton.bones) - low
    band = max(0.5 * (ankle - low), 0.02 * height)
    sel = sel[verts[sel, 1] <= low + band]
    if len(sel) > limit:
        sel = sel[np.argsort(verts[sel, 1])[:limit]]
    return verts[sel], joints[sel], weights[sel]


class Retargeter:
    def __init__(self, skeleton, donor, plan, bone_map=None, primary=True, skin=None):
        """skin: (bind vertices, joints, weights) of the skinned mesh. With it the leg IK keeps the
        lowest points of each sole, not only the ball and toe joints, on or above the floor."""
        from .skeleton import Binding

        self.sk = skeleton
        self.donor = donor
        self.plan = plan
        self.hips = plan["hips"]
        self.bind = Binding(skeleton, donor, bone_map, primary=primary)
        sk, d, bind = skeleton, donor, self.bind
        self.legs = []
        self.skipped_legs = []
        for leg in map(normalize_leg, plan.get("legs", [])):
            bones = leg["chain"] + [b for b in (leg["foot"], leg["toe"]) if b]
            if any(bind.bone[b] is None for b in bones):
                self.skipped_legs.append(leg["chain"][0])
                continue
            leg["target_rest"] = self._joints_rest(leg)
            leg["donor_rest"] = self._donor_joints(leg, None)
            if leg["pivot"] is not None:
                leg["pivots"] = [leg["pivot"]]
            else:
                # The donor's most bent joint is the knee that absorbs the proportion difference;
                # the others follow in order of bend when it alone cannot reach.
                Jd = leg["donor_rest"]
                bend = [np.arccos(np.clip(np.dot(normalize(Jd[i] - Jd[i - 1]), normalize(Jd[i + 1] - Jd[i])), -1, 1))
                        for i in range(1, len(Jd) - 1)]
                leg["pivots"] = [int(i) + 1 for i in np.argsort(bend, kind="stable")[::-1]]
            leg["sole"] = sole_points(sk, leg, *skin) if skin is not None else None
            self.legs.append(leg)
        # Size ratio for the hips and the leg effectors: target hip-to-effector length over the
        # donor's (rest), or the hips height when no leg is driven; a plan may fix it.
        if plan.get("scale") is not None:
            self.scale = float(plan["scale"])
        elif self.legs:
            t_len = np.mean([sum(np.linalg.norm(J[i + 1] - J[i]) for i in range(len(J) - 1)) for J in (leg["target_rest"] for leg in self.legs)])
            d_len = np.mean([sum(np.linalg.norm(J[i + 1] - J[i]) for i in range(len(J) - 1)) for J in (leg["donor_rest"] for leg in self.legs)])
            self.scale = t_len / d_len
        else:
            t_len = sk[self.hips].head[1]
            d_len = d.rest_head[bind.bone[self.hips]][1]
            if plan.get("hover"):
                # A hovering donor's hips height includes its clearance; the grounded bind's does not.
                d_len -= max(self.rest_clearance(), 0.0)
            self.scale = t_len / d_len

    def rest_clearance(self):
        """The donor's rest height above its ground: its lowest joint at rest (a flyer hovers)."""
        d = self.donor
        return float(min(min(p[1] for p in d.rest_head.values()), min(p[1] for p in d.rest_tail.values())))

    # ------------------------------------------------------------------ legs
    def _joints_rest(self, leg):
        sk = self.sk
        J = [sk[b].head for b in leg["chain"]]
        J.append(sk[leg["foot"]].head if leg["foot"] else sk[leg["chain"][-1]].tail)
        return J

    def _donor_joints(self, leg, f, clip=None):
        """Donor joint positions of a leg at clip frame f (rest when f is None)."""
        d, bind = self.donor, self.bind
        names = [bind.bone[b] for b in leg["chain"]]
        if f is None:
            J = [d.rest_head[n] for n in names]
            J.append(d.rest_head[bind.bone[leg["foot"]]] if leg["foot"] else d.rest_tail[names[-1]])
            return J
        heads = clip["heads"][f]
        J = [heads[d.index(n)] for n in names]
        if leg["foot"]:
            J.append(heads[d.index(bind.bone[leg["foot"]])])
        else:
            last = names[-1]
            W = clip["frames"][f][d.index(last)]
            J.append(J[-1] + W @ d.rest_frame[last].T @ (d.rest_tail[last] - d.rest_head[last]))
        return J

    def _hip_source(self, clip):
        """The donor bone whose translation drives the hips in "root" mode: the plan's hip_source,
        else the highest bone in the hierarchy that moves in this clip."""
        d = self.donor
        if self.plan.get("hip_source"):
            return self.plan["hip_source"]
        heads = clip["heads"]
        span = max(np.ptp(np.array(list(d.rest_head.values()))[:, 1]), 1e-9)
        for i, b in enumerate(d.bones):
            if np.ptp(heads[:, i], axis=0).max() > 1e-5 * span:
                return b
        return self.bind.bone[self.hips]

    # ------------------------------------------------------------------ core
    def _world_targets(self, clip, f):
        sk, d, bind = self.sk, self.donor, self.bind
        frames = d.clips[clip]["frames"][f]
        T = {}
        for b in sk.bones:
            name = bind.bone[b.name]
            if name:
                W = frames[d.index(name)]
                D = d.rest_frame[name]
                delta = W @ D.T @ b.frame
                if b.follow > 0 and bind.fix[b.name] is not None:
                    W = W @ bind.fix[b.name]
                T[b.name] = delta if b.follow <= 0 else (W if b.follow >= 1 else slerp_matrix(delta, W, b.follow))
            elif b.parent is None:
                T[b.name] = b.frame
            else:
                parent = sk[b.parent]
                T[b.name] = T[b.parent] @ parent.frame.T @ b.frame
        return T

    def sample(self, name, spec):
        sk, d, bind = self.sk, self.donor, self.bind
        clip = d.clips[spec["clip"]]
        n = len(clip["frames"])
        mode = spec.get("hipMode", self.plan.get("hip_mode", "legs"))
        if mode not in HIP_MODES:
            raise ValueError(f"hip mode {mode} is not one of {HIP_MODES}")
        source = self._hip_source(clip) if mode == "root" else bind.bone[self.hips]
        if source is None:
            hips_path = np.zeros((n, 3))
        else:
            hips_path = clip["heads"][:, d.index(source)] - d.rest_head[source]
        # Hover: the vertical offset also carries the donor's rest clearance above its ground (a
        # flyer's rest hovers) times the size ratio, or a fixed clearance in metres.
        hover = spec.get("hover", self.plan.get("hover"))
        if hover is True:
            clearance = self.scale * max(self.rest_clearance(), 0.0)
        else:
            clearance = float(hover or 0.0)
        # The clearance fades with the donor's hips height over its rest height, so a donor that
        # falls to its ground (Death) lands the body on the floor even with a fixed clearance.
        landing = np.ones(n)
        if clearance > 0 and source is not None and d.rest_head[source][1] > 1e-6:
            landing = np.clip(clip["heads"][:, d.index(source), 1] / d.rest_head[source][1], 0.0, 1.0)
        drift = np.zeros((n, 3))
        if spec.get("loop") or spec.get("in_place", True):
            # In place: remove the net horizontal travel (keep sway and bob).
            travel = hips_path[-1] - hips_path[0] if spec.get("loop") else np.zeros(3)
            drift[:, [0, 2]] = np.outer(np.linspace(0, 1, n), travel[[0, 2]])
            if not spec.get("loop"):
                drift[:, [0, 2]] = 0.0
        # Per-clip energy: hipMotion scales this clip's hip translation on top of the plan's.
        hip_motion = self.plan.get("hip_motion", 1.0) * spec.get("hipMotion", 1.0)
        self.ik_miss = 0.0
        self.sole_lift = 0.0
        self._pitch_prev = {}
        use_ik = spec.get("ik", True) and bool(self.legs)
        # A loop's first frame continues from its last: one silent pass warms the pitch memory.
        frames = ([f for f in range(n)] if not (use_ik and spec.get("loop")) else list(range(n)) * 2)
        out_R, out_T = [], []
        for pass_index, f in enumerate(frames):
            if pass_index == n and len(frames) > n:
                out_R, out_T = [], []
                self.ik_miss = self.sole_lift = 0.0
            T = self._world_targets(spec["clip"], f)
            L = to_local(sk, T)
            offset = self.scale * hip_motion * (hips_path[f] - drift[f])
            if mode == "vertical":
                offset = np.array([0.0, offset[1], 0.0])
            offset[1] += clearance * landing[f]
            if spec.get("pelvisLift") is not None:
                # A lying clip re-solved with its penetration lift (rig.py, profile lyingLegIk): the
                # legs reach from the lifted hips towards the floor instead of floating with them.
                offset[1] += spec["pelvisLift"][f]
            pelvis = sk[self.hips].head + offset
            R, P = forward(sk, L, self.hips, pelvis)
            if use_ik:
                R = self._solve_legs(clip, f, R, P, drift[f], pelvis)
                L = to_local(sk, R)
            out_R.append(L)
            out_T.append(pelvis)
        # Playback speed is a time-scale on the baked clip: the same frames at speed x the rate.
        fps = clip["fps"] * float(spec.get("speed", 1.0))
        # The ground velocity the in-place removal took out of a loop: the body still travels
        # that fast in the game, and spring chains with drag trail behind it.
        travel = np.zeros(3)
        if spec.get("loop") and n > 1:
            travel = self.scale * hip_motion * (drift[-1] - drift[0]) * fps / (n - 1)
        return {"n": n, "fps": fps, "L": out_R, "pelvis": out_T, "loop": bool(spec.get("loop")), "travel": travel,
                "hipMode": mode, "hipSource": source, "ikMiss": self.ik_miss, "soleLift": self.sole_lift,
                "hover": clearance}

    def _solve_legs(self, clip, f, R_fk, P, drift, pelvis, floor=0.0, passes=8):
        """Leg IK for every leg, then sole contact: when a sole's lowest skinned point is below the
        floor (a heel at heel strike, a toe at toe-off), that foot rises rigidly (same orientation,
        IK goal lifted) until the point is on the floor. A sole point partly weighted to the shin
        rises less than the goal, so each leg's lift is a bracketed root search (secant inside the
        bracket), and the lowest lift that clears the floor wins."""
        sk = self.sk
        n_legs = len(self.legs)
        tol = 1e-3 * max(sk[self.hips].head[1], 1e-6)
        soles = [i for i, leg in enumerate(self.legs) if leg["sole"] is not None]
        lifts = [0.0] * n_legs
        keep = [None] * n_legs
        lo = [(0.0, None)] * n_legs          # (lift, height of the lowest sole point) below the floor
        hi = [None] * n_legs                 # the lowest lift found that clears the floor
        settled = [i not in soles for i in range(n_legs)]

        def solve(lift_values):
            R = dict(R_fk)
            for i, leg in enumerate(self.legs):
                kept = self._solve_leg(leg, clip, f, R, P, drift, lift=lift_values[i], keep=keep[i])
                keep[i] = keep[i] or kept
            return R

        for _ in range(passes):
            R = solve(lifts)
            if all(settled):
                break
            R2, P2 = forward(sk, to_local(sk, R), self.hips, pelvis)
            for i in soles:
                if settled[i]:
                    continue
                g = skin_points(sk, R2, P2, *self.legs[i]["sole"])[:, 1].min() - floor
                if g >= -tol:
                    if hi[i] is None or lifts[i] < hi[i][0]:
                        hi[i] = (lifts[i], g)
                    if g <= 2 * tol or lifts[i] == 0.0:
                        settled[i] = True
                        continue
                else:
                    lo[i] = (lifts[i], g)
                (l0, g0), top = lo[i], hi[i]
                if top is None:
                    # No lift clears the floor yet: raise by the penetration (more once a raise
                    # has shown the point rises slower than the goal).
                    lifts[i] = l0 + (1.5 if l0 > 0 else 1.0) * (-g0)
                else:
                    l1, g1 = top
                    t = (-g0) / max(g1 - g0, 1e-9) if g0 is not None else 0.5
                    lifts[i] = l0 + float(np.clip(t, 0.1, 0.9)) * (l1 - l0)
        final = [hi[i][0] if (i in soles and not settled[i] and hi[i] is not None) else lifts[i] for i in range(n_legs)]
        if final != lifts:
            R = solve(final)
        self.sole_lift = max(self.sole_lift, max(final))
        return R

    def _pitch(self, slot, offset, axis, target_dy, exact):
        prev = self._pitch_prev.get(slot, 0.0)
        a = _pitch_to(offset, axis, target_dy, exact, prev)
        self._pitch_prev[slot] = a
        return axis_angle(axis, a)

    def _heel_clamp(self, foot, toe, ankle, R):
        """A heel far behind the ankle is levered into the floor by a toe-up foot (heel strike).
        When the class records sk.heels, the foot and toes pitch back just enough to keep that
        heel at or above its bind height."""
        sk = self.sk
        heel = getattr(sk, "heels", {}).get(foot)
        if heel is None or sk[foot].head[2] - heel[2] < 0.5 * sk[foot].head[1]:
            return
        off = R[foot] @ (sk[foot].frame.T @ (heel - sk[foot].head))
        if ankle[1] + off[1] >= heel[1] - 1e-4:
            return
        lateral = R[foot] @ (sk[foot].frame.T @ np.array([1.0, 0.0, 0.0]))
        angles = np.radians(np.arange(-60, 60.25, 0.25))
        ys = np.array([(axis_angle(lateral, a) @ off)[1] for a in angles])
        ok = ankle[1] + ys >= heel[1] - 1e-4
        if not ok.any():
            return
        turn = axis_angle(lateral, angles[ok][int(np.argmin(np.abs(angles[ok])))])
        R[foot] = turn @ R[foot]
        if toe:
            R[toe] = turn @ R[toe]

    def _solve_leg(self, leg, clip, f, R, P, drift, lift=0.0, keep=None):
        """Chain IK towards the donor's scaled effector path, then foot and toe pitch for contact.
        lift raises the goal; keep (the foot and toe world rotations of the unlifted solve) then
        holds the foot's orientation so it rises rigidly. Returns the foot and toe rotations."""
        sk, d, bind = self.sk, self.donor, self.bind
        chain, foot, toe = leg["chain"], leg["foot"], leg["toe"]
        donor_now = self._donor_joints(leg, f, clip)[-1]
        scale = self.scale * leg["scale"]
        goal = leg["target_rest"][-1] + scale * (donor_now - leg["donor_rest"][-1] - drift)
        goal = goal + np.array([0.0, lift, 0.0])
        J = [P[b] for b in chain]
        last = sk[chain[-1]]
        J.append(P[foot] if foot else P[chain[-1]] + R[chain[-1]] @ (last.frame.T @ (last.tail - last.head)))
        bend = None
        if leg.get("bend") is not None:
            # A fixed bend direction in bind space, carried by the bone the chain hangs from.
            base = sk[chain[0]].parent
            bend = R[base] @ (sk[base].frame.T @ np.asarray(leg["bend"], float)) if base else np.asarray(leg["bend"], float)
        swings, _ = chain_ik(J, goal, leg["pivots"], bend)
        if swings:
            # How far the effector stays from the donor's path, as a share of the leg's length: a
            # donor that translates its hip joints (a stretching run) can ask for more reach than
            # rigid bones have.
            length = sum(np.linalg.norm(leg["target_rest"][i + 1] - leg["target_rest"][i]) for i in range(len(chain)))
            self.ik_miss = max(self.ik_miss, float(np.linalg.norm(swings[-1][3] - goal) / length))
        for k, upper, lower, _ in swings:
            for b in chain:
                R[b] = upper @ R[b]
            for b in chain[k:]:
                R[b] = lower @ R[b]
        if keep is not None:
            for b, rot in zip((foot, toe), keep):
                if b and rot is not None:
                    R[b] = rot
            return keep
        if not (foot and swings):
            return None
        if not toe:
            return (R[foot], None)
        # The foot keeps its donor world orientation (the ankle absorbs the change). It and the
        # toes pitch so the ball and the toe tip follow the donor's scaled heights: a heel-off
        # rolls over the ball instead of pushing it into the floor. This is exact while the donor
        # foot is in contact and otherwise only stops the foot sinking.
        goal = swings[-1][3]
        heads = clip["heads"][f]
        toe_d = bind.bone[toe]
        ball_d = heads[d.index(toe_d)]
        lift = ball_d[1] - d.rest_head[toe_d][1]
        contact = lift < 0.01
        lateral = R[foot] @ (sk[foot].frame.T @ np.array([1.0, 0.0, 0.0]))
        offset = R[foot] @ (sk[foot].frame.T @ (sk[toe].head - sk[foot].head))
        swing = self._pitch((chain[0], 0), offset, lateral, sk[toe].head[1] + scale * max(lift, 0.0) - goal[1], contact)
        R[foot] = swing @ R[foot]
        R[toe] = swing @ R[toe]
        ball = goal + R[foot] @ (sk[foot].frame.T @ (sk[toe].head - sk[foot].head))
        W_toe = clip["frames"][f][d.index(toe_d)]
        tip_d = ball_d + W_toe @ d.rest_frame[toe_d].T @ (d.rest_tail[toe_d] - d.rest_head[toe_d])
        tip_lift = tip_d[1] - d.rest_tail[toe_d][1]
        lateral = R[toe] @ (sk[toe].frame.T @ np.array([1.0, 0.0, 0.0]))
        offset = R[toe] @ (sk[toe].frame.T @ (sk[toe].tail - sk[toe].head))
        R[toe] = self._pitch((chain[0], 1), offset, lateral, sk[toe].tail[1] + scale * max(tip_lift, 0.0) - ball[1], tip_lift < 0.01) @ R[toe]
        self._heel_clamp(foot, toe, goal, R)
        return (R[foot], R[toe])

    # ------------------------------------------------------------- secondary
    def secondary(self, result, chains, colliders, floor=0.0, cycles=3):
        """Damped spring chains (Verlet with length constraints) for bones with no donor. Chains of
        one sheet (a cape's left and right columns) are simulated together and kept at their rest
        spacing, so the sheet cannot tear down the middle. Loops run several cycles and keep the
        last one, so the motion is periodic; one-shots settle on their first frame first.

        Optional chain keys (without them the chain is the plain spring chain):
          falloff     stiffness drops along the chain to (1 - falloff) at the tip, so a hem swings
                      more freely than the part sewn to the body.
          drag        air drag (1/s) against the clip's own travel (result["travel"], the ground
                      velocity a loop's in-place removal took away), so cloth trails behind a
                      moving body. The chain's damping stays relative to the body.
          interpolate targets and colliders move smoothly between frames inside the substeps
                      instead of stepping once per frame.
          iterations  constraint passes per substep (links, colliders, floor, lengths); default 2.
          links       "all" (every pair of chains in a group; the default) or "ring" (each chain
                      to its neighbours in list order, closing the loop: a skirt round the legs).
          linkStretch how far linked joints may part or close, a share of their rest spacing.
          width       the sheet's half-width round its column (along "lateral", default +X at
                      bind): colliders test that cross-line, so the sheet's edges clear the legs.
          sided       a joint the moving collider overtakes goes back out on the side it was on
                      (in the collider bone's frame), not the nearest way out.
          substeps, cycles (loop passes), preroll (frames a one-shot settles on its first frame).
        The largest value over the chains applies for the shared ones (substeps, iterations,
        interpolate, cycles, preroll)."""
        sk = self.sk
        n = result["n"]
        dt = 1.0 / result["fps"]
        opt = lambda key, default: max((c.get(key, default) for c in chains), default=default)
        sub = int(opt("substeps", 4))
        h = dt / sub
        iterations = int(opt("iterations", 2))
        interpolate = bool(opt("interpolate", False))
        cycles = int(opt("cycles", cycles))
        preroll = int(opt("preroll", 30))
        travel = np.asarray(result.get("travel", np.zeros(3)), float)
        poses = [forward(sk, dict(result["L"][f]), self.hips, result["pelvis"][f]) for f in range(n)]

        def targets(chain, f):
            # Where each joint would be if the chain kept its rest shape relative to its attachment
            # bone, turned only part of the way with it ("hang" keeps the rest of the way in world
            # space, as a sheet hanging under its own weight does). Also the sheet's lateral axis
            # (its bind "lateral", default +X) turned the same way.
            R, P = poses[f]
            bones = chain["bones"]
            parent = sk[bones[0]].parent
            base = sk[parent]
            root_rest = sk[bones[0]].head
            root = P[parent] + R[parent] @ (base.frame.T @ (root_rest - base.head))
            turn = R[parent] @ base.frame.T
            if chain.get("hang", 0.0) > 0:
                turn = slerp_matrix(turn, np.eye(3), chain["hang"])
            lateral = turn @ np.asarray(chain.get("lateral", (1.0, 0.0, 0.0)), float)
            return np.array([root + turn @ (sk[b].tail - root_rest) for b in bones]), root, lateral

        def capsules(f):
            if not colliders:
                return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0), np.zeros((0, 3, 3))
            ends = [c.ends(poses[f]) for c in colliders]
            turns = [poses[f][0][c.bone] for c in colliders]
            return (np.array([e[0] for e in ends]), np.array([e[1] for e in ends]),
                    np.array([c.radius for c in colliders]), np.array(turns))

        def depth(p, lateral, width, a, b, r):
            # Per joint: how deep the sheet's cross-line (width either side of the joint along the
            # lateral axis) reaches into the capsule, and the way out from its deepest point.
            offs = np.linspace(-width, width, 5) if width > 0 else np.zeros(1)
            Q = p[:, None, :] + offs[None, :, None] * lateral[None, None, :]
            ab = b - a
            t = np.clip((Q - a) @ ab / max(ab @ ab, 1e-12), 0, 1)
            D = Q - (a + t[..., None] * ab)
            pen = r - np.linalg.norm(D, axis=2)
            k = np.argmax(pen, axis=1)
            rows = np.arange(len(p))
            return pen[rows, k], D[rows, k]

        def collide(p, caps, lateral, width=0.0, side=None):
            # Every joint through every capsule in order: the same as pushing the joints through
            # the colliders one at a time. width: the sheet's half-width round its column, so its
            # edges clear the legs, not only its middle line. side (per joint and capsule, in the
            # capsule bone's frame) is where the joint last was clear of it: a joint the moving
            # bone overtook goes back out on that side (a tabard in front of a striding thigh is
            # carried forward, not left behind it); without it the nearest way out is taken.
            A, B, rad, Rs = caps
            for j, (a, b, r, Rj) in enumerate(zip(A, B, rad, Rs)):
                pen, d = depth(p, lateral, width, a, b, r)
                inside = pen > 0
                if inside.any():
                    if side is not None:
                        ab = b - a
                        u = side[:, j] @ Rj.T
                        u = u - np.outer(u @ ab / max(ab @ ab, 1e-12), ab)
                        known = np.linalg.norm(u, axis=1) > 1e-6
                        d = np.where(known[:, None], u, d)
                    safe = np.where(np.linalg.norm(d, axis=1, keepdims=True) > 1e-9, d, np.array([0, 0, -1.0]))
                    safe = safe / np.maximum(np.linalg.norm(safe, axis=1, keepdims=True), 1e-12)
                    p = np.where(inside[:, None], p + safe * pen[:, None], p)
            return p

        def remember(side, p, caps, lateral, width):
            # The side of each capsule each joint is on while it is clear of it.
            A, B, rad, Rs = caps
            for j, (a, b, r, Rj) in enumerate(zip(A, B, rad, Rs)):
                pen, _ = depth(p, lateral, width, a, b, r)
                out = pen <= 1e-6
                side[out, j] = (p[out] - a) @ Rj

        state = []
        for chain in chains:
            tgt, _, lat = targets(chain, 0)
            m = len(chain["bones"])
            fall = chain.get("falloff", 0.0) * np.arange(m) / max(m - 1, 1)
            side = None
            if chain.get("sided") and colliders:
                side = np.zeros((m, len(colliders), 3))
                remember(side, tgt, capsules(0), lat, chain.get("width", 0.0))
            state.append({"x": tgt.copy(), "prev": tgt.copy(), "fall": 1.0 - fall, "side": side,
                          "len": [np.linalg.norm(sk[b].tail - sk[b].head) for b in chain["bones"]]})
        links = []
        groups = {}
        for a, c in enumerate(chains):
            if c.get("group"):
                groups.setdefault(c["group"], []).append(a)
        for members in groups.values():
            if any(chains[a].get("links") == "ring" for a in members) and len(members) > 2:
                pairs = [(members[i], members[(i + 1) % len(members)]) for i in range(len(members))]
            else:
                pairs = [(a, b) for i, a in enumerate(members) for b in members[i + 1:]]
            for a, b in pairs:
                rest = [np.linalg.norm(sk[p].tail - sk[q].tail) for p, q in zip(chains[a]["bones"], chains[b]["bones"])]
                stretch = min(chains[a].get("linkStretch", 0.15), chains[b].get("linkStretch", 0.15))
                links.append((a, b, rest, stretch))
        frames = list(range(n)) * (cycles if result["loop"] else 1)
        if not result["loop"]:
            frames = [0] * preroll + frames
        history = []
        for step, f in enumerate(frames):
            tg = [targets(c, f) for c in chains]
            caps = capsules(f)
            if interpolate:
                g = frames[step + 1] if step + 1 < len(frames) else ((f + 1) % n if result["loop"] else f)
                tg1 = [targets(c, g) for c in chains]
                caps1 = capsules(g)
            for s in range(sub):
                if interpolate:
                    w = (s + 1) / sub
                    tg_s = [((1 - w) * t0 + w * t1, (1 - w) * r0 + w * r1, normalize((1 - w) * l0 + w * l1))
                            for (t0, r0, l0), (t1, r1, l1) in zip(tg, tg1)]
                    caps_s = ((1 - w) * caps[0] + w * caps1[0], (1 - w) * caps[1] + w * caps1[1], caps[2], caps[3] if w < 0.5 else caps1[3])
                else:
                    tg_s, caps_s = tg, caps
                for c, st, (tgt, _, _) in zip(chains, state, tg_s):
                    keep = np.exp(-c.get("damping", 6.0) * h)
                    # "ease": [start, end] clip fractions over which stiffness and gravity blend
                    # from the chain's base values to this clip's (a wing that goes limp).
                    k, g = c.get("stiffness", 40.0), c.get("gravity", 0.0)
                    if c.get("ease") and n > 1:
                        a0, a1 = c["ease"]
                        u = float(np.clip((f / (n - 1) - a0) / max(a1 - a0, 1e-6), 0, 1))
                        u = u * u * (3 - 2 * u)
                        k0, g0 = c["base"].get("stiffness", 40.0), c["base"].get("gravity", 0.0)
                        k = k0 + u * (k - k0)
                        g = g0 + u * (g - g0)
                    acc = (k * st["fall"])[:, None] * (tgt - st["x"]) + np.array([0.0, -g, 0.0])
                    vel = st["x"] - st["prev"]
                    if c.get("drag"):
                        acc = acc - c["drag"] * (vel / h + travel)
                    nxt = st["x"] + vel * keep + acc * h * h
                    st["prev"], st["x"] = st["x"], nxt
                for _ in range(iterations):
                    for a, b, rest, stretch in links:
                        for i, r in enumerate(rest):
                            pa, pb = state[a]["x"][i], state[b]["x"][i]
                            d = np.linalg.norm(pb - pa)
                            want = np.clip(d, (1 - stretch) * r, (1 + stretch) * r)
                            if d > 1e-9 and want != d:
                                corr = (pb - pa) * (1 - want / d) * 0.5
                                state[a]["x"][i] = pa + corr
                                state[b]["x"][i] = pb - corr
                    for c, st, (_, root, lat) in zip(chains, state, tg_s):
                        pts = collide(st["x"], caps_s, lat, c.get("width", 0.0), st["side"])
                        pts[:, 1] = np.maximum(pts[:, 1], floor + c.get("clearance", 0.0))
                        prev = root
                        for i in range(len(pts)):
                            pts[i] = prev + normalize(pts[i] - prev) * st["len"][i]
                            prev = pts[i]
                        st["x"] = pts
                for c, st, (_, _, lat) in zip(chains, state, tg_s):
                    if st["side"] is not None:
                        remember(st["side"], st["x"], caps_s, lat, c.get("width", 0.0))
            history.append((f, [st["x"].copy() for st in state]))
        for f, all_pts in history[-n:]:
            R, P = poses[f]
            for chain, pts in zip(chains, all_pts):
                bones = chain["bones"]
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
        if result["loop"] and n > 2:
            # Close the loop exactly: spread what is left of the cycle-to-cycle difference over
            # the cycle instead of leaving a pop at the seam.
            for chain in chains:
                for b in chain["bones"]:
                    fix = result["L"][n - 1][b].T @ result["L"][0][b]
                    for f in range(n):
                        result["L"][f][b] = result["L"][f][b] @ slerp_matrix(np.eye(3), fix, f / (n - 1))
        return result


def overlay(result, layer, bones):
    """Donor layers: the listed bones take their local rotations from another donor's clip (wings
    from a flyer on a body from a walker). A looping clip repeats the layer a whole number of
    times so the seam still closes; a one-shot plays it in real time, looping it if the layer
    loops and holding its last frame otherwise."""
    n, m = result["n"], layer["n"]
    if m < 2 or not bones:
        return result
    main_len = (n - 1) / result["fps"]
    layer_len = (m - 1) / layer["fps"]
    cycles = max(1, int(round(main_len / layer_len)))
    for f in range(n):
        if result["loop"]:
            x = (((f / max(n - 1, 1)) * cycles) % 1.0 if f < n - 1 else 0.0) * (m - 1)
        else:
            t = f / result["fps"]
            x = (t % layer_len if layer["loop"] else min(t, layer_len)) * layer["fps"]
        a = min(int(np.floor(x)), m - 1)
        b = min(a + 1, m - 1)
        for bone in bones:
            result["L"][f][bone] = slerp_matrix(layer["L"][a][bone], layer["L"][b][bone], x - a)
    return result


class CapsuleCollider:
    """A capsule along a bone (head to tail) with a radius, pushing chain joints out."""

    def __init__(self, skeleton, bone, radius):
        self.sk, self.bone, self.radius = skeleton, bone, radius
        b = skeleton[bone]
        self.local_a = np.zeros(3)
        self.local_b = b.frame.T @ (b.tail - b.head)

    def ends(self, pose):
        R, P = pose
        a = P[self.bone]
        return a, a + R[self.bone] @ self.local_b

    def push(self, p, pose):
        a, b = self.ends(pose)
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


def lying_lift(skeleton, verts, joints, weights, result, hips, height, lead=None):
    """A body thicker or longer-waisted than the donor's goes through the floor when it falls and
    lies down. Only for clips whose hips drop to the floor (deaths, knock-downs): lift the hips by a
    smooth envelope of the penetration (a sliding max, then a sliding mean of the same span, so it
    never undercuts and never steps). Standing clips are never touched; their feet are solved by
    the leg IK instead."""
    rest_y = skeleton[hips].head[1]
    hips_y = np.array([p[1] for p in result["pelvis"]])
    # A low-slung body rolled onto its back (a crawler's death) keeps its hips high, yet lies:
    # its hips turn more than 120 degrees from the bind.
    def turned(f):
        R, _ = forward(skeleton, result["L"][f], hips, result["pelvis"][f])
        D = R[hips] @ skeleton[hips].frame.T
        return np.trace(D) < 0.0
    if (rest_y - hips_y).max() < 0.5 * rest_y and not any(turned(f) for f in range(result["n"])):
        return 0.0
    min_y = np.array([deform(skeleton, verts, joints, weights, result["L"][f], hips, result["pelvis"][f])[:, 1].min() for f in range(result["n"])])
    need = np.maximum(-min_y, 0.0)
    need[need < 0.003 * height] = 0.0
    if not need.any():
        return 0.0
    span = 9
    if lead is None:
        padded = np.pad(need, span, mode="edge")
        envelope = np.array([padded[i:i + 2 * span + 1].max() for i in range(len(need))])
        padded = np.pad(envelope, span // 2, mode="edge")
        lift = np.array([padded[i:i + span].mean() for i in range(len(need))])
    else:
        # lead frames of look-ahead only: the centred window starts lifting a falling body
        # up to 0.45 s before it touches the floor, so a thick body floats mid-fall. The
        # envelope looks lead frames ahead and span behind, and the smoothing only looks back.
        padded = np.pad(need, (span, lead), mode="edge")
        envelope = np.array([padded[i:i + span + lead + 1].max() for i in range(len(need))])
        padded = np.pad(envelope, (span // 2, 0), mode="edge")
        lift = np.array([padded[i:i + span // 2 + 1].mean() for i in range(len(need))])
    lift = np.maximum(lift, need)
    result["pelvis"] = [p + np.array([0.0, l, 0.0]) for p, l in zip(result["pelvis"], lift)]
    result["liftCurve"] = lift
    return float(lift[-1])
