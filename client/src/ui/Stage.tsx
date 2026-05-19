import { useContext, useEffect, useRef, type ReactNode } from "react";
import { AnchorCtx } from "./anchors.js";

// Scales a fixed 1920×1200 canvas into the viewport, preserving aspect ratio.
// Centered with letterbox.
export function Stage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { setCanvas } = useContext(AnchorCtx);

  useEffect(() => {
    const apply = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const s = Math.min(W / 1920, H / 1200);
      stageRef.current?.style.setProperty("--cp-scale", s.toString());
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  useEffect(() => {
    setCanvas(canvasRef.current);
    return () => setCanvas(null);
  }, [setCanvas]);

  return (
    <div className="cp-stage cp-scanlines" ref={stageRef}>
      <div className="cp-canvas" ref={canvasRef}>{children}</div>
    </div>
  );
}
