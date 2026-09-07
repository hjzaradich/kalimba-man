// Editing operations on layouts, kept pure so the editor UI stays thin and
// the logic is testable. Every function returns a new Layout.

import { fanOrder, labelForPitch, octaveDotsForPitch, slotCount, type AccidentalStyle, type Layout, type LayerStyle, type Tine } from "./layout";

export const TIER_COLORS = ["#d9dee8", "#f2b25c", "#7cc0ff", "#9ee09e", "#e39be0", "#f08c8c"];

/** A blank layout to start from. */
export function blankLayout(name = "My kalimba"): Layout {
  return {
    id: "",
    name,
    tuning: "C",
    accidentalStyle: "sharp",
    layers: [{ name: "Main", color: TIER_COLORS[0] }],
    tines: [],
  };
}

/** A deep copy with a new name, ready to be edited as a user layout. */
export function duplicateLayout(source: Layout, name: string): Layout {
  return { ...structuredClone(source), id: "", name, draft: source.draft };
}

export function addTier(layout: Layout): Layout {
  const i = layout.layers.length;
  const layer: LayerStyle = { name: `Tier ${i + 1}`, color: TIER_COLORS[i % TIER_COLORS.length], xShift: i === 0 ? 0 : 0.2 * (i % 2 === 1 ? 1 : -1) };
  return { ...layout, layers: [...layout.layers, layer] };
}

export function updateTier(layout: Layout, index: number, patch: Partial<LayerStyle>): Layout {
  const layers = layout.layers.map((l, i) => (i === index ? { ...l, ...patch } : l));
  return { ...layout, layers };
}

/** Remove a tier and its tines; tines on higher tiers move down one. */
export function removeTier(layout: Layout, index: number): Layout {
  if (layout.layers.length <= 1) return layout;
  const layers = layout.layers.filter((_, i) => i !== index);
  const tines = layout.tines.filter((t) => t.layer !== index).map((t) => (t.layer > index ? { ...t, layer: t.layer - 1 } : t));
  return { ...layout, layers, tines };
}

export function updateTine(layout: Layout, index: number, patch: Partial<Tine>): Layout {
  const tines = layout.tines.map((t, i) => (i === index ? { ...t, ...patch } : t));
  return { ...layout, tines };
}

/** Change a tine's pitch and refresh its printed label and dots to match. */
export function setTinePitch(layout: Layout, index: number, pitch: number): Layout {
  return updateTine(layout, index, { pitch, label: labelForPitch(pitch, layout.accidentalStyle), octaveDots: octaveDotsForPitch(pitch) });
}

export function removeTine(layout: Layout, index: number): Layout {
  return { ...layout, tines: layout.tines.filter((_, i) => i !== index) };
}

/** Add a tine at the first free slot on the tier, to the right of the last one. */
export function addTine(layout: Layout, layer: number, pitch = 60): Layout {
  const used = new Set(layout.tines.filter((t) => t.layer === layer).map((t) => t.x));
  let x = 0;
  while (used.has(x)) x++;
  const tine: Tine = { pitch, label: labelForPitch(pitch, layout.accidentalStyle), octaveDots: octaveDotsForPitch(pitch), layer, x };
  return { ...layout, tines: [...layout.tines, tine] };
}

/** Move a tine one slot left or right, swapping with a neighbour that is in the way. */
export function nudgeTine(layout: Layout, index: number, delta: -1 | 1): Layout {
  const t = layout.tines[index];
  const x = t.x + delta;
  if (x < 0) return layout;
  const other = layout.tines.findIndex((o, i) => i !== index && o.layer === t.layer && o.x === x);
  const tines = layout.tines.map((o, i) => {
    if (i === index) return { ...o, x };
    if (i === other) return { ...o, x: t.x };
    return o;
  });
  return { ...layout, tines };
}

/** Re-label every tine from its pitch in the given style. */
export function relabelAll(layout: Layout, style: AccidentalStyle): Layout {
  return {
    ...layout,
    accidentalStyle: style,
    tines: layout.tines.map((t) => ({ ...t, label: labelForPitch(t.pitch, style), octaveDots: octaveDotsForPitch(t.pitch) })),
  };
}

/** Semitone offsets of the C-major naturals. */
const NATURAL_PC = new Set([0, 2, 4, 5, 7, 9, 11]);

/**
 * Replace a tier's tines with a standard fan of the naturals between two
 * pitches inclusive: lowest in the centre, alternating outward.
 */
export function fillFan(layout: Layout, layer: number, low: number, high: number): Layout {
  const [lo, hi] = low <= high ? [low, high] : [high, low];
  const pitches: number[] = [];
  for (let p = lo; p <= hi; p++) if (NATURAL_PC.has(((p % 12) + 12) % 12)) pitches.push(p);
  if (pitches.length === 0) return layout;
  const ordered = fanOrder(pitches);
  const tines = layout.tines.filter((t) => t.layer !== layer);
  ordered.forEach((pitch, x) =>
    tines.push({ pitch, label: labelForPitch(pitch, layout.accidentalStyle), octaveDots: octaveDotsForPitch(pitch), layer, x }),
  );
  return { ...layout, tines };
}

/**
 * Replace a tier's tines with one tine over each tine of another tier, a
 * semitone above it: the sharps for C, D, F, G, A and the natural above for
 * E and B. This is how chromatic kalimbas stack their upper tier.
 */
export function fillSemitoneAbove(layout: Layout, layer: number, sourceLayer: number): Layout {
  const source = layout.tines.filter((t) => t.layer === sourceLayer);
  if (source.length === 0) return layout;
  const tines = layout.tines.filter((t) => t.layer !== layer);
  for (const s of source) {
    const pitch = s.pitch + 1;
    tines.push({ pitch, label: labelForPitch(pitch, layout.accidentalStyle), octaveDots: octaveDotsForPitch(pitch), layer, x: s.x });
  }
  return { ...layout, tines };
}

/** Shift every tine on a tier by whole slots (negative = left). Refuses to go below slot 0. */
export function shiftTier(layout: Layout, layer: number, slots: number): Layout {
  const own = layout.tines.filter((t) => t.layer === layer);
  if (own.length === 0 || own.some((t) => t.x + slots < 0)) return layout;
  return { ...layout, tines: layout.tines.map((t) => (t.layer === layer ? { ...t, x: t.x + slots } : t)) };
}

/** Drop empty leading slots so the board is not drawn with a gap on the left. */
export function compactSlots(layout: Layout): Layout {
  if (layout.tines.length === 0) return layout;
  const min = Math.min(...layout.tines.map((t) => t.x));
  if (min === 0) return layout;
  return { ...layout, tines: layout.tines.map((t) => ({ ...t, x: t.x - min })) };
}

export function summarizeLayout(layout: Layout): string {
  return `${layout.tines.length} tines · ${layout.layers.length} tier${layout.layers.length === 1 ? "" : "s"} · ${slotCount(layout)} columns`;
}
