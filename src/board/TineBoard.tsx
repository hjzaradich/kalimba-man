import { useEffect, useRef } from "react";
import type { Layout } from "../model/layout";
import { drawBoard } from "./drawBoard";

interface Props {
  layout: Layout;
  className?: string;
}

/**
 * A canvas that always fills its container and redraws the board when the
 * layout or the container size changes. Handles HiDPI scaling.
 */
export function TineBoard({ layout, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const render = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBoard(ctx, layout, width, height);
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [layout]);

  return <canvas ref={canvasRef} className={className} />;
}
