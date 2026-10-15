'use client';
import type p5 from 'p5';
import { useSketchState } from './use-sketch-state';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Eraser, Crosshair } from 'lucide-react';
import { TimeTorus } from './time-torus';
import { OrbitalTracks } from './orbital-tracks';
import { RetconTorus } from './retcon-torus';
import { cylinderProject, cylinderScale } from './cylinder';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { type Settings, type Vec4 } from './geometry';
import {
  forecast,
  pointsAt,
  recordedAt,
  splitSegments,
  type TimelineFeed,
  type TimeSample,
} from './timeline';

const colors = ['#ffbf5e', '#ff6676', '#c69bff'];
const planes = {
  XY: [0, 1],
  XZ: [0, 2],
  XW: [0, 3],
  YZ: [1, 2],
  YW: [1, 3],
  ZW: [2, 3],
} as const;
type Plane = keyof typeof planes;
const signed = (n: number, digits = 2) =>
  `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
type Inspection = {
  kind: string;
  time: number;
  points: Vec4[] | null;
  recorded: number;
};

export function TimeCylinder({
  feed,
  settings,
  running,
  clearHistory,
}: {
  feed: RefObject<TimelineFeed>;
  settings: Settings;
  running: boolean;
  clearHistory: () => void;
}) {
  const [tilt, setTilt] = useState(35);
  const [camera, setCamera] = useState({ yaw: 16, pitch: 10 });
  const drag = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  const rotateCylinder = (yaw: number, pitch: number) =>
    setCamera({
      yaw: Math.max(-75, Math.min(75, yaw)),
      pitch: Math.max(-65, Math.min(65, pitch)),
    });
  const [horizon, setHorizon] = useState(8),
    [plane, setPlane] = useState<Plane>('XY'),
    [offset, setOffset] = useState(0);
  const [inspection, setInspection] = useState<Inspection>({
    kind: 'NOW',
    time: 0,
    points: null,
    recorded: 0,
  });
  const [error, setError] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const latest = useSketchState({ settings, horizon, plane, offset, camera });
  useEffect(() => {
    let disposed = false,
      instance: p5 | undefined,
      observer: ResizeObserver;
    let future: TimeSample[] = [],
      cachedSettings: Settings | null = null,
      cachedTime = -1,
      cachedHorizon = -1,
      lastDrawKey = '',
      lastDrawSettings: Settings | null = null;
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
              'Rotatable time cylinder. Solid traces show history, the amber ring is now, and dashed traces predict unchanged controls. Drag to rotate or use arrow keys.',
            );
            observer = new ResizeObserver(() => {
              if (host.current)
                p.resizeCanvas(
                  host.current.clientWidth,
                  host.current.clientHeight,
                );
            });
            observer.observe(host.current!);
          };
          p.draw = () => {
            const {
              settings: s,
              horizon: span,
              plane: view,
              offset: cursor,
              camera: cam,
            } = latest.current;
            const { t: now, samples, points: present } = feed.current;
            const drawKey = [
              now,
              span,
              view,
              cursor,
              cam.yaw,
              cam.pitch,
              p.width,
              p.height,
              feed.current.segment,
              samples.length,
            ].join('/');
            if (drawKey === lastDrawKey && s === lastDrawSettings) return;
            lastDrawKey = drawKey;
            lastDrawSettings = s;
            if (
              cachedSettings !== s ||
              now !== cachedTime ||
              cachedHorizon !== span
            ) {
              future = forecast(now, span, s);
              cachedTime = now;
              cachedHorizon = span;
              cachedSettings = s;
            }
            const [vertical, depth] = planes[view];
            const cx = p.width / 2,
              cy = p.height * 0.47;
            const scale = cylinderScale(p.width, p.height, cam.yaw, cam.pitch);
            const screen = (
              x: number,
              y: number,
              z: number,
            ): [number, number] => {
              const v = cylinderProject(x, y, z, cam.yaw, cam.pitch);
              return [cx + v[0] * scale, cy - v[1] * scale];
            };
            const project = (t: number, v: Vec4) =>
              screen(
                ((t - now) / span) * 2.8,
                v[vertical] * 0.4,
                v[depth] * 0.4,
              );
            const ring = (t: number) => {
              p.beginShape();
              for (let i = 0; i <= 64; i++) {
                const a = (i / 64) * Math.PI * 2;
                const v = screen(
                  ((t - now) / span) * 2.8,
                  1.2 * Math.cos(a),
                  1.2 * Math.sin(a),
                );
                p.vertex(...v);
              }
              p.endShape();
            };
            const ctx = p.drawingContext as CanvasRenderingContext2D;
            p.background('#07100b');
            ctx.shadowBlur = 0;
            ctx.setLineDash([]);
            p.stroke(26, 59, 37);
            p.strokeWeight(1);
            for (let x = 0; x < p.width; x += 32) p.line(x, 0, x, p.height);
            for (let y = 0; y < p.height; y += 32) p.line(0, y, p.width, y);
            p.noStroke();
            p.fill(92, 114, 66, 8);
            p.rect(0, 0, cx, p.height);
            p.fill(51, 112, 83, 8);
            p.rect(cx, 0, cx, p.height);
            p.noFill();
            // Rigidly rotate the complete time cylinder. All snapshots retain a fixed scale.
            for (let i = -4; i <= 4; i++) {
              p.stroke(i < 0 ? 'rgba(96,133,102,.35)' : 'rgba(103,191,134,.4)');
              ctx.setLineDash(i > 0 ? [3, 5] : []);
              ring(now + (i * span) / 4);
            }
            ctx.setLineDash([]);
            p.stroke(86, 155, 104, 120);
            for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
              const a = screen(
                -2.8,
                1.2 * Math.cos(angle),
                1.2 * Math.sin(angle),
              );
              const b = screen(
                2.8,
                1.2 * Math.cos(angle),
                1.2 * Math.sin(angle),
              );
              p.line(...a, ...b);
            }
            const paths = (series: TimeSample[], dashed: boolean) => {
              for (let channel = 0; channel < 3; channel++) {
                const color = p.color(colors[channel]);
                color.setAlpha(dashed ? 190 : 215);
                p.stroke(color);
                p.strokeWeight(1.7);
                p.noFill();
                ctx.shadowColor = colors[channel];
                ctx.shadowBlur = s.glow * 3;
                ctx.setLineDash(dashed ? [5, 5] : []);
                for (const segment of splitSegments(series)) {
                  p.beginShape();
                  for (const sample of segment) {
                    const pos = project(sample.t, sample.points[channel]);
                    p.vertex(pos[0], pos[1]);
                  }
                  p.endShape();
                }
              }
            };
            paths(
              samples.filter(
                (sample) => sample.t >= now - span && sample.t <= now,
              ),
              false,
            );
            paths(future, true);
            ctx.setLineDash([]);
            // The current slice divides recorded history from the conditional future.
            ctx.shadowColor = '#ffbd69';
            ctx.shadowBlur = 8 + s.glow * 12;
            p.stroke('#efbb78');
            p.strokeWeight(1.7);
            p.noFill();
            ring(now);

            for (let i = 0; i < 3; i++) {
              const pos = project(now, present[i]);
              ctx.shadowColor = colors[i];
              p.noStroke();
              p.fill(colors[i]);
              p.circle(pos[0], pos[1], 6);
            }
            const snapshot =
              cursor < -0.001 ? recordedAt(samples, now + cursor) : null;
            const inspected =
              cursor < -0.001
                ? (snapshot?.points ?? null)
                : cursor > 0.001
                  ? pointsAt(now + cursor, s)
                  : present;
            if (Math.abs(cursor) > 0.001) {
              ctx.shadowColor = '#b8d0b5';
              ctx.shadowBlur = s.glow * 5;
              p.noFill();
              p.stroke(180, 211, 183, 125);
              p.strokeWeight(1);
              ctx.setLineDash([2, 4]);
              ring(now + cursor);
              ctx.setLineDash([]);
              if (inspected)
                for (let i = 0; i < 3; i++) {
                  const pos = project(now + cursor, inspected[i]);
                  p.stroke(colors[i]);
                  p.circle(pos[0], pos[1], 10);
                }
            }
            ctx.shadowBlur = 0;
            p.noStroke();
            p.textFont('monospace');
            p.textSize(p.width < 400 ? 10 : 12);
            p.fill('#8fa78e');
            p.textAlign(p.LEFT);
            p.text('RECORDED', 16, 22);
            p.textAlign(p.CENTER);
            p.fill('#efbb78');
            p.text('NOW', cx, 22);
            p.textAlign(p.RIGHT);
            p.fill('#a4c5b0');
            p.text('PREDICTED', p.width - 16, 22);
            p.textAlign(p.CENTER);
            p.fill('#94ac97');
            for (const i of [-1, 0, 1]) {
              const pos = screen(i * 2.8, -1.2, 0);
              p.text(
                i === 0 ? '0 s' : `${signed(i * span, 0)} s`,
                pos[0],
                Math.min(p.height - 12, pos[1] + 20),
              );
            }
            setInspection({
              kind:
                cursor < -0.001
                  ? inspected
                    ? 'RECORDED'
                    : 'NOT RECORDED'
                  : cursor > 0.001
                    ? 'FORECAST'
                    : 'NOW',
              time: snapshot?.t ?? now + cursor,
              points: inspected,
              recorded: samples.length ? now - samples[0].t : 0,
            });
          };
        }, host.current);
      })
      .catch(() =>
        setError('The time cylinder could not start. Reload to retry.'),
      );
    return () => {
      disposed = true;
      observer?.disconnect();
      instance?.remove();
    };
  }, [feed, latest]);
  // The canvas application owns focus and arrow-key input; it is not a static image.
  /* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  return (
    <section className="panel time-panel" aria-label="5D time projections">
      <div className="panel-heading">
        <span className="section-number">03</span>
        <h2>TIME PROJECTION</h2>
        <span className="time-badge">5D · 4 SPACE + TIME</span>
      </div>
      <div className="time-controls">
        <div>
          <div className="control-label">
            <span className="control-caption">Past / future window</span>
            <output aria-live="off">±{horizon} s</output>
          </div>
          <Slider
            aria-label="Timeline horizon"
            min={2}
            max={20}
            step={1}
            value={[horizon]}
            onValueChange={(v) => {
              const n = Array.isArray(v) ? v[0] : v;
              setHorizon(n);
              setOffset((old) => Math.max(-n, Math.min(n, old)));
            }}
          />
        </div>
        <div>
          <span className="control-caption">Cylinder plane</span>
          <Select
            value={plane}
            onValueChange={(v) => {
              if (v && v in planes) setPlane(v as Plane);
            }}
          >
            <SelectTrigger aria-label="Timeline coordinate plane">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(planes).map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="control-label">
            <span className="control-caption">Torus tilt</span>
            <output aria-live="off">{tilt.toFixed(0)}°</output>
          </div>
          <Slider
            aria-label="Torus tilt"
            min={-85}
            max={85}
            step={1}
            value={[tilt]}
            onValueChange={(v) => setTilt(Array.isArray(v) ? v[0] : v)}
          />
        </div>
      </div>
      <div className="time-charts">
        <div className="time-chart">
          <div className="chart-heading">
            <h3>Time cylinder</h3>
            <span>02 / LINEAR TIME</span>
          </div>
          <div className="view-toolbar">
            <span>Drag to rotate · arrows to turn</span>
            <button
              className="chart-reset"
              onClick={() => setCamera({ yaw: 16, pitch: 10 })}
              aria-label="Reset time cylinder view"
            >
              RESET VIEW
            </button>
          </div>
          <div className="time-screen">
            <div
              ref={host}
              className="time-canvas"
              role="application"
              aria-roledescription="interactive 3D view"
              aria-label="Time cylinder. Drag to rotate, use arrow keys to turn, or Home to reset the view."
              tabIndex={0}
              onPointerDown={(e) => {
                if (!e.isPrimary || e.button !== 0) return;
                e.currentTarget.focus({ preventScroll: true });
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, ...camera };
              }}
              onPointerMove={(e) => {
                if (drag.current)
                  rotateCylinder(
                    drag.current.yaw + (e.clientX - drag.current.x) * 0.5,
                    drag.current.pitch - (e.clientY - drag.current.y) * 0.5,
                  );
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
              onKeyDown={(e) => {
                const d: Record<string, number[]> = {
                  ArrowLeft: [-5, 0],
                  ArrowRight: [5, 0],
                  ArrowUp: [0, 5],
                  ArrowDown: [0, -5],
                };
                if (d[e.key]) {
                  e.preventDefault();
                  rotateCylinder(
                    camera.yaw + d[e.key][0],
                    camera.pitch + d[e.key][1],
                  );
                }
                if (e.key === 'Home') {
                  e.preventDefault();
                  setCamera({ yaw: 16, pitch: 10 });
                }
              }}
            />
            <div className="scanlines" />
            {error && <p className="scope-error">{error}</p>}
          </div>
          <div className="camera-readout">
            YAW {camera.yaw.toFixed(0)}° / TILT {camera.pitch.toFixed(0)}°
          </div>
          <p className="chart-caption">{plane} cross-section · linear time</p>
        </div>
        <div className="time-chart">
          <div className="chart-heading">
            <h3>Time torus</h3>
            <span>03 / WRAPPED TIME</span>
          </div>
          <TimeTorus
            feed={feed}
            settings={settings}
            horizon={horizon}
            offset={offset}
            tilt={tilt}
            onTilt={setTilt}
          />
          <p className="chart-caption">4D projection · closed wrap</p>
        </div>
      </div>
      <div className="time-legend">
        <span>
          <i className="solid-key" /> Recorded past
        </span>
        <span>
          <i className="ember-key" /> Present
        </span>
        <span>
          <i className="dashed-key" /> Conditional future
        </span>
        <span className="timeline-status">
          {running ? 'TIME ADVANCING' : 'TIME HELD'}
        </span>
      </div>
      <div className="time-scrubber">
        <div className="control-label">
          <span className="control-caption">Inspect both views</span>
          <button className="return-now" onClick={() => setOffset(0)}>
            <Crosshair size={13} /> NOW
          </button>
          <output aria-live="off">{signed(offset)} s</output>
        </div>
        <Slider
          aria-label="Timeline inspection offset"
          min={-horizon}
          max={horizon}
          step={0.05}
          value={[offset]}
          onValueChange={(v) => setOffset(Array.isArray(v) ? v[0] : v)}
        />
        <div className="scrubber-labels">
          <span>−{horizon} s · past</span>
          <span>0 · present</span>
          <span>+{horizon} s · future</span>
        </div>
      </div>
      <div className="inspection-heading">
        <span>{inspection.kind}</span>
        <output aria-live="off">t = {inspection.time.toFixed(2)} s</output>
        <span>{inspection.recorded.toFixed(1)} s RECORDED</span>
      </div>
      <div className="inspection-data">
        <div className="time-readouts">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <b style={{ color: colors[i] }}>{'ABC'[i]}</b>
              <span>
                {[0, 1, 2, 3].map((axis) => (
                  <span key={axis}>
                    {'xyzw'[axis]}{' '}
                    <output aria-live="off">
                      {inspection.points
                        ? signed(inspection.points[i][axis])
                        : '—'}
                    </output>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p
          className="empty-history"
          aria-hidden={Boolean(inspection.points)}
          style={{ visibility: inspection.points ? 'hidden' : 'visible' }}
        >
          No original sample at this moment. Run the simulation to record
          history.
        </p>
      </div>
      <div className="time-foot">
        <p>
          Knob changes reshape the forecast immediately. Recorded history stays
          intact.
        </p>
        <button className="button" onClick={clearHistory}>
          <Eraser size={14} /> Clear history
        </button>
      </div>
      <details className="projection-details">
        <summary>How to read these projections</summary>
        <p>
          “5D” means four spatial coordinates plus simulation time. The cylinder
          displays the {plane} coordinate plane at a fixed ±3 u scale. The torus
          projects all four coordinates into its cross-section and wraps time
          around the ring. Its rear arc smoothly blends the window ends for a
          closed display loop; numerical readouts still report actual recorded
          or predicted positions.
        </p>
        <p>
          Solid paths are recorded positions; dashed paths predict the current
          equations if controls stay unchanged. History is retained for 30
          simulation seconds, even with these views closed. Gaps mark parameter
          changes. Paused edits preview a new present without rewriting history.
        </p>
      </details>
      <OrbitalTracks feed={feed} settings={settings} running={running} />
      <RetconTorus feed={feed} settings={settings} horizon={horizon} />
    </section>
  );
  /* oxlint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}
