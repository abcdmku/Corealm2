/** North-up view of the right-handed game world: +Z is up and +X is left. */
export function worldToMap(x: number, z: number): { u: number; v: number } { return { u: -x, v: -z }; }
export function mapToWorld(u: number, v: number): { x: number; z: number } { return { x: -u, z: -v }; }
/** World facing is atan2(dx, dz); map rotation is clockwise from screen up. */
export const mapFacing = (facingRad: number): number => -facingRad;
