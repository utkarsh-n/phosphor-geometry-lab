export function cylinderProject(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): [number, number, number] {
  const a = (yaw * Math.PI) / 180,
    b = (pitch * Math.PI) / 180;
  const rx = x * Math.cos(a) + z * Math.sin(a),
    rz = -x * Math.sin(a) + z * Math.cos(a);
  return [
    rx,
    y * Math.cos(b) - rz * Math.sin(b),
    y * Math.sin(b) + rz * Math.cos(b),
  ];
}
export function cylinderScale(
  width: number,
  height: number,
  yaw: number,
  pitch: number,
) {
  const corners = [-2.8, 2.8].flatMap((x) =>
    [-1.2, 1.2].flatMap((y) =>
      [-1.2, 1.2].map((z) => cylinderProject(x, y, z, yaw, pitch)),
    ),
  );
  const xBound = Math.max(...corners.map((v) => Math.abs(v[0]))),
    yBound = Math.max(...corners.map((v) => Math.abs(v[1])));
  return Math.min((width - 44) / (2 * xBound), (height - 88) / (2 * yBound));
}
