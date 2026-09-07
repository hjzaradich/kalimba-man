// The one clock. Audio scheduling and the canvas both read song time from
// here, so they cannot drift apart (DESIGN.md §9, §14).
//
// Song time advances at `rate` × real time while playing. Real time comes
// from the AudioContext when one exists (it is the clock the synth schedules
// against) and from performance.now() before audio has been started by a
// user gesture. Tests inject their own clock.

export type TransportListener = () => void;

export interface LoopRegion {
  a: number;
  b: number;
}

/** Shortest loop worth having, in seconds. */
export const MIN_LOOP = 0.25;

/**
 * Real seconds of silence before the song when playing from the start, so
 * the first note is not scheduled the instant the audio engine wakes and the
 * player has time to get ready. Song time is negative during it; the
 * negative span is scaled by the playback rate so the wait is the same on
 * the clock at any tempo.
 */
export const LEAD_IN = 3;

export class Transport {
  private ctx: AudioContext | null = null;
  private playing = false;
  /** Song time at the moment play() was last called. */
  private anchorSong = 0;
  /** Real time at the moment play() was last called. */
  private anchorReal = 0;
  private rate = 1;
  private durationSec = 0;
  private loopRegion: LoopRegion | null = null;
  private listeners = new Set<TransportListener>();

  constructor(
    private readonly clock: () => number = () => performance.now() / 1000,
    public leadIn: number = LEAD_IN,
  ) {}

  /** Called after play, pause, seek, rate or loop changes. Not on every tick. */
  subscribe(fn: TransportListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Attach the audio clock. Must be called from a user gesture on WebKit. */
  attachAudio(ctx: AudioContext) {
    const wasPlaying = this.playing;
    const t = this.now();
    this.ctx = ctx;
    if (wasPlaying) {
      this.anchorSong = t;
      this.anchorReal = this.realNow();
    }
  }

  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  private realNow(): number {
    return this.ctx ? this.ctx.currentTime : this.clock();
  }

  /** Current song time in seconds. */
  now(): number {
    if (!this.playing) return this.anchorSong;
    const t = this.anchorSong + (this.realNow() - this.anchorReal) * this.rate;
    return Math.min(t, this.durationSec);
  }

  /** Real (clock) time at which a given song time will occur. Only meaningful while playing. */
  realTimeFor(songTime: number): number {
    return this.anchorReal + (songTime - this.anchorSong) / this.rate;
  }

  get isPlaying(): boolean {
    return this.playing && this.now() < this.durationSec;
  }

  get playbackRate(): number {
    return this.rate;
  }

  get duration(): number {
    return this.durationSec;
  }

  get loop(): LoopRegion | null {
    return this.loopRegion;
  }

  setDuration(seconds: number) {
    this.durationSec = Math.max(0, seconds);
    if (this.anchorSong > this.durationSec) this.anchorSong = this.durationSec;
    this.loopRegion = null;
    this.emit();
  }

  play() {
    if (this.playing) return;
    if (this.anchorSong >= this.durationSec) this.anchorSong = this.loopRegion?.a ?? 0;
    // From the very start, begin in the lead-in: leadIn real seconds.
    if (this.anchorSong <= 0) this.anchorSong = -this.leadIn * this.rate;
    this.anchorReal = this.realNow();
    this.playing = true;
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.anchorSong = this.now();
    this.playing = false;
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(songTime: number) {
    this.anchorSong = Math.max(-this.leadIn * this.rate, Math.min(songTime, this.durationSec));
    this.anchorReal = this.realNow();
    this.emit();
  }

  setRate(rate: number) {
    const t = this.now();
    this.rate = Math.max(0.05, rate);
    this.anchorSong = t;
    this.anchorReal = this.realNow();
    this.emit();
  }

  /** Loop between two song times; order does not matter. Too-short loops are ignored. */
  setLoop(a: number, b: number): boolean {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(this.durationSec, Math.max(a, b));
    if (hi - lo < MIN_LOOP) return false;
    this.loopRegion = { a: lo, b: hi };
    this.emit();
    return true;
  }

  clearLoop() {
    if (!this.loopRegion) return;
    this.loopRegion = null;
    this.emit();
  }

  /** Real seconds left in the lead-in, or 0 once the song has started. */
  leadInRemaining(): number {
    const t = this.now();
    return t < 0 ? -t / this.rate : 0;
  }

  /** Called by the tick loop: wraps the loop and stops at the end of the song. */
  tick() {
    if (!this.playing) return;
    const t = this.now();
    if (this.loopRegion && t >= this.loopRegion.b) {
      // Carry the overshoot so tempo stays steady across the wrap.
      const over = Math.min(t - this.loopRegion.b, 0.1);
      this.anchorSong = this.loopRegion.a + over;
      this.anchorReal = this.realNow();
      this.emit();
      return;
    }
    if (t >= this.durationSec) {
      this.anchorSong = this.durationSec;
      this.playing = false;
      this.emit();
    }
  }
}
