// Canvas rendering of the tine board. Geometry comes from geometry.ts; this
// file only paints.

import type { Layout } from "../model/layout";
import { computeBoardGeometry, type BoardGeometry } from "./geometry";

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

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  width: number,
  height: number,
  theme: BoardTheme = DEFAULT_THEME,
): BoardGeometry {
  const geo = computeBoardGeometry(layout, width, height);
  ctx.clearRect(0, 0, width, height);

  drawBody(ctx, geo, theme);

  // Bottom tier first. Each tier above is physically on top, so it is painted
  // later and covers the upper part of whatever sits beneath it. Its tips end
  // higher (geometry.ts), which keeps every tine's tip and label visible.
  const byTierBottomUp = [...geo.layers].sort((a, b) => a.layer - b.layer);
  for (const layer of byTierBottomUp) {
    const style = layout.layers[layer.layer];
    drawBridge(ctx, layer, theme);
    for (const g of geo.tines) {
      if (g.layer !== layer.layer) continue;
      const tine = layout.tines[g.index];
      drawTine(ctx, g, style.color);
      drawLabel(ctx, g, tine.label, tine.octaveDots, geo.laneWidth, theme, style.color);
    }
  }
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

function drawTine(ctx: CanvasRenderingContext2D, g: { cx: number; width: number; top: number; tip: number }, color: string) {
  const x = g.cx - g.width / 2;
  const h = g.tip - g.top;
  ctx.fillStyle = color;
  roundedRect(ctx, x, g.top - 4, g.width, h + 4, g.width / 2);
  ctx.fill();
  // A darker edge on one side reads as metal without a gradient per frame.
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(x + g.width * 0.7, g.top, g.width * 0.3, h - g.width / 2);
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  g: { cx: number; width: number; tip: number },
  label: string,
  octaveDots: number,
  laneWidth: number,
  theme: BoardTheme,
  layerColor: string,
) {
  const fontSize = Math.max(9, Math.min(18, laneWidth * 0.62));
  const fitsInside = g.width >= fontSize * 0.9;
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Inside the metal near the tip when wide enough, otherwise just below it in the layer color.
  const y = fitsInside ? g.tip - fontSize * 1.1 : g.tip + fontSize * 0.9;
  ctx.fillStyle = fitsInside ? theme.labelOnTine : layerColor;

  const digit = label[0];
  const accidental = label.slice(1);
  ctx.fillText(digit, g.cx, y);
  if (accidental) {
    ctx.font = `600 ${fontSize * 0.6}px system-ui, sans-serif`;
    ctx.fillText(accidental === "#" ? "♯" : "♭", g.cx + fontSize * 0.55, y - fontSize * 0.3);
  }

  const dotR = Math.max(1.2, fontSize * 0.1);
  const dotGap = dotR * 3;
  const count = Math.abs(octaveDots);
  const dir = octaveDots > 0 ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const dy = dir * (fontSize * 0.75 + i * dotGap);
    ctx.beginPath();
    ctx.arc(g.cx, y + dy, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
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
