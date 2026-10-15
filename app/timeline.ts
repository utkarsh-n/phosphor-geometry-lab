import { pointAt, type Settings, type Vec4 } from './geometry';

export const HISTORY_SECONDS = 30;
export const SAMPLE_INTERVAL = 1 / 60;
export type TimeSample = { t: number; points: Vec4[]; segment: number };
export type Recorder = { samples: TimeSample[]; segment: number; key: string; lastTime: number; nextSample: number };
export type TimelineFeed = { t: number; points: Vec4[]; samples: TimeSample[]; segment: number };
export const createRecorder = (): Recorder => ({ samples: [], segment: 0, key: '', lastTime: -Infinity, nextSample: 0 });
export const motionKey = (s: Settings) => JSON.stringify([s.channels, s.radius, s.morph, s.fourD, s.xw, s.yw, s.zw]);
export const pointsAt = (t: number, s: Settings): Vec4[] => [0, 1, 2].map(i => pointAt(t, i, s));

/** Call before advancing the simulation clock. Past snapshots are never rewritten. */
export function recordAt(rec: Recorder, t: number, s: Settings) {
  if (t < rec.lastTime - 1e-9) Object.assign(rec, createRecorder());
  const key = motionKey(s), changed = key !== rec.key;
  if (changed) { rec.segment++; rec.key = key; rec.nextSample = t; }
  const advanced = t > rec.lastTime + 1e-9;
  if (rec.samples.length === 0 || (advanced && (changed || rec.samples[rec.samples.length - 1].segment !== rec.segment))) {
    rec.samples.push({ t, points: pointsAt(t, s), segment: rec.segment });
    rec.nextSample = t + SAMPLE_INTERVAL;
  } else if (advanced) {
    // Catch up exact simulation-time ticks only within an unchanged model segment.
    while (rec.nextSample <= t + 1e-9) {
      rec.samples.push({ t: rec.nextSample, points: pointsAt(rec.nextSample, s), segment: rec.segment });
      rec.nextSample += SAMPLE_INTERVAL;
    }
  } else if (changed) {
    // Paused edits change the forecast origin but never append or replace history.
    rec.nextSample = t + SAMPLE_INTERVAL;
  }
  rec.lastTime = t;
  let trim = 0;
  while (trim < rec.samples.length && rec.samples[trim].t < t - HISTORY_SECONDS - 1e-9) trim++;
  if (trim) rec.samples.splice(0, trim);
}

export function forecast(now: number, horizon: number, s: Settings): TimeSample[] {
  const count = Math.ceil(horizon / SAMPLE_INTERVAL);
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = now + Math.min(i * SAMPLE_INTERVAL, horizon);
    return { t, points: pointsAt(t, s), segment: 0 };
  });
}

export function recordedAt(samples: TimeSample[], t: number): TimeSample | null {
  if (!samples.length || t < samples[0].t - 1e-9 || t > samples[samples.length - 1].t + SAMPLE_INTERVAL) return null;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (samples[mid].t <= t + 1e-9) lo = mid; else hi = mid - 1;
  }
  // Return an actual snapshot at or before the cursor, never an invented interpolation.
  return samples[lo];
}

export function splitSegments(samples: TimeSample[]): TimeSample[][] {
  const result: TimeSample[][] = [];
  for (const sample of samples) {
    const last = result[result.length - 1];
    if (!last || last[last.length - 1].segment !== sample.segment) result.push([sample]);
    else last.push(sample);
  }
  return result;
}
