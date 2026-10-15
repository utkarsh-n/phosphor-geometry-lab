import { pointAt, TAU, type Settings, type Motion } from './geometry';
import { closedTubePoint, projectCrossSection, type Vec3 } from './torus';

export type LoopProgram = {
  duration: number;
  laps: number;
  depth: number;
  pace: number;
  excitation: number;
  radius: number;
  rotation: number;
};
export const loopPresets: Record<string, LoopProgram> = {
  'Orbital cadence': {
    duration: 16,
    laps: 2,
    depth: 0.4,
    pace: 1,
    excitation: 2,
    radius: 1,
    rotation: 1,
  },
  'Resonance sweep': {
    duration: 24,
    laps: 3,
    depth: 0.75,
    pace: 2,
    excitation: 3,
    radius: 2,
    rotation: 2,
  },
  'Slow drift': {
    duration: 32,
    laps: 1,
    depth: 0.25,
    pace: 1,
    excitation: 1,
    radius: 1,
    rotation: 1,
  },
};
export const modulo = (v: number, n = 1) => ((v % n) + n) % n;
export function periodTurns(motion: Motion, fourD: boolean) {
  return motion === 'Precession' ? 4 : motion === 'Breathing' && fourD ? 2 : 1;
}
export function naturalPhase(t: number, index: number, s: Settings) {
  const c = s.channels[index];
  return (
    (c.frequency * c.speed * t) / periodTurns(c.motion, s.fourD) + c.phase / 360
  );
}
export function trackPoint(phase: number, index: number, s: Settings): Vec3 {
  const turns = periodTurns(s.channels[index].motion, s.fourD);
  const canonical = {
    ...s,
    channels: s.channels.map((c) => ({ ...c, frequency: 1 / TAU, speed: 1 })),
  };
  const v = pointAt(
    TAU * turns * (phase - s.channels[index].phase / 360),
    index,
    canonical,
  );
  const [u, w] = projectCrossSection(v);
  return closedTubePoint(phase, u, w);
}
export function trackShapeKey(s: Settings) {
  return JSON.stringify([
    s.radius,
    s.morph,
    s.fourD,
    s.xw,
    s.yw,
    s.zw,
    s.channels.map((c) => [c.motion, c.amplitude, c.phase]),
  ]);
}
export function loopSettings(
  base: Settings,
  u: number,
  program: LoopProgram,
): Settings {
  const wave = (cycles: number) =>
    cycles === 0 ? 0 : Math.sin(TAU * cycles * u);
  const pulse = (value: number, min: number, max: number, cycles: number) => {
    const w = wave(cycles);
    return (
      value +
      program.depth *
        (Math.max(0, w) ** 2 * (max - value) -
          Math.max(0, -w) ** 2 * (value - min))
    );
  };
  return {
    ...base,
    radius: pulse(base.radius, 0.5, 3, program.radius),
    xw: base.xw + 70 * program.depth * wave(program.rotation),
    yw: base.yw + 45 * program.depth * wave(program.rotation),
    channels: base.channels.map((c) => ({
      ...c,
      amplitude: pulse(c.amplitude, 0, 1, program.excitation),
    })),
  };
}
// Integrate nonnegative periodic pace, rather than multiplying instantaneous speed by time.
export function loopPhase(
  u: number,
  index: number,
  origin: number,
  program: LoopProgram,
) {
  const laps = program.laps + index,
    k = program.pace;
  return (
    origin +
    laps *
      (u +
        (k === 0
          ? 0
          : (program.depth * (1 - Math.cos(TAU * k * u))) / (TAU * k)))
  );
}
