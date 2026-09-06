// Turns what the Rust importer fetched into a Song. DESIGN.md §6.

import { invoke } from "@tauri-apps/api/core";
import { parseNotation, type ParseResult } from "./model/notation";
import { notationFromNotes } from "./model/notationOut";
import { DEFAULT_TEXT_BPM, songFromText, type Song } from "./model/song";
import { isTauri } from "./settings";

export interface MidiImport {
  bpm: number;
  timeSignature: [number, number];
  notes: { time: number; duration: number; pitch: number }[];
}

export interface ImportResult {
  sourceUrl: string;
  title: string;
  artist?: string | null;
  kind: "midi" | "text";
  midi?: MidiImport | null;
  text?: string | null;
  warning?: string | null;
}

export async function importFromUrl(url: string): Promise<ImportResult> {
  if (!isTauri()) {
    throw new Error("Importing from a URL needs the desktop app; paste the tab text instead.");
  }
  return invoke<ImportResult>("import_url", { url: url.trim() });
}

export interface BuiltSong {
  song: Song;
  parse: ParseResult | null;
}

/**
 * A Song from an import. MIDI gives measured timing and a generated text
 * for the editor; text goes through the parser with uniform timing.
 */
export function songFromImport(r: ImportResult, overrides: { title?: string; artist?: string; bpm?: number } = {}): BuiltSong {
  const title = (overrides.title ?? r.title).trim() || "Untitled";
  const artist = (overrides.artist ?? r.artist ?? "").trim() || undefined;
  const source = { url: r.sourceUrl, fetchedAt: new Date().toISOString(), kind: r.kind } as const;

  if (r.kind === "midi" && r.midi) {
    const bpm = Math.round(r.midi.bpm * 100) / 100;
    const notes = r.midi.notes.map((n) => ({ time: n.time, duration: n.duration, pitch: n.pitch }));
    const partial = { notes, bpm, timeSignature: r.midi.timeSignature };
    const song: Song = {
      version: 1,
      title,
      artist,
      source,
      bpm,
      timeSignature: r.midi.timeSignature,
      timing: "measured",
      notes,
      sections: [],
      text: notationFromNotes(partial),
    };
    return { song, parse: null };
  }

  const text = r.text ?? "";
  const parse = parseNotation(text);
  const song = songFromText(text, { title, artist, bpm: overrides.bpm ?? DEFAULT_TEXT_BPM }, parse.events);
  song.source = source;
  return { song, parse };
}
