'use client';
import type p5 from 'p5';
import { useSketchState } from './use-sketch-state';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Settings } from './geometry';
import { useViewCamera } from './use-view-camera';
import { projectView, viewScale } from './view-camera';
import type { TimelineFeed } from './timeline';
import { closedTubePoint, TUBE_RADIUS, type Vec3 } from './torus';
import {
  trackPoint,
  naturalPhase,
  trackShapeKey,
  loopSettings,
  loopPhase,
  loopPresets,
  modulo,
  type LoopProgram,
} from './tracks';

const COLORS = ['#ffbf5e', '#ff6676', '#c69bff'];
export function OrbitalTracks({
  feed,
  settings,
  running,
}: {
  feed: RefObject<TimelineFeed>;
  settings: Settings;
  running: boolean;
}) {
  const view = useViewCamera(40);
  const [enabled, setEnabled] = useState(false),
    [program, setProgram] = useState<LoopProgram>({
      ...loopPresets['Orbital cadence'],
    }),
    [preset, setPreset] = useState('Orbital cadence');
  const [readout, setReadout] = useState({
    progress: 0,
    phases: [0, 0, 0],
    radius: settings.radius,
    excitation: settings.channels[0].amplitude,
  });
  const [error, setError] = useState('');
  const host = useRef<HTMLDivElement>(null),
    epoch = useRef(0),
    origins = useRef([0, 0, 0]);
  const latest = useSketchState({
    settings,
    enabled,
    program,
    camera: view.camera,
  });
  const restart = () => {
    epoch.current = feed.current.t;
    origins.current = [0, 1, 2].map((i) =>
      naturalPhase(feed.current.t, i, settings),
    );
  };
  const setRate = (key: keyof LoopProgram, value: number) => {
    setPreset('Custom sequence');
    setProgram((old) => ({ ...old, [key]: value }));
  };
  useEffect(() => {
    let disposed = false,
      instance: p5 | undefined,
      resize: ResizeObserver,
      visibility: IntersectionObserver,
      visible = true;
    let cachedShape = '',
      tracks: Vec3[][] = [],
      lastFrame = '';
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
              'Orbital phase tracks. Amber, red and purple nodes travel around fixed closed paths. Controls reshape the tracks; the optional simulated loop repeats programmed excitation, radius, rotation and pace changes.',
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
              lastFrame = '';
            });
            visibility.observe(host.current!);
          };
          p.draw = () => {
            if (!visible) return;
            const {
                settings: base,
                enabled: loop,
                program,
                camera,
              } = latest.current,
              now = feed.current.t;
            if (now < epoch.current) {
              epoch.current = now;
              origins.current = [0, 1, 2].map((i) =>
                naturalPhase(now, i, base),
              );
            }
            const u = modulo((now - epoch.current) / program.duration),
              s = loop ? loopSettings(base, u, program) : base;
            const phases = [0, 1, 2].map((i) =>
              loop
                ? loopPhase(u, i, origins.current[i], program)
                : naturalPhase(now, i, base),
            );
            const key = JSON.stringify([
              now,
              epoch.current,
              origins.current,
              base,
              program,
              camera,
              loop,
              p.width,
              p.height,
            ]);
            if (key === lastFrame) return;
            lastFrame = key;
            const shape = trackShapeKey(s);
            if (shape !== cachedShape) {
              tracks = [0, 1, 2].map((i) =>
                Array.from({ length: 321 }, (_, j) =>
                  trackPoint(j / 320, i, s),
                ),
              );
              cachedShape = shape;
            }
            const cx = p.width / 2,
              cy = p.height * 0.48,
              scale = viewScale(p.width, p.height);
            const screen = (v: Vec3): [number, number] => {
              const a = projectView(v, camera);
              return [cx + a[0] * scale, cy + a[1] * scale];
            };
            const path = (vs: Vec3[]) => {
              p.beginShape();
              for (const v of vs) p.vertex(...screen(v));
              p.endShape();
            };
            const ctx = p.drawingContext as CanvasRenderingContext2D;
            p.background('#060d0c');
            ctx.shadowBlur = 0;
            ctx.setLineDash([]);
            p.strokeWeight(1);
            p.noFill();
            p.stroke(45, 77, 62, 65);
            for (let x = cx % 32; x < p.width; x += 32)
              p.line(x, 0, x, p.height);
            for (let y = cy % 32; y < p.height; y += 32)
              p.line(0, y, p.width, y);
            p.stroke(85, 162, 109, 45);
            for (let j = 0; j < 6; j++) {
              const a = (j / 6) * Math.PI * 2;
              path(
                Array.from({ length: 129 }, (_, i) =>
                  closedTubePoint(
                    i / 128,
                    TUBE_RADIUS * Math.cos(a),
                    TUBE_RADIUS * Math.sin(a),
                  ),
                ),
              );
            }
            for (let j = 0; j < 16; j++)
              path(
                Array.from({ length: 41 }, (_, i) =>
                  closedTubePoint(
                    j / 16,
                    TUBE_RADIUS * Math.cos((i / 40) * Math.PI * 2),
                    TUBE_RADIUS * Math.sin((i / 40) * Math.PI * 2),
                  ),
                ),
              );
            for (let i = 0; i < 3; i++) {
              const color = p.color(COLORS[i]);
              color.setAlpha(145);
              p.stroke(color);
              p.strokeWeight(1.6);
              p.noFill();
              ctx.shadowColor = COLORS[i];
              ctx.shadowBlur = s.glow * 4;
              path(tracks[i]);
              const phase = modulo(phases[i]);
              p.stroke(COLORS[i]);
              p.strokeWeight(2.6);
              path(
                Array.from({ length: 15 }, (_, j) =>
                  trackPoint(phase - 0.028 + (j / 14) * 0.028, i, s),
                ),
              );
              const pos = screen(trackPoint(phase, i, s));
              ctx.shadowBlur = 8 + s.glow * 14;
              p.noStroke();
              p.fill(COLORS[i]);
              p.circle(...pos, 8);
              p.fill('#fff4d6');
              p.circle(...pos, 3);
              p.noFill();
              p.stroke(COLORS[i]);
              p.strokeWeight(1);
              p.circle(...pos, 17);
              ctx.shadowBlur = 0;
              p.noStroke();
              p.fill(COLORS[i]);
              p.textSize(12);
              p.textFont('monospace');
              p.text('ABC'[i], pos[0] + 12, pos[1] - 10);
            }
            ctx.shadowBlur = 0;
            p.noStroke();
            p.fill('#98b3a2');
            p.textFont('monospace');
            p.textSize(11);
            p.textAlign(p.LEFT);
            p.text(
              loop
                ? 'PROGRAMMED TRACK SIMULATION'
                : 'FIXED TRACKS · LIVE NODES',
              16,
              23,
            );
            p.textAlign(p.RIGHT);
            p.fill('#e2b576');
            p.text(
              loop ? `${program.duration}s REPEAT` : 'CYCLE PHASE',
              p.width - 16,
              p.height - 17,
            );
            setReadout({
              progress: loop ? u : 0,
              phases: phases.map((v) => modulo(v)),
              radius: s.radius,
              excitation: s.channels[0].amplitude,
            });
          };
        }, host.current);
      })
      .catch(() =>
        setError('The orbital track display could not start. Reload to retry.'),
      );
    return () => {
      disposed = true;
      resize?.disconnect();
      visibility?.disconnect();
      instance?.remove();
    };
  }, [feed, latest]);
  const rateControl = (
    label: string,
    key: keyof LoopProgram,
    min: number,
    max: number,
    step = 1,
    unit = ' / loop',
  ) => (
    <div className="sequence-range">
      <div className="control-label">
        <label>{label}</label>
        <output aria-live="off">
          {key === 'depth'
            ? `${Math.round(program[key] * 100)}%`
            : `${program[key]}${unit}`}
        </output>
      </div>
      <Slider
        aria-label={`Loop ${label.toLowerCase()}`}
        min={min}
        max={max}
        step={step}
        value={[program[key]]}
        onValueChange={(v) => setRate(key, Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
  return (
    <section className="track-section" aria-label="Orbital track simulation">
      <div className="track-header">
        <div>
          <span>04 / ORBITAL TRACKS</span>
          <h3>Fixed paths. Moving particles.</h3>
        </div>
        <div className="toggle-label">
          <Switch
            aria-label="Simulated loop"
            checked={enabled}
            onCheckedChange={(v) => {
              restart();
              setEnabled(v);
            }}
          />
          <span>Simulated loop</span>
        </div>
      </div>
      <div className="track-layout">
        <div className="track-display">
          <div className="view-toolbar">
            <span>Drag to rotate</span>
            <button
              className="chart-reset"
              onClick={view.reset}
              aria-label="Reset orbital tracks view"
            >
              RESET VIEW
            </button>
          </div>
          <div className="time-screen track-screen">
            <div
              className="time-canvas rotatable-canvas"
              ref={host}
              {...view.bind}
              role="application"
              aria-roledescription="interactive 3D view"
              aria-label="Orbital tracks. Drag or use arrow keys to rotate. Home resets the view."
            />
            <div className="scanlines" />
            {error && <p className="scope-error">{error}</p>}
          </div>
          <div className="camera-readout">
            YAW {view.camera.yaw.toFixed(0)}° / TILT{' '}
            {view.camera.pitch.toFixed(0)}°
          </div>
          <div className="track-phases">
            {readout.phases.map((phase, i) => (
              <div key={i}>
                <span style={{ color: COLORS[i] }}>{'ABC'[i]}</span>
                <div className="phase-track">
                  <i
                    style={{ width: `${phase * 100}%`, background: COLORS[i] }}
                  />
                </div>
                <output aria-live="off">{Math.round(phase * 100)}%</output>
              </div>
            ))}
          </div>
          <p className="chart-caption">
            {enabled
              ? 'The loop program sets pace. Shape knobs remain live.'
              : 'Channel frequency and speed set the pace. Shape controls deform the track.'}
          </p>
        </div>
        <div className="sequence-controls">
          <div className="sequence-heading">
            <h4>LOOP PROGRAM</h4>
            <span className={`annunciator ${enabled ? 'run' : 'hold'}`}>
              {enabled ? (running ? 'RUN' : 'HOLD') : 'READY'}
            </span>
          </div>
          <Select
            value={preset}
            onValueChange={(v) => {
              if (v && loopPresets[v]) {
                setPreset(v);
                setProgram({ ...loopPresets[v] });
                restart();
              }
            }}
          >
            <SelectTrigger aria-label="Simulated loop preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['Custom sequence', ...Object.keys(loopPresets)].map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="sequence-grid">
            {rateControl('Duration', 'duration', 4, 60, 1, ' s')}
            {rateControl('Base laps', 'laps', 1, 8, 1, '')}
            {rateControl('Pace cycles', 'pace', 0, 6)}
            {rateControl('Excitation cycles', 'excitation', 0, 6)}
            {rateControl('Radius cycles', 'radius', 0, 6)}
            {rateControl('Rotation cycles', 'rotation', 0, 6)}
          </div>
          {rateControl('Modulation depth', 'depth', 0, 1, 0.05, '')}
          <div className="sequence-progress">
            <div>
              <span>LOOP PHASE</span>
              <output aria-live="off">
                {(readout.progress * program.duration).toFixed(1)} /{' '}
                {program.duration} s
              </output>
            </div>
            <div className="phase-track">
              <i style={{ width: `${readout.progress * 100}%` }} />
            </div>
          </div>
          <button className="button" onClick={restart}>
            RESTART LOOP
          </button>
        </div>
      </div>
      <div className="track-values">
        <span>
          TRACK RADIUS{' '}
          <output aria-live="off">{readout.radius.toFixed(2)} u</output>
        </span>
        <span>
          A EXCITATION{' '}
          <output aria-live="off">{readout.excitation.toFixed(2)}</output>
        </span>
        <span>
          LAPS A / B / C{' '}
          <output aria-live="off">
            {program.laps} / {program.laps + 1} / {program.laps + 2}
          </output>
        </span>
      </div>
      <p className="track-note">
        Set the rates, then enable Simulated loop. Rates are cycles per loop; 0
        holds that parameter. The program modulates this track view only. Global
        play, pause and step control its clock.
      </p>
    </section>
  );
}
