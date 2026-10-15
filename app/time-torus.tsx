'use client';
import type p5 from 'p5';
import { useSketchState } from './use-sketch-state';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { type Settings, type Vec4 } from './geometry';
import { useViewCamera } from './use-view-camera';
import { projectView, viewScale } from './view-camera';
import {
  forecast,
  recordedAt,
  pointsAt,
  splitSegments,
  type TimelineFeed,
  type TimeSample,
} from './timeline';
import {
  projectToTorus,
  tubePoint,
  TUBE_RADIUS,
  closedTubePoint,
  closureBridge,
  SEAM_HALF_ANGLE,
  type Vec3,
} from './torus';

const COLORS = ['#ffbf5e', '#ff6676', '#c69bff'];
export function TimeTorus({
  feed,
  settings,
  horizon,
  offset,
  tilt,
  onTilt,
}: {
  feed: RefObject<TimelineFeed>;
  settings: Settings;
  horizon: number;
  offset: number;
  tilt: number;
  onTilt: (tilt: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useViewCamera(35, { value: tilt, onChange: onTilt });
  const latest = useSketchState({
    settings,
    horizon,
    offset,
    camera: view.camera,
  });
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false,
      instance: p5 | undefined,
      observer: ResizeObserver,
      visibility: IntersectionObserver;
    let visible = true;
    let future: TimeSample[] = [],
      cachedSettings: Settings | null = null,
      cachedTime = -1,
      cachedHorizon = -1,
      lastKey = '',
      lastSettings: Settings | null = null;
    import('p5')
      .then(({ default: P5 }) => {
        if (disposed || !host.current) return;
        instance = new P5((p: p5) => {
          p.setup = () => {
            p.createCanvas(
              host.current!.clientWidth,
              host.current!.clientHeight,
            );
            p.pixelDensity(Math.min(window.devicePixelRatio, 2));
            p.frameRate(30);
            p.describe(
              'Time torus: projected four-dimensional channel motion wrapped around a closed ring. Solid past on the left, amber present at the front, dashed conditional future on the right. The back arc smoothly blends the finite window ends for display.',
            );
            observer = new ResizeObserver(() => {
              if (host.current)
                p.resizeCanvas(
                  host.current.clientWidth,
                  host.current.clientHeight,
                );
            });
            observer.observe(host.current!);
            visibility = new IntersectionObserver(([entry]) => {
              visible = entry.isIntersecting;
              lastKey = '';
            });
            visibility.observe(host.current!);
          };
          p.draw = () => {
            if (!visible) return;
            const {
              settings: s,
              horizon: span,
              offset: cursor,
              camera,
            } = latest.current;
            const { t: now, samples, points: present, segment } = feed.current;
            const key = [
              now,
              span,
              cursor,
              camera.yaw,
              camera.pitch,
              p.width,
              p.height,
              segment,
              samples.length,
            ].join('/');
            if (key === lastKey && s === lastSettings) return;
            lastKey = key;
            lastSettings = s;
            if (
              s !== cachedSettings ||
              now !== cachedTime ||
              span !== cachedHorizon
            ) {
              future = forecast(now, span, s);
              cachedSettings = s;
              cachedTime = now;
              cachedHorizon = span;
            }
            const ctx = p.drawingContext as CanvasRenderingContext2D;
            const cx = p.width / 2,
              cy = p.height * 0.48,
              scale = viewScale(p.width, p.height);
            const screen = (v: Vec3): [number, number] => {
              const xy = projectView(v, camera);
              return [cx + scale * xy[0], cy + scale * xy[1]];
            };
            const path = (vs: Vec3[]) => {
              p.beginShape();
              for (const v of vs) {
                const a = screen(v);
                p.vertex(a[0], a[1]);
              }
              p.endShape();
            };
            const ring = (dt: number) =>
              Array.from({ length: 65 }, (_, i) =>
                tubePoint(
                  dt,
                  span,
                  TUBE_RADIUS * Math.cos((i / 64) * Math.PI * 2),
                  TUBE_RADIUS * Math.sin((i / 64) * Math.PI * 2),
                ),
              );
            const point = (t: number, v: Vec4) =>
              screen(projectToTorus(v, t - now, span));
            p.background('#060d0c');
            ctx.shadowBlur = 0;
            ctx.setLineDash([]);
            p.strokeWeight(1);
            p.stroke(42, 72, 64, 70);
            for (let x = cx % 32; x < p.width; x += 32)
              p.line(x, 0, x, p.height);
            for (let y = cy % 32; y < p.height; y += 32)
              p.line(0, y, p.width, y);
            p.noFill();
            // Draw the reference cage in back-to-front order. Traces keep explicit
            // parameter-change segment boundaries; only the rear display arc is blended.
            const slices = Array.from(
              { length: 25 },
              (_, i) => -span + (2 * span * i) / 24,
            ).sort((a, b) => Math.abs(b) - Math.abs(a));
            for (const dt of slices) {
              if (Math.abs(dt) < 0.0001) continue;
              p.stroke(89, 177, 125, Math.abs(dt) > span * 0.6 ? 47 : 87);
              ctx.setLineDash(dt > 0 ? [2, 4] : []);
              path(ring(dt));
            }
            ctx.setLineDash([]);
            for (let j = 0; j < 8; j++) {
              const a = (j / 8) * Math.PI * 2;
              p.stroke(93, 182, 123, 75);
              path(
                Array.from({ length: 121 }, (_, i) =>
                  tubePoint(
                    -span + (2 * span * i) / 120,
                    span,
                    TUBE_RADIUS * Math.cos(a),
                    TUBE_RADIUS * Math.sin(a),
                  ),
                ),
              );
            }
            // Complete the reference torus across the rear display closure.
            p.stroke(93, 182, 123, 75);
            ctx.setLineDash([]);
            for (let j = 0; j < 8; j++) {
              const a = (j / 8) * Math.PI * 2;
              path(
                Array.from({ length: 20 }, (_, i) =>
                  closedTubePoint(
                    0.5 -
                      SEAM_HALF_ANGLE / (2 * Math.PI) +
                      ((i / 19) * SEAM_HALF_ANGLE) / Math.PI,
                    TUBE_RADIUS * Math.cos(a),
                    TUBE_RADIUS * Math.sin(a),
                  ),
                ),
              );
            }
            const paths = (series: TimeSample[], dashed: boolean) => {
              for (let channel = 0; channel < 3; channel++) {
                p.noFill();
                p.stroke(COLORS[channel]);
                p.strokeWeight(1.8);
                ctx.shadowColor = COLORS[channel];
                ctx.shadowBlur = s.glow * 7;
                ctx.setLineDash(dashed ? [5, 5] : []);
                for (const segment of splitSegments(series))
                  path(
                    segment.map((sample) =>
                      projectToTorus(
                        sample.points[channel],
                        sample.t - now,
                        span,
                      ),
                    ),
                  );
              }
            };
            const oldest = recordedAt(samples, now - span),
              afterOldest = oldest
                ? samples.find((sample) => sample.t > oldest.t)
                : undefined;
            const past = samples.filter(
              (sample) => sample.t >= now - span && sample.t <= now,
            );
            if (oldest && past[0]?.t !== now - span)
              past.unshift({ ...oldest, t: now - span });
            paths(past, false);
            paths(future, true);
            if (oldest && afterOldest && future.length > 1)
              for (let channel = 0; channel < 3; channel++) {
                const end = future.at(-1)!,
                  prev = future.at(-2)!;
                const bridgeTime =
                  (2 * span * SEAM_HALF_ANGLE) / (Math.PI - SEAM_HALF_ANGLE);
                p.noFill();
                p.stroke(COLORS[channel]);
                p.strokeWeight(1.8);
                ctx.shadowColor = COLORS[channel];
                ctx.shadowBlur = s.glow * 7;
                ctx.setLineDash([]);
                path(
                  closureBridge(
                    end.points[channel],
                    prev.points[channel],
                    oldest.points[channel],
                    afterOldest.points[channel],
                    bridgeTime / (3 * (end.t - prev.t)),
                  ),
                );
              }

            ctx.setLineDash([]);
            ctx.shadowColor = '#ffbb65';
            ctx.shadowBlur = 7 + s.glow * 12;
            p.noFill();
            p.stroke('#ffbd69');
            p.strokeWeight(1.8);
            path(ring(0));
            for (let i = 0; i < 3; i++) {
              const a = point(now, present[i]);
              ctx.shadowColor = COLORS[i];
              p.fill(COLORS[i]);
              p.noStroke();
              p.circle(a[0], a[1], 6);
            }
            if (Math.abs(cursor) > 0.001) {
              const inspected =
                cursor < 0
                  ? recordedAt(samples, now + cursor)?.points
                  : pointsAt(now + cursor, s);
              ctx.shadowBlur = s.glow * 4;
              ctx.shadowColor = '#d7e8df';
              ctx.setLineDash([3, 4]);
              p.noFill();
              p.stroke('#bed3c5');
              p.strokeWeight(1);
              path(ring(cursor));
              ctx.setLineDash([]);
              if (inspected)
                for (let i = 0; i < 3; i++) {
                  const a = point(now + cursor, inspected[i]);
                  p.stroke(COLORS[i]);
                  p.circle(a[0], a[1], 10);
                }
            }
            ctx.shadowBlur = 0;
            p.noStroke();
            p.textFont('monospace');
            p.textSize(11);
            p.textAlign(p.CENTER);
            p.fill('#9eafa6');
            p.text(`CLOSED TIME LOOP · ±${span} s`, cx, 23);
            p.fill('#ffbf75');
            p.text('NOW', cx, p.height - 18);
            p.fill('#9eafa6');
            p.textAlign(p.LEFT);
            p.text('PAST', 16, p.height - 18);
            p.textAlign(p.RIGHT);
            p.text('FORECAST', p.width - 16, p.height - 18);
          };
        }, host.current);
      })
      .catch(() =>
        setError('The time torus could not start. Reload to retry.'),
      );
    return () => {
      disposed = true;
      observer?.disconnect();
      visibility?.disconnect();
      instance?.remove();
    };
  }, [feed, latest]);
  return (
    <div className="rotatable-view">
      <div className="view-toolbar">
        <span>Drag to rotate · scrub below to inspect</span>
        <button
          className="chart-reset"
          onClick={view.reset}
          aria-label="Reset time torus view"
        >
          RESET VIEW
        </button>
      </div>
      <div className="time-screen torus-screen">
        <div
          ref={host}
          className="time-canvas rotatable-canvas"
          role="application"
          aria-roledescription="interactive 3D view"
          {...view.bind}
          aria-label="Time torus. Drag or use arrow keys to rotate. Home resets the view."
        />
        <div className="scanlines" />
        {error && <p className="scope-error">{error}</p>}
      </div>
      <div className="camera-readout" aria-live="off">
        YAW {view.camera.yaw.toFixed(0)}° / TILT {view.camera.pitch.toFixed(0)}°
      </div>
    </div>
  );
}
