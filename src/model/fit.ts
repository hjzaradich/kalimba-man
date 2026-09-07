// Fitting a melody to a kalimba: DESIGN.md §6.5.
//
// Try every transposition within an octave combined with octave moves, and
// pick by, in order: fewest notes left unplayable, fewest notes that had to
// be folded by an octave (each fold is a jump the player must make), the
// smallest shift from the original key, the smallest octave move.

import type { Layout } from "./layout";
import { notationFromNotes } from "./notationOut";
import type { Note, Song, SongFit } from "./song";

export interface Fit {
  /** Total shift applied to every note, in semitones. */
  shift: number;
  /** The part of the shift within an octave, -6..5: the key change. */
  semitones: number;
  /** The whole-octave part of the shift. */
  octaves: number;
  /** Notes moved by a further octave to reach a tine. */
  folded: number;
  /** Notes no tine can play even after folding. */
  unplayable: number;
}

/** Which notes a layout can play: the set of pitches, and the range for folding. */
function pitchSet(layout: Layout): Set<number> {
  return new Set(layout.tines.map((t) => t.pitch));
}

/**
 * Apply a shift and fold what does not land. Returns the new pitches and
 * how many were folded or left unplayable.
 */
export function applyFit(pitches: number[], shift: number, playable: Set<number>): { pitches: number[]; folded: number; unplayable: number } {
  let folded = 0;
  let unplayable = 0;
  const out = pitches.map((p) => {
    const q = p + shift;
    if (playable.has(q)) return q;
    for (let k = 1; k <= 4; k++) {
      if (playable.has(q - 12 * k)) {
        folded++;
        return q - 12 * k;
      }
      if (playable.has(q + 12 * k)) {
        folded++;
        return q + 12 * k;
      }
    }
    unplayable++;
    return q;
  });
  return { pitches: out, folded, unplayable };
}

export function evaluateFit(pitches: number[], layout: Layout, semitones: number, octaves: number): Fit {
  const shift = semitones + 12 * octaves;
  const r = applyFit(pitches, shift, pitchSet(layout));
  return { shift, semitones, octaves, folded: r.folded, unplayable: r.unplayable };
}

/** Lexicographic comparison of two fits by the rules above. */
export function betterFit(a: Fit, b: Fit): number {
  return a.unplayable - b.unplayable || a.folded - b.folded || Math.abs(a.semitones) - Math.abs(b.semitones) || Math.abs(a.octaves) - Math.abs(b.octaves) || a.semitones - b.semitones;
}

export function bestFit(pitches: number[], layout: Layout): Fit {
  let best: Fit | null = null;
  for (let octaves = -3; octaves <= 3; octaves++) {
    for (let semitones = -6; semitones <= 5; semitones++) {
      const f = evaluateFit(pitches, layout, semitones, octaves);
      if (!best || betterFit(f, best) < 0) best = f;
    }
  }
  return best!;
}

/** A song with the fit applied to its notes (chords are shifted, not folded). */
export function applyFitToSong(song: Song, fit: Fit, layout: Layout): Song {
  const playable = pitchSet(layout);
  const r = applyFit(
    song.notes.map((n) => n.pitch),
    fit.shift,
    playable,
  );
  const notes: Note[] = song.notes.map((n, i) => ({ ...n, pitch: r.pitches[i] }));
  const chords = song.chords?.map((c) => ({ ...c, pitches: c.pitches.map((p) => p + fit.shift) }));
  return { ...song, notes, ...(chords ? { chords } : {}) };
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "D → E, up an octave" style summary for the UI. */
export function describeFit(fit: Fit, tonic?: string): string {
  const parts: string[] = [];
  if (fit.semitones === 0 && fit.octaves === 0) parts.push("no transposition");
  else {
    if (fit.semitones !== 0) {
      const from = tonic ? NAMES.indexOf(normalizeTonic(tonic)) : -1;
      const keyText = from >= 0 ? ` (${tonic} → ${NAMES[(from + fit.semitones + 12) % 12]})` : "";
      parts.push(`${fit.semitones > 0 ? "up" : "down"} ${Math.abs(fit.semitones)} semitone${Math.abs(fit.semitones) === 1 ? "" : "s"}${keyText}`);
    }
    if (fit.octaves !== 0) parts.push(`${fit.octaves > 0 ? "up" : "down"} ${Math.abs(fit.octaves)} octave${Math.abs(fit.octaves) === 1 ? "" : "s"}`);
  }
  if (fit.folded) parts.push(`${fit.folded} note${fit.folded === 1 ? "" : "s"} folded by an octave`);
  if (fit.unplayable) parts.push(`${fit.unplayable} unplayable`);
  return parts.join(", ");
}

function normalizeTonic(t: string): string {
  const flats: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };
  return flats[t] ?? t;
}

/** The notes and chords a fit should start from: the import, never a previous fit. */
export function pureSource(song: Song): { notes: Note[]; chords?: Song["chords"] } {
  return song.original ?? { notes: song.notes, chords: song.chords };
}

/**
 * Fit a song to a layout and record it. The result plays the fitted notes,
 * keeps the untouched import in `original`, and describes the fit in `fit`
 * so it can be redone for another kalimba or undone. `override` fixes the
 * shift instead of searching.
 */
export function refitSong(song: Song, layout: Layout, override?: { semitones: number; octaves: number }): Song {
  const source = pureSource(song);
  const pitches = source.notes.map((n) => n.pitch);
  const fit = override ? evaluateFit(pitches, layout, override.semitones, override.octaves) : bestFit(pitches, layout);
  const base: Song = { ...song, notes: source.notes, ...(source.chords ? { chords: source.chords } : {}) };
  const fitted = applyFitToSong(base, fit, layout);
  const record: SongFit = {
    layoutId: layout.id,
    layoutName: layout.name,
    semitones: fit.semitones,
    octaves: fit.octaves,
    folded: fit.folded,
    unplayable: fit.unplayable,
    auto: !override,
  };
  return {
    ...fitted,
    fit: record,
    original: { notes: source.notes, ...(source.chords ? { chords: source.chords } : {}) },
    text: notationFromNotes(fitted),
  };
}

/** The song as imported: no fit, notes and text back to the original. */
export function restoreOriginal(song: Song): Song {
  if (!song.original) return song;
  const rest = { ...song };
  delete rest.fit;
  delete rest.original;
  const restored: Song = { ...rest, notes: song.original.notes, ...(song.original.chords ? { chords: song.original.chords } : {}) };
  restored.text = notationFromNotes(restored);
  return restored;
}

/** True when the song's notes were fitted for a different kalimba than `layout`. */
export function fittedElsewhere(song: Song, layout: Layout): boolean {
  return !!song.fit && song.fit.layoutId !== layout.id;
}
