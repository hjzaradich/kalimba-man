// The bridge from microphone hops to hits (DESIGN.md §16.4): owns the
// detector, feeds it every hop the listener posts, and hands the hits to
// whoever subscribed (the board, and later the scorer). The detector is
// built on the first hop, since only then is the sample rate known, and
// rebuilt if it changes.
//
// Subscribing happens in `attach`, not the constructor: React's dev-mode
// StrictMode builds and discards a spare instance, and a constructor that
// subscribed would leave the discarded one listening and the kept one
// disposed.

import type { Layout } from "../model/layout";
import { Detector, type DetectedHit } from "./detector";
import type { Listener } from "./listener";

export class Hearing {
  private detector: Detector | null = null;
  private sampleRate = 0;
  private layout: Layout | null = null;
  private tuningCents = 0;
  private sensitivity = 0.5;
  private subs = new Set<(hits: DetectedHit[]) => void>();

  /** Start taking hops from the listener; returns the function that stops. */
  attach(listener: Listener): () => void {
    const unFrame = listener.onFrame((f) => {
      if (!this.layout) return;
      if (!this.detector || f.sampleRate !== this.sampleRate) {
        this.sampleRate = f.sampleRate;
        this.detector = new Detector(this.layout, { sampleRate: f.sampleRate, tuningCents: this.tuningCents, sensitivity: this.sensitivity });
      }
      const hits = this.detector.push(f.samples, f.time);
      if (hits.length) for (const fn of this.subs) fn(hits);
    });
    const unState = listener.subscribe((s) => {
      // A fresh start (or a new device) begins with a clean slate.
      if (s.status !== "on") this.detector?.reset();
    });
    return () => {
      unFrame();
      unState();
    };
  }

  setLayout(layout: Layout) {
    if (this.layout === layout) return;
    this.layout = layout;
    this.detector?.setLayout(layout);
  }

  setTuning(cents: number) {
    this.tuningCents = cents;
    this.detector?.setTuning(cents);
  }

  setSensitivity(s: number) {
    this.sensitivity = s;
    this.detector = null; // rebuilt with the new floor on the next hop
  }

  onHit(fn: (hits: DetectedHit[]) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
