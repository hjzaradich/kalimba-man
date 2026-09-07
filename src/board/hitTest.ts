// Which tine is under a point on the board, for the layout editor.
// Higher tiers are drawn on top, so they win when tines overlap.

import type { BoardGeometry } from "./geometry";

export function tineAt(geo: BoardGeometry, x: number, y: number): number | null {
  let best: { index: number; layer: number } | null = null;
  for (const g of geo.tines) {
    const half = g.width / 2 + 2;
    if (x < g.cx - half || x > g.cx + half || y < g.top - 6 || y > g.tip + 2) continue;
    if (!best || g.layer > best.layer) best = { index: g.index, layer: g.layer };
  }
  return best?.index ?? null;
}
