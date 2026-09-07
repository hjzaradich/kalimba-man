// Sends upcoming notes (and metronome clicks) to the synth a little ahead
// of time, using the transport's clock so what you hear lands with what
// you see.

import type { Song } from "../model/song";
import type { Synth } from "./synth";
import type { Transport } from "./transport";

/** How far ahead of the clock events are handed to the synth, in real seconds. */
const LOOKAHEAD = 0.12;

export class Scheduler {
  private nextIndex = 0;
  private nextBeat = 0;
  private lastSongTime = -1;
  /** Sorted by time; the song's own order is not guaranteed. */
  private order: number[] = [];
  private metronome = false;
  /** Wait mode and recording play notes on the user's hit instead. */
  private muted = false;

  constructor(
    private readonly transport: Transport,
    private synth: Synth | null,
    private song: Song | null,
  ) {
    this.rebuild();
  }

  setSong(song: Song | null) {
    this.song = song;
    this.rebuild();
  }

  setSynth(synth: Synth | null) {
    this.synth = synth;
  }

  setMetronome(on: boolean) {
    this.metronome = on;
    this.lastSongTime = -1;
  }

  get metronomeOn(): boolean {
    return this.metronome;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.lastSongTime = -1;
  }

  private rebuild() {
    this.order = this.song ? this.song.notes.map((_, i) => i).sort((a, b) => this.song!.notes[a].time - this.song!.notes[b].time) : [];
    this.lastSongTime = -1;
    this.nextIndex = 0;
    this.nextBeat = 0;
  }

  /** Call every animation frame. */
  tick() {
    const { song, synth, transport } = this;
    if (!song || !synth || !transport.isPlaying) {
      this.lastSongTime = -1;
      return;
    }
    const now = transport.now();
    const beatSec = 60 / song.bpm;
    // After a seek, a loop wrap, or on first play, start from now.
    if (this.lastSongTime < 0 || now < this.lastSongTime - 0.001) {
      this.nextIndex = lowerBound(this.order, song.notes, now);
      this.nextBeat = Math.ceil((now - 1e-6) / beatSec);
    }
    const horizon = now + LOOKAHEAD * transport.playbackRate;

    if (!this.muted) {
      while (this.nextIndex < this.order.length) {
        const note = song.notes[this.order[this.nextIndex]];
        if (note.time > horizon) break;
        synth.pluck(note.pitch, transport.realTimeFor(note.time));
        this.nextIndex++;
      }
    }

    if (this.metronome) {
      const beatsPerBar = Math.max(1, song.timeSignature[0]);
      while (this.nextBeat * beatSec <= horizon) {
        const t = this.nextBeat * beatSec;
        if (t >= now - 0.05) synth.click(transport.realTimeFor(t), this.nextBeat % beatsPerBar === 0);
        this.nextBeat++;
      }
    }
    this.lastSongTime = now;
  }
}

function lowerBound(order: number[], notes: Song["notes"], t: number): number {
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[order[mid]].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
