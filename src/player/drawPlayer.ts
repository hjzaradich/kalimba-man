// Paints one frame of the player: the lane area with falling notes above,
// the tine board below, notes landing on the tips. DESIGN.md §8.

import { drawBoard, roundedRect, type BoardHighlight } from "../board/drawBoard";
import type { BoardGeometry } from "../board/geometry";
import { drawTineLabel, labelFontSize } from "../board/labels";
import type { Layout } from "../model/layout";
import type { Song } from "../model/song";
import type { NotePlacement } from "./noteLayout";

/** Seconds of upcoming song visible above the tips at any tempo. */
export const LOOKAHEAD_SECONDS = 4;
/** How long a tine glows after its note lands, in song seconds. */
const GLOW_SECONDS = 0.35;

export interface PlayerFrame {
  layout: Layout;
  song: Song | null;
  placements: NotePlacement[];
  /** Song time in seconds. */
  now: number;
  width: number;
  height: number;
  /** Height of the board at the bottom of the canvas. */
  boardHeight: number;
  handHints?: boolean;
  /** Note indices being held for the user's hit (wait/record mode). */
  pending?: number[];
  /** What to tell the user while holding. */
  hint?: string | null;
  loop?: { a: number; b: number } | null;
  /** Extra tine glows, e.g. from clicking a tine. */
  extraHighlights?: BoardHighlight[];
}

export interface PlayerTheme {
  laneBg: string;
  laneLine: string;
  hitLine: string;
  sectionLine: string;
  sectionText: string;
  noteLabel: string;
  unplayable: string;
  loopLine: string;
  pending: string;
  /** Tints for the left- and right-thumb halves of the lane. */
  laneLeft: string;
  laneRight: string;
}

export const PLAYER_THEME: PlayerTheme = {
  laneBg: "#14161c",
  laneLine: "rgba(255,255,255,0.05)",
  hitLine: "rgba(255,255,255,0.35)",
  sectionLine: "rgba(255,255,255,0.14)",
  sectionText: "#aeb4c4",
  noteLabel: "#14161c",
  unplayable: "#e0514f",
  loopLine: "rgba(242,178,92,0.6)",
  pending: "#ffffff",
  laneLeft: "rgba(70,150,255,0.06)",
  laneRight: "rgba(255,110,70,0.06)",
};

export function drawPlayerFrame(ctx: CanvasRenderingContext2D, f: PlayerFrame, theme = PLAYER_THEME): BoardGeometry {
  const laneHeight = f.height - f.boardHeight;
  const pxPerSecond = laneHeight / LOOKAHEAD_SECONDS;

  ctx.fillStyle = theme.laneBg;
  ctx.fillRect(0, 0, f.width, f.height);
  // The two halves of the lane, one per thumb.
  ctx.fillStyle = theme.laneLeft;
  ctx.fillRect(0, 0, f.width / 2, laneHeight);
  ctx.fillStyle = theme.laneRight;
  ctx.fillRect(f.width / 2, 0, f.width / 2, laneHeight);

  // Highlights: tines whose notes landed within the last GLOW_SECONDS.
  const highlights: BoardHighlight[] = [];
  if (f.song) {
    for (let i = 0; i < f.song.notes.length; i++) {
      const n = f.song.notes[i];
      const age = f.now - n.time;
      if (age >= 0 && age < GLOW_SECONDS) {
        const tine = f.placements[i].tine;
        if (tine !== null) highlights.push({ tine, strength: 1 - age / GLOW_SECONDS });
      }
    }
  }

  if (f.extraHighlights) highlights.push(...f.extraHighlights);
  const geo = drawBoard(ctx, f.layout, f.width, f.boardHeight, laneHeight, highlights);

  // Faint lane guides so the eye can follow a lane up from the tip.
  ctx.strokeStyle = theme.laneLine;
  ctx.lineWidth = 1;
  for (const g of geo.tines) {
    ctx.beginPath();
    ctx.moveTo(g.cx, 0);
    ctx.lineTo(g.cx, laneHeight);
    ctx.stroke();
  }

  if (!f.song) return geo;

  // Every note lands on the bridge line, whatever tier its tine is on.
  const hitY = laneHeight + geo.hitY;
  // Where a note at song time t has its bottom edge.
  const yFor = (t: number) => hitY - (t - f.now) * pxPerSecond;

  const fontSize = labelFontSize(geo.laneWidth);

  // Loop bounds fall with the notes too.
  if (f.loop) {
    for (const [label, t] of [["A", f.loop.a], ["B", f.loop.b]] as const) {
      const y = yFor(t);
      if (y < -20 || y > hitY + 20) continue;
      ctx.strokeStyle = theme.loopLine;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(f.width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = theme.loopLine;
      ctx.font = `700 12px system-ui, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`Loop ${label}`, f.width - 10, y - 3);
    }
  }

  // Section and lyric lines fall with the notes.
  for (const s of f.song.sections) {
    const y = yFor(s.time);
    if (y < -20 || y > hitY + 20) continue;
    ctx.strokeStyle = theme.sectionLine;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(f.width, y);
    ctx.stroke();
    ctx.fillStyle = theme.sectionText;
    ctx.font = `${s.marker ? "700" : "400"} ${Math.max(11, fontSize * 0.85)}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(s.label, 10, y - 3);
  }

  // Notes. Draw chords' connectors first so blocks sit on top of them.
  const noteWidth = Math.min(geo.laneWidth * 0.8, Math.max(geo.laneWidth * 0.55, 14));
  const chordBottoms = new Map<number, { x1: number; x2: number; y: number }>();
  const visible: { i: number; x: number; top: number; bottom: number; color: string; playable: boolean; tine: number }[] = [];
  const pending = new Set(f.pending ?? []);

  for (let i = 0; i < f.song.notes.length; i++) {
    const n = f.song.notes[i];
    const place = f.placements[i];
    const tineIndex = place.tine ?? place.nearest;
    const g = geo.tines[tineIndex];
    const bottom = yFor(n.time);
    const top = bottom - Math.max(n.duration * pxPerSecond, noteWidth * 0.8);
    // Once landed, the block sinks through the line: only the part still above it is drawn.
    // A pending note is held on the line instead.
    if (!pending.has(i) && (bottom < -4 || top >= hitY)) continue;
    const color = place.tine === null ? theme.unplayable : f.layout.layers[g.layer].color;
    visible.push({ i, x: g.cx, top, bottom: Math.min(bottom, hitY), color, playable: place.tine !== null, tine: tineIndex });
    if (n.chord !== undefined) {
      const c = chordBottoms.get(n.chord);
      if (!c) chordBottoms.set(n.chord, { x1: g.cx, x2: g.cx, y: bottom });
      else {
        c.x1 = Math.min(c.x1, g.cx);
        c.x2 = Math.max(c.x2, g.cx);
      }
    }
  }

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  for (const c of chordBottoms.values()) {
    if (c.x2 - c.x1 < 1) continue;
    if (c.y > hitY) continue;
    const y = c.y;
    ctx.beginPath();
    ctx.moveTo(c.x1, y - 2);
    ctx.lineTo(c.x2, y - 2);
    ctx.stroke();
  }

  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
  for (const v of visible) {
    const n = f.song.notes[v.i];
    const isPending = pending.has(v.i);
    const landed = !isPending && f.now >= n.time;
    const h = v.bottom - v.top;
    if (h <= 0) continue;
    ctx.globalAlpha = landed ? 0.5 : 1;
    ctx.fillStyle = v.color;
    roundedRect(ctx, v.x - noteWidth / 2, v.top, noteWidth, h, Math.min(6, noteWidth / 3));
    ctx.fill();
    if (isPending) {
      ctx.strokeStyle = theme.pending;
      ctx.lineWidth = 2 + 2 * pulse;
      ctx.stroke();
    }
    if (!v.playable) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (f.handHints) {
      // Left thumb: blue, right thumb: orange. A wide band on the thumb's
      // side plus a full outline, so it reads at a glance on any tier colour.
      const left = v.x < f.width / 2;
      const hand = left ? "rgba(70,150,255,0.95)" : "rgba(255,110,70,0.95)";
      const band = Math.max(5, noteWidth * 0.3);
      ctx.save();
      roundedRect(ctx, v.x - noteWidth / 2, v.top, noteWidth, h, Math.min(6, noteWidth / 3));
      ctx.clip();
      ctx.fillStyle = hand;
      ctx.fillRect(left ? v.x - noteWidth / 2 : v.x + noteWidth / 2 - band, v.top, band, h);
      ctx.restore();
      ctx.strokeStyle = hand;
      ctx.lineWidth = 3;
      roundedRect(ctx, v.x - noteWidth / 2 + 1.5, v.top + 1.5, noteWidth - 3, h - 3, Math.min(5, noteWidth / 3));
      ctx.stroke();
    }
    // Label near the leading (bottom) edge so it is read just before landing.
    const tine = f.layout.tines[v.tine];
    const labelY = v.bottom - Math.max(fontSize * 0.9, 10);
    if (labelY > v.top - 2) {
      drawTineLabel(ctx, v.x, labelY, v.playable ? tine.label : "?", v.playable ? tine.octaveDots : 0, Math.min(fontSize, noteWidth * 0.9), theme.noteLabel);
    }
    ctx.globalAlpha = 1;
  }

  if (f.hint) {
    ctx.fillStyle = "rgba(20,22,28,0.85)";
    ctx.font = `600 14px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(f.hint).width + 24;
    roundedRect(ctx, f.width / 2 - w / 2, hitY - 44, w, 28, 8);
    ctx.fill();
    ctx.fillStyle = theme.pending;
    ctx.fillText(f.hint, f.width / 2, hitY - 30);
  }

  return geo;
}
