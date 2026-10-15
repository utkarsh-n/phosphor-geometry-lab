'use client';
import { useRef, useState, type HTMLAttributes } from 'react';
import { normalizeCamera, type ViewCamera } from './view-camera';
export function useViewCamera(
  initialPitch = 35,
  controlledPitch?: { value: number; onChange: (pitch: number) => void },
) {
  const [state, setState] = useState<ViewCamera>({
    yaw: 0,
    pitch: initialPitch,
  });
  const camera = { ...state, pitch: controlledPitch?.value ?? state.pitch };
  const drag = useRef<{ x: number; y: number; camera: ViewCamera } | null>(
    null,
  );
  const update = (yaw: number, pitch: number) => {
    const next = normalizeCamera(yaw, pitch);
    setState(next);
    controlledPitch?.onChange(next.pitch);
  };
  const reset = () => update(0, initialPitch);
  const bind: HTMLAttributes<HTMLDivElement> = {
    tabIndex: 0,
    onPointerDown: (e) => {
      if (!e.isPrimary || e.button !== 0) return;
      e.currentTarget.focus({ preventScroll: true });
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, camera };
    },
    onPointerMove: (e) => {
      if (drag.current)
        update(
          drag.current.camera.yaw + (e.clientX - drag.current.x) * 0.45,
          drag.current.camera.pitch - (e.clientY - drag.current.y) * 0.45,
        );
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onLostPointerCapture: () => {
      drag.current = null;
    },
    onKeyDown: (e) => {
      const turns: Record<string, number[]> = {
        ArrowLeft: [-5, 0],
        ArrowRight: [5, 0],
        ArrowUp: [0, 5],
        ArrowDown: [0, -5],
      };
      if (turns[e.key]) {
        e.preventDefault();
        update(camera.yaw + turns[e.key][0], camera.pitch + turns[e.key][1]);
      }
      if (e.key === 'Home') {
        e.preventDefault();
        reset();
      }
    },
  };
  return { camera, bind, reset };
}
