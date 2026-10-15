import { cylinderProject } from './cylinder';
import { TORUS_RADIUS, TUBE_RADIUS, type Vec3 } from './torus';
export type ViewCamera = { yaw: number; pitch: number };
export function normalizeCamera(yaw: number, pitch: number): ViewCamera {
  return {
    yaw: ((((yaw + 180) % 360) + 360) % 360) - 180,
    pitch: Math.max(-85, Math.min(85, pitch)),
  };
}
export function projectView(point: Vec3, camera: ViewCamera): [number, number] {
  const v = cylinderProject(...point, camera.yaw, camera.pitch);
  return [v[0], -v[1]];
}
// Orthogonal rotations preserve this enclosing sphere. Framing remains fixed while grabbing.
export function viewScale(width: number, height: number) {
  return Math.max(
    1,
    Math.min(width - 36, height - 80) / (2 * (TORUS_RADIUS + TUBE_RADIUS)),
  );
}
