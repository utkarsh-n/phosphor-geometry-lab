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
const timelineURL = moduleURL(
  compile('../app/timeline.ts').replace(
    "'./geometry'",
    JSON.stringify(geometryURL),
  ),
);
const torusURL = moduleURL(compile('../app/torus.ts'));
const cylinderURL = moduleURL(compile('../app/cylinder.ts'));
const { defaults, distance } = await import(geometryURL);
const { createRecorder, recordAt, pointsAt, forecast, recordedAt } =
  await import(timelineURL);
const {
  createRetconBranch,
  retconSettings,
  updateRetconBranch,
  rewriteDistances,
} = await import(
  moduleURL(
    compile('../app/retcon.ts')
      .replace("'./geometry'", JSON.stringify(geometryURL))
      .replace("'./timeline'", JSON.stringify(timelineURL)),
  )
);
const { normalizeCamera, projectView, viewScale } = await import(
  moduleURL(
    compile('../app/view-camera.ts')
      .replace("'./cylinder'", JSON.stringify(cylinderURL))
      .replace("'./torus'", JSON.stringify(torusURL)),
  )
);
const { torusScreen, closedTubePoint, projectToTorus, TUBE_RADIUS } =
  await import(torusURL);
const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const record = (settings, end = 3) => {
  const r = createRecorder();
  for (let i = 0; i <= end * 60; i++) recordAt(r, i / 60, settings);
  return r;
};

test('retcon rewrites the past and future at fixed times without altering original evidence', () => {
  const base = { ...defaults(), fourD: true, morph: 1 },
    recorder = record(base),
    branch = createRetconBranch();
  updateRetconBranch(branch, recorder.samples, base);
  const original = JSON.stringify(recorder.samples),
    oldBranch = JSON.stringify(branch.samples),
    futureBefore = forecast(3, 2, base);
  const edited = retconSettings(
    {
      ...base,
      radius: 2.8,
      xw: 70,
      channels: base.channels.map((c) => ({
        ...c,
        frequency: 0.83,
        amplitude: 0.7,
      })),
    },
    65,
  );
  updateRetconBranch(branch, recorder.samples, edited);
  assert.equal(JSON.stringify(recorder.samples), original);
  assert.notEqual(JSON.stringify(branch.samples), oldBranch);
  assert.equal(branch.revision, 2);
  branch.samples.forEach((sample, i) => {
    assert.equal(sample.t, recorder.samples[i].t);
    assert.equal(sample.segment, 0);
    sample.points.forEach((p, c) =>
      near(distance(p, pointsAt(sample.t, edited)[c]), 0),
    );
  });
  assert.ok(
    distance(futureBefore[60].points[0], forecast(3, 2, edited)[60].points[0]) >
      0.1,
  );
  assert.equal(recorder.lastTime, 3);
});

test('retcon crosses model segments while ghosts retain the original discontinuities', () => {
  const base = defaults(),
    r = record(base, 1),
    edited = retconSettings(base, 90),
    branch = createRetconBranch();
  recordAt(r, 1.1, edited);
  recordAt(r, 1.2, edited);
  const before = JSON.stringify(r.samples);
  updateRetconBranch(branch, r.samples, edited);
  assert.equal(new Set(r.samples.map((s) => s.segment)).size, 2);
  assert.equal(new Set(branch.samples.map((s) => s.segment)).size, 1);
  assert.equal(JSON.stringify(r.samples), before);
});

test('optical controls do not rewrite history or increment revision; new samples do not count as edits', () => {
  const base = defaults(),
    r = record(base),
    branch = createRetconBranch();
  updateRetconBranch(branch, r.samples, base);
  const samples = branch.samples;
  updateRetconBranch(branch, r.samples, {
    ...base,
    yaw: 150,
    pitch: -75,
    glow: 0.1,
    mesh: false,
    trails: false,
    persistence: 12,
  });
  assert.equal(branch.revision, 1);
  assert.equal(branch.samples, samples);
  recordAt(r, 3.1, base);
  updateRetconBranch(branch, r.samples, base);
  assert.equal(branch.revision, 1);
  assert.equal(branch.samples.length, r.samples.length);
});

test('clear, recorder replacement, and clock reset drop stale retcon history', () => {
  const base = defaults(),
    r = record(base),
    branch = createRetconBranch();
  updateRetconBranch(branch, r.samples, base);
  updateRetconBranch(branch, r.samples, retconSettings(base, 40));
  assert.equal(branch.revision, 2);
  const fresh = createRecorder();
  recordAt(fresh, 3, base);
  updateRetconBranch(branch, fresh.samples, base);
  assert.equal(branch.revision, 1);
  assert.equal(branch.samples.length, 1);
  assert.equal(branch.samples[0].t, 3);
  recordAt(fresh, 0, base);
  updateRetconBranch(branch, fresh.samples, base);
  assert.equal(branch.samples.length, 1);
  assert.equal(branch.samples[0].t, 0);
  updateRetconBranch(branch, [], base);
  assert.equal(branch.samples.length, 0);
});

test('phase edits copy settings and compare true four-dimensional distances at one timestamp', () => {
  const base = defaults(),
    before = JSON.stringify(base),
    edited = retconSettings(base, -450);
  assert.equal(JSON.stringify(base), before);
  edited.channels.forEach((c, i) => {
    assert.notEqual(c, base.channels[i]);
    assert.ok(c.phase >= 0 && c.phase < 360);
  });
  const r = record(base),
    snapshot = recordedAt(r.samples, 3),
    rewritten = {
      t: snapshot.t,
      points: pointsAt(snapshot.t, edited),
      segment: 0,
    };
  rewriteDistances(snapshot, rewritten).forEach((d, i) =>
    near(
      d,
      Math.hypot(
        ...snapshot.points[i].map((v, j) => v - rewritten.points[i][j]),
      ),
    ),
  );
  assert.equal(rewriteDistances(null, rewritten), null);
  assert.equal(recordedAt(r.samples, 3), r.samples.at(-1));
});

test('rewritten projections stay finite and inside the torus tube at extreme controls', () => {
  for (const motion of [
    'Orbit',
    'Pendulum',
    'Precession',
    'Lissajous',
    'Breathing',
  ]) {
    const base = {
      ...defaults(),
      fourD: true,
      morph: 1,
      radius: 3,
      xw: 123,
      yw: -172,
      zw: 88,
    };
    base.channels = base.channels.map((c) => ({
      ...c,
      motion,
      amplitude: 1,
      speed: 3,
      frequency: 1,
    }));
    const s = retconSettings(base, 179);
    for (let t = -30; t <= 30; t += 0.13)
      for (const p of pointsAt(t, s)) {
        const v = projectToTorus(p, t, 30);
        assert.ok(v.every(Number.isFinite));
        assert.ok(
          Math.hypot(Math.hypot(v[0], v[2]) - 2.6, v[1]) <= TUBE_RADIUS + 1e-9,
        );
      }
  }
});

test('rotatable cameras match the original default projection and normalize safely', () => {
  assert.deepEqual(normalizeCamera(725, 100), { yaw: 5, pitch: 85 });
  assert.deepEqual(normalizeCamera(-725, -100), { yaw: -5, pitch: -85 });
  for (const tilt of [-85, 0, 35, 85])
    for (const phase of [0, 0.2, 0.7, 1]) {
      const p = closedTubePoint(phase, 0.5, -0.2),
        old = torusScreen(p, tilt),
        next = projectView(p, { yaw: 0, pitch: tilt });
      next.forEach((v, i) => near(v, old[i]));
    }
});

test('all camera orientations keep the complete torus framed without rescaling on rotation', () => {
  for (const [w, h] of [
    [260, 310],
    [500, 350],
    [900, 420],
  ])
    for (let yaw = -180; yaw < 180; yaw += 30)
      for (let pitch = -85; pitch <= 85; pitch += 17) {
        const scale = viewScale(w, h);
        for (let u = 0; u < 1; u += 0.05)
          for (let a = 0; a < Math.PI * 2; a += 0.4) {
            const p = closedTubePoint(
                u,
                TUBE_RADIUS * Math.cos(a),
                TUBE_RADIUS * Math.sin(a),
              ),
              v = projectView(p, { yaw, pitch });
            assert.ok(Math.abs(v[0] * scale) <= w / 2 - 18 + 1e-8);
            assert.ok(Math.abs(v[1] * scale) <= h / 2 - 40 + 1e-8);
          }
      }
});
