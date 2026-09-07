// Layout model: what a kalimba physically is. See DESIGN.md §4.1.
//
// A layout is a list of tines. Each tine knows its pitch, the label printed on
// it, which layer it sits on, and its horizontal slot as the player sees the
// board. Everything the renderer needs is derived from this.

export type AccidentalStyle = "sharp" | "flat";

export interface LayerStyle {
  /** Human name, e.g. "Front", "Sharps", "Bass". */
  name: string;
  /** CSS color used for the tines on this layer and for falling notes that land on them. */
  color: string;
  /**
   * Horizontal shift of every tine on this tier, in lane widths. Stacked
   * tiers sit in one column on a real instrument; a small shift keeps each
   * tier's lanes visually distinct for falling notes. Default 0. Keep within
   * about ±0.3 so tines stay inside their lane.
   */
  xShift?: number;
}

export interface Tine {
  /** MIDI pitch. C4 = 60. */
  pitch: number;
  /** Exactly what is printed on the tine, minus octave dots: "1", "4#", "5b". */
  label: string;
  /** Octave dots as printed: +1 = one dot above, -1 = one dot below, +2 = two above. */
  octaveDots: number;
  /**
   * Tier index. 0 is the bottom tier, against the soundboard; higher tiers
   * are stacked on top of it and drawn over it. A single-tier kalimba is all 0.
   */
  layer: number;
  /** Horizontal slot, 0..N-1 left to right as the player sees the board. */
  x: number;
  /**
   * Relative drawn length, 0..1, where 1 is the longest tine on the board.
   * Optional: when absent it is derived from pitch (lower = longer).
   */
  length?: number;
}

export interface Layout {
  id: string;
  name: string;
  /** Tonic the digits are relative to. Only C is supported today. */
  tuning: "C";
  /** Default label style for new tines in the custom editor. */
  accidentalStyle: AccidentalStyle;
  /** Index 0 = bottom tier. */
  layers: LayerStyle[];
  tines: Tine[];
  /** Presets that have not been checked against a real instrument. */
  draft?: boolean;
  /** Free text shown in the layout picker. */
  notes?: string;
}

/** Scale degree (1..7) for each pitch class of C major; null for accidentals. */
const DEGREE_OF_PITCH_CLASS: (number | null)[] = [1, null, 2, null, 3, 4, null, 5, null, 6, null, 7];

/** Pitch-class offsets of degrees 1..7 in C major. Index 0 unused. */
const PITCH_CLASS_OF_DEGREE = [0, 0, 2, 4, 5, 7, 9, 11];

export const MIDI_C4 = 60;

/**
 * The label a C-tuned kalimba would print for a pitch, without octave dots.
 * Accidentals become "<degree>#" of the note below or "<degree>b" of the
 * note above, depending on style.
 */
export function labelForPitch(pitch: number, style: AccidentalStyle = "sharp"): string {
  const pc = ((pitch % 12) + 12) % 12;
  const degree = DEGREE_OF_PITCH_CLASS[pc];
  if (degree !== null) return String(degree);
  if (style === "sharp") return `${DEGREE_OF_PITCH_CLASS[pc - 1]}#`;
  return `${DEGREE_OF_PITCH_CLASS[(pc + 1) % 12]}b`;
}

/** Octave dots a C-tuned kalimba would print: C4..B4 = 0, C5..B5 = +1, C3..B3 = -1. */
export function octaveDotsForPitch(pitch: number): number {
  return Math.floor(pitch / 12) - Math.floor(MIDI_C4 / 12);
}

/** Inverse of labelForPitch + octaveDotsForPitch. Returns null for an unreadable label. */
export function pitchForLabel(label: string, octaveDots: number): number | null {
  const m = /^([1-7])([#b]?)$/.exec(label.trim());
  if (!m) return null;
  const degree = Number(m[1]);
  let pc = PITCH_CLASS_OF_DEGREE[degree];
  if (m[2] === "#") pc += 1;
  if (m[2] === "b") pc -= 1;
  return MIDI_C4 + octaveDots * 12 + pc;
}

/**
 * Build a tine from a pitch using the C-major printing conventions. Presets
 * and the custom editor both start from this and override what differs.
 */
export function tineForPitch(
  pitch: number,
  layer: number,
  x: number,
  style: AccidentalStyle = "sharp",
): Tine {
  return { pitch, label: labelForPitch(pitch, style), octaveDots: octaveDotsForPitch(pitch), layer, x };
}

/**
 * Standard kalimba fan: the lowest pitch sits in the centre and successive
 * pitches alternate left, right, left, right outward. Returns pitches ordered
 * left to right. Matches the 17-key: D6 B5 G5 E5 C5 A4 F4 D4 | C4 | E4 G4 B4 …
 */
export function fanOrder(ascendingPitches: number[]): number[] {
  const left: number[] = [];
  const right: number[] = [];
  ascendingPitches.forEach((p, i) => {
    if (i === 0) return;
    (i % 2 === 1 ? left : right).push(p);
  });
  return [...left.reverse(), ascendingPitches[0], ...right];
}

/** Number of horizontal slots the board needs. */
export function slotCount(layout: Layout): number {
  return layout.tines.reduce((max, t) => Math.max(max, t.x + 1), 0);
}

/**
 * The tines that can play a pitch, lowest tier first. Empty when the
 * instrument cannot play it (the capability check in DESIGN.md §6.4).
 */
export function tinesForPitch(layout: Layout, pitch: number): number[] {
  return layout.tines
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.pitch === pitch)
    .sort((a, b) => a.t.layer - b.t.layer)
    .map(({ i }) => i);
}

export interface LayoutProblem {
  tine?: number;
  message: string;
}

/** Structural checks a layout must pass before it is drawn or saved. */
export function validateLayout(layout: Layout): LayoutProblem[] {
  // The id is assigned when a layout is stored, so an unsaved one has none.
  const problems: LayoutProblem[] = [];
  if (!layout.name.trim()) problems.push({ message: "Layout has no name." });
  if (layout.layers.length === 0) problems.push({ message: "Layout has no layers." });
  if (layout.tines.length === 0) problems.push({ message: "Layout has no tines." });
  const occupied = new Map<string, number>();
  layout.tines.forEach((t, i) => {
    if (!Number.isInteger(t.pitch) || t.pitch < 0 || t.pitch > 127) {
      problems.push({ tine: i, message: `Tine ${i} has an invalid MIDI pitch ${t.pitch}.` });
    }
    if (t.layer < 0 || t.layer >= layout.layers.length) {
      problems.push({ tine: i, message: `Tine ${i} is on layer ${t.layer}, which does not exist.` });
    }
    if (!Number.isInteger(t.x) || t.x < 0) {
      problems.push({ tine: i, message: `Tine ${i} has an invalid slot ${t.x}.` });
    }
    if (!/^[1-7][#b]?$/.test(t.label)) {
      problems.push({ tine: i, message: `Tine ${i} has label "${t.label}"; expected a digit 1–7 with optional # or b.` });
    }
    const key = `${t.layer}:${t.x}`;
    const other = occupied.get(key);
    if (other !== undefined) {
      problems.push({ tine: i, message: `Tine ${i} and tine ${other} both occupy slot ${t.x} on layer ${t.layer}.` });
    }
    occupied.set(key, i);
  });
  return problems;
}
