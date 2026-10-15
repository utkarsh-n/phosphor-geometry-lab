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
const geometryURL = moduleURL(compile('../app/geometry.ts')),
  torusURL = moduleURL(compile('../app/torus.ts'));
const { defaults, pointAt } = await import(geometryURL);
const {
  trackPoint,
  trackShapeKey,
  loopSettings,
  loopPhase,
  loopPresets,
  naturalPhase,
  periodTurns,
} = await import(
  moduleURL(
    compile('../app/tracks.ts')
      .replace("'./geometry'", JSON.stringify(geometryURL))
      .replace("'./torus'", JSON.stringify(torusURL)),
  )
);
const {
  closureBridge,
  projectCrossSection,
  projectToTorus,
  TORUS_RADIUS,
  TUBE_RADIUS,
} = await import(torusURL);
const { cylinderProject, cylinderScale } = await import(
  moduleURL(compile('../app/cylinder.ts'))
);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const near = (a, b, eps = 1e-8) =>
  assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('all orbital tracks close in position and tangent for every motion and dimension', () => {
  for (const fourD of [false, true])
    for (const motion of [
      'Orbit',
      'Pendulum',
      'Precession',
      'Lissajous',
      'Breathing',
    ]) {
      const s = { ...defaults(), fourD, morph: 0.63, xw: 71, yw: 29, zw: -88 };
      s.channels = s.channels.map((c) => ({ ...c, motion }));
      for (let i = 0; i < 3; i++) {
        near(distance(trackPoint(0, i, s), trackPoint(1, i, s)), 0);
        const e = 1e-6,
          a = trackPoint(e, i, s),
          b = trackPoint(-e, i, s),
          c = trackPoint(1 + e, i, s),
          d = trackPoint(1 - e, i, s);
        near(
          distance(
            a.map((v, j) => (v - b[j]) / (2 * e)),
            c.map((v, j) => (v - d[j]) / (2 * e)),
          ),
          0,
          1e-6,
        );
      }
    }
});
test('frequency and speed move nodes without shifting the track geometry', () => {
  const s = { ...defaults(), fourD: true, morph: 1 },
    faster = {
      ...s,
      channels: s.channels.map((c) => ({ ...c, frequency: 0.93, speed: 2.8 })),
    };
  assert.equal(trackShapeKey(s), trackShapeKey(faster));
  for (let i = 0; i < 3; i++)
    for (let phase = 0; phase <= 1; phase += 0.07)
      near(distance(trackPoint(phase, i, s), trackPoint(phase, i, faster)), 0);
  assert.notEqual(naturalPhase(2, 0, s), naturalPhase(2, 0, faster));
  const stopped = {
    ...s,
    channels: s.channels.map((c) => ({ ...c, speed: 0 })),
  };
  near(naturalPhase(200, 0, stopped), 0);
  assert.ok(trackPoint(0.3, 0, stopped).every(Number.isFinite));
});
test('loop programs repeat settings, track positions and node locations exactly', () => {
  const s = { ...defaults(), fourD: true, morph: 1 };
  for (const program of Object.values(loopPresets))
    for (const motion of [
      'Orbit',
      'Pendulum',
      'Precession',
      'Lissajous',
      'Breathing',
    ]) {
      const base = {
        ...s,
        channels: s.channels.map((c) => ({ ...c, motion })),
      };
      for (const u of [0, 0.13, 0.43, 0.99]) {
        const a = loopSettings(base, u, program),
          b = loopSettings(base, u + 1, program);
        near(a.radius, b.radius);
        near(a.xw, b.xw);
        near(a.yw, b.yw);
        for (let i = 0; i < 3; i++)
          near(
            distance(
              trackPoint(loopPhase(u, i, 0.2, program), i, a),
              trackPoint(loopPhase(u + 1, i, 0.2, program), i, b),
            ),
            0,
          );
      }
    }
});
test('integrated pace stays nonnegative and completes the selected whole laps', () => {
  for (const pace of [0, 1, 3, 6])
    for (const depth of [0, 0.4, 1]) {
      const p = { ...loopPresets['Orbital cadence'], pace, depth };
      for (let i = 0; i < 3; i++) {
        near(loopPhase(1, i, 0.4, p) - loopPhase(0, i, 0.4, p), p.laps + i);
        for (let u = 0; u <= 1; u += 0.01) {
          const eps = 1e-6,
            v =
              (loopPhase(u + eps, i, 0, p) - loopPhase(u - eps, i, 0, p)) /
              (2 * eps);
          assert.ok(v >= -1e-8);
        }
      }
    }
});
test('excitation and radius modulation remain bounded and do not mutate shared settings', () => {
  for (const radius of [0.5, 1.7, 3])
    for (const amplitude of [0, 0.3, 1]) {
      const s = {
          ...defaults(),
          radius,
          channels: defaults().channels.map((c) => ({ ...c, amplitude })),
        },
        old = JSON.stringify(s),
        program = { ...loopPresets['Resonance sweep'], depth: 1 };
      for (let u = 0; u <= 1; u += 0.001) {
        const v = loopSettings(s, u, program);
        assert.ok(v.radius >= 0.5 - 1e-10 && v.radius <= 3 + 1e-10);
        assert.ok(
          v.channels.every(
            (c) => c.amplitude >= -1e-10 && c.amplitude <= 1 + 1e-10,
          ),
        );
      }
      assert.equal(JSON.stringify(s), old);
    }
});
test('display closure joins both torus endpoints without leaving the reference tube', () => {
  const end = [2, 0.4, -0.5, 0.3],
    prev = [1.7, -1, 0.3, 0.2],
    start = [-0.7, 1.6, 0.9, -0.8],
    next = [-0.5, 0.1, 2, 0.5];
  for (const tangentScale of [0, 3, 50, 1000]) {
    const bridge = closureBridge(end, prev, start, next, tangentScale);
    near(distance(bridge[0], projectToTorus(end, 8, 8)), 0);
    near(distance(bridge.at(-1), projectToTorus(start, -8, 8)), 0);
    for (const v of bridge) {
      assert.ok(v.every(Number.isFinite));
      assert.ok(
        Math.hypot(Math.hypot(v[0], v[2]) - TORUS_RADIUS, v[1]) <=
          TUBE_RADIUS + 1e-9,
      );
    }
  }
});
test('cylinder rotation preserves distances and fits the whole reference cage', () => {
  const a = [1, 0.4, -0.8],
    b = [-2, 0.7, 0.6];
  for (const yaw of [-75, 0, 16, 75])
    for (const pitch of [-65, 0, 10, 65]) {
      near(
        distance(
          cylinderProject(...a, yaw, pitch),
          cylinderProject(...b, yaw, pitch),
        ),
        distance(a, b),
      );
      for (const [width, height] of [
        [250, 245],
        [650, 340],
      ]) {
        const scale = cylinderScale(width, height, yaw, pitch);
        for (const x of [-2.8, 2.8])
          for (let i = 0; i < 64; i++) {
            const v = cylinderProject(
              x,
              1.2 * Math.cos((i / 64) * Math.PI * 2),
              1.2 * Math.sin((i / 64) * Math.PI * 2),
              yaw,
              pitch,
            );
            assert.ok(Math.abs(v[0]) * scale <= (width - 44) / 2 + 1e-8);
            assert.ok(Math.abs(v[1]) * scale <= (height - 88) / 2 + 1e-8);
          }
      }
    }
});

test('track nodes retain the original physical channel coordinates with phase offsets', () => {
  for (const fourD of [false, true])
    for (const motion of [
      'Orbit',
      'Pendulum',
      'Precession',
      'Lissajous',
      'Breathing',
    ]) {
      const s = { ...defaults(), fourD, morph: 0.8, xw: 73, yw: -19, zw: 43 };
      s.channels = s.channels.map((c, i) => ({
        ...c,
        motion,
        phase: 33 + i * 117,
        frequency: 0.37,
        speed: 1.28,
      }));
      for (const t of [0, 0.3, 2.7, 17.9])
        for (let i = 0; i < 3; i++) {
          const track = trackPoint(naturalPhase(t, i, s), i, s),
            expected = projectCrossSection(pointAt(t, i, s));
          near(
            distance(
              [Math.hypot(track[0], track[2]) - TORUS_RADIUS, track[1]],
              expected,
            ),
            0,
          );
        }
    }
});
test('modulation moves away from both radius and excitation limits', () => {
  const p = {
    ...loopPresets['Orbital cadence'],
    depth: 0.5,
    radius: 1,
    excitation: 1,
  };
  const low = {
    ...defaults(),
    radius: 0.5,
    channels: defaults().channels.map((c) => ({ ...c, amplitude: 0 })),
  };
  const high = {
    ...defaults(),
    radius: 3,
    channels: defaults().channels.map((c) => ({ ...c, amplitude: 1 })),
  };
  assert.ok(loopSettings(low, 0.25, p).radius > 0.5);
  assert.ok(loopSettings(low, 0.25, p).channels[0].amplitude > 0);
  assert.ok(loopSettings(high, 0.75, p).radius < 3);
  assert.ok(loopSettings(high, 0.75, p).channels[0].amplitude < 1);
});
