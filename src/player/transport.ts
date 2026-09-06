// The one clock. Audio scheduling and the canvas both read song time from
// here, so they cannot drift apart (DESIGN.md §9, §14).
//
// Song time advances at `rate` × real time while playing. Real time comes
// from the AudioContext when one exists (it is the clock the synth schedules
// against) and from performance.now() before audio has been started by a
// user gesture.

export type TransportListener = () => void;

export class Transport {
  private ctx: AudioContext | null = null;
  private playing = false;
  /** Song time at the moment play() was last called. */
  private anchorSong = 0;
  /** Real time at the moment play() was last called. */
  private anchorReal = 0;
  private rate = 1;
  private durationSec = 0;
  private listeners = new Set<TransportListener>();

  /** Called after play, pause, seek, or rate changes. Not on every tick. */
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
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
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

  setDuration(seconds: number) {
    this.durationSec = Math.max(0, seconds);
    if (this.anchorSong > this.durationSec) this.anchorSong = this.durationSec;
    this.emit();
  }

  play() {
    if (this.playing) return;
    if (this.anchorSong >= this.durationSec) this.anchorSong = 0;
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
    this.anchorSong = Math.max(0, Math.min(songTime, this.durationSec));
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

  /** Called by the tick loop: stops at the end of the song. */
  tick() {
    if (this.playing && this.now() >= this.durationSec) {
      this.anchorSong = this.durationSec;
      this.playing = false;
      this.emit();
    }
  }
}
