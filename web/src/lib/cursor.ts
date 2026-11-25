// Shared singleton pointer tracker so all 3D Otto spheres share ONE passive listener.

export interface CursorPoint {
  x: number;
  y: number;
  active: boolean;
}

type Listener = (pt: CursorPoint) => void;

const state: CursorPoint = { x: 0, y: 0, active: false };
const listeners = new Set<Listener>();
let attached = false;

function handleMove(e: PointerEvent) {
  state.x = e.clientX;
  state.y = e.clientY;
  state.active = true;
  for (const fn of listeners) fn(state);
}

function handleLeave() {
  state.active = false;
  for (const fn of listeners) fn(state);
}

function attach() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("pointermove", handleMove, { passive: true });
  window.addEventListener("pointerleave", handleLeave, { passive: true });
}

function detachIfUnused() {
  if (!attached || listeners.size > 0 || typeof window === "undefined") return;
  attached = false;
  window.removeEventListener("pointermove", handleMove);
  window.removeEventListener("pointerleave", handleLeave);
}

export function subscribeCursor(fn: Listener): () => void {
  listeners.add(fn);
  attach();
  if (state.active) fn(state);
  return () => {
    listeners.delete(fn);
    detachIfUnused();
  };
}
