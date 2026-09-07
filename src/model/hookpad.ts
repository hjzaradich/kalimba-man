// Hookpad documents (what TheoryTab's public endpoint returns) → notes.
// DESIGN.md §6.4. Pure: tested against saved documents.

import type { Chord, Note, Section } from "./song";

export interface HookpadNote {
  /** Scale degree "1".."7", possibly with a leading "#" or "b". */
  sd: string;
  /** Relative octave; 0 is the octave starting on the tonic in MIDI octave 4. */
  octave: number;
  /** 1-based beat within the section. */
  beat: number;
  /** In beats. */
  duration: number;
  isRest?: boolean;
}

export interface HookpadChord {
  root: number;
  beat: number;
  duration: number;
  /** 5 = triad, 7 = seventh, 9 = ninth, … */
  type?: number;
  inversion?: number;
  isRest?: boolean;
}

export interface HookpadDoc {
  version?: string;
  keys?: { beat: number; scale: string; tonic: string }[];
  tempos?: { beat: number; bpm: number }[];
  meters?: { beat: number; numBeats: number; beatUnit: number }[];
  notes?: HookpadNote[] | HookpadNote[][];
  chords?: HookpadChord[];
  endBeat?: number;
}

const TONIC_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Semitones of scale degrees 1..7 for each mode Hookpad names. */
const MODES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicminor: [0, 2, 3, 5, 7, 8, 11],
  melodicminor: [0, 2, 3, 5, 7, 9, 11],
};

export function parseHookpad(jsonData: string): HookpadDoc {
  const doc = JSON.parse(jsonData) as HookpadDoc;
  if (typeof doc !== "object" || doc === null) throw new Error("not a Hookpad document");
  return doc;
}

export function tonicPitchClass(tonic: string): number {
  const m = /^([A-Ga-g])([#b]?)$/.exec(tonic.trim());
  if (!m) throw new Error(`unknown tonic "${tonic}"`);
  let pc = TONIC_PC[m[1].toUpperCase()];
  if (m[2] === "#") pc += 1;
  if (m[2] === "b") pc -= 1;
  return ((pc % 12) + 12) % 12;
}

export function modeIntervals(scale: string): number[] {
  const key = scale.toLowerCase().replace(/[^a-z]/g, "");
  return MODES[key] ?? MODES.major;
}

/** MIDI pitch of a Hookpad note in a key. Octave 0 starts on the tonic in MIDI octave 4. */
export function hookpadPitch(sd: string, octave: number, tonic: string, scale: string): number {
  const m = /^([#b]*)([1-7])$/.exec(sd.trim());
  if (!m) throw new Error(`unknown scale degree "${sd}"`);
  const accidental = [...m[1]].reduce((n, c) => n + (c === "#" ? 1 : -1), 0);
  const degree = Number(m[2]);
  return 60 + tonicPitchClass(tonic) + modeIntervals(scale)[degree - 1] + accidental + 12 * octave;
}

/** The voices of a document: a flat note list is one voice. */
export function voices(doc: HookpadDoc): HookpadNote[][] {
  const n = doc.notes ?? [];
  if (n.length === 0) return [[]];
  return Array.isArray(n[0]) ? (n as HookpadNote[][]) : [n as HookpadNote[]];
}

/** Seconds from the section start for a 1-based beat, honouring tempo changes. */
export function secondsAtBeat(doc: HookpadDoc, beat: number): number {
  const tempos = [...(doc.tempos ?? [])].filter((t) => t.bpm > 0).sort((a, b) => a.beat - b.beat);
  if (tempos.length === 0) return ((beat - 1) * 60) / 120;
  let seconds = 0;
  let at = 1;
  let bpm = tempos[0].bpm;
  for (const t of tempos) {
    if (t.beat <= 1) {
      bpm = t.bpm;
      continue;
    }
    if (t.beat >= beat) break;
    seconds += ((t.beat - at) * 60) / bpm;
    at = t.beat;
    bpm = t.bpm;
  }
  return seconds + ((beat - at) * 60) / bpm;
}

export interface ConvertedSection {
  notes: Note[];
  chords: Chord[];
  /** Seconds the section spans (to its endBeat). */
  duration: number;
  bpm: number;
  timeSignature: [number, number];
  tonic: string;
  scale: string;
}

/** Key in force at a beat (Hookpad allows key changes mid-section). */
function keyAt(doc: HookpadDoc, beat: number): { tonic: string; scale: string } {
  const keys = [...(doc.keys ?? [])].sort((a, b) => a.beat - b.beat);
  let current = keys[0] ?? { beat: 1, tonic: "C", scale: "major" };
  for (const k of keys) if (k.beat <= beat) current = k;
  return { tonic: current.tonic, scale: current.scale };
}

/** Chord pitches: stacked thirds of the mode from the root degree, in octave 3. */
function chordPitches(c: HookpadChord, tonic: string, scale: string): number[] {
  const intervals = modeIntervals(scale);
  const count = c.type === 9 ? 5 : c.type === 7 ? 4 : 3;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const degreeIndex = c.root - 1 + 2 * i;
    const octaveUp = Math.floor(degreeIndex / 7);
    out.push(48 + tonicPitchClass(tonic) + intervals[degreeIndex % 7] + 12 * octaveUp);
  }
  return out;
}

/**
 * One section to notes and chords. Rests are dropped. Notes keep their
 * absolute Hookpad pitches; fitting to the kalimba happens later.
 */
export function convertSection(doc: HookpadDoc, voice = 0): ConvertedSection {
  const all = voices(doc);
  const chosen = all[Math.min(voice, all.length - 1)] ?? [];
  const notes: Note[] = [];
  for (const n of chosen) {
    if (n.isRest || !n.sd) continue;
    const { tonic, scale } = keyAt(doc, n.beat);
    const time = secondsAtBeat(doc, n.beat);
    const end = secondsAtBeat(doc, n.beat + n.duration);
    notes.push({ time: round(time), duration: round(Math.max(end - time, 0.05)), pitch: hookpadPitch(n.sd, n.octave, tonic, scale) });
  }
  const chords: Chord[] = [];
  for (const c of doc.chords ?? []) {
    if (c.isRest || !c.root) continue;
    const { tonic, scale } = keyAt(doc, c.beat);
    const time = secondsAtBeat(doc, c.beat);
    const end = secondsAtBeat(doc, c.beat + c.duration);
    chords.push({ time: round(time), duration: round(end - time), pitches: chordPitches(c, tonic, scale) });
  }
  const endBeat = doc.endBeat ?? Math.max(1, ...chosen.map((n) => n.beat + n.duration), ...(doc.chords ?? []).map((c) => c.beat + c.duration));
  const first = keyAt(doc, 1);
  const meter = doc.meters?.[0];
  return {
    notes,
    chords,
    duration: round(secondsAtBeat(doc, endBeat)),
    bpm: doc.tempos?.[0]?.bpm ?? 120,
    timeSignature: meter ? [meter.numBeats, meter.beatUnit === 1 ? 4 : 8] : [4, 4],
    tonic: first.tonic,
    scale: first.scale,
  };
}

/** Sections in order, each shifted after the last, with a marker at each start. */
export function concatSections(parts: { name: string; section: ConvertedSection }[]): { notes: Note[]; chords: Chord[]; sections: Section[] } {
  const notes: Note[] = [];
  const chords: Chord[] = [];
  const sections: Section[] = [];
  let offset = 0;
  for (const { name, section } of parts) {
    sections.push({ time: round(offset), label: name, marker: true });
    for (const n of section.notes) notes.push({ ...n, time: round(n.time + offset) });
    for (const c of section.chords) chords.push({ ...c, time: round(c.time + offset) });
    offset += section.duration;
  }
  return { notes, chords, sections };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
