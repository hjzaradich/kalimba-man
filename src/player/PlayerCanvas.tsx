import { useEffect, useMemo, useRef } from "react";
import type { Layout, Tine } from "../model/layout";
import type { Song } from "../model/song";
import { drawPlayerFrame } from "./drawPlayer";
import { playerTineAt } from "../board/hitTest";
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
  /**
   * Left click on a tine: play it. The tine comes from the layout the
   * click was tested against, so the pitch can never belong to an older
   * layout. Return false to skip the flash.
   */
  onTine?: (tine: Tine, index: number) => boolean | void;
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
/** How far, in pixels, a click may miss a tine and still pluck the nearest one. */
const CLICK_SLACK = 8;

export function PlayerCanvas({ layout, song, transport, scheduler, practice, onHit, onTine, handHints, boardFraction = 0.46, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** CSS size of the canvas, kept by the resize observer; clicks hit-test against it. */
  const sizeRef = useRef({ width: 0, height: 0 });
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
      sizeRef.current = { width, height };
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
      drawPlayerFrame(ctx, {
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

  // Pointer events cover mouse, trackpad, pen and touch alike. The tine is
  // found from the current layout and the canvas's own size, never from what
  // the last animation frame happened to draw, so a click straight after a
  // layout change or a resize lands where the eye says it should.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Take keyboard focus away from whatever toolbar control had it (a
    // kalimba picker left focused after a change swallows Space on WebKit).
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== e.currentTarget) active.blur();

    const rect = e.currentTarget.getBoundingClientRect();
    const { width, height } = sizeRef.current.width > 0 ? sizeRef.current : { width: rect.width, height: rect.height };
    const index = playerTineAt(layout, width, height, boardFraction, e.clientX - rect.left, e.clientY - rect.top, CLICK_SLACK);
    if (index !== null) {
      const tine = layout.tines[index];
      if (onTine?.(tine, index) !== false) flashes.current.push({ tine: index, at: performance.now() / 1000 });
      return;
    }
    onHit?.();
  };

  return <canvas ref={canvasRef} className={className} onPointerDown={onPointerDown} style={{ touchAction: "none" }} />;
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
