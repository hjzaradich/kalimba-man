// Which tine is under a point on the board. Used by the player (click to
// pluck) and the layout editor (click to select).
//
// The player never hit-tests against a cached frame: the geometry is
// recomputed from the layout it is handed, with the same pure function the
// renderer uses, so a click right after a layout change, a resize, or a
// stalled animation loop still lands on the tine that is actually drawn.

import { computeBoardGeometry, type BoardGeometry } from "./geometry";
import type { Layout } from "../model/layout";

/** Extra reach around each tine, in pixels, so a click just beside the metal still counts. */
const EDGE = 2;
/** How far above the bridge a click still belongs to the tine hanging there. */
const ABOVE_BRIDGE = 6;

/**
 * Index (into layout.tines) of the tine at (x, y) in board coordinates, or
 * null. A point inside a tine picks the highest tier there: tiers stacked on
 * top physically cover the ones beneath. A point within `slack` pixels of a
 * tine but inside none picks the nearest, so a click just off the tip of a
 * thin tine is not lost.
 */
export function tineAt(geo: BoardGeometry, x: number, y: number, slack = 0): number | null {
  let best: { index: number; layer: number; inside: boolean; dist: number } | null = null;
  for (const g of geo.tines) {
    const half = g.width / 2 + EDGE;
    const dx = Math.max(0, Math.abs(x - g.cx) - half);
    const dy = Math.max(0, g.top - ABOVE_BRIDGE - y, y - (g.tip + EDGE));
    const dist = Math.hypot(dx, dy);
    if (dist > slack) continue;
    const inside = dist === 0;
    const better =
      !best ||
      (inside && !best.inside) ||
      (inside === best.inside && (inside ? g.layer > best.layer : dist < best.dist));
    if (better) best = { index: g.index, layer: g.layer, inside, dist };
  }
  return best?.index ?? null;
}

/**
 * The tine under a click on the player canvas, where the falling-note lane
 * occupies the top of the canvas and the board the bottom `boardFraction`
 * of it. Coordinates are CSS pixels from the canvas's top-left. The board
 * height is rounded exactly as the renderer rounds it.
 */
export function playerTineAt(
  layout: Layout,
  width: number,
  height: number,
  boardFraction: number,
  x: number,
  y: number,
  slack = 0,
): number | null {
  const boardHeight = Math.round(height * boardFraction);
  const laneHeight = height - boardHeight;
  const boardY = y - laneHeight;
  if (boardY < -ABOVE_BRIDGE - slack) return null;
  return tineAt(computeBoardGeometry(layout, width, boardHeight), x, boardY, slack);
}
