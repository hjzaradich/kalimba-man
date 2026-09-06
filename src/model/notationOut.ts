// The reverse of the parser: write notes back as number notation so a song
// imported from MIDI can be read and edited as text. Chords become "( )"
// groups, one measure per line.

import { MIDI_C4 } from "./layout";
import type { Note, Song } from "./song";

const DEGREE_OF_PITCH_CLASS: (number | null)[] = [1, null, 2, null, 3, 4, null, 5, null, 6, null, 7];

/** "1", "1°", "1°°", ".1", "4#°" */
export function tokenForPitch(pitch: number): string {
  const pc = ((pitch % 12) + 12) % 12;
  const octave = Math.floor(pitch / 12) - Math.floor(MIDI_C4 / 12);
  const degree = DEGREE_OF_PITCH_CLASS[pc];
  const body = degree !== null ? String(degree) : `${DEGREE_OF_PITCH_CLASS[pc - 1]}#`;
  if (octave >= 0) return body + "°".repeat(octave);
  return ".".repeat(-octave) + body;
}

/** Notes that start within this many seconds of each other are one chord. */
const CHORD_WINDOW = 0.03;

/**
 * Render a song's notes as notation text. Notes are grouped by start time;
 * a new line starts at each measure boundary computed from the song's BPM
 * and time signature.
 */
export function notationFromNotes(song: Pick<Song, "notes" | "bpm" | "timeSignature">): string {
  const notes = [...song.notes].sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  if (notes.length === 0) return "";
  const beat = 60 / song.bpm;
  const measure = beat * song.timeSignature[0];

  const groups: Note[][] = [];
  for (const n of notes) {
    const last = groups[groups.length - 1];
    if (last && n.time - last[0].time <= CHORD_WINDOW) last.push(n);
    else groups.push([n]);
  }

  const lines: string[] = [];
  let line: string[] = [];
  let lineMeasure = -1;
  for (const g of groups) {
    const m = Math.floor(g[0].time / measure + 1e-6);
    if (m !== lineMeasure && line.length > 0) {
      lines.push(line.join(" "));
      line = [];
    }
    lineMeasure = m;
    const tokens = g.map((n) => tokenForPitch(n.pitch));
    line.push(tokens.length === 1 ? tokens[0] : `(${tokens.join(" ")})`);
  }
  if (line.length > 0) lines.push(line.join(" "));
  return lines.join("\n");
}
