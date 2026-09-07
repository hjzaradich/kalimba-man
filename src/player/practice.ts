// Wait mode and tap-to-record (DESIGN.md §7.2, §8).
//
// Both are the same mechanism: the song is split into hit groups (a note or
// a chord), and the user "plays" a group with Space or a click. In wait mode
// playback runs until the next group reaches the line, pauses there, and
// resumes on the hit. In record mode nothing runs on its own: each hit
// sounds the group, remembers when it happened, and jumps to the next group.

import { groupAtOrAfter, groupNotes, type HitGroup } from "../model/recording";
import type { Song } from "../model/song";
import type { Scheduler } from "./scheduler";
import type { Synth } from "./synth";
import type { Transport } from "./transport";

export type PracticeMode = "off" | "wait" | "record";

export interface PracticeState {
  mode: PracticeMode;
  /** True while the app is holding for the user's hit. */
  waiting: boolean;
  /** Index of the group the next hit will play. */
  next: number;
  total: number;
}

export type PracticeEvent = { type: "state"; state: PracticeState } | { type: "recorded"; taps: number[]; state: PracticeState };

export class Practice {
  private mode: PracticeMode = "off";
  private groups: HitGroup[] = [];
  private song: Song | null = null;
  private next = 0;
  private waiting = false;
  private taps: number[] = [];
  /** Set around our own transport calls so the subscription ignores them. */
  private internal = false;
  private unsubscribe: () => void;

  constructor(
    private readonly transport: Transport,
    private readonly scheduler: Scheduler,
    private readonly getSynth: () => Synth | null,
    private readonly onEvent: (e: PracticeEvent) => void,
    private readonly clock: () => number = () => performance.now() / 1000,
  ) {
    // A manual seek moves the cursor; our own calls are flagged internal.
    this.unsubscribe = transport.subscribe(() => {
      if (this.internal || this.mode === "off") return;
      this.next = groupAtOrAfter(this.groups, transport.now());
      this.waiting = this.mode === "record" && this.next < this.groups.length;
      this.onEvent({ type: "state", state: this.state });
    });
  }

  dispose() {
    this.unsubscribe();
  }

  get state(): PracticeState {
    return { mode: this.mode, waiting: this.waiting, next: this.next, total: this.groups.length };
  }

  /** Note indices of the group being waited for, for the renderer. */
  get pendingNotes(): number[] {
    return this.waiting && this.next < this.groups.length ? this.groups[this.next].notes : [];
  }

  setSong(song: Song | null) {
    this.song = song;
    this.groups = song ? groupNotes(song.notes) : [];
    this.setMode("off");
  }

  setMode(mode: PracticeMode) {
    this.mode = mode;
    this.taps = [];
    this.waiting = false;
    this.scheduler.setMuted(mode !== "off");
    if (mode === "off") {
      this.onEvent({ type: "state", state: this.state });
      return;
    }
    this.guarded(() => {
      this.transport.pause();
      if (mode === "record") this.transport.seek(0);
    });
    this.next = groupAtOrAfter(this.groups, this.transport.now());
    if (mode === "record") {
      this.waiting = this.next < this.groups.length;
    }
    this.onEvent({ type: "state", state: this.state });
  }

  /** Call every animation frame. */
  tick() {
    if (this.mode !== "wait" || this.waiting || !this.transport.isPlaying) return;
    if (this.next >= this.groups.length) return;
    const g = this.groups[this.next];
    if (this.transport.now() >= g.time - 0.002) {
      this.guarded(() => {
        this.transport.pause();
        this.transport.seek(g.time);
      });
      this.waiting = true;
      this.onEvent({ type: "state", state: this.state });
    }
  }

  /** The user played the pending group. Returns false when there was nothing to hit. */
  hit(): boolean {
    if (this.mode === "off" || !this.waiting || !this.song) return false;
    const g = this.groups[this.next];
    const synth = this.getSynth();
    const ctx = this.transport.audioContext;
    if (synth && ctx) {
      for (const idx of g.notes) synth.pluck(this.song.notes[idx].pitch, ctx.currentTime);
    }
    if (this.mode === "record") this.taps.push(this.clock());

    this.next++;
    this.waiting = false;
    const finished = this.next >= this.groups.length;

    if (this.mode === "wait") {
      this.guarded(() => {
        if (!finished) this.transport.play();
      });
    } else if (finished) {
      const taps = this.taps;
      this.taps = [];
      this.onEvent({ type: "recorded", taps, state: this.state });
    } else {
      this.waiting = true;
      this.guarded(() => this.transport.seek(this.groups[this.next].time));
    }
    this.onEvent({ type: "state", state: this.state });
    return true;
  }

  private guarded(fn: () => void) {
    this.internal = true;
    try {
      fn();
    } finally {
      this.internal = false;
    }
  }
}
