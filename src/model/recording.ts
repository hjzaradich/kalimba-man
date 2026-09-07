// Tap-to-record (DESIGN.md §7.2): the user taps once per note or chord in
// wait mode, the taps are quantized to a grid, and the song is re-timed.
// Everything here is pure so it can be tested without a clock.

import type { Note, Section, Song } from "./song";

/** One tap's worth of notes: a single note or the members of a chord. */
export interface HitGroup {
  /** Time in the song as currently timed. */
  time: number;
  /** Indices into song.notes. */
  notes: number[];
}

/** Notes that start within this many seconds of each other are one group. */
export const GROUP_WINDOW = 0.03;

export function groupNotes(notes: Note[], window = GROUP_WINDOW): HitGroup[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].time - notes[b].time || notes[a].pitch - notes[b].pitch);
  const groups: HitGroup[] = [];
  for (const i of order) {
    const last = groups[groups.length - 1];
    if (last && notes[i].time - last.time <= window) last.notes.push(i);
    else groups.push({ time: notes[i].time, notes: [i] });
  }
  return groups;
}

/** First group whose time is at or after `t`. */
export function groupAtOrAfter(groups: HitGroup[], t: number): number {
  let lo = 0;
  let hi = groups.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid].time < t - 1e-6) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface RecordOptions {
  /** Grid as a fraction of a beat. 0.25 = sixteenth notes. */
  grid?: number;
  /** Fraction of the gap to the next group a note keeps sounding. */
  gate?: number;
}

/**
 * Re-time a song from tap timestamps, one per group, in seconds on any
 * monotonic clock. The first tap becomes time 0. Taps are quantized to the
 * grid at the song's BPM; two groups can never share a slot. Durations
 * become a fraction of the gap to the next group. Sections move with the
 * first group at or after their old time.
 */
export function applyRecordedTiming(song: Song, groups: HitGroup[], taps: number[], options: RecordOptions = {}): Song {
  if (taps.length !== groups.length) {
    throw new Error(`recorded ${taps.length} taps for ${groups.length} groups`);
  }
  const grid = (options.grid ?? 0.25) * (60 / song.bpm);
  const gate = options.gate ?? 0.9;
  const beat = 60 / song.bpm;

  const times: number[] = [];
  let prev = -Infinity;
  for (let i = 0; i < taps.length; i++) {
    const rel = taps[i] - taps[0];
    let q = Math.round(rel / grid) * grid;
    if (q <= prev) q = prev + grid;
    q = Math.round(q * 1000) / 1000;
    times.push(q);
    prev = q;
  }

  const notes = song.notes.map((n) => ({ ...n }));
  groups.forEach((g, i) => {
    const next = i + 1 < times.length ? times[i + 1] : times[i] + beat;
    const duration = Math.round((next - times[i]) * gate * 1000) / 1000;
    for (const idx of g.notes) {
      notes[idx] = { ...notes[idx], time: times[i], duration };
    }
  });

  const sections: Section[] = song.sections.map((s) => {
    const gi = groupAtOrAfter(groups, s.time);
    const time = gi < times.length ? times[gi] : times[times.length - 1] + beat;
    return { ...s, time };
  });

  return { ...song, timing: "recorded", notes, sections };
}
