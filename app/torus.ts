import type { Vec4 } from './geometry';

export const TORUS_RADIUS = 2.6;
export const TUBE_GAIN = 0.26;
export const TUBE_RADIUS = 0.88;
export const SEAM_HALF_ANGLE = 0.14;
export type Vec3 = [number, number, number];

// Time is a display coordinate. Reserve a rear arc for the display-only closure;
// neither the equations nor the history are made periodic by this mapping.
export function timeAngle(offset: number, horizon: number) {
  return Math.PI / 2 - ((Math.PI - SEAM_HALF_ANGLE) * offset) / horizon;
}

export function tubePoint(
  offset: number,
  horizon: number,
  u: number,
  v: number,
): Vec3 {
  const theta = timeAngle(offset, horizon);
  return [
    (TORUS_RADIUS + u) * Math.cos(theta),
    v,
    (TORUS_RADIUS + u) * Math.sin(theta),
  ];
}

export function projectToTorus(
  position: Vec4,
  offset: number,
  horizon: number,
): Vec3 {
  // Fixed eye distance and orthonormal oblique axes keep historical geometry
  // independent of today's radius, camera, and motion settings. ||position|| <= 3.
  const [u, v] = projectCrossSection(position);
  return tubePoint(offset, horizon, u, v);
}

export function projectCrossSection(position: Vec4): [number, number] {
  const factor = 9 / (9 - position[3]);
  const [x, y, z] = position.map((n) => n * factor);
  return [
    (TUBE_GAIN * (x - z)) / Math.sqrt(2),
    (TUBE_GAIN * (x + 2 * y + z)) / Math.sqrt(6),
  ];
}

export function closedTubePoint(phase: number, u: number, v: number): Vec3 {
  const theta = Math.PI / 2 - 2 * Math.PI * phase;
  return [
    (TORUS_RADIUS + u) * Math.cos(theta),
    v,
    (TORUS_RADIUS + u) * Math.sin(theta),
  ];
}

// Join only the display seam. The recorder and numerical readouts stay untouched.
// Keeping every Bezier control inside the tube disk bounds the entire bridge.
export function closureBridge(
  end: Vec4,
  beforeEnd: Vec4,
  start: Vec4,
  afterStart: Vec4,
  tangentScale: number,
): Vec3[] {
  const a = projectCrossSection(end),
    b = projectCrossSection(start),
    prev = projectCrossSection(beforeEnd),
    next = projectCrossSection(afterStart);
  const boundedControl = (base: number[], delta: number[]) => {
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 20; i++) {
      const t = (lo + hi) / 2;
      if (
        Math.hypot(base[0] + t * delta[0], base[1] + t * delta[1]) <=
        TUBE_RADIUS
      )
        lo = t;
      else hi = t;
    }
    return base.map((v, i) => v + lo * delta[i]);
  };
  const c = boundedControl(
    a,
    a.map((v, i) => (v - prev[i]) * tangentScale),
  );
  const d = boundedControl(
    b,
    b.map((v, i) => (v - next[i]) * tangentScale),
  );
  return Array.from({ length: 41 }, (_, i) => {
    const t = i / 40,
      r = 1 - t;
    const uv = a.map(
      (v, j) =>
        r * r * r * v +
        3 * r * r * t * c[j] +
        3 * r * t * t * d[j] +
        t * t * t * b[j],
    );
    const theta = -Math.PI / 2 + SEAM_HALF_ANGLE - 2 * SEAM_HALF_ANGLE * t;
    return [
      (TORUS_RADIUS + uv[0]) * Math.cos(theta),
      uv[1],
      (TORUS_RADIUS + uv[0]) * Math.sin(theta),
    ] as Vec3;
  });
}

export function torusScreen(point: Vec3, tilt: number): [number, number] {
  const a = (tilt * Math.PI) / 180;
  return [point[0], point[2] * Math.sin(a) - point[1] * Math.cos(a)];
}

export function offsetFromTorus(
  x: number,
  y: number,
  tilt: number,
  horizon: number,
) {
  const angle = Math.atan2(y / Math.sin((tilt * Math.PI) / 180), x);
  let delta = Math.PI / 2 - angle;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  return Math.max(
    -horizon,
    Math.min(horizon, (delta / (Math.PI - SEAM_HALF_ANGLE)) * horizon),
  );
}
