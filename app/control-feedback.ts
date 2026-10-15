import type { MouseEvent } from 'react';
export function animateControl(event: MouseEvent<HTMLElement>) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button',
  );
  if (
    !target ||
    target.disabled ||
    target.getAttribute('aria-disabled') === 'true'
  )
    return;
  for (const animation of target.getAnimations())
    if (animation.id === 'control-feedback') animation.cancel();
  const pulse = target.animate(
    [
      { filter: 'brightness(1)' },
      { filter: 'brightness(1.22)', offset: 0.25 },
      { filter: 'brightness(1)' },
    ],
    { duration: 260, easing: 'ease-out' },
  );
  pulse.id = 'control-feedback';
}
