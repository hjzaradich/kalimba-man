import { describe, expect, it } from "vitest";
import { CLIP, LevelMeter, measure, toBar } from "./level";

function sine(amplitude: number, n = 512): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * i * 8) / n);
  return out;
}

describe("measure", () => {
  it("returns rms and peak of a sine", () => {
    const m = measure(sine(0.5));
    expect(m.peak).toBeCloseTo(0.5, 2);
    expect(m.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("is zero for silence and for an empty hop", () => {
    expect(measure(new Float32Array(64))).toEqual({ rms: 0, peak: 0 });
    expect(measure(new Float32Array(0))).toEqual({ rms: 0, peak: 0 });
  });
});

describe("LevelMeter", () => {
  it("jumps up at once and falls by the release factor", () => {
    const meter = new LevelMeter(0.5);
    const loud = meter.push(sine(0.8));
    expect(loud.peak).toBeCloseTo(0.8, 2);
    const quiet = meter.push(new Float32Array(512));
    expect(quiet.peak).toBeCloseTo(0.4, 2);
    expect(quiet.rms).toBeCloseTo(loud.rms / 2, 3);
  });

  it("flags clipping only on the hop that touched full scale", () => {
    const meter = new LevelMeter();
    expect(meter.push(sine(CLIP)).clipping).toBe(true);
    expect(meter.push(sine(0.3)).clipping).toBe(false);
  });

  it("resets to silence", () => {
    const meter = new LevelMeter();
    meter.push(sine(0.9));
    meter.reset();
    expect(meter.current).toEqual({ rms: 0, peak: 0, clipping: false });
  });
});

describe("toBar", () => {
  it("maps full scale to 1, the floor to 0, and silence to 0", () => {
    expect(toBar(1)).toBe(1);
    expect(toBar(0.001)).toBeCloseTo(0, 5); // -60 dB
    expect(toBar(0)).toBe(0);
    expect(toBar(0.1)).toBeCloseTo(2 / 3, 5); // -20 dB
  });
});
