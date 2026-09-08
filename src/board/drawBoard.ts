// Canvas rendering of the tine board. Geometry comes from geometry.ts; this
// file only paints.

import type { Layout } from "../model/layout";
import { computeBoardGeometry, type BoardGeometry, type TineGeometry } from "./geometry";
import { drawTineLabel, labelFontSize } from "./labels";

export interface BoardTheme {
  wood: string;
  woodEdge: string;
  bridge: string;
  labelOnTine: string;
}

export const DEFAULT_THEME: BoardTheme = {
  wood: "#5a3426",
  woodEdge: "#3d2118",
  bridge: "#a0a2ac",
  labelOnTine: "#1c1f26",
};

/** Bridge bar thickness in pixels; it straddles the hit line. */
export const BRIDGE_THICKNESS = 10;
/** Height of the glow that fades upward from the bridge into the lane. */
export const BRIDGE_GLOW = 48;

export interface BoardHighlight {
  /** Index into layout.tines. */
  tine: number;
  /** 0..1, fades the glow. */
  strength: number;
  /** Glow colour; white when absent. A heard note glows in its own colour. */
  color?: string;
}

/**
 * Paint the board into a `width` x `height` rectangle whose top-left is at
 * (0, `originY`) in the current canvas coordinates. Returns the geometry so
 * callers can place falling notes on the tips.
 */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  width: number,
  height: number,
  originY = 0,
  highlights: BoardHighlight[] = [],
  theme: BoardTheme = DEFAULT_THEME,
): BoardGeometry {
  const geo = computeBoardGeometry(layout, width, height);
  ctx.save();
  ctx.translate(0, originY);

  drawBody(ctx, geo, theme);

  // Nothing of the instrument shows above the bridge.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, geo.hitY, geo.width, geo.height - geo.hitY);
  ctx.clip();

  const glow = new Map<number, BoardHighlight>();
  for (const h of highlights) {
    const prev = glow.get(h.tine);
    if (!prev || h.strength > prev.strength) glow.set(h.tine, h);
  }

  // Bottom tier first. Each tier above is physically on top, so it is painted
  // later and covers the upper part of whatever sits beneath it. Its tips end
  // higher (geometry.ts), which keeps every tine's tip and label visible.
  const byTierBottomUp = [...geo.layers].sort((a, b) => a.layer - b.layer);
  for (const layer of byTierBottomUp) {
    const style = layout.layers[layer.layer];
    for (const g of geo.tines) {
      if (g.layer !== layer.layer) continue;
      const tine = layout.tines[g.index];
      drawTine(ctx, g, style.color, glow.get(g.index));
      drawLabel(ctx, g, tine.label, tine.octaveDots, geo.laneWidth, theme, style.color);
    }
  }
  ctx.restore();
  // One bridge bar over every tier: the line notes land on, with a glow
  // rising into the lane above it.
  drawBridge(ctx, geo.hitY, geo.width, theme);
  ctx.restore();
  return geo;
}

/** The soundboard, from the bridge down, rounded only at the bottom. */
function drawBody(ctx: CanvasRenderingContext2D, geo: BoardGeometry, theme: BoardTheme) {
  const r = Math.min(24, geo.width * 0.04);
  const top = geo.hitY;
  const h = geo.height - top - 1;
  ctx.fillStyle = theme.wood;
  ctx.strokeStyle = theme.woodEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, top);
  ctx.lineTo(geo.width - 1, top);
  ctx.lineTo(geo.width - 1, top + h - r);
  ctx.quadraticCurveTo(geo.width - 1, top + h, geo.width - 1 - r, top + h);
  ctx.lineTo(1 + r, top + h);
  ctx.quadraticCurveTo(1, top + h, 1, top + h - r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawBridge(ctx: CanvasRenderingContext2D, y: number, width: number, theme: BoardTheme) {
  const grad = ctx.createLinearGradient(0, y - BRIDGE_GLOW, 0, y);
  grad.addColorStop(0, "rgba(160,162,172,0)");
  grad.addColorStop(1, "rgba(160,162,172,0.45)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, y - BRIDGE_GLOW, width, BRIDGE_GLOW);
  ctx.fillStyle = theme.bridge;
  ctx.fillRect(0, y - BRIDGE_THICKNESS / 2, width, BRIDGE_THICKNESS);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(0, y - BRIDGE_THICKNESS / 2, width, 2);
}

function drawTine(ctx: CanvasRenderingContext2D, g: TineGeometry, color: string, highlight?: BoardHighlight) {
  const x = g.cx - g.width / 2;
  const h = g.tip - g.top;
  const glow = highlight?.strength ?? 0;
  const glowColor = highlight?.color ?? "#ffffff";
  if (glow > 0) {
    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 18 * glow;
    ctx.fillStyle = color;
    roundedRect(ctx, x, g.top - 4, g.width, h + 4, g.width / 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = color;
  roundedRect(ctx, x, g.top - 4, g.width, h + 4, g.width / 2);
  ctx.fill();
  // A darker edge on one side reads as metal without a gradient per frame.
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(x + g.width * 0.7, g.top, g.width * 0.3, h - g.width / 2);
  if (glow > 0) {
    ctx.save();
    ctx.globalAlpha = 0.55 * glow;
    ctx.fillStyle = glowColor;
    roundedRect(ctx, x, g.tip - g.width * 2.2, g.width, g.width * 2.2, g.width / 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  g: TineGeometry,
  label: string,
  octaveDots: number,
  laneWidth: number,
  theme: BoardTheme,
  layerColor: string,
) {
  const fontSize = labelFontSize(laneWidth);
  const fitsInside = g.width >= fontSize * 0.9;
  // Inside the metal near the tip when wide enough, otherwise just below it in the tier color.
  const y = fitsInside ? g.tip - fontSize * 1.1 : g.tip + fontSize * 0.9;
  drawTineLabel(ctx, g.cx, y, label, octaveDots, fontSize, fitsInside ? theme.labelOnTine : layerColor);
}

export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
