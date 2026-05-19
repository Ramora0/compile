/**
 * Anchor registry: lets any DOM element register itself by ID and lets
 * the animation layer look up its position in canvas-local coordinates.
 *
 * The Stage's `.cp-canvas` is a fixed 1920×1200 box that's centered and
 * scaled into the viewport via CSS transform. Anchors compute their
 * rect in that 1920×1200 space so the animation overlay (which lives
 * inside .cp-canvas) can place ghosts using design-space pixels.
 */

import { createContext, useCallback, useContext, useEffect, useRef } from "react";

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Center in canvas-local coords. */
  cx: number;
  cy: number;
}

interface AnchorRegistry {
  register: (id: string, el: Element | null) => void;
  get: (id: string) => AnchorRect | null;
  /** Set by Stage so coords can be converted from viewport → canvas-local. */
  setCanvas: (el: HTMLElement | null) => void;
}

const noopCtx: AnchorRegistry = {
  register: () => {},
  get: () => null,
  setCanvas: () => {},
};

export const AnchorCtx = createContext<AnchorRegistry>(noopCtx);

export function AnchorProvider({ children }: { children: React.ReactNode }) {
  const elsRef = useRef<Map<string, Element>>(new Map());
  const canvasRef = useRef<HTMLElement | null>(null);

  const register = useCallback((id: string, el: Element | null) => {
    if (el) {
      elsRef.current.set(id, el);
    } else {
      elsRef.current.delete(id);
    }
  }, []);

  const setCanvas = useCallback((el: HTMLElement | null) => {
    canvasRef.current = el;
  }, []);

  const get = useCallback((id: string): AnchorRect | null => {
    const el = elsRef.current.get(id);
    const canvas = canvasRef.current;
    if (!el || !canvas) return null;
    const er = el.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    // canvas is rendered at scale s = cr.width / 1920
    const s = cr.width / 1920;
    if (s <= 0) return null;
    const left = (er.left - cr.left) / s;
    const top = (er.top - cr.top) / s;
    const width = er.width / s;
    const height = er.height / s;
    return { left, top, width, height, cx: left + width / 2, cy: top + height / 2 };
  }, []);

  const value = useRef<AnchorRegistry>({ register, get, setCanvas }).current;
  return <AnchorCtx.Provider value={value}>{children}</AnchorCtx.Provider>;
}

/**
 * Returns a ref-callback. Pass it to the `ref` prop of any DOM element to
 * register it under `id`. Passing `null`/empty id skips registration.
 */
export function useAnchor(id: string | null | undefined): (el: Element | null) => void {
  const { register } = useContext(AnchorCtx);
  const idRef = useRef<string | null>(id ?? null);

  // If id changes, unregister the previous one on unmount.
  useEffect(() => {
    idRef.current = id ?? null;
    return () => {
      if (idRef.current) register(idRef.current, null);
    };
  }, [id, register]);

  return useCallback(
    (el: Element | null) => {
      if (!id) return;
      register(id, el);
    },
    [id, register],
  );
}

export function useAnchorRegistry(): AnchorRegistry {
  return useContext(AnchorCtx);
}
