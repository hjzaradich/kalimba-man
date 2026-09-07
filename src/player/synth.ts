// A stand-in kalimba voice: sine with a touch of second harmonic, fast
// attack, ringing decay, into a shared synthetic reverb. No sample files
// (DESIGN.md §9).

export class Synth {
  private readonly master: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;

  constructor(private readonly ctx: AudioContext) {
    // A limiter before the output: chords of four or five plucks would
    // otherwise sum past full scale and distort.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(limiter);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.8;
    this.dry.connect(this.master);

    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulseResponse(ctx, 1.8, 2.5);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.wet.connect(convolver);
    convolver.connect(this.master);
  }

  /** Schedule one pluck at an AudioContext time. */
  pluck(pitch: number, at: number, velocity = 0.8) {
    const ctx = this.ctx;
    const freq = 440 * 2 ** ((pitch - 69) / 12);
    // Never in the past: a start time behind the clock makes the attack ramp
    // collapse into a click at full level.
    const start = Math.max(at, ctx.currentTime + 0.005);
    const ring = 1.4;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(velocity, start + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, start + ring);
    env.connect(this.dry);
    env.connect(this.wet);

    const partials: [number, number][] = [
      [1, 1],
      [2, 0.22],
      [3, 0.05],
    ];
    for (const [ratio, gain] of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(env);
      osc.start(start);
      osc.stop(start + ring + 0.05);
    }
  }

  /** A short click for the metronome (phase 3). */
  click(at: number, accent = false) {
    const ctx = this.ctx;
    const start = Math.max(at, ctx.currentTime);
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = accent ? 1800 : 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.03);
    osc.connect(g);
    g.connect(this.master);
    osc.start(start);
    osc.stop(start + 0.04);
  }
}

/** Exponentially decaying noise: a plausible small room. */
function makeImpulseResponse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return buffer;
}
