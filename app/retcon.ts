import { distance, type Settings } from './geometry';
import { motionKey, pointsAt, type TimeSample } from './timeline';
export type RetconBranch = {
  key: string;
  revision: number;
  samples: TimeSample[];
  archiveStart: number;
  archiveEnd: number;
  archiveCount: number;
  archiveRef: TimeSample[] | null;
};
export const createRetconBranch = (): RetconBranch => ({
  key: '',
  revision: 0,
  samples: [],
  archiveStart: -1,
  archiveEnd: -1,
  archiveCount: 0,
  archiveRef: null,
});
export function retconSettings(base: Settings, phaseShift: number): Settings {
  return {
    ...base,
    channels: base.channels.map((c) => ({
      ...c,
      phase: (((c.phase + phaseShift) % 360) + 360) % 360,
    })),
  };
}
export function updateRetconBranch(
  branch: RetconBranch,
  archive: TimeSample[],
  settings: Settings,
) {
  const key = motionKey(settings),
    start = archive[0]?.t ?? -1,
    end = archive.at(-1)?.t ?? -1;
  const reset =
    end < branch.archiveEnd ||
    !archive.length ||
    (branch.archiveRef !== null && branch.archiveRef !== archive);
  if (reset) {
    branch.samples = [];
    branch.revision = 0;
    branch.key = '';
  }
  const changed = key !== branch.key;
  if (changed) branch.revision++;
  if (
    changed ||
    reset ||
    start !== branch.archiveStart ||
    end !== branch.archiveEnd ||
    archive.length !== branch.archiveCount
  ) {
    // The branch is overwritten retroactively; archived evidence stays in its own layer.
    branch.samples = archive.map((sample) => ({
      t: sample.t,
      points: pointsAt(sample.t, settings),
      segment: 0,
    }));
  }
  Object.assign(branch, {
    key,
    archiveStart: start,
    archiveEnd: end,
    archiveCount: archive.length,
    archiveRef: archive,
  });
  return branch;
}
export function rewriteDistances(
  original: TimeSample | null,
  rewritten: TimeSample | null,
): number[] | null {
  return original && rewritten
    ? original.points.map((v, i) => distance(v, rewritten.points[i]))
    : null;
}
