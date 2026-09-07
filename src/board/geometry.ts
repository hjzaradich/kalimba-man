// Pure geometry for the tine board. No canvas here so it can be unit tested.
//
// Coordinate system: the board fills a rectangle of `width` x `height` CSS
// pixels. Tines hang from a bridge bar and their free tips point down toward
// the player. All tiers hang from one bridge line (`hitY`), which is where
// falling notes land, so timing reads the same on every tier. Tier 0 is the
// bottom tier, against the soundboard, and has the lowest tips; each tier
// stacked on top ends a fixed step higher, so nothing hides a tip.

import { slotCount, type Layout } from "../model/layout";

export interface TineGeometry {
  /** Index into layout.tines. */
  index: number;
  layer: number;
  /** Horizontal centre of the tine. */
  cx: number;
  /** Drawn width of the metal. */
  width: number;
  /** Y of the bridge this tine hangs from. */
  top: number;
  /** Y of the free tip: where a falling note lands. */
  tip: number;
}

export interface LayerGeometry {
  layer: number;
  bridgeY: number;
  /** Horizontal extent of the bridge bar. */
  left: number;
  right: number;
}

export interface BoardGeometry {
  width: number;
  height: number;
  laneWidth: number;
  slots: number;
  tines: TineGeometry[];
  layers: LayerGeometry[];
  /**
   * Y of the shared bridge line, where every tier's tines are anchored.
   * Falling notes land here, so notes on different tiers can be compared
   * against one straight line.
   */
  hitY: number;
}

/**
 * How tine lengths are decided.
 *
 * One tier is the reference: the one whose tines cover the most columns
 * (ties go to the middle-most tier). Its tips follow pitch, lowest note
 * longest, between MIN_TIP and MAX_TIP. Every other tine takes the reference
 * tip in its column and steps up or down by TIP_STEP per tier, so within any
 * column the visible ends are evenly spaced no matter what pitches the tiers
 * hold. A tine in a column with no reference tine falls back to its own
 * tier's pitch range.
 */

/** Lowest point any tip may reach, as a fraction of height. */
const BOTTOM_PAD = 0.05;
/** Vertical spread between the longest and shortest reference tine, as a fraction of height. */
const TIP_SPREAD = 0.44;
/** Distance between the tips of adjacent tiers in one column, as a fraction of height. */
const TIP_STEP = 0.12;
/**
 * Space above the bridge line, as a fraction of height. Zero: the bridge is
 * the top edge of the board and nothing of the instrument shows above it.
 */
const TOP_PAD = 0;
/** Tine metal width as a fraction of the lane. */
const TINE_WIDTH = 0.42;

/** The tier that sets the fan shape: most columns covered, ties to the middle tier. */
export function referenceTier(layout: Layout): number {
  const columns = new Map<number, Set<number>>();
  for (const t of layout.tines) {
    if (!columns.has(t.layer)) columns.set(t.layer, new Set());
    columns.get(t.layer)!.add(t.x);
  }
  const middle = (layout.layers.length - 1) / 2;
  let best = 0;
  let bestCount = -1;
  for (const [layer, cols] of columns) {
    const better =
      cols.size > bestCount ||
      (cols.size === bestCount && Math.abs(layer - middle) < Math.abs(best - middle));
    if (better) {
      best = layer;
      bestCount = cols.size;
    }
  }
  return best;
}

export function computeBoardGeometry(layout: Layout, width: number, height: number): BoardGeometry {
  const slots = Math.max(1, slotCount(layout));
  const laneWidth = width / slots;
  const ref = referenceTier(layout);

  // Pitch range per tier, for length normalisation.
  const range = new Map<number, { min: number; max: number }>();
  for (const t of layout.tines) {
    const r = range.get(t.layer);
    if (!r) range.set(t.layer, { min: t.pitch, max: t.pitch });
    else {
      r.min = Math.min(r.min, t.pitch);
      r.max = Math.max(r.max, t.pitch);
    }
  }

  // Every tier hangs from the same bridge line so the backs of the tines are
  // aligned; tiers differ only in length (and colour).
  const hitY = height * TOP_PAD;
  const bridgeOf = (_layer: number) => hitY;

  // Reference tips are placed so the bottom tier, TIP_STEP * ref below them,
  // still clears the bottom edge.
  const maxTip = height * (1 - BOTTOM_PAD - ref * TIP_STEP);
  const minTip = maxTip - height * TIP_SPREAD;
  const tipFromPitch = (layer: number, pitch: number) => {
    const r = range.get(layer)!;
    const span = Math.max(1, r.max - r.min);
    return minTip + ((r.max - pitch) / span) * (maxTip - minTip);
  };

  const refTipByColumn = new Map<number, number>();
  for (const t of layout.tines) {
    if (t.layer === ref) refTipByColumn.set(t.x, tipFromPitch(ref, t.pitch));
  }

  const tines: TineGeometry[] = layout.tines.map((t, index) => {
    const bridgeY = bridgeOf(t.layer);
    const shift = layout.layers[t.layer]?.xShift ?? 0;
    let tip: number;
    if (t.length !== undefined) {
      tip = bridgeY + height * t.length;
    } else {
      const refTip = refTipByColumn.get(t.x) ?? tipFromPitch(t.layer, t.pitch);
      tip = refTip + (ref - t.layer) * height * TIP_STEP;
    }
    return {
      index,
      layer: t.layer,
      cx: (t.x + 0.5 + shift) * laneWidth,
      width: laneWidth * TINE_WIDTH,
      top: bridgeY,
      tip,
    };
  });

  const layers: LayerGeometry[] = layout.layers.map((_, layer) => {
    const own = tines.filter((g) => g.layer === layer);
    const bridgeY = bridgeOf(layer);
    if (own.length === 0) return { layer, bridgeY, left: 0, right: 0 };
    return {
      layer,
      bridgeY,
      left: Math.min(...own.map((g) => g.cx)) - laneWidth * 0.6,
      right: Math.max(...own.map((g) => g.cx)) + laneWidth * 0.6,
    };
  });

  return { width, height, laneWidth, slots, tines, layers, hitY };
}
