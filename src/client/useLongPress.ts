import { useRef } from 'react';

/**
 * Fires after the pointer has been held still for a moment. Used to reveal
 * secondary controls without cluttering the default view.
 */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const start = () => {
    fired.current = false;
    timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, ms);
  };
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };

  return {
    handlers: {
      onPointerDown: start,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onLongPress(); },
    },
    /** True if the last interaction was a long press, so a click can be ignored. */
    consumed: () => fired.current,
  };
}
