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
  bridge: "#8c8c94",
  labelOnTine: "#1c1f26",
};

export interface BoardHighlight {
  /** Index into layout.tines. */
  tine: number;
  /** 0..1, fades the glow. */
  strength: number;
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

  const glow = new Map<number, number>();
  for (const h of highlights) glow.set(h.tine, Math.max(glow.get(h.tine) ?? 0, h.strength));

  // Bottom tier first. Each tier above is physically on top, so it is painted
  // later and covers the upper part of whatever sits beneath it. Its tips end
  // higher (geometry.ts), which keeps every tine's tip and label visible.
  const byTierBottomUp = [...geo.layers].sort((a, b) => a.layer - b.layer);
  for (const layer of byTierBottomUp) {
    const style = layout.layers[layer.layer];
    for (const g of geo.tines) {
      if (g.layer !== layer.layer) continue;
      const tine = layout.tines[g.index];
      drawTine(ctx, g, style.color, glow.get(g.index) ?? 0);
      drawLabel(ctx, g, tine.label, tine.octaveDots, geo.laneWidth, theme, style.color);
    }
  }
  // One bridge bar over every tier: the line notes land on.
  drawBridge(ctx, { bridgeY: geo.hitY, left: 0, right: geo.width }, theme);
  ctx.restore();
  return geo;
}

function drawBody(ctx: CanvasRenderingContext2D, geo: BoardGeometry, theme: BoardTheme) {
  const r = Math.min(24, geo.width * 0.04);
  ctx.fillStyle = theme.wood;
  ctx.strokeStyle = theme.woodEdge;
  ctx.lineWidth = 2;
  roundedRect(ctx, 1, 1, geo.width - 2, geo.height - 2, r);
  ctx.fill();
  ctx.stroke();
}

function drawBridge(ctx: CanvasRenderingContext2D, layer: { bridgeY: number; left: number; right: number }, theme: BoardTheme) {
  if (layer.right <= layer.left) return;
  ctx.fillStyle = theme.bridge;
  ctx.fillRect(layer.left, layer.bridgeY - 3, layer.right - layer.left, 6);
}

function drawTine(ctx: CanvasRenderingContext2D, g: TineGeometry, color: string, glow: number) {
  const x = g.cx - g.width / 2;
  const h = g.tip - g.top;
  if (glow > 0) {
    ctx.save();
    ctx.shadowColor = "#ffffff";
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
    ctx.fillStyle = `rgba(255,255,255,${0.55 * glow})`;
    roundedRect(ctx, x, g.tip - g.width * 2.2, g.width, g.width * 2.2, g.width / 2);
    ctx.fill();
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
