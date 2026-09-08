// Input level for the meter in the transport bar: RMS and peak of each
// hop, smoothed with a fast attack and a slow release so the bar jumps on
// a pluck and falls gently. Pure, so it is tested with arrays.

export interface Level {
  /** Smoothed RMS, 0..1 linear. */
  rms: number;
  /** Smoothed peak, 0..1 linear. */
  peak: number;
  /** True when the last hop touched full scale: the input is too hot. */
  clipping: boolean;
}

/** Peak at or above this counts as clipping. */
export const CLIP = 0.99;

export function measure(samples: Float32Array): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sum += s * s;
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
  }
  return { rms: samples.length ? Math.sqrt(sum / samples.length) : 0, peak };
}

export class LevelMeter {
  private level: Level = { rms: 0, peak: 0, clipping: false };

  /**
   * @param release Fraction of the level kept per hop while it falls. At a
   *   hop of ~11 ms, 0.9 falls to a tenth in about 0.25 s.
   */
  constructor(private readonly release = 0.9) {}

  /** Feed one hop. */
  push(samples: Float32Array): Level {
    const m = measure(samples);
    const r = this.release;
    this.level = {
      rms: m.rms > this.level.rms ? m.rms : this.level.rms * r,
      peak: m.peak > this.level.peak ? m.peak : this.level.peak * r,
      clipping: m.peak >= CLIP,
    };
    return this.level;
  }

  get current(): Level {
    return this.level;
  }

  reset() {
    this.level = { rms: 0, peak: 0, clipping: false };
  }
}

/** Linear 0..1 to a 0..1 bar position on a decibel scale from `floorDb` to 0. */
export function toBar(linear: number, floorDb = -60): number {
  if (linear <= 0) return 0;
  const db = 20 * Math.log10(linear);
  return Math.max(0, Math.min(1, 1 - db / floorDb));
}
