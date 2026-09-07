import { useEffect, useMemo, useRef } from "react";
import type { Layout } from "../model/layout";
import type { Song } from "../model/song";
import { drawPlayerFrame } from "./drawPlayer";
import { tineAt } from "../board/hitTest";
import type { BoardGeometry } from "../board/geometry";
import { placeNotes } from "./noteLayout";
import type { Transport } from "./transport";
import type { Scheduler } from "./scheduler";
import type { Practice } from "./practice";

interface Props {
  layout: Layout;
  song: Song | null;
  transport: Transport;
  scheduler: Scheduler;
  practice: Practice;
  /** Left click in the lane: a hit in wait/record mode, otherwise play/pause. */
  onHit?: () => void;
  /** Left click on a tine: play it. Return true to also flash the tine. */
  onTine?: (tineIndex: number) => boolean | void;
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
/** How long a clicked tine glows, in seconds. */
const FLASH_SECONDS = 0.35;

export function PlayerCanvas({ layout, song, transport, scheduler, practice, onHit, onTine, handHints, boardFraction = 0.46, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geoRef = useRef<{ geo: BoardGeometry; laneHeight: number } | null>(null);
  const flashes = useRef<{ tine: number; at: number }[]>([]);
  const placements = useMemo(() => (song ? placeNotes(song, layout) : []), [song, layout]);
  // Other tracks of a multi-track song, shifted like the active one, drawn faintly.
  const ghosts = useMemo(() => {
    if (!song?.tracks || song.tracks.length < 2) return null;
    const shift = song.fit ? song.fit.semitones + 12 * song.fit.octaves : 0;
    const notes = song.tracks.flatMap((t, i) => (i === song.activeTrack ? [] : t.notes.map((n) => ({ ...n, pitch: n.pitch + shift }))));
    const ghostSong = { ...song, notes };
    return { notes, placements: placeNotes(ghostSong, layout) };
  }, [song, layout]);

  // Keep the latest props in a ref so the single rAF loop never goes stale.
  const frameRef = useRef({ layout, song, placements, ghosts, handHints, boardFraction });
  frameRef.current = { layout, song, placements, ghosts, handHints, boardFraction };

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
      practice.tick();
      scheduler.tick();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const f = frameRef.current;
      const nowReal = performance.now() / 1000;
      flashes.current = flashes.current.filter((x) => nowReal - x.at < FLASH_SECONDS);
      const boardHeight = Math.round(height * f.boardFraction);
      const geo = drawPlayerFrame(ctx, {
        layout: f.layout,
        song: f.song,
        placements: f.placements,
        now: transport.now(),
        width,
        height,
        boardHeight,
        handHints: f.handHints,
        pending: practice.pendingNotes,
        hint: hintFor(practice) ?? leadInHint(transport.leadInRemaining(), transport.isPlaying),
        loop: transport.loop,
        extraHighlights: flashes.current.map((x) => ({ tine: x.tine, strength: 1 - (nowReal - x.at) / FLASH_SECONDS })),
        ghosts: f.ghosts,
      });
      geoRef.current = { geo, laneHeight: height - boardHeight };
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [transport, scheduler, practice]);

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const g = geoRef.current;
    if (g) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top - g.laneHeight;
      if (y >= 0) {
        const tine = tineAt(g.geo, x, y);
        if (tine !== null) {
          if (onTine?.(tine) !== false) flashes.current.push({ tine, at: performance.now() / 1000 });
          return;
        }
      }
    }
    onHit?.();
  };

  return <canvas ref={canvasRef} className={className} onMouseDown={onMouseDown} />;
}

/** Countdown during the silent lead-in before the first note, in real seconds. */
function leadInHint(remaining: number, playing: boolean): string | null {
  if (!playing || remaining <= 0) return null;
  return `Starting in ${Math.ceil(remaining)}…`;
}

function hintFor(practice: Practice): string | null {
  const s = practice.state;
  if (s.mode === "record") {
    return s.waiting ? `Recording ${s.next + 1} of ${s.total}: tap Space or click when you play it` : null;
  }
  if (s.mode === "wait" && s.waiting) return "Play it, then press Space or click";
  return null;
}
