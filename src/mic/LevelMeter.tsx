import { useEffect, useRef } from "react";
import type { Listener } from "./listener";
import { toBar } from "./level";

/**
 * The input level next to the score-mode toggle, so the user can see the
 * app is hearing them. Reads the listener's meter every frame and moves
 * the bar directly; no React state at 60 Hz.
 */
export function LevelMeter({ listener }: { listener: Listener }) {
  const root = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const peak = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const l = listener.meter.current;
      if (fill.current) fill.current.style.width = `${toBar(l.rms) * 100}%`;
      if (peak.current) peak.current.style.left = `${toBar(l.peak) * 100}%`;
      root.current?.classList.toggle("is-clipping", l.clipping);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [listener]);

  return (
    <div ref={root} className="meter" title="Microphone level" role="meter" aria-label="Microphone level">
      <div ref={fill} className="meter__fill" />
      <div ref={peak} className="meter__peak" />
    </div>
  );
}
