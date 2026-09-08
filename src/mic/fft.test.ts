import { describe, expect, it } from "vitest";
import { FFT, goertzel, hann } from "./fft";

describe("FFT", () => {
  it("puts a bin-centred sine in its bin", () => {
    const n = 1024;
    const fft = new FFT(n);
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 37 * i) / n);
    fft.forward(re, im);
    const mag = (k: number) => Math.hypot(re[k], im[k]);
    expect(mag(37)).toBeCloseTo(n / 2, 3);
    expect(mag(36)).toBeLessThan(1e-3);
    expect(mag(100)).toBeLessThan(1e-3);
  });

  it("rejects sizes that are not powers of two", () => {
    expect(() => new FFT(1000)).toThrow();
  });
});

describe("goertzel", () => {
  it("measures amplitude at an arbitrary frequency", () => {
    const fs = 48000;
    const n = 1024;
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = 0.4 * Math.sin((2 * Math.PI * 261.63 * i) / fs);
    expect(goertzel(s, 0, n, 261.63, fs)).toBeCloseTo(0.4, 1);
    expect(goertzel(s, 0, n, 1200, fs)).toBeLessThan(0.02);
  });
});

describe("hann", () => {
  it("is zero at the edges and one in the middle", () => {
    const w = hann(8);
    expect(w[0]).toBe(0);
    expect(w[4]).toBeCloseTo(1);
  });
});
