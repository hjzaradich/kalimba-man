// Synthetic kalimba-ish signals for the detector tests (DESIGN.md §16.10):
// a decaying sine with the inharmonic overtone of a clamped-free bar, a
// metronome click, noise. Not a synth for listening to; a stand-in until
// recordings of the instrument exist, and a way to test cases recordings
// cannot isolate.

import type { DetectedHit, Detector } from "./detector";
import { hzOf } from "./detector";

export function silence(seconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate));
}

/**
 * Add a pluck: 2 ms attack, exponential ring, plus the 6.27× overtone that
 * dies in tens of milliseconds. `stopAt` damps the tine at that time, as a
 * thumb does when it plucks the same tine again.
 */
export function pluck(out: Float32Array, sampleRate: number, at: number, pitch: number, amp = 0.3, ring = 1.5, cents = 0, stopAt = Infinity): void {
  const hz = hzOf(pitch) * 2 ** (cents / 1200);
  const start = Math.round(at * sampleRate);
  const attack = Math.round(0.002 * sampleRate);
  const stop = Math.min(out.length, Math.round(stopAt * sampleRate));
  const damp = Math.round(0.005 * sampleRate);
  for (let i = start; i < stop; i++) {
    const t = (i - start) / sampleRate;
    const release = stop - i < damp ? (stop - i) / damp : 1;
    const env = (i - start < attack ? (i - start) / attack : 1) * Math.exp(-t / ring) * release;
    const over = 0.35 * Math.exp(-t / 0.04);
    out[i] += amp * env * (Math.sin(2 * Math.PI * hz * t) + over * Math.sin(2 * Math.PI * hz * 6.27 * t));
  }
}

/** The app's metronome: 40 ms of square wave. */
export function click(out: Float32Array, sampleRate: number, at: number, hz = 1200, amp = 0.15, seconds = 0.04): void {
  const start = Math.round(at * sampleRate);
  const end = Math.min(out.length, start + Math.round(seconds * sampleRate));
  for (let i = start; i < end; i++) {
    const t = (i - start) / sampleRate;
    out[i] += amp * Math.sign(Math.sin(2 * Math.PI * hz * t)) * Math.exp(-t / 0.03);
  }
}

/** White noise, deterministic so tests do not flicker. */
export function noise(out: Float32Array, amp: number, seed = 1): void {
  let s = seed >>> 0 || 1;
  for (let i = 0; i < out.length; i++) {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] += amp * ((s >>> 0) / 0xffffffff - 0.5) * 2;
  }
}

/** Feed a whole signal through a detector hop by hop, as the listener would. */
export function run(detector: Detector, signal: Float32Array, sampleRate: number, hop = 512): DetectedHit[] {
  const hits: DetectedHit[] = [];
  for (let start = 0; start + hop <= signal.length; start += hop) {
    hits.push(...detector.push(signal.subarray(start, start + hop), start / sampleRate));
  }
  return hits;
}
