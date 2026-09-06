// Parser for kalimba number notation as typed on kalimbatabs.net and similar
// sites. See DESIGN.md §5. The parser is deliberately tolerant: posts are
// hand-typed, so anything it cannot read becomes a warning, never a crash and
// never a silently dropped note.
//
// Output is a flat list of events in reading order. Timing is not decided
// here; song.ts turns events into timed notes.

import { MIDI_C4 } from "./layout";

export interface NoteEvent {
  kind: "note";
  /** One pitch for a single note, several for a "( )" chord. */
  pitches: number[];
  /** Number of "~" long-note marks. Each one doubles the duration. */
  long: number;
  /** Source text, e.g. "1°" or "(1 3 5)". */
  text: string;
  line: number;
}

export interface RestEvent {
  kind: "rest";
  line: number;
}

/** A blank line between note lines. song.ts turns it into a short gap. */
export interface BreakEvent {
  kind: "break";
  line: number;
}

/** A lyric or section line. */
export interface TextEvent {
  kind: "text";
  text: string;
  /** True for "#A"-style section markers. */
  section: boolean;
  line: number;
}

export type NotationEvent = NoteEvent | RestEvent | BreakEvent | TextEvent;

export interface Warning {
  line: number;
  col: number;
  message: string;
}

export interface ParseResult {
  events: NotationEvent[];
  warnings: Warning[];
}

/** Semitone offset of degrees 1..7 in a major scale. Index 0 unused. */
const DEGREE_SEMITONES = [0, 0, 2, 4, 5, 7, 9, 11];

/** Characters that raise a note by one octave when they follow the digit. */
const OCTAVE_UP = new Set(["°", "º", "˚", "'", "*", "^"]);
/** Characters that lower a note by one octave when they precede the digit. */
const OCTAVE_DOWN_PREFIX = new Set([".", ","]);

const SECTION_LINE = /^\s*#\s*[A-Za-z0-9]+\s*$/;
/** A run of two or more letters means prose: lyrics, headings, comments. */
const HAS_WORD = /[A-Za-z]{2,}/;

/**
 * Parse number notation into events. `keyOffset` shifts every pitch by that
 * many semitones, for tabs written relative to a key other than C.
 */
export function parseNotation(text: string, keyOffset = 0): ParseResult {
  const events: NotationEvent[] = [];
  const warnings: Warning[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  let sawNotes = false;
  let pendingBreak = false;

  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();

    if (trimmed === "") {
      if (sawNotes) pendingBreak = true;
      return;
    }

    if (SECTION_LINE.test(trimmed)) {
      events.push({ kind: "text", text: trimmed.replace(/^#\s*/, ""), section: true, line });
      return;
    }

    if (HAS_WORD.test(trimmed) || !/[1-7]/.test(trimmed)) {
      events.push({ kind: "text", text: trimmed, section: false, line });
      return;
    }

    const lineEvents = parseNoteLine(raw, line, keyOffset, warnings);
    if (lineEvents.length === 0) return;
    if (pendingBreak) {
      events.push({ kind: "break", line });
      pendingBreak = false;
    }
    events.push(...lineEvents);
    sawNotes = true;
  });

  return { events, warnings };
}

function parseNoteLine(raw: string, line: number, keyOffset: number, warnings: Warning[]): NotationEvent[] {
  const out: NotationEvent[] = [];
  let i = 0;
  const n = raw.length;

  // Chord state: while non-null, notes accumulate here instead of `out`.
  let chord: { pitches: number[]; long: number; start: number } | null = null;

  const emitNote = (pitch: number, long: number, start: number) => {
    if (chord) {
      chord.pitches.push(pitch);
      chord.long = Math.max(chord.long, long);
    } else {
      out.push({ kind: "note", pitches: [pitch], long, text: raw.slice(start, i), line });
    }
  };

  while (i < n) {
    const ch = raw[i];

    if (ch === " " || ch === "\t" || ch === "|" || ch === "/") {
      i++;
      continue;
    }

    if (ch === "(" || ch === "[") {
      if (chord) warnings.push({ line, col: i + 1, message: "Nested chord bracket ignored." });
      else chord = { pitches: [], long: 0, start: i };
      i++;
      continue;
    }

    if (ch === ")" || ch === "]") {
      if (!chord) {
        warnings.push({ line, col: i + 1, message: "Closing bracket with no opening bracket." });
      } else {
        i++;
        // Long marks may follow the closing bracket.
        let long = chord.long;
        while (i < n && raw[i] === "~") {
          long++;
          i++;
        }
        if (chord.pitches.length > 0) {
          out.push({ kind: "note", pitches: chord.pitches, long, text: raw.slice(chord.start, i), line });
        } else {
          warnings.push({ line, col: chord.start + 1, message: "Empty chord bracket." });
        }
        chord = null;
        continue;
      }
      i++;
      continue;
    }

    if ((ch === "-" || ch === "_") && isStandalone(raw, i)) {
      out.push({ kind: "rest", line });
      i++;
      continue;
    }

    // A note: [.,]* [#b]? digit [#b]? [octave marks]* [~]*
    const start = i;
    let octave = 0;
    while (i < n && OCTAVE_DOWN_PREFIX.has(raw[i])) {
      octave--;
      i++;
    }
    let accidental = 0;
    if (i < n && (raw[i] === "#" || raw[i] === "b") && i + 1 < n && /[1-7]/.test(raw[i + 1])) {
      accidental = raw[i] === "#" ? 1 : -1;
      i++;
    }
    if (i < n && /[1-7]/.test(raw[i])) {
      const degree = Number(raw[i]);
      i++;
      if (i < n && (raw[i] === "#" || raw[i] === "b") && accidental === 0) {
        // "b" is only a flat when it does not start a word.
        if (raw[i] === "#" || !(i + 1 < n && /[A-Za-z]/.test(raw[i + 1]))) {
          accidental = raw[i] === "#" ? 1 : -1;
          i++;
        }
      }
      while (i < n && (OCTAVE_UP.has(raw[i]) || (raw[i] === "." && !isSentenceDot(raw, i)))) {
        octave++;
        i++;
      }
      let long = 0;
      while (i < n && raw[i] === "~") {
        long++;
        i++;
      }
      const pitch = MIDI_C4 + DEGREE_SEMITONES[degree] + accidental + octave * 12 + keyOffset;
      emitNote(pitch, long, start);
      continue;
    }

    // Nothing we understand. Skip one character and say so, but do not spam
    // a warning per character of a longer run.
    let j = i + 1;
    while (j < n && !/[\s1-7()\[\]]/.test(raw[j])) j++;
    const junk = raw.slice(start, j);
    if (/[089]/.test(junk)) {
      warnings.push({ line, col: start + 1, message: `"${junk}" is not a note; digits must be 1–7.` });
    } else {
      warnings.push({ line, col: start + 1, message: `Could not read "${junk}".` });
    }
    i = j;
  }

  if (chord) {
    warnings.push({ line, col: chord.start + 1, message: "Chord bracket never closed; notes kept as a chord." });
    if (chord.pitches.length > 0) {
      out.push({ kind: "note", pitches: chord.pitches, long: chord.long, text: raw.slice(chord.start), line });
    }
  }

  return out;
}

function isStandalone(raw: string, i: number): boolean {
  const before = i === 0 ? " " : raw[i - 1];
  const after = i + 1 >= raw.length ? " " : raw[i + 1];
  return /\s/.test(before) && /\s/.test(after);
}

/** A "." at the end of a line or before a space is punctuation, not an octave mark. */
function isSentenceDot(raw: string, i: number): boolean {
  const after = i + 1 >= raw.length ? " " : raw[i + 1];
  return /\s/.test(after);
}

/** Human-readable count of what a parse produced, for status lines. */
export function summarize(result: ParseResult): string {
  const notes = result.events.filter((e) => e.kind === "note").length;
  const warnings = result.warnings.length;
  return `${notes} note${notes === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`;
}
