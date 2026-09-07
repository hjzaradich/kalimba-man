// Turns what the Rust importer fetched into a Song. DESIGN.md §6.

import { invoke } from "@tauri-apps/api/core";
import { applyFitToSong, bestFit, describeFit, evaluateFit, type Fit } from "./model/fit";
import { concatSections, convertSection, parseHookpad, voices, type ConvertedSection } from "./model/hookpad";
import type { Layout } from "./model/layout";
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

// ---- TheoryTab (DESIGN.md §6.4, §6.5) ---------------------------------------

export interface TheoryTabSection {
  id: string;
  name: string;
  jsonData: string;
}

export interface TheoryTabImport {
  sourceUrl: string;
  title: string;
  artist?: string | null;
  sections: TheoryTabSection[];
  failed: string[];
}

export async function importFromTheoryTab(url: string): Promise<TheoryTabImport> {
  if (!isTauri()) {
    throw new Error("Importing from TheoryTab needs the desktop app.");
  }
  return invoke<TheoryTabImport>("import_theorytab", { url: url.trim() });
}

export interface TheoryTabOptions {
  /** Section ids to include, in page order. Default: all. */
  sectionIds?: string[];
  /** Melody voice index. Default 0. */
  voice?: number;
  /** Override the automatic fit with a fixed shift (semitones within the octave, whole octaves). */
  fit?: { semitones: number; octaves: number };
  title?: string;
  artist?: string;
}

export interface TheoryTabBuild {
  song: Song;
  fit: Fit;
  /** Key of the first section, e.g. "D major". */
  key: string;
  voiceCount: number;
  /** The song before fitting, so a different fit can be applied without re-parsing. */
  unfitted: Song;
}

/** Parse every section once; cheap enough to redo on each option change. */
export function convertTheoryTab(r: TheoryTabImport, voice = 0): { parts: { id: string; name: string; section: ConvertedSection }[]; voiceCount: number } {
  let voiceCount = 1;
  const parts = r.sections.map((s) => {
    const doc = parseHookpad(s.jsonData);
    voiceCount = Math.max(voiceCount, voices(doc).filter((v) => v.length > 0).length);
    return { id: s.id, name: s.name, section: convertSection(doc, voice) };
  });
  return { parts, voiceCount };
}

/** A fitted, measured song from a TheoryTab import. */
export function songFromTheoryTab(r: TheoryTabImport, layout: Layout, options: TheoryTabOptions = {}): TheoryTabBuild {
  const { parts, voiceCount } = convertTheoryTab(r, options.voice ?? 0);
  const chosen = options.sectionIds ? parts.filter((p) => options.sectionIds!.includes(p.id)) : parts;
  const used = chosen.length ? chosen : parts;
  const { notes, chords, sections } = concatSections(used);
  const first = used[0].section;
  const key = `${first.tonic} ${first.scale}`;
  const title = (options.title ?? r.title).trim() || "Untitled";
  const artist = (options.artist ?? r.artist ?? "").trim() || undefined;

  const unfitted: Song = {
    version: 1,
    title,
    artist,
    source: { url: r.sourceUrl, fetchedAt: new Date().toISOString(), kind: "theorytab" },
    bpm: first.bpm,
    timeSignature: first.timeSignature,
    timing: "measured",
    notes,
    sections,
    chords,
  };

  const pitches = notes.map((n) => n.pitch);
  const fit = options.fit ? evaluateFit(pitches, layout, options.fit.semitones, options.fit.octaves) : bestFit(pitches, layout);
  const fitted = applyFitToSong(unfitted, fit, layout);
  fitted.text = notationFromNotes(fitted);
  fitted.about = `From TheoryTab in ${key}; ${describeFit(fit, first.tonic)}.`;
  return { song: fitted, fit, key, voiceCount, unfitted };
}
