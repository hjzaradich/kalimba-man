// Song model: what the player plays. See DESIGN.md §4.2. Times are seconds
// at the song's base BPM; the tempo slider scales playback, never the file.

import type { NotationEvent } from "./notation";

export type Timing = "measured" | "recorded" | "uniform";

export interface Note {
  /** Seconds from song start. */
  time: number;
  /** Seconds. */
  duration: number;
  /** MIDI pitch. */
  pitch: number;
  /** Notes with the same chord id were in one "( )" group. */
  chord?: number;
  /** Optional pin to a specific tine index in the layout. */
  tine?: number;
}

export interface Section {
  time: number;
  label: string;
  /** True for "#A"-style markers, false for lyric lines. */
  marker: boolean;
}

export interface SongSource {
  url: string;
  fetchedAt: string;
  kind: "midi" | "text";
}

export interface Song {
  version: 1;
  title: string;
  artist?: string;
  source?: SongSource;
  bpm: number;
  timeSignature: [number, number];
  timing: Timing;
  notes: Note[];
  sections: Section[];
  /** The original notation, kept so the editor can round-trip. */
  text?: string;
}

export const DEFAULT_TEXT_BPM = 100;

export interface UniformTimingOptions {
  bpm?: number;
  /** Fraction of a beat a note is drawn as sounding. */
  gate?: number;
  /** Beats of silence inserted for a blank line between note lines. */
  breakBeats?: number;
}

/**
 * Give parsed notation uniform timing: every note or chord is one beat, a
 * "~" doubles it, a rest is one beat, a blank line is a short gap. Lyric and
 * section lines become section markers at the time of the next note.
 */
export function notesFromEvents(events: NotationEvent[], options: UniformTimingOptions = {}): Pick<Song, "notes" | "sections"> {
  const bpm = options.bpm ?? DEFAULT_TEXT_BPM;
  const gate = options.gate ?? 0.9;
  const breakBeats = options.breakBeats ?? 0.5;
  const beat = 60 / bpm;

  const notes: Note[] = [];
  const sections: Section[] = [];
  let t = 0;
  let chordId = 0;

  for (const e of events) {
    switch (e.kind) {
      case "note": {
        const beats = 2 ** e.long;
        const duration = beat * beats * gate;
        if (e.pitches.length === 1) {
          notes.push({ time: t, duration, pitch: e.pitches[0] });
        } else {
          chordId++;
          for (const pitch of e.pitches) notes.push({ time: t, duration, pitch, chord: chordId });
        }
        t += beat * beats;
        break;
      }
      case "rest":
        t += beat;
        break;
      case "break":
        t += beat * breakBeats;
        break;
      case "text":
        sections.push({ time: t, label: e.text, marker: e.section });
        break;
    }
  }
  return { notes, sections };
}

export function songFromText(text: string, meta: { title: string; artist?: string; bpm?: number }, events: NotationEvent[]): Song {
  const bpm = meta.bpm ?? DEFAULT_TEXT_BPM;
  const { notes, sections } = notesFromEvents(events, { bpm });
  return {
    version: 1,
    title: meta.title,
    artist: meta.artist,
    bpm,
    timeSignature: [4, 4],
    timing: "uniform",
    notes,
    sections,
    text,
  };
}

/** Seconds from start to the end of the last note. */
export function songDuration(song: Song): number {
  return song.notes.reduce((end, n) => Math.max(end, n.time + n.duration), 0);
}

/**
 * Rescale a song to a new base BPM, keeping every note's position in beats.
 * Used by the editor when the user changes the BPM field.
 */
export function withBpm(song: Song, bpm: number): Song {
  const k = song.bpm / bpm;
  return {
    ...song,
    bpm,
    notes: song.notes.map((n) => ({ ...n, time: n.time * k, duration: n.duration * k })),
    sections: song.sections.map((s) => ({ ...s, time: s.time * k })),
  };
}

export function transpose(song: Song, semitones: number): Song {
  if (semitones === 0) return song;
  return { ...song, notes: song.notes.map((n) => ({ ...n, pitch: n.pitch + semitones })) };
}

/** A filesystem-safe name for a song file. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "untitled";
}

/** Validate an object read from disk. Returns null when it is not a song. */
export function coerceSong(value: unknown): Song | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.title !== "string" || !Array.isArray(v.notes)) return null;
  const notes: Note[] = [];
  for (const n of v.notes as unknown[]) {
    if (typeof n !== "object" || n === null) return null;
    const x = n as Record<string, unknown>;
    if (typeof x.time !== "number" || typeof x.duration !== "number" || typeof x.pitch !== "number") return null;
    notes.push({
      time: x.time,
      duration: x.duration,
      pitch: x.pitch,
      ...(typeof x.chord === "number" ? { chord: x.chord } : {}),
      ...(typeof x.tine === "number" ? { tine: x.tine } : {}),
    });
  }
  const timing: Timing = v.timing === "measured" || v.timing === "recorded" ? v.timing : "uniform";
  const sections: Section[] = Array.isArray(v.sections)
    ? (v.sections as unknown[]).flatMap((s) => {
        const y = s as Record<string, unknown>;
        return typeof y?.time === "number" && typeof y?.label === "string"
          ? [{ time: y.time, label: y.label, marker: y.marker === true }]
          : [];
      })
    : [];
  return {
    version: 1,
    title: v.title,
    artist: typeof v.artist === "string" ? v.artist : undefined,
    source: isSource(v.source) ? v.source : undefined,
    bpm: typeof v.bpm === "number" && v.bpm > 0 ? v.bpm : DEFAULT_TEXT_BPM,
    timeSignature: Array.isArray(v.timeSignature) && v.timeSignature.length === 2 ? (v.timeSignature as [number, number]) : [4, 4],
    timing,
    notes,
    sections,
    text: typeof v.text === "string" ? v.text : undefined,
  };
}

function isSource(s: unknown): s is SongSource {
  if (typeof s !== "object" || s === null) return false;
  const v = s as Record<string, unknown>;
  return typeof v.url === "string" && typeof v.fetchedAt === "string" && (v.kind === "midi" || v.kind === "text");
}
