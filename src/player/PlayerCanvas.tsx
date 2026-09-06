import { useEffect, useMemo, useRef } from "react";
import type { Layout } from "../model/layout";
import type { Song } from "../model/song";
import { drawPlayerFrame } from "./drawPlayer";
import { placeNotes } from "./noteLayout";
import type { Transport } from "./transport";
import type { Scheduler } from "./scheduler";

interface Props {
  layout: Layout;
  song: Song | null;
  transport: Transport;
  scheduler: Scheduler;
  handHints?: boolean;
  /** Fraction of the canvas height given to the board. */
  boardFraction?: number;
  className?: string;
}

/**
 * The play surface: falling notes above, the tine board below, one canvas.
 * Redraws every animation frame from the transport's clock and drives the
 * audio scheduler from the same loop.
 */
export function PlayerCanvas({ layout, song, transport, scheduler, handHints, boardFraction = 0.46, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const placements = useMemo(() => (song ? placeNotes(song, layout) : []), [song, layout]);

  // Keep the latest props in a ref so the single rAF loop never goes stale.
  const frameRef = useRef({ layout, song, placements, handHints, boardFraction });
  frameRef.current = { layout, song, placements, handHints, boardFraction };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    let raf = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      transport.tick();
      scheduler.tick();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const f = frameRef.current;
      drawPlayerFrame(ctx, {
        layout: f.layout,
        song: f.song,
        placements: f.placements,
        now: transport.now(),
        width,
        height,
        boardHeight: Math.round(height * f.boardFraction),
        handHints: f.handHints,
      });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [transport, scheduler]);

  return <canvas ref={canvasRef} className={className} />;
}
