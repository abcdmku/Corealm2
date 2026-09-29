"""Small numpy rotation helpers. Quaternions are (x, y, z, w) like glTF; matrices are 3x3 with the
bone axes as columns (world = R @ local)."""
import numpy as np

# Blender imports glTF (x, y, z) as (x, -z, y). These convert between the two frames.
GLTF_FROM_BLENDER = np.array([[1.0, 0, 0], [0, 0, 1.0], [0, -1.0, 0]])
BLENDER_FROM_GLTF = GLTF_FROM_BLENDER.T


def to_blender(p):
    return BLENDER_FROM_GLTF @ np.asarray(p, float)


def to_gltf(p):
    return GLTF_FROM_BLENDER @ np.asarray(p, float)


def normalize(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def quat_from_matrix(m):
    m = np.asarray(m, float)
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q)
    return q / np.linalg.norm(q)


def matrix_from_quat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def orthonormalize(m):
    u, _, vt = np.linalg.svd(np.asarray(m, float))
    r = u @ vt
    if np.linalg.det(r) < 0:
        u[:, -1] *= -1
        r = u @ vt
    return r


def axis_angle(axis, angle):
    axis = normalize(axis)
    x, y, z = axis
    c, s = np.cos(angle), np.sin(angle)
    C = 1 - c
    return np.array([
        [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
        [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
        [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
    ])


def min_arc(a, b):
    """Rotation matrix taking direction a onto direction b by the shortest arc."""
    a, b = normalize(a), normalize(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -0.999999:
        axis = np.cross(a, [1.0, 0, 0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0, 1.0, 0])
        return axis_angle(axis, np.pi)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def slerp_matrix(a, b, t):
    """Rotation t of the way from a to b."""
    rel = a.T @ b
    q = quat_from_matrix(rel)
    if q[3] < 0:
        q = -q
    angle = 2 * np.arccos(np.clip(q[3], -1, 1))
    if angle < 1e-9:
        return a.copy()
    axis = q[:3] / np.sin(angle / 2)
    return a @ axis_angle(axis, angle * t)


def rotation_angle(m):
    return float(np.arccos(np.clip((np.trace(m) - 1) / 2, -1, 1)))


def continuous_quats(quats):
    """Flip signs so consecutive quaternions stay in one hemisphere (clean LINEAR interpolation)."""
    out = [np.asarray(quats[0], float)]
    for q in quats[1:]:
        q = np.asarray(q, float)
        out.append(-q if np.dot(q, out[-1]) < 0 else q)
    return out
