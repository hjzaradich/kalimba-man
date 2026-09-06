// Can this kalimba play this song? DESIGN.md §6.4. Never alters pitches
// silently: callers show the report and let the user choose.

import { tinesForPitch, type Layout } from "./layout";
import { transpose, type Song } from "./song";

export interface CapabilityReport {
  /** Indices into song.notes that no tine can play. */
  unplayable: number[];
  /** Distinct unplayable pitches, ascending. */
  missingPitches: number[];
}

export function checkCapability(song: Song, layout: Layout): CapabilityReport {
  const unplayable: number[] = [];
  const missing = new Set<number>();
  song.notes.forEach((n, i) => {
    if (tinesForPitch(layout, n.pitch).length === 0) {
      unplayable.push(i);
      missing.add(n.pitch);
    }
  });
  return { unplayable, missingPitches: [...missing].sort((a, b) => a - b) };
}

/**
 * The transposition within an octave that leaves the fewest unplayable notes.
 * Prefers no change, then the smallest shift, then downward over upward.
 */
export function bestTransposition(song: Song, layout: Layout): { semitones: number; unplayable: number } {
  let best = { semitones: 0, unplayable: checkCapability(song, layout).unplayable.length };
  if (best.unplayable === 0) return best;
  const candidates = [];
  for (let k = 1; k <= 12; k++) candidates.push(-k, k);
  for (const k of candidates) {
    const count = checkCapability(transpose(song, k), layout).unplayable.length;
    if (count < best.unplayable) best = { semitones: k, unplayable: count };
  }
  return best;
}

/**
 * Move each unplayable note by whole octaves until a tine can play it, when
 * one exists in another octave. Notes with no octave equivalent are left.
 */
export function foldOctaves(song: Song, layout: Layout): Song {
  const available = new Set(layout.tines.map((t) => t.pitch));
  let changed = false;
  const notes = song.notes.map((n) => {
    if (available.has(n.pitch)) return n;
    for (let k = 1; k <= 4; k++) {
      if (available.has(n.pitch - 12 * k)) {
        changed = true;
        return { ...n, pitch: n.pitch - 12 * k };
      }
      if (available.has(n.pitch + 12 * k)) {
        changed = true;
        return { ...n, pitch: n.pitch + 12 * k };
      }
    }
    return n;
  });
  return changed ? { ...song, notes } : song;
}
