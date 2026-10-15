import { useLayoutEffect, useRef } from 'react';

// p5 reads the latest committed React controls without rebuilding its canvas.
export function useSketchState<T>(value: T) {
  const state = useRef(value);
  useLayoutEffect(() => {
    state.current = value;
  }, [value]);
  return state;
}
