'use client';
import type p5 from 'p5';
import { useSketchState } from './use-sketch-state';
import {
  useEffect,
  useRef,
  useState,
  useId,
  type CSSProperties,
  type RefObject,
} from 'react';
import {
  Activity,
  Pause,
  Play,
  SkipForward,
  RotateCcw,
  Eraser,
  ArrowUpRight,
  CircleHelp,
  X,
  Radio,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  defaults,
  distance,
  meshLines,
  pointAt,
  project,
  type Settings,
  type Channel,
  type Motion,
  type Vec4,
} from './geometry';
import { createRecorder, recordAt, type TimelineFeed } from './timeline';
import { TimeCylinder } from './time-cylinder';
import { animateControl } from './control-feedback';
const COLORS = ['#ffbf5e', '#ff6676', '#c69bff'];
const RGB: Record<string, [number, number, number]> = {
  '#ffbf5e': [255, 191, 94],
  '#ff6676': [255, 102, 118],
  '#c69bff': [198, 155, 255],
  '#65f58a': [101, 245, 138],
  '#70a981': [112, 169, 129],
  '#81efa0': [129, 239, 160],
};
const MODES: Motion[] = [
  'Orbit',
  'Pendulum',
  'Precession',
  'Lissajous',
  'Breathing',
];
const F = (v: number) =>
  Math.abs(v) < 0.0005
    ? '0.000'
    : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(3)}`;
type Telemetry = { t: number; points: Vec4[]; fps: number };
function Range({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  format = (v: number) => v.toFixed(2),
  className = '',
  disabled = false,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`range ${className}`}>
      <div className="control-label">
        <label>{label}</label>
        <output aria-live="off">{format(value)}</output>
      </div>
      <Slider
        disabled={disabled}
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}
function Knob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  unit = '',
  precision = 2,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  precision?: number;
}) {
  const drag = useRef<{ x: number; y: number; value: number } | null>(null);
  const angle = -135 + (270 * (value - min)) / (max - min);
  const change = (v: number) =>
    onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  return (
    <div className="knob-control">
      <span className="knob-label">{label}</span>
      <div className="dial-scale">
        <div
          className="dial"
          aria-hidden="true"
          style={{ '--angle': `${angle}deg` } as CSSProperties}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, value };
          }}
          onPointerMove={(e) => {
            if (drag.current)
              change(
                drag.current.value +
                  ((drag.current.y - e.clientY + (e.clientX - drag.current.x)) *
                    (max - min)) /
                    180,
              );
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onLostPointerCapture={() => (drag.current = null)}
        >
          <span className="dial-face">
            <i />
          </span>
        </div>
      </div>
      <output aria-live="off">
        {value.toFixed(precision)}
        <small>{unit}</small>
      </output>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => change(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="toggle-label">
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
function PanelHeading({
  n,
  title,
  side,
}: {
  n: string;
  title: string;
  side?: React.ReactNode;
}) {
  return (
    <div className="panel-heading">
      <span className="section-number">{n}</span>
      <h2>{title}</h2>
      {side}
    </div>
  );
}
function Scope({
  settings,
  running,
  step,
  clear,
  onTelemetry,
  onCamera,
  timelineFeed,
  historyClear,
}: {
  settings: Settings;
  running: boolean;
  step: number;
  clear: number;
  onTelemetry: (d: Telemetry) => void;
  onCamera: (yaw: number, pitch: number) => void;
  timelineFeed: RefObject<TimelineFeed>;
  historyClear: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    latest = useSketchState({
      settings,
      running,
      step,
      clear,
      onTelemetry,
      onCamera,
      historyClear,
    });
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false,
      instance: p5 | undefined,
      observer: ResizeObserver,
      visibility: IntersectionObserver;
    let visible = true;
    let t = 0,
      lastStep = latest.current.step,
      lastClear = latest.current.clear,
      lastReport = 0,
      lastSample = -1,
      meshKey = '',
      lines: Vec4[][] = [];
    let lastDrawSettings: Settings | null = null,
      lastDrawWidth = -1,
      lastDrawHeight = -1,
      lastRunning = true;
    let history: { t: number; points: Vec4[] }[] = [];
    let recorder = createRecorder(),
      lastHistoryClear = latest.current.historyClear;
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
            p.frameRate(60);
            p.describe(
              'Interactive geometry scope with amber, red and purple points. Exact coordinates and spatial distances appear below.',
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
              lastDrawSettings = null;
            });
            visibility.observe(host.current!);
          };
          p.draw = () => {
            const {
              settings: s,
              running: play,
              step: tick,
              clear: wipe,
              onTelemetry: report,
              historyClear: historyWipe,
            } = latest.current;
            if (
              !play &&
              !lastRunning &&
              s === lastDrawSettings &&
              tick === lastStep &&
              wipe === lastClear &&
              historyWipe === lastHistoryClear &&
              p.width === lastDrawWidth &&
              p.height === lastDrawHeight
            )
              return;
            lastDrawSettings = s;
            lastDrawWidth = p.width;
            lastDrawHeight = p.height;
            lastRunning = play;
            if (wipe !== lastClear) {
              history = [];
              lastClear = wipe;
              lastSample = -1;
            }
            if (tick < lastStep) {
              t = 0;
              history = [];
              lastSample = -1;
              recorder = createRecorder();
            }
            if (historyWipe !== lastHistoryClear) {
              recorder = createRecorder();
              lastHistoryClear = historyWipe;
            }
            recordAt(recorder, t, s);
            if (play) t += Math.min(p.deltaTime / 1000, 0.05);
            else if (tick > lastStep) t += (tick - lastStep) / 60;
            lastStep = tick;
            const points = [0, 1, 2].map((i) => pointAt(t, i, s));
            recordAt(recorder, t, s);
            timelineFeed.current = {
              t,
              points,
              samples: recorder.samples,
              segment: recorder.segment,
            };
            if (s.trails && t - lastSample >= 1 / 60) {
              history.push({ t, points });
              lastSample = t;
            }
            history = history
              .filter((h) => t - h.t <= s.persistence)
              .slice(-900);
            if (!visible) {
              if (p.millis() - lastReport > 90 || !play) {
                report({ t, points, fps: p.frameRate() });
                lastReport = p.millis();
              }
              return;
            }
            const cx = p.width / 2,
              cy = p.height / 2,
              scale =
                Math.min(p.width * 0.35, p.height * 0.365) /
                (s.fourD ? 2.7 : 2.5);
            const screen = (v: Vec4) => {
              const a = project(v, s);
              return [cx + a[0] * scale, cy - a[1] * scale, a[2]];
            };
            p.background('#07100b');
            p.strokeWeight(1);
            p.noFill();
            p.drawingContext.shadowBlur = 0;
            const grid = 40;
            p.stroke(35, 74, 48, 85);
            for (let x = cx % grid; x < p.width; x += grid)
              p.line(x, 0, x, p.height);
            for (let y = cy % grid; y < p.height; y += grid)
              p.line(0, y, p.width, y);
            p.stroke(63, 110, 75, 100);
            p.line(cx, 0, cx, p.height);
            p.line(0, cy, p.width, cy);
            for (let x = 0; x < p.width; x += 8) {
              p.line(x, cy - 2, x, cy + 2);
            }
            for (let y = 0; y < p.height; y += 8) {
              p.line(cx - 2, y, cx + 2, y);
            }
            const path = (
              vs: Vec4[],
              color: string,
              alpha: number,
              width = 1,
            ) => {
              p.stroke(...RGB[color], alpha);
              p.strokeWeight(width);
              p.noFill();
              p.beginShape();
              for (const v of vs) {
                const a = screen(v);
                p.vertex(a[0], a[1]);
              }
              p.endShape();
            };
            p.drawingContext.shadowColor = '#6eff91';
            p.drawingContext.shadowBlur = s.glow * 9;
            const key = [s.morph, s.radius, s.fourD, s.xw, s.yw, s.zw].join(
              '/',
            );
            if (key !== meshKey) {
              lines = meshLines(s);
              meshKey = key;
            }
            if (s.mesh)
              for (const line of lines)
                path(line, '#65f58a', s.fourD ? 85 : 125, 1);
            if (s.axes) {
              for (let i = 0; i < (s.fourD ? 4 : 3); i++) {
                const a = [0, 0, 0, 0] as Vec4,
                  b = [0, 0, 0, 0] as Vec4;
                a[i] = -s.radius * 1.18;
                b[i] = s.radius * 1.18;
                path([a, b], i === 3 ? '#c69bff' : '#70a981', 95);
                const end = screen(b);
                p.noStroke();
                p.fill(i === 3 ? '#c69bff' : '#80ac8c');
                p.textSize(12);
                p.textFont('monospace');
                p.text('xyzw'[i], end[0] + 6, end[1] - 6);
              }
            }
            if (s.trails && history.length > 1)
              for (let i = 0; i < 3; i++) {
                p.drawingContext.shadowColor = COLORS[i];
                for (let bucket = 0; bucket < 12; bucket++) {
                  const start = Math.floor(
                      (bucket * (history.length - 1)) / 12,
                    ),
                    end = Math.floor(
                      ((bucket + 1) * (history.length - 1)) / 12,
                    );
                  if (end <= start) continue;
                  const segment = history.slice(start, end + 1);
                  path(
                    segment.map((h) => h.points[i]),
                    COLORS[i],
                    Math.max(
                      0,
                      1 -
                        (t - segment[Math.floor(segment.length / 2)].t) /
                          s.persistence,
                    ) * 125,
                    1.6,
                  );
                }
              }
            p.drawingContext.shadowColor = '#73ff97';
            if (s.connections)
              path([...points, points[0]], '#81efa0', 175, 1.25);
            for (let i = 0; i < 3; i++) {
              const a = screen(points[i]);
              p.drawingContext.shadowColor = COLORS[i];
              p.drawingContext.shadowBlur = s.glow * 23;
              p.noStroke();
              p.fill(COLORS[i]);
              p.circle(a[0], a[1], 7);
              p.noFill();
              p.stroke(COLORS[i]);
              p.strokeWeight(1);
              p.circle(a[0], a[1], 17);
              p.noStroke();
              p.fill(COLORS[i]);
              p.textSize(13);
              p.textFont('monospace');
              p.text('ABC'[i], a[0] + 14, a[1] - 12);
            }
            p.drawingContext.shadowBlur = 0;
            if (p.millis() - lastReport > 90 || !play) {
              report({ t, points, fps: p.frameRate() });
              lastReport = p.millis();
            }
          };
        }, host.current);
      })
      .catch(() =>
        setError('The scope could not start. Please reload to retry.'),
      );
    return () => {
      disposed = true;
      observer?.disconnect();
      visibility?.disconnect();
      instance?.remove();
    };
  }, [timelineFeed, latest]);
  const drag = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  // This canvas application owns focus and arrow-key input; it is not a static image.
  /* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  return (
    <div
      className="scope-canvas"
      ref={host}
      tabIndex={0}
      role="application"
      aria-roledescription="interactive 3D view"
      aria-label="Geometry scope. Drag or use arrow keys to rotate. Home resets the view."
      onKeyDown={(e) => {
        if (e.key === 'Home') {
          e.preventDefault();
          onCamera(0, 0);
          return;
        }
        const dirs: Record<string, number[]> = {
          ArrowLeft: [-5, 0],
          ArrowRight: [5, 0],
          ArrowUp: [0, 5],
          ArrowDown: [0, -5],
        };
        if (dirs[e.key]) {
          e.preventDefault();
          onCamera(
            settings.yaw + dirs[e.key][0],
            settings.pitch + dirs[e.key][1],
          );
        }
      }}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          yaw: settings.yaw,
          pitch: settings.pitch,
        };
      }}
      onPointerMove={(e) => {
        if (drag.current)
          onCamera(
            drag.current.yaw + (e.clientX - drag.current.x) * 0.5,
            drag.current.pitch + (e.clientY - drag.current.y) * 0.5,
          );
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onLostPointerCapture={() => (drag.current = null)}
    >
      {error && <p className="scope-error">{error}</p>}
    </div>
  );
  /* oxlint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}
export default function Home() {
  const [fiveD, setFiveD] = useState(false),
    [historyClear, setHistoryClear] = useState(0);
  const timelineFeed = useRef<TimelineFeed>({
    t: 0,
    points: [0, 1, 2].map((i) => pointAt(0, i, defaults())),
    samples: [],
    segment: 0,
  });
  const [s, setS] = useState<Settings>(defaults),
    [running, setRunning] = useState(true),
    [step, setStep] = useState(0),
    [clear, setClear] = useState(0),
    [channel, setChannel] = useState(0),
    [linked, setLinked] = useState(false),
    [help, setHelp] = useState(false),
    [preset, setPreset] = useState('Custom experiment');
  const [data, setData] = useState<Telemetry>({
    t: 0,
    points: [0, 1, 2].map((i) => pointAt(0, i, defaults())),
    fps: 60,
  });
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS((prev) => ({ ...prev, [k]: v }));
    setPreset('Custom experiment');
  };
  const changeChannel = <K extends keyof Channel>(k: K, v: Channel[K]) => {
    setS((prev) => ({
      ...prev,
      channels: prev.channels.map((c, i) =>
        linked || i === channel ? { ...c, [k]: v } : c,
      ),
    }));
    setPreset('Custom experiment');
  };
  const singleStep = () => {
    setRunning(false);
    setStep((n) => n + 1);
  };
  const reset = () => {
    setS(defaults());
    setRunning(true);
    setStep((n) => n - 100000);
    setClear((n) => n + 1);
    setChannel(0);
    setLinked(false);
    setPreset('Custom experiment');
    setFiveD(false);
  };
  const applyPreset = (name: string) => {
    const next = defaults();
    if (name === 'Spherical orbits') {
      next.morph = 1;
      next.yaw = 28;
      next.pitch = 20;
    }
    if (name === 'Lissajous study') {
      next.morph = 1;
      next.yaw = 25;
      next.channels = next.channels.map((c) => ({
        ...c,
        motion: 'Lissajous',
        amplitude: 1,
      }));
      next.persistence = 6;
    }
    if (name === 'Hyperspace') {
      next.morph = 1;
      next.fourD = true;
      next.xw = 38;
      next.yw = 28;
      next.zw = 12;
      next.yaw = 25;
      next.channels = next.channels.map((c) => ({
        ...c,
        motion: 'Precession',
      }));
    }
    setS(next);
    setFiveD(false);
    setPreset(name);
    setLinked(false);
    setStep((n) => n - 100000);
    setClear((n) => n + 1);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input,button,select,[role="slider"],[role="switch"],[role="combobox"],textarea',
        )
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        setRunning((v) => !v);
      }
      if (e.key.toLowerCase() === 'n') singleStep();
      if (e.key.toLowerCase() === 'c') setClear((n) => n + 1);
      if (e.key.toLowerCase() === 'r') reset();
      if (e.key === 'Escape') setHelp(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const c = s.channels[channel];
  const activeDimension = fiveD ? 5 : s.fourD ? 4 : s.morph === 0 ? 2 : 3;
  const chooseDimension = (dimension: number) => {
    setFiveD(dimension === 5);
    setS((prev) => ({
      ...prev,
      fourD: dimension >= 4,
      morph: dimension >= 3 ? 1 : 0,
    }));
    setClear((n) => n + 1);
    setPreset('Custom experiment');
  };
  const clock = `${Math.floor(data.t / 3600)
    .toString()
    .padStart(2, '0')}:${Math.floor((data.t / 60) % 60)
    .toString()
    .padStart(2, '0')}:${(data.t % 60).toFixed(2).padStart(5, '0')}`;
  return (
    <main className="lab" onClickCapture={animateControl}>
      <header className="masthead">
        <div className="brand">
          <div className="brand-symbol">
            <Activity size={28} />
          </div>
          <div>
            <p>ORBITAL ANALYSIS CONSOLE / 05</p>
            <h1>
              Space Age Orbital Dynamics:
              <span>Decomposing the Frequencies</span>
            </h1>
          </div>
        </div>
        <button
          className="help-button"
          onClick={() => setHelp(!help)}
          aria-expanded={help}
        >
          <CircleHelp size={17} /> Field notes
        </button>
      </header>
      <div className="instrument-top">
        <fieldset className="mode-selector" aria-label="Dimension mode">
          {[
            { n: 2, label: 'Circle' },
            { n: 3, label: 'Sphere' },
            { n: 4, label: 'Hypersphere' },
            { n: 5, label: 'Space + time' },
          ].map((mode) => (
            <button
              key={mode.n}
              aria-label={`${mode.n}D ${mode.label}`}
              className={activeDimension === mode.n ? 'selected' : ''}
              aria-pressed={activeDimension === mode.n}
              onClick={() => chooseDimension(mode.n)}
            >
              <b>{mode.n}D</b>
              <span>{mode.label}</span>
            </button>
          ))}
        </fieldset>
        <div className="chronograph">
          <span className={`annunciator ${running ? 'run' : 'hold'}`}>
            {running ? 'RUN' : 'HOLD'}
          </span>
          <div>
            <span className="clock-label">SIMULATION TIME</span>
            <output aria-live="off">{clock}</output>
          </div>
        </div>
      </div>
      <div className="workspace" data-time-view={fiveD}>
        <section className="display-column">
          <div className="screen-housing">
            <div className="scope-plate">
              <span>01 / SPATIAL PROJECTION</span>
              <span>POSITION · ATTITUDE</span>
            </div>
            <i className="screw tl" />
            <i className="screw tr" />
            <i className="screw bl" />
            <i className="screw br" />
            <div className="screen">
              <div className="screen-top">
                <span>
                  <i className={`status-light ${running ? '' : 'paused'}`} />
                  {running ? 'LIVE TRACE' : 'HOLD'}
                </span>
                <span>
                  {s.fourD
                    ? '4D → 3D → 2D'
                    : s.morph < 0.01
                      ? '2D / CIRCLE'
                      : s.morph > 0.99
                        ? '3D / SPHERE'
                        : '2D → 3D / MORPH'}
                </span>
              </div>
              <Scope
                timelineFeed={timelineFeed}
                historyClear={historyClear}
                settings={s}
                running={running}
                step={step}
                clear={clear}
                onTelemetry={setData}
                onCamera={(yaw, pitch) =>
                  setS((prev) => ({
                    ...prev,
                    yaw: ((((yaw + 180) % 360) + 360) % 360) - 180,
                    pitch: Math.max(-90, Math.min(90, pitch)),
                  }))
                }
              />
              <div className="scanlines" />
              <div className="screen-bottom">
                <span>
                  R {s.radius.toFixed(2)} u <b>•</b> t {data.t.toFixed(2)} s
                </span>
                <span>
                  DRAG TO ROTATE <ArrowUpRight size={13} />
                </span>
              </div>
            </div>
          </div>
          <div className="transport">
            <div className="transport-buttons">
              <button
                className={`button play-button ${running ? 'active' : ''}`}
                onClick={() => setRunning(!running)}
                aria-label={running ? 'Pause' : 'Play'}
              >
                <span
                  className="button-state-icon"
                  key={running ? 'pause' : 'play'}
                >
                  {running ? <Pause size={16} /> : <Play size={16} />}
                </span>{' '}
                {running ? 'PAUSE' : 'PLAY'}
              </button>
              <button className="button" onClick={singleStep}>
                <SkipForward size={16} /> STEP <small>1/60 s</small>
              </button>
              <button
                className="button clear-button"
                onClick={() => setClear((n) => n + 1)}
              >
                <Eraser size={16} /> CLEAR TRAILS
              </button>
              <button className="button reset-button" onClick={reset}>
                <RotateCcw size={15} /> RESET
              </button>
            </div>
            <span className="transport-hint">
              <kbd>SPACE</kbd> play / pause
            </span>
          </div>
          <section className="panel motion-panel">
            <PanelHeading
              n="02"
              title="MOTION CONTROL"
              side={
                <Toggle
                  label="Link channels"
                  checked={linked}
                  onChange={(v) => {
                    setLinked(v);
                    if (v)
                      setS((prev) => ({
                        ...prev,
                        channels: prev.channels.map(() => ({
                          ...prev.channels[channel],
                        })),
                      }));
                  }}
                />
              }
            />
            <div className="motion-toolbar">
              <div className="channel-select" aria-label="Edit channel">
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    onClick={() => setChannel(i)}
                    aria-label={`Edit channel ${'ABC'[i]}`}
                    aria-pressed={channel === i}
                    className={channel === i ? 'selected' : ''}
                    style={{ '--channel': COLORS[i] } as CSSProperties}
                  >
                    <i />
                    {'ABC'[i]}
                  </button>
                ))}
              </div>
              <span className="edit-label">
                {linked
                  ? 'LINKED · A + B + C'
                  : `EDIT CHANNEL ${'ABC'[channel]}`}
              </span>
              <Select
                value={c.motion}
                onValueChange={(v) => v && changeChannel('motion', v)}
              >
                <SelectTrigger aria-label="Motion type">
                  <Activity size={16} />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem value={m} key={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="motion-context">
              {c.motion === 'Orbit' && s.morph === 0
                ? 'Orbit amplitude controls depth. Move the morph lever toward sphere to see its effect.'
                : linked
                  ? 'Channels share the selected motion settings and move together.'
                  : 'Tune the selected channel. Frequency and speed set its pace.'}
            </p>
            <div className="knob-row">
              <Knob
                label="Speed"
                value={c.speed}
                min={0}
                max={3}
                onChange={(v) => changeChannel('speed', v)}
                unit="×"
              />
              <Knob
                label="Amplitude"
                value={c.amplitude}
                onChange={(v) => changeChannel('amplitude', v)}
              />
              <Knob
                label="Frequency"
                value={c.frequency}
                min={0.01}
                max={1}
                onChange={(v) => changeChannel('frequency', v)}
                unit="Hz"
              />
              <Knob
                label="Phase"
                value={c.phase}
                min={0}
                max={360}
                step={1}
                precision={0}
                onChange={(v) => changeChannel('phase', v)}
                unit="°"
              />
            </div>
            <p className="panel-note">
              Drag a knob up or right to increase. Fine-tune with the slider or
              arrow keys.
            </p>
          </section>
          {fiveD && (
            <TimeCylinder
              feed={timelineFeed}
              settings={s}
              running={running}
              clearHistory={() => setHistoryClear((n) => n + 1)}
            />
          )}
          <section className="panel telemetry">
            <PanelHeading
              n="04"
              title="STATE VECTORS"
              side={<span className="unit-label">WORLD COORDINATES · u</span>}
            />
            <div className="coordinate-table">
              <table>
                <thead>
                  <tr>
                    <th>CHANNEL</th>
                    <th>X</th>
                    <th>Y</th>
                    <th>Z</th>
                    {s.fourD && <th>W</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.points.map((p, i) => (
                    <tr
                      key={i}
                      style={{ '--channel': COLORS[i] } as CSSProperties}
                    >
                      <th>
                        <span className="channel-dot" />
                        {'ABC'[i]}{' '}
                        <span className="channel-name">
                          {['AMBER', 'RED', 'PURPLE'][i]}
                        </span>
                      </th>
                      {p.slice(0, s.fourD ? 4 : 3).map((v, j) => (
                        <td key={j}>{F(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="distance-strip">
              {[
                [0, 1],
                [1, 2],
                [2, 0],
              ].map(([a, b]) => (
                <div key={a}>
                  <span>
                    <i style={{ background: COLORS[a] }} />
                    {'ABC'[a]}
                    <span className="distance-line" />
                    {'ABC'[b]}
                    <i style={{ background: COLORS[b] }} />
                  </span>
                  <output aria-live="off">
                    {distance(data.points[a], data.points[b]).toFixed(3)}
                    <small> u</small>
                  </output>
                </div>
              ))}
            </div>
            <p className="telemetry-note">
              {s.fourD
                ? 'Euclidean distances in 4D, before projection.'
                : 'Straight-line distances in space, not along the surface.'}
            </p>
          </section>
        </section>
        <aside className="control-column">
          <section className="panel dimensional-panel">
            <PanelHeading n="05" title="GEOMETRY CONTROL" />
            <div className="dimension-readout">
              <span>
                {fiveD
                  ? '5'
                  : s.fourD
                    ? '4'
                    : s.morph === 0
                      ? '2'
                      : s.morph === 1
                        ? '3'
                        : Math.round(s.morph * 100)}
                <small>
                  {s.fourD || s.morph === 0 || s.morph === 1 ? 'D' : '%'}
                </small>
              </span>
              <div>
                {fiveD
                  ? 'SPACE + TIME'
                  : s.fourD
                    ? 'HYPERSPHERE'
                    : s.morph < 0.01
                      ? 'CIRCLE'
                      : s.morph > 0.99
                        ? 'SPHERE'
                        : 'MORPHING'}
                <br />
                <small>
                  {fiveD
                    ? 'projected time views'
                    : s.fourD
                      ? 'projected space'
                      : 'morph position'}
                </small>
              </div>
            </div>
            <div className="morph-labels">
              <span>
                2D <small>CIRCLE</small>
              </span>
              <span>
                3D <small>SPHERE</small>
              </span>
            </div>
            <Range
              label="Morph lever"
              disabled={s.fourD}
              value={s.morph}
              onChange={(v) => {
                set('morph', v);
                setClear((n) => n + 1);
              }}
              format={(v) => `${Math.round(v * 100)}%`}
              className="morph-lever"
            />
            <div className="range-ticks">
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
            <Range
              label="Radius"
              value={s.radius}
              min={0.5}
              max={3}
              step={0.05}
              onChange={(v) => {
                set('radius', v);
                setClear((n) => n + 1);
              }}
              format={(v) => `${v.toFixed(2)} u`}
            />
            {s.fourD && (
              <details className="four-d-controls">
                <summary>4D rotation planes</summary>
                <p>
                  4D is shown through perspective projection into 3D, then onto
                  this 2D screen.
                </p>
                {(['xw', 'yw', 'zw'] as const).map((k) => (
                  <Range
                    key={k}
                    label={`${k.toUpperCase()} rotation`}
                    value={s[k]}
                    min={-180}
                    max={180}
                    step={1}
                    format={(v) => `${v}°`}
                    onChange={(v) => {
                      set(k, v);
                      setClear((n) => n + 1);
                    }}
                  />
                ))}
              </details>
            )}
          </section>
          <section className="panel optics-panel">
            <PanelHeading n="06" title="DISPLAY & ATTITUDE" />
            <div className="toggle-grid">
              <Toggle
                label="Mesh"
                checked={s.mesh}
                onChange={(v) => set('mesh', v)}
              />
              <Toggle
                label="Axes"
                checked={s.axes}
                onChange={(v) => set('axes', v)}
              />
              <Toggle
                label="Trails"
                checked={s.trails}
                onChange={(v) => {
                  set('trails', v);
                  setClear((n) => n + 1);
                }}
              />
              <Toggle
                label="Connect"
                checked={s.connections}
                onChange={(v) => set('connections', v)}
              />
            </div>
            <div className="optics-ranges">
              <Range
                label="Persistence"
                value={s.persistence}
                min={0.2}
                max={10}
                step={0.1}
                format={(v) => `${v.toFixed(1)} s`}
                onChange={(v) => set('persistence', v)}
              />
              <Range
                label="Phosphor glow"
                value={s.glow}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => set('glow', v)}
              />
            </div>
            <div className="camera-heading">
              <span>CAMERA ROTATION</span>
              <button
                onClick={() => setS((prev) => ({ ...prev, yaw: 0, pitch: 0 }))}
              >
                HOME <RotateCcw size={12} />
              </button>
            </div>
            <div className="camera-knobs">
              <Knob
                label="Azimuth"
                value={s.yaw}
                min={-180}
                max={180}
                step={1}
                precision={0}
                unit="°"
                onChange={(v) => set('yaw', v)}
              />
              <Knob
                label="Elevation"
                value={s.pitch}
                min={-90}
                max={90}
                step={1}
                precision={0}
                unit="°"
                onChange={(v) => set('pitch', v)}
              />
            </div>
          </section>
          <section className="panel presets-panel">
            <PanelHeading n="07" title="EXPERIMENT PRESETS" />
            <Select
              value={preset}
              onValueChange={(v) =>
                v && v !== 'Custom experiment' && applyPreset(v)
              }
            >
              <SelectTrigger aria-label="Experiment preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  'Custom experiment',
                  'Circle study',
                  'Spherical orbits',
                  'Lissajous study',
                  'Hyperspace',
                ].map((n) => (
                  <SelectItem value={n} key={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p>Load a starting point. Make it your own.</p>
          </section>
          <div className="calibration">
            <Radio size={18} />
            <span>
              p5.js engine<span>KINEMATIC MODEL · p5.js</span>
            </span>
            <i />
          </div>
        </aside>
      </div>
      {help && (
        <section className="panel field-notes">
          <div className="panel-heading">
            <h2>FIELD NOTES</h2>
            <button
              className="help-button"
              onClick={() => setHelp(false)}
              aria-label="Close field notes"
            >
              <X size={18} />
            </button>
          </div>
          <div className="notes-grid">
            <div>
              <h3>From a circle to a sphere</h3>
              <p>
                The lever opens latitude from 0 to ±π/2. Intermediate mesh
                states are spherical bands; at 100% they cover the sphere. The
                intermediate readout is morph percentage, not a fractional
                dimension.
              </p>
              <code>x² + y² + z² = R²</code>
            </div>
            <div>
              <h3>A window into 4D</h3>
              <p>
                The hypersphere has x² + y² + z² + w² = R². XW, YW and ZW
                rotations preserve this norm. A perspective factor 3R/(3R − w)
                projects it into 3D; the camera then projects orthographically
                onto the screen. The wireframe samples this surface.
              </p>
            </div>
            <div>
              <h3>Motion & measurement</h3>
              <p>
                Frequency is the base oscillator in Hz; speed multiplies
                simulation time. Orbit amplitude sets latitude and 4D depth; it
                has no effect on the flat circle. Phase sets the heading or
                harmonic offset. Pendulum is a sinusoidal angular model.
                Precession rotates a tilted orbital plane about the vertical
                axis. Lissajous uses bounded 2:3:4:5 harmonics inside the
                radius; breathing changes radial distance. Linking copies the
                selected channel to all points, so they move together and
                overlap.
              </p>
            </div>
            <div>
              <h3>Time as a fifth coordinate</h3>
              <p>
                The time cylinder adds simulation time to four spatial
                coordinates. Its cross-section is a selectable two-coordinate
                projection, not a fifth spatial dimension or a physical theory.
                Solid paths retain measured model positions; dashed paths
                evaluate the current equations at future times. Changing
                controls may jump the present, so new history segments start
                without drawing a false connecting path. Pause freezes time and
                recorded history while forecasts still respond to the controls.
                Clear history leaves the clock alone; Reset starts a fresh
                experiment.
              </p>
            </div>
            <div>
              <h3>Reading the torus</h3>
              <p>
                The torus bends the time axis around a ring. A fixed perspective
                9/(9 − w) projects x, y, z into 3D; two orthogonal oblique axes
                form the tube cross-section. The amber ring is now. A short rear
                arc blends the time-window ends to close the torus without
                changing recorded samples. The fourth view uses exact closed
                motion cycles with moving nodes. Its simulated-loop program
                modulates track excitation, radius, rotation and pace
                periodically. These are geometric motion models, not a
                gravitational flight simulator.
              </p>
            </div>
            <div>
              <h3>Instrument design</h3>
              <p>
                Controls are grouped by subsystem, with digital elapsed time and
                separate status annunciators, informed by{' '}
                <a
                  href="https://www.nasa.gov/wp-content/uploads/static/history/alsj/10_Displays_%26_Controls_pp83-86.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  Apollo displays and controls
                </a>{' '}
                and the{' '}
                <a
                  href="https://ntrs.nasa.gov/api/citations/19750012347/downloads/19750012347.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  Apollo crew-station report
                </a>
                .
              </p>
            </div>
            <div>
              <h3>At your fingertips</h3>
              <p>
                <kbd>SPACE</kbd> play / pause <kbd>N</kbd> step 1/60 s<br />
                <kbd>C</kbd> clear trails <kbd>R</kbd> reset
                <br />
                Tab to any control, then use arrow keys. Focus the scope and use
                arrows to rotate. Trail persistence is measured in simulation
                seconds, and freezes while paused.
              </p>
            </div>
          </div>
        </section>
      )}
      <footer>
        <span>
          <i /> GEOMETRY ENGINE ONLINE
        </span>
        <span>
          SPACE AGE <b>/</b> 4D SPACE / PROJECTED TIME
        </span>
        <span>
          {Math.round(data.fps)} FPS <b>·</b> p5.js
        </span>
      </footer>
    </main>
  );
}
