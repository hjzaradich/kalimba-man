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
}

export interface PlayerTheme {
  laneBg: string;
  laneLine: string;
  hitLine: string;
  sectionLine: string;
  sectionText: string;
  noteLabel: string;
  unplayable: string;
}

export const PLAYER_THEME: PlayerTheme = {
  laneBg: "#14161c",
  laneLine: "rgba(255,255,255,0.05)",
  hitLine: "rgba(255,255,255,0.35)",
  sectionLine: "rgba(255,255,255,0.14)",
  sectionText: "#aeb4c4",
  noteLabel: "#14161c",
  unplayable: "#e0514f",
};

export function drawPlayerFrame(ctx: CanvasRenderingContext2D, f: PlayerFrame, theme = PLAYER_THEME): BoardGeometry {
  const laneHeight = f.height - f.boardHeight;
  const pxPerSecond = laneHeight / LOOKAHEAD_SECONDS;

  ctx.fillStyle = theme.laneBg;
  ctx.fillRect(0, 0, f.width, f.height);

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

  // The hit line itself, drawn across the lane so it reads as the target.
  ctx.strokeStyle = theme.hitLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, hitY);
  ctx.lineTo(f.width, hitY);
  ctx.stroke();

  // Section and lyric lines fall with the notes.
  const fontSize = labelFontSize(geo.laneWidth);
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

  for (let i = 0; i < f.song.notes.length; i++) {
    const n = f.song.notes[i];
    const place = f.placements[i];
    const tineIndex = place.tine ?? place.nearest;
    const g = geo.tines[tineIndex];
    const bottom = yFor(n.time);
    const top = bottom - Math.max(n.duration * pxPerSecond, noteWidth * 0.8);
    // Once landed, the block sinks through the line: only the part still above it is drawn.
    if (bottom < -4 || top >= hitY) continue;
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

  for (const v of visible) {
    const n = f.song.notes[v.i];
    const landed = f.now >= n.time;
    const h = v.bottom - v.top;
    if (h <= 0) continue;
    ctx.globalAlpha = landed ? 0.5 : 1;
    ctx.fillStyle = v.color;
    roundedRect(ctx, v.x - noteWidth / 2, v.top, noteWidth, h, Math.min(6, noteWidth / 3));
    ctx.fill();
    if (!v.playable) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (f.handHints) {
      const left = v.x < f.width / 2;
      ctx.fillStyle = left ? "rgba(90,160,255,0.9)" : "rgba(255,120,90,0.9)";
      ctx.fillRect(left ? v.x - noteWidth / 2 : v.x + noteWidth / 2 - 3, v.top, 3, h);
    }
    // Label near the leading (bottom) edge so it is read just before landing.
    const tine = f.layout.tines[v.tine];
    const labelY = v.bottom - Math.max(fontSize * 0.9, 10);
    if (labelY > v.top - 2) {
      drawTineLabel(ctx, v.x, labelY, v.playable ? tine.label : "?", v.playable ? tine.octaveDots : 0, Math.min(fontSize, noteWidth * 0.9), theme.noteLabel);
    }
    ctx.globalAlpha = 1;
  }

  return geo;
}
