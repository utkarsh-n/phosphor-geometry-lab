'use client';
import type p5 from 'p5';
import { useSketchState } from './use-sketch-state';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Slider } from '@/components/ui/slider';
import { type Settings, type Vec4 } from './geometry';
import {
  forecast,
  pointsAt,
  recordedAt,
  splitSegments,
  type TimelineFeed,
  type TimeSample,
} from './timeline';
import {
  createRetconBranch,
  retconSettings,
  updateRetconBranch,
  rewriteDistances,
} from './retcon';
import {
  closedTubePoint,
  projectToTorus,
  tubePoint,
  closureBridge,
  TUBE_RADIUS,
  SEAM_HALF_ANGLE,
  type Vec3,
} from './torus';
import { useViewCamera } from './use-view-camera';
import { projectView, viewScale } from './view-camera';

const COLORS = ['#ffbf5e', '#ff6676', '#c69bff'];
type Readout = {
  revision: number;
  time: number;
  original: Vec4[] | null;
  rewritten: Vec4[];
  deltas: number[] | null;
  count: number;
};
export function RetconTorus({
  feed,
  settings,
  horizon,
}: {
  feed: RefObject<TimelineFeed>;
  settings: Settings;
  horizon: number;
}) {
  const view = useViewCamera(38);
  const [phase, setPhase] = useState(30),
    [ghost, setGhost] = useState(0.4),
    [requestedOffset, setOffset] = useState(-2);
  const offset = Math.max(-horizon, Math.min(horizon, requestedOffset));
  const [readout, setReadout] = useState<Readout>({
    revision: 0,
    time: 0,
    original: null,
    rewritten: pointsAt(0, settings),
    deltas: null,
    count: 0,
  });
  const [error, setError] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const latest = useSketchState({
    settings,
    horizon,
    phase,
    ghost,
    offset,
    camera: view.camera,
  });
  useEffect(() => {
    let disposed = false,
      instance: p5 | undefined,
      resize: ResizeObserver,
      visibility: IntersectionObserver,
      visible = true;
    const branch = createRetconBranch();
    let lastKey = '',
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
              'Retcon torus: current controls retroactively rewrite a separate timeline. Faint blue dashed ghosts preserve the original recorded past; luminous channel paths show the rewritten past and future. Drag or use arrows to rotate, Home resets the view.',
            );
            resize = new ResizeObserver(() => {
              if (host.current)
                p.resizeCanvas(
                  host.current.clientWidth,
                  host.current.clientHeight,
                );
            });
            resize.observe(host.current!);
            visibility = new IntersectionObserver(([entry]) => {
              visible = entry.isIntersecting;
              lastKey = '';
            });
            visibility.observe(host.current!);
          };
          p.draw = () => {
            if (!visible) return;
            const {
              settings: base,
              horizon: span,
              phase: shift,
              ghost: strength,
              offset: cursor,
              camera,
            } = latest.current;
            const { t: now, samples, segment } = feed.current;
            const key = JSON.stringify([
              now,
              span,
              shift,
              strength,
              cursor,
              camera,
              p.width,
              p.height,
              segment,
              samples.length,
              samples[0]?.t,
            ]);
            if (key === lastKey && base === lastSettings) return;
            lastKey = key;
            lastSettings = base;
            const s = retconSettings(base, shift);
            updateRetconBranch(branch, samples, s);
            const past = forecast(now - span, span, s),
              future = forecast(now, span, s);
            const archive = samples.filter(
              (sample) => sample.t >= now - span && sample.t <= now,
            );
            const cx = p.width / 2,
              cy = p.height * 0.48,
              scale = viewScale(p.width, p.height),
              ctx = p.drawingContext as CanvasRenderingContext2D;
            const screen = (v: Vec3): [number, number] => {
              const xy = projectView(v, camera);
              return [cx + xy[0] * scale, cy + xy[1] * scale];
            };
            const path = (vs: Vec3[]) => {
              p.beginShape();
              for (const v of vs) p.vertex(...screen(v));
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
            p.background('#080d13');
            ctx.shadowBlur = 0;
            ctx.setLineDash([]);
            p.strokeWeight(1);
            p.noFill();
            p.stroke(56, 88, 108, 55);
            for (let x = cx % 32; x < p.width; x += 32)
              p.line(x, 0, x, p.height);
            for (let y = cy % 32; y < p.height; y += 32)
              p.line(0, y, p.width, y);
            p.stroke(91, 157, 187, 55);
            for (let j = 0; j < 8; j++) {
              const a = (j / 8) * Math.PI * 2;
              path(
                Array.from({ length: 121 }, (_, i) =>
                  closedTubePoint(
                    i / 120,
                    TUBE_RADIUS * Math.cos(a),
                    TUBE_RADIUS * Math.sin(a),
                  ),
                ),
              );
            }
            for (let j = 0; j < 20; j++)
              path(
                Array.from({ length: 41 }, (_, i) =>
                  closedTubePoint(
                    j / 20,
                    TUBE_RADIUS * Math.cos((i / 40) * Math.PI * 2),
                    TUBE_RADIUS * Math.sin((i / 40) * Math.PI * 2),
                  ),
                ),
              );
            // Original paths remain separate, including their real parameter-change gaps.
            for (let channel = 0; channel < 3; channel++) {
              p.stroke(153, 199, 215, Math.round(255 * strength));
              p.strokeWeight(1.1);
              ctx.setLineDash([2, 5]);
              for (const part of splitSegments(archive))
                path(
                  part.map((sample) =>
                    projectToTorus(
                      sample.points[channel],
                      sample.t - now,
                      span,
                    ),
                  ),
                );
              // Small displacement links expose the revision without obscuring either timeline.
              p.stroke(129, 209, 229, 55);
              ctx.setLineDash([2, 5]);
              const stride = Math.max(1, Math.floor(archive.length / 8));
              for (let i = 0; i < archive.length; i += stride) {
                const sample = archive[i],
                  next = pointsAt(sample.t, s)[channel];
                path([
                  projectToTorus(sample.points[channel], sample.t - now, span),
                  projectToTorus(next, sample.t - now, span),
                ]);
              }
            }
            const drawModel = (series: TimeSample[], dashed: boolean) => {
              for (let channel = 0; channel < 3; channel++) {
                p.stroke(COLORS[channel]);
                p.strokeWeight(2);
                ctx.shadowColor = '#75dafa';
                ctx.shadowBlur = 4 + s.glow * 9;
                ctx.setLineDash(dashed ? [6, 4] : []);
                path(
                  series.map((sample) =>
                    projectToTorus(
                      sample.points[channel],
                      sample.t - now,
                      span,
                    ),
                  ),
                );
              }
            };
            drawModel(past, false);
            drawModel(future, true);
            ctx.setLineDash([]);
            const bridgeTime =
              (2 * span * SEAM_HALF_ANGLE) / (Math.PI - SEAM_HALF_ANGLE);
            for (let i = 0; i < 3; i++) {
              p.stroke(COLORS[i]);
              path(
                closureBridge(
                  future.at(-1)!.points[i],
                  future.at(-2)!.points[i],
                  past[0].points[i],
                  past[1].points[i],
                  bridgeTime / (3 * (future.at(-1)!.t - future.at(-2)!.t)),
                ),
              );
            }
            ctx.shadowColor = '#8beaff';
            ctx.shadowBlur = 12;
            p.stroke('#a2eaff');
            p.strokeWeight(1.2);
            path(ring(0));
            const snapshot =
              cursor <= 0 ? recordedAt(samples, now + cursor) : null;
            const at = snapshot?.t ?? now + cursor;
            const rewritten = { t: at, points: pointsAt(at, s), segment: 0 };
            ctx.shadowBlur = 0;
            p.stroke(180, 225, 237, 110);
            ctx.setLineDash([3, 4]);
            path(ring(at - now));
            ctx.setLineDash([]);
            for (let i = 0; i < 3; i++) {
              const position = screen(
                projectToTorus(rewritten.points[i], at - now, span),
              );
              if (snapshot) {
                const old = screen(
                  projectToTorus(snapshot.points[i], at - now, span),
                );
                p.noFill();
                p.stroke('#a9d6e6');
                p.strokeWeight(1);
                p.circle(...old, 11);
                p.stroke(143, 205, 226, 135);
                p.line(...old, ...position);
              }
              p.noStroke();
              ctx.shadowColor = COLORS[i];
              ctx.shadowBlur = 8 + s.glow * 10;
              p.fill(COLORS[i]);
              p.circle(...position, 7);
              ctx.shadowBlur = 0;
              p.textFont('monospace');
              p.textSize(12);
              p.text('ABC'[i], position[0] + 10, position[1] - 8);
            }
            ctx.shadowBlur = 0;
            p.noStroke();
            p.textFont('monospace');
            p.textSize(11);
            p.fill('#8fbcca');
            p.textAlign(p.LEFT);
            p.text('ORIGINAL PAST RETAINED', 15, 23);
            p.textAlign(p.RIGHT);
            p.fill('#aff2ff');
            p.text(
              `REV ${String(branch.revision).padStart(3, '0')}`,
              p.width - 15,
              23,
            );
            p.textAlign(p.CENTER);
            p.text(
              p.width < 320
                ? 'PAST  /  NOW  /  FUTURE'
                : 'REWRITTEN PAST  /  NOW  /  REWRITTEN FUTURE',
              cx,
              p.height - 17,
            );
            setReadout({
              revision: branch.revision,
              time: at,
              original: snapshot?.points ?? null,
              rewritten: rewritten.points,
              deltas: rewriteDistances(snapshot, rewritten),
              count: branch.samples.length,
            });
          };
        }, host.current);
      })
      .catch(() =>
        setError('The retcon display could not start. Reload to retry.'),
      );
    return () => {
      disposed = true;
      resize?.disconnect();
      visibility?.disconnect();
      instance?.remove();
    };
  }, [feed, latest]);
  return (
    <section className="retcon-section" aria-label="Retcon torus">
      <div className="retcon-header">
        <div>
          <span>05 / RETCON TORUS</span>
          <h3>Rewrite time. Retain its echo.</h3>
        </div>
        <span className="retcon-status" key={readout.revision}>
          REV {String(readout.revision).padStart(3, '0')}
        </span>
      </div>
      <p className="retcon-intro">
        Current motion controls rewrite this timeline’s past and future. The
        original past remains as a ghost.
      </p>
      <div className="retcon-controls">
        <div>
          <div className="control-label">
            <span className="control-caption">Rewrite phase</span>
            <output aria-live="off">
              {phase > 0 ? '+' : ''}
              {phase}°
            </output>
          </div>
          <Slider
            aria-label="Retcon rewrite phase"
            min={-180}
            max={180}
            step={1}
            value={[phase]}
            onValueChange={(v) => setPhase(Array.isArray(v) ? v[0] : v)}
          />
        </div>
        <div>
          <div className="control-label">
            <span className="control-caption">Ghost strength</span>
            <output aria-live="off">{Math.round(ghost * 100)}%</output>
          </div>
          <Slider
            aria-label="Retcon ghost strength"
            min={0.2}
            max={0.8}
            step={0.05}
            value={[ghost]}
            onValueChange={(v) => setGhost(Array.isArray(v) ? v[0] : v)}
          />
        </div>
        <button className="button" onClick={() => setPhase(0)}>
          RESET PHASE
        </button>
      </div>
      <div className="retcon-display">
        <div className="view-toolbar">
          <span>Drag to rotate · arrows to turn · Home to reset</span>
          <button
            className="chart-reset"
            onClick={view.reset}
            aria-label="Reset retcon torus view"
          >
            RESET VIEW
          </button>
        </div>
        <div className="time-screen retcon-screen">
          <div
            ref={host}
            className="time-canvas rotatable-canvas"
            role="application"
            aria-roledescription="interactive 3D view"
            {...view.bind}
            aria-label="Retcon torus. Drag or use arrow keys to rotate. Home resets the view."
          />
          <div className="scanlines" />
          {error && <p className="scope-error">{error}</p>}
        </div>
        <div className="camera-readout">
          YAW {view.camera.yaw.toFixed(0)}° / TILT{' '}
          {view.camera.pitch.toFixed(0)}°
        </div>
      </div>
      <div className="time-legend retcon-legend">
        <span>
          <i className="ghost-key" /> Original ghost
        </span>
        <span>
          <i className="rewrite-key" /> Rewritten past
        </span>
        <span>
          <i className="dashed-key" /> Rewritten future
        </span>
      </div>
      <div className="retcon-inspector">
        <div className="control-label">
          <span className="control-caption">Compare a moment</span>
          <output aria-live="off">
            {offset > 0 ? '+' : ''}
            {offset.toFixed(2)} s
          </output>
        </div>
        <Slider
          aria-label="Retcon inspection offset"
          min={-horizon}
          max={horizon}
          step={0.05}
          value={[offset]}
          onValueChange={(v) => setOffset(Array.isArray(v) ? v[0] : v)}
        />
        <div className="inspection-heading">
          <span>
            {offset < 0
              ? 'REWRITTEN PAST'
              : offset > 0
                ? 'REWRITTEN FUTURE'
                : 'REWRITTEN PRESENT'}
          </span>
          <output aria-live="off">t = {readout.time.toFixed(2)} s</output>
        </div>
        <div className="retcon-comparison">
          {readout.rewritten.map((point, i) => (
            <div key={i}>
              <div className="retcon-channel">
                <b style={{ color: COLORS[i] }}>{'ABC'[i]}</b>
                <output aria-live="off">
                  Δ {readout.deltas ? readout.deltas[i].toFixed(3) : '—'} u
                </output>
              </div>
              <div className="retcon-coordinates">
                <span>ORIGINAL</span>
                <output aria-live="off">
                  {readout.original
                    ? readout.original[i].map((v) => v.toFixed(2)).join(' / ')
                    : '— / — / — / —'}
                </output>
                <span>REWRITTEN</span>
                <output aria-live="off">
                  {point.map((v) => v.toFixed(2)).join(' / ')}
                </output>
              </div>
            </div>
          ))}
        </div>
        <p className="retcon-note">
          Coordinates: x / y / z / w. Δ measures spatial displacement at the
          same recorded instant.{' '}
          {readout.original
            ? 'The ghost keeps the original position.'
            : 'No original recording exists at this instant; the rewritten position is computed.'}
        </p>
      </div>
      <details className="projection-details">
        <summary>What gets rewritten?</summary>
        <p>
          This is a separate retcon branch: each recorded timestamp receives new
          coordinates from the current motion equations, plus the rewrite-phase
          offset. Earlier parameter changes are replaced in this branch. The
          archive, other views and simulation clock remain intact. Before
          recording began, the past is computed. The rear closure is a visual
          blend.
        </p>
      </details>
    </section>
  );
}
