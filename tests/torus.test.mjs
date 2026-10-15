import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
const moduleURL = (code) =>
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const geometryURL = moduleURL(compile('../app/geometry.ts'));
const { defaults, pointAt } = await import(geometryURL);
const { createRecorder, recordAt, forecast } = await import(
  moduleURL(
    compile('../app/timeline.ts').replace(
      "'./geometry'",
      JSON.stringify(geometryURL),
    ),
  )
);
const {
  projectToTorus,
  timeAngle,
  tubePoint,
  torusScreen,
  offsetFromTorus,
  TORUS_RADIUS,
  TUBE_RADIUS,
} = await import(moduleURL(compile('../app/torus.ts')));
const near = (a, b, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

test('every motion remains finite and inside the reference torus tube at maximum radius', () => {
  for (const motion of [
    'Orbit',
    'Pendulum',
    'Precession',
    'Lissajous',
    'Breathing',
  ]) {
    const s = {
      ...defaults(),
      fourD: true,
      morph: 1,
      radius: 3,
      xw: 125,
      yw: -110,
      zw: 77,
    };
    s.channels = s.channels.map((c) => ({
      ...c,
      motion,
      amplitude: 1,
      frequency: 0.71,
      speed: 2.37,
    }));
    for (let i = 0; i <= 240; i++)
      for (let channel = 0; channel < 3; channel++) {
        const point = projectToTorus(
          pointAt(i / 6, channel, s),
          i / 6 - 20,
          20,
        );
        assert.ok(point.every(Number.isFinite));
        const radial = Math.hypot(point[0], point[2]);
        assert.ok(radial > 0);
        assert.ok(Math.hypot(radial - TORUS_RADIUS, point[1]) < TUBE_RADIUS);
      }
  }
});
test('time samples reserve a rear closure arc, with now at the front', () => {
  const p = projectToTorus([0, 0, 0, 0], 0, 8);
  near(p[0], 0);
  near(p[2], TORUS_RADIUS);
  const past = projectToTorus([0, 0, 0, 0], -8, 8),
    future = projectToTorus([0, 0, 0, 0], 8, 8);
  assert.ok(past[0] < 0 && future[0] > 0 && past[2] < 0 && future[2] < 0);
  assert.ok(distance(past, future) > 0.5);
  near(timeAngle(0, 2), timeAngle(0, 20));
});
test('all four input coordinates influence the projected cross-section', () => {
  const base = [0.8, 0.5, -0.4, 0.2];
  for (let axis = 0; axis < 4; axis++) {
    const edited = [...base];
    edited[axis] += 0.3;
    assert.ok(
      distance(projectToTorus(base, 2, 8), projectToTorus(edited, 2, 8)) >
        0.001,
    );
  }
});
test('torus inspection reverses its centerline projection for all tilts and both seam edges', () => {
  for (const tilt of [15, 35, 75])
    for (const horizon of [2, 8, 20])
      for (const fraction of [-1, -0.75, -0.25, 0, 0.25, 0.75, 1]) {
        const dt = fraction * horizon,
          screen = torusScreen(tubePoint(dt, horizon, 0, 0), tilt);
        near(offsetFromTorus(...screen, tilt, horizon), dt);
      }
});
test('editing parameters changes the forecast without changing projected history', () => {
  const s = { ...defaults(), fourD: true, morph: 1 };
  const rec = createRecorder();
  for (let i = 0; i <= 120; i++) recordAt(rec, i / 60, s);
  const old = rec.samples.map((sample) =>
    projectToTorus(sample.points[0], sample.t - 2, 8),
  );
  const edited = {
    ...s,
    radius: 0.5,
    xw: -100,
    channels: s.channels.map((c) => ({ ...c, frequency: 0.9 })),
  };
  recordAt(rec, 2, edited);
  assert.deepEqual(
    rec.samples.map((sample) =>
      projectToTorus(sample.points[0], sample.t - 2, 8),
    ),
    old,
  );
  const before = forecast(2, 8, s),
    after = forecast(2, 8, edited);
  assert.ok(
    distance(
      projectToTorus(before[120].points[0], 2, 8),
      projectToTorus(after[120].points[0], 2, 8),
    ) > 0.1,
  );
  assert.deepEqual(
    projectToTorus(after[120].points[0], 2, 8),
    projectToTorus(pointAt(4, 0, edited), 2, 8),
  );
});
