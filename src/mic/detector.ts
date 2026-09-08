// Turns microphone hops into "tine N was plucked at time T" (DESIGN.md
// §16.5). Pure: it takes arrays and a clock time and returns hits, so the
// tests drive it with synthetic notes and recordings of the instrument.
//
// The idea in one paragraph. The layout says which frequencies can occur,
// so this never asks "what pitch is this?", only "which known frequency
// just started?". Each hop the last 85 ms are windowed and transformed.
// The positive difference against the spectrum from three hops earlier
// (the flux) is what is *new*; when its sum jumps above an adaptive
// threshold an onset opens, and its exact moment is read off the energy
// envelope. The pitch is decided later, seven hops on, when the note fills
// most of the window and its peak is sharp: the spectrum then, minus the
// spectrum from before the onset, holds only what the onset added, so
// notes still ringing cancel out and a chord shows as several peaks. Each
// peak is interpolated, snapped to the nearest layout pitch within a
// tolerance, and kept only if the frequency is still sounding in the last
// 21 ms: kalimba notes ring for seconds, while the inharmonic overtones,
// the metronome click and a knock on the table are gone by then.

import type { Layout } from "../model/layout";
import { FFT, goertzel, hann } from "./fft";

export interface DetectorOptions {
  sampleRate: number;
  /** Samples per hop handed to `push`. */
  hop?: number;
  /** Analysis window in samples, a power of two. */
  window?: number;
  /** How far a peak may sit from a tine's nominal pitch and still count. */
  toleranceCents?: number;
  /** The instrument's offset from A440, applied before snapping. */
  tuningCents?: number;
  /** 0..1; higher hears quieter plucks and more noise. */
  sensitivity?: number;
}

export interface DetectedHit {
  /** Onset time in the seconds `push` was given, not the time of the decision. */
  time: number;
  /** MIDI pitch after the tuning offset. */
  pitch: number;
  /** Where the peak sat relative to the tine's nominal pitch. */
  cents: number;
  /** Every tine carrying the pitch; upper tiers duplicate some naturals. */
  tines: number[];
  /** 0..1 relative to the loudest recent onset. */
  strength: number;
}

/** Hops between a spectrum and the reference it is compared with for the onset. */
const REF_DELAY = 3;
/** Hops after the crossing at which the pitch is decided. */
const IDENT_HOPS = 7;
/** Samples the sustain check looks at: short, so the click that caused the onset has left it. */
const SUSTAIN_BLOCK = 1024;
/** A note must still hold this fraction of its flux peak's amplitude to be confirmed. */
const SUSTAIN_RATIO = 0.25;
/** The same pitch cannot fire twice within this many seconds. */
const REFRACTORY = 0.06;
/** Below this nothing musical happens on a kalimba; above it is hum and thumps. */
const LOW_HZ = 100;
/** A flux peak must be this fraction of the tallest peak to be a candidate. */
const PEAK_FRACTION = 0.15;
/** A peak this close to a stronger one, and under this fraction of it, is its side lobe. */
const MASK_SEMITONES = 2.5;
const MASK_BINS = 3.5;
const MASK_RATIO = 0.4;
/** First inharmonic overtone of a clamped-free bar, as a ratio to the fundamental. */
const OVERTONE = 6.27;
const OVERTONE_SLACK = 0.35;
/** Hops of flux history behind the adaptive threshold. */
const MEDIAN_HOPS = 43;
const THRESHOLD_MULT = 3;
/** Block size of the energy envelope the onset moment is read from. */
const ENV_BLOCK = 64;
/** Hops of envelope scanned back from the crossing. */
const ENV_HOPS = 4;
/** Blocks averaged on each side of a candidate onset moment, so beating notes do not fake a step. */
const ENV_SIDE = 8;
/**
 * A pluck always adds energy up here (the thumb's click and the inharmonic
 * overtones, 6.3× the lowest tine at the least); two ringing notes beating
 * against each other never do. Without this gate every beat crest of two
 * bass tines a semitone apart looked like a new pluck.
 */
const ATTACK_HZ = 600;
const ATTACK_FRACTION = 0.05;
const ATTACK_MULT = 3;
/** Hops after the crossing during which the attack gate may still pass. */
const GATE_HOPS = 2;

interface Onset {
  time: number;
  /** Spectrum from before the note, saved at the crossing. */
  before: Float32Array;
  /** Hop index at which the pitch is decided. */
  due: number;
  /** Whether the attack gate passed on the crossing hop or shortly after. */
  struck: boolean;
  /** Last hop index at which the gate may still pass. */
  gateUntil: number;
}

interface Candidate {
  pitch: number;
  cents: number;
  hz: number;
  bin: number;
  peak: number;
}

export class Detector {
  private readonly fs: number;
  private readonly n: number;
  private readonly tol: number;
  private tuning: number;
  private readonly absFloor: number;

  private pitches: number[] = [];
  private tinesByPitch = new Map<number, number[]>();
  private kLo = 1;
  private kHi = 1;
  private kAttack = 1;

  private readonly ring: Float32Array;
  private ringPos = 0;
  /** The last `n` samples in order, refreshed each hop for the transform and Goertzel. */
  private readonly frame: Float32Array;
  private readonly fft: FFT;
  private readonly win: Float32Array;
  private readonly winSum: number;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly specs: Float32Array[];
  private readonly flux: Float32Array;

  private hopIndex = 0;
  private fluxHistory: number[] = [];
  private attackHistory: number[] = [];
  private prevFlux = 0;
  private onsets: Onset[] = [];
  private lastHit = new Map<number, number>();
  private recentPeak = 0;

  constructor(layout: Layout, opts: DetectorOptions) {
    this.fs = opts.sampleRate;
    this.n = opts.window ?? 4096;
    this.tol = opts.toleranceCents ?? 40;
    this.tuning = opts.tuningCents ?? 0;
    const s = Math.max(0, Math.min(1, opts.sensitivity ?? 0.5));
    this.absFloor = 0.006 * 2 ** ((0.5 - s) * 4);

    this.ring = new Float32Array(this.n);
    this.frame = new Float32Array(this.n);
    this.fft = new FFT(this.n);
    this.win = hann(this.n);
    let sum = 0;
    for (let i = 0; i < this.n; i++) sum += this.win[i];
    this.winSum = sum;
    this.re = new Float32Array(this.n);
    this.im = new Float32Array(this.n);
    this.specs = [];
    for (let i = 0; i <= REF_DELAY; i++) this.specs.push(new Float32Array(this.n / 2 + 1));
    this.flux = new Float32Array(this.n / 2 + 1);
    this.setLayout(layout);
  }

  setLayout(layout: Layout) {
    this.tinesByPitch = new Map();
    layout.tines.forEach((t, i) => {
      const list = this.tinesByPitch.get(t.pitch);
      if (list) list.push(i);
      else this.tinesByPitch.set(t.pitch, [i]);
    });
    this.pitches = [...this.tinesByPitch.keys()].sort((a, b) => a - b);
    const top = this.pitches.length ? hzOf(this.pitches[this.pitches.length - 1] + 1) : 2000;
    this.kLo = Math.max(1, Math.ceil((LOW_HZ * this.n) / this.fs));
    // Room above the top tine for its attack energy, and never below the gate.
    this.kAttack = Math.ceil((ATTACK_HZ * this.n) / this.fs);
    this.kHi = Math.min(this.n / 2 - 1, Math.max(this.kAttack + 8, Math.ceil((top * 1.5 * this.n) / this.fs)));
    this.onsets = [];
  }

  setTuning(cents: number) {
    this.tuning = cents;
  }

  reset() {
    this.ring.fill(0);
    for (const s of this.specs) s.fill(0);
    this.ringPos = 0;
    this.hopIndex = 0;
    this.fluxHistory = [];
    this.attackHistory = [];
    this.prevFlux = 0;
    this.onsets = [];
    this.lastHit.clear();
    this.recentPeak = 0;
  }

  /**
   * Feed one hop. `time` is the clock time of its first sample. Returns the
   * hits confirmed during this hop; their `time` is the onset, which is
   * several hops earlier.
   */
  push(samples: Float32Array, time: number): DetectedHit[] {
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.ringPos] = samples[i];
      this.ringPos = (this.ringPos + 1) % this.n;
    }
    this.hopIndex++;
    const now = time + samples.length / this.fs;

    // The last n samples in order, windowed into the transform.
    const { n, frame, ring, ringPos, re, im, win } = this;
    for (let i = 0; i < n; i++) {
      const s = ring[(ringPos + i) % n];
      frame[i] = s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    this.fft.forward(re, im);
    const cur = this.specs[this.hopIndex % (REF_DELAY + 1)];
    const ref = this.hopIndex > REF_DELAY ? this.specs[(this.hopIndex - REF_DELAY) % (REF_DELAY + 1)] : null;
    const scale = 2 / this.winSum;
    let total = 0;
    let attack = 0;
    for (let k = this.kLo; k <= this.kHi; k++) {
      const m = Math.hypot(re[k], im[k]) * scale;
      const f = ref ? m - ref[k] : 0;
      this.flux[k] = f > 0 ? f : 0;
      total += this.flux[k];
      if (k >= this.kAttack) attack += this.flux[k];
    }

    const threshold = Math.max(this.absFloor, THRESHOLD_MULT * median(this.fluxHistory));
    // Up high there is only noise between plucks, so its median is the
    // noise; a pluck's attack has to stand clear of it and be a real share
    // of what is new.
    const struck = attack >= ATTACK_FRACTION * total && attack > ATTACK_MULT * median(this.attackHistory);
    this.fluxHistory.push(total);
    this.attackHistory.push(attack);
    if (this.fluxHistory.length > MEDIAN_HOPS) {
      this.fluxHistory.shift();
      this.attackHistory.shift();
    }

    if (ref && total > threshold && this.prevFlux <= threshold) {
      this.onsets.push({ time: this.onsetMoment(now), before: ref.slice(0, this.kHi + 1), due: this.hopIndex + IDENT_HOPS, struck: false, gateUntil: this.hopIndex + GATE_HOPS });
    }
    // The crossing comes on the hop the note first enters the window, when
    // its attack is barely in yet; the gate has a couple of hops to show.
    for (const o of this.onsets) if (!o.struck && this.hopIndex <= o.gateUntil && struck) o.struck = true;
    this.prevFlux = total;

    // Written after the onset check: `cur` may be the slot `ref` pointed at.
    for (let k = this.kLo; k <= this.kHi; k++) cur[k] = Math.hypot(re[k], im[k]) * scale;

    const hits: DetectedHit[] = [];
    if (this.onsets.length && this.onsets[0].due <= this.hopIndex) {
      const onset = this.onsets.shift()!;
      if (onset.struck) this.identify(onset, cur, hits);
    }
    return hits;
  }

  /**
   * The onset's moment, from the energy envelope of the last few hops: the
   * block where the mean energy of the next few blocks most exceeds that of
   * the previous few. The envelope is of the first difference of the
   * signal, which favours the attack's click and overtones over the
   * fundamentals of notes already ringing, and averaging both sides keeps
   * their beating from passing as a step. The threshold crossing itself
   * lags the pluck by a hop or two.
   */
  private onsetMoment(now: number): number {
    const { frame, n } = this;
    const span = ENV_HOPS * 512;
    const blocks = Math.floor(span / ENV_BLOCK);
    const e = new Float64Array(blocks);
    for (let b = 0; b < blocks; b++) {
      const start = n - span + b * ENV_BLOCK;
      let sum = 0;
      for (let i = start; i < start + ENV_BLOCK; i++) {
        const d = frame[i] - frame[i - 1];
        sum += d * d;
      }
      e[b] = sum;
    }
    let bestStep = -Infinity;
    let bestBlock = blocks - ENV_SIDE;
    for (let b = ENV_SIDE; b + ENV_SIDE <= blocks; b++) {
      let before = 0;
      let after = 0;
      for (let j = 1; j <= ENV_SIDE; j++) {
        before += e[b - j];
        after += e[b + j - 1];
      }
      if (after - before > bestStep) {
        bestStep = after - before;
        bestBlock = b;
      }
    }
    return now - (span - bestBlock * ENV_BLOCK) / this.fs;
  }

  /** What the onset added to the spectrum, as pitches; then confirm each is still sounding. */
  private identify(onset: Onset, cur: Float32Array, hits: DetectedHit[]) {
    const { flux, kLo, kHi } = this;
    let max = 0;
    for (let k = kLo; k <= kHi; k++) {
      const f = cur[k] - onset.before[k];
      flux[k] = f > 0 ? f : 0;
      if (flux[k] > max) max = flux[k];
    }
    if (max < this.absFloor / 4) return;
    this.recentPeak = Math.max(this.recentPeak * 0.995, max);
    const min = Math.max(max * PEAK_FRACTION, this.absFloor / 4);

    const found: Candidate[] = [];
    for (let k = kLo + 1; k < kHi; k++) {
      const f = flux[k];
      if (f < min || f < flux[k - 1] || f < flux[k + 1]) continue;
      // Parabolic interpolation: the true peak sits between bins.
      const denom = flux[k - 1] - 2 * f + flux[k + 1];
      const delta = denom !== 0 ? (0.5 * (flux[k - 1] - flux[k + 1])) / denom : 0;
      const bin = k + delta;
      const hz = (bin * this.fs) / this.n;
      const midi = 69 + 12 * Math.log2(hz / 440) - this.tuning / 100;
      const pitch = this.nearestPitch(midi);
      if (pitch === null) continue;
      const cents = (midi - pitch) * 100;
      if (Math.abs(cents) > this.tol) continue;
      found.push({ pitch, cents, hz, bin, peak: f });
    }
    found.sort((a, b) => b.peak - a.peak);

    const kept: Candidate[] = [];
    for (const c of found) {
      if (kept.some((k) => k.pitch === c.pitch)) continue;
      // A weaker peak right beside a stronger one is its side lobe, and one
      // near 6.3× a stronger one is the fundamental's overtone.
      const masked = kept.some(
        (k) =>
          (k.peak * MASK_RATIO > c.peak && (Math.abs(k.pitch - c.pitch) <= MASK_SEMITONES || Math.abs(k.bin - c.bin) <= MASK_BINS)) ||
          (k.hz < c.hz && Math.abs(c.hz / k.hz - OVERTONE) < OVERTONE_SLACK),
      );
      if (masked) continue;
      const last = this.lastHit.get(c.pitch);
      if (last !== undefined && onset.time - last < REFRACTORY) continue;
      // Still sounding in the last 21 ms? Clicks and overtones are not.
      const amp = goertzel(this.frame, this.n - SUSTAIN_BLOCK, SUSTAIN_BLOCK, c.hz, this.fs);
      if (amp < SUSTAIN_RATIO * c.peak) continue;
      kept.push(c);
    }

    for (const c of kept) {
      this.lastHit.set(c.pitch, onset.time);
      hits.push({
        time: onset.time,
        pitch: c.pitch,
        cents: c.cents,
        tines: this.tinesByPitch.get(c.pitch) ?? [],
        strength: this.recentPeak > 0 ? Math.min(1, c.peak / this.recentPeak) : 1,
      });
    }
    hits.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  }

  private nearestPitch(midi: number): number | null {
    const p = this.pitches;
    if (!p.length) return null;
    let lo = 0;
    let hi = p.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (p[mid] < midi) lo = mid + 1;
      else hi = mid;
    }
    const above = p[lo];
    const below = lo > 0 ? p[lo - 1] : above;
    return Math.abs(above - midi) <= Math.abs(midi - below) ? above : below;
  }
}

export function hzOf(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
