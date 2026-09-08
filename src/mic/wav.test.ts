import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav } from "./wav";

describe("wav", () => {
  it("round-trips 16-bit mono within quantisation", () => {
    const n = 1000;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = 0.8 * Math.sin(i / 7);
    const bytes = encodeWav(src, 48000);
    expect(bytes.length).toBe(44 + n * 2);
    const back = decodeWav(bytes);
    expect(back.sampleRate).toBe(48000);
    expect(back.samples.length).toBe(n);
    for (let i = 0; i < n; i += 37) expect(back.samples[i]).toBeCloseTo(src[i], 3);
  });

  it("clamps out-of-range samples instead of wrapping", () => {
    const back = decodeWav(encodeWav(new Float32Array([2, -2]), 8000));
    expect(back.samples[0]).toBeCloseTo(1, 3);
    expect(back.samples[1]).toBe(-1);
  });

  it("rejects things that are not WAV", () => {
    expect(() => decodeWav(new Uint8Array(64))).toThrow(/not a WAV/);
  });
});
